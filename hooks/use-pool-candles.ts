import { useQuery } from "@tanstack/react-query";
import {
  sqrtPriceX96ToPrice,
} from "@/lib/envio-client";
import { isSolanaPool, normalizePoolKey } from "@/lib/pools";

export type CandleInterval = "5m" | "15m" | "1h" | "4h" | "1d";

// Interval durations in seconds
export const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
const INTEGER_STRING_RE = /^-?\d+$/;

export interface OHLCDataPoint {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  swapCount: number;
}

interface UsePoolCandlesOptions {
  poolAddress: string;
  interval?: CandleInterval;
  // Number of candles to fetch (approximate)
  count?: number;
  // Or specify days
  days?: number;
  // Token decimals for price conversion
  token0Decimals?: number;
  token1Decimals?: number;
  enabled?: boolean;
}

// Railway / Next.js API candle shape (used for Raydium pools)
interface ApiCandleData {
  id: string;
  pool: string;
  interval: number;
  timestamp: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume0: string;
  volume1: string;
  txCount: number;
}

/**
 * Hook to fetch pre-computed OHLC candles through the app API.
 * Supported Solana and Worldchain pools are resolved server-side through their Railway APIs.
 */
export function usePoolCandles({
  poolAddress,
  interval = "5m",
  count,
  days,
  token0Decimals = 18,
  token1Decimals = 6,
  enabled = true,
}: UsePoolCandlesOptions) {
  const poolKey = normalizePoolKey(poolAddress);
  const isSolana = isSolanaPool(poolKey);

  // Calculate start timestamp.
  // Round "now" to 5-minute buckets so the query key stays stable across renders
  // — otherwise a fresh per-second timestamp would change the key every render
  // and the query would never settle (data stuck undefined). Mirrors the
  // rounding in useLPHistoricalData.
  const since = (() => {
    const now = Math.floor(Date.now() / 1000 / 300) * 300;

    if (days !== undefined) {
      return now - (days * 86400);
    }

    if (count !== undefined) {
      const intervalSeconds = INTERVAL_SECONDS[interval];
      return now - (count * intervalSeconds);
    }

    // Default: 7 days
    return now - (7 * 86400);
  })();

  return useQuery<OHLCDataPoint[], Error>({
    queryKey: ["poolCandles", poolKey, interval, since],
    queryFn: async () => {
      const endTime = Math.floor(Date.now() / 1000);
      const intervalSeconds = INTERVAL_SECONDS[interval];
      const res = await fetch(
        `/api/candles?pool=${encodeURIComponent(poolKey)}&interval=${intervalSeconds}&startTime=${since}&endTime=${endTime}`
      );
      if (!res.ok) throw new Error("Failed to fetch pool candles");
      const candles: ApiCandleData[] = await res.json();

      return candles.map((candle) => {
        const toPrice = (raw: string): number => {
          if (isSolana) {
            const numeric = Number(raw);
            return Number.isFinite(numeric) ? numeric : 0;
          }
          if (INTEGER_STRING_RE.test(raw)) {
            return sqrtPriceX96ToPrice(BigInt(raw), token0Decimals, token1Decimals);
          }
          const numeric = Number(raw);
          return Number.isFinite(numeric) ? numeric : 0;
        };

        return {
          timestamp: new Date(candle.timestamp * 1000),
          open: toPrice(candle.openPrice),
          high: toPrice(candle.highPrice),
          low: toPrice(candle.lowPrice),
          close: toPrice(candle.closePrice),
          volume: Number(candle.volume1) / Math.pow(10, token1Decimals),
          swapCount: candle.txCount,
        };
      });
    },
    enabled: enabled && !!poolKey,
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Helper to get recommended interval based on time range
 */
export function getRecommendedInterval(days: number): CandleInterval {
  if (days <= 1) return "5m";
  if (days <= 3) return "15m";
  if (days <= 14) return "1h";
  if (days <= 60) return "4h";
  return "1d";
}
