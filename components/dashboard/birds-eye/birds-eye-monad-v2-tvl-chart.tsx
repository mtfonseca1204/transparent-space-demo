"use client";

import React, {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { scaleLinear, scalePoint } from "@visx/scale";
import { AreaStack, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import { cn } from "@/lib/utils";
import { MONAD_V2_DUST_USDC_POOL_KEY } from "@/lib/monad-v2-dashboard";
import { useMonadV2Dashboard } from "@/hooks/use-monad-v2-dashboard";
import {
  CampaignTvlRangeSelector,
  CAMPAIGN_TVL_DEFAULT_RANGE,
} from "./campaign-tvl-range-selector";

// Colour palette — kept aligned with the Katana TVL chart so the two surfaces
// read as a family. Boundary colours separate live (emerald) from previous
// (amber) campaign windows.
const COLOR_CAMPAIGN = "#06b6d4"; // tailwind cyan-500 — LPs earning rewards
const COLOR_OTHER = "#9ca3af"; // tailwind gray-400 — non-campaign LPs
const COLOR_BOUNDARY_LIVE = "#10b981"; // emerald-500
const COLOR_BOUNDARY_PAST = "#f59e0b"; // amber-500

// Token decimals for the Monad V2 DUST/USDC pair (token0=USDC, token1=DUST).
const USDC_DECIMALS = 6;
const DUST_DECIMALS = 18;

interface MonadPoolDayData {
  id: string;
  pool: string;
  protocol: string;
  date: number;
  tvlToken0: string;
  tvlToken1: string;
}

async function fetchMonadV2PoolDayData(days: number): Promise<MonadPoolDayData[]> {
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const startTime = roundedNow - days * 86400;
  const url = `/api/worldchain-entities?space=monad&entity=PoolDayData&pool=${encodeURIComponent(
    `143-${MONAD_V2_DUST_USDC_POOL_KEY}`,
  )}&from=${startTime}&limit=2000`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`monad PoolDayData HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: MonadPoolDayData[] };
  return (json.data ?? []).sort((a, b) => a.date - b.date);
}

export interface MonadCampaignWindow {
  campaignId: string;
  start: number;
  end: number;
  isLive: boolean;
}

interface BirdsEyeMonadV2TvlChartProps {
  campaigns: MonadCampaignWindow[];
  /**
   * Addresses considered "campaign LPs" — typically every Merkl reward
   * recipient. The chart splits historical pool TVL into a campaign-LP stack
   * (sum of these wallets' current shares) and an "other LPs" stack.
   */
  highlightedAddresses?: Set<string> | null;
  className?: string;
}

interface ChartPoint {
  date: number;
  dateStr: string;
  campaign: number;
  other: number;
}

function formatUsdValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${formatCompact(value).replace(/^\$/, "")}`;
}

export const BirdsEyeMonadV2TvlChart = memo(function BirdsEyeMonadV2TvlChart({
  campaigns,
  highlightedAddresses,
  className,
}: BirdsEyeMonadV2TvlChartProps) {
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

  const now = Math.floor(Date.now() / 1000);
  // User-selectable lookback (30/45/60/90d).
  const [lookbackDays, setLookbackDays] = useState<number>(CAMPAIGN_TVL_DEFAULT_RANGE);

  const { data: rawDays, isLoading } = useQuery({
    queryKey: ["monad-v2-pool-day-data", MONAD_V2_DUST_USDC_POOL_KEY, lookbackDays],
    queryFn: () => fetchMonadV2PoolDayData(lookbackDays),
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const formatBucketDate = useCallback((unixSec: number): string => {
    const d = new Date(unixSec * 1000);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }, []);

  // V2 LP shares snapshot — used to split each day's pool TVL into a
  // campaign-LP stack and an "other LPs" stack. We use the current LP shares
  // as a proxy for historical shares; over the campaign window the deltas are
  // typically small enough that this is a good approximation. A proper
  // event-replay would tighten it but adds significant complexity for V2.
  const { data: dashboardData } = useMonadV2Dashboard();
  const campaignShare = useMemo(() => {
    if (!highlightedAddresses || highlightedAddresses.size === 0) return 0;
    if (!dashboardData) return 0;
    let s = 0;
    for (const h of dashboardData.lp.topHolders) {
      if (highlightedAddresses.has(h.address.toLowerCase())) s += h.share;
    }
    // The aggregated "others" bucket (everyone below the top-9) is left in
    // the "other LPs" stack — we can't decompose it without a full holder
    // enumeration. This conservatively under-counts campaign LP TVL when
    // small recipients fall below the top-9 threshold.
    return Math.min(1, Math.max(0, s));
  }, [dashboardData, highlightedAddresses]);

  // For V2 the on-chain pool is permanently balanced 50/50 in USD value (any
  // imbalance is arbitraged away). We therefore price the DUST side from the
  // pool itself instead of an oracle: USDC reserve / DUST reserve gives DUST
  // USD, and TVL = USDC_USD + DUST_USD = 2 × USDC_USD.
  const chartData = useMemo<ChartPoint[]>(() => {
    if (!rawDays) return [];
    const out: ChartPoint[] = [];
    for (const row of rawDays) {
      const usdcReserve = Number(row.tvlToken0) / Math.pow(10, USDC_DECIMALS);
      const dustReserve = Number(row.tvlToken1) / Math.pow(10, DUST_DECIMALS);
      if (!Number.isFinite(usdcReserve) || !Number.isFinite(dustReserve)) continue;
      if (usdcReserve <= 0 || dustReserve <= 0) continue;
      // USDC ≈ $1; both halves of a balanced V2 pool sum to 2×USDC_USD.
      const tvl = usdcReserve * 2;
      const campaign = tvl * campaignShare;
      const other = Math.max(0, tvl - campaign);
      out.push({
        date: row.date,
        dateStr: formatBucketDate(row.date),
        campaign,
        other,
      });
    }
    return out;
  }, [rawDays, campaignShare, formatBucketDate]);

  const { width, height } = dimensions;
  // Top margin is computed dynamically further below (after the label
  // collision-resolver runs) so it always fits however many label rows we
  // ended up stacking. Left / right / bottom are stable.
  const baseMargin = { right: 12, bottom: 28, left: 56 };
  const innerW = Math.max(0, width - baseMargin.left - baseMargin.right);

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
  // yScale is defined further down — it depends on `innerH`, which we only
  // know after the label collision-resolver tells us how many rows of
  // campaign-boundary labels need to fit in the top margin.

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

  const xForTimestamp = useCallback(
    (ts: number): number | null => {
      if (xDomain.length === 0) return null;
      const label = formatBucketDate(ts);
      const direct = xScale(label);
      if (direct !== undefined) return direct;
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
      .sort((a, b) => Number(a.isLive) - Number(b.isLive));
  }, [campaigns, xDomain.length, xForTimestamp]);

  // ── Label collision avoidance ────────────────────────────────────────
  // Compute every "top-of-line" label (start + end for each band), estimate
  // its on-screen width, then greedily assign it to the lowest row that
  // doesn't overlap an already-placed label. Two rows is enough for our
  // typical case (one previous + one live campaign, end of prev colliding
  // with start of live).
  type LabelMarker = {
    key: string;
    x: number;
    text: string;
    anchor: "start" | "end";
    color: string;
    isLive: boolean;
    row: number;
  };
  const labelMarkers = useMemo<LabelMarker[]>(() => {
    // One label per band (anchored at the band's start) — the end's date is
    // already visible on the X-axis just below, so a duplicate end-of-band
    // label only created crowding when prev-end and live-start fell on
    // adjacent days. The end dashed line is still drawn, just without a
    // text label on top.
    const markers: Omit<LabelMarker, "row">[] = [];
    for (const band of campaignBands) {
      if (band.x1 !== null) {
        markers.push({
          key: `${band.campaignId}-start`,
          x: band.x1 + 5,
          text: band.isLive
            ? `LIVE · ${formatBucketDate(band.start)} → ${formatBucketDate(band.end)}`
            : `Prev · ${formatBucketDate(band.start)} → ${formatBucketDate(band.end)}`,
          anchor: "start",
          color: band.color,
          isLive: band.isLive,
        });
      }
    }
    const bbox = (m: Omit<LabelMarker, "row">): [number, number] => {
      const fontSize = m.isLive ? 10 : 9;
      const width = m.text.length * fontSize * 0.62;
      return m.anchor === "start" ? [m.x, m.x + width] : [m.x - width, m.x];
    };
    const sorted = markers
      .map((m, i) => ({ m, i, box: bbox(m) }))
      .sort((a, b) => a.box[0] - b.box[0]);
    const rowEnds: number[] = [];
    const out: LabelMarker[] = new Array(markers.length);
    for (const item of sorted) {
      let assignedRow = -1;
      for (let r = 0; r < rowEnds.length; r++) {
        // 4px gap between adjacent labels on the same row.
        if (rowEnds[r] + 4 < item.box[0]) {
          assignedRow = r;
          rowEnds[r] = item.box[1];
          break;
        }
      }
      if (assignedRow === -1) {
        assignedRow = rowEnds.length;
        rowEnds.push(item.box[1]);
      }
      out[item.i] = { ...item.m, row: assignedRow };
    }
    return out;
  }, [campaignBands, formatBucketDate]);

  // Top margin sized to fit however many label rows the collision resolver
  // emitted (so the topmost row never gets clipped above the SVG). Base of
  // 14px keeps a small buffer; each row adds 12px (matches the LABEL_ROW_STEP
  // used when rendering the labels themselves).
  const LABEL_ROW_STEP = 12;
  const maxLabelRow = labelMarkers.reduce((m, lbl) => Math.max(m, lbl.row), 0);
  const marginTop = 14 + (maxLabelRow + 1) * LABEL_ROW_STEP;
  const margin = { top: marginTop, ...baseMargin };
  const innerH = Math.max(0, height - margin.top - margin.bottom);
  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH],
  );

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

  const hasLiveBand = campaignBands.some((b) => b.isLive);
  const hasPastBand = campaignBands.some((b) => !b.isLive);
  const showSkeleton = isLoading || chartData.length === 0;

  return (
    <div className={cn("relative flex flex-col", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <CampaignTvlRangeSelector value={lookbackDays} onChange={setLookbackDays} />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_CAMPAIGN }} />
          <span className="text-gray-500 dark:text-gray-400">Campaign LPs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_OTHER }} />
          <span className="text-gray-500 dark:text-gray-400">Other LPs</span>
        </div>
        {hasLiveBand && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_BOUNDARY_LIVE }} />
            <span className="text-gray-700 dark:text-gray-200 font-semibold">Live campaign</span>
          </div>
        )}
        {hasPastBand && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_BOUNDARY_PAST, opacity: 0.5 }} />
            <span className="text-gray-500 dark:text-gray-400">Previous</span>
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
                  keys={["campaign", "other"]}
                  x={(d) => xScale(d.data.dateStr) ?? 0}
                  y0={(d) => yScale(d[0]) ?? 0}
                  y1={(d) => yScale(d[1]) ?? 0}
                  curve={curveMonotoneX}
                >
                  {({ stacks, path }) => (
                    <>
                      {stacks.map((stack) => (
                        <path
                          key={`area-${stack.key}`}
                          d={path(stack) || ""}
                          fill={stack.key === "campaign" ? COLOR_CAMPAIGN : COLOR_OTHER}
                          fillOpacity={stack.key === "campaign" ? 0.45 : 0.3}
                          stroke="none"
                        />
                      ))}
                      {stacks.map((stack) => (
                        <LinePath
                          key={`line-${stack.key}`}
                          data={stack}
                          x={(d) => xScale(d.data.dateStr) ?? 0}
                          y={(d) => yScale(d[1]) ?? 0}
                          stroke={stack.key === "campaign" ? COLOR_CAMPAIGN : COLOR_OTHER}
                          strokeWidth={1.5}
                          curve={curveMonotoneX}
                        />
                      ))}
                    </>
                  )}
                </AreaStack>

                {campaignBands.map((band) => (
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
                    )}
                    {band.x2 !== null && (
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
                    )}
                  </g>
                ))}

                {/* Labels rendered separately with collision-aware row
                   assignment so overlapping start/end dates stack instead of
                   piling on top of each other at y = -8. */}
                {labelMarkers.map((m) => (
                  <text
                    key={m.key}
                    x={m.x}
                    y={-8 - m.row * LABEL_ROW_STEP}
                    fill={m.color}
                    fontSize={m.isLive ? 10 : 9}
                    fontFamily="'JetBrains Mono', monospace"
                    fontWeight={m.isLive ? 700 : 500}
                    fillOpacity={m.isLive ? 1 : 0.7}
                    textAnchor={m.anchor === "end" ? "end" : "start"}
                    pointerEvents="none"
                  >
                    {m.text}
                  </text>
                ))}

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
                <div className="bg-white/90 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 shadow-lg backdrop-blur-sm min-w-[160px]">
                  <div className="text-[10px] font-bold text-gray-600 dark:text-gray-300 mb-1">
                    {tooltipData.dateStr}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ background: COLOR_CAMPAIGN }} />
                      Campaign LPs
                    </span>
                    <span className="text-gray-900 dark:text-white font-medium tabular-nums">
                      {formatUsdValue(tooltipData.campaign)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-sm" style={{ background: COLOR_OTHER }} />
                      Other LPs
                    </span>
                    <span className="text-gray-900 dark:text-white font-medium tabular-nums">
                      {formatUsdValue(tooltipData.other)}
                    </span>
                  </div>
                  <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-700/50 flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-gray-500 dark:text-gray-400 font-bold">Total</span>
                    <span className="text-gray-900 dark:text-white font-bold tabular-nums">
                      {formatUsdValue(tooltipData.campaign + tooltipData.other)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
});
