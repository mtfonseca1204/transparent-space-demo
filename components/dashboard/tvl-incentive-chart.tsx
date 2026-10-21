"use client";

import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import { scaleLinear, scalePoint, scaleOrdinal } from "@visx/scale";
import { AreaClosed, LinePath, Bar } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft, AxisRight } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";

// Distinct colors for stacked reward tokens
const STACK_COLORS = [
  "#F59E0B", // amber
  "#8B5CF6", // violet
  "#10B981", // emerald
  "#EF4444", // red
  "#3B82F6", // blue
  "#EC4899", // pink
];

const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1e9) return `$${parseFloat((value / 1e9).toFixed(2))}B`;
  if (value >= 1e6) return `$${parseFloat((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `$${parseFloat((value / 1e3).toFixed(1))}K`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
};

const formatCompactWholeK = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1e9) return `$${parseFloat((value / 1e9).toFixed(2))}B`;
  if (value >= 1e6) return `$${parseFloat((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  if (value >= 1) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
};

/** Convert ISO date "2025-05-13" to the "Mon DD" label format used in chart data. */
function isoToLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface RewardStack {
  symbol: string;
  dailyUsd: number;
}

interface TvlIncentiveChartProps {
  /** TVL data points (area) */
  tvlData: Array<{ date: string; tvl: number }>;
  /** Per-day reward stacks (bars) — must align with tvlData by date string */
  rewardBars: Array<{ date: string; stacks: RewardStack[] }>;
  campaignPeriods?: Array<{ campaignId: string; start: string; end: string }>;
  selectedCampaignId?: string | null;
  /** Custom formatter for right-axis tick labels (defaults to $ format) */
  formatRewardAxis?: (value: number) => string;
  /** Custom formatter for reward tooltip values (defaults to $ format) */
  formatRewardTooltip?: (value: number) => string;
  className?: string;
}

export function TvlIncentiveChart({
  tvlData,
  rewardBars,
  campaignPeriods = [],
  selectedCampaignId = null,
  formatRewardAxis,
  formatRewardTooltip,
  className,
}: TvlIncentiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const margin = { top: 34, right: 52, bottom: 32, left: 52 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  // Build a reward map keyed by date for fast lookup
  const rewardByDate = useMemo(() => {
    const m = new Map<string, RewardStack[]>();
    for (const r of rewardBars) m.set(r.date, r.stacks);
    return m;
  }, [rewardBars]);

  // Unique reward token symbols for color mapping
  const uniqueSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const r of rewardBars) {
      for (const s of r.stacks) set.add(s.symbol);
    }
    return [...set];
  }, [rewardBars]);

  const colorScale = useMemo(
    () =>
      scaleOrdinal<string, string>({
        domain: uniqueSymbols,
        range: STACK_COLORS,
      }),
    [uniqueSymbols],
  );

  // Scales
  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: tvlData.map((d) => d.date),
        range: [0, innerW],
        padding: 0.1,
      }),
    [tvlData, innerW],
  );

  const tvlMax = useMemo(() => {
    let max = 0;
    for (const d of tvlData) if (d.tvl > max) max = d.tvl;
    return max * 1.1 || 1;
  }, [tvlData]);

  const yScaleTvl = useMemo(
    () => scaleLinear<number>({ domain: [0, tvlMax], range: [innerH, 0], nice: true }),
    [tvlMax, innerH],
  );

  const rewardMax = useMemo(() => {
    let max = 0;
    for (const r of rewardBars) {
      const total = r.stacks.reduce((s, st) => s + st.dailyUsd, 0);
      if (total > max) max = total;
    }
    return max * 1.25 || 1;
  }, [rewardBars]);

  const yScaleReward = useMemo(
    () => scaleLinear<number>({ domain: [0, rewardMax], range: [innerH, 0], nice: true }),
    [rewardMax, innerH],
  );

  // X tick labels — thin out for readability
  const xTickValues = useMemo(() => {
    const n = tvlData.length;
    if (n <= 10) return tvlData.map((d) => d.date);
    const step = Math.max(1, Math.floor(n / 8));
    const ticks: string[] = [];
    for (let i = 0; i < n; i += step) ticks.push(tvlData[i].date);
    const last = tvlData[n - 1].date;
    if (ticks[ticks.length - 1] !== last) ticks.push(last);
    return ticks;
  }, [tvlData]);

  // Campaign bands
  const campaignBands = useMemo(() => {
    if (campaignPeriods.length === 0 || tvlData.length === 0) return [];
    const findClosest = (label: string) => {
      const exact = tvlData.findIndex((d) => d.date === label);
      if (exact >= 0) return exact;
      const prefix = label.split(",")[0];
      return tvlData.findIndex((d) => d.date.startsWith(prefix));
    };
    return campaignPeriods
      .map((period) => {
        const startLabel = isoToLabel(period.start);
        const endLabel = isoToLabel(period.end);
        const si = findClosest(startLabel);
        const ei = findClosest(endLabel);
        if (si < 0 && ei < 0) return null;
        const rawX1 = si >= 0 ? (xScale(tvlData[si].date) ?? 0) : 0;
        const rawX2 = ei >= 0 ? (xScale(tvlData[ei].date) ?? 0) : innerW;
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
  }, [campaignPeriods, tvlData, xScale, innerW]);

  const visibleCampaignBands = useMemo(() => {
    if (!selectedCampaignId) return campaignBands;
    return campaignBands.filter((band) => band.campaignId === selectedCampaignId);
  }, [campaignBands, selectedCampaignId]);

  const showCampaignLabels = visibleCampaignBands.length === 1;

  // Bar width: derive from point spacing
  const barWidth = useMemo(() => {
    if (tvlData.length < 2) return 6;
    const x0 = xScale(tvlData[0].date) ?? 0;
    const x1 = xScale(tvlData[1].date) ?? 0;
    return Math.max(2, Math.min(16, (x1 - x0) * 0.7));
  }, [tvlData, xScale]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (tvlData.length === 0 || innerW <= 0) return;
      const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left - margin.left;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < tvlData.length; i++) {
        const px = xScale(tvlData[i].date) ?? 0;
        const dist = Math.abs(px - mouseX);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      }
      setHoverIndex(closest);
    },
    [tvlData, xScale, innerW, margin.left],
  );
  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  const tooltipData = hoverIndex !== null && tvlData[hoverIndex] ? tvlData[hoverIndex] : null;
  const tooltipX = tooltipData ? (xScale(tooltipData.date) ?? 0) : 0;
  const tooltipReward = tooltipData ? rewardByDate.get(tooltipData.date) : undefined;

  if (width === 0 || height === 0 || tvlData.length === 0) {
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
          <linearGradient id="tvl-incentive-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A6CF7" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#4A6CF7" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={yScaleTvl} width={innerW} numTicks={4} stroke="var(--bp-border-subtle)" strokeDasharray="2,2" strokeOpacity={0.5} />

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

          {/* Reward bars (stacked) — rendered behind the TVL line */}
          {tvlData.map((d, i) => {
            const stacks = rewardByDate.get(d.date);
            if (!stacks || stacks.length === 0) return null;
            const cx = xScale(d.date) ?? 0;
            let cumY = innerH;
            return (
              <g key={`bar-${d.date}`}>
                {stacks.map((st, si) => {
                  const barH = innerH - yScaleReward(st.dailyUsd);
                  const y = cumY - barH;
                  cumY = y;
                  return (
                    <Bar
                      key={`${d.date}-${st.symbol}-${si}`}
                      x={cx - barWidth / 2}
                      y={y}
                      width={barWidth}
                      height={Math.max(0, barH)}
                      fill={colorScale(st.symbol)}
                      fillOpacity={hoverIndex === i ? 0.95 : 0.6}
                      rx={1}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* TVL area */}
          <AreaClosed
            data={tvlData}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTvl(d.tvl) ?? 0}
            yScale={yScaleTvl}
            curve={curveMonotoneX}
            fill="url(#tvl-incentive-grad)"
          />
          <LinePath
            data={tvlData}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScaleTvl(d.tvl) ?? 0}
            stroke="#4A6CF7"
            strokeWidth={1.5}
            curve={curveMonotoneX}
          />

          {/* Hover crosshair */}
          {hoverIndex !== null && (
            <line x1={tooltipX} x2={tooltipX} y1={0} y2={innerH}
              stroke="var(--bp-text-muted)" strokeWidth={1} strokeDasharray="3,3" strokeOpacity={0.6} pointerEvents="none" />
          )}

          {/* Left axis — TVL */}
          <AxisLeft
            scale={yScaleTvl} numTicks={4}
            tickFormat={(v) => formatCompactWholeK(v as number)}
            stroke="transparent" tickStroke="transparent"
            tickLabelProps={() => ({ fill: "var(--bp-text-muted)", fontSize: 9, fontFamily: "var(--font-mono)", textAnchor: "end" as const, dx: -4, dy: 3 })}
          />
          {/* Right axis — Daily rewards */}
          <AxisRight
            scale={yScaleReward} numTicks={4}
            left={innerW}
            tickFormat={(v) => (formatRewardAxis ?? formatCompact)(v as number)}
            stroke="transparent" tickStroke="transparent"
            tickLabelProps={() => ({ fill: "#F59E0B", fontSize: 9, fontFamily: "var(--font-mono)", textAnchor: "start" as const, dx: 4, dy: 3 })}
          />
          <AxisBottom
            scale={xScale} top={innerH}
            stroke="transparent" tickStroke="transparent"
            tickValues={xTickValues}
            tickLabelProps={() => ({ fill: "var(--bp-text-muted)", fontSize: 9, fontFamily: "var(--font-mono)", textAnchor: "middle" as const, dy: 8 })}
          />
          <rect x={0} y={0} width={innerW} height={innerH} fill="transparent"
            onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
        </Group>
      </svg>

      {/* Legend */}
      <div
        className="absolute flex flex-wrap items-center gap-2 text-[9px] text-[var(--bp-text-muted)] font-mono pointer-events-none"
        style={{
          top: 6,
          left: margin.left + 8,
          maxWidth: Math.max(0, width - margin.left - margin.right - 16),
        }}
      >
        <span className="inline-flex items-center gap-1 rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-card-bg)]/85 px-1.5 py-1 backdrop-blur-sm">
          <span className="inline-block w-3 h-[2px] bg-[#4A6CF7] rounded" /> TVL
        </span>
        {uniqueSymbols.map((sym) => (
          <span
            key={sym}
            className="inline-flex items-center gap-1 rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-card-bg)]/85 px-1.5 py-1 backdrop-blur-sm"
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorScale(sym), opacity: 0.7 }} />
            {sym}/day
          </span>
        ))}
      </div>

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
            <div className="text-[9px] font-bold text-gray-300 mb-0.5">{tooltipData.date}</div>
            <div className="text-[11px] font-semibold text-white tabular-nums">TVL {formatCompact(tooltipData.tvl)}</div>
            {tooltipReward && tooltipReward.length > 0 && (
              <div className="mt-0.5 space-y-px">
                {tooltipReward.map((st, i) => (
                  <div key={i} className="text-[10px] tabular-nums flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ backgroundColor: colorScale(st.symbol) }} />
                    <span style={{ color: colorScale(st.symbol) }}>{(formatRewardTooltip ?? formatCompact)(st.dailyUsd)}/day</span>
                    <span className="text-gray-500">{st.symbol}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
