/**
 * Binance public spot k-line (candlestick) client.
 *
 * Reference price source for arb-volume classification on spaces whose asset
 * trades on Binance spot (e.g. 0G via the `0GUSDT` market). This mirrors the
 * Hyperliquid 1-minute candle path used for Kraken, but pulls from Binance's
 * public spot market data instead.
 *
 * Data source: Binance public market data
 * (https://github.com/binance/binance-public-data/). The historical bulk dumps
 * at https://data.binance.vision lag by ~1 day, so for a rolling window that
 * includes the current day we use the equivalent real-time public REST k-line
 * endpoint the same repo points to for live data.
 *
 * Host order matters: `api.binance.com` is GEO-RESTRICTED and returns HTTP 451
 * from many cloud/CI IPs (e.g. Vercel) — so on the deployed server it fails and
 * the reference line disappears even though it works from a local machine. The
 * `data-api.binance.vision` public-market-data host serves the same real-time
 * REST endpoints WITHOUT geo-restriction, so we try it first and fall back to
 * the main host. (Note: `data-api.binance.vision` is the live REST mirror; the
 * separate `data.binance.vision` is the ~1-day-lagged bulk-dump host.)
 */

const BINANCE_KLINE_HOSTS = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines",
] as const;

// Binance returns at most 1000 klines per request, so wide windows are paged.
const MAX_KLINES_PER_REQUEST = 1000;

export type BinanceInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

const INTERVAL_MS: Record<BinanceInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

// A single kline tuple: [openTime, open, high, low, close, volume, closeTime, ...].
type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

/** Sentinel: a reachable host says the symbol/range has no data (HTTP 400/404). */
const NO_DATA = Symbol("no-data");

/**
 * Fetch one page of klines, trying each host in order. Returns the batch on
 * success, `NO_DATA` when a reachable host reports an unknown symbol / bad range
 * (so the caller stops paging without throwing), and throws only when every host
 * is unreachable / geo-blocked.
 */
async function fetchKlinePage(params: URLSearchParams): Promise<BinanceKline[] | typeof NO_DATA> {
  let lastErr: unknown = null;
  for (const host of BINANCE_KLINE_HOSTS) {
    try {
      const res = await fetch(`${host}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return (await res.json()) as BinanceKline[];
      // Unknown symbol / bad range on a reachable host → no reference data.
      if (res.status === 400 || res.status === 404) return NO_DATA;
      // Geo-block (451), forbidden (403), rate-limit (429), 5xx → try next host.
      lastErr = new Error(`Binance klines HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Binance klines fetch failed");
}

/**
 * Fetch spot klines for `symbol` (e.g. "0GUSDT") at `interval` covering
 * [startMs, endMs). Returns the raw klines in ascending open-time order.
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: BinanceInterval,
  startMs: number,
  endMs: number,
): Promise<BinanceKline[]> {
  const all: BinanceKline[] = [];
  const stepMs = INTERVAL_MS[interval];
  let cursor = startMs;

  // Hard cap on requests as a safety backstop.
  for (let request = 0; request < 48 && cursor < endMs; request++) {
    const params = new URLSearchParams({
      symbol,
      interval,
      startTime: String(cursor),
      endTime: String(endMs),
      limit: String(MAX_KLINES_PER_REQUEST),
    });

    const batch = await fetchKlinePage(params);
    if (batch === NO_DATA) return all;
    if (!Array.isArray(batch) || batch.length === 0) break;

    all.push(...batch);

    const lastOpen = batch[batch.length - 1][0];
    // Advance past the last candle we received.
    const next = lastOpen + stepMs;
    if (next <= cursor) break; // no forward progress — bail out
    cursor = next;

    // Fewer than a full page means we've reached the end of available data.
    if (batch.length < MAX_KLINES_PER_REQUEST) break;
  }

  return all;
}

/**
 * Fetch 1-minute spot klines (convenience wrapper around {@link fetchBinanceKlines}).
 */
export async function fetchBinance1mKlines(
  symbol: string,
  startMs: number,
  endMs: number,
): Promise<BinanceKline[]> {
  return fetchBinanceKlines(symbol, "1m", startMs, endMs);
}

/** A single reference close price at a point in time. */
export interface BinanceClosePoint {
  /** Candle open time, in epoch milliseconds. */
  t: number;
  /** Close price for the candle. */
  close: number;
}

/** Map klines to a compact {t, close} time series in ascending order. */
export function toBinanceCloseSeries(klines: BinanceKline[]): BinanceClosePoint[] {
  const series: BinanceClosePoint[] = [];
  for (const k of klines) {
    const close = parseFloat(k[4]);
    if (Number.isFinite(close)) series.push({ t: k[0], close });
  }
  return series;
}

/**
 * Build a map from candle open-time (minute, ms) → close price for fast lookup
 * during swap classification.
 */
export function buildBinanceCloseMap(klines: BinanceKline[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const k of klines) {
    const openTimeMs = k[0];
    const close = parseFloat(k[4]);
    if (Number.isFinite(close)) map.set(openTimeMs, close);
  }
  return map;
}
