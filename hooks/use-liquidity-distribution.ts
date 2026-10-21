"use client";

import { useMemo } from "react";
import type { TickLiquidityData, PositionData } from "@/lib/envio-client";
import { tickToPrice } from "@/lib/envio-client";
import type { LiquidityPricingMode } from "@/stores/chart-settings-store";

export interface DistributionBar {
  minTick: number;
  maxTick: number;
  tickMid: number;
  price: number;
  priceMin: number;
  priceMax: number;
  totalValue: number;
  height: number;
  amount0: number;
  amount1: number;
  value0: number;
  value1: number;
  token0Share: number;
}

interface UseLiquidityDistributionOptions {
  // Position-based calculation (preferred - more accurate)
  allPositions?: PositionData[] | null;
  // Tick-based calculation (fallback)
  tickData?: TickLiquidityData[] | null | undefined;
  currentPrice: number;
  currentTick: number;
  currentLiquidity: string;
  token0Decimals?: number;
  token1Decimals?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  tickSpacing?: number;
  zoomLevel?: number;
  // Liquidity pricing mode: current-price vs tick-price
  liquidityPricingMode?: LiquidityPricingMode;
  // When true, each bar spans exactly one tickSpacing (real on-chain resolution).
  // When false (default), bars are aggregated to ~80 across the display range.
  useRealTickSpacing?: boolean;
}

function alignTickDown(tick: number, spacing: number): number {
  if (!spacing || spacing <= 0) return tick;
  return Math.floor(tick / spacing) * spacing;
}

function approxBigIntToNumber(v: bigint): number {
  const s = v < 0n ? (-v).toString() : v.toString();
  if (s.length <= 15) return Number(s) * (v < 0n ? -1 : 1);
  const mantissa = Number(s.slice(0, 15));
  const exponent = s.length - 15;
  const n = mantissa * Math.pow(10, exponent);
  return v < 0n ? -n : n;
}

function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

/**
 * Calculate USD value at a specific tick range from positions
 * This is the ground truth calculation - sums liquidity from all positions covering the tick
 * 
 * @param pricingMode - "current-price" uses fixed oracle prices, "tick-price" uses the BAR's tick price for all liquidity
 */
function calcValueAtTickFromPositions(
  positions: PositionData[],
  barMinTick: number,
  barMaxTick: number,
  currentTick: number,
  token0Decimals: number,
  token1Decimals: number,
  t0Usd: number | null,
  t1Usd: number | null,
  currentPrice: number,
  useUsd: boolean,
  pricingMode: LiquidityPricingMode = "current-price"
): { totalValue: number; amount0: number; amount1: number; value0: number; value1: number; isUsd: boolean } {
  let totalAmount0 = 0;
  let totalAmount1 = 0;

  for (const pos of positions) {
    const posLower = pos.tickLower;
    const posUpper = pos.tickUpper;

    const overlapMinTick = Math.max(posLower, barMinTick);
    const overlapMaxTick = Math.min(posUpper, barMaxTick);

    // Include narrow positions that overlap any part of the display bin.
    if (overlapMinTick < overlapMaxTick) {
      const posLiquidity = BigInt(pos.liquidity);
      if (posLiquidity > 0n) {
        const Lnum = Math.max(0, approxBigIntToNumber(posLiquidity));

        const sqrtA = tickToSqrtPrice(overlapMinTick);
        const sqrtB = tickToSqrtPrice(overlapMaxTick);
        const sqrtP = tickToSqrtPrice(currentTick);
        const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
        const dUp = Math.max(0, sqrtB - clamped);
        const dDown = Math.max(0, clamped - sqrtA);

        const amount0Raw =
          clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
        const amount1Raw = Lnum * dDown;

        totalAmount0 += amount0Raw / Math.pow(10, token0Decimals);
        totalAmount1 += amount1Raw / Math.pow(10, token1Decimals);
      }
    }
  }

  // Calculate values based on pricing mode
  // For tick-price mode: use the BAR's tick price (consistent for all LPs at this price level)
  let value0: number;
  let value1: number;
  let isUsd = useUsd;
  
  if (pricingMode === "tick-price") {
    // Use the BAR's tick price for token0 valuation
    const barTickMid = (barMinTick + barMaxTick) / 2;
    const barTickPrice = tickToPrice(barTickMid, token0Decimals, token1Decimals);
    
    if (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0) {
      // USD-paired pool: convert to USD using token1's USD price
      value0 = totalAmount0 * barTickPrice * t1Usd;
      value1 = totalAmount1 * t1Usd;
      isUsd = true;
    } else {
      // Non-USD pair: return in token1 units
      value0 = totalAmount0 * barTickPrice;
      value1 = totalAmount1;
      isUsd = false;
    }
  } else {
    // current-price mode: use fixed oracle prices
    value0 = useUsd ? totalAmount0 * (t0Usd ?? 0) : totalAmount0 * currentPrice;
    value1 = useUsd ? totalAmount1 * (t1Usd ?? 0) : totalAmount1;
  }
  
  const totalValue = value0 + value1;

  return {
    totalValue,
    amount0: totalAmount0,
    amount1: totalAmount1,
    value0,
    value1,
    isUsd,
  };
}

export function useLiquidityDistribution({
  allPositions,
  tickData,
  currentPrice,
  currentTick,
  currentLiquidity,
  token0Decimals = 18,
  token1Decimals = 6,
  token0UsdPrice,
  token1UsdPrice,
  tickSpacing = 1,
  zoomLevel = 2,
  liquidityPricingMode = "current-price",
  useRealTickSpacing = false,
}: UseLiquidityDistributionOptions) {
  return useMemo(() => {
    // Calculate USD prices
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
    const useUsd = t0Usd !== null && t1Usd !== null;

    // ═══════════════════════════════════════════════════════════════════════
    // POSITION-BASED CALCULATION (preferred - ground truth)
    // ═══════════════════════════════════════════════════════════════════════
    if (allPositions && allPositions.length > 0) {
      // Find tick range from positions (filter out extreme full-range positions for display)
      const DISPLAY_TICK_RANGE = 8000;
      const positionTicks: number[] = [];
      
      for (const pos of allPositions) {
        if (BigInt(pos.liquidity) > 0n) {
          // Only include ticks within reasonable range for display calculation
          const lower = Math.max(pos.tickLower, currentTick - DISPLAY_TICK_RANGE * 2);
          const upper = Math.min(pos.tickUpper, currentTick + DISPLAY_TICK_RANGE * 2);
          if (lower < upper) {
            positionTicks.push(lower, upper);
          }
        }
      }

      if (positionTicks.length === 0) {
        return {
          bars: [] as DistributionBar[],
          useUsd,
          maxTotalValue: 0,
        };
      }

      const minDataTick = Math.min(...positionTicks);
      const maxDataTick = Math.max(...positionTicks);

      // Clamp display range to ±DISPLAY_TICK_RANGE around current tick, bounded by
      // where positions actually sit. Downstream charts (LP Ranges, LP Comparison)
      // rely on bars aligning with LP positions for their bar-slicing logic.
      const displayMinTick = Math.max(minDataTick, currentTick - DISPLAY_TICK_RANGE);
      const displayMaxTick = Math.min(maxDataTick, currentTick + DISPLAY_TICK_RANGE);

      const alignedMinFull = alignTickDown(displayMinTick, tickSpacing);
      const alignedMaxFull = alignTickDown(displayMaxTick, tickSpacing) + tickSpacing;

      const fullRange = Math.max(1, alignedMaxFull - alignedMinFull);
      let alignedMin = alignedMinFull;
      let alignedMax = alignedMaxFull;
      
      if (zoomLevel > 0) {
        const spacing = Math.max(1, tickSpacing);
        const window = Math.max(spacing * 10, Math.floor(fullRange / Math.pow(2, zoomLevel)));
        const center = alignTickDown(currentTick, spacing);
        const half = Math.floor(window / 2);
        alignedMin = Math.max(alignedMinFull, alignTickDown(center - half, spacing));
        alignedMax = Math.min(
          alignedMaxFull,
          alignTickDown(center + half, spacing) + spacing
        );
        if (alignedMax <= alignedMin) alignedMax = alignedMin + spacing;
      }

      // Real-tick-spacing mode: shrink window around currentTick so bar count stays
      // readable for tight-spacing pools (tickSpacing=10 would otherwise produce 1600
      // bars across the default ±8000 display range).
      const REAL_TS_MAX_BARS = 1600;
      if (useRealTickSpacing && tickSpacing > 0) {
        const currentRange = Math.max(1, alignedMax - alignedMin);
        const maxRange = REAL_TS_MAX_BARS * tickSpacing;
        if (currentRange > maxRange) {
          const spacing = Math.max(1, tickSpacing);
          const center = alignTickDown(currentTick, spacing);
          const half = Math.floor(maxRange / 2);
          alignedMin = Math.max(alignedMinFull, alignTickDown(center - half, spacing));
          alignedMax = Math.min(
            alignedMaxFull,
            alignTickDown(center + half, spacing) + spacing
          );
          if (alignedMax <= alignedMin) alignedMax = alignedMin + spacing;
        }
      }

      const range = Math.max(1, alignedMax - alignedMin);
      const targetBars = 80;
      const rawStep = range / targetBars;
      const step =
        useRealTickSpacing && tickSpacing > 0
          ? tickSpacing
          : tickSpacing > 0
          ? Math.max(tickSpacing, Math.round(rawStep / tickSpacing) * tickSpacing)
          : Math.max(1, Math.round(rawStep));

      const bars: DistributionBar[] = [];

      for (let t = alignedMin; t < alignedMax; t += step) {
        const minTick = t;
        const maxTick = Math.min(alignedMax, t + step);
        const tickMid = (minTick + maxTick) / 2;
        const price = tickToPrice(tickMid, token0Decimals, token1Decimals);
        const priceMin = tickToPrice(minTick, token0Decimals, token1Decimals);
        const priceMax = tickToPrice(maxTick, token0Decimals, token1Decimals);

        // Calculate value from all positions (ground truth)
        const { totalValue, amount0, amount1, value0, value1, isUsd } = calcValueAtTickFromPositions(
          allPositions,
          minTick,
          maxTick,
          currentTick,
          token0Decimals,
          token1Decimals,
          t0Usd,
          t1Usd,
          currentPrice,
          useUsd,
          liquidityPricingMode
        );

        const token0Share = totalValue > 0 ? value0 / totalValue : 0;

        bars.push({
          minTick,
          maxTick,
          tickMid,
          price,
          priceMin,
          priceMax,
          totalValue,
          amount0,
          amount1,
          value0,
          value1,
          token0Share,
          height: 0,
        });
      }

      const maxTotal = bars.reduce((m, b) => (b.totalValue > m ? b.totalValue : m), 0);

      return {
        bars: bars.map((b) => ({
          ...b,
          height: maxTotal > 0 ? (b.totalValue / maxTotal) * 100 : 0,
        })),
        useUsd,
        maxTotalValue: maxTotal,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TICK-BASED CALCULATION (fallback for backwards compatibility)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Safety check for currentLiquidity
    let currentL: bigint;
    try {
      currentL = BigInt(currentLiquidity || "0");
    } catch {
      currentL = 0n;
    }
    const hasLiquidity = currentL > 0n;
    
    // For full-range positions: tickData is empty but currentLiquidity exists
    if ((!tickData || tickData.length === 0) && hasLiquidity) {
      // Generate bars around the current tick for full-range positions
      const step = useRealTickSpacing && tickSpacing > 0
        ? Math.max(1, tickSpacing)
        : Math.max(tickSpacing, 60);
      const numBars = 80;
      const halfBars = Math.floor(numBars / 2);
      const Lnum = Math.max(0, approxBigIntToNumber(currentL));
      
      const bars: DistributionBar[] = [];
      
      for (let i = -halfBars; i < halfBars; i++) {
        const minTick = currentTick + i * step;
        const maxTick = minTick + step;
        const tickMid = (minTick + maxTick) / 2;
        const price = tickToPrice(tickMid, token0Decimals, token1Decimals);
        const priceMin = tickToPrice(minTick, token0Decimals, token1Decimals);
        const priceMax = tickToPrice(maxTick, token0Decimals, token1Decimals);
        
        const sqrtA = tickToSqrtPrice(minTick);
        const sqrtB = tickToSqrtPrice(maxTick);
        const sqrtP = tickToSqrtPrice(currentTick);
        const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
        const dUp = Math.max(0, sqrtB - clamped);
        const dDown = Math.max(0, clamped - sqrtA);
        
        const amount0Raw = clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
        const amount1Raw = Lnum * dDown;
        
        const amount0 = amount0Raw / Math.pow(10, token0Decimals);
        const amount1 = amount1Raw / Math.pow(10, token1Decimals);
        
        // Calculate values based on pricing mode
        let value0: number;
        let value1: number;
        let isUsdResult = useUsd;
        
        if (liquidityPricingMode === "tick-price") {
          const tickPrice = tickToPrice(tickMid, token0Decimals, token1Decimals);
          if (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0) {
            value0 = amount0 * tickPrice * t1Usd;
            value1 = amount1 * t1Usd;
            isUsdResult = true;
          } else {
            value0 = amount0 * tickPrice;
            value1 = amount1;
            isUsdResult = false;
          }
        } else {
          value0 = useUsd ? amount0 * (t0Usd ?? 0) : amount0 * currentPrice;
          value1 = useUsd ? amount1 * (t1Usd ?? 0) : amount1;
        }
        
        const totalValue = value0 + value1;
        const token0Share = totalValue > 0 ? value0 / totalValue : 0;
        
        bars.push({
          minTick,
          maxTick,
          tickMid,
          price,
          priceMin,
          priceMax,
          totalValue,
          amount0,
          amount1,
          value0,
          value1,
          token0Share,
          height: 0,
        });
      }
      
      const maxTotal = bars.reduce((m, b) => (b.totalValue > m ? b.totalValue : m), 0);
      // Determine if result is in USD based on first bar's calculation
      const resultIsUsd = liquidityPricingMode === "tick-price" 
        ? (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0)
        : useUsd;
      return {
        bars: bars.map((b) => ({
          ...b,
          height: maxTotal > 0 ? (b.totalValue / maxTotal) * 100 : 0,
        })),
        useUsd: resultIsUsd,
        maxTotalValue: maxTotal,
      };
    }
    
    if (!tickData || tickData.length === 0) {
      return {
        bars: [] as DistributionBar[],
        useUsd: false,
        maxTotalValue: 0,
      };
    }

    // Tick-based calculation using liquidityNet prefix sums
    const sorted = [...tickData].sort((a, b) => a.tick - b.tick);
    const ticks = sorted.map((t) => t.tick);
    const nets = sorted.map((t) => BigInt(t.liquidityNet));

    const prefix: bigint[] = new Array(nets.length);
    for (let i = 0; i < nets.length; i++) {
      prefix[i] = (i === 0 ? 0n : prefix[i - 1]) + nets[i];
    }

    const upperBound = (arr: number[], x: number): number => {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    const sumNet = (loExclusive: number, hiInclusive: number): bigint => {
      if (ticks.length === 0) return 0n;
      if (hiInclusive <= loExclusive) return 0n;
      const hi = upperBound(ticks, hiInclusive) - 1;
      const lo = upperBound(ticks, loExclusive) - 1;
      if (hi < 0 || hi < lo + 1) return 0n;
      const hiSum = prefix[hi];
      const loSum = lo >= 0 ? prefix[lo] : 0n;
      return hiSum - loSum;
    };

    const liquidityAtTick = (t: number): bigint => {
      if (t === currentTick) return currentL;
      if (t < currentTick) {
        return currentL - sumNet(t, currentTick);
      }
      return currentL + sumNet(currentTick, t);
    };

    // Clamp display range to ±DISPLAY_TICK_RANGE around current tick, bounded by
    // the tick-data extent. Downstream charts rely on bars lining up with the real
    // tick data so their bar-slicing logic produces visible bars at zoom 0.
    const DISPLAY_TICK_RANGE = 8000;
    const minDataTick = ticks[0];
    const maxDataTick = ticks[ticks.length - 1];

    const displayMinTick = Math.max(minDataTick, currentTick - DISPLAY_TICK_RANGE);
    const displayMaxTick = Math.min(maxDataTick, currentTick + DISPLAY_TICK_RANGE);
    
    const alignedMinFull = alignTickDown(displayMinTick, tickSpacing);
    const alignedMaxFull = alignTickDown(displayMaxTick, tickSpacing) + tickSpacing;

    const fullRange = Math.max(1, alignedMaxFull - alignedMinFull);
    let alignedMin = alignedMinFull;
    let alignedMax = alignedMaxFull;
    if (zoomLevel > 0) {
      const spacing = Math.max(1, tickSpacing);
      const window = Math.max(spacing * 10, Math.floor(fullRange / Math.pow(2, zoomLevel)));
      const center = alignTickDown(currentTick, spacing);
      const half = Math.floor(window / 2);
      alignedMin = Math.max(alignedMinFull, alignTickDown(center - half, spacing));
      alignedMax = Math.min(
        alignedMaxFull,
        alignTickDown(center + half, spacing) + spacing
      );
      if (alignedMax <= alignedMin) alignedMax = alignedMin + spacing;
    }

    // Real-tick-spacing mode: cap bar count by shrinking the window around currentTick.
    const REAL_TS_MAX_BARS_TICK = 1600;
    if (useRealTickSpacing && tickSpacing > 0) {
      const currentRange = Math.max(1, alignedMax - alignedMin);
      const maxRange = REAL_TS_MAX_BARS_TICK * tickSpacing;
      if (currentRange > maxRange) {
        const spacing = Math.max(1, tickSpacing);
        const center = alignTickDown(currentTick, spacing);
        const half = Math.floor(maxRange / 2);
        alignedMin = Math.max(alignedMinFull, alignTickDown(center - half, spacing));
        alignedMax = Math.min(
          alignedMaxFull,
          alignTickDown(center + half, spacing) + spacing
        );
        if (alignedMax <= alignedMin) alignedMax = alignedMin + spacing;
      }
    }

    const range = Math.max(1, alignedMax - alignedMin);
    const targetBars = 80;
    const rawStep = range / targetBars;
    const step =
      useRealTickSpacing && tickSpacing > 0
        ? tickSpacing
        : tickSpacing > 0
        ? Math.max(tickSpacing, Math.round(rawStep / tickSpacing) * tickSpacing)
        : Math.max(1, Math.round(rawStep));

    const bars: DistributionBar[] = [];

    for (let t = alignedMin; t < alignedMax; t += step) {
      const minTick = t;
      const maxTick = Math.min(alignedMax, t + step);
      const tickMid = (minTick + maxTick) / 2;
      const price = tickToPrice(tickMid, token0Decimals, token1Decimals);
      const priceMin = tickToPrice(minTick, token0Decimals, token1Decimals);
      const priceMax = tickToPrice(maxTick, token0Decimals, token1Decimals);
      const innerTicks = ticks.filter((tick) => minTick < tick && tick < maxTick);
      const segmentTicks = [minTick, ...innerTicks, maxTick];

      let amount0 = 0;
      let amount1 = 0;
      let value0 = 0;
      let value1 = 0;

      for (let i = 0; i < segmentTicks.length - 1; i++) {
        const segmentMinTick = segmentTicks[i];
        const segmentMaxTick = segmentTicks[i + 1];
        if (segmentMaxTick <= segmentMinTick) continue;

        const liquidityActive = liquidityAtTick(segmentMinTick);
        const Lnum = Math.max(0, approxBigIntToNumber(liquidityActive));
        if (Lnum <= 0) continue;

        const sqrtA = tickToSqrtPrice(segmentMinTick);
        const sqrtB = tickToSqrtPrice(segmentMaxTick);
        const sqrtP = tickToSqrtPrice(currentTick);
        const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
        const dUp = Math.max(0, sqrtB - clamped);
        const dDown = Math.max(0, clamped - sqrtA);

        const amount0Raw =
          clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
        const amount1Raw = Lnum * dDown;

        const segmentAmount0 = amount0Raw / Math.pow(10, token0Decimals);
        const segmentAmount1 = amount1Raw / Math.pow(10, token1Decimals);
        amount0 += segmentAmount0;
        amount1 += segmentAmount1;
      
        if (liquidityPricingMode === "tick-price") {
          const segmentTickMid = (segmentMinTick + segmentMaxTick) / 2;
          const tickPrice = tickToPrice(segmentTickMid, token0Decimals, token1Decimals);
          if (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0) {
            value0 += segmentAmount0 * tickPrice * t1Usd;
            value1 += segmentAmount1 * t1Usd;
          } else {
            value0 += segmentAmount0 * tickPrice;
            value1 += segmentAmount1;
          }
        } else {
          value0 += useUsd ? segmentAmount0 * (t0Usd ?? 0) : segmentAmount0 * currentPrice;
          value1 += useUsd ? segmentAmount1 * (t1Usd ?? 0) : segmentAmount1;
        }
      }
      
      const totalValue = value0 + value1;
      const token0Share = totalValue > 0 ? value0 / totalValue : 0;

      bars.push({
        minTick,
        maxTick,
        tickMid,
        price,
        priceMin,
        priceMax,
        totalValue,
        amount0,
        amount1,
        value0,
        value1,
        token0Share,
        height: 0,
      });
    }

    const maxTotal = bars.reduce((m, b) => (b.totalValue > m ? b.totalValue : m), 0);
    
    // Determine if result is in USD based on pricing mode
    const resultIsUsd = liquidityPricingMode === "tick-price" 
      ? (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0)
      : useUsd;

    return {
      bars: bars.map((b) => ({
        ...b,
        height: maxTotal > 0 ? (b.totalValue / maxTotal) * 100 : 0,
      })),
      useUsd: resultIsUsd,
      maxTotalValue: maxTotal,
    };
  }, [
    allPositions,
    tickData,
    currentTick,
    currentLiquidity,
    token0Decimals,
    token1Decimals,
    tickSpacing,
    currentPrice,
    token0UsdPrice,
    token1UsdPrice,
    zoomLevel,
    liquidityPricingMode,
    useRealTickSpacing,
  ]);
}

/**
 * Helper to flatten positionsByOwner into a single array of all positions
 */
export function flattenPositions(
  positionsByOwner: { owner: string; positions: PositionData[] }[] | null | undefined
): PositionData[] {
  if (!positionsByOwner) return [];
  const result: PositionData[] = [];
  for (const ownerData of positionsByOwner) {
    result.push(...ownerData.positions);
  }
  return result;
}
