"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath, AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  ChartCard,
  ChartContent,
  ChartFoot,
  ChartHeader,
  ChartTitle,
} from "@/components/dashboard/chart-card";
import { cn } from "@/lib/utils";
import { useBirdsEyeFlows } from "@/hooks/use-birds-eye-flows";
import type { PoolFlowRange } from "@/hooks/use-kraken-pool-net-flow";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import type { NetFlowChartData } from "@/lib/xstocks-net-flow";

/**
 * Hard-coded for now. The user can adjust these once the chart lands.
 *   loanUsd          principal extended to Flowdesk for MM operations
 *   riskFreeRate     opportunity cost (e.g. money-market funds)
 *   mgmtFeeRate      Backed management fee on AUM that the MM keeps
 *   loanStartDay     UTC YYYY-MM-DD on which the loan started accruing.
 *                    Days before this in the chart window show flat zero
 *                    lines for both cost and fee.
 */
const LOAN_USD = 15_000_000;
const RISK_FREE_RATE = 0.035;
const MGMT_FEE_RATE = 0.01;
const DAYS_PER_YEAR = 365;
const LOAN_START_DAY = "2026-02-26";
/** End of the 1-year projection horizon (anniversary of loan start). */
const PROJECTION_END_DAY = (() => {
  const start = new Date(`${LOAN_START_DAY}T00:00:00.000Z`);
  start.setUTCFullYear(start.getUTCFullYear() + 1);
  return start.toISOString().slice(0, 10);
})();

const COLOR_COST = "#dc2626"; // red — opportunity cost
const COLOR_INCOME = "#10b981"; // green — fees earned
const COLOR_DELTA_GAIN = "rgba(16, 185, 129, 0.18)";
const COLOR_DELTA_LOSS = "rgba(220, 38, 38, 0.18)";

function formatUsdSigned(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  const sign = value < 0 ? "-" : "";
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
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

interface CostPoint {
  day: string;
  date: Date;
  label: string;
  aum: number;
  costUsd: number;
  incomeUsd: number;
  deltaUsd: number;
  /** True for projected days beyond the last observed datapoint. */
  isProjection: boolean;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type AumProjectionMode = "growth" | "constant";

const AUM_MODE_OPTIONS: { id: AumProjectionMode; label: string; hint: string }[] = [
  {
    id: "growth",
    label: "Growth rate",
    hint: "AUM extrapolates at the observed daily NET flow rate",
  },
  {
    id: "constant",
    label: "Constant AUM",
    hint: "AUM holds flat at today's level for the rest of the year",
  },
];

/**
 * Build the cost-vs-fee-earned series clipped to the loan-live window and
 * extrapolated forward to a 1-year horizon.
 *
 * Two AUM projection modes:
 *   - "growth"   AUM grows by the average observed daily NET flow rate.
 *                Cumulative fee accrues quadratically on a growing base.
 *   - "constant" AUM holds at today's level. Cumulative fee accrues
 *                linearly at `currentAum × 1% / 365` per projected day.
 */
function buildCostSeries(
  data: NetFlowChartData,
  mode: AumProjectionMode
): CostPoint[] {
  const liveDays = data.days.filter((d) => d.day >= LOAN_START_DAY);
  if (liveDays.length === 0) return [];

  const dailyCost = (LOAN_USD * RISK_FREE_RATE) / DAYS_PER_YEAR;
  const points: CostPoint[] = [];
  let cumulativeIncome = 0;

  // Observed days
  for (let i = 0; i < liveDays.length; i++) {
    const row = liveDays[i];
    const aum = row.cumulativeUsd;
    const dailyIncome = (aum * MGMT_FEE_RATE) / DAYS_PER_YEAR;
    cumulativeIncome += dailyIncome;
    points.push({
      day: row.day,
      date: new Date(`${row.day}T00:00:00.000Z`),
      label: row.label,
      aum,
      costUsd: dailyCost * (i + 1),
      incomeUsd: cumulativeIncome,
      deltaUsd: cumulativeIncome - dailyCost * (i + 1),
      isProjection: false,
    });
  }

  const last = points[points.length - 1];
  const projectionEnd = new Date(`${PROJECTION_END_DAY}T00:00:00.000Z`);
  if (last.date.getTime() >= projectionEnd.getTime()) {
    return points;
  }

  const aumAtStart = points[0].aum;
  const observedSpanDays = Math.max(1, points.length - 1);
  const avgDailyFlow = (last.aum - aumAtStart) / observedSpanDays;

  const cursor = new Date(last.date);
  let projectedAum = last.aum;
  let dayIndex = points.length;

  while (true) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() > projectionEnd.getTime()) break;
    dayIndex += 1;
    if (mode === "growth") {
      projectedAum += avgDailyFlow;
    }
    // mode === "constant" → projectedAum stays at last.aum
    const dailyIncome = (projectedAum * MGMT_FEE_RATE) / DAYS_PER_YEAR;
    cumulativeIncome += dailyIncome;
    const costUsd = dailyCost * dayIndex;
    points.push({
      day: dayKey(cursor),
      date: new Date(cursor),
      label: dayLabel(cursor),
      aum: projectedAum,
      costUsd,
      incomeUsd: cumulativeIncome,
      deltaUsd: cumulativeIncome - costUsd,
      isProjection: true,
    });
  }

  return points;
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

interface CostBodyProps {
  points: CostPoint[];
  width: number;
  height: number;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

function CostBody({ points, width, height, hoverIndex, onHover }: CostBodyProps) {
  const margin = { top: 18, right: 110, bottom: 38, left: 70 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(() => {
    if (points.length === 0) {
      return scaleTime<number>({
        domain: [new Date(), new Date()],
        range: [0, innerW],
      });
    }
    return scaleTime<number>({
      domain: [points[0].date, points[points.length - 1].date],
      range: [0, innerW],
    });
  }, [points, innerW]);

  const { yMin, yMax } = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const p of points) {
      if (p.costUsd > max) max = p.costUsd;
      if (p.incomeUsd > max) max = p.incomeUsd;
      if (p.costUsd < min) min = p.costUsd;
      if (p.incomeUsd < min) min = p.incomeUsd;
    }
    const span = Math.max(max - min, 1);
    const pad = span * 0.12;
    return { yMin: min - pad, yMax: max + pad };
  }, [points]);

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
  const final = points[points.length - 1];

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
        <line
          x1={0}
          x2={innerW}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--bp-border-secondary)"
          strokeWidth={1}
          strokeOpacity={0.85}
        />

        {/* Split observed vs projected so we can render them differently. */}
        {(() => {
          const lastObservedIdx = points.findIndex((p) => p.isProjection) - 1;
          const observed = lastObservedIdx >= 0 ? points.slice(0, lastObservedIdx + 1) : points;
          // Bridge the projected segment with the last observed point so the
          // line stays continuous across the boundary.
          const projected = lastObservedIdx >= 0 ? points.slice(lastObservedIdx) : [];

          return (
            <g>
              {/* Filled delta — observed (full opacity) */}
              {observed.length > 1 && final && (
                final.deltaUsd >= 0 ? (
                  <AreaClosed<CostPoint>
                    data={observed}
                    x={(p) => xScale(p.date) ?? 0}
                    y={(p) => yScale(p.incomeUsd)}
                    yScale={yScale}
                    y0={(p) => yScale(p.costUsd)}
                    fill={COLOR_DELTA_GAIN}
                    curve={curveMonotoneX}
                  />
                ) : (
                  <AreaClosed<CostPoint>
                    data={observed}
                    x={(p) => xScale(p.date) ?? 0}
                    y={(p) => yScale(p.costUsd)}
                    yScale={yScale}
                    y0={(p) => yScale(p.incomeUsd)}
                    fill={COLOR_DELTA_LOSS}
                    curve={curveMonotoneX}
                  />
                )
              )}
              {/* Filled delta — projected (lighter opacity) */}
              {projected.length > 1 && final && (
                <g opacity={0.55}>
                  {final.deltaUsd >= 0 ? (
                    <AreaClosed<CostPoint>
                      data={projected}
                      x={(p) => xScale(p.date) ?? 0}
                      y={(p) => yScale(p.incomeUsd)}
                      yScale={yScale}
                      y0={(p) => yScale(p.costUsd)}
                      fill={COLOR_DELTA_GAIN}
                      curve={curveMonotoneX}
                    />
                  ) : (
                    <AreaClosed<CostPoint>
                      data={projected}
                      x={(p) => xScale(p.date) ?? 0}
                      y={(p) => yScale(p.costUsd)}
                      yScale={yScale}
                      y0={(p) => yScale(p.incomeUsd)}
                      fill={COLOR_DELTA_LOSS}
                      curve={curveMonotoneX}
                    />
                  )}
                </g>
              )}

              {/* Cost line — observed (dashed) and projected (more sparse dashes) */}
              {observed.length > 1 && (
                <LinePath<CostPoint>
                  data={observed}
                  x={(p) => xScale(p.date) ?? 0}
                  y={(p) => yScale(p.costUsd)}
                  stroke={COLOR_COST}
                  strokeWidth={1.75}
                  strokeDasharray="4 3"
                  strokeOpacity={0.95}
                />
              )}
              {projected.length > 1 && (
                <LinePath<CostPoint>
                  data={projected}
                  x={(p) => xScale(p.date) ?? 0}
                  y={(p) => yScale(p.costUsd)}
                  stroke={COLOR_COST}
                  strokeWidth={1.5}
                  strokeDasharray="2 4"
                  strokeOpacity={0.7}
                />
              )}

              {/* Income line — observed (solid) and projected (dashed) */}
              {observed.length > 1 && (
                <LinePath<CostPoint>
                  data={observed}
                  x={(p) => xScale(p.date) ?? 0}
                  y={(p) => yScale(p.incomeUsd)}
                  stroke={COLOR_INCOME}
                  strokeWidth={1.85}
                  strokeOpacity={0.95}
                  curve={curveMonotoneX}
                />
              )}
              {projected.length > 1 && (
                <LinePath<CostPoint>
                  data={projected}
                  x={(p) => xScale(p.date) ?? 0}
                  y={(p) => yScale(p.incomeUsd)}
                  stroke={COLOR_INCOME}
                  strokeWidth={1.6}
                  strokeOpacity={0.7}
                  strokeDasharray="2 4"
                  curve={curveMonotoneX}
                />
              )}

              {/* TODAY divider between observed and projection */}
              {projected.length > 1 && (
                <g pointerEvents="none">
                  <line
                    x1={xScale(projected[0].date) ?? 0}
                    x2={xScale(projected[0].date) ?? 0}
                    y1={0}
                    y2={innerH}
                    stroke="var(--bp-text-muted)"
                    strokeOpacity={0.55}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={(xScale(projected[0].date) ?? 0) + 4}
                    y={10}
                    fontFamily="var(--font-mono)"
                    fontSize={9}
                    fontWeight={700}
                    fill="var(--bp-text-muted)"
                  >
                    TODAY · PROJECTION →
                  </text>
                </g>
              )}
            </g>
          );
        })()}

        {/* End-of-window markers + value labels */}
        {final && (
          <g>
            <circle
              cx={xScale(final.date) ?? 0}
              cy={yScale(final.costUsd)}
              r={3}
              fill={COLOR_COST}
              stroke="white"
              strokeWidth={1}
            />
            <text
              x={(xScale(final.date) ?? 0) + 6}
              y={yScale(final.costUsd) + 4}
              fontFamily="var(--font-mono)"
              fontSize={10}
              fontWeight={700}
              fill={COLOR_COST}
            >
              {formatUsdSigned(final.costUsd)}
            </text>
            <circle
              cx={xScale(final.date) ?? 0}
              cy={yScale(final.incomeUsd)}
              r={3}
              fill={COLOR_INCOME}
              stroke="white"
              strokeWidth={1}
            />
            <text
              x={(xScale(final.date) ?? 0) + 6}
              y={yScale(final.incomeUsd) + 4}
              fontFamily="var(--font-mono)"
              fontSize={10}
              fontWeight={700}
              fill={COLOR_INCOME}
            >
              {formatUsdSigned(final.incomeUsd)}
            </text>
          </g>
        )}

        {/* Hover crosshair */}
        {hoverIndex !== null && points[hoverIndex] && (
          <line
            x1={xScale(points[hoverIndex].date) ?? 0}
            x2={xScale(points[hoverIndex].date) ?? 0}
            y1={0}
            y2={innerH}
            stroke="var(--bp-text-muted)"
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray="2 3"
            pointerEvents="none"
          />
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
          label="CUMULATIVE USD"
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
          numTicks={Math.min(points.length, 8)}
          stroke="var(--bp-border-subtle)"
          tickStroke="var(--bp-border-subtle)"
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
            if (points.length === 0) return;
            const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const t = innerW > 0 ? Math.max(0, Math.min(1, cursorX / innerW)) : 0;
            const idx = Math.round(t * (points.length - 1));
            onHover(idx);
          }}
          onMouseLeave={() => onHover(null)}
        />
      </Group>
    </svg>
  );
}

export function BirdsEyeFlowsCostChart({
  spaceSlug,
  range = "all",
  enabled = true,
}: {
  spaceSlug?: string;
  range?: PoolFlowRange;
  enabled?: boolean;
}) {
  const { data, isLoading, isError, isConfigured } = useBirdsEyeFlows({
    spaceSlug,
    range,
    enabled,
  });
  const isDemo = isDemoSpaceSlug(spaceSlug);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [aumMode, setAumMode] = useState<AumProjectionMode>("growth");

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

  const points = useMemo<CostPoint[]>(() => {
    if (!data) return [];
    return buildCostSeries(data, aumMode);
  }, [data, aumMode]);

  const final = points[points.length - 1];
  const lastObserved = useMemo(
    () => [...points].reverse().find((p) => !p.isProjection) ?? null,
    [points]
  );
  const hovered = hoverIndex !== null ? points[hoverIndex] ?? null : null;

  const annualCost = LOAN_USD * RISK_FREE_RATE;
  const modeLabel = aumMode === "growth" ? "growth-rate" : "constant-AUM";
  const metaText = final
    ? isDemo
      ? `Funding $${(LOAN_USD / 1_000_000).toFixed(0)}M from ${LOAN_START_DAY} · MMF ${(RISK_FREE_RATE * 100).toFixed(1)}% (~$${(annualCost / 1_000).toFixed(0)}K/yr) · Fee income ${(MGMT_FEE_RATE * 100).toFixed(0)}% on net AUM · 1Y proj thru ${PROJECTION_END_DAY} (${modeLabel})`
      : `Loan $${(LOAN_USD / 1_000_000).toFixed(0)}M from ${LOAN_START_DAY} · MMF ${(RISK_FREE_RATE * 100).toFixed(1)}% (~$${(annualCost / 1_000).toFixed(0)}K/yr) · Mgmt fee ${(MGMT_FEE_RATE * 100).toFixed(0)}% on net AUM · 1Y proj thru ${PROJECTION_END_DAY} (${modeLabel})`
    : isDemo
      ? "Opportunity cost vs fee income"
      : "Opportunity cost vs management-fee income";

  const totalsLine = final ? (
    <span className="flex items-center gap-3">
      {lastObserved && (
        <span
          className={cn(
            "text-[10px] font-mono",
            lastObserved.deltaUsd >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          )}
        >
          To date {formatUsdSigned(lastObserved.deltaUsd)}
          {lastObserved.costUsd > 0
            ? ` · ${((lastObserved.incomeUsd / lastObserved.costUsd) * 100).toFixed(0)}% recovered`
            : ""}
        </span>
      )}
      <span
        className={cn(
          "text-[10px] font-mono",
          final.deltaUsd >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400"
        )}
      >
        1Y proj {formatUsdSigned(final.deltaUsd)}
        {final.costUsd > 0
          ? ` · ${((final.incomeUsd / final.costUsd) * 100).toFixed(0)}% recovered`
          : ""}
      </span>
    </span>
  ) : null;

  return (
    <ChartCard>
      <ChartHeader>
        <div className="flex items-center justify-between gap-3 w-full">
          <ChartTitle meta={metaText}>
            {isDemo
              ? "Liquidity Funding · Opportunity Cost vs Fee Income"
              : "Flowdesk Funding · Opportunity Cost vs Mgmt Fee"}
          </ChartTitle>
          <div className="flex items-center gap-1 bg-gray-100/70 dark:bg-gray-800/50 rounded-md p-0.5">
            {AUM_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAumMode(opt.id)}
                title={opt.hint}
                className={cn(
                  "cursor-pointer px-2 py-1 text-[10px] font-bold rounded transition-all duration-150",
                  aumMode === opt.id
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </ChartHeader>
      <ChartContent>
        <div ref={containerRef} className="relative h-full w-full">
          {!isConfigured ? (
            <EmptyState>Missing Solana indexer URL</EmptyState>
          ) : isLoading || !data ? (
            <div className="h-full w-full bp-skeleton rounded" />
          ) : isError ? (
            <EmptyState>Cost analysis unavailable</EmptyState>
          ) : points.length < 2 ? (
            <EmptyState>Need at least 2 days of flow data</EmptyState>
          ) : dimensions.width > 0 && dimensions.height > 0 ? (
            <>
              <CostBody
                points={points}
                width={dimensions.width}
                height={dimensions.height}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
              />
              {hovered && (
                <div
                  className="pointer-events-none absolute z-10"
                  style={{
                    left: 80 + (hoverIndex! / Math.max(1, points.length - 1)) * (dimensions.width - 80 - 110),
                    top: 8,
                    transform: "translateX(-50%)",
                    minWidth: 220,
                  }}
                >
                  <div className="rounded border border-gray-700/50 bg-gray-900/95 px-2.5 py-2 shadow-lg backdrop-blur-sm">
                    <div className="mb-1 text-[9px] font-bold text-gray-300">
                      {hovered.label}
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-gray-300">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-[2px] w-3"
                          style={{ backgroundColor: COLOR_COST }}
                        />
                        Cost ({(RISK_FREE_RATE * 100).toFixed(1)}%)
                      </span>
                      <span className="font-semibold text-white">
                        {formatUsdSigned(hovered.costUsd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-gray-300">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-[2px] w-3"
                          style={{ backgroundColor: COLOR_INCOME }}
                        />
                        Mgmt fee ({(MGMT_FEE_RATE * 100).toFixed(0)}%)
                      </span>
                      <span className="font-semibold text-white">
                        {formatUsdSigned(hovered.incomeUsd)}
                      </span>
                    </div>
                    <div className="mt-1 border-t border-gray-700/60 pt-1 text-[10px] font-mono text-gray-300">
                      <div className="flex items-center justify-between gap-3">
                        <span>Net</span>
                        <span
                          className={cn(
                            "font-semibold",
                            hovered.deltaUsd >= 0
                              ? "text-emerald-300"
                              : "text-rose-300"
                          )}
                        >
                          {formatUsdSigned(hovered.deltaUsd)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-gray-400">
                        <span>AUM that day</span>
                        <span className="font-semibold text-white">
                          {formatUsdSigned(hovered.aum)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </ChartContent>
      {final && (
        <ChartFoot className="flex-wrap justify-between">
          <div className="flex flex-wrap gap-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--bp-text-muted)]">
              <span
                className="inline-block h-[2px] w-3"
                style={{ backgroundColor: COLOR_COST }}
              />
              Opportunity Cost{" "}
              <span className="text-[var(--bp-text-primary)] font-semibold">
                {formatUsdSigned(final.costUsd)}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--bp-text-muted)]">
              <span
                className="inline-block h-[2px] w-3"
                style={{ backgroundColor: COLOR_INCOME }}
              />
              Mgmt Fee Earned{" "}
              <span className="text-[var(--bp-text-primary)] font-semibold">
                {formatUsdSigned(final.incomeUsd)}
              </span>
            </span>
          </div>
          {totalsLine}
        </ChartFoot>
      )}
    </ChartCard>
  );
}
