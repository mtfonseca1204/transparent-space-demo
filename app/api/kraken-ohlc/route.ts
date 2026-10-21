import { NextRequest, NextResponse } from "next/server";
import { getDemoOhlcCandles, isDemoRequest } from "@/lib/demo/fixtures";

// ─── Types ──────────────────────────────────────────────────────────────────

type CachedEntry = { fetchedAt: number; data: KrakenCandle[] };
type KrakenCandle = {
  timestamp: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  count: number;
};

type KrakenTrade = {
  price: number;
  volume: number;
  time: number; // Unix seconds (float)
};

// ─── In-memory cache (2-min TTL) ────────────────────────────────────────────

const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 2 * 60 * 1000;

function getCached(key: string): KrakenCandle[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

// ─── Kraken OHLC fetch ──────────────────────────────────────────────────────

async function fetchKrakenOhlcPage(
  pair: string,
  interval: number,
  since: number
): Promise<{ candles: KrakenCandle[]; last: number }> {
  const url = new URL("https://api.kraken.com/0/public/OHLC");
  url.searchParams.set("pair", pair);
  url.searchParams.set("interval", String(interval));
  url.searchParams.set("asset_class", "tokenized_asset");
  if (since > 0) {
    url.searchParams.set("since", String(since));
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Kraken API returned ${res.status}`);
  }

  const json = (await res.json()) as {
    error?: string[];
    result?: Record<string, unknown>;
  };

  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken error: ${json.error.join(", ")}`);
  }

  const result = json.result ?? {};
  let rawCandles: unknown[] = [];
  let last = 0;
  for (const [key, val] of Object.entries(result)) {
    if (key === "last") {
      last = Number(val);
    } else if (Array.isArray(val)) {
      rawCandles = val;
    }
  }

  const candles: KrakenCandle[] = rawCandles.map((c) => {
    const arr = c as (string | number)[];
    return {
      timestamp: Number(arr[0]),
      open: Number(arr[1]),
      high: Number(arr[2]),
      low: Number(arr[3]),
      close: Number(arr[4]),
      vwap: Number(arr[5]),
      volume: Number(arr[6]),
      count: Number(arr[7]),
    };
  });

  return { candles, last };
}

// ─── Kraken Trades fetch & aggregation ──────────────────────────────────────

async function fetchKrakenTrades(
  pair: string,
  since: number,
  endTime: number
): Promise<KrakenTrade[]> {
  const allTrades: KrakenTrade[] = [];
  // Kraken Trades `since` uses nanosecond strings, but also accepts unix seconds
  let cursor = String(since);
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://api.kraken.com/0/public/Trades");
    url.searchParams.set("pair", pair);
    url.searchParams.set("asset_class", "tokenized_asset");
    url.searchParams.set("since", cursor);

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) break;

    const json = (await res.json()) as {
      error?: string[];
      result?: Record<string, unknown>;
    };

    if (json.error && json.error.length > 0) break;

    const result = json.result ?? {};
    let rawTrades: unknown[] = [];
    let last = "";
    for (const [key, val] of Object.entries(result)) {
      if (key === "last") {
        last = String(val);
      } else if (Array.isArray(val)) {
        rawTrades = val;
      }
    }

    if (rawTrades.length === 0) break;

    for (const t of rawTrades) {
      const arr = t as (string | number)[];
      const time = Number(arr[2]);
      allTrades.push({
        price: Number(arr[0]),
        volume: Number(arr[1]),
        time,
      });
    }

    // Check if we've covered the range
    const lastTradeTime = allTrades[allTrades.length - 1].time;
    if (lastTradeTime >= endTime) break;
    if (last === cursor) break; // no progress
    cursor = last;
  }

  return allTrades;
}

function aggregateTradesToCandles(
  trades: KrakenTrade[],
  intervalSec: number,
  startTime: number,
  endTime: number
): KrakenCandle[] {
  if (trades.length === 0) return [];

  // Group trades into interval buckets
  const buckets = new Map<number, KrakenTrade[]>();
  for (const t of trades) {
    const bucket = Math.floor(t.time / intervalSec) * intervalSec;
    if (bucket < startTime || bucket > endTime) continue;
    const arr = buckets.get(bucket) ?? [];
    arr.push(t);
    buckets.set(bucket, arr);
  }

  const candles: KrakenCandle[] = [];
  for (const [ts, bucketTrades] of buckets.entries()) {
    const prices = bucketTrades.map((t) => t.price);
    const volumes = bucketTrades.map((t) => t.volume);
    const totalVol = volumes.reduce((a, b) => a + b, 0);
    const vwap =
      totalVol > 0
        ? bucketTrades.reduce((sum, t) => sum + t.price * t.volume, 0) / totalVol
        : prices[0];

    candles.push({
      timestamp: ts,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: vwap, // Use VWAP as close for trade-aggregated candles to smooth sparse data
      vwap,
      volume: totalVol,
      count: bucketTrades.length,
    });
  }

  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const pair = searchParams.get("pair") ?? "";
  const interval = Number(searchParams.get("interval") ?? 5); // minutes
  const since = Number(searchParams.get("since") ?? 0); // unix seconds
  const endTime = Number(searchParams.get("endTime") ?? 0); // unix seconds

  if (!pair) {
    return NextResponse.json({ error: "Missing pair parameter" }, { status: 400 });
  }

  if (isDemoRequest(request)) {
    return NextResponse.json(
      getDemoOhlcCandles({ pair, intervalMinutes: interval, since, endTime }),
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Source": "demo-fixture",
        },
      }
    );
  }

  const cacheKey = `${pair}-${interval}-${Math.floor(since / 300) * 300}-${Math.floor(endTime / 300) * 300}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  }

  try {
    // 1. Fetch OHLC candles (limited history — ~720 candles)
    const { candles: ohlcCandles } = await fetchKrakenOhlcPage(pair, interval, since);

    const ohlcStartTs = ohlcCandles.length > 0 ? ohlcCandles[0].timestamp : 0;

    // 2. If OHLC doesn't cover our requested start, fill the gap with trades
    let tradeCandles: KrakenCandle[] = [];
    if (since > 0 && ohlcStartTs > since) {
      const trades = await fetchKrakenTrades(pair, since, ohlcStartTs);
      tradeCandles = aggregateTradesToCandles(trades, interval * 60, since, ohlcStartTs);
    }

    // 3. Merge: trade-based candles first, then OHLC candles
    const allCandles = [...tradeCandles, ...ohlcCandles];

    // Deduplicate by timestamp (prefer OHLC over trade-aggregated)
    const seen = new Set<number>();
    const deduped: KrakenCandle[] = [];
    // Process in reverse so OHLC candles (later in array) take priority
    for (let i = allCandles.length - 1; i >= 0; i--) {
      const c = allCandles[i];
      if (!seen.has(c.timestamp)) {
        seen.add(c.timestamp);
        deduped.push(c);
      }
    }
    deduped.reverse(); // restore chronological order

    // Cache and return
    cache.set(cacheKey, { fetchedAt: Date.now(), data: deduped });

    // Prune cache
    if (cache.size > 200) {
      const now = Date.now();
      for (const [k, v] of cache.entries()) {
        if (now - v.fetchedAt > CACHE_TTL_MS) cache.delete(k);
      }
    }

    return NextResponse.json(deduped, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
