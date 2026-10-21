"use client";

import React, { useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { curveMonotoneX } from "@visx/curve";
import { sqrtPriceX96ToPrice } from "@/lib/envio-client";
type SwapEventData = {
  timestamp: number;
  sqrtPriceX96?: string;
  amount0?: string;
  amount1?: string;
};

// Size buckets - premium desaturated palette for professional appearance
// Colors progress from cool (small) to warm (large) for intuitive reading
const SIZE_BUCKETS = [
  { id: "below_100", label: "<100 USD", min: 0, max: 100, color: "#4A90D9" },            // Muted blue
  { id: "100_1k", label: "100-1k USD", min: 100, max: 1000, color: "#6B8E9B" },          // Slate teal
  { id: "1k_5k", label: "1k-5k USD", min: 1000, max: 5000, color: "#5B8A72" },           // Sage green
  { id: "5k_10k", label: "5k-10k USD", min: 5000, max: 10000, color: "#8FA578" },        // Olive
  { id: "10k_25k", label: "10k-25k USD", min: 10000, max: 25000, color: "#7A9EB5" },     // Steel blue
  { id: "25k_50k", label: "25k-50k USD", min: 25000, max: 50000, color: "#8B7BA1" },     // Dusty purple
  { id: "50k_100k", label: "50k-100k USD", min: 50000, max: 100000, color: "#C49052" },  // Warm bronze
  { id: "100k_250k", label: "100k-250k USD", min: 100000, max: 250000, color: "#A67D94" }, // Mauve
  { id: "250k_500k", label: "250k-500k USD", min: 250000, max: 500000, color: "#9B8174" }, // Taupe
  { id: "500k_1m", label: "500k-1M USD", min: 500000, max: 1000000, color: "#B08968" },  // Camel
  // NOTE: don't use pure white (invisible on light bg). Render as outlined/dashed style.
  { id: "1m_plus", label: "1M+ USD", min: 1000000, max: Infinity, color: "#8B9299" },    // Neutral gray
] as const;

type BucketId = typeof SIZE_BUCKETS[number]["id"];

interface DailyBucketData {
  date: Date;
  dateKey: string;
  buckets: Record<BucketId, number>;
  total: number;
}

interface TradingVolumeBySizeChartProps {
  swapData: SwapEventData[];
  dailyData?: Array<{
    date: string;
    dateKey: string;
    buckets: Record<BucketId, number>;
    total: number;
  }>;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  isLoading?: boolean;
  onDataRangeChange?: (range: { days: number; startDate: Date; endDate: Date } | null) => void;
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return "$0";
}

function formatDateShort(date: Date): string {
  // Match typical analytics dashboards (Dune/etc) which bucket by UTC day.
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  // Use UTC so "day" shifts are stable across user timezones.
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// NOTE: We do NOT have historical token USD prices per-swap. Using "current" prices can make
// token0/token1 USD estimates disagree for older swaps. To avoid undercounting, we choose the
// larger USD side when both are available and non-stable.
const STABLE_USD_BAND = 0.03; // consider stablecoins when price within 3% of $1
const MAX_REASONABLE_TRADE_USD = 100_000_000; // cap outliers (mixed pools / bad decimals)

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseSwapAmount(amount: string | undefined, decimals: number): number | null {
  if (!amount) return null;
  const raw = Number(amount);
  if (!Number.isFinite(raw)) return null;
  // If the string already includes a decimal or exponent, assume it's already in token units.
  if (/[.eE]/.test(amount)) return raw;
  return raw / Math.pow(10, decimals);
}

function getSwapPrices(
  swap: SwapEventData,
  token0Decimals: number,
  token1Decimals: number
): { priceRaw: number | null; priceUnit: number | null } {
  if (!swap.sqrtPriceX96) return null;
  try {
    const sqrtPrice = BigInt(swap.sqrtPriceX96);
    if (sqrtPrice <= 0n) return null;
    const priceRaw = sqrtPriceX96ToPrice(sqrtPrice, token0Decimals, token1Decimals);
    const priceUnit = sqrtPriceX96ToPrice(sqrtPrice, 0, 0);
    return { priceRaw, priceUnit };
  } catch {
    return null;
  }
}

function normalizeSwapAmounts(
  swap: SwapEventData,
  token0Decimals: number,
  token1Decimals: number
): { amount0Raw: number | null; amount1Raw: number | null; amount0Unit: number | null; amount1Unit: number | null } {
  const raw0 = swap.amount0 ? Number(swap.amount0) : null;
  const raw1 = swap.amount1 ? Number(swap.amount1) : null;
  const has0 = raw0 !== null && Number.isFinite(raw0);
  const has1 = raw1 !== null && Number.isFinite(raw1);

  if (!has0 && !has1) {
    return { amount0Raw: null, amount1Raw: null, amount0Unit: null, amount1Unit: null };
  }

  const raw0Abs = Math.abs(raw0 as number);
  const raw1Abs = Math.abs(raw1 as number);

  const amount0Raw = raw0Abs / Math.pow(10, token0Decimals);
  const amount1Raw = raw1Abs / Math.pow(10, token1Decimals);
  const amount0Unit = raw0Abs;
  const amount1Unit = raw1Abs;

  return { amount0Raw, amount1Raw, amount0Unit, amount1Unit };
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sortedAsc[base] ?? 0;
  const b = sortedAsc[Math.min(base + 1, sortedAsc.length - 1)] ?? a;
  return a + rest * (b - a);
}

const TradingVolumeBySizeChartInner: React.FC<
  TradingVolumeBySizeChartProps & { width: number; height: number }
> = ({
  swapData,
  dailyData: dailyDataProp,
  token0Decimals,
  token1Decimals,
  token0UsdPrice,
  token1UsdPrice,
  isLoading,
  onDataRangeChange,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredDay, setHoveredDay] = useState<{
    dayIndex: number;
    localX: number;
    localY: number;
  } | null>(null);

  // Process swap data into daily buckets
  const dailyData = useMemo(() => {
    if (Array.isArray(dailyDataProp) && dailyDataProp.length > 0) {
      return dailyDataProp.map((d) => ({
        ...d,
        date: new Date(d.date),
      })) as DailyBucketData[];
    }
    if (!swapData || swapData.length === 0) return [];
    if (token0UsdPrice === null && token1UsdPrice === null) return [];

    const dayMap = new Map<string, DailyBucketData>();

    for (const swap of swapData) {
      const swapPrices = getSwapPrices(swap, token0Decimals, token1Decimals);
      const normalized = normalizeSwapAmounts(swap, token0Decimals, token1Decimals);
      if (normalized.amount0Raw === null && normalized.amount1Raw === null) {
        continue;
      }

      // USD prices are per token unit, so use the decimal-adjusted price.
      const swapPriceForUsd = swapPrices?.priceRaw ?? null;
      const effectiveToken0Usd =
        token0UsdPrice !== null
          ? token0UsdPrice
          : token1UsdPrice !== null && swapPriceForUsd !== null && swapPriceForUsd > 0
            ? token1UsdPrice / swapPriceForUsd
            : null;
      const effectiveToken1Usd =
        token1UsdPrice !== null
          ? token1UsdPrice
          : token0UsdPrice !== null && swapPriceForUsd !== null && swapPriceForUsd > 0
            ? token0UsdPrice * swapPriceForUsd
            : null;
      
      const usd0Raw = effectiveToken0Usd !== null ? normalized.amount0Raw * effectiveToken0Usd : null;
      const usd1Raw = effectiveToken1Usd !== null ? normalized.amount1Raw * effectiveToken1Usd : null;
      const usd0Unit = effectiveToken0Usd !== null ? normalized.amount0Unit * effectiveToken0Usd : null;
      const usd1Unit = effectiveToken1Usd !== null ? normalized.amount1Unit * effectiveToken1Usd : null;

      const ratioScore = (u0: number | null, u1: number | null): number => {
        if (u0 === null || u1 === null || u0 <= 0 || u1 <= 0) return Infinity;
        return Math.abs(Math.log(u1 / u0));
      };

      const scoreRaw = ratioScore(usd0Raw, usd1Raw);
      const scoreUnit = ratioScore(usd0Unit, usd1Unit);
      const useUnit = scoreUnit < scoreRaw;

      const usd0 = useUnit ? usd0Unit : usd0Raw;
      const usd1 = useUnit ? usd1Unit : usd1Raw;

      const stable0 =
        effectiveToken0Usd !== null && Math.abs(effectiveToken0Usd - 1) <= STABLE_USD_BAND && usd0 !== null;
      const stable1 =
        effectiveToken1Usd !== null && Math.abs(effectiveToken1Usd - 1) <= STABLE_USD_BAND && usd1 !== null;

      let tradeUsd = 0;
      if (stable0 && stable1) {
        tradeUsd = ((usd0 as number) + (usd1 as number)) / 2;
      } else if (stable0) {
        // Prefer stable side (e.g. USDC amount) so historical swaps don't get dropped due to price drift.
        tradeUsd = usd0 as number;
      } else if (stable1) {
        tradeUsd = usd1 as number;
      } else if (usd0 !== null && usd1 !== null) {
        // Use the midpoint to avoid overcounting when both sides are available.
        tradeUsd = (usd0 + usd1) / 2;
      } else if (usd0 !== null) {
        tradeUsd = usd0;
      } else if (usd1 !== null) {
        tradeUsd = usd1;
      }

      if (tradeUsd <= 0) {
        continue;
      }

      if (tradeUsd > MAX_REASONABLE_TRADE_USD) {
        continue;
      }

      const date = new Date(swap.timestamp * 1000);
      const dayKey = formatDateKey(date);

      let bucketId: BucketId = "below_100";
      for (const bucket of SIZE_BUCKETS) {
        if (tradeUsd >= bucket.min && tradeUsd < bucket.max) {
          bucketId = bucket.id;
          break;
        }
      }

      if (!dayMap.has(dayKey)) {
        // Store the day as UTC midnight so downstream scales/formatting are stable.
        const dayDate = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
        );
        dayMap.set(dayKey, {
          date: dayDate,
          dateKey: dayKey,
          buckets: Object.fromEntries(SIZE_BUCKETS.map((b) => [b.id, 0])) as Record<BucketId, number>,
          total: 0,
        });
      }

      const dayData = dayMap.get(dayKey)!;
      dayData.buckets[bucketId] += tradeUsd;
      dayData.total += tradeUsd;
    }

    const sparse = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (sparse.length === 0) return [];

    // Fill missing days with 0s across the entire range from first to last day with data
    const firstDayWithData = sparse[0]!.date;
    const lastDayWithData = sparse[sparse.length - 1]!.date;
    
    const start = new Date(
      Date.UTC(
        firstDayWithData.getUTCFullYear(),
        firstDayWithData.getUTCMonth(),
        firstDayWithData.getUTCDate()
      )
    );
    const end = new Date(
      Date.UTC(
        lastDayWithData.getUTCFullYear(),
        lastDayWithData.getUTCMonth(),
        lastDayWithData.getUTCDate()
      )
    );
    
    const filled: DailyBucketData[] = [];
    for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
      const key = formatDateKey(d);
      const existing = dayMap.get(key);
      if (existing) {
        filled.push(existing);
      } else {
        filled.push({
          date: new Date(d),
          dateKey: key,
          buckets: Object.fromEntries(SIZE_BUCKETS.map((b) => [b.id, 0])) as Record<BucketId, number>,
          total: 0,
        });
      }
    }

    return filled;
  }, [dailyDataProp, swapData, token0Decimals, token1Decimals, token0UsdPrice, token1UsdPrice]);

  // Notify parent of actual data range
  const lastRangeKeyRef = useRef<string | null>(null);

  React.useEffect(() => {
    if (!onDataRangeChange) return;
    
    if (dailyData.length === 0) {
      if (lastRangeKeyRef.current !== "empty") {
        lastRangeKeyRef.current = "empty";
        onDataRangeChange(null);
      }
      return;
    }

    const startDate = dailyData[0]!.date;
    const endDate = dailyData[dailyData.length - 1]!.date;
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const rangeKey = `${startDate.toISOString()}|${endDate.toISOString()}|${days}`;
    if (rangeKey !== lastRangeKeyRef.current) {
      lastRangeKeyRef.current = rangeKey;
      onDataRangeChange({ days, startDate, endDate });
    }
  }, [dailyData, onDataRangeChange]);

  // Find which buckets have data (for legend styling)
  const activeBuckets = useMemo(() => {
    const hasData = new Set<BucketId>();
    for (const day of dailyData) {
      for (const bucket of SIZE_BUCKETS) {
        if (day.buckets[bucket.id] > 0) {
          hasData.add(bucket.id);
        }
      }
    }
    return SIZE_BUCKETS.filter((b) => hasData.has(b.id));
  }, [dailyData]);

  const scaleBuckets = useMemo(() => {
    // If 1M+ dominates, scale using the rest so the small lines are still visible.
    const non1m = activeBuckets.filter((b) => b.id !== "1m_plus");
    return non1m.length > 0 ? non1m : activeBuckets;
  }, [activeBuckets]);

  // Margins - increased right margin for legend
  const legendWidth = 115;
  const margin = { top: 20, right: legendWidth + 16, bottom: 40, left: 55 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  // Color map
  const colorMap = Object.fromEntries(SIZE_BUCKETS.map((b) => [b.id, b.color]));

  // Scales
  const xScale = useMemo(() => {
    const min = dailyData[0]?.date ?? new Date();
    const last = dailyData[dailyData.length - 1]?.date ?? min;
    const max = last.getTime() === min.getTime() ? addDays(min, 1) : last;
    return scaleTime<number>({
      domain: [min, max],
      range: [0, innerWidth],
    });
  }, [dailyData, innerWidth]);

  // For multi-line chart - scale to bucket max (not total) so lines are readable
  const yScale = useMemo(() => {
    const bucketValues = dailyData.flatMap((d) => scaleBuckets.map((b) => d.buckets[b.id]));
    const allValues = [...bucketValues, ...dailyData.map((d) => d.total)]
      .filter((v) => v > 0)
      .sort((a, b) => a - b);

    const maxV = allValues.length ? allValues[allValues.length - 1]! : 0;
    const p95 = quantile(allValues, 0.95);
    // If max is a huge outlier, scale to p95 instead.
    const base = maxV > p95 * 6 ? p95 : maxV;
    const yMax = base > 0 ? base * 1.25 : 1000;

    return scaleLinear<number>({
      domain: [0, yMax],
      range: [innerHeight, 0],
    });
  }, [dailyData, innerHeight, scaleBuckets]);

  const hoveredDayData = hoveredDay !== null ? dailyData[hoveredDay.dayIndex] : null;
  const yMaxDomain = yScale.domain()[1] ?? 0;

  if (width <= 0 || height <= 0) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--bp-line)] border-t-[var(--bp-blue)] rounded-full animate-spin" />
      </div>
    );
  }

  if (dailyData.length === 0) {
    let message = "No swap data available for this period";
    if (!swapData || swapData.length === 0) {
      message = "No swap events found in the selected time range";
    } else if (swapData.length > 0 && swapData[0] && !swapData[0].amount0) {
      message = "Swap data missing amount fields - indexer may need updating";
    } else if (token0UsdPrice === null && token1UsdPrice === null) {
      message = "USD prices not available - cannot calculate trade sizes";
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
        <span>{message}</span>
        <span className="text-xs text-gray-300">({swapData?.length ?? 0} swaps loaded)</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full flex">
      {/* Chart area */}
      <div className="flex-1 min-h-0">
        <svg width={width - legendWidth} height={height}>
          <Group top={margin.top} left={margin.left}>
            {/* Grid */}
            <GridRows
              scale={yScale}
              width={innerWidth}
              stroke="var(--bp-grid-minor)"
              strokeOpacity={0.3}
              numTicks={5}
            />

            {/* Lines for each bucket (overlapping, not stacked) */}
            {activeBuckets.map((bucket) => {
              const color = colorMap[bucket.id] ?? "#888";
              const isOutline = bucket.id === "1m_plus";
              
              return (
                <LinePath<DailyBucketData>
                  key={`line-${bucket.id}`}
                  data={dailyData}
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(Math.min(d.buckets[bucket.id], yMaxDomain)) ?? innerHeight}
                  curve={curveMonotoneX}
                  stroke={color}
                  strokeWidth={isOutline ? 2.5 : 3}
                  strokeOpacity={1}
                  strokeDasharray={isOutline ? "6,4" : undefined}
                />
              );
            })}

            {/* "All" (total) series - dashed grey line like Dune */}
            <LinePath<DailyBucketData>
              data={dailyData}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScale(Math.min(d.total, yMaxDomain)) ?? innerHeight}
              curve={curveMonotoneX}
              stroke="#9CA3AF"
              strokeWidth={2.5}
              strokeOpacity={0.9}
              strokeDasharray="6,4"
            />
            {/* Total markers */}
            {dailyData
              .filter((d) => d.total > 0)
              .map((d) => (
                <circle
                  key={`point-total-${d.dateKey}`}
                  cx={xScale(d.date) ?? 0}
                  cy={yScale(Math.min(d.total, yMaxDomain)) ?? innerHeight}
                  r={3}
                  fill="transparent"
                  stroke="#9CA3AF"
                  strokeWidth={1.5}
                />
              ))}
            
            {/* Point markers for days with data - helps visualize sparse data */}
            {activeBuckets.map((bucket) => {
              const color = colorMap[bucket.id] ?? "#888";
              const isOutline = bucket.id === "1m_plus";
              return dailyData
                .filter((d) => d.buckets[bucket.id] > 0)
                .map((d) => (
                  <circle
                    key={`point-${bucket.id}-${d.dateKey}`}
                    cx={xScale(d.date) ?? 0}
                    cy={yScale(Math.min(d.buckets[bucket.id], yMaxDomain)) ?? innerHeight}
                    r={3}
                    fill={isOutline ? "transparent" : color}
                    stroke={isOutline ? color : "white"}
                    strokeWidth={1}
                  />
                ));
            })}

            {/* Y Axis */}
            <AxisLeft
              scale={yScale}
              tickFormat={(d) => formatUsdCompact(d as number)}
              stroke="var(--bp-border-subtle)"
              tickStroke="var(--bp-border-subtle)"
              tickLabelProps={() => ({
                fill: "var(--bp-text-muted)",
                fontSize: 11,
                fontFamily: "var(--bp-font-mono)",
                textAnchor: "end",
                dx: "-0.25em",
                dy: "0.25em",
              })}
              numTicks={5}
            />

            {/* X Axis */}
            <AxisBottom
              top={innerHeight}
              scale={xScale}
              tickFormat={(d) => formatDateShort(d as Date)}
              stroke="var(--bp-border-subtle)"
              tickStroke="var(--bp-border-subtle)"
              tickLabelProps={() => ({
                fill: "var(--bp-text-muted)",
                fontSize: 11,
                fontFamily: "var(--bp-font-mono)",
                textAnchor: "middle",
                dy: "0.5em",
              })}
              numTicks={Math.min(8, dailyData.length)}
            />

            {/* Vertical crosshair line when hovering */}
            {hoveredDay !== null && hoveredDayData && (
              <line
                x1={xScale(hoveredDayData.date) ?? 0}
                y1={0}
                x2={xScale(hoveredDayData.date) ?? 0}
                y2={innerHeight}
                stroke="var(--bp-border-subtle)"
                strokeWidth={1}
                strokeDasharray="4,3"
                pointerEvents="none"
              />
            )}

            {/* Hover interaction overlay */}
            <rect
              x={0}
              y={0}
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseMove={(e) => {
                const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (!svgRect || !containerRect) return;
                
                // Mouse position relative to the SVG element
                const mouseX = e.clientX - svgRect.left - margin.left;
                const t = xScale.invert(mouseX).getTime();

                let bestIdx = 0;
                let bestDiff = Infinity;
                for (let i = 0; i < dailyData.length; i++) {
                  const diff = Math.abs(dailyData[i]!.date.getTime() - t);
                  if (diff < bestDiff) {
                    bestDiff = diff;
                    bestIdx = i;
                  }
                }

                // Position relative to container for tooltip
                const localX = e.clientX - containerRect.left;
                const localY = e.clientY - containerRect.top;

                setHoveredDay({
                  dayIndex: bestIdx,
                  localX,
                  localY,
                });
              }}
              onMouseLeave={() => setHoveredDay(null)}
            />
          </Group>
        </svg>
      </div>

      {/* Legend on the right side - matching Dune style */}
      <div 
        className="flex flex-col justify-center gap-0.5 pr-2"
        style={{ width: legendWidth }}
      >
        {/* "All" toggle - shown at top */}
        <div className="flex items-center justify-end gap-2 mb-1">
          <span className="text-[11px] text-gray-400 font-medium">All</span>
          <span 
            className="w-2.5 h-2.5 rounded-full border border-gray-400"
            style={{ backgroundColor: "transparent" }}
          />
        </div>
        
        {/* Individual bucket legends */}
        {SIZE_BUCKETS.map((bucket) => {
          const hasData = activeBuckets.some((b) => b.id === bucket.id);
          const isOutline = bucket.id === "1m_plus";
          
          return (
            <div 
              key={bucket.id} 
              className={`flex items-center justify-end gap-2 ${!hasData ? "opacity-40" : ""}`}
            >
              <span className="text-[10px] text-gray-400 whitespace-nowrap">{bucket.label}</span>
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ 
                  backgroundColor: isOutline ? "transparent" : bucket.color,
                  border: isOutline ? `1.5px solid ${bucket.color}` : "none",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Tooltip - top right of cursor */}
      {hoveredDay && hoveredDayData && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: Math.min(hoveredDay.localX + 12, (containerRef.current?.offsetWidth ?? 300) - legendWidth - 180),
            top: Math.max(8, hoveredDay.localY - 160),
          }}
        >
          <div className="bg-white/50 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3.5 py-3 min-w-[160px]">
            <div className="text-[13px] font-semibold text-gray-900 mb-2.5 pb-2 border-b border-gray-100">
              {formatDateShort(hoveredDayData.date)}
            </div>
            {hoveredDayData.total > 0 ? (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto text-[11px]">
                {SIZE_BUCKETS.filter((b) => hoveredDayData.buckets[b.id] > 0).map((bucket) => {
                  const isOutline = bucket.id === "1m_plus";
                  return (
                    <div key={bucket.id} className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-sm shrink-0"
                          style={{ 
                            backgroundColor: isOutline ? "transparent" : bucket.color,
                            border: isOutline ? `1.5px solid ${bucket.color}` : "none",
                          }}
                        />
                        <span className="text-gray-500">{bucket.label}</span>
                      </div>
                      <span className="font-medium text-gray-700 tabular-nums">
                        {formatUsdCompact(hoveredDayData.buckets[bucket.id])}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-4 pt-2 mt-2 border-t border-gray-100">
                  <span className="text-gray-500 font-medium">Total</span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {formatUsdCompact(hoveredDayData.total)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-[11px]">No trading volume</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const TradingVolumeBySizeChart: React.FC<TradingVolumeBySizeChartProps> = (props) => {
  const FALLBACK_HEIGHT = 280;
  return (
    <ParentSize debounceTime={50}>
      {({ width, height }) => {
        const effectiveHeight =
          Number.isFinite(height) && height >= FALLBACK_HEIGHT ? height : FALLBACK_HEIGHT;
        return (
          <TradingVolumeBySizeChartInner {...props} width={width} height={effectiveHeight} />
        );
      }}
    </ParentSize>
  );
};
