import { useQuery } from "@tanstack/react-query";
import type { BinanceInterval } from "@/lib/binance-klines";

export interface BinancePricePoint {
  timestamp: Date;
  close: number;
}

interface BinanceKlinesResponse {
  symbol: string;
  interval: BinanceInterval;
  days: number;
  startTime: string;
  endTime: string;
  points: { t: number; close: number }[];
}

interface UseBinanceKlinesOptions {
  symbol: string;
  interval?: BinanceInterval;
  days?: number;
  enabled?: boolean;
}

/**
 * Fetch a Binance spot reference price series ({timestamp, close}) for a symbol.
 * Backed by `/api/binance-klines`, sourced from Binance public market data.
 */
export function useBinanceKlines({
  symbol,
  interval = "1h",
  days = 7,
  enabled = true,
}: UseBinanceKlinesOptions) {
  return useQuery<BinancePricePoint[], Error>({
    queryKey: ["binanceKlines", symbol, interval, days],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol,
        interval,
        days: String(days),
      });
      const res = await fetch(`/api/binance-klines?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch Binance klines");
      const data: BinanceKlinesResponse = await res.json();
      return data.points.map((p) => ({
        timestamp: new Date(p.t),
        close: p.close,
      }));
    },
    enabled: enabled && !!symbol,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
