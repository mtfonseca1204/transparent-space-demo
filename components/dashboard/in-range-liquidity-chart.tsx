"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { PositionData } from "@/lib/envio-client";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import { LP_COLORS, OTHERS_COLOR } from "@/components/custom-metrics/metric-colors";
import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";

interface OwnerPositions {
  owner: string;
  positions: PositionData[];
}

interface InRangeLiquidityChartProps {
  positionsByOwner: OwnerPositions[];
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  // Authoritative pool TVL (token balances * USD). Used as the denominator
  // for the "% of TVL" counter so it lines up with the rest of the dashboard.
  poolTvlUsd?: number | null;
  spaceSlug?: string | null;
  className?: string;
}

const MAX_VISIBLE_LPS = 10;

interface OwnerInRangeRow {
  owner: string;
  usd: number;
  positionCount: number;
  color: string;
  isOthers: boolean;
  othersCount?: number;
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUsdFull(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export const InRangeLiquidityChart = ({
  positionsByOwner,
  currentTick,
  sqrtPriceX96,
  token0Decimals,
  token1Decimals,
  token0UsdPrice,
  token1UsdPrice,
  poolTvlUsd,
  spaceSlug,
  className,
}: InRangeLiquidityChartProps) => {
  const t0Usd =
    typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
      ? token0UsdPrice
      : 0;
  const t1Usd =
    typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
      ? token1UsdPrice
      : 0;

  const { totalInRangeUsd, ownerRows, totalActivePositions, totalActiveLps } =
    useMemo(() => {
      if (!positionsByOwner || positionsByOwner.length === 0) {
        return {
          totalInRangeUsd: 0,
          ownerRows: [] as OwnerInRangeRow[],
          totalActivePositions: 0,
          totalActiveLps: 0,
        };
      }

      let sqrtPx96: bigint;
      try {
        sqrtPx96 = BigInt(sqrtPriceX96);
      } catch {
        sqrtPx96 = 0n;
      }

      const owners: { owner: string; usd: number; positionCount: number }[] = [];
      let total = 0;
      let activePositions = 0;

      for (const ownerData of positionsByOwner) {
        let ownerUsd = 0;
        let ownerActiveCount = 0;
        for (const p of ownerData.positions) {
          if (!(p.tickLower <= currentTick && currentTick < p.tickUpper)) continue;
          let liq: bigint;
          try {
            liq = BigInt(p.liquidity);
          } catch {
            continue;
          }
          if (liq <= 0n) continue;

          const { amount0, amount1 } = amountsForPosition({
            liquidity: liq,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            sqrtPriceX96: sqrtPx96,
          });
          const amt0 = bigintToApproxNumber(amount0, token0Decimals);
          const amt1 = bigintToApproxNumber(amount1, token1Decimals);
          ownerUsd += amt0 * t0Usd + amt1 * t1Usd;
          ownerActiveCount += 1;
        }

        if (ownerUsd > 0) {
          owners.push({
            owner: ownerData.owner,
            usd: ownerUsd,
            positionCount: ownerActiveCount,
          });
          total += ownerUsd;
          activePositions += ownerActiveCount;
        }
      }

      owners.sort((a, b) => b.usd - a.usd);

      const rows: OwnerInRangeRow[] = [];
      const visible = owners.slice(0, MAX_VISIBLE_LPS);
      visible.forEach((entry, idx) => {
        rows.push({
          owner: entry.owner,
          usd: entry.usd,
          positionCount: entry.positionCount,
          color: LP_COLORS[idx % LP_COLORS.length],
          isOthers: false,
        });
      });

      if (owners.length > MAX_VISIBLE_LPS) {
        const tail = owners.slice(MAX_VISIBLE_LPS);
        const othersUsd = tail.reduce((acc, entry) => acc + entry.usd, 0);
        const othersPositions = tail.reduce(
          (acc, entry) => acc + entry.positionCount,
          0
        );
        if (othersUsd > 0) {
          rows.push({
            owner: "Others",
            usd: othersUsd,
            positionCount: othersPositions,
            color: OTHERS_COLOR,
            isOthers: true,
            othersCount: tail.length,
          });
        }
      }

      return {
        totalInRangeUsd: total,
        ownerRows: rows,
        totalActivePositions: activePositions,
        totalActiveLps: owners.length,
      };
    }, [
      positionsByOwner,
      currentTick,
      sqrtPriceX96,
      token0Decimals,
      token1Decimals,
      t0Usd,
      t1Usd,
    ]);

  const denominatorTvl =
    typeof poolTvlUsd === "number" && Number.isFinite(poolTvlUsd) && poolTvlUsd > 0
      ? poolTvlUsd
      : totalInRangeUsd; // fallback so the bar still renders meaningful pct
  const pctOfTvl =
    denominatorTvl > 0
      ? Math.min(100, (totalInRangeUsd / denominatorTvl) * 100)
      : 0;

  const maxOwnerUsd = ownerRows.reduce((m, r) => Math.max(m, r.usd), 0);

  if (ownerRows.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full text-sm text-gray-400",
          className
        )}
      >
        No LP positions are currently in range
      </div>
    );
  }

  return (
    <div className={cn("h-full flex gap-5 min-h-0", className)}>
      {/* LEFT: counter */}
      <div className="w-44 shrink-0 flex flex-col justify-center pr-5 border-r border-gray-200">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
          In-Range TVL
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
          {formatUsdCompact(totalInRangeUsd)}
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
          {formatUsdFull(totalInRangeUsd)}
        </div>

        <div className="mt-4">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold tabular-nums text-gray-900">
              {pctOfTvl.toFixed(1)}%
            </span>
            <span className="text-[10px] text-gray-500">of pool TVL</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full"
              style={{ width: `${pctOfTvl}%` }}
            />
          </div>
        </div>

        <div className="mt-4 text-[10px] text-gray-400 tabular-nums">
          {totalActiveLps} active {totalActiveLps === 1 ? "LP" : "LPs"} ·{" "}
          {totalActivePositions}{" "}
          {totalActivePositions === 1 ? "position" : "positions"}
        </div>
      </div>

      {/* RIGHT: chart - horizontal bars per LP */}
      <div className="flex-1 min-w-0 flex flex-col gap-1 overflow-y-auto pr-1">
        {ownerRows.map((row) => {
          const meta = row.isOthers ? undefined : getLpMeta(row.owner, spaceSlug);
          const label = row.isOthers
            ? `Others (${row.othersCount ?? 0})`
            : formatLpLabel(row.owner, spaceSlug);
          const barPct = maxOwnerUsd > 0 ? (row.usd / maxOwnerUsd) * 100 : 0;
          const sharePct =
            totalInRangeUsd > 0 ? (row.usd / totalInRangeUsd) * 100 : 0;

          return (
            <div
              key={row.owner}
              className="flex items-center gap-2 text-[11px]"
            >
              <div className="flex items-center gap-1.5 w-28 shrink-0">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                {meta?.logoSrc && (
                  <img
                    src={meta.logoSrc}
                    alt={`${meta.label} logo`}
                    className="w-3 h-3 rounded-sm shrink-0"
                    loading="lazy"
                  />
                )}
                <span
                  className="text-gray-600 truncate"
                  style={{ fontFamily: "var(--bp-font-mono)" }}
                  title={row.isOthers ? label : row.owner}
                >
                  {label}
                </span>
              </div>
              <div className="flex-1 min-w-0 h-3 bg-gray-100 rounded-sm overflow-hidden">
                <div
                  className="h-full chart-bar-grain"
                  style={{
                    width: `${Math.max(0.5, barPct)}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
              <div className="w-16 shrink-0 text-right tabular-nums text-gray-700 font-medium">
                {formatUsdCompact(row.usd)}
              </div>
              <div className="w-10 shrink-0 text-right tabular-nums text-gray-400">
                {sharePct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InRangeLiquidityChart;
