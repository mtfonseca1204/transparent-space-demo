"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { type LPEventData } from "@/lib/envio-client";
import { DEFAULT_POOL_KEY, isSolanaPool, normalizePoolKey } from "@/lib/pools";
import { isWorldchainIndexerPool } from "@/lib/worldchain-indexer-client";
import type { MMLiquidityDataPoint } from "@/components/dashboard/mm-liquidity-chart";
import { calculateLPEventUsdValue } from "@/lib/lp-event-value";

// ─── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Hook that fetches event-level liquidity data for a specific market maker address.
 *
 * Uses the same approach as "LP Activity - New vs Exits":
 * - amount0 / amount1 from each event give exact token amounts deposited/withdrawn
 * - USD value = abs(amount0) * token0UsdPrice + abs(amount1) * token1UsdPrice
 * - Running total tracks cumulative position value over time
 *
 * Produces a data point at EVERY mint/burn event — intra-day dips are never missed.
 *
 * Supported Solana and Worldchain pools fetch events through /api/pool-data.
 */
export function useMMLiquidityEvents(
  poolAddress: string = DEFAULT_POOL_KEY,
  mmAddress: string,
  days: number = 365,
  token0Decimals: number = 18,
  token1Decimals: number = 6,
  currentSqrtPriceX96?: string,
  token0UsdPrice: number | null = null,
  token1UsdPrice: number | null = null,
) {
  const poolNorm = normalizePoolKey(poolAddress);
  const isSolana = isSolanaPool(poolNorm);
  const usesPoolDataApi = isSolana || isWorldchainIndexerPool(poolNorm);
  const poolAddressLc = poolNorm.toLowerCase();
  const mmAddressLc = mmAddress.toLowerCase();
  const enabled = !!poolAddressLc && !!mmAddressLc;

  const todayStart = Math.floor(Date.now() / 1000 / 86400) * 86400;
  const startDayStart = todayStart - days * 86400;

  // ═══ Pool-data API path (Solana + Railway-tracked EVM pools) ═══
  const poolDataApiQuery = useQuery({
    queryKey: ["poolDataApiMMLiquidity", poolNorm, startDayStart],
    queryFn: async () => {
      const url = `/api/pool-data?pool=${encodeURIComponent(poolNorm)}&startTime=${startDayStart}&endTime=${Math.floor(Date.now() / 1000)}&include=events`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
      const data = await res.json();
      const events: LPEventData[] = data.lpevents ?? [];
      return events;
    },
    enabled: usesPoolDataApi && enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  // ─── Build event-level time series ───────────────────────────────────────────
  const chartData = useMemo<MMLiquidityDataPoint[]>(() => {
    const t0Usd = token0UsdPrice ?? 0;
    const t1Usd = token1UsdPrice ?? 0;
    if (t0Usd === 0 && t1Usd === 0) return [];

    const rawEvents = usesPoolDataApi ? poolDataApiQuery.data ?? null : null;
    if (!rawEvents || rawEvents.length === 0) return [];

    // pool-data API returns all events, so filter to this MM here.
    const seenIds = new Set<string>();
    const mmEvents = rawEvents
      .filter((e) => e.owner.toLowerCase() === mmAddressLc)
      .filter((e) => {
        if (seenIds.has(e.id)) return false;
        seenIds.add(e.id);
        return true;
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    if (mmEvents.length === 0) return [];

    // ═══ Forward replay using amount0 + amount1 (same as LP Activity) ═══
    const points: MMLiquidityDataPoint[] = [];
    let runningTotalUsd = 0;

    // Initial state before first event
    points.push({
      timestamp: new Date(mmEvents[0].timestamp * 1000 - 1),
      liquidityUsd: 0,
    });

    for (const e of mmEvents) {
      const eventTime = new Date(e.timestamp * 1000);

      const eventUsd = calculateLPEventUsdValue({
        event: e,
        poolKey: poolNorm,
        token0Decimals,
        token1Decimals,
        token0UsdPrice: t0Usd > 0 ? t0Usd : null,
        token1UsdPrice: t1Usd > 0 ? t1Usd : null,
        sqrtPriceX96: currentSqrtPriceX96,
      });

      // Record state BEFORE this event (flat line from previous)
      points.push({
        timestamp: new Date(eventTime.getTime() - 1),
        liquidityUsd: runningTotalUsd,
      });

      // Apply: MINT/INCREASE adds, BURN/DECREASE removes
      const isMint = e.eventType === "MINT" || e.eventType === "INCREASE";
      if (isMint) {
        runningTotalUsd += eventUsd;
      } else {
        runningTotalUsd -= eventUsd;
      }
      // Clamp to 0 (rounding errors can make it slightly negative)
      if (runningTotalUsd < 0) runningTotalUsd = 0;

      // Record state AFTER this event
      points.push({
        timestamp: eventTime,
        liquidityUsd: runningTotalUsd,
      });
    }

    // Current state (now)
    points.push({
      timestamp: new Date(),
      liquidityUsd: runningTotalUsd,
    });

    // Trim to requested time window
    return trimToWindow(points, startDayStart * 1000);
  }, [
    usesPoolDataApi,
    poolDataApiQuery.data,
    poolNorm,
    mmAddressLc,
    token0Decimals,
    token1Decimals,
    currentSqrtPriceX96,
    token0UsdPrice,
    token1UsdPrice,
    startDayStart,
  ]);

  const isLoading = usesPoolDataApi ? poolDataApiQuery.isLoading : false;

  return { data: chartData, isLoading };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Trim data points to the requested time window.
 * Keeps the last point before the window to show the entering state.
 */
function trimToWindow(
  points: MMLiquidityDataPoint[],
  windowStartMs: number,
): MMLiquidityDataPoint[] {
  if (points.length === 0) return points;

  // Find the last point before window start
  let lastBeforeIdx = -1;
  for (let i = 0; i < points.length; i++) {
    if (points[i].timestamp.getTime() < windowStartMs) {
      lastBeforeIdx = i;
    } else {
      break;
    }
  }

  if (lastBeforeIdx === -1) return points;

  // Keep the last pre-window point (at window start) + all window points
  const result: MMLiquidityDataPoint[] = [];
  result.push({
    timestamp: new Date(windowStartMs),
    liquidityUsd: points[lastBeforeIdx].liquidityUsd,
  });
  for (let i = lastBeforeIdx + 1; i < points.length; i++) {
    result.push(points[i]);
  }
  return result;
}
