"use client";

import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import { Bar } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import type { HourOfDayVolume, DayOfWeekVolume } from "@/hooks/use-volume-by-time";

// ---------- helpers ----------

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return "$0";
}

// ---------- Shared bar sub-chart ----------

interface BarSubChartProps<T> {
  data: T[];
  getLabel: (d: T) => string;
  getValue: (d: T) => number;
  getTooltip: (d: T) => string;
  width: number;
  height: number;
  barColor: string;
  barHoverColor: string;
}

function BarSubChart<T>({
  data,
  getLabel,
  getValue,
  getTooltip,
  width,
  height,
  barColor,
  barHoverColor,
}: BarSubChartProps<T>) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const margin = { top: 8, right: 8, bottom: 32, left: 52 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: data.map(getLabel),
        range: [0, innerW],
        padding: 0.25,
      }),
    [data, getLabel, innerW]
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const d of data) {
      const v = getValue(d);
      if (v > max) max = v;
    }
    return max * 1.1 || 1;
  }, [data, getValue]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  // Show every label for day-of-week, every 3rd for hours
  const xTickValues = useMemo(() => {
    const labels = data.map(getLabel);
    if (labels.length <= 7) return labels;
    // For 24 hours, show every 3rd: 12 AM, 3 AM, 6 AM, ...
    return labels.filter((_, i) => i % 3 === 0);
  }, [data, getLabel]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (data.length === 0 || innerW <= 0) return;
      const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left - margin.left;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const bx = (xScale(getLabel(data[i])) ?? 0) + (xScale.bandwidth() / 2);
        const dist = Math.abs(bx - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      setHoverIndex(closest);
    },
    [data, xScale, getLabel, innerW, margin.left]
  );

  if (width === 0 || height === 0) return null;

  const tooltipItem = hoverIndex !== null ? data[hoverIndex] : null;
  const tooltipX = tooltipItem
    ? (xScale(getLabel(tooltipItem)) ?? 0) + xScale.bandwidth() / 2
    : 0;
  const tooltipY = tooltipItem ? yScale(getValue(tooltipItem)) : 0;

  return (
    <svg width={width} height={height}>
      <Group left={margin.left} top={margin.top}>
        <GridRows
          scale={yScale}
          width={innerW}
          numTicks={4}
          stroke="var(--bp-border-subtle)"
          strokeDasharray="2,2"
          strokeOpacity={0.5}
        />
        {data.map((d, i) => {
          const label = getLabel(d);
          const value = getValue(d);
          const barX = xScale(label) ?? 0;
          const barHeight = innerH - yScale(value);
          const barY = yScale(value);
          const isHovered = hoverIndex === i;
          return (
            <Bar
              key={label}
              x={barX}
              y={barY}
              width={xScale.bandwidth()}
              height={Math.max(0, barHeight)}
              fill={isHovered ? barHoverColor : barColor}
              rx={2}
              opacity={hoverIndex !== null && !isHovered ? 0.5 : 1}
            />
          );
        })}
        <AxisBottom
          top={innerH}
          scale={xScale}
          tickValues={xTickValues}
          tickLabelProps={() => ({
            fill: "var(--bp-text-muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            textAnchor: "middle",
            dy: "0.2em",
          })}
          stroke="var(--bp-border-subtle)"
          tickStroke="var(--bp-border-subtle)"
          tickLength={3}
          hideAxisLine={false}
        />
        <AxisLeft
          scale={yScale}
          numTicks={4}
          tickFormat={(v) => formatUsdCompact(v as number)}
          tickLabelProps={() => ({
            fill: "var(--bp-text-muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            textAnchor: "end",
            dx: "-0.3em",
            dy: "0.3em",
          })}
          stroke="var(--bp-border-subtle)"
          tickStroke="var(--bp-border-subtle)"
          tickLength={3}
          hideAxisLine={false}
        />
        {/* Hover detection overlay */}
        <rect
          x={0}
          y={0}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        />
        {/* Tooltip */}
        {tooltipItem && (
          <g>
            <line
              x1={tooltipX}
              x2={tooltipX}
              y1={0}
              y2={innerH}
              stroke="var(--bp-text-muted)"
              strokeWidth={1}
              strokeDasharray="3,3"
              strokeOpacity={0.5}
              pointerEvents="none"
            />
            <circle
              cx={tooltipX}
              cy={tooltipY}
              r={3.5}
              fill={barHoverColor}
              stroke="var(--bp-bg-primary)"
              strokeWidth={1.5}
              pointerEvents="none"
            />
            {/* Tooltip label */}
            <foreignObject
              x={Math.min(tooltipX + 8, innerW - 130)}
              y={Math.max(tooltipY - 40, 0)}
              width={130}
              height={36}
              pointerEvents="none"
            >
              <div
                style={{
                  background: "white",
                  border: "1px solid #e2e2e2",
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 11,
                  color: "#1a1a1a",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "nowrap",
                  lineHeight: "1.4",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                }}
              >
                {getTooltip(tooltipItem)}
              </div>
            </foreignObject>
          </g>
        )}
      </Group>
    </svg>
  );
}

// ---------- Exported compound chart ----------

interface VolumeByTimeChartProps {
  byHour: HourOfDayVolume[];
  byDay: DayOfWeekVolume[];
  isLoading?: boolean;
}

export function VolumeByTimeChart({ byHour, byDay, isLoading }: VolumeByTimeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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

  const hasData = byHour.some((h) => h.volumeUsd > 0) || byDay.some((d) => d.volumeUsd > 0);

  if (isLoading || (width === 0 && height === 0)) {
    return (
      <div ref={containerRef} className="w-full h-full min-h-[240px]">
        <div className="flex items-center justify-center h-full">
          <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div ref={containerRef} className="w-full h-full min-h-[240px]">
        <div className="flex items-center justify-center h-full text-sm text-[var(--bp-text-muted)]">
          No volume data available
        </div>
      </div>
    );
  }

  // Split width: ~60% for hourly (24 bars), ~40% for daily (7 bars)
  const gap = 16;
  const hourWidth = Math.floor((width - gap) * 0.6);
  const dayWidth = width - hourWidth - gap;
  const chartHeight = Math.max(180, height);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[240px]">
      {width > 0 && height > 0 && (
        <div className="flex gap-4 h-full">
          <div className="flex-1 min-w-0" style={{ flex: "0 0 60%" }}>
            <div className="text-[11px] font-semibold text-[var(--bp-text-secondary)] tracking-wide mb-1 pl-1">
              Avg Volume by Hour of Day (EST)
            </div>
            <BarSubChart
              data={byHour}
              getLabel={(d) => d.label}
              getValue={(d) => d.volumeUsd}
              getTooltip={(d) =>
                `${d.label}: ${formatUsdCompact(d.volumeUsd)}`
              }
              width={hourWidth}
              height={chartHeight - 20}
              barColor="#4A90D9"
              barHoverColor="#6AAFEF"
            />
          </div>
          <div className="flex-1 min-w-0" style={{ flex: "0 0 38%" }}>
            <div className="text-[11px] font-semibold text-[var(--bp-text-secondary)] tracking-wide mb-1 pl-1">
              Avg Volume by Day of Week (EST)
            </div>
            <BarSubChart
              data={byDay}
              getLabel={(d) => d.label}
              getValue={(d) => d.volumeUsd}
              getTooltip={(d) =>
                `${d.label}: ${formatUsdCompact(d.volumeUsd)}`
              }
              width={dayWidth}
              height={chartHeight - 20}
              barColor="#8B7BA1"
              barHoverColor="#A892C1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
