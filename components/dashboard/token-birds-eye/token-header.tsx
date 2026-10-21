"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { formatCompact, type TokenDashboardData } from "@/hooks/use-token-dashboard-data";
import { isWorldchainSolanaSupportedPool } from "@/lib/pools";

interface TokenHeaderProps {
  data: TokenDashboardData;
}

export function TokenHeader({ data }: TokenHeaderProps) {
  const {
    tokenSymbol,
    tokenUsdPrice,
    priceChange24hPct,
    pools,
    totalTVL,
    total24hVolume,
    total24hFees,
    totalTxns,
    totalActiveLPs,
    maxSpreadPct,
    netFlow7dUsd,
    isLoading,
  } = data;

  const protocols = [
    ...new Set(
      pools.map((p) =>
        isWorldchainSolanaSupportedPool(p.pool)
          ? "SOLANA"
          : p.pool.protocol.toUpperCase()
      )
    ),
  ];

  const priceStr = tokenUsdPrice
    ? tokenUsdPrice >= 1
      ? `$${tokenUsdPrice.toFixed(4)}`
      : `$${tokenUsdPrice.toFixed(6)}`
    : "—";

  const netFlowStr = `${netFlow7dUsd >= 0 ? "+" : ""}${formatCompact(Math.abs(netFlow7dUsd))}`;

  const kpis: { label: string; value: string; color?: string }[] = [
    { label: "Total TVL", value: formatCompact(totalTVL) },
    { label: "24h Volume", value: formatCompact(total24hVolume) },
    { label: "24h Fees", value: formatCompact(total24hFees) },
    { label: "Txns", value: totalTxns.toLocaleString() },
    { label: "Active LPs", value: String(totalActiveLPs) },
    {
      label: "Max Spread",
      value: `${maxSpreadPct.toFixed(3)}%`,
      color:
        maxSpreadPct < 0.05
          ? "text-emerald-600 dark:text-emerald-400"
          : maxSpreadPct < 0.15
            ? "text-amber-600 dark:text-amber-400"
            : "text-red-600 dark:text-red-400",
    },
    {
      label: "Net TVL 7d",
      value: netFlowStr,
      color:
        netFlow7dUsd >= 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400",
    },
  ];

  return (
    <div className="flex gap-3 items-stretch">
      {/* Token Identity */}
      <div className="bp-card relative flex items-center gap-3 px-4 py-3 flex-shrink-0">
        <div className="bp-card-inner" />
        <span className="relative shrink-0 inline-block" style={{ width: 36, height: 36 }}>
          <TokenIcon symbol={tokenSymbol} className="!w-9 !h-9" />
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold text-gray-900 dark:text-white leading-tight">
              {tokenSymbol}
            </span>
            {!isLoading && (
              <span className="text-[13px] font-bold text-gray-900 dark:text-white">
                {priceStr}
              </span>
            )}
            {!isLoading && priceChange24hPct !== null && (
              <span
                className={cn(
                  "text-[9px] px-1 py-0.5 rounded font-bold leading-none",
                  priceChange24hPct >= 0
                    ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                )}
              >
                {priceChange24hPct >= 0 ? "+" : ""}
                {priceChange24hPct.toFixed(2)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {protocols.map((p) => (
              <span
                key={p}
                className="text-[8px] px-1 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-semibold rounded leading-none"
              >
                {p}
              </span>
            ))}
            <span className="text-[8px] px-1 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium rounded border border-gray-200 dark:border-gray-700 leading-none">
              {pools.length} Pool{pools.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="bp-card relative flex-1 flex items-stretch">
        <div className="bp-card-inner" />
        <div className="flex-1 grid grid-cols-7 divide-x divide-[var(--bp-border-subtle)]">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="flex flex-col justify-center px-3 py-3">
              <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider leading-none whitespace-nowrap">
                {kpi.label}
              </span>
              <span
                className={cn(
                  "text-lg font-bold tracking-tight leading-tight mt-1 whitespace-nowrap",
                  kpi.color ?? "text-gray-900 dark:text-white"
                )}
              >
                {isLoading ? "..." : kpi.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
