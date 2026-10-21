"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PositionData } from "@/lib/envio-client";
import { tickToPrice } from "@/lib/envio-client";
import { LP_COLORS, OTHERS_COLOR } from "@/components/custom-metrics/metric-colors";
import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";
import { useChartSettingsStore, type LiquidityPricingMode } from "@/stores/chart-settings-store";

export type LPRangesByAddressChartHandle = {
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

interface OwnerPositions {
  owner: string;
  positions: PositionData[];
}

interface LPRangesByAddressChartProps {
  // Total distribution data from LiquidityDistributionChart
  totalDistribution: DistributionBar[];
  positionsByOwner: OwnerPositions[];
  currentPrice: number;
  currentTick: number;
  token0Decimals?: number;
  token1Decimals?: number;
  token0Symbol?: string;
  token1Symbol?: string;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  tickSpacing?: number;
  invertPrice?: boolean;
  spaceSlug?: string | null;
  className?: string;
}

function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

function approxBigIntToNumber(v: bigint): number {
  const s = v < 0n ? (-v).toString() : v.toString();
  if (s.length <= 15) return Number(s) * (v < 0n ? -1 : 1);
  const mantissa = Number(s.slice(0, 15));
  const exponent = s.length - 15;
  const n = mantissa * Math.pow(10, exponent);
  return v < 0n ? -n : n;
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

const MAX_VISIBLE_LPS = 20;

interface LPInfo {
  id: string;
  owner: string;
  color: string;
  totalUsd: number;
}

interface BarSegment {
  lpId: string;
  owner: string;
  value: number;
  color: string;
}

interface TickBucket {
  minTick: number;
  maxTick: number;
  tickMid: number;
  price: number;
  priceMin: number;
  priceMax: number;
  totalValue: number;
  segments: BarSegment[];
  height: number;
}

export const LPRangesByAddressChart = forwardRef<
  LPRangesByAddressChartHandle,
  LPRangesByAddressChartProps
>(function LPRangesByAddressChart({
  totalDistribution,
  positionsByOwner,
  currentPrice,
  currentTick,
  token0Decimals = 18,
  token1Decimals = 6,
  token0Symbol = "token0",
  token1Symbol = "token1",
  token0UsdPrice,
  token1UsdPrice,
  tickSpacing = 1,
  invertPrice = false,
  spaceSlug,
  className,
}: LPRangesByAddressChartProps, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);

  const MAX_ZOOM = 12;

  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoomLevel((z) => Math.min(MAX_ZOOM, z + 1)),
    zoomOut: () => setZoomLevel((z) => Math.max(0, z - 1)),
    reset: () => setZoomLevel(0),
  }), []);
  
  // Get pricing mode from settings store
  const liquidityPricingMode = useChartSettingsStore((s) => s.liquidityPricingMode);

  // Calculate USD prices
  const { t0Usd, t1Usd, useUsd } = useMemo(() => {
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
    return { t0Usd: t0, t1Usd: t1, useUsd: t0 !== null && t1 !== null };
  }, [token0UsdPrice, token1UsdPrice, currentPrice]);

  // Prepare LP info (sorted by total USD, with colors)
  const lpInfoList = useMemo<LPInfo[]>(() => {
    if (!positionsByOwner || positionsByOwner.length === 0) return [];

    // Calculate total USD for each LP (used for sorting, not for per-bar calculations)
    // Note: For tick-based pricing, we use current price here since this is just for sorting LPs by size
    const lpTotals = positionsByOwner.map((ownerData) => {
      let totalUsd = 0;
      for (const pos of ownerData.positions) {
        const posLiquidity = BigInt(pos.liquidity);
        if (posLiquidity > 0n) {
          const Lnum = Math.max(0, approxBigIntToNumber(posLiquidity));

          const sqrtA = tickToSqrtPrice(pos.tickLower);
          const sqrtB = tickToSqrtPrice(pos.tickUpper);
          const sqrtP = tickToSqrtPrice(currentTick);
          const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
          const dUp = Math.max(0, sqrtB - clamped);
          const dDown = Math.max(0, clamped - sqrtA);

          const amount0Raw =
            clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
          const amount1Raw = Lnum * dDown;

          const amount0 = amount0Raw / Math.pow(10, token0Decimals);
          const amount1 = amount1Raw / Math.pow(10, token1Decimals);

          // For sorting purposes, always use current price (consistent ordering)
          const value0 = useUsd ? amount0 * (t0Usd ?? 0) : amount0 * currentPrice;
          const value1 = useUsd ? amount1 * (t1Usd ?? 0) : amount1;
          
          totalUsd += value0 + value1;
        }
      }
      return { owner: ownerData.owner, totalUsd };
    });

    // Sort by total USD descending
    lpTotals.sort((a, b) => b.totalUsd - a.totalUsd);

    // Take top N LPs, rest go to "Others"
    const result: LPInfo[] = [];
    for (let i = 0; i < Math.min(lpTotals.length, MAX_VISIBLE_LPS); i++) {
      result.push({
        id: `lp-${i}`,
        owner: lpTotals[i].owner,
        color: LP_COLORS[i % LP_COLORS.length],
        totalUsd: lpTotals[i].totalUsd,
      });
    }

    // Add "Others" if needed
    if (lpTotals.length > MAX_VISIBLE_LPS) {
      const othersTotal = lpTotals
        .slice(MAX_VISIBLE_LPS)
        .reduce((acc, lp) => acc + lp.totalUsd, 0);
      result.push({
        id: "others",
        owner: `Others (${lpTotals.length - MAX_VISIBLE_LPS})`,
        color: OTHERS_COLOR,
        totalUsd: othersTotal,
      });
    }

    return result;
  }, [positionsByOwner, currentTick, token0Decimals, token1Decimals, t0Usd, t1Usd, useUsd, currentPrice, liquidityPricingMode]);

  // Build tick buckets with LP segments using totalDistribution from parent
  const distribution = useMemo<TickBucket[]>(() => {
    if (!totalDistribution || totalDistribution.length === 0) return [];
    if (!positionsByOwner || positionsByOwner.length === 0) return [];

    // Helper function to calculate LP value at a specific tick range (bar)
    // For tick-based pricing: uses the BAR's tick price for all liquidity at that price level
    const calcLPValueAtTick = (
      positions: PositionData[],
      barMinTick: number,
      barMaxTick: number
    ): number => {
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
        value0 = useUsd ? totalAmount0 * (t0Usd ?? 0) : totalAmount0 * currentPrice;
        value1 = useUsd ? totalAmount1 * (t1Usd ?? 0) : totalAmount1;
      }
      
      return value0 + value1;
    };

    // Apply zoom to the provided distribution
    let barsToUse = totalDistribution;

    if (zoomLevel > 0 && barsToUse.length > 10) {
      // Find center bar (containing currentTick)
      const centerIdx = barsToUse.findIndex(
        (b) => b.minTick <= currentTick && currentTick < b.maxTick
      );
      const center = centerIdx >= 0 ? centerIdx : Math.floor(barsToUse.length / 2);

      // Calculate window size based on zoom
      const windowSize = Math.max(10, Math.floor(barsToUse.length / Math.pow(2, zoomLevel)));
      const halfWindow = Math.floor(windowSize / 2);

      const start = Math.max(0, center - halfWindow);
      const end = Math.min(barsToUse.length, center + halfWindow);

      barsToUse = barsToUse.slice(start, end);
    }

    // Find others positions (positions from owners not in top N)
    const topOwners = new Set(
      lpInfoList
        .filter((lp) => lp.id !== "others")
        .map((lp) => lp.owner.toLowerCase())
    );
    const othersPositions: PositionData[] = [];
    for (const ownerData of positionsByOwner) {
      if (!topOwners.has(ownerData.owner.toLowerCase())) {
        othersPositions.push(...ownerData.positions);
      }
    }

    // Build buckets with LP segments
    const buckets: TickBucket[] = barsToUse.map((bar) => {
      // First, calculate raw values for each LP
      const rawSegments: { lpId: string; owner: string; value: number; color: string }[] = [];
      let rawTotal = 0;

      // Calculate value for each LP (in order, largest first)
      for (const lp of lpInfoList) {
        if (lp.id === "others") continue;

        const ownerData = positionsByOwner.find(
          (o) => o.owner.toLowerCase() === lp.owner.toLowerCase()
        );
        if (!ownerData) continue;

        const value = calcLPValueAtTick(ownerData.positions, bar.minTick, bar.maxTick);
        if (value > 0) {
          rawSegments.push({
            lpId: lp.id,
            owner: lp.owner,
            value,
            color: lp.color,
          });
          rawTotal += value;
        }
      }

      // Add "Others" segment if applicable
      if (othersPositions.length > 0) {
        const othersValue = calcLPValueAtTick(othersPositions, bar.minTick, bar.maxTick);
        if (othersValue > 0) {
          rawSegments.push({
            lpId: "others",
            owner: "Others",
            value: othersValue,
            color: OTHERS_COLOR,
          });
          rawTotal += othersValue;
        }
      }

      return {
        minTick: bar.minTick,
        maxTick: bar.maxTick,
        tickMid: bar.tickMid,
        price: bar.price,
        priceMin: bar.priceMin,
        priceMax: bar.priceMax,
        totalValue: rawTotal, // Use calculated total from all LP positions
        segments: rawSegments,
        height: 0,
      };
    });

    // Normalize heights
    const maxTotal = buckets.reduce((m, b) => Math.max(m, b.totalValue), 0);
    if (maxTotal > 0) {
      for (const bucket of buckets) {
        bucket.height = (bucket.totalValue / maxTotal) * 100;
      }
    }

    return buckets;
  }, [totalDistribution, positionsByOwner, lpInfoList, currentTick, zoomLevel, t0Usd, t1Usd, useUsd, currentPrice, token0Decimals, token1Decimals, liquidityPricingMode]);

  const displayDistribution = useMemo(
    () => (invertPrice ? [...distribution].reverse() : distribution),
    [distribution, invertPrice]
  );

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

  if (distribution.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-gray-400">No LP position data available</p>
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

  const formatDisplayPriceRange = (priceMin: number, priceMax: number): [string, string] => {
    const a = toDisplayPrice(priceMin);
    const b = toDisplayPrice(priceMax);
    const [left, right] = a <= b ? [a, b] : [b, a];
    return [formatXAxisPrice(left), formatXAxisPrice(right)];
  };

  const currentPriceDisplay = toDisplayPrice(currentPrice);

  const maxTotalValue = Math.max(...distribution.map((d) => d.totalValue));

  const hoveredBucket = hover ? displayDistribution[hover.index] : null;

  const currentTickBarIndex = displayDistribution.findIndex(
    (b) => b.minTick <= currentTick && currentTick < b.maxTick
  );

  // Determine if we're in USD mode
  const resultIsUsd = liquidityPricingMode === "tick-price" 
    ? (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0)
    : useUsd;
    
  const yAxisLabel = liquidityPricingMode === "tick-price"
    ? resultIsUsd
      ? "Liquidity (USD @ tick price)"
      : `Liquidity (${token1Symbol} @ tick price)`
    : resultIsUsd
      ? "Liquidity (USD)"
      : `Liquidity (${token1Symbol})`;

  return (
    <div ref={containerRef} className={cn("h-full relative flex flex-col select-none", className)}>
      {/* Tooltip */}
      {hoveredBucket && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: Math.max(8, Math.min((hover?.x ?? 0), (containerRef.current?.offsetWidth ?? 300) - 200)),
            top: Math.max(44, (hover?.y ?? 0) - 8),
          }}
        >
          <div className="bg-white/50 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3.5 py-3 min-w-[180px]">
            {/* Price range */}
            <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-gray-100">
              <span className="text-[13px] font-semibold tabular-nums text-gray-900">
                {formatDisplayPriceRange(hoveredBucket.priceMin, hoveredBucket.priceMax)[0]}
              </span>
              <span className="text-gray-400">→</span>
              <span className="text-[13px] font-semibold tabular-nums text-gray-900">
                {formatDisplayPriceRange(hoveredBucket.priceMin, hoveredBucket.priceMax)[1]}
              </span>
            </div>

            {/* LP breakdown */}
            {(() => {
              const TOOLTIP_MAX = 5;
              const topSegs = hoveredBucket.segments.filter((s) => s.lpId !== "others").slice(0, TOOLTIP_MAX);
              const restSegs = hoveredBucket.segments.filter((s) => s.lpId !== "others").slice(TOOLTIP_MAX);
              const existingOthers = hoveredBucket.segments.find((s) => s.lpId === "others");
              const othersValue = restSegs.reduce((sum, s) => sum + s.value, 0) + (existingOthers?.value ?? 0);
              const othersCount = restSegs.length + (existingOthers ? 1 : 0);

              return (
                <div className="space-y-1.5 text-[11px]">
                  {topSegs.map((seg) => {
                    const meta = getLpMeta(seg.owner, spaceSlug);
                    const label = formatLpLabel(seg.owner, spaceSlug);
                    return (
                      <div key={seg.lpId} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-sm"
                            style={{ backgroundColor: seg.color }}
                          />
                          {meta?.logoSrc && (
                            <img
                              src={meta.logoSrc}
                              alt={`${meta.label} logo`}
                              className="w-3 h-3 rounded-sm"
                              loading="lazy"
                            />
                          )}
                          <span className="text-gray-500" style={{ fontFamily: "var(--bp-font-mono)" }}>
                            {label}
                          </span>
                        </div>
                        <span className="font-medium tabular-nums text-gray-700">
                          {useUsd ? formatFullValue(seg.value, "$") : formatFullValue(seg.value)}
                        </span>
                      </div>
                    );
                  })}
                  {othersValue > 0 && (
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: OTHERS_COLOR }}
                        />
                        <span className="text-gray-500" style={{ fontFamily: "var(--bp-font-mono)" }}>
                          Others ({othersCount})
                        </span>
                      </div>
                      <span className="font-medium tabular-nums text-gray-700">
                        {useUsd ? formatFullValue(othersValue, "$") : formatFullValue(othersValue)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4 pt-2 mt-2 border-t border-gray-100">
                    <span className="text-gray-500">Total</span>
                    <span className="font-semibold tabular-nums text-gray-900">
                      {useUsd
                        ? formatFullValue(hoveredBucket.totalValue, "$")
                        : formatFullValue(hoveredBucket.totalValue)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Chart area */}
      <div className="flex-1 flex min-h-0">
        {/* Bars container */}
        <div className="flex-1 relative border-b border-gray-200">
          {/* Bar chart */}
          <div className="absolute inset-0 flex items-end gap-px pointer-events-none">
            {displayDistribution.map((bucket, index) => {
              const isCurrentBar = bucket.minTick <= currentTick && currentTick < bucket.maxTick;
              const isHovered = hover?.index === index;

              // Calculate segment heights as percentages within the bar
              const segmentPcts =
                bucket.totalValue > 0
                  ? bucket.segments.map((seg) => ({
                      ...seg,
                      pct: (seg.value / bucket.totalValue) * 100,
                    }))
                  : [];

              return (
                <div
                  key={index}
                  className={cn(
                    "flex-1 overflow-hidden transition-opacity",
                    isCurrentBar && "ring-2 ring-inset ring-gray-900/20"
                  )}
                  style={{
                    height: `${Math.max(0.5, bucket.height)}%`,
                    opacity: isHovered ? 1 : 0.85,
                  }}
                >
                  {/* Stacked segments - bottom to top (first LP at bottom) */}
                  <div className="w-full h-full flex flex-col-reverse">
                    {segmentPcts.map((seg) => (
                      <div
                        key={seg.lpId}
                        style={{
                          height: `${seg.pct}%`,
                          backgroundColor: seg.color,
                        }}
                        className="w-full chart-bar-grain"
                      />
                    ))}
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
              const barIndex = Math.floor((x / rect.width) * displayDistribution.length);
              const clampedIndex = Math.max(0, Math.min(displayDistribution.length - 1, barIndex));
              setHover({ index: clampedIndex, x, y });
            }}
            onMouseLeave={() => setHover(null)}
          />

          {/* Crosshair lines */}
          {hover !== null && displayDistribution.length > 0 && (
            <>
              {/* Vertical line */}
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{
                  left: `${((hover.index + 0.5) / displayDistribution.length) * 100}%`,
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

          {/* Current price marker */}
          {currentTickBarIndex >= 0 && (
            <div
              className="absolute -bottom-1.5 pointer-events-none z-10"
              style={{
                left: `${((currentTickBarIndex + 0.5) / displayDistribution.length) * 100}%`,
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
            const numBars = displayDistribution.length;
            if (numBars === 0) return null;

            const tickPositions = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
              const barIndex = Math.min(Math.floor(pct * numBars), numBars - 1);
              const bar = displayDistribution[barIndex];
              return bar.tickMid ?? Math.floor((bar.minTick + bar.maxTick) / 2);
            });

            const points = tickPositions.map((tick, idx) => {
              const price = toDisplayPrice(tickToPrice(tick, token0Decimals, token1Decimals));
              const pct = idx * 25;
              const isCurrent = Math.abs(tick - currentTick) < tickSpacing;
              return { pct, price, isCurrent };
            });

            // Replace closest label with current price if within 15%
            if (currentTickBarIndex >= 0) {
              const currentPct = ((currentTickBarIndex + 0.5) / numBars) * 100;
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

      {/* Bottom legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 pt-2 px-2 border-t border-gray-100 mt-1 max-h-20 overflow-y-auto">
        {lpInfoList.slice(0, 8).map((lp) => {
          const meta = lp.id === "others" ? undefined : getLpMeta(lp.owner, spaceSlug);
          const label = lp.id === "others" ? lp.owner : formatLpLabel(lp.owner, spaceSlug);
          return (
            <div key={lp.id} className="flex items-center gap-1 text-[9px]">
              <div
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: lp.color }}
              />
              {meta?.logoSrc && (
                <img
                  src={meta.logoSrc}
                  alt={`${meta.label} logo`}
                  className="w-3 h-3 rounded-sm"
                  loading="lazy"
                />
              )}
              <span className="text-gray-500" style={{ fontFamily: "var(--bp-font-mono)" }}>
                {label}
              </span>
            </div>
          );
        })}
        {lpInfoList.length > 8 && (
          <div className="text-[9px] text-gray-400">+{lpInfoList.length - 8} more</div>
        )}
      </div>
    </div>
  );
});

export default LPRangesByAddressChart;
