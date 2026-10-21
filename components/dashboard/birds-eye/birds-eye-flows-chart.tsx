"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Area, Bar, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";

type CumulativeMode = "none" | "volume" | "net";

function getYAxisLabel(mode: CumulativeMode): string {
  if (mode === "volume") return "CUMULATIVE VOLUME (USD)";
  if (mode === "net") return "CUMULATIVE NET TO USERS (USD)";
  return "NET USD TO USERS";
}
import {
  ChartCard,
  ChartContent,
  ChartFoot,
  ChartHeader,
  ChartTitle,
} from "@/components/dashboard/chart-card";
import { cn } from "@/lib/utils";
import { useBirdsEyeFlows } from "@/hooks/use-birds-eye-flows";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import {
  type NetFlowChartData,
  type NetFlowDay,
  type NetFlowSeriesTotal,
} from "@/lib/xstocks-net-flow";

const CUMULATIVE_LINE_COLOR = "#0f172a";

type WindowOption = { id: "all" | "30d" | "90d" | "365d"; label: string; warning?: string };
const WINDOW_OPTIONS: WindowOption[] = [
  { id: "all", label: "All" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "365d", label: "365D" },
];
const DEFAULT_WINDOW: WindowOption["id"] = "all";

function formatUsdSigned(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  const sign = value < 0 ? "-" : "+";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatUsdAxis(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function getFlowSourceLabel(series: NetFlowSeriesTotal, isDemo: boolean): string {
  if (isDemo && series.source === "rfq-flowdesk") return "RFQ · MM A";
  return series.label;
}

function getFlowSourceShortLabel(series: NetFlowSeriesTotal, isDemo: boolean): string {
  if (isDemo && series.source === "rfq-flowdesk") return "MM A RFQ";
  return series.shortLabel;
}

function CumulativeSwitch({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className="flex items-center gap-2 cursor-pointer group"
      title={active ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
    >
      <span
        className="font-mono uppercase tracking-[0.14em]"
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: active ? "var(--ts-ink-0)" : "var(--ts-ink-3)",
        }}
      >
        {label}
      </span>
      <span
        aria-hidden
        className="relative inline-flex shrink-0 transition-colors"
        style={{
          width: 26,
          height: 14,
          borderRadius: 10,
          border: "1px solid var(--ts-line-hard)",
          background: active ? "var(--ts-ink-0)" : "var(--ts-surface)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        <span
          className="absolute rounded-full transition-all duration-150 ease-out"
          style={{
            top: 1,
            left: active ? 13 : 1,
            width: 10,
            height: 10,
            background: active ? "var(--ts-ink-inv)" : "var(--ts-ink-2)",
          }}
        />
      </span>
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="text-[11px] font-mono text-[var(--bp-text-muted)]">
        {children}
      </span>
    </div>
  );
}

interface FlowsBarsProps {
  data: NetFlowChartData;
  mode: CumulativeMode;
  width: number;
  height: number;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

interface StackBand {
  source: string;
  y0: number;
  y1: number;
  value: number;
}

function computeStackBands(
  day: NetFlowDay,
  mode: Exclude<CumulativeMode, "none">,
  seriesOrder: NetFlowSeriesTotal["source"][]
): StackBand[] {
  const out: StackBand[] = [];
  let pos = 0;
  let neg = 0;
  const valuesBySource =
    mode === "volume" ? day.cumulativeVolumeBySource : day.cumulativeBySource;
  for (const source of seriesOrder) {
    const value = valuesBySource[source] ?? 0;
    if (value >= 0) {
      out.push({ source, y0: pos, y1: pos + value, value });
      pos += value;
    } else {
      out.push({ source, y0: neg, y1: neg + value, value });
      neg += value;
    }
  }
  return out;
}

function FlowsBars({
  data,
  mode,
  width,
  height,
  hoverIndex,
  onHover,
}: FlowsBarsProps) {
  const margin = { top: 18, right: 44, bottom: 38, left: 70 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(() => {
    // Tighter padding when there are many days, so individual bars don't shrink
    // to invisible widths over long windows.
    const padding = data.days.length > 80 ? 0.1 : data.days.length > 40 ? 0.16 : 0.24;
    return scaleBand<string>({
      domain: data.days.map((d) => d.day),
      range: [0, innerW],
      padding,
    });
  }, [data.days, innerW]);
  const seriesOrder = useMemo(() => data.series.map((series) => series.source), [data.series]);
  const seriesBySource = useMemo(
    () => new Map(data.series.map((series) => [series.source, series])),
    [data.series]
  );

  const { yMin, yMax } = useMemo(() => {
    if (mode === "none") {
      let positive = 0;
      let negative = 0;
      for (const day of data.days) {
        let pos = 0;
        let neg = 0;
        for (const source of seriesOrder) {
          const v = day.bySource[source];
          if (v > 0) pos += v;
          else if (v < 0) neg += v;
        }
        if (pos > positive) positive = pos;
        if (neg < negative) negative = neg;
      }
      const span = Math.max(positive - negative, 1);
      const pad = span * 0.1;
      return { yMin: negative - pad, yMax: positive + pad };
    }
    let maxPos = 0;
    let minNeg = 0;
    for (const day of data.days) {
      const valuesBySource =
        mode === "volume" ? day.cumulativeVolumeBySource : day.cumulativeBySource;
      let pos = 0;
      let neg = 0;
      for (const source of seriesOrder) {
        const v = valuesBySource[source] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (pos > maxPos) maxPos = pos;
      if (neg < minNeg) minNeg = neg;
    }
    const span = Math.max(maxPos - minNeg, 1);
    const pad = span * 0.08;
    return { yMin: minNeg - pad, yMax: maxPos + pad };
  }, [data.days, seriesOrder, mode]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [yMin, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [innerH, yMin, yMax]
  );

  const zeroY = yScale(0);

  const cumulativeLinePoints = useMemo(() => {
    if (mode === "none") return [] as { day: string; total: number }[];
    return data.days.map((d) => ({
      day: d.day,
      total: mode === "volume" ? d.cumulativeVolumeUsd : d.cumulativeUsd,
    }));
  }, [data.days, mode]);

  const stackBandsByDay = useMemo(() => {
    if (mode === "none") return null;
    const map = new Map<string, StackBand[]>();
    for (const day of data.days) {
      map.set(day.day, computeStackBands(day, mode, seriesOrder));
    }
    return map;
  }, [data.days, mode, seriesOrder]);

  const stackedAreasBySource = useMemo(() => {
    if (!stackBandsByDay) return null;
    return seriesOrder.map((source) => {
      const meta = seriesBySource.get(source);
      const points = data.days.map((day) => {
        const bands = stackBandsByDay.get(day.day) ?? [];
        const band = bands.find((b) => b.source === source);
        return {
          day: day.day,
          y0: band?.y0 ?? 0,
          y1: band?.y1 ?? 0,
        };
      });
      return { source, color: meta?.color ?? "#999", points };
    });
  }, [stackBandsByDay, seriesOrder, seriesBySource, data.days]);

  return (
    <svg width={width} height={height}>
      <Group left={margin.left} top={margin.top}>
        <GridRows
          scale={yScale}
          width={innerW}
          numTicks={5}
          stroke="var(--bp-border-subtle)"
          strokeDasharray="2,2"
          strokeOpacity={0.5}
        />
        {/* Zero line */}
        <line
          x1={0}
          x2={innerW}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--bp-border-secondary)"
          strokeWidth={1}
          strokeOpacity={0.85}
        />
        {mode === "none" &&
          data.days.map((day, dayIndex) => {
            const x = xScale(day.day) ?? 0;
            const barWidth = xScale.bandwidth();
            let posCursor = 0;
            let negCursor = 0;
            const isHovered = hoverIndex === dayIndex;
            const dim = hoverIndex !== null && !isHovered;
            return (
              <g key={day.day}>
                {seriesOrder.map((source) => {
                  const value = day.bySource[source];
                  if (!value) return null;
                  const meta = seriesBySource.get(source);
                  if (!meta) return null;
                  if (value > 0) {
                    const y0 = yScale(posCursor);
                    posCursor += value;
                    const y1 = yScale(posCursor);
                    return (
                      <Bar
                        key={`${day.day}-${source}-pos`}
                        x={x}
                        y={y1}
                        width={barWidth}
                        height={Math.max(0, y0 - y1)}
                        fill={meta.color}
                        opacity={dim ? 0.34 : 0.92}
                      />
                    );
                  }
                  const y0 = yScale(negCursor);
                  negCursor += value;
                  const y1 = yScale(negCursor);
                  return (
                    <Bar
                      key={`${day.day}-${source}-neg`}
                      x={x}
                      y={y0}
                      width={barWidth}
                      height={Math.max(0, y1 - y0)}
                      fill={meta.color}
                      opacity={dim ? 0.18 : 0.5}
                    />
                  );
                })}
              </g>
            );
          })}
        {mode !== "none" && stackedAreasBySource && (
          <g style={{ pointerEvents: "none" }}>
            {stackedAreasBySource.map(({ source, color, points }) => (
              <Area<{ day: string; y0: number; y1: number }>
                key={source}
                data={points}
                x={(p) => (xScale(p.day) ?? 0) + xScale.bandwidth() / 2}
                y0={(p) => yScale(p.y0)}
                y1={(p) => yScale(p.y1)}
                fill={color}
                fillOpacity={0.72}
                stroke={color}
                strokeWidth={0.4}
                strokeOpacity={0.4}
                curve={curveMonotoneX}
              />
            ))}
          </g>
        )}
        {mode !== "none" && cumulativeLinePoints.length > 0 && (
          <g style={{ pointerEvents: "none" }}>
            <LinePath<{ day: string; total: number }>
              data={cumulativeLinePoints}
              x={(p) => (xScale(p.day) ?? 0) + xScale.bandwidth() / 2}
              y={(p) => yScale(p.total)}
              stroke={CUMULATIVE_LINE_COLOR}
              strokeWidth={1.75}
              strokeOpacity={0.92}
              curve={curveMonotoneX}
            />
            {cumulativeLinePoints.map((p) => (
              <circle
                key={p.day}
                cx={(xScale(p.day) ?? 0) + xScale.bandwidth() / 2}
                cy={yScale(p.total)}
                r={2.25}
                fill={CUMULATIVE_LINE_COLOR}
                stroke="white"
                strokeWidth={1}
              />
            ))}
          </g>
        )}
        <AxisLeft
          scale={yScale}
          numTicks={5}
          tickFormat={(value) => formatUsdAxis(value as number)}
          stroke="var(--bp-border-subtle)"
          tickStroke="var(--bp-border-subtle)"
          tickLabelProps={() => ({
            fill: "var(--bp-text-muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            textAnchor: "end",
            dx: "-0.35em",
            dy: "0.32em",
          })}
          label={getYAxisLabel(mode)}
          labelOffset={48}
          labelProps={{
            fill: "var(--bp-text-muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            textAnchor: "middle",
            letterSpacing: "0.14em",
            fontWeight: 700,
          }}
        />
        <AxisBottom
          top={innerH}
          scale={xScale}
          tickFormat={(day) => data.days.find((d) => d.day === day)?.label ?? day}
          stroke="var(--bp-border-subtle)"
          tickStroke="var(--bp-border-subtle)"
          numTicks={Math.min(data.days.length, 8)}
          tickLabelProps={() => ({
            fill: "var(--bp-text-muted)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            textAnchor: "middle",
            dy: "0.35em",
          })}
        />
        <rect
          x={0}
          y={-margin.top}
          width={innerW}
          height={margin.top + innerH + margin.bottom}
          fill="transparent"
          onMouseMove={(e) => {
            if (data.days.length === 0) return;
            const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const step = xScale.step();
            if (step <= 0) return;
            const idx = Math.max(
              0,
              Math.min(data.days.length - 1, Math.floor(cursorX / step))
            );
            onHover(idx);
          }}
          onMouseLeave={() => onHover(null)}
        />
      </Group>
    </svg>
  );
}

export function BirdsEyeFlowsChart({
  spaceSlug,
  enabled = true,
}: {
  spaceSlug?: string;
  enabled?: boolean;
}) {
  const [windowId, setWindowId] = useState<WindowOption["id"]>(DEFAULT_WINDOW);
  const activeWindow =
    WINDOW_OPTIONS.find((w) => w.id === windowId) ?? WINDOW_OPTIONS[0];

  const {
    data,
    isLoading,
    isFetching,
    isPoolPending,
    isError,
    isConfigured,
    rfqError,
    poolError,
    poolMeta,
    flowToUsersError,
  } = useBirdsEyeFlows({
    spaceSlug,
    range: activeWindow.id,
    enabled,
  });

  const [mode, setMode] = useState<CumulativeMode>("volume");
  const isDemo = isDemoSpaceSlug(spaceSlug);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (isFetching) {
      setLoadStartedAt(Date.now());
      setElapsedMs(0);
    } else {
      setLoadStartedAt(null);
    }
  }, [isFetching, activeWindow.id]);

  useEffect(() => {
    if (!loadStartedAt) return;
    const t = window.setInterval(() => {
      setElapsedMs(Date.now() - loadStartedAt);
    }, 500);
    return () => window.clearInterval(t);
  }, [loadStartedAt]);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setDimensions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const isPoolSourceUnavailable = isDemo && !poolMeta && (isPoolPending || Boolean(poolError));
  const chartData = isPoolSourceUnavailable ? null : data;
  const hasData = Boolean(chartData && chartData.days.length > 0);
  const hoveredDay: NetFlowDay | null =
    hasData && hoverIndex !== null ? chartData?.days[hoverIndex] ?? null : null;

  const dayCount = chartData?.days.length ?? 0;
  const refreshingSuffix =
    isFetching && chartData && elapsedMs > 1500
      ? ` · ${isPoolPending ? "pools loading" : "refreshing"} ${Math.floor(elapsedMs / 1000)}s`
      : "";
  const metaText = chartData
    ? `${dayCount} buckets · Net to users ${formatUsdSigned(chartData.totals.netUsd)} · Users acquired $${(chartData.totals.sellUsd / 1_000_000).toFixed(2)}M · Returned $${(chartData.totals.buyUsd / 1_000_000).toFixed(2)}M${refreshingSuffix}`
    : isPoolSourceUnavailable
      ? poolError
        ? `Pool source unavailable · ${poolError.message}`
        : "Loading pool flow from Timescale"
    : isDemo
      ? "Net token flow into user wallets across AMM pools and RFQ"
      : flowToUsersError
        ? `Dune flow unavailable · ${flowToUsersError.message}`
        : "Net xStock flow into user wallets from Dune";

  const totalsAreZero = chartData
    ? chartData.totals.buyUsd === 0 && chartData.totals.sellUsd === 0
    : false;

  return (
    <ChartCard className="w-full min-w-0">
      <ChartHeader className="min-w-0">
        <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3">
          <ChartTitle meta={metaText} className="min-w-0 flex-1 flex-wrap">
            {isDemo ? "Token Flow to Users" : "xStocks Flow to Users"}
          </ChartTitle>
          <div className="flex min-w-0 basis-full flex-wrap items-center justify-end gap-3 xl:basis-auto">
            <div className="flex items-center gap-1 bg-gray-100/70 dark:bg-gray-800/50 rounded-md p-0.5">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setWindowId(opt.id)}
                  className={cn(
                    "cursor-pointer px-2 py-1 text-[10px] font-bold rounded transition-all duration-150",
                    windowId === opt.id
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  )}
                  title={opt.warning}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          <CumulativeSwitch
            label="Cumulative volume"
            active={mode === "volume"}
            onClick={() => setMode((m) => (m === "volume" ? "none" : "volume"))}
          />
          <CumulativeSwitch
            label="Cumulative to users"
            active={mode === "net"}
            onClick={() => setMode((m) => (m === "net" ? "none" : "net"))}
          />
          </div>
        </div>
      </ChartHeader>
      <ChartContent>
        <div ref={containerRef} className="relative h-full w-full">
          {!isConfigured ? (
            <EmptyState>Missing Solana indexer URL</EmptyState>
          ) : isLoading ? (
            <div className="relative h-full w-full">
              <div className="absolute inset-0 bp-skeleton rounded" />
              {elapsedMs > 4000 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-primary)]/95 px-4 py-3 text-center shadow">
                    <div className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-[var(--bp-text-primary)]">
                      {isDemo ? "Aggregating pool swaps live" : "Loading Dune flow data"}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-[var(--bp-text-muted)]">
                      {isDemo
                        ? `Indexed pool cache unavailable · live fallback · ${Math.floor(elapsedMs / 1000)}s`
                        : `Waiting for indexed Dune result · ${Math.floor(elapsedMs / 1000)}s`}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : isPoolSourceUnavailable ? (
            <EmptyState>
              {poolError
                ? `Pool flow unavailable · ${poolError.message}`
                : `Loading pool flow from Timescale${elapsedMs > 1500 ? ` · ${Math.floor(elapsedMs / 1000)}s` : ""}`}
            </EmptyState>
          ) : isError ? (
            <EmptyState>
              Net flow unavailable
              {flowToUsersError ? ` · Dune: ${flowToUsersError.message}` : ""}
              {rfqError ? ` · RFQ: ${rfqError.message}` : ""}
              {poolError ? ` · AMM pools: ${poolError.message}` : ""}
            </EmptyState>
          ) : !hasData ? (
            <EmptyState>No net flow data</EmptyState>
          ) : totalsAreZero ? (
            <EmptyState>No priced flow in window</EmptyState>
          ) : dimensions.width > 0 && dimensions.height > 0 ? (
            <>
              <FlowsBars
                data={chartData!}
                mode={mode}
                width={dimensions.width}
                height={dimensions.height}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
              />
              {hoveredDay && (
                <div
                  className="pointer-events-none absolute z-10"
                  style={{
                    left: `min(calc(100% - 220px), max(0px, ${
                      70 +
                      ((hoverIndex ?? 0) + 0.5) *
                        ((dimensions.width - 70 - 18) / chartData!.days.length)
                    }px - 110px))`,
                    top: 8,
                  }}
                >
                  <div className="rounded border border-gray-700/50 bg-gray-900/95 px-2.5 py-2 shadow-lg backdrop-blur-sm">
                    <div className="mb-1 text-[9px] font-bold text-gray-300">
                      {hoveredDay.label}
                    </div>
                    {chartData!.series.map((series) => {
                      const source = series.source;
                      const detail = hoveredDay.bySourceDetail[source];
                      const dailyNet = hoveredDay.bySource[source];
                      const cumValue =
                        mode === "volume"
                          ? hoveredDay.cumulativeVolumeBySource[source]
                          : mode === "net"
                            ? hoveredDay.cumulativeBySource[source]
                            : null;
                      const isEmpty =
                        mode === "none"
                          ? !detail || (detail.buyUsd === 0 && detail.sellUsd === 0)
                          : !cumValue;
                      if (isEmpty) return null;
                      const shown = mode === "none" ? dailyNet : (cumValue ?? 0);
                      return (
                        <div
                          key={source}
                          className="flex items-center justify-between gap-3 text-[10px] font-mono"
                        >
                          <span className="flex items-center gap-1.5 text-gray-300">
                            <span
                              className="inline-block h-2 w-2 rounded-sm"
                              style={{ backgroundColor: series.color }}
                            />
                            {getFlowSourceShortLabel(series, isDemo)}
                          </span>
                          <span
                            className={cn(
                              "font-semibold",
                              mode === "volume"
                                ? "text-white"
                                : shown > 0
                                  ? "text-emerald-300"
                                  : shown < 0
                                    ? "text-rose-300"
                                    : "text-white"
                            )}
                          >
                            {formatUsdSigned(shown)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="mt-1 border-t border-gray-700/60 pt-1 text-[10px] font-mono text-gray-300">
                      {mode === "none" && (
                        <div className="flex items-center justify-between gap-3">
                          <span>Net to users</span>
                          <span
                            className={cn(
                              "font-semibold",
                              hoveredDay.netUsd > 0
                                ? "text-emerald-300"
                                : hoveredDay.netUsd < 0
                                  ? "text-rose-300"
                                  : "text-white"
                            )}
                          >
                            {formatUsdSigned(hoveredDay.netUsd)}
                          </span>
                        </div>
                      )}
                      {mode === "volume" && (
                        <div className="flex items-center justify-between gap-3 text-gray-200">
                          <span>Cumulative volume</span>
                          <span className="font-semibold text-white">
                            {formatUsdSigned(hoveredDay.cumulativeVolumeUsd)}
                          </span>
                        </div>
                      )}
                      {mode === "net" && (
                        <div className="flex items-center justify-between gap-3 text-gray-200">
                          <span>Cumulative to users</span>
                          <span
                            className={cn(
                              "font-semibold",
                              hoveredDay.cumulativeUsd > 0
                                ? "text-emerald-300"
                                : hoveredDay.cumulativeUsd < 0
                                  ? "text-rose-300"
                                  : "text-white"
                            )}
                          >
                            {formatUsdSigned(hoveredDay.cumulativeUsd)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </ChartContent>
      {hasData && !totalsAreZero && (
        <ChartFoot className="flex-wrap justify-between">
          <div className="flex flex-wrap gap-3">
            {chartData!.series.map((series) =>
              series.buyUsd === 0 && series.sellUsd === 0 ? null : (
                <span
                  key={series.source}
                  className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--bp-text-muted)]"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: series.color }}
                  />
                  {getFlowSourceLabel(series, isDemo)}{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      series.netUsd > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : series.netUsd < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-[var(--bp-text-primary)]"
                    )}
                  >
                    {formatUsdSigned(series.netUsd)}
                  </span>
                </span>
              )
            )}
            {mode !== "none" && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--bp-text-muted)]">
                <span
                  className="inline-block h-[1.5px] w-3"
                  style={{ backgroundColor: CUMULATIVE_LINE_COLOR }}
                />
                {mode === "volume" ? "Cumulative volume " : "Cumulative to users "}
                <span className="text-[var(--bp-text-primary)]">
                  {formatUsdSigned(
                    mode === "volume"
                      ? chartData!.totals.buyUsd + chartData!.totals.sellUsd
                      : chartData!.totals.netUsd
                  )}
                </span>
              </span>
            )}
          </div>
        </ChartFoot>
      )}
    </ChartCard>
  );
}
