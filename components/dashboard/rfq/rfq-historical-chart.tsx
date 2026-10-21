"use client";

import React, { useMemo, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { curveMonotoneX, curveStepAfter } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { useRfqHistory } from "@/hooks/use-rfq-history";
import { usePoolCandles } from "@/hooks/use-pool-candles";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import {
  ChartCard,
  ChartHeader,
  ChartTitle,
  ChartContent,
} from "@/components/dashboard/chart-card";

// Band colors from inner (smallest tier) to outer (largest tier)
// Using decreasing opacity for wider bands
const BAND_COLORS = [
  { fill: "#22c55e", stroke: "#22c55e", buyOpacity: 0.25, sellOpacity: 0.25 },
  { fill: "#3b82f6", stroke: "#3b82f6", buyOpacity: 0.18, sellOpacity: 0.18 },
  { fill: "#8b5cf6", stroke: "#8b5cf6", buyOpacity: 0.14, sellOpacity: 0.14 },
  { fill: "#f59e0b", stroke: "#f59e0b", buyOpacity: 0.10, sellOpacity: 0.10 },
  { fill: "#ef4444", stroke: "#ef4444", buyOpacity: 0.08, sellOpacity: 0.08 },
  { fill: "#ec4899", stroke: "#ec4899", buyOpacity: 0.06, sellOpacity: 0.06 },
  { fill: "#6366f1", stroke: "#6366f1", buyOpacity: 0.05, sellOpacity: 0.05 },
];

// Create a Date for a specific hour:minute in US Eastern time on a given date
function easternToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = formatter.formatToParts(guess);
  const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? "0");
  const etHour = getPart("hour");
  const etMinute = getPart("minute");
  const etDay = getPart("day");
  const diffMinutes = (hour * 60 + minute) - (etHour * 60 + etMinute) + (day - etDay) * 1440;
  return new Date(guess.getTime() + diffMinutes * 60_000);
}

const formatCompact = (value: number): string => {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

const formatTime = (d: Date): string =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

interface RfqHistoricalChartProps {
  poolKey: string;
}

export function RfqHistoricalChart({ poolKey }: RfqHistoricalChartProps) {
  const { points, notionalTiers, isLoading, isError } =
    useRfqHistory(poolKey);

  const [showPoolPrice, setShowPoolPrice] = useState(false);
  const [enabledEvents, setEnabledEvents] = useState<Set<string>>(new Set());
  const [eventsDropdownOpen, setEventsDropdownOpen] = useState(false);
  const eventsButtonRef = useRef<HTMLButtonElement>(null);

  const poolMeta = SOLANA_POOL_METADATA_BY_ADDRESS[poolKey];

  // Compute time range from RFQ points to fetch matching candles
  const timeRangeDays = useMemo(() => {
    if (points.length < 2) return 7;
    const ms =
      points[points.length - 1].timestamp.getTime() -
      points[0].timestamp.getTime();
    return Math.max(1, Math.ceil(ms / 86_400_000));
  }, [points]);

  const { data: candles } = usePoolCandles({
    poolAddress: poolKey,
    interval: "5m",
    days: timeRangeDays + 1,
    token0Decimals: poolMeta?.token0Decimals ?? 9,
    token1Decimals: poolMeta?.token1Decimals ?? 6,
    enabled: showPoolPrice,
  });

  // Build pool candle close-price line points aligned to chart x-axis
  const candleLine = useMemo(() => {
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
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

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

  // Compute y domain from all prices (mid + all tier bid/ask + candle prices)
  const yDomain = useMemo(() => {
    if (points.length === 0) return [0, 1] as [number, number];
    let min = Infinity;
    let max = -Infinity;
    for (const pt of points) {
      if (pt.midPrice < min) min = pt.midPrice;
      if (pt.midPrice > max) max = pt.midPrice;
      for (const [, tier] of pt.tiers) {
        if (tier.bidPrice > 0 && tier.bidPrice < min) min = tier.bidPrice;
        if (tier.bidPrice > 0 && tier.bidPrice > max) max = tier.bidPrice;
        if (tier.askPrice > 0 && tier.askPrice < min) min = tier.askPrice;
        if (tier.askPrice > 0 && tier.askPrice > max) max = tier.askPrice;
      }
    }
    for (const c of candleLine) {
      if (c.price < min) min = c.price;
      if (c.price > max) max = c.price;
    }
    const pad = (max - min) * 0.1 || 1;
    return [min - pad, max + pad] as [number, number];
  }, [points, candleLine]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: yDomain,
        range: [innerH, 0],
        nice: true,
      }),
    [yDomain, innerH]
  );

  // NYSE session event lines
  const NYSE_EVENTS = [
    { label: "Early Pre-Mkt", hour: 4, minute: 0, color: "#818cf8" },
    { label: "Pre-Market", hour: 7, minute: 0, color: "#c084fc" },
    { label: "NYSE Open", hour: 9, minute: 30, color: "#4ade80" },
    { label: "NYSE Close", hour: 16, minute: 0, color: "#f87171" },
    { label: "After-Hrs Close", hour: 20, minute: 0, color: "#fbbf24" },
  ];

  const eventLines = useMemo(() => {
    if (enabledEvents.size === 0 || points.length < 2) return [];
    const startMs = points[0].timestamp.getTime();
    const endMs = points[points.length - 1].timestamp.getTime();
    const lines: { x: number; label: string; color: string }[] = [];

    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const d = new Date(startDate);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);

    const activeEvents = NYSE_EVENTS.filter(e => enabledEvents.has(e.label));
    while (d <= endDate) {
      // Skip weekends (0 = Sunday, 6 = Saturday)
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        for (const evt of activeEvents) {
          const evtDate = easternToUtc(
            d.getFullYear(), d.getMonth() + 1, d.getDate(),
            evt.hour, evt.minute
          );
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
  }, [enabledEvents, points, xScale]);

  // Build band paths: for each tier, trace buy prices forward then ask prices backward
  const bandPaths = useMemo(() => {
    if (points.length < 2 || notionalTiers.length === 0) return [];

    // Render bands from outermost (largest tier) to innermost (smallest) so
    // inner bands paint on top
    const reversedTiers = [...notionalTiers].reverse();

    return reversedTiers.map((notional, colorIdx) => {
      const color =
        BAND_COLORS[
          (notionalTiers.length - 1 - colorIdx) % BAND_COLORS.length
        ];

      // Collect valid points for this tier
      const validPts: {
        x: number;
        buyY: number;
        askY: number;
        midY: number;
      }[] = [];

      for (const pt of points) {
        const tierData = pt.tiers.get(notional);
        // Use whatever side is available, fall back to mid price for the missing side
        const bidPrice =
          tierData && tierData.bidPrice > 0
            ? tierData.bidPrice
            : pt.midPrice;
        const askPrice =
          tierData && tierData.askPrice > 0
            ? tierData.askPrice
            : pt.midPrice;
        validPts.push({
          x: xScale(pt.timestamp) ?? 0,
          buyY: yScale(bidPrice),
          askY: yScale(askPrice),
          midY: yScale(pt.midPrice),
        });
      }

      if (validPts.length < 2) return null;

      // Buy band: midPrice → buyPrice (upper, since buy price > mid)
      let buyPath = `M ${validPts[0].x} ${validPts[0].midY}`;
      for (const p of validPts) buyPath += ` L ${p.x} ${p.midY}`;
      for (let i = validPts.length - 1; i >= 0; i--)
        buyPath += ` L ${validPts[i].x} ${validPts[i].buyY}`;
      buyPath += " Z";

      // Sell band: askPrice → midPrice (lower, since ask price < mid)
      let sellPath = `M ${validPts[0].x} ${validPts[0].askY}`;
      for (const p of validPts) sellPath += ` L ${p.x} ${p.askY}`;
      for (let i = validPts.length - 1; i >= 0; i--)
        sellPath += ` L ${validPts[i].x} ${validPts[i].midY}`;
      sellPath += " Z";

      return {
        notional,
        buyPath,
        sellPath,
        color,
      };
    });
  }, [points, notionalTiers, xScale, yScale]);

  // Hover crosshair data
  const hoverData = useMemo(() => {
    if (hoverIdx === null || !points[hoverIdx]) return null;
    const pt = points[hoverIdx];

    // Find nearest candle price for this timestamp
    let poolPrice: number | null = null;
    if (showPoolPrice && candleLine.length > 0) {
      const t = pt.timestamp.getTime();
      let bestDist = Infinity;
      for (const c of candleLine) {
        const d = Math.abs(c.timestamp.getTime() - t);
        if (d < bestDist) {
          bestDist = d;
          poolPrice = c.price;
        }
      }
    }

    return {
      x: xScale(pt.timestamp) ?? 0,
      midY: yScale(pt.midPrice),
      point: pt,
      poolPrice,
    };
  }, [hoverIdx, points, xScale, yScale, showPoolPrice, candleLine]);

  if (isLoading) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Historical Price Bands</ChartTitle>
        </ChartHeader>
        <ChartContent style={{ height: 420 }}>
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-[11px] text-[var(--bp-text-muted)]">
              Loading historical data...
            </p>
          </div>
        </ChartContent>
      </ChartCard>
    );
  }

  if (isError || points.length < 2) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Historical Price Bands</ChartTitle>
        </ChartHeader>
        <ChartContent style={{ height: 420 }}>
          <div className="w-full h-full flex items-center justify-center">
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
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Historical Price Bands</ChartTitle>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--bp-text-muted)]">
              Pool Price
            </span>
            <button
              type="button"
              onClick={() => setShowPoolPrice((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                showPoolPrice
                  ? "bg-orange-500 border-orange-500"
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
          <div className="relative flex items-center gap-2">
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
                            checked ? "border-transparent" : "border-[var(--bp-border-subtle)]"
                          }`}
                          style={checked ? { backgroundColor: evt.color } : undefined}
                        >
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          )}
                        </span>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: evt.color }} />
                        <span style={{ color: checked ? evt.color : "var(--bp-text-secondary)" }}>{evt.label}</span>
                        <span className="ml-auto text-[9px] text-[var(--bp-text-muted)]">
                          {String(evt.hour).padStart(2, "0")}:{String(evt.minute).padStart(2, "0")} ET
                        </span>
                      </button>
                    );
                  })}
                  <div className="border-t border-[var(--bp-border-subtle)] mt-1 pt-1 px-3 py-1 flex gap-2">
                    <button type="button" onClick={() => setEnabledEvents(new Set(NYSE_EVENTS.map(e => e.label)))}
                      className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors">All</button>
                    <button type="button" onClick={() => setEnabledEvents(new Set())}
                      className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors">None</button>
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
          <p className="shrink-0 text-[11px] text-[var(--bp-text-muted)]">
            Mid price over time with bid/ask spread bands per trade size — wider
            bands = more slippage at that size
          </p>
          <div
            ref={containerRef}
            className="w-full min-h-0 flex-1 relative"
            style={eventsDropdownOpen ? { pointerEvents: "none" } : undefined}
          >
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

                {/* NYSE event vertical lines */}
                {enabledEvents.size > 0 &&
                  eventLines.map((evt, i) => (
                    <g key={`evt-${i}`}>
                      <line
                        x1={evt.x}
                        x2={evt.x}
                        y1={0}
                        y2={innerH}
                        stroke={evt.color}
                        strokeWidth={1}
                        strokeDasharray="4,4"
                        opacity={0.5}
                      />
                      <text
                        x={evt.x + 4}
                        y={12}
                        fill={evt.color}
                        fontSize={9}
                        fontFamily="inherit"
                        fontWeight={600}
                        opacity={0.85}
                      >
                        {evt.label}
                      </text>
                    </g>
                  ))}

                {/* Bands: outermost drawn first, innermost on top */}
                {bandPaths.map(
                  (band) =>
                    band && (
                      <g key={band.notional}>
                        <path
                          d={band.buyPath}
                          fill={band.color.fill}
                          fillOpacity={band.color.buyOpacity}
                          stroke={band.color.stroke}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                        <path
                          d={band.sellPath}
                          fill={band.color.fill}
                          fillOpacity={band.color.sellOpacity}
                          stroke={band.color.stroke}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                      </g>
                    )
                )}

                {/* Mid price line */}
                <LinePath
                  data={points}
                  x={(d) => xScale(d.timestamp) ?? 0}
                  y={(d) => yScale(d.midPrice)}
                  curve={curveMonotoneX}
                  stroke="var(--bp-text-primary)"
                  strokeWidth={1.5}
                />

                {/* Pool candle price line */}
                {showPoolPrice && candleLine.length > 1 && (
                  <LinePath
                    data={candleLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                  />
                )}

                {/* Invisible hover zones — full-height rects for each data point */}
                {points.map((pt, i) => {
                  const x = xScale(pt.timestamp) ?? 0;
                  const step =
                    points.length > 1
                      ? innerW / (points.length - 1)
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

                {/* Hover crosshair */}
                {hoverData && !eventsDropdownOpen && (
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

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  numTicks={6}
                  tickFormat={(v) => formatTime(v as Date)}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "middle",
                  }}
                />
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
            </svg>
          )}

            {/* Tooltip */}
            {hoverData && !eventsDropdownOpen && (
              <div
                className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
                style={{
                  left: Math.min(
                    margin.left + hoverData.x,
                    width - 200
                  ),
                  top: margin.top + 8,
                  transform: "translateX(-50%)",
                }}
              >
                <div className="text-[var(--bp-text-primary)] font-semibold mb-1">
                  {formatTime(hoverData.point.timestamp)} — Mid $
                  {hoverData.point.midPrice.toFixed(2)}
                  {hoverData.poolPrice !== null && (
                    <span className="text-[#f97316] ml-2">
                      Pool ${hoverData.poolPrice.toFixed(2)}
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
                    const spreadBps =
                      (spread / hoverData.point.midPrice) * 10000;
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
                          ${askPrice.toFixed(2)} — $
                          {bidPrice.toFixed(2)}
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
          </div>

          {/* Legend */}
          <div className="flex shrink-0 flex-wrap gap-3 justify-center">
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
        </div>
      </ChartContent>
    </ChartCard>
  );
}
