"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { TokenDashboardData } from "@/hooks/use-token-dashboard-data";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import { formatLpLabel } from "@/lib/lp-labels";
import { LpLabel } from "@/components/dashboard/lp-label";

const POOL_COLORS = ["#4A6CF7", "#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899", "#10B981"];

interface LPRow {
  address: string;
  displayAddr: string;
  pools: { label: string; color: string }[];
  tvlUsd: number;
  liqPct: number;
  volPct: number;
  efficiency: number | null;
}

interface LPEfficiencyTableProps {
  data: TokenDashboardData;
  spaceSlug?: string | null;
}

export function LPEfficiencyTable({ data, spaceSlug }: LPEfficiencyTableProps) {
  const { lpRows, totalLPs, top5TvlPct, crossPoolCount } = useMemo(() => {
    // Map pool label -> color
    const poolColorMap = new Map<string, string>();
    data.pools.forEach((row, i) => {
      poolColorMap.set(row.pool.label, POOL_COLORS[i % POOL_COLORS.length]);
    });

    // Per-pool metrics for each LP: vol% and efficiency computed per market
    interface PerPoolMetric { volPct: number; liqPct: number; efficiency: number }
    const lpMap = new Map<
      string,
      {
        tvlUsd: number;
        poolLabels: Set<string>;
        perPool: PerPoolMetric[];
      }
    >();

    for (const row of data.pools) {
      const pd = row.poolData;
      if (!pd) continue;

      const currentTick = pd.tick;
      const sqrtPriceX96 = BigInt(pd.sqrtPriceX96);
      const t0Dec = pd.token0Decimals;
      const t1Dec = pd.token1Decimals;
      const t0Usd = row.token0Usd ?? 0;
      const t1Usd = row.token1Usd ?? 0;

      // Compute per-owner: actual USD TVL and active liquidity
      let poolTotalTvlUsd = 0;
      let poolActiveLiq = 0n;
      const ownerTvls = new Map<string, number>();
      const ownerActiveLiqs = new Map<string, bigint>();

      for (const ownerGroup of row.positions) {
        const addr = ownerGroup.owner.toLowerCase();
        let ownerTvl = 0;
        let ownerActive = 0n;

        for (const pos of ownerGroup.positions) {
          const liq = BigInt(pos.liquidity);
          if (liq <= 0n) continue;

          // Actual token amounts via Uniswap v3 math
          const { amount0, amount1 } = amountsForPosition({
            liquidity: liq,
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
            sqrtPriceX96,
          });
          const usd =
            bigintToApproxNumber(amount0, t0Dec) * t0Usd +
            bigintToApproxNumber(amount1, t1Dec) * t1Usd;
          ownerTvl += usd;

          // Active liquidity (in-range at current tick)
          if (pos.tickLower <= currentTick && currentTick < pos.tickUpper) {
            ownerActive += liq;
          }
        }

        ownerTvls.set(addr, (ownerTvls.get(addr) ?? 0) + ownerTvl);
        ownerActiveLiqs.set(addr, (ownerActiveLiqs.get(addr) ?? 0n) + ownerActive);
        poolTotalTvlUsd += ownerTvl;
        poolActiveLiq += ownerActive;
      }

      for (const ownerGroup of row.positions) {
        const addr = ownerGroup.owner.toLowerCase();
        const existing = lpMap.get(addr);
        const ownerTvl = ownerTvls.get(addr) ?? 0;

        // Per-pool liq% (TVL-based) and vol% (active liquidity-based)
        const poolLiqPct =
          poolTotalTvlUsd > 0 ? (ownerTvl / poolTotalTvlUsd) * 100 : 0;

        const activeLiq = ownerActiveLiqs.get(addr) ?? 0n;
        const poolVolPct =
          poolActiveLiq > 0n
            ? (Number(activeLiq) / Number(poolActiveLiq)) * 100
            : 0;

        const poolEff = poolLiqPct > 0 ? poolVolPct / poolLiqPct : 0;

        if (existing) {
          // Only add TVL once per owner per pool (first ownerGroup wins)
          if (!existing.poolLabels.has(row.pool.label)) {
            existing.tvlUsd += ownerTvl;
            existing.poolLabels.add(row.pool.label);
            existing.perPool.push({ volPct: poolVolPct, liqPct: poolLiqPct, efficiency: poolEff });
          }
        } else {
          lpMap.set(addr, {
            tvlUsd: ownerTvl,
            poolLabels: new Set([row.pool.label]),
            perPool: [{ volPct: poolVolPct, liqPct: poolLiqPct, efficiency: poolEff }],
          });
        }
      }
    }

    // Sort by TVL descending
    const sorted = [...lpMap.entries()].sort(
      (a, b) => b[1].tvlUsd - a[1].tvlUsd
    );

    // Take top 10
    const top = sorted.slice(0, 10);

    const totalTvl = data.totalTVL;

    const rows: LPRow[] = top.map(([addr, info]) => {
      const liqPct = totalTvl > 0 ? (info.tvlUsd / totalTvl) * 100 : 0;

      // Average vol% and efficiency across the pools this LP participates in
      const n = info.perPool.length;
      const volPct = n > 0
        ? info.perPool.reduce((s, p) => s + p.volPct, 0) / n
        : 0;
      const efficiency = n > 0
        ? info.perPool.reduce((s, p) => s + p.efficiency, 0) / n
        : null;

      return {
        address: addr,
        displayAddr: formatLpLabel(addr, spaceSlug),
        pools: [...info.poolLabels].map((label) => ({
          label: label.split("/")[1]?.trim() ?? label,
          color: poolColorMap.get(label) ?? "#999",
        })),
        tvlUsd: info.tvlUsd,
        liqPct,
        volPct,
        efficiency,
      };
    });

    const tLPs = lpMap.size;
    const top5Tvl = sorted
      .slice(0, 5)
      .reduce((sum, [, info]) => sum + info.tvlUsd, 0);
    const t5Pct = totalTvl > 0 ? (top5Tvl / totalTvl) * 100 : 0;
    const crossPool = sorted.filter(
      ([, info]) => info.poolLabels.size >= 2
    ).length;

    return {
      lpRows: rows,
      totalLPs: tLPs,
      top5TvlPct: t5Pct,
      crossPoolCount: crossPool,
    };
  }, [data, spaceSlug]);

  return (
    <div className="bp-card relative flex flex-col">
      <div className="bp-card-inner" />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          LP Efficiency
        </span>
        <span className="text-[7.5px] text-gray-400">
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
            &bull;
          </span>{" "}
          &gt;1.2x{" "}
          <span className="text-gray-400 font-bold ml-1">&bull;</span> 0.8&ndash;1.2x{" "}
          <span className="text-red-600 dark:text-red-400 font-bold ml-1">
            &bull;
          </span>{" "}
          &lt;0.8x
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-[var(--bp-border-subtle)]">
              LP
            </th>
            <th className="text-left px-2 py-1 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-[var(--bp-border-subtle)]">
              Pools
            </th>
            <th className="text-right px-2 py-1 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-[var(--bp-border-subtle)]">
              TVL
            </th>
            <th className="text-right px-2 py-1 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-[var(--bp-border-subtle)]">
              Liq%
            </th>
            <th className="text-right px-2 py-1 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-[var(--bp-border-subtle)]">
              Vol%
            </th>
            <th className="text-right px-2 py-1 text-[8px] font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-[var(--bp-border-subtle)]">
              Eff.
            </th>
          </tr>
        </thead>
        <tbody>
          {lpRows.map((lp) => {
            const isHighlight = lp.efficiency !== null && lp.efficiency > 2;
            const effColor =
              lp.efficiency === null
                ? "text-gray-400"
                : lp.efficiency > 1.2
                  ? "text-emerald-600 dark:text-emerald-400"
                  : lp.efficiency >= 0.8
                    ? "text-gray-500"
                    : "text-red-500 dark:text-red-400";
            const effBg =
              lp.efficiency === null
                ? "bg-gray-50 dark:bg-gray-800"
                : lp.efficiency > 1.2
                  ? "bg-emerald-50 dark:bg-emerald-900/30"
                  : lp.efficiency >= 0.8
                    ? "bg-gray-50 dark:bg-gray-800"
                    : "bg-red-50 dark:bg-red-900/30";

            return (
              <tr
                key={lp.address}
                className={cn(
                  isHighlight && "bg-gray-50 dark:bg-gray-800/40"
                )}
              >
                <td
                  className={cn(
                    "px-2 py-1.5 text-[10px] border-b border-gray-100 dark:border-gray-800",
                    isHighlight
                      ? "text-gray-900 dark:text-gray-100 font-bold"
                      : "text-gray-700 dark:text-gray-300"
                  )}
                >
                  <LpLabel
                    address={lp.address}
                    spaceSlug={spaceSlug}
                    iconSize={14}
                    className="font-mono"
                    textClassName="font-semibold"
                  />
                </td>
                <td className="px-2 py-1.5 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap">
                  {lp.pools.map((pool) => (
                    <span
                      key={pool.label}
                      className="inline-block px-1 py-0 rounded text-[8px] font-semibold mr-0.5 border"
                      style={{
                        borderColor: `${pool.color}40`,
                        color: pool.color,
                        background: "var(--bp-bg-primary)",
                      }}
                    >
                      {pool.label}
                    </span>
                  ))}
                </td>
                <td className="px-2 py-1.5 text-right text-[10px] font-bold border-b border-gray-100 dark:border-gray-800">
                  {formatCompact(lp.tvlUsd)}
                </td>
                <td className="px-2 py-1.5 text-right text-[10px] border-b border-gray-100 dark:border-gray-800">
                  {lp.liqPct.toFixed(1)}%
                </td>
                <td className="px-2 py-1.5 text-right text-[10px] border-b border-gray-100 dark:border-gray-800">
                  {lp.volPct.toFixed(1)}%
                </td>
                <td className="px-2 py-1.5 text-right border-b border-gray-100 dark:border-gray-800">
                  <span
                    className={cn(
                      "inline-block px-1 rounded text-[10px] font-bold",
                      effColor,
                      effBg
                    )}
                  >
                    {lp.efficiency !== null
                      ? `${lp.efficiency.toFixed(2)}x`
                      : "\u2014"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex justify-between items-center mt-2 pt-2 border-t border-[var(--bp-border-subtle)]">
        <span className="text-[8px] text-gray-400">
          <span className="font-bold">{totalLPs}</span> LPs &middot; Top 5 ={" "}
          <span className="font-bold">{top5TvlPct.toFixed(1)}%</span> TVL
        </span>
        <span className="text-[8px] text-gray-700 dark:text-gray-300 font-semibold">
          {crossPoolCount} span 2+ pools
        </span>
      </div>
    </div>
  );
}
