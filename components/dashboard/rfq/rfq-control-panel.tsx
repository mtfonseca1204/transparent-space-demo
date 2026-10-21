"use client";

import React, { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  useCowswapRfqData,
  type CowswapTierRow,
} from "@/hooks/use-cowswap-rfq-data";
import {
  useBebopRfqData,
  type BebopTierRow,
} from "@/hooks/use-bebop-rfq-data";
import {
  useZeroXRfqData,
  type ZeroXTierRow,
} from "@/hooks/use-0x-rfq-data";
import {
  useCowswapRfqHistory,
  type CowswapHistoryPoint,
} from "@/hooks/use-cowswap-rfq-history";
import {
  useBebopRfqHistory,
  type BebopHistoryPoint,
} from "@/hooks/use-bebop-rfq-history";
import {
  useZeroXRfqHistory,
  type ZeroXHistoryPoint,
} from "@/hooks/use-0x-rfq-history";
import {
  useOneInchRfqHistory,
  type OneInchHistoryPoint,
} from "@/hooks/use-1inch-rfq-history";
import {
  useJupzRfqHistory,
  type JupzHistoryPoint,
} from "@/hooks/use-jupz-rfq-history";
import { usePoolCandles } from "@/hooks/use-pool-candles";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import { useAuthStore } from "@/lib/auth-store";
import { KRAKEN_SPACE_SLUG } from "@/lib/space-policy";
import { MetricCardSkeleton } from "@/components/dashboard/metric-card";
import {
  ChartCard,
  ChartHeader,
  ChartTitle,
  ChartContent,
  ChartCardSkeleton,
} from "@/components/dashboard/chart-card";
import { scaleLinear, scalePoint, scaleTime } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";

// ─── Types ──────────────────────────────────────────────────────────────────

type ControlPanelTab =
  | "historical"
  | "overview"
  | "depth"
  | "spread"
  | "makers"
  | "alerts";

const TABS: { id: ControlPanelTab; label: string }[] = [
  { id: "historical", label: "Historical" },
  { id: "overview", label: "Overview" },
  { id: "depth", label: "Depth Analysis" },
  { id: "spread", label: "Spread & Fees" },
  { id: "makers", label: "Makers & Solvers" },
  { id: "alerts", label: "Alerts" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 2) =>
  n == null || isNaN(n)
    ? "—"
    : n.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

const fmtCompact = (v: number) => {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtUsd = (v: number) => `$${fmt(v)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value: Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatHistoricalAxisTick(value: Date | number, spanMs: number): string {
  const date = toDate(value);
  const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
  if (spanMs >= DAY_MS && isMidnight) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "2-digit",
    });
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoricalTooltipTime(value: Date | number, spanMs: number): string {
  const date = toDate(value);
  if (spanMs >= DAY_MS) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function impactColor(bps: number) {
  if (bps < 10) return "text-emerald-400";
  if (bps < 50) return "text-amber-400";
  return "text-red-400";
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface RfqControlPanelProps {
  asset: string;
}

export function RfqControlPanel({ asset }: RfqControlPanelProps) {
  const cow = useCowswapRfqData(asset);
  const beb = useBebopRfqData(asset);
  const zx = useZeroXRfqData(asset);
  const [activeTab, setActiveTab] = useState<ControlPanelTab>("historical");

  const allLoading = cow.isLoading && beb.isLoading && zx.isLoading;
  const anyData = cow.forwardTiers.length > 0 || beb.forwardTiers.length > 0 || zx.forwardTiers.length > 0;

  if (allLoading) {
    return (
      <div className="flex flex-col gap-3">
        <PanelHeader asset={asset} cowAt={null} bebAt={null} zxAt={null} />
        <ChartCardSkeleton />
      </div>
    );
  }

  if (!anyData && (cow.isError || cow.allQuotesFailed) && (beb.isError || beb.allQuotesFailed) && (zx.isError || zx.allQuotesFailed)) {
    return (
      <div className="flex flex-col gap-3">
        <PanelHeader asset={asset} cowAt={cow.quoteAt} bebAt={beb.quoteAt} zxAt={zx.quoteAt} />
        <div className="bp-card p-6 text-center">
          <p className="text-sm text-red-500">
            Failed to load RFQ data from CowSwap, Bebop and 0x. Will retry automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <PanelHeader asset={asset} cowAt={cow.quoteAt} bebAt={beb.quoteAt} zxAt={zx.quoteAt} />

      <ControlPanelTabNav activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <OverviewSection
          cowForward={cow.forwardTiers}
          cowReverse={cow.reverseTiers}
          bebForward={beb.forwardTiers}
          bebReverse={beb.reverseTiers}
          zxForward={zx.forwardTiers}
          zxReverse={zx.reverseTiers}
        />
      )}
      {activeTab === "depth" && (
        <DepthSection
          cowForward={cow.forwardTiers}
          cowReverse={cow.reverseTiers}
          bebForward={beb.forwardTiers}
          bebReverse={beb.reverseTiers}
          zxForward={zx.forwardTiers}
          zxReverse={zx.reverseTiers}
        />
      )}
      {activeTab === "spread" && (
        <SpreadSection
          cowForward={cow.forwardTiers}
          cowReverse={cow.reverseTiers}
          bebForward={beb.forwardTiers}
          bebReverse={beb.reverseTiers}
          zxForward={zx.forwardTiers}
          zxReverse={zx.reverseTiers}
        />
      )}
      {activeTab === "makers" && (
        <MakersSection
          bebForward={beb.forwardTiers}
          bebReverse={beb.reverseTiers}
          cowForward={cow.forwardTiers}
        />
      )}
      {activeTab === "alerts" && (
        <AlertsSection
          cowForward={cow.forwardTiers}
          cowReverse={cow.reverseTiers}
          bebForward={beb.forwardTiers}
          bebReverse={beb.reverseTiers}
          zxForward={zx.forwardTiers}
          zxReverse={zx.reverseTiers}
        />
      )}
      {activeTab === "historical" && (
        <HistoricalSection asset={asset} />
      )}
    </>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function PanelHeader({
  asset,
  cowAt,
  bebAt,
  zxAt,
}: {
  asset: string;
  cowAt: string | null;
  bebAt: string | null;
  zxAt: string | null;
}) {
  const ts = cowAt || bebAt || zxAt;
  const timeStr = ts
    ? new Date(ts).toLocaleTimeString("en-US", {
        hour12: true,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-[var(--bp-text-primary)]">
          {asset} / USDC
        </h2>
        <span className="text-[10px] px-2 py-0.5 font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
          RFQ Depth
        </span>
        <span className="text-[10px] px-2 py-0.5 font-semibold uppercase tracking-wider bg-[var(--bp-bg-card-alt)] text-[var(--bp-text-muted)] border border-[var(--bp-border-secondary)]">
          Ethereum
        </span>
      </div>
      <div className="flex items-center gap-3">
        {cowAt && (
          <span className="text-[9px] px-1.5 py-0.5 font-semibold uppercase bg-emerald-500/10 text-emerald-400">
            COW
          </span>
        )}
        {bebAt && (
          <span className="text-[9px] px-1.5 py-0.5 font-semibold uppercase bg-violet-500/10 text-violet-400">
            BEBOP
          </span>
        )}
        {zxAt && (
          <span className="text-[9px] px-1.5 py-0.5 font-semibold uppercase bg-sky-500/10 text-sky-400">
            0x
          </span>
        )}
        <span className="text-[10px] text-[var(--bp-text-muted)] font-mono">
          {timeStr}
        </span>
      </div>
    </div>
  );
}

// ─── Tab Nav ────────────────────────────────────────────────────────────────

function ControlPanelTabNav({
  activeTab,
  onChange,
}: {
  activeTab: ControlPanelTab;
  onChange: (tab: ControlPanelTab) => void;
}) {
  return (
    <div className="border-b border-[var(--bp-border-secondary)]">
      <nav className="flex gap-0.5" aria-label="RFQ control panel tabs">
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

// ─── Overview Section ───────────────────────────────────────────────────────

function OverviewSection({
  cowForward,
  cowReverse,
  bebForward,
  bebReverse,
  zxForward,
  zxReverse,
}: {
  cowForward: CowswapTierRow[];
  cowReverse: CowswapTierRow[];
  bebForward: BebopTierRow[];
  bebReverse: BebopTierRow[];
  zxForward: ZeroXTierRow[];
  zxReverse: ZeroXTierRow[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Cross-protocol depth chart */}
      <CrossProtocolDepthChart
        cowForward={cowForward}
        bebForward={bebForward}
        zxForward={zxForward}
      />

      {/* Side-by-side tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <CowTable tiers={cowForward} label="CowSwap" />
        <BebTable tiers={bebForward} label="Bebop" />
        <ZxTable tiers={zxForward} label="0x" />
      </div>

      {/* Best execution comparison */}
      <ComparisonTable cowForward={cowForward} bebForward={bebForward} zxForward={zxForward} />
    </div>
  );
}

// ─── Cross-Protocol Depth Chart ─────────────────────────────────────────────

function CrossProtocolDepthChart({
  cowForward,
  bebForward,
  zxForward,
}: {
  cowForward: CowswapTierRow[];
  bebForward: BebopTierRow[];
  zxForward: ZeroXTierRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [hoverNotional, setHoverNotional] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setDims({ width: e.contentRect.width, height: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const w = dims.width - margin.left - margin.right;
  const h = dims.height - margin.top - margin.bottom;

  const cowPts = cowForward
    .filter((t) => t.impliedTokenPrice > 0)
    .map((t) => ({ x: t.notionalUsd, y: t.impliedTokenPrice }));
  const bebPts = bebForward
    .filter((t) => t.impliedTokenPrice > 0)
    .map((t) => ({ x: t.notionalUsd, y: t.impliedTokenPrice }));
  const zxPts = zxForward
    .filter((t) => t.impliedTokenPrice > 0)
    .map((t) => ({ x: t.notionalUsd, y: t.impliedTokenPrice }));

  // Build a sorted, deduplicated list of notional values across all protocols
  const allNotionals = Array.from(
    new Set([...cowPts.map((p) => p.x), ...bebPts.map((p) => p.x), ...zxPts.map((p) => p.x)])
  ).sort((a, b) => a - b);

  const allPts = [...cowPts, ...bebPts, ...zxPts];
  if (allPts.length === 0 || w <= 0 || h <= 0) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>
            Cross-Protocol Depth{" "}
            <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-semibold uppercase">
              COW
            </span>
            <span className="ml-1 text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 font-semibold uppercase">
              BEBOP
            </span>
            <span className="ml-1 text-[9px] px-1.5 py-0.5 bg-sky-500/10 text-sky-400 font-semibold uppercase">
              0x
            </span>
          </ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div
            ref={containerRef}
            className="w-full"
            style={{ height: 280 }}
          >
            <p className="text-xs text-[var(--bp-text-muted)] text-center pt-20">
              No data available
            </p>
          </div>
        </ChartContent>
      </ChartCard>
    );
  }

  // Point scale: evenly space only the notionals where data exists
  const xScale = scalePoint<number>({
    domain: allNotionals,
    range: [0, w],
    padding: 0.3,
  });
  const yScale = scaleLinear({
    domain: [
      Math.min(...allPts.map((p) => p.y)) * 0.995,
      Math.max(...allPts.map((p) => p.y)) * 1.005,
    ],
    range: [h, 0],
    nice: true,
  });

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>
          Cross-Protocol Depth{" "}
          <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-semibold uppercase">
            COW
          </span>
          <span className="ml-1 text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 font-semibold uppercase">
            BEBOP
          </span>
        </ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div ref={containerRef} className="w-full relative" style={{ height: 280 }}>
          <svg width={dims.width} height={dims.height}>
            <Group left={margin.left} top={margin.top}>
              <GridRows
                scale={yScale}
                width={w}
                stroke="var(--bp-grid-minor)"
                strokeOpacity={0.5}
                numTicks={5}
              />
              {/* CowSwap line */}
              <AreaClosed
                data={cowPts}
                x={(d) => xScale(d.x) ?? 0}
                y={(d) => yScale(d.y) ?? 0}
                yScale={yScale}
                fill="rgba(34,197,94,0.06)"
                curve={curveMonotoneX}
              />
              <LinePath
                data={cowPts}
                x={(d) => xScale(d.x) ?? 0}
                y={(d) => yScale(d.y) ?? 0}
                stroke="#22c55e"
                strokeWidth={2}
                curve={curveMonotoneX}
              />
              {cowPts.map((p, i) => (
                <circle
                  key={`c${i}`}
                  cx={xScale(p.x)}
                  cy={yScale(p.y)}
                  r={hoverNotional === p.x ? 6 : 4}
                  fill="#22c55e"
                  stroke="var(--bp-bg-card)"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ))}
              {/* Bebop line */}
              <AreaClosed
                data={bebPts}
                x={(d) => xScale(d.x) ?? 0}
                y={(d) => yScale(d.y) ?? 0}
                yScale={yScale}
                fill="rgba(167,139,250,0.06)"
                curve={curveMonotoneX}
              />
              <LinePath
                data={bebPts}
                x={(d) => xScale(d.x) ?? 0}
                y={(d) => yScale(d.y) ?? 0}
                stroke="#a78bfa"
                strokeWidth={2}
                curve={curveMonotoneX}
              />
              {bebPts.map((p, i) => (
                <circle
                  key={`b${i}`}
                  cx={xScale(p.x)}
                  cy={yScale(p.y)}
                  r={hoverNotional === p.x ? 6 : 4}
                  fill="#a78bfa"
                  stroke="var(--bp-bg-card)"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ))}
              {/* 0x line */}
              <AreaClosed
                data={zxPts}
                x={(d) => xScale(d.x) ?? 0}
                y={(d) => yScale(d.y) ?? 0}
                yScale={yScale}
                fill="rgba(56,189,248,0.06)"
                curve={curveMonotoneX}
              />
              <LinePath
                data={zxPts}
                x={(d) => xScale(d.x) ?? 0}
                y={(d) => yScale(d.y) ?? 0}
                stroke="#38bdf8"
                strokeWidth={2}
                curve={curveMonotoneX}
              />
              {zxPts.map((p, i) => (
                <circle
                  key={`z${i}`}
                  cx={xScale(p.x)}
                  cy={yScale(p.y)}
                  r={hoverNotional === p.x ? 6 : 4}
                  fill="#38bdf8"
                  stroke="var(--bp-bg-card)"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ))}
              {/* Crosshair line */}
              {hoverNotional != null && (() => {
                const cx = xScale(hoverNotional) ?? 0;
                return (
                  <line
                    x1={cx}
                    x2={cx}
                    y1={0}
                    y2={h}
                    stroke="var(--bp-text-muted)"
                    strokeWidth={1}
                    strokeDasharray="3,3"
                    pointerEvents="none"
                  />
                );
              })()}
              {/* Invisible full-height hit columns for hover */}
              {allNotionals.map((notional, i) => {
                const cx = xScale(notional) ?? 0;
                const step = xScale.step?.() ?? w / allNotionals.length;
                const colW = step;
                return (
                  <rect
                    key={`hit-${i}`}
                    x={cx - colW / 2}
                    y={0}
                    width={colW}
                    height={h}
                    fill="transparent"
                    style={{ cursor: "crosshair" }}
                    onMouseEnter={() => setHoverNotional(notional)}
                    onMouseMove={() => setHoverNotional(notional)}
                    onMouseLeave={() => setHoverNotional(null)}
                  />
                );
              })}
              <AxisBottom
                scale={xScale}
                top={h}
                stroke="var(--bp-border-subtle)"
                tickStroke="var(--bp-border-subtle)"
                tickValues={allNotionals}
                tickLabelProps={() => ({
                  fill: "var(--bp-text-muted)",
                  fontSize: 9,
                  fontFamily: "IBM Plex Mono",
                  textAnchor: "middle" as const,
                })}
                tickFormat={(v) => fmtCompact(v as number)}
              />
              <AxisLeft
                scale={yScale}
                stroke="var(--bp-border-subtle)"
                tickStroke="var(--bp-border-subtle)"
                tickLabelProps={() => ({
                  fill: "var(--bp-text-muted)",
                  fontSize: 9,
                  fontFamily: "IBM Plex Mono",
                  textAnchor: "end" as const,
                  dx: -4,
                })}
                tickFormat={(v) => fmtCompact(v as number)}
                numTicks={5}
              />
            </Group>
          </svg>

          {/* Tooltip */}
          {hoverNotional != null && (() => {
            const cowP = cowPts.find((p) => p.x === hoverNotional);
            const bebP = bebPts.find((p) => p.x === hoverNotional);
            const zxP = zxPts.find((p) => p.x === hoverNotional);
            if (!cowP && !bebP && !zxP) return null;
            const allPrices = [cowP?.y, bebP?.y, zxP?.y].filter(Boolean) as number[];
            const bestPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
            const cx = (xScale(hoverNotional) ?? 0) + margin.left;
            const topY = margin.top + 8;
            return (
              <div
                className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
                style={{
                  left: cx,
                  top: topY,
                  transform: "translateX(-50%)",
                }}
              >
                <div className="text-[var(--bp-text-muted)] mb-1.5 font-semibold">
                  {fmtCompact(hoverNotional)} trade
                </div>
                {cowP && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: "#22c55e" }}
                    />
                    <span className="text-[var(--bp-text-primary)]">
                      Cow: <span className="font-semibold">${fmt(cowP.y, 4)}/tk</span>
                    </span>
                    <span className={cowP.y <= bestPrice ? "text-emerald-400" : "text-red-400"}>
                      ({cowP.y <= bestPrice ? "best" : "worse"})
                    </span>
                  </div>
                )}
                {bebP && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: "#a78bfa" }}
                    />
                    <span className="text-[var(--bp-text-primary)]">
                      Beb: <span className="font-semibold">${fmt(bebP.y, 4)}/tk</span>
                    </span>
                    <span className={bebP.y <= bestPrice ? "text-emerald-400" : "text-red-400"}>
                      ({bebP.y <= bestPrice ? "best" : "worse"})
                    </span>
                  </div>
                )}
                {zxP && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: "#38bdf8" }}
                    />
                    <span className="text-[var(--bp-text-primary)]">
                      0x: <span className="font-semibold">${fmt(zxP.y, 4)}/tk</span>
                    </span>
                    <span className={zxP.y <= bestPrice ? "text-emerald-400" : "text-red-400"}>
                      ({zxP.y <= bestPrice ? "best" : "worse"})
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── CowSwap Table ──────────────────────────────────────────────────────────

function CowTable({
  tiers,
  label,
}: {
  tiers: CowswapTierRow[];
  label: string;
}) {
  const ref =
    tiers.length > 0 ? tiers[0].impliedTokenPrice : 0;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>
          {label}{" "}
          <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-semibold uppercase">
            LIVE
          </span>
        </ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Tokens</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">$/Tk</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Fee</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Bps</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Impact</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">St</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => {
                const imp =
                  ref > 0
                    ? ((t.impliedTokenPrice - ref) / ref) * 100
                    : 0;
                const st = tierStatus(ref, t.impliedTokenPrice);
                return (
                  <tr
                    key={t.notionalUsd}
                    className="hover:bg-[var(--bp-bg-hover)] transition-colors"
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                      {t.label}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {fmt(t.tokensOut, 4)}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {fmtUsd(t.impliedTokenPrice)}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-muted)] border-b border-[rgba(22,45,74,0.5)]">
                      ${fmt(t.feeAmount, 2)}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-muted)] border-b border-[rgba(22,45,74,0.5)]">
                      {t.feeBps}
                    </td>
                    <td
                      className={cn(
                        "px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]",
                        Math.abs(imp) > 5
                          ? "text-red-400"
                          : Math.abs(imp) > 2
                            ? "text-amber-400"
                            : "text-[var(--bp-text-muted)]"
                      )}
                    >
                      {fmt(imp, 1)}%
                    </td>
                    <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                      <StatusBadge status={st} />
                    </td>
                  </tr>
                );
              })}
              {tiers.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-2.5 py-4 text-center text-[var(--bp-text-muted)]"
                  >
                    No CowSwap data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Bebop Table ────────────────────────────────────────────────────────────

function BebTable({
  tiers,
  label,
}: {
  tiers: BebopTierRow[];
  label: string;
}) {
  const ref =
    tiers.length > 0 ? tiers[0].impliedTokenPrice : 0;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>
          {label}{" "}
          <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 font-semibold uppercase">
            LIVE
          </span>
        </ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">$/Tk</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Route</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Maker</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">St</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => {
                const st = tierStatus(ref, t.impliedTokenPrice);
                const mk = t.makerAddress
                  ? `${t.makerAddress.slice(0, 6)}…${t.makerAddress.slice(-4)}`
                  : "—";
                return (
                  <tr
                    key={t.notionalUsd}
                    className="hover:bg-[var(--bp-bg-hover)] transition-colors"
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                      {t.label}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {fmtUsd(t.impliedTokenPrice)}
                    </td>
                    <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                        {t.routeType}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-muted)] text-[10px] border-b border-[rgba(22,45,74,0.5)]">
                      {mk}
                    </td>
                    <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                      <StatusBadge status={st} />
                    </td>
                  </tr>
                );
              })}
              {tiers.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2.5 py-4 text-center text-[var(--bp-text-muted)]"
                  >
                    No Bebop data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── 0x Table ────────────────────────────────────────────────────────────────

function ZxTable({
  tiers,
  label,
}: {
  tiers: ZeroXTierRow[];
  label: string;
}) {
  const ref =
    tiers.length > 0 ? tiers[0].impliedTokenPrice : 0;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>
          {label}{" "}
          <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-sky-500/10 text-sky-400 font-semibold uppercase">
            LIVE
          </span>
        </ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">$/Tk</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Impact</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">St</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => {
                const imp =
                  ref > 0
                    ? ((t.impliedTokenPrice - ref) / ref) * 100
                    : 0;
                const st = tierStatus(ref, t.impliedTokenPrice);
                return (
                  <tr
                    key={t.notionalUsd}
                    className="hover:bg-[var(--bp-bg-hover)] transition-colors"
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                      {t.label}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {fmtUsd(t.impliedTokenPrice)}
                    </td>
                    <td
                      className={cn(
                        "px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]",
                        Math.abs(imp) > 5
                          ? "text-red-400"
                          : Math.abs(imp) > 2
                            ? "text-amber-400"
                            : "text-[var(--bp-text-muted)]"
                      )}
                    >
                      {fmt(imp, 1)}%
                    </td>
                    <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                      <StatusBadge status={st} />
                    </td>
                  </tr>
                );
              })}
              {tiers.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-2.5 py-4 text-center text-[var(--bp-text-muted)]"
                  >
                    No 0x data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Comparison Table ───────────────────────────────────────────────────────

function ComparisonTable({
  cowForward,
  bebForward,
  zxForward,
}: {
  cowForward: CowswapTierRow[];
  bebForward: BebopTierRow[];
  zxForward: ZeroXTierRow[];
}) {
  // Get all unique notional sizes
  const sizes = [
    ...new Set([
      ...cowForward.map((t) => t.notionalUsd),
      ...bebForward.map((t) => t.notionalUsd),
      ...zxForward.map((t) => t.notionalUsd),
    ]),
  ].sort((a, b) => a - b);

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Best Execution</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">CowSwap</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Bebop</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">0x</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Winner</th>
                <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Spread</th>
              </tr>
            </thead>
            <tbody>
              {sizes.map((sz) => {
                const c = cowForward.find((t) => t.notionalUsd === sz);
                const b = bebForward.find((t) => t.notionalUsd === sz);
                const z = zxForward.find((t) => t.notionalUsd === sz);
                const cp = c?.impliedTokenPrice ?? 0;
                const bp = b?.impliedTokenPrice ?? 0;
                const zp = z?.impliedTokenPrice ?? 0;
                const prices = [
                  cp > 0 ? { name: "COW", price: cp, color: "emerald" } : null,
                  bp > 0 ? { name: "BEB", price: bp, color: "violet" } : null,
                  zp > 0 ? { name: "0x", price: zp, color: "sky" } : null,
                ].filter(Boolean) as { name: string; price: number; color: string }[];

                let winnerEl = <span className="text-[var(--bp-text-muted)]">—</span>;
                let spread = "—";

                if (prices.length >= 2) {
                  const best = prices.reduce((a, b) => a.price <= b.price ? a : b);
                  const worst = prices.reduce((a, b) => a.price >= b.price ? a : b);
                  winnerEl = (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-${best.color}-500/10 text-${best.color}-400 border border-${best.color}-500/20`}>
                      {best.name}
                    </span>
                  );
                  spread = `${fmt((Math.abs(worst.price - best.price) / best.price) * 100, 2)}%`;
                }

                return (
                  <tr
                    key={sz}
                    className="hover:bg-[var(--bp-bg-hover)] transition-colors"
                  >
                    <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                      {fmtCompact(sz)}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {cp > 0 ? fmtUsd(cp) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {bp > 0 ? fmtUsd(bp) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {zp > 0 ? fmtUsd(zp) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                      {winnerEl}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-muted)] border-b border-[rgba(22,45,74,0.5)]">
                      {spread}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Depth Section ──────────────────────────────────────────────────────────

function DepthSection({
  cowForward,
  cowReverse,
  bebForward,
  bebReverse,
  zxForward,
  zxReverse,
}: {
  cowForward: CowswapTierRow[];
  cowReverse: CowswapTierRow[];
  bebForward: BebopTierRow[];
  bebReverse: BebopTierRow[];
  zxForward: ZeroXTierRow[];
  zxReverse: ZeroXTierRow[];
}) {
  const cowRef = cowForward.length > 0 ? cowForward[0].impliedTokenPrice : 0;
  const bebRef = bebForward.length > 0 ? bebForward[0].impliedTokenPrice : 0;
  const zxRef = zxForward.length > 0 ? zxForward[0].impliedTokenPrice : 0;

  return (
    <div className="flex flex-col gap-3">
      <CrossProtocolDepthChart cowForward={cowForward} bebForward={bebForward} zxForward={zxForward} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Price Impact % */}
        <ChartCard>
          <ChartHeader>
            <ChartTitle>Price Impact %</ChartTitle>
          </ChartHeader>
          <ChartContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono border-collapse">
                <thead>
                  <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Cow %</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Beb %</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">0x %</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const allSizes = [...new Set([
                      ...cowForward.map((t) => t.notionalUsd),
                      ...bebForward.map((t) => t.notionalUsd),
                      ...zxForward.map((t) => t.notionalUsd),
                    ])].sort((a, b) => a - b);
                    return allSizes.map((sz) => {
                    const ct = cowForward.find((t) => t.notionalUsd === sz);
                    const bt = bebForward.find(
                      (b) => b.notionalUsd === sz
                    );
                    const zt = zxForward.find(
                      (z) => z.notionalUsd === sz
                    );
                    const cowImp =
                      ct && cowRef > 0
                        ? Math.abs(
                            ((ct.impliedTokenPrice - cowRef) / cowRef) * 100
                          )
                        : null;
                    const bebImp =
                      bt && bebRef > 0
                        ? Math.abs(
                            ((bt.impliedTokenPrice - bebRef) / bebRef) * 100
                          )
                        : null;
                    const zxImp =
                      zt && zxRef > 0
                        ? Math.abs(
                            ((zt.impliedTokenPrice - zxRef) / zxRef) * 100
                          )
                        : null;
                    return (
                      <tr key={sz} className="hover:bg-[var(--bp-bg-hover)]">
                        <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                          {fmtCompact(sz)}
                        </td>
                        <td className={cn("px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]", cowImp !== null ? impactColor(cowImp * 100) : "text-[var(--bp-text-muted)]")}>
                          {cowImp !== null ? `${fmt(cowImp, 2)}%` : "—"}
                        </td>
                        <td className={cn("px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]", bebImp !== null ? impactColor(bebImp * 100) : "text-[var(--bp-text-muted)]")}>
                          {bebImp !== null ? `${fmt(bebImp, 2)}%` : "—"}
                        </td>
                        <td className={cn("px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]", zxImp !== null ? impactColor(zxImp * 100) : "text-[var(--bp-text-muted)]")}>
                          {zxImp !== null ? `${fmt(zxImp, 2)}%` : "—"}
                        </td>
                      </tr>
                    );
                  });
                  })()}
                </tbody>
              </table>
            </div>
          </ChartContent>
        </ChartCard>

        {/* Tokens received comparison */}
        <ChartCard>
          <ChartHeader>
            <ChartTitle>Tokens Received (Forward)</ChartTitle>
          </ChartHeader>
          <ChartContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono border-collapse">
                <thead>
                  <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">CowSwap</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Bebop</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {cowForward.map((ct) => {
                    const bt = bebForward.find(
                      (b) => b.notionalUsd === ct.notionalUsd
                    );
                    // For bebop, compute tokens from price: notional / impliedPrice
                    const bebTokens =
                      bt && bt.impliedTokenPrice > 0
                        ? bt.notionalUsd / bt.impliedTokenPrice
                        : null;
                    const diff =
                      bebTokens !== null && ct.tokensOut > 0
                        ? ((ct.tokensOut - bebTokens) / bebTokens) * 100
                        : null;
                    return (
                      <tr key={ct.notionalUsd} className="hover:bg-[var(--bp-bg-hover)]">
                        <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                          {ct.label}
                        </td>
                        <td className="px-2.5 py-1.5 text-emerald-400 border-b border-[rgba(22,45,74,0.5)]">
                          {fmt(ct.tokensOut, 4)}
                        </td>
                        <td className="px-2.5 py-1.5 text-violet-400 border-b border-[rgba(22,45,74,0.5)]">
                          {bebTokens !== null ? fmt(bebTokens, 4) : "—"}
                        </td>
                        <td
                          className={cn(
                            "px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]",
                            diff !== null && diff > 0
                              ? "text-emerald-400"
                              : diff !== null && diff < 0
                                ? "text-red-400"
                                : "text-[var(--bp-text-muted)]"
                          )}
                        >
                          {diff !== null
                            ? `${diff > 0 ? "+" : ""}${fmt(diff, 2)}%`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContent>
        </ChartCard>
      </div>
    </div>
  );
}

// ─── Spread Section ─────────────────────────────────────────────────────────

function SpreadSection({
  cowForward,
  cowReverse,
  bebForward,
  bebReverse,
  zxForward,
  zxReverse,
}: {
  cowForward: CowswapTierRow[];
  cowReverse: CowswapTierRow[];
  bebForward: BebopTierRow[];
  bebReverse: BebopTierRow[];
  zxForward: ZeroXTierRow[];
  zxReverse: ZeroXTierRow[];
}) {
  // Get all unique notional sizes
  const sizes = [
    ...new Set([
      ...cowForward.map((t) => t.notionalUsd),
      ...bebForward.map((t) => t.notionalUsd),
      ...zxForward.map((t) => t.notionalUsd),
    ]),
  ].sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Bid-ask spread */}
        <BidAskCard cowForward={cowForward} cowReverse={cowReverse} />

        {/* Fee breakdown */}
        <ChartCard>
          <ChartHeader>
            <ChartTitle>
              Fee Breakdown{" "}
              <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-semibold uppercase">
                COW
              </span>
            </ChartTitle>
          </ChartHeader>
          <ChartContent>
            <div className="flex flex-col gap-3 p-1">
              {cowForward
                .filter((t) =>
                  [10000, 100000, 1000000].includes(t.notionalUsd)
                )
                .map((t) => {
                  const protoFee =
                    (t.feeBps / 10000) * t.notionalUsd;
                  const totalPct =
                    ((t.feeAmount + protoFee) / t.notionalUsd) * 100;
                  return (
                    <div key={t.notionalUsd}>
                      <div className="text-[9px] text-emerald-400 tracking-widest mb-1 font-mono">
                        {t.label}
                      </div>
                      <div className="flex h-5 overflow-hidden rounded-sm">
                        <div
                          className="flex items-center justify-center text-[8px] font-semibold text-white/80"
                          style={{
                            flex: Math.max(
                              1,
                              (t.feeAmount / t.notionalUsd) * 200
                            ),
                            background: "rgba(34,197,94,0.6)",
                          }}
                        >
                          ${fmt(t.feeAmount, 1)}
                        </div>
                        <div
                          className="flex items-center justify-center text-[8px] font-semibold text-white/80"
                          style={{
                            flex: Math.max(
                              1,
                              (protoFee / t.notionalUsd) * 200
                            ),
                            background: "rgba(107,139,179,0.4)",
                          }}
                        >
                          {t.feeBps}bps
                        </div>
                      </div>
                      <div className="text-[9px] text-[var(--bp-text-muted)] font-mono mt-0.5">
                        {fmt(totalPct, 4)}% total
                      </div>
                    </div>
                  );
                })}
              {cowForward.length === 0 && (
                <span className="text-[var(--bp-text-muted)] text-xs">
                  Need data
                </span>
              )}
            </div>
          </ChartContent>
        </ChartCard>

        {/* Gas costs */}
        <ChartCard>
          <ChartHeader>
            <ChartTitle>Gas Costs</ChartTitle>
          </ChartHeader>
          <ChartContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono border-collapse">
                <thead>
                  <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Cow Gas</th>
                    <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Beb Gas</th>
                  </tr>
                </thead>
                <tbody>
                  {sizes.map((sz) => {
                    const ct = cowForward.find(
                      (t) => t.notionalUsd === sz
                    );
                    const bt = bebForward.find(
                      (t) => t.notionalUsd === sz
                    );
                    return (
                      <tr key={sz} className="hover:bg-[var(--bp-bg-hover)]">
                        <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                          {fmtCompact(sz)}
                        </td>
                        <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                          {ct ? `${fmt(ct.gasCostGwei, 0)} gwei` : "—"}
                        </td>
                        <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                          {bt ? `$${fmt(bt.gasFeeUsd, 2)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContent>
        </ChartCard>
      </div>

      {/* Cross-protocol spread table */}
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Cross-Protocol Spread %</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Cow $/tk</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Beb $/tk</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Spread</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Visual</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((sz) => {
                  const ct = cowForward.find((t) => t.notionalUsd === sz);
                  const bt = bebForward.find((t) => t.notionalUsd === sz);
                  const cp = ct?.impliedTokenPrice ?? 0;
                  const bp = bt?.impliedTokenPrice ?? 0;
                  const spread =
                    cp > 0 && bp > 0
                      ? (Math.abs(cp - bp) / Math.min(cp, bp)) * 100
                      : 0;
                  const barWidth = Math.min(100, spread * 20); // scale for visual
                  return (
                    <tr key={sz} className="hover:bg-[var(--bp-bg-hover)]">
                      <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                        {fmtCompact(sz)}
                      </td>
                      <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                        {cp > 0 ? fmtUsd(cp) : "—"}
                      </td>
                      <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                        {bp > 0 ? fmtUsd(bp) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]",
                          spread > 2
                            ? "text-red-400"
                            : spread > 0.5
                              ? "text-amber-400"
                              : "text-emerald-400"
                        )}
                      >
                        {spread > 0 ? `${fmt(spread, 2)}%` : "—"}
                      </td>
                      <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                        <div className="w-24 h-1 bg-[var(--bp-bg-elevated)] rounded overflow-hidden">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${barWidth}%`,
                              background:
                                spread > 2
                                  ? "rgba(239,68,68,0.6)"
                                  : spread > 0.5
                                    ? "rgba(245,158,11,0.6)"
                                    : "rgba(34,197,94,0.6)",
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartContent>
      </ChartCard>
    </div>
  );
}

// ─── Bid-Ask Card ───────────────────────────────────────────────────────────

function BidAskCard({
  cowForward,
  cowReverse,
}: {
  cowForward: CowswapTierRow[];
  cowReverse: CowswapTierRow[];
}) {
  const sellRef =
    cowForward.length > 0 ? cowForward[0].impliedTokenPrice : 0;
  const buyRef =
    cowReverse.length > 0 ? cowReverse[0].impliedTokenPrice : 0;
  const gap = Math.abs(buyRef - sellRef);
  const pct = sellRef > 0 ? (gap / sellRef) * 100 : 0;
  const bad = pct > 5;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>
          Bid-Ask{" "}
          <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-semibold uppercase">
            COW
          </span>
        </ChartTitle>
      </ChartHeader>
      <ChartContent>
        {sellRef > 0 && buyRef > 0 ? (
          <div className="p-1">
            <div className="text-[10px] text-[var(--bp-text-muted)] font-mono mb-2">
              Sell 1 token vs Buy 1 token
            </div>
            <div className="flex items-center h-9 gap-0.5 mb-2">
              <div
                className="h-full flex items-center justify-end px-2 text-[10px] font-semibold text-black rounded-l"
                style={{
                  flex: 1,
                  background: "#22c55e",
                }}
              >
                SELL ${fmt(sellRef, 0)}
              </div>
              <div className="w-0.5 h-full bg-[var(--bp-border-secondary)]" />
              <div
                className={cn(
                  "h-full flex items-center px-2 text-[10px] font-semibold rounded-r",
                  bad ? "text-white" : "text-black"
                )}
                style={{
                  flex: Math.min(12, buyRef / sellRef),
                  background: bad ? "#ef4444" : "#f59e0b",
                }}
              >
                BUY ${fmt(buyRef, 0)}
              </div>
            </div>
            <div
              className={cn(
                "text-[13px] font-semibold font-mono",
                bad ? "text-red-400" : "text-amber-400"
              )}
            >
              ${fmt(gap, 0)} spread ({fmt(pct, 1)}%)
            </div>
          </div>
        ) : (
          <span className="text-[var(--bp-text-muted)] text-xs p-4">
            Run scan
          </span>
        )}
      </ChartContent>
    </ChartCard>
  );
}

// ─── Makers Section ─────────────────────────────────────────────────────────

function MakersSection({
  bebForward,
  bebReverse,
  cowForward,
}: {
  bebForward: BebopTierRow[];
  bebReverse: BebopTierRow[];
  cowForward: CowswapTierRow[];
}) {
  // Aggregate makers from Bebop
  const makers = useMemo(() => {
    const mk = new Map<
      string,
      { address: string; sizes: number[]; routes: string[] }
    >();
    [...bebForward, ...bebReverse].forEach((t) => {
      if (t.makerAddress) {
        const existing = mk.get(t.makerAddress);
        if (existing) {
          existing.sizes.push(t.notionalUsd);
          existing.routes.push(t.routeType);
        } else {
          mk.set(t.makerAddress, {
            address: t.makerAddress,
            sizes: [t.notionalUsd],
            routes: [t.routeType],
          });
        }
      }
    });
    return Array.from(mk.values());
  }, [bebForward, bebReverse]);

  // PMM vs JAM counts
  const pmmCount = [...bebForward, ...bebReverse].filter((t) =>
    t.routeType?.includes("PMM")
  ).length;
  const jamCount = [...bebForward, ...bebReverse].filter(
    (t) => !t.routeType?.includes("PMM")
  ).length;
  const total = pmmCount + jamCount;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Bebop Makers */}
        <ChartCard>
          <ChartHeader>
            <ChartTitle>
              Bebop Makers{" "}
              <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 font-semibold uppercase">
                BEBOP
              </span>
            </ChartTitle>
          </ChartHeader>
          <ChartContent>
            {makers.length > 0 ? (
              <div className="flex flex-col gap-2 p-1">
                {makers.map((m) => {
                  const maxSz = Math.max(...m.sizes);
                  return (
                    <div
                      key={m.address}
                      className="bg-[var(--bp-bg-card-alt)] border border-[var(--bp-border-subtle)] p-3"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-violet-400 text-[11px] font-mono">
                          {m.address.slice(0, 6)}…{m.address.slice(-4)}
                        </span>
                        <StatusBadge status="tight" />
                      </div>
                      <div className="text-[10px] text-[var(--bp-text-muted)] font-mono mt-1">
                        Max: {fmtCompact(maxSz)} · {m.sizes.length} sizes
                        · {m.routes[0]}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-[var(--bp-text-muted)] text-xs p-4">
                No maker data
              </span>
            )}
          </ChartContent>
        </ChartCard>

        {/* PMM vs JAM */}
        <ChartCard>
          <ChartHeader>
            <ChartTitle>
              PMM vs JAM{" "}
              <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 font-semibold uppercase">
                BEBOP
              </span>
            </ChartTitle>
          </ChartHeader>
          <ChartContent>
            <div className="flex flex-col items-center justify-center gap-4 py-4">
              {total > 0 ? (
                <>
                  <div className="flex gap-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-violet-400 font-mono">
                        {pmmCount}
                      </div>
                      <div className="text-[9px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                        PMM (RFQ)
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-amber-400 font-mono">
                        {jamCount}
                      </div>
                      <div className="text-[9px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                        JAM (Solver)
                      </div>
                    </div>
                  </div>
                  <div className="w-full max-w-xs h-3 bg-[var(--bp-bg-elevated)] rounded overflow-hidden flex">
                    <div
                      className="h-full rounded-l"
                      style={{
                        width: `${(pmmCount / total) * 100}%`,
                        background: "rgba(167,139,250,0.55)",
                      }}
                    />
                    <div
                      className="h-full rounded-r"
                      style={{
                        width: `${(jamCount / total) * 100}%`,
                        background: "rgba(245,158,11,0.55)",
                      }}
                    />
                  </div>
                </>
              ) : (
                <span className="text-[var(--bp-text-muted)] text-xs">
                  No route data
                </span>
              )}
            </div>
          </ChartContent>
        </ChartCard>
      </div>

      {/* Routes by size */}
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Routes by Size</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Size</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Best</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Route</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Maker</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">$/tk</th>
                </tr>
              </thead>
              <tbody>
                {bebForward.map((t) => {
                  const mk = t.makerAddress
                    ? `${t.makerAddress.slice(0, 6)}…${t.makerAddress.slice(-4)}`
                    : "—";
                  return (
                    <tr key={t.notionalUsd} className="hover:bg-[var(--bp-bg-hover)]">
                      <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                        {t.label}
                      </td>
                      <td className="px-2.5 py-1.5 font-semibold text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                        {t.quote.best_price || "—"}
                      </td>
                      <td className="px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                          {t.routeType}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-[var(--bp-text-muted)] text-[10px] border-b border-[rgba(22,45,74,0.5)]">
                        {mk}
                      </td>
                      <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                        {fmtUsd(t.impliedTokenPrice)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ChartContent>
      </ChartCard>
    </div>
  );
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

interface Alert {
  severity: "critical" | "warning" | "info";
  message: string;
}

function computeAlerts(
  cowForward: CowswapTierRow[],
  cowReverse: CowswapTierRow[],
  bebForward: BebopTierRow[],
  bebReverse: BebopTierRow[],
  zxForward: ZeroXTierRow[] = [],
  zxReverse: ZeroXTierRow[] = []
): Alert[] {
  const alerts: Alert[] = [];
  const cowRef =
    cowForward.length > 0 ? cowForward[0].impliedTokenPrice : 0;
  const bebRef =
    bebForward.length > 0 ? bebForward[0].impliedTokenPrice : 0;
  const zxRef =
    zxForward.length > 0 ? zxForward[0].impliedTokenPrice : 0;

  // Cow cliff detection
  if (cowRef > 0) {
    cowForward.forEach((t) => {
      if (t.impliedTokenPrice > cowRef * 2) {
        alerts.push({
          severity: "critical",
          message: `Cow cliff at ${t.label}: $${fmt(t.impliedTokenPrice)} vs ref $${fmt(cowRef)}`,
        });
      }
    });
  }

  // Beb cliff detection
  if (bebRef > 0) {
    bebForward.forEach((t) => {
      if (t.impliedTokenPrice > bebRef * 2) {
        alerts.push({
          severity: "critical",
          message: `Beb cliff at ${t.label}: $${fmt(t.impliedTokenPrice)} vs ref $${fmt(bebRef)}`,
        });
      }
    });
  }

  // 0x cliff detection
  if (zxRef > 0) {
    zxForward.forEach((t) => {
      if (t.impliedTokenPrice > zxRef * 2) {
        alerts.push({
          severity: "critical",
          message: `0x cliff at ${t.label}: $${fmt(t.impliedTokenPrice)} vs ref $${fmt(zxRef)}`,
        });
      }
    });
  }

  // Cross-protocol spread
  cowForward.forEach((ct) => {
    const bt = bebForward.find((b) => b.notionalUsd === ct.notionalUsd);
    if (bt) {
      const spread =
        Math.abs(ct.impliedTokenPrice - bt.impliedTokenPrice) /
        Math.min(ct.impliedTokenPrice, bt.impliedTokenPrice);
      if (spread > 0.02) {
        alerts.push({
          severity: "warning",
          message: `Cross spread at ${ct.label}: ${(spread * 100).toFixed(1)}%`,
        });
      }
    }
  });

  // Bid-ask blowup
  const cowSell =
    cowForward.length > 0 ? cowForward[0].impliedTokenPrice : 0;
  const cowBuy =
    cowReverse.length > 0 ? cowReverse[0].impliedTokenPrice : 0;
  if (cowSell > 0 && cowBuy > 0) {
    const baSpread = Math.abs(cowBuy - cowSell) / cowSell;
    if (baSpread > 0.05) {
      alerts.push({
        severity: "critical",
        message: `Bid-ask blow-up: sell $${fmt(cowSell, 0)} vs buy $${fmt(cowBuy, 0)} (${(baSpread * 100).toFixed(0)}%)`,
      });
    }
  }

  // PMM offline detection
  const bebAll = [...bebForward, ...bebReverse].filter(
    (t) => t.impliedTokenPrice > 0
  );
  const pmmCount = bebAll.filter((t) =>
    t.routeType?.includes("PMM")
  ).length;
  if (bebAll.length > 0 && pmmCount === 0) {
    alerts.push({
      severity: "critical",
      message: "Maker offline: 0 PMM — all JAM fallback",
    });
  }

  if (alerts.length === 0) {
    alerts.push({ severity: "info", message: "All clear." });
  }

  return alerts;
}

function AlertsSection({
  cowForward,
  cowReverse,
  bebForward,
  bebReverse,
  zxForward,
  zxReverse,
}: {
  cowForward: CowswapTierRow[];
  cowReverse: CowswapTierRow[];
  bebForward: BebopTierRow[];
  bebReverse: BebopTierRow[];
  zxForward: ZeroXTierRow[];
  zxReverse: ZeroXTierRow[];
}) {
  const alerts = computeAlerts(
    cowForward,
    cowReverse,
    bebForward,
    bebReverse,
    zxForward,
    zxReverse
  );

  return (
    <div className="flex flex-col gap-3">
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Active Alerts</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="max-h-[300px] overflow-y-auto">
            {alerts.map((a, i) => (
              <div
                key={i}
                className="flex gap-2.5 py-2.5 px-1 border-b border-[rgba(22,45,74,0.5)] last:border-b-0 items-start text-[11px]"
              >
                <div
                  className={cn(
                    "w-5 h-5 flex items-center justify-center text-[9px] font-bold flex-shrink-0",
                    a.severity === "critical"
                      ? "bg-red-500/15 text-red-400"
                      : a.severity === "warning"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-sky-500/15 text-sky-400"
                  )}
                >
                  {a.severity === "critical"
                    ? "!"
                    : a.severity === "warning"
                      ? "⚠"
                      : "i"}
                </div>
                <div className="text-[var(--bp-text-secondary)] leading-relaxed">
                  {a.message}
                </div>
              </div>
            ))}
          </div>
        </ChartContent>
      </ChartCard>

      <ChartCard>
        <ChartHeader>
          <ChartTitle>Alert Rules</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Alert</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Source</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Condition</th>
                  <th className="text-left px-2.5 py-2 border-b border-[var(--bp-border-subtle)]">Severity</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Spread too wide", "All APIs", "Spread vs ref > 2%", "critical"],
                  ["Maker offline", "Bebop PMM", "PMM → JAM fallback", "critical"],
                  ["Depth degradation", "All APIs", "Max depth < threshold", "warning"],
                  ["Bid-ask blow-up", "CowSwap", "Spread > 5%", "warning"],
                  ["Fee change", "CowSwap", "Bps ≠ 2", "info"],
                ].map(([alert, source, condition, severity]) => (
                  <tr key={alert} className="hover:bg-[var(--bp-bg-hover)]">
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-primary)] border-b border-[rgba(22,45,74,0.5)]">
                      {alert}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {source}
                    </td>
                    <td className="px-2.5 py-1.5 text-[var(--bp-text-secondary)] border-b border-[rgba(22,45,74,0.5)]">
                      {condition}
                    </td>
                    <td
                      className={cn(
                        "px-2.5 py-1.5 border-b border-[rgba(22,45,74,0.5)]",
                        severity === "critical"
                          ? "text-red-400"
                          : severity === "warning"
                            ? "text-amber-400"
                            : "text-[var(--bp-text-muted)]"
                      )}
                    >
                      {(severity as string).charAt(0).toUpperCase() +
                        (severity as string).slice(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartContent>
      </ChartCard>
    </div>
  );
}

// ─── Historical Section ──────────────────────────────────────────────────────

const HIST_BAND_COLORS = {
  cow: { fill: "#22c55e", stroke: "#22c55e", opacity: 0.18 },
  beb: { fill: "#a78bfa", stroke: "#a78bfa", opacity: 0.18 },
  zx: { fill: "#38bdf8", stroke: "#38bdf8", opacity: 0.18 },
  inch: { fill: "#f59e0b", stroke: "#f59e0b", opacity: 0.18 },
  jupz: { fill: "#ec4899", stroke: "#ec4899", opacity: 0.18 },
};

// ─── Historical Bands CSV export ────────────────────────────────────────────

const HIST_CSV_DAYS = 7;
const HIST_CSV_NOTIONAL = 10_000;

interface HistCsvVenueInput {
  venue: string;
  points: Array<{
    timestamp: Date;
    midPrice: number;
    tiers: Map<number, { bidPrice: number; askPrice: number }>;
  }>;
}

function csvEscapeHist(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildHistoricalBandsCsv({
  asset,
  windowStart,
  windowEnd,
  venues,
  notional,
}: {
  asset: string;
  windowStart: Date;
  windowEnd: Date;
  venues: HistCsvVenueInput[];
  notional: number;
}): string {
  const headers = [
    "asset",
    "venue",
    "timestamp_utc",
    "notional_usd",
    "mid_price",
    "bid_price",
    "ask_price",
  ];
  const lines: string[] = [headers.join(",")];
  const fmtNum = (n: number) => (n > 0 && Number.isFinite(n) ? n.toString() : "");
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  type Row = {
    venue: string;
    ts: number;
    mid: number;
    bid: number;
    ask: number;
  };
  const rows: Row[] = [];
  for (const v of venues) {
    for (const pt of v.points) {
      const ts = pt.timestamp.getTime();
      if (ts < startMs || ts > endMs) continue;
      const tier = pt.tiers.get(notional);
      rows.push({
        venue: v.venue,
        ts,
        mid: pt.midPrice,
        bid: tier?.bidPrice ?? 0,
        ask: tier?.askPrice ?? 0,
      });
    }
  }
  rows.sort((a, b) => (a.ts - b.ts) || a.venue.localeCompare(b.venue));

  for (const r of rows) {
    const row = [
      asset,
      r.venue,
      new Date(r.ts).toISOString(),
      notional,
      fmtNum(r.mid),
      fmtNum(r.bid),
      fmtNum(r.ask),
    ];
    lines.push(row.map(csvEscapeHist).join(","));
  }
  return lines.join("\n");
}

function downloadHistoricalCsv(filename: string, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function findPoolForAsset(asset: string): { poolKey: string; token0Decimals: number; token1Decimals: number } | null {
  for (const [poolKey, meta] of Object.entries(SOLANA_POOL_METADATA_BY_ADDRESS)) {
    if (meta.token0Symbol.toLowerCase() === asset.toLowerCase()) {
      return { poolKey, token0Decimals: meta.token0Decimals, token1Decimals: meta.token1Decimals };
    }
  }
  return null;
}

function HistoricalSection({ asset }: { asset: string }) {
  const cowHist = useCowswapRfqHistory(asset);
  const bebHist = useBebopRfqHistory(asset);
  const zxHist = useZeroXRfqHistory(asset);
  const inchHist = useOneInchRfqHistory(asset);
  const jupzHist = useJupzRfqHistory(asset);

  const allLoading = cowHist.isLoading && bebHist.isLoading && zxHist.isLoading && inchHist.isLoading && jupzHist.isLoading;
  const anyPoints = cowHist.points.length > 1 || bebHist.points.length > 1 || zxHist.points.length > 1 || inchHist.points.length > 1 || jupzHist.points.length > 1;

  if (allLoading) {
    return <ChartCardSkeleton />;
  }

  if (!anyPoints) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Historical Price Bands</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="w-full h-[200px] flex items-center justify-center">
            <p className="text-[11px] text-[var(--bp-text-muted)]">
              Not enough historical data yet
            </p>
          </div>
        </ChartContent>
      </ChartCard>
    );
  }

  return <HistoricalPriceBandsChart
    cowPoints={cowHist.points}
    bebPoints={bebHist.points}
    zxPoints={zxHist.points}
    inchPoints={inchHist.points}
    jupzPoints={jupzHist.points}
    asset={asset}
  />;
}

const TARGET_NOTIONAL = 10_000;

function HistoricalPriceBandsChart({
  cowPoints,
  bebPoints,
  zxPoints,
  inchPoints,
  jupzPoints,
  asset,
}: {
  cowPoints: CowswapHistoryPoint[];
  bebPoints: BebopHistoryPoint[];
  zxPoints: ZeroXHistoryPoint[];
  inchPoints: OneInchHistoryPoint[];
  jupzPoints: JupzHistoryPoint[];
  asset: string;
}) {
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const currentSpace = spaces.find((s) => s.id === currentSpaceId);
  const showCsvDownload = currentSpace?.slug === KRAKEN_SPACE_SLUG;

  const handleDownloadCsv = useCallback(() => {
    const end = new Date();
    const start = new Date(end.getTime() - HIST_CSV_DAYS * DAY_MS);
    const csv = buildHistoricalBandsCsv({
      asset,
      windowStart: start,
      windowEnd: end,
      notional: HIST_CSV_NOTIONAL,
      venues: [
        { venue: "0x", points: zxPoints },
        { venue: "JupZ", points: jupzPoints },
        { venue: "1inch", points: inchPoints },
        { venue: "Bebop", points: bebPoints },
        { venue: "CowSwap", points: cowPoints },
      ],
    });
    const stamp = (d: Date) => d.toISOString().slice(0, 10);
    downloadHistoricalCsv(
      `${asset}-historical-price-bands-${stamp(start)}_${stamp(end)}.csv`,
      csv
    );
  }, [asset, cowPoints, bebPoints, zxPoints, inchPoints, jupzPoints]);

  const [showPoolPrice, setShowPoolPrice] = useState(false);
  const [showKrakenXusd, setShowKrakenXusd] = useState(false);
  const [showKrakenSpv, setShowKrakenSpv] = useState(false);
  const [showFinnhub, setShowFinnhub] = useState(false);
  const [enabledEvents, setEnabledEvents] = useState<Set<string>>(new Set());
  const [eventsDropdownOpen, setEventsDropdownOpen] = useState(false);
  const eventsButtonRef = useRef<HTMLButtonElement>(null);

  // Zoom state
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; dataIndex: number } | null>(null);
  const [zoomRange, setZoomRange] = useState<{ isSelecting: boolean; startIndex: number | null; endIndex: number | null }>({ isSelecting: false, startIndex: null, endIndex: null });
  const [activeZoom, setActiveZoom] = useState<{ startIndex: number; endIndex: number } | null>(null);

  // Unified time range from all sources
  const timeRange = useMemo(() => {
    const allTs: number[] = [];
    for (const p of cowPoints) allTs.push(p.timestamp.getTime());
    for (const p of bebPoints) allTs.push(p.timestamp.getTime());
    for (const p of zxPoints) allTs.push(p.timestamp.getTime());
    for (const p of inchPoints) allTs.push(p.timestamp.getTime());
    for (const p of jupzPoints) allTs.push(p.timestamp.getTime());
    if (allTs.length < 2) return { start: new Date(), end: new Date(), days: 7 };
    const min = Math.min(...allTs);
    const max = Math.max(...allTs);
    return { start: new Date(min), end: new Date(max), days: Math.max(1, Math.ceil((max - min) / 86_400_000)) };
  }, [cowPoints, bebPoints, zxPoints, inchPoints, jupzPoints]);

  // Pool price overlay
  const poolInfo = useMemo(() => findPoolForAsset(asset), [asset]);
  const { data: candles } = usePoolCandles({
    poolAddress: poolInfo?.poolKey ?? "",
    interval: "5m",
    days: timeRange.days + 1,
    token0Decimals: poolInfo?.token0Decimals ?? 8,
    token1Decimals: poolInfo?.token1Decimals ?? 6,
    enabled: showPoolPrice && !!poolInfo,
  });

  const oracleLine = useMemo(() => {
    if (!showPoolPrice || !candles || candles.length === 0) return [];
    const startTs = timeRange.start.getTime();
    const endTs = timeRange.end.getTime();
    return candles
      .filter((c) => { const t = c.timestamp.getTime(); return t >= startTs && t <= endTs && c.close > 0; })
      .map((c) => ({ timestamp: c.timestamp, price: c.close }));
  }, [showPoolPrice, candles, timeRange]);

  // Kraken/Finnhub overlays
  const krakenXusdPair = useMemo(() => `${asset}USD`, [asset]);
  const krakenSpvPair = useMemo(() => {
    const base = asset.endsWith("x") ? asset.slice(0, -1) : asset;
    return `${base}SPVUSD`;
  }, [asset]);

  const krakenSince = useMemo(() => Math.floor(timeRange.start.getTime() / 1000), [timeRange]);
  const krakenEndTime = useMemo(() => Math.ceil(timeRange.end.getTime() / 1000), [timeRange]);

  const { data: krakenXusdCandles } = useQuery({
    queryKey: ["krakenOhlc", krakenXusdPair, 5, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({ pair: krakenXusdPair, interval: "5", since: String(krakenSince), endTime: String(krakenEndTime) });
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
      const params = new URLSearchParams({ pair: krakenSpvPair, interval: "5", since: String(krakenSince), endTime: String(krakenEndTime) });
      const res = await fetch(`/api/kraken-ohlc?${params}`);
      if (!res.ok) throw new Error(`Kraken API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showKrakenSpv && krakenSince > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const finnhubSymbol = useMemo(() => asset.endsWith("x") ? asset.slice(0, -1) : asset, [asset]);

  const { data: finnhubCandles } = useQuery({
    queryKey: ["finnhubCandles", finnhubSymbol, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({ symbol: finnhubSymbol, resolution: "5", from: String(krakenSince), to: String(krakenEndTime) });
      const res = await fetch(`/api/finnhub-candles?${params}`);
      if (!res.ok) throw new Error(`Finnhub API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showFinnhub && krakenSince > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const krakenXusdLine = useMemo(() => {
    if (!showKrakenXusd || !krakenXusdCandles || krakenXusdCandles.length === 0) return [];
    const startTs = timeRange.start.getTime();
    const endTs = timeRange.end.getTime();
    return krakenXusdCandles
      .filter((c) => { const t = c.timestamp * 1000; return t >= startTs && t <= endTs && c.close > 0; })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  }, [showKrakenXusd, krakenXusdCandles, timeRange]);

  const krakenSpvLine = useMemo(() => {
    if (!showKrakenSpv || !krakenSpvCandles || krakenSpvCandles.length === 0) return [];
    const startTs = timeRange.start.getTime();
    const endTs = timeRange.end.getTime();
    return krakenSpvCandles
      .filter((c) => { const t = c.timestamp * 1000; return t >= startTs && t <= endTs && c.close > 0; })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  }, [showKrakenSpv, krakenSpvCandles, timeRange]);

  const finnhubLine = useMemo(() => {
    if (!showFinnhub || !finnhubCandles || finnhubCandles.length === 0) return [];
    const startTs = timeRange.start.getTime();
    const endTs = timeRange.end.getTime();
    return finnhubCandles
      .filter((c) => { const t = c.timestamp * 1000; return t >= startTs && t <= endTs && c.close > 0; })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  }, [showFinnhub, finnhubCandles, timeRange]);

  // Chart setup
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const margin = { top: 16, right: 16, bottom: 40, left: 72 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  // Combine all mid price points for x-axis timeline
  const allMidPts = useMemo(() => {
    const pts: { timestamp: Date; midPrice: number; source: string }[] = [];
    for (const p of cowPoints) pts.push({ timestamp: p.timestamp, midPrice: p.midPrice, source: "cow" });
    for (const p of bebPoints) pts.push({ timestamp: p.timestamp, midPrice: p.midPrice, source: "beb" });
    for (const p of zxPoints) pts.push({ timestamp: p.timestamp, midPrice: p.midPrice, source: "zx" });
    for (const p of inchPoints) pts.push({ timestamp: p.timestamp, midPrice: p.midPrice, source: "inch" });
    for (const p of jupzPoints) pts.push({ timestamp: p.timestamp, midPrice: p.midPrice, source: "jupz" });
    pts.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return pts;
  }, [cowPoints, bebPoints, zxPoints, inchPoints, jupzPoints]);

  // Zoomed data: filter all point arrays by active zoom time range
  const zoomedData = useMemo(() => {
    if (!activeZoom || allMidPts.length === 0) {
      return { cowPts: cowPoints, bebPts: bebPoints, zxPts: zxPoints, inchPts: inchPoints, jupzPts: jupzPoints, start: timeRange.start, end: timeRange.end };
    }
    const si = Math.max(0, Math.min(activeZoom.startIndex, activeZoom.endIndex));
    const ei = Math.min(allMidPts.length - 1, Math.max(activeZoom.startIndex, activeZoom.endIndex));
    const startTs = allMidPts[si].timestamp.getTime();
    const endTs = allMidPts[ei].timestamp.getTime();
    const filterByTime = <T extends { timestamp: Date }>(pts: T[]) =>
      pts.filter((p) => { const t = p.timestamp.getTime(); return t >= startTs && t <= endTs; });
    return {
      cowPts: filterByTime(cowPoints),
      bebPts: filterByTime(bebPoints),
      zxPts: filterByTime(zxPoints),
      inchPts: filterByTime(inchPoints),
      jupzPts: filterByTime(jupzPoints),
      start: new Date(startTs),
      end: new Date(endTs),
    };
  }, [activeZoom, allMidPts, cowPoints, bebPoints, zxPoints, inchPoints, jupzPoints, timeRange]);

  // Visible mid points for hover (filtered by zoom)
  const visibleMidPts = useMemo(() => {
    if (!activeZoom) return allMidPts;
    const si = Math.max(0, Math.min(activeZoom.startIndex, activeZoom.endIndex));
    const ei = Math.min(allMidPts.length - 1, Math.max(activeZoom.startIndex, activeZoom.endIndex));
    return allMidPts.slice(si, ei + 1);
  }, [allMidPts, activeZoom]);

  const xScale = useMemo(
    () => scaleTime<number>({
      domain: [zoomedData.start, zoomedData.end],
      range: [0, innerW],
    }),
    [zoomedData, innerW]
  );

  // NYSE session event vertical lines
  const NYSE_EVENTS = [
    { label: "Early Pre-Mkt", hour: 4, minute: 0, color: "#818cf8" },
    { label: "Pre-Market", hour: 7, minute: 0, color: "#c084fc" },
    { label: "NYSE Open", hour: 9, minute: 30, color: "#4ade80" },
    { label: "NYSE Close", hour: 16, minute: 0, color: "#f87171" },
    { label: "After-Hrs Close", hour: 20, minute: 0, color: "#fbbf24" },
  ];

  const eventLines = useMemo(() => {
    if (enabledEvents.size === 0) return [];
    const startMs = zoomedData.start.getTime();
    const endMs = zoomedData.end.getTime();
    if (startMs >= endMs) return [];
    const lines: { x: number; label: string; color: string }[] = [];
    const activeEvents = NYSE_EVENTS.filter(e => enabledEvents.has(e.label));
    if (activeEvents.length === 0) return [];
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const d = new Date(startMs);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    const endDate = new Date(endMs);
    endDate.setDate(endDate.getDate() + 1);
    while (d <= endDate) {
      // Skip weekends (0 = Sunday, 6 = Saturday)
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        for (const evt of activeEvents) {
          const guess = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), evt.hour, evt.minute, 0));
          const parts = etFormatter.formatToParts(guess);
          const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? "0");
          const etHour = getPart("hour");
          const etMinute = getPart("minute");
          const etDay = getPart("day");
          const diffMinutes = (evt.hour * 60 + evt.minute) - (etHour * 60 + etMinute) + (d.getDate() - etDay) * 1440;
          const evtDate = new Date(guess.getTime() + diffMinutes * 60_000);
          const ts = evtDate.getTime();
          if (ts >= startMs && ts <= endMs) {
            const x = xScale(evtDate) ?? 0;
            lines.push({ x, label: evt.label, color: evt.color });
          }
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return lines;
  }, [enabledEvents, zoomedData, xScale]);

  const yDomain = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    const updateMinMax = (pts: Array<{ timestamp: Date; midPrice: number; tiers: Map<number, { bidPrice: number; askPrice: number }> }>) => {
      for (const pt of pts) {
        if (pt.midPrice > 0) {
          if (pt.midPrice < min) min = pt.midPrice;
          if (pt.midPrice > max) max = pt.midPrice;
        }
        const tier = pt.tiers.get(TARGET_NOTIONAL);
        if (tier) {
          if (tier.bidPrice > 0 && tier.bidPrice < min) min = tier.bidPrice;
          if (tier.bidPrice > 0 && tier.bidPrice > max) max = tier.bidPrice;
          if (tier.askPrice > 0 && tier.askPrice < min) min = tier.askPrice;
          if (tier.askPrice > 0 && tier.askPrice > max) max = tier.askPrice;
        }
      }
    };
    updateMinMax(zoomedData.cowPts);
    updateMinMax(zoomedData.bebPts);
    updateMinMax(zoomedData.zxPts);
    updateMinMax(zoomedData.inchPts);
    updateMinMax(zoomedData.jupzPts);
    const startTs = zoomedData.start.getTime();
    const endTs = zoomedData.end.getTime();
    const filterOverlay = (pts: Array<{ timestamp: Date; price: number }>) =>
      pts.filter((p) => { const t = p.timestamp.getTime(); return t >= startTs && t <= endTs && p.price > 0; });
    for (const p of filterOverlay(oracleLine)) { if (p.price < min) min = p.price; if (p.price > max) max = p.price; }
    for (const p of filterOverlay(krakenXusdLine)) { if (p.price < min) min = p.price; if (p.price > max) max = p.price; }
    for (const p of filterOverlay(krakenSpvLine)) { if (p.price < min) min = p.price; if (p.price > max) max = p.price; }
    for (const p of filterOverlay(finnhubLine)) { if (p.price < min) min = p.price; if (p.price > max) max = p.price; }
    if (!isFinite(min) || !isFinite(max) || min >= max) return [0, 1] as [number, number];

    // Pick a "nice" step sized to produce ~6 ticks, then round domain to
    // exact multiples of that step so axis labels align with the plot-area edges.
    const range = max - min;
    const targetStep = range / 6;
    const magnitude = Math.pow(10, Math.floor(Math.log10(targetStep)));
    const normalized = targetStep / magnitude;
    const niceFactor = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
    const step = niceFactor * magnitude;
    return [Math.floor(min / step) * step, Math.ceil(max / step) * step] as [number, number];
  }, [zoomedData, oracleLine, krakenXusdLine, krakenSpvLine, finnhubLine]);

  const yScale = useMemo(
    () => scaleLinear<number>({ domain: yDomain, range: [innerH, 0] }),
    [yDomain, innerH]
  );

  // Build band paths for each protocol at TARGET_NOTIONAL
  const buildBandPath = useMemo(() => {
    return (pts: Array<{ timestamp: Date; midPrice: number; tiers: Map<number, { bidPrice: number; askPrice: number }> }>) => {
      if (pts.length < 2) return null;
      const validPts: { x: number; midY: number; bidY: number; askY: number }[] = [];
      for (const pt of pts) {
        const tier = pt.tiers.get(TARGET_NOTIONAL);
        const bid = tier && tier.bidPrice > 0 ? tier.bidPrice : pt.midPrice;
        const ask = tier && tier.askPrice > 0 ? tier.askPrice : pt.midPrice;
        validPts.push({
          x: xScale(pt.timestamp) ?? 0,
          midY: yScale(pt.midPrice),
          bidY: yScale(bid),
          askY: yScale(ask),
        });
      }
      if (validPts.length < 2) return null;

      let buyPath = `M ${validPts[0].x} ${validPts[0].midY}`;
      for (const p of validPts) buyPath += ` L ${p.x} ${p.midY}`;
      for (let i = validPts.length - 1; i >= 0; i--) buyPath += ` L ${validPts[i].x} ${validPts[i].bidY}`;
      buyPath += " Z";

      let sellPath = `M ${validPts[0].x} ${validPts[0].askY}`;
      for (const p of validPts) sellPath += ` L ${p.x} ${p.askY}`;
      for (let i = validPts.length - 1; i >= 0; i--) sellPath += ` L ${validPts[i].x} ${validPts[i].midY}`;
      sellPath += " Z";

      return { buyPath, sellPath };
    };
  }, [xScale, yScale]);

  const cowPath = useMemo(() => buildBandPath(zoomedData.cowPts), [buildBandPath, zoomedData.cowPts]);
  const bebPath = useMemo(() => buildBandPath(zoomedData.bebPts), [buildBandPath, zoomedData.bebPts]);
  const zxPath = useMemo(() => buildBandPath(zoomedData.zxPts), [buildBandPath, zoomedData.zxPts]);
  const inchPath = useMemo(() => buildBandPath(zoomedData.inchPts), [buildBandPath, zoomedData.inchPts]);
  const jupzPath = useMemo(() => buildBandPath(zoomedData.jupzPts), [buildBandPath, zoomedData.jupzPts]);

  // Mid price lines
  const cowMidLine = useMemo(() => zoomedData.cowPts.map((p) => ({ timestamp: p.timestamp, price: p.midPrice })), [zoomedData.cowPts]);
  const bebMidLine = useMemo(() => zoomedData.bebPts.map((p) => ({ timestamp: p.timestamp, price: p.midPrice })), [zoomedData.bebPts]);
  const zxMidLine = useMemo(() => zoomedData.zxPts.map((p) => ({ timestamp: p.timestamp, price: p.midPrice })), [zoomedData.zxPts]);
  const inchMidLine = useMemo(() => zoomedData.inchPts.map((p) => ({ timestamp: p.timestamp, price: p.midPrice })), [zoomedData.inchPts]);
  const jupzMidLine = useMemo(() => zoomedData.jupzPts.map((p) => ({ timestamp: p.timestamp, price: p.midPrice })), [zoomedData.jupzPts]);

  // Hover tooltip
  const hoverInfo = useMemo(() => {
    if (hoverIdx == null || visibleMidPts.length === 0) return null;
    const idx = Math.max(0, Math.min(hoverIdx, visibleMidPts.length - 1));
    const pt = visibleMidPts[idx];
    const hoverTs = pt.timestamp.getTime();

    const findNearest = (pts: Array<{ timestamp: Date; midPrice: number; tiers: Map<number, { bidPrice: number; askPrice: number }> }>) => {
      if (pts.length === 0) return null;
      let best = pts[0];
      let bestDt = Math.abs(best.timestamp.getTime() - hoverTs);
      for (const p of pts) {
        const dt = Math.abs(p.timestamp.getTime() - hoverTs);
        if (dt < bestDt) { best = p; bestDt = dt; }
      }
      if (bestDt > 10 * 60 * 1000) return null; // too far
      return best;
    };

    const cowPt = findNearest(zoomedData.cowPts);
    const bebPt = findNearest(zoomedData.bebPts);
    const zxPt = findNearest(zoomedData.zxPts);
    const inchPt = findNearest(zoomedData.inchPts);
    const jupzPt = findNearest(zoomedData.jupzPts);

    return {
      x: xScale(pt.timestamp) ?? 0,
      timestamp: pt.timestamp,
      cow: cowPt ? { mid: cowPt.midPrice, bid: cowPt.tiers.get(TARGET_NOTIONAL)?.bidPrice ?? 0, ask: cowPt.tiers.get(TARGET_NOTIONAL)?.askPrice ?? 0 } : null,
      beb: bebPt ? { mid: bebPt.midPrice, bid: bebPt.tiers.get(TARGET_NOTIONAL)?.bidPrice ?? 0, ask: bebPt.tiers.get(TARGET_NOTIONAL)?.askPrice ?? 0 } : null,
      zx: zxPt ? { mid: zxPt.midPrice, bid: zxPt.tiers.get(TARGET_NOTIONAL)?.bidPrice ?? 0, ask: zxPt.tiers.get(TARGET_NOTIONAL)?.askPrice ?? 0 } : null,
      inch: inchPt ? { mid: inchPt.midPrice, bid: inchPt.tiers.get(TARGET_NOTIONAL)?.bidPrice ?? 0, ask: inchPt.tiers.get(TARGET_NOTIONAL)?.askPrice ?? 0 } : null,
      jupz: jupzPt ? { mid: jupzPt.midPrice, bid: jupzPt.tiers.get(TARGET_NOTIONAL)?.bidPrice ?? 0, ask: jupzPt.tiers.get(TARGET_NOTIONAL)?.askPrice ?? 0 } : null,
    };
  }, [hoverIdx, visibleMidPts, zoomedData, xScale]);

  const visibleTimeSpanMs = useMemo(() => {
    const span = zoomedData.end.getTime() - zoomedData.start.getTime();
    return Number.isFinite(span) ? Math.max(0, span) : 0;
  }, [zoomedData.end, zoomedData.start]);

  const formatTime = useCallback(
    (value: Date | number) => formatHistoricalAxisTick(value, visibleTimeSpanMs),
    [visibleTimeSpanMs]
  );

  const formatTooltipTime = useCallback(
    (value: Date | number) => formatHistoricalTooltipTime(value, visibleTimeSpanMs),
    [visibleTimeSpanMs]
  );

  // Zoom handlers
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (hoverIdx === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setContextMenu({
      visible: true,
      x: Math.min(x, width - 200),
      y: Math.min(y, height - 100),
      dataIndex: hoverIdx,
    });
  }, [hoverIdx, width, height]);

  const handleStartRangeSelect = useCallback(() => {
    if (contextMenu === null) return;
    let fullIndex = contextMenu.dataIndex;
    if (activeZoom) {
      const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
      fullIndex = zoomStart + contextMenu.dataIndex;
    }
    setZoomRange({ isSelecting: true, startIndex: fullIndex, endIndex: null });
  }, [contextMenu, activeZoom]);

  const handleChartClick = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if (zoomRange.isSelecting && zoomRange.startIndex !== null && hoverIdx !== null) {
      let fullEndIndex = hoverIdx;
      if (activeZoom) {
        const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
        fullEndIndex = zoomStart + hoverIdx;
      }
      setActiveZoom({ startIndex: zoomRange.startIndex, endIndex: fullEndIndex });
      setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
    }
  }, [zoomRange, hoverIdx, activeZoom]);

  const handleResetZoom = useCallback(() => {
    setActiveZoom(null);
    setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
  }, []);

  // Cancel range selection on Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && zoomRange.isSelecting) {
        setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [zoomRange.isSelecting]);

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Historical Price Bands</ChartTitle>
        <div className="flex items-center gap-3">
          {showCsvDownload && (
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="font-mono uppercase inline-flex items-center"
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.18em",
                padding: "5px 10px 6px",
                border: "1px solid var(--bp-border-subtle)",
                borderRadius: 1,
                background: "transparent",
                color: "var(--bp-text-primary)",
                cursor: "pointer",
                lineHeight: 1,
              }}
              title="Download past 7 days of bands and mid prices for 0x, JupZ, 1inch, Bebop, CowSwap as CSV"
            >
              Download CSV
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">Pool</span>
            <button
              type="button"
              onClick={() => setShowPoolPrice((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showPoolPrice ? "bg-orange-500 border-orange-500" : "bg-gray-300 border-gray-300"
              }`}
            >
              <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                showPoolPrice ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">Kraken xUSD</span>
            <button
              type="button"
              onClick={() => setShowKrakenXusd((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showKrakenXusd ? "bg-cyan-500 border-cyan-500" : "bg-gray-300 border-gray-300"
              }`}
            >
              <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                showKrakenXusd ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">Kraken SPV</span>
            <button
              type="button"
              onClick={() => setShowKrakenSpv((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showKrakenSpv ? "bg-violet-500 border-violet-500" : "bg-gray-300 border-gray-300"
              }`}
            >
              <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                showKrakenSpv ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--bp-text-muted)]">TradFi {finnhubSymbol}</span>
            <button
              type="button"
              onClick={() => setShowFinnhub((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showFinnhub ? "bg-emerald-500 border-emerald-500" : "bg-gray-300 border-gray-300"
              }`}
            >
              <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                showFinnhub ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>
          <div className="relative flex items-center gap-1.5">
            <button
              ref={eventsButtonRef}
              type="button"
              onClick={() => setEventsDropdownOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                enabledEvents.size > 0
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                  : "border-[var(--bp-border-subtle)] text-[var(--bp-text-muted)] hover:border-[var(--bp-text-muted)]"
              }`}
            >
              Events{enabledEvents.size > 0 ? ` (${enabledEvents.size})` : ""}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${eventsDropdownOpen ? "rotate-180" : ""}`}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {eventsDropdownOpen && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setEventsDropdownOpen(false)} />
                <div
                  className="fixed z-[9999] min-w-[200px] rounded-lg border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-primary)] shadow-xl py-1"
                  style={(() => {
                    const rect = eventsButtonRef.current?.getBoundingClientRect();
                    if (!rect) return {};
                    return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
                  })()}
                >
                  {NYSE_EVENTS.map((evt) => {
                    const checked = enabledEvents.has(evt.label);
                    return (
                      <button
                        key={evt.label}
                        type="button"
                        onClick={() => {
                          setEnabledEvents((prev) => {
                            const next = new Set(prev);
                            if (next.has(evt.label)) next.delete(evt.label);
                            else next.add(evt.label);
                            return next;
                          });
                        }}
                        className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bp-bg-secondary)] transition-colors"
                      >
                        <span
                          className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors ${
                            checked
                              ? "border-transparent"
                              : "border-[var(--bp-border-subtle)]"
                          }`}
                          style={checked ? { backgroundColor: evt.color } : undefined}
                        >
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          )}
                        </span>
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: evt.color }}
                        />
                        <span style={{ color: checked ? evt.color : "var(--bp-text-secondary)" }}>
                          {evt.label}
                        </span>
                        <span className="ml-auto text-[9px] text-[var(--bp-text-muted)]">
                          {String(evt.hour).padStart(2, "0")}:{String(evt.minute).padStart(2, "0")} ET
                        </span>
                      </button>
                    );
                  })}
                  <div className="border-t border-[var(--bp-border-subtle)] mt-1 pt-1 px-3 py-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEnabledEvents(new Set(NYSE_EVENTS.map(e => e.label)))}
                      className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setEnabledEvents(new Set())}
                      className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors"
                    >
                      None
                    </button>
                  </div>
                </div>
              </>,
              document.body
            )}
          </div>
        </div>
      </ChartHeader>
      <ChartContent style={{ height: 420 }}>
        <div className="flex h-full flex-col gap-2">
          <div
            ref={containerRef}
            className="w-full min-h-0 flex-1 relative"
            style={{ cursor: zoomRange.isSelecting ? "crosshair" : undefined, pointerEvents: eventsDropdownOpen ? "none" : undefined }}
            onContextMenu={handleContextMenu}
            onClick={handleChartClick}
          >
          {/* Range selection indicator */}
          {zoomRange.isSelecting && (
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2"
              style={{ background: "#14b8a6", color: "#fff", boxShadow: "0 2px 8px rgba(20, 184, 166, 0.4)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              Click to select end of range (Esc to cancel)
            </div>
          )}

          {/* Reset zoom button */}
          {activeZoom && !zoomRange.isSelecting && (
            <button
              className="absolute top-2 right-4 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-105"
              style={{
                background: "rgba(255,255,255,0.1)",
                color: "var(--bp-text-primary)",
                border: "1px solid var(--bp-border-subtle)",
              }}
              onClick={(e) => { e.stopPropagation(); handleResetZoom(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              Reset Zoom
            </button>
          )}

          {/* Range selection overlay */}
          {zoomRange.isSelecting && zoomRange.startIndex !== null && hoverIdx !== null && (() => {
            let displayStartIndex = zoomRange.startIndex;
            if (activeZoom) {
              const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
              displayStartIndex = zoomRange.startIndex - zoomStart;
            }
            const startPt = visibleMidPts[Math.max(0, Math.min(displayStartIndex, visibleMidPts.length - 1))];
            const endPt = visibleMidPts[Math.max(0, Math.min(hoverIdx, visibleMidPts.length - 1))];
            if (!startPt || !endPt) return null;
            const startX = (xScale(startPt.timestamp) ?? 0) + margin.left;
            const endX = (xScale(endPt.timestamp) ?? 0) + margin.left;
            const left = Math.min(startX, endX);
            const selectionWidth = Math.abs(endX - startX);
            return (
              <div
                className="absolute pointer-events-none"
                style={{
                  left,
                  top: margin.top,
                  width: Math.max(2, selectionWidth),
                  height: innerH,
                  background: "rgba(20, 184, 166, 0.12)",
                  borderLeft: "2px solid #14b8a6",
                  borderRight: "2px solid #14b8a6",
                }}
              />
            );
          })()}

          {width > 0 && innerH > 0 && (
            <svg width={width} height={height}>
              <defs>
                <clipPath id="hist-band-clip">
                  <rect x={0} y={0} width={innerW} height={innerH} />
                </clipPath>
              </defs>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={6}
                />

                <g clipPath="url(#hist-band-clip)">
                {/* NYSE event vertical lines */}
                {enabledEvents.size > 0 && eventLines.map((evt, i) => (
                  <g key={`evt-${i}`}>
                    <line
                      x1={evt.x} x2={evt.x} y1={0} y2={innerH}
                      stroke={evt.color} strokeWidth={1} strokeDasharray="4,4" opacity={0.5}
                    />
                    <text
                      x={evt.x + 4} y={12}
                      fill={evt.color} fontSize={9} fontFamily="inherit" fontWeight={600}
                      opacity={0.85}
                    >
                      {evt.label}
                    </text>
                  </g>
                ))}

                {/* COW band */}
                {cowPath && (
                  <g>
                    <path d={cowPath.buyPath} fill={HIST_BAND_COLORS.cow.fill} fillOpacity={HIST_BAND_COLORS.cow.opacity} stroke={HIST_BAND_COLORS.cow.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                    <path d={cowPath.sellPath} fill={HIST_BAND_COLORS.cow.fill} fillOpacity={HIST_BAND_COLORS.cow.opacity} stroke={HIST_BAND_COLORS.cow.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                  </g>
                )}
                {/* Bebop band */}
                {bebPath && (
                  <g>
                    <path d={bebPath.buyPath} fill={HIST_BAND_COLORS.beb.fill} fillOpacity={HIST_BAND_COLORS.beb.opacity} stroke={HIST_BAND_COLORS.beb.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                    <path d={bebPath.sellPath} fill={HIST_BAND_COLORS.beb.fill} fillOpacity={HIST_BAND_COLORS.beb.opacity} stroke={HIST_BAND_COLORS.beb.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                  </g>
                )}
                {/* 0x band */}
                {zxPath && (
                  <g>
                    <path d={zxPath.buyPath} fill={HIST_BAND_COLORS.zx.fill} fillOpacity={HIST_BAND_COLORS.zx.opacity} stroke={HIST_BAND_COLORS.zx.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                    <path d={zxPath.sellPath} fill={HIST_BAND_COLORS.zx.fill} fillOpacity={HIST_BAND_COLORS.zx.opacity} stroke={HIST_BAND_COLORS.zx.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                  </g>
                )}
                {/* 1inch band */}
                {inchPath && (
                  <g>
                    <path d={inchPath.buyPath} fill={HIST_BAND_COLORS.inch.fill} fillOpacity={HIST_BAND_COLORS.inch.opacity} stroke={HIST_BAND_COLORS.inch.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                    <path d={inchPath.sellPath} fill={HIST_BAND_COLORS.inch.fill} fillOpacity={HIST_BAND_COLORS.inch.opacity} stroke={HIST_BAND_COLORS.inch.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                  </g>
                )}
                {/* JupZ band */}
                {jupzPath && (
                  <g>
                    <path d={jupzPath.buyPath} fill={HIST_BAND_COLORS.jupz.fill} fillOpacity={HIST_BAND_COLORS.jupz.opacity} stroke={HIST_BAND_COLORS.jupz.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                    <path d={jupzPath.sellPath} fill={HIST_BAND_COLORS.jupz.fill} fillOpacity={HIST_BAND_COLORS.jupz.opacity} stroke={HIST_BAND_COLORS.jupz.stroke} strokeOpacity={0.4} strokeWidth={0.5} />
                  </g>
                )}

                {/* Mid price lines */}
                {cowMidLine.length > 1 && (
                  <LinePath
                    data={cowMidLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#22c55e"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                    curve={curveMonotoneX}
                  />
                )}
                {bebMidLine.length > 1 && (
                  <LinePath
                    data={bebMidLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#a78bfa"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                    curve={curveMonotoneX}
                  />
                )}
                {zxMidLine.length > 1 && (
                  <LinePath
                    data={zxMidLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#38bdf8"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                    curve={curveMonotoneX}
                  />
                )}
                {inchMidLine.length > 1 && (
                  <LinePath
                    data={inchMidLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                    curve={curveMonotoneX}
                  />
                )}
                {jupzMidLine.length > 1 && (
                  <LinePath
                    data={jupzMidLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#ec4899"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                    curve={curveMonotoneX}
                  />
                )}

                {/* Oracle/external price overlays */}
                {showPoolPrice && oracleLine.length > 1 && (
                  <LinePath
                    data={oracleLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                    curve={curveMonotoneX}
                  />
                )}
                {showKrakenXusd && krakenXusdLine.length > 1 && (
                  <LinePath
                    data={krakenXusdLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                    curve={curveMonotoneX}
                  />
                )}
                {showKrakenSpv && krakenSpvLine.length > 1 && (
                  <LinePath
                    data={krakenSpvLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#8b5cf6"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                    curve={curveMonotoneX}
                  />
                )}
                {showFinnhub && finnhubLine.length > 1 && (
                  <LinePath
                    data={finnhubLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    stroke="#10b981"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                    curve={curveMonotoneX}
                  />
                )}

                {/* Hover crosshair */}
                {hoverInfo && !eventsDropdownOpen && (
                  <line x1={hoverInfo.x} x2={hoverInfo.x} y1={0} y2={innerH}
                    stroke="var(--bp-text-muted)" strokeWidth={1} strokeDasharray="3,3" pointerEvents="none" />
                )}

                {/* Invisible hover columns */}
                {visibleMidPts.length > 0 && (() => {
                  const colW = innerW / visibleMidPts.length;
                  return visibleMidPts.map((_, i) => (
                    <rect
                      key={i}
                      x={i * colW}
                      y={0}
                      width={colW}
                      height={innerH}
                      fill="transparent"
                      style={{ cursor: zoomRange.isSelecting ? "crosshair" : "crosshair" }}
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseMove={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                    />
                  ));
                })()}
                </g>

                <AxisBottom
                  scale={xScale}
                  top={innerH}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="var(--bp-border-subtle)"
                  tickLabelProps={() => ({
                    fill: "var(--bp-text-muted)",
                    fontSize: 9,
                    fontFamily: "IBM Plex Mono",
                    textAnchor: "middle" as const,
                  })}
                  tickFormat={(v) => formatTime(v as Date)}
                  numTicks={8}
                />
                <AxisLeft
                  scale={yScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="var(--bp-border-subtle)"
                  tickLabelProps={() => ({
                    fill: "var(--bp-text-muted)",
                    fontSize: 9,
                    fontFamily: "IBM Plex Mono",
                    textAnchor: "end" as const,
                    dx: -4,
                  })}
                  tickFormat={(v) => `$${fmt(v as number)}`}
                  numTicks={6}
                />
              </Group>
            </svg>
          )}

          {/* Tooltip */}
          {hoverInfo && !eventsDropdownOpen && (() => {
            const rows = [
              hoverInfo.cow ? { label: "COW", color: "#22c55e", ...hoverInfo.cow } : null,
              hoverInfo.beb ? { label: "BEB", color: "#a78bfa", ...hoverInfo.beb } : null,
              hoverInfo.zx ? { label: "0x", color: "#38bdf8", ...hoverInfo.zx } : null,
              hoverInfo.inch ? { label: "1inch", color: "#f59e0b", ...hoverInfo.inch } : null,
              hoverInfo.jupz ? { label: "JupZ", color: "#ec4899", ...hoverInfo.jupz } : null,
            ].filter(Boolean) as { label: string; color: string; mid: number; bid: number; ask: number }[];
            if (rows.length === 0) return null;
            const tooltipW = 300;
            const pixelX = hoverInfo.x + margin.left;
            const nearRight = pixelX + tooltipW / 2 > width - 8;
            const nearLeft = pixelX - tooltipW / 2 < 8;
            return (
              <div
                className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2.5 shadow-lg text-[11px] font-mono z-10"
                style={{
                  left: pixelX,
                  top: margin.top + 8,
                  transform: nearRight
                    ? "translateX(-100%)"
                    : nearLeft
                      ? "translateX(0)"
                      : "translateX(-50%)",
                  width: tooltipW,
                }}
              >
                <div className="text-[var(--bp-text-muted)] mb-2 font-semibold text-center">
                  {formatTooltipTime(hoverInfo.timestamp)} · $10K
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[9px] text-[var(--bp-text-muted)] uppercase tracking-wider">
                      <th className="text-left pr-3 pb-1"></th>
                      <th className="text-right pr-3 pb-1">Buy</th>
                      <th className="text-right pr-3 pb-1">Sell</th>
                      <th className="text-right pb-1">Mid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.label}>
                        <td className="pr-3 py-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color }} />
                            <span className="text-[var(--bp-text-secondary)]">{r.label}</span>
                          </div>
                        </td>
                        <td className="text-right pr-3 py-0.5 text-emerald-400">
                          {r.bid > 0 ? `$${fmt(r.bid, 2)}` : "—"}
                        </td>
                        <td className="text-right pr-3 py-0.5 text-red-400">
                          {r.ask > 0 ? `$${fmt(r.ask, 2)}` : "—"}
                        </td>
                        <td className="text-right py-0.5 text-[var(--bp-text-primary)] font-semibold">
                          ${fmt(r.mid, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

            {/* Context menu */}
            {contextMenu?.visible && (
              <HistZoomContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                hasZoom={!!activeZoom}
                onZoomToRange={() => { handleStartRangeSelect(); setContextMenu(null); }}
                onResetZoom={() => { handleResetZoom(); setContextMenu(null); }}
                onClose={() => setContextMenu(null)}
              />
            )}
          </div>

          {/* Legend */}
          <div className="flex shrink-0 items-center gap-4 px-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
              <span className="text-[10px] text-[var(--bp-text-muted)]">COW $10K</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: "#a78bfa" }} />
              <span className="text-[10px] text-[var(--bp-text-muted)]">BEB $10K</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: "#38bdf8" }} />
              <span className="text-[10px] text-[var(--bp-text-muted)]">0x $10K</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: "#f59e0b" }} />
              <span className="text-[10px] text-[var(--bp-text-muted)]">1inch $10K</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-1.5 rounded-full" style={{ background: "#ec4899" }} />
              <span className="text-[10px] text-[var(--bp-text-muted)]">JupZ $10K</span>
            </div>
            {showPoolPrice && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 border-t border-dashed" style={{ borderColor: "#f97316" }} />
                <span className="text-[10px] text-[var(--bp-text-muted)]">Pool</span>
              </div>
            )}
            {showKrakenXusd && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 border-t border-dashed" style={{ borderColor: "#06b6d4" }} />
                <span className="text-[10px] text-[var(--bp-text-muted)]">Kraken xUSD</span>
              </div>
            )}
            {showKrakenSpv && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 border-t border-dashed" style={{ borderColor: "#8b5cf6" }} />
                <span className="text-[10px] text-[var(--bp-text-muted)]">Kraken SPV</span>
              </div>
            )}
            {showFinnhub && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 border-t border-dashed" style={{ borderColor: "#10b981" }} />
                <span className="text-[10px] text-[var(--bp-text-muted)]">TradFi</span>
              </div>
            )}
          </div>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

function HistZoomContextMenu({
  x, y, hasZoom, onZoomToRange, onResetZoom, onClose,
}: {
  x: number; y: number; hasZoom: boolean;
  onZoomToRange: () => void; onResetZoom: () => void; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const btnClass = "w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2 text-[var(--bp-text-primary)]";
  const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; };
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; };

  return (
    <div
      ref={menuRef}
      className="absolute z-50 min-w-[180px] rounded-lg border border-[var(--bp-border-subtle)] shadow-lg backdrop-blur-sm overflow-hidden"
      style={{ left: x, top: y, background: "rgba(15, 23, 42, 0.95)" }}
    >
      <button className={btnClass} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={onZoomToRange}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
        Zoom to Range
      </button>
      {hasZoom && (
        <>
          <div className="h-px bg-[var(--bp-border-subtle)]" />
          <button className={btnClass} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={onResetZoom}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            Reset Zoom
          </button>
        </>
      )}
    </div>
  );
}

function extractBand(
  points: Array<{ timestamp: Date; midPrice: number; tiers: Map<number, { bidPrice: number; askPrice: number }> }>,
  notional: number
) {
  return points.map((p) => {
    const tier = p.tiers.get(notional);
    return {
      timestamp: p.timestamp,
      midPrice: p.midPrice,
      bidPrice: tier?.bidPrice ?? p.midPrice,
      askPrice: tier?.askPrice ?? p.midPrice,
    };
  });
}

// ─── Shared Components ──────────────────────────────────────────────────────

function tierStatus(
  ref: number,
  price: number
): "tight" | "degraded" | "dead" {
  if (!ref || !price || price > 1e6) return "dead";
  const impact = Math.abs(price - ref) / ref;
  if (impact < 0.015) return "tight";
  if (impact < 0.05) return "degraded";
  return "dead";
}

function StatusBadge({ status }: { status: "tight" | "degraded" | "dead" }) {
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
        status === "tight" &&
          "bg-emerald-500/15 text-emerald-400",
        status === "degraded" &&
          "bg-amber-500/15 text-amber-400",
        status === "dead" && "bg-red-500/15 text-red-400"
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}
