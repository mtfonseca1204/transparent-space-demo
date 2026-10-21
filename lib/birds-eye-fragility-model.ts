import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import {
  prepareRoutingPools,
  routePreparedOrderAcrossPools,
  ROUTING_ORDER_SIZES_USD,
  type RoutingOrderSize,
  type RoutingPoolInput,
} from "@/lib/routing-engine";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";

export const TOP_LPS_PER_ASSET = 10;
export const LIQUIDITY_PRICE_RANGE_PCT = 0.5;
export const OTHERS_KEY = "__others__";

const SIZE_SAMPLES: readonly RoutingOrderSize[] = ROUTING_ORDER_SIZES_USD;
const LIQUIDITY_BIN_COUNT = 60;
const LOG_1_0001 = Math.log(1.0001);

export interface LpRow {
  owner: string;
  tvlUsd: number;
  buySideUsd: number;
  sellSideUsd: number;
  pct: number;
}

export interface ImpactSeries {
  buys: number[];
  sells: number[];
  totalLiquidityUsd: number;
  maxBuyOutputUsd: number;
  maxSellOutputUsd: number;
}

interface OwnerSplit {
  totalUsd: number;
  buySideUsd: number;
  sellSideUsd: number;
}

export interface LiquidityBin {
  priceLowUsd: number;
  priceHighUsd: number;
  priceMidUsd: number;
  perOwnerUsd: Map<string, number>;
  totalUsd: number;
}

export interface LiquidityAggregation {
  bins: LiquidityBin[];
  currentPriceUsd: number;
  maxBinUsd: number;
  hasOthers: boolean;
  othersTotalUsd: number;
  othersOwnerCount: number;
}

export interface SerializedLiquidityBin {
  priceLowUsd: number;
  priceHighUsd: number;
  priceMidUsd: number;
  perOwnerUsd: Array<[string, number]>;
  totalUsd: number;
}

export interface SerializedLiquidityAggregation {
  bins: SerializedLiquidityBin[];
  currentPriceUsd: number;
  maxBinUsd: number;
  hasOthers: boolean;
  othersTotalUsd: number;
  othersOwnerCount: number;
}

export interface ImpactCurveSeries {
  buys: number[];
  sells: number[];
  sampleLogs: readonly number[];
}

export interface BirdsEyeFragilityModel {
  asset: string;
  lpRows: LpRow[];
  lpTotalUsd: number;
  liquidity: SerializedLiquidityAggregation | null;
  baseline: ImpactSeries | null;
  baselineCurve: ImpactCurveSeries | null;
  primaryCounter: string;
  totalPoolTvlUsd: number;
}

export type BirdsEyeFragilityWorkerRequest = {
  requestId: number;
  asset: string;
  cards: BirdsEyePoolCard[];
};

export type BirdsEyeFragilityWorkerResponse =
  | {
      requestId: number;
      ok: true;
      model: BirdsEyeFragilityModel;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };

function valuePositionsByOwner(card: BirdsEyePoolCard): Map<string, OwnerSplit> {
  const out = new Map<string, OwnerSplit>();
  const pd = card.poolData;
  if (!pd) return out;
  const sqrtPriceX96 = BigInt(pd.sqrtPriceX96);
  const t0Usd = card.token0Usd ?? 0;
  const t1Usd = card.token1Usd ?? 0;
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

export function buildLpRows(cards: BirdsEyePoolCard[]): { rows: LpRow[]; totalUsd: number } {
  const splitByOwner = new Map<string, OwnerSplit>();
  let total = 0;
  for (const card of cards) {
    const perOwner = valuePositionsByOwner(card);
    for (const [owner, split] of perOwner.entries()) {
      const existing = splitByOwner.get(owner) ?? { totalUsd: 0, buySideUsd: 0, sellSideUsd: 0 };
      existing.totalUsd += split.totalUsd;
      existing.buySideUsd += split.buySideUsd;
      existing.sellSideUsd += split.sellSideUsd;
      splitByOwner.set(owner, existing);
      total += split.totalUsd;
    }
  }
  const rows = [...splitByOwner.entries()]
    .map(([owner, s]) => ({
      owner,
      tvlUsd: s.totalUsd,
      buySideUsd: s.buySideUsd,
      sellSideUsd: s.sellSideUsd,
      pct: total > 0 ? (s.totalUsd / total) * 100 : 0,
    }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, TOP_LPS_PER_ASSET);
  return { rows, totalUsd: total };
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

export function buildLiquidityBins(
  cards: BirdsEyePoolCard[],
  topOwners: string[],
  excludedOwners: Set<string>,
): LiquidityAggregation | null {
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

export function computeImpactSeries(
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
    if (i === 0) {
      maxBuyOutputUsd = buy.maxOutputUsd;
      maxSellOutputUsd = sell.maxOutputUsd;
    }
  }
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

export function computeImpactCurve(
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

export function serializeLiquidityAggregation(
  liquidity: LiquidityAggregation | null,
): SerializedLiquidityAggregation | null {
  if (!liquidity) return null;
  return {
    ...liquidity,
    bins: liquidity.bins.map((bin) => ({
      ...bin,
      perOwnerUsd: [...bin.perOwnerUsd.entries()],
    })),
  };
}

export function hydrateLiquidityAggregation(
  liquidity: SerializedLiquidityAggregation | null,
): LiquidityAggregation | null {
  if (!liquidity) return null;
  return {
    ...liquidity,
    bins: liquidity.bins.map((bin) => ({
      ...bin,
      perOwnerUsd: new Map(bin.perOwnerUsd),
    })),
  };
}

function getPrimaryCounter(cards: BirdsEyePoolCard[]): string {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const c = card.counterAsset || "USD";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "USD";
}

export function buildFragilityModel(
  asset: string,
  cards: BirdsEyePoolCard[],
): BirdsEyeFragilityModel {
  const { rows: lpRows, totalUsd: lpTotalUsd } = buildLpRows(cards);
  const topOwners = lpRows.map((row) => row.owner);
  const liquidity = buildLiquidityBins(cards, topOwners, new Set());
  const baseline = computeImpactSeries(cards, new Set(), lpTotalUsd);
  const baselineCurve = computeImpactCurve(cards, new Set());
  const totalPoolTvlUsd = cards.reduce((s, c) => s + (c.tvlUsd ?? 0), 0);

  return {
    asset,
    lpRows,
    lpTotalUsd,
    liquidity: serializeLiquidityAggregation(liquidity),
    baseline,
    baselineCurve,
    primaryCounter: getPrimaryCounter(cards),
    totalPoolTvlUsd,
  };
}
