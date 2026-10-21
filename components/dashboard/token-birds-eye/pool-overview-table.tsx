"use client";

import React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { useTokenViewStore } from "@/stores/token-view-store";
import { formatCompact, type TokenDashboardData } from "@/hooks/use-token-dashboard-data";
import { formatFeeTier } from "@/hooks/use-pool-data";
import { isWorldchainSolanaSupportedPool } from "@/lib/pools";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

const POOL_COLORS = ["#4A6CF7", "#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899", "#10B981"];

interface PoolOverviewTableProps {
  data: TokenDashboardData;
  spaceSlug?: string | null;
}

export function PoolOverviewTable({ data, spaceSlug }: PoolOverviewTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setSelectedToken = useTokenViewStore((s) => s.setSelectedToken);

  const { pools, totalTVL, referencePoolKey, tokenUsdPrice, tokenSymbol } = data;
  const refPrice = tokenUsdPrice ?? 0;
  const oracleLabel = isDemoSpaceSlug(spaceSlug) ? "Demo Oracle" : "CoinGecko Oracle";

  const handlePoolClick = (poolKey: string) => {
    setSelectedToken(null);
    const next = new URLSearchParams(searchParams.toString());
    next.set("pool", poolKey);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="bp-card relative flex-shrink-0">
      <div className="bp-card-inner" />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          Pool Overview
        </span>
        {refPrice > 0 && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Ref:{" "}
            <span className="font-bold text-gray-900 dark:text-white">
              ${refPrice < 1 ? refPrice.toFixed(6) : refPrice.toFixed(4)}
            </span>{" "}
            ({tokenSymbol} {oracleLabel})
          </span>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Pool", "Fee", "TVL", "Share", "24h Vol", "Vol/TVL", "Depth ±2%", "Price", "Deviation"].map(
              (h) => (
                <th
                  key={h}
                  className="text-left px-2 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-[var(--bp-border-subtle)]"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {pools.map((row, idx) => {
            const color = POOL_COLORS[idx % POOL_COLORS.length];
            const sharePct = totalTVL > 0 ? (row.tvlUsd / totalTVL) * 100 : 0;
            const volTvl =
              row.tvlUsd > 0
                ? ((row.volume24hUsd / row.tvlUsd) * 100).toFixed(1)
                : "0.0";
            const volTvlNum = parseFloat(volTvl);
            const volTvlColor =
              volTvlNum > 1
                ? "text-emerald-600 dark:text-emerald-400"
                : volTvlNum > 0.3
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-gray-400";

            const depthColor =
              row.depthAt2PctUsd / (row.tvlUsd || 1) > 0.15
                ? "text-emerald-600 dark:text-emerald-400"
                : row.depthAt2PctUsd / (row.tvlUsd || 1) > 0.08
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-500 dark:text-red-400";

            const diff =
              refPrice > 0 ? ((row.priceUsd - refPrice) / refPrice) * 100 : 0;
            const absDiff = Math.abs(diff);
            const devColor =
              absDiff < 0.05
                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                : absDiff < 0.15
                  ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                  : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400";

            const highDeviation = absDiff >= 2;

            // Deviation bar width (clamped at 45px equivalent)
            const barWidth = Math.min(absDiff * 250, 45);
            const barLeft = diff >= 0 ? 50 : 50 - barWidth;

            const tokenSymbols = row.pool.label.split("/").map((s) => s.trim());
            const feeStr = formatFeeTier(row.poolData?.fee ?? 0);
            const isWorldchainSolanaPool = isWorldchainSolanaSupportedPool(row.pool);

            return (
              <tr
                key={row.pool.poolKey}
                className="cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
                onClick={() => handlePoolClick(row.pool.poolKey)}
              >
                <td className="px-2 py-2.5 font-bold text-[12px] whitespace-nowrap border-b border-gray-100 dark:border-gray-800">
                  <span
                    className="inline-block w-[5px] h-[5px] rounded-full mr-1.5 align-middle"
                    style={{ background: color }}
                  />
                  <span className="flex items-center gap-1 inline-flex">
                    {highDeviation && (
                      <span className="relative flex items-center justify-center w-4 h-4 -mr-0.5" title={`Price deviation: ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`}>
                        <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-30 animate-ping" />
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="w-3.5 h-3.5 text-red-500 dark:text-red-400 relative"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.345 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                    )}
                    {tokenSymbols.map((sym, index) => (
                      <span key={sym} className="relative shrink-0 inline-block" style={{ width: 22, height: 22 }}>
                        <TokenIcon
                          symbol={sym}
                          src={index === 0 ? row.pool.logo : undefined}
                          className="!w-[22px] !h-[22px]"
                        />
                      </span>
                    ))}
                    {row.pool.label}
                    {isWorldchainSolanaPool && (
                      <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        Solana
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-[11px] text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  {feeStr}
                </td>
                <td className="px-2 py-2.5 text-[12px] font-bold border-b border-gray-100 dark:border-gray-800">
                  {formatCompact(row.tvlUsd)}
                </td>
                <td className="px-2 py-2.5 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-[4px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${sharePct}%`,
                          background: color,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400">
                      {sharePct.toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-[12px] border-b border-gray-100 dark:border-gray-800">
                  {formatCompact(row.volume24hUsd)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2.5 text-[12px] font-semibold border-b border-gray-100 dark:border-gray-800",
                    volTvlColor
                  )}
                >
                  {volTvl}%
                </td>
                <td
                  className={cn(
                    "px-2 py-2.5 text-[12px] font-bold border-b border-gray-100 dark:border-gray-800",
                    depthColor
                  )}
                >
                  {formatCompact(row.depthAt2PctUsd)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2.5 text-[12px] font-bold font-mono border-b border-gray-100 dark:border-gray-800",
                    highDeviation && "bg-red-50/60 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                  )}
                >
                  {row.priceUsd > 0
                    ? `$${row.priceUsd < 1 ? row.priceUsd.toFixed(6) : row.priceUsd.toFixed(4)}`
                    : "—"}
                </td>
                <td
                  className={cn(
                    "px-2 py-2.5 border-b border-gray-100 dark:border-gray-800",
                    highDeviation && "bg-red-50/60 dark:bg-red-900/20"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded relative overflow-hidden min-w-[36px]">
                      <div className="absolute left-1/2 top-0 w-px h-full bg-gray-200 dark:bg-gray-700" />
                      <div
                        className="absolute top-0 h-full rounded opacity-50"
                        style={{
                          left: `${barLeft}%`,
                          width: `${barWidth}%`,
                          background:
                            absDiff < 0.05
                              ? "#10B981"
                              : absDiff < 0.15
                                ? "#F59E0B"
                                : "#EF4444",
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded min-w-[42px] text-center",
                        devColor
                      )}
                    >
                      {diff >= 0 ? "+" : ""}
                      {diff.toFixed(2)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
