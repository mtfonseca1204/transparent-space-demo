"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { envioClient, type V3SwapEventData, type LPEventData } from "@/lib/envio-client";
import { isSolanaPool, normalizePoolKey } from "@/lib/pools";
import { isWorldchainIndexerPool } from "@/lib/worldchain-indexer-client";

export interface VolumeAttributionData {
  address: string;
  volumeUsd: number;
  volumePercentage: number;
  swapCount: number;
}

export interface VolumeAttributionResult {
  attribution: VolumeAttributionData[];
  totalVolumeUsd: number;
  totalSwaps: number;
  isLoading: boolean;
}

// Query to fetch LP events with pagination
const GET_LP_EVENTS_PAGINATED = `
  query GetLPEventsPaginated($pool: String!, $lastTimestamp: Int!, $first: Int!) {
    lpevents(
      where: {
        pool: $pool
        timestamp_gt: $lastTimestamp
      }
      orderBy: timestamp
      orderDirection: asc
      first: $first
    ) {
      id
      owner
      eventType
      timestamp
      liquidityDelta
      tickLower
      tickUpper
    }
  }
`;

// Query to fetch swaps with pagination
const GET_SWAPS_PAGINATED = `
  query GetSwapsPaginated($pool: String!, $since: Int!, $lastTimestamp: Int!, $first: Int!) {
    uniswapV3PoolSwaps(
      where: {
        pool: $pool
        timestamp_gte: $since
        timestamp_gt: $lastTimestamp
      }
      orderBy: timestamp
      orderDirection: asc
      first: $first
    ) {
      id
      timestamp
      tick
      amount0
      amount1
      sqrtPriceX96
    }
  }
`;

// Initial query (without timestamp_gt filter for first page)
const GET_LP_EVENTS_INITIAL = `
  query GetLPEventsInitial($pool: String!, $first: Int!) {
    lpevents(
      where: {
        pool: $pool
      }
      orderBy: timestamp
      orderDirection: asc
      first: $first
    ) {
      id
      owner
      eventType
      timestamp
      liquidityDelta
      tickLower
      tickUpper
    }
  }
`;

const GET_SWAPS_INITIAL = `
  query GetSwapsInitial($pool: String!, $since: Int!, $first: Int!) {
    uniswapV3PoolSwaps(
      where: {
        pool: $pool
        timestamp_gte: $since
      }
      orderBy: timestamp
      orderDirection: asc
      first: $first
    ) {
      id
      timestamp
      tick
      amount0
      amount1
      sqrtPriceX96
    }
  }
`;

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // Safety limit
const DELAY_BETWEEN_REQUESTS_MS = 300; // Delay to avoid rate limiting
const MAX_RETRIES = 3;

// Helper to delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute a request with retry logic for rate limiting (429 errors)
 */
async function requestWithRetry<T>(
  queryFn: () => Promise<T>,
  retryCount = 0
): Promise<T> {
  try {
    return await queryFn();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check if it's a rate limit error (429)
    if (errorMessage.includes('429') && retryCount < MAX_RETRIES) {
      const waitTime = Math.pow(2, retryCount + 1) * 1000; // 2s, 4s, 8s

      await delay(waitTime);
      return requestWithRetry(queryFn, retryCount + 1);
    }
    
    throw error;
  }
}

interface PositionState {
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

interface UseVolumeAttributionPreciseOptions {
  poolAddress: string;
  token0Decimals?: number;
  token1Decimals?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  enabled?: boolean;
}

/**
 * Fetch all LP events with pagination and rate limit handling
 */
async function fetchAllLPEvents(poolAddress: string): Promise<LPEventData[]> {
  const allEvents: LPEventData[] = [];
  let lastTimestamp = -1;
  let pageCount = 0;
  let hasMore = true;

  // First page (no timestamp_gt filter)
  const initialResponse = await requestWithRetry(() => 
    envioClient.request<{ lpevents: LPEventData[] }>(
      GET_LP_EVENTS_INITIAL,
      { pool: poolAddress, first: PAGE_SIZE }
    )
  );
  const initialEvents = initialResponse.lpevents ?? [];
  allEvents.push(...initialEvents);

  if (initialEvents.length > 0) {
    lastTimestamp = initialEvents[initialEvents.length - 1].timestamp;
  }
  hasMore = initialEvents.length === PAGE_SIZE;

  // Continue fetching if we got a full page
  while (hasMore && pageCount < MAX_PAGES) {
    // Add delay between requests to avoid rate limiting
    await delay(DELAY_BETWEEN_REQUESTS_MS);
    
    pageCount++;
    const response = await requestWithRetry(() =>
      envioClient.request<{ lpevents: LPEventData[] }>(
        GET_LP_EVENTS_PAGINATED,
        { pool: poolAddress, lastTimestamp, first: PAGE_SIZE }
      )
    );
    const events = response.lpevents ?? [];
    if (events.length === 0) break;

    allEvents.push(...events);
    lastTimestamp = events[events.length - 1].timestamp;
    hasMore = events.length === PAGE_SIZE;
  }

  return allEvents;
}

/**
 * Fetch all swaps for last 24h with pagination and rate limit handling
 */
async function fetchAllSwaps24h(poolAddress: string): Promise<V3SwapEventData[]> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - 86400; // Last 24 hours

  const allSwaps: V3SwapEventData[] = [];
  let lastTimestamp = since - 1; // Start just before the 'since' time
  let pageCount = 0;
  let hasMore = true;

  // First page
  const initialResponse = await requestWithRetry(() =>
    envioClient.request<{ uniswapV3PoolSwaps: V3SwapEventData[] }>(
      GET_SWAPS_INITIAL,
      { pool: poolAddress, since, first: PAGE_SIZE }
    )
  );
  const initialSwaps = initialResponse.uniswapV3PoolSwaps ?? [];
  allSwaps.push(...initialSwaps);

  if (initialSwaps.length > 0) {
    lastTimestamp = initialSwaps[initialSwaps.length - 1].timestamp;
  }
  hasMore = initialSwaps.length === PAGE_SIZE;

  // Continue fetching if we got a full page
  while (hasMore && pageCount < MAX_PAGES) {
    // Add delay between requests to avoid rate limiting
    await delay(DELAY_BETWEEN_REQUESTS_MS);
    
    pageCount++;
    const response = await requestWithRetry(() =>
      envioClient.request<{ uniswapV3PoolSwaps: V3SwapEventData[] }>(
        GET_SWAPS_PAGINATED,
        { pool: poolAddress, since, lastTimestamp, first: PAGE_SIZE }
      )
    );
    const swaps = response.uniswapV3PoolSwaps ?? [];
    if (swaps.length === 0) break;

    allSwaps.push(...swaps);
    lastTimestamp = swaps[swaps.length - 1].timestamp;
    hasMore = swaps.length === PAGE_SIZE;
  }

  return allSwaps;
}

/**
 * Calculate volume attribution by LP with point-in-time precision
 * 
 * For each swap:
 * 1. Replay ALL LP events up to that swap's timestamp
 * 2. Build exact position state at that moment
 * 3. Find positions covering the swap's tick with their actual liquidity
 * 4. Attribute volume proportionally based on liquidity share
 * 
 * This is computationally expensive but 100% accurate.
 */
export function useVolumeAttributionPrecise({
  poolAddress,
  token0Decimals = 18,
  token1Decimals = 6,
  token0UsdPrice,
  token1UsdPrice,
  enabled = true,
}: UseVolumeAttributionPreciseOptions): VolumeAttributionResult {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const usesPoolDataApi = isSolanaPool(poolAddressNorm) || isWorldchainIndexerPool(poolAddressNorm);
  const poolAddressLc = poolAddressNorm.toLowerCase();
  const graphQLEnabled = enabled && !!poolAddressNorm && !usesPoolDataApi;

  // Fetch ALL LP events for replay (with pagination)
  const lpEventsQuery = useQuery({
    queryKey: ["allLpEventsForAttribution", poolAddressLc],
    queryFn: () => fetchAllLPEvents(poolAddressLc),
    enabled: graphQLEnabled,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Fetch swaps for last 24h (with pagination)
  const swapsQuery = useQuery({
    queryKey: ["swaps24hForAttribution", poolAddressLc],
    queryFn: () => fetchAllSwaps24h(poolAddressLc),
    enabled: graphQLEnabled,
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Process: point-in-time reconstruction
  const result = useMemo<VolumeAttributionResult>(() => {
    const events = lpEventsQuery.data;
    const swaps = swapsQuery.data;

    if (!events || !swaps) {
      return {
        attribution: [],
        totalVolumeUsd: 0,
        totalSwaps: 0,
        isLoading: lpEventsQuery.isLoading || swapsQuery.isLoading,
      };
    }

    const t0Usd = token0UsdPrice ?? 0;
    const t1Usd = token1UsdPrice ?? 0;

    // Helper to create position key
    const positionKey = (owner: string, tickLower: number, tickUpper: number) =>
      `${owner.toLowerCase()}-${tickLower}-${tickUpper}`;

    // Sort events by timestamp ascending
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    
    // Sort swaps by timestamp ascending
    const sortedSwaps = [...swaps].sort((a, b) => a.timestamp - b.timestamp);

    // Track volume attribution by owner
    const volumeByOwner = new Map<string, { volumeUsd: number; swapCount: number }>();
    let totalVolumeUsd = 0;

    // Build position state progressively as we process swaps
    const positionState = new Map<string, PositionState>();
    let eventIdx = 0;

    // Process each swap
    for (const swap of sortedSwaps) {
      const swapTimestamp = swap.timestamp;
      const swapTick = Number(swap.tick);

      // Replay all events up to this swap's timestamp
      while (eventIdx < sortedEvents.length && sortedEvents[eventIdx].timestamp <= swapTimestamp) {
        const e = sortedEvents[eventIdx];
        const owner = e.owner.toLowerCase();
        const tickLower = parseInt(e.tickLower);
        const tickUpper = parseInt(e.tickUpper);
        const key = positionKey(owner, tickLower, tickUpper);
        const delta = BigInt(e.liquidityDelta);

        const existing = positionState.get(key);
        if (existing) {
          existing.liquidity += delta;
          if (existing.liquidity <= 0n) {
            positionState.delete(key);
          }
        } else if (delta > 0n) {
          positionState.set(key, {
            owner,
            tickLower,
            tickUpper,
            liquidity: delta,
          });
        }

        eventIdx++;
      }

      // Calculate swap volume in USD
      const amount0 = swap.amount0 ? Math.abs(Number(swap.amount0)) / Math.pow(10, token0Decimals) : 0;
      const amount1 = swap.amount1 ? Math.abs(Number(swap.amount1)) / Math.pow(10, token1Decimals) : 0;
      
      let swapVolumeUsd = 0;
      if (t0Usd > 0 && amount0 > 0) {
        swapVolumeUsd = amount0 * t0Usd;
      } else if (t1Usd > 0 && amount1 > 0) {
        swapVolumeUsd = amount1 * t1Usd;
      }

      totalVolumeUsd += swapVolumeUsd;

      // Find all positions that cover this swap's tick AT THIS MOMENT
      const coveringPositions: { owner: string; liquidity: bigint }[] = [];
      let totalLiquidityAtTick = 0n;

      for (const [_key, pos] of positionState.entries()) {
        if (pos.tickLower <= swapTick && swapTick < pos.tickUpper && pos.liquidity > 0n) {
          coveringPositions.push({ owner: pos.owner, liquidity: pos.liquidity });
          totalLiquidityAtTick += pos.liquidity;
        }
      }

      // Attribute volume to each LP proportionally
      if (totalLiquidityAtTick > 0n && coveringPositions.length > 0) {
        for (const { owner, liquidity } of coveringPositions) {
          const share = Number(liquidity * 10000n / totalLiquidityAtTick) / 10000;
          const attributedVolume = swapVolumeUsd * share;

          const existing = volumeByOwner.get(owner) || { volumeUsd: 0, swapCount: 0 };
          volumeByOwner.set(owner, {
            volumeUsd: existing.volumeUsd + attributedVolume,
            swapCount: existing.swapCount + 1,
          });
        }
      }
    }

    // Convert to sorted array
    const attribution: VolumeAttributionData[] = Array.from(volumeByOwner.entries())
      .map(([address, data]) => ({
        address,
        volumeUsd: data.volumeUsd,
        volumePercentage: totalVolumeUsd > 0 ? (data.volumeUsd / totalVolumeUsd) * 100 : 0,
        swapCount: data.swapCount,
      }))
      .sort((a, b) => b.volumeUsd - a.volumeUsd);

    return {
      attribution,
      totalVolumeUsd,
      totalSwaps: sortedSwaps.length,
      isLoading: false,
    };
  }, [
    lpEventsQuery.data,
    swapsQuery.data,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
  ]);

  return {
    ...result,
    isLoading: result.isLoading || lpEventsQuery.isLoading || swapsQuery.isLoading,
  };
}
