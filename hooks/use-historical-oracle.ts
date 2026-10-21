import { useQuery } from "@tanstack/react-query";
import { normalizePoolKey } from "@/lib/pools";
import type { OracleSource } from "@/stores/chart-settings-store";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

export type OraclePricePoint = {
  timestamp: Date;
  price: number;
};

type HistoricalPricesResponse = {
  source: OracleSource;
  tokenAddress: string;
  prices: Array<{ timestamp: number; price: number }>;
  cached?: boolean;
  fallbackUsed?: boolean;
  message?: string;
};

interface UseHistoricalOracleOptions {
  source: OracleSource;
  tokenAddress: string;
  startTime: number; // Unix seconds
  endTime: number; // Unix seconds
  enabled?: boolean;
  spaceSlug?: string | null;
}

interface UseHistoricalOracleResult {
  data: OraclePricePoint[] | null;
  isLoading: boolean;
  error: Error | null;
  actualSource: OracleSource | null;
  fallbackUsed: boolean;
}

/**
 * Hook to fetch historical oracle prices from the selected source.
 * 
 * For DEX TWAP, returns null and the caller should use the local SMA computation.
 * For external sources (DefiLlama, CoinGecko, Pyth), fetches from the API route.
 */
export function useHistoricalOracle({
  source,
  tokenAddress,
  startTime,
  endTime,
  enabled = true,
  spaceSlug,
}: UseHistoricalOracleOptions): UseHistoricalOracleResult {
  const tokenAddressLc = normalizePoolKey(tokenAddress);
  const currentSpaceSlug = useCurrentSpaceSlug();
  const effectiveSpaceSlug = spaceSlug ?? currentSpaceSlug;
  
  // DEX TWAP is computed locally, no API call needed
  const shouldFetch = enabled && source !== "dex-twap" && !!tokenAddressLc && startTime > 0;
  
  const { data, isLoading, error } = useQuery({
    queryKey: ["historicalOracle", source, tokenAddressLc, startTime, endTime, effectiveSpaceSlug],
    queryFn: async (): Promise<HistoricalPricesResponse> => {
      const params = new URLSearchParams({
        source,
        tokenAddress: tokenAddressLc,
        startTime: startTime.toString(),
        endTime: endTime.toString(),
      });
      if (isDemoSpaceSlug(effectiveSpaceSlug)) params.set("space", "demo");
      
      const res = await fetch(`/api/historical-prices?${params.toString()}`);
      
      if (!res.ok) {
        throw new Error(`Failed to fetch historical prices: ${res.status}`);
      }
      
      return res.json();
    },
    enabled: shouldFetch,
    staleTime: 5 * 60 * 1000, // 5 minutes (matches server cache)
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  
  // DEX TWAP returns null - caller handles local computation
  if (source === "dex-twap") {
    return {
      data: null,
      isLoading: false,
      error: null,
      actualSource: "dex-twap",
      fallbackUsed: false,
    };
  }
  
  if (!shouldFetch || !data) {
    return {
      data: null,
      isLoading,
      error: error as Error | null,
      actualSource: null,
      fallbackUsed: false,
    };
  }
  
  // Convert API response to OraclePricePoint[]
  const oracleData: OraclePricePoint[] = (data.prices ?? []).map((p) => ({
    timestamp: new Date(p.timestamp * 1000),
    price: p.price,
  }));
  
  return {
    data: oracleData.length > 0 ? oracleData : null,
    isLoading,
    error: error as Error | null,
    actualSource: data.source,
    fallbackUsed: data.fallbackUsed ?? false,
  };
}

/**
 * Interpolate oracle data to match OHLC timestamps.
 * 
 * External oracles may have different granularity (hourly) than our candles (5-min).
 * This function aligns oracle data to candle timestamps via linear interpolation.
 */
export function interpolateOracleToTimestamps(
  oracleData: OraclePricePoint[],
  targetTimestamps: Date[]
): OraclePricePoint[] {
  if (oracleData.length === 0 || targetTimestamps.length === 0) {
    return [];
  }
  
  // Sort oracle data by timestamp
  const sorted = [...oracleData].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  const result: OraclePricePoint[] = [];
  
  for (const targetTs of targetTimestamps) {
    const t = targetTs.getTime();
    
    // Find surrounding oracle points
    let before: OraclePricePoint | null = null;
    let after: OraclePricePoint | null = null;
    
    for (let i = 0; i < sorted.length; i++) {
      const pt = sorted[i]!;
      if (pt.timestamp.getTime() <= t) {
        before = pt;
      }
      if (pt.timestamp.getTime() >= t && !after) {
        after = pt;
        break;
      }
    }
    
    let price: number;
    
    if (!before && !after) {
      // No data at all
      continue;
    } else if (!before) {
      // Before first oracle point - use first value
      price = after!.price;
    } else if (!after) {
      // After last oracle point - use last value
      price = before.price;
    } else if (before.timestamp.getTime() === after.timestamp.getTime()) {
      // Exact match
      price = before.price;
    } else {
      // Interpolate
      const t1 = before.timestamp.getTime();
      const t2 = after.timestamp.getTime();
      const ratio = (t - t1) / (t2 - t1);
      price = before.price + (after.price - before.price) * ratio;
    }
    
    result.push({ timestamp: targetTs, price });
  }
  
  return result;
}

/**
 * Compute DEX TWAP (Simple Moving Average) from OHLC close prices.
 * This is the fallback/default oracle when no external source is selected.
 */
export function computeDexTwap(
  ohlcData: Array<{ timestamp: Date; close: number }>,
  windowSize: number = 5
): OraclePricePoint[] {
  return ohlcData.map((ohlc, i) => {
    const startIdx = Math.max(0, i - windowSize + 1);
    const window = ohlcData.slice(startIdx, i + 1);
    const avgPrice = window.reduce((sum, d) => sum + d.close, 0) / window.length;
    
    return {
      timestamp: ohlc.timestamp,
      price: avgPrice,
    };
  });
}
