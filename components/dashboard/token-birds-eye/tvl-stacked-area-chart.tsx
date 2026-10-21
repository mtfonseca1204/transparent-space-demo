"use client";

import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaStack, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";
import { formatCompact, type TokenDashboardData } from "@/hooks/use-token-dashboard-data";

const AREA_COLORS = [
  "#4A6CF7", "#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899", "#10B981",
];

interface ChartDataPoint {
  date: string;
  [seriesKey: string]: number | string;
}

interface TVLStackedAreaChartProps {
  data: TokenDashboardData;
}

export function TVLStackedAreaChart({ data }: TVLStackedAreaChartProps) {
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

  // Build chart data: align all pools to same date axis
  const { chartData, series } = useMemo(() => {
    const dateMap = new Map<number, Record<string, number>>();
    const localSeries: { key: string; label: string }[] = [];

    for (const row of data.pools) {
      const key = row.pool.poolKey;
      localSeries.push({ key, label: row.pool.label });

      // Use pre-computed dailyTvl from event-replay history
      for (const dt of row.dailyTvl) {
        if (!dateMap.has(dt.date)) dateMap.set(dt.date, {});
        const entry = dateMap.get(dt.date)!;
        entry[key] = dt.tvlUsd;
      }
    }

    // Sort dates ascending
    const sortedDates = [...dateMap.keys()].sort((a, b) => a - b);

    const points: ChartDataPoint[] = sortedDates.map((ts) => {
      const d = new Date(ts * 1000);
      const dateStr = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      const entry = dateMap.get(ts) ?? {};
      const point: ChartDataPoint = { date: dateStr };
      for (const item of localSeries) {
        point[item.key] = entry[item.key] ?? 0;
      }
      return point;
    });

    return { chartData: points, series: localSeries };
  }, [data.pools]);

  const { width, height } = dimensions;
  const margin = { top: 8, right: 8, bottom: 28, left: 40 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: chartData.map((d) => d.date),
        range: [0, innerW],
        padding: 0.1,
      }),
    [chartData, innerW]
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      let sum = 0;
        for (const item of series) {
          sum += (d[item.key] as number) ?? 0;
        }
      if (sum > max) max = sum;
    }
    return max * 1.1 || 1;
  }, [chartData, series]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    series.forEach((item, i) => {
      map.set(item.key, AREA_COLORS[i % AREA_COLORS.length]);
    });
    return map;
  }, [series]);

  // X-axis: pick ~5-7 evenly spaced tick labels to avoid overlap
  const xTickValues = useMemo(() => {
    const n = chartData.length;
    if (n <= 7) return chartData.map((d) => d.date);
    const step = Math.max(1, Math.floor(n / 6));
    const ticks: string[] = [];
    for (let i = 0; i < n; i += step) {
      ticks.push(chartData[i].date);
    }
    // Always include the last date
    const lastDate = chartData[n - 1].date;
    if (ticks[ticks.length - 1] !== lastDate) {
      ticks.push(lastDate);
    }
    return ticks;
  }, [chartData]);

  // Tooltip: find nearest data point from mouse x
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (chartData.length === 0 || innerW <= 0) return;
      const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left - margin.left;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < chartData.length; i++) {
        const px = xScale(chartData[i].date) ?? 0;
        const dist = Math.abs(px - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      setHoverIndex(closest);
    },
    [chartData, xScale, innerW, margin.left]
  );

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  const netFlowStr = data.netFlow7dUsd >= 0
    ? `+${formatCompact(data.netFlow7dUsd)}`
    : `-${formatCompact(Math.abs(data.netFlow7dUsd))}`;

  // Tooltip data
  const tooltipData = hoverIndex !== null && chartData[hoverIndex] ? chartData[hoverIndex] : null;
  const tooltipX = tooltipData ? (xScale(tooltipData.date) ?? 0) : 0;

  return (
    <div className="bp-card relative flex flex-col" style={{ height: 188 }}>
      <div className="bp-card-inner" />
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          TVL &mdash; 14D
        </span>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-[8px] font-bold",
              data.netFlow7dUsd >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {netFlowStr} Net TVL
          </span>
          <div className="flex gap-2">
            {series.map((item, i) => (
              <span
                key={item.key}
                className="flex items-center gap-1 text-[7px] text-gray-400"
              >
                <span
                  className="inline-block w-1.5 h-0.5 rounded-sm"
                  style={{ background: AREA_COLORS[i % AREA_COLORS.length] }}
                />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {width > 0 && height > 0 && chartData.length > 0 && (
          <>
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  numTicks={3}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="2,2"
                  strokeOpacity={0.5}
                />
                <AreaStack
                  data={chartData}
                  keys={series.map((item) => item.key)}
                  x={(d) => xScale(d.data.date) ?? 0}
                  y0={(d) => yScale(d[0]) ?? 0}
                  y1={(d) => yScale(d[1]) ?? 0}
                  curve={curveMonotoneX}
                >
                  {({ stacks, path }) => (
                    <>
                      {/* Area fills only — no stroke on fills to avoid bottom-edge bleed */}
                      {stacks.map((stack) => (
                        <path
                          key={`area-${stack.key}`}
                          d={path(stack) || ""}
                          fill={colorMap.get(stack.key) ?? "#ccc"}
                          fillOpacity={0.35}
                          stroke="none"
                        />
                      ))}
                      {/* Top-edge strokes — each line matches its own area color */}
                      {stacks.map((stack) => (
                        <LinePath
                          key={`line-${stack.key}`}
                          data={stack}
                          x={(d) => xScale(d.data.date) ?? 0}
                          y={(d) => yScale(d[1]) ?? 0}
                          stroke={colorMap.get(stack.key) ?? "#ccc"}
                          strokeWidth={1.5}
                          curve={curveMonotoneX}
                        />
                      ))}
                    </>
                  )}
                </AreaStack>
                {/* Hover crosshair line */}
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
                  numTicks={3}
                  tickFormat={(v) => formatCompact(v as number)}
                  stroke="transparent"
                  tickStroke="transparent"
                  tickLabelProps={() => ({
                    fill: "var(--bp-text-muted)",
                    fontSize: 8,
                    fontFamily: "Inter, sans-serif",
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
                    fontSize: 8,
                    fontFamily: "Inter, sans-serif",
                    textAnchor: "middle" as const,
                    dy: 8,
                  })}
                />
                {/* Invisible overlay for mouse tracking */}
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
            {/* Tooltip */}
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
                  <div className="text-[9px] font-bold text-gray-300 mb-1">
                    {tooltipData.date}
                  </div>
                  {series.map((item, i) => {
                    const val = (tooltipData[item.key] as number) ?? 0;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-3 text-[8px]"
                      >
                        <span className="flex items-center gap-1 text-gray-400">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-sm"
                            style={{ background: AREA_COLORS[i % AREA_COLORS.length] }}
                          />
                          {item.label}
                        </span>
                        <span className="text-gray-200 font-medium tabular-nums">
                          {formatCompact(val)}
                        </span>
                      </div>
                    );
                  })}
                  <div className="border-t border-gray-700/50 mt-1 pt-1 flex items-center justify-between text-[8px]">
                    <span className="text-gray-400 font-bold">Total</span>
                    <span className="text-white font-bold tabular-nums">
                      {formatCompact(
                        series.reduce(
                          (sum, item) => sum + ((tooltipData[item.key] as number) ?? 0),
                          0
                        )
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
