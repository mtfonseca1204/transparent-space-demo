"use client";

import React, { memo, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useKatanaMerklIncentives } from "@/hooks/use-katana-merkl-incentives";
import { useKatanaMerklOpportunity } from "@/hooks/use-katana-merkl-opportunity";
import { getAddressExplorerUrl, KATANA_SPACE_SLUG } from "@/lib/space-policy";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import { ArrowUpRight } from "lucide-react";
import { KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY } from "@/lib/pools";
import { usePoolData } from "@/hooks/use-pool-data";
import { useAllPoolPositions } from "@/hooks/use-lp-historical-data";
import { useTokenPrices } from "@/hooks/use-token-price";
import {
  flattenPositions,
  useLiquidityDistribution,
} from "@/hooks/use-liquidity-distribution";
import {
  LPDistributionComparisonChart,
  type LPDistributionComparisonChartHandle,
} from "@/components/dashboard/lp-distribution-comparison-chart";
import {
  BirdsEyeKatanaTvlChart,
  type CampaignWindow,
} from "./birds-eye-katana-tvl-chart";

type SortKey = "amount" | "share" | "claimed" | "pending" | "positions";
type SortDir = "asc" | "desc";

const METRIC_TEXT = "text-[11px] font-semibold font-mono text-gray-700 dark:text-gray-300";
const HEADER_TEXT =
  "text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400";

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Compact unitless number — like formatCompact but without the leading $. */
function formatNumberCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toFixed(0);
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1000) return formatNumberCompact(n);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  // formatCompact already includes the leading $
  if (n >= 1000) return formatCompact(n);
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0";
  return `$${n.toFixed(3)}`;
}

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white/60 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="text-[9px] uppercase tracking-[0.18em] font-semibold text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div
        className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export const BirdsEyeKatanaIncentives = memo(function BirdsEyeKatanaIncentives() {
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAll, setShowAll] = useState(false);
  // Always pull the full recipient set (up to 500) so the chart can paint every
  // LP wallet earning rewards, regardless of how the table is currently sorted
  // or paginated. Server-side aggregation is independent of the limit.
  const { data, isLoading, error } = useKatanaMerklIncentives({
    enabled: true,
    limit: 500,
  });

  // Full Merkl opportunity = every campaign Merkl has indexed on this pool
  // (past only — Merkl flips an opportunity to PAST once its latest campaign
  // closes, even when our recipients endpoint is still tracking one as live).
  // We treat the recipients-endpoint campaign as the source of truth for
  // "live" and the opportunity feed as the source of past campaigns.
  const { data: opportunity } = useKatanaMerklOpportunity();
  const pastCampaigns = useMemo(() => {
    if (!opportunity?.campaigns) return [];
    return opportunity.campaigns
      .filter((c) => c.campaignId !== data?.campaign.campaignId)
      .filter((c) => c.endTimestamp <= (data?.campaign.startTimestamp ?? Number.MAX_SAFE_INTEGER))
      .sort((a, b) => b.endTimestamp - a.endTimestamp);
  }, [opportunity?.campaigns, data?.campaign.campaignId, data?.campaign.startTimestamp]);

  // Liquidity-distribution chart data: the Katana pilot Merkl campaign sits on a
  // single Sushi V3 pool, so we fetch every active position on that pool and
  // highlight (light blue) the ones owned by wallets in the Liquidity Providers
  // table; the rest of the pool's liquidity is shaded grey as "Other LPs".
  const poolKey = KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY;
  const { data: poolData } = usePoolData(poolKey);
  const { data: positionsByOwner } = useAllPoolPositions(poolKey, true);
  const tokenPriceMap = useTokenPrices([
    poolData?.token0Address,
    poolData?.token1Address,
  ]);
  const allPositions = useMemo(
    () => flattenPositions(positionsByOwner ?? null),
    [positionsByOwner]
  );
  // Set of addresses we consider "campaign LPs" for the Liquidity Distribution
  // and TVL charts:
  //   - every recipient wallet earning rewards, AND
  //   - every wrapper contract that holds positions on behalf of those wallets
  //     (e.g. SushiStaker on Katana). Without the wrappers, positions wrapped
  //     by Sushi would show up as "Other LPs" since their on-chain owner is
  //     the staker contract, not the recipient wallet.
  const recipientAddressSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.recipients ?? []) set.add(r.recipient.toLowerCase());
    for (const w of data?.wrapperAddresses ?? []) set.add(w.toLowerCase());
    return set;
  }, [data?.recipients, data?.wrapperAddresses]);
  const selectedPositions = useMemo(
    () =>
      recipientAddressSet.size === 0
        ? []
        : allPositions.filter((p) => recipientAddressSet.has(p.owner.toLowerCase())),
    [allPositions, recipientAddressSet]
  );
  const token0UsdPrice = poolData?.token0Address
    ? tokenPriceMap.data?.[poolData.token0Address.toLowerCase()] ?? null
    : null;
  const token1UsdPrice = poolData?.token1Address
    ? tokenPriceMap.data?.[poolData.token1Address.toLowerCase()] ?? null
    : null;
  const { bars: liquidityDistributionBars, useUsd: liquidityDistributionUseUsd } =
    useLiquidityDistribution({
      allPositions: allPositions.length > 0 ? allPositions : undefined,
      currentPrice: poolData?.currentPrice ?? 0,
      currentTick: poolData?.tick ?? 0,
      currentLiquidity: poolData?.liquidity ?? "0",
      token0Decimals: poolData?.token0Decimals,
      token1Decimals: poolData?.token1Decimals,
      token0UsdPrice,
      token1UsdPrice,
      tickSpacing: poolData?.tickSpacing,
      zoomLevel: 0,
    });
  const liquidityChartRef = useRef<LPDistributionComparisonChartHandle>(null);

  const sortedPositionRows = useMemo(() => {
    if (!data?.positionRows) return [];
    const rows = [...data.positionRows];
    rows.sort((a, b) => {
      const mult = sortDir === "desc" ? -1 : 1;
      switch (sortKey) {
        case "amount":
          return (a.amountTokens - b.amountTokens) * mult;
        case "share":
          return (a.shareOfCampaignPct - b.shareOfCampaignPct) * mult;
        case "claimed":
          return (a.claimedAmountTokens - b.claimedAmountTokens) * mult;
        case "pending":
          return (a.pendingAmountTokens - b.pendingAmountTokens) * mult;
        case "positions":
          // No-op for per-position rows; fall back to amount.
          return (a.amountTokens - b.amountTokens) * mult;
      }
    });
    return rows;
  }, [data?.positionRows, sortKey, sortDir]);

  const visiblePositionRows = showAll ? sortedPositionRows : sortedPositionRows.slice(0, 50);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 py-12 md:px-6">
        <div className="bp-skeleton h-32 w-full rounded-lg" />
        <div className="bp-skeleton mt-4 h-96 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-12 md:px-6">
        <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          Failed to load Merkl incentive data: {error?.message ?? "no data returned"}
        </div>
      </div>
    );
  }

  const { campaign, pool, totals } = data;
  const totalRecipientCount = totals.recipientCount;
  const rewardSymbol = campaign.rewardToken.symbol;
  const tokenPrice = campaign.rewardToken.price ?? 0;
  const claimedPct =
    totals.distributedTokens > 0 ? (totals.claimedTokens / totals.distributedTokens) * 100 : 0;
  const distributedPct =
    campaign.budgetTokens > 0 ? (totals.distributedTokens / campaign.budgetTokens) * 100 : 0;

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      {/* ── Campaign TVL over time ──────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white/60 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="flex items-baseline justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
              Campaign TVL Over Time
            </h3>
            <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
              {formatDate(campaign.startTimestamp)} → {formatDate(campaign.endTimestamp)} ·
              {" "}LPs earning {rewardSymbol} vs the rest of the pool
            </p>
          </div>
          {(() => {
            const nowSec = Math.floor(Date.now() / 1000);
            if (nowSec < campaign.startTimestamp) {
              const days = Math.ceil((campaign.startTimestamp - nowSec) / 86400);
              return (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  Starts in {days}d
                </span>
              );
            }
            if (nowSec >= campaign.startTimestamp && nowSec <= campaign.endTimestamp) {
              const days = Math.max(0, Math.ceil((campaign.endTimestamp - nowSec) / 86400));
              return (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live · ends in {days}d
                </span>
              );
            }
            return (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                Ended
              </span>
            );
          })()}
        </div>
        <div className="h-[280px] px-4 py-3">
          <BirdsEyeKatanaTvlChart
            poolKey={poolKey}
            poolData={poolData}
            token0UsdPrice={token0UsdPrice}
            token1UsdPrice={token1UsdPrice}
            recipientAddressSet={recipientAddressSet}
            campaigns={(() => {
              const nowSec = Math.floor(Date.now() / 1000);
              const trackedIsLive =
                nowSec >= campaign.startTimestamp && nowSec <= campaign.endTimestamp;
              const tracked: CampaignWindow = {
                campaignId: campaign.campaignId,
                start: campaign.startTimestamp,
                end: campaign.endTimestamp,
                isLive: trackedIsLive,
                rewardSymbol,
              };
              const previous: CampaignWindow[] = pastCampaigns[0]
                ? [
                    {
                      campaignId: pastCampaigns[0].campaignId,
                      start: pastCampaigns[0].startTimestamp,
                      end: pastCampaigns[0].endTimestamp,
                      isLive: false,
                      rewardSymbol: pastCampaigns[0].rewardToken?.symbol,
                    },
                  ]
                : [];
              return [...previous, tracked];
            })()}
            rewardSymbol={rewardSymbol}
            className="h-full"
          />
        </div>
      </div>

      {/* ── Past campaigns ──────────────────────────────────────────────── */}
      {pastCampaigns.length > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white/40 dark:border-gray-700 dark:bg-gray-900/30">
          <div className="flex items-baseline justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
              Past Campaigns
            </h3>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {pastCampaigns.length} previous · same pool
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className={cn(HEADER_TEXT, "px-3 py-2 text-left")}>Window</th>
                  <th className={cn(HEADER_TEXT, "px-3 py-2 text-left")}>Reward</th>
                  <th className={cn(HEADER_TEXT, "px-3 py-2 text-right")}>Daily rewards</th>
                  <th className={cn(HEADER_TEXT, "px-3 py-2 text-right")}>Total spent</th>
                  <th className={cn(HEADER_TEXT, "px-3 py-2 text-right")}>Duration</th>
                  <th className={cn(HEADER_TEXT, "px-3 py-2 w-10")} />
                </tr>
              </thead>
              <tbody>
                {pastCampaigns.map((c) => {
                  const durationDays = Math.max(
                    0,
                    Math.round((c.endTimestamp - c.startTimestamp) / 86400),
                  );
                  return (
                    <tr
                      key={c.campaignId}
                      className="border-b border-gray-100/60 dark:border-gray-800/40 hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
                    >
                      <td className="px-3 py-2">
                        <div className="text-[11px] font-mono text-gray-700 dark:text-gray-300">
                          {formatDate(c.startTimestamp)} → {formatDate(c.endTimestamp)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={METRIC_TEXT}>{c.rewardToken?.symbol ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className={METRIC_TEXT}>
                          {formatNumberCompact(c.dailyRewardTokens)} {c.rewardToken?.symbol ?? ""}
                        </div>
                        <div className="text-[10px] text-gray-500 dark:text-gray-400">
                          {formatUsd(c.dailyRewardUsd)}/day
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn(METRIC_TEXT, "font-bold")}>
                          {formatUsd(c.totalSpentUsd)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={METRIC_TEXT}>{durationDays}d</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a
                          href={`https://app.merkl.xyz/?chain=${data.chainId}&campaign=${c.campaignId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-gray-400 hover:text-[var(--bp-accent-primary)]"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── Liquidity distribution (campaign LPs vs other pool LPs) ─────── */}
      <div className="rounded-xl border border-gray-200 bg-white/60 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="flex items-baseline justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
              Liquidity Distribution
            </h3>
            <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
              LPs earning {rewardSymbol} highlighted; other pool liquidity in grey
            </p>
          </div>
          <div className="bp-chart-controls">
            <button type="button" onClick={() => liquidityChartRef.current?.zoomOut()}>−</button>
            <button type="button" onClick={() => liquidityChartRef.current?.zoomIn()}>+</button>
            <button type="button" onClick={() => liquidityChartRef.current?.reset()}>Reset</button>
          </div>
        </div>
        <div className="h-[340px] px-4 py-3">
          {!poolData || allPositions.length === 0 || liquidityDistributionBars.length === 0 ? (
            <div className="bp-skeleton h-full w-full rounded-lg" />
          ) : (
            <LPDistributionComparisonChart
              ref={liquidityChartRef}
              totalDistribution={liquidityDistributionBars}
              allPositions={allPositions}
              selectedPositions={selectedPositions}
              currentPrice={poolData.currentPrice}
              currentTick={poolData.tick}
              currentLiquidity={poolData.liquidity}
              token0Decimals={poolData.token0Decimals}
              token1Decimals={poolData.token1Decimals}
              token0Symbol={poolData.token0Symbol}
              token1Symbol={poolData.token1Symbol}
              token0UsdPrice={token0UsdPrice}
              token1UsdPrice={token1UsdPrice}
              tickSpacing={poolData.tickSpacing}
              selectedOwnerLabel={`Campaign LPs (${recipientAddressSet.size})`}
              useUsd={liquidityDistributionUseUsd}
            />
          )}
        </div>
      </div>

      {/* ── Header card ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white/60 p-5 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-[var(--bp-accent-primary)]">
              Merkl Campaign · LIVE
            </div>
            <h3 className="mt-1 text-base font-bold text-gray-900 dark:text-gray-100">
              {pool.name || "Sushi V3 vbUSDC–vbETH 0.05%"}
            </h3>
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {formatDate(campaign.startTimestamp)} → {formatDate(campaign.endTimestamp)} · reward in{" "}
              <span className="font-semibold text-gray-700 dark:text-gray-300">{rewardSymbol}</span>
              {tokenPrice > 0 ? ` @ $${tokenPrice.toFixed(6)}` : ""}
            </div>
          </div>
          <a
            href={`https://app.merkl.xyz/?chain=${data.chainId}&campaign=${campaign.campaignId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 self-start rounded-md border border-gray-200 bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-300 dark:hover:bg-gray-800 md:mt-0"
          >
            View on Merkl <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatTile
            label="Pool TVL"
            value={formatUsd(pool.tvlUsd)}
            sub={`${pool.aprPct.toFixed(2)}% APR`}
          />
          <StatTile
            label="Daily rewards"
            value={formatUsd(pool.dailyRewardsUsd)}
            sub={`${Math.round(pool.dailyRewardsUsd / Math.max(tokenPrice, 1e-9)).toLocaleString()} ${rewardSymbol}/day`}
          />
          <StatTile
            label="Campaign budget"
            value={`${formatNumberCompact(campaign.budgetTokens)} ${rewardSymbol}`}
            sub={formatUsd(campaign.budgetTokens * tokenPrice)}
          />
          <StatTile
            label="Distributed so far"
            value={`${formatNumberCompact(totals.distributedTokens)} ${rewardSymbol}`}
            sub={`${distributedPct.toFixed(1)}% of budget · ${formatUsd(totals.distributedUsd)}`}
          />
          <StatTile
            label="Claimed"
            value={`${formatNumberCompact(totals.claimedTokens)} ${rewardSymbol}`}
            sub={`${claimedPct.toFixed(1)}% of distributed · ${formatUsd(totals.claimedUsd)}`}
          />
          <StatTile
            label="Unclaimed"
            value={`${formatNumberCompact(totals.unclaimedTokens)} ${rewardSymbol}`}
            sub={`${formatUsd(totals.unclaimedUsd)} sitting in Merkle roots`}
          />
        </div>

        <div className="mt-4 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            {totals.recipientCount.toLocaleString()}
          </span>{" "}
          LP wallets earning rewards
          {pool.explorerAddress ? (
            <>
              <span>·</span>
              <a
                href={getAddressExplorerUrl(pool.explorerAddress, KATANA_SPACE_SLUG)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
              >
                Pool {shortAddr(pool.explorerAddress)} <ArrowUpRight className="h-3 w-3" />
              </a>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Liquidity Providers (per-position, matches Merkl) ────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white/40 dark:border-gray-700 dark:bg-gray-900/30">
        <div className="flex items-baseline justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
            Liquidity Providers
          </h3>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            {visiblePositionRows.length.toLocaleString()} of {(data?.positionRowsTotal ?? 0).toLocaleString()} positions ·
            {" "}{totalRecipientCount.toLocaleString()} unique LP wallets
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className={cn(HEADER_TEXT, "px-3 py-2 text-left w-12")}>Rank</th>
                <th
                  onClick={() => handleSort("share")}
                  className={cn(HEADER_TEXT, "px-3 py-2 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 w-20")}
                >
                  Share {sortKey === "share" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className={cn(HEADER_TEXT, "px-3 py-2 text-left")}>Address</th>
                <th className={cn(HEADER_TEXT, "px-3 py-2 text-right")}>Position</th>
                <th
                  onClick={() => handleSort("amount")}
                  className={cn(HEADER_TEXT, "px-3 py-2 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200")}
                >
                  Rewards earned ({rewardSymbol}) {sortKey === "amount" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className={cn(HEADER_TEXT, "px-3 py-2 text-right")}>USD</th>
                <th
                  onClick={() => handleSort("claimed")}
                  className={cn(HEADER_TEXT, "px-3 py-2 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200")}
                >
                  Claimed {sortKey === "claimed" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th
                  onClick={() => handleSort("pending")}
                  className={cn(HEADER_TEXT, "px-3 py-2 text-right cursor-pointer hover:text-gray-700 dark:hover:text-gray-200")}
                >
                  Pending {sortKey === "pending" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className={cn(HEADER_TEXT, "px-3 py-2 text-right")}>Via</th>
              </tr>
            </thead>
            <tbody>
              {visiblePositionRows.map((row, i) => {
                const rank = sortKey === "amount" && sortDir === "desc" ? row.rank : i + 1;
                const unclaimedTokens = row.amountTokens - row.claimedAmountTokens;
                return (
                  <tr
                    key={`${row.recipient}-${row.positionId ?? i}`}
                    className="border-b border-gray-100/60 dark:border-gray-800/40 hover:bg-gray-50/60 dark:hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-2 text-[11px] font-mono text-gray-400 dark:text-gray-500">
                      #{rank}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={METRIC_TEXT}>{row.shareOfCampaignPct.toFixed(2)}%</span>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={getAddressExplorerUrl(row.recipient, KATANA_SPACE_SLUG)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-700 dark:text-gray-300 hover:text-[var(--bp-accent-primary)]"
                      >
                        {shortAddr(row.recipient)}
                        <ArrowUpRight className="h-3 w-3 opacity-60" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(METRIC_TEXT, "text-gray-500 dark:text-gray-400")}>
                        {row.positionId ? `#${row.positionId}` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(METRIC_TEXT, "font-bold")}>
                        {formatTokens(row.amountTokens)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={METRIC_TEXT}>{formatUsd(row.amountUsd)}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(METRIC_TEXT, row.claimedAmountTokens > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400 dark:text-gray-600")}>
                        {formatTokens(row.claimedAmountTokens)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(METRIC_TEXT, unclaimedTokens > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400 dark:text-gray-600")}>
                        {formatTokens(unclaimedTokens)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(METRIC_TEXT, "text-gray-500 dark:text-gray-400")}>
                        {row.source ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(data?.positionRowsTotal ?? 0) > 50 ? (
          <div className="flex items-center justify-center border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="cursor-pointer text-[11px] font-semibold text-[var(--bp-accent-primary)] hover:underline"
            >
              {showAll
                ? `Show top 50 only`
                : `Show all ${(data?.positionRowsTotal ?? 0).toLocaleString()} positions →`}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
