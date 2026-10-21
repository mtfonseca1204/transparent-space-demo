"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import {
  useZerogMerklOpportunity,
  type ZerogMerklCampaign,
} from "@/hooks/use-zerog-merkl-opportunity";
import { useMerklCampaignIncentives } from "@/hooks/use-merkl-campaign-incentives";
import type { MerklCampaign } from "@/app/api/merkl-opportunities/route";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import { getAddressExplorerUrl, ZEROG_SPACE_SLUG } from "@/lib/space-policy";
import { ZEROG_CHAIN_ID, ZEROG_W0G_USDCE_V3_POOL_KEY } from "@/lib/pools";
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
} from "./birds-eye-katana-tvl-chart";
import {
  BirdsEyeZerogIncentiveEfficiencyChart,
  type IncentiveEfficiencyPool,
} from "./birds-eye-zerog-incentive-efficiency-chart";

type SortKey = "amount" | "share" | "claimed" | "pending";
type SortDir = "asc" | "desc";
type PoolCampaignTab = {
  poolKey: string;
  tokenSymbols: readonly [string, string];
  campaigns: ZerogMerklCampaign[];
  primaryCampaign: ZerogMerklCampaign;
  title: string;
  meta: string;
  statusLabel: "Upcoming" | "Live" | "Past";
  isLive: boolean;
};

const METRIC_TEXT = "text-[11px] font-semibold font-mono text-gray-700 dark:text-gray-300";
const HEADER_TEXT =
  "text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400";

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

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

function formatShortDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatShortRange(start: number, end: number): string {
  return `${formatShortDate(start)}-${formatShortDate(end)}`;
}

function isCampaignLive(campaign: MerklCampaign, nowSec: number): boolean {
  return nowSec >= campaign.startTimestamp && nowSec <= campaign.endTimestamp;
}

function getCampaignStatusLabel(campaign: MerklCampaign, nowSec: number): PoolCampaignTab["statusLabel"] {
  if (nowSec < campaign.startTimestamp) return "Upcoming";
  if (isCampaignLive(campaign, nowSec)) return "Live";
  return "Past";
}

function getCampaignSortRank(campaign: MerklCampaign, nowSec: number): number {
  if (isCampaignLive(campaign, nowSec)) return 0;
  if (nowSec < campaign.startTimestamp) return 1;
  return 2;
}

const CAMPAIGN_TABS_CLASS =
  "flex overflow-x-auto rounded border border-[#C8C6BB] bg-[#FAFAF7]";
const CAMPAIGN_TAB_CLASS =
  "relative flex flex-1 min-w-[150px] items-center gap-2 border-r border-[#C8C6BB] bg-[#FAFAF7] px-3 py-2.5 text-left font-mono text-[#2B2921] transition-colors last:border-r-0 hover:bg-[#ECEBE4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D49A2E]";
const CAMPAIGN_TAB_ACTIVE_BAR_CLASS = "absolute inset-x-0 top-0 h-[3px] bg-[#D49A2E]";
const CAMPAIGN_TAB_BADGE_CLASS =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C8C6BB] bg-[#ECEBE4] font-mono text-[9px] font-bold text-[#0A0906]";
const CAMPAIGN_TAB_INFO_CLASS = "flex min-w-0 flex-1 flex-col gap-0.5";
const CAMPAIGN_TAB_TITLE_CLASS =
  "truncate font-sans text-[13px] font-bold leading-tight text-[#0A0906]";
const CAMPAIGN_TAB_META_CLASS =
  "truncate font-mono text-[9px] font-medium uppercase leading-tight text-[#86836F]";

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

export const BirdsEyeZerogIncentives = memo(function BirdsEyeZerogIncentives() {
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAll, setShowAll] = useState(false);
  const [selectedPoolKey, setSelectedPoolKey] = useState<string | null>(null);

  const {
    data: zerogMerkl,
    isLoading: opportunityLoading,
    error: opportunityError,
  } = useZerogMerklOpportunity();

  const { poolTabs, livePoolTab, latestPoolTab, pastCampaigns } = useMemo(() => {
    if (!zerogMerkl?.campaigns) {
      return { poolTabs: [], livePoolTab: null, latestPoolTab: null, pastCampaigns: [] };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const campaigns = [...zerogMerkl.campaigns].sort((a, b) => a.startTimestamp - b.startTimestamp);
    const past = campaigns
      .filter((c) => c.endTimestamp < nowSec)
      .sort((a, b) => b.endTimestamp - a.endTimestamp);

    const campaignGroups = new Map<string, ZerogMerklCampaign[]>();
    for (const campaign of campaigns) {
      const group = campaignGroups.get(campaign.poolKey);
      if (group) group.push(campaign);
      else campaignGroups.set(campaign.poolKey, [campaign]);
    }

    const tabs = [...campaignGroups.entries()]
      .map(([poolKey, poolCampaigns]) => {
        const sortedPoolCampaigns = [...poolCampaigns].sort(
          (a, b) => a.startTimestamp - b.startTimestamp,
        );
        const liveCampaign =
          sortedPoolCampaigns
            .filter((campaign) => isCampaignLive(campaign, nowSec))
            .sort((a, b) => b.startTimestamp - a.startTimestamp)[0] ?? null;
        const latestCampaign = sortedPoolCampaigns[sortedPoolCampaigns.length - 1];
        const primaryCampaign = liveCampaign ?? latestCampaign;
        if (!primaryCampaign) return null;
        const statusLabel = getCampaignStatusLabel(primaryCampaign, nowSec);
        const liveCount = sortedPoolCampaigns.filter((campaign) =>
          isCampaignLive(campaign, nowSec),
        ).length;
        const pastCount = sortedPoolCampaigns.filter((campaign) => campaign.endTimestamp < nowSec).length;
        const rangeCampaign = liveCampaign ?? latestCampaign;
        if (!rangeCampaign) return null;
        const metaParts = [
          `${statusLabel.toUpperCase()} ${formatShortRange(
            rangeCampaign.startTimestamp,
            rangeCampaign.endTimestamp,
          )}`,
        ];
        if (pastCount > 0) metaParts.push(`${pastCount} past`);
        return {
          poolKey,
          tokenSymbols: primaryCampaign.tokenSymbols,
          campaigns: sortedPoolCampaigns,
          primaryCampaign,
          title: primaryCampaign.poolLabel,
          meta: metaParts.join(" · "),
          statusLabel,
          isLive: liveCount > 0,
        };
      })
      .filter((tab): tab is PoolCampaignTab => tab !== null)
      .sort((a, b) => {
        const rankDiff =
          getCampaignSortRank(a.primaryCampaign, nowSec) - getCampaignSortRank(b.primaryCampaign, nowSec);
        if (rankDiff !== 0) return rankDiff;
        if (getCampaignSortRank(a.primaryCampaign, nowSec) === 2) {
          return b.primaryCampaign.endTimestamp - a.primaryCampaign.endTimestamp;
        }
        return a.primaryCampaign.endTimestamp - b.primaryCampaign.endTimestamp;
      });

    const liveTab =
      tabs
        .filter((tab) => tab.isLive)
        .sort((a, b) => b.primaryCampaign.startTimestamp - a.primaryCampaign.startTimestamp)[0] ??
      null;
    const latestTab =
      [...tabs].sort((a, b) => b.primaryCampaign.startTimestamp - a.primaryCampaign.startTimestamp)[0] ??
      null;

    return {
      poolTabs: tabs,
      livePoolTab: liveTab,
      latestPoolTab: latestTab,
      pastCampaigns: past,
    };
  }, [zerogMerkl?.campaigns]);

  const selectedPoolTab = useMemo(() => {
    const fallbackTab = livePoolTab ?? latestPoolTab;
    if (!selectedPoolKey) return fallbackTab;
    return poolTabs.find((tab) => tab.poolKey === selectedPoolKey) ?? fallbackTab;
  }, [latestPoolTab, livePoolTab, poolTabs, selectedPoolKey]);

  const selectedCampaign = selectedPoolTab?.primaryCampaign ?? null;

  useEffect(() => {
    if (!selectedPoolKey) return;
    if (!poolTabs.some((tab) => tab.poolKey === selectedPoolKey)) {
      setSelectedPoolKey(null);
    }
  }, [poolTabs, selectedPoolKey]);

  const selectedCampaignStatusLabel = selectedCampaign
    ? getCampaignStatusLabel(selectedCampaign, Math.floor(Date.now() / 1000))
    : null;
  const chartCampaignWindows = useMemo(() => {
    if (!selectedPoolTab) return [];

    const nowSec = Math.floor(Date.now() / 1000);
    return selectedPoolTab.campaigns.map((campaign) => ({
      campaignId: campaign.campaignId,
      start: campaign.startTimestamp,
      end: campaign.endTimestamp,
      isLive: isCampaignLive(campaign, nowSec),
      rewardSymbol: campaign.rewardToken.symbol,
    }));
  }, [selectedPoolTab]);

  // Pools (with their campaigns) feeding the incentive-efficiency line chart
  // shown above the tabs — one line per pool.
  const efficiencyPools = useMemo<IncentiveEfficiencyPool[]>(
    () =>
      poolTabs.map((tab) => ({
        poolKey: tab.poolKey,
        poolLabel: tab.title,
        campaigns: tab.campaigns,
      })),
    [poolTabs],
  );

  const {
    data,
    isLoading: incentivesLoading,
    error: incentivesError,
  } = useMerklCampaignIncentives({
    chainId: ZEROG_CHAIN_ID,
    campaignId: selectedCampaign?.campaignId ?? null,
    enabled: Boolean(selectedCampaign?.campaignId),
    limit: 500,
  });
  const activeData =
    data && selectedCampaign && data.campaign.campaignId === selectedCampaign.campaignId
      ? data
      : null;

  // ── Pool + positions + prices for the on-chain charts ──────────────────
  // 0G mainnet pools are Uniswap V3 pools, so the same hooks Katana uses for
  // its Sushi V3 pool produce the inputs both campaign charts need.
  const poolKey = selectedCampaign?.poolKey ?? ZEROG_W0G_USDCE_V3_POOL_KEY;
  const { data: poolData } = usePoolData(poolKey);
  const { data: positionsByOwner } = useAllPoolPositions(poolKey, true);
  const tokenPriceMap = useTokenPrices([
    poolData?.token0Address,
    poolData?.token1Address,
  ]);
  const allPositions = useMemo(
    () => flattenPositions(positionsByOwner ?? null),
    [positionsByOwner],
  );
  // Wallets considered "campaign LPs" by the highlight overlay on the V3 LP
  // distribution chart and the Campaign TVL chart: every Merkl reward
  // recipient + any wrapper contract that holds positions on behalf of them.
  const recipientAddressSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of activeData?.recipients ?? []) set.add(r.recipient.toLowerCase());
    for (const w of activeData?.wrapperAddresses ?? []) set.add(w.toLowerCase());
    return set;
  }, [activeData?.recipients, activeData?.wrapperAddresses]);
  const selectedPositions = useMemo(
    () =>
      recipientAddressSet.size === 0
        ? []
        : allPositions.filter((p) => recipientAddressSet.has(p.owner.toLowerCase())),
    [allPositions, recipientAddressSet],
  );
  // Raw CoinGecko prices — may be missing for bridged 0G tokens (e.g. WETH).
  const rawToken0Usd = poolData?.token0Address
    ? tokenPriceMap.data?.[poolData.token0Address.toLowerCase()] ?? null
    : null;
  const rawToken1Usd = poolData?.token1Address
    ? tokenPriceMap.data?.[poolData.token1Address.toLowerCase()] ?? null
    : null;
  // Anchor the missing side on the pool price (currentPrice = token1 per token0),
  // exactly like the pool dashboard's `usdPrices`. Without this, a token CoinGecko
  // can't price (0G WETH) drops to null and its half of every TVL/value is lost —
  // so a WETH/USDC.e pool would only show the USDC.e value.
  const { token0UsdPrice, token1UsdPrice } = useMemo(() => {
    const p = poolData?.currentPrice;
    const ok = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
    const priceOk = ok(p ?? null) && (p as number) > 0;
    const t0 = ok(rawToken0Usd)
      ? rawToken0Usd
      : ok(rawToken1Usd) && priceOk
        ? rawToken1Usd * (p as number)
        : null;
    const t1 = ok(rawToken1Usd)
      ? rawToken1Usd
      : ok(rawToken0Usd) && priceOk
        ? rawToken0Usd / (p as number)
        : null;
    return { token0UsdPrice: t0, token1UsdPrice: t1 };
  }, [rawToken0Usd, rawToken1Usd, poolData?.currentPrice]);
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
    if (!activeData?.positionRows) return [];
    const rows = [...activeData.positionRows];
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
      }
    });
    return rows;
  }, [activeData?.positionRows, sortKey, sortDir]);

  const visiblePositionRows = showAll ? sortedPositionRows : sortedPositionRows.slice(0, 50);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const handlePoolSelect = (poolKey: string) => {
    setSelectedPoolKey(poolKey);
    setShowAll(false);
  };

  const isLoading = opportunityLoading;
  if (isLoading) {
    return (
      <div className="px-4 py-12 md:px-6">
        <div className="bp-skeleton h-32 w-full rounded-lg" />
        <div className="bp-skeleton mt-4 h-96 w-full rounded-lg" />
      </div>
    );
  }

  if (opportunityError) {
    return (
      <div className="px-4 py-12 md:px-6">
        <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          Failed to load Merkl opportunity: {opportunityError.message}
        </div>
      </div>
    );
  }

  if (!selectedCampaign) {
    return (
      <div className="flex flex-col">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
          <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
            Merkl Campaigns
          </h3>
        </div>
        <div className="px-4 py-4 md:px-6">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            0G AI Merkl campaigns
          </h3>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            No campaign data available
          </p>
        </div>
        {pastCampaigns.length > 0 ? (
          <PastCampaignsSection pastCampaigns={pastCampaigns} chainId={ZEROG_CHAIN_ID} />
        ) : null}
      </div>
    );
  }

  if (incentivesError) {
    return (
      <div className="flex flex-col">
        <CampaignTabs
          tabs={poolTabs}
          selectedPoolKey={selectedPoolTab?.poolKey ?? selectedCampaign.poolKey}
          onSelect={handlePoolSelect}
        />
        <div className="px-4 py-12 md:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            Failed to load Merkl incentive data: {incentivesError?.message ?? "no data returned"}
          </div>
        </div>
      </div>
    );
  }

  if (!activeData || incentivesLoading) {
    return (
      <div className="flex flex-col">
        <CampaignTabs
          tabs={poolTabs}
          selectedPoolKey={selectedPoolTab?.poolKey ?? selectedCampaign.poolKey}
          onSelect={handlePoolSelect}
        />
        <div className="px-4 py-12 md:px-6">
          <div className="bp-skeleton h-32 w-full rounded-lg" />
          <div className="bp-skeleton mt-4 h-96 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const { campaign, pool, totals } = activeData;
  const totalRecipientCount = totals.recipientCount;
  const rewardSymbol = campaign.rewardToken.symbol;
  const tokenPrice = campaign.rewardToken.price ?? 0;
  const claimedPct =
    totals.distributedTokens > 0 ? (totals.claimedTokens / totals.distributedTokens) * 100 : 0;
  const distributedPct =
    campaign.budgetTokens > 0 ? (totals.distributedTokens / campaign.budgetTokens) * 100 : 0;

  return (
    <div className="flex flex-col">
      {/* ── Incentive efficiency (TVL per $ spent) — one line per pool ──── */}
      <BirdsEyeZerogIncentiveEfficiencyChart pools={efficiencyPools} />

      <CampaignTabs
        tabs={poolTabs}
        selectedPoolKey={selectedPoolTab?.poolKey ?? selectedCampaign.poolKey}
        onSelect={handlePoolSelect}
      />

      {/* ── Campaign TVL over time ──────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
            Campaign TVL Over Time
          </h3>
          <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
            {selectedCampaign.poolLabel} · {formatDate(campaign.startTimestamp)} → {formatDate(campaign.endTimestamp)} ·
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
      <div className="h-[280px] px-4 pb-4 pt-2 md:px-6">
        <BirdsEyeKatanaTvlChart
          poolKey={poolKey}
          poolData={poolData}
          token0UsdPrice={token0UsdPrice}
          token1UsdPrice={token1UsdPrice}
          recipientAddressSet={recipientAddressSet}
          campaigns={chartCampaignWindows}
          rewardSymbol={rewardSymbol}
          className="h-full"
        />
      </div>

      {/* ── Liquidity distribution (campaign LPs vs other pool LPs) ─────── */}
      <div className="relative flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
        <div>
          <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
            Liquidity Distribution
          </h3>
          <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
            LPs earning {rewardSymbol} highlighted; other pool liquidity in grey
          </p>
        </div>
        {/* `.bp-chart-controls` is `position: absolute` by default; the
           parent has `relative` so the segmented control anchors here
           instead of escaping to the dashboard canvas. */}
        <div className="bp-chart-controls" style={{ right: 16, top: 8 }}>
          <button type="button" onClick={() => liquidityChartRef.current?.zoomOut()}>−</button>
          <button type="button" onClick={() => liquidityChartRef.current?.zoomIn()}>+</button>
          <button type="button" onClick={() => liquidityChartRef.current?.reset()}>Reset</button>
        </div>
      </div>
      <div className="h-[340px] px-4 pb-4 pt-2 md:px-6">
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

      {/* ── Merkl Campaign summary ──────────────────────────────────────── */}
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-[var(--bp-accent-primary)]">
          Merkl Campaign · {selectedCampaignStatusLabel}
        </h3>
      </div>
      <div className="px-4 pt-3 pb-4 md:px-6">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {pool.name || selectedCampaign.poolLabel}
            </h3>
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              {formatDate(campaign.startTimestamp)} → {formatDate(campaign.endTimestamp)} · reward in{" "}
              <span className="font-semibold text-gray-700 dark:text-gray-300">{rewardSymbol}</span>
              {tokenPrice > 0 ? ` @ $${tokenPrice.toFixed(6)}` : ""}
            </div>
          </div>
          <a
            href={`https://app.merkl.xyz/?chain=${activeData.chainId}&campaign=${campaign.campaignId}`}
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
            sub={
              tokenPrice > 0
                ? `${Math.round(pool.dailyRewardsUsd / Math.max(tokenPrice, 1e-9)).toLocaleString()} ${rewardSymbol}/day`
                : null
            }
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
                href={getAddressExplorerUrl(pool.explorerAddress, ZEROG_SPACE_SLUG)}
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

      {/* ── Liquidity Providers ─────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
          Liquidity Providers
        </h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {visiblePositionRows.length.toLocaleString()} of {activeData.positionRowsTotal.toLocaleString()} positions ·
          {" "}{totalRecipientCount.toLocaleString()} unique LP wallets
        </span>
      </div>
      <div>
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
                        href={getAddressExplorerUrl(row.recipient, ZEROG_SPACE_SLUG)}
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

        {activeData.positionRowsTotal > 50 ? (
          <div className="flex items-center justify-center border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="cursor-pointer text-[11px] font-semibold text-[var(--bp-accent-primary)] hover:underline"
            >
              {showAll
                ? `Show top 50 only`
                : `Show all ${activeData.positionRowsTotal.toLocaleString()} positions →`}
            </button>
          </div>
        ) : null}
      </div>

      {pastCampaigns.length > 0 ? (
        <PastCampaignsSection pastCampaigns={pastCampaigns} chainId={activeData.chainId} />
      ) : null}
    </div>
  );
});

function CampaignTabs({
  tabs,
  selectedPoolKey,
  onSelect,
}: {
  tabs: PoolCampaignTab[];
  selectedPoolKey: string;
  onSelect: (poolKey: string) => void;
}) {
  if (tabs.length === 0) return null;

  return (
    <div className="px-4 pt-3 md:px-6">
      <div className={CAMPAIGN_TABS_CLASS} role="tablist" aria-label="Merkl campaigns">
        {tabs.map((tab) => {
          const isSelected = selectedPoolKey === tab.poolKey;
          return (
            <button
              key={tab.poolKey}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={CAMPAIGN_TAB_CLASS}
              onClick={() => onSelect(tab.poolKey)}
              aria-label={`${tab.title}: ${tab.meta}`}
            >
              {isSelected && <span className={CAMPAIGN_TAB_ACTIVE_BAR_CLASS} aria-hidden="true" />}
              <PoolTabLogo tab={tab} />
              <span className={CAMPAIGN_TAB_INFO_CLASS}>
                <span className={CAMPAIGN_TAB_TITLE_CLASS}>{tab.title}</span>
                <span className={CAMPAIGN_TAB_META_CLASS}>
                  <strong className="text-[#0A0906]">{tab.statusLabel}</strong>{" "}
                  {tab.meta.replace(`${tab.statusLabel.toUpperCase()} `, "")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PoolTabLogo({ tab }: { tab: PoolCampaignTab }) {
  const [baseSymbol, quoteSymbol] = tab.tokenSymbols;
  return (
    <span
      className={cn(
        CAMPAIGN_TAB_BADGE_CLASS,
        "relative h-8 w-12 overflow-visible border-0 bg-transparent",
        tab.isLive && "ring-0",
      )}
      aria-hidden="true"
    >
      <TokenIcon
        symbol={baseSymbol}
        className="!absolute !left-0 !top-0 !h-7 !w-7"
      />
      <TokenIcon
        symbol={quoteSymbol}
        className="!absolute !left-[18px] !top-0 !h-7 !w-7"
      />
      {tab.isLive ? (
        <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[#FAFAF7] bg-emerald-500" />
      ) : null}
    </span>
  );
}

function PastCampaignsSection({
  pastCampaigns,
  chainId,
}: {
  pastCampaigns: ReadonlyArray<{
    campaignId: string;
    poolLabel?: string;
    startTimestamp: number;
    endTimestamp: number;
    rewardToken?: { symbol?: string };
    dailyRewardTokens: number;
    dailyRewardUsd: number;
    totalSpentUsd: number;
  }>;
  chainId: number;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-700 dark:text-gray-300">
          Past Campaigns
        </h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {pastCampaigns.length} previous · all 0G pools
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className={cn(HEADER_TEXT, "px-3 py-2 text-left")}>Pool</th>
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
                    <span className={METRIC_TEXT}>{c.poolLabel ?? "—"}</span>
                  </td>
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
                      href={`https://app.merkl.xyz/?chain=${chainId}&campaign=${c.campaignId}`}
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
    </>
  );
}
