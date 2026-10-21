"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketSession } from "@/lib/market-session";
import type { RfqProvider } from "@/lib/spread-tiers";
import { getDemoDailyBuckets } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

// ─── API contract ───────────────────────────────────────────────────────────
// Matches GET /api/rfq/daily-buckets on the Solana indexer.
// See docs: rfq-daily-buckets-frontend-integration.md

export interface DailyBucketRow {
  date: string; // ET calendar date, e.g. "2026-04-22"
  session_bucket: MarketSession;
  asset: string;
  provider: RfqProvider;
  notional_usd: string;
  /** Daily mean of worst_side_bps for the (asset, provider, session) bucket. */
  mean_bps: number;
  /** Daily median of worst_side_bps for the bucket. */
  median_bps: number;
  sample_count: number;
  first_quote_at: string | null;
  last_quote_at: string | null;
}

export interface DailyBucketsMeta {
  timezone: "America/New_York";
  metric: "worst_side_bps";
  applied_filters: {
    assets: string[];
    providers: string[];
    sessions: string[];
    start_date: string;
    end_date: string;
    days: number;
    notional_usd: string;
  };
}

export interface DailyBucketsApiResponse {
  data: DailyBucketRow[];
  meta: DailyBucketsMeta;
}

// ─── Fetcher ────────────────────────────────────────────────────────────────

const INDEXER_BASE = process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ?? "";

interface FetchParams {
  assets?: string[];
  providers?: RfqProvider[];
  sessions?: MarketSession[];
  startDate?: string;
  endDate?: string;
  days?: number;
  notionalUsd?: string;
  spaceSlug?: string | null;
}

export async function fetchDailyBuckets(
  params: FetchParams,
  signal?: AbortSignal
): Promise<DailyBucketsApiResponse> {
  if (isDemoSpaceSlug(params.spaceSlug)) {
    return getDemoDailyBuckets({
      assets: params.assets,
      providers: params.providers,
      sessions: params.sessions,
      days: params.days,
      notionalUsd: params.notionalUsd,
    }) as DailyBucketsApiResponse;
  }

  if (!INDEXER_BASE) {
    throw new Error(
      "Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL — can't fetch daily buckets"
    );
  }
  const url = new URL(`${INDEXER_BASE}/api/rfq/daily-buckets`);
  if (params.assets?.length) url.searchParams.set("assets", params.assets.join(","));
  if (params.providers?.length)
    url.searchParams.set("providers", params.providers.join(","));
  if (params.sessions?.length)
    url.searchParams.set("sessions", params.sessions.join(","));
  if (params.startDate) url.searchParams.set("start_date", params.startDate);
  if (params.endDate) url.searchParams.set("end_date", params.endDate);
  if (params.days) url.searchParams.set("days", String(params.days));
  url.searchParams.set("notional_usd", params.notionalUsd ?? "10000");

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new Error(`daily-buckets HTTP ${res.status}`);
  }
  return (await res.json()) as DailyBucketsApiResponse;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

const STALE_TIME_MS = 5 * 60_000;
const GC_TIME_MS = 15 * 60_000;

/**
 * Pulls the last N days of daily-bucket aggregates from the Solana indexer.
 * The SLA view passes asset/provider/session filters so the backend only
 * returns rows visible in the compliance matrix, then reduces those rows into
 * (asset × provider × session) weekly summaries client-side.
 */
export function useRfqDailyBuckets(
  params: FetchParams = { days: 7, notionalUsd: "10000" }
) {
  return useQuery<DailyBucketsApiResponse, Error>({
    queryKey: [
      "rfq-daily-buckets",
      params.days ?? null,
      params.notionalUsd ?? "10000",
      params.startDate ?? null,
      params.endDate ?? null,
      params.assets ?? null,
      params.providers ?? null,
      params.sessions ?? null,
      params.spaceSlug ?? null,
    ],
    queryFn: ({ signal }) => fetchDailyBuckets(params, signal),
    enabled: isDemoSpaceSlug(params.spaceSlug) || !!INDEXER_BASE,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── Weekly reducer ─────────────────────────────────────────────────────────

export interface WeeklySessionSummary {
  /** Median of the (up to 7) daily median_bps values — the canonical SLA number. */
  medianBps: number | null;
  /** Arithmetic mean of the daily mean_bps values — secondary / tooltip. */
  meanBps: number | null;
  sampleCount: number;
  activeDays: number;
}

/**
 * Collapse daily rows for a single (asset, provider, session) into a weekly
 * summary. Median-of-daily-medians is an approximation — if we need the true
 * weekly median the backend will need to roll that up server-side.
 */
export function buildWeeklySessionSummary(
  rows: DailyBucketRow[]
): WeeklySessionSummary {
  if (rows.length === 0) {
    return { medianBps: null, meanBps: null, sampleCount: 0, activeDays: 0 };
  }

  const dailyMedians = rows
    .map((r) => r.median_bps)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  const medianBps =
    dailyMedians.length === 0
      ? null
      : dailyMedians[Math.floor(dailyMedians.length / 2)];

  const meanValues = rows.map((r) => r.mean_bps).filter((v) => Number.isFinite(v));
  const meanBps =
    meanValues.length === 0
      ? null
      : meanValues.reduce((s, v) => s + v, 0) / meanValues.length;

  return {
    medianBps,
    meanBps,
    sampleCount: rows.reduce((s, r) => s + r.sample_count, 0),
    activeDays: rows.length,
  };
}

/** Group rows into a nested index: asset → provider → session → rows[] */
export function groupBucketRows(
  rows: DailyBucketRow[]
): Map<string, Map<RfqProvider, Map<MarketSession, DailyBucketRow[]>>> {
  const byAsset = new Map<
    string,
    Map<RfqProvider, Map<MarketSession, DailyBucketRow[]>>
  >();
  for (const row of rows) {
    let byProvider = byAsset.get(row.asset);
    if (!byProvider) {
      byProvider = new Map();
      byAsset.set(row.asset, byProvider);
    }
    let bySession = byProvider.get(row.provider);
    if (!bySession) {
      bySession = new Map();
      byProvider.set(row.provider, bySession);
    }
    const bucket = bySession.get(row.session_bucket);
    if (bucket) bucket.push(row);
    else bySession.set(row.session_bucket, [row]);
  }
  return byAsset;
}
