"use client";

import React, { useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { LinePath, AreaClosed } from "@visx/shape";
import { Group } from "@visx/group";
import { curveMonotoneX } from "@visx/curve";
import type { SlippageDataPoint } from "@/hooks/use-historical-slippage";

interface SlippageHistoryChartProps {
  data: SlippageDataPoint[];
  orderSizeUsd: number;
  token0Symbol?: string;
  token1Symbol?: string;
  isLoading?: boolean;
}

// Colors for buy/sell slippage lines - match token colors from liquidity distribution
const BUY_COLOR = "#9ca3af"; // Gray - WLD color (buying WLD)
const SELL_COLOR = "#3b82f6"; // Blue - USDC color (selling WLD, getting USDC)

function formatSlippagePct(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0%";
  if (value >= 10) return `${value.toFixed(0)}%`;
  if (value >= 1) return `${value.toFixed(1)}%`;
  if (value >= 0.1) return `${value.toFixed(2)}%`;
  return `${value.toFixed(3)}%`;
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeAxis(date: Date): string {
  return date.toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric",
  });
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}

const SlippageHistoryChartInner: React.FC<
  SlippageHistoryChartProps & { width: number; height: number }
> = ({
  data,
  orderSizeUsd,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  isLoading,
  width,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    index: number;
    localX: number;
    localY: number;
  } | null>(null);

  // Margins
  const margin = { top: 20, right: 20, bottom: 40, left: 55 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  // Scales
  const xScale = useMemo(() => {
    if (data.length === 0) {
      const now = new Date();
      return scaleTime<number>({
        domain: [now, now],
        range: [0, innerWidth],
      });
    }
    const minDate = data[0]!.timestamp;
    const maxDate = data[data.length - 1]!.timestamp;
    return scaleTime<number>({
      domain: [minDate, maxDate],
      range: [0, innerWidth],
    });
  }, [data, innerWidth]);

  const yScale = useMemo(() => {
    if (data.length === 0) {
      return scaleLinear<number>({
        domain: [0, 1],
        range: [innerHeight, 0],
      });
    }
    
    const allValues = data.flatMap((d) => [d.buySlippagePct, d.sellSlippagePct]);
    const maxValue = Math.max(...allValues.filter((v) => Number.isFinite(v)), 0.1);
    // Add 20% headroom
    const yMax = maxValue * 1.2;
    
    return scaleLinear<number>({
      domain: [0, yMax],
      range: [innerHeight, 0],
      nice: true,
    });
  }, [data, innerHeight]);

  const hoveredData = hoveredPoint !== null ? data[hoveredPoint.index] : null;

  if (width <= 0 || height <= 0) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[var(--bp-line)] border-t-[var(--bp-blue)] rounded-full animate-spin" />
          <span className="text-xs text-[var(--bp-text-muted)]">Loading slippage data...</span>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
        <span>No slippage data available</span>
        <span className="text-xs text-gray-300">Historical liquidity data not found</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <svg width={width} height={height}>
        <Group top={margin.top} left={margin.left}>
          {/* Grid */}
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--bp-grid-minor)"
            strokeOpacity={0.3}
            numTicks={5}
          />

          {/* Sell slippage area (light fill) - render first so it's behind */}
          <AreaClosed<SlippageDataPoint>
            data={data}
            x={(d) => xScale(d.timestamp) ?? 0}
            y={(d) => yScale(d.sellSlippagePct) ?? innerHeight}
            yScale={yScale}
            curve={curveMonotoneX}
            fill={SELL_COLOR}
            fillOpacity={0.15}
          />

          {/* Buy slippage area (light fill) - render second so it overlaps */}
          <AreaClosed<SlippageDataPoint>
            data={data}
            x={(d) => xScale(d.timestamp) ?? 0}
            y={(d) => yScale(d.buySlippagePct) ?? innerHeight}
            yScale={yScale}
            curve={curveMonotoneX}
            fill={BUY_COLOR}
            fillOpacity={0.2}
          />

          {/* Sell slippage line - render first so it's behind */}
          <LinePath<SlippageDataPoint>
            data={data}
            x={(d) => xScale(d.timestamp) ?? 0}
            y={(d) => yScale(d.sellSlippagePct) ?? innerHeight}
            curve={curveMonotoneX}
            stroke={SELL_COLOR}
            strokeWidth={2}
            strokeOpacity={0.9}
          />

          {/* Buy slippage line - render second so it's on top */}
          <LinePath<SlippageDataPoint>
            data={data}
            x={(d) => xScale(d.timestamp) ?? 0}
            y={(d) => yScale(d.buySlippagePct) ?? innerHeight}
            curve={curveMonotoneX}
            stroke={BUY_COLOR}
            strokeWidth={2}
            strokeOpacity={0.9}
          />

          {/* Y Axis */}
          <AxisLeft
            scale={yScale}
            tickFormat={(d) => formatSlippagePct(d as number)}
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
            tickFormat={(d) => formatTimeAxis(d as Date)}
            stroke="var(--bp-border-subtle)"
            tickStroke="var(--bp-border-subtle)"
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 11,
              fontFamily: "var(--bp-font-mono)",
              textAnchor: "middle",
              dy: "0.5em",
            })}
            numTicks={Math.min(6, data.length)}
          />

          {/* Vertical crosshair when hovering */}
          {hoveredPoint !== null && hoveredData && (
            <line
              x1={xScale(hoveredData.timestamp) ?? 0}
              y1={0}
              x2={xScale(hoveredData.timestamp) ?? 0}
              y2={innerHeight}
              stroke="var(--bp-border-subtle)"
              strokeWidth={1}
              strokeDasharray="4,3"
              pointerEvents="none"
            />
          )}

          {/* Hover circles */}
          {hoveredPoint !== null && hoveredData && (
            <>
              <circle
                cx={xScale(hoveredData.timestamp) ?? 0}
                cy={yScale(hoveredData.buySlippagePct) ?? 0}
                r={5}
                fill={BUY_COLOR}
                stroke="white"
                strokeWidth={2}
                pointerEvents="none"
              />
              <circle
                cx={xScale(hoveredData.timestamp) ?? 0}
                cy={yScale(hoveredData.sellSlippagePct) ?? 0}
                r={5}
                fill={SELL_COLOR}
                stroke="white"
                strokeWidth={2}
                pointerEvents="none"
              />
            </>
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

              const mouseX = e.clientX - svgRect.left - margin.left;
              const t = xScale.invert(mouseX).getTime();

              let bestIdx = 0;
              let bestDiff = Infinity;
              for (let i = 0; i < data.length; i++) {
                const diff = Math.abs(data[i]!.timestamp.getTime() - t);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestIdx = i;
                }
              }

              const localX = e.clientX - containerRect.left;
              const localY = e.clientY - containerRect.top;

              setHoveredPoint({
                index: bestIdx,
                localX,
                localY,
              });
            }}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        </Group>
      </svg>

      {/* Legend */}
      <div className="absolute top-2 right-4 flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ backgroundColor: BUY_COLOR }} />
          <span className="text-[var(--bp-text-muted)]">Buy {token0Symbol}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded" style={{ backgroundColor: SELL_COLOR }} />
          <span className="text-[var(--bp-text-muted)]">Sell {token0Symbol}</span>
        </div>
      </div>

      {/* Tooltip - top right of cursor */}
      {hoveredPoint && hoveredData && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{
            left: Math.min(hoveredPoint.localX + 12, (containerRef.current?.offsetWidth ?? 300) - 180),
            top: Math.max(8, hoveredPoint.localY - 100),
          }}
        >
          <div className="bg-white/50 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-3.5 py-3 min-w-[160px]">
            <div className="text-[13px] font-semibold text-gray-900 mb-2.5 pb-2 border-b border-gray-100">
              {formatDateShort(hoveredData.timestamp)}
            </div>
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: BUY_COLOR }} />
                  <span className="text-gray-500">Buy Slippage</span>
                </div>
                <span className="font-semibold text-gray-900 tabular-nums">
                  {formatSlippagePct(hoveredData.buySlippagePct)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SELL_COLOR }} />
                  <span className="text-gray-500">Sell Slippage</span>
                </div>
                <span className="font-semibold text-gray-900 tabular-nums">
                  {formatSlippagePct(hoveredData.sellSlippagePct)}
                </span>
              </div>
              <div className="pt-2 mt-2 border-t border-gray-100">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-500">Order Size</span>
                  <span className="font-medium text-gray-700 tabular-nums">
                    {formatUsdCompact(orderSizeUsd)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SlippageHistoryChart: React.FC<SlippageHistoryChartProps> = (props) => {
  const FALLBACK_HEIGHT = 280;
  return (
    <ParentSize debounceTime={50}>
      {({ width, height }) => {
        const effectiveHeight =
          Number.isFinite(height) && height >= FALLBACK_HEIGHT ? height : FALLBACK_HEIGHT;
        return (
          <SlippageHistoryChartInner {...props} width={width} height={effectiveHeight} />
        );
      }}
    </ParentSize>
  );
};
