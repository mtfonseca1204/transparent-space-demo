import { useQuery } from "@tanstack/react-query";
import {
  envioClient,
  GET_POOL_HOUR_DATA_QUERY,
  sqrtPriceX96ToPrice,
  priceToTick,
  type PoolHourData,
  type PositionData,
  type LPEventData,
} from "@/lib/envio-client";
import { DEFAULT_POOL_KEY, isMeteoraPool, isSolanaPool, normalizePoolKey } from "@/lib/pools";
import type { ChartTimeRange, LiquidityPricingMode } from "@/stores/chart-settings-store";
import {
  buildRangeMapFromPositions,
  applyRollbackToRangeMap,
  getLiquidityAtTickFromRangeMap,
  simulateImpactPricesFromRangeMap,
  getSqrtRatioAtTick,
  type RangeMap,
} from "@/lib/depth-calculator";
import { isWorldchainIndexerPool } from "@/lib/worldchain-indexer-client";

// Time range presets in seconds
const TIME_RANGES: Record<ChartTimeRange, number> = {
  "1h": 3600,
  "4h": 14400,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
  "2w": 1209600,
  "1m": 2592000,
  "3m": 7776000,
  "1y": 31536000,
};

// Stable time boundary helper - rounds to hour for better cache hits
const getStableStartTime = (timeRange: ChartTimeRange): number => {
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600; // Round to hour
  return roundedNow - TIME_RANGES[timeRange];
};

export interface SlippageDataPoint {
  timestamp: Date;
  buySlippagePct: number;
  sellSlippagePct: number;
  liquidity: string;
  price: number;
}

interface UseHistoricalSlippageOptions {
  poolAddress?: string;
  timeRange?: ChartTimeRange;
  /** Explicit lookback in days. When set, overrides `timeRange` — lets callers
   *  offer ranges (e.g. 60/120D) that aren't `ChartTimeRange` presets. */
  lookbackDays?: number;
  orderSizeUsd: number;
  token0Decimals?: number;
  token1Decimals?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  enabled?: boolean;
  // Position-based rollback calculation
  allPositions?: PositionData[] | null;
  lpEvents?: LPEventData[] | null;
  // Loading states - if true, we wait instead of using fallback
  positionsLoading?: boolean;
  eventsLoading?: boolean;
  // Liquidity pricing mode (for consistency with other charts)
  liquidityPricingMode?: LiquidityPricingMode;
}

interface UseHistoricalSlippageResult {
  data: SlippageDataPoint[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Calculate slippage using the well-tested swap simulation from depth-calculator.
 * Delegates to simulateImpactPricesFromRangeMap which properly handles zero-liquidity gaps.
 *
 * Note: liquidityPricingMode affects how we convert USD to token amounts:
 * - "current-price": Use oracle prices (token0UsdPrice, token1UsdPrice)
 * - "tick-price": Use the tick's implied price for conversion
 */
export function calculateSlippageFromRangeMap(
  orderSizeUsd: number,
  rangeMap: RangeMap,
  currentTick: number,
  sqrtPriceX96: string,
  token0Decimals: number,
  token1Decimals: number,
  token0UsdPrice: number | null,
  token1UsdPrice: number | null,
  liquidityPricingMode: LiquidityPricingMode = "current-price"
): { buyPct: number; sellPct: number } {
  try {
    const currentSqrtP = BigInt(sqrtPriceX96 || "0");
    if (currentSqrtP <= 0n) return { buyPct: 0, sellPct: 0 };

    const currentPrice = sqrtPriceX96ToPrice(currentSqrtP, token0Decimals, token1Decimals);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return { buyPct: 0, sellPct: 0 };

    // Derive USD prices based on pricing mode
    let t0Usd: number | null;
    let t1Usd: number | null;

    if (liquidityPricingMode === "tick-price") {
      t1Usd = token1UsdPrice ?? 1;
      t0Usd = currentPrice * t1Usd;
    } else {
      t0Usd = token0UsdPrice;
      t1Usd = token1UsdPrice;
    }

    const { buyPrice, sellPrice } = simulateImpactPricesFromRangeMap({
      rangeMap,
      currentTick,
      sqrtPriceX96,
      token0Decimals,
      token1Decimals,
      currentPrice,
      orderUsd: orderSizeUsd,
      token0UsdPrice: t0Usd,
      token1UsdPrice: t1Usd,
    });

    if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) {
      return { buyPct: 0, sellPct: 0 };
    }

    const buyPct = ((buyPrice / currentPrice) - 1) * 100;
    const sellPct = Math.abs(((sellPrice / currentPrice) - 1) * 100);

    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

    return {
      buyPct: Number.isFinite(buyPct) ? clamp(buyPct, 0, 100) : 0,
      sellPct: Number.isFinite(sellPct) ? clamp(sellPct, 0, 100) : 0,
    };
  } catch {
    return { buyPct: 0, sellPct: 0 };
  }
}

export function useHistoricalSlippage({
  poolAddress = DEFAULT_POOL_KEY,
  timeRange = "1w",
  lookbackDays,
  orderSizeUsd,
  token0Decimals = 18,
  token1Decimals = 18,
  token0UsdPrice = null,
  token1UsdPrice = null,
  enabled = true,
  allPositions,
  lpEvents,
  positionsLoading = false,
  eventsLoading = false,
  liquidityPricingMode = "current-price",
}: UseHistoricalSlippageOptions): UseHistoricalSlippageResult {
  const poolAddressLc = normalizePoolKey(poolAddress);
  const isMeteora = isMeteoraPool(poolAddressLc);

  // Use stable time boundaries for better cache hits. An explicit `lookbackDays`
  // overrides the `timeRange` preset (so callers can offer 60/120D etc.).
  const endTime = Math.floor(Date.now() / 3600_000) * 3600;
  const startTime =
    typeof lookbackDays === "number" && Number.isFinite(lookbackDays) && lookbackDays > 0
      ? endTime - Math.round(lookbackDays) * 86400
      : getStableStartTime(timeRange);

  // Check if we have positions (required) and optionally events for rollback
  const hasPositions = allPositions && allPositions.length > 0;
  const hasEvents = lpEvents && lpEvents.length > 0;

  // If positions/events are still loading, we should wait rather than use fallback
  const waitingForPositionData = positionsLoading || eventsLoading;

  // Stable query key - exclude frequently changing values like exact position/event counts
  // Use a hash of the data availability instead
  const positionDataReady = hasPositions ? (hasEvents ? "ready-with-events" : "ready-no-events") : "pending";

  const { data, isLoading, error } = useQuery({
    queryKey: ["historicalSlippage", poolAddressLc, timeRange, startTime, endTime, orderSizeUsd, token0UsdPrice, token1UsdPrice, positionDataReady, liquidityPricingMode],
    queryFn: async () => {
      // If we don't have position data, return empty (we're waiting)
      if (!allPositions || allPositions.length === 0) {
        return [];
      }

      const isSolana = isSolanaPool(poolAddressLc);
      const usePoolDataApi = isSolana || isWorldchainIndexerPool(poolAddressLc);

      let hourData: PoolHourData[];
      let rollbackEvents: LPEventData[];

      if (usePoolDataApi) {
        const params = new URLSearchParams({
          pool: poolAddressLc,
          startTime: String(startTime),
          endTime: String(endTime),
          include: "hours,events",
        });
        const res = await fetch(`/api/pool-data?${params.toString()}`);
        if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
        const poolData = await res.json();
        hourData = poolData.poolHourDatas ?? [];
        // Use LP events from pool-data for rollback.
        rollbackEvents = poolData.lpevents ?? [];
      } else {
        // EVM: use envioClient directly
        const response = await envioClient.request<{ poolHourDatas: PoolHourData[] }>(
          GET_POOL_HOUR_DATA_QUERY,
          {
            pool: poolAddressLc,
            startTime,
          }
        );
        hourData = response.poolHourDatas ?? [];
        // Use passed-in events for EVM
        rollbackEvents = lpEvents
          ? [...lpEvents].filter((e) => Number.isFinite(e.timestamp))
          : [];
      }

      if (hourData.length === 0) return [];

      // Sort events for rollback (newest first)
      const sortedEvents = [...rollbackEvents]
        .filter((e) => Number.isFinite(e.timestamp))
        .sort((a, b) => b.timestamp - a.timestamp);

      // Use position-based rollback (ground truth calculation)
      // Build initial range map from current positions
      const rangeMap = buildRangeMapFromPositions(allPositions);

      // Sort hour data from newest to oldest for rollback
      const sortedHourData = [...hourData].sort((a, b) => b.periodStartUnix - a.periodStartUnix);

      let evIdx = 0;
      const results: SlippageDataPoint[] = [];

      for (const hour of sortedHourData) {
        const tsSec = hour.periodStartUnix;

        // Roll back any events that happened after this hour
        while (evIdx < sortedEvents.length && sortedEvents[evIdx]!.timestamp > tsSec) {
          applyRollbackToRangeMap(rangeMap, sortedEvents[evIdx]!);
          evIdx++;
        }

        let sqrtPriceStr: string;
        let tick: number;
        let price: number;

        if (isSolana) {
          // Solana: closePrice is a decimal price (not sqrtPriceX96)
          const decimalPrice = Number(hour.closePrice) || 0;
          if (decimalPrice <= 0) continue;
          // Convert human-readable price to raw Uniswap-style price, then to tick
          const rawPrice = decimalPrice * Math.pow(10, token1Decimals - token0Decimals);
          tick = priceToTick(rawPrice);
          sqrtPriceStr = getSqrtRatioAtTick(tick).toString();
          price = decimalPrice;
        } else {
          // EVM: closePrice is sqrtPriceX96
          sqrtPriceStr = hour.closePrice;
          const rawPrice = sqrtPriceX96ToPrice(BigInt(sqrtPriceStr || "0"), 0, 0);
          tick = priceToTick(rawPrice);
          price = sqrtPriceX96ToPrice(BigInt(sqrtPriceStr || "0"), token0Decimals, token1Decimals);
        }

        // Calculate slippage using the rolled-back range map
        const { buyPct, sellPct } = calculateSlippageFromRangeMap(
          orderSizeUsd,
          rangeMap,
          tick,
          sqrtPriceStr,
          token0Decimals,
          token1Decimals,
          token0UsdPrice,
          token1UsdPrice,
          liquidityPricingMode
        );

        // Store liquidity at current tick from range map
        const liquidityAtTick = getLiquidityAtTickFromRangeMap(rangeMap, tick);

        results.push({
          timestamp: new Date(tsSec * 1000),
          buySlippagePct: buyPct,
          sellSlippagePct: sellPct,
          liquidity: liquidityAtTick.toString(),
          price,
        });
      }

      // Reverse to get chronological order (oldest first)
      return results.reverse();
    },
    // Only run when position data is ready (not loading) and we have positions
    // Events are optional (Solana pools don't have LP events from Envio)
    enabled: enabled && orderSizeUsd > 0 && !waitingForPositionData && !!hasPositions && !isMeteora,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Keep previous data while fetching new - prevents flash of empty state
    placeholderData: (previousData: SlippageDataPoint[] | undefined) => previousData,
  });

  return {
    data: data ?? [],
    // Show loading only while the upstream position/event fetches are still unresolved.
    // Once they resolve to zero positions, the chart should render an explicit empty state.
    isLoading: isLoading || waitingForPositionData,
    error: error as Error | null,
  };
}
