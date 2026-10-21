"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useCowswapRfqHistory } from "@/hooks/use-cowswap-rfq-history";
import { useBebopRfqHistory } from "@/hooks/use-bebop-rfq-history";
import { useZeroXRfqHistory } from "@/hooks/use-0x-rfq-history";
import { useOneInchRfqHistory } from "@/hooks/use-1inch-rfq-history";
import { useJupzRfqHistory } from "@/hooks/use-jupz-rfq-history";
import {
  REQUIRED_TIER_BY_ASSET,
  TIER_BANDS,
  getMarketMakerShortLabel,
  type RfqProvider,
  type TierLevel,
  type MarketMaker,
} from "@/lib/spread-tiers";
import { classifySession, type MarketSession } from "@/lib/market-session";
import { useAuthStore } from "@/lib/auth-store";
import { KRAKEN_SPACE_SLUG } from "@/lib/space-policy";

// ─── Config ──────────────────────────────────────────────────────────────────

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const DAYS = 7;
const HOURS_PER_DAY = 24;
const TARGET_NOTIONAL_USD = 10_000;

type BucketMinutes = 1 | 5 | 15 | 60 | 240 | 1440;

interface BucketOption {
  label: string;
  minutes: BucketMinutes;
  /** Disable this option when active to prevent hammering the renderer. */
  disabled?: boolean;
}

// 1d is intentionally disabled — at 1-day granularity the partial-fill story
// loses meaning (the whole day either breached or not at the median level).
// 1m generates 50k+ cells across all rows; we keep it enabled but flag it as
// "perf-heavy" via the tooltip on the picker button.
const BUCKET_OPTIONS: BucketOption[] = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 },
  { label: "1d", minutes: 1440, disabled: true },
];

const DEFAULT_BUCKET_MINUTES: BucketMinutes = 60;

// Row definitions: the attributed MM x venue combinations we render. Mirrors
// PROVIDERS_BY_MM in lib/spread-tiers.ts but kept explicit here for render order.
const ROWS: { mm: MarketMaker; venue: RfqProvider; venueLabel: string }[] = [
  { mm: "flowdesk", venue: "zerox", venueLabel: "0x" },
  { mm: "flowdesk", venue: "bebop", venueLabel: "Bebop" },
  { mm: "flowdesk", venue: "oneinch", venueLabel: "1inch" },
  { mm: "tokka", venue: "cowswap", venueLabel: "CowSwap" },
  { mm: "tokka", venue: "jupz", venueLabel: "JupZ" },
];

// Severity threshold: a bucket is "severe" once any sample exceeds 2× limit.
const SEVERE_RATIO = 2;

// ─── History point shape ────────────────────────────────────────────────────
interface HistoryPoint {
  timestamp: Date;
  midPrice: number;
  tiers: Map<number, { bidPrice: number; askPrice: number }>;
}

// ─── Helpers: per-capture worst-side bps ────────────────────────────────────

function pickNotional(tiers: Map<number, unknown>, target: number): number | null {
  if (tiers.size === 0) return null;
  const sorted = Array.from(tiers.keys()).sort((a, b) => a - b);
  for (const n of sorted) if (n >= target) return n;
  return sorted[sorted.length - 1] ?? null;
}

function worstSideBpsForPoint(pt: HistoryPoint): number | null {
  const mid = pt.midPrice;
  if (!mid || mid <= 0) return null;
  const notional = pickNotional(pt.tiers, TARGET_NOTIONAL_USD);
  if (notional === null) return null;
  const entry = pt.tiers.get(notional);
  if (!entry) return null;
  const bidBps =
    entry.bidPrice > 0 ? (Math.abs(mid - entry.bidPrice) / mid) * 10_000 : null;
  const askBps =
    entry.askPrice > 0 ? (Math.abs(entry.askPrice - mid) / mid) * 10_000 : null;
  if (bidBps === null && askBps === null) return null;
  if (bidBps === null) return askBps;
  if (askBps === null) return bidBps;
  return Math.max(bidBps, askBps);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ─── Bucket roll-up ─────────────────────────────────────────────────────────
interface Bucket {
  startMs: number;
  endMs: number;
  session: MarketSession;
  count: number;
  breachCount: number;
  /** Fraction of samples in the bucket whose worst-side bps exceeded the
   *  session's tier limit. We use this as a uniform-distribution proxy for
   *  "fraction of time in breach" inside the bucket. */
  breachFraction: number;
  breachMinutes: number;
  medianBps: number | null;
  p95Bps: number | null;
  maxBps: number | null;
  /** True when any sample exceeded SEVERE_RATIO × limit. */
  severe: boolean;
  limitBps: number;
}

interface HeatmapRow {
  mm: MarketMaker;
  mmShort: string;
  venue: RfqProvider;
  venueLabel: string;
  buckets: Bucket[];
  /** Total breach minutes summed across the row. */
  totalBreachMinutes: number;
  /** Distinct breach episodes (runs of consecutive buckets with any breach). */
  breachEventCount: number;
  /** Original points — needed for sub-bucket sparklines in the tooltip. */
  points: HistoryPoint[];
}

function getWindow(now: Date = new Date()): { start: Date; end: Date } {
  // End of the current hour (latest data we'd have); start = 7 days back.
  const endMs = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;
  const startMs = endMs - DAYS * DAY_MS;
  return { start: new Date(startMs), end: new Date(endMs) };
}

function buildBuckets(
  points: HistoryPoint[],
  windowStartMs: number,
  bucketMinutes: BucketMinutes,
  requiredTier: TierLevel
): Bucket[] {
  const bucketMs = bucketMinutes * MIN_MS;
  const totalBuckets = Math.round((DAYS * DAY_MS) / bucketMs);
  const samplesByBucket: number[][] = Array.from({ length: totalBuckets }, () => []);

  for (const pt of points) {
    const t = pt.timestamp.getTime();
    const idx = Math.floor((t - windowStartMs) / bucketMs);
    if (idx < 0 || idx >= totalBuckets) continue;
    const bps = worstSideBpsForPoint(pt);
    if (bps === null || !Number.isFinite(bps)) continue;
    samplesByBucket[idx].push(bps);
  }

  const buckets: Bucket[] = [];
  for (let i = 0; i < totalBuckets; i++) {
    const startMs = windowStartMs + i * bucketMs;
    const endMs = startMs + bucketMs;
    const midDate = new Date(startMs + bucketMs / 2);
    const session = classifySession(midDate);
    const limit = TIER_BANDS[requiredTier][session].maxBps;
    const samples = samplesByBucket[i];
    const sorted = [...samples].sort((a, b) => a - b);
    const med = median(samples);
    const p95 = percentile(sorted, 95);
    const max = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const breachCount = samples.filter((v) => v > limit).length;
    const breachFraction = samples.length > 0 ? breachCount / samples.length : 0;
    const breachMinutes = Math.round(breachFraction * bucketMinutes);
    const severe = max !== null && max > limit * SEVERE_RATIO;
    buckets.push({
      startMs,
      endMs,
      session,
      count: samples.length,
      breachCount,
      breachFraction,
      breachMinutes,
      medianBps: med,
      p95Bps: p95,
      maxBps: max,
      severe,
      limitBps: limit,
    });
  }

  return buckets;
}

function summariseRow(buckets: Bucket[]): {
  totalBreachMinutes: number;
  breachEventCount: number;
} {
  let totalBreachMinutes = 0;
  let breachEventCount = 0;
  let inBreachRun = false;
  for (const b of buckets) {
    totalBreachMinutes += b.breachMinutes;
    if (b.breachFraction > 0) {
      if (!inBreachRun) {
        breachEventCount += 1;
        inBreachRun = true;
      }
    } else {
      inBreachRun = false;
    }
  }
  return { totalBreachMinutes, breachEventCount };
}

// ─── CSV export ─────────────────────────────────────────────────────────────

const CSV_BUCKET_MINUTES: BucketMinutes = 15;

function csvEscape(value: string | number | boolean): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildComplianceCsv({
  asset,
  windowStart,
  pointsByVenue,
  requiredTier,
}: {
  asset: string;
  windowStart: Date;
  pointsByVenue: Partial<Record<RfqProvider, HistoryPoint[]>>;
  requiredTier: TierLevel;
}): string {
  const headers = [
    "asset",
    "tier",
    "venue",
    "bucket_start_utc",
    "bucket_end_utc",
    "session",
    "samples",
    "breach_count",
    "breach_fraction",
    "breach_minutes",
    "median_bps",
    "p95_bps",
    "max_bps",
    "limit_bps",
    "severe",
  ];
  const lines: string[] = [headers.join(",")];
  const fmtNum = (n: number | null) => (n === null ? "" : n.toFixed(2));
  for (const r of ROWS) {
    const pts = pointsByVenue[r.venue] ?? [];
    const buckets = buildBuckets(
      pts,
      windowStart.getTime(),
      CSV_BUCKET_MINUTES,
      requiredTier
    );
    for (const b of buckets) {
      const row: (string | number | boolean)[] = [
        asset,
        `T${requiredTier}`,
        r.venueLabel,
        new Date(b.startMs).toISOString(),
        new Date(b.endMs).toISOString(),
        b.session,
        b.count,
        b.breachCount,
        b.breachFraction.toFixed(4),
        b.breachMinutes,
        fmtNum(b.medianBps),
        fmtNum(b.p95Bps),
        fmtNum(b.maxBps),
        b.limitBps,
        b.severe,
      ];
      lines.push(row.map(csvEscape).join(","));
    }
  }
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string) {
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

// ─── Public component ───────────────────────────────────────────────────────
interface HoverState {
  rowIdx: number;
  bucketIdx: number;
  cellRect: DOMRect;
}

export function SlaHeatmapCalendar({ asset }: { asset: string }) {
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const currentSpace = spaces.find((s) => s.id === currentSpaceId);
  const [bucketMinutes, setBucketMinutes] =
    useState<BucketMinutes>(DEFAULT_BUCKET_MINUTES);
  const [hover, setHover] = useState<HoverState | null>(null);

  const cow = useCowswapRfqHistory(asset);
  const beb = useBebopRfqHistory(asset);
  const zx = useZeroXRfqHistory(asset);
  const oi = useOneInchRfqHistory(asset);
  const jz = useJupzRfqHistory(asset);

  const { start, end } = useMemo(() => getWindow(), []);
  const requiredTier: TierLevel =
    REQUIRED_TIER_BY_ASSET[asset] ??
    REQUIRED_TIER_BY_ASSET[asset.toUpperCase()] ??
    1;

  const pointsByVenue = useMemo<Partial<Record<RfqProvider, HistoryPoint[]>>>(
    () => ({
      cowswap: cow.points,
      bebop: beb.points,
      zerox: zx.points,
      oneinch: oi.points,
      jupz: jz.points,
    }),
    [cow.points, beb.points, zx.points, oi.points, jz.points]
  );

  const rows: HeatmapRow[] = useMemo(() => {
    return ROWS.map((r) => {
      const pts = pointsByVenue[r.venue] ?? [];
      const buckets = buildBuckets(pts, start.getTime(), bucketMinutes, requiredTier);
      const { totalBreachMinutes, breachEventCount } = summariseRow(buckets);
      return {
        mm: r.mm,
        mmShort: getMarketMakerShortLabel(r.mm, currentSpace?.slug),
        venue: r.venue,
        venueLabel: r.venueLabel,
        buckets,
        totalBreachMinutes,
        breachEventCount,
        points: pts,
      };
    });
  }, [currentSpace?.slug, pointsByVenue, start, bucketMinutes, requiredTier]);

  const totals = useMemo(() => {
    let totalBreachMinutes = 0;
    let breachEvents = 0;
    let totalBuckets = 0;
    for (const r of rows) {
      totalBreachMinutes += r.totalBreachMinutes;
      breachEvents += r.breachEventCount;
      totalBuckets += r.buckets.length;
    }
    const totalMinutes = (DAYS * 24 * 60) * rows.length;
    const breachPct = totalMinutes > 0 ? (totalBreachMinutes / totalMinutes) * 100 : 0;
    return { totalBreachMinutes, breachEvents, totalBuckets, breachPct };
  }, [rows]);

  const isLoading =
    cow.isLoading && beb.isLoading && zx.isLoading && oi.isLoading && jz.isLoading;

  const showCsvDownload = currentSpace?.slug === KRAKEN_SPACE_SLUG;
  const handleDownloadCsv = useCallback(() => {
    const csv = buildComplianceCsv({
      asset,
      windowStart: start,
      pointsByVenue,
      requiredTier,
    });
    const stamp = (d: Date) => d.toISOString().slice(0, 10);
    downloadCsv(`${asset}-compliance-pulse-${stamp(start)}_${stamp(end)}-15m.csv`, csv);
  }, [asset, start, end, pointsByVenue, requiredTier]);

  const dayLabels = useMemo<DayLabel[]>(() => {
    const out: DayLabel[] = [];
    const todayKey = new Date().toDateString();
    for (let d = 0; d < DAYS; d++) {
      const dayStart = new Date(start.getTime() + d * DAY_MS);
      const weekday = dayStart.toLocaleDateString(undefined, { weekday: "short" });
      const dow = dayStart.getDay();
      out.push({
        weekday,
        day: dayStart.getDate(),
        isWeekend: dow === 0 || dow === 6,
        isToday: dayStart.toDateString() === todayKey,
      });
    }
    return out;
  }, [start]);

  // Hourly session pattern for the band — always one entry per hour, regardless
  // of the active bucket size, so the band stays readable.
  const sessionByHour = useMemo<MarketSession[]>(() => {
    const out: MarketSession[] = [];
    for (let i = 0; i < DAYS * HOURS_PER_DAY; i++) {
      out.push(classifySession(new Date(start.getTime() + i * HOUR_MS + HOUR_MS / 2)));
    }
    return out;
  }, [start]);

  const hoveredRow = hover ? rows[hover.rowIdx] : null;
  const hoveredBucket = hoveredRow ? hoveredRow.buckets[hover!.bucketIdx] : null;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-line-hard)",
        borderRadius: 2,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 3px rgba(10,9,6,0.04)",
      }}
    >
      <Corners />

      <Plate
        asset={asset}
        requiredTier={requiredTier}
        totals={totals}
        windowStart={start}
        windowEnd={end}
        isLoading={isLoading}
        bucketMinutes={bucketMinutes}
        onBucketChange={setBucketMinutes}
        showCsvDownload={showCsvDownload}
        onDownloadCsv={handleDownloadCsv}
      />

      <SessionBandRow sessionByHour={sessionByHour} />

      <DayAxis days={dayLabels} />

      <HourAxis />

      {rows.map((row, rowIdx) => (
        <HeatmapDataRow
          key={`${row.mm}-${row.venue}`}
          row={row}
          rowIdx={rowIdx}
          bucketMinutes={bucketMinutes}
          onHoverChange={setHover}
        />
      ))}

      <Legend totals={totals} bucketMinutes={bucketMinutes} />

      {hover && hoveredRow && hoveredBucket && (
        <HoverTooltip
          row={hoveredRow}
          bucket={hoveredBucket}
          cellRect={hover.cellRect}
          bucketMinutes={bucketMinutes}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function Corners() {
  const s = 7;
  const inset = 5;
  const border = "1.5px solid var(--ts-ink-0)";
  return (
    <>
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: inset,
          left: inset,
          width: s,
          height: s,
          borderTop: border,
          borderLeft: border,
          zIndex: 5,
        }}
      />
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          bottom: inset,
          right: inset,
          width: s,
          height: s,
          borderBottom: border,
          borderRight: border,
          zIndex: 5,
        }}
      />
    </>
  );
}

function Plate({
  asset,
  requiredTier,
  totals,
  windowStart,
  windowEnd,
  isLoading,
  bucketMinutes,
  onBucketChange,
  showCsvDownload,
  onDownloadCsv,
}: {
  asset: string;
  requiredTier: TierLevel;
  totals: {
    totalBreachMinutes: number;
    breachEvents: number;
    totalBuckets: number;
    breachPct: number;
  };
  windowStart: Date;
  windowEnd: Date;
  isLoading: boolean;
  bucketMinutes: BucketMinutes;
  onBucketChange: (m: BucketMinutes) => void;
  showCsvDownload?: boolean;
  onDownloadCsv?: () => void;
}) {
  const bands = TIER_BANDS[requiredTier];
  const fmt = (n: number) => (Number.isInteger(n) ? `${n}` : n.toString());
  const tierBg =
    requiredTier === 3
      ? "var(--ts-bad)"
      : requiredTier === 2
        ? "var(--ts-warn)"
        : "var(--ts-good)";
  const rangeLabel = `${windowStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${windowEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const totalBreachLabel = formatMinutesShort(totals.totalBreachMinutes);

  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "1fr auto",
        gap: 28,
        padding: "16px 20px",
        background: "var(--ts-ink-0)",
        color: "var(--ts-ink-inv)",
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3">
          <span
            className="font-semibold"
            style={{
              fontFamily: "var(--bp-font-text)",
              fontSize: 22,
              letterSpacing: "-0.02em",
              color: "var(--ts-ink-inv)",
            }}
          >
            {asset} · compliance pulse
          </span>
          <span
            className="font-mono font-bold uppercase"
            style={{
              fontSize: 10,
              padding: "3px 7px 4px",
              borderRadius: 1,
              color: "var(--ts-ink-0)",
              background: tierBg,
              letterSpacing: "0.16em",
              lineHeight: 1,
            }}
          >
            T{requiredTier}
          </span>
        </div>
        <div className="flex items-center gap-[10px] mt-1">
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 9.5,
              color: "var(--ts-ink-4)",
              letterSpacing: "0.18em",
              fontWeight: 500,
            }}
          >
            7D · {rangeLabel}
            {isLoading && " · loading…"}
          </span>
          <span style={{ color: "var(--ts-ink-2)" }}>·</span>
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 9.5,
              color: "var(--ts-ink-4)",
              letterSpacing: "0.22em",
              fontWeight: 600,
            }}
          >
            Bucket
          </span>
          <BucketPicker
            value={bucketMinutes}
            onChange={onBucketChange}
            options={BUCKET_OPTIONS}
          />
        </div>
      </div>
      <div className="flex items-stretch gap-6">
        <PlateThreshold
          label="Market Hrs"
          range={`${fmt(bands.market.minBps)}–${fmt(bands.market.maxBps)}`}
          first
        />
        <PlateThreshold
          label="Pre / Post"
          range={`${fmt(bands.prePost.minBps)}–${fmt(bands.prePost.maxBps)}`}
        />
        <PlateThreshold
          label="Weekend"
          range={`${fmt(bands.weekend.minBps)}–${fmt(bands.weekend.maxBps)}`}
        />
        <PlateStat
          label="Time in breach"
          value={
            <>
              {totalBreachLabel}
              <small
                style={{
                  fontSize: 10,
                  color: "var(--ts-ink-4)",
                  fontWeight: 500,
                  marginLeft: 2,
                }}
              >
                · {totals.breachPct.toFixed(1)}%
              </small>
            </>
          }
          tone="bad"
        />
        <PlateStat
          label="Breach events"
          value={String(totals.breachEvents)}
          tone={totals.breachEvents > 0 ? "bad" : "neutral"}
        />
        {showCsvDownload && onDownloadCsv && (
          <CsvDownloadButton onClick={onDownloadCsv} disabled={isLoading} />
        )}
      </div>
    </div>
  );
}

function CsvDownloadButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-mono uppercase self-center"
      style={{
        marginLeft: 4,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.18em",
        padding: "7px 12px 8px",
        border: "1px solid var(--ts-ink-2)",
        borderRadius: 1,
        background: "transparent",
        color: disabled ? "var(--ts-ink-3)" : "var(--ts-ink-inv)",
        cursor: disabled ? "not-allowed" : "pointer",
        lineHeight: 1,
      }}
      title="Download past 7 days at 15-minute granularity as CSV"
    >
      Download CSV
    </button>
  );
}

function BucketPicker({
  value,
  onChange,
  options,
}: {
  value: BucketMinutes;
  onChange: (m: BucketMinutes) => void;
  options: BucketOption[];
}) {
  return (
    <div
      className="inline-flex"
      style={{
        border: "1px solid var(--ts-ink-2)",
        borderRadius: 1,
        background: "var(--ts-ink-1)",
        overflow: "hidden",
      }}
    >
      {options.map((opt, i) => {
        const active = opt.minutes === value && !opt.disabled;
        const isDisabled = !!opt.disabled;
        return (
          <button
            key={opt.label}
            type="button"
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(opt.minutes)}
            className="font-mono uppercase"
            style={{
              fontSize: 9.5,
              fontWeight: active ? 700 : 600,
              letterSpacing: "0.08em",
              padding: "3px 9px 4px",
              color: active
                ? "var(--ts-ink-0)"
                : isDisabled
                  ? "var(--ts-ink-2)"
                  : "var(--ts-ink-4)",
              background: active ? "var(--ts-ink-inv)" : "transparent",
              borderRight: i < options.length - 1 ? "1px solid var(--ts-ink-2)" : "none",
              cursor: isDisabled ? "not-allowed" : "pointer",
              lineHeight: 1.2,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PlateThreshold({
  label,
  range,
  first,
}: {
  label: string;
  range: string;
  first?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 items-start"
      style={{
        paddingLeft: first ? 0 : 18,
        borderLeft: first ? "none" : "1px dashed var(--ts-ink-2)",
      }}
    >
      <span
        className="font-mono font-bold uppercase"
        style={{ fontSize: 9, color: "var(--ts-ink-4)", letterSpacing: "0.22em" }}
      >
        {label}
      </span>
      <span
        className="font-mono font-bold"
        style={{
          fontSize: 14,
          letterSpacing: "-0.015em",
          color: "var(--ts-ink-inv)",
          fontFeatureSettings: "var(--tnum)" as never,
          lineHeight: 1,
        }}
      >
        {range}
        <small
          style={{
            fontSize: 10,
            color: "var(--ts-ink-4)",
            fontWeight: 500,
            marginLeft: 2,
          }}
        >
          bps
        </small>
      </span>
    </div>
  );
}

function PlateStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: "bad" | "warn" | "neutral";
}) {
  const color =
    tone === "bad"
      ? "var(--ts-bad)"
      : tone === "warn"
        ? "var(--ts-warn)"
        : "var(--ts-ink-inv)";
  return (
    <div
      className="flex flex-col gap-1 items-start"
      style={{
        paddingLeft: 18,
        borderLeft: "1px dashed var(--ts-ink-2)",
      }}
    >
      <span
        className="font-mono font-bold uppercase"
        style={{ fontSize: 9, color: "var(--ts-ink-4)", letterSpacing: "0.22em" }}
      >
        {label}
      </span>
      <span
        className="font-mono font-bold"
        style={{
          fontSize: 14,
          letterSpacing: "-0.015em",
          color,
          fontFeatureSettings: "var(--tnum)" as never,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

const ROW_LABEL_WIDTH = 200;
const LABEL_COL_GRID = `${ROW_LABEL_WIDTH}px 1fr`;

function SessionBandRow({ sessionByHour }: { sessionByHour: MarketSession[] }) {
  const bandBg = (s: MarketSession): React.CSSProperties => {
    if (s === "market")
      return { background: "var(--ts-good)", color: "var(--ts-ink-inv)" };
    if (s === "weekend")
      return { background: "var(--ts-bad)", color: "var(--ts-ink-inv)" };
    return {
      background:
        "repeating-linear-gradient(45deg, rgba(212,154,46,0.25) 0, rgba(212,154,46,0.25) 3px, rgba(212,154,46,0.45) 3px, rgba(212,154,46,0.45) 6px)",
      color: "var(--ts-ink-1)",
    };
  };

  const dayRanges = useMemo(() => {
    const perDay: Array<{ session: MarketSession; start: number; end: number }[]> = [];
    for (let d = 0; d < DAYS; d++) {
      const ranges: { session: MarketSession; start: number; end: number }[] = [];
      const dayOffset = d * HOURS_PER_DAY;
      for (let h = 0; h < HOURS_PER_DAY; h++) {
        const s = sessionByHour[dayOffset + h];
        if (s === undefined) continue;
        const prev = ranges[ranges.length - 1];
        if (prev && prev.session === s && prev.end === h) prev.end = h + 1;
        else ranges.push({ session: s, start: h, end: h + 1 });
      }
      perDay.push(ranges);
    }
    return perDay;
  }, [sessionByHour]);

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: LABEL_COL_GRID,
        borderBottom: "1px solid var(--ts-line-hard)",
        height: 24,
        background: "var(--ts-surface-3)",
      }}
    >
      <div
        className="flex items-center"
        style={{
          padding: "3px 12px",
          borderRight: "1px solid var(--ts-line-hard)",
          background: "var(--ts-surface-2)",
          color: "var(--ts-ink-2)",
          fontFamily: "var(--bp-font-numeric)" as never,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        Session
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
        {dayRanges.map((ranges, di) => (
          <div
            key={di}
            className="grid relative"
            style={{
              gridTemplateColumns: `repeat(${HOURS_PER_DAY}, 1fr)`,
              borderRight: di === DAYS - 1 ? "none" : "1px solid var(--ts-line-hard)",
            }}
          >
            {ranges.map((r, ri) => {
              const span = r.end - r.start;
              const style: React.CSSProperties = {
                gridColumn: `${r.start + 1} / span ${span}`,
                ...bandBg(r.session),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--bp-font-numeric)" as never,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: span >= 7 ? "0.22em" : "0.18em",
                textTransform: "uppercase",
              };
              const label =
                r.session === "market"
                  ? span >= 5
                    ? "MARKET"
                    : "MKT"
                  : r.session === "weekend"
                    ? span >= 12
                      ? "WEEKEND"
                      : "WKND"
                    : span >= 3
                      ? r.start < 12
                        ? "PRE"
                        : "POST"
                      : "";
              return (
                <div key={ri} style={style}>
                  {label}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

type DayLabel = {
  weekday: string;
  day: number;
  isWeekend: boolean;
  isToday: boolean;
};

function DayAxis({ days }: { days: DayLabel[] }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: LABEL_COL_GRID,
        background: "var(--ts-surface-2)",
        borderBottom: "1px solid var(--ts-line)",
        height: 22,
      }}
    >
      <div style={{ borderRight: "1px solid var(--ts-line)" }} />
      <div className="grid" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
        {days.map((d, i) => (
          <div
            key={i}
            className="flex items-center justify-center"
            style={{
              borderRight: i === DAYS - 1 ? "none" : "1px solid var(--ts-line)",
              fontFamily: "var(--bp-font-numeric)" as never,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: d.isToday
                ? "var(--ts-ink-inv)"
                : d.isWeekend
                  ? "var(--ts-bad)"
                  : "var(--ts-ink-1)",
              background: d.isToday
                ? "var(--ts-ink-0)"
                : d.isWeekend
                  ? "rgba(196,80,75,0.04)"
                  : undefined,
            }}
          >
            {d.weekday}
            <small
              style={{
                fontSize: 8,
                color: d.isToday ? "var(--ts-ink-4)" : "var(--ts-ink-3)",
                fontWeight: 500,
                letterSpacing: "0.04em",
                marginLeft: 4,
              }}
            >
              {d.day}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function HourAxis() {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: LABEL_COL_GRID,
        background: "var(--ts-surface-2)",
        borderBottom: "1px solid var(--ts-line)",
        height: 14,
      }}
    >
      <div style={{ borderRight: "1px solid var(--ts-line)" }} />
      <div className="grid" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
        {Array.from({ length: DAYS }).map((_, di) => (
          <div
            key={di}
            className="grid"
            style={{
              gridTemplateColumns: "repeat(4, 1fr)",
              borderRight: di === DAYS - 1 ? "none" : "1px solid var(--ts-line)",
            }}
          >
            {["00", "06", "12", "18"].map((tick, ti) => (
              <div
                key={tick}
                className="flex items-center justify-center"
                style={{
                  fontFamily: "var(--bp-font-numeric)" as never,
                  fontSize: 7,
                  color: "var(--ts-ink-4)",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  borderRight:
                    ti === 3 ? "none" : "1px dotted var(--ts-line-soft)",
                }}
              >
                {tick}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapDataRow({
  row,
  rowIdx,
  bucketMinutes,
  onHoverChange,
}: {
  row: HeatmapRow;
  rowIdx: number;
  bucketMinutes: BucketMinutes;
  onHoverChange: (h: HoverState | null) => void;
}) {
  const bucketsPerDay = (24 * 60) / bucketMinutes;
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: LABEL_COL_GRID,
        borderBottom: "1px solid var(--ts-line-soft)",
      }}
    >
      <div
        className="flex items-center gap-[10px]"
        style={{
          padding: "8px 14px",
          background: "var(--ts-surface-2)",
          borderRight: "1px solid var(--ts-line)",
          minHeight: 36,
        }}
      >
        <span
          className="font-mono font-bold"
          style={{
            fontSize: 10,
            padding: "1px 5px 2px",
            borderRadius: 1,
            letterSpacing: "0.04em",
            lineHeight: 1,
            background:
              row.mm === "flowdesk" ? "var(--ts-ink-0)" : "var(--ts-ink-1)",
            color: "var(--ts-ink-inv)",
          }}
        >
          {row.mmShort}
        </span>
        <span
          className="font-mono font-semibold"
          style={{
            fontSize: 11,
            color: "var(--ts-ink-1)",
            letterSpacing: "0.02em",
            flex: 1,
          }}
        >
          {row.venueLabel}
        </span>
        <span
          className="font-mono font-bold"
          style={{
            fontSize: 10,
            color: row.breachEventCount > 0 ? "var(--ts-bad)" : "var(--ts-ink-3)",
            letterSpacing: "-0.01em",
            fontFeatureSettings: "var(--tnum)" as never,
          }}
          title={`${row.breachEventCount} breach episodes · ${formatMinutesShort(row.totalBreachMinutes)} in breach`}
        >
          {row.breachEventCount}×
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
        {Array.from({ length: DAYS }).map((_, di) => (
          <div
            key={di}
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${bucketsPerDay}, 1fr)`,
              borderRight: di === DAYS - 1 ? "none" : "1px solid var(--ts-line)",
            }}
          >
            {Array.from({ length: bucketsPerDay }).map((_, bi) => {
              const idx = di * bucketsPerDay + bi;
              const bucket = row.buckets[idx];
              return (
                <HeatmapCell
                  key={bi}
                  bucket={bucket}
                  bucketMinutes={bucketMinutes}
                  onMouseEnter={(rect) =>
                    onHoverChange({ rowIdx, bucketIdx: idx, cellRect: rect })
                  }
                  onMouseLeave={() => onHoverChange(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapCell({
  bucket,
  bucketMinutes,
  onMouseEnter,
  onMouseLeave,
}: {
  bucket: Bucket | undefined;
  bucketMinutes: BucketMinutes;
  onMouseEnter: (rect: DOMRect) => void;
  onMouseLeave: () => void;
}) {
  const empty = !bucket || bucket.count === 0;

  // Show duration label only when there's enough cell area to be readable.
  // 1m / 5m / 15m cells are too narrow → suppress the label.
  const showDurationLabel = bucketMinutes >= 60 && !empty && (bucket?.breachMinutes ?? 0) > 0;

  let baseStyle: React.CSSProperties;
  if (empty) {
    baseStyle = {
      background:
        "repeating-linear-gradient(45deg, var(--ts-surface-3) 0, var(--ts-surface-3) 3px, var(--ts-surface-4) 3px, var(--ts-surface-4) 6px)",
      opacity: 0.5,
    };
  } else if (bucket!.breachFraction >= 0.999) {
    // full-bucket breach: solid fill
    baseStyle = { background: bucket!.severe ? "#8B2828" : "#C4504B" };
  } else {
    baseStyle = { background: "#D6E8D8" };
  }

  return (
    <div
      onMouseEnter={(e) => onMouseEnter(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onMouseLeave}
      style={{
        height: 36,
        position: "relative",
        cursor: "pointer",
        overflow: "hidden",
        ...baseStyle,
      }}
      onMouseOver={(e) => {
        (e.currentTarget as HTMLDivElement).style.outline =
          "1.5px solid var(--ts-ink-0)";
        (e.currentTarget as HTMLDivElement).style.outlineOffset = "-1px";
        (e.currentTarget as HTMLDivElement).style.zIndex = "2";
      }}
      onMouseOut={(e) => {
        (e.currentTarget as HTMLDivElement).style.outline = "none";
        (e.currentTarget as HTMLDivElement).style.zIndex = "auto";
      }}
    >
      {/* Partial breach bar (only when not full and not empty) */}
      {!empty && bucket!.breachFraction > 0 && bucket!.breachFraction < 0.999 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${Math.max(2, Math.round(bucket!.breachFraction * 100))}%`,
            background: bucket!.severe ? "#8B2828" : "#C4504B",
            pointerEvents: "none",
          }}
        />
      )}
      {showDurationLabel && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: 1,
            right: 2,
            fontFamily: "var(--bp-font-numeric)" as never,
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color:
              bucket!.breachFraction >= 0.999
                ? "rgba(255,255,255,0.7)"
                : "rgba(10,9,6,0.55)",
            pointerEvents: "none",
          }}
        >
          {bucket!.breachMinutes}m
        </span>
      )}
    </div>
  );
}

function HoverTooltip({
  row,
  bucket,
  cellRect,
  bucketMinutes,
}: {
  row: HeatmapRow;
  bucket: Bucket;
  cellRect: DOMRect;
  bucketMinutes: BucketMinutes;
}) {
  // Position the tooltip just above the hovered cell, anchored within the
  // viewport. We use position: fixed so it can escape any overflow:hidden
  // ancestor (including this card's own clipped border).
  const tooltipWidth = 260;
  const left = Math.min(
    Math.max(8, cellRect.left + cellRect.width / 2 - tooltipWidth / 2),
    window.innerWidth - tooltipWidth - 8
  );
  const top = Math.max(8, cellRect.top - 12 - 200);

  // Sub-bucket sparkline data: only show when the active bucket is wide enough
  // (1m bucket has nothing to subdivide; 5m gives only 5 points → noisy).
  const showSparkline = bucketMinutes >= 15;
  const sparklineData = useMemo(() => {
    if (!showSparkline) return null;
    return computeSparkline(row.points, bucket);
  }, [row.points, bucket, showSparkline]);

  const bucketDate = new Date(bucket.startMs);
  const dayLabel = bucketDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = bucketDate.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left,
        top,
        width: tooltipWidth,
        background: "var(--ts-ink-0)",
        color: "var(--ts-ink-inv)",
        borderRadius: 2,
        padding: "10px 12px",
        zIndex: 50,
        boxShadow: "0 4px 16px rgba(10,9,6,0.3)",
        pointerEvents: "none",
        fontFamily: "var(--bp-font-numeric)" as never,
      }}
    >
      <div
        className="flex items-baseline justify-between"
        style={{
          paddingBottom: 7,
          marginBottom: 7,
          borderBottom: "1px dashed var(--ts-ink-2)",
          gap: 10,
        }}
      >
        <span
          className="font-mono font-bold"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.06em",
            color: "var(--ts-ink-inv)",
          }}
        >
          {row.mmShort} · {row.venueLabel} · {dayLabel} {timeLabel}
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 8.5,
            color: "var(--ts-ink-4)",
            letterSpacing: "0.1em",
          }}
        >
          {bucket.breachMinutes}m / {bucketMinutes}m
        </span>
      </div>

      {showSparkline && sparklineData && (
        <SparklineBlock data={sparklineData} limit={bucket.limitBps} />
      )}

      <TooltipRows bucket={bucket} />
    </div>
  );
}

function SparklineBlock({
  data,
  limit,
}: {
  data: { points: number[]; minutesPerPoint: number; sampleCount: number };
  limit: number;
}) {
  const w = 240;
  const h = 38;
  const max = Math.max(limit * 1.6, ...data.points, 1);
  const min = 0;
  const yFor = (v: number) =>
    h - ((v - min) / (max - min)) * h;
  const xFor = (i: number) => (i / Math.max(1, data.points.length - 1)) * w;

  const dPath = data.points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`)
    .join(" ");

  // Filled area only above limit
  let dFill = "";
  if (data.points.length > 0) {
    const segs: string[] = [];
    let inSeg = false;
    for (let i = 0; i < data.points.length; i++) {
      const v = data.points[i];
      if (v > limit) {
        if (!inSeg) {
          segs.push(`M ${xFor(i).toFixed(1)},${yFor(limit).toFixed(1)}`);
          inSeg = true;
        }
        segs.push(`L ${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`);
      } else if (inSeg) {
        segs.push(`L ${xFor(i - 1).toFixed(1)},${yFor(limit).toFixed(1)} Z`);
        inSeg = false;
      }
    }
    if (inSeg) {
      const lastIdx = data.points.length - 1;
      segs.push(`L ${xFor(lastIdx).toFixed(1)},${yFor(limit).toFixed(1)} Z`);
    }
    dFill = segs.join(" ");
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "6px 0 8px",
        borderBottom: "1px dashed var(--ts-ink-2)",
        marginBottom: 6,
      }}
    >
      <span
        className="font-mono font-semibold uppercase"
        style={{
          fontSize: 7.5,
          color: "var(--ts-ink-4)",
          letterSpacing: "0.18em",
        }}
      >
        Inside this bucket · {data.minutesPerPoint}m resolution
      </span>
      <div
        style={{
          height: h,
          background: "var(--ts-ink-1)",
          position: "relative",
          overflow: "hidden",
          borderRadius: 1,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
        >
          <line
            x1={0}
            y1={yFor(limit)}
            x2={w}
            y2={yFor(limit)}
            stroke="#C4504B"
            strokeWidth={0.6}
            strokeDasharray="2 2"
            opacity={0.7}
          />
          <text
            x={w - 4}
            y={yFor(limit) - 3}
            fontFamily="var(--bp-font-numeric)"
            fontSize={6.5}
            fill="#C4504B"
            textAnchor="end"
            fontWeight={700}
            letterSpacing="0.1em"
          >
            {Math.round(limit)}bps
          </text>
          {dFill && <path d={dFill} fill="#C4504B" opacity={0.4} />}
          {dPath && (
            <path d={dPath} stroke="var(--ts-ink-inv)" strokeWidth={1.4} fill="none" />
          )}
        </svg>
      </div>
    </div>
  );
}

function TooltipRows({ bucket }: { bucket: Bucket }) {
  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      <TtRow
        label="Time in breach"
        value={`${bucket.breachMinutes} min`}
        tone={bucket.breachMinutes > 0 ? "bad" : "neutral"}
      />
      <TtRow
        label="Median bps"
        value={bucket.medianBps !== null ? Math.round(bucket.medianBps).toString() : "—"}
        tone={
          bucket.medianBps !== null && bucket.medianBps > bucket.limitBps
            ? "bad"
            : bucket.medianBps !== null && bucket.medianBps > bucket.limitBps * 0.9
              ? "warn"
              : "neutral"
        }
      />
      <TtRow
        label="P95 bps"
        value={bucket.p95Bps !== null ? Math.round(bucket.p95Bps).toString() : "—"}
        tone={
          bucket.p95Bps !== null && bucket.p95Bps > bucket.limitBps ? "bad" : "neutral"
        }
      />
      <TtRow
        label="Max bps"
        value={bucket.maxBps !== null ? Math.round(bucket.maxBps).toString() : "—"}
        tone={
          bucket.maxBps !== null && bucket.maxBps > bucket.limitBps ? "bad" : "neutral"
        }
      />
      <TtRow label="Tier limit" value={`≤ ${Math.round(bucket.limitBps)} bps`} tone="neutral" />
      <TtRow label="RFQs" value={String(bucket.count)} tone="neutral" />
    </div>
  );
}

function TtRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "bad" | "warn" | "neutral";
}) {
  const color =
    tone === "bad"
      ? "var(--ts-bad)"
      : tone === "warn"
        ? "var(--ts-warn)"
        : "var(--ts-ink-inv)";
  return (
    <div
      className="flex justify-between"
      style={{
        gap: 10,
        fontFamily: "var(--bp-font-numeric)" as never,
        fontSize: 9.5,
        color: "var(--ts-ink-4)",
      }}
    >
      <span>{label}</span>
      <span
        style={{
          color,
          fontWeight: 700,
          letterSpacing: "-0.005em",
          fontFeatureSettings: "var(--tnum)" as never,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function computeSparkline(
  points: HistoryPoint[],
  bucket: Bucket
): { points: number[]; minutesPerPoint: number; sampleCount: number } {
  // Always emit ~60 sub-points (1m granularity for 1h bucket; 4m for 4h; etc.)
  const subBuckets = 60;
  const span = bucket.endMs - bucket.startMs;
  const subMs = span / subBuckets;
  const minutesPerPoint = Math.max(1, Math.round(subMs / MIN_MS));
  const samplesByBin: number[][] = Array.from({ length: subBuckets }, () => []);
  let total = 0;
  for (const pt of points) {
    const t = pt.timestamp.getTime();
    if (t < bucket.startMs || t >= bucket.endMs) continue;
    const bps = worstSideBpsForPoint(pt);
    if (bps === null) continue;
    const idx = Math.min(subBuckets - 1, Math.floor((t - bucket.startMs) / subMs));
    samplesByBin[idx].push(bps);
    total++;
  }
  // Forward-fill empty bins with the last seen value to keep the trace
  // continuous; otherwise skip with 0 (rendered below the limit line).
  const out: number[] = [];
  let last = 0;
  for (const bin of samplesByBin) {
    if (bin.length === 0) {
      out.push(last);
      continue;
    }
    const v = median(bin) ?? 0;
    out.push(v);
    last = v;
  }
  return { points: out, minutesPerPoint, sampleCount: total };
}

function Legend({
  totals,
  bucketMinutes,
}: {
  totals: {
    totalBreachMinutes: number;
    breachEvents: number;
    totalBuckets: number;
    breachPct: number;
  };
  bucketMinutes: BucketMinutes;
}) {
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "auto 1fr auto",
        gap: 24,
        padding: "12px 16px",
        background: "var(--ts-surface-2)",
        borderTop: "1px solid var(--ts-line-hard)",
      }}
    >
      <div className="flex items-center" style={{ gap: 10 }}>
        <span
          className="font-mono font-bold uppercase"
          style={{
            fontSize: 8.5,
            color: "var(--ts-ink-3)",
            letterSpacing: "0.18em",
          }}
        >
          Cell fill
        </span>
        <div
          className="flex items-center"
          style={{
            border: "1px solid var(--ts-line-hard)",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
            <div key={frac} style={{ width: 30, height: 18, position: "relative", background: "#D6E8D8" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${frac * 100}%`,
                  background: "#C4504B",
                }}
              />
            </div>
          ))}
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            color: "var(--ts-ink-3)",
            letterSpacing: "0.08em",
          }}
        >
          0% → 100% time in breach
        </span>
      </div>

      <div
        className="flex items-center justify-center"
        style={{
          gap: 14,
          fontFamily: "var(--bp-font-numeric)" as never,
          fontSize: 8.5,
          color: "var(--ts-ink-3)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        <LegendSwatch label="Market" bg="var(--ts-good)" />
        <LegendSwatch
          label="Pre / Post"
          bg="repeating-linear-gradient(45deg, rgba(212,154,46,0.25) 0, rgba(212,154,46,0.25) 3px, rgba(212,154,46,0.45) 3px, rgba(212,154,46,0.45) 6px)"
        />
        <LegendSwatch label="Weekend" bg="var(--ts-bad)" />
      </div>

      <div
        className="font-mono uppercase"
        style={{
          fontSize: 9,
          color: "var(--ts-ink-3)",
          letterSpacing: "0.14em",
          fontWeight: 500,
        }}
      >
        <strong style={{ color: "var(--ts-ink-0)", fontWeight: 700 }}>
          {totals.totalBuckets}
        </strong>{" "}
        buckets · {bucketLabel(bucketMinutes)} resolution ·{" "}
        <strong style={{ color: "var(--ts-ink-0)", fontWeight: 700 }}>
          {formatMinutesShort(totals.totalBreachMinutes)}
        </strong>{" "}
        total breach time
      </div>
    </div>
  );
}

function LegendSwatch({ label, bg }: { label: string; bg: string }) {
  return (
    <span className="inline-flex items-center">
      <span
        style={{
          display: "inline-block",
          width: 14,
          height: 9,
          marginRight: 5,
          background: bg,
          border: "1px solid var(--ts-line-hard)",
          verticalAlign: "middle",
        }}
      />
      {label}
    </span>
  );
}

// ─── Misc helpers ───────────────────────────────────────────────────────────
function formatMinutesShort(min: number): string {
  if (min < 1) return "0m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

function bucketLabel(bucketMinutes: BucketMinutes): string {
  if (bucketMinutes < 60) return `${bucketMinutes}m`;
  if (bucketMinutes === 60) return "1h";
  if (bucketMinutes === 240) return "4h";
  return "1d";
}
