"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TickLiquidityData, PositionData } from "@/lib/envio-client";
import { tickToPrice } from "@/lib/envio-client";
import { useChartSettingsStore, type LiquidityPricingMode } from "@/stores/chart-settings-store";

export type PriceImpactChartHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

interface PriceImpactChartProps {
  // Position-based calculation (preferred - more accurate)
  allPositions?: PositionData[] | null;
  // Tick-based calculation (fallback)
  tickData?: TickLiquidityData[] | null;
  currentPrice: number;
  currentTick: number;
  currentLiquidity: string;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0Symbol: string;
  token1Symbol: string;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  invertPrice?: boolean;
  className?: string;
}

const BI = (v: string) => BigInt(v);
const Q96 = BigInt(2) ** BigInt(96);
const MAX_TICK = 887272;

// Port of Uniswap V3 core TickMath.getSqrtRatioAtTick (exact, bigint)
function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < -MAX_TICK || tick > MAX_TICK) throw new Error("TICK");
  const absTick = tick < 0 ? -tick : tick;

  let ratio =
    (absTick & 0x1) !== 0
      ? BI("0xfffcb933bd6fad37aa2d162d1a594001")
      : BI("0x100000000000000000000000000000000");
  if ((absTick & 0x2) !== 0) ratio = (ratio * BI("0xfff97272373d413259a46990580e213a")) >> BigInt(128);
  if ((absTick & 0x4) !== 0) ratio = (ratio * BI("0xfff2e50f5f656932ef12357cf3c7fdcc")) >> BigInt(128);
  if ((absTick & 0x8) !== 0) ratio = (ratio * BI("0xffe5caca7e10e4e61c3624eaa0941cd0")) >> BigInt(128);
  if ((absTick & 0x10) !== 0) ratio = (ratio * BI("0xffcb9843d60f6159c9db58835c926644")) >> BigInt(128);
  if ((absTick & 0x20) !== 0) ratio = (ratio * BI("0xff973b41fa98c081472e6896dfb254c0")) >> BigInt(128);
  if ((absTick & 0x40) !== 0) ratio = (ratio * BI("0xff2ea16466c96a3843ec78b326b52861")) >> BigInt(128);
  if ((absTick & 0x80) !== 0) ratio = (ratio * BI("0xfe5dee046a99a2a811c461f1969c3053")) >> BigInt(128);
  if ((absTick & 0x100) !== 0) ratio = (ratio * BI("0xfcbe86c7900a88aedcffc83b479aa3a4")) >> BigInt(128);
  if ((absTick & 0x200) !== 0) ratio = (ratio * BI("0xf987a7253ac413176f2b074cf7815e54")) >> BigInt(128);
  if ((absTick & 0x400) !== 0) ratio = (ratio * BI("0xf3392b0822b70005940c7a398e4b70f3")) >> BigInt(128);
  if ((absTick & 0x800) !== 0) ratio = (ratio * BI("0xe7159475a2c29b7443b29c7fa6e889d9")) >> BigInt(128);
  if ((absTick & 0x1000) !== 0) ratio = (ratio * BI("0xd097f3bdfd2022b8845ad8f792aa5825")) >> BigInt(128);
  if ((absTick & 0x2000) !== 0) ratio = (ratio * BI("0xa9f746462d870fdf8a65dc1f90e061e5")) >> BigInt(128);
  if ((absTick & 0x4000) !== 0) ratio = (ratio * BI("0x70d869a156d2a1b890bb3df62baf32f7")) >> BigInt(128);
  if ((absTick & 0x8000) !== 0) ratio = (ratio * BI("0x31be135f97d08fd981231505542fcfa6")) >> BigInt(128);
  if ((absTick & 0x10000) !== 0) ratio = (ratio * BI("0x9aa508b5b7a84e1c677de54f3e99bc9")) >> BigInt(128);
  if ((absTick & 0x20000) !== 0) ratio = (ratio * BI("0x5d6af8dedb81196699c329225ee604")) >> BigInt(128);
  if ((absTick & 0x40000) !== 0) ratio = (ratio * BI("0x2216e584f5fa1ea926041bedfe98")) >> BigInt(128);
  if ((absTick & 0x80000) !== 0) ratio = (ratio * BI("0x48a170391f7dc42444e8fa2")) >> BigInt(128);

  if (tick > 0) ratio = ((BigInt(2) ** BigInt(256)) - BigInt(1)) / ratio;

  // Downcast from Q128.128 to Q64.96 with rounding up
  const roundBit = ratio & ((BigInt(1) << BigInt(32)) - BigInt(1));
  let sqrtPriceX96 = ratio >> BigInt(32);
  if (roundBit !== BigInt(0)) sqrtPriceX96 += BigInt(1);
  return sqrtPriceX96;
}

function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  return (a * b) / denom;
}

// amount1 for moving sqrtP up/down within a range (Q96). Returns token1 raw units.
function amount1Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity, b - a, Q96);
}

// amount0 for moving sqrtP up/down within a range (Q96). Returns token0 raw units.
function amount0Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  // (L << 96) * (b - a) / (b * a)
  return mulDiv(liquidity << BigInt(96), b - a, b * a);
}

function bigintToApproxNumber(x: bigint, decimals: number): number {
  const neg = x < BigInt(0);
  const v = neg ? -x : x;
  if (v === BigInt(0)) return 0;

  const base = BigInt(10) ** BigInt(Math.max(decimals, 0));
  const i = v / base;
  const f = v % base;

  // If integer part is huge, approximate via string to avoid Infinity / precision blowups.
  const iStr = i.toString();
  let iNum: number;
  if (iStr.length > 15) {
    const lead = Number(iStr.slice(0, 15));
    iNum = lead * 10 ** (iStr.length - 15);
  } else {
    iNum = Number(i);
  }
  const fNum = decimals > 0 ? Number(f) / Number(base) : 0;
  return (neg ? -1 : 1) * (iNum + fNum);
}


function impactPctFromSqrtPrice(currentSqrtP: bigint, sqrtP: bigint): number {
  // ratio = (sqrtP/currentSqrtP)^2
  const scale = BigInt(10) ** BigInt(18);
  const num = sqrtP * sqrtP;
  const den = currentSqrtP * currentSqrtP;
  const ratioScaled = (num * scale) / den; // 1e18
  const ratio = Number(ratioScaled) / 1e18;
  return (ratio - 1) * 100;
}

type CurvePoint = { impactPct: number; orderUsd: number };

/**
 * Calculate total liquidity at a specific tick from positions
 * This is the ground truth approach - sums liquidity from all positions covering the tick
 */
function getLiquidityAtTickFromPositions(positions: PositionData[], tick: number): bigint {
  let totalLiquidity = 0n;
  for (const pos of positions) {
    if (pos.tickLower <= tick && tick < pos.tickUpper) {
      try {
        totalLiquidity += BigInt(pos.liquidity);
      } catch {
        // ignore malformed
      }
    }
  }
  return totalLiquidity;
}

/**
 * Get all unique tick boundaries from positions (sorted)
 */
function getPositionBoundaries(positions: PositionData[]): number[] {
  const boundarySet = new Set<number>();
  for (const pos of positions) {
    if (BigInt(pos.liquidity) > 0n) {
      boundarySet.add(pos.tickLower);
      boundarySet.add(pos.tickUpper);
    }
  }
  return [...boundarySet].sort((a, b) => a - b);
}

/**
 * Generate an enriched list of ticks that combines actual boundary ticks
 * with evenly-spaced intermediate ticks for smooth curve generation.
 *
 * This ensures pools with wide-range or full-range positions still produce
 * fine-grained impact curves (tick-by-tick), not just a single giant step.
 */
function generateEnrichedTickList(
  boundaryTicks: number[],
  currentTick: number,
  direction: 'up' | 'down',
  maxPointsPerSide: number = 300,
): number[] {
  const MAX_IMPACT_PCT = 99;
  // Calculate tick extent for max impact (independent of token decimals)
  // +99%: newPrice/curPrice = 1.99 → deltaTick = log(1.99)/log(1.0001) ≈ 6876
  // -99%: newPrice/curPrice = 0.01 → deltaTick = log(0.01)/log(1.0001) ≈ -46052
  const maxTickDelta = direction === 'up'
    ? Math.ceil(Math.log(1 + MAX_IMPACT_PCT / 100) / Math.log(1.0001))
    : Math.ceil(-Math.log(1 - MAX_IMPACT_PCT / 100) / Math.log(1.0001));

  const limitTick = direction === 'up'
    ? currentTick + maxTickDelta
    : currentTick - maxTickDelta;

  const ticks = new Set<number>();

  // Add all relevant boundary ticks within range
  for (const b of boundaryTicks) {
    if (direction === 'up' && b > currentTick && b <= limitTick) ticks.add(b);
    if (direction === 'down' && b <= currentTick && b >= limitTick) ticks.add(b);
  }

  // Add evenly-spaced intermediate ticks
  const totalRange = Math.abs(limitTick - currentTick);
  const step = Math.max(1, Math.floor(totalRange / maxPointsPerSide));

  if (direction === 'up') {
    for (let t = currentTick + step; t <= limitTick; t += step) ticks.add(t);
  } else {
    for (let t = currentTick - step; t >= limitTick; t -= step) ticks.add(t);
  }

  const sorted = [...ticks].sort((a, b) => a - b);
  return direction === 'down' ? sorted.reverse() : sorted;
}

/**
 * Build impact curves using POSITION-BASED calculation (ground truth)
 *
 * IMPORTANT: Uses incremental USD accumulation with tick-based pricing.
 * Each segment's tokens are valued at the price during that segment, not the current price.
 * This correctly accounts for the fact that as a swap moves the price, the value of tokens changes.
 *
 * Uses enriched tick lists that combine position boundaries with intermediate
 * sampling ticks, ensuring fine-grained curves even for pools with wide-range
 * or full-range positions (e.g., stable-stable pairs like EURC/USDC.e).
 */
function buildImpactCurvesFromPositions(args: {
  positions: PositionData[];
  currentPrice: number;
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  liquidityPricingMode?: LiquidityPricingMode;
}): { left: CurvePoint[]; right: CurvePoint[] } {
  const {
    positions,
    currentPrice,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    liquidityPricingMode = "current-price",
  } = args;

  // Get liquidity at current tick from positions - this is the starting liquidity
  const liquidity0 = getLiquidityAtTickFromPositions(positions, currentTick);
  const hasLiquidity = liquidity0 > 0n;

  // Token1 USD price (for quote token like USDC)
  const t1Usd =
    typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
      ? token1UsdPrice
      : 1; // Default to 1 if not available (assume stablecoin)

  // Token0 USD price at current price (for "current-price" mode fallback)
  const t0UsdAtCurrent =
    typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
      ? token0UsdPrice
      : typeof token1UsdPrice === "number" &&
          Number.isFinite(token1UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token1UsdPrice * currentPrice
        : currentPrice; // Fallback to pool price ratio

  if (!hasLiquidity) {
    return { left: [], right: [] };
  }

  const currentSqrtP = BigInt(sqrtPriceX96);

  // Get tick boundaries from positions and create a set for O(1) lookup
  const boundaries = getPositionBoundaries(positions);
  const boundarySet = new Set(boundaries);

  // Generate enriched tick lists: position boundaries + intermediate sampling ticks
  const upTicks = generateEnrichedTickList(boundaries, currentTick, 'up');
  const downTicks = generateEnrichedTickList(boundaries, currentTick, 'down');

  const MAX_IMPACT_PCT = 99;

  // Helper: get the tick-implied price (token0 in terms of token1)
  const getTickPrice = (tick: number): number => {
    return tickToPrice(tick, token0Decimals, token1Decimals);
  };

  // ==========================================================================
  // Walk UP: token1 in (quote in), price increases => positive impact
  // You're selling token1 (e.g., USDC) to buy token0 (e.g., WLD)
  // Token1 has stable USD value, so we can use t1Usd directly
  // ==========================================================================
  let sqrtP = currentSqrtP;
  let L = liquidity0;
  let prevTick = currentTick;
  let cumOrderUsd = 0; // Accumulate USD incrementally
  const right: CurvePoint[] = [{ impactPct: 0, orderUsd: 0 }];

  for (const t of upTicks) {
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext <= sqrtP) continue;

    if (L > BigInt(0)) {
      // Calculate token1 delta for THIS segment
      const segmentAmount1 = amount1Delta(L, sqrtP, sqrtNext);
      const segmentAmount1Num = bigintToApproxNumber(segmentAmount1, token1Decimals);
      cumOrderUsd += segmentAmount1Num * t1Usd;
    }

    sqrtP = sqrtNext;
    prevTick = t;
    // Only recalculate liquidity at actual position boundaries (optimization)
    if (boundarySet.has(t)) {
      L = getLiquidityAtTickFromPositions(positions, t);
    }

    const impactPct = impactPctFromSqrtPrice(currentSqrtP, sqrtP);
    if (impactPct > MAX_IMPACT_PCT) {
      // Add a capped point before breaking so the curve extends to the edge
      if (Number.isFinite(cumOrderUsd)) {
        right.push({ impactPct: MAX_IMPACT_PCT, orderUsd: cumOrderUsd });
      }
      break;
    }

    if (Number.isFinite(impactPct) && Number.isFinite(cumOrderUsd)) {
      right.push({ impactPct, orderUsd: cumOrderUsd });
    }
  }

  // ==========================================================================
  // Walk DOWN: token0 in (base in), price decreases => negative impact
  // You're selling token0 (e.g., WLD) to buy token1 (e.g., USDC)
  // Token0's USD value CHANGES as price drops - must value each segment at its tick price
  // ==========================================================================
  sqrtP = currentSqrtP;
  L = liquidity0;
  prevTick = currentTick;
  cumOrderUsd = 0; // Reset for left side
  const left: CurvePoint[] = [{ impactPct: 0, orderUsd: 0 }];

  for (const t of downTicks) {
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext >= sqrtP) continue;

    if (L > BigInt(0)) {
      // Calculate token0 delta for THIS segment
      const segmentAmount0 = amount0Delta(L, sqrtP, sqrtNext);
      const segmentAmount0Num = bigintToApproxNumber(segmentAmount0, token0Decimals);

      // Value this segment's token0 at the tick's implied price
      // Use midpoint tick between prevTick and t for better accuracy
      const midTick = Math.floor((prevTick + t) / 2);

      if (liquidityPricingMode === "tick-price") {
        // Use tick-implied price: token0 price = tick price * token1 USD price
        const tickPriceAtMid = getTickPrice(midTick);
        cumOrderUsd += segmentAmount0Num * tickPriceAtMid * t1Usd;
      } else {
        // Use current oracle price (less accurate for large swaps)
        cumOrderUsd += segmentAmount0Num * t0UsdAtCurrent;
      }
    }

    sqrtP = sqrtNext;
    prevTick = t;
    // Only recalculate liquidity at actual position boundaries (optimization)
    // Use tick-1 for down walk since positions cover [tickLower, tickUpper)
    if (boundarySet.has(t)) {
      L = getLiquidityAtTickFromPositions(positions, t - 1);
    }

    const impactPct = impactPctFromSqrtPrice(currentSqrtP, sqrtP);
    if (impactPct < -MAX_IMPACT_PCT) {
      // Add a capped point before breaking so the curve extends to the edge
      if (Number.isFinite(cumOrderUsd)) {
        left.push({ impactPct: -MAX_IMPACT_PCT, orderUsd: cumOrderUsd });
      }
      break;
    }

    if (Number.isFinite(impactPct) && Number.isFinite(cumOrderUsd)) {
      left.push({ impactPct, orderUsd: cumOrderUsd });
    }
  }

  const leftSorted = left
    .filter((p) => p.impactPct <= 0)
    .sort((a, b) => a.impactPct - b.impactPct);
  const rightSorted = right
    .filter((p) => p.impactPct >= 0)
    .sort((a, b) => a.impactPct - b.impactPct);

  return { left: leftSorted, right: rightSorted };
}

/**
 * Build impact curves using TICK-BASED calculation (fallback)
 *
 * Uses enriched tick lists that combine actual liquidityNet ticks with intermediate
 * sampling ticks, ensuring fine-grained tick-by-tick curves even for pools with
 * sparse tick data or full-range positions.
 *
 * @param liquidityPricingMode - "current-price" uses oracle prices, "tick-price" uses tick's implied price
 */
function buildImpactCurvesFromTicks(args: {
  tickData: TickLiquidityData[];
  currentPrice: number;
  currentTick: number;
  currentLiquidity: string;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  liquidityPricingMode?: LiquidityPricingMode;
}): { left: CurvePoint[]; right: CurvePoint[] } {
  const {
    tickData,
    currentPrice,
    currentTick,
    currentLiquidity,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    liquidityPricingMode = "current-price",
  } = args;

  let liquidity0: bigint;
  try {
    liquidity0 = BigInt(currentLiquidity || "0");
  } catch {
    liquidity0 = 0n;
  }
  const hasLiquidity = liquidity0 > 0n;

  // USD conversion
  const t0Usd =
    typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
      ? token0UsdPrice
      : typeof token1UsdPrice === "number" &&
          Number.isFinite(token1UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token1UsdPrice * currentPrice
        : null;
  const t1Usd =
    typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
      ? token1UsdPrice
      : typeof token0UsdPrice === "number" &&
          Number.isFinite(token0UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token0UsdPrice / currentPrice
        : null;

  if (!hasLiquidity) {
    return { left: [], right: [] };
  }

  const currentSqrtP = BigInt(sqrtPriceX96);

  // Map tick -> liquidityNet
  const netByTick = new Map<number, bigint>();
  if (tickData) {
    for (const t of tickData) {
      try {
        netByTick.set(t.tick, BigInt(t.liquidityNet));
      } catch {
        // ignore malformed
      }
    }
  }

  const sortedTicks = [...netByTick.keys()].sort((a, b) => a - b);

  // Generate enriched tick lists: liquidityNet ticks + intermediate sampling ticks
  const upTicks = generateEnrichedTickList(sortedTicks, currentTick, 'up');
  const downTicks = generateEnrichedTickList(sortedTicks, currentTick, 'down');

  // Cap impact at ±99% to avoid extreme/unrealistic order sizes at -100%
  const MAX_IMPACT_PCT = 99;

  // Helper: get the tick-implied price (token0 in terms of token1)
  const getTickPrice = (tick: number): number => {
    return tickToPrice(tick, token0Decimals, token1Decimals);
  };

  // ==========================================================================
  // Walk UP: token1 in (quote in), price increases => positive impact
  // Uses incremental USD accumulation
  // ==========================================================================
  let sqrtP = currentSqrtP;
  let L = liquidity0;
  let prevTick = currentTick;
  let cumOrderUsd = 0;
  const right: CurvePoint[] = [{ impactPct: 0, orderUsd: 0 }];

  for (const t of upTicks) {
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext <= sqrtP) continue;

    if (L > BigInt(0)) {
      const segmentAmount1 = amount1Delta(L, sqrtP, sqrtNext);
      const segmentAmount1Num = bigintToApproxNumber(segmentAmount1, token1Decimals);
      cumOrderUsd += segmentAmount1Num * (t1Usd ?? 1);
    }

    sqrtP = sqrtNext;
    prevTick = t;
    // Only apply liquidityNet at actual tick boundaries (intermediate ticks have no net)
    if (netByTick.has(t)) {
      const net = netByTick.get(t)!;
      L = L + net; // crossing left->right adds liquidityNet
    }

    const impactPct = impactPctFromSqrtPrice(currentSqrtP, sqrtP);
    if (impactPct > MAX_IMPACT_PCT) {
      if (Number.isFinite(cumOrderUsd)) {
        right.push({ impactPct: MAX_IMPACT_PCT, orderUsd: cumOrderUsd });
      }
      break;
    }

    if (Number.isFinite(impactPct) && Number.isFinite(cumOrderUsd)) {
      right.push({ impactPct, orderUsd: cumOrderUsd });
    }
  }

  // ==========================================================================
  // Walk DOWN: token0 in (base in), price decreases => negative impact
  // Uses incremental USD accumulation with tick-based pricing
  // ==========================================================================
  sqrtP = currentSqrtP;
  L = liquidity0;
  prevTick = currentTick;
  cumOrderUsd = 0;
  const left: CurvePoint[] = [{ impactPct: 0, orderUsd: 0 }];

  for (const t of downTicks) {
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext >= sqrtP) continue;

    if (L > BigInt(0)) {
      const segmentAmount0 = amount0Delta(L, sqrtP, sqrtNext);
      const segmentAmount0Num = bigintToApproxNumber(segmentAmount0, token0Decimals);

      const midTick = Math.floor((prevTick + t) / 2);

      if (liquidityPricingMode === "tick-price") {
        const tickPriceAtMid = getTickPrice(midTick);
        cumOrderUsd += segmentAmount0Num * tickPriceAtMid * (t1Usd ?? 1);
      } else {
        cumOrderUsd += segmentAmount0Num * (t0Usd ?? currentPrice);
      }
    }

    sqrtP = sqrtNext;
    prevTick = t;
    // Only apply liquidityNet at actual tick boundaries
    if (netByTick.has(t)) {
      const net = netByTick.get(t)!;
      L = L - net; // crossing right->left subtracts liquidityNet
    }

    const impactPct = impactPctFromSqrtPrice(currentSqrtP, sqrtP);
    if (impactPct < -MAX_IMPACT_PCT) {
      if (Number.isFinite(cumOrderUsd)) {
        left.push({ impactPct: -MAX_IMPACT_PCT, orderUsd: cumOrderUsd });
      }
      break;
    }

    if (Number.isFinite(impactPct) && Number.isFinite(cumOrderUsd)) {
      left.push({ impactPct, orderUsd: cumOrderUsd });
    }
  }

  // left impacts are negative; ensure sort ascending (more negative -> 0)
  const leftSorted = left
    .filter((p) => p.impactPct <= 0)
    .sort((a, b) => a.impactPct - b.impactPct);
  const rightSorted = right
    .filter((p) => p.impactPct >= 0)
    .sort((a, b) => a.impactPct - b.impactPct);

  return { left: leftSorted, right: rightSorted };
}

// Zoom levels: impact range limits (symmetric around 0)
const ZOOM_LEVELS = [99, 50, 25, 10, 5, 2]; // Full range (capped at 99%) -> most zoomed

export const PriceImpactChart = forwardRef<
  PriceImpactChartHandle,
  PriceImpactChartProps
>(function PriceImpactChart({
  allPositions,
  tickData,
  currentPrice,
  currentTick,
  currentLiquidity,
  sqrtPriceX96,
  token0Decimals,
  token1Decimals,
  token0Symbol,
  token1Symbol,
  token0UsdPrice,
  token1UsdPrice,
  invertPrice = false,
  className,
}: PriceImpactChartProps, ref) {
  // Get liquidity pricing mode from settings store
  const { liquidityPricingMode } = useChartSettingsStore();
  
  // Display symbols based on invertPrice
  const displayToken0 = invertPrice ? token1Symbol : token0Symbol;
  const displayToken1 = invertPrice ? token0Symbol : token1Symbol;
  
  // General USD conversion for display prices.
  // tickToPrice returns token1/token0; we convert to USD when any token price is available.
  const xAxisUsd = useMemo(() => {
    const t0 = typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && token0UsdPrice > 0 ? token0UsdPrice : null;
    const t1 = typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && token1UsdPrice > 0 ? token1UsdPrice : null;
    return { canShow: t0 !== null || t1 !== null, t0, t1 };
  }, [token0UsdPrice, token1UsdPrice]);

  // Convert tick price (token1/token0) to USD display price
  const toUsdDisplayPrice = (p: number): number => {
    if (!Number.isFinite(p) || p <= 0) return p;
    if (!xAxisUsd.canShow) return invertPrice ? 1 / p : p;
    if (!invertPrice) {
      if (xAxisUsd.t1 !== null) return p * xAxisUsd.t1;
      if (xAxisUsd.t0 !== null) return xAxisUsd.t0 / p;
    } else {
      if (xAxisUsd.t0 !== null) return xAxisUsd.t0 / p;
      if (xAxisUsd.t1 !== null) return p * xAxisUsd.t1;
    }
    return invertPrice ? 1 / p : p;
  };
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{
    xPx: number;
    yPx: number;
    impactPct: number;
    orderUsd: number;
    side: "left" | "right";
  } | null>(null);

  // Use position-based calculation if available (preferred), otherwise fall back to tick-based
  const curves = useMemo(() => {
    // Prefer position-based calculation (ground truth)
    if (allPositions && allPositions.length > 0) {
      const result = buildImpactCurvesFromPositions({
        positions: allPositions,
        currentPrice,
        currentTick,
        sqrtPriceX96,
        token0Decimals,
        token1Decimals,
        token0UsdPrice,
        token1UsdPrice,
        liquidityPricingMode,
      });
      // If position-based produced meaningful curves, use them
      if (result.left.length > 1 || result.right.length > 1) {
        return result;
      }
      // Otherwise fall through to tick-based
    }

    // Fall back to tick-based calculation
    return buildImpactCurvesFromTicks({
      tickData: tickData ?? [],
      currentPrice,
      currentTick,
      currentLiquidity,
      sqrtPriceX96,
      token0Decimals,
      token1Decimals,
      token0UsdPrice,
      token1UsdPrice,
      liquidityPricingMode,
    });
  }, [
    allPositions,
    tickData,
    currentPrice,
    currentTick,
    currentLiquidity,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    liquidityPricingMode,
  ]);

  // Default to ±50% zoom level (index 1 in ZOOM_LEVELS array)
  const DEFAULT_ZOOM_LEVEL = 1; // ±50%

  const [zoomLevel, setZoomLevel] = useState<number>(DEFAULT_ZOOM_LEVEL);

  const effectiveZoomLevel = zoomLevel;
  const MAX_ZOOM = ZOOM_LEVELS.length - 1;

  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoomLevel((z) => Math.min(MAX_ZOOM, z + 1)),
    zoomOut: () => setZoomLevel((z) => Math.max(0, z - 1)),
    reset: () => setZoomLevel(DEFAULT_ZOOM_LEVEL),
  }), [MAX_ZOOM]);
  const impactRange = ZOOM_LEVELS[effectiveZoomLevel] ?? 99;

  // Filter points based on zoom level
  const filteredLeft = curves.left.filter((p) => Math.abs(p.impactPct) <= impactRange);
  const filteredRight = curves.right.filter((p) => Math.abs(p.impactPct) <= impactRange);
  const allPoints = [...filteredLeft, ...filteredRight];
  const maxOrder = Math.max(1, ...allPoints.map((p) => p.orderUsd));

  const W = 300;
  const H = 120;
  
  // Use zoom-based range
  const minX = -impactRange;
  const maxX = impactRange;

  const xToSvg = (impactPct: number) => ((impactPct - minX) / (maxX - minX)) * W;
  const yToSvg = (orderUsd: number) => H - (orderUsd / maxOrder) * (H - 6); // leave a bit of headroom

  const formatUsdTick = (v: number) => {
    if (!Number.isFinite(v)) return "";
    if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  };

  const formatImpact = (v: number) => {
    if (!Number.isFinite(v)) return "";
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(v === 0 ? 0 : 1)}%`;
  };

  const yTicks = [
    { label: formatUsdTick(maxOrder), y: yToSvg(maxOrder) },
    { label: formatUsdTick(maxOrder / 2), y: yToSvg(maxOrder / 2) },
    { label: "$0", y: yToSvg(0) },
  ];

  const xTicks = (() => {
    // Guard against invalid values
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || maxX <= minX) {
      return [-10, 0, 10];
    }
    
    // Generate ticks based on actual data range
    const range = maxX - minX;
    const step = range >= 80 ? 20 : range >= 40 ? 10 : 5;
    
    // Safety: ensure step is positive and limit iterations
    if (step <= 0) return [-10, 0, 10];
    
    const ticks: number[] = [];
    const start = Math.ceil(minX / step) * step;
    const maxIterations = 50; // prevent runaway loops
    let iterations = 0;
    
    for (let v = start; v <= maxX && iterations < maxIterations; v += step) {
      ticks.push(v);
      iterations++;
    }
    
    if (!ticks.includes(0) && minX < 0 && maxX > 0) ticks.push(0);
    return ticks.sort((a, b) => a - b);
  })();

  const containerRef = useRef<HTMLDivElement | null>(null);

  const candidates = useMemo(() => {
    const out: Array<{
      x: number;
      y: number;
      impactPct: number;
      orderUsd: number;
      side: "left" | "right";
    }> = [];
    for (const p of filteredLeft) {
      out.push({
        x: xToSvg(p.impactPct),
        y: yToSvg(p.orderUsd),
        impactPct: p.impactPct,
        orderUsd: p.orderUsd,
        side: "left",
      });
    }
    for (const p of filteredRight) {
      out.push({
        x: xToSvg(p.impactPct),
        y: yToSvg(p.orderUsd),
        impactPct: p.impactPct,
        orderUsd: p.orderUsd,
        side: "right",
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLeft, filteredRight, minX, maxX, maxOrder]);

  // Important: don't early-return before hooks above, or React will detect hook order changes.
  if (curves.left.length === 0 && curves.right.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-gray-400">No liquidity data yet for this pool</p>
      </div>
    );
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container || candidates.length === 0) return;

    const rect = container.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    
    // Account for padding (pt-8 = 32px)
    const chartTop = 32;
    const chartHeight = rect.height - chartTop - 40; // minus bottom axis area
    const chartYPx = yPx - chartTop;
    
    const xSvg = (xPx / rect.width) * W;

    // Find nearest point by x position - no distance threshold
    let best: (typeof candidates)[number] | null = null;
    let bestDx = Infinity;
    for (const c of candidates) {
      const dx = Math.abs(c.x - xSvg);
      if (dx < bestDx) {
        bestDx = dx;
        best = c;
      }
    }

    if (!best) {
      setHover(null);
      return;
    }

    // Determine which side based on x position relative to zero line
    const zeroX = xToSvg(0);
    const side = xSvg < zeroX ? "left" : "right";
    
    // Find the nearest point on the correct side
    const sideCandidates = candidates.filter(c => c.side === side);
    if (sideCandidates.length > 0) {
      best = sideCandidates.reduce((nearest, c) => {
        const dx = Math.abs(c.x - xSvg);
        const nearestDx = Math.abs(nearest.x - xSvg);
        return dx < nearestDx ? c : nearest;
      }, sideCandidates[0]);
    }

    setHover({
      xPx,
      yPx: Math.max(chartTop, Math.min(yPx, chartTop + chartHeight)),
      impactPct: best.impactPct,
      orderUsd: best.orderUsd,
      side: best.side,
    });
  };

  const onMouseLeave = () => setHover(null);

  const buildAreaPath = (pts: CurvePoint[]) => {
    if (pts.length < 2) return "";
    const first = pts[0];
    const last = pts[pts.length - 1];
    const startX = xToSvg(first.impactPct);
    const endX = xToSvg(last.impactPct);
    const lines = pts
      .map((p) => `L ${xToSvg(p.impactPct)},${yToSvg(p.orderUsd)}`)
      .join(" ");
    return `M ${startX},${H} ${lines} L ${endX},${H} Z`;
  };

  const buildLinePath = (pts: CurvePoint[]) => {
    if (pts.length < 2) return "";
    const [first, ...rest] = pts;
    return `M ${xToSvg(first.impactPct)},${yToSvg(first.orderUsd)} ${rest
      .map((p) => `L ${xToSvg(p.impactPct)},${yToSvg(p.orderUsd)}`)
      .join(" ")}`;
  };

  const leftArea = buildAreaPath(filteredLeft);
  const rightArea = buildAreaPath(filteredRight);
  const leftLine = buildLinePath(filteredLeft);
  const rightLine = buildLinePath(filteredRight);

  return (
    <div 
      ref={containerRef}
      className={cn("relative h-full w-full pt-10 cursor-crosshair", className)}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full pointer-events-none"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Right curve: token1 sale → get token0 (e.g., USDC → WLD) - gray like WLD */}
          <linearGradient id="impactGradientRight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#9ca3af" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#9ca3af" stopOpacity="0.05" />
          </linearGradient>
          {/* Left curve: token0 sale → get token1 (e.g., WLD → USDC) - blue like USDC */}
          <linearGradient id="impactGradientLeft" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
          </linearGradient>
          {/* Glow filter for lines */}
          <filter id="lineGlowPI" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Subtle radial gradient for chart background */}
          <radialGradient id="chartBgGradientPI" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="var(--bp-accent-primary)" stopOpacity="0.02" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          {/* Crosshair glow */}
          <filter id="crosshairGlowPI" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle background gradient */}
        <rect x={0} y={0} width={W} height={H} fill="url(#chartBgGradientPI)" />

        {/* Center vertical line (0% impact) */}
        <line x1={xToSvg(0)} y1={0} x2={xToSvg(0)} y2={H} stroke="var(--bp-border-secondary)" strokeWidth="0.5" strokeDasharray="4 2" opacity="0.5" />

        {/* Y ticks with blueprint styling */}
        {yTicks.map((t) => (
          <g key={t.label + t.y}>
            <line x1={0} y1={t.y} x2={W} y2={t.y} stroke="var(--bp-border-subtle)" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.4" />
            {/* Small tick mark on Y-axis */}
            <line x1={-4} y1={t.y} x2={0} y2={t.y} stroke="var(--bp-text-muted)" strokeWidth="0.5" opacity="0.6" />
          </g>
        ))}

        {/* Areas */}
        {leftArea && <path d={leftArea} fill="url(#impactGradientLeft)" />}
        {rightArea && <path d={rightArea} fill="url(#impactGradientRight)" />}

        {/* Lines - clean sober styling */}
        {leftLine && (
          <path 
            d={leftLine} 
            fill="none" 
            stroke="#3b82f6" 
            strokeWidth="0.5" 
            opacity="0.8" 
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {rightLine && (
          <path 
            d={rightLine} 
            fill="none" 
            stroke="#9ca3af" 
            strokeWidth="0.5" 
            opacity="0.7" 
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data point markers along the curves - subtle */}
        {filteredLeft.filter((_, i) => i % 6 === 0).map((p, i) => (
          <circle
            key={`left-point-${i}`}
            cx={xToSvg(p.impactPct)}
            cy={yToSvg(p.orderUsd)}
            r="1"
            fill="#3b82f6"
            opacity="0.3"
          />
        ))}
        {filteredRight.filter((_, i) => i % 6 === 0).map((p, i) => (
          <circle
            key={`right-point-${i}`}
            cx={xToSvg(p.impactPct)}
            cy={yToSvg(p.orderUsd)}
            r="1"
            fill="#9ca3af"
            opacity="0.3"
          />
        ))}

        {/* Hover crosshair - minimal slick style */}
        {hover && (
          <g>
            {/* Vertical tracking line */}
            <line
              x1={(hover.xPx / (svgRef.current?.getBoundingClientRect().width || 1)) * W}
              y1={0}
              x2={(hover.xPx / (svgRef.current?.getBoundingClientRect().width || 1)) * W}
              y2={H}
              stroke="var(--bp-text-muted)"
              strokeWidth="0.5"
              strokeDasharray="3 2"
              opacity="0.4"
            />
            {/* Horizontal tracking line */}
            <line
              x1={0}
              y1={yToSvg(hover.orderUsd)}
              x2={xToSvg(hover.impactPct)}
              y2={yToSvg(hover.orderUsd)}
              stroke="var(--bp-text-muted)"
              strokeWidth="0.5"
              strokeDasharray="3 2"
              opacity="0.4"
            />
            {/* Premium minimal cross at hover point */}
            <g>
              <line 
                x1={xToSvg(hover.impactPct) - 3} 
                y1={yToSvg(hover.orderUsd)} 
                x2={xToSvg(hover.impactPct) + 3} 
                y2={yToSvg(hover.orderUsd)} 
                stroke={hover.side === "right" ? "#9ca3af" : "#3b82f6"} 
                strokeWidth="0.5"
              />
              <line 
                x1={xToSvg(hover.impactPct)} 
                y1={yToSvg(hover.orderUsd) - 3} 
                x2={xToSvg(hover.impactPct)} 
                y2={yToSvg(hover.orderUsd) + 3} 
                stroke={hover.side === "right" ? "#9ca3af" : "#3b82f6"} 
                strokeWidth="0.5"
              />
            </g>
          </g>
        )}
      </svg>

      {/* Hover popover - clean minimal style */}
      {hover && containerRef.current && (() => {
        // Calculate end price: price after the swap
        // Impact is the % change in price, so endPrice = currentPrice * (1 + impact/100)
        const rawEndPrice = currentPrice * (1 + hover.impactPct / 100);
        
        // Convert to display price (USD when available)
        const endPrice = toUsdDisplayPrice(rawEndPrice);
        const displayCurrentPriceValue = toUsdDisplayPrice(currentPrice);

        // Slippage in absolute terms (price difference)
        const slippage = Math.abs(endPrice - displayCurrentPriceValue);

        const formatPriceValue = (v: number) => {
          if (!Number.isFinite(v)) return "—";
          if (xAxisUsd.canShow) {
            if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
            if (v >= 1) return `$${v.toFixed(2)}`;
            if (v >= 0.01) return `$${v.toFixed(4)}`;
            if (v >= 0.001) return `$${v.toFixed(6)}`;
            return `$${v.toExponential(3)}`;
          }
          if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
          if (v >= 1) return v.toFixed(4);
          if (v >= 0.0001) return v.toFixed(6);
          return v.toExponential(4);
        };
        
        // Color based on end token: right side = token0/WLD (gray), left side = token1/USDC (blue)
        const endTokenColor = hover.side === "right" ? "#9ca3af" : "#3b82f6";
        
        return (
          <div
            className="pointer-events-none absolute z-20 border bg-[var(--bp-bg-card)]/50 px-2.5 py-1.5 text-[10px] font-mono backdrop-blur-sm"
            style={{
              left: Math.min(Math.max(hover.xPx + 12, 8), containerRef.current!.offsetWidth - 130),
              top: Math.min(Math.max(hover.yPx - 80, 8), containerRef.current!.offsetHeight - 120),
              borderColor: endTokenColor,
            }}
          >
            <div className="font-medium" style={{ color: endTokenColor }}>{formatImpact(hover.impactPct)}</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-[var(--bp-text-muted)]">Order</span>
              <span className="text-[var(--bp-text-primary)]">{formatUsdTick(hover.orderUsd)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-3">
              <span className="text-[var(--bp-text-muted)]">{xAxisUsd.canShow ? "Price" : "End"}</span>
              <span style={{ color: endTokenColor }}>{formatPriceValue(endPrice)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-3">
              <span className="text-[var(--bp-text-muted)]">Slip</span>
              <span className="text-[var(--bp-text-primary)]">{formatPriceValue(slippage)}</span>
            </div>
            <div className="mt-1 text-[8px] border-t pt-1" style={{ color: endTokenColor, borderColor: `${endTokenColor}40` }}>
              {hover.side === "right"
                ? `${displayToken1} → ${displayToken0}`
                : `${displayToken0} → ${displayToken1}`}
            </div>
          </div>
        );
      })()}

      {/* X-axis ticks - blueprint styled */}
      <div className="absolute bottom-2 left-0 right-0 px-2 text-[10px] text-[var(--bp-text-muted)] font-mono">
        <div className="relative w-full h-4">
          {xTicks.map((v) => (
            <span
              key={v}
              className="absolute -translate-x-1/2"
              style={{ left: `${((v - minX) / (maxX - minX)) * 100}%` }}
            >
              {v === 0 ? "0" : `${v}%`}
            </span>
          ))}
        </div>
      </div>

      {/* Axis labels - blueprint styled */}
      {/* Y-axis tick labels (left) */}
      <div className="absolute top-8 left-0 bottom-8 w-14 text-[10px] text-[var(--bp-text-muted)] font-mono">
        <div className="relative h-full">
          {yTicks.map((t) => (
            <div
              key={t.label}
              className="absolute left-1 -translate-y-1/2"
              style={{ top: `${(t.y / H) * 100}%` }}
            >
              {t.label}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute top-8 -left-6 bottom-8 w-6 flex items-center justify-center">
        <div className="-rotate-90 text-[9px] text-[var(--bp-text-muted)] whitespace-nowrap font-mono">Order (USD)</div>
      </div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-5 text-[10px] text-[var(--bp-text-muted)] font-mono">
        Price Impact
      </div>

      {/* Legend - clean minimal style */}
      <div className="absolute top-1 right-2 flex items-center gap-3 text-[9px] text-[var(--bp-text-muted)] font-mono">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-0.5 bg-[#9ca3af]" />
          <span>{displayToken0} sell</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-0.5 bg-[var(--bp-text-primary)]" />
          <span>{displayToken1} sell</span>
        </div>
      </div>
    </div>
  );
});
