import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchPoolDayData, getPoolDayDataQueryKey } from "@/hooks/use-pool-metrics";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";

export interface BirdsEyePoolVolumeDay {
  /** UTC YYYY-MM-DD (matches MakerVolumeChartDay.day for easy joining) */
  day: string;
  /** Aggregated USD volume across every Kraken pool for that day */
  volumeUsd: number;
}

export interface BirdsEyePoolVolumeData {
  days: BirdsEyePoolVolumeDay[];
  totalUsd: number;
  isLoading: boolean;
}

function utcDayKey(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toISOString().slice(0, 10);
}

/**
 * Aggregates daily USD volume across the supplied Kraken pools.
 *
 * Mirrors the per-pool conversion used in token-dashboard-data:
 *   volumeUsd ≈ (volumeToken1 / 10^token1Decimals) × token1Usd
 *
 * That works because the Kraken xStocks pools all pair against USDC, so
 * summing token1 volume (USDC raw) gives a clean USD total without needing
 * the volatile-side price.
 */
export function useBirdsEyePoolVolume(
  poolCards: BirdsEyePoolCard[],
  days = 30,
): BirdsEyePoolVolumeData {
  const queries = useQueries({
    queries: poolCards.map((card) => ({
      queryKey: getPoolDayDataQueryKey(card.pool.poolKey, days),
      queryFn: () => fetchPoolDayData(card.pool.poolKey, days),
      // Skip pools that haven't loaded their poolData yet — we need decimals
      // and a USD price to convert raw volume cleanly.
      enabled: !!card.poolData && card.token1Usd !== null,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    })),
  });

  return useMemo<BirdsEyePoolVolumeData>(() => {
    const dayUsd = new Map<string, number>();
    let totalUsd = 0;

    for (let i = 0; i < poolCards.length; i++) {
      const card = poolCards[i];
      const result = queries[i];
      const poolData = card.poolData;
      const token1Usd = card.token1Usd;
      if (!result?.data || !poolData || token1Usd === null) continue;

      const decimals = poolData.token1Decimals ?? 6;
      const divisor = 10 ** decimals;
      for (const dayRow of result.data) {
        const raw = Number(dayRow.volumeToken1);
        if (!Number.isFinite(raw) || raw <= 0) continue;
        const usd = (raw / divisor) * token1Usd;
        if (!Number.isFinite(usd) || usd <= 0) continue;
        const key = utcDayKey(dayRow.date);
        dayUsd.set(key, (dayUsd.get(key) ?? 0) + usd);
        totalUsd += usd;
      }
    }

    const sortedDays: BirdsEyePoolVolumeDay[] = [...dayUsd.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([day, volumeUsd]) => ({ day, volumeUsd }));

    const isLoading = queries.some((q) => q.isLoading);
    return { days: sortedDays, totalUsd, isLoading };
  }, [poolCards, queries]);
}
