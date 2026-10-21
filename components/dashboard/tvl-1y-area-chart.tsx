"use client";

import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaClosed, LinePath, Bar } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";

interface DataPoint {
  date: string;
  value: number;
}

interface Simple1YAreaChartProps {
  data: DataPoint[];
  color?: string;
  gradientId?: string;
  className?: string;
  campaignPeriods?: Array<{ campaignId: string; start: string; end: string }>;
  selectedCampaignId?: string | null;
  /** "area" (default) renders area+line; "bar" renders vertical bars */
  variant?: "area" | "bar";
}

const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1e9) return `$${parseFloat((value / 1e9).toFixed(2))}B`;
  if (value >= 1e6) return `$${parseFloat((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `$${parseFloat((value / 1e3).toFixed(1))}K`;
  return `$${value.toFixed(0)}`;
};

/** Convert ISO date "2025-05-13" to the "Mon DD" label format used in chart data. */
function isoToLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Simple1YAreaChart({
  data,
  color = "#4A6CF7",
  gradientId = "simple1y-gradient",
  className,
  campaignPeriods = [],
  selectedCampaignId = null,
  variant = "area",
}: Simple1YAreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const margin = { top: 12, right: 12, bottom: 32, left: 52 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, innerW],
        padding: 0.1,
      }),
    [data, innerW]
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const d of data) {
      if (d.value > max) max = d.value;
    }
    return max * 1.1 || 1;
  }, [data]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  const xTickValues = useMemo(() => {
    const n = data.length;
    if (n <= 8) return data.map((d) => d.date);
    const step = Math.max(1, Math.floor(n / 7));
    const ticks: string[] = [];
    for (let i = 0; i < n; i += step) {
      ticks.push(data[i].date);
    }
    const lastDate = data[n - 1].date;
    if (ticks[ticks.length - 1] !== lastDate) {
      ticks.push(lastDate);
    }
    return ticks;
  }, [data]);

  // Campaign period bands: find x positions for campaign start/end labels
  const campaignBands = useMemo(() => {
    if (campaignPeriods.length === 0 || data.length === 0) return [];
    const findClosest = (label: string) => {
      const exact = data.findIndex((d) => d.date === label);
      if (exact >= 0) return exact;
      // Fallback: match by month+day prefix (handles "May 13, 2025" vs "May 13")
      const prefix = label.split(",")[0];
      const approx = data.findIndex((d) => d.date.startsWith(prefix));
      if (approx >= 0) return approx;
      return -1;
    };
    return campaignPeriods
      .map((period) => {
        const startLabel = isoToLabel(period.start);
        const endLabel = isoToLabel(period.end);
        const si = findClosest(startLabel);
        const ei = findClosest(endLabel);
        if (si < 0 && ei < 0) return null;
        const rawX1 = si >= 0 ? (xScale(data[si].date) ?? 0) : 0;
        const rawX2 = ei >= 0 ? (xScale(data[ei].date) ?? 0) : innerW;
        return {
          ...period,
          x1: Math.min(rawX1, rawX2),
          x2: Math.max(rawX1, rawX2),
          hasStart: si >= 0,
          hasEnd: ei >= 0,
        };
      })
      .filter((band): band is {
        campaignId: string;
        start: string;
        end: string;
        x1: number;
        x2: number;
        hasStart: boolean;
        hasEnd: boolean;
      } => band !== null);
  }, [campaignPeriods, data, xScale, innerW]);

  const visibleCampaignBands = useMemo(() => {
    if (!selectedCampaignId) return campaignBands;
    return campaignBands.filter((band) => band.campaignId === selectedCampaignId);
  }, [campaignBands, selectedCampaignId]);

  const showCampaignLabels = visibleCampaignBands.length === 1;

  // Bar width for bar variant
  const barWidth = useMemo(() => {
    if (variant !== "bar" || data.length < 2) return 6;
    const x0 = xScale(data[0].date) ?? 0;
    const x1 = xScale(data[1].date) ?? 0;
    return Math.max(2, Math.min(16, (x1 - x0) * 0.7));
  }, [variant, data, xScale]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (data.length === 0 || innerW <= 0) return;
      const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left - margin.left;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const px = xScale(data[i].date) ?? 0;
        const dist = Math.abs(px - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      setHoverIndex(closest);
    },
    [data, xScale, innerW, margin.left]
  );

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  const tooltipData = hoverIndex !== null && data[hoverIndex] ? data[hoverIndex] : null;
  const tooltipX = tooltipData ? (xScale(tooltipData.date) ?? 0) : 0;

  if (width === 0 || height === 0 || data.length === 0) {
    return (
      <div ref={containerRef} className={cn("w-full h-full min-h-[200px]", className)}>
        <div className="flex items-center justify-center h-full">
          <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("w-full h-full relative", className)}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerW}
            numTicks={4}
            stroke="var(--bp-border-subtle)"
            strokeDasharray="2,2"
            strokeOpacity={0.5}
          />
          {/* Campaign period shaded bands */}
          {visibleCampaignBands.map((band) => (
            <g key={band.campaignId}>
              <rect
                x={band.x1}
                y={0}
                width={Math.max(0, band.x2 - band.x1)}
                height={innerH}
                fill="var(--bp-accent-primary, #4A6CF7)"
                fillOpacity={selectedCampaignId ? 0.07 : 0.035}
                pointerEvents="none"
              />
              {band.hasStart && (
                <>
                  <line
                    x1={band.x1}
                    x2={band.x1}
                    y1={0}
                    y2={innerH}
                    stroke="var(--bp-accent-primary, #4A6CF7)"
                    strokeWidth={1}
                    strokeDasharray="4,3"
                    strokeOpacity={selectedCampaignId ? 0.55 : 0.28}
                    pointerEvents="none"
                  />
                  {showCampaignLabels && (
                    <text
                      x={band.x1 + 4}
                      y={10}
                      fill="var(--bp-accent-primary, #4A6CF7)"
                      fontSize={8}
                      fontFamily="var(--font-mono)"
                      fillOpacity={0.75}
                      pointerEvents="none"
                    >
                      Campaign start
                    </text>
                  )}
                </>
              )}
              {band.hasEnd && (
                <>
                  <line
                    x1={band.x2}
                    x2={band.x2}
                    y1={0}
                    y2={innerH}
                    stroke="var(--bp-accent-primary, #4A6CF7)"
                    strokeWidth={1}
                    strokeDasharray="4,3"
                    strokeOpacity={selectedCampaignId ? 0.55 : 0.28}
                    pointerEvents="none"
                  />
                  {showCampaignLabels && (
                    <text
                      x={band.x2 - 4}
                      y={10}
                      fill="var(--bp-accent-primary, #4A6CF7)"
                      fontSize={8}
                      fontFamily="var(--font-mono)"
                      fillOpacity={0.75}
                      textAnchor="end"
                      pointerEvents="none"
                    >
                      Campaign end
                    </text>
                  )}
                </>
              )}
            </g>
          ))}
          {variant === "bar" ? (
            data.map((d, i) => {
              const cx = xScale(d.date) ?? 0;
              const barH = innerH - (yScale(d.value) ?? 0);
              return (
                <Bar
                  key={d.date}
                  x={cx - barWidth / 2}
                  y={innerH - barH}
                  width={barWidth}
                  height={Math.max(0, barH)}
                  fill={color}
                  fillOpacity={hoverIndex === i ? 0.9 : 0.6}
                  rx={1}
                />
              );
            })
          ) : (
            <>
              <AreaClosed
                data={data}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.value) ?? 0}
                yScale={yScale}
                curve={curveMonotoneX}
                fill={`url(#${gradientId})`}
              />
              <LinePath
                data={data}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.value) ?? 0}
                stroke={color}
                strokeWidth={1.5}
                curve={curveMonotoneX}
              />
            </>
          )}
          {hoverIndex !== null && (
            <line
              x1={tooltipX}
              x2={tooltipX}
              y1={0}
              y2={innerH}
              stroke="var(--bp-text-muted)"
              strokeWidth={1}
              strokeDasharray="3,3"
              strokeOpacity={0.6}
              pointerEvents="none"
            />
          )}
          <AxisLeft
            scale={yScale}
            numTicks={4}
            tickFormat={(v) => formatCompact(v as number)}
            stroke="transparent"
            tickStroke="transparent"
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              textAnchor: "end" as const,
              dx: -4,
              dy: 3,
            })}
          />
          <AxisBottom
            scale={xScale}
            top={innerH}
            stroke="transparent"
            tickStroke="transparent"
            tickValues={xTickValues}
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              textAnchor: "middle" as const,
              dy: 8,
            })}
          />
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </Group>
      </svg>
      {tooltipData && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: margin.left + tooltipX + (tooltipX > innerW / 2 ? -8 : 8),
            top: margin.top + 4,
            transform: tooltipX > innerW / 2 ? "translateX(-100%)" : undefined,
          }}
        >
          <div className="bg-gray-900/95 dark:bg-gray-800/95 border border-gray-700/50 rounded-md px-2.5 py-1.5 shadow-lg backdrop-blur-sm">
            <div className="text-[9px] font-bold text-gray-300 mb-0.5">
              {tooltipData.date}
            </div>
            <div className="text-[11px] font-semibold text-white tabular-nums">
              {formatCompact(tooltipData.value)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Named exports for specific use cases
export function Tvl1YAreaChart({
  data,
  className,
  campaignPeriods,
  selectedCampaignId,
}: {
  data: { date: string; tvl: number }[];
  className?: string;
  campaignPeriods?: Array<{ campaignId: string; start: string; end: string }>;
  selectedCampaignId?: string | null;
}) {
  const mapped = useMemo(() => data.map((d) => ({ date: d.date, value: d.tvl })), [data]);
  return (
    <Simple1YAreaChart
      data={mapped}
      color="#4A6CF7"
      gradientId="tvl1y-gradient"
      className={className}
      campaignPeriods={campaignPeriods}
      selectedCampaignId={selectedCampaignId}
    />
  );
}

export function Volume1YAreaChart({
  data,
  className,
  campaignPeriods,
  selectedCampaignId,
  variant,
}: {
  data: { date: string; volume: number }[];
  className?: string;
  campaignPeriods?: Array<{ campaignId: string; start: string; end: string }>;
  selectedCampaignId?: string | null;
  variant?: "area" | "bar";
}) {
  const mapped = useMemo(() => data.map((d) => ({ date: d.date, value: d.volume })), [data]);
  return (
    <Simple1YAreaChart
      data={mapped}
      color="#10B981"
      gradientId="vol1y-gradient"
      className={className}
      campaignPeriods={campaignPeriods}
      selectedCampaignId={selectedCampaignId}
      variant={variant}
    />
  );
}
