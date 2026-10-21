import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  envioClient,
  GET_LP_EVENTS_QUERY,
  GET_POOL_DAY_DATA_QUERY,
  GET_NEW_POSITIONS_COUNT_QUERY,
  type LPEventData,
  type PoolDayData,
  type PoolHourData,
} from '@/lib/envio-client';
import { DEFAULT_POOL_KEY, isSolanaPool, normalizePoolKey } from "@/lib/pools";
import {
  fetchWorldchainPoolDayData,
  isWorldchainIndexerPool,
} from "@/lib/worldchain-indexer-client";
import { buildWorldchainTimeBuckets } from "@/lib/worldchain-pool-data";

const DEFAULT_TOKEN1_DECIMALS = 6;

// Helper to get day timestamp (UTC midnight)
const getDayTimestamp = (ts: number) => Math.floor(ts / 86400) * 86400;

// Hook to get LP events for entry/exit analysis
export function useLPEvents(
  poolAddress: string = DEFAULT_POOL_KEY,
  days: number = 7,
  enabled: boolean = true
) {
  // Use stable time boundaries (round to hour) for better cache hits
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const startTime = roundedNow - (days * 86400);
  const poolKey = normalizePoolKey(poolAddress);
  const solana = isSolanaPool(poolKey);

  return useQuery({
    queryKey: ['lpEvents', poolKey, days, startTime, solana ? 'solana' : 'evm'],
    queryFn: async () => {
      if (solana || isWorldchainIndexerPool(poolKey)) {
        const params = new URLSearchParams({
          pool: poolKey,
          startTime: String(startTime),
          endTime: String(roundedNow),
          include: "events",
        });
        const res = await fetch(`/api/pool-data?${params.toString()}`);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const data = await res.json();
        return (data.lpevents ?? []) as LPEventData[];
      }

      // EVM pools: use Envio GraphQL
      const response = await envioClient.request<{ lpevents: LPEventData[] }>(
        GET_LP_EVENTS_QUERY,
        {
          pool: poolKey,
          startTime,
          endTime: roundedNow,
        }
      );
      return response.lpevents;
    },
    enabled: enabled && !!poolKey,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // Keep previous data while refetching
    placeholderData: (previousData) => previousData,
  });
}

// Aggregate hourly candle data into daily buckets for Solana pools
function aggregateHourlyToDaily(hourData: PoolHourData[]): PoolDayData[] {
  if (hourData.length === 0) return [];

  const dayMap = new Map<number, {
    volume0: number; volume1: number;
    fees0: number; fees1: number;
    txCount: number;
    openPrice: string; highPrice: number; lowPrice: number; closePrice: string;
    liquidity: string;
  }>();

  for (const h of hourData) {
    const dayTs = getDayTimestamp(h.periodStartUnix);
    const existing = dayMap.get(dayTs);
    const high = Number(h.highPrice || 0);
    const low = Number(h.lowPrice || 0);

    if (!existing) {
      dayMap.set(dayTs, {
        volume0: Number(h.volumeToken0 || 0),
        volume1: Number(h.volumeToken1 || 0),
        fees0: Number(h.feesToken0 || 0),
        fees1: Number(h.feesToken1 || 0),
        txCount: h.txCount || 0,
        openPrice: h.openPrice,
        highPrice: high,
        lowPrice: low > 0 ? low : high,
        closePrice: h.closePrice,
        liquidity: h.liquidity || "0",
      });
    } else {
      existing.volume0 += Number(h.volumeToken0 || 0);
      existing.volume1 += Number(h.volumeToken1 || 0);
      existing.fees0 += Number(h.feesToken0 || 0);
      existing.fees1 += Number(h.feesToken1 || 0);
      existing.txCount += h.txCount || 0;
      if (high > existing.highPrice) existing.highPrice = high;
      if (low > 0 && low < existing.lowPrice) existing.lowPrice = low;
      existing.closePrice = h.closePrice; // last hour's close = day's close
      if (h.liquidity && h.liquidity !== "0") existing.liquidity = h.liquidity;
    }
  }

  const result: PoolDayData[] = [];
  for (const [dayTs, d] of dayMap) {
    result.push({
      id: `solana-day-${dayTs}`,
      date: dayTs,
      volumeToken0: String(d.volume0),
      volumeToken1: String(d.volume1),
      feesToken0: String(d.fees0),
      feesToken1: String(d.fees1),
      txCount: d.txCount,
      openPrice: d.openPrice,
      highPrice: String(d.highPrice),
      lowPrice: String(d.lowPrice),
      closePrice: d.closePrice,
      liquidity: d.liquidity,
    });
  }

  // Sort descending (newest first) to match Envio's ordering
  result.sort((a, b) => b.date - a.date);
  return result;
}

// Standalone fetcher used by both usePoolDayData and aggregate hooks (e.g. the
// birds-eye pool-volume rollup). Sharing this keeps query keys identical so
// react-query caches are reused between the per-pool and aggregate paths.
export async function fetchPoolDayData(
  poolAddress: string,
  days: number,
): Promise<PoolDayData[]> {
  const poolKey = normalizePoolKey(poolAddress);
  if (isWorldchainIndexerPool(poolKey)) {
    const now = Math.floor(Date.now() / 1000);
    const roundedNow = Math.floor(now / 3600) * 3600;
    const startTime = roundedNow - days * 86400;
    return (await fetchWorldchainPoolDayData(poolKey, startTime))
      .filter((row) => row.date >= startTime && row.date < roundedNow)
      .slice(-days);
  }

  if (isSolanaPool(poolKey)) {
    const now = Math.floor(Date.now() / 1000);
    const roundedNow = Math.floor(now / 3600) * 3600;
    const startTime = roundedNow - days * 86400;
    const params = new URLSearchParams({
      pool: poolKey,
      startTime: String(startTime),
      endTime: String(roundedNow),
      include: "hours",
    });
    const res = await fetch(`/api/pool-data?${params.toString()}`);
    if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
    const data = await res.json();
    const hourData: PoolHourData[] = data.poolHourDatas ?? [];
    return aggregateHourlyToDaily(hourData);
  }

  const response = await envioClient.request<{ poolDayDatas: PoolDayData[] }>(
    GET_POOL_DAY_DATA_QUERY,
    { pool: poolKey, limit: days },
  );
  return response.poolDayDatas;
}

export function getPoolDayDataQueryKey(poolAddress: string, days: number) {
  const poolKey = normalizePoolKey(poolAddress);
  return [
    "poolDayData",
    poolKey,
    days,
    isSolanaPool(poolKey)
      ? "solana"
      : isWorldchainIndexerPool(poolKey)
        ? "railway-day"
        : "evm",
  ] as const;
}

// Hook to get pool day data for metrics
export function usePoolDayData(
  poolAddress: string = DEFAULT_POOL_KEY,
  days: number = 30,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: getPoolDayDataQueryKey(poolAddress, days),
    queryFn: () => fetchPoolDayData(poolAddress, days),
    enabled: enabled && !!normalizePoolKey(poolAddress),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });
}

// Hook to get new positions count
export function useNewPositionsCount(
  poolAddress: string = DEFAULT_POOL_KEY, 
  startTime: number,
  endTime: number
) {
  return useQuery({
    queryKey: ['newPositionsCount', normalizePoolKey(poolAddress), startTime, endTime],
    queryFn: async () => {
      const poolKey = normalizePoolKey(poolAddress);
      if (isSolanaPool(poolKey) || isWorldchainIndexerPool(poolKey)) {
        const params = new URLSearchParams({
          pool: poolKey,
          startTime: String(startTime),
          endTime: String(endTime),
          include: "events",
        });
        const res = await fetch(`/api/pool-data?${params.toString()}`);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const data = await res.json();
        const events = (data.lpevents ?? []) as Array<{ eventType?: string }>;
        return events.filter((event) => event.eventType === "MINT").length;
      }

      // The Graph doesn't support _aggregate, so we fetch events and count client-side
      const response = await envioClient.request<{ 
        lpevents: Array<{ id: string }> 
      }>(
        GET_NEW_POSITIONS_COUNT_QUERY,
        {
          pool: poolKey,
          startTime,
          endTime,
        }
      );
      return response.lpevents?.length ?? 0;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}

// Processed metrics hook
export function usePoolMetrics(args: {
  poolAddress?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  token1Symbol?: string;
  enabled?: boolean;
}) {
  const {
    poolAddress = DEFAULT_POOL_KEY,
    token1Decimals = DEFAULT_TOKEN1_DECIMALS,
    token1Symbol = "token1",
    enabled = true,
  } = args;
  const { data: dayData, isLoading, isError } = usePoolDayData(poolAddress, 30, enabled);

  const metrics = {
    // Today's metrics (most recent day)
    volume24h: 0,
    fees24h: 0,
    txCount24h: 0,
    currentLiquidity: BigInt(0),
    denomSymbol: token1Symbol,

    // TVL changes
    tvlChange7d: 0,
    tvlChange30d: 0,

    // Volume trend
    volumeChange7d: 0,

    isLoading: isLoading || (isError && !dayData),
  };

  if (!dayData || dayData.length === 0) {
    return metrics;
  }

  // Most recent day
  const today = dayData[0];

  // Use only one side to avoid double-counting (both columns represent the same trades)
  const volume1 = Number(today.volumeToken1) / 10 ** token1Decimals;
  metrics.volume24h = volume1;

  // Calculate 24h fees using token1 side only (same double-counting principle)
  const fees1 = Number(today.feesToken1) / 10 ** token1Decimals;
  metrics.fees24h = fees1;

  metrics.txCount24h = today.txCount;

  // For Solana pools, liquidity may be "0" (not tracked in candles); skip BigInt TVL math
  const liquidityStr = today.liquidity || "0";
  const hasLiquidity = liquidityStr !== "0" && /^\d+$/.test(liquidityStr);
  if (hasLiquidity) {
    metrics.currentLiquidity = BigInt(liquidityStr);
  }

  // TVL % changes (only meaningful when liquidity is a valid BigInt)
  if (hasLiquidity && dayData.length >= 7) {
    const liq7 = dayData[6].liquidity || "0";
    if (/^\d+$/.test(liq7)) {
      const liquidity7dAgo = BigInt(liq7);
      if (liquidity7dAgo > BigInt(0)) {
        metrics.tvlChange7d = Number(
          ((metrics.currentLiquidity - liquidity7dAgo) * BigInt(10000)) / liquidity7dAgo
        ) / 100;
      }
    }
  }

  if (hasLiquidity && dayData.length >= 30) {
    const liq30 = dayData[29].liquidity || "0";
    if (/^\d+$/.test(liq30)) {
      const liquidity30dAgo = BigInt(liq30);
      if (liquidity30dAgo > BigInt(0)) {
        metrics.tvlChange30d = Number(
          ((metrics.currentLiquidity - liquidity30dAgo) * BigInt(10000)) / liquidity30dAgo
        ) / 100;
      }
    }
  }

  return metrics;
}

// LP Entry/Exit data processing
export function useLPEntryExitData(
  poolAddress: string = DEFAULT_POOL_KEY,
  days: number = 7,
  enabled: boolean = true,
  options: {
    authoritativeEmptyWindow?: boolean;
  } = {}
) {
  const authoritativeEmptyWindow = options.authoritativeEmptyWindow ?? false;
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const startTime = roundedNow - days * 86400;
  const { data: events, isLoading } = useLPEvents(poolAddress, days, enabled);

  // Memoize the processed data to prevent re-renders
  const result = useMemo(() => {
    const chartData: Array<{ date: number; newLPs: number; exits: number }> = [];
    const dayBuckets = buildWorldchainTimeBuckets(startTime, roundedNow, 86400);

    if (!events || events.length === 0) {
      if (authoritativeEmptyWindow) {
        return {
          chartData: dayBuckets.map((date) => ({
            date,
            newLPs: 0,
            exits: 0,
          })),
          rawEvents: [] as LPEventData[],
        };
      }
      return { chartData, rawEvents: [] as LPEventData[] };
    }

    // Group events by day
    const eventsByDay = new Map<number, { mints: Set<string>; burns: Set<string> }>();

    events.forEach((event) => {
      const dayTimestamp = getDayTimestamp(event.timestamp);
      
      if (!eventsByDay.has(dayTimestamp)) {
        eventsByDay.set(dayTimestamp, { mints: new Set(), burns: new Set() });
      }

      const dayData = eventsByDay.get(dayTimestamp)!;
      
      if (event.eventType === 'MINT') {
        dayData.mints.add(event.owner);
      } else if (event.eventType === 'BURN') {
        dayData.burns.add(event.owner);
      }
    });

    for (const timestamp of dayBuckets) {
      const dayData = eventsByDay.get(timestamp);
      chartData.push({
        date: timestamp,
        newLPs: dayData?.mints.size ?? 0,
        exits: dayData?.burns.size ?? 0,
      });
    }

    return { chartData, rawEvents: events };
  }, [authoritativeEmptyWindow, events, roundedNow, startTime]);

  return { ...result, isLoading };
}
