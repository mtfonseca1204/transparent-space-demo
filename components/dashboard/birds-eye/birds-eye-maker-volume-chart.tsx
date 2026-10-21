"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  ChartCard,
  ChartContent,
  ChartFoot,
  ChartHeader,
  ChartTitle,
} from "@/components/dashboard/chart-card";
import { cn } from "@/lib/utils";
import { useXstocksMakerVolume } from "@/hooks/use-xstocks-maker-volume";
import { useBirdsEyePoolVolume } from "@/hooks/use-birds-eye-pool-volume";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import type { MakerVolumeChartDay } from "@/lib/xstocks-maker-volume-chart";

const CHART_DAYS = 30;
const POOL_VOLUME_LINE_COLOR = "#0f172a";
const EMPTY_DAYS: MakerVolumeChartDay[] = [];
const EMPTY_PROVIDERS: NonNullable<
  ReturnType<typeof useXstocksMakerVolume>["data"]
>["providers"] = [];

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
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

export function BirdsEyeMakerVolumeChart({
  pools = [],
}: {
  pools?: BirdsEyePoolCard[];
}) {
  const spaceSlug = pools[0]?.pool.spaceSlug ?? null;
  const { data, isConfigured, isLoading, isError } = useXstocksMakerVolume({
    days: CHART_DAYS,
    spaceSlug,
  });
  const [showPoolVolume, setShowPoolVolume] = useState(false);
  const poolVolume = useBirdsEyePoolVolume(pools, CHART_DAYS);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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

  const metaText = data
    ? `${formatUsdCompact(data.totalUsd)} - ${
        data.missingUsdRows > 0 ? `${data.missingUsdRows} rows missing USD` : "all rows priced"
      }`
    : "Executed maker flow";

  const { width, height } = dimensions;
  const margin = { top: 18, right: 18, bottom: 38, left: 62 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);
  const chartDays = data?.days ?? EMPTY_DAYS;
  const providers = data?.providers ?? EMPTY_PROVIDERS;

  // Map pool-volume daily totals onto the same x-domain as the maker bars so
  // the line and bars line up day-by-day. If a maker day has no pool volume
  // (or vice versa) the line just skips that point.
  const poolVolumeByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of poolVolume.days) map.set(d.day, d.volumeUsd);
    return map;
  }, [poolVolume.days]);

  const poolLinePoints = useMemo(() => {
    if (!showPoolVolume) return [] as Array<{ day: string; volumeUsd: number }>;
    return chartDays
      .map((d) => ({ day: d.day, volumeUsd: poolVolumeByDay.get(d.day) ?? 0 }))
      .filter((p) => p.volumeUsd > 0);
  }, [chartDays, poolVolumeByDay, showPoolVolume]);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: chartDays.map((day) => day.day),
        range: [0, innerW],
        padding: 0.24,
      }),
    [chartDays, innerW]
  );

  const yMax = useMemo(() => {
    const barMax = Math.max(...chartDays.map((day) => day.totalUsd), 0);
    const poolMax = Math.max(...poolLinePoints.map((p) => p.volumeUsd), 0);
    const max = Math.max(barMax, poolMax);
    return max > 0 ? max * 1.12 : 1;
  }, [chartDays, poolLinePoints]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [innerH, yMax]
  );

  const hoveredDay: MakerVolumeChartDay | null =
    hoverIndex !== null ? chartDays[hoverIndex] ?? null : null;

  return (
    <ChartCard>
      <ChartHeader>
        <div className="flex items-center justify-between gap-3 w-full">
          <ChartTitle meta={metaText}>
            Maker Volume - 30D
          </ChartTitle>
          <button
            type="button"
            role="switch"
            aria-checked={showPoolVolume}
            onClick={() => setShowPoolVolume((v) => !v)}
            className="flex items-center gap-2 cursor-pointer group"
            title={showPoolVolume ? "Hide pool volume" : "Show pool volume"}
          >
            <span
              className="font-mono uppercase tracking-[0.14em]"
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: showPoolVolume
                  ? "var(--ts-ink-0)"
                  : "var(--ts-ink-3)",
              }}
            >
              Pool Volume
            </span>
            <span
              aria-hidden
              className="relative inline-flex shrink-0 transition-colors"
              style={{
                width: 26,
                height: 14,
                borderRadius: 10,
                border: "1px solid var(--ts-line-hard)",
                background: showPoolVolume
                  ? "var(--ts-ink-0)"
                  : "var(--ts-surface)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
              }}
            >
              <span
                className="absolute rounded-full transition-all duration-150 ease-out"
                style={{
                  top: 1,
                  left: showPoolVolume ? 13 : 1,
                  width: 10,
                  height: 10,
                  background: showPoolVolume
                    ? "var(--ts-ink-inv)"
                    : "var(--ts-ink-2)",
                }}
              />
            </span>
          </button>
        </div>
      </ChartHeader>
      <ChartContent>
        <div ref={containerRef} className="relative h-full w-full">
          {!isConfigured ? (
            <EmptyState>Missing Solana indexer URL</EmptyState>
          ) : isLoading ? (
            <div className="h-full w-full bp-skeleton rounded" />
          ) : isError ? (
            <EmptyState>Maker volume unavailable</EmptyState>
          ) : !data || data.totalUsd <= 0 || providers.length === 0 ? (
            <EmptyState>No priced maker volume</EmptyState>
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
                    strokeOpacity={0.55}
                  />
                  {chartDays.map((day, dayIndex) => {
                    const x = xScale(day.day) ?? 0;
                    const barWidth = xScale.bandwidth();
                    let runningTotal = 0;
                    return (
                      <g key={day.day}>
                        {providers.map((provider) => {
                          const value = day.providerUsd[provider.provider] ?? 0;
                          if (value <= 0) return null;
                          const y0 = yScale(runningTotal);
                          runningTotal += value;
                          const y1 = yScale(runningTotal);
                          const isHovered = hoverIndex === dayIndex;
                          return (
                            <Bar
                              key={`${day.day}-${provider.provider}`}
                              x={x}
                              y={y1}
                              width={barWidth}
                              height={Math.max(0, y0 - y1)}
                              fill={provider.color}
                              opacity={hoverIndex === null || isHovered ? 0.88 : 0.38}
                              rx={2}
                            />
                          );
                        })}
                      </g>
                    );
                  })}
                  <AxisLeft
                    scale={yScale}
                    numTicks={4}
                    tickFormat={(value) => formatUsdCompact(value as number)}
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
                    label="VOLUME (USD)"
                    labelOffset={42}
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
                    tickFormat={(day) => chartDays.find((item) => item.day === day)?.label ?? day}
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
                  {showPoolVolume && poolLinePoints.length > 0 && (
                    <g style={{ pointerEvents: "none" }}>
                      <LinePath<{ day: string; volumeUsd: number }>
                        data={poolLinePoints}
                        x={(p) => (xScale(p.day) ?? 0) + xScale.bandwidth() / 2}
                        y={(p) => yScale(p.volumeUsd)}
                        stroke={POOL_VOLUME_LINE_COLOR}
                        strokeWidth={1.75}
                        strokeOpacity={0.92}
                        curve={curveMonotoneX}
                      />
                      {poolLinePoints.map((p) => (
                        <circle
                          key={p.day}
                          cx={(xScale(p.day) ?? 0) + xScale.bandwidth() / 2}
                          cy={yScale(p.volumeUsd)}
                          r={2.25}
                          fill={POOL_VOLUME_LINE_COLOR}
                          stroke="white"
                          strokeWidth={1}
                        />
                      ))}
                    </g>
                  )}
                  {/* Single full-area overlay — sits on top of everything in
                      the inner chart so the cursor's x position alone decides
                      which day to show. Covers the plot area plus the x-axis
                      labels, since the user expects the tooltip anywhere a
                      day's column is visually present. */}
                  <rect
                    x={0}
                    y={-margin.top}
                    width={innerW}
                    height={margin.top + innerH + margin.bottom}
                    fill="transparent"
                    onMouseMove={(e) => {
                      if (chartDays.length === 0) return;
                      const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                      const cursorX = e.clientX - rect.left;
                      const step = xScale.step();
                      if (step <= 0) return;
                      const idx = Math.max(
                        0,
                        Math.min(chartDays.length - 1, Math.floor(cursorX / step))
                      );
                      setHoverIndex((prev) => (prev === idx ? prev : idx));
                    }}
                    onMouseLeave={() => setHoverIndex(null)}
                  />
                </Group>
              </svg>
              {hoveredDay && (
                <div
                  className="pointer-events-none absolute z-10"
                  style={{
                    left:
                      margin.left +
                      (xScale(hoveredDay.day) ?? 0) +
                      xScale.bandwidth() / 2,
                    top: margin.top + 4,
                    transform: "translateX(-50%)",
                  }}
                >
                  <div className="rounded border border-gray-700/50 bg-gray-900/95 px-2.5 py-2 shadow-lg backdrop-blur-sm">
                    <div className="mb-1 text-[9px] font-bold text-gray-300">
                      {hoveredDay.label}
                    </div>
                    {providers.map((provider) => {
                      const value = hoveredDay.providerUsd[provider.provider] ?? 0;
                      if (value <= 0) return null;
                      return (
                        <div
                          key={provider.provider}
                          className="flex items-center justify-between gap-4 text-[10px] font-mono"
                        >
                          <span className="flex items-center gap-1.5 text-gray-300">
                            <span
                              className="inline-block h-2 w-2 rounded-sm"
                              style={{ backgroundColor: provider.color }}
                            />
                            {provider.label}
                          </span>
                          <span className="font-semibold text-white">
                            {formatUsdCompact(value)}
                          </span>
                        </div>
                      );
                    })}
                    <div className="mt-1 border-t border-gray-700/60 pt-1 text-[10px] font-mono text-gray-400">
                      Total {formatUsdCompact(hoveredDay.totalUsd)}
                      {hoveredDay.missingUsdRows > 0
                        ? ` - ${hoveredDay.missingUsdRows} missing USD`
                        : ""}
                    </div>
                    {showPoolVolume && (
                      <div className="mt-1 flex items-center justify-between gap-4 text-[10px] font-mono text-gray-300">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ backgroundColor: POOL_VOLUME_LINE_COLOR }}
                          />
                          Pool Volume
                        </span>
                        <span className="font-semibold text-white">
                          {formatUsdCompact(
                            poolVolumeByDay.get(hoveredDay.day) ?? 0,
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </ChartContent>
      {data && data.totalUsd > 0 && providers.length > 0 && (
        <ChartFoot className="flex-wrap justify-between">
          <div className="flex flex-wrap gap-3">
            {providers.map((provider) => (
              <span
                key={provider.provider}
                className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--bp-text-muted)]"
              >
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: provider.color }}
                />
                {provider.label}
              </span>
            ))}
            {showPoolVolume && (
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--bp-text-muted)]">
                <span
                  className="inline-block h-[1.5px] w-3"
                  style={{ backgroundColor: POOL_VOLUME_LINE_COLOR }}
                />
                Pool Volume{" "}
                <span className="text-[var(--bp-text-primary)]">
                  {formatUsdCompact(poolVolume.totalUsd)}
                </span>
              </span>
            )}
          </div>
          <span
            className={cn(
              "text-[10px] font-mono",
              data.missingUsdRows > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-[var(--bp-text-muted)]"
            )}
          >
            {data.pricedRows} priced rows
          </span>
        </ChartFoot>
      )}
    </ChartCard>
  );
}
