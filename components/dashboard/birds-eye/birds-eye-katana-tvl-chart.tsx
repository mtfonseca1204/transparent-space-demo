"use client";

import React, {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaStack, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import type { PoolData } from "@/app/api/pool/[address]/route";
import { useLiquidityHistoryByAddress } from "@/hooks/use-liquidity-history-by-address";
import { usePoolDayData } from "@/hooks/use-pool-metrics";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import { cn } from "@/lib/utils";
import {
  CampaignTvlRangeSelector,
  CAMPAIGN_TVL_DEFAULT_RANGE,
} from "./campaign-tvl-range-selector";

// Colors match the LP deep-dive comparison chart so the visual story is
// consistent across this dashboard:
//   - Campaign LPs share the same light-blue tone used to highlight the
//     selected wallet in the LP Liquidity Distribution chart.
//   - "Other LPs" use the same muted grey used for the rest of the pool.
// Campaign delimitations use two contrasting colors so live vs. past windows
// read at a glance:
//   - LIVE  → emerald (universally "active / right now")
//   - PAST  → amber  (warm, "previously active")
const COLOR_CAMPAIGN = "#06b6d4"; // tailwind cyan-500
const COLOR_OTHER = "#9ca3af"; // tailwind gray-400
const COLOR_BOUNDARY_LIVE = "#10b981"; // tailwind emerald-500
const COLOR_BOUNDARY_PAST = "#f59e0b"; // tailwind amber-500

export interface CampaignWindow {
  campaignId: string;
  start: number; // unix seconds
  end: number; // unix seconds
  isLive: boolean;
  rewardSymbol?: string;
}

interface BirdsEyeKatanaTvlChartProps {
  poolKey: string;
  poolData: PoolData | null | undefined;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  recipientAddressSet: Set<string>;
  /** All Merkl campaigns to render on the chart. Live is highlighted. */
  campaigns: CampaignWindow[];
  rewardSymbol: string;
  className?: string;
}

interface ChartPoint {
  date: number; // bucket start (unix seconds)
  dateStr: string;
  campaign: number;
  other: number;
}

function formatUsdValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${formatCompact(value).replace(/^\$/, "")}`;
}

export const BirdsEyeKatanaTvlChart = memo(function BirdsEyeKatanaTvlChart({
  poolKey,
  poolData,
  token0UsdPrice,
  token1UsdPrice,
  recipientAddressSet,
  campaigns,
  rewardSymbol,
  className,
}: BirdsEyeKatanaTvlChartProps) {
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

  // Derive a single "primary" campaign (live if any, else most recent) so the
  // chart still has a sensible end-of-window even when there is no live one.
  const primaryCampaign = useMemo(() => {
    const live = campaigns.find((c) => c.isLive);
    if (live) return live;
    return [...campaigns].sort((a, b) => b.end - a.end)[0] ?? null;
  }, [campaigns]);

  // Lookback is user-selectable (30/45/60/90d). The window always ends at
  // "now" (or the primary campaign's end, whichever is sooner) and looks back
  // `lookbackDays` so the chart shows recent pool TVL plus any campaigns that
  // fall inside the window.
  const now = Math.floor(Date.now() / 1000);
  const visibleEnd = Math.min(now, primaryCampaign?.end ?? now);
  const [lookbackDays, setLookbackDays] = useState<number>(CAMPAIGN_TVL_DEFAULT_RANGE);

  const { data: dayData } = usePoolDayData(poolKey, lookbackDays + 2, true);
  const dailyPriceMap = useMemo(() => {
    if (!dayData) return undefined;
    const map = new Map<number, string>();
    for (const d of dayData) {
      if (d.closePrice) map.set(d.date, d.closePrice);
    }
    return map;
  }, [dayData]);

  const { data: history, isLoading } = useLiquidityHistoryByAddress(
    poolKey,
    lookbackDays,
    poolData?.token0Decimals ?? 18,
    poolData?.token1Decimals ?? 6,
    poolData?.sqrtPriceX96,
    token0UsdPrice,
    token1UsdPrice,
    dailyPriceMap,
    Boolean(poolData?.sqrtPriceX96),
  );

  const formatBucketDate = useCallback((unixSec: number): string => {
    const d = new Date(unixSec * 1000);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }, []);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!history) return [];
    const points: ChartPoint[] = [];
    for (const snap of history.snapshots) {
      if (snap.date > visibleEnd) continue;
      let campaign = 0;
      let other = 0;
      for (const [addr, usd] of snap.byAddress.entries()) {
        if (recipientAddressSet.has(addr.toLowerCase())) campaign += usd;
        else other += usd;
      }
      points.push({
        date: snap.date,
        dateStr: formatBucketDate(snap.date),
        campaign,
        other,
      });
    }
    return points;
  }, [history, recipientAddressSet, visibleEnd, formatBucketDate]);

  const { width, height } = dimensions;
  // Reserve a little extra top margin so the "Campaign start / end" labels at
  // the top of the dashed lines don't collide with the topmost gridline.
  const margin = { top: 22, right: 12, bottom: 28, left: 48 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  // Extend the X-axis domain forward to the furthest campaign end across the
  // visible set so every campaign's end dashed line lands at the right edge of
  // its window — even when no historical data exists past today.
  const furthestCampaignEnd = useMemo(() => {
    if (campaigns.length === 0) return null;
    return campaigns.reduce((max, c) => (c.end > max ? c.end : max), campaigns[0].end);
  }, [campaigns]);
  const xDomain = useMemo(() => {
    if (chartData.length === 0) return [] as string[];
    const seen = new Set<string>();
    const domain: string[] = [];
    const push = (label: string) => {
      if (seen.has(label)) return;
      seen.add(label);
      domain.push(label);
    };
    for (const d of chartData) push(d.dateStr);
    const lastDate = chartData[chartData.length - 1].date;
    const stopAt = furthestCampaignEnd ?? lastDate;
    for (
      let ts = Math.floor(lastDate / 86400) * 86400 + 86400;
      ts <= stopAt;
      ts += 86400
    ) {
      push(formatBucketDate(ts));
    }
    return domain;
  }, [chartData, furthestCampaignEnd, formatBucketDate]);

  const xScale = useMemo(
    () =>
      scalePoint<string>({
        domain: xDomain,
        range: [0, innerW],
        padding: 0.1,
      }),
    [xDomain, innerW],
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      const sum = d.campaign + d.other;
      if (sum > max) max = sum;
    }
    return max * 1.1 || 1;
  }, [chartData]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH],
  );

  const xTickValues = useMemo(() => {
    const n = xDomain.length;
    if (n === 0) return [];
    if (n <= 7) return xDomain;
    const step = Math.max(1, Math.floor(n / 6));
    const ticks: string[] = [];
    for (let i = 0; i < n; i += step) ticks.push(xDomain[i]);
    const last = xDomain[n - 1];
    if (ticks[ticks.length - 1] !== last) ticks.push(last);
    return ticks;
  }, [xDomain]);

  // Resolve X positions for the campaign band / markers. Snap each timestamp to
  // the nearest domain entry so labels land on a real X tick even when
  // campaignStart falls on a day we didn't sample (e.g. when the campaign
  // started inside our pre-campaign lead-in).
  const xForTimestamp = useCallback(
    (ts: number): number | null => {
      if (xDomain.length === 0) return null;
      const label = formatBucketDate(ts);
      const direct = xScale(label);
      if (direct !== undefined) return direct;
      // Snap forward to the first sampled day that is on or after ts.
      const dayStart = Math.floor(ts / 86400) * 86400;
      for (let offset = 0; offset <= 86400 * 60; offset += 86400) {
        const probe = formatBucketDate(dayStart + offset);
        const x = xScale(probe);
        if (x !== undefined) return x;
      }
      return null;
    },
    [formatBucketDate, xDomain.length, xScale],
  );

  // Resolve every campaign's start/end into chart X coordinates. We drop any
  // entry whose entire window falls outside the rendered domain so the chart
  // doesn't render off-canvas dashed lines.
  const campaignBands = useMemo(() => {
    if (xDomain.length === 0) return [];
    return campaigns
      .map((c) => {
        const x1 = xForTimestamp(c.start);
        const x2 = xForTimestamp(c.end);
        if (x1 === null && x2 === null) return null;
        return {
          campaignId: c.campaignId,
          start: c.start,
          end: c.end,
          isLive: c.isLive,
          x1,
          x2,
          color: c.isLive ? COLOR_BOUNDARY_LIVE : COLOR_BOUNDARY_PAST,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.start - b.start);
  }, [campaigns, xDomain.length, xForTimestamp]);

  const lastDataX = chartData.length > 0
    ? xScale(chartData[chartData.length - 1].dateStr) ?? null
    : null;
  const anyCampaignLive = campaigns.some(
    (c) => c.isLive && now >= c.start && now <= c.end,
  );
  const showTodayMarker = anyCampaignLive && lastDataX !== null;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (chartData.length === 0 || innerW <= 0) return;
      const svgRect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!svgRect) return;
      const mouseX = e.clientX - svgRect.left - margin.left;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < chartData.length; i++) {
        const px = xScale(chartData[i].dateStr) ?? 0;
        const dist = Math.abs(px - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      setHoverIndex(closest);
    },
    [chartData, xScale, innerW, margin.left],
  );

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  const tooltipData =
    hoverIndex !== null && chartData[hoverIndex] ? chartData[hoverIndex] : null;
  const tooltipX = tooltipData ? (xScale(tooltipData.dateStr) ?? 0) : 0;

  const series = [
    { key: "campaign" as const, label: `Campaign LPs (${recipientAddressSet.size})`, color: COLOR_CAMPAIGN },
    { key: "other" as const, label: "Other LPs", color: COLOR_OTHER },
  ];

  const showSkeleton = isLoading || !poolData || chartData.length === 0;

  const hasLiveBand = campaignBands.some((b) => b.isLive);
  const hasPastBand = campaignBands.some((b) => !b.isLive);

  return (
    <div className={cn("relative flex flex-col", className)}>
      {/* Range selector + legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <CampaignTvlRangeSelector value={lookbackDays} onChange={setLookbackDays} />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[11px]">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="text-gray-500 dark:text-gray-400">{s.label}</span>
          </div>
        ))}
        {hasLiveBand && (
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: COLOR_BOUNDARY_LIVE }}
            />
            <span className="text-gray-700 dark:text-gray-200 font-semibold">
              Live campaign
            </span>
          </div>
        )}
        {hasPastBand && (
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: COLOR_BOUNDARY_PAST, opacity: 0.5 }}
            />
            <span className="text-gray-500 dark:text-gray-400">
              Previous
            </span>
          </div>
        )}
        </div>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {showSkeleton ? (
          <div className="bp-skeleton h-full w-full rounded-lg" />
        ) : width > 0 && height > 0 ? (
          <>
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
                <AreaStack<ChartPoint>
                  data={chartData}
                  keys={series.map((s) => s.key)}
                  x={(d) => xScale(d.data.dateStr) ?? 0}
                  y0={(d) => yScale(d[0]) ?? 0}
                  y1={(d) => yScale(d[1]) ?? 0}
                  curve={curveMonotoneX}
                >
                  {({ stacks, path }) => (
                    <>
                      {stacks.map((stack) => {
                        const def = series.find((s) => s.key === stack.key);
                        return (
                          <path
                            key={`area-${stack.key}`}
                            d={path(stack) || ""}
                            fill={def?.color ?? "#ccc"}
                            fillOpacity={stack.key === "campaign" ? 0.45 : 0.3}
                            stroke="none"
                          />
                        );
                      })}
                      {stacks.map((stack) => {
                        const def = series.find((s) => s.key === stack.key);
                        return (
                          <LinePath
                            key={`line-${stack.key}`}
                            data={stack}
                            x={(d) => xScale(d.data.dateStr) ?? 0}
                            y={(d) => yScale(d[1]) ?? 0}
                            stroke={def?.color ?? "#ccc"}
                            strokeWidth={1.5}
                            curve={curveMonotoneX}
                          />
                        );
                      })}
                    </>
                  )}
                </AreaStack>

                {/* Render PAST campaigns first (under the live one) so the
                   live band/labels visually win when they overlap. */}
                {[...campaignBands]
                  .sort((a, b) => Number(a.isLive) - Number(b.isLive))
                  .map((band) => (
                    <g key={band.campaignId} pointerEvents="none">
                      {band.x1 !== null && band.x2 !== null && band.x2 > band.x1 && (
                        <rect
                          x={band.x1}
                          y={0}
                          width={Math.max(0, band.x2 - band.x1)}
                          height={innerH}
                          fill={band.color}
                          fillOpacity={band.isLive ? 0.14 : 0.04}
                        />
                      )}
                      {band.x1 !== null && (
                        <>
                          <line
                            x1={band.x1}
                            x2={band.x1}
                            y1={-margin.top + 6}
                            y2={innerH}
                            stroke={band.color}
                            strokeWidth={band.isLive ? 1.75 : 1}
                            strokeDasharray={band.isLive ? "5,3" : "2,4"}
                            strokeOpacity={band.isLive ? 1 : 0.45}
                          />
                          <text
                            x={band.x1 + 5}
                            y={-8}
                            fill={band.color}
                            fontSize={band.isLive ? 10 : 9}
                            fontFamily="'JetBrains Mono', monospace"
                            fontWeight={band.isLive ? 700 : 500}
                            fillOpacity={band.isLive ? 1 : 0.7}
                          >
                            {band.isLive
                              ? `LIVE · ${formatBucketDate(band.start)}`
                              : `Prev · ${formatBucketDate(band.start)}`}
                          </text>
                        </>
                      )}
                      {band.x2 !== null && (
                        <>
                          <line
                            x1={band.x2}
                            x2={band.x2}
                            y1={-margin.top + 6}
                            y2={innerH}
                            stroke={band.color}
                            strokeWidth={band.isLive ? 1.75 : 1}
                            strokeDasharray={band.isLive ? "5,3" : "2,4"}
                            strokeOpacity={band.isLive ? 1 : 0.45}
                          />
                          <text
                            x={band.x2 - 5}
                            y={-8}
                            fill={band.color}
                            fontSize={band.isLive ? 10 : 9}
                            fontFamily="'JetBrains Mono', monospace"
                            fontWeight={band.isLive ? 700 : 500}
                            fillOpacity={band.isLive ? 1 : 0.7}
                            textAnchor="end"
                          >
                            {formatBucketDate(band.end)}
                          </text>
                        </>
                      )}
                    </g>
                  ))}

                {/* "Today" marker — only when a campaign is currently live */}
                {showTodayMarker && lastDataX !== null && (
                  <g pointerEvents="none">
                    <line
                      x1={lastDataX}
                      x2={lastDataX}
                      y1={0}
                      y2={innerH}
                      stroke="var(--bp-text-muted)"
                      strokeWidth={1}
                      strokeOpacity={0.45}
                    />
                    <circle
                      cx={lastDataX}
                      cy={6}
                      r={3}
                      fill={COLOR_BOUNDARY_LIVE}
                      stroke="white"
                      strokeWidth={1}
                    />
                  </g>
                )}

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
                  numTicks={4}
                  tickFormat={(v) => formatCompact(v as number)}
                  stroke="transparent"
                  tickStroke="transparent"
                  tickLabelProps={() => ({
                    fill: "var(--bp-text-muted)",
                    fontSize: 9,
                    fontFamily: "'JetBrains Mono', monospace",
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
                    fontFamily: "'JetBrains Mono', monospace",
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

            {tooltipData && (
              <div
                className="absolute pointer-events-none z-10"
                style={{
                  left:
                    margin.left + tooltipX + (tooltipX > innerW / 2 ? -8 : 8),
                  top: margin.top + 4,
                  transform:
                    tooltipX > innerW / 2 ? "translateX(-100%)" : undefined,
                }}
              >
                <div className="bg-white/90 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 shadow-lg backdrop-blur-sm">
                  <div className="text-[10px] font-bold text-gray-600 dark:text-gray-300 mb-1">
                    {tooltipData.dateStr}
                  </div>
                  {series.map((s) => {
                    const val =
                      s.key === "campaign"
                        ? tooltipData.campaign
                        : tooltipData.other;
                    return (
                      <div
                        key={s.key}
                        className="flex items-center justify-between gap-3 text-[10px]"
                      >
                        <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-sm"
                            style={{ background: s.color }}
                          />
                          {s.label}
                        </span>
                        <span className="text-gray-700 dark:text-gray-200 font-medium tabular-nums">
                          {formatUsdValue(val)}
                        </span>
                      </div>
                    );
                  })}
                  <div className="border-t border-gray-200 dark:border-gray-700/50 mt-1 pt-1 flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-gray-500 dark:text-gray-400 font-bold">
                      Total
                    </span>
                    <span className="text-gray-900 dark:text-white font-bold tabular-nums">
                      {formatUsdValue(
                        tooltipData.campaign + tooltipData.other,
                      )}
                    </span>
                  </div>
                  {tooltipData.campaign + tooltipData.other > 0 && (
                    <div className="flex items-center justify-between gap-3 text-[10px] mt-0.5">
                      <span className="text-gray-400">
                        {rewardSymbol} share
                      </span>
                      <span
                        className="font-medium tabular-nums"
                        style={{ color: COLOR_CAMPAIGN }}
                      >
                        {(
                          (tooltipData.campaign /
                            (tooltipData.campaign + tooltipData.other)) *
                          100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
});
