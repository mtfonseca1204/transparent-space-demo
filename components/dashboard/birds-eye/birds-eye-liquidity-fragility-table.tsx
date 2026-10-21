"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import {
  prepareRoutingPools,
  routePreparedOrderAcrossPools,
  ROUTING_ORDER_SIZES_USD,
  type RoutingOrderSize,
  type RoutingPoolInput,
} from "@/lib/routing-engine";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import { LpLabel } from "@/components/dashboard/lp-label";
import { LP_COLORS, OTHERS_COLOR } from "@/components/custom-metrics/metric-colors";
import { cn } from "@/lib/utils";
import { getDemoTokenLogo } from "@/lib/demo/logos";
import {
  hydrateLiquidityAggregation,
  type BirdsEyeFragilityModel,
  type BirdsEyeFragilityWorkerResponse,
} from "@/lib/birds-eye-fragility-model";

const TOP_LPS_PER_ASSET = 10;
const SIZE_SAMPLES: readonly RoutingOrderSize[] = ROUTING_ORDER_SIZES_USD;

// Order size the "BUY/SELL @ $Xk" impact KPIs are quoted at. Must be one of
// SIZE_SAMPLES so it maps to a computed impact bucket.
const KPI_ORDER_SIZE_USD: RoutingOrderSize = 10_000;
const KPI_ORDER_SIZE_INDEX = Math.max(0, SIZE_SAMPLES.indexOf(KPI_ORDER_SIZE_USD));
const KPI_ORDER_SIZE_LABEL = `$${Math.round(KPI_ORDER_SIZE_USD / 1000)}k`;

// ─── SVG layout — both panels share width + horizontal margins so the X axis
//     aligns vertically and a single hover cursor crosses both charts. ─────
const VB_W = 800;
const M_L = 60;
const M_R = 56;
const PLOT_W = VB_W - M_L - M_R;

// Top panel — cross-pool LP liquidity by USD-per-asset price.
const LIQ_VB_H = 290;
const LIQ_M_T = 14;
const LIQ_M_B = 36;
const LIQ_PLOT_H = LIQ_VB_H - LIQ_M_T - LIQ_M_B;

// Bottom panel — order-size needed to push price to a given target.
const IMP_VB_H = 280;
const IMP_M_T = 10;
const IMP_M_B = 12;
const IMP_PLOT_H = IMP_VB_H - IMP_M_T - IMP_M_B;
const LIQUIDITY_PRICE_RANGE_PCT = 0.5;

// Shared price-axis helpers — both panels map a USD-per-asset price onto
// `[M_L, M_L+PLOT_W]` using a log scale spanning ±LIQUIDITY_PRICE_RANGE_PCT
// around the current spot price. Keeping the mapping in one place is what
// lets the unified hover cursor land on the same X in both charts.
function xOfPriceUsd(priceUsd: number, spotUsd: number): number {
  const logLo = Math.log(spotUsd * (1 - LIQUIDITY_PRICE_RANGE_PCT));
  const logHi = Math.log(spotUsd * (1 + LIQUIDITY_PRICE_RANGE_PCT));
  if (!(priceUsd > 0)) return M_L;
  const t = (Math.log(priceUsd) - logLo) / (logHi - logLo);
  return M_L + Math.max(0, Math.min(1, t)) * PLOT_W;
}
function priceUsdOfX(svgX: number, spotUsd: number): number {
  const logLo = Math.log(spotUsd * (1 - LIQUIDITY_PRICE_RANGE_PCT));
  const logHi = Math.log(spotUsd * (1 + LIQUIDITY_PRICE_RANGE_PCT));
  const t = (svgX - M_L) / PLOT_W;
  return Math.exp(logLo + Math.max(0, Math.min(1, t)) * (logHi - logLo));
}
function yOfOrderSizeRange(
  orderUsd: number,
  yMinUsd: number,
  yMaxUsd: number,
  plotH: number,
  mTop: number,
): number {
  if (!(orderUsd > 0) || !(yMinUsd > 0) || !(yMaxUsd > yMinUsd)) {
    return mTop + plotH;
  }
  const logV = Math.log10(orderUsd);
  const logMin = Math.log10(yMinUsd);
  const logMax = Math.log10(yMaxUsd);
  const t = (logV - logMin) / (logMax - logMin);
  return mTop + plotH - Math.max(0, Math.min(1, t)) * plotH;
}

// Snap a USD value to the smallest "nice" multiple ≥ value within this
// log-friendly sequence. Coarser sequences (e.g. just `[1, 2, 5, 10]`) leave
// a gigantic gap between $5M and $10M — any curve max in between rounds up
// to $10M and the chart wastes its top ~30% of vertical space. The finer
// steps below keep round-looking labels while fitting the curve tightly.
const NICE_STEPS = [1, 1.5, 2, 3, 5, 7, 10] as const;
function ceilToNice(value: number): number {
  if (!(value > 0)) return 1;
  const decade = Math.pow(10, Math.floor(Math.log10(value)));
  const ratio = value / decade;
  for (const m of NICE_STEPS) {
    if (ratio <= m) return m * decade;
  }
  return 10 * decade;
}
function floorToNice(value: number): number {
  if (!(value > 0)) return 1;
  const decade = Math.pow(10, Math.floor(Math.log10(value)));
  const ratio = value / decade;
  let best = 1;
  for (const m of NICE_STEPS) {
    if (m <= ratio) best = m;
  }
  return best * decade;
}

// Inverse of `interpAtSamples(values, sampleLogs, log10(orderSize))`: given a
// target impact %, bisect over log-order-size *within* the sampled range to
// find the order size that produces that impact. Returns `null` when the
// target exceeds the largest sampled impact — i.e. the price target is
// physically unreachable for this pool set, even at the largest sampled
// order. Bisection is bounded by the actual sample range so we never rely on
// extrapolation past the routing-engine data.
function orderSizeForImpact(
  values: number[],
  sampleLogs: readonly number[],
  targetImpactPct: number,
): number | null {
  if (!(targetImpactPct > 0)) return null;
  const last = sampleLogs.length - 1;
  if (last < 0) return null;
  const maxImpact = values[last];
  if (!Number.isFinite(maxImpact) || maxImpact < targetImpactPct) return null;
  if ((values[0] ?? 0) >= targetImpactPct) return Math.pow(10, sampleLogs[0]);
  let logLo = sampleLogs[0];
  let logHi = sampleLogs[last];
  for (let iter = 0; iter < 40; iter++) {
    const mid = (logLo + logHi) / 2;
    const impact = interpAtSamples(values, sampleLogs, mid);
    if (!Number.isFinite(impact) || impact < targetImpactPct) {
      logLo = mid;
    } else {
      logHi = mid;
    }
  }
  return Math.pow(10, logHi);
}

const COLOR_BUY = "#4A8C5C";
const COLOR_SELL = "#B0524F";
const KATANA_VB_ETH_ICON =
  "https://cdn.sushi.com/image/upload/f_auto,c_limit,w_96/d_unknown.png/native-currency/ethereum.svg";
const DUST_ICON =
  "https://cdn.dexscreener.com/cms/images/a7efe29afe139ac03be1028f0a76ec91169a6961bbda55b70060a8692ba7d09e?width=64&height=64&fit=crop&quality=95&format=auto";
const W0G_ICON =
  "https://storage.googleapis.com/merkl-static-assets/tokens/w0G.svg";
const BSC_0G_ICON =
  "https://tokens.pancakeswap.finance/images/0x4B948d64dE1F71fCd12fB586f4c776421a35b3eE.png";

const XSTOCKS_TOKENS: Record<string, string> = {
  TSLAX: "TSLAx",
  NVDAX: "NVDAx",
  SPYX: "SPYx",
  QQQX: "QQQx",
  GLDX: "GLDx",
  GOOGLX: "GOOGLx",
  HOODX: "HOODx",
  CRCLX: "CRCLx",
  METAX: "METAx",
  COINX: "COINx",
  SPCXX: "SPCXx",
};

function tokenIconUrl(symbol: string): string {
  const s = (symbol || "").toUpperCase();
  const demoLogo = getDemoTokenLogo(s);
  if (demoLogo) return demoLogo;
  if (s === "AI") return "https://assets.coingecko.com/coins/images/71027/standard/gensyn.png?1765331043";
  if (s === "STRCX") return "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234";
  if (s === "PRL") return "/icons/perle-logo.webp";
  if (s === "WLD") return "/icons/worldcoin-icon.svg";
  if (s === "EURC") return "/icons/eurc-icon.png";
  if (s === "OXAUT") return "/icons/oxaut-icon.png";
  if (s === "DUST") return DUST_ICON;
  if (s === "W0G") return W0G_ICON;
  if (s === "0G") return BSC_0G_ICON;
  if (s === "VBETH" || s === "VBUSDC") return KATANA_VB_ETH_ICON;
  if (s.includes("USDT")) return "/icons/usdt-icon.svg";
  if (s.includes("USDC")) return "/icons/usdc-icon.svg";
  if (s === "WBTC" || s === "BTC") return "https://token-icons.s3.amazonaws.com/btc.png";
  if (s === "WETH" || s === "ETH") return "https://token-icons.s3.amazonaws.com/eth.png";
  if (s === "MADS") return "/icons/mads-icon.png";
  const xs = XSTOCKS_TOKENS[s];
  if (xs) return `https://xstocks-metadata.backed.fi/logos/tokens/${xs}.png`;
  return "/icons/usdc-icon.svg";
}

function fmtUsdShort(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (usd >= 1000) {
    const k = usd / 1000;
    if (k >= 100) return `$${Math.round(k)}K`;
    if (k >= 10) return `$${k.toFixed(0)}K`;
    return `$${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `$${Math.round(usd)}`;
}
function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  if (pct >= 100) return `${Math.round(pct)}%`;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const k = 0.35;
  const r = (n: number) => n.toFixed(2);
  let d = `M ${r(pts[0][0])},${r(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * k * 0.45;
    const cp1y = p1[1] + (p2[1] - p0[1]) * k * 0.45;
    const cp2x = p2[0] - (p3[0] - p1[0]) * k * 0.45;
    const cp2y = p2[1] - (p3[1] - p1[1]) * k * 0.45;
    d += ` C ${r(cp1x)},${r(cp1y)} ${r(cp2x)},${r(cp2y)} ${r(p2[0])},${r(p2[1])}`;
  }
  return d;
}
function interpAtSamples(
  values: number[],
  sampleLogs: readonly number[],
  logX: number,
): number {
  const last = sampleLogs.length - 1;
  if (last < 0) return 0;
  if (logX <= sampleLogs[0]) return values[0] ?? 0;
  if (logX >= sampleLogs[last]) {
    const dx = logX - sampleLogs[last];
    const dxLast = sampleLogs[last] - sampleLogs[last - 1];
    const slope = dxLast > 0 ? (values[last] - values[last - 1]) / dxLast : 0;
    return values[last] + slope * dx;
  }
  for (let i = 0; i < last; i++) {
    if (logX >= sampleLogs[i] && logX <= sampleLogs[i + 1]) {
      const span = sampleLogs[i + 1] - sampleLogs[i];
      const t = span > 0 ? (logX - sampleLogs[i]) / span : 0;
      return values[i] * (1 - t) + values[i + 1] * t;
    }
  }
  return values[0] ?? 0;
}


// ─── Math helpers ──────────────────────────────────────────────────────────────

interface ImpactSeries {
  buys: number[];
  sells: number[];
  totalLiquidityUsd: number;
  /** Max USD output the pool set can produce on the buy side — i.e., the
   *  total USD value of AI a trader could ever extract before the pool is
   *  drained. Bounded by physical reserves (unlike maxInputUsd which grows
   *  asymptotically). */
  maxBuyOutputUsd: number;
  maxSellOutputUsd: number;
}

interface OwnerSplit {
  totalUsd: number;
  buySideUsd: number;
  sellSideUsd: number;
}

function valuePositionsByOwner(card: BirdsEyePoolCard): Map<string, OwnerSplit> {
  const out = new Map<string, OwnerSplit>();
  const pd = card.poolData;
  if (!pd) return out;
  const sqrtPriceX96 = BigInt(pd.sqrtPriceX96);
  const t0Usd = card.token0Usd ?? 0;
  const t1Usd = card.token1Usd ?? 0;
  // The "buy" side of this pool is the side that holds the *tracked* asset —
  // a BUY consumes tracked-asset inventory. For an AI/USDC pool with AI=token0
  // (isTrackedToken0=true), buy-side USD is the token0 (AI) amount; sell-side
  // is token1 (USDC). Reversed when the tracked asset is token1.
  const isToken0 = card.isTrackedToken0;

  for (const ownerGroup of card.positions) {
    const owner = ownerGroup.owner?.toLowerCase().trim();
    if (!owner) continue;
    let total = 0;
    let buySide = 0;
    let sellSide = 0;
    for (const pos of ownerGroup.positions) {
      const liquidity = BigInt(pos.liquidity ?? "0");
      if (liquidity <= 0n) continue;
      const tickLower = Number((pos as { tickLower?: number | string }).tickLower
        ?? (pos as { tick_lower?: number | string }).tick_lower);
      const tickUpper = Number((pos as { tickUpper?: number | string }).tickUpper
        ?? (pos as { tick_upper?: number | string }).tick_upper);
      if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) continue;
      const { amount0, amount1 } = amountsForPosition({
        liquidity,
        tickLower,
        tickUpper,
        sqrtPriceX96,
      });
      const amt0Usd = bigintToApproxNumber(amount0, pd.token0Decimals) * t0Usd;
      const amt1Usd = bigintToApproxNumber(amount1, pd.token1Decimals) * t1Usd;
      total += amt0Usd + amt1Usd;
      if (isToken0) {
        buySide += amt0Usd;
        sellSide += amt1Usd;
      } else {
        buySide += amt1Usd;
        sellSide += amt0Usd;
      }
    }
    if (total > 0) {
      const existing = out.get(owner) ?? { totalUsd: 0, buySideUsd: 0, sellSideUsd: 0 };
      existing.totalUsd += total;
      existing.buySideUsd += buySide;
      existing.sellSideUsd += sellSide;
      out.set(owner, existing);
    }
  }
  return out;
}

// ─── Cross-pool liquidity-by-LP aggregation ──────────────────────────────────
//
// Aggregates all LP-Ranges-by-Address contributions across every pool of an
// asset onto a unified USD-per-asset price axis. For each price bin we sum the
// USD value of each top-10 LP's positions intersected with that bin's tick
// range in each pool, using the same Uniswap-v3 math the per-pool LP Ranges
// chart uses (`calcLPValueAtTick`). Fees are intentionally ignored — the
// stacked bars show raw on-chain liquidity, not fee-adjusted depth.

const LIQUIDITY_BIN_COUNT = 60;
const LOG_1_0001 = Math.log(1.0001);
const OTHERS_KEY = "__others__";

interface LiquidityBin {
  priceLowUsd: number;
  priceHighUsd: number;
  priceMidUsd: number;
  /** USD per top-10 owner (lowercased address) plus a special `OTHERS_KEY` bucket
   *  aggregating all positions outside the top-10. */
  perOwnerUsd: Map<string, number>;
  totalUsd: number;
}

interface LiquidityAggregation {
  bins: LiquidityBin[];
  currentPriceUsd: number;
  maxBinUsd: number;
  /** True if any non-top-10 LP contributed liquidity within range. */
  hasOthers: boolean;
  /** Total USD across all bins for non-top-10 LPs. */
  othersTotalUsd: number;
  /** Distinct count of non-top-10 LP addresses contributing within range. */
  othersOwnerCount: number;
}

function approxBigIntToNumber(v: bigint): number {
  if (v === 0n) return 0;
  const neg = v < 0n;
  const s = (neg ? -v : v).toString();
  if (s.length <= 15) return Number(neg ? "-" + s : s);
  const mantissa = Number(s.slice(0, 15));
  const exponent = s.length - 15;
  const n = mantissa * Math.pow(10, exponent);
  return neg ? -n : n;
}

function buildLiquidityBins(
  cards: BirdsEyePoolCard[],
  topOwners: string[],
  excludedOwners: Set<string>,
): LiquidityAggregation | null {
  // Use the first pool with a usable tracked-asset USD price as the reference.
  let currentPriceUsd: number | null = null;
  for (const card of cards) {
    if (!card.poolData) continue;
    const px = card.isTrackedToken0 ? card.token0Usd : card.token1Usd;
    if (typeof px === "number" && Number.isFinite(px) && px > 0) {
      currentPriceUsd = px;
      break;
    }
  }
  if (!currentPriceUsd) return null;

  const lo = currentPriceUsd * (1 - LIQUIDITY_PRICE_RANGE_PCT);
  const hi = currentPriceUsd * (1 + LIQUIDITY_PRICE_RANGE_PCT);
  if (!(lo > 0) || !(hi > lo)) return null;
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const step = (logHi - logLo) / LIQUIDITY_BIN_COUNT;

  const bins: LiquidityBin[] = [];
  for (let i = 0; i < LIQUIDITY_BIN_COUNT; i++) {
    const priceLowUsd = Math.exp(logLo + i * step);
    const priceHighUsd = Math.exp(logLo + (i + 1) * step);
    bins.push({
      priceLowUsd,
      priceHighUsd,
      priceMidUsd: Math.sqrt(priceLowUsd * priceHighUsd),
      perOwnerUsd: new Map<string, number>(),
      totalUsd: 0,
    });
  }

  const topOwnersSet = new Set(topOwners);
  const othersOwnersSeen = new Set<string>();

  for (const card of cards) {
    const pd = card.poolData;
    if (!pd) continue;
    if (card.token0Usd === null || card.token1Usd === null) continue;
    if (!pd.sqrtPriceX96) continue;
    const t0Usd = card.token0Usd;
    const t1Usd = card.token1Usd;
    if (!(t0Usd > 0) || !(t1Usd > 0)) continue;
    const d0 = pd.token0Decimals;
    const d1 = pd.token1Decimals;
    const sqrtPriceCurrent = Math.pow(1.0001, pd.tick / 2);

    // USD-per-asset → tick in this pool's tick space.
    // assetUsd = price-of-asset-in-counter * counterUsd, and that price-of-
    // asset-in-counter is 1.0001^tick * 10^(d0-d1) when asset=token0 and
    // 1.0001^(-tick) * 10^(d1-d0) when asset=token1.
    const usdToTick = (assetUsd: number): number => {
      if (card.isTrackedToken0) {
        const ratio = assetUsd / (Math.pow(10, d0 - d1) * t1Usd);
        if (!(ratio > 0)) return Number.NaN;
        return Math.log(ratio) / LOG_1_0001;
      }
      const ratio = (Math.pow(10, d1 - d0) * t0Usd) / assetUsd;
      if (!(ratio > 0)) return Number.NaN;
      return Math.log(ratio) / LOG_1_0001;
    };

    for (const ownerGroup of card.positions) {
      const owner = ownerGroup.owner?.toLowerCase().trim();
      if (!owner) continue;
      if (excludedOwners.has(owner)) continue;
      const isTop = topOwnersSet.has(owner);
      const bucketKey = isTop ? owner : OTHERS_KEY;

      for (const pos of ownerGroup.positions) {
        const liquidityBig = BigInt(pos.liquidity ?? "0");
        if (liquidityBig <= 0n) continue;
        const Lnum = approxBigIntToNumber(liquidityBig);
        if (!(Lnum > 0)) continue;
        const tickLower = Number((pos as { tickLower?: number | string }).tickLower
          ?? (pos as { tick_lower?: number | string }).tick_lower);
        const tickUpper = Number((pos as { tickUpper?: number | string }).tickUpper
          ?? (pos as { tick_upper?: number | string }).tick_upper);
        if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) continue;
        if (tickUpper <= tickLower) continue;

        for (const bin of bins) {
          const t1 = usdToTick(bin.priceLowUsd);
          const t2 = usdToTick(bin.priceHighUsd);
          if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;
          const binTickLo = Math.min(t1, t2);
          const binTickHi = Math.max(t1, t2);
          const interLo = Math.max(tickLower, binTickLo);
          const interHi = Math.min(tickUpper, binTickHi);
          if (interLo >= interHi) continue;

          const sqrtA = Math.pow(1.0001, interLo / 2);
          const sqrtB = Math.pow(1.0001, interHi / 2);
          const clamped = Math.min(Math.max(sqrtPriceCurrent, sqrtA), sqrtB);
          const dUp = Math.max(0, sqrtB - clamped);
          const dDown = Math.max(0, clamped - sqrtA);
          const amount0Raw =
            clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
          const amount1Raw = Lnum * dDown;
          const amount0 = amount0Raw / Math.pow(10, d0);
          const amount1 = amount1Raw / Math.pow(10, d1);
          const usd = amount0 * t0Usd + amount1 * t1Usd;
          if (!(usd > 0)) continue;

          bin.perOwnerUsd.set(bucketKey, (bin.perOwnerUsd.get(bucketKey) ?? 0) + usd);
          bin.totalUsd += usd;
          if (!isTop) othersOwnersSeen.add(owner);
        }
      }
    }
  }

  let maxBinUsd = 0;
  let othersTotalUsd = 0;
  for (const bin of bins) {
    if (bin.totalUsd > maxBinUsd) maxBinUsd = bin.totalUsd;
    othersTotalUsd += bin.perOwnerUsd.get(OTHERS_KEY) ?? 0;
  }

  return {
    bins,
    currentPriceUsd,
    maxBinUsd,
    hasOthers: othersOwnersSeen.size > 0 && othersTotalUsd > 0,
    othersTotalUsd,
    othersOwnerCount: othersOwnersSeen.size,
  };
}

function cardToRoutingPool(
  card: BirdsEyePoolCard,
  excludedOwners: Set<string>,
): RoutingPoolInput | null {
  if (!card.poolData) return null;
  if (card.token0Usd === null || card.token1Usd === null) return null;
  if (!card.poolData.sqrtPriceX96) return null;
  if (!card.positions.length) return null;

  // Owner keys in `excludedOwners` were normalized via `.toLowerCase().trim()`
  // upstream in `valuePositionsByOwner` / `buildLpRows`. Mirror both steps here
  // so a stray whitespace from upstream data can't cause a silent filter miss.
  const positions = card.positions
    .filter((entry) => !excludedOwners.has(entry.owner.toLowerCase().trim()))
    .flatMap((entry) => entry.positions);

  if (positions.length === 0) return null;

  return {
    poolKey: card.pool.poolKey,
    key: card.pool.key,
    label: card.pool.label,
    venue: card.pool.protocol,
    feeTier: card.feeTier,
    feeRaw: card.poolData.fee ?? 0,
    positions,
    sqrtPriceX96: card.poolData.sqrtPriceX96,
    currentTick: card.poolData.tick,
    currentPrice: card.poolData.currentPrice,
    token0Decimals: card.poolData.token0Decimals,
    token1Decimals: card.poolData.token1Decimals,
    token0UsdPrice: card.token0Usd,
    token1UsdPrice: card.token1Usd,
    isTrackedToken0: card.isTrackedToken0,
  };
}

function computeImpactSeries(
  cards: BirdsEyePoolCard[],
  excludedOwners: Set<string>,
  totalUsdAllOwners: number,
): ImpactSeries | null {
  const inputs: RoutingPoolInput[] = [];
  for (const card of cards) {
    const input = cardToRoutingPool(card, excludedOwners);
    if (input) inputs.push(input);
  }
  if (inputs.length === 0) return null;
  const prepared = prepareRoutingPools(inputs);
  const buys: number[] = [];
  const sells: number[] = [];
  let maxBuyOutputUsd = 0;
  let maxSellOutputUsd = 0;
  for (let i = 0; i < SIZE_SAMPLES.length; i++) {
    const size = SIZE_SAMPLES[i];
    const buy = routePreparedOrderAcrossPools({
      preparedPools: prepared,
      side: "buyTracked",
      orderUsd: size,
    });
    const sell = routePreparedOrderAcrossPools({
      preparedPools: prepared,
      side: "sellTracked",
      orderUsd: size,
    });
    buys.push(Number.isFinite(buy.effectiveImpactPct) ? buy.effectiveImpactPct : 0);
    sells.push(Number.isFinite(sell.effectiveImpactPct) ? sell.effectiveImpactPct : 0);
    // maxOutputUsd is invariant across sizes (it's a pool property), grab once.
    if (i === 0) {
      maxBuyOutputUsd = buy.maxOutputUsd;
      maxSellOutputUsd = sell.maxOutputUsd;
    }
  }
  // Re-value remaining TVL after exclusions
  let remaining = totalUsdAllOwners;
  if (excludedOwners.size > 0) {
    let removed = 0;
    for (const card of cards) {
      const perOwner = valuePositionsByOwner(card);
      for (const owner of excludedOwners) {
        removed += perOwner.get(owner)?.totalUsd ?? 0;
      }
    }
    remaining = totalUsdAllOwners - removed;
  }
  return {
    buys,
    sells,
    totalLiquidityUsd: Math.max(0, remaining),
    maxBuyOutputUsd,
    maxSellOutputUsd,
  };
}

// ─── Dense sampling for the impact-by-price chart ────────────────────────────
//
// `computeImpactSeries` only samples at `SIZE_SAMPLES` ($1k…$100k) — fine for
// the right-panel stats, but useless for an `orderSize-as-function-of-price`
// curve covering a ±50% price range, where moving spot by 50% on a typical
// pool requires orders far above $100k. Linear-in-log-x extrapolation past
// $100k is wildly inaccurate for AMM impact (we saw $22M reported for 4%
// impact and $10B asymptotes), so instead we directly run the routing engine
// at 25 log-spaced sizes from $1k to $10M and let it report real impacts —
// including capacity-exceeded asymptotes — across the full range.
const EXTENDED_ORDER_SIZES: readonly number[] = (() => {
  const N = 25;
  const lo = Math.log10(1000);
  const hi = Math.log10(10_000_000);
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    out.push(Math.pow(10, lo + (i / (N - 1)) * (hi - lo)));
  }
  return out;
})();
const EXTENDED_ORDER_LOGS: readonly number[] = EXTENDED_ORDER_SIZES.map((s) =>
  Math.log10(s),
);

interface ImpactCurveSeries {
  buys: number[];
  sells: number[];
  sampleLogs: readonly number[];
}

function computeImpactCurve(
  cards: BirdsEyePoolCard[],
  excludedOwners: Set<string>,
): ImpactCurveSeries | null {
  const inputs: RoutingPoolInput[] = [];
  for (const card of cards) {
    const input = cardToRoutingPool(card, excludedOwners);
    if (input) inputs.push(input);
  }
  if (inputs.length === 0) return null;
  const prepared = prepareRoutingPools(inputs);
  const buys: number[] = [];
  const sells: number[] = [];
  let lastBuy = 0;
  let lastSell = 0;
  for (const size of EXTENDED_ORDER_SIZES) {
    const buy = routePreparedOrderAcrossPools({
      preparedPools: prepared,
      side: "buyTracked",
      orderUsd: size,
    });
    const sell = routePreparedOrderAcrossPools({
      preparedPools: prepared,
      side: "sellTracked",
      orderUsd: size,
    });
    // When the engine reports a non-finite impact (capacity exceeded with no
    // valid quote) treat it as the previous achievable impact — a flat
    // asymptote — so the curve doesn't drop back to zero. Also enforce
    // monotone non-decreasing in case of any rounding noise: a larger order
    // can never produce a smaller impact in a static-state pool.
    let bImpact = Number.isFinite(buy.effectiveImpactPct)
      ? buy.effectiveImpactPct
      : lastBuy;
    let sImpact = Number.isFinite(sell.effectiveImpactPct)
      ? sell.effectiveImpactPct
      : lastSell;
    bImpact = Math.max(bImpact, lastBuy);
    sImpact = Math.max(sImpact, lastSell);
    buys.push(bImpact);
    sells.push(sImpact);
    lastBuy = bImpact;
    lastSell = sImpact;
  }
  return { buys, sells, sampleLogs: EXTENDED_ORDER_LOGS };
}

// ─── Components ─────────────────────────────────────────────────────────────

function fmtUsdAxis(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

function fmtUsdPriceAxis(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 1000) return `$${usd.toFixed(0)}`;
  if (usd >= 100) return `$${usd.toFixed(1)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toExponential(2)}`;
}

function LiquidityByPricePanel({
  asset,
  liquidity,
  topOwners,
  ownerColors,
  hasScenario,
  hoverPriceUsd,
}: {
  asset: string;
  liquidity: LiquidityAggregation | null;
  topOwners: string[];
  ownerColors: Map<string, string>;
  hasScenario: boolean;
  hoverPriceUsd: number | null;
}) {
  if (!liquidity || liquidity.bins.length === 0) {
    return (
      <div className="border-b border-gray-200 bg-[#F5F4EF] px-3 py-6 text-center font-mono text-[10px] text-[#86836F] dark:border-gray-700">
        No top-10 LP liquidity within ±50% of spot.
      </div>
    );
  }

  const { bins, currentPriceUsd, maxBinUsd } = liquidity;
  const N = bins.length;
  const binWidth = PLOT_W / N;
  const yScale = maxBinUsd > 0 ? LIQ_PLOT_H / maxBinUsd : 0;
  const hoverBin =
    hoverPriceUsd !== null
      ? bins.findIndex(
          (b) => hoverPriceUsd >= b.priceLowUsd && hoverPriceUsd < b.priceHighUsd,
        )
      : -1;

  // Y-axis ticks: 0, 25%, 50%, 75%, 100% of max.
  const yTicks =
    maxBinUsd > 0
      ? [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxBinUsd)
      : [0];

  // X-axis ticks: 5 evenly-spaced bins (start, 25%, 50%, 75%, end).
  const xTickIndices = [0, Math.floor(N * 0.25), Math.floor(N * 0.5), Math.floor(N * 0.75), N - 1];
  // Current-price bin index (where currentPriceUsd falls).
  const currentBinIdx = bins.findIndex(
    (b) => currentPriceUsd >= b.priceLowUsd && currentPriceUsd < b.priceHighUsd,
  );
  const currentBinX =
    currentBinIdx >= 0
      ? M_L + (currentBinIdx + 0.5) * binWidth
      : null;

  const hovered = hoverBin >= 0 ? bins[hoverBin] : null;
  const hoveredX =
    hovered && hoverPriceUsd !== null
      ? xOfPriceUsd(hoverPriceUsd, currentPriceUsd)
      : 0;

  return (
    <div className="relative border-b border-gray-200 dark:border-gray-700">
      <svg
        className="block h-auto w-full"
        viewBox={`0 0 ${VB_W} ${LIQ_VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Aggregated LP liquidity by price for ${asset}`}
      >
        {/* Plot frame */}
        <rect
          x={M_L}
          y={LIQ_M_T}
          width={PLOT_W}
          height={LIQ_PLOT_H}
          fill="#FAFAF7"
          stroke="#E2E0D6"
          strokeWidth="0.6"
        />

        {/* Y gridlines */}
        {yTicks.map((tick, i) => {
          const y = LIQ_M_T + LIQ_PLOT_H - tick * yScale;
          return (
            <g key={`liq-yt-${i}`}>
              <line
                x1={M_L}
                y1={y}
                x2={M_L + PLOT_W}
                y2={y}
                stroke="#D8D6CA"
                strokeWidth="0.4"
                strokeDasharray="3 4"
              />
              <text
                x={M_L - 6}
                y={y + 3}
                textAnchor="end"
                className="font-mono"
                fontSize="9"
                fill="#5E5B50"
              >
                {fmtUsdAxis(tick)}
              </text>
            </g>
          );
        })}
        <text
          x={M_L - 44}
          y={LIQ_M_T + LIQ_PLOT_H / 2}
          textAnchor="middle"
          className="font-mono"
          fontSize="9"
          fill="#86836F"
          letterSpacing="0.18em"
          transform={`rotate(-90, ${M_L - 44}, ${LIQ_M_T + LIQ_PLOT_H / 2})`}
        >
          LP LIQUIDITY (USD)
        </text>

        {/* Stacked bars */}
        {bins.map((bin, i) => {
          if (bin.totalUsd <= 0) return null;
          let cumUsd = 0;
          const x = M_L + i * binWidth;
          const w = Math.max(0.5, binWidth - 0.6);
          const opacity = hoverBin === null || hoverBin === i ? 0.92 : 0.55;
          const othersUsd = bin.perOwnerUsd.get(OTHERS_KEY) ?? 0;
          return (
            <g key={`liq-bin-${i}`}>
              {topOwners.map((owner) => {
                const usd = bin.perOwnerUsd.get(owner);
                if (!usd || usd <= 0) return null;
                const segH = usd * yScale;
                const segY = LIQ_M_T + LIQ_PLOT_H - (cumUsd + usd) * yScale;
                cumUsd += usd;
                return (
                  <rect
                    key={`liq-bin-${i}-${owner}`}
                    x={x}
                    y={segY}
                    width={w}
                    height={Math.max(0.4, segH)}
                    fill={ownerColors.get(owner) ?? "#8A94A4"}
                    opacity={opacity}
                  />
                );
              })}
              {othersUsd > 0 ? (
                <rect
                  key={`liq-bin-${i}-others`}
                  x={x}
                  y={LIQ_M_T + LIQ_PLOT_H - (cumUsd + othersUsd) * yScale}
                  width={w}
                  height={Math.max(0.4, othersUsd * yScale)}
                  fill={OTHERS_COLOR}
                  opacity={opacity}
                />
              ) : null}
            </g>
          );
        })}

        {/* Current-price marker */}
        {currentBinX !== null ? (
          <g>
            <line
              x1={currentBinX}
              y1={LIQ_M_T}
              x2={currentBinX}
              y2={LIQ_M_T + LIQ_PLOT_H}
              stroke="#0A0906"
              strokeWidth="0.8"
              strokeDasharray="2 3"
              opacity="0.55"
            />
            <text
              x={currentBinX}
              y={LIQ_M_T - 4}
              textAnchor="middle"
              className="font-mono"
              fontSize="8.5"
              fontWeight="700"
              fill="#0A0906"
              letterSpacing="0.06em"
            >
              spot {fmtUsdPriceAxis(currentPriceUsd)}
            </text>
          </g>
        ) : null}

        {/* X-axis ticks */}
        {xTickIndices.map((idx, i) => {
          const bin = bins[idx];
          if (!bin) return null;
          const x = M_L + (idx + 0.5) * binWidth;
          return (
            <g key={`liq-xt-${i}`}>
              <line
                x1={x}
                y1={LIQ_M_T + LIQ_PLOT_H}
                x2={x}
                y2={LIQ_M_T + LIQ_PLOT_H + 4}
                stroke="#5E5B50"
                strokeWidth="0.6"
              />
              <text
                x={x}
                y={LIQ_M_T + LIQ_PLOT_H + 14}
                textAnchor="middle"
                className="font-mono"
                fontSize="9"
                fill="#5E5B50"
              >
                {fmtUsdPriceAxis(bin.priceMidUsd)}
              </text>
            </g>
          );
        })}
        <text
          x={M_L + PLOT_W / 2}
          y={LIQ_M_T + LIQ_PLOT_H + 30}
          textAnchor="middle"
          className="font-mono"
          fontSize="9"
          fill="#86836F"
          letterSpacing="0.18em"
        >
          {asset} PRICE (USD, ±50% AROUND SPOT)
        </text>

        {/* Hover crosshair */}
        {hovered ? (
          <line
            x1={hoveredX}
            y1={LIQ_M_T}
            x2={hoveredX}
            y2={LIQ_M_T + LIQ_PLOT_H}
            stroke="#0A0906"
            strokeWidth="0.7"
            strokeDasharray="3 3"
            opacity="0.45"
          />
        ) : null}
      </svg>

      {/* Tooltip */}
      {hovered && hovered.totalUsd > 0 ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[200px] rounded border border-gray-700 bg-[#14110c]/95 px-2.5 py-2 text-[#F2F1EC] shadow-xl"
          style={{
            left: `calc(${(hoveredX / VB_W) * 100}% + 12px)`,
            top: 12,
          }}
        >
          <div className="font-mono text-[10px] font-bold tracking-wide">
            {fmtUsdPriceAxis(hovered.priceLowUsd)} → {fmtUsdPriceAxis(hovered.priceHighUsd)}
          </div>
          <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 font-mono text-[9px]">
            {topOwners
              .map((owner) => ({ owner, usd: hovered.perOwnerUsd.get(owner) ?? 0 }))
              .filter((row) => row.usd > 0)
              .sort((a, b) => b.usd - a.usd)
              .slice(0, 6)
              .map((row) => (
                <React.Fragment key={row.owner}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: ownerColors.get(row.owner) ?? "#8A94A4" }}
                    />
                    <span className="truncate" style={{ maxWidth: 110 }}>
                      {row.owner.slice(0, 6)}…{row.owner.slice(-4)}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">{fmtUsdShort(row.usd)}</span>
                </React.Fragment>
              ))}
            {(hovered.perOwnerUsd.get(OTHERS_KEY) ?? 0) > 0 ? (
              <React.Fragment key="others">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: OTHERS_COLOR }}
                  />
                  <span>Others</span>
                </span>
                <span className="text-right tabular-nums">
                  {fmtUsdShort(hovered.perOwnerUsd.get(OTHERS_KEY) ?? 0)}
                </span>
              </React.Fragment>
            ) : null}
            <span className="border-t border-[#3a352a] pt-1 font-bold uppercase tracking-wider">
              Total{hasScenario ? " · scenario" : ""}
            </span>
            <span className="border-t border-[#3a352a] pt-1 text-right font-bold tabular-nums">
              {fmtUsdShort(hovered.totalUsd)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImpactByPricePanel({
  asset,
  spotUsd,
  baseline,
  scenario,
  hoverPriceUsd,
}: {
  asset: string;
  spotUsd: number | null;
  baseline: ImpactCurveSeries;
  scenario: ImpactCurveSeries | null;
  hoverPriceUsd: number | null;
}) {
  const hasScenario = scenario !== null;

  // For each X-axis position, derive the impact required to push spot to that
  // target price, then bisect over the dense `ImpactCurveSeries` to find the
  // order size that produces it. Targets beyond the largest sampled impact
  // are unreachable for this pool set, so the curve simply ends — we never
  // extrapolate.
  const collectPoints = useCallback(
    (
      series: ImpactCurveSeries | null,
      side: "buy" | "sell",
    ): Array<[number, number]> => {
      if (!series || spotUsd === null) return [];
      const impacts = side === "buy" ? series.buys : series.sells;
      const pts: Array<[number, number]> = [];
      const N = 80;
      for (let i = 0; i <= N; i++) {
        const svgX = M_L + (i / N) * PLOT_W;
        const targetPrice = priceUsdOfX(svgX, spotUsd);
        if (side === "buy" && targetPrice <= spotUsd) continue;
        if (side === "sell" && targetPrice >= spotUsd) continue;
        const targetImpact =
          side === "buy"
            ? (targetPrice / spotUsd - 1) * 100
            : (1 - targetPrice / spotUsd) * 100;
        if (!(targetImpact > 0)) continue;
        const orderSize = orderSizeForImpact(impacts, series.sampleLogs, targetImpact);
        if (orderSize === null) continue;
        pts.push([svgX, orderSize]);
      }
      return pts;
    },
    [spotUsd],
  );

  const baselineBuyPts = useMemo(() => collectPoints(baseline, "buy"), [collectPoints, baseline]);
  const baselineSellPts = useMemo(() => collectPoints(baseline, "sell"), [collectPoints, baseline]);
  const scenarioBuyPts = useMemo(() => collectPoints(scenario, "buy"), [collectPoints, scenario]);
  const scenarioSellPts = useMemo(() => collectPoints(scenario, "sell"), [collectPoints, scenario]);

  // Fit Y axis tightly to the actual curve values, snapping to {1, 2, 5} ×
  // 10^k so the curve tops sit near the chart's top edge instead of stranded
  // halfway up an oversized decade. Default $1k–$10M when no curves plot.
  const yRange = useMemo(() => {
    const all = [
      ...baselineBuyPts,
      ...baselineSellPts,
      ...scenarioBuyPts,
      ...scenarioSellPts,
    ];
    if (all.length === 0) return { yMinUsd: 1000, yMaxUsd: 10_000_000 };
    let minOrder = Number.POSITIVE_INFINITY;
    let maxOrder = 0;
    for (const [, order] of all) {
      if (order < minOrder) minOrder = order;
      if (order > maxOrder) maxOrder = order;
    }
    if (!(minOrder > 0) || !(maxOrder > 0)) {
      return { yMinUsd: 1000, yMaxUsd: 10_000_000 };
    }
    const yMinUsd = floorToNice(minOrder);
    let yMaxUsd = ceilToNice(maxOrder);
    // Guarantee a visible range even when min and max collapse to the same
    // snap value (e.g. both end up at $1M).
    if (yMaxUsd <= yMinUsd) yMaxUsd = yMinUsd * 2;
    return { yMinUsd, yMaxUsd };
  }, [baselineBuyPts, baselineSellPts, scenarioBuyPts, scenarioSellPts]);

  const yOf = useCallback(
    (orderSize: number) =>
      yOfOrderSizeRange(orderSize, yRange.yMinUsd, yRange.yMaxUsd, IMP_PLOT_H, IMP_M_T),
    [yRange],
  );

  // Always include the bounds (so the user sees the actual snapped Y_min/Y_max
  // labels), plus any pure powers of 10 strictly between them.
  const yTicks = useMemo(() => {
    const set = new Set<number>([yRange.yMinUsd, yRange.yMaxUsd]);
    const minLog = Math.log10(yRange.yMinUsd);
    const maxLog = Math.log10(yRange.yMaxUsd);
    for (let l = Math.ceil(minLog); l <= Math.floor(maxLog); l++) {
      const v = Math.pow(10, l);
      if (v > yRange.yMinUsd && v < yRange.yMaxUsd) set.add(v);
    }
    return [...set].sort((a, b) => a - b);
  }, [yRange]);

  const baselineBuyPath = useMemo(
    () => smoothPath(baselineBuyPts.map(([x, order]) => [x, yOf(order)])),
    [baselineBuyPts, yOf],
  );
  const baselineSellPath = useMemo(
    () => smoothPath(baselineSellPts.map(([x, order]) => [x, yOf(order)])),
    [baselineSellPts, yOf],
  );
  const scenarioBuyPath = useMemo(
    () => smoothPath(scenarioBuyPts.map(([x, order]) => [x, yOf(order)])),
    [scenarioBuyPts, yOf],
  );
  const scenarioSellPath = useMemo(
    () => smoothPath(scenarioSellPts.map(([x, order]) => [x, yOf(order)])),
    [scenarioSellPts, yOf],
  );

  if (spotUsd === null) return null;

  // Tooltip lookup: same bisection so the hover number matches the curve.
  const orderSizeAt = (
    series: ImpactCurveSeries,
    side: "buy" | "sell",
  ): number | null => {
    if (hoverPriceUsd === null) return null;
    if (side === "buy" && hoverPriceUsd <= spotUsd) return null;
    if (side === "sell" && hoverPriceUsd >= spotUsd) return null;
    const target = side === "buy"
      ? (hoverPriceUsd / spotUsd - 1) * 100
      : (1 - hoverPriceUsd / spotUsd) * 100;
    if (!(target > 0)) return null;
    const impacts = side === "buy" ? series.buys : series.sells;
    return orderSizeForImpact(impacts, series.sampleLogs, target);
  };

  const baselineBuyOrder = orderSizeAt(baseline, "buy");
  const baselineSellOrder = orderSizeAt(baseline, "sell");
  const scenarioBuyOrder = scenario ? orderSizeAt(scenario, "buy") : null;
  const scenarioSellOrder = scenario ? orderSizeAt(scenario, "sell") : null;

  const hoveredX = hoverPriceUsd !== null ? xOfPriceUsd(hoverPriceUsd, spotUsd) : 0;
  const hoverOnBuySide = hoverPriceUsd !== null && hoverPriceUsd > spotUsd;
  const hoverOnSellSide = hoverPriceUsd !== null && hoverPriceUsd < spotUsd;

  return (
    <div className="relative">
      <svg
        className="block h-auto w-full"
        viewBox={`0 0 ${VB_W} ${IMP_VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Order size needed to move ${asset} price by impact`}
      >
        <rect
          x={M_L}
          y={IMP_M_T}
          width={PLOT_W}
          height={IMP_PLOT_H}
          fill="#FAFAF7"
          stroke="#E2E0D6"
          strokeWidth="0.6"
        />

        {/* Y gridlines + tick labels (log order-size, mirrored on both axes,
            scaled to the actual curve range). */}
        {yTicks.map((tick) => {
          const y = yOf(tick);
          return (
            <g key={`imp-yt-${tick}`}>
              <line
                x1={M_L}
                y1={y}
                x2={M_L + PLOT_W}
                y2={y}
                stroke="#D8D6CA"
                strokeWidth="0.4"
                strokeDasharray="3 4"
              />
              <text x={M_L - 6} y={y + 3} textAnchor="end" className="font-mono" fontSize="9" fill="#5E5B50">
                {fmtUsdShort(tick)}
              </text>
              <text x={M_L + PLOT_W + 6} y={y + 3} className="font-mono" fontSize="9" fill="#5E5B50">
                {fmtUsdShort(tick)}
              </text>
            </g>
          );
        })}
        <text
          x={M_L - 44}
          y={IMP_M_T + IMP_PLOT_H / 2}
          textAnchor="middle"
          className="font-mono"
          fontSize="9"
          fill="#86836F"
          letterSpacing="0.18em"
          transform={`rotate(-90, ${M_L - 44}, ${IMP_M_T + IMP_PLOT_H / 2})`}
        >
          ORDER SIZE (USD)
        </text>

        {/* Spot vertical reference */}
        <line
          x1={xOfPriceUsd(spotUsd, spotUsd)}
          y1={IMP_M_T}
          x2={xOfPriceUsd(spotUsd, spotUsd)}
          y2={IMP_M_T + IMP_PLOT_H}
          stroke="#0A0906"
          strokeWidth="0.6"
          strokeDasharray="2 3"
          opacity="0.45"
        />

        {/* Baseline curves (faint when scenario active) */}
        <path
          d={baselineBuyPath}
          fill="none"
          stroke={COLOR_BUY}
          strokeWidth={hasScenario ? 1 : 1.8}
          strokeOpacity={hasScenario ? 0.4 : 0.95}
          strokeDasharray={hasScenario ? "4 3" : undefined}
        />
        <path
          d={baselineSellPath}
          fill="none"
          stroke={COLOR_SELL}
          strokeWidth={hasScenario ? 1 : 1.8}
          strokeOpacity={hasScenario ? 0.4 : 0.95}
          strokeDasharray={hasScenario ? "4 3" : undefined}
        />

        {/* Scenario curves */}
        {hasScenario ? (
          <>
            <path d={scenarioBuyPath} fill="none" stroke={COLOR_BUY} strokeWidth="2.2" />
            <path d={scenarioSellPath} fill="none" stroke={COLOR_SELL} strokeWidth="2.2" />
          </>
        ) : null}

        {/* Hover crosshair */}
        {hoverPriceUsd !== null ? (
          <line
            x1={hoveredX}
            y1={IMP_M_T}
            x2={hoveredX}
            y2={IMP_M_T + IMP_PLOT_H}
            stroke="#0A0906"
            strokeWidth="0.7"
            strokeDasharray="3 3"
            opacity="0.45"
          />
        ) : null}
      </svg>

      {hoverPriceUsd !== null && (hoverOnBuySide || hoverOnSellSide) ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[200px] rounded border border-gray-700 bg-[#14110c]/95 px-2.5 py-2 text-[#F2F1EC] shadow-xl"
          style={{
            left: `calc(${(hoveredX / VB_W) * 100}% + 12px)`,
            bottom: 12,
          }}
        >
          <div className="font-mono text-[10px] font-bold tracking-wide">
            {fmtUsdPriceAxis(hoverPriceUsd)} target
            <span className="ml-1 text-[#86836F]">
              ({fmtPct(((hoverPriceUsd / spotUsd - 1) * 100) * (hoverOnBuySide ? 1 : -1))})
            </span>
          </div>
          <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 font-mono text-[9px]">
            {hoverOnBuySide ? (
              <>
                <span style={{ color: COLOR_BUY }}>BUY {asset} · base</span>
                <span className="text-right tabular-nums">
                  {baselineBuyOrder !== null ? fmtUsdShort(baselineBuyOrder) : "—"}
                </span>
                {hasScenario ? (
                  <>
                    <span style={{ color: COLOR_BUY }} className="font-bold">BUY {asset} · scenario</span>
                    <span className="text-right font-bold tabular-nums">
                      {scenarioBuyOrder !== null ? fmtUsdShort(scenarioBuyOrder) : "—"}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <span style={{ color: COLOR_SELL }}>SELL {asset} · base</span>
                <span className="text-right tabular-nums">
                  {baselineSellOrder !== null ? fmtUsdShort(baselineSellOrder) : "—"}
                </span>
                {hasScenario ? (
                  <>
                    <span style={{ color: COLOR_SELL }} className="font-bold">SELL {asset} · scenario</span>
                    <span className="text-right font-bold tabular-nums">
                      {scenarioSellOrder !== null ? fmtUsdShort(scenarioSellOrder) : "—"}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const FRAGILITY_MODEL_CACHE_TTL_MS = 2 * 60_000;
const EMPTY_LP_ROWS: BirdsEyeFragilityModel["lpRows"] = [];

type FragilityModelCacheEntry = {
  timestamp: number;
  model: BirdsEyeFragilityModel;
};

const fragilityModelCache = new Map<string, FragilityModelCacheEntry>();
let fragilityRequestSeq = 0;

function createFragilityWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("../../../workers/birds-eye-fragility.worker.ts", import.meta.url), {
    type: "module",
  });
}

function buildFragilityCacheKey(asset: string, cards: BirdsEyePoolCard[]) {
  return [
    asset,
    ...cards.map((card) => {
      let positionCount = 0;
      let liquidityTotal = 0n;
      for (const owner of card.positions) {
        positionCount += owner.positions.length;
        try {
          liquidityTotal += BigInt(owner.liquidityTotal ?? "0");
        } catch {
          // The worker still reads concrete position liquidity if this summary
          // field is unavailable or malformed.
        }
      }

      return [
        card.pool.poolKey,
        card.poolData?.sqrtPriceX96 ?? "",
        card.poolData?.tick ?? "",
        card.token0Usd ?? "",
        card.token1Usd ?? "",
        card.tvlUsd ?? "",
        card.positions.length,
        positionCount,
        liquidityTotal.toString(),
      ].join(":");
    }),
  ].join("|");
}

function getCachedFragilityModel(cacheKey: string) {
  const cached = fragilityModelCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > FRAGILITY_MODEL_CACHE_TTL_MS) {
    fragilityModelCache.delete(cacheKey);
    return null;
  }
  return cached.model;
}

function setCachedFragilityModel(cacheKey: string, model: BirdsEyeFragilityModel) {
  fragilityModelCache.set(cacheKey, { timestamp: Date.now(), model });
  if (fragilityModelCache.size > 8) {
    const oldest = fragilityModelCache.keys().next().value;
    if (oldest) fragilityModelCache.delete(oldest);
  }
}

function useFragilityBaselineModel(asset: string, cards: BirdsEyePoolCard[]) {
  const cacheKey = useMemo(() => buildFragilityCacheKey(asset, cards), [asset, cards]);
  const hasCards = cards.length > 0;
  const [model, setModel] = useState<BirdsEyeFragilityModel | null>(() => {
    if (!hasCards) return null;
    return getCachedFragilityModel(cacheKey);
  });
  const [isLoading, setIsLoading] = useState(() => hasCards && !model);

  useEffect(() => {
    if (!hasCards) {
      setModel(null);
      setIsLoading(false);
      return;
    }

    const cached = getCachedFragilityModel(cacheKey);
    if (cached) {
      setModel(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++fragilityRequestSeq;
    const worker = createFragilityWorker();
    setIsLoading(true);
    setModel(null);

    if (!worker) {
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    worker.onmessage = (event: MessageEvent<BirdsEyeFragilityWorkerResponse>) => {
      const response = event.data;
      if (cancelled || response.requestId !== requestId) return;
      worker.terminate();
      if (response.ok) {
        setCachedFragilityModel(cacheKey, response.model);
        setModel(response.model);
      }
      setIsLoading(false);
    };
    worker.onerror = () => {
      if (cancelled) return;
      worker.terminate();
      setIsLoading(false);
    };
    worker.postMessage({ requestId, asset, cards });

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [asset, cacheKey, cards, hasCards]);

  return { model, isLoading };
}

function FragilityCardPlaceholder({ asset }: { asset: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950/30">
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-900/50">
        <div className="h-4 w-full max-w-xl bp-skeleton rounded" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 bg-[#F5F4EF] p-4 lg:border-r lg:border-gray-200 dark:lg:border-gray-700">
          <div className="h-[280px] w-full bp-skeleton rounded" />
          <div className="h-[260px] w-full bp-skeleton rounded" />
        </div>
        <div className="space-y-2 bg-[#FAFAF7] p-3 dark:bg-gray-900/40">
          <div className="h-4 w-44 bp-skeleton rounded" />
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={`${asset}-lp-skeleton-${index}`} className="h-8 w-full bp-skeleton rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

function FragilityCard({
  asset,
  cards,
  spaceSlug,
}: {
  asset: string;
  cards: BirdsEyePoolCard[];
  spaceSlug?: string | null;
}) {
  const [excludedOwners, setExcludedOwners] = useState<Set<string>>(new Set());
  const [hoverPriceUsd, setHoverPriceUsd] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  const { model, isLoading: isModelLoading } = useFragilityBaselineModel(asset, cards);
  const lpRows = model?.lpRows ?? EMPTY_LP_ROWS;
  const lpTotalUsd = model?.lpTotalUsd ?? 0;
  const primaryCounter = model?.primaryCounter ?? "USD";
  const ownerColors = useMemo(() => {
    const map = new Map<string, string>();
    lpRows.forEach((row, i) => {
      map.set(row.owner, LP_COLORS[i % LP_COLORS.length]);
    });
    return map;
  }, [lpRows]);
  const topOwners = useMemo(() => lpRows.map((r) => r.owner), [lpRows]);
  const baselineLiquidity = useMemo(
    () => hydrateLiquidityAggregation(model?.liquidity ?? null),
    [model?.liquidity],
  );
  const liquidity = useMemo(
    () =>
      model && excludedOwners.size > 0
        ? buildLiquidityBins(cards, topOwners, excludedOwners)
        : baselineLiquidity,
    [baselineLiquidity, cards, excludedOwners, model, topOwners],
  );

  const baseline = model?.baseline ?? null;
  const scenario = useMemo(() => {
    if (!model || excludedOwners.size === 0) return null;
    return computeImpactSeries(cards, excludedOwners, lpTotalUsd);
  }, [cards, excludedOwners, lpTotalUsd, model]);
  // Dense routing-engine samples used only by the impact-by-price chart, so
  // its bisection has real data across the full sweep instead of a wild
  // linear extrapolation past the routing-stats sample range.
  const baselineCurve = model?.baselineCurve ?? null;
  const scenarioCurve = useMemo(() => {
    if (!model || excludedOwners.size === 0) return null;
    return computeImpactCurve(cards, excludedOwners);
  }, [cards, excludedOwners, model]);

  // Total pool TVL across the asset's pools, sourced from `card.tvlUsd` so it
  // matches what the rest of the dashboard reports (and includes LPs outside
  // the top-10 panel). This is the honest denominator for "% of pool removed".
  const totalPoolTvlUsd = model?.totalPoolTvlUsd ?? 0;

  const removedUsd = useMemo(() => {
    if (excludedOwners.size === 0) return 0;
    let sum = 0;
    for (const row of lpRows) if (excludedOwners.has(row.owner)) sum += row.tvlUsd;
    return sum;
  }, [lpRows, excludedOwners]);
  const removedPctTop10 = lpTotalUsd > 0 ? (removedUsd / lpTotalUsd) * 100 : 0;
  const removedPctPool = totalPoolTvlUsd > 0 ? (removedUsd / totalPoolTvlUsd) * 100 : 0;
  const remainingPoolTvlUsd = Math.max(0, totalPoolTvlUsd - removedUsd);

  // Impact KPIs are quoted at KPI_ORDER_SIZE_USD — index into the SIZE_SAMPLES
  // buckets, NOT the last (largest, $100k) sample.
  const baselineMaxBuy = baseline?.buys[KPI_ORDER_SIZE_INDEX] ?? 0;
  const baselineMaxSell = baseline?.sells[KPI_ORDER_SIZE_INDEX] ?? 0;
  const scenarioMaxBuy = scenario?.buys[KPI_ORDER_SIZE_INDEX] ?? baselineMaxBuy;
  const scenarioMaxSell = scenario?.sells[KPI_ORDER_SIZE_INDEX] ?? baselineMaxSell;
  const baselineMaxBuyAbs = baseline?.maxBuyOutputUsd ?? 0;
  const baselineMaxSellAbs = baseline?.maxSellOutputUsd ?? 0;
  const scenarioMaxBuyAbs = scenario?.maxBuyOutputUsd ?? baselineMaxBuyAbs;
  const scenarioMaxSellAbs = scenario?.maxSellOutputUsd ?? baselineMaxSellAbs;

  const toggleOwner = useCallback((owner: string) => {
    setExcludedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(owner)) next.delete(owner);
      else next.add(owner);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setExcludedOwners((prev) => {
      if (prev.size === lpRows.length) return new Set();
      return new Set(lpRows.map((r) => r.owner));
    });
  }, [lpRows]);
  const clearAll = useCallback(() => setExcludedOwners(new Set()), []);

  const spotUsd = liquidity?.currentPriceUsd ?? null;

  // Wrap-level hover handler — both stacked SVGs sit inside the same wrap and
  // share the SVG `viewBox` width / horizontal margins, so a single mouse-x
  // computation maps to the same price for both panels.
  const handleWrapMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (spotUsd === null) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratioX = (e.clientX - rect.left) / rect.width;
    const svgX = ratioX * VB_W;
    if (svgX < M_L || svgX > M_L + PLOT_W) {
      setHoverPriceUsd(null);
      return;
    }
    setHoverPriceUsd(priceUsdOfX(svgX, spotUsd));
  }, [spotUsd]);
  const handleWrapLeave = useCallback(() => setHoverPriceUsd(null), []);

  if (isModelLoading) return <FragilityCardPlaceholder asset={asset} />;
  if (!model || !baseline) return null;
  const hasScenario = scenario !== null;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950/30">
      <div className="flex flex-col gap-1 border-b border-gray-200 bg-gray-50 px-3 py-0.5 dark:border-gray-700 dark:bg-gray-900/50 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-900 dark:text-gray-100">
          <span>Cross-Pool Aggregate Liquidity Distribution · {asset}</span>
          <span
            className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-400 bg-white text-[10px] font-bold leading-none tracking-normal text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            title={`Toggle one or more LPs to remove their liquidity from the depth simulation. Lines are from the trader-of-${asset}'s perspective: green = BUY ${asset} (trader pays ${primaryCounter}, receives ${asset}), red = SELL ${asset} (trader pays ${asset}, receives ${primaryCounter}). Bold = scenario after removal, faint dashed = baseline. Each LP row shows the leave-one-out impact change at $25k if only that LP is removed.`}
          >
            ?
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5" title={`Trader pays ${primaryCounter}, receives ${asset}`}>
            <span className="inline-block h-[2px] w-3" style={{ background: COLOR_BUY }} />
            <span style={{ color: COLOR_BUY }} className="font-bold">BUY {asset}</span>
          </span>
          <span className="flex items-center gap-1.5" title={`Trader pays ${asset}, receives ${primaryCounter}`}>
            <span className="inline-block h-[2px] w-3" style={{ background: COLOR_SELL }} />
            <span style={{ color: COLOR_SELL }} className="font-bold">SELL {asset}</span>
          </span>
          <span className="text-[9px] tracking-[0.16em]">order size · log scale</span>
          {hasScenario ? (
            <span className="text-[9px] tracking-[0.16em] text-[#86836F]">solid · removed · dashed · baseline</span>
          ) : null}
          {hasScenario ? (
            <span
              className="rounded border border-amber-400/60 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-300"
              title={`${fmtUsdShort(removedUsd)} removed · ${removedPctPool.toFixed(1)}% of pool TVL · ${removedPctTop10.toFixed(1)}% of top-10 TVL`}
            >
              {excludedOwners.size} LP{excludedOwners.size === 1 ? "" : "s"} removed · {fmtUsdShort(removedUsd)} ({removedPctPool.toFixed(1)}% pool)
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div
          ref={wrapRef}
          className="relative bg-[#F5F4EF] lg:border-r lg:border-gray-200 dark:lg:border-gray-700"
          onMouseMove={handleWrapMove}
          onMouseLeave={handleWrapLeave}
        >
          <LiquidityByPricePanel
            asset={asset}
            liquidity={liquidity}
            topOwners={topOwners}
            ownerColors={ownerColors}
            hasScenario={hasScenario}
            hoverPriceUsd={hoverPriceUsd}
          />
          {baselineCurve ? (
            <ImpactByPricePanel
              asset={asset}
              spotUsd={spotUsd}
              baseline={baselineCurve}
              scenario={scenarioCurve}
              hoverPriceUsd={hoverPriceUsd}
            />
          ) : null}
        </div>

        {/* LP toggle panel */}
        <div className="flex flex-col bg-[#FAFAF7] dark:bg-gray-900/40">
          <div className="flex items-center justify-between border-b border-[#C8C6BB] px-3 py-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-[#5E5B50]">
              Top {Math.min(lpRows.length, TOP_LPS_PER_ASSET)} LPs · click to remove
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleAll}
                className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {excludedOwners.size === lpRows.length && lpRows.length > 0 ? "None" : "All"}
              </button>
              {excludedOwners.size > 0 ? (
                <button
                  type="button"
                  onClick={clearAll}
                  className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-[260px] flex-1 overflow-y-auto">
            {lpRows.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] font-mono text-[#86836F]">No LPs to show.</div>
            ) : (
              lpRows.map((row, index) => {
                const checked = excludedOwners.has(row.owner);
                const swatch = ownerColors.get(row.owner) ?? "#8A94A4";
                return (
                  <button
                    key={row.owner}
                    type="button"
                    onClick={() => toggleOwner(row.owner)}
                    className={cn(
                      "grid w-full grid-cols-[16px_22px_10px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#E2E0D6] px-3 py-1.5 text-left transition-colors",
                      checked
                        ? "bg-amber-50/80 hover:bg-amber-100/80 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
                        checked
                          ? "border-amber-500 bg-amber-500 text-white"
                          : "border-gray-400 bg-white dark:border-gray-600 dark:bg-gray-900"
                      )}
                    >
                      {checked ? (
                        <svg viewBox="0 0 12 12" width="9" height="9"><path d="M2 6.5 L5 9 L10 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      ) : null}
                    </span>
                    <span className="font-mono text-[9px] font-semibold text-[#86836F]">{String(index + 1).padStart(2, "0")}</span>
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-black/10"
                      style={{
                        background: swatch,
                        opacity: checked ? 0.35 : 1,
                      }}
                      aria-hidden="true"
                    />
                    <LpLabel
                      address={row.owner}
                      spaceSlug={spaceSlug}
                      showCopy={false}
                      className={cn(
                        "truncate font-mono text-[10px] font-bold",
                        checked
                          ? "text-amber-800 line-through dark:text-amber-300"
                          : "text-gray-900 dark:text-white"
                      )}
                    />
                    <span className="text-right font-mono text-[10px] tabular-nums text-[#5E5B50]">
                      {fmtUsdShort(row.tvlUsd)}
                      <span className="ml-1 text-[8px] uppercase text-[#86836F]">{row.pct.toFixed(0)}%</span>
                    </span>
                  </button>
                );
              })
            )}
            {liquidity?.hasOthers ? (
              <div
                className="grid w-full grid-cols-[16px_22px_10px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#E2E0D6] px-3 py-1.5 text-left"
                title="Aggregated liquidity from LPs outside the top 10 (not individually toggleable)."
              >
                <span aria-hidden="true" />
                <span className="font-mono text-[9px] font-semibold text-[#86836F]">··</span>
                <span
                  className="h-2.5 w-2.5 rounded-sm border border-black/10"
                  style={{ background: OTHERS_COLOR }}
                  aria-hidden="true"
                />
                <span className="truncate font-mono text-[10px] font-bold text-gray-700 dark:text-gray-300">
                  Others
                  <span className="ml-1 text-[8px] uppercase text-[#86836F]">
                    {liquidity.othersOwnerCount} LP{liquidity.othersOwnerCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-right font-mono text-[10px] tabular-nums text-[#5E5B50]">
                  {fmtUsdShort(liquidity.othersTotalUsd)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#C8C6BB] bg-[#F5F4EF] px-3 py-2.5 text-[10px] font-mono dark:bg-gray-900/30">
            <div className="min-w-0">
              <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#86836F]">Pool TVL</div>
              <div className="truncate text-[12px] font-bold tabular-nums">
                <span className="text-[#0A0906] dark:text-white">{fmtUsdShort(totalPoolTvlUsd)}</span>
                {hasScenario ? (
                  <span className="ml-1 text-[#5E5B50]">→ {fmtUsdShort(remainingPoolTvlUsd)}</span>
                ) : null}
              </div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#86836F]">Pools · Top 10</div>
              <div className="truncate text-[12px] font-bold tabular-nums text-[#0A0906] dark:text-white">
                {cards.length} · {fmtUsdShort(lpTotalUsd)}
              </div>
            </div>
            <div
              className="min-w-0"
              title={`Maximum USD value of ${asset} the pool set can give a trader buying ${asset} before being fully drained. Bounded by the pool's actual ${asset} reserves.`}
            >
              <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#86836F]">BUY {asset} depth</div>
              <div className="truncate text-[12px] font-bold tabular-nums">
                <span className="text-[#5E5B50]">{fmtUsdShort(baselineMaxBuyAbs)}</span>
                {hasScenario ? (
                  <span className="ml-1 text-[#0A0906] dark:text-white">→ {fmtUsdShort(scenarioMaxBuyAbs)}</span>
                ) : null}
              </div>
            </div>
            <div
              className="min-w-0"
              title={`Maximum USD value of ${primaryCounter} the pool set can give a trader selling ${asset} before being fully drained. Bounded by the pool's actual ${primaryCounter} reserves.`}
            >
              <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#86836F]">SELL {asset} depth</div>
              <div className="truncate text-[12px] font-bold tabular-nums">
                <span className="text-[#5E5B50]">{fmtUsdShort(baselineMaxSellAbs)}</span>
                {hasScenario ? (
                  <span className="ml-1 text-[#0A0906] dark:text-white">→ {fmtUsdShort(scenarioMaxSellAbs)}</span>
                ) : null}
              </div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#86836F]">BUY {asset} @ {KPI_ORDER_SIZE_LABEL}</div>
              <div className="truncate text-[12px] font-bold tabular-nums">
                <span className="text-[#5E5B50]">{fmtPct(baselineMaxBuy)}</span>
                {hasScenario ? (
                  <span className="ml-1 text-[#0A0906] dark:text-white">→ {fmtPct(scenarioMaxBuy)}</span>
                ) : null}
              </div>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[8px] uppercase tracking-[0.18em] text-[#86836F]">SELL {asset} @ {KPI_ORDER_SIZE_LABEL}</div>
              <div className="truncate text-[12px] font-bold tabular-nums">
                <span className="text-[#5E5B50]">{fmtPct(baselineMaxSell)}</span>
                {hasScenario ? (
                  <span className="ml-1 text-[#0A0906] dark:text-white">→ {fmtPct(scenarioMaxSell)}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface BirdsEyeLiquidityFragilityTableProps {
  pools: BirdsEyePoolCard[];
  spaceSlug?: string | null;
  enabled?: boolean;
}

export const BirdsEyeLiquidityFragilityTable = memo(function BirdsEyeLiquidityFragilityTable({
  pools,
  spaceSlug,
  enabled = true,
}: BirdsEyeLiquidityFragilityTableProps) {
  const cardsByAsset = useMemo(() => {
    const map = new Map<string, BirdsEyePoolCard[]>();
    for (const card of pools) {
      if (!card.poolData || !card.positions.length) continue;
      const arr = map.get(card.trackedAsset) ?? [];
      arr.push(card);
      map.set(card.trackedAsset, arr);
    }
    // Sort assets by total active liquidity desc
    return [...map.entries()]
      .map(([asset, cards]) => ({ asset, cards, tvl: cards.reduce((s, c) => s + c.tvlUsd, 0) }))
      .sort((a, b) => b.tvl - a.tvl);
  }, [pools]);

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const activeAsset = useMemo(() => {
    if (cardsByAsset.length === 0) return null;
    return (
      cardsByAsset.find((entry) => entry.asset === selectedAsset) ??
      cardsByAsset[0]
    );
  }, [cardsByAsset, selectedAsset]);

  if (!enabled || cardsByAsset.length === 0 || !activeAsset) return null;

  return (
    <div className="flex flex-col">
      <div className="lr-root">
        <LiquidityResilienceStyles />
        <div className="lr-tabs" role="tablist">
          {cardsByAsset.map(({ asset, cards }) => {
            const active = asset === activeAsset.asset;
            return (
              <button
                key={asset}
                type="button"
                role="tab"
                aria-selected={active}
                className={`lr-tab ${active ? "lr-tab-active" : ""}`}
                onClick={() => setSelectedAsset(asset)}
              >
                <span className="lr-tab-logo">
                  <img src={tokenIconUrl(asset)} alt={asset} draggable={false} />
                </span>
                <span className="lr-tab-info">
                  <span className="lr-tab-sym">{asset}</span>
                  <span className="lr-tab-meta">
                    <strong>{cards.length}</strong> pool{cards.length > 1 ? "s" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <FragilityCard
        key={activeAsset.asset}
        asset={activeAsset.asset}
        cards={activeAsset.cards}
        spaceSlug={spaceSlug}
      />
    </div>
  );
});

function LiquidityResilienceStyles() {
  return <style>{LIQUIDITY_RESILIENCE_CSS}</style>;
}

const LIQUIDITY_RESILIENCE_CSS = `
.lr-root {
  --lr-surface: #FAFAF7;
  --lr-surface-3: #ECEBE4;
  --lr-line: #C8C6BB;
  --lr-warn: #D49A2E;
  --lr-ink-0: #0A0906;
  --lr-ink-1: #2B2921;
  --lr-ink-2: #5E5B50;
  --lr-ink-3: #86836F;
  --lr-mono: 'JetBrains Mono', ui-monospace, monospace;
  --lr-sans: 'Inter', system-ui, sans-serif;
}
.lr-tabs {
  display: flex;
  border: 1px solid var(--lr-line);
  border-radius: 4px;
  overflow-x: auto;
  background: var(--lr-surface);
}
.lr-tab {
  flex: 1 1 0;
  min-width: 110px;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 11px;
  background: var(--lr-surface);
  border: none;
  border-right: 1px solid var(--lr-line);
  border-radius: 0;
  cursor: pointer; user-select: none;
  font-family: var(--lr-mono); color: var(--lr-ink-1);
  text-align: left;
  position: relative;
  transition: background 0.12s;
}
.lr-tab:last-child { border-right: none; }
.lr-tab:hover { background: var(--lr-surface-3); }
.lr-tab:focus-visible {
  outline: 2px solid var(--lr-warn);
  outline-offset: -2px;
}
.lr-tab-active { background: var(--lr-surface); }
.lr-tab-active::before {
  content: ''; position: absolute;
  top: 0; left: 0; right: 0; height: 3px;
  background: var(--lr-warn);
}
.lr-tab-active .lr-tab-sym { color: var(--lr-ink-0); }
.lr-tab-active .lr-tab-meta strong { color: var(--lr-ink-0); }
.lr-tab-logo {
  position: relative;
  width: 28px; height: 28px;
  flex-shrink: 0;
  background: var(--lr-surface-3);
  border: 1px solid var(--lr-line);
  border-radius: 50%;
  overflow: hidden;
}
.lr-tab-logo img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.lr-tab-info {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0; flex: 1;
}
.lr-tab-sym {
  font-family: var(--lr-sans); font-size: 13px; font-weight: 700;
  letter-spacing: -0.015em; line-height: 1.05;
  color: var(--lr-ink-0);
}
.lr-tab-meta {
  font-family: var(--lr-mono); font-feature-settings: "tnum" 1;
  font-size: 9px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--lr-ink-3);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lr-tab-meta strong {
  color: var(--lr-ink-1); font-weight: 700;
}
.lr-tab-active .lr-tab-meta { color: var(--lr-ink-2); }
.lr-tab-active .lr-tab-meta strong { color: var(--lr-ink-0); }
`;
