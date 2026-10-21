"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TickLiquidityData, PositionData } from "@/lib/envio-client";
import { tickToPrice } from "@/lib/envio-client";
import { useChartSettingsStore, type LiquidityPricingMode } from "@/stores/chart-settings-store";
import { normalizeSelectedLpAttribution } from "@/lib/lp-distribution-attribution";

export type LPDistributionComparisonChartHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

// Distribution bar data from LiquidityDistributionChart
export interface DistributionBar {
  minTick: number;
  maxTick: number;
  tickMid: number;
  price: number;
  priceMin: number;
  priceMax: number;
  totalValue: number;
  height: number;
}

interface LPDistributionComparisonChartProps {
  // Total distribution data from LiquidityDistributionChart (optional - if provided, use it directly)
  totalDistribution?: DistributionBar[];
  // All positions for position-based total calculation (preferred over tick-based)
  allPositions?: PositionData[] | null;
  // Fallback props for calculating distribution (used if totalDistribution not provided)
  tickData?: TickLiquidityData[];
  selectedPositions: PositionData[];
  currentPrice: number;
  currentTick: number;
  currentLiquidity?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  token0Symbol?: string;
  token1Symbol?: string;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  tickSpacing?: number;
  invertPrice?: boolean;
  normalizeAttributionToTotal?: boolean;
  selectedOwnerLabel?: string;
  useUsd?: boolean;
  className?: string;
}

function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "-";
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatUsdPrice(price: number): string {
  if (!Number.isFinite(price)) return "-";
  if (price >= 1000) return `$${(price / 1000).toFixed(1)}K`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.001) return `$${price.toFixed(6)}`;
  // Use scientific notation for very small values
  return `$${price.toExponential(2)}`;
}

function formatCompactValue(value: number, prefix = ""): string {
  if (!Number.isFinite(value) || value <= 0) return `${prefix}0`;
  if (value >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(1)}K`;
  return `${prefix}${value.toFixed(0)}`;
}

function formatFullValue(value: number, prefix = "", suffix = ""): string {
  if (!Number.isFinite(value)) return `${prefix}0${suffix}`;
  return `${prefix}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${suffix}`;
}

export const LPDistributionComparisonChart = forwardRef<
  LPDistributionComparisonChartHandle,
  LPDistributionComparisonChartProps
>(function LPDistributionComparisonChart({
  totalDistribution,
  allPositions,
  tickData,
  selectedPositions,
  currentPrice,
  currentTick,
  currentLiquidity = "0",
  token0Decimals = 18,
  token1Decimals = 6,
  token0Symbol = "token0",
  token1Symbol = "token1",
  token0UsdPrice,
  token1UsdPrice,
  tickSpacing = 1,
  invertPrice = false,
  normalizeAttributionToTotal = false,
  selectedOwnerLabel = "Selected LP",
  useUsd: useUsdProp,
  className,
}: LPDistributionComparisonChartProps, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0); // Start fully zoomed out by default

  const MAX_ZOOM = 12;

  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoomLevel((z) => Math.min(MAX_ZOOM, z + 1)),
    zoomOut: () => setZoomLevel((z) => Math.max(0, z - 1)),
    reset: () => setZoomLevel(0),
  }), []);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);

  // Get pricing mode from settings store
  const liquidityPricingMode = useChartSettingsStore((s) => s.liquidityPricingMode);
  const useRealTickSpacing = useChartSettingsStore((s) => s.useRealTickSpacing);

  // Calculate USD prices for value calculations
  const { t0Usd, t1Usd, useUsdCalc } = useMemo(() => {
    const t0 =
      typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
        ? token0UsdPrice
        : typeof token1UsdPrice === "number" &&
            Number.isFinite(token1UsdPrice) &&
            Number.isFinite(currentPrice) &&
            currentPrice > 0
          ? token1UsdPrice * currentPrice
          : null;
    const t1 =
      typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
        ? token1UsdPrice
        : typeof token0UsdPrice === "number" &&
            Number.isFinite(token0UsdPrice) &&
            Number.isFinite(currentPrice) &&
            currentPrice > 0
          ? token0UsdPrice / currentPrice
          : null;
    return { t0Usd: t0, t1Usd: t1, useUsdCalc: t0 !== null && t1 !== null };
  }, [token0UsdPrice, token1UsdPrice, currentPrice]);

  // Calculate positions' USD value at a specific tick range (bar) using the same formula
  // For tick-based pricing: uses the BAR's tick price for all liquidity at that price level
  const calcPositionsValueAtTick = (
    positions: PositionData[] | null | undefined,
    barMinTick: number,
    barMaxTick: number
  ): number => {
    if (!positions || positions.length === 0) return 0;
    
    let totalAmount0 = 0;
    let totalAmount1 = 0;
    
    for (const pos of positions) {
      const posLower = pos.tickLower;
      const posUpper = pos.tickUpper;
      const overlapMinTick = Math.max(posLower, barMinTick);
      const overlapMaxTick = Math.min(posUpper, barMaxTick);
      
      // Narrow ranges can sit inside a wider display bin. Count any real
      // overlap instead of only ranges active at the bin's first tick.
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
    
    if (liquidityPricingMode === "tick-price") {
      const barTickMid = (barMinTick + barMaxTick) / 2;
      const barTickPrice = tickToPrice(barTickMid, token0Decimals, token1Decimals);
      if (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0) {
        value0 = totalAmount0 * barTickPrice * t1Usd;
        value1 = totalAmount1 * t1Usd;
      } else {
        value0 = totalAmount0 * barTickPrice;
        value1 = totalAmount1;
      }
    } else {
      value0 = useUsdCalc ? totalAmount0 * (t0Usd ?? 0) : totalAmount0 * currentPrice;
      value1 = useUsdCalc ? totalAmount1 * (t1Usd ?? 0) : totalAmount1;
    }
    
    return value0 + value1;
  };

  const calcSelectedValueAtTick = (barMinTick: number, barMaxTick: number): number =>
    calcPositionsValueAtTick(selectedPositions, barMinTick, barMaxTick);

  // Calculate total liquidity at a tick from tick data (fallback when totalDistribution not provided)
  const getTotalLiquidityAtTick = useMemo(() => {
    if (!tickData || tickData.length === 0) return () => 0n;
    
    const sorted = [...tickData].sort((a, b) => a.tick - b.tick);
    const ticks = sorted.map((t) => t.tick);
    const nets = sorted.map((t) => BigInt(t.liquidityNet));

    const prefix: bigint[] = new Array(nets.length);
    for (let i = 0; i < nets.length; i++) {
      prefix[i] = (i === 0 ? 0n : prefix[i - 1]) + nets[i];
    }

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

    let currentL: bigint;
    try {
      currentL = BigInt(currentLiquidity || "0");
    } catch {
      currentL = 0n;
    }

    return (t: number): bigint => {
      if (t === currentTick) return currentL;
      if (t < currentTick) {
        return currentL - sumNet(t, currentTick);
      }
      return currentL + sumNet(currentTick, t);
    };
  }, [tickData, currentTick, currentLiquidity]);

  const distribution = useMemo(() => {
    // If totalDistribution is provided, use it directly for the total values
    if (totalDistribution && totalDistribution.length > 0) {
      // Apply zoom to the provided distribution
      let barsToUse = totalDistribution;
      
      if (zoomLevel > 0 && barsToUse.length > 10) {
        // Find center bar (containing currentTick)
        const centerIdx = barsToUse.findIndex(b => b.minTick <= currentTick && currentTick < b.maxTick);
        const center = centerIdx >= 0 ? centerIdx : Math.floor(barsToUse.length / 2);
        
        // Calculate window size based on zoom
        const windowSize = Math.max(10, Math.floor(barsToUse.length / Math.pow(2, zoomLevel)));
        const halfWindow = Math.floor(windowSize / 2);
        
        const start = Math.max(0, center - halfWindow);
        const end = Math.min(barsToUse.length, center + halfWindow);
        
        barsToUse = barsToUse.slice(start, end);
      }

      // For each bar, calculate selected value directly using the same USD formula
      const bars = barsToUse.map((bar) => {
        // Calculate selected LP's USD value directly (same formula as total)
        const selectedRawValue = calcSelectedValueAtTick(bar.minTick, bar.maxTick);
        const allRawValue = normalizeAttributionToTotal
          ? calcPositionsValueAtTick(allPositions, bar.minTick, bar.maxTick)
          : 0;
        const normalized = normalizeAttributionToTotal
          ? normalizeSelectedLpAttribution({
              selectedRawValue,
              allRawValue,
              fallbackTotalValue: bar.totalValue,
            })
          : null;
        const selectedValue = normalized?.selectedValue ?? selectedRawValue;
        const restValue = normalized?.otherValue ?? Math.max(0, bar.totalValue - selectedValue);
        const totalValue = normalized?.totalValue ?? bar.totalValue;
        
        return {
          ...bar,
          totalValue,
          selectedValue: Math.min(selectedValue, totalValue), // Cap at total
          restValue,
          selectedHeight: 0,
          restHeight: 0,
        };
      });

      const maxTotal = bars.reduce((m, b) => (b.totalValue > m ? b.totalValue : m), 0);

      return {
        bars: bars.map((b) => ({
          ...b,
          height: maxTotal > 0 ? (b.totalValue / maxTotal) * 100 : 0,
          selectedHeight: maxTotal > 0 ? (b.selectedValue / maxTotal) * 100 : 0,
          restHeight: maxTotal > 0 ? (b.restValue / maxTotal) * 100 : 0,
        })),
        useUsd: useUsdProp ?? true,
      };
    }

    // Fallback: calculate from tickData (original logic)
    if (!tickData || tickData.length === 0) {
      return {
        bars: [] as Array<{
          minTick: number;
          maxTick: number;
          tickMid: number;
          price: number;
          priceMin: number;
          priceMax: number;
          totalValue: number;
          selectedValue: number;
          restValue: number;
          height: number;
          selectedHeight: number;
          restHeight: number;
        }>,
        useUsd: false,
      };
    }

    const sorted = [...tickData].sort((a, b) => a.tick - b.tick);
    const ticks = sorted.map((t) => t.tick);

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

    // Default view spans ±DISPLAY_TICK_RANGE around the current tick, regardless of
    // the tick-data extent. Calculations still use the full tick dataset; this only
    // controls the visible window so the default isn't overly narrow.
    const DISPLAY_TICK_RANGE = 8000;
    const displayMinTick = currentTick - DISPLAY_TICK_RANGE;
    const displayMaxTick = currentTick + DISPLAY_TICK_RANGE;
    
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

    // Real-tick-spacing mode: cap bar count so tight-spacing pools stay readable.
    const REAL_TS_MAX_BARS_CMP = 1600;
    if (useRealTickSpacing && tickSpacing > 0) {
      const currentRange = Math.max(1, alignedMax - alignedMin);
      const maxRange = REAL_TS_MAX_BARS_CMP * tickSpacing;
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

    const bars: Array<{
      minTick: number;
      maxTick: number;
      tickMid: number;
      price: number;
      priceMin: number;
      priceMax: number;
      totalValue: number;
      selectedValue: number;
      restValue: number;
      height: number;
      selectedHeight: number;
      restHeight: number;
    }> = [];

    for (let t = alignedMin; t < alignedMax; t += step) {
      const minTick = t;
      const maxTick = Math.min(alignedMax, t + step);
      const tickMid = (minTick + maxTick) / 2;
      const price = tickToPrice(tickMid, token0Decimals, token1Decimals);
      const priceMin = tickToPrice(minTick, token0Decimals, token1Decimals);
      const priceMax = tickToPrice(maxTick, token0Decimals, token1Decimals);
      
      const totalLiquidity = getTotalLiquidityAtTick(minTick);
      const totalLiquidityNum = approxBigIntToNumber(totalLiquidity);

      const sqrtA = tickToSqrtPrice(minTick);
      const sqrtB = tickToSqrtPrice(maxTick);
      
      const calcTotalValue = (): number => {
        const Lnum = Math.max(0, totalLiquidityNum);
        const sqrtP = tickToSqrtPrice(currentTick);
        const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
        const dUp = Math.max(0, sqrtB - clamped);
        const dDown = Math.max(0, clamped - sqrtA);

        const amount0Raw =
          clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
        const amount1Raw = Lnum * dDown;

        const amount0 = amount0Raw / Math.pow(10, token0Decimals);
        const amount1 = amount1Raw / Math.pow(10, token1Decimals);

        // Calculate values based on pricing mode
        // Note: For tick-data fallback, we use the bar's tick price since we don't have per-position data
        let value0: number;
        let value1: number;
        
        if (liquidityPricingMode === "tick-price") {
          const tickPrice = tickToPrice(tickMid, token0Decimals, token1Decimals);
          if (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0) {
            value0 = amount0 * tickPrice * t1Usd;
            value1 = amount1 * t1Usd;
          } else {
            value0 = amount0 * tickPrice;
            value1 = amount1;
          }
        } else {
          value0 = useUsd ? amount0 * (t0Usd ?? 0) : amount0 * currentPrice;
          value1 = useUsd ? amount1 * (t1Usd ?? 0) : amount1;
        }
        
        return value0 + value1;
      };

      const totalValue = calcTotalValue();
      // Calculate selected LP's USD value directly
      const rawSelectedValue = calcSelectedValueAtTick(minTick, maxTick);
      const allRawValue = normalizeAttributionToTotal
        ? calcPositionsValueAtTick(allPositions, minTick, maxTick)
        : 0;
      const normalized = normalizeAttributionToTotal
        ? normalizeSelectedLpAttribution({
            selectedRawValue: rawSelectedValue,
            allRawValue,
            fallbackTotalValue: totalValue,
          })
        : null;
      const effectiveTotalValue = normalized?.totalValue ?? totalValue;
      const selectedValue = normalized?.selectedValue ?? Math.min(rawSelectedValue, effectiveTotalValue);
      const restValue = normalized?.otherValue ?? Math.max(0, totalValue - selectedValue);

      bars.push({
        minTick,
        maxTick,
        tickMid,
        price,
        priceMin,
        priceMax,
        totalValue: effectiveTotalValue,
        selectedValue,
        restValue,
        height: 0,
        selectedHeight: 0,
        restHeight: 0,
      });
    }

    const maxTotal = bars.reduce((m, b) => (b.totalValue > m ? b.totalValue : m), 0);

    return {
      bars: bars.map((b) => ({
        ...b,
        height: maxTotal > 0 ? (b.totalValue / maxTotal) * 100 : 0,
        selectedHeight: maxTotal > 0 ? (b.selectedValue / maxTotal) * 100 : 0,
        restHeight: maxTotal > 0 ? (b.restValue / maxTotal) * 100 : 0,
      })),
      // Determine if result is in USD based on pricing mode
      useUsd: liquidityPricingMode === "tick-price" 
        ? (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0)
        : useUsd,
    };
  }, [
    totalDistribution,
    allPositions,
    tickData,
    selectedPositions,
    currentTick,
    currentLiquidity,
    token0Decimals,
    token1Decimals,
    tickSpacing,
    currentPrice,
    token0UsdPrice,
    token1UsdPrice,
    zoomLevel,
    useUsdProp,
    getTotalLiquidityAtTick,
    liquidityPricingMode,
    useRealTickSpacing,
    normalizeAttributionToTotal,
  ]);

  const distributionData = distribution.bars;
  const displayDistributionData = invertPrice ? [...distributionData].reverse() : distributionData;
  const useUsd = distribution.useUsd;

  // General USD conversion for X-axis prices
  const xAxisUsd = useMemo(() => {
    const t0 = typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && token0UsdPrice > 0 ? token0UsdPrice : null;
    const t1 = typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && token1UsdPrice > 0 ? token1UsdPrice : null;
    return { canShow: t0 !== null || t1 !== null, t0, t1 };
  }, [token0UsdPrice, token1UsdPrice]);

  // Format X-axis price (USD when available, otherwise token ratio)
  const formatXAxisPrice = (price: number): string => {
    if (xAxisUsd.canShow) return formatUsdPrice(price);
    return formatPrice(price);
  };

  if (displayDistributionData.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-gray-400">No liquidity data available</p>
      </div>
    );
  }

  // Convert tick price to display price (USD when available)
  const toDisplayPrice = (p: number) => {
    if (!Number.isFinite(p) || p <= 0) return p;
    if (xAxisUsd.canShow) {
      if (!invertPrice) {
        if (xAxisUsd.t1 !== null) return p * xAxisUsd.t1;
        if (xAxisUsd.t0 !== null) return xAxisUsd.t0 / p;
      } else {
        if (xAxisUsd.t0 !== null) return xAxisUsd.t0 / p;
        if (xAxisUsd.t1 !== null) return p * xAxisUsd.t1;
      }
    }
    return invertPrice ? 1 / p : p;
  };
  const currentPriceDisplay = toDisplayPrice(currentPrice);

  const maxTotalValue = Math.max(...displayDistributionData.map(d => d.totalValue));

  const hoveredBin = hover ? displayDistributionData[hover.index] : null;

  const currentTickBarIndex = displayDistributionData.findIndex(
    (b) => b.minTick <= currentTick && currentTick < b.maxTick
  );

  const yAxisLabel =
    liquidityPricingMode === "tick-price"
      ? useUsd
        ? "Liquidity (USD @ tick price)"
        : `Liquidity (${token1Symbol} @ tick price)`
      : useUsd
        ? "Liquidity (USD)"
        : `Liquidity (${token1Symbol})`;

  return (
    <div ref={containerRef} className={cn("h-full relative flex flex-col select-none", className)}>
      {/* Legend */}
      <div className="flex items-center justify-end gap-4 text-[11px] mb-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[var(--bp-chart-primary)]" />
          <span className="text-[var(--bp-text-muted)]">{selectedOwnerLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[var(--bp-chart-primary-lighter)]" />
          <span className="text-[var(--bp-text-muted)]">Other LPs</span>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredBin && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: Math.max(8, Math.min((hover?.x ?? 0), (containerRef.current?.offsetWidth ?? 300) - 180)),
            top: Math.max(44, (hover?.y ?? 0) - 8),
          }}
        >
          <div className="bg-white/50 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3.5 py-3 min-w-[160px]">
            {/* Price range */}
            <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-gray-100">
              <span className="text-[13px] font-semibold tabular-nums text-gray-900">
                {formatXAxisPrice(toDisplayPrice(hoveredBin.priceMin))}
              </span>
              <span className="text-gray-400">→</span>
              <span className="text-[13px] font-semibold tabular-nums text-gray-900">
                {formatXAxisPrice(toDisplayPrice(hoveredBin.priceMax))}
              </span>
            </div>
            
            {/* Liquidity breakdown */}
            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-cyan-500" />
                  <span className="text-gray-500">{selectedOwnerLabel}</span>
                </div>
                <span className="font-medium tabular-nums text-gray-700">
                  {useUsd
                    ? formatFullValue(hoveredBin.selectedValue, "$")
                    : formatFullValue(hoveredBin.selectedValue, "", ` ${token1Symbol}`)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-gray-400" />
                  <span className="text-gray-500">Other LPs</span>
                </div>
                <span className="font-medium tabular-nums text-gray-700">
                  {useUsd
                    ? formatFullValue(hoveredBin.restValue, "$")
                    : formatFullValue(hoveredBin.restValue, "", ` ${token1Symbol}`)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 pt-2 mt-2 border-t border-gray-100">
                <span className="text-gray-500">Total</span>
                <span className="font-semibold tabular-nums text-gray-900">
                  {useUsd
                    ? formatFullValue(hoveredBin.totalValue, "$")
                    : formatFullValue(hoveredBin.totalValue, "", ` ${token1Symbol}`)}
                </span>
              </div>
              {hoveredBin.totalValue > 0 && hoveredBin.selectedValue > 0 && (
                <div className="flex items-center justify-between gap-4 text-[10px]">
                  <span className="text-gray-400">Share</span>
                  <span className="font-medium tabular-nums text-cyan-600">
                    {((hoveredBin.selectedValue / hoveredBin.totalValue) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 flex min-h-0">
        {/* Bars container */}
        <div className="flex-1 relative border-b border-gray-200">
          {/* Bar chart */}
          <div className="absolute inset-0 flex items-end gap-px pointer-events-none">
            {displayDistributionData.map((bin, index) => {
              const isCurrentBar = bin.minTick <= currentTick && currentTick < bin.maxTick;
              const isHovered = hover?.index === index;

              // Calculate percentages for stacked bar
              const selectedPct = bin.height > 0 ? (bin.selectedHeight / bin.height) : 0;
              const restPct = 1 - selectedPct;

              return (
                <div
                  key={index}
                  className={cn(
                    "flex-1 overflow-hidden transition-opacity",
                    isCurrentBar && "ring-2 ring-inset ring-gray-900/20"
                  )}
                  style={{
                    height: `${Math.max(0.5, bin.height)}%`,
                    opacity: isHovered ? 1 : 0.85,
                  }}
                >
                  {/* Stacked bar: Rest (other LPs) on top, Selected LP on bottom */}
                  <div className="w-full h-full flex flex-col">
                    {/* Rest portion (top) - gray (matching LiquidityDistributionChart) */}
                    <div
                      style={{ height: `${restPct * 100}%` }}
                      className={cn(
                        "w-full chart-bar-grain",
                        isCurrentBar ? "bg-gray-500" : "bg-gray-400"
                      )}
                    />
                    {/* Selected portion (bottom) - cyan/highlighted */}
                    <div
                      style={{ height: `${selectedPct * 100}%` }}
                      className={cn(
                        "w-full chart-bar-grain",
                        isCurrentBar ? "bg-cyan-600" : "bg-cyan-500"
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hover overlay for crosshair */}
          <div
            className="absolute inset-0 cursor-crosshair z-10"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const barIndex = Math.floor((x / rect.width) * displayDistributionData.length);
              const clampedIndex = Math.max(0, Math.min(displayDistributionData.length - 1, barIndex));
              setHover({ index: clampedIndex, x, y });
            }}
            onMouseLeave={() => setHover(null)}
          />

          {/* Crosshair lines */}
          {hover !== null && displayDistributionData.length > 0 && (
            <>
              {/* Vertical line */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{
                  left: `${((hover.index + 0.5) / displayDistributionData.length) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                <div className="w-px h-full" style={{ borderLeft: "1px dashed #9ca3af" }} />
              </div>
              {/* Horizontal line */}
              <div
                className="absolute left-0 right-0 pointer-events-none z-20"
                style={{
                  top: hover.y,
                  transform: "translateY(-50%)",
                }}
              >
                <div className="w-full h-px" style={{ borderTop: "1px dashed #9ca3af" }} />
              </div>
            </>
          )}
          
          {/* Current price marker (small triangle below chart) */}
          {currentTickBarIndex >= 0 && (
            <div
              className="absolute -bottom-1.5 pointer-events-none z-10"
              style={{
                left: `${((currentTickBarIndex + 0.5) / displayDistributionData.length) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[5px] border-b-gray-600" />
            </div>
          )}
        </div>

        {/* Y-axis (right side) */}
        <div className="flex flex-col pl-3 w-20 shrink-0">
          {/* Y-axis label */}
          <div className="text-[9px] text-gray-400 leading-tight mb-1">
            {yAxisLabel}
          </div>
          {/* Y-axis values */}
          <div className="flex-1 flex flex-col justify-between text-[10px] text-gray-500 tabular-nums">
            <span>{formatCompactValue(maxTotalValue, useUsd ? "$" : "")}</span>
            <span>{formatCompactValue(maxTotalValue * 0.5, useUsd ? "$" : "")}</span>
            <span>{useUsd ? "$0" : "0"}</span>
          </div>
        </div>
      </div>

      {/* X-axis - labels positioned to match bar positions (tick-based) */}
      <div className="flex items-start pt-2">
        <div className="flex-1 relative h-4">
          {(() => {
            // Calculate tick positions that correspond to 0%, 25%, 50%, 75%, 100% of the bars
            const numBars = displayDistributionData.length;
            if (numBars === 0) return null;

            // Get ticks at bar positions (bars are evenly distributed in tick space)
            const tickPositions = [0, 0.25, 0.5, 0.75, 1].map(pct => {
              const barIndex = Math.min(Math.floor(pct * numBars), numBars - 1);
              const bar = displayDistributionData[barIndex];
              // Use the midpoint tick of the bar
              return bar.tickMid ?? Math.floor((bar.minTick + bar.maxTick) / 2);
            });

            // Convert ticks to prices and create label points
            const points = tickPositions.map((tick, idx) => {
              const price = toDisplayPrice(tickToPrice(tick, token0Decimals, token1Decimals));
              const pct = idx * 25; // 0, 25, 50, 75, 100
              const isCurrent = Math.abs(tick - currentTick) < tickSpacing;
              return { pct, price, isCurrent };
            });

            // Check if current price should replace one of the labels
            const currentTickBarIndex = displayDistributionData.findIndex(
              (b) => b.minTick <= currentTick && currentTick < b.maxTick
            );
            if (currentTickBarIndex >= 0) {
              const currentPct = ((currentTickBarIndex + 0.5) / numBars) * 100;
              // Find closest label and replace if within 15%
              let closestIdx = 0;
              let closestDist = Math.abs(points[0].pct - currentPct);
              for (let i = 1; i < points.length; i++) {
                const dist = Math.abs(points[i].pct - currentPct);
                if (dist < closestDist) {
                  closestDist = dist;
                  closestIdx = i;
                }
              }
              if (closestDist < 15) {
                points[closestIdx] = {
                  pct: currentPct,
                  price: currentPriceDisplay,
                  isCurrent: true,
                };
              }
            }

            return points.map((pt, i) => (
              <span
                key={i}
                className={cn(
                  "absolute -translate-x-1/2 text-[10px] tabular-nums",
                  pt.isCurrent ? "text-gray-700 font-medium" : "text-gray-400"
                )}
                style={{ left: `${pt.pct}%` }}
              >
                {formatXAxisPrice(pt.price)}
              </span>
            ));
          })()}
        </div>
        {/* Spacer to match Y-axis width */}
        <div className="pl-3 w-20 shrink-0" />
      </div>

    </div>
  );
});
