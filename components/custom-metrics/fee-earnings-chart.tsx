"use client";

import React, { useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleBand } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { LP_COLORS, OTHERS_COLOR } from "./metric-colors";
import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";
import type { DailySnapshot } from "@/hooks/use-liquidity-history-by-address";

interface PoolDayData {
  date: number;
  feesToken0: string;
  feesToken1: string;
  volumeToken0: string;
  volumeToken1: string;
  liquidity: string;
}

interface LPOwnerData {
  owner: string;
  liquidityTotal: string;
}

interface FeeEarningsChartProps {
  poolDayData: PoolDayData[];
  lpOwners: LPOwnerData[];
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  isLoading?: boolean;
  days?: number;
  spaceSlug?: string | null;
  historicalLiquiditySnapshots?: DailySnapshot[];
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return "$0";
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const MAX_VISIBLE_LPS = 20; // Show top N LPs, rest grouped as "Others"

interface LPShare {
  id: string;
  owner: string;
  share: number;
  color: string;
}

interface DayData {
  dateKey: string;
  date: Date;
  timestamp: number;
  total: number;
  lpFees: Array<{ lpId: string; value: number; color: string }>;
}

interface FeeDay {
  dateKey: string;
  date: Date;
  timestamp: number;
  totalFeesUsd: number;
}

export const FeeEarningsChart: React.FC<FeeEarningsChartProps> = ({
  poolDayData,
  lpOwners,
  token0Symbol,
  token1Symbol,
  token1Decimals,
  token1UsdPrice,
  isLoading = false,
  days = 7,
  spaceSlug,
  historicalLiquiditySnapshots,
}) => {
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [mouseY, setMouseY] = useState<number | null>(null);

  const currentLpShares = useMemo<LPShare[]>(() => {
    if (!lpOwners || lpOwners.length === 0) return [];

    // Calculate total liquidity
    const totalLiquidity = lpOwners.reduce(
      (acc, lp) => acc + BigInt(lp.liquidityTotal || "0"),
      BigInt(0)
    );

    if (totalLiquidity === BigInt(0)) return [];

    // Sort by liquidity descending
    const sorted = [...lpOwners].sort((a, b) => {
      const la = BigInt(a.liquidityTotal || "0");
      const lb = BigInt(b.liquidityTotal || "0");
      return la > lb ? -1 : la < lb ? 1 : 0;
    });

    // Take top N LPs
    const topLPs = sorted.slice(0, MAX_VISIBLE_LPS);
    const othersLPs = sorted.slice(MAX_VISIBLE_LPS);

    const shares: LPShare[] = [];

    for (let i = 0; i < topLPs.length; i++) {
      const lp = topLPs[i];
      const liquidity = BigInt(lp.liquidityTotal || "0");
      const share = Number(liquidity * BigInt(10000) / totalLiquidity) / 10000;
      shares.push({
        id: `lp-${i}`,
        owner: lp.owner,
        share,
        color: LP_COLORS[i % LP_COLORS.length],
      });
    }

    // Add "Others" if there are more LPs
    if (othersLPs.length > 0) {
      const othersLiquidity = othersLPs.reduce(
        (acc, lp) => acc + BigInt(lp.liquidityTotal || "0"),
        BigInt(0)
      );
      const othersShare = Number(othersLiquidity * BigInt(10000) / totalLiquidity) / 10000;
      shares.push({
        id: "others",
        owner: `Others (${othersLPs.length})`,
        share: othersShare,
        color: OTHERS_COLOR,
      });
    }

    return shares;
  }, [lpOwners]);

  const feeDays = useMemo<FeeDay[]>(() => {
    if (!poolDayData || poolDayData.length === 0) return [];
    const t1Price = token1UsdPrice ?? 0;
    const t1Divisor = 10 ** token1Decimals;

    return [...poolDayData]
      .sort((a, b) => a.date - b.date)
      .slice(-days)
      .map((day) => {
        // Use only token1 side to avoid double-counting (both columns represent the same trades)
        const fee1Raw = parseFloat(day.feesToken1 || "0");
        const fee1Amount = fee1Raw / t1Divisor;
        const date = new Date(day.date * 1000);
        const dateKey = formatDateShort(date);

        return {
          dateKey,
          date,
          timestamp: day.date,
          totalFeesUsd: fee1Amount * t1Price,
        };
      });
  }, [poolDayData, token1UsdPrice, token1Decimals, days]);

  const { chartData, lpShares } = useMemo(() => {
    if (feeDays.length === 0) {
      return { chartData: [] as DayData[], lpShares: [] as LPShare[] };
    }

    const snapshotByDate = new Map<number, DailySnapshot>();
    for (const snapshot of historicalLiquiditySnapshots ?? []) {
      snapshotByDate.set(snapshot.date, snapshot);
    }
    const hasHistoricalSnapshots = snapshotByDate.size > 0;

    const feesByDay = new Map<number, Map<string, number>>();
    const ownerTotals = new Map<string, number>();
    let windowTotalFees = 0;

    for (const day of feeDays) {
      const ownerFees = new Map<string, number>();
      const snapshot = snapshotByDate.get(day.timestamp);

      if (snapshot && snapshot.totalUsd > 0) {
        for (const [owner, liquidityUsd] of snapshot.byAddress.entries()) {
          if (liquidityUsd <= 0) continue;
          const value = day.totalFeesUsd * (liquidityUsd / snapshot.totalUsd);
          const ownerLc = owner.toLowerCase();
          ownerFees.set(ownerLc, (ownerFees.get(ownerLc) ?? 0) + value);
        }
      } else if (!hasHistoricalSnapshots) {
        for (const lp of currentLpShares) {
          if (lp.id === "others") continue;
          const value = day.totalFeesUsd * lp.share;
          const ownerLc = lp.owner.toLowerCase();
          ownerFees.set(ownerLc, (ownerFees.get(ownerLc) ?? 0) + value);
        }
      }

      let allocatedTotal = 0;
      for (const [owner, value] of ownerFees.entries()) {
        allocatedTotal += value;
        ownerTotals.set(owner, (ownerTotals.get(owner) ?? 0) + value);
      }
      windowTotalFees += allocatedTotal;
      feesByDay.set(day.timestamp, ownerFees);
    }

    const sortedOwners = Array.from(ownerTotals.entries())
      .sort((a, b) => b[1] - a[1]);
    const topOwners = sortedOwners.slice(0, MAX_VISIBLE_LPS);
    const ownerToColor = new Map<string, string>();
    const shares: LPShare[] = topOwners.map(([owner, value], index) => {
      ownerToColor.set(owner, LP_COLORS[index % LP_COLORS.length]);
      return {
        id: owner,
        owner,
        share: windowTotalFees > 0 ? value / windowTotalFees : 0,
        color: LP_COLORS[index % LP_COLORS.length],
      };
    });

    const othersTotal = sortedOwners
      .slice(MAX_VISIBLE_LPS)
      .reduce((acc, [, value]) => acc + value, 0);
    if (othersTotal > 0) {
      shares.push({
        id: "others",
        owner: `Others (${Math.max(sortedOwners.length - MAX_VISIBLE_LPS, 0)})`,
        share: windowTotalFees > 0 ? othersTotal / windowTotalFees : 0,
        color: OTHERS_COLOR,
      });
    }

    const chartData = feeDays.map((day) => {
      const ownerFees = feesByDay.get(day.timestamp) ?? new Map<string, number>();
      const lpFees: Array<{ lpId: string; value: number; color: string }> = [];
      let topTotal = 0;

      for (const [owner] of topOwners) {
        const value = ownerFees.get(owner) ?? 0;
        topTotal += value;
        lpFees.push({
          lpId: owner,
          value,
          color: ownerToColor.get(owner) ?? OTHERS_COLOR,
        });
      }

      const total = Array.from(ownerFees.values()).reduce((acc, value) => acc + value, 0);
      const othersValue = Math.max(0, total - topTotal);
      if (othersValue > 0) {
        lpFees.push({ lpId: "others", value: othersValue, color: OTHERS_COLOR });
      }

      return {
        dateKey: day.dateKey,
        date: day.date,
        timestamp: day.timestamp,
        total,
        lpFees,
      };
    });

    return { chartData, lpShares: shares };
  }, [currentLpShares, feeDays, historicalLiquiditySnapshots]);

  // Calculate totals
  const totalFees = useMemo(() => {
    return chartData.reduce((acc, d) => acc + (d.total || 0), 0);
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">Loading fee data...</p>
      </div>
    );
  }

  if (chartData.length === 0 || lpShares.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400">No fee data yet for this pool/time range</p>
      </div>
    );
  }


  return (
    <div className="w-full h-full flex flex-col">
      {/* Chart */}
      <div className="flex-1" style={{ minHeight: 200, height: 200 }}>
        <ParentSize debounceTime={10}>
          {({ width, height }) => {
            // Use minimum dimensions if ParentSize fails
            const chartWidth = Math.max(width, 300);
            const chartHeight = Math.max(height, 180);

            const margin = { top: 20, right: 20, bottom: 40, left: 60 };
            const xMax = chartWidth - margin.left - margin.right;
            const yMax = chartHeight - margin.top - margin.bottom;

            const maxY = Math.max(...chartData.map((d) => d.total || 0), 1);

            const xScale = scaleBand<string>({
              domain: chartData.map((d) => d.dateKey),
              range: [0, xMax],
              padding: 0.3,
            });

            const yScale = scaleLinear<number>({
              domain: [0, maxY * 1.1],
              range: [yMax, 0],
              nice: true,
            });

            const barWidth = xScale.bandwidth();

            return (
              <svg width={chartWidth} height={chartHeight} style={{ display: 'block' }}>
                <defs>
                  {/* Grain texture pattern */}
                  <pattern id="grainPatternFE" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
                  </pattern>
                </defs>
                <Group left={margin.left} top={margin.top}>
                  
                  {/* Grid */}
                  <GridRows
                    scale={yScale}
                    width={xMax}
                    stroke="#E5E7EB"
                    strokeOpacity={0.5}
                    numTicks={5}
                  />

                  {/* Stacked bars - manually rendered */}
                  {chartData.map((day) => {
                    const x = xScale(day.dateKey) ?? 0;
                    let cumulativeValue = 0;
                    const isHovered = hoveredDay === day.dateKey;

                    return (
                      <g key={day.dateKey}>
                        {day.lpFees.map((lpFee, idx) => {
                          // For stacked bars: y is the top of this segment, height goes down to previous cumulative
                          const segmentTop = yScale(cumulativeValue + lpFee.value);
                          const segmentBottom = yScale(cumulativeValue);
                          const barHeight = Math.max(0, segmentBottom - segmentTop);
                          
                          cumulativeValue += lpFee.value;

                          // Skip if no height
                          if (barHeight < 1) return null;

                          return (
                            <g key={`${day.dateKey}-${lpFee.lpId}`}>
                              <rect
                                x={x}
                                y={segmentTop}
                                width={barWidth}
                                height={barHeight}
                                fill={lpFee.color}
                                opacity={hoveredDay === null || isHovered ? 1 : 0.4}
                                rx={0}
                                pointerEvents="none"
                                style={{ transition: "opacity 0.15s ease-out" }}
                              />
                              {/* Grain overlay */}
                              <rect
                                x={x}
                                y={segmentTop}
                                width={barWidth}
                                height={barHeight}
                                fill="url(#grainPatternFE)"
                                opacity={hoveredDay === null || isHovered ? 1 : 0.4}
                                pointerEvents="none"
                              />
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}

                  {/* Hover overlay for crosshair */}
                  <rect
                    x={0}
                    y={0}
                    width={xMax}
                    height={yMax}
                    fill="transparent"
                    style={{ cursor: "crosshair" }}
                    onMouseMove={(e) => {
                      const svg = e.currentTarget.ownerSVGElement;
                      if (svg) {
                        const rect = svg.getBoundingClientRect();
                        const x = e.clientX - rect.left - margin.left;
                        const y = e.clientY - rect.top - margin.top;
                        // Find which day the mouse is over based on x position
                        const dayIndex = Math.floor(x / (xMax / chartData.length));
                        const clampedIndex = Math.max(0, Math.min(chartData.length - 1, dayIndex));
                        if (chartData[clampedIndex]) {
                          setHoveredDay(chartData[clampedIndex].dateKey);
                        }
                        setMouseY(y);
                      }
                    }}
                    onMouseLeave={() => { setHoveredDay(null); setMouseY(null); }}
                  />

                  {/* Crosshair lines */}
                  {hoveredDay && (() => {
                    const barX = xScale(hoveredDay) ?? 0;
                    return (
                      <>
                        {/* Vertical line */}
                        <line
                          x1={barX + barWidth / 2}
                          y1={0}
                          x2={barX + barWidth / 2}
                          y2={yMax}
                          stroke="#9ca3af"
                          strokeWidth={1}
                          strokeDasharray="3 3"
                          pointerEvents="none"
                        />
                        {/* Horizontal line */}
                        {mouseY !== null && mouseY >= 0 && mouseY <= yMax && (
                          <line
                            x1={0}
                            y1={mouseY}
                            x2={xMax}
                            y2={mouseY}
                            stroke="#9ca3af"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                            pointerEvents="none"
                          />
                        )}
                      </>
                    );
                  })()}

                  {/* Hover tooltip */}
                  {hoveredDay && (() => {
                    const hoveredData = chartData.find((d) => d.dateKey === hoveredDay);
                    if (!hoveredData) return null;
                    const barX = xScale(hoveredDay) ?? 0;
                    const barTop = yScale(hoveredData.total || 0);

                    // Position tooltip above the bar, or to the side if not enough space
                    const tooltipWidth = 160;
                    const visibleLPs = Math.min(lpShares.length, 5);
                    const tooltipHeight = visibleLPs * 16 + 28;
                    
                    let tooltipX = barX + barWidth / 2 - tooltipWidth / 2;
                    let tooltipY = barTop - tooltipHeight - 8;
                    
                    // Keep tooltip within bounds
                    if (tooltipX < 0) tooltipX = 0;
                    if (tooltipX + tooltipWidth > xMax) tooltipX = xMax - tooltipWidth;
                    if (tooltipY < 0) tooltipY = barTop + 10;

                    return (
                      <g style={{ pointerEvents: 'none' }}>
                        <rect
                          x={tooltipX}
                          y={tooltipY}
                          width={tooltipWidth}
                          height={tooltipHeight}
                          fill="rgba(255,255,255,0.5)"
                          stroke="#E5E7EB"
                          strokeWidth={1}
                          rx={4}
                          filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
                        />
                        <text
                          x={tooltipX + tooltipWidth / 2}
                          y={tooltipY + 16}
                          textAnchor="middle"
                          style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, fontWeight: 500, fill: "#374151" }}
                        >
                          {hoveredData.dateKey}: {formatUsdCompact(hoveredData.total || 0)}
                        </text>
                        {lpShares.slice(0, visibleLPs).map((lp, i) => {
                          const lpFee = hoveredData.lpFees.find((f) => f.lpId === lp.id);
                          const meta = lp.id === "others" ? undefined : getLpMeta(lp.owner, spaceSlug);
                          const label = lp.id === "others" ? lp.owner : formatLpLabel(lp.owner, spaceSlug);
                          const textX = meta?.logoSrc ? tooltipX + 36 : tooltipX + 22;
                          return (
                            <g key={lp.id}>
                              <rect
                                x={tooltipX + 8}
                                y={tooltipY + 24 + i * 16}
                                width={10}
                                height={10}
                                fill={lp.color}
                                rx={2}
                              />
                              {meta?.logoSrc && (
                                <image
                                  href={meta.logoSrc}
                                  x={tooltipX + 22}
                                  y={tooltipY + 23 + i * 16}
                                  width={10}
                                  height={10}
                                />
                              )}
                              <text
                                x={textX}
                                y={tooltipY + 33 + i * 16}
                                style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, fill: "#6B7280" }}
                              >
                                {label}: {formatUsdCompact(lpFee?.value || 0)}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}

                  {/* X Axis */}
                  <AxisBottom
                    top={yMax}
                    scale={xScale}
                    stroke="var(--bp-border-subtle)"
                    tickStroke="var(--bp-border-subtle)"
                    tickLabelProps={() => ({
                      fill: "var(--bp-text-muted)",
                      fontSize: 11,
                      fontFamily: "var(--bp-font-mono)",
                      textAnchor: "middle",
                      dy: "0.25em",
                    })}
                    hideTicks={chartData.length > 14}
                    tickValues={
                      chartData.length > 14
                        ? chartData.filter((_, i) => i % Math.ceil(chartData.length / 7) === 0).map((d) => d.dateKey)
                        : undefined
                    }
                  />

                  {/* Y Axis */}
                  <AxisLeft
                    scale={yScale}
                    stroke="var(--bp-border-subtle)"
                    tickStroke="var(--bp-border-subtle)"
                    numTicks={5}
                    tickFormat={(v) => formatUsdCompact(v as number)}
                    tickLabelProps={() => ({
                      fill: "var(--bp-text-muted)",
                      fontSize: 11,
                      fontFamily: "var(--bp-font-mono)",
                      textAnchor: "end",
                      dx: "-0.25em",
                      dy: "0.25em",
                    })}
                  />
                </Group>
              </svg>
            );
          }}
        </ParentSize>
      </div>

      {/* Bottom legend for all LPs */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 px-2 border-t border-gray-100 mt-1">
        {lpShares.slice(0, 8).map((lp) => {
          const meta = lp.id === "others" ? undefined : getLpMeta(lp.owner, spaceSlug);
          const label = lp.id === "others" ? lp.owner : formatLpLabel(lp.owner, spaceSlug);
          return (
            <div key={lp.id} className="flex items-center gap-1.5 text-[10px]">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: lp.color }} />
              {meta?.logoSrc && (
                <img
                  src={meta.logoSrc}
                  alt={`${meta.label} logo`}
                  className="w-3 h-3 rounded-sm"
                  loading="lazy"
                />
              )}
              <span className="text-gray-500" style={{ fontFamily: "var(--bp-font-mono)" }}>
                {label}
              </span>
              <span className="text-gray-400" style={{ fontFamily: "var(--bp-font-mono)" }}>
                ({(lp.share * 100).toFixed(1)}%)
              </span>
            </div>
          );
        })}
        {lpShares.length > 8 && (
          <div className="text-[10px] text-gray-400">+{lpShares.length - 8} more</div>
        )}
      </div>
    </div>
  );
};

export default FeeEarningsChart;
