"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import type { RebalanceRecord, RebalanceSummary } from "@/lib/lp-rebalances";
import { amountsForPosition, bigintToApproxNumber, getSqrtRatioAtTick, tickToPrice } from "@/lib/uniswap-v3-math";
import {
  makeBars as makeBarsLib,
  valueBarsFor as valueBarsForLib,
  type DepthBand,
  type DepthBar,
} from "@/lib/liquidity-depth-bars";

/** Minimal position shape (range + active window) for the replay distribution. */
export interface ReplayPositionInput {
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
  openedAt: number;
  closedAt: number | null;
  liquidity: number;
}

export interface HistoricalRebalancesProps {
  records: RebalanceRecord[];
  summary: RebalanceSummary;
  /** Other owners' positions, for the rest-of-pool layer in the replay. */
  otherPositions?: ReplayPositionInput[];
  /** Pool tick over time, so the replay's price marker tracks each timestamp. */
  priceSeries?: Array<{ t: number; tick: number }>;
  /** Convert a raw token1/token0 price into the display orientation (invert/USD). */
  toDisplayPrice: (rawPrice: number) => number;
  /** Label for the price unit, e.g. "USDC per 0G". */
  priceUnitLabel: string;
  currentTick: number;
  /** Current pool price (raw token1/token0) — used to value liquidity in USD. */
  currentPrice: number;
  token0Decimals: number;
  token1Decimals: number;
  token0Symbol: string;
  token1Symbol: string;
  /** Token USD prices, when available, so the replay bars are valued in USD. */
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  /** Pool tick spacing — controls replay bar width. */
  tickSpacing?: number;
  nowSec: number;
  hasOwner: boolean;
}

const COLORS = {
  inRange: "#5BA88A", // calm green — earning fees
  oor: "#D9534F", // red — drifted out of range, awaiting rebalance
  ongoing: "#E0903C", // amber — still out of range right now
  marker: "#3E5C76",
  grid: "#e5e7eb",
  text: "#6b7280",
  textMuted: "#9ca3af",
};

const MAX_CHART_ROWS = 60;

// A position whose range touches a tick extreme (min/max usable tick) or spans a
// huge tick width is effectively unbounded — its price bounds are unreadable, so
// we show "Full Range" instead of the astronomical numbers.
const FULL_RANGE_MIN_TICK = -880000;
const FULL_RANGE_MAX_TICK = 880000;
const FULL_RANGE_MIN_SPAN = 1_000_000;
const FULL_RANGE_MAX_DISPLAY_PRICE = 1_000_000_000;
function isFullRange(r: RebalanceRecord): boolean {
  return (
    r.tickLower <= FULL_RANGE_MIN_TICK ||
    r.tickUpper >= FULL_RANGE_MAX_TICK ||
    r.tickUpper - r.tickLower >= FULL_RANGE_MIN_SPAN
  );
}

function humanizeDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = sec / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 0.01) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(3);
}

function formatTokenAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1_000_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (a >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toPrecision(3);
}

function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

/** Compact date (no hour) for the narrow table. */
function formatDateShort(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Display-orientation price band (handles inversion flipping low/high). */
function displayBand(record: RebalanceRecord, toDisplayPrice: (p: number) => number) {
  const a = toDisplayPrice(record.priceLower);
  const b = toDisplayPrice(record.priceUpper);
  return {
    low: Math.min(a, b),
    high: Math.max(a, b),
    outPrice: record.outPrice != null ? toDisplayPrice(record.outPrice) : null,
  };
}

function isFullRangeForDisplay(record: RebalanceRecord, band: ReturnType<typeof displayBand>): boolean {
  return (
    isFullRange(record) ||
    !Number.isFinite(band.low) ||
    !Number.isFinite(band.high) ||
    Math.abs(band.low) >= FULL_RANGE_MAX_DISPLAY_PRICE ||
    Math.abs(band.high) >= FULL_RANGE_MAX_DISPLAY_PRICE
  );
}

function orderRecordsForDisplay(records: RebalanceRecord[]): RebalanceRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const aOutOfRange = a.record.outOfRangeAt != null;
      const bOutOfRange = b.record.outOfRangeAt != null;
      if (aOutOfRange !== bOutOfRange) return aOutOfRange ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ record }) => record);
}

function formatPositionTokenAmounts(
  record: RebalanceRecord,
  sqrtPriceX96: bigint | null,
  token0Decimals: number,
  token1Decimals: number,
  token0Symbol: string,
  token1Symbol: string,
): string {
  if (sqrtPriceX96 == null || !Number.isFinite(record.liquidity) || record.liquidity <= 0) return "—";

  try {
    const liquidity = BigInt(Math.trunc(record.liquidity));
    const { amount0, amount1 } = amountsForPosition({
      liquidity,
      tickLower: record.tickLower,
      tickUpper: record.tickUpper,
      sqrtPriceX96,
    });
    const token0 = bigintToApproxNumber(amount0, token0Decimals);
    const token1 = bigintToApproxNumber(amount1, token1Decimals);
    return `${formatTokenAmount(token0)} ${token0Symbol} / ${formatTokenAmount(token1)} ${token1Symbol}`;
  } catch {
    return "—";
  }
}

interface TimelineProps extends HistoricalRebalancesProps {
  width: number;
  height?: number;
}

const RebalanceTimeline: React.FC<TimelineProps> = ({
  records,
  toDisplayPrice,
  nowSec,
  width,
  height,
}) => {
  const [hovered, setHovered] = useState<string | null>(null);

  const rows = useMemo(() => records.slice(0, MAX_CHART_ROWS), [records]);

  const rowHeight = 26;
  // Left gutter holds the per-row NFT id / range label.
  const margin = { top: 8, right: 16, bottom: 28, left: 72 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = rows.length * rowHeight;
  // Fixed date-axis header (stays put) + scrollable lanes area below it.
  const axisHeight = 22;
  const laneTop = 4;
  const lanesHeight = innerHeight + laneTop + 8;
  const maxLanesViewport = height != null && height > axisHeight ? Math.max(120, height - axisHeight) : 440;

  // End of the position's bar on the timeline: the moment the LP acted (close /
  // trim), or now if still open and untouched.
  const segEnd = (r: RebalanceRecord) => (r.ongoing ? nowSec : r.rebalancedAt ?? r.closedAt ?? nowSec);

  const { minTs, maxTs } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      min = Math.min(min, r.openedAt);
      max = Math.max(max, r.ongoing ? nowSec : r.rebalancedAt ?? r.closedAt ?? nowSec);
    }
    if (!Number.isFinite(min)) {
      min = nowSec - 86400;
      max = nowSec;
    }
    if (min === max) max = min + 3600;
    return { minTs: min, maxTs: max };
  }, [rows, nowSec]);

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [minTs, maxTs], range: [0, innerWidth] }),
    [minTs, maxTs, innerWidth],
  );

  if (width <= 0 || rows.length === 0) return null;

  const tickCount = 4;
  const axisTicks = Array.from({ length: tickCount + 1 }, (_, i) => minTs + ((maxTs - minTs) * i) / tickCount);

  return (
    <div className="relative w-full">
      {/* Fixed date axis — stays visible while the lanes scroll */}
      <svg width={width} height={axisHeight} style={{ display: "block" }}>
        <Group left={margin.left}>
          {axisTicks.map((t) => (
            <text
              key={`axis-${t}`}
              x={xScale(t)}
              y={axisHeight - 7}
              textAnchor="middle"
              fontSize={9}
              fill={COLORS.textMuted}
            >
              {new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
          ))}
        </Group>
      </svg>

      {/* Scrollable lanes */}
      <div style={{ maxHeight: maxLanesViewport, overflowY: "auto" }}>
      <svg width={width} height={lanesHeight} style={{ display: "block" }}>
        <Group top={laneTop} left={margin.left}>
          {/* Vertical time gridlines */}
          {axisTicks.map((t) => (
            <line
              key={`grid-${t}`}
              x1={xScale(t)}
              x2={xScale(t)}
              y1={0}
              y2={innerHeight}
              stroke={COLORS.grid}
              strokeOpacity={0.6}
            />
          ))}

          {rows.map((r, i) => {
            const y = i * rowHeight;
            const barY = y + rowHeight / 2;
            const xOpen = xScale(r.openedAt);
            const xEnd = xScale(segEnd(r));
            // No out-of-range segment for proactive (in-range) rebalances.
            const hasOor = r.outOfRangeAt != null;
            const xOut = hasOor ? xScale(r.outOfRangeAt as number) : xEnd;
            const isHovered = hovered === r.id;
            const oorColor = r.ongoing ? COLORS.ongoing : COLORS.oor;
            // Marker: amber arrow = still untouched; amber diamond = partial trim;
            // green diamond = proactive in-range close; blue diamond = forced full close.
            const markerColor = r.partial
              ? COLORS.ongoing
              : r.closedInRange
                ? COLORS.inRange
                : COLORS.marker;

            return (
              <g
                key={r.id}
                onMouseEnter={() => setHovered(r.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                {/* hover background */}
                <rect
                  x={-margin.left}
                  y={y}
                  width={width}
                  height={rowHeight}
                  fill={isHovered ? COLORS.grid : "transparent"}
                  opacity={isHovered ? 0.4 : 0}
                />
                {/* left-gutter label: NFT id when known, else the range mid price */}
                <text
                  x={-margin.left + 4}
                  y={barY}
                  dominantBaseline="middle"
                  fontSize={10.5}
                  fontWeight={r.tokenId ? 600 : 400}
                  fill={r.tokenId ? COLORS.marker : COLORS.textMuted}
                >
                  {r.tokenId
                    ? `#${r.tokenId}`
                    : isFullRange(r)
                      ? "Full"
                      : formatPrice(toDisplayPrice((r.priceLower + r.priceUpper) / 2))}
                </text>
                {/* in-range segment */}
                <line
                  x1={xOpen}
                  x2={Math.max(xOpen, xOut)}
                  y1={barY}
                  y2={barY}
                  stroke={COLORS.inRange}
                  strokeWidth={4}
                  strokeLinecap="round"
                  opacity={0.85}
                />
                {/* out-of-range segment — its length IS the time-to-rebalance */}
                {hasOor && (
                  <>
                    <line
                      x1={xOut}
                      x2={Math.max(xOut, xEnd)}
                      y1={barY}
                      y2={barY}
                      stroke={oorColor}
                      strokeWidth={4}
                      strokeLinecap="round"
                    />
                    {/* out-of-range start marker */}
                    <circle cx={xOut} cy={barY} r={3} fill={oorColor} />
                  </>
                )}
                {/* marker: ongoing arrow / open-hold circle / rebalance diamond */}
                {r.ongoing ? (
                  <path
                    d={`M ${xEnd} ${barY} l -5 -4 l 0 8 z`}
                    fill={COLORS.ongoing}
                  />
                ) : r.isHold ? (
                  <circle cx={xEnd} cy={barY} r={3.5} fill="none" stroke={COLORS.inRange} strokeWidth={1.5} />
                ) : (
                  <rect
                    x={xEnd - 4}
                    y={barY - 4}
                    width={8}
                    height={8}
                    fill={markerColor}
                    transform={`rotate(45 ${xEnd} ${barY})`}
                  />
                )}
              </g>
            );
          })}
        </Group>

        {/* Tooltip */}
        {(() => {
          const r = rows.find((row) => row.id === hovered);
          if (!r) return null;
          const band = displayBand(r, toDisplayPrice);
          const fullRange = isFullRangeForDisplay(r, band);
          const anchorTs = r.outOfRangeAt ?? segEnd(r);
          const cx = Math.min(Math.max(margin.left + xScale(anchorTs), 90), width - 90);
          const idx = rows.indexOf(r);
          const ty = laneTop + idx * rowHeight + rowHeight;
          const statusColor = r.ongoing || r.partial
            ? COLORS.ongoing
            : r.isHold || r.closedInRange
              ? COLORS.inRange
              : COLORS.oor;
          return (
            <g transform={`translate(${cx}, ${Math.min(ty, lanesHeight - 70)})`} pointerEvents="none">
              <rect x={-88} y={0} width={176} height={64} fill="rgba(255,255,255,0.96)" stroke={COLORS.grid} rx={4} />
              <text x={-80} y={15} fontSize={9.5} fill={COLORS.text} fontWeight={600}>
                {r.tokenId ? `#${r.tokenId} · ` : ""}
                {fullRange
                  ? "Full Range"
                  : `${formatPrice(band.low)} – ${formatPrice(band.high)} (±${(r.widthPct / 2).toFixed(1)}%)`}
              </text>
              {r.outOfRangeAt != null ? (
                <>
                  <text x={-80} y={31} fontSize={9.5} fill={r.outSide === "above" ? COLORS.oor : COLORS.marker}>
                    {r.outSide === "above" ? "↑ above" : "↓ below"} @ {band.outPrice != null ? formatPrice(band.outPrice) : "—"}
                  </text>
                  <text x={-80} y={47} fontSize={9.5} fill={COLORS.text}>
                    OOR {formatDate(r.outOfRangeAt)}
                  </text>
                </>
              ) : r.isHold ? (
                <text x={-80} y={31} fontSize={9.5} fill={COLORS.inRange}>
                  Holding · opened {formatDate(r.openedAt)}
                </text>
              ) : (
                <text x={-80} y={31} fontSize={9.5} fill={COLORS.inRange}>
                  Closed in range{r.rebalancedAt != null ? ` · ${formatDate(r.rebalancedAt)}` : ""}
                </text>
              )}
              <text x={-80} y={60} fontSize={9.5} fill={statusColor} fontWeight={600}>
                {r.ongoing
                  ? `Out of range ${humanizeDuration(r.timeToRebalanceSec)} · ongoing`
                  : r.isHold
                    ? "Holding · open position"
                    : r.closedInRange
                      ? r.partial
                        ? "Trimmed in range · partial"
                        : "Rebalanced in range"
                      : r.partial
                        ? `Trimmed in ${humanizeDuration(r.timeToRebalanceSec)} · partial`
                        : `Rebalanced in ${humanizeDuration(r.timeToRebalanceSec)}`}
              </text>
            </g>
          );
        })()}
      </svg>
      </div>
    </div>
  );
};

// ── Liquidity-distribution replay ──────────────────────────────────────────
// Each record is a position lifecycle (range + active window), so at any instant
// we can sum the liquidity of the positions live at that moment across price and
// animate it — a "movie" of how this LP's liquidity distribution moved over time.

const REPLAY_BARS = 80;
const REPLAY_TICK_RANGE = 8000;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatValueShort(value: number, usd: boolean): string {
  const prefix = usd ? "$" : "";
  if (!Number.isFinite(value) || value <= 0) return `${prefix}0`;
  if (value >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${prefix}${(value / 1_000).toFixed(1)}K`;
  return `${prefix}${value.toFixed(0)}`;
}

// Band/bar shapes are shared with the liquidity-depth heatmap so both use one
// implementation of the v3 amount math (see lib/liquidity-depth-bars.ts).
type ReplayBand = DepthBand;
type ReplayBar = DepthBar;

// ── Replay pacing (shared by the on-screen rAF loop and the video recorder) ──
const REPLAY_DURATION_MS = 14000; // ms to traverse the full window at 1× speed
const OOR_WALLCLOCK_MS = 1500; // each out-of-range episode is stretched to this

/**
 * Advance the replay clock by `dtMs`, applying the rebalance-aware pacing: an
 * out-of-range episode is spread across a fixed wall-clock budget (so brief
 * rebalances are watchable), with a slow post-episode grace, a slow in-range
 * hold, and full speed through dead stretches. Pure — returns the next time and
 * the next grace boundary; the caller handles looping / stopping at tMax.
 */
function advanceReplayTime(
  prev: number,
  dtMs: number,
  graceUntil: number,
  ctx: {
    tMin: number;
    tMax: number;
    selected: ReplayBand[];
    tickAt: (t: number) => number;
    oorSpans: Array<{ start: number; end: number }>;
  },
): { nt: number; graceUntil: number } {
  const { tMin, tMax, selected, tickAt, oorSpans } = ctx;
  const GRACE = (tMax - tMin) * 0.05;
  const span = oorSpans.find((s) => prev >= s.start && prev < s.end);
  if (span) {
    const rate = (span.end - span.start) / OOR_WALLCLOCK_MS;
    return { nt: prev + dtMs * rate, graceUntil: span.end + GRACE };
  }
  const ptick = tickAt(prev);
  let anyIn = false;
  for (const p of selected) {
    if (p.openedAt > prev || prev >= p.end) continue;
    if (ptick >= p.tickLower && ptick < p.tickUpper) {
      anyIn = true;
      break;
    }
  }
  const inGrace = prev < graceUntil;
  // 2× faster than before: post-rebalance grace 0.1→0.2, in-range hold 0.5→1.0.
  const speed = inGrace && anyIn ? 0.2 : anyIn ? 1 : 1;
  return { nt: prev + (dtMs / REPLAY_DURATION_MS) * (tMax - tMin) * speed, graceUntil };
}

/** Pick the best MediaRecorder mime type — prefer MP4 (H.264), fall back to WebM. */
function pickRecorderMime(): { type: string; ext: string } {
  const candidates = [
    { type: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { type: "video/mp4", ext: "mp4" },
    { type: "video/webm;codecs=vp9", ext: "webm" },
    { type: "video/webm;codecs=vp8", ext: "webm" },
    { type: "video/webm", ext: "webm" },
  ];
  if (typeof MediaRecorder !== "undefined") {
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c.type)) return c;
      } catch {
        /* ignore */
      }
    }
  }
  return { type: "video/webm", ext: "webm" };
}

function ReplayHistogram({
  bars,
  selInValues,
  selOutValues,
  otherValues,
  yMax,
  markerTick,
  markerPrice,
  outOfRange,
  toDisplayPrice,
  token0Decimals,
  token1Decimals,
  priceUnitLabel,
  valueIsUsd,
  width,
  height,
}: {
  bars: ReplayBar[];
  selInValues: number[];
  selOutValues: number[];
  otherValues: number[];
  yMax: number;
  markerTick: number;
  markerPrice: number;
  outOfRange: boolean;
  toDisplayPrice: (p: number) => number;
  token0Decimals: number;
  token1Decimals: number;
  priceUnitLabel: string;
  valueIsUsd: boolean;
  width: number;
  height: number;
}) {
  const margin = { top: 22, right: 52, bottom: 32, left: 12 };
  const iw = Math.max(0, width - margin.left - margin.right);
  const ih = Math.max(0, height - margin.top - margin.bottom);
  if (width <= 0 || height <= 0) return null;
  const n = bars.length;
  if (n === 0) return null;
  const bw = iw / n;
  // The marker sits at the price (tick) for the current frame's timestamp. Clamp
  // its x to the window so it stays visible when price drifts outside the bars.
  const rawIdx = bars.findIndex((b) => b.minTick <= markerTick && markerTick < b.maxTick);
  const curIdx =
    rawIdx >= 0 ? rawIdx : markerTick < bars[0].minTick ? 0 : n - 1;
  const markerX = (curIdx + 0.5) * bw;
  const markerColor = outOfRange ? COLORS.oor : COLORS.text;
  const labelX = Math.min(Math.max(markerX, 30), iw - 30);
  return (
    <svg width={width} height={height}>
      <Group top={margin.top} left={margin.left}>
        <line x1={0} x2={iw} y1={ih} y2={ih} stroke={COLORS.grid} />
        {/* Stacked bars: this LP in-range (green) at the baseline, this LP
            out-of-range (red) above it, then other LPs (grey) on top — so the
            total bar height is whole-pool liquidity and red flags a rebalance. */}
        {bars.map((_, i) => {
          const inV = selInValues[i] ?? 0;
          const outV = selOutValues[i] ?? 0;
          const ov = otherValues[i] ?? 0;
          const inH = yMax > 0 ? (inV / yMax) * ih : 0;
          const outH = yMax > 0 ? (outV / yMax) * ih : 0;
          const otherH = yMax > 0 ? (ov / yMax) * ih : 0;
          if (inH <= 0 && outH <= 0 && otherH <= 0) return null;
          const w = Math.max(1, bw - 1);
          return (
            <g key={i}>
              {otherH > 0 && (
                <rect x={i * bw} y={ih - inH - outH - otherH} width={w} height={otherH} fill={COLORS.textMuted} opacity={0.4} />
              )}
              {outH > 0 && (
                <rect x={i * bw} y={ih - inH - outH} width={w} height={outH} fill={COLORS.oor} opacity={0.9} />
              )}
              {inH > 0 && (
                <rect x={i * bw} y={ih - inH} width={w} height={inH} fill={COLORS.inRange} opacity={0.9} />
              )}
            </g>
          );
        })}
        {/* Current-price marker, with the price (and an out-of-range flag) above */}
        <line
          x1={markerX}
          x2={markerX}
          y1={0}
          y2={ih}
          stroke={markerColor}
          strokeDasharray="3 3"
          opacity={outOfRange ? 0.7 : 0.4}
          strokeWidth={outOfRange ? 1.5 : 1}
        />
        <text x={labelX} y={-10} textAnchor="middle" fontSize={10} fontWeight={700} fill={markerColor}>
          {formatPrice(markerPrice)}
          {outOfRange ? "  ⚠ OUT OF RANGE" : ""}
        </text>
        {/* X-axis price labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, k) => {
          const idx = Math.min(Math.floor(f * n), n - 1);
          const price = toDisplayPrice(tickToPrice(bars[idx].tickMid, token0Decimals, token1Decimals));
          return (
            <text
              key={k}
              x={f * iw}
              y={ih + 14}
              textAnchor={k === 0 ? "start" : k === 4 ? "end" : "middle"}
              fontSize={10}
              fill={COLORS.textMuted}
            >
              {formatPrice(price)}
            </text>
          );
        })}
        <text x={iw / 2} y={ih + 28} textAnchor="middle" fontSize={9} fill={COLORS.textMuted}>
          {priceUnitLabel}
        </text>
        {/* Y-axis value labels (right) */}
        {[1, 0.5, 0].map((f, k) => (
          <text key={k} x={iw + 6} y={Math.max(8, ih * (1 - f) + 3)} fontSize={9} fill={COLORS.textMuted}>
            {formatValueShort(yMax * f, valueIsUsd)}
          </text>
        ))}
      </Group>
    </svg>
  );
}

function RebalanceDistributionReplay({
  records,
  otherPositions,
  priceSeries,
  toDisplayPrice,
  nowSec,
  priceUnitLabel,
  currentTick,
  currentPrice,
  token0Decimals,
  token1Decimals,
  token0UsdPrice,
  token1UsdPrice,
  tickSpacing,
  onClose,
}: {
  records: RebalanceRecord[];
  otherPositions: ReplayPositionInput[];
  priceSeries: Array<{ t: number; tick: number }>;
  toDisplayPrice: (p: number) => number;
  nowSec: number;
  priceUnitLabel: string;
  currentTick: number;
  currentPrice: number;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  tickSpacing?: number;
  onClose: () => void;
}) {
  // Pool tick at any timestamp (step-interpolated from the candle series), so the
  // price marker and the token0/token1 split track price as the replay scrubs.
  const tickAt = useCallback(
    (tt: number): number => {
      const s = priceSeries;
      if (!s || s.length === 0) return currentTick;
      if (tt <= s[0].t) return s[0].tick;
      if (tt >= s[s.length - 1].t) return s[s.length - 1].tick;
      let lo = 0;
      let hi = s.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (s[mid].t <= tt) lo = mid;
        else hi = mid - 1;
      }
      return s[lo].tick;
    },
    [priceSeries, currentTick],
  );
  // Reduce records / lifecycles to a tick range + active window [openedAt, end).
  // ALL positions render (like the LP Liquidity Distribution chart) — wide /
  // full-range ones simply contribute a thin layer across the bars they overlap,
  // since each bar's value is the position's overlap with that bar's tick band.
  const toBand = useCallback(
    (
      items: Array<{
        tickLower: number;
        tickUpper: number;
        liquidity: number;
        openedAt: number;
        closedAt: number | null;
      }>,
    ): ReplayBand[] =>
      items
        .map((r) => ({
          tickLower: Math.min(r.tickLower, r.tickUpper),
          tickUpper: Math.max(r.tickLower, r.tickUpper),
          L: r.liquidity,
          openedAt: r.openedAt,
          end: r.closedAt ?? nowSec,
        }))
        .filter(
          (p) =>
            Number.isFinite(p.tickLower) &&
            Number.isFinite(p.tickUpper) &&
            p.tickUpper > p.tickLower &&
            p.L > 0,
        ),
    [nowSec],
  );

  const selected = useMemo(() => toBand(records), [toBand, records]);
  const others = useMemo(() => toBand(otherPositions ?? []), [toBand, otherPositions]);

  // USD valuation factors (mirrors LPDistributionComparisonChart): if one token's
  // USD price is missing, derive it from the other via the current pool price.
  const { t0Usd, t1Usd, valueIsUsd } = useMemo(() => {
    const p = currentPrice;
    const t0 =
      typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
        ? token0UsdPrice
        : typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && p > 0
          ? token1UsdPrice * p
          : null;
    const t1 =
      typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
        ? token1UsdPrice
        : typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && p > 0
          ? token0UsdPrice / p
          : null;
    return { t0Usd: t0, t1Usd: t1, valueIsUsd: t0 !== null && t1 !== null };
  }, [token0UsdPrice, token1UsdPrice, currentPrice]);

  // Tick window: the SAME width and step as the LP Liquidity Distribution chart
  // (±DISPLAY_TICK_RANGE ticks, aligned to tick spacing, ~80 bars) but CENTERED
  // on the price at the scrubbed timestamp, so the marker and the live liquidity
  // stay in view as price moves — the window follows price instead of sitting on
  // the fixed current tick.
  const spacing = Math.max(1, tickSpacing ?? 1);
  const makeBars = useCallback(
    (centerTick: number): ReplayBar[] => makeBarsLib(centerTick, spacing, REPLAY_TICK_RANGE, REPLAY_BARS),
    [spacing],
  );

  // Sum the USD (or token1-unit) value of every position in `list` live at time
  // t, distributed across `barsArr` by overlap — same V3 amount math as the
  // liquidity-distribution chart, so heights are real value and depth ≤ TVL.
  // `priceTick` is the pool price at t (for the token0/token1 split).
  const valueBarsFor = useCallback(
    (list: ReplayBand[], barsArr: ReplayBar[], priceTick: number, t: number): number[] =>
      valueBarsForLib(list, barsArr, priceTick, t, {
        token0Decimals,
        token1Decimals,
        valueIsUsd,
        t0Usd,
        t1Usd,
        fallbackPrice: currentPrice,
      }),
    [token0Decimals, token1Decimals, valueIsUsd, t0Usd, t1Usd, currentPrice],
  );

  const { tMin, tMax } = useMemo(() => {
    const tMax = nowSec;
    // Anchor the start to THIS LP's first position (the subject of the replay) —
    // not the pool's inception — with a short lead-in for context, so we don't
    // sit through empty time before the selected LP shows up. Fall back to the
    // earliest position overall when this LP has none.
    let selFirst = Infinity;
    for (const p of selected) if (p.openedAt < selFirst) selFirst = p.openedAt;
    let anyFirst = Infinity;
    for (const p of others) if (p.openedAt < anyFirst) anyFirst = p.openedAt;
    const anchor = Number.isFinite(selFirst)
      ? selFirst
      : Number.isFinite(anyFirst)
        ? anyFirst
        : tMax - 86400;
    // Lead-in ≈ 6% of the span from the anchor to now, capped to [12h, 7d].
    const lead = Math.min(7 * 86400, Math.max(12 * 3600, (tMax - anchor) * 0.06));
    return { tMin: Math.max(0, anchor - lead), tMax };
  }, [selected, others, nowSec]);

  // Stable y-scale: max stacked (this LP + others) total across the replay, each
  // sampled time using its own price-centered window — so the scale doesn't
  // rescale frame-to-frame as the window slides.
  const yMax = useMemo(() => {
    let m = 0;
    for (let s = 0; s <= 60; s++) {
      const tt = tMin + (tMax - tMin) * (s / 60);
      const pt = tickAt(tt);
      const b = makeBars(pt);
      const sb = valueBarsFor(selected, b, pt, tt);
      const ob = valueBarsFor(others, b, pt, tt);
      for (let i = 0; i < b.length; i++) {
        const v = sb[i] + ob[i];
        if (v > m) m = v;
      }
    }
    return m || 1;
  }, [makeBars, valueBarsFor, tickAt, selected, others, tMin, tMax]);

  // Out-of-range episodes (the rebalances), straight from the computed records:
  // each is [went-out-of-range, reacted/closed]. Merged so overlapping ones don't
  // double up. These get a FIXED wall-clock crawl below — independent of how
  // brief the episode was in real time — so the red is always clearly visible.
  const oorSpans = useMemo(() => {
    const raw = records
      .filter((r) => r.outOfRangeAt != null)
      .map((r) => ({ start: r.outOfRangeAt as number, end: r.closedAt ?? r.rebalancedAt ?? nowSec }))
      .filter((s) => Number.isFinite(s.start) && s.end > s.start)
      .sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const s of raw) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else merged.push({ ...s });
    }
    return merged;
  }, [records, nowSec]);

  const [t, setT] = useState(tMin);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    setT(tMin);
    setPlaying(true);
  }, [tMin]);

  const rafRef = useRef<number | undefined>(undefined);
  const lastRef = useRef<number | undefined>(undefined);
  // Pool-time until which we keep crawling AFTER an out-of-range episode, so the
  // next (rebalanced) in-range position forming is easy to watch.
  const graceUntilRef = useRef<number>(0);
  useEffect(() => {
    if (!playing) {
      lastRef.current = undefined;
      return;
    }
    graceUntilRef.current = 0;
    const step = (ts: number) => {
      if (lastRef.current == null) lastRef.current = ts;
      const dt = ts - lastRef.current;
      lastRef.current = ts;
      setT((prev) => {
        const { nt, graceUntil } = advanceReplayTime(prev, dt, graceUntilRef.current, {
          tMin,
          tMax,
          selected,
          tickAt,
          oorSpans,
        });
        graceUntilRef.current = graceUntil;
        if (nt >= tMax) {
          graceUntilRef.current = 0;
          return tMin; // loop on screen
        }
        return nt;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastRef.current = undefined;
    };
  }, [playing, tMin, tMax, selected, tickAt, oorSpans]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const markerTick = useMemo(() => tickAt(t), [tickAt, t]);
  const bars = useMemo(() => makeBars(markerTick), [makeBars, markerTick]);

  // Split THIS LP's live positions into in-range vs out-of-range AT this instant
  // (price tick outside the position's [tickLower, tickUpper)), so out-of-range
  // liquidity can be painted red — that's the rebalance we want to surface.
  const { selInRange, selOutRange } = useMemo(() => {
    const inR: ReplayBand[] = [];
    const outR: ReplayBand[] = [];
    for (const p of selected) {
      if (p.openedAt > t || t >= p.end) continue;
      if (markerTick < p.tickLower || markerTick >= p.tickUpper) outR.push(p);
      else inR.push(p);
    }
    return { selInRange: inR, selOutRange: outR };
  }, [selected, t, markerTick]);

  const selInValues = useMemo(
    () => valueBarsFor(selInRange, bars, markerTick, t),
    [valueBarsFor, selInRange, bars, markerTick, t],
  );
  const selOutValues = useMemo(
    () => valueBarsFor(selOutRange, bars, markerTick, t),
    [valueBarsFor, selOutRange, bars, markerTick, t],
  );
  const otherValues = useMemo(
    () => valueBarsFor(others, bars, markerTick, t),
    [valueBarsFor, others, bars, markerTick, t],
  );
  const activeCount = selInRange.length + selOutRange.length;
  const outOfRange = selOutRange.length > 0;
  const otherCount = useMemo(
    () => others.filter((p) => p.openedAt <= t && t < p.end).length,
    [others, t],
  );
  // Price at this instant, in the display orientation, for the marker label.
  const markerPrice = useMemo(
    () => toDisplayPrice(tickToPrice(markerTick, token0Decimals, token1Decimals)),
    [markerTick, toDisplayPrice, token0Decimals, token1Decimals],
  );

  // ── Canvas frame renderer (for the MP4 export) — mirrors ReplayHistogram +
  // the header, drawn in 2D so the animation can be captured to a video. ──────
  const drawReplayFrame = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, atT: number) => {
      const mt = tickAt(atT);
      const barsArr = makeBars(mt);
      const inR: ReplayBand[] = [];
      const outR: ReplayBand[] = [];
      for (const p of selected) {
        if (p.openedAt > atT || atT >= p.end) continue;
        if (mt < p.tickLower || mt >= p.tickUpper) outR.push(p);
        else inR.push(p);
      }
      const selIn = valueBarsFor(inR, barsArr, mt, atT);
      const selOut = valueBarsFor(outR, barsArr, mt, atT);
      const oth = valueBarsFor(others, barsArr, mt, atT);
      const oor = outR.length > 0;
      const price = toDisplayPrice(tickToPrice(mt, token0Decimals, token1Decimals));
      const n = barsArr.length;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);

      // Header
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = "#111827";
      ctx.font = "600 20px ui-sans-serif, system-ui, -apple-system, sans-serif";
      ctx.fillText("Liquidity Distribution Replay", 20, 30);
      ctx.font = "13px ui-sans-serif, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = oor ? COLORS.oor : "#6b7280";
      const otherActive = others.reduce(
        (acc, p) => acc + (p.openedAt <= atT && atT < p.end ? 1 : 0),
        0,
      );
      ctx.fillText(
        `${formatDate(atT)} · ${formatPrice(price)} ${priceUnitLabel} · ${inR.length + outR.length} active` +
          `${others.length > 0 ? ` · ${otherActive} other LPs` : ""}${oor ? " · ⚠ OUT OF RANGE" : ""}`,
        20,
        50,
      );
      // Legend (top-right)
      const legend: Array<[string, string]> = [
        ["In range", hexToRgba(COLORS.inRange, 0.9)],
        ["Out of range", hexToRgba(COLORS.oor, 0.9)],
      ];
      if (others.length > 0) legend.push(["Other LPs", hexToRgba(COLORS.textMuted, 0.4)]);
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
      let lx = W - 20;
      ctx.textAlign = "right";
      for (let i = legend.length - 1; i >= 0; i--) {
        const [label, color] = legend[i];
        ctx.fillStyle = "#6b7280";
        ctx.fillText(label, lx, 30);
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(lx - tw - 14, 21, 9, 9);
        lx -= tw + 30;
      }

      // Chart geometry
      const margin = { top: 72, right: 70, bottom: 42, left: 18 };
      const iw = W - margin.left - margin.right;
      const ih = H - margin.top - margin.bottom;
      const x0 = margin.left;
      const y0 = margin.top;
      if (n === 0 || ih <= 0 || iw <= 0) return;
      const bw = iw / n;

      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + ih);
      ctx.lineTo(x0 + iw, y0 + ih);
      ctx.stroke();

      for (let i = 0; i < n; i++) {
        const inV = selIn[i] ?? 0;
        const outV = selOut[i] ?? 0;
        const ov = oth[i] ?? 0;
        const inH = yMax > 0 ? (inV / yMax) * ih : 0;
        const outH = yMax > 0 ? (outV / yMax) * ih : 0;
        const otherH = yMax > 0 ? (ov / yMax) * ih : 0;
        if (inH <= 0 && outH <= 0 && otherH <= 0) continue;
        const w = Math.max(1, bw - 1);
        const x = x0 + i * bw;
        if (otherH > 0) {
          ctx.fillStyle = hexToRgba(COLORS.textMuted, 0.4);
          ctx.fillRect(x, y0 + ih - inH - outH - otherH, w, otherH);
        }
        if (outH > 0) {
          ctx.fillStyle = hexToRgba(COLORS.oor, 0.9);
          ctx.fillRect(x, y0 + ih - inH - outH, w, outH);
        }
        if (inH > 0) {
          ctx.fillStyle = hexToRgba(COLORS.inRange, 0.9);
          ctx.fillRect(x, y0 + ih - inH, w, inH);
        }
      }

      // Marker + price label
      const rawIdx = barsArr.findIndex((b) => b.minTick <= mt && mt < b.maxTick);
      const curIdx = rawIdx >= 0 ? rawIdx : mt < barsArr[0].minTick ? 0 : n - 1;
      const mx = x0 + (curIdx + 0.5) * bw;
      ctx.strokeStyle = oor ? COLORS.oor : COLORS.text;
      ctx.globalAlpha = oor ? 0.7 : 0.4;
      ctx.lineWidth = oor ? 2 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mx, y0);
      ctx.lineTo(mx, y0 + ih);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.fillStyle = oor ? COLORS.oor : COLORS.text;
      ctx.font = "700 12px ui-sans-serif, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      const labelX = Math.min(Math.max(mx, x0 + 40), x0 + iw - 40);
      ctx.fillText(`${formatPrice(price)}${oor ? "  ⚠ OUT OF RANGE" : ""}`, labelX, y0 - 6);

      // X-axis price labels
      ctx.fillStyle = COLORS.textMuted;
      ctx.font = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const idx = Math.min(Math.floor(f * n), n - 1);
        const px = toDisplayPrice(tickToPrice(barsArr[idx].tickMid, token0Decimals, token1Decimals));
        ctx.textAlign = f === 0 ? "left" : f === 1 ? "right" : "center";
        ctx.fillText(formatPrice(px), x0 + f * iw, y0 + ih + 16);
      }
      ctx.textAlign = "center";
      ctx.fillText(priceUnitLabel, x0 + iw / 2, y0 + ih + 32);

      // Y-axis value labels (right)
      ctx.textAlign = "left";
      for (const f of [1, 0.5, 0]) {
        ctx.fillText(formatValueShort(yMax * f, valueIsUsd), x0 + iw + 8, Math.max(12, y0 + ih * (1 - f) + 4));
      }
    },
    [
      tickAt,
      makeBars,
      selected,
      others,
      valueBarsFor,
      toDisplayPrice,
      token0Decimals,
      token1Decimals,
      yMax,
      priceUnitLabel,
      valueIsUsd,
    ],
  );

  const [recording, setRecording] = useState(false);
  const handleDownloadVideo = useCallback(async () => {
    if (recording) return;
    if (typeof MediaRecorder === "undefined" || !(tMax > tMin)) {
      window.alert("Video recording isn't supported in this browser.");
      return;
    }
    setRecording(true);
    setPlaying(false);
    try {
      const W = 1280;
      const H = 600;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      const stream = (canvas as HTMLCanvasElement).captureStream?.(30);
      if (!ctx || !stream) {
        window.alert("Video recording isn't supported in this browser.");
        return;
      }
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, { mimeType: mime.type, videoBitsPerSecond: 8_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((res) => {
        rec.onstop = () => res();
      });
      rec.start();

      // Single pass tMin → tMax with the same rebalance-aware pacing as playback.
      await new Promise<void>((resolve) => {
        let tt = tMin;
        let grace = 0;
        let last = performance.now();
        const startReal = last;
        const MAX_REAL_MS = 120000; // safety cap on video length
        const loop = (now: number) => {
          const dt = Math.min(64, now - last);
          last = now;
          drawReplayFrame(ctx, W, H, tt);
          const r = advanceReplayTime(tt, dt, grace, { tMin, tMax, selected, tickAt, oorSpans });
          grace = r.graceUntil;
          if (r.nt >= tMax || now - startReal > MAX_REAL_MS) {
            drawReplayFrame(ctx, W, H, tMax);
            resolve();
            return;
          }
          tt = r.nt;
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });

      await new Promise((r) => setTimeout(r, 250)); // let the last frame flush
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `liquidity-replay.${mime.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } finally {
      setRecording(false);
    }
  }, [recording, tMin, tMax, selected, tickAt, oorSpans, drawReplayFrame]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-[92vw] max-w-[960px] rounded-lg border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--bp-text-primary)]">
              Liquidity Distribution Replay
            </div>
            <div className="text-[11px] text-[var(--bp-text-muted)]">
              {formatDate(t)} · {formatPrice(markerPrice)} {priceUnitLabel} · {activeCount} active position
              {activeCount === 1 ? "" : "s"}
              {others.length > 0 ? ` · ${otherCount} other LP position${otherCount === 1 ? "" : "s"}` : ""}
              {outOfRange && (
                <span className="ml-1 font-semibold" style={{ color: COLORS.oor }}>
                  · ⚠ out of range
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-[11px] text-[var(--bp-text-muted)]">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLORS.inRange, opacity: 0.9 }} />
                In range
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLORS.oor, opacity: 0.9 }} />
                Out of range
              </span>
              {others.length > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLORS.textMuted, opacity: 0.4 }} />
                  Other LPs
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)]"
            >
              ✕
            </button>
          </div>
        </div>
        <div style={{ height: 340 }}>
          <ParentSize>
            {({ width, height }) => (
              <ReplayHistogram
                bars={bars}
                selInValues={selInValues}
                selOutValues={selOutValues}
                otherValues={otherValues}
                yMax={yMax}
                markerTick={markerTick}
                markerPrice={markerPrice}
                outOfRange={outOfRange}
                toDisplayPrice={toDisplayPrice}
                token0Decimals={token0Decimals}
                token1Decimals={token1Decimals}
                priceUnitLabel={priceUnitLabel}
                valueIsUsd={valueIsUsd}
                width={width}
                height={height}
              />
            )}
          </ParentSize>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="rounded-md bg-[var(--bp-accent-primary)] px-3 py-1 text-xs font-semibold text-white"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={tMin}
            max={tMax}
            value={t}
            step={(tMax - tMin) / 600 || 1}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            className="flex-1 accent-[var(--bp-accent-primary)]"
            aria-label="Scrub time"
          />
          <span className="w-20 text-right text-[11px] tabular-nums text-[var(--bp-text-muted)]">
            {formatDateShort(t)}
          </span>
          <button
            type="button"
            onClick={handleDownloadVideo}
            disabled={recording}
            title="Record the replay (single pass) and download as video"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--bp-border-subtle)] px-3 py-1 text-xs font-semibold text-[var(--bp-text-secondary)] hover:bg-[var(--bp-bg-primary)] disabled:opacity-60"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: recording ? COLORS.oor : COLORS.inRange }}
            />
            {recording ? "Recording…" : "Download MP4"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const HistoricalRebalances: React.FC<HistoricalRebalancesProps> = (props) => {
  const {
    records,
    summary,
    toDisplayPrice,
    priceUnitLabel,
    currentTick,
    token0Decimals,
    token1Decimals,
    token0Symbol,
    token1Symbol,
    hasOwner,
  } = props;
  const displayRecords = useMemo(() => orderRecordsForDisplay(records), [records]);
  const [showReplay, setShowReplay] = useState(false);
  const sqrtPriceX96 = useMemo(() => {
    try {
      return getSqrtRatioAtTick(currentTick);
    } catch {
      return null;
    }
  }, [currentTick]);

  if (!hasOwner) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--bp-text-muted)] gap-1">
        <span>Select an LP address to view their rebalance history</span>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--bp-text-muted)] gap-1">
        <span>No positions found for this address</span>
        <span className="text-xs text-[var(--bp-text-muted)]/70">
          No mints, holds, or rebalances were attributed to this LP in the window
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Summary stats */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 border-b border-[var(--bp-border-subtle)] text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-1 rounded-full" style={{ background: COLORS.oor }} />
          <span className="text-[var(--bp-text-muted)]">Rebalances</span>
          <span className="font-semibold text-[var(--bp-text-primary)] tabular-nums">{summary.count}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--bp-text-muted)]">Median time out of range</span>
          <span className="font-semibold text-[var(--bp-text-primary)] tabular-nums">
            {summary.medianTimeToRebalanceSec != null ? humanizeDuration(summary.medianTimeToRebalanceSec) : "—"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--bp-text-muted)]">Avg width</span>
          <span className="font-semibold text-[var(--bp-text-primary)] tabular-nums">
            {summary.avgWidthPct != null ? `±${(summary.avgWidthPct / 2).toFixed(1)}%` : "—"}
          </span>
        </div>
        {summary.holdCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full border" style={{ borderColor: COLORS.inRange }} />
            <span className="text-[var(--bp-text-muted)]">Holding</span>
            <span className="font-semibold text-[var(--bp-text-primary)] tabular-nums">{summary.holdCount}</span>
          </div>
        )}
        {summary.ongoingCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-1 rounded-full" style={{ background: COLORS.ongoing }} />
            <span className="text-[var(--bp-text-muted)]">Out of range now</span>
            <span className="font-semibold tabular-nums" style={{ color: COLORS.ongoing }}>
              {summary.ongoingCount}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowReplay(true)}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-[var(--bp-border-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--bp-text-secondary)] transition-colors hover:border-[var(--bp-accent-primary)] hover:text-[var(--bp-accent-primary)]"
          title="Animate this LP's liquidity distribution over time"
        >
          <span style={{ color: COLORS.inRange }}>▶</span> Replay distribution
        </button>
      </div>

      {/* Chart (left) + table (right) */}
      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row lg:divide-x divide-[var(--bp-border-subtle)]">
        {/* Timeline chart */}
        <div className="min-w-0 px-2 pt-3 lg:flex lg:min-h-0 lg:flex-col lg:w-[56%]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 pb-2 text-[10px] text-[var(--bp-text-muted)] lg:shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full" style={{ background: COLORS.inRange }} /> In range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1 rounded-full" style={{ background: COLORS.oor }} /> Out of range
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rotate-45" style={{ background: COLORS.marker }} /> Closed (forced)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rotate-45" style={{ background: COLORS.inRange }} /> Closed (in range)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rotate-45" style={{ background: COLORS.ongoing }} /> Partial trim
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full border" style={{ borderColor: COLORS.inRange }} /> Holding
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-0 h-0"
                style={{
                  borderTop: "4px solid transparent",
                  borderBottom: "4px solid transparent",
                  borderRight: `5px solid ${COLORS.ongoing}`,
                }}
              />{" "}
              Ongoing
            </span>
          </div>
          <div className="lg:min-h-0 lg:flex-1">
            <ParentSize debounceTime={120}>
              {({ width, height }) => (
                <RebalanceTimeline {...props} records={displayRecords} width={width} height={height} />
              )}
            </ParentSize>
          </div>
        </div>

        {/* Detail table */}
        <div className="max-h-[520px] min-w-0 overflow-auto px-3 py-3 lg:h-full lg:max-h-none lg:w-[44%]">
          <table className="w-full min-w-max text-[11px] border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--bp-text-muted)] border-b border-[var(--bp-border-subtle)]">
                <th className="whitespace-nowrap text-left font-semibold py-2 pr-3">Range ({priceUnitLabel})</th>
                <th className="whitespace-nowrap text-left font-semibold py-2 pr-3">Out of range</th>
                <th className="whitespace-nowrap text-right font-semibold py-2 pr-2">Rebalance</th>
              </tr>
            </thead>
            <tbody>
              {displayRecords.map((r) => {
                const band = displayBand(r, toDisplayPrice);
                const fullRange = isFullRangeForDisplay(r, band);
                const tag = r.ongoing ? "ongoing" : r.partial ? "partial" : null;
                const ooAt = r.outOfRangeAt;
                const tokenAmounts = formatPositionTokenAmounts(
                  r,
                  sqrtPriceX96,
                  token0Decimals,
                  token1Decimals,
                  token0Symbol,
                  token1Symbol,
                );
                const nftLabel = r.tokenId ? `#${r.tokenId}` : "—";
                const hoverTitle = `NFT: ${nftLabel}\nTokens in range: ${tokenAmounts}`;
                return (
                  <tr
                    key={r.id}
                    title={hoverTitle}
                    className="group border-b border-[var(--bp-border-subtle)]/50 last:border-b-0 hover:bg-[var(--bp-bg-primary)]/50 align-top"
                  >
                    <td className="relative py-1.5 pr-3 whitespace-nowrap">
                      <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden min-w-[230px] border border-[var(--bp-border-subtle)] bg-[var(--ts-surface)] px-2 py-1.5 text-[10px] shadow-sm group-hover:block">
                        <div className="font-semibold text-[var(--bp-text-primary)]">NFT {nftLabel}</div>
                        <div className="mt-0.5 text-[var(--bp-text-muted)]">
                          Tokens in range: <span className="text-[var(--bp-text-secondary)]">{tokenAmounts}</span>
                        </div>
                      </div>
                      <div className="font-mono text-[var(--bp-text-secondary)] tabular-nums">
                        {fullRange ? "Full Range" : `${formatPrice(band.low)} – ${formatPrice(band.high)}`}
                      </div>
                      <div className="text-[10px] text-[var(--bp-text-muted)] tabular-nums">
                        {fullRange ? "full width" : `±${(r.widthPct / 2).toFixed(1)}%`}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {ooAt != null ? (
                        <>
                          <div>
                            <span
                              className="font-semibold"
                              style={{ color: r.outSide === "above" ? COLORS.oor : COLORS.marker }}
                            >
                              {r.outSide === "above" ? "↑" : "↓"}
                            </span>{" "}
                            <span className="text-[var(--bp-text-muted)]">{formatDateShort(ooAt)}</span>
                          </div>
                          <div className="text-[10px] text-[var(--bp-text-muted)] tabular-nums">
                            @ {band.outPrice != null ? formatPrice(band.outPrice) : "—"}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-semibold" style={{ color: COLORS.inRange }}>
                            {r.isHold ? "holding" : "in range"}
                          </div>
                          <div className="text-[10px] text-[var(--bp-text-muted)]">
                            {r.isHold
                              ? formatDateShort(r.openedAt)
                              : r.rebalancedAt != null
                                ? formatDateShort(r.rebalancedAt)
                                : "—"}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums whitespace-nowrap">
                      {r.timeToRebalanceSec != null ? (
                        <>
                          <span
                            className="font-semibold"
                            style={{ color: tag ? COLORS.ongoing : "var(--bp-text-primary)" }}
                          >
                            {humanizeDuration(r.timeToRebalanceSec)}
                          </span>
                          {tag && <span className="text-[var(--bp-text-muted)]"> · {tag}</span>}
                        </>
                      ) : r.isHold ? (
                        <span className="text-[var(--bp-text-muted)]">holding</span>
                      ) : r.partial ? (
                        <span className="text-[var(--bp-text-muted)]">partial</span>
                      ) : (
                        // Proactive full close (in range) — still a rebalance.
                        <span className="font-semibold" style={{ color: COLORS.inRange }}>
                          closed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showReplay && (
        <RebalanceDistributionReplay
          records={records}
          otherPositions={props.otherPositions ?? []}
          priceSeries={props.priceSeries ?? []}
          toDisplayPrice={toDisplayPrice}
          nowSec={props.nowSec}
          priceUnitLabel={priceUnitLabel}
          currentTick={currentTick}
          currentPrice={props.currentPrice}
          token0Decimals={token0Decimals}
          token1Decimals={token1Decimals}
          token0UsdPrice={props.token0UsdPrice}
          token1UsdPrice={props.token1UsdPrice}
          tickSpacing={props.tickSpacing}
          onClose={() => setShowReplay(false)}
        />
      )}
    </div>
  );
};

HistoricalRebalances.displayName = "HistoricalRebalances";
