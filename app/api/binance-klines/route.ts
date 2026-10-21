/**
 * Binance spot k-line proxy.
 *
 * Returns a compact `{ t, close }[]` time series for a Binance spot symbol so
 * client charts can plot an exchange reference price (e.g. 0G/USDT) alongside
 * on-chain pool prices. Data source: Binance public market data
 * (https://github.com/binance/binance-public-data/).
 *
 * Query params:
 *   symbol   – Binance spot symbol (e.g. "0GUSDT"); defaults to "0GUSDT"
 *   interval – 1m | 5m | 15m | 1h | 4h | 1d (default 1h)
 *   days     – lookback window in days (default 7, max 90)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchBinanceKlines,
  toBinanceCloseSeries,
  type BinanceInterval,
} from "@/lib/binance-klines";

const VALID_INTERVALS: BinanceInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const symbol = (params.get("symbol") || "0GUSDT").toUpperCase();
  const intervalParam = params.get("interval") as BinanceInterval | null;
  const interval: BinanceInterval =
    intervalParam && VALID_INTERVALS.includes(intervalParam) ? intervalParam : "1h";
  const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 90);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  try {
    const klines = await fetchBinanceKlines(symbol, interval, startMs, endMs);
    const series = toBinanceCloseSeries(klines);

    return NextResponse.json(
      {
        symbol,
        interval,
        days,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        points: series,
      },
      {
        headers: {
          // Reference prices change slowly relative to the page; cache briefly.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "X-Source": "binance-public-data",
          "X-Point-Count": String(series.length),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/binance-klines] fetch failed", { message, symbol, interval });
    return NextResponse.json({ error: "Failed to fetch Binance klines" }, { status: 502 });
  }
}
