"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { LinePath, Bar } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";
import {
  usePoolCandles,
  getRecommendedInterval,
  INTERVAL_SECONDS,
  type OHLCDataPoint,
} from "@/hooks/use-pool-candles";
import { useBinanceKlines, type BinancePricePoint } from "@/hooks/use-binance-klines";
import { ZEROG_SPACE_SLUG } from "@/lib/space-policy";
import {
  ZEROG_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
  BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
} from "@/lib/pools";
import { BirdsEyeSectionDivider } from "./birds-eye-section-divider";

// ---------------------------------------------------------------------------
// 0G pool configuration (token0 = 0G asset, token1 = USD stable in both pools,
// so pool price token1/token0 lines up with the Binance 0GUSDT close).
// ---------------------------------------------------------------------------

const BINANCE_SYMBOL = "0GUSDT";
const BINANCE_LABEL = "Binance 0G/USDT";
const BINANCE_COLOR = "#F0B90B"; // Binance yellow

interface ZerogPoolConfig {
  address: string;
  label: string;
  color: string;
  token0Decimals: number;
  token1Decimals: number;
}

const ZEROG_POOLS: ZerogPoolConfig[] = [
  {
    address: ZEROG_W0G_USDCE_V3_POOL_KEY,
    label: "W0G/USDC.e · Uniswap",
    color: "#4A6CF7",
    token0Decimals: 18,
    token1Decimals: 6,
  },
  {
    address: ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
    label: "W0G/USDC.e · Zia",
    color: "#8B5CF6",
    token0Decimals: 18,
    token1Decimals: 6,
  },
  {
    address: BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
    label: "0G/USDT · BSC",
    color: "#06B6D4",
    token0Decimals: 18,
    token1Decimals: 18,
  },
];

const DAY_OPTIONS = [1, 3, 7, 30] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPriceAxis(price: number): string {
  if (!Number.isFinite(price)) return "0";
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatPriceTooltip(price: number): string {
  if (!Number.isFinite(price)) return "—";
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(4)}`;
}

function formatBps(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}`;
}

// ---------------------------------------------------------------------------
// Series model
// ---------------------------------------------------------------------------

interface SeriesPoint {
  t: Date;
  price: number;
}

interface PriceSeries {
  key: string;
  label: string;
  color: string;
  dashed: boolean;
  points: SeriesPoint[];
}

function nearestPoint(points: SeriesPoint[], targetMs: number): SeriesPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDiff = Math.abs(points[0].t.getTime() - targetMs);
  for (const p of points) {
    const diff = Math.abs(p.t.getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Inner chart (multi-series line on one shared price axis)
// ---------------------------------------------------------------------------

interface TooltipState {
  timestamp: Date;
  rows: { key: string; label: string; color: string; value: number | null }[];
}

/**
 * Generic multi-series line chart. `mode="price"` auto-fits the y-domain to the
 * data; `mode="bps"` centres a symmetric domain on zero and draws a zero line
 * (used for the spread-vs-Binance panel). `xDomain` can be passed so stacked
 * charts share the same time axis.
 */
function LineChartInner({
  series,
  width,
  height,
  mode,
  xDomain: xDomainProp,
  formatAxis,
  formatTooltip,
  showAxisBottom = true,
}: {
  series: PriceSeries[];
  width: number;
  height: number;
  mode: "price" | "bps";
  xDomain?: [Date, Date] | null;
  formatAxis: (v: number) => string;
  formatTooltip: (v: number) => string;
  showAxisBottom?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(0);
  const [tooltipTop, setTooltipTop] = useState(0);

  const padding = { top: 16, right: 16, bottom: showAxisBottom ? 36 : 16, left: 60 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);

  const { xDomain, yDomain } = useMemo(() => {
    let minTime = Infinity;
    let maxTime = -Infinity;
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        const ts = p.t.getTime();
        if (ts < minTime) minTime = ts;
        if (ts > maxTime) maxTime = ts;
        if (p.price < minVal) minVal = p.price;
        if (p.price > maxVal) maxVal = p.price;
      }
    }
    const resolvedX: [Date, Date] = xDomainProp
      ? xDomainProp
      : Number.isFinite(minTime)
        ? [new Date(minTime), new Date(maxTime)]
        : [new Date(), new Date()];

    if (!Number.isFinite(minVal)) {
      return { xDomain: resolvedX, yDomain: (mode === "bps" ? [-5, 5] : [0, 1]) as [number, number] };
    }

    if (mode === "bps") {
      // Symmetric around zero so positive/negative spread reads cleanly.
      const maxAbs = Math.max(Math.abs(minVal), Math.abs(maxVal), 5);
      return { xDomain: resolvedX, yDomain: [-maxAbs * 1.1, maxAbs * 1.1] as [number, number] };
    }

    const pad = (maxVal - minVal) * 0.08 || maxVal * 0.02 || 1;
    return { xDomain: resolvedX, yDomain: [minVal - pad, maxVal + pad] as [number, number] };
  }, [series, xDomainProp, mode]);

  const xScale = useMemo(
    () => scaleTime({ domain: xDomain, range: [0, innerWidth] }),
    [xDomain, innerWidth],
  );
  const yScale = useMemo(
    () => scaleLinear({ domain: yDomain, range: [innerHeight, 0], nice: true }),
    [yDomain, innerHeight],
  );

  const timeSpanMs = xDomain[1].getTime() - xDomain[0].getTime();
  const showHours = timeSpanMs < 5 * 24 * 3600 * 1000;

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left - padding.left;
      const targetMs = xScale.invert(x).getTime();

      const rows = series.map((s) => {
        const np = nearestPoint(s.points, targetMs);
        return { key: s.key, label: s.label, color: s.color, value: np ? np.price : null };
      });

      setTooltip({ timestamp: new Date(targetMs), rows });
      setTooltipLeft(event.clientX - rect.left);
      setTooltipTop(event.clientY - rect.top);
    },
    [series, xScale, padding.left],
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (width <= 0 || height <= 0) return null;

  const zeroY = mode === "bps" ? yScale(0) : null;

  return (
    <div className="relative">
      <svg ref={svgRef} width={width} height={height}>
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--bp-border-subtle)"
            strokeOpacity={0.5}
            strokeDasharray="2 4"
            numTicks={mode === "bps" ? 4 : 5}
          />

          {zeroY !== null && (
            <line
              x1={0}
              x2={innerWidth}
              y1={zeroY}
              y2={zeroY}
              stroke="var(--bp-text-muted)"
              strokeWidth={1}
              strokeOpacity={0.7}
            />
          )}

          {series.map((s) =>
            s.points.length > 0 ? (
              <LinePath<SeriesPoint>
                key={s.key}
                data={s.points}
                x={(d) => xScale(d.t) ?? 0}
                y={(d) => yScale(d.price) ?? 0}
                stroke={s.color}
                strokeWidth={s.dashed ? 1.75 : 2}
                strokeDasharray={s.dashed ? "4 4" : undefined}
                curve={curveMonotoneX}
                strokeOpacity={0.9}
              />
            ) : null,
          )}

          {tooltip && (
            <line
              x1={xScale(tooltip.timestamp)}
              x2={xScale(tooltip.timestamp)}
              y1={0}
              y2={innerHeight}
              stroke="var(--bp-text-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}

          <AxisLeft
            scale={yScale}
            numTicks={mode === "bps" ? 4 : 5}
            stroke="var(--bp-border-subtle)"
            tickStroke="var(--bp-border-subtle)"
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 11,
              fontFamily: "var(--bp-font-mono)",
              textAnchor: "end" as const,
              dx: -4,
              dy: 3,
            })}
            tickFormat={(v) => formatAxis(v as number)}
          />

          {showAxisBottom && (
            <AxisBottom
              scale={xScale}
              top={innerHeight}
              numTicks={6}
              stroke="var(--bp-border-subtle)"
              tickStroke="var(--bp-border-subtle)"
              tickLabelProps={() => ({
                fill: "var(--bp-text-muted)",
                fontSize: 11,
                fontFamily: "var(--bp-font-mono)",
                textAnchor: "middle" as const,
                dy: 4,
              })}
              tickFormat={(v) => {
                const d = v as Date;
                if (showHours) {
                  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d
                    .getHours()
                    .toString()
                    .padStart(2, "0")}:00`;
                }
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              }}
            />
          )}

          <Bar
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </g>
      </svg>

      {tooltip && (
        <div
          className="absolute pointer-events-none z-20 rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)]/60 px-3 py-2 text-[10px] backdrop-blur-sm shadow-lg"
          style={{
            left: Math.min(tooltipLeft + 12, width - 180),
            top: Math.max(tooltipTop - 90, 10),
          }}
        >
          <div className="font-mono text-[var(--bp-text-muted)] mb-1.5 pb-1.5 border-b border-[var(--bp-border-subtle)]">
            {tooltip.timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
            {tooltip.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="space-y-1">
            {tooltip.rows.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 rounded" style={{ background: row.color }} />
                  <span style={{ color: row.color }}>{row.label}</span>
                </span>
                <span className="font-mono font-medium text-[var(--bp-text-primary)]">
                  {row.value === null ? "—" : formatTooltip(row.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend({
  series,
  hidden,
  onToggle,
}: {
  series: PriceSeries[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-2">
      {series.map((s) => {
        const isHidden = hidden.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            title={isHidden ? `Show ${s.label}` : `Hide ${s.label}`}
            className={cn(
              "flex items-center gap-2 cursor-pointer rounded px-1.5 py-0.5 transition-opacity hover:bg-gray-100/60 dark:hover:bg-gray-800/40",
              isHidden && "opacity-40",
            )}
          >
            <svg width="24" height="12">
              <line
                x1="0"
                y1="6"
                x2="24"
                y2="6"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "4 4" : undefined}
              />
            </svg>
            <span
              className={cn(
                "text-[10px] font-mono text-[var(--bp-text-muted)]",
                isHidden && "line-through",
              )}
            >
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

function toSeriesPoints(candles: OHLCDataPoint[] | undefined): SeriesPoint[] {
  if (!candles) return [];
  return candles
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .map((c) => ({ t: c.timestamp, price: c.close }));
}

function toBinanceSeriesPoints(points: BinancePricePoint[] | undefined): SeriesPoint[] {
  if (!points) return [];
  return points
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .map((p) => ({ t: p.timestamp, price: p.close }));
}

/**
 * For each pool series, compute its deviation from the Binance reference in bps,
 * aligning candles by interval bucket. `delta = (pool / binance - 1) * 10_000`.
 * Output reuses the {t, price} shape where `price` carries the bps value.
 */
function buildDeltaSeries(
  poolSeries: PriceSeries[],
  binancePoints: SeriesPoint[],
  intervalMs: number,
): PriceSeries[] {
  if (binancePoints.length === 0 || intervalMs <= 0) return [];
  const ref = new Map<number, number>();
  for (const p of binancePoints) {
    ref.set(Math.floor(p.t.getTime() / intervalMs) * intervalMs, p.price);
  }
  return poolSeries.map((s) => ({
    ...s,
    dashed: false,
    points: s.points.flatMap((pt) => {
      const b = ref.get(Math.floor(pt.t.getTime() / intervalMs) * intervalMs);
      if (b === undefined || b <= 0) return [];
      return [{ t: pt.t, price: (pt.price / b - 1) * 10_000 }];
    }),
  }));
}

export function BirdsEyePriceComparisonChart({
  spaceSlug,
}: {
  // Accepts the same `pools` prop as sibling sections for call-site symmetry,
  // but the 0G pool set is fixed so the chart resolves it from config.
  pools?: unknown;
  spaceSlug?: string | null;
}) {
  const [days, setDays] = useState<DayOption>(7);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const interval = getRecommendedInterval(days);
  const enabled = spaceSlug === ZEROG_SPACE_SLUG;

  const toggleSeries = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pool0 = usePoolCandles({
    poolAddress: ZEROG_POOLS[0].address,
    interval,
    days,
    token0Decimals: ZEROG_POOLS[0].token0Decimals,
    token1Decimals: ZEROG_POOLS[0].token1Decimals,
    enabled,
  });
  const pool1 = usePoolCandles({
    poolAddress: ZEROG_POOLS[1].address,
    interval,
    days,
    token0Decimals: ZEROG_POOLS[1].token0Decimals,
    token1Decimals: ZEROG_POOLS[1].token1Decimals,
    enabled,
  });
  const pool2 = usePoolCandles({
    poolAddress: ZEROG_POOLS[2].address,
    interval,
    days,
    token0Decimals: ZEROG_POOLS[2].token0Decimals,
    token1Decimals: ZEROG_POOLS[2].token1Decimals,
    enabled,
  });
  const binance = useBinanceKlines({ symbol: BINANCE_SYMBOL, interval, days, enabled });

  const series = useMemo<PriceSeries[]>(
    () => [
      {
        key: "binance",
        label: BINANCE_LABEL,
        color: BINANCE_COLOR,
        dashed: true,
        points: toBinanceSeriesPoints(binance.data),
      },
      {
        key: ZEROG_POOLS[0].address,
        label: ZEROG_POOLS[0].label,
        color: ZEROG_POOLS[0].color,
        dashed: false,
        points: toSeriesPoints(pool0.data),
      },
      {
        key: ZEROG_POOLS[1].address,
        label: ZEROG_POOLS[1].label,
        color: ZEROG_POOLS[1].color,
        dashed: false,
        points: toSeriesPoints(pool1.data),
      },
      {
        key: ZEROG_POOLS[2].address,
        label: ZEROG_POOLS[2].label,
        color: ZEROG_POOLS[2].color,
        dashed: false,
        points: toSeriesPoints(pool2.data),
      },
    ],
    [binance.data, pool0.data, pool1.data, pool2.data],
  );

  const intervalMs = INTERVAL_SECONDS[interval] * 1000;

  // Shared time axis so the price and spread panels line up vertically.
  const sharedXDomain = useMemo<[Date, Date] | null>(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      if (hidden.has(s.key)) continue;
      for (const p of s.points) {
        const t = p.t.getTime();
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
    return Number.isFinite(min) ? [new Date(min), new Date(max)] : null;
  }, [series, hidden]);

  // Per-pool deviation from Binance in bps (visible pools only).
  const deltaSeries = useMemo(() => {
    const binancePts = series.find((s) => s.key === "binance")?.points ?? [];
    const poolVisible = series.filter((s) => s.key !== "binance" && !hidden.has(s.key));
    return buildDeltaSeries(poolVisible, binancePts, intervalMs);
  }, [series, hidden, intervalMs]);

  if (!enabled) return null;

  const isLoading = pool0.isLoading || pool1.isLoading || binance.isLoading;
  const hasData = series.some((s) => s.points.length > 0);
  // Only plot series the user hasn't toggled off (the chart rescales to them).
  const visibleSeries = series.filter((s) => !hidden.has(s.key));
  const hasVisibleData = visibleSeries.some((s) => s.points.length > 0);
  const deltaHasData = deltaSeries.some((s) => s.points.length > 0);

  return (
    <div id="price-comparison" className="scroll-mt-20">
      <BirdsEyeSectionDivider label="Pool Price vs Binance" />
      <div className="px-4 py-4 md:px-6">
        <div className="bp-card relative flex flex-col overflow-hidden">
          <div className="bp-card-inner" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
              Pool Price vs Binance Spot ({days}d)
            </span>
            <div className="flex items-center gap-1 rounded-md bg-gray-100/70 p-0.5 dark:bg-gray-800/50">
              {DAY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setDays(opt)}
                  className={cn(
                    "cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    days === opt
                      ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                      : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
                  )}
                >
                  {opt}D
                </button>
              ))}
            </div>
          </div>

          <div className="h-[280px] w-full">
            {isLoading && !hasData ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
              </div>
            ) : !hasData ? (
              <div className="flex h-full items-center justify-center text-[12px] text-gray-400">
                No price data available
              </div>
            ) : !hasVisibleData ? (
              <div className="flex h-full items-center justify-center text-[12px] text-gray-400">
                All series hidden — click a legend item to show it
              </div>
            ) : (
              <ParentSize debounceTime={50}>
                {({ width, height }) => (
                  <LineChartInner
                    series={visibleSeries}
                    width={width}
                    height={Math.max(height, 200)}
                    mode="price"
                    xDomain={sharedXDomain}
                    formatAxis={formatPriceAxis}
                    formatTooltip={formatPriceTooltip}
                    showAxisBottom={!deltaHasData}
                  />
                )}
              </ParentSize>
            )}
          </div>

          {/* Appended panel: per-pool deviation from Binance in bps */}
          {hasData && deltaHasData && (
            <div className="mt-1 border-t border-[var(--bp-border-subtle)] pt-2">
              <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                Price Deviation vs Binance (bps)
              </span>
              <div className="h-[120px] w-full">
                <ParentSize debounceTime={50}>
                  {({ width, height }) => (
                    <LineChartInner
                      series={deltaSeries}
                      width={width}
                      height={Math.max(height, 100)}
                      mode="bps"
                      xDomain={sharedXDomain}
                      formatAxis={formatBps}
                      formatTooltip={(v) => `${formatBps(v)} bps`}
                    />
                  )}
                </ParentSize>
              </div>
            </div>
          )}

          {hasData && <Legend series={series} hidden={hidden} onToggle={toggleSeries} />}
        </div>
      </div>
    </div>
  );
}

export default BirdsEyePriceComparisonChart;
