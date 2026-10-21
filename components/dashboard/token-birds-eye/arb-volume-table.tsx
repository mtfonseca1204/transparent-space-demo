"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useArbVolume, type ArbVolumePool } from "@/hooks/use-arb-volume";
import type { PoolMetricsRow } from "@/hooks/use-token-dashboard-data";
import { formatFeeTier } from "@/hooks/use-pool-data";

const POOL_COLORS = ["#4A6CF7", "#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899", "#10B981"];

function formatVol(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${value.toFixed(0)}`;
}

function arbPctColor(pct: number): string {
  if (pct >= 70) return "text-red-600 dark:text-red-400";
  if (pct >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

interface ArbVolumeTableProps {
  poolRows: PoolMetricsRow[];
  trackedTokenSymbol: string;
  spaceSlug?: string | null;
}

const ARB_PCT_PRICE_DISCOVERY_THRESHOLD = 35;

export function ArbVolumeTable({ poolRows, trackedTokenSymbol, spaceSlug }: ArbVolumeTableProps) {
  const { data: arbData, isLoading } = useArbVolume(trackedTokenSymbol, spaceSlug);

  // Build a map from poolAddress → arb data for quick lookup
  const arbByPool = new Map<string, ArbVolumePool>();
  if (arbData) {
    for (const p of arbData.pools) {
      arbByPool.set(p.poolAddress, p);
    }
  }

  // Find the pool with the lowest arb % that has meaningful volume — "Price Discovery" pool
  const priceDiscoveryPool = arbData?.pools
    .filter((p) => p.totalVolumeUsd > 0 && p.totalSwaps > 0)
    .reduce<ArbVolumePool | null>(
      (best, p) => (!best || p.arbPct < best.arbPct ? p : best),
      null,
    );

  return (
    <div className="bp-card relative flex flex-col min-w-0 overflow-hidden">
      <div className="bp-card-inner" />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          Arb Volume (7d)
        </span>
        {arbData && arbData.hlCandleCount > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            vs{" "}
            <span className="font-bold text-gray-600 dark:text-gray-300">
              {arbData.hlCoin}
            </span>{" "}
            ({arbData.hlCandleCount.toLocaleString()} candles)
          </span>
        )}
        {arbData && arbData.hlCandleCount === 0 && (
          <span className="text-[10px] text-amber-500">
            No Hyperliquid perp data
          </span>
        )}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {[
              "Pool",
              "Swaps",
              "Arb Swaps",
              "Total Vol (7d)",
              "Arb Vol (7d)",
              "Organic Vol",
              "Arb %",
              "Distribution",
            ].map((h) => (
              <th
                key={h}
                className={cn(
                  "px-2 py-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b-2 border-[var(--bp-border-subtle)]",
                  h !== "Pool" && h !== "Distribution" ? "text-right" : "text-left"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={8} className="text-center py-6 text-gray-400 text-sm">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto" />
              </td>
            </tr>
          ) : (
            poolRows.map((row, idx) => {
              const arb = arbByPool.get(row.pool.poolKey);
              const color = POOL_COLORS[idx % POOL_COLORS.length];
              const feeStr = formatFeeTier(row.poolData?.fee ?? 0);

              const totalSwaps = arb?.totalSwaps ?? 0;
              const arbSwaps = arb?.arbSwaps ?? 0;
              const totalVol = arb?.totalVolumeUsd ?? 0;
              const arbVol = arb?.arbVolumeUsd ?? 0;
              const organicVol = arb?.organicVolumeUsd ?? 0;
              const arbPct = arb?.arbPct ?? 0;

              const isPriceDiscovery =
                priceDiscoveryPool &&
                arb?.poolAddress === priceDiscoveryPool.poolAddress &&
                priceDiscoveryPool.arbPct < ARB_PCT_PRICE_DISCOVERY_THRESHOLD;

              const isArbRoute = arb && arb.arbPct >= 70 && totalVol > 0;

              return (
                <tr key={row.pool.poolKey}>
                  <td className="px-2 py-3 font-bold text-[12px] whitespace-nowrap border-b border-gray-100 dark:border-gray-800">
                    <span
                      className="inline-block w-[5px] h-[5px] rounded-full mr-1.5 align-middle"
                      style={{ background: color }}
                    />
                    <div className="flex items-center gap-1.5">
                      {row.pool.label}
                      {isPriceDiscovery && (
                        <span
                          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[8px] font-bold leading-none text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 uppercase tracking-wide"
                          title="Lowest arb % — most volume is organic price discovery"
                        >
                          Price Discovery
                        </span>
                      )}
                      {isArbRoute && !isPriceDiscovery && (
                        <span
                          className="rounded bg-red-50 px-1.5 py-0.5 text-[8px] font-bold leading-none text-red-600 dark:bg-red-950/40 dark:text-red-400 uppercase tracking-wide"
                          title="70%+ of volume is arbitrage"
                        >
                          Arb Route
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-400 font-medium">
                      {arb?.venue ?? "—"} · {feeStr}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right text-[12px] font-mono border-b border-gray-100 dark:border-gray-800">
                    {totalSwaps.toLocaleString()}
                  </td>
                  <td className="px-2 py-3 text-right text-[12px] font-mono border-b border-gray-100 dark:border-gray-800">
                    {arbSwaps.toLocaleString()}
                  </td>
                  <td className="px-2 py-3 text-right text-[12px] font-bold border-b border-gray-100 dark:border-gray-800">
                    {formatVol(totalVol)}
                  </td>
                  <td className="px-2 py-3 text-right text-[12px] font-bold border-b border-gray-100 dark:border-gray-800">
                    {formatVol(arbVol)}
                  </td>
                  <td className="px-2 py-3 text-right text-[12px] font-bold border-b border-gray-100 dark:border-gray-800">
                    {formatVol(organicVol)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-3 text-right text-[12px] font-bold border-b border-gray-100 dark:border-gray-800",
                      arbPctColor(arbPct)
                    )}
                  >
                    {arbPct.toFixed(2)}%
                  </td>
                  <td className="px-2 py-3 border-b border-gray-100 dark:border-gray-800">
                    {totalVol > 0 ? (
                      <div className="flex items-center gap-1">
                        <div className="flex h-[10px] w-[80px] rounded overflow-hidden">
                          <div
                            className="h-full bg-red-400 dark:bg-red-500"
                            style={{ width: `${arbPct}%` }}
                          />
                          <div
                            className="h-full bg-emerald-400 dark:bg-emerald-500"
                            style={{ width: `${100 - arbPct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
