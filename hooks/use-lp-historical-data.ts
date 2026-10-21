import { useMemo } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  envioClient,
  GET_OWNER_POSITION_AGGREGATES_QUERY,
  GET_POSITIONS_BY_OWNER_QUERY,
  POSITION_FRAGMENT,
  GET_TICK_LIQUIDITY_QUERY,
  GET_ALL_TICK_LIQUIDITY_QUERY,
  sqrtPriceX96ToPrice,
  tickToPrice,
  priceToTick,
  type CandleData,
  type OwnerPositionAggregateData,
  type PositionData,
  type TickLiquidityData,
  type LPEventData,
  type PoolHourData,
  type V3PoolMintEventData,
  type V3PoolBurnEventData,
  type V3SwapEventData,
  type BatchedPoolDataResponse,
} from '@/lib/envio-client';
import type { WorldchainPoolDataMeta } from "@/lib/worldchain-pool-data";
import { getPoolAnalyticsProfile } from "@/lib/pool-analytics";
import type { TradingChartData, OHLCDataPoint, OraclePricePoint, DepthDataPoint, PeggingDataPoint } from '@/components/custom-metrics/lp-address-activity';
import { DEFAULT_POOL_KEY, isV4PoolKey, isSolanaPool, normalizePoolKey } from "@/lib/pools";
import {
  fetchWorldchainOwnerAggregates,
  fetchWorldchainPositions,
  fetchWorldchainPositionsByOwner,
  fetchWorldchainTickLiquidity,
  isWorldchainIndexerPool,
} from "@/lib/worldchain-indexer-client";
import { getSqrtRatioAtTick } from "@/lib/depth-calculator";
import type { OracleSource, ChartGranularity } from "@/stores/chart-settings-store";
import { GRANULARITY_SECONDS } from "@/stores/chart-settings-store";
import { useHistoricalOracle, interpolateOracleToTimestamps, computeDexTwap } from "./use-historical-oracle";
import { getLastSyncTime, setLastSyncTime, buildSyncKey, calculateIncrementalStart } from "@/lib/sync-state";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";

// Default to 18 decimals for both tokens - safer default that won't cause overflow
// The actual decimals should be passed from poolData once loaded
const DEFAULT_TOKEN0_DECIMALS = 18;
const DEFAULT_TOKEN1_DECIMALS = 18;
const INTEGER_STRING_RE = /^-?\d+$/;


// Adaptive candle interval: pick the right resolution so we stay within
// ~150-500 data points per chart, avoiding rate limits on longer ranges.
// Supported intervals: 300 (5m), 900 (15m), 3600 (1h), 14400 (4h), 86400 (1d)
export function getAutoCandleInterval(timeRange: TimeRange): number {
  switch (timeRange) {
    case '1h':
    case '4h':
    case '12h':
    case '1d':
      return 300;   // 5m  → 12–288 points
    case '3d':
      return 900;   // 15m → 288 points
    case '1w':
    case '2w':
      return 3600;  // 1h  → 168–336 points
    case '1m':
    case '3m':
      return 14400; // 4h  → 180–540 points
    case '1y':
      return 86400; // 1d  → 365 points
    default:
      return 300;
  }
}

// Resolve candle interval: use explicit granularity when set, otherwise auto-pick.
export function resolveCandleInterval(timeRange: TimeRange, granularity: ChartGranularity): number {
  if (granularity === 'auto') return getAutoCandleInterval(timeRange);
  return GRANULARITY_SECONDS[granularity];
}

function parsePriceFromCandleValue(
  value: string | number | null | undefined,
  isSolana: boolean,
  token0Decimals: number,
  token1Decimals: number
): number {
  const raw = String(value ?? "0").trim();
  if (isSolana) return Number(raw) || 0;
  if (INTEGER_STRING_RE.test(raw)) {
    return sqrtPriceX96ToPrice(BigInt(raw), token0Decimals, token1Decimals);
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function asSqrtPriceX96(
  value: string | number | null | undefined,
  isSolana: boolean,
  token0Decimals?: number,
  token1Decimals?: number
): string | undefined {
  if (isSolana) {
    // Solana candle closePrice is a human-readable price (e.g. 350.50 USDC per TSLAx).
    // Convert to sqrtPriceX96 using the exact tick-based method (same as use-historical-slippage.ts).
    const humanPrice = Number(value);
    if (!Number.isFinite(humanPrice) || humanPrice <= 0) return undefined;
    const d0 = token0Decimals ?? 0;
    const d1 = token1Decimals ?? 0;
    // rawPrice = humanPrice adjusted for decimal difference (same convention as Uniswap V3)
    const rawPrice = humanPrice * Math.pow(10, d1 - d0);
    const tick = priceToTick(rawPrice);
    return getSqrtRatioAtTick(tick).toString();
  }
  const raw = String(value ?? "").trim();
  return INTEGER_STRING_RE.test(raw) ? raw : undefined;
}

// Uniswap V3 math helpers for proper USD depth calculation
function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

function approxBigIntToNumber(v: bigint): number {
  const s = v < 0n ? (-v).toString() : v.toString();
  if (s.length <= 15) return Number(s) * (v < 0n ? -1 : 1);
  const mantissa = Number(s.slice(0, 15));
  const exponent = s.length - 15;
  const n = mantissa * Math.pow(10, exponent);
  return v < 0n ? -n : n;
}

function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Calculate USD liquidity depth within a tick range using proper Uniswap V3 math.
 * This mirrors the Uniswap V3 amount math used by the liquidity charts.
 */
function calculateDepthInRange(
  tickLiquidityData: TickLiquidityData[],
  currentTick: number,
  currentLiquidity: bigint,
  targetTick: number,
  token0Decimals: number,
  token1Decimals: number,
  token0UsdPrice: number | null,
  token1UsdPrice: number | null,
  currentPrice: number
): number {
  if (!tickLiquidityData || tickLiquidityData.length === 0) return 0;

  const sorted = [...tickLiquidityData].sort((a, b) => a.tick - b.tick);
  const ticks = sorted.map((t) => t.tick);
  const nets = sorted.map((t) => BigInt(t.liquidityNet));

  // Build prefix sum for liquidityNet
  const prefix: bigint[] = new Array(nets.length);
  for (let i = 0; i < nets.length; i++) {
    prefix[i] = (i === 0 ? 0n : prefix[i - 1]) + nets[i];
  }

  const sumNet = (loExclusive: number, hiInclusive: number): bigint => {
    if (ticks.length === 0) return 0n;
    if (hiInclusive <= loExclusive) return 0n;
    const hi = upperBound(ticks, hiInclusive) - 1;
    const lo = upperBound(ticks, loExclusive) - 1;
    if (hi < 0 || hi < lo + 1) return 0n;
    const hiSum = prefix[hi];
    const loSum = lo >= 0 ? prefix[lo] : 0n;
    return hiSum - loSum;
  };

  const liquidityAtTick = (t: number): bigint => {
    if (t === currentTick) return currentLiquidity;
    if (t < currentTick) {
      return currentLiquidity - sumNet(t, currentTick);
    }
    return currentLiquidity + sumNet(currentTick, t);
  };

  // USD price derivation
  const t0Usd =
    typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
      ? token0UsdPrice
      : typeof token1UsdPrice === "number" &&
          Number.isFinite(token1UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token1UsdPrice * currentPrice
        : null;
  const t1Usd =
    typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
      ? token1UsdPrice
      : typeof token0UsdPrice === "number" &&
          Number.isFinite(token0UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token0UsdPrice / currentPrice
        : null;
  const useUsd = t0Usd !== null && t1Usd !== null;

  // Determine tick range and step
  const minTick = Math.min(currentTick, targetTick);
  const maxTick = Math.max(currentTick, targetTick);
  const tickSpacing = 200; // Common tick spacing
  const step = tickSpacing;

  let totalUsd = 0;

  for (let t = minTick; t < maxTick; t += step) {
    const tickMin = t;
    const tickMax = Math.min(maxTick, t + step);
    const liquidityActive = liquidityAtTick(tickMin);

    // Calculate token amounts using Uniswap v3 math
    const sqrtA = tickToSqrtPrice(tickMin);
    const sqrtB = tickToSqrtPrice(tickMax);
    const Lnum = Math.max(0, approxBigIntToNumber(liquidityActive));

    const sqrtP = tickToSqrtPrice(currentTick);
    const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
    const dUp = Math.max(0, sqrtB - clamped);
    const dDown = Math.max(0, clamped - sqrtA);

    const amount0Raw = clamped > 0 && sqrtB > 0 ? (Lnum * dUp) / (clamped * sqrtB) : 0;
    const amount1Raw = Lnum * dDown;

    const amount0 = amount0Raw / Math.pow(10, token0Decimals);
    const amount1 = amount1Raw / Math.pow(10, token1Decimals);

    // Calculate USD value
    const value0 = useUsd ? amount0 * t0Usd! : amount0 * currentPrice;
    const value1 = useUsd ? amount1 * t1Usd! : amount1;
    totalUsd += value0 + value1;
  }

  return totalUsd;
}

// Time range presets in seconds
const TIME_RANGES = {
  '1h': 3600,
  '4h': 14400,
  '12h': 43200,
  '1d': 86400,
  '3d': 259200,
  '1w': 604800,
  '2w': 1209600,
  '1m': 2592000,
  '3m': 7776000,
  '1y': 31536000,
} as const;

export type TimeRange = keyof typeof TIME_RANGES;

interface UseLPHistoricalDataOptions {
  poolAddress?: string;
  marketMakerAddress?: string;
  timeRange?: TimeRange;
  granularity?: ChartGranularity;
  oracleRangePct?: { minPct: number; maxPct: number };
  oracleSource?: OracleSource;
  /** Token address used to fetch external oracle prices (e.g., token1 for USD-denominated) */
  oracleTokenAddress?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  enabled?: boolean;
  spaceSlug?: string | null;
}

interface LPHistoricalDataResult {
  chartData: TradingChartData | null;
  lpRanges: Array<{ upper: number; lower: number; owner: string }>;
  // Raw LPEvent rows from the indexer (NPM for v3; ModifyLiquidity attribution for v4).
  lpEvents: LPEventData[];
  // Liquidity deltas to use for v3 impact-band rollback.
  // For v3, pool-level Mint/Burn is the source of truth for TickLiquidity and produces a stable rollback.
  // For v4, this matches lpEvents (ModifyLiquidity).
  impactBandEvents: LPEventData[];
  // v3-only: swaps in the window (used for "impact band per swap" rendering).
  v3Swaps: V3SwapEventData[];
  tickLiquidity: TickLiquidityData[];
  // All active positions in the pool - fetched atomically with other pool data
  // to prevent race conditions in impact band calculations.
  positions: PositionData[];
  ownerAggregates: OwnerPositionAggregateData[];
  meta: WorldchainPoolDataMeta | null;
  precomputedImpactBand: Array<{ timestamp: Date; buyPrice: number; sellPrice: number }> | null;
  precomputedDepthBand: Array<{ timestamp: Date; buyPrice: number; sellPrice: number }> | null;
  isLoading: boolean;
  error: Error | null;
}

export function useLPHistoricalData({
  poolAddress = DEFAULT_POOL_KEY,
  marketMakerAddress,
  timeRange = '1d',
  granularity = 'auto',
  oracleRangePct = { minPct: -1, maxPct: 1 },
  oracleSource = 'dex-twap',
  oracleTokenAddress,
  token0Decimals = DEFAULT_TOKEN0_DECIMALS,
  token1Decimals = DEFAULT_TOKEN1_DECIMALS,
  enabled = true,
  spaceSlug,
}: UseLPHistoricalDataOptions = {}): LPHistoricalDataResult {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const isV4 = isV4PoolKey(poolAddressNorm);
  const isSolana = isSolanaPool(poolAddressNorm);
  const marketMakerAddressNorm = isSolana ? marketMakerAddress?.trim() : marketMakerAddress?.toLowerCase();
  const analyticsProfile = getPoolAnalyticsProfile(poolAddressNorm);
  const isMeteora = analyticsProfile.analyticsModel === "meteora-dlmm";

  // Convert a human price (token1 per token0) into the raw Uniswap ratio used by ticks.
  const humanPriceToRaw = (price: number, d0: number, d1: number): number => {
    const adj = 10 ** (d0 - d1);
    return adj !== 0 ? price / adj : price;
  };

  // Calculate time range - use 5-minute intervals to ensure fresh data
  // The query key uses timeRange (not exact timestamp) for cache efficiency,
  // while the actual fetch uses current time for accuracy
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 300) * 300; // 5-min intervals for data freshness
  const startTime = roundedNow - TIME_RANGES[timeRange];
  const endTime = roundedNow;

  // Pick the right candle resolution for the selected time range + granularity
  const candleInterval = resolveCandleInterval(timeRange, granularity);

  // Fetch candles via API route (parallel fetching on server)
  const { data: candlesData, isLoading: candlesLoading, error: candlesError } = useQuery({
    queryKey: ['candles', poolAddressNorm, timeRange, startTime, spaceSlug ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolAddressNorm,
        interval: String(candleInterval),
        startTime: String(startTime),
        endTime: String(endTime),
      });
      if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);

      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch candles: ${res.status}`);
      }

      const candles = await res.json() as CandleData[];
      return candles;
    },
    enabled,
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // Keep previous data while refetching - prevents flash of empty state
    placeholderData: (previousData) => previousData,
  });

  // Fetch LP positions (only if market maker address is provided)
  const { data: lpPositionsData, isLoading: lpPositionsLoading } = useQuery({
    queryKey: ['positionsByOwner', poolAddressNorm, marketMakerAddressNorm],
    queryFn: async () => {
      if (!marketMakerAddressNorm) return [];
      if (isSolana) {
        const params = new URLSearchParams({
          pool: poolAddressNorm,
          startTime: String(startTime),
          endTime: String(endTime),
          include: "positions",
          positionsPageLimit: "5000",
          positionsMaxPages: "10",
        });
        const res = await fetch(`/api/pool-data?${params.toString()}`);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const data = await res.json();
        const positions = (data.positions ?? []) as PositionData[];
        return positions.filter((p) => p.owner === marketMakerAddressNorm);
      }
      if (isWorldchainIndexerPool(poolAddressNorm)) {
        return fetchWorldchainPositionsByOwner(poolAddressNorm, marketMakerAddressNorm, 1000);
      }
      const response = await envioClient.request<{ positions: PositionData[] }>(GET_POSITIONS_BY_OWNER_QUERY, {
        owner: marketMakerAddressNorm,
        pool: poolAddressNorm,
        limit: 1000,
      });
      return response.positions;
    },
    enabled: enabled && !!marketMakerAddressNorm,
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  // =============================================================================
  // BATCHED QUERY: Combines TickLiquidity + PoolHourData + LPEvent + Mint/Burn
  // Uses /api/pool-data route with server-side caching
  // OPTIMIZATION: Incremental sync - on refetch, only fetch new data since last sync
  // This reduces rate limit consumption from 4 requests to 1 request
  // Multiple users viewing same pool share the cached response
  // =============================================================================
  const queryClient = useQueryClient();
  const syncKey = buildSyncKey('batchedPoolData', poolAddressNorm, timeRange);
  const solanaBatchedStaleTimeMs = isSolana ? 60 * 1000 : 30 * 60 * 1000;
  
  const { data: batchedPoolData, isLoading: batchedPoolDataLoading } = useQuery({
    queryKey: ['batchedPoolData', poolAddressNorm, timeRange, startTime, endTime],
    queryFn: async ({ queryKey }) => {
      // Use a default wide tick range that covers most price movements
      // ±15000 ticks covers ~4x price movement which is plenty for most pools
      const DEFAULT_TICK_RANGE = 15000;
      const minTick = -DEFAULT_TICK_RANGE;
      const maxTick = DEFAULT_TICK_RANGE;

      // Check if we can do incremental sync (for event-based data)
      const lastSync = getLastSyncTime(syncKey);
      const incrementalCandidate = calculateIncrementalStart(
        startTime,
        lastSync,
        300 // Minimum 5 minutes delta for incremental
      );
      // Solana/Raydium history can be repaired by backend backfills. Avoid client-side
      // incremental windows there so repaired older buckets become visible without
      // requiring users to clear state or wait for a full session reset.
      const isIncremental = !isSolana && incrementalCandidate.isIncremental;
      const effectiveFetchStartTime = isIncremental
        ? Math.min(incrementalCandidate.startTime, endTime - 1)
        : startTime;
      const includeSegments = isSolana
        ? (
            isMeteora
              ? ["positions", "events", "hours"]
              : isIncremental
                ? ["events", "hours", "lp-activity"]
                : ["positions", "events", "hours", "lp-activity"]
          )
        : ["positions", "events", "hours", "lp-activity"];
      const existingData = queryClient.getQueryData<{
        tickLiquidity: TickLiquidityData[];
        poolHourData: PoolHourData[];
        lpEvents: LPEventData[];
        v3Mints: V3PoolMintEventData[];
        v3Burns: V3PoolBurnEventData[];
        positions: PositionData[];
        ownerAggregates: OwnerPositionAggregateData[];
        meta: WorldchainPoolDataMeta | null;
        lpActivitySeries: Array<{
          timestamp: number;
          depth_band_buy?: number;
          depth_band_sell?: number;
        }>;
      }>(queryKey);

      if (effectiveFetchStartTime >= endTime) {
        if (existingData) {
          return existingData;
        }
        return {
          tickLiquidity: [],
          poolHourData: [],
          lpEvents: [],
          v3Mints: [],
          v3Burns: [],
          positions: [],
          ownerAggregates: [],
          meta: null,
          lpActivitySeries: [],
        };
      }

      try {
        // Use API route with server-side caching instead of direct envioClient
        const params = new URLSearchParams({
          pool: poolAddressNorm,
          startTime: String(effectiveFetchStartTime),
          endTime: String(endTime),
          minTick: String(minTick),
          maxTick: String(maxTick),
          include: includeSegments.join(","),
        });

        const res = await fetch(`/api/pool-data?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch pool data: ${res.status}`);
        }

        const response = await res.json() as BatchedPoolDataResponse;

        // Update sync timestamp on success
        setLastSyncTime(syncKey, endTime);

        // If incremental, merge with existing cached data
        if (isIncremental) {
          if (existingData) {
            // For event-based data, merge old + new and deduplicate
            const mergeEvents = <T extends { id: string; timestamp: number }>(
              existing: T[],
              incoming: T[],
              cutoffTime: number
            ): T[] => {
              const filtered = existing.filter(e => e.timestamp < cutoffTime);
              const merged = [...filtered, ...incoming];
              // Deduplicate by id
              const seen = new Set<string>();
              return merged.filter(e => {
                if (seen.has(e.id)) return false;
                seen.add(e.id);
                return true;
              }).sort((a, b) => a.timestamp - b.timestamp);
            };

            return {
              // TickLiquidity is state-based, always use latest
              tickLiquidity: response.tickLiquidities ?? [],
              // PoolHourData can be merged
              poolHourData: mergeEvents(
                existingData.poolHourData,
                response.poolHourDatas ?? [],
                effectiveFetchStartTime
              ) as unknown as PoolHourData[],
              // Events are time-series, merge them
              lpEvents: mergeEvents(
                existingData.lpEvents,
                response.lpevents ?? [],
                effectiveFetchStartTime
              ) as unknown as LPEventData[],
              v3Mints: mergeEvents(
                existingData.v3Mints,
                response.uniswapV3PoolMints ?? [],
                effectiveFetchStartTime
              ) as unknown as V3PoolMintEventData[],
              v3Burns: mergeEvents(
                existingData.v3Burns,
                response.uniswapV3PoolBurns ?? [],
                effectiveFetchStartTime
              ) as unknown as V3PoolBurnEventData[],
              // Positions are state-based (current snapshot).
              // On incremental Solana syncs we intentionally skip refetching positions.
              positions: response.positions?.length
                ? response.positions
                : existingData.positions ?? [],
              ownerAggregates: response.ownerAggregates?.length
                ? response.ownerAggregates
                : existingData.ownerAggregates ?? [],
              meta: response.meta ?? existingData.meta ?? null,
              // Aggregated LP-activity depth band is already precomputed server-side
              lpActivitySeries: response.lpActivitySeries ?? existingData.lpActivitySeries ?? [],
            };
          }
        }

        return {
          tickLiquidity: response.tickLiquidities ?? [],
          poolHourData: response.poolHourDatas ?? [],
          lpEvents: response.lpevents ?? [],
          v3Mints: response.uniswapV3PoolMints ?? [],
          v3Burns: response.uniswapV3PoolBurns ?? [],
          positions: response.positions ?? [],
          ownerAggregates: response.ownerAggregates ?? [],
          meta: response.meta ?? null,
          lpActivitySeries: response.lpActivitySeries ?? [],
        };
      } catch {
        return {
          tickLiquidity: [],
          poolHourData: [],
          lpEvents: [],
          v3Mints: [],
          v3Burns: [],
          positions: [],
          ownerAggregates: [],
          meta: null,
          lpActivitySeries: [],
        };
      }
    },
    enabled,
    staleTime: solanaBatchedStaleTimeMs,
    gcTime: 60 * 60 * 1000, // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: isSolana,
    placeholderData: (previousData) => previousData,
  });

  // Destructure batched data to maintain existing variable names
  const tickLiquidityData = batchedPoolData?.tickLiquidity;
  const poolHourData = batchedPoolData?.poolHourData;
  const lpEventsData = batchedPoolData?.lpEvents;
  const v3PoolMintBurnData = batchedPoolData
    ? { mints: batchedPoolData.v3Mints, burns: batchedPoolData.v3Burns }
    : { mints: [], burns: [] };
  // Positions fetched atomically with tick liquidity and events
  const positionsData = batchedPoolData?.positions ?? [];
  const ownerAggregatesData = batchedPoolData?.ownerAggregates ?? [];
  const batchedMeta = batchedPoolData?.meta ?? null;

  // v3-only: swaps for per-swap impact band plotting via API route (parallel fetching)
  // NOTE: This stays separate as it uses an API route with its own chunking logic
  const { data: v3SwapsData, isLoading: v3SwapsLoading } = useQuery({
    queryKey: ['v3SwapsRange', poolAddressNorm, timeRange, startTime],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          pool: poolAddressNorm,
          startTime: String(startTime),
          endTime: String(endTime),
        });

        const res = await fetch(`/api/lp-swaps?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch swaps: ${res.status}`);
        }

        const swaps = await res.json() as V3SwapEventData[];
        return swaps;
      } catch {
        return [];
      }
    },
    enabled: enabled && !isV4 && !isSolana,
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  // Fetch external oracle prices (if not DEX TWAP)
  const {
    data: externalOracleData,
    isLoading: oracleLoading,
  } = useHistoricalOracle({
    source: oracleSource,
    tokenAddress: oracleTokenAddress ?? '',
    startTime,
    endTime,
    enabled: enabled && oracleSource !== 'dex-twap' && !!oracleTokenAddress,
    spaceSlug,
  });

  // Transform data
  const isLoading =
    candlesLoading ||
    lpPositionsLoading ||
    batchedPoolDataLoading ||  // Replaces: tickLiquidityLoading, poolHourLoading, lpEventsLoading, v3PoolMintBurnLoading
    v3SwapsLoading ||
    oracleLoading;
  const error = candlesError as Error | null;

  // IMPORTANT: useMemo must be called before any early returns to satisfy React's
  // Rules of Hooks (hooks must be called in the same order every render).
  const orderedCandlesData = useMemo(
    () => [...(candlesData ?? [])].sort((a, b) => a.timestamp - b.timestamp),
    [candlesData]
  );

  if (!candlesData || candlesData.length === 0) {
    return {
      chartData: null,
      lpRanges: [],
      lpEvents: [],
      impactBandEvents: [],
      v3Swaps: [],
      tickLiquidity: [],
      positions: [],
      ownerAggregates: [],
      meta: null,
      precomputedImpactBand: null,
      precomputedDepthBand: null,
      isLoading,
      error,
    };
  }

  // For Solana, always use local position-based calculation (same approach as Slippage History).
  // Railway's precomputed depth bands are unreliable across resolutions/time ranges.
  const precomputedImpactBand: Array<{ timestamp: Date; buyPrice: number; sellPrice: number }> | null = null;

  const precomputedDepthBand = precomputedImpactBand;

  // Helper: attach the nearest (<=) PoolHourData.liquidity to each candle (same unit as pool liquidity).
  const hourRows = (poolHourData ?? []).slice().sort((a, b) => a.periodStartUnix - b.periodStartUnix);
  const findLiquidityForTs = (tsSec: number): string | undefined => {
    if (hourRows.length === 0) return undefined;
    // Find last row with periodStartUnix <= tsSec (linear scan is fine for small ranges).
    let best: string | undefined = undefined;
    for (let i = 0; i < hourRows.length; i++) {
      const row = hourRows[i]!;
      if (row.periodStartUnix <= tsSec) best = row.liquidity;
      else break;
    }
    return best ?? hourRows[0]?.liquidity;
  };

  // Convert candles to OHLC data
  const ohlcData: OHLCDataPoint[] = orderedCandlesData.map((candle) => {
    // Use only token1 side to avoid double-counting (both columns represent the same trades)
    const volume1 = Number(candle.volume1) / 10 ** token1Decimals;

    // During pool switches with placeholderData, rows can briefly carry the previous pool's price format.
    const open = parsePriceFromCandleValue(candle.openPrice, isSolana, token0Decimals, token1Decimals);
    const high = parsePriceFromCandleValue(candle.highPrice, isSolana, token0Decimals, token1Decimals);
    const low = parsePriceFromCandleValue(candle.lowPrice, isSolana, token0Decimals, token1Decimals);
    const close = parsePriceFromCandleValue(candle.closePrice, isSolana, token0Decimals, token1Decimals);

    return {
      timestamp: new Date(candle.timestamp * 1000),
      open,
      high,
      low,
      close,
      volume: volume1,
      sqrtPriceX96: asSqrtPriceX96(candle.closePrice, isSolana, token0Decimals, token1Decimals),
      liquidity: findLiquidityForTs(candle.timestamp),
    };
  });

  // Generate oracle data: use external source if available, otherwise DEX TWAP (SMA)
  const oracleData: OraclePricePoint[] = (() => {
    // If we have external oracle data, interpolate to match OHLC timestamps
    if (externalOracleData && externalOracleData.length > 0) {
      const timestamps = ohlcData.map((d) => d.timestamp);
      const interpolated = interpolateOracleToTimestamps(externalOracleData, timestamps);
      
      // If interpolation succeeded, use it; otherwise fall back to TWAP
      if (interpolated.length === ohlcData.length) {
        return interpolated;
      }
    }
    
    // Fallback: DEX TWAP (Simple Moving Average over 5 candles)
    return computeDexTwap(ohlcData, 5);
  })();

  // Calculate depth data from tick liquidity using proper Uniswap V3 math (same as Capital Efficiency chart)
  const tickLiquiditySeries = tickLiquidityData ?? [];
  const depthDataRaw: DepthDataPoint[] = tickLiquiditySeries.length === 0 ? [] : ohlcData.map((ohlc, i) => {
    // Calculate depth at oracleRangePct (defaults to ±1%).
    // We anchor around oracle price (not market) to keep this aligned with the oracle band.
    const oraclePrice = oracleData[i]?.price ?? ohlc.close;
    const minPct = Number.isFinite(oracleRangePct.minPct) ? oracleRangePct.minPct : -1;
    const maxPct = Number.isFinite(oracleRangePct.maxPct) ? oracleRangePct.maxPct : 1;
    const lowPct = Math.min(minPct, maxPct);
    const highPct = Math.max(minPct, maxPct);
    const bidPrice = oraclePrice * (1 + lowPct / 100);
    const askPrice = oraclePrice * (1 + highPct / 100);
    
    const bidTick = priceToTick(humanPriceToRaw(bidPrice, token0Decimals, token1Decimals));
    const askTick = priceToTick(humanPriceToRaw(askPrice, token0Decimals, token1Decimals));
    const currentTick = priceToTick(humanPriceToRaw(oraclePrice, token0Decimals, token1Decimals));

    // Get current liquidity from the candle data or estimate from tick data
    const currentLiquidityStr = ohlc.liquidity;
    let currentLiquidity = BigInt(0);
    if (currentLiquidityStr) {
      try {
        currentLiquidity = BigInt(currentLiquidityStr);
      } catch {
        // If parsing fails, try to estimate from tick data
        const activeTick = tickLiquiditySeries.find(t => t.tick <= currentTick);
        if (activeTick) {
          currentLiquidity = BigInt(activeTick.liquidityGross);
        }
      }
    }

    // For token1 (USDC-like stablecoins), assume price ~= 1 USD
    // For token0, use the current price to convert to USD
    const token1UsdPrice = 1; // Assume token1 is USDC or similar
    const token0UsdPrice = oraclePrice; // token0 price in terms of token1 (USD)

    // Calculate bid depth (liquidity available to move price DOWN by lowPct%)
    const bidDepth = calculateDepthInRange(
      tickLiquiditySeries,
      currentTick,
      currentLiquidity,
      bidTick,
      token0Decimals,
      token1Decimals,
      token0UsdPrice,
      token1UsdPrice,
      oraclePrice
    );

    // Calculate ask depth (liquidity available to move price UP by highPct%)
    const askDepth = calculateDepthInRange(
      tickLiquiditySeries,
      currentTick,
      currentLiquidity,
      askTick,
      token0Decimals,
      token1Decimals,
      token0UsdPrice,
      token1UsdPrice,
      oraclePrice
    );

    return {
      timestamp: ohlc.timestamp,
      bidDepth,
      askDepth,
    };
  });

  // Quick workaround: remove "holes" in the depth panel by treating 0 / non-finite
  // points as missing and forward/backward-filling (per-side) from the nearest valid value.
  // Also interpolates across bounded gaps to keep the series smooth at candle cadence.
  // This is cosmetic and does not change the underlying depth model.
  const depthData: DepthDataPoint[] = (() => {
    if (!depthDataRaw || depthDataRaw.length === 0) return [];

    const isValid = (v: number) => Number.isFinite(v) && v > 0;

    const fillOne = (values: number[]): number[] => {
      const n = values.length;
      const out = values.map((v) => (isValid(v) ? v : NaN));

      const validIdx: number[] = [];
      for (let i = 0; i < n; i++) if (Number.isFinite(out[i]!)) validIdx.push(i);
      if (validIdx.length === 0) return new Array(n).fill(0);

      // Backfill leading
      const first = validIdx[0]!;
      for (let i = 0; i < first; i++) out[i] = out[first]!;

      // Forward fill / interpolate gaps
      for (let k = 0; k < validIdx.length - 1; k++) {
        const a = validIdx[k]!;
        const b = validIdx[k + 1]!;
        const va = out[a]!;
        const vb = out[b]!;
        // Fill interior (a, b)
        const gap = b - a;
        for (let i = a + 1; i < b; i++) {
          if (Number.isFinite(out[i]!)) continue;
          // Linear interpolation across the gap
          const t = gap > 0 ? (i - a) / gap : 0;
          out[i] = va + (vb - va) * t;
        }
      }

      // Forward fill trailing
      const last = validIdx[validIdx.length - 1]!;
      for (let i = last + 1; i < n; i++) out[i] = out[last]!;

      // Any remaining NaNs (shouldn't happen) -> 0
      for (let i = 0; i < n; i++) if (!Number.isFinite(out[i]!)) out[i] = 0;
      return out;
    };

    const bid = fillOne(depthDataRaw.map((d) => d.bidDepth));
    const ask = fillOne(depthDataRaw.map((d) => d.askDepth));

    return depthDataRaw.map((d, i) => ({
      ...d,
      bidDepth: bid[i]!,
      askDepth: ask[i]!,
    }));
  })();

  // Calculate pegging/deviation data
  const peggingData: PeggingDataPoint[] = ohlcData.map((ohlc, i) => {
    const oracle = oracleData[i];
    const deviation = ((ohlc.close - oracle.price) / oracle.price) * 100;
    
    // Calculate SMA of deviation
    const windowSize = 5;
    const startIdx = Math.max(0, i - windowSize + 1);
    const deviations = ohlcData.slice(startIdx, i + 1).map((d, j) => {
      const o = oracleData[startIdx + j];
      return ((d.close - o.price) / o.price) * 100;
    });
    const smaDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;

    return {
      timestamp: ohlc.timestamp,
      twapPrice: ohlc.close, // Using close as proxy for TWAP
      oraclePrice: oracle.price,
      deviation,
      smaDeviation,
    };
  });

  // Convert LP positions to ranges
  const lpRanges = (lpPositionsData || []).map((position) => {
    const tickLower = Number(position.tickLower);
    const tickUpper = Number(position.tickUpper);
    
    return {
      // Use decimal-adjusted tick -> price for correct display scale.
      lower: tickToPrice(tickLower, token0Decimals, token1Decimals),
      upper: tickToPrice(tickUpper, token0Decimals, token1Decimals),
      owner: position.owner,
    };
  });

  const chartData: TradingChartData = {
    ohlcData,
    oracleData,
    depthData,
    peggingData,
  };

  const impactBandEvents: LPEventData[] = (() => {
    // v4: ModifyLiquidity (LPEvent) is the same source that drives TickLiquidity updates.
    if (isV4) return lpEventsData ?? [];

    const mints = v3PoolMintBurnData?.mints ?? [];
    const burns = v3PoolMintBurnData?.burns ?? [];

    // If we failed to fetch pool events (or there are none), fall back to LPEvent.
    if (mints.length === 0 && burns.length === 0) return lpEventsData ?? [];

    const out: LPEventData[] = [];

    for (const m of mints) {
      out.push({
        id: `poolMint-${m.id}`,
        // Use actual owner from event, fall back to "pool" if not available
        owner: m.owner?.toLowerCase() ?? "pool",
        eventType: "MINT",
        timestamp: Number(m.timestamp),
        liquidityDelta: String(m.amount),
        amount0: String(m.amount0),
        amount1: String(m.amount1),
        tickLower: String(m.tickLower),
        tickUpper: String(m.tickUpper),
      });
    }
    for (const b of burns) {
      // Pool Burn.amount is positive; convert to signed delta.
      out.push({
        id: `poolBurn-${b.id}`,
        // Use actual owner from event, fall back to "pool" if not available
        owner: b.owner?.toLowerCase() ?? "pool",
        eventType: "BURN",
        timestamp: Number(b.timestamp),
        liquidityDelta: (-BigInt(String(b.amount))).toString(),
        amount0: String(b.amount0),
        amount1: String(b.amount1),
        tickLower: String(b.tickLower),
        tickUpper: String(b.tickUpper),
      });
    }

    // Ensure ascending by timestamp (matches other query ordering and makes rollback filtering stable).
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  })();

  return {
    chartData,
    lpRanges,
    lpEvents: lpEventsData ?? [],
    impactBandEvents,
    v3Swaps: v3SwapsData ?? [],
    tickLiquidity: tickLiquidityData ?? [],
    positions: positionsData,
    ownerAggregates: ownerAggregatesData,
    meta: batchedMeta,
    precomputedImpactBand,
    precomputedDepthBand,
    isLoading,
    error,
  };
}

// =============================================================================
// NEW: Fetch ALL positions for a pool and group by ACTUAL wallet address
// This is the source of truth for LP concentration - bypasses OwnerPositionAggregate
// which may have incorrect owner data (tokenIds instead of wallet addresses)
// =============================================================================
/**
 * Fetch all positions for a pool, grouped by owner.
 * Exported so it can be reused in useQueries (e.g. birds-eye view).
 */
export async function fetchAllPoolPositions(
  poolAddressNorm: string,
  opts: {
    mode?: 'full' | 'birds-eye';
    maxPages?: number;
    solanaLookbackDays?: number;
    solanaPositionsPageLimit?: number;
    solanaPositionsMaxPages?: number;
  } = {}
): Promise<{ owner: string; positions: PositionData[]; liquidityTotal: bigint }[]> {
  const analyticsModel = getPoolAnalyticsProfile(poolAddressNorm).analyticsModel;
  const usesSolanaPoolData = analyticsModel === "raydium-clmm" || analyticsModel === "meteora-dlmm";
  const PAGE_SIZE = 1000;
  const mode = opts.mode ?? 'full';
  const maxPages =
    opts.maxPages ??
    (mode === 'birds-eye' ? 3 : Number.POSITIVE_INFINITY);
  const maxPagesCapped = Number.isFinite(maxPages)
    ? Math.max(1, Math.floor(maxPages))
    : Number.POSITIVE_INFINITY;
  const railwayMaxPages =
    opts.maxPages ?? (mode === 'birds-eye' ? 3 : 10);
  const solanaLookbackDays =
    opts.solanaLookbackDays ?? (mode === 'birds-eye' ? 7 : 30);
  const solanaPositionsPageLimit =
    opts.solanaPositionsPageLimit ?? (mode === 'birds-eye' ? 5000 : 5000);
  const solanaPositionsMaxPages =
    opts.solanaPositionsMaxPages ?? (mode === 'birds-eye' ? 5 : 10);
      // ── Raydium / Solana: fetch positions from pool-data API ──
      if (usesSolanaPoolData) {
        const now = Math.floor(Date.now() / 1000);
        const startTime = now - solanaLookbackDays * 24 * 3600;
        const params = new URLSearchParams({
          pool: poolAddressNorm,
          startTime: String(startTime),
          endTime: String(now),
          include: 'positions',
          positionsPageLimit: String(solanaPositionsPageLimit),
          positionsMaxPages: String(solanaPositionsMaxPages),
        });
        const url = `/api/pool-data?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const data = await res.json();
        const rawPositions: Array<{
          id: string; tokenId?: string; pool: string; owner: string;
          tickLower: number; tickUpper: number; liquidity: string; updatedAt?: number;
        }> = data.positions ?? [];

        const positions: PositionData[] = rawPositions.map((p) => ({
          id: p.id,
          tokenId: p.tokenId ?? p.id,
          pool: poolAddressNorm,
          owner: p.owner,
          tickLower: Number(p.tickLower),
          tickUpper: Number(p.tickUpper),
          liquidity: p.liquidity,
          updatedAt: p.updatedAt ?? 0,
          fee: null,
          token0: null,
          token1: null,
        }));

        // Group by owner
        const byOwner = new Map<string, { positions: PositionData[]; liquidityTotal: bigint }>();
        for (const pos of positions) {
          const owner = pos.owner;
          if (!owner) continue;
          const liq = BigInt(pos.liquidity);
          const existing = byOwner.get(owner);
          if (existing) {
            existing.positions.push(pos);
            existing.liquidityTotal += liq;
          } else {
            byOwner.set(owner, { positions: [pos], liquidityTotal: liq });
          }
        }

        const sorted = [...byOwner.entries()]
          .map(([owner, d]) => ({
            owner,
            positions: d.positions.sort((a, b) => {
              const la = BigInt(a.liquidity);
              const lb = BigInt(b.liquidity);
              return la > lb ? -1 : la < lb ? 1 : 0;
            }),
            liquidityTotal: d.liquidityTotal,
          }))
          .sort((a, b) => (a.liquidityTotal > b.liquidityTotal ? -1 : a.liquidityTotal < b.liquidityTotal ? 1 : 0));

        return sorted;
      }

      // ── Worldchain indexer pools ──
      // Fetch Position (with active=true for tick-range detail) and
      // OwnerPositionAggregate (authoritative LP list) in parallel,
      // then merge so every active owner appears even if their
      // individual Position rows are missing.
      if (isWorldchainIndexerPool(poolAddressNorm)) {
        const [positions, opaRows] = await Promise.all([
          fetchWorldchainPositions(poolAddressNorm),
          fetchWorldchainOwnerAggregates(poolAddressNorm, railwayMaxPages),
        ]);

        // Group positions by owner
        const posByOwner = new Map<string, PositionData[]>();
        for (const pos of positions) {
          const ownerLc = pos.owner.toLowerCase();
          const arr = posByOwner.get(ownerLc);
          if (arr) arr.push(pos);
          else posByOwner.set(ownerLc, [pos]);
        }

        // Build merged result: OPA is the authority for the owner list,
        // Position entity supplies tick-range detail where available.
        const byOwner = new Map<string, { positions: PositionData[]; liquidityTotal: bigint }>();
        for (const row of opaRows) {
          const liq = BigInt(row.liquidityTotal);
          if (liq <= 0n) continue;
          const ownerLc = row.owner.toLowerCase();
          byOwner.set(ownerLc, {
            positions: posByOwner.get(ownerLc) ?? [],
            liquidityTotal: liq,
          });
        }

        // Include any Position-only owners not in OPA (rare edge case)
        for (const [ownerLc, ownerPositions] of posByOwner) {
          if (byOwner.has(ownerLc)) continue;
          const liq = ownerPositions.reduce((s, p) => s + BigInt(p.liquidity), 0n);
          if (liq > 0n) {
            byOwner.set(ownerLc, { positions: ownerPositions, liquidityTotal: liq });
          }
        }

        const sorted = [...byOwner.entries()]
          .map(([owner, data]) => ({
            owner,
            positions: data.positions.sort((a, b) => {
              const la = BigInt(a.liquidity);
              const lb = BigInt(b.liquidity);
              return la > lb ? -1 : la < lb ? 1 : 0;
            }),
            liquidityTotal: data.liquidityTotal,
          }))
          .sort((a, b) => (a.liquidityTotal > b.liquidityTotal ? -1 : a.liquidityTotal < b.liquidityTotal ? 1 : 0));

        return sorted;
      }

      // ── EVM pools ──
      const isV4 = isV4PoolKey(poolAddressNorm);

      // Fetch ALL positions for the pool (no owner filter)
      const allPositions: PositionData[] = [];
      let offset = 0;
      let hasMore = true;
      let pageCount = 0;

      if (isV4) {
        // V4: Use LPPosition table
        while (hasMore && pageCount < maxPagesCapped) {
          const response = await envioClient.request<{
            lppositions: Array<{
              id: string;
              owner: string;
              pool: string;
              tickLower: number;
              tickUpper: number;
              liquidity: string;
              updatedAt: number;
            }>;
          }>(
            `
              query AllPoolLPPositions($pool: String!, $limit: Int!, $offset: Int!) {
                lppositions(
                  where: { pool: $pool, liquidity_gt: "0" }
                  orderBy: liquidity
                  orderDirection: desc
                  first: $limit
                  skip: $offset
                ) {
                  id
                  owner
                  pool
                  tickLower
                  tickUpper
                  liquidity
                  updatedAt
                }
              }
            `,
            { pool: poolAddressNorm, limit: PAGE_SIZE, offset }
          );

          const rows = response.lppositions ?? [];
          for (const r of rows) {
            allPositions.push({
              id: r.id,
              tokenId: r.id,
              pool: poolAddressNorm,
              owner: r.owner.toLowerCase(),
              tickLower: Number(r.tickLower),
              tickUpper: Number(r.tickUpper),
              liquidity: r.liquidity,
              updatedAt: r.updatedAt,
              fee: null,
              token0: null,
              token1: null,
            });
          }

          hasMore = rows.length === PAGE_SIZE;
          offset += PAGE_SIZE;
          pageCount++;
        }
      } else {
        // V3: Use Position table
        while (hasMore && pageCount < maxPagesCapped) {
          const response = await envioClient.request<{ positions: PositionData[] }>(
            `
              ${POSITION_FRAGMENT}
              query AllPoolPositions($pool: String!, $limit: Int!, $offset: Int!) {
                positions(
                  where: { pool: $pool, liquidity_gt: "0" }
                  orderBy: liquidity
                  orderDirection: desc
                  first: $limit
                  skip: $offset
                ) {
                  ...PositionFields
                }
              }
            `,
            { pool: poolAddressNorm, limit: PAGE_SIZE, offset }
          );

          const positions = response.positions ?? [];
          allPositions.push(...positions);

          hasMore = positions.length === PAGE_SIZE;
          offset += PAGE_SIZE;
          pageCount++;
        }
      }

      // Group by ACTUAL wallet address (Position.owner)
      const byOwner = new Map<string, { positions: PositionData[]; liquidityTotal: bigint }>();
      
      for (const pos of allPositions) {
        const ownerLc = pos.owner.toLowerCase();
        const existing = byOwner.get(ownerLc);
        const liq = BigInt(pos.liquidity);
        
        if (existing) {
          existing.positions.push(pos);
          existing.liquidityTotal += liq;
        } else {
          byOwner.set(ownerLc, {
            positions: [pos],
            liquidityTotal: liq,
          });
        }
      }

      // Sort by total liquidity descending
      const sorted = [...byOwner.entries()]
        .map(([owner, data]) => ({
          owner,
          positions: data.positions.sort((a, b) => {
            const la = BigInt(a.liquidity);
            const lb = BigInt(b.liquidity);
            return la > lb ? -1 : la < lb ? 1 : 0;
          }),
          liquidityTotal: data.liquidityTotal,
        }))
        .sort((a, b) => {
          return a.liquidityTotal > b.liquidityTotal ? -1 : a.liquidityTotal < b.liquidityTotal ? 1 : 0;
        });

      return sorted;
}

export function useAllPoolPositions(
  poolAddress: string = DEFAULT_POOL_KEY,
  enabled: boolean = true
) {
  const poolAddressNorm = normalizePoolKey(poolAddress);

  return useQuery<{ owner: string; positions: PositionData[]; liquidityTotal: bigint }[], Error>({
    queryKey: ['allPoolPositions', poolAddressNorm],
    queryFn: () => fetchAllPoolPositions(poolAddressNorm),
    enabled: enabled && !!poolAddressNorm,
    staleTime: 60_000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// =============================================================================
// Helper hook to get current LP owners (aggregated) for display
// OPTIMIZED: Uses aliased queries to fetch all pages in 2 requests instead of N
// Step 1: Get count (1 request)
// Step 2: Fetch all pages with aliases (1 request)
// NOTE: This may have incorrect owner data - prefer useAllPoolPositions for LP concentration
// =============================================================================
export function useAllLPPositions(
  poolAddress: string = DEFAULT_POOL_KEY,
  enabled: boolean = true
) {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const analyticsModel = getPoolAnalyticsProfile(poolAddressNorm).analyticsModel;
  const usesSolanaPoolData = analyticsModel === "raydium-clmm" || analyticsModel === "meteora-dlmm";
  const PAGE_SIZE = 1000; // Hasura's hard limit

  return useQuery<OwnerPositionAggregateData[], Error>({
    queryKey: ['topLpOwners', poolAddressNorm],
    queryFn: async () => {
      if (analyticsModel === "meteora-dlmm") {
        const res = await fetch(`/api/lp/summary?pool=${encodeURIComponent(poolAddressNorm)}&limit=200`);
        if (!res.ok) throw new Error(`lp/summary fetch failed: ${res.status}`);
        const payload = await res.json() as {
          data?: Array<{
            wallet?: string;
            active_positions?: number | string | null;
            updated_at?: string | null;
          }>;
        };
        return (payload.data ?? [])
          .filter((row) => row.wallet)
          .map((row) => ({
            id: `meteora-summary-${poolAddressNorm}-${row.wallet}`,
            pool: poolAddressNorm,
            owner: row.wallet!,
            // Use active position count as the sortable summary metric until
            // backend owner value fields are available.
            liquidityTotal: String(Number(row.active_positions ?? 0)),
            updatedAt: row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : 0,
          }))
          .sort((a, b) => Number(b.liquidityTotal) - Number(a.liquidityTotal));
      }

      // ── Raydium / Solana: aggregate positions from pool-data API ──
      if (usesSolanaPoolData) {
        const now = Math.floor(Date.now() / 1000);
        const roundedNow = Math.floor(now / 3600) * 3600;
        const startTime = roundedNow - 30 * 24 * 3600;
        const url = `/api/pool-data?pool=${encodeURIComponent(poolAddressNorm)}&startTime=${startTime}&endTime=${roundedNow}&include=positions&positionsPageLimit=5000&positionsMaxPages=10`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const data = await res.json();
        const positions: Array<{ owner: string; liquidity: string; updatedAt?: number }> = data.positions ?? [];

        // Aggregate by owner
        const byOwner = new Map<string, OwnerPositionAggregateData>();
        for (const pos of positions) {
          const owner = pos.owner;
          if (!owner) continue;
          const existing = byOwner.get(owner);
          if (!existing) {
            byOwner.set(owner, {
              id: `raydium-${poolAddressNorm}-${owner}`,
              pool: poolAddressNorm,
              owner,
              liquidityTotal: pos.liquidity,
              updatedAt: pos.updatedAt ?? 0,
            });
          } else {
            try {
              existing.liquidityTotal = (BigInt(existing.liquidityTotal) + BigInt(pos.liquidity)).toString();
            } catch {
              // skip malformed liquidity values
            }
            existing.updatedAt = Math.max(existing.updatedAt, pos.updatedAt ?? 0);
          }
        }

        return [...byOwner.values()].sort((a, b) => {
          const la = BigInt(a.liquidityTotal);
          const lb = BigInt(b.liquidityTotal);
          return la > lb ? -1 : la < lb ? 1 : 0;
        });
      }

      // ── Worldchain indexer pools ──
      // Use OwnerPositionAggregate with active=true to get only non-zero
      // liquidity owners directly from the API.
      if (isWorldchainIndexerPool(poolAddressNorm)) {
        const rows = await fetchWorldchainOwnerAggregates(poolAddressNorm);

        const result: OwnerPositionAggregateData[] = rows.map((r) => ({
          id: r.id,
          pool: poolAddressNorm,
          owner: r.owner.toLowerCase(),
          liquidityTotal: r.liquidityTotal,
          updatedAt: r.updatedAt,
        }));

        result.sort((a, b) => {
          const la = BigInt(a.liquidityTotal);
          const lb = BigInt(b.liquidityTotal);
          return la > lb ? -1 : la < lb ? 1 : 0;
        });

        return result;
      }

      // ── EVM: existing Envio GraphQL logic ──

      // Step 1: Get count - The Graph doesn't support _aggregate, so we estimate or skip
      // For The Graph, we'll use sequential pagination as aliased batching with skip
      const totalCount = 0;
      // Skip count query for The Graph - go straight to pagination

      // If count succeeded and we have data, use aliased batching
      if (totalCount > 0) {
        const pageCount = Math.ceil(totalCount / PAGE_SIZE);
        
        // Step 2: Build aliased query for all pages (1 request)
        const aliasedQueries = Array.from({ length: pageCount }, (_, i) => `
          page${i}: ownerPositionAggregates(
            where: { pool: "${poolAddressNorm}", liquidityTotal_gt: "0" }
            orderBy: liquidityTotal
            orderDirection: desc
            first: ${PAGE_SIZE}
            skip: ${i * PAGE_SIZE}
          ) {
            id
            pool
            owner
            liquidityTotal
            updatedAt
          }
        `).join('\n');

        const batchedQuery = `query AllLPPages { ${aliasedQueries} }`;
        
        try {
          const response = await envioClient.request<Record<string, OwnerPositionAggregateData[]>>(batchedQuery);
          
          // Flatten all pages
          const allAggregates: OwnerPositionAggregateData[] = [];
          for (let i = 0; i < pageCount; i++) {
            const pageData = response[`page${i}`] ?? [];
            allAggregates.push(...pageData);
          }
          
          if (allAggregates.length > 0) {
            return allAggregates;
          }
        } catch {
          // Fall back to sequential pagination when aliased batching is unsupported.
        }
      }

      // Fallback: Sequential pagination (for older schemas or when aliased fails)
      const allAggregates: OwnerPositionAggregateData[] = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const response = await envioClient.request<{ ownerPositionAggregates: OwnerPositionAggregateData[] }>(
          GET_OWNER_POSITION_AGGREGATES_QUERY,
          {
            pool: poolAddressNorm,
            limit: PAGE_SIZE,
            offset,
          }
        );
        const aggregates = response.ownerPositionAggregates ?? [];
        allAggregates.push(...aggregates);
        
        if (aggregates.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }
      }
      
      if (allAggregates.length > 0) return allAggregates;

      // Legacy fallback for LPPosition table
      const allLegacyRows: Array<{
        id: string;
        owner: string;
        pool: string;
        liquidity: string;
        updatedAt: number;
      }> = [];
      offset = 0;
      hasMore = true;
      
      while (hasMore) {
        const legacyResponse = await envioClient.request<{
          lppositions: Array<{
            id: string;
            owner: string;
            pool: string;
            liquidity: string;
            updatedAt: number;
          }>;
        }>(
          `
            query LegacyLPPositions($pool: String!, $limit: Int!, $offset: Int!) {
              lppositions(
                where: { pool: $pool, liquidity_gt: "0" }
                orderBy: liquidity
                orderDirection: desc
                first: $limit
                skip: $offset
              ) {
                id
                owner
                pool
                liquidity
                updatedAt
              }
            }
          `,
          { pool: poolAddressNorm, limit: PAGE_SIZE, offset }
        );

        const rows = legacyResponse.lppositions ?? [];
        allLegacyRows.push(...rows);
        
        if (rows.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }
      }

      if (allLegacyRows.length === 0) return [];

      const byOwner = new Map<string, OwnerPositionAggregateData>();

      for (const row of allLegacyRows) {
        const ownerLc = row.owner.toLowerCase();
        const existing = byOwner.get(ownerLc);
        if (!existing) {
          byOwner.set(ownerLc, {
            id: `legacy-${poolAddressNorm}-${ownerLc}`,
            pool: poolAddressNorm,
            owner: ownerLc,
            liquidityTotal: row.liquidity,
            updatedAt: row.updatedAt,
          });
          continue;
        }

        existing.liquidityTotal = (BigInt(existing.liquidityTotal) + BigInt(row.liquidity)).toString();
        existing.updatedAt = Math.max(existing.updatedAt, row.updatedAt);
      }

      return [...byOwner.values()].sort((a, b) => {
        const la = BigInt(a.liquidityTotal);
        const lb = BigInt(b.liquidityTotal);
        return la > lb ? -1 : la < lb ? 1 : 0;
      });
    },
    enabled: enabled && !!poolAddressNorm,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function usePositionsByOwner(args: {
  poolAddress?: string;
  owner?: string | null;
  limit?: number;
  enabled?: boolean;
}) {
  const {
    poolAddress = DEFAULT_POOL_KEY,
    owner,
    limit = 5000,
    enabled = true,
  } = args;

  const poolAddressNorm = normalizePoolKey(poolAddress);
  const analyticsModel = getPoolAnalyticsProfile(poolAddressNorm).analyticsModel;
  const usesSolanaPoolData = analyticsModel === "raydium-clmm" || analyticsModel === "meteora-dlmm";
  // Solana owners are base58 (case-sensitive); only lowercase EVM addresses
  const ownerNorm = usesSolanaPoolData ? owner?.trim() : owner?.toLowerCase();

  return useQuery<PositionData[], Error>({
    queryKey: ['positionsByOwner', poolAddressNorm, ownerNorm, limit],
    queryFn: async () => {
      if (!ownerNorm) return [];

      // ── Raydium / Solana: fetch from pool-data API and filter by owner ──
      if (usesSolanaPoolData) {
        const now = Math.floor(Date.now() / 1000);
        const roundedNow = Math.floor(now / 3600) * 3600;
        const startTime = roundedNow - 30 * 24 * 3600;
        const url = `/api/pool-data?pool=${encodeURIComponent(poolAddressNorm)}&startTime=${startTime}&endTime=${roundedNow}&include=positions&positionsPageLimit=5000&positionsMaxPages=10`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const data = await res.json();
        const rawPositions: Array<{
          id: string; tokenId?: string; pool: string; owner: string;
          tickLower: number; tickUpper: number; liquidity: string; updatedAt?: number;
        }> = data.positions ?? [];

        return rawPositions
          .filter((p) => p.owner === ownerNorm)
          .map((p) => ({
            id: p.id,
            tokenId: p.tokenId ?? p.id,
            pool: poolAddressNorm,
            owner: p.owner,
            tickLower: Number(p.tickLower),
            tickUpper: Number(p.tickUpper),
            liquidity: p.liquidity,
            updatedAt: p.updatedAt ?? 0,
            fee: null,
            token0: null,
            token1: null,
          }))
          .slice(0, limit);
      }

      // ── Worldchain indexer pools ──
      if (isWorldchainIndexerPool(poolAddressNorm)) {
        const positions = await fetchWorldchainPositionsByOwner(poolAddressNorm, ownerNorm, limit);
        return positions
          .slice(0, limit);
      }

      // ── EVM pools ──
      const ownerLc = ownerNorm; // already lowercased for EVM
      // Page size for fetching (Hasura may have a hard limit around 1000)
      const PAGE_SIZE = 1000;


      // v4: Position(tokenId) is v3-only; use LPPosition rows instead.
      if (isV4PoolKey(poolAddressNorm)) {
        const allRows: PositionData[] = [];
        let offset = 0;
        let hasMore = true;
        
        while (hasMore && allRows.length < limit) {
          const response = await envioClient.request<{
            lppositions: Array<{
              id: string;
              owner: string;
              pool: string;
              tickLower: number;
              tickUpper: number;
              liquidity: string;
              updatedAt: number;
            }>;
          }>(
            `
              query LPPositionsByOwner($owner: String!, $pool: String!, $limit: Int!, $offset: Int!) {
                lppositions(
                  where: { owner: $owner, pool: $pool, liquidity_gt: "0" }
                  orderBy: liquidity
                  orderDirection: desc
                  first: $limit
                  skip: $offset
                ) {
                  id
                  owner
                  pool
                  tickLower
                  tickUpper
                  liquidity
                  updatedAt
                }
              }
            `,
            { owner: ownerLc, pool: poolAddressNorm, limit: PAGE_SIZE, offset }
          );

          const rows = response.lppositions ?? [];
          const mapped = rows.map((r) => ({
            id: r.id,
            tokenId: r.id, // synthetic
            pool: poolAddressNorm,
            owner: r.owner.toLowerCase(),
            tickLower: Number(r.tickLower),
            tickUpper: Number(r.tickUpper),
            liquidity: r.liquidity,
            updatedAt: r.updatedAt,
            fee: null,
            token0: null,
            token1: null,
          }));
          
          allRows.push(...mapped);
          offset += PAGE_SIZE;
          hasMore = rows.length === PAGE_SIZE;
        }
        
        return allRows.slice(0, limit);
      }

      // V3: Use pagination with skip
      const allPositions: PositionData[] = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore && allPositions.length < limit) {
        const response = await envioClient.request<{ positions: PositionData[] }>(
          `
            ${POSITION_FRAGMENT}
            query GetPositionsByOwnerPaged($owner: String!, $pool: String!, $limit: Int!, $offset: Int!) {
              positions(
                where: {
                  owner: $owner
                  pool: $pool
                  liquidity_gt: "0"
                }
                orderBy: liquidity
                orderDirection: desc
                first: $limit
                skip: $offset
              ) {
                ...PositionFields
              }
            }
          `,
          {
            owner: ownerLc,
            pool: poolAddressNorm,
            limit: PAGE_SIZE,
            offset,
          }
        );
        
        const positions = response.positions ?? [];
        allPositions.push(...positions);
        offset += PAGE_SIZE;
        hasMore = positions.length === PAGE_SIZE;
      }
      
      return allPositions.slice(0, limit);
    },
    enabled: enabled && !!ownerNorm,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });
}

// Helper hook to get tick liquidity for liquidity distribution chart
// Fetches ticks within ±8000 of current tick (~120% price range in each direction)
export function useTickLiquidity(
  poolAddress: string = DEFAULT_POOL_KEY,
  currentTick?: number,
  enabled: boolean = true
) {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const analyticsModel = getPoolAnalyticsProfile(poolAddressNorm).analyticsModel;
  const isSolana = isSolanaPool(poolAddressNorm);
  const isMeteora = analyticsModel === "meteora-dlmm";
  // Use stable tick boundaries (round to 1000) for better cache hits
  const roundedTick = currentTick ? Math.round(currentTick / 1000) * 1000 : undefined;

  return useQuery<TickLiquidityData[], Error>({
    queryKey: ['tickLiquidity', poolAddressNorm, roundedTick],
    queryFn: async () => {
      if (!currentTick || isSolana || isMeteora) return [];

      // Query ticks within ±8000 of current price (~120% price range)
      const minTick = Math.floor(currentTick - 8000);
      const maxTick = Math.floor(currentTick + 8000);

      if (isWorldchainIndexerPool(poolAddressNorm)) {
        const rows = await fetchWorldchainTickLiquidity(poolAddressNorm);
        return rows.filter((row) => row.tick >= minTick && row.tick <= maxTick);
      }

      const response = await envioClient.request<{ tickLiquidities: TickLiquidityData[] }>(GET_TICK_LIQUIDITY_QUERY, {
        pool: poolAddressNorm,
        minTick,
        maxTick,
      });
      return response.tickLiquidities;
    },
    enabled: enabled && !!currentTick && !isSolana && !isMeteora,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Helper hook to get ALL tick liquidity for price impact calculations
// Fetches the full range to calculate accurate price impact at all depths
export function useTickLiquidityFullRange(
  poolAddress: string = DEFAULT_POOL_KEY,
  enabled: boolean = true
) {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const analyticsModel = getPoolAnalyticsProfile(poolAddressNorm).analyticsModel;
  const isSolana = isSolanaPool(poolAddressNorm);
  const isMeteora = analyticsModel === "meteora-dlmm";
  const useWorldchainIndexer = isWorldchainIndexerPool(poolAddressNorm);
  return useQuery<TickLiquidityData[], Error>({
    queryKey: ['tickLiquidityFullRange', poolAddressNorm],
    queryFn: async () => {
      if (isSolana || isMeteora) return [];
      if (useWorldchainIndexer) {
        return fetchWorldchainTickLiquidity(poolAddressNorm);
      }
      const response = await envioClient.request<{ tickLiquidities: TickLiquidityData[] }>(GET_ALL_TICK_LIQUIDITY_QUERY, {
        pool: poolAddressNorm,
      });
      return response.tickLiquidities;
    },
    enabled: enabled && !!poolAddressNorm && !isSolana && !isMeteora,
    staleTime: 10 * 60 * 1000, // 10 minutes (larger dataset, cache longer)
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Hook to fetch positions for multiple owners (for LP concentration treemap)
export function usePositionsForOwners(args: {
  poolAddress?: string;
  owners: string[];
  limit?: number;
  enabled?: boolean;
}) {
  type PositionsForOwnerResult = { owner: string; positions: PositionData[] };
  const {
    poolAddress = DEFAULT_POOL_KEY,
    owners,
    limit = 5000,
    enabled = true,
  } = args;

  const poolAddressNorm = normalizePoolKey(poolAddress);
  const analyticsModel = getPoolAnalyticsProfile(poolAddressNorm).analyticsModel;
  const usesSolanaPoolData = analyticsModel === "raydium-clmm" || analyticsModel === "meteora-dlmm";
  const PAGE_SIZE = 1000; // Hasura may have a hard limit around 1000

  const queries = useQueries({
    queries: owners.map((owner) => ({
      // IMPORTANT: use a distinct key from usePositionsByOwner().
      // usePositionsByOwner caches PositionData[] under ['positionsByOwner', ...].
      // This hook returns a different shape ({ owner, positions }), so sharing the same
      // key can cause runtime type confusion (e.g. cached arrays reused here).
      queryKey: ['positionsByOwnerForOwners', poolAddressNorm, usesSolanaPoolData ? owner.trim() : owner.toLowerCase(), limit],
      queryFn: async (): Promise<PositionsForOwnerResult> => {
        const ownerNorm = usesSolanaPoolData ? owner.trim() : owner.toLowerCase();

        if (usesSolanaPoolData) {
          const now = Math.floor(Date.now() / 1000);
          const roundedNow = Math.floor(now / 3600) * 3600;
          const startTime = roundedNow - 30 * 24 * 3600;
          const url = `/api/pool-data?pool=${encodeURIComponent(poolAddressNorm)}&startTime=${startTime}&endTime=${roundedNow}&include=positions&positionsPageLimit=5000&positionsMaxPages=10`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
          const data = await res.json();
          const rawPositions: Array<{
            id: string; tokenId?: string; pool: string; owner: string;
            tickLower: number; tickUpper: number; liquidity: string; updatedAt?: number;
          }> = data.positions ?? [];

          const positions = rawPositions
            .filter((p) => p.owner === ownerNorm)
            .map((p) => ({
              id: p.id,
              tokenId: p.tokenId ?? p.id,
              pool: poolAddressNorm,
              owner: p.owner,
              tickLower: Number(p.tickLower),
              tickUpper: Number(p.tickUpper),
              liquidity: p.liquidity,
              updatedAt: p.updatedAt ?? 0,
              fee: null,
              token0: null,
              token1: null,
            }))
            .slice(0, limit);

          return { owner, positions };
        }

        if (isWorldchainIndexerPool(poolAddressNorm)) {
          const positions = await fetchWorldchainPositionsByOwner(poolAddressNorm, ownerNorm, limit);
          return { owner, positions };
        }
        
        // v4: Position(tokenId) is v3-only; use LPPosition rows instead.
        if (isV4PoolKey(poolAddressNorm)) {
          const allRows: PositionData[] = [];
          let offset = 0;
          let hasMore = true;
          
          while (hasMore && allRows.length < limit) {
            const response = await envioClient.request<{
              lppositions: Array<{
                id: string;
                owner: string;
                pool: string;
                tickLower: number;
                tickUpper: number;
                liquidity: string;
                updatedAt: number;
              }>;
            }>(
              `
                query LPPositionsByOwnerForOwners($owner: String!, $pool: String!, $limit: Int!, $offset: Int!) {
                  lppositions(
                    where: { owner: $owner, pool: $pool, liquidity_gt: "0" }
                    orderBy: liquidity
                    orderDirection: desc
                    first: $limit
                    skip: $offset
                  ) {
                    id
                    owner
                    pool
                    tickLower
                    tickUpper
                    liquidity
                    updatedAt
                  }
                }
              `,
              { owner: ownerNorm, pool: poolAddressNorm, limit: PAGE_SIZE, offset }
            );

            const rows = response.lppositions ?? [];
            const mapped: PositionData[] = rows.map((r) => ({
              id: r.id,
              tokenId: r.id,
              pool: poolAddressNorm,
              owner: r.owner.toLowerCase(),
              tickLower: Number(r.tickLower),
              tickUpper: Number(r.tickUpper),
              liquidity: r.liquidity,
              updatedAt: r.updatedAt,
              fee: null,
              token0: null,
              token1: null,
            }));
            
            allRows.push(...mapped);
            offset += PAGE_SIZE;
            hasMore = rows.length === PAGE_SIZE;
          }

          return { owner, positions: allRows.slice(0, limit) };
        }

        // V3: Use pagination with skip
        const allPositions: PositionData[] = [];
        let offset = 0;
        let hasMore = true;
        
        while (hasMore && allPositions.length < limit) {
          const response = await envioClient.request<{ positions: PositionData[] }>(
            `
              ${POSITION_FRAGMENT}
              query GetPositionsByOwnerForOwnersPaged($owner: String!, $pool: String!, $limit: Int!, $offset: Int!) {
                positions(
                  where: {
                    owner: $owner
                    pool: $pool
                    liquidity_gt: "0"
                  }
                  orderBy: liquidity
                  orderDirection: desc
                  first: $limit
                  skip: $offset
                ) {
                  ...PositionFields
                }
              }
            `,
            {
              owner: ownerNorm,
              pool: poolAddressNorm,
              limit: PAGE_SIZE,
              offset,
            }
          );
          
          const positions = response.positions ?? [];
          allPositions.push(...positions);
          offset += PAGE_SIZE;
          hasMore = positions.length === PAGE_SIZE;
        }
        
        return { owner, positions: allPositions.slice(0, limit) };
      },
      enabled: enabled && owners.length > 0,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      placeholderData: (previousData) => previousData,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  
  // Extract just the data from queries - this creates a stable reference when data hasn't changed
  const queryData = queries.map((q) => q.data);
  
  // Memoize the data to prevent unnecessary re-renders
  // Use JSON.stringify of owners as a stable dependency (since queryData array ref changes)
  const data = useMemo(() => {
    return queries
      .filter((q) => q.data)
      .map((q) => q.data as PositionsForOwnerResult)
      // Sort owners by total liquidity (desc) so callers get biggest -> smallest.
      .sort((a, b) => {
        const sumLiq = (items: PositionData[]) =>
          items.reduce((acc, p) => acc + BigInt(p.liquidity), BigInt(0));
        const la = sumLiq(a.positions);
        const lb = sumLiq(b.positions);
        return la > lb ? -1 : la < lb ? 1 : 0;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryData.filter(Boolean).length, isLoading]);

  return { data, isLoading };
}
