"use client";

import React, { memo, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { useTokenViewStore } from "@/stores/token-view-store";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import { isWorldchainSolanaSupportedPool } from "@/lib/pools";
import { getPoolProtocolName } from "@/lib/pool-protocol-labels";
import { ChevronRight } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type SortKey = "tvl" | "depthBuy" | "depthSell" | "spread" | "peg";
type SortDir = "asc" | "desc";

interface AssetGroup {
  asset: string;
  pools: BirdsEyePoolCard[];
  tvlUsd: number;
  depthBuyUsd: number | null;
  depthSellUsd: number | null;
  bestSpreadPct: number | null;
  worstPegPct: number;
}

interface BirdsEyeTableProps {
  pools: BirdsEyePoolCard[];
  isLoading?: boolean;
}

// ─── Constants & helpers ────────────────────────────────────────────────────

const SORTABLE_COLUMNS: Record<string, SortKey> = {
  TVL: "tvl",
  "Depth (+2%)": "depthBuy",
  "Depth (-2%)": "depthSell",
  Spread: "spread",
  "Price Peg": "peg",
};

const METRIC_TEXT = "text-[11px] font-semibold font-mono text-gray-700 dark:text-gray-300";

const PEG_COLOR = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-500 dark:text-red-400",
} as const;

const COLUMNS = ["Asset", "TVL", "Depth (+2%)", "Depth (-2%)", "Spread", "Price Peg"];

function MetricSkeleton({ className }: { className?: string }) {
  return <div className={cn("h-4 w-20 bp-skeleton rounded", className)} />;
}

function getPegColor(pct: number, card?: BirdsEyePoolCard) {
  const absPct = Math.abs(pct);
  if (card) {
    const th = card.thresholds.priceDeviation;
    return absPct >= th.criticalPct ? PEG_COLOR.bad : absPct >= th.watchPct ? PEG_COLOR.warn : PEG_COLOR.ok;
  }
  return absPct >= 2 ? PEG_COLOR.bad : absPct >= 0.5 ? PEG_COLOR.warn : PEG_COLOR.ok;
}

function agoLabel(ts: number | null): string {
  if (ts === null || ts === 0) return "";
  const ago = Math.round((Date.now() - ts) / 1000);
  if (ago < 0) return "just now";
  if (ago < 60) return `${ago}s ago`;
  return `${Math.floor(ago / 60)}m ${ago % 60}s ago`;
}

function getGroupSortValue(g: AssetGroup, key: SortKey): number {
  switch (key) {
    case "tvl": return g.tvlUsd;
    case "depthBuy": return g.depthBuyUsd ?? -1;
    case "depthSell": return g.depthSellUsd ?? -1;
    case "spread": return g.bestSpreadPct ?? Infinity;
    case "peg": return Math.abs(g.worstPegPct);
  }
}

function getPoolSortValue(card: BirdsEyePoolCard, key: SortKey): number {
  switch (key) {
    case "tvl": return card.tvlUsd;
    case "depthBuy": return card.depthBuyAt2PctUsd ?? -1;
    case "depthSell": return card.depthSellAt2PctUsd ?? -1;
    case "spread": return card.effectiveSpreadPct ?? Infinity;
    case "peg": return Math.abs(card.pricePegPct);
  }
}

// ─── Sort header icon ───────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" className="ml-0.5 shrink-0">
      <path
        d="M5 1.5L8 4.5H2L5 1.5Z"
        className={cn(
          "transition-colors",
          active && dir === "asc" ? "fill-gray-700 dark:fill-gray-200" : "fill-gray-300 dark:fill-gray-600"
        )}
      />
      <path
        d="M5 10.5L2 7.5H8L5 10.5Z"
        className={cn(
          "transition-colors",
          active && dir === "desc" ? "fill-gray-700 dark:fill-gray-200" : "fill-gray-300 dark:fill-gray-600"
        )}
      />
    </svg>
  );
}

// ─── Asset group row ────────────────────────────────────────────────────────

function AssetGroupRow({
  group,
  sortKey,
  sortDir,
  defaultExpanded,
  isLoading,
}: {
  group: AssetGroup;
  sortKey: SortKey;
  sortDir: SortDir;
  defaultExpanded: boolean;
  isLoading: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const setSelectedToken = useTokenViewStore((s) => s.setSelectedToken);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const anyLoading = isLoading || group.pools.some((p) => p.isLoading);
  const worstStatus = group.pools.some((p) => p.status === "critical")
    ? "critical"
    : group.pools.some((p) => p.status === "watch")
      ? "watch"
      : "ok";

  const sortedPools = useMemo(() => {
    return [...group.pools].sort((a, b) => {
      const va = getPoolSortValue(a, sortKey);
      const vb = getPoolSortValue(b, sortKey);
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [group.pools, sortKey, sortDir]);

  const handlePoolClick = (card: BirdsEyePoolCard) => {
    setSelectedToken(null);
    const next = new URLSearchParams();
    next.set("pool", card.pool.poolKey);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <>
      {/* ── Summary row ──────────────────────────────────────────────────── */}
      <tr
        className={cn(
          "border-b border-gray-200/80 dark:border-gray-700/60 transition-colors cursor-pointer select-none",
          "bg-gray-100/90 dark:bg-gray-800/70",
          worstStatus === "critical"
            ? "bg-red-500/10 hover:bg-red-500/20"
            : worstStatus === "watch"
              ? "bg-amber-500/10 hover:bg-amber-500/20"
              : "hover:bg-gray-200/80 dark:hover:bg-gray-700/60"
        )}
        onClick={() => !anyLoading && setExpanded((e) => !e)}
      >
        {/* Asset */}
        <td className="px-3 py-2.5 w-[280px] min-w-[280px]">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "w-3.5 h-3.5 text-gray-400 transition-transform duration-200",
                expanded && "rotate-90",
                anyLoading && "opacity-0"
              )}
            />
            <span className="relative shrink-0 inline-block" style={{ width: 22, height: 22 }}>
              <TokenIcon symbol={group.asset} className="!w-[22px] !h-[22px]" />
            </span>
            <span className="text-[12px] font-bold font-mono text-gray-900 dark:text-white">
              {group.asset}
            </span>
          </div>
        </td>

        {/* TVL */}
        <td className="px-3 py-2.5">
          {anyLoading ? (
            <MetricSkeleton />
          ) : (
            <span className={cn(METRIC_TEXT, "font-bold")}>{formatCompact(group.tvlUsd)}</span>
          )}
        </td>

        {/* Depth (+2%) */}
        <td className="px-3 py-2.5">
          {anyLoading ? (
            <MetricSkeleton />
          ) : (
            <span className={cn(METRIC_TEXT, "font-bold")}>
              {group.depthBuyUsd === null ? "—" : formatCompact(group.depthBuyUsd)}
            </span>
          )}
        </td>

        {/* Depth (-2%) */}
        <td className="px-3 py-2.5">
          {anyLoading ? (
            <MetricSkeleton />
          ) : (
            <span className={cn(METRIC_TEXT, "font-bold")}>
              {group.depthSellUsd === null ? "—" : formatCompact(group.depthSellUsd)}
            </span>
          )}
        </td>

        {/* Spread (best across pools) */}
        <td className="px-3 py-2.5">
          {anyLoading ? (
            <MetricSkeleton className="w-16" />
          ) : (
            <span className={cn(METRIC_TEXT, "font-bold")}>
              {group.bestSpreadPct === null ? "—" : `${group.bestSpreadPct.toFixed(2)}%`}
            </span>
          )}
        </td>

        {/* Price Peg (worst) */}
        <td className="px-3 py-2.5">
          {anyLoading ? (
            <MetricSkeleton className="w-16" />
          ) : (
            <span className={cn("text-[11px] font-semibold font-mono", getPegColor(group.worstPegPct))}>
              {group.worstPegPct >= 0 ? "+" : ""}
              {group.worstPegPct.toFixed(2)}%
            </span>
          )}
        </td>
      </tr>

      {/* ── Expanded: individual pools ───────────────────────────────────── */}
      {expanded &&
        sortedPools.map((card) => {
          if (anyLoading || card.isLoading) {
            return (
              <tr key={card.pool.poolKey} className="border-b border-gray-100/60 dark:border-gray-800/40">
                <td colSpan={6} className="px-3 py-2 pl-10">
                  <div className="h-4 w-32 bp-skeleton rounded" />
                </td>
              </tr>
            );
          }

          const proto = getPoolProtocolName(card.pool);
          const isWorldchainSolanaPool = isWorldchainSolanaSupportedPool(card.pool);

          return (
            <tr
              key={card.pool.poolKey}
              onClick={() => handlePoolClick(card)}
              className="border-b border-gray-100/60 dark:border-gray-800/40 bg-gray-50/60 dark:bg-gray-900/30 cursor-pointer transition-colors hover:bg-gray-100/80 dark:hover:bg-gray-800/50"
            >
              {/* Pool + Protocol */}
              <td className="px-3 py-1.5 pl-10">
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-400">
                    {card.pool.label}
                  </span>
                  <span className="text-[8px] font-medium px-1 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">
                    {proto}
                  </span>
                  <span className="text-[8px] text-gray-400 dark:text-gray-500">
                    {card.feeTier}
                  </span>
                  {isWorldchainSolanaPool && (
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                      Solana
                    </span>
                  )}
                </div>
              </td>

              {/* TVL */}
              <td className="px-3 py-1.5">
                <span className={METRIC_TEXT}>{formatCompact(card.tvlUsd)}</span>
              </td>

              {/* Depth (+2%) */}
              <td className="px-3 py-1.5">
                <span className={METRIC_TEXT}>
                  {card.depthBuyAt2PctUsd === null ? "—" : formatCompact(card.depthBuyAt2PctUsd)}
                </span>
              </td>

              {/* Depth (-2%) */}
              <td className="px-3 py-1.5">
                <span className={METRIC_TEXT}>
                  {card.depthSellAt2PctUsd === null ? "—" : formatCompact(card.depthSellAt2PctUsd)}
                </span>
              </td>

              {/* Pool-level AMM spread */}
              <td className="px-3 py-1.5">
                <span className={METRIC_TEXT}>
                  {card.effectiveSpreadPct === null
                    ? card.feeTier
                    : `${card.effectiveSpreadPct.toFixed(2)}%`}
                </span>
              </td>

              {/* Price Peg */}
              <td className="px-3 py-1.5">
                <div className="flex flex-col">
                  <span className={cn("text-[11px] font-semibold font-mono", getPegColor(card.pricePegPct, card))}>
                    {card.pricePegPct >= 0 ? "+" : ""}
                    {card.pricePegPct.toFixed(2)}%
                  </span>
                  {card.rpcFetchedAt ? (
                    <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500">
                      {agoLabel(card.rpcFetchedAt)}
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
    </>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

export const BirdsEyeTable = memo(function BirdsEyeTable({ pools, isLoading = false }: BirdsEyeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("tvl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Group pools by asset
  const groups = useMemo(() => {
    const map = new Map<string, BirdsEyePoolCard[]>();
    for (const pool of pools) {
      const key = pool.trackedAsset;
      const arr = map.get(key) ?? [];
      arr.push(pool);
      map.set(key, arr);
    }

    const result: AssetGroup[] = Array.from(map.entries()).map(([asset, assetPools]) => {
      const tvlUsd = assetPools.reduce((s, p) => s + p.tvlUsd, 0);

      const buyDepths = assetPools.map((p) => p.depthBuyAt2PctUsd).filter((v): v is number => v !== null);
      const depthBuyUsd = buyDepths.length > 0 ? buyDepths.reduce((s, v) => s + v, 0) : null;

      const sellDepths = assetPools.map((p) => p.depthSellAt2PctUsd).filter((v): v is number => v !== null);
      const depthSellUsd = sellDepths.length > 0 ? sellDepths.reduce((s, v) => s + v, 0) : null;

      const spreads = assetPools.map((p) => p.effectiveSpreadPct).filter((v): v is number => v !== null);
      const bestSpreadPct = spreads.length > 0 ? Math.min(...spreads) : null;

      // Worst peg = highest absolute deviation, keeping sign
      const worstPool = assetPools.reduce((worst, p) =>
        Math.abs(p.pricePegPct) > Math.abs(worst.pricePegPct) ? p : worst
      );
      const worstPegPct = worstPool.pricePegPct;

      return {
        asset,
        pools: assetPools,
        tvlUsd,
        depthBuyUsd,
        depthSellUsd,
        bestSpreadPct,
        worstPegPct,
      };
    });

    result.sort((a, b) => {
      const va = getGroupSortValue(a, sortKey);
      const vb = getGroupSortValue(b, sortKey);
      return sortDir === "desc" ? vb - va : va - vb;
    });

    return result;
  }, [pools, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            {COLUMNS.map((h) => {
              const sk = SORTABLE_COLUMNS[h];
              return (
                <th
                  key={h}
                  onClick={sk ? () => handleSort(sk) : undefined}
                  className={cn(
                    "px-3 py-2.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap",
                    sk && "cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  )}
                >
                  <span
                    className="inline-flex items-center gap-1"
                    title={
                      h === "Spread"
                        ? "Best pool spread across all pools (fee × 2 + $10k price impact)"
                        : h === "Price Peg"
                          ? "Pool price deviation vs Kraken USD price"
                          : undefined
                    }
                  >
                    {h}
                    {sk && <SortIcon active={sortKey === sk} dir={sortDir} />}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groups.map((group, i) => (
            <AssetGroupRow
              key={group.asset}
              group={group}
              sortKey={sortKey}
              sortDir={sortDir}
              defaultExpanded={i === 0}
              isLoading={isLoading}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});
