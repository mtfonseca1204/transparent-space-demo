export const HIP3_DEFAULT_MARKET_KEY = "nova-para-avgo";
export const HIP3_DEFAULT_DAYS = 7;
export const HIP3_DEFAULT_BAND_BPS = 50;
export const HIP3_DEFAULT_MIN_DEPTH_USD = 10_000;

export const HIP3_INDEXER_BASE =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

export const HIP3_DEPTH_BANDS = ["10bps", "25bps", "50bps", "100bps"] as const;

export type Hip3DepthBand = (typeof HIP3_DEPTH_BANDS)[number];

export interface Hip3Market {
  market_key: string;
  label: string;
  dex: string;
  coin: string;
  vault_address: string;
  mm_address: string;
  venue: string;
  curator: string;
  source: string;
}

export interface Hip3BookLevel {
  px: string | number;
  sz: string | number;
  n?: number;
}

export interface Hip3DepthSide {
  bid?: number | null;
  ask?: number | null;
}

export interface Hip3BookSample {
  sampled_at: string | null;
  best_bid_px: number | null;
  best_ask_px: number | null;
  mid_px: number | null;
  mark_px: number | null;
  spread_bps: number | null;
  depth_usd?: Record<string, Hip3DepthSide | undefined> | null;
  raw_bids?: Hip3BookLevel[] | null;
  raw_asks?: Hip3BookLevel[] | null;
}

export interface Hip3AccountSnapshot {
  sampled_at: string | null;
  user_address: string;
  account_value_usd: number | null;
  margin_used_usd: number | null;
  position_size: number | null;
  position_value_usd: number | null;
  entry_px: number | null;
  unrealized_pnl_usd: number | null;
  open_order_count: number | null;
  bid_open_order_count: number | null;
  ask_open_order_count: number | null;
}

export interface Hip3HourlyRow {
  hour: string;
  expected_samples: number;
  sample_count: number;
  sampling_uptime_pct: number;
  quote_up_samples: number;
  quote_uptime_pct: number;
  avg_spread_bps: number | null;
  avg_bid_depth_usd: number | null;
  avg_ask_depth_usd: number | null;
  latest_sample_at: string | null;
}

export interface Hip3AccountHistoryRow extends Hip3AccountSnapshot {
  hour: string | null;
}

export interface Hip3FillHourlyRow {
  hour: string | null;
  fill_count: number;
  maker_fill_count: number;
  taker_fill_count: number;
  buy_fill_count: number;
  sell_fill_count: number;
  notional_usd: number | null;
  maker_notional_usd: number | null;
  taker_notional_usd: number | null;
  fee_usd: number | null;
  closed_pnl_usd: number | null;
  latest_fill_at: string | null;
}

export interface Hip3Summary {
  window_start: string;
  window_end: string;
  sample_interval_ms: number;
  expected_samples: number;
  sample_count: number;
  sampling_uptime_pct: number;
  quote_up_samples: number;
  quote_uptime_pct: number;
  avg_spread_bps: number | null;
  avg_bid_depth_usd: number | null;
  avg_ask_depth_usd: number | null;
  fill_count: number;
  latest_fill_at: string | null;
  replenishment_event_count: number;
}

export interface Hip3FillsSummary {
  count: number;
  latest_fill_at: string | null;
}

export interface Hip3MarkoutRow {
  horizon_ms: number;
  side: string;
  fill_count: number;
  avg_markout_bps: number | string | null;
  p50_markout_bps: number | string | null;
}

export interface Hip3ReplenishmentEvent {
  side?: string | null;
  reason?: string | null;
  started_at?: string | null;
  recovered_at?: string | null;
  duration_ms?: number | null;
}

export interface Hip3MarketQualityResponse {
  market: Hip3Market;
  summary: Hip3Summary;
  latest: {
    book: Hip3BookSample | null;
    account: Hip3AccountSnapshot | null;
  };
  account_history: Hip3AccountHistoryRow[];
  fills: Hip3FillsSummary;
  fill_hourly: Hip3FillHourlyRow[];
  hourly: Hip3HourlyRow[];
  markouts: Hip3MarkoutRow[];
  replenishment_events: Hip3ReplenishmentEvent[];
  meta?: Record<string, unknown>;
}

export interface Hip3MarketsResponse {
  data: Array<
    Hip3Market & {
      latest_book?: Hip3BookSample | null;
      latest_account?: Hip3AccountSnapshot | null;
      fills?: Hip3FillsSummary | null;
    }
  >;
  meta?: Record<string, unknown>;
}

export interface Hip3DepthRow {
  band: Hip3DepthBand;
  bandBps: number;
  bidUsd: number;
  askUsd: number;
  totalUsd: number;
}

export interface Hip3BookLadderRow {
  index: number;
  bidPx: number | null;
  bidSz: number | null;
  bidNotionalUsd: number | null;
  askPx: number | null;
  askSz: number | null;
  askNotionalUsd: number | null;
}

export type Hip3LiveState = "empty" | "stale" | "thin" | "live";

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getHip3SampleAgeMs(sampledAt?: string | null, nowMs = Date.now()): number | null {
  if (!sampledAt) return null;
  const timestamp = Date.parse(sampledAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, nowMs - timestamp);
}

export function buildHip3DepthRows(book?: Hip3BookSample | null): Hip3DepthRow[] {
  return HIP3_DEPTH_BANDS.map((band) => {
    const depth = book?.depth_usd?.[band];
    const bidUsd = toNumber(depth?.bid) ?? 0;
    const askUsd = toNumber(depth?.ask) ?? 0;
    return {
      band,
      bandBps: Number(band.replace("bps", "")),
      bidUsd,
      askUsd,
      totalUsd: bidUsd + askUsd,
    };
  });
}

export function buildHip3BookLadderRows(
  book?: Hip3BookSample | null,
  limit = 12
): Hip3BookLadderRow[] {
  const bids = book?.raw_bids ?? [];
  const asks = book?.raw_asks ?? [];
  const length = Math.max(Math.min(limit, bids.length), Math.min(limit, asks.length));

  return Array.from({ length }, (_, index) => {
    const bidPx = toNumber(bids[index]?.px);
    const bidSz = toNumber(bids[index]?.sz);
    const askPx = toNumber(asks[index]?.px);
    const askSz = toNumber(asks[index]?.sz);

    return {
      index,
      bidPx,
      bidSz,
      bidNotionalUsd: bidPx !== null && bidSz !== null ? bidPx * bidSz : null,
      askPx,
      askSz,
      askNotionalUsd: askPx !== null && askSz !== null ? askPx * askSz : null,
    };
  });
}

export function selectRecentHip3HourlyRows(
  hourly: Hip3HourlyRow[] | undefined,
  limit = 48
): Hip3HourlyRow[] {
  if (!hourly?.length || limit <= 0) return [];
  return hourly.slice(Math.max(0, hourly.length - limit));
}

export function selectRecentHip3AccountHistoryRows(
  rows: Hip3AccountHistoryRow[] | undefined,
  limit = 48
): Hip3AccountHistoryRow[] {
  if (!rows?.length || limit <= 0) return [];
  return rows.slice(Math.max(0, rows.length - limit));
}

export function selectRecentHip3FillHourlyRows(
  rows: Hip3FillHourlyRow[] | undefined,
  limit = 48
): Hip3FillHourlyRow[] {
  if (!rows?.length || limit <= 0) return [];
  return rows.slice(Math.max(0, rows.length - limit));
}

export function getHip3LiveState({
  latestBook,
  nowMs = Date.now(),
  staleAfterMs = 120_000,
  minDepthUsd = HIP3_DEFAULT_MIN_DEPTH_USD,
  band = "50bps",
}: {
  latestBook?: Hip3BookSample | null;
  nowMs?: number;
  staleAfterMs?: number;
  minDepthUsd?: number;
  band?: Hip3DepthBand;
}): Hip3LiveState {
  const ageMs = getHip3SampleAgeMs(latestBook?.sampled_at, nowMs);
  if (ageMs === null) return "empty";
  if (ageMs > staleAfterMs) return "stale";

  const depth = latestBook?.depth_usd?.[band];
  const bidUsd = toNumber(depth?.bid) ?? 0;
  const askUsd = toNumber(depth?.ask) ?? 0;
  if (bidUsd < minDepthUsd || askUsd < minDepthUsd) return "thin";

  return "live";
}

export function getUsableHip3Markouts(markouts: Hip3MarkoutRow[] | undefined): Hip3MarkoutRow[] {
  return (markouts ?? []).filter((row) => {
    const avg = toNumber(row.avg_markout_bps);
    const p50 = toNumber(row.p50_markout_bps);
    return avg !== null && p50 !== null && Math.abs(avg) < 5_000 && Math.abs(p50) < 5_000;
  });
}
