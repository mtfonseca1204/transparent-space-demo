"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { PositionData } from "@/lib/envio-client";
import { cn } from "@/lib/utils";
import { LpLabel } from "@/components/dashboard/lp-label";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";

type LpVenueBreakdown = {
  asset: string;
  venue: string;
  tvlUsd: number;
};

type AggregateLpRow = {
  owner: string;
  tvlUsd: number;
  liqPct: number;
  assets: string[];
  venues: string[];
  poolBreakdown: LpVenueBreakdown[];
};

const TOP_LPS = 30;
const TABLE_TOP_LPS = 10;
const LP_AGGREGATE_CACHE_TTL_MS = 2 * 60_000;
const LP_AGGREGATE_CHUNK_BUDGET_MS = 8;
const METRIC_TEXT = "text-[11px] font-semibold font-mono text-gray-700 dark:text-gray-300";

type LpAggregateCacheEntry = {
  timestamp: number;
  rows: AggregateLpRow[];
};

type LpAggregateDraft = {
  tvlUsd: number;
  assets: Set<string>;
  venues: Set<string>;
  poolBreakdown: Map<string, LpVenueBreakdown>;
};

type LpAggregatePoolWork = {
  card: BirdsEyePoolCard;
  sqrtPriceX96: bigint;
  token0Usd: number;
  token1Usd: number;
  venue: string;
};

type IdleDeadlineLike = {
  timeRemaining?: () => number;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout?: number }
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const lpAggregateCache = new Map<string, LpAggregateCacheEntry>();

function getPositionTick(pos: PositionData, field: "lower" | "upper") {
  const snake = field === "lower" ? "tick_lower" : "tick_upper";
  const camel = field === "lower" ? "tickLower" : "tickUpper";
  const value = (pos as PositionData & Record<string, unknown>)[camel]
    ?? (pos as PositionData & Record<string, unknown>)[snake];
  return Number(value);
}

function getVenueLabel(card: BirdsEyePoolCard) {
  const k = (card.pool.key || "").toLowerCase();
  let venue: string;
  if (k.startsWith("pancake-infinity-") || k.startsWith("pancake-")) venue = "PancakeSwap";
  else if (k.startsWith("byreal-")) venue = "Byreal";
  else if (k.startsWith("raydium-")) venue = "Raydium";
  else if (k.startsWith("meteora-")) venue = "Meteora";
  else {
    const p = (card.pool.protocol || "").toLowerCase();
    if (p === "raydium") venue = "Raydium";
    else if (p === "byreal") venue = "Byreal";
    else if (p === "meteora") venue = "Meteora";
    else if (p === "v3") venue = "UniV3";
    else if (p === "v4") venue = "UniV4";
    else venue = card.pool.protocol || "Pool";
  }
  return `${venue} ${card.feeTier}`;
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

function ChipList({
  values,
  variant,
  title,
}: {
  values: string[];
  variant: "asset" | "venue";
  title?: string;
}) {
  return (
    <div className="flex max-w-[420px] flex-wrap gap-1" title={title}>
      {values.map((value) => (
        <span
          key={value}
          className={cn(
            "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
            variant === "asset"
              ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300"
              : "border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-300"
          )}
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function addOwnerGroupToAggregate(
  lpMap: Map<string, LpAggregateDraft>,
  work: LpAggregatePoolWork,
  ownerGroup: BirdsEyePoolCard["positions"][number]
) {
  const { card, sqrtPriceX96, token0Usd, token1Usd, venue } = work;
  const pd = card.poolData;
  const owner = ownerGroup.owner?.trim();
  if (!owner || !pd) return;

  let ownerPoolTvl = 0;
  for (const pos of ownerGroup.positions) {
    const liquidity = BigInt(pos.liquidity ?? "0");
    if (liquidity <= 0n) continue;

    const tickLower = getPositionTick(pos, "lower");
    const tickUpper = getPositionTick(pos, "upper");
    if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) continue;

    const { amount0, amount1 } = amountsForPosition({
      liquidity,
      tickLower,
      tickUpper,
      sqrtPriceX96,
    });
    ownerPoolTvl +=
      bigintToApproxNumber(amount0, pd.token0Decimals) * token0Usd +
      bigintToApproxNumber(amount1, pd.token1Decimals) * token1Usd;
  }

  if (ownerPoolTvl <= 0) return;

  const existing = lpMap.get(owner) ?? {
    tvlUsd: 0,
    assets: new Set<string>(),
    venues: new Set<string>(),
    poolBreakdown: new Map<string, LpVenueBreakdown>(),
  };
  existing.tvlUsd += ownerPoolTvl;
  existing.assets.add(card.trackedAsset);
  existing.venues.add(venue);

  const breakdownKey = `${card.trackedAsset}:${venue}`;
  const currentBreakdown = existing.poolBreakdown.get(breakdownKey);
  existing.poolBreakdown.set(breakdownKey, {
    asset: card.trackedAsset,
    venue,
    tvlUsd: (currentBreakdown?.tvlUsd ?? 0) + ownerPoolTvl,
  });
  lpMap.set(owner, existing);
}

function finalizeAggregateRows(lpMap: Map<string, LpAggregateDraft>): AggregateLpRow[] {
  const aggregateTvl = [...lpMap.values()].reduce((sum, row) => sum + row.tvlUsd, 0);
  return [...lpMap.entries()]
    .sort((a, b) => b[1].tvlUsd - a[1].tvlUsd)
    .slice(0, TOP_LPS)
    .map(([owner, info]) => ({
      owner,
      tvlUsd: info.tvlUsd,
      liqPct: aggregateTvl > 0 ? (info.tvlUsd / aggregateTvl) * 100 : 0,
      assets: [...info.assets].sort(),
      venues: [...info.venues].sort(),
      poolBreakdown: [...info.poolBreakdown.values()].sort((a, b) => b.tvlUsd - a.tvlUsd),
    }));
}

function getCachedAggregateRows(cacheKey: string): AggregateLpRow[] | null {
  const cached = lpAggregateCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > LP_AGGREGATE_CACHE_TTL_MS) {
    lpAggregateCache.delete(cacheKey);
    return null;
  }
  return cached.rows;
}

function setCachedAggregateRows(cacheKey: string, rows: AggregateLpRow[]) {
  lpAggregateCache.set(cacheKey, { timestamp: Date.now(), rows });
  if (lpAggregateCache.size > 12) {
    const oldest = lpAggregateCache.keys().next().value;
    if (oldest) lpAggregateCache.delete(oldest);
  }
}

function buildAggregateCacheKey(pools: BirdsEyePoolCard[]) {
  return pools
    .map((card) => {
      let positionCount = 0;
      let liquidityTotal = 0n;
      for (const owner of card.positions) {
        positionCount += owner.positions.length;
        try {
          liquidityTotal += BigInt(owner.liquidityTotal ?? "0");
        } catch {
          // Ignore malformed liquidity totals; the detailed calculation below
          // still uses each position's concrete liquidity.
        }
      }

      return [
        card.pool.poolKey,
        card.poolData?.sqrtPriceX96 ?? "",
        card.poolData?.token0Decimals ?? "",
        card.poolData?.token1Decimals ?? "",
        card.token0Usd ?? "",
        card.token1Usd ?? "",
        card.positions.length,
        positionCount,
        liquidityTotal.toString(),
      ].join(":");
    })
    .join("|");
}

function buildPoolWork(pools: BirdsEyePoolCard[]): LpAggregatePoolWork[] {
  const work: LpAggregatePoolWork[] = [];
  for (const card of pools) {
    const pd = card.poolData;
    if (!pd || card.positions.length === 0) continue;

    try {
      work.push({
        card,
        sqrtPriceX96: BigInt(pd.sqrtPriceX96),
        token0Usd: card.token0Usd ?? 0,
        token1Usd: card.token1Usd ?? 0,
        venue: getVenueLabel(card),
      });
    } catch {
      continue;
    }
  }
  return work;
}

function useIdleAggregateRows(pools: BirdsEyePoolCard[]) {
  const cacheKey = useMemo(() => buildAggregateCacheKey(pools), [pools]);
  const hasPositionData = pools.some(
    (pool) => Boolean(pool.poolData) && pool.positions.length > 0
  );
  const [rows, setRows] = useState<AggregateLpRow[] | null>(() => {
    if (!hasPositionData) return [];
    return getCachedAggregateRows(cacheKey);
  });

  useEffect(() => {
    if (!hasPositionData) {
      setRows([]);
      return;
    }

    const cached = getCachedAggregateRows(cacheKey);
    if (cached) {
      setRows(cached);
      return;
    }

    setRows(null);

    const work = buildPoolWork(pools);
    const lpMap = new Map<string, LpAggregateDraft>();
    let poolIndex = 0;
    let ownerIndex = 0;
    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const schedule = () => {
      if (cancelled) return;
      const idleWindow = window as IdleWindow;
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(runChunk, { timeout: 160 });
      } else {
        timeoutHandle = window.setTimeout(() => runChunk({}), 0);
      }
    };

    const shouldYield = (startedAt: number, deadline?: IdleDeadlineLike) => {
      if (deadline?.timeRemaining && deadline.timeRemaining() <= 1) return true;
      return performance.now() - startedAt >= LP_AGGREGATE_CHUNK_BUDGET_MS;
    };

    const finish = () => {
      const nextRows = finalizeAggregateRows(lpMap);
      setCachedAggregateRows(cacheKey, nextRows);
      if (!cancelled) setRows(nextRows);
    };

    function runChunk(deadline?: IdleDeadlineLike) {
      if (cancelled) return;
      const startedAt = performance.now();

      while (poolIndex < work.length) {
        const poolWork = work[poolIndex]!;
        const ownerGroups = poolWork.card.positions;

        while (ownerIndex < ownerGroups.length) {
          addOwnerGroupToAggregate(lpMap, poolWork, ownerGroups[ownerIndex]!);
          ownerIndex += 1;
          if (shouldYield(startedAt, deadline)) {
            schedule();
            return;
          }
        }

        poolIndex += 1;
        ownerIndex = 0;
      }

      finish();
    }

    schedule();

    return () => {
      cancelled = true;
      if (idleHandle !== null) {
        (window as IdleWindow).cancelIdleCallback?.(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [cacheKey, hasPositionData, pools]);

  return {
    rows: rows ?? [],
    isComputing: rows === null && hasPositionData,
  };
}

export const BirdsEyeLpAggregateTable = memo(function BirdsEyeLpAggregateTable({
  pools,
  spaceSlug,
}: {
  pools: BirdsEyePoolCard[];
  spaceSlug?: string | null;
}) {
  const { rows, isComputing } = useIdleAggregateRows(pools);
  const tableRows = useMemo(() => rows.slice(0, TABLE_TOP_LPS), [rows]);
  const isLoading = pools.some((pool) => pool.isLoading);

  if (rows.length === 0 && !isLoading && !isComputing) return null;

  return (
    <section className="flex flex-col">
      <header className="border-b border-gray-300 px-4 py-4 dark:border-gray-700 md:px-6">
        <h3 className="font-mono text-base font-semibold uppercase tracking-wide text-gray-950 dark:text-gray-50">
          Top LPs
        </h3>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              {["#", "LP", "#Assets", "Assets", "Venues", "TVL", "LIQ%"].map((heading) => (
                <th
                  key={heading}
                  className={cn(
                    "px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 whitespace-nowrap",
                    (heading === "TVL" || heading === "LIQ%") && "text-right"
                  )}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(isLoading || isComputing) && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100/60 dark:border-gray-800/40">
                  <td colSpan={7} className="px-3 py-2">
                    <div className="h-4 w-full max-w-3xl bp-skeleton rounded" />
                  </td>
                </tr>
              ))
            ) : (
              tableRows.map((row, index) => (
                <tr
                  key={row.owner}
                  className="border-b border-gray-100/60 bg-white/60 dark:border-gray-800/40 dark:bg-gray-950/20"
                >
                  <td className="px-3 py-2 text-[11px] font-semibold font-mono text-gray-400">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2">
                    <LpLabel
                      address={row.owner}
                      spaceSlug={spaceSlug}
                      className="text-[11px] font-bold font-mono text-gray-900 dark:text-white"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className={METRIC_TEXT}>{row.assets.length}</span>
                  </td>
                  <td className="px-3 py-2">
                    <ChipList values={row.assets} variant="asset" />
                  </td>
                  <td className="px-3 py-2">
                    <ChipList
                      values={row.venues}
                      variant="venue"
                      title={row.poolBreakdown
                        .map((pool) => `${pool.asset} ${pool.venue}: ${formatCompact(pool.tvlUsd)}`)
                        .join("\n")}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(METRIC_TEXT, "font-bold")}>{formatCompact(row.tvlUsd)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={METRIC_TEXT}>{formatPct(row.liqPct)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
});
