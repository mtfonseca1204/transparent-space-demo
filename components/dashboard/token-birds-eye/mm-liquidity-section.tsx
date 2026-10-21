"use client";

import React, { useMemo } from "react";
import type { TokenDashboardData } from "@/hooks/use-token-dashboard-data";
import { getLpMeta, type LpMeta } from "@/lib/lp-labels";
import { useMMLiquidityEvents } from "@/hooks/use-mm-liquidity-events";
import { MMLiquidityChart, type MMLiquidityDataPoint } from "../mm-liquidity-chart";

interface MMLiquiditySectionProps {
  data: TokenDashboardData;
  spaceSlug?: string | null;
}

/**
 * Identifies named market makers across all pools for this token,
 * fetches 1-year event-level liquidity history per pool, and renders
 * a chart per named MM showing their aggregated liquidity over time.
 */
export function MMLiquiditySection({ data, spaceSlug }: MMLiquiditySectionProps) {
  // Find named MMs present in positions across all pools
  const namedMMs = useMemo(() => {
    const seen = new Map<string, LpMeta>();
    for (const row of data.pools) {
      for (const group of row.positions) {
        const addr = group.owner.toLowerCase();
        if (!seen.has(addr)) {
          const meta = getLpMeta(addr, spaceSlug);
          if (meta) seen.set(addr, meta);
        }
      }
    }
    return seen;
  }, [data.pools, spaceSlug]);

  if (namedMMs.size === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {Array.from(namedMMs.entries()).map(([address, meta]) => (
        <MMLiquidityChartWrapper
          key={address}
          mmAddress={address}
          mmMeta={meta}
          data={data}
        />
      ))}
    </div>
  );
}

/**
 * Per-MM wrapper that fetches 1-year event-level liquidity history
 * for each pool and aggregates the MM's liquidity across all pools.
 *
 * Uses hardcoded hook calls (up to 6 pools) to satisfy React's rules of hooks.
 * Event-level granularity ensures intra-day dips below $10k are captured.
 */
function MMLiquidityChartWrapper({
  mmAddress,
  mmMeta,
  data,
}: {
  mmAddress: string;
  mmMeta: LpMeta;
  data: TokenDashboardData;
}) {
  const pools = data.pools;

  // Helper to get params for each pool slot
  const getParams = (i: number) => {
    if (i >= pools.length) {
      return { poolKey: "", t0Dec: 18, t1Dec: 6, sqrtPriceX96: undefined as string | undefined, t0Usd: null as number | null, t1Usd: null as number | null };
    }
    const row = pools[i];
    const pd = row.poolData;
    return {
      poolKey: row.pool.poolKey,
      t0Dec: pd?.token0Decimals ?? 18,
      t1Dec: pd?.token1Decimals ?? 6,
      sqrtPriceX96: pd?.sqrtPriceX96 || undefined,
      t0Usd: row.token0Usd,
      t1Usd: row.token1Usd,
    };
  };

  const p0 = getParams(0);
  const p1 = getParams(1);
  const p2 = getParams(2);
  const p3 = getParams(3);
  const p4 = getParams(4);
  const p5 = getParams(5);

  // Event-level hooks (one per pool slot) — produces a data point at every mint/burn
  const h0 = useMMLiquidityEvents(p0.poolKey, mmAddress, 365, p0.t0Dec, p0.t1Dec, p0.sqrtPriceX96, p0.t0Usd, p0.t1Usd);
  const h1 = useMMLiquidityEvents(p1.poolKey, mmAddress, 365, p1.t0Dec, p1.t1Dec, p1.sqrtPriceX96, p1.t0Usd, p1.t1Usd);
  const h2 = useMMLiquidityEvents(p2.poolKey, mmAddress, 365, p2.t0Dec, p2.t1Dec, p2.sqrtPriceX96, p2.t0Usd, p2.t1Usd);
  const h3 = useMMLiquidityEvents(p3.poolKey, mmAddress, 365, p3.t0Dec, p3.t1Dec, p3.sqrtPriceX96, p3.t0Usd, p3.t1Usd);
  const h4 = useMMLiquidityEvents(p4.poolKey, mmAddress, 365, p4.t0Dec, p4.t1Dec, p4.sqrtPriceX96, p4.t0Usd, p4.t1Usd);
  const h5 = useMMLiquidityEvents(p5.poolKey, mmAddress, 365, p5.t0Dec, p5.t1Dec, p5.sqrtPriceX96, p5.t0Usd, p5.t1Usd);

  const eventResults = [h0, h1, h2, h3, h4, h5].slice(0, pools.length);

  const isLoading = eventResults.some((h) => h.isLoading);

  // Merge event-level data points from all pools into a single time series.
  // At each timestamp, sum the MM's liquidity across all pools.
  const chartData = useMemo<MMLiquidityDataPoint[]>(() => {
    // Collect all unique timestamps and per-pool values
    // For each pool we have an ordered series of (timestamp, usd).
    // Between events, liquidity is constant. So at any point in time,
    // a pool's value is the most recent event value <= that time.
    const allSeries = eventResults.map((h) => h.data ?? []);

    // If only one pool, use its data directly (most common case)
    if (allSeries.length === 1) return allSeries[0];

    // Collect all unique timestamps across all pools
    const tsSet = new Set<number>();
    for (const series of allSeries) {
      for (const pt of series) {
        tsSet.add(pt.timestamp.getTime());
      }
    }

    const allTimestamps = Array.from(tsSet).sort((a, b) => a - b);
    if (allTimestamps.length === 0) return [];

    // For each timestamp, find each pool's value at that time
    // (last value <= timestamp via binary search)
    const result: MMLiquidityDataPoint[] = [];
    const indices = new Array(allSeries.length).fill(0);

    for (const ts of allTimestamps) {
      let totalUsd = 0;
      for (let si = 0; si < allSeries.length; si++) {
        const series = allSeries[si];
        if (series.length === 0) continue;
        // Advance index to the last point <= ts
        while (
          indices[si] < series.length - 1 &&
          series[indices[si] + 1].timestamp.getTime() <= ts
        ) {
          indices[si]++;
        }
        if (series[indices[si]].timestamp.getTime() <= ts) {
          totalUsd += series[indices[si]].liquidityUsd;
        }
      }
      result.push({ timestamp: new Date(ts), liquidityUsd: totalUsd });
    }

    return result;
  }, [eventResults]);

  return (
    <div className="bp-card relative flex flex-col">
      <div className="bp-card-inner" />
      <div className="flex items-center gap-2 mb-2">
        {mmMeta.logoSrc && (
          <img
            src={mmMeta.logoSrc}
            alt={mmMeta.label}
            className="w-4 h-4 rounded-sm"
            loading="lazy"
          />
        )}
        <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          {mmMeta.label} — Liquidity Over Time
        </span>
      </div>
      <div className="h-[400px]">
        {isLoading || chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
          </div>
        ) : (
          <MMLiquidityChart data={chartData} />
        )}
      </div>
    </div>
  );
}
