"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { LinePath, Bar } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { curveLinear } from "@visx/curve";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MMLiquidityDataPoint {
  timestamp: Date;
  liquidityUsd: number;
}

export interface LowLiquidityEvent {
  start: Date;
  end: Date;
  durationMs: number;
  minLiquidity: number;
  avgLiquidity: number;
  pointCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LOW_LIQUIDITY_THRESHOLD = 10_000; // $10k

const COLORS = {
  liquidityLine: "var(--bp-text-primary)",
  thresholdLine: "#ef4444",
  normalFill: "rgba(99, 102, 241, 0.12)",
  lowFill: "rgba(239, 68, 68, 0.20)",
  normalStroke: "rgba(99, 102, 241, 0.4)",
  lowStroke: "rgba(239, 68, 68, 0.4)",
};

function formatUsdAxis(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

function formatUsdTooltip(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${totalMinutes}m`;
}

/**
 * Detect contiguous periods where liquidity is below the threshold.
 */
export function computeLowLiquidityEvents(
  data: MMLiquidityDataPoint[],
  threshold: number = LOW_LIQUIDITY_THRESHOLD
): LowLiquidityEvent[] {
  const events: LowLiquidityEvent[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i].liquidityUsd < threshold) {
      const start = i;
      let min = data[i].liquidityUsd;
      let sum = data[i].liquidityUsd;
      let count = 1;
      i++;
      while (i < data.length && data[i].liquidityUsd < threshold) {
        if (data[i].liquidityUsd < min) min = data[i].liquidityUsd;
        sum += data[i].liquidityUsd;
        count++;
        i++;
      }
      const end = i - 1;
      events.push({
        start: data[start].timestamp,
        end: data[end].timestamp,
        durationMs: data[end].timestamp.getTime() - data[start].timestamp.getTime(),
        minLiquidity: min,
        avgLiquidity: sum / count,
        pointCount: count,
      });
    } else {
      i++;
    }
  }
  return events;
}

// ─── Chart Inner ──────────────────────────────────────────────────────────────

interface TooltipData {
  timestamp: Date;
  liquidityUsd: number;
}

const MMLiquidityChartInner = ({
  data,
  width,
  height,
  zoomRange,
}: {
  data: MMLiquidityDataPoint[];
  width: number;
  height: number;
  zoomRange: [Date, Date] | null;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState(0);
  const [tooltipTop, setTooltipTop] = useState(0);

  const padding = { top: 20, right: 15, bottom: 40, left: 65 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);

  const visibleData = useMemo(() => {
    if (!zoomRange) return data;
    const [zStart, zEnd] = zoomRange;
    return data.filter((d) => d.timestamp >= zStart && d.timestamp <= zEnd);
  }, [data, zoomRange]);

  const { xDomain, yDomain } = useMemo(() => {
    if (visibleData.length === 0) {
      return {
        xDomain: [new Date(), new Date()] as [Date, Date],
        yDomain: [0, 20_000] as [number, number],
      };
    }
    let minTime = Infinity;
    let maxTime = -Infinity;
    let maxLiq = -Infinity;

    for (const d of visibleData) {
      const ts = d.timestamp.getTime();
      if (ts < minTime) minTime = ts;
      if (ts > maxTime) maxTime = ts;
      if (d.liquidityUsd > maxLiq) maxLiq = d.liquidityUsd;
    }
    // Always include 0 on y-axis and pad top by 10%
    const yMax = Math.max(maxLiq * 1.1, LOW_LIQUIDITY_THRESHOLD * 2);
    return {
      xDomain: [new Date(minTime), new Date(maxTime)] as [Date, Date],
      yDomain: [0, yMax] as [number, number],
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

  const getX = useCallback(
    (d: MMLiquidityDataPoint) => xScale(d.timestamp) ?? 0,
    [xScale]
  );
  const getY = useCallback(
    (d: MMLiquidityDataPoint) => yScale(d.liquidityUsd) ?? 0,
    [yScale]
  );

  // Build area segments colored by whether liquidity is below threshold
  const areaSegments = useMemo(() => {
    if (visibleData.length < 2) return [];
    const segments: { path: string; isLow: boolean }[] = [];
    for (let i = 0; i < visibleData.length - 1; i++) {
      const d0 = visibleData[i];
      const d1 = visibleData[i + 1];
      const x0 = xScale(d0.timestamp) ?? 0;
      const x1 = xScale(d1.timestamp) ?? 0;
      const y0 = yScale(d0.liquidityUsd) ?? 0;
      const y1 = yScale(d1.liquidityUsd) ?? 0;
      const yBase = yScale(0) ?? 0;
      const isLow = d0.liquidityUsd < LOW_LIQUIDITY_THRESHOLD || d1.liquidityUsd < LOW_LIQUIDITY_THRESHOLD;
      const path = `M${x0},${y0} L${x1},${y1} L${x1},${yBase} L${x0},${yBase} Z`;
      segments.push({ path, isLow });
    }
    return segments;
  }, [visibleData, xScale, yScale]);

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
      setTooltipData({ timestamp: closest.timestamp, liquidityUsd: closest.liquidityUsd });
      setTooltipLeft(event.clientX - rect.left);
      setTooltipTop(event.clientY - rect.top);
    },
    [visibleData, xScale, padding.left]
  );

  const handleMouseLeave = useCallback(() => setTooltipData(null), []);

  if (width <= 0 || height <= 0 || visibleData.length === 0) return null;

  const thresholdY = yScale(LOW_LIQUIDITY_THRESHOLD) ?? 0;
  const timeSpanMs = xDomain[1].getTime() - xDomain[0].getTime();
  const showHours = timeSpanMs < 7 * 24 * 3600 * 1000;

  return (
    <div className="relative">
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          <clipPath id="mm-liq-chart-clip">
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

          <g clipPath="url(#mm-liq-chart-clip)">
            {/* Area fills */}
            {areaSegments.map((seg, i) => (
              <path
                key={i}
                d={seg.path}
                fill={seg.isLow ? COLORS.lowFill : COLORS.normalFill}
                stroke="none"
              />
            ))}

            {/* $10k threshold line */}
            <line
              x1={0}
              x2={innerWidth}
              y1={thresholdY}
              y2={thresholdY}
              stroke={COLORS.thresholdLine}
              strokeWidth={1}
              strokeDasharray="6 4"
              strokeOpacity={0.6}
            />

            {/* Liquidity line */}
            <LinePath
              data={visibleData}
              x={getX}
              y={getY}
              stroke={COLORS.liquidityLine}
              strokeWidth={2}
              curve={curveLinear}
            />
          </g>

          {/* Tooltip crosshair */}
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
            tickFormat={(v) => formatUsdAxis(v as number)}
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

      {/* Tooltip */}
      {tooltipData && (
        <div
          className="absolute pointer-events-none z-20 rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)]/50 px-3 py-2 text-[10px] backdrop-blur-sm shadow-lg"
          style={{
            left: Math.min(tooltipLeft + 10, width - 180),
            top: Math.max(tooltipTop - 80, 10),
          }}
        >
          <div className="font-mono text-[var(--bp-text-muted)] mb-1.5 pb-1.5 border-b border-[var(--bp-border-subtle)]">
            {tooltipData.timestamp.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[var(--bp-text-muted)]">Liquidity</span>
            <span
              className="font-mono font-medium"
              style={{
                color: tooltipData.liquidityUsd < LOW_LIQUIDITY_THRESHOLD ? "#ef4444" : "var(--bp-text-primary)",
              }}
            >
              {formatUsdTooltip(tooltipData.liquidityUsd)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Low Liquidity Events Table ───────────────────────────────────────────────

type SortField = "period" | "duration" | "min";
type SortDir = "asc" | "desc";
const SORT_ARROW = { asc: "\u2191", desc: "\u2193" };

const LowLiquidityTable = ({
  events,
  selectedIndex,
  onSelect,
  onReset,
  isZoomed,
}: {
  events: LowLiquidityEvent[];
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
      setSortDir("desc");
      return field;
    });
  }, []);

  const sortedEvents = useMemo(() => {
    const indexed = events.map((ev, i) => ({ ev, originalIndex: i }));
    indexed.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "period":
          cmp = a.ev.start.getTime() - b.ev.start.getTime();
          break;
        case "duration":
          cmp = a.ev.durationMs - b.ev.durationMs;
          break;
        case "min":
          cmp = a.ev.minLiquidity - b.ev.minLiquidity;
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return indexed;
  }, [events, sortField, sortDir]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bp-border-subtle)]">
        <span
          className="text-[10px] uppercase tracking-wider text-[var(--bp-text-muted)] font-semibold"
          style={{ fontFamily: "var(--bp-font-mono)" }}
        >
          Below $10k
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

      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-3">
          <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
            No events below $10k
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
            <button onClick={() => handleSort("min")} className="text-right hover:text-[var(--bp-text-primary)] transition-colors cursor-pointer">
              Min {sortField === "min" && SORT_ARROW[sortDir]}
            </button>
          </div>

          {sortedEvents.map(({ ev, originalIndex }) => {
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
                  {ev.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {" - "}
                  {ev.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className="text-[10px] font-mono text-[var(--bp-text-primary)] text-right font-medium">
                  {formatDuration(ev.durationMs)}
                </span>
                <span
                  className="text-[10px] font-mono text-right font-medium"
                  style={{ color: "#ef4444" }}
                >
                  {formatUsdAxis(ev.minLiquidity)}
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

const MMLiquidityLegend = () => (
  <div className="flex flex-wrap items-center justify-center gap-4 mt-2">
    <div className="flex items-center gap-2">
      <svg width="24" height="12">
        <line x1="0" y1="6" x2="24" y2="6" stroke={COLORS.liquidityLine} strokeWidth={2} />
      </svg>
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">Liquidity (USD)</span>
    </div>
    <div className="flex items-center gap-2">
      <svg width="24" height="12">
        <line x1="0" y1="6" x2="24" y2="6" stroke={COLORS.thresholdLine} strokeWidth={1} strokeDasharray="6 4" strokeOpacity={0.6} />
      </svg>
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">$10k Threshold</span>
    </div>
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm" style={{ background: COLORS.normalFill, border: `1px solid ${COLORS.normalStroke}` }} />
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">Above $10k</span>
    </div>
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-sm" style={{ background: COLORS.lowFill, border: `1px solid ${COLORS.lowStroke}` }} />
      <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">Below $10k</span>
    </div>
  </div>
);

// ─── Main Export ──────────────────────────────────────────────────────────────

export const MMLiquidityChart = ({
  data,
  className,
}: {
  data: MMLiquidityDataPoint[];
  className?: string;
}) => {
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [zoomRange, setZoomRange] = useState<[Date, Date] | null>(null);

  const lowLiqEvents = useMemo(
    () => computeLowLiquidityEvents(data, LOW_LIQUIDITY_THRESHOLD),
    [data]
  );

  const isZoomed = zoomRange !== null;

  const handleSelect = useCallback(
    (index: number) => {
      const ev = lowLiqEvents[index];
      if (!ev) return;
      const pad = Math.max(ev.durationMs * 0.5, 2 * 86400 * 1000); // at least 2 days padding
      const start = new Date(ev.start.getTime() - pad);
      const end = new Date(ev.end.getTime() + pad);
      setSelectedEvent(index);
      setZoomRange([start, end]);
    },
    [lowLiqEvents]
  );

  const handleReset = useCallback(() => {
    setSelectedEvent(null);
    setZoomRange(null);
  }, []);

  return (
    <div className={cn("flex flex-col w-full h-full min-h-[200px]", className)}>
      <div className="flex-1 min-h-0 flex">
        {/* Chart area */}
        <div className="flex-1 min-w-0 relative">
          <ParentSize debounceTime={50}>
            {({ width, height }) => (
              <MMLiquidityChartInner
                data={data}
                width={width}
                height={Math.max(height, 160)}
                zoomRange={zoomRange}
              />
            )}
          </ParentSize>
        </div>

        {/* Events table */}
        <div className="w-[260px] shrink-0 border-l border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)]">
          <LowLiquidityTable
            events={lowLiqEvents}
            selectedIndex={selectedEvent}
            onSelect={handleSelect}
            onReset={handleReset}
            isZoomed={isZoomed}
          />
        </div>
      </div>

      <MMLiquidityLegend />
    </div>
  );
};
