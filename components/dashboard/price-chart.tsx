"use client";

import { cn } from "@/lib/utils";
import type { OHLCDataPoint } from "@/components/custom-metrics/lp-address-activity";

import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import React, { useCallback, useMemo, useState } from "react";

const LIGHT_THEME = {
  background: "#ffffff",
  panelBg: "#ffffff",
  gridLine: "#e5e7eb", // gray-200
  axisLine: "#d1d5db", // gray-300
  textSecondary: "#6b7280", // gray-500
  candleUpFill: "#16a34a", // green-600
  candleDownFill: "#dc2626", // red-600
  candleUpStroke: "#15803d", // green-700
  candleDownStroke: "#b91c1c", // red-700
};

const DEFAULT_MARGIN = { top: 10, right: 8, bottom: 24, left: 44 };

const formatAxisTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

// Format for y-axis labels (do not hardcode "$"; dashboard can render inverted prices)
const formatAxisPrice = (price: number): string => {
  if (!Number.isFinite(price)) return "-";
  if (price >= 1000) return price.toFixed(0);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toFixed(8);
};

// Format for tooltip/info panel (no "$"). Use higher precision to avoid
// making open/high/low/close look identical on tight ranges.
const formatTooltipPrice = (price: number): string => {
  if (!Number.isFinite(price)) return "-";
  if (price >= 1000) return price.toFixed(0);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
};

const formatDateTime = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const InfoPanel: React.FC<{ data: OHLCDataPoint[]; hoveredIndex: number | null }> = ({
  data,
  hoveredIndex,
}) => {
  if (hoveredIndex === null) return null;
  const ohlc = data[hoveredIndex];
  if (!ohlc) return null;

  const isUp = ohlc.close >= ohlc.open;

  return (
    <div className="absolute top-2 left-12 bg-white/50 backdrop-blur-sm rounded-lg px-3 py-2 text-xs border border-gray-200 shadow-sm z-10">
      <div className="text-gray-500 mb-1">{formatDateTime(ohlc.timestamp)}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-gray-500">Open</span>
        <span className="text-gray-800">{formatTooltipPrice(ohlc.open)}</span>
        <span className="text-gray-500">High</span>
        <span className="text-gray-800">{formatTooltipPrice(ohlc.high)}</span>
        <span className="text-gray-500">Low</span>
        <span className="text-gray-800">{formatTooltipPrice(ohlc.low)}</span>
        <span className="text-gray-500">Close</span>
        <span className={isUp ? "text-green-700" : "text-red-700"}>{formatTooltipPrice(ohlc.close)}</span>
      </div>
    </div>
  );
};

const CandlestickChart: React.FC<{
  data: OHLCDataPoint[];
  width: number;
  height: number;
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
}> = ({ data, width, height, hoveredIndex, onHover }) => {
  const margin = DEFAULT_MARGIN;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

  const xScale = scaleTime<number>({
    domain: [data[0].timestamp, data[data.length - 1].timestamp],
    range: [0, innerWidth],
  });

  const allPrices = data.flatMap((d) => [d.high, d.low]);
  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const isFlat = rawMin === rawMax;
  const pad = isFlat ? Math.max(1e-9, Math.abs(rawMin) * 0.002) : (rawMax - rawMin) * 0.01;

  const yScale = scaleLinear<number>({
    domain: [rawMin - pad, rawMax + pad],
    range: [innerHeight, 0],
    nice: true,
  });

  const candleWidth = Math.max(2, (innerWidth / data.length) * 0.7);
  const wickWidth = 1;

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // `event.currentTarget` is the transparent hover rect inside the translated <Group>.
    // Its bounding box already accounts for the group's `left` transform, so don't subtract margin again.
    const mouseX = event.clientX - rect.left;

    // Find nearest data point by x-distance
    let nearestIndex = 0;
    let nearestDistance = Infinity;

    data.forEach((d, i) => {
      const x = xScale(d.timestamp) ?? 0;
      const distance = Math.abs(x - mouseX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    });

    onHover(nearestIndex);
  };

  return (
    <svg width={width} height={height} role="img" aria-label="Price candlestick chart">
      <rect width={width} height={height} fill={LIGHT_THEME.panelBg} />

      <Group left={margin.left} top={margin.top}>
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke={LIGHT_THEME.gridLine}
          strokeOpacity={0.9}
          numTicks={5}
        />

        {data.map((d, i) => {
          const x = Math.round((xScale(d.timestamp) ?? 0) * 100) / 100;
          const isUp = d.close >= d.open;
          const fill = isUp ? LIGHT_THEME.candleUpFill : LIGHT_THEME.candleDownFill;
          const stroke = isUp ? LIGHT_THEME.candleUpStroke : LIGHT_THEME.candleDownStroke;

          const bodyTop = Math.round(yScale(Math.max(d.open, d.close)) * 100) / 100;
          const bodyBottom = Math.round(yScale(Math.min(d.open, d.close)) * 100) / 100;
          // Make very small candles visible (otherwise they look like a flat line).
          const bodyHeight = Math.max(3, bodyBottom - bodyTop);

          const wickTop = Math.round(yScale(d.high) * 100) / 100;
          const wickBottom = Math.round(yScale(d.low) * 100) / 100;

          return (
            <g key={`candle-${i}`}>
              <line
                x1={x}
                y1={wickTop}
                x2={x}
                y2={wickBottom}
                stroke={stroke}
                strokeWidth={wickWidth}
                opacity={0.9}
              />
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                rx={1.5}
                fill={fill}
                fillOpacity={0.65}
                stroke={stroke}
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* Crosshair vertical line */}
        {hoveredIndex !== null && data[hoveredIndex] && (
          <line
            x1={xScale(data[hoveredIndex].timestamp) ?? 0}
            y1={0}
            x2={xScale(data[hoveredIndex].timestamp) ?? 0}
            y2={innerHeight}
            stroke="#9ca3af" // gray-400
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction area */}
        <rect
          x={0}
          y={0}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHover(null)}
        />
      </Group>

      <AxisLeft
        scale={yScale}
        left={margin.left}
        top={margin.top}
        stroke={LIGHT_THEME.axisLine}
        tickStroke={LIGHT_THEME.axisLine}
        tickLabelProps={() => ({
          fill: LIGHT_THEME.textSecondary,
          fontSize: 10,
          textAnchor: "end",
          dx: -4,
        })}
        numTicks={4}
        tickFormat={(v) => formatAxisPrice(Number(v))}
      />

      <AxisBottom
        scale={xScale}
        top={height - margin.bottom}
        left={margin.left}
        stroke={LIGHT_THEME.axisLine}
        tickStroke={LIGHT_THEME.axisLine}
        tickLabelProps={() => ({
          fill: LIGHT_THEME.textSecondary,
          fontSize: 10,
          textAnchor: "middle",
          dy: 2,
        })}
        numTicks={4}
        tickFormat={(v) => formatAxisTime(v as Date)}
      />
    </svg>
  );
};

export const PriceChart = ({
  data,
  className,
}: {
  data: OHLCDataPoint[];
  className?: string;
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleHover = useCallback((index: number | null) => {
    setHoveredIndex(index);
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    );
  }

  const safeData = useMemo(() => data ?? [], [data]);

  return (
    <div className={cn("relative w-full h-full", className)}>
      <InfoPanel data={safeData} hoveredIndex={hoveredIndex} />
      <ParentSize debounceTime={10}>
        {({ width, height }) => {
          const chartWidth = width > 0 ? width : 420;
          const chartHeight = height > 0 ? height : 220;
          return (
            <CandlestickChart
              data={safeData}
              width={chartWidth}
              height={chartHeight}
              hoveredIndex={hoveredIndex}
              onHover={handleHover}
            />
          );
        }}
      </ParentSize>
    </div>
  );
};
