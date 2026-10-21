"use client";

import React, { useMemo, useRef, useState, useLayoutEffect } from "react";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaStack, Line } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";
import { LP_COLORS, OTHERS_COLOR } from "@/components/custom-metrics/metric-colors";

interface ChartDataPoint {
  date: string;
  [address: string]: number | string;
}

interface LiquidityHistoryByAddressChartProps {
  data: ChartDataPoint[];
  topAddresses: string[];
  addressLabels: Map<string, string>;
  className?: string;
}

// Format USD values compactly
const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

export function LiquidityHistoryByAddressChart({
  data,
  topAddresses,
  addressLabels,
  className,
}: LiquidityHistoryByAddressChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Observe container size
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
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  // Stack keys: top addresses + "others"
  const keys = useMemo(() => [...topAddresses, "others"], [topAddresses]);

  // Color map
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    keys.forEach((key, i) => {
      map.set(key, key === "others" ? OTHERS_COLOR : LP_COLORS[i % LP_COLORS.length]);
    });
    return map;
  }, [keys]);

  // Calculate max value for Y scale
  const maxValue = useMemo(() => {
    let max = 0;
    for (const d of data) {
      let total = 0;
      for (const key of keys) {
        const val = d[key];
        if (typeof val === "number") total += val;
      }
      if (total > max) max = total;
    }
    return max * 1.1; // 10% padding
  }, [data, keys]);

  // Scales
  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: data.map((d) => d.date),
        range: [0, innerWidth],
        padding: 0.5,
      }),
    [data, innerWidth]
  );

  // For hourly buckets the date label is "Mon DD HH:00". Show one X-axis tick
  // per midnight so 168 hourly points don't render as illegible jammed labels;
  // tooltip still shows the full hourly label.
  const isHourly = useMemo(
    () => data.some((d) => /\s\d{2}:\d{2}$/.test(d.date)),
    [data]
  );
  const xTickValues = useMemo(() => {
    if (!isHourly) return undefined;
    return data
      .map((d) => d.date)
      .filter((label) => label.endsWith(" 00:00"));
  }, [data, isHourly]);
  const xTickFormat = useMemo(
    () => (label: string) => (isHourly ? label.replace(" 00:00", "") : label),
    [isHourly]
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxValue],
        range: [innerHeight, 0],
        nice: true,
      }),
    [maxValue, innerHeight]
  );

  // Handle mouse move
  const handleMouseMove = (event: React.MouseEvent<SVGElement>) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - margin.left;
    const dates = data.map((d) => d.date);
    
    // Find closest date
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < dates.length; i++) {
      const xPos = xScale(dates[i]) ?? 0;
      const dist = Math.abs(x - xPos);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    setHoveredIndex(closestIdx);
  };

  const handleMouseLeave = () => setHoveredIndex(null);

  if (width === 0 || height === 0 || data.length === 0) {
    return (
      <div ref={containerRef} className={cn("w-full h-full min-h-[200px]", className)}>
        <div className="flex items-center justify-center h-full">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Get hovered data point
  const hoveredData = hoveredIndex !== null ? data[hoveredIndex] : null;
  const hoveredX = hoveredData ? xScale(hoveredData.date) ?? 0 : 0;

  return (
    <div ref={containerRef} className={cn("w-full h-full relative", className)}>
      <svg width={width} height={height} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
        {/* Grain texture */}
        <defs>
          <pattern id="lh-grain" width="100" height="100" patternUnits="userSpaceOnUse">
            <image
              href="data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E"
              width="100"
              height="100"
              opacity="0.03"
            />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#lh-grain)" />

        <Group left={margin.left} top={margin.top}>
          {/* Grid */}
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--bp-border-subtle)"
            strokeOpacity={0.5}
            strokeDasharray="2,3"
          />

          {/* Stacked Areas */}
          <AreaStack
            data={data}
            keys={keys}
            x={(d) => xScale(d.data.date) ?? 0}
            y0={(d) => yScale(d[0]) ?? 0}
            y1={(d) => yScale(d[1]) ?? 0}
            curve={curveMonotoneX}
          >
            {({ stacks, path }) =>
              stacks.map((stack, i) => (
                <path
                  key={stack.key}
                  d={path(stack) || ""}
                  fill={colorMap.get(stack.key)}
                  fillOpacity={0.7}
                  stroke={colorMap.get(stack.key)}
                  strokeWidth={1}
                  strokeOpacity={0.9}
                />
              ))
            }
          </AreaStack>

          {/* Hover crosshair */}
          {hoveredIndex !== null && (
            <>
              <Line
                from={{ x: hoveredX, y: 0 }}
                to={{ x: hoveredX, y: innerHeight }}
                stroke="var(--bp-text-secondary)"
                strokeWidth={1}
                strokeDasharray="4,4"
                strokeOpacity={0.5}
              />
            </>
          )}

          {/* Axes */}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="var(--bp-border-subtle)"
            tickStroke="var(--bp-border-subtle)"
            tickValues={xTickValues}
            tickFormat={xTickFormat}
            tickLabelProps={() => ({
              fill: "var(--bp-text-secondary)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              textAnchor: "middle",
              dy: 4,
            })}
            hideTicks
          />
          <AxisLeft
            scale={yScale}
            stroke="var(--bp-border-subtle)"
            tickStroke="var(--bp-border-subtle)"
            tickFormat={(v) => formatCompact(v as number)}
            tickLabelProps={() => ({
              fill: "var(--bp-text-secondary)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              textAnchor: "end",
              dx: -4,
              dy: 3,
            })}
            numTicks={5}
            hideTicks
          />
        </Group>
      </svg>

      {/* Legend */}
      <div className="absolute top-2 right-2 flex flex-wrap gap-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded px-2 py-1.5">
        {keys.map((key, i) => {
          const label = addressLabels.get(key) ?? key;
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: colorMap.get(key) }}
              />
              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-400">
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {hoveredData && (
        <div
          className="absolute pointer-events-none bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 rounded-lg shadow-lg px-3 py-2 z-10"
          style={{
            left: Math.min(hoveredX + margin.left + 10, width - 180),
            top: margin.top,
          }}
        >
          <div className="text-xs font-semibold text-gray-900 dark:text-white mb-1.5">
            {hoveredData.date}
          </div>
          <div className="space-y-1">
            {keys
              .map((key) => {
                const val = hoveredData[key];
                return { key, numVal: typeof val === "number" ? val : 0 };
              })
              // Order wallets by their value at this specific point, largest first.
              .sort((a, b) => b.numVal - a.numVal)
              .map(({ key, numVal }) => {
                const label = addressLabels.get(key) ?? key;
                return (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-sm"
                        style={{ backgroundColor: colorMap.get(key) }}
                      />
                      <span className="text-[10px] text-gray-600 dark:text-gray-400">
                        {label}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-medium text-gray-900 dark:text-white">
                      {formatCompact(numVal)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

export default LiquidityHistoryByAddressChart;
