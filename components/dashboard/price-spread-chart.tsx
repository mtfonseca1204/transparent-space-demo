"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { LinePath, Bar } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import {
  type SpreadDataPoint,
  type DeviationEvent,
  computeDeviations,
  usePriceSpreadZoom,
} from "@/hooks/use-price-spread-data";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

const SPREAD_THRESHOLD = 2; // percent

const COLORS = {
  poolPrice: "var(--bp-text-primary)",
  oraclePrice: "#C49052",
  greenFill: "rgba(34, 197, 94, 0.18)",
  redFill: "rgba(239, 68, 68, 0.25)",
  greenStroke: "rgba(34, 197, 94, 0.5)",
  redStroke: "rgba(239, 68, 68, 0.5)",
};

function formatPriceAxis(price: number): string {
  if (!Number.isFinite(price)) return "0";
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

function formatPriceTooltip(price: number): string {
  if (!Number.isFinite(price)) return "0";
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toExponential(4);
}

/** Format ms duration as human-readable (e.g. "2d 5h", "14h", "45m") */
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

interface TooltipData {
  timestamp: Date;
  poolPrice: number;
  oraclePrice: number;
  spreadPct: number;
}

function buildAreaSegments(
  data: SpreadDataPoint[],
  xScale: (d: Date) => number,
  yScale: (d: number) => number
): { path: string; isExceeding: boolean }[] {
  if (data.length < 2) return [];

  const segments: { path: string; isExceeding: boolean }[] = [];

  for (let i = 0; i < data.length - 1; i++) {
    const d0 = data[i];
    const d1 = data[i + 1];

    const x0 = xScale(d0.timestamp);
    const x1 = xScale(d1.timestamp);
    const poolY0 = yScale(d0.poolPrice);
    const poolY1 = yScale(d1.poolPrice);
    const oracleY0 = yScale(d0.oraclePrice);
    const oracleY1 = yScale(d1.oraclePrice);

    const exceeds0 = Math.abs(d0.spreadPct) > SPREAD_THRESHOLD;
    const exceeds1 = Math.abs(d1.spreadPct) > SPREAD_THRESHOLD;
    const isExceeding = exceeds0 || exceeds1;

    const path = `M${x0},${poolY0} L${x1},${poolY1} L${x1},${oracleY1} L${x0},${oracleY0} Z`;
    segments.push({ path, isExceeding });
  }

  return segments;
}

// ─── Chart Inner ──────────────────────────────────────────────────────────────

const PriceSpreadChartInner = ({
  data,
  width,
  height,
  zoomRange,
  oracleLabel,
}: {
  data: SpreadDataPoint[];
  width: number;
  height: number;
  zoomRange: [Date, Date] | null;
  oracleLabel: string;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState<number>(0);
  const [tooltipTop, setTooltipTop] = useState<number>(0);

  const padding = { top: 20, right: 15, bottom: 40, left: 65 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);

  // Filter data to zoom range
  const visibleData = useMemo(() => {
    if (!zoomRange) return data;
    const [zStart, zEnd] = zoomRange;
    return data.filter(
      (d) => d.timestamp >= zStart && d.timestamp <= zEnd
    );
  }, [data, zoomRange]);

  const { xDomain, yDomain } = useMemo(() => {
    if (visibleData.length === 0) {
      return {
        xDomain: [new Date(), new Date()] as [Date, Date],
        yDomain: [0, 1] as [number, number],
      };
    }

    let minTime = Infinity;
    let maxTime = -Infinity;
    let minPrice = Infinity;
    let maxPrice = -Infinity;

    for (const d of visibleData) {
      const ts = d.timestamp.getTime();
      if (ts < minTime) minTime = ts;
      if (ts > maxTime) maxTime = ts;
      if (d.poolPrice < minPrice) minPrice = d.poolPrice;
      if (d.poolPrice > maxPrice) maxPrice = d.poolPrice;
      if (d.oraclePrice < minPrice) minPrice = d.oraclePrice;
      if (d.oraclePrice > maxPrice) maxPrice = d.oraclePrice;
    }

    const pricePad = (maxPrice - minPrice) * 0.05 || maxPrice * 0.01;

    return {
      xDomain: [new Date(minTime), new Date(maxTime)] as [Date, Date],
      yDomain: [minPrice - pricePad, maxPrice + pricePad] as [number, number],
    };
  }, [visibleData]);

  const xScale = useMemo(
    () => scaleTime({ domain: xDomain, range: [0, innerWidth] }),
    [xDomain, innerWidth]
  );

  const yScale = useMemo(
    () => scaleLinear({ domain: yDomain, range: [innerHeight, 0], nice: true }),
    [yDomain, innerHeight]
  );

  const getX = useCallback((d: SpreadDataPoint) => xScale(d.timestamp) ?? 0, [xScale]);
  const getPoolY = useCallback((d: SpreadDataPoint) => yScale(d.poolPrice) ?? 0, [yScale]);
  const getOracleY = useCallback((d: SpreadDataPoint) => yScale(d.oraclePrice) ?? 0, [yScale]);

  const areaSegments = useMemo(
    () =>
      buildAreaSegments(
        visibleData,
        (d) => xScale(d) ?? 0,
        (d) => yScale(d) ?? 0
      ),
    [visibleData, xScale, yScale]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const svg = svgRef.current;
      if (!svg || visibleData.length === 0) return;

      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left - padding.left;

      const targetTime = xScale.invert(x).getTime();
      let closest = visibleData[0];
      let minDiff = Math.abs(visibleData[0].timestamp.getTime() - targetTime);

      for (const d of visibleData) {
        const diff = Math.abs(d.timestamp.getTime() - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = d;
        }
      }

      setTooltipData({
        timestamp: closest.timestamp,
        poolPrice: closest.poolPrice,
        oraclePrice: closest.oraclePrice,
        spreadPct: closest.spreadPct,
      });
      setTooltipLeft(event.clientX - rect.left);
      setTooltipTop(event.clientY - rect.top);
    },
    [visibleData, xScale, padding.left]
  );

  const handleMouseLeave = useCallback(() => setTooltipData(null), []);

  if (width <= 0 || height <= 0 || visibleData.length === 0) return null;

  const exceeds = tooltipData ? Math.abs(tooltipData.spreadPct) > SPREAD_THRESHOLD : false;

  // Decide x-axis tick format based on zoom level
  const timeSpanMs = xDomain[1].getTime() - xDomain[0].getTime();
  const showHours = timeSpanMs < 7 * 24 * 3600 * 1000; // less than 7 days

  return (
    <div className="relative">
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          <clipPath id="spread-chart-clip">
            <rect x={0} y={0} width={innerWidth} height={innerHeight} />
          </clipPath>
        </defs>

        <g transform={`translate(${padding.left}, ${padding.top})`}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--bp-border-subtle)"
            strokeOpacity={0.5}
            strokeDasharray="2 4"
            numTicks={5}
          />

          <g clipPath="url(#spread-chart-clip)">
            {areaSegments.map((seg, i) => (
              <path
                key={i}
                d={seg.path}
                fill={seg.isExceeding ? COLORS.redFill : COLORS.greenFill}
                stroke="none"
              />
            ))}

            <LinePath
              data={visibleData}
              x={getX}
              y={getOracleY}
              stroke={COLORS.oraclePrice}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              curve={curveMonotoneX}
              strokeOpacity={0.8}
            />

            <LinePath
              data={visibleData}
              x={getX}
              y={getPoolY}
              stroke={COLORS.poolPrice}
              strokeWidth={2}
              curve={curveMonotoneX}
            />
          </g>

          {tooltipData && (
            <line
              x1={xScale(tooltipData.timestamp)}
              x2={xScale(tooltipData.timestamp)}
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
            numTicks={5}
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
            tickFormat={(v) => formatPriceAxis(v as number)}
          />

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
                return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.getHours().toString().padStart(2, "0")}:00`;
              }
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            }}
          />

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

      {tooltipData && (
        <div
          className="absolute pointer-events-none z-20 rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)]/50 px-3 py-2 text-[10px] backdrop-blur-sm shadow-lg"
          style={{
            left: Math.min(tooltipLeft + 10, width - 180),
            top: Math.max(tooltipTop - 100, 10),
          }}
        >
          <div className="font-mono text-[var(--bp-text-muted)] mb-1.5 pb-1.5 border-b border-[var(--bp-border-subtle)]">
            {tooltipData.timestamp.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}{" "}
            {tooltipData.timestamp.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded" style={{ background: COLORS.poolPrice }} />
                <span style={{ color: COLORS.poolPrice }}>Pool</span>
              </span>
              <span className="font-mono font-medium text-[var(--bp-text-primary)]">
                {formatPriceTooltip(tooltipData.poolPrice)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 rounded" style={{ background: COLORS.oraclePrice }} />
                <span style={{ color: COLORS.oraclePrice }}>{oracleLabel}</span>
              </span>
              <span className="font-mono text-[var(--bp-text-secondary)]">
                {formatPriceTooltip(tooltipData.oraclePrice)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 pt-1 border-t border-[var(--bp-border-subtle)]">
              <span className="text-[var(--bp-text-muted)]">Spread</span>
              <span
                className="font-mono font-medium"
                style={{ color: exceeds ? "#ef4444" : "#22c55e" }}
              >
                {tooltipData.spreadPct >= 0 ? "+" : ""}
                {tooltipData.spreadPct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Deviation Table ──────────────────────────────────────────────────────────

type SortField = "period" | "duration" | "max";
type SortDir = "asc" | "desc";

const SORT_ARROW = { asc: "\u2191", desc: "\u2193" };

const DeviationTable = ({
  deviations,
  selectedIndex,
  onSelect,
  onReset,
  isZoomed,
}: {
  deviations: DeviationEvent[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReset: () => void;
  isZoomed: boolean;
}) => {
  const [sortField, setSortField] = useState<SortField>("period");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return prev;
      }
      // Default direction per field
      const defaultDir: SortDir = field === "period" ? "desc" : "desc";
      setSortDir(defaultDir);
      return field;
    });
  }, []);

  // Sorted deviations with original indices preserved
  const sortedDeviations = useMemo(() => {
    const indexed = deviations.map((dev, i) => ({ dev, originalIndex: i }));
    indexed.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "period":
          cmp = a.dev.start.getTime() - b.dev.start.getTime();
          break;
        case "duration":
          cmp = a.dev.durationMs - b.dev.durationMs;
          break;
        case "max":
          cmp = a.dev.maxAbsSpread - b.dev.maxAbsSpread;
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return indexed;
  }, [deviations, sortField, sortDir]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bp-border-subtle)]">
        <span
          className="text-[10px] uppercase tracking-wider text-[var(--bp-text-muted)] font-semibold"
          style={{ fontFamily: "var(--bp-font-mono)" }}
        >
          Deviations &gt; 2%
        </span>
        {isZoomed && (
          <button
            onClick={onReset}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--bp-bg-surface)] border border-[var(--bp-border-subtle)] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] hover:border-[var(--bp-accent-primary)] transition-colors"
          >
            Reset zoom
          </button>
        )}
      </div>

      {deviations.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-3">
          <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
            No deviations &gt; 2%
          </span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_56px] gap-1 px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-[var(--bp-text-muted)] border-b border-[var(--bp-border-subtle)] sticky top-0 bg-[var(--bp-bg-card)]">
            <button onClick={() => handleSort("period")} className="text-left hover:text-[var(--bp-text-primary)] transition-colors cursor-pointer">
              Period {sortField === "period" && SORT_ARROW[sortDir]}
            </button>
            <button onClick={() => handleSort("duration")} className="text-right hover:text-[var(--bp-text-primary)] transition-colors cursor-pointer">
              Duration {sortField === "duration" && SORT_ARROW[sortDir]}
            </button>
            <button onClick={() => handleSort("max")} className="text-right hover:text-[var(--bp-text-primary)] transition-colors cursor-pointer">
              Max {sortField === "max" && SORT_ARROW[sortDir]}
            </button>
          </div>

          {sortedDeviations.map(({ dev, originalIndex }) => {
            const isSelected = selectedIndex === originalIndex;
            return (
              <button
                key={originalIndex}
                onClick={() => onSelect(originalIndex)}
                className={cn(
                  "grid grid-cols-[1fr_60px_56px] gap-1 px-3 py-1.5 w-full text-left transition-colors",
                  "hover:bg-[var(--bp-bg-surface)]",
                  isSelected && "bg-[var(--bp-bg-surface)] border-l-2 border-l-[var(--bp-accent-primary)]"
                )}
              >
                <span className="text-[10px] font-mono text-[var(--bp-text-secondary)] truncate">
                  {dev.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {" - "}
                  {dev.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className="text-[10px] font-mono text-[var(--bp-text-primary)] text-right font-medium">
                  {formatDuration(dev.durationMs)}
                </span>
                <span
                  className="text-[10px] font-mono text-right font-medium"
                  style={{ color: "#ef4444" }}
                >
                  {dev.maxAbsSpread.toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Legend ────────────────────────────────────────────────────────────────────

const SpreadLegend = ({ oracleLabel = "CoinGecko" }: { oracleLabel?: string }) => (
  <div className="flex flex-wrap items-center justify-center gap-4 mt-2">
    <div className="flex items-center gap-2">
      <svg width="24" height="12">
        <line x1="0" y1="6" x2="24" y2="6" stroke={COLORS.poolPrice} strokeWidth={2} />
      </svg>
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">Pool Price</span>
    </div>
    <div className="flex items-center gap-2">
      <svg width="24" height="12">
        <line x1="0" y1="6" x2="24" y2="6" stroke={COLORS.oraclePrice} strokeWidth={1.5} strokeDasharray="4 4" />
      </svg>
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">{oracleLabel}</span>
    </div>
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm" style={{ background: COLORS.greenFill, border: `1px solid ${COLORS.greenStroke}` }} />
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">&le; 2% spread</span>
    </div>
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm" style={{ background: COLORS.redFill, border: `1px solid ${COLORS.redStroke}` }} />
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">&gt; 2% spread</span>
    </div>
  </div>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

export const PriceSpreadChart = ({
  data,
  poolAddress,
  token0Address,
  token0Decimals,
  token1Decimals,
  invert,
  spaceSlug,
  className,
}: {
  data: SpreadDataPoint[];
  poolAddress?: string;
  token0Address?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  invert?: boolean;
  spaceSlug?: string | null;
  className?: string;
}) => {
  const [selectedDeviation, setSelectedDeviation] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<[Date, Date] | null>(null);

  const deviations = useMemo(() => computeDeviations(data, SPREAD_THRESHOLD), [data]);

  const isZoomed = zoomRange !== null;

  // Fetch hourly data when zoomed into a deviation (≤90d window → CoinGecko hourly)
  const zoomResult = usePriceSpreadZoom({
    poolAddress: poolAddress ?? "",
    token0Address,
    token0Decimals,
    token1Decimals,
    invert,
    spaceSlug,
    startTime: zoomRange ? Math.floor(zoomRange[0].getTime() / 1000) : null,
    endTime: zoomRange ? Math.ceil(zoomRange[1].getTime() / 1000) : null,
  });
  const oracleLabel = isDemoSpaceSlug(spaceSlug) ? "Demo oracle" : "CoinGecko";

  // Use hourly zoom data when available, otherwise filter daily overview data
  const chartData = isZoomed && zoomResult.data.length > 0
    ? zoomResult.data
    : data;

  const handleSelect = useCallback(
    (index: number) => {
      const dev = deviations[index];
      if (!dev) return;

      // Add 10% padding around the deviation period
      const pad = Math.max(dev.durationMs * 0.1, 3600 * 1000); // at least 1 hour
      const start = new Date(dev.start.getTime() - pad);
      const end = new Date(dev.end.getTime() + pad);

      setSelectedDeviation(index);
      setZoomRange([start, end]);
    },
    [deviations]
  );

  const handleReset = useCallback(() => {
    setSelectedDeviation(null);
    setZoomRange(null);
  }, []);

  return (
    <div className={cn("flex flex-col w-full h-full min-h-[200px]", className)}>
      <div className="flex-1 min-h-0 flex">
        {/* Chart area */}
        <div className="flex-1 min-w-0 relative">
          {isZoomed && zoomResult.isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bp-bg-card)]/50 backdrop-blur-sm">
              <div className="w-4 h-4 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
            </div>
          )}
          <ParentSize debounceTime={50}>
            {({ width, height }) => (
              <PriceSpreadChartInner
                data={chartData}
                width={width}
                height={Math.max(height, 160)}
                zoomRange={isZoomed && zoomResult.data.length > 0 ? null : zoomRange}
                oracleLabel={oracleLabel}
              />
            )}
          </ParentSize>
        </div>

        {/* Deviation table */}
        <div className="w-[260px] shrink-0 border-l border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)]">
          <DeviationTable
            deviations={deviations}
            selectedIndex={selectedDeviation}
            onSelect={handleSelect}
            onReset={handleReset}
            isZoomed={isZoomed}
          />
        </div>
      </div>

      <SpreadLegend oracleLabel={oracleLabel} />
    </div>
  );
};
