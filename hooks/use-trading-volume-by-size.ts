import { useQuery } from "@tanstack/react-query";
import { normalizePoolKey, isSolanaPool } from "@/lib/pools";
import { type SizeBucketId } from "@/lib/envio-client";

interface UseTradingVolumeBySizeOptions {
  poolAddress: string;
  enabled?: boolean;
  // Days of data to fetch (default 7)
  days?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  token0Decimals?: number;
  token1Decimals?: number;
}

interface DailyBucketData {
  date: string; // ISO date string
  dateKey: string; // YYYY-MM-DD
  buckets: Record<SizeBucketId, number>;
  total: number;
}

interface TradingVolumeBySizeResult {
  dailyData: DailyBucketData[];
}

/**
 * Hook to fetch pre-aggregated trading volume by size from PoolDailyVolumeBySize entity.
 * This replaces the expensive client-side aggregation of raw swap events.
 */
export function useTradingVolumeBySize({
  poolAddress,
  enabled = true,
  days = 7,
  token0UsdPrice,
  token1UsdPrice,
  token0Decimals = 18,
  token1Decimals = 6,
}: UseTradingVolumeBySizeOptions) {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const poolIsSolana = isSolanaPool(poolAddressNorm);

  return useQuery<TradingVolumeBySizeResult, Error>({
    queryKey: [
      "tradingVolumeBySize",
      poolAddressNorm,
      days,
      token0UsdPrice ?? null,
      token1UsdPrice ?? null,
      token0Decimals,
      token1Decimals,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("poolAddress", poolAddressNorm);
      params.set("days", String(days));
      params.set("mode", "aggregate");
      if (token0UsdPrice !== null && token0UsdPrice !== undefined) {
        params.set("token0Usd", String(token0UsdPrice));
      }
      if (token1UsdPrice !== null && token1UsdPrice !== undefined) {
        params.set("token1Usd", String(token1UsdPrice));
      }
      if (token0Decimals !== null && token0Decimals !== undefined) {
        params.set("token0Decimals", String(token0Decimals));
      }
      if (token1Decimals !== null && token1Decimals !== undefined) {
        params.set("token1Decimals", String(token1Decimals));
      }

      const res = await fetch(`/api/trading-volume-by-size?${params.toString()}`);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch trading volume by size (${poolIsSolana ? "solana" : "evm"}): ${res.status}`
        );
      }

      const payload = (await res.json()) as TradingVolumeBySizeResult;
      return { dailyData: payload.dailyData ?? [] };
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
  });
}
