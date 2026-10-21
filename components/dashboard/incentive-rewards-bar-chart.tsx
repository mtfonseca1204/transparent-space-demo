"use client";

import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";
import type { MerklCampaign } from "@/app/api/merkl-opportunities/route";

const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
};

interface BarDatum {
  label: string;
  dailyUsd: number;
  dailyTokens: number;
  tokenSymbol: string;
  isActive: boolean;
}

interface IncentiveRewardsBarChartProps {
  campaigns: MerklCampaign[];
  className?: string;
}

export function IncentiveRewardsBarChart({ campaigns, className }: IncentiveRewardsBarChartProps) {
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

  const barData = useMemo<BarDatum[]>(() => {
    if (!campaigns || campaigns.length === 0) return [];
    const now = Date.now() / 1000;
    // Sort chronologically (oldest first) for the chart
    return [...campaigns]
      .sort((a, b) => a.startTimestamp - b.startTimestamp)
      .map((c) => {
        const start = new Date(c.startTimestamp * 1000);
        const end = new Date(c.endTimestamp * 1000);
        const fmtShort = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        return {
          label: `${c.rewardToken.symbol} ${fmtShort(start)}–${fmtShort(end)}`,
          dailyUsd: c.dailyRewardUsd,
          dailyTokens: c.dailyRewardTokens,
          tokenSymbol: c.rewardToken.symbol,
          isActive: now >= c.startTimestamp && now < c.endTimestamp,
        };
      });
  }, [campaigns]);

  const { width, height } = dimensions;
  const margin = { top: 16, right: 16, bottom: 60, left: 56 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: barData.map((d) => d.label),
        range: [0, innerW],
        padding: 0.3,
      }),
    [barData, innerW],
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const d of barData) {
      if (d.dailyUsd > max) max = d.dailyUsd;
    }
    return max * 1.15 || 1;
  }, [barData]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (barData.length === 0 || innerW <= 0) return;
      const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left - margin.left;
      const step = xScale.step();
      const idx = Math.floor(mouseX / step);
      setHoverIndex(idx >= 0 && idx < barData.length ? idx : null);
    },
    [barData, xScale, innerW, margin.left],
  );

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  if (width === 0 || height === 0 || barData.length === 0) {
    return (
      <div ref={containerRef} className={cn("w-full h-full min-h-[200px]", className)}>
        <div className="flex items-center justify-center h-full">
          <p className="text-xs text-[var(--bp-text-muted)] font-mono">No campaign data</p>
        </div>
      </div>
    );
  }

  const hovered = hoverIndex !== null ? barData[hoverIndex] : null;

  return (
    <div ref={containerRef} className={cn("w-full h-full relative", className)}>
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
          {barData.map((d, i) => {
            const barX = xScale(d.label) ?? 0;
            const barW = xScale.bandwidth();
            const barY = yScale(d.dailyUsd);
            const barH = innerH - barY;
            const isHovered = hoverIndex === i;
            return (
              <Bar
                key={d.label}
                x={barX}
                y={barY}
                width={barW}
                height={Math.max(0, barH)}
                fill={d.isActive ? "#10B981" : "#4A6CF7"}
                fillOpacity={isHovered ? 1 : 0.75}
                rx={3}
              />
            );
          })}
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
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 8,
              fontFamily: "var(--font-mono)",
              textAnchor: "end" as const,
              angle: -35,
              dy: 0,
              dx: -4,
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
      {hovered && hoverIndex !== null && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: margin.left + (xScale(hovered.label) ?? 0) + xScale.bandwidth() / 2,
            top: margin.top + 4,
            transform: "translateX(-50%)",
          }}
        >
          <div className="bg-gray-900/95 dark:bg-gray-800/95 border border-gray-700/50 rounded-md px-2.5 py-1.5 shadow-lg backdrop-blur-sm whitespace-nowrap">
            <div className="text-[9px] font-bold text-gray-300 mb-0.5">
              {hovered.tokenSymbol}
            </div>
            <div className="text-[11px] font-semibold text-white tabular-nums">
              {formatCompact(hovered.dailyUsd)}/day
            </div>
            <div className="text-[9px] text-gray-400 tabular-nums">
              {hovered.dailyTokens >= 1
                ? `${hovered.dailyTokens.toFixed(2)} ${hovered.tokenSymbol}/day`
                : `${hovered.dailyTokens.toFixed(4)} ${hovered.tokenSymbol}/day`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
