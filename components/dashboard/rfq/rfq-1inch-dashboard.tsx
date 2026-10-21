"use client";

import React, { useState, useMemo, useRef, useLayoutEffect, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  useOneInchRfqData,
  type OneInchTierRow,
} from "@/hooks/use-1inch-rfq-data";
import {
  useOneInchRfqHistory,
  type OneInchHistoryPoint,
  type OneInchUptimeStats,
} from "@/hooks/use-1inch-rfq-history";
import {
  PoolHeader,
  PoolTokens,
  TokenIcon,
  PoolInfo,
  PoolName,
  PoolBadges,
  PoolBadge,
} from "@/components/dashboard/pool-header";
import {
  MetricCard,
  MetricLabel,
  MetricValue,
  MetricUnit,
  MetricCardSkeleton,
} from "@/components/dashboard/metric-card";
import {
  ChartCard,
  ChartHeader,
  ChartTitle,
  ChartContent,
  ChartCardSkeleton,
} from "@/components/dashboard/chart-card";
import { usePoolCandles } from "@/hooks/use-pool-candles";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import { SlaHeatmapCalendar } from "./sla-heatmap-calendar";
import { scaleLinear, scaleBand, scaleTime } from "@visx/scale";
import { AreaClosed, LinePath, Bar } from "@visx/shape";
import { curveStepAfter, curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";

// Find a Raydium pool address for a given asset symbol
function findPoolForAsset(asset: string): { poolKey: string; token0Decimals: number; token1Decimals: number } | null {
  const sym = asset.endsWith("x") ? asset : asset;
  for (const [poolKey, meta] of Object.entries(SOLANA_POOL_METADATA_BY_ADDRESS)) {
    if (meta.token0Symbol.toLowerCase() === sym.toLowerCase()) {
      return { poolKey, token0Decimals: meta.token0Decimals, token1Decimals: meta.token1Decimals };
    }
  }
  return null;
}

// ─── Tab types ───────────────────────────────────────────────────────────────

type OneInchTab = "historical" | "overview" | "price-impact" | "presets" | "alerts";

const TABS: { id: OneInchTab; label: string }[] = [
  { id: "historical", label: "Historical" },
  { id: "overview", label: "Overview" },
  { id: "price-impact", label: "Price Impact" },
  { id: "presets", label: "Presets" },
  { id: "alerts", label: "Alerts" },
];

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export function Rfq1inchDashboard({ asset }: { asset: string }) {
  const data = useOneInchRfqData(asset);
  const [activeTab, setActiveTab] = useState<OneInchTab>("historical");

  if (data.isLoading) {
    return (
      <div className="flex-1 p-4 md:p-6 overflow-auto">
        <div id="dashboard-top" className="flex flex-col gap-3">
          <OneInchHeader asset={asset} quoteAt={null} />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <MetricCardSkeleton key={i} />
            ))}
          </div>
          <ChartCardSkeleton />
        </div>
      </div>
    );
  }

  if (data.isError || data.allQuotesFailed) {
    return (
      <div className="flex-1 p-4 md:p-6 overflow-auto">
        <div id="dashboard-top" className="flex flex-col gap-3">
          <OneInchHeader asset={asset} quoteAt={data.quoteAt} />
          <div className="bp-card p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center">
              <span className="text-xl text-sky-500">1</span>
            </div>
            <p className="text-sm font-medium text-[var(--bp-text-primary)] mb-1">
              {data.isError
                ? "Failed to load 1inch RFQ data"
                : "No 1inch Data Available"}
            </p>
            <p className="text-xs text-[var(--bp-text-muted)] max-w-md mx-auto">
              {data.isError
                ? "Will retry automatically."
                : `${asset} has no 1inch Fusion quotes available yet.`}
            </p>
            <p className="text-[10px] text-[var(--bp-text-muted)] mt-3">
              Data refreshes every 60s.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-6 overflow-auto">
      <div id="dashboard-top" className="flex flex-col gap-3">
        <OneInchHeader asset={asset} quoteAt={data.quoteAt} />
        <SlaHeatmapCalendar asset={asset} />
        <OneInchHistoricalSection asset={asset} />
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function OneInchHeader({
  asset,
  quoteAt,
}: {
  asset: string;
  quoteAt: string | null;
}) {
  const formattedTime = quoteAt
    ? new Date(quoteAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : null;

  return (
    <PoolHeader>
      <PoolTokens>
        <TokenIcon symbol={asset} className="w-[50px] h-[50px]" />
        <TokenIcon symbol="USDC" className="w-[50px] h-[50px]" />
      </PoolTokens>
      <PoolInfo>
        <PoolName>
          {asset}/USDC RFQ
        </PoolName>
        <PoolBadges>
          <PoolBadge variant="primary">RFQ</PoolBadge>
          <PoolBadge>1inch</PoolBadge>
          <PoolBadge>Fusion</PoolBadge>
          <PoolBadge>Ethereum</PoolBadge>
          {formattedTime && <PoolBadge>{formattedTime}</PoolBadge>}
        </PoolBadges>
      </PoolInfo>
    </PoolHeader>
  );
}

// ─── Summary Cards ───────────────────────────────────────────────────────────

function impactColor(bps: number): string {
  if (bps < 10) return "text-emerald-500";
  if (bps < 50) return "text-amber-500";
  return "text-red-500";
}

function OneInchSummaryCards({
  forwardTiers,
  reverseTiers,
}: {
  forwardTiers: OneInchTierRow[];
  reverseTiers: OneInchTierRow[];
}) {
  const [direction, setDirection] = useState<"forward" | "reverse">("forward");
  const tiers = direction === "forward" ? forwardTiers : reverseTiers;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDirection("forward")}
          className={cn(
            "px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
            direction === "forward"
              ? "bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          )}
        >
          Buy Token
        </button>
        <button
          type="button"
          onClick={() => setDirection("reverse")}
          className={cn(
            "px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
            direction === "reverse"
              ? "bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          )}
        >
          Sell Token
        </button>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
        {tiers.map((tier) => (
          <MetricCard key={`${tier.direction}-${tier.notionalUsd}`}>
            <MetricLabel>{tier.label} swap</MetricLabel>
            <MetricValue>
              <span className={impactColor(tier.priceImpactBps)}>
                {tier.priceImpactBps < 0.01
                  ? "~0"
                  : tier.priceImpactBps.toFixed(2)}
              </span>
            </MetricValue>
            <MetricUnit>bps impact</MetricUnit>
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
                ${tier.impliedTokenPrice.toFixed(4)}/token
              </span>
              <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
                whitelist: {tier.whitelistCount}
              </span>
              <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
                preset: {tier.recommendedPreset ?? "\u2014"}
              </span>
            </div>
          </MetricCard>
        ))}
      </div>
    </div>
  );
}

// ─── Tab Nav ─────────────────────────────────────────────────────────────────

function OneInchTabNav({
  activeTab,
  onChange,
}: {
  activeTab: OneInchTab;
  onChange: (tab: OneInchTab) => void;
}) {
  return (
    <div className="border-b border-[var(--bp-border-secondary)]">
      <nav className="flex gap-0.5" aria-label="1inch RFQ tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "px-4 py-2.5 text-[13px] font-semibold tracking-wide transition-colors relative whitespace-nowrap cursor-pointer",
              activeTab === tab.id
                ? "text-[var(--bp-accent-primary)]"
                : "text-[var(--bp-text-secondary)] hover:text-[var(--bp-text-primary)]"
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--bp-accent-primary)] rounded-full" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCompact = (value: number): string => {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

// ─── Overview Section ────────────────────────────────────────────────────────

function OneInchOverviewSection({
  forwardTiers,
  reverseTiers,
  tiers,
}: {
  forwardTiers: OneInchTierRow[];
  reverseTiers: OneInchTierRow[];
  tiers: OneInchTierRow[];
}) {
  return (
    <>
      <OneInchDepthChart forwardTiers={forwardTiers} reverseTiers={reverseTiers} />
      <OneInchQuotesTable tiers={tiers} />
    </>
  );
}

// ─── Depth Chart ─────────────────────────────────────────────────────────────

interface DepthPoint {
  price: number;
  cumulativeUsd: number;
}

function OneInchDepthChart({
  forwardTiers,
  reverseTiers,
}: {
  forwardTiers: OneInchTierRow[];
  reverseTiers: OneInchTierRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverInfo, setHoverInfo] = useState<{
    side: "bid" | "ask";
    idx: number;
  } | null>(null);

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

  const { bidPoints, askPoints, midPrice, viewMin, viewMax } = useMemo(() => {
    if (forwardTiers.length === 0 && reverseTiers.length === 0) {
      return { bidPoints: [], askPoints: [], midPrice: 0, viewMin: 0, viewMax: 1 };
    }

    const filterOutliers = (points: { price: number; notionalUsd: number }[]) => {
      if (points.length === 0) return points;
      const prices = points.map((p) => p.price).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      return points.filter(
        (p) => p.price > median * 0.5 && p.price < median * 1.5
      );
    };

    const rawBids = reverseTiers
      .map((t) => ({ price: t.impliedTokenPrice, notionalUsd: t.notionalUsd }))
      .filter((p) => p.price > 0);
    const rawAsks = forwardTiers
      .map((t) => ({ price: t.impliedTokenPrice, notionalUsd: t.notionalUsd }))
      .filter((p) => p.price > 0);

    const cleanBids = filterOutliers(rawBids);
    const cleanAsks = filterOutliers(rawAsks);

    const sortedBids = [...cleanBids].sort((a, b) => b.price - a.price);
    const bids: DepthPoint[] = sortedBids.map((p) => ({
      price: p.price,
      cumulativeUsd: p.notionalUsd,
    }));

    const sortedAsks = [...cleanAsks].sort((a, b) => a.price - b.price);
    const asks: DepthPoint[] = sortedAsks.map((p) => ({
      price: p.price,
      cumulativeUsd: p.notionalUsd,
    }));

    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const mid =
      bestBid > 0 && bestAsk > 0
        ? (bestBid + bestAsk) / 2
        : bestBid || bestAsk;

    const spread = bestBid > 0 && bestAsk > 0 ? Math.abs(bestAsk - bestBid) : 0;
    const halfWindow = Math.max(spread * 3, mid * 0.1) || mid * 0.1 || 1;
    const vMin = mid - halfWindow;
    const vMax = mid + halfWindow;

    const buildBidArea = (points: DepthPoint[]): DepthPoint[] => {
      const visible = points.filter((p) => p.price >= vMin);
      if (visible.length === 0) return [];
      const ascending = [...visible].reverse();
      const maxDepth = ascending[0].cumulativeUsd;
      return [
        { price: vMin, cumulativeUsd: maxDepth },
        ...ascending,
        { price: ascending[ascending.length - 1].price, cumulativeUsd: 0 },
      ];
    };

    const buildAskArea = (points: DepthPoint[]): DepthPoint[] => {
      const visible = points.filter((p) => p.price <= vMax);
      if (visible.length === 0) return [];
      const maxDepth = visible[visible.length - 1].cumulativeUsd;
      return [
        { price: visible[0].price, cumulativeUsd: 0 },
        ...visible,
        { price: vMax, cumulativeUsd: maxDepth },
      ];
    };

    return {
      bidPoints: buildBidArea(bids),
      askPoints: buildAskArea(asks),
      midPrice: mid,
      viewMin: vMin,
      viewMax: vMax,
    };
  }, [forwardTiers, reverseTiers]);

  const { width, height } = dimensions;
  const margin = { top: 20, right: 20, bottom: 44, left: 64 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [viewMin, viewMax], range: [0, innerW] }),
    [viewMin, viewMax, innerW]
  );

  const yMax = useMemo(() => {
    const allVals = [
      ...bidPoints.map((p) => p.cumulativeUsd),
      ...askPoints.map((p) => p.cumulativeUsd),
    ];
    return Math.max(...allVals, 1) * 1.1;
  }, [bidPoints, askPoints]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  const hoverPoint = useMemo(() => {
    if (!hoverInfo) return null;
    const points = hoverInfo.side === "bid" ? bidPoints : askPoints;
    return points[hoverInfo.idx + 1] ?? null;
  }, [hoverInfo, bidPoints, askPoints]);

  if (bidPoints.length <= 1 && askPoints.length <= 1) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>1inch Depth Curve</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <p className="text-[11px] text-[var(--bp-text-muted)] text-center py-12">
            No depth data available
          </p>
        </ChartContent>
      </ChartCard>
    );
  }

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>1inch Depth Curve</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Cumulative liquidity at each price level — bids (sell) on left, asks (buy) on right
        </p>
        <div ref={containerRef} className="w-full h-[380px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <defs>
                <linearGradient id="oneinch-bid-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="oneinch-ask-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.1} />
                </linearGradient>
              </defs>

              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={5}
                />

                {midPrice > 0 && (
                  <>
                    <line
                      x1={xScale(midPrice)}
                      x2={xScale(midPrice)}
                      y1={0}
                      y2={innerH}
                      stroke="var(--bp-text-muted)"
                      strokeWidth={1}
                      strokeDasharray="4,4"
                      opacity={0.5}
                    />
                    <text
                      x={xScale(midPrice)}
                      y={-6}
                      textAnchor="middle"
                      fill="var(--bp-text-muted)"
                      fontSize={10}
                      fontFamily="inherit"
                    >
                      Mid ${midPrice.toFixed(2)}
                    </text>
                  </>
                )}

                {bidPoints.length > 1 && (
                  <>
                    <AreaClosed
                      data={bidPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      yScale={yScale}
                      curve={curveStepAfter}
                      fill="url(#oneinch-bid-gradient)"
                    />
                    <LinePath
                      data={bidPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      curve={curveStepAfter}
                      stroke="#22c55e"
                      strokeWidth={2}
                    />
                  </>
                )}

                {askPoints.length > 1 && (
                  <>
                    <AreaClosed
                      data={askPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      yScale={yScale}
                      curve={curveStepAfter}
                      fill="url(#oneinch-ask-gradient)"
                    />
                    <LinePath
                      data={askPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      curve={curveStepAfter}
                      stroke="#ef4444"
                      strokeWidth={2}
                    />
                  </>
                )}

                {bidPoints.slice(1, -1).map((pt, i) => (
                  <circle
                    key={`bid-${i}`}
                    cx={xScale(pt.price)}
                    cy={yScale(pt.cumulativeUsd)}
                    r={hoverInfo?.side === "bid" && hoverInfo.idx === i ? 6 : 4}
                    fill="#22c55e"
                    stroke="var(--bp-bg-primary)"
                    strokeWidth={2}
                    onMouseEnter={() => setHoverInfo({ side: "bid", idx: i })}
                    onMouseLeave={() => setHoverInfo(null)}
                    style={{ cursor: "pointer" }}
                  />
                ))}

                {askPoints.slice(1, -1).map((pt, i) => (
                  <circle
                    key={`ask-${i}`}
                    cx={xScale(pt.price)}
                    cy={yScale(pt.cumulativeUsd)}
                    r={hoverInfo?.side === "ask" && hoverInfo.idx === i ? 6 : 4}
                    fill="#ef4444"
                    stroke="var(--bp-bg-primary)"
                    strokeWidth={2}
                    onMouseEnter={() => setHoverInfo({ side: "ask", idx: i })}
                    onMouseLeave={() => setHoverInfo(null)}
                    style={{ cursor: "pointer" }}
                  />
                ))}

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  numTicks={7}
                  tickFormat={(v) => `$${Number(v).toFixed(2)}`}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 11,
                    fontFamily: "inherit",
                    textAnchor: "middle",
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  stroke="transparent"
                  tickStroke="transparent"
                  numTicks={5}
                  tickFormat={(v) => formatCompact(Number(v))}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "end",
                    dx: -4,
                  }}
                />
              </Group>
            </svg>
          )}

          {hoverPoint && hoverInfo && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left: margin.left + xScale(hoverPoint.price),
                top: margin.top + yScale(hoverPoint.cumulativeUsd) - 8,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold">
                {formatCompact(hoverPoint.cumulativeUsd)}
              </div>
              <div
                className={
                  hoverInfo.side === "bid" ? "text-emerald-500" : "text-red-500"
                }
              >
                {hoverInfo.side === "bid" ? "Bid" : "Ask"} @{" "}
                ${hoverPoint.price.toFixed(2)}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-6 justify-center mt-2">
          <span className="text-[10px] text-emerald-500 flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-emerald-500 rounded" />
            Bids (Sell)
          </span>
          <span className="text-[10px] text-red-500 flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-red-500 rounded" />
            Asks (Buy)
          </span>
          <span className="text-[10px] text-[var(--bp-text-muted)] flex items-center gap-1.5">
            <span className="inline-block w-3 h-0 border-t border-dashed border-[var(--bp-text-muted)]" />
            Mid Price
          </span>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Quotes Table ────────────────────────────────────────────────────────────

function OneInchQuotesTable({ tiers }: { tiers: OneInchTierRow[] }) {
  if (tiers.length === 0) return null;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>1inch Quotes</ChartTitle>
      </ChartHeader>
      <ChartContent className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-[var(--bp-border-subtle)]">
              {[
                "Size",
                "Direction",
                "$/Token",
                "Whitelist",
                "Gas",
                "Impact (bps)",
                "Preset",
                "Status",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left py-2 px-2.5 font-semibold text-[var(--bp-text-muted)] text-[10px] uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => {
              const status = tier.priceImpactBps < 50 ? "TIGHT" : "WIDE";
              return (
                <tr
                  key={`${tier.direction}-${tier.notionalUsd}`}
                  className="border-b border-[var(--bp-border-subtle)]/50 hover:bg-[var(--bp-bg-hover)]"
                >
                  <td className="py-2 px-2.5 text-[var(--bp-text-primary)] font-semibold">
                    {tier.label}
                  </td>
                  <td className="py-2 px-2.5">
                    <span
                      className={cn(
                        "text-[9px] px-1.5 py-0.5 font-medium",
                        tier.direction === "forward"
                          ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                          : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                      )}
                    >
                      {tier.direction === "forward" ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className="py-2 px-2.5 text-[var(--bp-text-primary)]">
                    ${tier.impliedTokenPrice.toFixed(4)}
                  </td>
                  <td className="py-2 px-2.5 text-[var(--bp-text-muted)]">
                    {tier.whitelistCount}
                  </td>
                  <td className="py-2 px-2.5 text-[var(--bp-text-muted)]">
                    {tier.estimatedGas > 0 ? tier.estimatedGas.toLocaleString() : "\u2014"}
                  </td>
                  <td className={cn("py-2 px-2.5 font-semibold", impactColor(tier.priceImpactBps))}>
                    {tier.priceImpactBps.toFixed(2)}
                  </td>
                  <td className="py-2 px-2.5 text-[var(--bp-text-muted)]">
                    {tier.recommendedPreset ?? "\u2014"}
                  </td>
                  <td className="py-2 px-2.5">
                    <span
                      className={cn(
                        "text-[9px] px-1.5 py-0.5 font-medium rounded",
                        status === "TIGHT"
                          ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Presets Section ─────────────────────────────────────────────────────────

function truncateBigInt(val: string | null | undefined): string {
  if (!val) return "\u2014";
  if (val.length <= 8) return val;
  return val.slice(0, 8) + "...";
}

function OneInchPresetsSection({ forwardTiers }: { forwardTiers: OneInchTierRow[] }) {
  if (forwardTiers.length === 0) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Fusion Auction Presets</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <p className="text-[11px] text-[var(--bp-text-muted)] text-center py-12">
            No preset data available
          </p>
        </ChartContent>
      </ChartCard>
    );
  }

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Fusion Auction Presets</ChartTitle>
      </ChartHeader>
      <ChartContent className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-[var(--bp-border-subtle)]">
              <th
                rowSpan={2}
                className="text-left py-2 px-2.5 font-semibold text-[var(--bp-text-muted)] text-[10px] uppercase tracking-wider align-bottom"
              >
                Size
              </th>
              <th
                colSpan={3}
                className="text-center py-1 px-2.5 font-semibold text-emerald-500 text-[10px] uppercase tracking-wider border-b border-[var(--bp-border-subtle)]"
              >
                Fast
              </th>
              <th
                colSpan={3}
                className="text-center py-1 px-2.5 font-semibold text-amber-500 text-[10px] uppercase tracking-wider border-b border-[var(--bp-border-subtle)]"
              >
                Medium
              </th>
              <th
                colSpan={3}
                className="text-center py-1 px-2.5 font-semibold text-red-500 text-[10px] uppercase tracking-wider border-b border-[var(--bp-border-subtle)]"
              >
                Slow
              </th>
            </tr>
            <tr className="border-b border-[var(--bp-border-subtle)]">
              {["Duration", "Start", "End", "Duration", "Start", "End", "Duration", "Start", "End"].map(
                (h, i) => (
                  <th
                    key={`${h}-${i}`}
                    className="text-left py-1 px-2 font-semibold text-[var(--bp-text-muted)] text-[9px] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {forwardTiers.map((tier) => (
              <tr
                key={`preset-${tier.notionalUsd}`}
                className="border-b border-[var(--bp-border-subtle)]/50 hover:bg-[var(--bp-bg-hover)]"
              >
                <td className="py-2 px-2.5 text-[var(--bp-text-primary)] font-semibold">
                  {tier.label}
                </td>
                {/* Fast */}
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {tier.presetFast ? `${tier.presetFast.auctionDuration}s` : "\u2014"}
                </td>
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {truncateBigInt(tier.presetFast?.auctionStartAmount)}
                </td>
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {truncateBigInt(tier.presetFast?.auctionEndAmount)}
                </td>
                {/* Medium */}
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {tier.presetMedium ? `${tier.presetMedium.auctionDuration}s` : "\u2014"}
                </td>
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {truncateBigInt(tier.presetMedium?.auctionStartAmount)}
                </td>
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {truncateBigInt(tier.presetMedium?.auctionEndAmount)}
                </td>
                {/* Slow */}
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {tier.presetSlow ? `${tier.presetSlow.auctionDuration}s` : "\u2014"}
                </td>
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {truncateBigInt(tier.presetSlow?.auctionStartAmount)}
                </td>
                <td className="py-2 px-2 text-[var(--bp-text-muted)]">
                  {truncateBigInt(tier.presetSlow?.auctionEndAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Price Impact Chart ─────────────────────────────────────────────────────

function impactBarColor(bps: number): string {
  if (bps < 10) return "#22c55e";
  if (bps < 50) return "#f59e0b";
  return "#ef4444";
}

function OneInchPriceImpactChart({
  forwardTiers,
  reverseTiers,
}: {
  forwardTiers: OneInchTierRow[];
  reverseTiers: OneInchTierRow[];
}) {
  const tiers = forwardTiers.length > 0 ? forwardTiers : reverseTiers;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
  const margin = { top: 16, right: 16, bottom: 40, left: 56 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: tiers.map((t) => t.label),
        range: [0, innerW],
        padding: 0.35,
      }),
    [tiers, innerW]
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const t of tiers) {
      if (t.priceImpactBps > max) max = t.priceImpactBps;
    }
    return max * 1.2 || 1;
  }, [tiers]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Price Impact vs. Trade Size</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div ref={containerRef} className="w-full h-[320px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={5}
                />

                {tiers.map((tier, i) => {
                  const x = xScale(tier.label) ?? 0;
                  const barWidth = xScale.bandwidth();
                  const barHeight = innerH - yScale(tier.priceImpactBps);
                  const y = yScale(tier.priceImpactBps);
                  const step = xScale.step();
                  const hitX = x - (step - barWidth) / 2;
                  return (
                    <g key={tier.label}>
                      <rect
                        x={hitX}
                        y={0}
                        width={step}
                        height={innerH}
                        fill={hoverIdx === i ? "var(--bp-accent-primary)" : "transparent"}
                        opacity={hoverIdx === i ? 0.06 : 0}
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx(null)}
                      />
                      <Bar
                        x={x}
                        y={y}
                        width={barWidth}
                        height={Math.max(0, barHeight)}
                        fill={impactBarColor(tier.priceImpactBps)}
                        opacity={hoverIdx === i ? 1 : 0.85}
                        rx={4}
                        style={{ pointerEvents: "none" }}
                      />
                      {hoverIdx === i && (
                        <text
                          x={x + barWidth / 2}
                          y={y - 6}
                          textAnchor="middle"
                          fill="var(--bp-text-primary)"
                          fontSize={11}
                          fontWeight={600}
                          fontFamily="inherit"
                          style={{ pointerEvents: "none" }}
                        >
                          {tier.priceImpactBps.toFixed(2)} bps
                        </text>
                      )}
                    </g>
                  );
                })}

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 11,
                    fontFamily: "inherit",
                    textAnchor: "middle",
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  stroke="transparent"
                  tickStroke="transparent"
                  numTicks={5}
                  tickFormat={(v) => `${Number(v).toFixed(1)} bps`}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "end",
                    dx: -4,
                  }}
                />
              </Group>
            </svg>
          )}

          {hoverIdx !== null && tiers[hoverIdx] && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left:
                  margin.left +
                  (xScale(tiers[hoverIdx].label) ?? 0) +
                  xScale.bandwidth() / 2,
                top: margin.top + yScale(tiers[hoverIdx].priceImpactBps) - 8,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold">
                {tiers[hoverIdx].priceImpactBps.toFixed(3)} bps
              </div>
              <div className="text-[var(--bp-text-muted)]">
                {tiers[hoverIdx].label} — whitelist: {tiers[hoverIdx].whitelistCount}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4 justify-center mt-2">
          <span className="text-[10px] text-emerald-500 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
            &lt; 10 bps
          </span>
          <span className="text-[10px] text-amber-500 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-500" />
            10-50 bps
          </span>
          <span className="text-[10px] text-red-500 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-red-500" />
            &gt; 50 bps
          </span>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Alerts Section ──────────────────────────────────────────────────────────

interface OneInchAlert {
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
}

function OneInchAlertsSection({
  forwardTiers,
  reverseTiers,
}: {
  forwardTiers: OneInchTierRow[];
  reverseTiers: OneInchTierRow[];
}) {
  const alerts = useMemo<OneInchAlert[]>(() => {
    const result: OneInchAlert[] = [];

    // Check bid-ask spread
    const fwdMap = new Map(forwardTiers.map((t) => [t.notionalUsd, t]));
    const revMap = new Map(reverseTiers.map((t) => [t.notionalUsd, t]));
    const allSizes = Array.from(new Set([...fwdMap.keys(), ...revMap.keys()]));

    for (const size of allSizes) {
      const fwd = fwdMap.get(size);
      const rev = revMap.get(size);
      if (fwd && rev && fwd.impliedTokenPrice > 0 && rev.impliedTokenPrice > 0) {
        const mid = (fwd.impliedTokenPrice + rev.impliedTokenPrice) / 2;
        const spreadBps =
          mid > 0
            ? ((fwd.impliedTokenPrice - rev.impliedTokenPrice) / mid) * 10000
            : 0;
        if (spreadBps > 200) {
          result.push({
            severity: "warning",
            title: `Wide spread at ${fwd.label}`,
            detail: `Bid-ask spread is ${spreadBps.toFixed(0)} bps — above 200 bps threshold`,
          });
        }
      }
    }

    // Check for high price impact
    const allTiers = [...forwardTiers, ...reverseTiers];
    for (const tier of allTiers) {
      if (tier.priceImpactBps > 100) {
        result.push({
          severity: "error",
          title: `High impact at ${tier.label} (${tier.direction})`,
          detail: `${tier.priceImpactBps.toFixed(1)} bps price impact detected`,
        });
      }
    }

    // Missing direction data
    if (forwardTiers.length === 0) {
      result.push({
        severity: "warning",
        title: "No buy-side quotes",
        detail: "Forward (buy token) direction has no data",
      });
    }
    if (reverseTiers.length === 0) {
      result.push({
        severity: "warning",
        title: "No sell-side quotes",
        detail: "Reverse (sell token) direction has no data",
      });
    }

    if (result.length === 0) {
      result.push({
        severity: "info",
        title: "All clear",
        detail: "No alerts triggered — quotes look healthy",
      });
    }

    return result;
  }, [forwardTiers, reverseTiers]);

  const severityIcon = (s: OneInchAlert["severity"]) => {
    if (s === "error") return "!";
    if (s === "warning") return "!";
    return "i";
  };

  const severityColor = (s: OneInchAlert["severity"]) => {
    if (s === "error") return "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800";
    if (s === "warning") return "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800";
    return "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800";
  };

  const iconBg = (s: OneInchAlert["severity"]) => {
    if (s === "error") return "bg-red-100 dark:bg-red-900/30 text-red-500";
    if (s === "warning") return "bg-amber-100 dark:bg-amber-900/30 text-amber-500";
    return "bg-blue-100 dark:bg-blue-900/30 text-blue-500";
  };

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Alerts</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div className="flex flex-col gap-2">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border",
                severityColor(alert.severity)
              )}
            >
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  iconBg(alert.severity)
                )}
              >
                {severityIcon(alert.severity)}
              </div>
              <div>
                <div className="text-[12px] font-semibold">{alert.title}</div>
                <div className="text-[11px] opacity-80 mt-0.5">
                  {alert.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Historical Section ─────────────────────────────────────────────────────

const BAND_COLORS = [
  { fill: "#22c55e", stroke: "#22c55e", opacity: 0.25 },
  { fill: "#3b82f6", stroke: "#3b82f6", opacity: 0.18 },
  { fill: "#8b5cf6", stroke: "#8b5cf6", opacity: 0.14 },
  { fill: "#f59e0b", stroke: "#f59e0b", opacity: 0.10 },
  { fill: "#ef4444", stroke: "#ef4444", opacity: 0.08 },
  { fill: "#ec4899", stroke: "#ec4899", opacity: 0.06 },
  { fill: "#6366f1", stroke: "#6366f1", opacity: 0.05 },
];

const formatTime = (d: Date): string =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const formatAxisTick = (d: Date, spanMs: number): string => {
  if (spanMs > 24 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  }
  return formatTime(d);
};

const formatDateTime = (d: Date): string =>
  d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

function OneInchHistoricalSection({ asset }: { asset: string }) {
  const { points, notionalTiers, uptime, isLoading, isError } =
    useOneInchRfqHistory(asset);

  if (isLoading) {
    return <ChartCardSkeleton />;
  }

  if (isError || points.length < 2) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Historical Quoting Activity</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="w-full h-[200px] flex items-center justify-center">
            <p className="text-[11px] text-[var(--bp-text-muted)]">
              {isError
                ? "Failed to load historical data"
                : "Not enough historical data yet"}
            </p>
          </div>
        </ChartContent>
      </ChartCard>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <OneInchPriceBandsChart points={points} notionalTiers={notionalTiers} asset={asset} />
      <OneInchQuoteActivityTimeline points={points} uptime={uptime} />
    </div>
  );
}

// ─── Uptime Summary Cards ───────────────────────────────────────────────────

function OneInchUptimeCards({ uptime }: { uptime: OneInchUptimeStats }) {
  const timeRange =
    uptime.from && uptime.to
      ? `${formatDateTime(uptime.from)} — ${formatDateTime(uptime.to)}`
      : "\u2014";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard>
        <MetricLabel>Quoting Uptime</MetricLabel>
        <MetricValue>
          <span
            className={cn(
              uptime.uptimePct >= 90
                ? "text-green-500"
                : uptime.uptimePct >= 70
                  ? "text-amber-500"
                  : "text-red-500"
            )}
          >
            {uptime.uptimePct.toFixed(1)}%
          </span>
        </MetricValue>
      </MetricCard>
      <MetricCard>
        <MetricLabel>Total Captures</MetricLabel>
        <MetricValue>{uptime.totalCaptures.toLocaleString()}</MetricValue>
      </MetricCard>
      <MetricCard>
        <MetricLabel>Longest Gap</MetricLabel>
        <MetricValue>
          {uptime.longestGapMs > 0
            ? formatDuration(uptime.longestGapMs)
            : "\u2014"}
        </MetricValue>
        {uptime.longestGapStart && (
          <MetricUnit>{formatDateTime(uptime.longestGapStart)}</MetricUnit>
        )}
      </MetricCard>
      <MetricCard>
        <MetricLabel>Time Range</MetricLabel>
        <MetricValue className="!text-[11px]">{timeRange}</MetricValue>
      </MetricCard>
    </div>
  );
}

// ─── Historical Price Bands Chart ───────────────────────────────────────────

function OneInchPriceBandsChart({
  points,
  notionalTiers,
  asset,
}: {
  points: OneInchHistoryPoint[];
  notionalTiers: number[];
  asset: string;
}) {
  const [showPoolPrice, setShowPoolPrice] = useState(false);
  const [showKrakenXusd, setShowKrakenXusd] = useState(false);
  const [showKrakenSpv, setShowKrakenSpv] = useState(false);
  const [showFinnhub, setShowFinnhub] = useState(false);
  const [enabledEvents, setEnabledEvents] = useState<Set<string>>(new Set());
  const [eventsDropdownOpen, setEventsDropdownOpen] = useState(false);
  const eventsButtonRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; dataIndex: number } | null>(null);
  const [zoomRange, setZoomRange] = useState<{ isSelecting: boolean; startIndex: number | null; endIndex: number | null }>({ isSelecting: false, startIndex: null, endIndex: null });
  const [activeZoom, setActiveZoom] = useState<{ startIndex: number; endIndex: number } | null>(null);

  const poolInfo = useMemo(() => findPoolForAsset(asset), [asset]);

  const timeRangeDays = useMemo(() => {
    if (points.length < 2) return 7;
    const ms =
      points[points.length - 1].timestamp.getTime() -
      points[0].timestamp.getTime();
    return Math.max(1, Math.ceil(ms / 86_400_000));
  }, [points]);

  const { data: candles } = usePoolCandles({
    poolAddress: poolInfo?.poolKey ?? "",
    interval: "5m",
    days: timeRangeDays + 1,
    token0Decimals: poolInfo?.token0Decimals ?? 8,
    token1Decimals: poolInfo?.token1Decimals ?? 6,
    enabled: showPoolPrice && !!poolInfo,
  });

  const oracleLine = useMemo(() => {
    if (!showPoolPrice || !candles || candles.length === 0 || points.length < 2)
      return [];
    const startTs = points[0].timestamp.getTime();
    const endTs = points[points.length - 1].timestamp.getTime();
    return candles
      .filter((c) => {
        const t = c.timestamp.getTime();
        return t >= startTs && t <= endTs && c.close > 0;
      })
      .map((c) => ({ timestamp: c.timestamp, price: c.close }));
  }, [showPoolPrice, candles, points]);

  const krakenXusdPair = useMemo(() => `${asset}USD`, [asset]);
  const krakenSpvPair = useMemo(() => {
    const base = asset.endsWith("x") ? asset.slice(0, -1) : asset;
    return `${base}SPVUSD`;
  }, [asset]);

  const krakenSince = useMemo(() => {
    if (points.length < 2) return 0;
    return Math.floor(points[0].timestamp.getTime() / 1000);
  }, [points]);

  const krakenEndTime = useMemo(() => {
    if (points.length < 2) return 0;
    return Math.ceil(points[points.length - 1].timestamp.getTime() / 1000);
  }, [points]);

  const { data: krakenXusdCandles } = useQuery({
    queryKey: ["krakenOhlc", krakenXusdPair, 5, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        pair: krakenXusdPair,
        interval: "5",
        since: String(krakenSince),
        endTime: String(krakenEndTime),
      });
      const res = await fetch(`/api/kraken-ohlc?${params}`);
      if (!res.ok) throw new Error(`Kraken API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showKrakenXusd && krakenSince > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: krakenSpvCandles } = useQuery({
    queryKey: ["krakenOhlc", krakenSpvPair, 5, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        pair: krakenSpvPair,
        interval: "5",
        since: String(krakenSince),
        endTime: String(krakenEndTime),
      });
      const res = await fetch(`/api/kraken-ohlc?${params}`);
      if (!res.ok) throw new Error(`Kraken API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showKrakenSpv && krakenSince > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const krakenXusdLine = useMemo(() => {
    if (!showKrakenXusd || !krakenXusdCandles || krakenXusdCandles.length === 0 || points.length < 2)
      return [];
    const startTs = points[0].timestamp.getTime();
    const endTs = points[points.length - 1].timestamp.getTime();
    return krakenXusdCandles
      .filter((c) => {
        const t = c.timestamp * 1000;
        return t >= startTs && t <= endTs && c.close > 0;
      })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  }, [showKrakenXusd, krakenXusdCandles, points]);

  const krakenSpvLine = useMemo(() => {
    if (!showKrakenSpv || !krakenSpvCandles || krakenSpvCandles.length === 0 || points.length < 2)
      return [];
    const startTs = points[0].timestamp.getTime();
    const endTs = points[points.length - 1].timestamp.getTime();
    return krakenSpvCandles
      .filter((c) => {
        const t = c.timestamp * 1000;
        return t >= startTs && t <= endTs && c.close > 0;
      })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  }, [showKrakenSpv, krakenSpvCandles, points]);

  const finnhubSymbol = useMemo(() => {
    return asset.endsWith("x") ? asset.slice(0, -1) : asset;
  }, [asset]);

  const { data: finnhubCandles } = useQuery({
    queryKey: ["finnhubCandles", finnhubSymbol, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol: finnhubSymbol,
        resolution: "5",
        from: String(krakenSince),
        to: String(krakenEndTime),
      });
      const res = await fetch(`/api/finnhub-candles?${params}`);
      if (!res.ok) throw new Error(`Finnhub API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showFinnhub && krakenSince > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const finnhubLine = useMemo(() => {
    if (!showFinnhub || !finnhubCandles || finnhubCandles.length === 0 || points.length < 2)
      return [];
    const startTs = points[0].timestamp.getTime();
    const endTs = points[points.length - 1].timestamp.getTime();
    return finnhubCandles
      .filter((c) => {
        const t = c.timestamp * 1000;
        return t >= startTs && t <= endTs && c.close > 0;
      })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  }, [showFinnhub, finnhubCandles, points]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
  const margin = { top: 16, right: 16, bottom: 40, left: 72 };
  const spreadChartH = 100;
  const spreadGap = 24;
  const innerW = Math.max(0, width - margin.left - margin.right);
  const mainChartH = Math.max(0, height - margin.top - margin.bottom - spreadChartH - spreadGap);
  const innerH = mainChartH;
  const spreadTop = margin.top + mainChartH + spreadGap;

  const spanMs =
    points.length > 1
      ? points[points.length - 1].timestamp.getTime() - points[0].timestamp.getTime()
      : 0;

  const visiblePoints = useMemo(() => {
    if (!activeZoom || points.length === 0) return points;
    const si = Math.max(0, Math.min(activeZoom.startIndex, activeZoom.endIndex));
    const ei = Math.min(points.length - 1, Math.max(activeZoom.startIndex, activeZoom.endIndex));
    return points.slice(si, ei + 1);
  }, [activeZoom, points]);

  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain:
          visiblePoints.length > 1
            ? [visiblePoints[0].timestamp, visiblePoints[visiblePoints.length - 1].timestamp]
            : [new Date(), new Date()],
        range: [0, innerW],
      }),
    [visiblePoints, innerW]
  );

  const NYSE_EVENTS = [
    { label: "Early Pre-Mkt", hour: 4, minute: 0, color: "#818cf8" },
    { label: "Pre-Market", hour: 7, minute: 0, color: "#c084fc" },
    { label: "NYSE Open", hour: 9, minute: 30, color: "#4ade80" },
    { label: "NYSE Close", hour: 16, minute: 0, color: "#f87171" },
    { label: "After-Hrs Close", hour: 20, minute: 0, color: "#fbbf24" },
  ];

  const eventLines = useMemo(() => {
    if (enabledEvents.size === 0 || visiblePoints.length < 2) return [];
    const startMs = visiblePoints[0].timestamp.getTime();
    const endMs = visiblePoints[visiblePoints.length - 1].timestamp.getTime();
    if (startMs >= endMs) return [];
    const lines: { x: number; label: string; color: string }[] = [];
    const activeEvts = NYSE_EVENTS.filter(e => enabledEvents.has(e.label));
    if (activeEvts.length === 0) return [];
    const etFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const dd = new Date(startMs); dd.setDate(dd.getDate() - 1); dd.setHours(0, 0, 0, 0);
    const endDate = new Date(endMs); endDate.setDate(endDate.getDate() + 1);
    while (dd <= endDate) {
      const dow = dd.getDay();
      if (dow !== 0 && dow !== 6) {
        for (const evt of activeEvts) {
          const guess = new Date(Date.UTC(dd.getFullYear(), dd.getMonth(), dd.getDate(), evt.hour, evt.minute, 0));
          const parts = etFormatter.formatToParts(guess);
          const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? "0");
          const etHour = getPart("hour"); const etMinute = getPart("minute"); const etDay = getPart("day");
          const diffMinutes = (evt.hour * 60 + evt.minute) - (etHour * 60 + etMinute) + (dd.getDate() - etDay) * 1440;
          const evtDate = new Date(guess.getTime() + diffMinutes * 60_000);
          const ts = evtDate.getTime();
          if (ts >= startMs && ts <= endMs) { lines.push({ x: xScale(evtDate) ?? 0, label: evt.label, color: evt.color }); }
        }
      }
      dd.setDate(dd.getDate() + 1);
    }
    return lines;
  }, [enabledEvents, visiblePoints, xScale]);

  const yDomain = useMemo(() => {
    if (visiblePoints.length === 0) return [0, 1] as [number, number];
    let min = Infinity;
    let max = -Infinity;
    for (const pt of visiblePoints) {
      if (pt.midPrice < min) min = pt.midPrice;
      if (pt.midPrice > max) max = pt.midPrice;
      for (const [, tier] of pt.tiers) {
        if (tier.bidPrice > 0 && tier.bidPrice < min) min = tier.bidPrice;
        if (tier.bidPrice > 0 && tier.bidPrice > max) max = tier.bidPrice;
        if (tier.askPrice > 0 && tier.askPrice < min) min = tier.askPrice;
        if (tier.askPrice > 0 && tier.askPrice > max) max = tier.askPrice;
      }
    }
    for (const p of oracleLine) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    for (const p of krakenXusdLine) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    for (const p of krakenSpvLine) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    for (const p of finnhubLine) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    const pad = (max - min) * 0.1 || 1;
    return [min - pad, max + pad] as [number, number];
  }, [visiblePoints, oracleLine, krakenXusdLine, krakenSpvLine, finnhubLine]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: yDomain,
        range: [innerH, 0],
        nice: true,
      }),
    [yDomain, innerH]
  );

  const bandPaths = useMemo(() => {
    if (visiblePoints.length < 2 || notionalTiers.length === 0) return [];
    const reversedTiers = [...notionalTiers].reverse();

    return reversedTiers.map((notional, colorIdx) => {
      const color =
        BAND_COLORS[
          (notionalTiers.length - 1 - colorIdx) % BAND_COLORS.length
        ];

      const validPts: {
        x: number;
        buyY: number;
        askY: number;
        midY: number;
      }[] = [];

      for (const pt of visiblePoints) {
        const tierData = pt.tiers.get(notional);
        const bidPrice =
          tierData && tierData.bidPrice > 0 ? tierData.bidPrice : pt.midPrice;
        const askPrice =
          tierData && tierData.askPrice > 0 ? tierData.askPrice : pt.midPrice;
        validPts.push({
          x: xScale(pt.timestamp) ?? 0,
          buyY: yScale(bidPrice),
          askY: yScale(askPrice),
          midY: yScale(pt.midPrice),
        });
      }

      if (validPts.length < 2) return null;

      let buyPath = `M ${validPts[0].x} ${validPts[0].midY}`;
      for (const p of validPts) buyPath += ` L ${p.x} ${p.midY}`;
      for (let i = validPts.length - 1; i >= 0; i--)
        buyPath += ` L ${validPts[i].x} ${validPts[i].buyY}`;
      buyPath += " Z";

      let sellPath = `M ${validPts[0].x} ${validPts[0].askY}`;
      for (const p of validPts) sellPath += ` L ${p.x} ${p.askY}`;
      for (let i = validPts.length - 1; i >= 0; i--)
        sellPath += ` L ${validPts[i].x} ${validPts[i].midY}`;
      sellPath += " Z";

      return { notional, buyPath, sellPath, color };
    });
  }, [visiblePoints, notionalTiers, xScale, yScale]);

  const hoverData = useMemo(() => {
    if (hoverIdx === null || !visiblePoints[hoverIdx]) return null;
    const pt = visiblePoints[hoverIdx];
    const t = pt.timestamp.getTime();

    const findNearest = (line: { timestamp: Date; price: number }[]) => {
      let best: number | null = null;
      let bestDist = Infinity;
      for (const p of line) {
        const d = Math.abs(p.timestamp.getTime() - t);
        if (d < bestDist) { bestDist = d; best = p.price; }
      }
      return best;
    };

    return {
      x: xScale(pt.timestamp) ?? 0,
      midY: yScale(pt.midPrice),
      point: pt,
      poolPrice: showPoolPrice && oracleLine.length > 0 ? findNearest(oracleLine) : null,
      krakenXusdPrice: showKrakenXusd && krakenXusdLine.length > 0 ? findNearest(krakenXusdLine) : null,
      krakenSpvPrice: showKrakenSpv && krakenSpvLine.length > 0 ? findNearest(krakenSpvLine) : null,
      finnhubPrice: showFinnhub && finnhubLine.length > 0 ? findNearest(finnhubLine) : null,
    };
  }, [hoverIdx, visiblePoints, xScale, yScale, showPoolPrice, oracleLine, showKrakenXusd, krakenXusdLine, showKrakenSpv, krakenSpvLine, showFinnhub, finnhubLine]);

  // Spread sub-chart data
  const findNearestPrice = (line: { timestamp: Date; price: number }[], t: number) => {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const p of line) {
      const d = Math.abs(p.timestamp.getTime() - t);
      if (d < bestDist) { bestDist = d; best = p.price; }
    }
    return best;
  };

  const spreadReferenceTier = notionalTiers.length > 0 ? notionalTiers[Math.min(1, notionalTiers.length - 1)] : 10000;

  const spreadXusdData = useMemo(() => {
    if (!showKrakenXusd || krakenXusdLine.length === 0) return [];
    return visiblePoints
      .map((pt) => {
        const tier = pt.tiers.get(spreadReferenceTier);
        const buyPrice = tier?.bidPrice ?? 0;
        if (buyPrice <= 0) return null;
        const krakenPrice = findNearestPrice(krakenXusdLine, pt.timestamp.getTime());
        if (krakenPrice === null) return null;
        const bps = ((buyPrice - krakenPrice) / buyPrice) * 10000;
        return { timestamp: pt.timestamp, bps };
      })
      .filter((d): d is { timestamp: Date; bps: number } => d !== null);
  }, [visiblePoints, showKrakenXusd, krakenXusdLine, spreadReferenceTier]);

  const spreadSpvData = useMemo(() => {
    if (!showKrakenSpv || krakenSpvLine.length === 0) return [];
    return visiblePoints
      .map((pt) => {
        const tier = pt.tiers.get(spreadReferenceTier);
        const buyPrice = tier?.bidPrice ?? 0;
        if (buyPrice <= 0) return null;
        const krakenPrice = findNearestPrice(krakenSpvLine, pt.timestamp.getTime());
        if (krakenPrice === null) return null;
        const bps = ((buyPrice - krakenPrice) / buyPrice) * 10000;
        return { timestamp: pt.timestamp, bps };
      })
      .filter((d): d is { timestamp: Date; bps: number } => d !== null);
  }, [visiblePoints, showKrakenSpv, krakenSpvLine, spreadReferenceTier]);

  const spreadTradFiData = useMemo(() => {
    if (!showFinnhub || finnhubLine.length === 0) return [];
    return visiblePoints
      .map((pt) => {
        const tier = pt.tiers.get(spreadReferenceTier);
        const buyPrice = tier?.bidPrice ?? 0;
        if (buyPrice <= 0) return null;
        const tradFiPrice = findNearestPrice(finnhubLine, pt.timestamp.getTime());
        if (tradFiPrice === null) return null;
        const bps = ((buyPrice - tradFiPrice) / buyPrice) * 10000;
        return { timestamp: pt.timestamp, bps };
      })
      .filter((d): d is { timestamp: Date; bps: number } => d !== null);
  }, [visiblePoints, showFinnhub, finnhubLine, spreadReferenceTier]);

  const spreadYDomain = useMemo(() => {
    const allBps = [...spreadXusdData, ...spreadSpvData, ...spreadTradFiData].map((d) => d.bps);
    if (allBps.length === 0) return [-50, 50] as [number, number];
    let min = Math.min(...allBps);
    let max = Math.max(...allBps);
    const pad = Math.max((max - min) * 0.15, 5);
    return [min - pad, max + pad] as [number, number];
  }, [spreadXusdData, spreadSpvData, spreadTradFiData]);

  const spreadYScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: spreadYDomain,
        range: [spreadChartH, 0],
        nice: true,
      }),
    [spreadYDomain, spreadChartH]
  );

  const showSpreadChart = (showKrakenXusd && spreadXusdData.length > 1) || (showKrakenSpv && spreadSpvData.length > 1) || (showFinnhub && spreadTradFiData.length > 1);

  const [spreadHoverIdx, setSpreadHoverIdx] = useState<number | null>(null);
  const spreadHoverData = useMemo(() => {
    if (spreadHoverIdx === null || !visiblePoints[spreadHoverIdx]) return null;
    const pt = visiblePoints[spreadHoverIdx];
    const t = pt.timestamp.getTime();
    const tier = pt.tiers.get(spreadReferenceTier);
    const buyPrice = tier?.bidPrice ?? 0;

    let xusdBps: number | null = null;
    if (showKrakenXusd && krakenXusdLine.length > 0 && buyPrice > 0) {
      const kp = findNearestPrice(krakenXusdLine, t);
      if (kp !== null) xusdBps = ((buyPrice - kp) / buyPrice) * 10000;
    }

    let spvBps: number | null = null;
    if (showKrakenSpv && krakenSpvLine.length > 0 && buyPrice > 0) {
      const kp = findNearestPrice(krakenSpvLine, t);
      if (kp !== null) spvBps = ((buyPrice - kp) / buyPrice) * 10000;
    }

    let tradFiBps: number | null = null;
    if (showFinnhub && finnhubLine.length > 0 && buyPrice > 0) {
      const fp = findNearestPrice(finnhubLine, t);
      if (fp !== null) tradFiBps = ((buyPrice - fp) / buyPrice) * 10000;
    }

    return {
      x: xScale(pt.timestamp) ?? 0,
      timestamp: pt.timestamp,
      buyPrice,
      xusdBps,
      spvBps,
      tradFiBps,
    };
  }, [spreadHoverIdx, visiblePoints, xScale, showKrakenXusd, krakenXusdLine, showKrakenSpv, krakenSpvLine, showFinnhub, finnhubLine, spreadReferenceTier]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (hoverIdx === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setContextMenu({ visible: true, x: Math.min(x, width - 200), y: Math.min(y, height - 100), dataIndex: hoverIdx });
  }, [hoverIdx, width, height]);

  const handleStartRangeSelect = useCallback(() => {
    if (contextMenu === null) return;
    let fullIndex = contextMenu.dataIndex;
    if (activeZoom) { const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex); fullIndex = zoomStart + contextMenu.dataIndex; }
    setZoomRange({ isSelecting: true, startIndex: fullIndex, endIndex: null });
  }, [contextMenu, activeZoom]);

  const handleChartClick = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if (zoomRange.isSelecting && zoomRange.startIndex !== null && hoverIdx !== null) {
      let fullEndIndex = hoverIdx;
      if (activeZoom) { const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex); fullEndIndex = zoomStart + hoverIdx; }
      setActiveZoom({ startIndex: zoomRange.startIndex, endIndex: fullEndIndex });
      setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
    }
  }, [zoomRange, hoverIdx, activeZoom]);

  const handleResetZoom = useCallback(() => { setActiveZoom(null); setZoomRange({ isSelecting: false, startIndex: null, endIndex: null }); }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && zoomRange.isSelecting) setZoomRange({ isSelecting: false, startIndex: null, endIndex: null }); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [zoomRange.isSelecting]);

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Historical Price Bands</ChartTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">Pool</span>
            <button
              type="button"
              onClick={() => setShowPoolPrice((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showPoolPrice
                  ? "bg-sky-500 border-sky-500"
                  : "bg-gray-300 border-gray-300"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  showPoolPrice ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">Kraken xUSD</span>
            <button
              type="button"
              onClick={() => setShowKrakenXusd((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showKrakenXusd
                  ? "bg-cyan-500 border-cyan-500"
                  : "bg-gray-300 border-gray-300"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  showKrakenXusd ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">Kraken SPV</span>
            <button
              type="button"
              onClick={() => setShowKrakenSpv((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showKrakenSpv
                  ? "bg-violet-500 border-violet-500"
                  : "bg-gray-300 border-gray-300"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  showKrakenSpv ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">TradFi {finnhubSymbol}</span>
            <button
              type="button"
              onClick={() => setShowFinnhub((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showFinnhub
                  ? "bg-emerald-500 border-emerald-500"
                  : "bg-gray-300 border-gray-300"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                  showFinnhub ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <div className="relative flex items-center gap-1.5">
            <button ref={eventsButtonRef} type="button" onClick={() => setEventsDropdownOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${enabledEvents.size > 0 ? "border-rose-500/50 bg-rose-500/10 text-rose-400" : "border-[var(--bp-border-subtle)] text-[var(--bp-text-muted)] hover:border-[var(--bp-text-muted)]"}`}>
              Events{enabledEvents.size > 0 ? ` (${enabledEvents.size})` : ""}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${eventsDropdownOpen ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {eventsDropdownOpen && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setEventsDropdownOpen(false)} />
                <div className="fixed z-[9999] min-w-[200px] rounded-lg border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-primary)] shadow-xl py-1"
                  style={(() => { const rect = eventsButtonRef.current?.getBoundingClientRect(); if (!rect) return {}; return { top: rect.bottom + 4, right: window.innerWidth - rect.right }; })()}>
                  {NYSE_EVENTS.map((evt) => { const checked = enabledEvents.has(evt.label); return (
                    <button key={evt.label} type="button" onClick={() => { setEnabledEvents((prev) => { const next = new Set(prev); if (next.has(evt.label)) next.delete(evt.label); else next.add(evt.label); return next; }); }}
                      className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bp-bg-secondary)] transition-colors">
                      <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors ${checked ? "border-transparent" : "border-[var(--bp-border-subtle)]"}`} style={checked ? { backgroundColor: evt.color } : undefined}>
                        {checked && (<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>)}
                      </span>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: evt.color }} />
                      <span style={{ color: checked ? evt.color : "var(--bp-text-secondary)" }}>{evt.label}</span>
                      <span className="ml-auto text-[9px] text-[var(--bp-text-muted)]">{String(evt.hour).padStart(2, "0")}:{String(evt.minute).padStart(2, "0")} ET</span>
                    </button>); })}
                  <div className="border-t border-[var(--bp-border-subtle)] mt-1 pt-1 px-3 py-1 flex gap-2">
                    <button type="button" onClick={() => setEnabledEvents(new Set(NYSE_EVENTS.map(e => e.label)))} className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors">All</button>
                    <button type="button" onClick={() => setEnabledEvents(new Set())} className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors">None</button>
                  </div>
                </div>
              </>, document.body
            )}
          </div>
        </div>
      </ChartHeader>
      <ChartContent style={{ height: 660 }}>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Mid price over time with bid/ask spread bands per trade size — wider
          bands = more slippage at that size
        </p>
        <div ref={containerRef} className="w-full h-[560px] relative" style={{ cursor: zoomRange.isSelecting ? "crosshair" : undefined, pointerEvents: eventsDropdownOpen ? "none" : undefined }} onContextMenu={handleContextMenu} onClick={handleChartClick}>
          {zoomRange.isSelecting && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2" style={{ background: "#14b8a6", color: "#fff", boxShadow: "0 2px 8px rgba(20, 184, 166, 0.4)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              Click to select end of range (Esc to cancel)
            </div>
          )}
          {activeZoom && !zoomRange.isSelecting && (
            <button className="absolute top-2 right-4 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-105"
              style={{ background: "rgba(255,255,255,0.1)", color: "var(--bp-text-primary)", border: "1px solid var(--bp-border-subtle)" }}
              onClick={(e) => { e.stopPropagation(); handleResetZoom(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
              Reset Zoom
            </button>
          )}
          {zoomRange.isSelecting && zoomRange.startIndex !== null && hoverIdx !== null && (() => {
            let displayStartIndex = zoomRange.startIndex;
            if (activeZoom) { const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex); displayStartIndex = zoomRange.startIndex - zoomStart; }
            const startPt = visiblePoints[Math.max(0, Math.min(displayStartIndex, visiblePoints.length - 1))];
            const endPt = visiblePoints[Math.max(0, Math.min(hoverIdx, visiblePoints.length - 1))];
            if (!startPt || !endPt) return null;
            const startX = (xScale(startPt.timestamp) ?? 0) + margin.left; const endX = (xScale(endPt.timestamp) ?? 0) + margin.left;
            const left = Math.min(startX, endX); const selectionWidth = Math.abs(endX - startX);
            return (<div className="absolute pointer-events-none" style={{ left, top: margin.top, width: Math.max(2, selectionWidth), height: innerH, background: "rgba(20, 184, 166, 0.12)", borderLeft: "2px solid #14b8a6", borderRight: "2px solid #14b8a6" }} />);
          })()}
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={6}
                />

                {enabledEvents.size > 0 && eventLines.map((evt, i) => (
                  <g key={`evt-${i}`}>
                    <line x1={evt.x} x2={evt.x} y1={0} y2={innerH} stroke={evt.color} strokeWidth={1} strokeDasharray="4,4" opacity={0.5} />
                    <text x={evt.x + 4} y={12} fill={evt.color} fontSize={9} fontFamily="inherit" fontWeight={600} opacity={0.85}>{evt.label}</text>
                  </g>
                ))}

                {bandPaths.map(
                  (band) =>
                    band && (
                      <g key={band.notional}>
                        <path
                          d={band.buyPath}
                          fill={band.color.fill}
                          fillOpacity={band.color.opacity}
                          stroke={band.color.stroke}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                        <path
                          d={band.sellPath}
                          fill={band.color.fill}
                          fillOpacity={band.color.opacity}
                          stroke={band.color.stroke}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                      </g>
                    )
                )}

                <LinePath
                  data={visiblePoints}
                  x={(d) => xScale(d.timestamp) ?? 0}
                  y={(d) => yScale(d.midPrice)}
                  curve={curveMonotoneX}
                  stroke="var(--bp-text-primary)"
                  strokeWidth={1.5}
                />

                {showPoolPrice && oracleLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={oracleLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                  />
                )}

                {showKrakenXusd && krakenXusdLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={krakenXusdLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                )}

                {showKrakenSpv && krakenSpvLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={krakenSpvLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#8b5cf6"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                )}

                {showFinnhub && finnhubLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={finnhubLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#10b981"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                )}

                {visiblePoints.map((pt, i) => {
                  const x = xScale(pt.timestamp) ?? 0;
                  const step =
                    visiblePoints.length > 1
                      ? innerW / (visiblePoints.length - 1)
                      : innerW;
                  return (
                    <rect
                      key={i}
                      x={x - step / 2}
                      y={0}
                      width={step}
                      height={innerH}
                      fill="transparent"
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                    />
                  );
                })}

                {hoverData && (
                  <>
                    <line
                      x1={hoverData.x}
                      x2={hoverData.x}
                      y1={0}
                      y2={innerH}
                      stroke="var(--bp-text-muted)"
                      strokeWidth={1}
                      strokeDasharray="3,3"
                      opacity={0.5}
                      style={{ pointerEvents: "none" }}
                    />
                    <circle
                      cx={hoverData.x}
                      cy={hoverData.midY}
                      r={4}
                      fill="var(--bp-text-primary)"
                      stroke="var(--bp-bg-primary)"
                      strokeWidth={2}
                      style={{ pointerEvents: "none" }}
                    />
                  </>
                )}

                <AxisLeft
                  scale={yScale}
                  stroke="transparent"
                  tickStroke="transparent"
                  numTicks={6}
                  tickFormat={(v) => `$${Number(v).toFixed(2)}`}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "end",
                    dx: -4,
                  }}
                />
              </Group>

              {/* Spread sub-chart */}
              {showSpreadChart && (
                <Group left={margin.left} top={spreadTop}>
                  <line
                    x1={0}
                    x2={innerW}
                    y1={spreadYScale(0)}
                    y2={spreadYScale(0)}
                    stroke="var(--bp-text-muted)"
                    strokeWidth={0.5}
                    strokeDasharray="4,3"
                    opacity={0.5}
                  />
                  <GridRows
                    scale={spreadYScale}
                    width={innerW}
                    stroke="var(--bp-border-subtle)"
                    strokeDasharray="3,3"
                    strokeOpacity={0.4}
                    numTicks={4}
                  />

                  <defs>
                    <clipPath id="oneinch-spread-clip-pos">
                      <rect x={0} y={0} width={innerW} height={spreadYScale(0)} />
                    </clipPath>
                    <clipPath id="oneinch-spread-clip-neg">
                      <rect x={0} y={spreadYScale(0)} width={innerW} height={spreadChartH - spreadYScale(0)} />
                    </clipPath>
                  </defs>

                  {spreadXusdData.length > 1 && (
                    <>
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadXusdData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#06b6d4"
                        fillOpacity={0.2}
                        clipPath="url(#oneinch-spread-clip-pos)"
                      />
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadXusdData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        clipPath="url(#oneinch-spread-clip-neg)"
                      />
                      <LinePath<{ timestamp: Date; bps: number }>
                        data={spreadXusdData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        curve={curveStepAfter}
                        stroke="#06b6d4"
                        strokeWidth={1.5}
                      />
                    </>
                  )}

                  {spreadSpvData.length > 1 && (
                    <>
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadSpvData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#8b5cf6"
                        fillOpacity={0.2}
                        clipPath="url(#oneinch-spread-clip-pos)"
                      />
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadSpvData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        clipPath="url(#oneinch-spread-clip-neg)"
                      />
                      <LinePath<{ timestamp: Date; bps: number }>
                        data={spreadSpvData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        curve={curveStepAfter}
                        stroke="#8b5cf6"
                        strokeWidth={1.5}
                      />
                    </>
                  )}

                  {spreadTradFiData.length > 1 && (
                    <>
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadTradFiData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#10b981"
                        fillOpacity={0.2}
                        clipPath="url(#oneinch-spread-clip-pos)"
                      />
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadTradFiData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        clipPath="url(#oneinch-spread-clip-neg)"
                      />
                      <LinePath<{ timestamp: Date; bps: number }>
                        data={spreadTradFiData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        curve={curveStepAfter}
                        stroke="#10b981"
                        strokeWidth={1.5}
                      />
                    </>
                  )}

                  {visiblePoints.map((pt, i) => {
                    const x = xScale(pt.timestamp) ?? 0;
                    const step =
                      visiblePoints.length > 1
                        ? innerW / (visiblePoints.length - 1)
                        : innerW;
                    return (
                      <rect
                        key={i}
                        x={x - step / 2}
                        y={0}
                        width={step}
                        height={spreadChartH}
                        fill="transparent"
                        onMouseEnter={() => setSpreadHoverIdx(i)}
                        onMouseLeave={() => setSpreadHoverIdx(null)}
                      />
                    );
                  })}

                  {spreadHoverData && (
                    <>
                      <line
                        x1={spreadHoverData.x}
                        x2={spreadHoverData.x}
                        y1={0}
                        y2={spreadChartH}
                        stroke="var(--bp-text-muted)"
                        strokeWidth={1}
                        strokeDasharray="3,3"
                        opacity={0.5}
                        style={{ pointerEvents: "none" }}
                      />
                      {spreadHoverData.xusdBps !== null && (
                        <circle
                          cx={spreadHoverData.x}
                          cy={spreadYScale(spreadHoverData.xusdBps)}
                          r={3.5}
                          fill="#06b6d4"
                          stroke="var(--bp-bg-primary)"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {spreadHoverData.spvBps !== null && (
                        <circle
                          cx={spreadHoverData.x}
                          cy={spreadYScale(spreadHoverData.spvBps)}
                          r={3.5}
                          fill="#8b5cf6"
                          stroke="var(--bp-bg-primary)"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {spreadHoverData.tradFiBps !== null && (
                        <circle
                          cx={spreadHoverData.x}
                          cy={spreadYScale(spreadHoverData.tradFiBps)}
                          r={3.5}
                          fill="#10b981"
                          stroke="var(--bp-bg-primary)"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                    </>
                  )}

                  <AxisBottom
                    top={spreadChartH}
                    scale={xScale}
                    stroke="var(--bp-border-subtle)"
                    tickStroke="transparent"
                    numTicks={Math.min(8, Math.floor(innerW / 100))}
                    tickFormat={(v) => formatAxisTick(v as Date, spanMs)}
                    tickLabelProps={{
                      fill: "var(--bp-text-muted)",
                      fontSize: 10,
                      fontFamily: "inherit",
                      textAnchor: "middle",
                    }}
                  />
                  <AxisLeft
                    scale={spreadYScale}
                    stroke="transparent"
                    tickStroke="transparent"
                    numTicks={4}
                    tickFormat={(v) => `${Number(v).toFixed(0)} bps`}
                    tickLabelProps={{
                      fill: "var(--bp-text-muted)",
                      fontSize: 9,
                      fontFamily: "inherit",
                      textAnchor: "end",
                      dx: -4,
                    }}
                  />

                  <text
                    x={4}
                    y={-6}
                    fill="var(--bp-text-muted)"
                    fontSize={10}
                    fontFamily="inherit"
                  >
                    ${formatCompact(spreadReferenceTier)} Buy Deviation (bps)
                  </text>
                </Group>
              )}

              {!showSpreadChart && (
                <Group left={margin.left} top={margin.top}>
                  <AxisBottom
                    top={innerH}
                    scale={xScale}
                    stroke="var(--bp-border-subtle)"
                    tickStroke="transparent"
                    numTicks={Math.min(8, Math.floor(innerW / 100))}
                    tickFormat={(v) => formatAxisTick(v as Date, spanMs)}
                    tickLabelProps={{
                      fill: "var(--bp-text-muted)",
                      fontSize: 10,
                      fontFamily: "inherit",
                      textAnchor: "middle",
                    }}
                  />
                </Group>
              )}
            </svg>
          )}

          {hoverData && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left: Math.min(margin.left + hoverData.x, width - 220),
                top: margin.top + 8,
                transform: "translateX(-50%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold mb-1">
                {formatDateTime(hoverData.point.timestamp)} — Mid $
                {hoverData.point.midPrice.toFixed(4)}
                {hoverData.poolPrice !== null && (
                  <span className="text-[#f97316] ml-2">
                    Pool ${hoverData.poolPrice.toFixed(4)}
                  </span>
                )}
                {hoverData.krakenXusdPrice !== null && (
                  <span className="text-[#06b6d4] ml-2">
                    xUSD ${hoverData.krakenXusdPrice.toFixed(4)}
                  </span>
                )}
                {hoverData.krakenSpvPrice !== null && (
                  <span className="text-[#8b5cf6] ml-2">
                    SPV ${hoverData.krakenSpvPrice.toFixed(4)}
                  </span>
                )}
                {hoverData.finnhubPrice !== null && (
                  <span className="text-[#10b981] ml-2">
                    TradFi ${hoverData.finnhubPrice.toFixed(4)}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {notionalTiers.map((notional, i) => {
                  const tier = hoverData.point.tiers.get(notional);
                  const mid = hoverData.point.midPrice;
                  const bidPrice = tier?.bidPrice || mid;
                  const askPrice = tier?.askPrice || mid;
                  const color = BAND_COLORS[i % BAND_COLORS.length];
                  const spread = bidPrice - askPrice;
                  const spreadBps = (spread / mid) * 10000;
                  return (
                    <div key={notional} className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-sm"
                        style={{ backgroundColor: color.fill }}
                      />
                      <span className="text-[var(--bp-text-muted)]">
                        {formatCompact(notional)}:
                      </span>
                      <span className="text-[var(--bp-text-secondary)]">
                        ${askPrice.toFixed(4)} — ${bidPrice.toFixed(4)}
                      </span>
                      <span className="text-[var(--bp-text-muted)]">
                        ({spreadBps.toFixed(1)} bps)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {spreadHoverData && showSpreadChart && (spreadHoverData.xusdBps !== null || spreadHoverData.spvBps !== null || spreadHoverData.tradFiBps !== null) && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left: Math.min(margin.left + spreadHoverData.x, width - 200),
                top: spreadTop - 8,
                transform: "translateX(-50%) translateY(-100%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold mb-0.5">
                {formatDateTime(spreadHoverData.timestamp)}
              </div>
              <div className="text-[var(--bp-text-muted)] mb-0.5">
                {formatCompact(spreadReferenceTier)} Buy: ${spreadHoverData.buyPrice.toFixed(4)}
              </div>
              {spreadHoverData.xusdBps !== null && (
                <div className="text-[#06b6d4]">
                  xUSD Deviation: {spreadHoverData.xusdBps.toFixed(1)} bps
                </div>
              )}
              {spreadHoverData.spvBps !== null && (
                <div className="text-[#8b5cf6]">
                  SPV Deviation: {spreadHoverData.spvBps.toFixed(1)} bps
                </div>
              )}
              {spreadHoverData.tradFiBps !== null && (
                <div className="text-[#10b981]">
                  TradFi Deviation: {spreadHoverData.tradFiBps.toFixed(1)} bps
                </div>
              )}
            </div>
          )}
          {contextMenu?.visible && (
            <div className="absolute z-50 min-w-[180px] rounded-lg border border-[var(--bp-border-subtle)] shadow-lg backdrop-blur-sm overflow-hidden"
              style={{ left: contextMenu.x, top: contextMenu.y, background: "rgba(15, 23, 42, 0.95)" }}>
              <button className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2 text-[var(--bp-text-primary)] hover:bg-white/5"
                onClick={() => { handleStartRangeSelect(); setContextMenu(null); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                Zoom to Range
              </button>
              {activeZoom && (<><div className="h-px bg-[var(--bp-border-subtle)]" />
                <button className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2 text-[var(--bp-text-primary)] hover:bg-white/5"
                  onClick={() => { handleResetZoom(); setContextMenu(null); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                  Reset Zoom
                </button></>)}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 justify-center mt-2">
          <span className="text-[10px] text-[var(--bp-text-primary)] flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-[var(--bp-text-primary)] rounded" />
            Mid Price
          </span>
          {showPoolPrice && (
            <span className="text-[10px] text-[#f97316] flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px] rounded"
                style={{
                  background:
                    "repeating-linear-gradient(to right, #f97316 0, #f97316 4px, transparent 4px, transparent 7px)",
                }}
              />
              Pool Price
            </span>
          )}
          {showKrakenXusd && (
            <span className="text-[10px] text-[#06b6d4] flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px] rounded"
                style={{
                  background:
                    "repeating-linear-gradient(to right, #06b6d4 0, #06b6d4 6px, transparent 6px, transparent 9px)",
                }}
              />
              Kraken xUSD
            </span>
          )}
          {showKrakenSpv && (
            <span className="text-[10px] text-[#8b5cf6] flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px] rounded"
                style={{
                  background:
                    "repeating-linear-gradient(to right, #8b5cf6 0, #8b5cf6 6px, transparent 6px, transparent 9px)",
                }}
              />
              Kraken SPV
            </span>
          )}
          {notionalTiers.map((notional, i) => {
            const color = BAND_COLORS[i % BAND_COLORS.length];
            return (
              <span
                key={notional}
                className="text-[10px] flex items-center gap-1.5"
                style={{ color: color.fill }}
              >
                <span
                  className="inline-block w-3 h-2 rounded-sm"
                  style={{ backgroundColor: color.fill, opacity: 0.4 }}
                />
                {formatCompact(notional)}
              </span>
            );
          })}
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Quote Activity Timeline ────────────────────────────────────────────────

function OneInchQuoteActivityTimeline({
  points,
  uptime,
}: {
  points: OneInchHistoryPoint[];
  uptime: OneInchUptimeStats;
}) {
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
  const margin = { top: 8, right: 16, bottom: 32, left: 72 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);
  const barH = Math.min(innerH, 32);
  const barY = (innerH - barH) / 2;

  const spanMs =
    points.length > 1
      ? points[points.length - 1].timestamp.getTime() - points[0].timestamp.getTime()
      : 0;

  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain:
          points.length > 1
            ? [points[0].timestamp, points[points.length - 1].timestamp]
            : [new Date(), new Date()],
        range: [0, innerW],
      }),
    [points, innerW]
  );

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Quote Activity Timeline</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Each tick = one capture snapshot. Red zones = gaps where no quotes were
          received ({">"}{formatDuration(uptime.expectedIntervalMs * 2)} between captures).
        </p>
        <div ref={containerRef} className="w-full h-[100px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <rect
                  x={0}
                  y={barY}
                  width={innerW}
                  height={barH}
                  rx={4}
                  fill="var(--bp-bg-secondary)"
                  opacity={0.5}
                />

                {uptime.gaps.map((gap, i) => {
                  const x1 = xScale(gap.start) ?? 0;
                  const x2 = xScale(gap.end) ?? 0;
                  return (
                    <g key={i}>
                      <rect
                        x={x1}
                        y={barY}
                        width={Math.max(x2 - x1, 2)}
                        height={barH}
                        rx={2}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        stroke="#ef4444"
                        strokeOpacity={0.4}
                        strokeWidth={0.5}
                      />
                      {x2 - x1 > 40 && (
                        <text
                          x={(x1 + x2) / 2}
                          y={barY + barH / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#ef4444"
                          fontSize={9}
                          fontFamily="inherit"
                          opacity={0.8}
                        >
                          {formatDuration(gap.durationMs)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {points.map((pt, i) => {
                  const x = xScale(pt.timestamp) ?? 0;
                  return (
                    <line
                      key={i}
                      x1={x}
                      x2={x}
                      y1={barY + 2}
                      y2={barY + barH - 2}
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      strokeOpacity={0.6}
                      strokeLinecap="round"
                    />
                  );
                })}

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  numTicks={Math.min(8, Math.floor(innerW / 100))}
                  tickFormat={(v) => formatAxisTick(v as Date, spanMs)}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "middle",
                  }}
                />
              </Group>
            </svg>
          )}
        </div>

        {uptime.gaps.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-[var(--bp-text-muted)] mb-1 font-semibold uppercase tracking-wide">
              Detected Gaps ({uptime.gaps.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {uptime.gaps.map((gap, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[11px] font-mono px-2 py-1 rounded bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30"
                >
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <span className="text-[var(--bp-text-secondary)]">
                    {formatDateTime(gap.start)} — {formatDateTime(gap.end)}
                  </span>
                  <span className="text-red-500 font-semibold ml-auto">
                    {formatDuration(gap.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ChartContent>
    </ChartCard>
  );
}
