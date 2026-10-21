"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  priceToTick,
  type LPEventData,
} from "@/lib/envio-client";
import { DEFAULT_POOL_KEY, isSolanaPool, normalizePoolKey } from "@/lib/pools";
import { isWorldchainIndexerPool } from "@/lib/worldchain-indexer-client";
import { getLpMeta } from "@/lib/lp-labels";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import { getSqrtRatioAtTick } from "@/lib/depth-calculator";

const INTEGER_STRING_RE = /^-?\d+$/;
const MAX_VISIBLE_LPS = 20;

export type LiquidityHistoryGranularity = "day" | "hour";

/**
 * Opt-in: also compute the USD market depth within ±`depthPct` of price held by
 * a specific set of wallets (e.g. campaign recipients) at each bucket. Adds
 * `campaignDepthUsd` to each snapshot. Existing callers omit this and pay nothing.
 */
export interface DepthConfig {
  walletSet: Set<string>; // lowercase owner addresses to include
  depthPct?: number; // default 1 → depth within ±1% of price
}

export interface DailySnapshot {
  date: number; // Unix timestamp (start of bucket — day for "day" granularity, hour for "hour")
  dateStr: string; // Formatted bucket label
  byAddress: Map<string, number>; // owner -> USD value
  totalUsd: number;
  /** USD depth within ±depthPct held by `DepthConfig.walletSet`, when requested. */
  campaignDepthUsd?: number;
}

export interface LiquidityHistoryData {
  snapshots: DailySnapshot[];
  topAddresses: string[]; // Top N addresses by max observed USD value in the window
  addressLabels: Map<string, string>; // address -> display label
}

interface PositionData {
  owner: string;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
}

interface PoolDataApiPositionRow {
  owner: string;
  liquidity: string;
  tickLower: number | string;
  tickUpper: number | string;
}

interface PoolDataApiLiquidityHistoryResponse {
  positions?: PoolDataApiPositionRow[];
  lpevents?: LPEventData[];
}

/**
 * Hook to fetch and reconstruct liquidity distribution history by address in USD
 * 
 * APPROACH (matches LP Ranges by Address calculation):
 * 1. Fetch CURRENT positions (actual tokenIds with their liquidity)
 * 2. Fetch LP events for the time range
 * 3. Replay events BACKWARDS to reconstruct position state for each day
 * 4. Calculate USD value using CURRENT pool price and CURRENT token USD prices
 * 
 * This matches exactly how lpUsdByOwner is calculated in dashboard.tsx (lines 606-639)
 */
export function useLiquidityHistoryByAddress(
  poolAddress: string = DEFAULT_POOL_KEY,
  days: number = 7,
  token0Decimals: number = 18,
  token1Decimals: number = 6,
  // Current pool price (sqrtPriceX96)
  currentSqrtPriceX96?: string,
  // Current USD prices (used to value liquidity, consistent with rest of app)
  token0UsdPrice: number | null = null,
  token1UsdPrice: number | null = null,
  // Historical daily close prices (sqrtPriceX96) keyed by day-start timestamp.
  // When provided, each daily snapshot uses that day's price instead of current.
  dailyClosePrice?: Map<number, string>,
  enabled: boolean = true,
  spaceSlug?: string | null,
  granularity: LiquidityHistoryGranularity = "day",
  depthConfig?: DepthConfig,
) {
  const poolNorm = normalizePoolKey(poolAddress);
  const isSolana = isSolanaPool(poolNorm);
  // Worldchain indexer pools use the same /api/pool-data path as Solana.
  const usesPoolDataApi = isSolana || isWorldchainIndexerPool(poolNorm);
  const poolAddressLc = poolNorm.toLowerCase();

  // Calculate time boundaries for snapshots
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const todayStart = Math.floor(roundedNow / 86400) * 86400;
  const startDayStart = todayStart - days * 86400;

  // For hourly LDT we widen the event lookback so backward replay can also
  // reverse a partial-close BURN whose paired MINT happened just before the
  // visible 7-day window. The wider events are processed by the bucket loop
  // and snapshots outside the visible window are sliced off before returning.
  // Daily callers (fee earnings, incentive bars, multi-pool token dashboard)
  // keep the original window to avoid extra payload they don't need.
  const REPLAY_LOOKBACK_DAYS_HOURLY = 30;
  const replayLookbackDays = granularity === "hour" ? REPLAY_LOOKBACK_DAYS_HOURLY : 0;
  const eventFetchStart = startDayStart - replayLookbackDays * 86400;

  // ── Solana + Railway-tracked EVM: Fetch positions + events from /api/pool-data ──
  const poolDataApiQuery = useQuery({
    queryKey: ["poolDataApiLiquidityHistory", poolNorm, eventFetchStart, roundedNow],
    queryFn: async () => {
      const url = `/api/pool-data?pool=${encodeURIComponent(poolNorm)}&startTime=${eventFetchStart}&endTime=${roundedNow}&include=positions,events`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
      const data: PoolDataApiLiquidityHistoryResponse = await res.json();

      const positions: PositionData[] = (data.positions ?? [])
        .filter((p) => p.liquidity !== "0")
        .map((p) => ({
          owner: p.owner,
          liquidity: BigInt(p.liquidity),
          tickLower: Number(p.tickLower),
          tickUpper: Number(p.tickUpper),
        }));

      const events: LPEventData[] = data.lpevents ?? [];

      return { positions, events };
    },
    enabled: enabled && usesPoolDataApi && !!poolAddressLc,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Process data: replay events backwards from current state
  // Uses EXACT same calculation as lpUsdByOwner (lines 607-640 in dashboard.tsx)
  const historyData = useMemo<LiquidityHistoryData | null>(() => {
    if (!enabled) return null;
    if (!usesPoolDataApi) return null;
    const currentPositions = poolDataApiQuery.data?.positions ?? null;
    const events = poolDataApiQuery.data?.events ?? null;

    if (!currentPositions || !currentSqrtPriceX96) {
      return null;
    }

    // Current pool price and USD prices for valuation
    const sqrtPriceX96 = BigInt(currentSqrtPriceX96);
    const t0Usd = token0UsdPrice ?? 0;
    const t1Usd = token1UsdPrice ?? 0;

    // Key positions by (owner, tickLower, tickUpper) — not tokenId
    const posKey = (owner: string, tickLower: number, tickUpper: number) =>
      `${owner.toLowerCase()}-${tickLower}-${tickUpper}`;

    // Helper to calculate USD by owner from position state map
    const calculateUsdByOwner = (state: Map<string, PositionData>, priceX96: bigint): Map<string, number> => {
      const map = new Map<string, number>();

      for (const p of state.values()) {
        if (p.liquidity <= 0n) continue;

        const { amount0, amount1 } = amountsForPosition({
          liquidity: p.liquidity,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          sqrtPriceX96: priceX96,
        });

        const amt0 = bigintToApproxNumber(amount0, token0Decimals);
        const amt1 = bigintToApproxNumber(amount1, token1Decimals);
        const usd = amt0 * t0Usd + amt1 * t1Usd;

        const owner = p.owner.toLowerCase();
        map.set(owner, (map.get(owner) ?? 0) + usd);
      }

      return map;
    };

    // Build initial state from current positions, keyed by (owner, ticks).
    // Multiple positions with the same key get their liquidity summed.
    const positionState = new Map<string, PositionData>();
    for (const p of currentPositions) {
      const key = posKey(p.owner, p.tickLower, p.tickUpper);
      const existing = positionState.get(key);
      if (existing) {
        existing.liquidity += p.liquidity;
      } else {
        positionState.set(key, {
          owner: p.owner,
          liquidity: p.liquidity,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
        });
      }
    }

    // Generate bucket timestamps. For "day" granularity each bucket is a UTC
    // day-start; for "hour" granularity each bucket is a UTC hour-start so the
    // chart can render 7d × 24h = 168 points.
    const bucketSize = granularity === "hour" ? 3600 : 86400;
    const visibleStartBucket = granularity === "hour" ? roundedNow - days * 86400 : startDayStart;
    const endBucket = granularity === "hour" ? roundedNow : todayStart;
    // Replay buckets cover the wider event window so pre-visible-window MINTs
    // get reversed too; we slice the snapshots back to the visible window
    // before returning to the chart.
    const replayStartBucket = visibleStartBucket - replayLookbackDays * 86400;
    const bucketTimestamps: number[] = [];
    for (let bucketStart = replayStartBucket; bucketStart <= endBucket; bucketStart += bucketSize) {
      bucketTimestamps.push(bucketStart);
    }

    // Sort events descending (newest first) for backward replay
    const sortedEvents = events ? [...events].sort((a, b) => b.timestamp - a.timestamp) : [];

    const snapshots: DailySnapshot[] = [];
    let eventIdx = 0;

    // Process each bucket from newest to oldest
    for (let i = bucketTimestamps.length - 1; i >= 0; i--) {
      const dayStart = bucketTimestamps[i];
      const dayEnd = dayStart + bucketSize;

      // Reverse events that happened on or after dayEnd (replay backwards).
      // Events sharing one timestamp (same block — typical for JIT bundles) are
      // batched and reverse-applied as the *net* per-position delta. The API
      // returns events sorted only by timestamp ASC with no log-index field, so
      // stable DESC sort here would leave same-block ties in chronological
      // order. Applying them one-at-a-time would then process the MINT (no
      // existing entry → skip) before the BURN (no existing entry → recreate
      // with phantom +liquidity), leaving a non-zero state from a position
      // that never existed. Batching by net delta is order-independent: a
      // matching MINT+BURN at the same (owner, ticks) cancels to zero.
      while (eventIdx < sortedEvents.length && sortedEvents[eventIdx].timestamp >= dayEnd) {
        const ts = sortedEvents[eventIdx].timestamp;
        const netByKey = new Map<string, {
          delta: bigint;
          tickLower: number;
          tickUpper: number;
          owner: string;
        }>();
        while (eventIdx < sortedEvents.length && sortedEvents[eventIdx].timestamp === ts) {
          const e = sortedEvents[eventIdx];
          const tl = parseInt(e.tickLower);
          const tu = parseInt(e.tickUpper);
          const key = posKey(e.owner, tl, tu);
          const delta = BigInt(e.liquidityDelta);
          const bucket = netByKey.get(key);
          if (bucket) {
            bucket.delta += delta;
          } else {
            netByKey.set(key, { delta, tickLower: tl, tickUpper: tu, owner: e.owner });
          }
          eventIdx++;
        }
        for (const [key, bucket] of netByKey.entries()) {
          if (bucket.delta === 0n) continue;
          const existing = positionState.get(key);
          if (existing) {
            existing.liquidity -= bucket.delta;
            if (existing.liquidity <= 0n) {
              positionState.delete(key);
            }
          } else if (bucket.delta < 0n) {
            // Net burn with no current entry — recreate the pre-burn position.
            positionState.set(key, {
              owner: bucket.owner,
              liquidity: -bucket.delta,
              tickLower: bucket.tickLower,
              tickUpper: bucket.tickUpper,
            });
          }
          // Net mint with no current entry: orphan (the matching close is
          // outside the replay window) — same as the prior per-event skip.
        }
      }

      // Resolve sqrtPriceX96 for this bucket (use historical close if available).
      // closePrice is sqrtPriceX96 (integer) for EVM/Envio pools, but a
      // human-readable decimal for Solana/Railway-tracked pools. The map is
      // keyed by day-start, so for hourly buckets we derive the containing day.
      const dayStartForPrice = Math.floor(dayStart / 86400) * 86400;
      const historicalPrice = dailyClosePrice?.get(dayStartForPrice);
      let dayPriceX96 = sqrtPriceX96;
      if (historicalPrice) {
        if (INTEGER_STRING_RE.test(historicalPrice)) {
          // Already sqrtPriceX96
          dayPriceX96 = BigInt(historicalPrice);
        } else {
          // Human-readable price — convert to sqrtPriceX96
          const humanPrice = Number(historicalPrice);
          if (Number.isFinite(humanPrice) && humanPrice > 0) {
            const rawPrice = humanPrice * Math.pow(10, token1Decimals - token0Decimals);
            const tick = priceToTick(rawPrice);
            dayPriceX96 = getSqrtRatioAtTick(tick);
          }
        }
      }

      // Calculate USD value for this day's reconstructed state
      const ownerUsd = calculateUsdByOwner(positionState, dayPriceX96);
      const totalUsd = Array.from(ownerUsd.values()).reduce((sum, usd) => sum + usd, 0);

      // Optional: USD value of liquidity within ±depthPct of price held by the
      // wallet set this bucket. Computed the same way as TVL (amountsForPosition
      // over the band-overlap of each position, valued in USD), so it is always
      // ≤ that wallet set's TVL — never the double-counted notional depth.
      let campaignDepthUsd: number | undefined;
      if (depthConfig && depthConfig.walletSet.size > 0) {
        const sqrtP = Number(dayPriceX96) / 2 ** 96;
        const rawPrice = sqrtP * sqrtP; // token1/token0 (raw, decimal-unadjusted)
        if (Number.isFinite(rawPrice) && rawPrice > 0) {
          const pct = depthConfig.depthPct ?? 1;
          const bandLowTick = priceToTick(rawPrice * (1 - pct / 100));
          const bandHighTick = priceToTick(rawPrice * (1 + pct / 100));
          let depthSum = 0;
          for (const p of positionState.values()) {
            if (p.liquidity <= 0n) continue;
            if (!depthConfig.walletSet.has(p.owner.toLowerCase())) continue;
            // Portion of this position's range that overlaps the ±pct band.
            const lo = Math.max(p.tickLower, bandLowTick);
            const hi = Math.min(p.tickUpper, bandHighTick);
            if (lo >= hi) continue;
            const { amount0, amount1 } = amountsForPosition({
              liquidity: p.liquidity,
              tickLower: lo,
              tickUpper: hi,
              sqrtPriceX96: dayPriceX96,
            });
            const amt0 = bigintToApproxNumber(amount0, token0Decimals);
            const amt1 = bigintToApproxNumber(amount1, token1Decimals);
            depthSum += amt0 * t0Usd + amt1 * t1Usd;
          }
          campaignDepthUsd = depthSum;
        } else {
          campaignDepthUsd = 0;
        }
      }

      const date = new Date(dayStart * 1000);
      const dateStr = granularity === "hour"
        ? `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} ${String(date.getUTCHours()).padStart(2, "0")}:00`
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      snapshots.push({
        date: dayStart,
        dateStr,
        byAddress: ownerUsd,
        totalUsd,
        campaignDepthUsd,
      });

    }

    // Reverse snapshots to chronological order
    snapshots.reverse();

    // Slice off pre-visible-window snapshots that we only computed to keep the
    // backward replay state correct across the wider event lookback.
    const visibleSnapshots = replayLookbackDays > 0
      ? snapshots.filter((s) => s.date >= visibleStartBucket)
      : snapshots;

    // Find top addresses by max observed USD value across the window.
    // If a large LP fully withdraws, ranking only by current USD hides that LP
    // inside "Others" exactly when the chart needs to explain the drop.
    const currentOwnerUsd = calculateUsdByOwner(
      // Rebuild current state map from currentPositions for top-address ranking
      (() => {
        const m = new Map<string, PositionData>();
        for (const p of currentPositions) {
          const key = posKey(p.owner, p.tickLower, p.tickUpper);
          const ex = m.get(key);
          if (ex) { ex.liquidity += p.liquidity; }
          else { m.set(key, { owner: p.owner, liquidity: p.liquidity, tickLower: p.tickLower, tickUpper: p.tickUpper }); }
        }
        return m;
      })(),
      sqrtPriceX96 // Use current price for ranking (not historical)
    );
    const maxObservedUsd = new Map<string, number>();
    for (const snapshot of visibleSnapshots) {
      for (const [addr, usd] of snapshot.byAddress.entries()) {
        maxObservedUsd.set(addr, Math.max(maxObservedUsd.get(addr) ?? 0, usd));
      }
    }
    const addressTotals = Array.from(maxObservedUsd.entries())
      .map(([addr, maxUsd]) => ({
        addr,
        maxUsd,
        currentUsd: currentOwnerUsd.get(addr) ?? 0,
      }))
      .sort((a, b) => b.maxUsd - a.maxUsd || b.currentUsd - a.currentUsd);

    const topAddresses = addressTotals.slice(0, MAX_VISIBLE_LPS).map((a) => a.addr);

    // Build address labels
    const addressLabels = new Map<string, string>();
    for (const addr of topAddresses) {
      const meta = getLpMeta(addr, spaceSlug);
      if (meta) {
        addressLabels.set(addr, meta.label);
      } else {
        addressLabels.set(addr, `${addr.slice(0, 6)}...${addr.slice(-4)}`);
      }
    }
    addressLabels.set("others", "Others");

    return {
      snapshots: visibleSnapshots,
      topAddresses,
      addressLabels,
    };
  }, [
    usesPoolDataApi,
    poolDataApiQuery.data,
    currentSqrtPriceX96,
    startDayStart,
    todayStart,
    roundedNow,
    days,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    dailyClosePrice,
    enabled,
    spaceSlug,
    granularity,
    replayLookbackDays,
    depthConfig,
  ]);

  const isLoading = !enabled || !usesPoolDataApi ? false : poolDataApiQuery.isLoading;
  const isError = !enabled || !usesPoolDataApi ? false : poolDataApiQuery.isError;

  return { data: historyData, isLoading, isError };
}

/**
 * Convert snapshots to chart-ready data format
 * Groups smaller LPs into "Others"
 */
export function convertToChartData(
  historyData: LiquidityHistoryData | null
): Array<{ date: string; [address: string]: number | string }> {
  if (!historyData) return [];

  const { snapshots, topAddresses } = historyData;

  return snapshots.map((snapshot) => {
    const dataPoint: { date: string; [address: string]: number | string } = {
      date: snapshot.dateStr,
    };

    let othersUsd = 0;

    for (const [addr, usd] of snapshot.byAddress.entries()) {
      if (topAddresses.includes(addr)) {
        dataPoint[addr] = usd;
      } else {
        othersUsd += usd;
      }
    }

    // Add zeros for missing top addresses
    for (const addr of topAddresses) {
      if (!(addr in dataPoint)) {
        dataPoint[addr] = 0;
      }
    }

    dataPoint["others"] = othersUsd;

    return dataPoint;
  });
}
