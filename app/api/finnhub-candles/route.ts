import { NextRequest, NextResponse } from "next/server";
import { getDemoFinnhubCandles, isDemoRequest } from "@/lib/demo/fixtures";

// ─── Types ──────────────────────────────────────────────────────────────────

type FmpCandle = {
  timestamp: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type CachedEntry = { fetchedAt: number; data: FmpCandle[] };

// ─── In-memory cache (5-min TTL) ────────────────────────────────────────────

const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): FmpCandle[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

// ─── FMP API ────────────────────────────────────────────────────────────────

const FMP_API_KEY = "pf1rimHVLKR8Qh7NJPfPNwniAFvhO6df";

async function fetchFmpCandles(
  symbol: string,
  resolution: string,
  fromUnix: number,
  toUnix: number
): Promise<FmpCandle[]> {
  // Convert unix seconds → YYYY-MM-DD for FMP
  const fromDate = new Date(fromUnix * 1000).toISOString().split("T")[0];
  const toDate = new Date(toUnix * 1000).toISOString().split("T")[0];

  // FMP endpoint: /api/v3/historical-chart/{interval}/{symbol}
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${resolution}min/${symbol}?from=${fromDate}&to=${toDate}&apikey=${FMP_API_KEY}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`FMP API returned ${res.status}`);
  }

  const json = (await res.json()) as Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  if (!Array.isArray(json)) return [];

  // FMP returns newest-first; dates are in US Eastern time (no TZ suffix).
  // Create a formatter that can tell us the current UTC offset for New York
  // at any given moment (handles EST ↔ EDT automatically).
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  });

  return json
    .map((c) => {
      // e.g. "2026-03-10 09:30:00" → parse as ET by appending offset
      // Get the ET offset for this date (EST = -05:00, EDT = -04:00)
      const rough = new Date(c.date);
      const parts = etFormatter.formatToParts(rough);
      const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
      // tzPart is like "GMT-5" or "GMT-4"; convert to "+/-HH:00"
      const offsetMatch = tzPart.match(/GMT([+-]?\d+)/);
      const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : -5;
      const sign = offsetHours <= 0 ? "-" : "+";
      const abs = Math.abs(offsetHours).toString().padStart(2, "0");
      const isoStr = `${c.date.replace(" ", "T")}${sign}${abs}:00`;

      return {
        timestamp: Math.floor(new Date(isoStr).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    })
    .reverse(); // chronological order
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const symbol = searchParams.get("symbol") ?? "";
  const resolution = searchParams.get("resolution") ?? "5";
  const from = Number(searchParams.get("from") ?? 0);
  const to = Number(searchParams.get("to") ?? 0);

  if (!symbol) {
    return NextResponse.json(
      { error: "Missing symbol parameter" },
      { status: 400 }
    );
  }
  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing from/to parameters (unix seconds)" },
      { status: 400 }
    );
  }

  if (isDemoRequest(request)) {
    return NextResponse.json(
      getDemoFinnhubCandles({ symbol, resolution, from, to }),
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Source": "demo-fixture",
        },
      }
    );
  }

  const cacheKey = `${symbol}-${resolution}-${from}-${to}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  }

  try {
    const candles = await fetchFmpCandles(symbol, resolution, from, to);

    cache.set(cacheKey, { fetchedAt: Date.now(), data: candles });

    // Prune cache
    if (cache.size > 100) {
      const now = Date.now();
      for (const [k, v] of cache.entries()) {
        if (now - v.fetchedAt > CACHE_TTL_MS) cache.delete(k);
      }
    }

    return NextResponse.json(candles, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
