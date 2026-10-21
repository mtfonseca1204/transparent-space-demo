"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
// Grid layout temporarily disabled to restore functionality
// import GridLayout from "react-grid-layout";
// import "react-grid-layout/css/styles.css";
// import "react-resizable/css/styles.css";
// import { useGridLayoutStore, DEFAULT_LAYOUT } from "@/stores/grid-layout-store";

// Pool header
import {
  PoolBadge,
  PoolBadges,
  PoolHeader,
  PoolHeaderSkeleton,
  PoolInfo,
  PoolName,
  PoolTokens,
  TokenIcon,
  PoolReadout,
  PoolSubDivider,
  PoolAddress,
} from "./pool-header";

// Metric cards
import {
  MetricCard,
  MetricCardSkeleton,
  MetricLabel,
  MetricUnit,
  MetricValue,
  MetricBreakdown,
  MetricBreakdownItem,
} from "./metric-card";

// Hooks
import { formatBalance, formatFeeTier } from "@/hooks/use-pool-data";
import { useUnifiedPoolData } from "@/hooks/use-unified-pool-data";
import { useLPHistoricalData, useAllLPPositions, useAllPoolPositions, usePositionsByOwner, useTickLiquidity, useTickLiquidityFullRange } from "@/hooks/use-lp-historical-data";
import { usePoolMetrics, useLPEntryExitData, usePoolDayData } from "@/hooks/use-pool-metrics";
import { useTokenPrices } from "@/hooks/use-token-price";
import { useLiquidityDistribution, flattenPositions } from "@/hooks/use-liquidity-distribution";
import { useTradingVolumeBySize } from "@/hooks/use-trading-volume-by-size";
import { tickToPrice, type OwnerPositionAggregateData, type PositionData } from "@/lib/envio-client";
import { getPoolAnalyticsProfile } from "@/lib/pool-analytics";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import {
  inferPoolProtocol,
  getExplorerUrl,
  getSolanaPoolMetadata,
  isWorldchainSolanaSupportedPool,
  normalizePoolKey,
  type SupportedPool,
} from "@/lib/pools";
import { getPoolDisplayPair } from "@/lib/pool-display";
import { priceOracle } from "@/lib/price-oracle";
import { estimatePoolBalancesFromTickLiquidity } from "@/lib/pool-balance-estimator";
import { computePositionTokenBalances } from "@/lib/pool-tvl";
import {
  shouldForcePerleBscPancakeTickDistribution,
  shouldUseWorldchainTickDistribution,
  shouldUseWorldchainZeroFill,
} from "@/lib/worldchain-pool-data";
import type { InventoryTiltData } from "@/components/custom-metrics";

// Real data charts
import { LightweightPriceChart, type PriceChartHandle } from "./lightweight-price-chart";
import type { LiquidityDistributionChartHandle } from "./liquidity-distribution-chart";
import { LiquidityDistributionChart } from "./liquidity-distribution-chart";
import { LPDistributionComparisonChart, type LPDistributionComparisonChartHandle } from "./lp-distribution-comparison-chart";
import { HistoricalRebalances } from "./historical-rebalances";
import { useOwnerRebalances } from "@/hooks/use-owner-rebalances";
import { reconstructAllLifecycles } from "@/lib/lp-rebalances";
import { LPRangesByAddressChart, type LPRangesByAddressChartHandle } from "./lp-ranges-by-address-chart";
import { InRangeLiquidityChart } from "./in-range-liquidity-chart";
import { LiquidityHistoryByAddressChart } from "./liquidity-history-by-address-chart";
import { useLiquidityHistoryByAddress, convertToChartData } from "@/hooks/use-liquidity-history-by-address";
import { LPEntryExitChart } from "./lp-entry-exit-chart";
import { PriceImpactChart, type PriceImpactChartHandle } from "./price-impact-chart";
import { HistoricalLiquidityDepthHeatmap } from "./historical-liquidity-depth-heatmap";
import { supportsHistoricalLiquidityDepth } from "@/lib/liquidity-depth";
import { Tvl1YAreaChart, Volume1YAreaChart } from "./tvl-1y-area-chart";
import { VolumeByTimeChart } from "./volume-by-time-chart";
import { useVolumeByTime } from "@/hooks/use-volume-by-time";
import { TvlIncentiveChart } from "./tvl-incentive-chart";
import { PriceSpreadChart } from "./price-spread-chart";
import { usePriceSpreadData } from "@/hooks/use-price-spread-data";

// Chart cards
import {
  AreaChartPlaceholder,
  BarChartPlaceholder,
  ChartCard,
  ChartContent,
  ChartContentSkeleton,
  ChartHeader,
  ChartTitle,
  ChartUnavailableState,
  ChartWatermark,
  DuneWatermark,
  LineChartPlaceholder,
} from "./chart-card";

// LP Concentration
import {
  LPConcentration,
  LPConcentrationChart,
  LPConcentrationTitle,
} from "./lp-concentration";

// LP Comparison Table
import { LPComparisonTable } from "./lp-comparison-table";

// Volume Attribution Hook (hourly fee-based - efficient)
import { useVolumeAttributionHourly } from "@/hooks/use-volume-attribution-hourly";


// Current LPs
import {
  CurrentLPs,
  CurrentLPsHeader,
  CurrentLPsList,
  CurrentLPsRow,
  CurrentLPsTitle,
  LPAddress,
  LPSize,
} from "./current-lps";

import { formatLpLabel } from "@/lib/lp-labels";

import { Card } from "./card";

// Custom Metrics
import {
  PriceRangeChart,
  SuccessIndicator,
  type PriceRangeData,
  LiquidityTargetChart,
  type LiquidityTargetData,
  AlertIndicator,
  ExecutionLagChart,
  ExecutionLagAlertIndicator,
  type ExecutionLagData,
  LPAddressActivityChart,
  type LPAddressActivityData,
  TradingVolumeBySizeChart,
  LPPositionActivityChart,
  FeeEarningsChart,
  SlippageHistoryChart,
} from "../custom-metrics";
import { useHistoricalSlippage } from "@/hooks/use-historical-slippage";
import { useMerklOpportunity } from "@/hooks/use-merkl-opportunity";
import type { MerklCampaign } from "@/app/api/merkl-opportunities/route";
import { ChartSettingsFab } from "./chart-settings-fab";
import { useChartSettingsStore, ORACLE_SOURCE_LABELS, TIME_RANGE_DAYS, type OracleSource } from "@/stores/chart-settings-store";
import { usePoolStore, type PoolState } from "@/stores/pool-store";
import { isKrakenLikeSpace, ZEROG_SPACE_SLUG } from "@/lib/space-policy";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { MonadV2NativeCharts } from "@/components/monad-v2/monad-v2-dashboard";
import { MONAD_V2_DUST_USDC_POOL_KEY } from "@/lib/monad-v2-dashboard";

// Fallback incentive campaign windows for pools that support the Incentives tab.
// When live Merkl data is available, the charts expand to cover all campaign periods.
const INCENTIVE_CAMPAIGNS: Record<string, { start: string; end: string }> = {
  "0xdce053d9ba0fa2c5f772416b64f191158cbcc32e": { start: "2025-04-08", end: "2025-07-31" }, // WBTC-USDC.e (Merkl campaign end)
  "0x5f835420502a7702de50cd0e78d8aa3608b2137e": { start: "2025-05-13", end: "2025-11-12" }, // WETH-USDC.e
  "0x494d68e3cab640fa50f4c1b3e2499698d1a173a0": { start: "2025-05-13", end: "2025-11-12" }, // WLD-WETH
  "0x7c3c2a92598d6d77e57fd55c50e99af4b291f595": { start: "2025-05-13", end: "2025-11-12" }, // WBTC-WETH
};

type PositionsForOwnerResult = { owner: string; positions: PositionData[] };

function getCampaignDaysFromStart(campaign: { start: string; end: string }): number {
  const startDate = new Date(campaign.start);
  startDate.setDate(startDate.getDate() - 30);
  const today = new Date();
  const diff = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff);
}

// Helper function to format compact values (no unit)
const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value.toFixed(0)}`;
};

const formatCompactWithUnit = (value: number, unit?: string): string => {
  const u = unit?.trim();
  return u ? `${formatCompact(value)} ${u}` : formatCompact(value);
};

// Smart price formatter for extreme values (very large or very small)
const formatSmartPrice = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "---";
  
  // Very large numbers: use compact notation
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  // Normal range
  if (value >= 0.01) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  
  // Very small numbers: use scientific notation or more decimals
  if (value >= 0.0000001) return value.toFixed(8);
  return value.toExponential(2);
};

// Helper function to format USD values with $ prefix
const formatUsdCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
};

const formatIncentiveChartDate = (timestampSeconds: number): string => {
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    timeZone: "UTC",
  });
};

const formatIncentivePeriodDate = (date: Date): string =>
  `${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })} '${String(date.getUTCFullYear()).slice(-2)}`;

const formatIncentivePeriodRange = (start: Date, end: Date): string => {
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const shortYear = String(endYear).slice(-2);

  if (startYear === endYear) {
    const startLabel = start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const endLabel = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${startLabel} - ${endLabel} '${shortYear}`;
  }

  return `${formatIncentivePeriodDate(start)} - ${formatIncentivePeriodDate(end)}`;
};

const getCampaignDailyUsdForDay = (campaign: MerklCampaign, dayStart: number): number => {
  if (campaign.dailyRewardTokens <= 0) return 0;

  const prices = campaign.historicalPrices ?? [];
  if (prices.length === 0) return campaign.dailyRewardUsd;

  let bestPrice = campaign.rewardToken.price ?? 0;
  let bestDist = Infinity;

  for (const point of prices) {
    const dist = Math.abs(point.timestamp - dayStart);
    if (dist < bestDist) {
      bestDist = dist;
      bestPrice = point.price;
    }
    if (point.timestamp > dayStart && dist > bestDist) break;
  }

  return bestPrice > 0 ? campaign.dailyRewardTokens * bestPrice : campaign.dailyRewardUsd;
};

const IS_DEV = process.env.NODE_ENV !== "production";

const hasPositiveBigInt = (value: string | number | bigint | null | undefined): boolean => {
  try {
    if (typeof value === "bigint") return value > 0n;
    if (typeof value === "number") return Number.isFinite(value) && value > 0;
    if (typeof value === "string" && value.trim()) return BigInt(value) > 0n;
  } catch {
    return false;
  }
  return false;
};

// Helper to format LP "size" based on share of total liquidity (optionally converted to token1 TVL)
const formatLPSize = (
  liquidity: string,
  totalLiquidity: bigint,
  poolData?: {
    token0Balance: string;
    token1Balance: string;
    currentPrice: number;
    token0UsdPrice?: number | null;
    token1UsdPrice?: number | null;
    valueUnit?: string;
  }
): string => {
  if (totalLiquidity <= BigInt(0)) return "---";
  const liq = BigInt(liquidity);
  if (liq <= BigInt(0)) return "0";

  // Safe scaling: ratioScaled is always between 0 and 1_000_000
  const ratioScaled = Number((liq * BigInt(1_000_000)) / totalLiquidity) / 1_000_000;

  if (poolData) {
    const token0 = Number(poolData.token0Balance);
    const token1 = Number(poolData.token1Balance);
    const t0p = poolData.token0UsdPrice;
    const t1p = poolData.token1UsdPrice;
    const hasUsd =
      typeof t0p === "number" &&
      Number.isFinite(t0p) &&
      typeof t1p === "number" &&
      Number.isFinite(t1p);

    // Always use USD prices for both tokens (token ordering is by address, not by stablecoin)
    const tvlApprox = token0 * (t0p ?? 0) + token1 * (t1p ?? 0);
    const unit = poolData.valueUnit ?? (hasUsd ? "USD" : "token1");
    return `${formatCompact(tvlApprox * ratioScaled)} ${unit}`;
  }

  return `${(ratioScaled * 100).toFixed(2)}%`;
};

// Price range monitor data
const priceRangeData: PriceRangeData = {
  currentPrice: 0.6,
  minPrice: 0.55,
  maxPrice: 0.65,
  rangeStart: 0.575,
  rangeEnd: 0.615,
  tickCount: 10,
  labelCount: 3,
  priceLabel: "World Price",
  formatPrice: (p) => p.toFixed(2),
};

// Liquidity target data
const liquidityTargetData: LiquidityTargetData = {
  tokens: [
    { symbol: "WLD", actual: 28500, target: 25000 },
    { symbol: "USDC", actual: 18500, target: 25000 },
  ],
};

// Inventory tilt data
const inventoryTiltData: InventoryTiltData = {
  leftToken: { symbol: "WLD", percent: 52 },
  rightToken: { symbol: "USDC", percent: 48 },
  threshold: 5, // 5% deviation from 50% is considered balanced
};

// Execution lag sparkline data - with a spike in the middle to match the design
const executionLagData: ExecutionLagData = {
  points: [
    { timestamp: 1, lagMs: 65 },
    { timestamp: 2, lagMs: 72 },
    { timestamp: 3, lagMs: 58 },
    { timestamp: 4, lagMs: 68 },
    { timestamp: 5, lagMs: 75 },
    { timestamp: 6, lagMs: 62 },
    { timestamp: 7, lagMs: 70 },
    { timestamp: 8, lagMs: 78 },
    { timestamp: 9, lagMs: 85 },
    { timestamp: 10, lagMs: 120 },
    { timestamp: 11, lagMs: 180 },
    { timestamp: 12, lagMs: 350 },
    { timestamp: 13, lagMs: 480 },
    { timestamp: 14, lagMs: 420 },
    { timestamp: 15, lagMs: 280 },
    { timestamp: 16, lagMs: 150 },
    { timestamp: 17, lagMs: 95 },
    { timestamp: 18, lagMs: 78 },
    { timestamp: 19, lagMs: 68 },
    { timestamp: 20, lagMs: 72 },
    { timestamp: 21, lagMs: 65 },
    { timestamp: 22, lagMs: 70 },
    { timestamp: 23, lagMs: 62 },
    { timestamp: 24, lagMs: 68 },
    { timestamp: 25, lagMs: 75 },
  ],
  pairLabel: "WLD/USDC",
  minMs: 50,
  maxMs: 500,
};

export const Dashboard = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const poolKey = usePoolStore((s: PoolState) => s.selectedPoolKey);
  const setSelectedPoolKey = usePoolStore((s: PoolState) => s.setSelectedPoolKey);
  const supportedPools = usePoolStore((s: PoolState) => s.supportedPools);
  const { data: poolData, isLoading, error } = useUnifiedPoolData(poolKey);
  const protocol = inferPoolProtocol(poolKey);
  const selectedSupportedPool = useMemo(
    () => supportedPools.find((pool) => pool.poolKey === poolKey),
    [poolKey, supportedPools]
  );
  const fallbackPoolSymbols = useMemo(() => {
    const metadata = selectedSupportedPool
      ? getSolanaPoolMetadata(selectedSupportedPool.poolKey)
      : undefined;
    if (metadata) {
      return {
        token0Symbol: metadata.token0Symbol,
        token1Symbol: metadata.token1Symbol,
      };
    }

    const [token0Symbol = "Token", token1Symbol = "Quote"] =
      selectedSupportedPool?.label.split("/").map((part) => part.trim()) ?? [];
    return { token0Symbol, token1Symbol };
  }, [selectedSupportedPool]);
  const poolExplorerHref = useMemo(() => {
    if (selectedSupportedPool?.chainId === 56 && poolKey.includes("-v4-")) {
      const poolId = poolKey.split("-v4-")[1];
      if (poolId) return `https://pancakeswap.finance/liquidity/pool/bsc/${poolId}`;
    }
    return poolKey ? getExplorerUrl(poolKey, "address", poolKey) : "";
  }, [poolKey, selectedSupportedPool?.chainId]);
  const selectedSpaceSlug = selectedSupportedPool?.spaceSlug ?? null;
  const shouldRenderMonadV2NativeCharts =
    selectedSpaceSlug === "monad" &&
    protocol === "v2" &&
    normalizePoolKey(poolKey) === MONAD_V2_DUST_USDC_POOL_KEY;
  const fallbackAnalyticsProfile = useMemo(
    () => getPoolAnalyticsProfile(poolKey),
    [poolKey]
  );
  const isWorldchainSolanaPool = isWorldchainSolanaSupportedPool(
    selectedSupportedPool
  );
  const capabilities = poolData?.capabilities ?? fallbackAnalyticsProfile.capabilities;
  const unsupportedAnalyticsMessages = useMemo(() => {
    if (protocol === "v2") {
      return {
        rangeLiquidity:
          "Uniswap V2 liquidity is reserve-based, not tick/range-based, so this concentrated-liquidity panel is not available.",
        currentImpact:
          "Uniswap V2 price impact needs a reserve-based chart. This panel currently uses concentrated-liquidity inputs.",
        historicalSlippage:
          "Historical V2 slippage needs reserve snapshots wired into this chart.",
        ownerAttribution:
          "Uniswap V2 LP shares are fungible pool tokens, so this per-range LP attribution panel is not available.",
      };
    }

    const dlmmMessage = "Unavailable for Meteora until backend bin analytics lands.";
    return {
      rangeLiquidity: dlmmMessage,
      currentImpact: dlmmMessage,
      historicalSlippage: dlmmMessage,
      ownerAttribution: dlmmMessage,
    };
  }, [protocol]);
  const supportsSwapHistory = capabilities.hasSwapHistory;
  const supportsOwnerPositionSummary = capabilities.hasOwnerPositionSummary;
  const supportsRangeLiquidityShape = capabilities.hasRangeLiquidityShape;
  const supportsHistoricalDepthBands = capabilities.hasHistoricalDepthBands;
  const supportsCurrentImpactCurve = capabilities.hasCurrentImpactCurve;
  const supportsHistoricalSlippage = capabilities.hasHistoricalSlippage;
  const supportsOwnerCompositionHistory = capabilities.hasOwnerCompositionHistory;
  const isKrakenPool = isKrakenLikeSpace(selectedSpaceSlug);
  const supportsMaterializedLiquidityDepth =
    !isDemoSpaceSlug(selectedSpaceSlug) && supportsHistoricalLiquidityDepth(poolKey);
  const supportsReplayedLiquidityDepth =
    !isDemoSpaceSlug(selectedSpaceSlug) && supportsRangeLiquidityShape && protocol !== "meteora";
  const supportsLiquidityDepthHeatmap =
    supportsMaterializedLiquidityDepth || supportsReplayedLiquidityDepth;
  const [activeTab, setActiveTab] = useState<"overview" | "lp-analysis" | "trading" | "performance" | "incentives">("overview");
  const priceChartRef = useRef<PriceChartHandle>(null);
  const liquidityDistChartRef = useRef<LiquidityDistributionChartHandle>(null);
  const priceImpactChartRef = useRef<PriceImpactChartHandle>(null);
  const lpDistComparisonChartRef = useRef<LPDistributionComparisonChartHandle>(null);
  const lpRangesChartRef = useRef<LPRangesByAddressChartHandle>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const isDemoPool = isDemoSpaceSlug(selectedSpaceSlug);
  const shouldProbeMerklOpportunity = selectedSpaceSlug === ZEROG_SPACE_SLUG;
  const incentiveCampaign = useMemo(
    () => {
      const campaign = INCENTIVE_CAMPAIGNS[poolKey.toLowerCase()] ?? null;
      if (campaign) return campaign;
      if (isKrakenLikeSpace(selectedSpaceSlug)) return { start: "2026-03-17", end: "2026-09-17" };
      return null;
    },
    [poolKey, selectedSpaceSlug]
  );
  const solanaPools = useMemo(
    () => supportedPools.filter((p) => p.protocol === "raydium" || p.protocol === "meteora"),
    [supportedPools]
  );

  // Fetch Merkl opportunity data (TVL, campaigns) for incentivized pools (skip Kraken — uses xPoints)
  const { data: merklOpportunity, isLoading: merklLoading } = useMerklOpportunity(
    (incentiveCampaign || shouldProbeMerklOpportunity) && !isKrakenPool ? poolKey : undefined,
    selectedSupportedPool?.chainId ?? 480,
    true
  );
  const hasMerklCampaigns = Boolean(merklOpportunity?.campaigns?.length);
  const hasIncentivesTab = Boolean(incentiveCampaign || hasMerklCampaigns);

  const merklCampaignPeriods = useMemo(() => {
    if (!merklOpportunity?.campaigns || merklOpportunity.campaigns.length === 0) {
      return incentiveCampaign
        ? [{ campaignId: "__fallback__", start: incentiveCampaign.start, end: incentiveCampaign.end }]
        : [];
    }
    const toISO = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    return [...merklOpportunity.campaigns]
      .sort((a, b) => a.startTimestamp - b.startTimestamp)
      .map((campaign) => ({
        campaignId: campaign.campaignId,
        start: toISO(campaign.startTimestamp),
        end: toISO(campaign.endTimestamp),
      }));
  }, [incentiveCampaign, merklOpportunity?.campaigns]);

  useEffect(() => {
    setSelectedCampaignId(null);
  }, [poolKey]);

  useEffect(() => {
    if (!selectedCampaignId) return;
    if (!merklCampaignPeriods.some((campaign) => campaign.campaignId === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
  }, [merklCampaignPeriods, selectedCampaignId]);

  const selectedCampaignPeriod = useMemo(
    () => merklCampaignPeriods.find((campaign) => campaign.campaignId === selectedCampaignId) ?? null,
    [merklCampaignPeriods, selectedCampaignId]
  );

  // Expand the chart window to cover the full Merkl campaign history when available.
  const effectiveCampaign = useMemo(() => {
    if (!incentiveCampaign && merklCampaignPeriods.length === 0) return null;
    if (merklCampaignPeriods.length === 0) return incentiveCampaign;
    return {
      start: merklCampaignPeriods[0].start,
      end: merklCampaignPeriods[merklCampaignPeriods.length - 1].end,
    };
  }, [incentiveCampaign, merklCampaignPeriods]);

  const visibleCampaignWindow = selectedCampaignPeriod ?? effectiveCampaign;

  const needsOverviewData = activeTab === "overview";
  const needsLpData = activeTab === "overview" || activeTab === "lp-analysis";
  const needsTradingData =
    activeTab === "overview" ||
    activeTab === "trading" ||
    activeTab === "performance";
  const needsSlippageData = activeTab === "overview" || activeTab === "trading";
  const needsPerformanceData = activeTab === "overview" || activeTab === "performance";
  const needsIncentivesData = activeTab === "incentives" && !!effectiveCampaign;
  const needsNonIncentiveData = activeTab !== "incentives";
  const isAnalyticsStagePending = (_stage: number) => false;

  const selectPool = useCallback((nextPoolKey: string) => {
    const nextKey = normalizePoolKey(nextPoolKey);
    setSelectedPoolKey(nextKey);
    const next = new URLSearchParams(searchParams.toString());
    next.set("pool", nextKey);
    router.push(`${pathname}?${next.toString()}`);
  }, [pathname, router, searchParams, setSelectedPoolKey]);
  
  const {
    timeRange,
    granularity,
    topMetricsDenomination,
    liquidityTargetMode,
    liquidityTargetUsd,
    lpActivityOracleRange,
    oracleSource,
    setOracleSource,
    slippageOrderSizeUsd,
    liquidityPricingMode,
    useRealTickSpacing,
    panelVisibility,
  } = useChartSettingsStore();

  // Always fetch real historical data with selected timeframe
  // IMPORTANT: positions, tickLiquidity, and impactBandEvents are now fetched atomically
  // to prevent race conditions in impact band calculations.
  const {
    chartData: lpActivityData,
    lpEvents: _lpActivityEvents,
    impactBandEvents: lpActivityImpactBandEvents,
    v3Swaps: lpActivityV3Swaps,
    tickLiquidity: lpActivityTickLiquidity,
    positions: lpActivityPositions, // Atomic positions for impact band
    meta: worldchainPoolDataMeta,
    precomputedImpactBand: lpActivityPrecomputedImpactBand,
    precomputedDepthBand: lpActivityPrecomputedDepthBand,
    isLoading: historicalLoading,
  } = useLPHistoricalData({
    poolAddress: poolKey,
    // Ranges are now driven by the selected LP via tokenId-level Position rows.
    // Avoid duplicating Position fetch inside this hook.
    marketMakerAddress: undefined,
    timeRange,
    granularity,
    oracleRangePct: lpActivityOracleRange,
    oracleSource,
    oracleTokenAddress:
      poolData && priceOracle.isUSDStableBySymbol(poolData.token0Symbol) && !priceOracle.isUSDStableBySymbol(poolData.token1Symbol)
        ? poolData.token1Address
        : poolData?.token0Address,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    enabled: needsNonIncentiveData,
    spaceSlug: selectedSpaceSlug,
  });

  // Fetch all LP positions for Current LPs list (may have incorrect owner data)
  const {
    data: allLPPositions,
    isLoading: lpPositionsLoading,
    error: lpPositionsError,
  } = useAllLPPositions(poolKey, needsNonIncentiveData && supportsOwnerPositionSummary);

  // NEW: Fetch ALL positions grouped by ACTUAL wallet address (source of truth for LP concentration)
  const {
    data: allPoolPositions,
    isLoading: allPoolPositionsLoading,
  } = useAllPoolPositions(poolKey, needsNonIncentiveData && supportsRangeLiquidityShape);

  // Derive positions-by-owner from allPoolPositions (single paginated query, no rate limiting).
  // Previously used usePositionsForOwners which fired one query per owner (~50 parallel requests)
  // and got rate-limited by the legacy GraphQL path, causing incomplete data and liquidity undercounting.
  const allLPPositionsData = useMemo(() => {
    if (!allPoolPositions || allPoolPositions.length === 0) return [] as PositionsForOwnerResult[];
    return allPoolPositions.map((o) => ({ owner: o.owner, positions: o.positions }));
  }, [allPoolPositions]);
  const allLPPositionsDataLoading = allPoolPositionsLoading;

  const allPositionsFlattened = useMemo(() => {
    return flattenPositions(allLPPositionsData);
  }, [allLPPositionsData]);
  const hasPositionRangeData = allPositionsFlattened.length > 0;

  // Fetch pool day data for fee chart
  const {
    data: poolDayData,
    isLoading: poolDayDataLoading,
  } = usePoolDayData(poolKey, 30, needsTradingData);

  // Track actual data range for dynamic title
  const [tradingVolumeDataRange, setTradingVolumeDataRange] = useState<{
    days: number;
    startDate: Date;
    endDate: Date;
  } | null>(null);

  // Selected LP owner (drives the 3 custom metric widgets)
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  // Active LPs vs Closed LPs tab in the LP Deep Dive list.
  const [lpListTab, setLpListTab] = useState<"active" | "closed">("active");
  const defaultSelectedOwner =
    worldchainPoolDataMeta?.selectedOwner &&
    worldchainPoolDataMeta.selectedOwner.positionCount > 0
      ? worldchainPoolDataMeta.selectedOwner.owner
      : allLPPositions?.[0]?.owner ?? null;
  const effectiveSelectedOwner = selectedOwner ?? defaultSelectedOwner;

  // Section divider hover state for blur effect
  const [sectionDividerHovered, setSectionDividerHovered] = useState(false);

  // Pool Analytics collapsible state (collapsed by default)

  // Track which position tokenIds are excluded (deselected)
  const [excludedPositionIds, setExcludedPositionIds] = useState<Set<string>>(new Set());

  // Grid layout state - temporarily disabled to restore functionality
  const layoutLocked = true;

  const {
    data: selectedPositions,
    isLoading: selectedPositionsLoading,
  } = usePositionsByOwner({
    poolAddress: poolKey,
    owner: effectiveSelectedOwner,
    limit: 5000,
    enabled: needsLpData && !!effectiveSelectedOwner && supportsOwnerCompositionHistory,
  });

  // Reset selection when pool changes
  useEffect(() => {
    setSelectedOwner(null);
    setExcludedPositionIds(new Set());
  }, [poolKey]);

  // Reset excluded positions when owner changes
  const prevOwnerRef = useRef(effectiveSelectedOwner);
  useEffect(() => {
    if (prevOwnerRef.current !== effectiveSelectedOwner) {
      setExcludedPositionIds(new Set());
      prevOwnerRef.current = effectiveSelectedOwner;
    }
  }, [effectiveSelectedOwner]);

  // Filter positions to only include selected (non-excluded) ones
  const activePositions = useMemo(() => {
    if (!selectedPositions) return [];
    return selectedPositions.filter((p: PositionData) => !excludedPositionIds.has(p.tokenId));
  }, [selectedPositions, excludedPositionIds]);
  const selectedPositionsFromOwnerSnapshot = useMemo(() => {
    if (!effectiveSelectedOwner) return [] as PositionData[];
    const ownerLc = effectiveSelectedOwner.toLowerCase();
    return (
      (allLPPositionsData as PositionsForOwnerResult[] | undefined)?.find(
        (item) => item.owner.toLowerCase() === ownerLc
      )?.positions ?? []
    );
  }, [allLPPositionsData, effectiveSelectedOwner]);
  const selectedPositionsForDistribution = useMemo(() => {
    return selectedPositionsFromOwnerSnapshot.length > 0
      ? selectedPositionsFromOwnerSnapshot
      : selectedPositions ?? [];
  }, [selectedPositions, selectedPositionsFromOwnerSnapshot]);

  // When no tokenIds are selected (e.g., user deselected all positions), render custom metrics in a disabled gray state.
  const customMetricsDisabled = useMemo(() => {
    if (!supportsOwnerCompositionHistory) return true;
    if (!effectiveSelectedOwner) return true;
    if (selectedPositionsLoading) return false;
    return activePositions.length === 0;
  }, [activePositions.length, effectiveSelectedOwner, selectedPositionsLoading, supportsOwnerCompositionHistory]);

  // Display convention for all charts:
  // - Prefer "volatile/stable" ordering when exactly one side is USD-stable
  // - Always display price as "base per quote" (first symbol per second symbol)
  //
  // Note: poolData.currentPrice is token1 per token0.
  const displayPairFromPool = useMemo(() => {
    if (!poolData) return null;
    return getPoolDisplayPair({
      poolKey,
      token0Symbol: poolData.token0Symbol,
      token1Symbol: poolData.token1Symbol,
    });
  }, [poolData, poolKey]);

  // Fetch 1-year price spread data (pool price vs CoinGecko oracle)
  const {
    data: priceSpreadData,
    isLoading: priceSpreadLoading,
  } = usePriceSpreadData({
    poolAddress: poolKey,
    token0Address:
      poolData && priceOracle.isUSDStableBySymbol(poolData.token0Symbol) && !priceOracle.isUSDStableBySymbol(poolData.token1Symbol)
        ? poolData.token1Address
        : poolData?.token0Address,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    invert: displayPairFromPool?.invert ?? false,
    enabled: needsOverviewData && !!poolData,
    spaceSlug: selectedSpaceSlug,
  });

  const toDisplayPrice = useMemo(() => {
    const inv = displayPairFromPool?.invert ?? false;
    return (p: number) => (inv && Number.isFinite(p) && p > 0 ? 1 / p : p);
  }, [displayPairFromPool?.invert]);

  // USD prices for both tokens (from backend-cached DefiLlama response).
  // These are used for USD-valued charts (liquidity distribution, price impact, LP sizes) on non-stablecoin pairs.
  const tokenPriceMap = useTokenPrices([poolData?.token0Address, poolData?.token1Address]);
  const token0UsdPriceFromOracle =
    poolData?.token0Address ? tokenPriceMap.data?.[poolData.token0Address.toLowerCase()] ?? null : null;
  const token1UsdPriceFromOracle =
    poolData?.token1Address ? tokenPriceMap.data?.[poolData.token1Address.toLowerCase()] ?? null : null;
  const token0UsdPrice = useMemo(() => {
    if (typeof token0UsdPriceFromOracle === "number" && Number.isFinite(token0UsdPriceFromOracle)) {
      return token0UsdPriceFromOracle;
    }
    if (merklOpportunity?.tokens && poolData?.token0Address) {
      const addr = poolData.token0Address.toLowerCase();
      const match = merklOpportunity.tokens.find((token) => token.address.toLowerCase() === addr);
      if (match?.price && match.price > 0) return match.price;
    }
    return token0UsdPriceFromOracle;
  }, [merklOpportunity?.tokens, poolData?.token0Address, token0UsdPriceFromOracle]);
  const token1UsdPrice = useMemo(() => {
    if (typeof token1UsdPriceFromOracle === "number" && Number.isFinite(token1UsdPriceFromOracle)) {
      return token1UsdPriceFromOracle;
    }
    if (merklOpportunity?.tokens && poolData?.token1Address) {
      const addr = poolData.token1Address.toLowerCase();
      const match = merklOpportunity.tokens.find((token) => token.address.toLowerCase() === addr);
      if (match?.price && match.price > 0) return match.price;
    }
    return token1UsdPriceFromOracle;
  }, [merklOpportunity?.tokens, poolData?.token1Address, token1UsdPriceFromOracle]);

  // Normalize into a complete USD pricing pair when possible, so non-stable/non-stable pools
  // can still compute USD totals (and gracefully fall back when prices are missing).
  const usdPrices = useMemo(() => {
    const p = poolData?.currentPrice;
    const t0 =
      typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
        ? token0UsdPrice
        : typeof token1UsdPrice === "number" &&
            Number.isFinite(token1UsdPrice) &&
            typeof p === "number" &&
            Number.isFinite(p) &&
            p > 0
          ? token1UsdPrice * p
          : null;
    const t1 =
      typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
        ? token1UsdPrice
        : typeof token0UsdPrice === "number" &&
            Number.isFinite(token0UsdPrice) &&
            typeof p === "number" &&
            Number.isFinite(p) &&
            p > 0
          ? token0UsdPrice / p
          : null;

    const hasUsd = typeof t0 === "number" && Number.isFinite(t0) && typeof t1 === "number" && Number.isFinite(t1);
    return {
      token0Usd: t0,
      token1Usd: t1,
      hasUsd,
      unit: hasUsd ? "USD" : (poolData?.token1Symbol ?? "token1"),
    };
  }, [poolData?.currentPrice, poolData?.token1Symbol, token0UsdPrice, token1UsdPrice]);

  // Trading Volume by Size - fetch 7 days of swap data for daily aggregation
  const tradingVolumeEnabled = !!poolKey && supportsSwapHistory;
  const {
    data: tradingVolumeSwaps,
    isLoading: tradingVolumeLoading,
    error: tradingVolumeError,
  } = useTradingVolumeBySize({
    poolAddress: poolKey,
    days: 7,
    enabled: needsTradingData && tradingVolumeEnabled && panelVisibility.tradingVolumeBySize,
    token0UsdPrice: usdPrices.token0Usd,
    token1UsdPrice: usdPrices.token1Usd,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
  });

  // Fetch volume-by-time-of-day data for hourly/daily volume patterns
  const {
    data: volumeByTimeData,
    isLoading: volumeByTimeLoading,
  } = useVolumeByTime({
    poolAddress: poolKey,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    token0UsdPrice: usdPrices.token0Usd,
    token1UsdPrice: usdPrices.token1Usd,
    days: 30,
    enabled: needsTradingData && !!poolData,
    spaceSlug: selectedSpaceSlug,
  });

  const formatUsdPrice = (p: number | null) => {
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) return "---";
    if (p >= 1000) return `$${p.toFixed(0)}`;
    if (p >= 1) return `$${p.toFixed(2)}`;
    return `$${p.toFixed(4)}`;
  };

  // Toggle position selection
  const togglePositionSelection = (tokenId: string) => {
    setExcludedPositionIds((prev) => {
      const next = new Set(prev);
      if (next.has(tokenId)) {
        next.delete(tokenId);
      } else {
        next.add(tokenId);
      }
      return next;
    });
  };

  // Total liquidity across all active positions (for share-based sizing)
  const totalLPLiquidity = useMemo(() => {
    if (!allLPPositions || allLPPositions.length === 0) return BigInt(0);
    return allLPPositions.reduce(
      (sum: bigint, pos: OwnerPositionAggregateData) => sum + BigInt(pos.liquidityTotal),
      BigInt(0)
    );
  }, [allLPPositions]);

  // Fetch tick liquidity for liquidity distribution chart (±8000 ticks)
  const { data: tickLiquidityData, isLoading: tickLiquidityLoading } = useTickLiquidity(
    poolKey,
    poolData?.tick,
    (needsLpData || needsPerformanceData) && supportsRangeLiquidityShape
  );

  // Fetch full range tick liquidity for price impact chart and v4 balance estimation (all ticks)
  const { data: tickLiquidityFullRangeData, isLoading: tickLiquidityFullRangeLoading } = useTickLiquidityFullRange(
    poolKey,
    (needsLpData || needsTradingData || protocol === "v4") &&
      (protocol === "v4" || supportsRangeLiquidityShape || supportsCurrentImpactCurve)
  );

  const positionPoolBalances = useMemo(() => {
    if (protocol !== "v4") return null;
    return computePositionTokenBalances({ poolData, positions: allPositionsFlattened });
  }, [protocol, poolData, allPositionsFlattened]);

  // v4 pools don't have a per-pool contract address, so ERC20.balanceOf is not available.
  // Prefer indexed PoolManager balances when present; position/tick math remains the fallback for older backends.
  const estimatedPoolBalances = useMemo(() => {
    if (protocol !== "v4") return null;
    return estimatePoolBalancesFromTickLiquidity({ tickData: tickLiquidityFullRangeData ?? tickLiquidityData, poolData });
  }, [protocol, tickLiquidityFullRangeData, tickLiquidityData, poolData]);

  const effectivePoolBalances = useMemo(() => {
    if (!poolData) return null;

    if (protocol === "v4" && poolData.v4TvlSource === "indexed-pool") {
      const t0 = Number(poolData.token0Balance);
      const t1 = Number(poolData.token1Balance);
      return {
        token0BalanceStr: poolData.token0Balance,
        token1BalanceStr: poolData.token1Balance,
        token0BalanceNum: Number.isFinite(t0) ? t0 : 0,
        token1BalanceNum: Number.isFinite(t1) ? t1 : 0,
        token0Percent: poolData.token0Percent,
        token1Percent: poolData.token1Percent,
      };
    }

    const v4Balances = positionPoolBalances ?? estimatedPoolBalances;
    if (protocol === "v4" && v4Balances) {
      const t0 = v4Balances.token0Balance;
      const t1 = v4Balances.token1Balance;
      return {
        token0BalanceStr: String(Number.isFinite(t0) ? t0 : 0),
        token1BalanceStr: String(Number.isFinite(t1) ? t1 : 0),
        token0BalanceNum: Number.isFinite(t0) ? t0 : 0,
        token1BalanceNum: Number.isFinite(t1) ? t1 : 0,
        token0Percent: v4Balances.token0Percent,
        token1Percent: v4Balances.token1Percent,
      };
    }

    // v3 (or v4 fallback when indexed positions/ticks are missing): use balances from the data source as-is.
    const t0 = Number(poolData.token0Balance);
    const t1 = Number(poolData.token1Balance);
    return {
      token0BalanceStr: poolData.token0Balance,
      token1BalanceStr: poolData.token1Balance,
      token0BalanceNum: Number.isFinite(t0) ? t0 : 0,
      token1BalanceNum: Number.isFinite(t1) ? t1 : 0,
      token0Percent: poolData.token0Percent,
      token1Percent: poolData.token1Percent,
    };
  }, [poolData, protocol, positionPoolBalances, estimatedPoolBalances]);

  // Fetch pool metrics (volume, fees, TVL changes)
  const poolMetrics = usePoolMetrics({
    poolAddress: poolKey,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    token1Symbol: poolData?.token1Symbol,
    enabled: needsNonIncentiveData,
  });

  const shouldForceTickDistribution =
    shouldUseWorldchainTickDistribution(worldchainPoolDataMeta) ||
    shouldForcePerleBscPancakeTickDistribution(poolKey);
  const shouldNormalizePancakeLpAttribution =
    shouldForcePerleBscPancakeTickDistribution(poolKey);
  const shouldZeroFillWorldchainEvents = shouldUseWorldchainZeroFill(worldchainPoolDataMeta);

  // Fetch LP entry/exit data
  const { chartData: lpEntryExitData, rawEvents: lpEntryExitRawEvents, isLoading: lpEntryExitLoading } = useLPEntryExitData(
    poolKey,
    7,
    (needsLpData || needsSlippageData) && supportsHistoricalDepthBands,
    {
      authoritativeEmptyWindow: shouldZeroFillWorldchainEvents,
    }
  );

  // Long-lookback pool events for the Closed LPs tab (full closed-position
  // history, not just the 7-day window above). Shares React Query cache with
  // useOwnerRebalances' internal 365-day fetch, so it's essentially free.
  const { rawEvents: lpLifecycleRawEvents, isLoading: lpLifecycleLoading } = useLPEntryExitData(
    poolKey,
    365,
    needsLpData && supportsHistoricalDepthBands,
  );

  // Fetch liquidity history by address (7-day window, hourly buckets — replays
  // events backwards from current state). Hourly granularity gives 168 points
  // across the week so the LDT chart shows intraday liquidity changes; the
  // historical pool price map is still keyed daily (same price reused for all
  // 24 hours of that day) and current token USD prices are used for valuation.
  // User-selectable lookback for "Liquidity Distribution Over Time". Hourly
  // granularity for short windows (intraday detail); daily for longer ones to
  // keep the snapshot count and event-replay reasonable.
  const [ldtLookbackDays, setLdtLookbackDays] = useState<number>(7);
  // User-selectable lookback for the "Slippage History" chart, independent of the
  // global time-range selector (default 7D).
  const [slippageLookbackDays, setSlippageLookbackDays] = useState<number>(7);
  // Historical daily prices covering the selected window (dedupes with the
  // shared 30d poolDayData query for short windows; widens for 60/90d).
  const { data: ldtDayData } = usePoolDayData(
    poolKey,
    Math.max(ldtLookbackDays + 2, 30),
    needsLpData && supportsOwnerCompositionHistory,
  );
  const ldtDailyPriceMap = useMemo(() => {
    const source = ldtDayData ?? poolDayData;
    if (!source || source.length === 0) return undefined;
    const map = new Map<number, string>();
    for (const day of source) if (day.closePrice) map.set(day.date, day.closePrice);
    return map;
  }, [ldtDayData, poolDayData]);
  const { data: liquidityHistoryData, isLoading: liquidityHistoryLoading } = useLiquidityHistoryByAddress(
    poolKey,
    ldtLookbackDays,
    poolData?.token0Decimals ?? 18,
    poolData?.token1Decimals ?? 6,
    poolData?.sqrtPriceX96,
    usdPrices.token0Usd,
    usdPrices.token1Usd,
    ldtDailyPriceMap,
    needsLpData && supportsOwnerCompositionHistory,
    selectedSpaceSlug,
    ldtLookbackDays <= 14 ? "hour" : "day"
  );

  // Convert to chart data format
  const liquidityHistoryChartData = useMemo(() => {
    if (!liquidityHistoryData) return [];
    return convertToChartData(liquidityHistoryData);
  }, [liquidityHistoryData]);

  const incentiveDays = useMemo(
    () => (effectiveCampaign ? getCampaignDaysFromStart(effectiveCampaign) : 0),
    [effectiveCampaign]
  );

  const { data: dayDataIncentive, isLoading: dayDataIncentiveLoading } = usePoolDayData(
    poolKey,
    Math.max(1, incentiveDays),
    needsIncentivesData
  );

  const dailyPriceMapIncentive = useMemo(() => {
    if (!dayDataIncentive || dayDataIncentive.length === 0) return undefined;
    const map = new Map<number, string>();
    for (const day of dayDataIncentive) {
      if (day.closePrice) map.set(day.date, day.closePrice);
    }
    return map;
  }, [dayDataIncentive]);

  // Fetch liquidity history via event replay (accurate TVL) — only for incentivized pools
  const { data: liquidityHistoryIncentiveData, isLoading: liquidityHistoryIncentiveLoading } = useLiquidityHistoryByAddress(
    poolKey,
    incentiveDays,
    poolData?.token0Decimals ?? 18,
    poolData?.token1Decimals ?? 6,
    poolData?.sqrtPriceX96,
    usdPrices.token0Usd,
    usdPrices.token1Usd,
    dailyPriceMapIncentive,
    needsIncentivesData && supportsOwnerCompositionHistory,
    selectedSpaceSlug
  );

  // Extract totalUsd per day for a simple area chart, filtered to campaign window
  const tvlIncentiveChartData = useMemo(() => {
    if (!liquidityHistoryIncentiveData?.snapshots || liquidityHistoryIncentiveData.snapshots.length === 0 || !visibleCampaignWindow) return [];
    const windowStart = new Date(visibleCampaignWindow.start);
    windowStart.setDate(windowStart.getDate() - 30);
    const startEpoch = Math.floor(windowStart.getTime() / 1000);
    const windowEnd = new Date(visibleCampaignWindow.end);
    windowEnd.setDate(windowEnd.getDate() + 30);
    const endEpoch = Math.floor(windowEnd.getTime() / 1000);
    return liquidityHistoryIncentiveData.snapshots
      .filter((s) => s.date >= startEpoch && s.date <= endEpoch)
      .map((s) => ({ date: formatIncentiveChartDate(s.date), tvl: s.totalUsd }));
  }, [liquidityHistoryIncentiveData, visibleCampaignWindow]);

  // Build per-day stacked reward bars from Merkl campaigns, using each day's
  // closest historical token price when available.
  const dailyRewardBars = useMemo(() => {
    if (!merklOpportunity?.campaigns || merklOpportunity.campaigns.length === 0 || !liquidityHistoryIncentiveData?.snapshots || !visibleCampaignWindow) return [];

    const windowStart = new Date(visibleCampaignWindow.start);
    windowStart.setDate(windowStart.getDate() - 30);
    const startEpoch = Math.floor(windowStart.getTime() / 1000);
    const windowEnd = new Date(visibleCampaignWindow.end);
    windowEnd.setDate(windowEnd.getDate() + 30);
    const endEpoch = Math.floor(windowEnd.getTime() / 1000);

    return liquidityHistoryIncentiveData.snapshots
      .filter((s) => s.date >= startEpoch && s.date <= endEpoch)
      .map((s) => {
        const dayStart = s.date;
        const dayEnd = dayStart + 86400;
        const totalsBySymbol = new Map<string, number>();
        for (const c of merklOpportunity.campaigns) {
          const dailyUsd = getCampaignDailyUsdForDay(c, dayStart);
          if (c.startTimestamp < dayEnd && c.endTimestamp > dayStart && dailyUsd > 0) {
            const symbol = (c.rewardToken.symbol || "???").toUpperCase();
            totalsBySymbol.set(symbol, (totalsBySymbol.get(symbol) ?? 0) + dailyUsd);
          }
        }
        const stacks = [...totalsBySymbol.entries()].map(([symbol, dailyUsd]) => ({ symbol, dailyUsd }));
        return { date: formatIncentiveChartDate(s.date), stacks };
      });
  }, [merklOpportunity?.campaigns, liquidityHistoryIncentiveData?.snapshots, visibleCampaignWindow]);

  // Build synthetic xPoints reward bars for Kraken pools (500 xP/day during campaign)
  const krakenXpointsBars = useMemo(() => {
    if (!isKrakenPool || !incentiveCampaign || !liquidityHistoryIncentiveData?.snapshots || !visibleCampaignWindow) return [];
    const campaignStartEpoch = Math.floor(new Date(incentiveCampaign.start + "T00:00:00Z").getTime() / 1000);
    const windowStart = new Date(visibleCampaignWindow.start);
    windowStart.setDate(windowStart.getDate() - 30);
    const startEpoch = Math.floor(windowStart.getTime() / 1000);
    const windowEnd = new Date(visibleCampaignWindow.end);
    windowEnd.setDate(windowEnd.getDate() + 30);
    const endEpoch = Math.floor(windowEnd.getTime() / 1000);
    return liquidityHistoryIncentiveData.snapshots
      .filter((s) => s.date >= startEpoch && s.date <= endEpoch)
      .map((s) => ({
        date: formatIncentiveChartDate(s.date),
        stacks: s.date >= campaignStartEpoch ? [{ symbol: "xPoints", dailyUsd: 500 }] : [],
      }));
  }, [isKrakenPool, incentiveCampaign, liquidityHistoryIncentiveData?.snapshots, visibleCampaignWindow]);

  // Compute daily volume in USD from PoolDayData, filtered to campaign window.
  const volumeIncentiveChartData = useMemo(() => {
    if (!dayDataIncentive || dayDataIncentive.length === 0 || !poolData || !visibleCampaignWindow) return [];
    const t1d = poolData.token1Decimals ?? 6;
    const t1Usd = usdPrices.token1Usd ?? 0;
    if (t1Usd <= 0) return [];
    const windowStart = new Date(visibleCampaignWindow.start);
    windowStart.setDate(windowStart.getDate() - 30);
    const windowEnd = new Date(visibleCampaignWindow.end);
    windowEnd.setDate(windowEnd.getDate() + 30);
    const startEpoch = Math.floor(windowStart.getTime() / 1000);
    const endEpoch = Math.floor(windowEnd.getTime() / 1000);
    const sorted = [...dayDataIncentive]
      .filter((d) => d.date >= startEpoch && d.date <= endEpoch)
      .sort((a, b) => a.date - b.date);
    return sorted.map((d) => {
      const vol = (Number(d.volumeToken1) / 10 ** t1d) * t1Usd;
      return { date: formatIncentiveChartDate(d.date), volume: vol };
    });
  }, [dayDataIncentive, poolData, usdPrices.token1Usd, visibleCampaignWindow]);

  // Compute USD size per owner from current pool price + tokenId-level positions
  const lpUsdByOwner = useMemo(() => {
    if (!poolData) return new Map<string, number>();
    const items = (allLPPositionsData ?? []) as PositionsForOwnerResult[];

    const sqrtPriceX96 = BigInt(poolData.sqrtPriceX96);
    const map = new Map<string, number>();

    // Phase 1: Compute exact USD from position-level data
    for (const item of items) {
      const owner = item.owner;
      const positions = item.positions;
      let totalUsd = 0;
      for (const p of positions) {
        const liq = BigInt(p.liquidity);
        if (liq <= BigInt(0)) continue;

        const { amount0, amount1 } = amountsForPosition({
          liquidity: liq,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          sqrtPriceX96,
        });

        const amt0 = bigintToApproxNumber(amount0, poolData.token0Decimals);
        const amt1 = bigintToApproxNumber(amount1, poolData.token1Decimals);
        // Always use USD prices for both tokens (token ordering is by address, not by stablecoin)
        totalUsd += amt0 * (usdPrices.token0Usd ?? 0) + amt1 * (usdPrices.token1Usd ?? 0);
      }

      map.set(owner.toLowerCase(), totalUsd);
    }

    // Phase 2: For LPs in allLPPositions that have no position-level data
    // (e.g. Railway indexer Position entity is stale), estimate USD
    // proportionally from pool token balances and their liquidity share.
    if (allLPPositions && allLPPositions.length > 0 && totalLPLiquidity > 0n) {
      const t0Usd = usdPrices.token0Usd ?? 0;
      const t1Usd = usdPrices.token1Usd ?? 0;
      const poolToken0Balance = Number(effectivePoolBalances?.token0BalanceStr ?? poolData.token0Balance);
      const poolToken1Balance = Number(effectivePoolBalances?.token1BalanceStr ?? poolData.token1Balance);
      const poolTvlUsd =
        (Number.isFinite(poolToken0Balance) ? poolToken0Balance : 0) * t0Usd +
        (Number.isFinite(poolToken1Balance) ? poolToken1Balance : 0) * t1Usd;

      if (poolTvlUsd > 0) {
        for (const lp of allLPPositions) {
          const ownerLc = lp.owner.toLowerCase();
          if (map.has(ownerLc)) continue; // Already has exact USD
          const ownerLiq = BigInt(lp.liquidityTotal);
          if (ownerLiq <= 0n) continue;
          const share = Number((ownerLiq * 1_000_000n) / totalLPLiquidity) / 1_000_000;
          map.set(ownerLc, poolTvlUsd * share);
        }
      }
    }

    return map;
  }, [poolData, allLPPositionsData, allLPPositions, totalLPLiquidity, usdPrices.token0Usd, usdPrices.token1Usd, effectivePoolBalances]);

  // Calculate liquidity distribution for sharing between charts. Position-based
  // bars stay the default, except for pools whose current tick liquidity is the
  // reliable source for pool-level distribution.
  const distributionPositions = shouldForceTickDistribution
    ? undefined
    : allPositionsFlattened.length > 0
      ? allPositionsFlattened
      : undefined;
  const liquidityDistributionPositions =
    shouldNormalizePancakeLpAttribution && allPositionsFlattened.length > 0
      ? allPositionsFlattened
      : distributionPositions;

  // Diagnostic: compare pool on-chain liquidity vs position-derived liquidity at current tick
  useEffect(() => {
    if (!IS_DEV || !poolData || allPositionsFlattened.length === 0) return;
    const currentTick = poolData.tick;
    const onChainLiq = BigInt(poolData.liquidity);
    let positionLiq = 0n;
    for (const pos of allPositionsFlattened) {
      if (pos.tickLower <= currentTick && currentTick < pos.tickUpper) {
        try { positionLiq += BigInt(pos.liquidity); } catch { /* skip */ }
      }
    }
    const diff = onChainLiq - positionLiq;
    const pctGap = onChainLiq > 0n ? Number(diff * 10000n / onChainLiq) / 100 : 0;
  }, [poolData, allPositionsFlattened]);

  // Historical Slippage data for slippage history chart
  // Uses position-based rollback for accurate historical calculations when positions + events are available
  const {
    data: slippageData,
    isLoading: slippageLoading,
  } = useHistoricalSlippage({
    poolAddress: poolKey,
    timeRange,
    lookbackDays: slippageLookbackDays,
    orderSizeUsd: slippageOrderSizeUsd,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    token0UsdPrice: usdPrices.token0Usd,
    token1UsdPrice: usdPrices.token1Usd,
    enabled: needsSlippageData && !!poolKey && panelVisibility.slippageHistory && supportsHistoricalSlippage,
    // Position-based rollback calculation (ground truth)
    allPositions: allPositionsFlattened.length > 0 ? allPositionsFlattened : undefined,
    lpEvents: lpEntryExitRawEvents,
    // Pass loading states so hook waits instead of using fallback
    positionsLoading: allLPPositionsDataLoading,
    eventsLoading: lpEntryExitLoading,
  });

  const { bars: liquidityDistributionBars, useUsd: liquidityDistributionUseUsd } = useLiquidityDistribution({
    allPositions: liquidityDistributionPositions,
    tickData: tickLiquidityFullRangeData, // Fallback if positions not loaded yet
    currentPrice: poolData?.currentPrice ?? 0,
    currentTick: poolData?.tick ?? 0,
    currentLiquidity: poolData?.liquidity ?? "0",
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    token0UsdPrice: usdPrices.token0Usd,
    token1UsdPrice: usdPrices.token1Usd,
    tickSpacing: poolData?.tickSpacing,
    zoomLevel: 0, // Full range for comparison chart
    liquidityPricingMode, // Pass pricing mode for tick-based pricing
    useRealTickSpacing, // Honor real tick-spacing toggle from settings
  });
  const hasLiquidityDistributionValues = useMemo(
    () => liquidityDistributionBars.some((bar) => bar.totalValue > 0),
    [liquidityDistributionBars]
  );

  // Current LPs list should be ordered by "Size" (desc) when we can compute it.
  // Fall back to liquidityTotal ordering when USD size isn't available yet.
  type CurrentLpDisplayRow = { lp: OwnerPositionAggregateData; usd?: number };
  const currentLPsSortedForDisplay = useMemo<CurrentLpDisplayRow[]>(() => {
    if (!allLPPositions || allLPPositions.length === 0) return [];

    const rows: CurrentLpDisplayRow[] = allLPPositions.map((lp: OwnerPositionAggregateData) => {
      const usd = lpUsdByOwner.get(lp.owner.toLowerCase());
      return { lp, usd };
    });

    rows.sort((a, b) => {
      const au = a.usd;
      const bu = b.usd;
      if (typeof au === "number" && typeof bu === "number") return bu - au;
      if (typeof au === "number") return -1;
      if (typeof bu === "number") return 1;

      const la = BigInt(a.lp.liquidityTotal);
      const lb = BigInt(b.lp.liquidityTotal);
      return la > lb ? -1 : la < lb ? 1 : 0;
    });

    return rows;
  }, [allLPPositions, lpUsdByOwner]);

  // Closed LPs: every owner that has at least one CLOSED position lifecycle in
  // this pool (reconstructed from events), aggregated by wallet. Includes wallets
  // that are still active (their past closed positions) and wallets that have
  // fully exited. Sorted by most recent exit.
  type ClosedLpRow = { owner: string; closedCount: number; peakLiquidity: number; lastClosedAt: number };
  const closedLPsSortedForDisplay = useMemo<ClosedLpRow[]>(() => {
    if (!poolData || !lpLifecycleRawEvents || lpLifecycleRawEvents.length === 0) return [];
    const lifecycles = reconstructAllLifecycles(lpLifecycleRawEvents, {
      token0Decimals: poolData.token0Decimals,
      token1Decimals: poolData.token1Decimals,
    });
    const byOwner = new Map<string, ClosedLpRow>();
    for (const lc of lifecycles) {
      if (lc.closedAt == null) continue; // only closed lifecycles
      const cur =
        byOwner.get(lc.owner) ?? { owner: lc.owner, closedCount: 0, peakLiquidity: 0, lastClosedAt: 0 };
      cur.closedCount += 1;
      cur.peakLiquidity += lc.liquidity;
      if (lc.closedAt > cur.lastClosedAt) cur.lastClosedAt = lc.closedAt;
      byOwner.set(lc.owner, cur);
    }
    return [...byOwner.values()].sort(
      (a, b) => b.lastClosedAt - a.lastClosedAt || b.closedCount - a.closedCount,
    );
  }, [poolData, lpLifecycleRawEvents]);

  // Normalized owner lists for the Historical Liquidity Depth heatmap address picker.
  const heatmapActiveOwners = useMemo(
    () =>
      currentLPsSortedForDisplay.map((r) => ({
        owner: r.lp.owner.toLowerCase(),
        valueUsd: typeof r.usd === "number" ? r.usd : null,
      })),
    [currentLPsSortedForDisplay],
  );
  const heatmapClosedOwners = useMemo(
    () =>
      closedLPsSortedForDisplay.map((r) => ({
        owner: r.owner.toLowerCase(),
        closedCount: r.closedCount,
        lastClosedAt: r.lastClosedAt,
      })),
    [closedLPsSortedForDisplay],
  );

  // Calculate LP concentration with position breakdown and USD values
  // Uses allPoolPositions which is the source of truth (grouped by actual wallet address)
  // IMPORTANT: Sort and calculate percentages by USD VALUE, not raw liquidity
  const lpConcentration = useMemo(() => {
    if (!poolData) return [];
    if (!allPoolPositions || allPoolPositions.length === 0) return [];

    const sqrtPriceX96 = BigInt(poolData.sqrtPriceX96);

    // First, calculate USD value for ALL wallets
    const walletsWithUsd = allPoolPositions.map((wallet) => {
      const positionsWithUsd = wallet.positions.map((p) => {
        const liq = BigInt(p.liquidity);
        const { amount0, amount1 } = amountsForPosition({
          liquidity: liq,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          sqrtPriceX96,
        });
        const amt0 = bigintToApproxNumber(amount0, poolData.token0Decimals);
        const amt1 = bigintToApproxNumber(amount1, poolData.token1Decimals);
        const usdValue = amt0 * (usdPrices.token0Usd ?? 0) + amt1 * (usdPrices.token1Usd ?? 0);

        return {
          tokenId: p.tokenId,
          usdValue,
        };
      }).sort((a, b) => b.usdValue - a.usdValue);

      const totalUsd = positionsWithUsd.reduce((sum, p) => sum + p.usdValue, 0);

      return {
        owner: wallet.owner,
        liquidityTotal: wallet.liquidityTotal,
        positions: positionsWithUsd,
        totalUsd,
      };
    });

    // Sort by USD value descending (NOT raw liquidity!)
    walletsWithUsd.sort((a, b) => b.totalUsd - a.totalUsd);

    // Calculate total USD for percentage calculation
    const totalUsdAll = walletsWithUsd.reduce((sum, w) => sum + w.totalUsd, 0);

    // Pass all wallets; LPConcentrationChart owns top-4 + Others grouping.
    return walletsWithUsd.map((wallet) => {
      const percentage = totalUsdAll > 0
        ? (wallet.totalUsd / totalUsdAll) * 100
        : 0;

      return {
        address: wallet.owner,
        percentage,
        liquidity: wallet.liquidityTotal.toString(),
        positions: wallet.positions,
        totalUsd: wallet.totalUsd,
      };
    });
  }, [poolData, allPoolPositions, usdPrices.token0Usd, usdPrices.token1Usd]);

  // Calculate volume attribution by LP using hourly fee data
  // This is much more efficient than per-swap attribution:
  // - Uses pre-aggregated hourly fees (24 rows max)
  // - Attributes fees proportionally by liquidity share at each hour's tick
  // - Fee share = Volume share (since same fee rate for all positions)
  const { attribution: volumeAttribution, totalVolumeUsd: todayVolumeUsd, isLoading: volumeAttributionLoading } = useVolumeAttributionHourly({
    poolAddress: poolKey,
    positionsByOwner: allPoolPositions,
    token1Decimals: poolData?.token1Decimals,
    token1UsdPrice: usdPrices.token1Usd,
    enabled: needsLpData && !!poolKey && !!allPoolPositions && allPoolPositions.length > 0 && supportsHistoricalDepthBands,
  });

  // Build volume concentration data for the treemap
  // IMPORTANT: Sort by VOLUME (not liquidity) - show top volume contributors
  const volumeConcentration = useMemo(() => {
    if (!volumeAttribution || volumeAttribution.length === 0) return [];
    
    // Pass all LPs; LPConcentrationChart owns top-4 + Others grouping.
    const sortedByVolume = [...volumeAttribution]
      .sort((a, b) => b.volumeUsd - a.volumeUsd);
    
    return sortedByVolume.map((item) => ({
      address: item.address,
      percentage: item.volumePercentage,
      volumeUsd: item.volumeUsd,
      hoursActive: item.hoursActive,
      // Empty positions array since we don't have position data from volumeAttribution
      positions: [] as { tokenId: string; usdValue: number }[],
      totalUsd: item.volumeUsd,
    }));
  }, [volumeAttribution]);

  // Build comparison data for the table (ALL LPs, not just top 4)
  // Uses allPoolPositions which is the source of truth (grouped by actual wallet address)
  // IMPORTANT: Sort and calculate percentages by USD VALUE, not raw liquidity
  const lpComparisonData = useMemo(() => {
    if (!poolData) return [];
    if (!allPoolPositions || allPoolPositions.length === 0) return [];

    const sqrtPriceX96 = BigInt(poolData.sqrtPriceX96);
    
    // Calculate USD value for all wallets
    const walletsWithUsd = allPoolPositions.map((wallet) => {
      let totalUsd = 0;
      for (const p of wallet.positions) {
        const liq = BigInt(p.liquidity);
        const { amount0, amount1 } = amountsForPosition({
          liquidity: liq,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          sqrtPriceX96,
        });
        const amt0 = bigintToApproxNumber(amount0, poolData.token0Decimals);
        const amt1 = bigintToApproxNumber(amount1, poolData.token1Decimals);
        totalUsd += amt0 * (usdPrices.token0Usd ?? 0) + amt1 * (usdPrices.token1Usd ?? 0);
      }
      return { owner: wallet.owner, totalUsd };
    });

    // Calculate total USD
    const totalUsdAll = walletsWithUsd.reduce((sum, w) => sum + w.totalUsd, 0);
    
    // Sort by USD descending
    walletsWithUsd.sort((a, b) => b.totalUsd - a.totalUsd);
    
    // Create a map of volume percentages by address
    const volumeMap = new Map<string, { volumePct: number; volumeUsd: number }>();
    for (const item of volumeAttribution) {
      volumeMap.set(item.address.toLowerCase(), {
        volumePct: item.volumePercentage,
        volumeUsd: item.volumeUsd,
      });
    }
    
    return walletsWithUsd.map((wallet) => {
      const liquidityPct = totalUsdAll > 0
        ? (wallet.totalUsd / totalUsdAll) * 100
        : 0;
      
      const volumeData = volumeMap.get(wallet.owner.toLowerCase());
      return {
        address: wallet.owner,
        liquidityPct,
        liquidityUsd: wallet.totalUsd,
        volumePct: volumeData?.volumePct ?? 0,
        volumeUsd: volumeData?.volumeUsd ?? 0,
      };
    });
  }, [poolData, allPoolPositions, volumeAttribution, usdPrices.token0Usd, usdPrices.token1Usd]);

  // General USD conversion for pool prices on X-axis and display.
  // Converts tickToPrice (token1/token0) to USD of the displayed base token.
  const poolUsdConv = useMemo(() => {
    const t0 = typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && token0UsdPrice > 0 ? token0UsdPrice : null;
    const t1 = typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && token1UsdPrice > 0 ? token1UsdPrice : null;
    const canShow = t0 !== null || t1 !== null;
    const inv = displayPairFromPool?.invert ?? false;

    // Convert a raw pool price (token1/token0) to the base token's USD price
    const toUsd = (p: number): number => {
      if (!Number.isFinite(p) || p <= 0 || !canShow) return inv ? (p > 0 ? 1 / p : p) : p;
      if (!inv) {
        if (t1 !== null) return p * t1;
        if (t0 !== null) return t0 / p;
      } else {
        if (t0 !== null) return t0 / p;
        if (t1 !== null) return p * t1;
      }
      return inv ? (p > 0 ? 1 / p : p) : p;
    };

    // Whether the conversion inverts the price direction (requires swapping OHLC high/low)
    const inverts = !inv ? (t1 === null && t0 !== null) : (t0 !== null);

    return { canShow, t0, t1, toUsd, inverts };
  }, [token0UsdPrice, token1UsdPrice, displayPairFromPool?.invert]);

  // Derive values from pool data for custom metrics (uses activePositions - filtered by selection)
  const selectedLpDerived = useMemo(() => {
    if (!poolData) return null;
    if (!effectiveSelectedOwner) return null;
    if (!activePositions || activePositions.length === 0) return null;

    const sqrtPriceX96 = BigInt(poolData.sqrtPriceX96);
    let amount0Raw = BigInt(0);
    let amount1Raw = BigInt(0);

    const lowerPrices: number[] = [];
    const upperPrices: number[] = [];

    for (const p of activePositions) {
      const liq = BigInt(p.liquidity);
      if (liq <= BigInt(0)) continue;

      const { amount0, amount1 } = amountsForPosition({
        liquidity: liq,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        sqrtPriceX96,
      });
      amount0Raw += amount0;
      amount1Raw += amount1;

      // IMPORTANT: when we invert the displayed price (e.g. show token0/token1 instead of token1/token0),
      // the numeric ordering of a range can flip. Always normalize so lower < upper in *display space*.
      const pl = toDisplayPrice(tickToPrice(p.tickLower, poolData.token0Decimals, poolData.token1Decimals));
      const pu = toDisplayPrice(tickToPrice(p.tickUpper, poolData.token0Decimals, poolData.token1Decimals));
      lowerPrices.push(Math.min(pl, pu));
      upperPrices.push(Math.max(pl, pu));
    }

    const amount0 = bigintToApproxNumber(amount0Raw, poolData.token0Decimals);
    const amount1 = bigintToApproxNumber(amount1Raw, poolData.token1Decimals);

    // Always use USD prices for both tokens (token ordering is by address, not by stablecoin)
    const usd0 = amount0 * (usdPrices.token0Usd ?? 0);
    const usd1 = amount1 * (usdPrices.token1Usd ?? 0);
    const totalUsd = usd0 + usd1;

    const leftPercent = totalUsd > 0 ? Math.round((usd0 / totalUsd) * 100) : 50;
    const rightPercent = 100 - leftPercent;

    const displayCurrentPrice = toDisplayPrice(poolData.currentPrice);
    const rangeStart = lowerPrices.length ? Math.min(...lowerPrices) : displayCurrentPrice * 0.95;
    const rangeEnd = upperPrices.length ? Math.max(...upperPrices) : displayCurrentPrice * 1.05;
    const minPrice = Math.min(rangeStart, displayCurrentPrice) * 0.95;
    const maxPrice = Math.max(rangeEnd, displayCurrentPrice) * 1.05;

    const autoTargetUsd = totalUsd > 0 ? totalUsd / 2 : 0;
    const targetUsd = liquidityTargetMode === "manual" ? liquidityTargetUsd : autoTargetUsd;

    // Convert display prices to USD when possible
    let priceRangeCurrentPrice: number;
    let priceRangeMinPrice: number;
    let priceRangeMaxPrice: number;
    let priceRangeStart: number;
    let priceRangeEnd: number;

    if (poolUsdConv.canShow) {
      const usdCurrent = poolUsdConv.toUsd(poolData.currentPrice);
      priceRangeCurrentPrice = usdCurrent;

      // lowerPrices/upperPrices are display-converted (toDisplayPrice = inv ? 1/p : p).
      // Undo inversion to get raw pool prices, then convert to USD.
      const inv = displayPairFromPool?.invert ?? false;
      const usdLower = lowerPrices
        .map(p => poolUsdConv.toUsd(inv && p > 0 ? 1 / p : p))
        .filter(p => Number.isFinite(p) && p > usdCurrent * 0.001 && p < usdCurrent * 1000);
      const usdUpper = upperPrices
        .map(p => poolUsdConv.toUsd(inv && p > 0 ? 1 / p : p))
        .filter(p => Number.isFinite(p) && p > usdCurrent * 0.001 && p < usdCurrent * 1000);

      const allUsd = [...usdLower, ...usdUpper];
      const usdRangeStart = usdLower.length ? Math.min(...usdLower) : usdCurrent * 0.95;
      const usdRangeEnd = usdUpper.length ? Math.max(...usdUpper) : usdCurrent * 1.05;

      priceRangeStart = Math.min(usdRangeStart, usdRangeEnd);
      priceRangeEnd = Math.max(usdRangeStart, usdRangeEnd);
      priceRangeMinPrice = Math.min(priceRangeStart, usdCurrent) * 0.95;
      priceRangeMaxPrice = Math.max(priceRangeEnd, usdCurrent) * 1.05;
    } else {
      priceRangeCurrentPrice = displayCurrentPrice;
      priceRangeMinPrice = minPrice;
      priceRangeMaxPrice = maxPrice;
      priceRangeStart = rangeStart;
      priceRangeEnd = rangeEnd;
    }
    
    const priceRangeData: PriceRangeData = {
      currentPrice: priceRangeCurrentPrice,
      minPrice: priceRangeMinPrice,
      maxPrice: priceRangeMaxPrice,
      rangeStart: priceRangeStart,
      rangeEnd: priceRangeEnd,
      tickCount: 10,
      labelCount: 3,
      priceLabel: poolUsdConv.canShow
        ? `${displayPairFromPool?.baseSymbol ?? poolData.token0Symbol} Price (USD) (Selected LP)`
        : `${displayPairFromPool?.unitLabel ?? `${poolData.token0Symbol} per ${poolData.token1Symbol}`} (Selected LP)`,
      formatPrice: poolUsdConv.canShow
        ? (p) => p < 0.001 ? p.toExponential(3) : p.toFixed(6)
        : (p) => p.toFixed(6),
      valuePrefix: poolUsdConv.canShow ? "$" : "",
      disabled: customMetricsDisabled,
    };

    const liquidityTargetData: LiquidityTargetData = {
      tokens: [
        { symbol: poolData.token0Symbol, actual: usd0, target: targetUsd },
        { symbol: poolData.token1Symbol, actual: usd1, target: targetUsd },
      ],
      disabled: customMetricsDisabled,
    };

    const inventoryTiltData: InventoryTiltData = {
      leftToken: { symbol: poolData.token0Symbol, percent: leftPercent },
      rightToken: { symbol: poolData.token1Symbol, percent: rightPercent },
      threshold: 5,
      disabled: customMetricsDisabled,
    };

    return { priceRangeData, liquidityTargetData, inventoryTiltData };
  }, [effectiveSelectedOwner, poolData, activePositions, liquidityTargetMode, liquidityTargetUsd, usdPrices.token0Usd, usdPrices.token1Usd]);

  const selectedLpRanges = useMemo(() => {
    if (!poolData) return [];
    if (!effectiveSelectedOwner) return [];
    if (!activePositions || activePositions.length === 0) return [];
    
    const currentUsdPrice = poolUsdConv.canShow ? poolUsdConv.toUsd(poolData.currentPrice) : null;

    return activePositions
      .filter((p: PositionData) => BigInt(p.liquidity) > BigInt(0))
      .map((p: PositionData) => {
        const tickPriceLower = tickToPrice(p.tickLower, poolData.token0Decimals, poolData.token1Decimals);
        const tickPriceUpper = tickToPrice(p.tickUpper, poolData.token0Decimals, poolData.token1Decimals);

        let lower: number;
        let upper: number;

        if (poolUsdConv.canShow && currentUsdPrice) {
          let usdLower = poolUsdConv.toUsd(tickPriceLower);
          let usdUpper = poolUsdConv.toUsd(tickPriceUpper);

          // Clamp extreme values (full-range positions) to sensible display bounds
          const minBound = currentUsdPrice * 0.1;
          const maxBound = currentUsdPrice * 10;
          usdLower = Math.max(minBound, Math.min(maxBound, usdLower));
          usdUpper = Math.max(minBound, Math.min(maxBound, usdUpper));

          lower = Math.min(usdLower, usdUpper);
          upper = Math.max(usdLower, usdUpper);
        } else {
          const pl = toDisplayPrice(tickPriceLower);
          const pu = toDisplayPrice(tickPriceUpper);
          lower = Math.min(pl, pu);
          upper = Math.max(pl, pu);
        }

        return { lower, upper, owner: effectiveSelectedOwner };
      });
  }, [effectiveSelectedOwner, poolData, activePositions, toDisplayPrice, poolUsdConv, usdPrices.token0Usd]);

  const priceRangeDataFromPool: PriceRangeData = selectedLpDerived?.priceRangeData ??
    (poolData
      ? (() => {
          if (poolUsdConv.canShow) {
            const usdPrice = poolUsdConv.toUsd(poolData.currentPrice);
            return {
              currentPrice: usdPrice,
              minPrice: usdPrice * 0.9,
              maxPrice: usdPrice * 1.1,
              rangeStart: usdPrice * 0.95,
              rangeEnd: usdPrice * 1.05,
              tickCount: 10,
              labelCount: 3,
              priceLabel: `${displayPairFromPool?.baseSymbol ?? poolData.token0Symbol} Price (USD)`,
              formatPrice: (p: number) => p < 0.001 ? p.toExponential(3) : p.toFixed(6),
              valuePrefix: "$",
              disabled: customMetricsDisabled,
            };
          }

          const basePrice = toDisplayPrice(poolData.currentPrice);
          return {
            currentPrice: basePrice,
            minPrice: basePrice * 0.9,
            maxPrice: basePrice * 1.1,
            rangeStart: basePrice * 0.95,
            rangeEnd: basePrice * 1.05,
            tickCount: 10,
            labelCount: 3,
            priceLabel: displayPairFromPool?.unitLabel ?? `${poolData.token0Symbol} per ${poolData.token1Symbol}`,
            formatPrice: (p: number) => p.toFixed(6),
            disabled: customMetricsDisabled,
          };
        })()
      : priceRangeData);

  const liquidityTargetDataFromPool: LiquidityTargetData = selectedLpDerived?.liquidityTargetData ??
    (poolData
      ? {
          // If no selected LP, default to a sensible target:
          // auto => 10% above current balances, manual => global target
          tokens: [
            {
              symbol: poolData.token0Symbol,
              actual: effectivePoolBalances?.token0BalanceNum ?? parseFloat(poolData.token0Balance),
              target:
                liquidityTargetMode === "manual"
                  ? liquidityTargetUsd
                  : (effectivePoolBalances?.token0BalanceNum ?? parseFloat(poolData.token0Balance)) * 1.1,
            },
            {
              symbol: poolData.token1Symbol,
              actual: effectivePoolBalances?.token1BalanceNum ?? parseFloat(poolData.token1Balance),
              target:
                liquidityTargetMode === "manual"
                  ? liquidityTargetUsd
                  : (effectivePoolBalances?.token1BalanceNum ?? parseFloat(poolData.token1Balance)) * 1.1,
            },
          ],
          disabled: customMetricsDisabled,
        }
      : liquidityTargetData);

  const tokenSymbols = useMemo(
    () => ({
      token0Symbol: poolData?.token0Symbol ?? fallbackPoolSymbols.token0Symbol,
      token1Symbol: poolData?.token1Symbol ?? fallbackPoolSymbols.token1Symbol,
    }),
    [
      fallbackPoolSymbols.token0Symbol,
      fallbackPoolSymbols.token1Symbol,
      poolData?.token0Symbol,
      poolData?.token1Symbol,
    ]
  );

  const denomSymbol = topMetricsDenomination === "token0" ? tokenSymbols.token0Symbol : tokenSymbols.token1Symbol;

  const priceChartConfig = useMemo(() => {
    if (!poolData) {
      return {
        pairLabel: `${tokenSymbols.token0Symbol}/${tokenSymbols.token1Symbol}`,
        unitLabel: `${tokenSymbols.token0Symbol} per ${tokenSymbols.token1Symbol}`,
        baseSymbol: tokenSymbols.token0Symbol,
        quoteSymbol: tokenSymbols.token1Symbol,
        displayPrice: null as number | null,
        invert: false,
      };
    }

    const baseSymbol = displayPairFromPool?.baseSymbol ?? poolData.token0Symbol;
    const quoteSymbol = displayPairFromPool?.quoteSymbol ?? poolData.token1Symbol;
    const invert = displayPairFromPool?.invert ?? false;
    const displayPrice =
      invert && Number.isFinite(poolData.currentPrice) && poolData.currentPrice > 0
        ? 1 / poolData.currentPrice
        : poolData.currentPrice;

    return {
      pairLabel: `${baseSymbol}/${quoteSymbol}`,
      unitLabel: `${baseSymbol} per ${quoteSymbol}`,
      baseSymbol,
      quoteSymbol,
      displayPrice: Number.isFinite(displayPrice) ? displayPrice : null,
      invert,
    };
  }, [poolData, tokenSymbols.token0Symbol, tokenSymbols.token1Symbol, displayPairFromPool]);

  const currentPriceCard = useMemo(() => {
    if (!poolData) return { displayPrice: null as number | null, unitLabel: "" };
    return {
      displayPrice: priceChartConfig.displayPrice,
      unitLabel: priceChartConfig.unitLabel,
    };
  }, [poolData, priceChartConfig.displayPrice, priceChartConfig.unitLabel]);

  // Invert the full LP activity chart data so it matches "base per quote" everywhere.
  const lpActivityDataDisplay = useMemo(() => {
    if (!lpActivityData) return lpActivityData;
    if (!priceChartConfig.invert) return lpActivityData;

    const safeInv = (x: number) => (Number.isFinite(x) && x > 0 ? 1 / x : NaN);
    const ohlcData = (lpActivityData.ohlcData ?? [])
      .map((d) => {
        const open = safeInv(d.open);
        const close = safeInv(d.close);
        const high = safeInv(d.low);
        const low = safeInv(d.high);
        return { ...d, open, high, low, close };
      })
      .filter((d) => Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close));
    const oracleData = lpActivityData.oracleData ?? [];
    const peggingData = ohlcData
      .map((ohlc, i) => {
        const oracle = oracleData[i];
        const oraclePrice = oracle?.price ?? NaN;
        const deviation =
          Number.isFinite(oraclePrice) && oraclePrice > 0
            ? ((ohlc.close - oraclePrice) / oraclePrice) * 100
            : NaN;
        const windowSize = 5;
        const startIdx = Math.max(0, i - windowSize + 1);
        const deviations = ohlcData
          .slice(startIdx, i + 1)
          .map((d, j) => {
            const o = oracleData[startIdx + j];
            const price = o?.price ?? NaN;
            return Number.isFinite(price) && price > 0 ? ((d.close - price) / price) * 100 : NaN;
          })
          .filter(Number.isFinite);
        const smaDeviation =
          deviations.length > 0 ? deviations.reduce((sum, d) => sum + d, 0) / deviations.length : NaN;

        return {
          timestamp: ohlc.timestamp,
          twapPrice: ohlc.close,
          oraclePrice,
          deviation,
          smaDeviation,
        };
      })
      .filter((d) => Number.isFinite(d.oraclePrice) && Number.isFinite(d.deviation));

    return {
      ...lpActivityData,
      ohlcData,
      oracleData,
      peggingData,
      // depthData is in USD; do not invert.
    };
  }, [lpActivityData, priceChartConfig.invert]);

  const priceChartData = useMemo(() => {
    const data = lpActivityData?.ohlcData ?? null;
    if (!data || data.length === 0) return data;
    
    // Convert OHLC prices to USD when token prices are available
    if (poolUsdConv.canShow) {
      return data
        .map((d) => {
          const open = poolUsdConv.toUsd(d.open);
          const close = poolUsdConv.toUsd(d.close);
          // If the conversion inverts the price direction, swap high/low
          const rawHigh = poolUsdConv.toUsd(poolUsdConv.inverts ? d.low : d.high);
          const rawLow = poolUsdConv.toUsd(poolUsdConv.inverts ? d.high : d.low);
          return { ...d, open, high: rawHigh, low: rawLow, close };
        })
        .filter((d) => Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close));
    }

    if (!priceChartConfig.invert) return data;

    // Invert price series (p -> 1/p). Note inversion swaps high/low.
    return data
      .map((d) => {
        const safeInv = (x: number) => (Number.isFinite(x) && x > 0 ? 1 / x : NaN);
        const open = safeInv(d.open);
        const close = safeInv(d.close);
        const high = safeInv(d.low);
        const low = safeInv(d.high);
        return { ...d, open, high, low, close };
      })
      .filter((d) => Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close));
  }, [lpActivityData?.ohlcData, priceChartConfig.invert, poolUsdConv]);

  // Historical rebalances for the selected LP. Uses a dedicated all-time data
  // path (long-window daily candles + the LP's mint/burn events) so the table
  // and timeline span the LP's full history, independent of the dashboard's
  // time-range selector.
  const {
    records: rebalanceRecords,
    summary: rebalanceSummary,
    otherPositions: rebalanceOtherPositions,
    priceSeries: rebalancePriceSeries,
    nowSec: rebalanceNowSec,
    isLoading: rebalanceLoading,
  } = useOwnerRebalances({
    poolAddress: poolKey,
    owner: effectiveSelectedOwner,
    token0Decimals: poolData?.token0Decimals,
    token1Decimals: poolData?.token1Decimals,
    currentTick: poolData?.tick,
    // Anchor to the LP's real current positions so stale phantom positions
    // (whose closing events we never saw) are pruned. Only pass once loaded.
    currentPositions: selectedPositionsLoading ? undefined : selectedPositions,
    // Authoritative pool-wide positions snapshot, so LPs whose mints aren't
    // owner-attributed in events (e.g. router/NFT-manager mints) still render in
    // the replay's rest-of-pool layer.
    allPositions: allPositionsFlattened.length > 0 ? allPositionsFlattened : undefined,
    enabled: needsLpData && supportsHistoricalDepthBands && !!effectiveSelectedOwner,
    spaceSlug: selectedSpaceSlug,
  });

  // Convert a raw token1/token0 price into the displayed orientation (USD when
  // available, otherwise the inverted/non-inverted token price) for the
  // rebalance table/chart.
  const rebalanceToDisplayPrice = useMemo(() => {
    return (raw: number) => (poolUsdConv.canShow ? poolUsdConv.toUsd(raw) : toDisplayPrice(raw));
  }, [poolUsdConv, toDisplayPrice]);

  // Resolve token USD prices: prefer CoinGecko, fall back to Merkl token prices
  const resolvedToken0Usd = useMemo(() => {
    if (usdPrices.token0Usd && Number.isFinite(usdPrices.token0Usd)) return usdPrices.token0Usd;
    // Merkl fallback: match by address
    if (merklOpportunity?.tokens && poolData?.token0Address) {
      const addr = poolData.token0Address.toLowerCase();
      const match = merklOpportunity.tokens.find((t) => t.address.toLowerCase() === addr);
      if (match?.price && match.price > 0) return match.price;
    }
    return usdPrices.token0Usd;
  }, [usdPrices.token0Usd, merklOpportunity?.tokens, poolData?.token0Address]);

  const resolvedToken1Usd = useMemo(() => {
    if (usdPrices.token1Usd && Number.isFinite(usdPrices.token1Usd)) return usdPrices.token1Usd;
    if (merklOpportunity?.tokens && poolData?.token1Address) {
      const addr = poolData.token1Address.toLowerCase();
      const match = merklOpportunity.tokens.find((t) => t.address.toLowerCase() === addr);
      if (match?.price && match.price > 0) return match.price;
    }
    return usdPrices.token1Usd;
  }, [usdPrices.token1Usd, merklOpportunity?.tokens, poolData?.token1Address]);

  // Metric values in USD - multiply token amounts by their USD prices
  const metricToken0ValueUsd = useMemo(() => {
    if (!poolData) return 0;
    const token0 = Number(effectivePoolBalances?.token0BalanceStr ?? poolData.token0Balance);
    if (!Number.isFinite(token0)) return 0;

    // Use USD price if available
    if (resolvedToken0Usd && Number.isFinite(resolvedToken0Usd)) {
      return token0 * resolvedToken0Usd;
    }
    // Fallback: convert via pool price to token1, then to USD
    if (resolvedToken1Usd && Number.isFinite(resolvedToken1Usd) && poolData.currentPrice > 0) {
      return token0 * poolData.currentPrice * resolvedToken1Usd;
    }
    return 0;
  }, [poolData, effectivePoolBalances, resolvedToken0Usd, resolvedToken1Usd]);

  const metricToken1ValueUsd = useMemo(() => {
    if (!poolData) return 0;
    const token1 = Number(effectivePoolBalances?.token1BalanceStr ?? poolData.token1Balance);
    if (!Number.isFinite(token1)) return 0;

    // Use USD price if available
    if (resolvedToken1Usd && Number.isFinite(resolvedToken1Usd)) {
      return token1 * resolvedToken1Usd;
    }
    // Fallback: convert via pool price to token0, then to USD
    if (resolvedToken0Usd && Number.isFinite(resolvedToken0Usd) && poolData.currentPrice > 0) {
      return (token1 / poolData.currentPrice) * resolvedToken0Usd;
    }
    return 0;
  }, [poolData, effectivePoolBalances, resolvedToken0Usd, resolvedToken1Usd]);

  // Pool Liquidity (TVL) - use the same on-chain/indexer balances that power
  // the token breakdown and LP concentration. Merkl TVL is campaign/opportunity
  // TVL and can be lower than full pool liquidity.
  const poolLiquidityValueUsd = useMemo(() => {
    return metricToken0ValueUsd + metricToken1ValueUsd;
  }, [metricToken0ValueUsd, metricToken1ValueUsd]);
  const hasActivePoolLiquidity = hasPositiveBigInt(poolData?.liquidity);
  const hasIndexedV4PoolBalances =
    protocol === "v4" &&
    poolData?.v4TvlSource === "indexed-pool" &&
    Number.isFinite(poolLiquidityValueUsd) &&
    poolLiquidityValueUsd > 0;
  const activeLiquidityEmptyMessage = hasIndexedV4PoolBalances
    ? `Indexed TVL is ${formatUsdCompact(poolLiquidityValueUsd)}, but current active LP liquidity is zero.`
    : "No active LP liquidity is available at the current price.";
  const lpAttributionEmptyMessage = hasIndexedV4PoolBalances
    ? `Indexed TVL is ${formatUsdCompact(poolLiquidityValueUsd)}, but there are no active LP position rows to attribute it by wallet.`
    : "No active LP position rows are available for this pool.";

  return (
    <div className={cn("flex-1 overflow-auto dashboard-canvas")}>
      <ChartSettingsFab />
      {/* Instrument panel — white surface, flush edge-to-edge */}
      <div id="dashboard-top" className="w-full bg-[var(--ts-surface)]">
        {/* Pool Header — instrument panel identity */}
        {isLoading ? (
          <PoolHeaderSkeleton />
        ) : (
          <PoolHeader>
            <PoolTokens>
              <TokenIcon symbol={tokenSymbols.token0Symbol} src={selectedSupportedPool?.logo} />
              <TokenIcon symbol={tokenSymbols.token1Symbol} />
            </PoolTokens>
            <PoolInfo>
              <div className="flex items-center gap-3 flex-wrap">
                <PoolName>{poolData ? priceChartConfig.pairLabel : `${tokenSymbols.token0Symbol}/${tokenSymbols.token1Symbol}`}</PoolName>
                <PoolBadges>
                  <PoolBadge variant="primary">
                    {selectedSupportedPool?.key.startsWith("pancake-v3-")
                      ? "PancakeSwap V3"
                      : selectedSupportedPool?.chainId === 56
                      ? "Pancake Infinity"
                      : selectedSupportedPool?.chainId === 747474
                        ? "Sushi V3"
                      : isWorldchainSolanaPool
                        ? "Solana"
                        : protocol}
                  </PoolBadge>
                  <PoolBadge>
                    {poolData ? formatFeeTier(poolData.fee) : "0.01%"}
                  </PoolBadge>
                </PoolBadges>
              </div>
              {poolData ? (
                <div className="flex items-center gap-4 flex-wrap">
                  <PoolReadout
                    label={poolData.token0Symbol}
                    value={formatUsdPrice(usdPrices.token0Usd)}
                  />
                  <PoolSubDivider />
                  <PoolReadout
                    label={poolData.token1Symbol}
                    value={formatUsdPrice(usdPrices.token1Usd)}
                  />
                  {poolKey && (
                    <>
                      <PoolSubDivider />
                      <PoolAddress
                        address={poolKey}
                        href={poolExplorerHref}
                      />
                    </>
                  )}
                </div>
              ) : null}
            </PoolInfo>
          </PoolHeader>
        )}

        {/* KPI Row — instrument panel readouts */}
        <div className="ts-kpi-row">
          {/* Pool liquidity with token breakdown */}
          {isLoading ? (
            <MetricCardSkeleton />
          ) : (
            <MetricCard>
              <MetricLabel helpTooltip="Total value locked in this pool">Pool Liquidity</MetricLabel>
              {poolData && Number.isFinite(poolLiquidityValueUsd) ? (
                <>
                  <MetricValue>{formatUsdCompact(poolLiquidityValueUsd)}</MetricValue>
                  <MetricUnit>USD</MetricUnit>
                </>
              ) : (
                <>
                  <MetricValue className="ts-kpi-value-empty">—</MetricValue>
                  <span className="ts-kpi-empty-note">Appears once pool data loads.</span>
                </>
              )}
              {poolData && metricToken0ValueUsd > 0 && metricToken1ValueUsd > 0 && (
                <MetricBreakdown>
                  <MetricBreakdownItem
                    label={poolData.token0Symbol}
                    value={formatUsdCompact(metricToken0ValueUsd)}
                    tokenSymbol={poolData.token0Symbol}
                  />
                  <MetricBreakdownItem
                    label={poolData.token1Symbol}
                    value={formatUsdCompact(metricToken1ValueUsd)}
                    tokenSymbol={poolData.token1Symbol}
                  />
                </MetricBreakdown>
              )}
            </MetricCard>
          )}

          {/* Token price */}
          {isLoading ? (
            <MetricCardSkeleton />
          ) : (
            <MetricCard>
              <MetricLabel>{`${priceChartConfig.baseSymbol ?? "Token"} Price`}</MetricLabel>
              {(() => {
                let price: string | null = null;
                if (poolUsdConv.canShow && poolData?.currentPrice) {
                  const usdPrice = poolUsdConv.toUsd(poolData.currentPrice);
                  if (Number.isFinite(usdPrice) && usdPrice > 0) {
                    price = usdPrice < 0.001 ? `$${usdPrice.toExponential(3)}` : formatUsdCompact(usdPrice);
                  }
                }
                if (!price && usdPrices.token0Usd && Number.isFinite(usdPrices.token0Usd) && usdPrices.token0Usd > 0) {
                  price = formatUsdCompact(usdPrices.token0Usd);
                }
                return price ? (
                  <>
                    <MetricValue>{price}</MetricValue>
                    <MetricUnit>USD</MetricUnit>
                  </>
                ) : (
                  <>
                    <MetricValue className="ts-kpi-value-empty">—</MetricValue>
                    <span className="ts-kpi-empty-note">Appears once a USD price is available.</span>
                  </>
                );
              })()}
            </MetricCard>
          )}

          {/* 24h volume */}
          {isLoading || poolMetrics.isLoading ? (
            <MetricCardSkeleton />
          ) : (
            <MetricCard>
              <MetricLabel>24h Volume</MetricLabel>
              {poolMetrics.volume24h > 0 ? (
                <>
                  <MetricValue>{`$${formatCompact(poolMetrics.volume24h)}`}</MetricValue>
                  <MetricUnit>{poolMetrics.denomSymbol}</MetricUnit>
                </>
              ) : (
                <>
                  <MetricValue className="ts-kpi-value-empty">—</MetricValue>
                  <span className="ts-kpi-empty-note">No trades in the last 24h.</span>
                </>
              )}
            </MetricCard>
          )}

          {/* 24h fees */}
          {isLoading || poolMetrics.isLoading ? (
            <MetricCardSkeleton />
          ) : (
            <MetricCard>
              <MetricLabel>24h Fees</MetricLabel>
              {poolMetrics.fees24h > 0 ? (
                <>
                  <MetricValue>{`$${formatCompact(poolMetrics.fees24h)}`}</MetricValue>
                  <MetricUnit>{poolMetrics.denomSymbol}</MetricUnit>
                </>
              ) : (
                <>
                  <MetricValue className="ts-kpi-value-empty">—</MetricValue>
                  <span className="ts-kpi-empty-note">No fees earned in the last 24h.</span>
                </>
              )}
            </MetricCard>
          )}
        </div>

        {/* Dashboard Tabs */}
        <div className="ts-tabs">
          {([
            { key: "overview" as const, label: "Overview" },
            { key: "lp-analysis" as const, label: "LP Analysis" },
            { key: "trading" as const, label: "Trading" },
            { key: "performance" as const, label: "Performance" },
            ...(hasIncentivesTab ? [{ key: "incentives" as const, label: "Incentives" }] : []),
          ]).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "ts-tab",
                activeTab === tab.key && "active"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>{/* end instrument panel */}

        {/* ═══════════════════════════════════════════════════════════════
            POOL-LEVEL ANALYTICS — flush, no gaps between cards
            ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-[var(--ts-page)]">
        <div className="w-full ts-flush-stack">
        {activeTab !== "incentives" && (
        <div
          className={cn(
            "ts-flush-stack transition-all duration-300",
            sectionDividerHovered && "blur-[2px] opacity-60"
          )}
        >
        {/* Price chart and Liquidity Distribution */}
        {(activeTab === "overview" || activeTab === "trading") && (
        <div
          className={cn(
            "ts-flush-grid grid-cols-1",
            !shouldRenderMonadV2NativeCharts && "sm:grid-cols-2 lg:grid-cols-2"
          )}
        >
          {/* Price Chart */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Price Chart",
                sections: [
                  { title: "What it shows", content: "The historical price of the token pair over the selected time range, displayed as candlestick (OHLC) data." },
                  { title: "How to read it", content: "Each candle represents a time period. Green candles indicate price increased (close > open), red candles indicate price decreased. The wicks show the high and low prices during that period." },
                  { title: "Key indicators", content: "Look for trends, support/resistance levels, and volatility patterns to understand market sentiment." },
                ]
              }}>
                {poolUsdConv.canShow
                  ? `${priceChartConfig.baseSymbol ?? "Token"} Price (USD) (${timeRange})`
                  : `${priceChartConfig.pairLabel} (${timeRange})`
                }
              </ChartTitle>
              {/* Zoom controls — segmented control in header */}
              <div className="bp-chart-controls">
                <button type="button" onClick={() => priceChartRef.current?.zoomOut()}>−</button>
                <button type="button" onClick={() => priceChartRef.current?.zoomIn()}>+</button>
                <button type="button" onClick={() => priceChartRef.current?.fitContent()}>Fit</button>
              </div>
            </ChartHeader>
            <ChartContent>
              {isAnalyticsStagePending(1) || historicalLoading ? (
                <ChartContentSkeleton variant="line" />
              ) : priceChartData ? (
                <LightweightPriceChart
                  ref={priceChartRef}
                  key={`${poolKey}-${timeRange}-${priceChartConfig.invert ? "inv" : "n"}`}
                  data={priceChartData}
                />
              ) : (
                <BarChartPlaceholder />
              )}
            </ChartContent>
          </ChartCard>

          {/* Liquidity Distribution Chart */}
          {!shouldRenderMonadV2NativeCharts && (
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Liquidity Distribution",
                sections: [
                  { title: "What it shows", content: "How liquidity is distributed across different price ticks in the pool. Each bar represents the amount of liquidity available at that price level." },
                  { title: "How to read it", content: "Taller bars indicate more liquidity concentrated at that price. The current price is marked, and you can see how much liquidity would be available for trades at various price points." },
                  { title: "Key indicators", content: "Concentrated liquidity around the current price means better execution for trades. Sparse liquidity may lead to higher slippage." },
                ]
              }}>Liquidity Distribution</ChartTitle>
              <div className="bp-chart-controls">
                <button type="button" onClick={() => liquidityDistChartRef.current?.zoomOut()}>−</button>
                <button type="button" onClick={() => liquidityDistChartRef.current?.zoomIn()}>+</button>
                <button type="button" onClick={() => liquidityDistChartRef.current?.reset()}>Reset</button>
              </div>
            </ChartHeader>
            <ChartContent>
              {!supportsRangeLiquidityShape ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.rangeLiquidity} />
              ) : isAnalyticsStagePending(2) || allLPPositionsDataLoading || tickLiquidityFullRangeLoading ? (
                <ChartContentSkeleton variant="bars" />
              ) : !poolData ? (
                <BarChartPlaceholder />
              ) : !hasLiquidityDistributionValues ? (
                <ChartUnavailableState
                  title="No active liquidity"
                  message={activeLiquidityEmptyMessage}
                />
              ) : (
                <LiquidityDistributionChart
                  ref={liquidityDistChartRef}
                  allPositions={liquidityDistributionPositions}
                  tickData={tickLiquidityFullRangeData} 
                  currentPrice={poolData.currentPrice}
                  currentTick={poolData.tick}
                  currentLiquidity={poolData.liquidity}
                  token0Decimals={poolData.token0Decimals}
                  token1Decimals={poolData.token1Decimals}
                  token0Symbol={poolData.token0Symbol}
                  token1Symbol={poolData.token1Symbol}
                  token0UsdPrice={usdPrices.token0Usd}
                  token1UsdPrice={usdPrices.token1Usd}
                  tickSpacing={poolData.tickSpacing}
                  invertPrice={priceChartConfig.invert}
                />
              )}
            </ChartContent>
          </ChartCard>
          )}
        </div>
        )}

        {shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "lp-analysis") && (
          <MonadV2NativeCharts className="ts-flush-grid grid-cols-1" />
        )}

        {/* Price Impact and Slippage History */}
        {!shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "trading") && (
        <div className="ts-flush-grid grid-cols-1 lg:grid-cols-2">
          {/* Price Impact Chart */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Price Impact",
                sections: [
                  { title: "What it shows", content: "The estimated price impact (slippage) for different trade sizes. It helps you understand how much the price will move when executing trades of various sizes." },
                  { title: "How to read it", content: "The X-axis shows trade size in USD, the Y-axis shows the resulting price impact as a percentage. Steeper curves indicate less liquidity and higher slippage for larger trades." },
                  { title: "Key indicators", content: "Lower price impact for your intended trade size means better execution. Compare buy vs sell impact to identify directional liquidity imbalances." },
                ]
              }}>Price Impact</ChartTitle>
              <div className="bp-chart-controls">
                <button type="button" onClick={() => priceImpactChartRef.current?.zoomOut()}>−</button>
                <button type="button" onClick={() => priceImpactChartRef.current?.zoomIn()}>+</button>
                <button type="button" onClick={() => priceImpactChartRef.current?.reset()}>Reset</button>
              </div>
            </ChartHeader>
            <ChartContent>
              {!supportsCurrentImpactCurve ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.currentImpact} />
              ) : isAnalyticsStagePending(2) || tickLiquidityFullRangeLoading ? (
                <ChartContentSkeleton variant="line" />
              ) : !poolData ? (
                <AreaChartPlaceholder />
              ) : !hasActivePoolLiquidity ? (
                <ChartUnavailableState
                  title="No active liquidity"
                  message={activeLiquidityEmptyMessage}
                />
              ) : (tickLiquidityFullRangeData || distributionPositions) ? (
                <PriceImpactChart
                  ref={priceImpactChartRef}
                  allPositions={distributionPositions}
                  tickData={tickLiquidityFullRangeData} 
                  currentPrice={poolData.currentPrice}
                  currentTick={poolData.tick}
                  currentLiquidity={poolData.liquidity}
                  sqrtPriceX96={poolData.sqrtPriceX96}
                  token0Decimals={poolData.token0Decimals}
                  token1Decimals={poolData.token1Decimals}
                  token0Symbol={poolData.token0Symbol}
                  token1Symbol={poolData.token1Symbol}
                  token0UsdPrice={usdPrices.token0Usd}
                  token1UsdPrice={usdPrices.token1Usd}
                  invertPrice={priceChartConfig.invert}
                />
              ) : (
                <ChartUnavailableState
                  title="No liquidity data"
                  message="No range-liquidity rows are available for this pool yet."
                />
              )}
            </ChartContent>
          </ChartCard>

          {/* Slippage History Chart */}
          <ChartCard>
            <ChartHeader>
              <div className="flex items-center justify-between w-full gap-3">
                <ChartTitle helpContent={{
                  title: "Slippage History",
                  sections: [
                    { title: "What it shows", content: "Historical slippage for a fixed order size over time. This helps you understand how trading conditions have changed." },
                    { title: "How to read it", content: "The chart shows the estimated slippage percentage for the displayed order size at different points in time. Higher values indicate worse execution conditions." },
                    { title: "Key indicators", content: "Consistent low slippage indicates stable liquidity. Spikes may correlate with high volatility periods or liquidity withdrawals." },
                  ]
                }}>
                  Slippage History (${(slippageOrderSizeUsd / 1000).toFixed(0)}k)
                </ChartTitle>
                <div
                  className="inline-flex items-center gap-0.5 rounded-md bg-[var(--bp-bg-primary)] p-0.5 shrink-0"
                  role="group"
                  aria-label="Time range"
                >
                  {[7, 14, 30, 60, 90, 120].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSlippageLookbackDays(d)}
                      aria-pressed={slippageLookbackDays === d}
                      className={cn(
                        "cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-colors tabular-nums",
                        slippageLookbackDays === d
                          ? "bg-[var(--bp-bg-card)] text-[var(--bp-text-primary)] shadow-sm"
                          : "text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)]",
                      )}
                    >
                      {d}D
                    </button>
                  ))}
                </div>
              </div>
            </ChartHeader>
            <ChartContent>
              {!supportsHistoricalSlippage ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.historicalSlippage} />
              ) : isAnalyticsStagePending(3) ? (
                <ChartContentSkeleton variant="line" />
              ) : poolData && !hasActivePoolLiquidity ? (
                <ChartUnavailableState
                  title="No active liquidity"
                  message={activeLiquidityEmptyMessage}
                />
              ) : (
                <SlippageHistoryChart
                  data={slippageData}
                  orderSizeUsd={slippageOrderSizeUsd}
                  token0Symbol={poolData?.token0Symbol}
                  token1Symbol={poolData?.token1Symbol}
                  isLoading={slippageLoading}
                />
              )}
            </ChartContent>
          </ChartCard>
        </div>
        )}

        {/* LP Metrics Row: Concentration | Volume Concentration | Comparison Table */}
        {!shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "lp-analysis") && (
        <div className="ts-flush-grid grid-cols-1 md:grid-cols-3">
          {/* LP Concentration (Liquidity) */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "LP Concentration",
                sections: [
                  { title: "What it shows", content: "Distribution of liquidity among different liquidity providers (LPs) in the pool." },
                  { title: "How to read it", content: "Each segment represents one LP's share of the total liquidity. Hover over segments to see the LP's address, NFT ID, and USD value." },
                  { title: "Key indicators", content: "A highly concentrated chart (few large segments) indicates the pool depends on a small number of LPs, which may pose withdrawal risk." },
                ]
              }}>LP Concentration TVL</ChartTitle>
            </ChartHeader>
            <ChartContent className="h-full">
              {!supportsRangeLiquidityShape ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
              ) : isAnalyticsStagePending(1) || allPoolPositionsLoading ? (
                <ChartContentSkeleton variant="bars" />
              ) : lpPositionsError ? (
                <div className="text-sm text-red-600 text-center py-4 wrap-break-word">
                  Failed to load LP data:{" "}
                  {lpPositionsError instanceof Error
                    ? lpPositionsError.message
                    : String(lpPositionsError)}
                </div>
              ) : lpConcentration.length > 0 ? (
                <LPConcentrationChart
                  data={lpConcentration.map((lp) => ({
                    address: lp.address,
                    percentage: lp.percentage,
                    label: formatLpLabel(lp.address, selectedSpaceSlug),
                    positions: lp.positions,
                    totalUsd: lp.totalUsd,
                  }))}
                  valueUnit={usdPrices.unit}
                  selectedAddress={effectiveSelectedOwner}
                  onSelect={(address) => setSelectedOwner(address)}
                  spaceSlug={selectedSpaceSlug}
                  className="h-full w-full min-h-[200px]"
                />
              ) : (
                <ChartUnavailableState
                  title="No active LP positions"
                  message={lpAttributionEmptyMessage}
                />
              )}
            </ChartContent>
          </ChartCard>

          {/* Volume Concentration (24h) */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Volume Concentration (24h)",
                sections: [
                  { title: "What it shows", content: "Distribution of trading volume among LPs based on which positions captured the swaps. Volume is attributed proportionally to each LP's liquidity at the tick where swaps occurred." },
                  { title: "How to read it", content: "Each segment represents one LP's share of the total volume captured today. Larger segments indicate LPs capturing more trading fees." },
                  { title: "Key indicators", content: "Compare with LP Concentration to see if volume distribution matches liquidity distribution. LPs with higher volume share than liquidity share are more efficient." },
                ]
              }}>Volume Concentration (24h)</ChartTitle>
            </ChartHeader>
            <ChartContent className="h-full">
              {!supportsHistoricalDepthBands ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
              ) : isAnalyticsStagePending(2) || allPoolPositionsLoading || volumeAttributionLoading ? (
                <ChartContentSkeleton variant="bars" />
              ) : !hasPositionRangeData ? (
                <ChartUnavailableState
                  title="No active LP positions"
                  message="No active LP position rows are available to attribute 24h volume by wallet."
                />
              ) : volumeConcentration.length > 0 ? (
                <LPConcentrationChart
                  data={volumeConcentration.map((item) => ({
                    address: item.address,
                    percentage: item.percentage,
                    label: formatLpLabel(item.address, selectedSpaceSlug),
                    positions: item.positions, // Use same positions for NFT ID display
                    totalUsd: item.totalUsd,
                  }))}
                  valueUnit={usdPrices.unit}
                  selectedAddress={effectiveSelectedOwner}
                  onSelect={(address) => setSelectedOwner(address)}
                  spaceSlug={selectedSpaceSlug}
                  className="h-full w-full min-h-[200px]"
                />
              ) : (
                <div className="text-sm text-[var(--bp-text-light)] text-center py-4">
                  {todayVolumeUsd === 0 ? "No volume in last 24h — this pool may still be indexing" : "No volume data available"}
                </div>
              )}
            </ChartContent>
          </ChartCard>

          {/* LP Comparison Table */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "LP Efficiency Comparison",
                sections: [
                  { title: "What it shows", content: "A comparison of each LP's liquidity share vs their volume share, with an efficiency ratio." },
                  { title: "How to read it", content: "Efficiency > 1x means the LP is capturing more volume than their liquidity share suggests. This indicates well-positioned liquidity around active price ranges." },
                  { title: "Key indicators", content: "Green (>1.2x) = highly efficient, Gray (0.8-1.2x) = neutral, Red (<0.8x) = underperforming. LPs with narrow ranges at the current price typically have higher efficiency." },
                ]
              }}>LP Efficiency</ChartTitle>
            </ChartHeader>
            <ChartContent className="h-full p-2">
              {!supportsHistoricalDepthBands ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
              ) : isAnalyticsStagePending(2) || allPoolPositionsLoading || volumeAttributionLoading ? (
                <ChartContentSkeleton variant="bars" />
              ) : !hasPositionRangeData ? (
                <ChartUnavailableState
                  title="No active LP positions"
                  message="No active LP position rows are available to compare liquidity share with volume share."
                />
              ) : lpComparisonData.length > 0 ? (
                <LPComparisonTable
                  data={lpComparisonData}
                  selectedAddress={effectiveSelectedOwner}
                  onSelect={(address) => setSelectedOwner(address)}
                  spaceSlug={selectedSpaceSlug}
                  className="h-full"
                />
              ) : (
                <div className="text-sm text-[var(--bp-text-light)] text-center py-4">
                  No data yet for this pool/time range
                </div>
              )}
            </ChartContent>
          </ChartCard>
        </div>
        )}

        {/* LP Activity Chart (full width) */}
        {!shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "lp-analysis") && (
        <ChartCard>
          <ChartHeader>
            <ChartTitle helpContent={{
              title: "LP Activity - New vs Exits",
              sections: [
                { title: "What it shows", content: "Liquidity provider activity over the last 7 days, showing new liquidity additions (mints) and removals (burns) aggregated by hour." },
                { title: "How to read it", content: "Bars above zero represent liquidity added, bars below zero represent liquidity removed. Each color represents a unique LP address. Hover for details including USD value and NFT ID." },
                { title: "Key indicators", content: "Net positive flow indicates growing liquidity. Large single-address movements may signal whale activity. Watch for concentrated positions (marked with lightning icon)." },
              ]
            }}>LP Activity - New vs Exits (7 Days)</ChartTitle>
          </ChartHeader>
          <ChartContent className="min-h-[180px]">
            {!supportsHistoricalDepthBands ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
            ) : isAnalyticsStagePending(2) || lpEntryExitLoading ? (
              <ChartContentSkeleton variant="bars" />
            ) : lpEntryExitData.length > 0 ? (
              <LPEntryExitChart 
                data={lpEntryExitData} 
                rawEvents={lpEntryExitRawEvents}
                token0Decimals={poolData?.token0Decimals}
                token1Decimals={poolData?.token1Decimals}
                token0UsdPrice={usdPrices.token0Usd}
                token1UsdPrice={usdPrices.token1Usd}
                currentPrice={poolData?.currentPrice}
                sqrtPriceX96={poolData?.sqrtPriceX96}
                poolKey={poolKey}
                positionsByOwner={allLPPositionsData as { owner: string; positions: PositionData[] }[] | undefined}
                spaceSlug={selectedSpaceSlug}
              />
            ) : (
              <LineChartPlaceholder />
            )}
          </ChartContent>
        </ChartCard>
        )}

        {/* Capital Efficiency (full width) */}
        {!shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "performance") && (
        <ChartCard id="capital-efficiency">
          <ChartHeader>
            <ChartTitle helpContent={{
              title: "Historical Liquidity Depth",
              sections: [
                { title: "What it shows", content: "A time x price heatmap of liquidity depth, where brighter cells hold more liquidity at that price. The white line is the pool price over time. It is the on-chain analog of a market-depth heatmap." },
                { title: "How to read it", content: "Bright horizontal bands are price levels where LPs concentrated liquidity; gaps are thin liquidity. Fixed keeps an absolute price axis; Follow centers the view around price." },
                { title: "Notes", content: "Raydium CLMM pools use the Solana indexer's materialized USD depth payload. When that payload includes owner bands, address filters, Include inactive, and cell drill-down use the materialized owner data; EVM range-liquidity pools still use replay fallback." },
              ]
            }}>Historical Liquidity Depth</ChartTitle>
          </ChartHeader>
          <ChartContent>
            {!supportsLiquidityDepthHeatmap ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.rangeLiquidity} />
            ) : !poolData ? (
              <ChartContentSkeleton variant="line" />
            ) : (
              <HistoricalLiquidityDepthHeatmap
                poolAddress={poolKey}
                token0Symbol={poolData.token0Symbol}
                token1Symbol={poolData.token1Symbol}
                invertPrice={priceChartConfig.invert}
                spaceSlug={selectedSpaceSlug}
                activeOwners={heatmapActiveOwners}
                closedOwners={heatmapClosedOwners}
                rawEvents={lpLifecycleRawEvents}
                allPositions={allPositionsFlattened}
                token0Decimals={poolData.token0Decimals}
                token1Decimals={poolData.token1Decimals}
                currentTick={poolData.tick}
                currentPrice={poolData.currentPrice}
                token0UsdPrice={usdPrices.token0Usd}
                token1UsdPrice={usdPrices.token1Usd}
                tickSpacing={poolData.tickSpacing}
                useMaterializedDepth={supportsMaterializedLiquidityDepth}
                enabled={needsLpData && supportsLiquidityDepthHeatmap}
              />
            )}
          </ChartContent>
        </ChartCard>
        )}

        {/* Trading Volume + Fee Earnings side by side */}
        {(activeTab === "overview" || activeTab === "trading" || activeTab === "performance") && (
        <div id="trading-volume" className="ts-flush-grid grid-cols-1 lg:grid-cols-2">
          {/* Trading Volume by Size Chart */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Trading Volume by Size",
                sections: [
                  { title: "What it shows", content: "Distribution of trading volume categorized by trade size buckets (e.g., small, medium, large trades)." },
                  { title: "How to read it", content: "Each bar represents the total volume from trades within that size range. This helps identify whether the pool is dominated by retail or whale activity." },
                  { title: "Key indicators", content: "Heavy concentration in large trade buckets may indicate institutional or whale activity. Diverse distribution suggests healthy retail participation." },
                ]
              }}>
                Trading volume by size
                {tradingVolumeDataRange && (
                  <span className="text-xs text-[var(--bp-text-muted)] ml-2">
                    ({tradingVolumeDataRange.days}d)
                  </span>
                )}
              </ChartTitle>
            </ChartHeader>
            <ChartContent className="min-h-[280px]">
              {!tradingVolumeEnabled ? (
                <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
                  <span>
                    Trading Volume by Size is currently available for v3 addresses and v4 pool keys
                  </span>
                  <span className="text-xs text-gray-300">
                    (selected pool key: {poolKey ? poolKey.slice(0, 18) + "…" : "none"})
                  </span>
                </div>
              ) : tradingVolumeError ? (
                <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
                  <span>Failed to load swap data</span>
                  <span className="text-xs text-gray-300 max-w-[520px] text-center">
                    {tradingVolumeError.message}
                  </span>
                </div>
              ) : isAnalyticsStagePending(3) || tradingVolumeLoading || tokenPriceMap.isLoading || !poolData ? (
                <ChartContentSkeleton variant="bars" />
              ) : (
                <TradingVolumeBySizeChart
                  swapData={[]}
                  dailyData={tradingVolumeSwaps?.dailyData}
                  token0Decimals={poolData.token0Decimals}
                  token1Decimals={poolData.token1Decimals}
                  token0UsdPrice={usdPrices.token0Usd}
                  token1UsdPrice={usdPrices.token1Usd}
                  isLoading={tradingVolumeLoading || tokenPriceMap.isLoading}
                  onDataRangeChange={setTradingVolumeDataRange}
                />
              )}
            </ChartContent>
          </ChartCard>

          {/* Fee Earnings Chart */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Fee Earnings by LP",
                sections: [
                  { title: "What it shows", content: "Estimated fee earnings distribution among liquidity providers over the last 7 days, based on their share of active liquidity." },
                  { title: "How to read it", content: "Each segment represents an LP's estimated share of the total fees earned. Fees are proportional to liquidity share and how often that liquidity was used in trades." },
                  { title: "Key indicators", content: "LPs with concentrated positions around the current price typically earn more fees. Compare fee earnings to position size to assess capital efficiency." },
                ]
              }}>Fee Earnings by LP (7D)</ChartTitle>
            </ChartHeader>
            <ChartContent className="min-h-[280px]">
              {isAnalyticsStagePending(3) || poolDayDataLoading || lpPositionsLoading || liquidityHistoryLoading || tokenPriceMap.isLoading || !poolData ? (
                <ChartContentSkeleton variant="bars" />
              ) : (
                <FeeEarningsChart
                  poolDayData={poolDayData ?? []}
                  lpOwners={(allLPPositions ?? []).map((lp) => ({
                    owner: lp.owner,
                    liquidityTotal: lp.liquidityTotal,
                  }))}
                  token0Symbol={poolData.token0Symbol}
                  token1Symbol={poolData.token1Symbol}
                  token0Decimals={poolData.token0Decimals}
                  token1Decimals={poolData.token1Decimals}
                  token0UsdPrice={usdPrices.token0Usd}
                  token1UsdPrice={usdPrices.token1Usd}
                  isLoading={poolDayDataLoading || lpPositionsLoading || liquidityHistoryLoading || tokenPriceMap.isLoading}
                  days={7}
                  spaceSlug={selectedSpaceSlug}
                  historicalLiquiditySnapshots={liquidityHistoryData?.snapshots}
                />
              )}
            </ChartContent>
          </ChartCard>
        </div>
        )}

        {/* Volume by Time of Day / Day of Week */}
        {(activeTab === "overview" || activeTab === "trading") && (
        <ChartCard className="h-[320px]">
          <ChartHeader>
            <ChartTitle helpContent={{
              title: "Volume by Time Pattern",
              sections: [
                { title: "What it shows", content: "Average trading volume broken down by hour of the day and day of the week, measured in Eastern Standard Time (EST). Based on the last 30 days of data." },
                { title: "How to read it", content: "Taller bars indicate higher average volume during that time period. The left chart shows hourly patterns (0-23h EST), while the right chart shows daily patterns (Sun-Sat)." },
                { title: "Key indicators", content: "Peak hours reveal when most trading occurs — useful for understanding liquidity needs and market maker activity windows. Day-of-week patterns can highlight institutional vs retail trading cycles." },
              ]
            }}>Volume by Time (30D Avg, EST)</ChartTitle>
          </ChartHeader>
          <ChartContent className="min-h-[260px]">
            {isAnalyticsStagePending(3) || volumeByTimeLoading || !poolData ? (
              <ChartContentSkeleton variant="bars" />
            ) : volumeByTimeData ? (
              <VolumeByTimeChart
                byHour={volumeByTimeData.byHour}
                byDay={volumeByTimeData.byDay}
              />
            ) : (
              <BarChartPlaceholder />
            )}
          </ChartContent>
        </ChartCard>
        )}

        {/* LP Ranges by Address Chart */}
        {!shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "lp-analysis") && (
        <>
        <ChartCard id="lp-ranges" className="h-[376px]">
          <ChartHeader>
            <ChartTitle helpContent={{
              title: "LP Ranges by Address",
              sections: [
                { title: "What it shows", content: "The price ranges where each liquidity provider has positioned their liquidity, overlaid on the total liquidity distribution." },
                { title: "How to read it", content: "The background shows total pool liquidity distribution. Colored horizontal lines represent individual LP positions, with the line spanning their price range." },
                { title: "Key indicators", content: "Positions that include the current price are earning fees. Wide ranges provide more coverage but less capital efficiency. Narrow ranges around the current price are more capital efficient but riskier." },
              ]
            }}>LP Ranges by Address</ChartTitle>
            <div className="bp-chart-controls">
              <button type="button" onClick={() => lpRangesChartRef.current?.zoomOut()}>−</button>
              <button type="button" onClick={() => lpRangesChartRef.current?.zoomIn()}>+</button>
              <button type="button" onClick={() => lpRangesChartRef.current?.reset()}>Reset</button>
            </div>
          </ChartHeader>
          <ChartContent>
            {!supportsRangeLiquidityShape ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.rangeLiquidity} />
            ) : isAnalyticsStagePending(2) || allLPPositionsDataLoading || lpPositionsLoading || tickLiquidityFullRangeLoading || !poolData ? (
              <ChartContentSkeleton variant="bars" />
            ) : !hasPositionRangeData || liquidityDistributionBars.length === 0 || !hasLiquidityDistributionValues ? (
              <ChartUnavailableState
                title="No active LP ranges"
                message={lpAttributionEmptyMessage}
              />
            ) : (
              <LPRangesByAddressChart
                ref={lpRangesChartRef}
                totalDistribution={liquidityDistributionBars}
                positionsByOwner={allLPPositionsData as { owner: string; positions: PositionData[] }[]}
                currentPrice={poolData.currentPrice}
                currentTick={poolData.tick}
                token0Decimals={poolData.token0Decimals}
                token1Decimals={poolData.token1Decimals}
                token0Symbol={poolData.token0Symbol}
                token1Symbol={poolData.token1Symbol}
                token0UsdPrice={usdPrices.token0Usd}
                token1UsdPrice={usdPrices.token1Usd}
                tickSpacing={poolData.tickSpacing}
                invertPrice={priceChartConfig.invert}
                spaceSlug={selectedSpaceSlug}
              />
            )}
          </ChartContent>
        </ChartCard>

        {/* In-Range Liquidity Chart */}
        <ChartCard id="in-range-liquidity" className="h-[260px]">
          <ChartHeader>
            <ChartTitle helpContent={{
              title: "In-Range Liquidity",
              sections: [
                { title: "What it shows", content: "The total USD value of LP positions whose price range currently contains the pool price (i.e. positions that are actively earning fees), broken down by liquidity provider." },
                { title: "How to read it", content: "The counter on the left shows the sum of in-range liquidity in USD and what share of the pool's total TVL it represents. The bars on the right rank in-range LPs by their USD contribution." },
                { title: "Key indicators", content: "A high % of TVL means most liquidity in the pool is currently active. A low % means a lot of capital is sitting outside the current price and earning nothing." },
              ]
            }}>In-Range Liquidity</ChartTitle>
          </ChartHeader>
          <ChartContent>
            {!supportsRangeLiquidityShape ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.rangeLiquidity} />
            ) : isAnalyticsStagePending(1) || allLPPositionsDataLoading || lpPositionsLoading || !poolData ? (
              <ChartContentSkeleton variant="bars" />
            ) : !hasPositionRangeData ? (
              <ChartUnavailableState
                title="No in-range LP positions"
                message={activeLiquidityEmptyMessage}
              />
            ) : (
              <InRangeLiquidityChart
                positionsByOwner={allLPPositionsData as { owner: string; positions: PositionData[] }[]}
                currentTick={poolData.tick}
                sqrtPriceX96={poolData.sqrtPriceX96}
                token0Decimals={poolData.token0Decimals}
                token1Decimals={poolData.token1Decimals}
                token0UsdPrice={usdPrices.token0Usd}
                token1UsdPrice={usdPrices.token1Usd}
                poolTvlUsd={poolLiquidityValueUsd}
                spaceSlug={selectedSpaceSlug}
              />
            )}
          </ChartContent>
        </ChartCard>

        {/* Liquidity History by Address Chart */}
        <ChartCard id="liquidity-history-by-address" className="h-[320px]">
          <ChartHeader>
            <div className="flex items-center justify-between w-full gap-3">
              <ChartTitle helpContent={{
                title: "Liquidity Distribution Over Time",
                sections: [
                  { title: "What it shows", content: "Snapshots of how total pool liquidity (in USD) is distributed among different liquidity providers over the selected window. Values use current USD prices for consistency with other charts." },
                  { title: "How to read it", content: "Each colored area represents a specific LP's share of total liquidity. The chart is stacked, so the total height shows total pool liquidity in USD." },
                  { title: "Key indicators", content: "Growing areas indicate LPs adding liquidity. Shrinking areas indicate withdrawals. The 'Others' category combines all smaller LPs not in the top 20." },
                ]
              }}>Liquidity Distribution Over Time</ChartTitle>
              <div
                className="inline-flex items-center gap-0.5 rounded-md bg-[var(--bp-bg-primary)] p-0.5 shrink-0"
                role="group"
                aria-label="Time range"
              >
                {[7, 14, 30, 60, 90, 120].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setLdtLookbackDays(d)}
                    aria-pressed={ldtLookbackDays === d}
                    className={cn(
                      "cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-colors tabular-nums",
                      ldtLookbackDays === d
                        ? "bg-[var(--bp-bg-card)] text-[var(--bp-text-primary)] shadow-sm"
                        : "text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)]",
                    )}
                  >
                    {d}D
                  </button>
                ))}
              </div>
            </div>
          </ChartHeader>
          <ChartContent>
            {!supportsOwnerCompositionHistory ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
            ) : isAnalyticsStagePending(2) || liquidityHistoryLoading ? (
              <ChartContentSkeleton variant="line" />
            ) : !liquidityHistoryData || liquidityHistoryChartData.length === 0 ? (
              <LineChartPlaceholder />
            ) : (
              <LiquidityHistoryByAddressChart
                data={liquidityHistoryChartData}
                topAddresses={liquidityHistoryData.topAddresses}
                addressLabels={liquidityHistoryData.addressLabels}
              />
            )}
          </ChartContent>
        </ChartCard>
        </>
        )}
        </div>
        )}
        {/* End of pool-level analytics wrapper */}

        {/* ═══════════════════════════════════════════════════════════════
            PRICE SPREAD: POOL vs COINGECKO (1Y HOURLY)
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === "overview" && (
        <ChartCard className="h-[450px]">
          <ChartHeader>
            <ChartTitle>Pool Price vs Oracle Spread</ChartTitle>
          </ChartHeader>
          <ChartContent>
            {isAnalyticsStagePending(3) || priceSpreadLoading ? (
              <ChartContentSkeleton variant="line" />
            ) : priceSpreadData.length === 0 ? (
              <LineChartPlaceholder />
            ) : (
              <PriceSpreadChart
                data={priceSpreadData}
                poolAddress={poolKey}
                token0Address={poolData?.token0Address}
                token0Decimals={poolData?.token0Decimals}
                token1Decimals={poolData?.token1Decimals}
                invert={displayPairFromPool?.invert ?? false}
                spaceSlug={selectedSpaceSlug}
              />
            )}
          </ChartContent>
        </ChartCard>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            INDIVIDUAL LP ANALYSIS SECTION
            ═══════════════════════════════════════════════════════════════ */}
        {!shouldRenderMonadV2NativeCharts && (activeTab === "overview" || activeTab === "lp-analysis") && (
        <>
        <div
          id="lp-deep-dive"
          className="flex items-center gap-6 py-8 cursor-pointer"
          onMouseEnter={() => setSectionDividerHovered(true)}
          onMouseLeave={() => setSectionDividerHovered(false)}
        >
          {/* Left line */}
          <div className={cn(
            "flex-1 h-px transition-all duration-300",
            sectionDividerHovered ? "bg-[var(--bp-accent-primary)]" : "bg-[var(--bp-border-subtle)]"
          )} />
          {/* Title */}
          <h2 
            className={cn(
              "text-sm uppercase tracking-[0.2em] whitespace-nowrap transition-colors duration-300",
              sectionDividerHovered ? "text-[var(--bp-accent-primary)]" : "text-[var(--bp-text-primary)]"
            )}
            style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}
          >
            LP Deep Dive
          </h2>
          {/* Right line */}
          <div className={cn(
            "flex-1 h-px transition-all duration-300",
            sectionDividerHovered ? "bg-[var(--bp-accent-primary)]" : "bg-[var(--bp-border-subtle)]"
          )} />
        </div>

        {/* Filters + Current LPs - Premium Two-Column Layout */}
        <div className="bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)] rounded-lg overflow-hidden">
          {/* Two-column grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] divide-y lg:divide-y-0 lg:divide-x divide-[var(--bp-border-subtle)]">
            
            {/* Left Column: Filter Controls */}
            <div className="p-5 space-y-5">
              {/* Section Header */}
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-4 bg-[var(--bp-accent-primary)] rounded-full" />
                <h2 className="text-sm font-semibold tracking-wide text-[var(--bp-text-primary)]">
                  LP Filter
                </h2>
              </div>
              
              {/* Address Input */}
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-[var(--bp-text-muted)] uppercase tracking-wider">
                  Wallet Address
                </label>
                <input
                  type="text"
                  value={effectiveSelectedOwner ?? ""}
                  onChange={(e) => setSelectedOwner(e.target.value || null)}
                  placeholder="Enter address or select from list..."
                  className="w-full px-3 py-2.5 bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-md text-xs font-mono text-[var(--bp-text-primary)] placeholder:text-[var(--bp-text-muted)]/50 focus:outline-none focus:border-[var(--bp-accent-primary)] focus:ring-1 focus:ring-[var(--bp-accent-primary)]/20 transition-all"
                />
              </div>
              
              {/* Loading state */}
              {(isAnalyticsStagePending(1) || historicalLoading) && (
                <div className="flex items-center gap-2 text-xs text-[var(--bp-text-muted)]">
                  <div className="w-3.5 h-3.5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
                  <span>Loading positions...</span>
                </div>
              )}

              {!supportsOwnerCompositionHistory && (
                <div className="rounded-md border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-primary)] px-3 py-3 text-xs leading-5 text-[var(--bp-text-muted)]">
                  {unsupportedAnalyticsMessages.ownerAttribution}
                </div>
              )}
              
              {/* Position Cards */}
              {effectiveSelectedOwner && selectedPositions && selectedPositions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[var(--bp-text-muted)] uppercase tracking-wider">
                      Positions
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--bp-text-secondary)] tabular-nums">
                      {selectedPositions.length}{[1000, 2000, 5000, 10000].includes(selectedPositions.length) ? "+" : ""} total
                      {excludedPositionIds.size > 0 && (
                        <span className="text-[var(--bp-text-muted)]"> · {activePositions.length} active</span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-1 -mr-1">
                    {selectedPositions.map((position: PositionData) => {
                      let token1Value = 0;
                      if (poolData) {
                        const liq = BigInt(position.liquidity);
                        if (liq > BigInt(0)) {
                          const sqrtPriceX96 = BigInt(poolData.sqrtPriceX96);
                          const { amount0, amount1 } = amountsForPosition({
                            liquidity: liq,
                            tickLower: position.tickLower,
                            tickUpper: position.tickUpper,
                            sqrtPriceX96,
                          });
                          const amt0 = bigintToApproxNumber(amount0, poolData.token0Decimals);
                          const amt1 = bigintToApproxNumber(amount1, poolData.token1Decimals);
                          token1Value = amt0 * poolData.currentPrice + amt1;
                        }
                      }
                      
                      const isExcluded = excludedPositionIds.has(position.tokenId);
                      
                      return (
                        <button
                          key={position.id}
                          type="button"
                          onClick={() => togglePositionSelection(position.tokenId)}
                          className={cn(
                            "group flex items-center justify-between gap-3 px-3 py-2.5 rounded-md transition-all duration-150",
                            isExcluded
                              ? "bg-[var(--bp-bg-primary)] border border-dashed border-[var(--bp-border-subtle)] opacity-60 hover:opacity-80"
                              : "bg-gradient-to-r from-[var(--bp-accent-primary)]/5 to-[var(--bp-accent-primary)]/10 border border-[var(--bp-accent-primary)]/20 hover:border-[var(--bp-accent-primary)]/40 hover:shadow-sm"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              isExcluded ? "bg-[var(--bp-text-muted)]" : "bg-[var(--bp-accent-primary)]"
                            )} />
                            <span className={cn(
                              "text-xs font-mono font-medium",
                              isExcluded ? "text-[var(--bp-text-muted)]" : "text-[var(--bp-text-primary)]"
                            )}>
                              #{position.tokenId}
                            </span>
                          </div>
                          <span className={cn(
                            "text-xs font-semibold tabular-nums",
                            isExcluded ? "text-[var(--bp-text-muted)]" : "text-[var(--bp-text-secondary)]"
                          )}>
                            {formatCompactWithUnit(token1Value, poolData?.token1Symbol)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Empty state hint */}
              {!effectiveSelectedOwner && !isAnalyticsStagePending(1) && !historicalLoading && (
                <div className="py-4 text-center">
                  <p className="text-xs text-[var(--bp-text-muted)]">
                    Select an LP from the list to view their positions
                  </p>
                </div>
              )}
            </div>

            {/* Right Column: LP List */}
            <div className="p-5 flex flex-col min-h-0">
              {/* Section Header — Active / Closed tabs */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-4 bg-[var(--bp-text-muted)] rounded-full mr-1.5" />
                  {(["active", "closed"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setLpListTab(tab)}
                      className={cn(
                        "text-sm font-semibold tracking-wide px-2 py-0.5 rounded transition-colors",
                        lpListTab === tab
                          ? "text-[var(--bp-text-primary)] bg-[var(--bp-bg-primary)]"
                          : "text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)]",
                      )}
                    >
                      {tab === "active" ? "Active LPs" : "Closed LPs"}
                    </button>
                  ))}
                </div>
                {lpListTab === "active"
                  ? allLPPositions && allLPPositions.length > 0 && (
                      <span className="text-[11px] text-[var(--bp-text-muted)] tabular-nums">
                        {allLPPositions.length} LPs
                      </span>
                    )
                  : closedLPsSortedForDisplay.length > 0 && (
                      <span className="text-[11px] text-[var(--bp-text-muted)] tabular-nums">
                        {closedLPsSortedForDisplay.length} LPs
                      </span>
                    )}
              </div>
              
              {/* LP Table */}
              {lpListTab === "active" ? (
              isAnalyticsStagePending(1) || lpPositionsLoading ? (
                <div className="flex-1 min-h-[260px]">
                  <ChartContentSkeleton variant="bars" />
                </div>
              ) : lpPositionsError ? (
                <div className="flex-1 flex items-center justify-center py-12">
                  <div className="text-sm text-red-500 text-center max-w-xs">
                    <p className="font-medium mb-1">Failed to load data</p>
                    <p className="text-xs text-red-400">
                      {lpPositionsError instanceof Error ? lpPositionsError.message : String(lpPositionsError)}
                    </p>
                  </div>
                </div>
              ) : allLPPositions && allLPPositions.length > 0 ? (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Table Header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bp-border-subtle)]">
                    <span className="text-[10px] font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider">
                      Address
                    </span>
                    <span className="text-[10px] font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider">
                      {supportsRangeLiquidityShape ? "TVL" : "Positions"}
                    </span>
                  </div>
                  
                  {/* Scrollable List */}
                  <div className="flex-1 overflow-y-auto max-h-[320px]">
                    {currentLPsSortedForDisplay.map(({ lp, usd }, index) => {
                      const isSelected = effectiveSelectedOwner?.toLowerCase() === lp.owner.toLowerCase();
                      const isFirst = index === 0;
                      
                      return (
                        <div
                          key={lp.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedOwner(lp.owner)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedOwner(lp.owner);
                            }
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2.5 transition-all duration-150 border-b border-[var(--bp-border-subtle)]/50 last:border-b-0 cursor-pointer",
                            isSelected
                              ? "bg-[var(--bp-accent-primary)]/10 border-l-2 border-l-[var(--bp-accent-primary)]"
                              : "hover:bg-[var(--bp-bg-primary)] border-l-2 border-l-transparent"
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            {/* Rank indicator for top 3 */}
                            {index < 3 && (
                              <span className={cn(
                                "flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold",
                                index === 0 && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                                index === 1 && "bg-slate-400/15 text-slate-500 dark:text-slate-400",
                                index === 2 && "bg-orange-600/15 text-orange-600 dark:text-orange-400"
                              )}>
                                {index + 1}
                              </span>
                            )}
                            {index >= 3 && (
                              <span className="w-5 h-5 flex items-center justify-center text-[10px] text-[var(--bp-text-muted)]">
                                {index + 1}
                              </span>
                            )}
                            <LPAddress fullAddress={lp.owner} spaceSlug={selectedSpaceSlug}>
                              <span className={cn(
                                "font-mono text-xs",
                                isSelected ? "text-[var(--bp-accent-primary)] font-medium" : "text-[var(--bp-text-secondary)]"
                              )}>
                                {formatLpLabel(lp.owner, selectedSpaceSlug)}
                              </span>
                            </LPAddress>
                          </div>
                          <span className={cn(
                            "text-xs font-semibold tabular-nums",
                            isSelected ? "text-[var(--bp-accent-primary)]" : "text-[var(--bp-text-primary)]",
                            isFirst && !isSelected && "text-[var(--bp-text-primary)]"
                          )}>
                            {(() => {
                              if (usd !== undefined) return formatCompactWithUnit(usd, usdPrices.unit);
                              if (allLPPositionsDataLoading) return "---";
                              if (!supportsRangeLiquidityShape) {
                                const count = Number(lp.liquidityTotal);
                                return `${Number.isFinite(count) ? count : 0} pos`;
                              }
                              return formatLPSize(lp.liquidityTotal, totalLPLiquidity, poolData ? { token0Balance: effectivePoolBalances?.token0BalanceStr ?? poolData.token0Balance, token1Balance: effectivePoolBalances?.token1BalanceStr ?? poolData.token1Balance, currentPrice: poolData.currentPrice, token0UsdPrice: usdPrices.token0Usd, token1UsdPrice: usdPrices.token1Usd, valueUnit: usdPrices.unit } : undefined);
                            })()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center py-12">
                  <div className="text-center">
                    <p className="text-sm text-[var(--bp-text-muted)]">No LPs found</p>
                    <p className="text-xs text-[var(--bp-text-muted)]/70 mt-1">This pool has no active positions</p>
                  </div>
                </div>
              )
              ) : !poolData || isAnalyticsStagePending(2) || lpLifecycleLoading ? (
                <div className="flex-1 min-h-[260px]">
                  <ChartContentSkeleton variant="bars" />
                </div>
              ) : closedLPsSortedForDisplay.length > 0 ? (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Table Header */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bp-border-subtle)]">
                    <span className="text-[10px] font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider">
                      Address
                    </span>
                    <span className="text-[10px] font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider">
                      Closed
                    </span>
                  </div>

                  {/* Scrollable List */}
                  <div className="flex-1 overflow-y-auto max-h-[320px]">
                    {closedLPsSortedForDisplay.map((row, index) => {
                      const isSelected = effectiveSelectedOwner?.toLowerCase() === row.owner.toLowerCase();
                      const isStillActive = allLPPositions?.some(
                        (lp) => lp.owner.toLowerCase() === row.owner.toLowerCase(),
                      );
                      return (
                        <div
                          key={row.owner}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedOwner(row.owner)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedOwner(row.owner);
                            }
                          }}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2.5 transition-all duration-150 border-b border-[var(--bp-border-subtle)]/50 last:border-b-0 cursor-pointer",
                            isSelected
                              ? "bg-[var(--bp-accent-primary)]/10 border-l-2 border-l-[var(--bp-accent-primary)]"
                              : "hover:bg-[var(--bp-bg-primary)] border-l-2 border-l-transparent",
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-5 h-5 flex items-center justify-center text-[10px] text-[var(--bp-text-muted)]">
                              {index + 1}
                            </span>
                            <div className="flex flex-col">
                              <LPAddress fullAddress={row.owner} spaceSlug={selectedSpaceSlug}>
                                <span
                                  className={cn(
                                    "font-mono text-xs",
                                    isSelected
                                      ? "text-[var(--bp-accent-primary)] font-medium"
                                      : "text-[var(--bp-text-secondary)]",
                                  )}
                                >
                                  {formatLpLabel(row.owner, selectedSpaceSlug)}
                                </span>
                              </LPAddress>
                              <span className="text-[10px] text-[var(--bp-text-muted)] tabular-nums">
                                last exit{" "}
                                {new Date(row.lastClosedAt * 1000).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                                {isStillActive ? " · still active" : ""}
                              </span>
                            </div>
                          </div>
                          <span
                            className={cn(
                              "text-xs font-semibold tabular-nums",
                              isSelected ? "text-[var(--bp-accent-primary)]" : "text-[var(--bp-text-primary)]",
                            )}
                          >
                            {row.closedCount} closed
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center py-12">
                  <div className="text-center">
                    <p className="text-sm text-[var(--bp-text-muted)]">No closed positions</p>
                    <p className="text-xs text-[var(--bp-text-muted)]/70 mt-1">
                      No LP has closed a position in this pool yet
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* LP Position Activity + LP Distribution Comparison */}
        <div id="position-activity" className="ts-flush-grid grid-cols-1 lg:grid-cols-2">
          {/* LP Position Activity Chart - shows mint/burn events for selected LP */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "LP Position Activity",
                sections: [
                  { title: "What it shows", content: "Mint and burn events for the currently selected LP address, showing their position changes over time." },
                  { title: "How to read it", content: "Bars above zero show liquidity additions, bars below show removals. This helps track a specific LP's activity and strategy." },
                  { title: "Key indicators", content: "Frequent adjustments may indicate active management. Large single events suggest significant position changes. Select an LP from the sidebar to view their specific activity." },
                ]
              }}>LP Position Activity</ChartTitle>
            </ChartHeader>
            <ChartContent className="min-h-[280px]">
              {!supportsHistoricalDepthBands ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
              ) : isAnalyticsStagePending(2) || lpEntryExitLoading || !poolData ? (
                <ChartContentSkeleton variant="bars" />
              ) : (
                <LPPositionActivityChart
                  lpEvents={lpEntryExitRawEvents}
                  selectedOwner={effectiveSelectedOwner}
                  token0Decimals={poolData.token0Decimals}
                  token1Decimals={poolData.token1Decimals}
                  token0UsdPrice={usdPrices.token0Usd}
                  token1UsdPrice={usdPrices.token1Usd}
                  authoritativeEmptyWindow={shouldZeroFillWorldchainEvents}
                  isLoading={lpEntryExitLoading}
                />
              )}
            </ChartContent>
          </ChartCard>

          {/* LP Distribution Comparison Chart */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "LP Liquidity Distribution",
                sections: [
                  { title: "What it shows", content: "Compares the selected LP's liquidity distribution against the total pool distribution." },
                  { title: "How to read it", content: "The background shows total pool liquidity, while the highlighted area shows the selected LP's positions. This helps visualize how one LP's strategy compares to the overall pool." },
                  { title: "Key indicators", content: "Alignment with pool distribution suggests following the crowd. Divergence may indicate a contrarian strategy or specialized positioning." },
                ]
              }}>LP Liquidity Distribution</ChartTitle>
              <div className="bp-chart-controls">
                <button type="button" onClick={() => lpDistComparisonChartRef.current?.zoomOut()}>−</button>
                <button type="button" onClick={() => lpDistComparisonChartRef.current?.zoomIn()}>+</button>
                <button type="button" onClick={() => lpDistComparisonChartRef.current?.reset()}>Reset</button>
              </div>
            </ChartHeader>
            <ChartContent className="min-h-[280px]">
              {!supportsRangeLiquidityShape ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.rangeLiquidity} />
              ) : isAnalyticsStagePending(2) || allLPPositionsDataLoading || tickLiquidityFullRangeLoading || !poolData ? (
                <ChartContentSkeleton variant="bars" />
              ) : (
                <LPDistributionComparisonChart
                  ref={lpDistComparisonChartRef}
                  totalDistribution={liquidityDistributionBars}
                  allPositions={shouldNormalizePancakeLpAttribution ? allPositionsFlattened : distributionPositions}
                  tickData={tickLiquidityFullRangeData ?? []}
                  selectedPositions={selectedPositionsForDistribution}
                  currentPrice={poolData.currentPrice}
                  currentTick={poolData.tick}
                  currentLiquidity={poolData.liquidity}
                  token0Decimals={poolData.token0Decimals}
                  token1Decimals={poolData.token1Decimals}
                  token0Symbol={poolData.token0Symbol}
                  token1Symbol={poolData.token1Symbol}
                  token0UsdPrice={usdPrices.token0Usd}
                  token1UsdPrice={usdPrices.token1Usd}
                  tickSpacing={poolData.tickSpacing}
                  invertPrice={priceChartConfig.invert}
                  normalizeAttributionToTotal={shouldNormalizePancakeLpAttribution}
                  selectedOwnerLabel={effectiveSelectedOwner ? `${effectiveSelectedOwner.slice(0, 6)}...${effectiveSelectedOwner.slice(-4)}` : "Selected LP"}
                  useUsd={liquidityDistributionUseUsd}
                />
              )}
            </ChartContent>
          </ChartCard>
        </div>

        {/* Historical Rebalances — out-of-range drift and rebalance efficiency for the selected LP */}
        <ChartCard id="historical-rebalances">
          <ChartHeader>
            <ChartTitle helpContent={{
              title: "Historical Rebalances",
              sections: [
                { title: "What it shows", content: "Every position the selected LP has held in the window — opens/holds, partial trims, and full closes (rebalances). Forced rebalances (price drifted out of range first) also show how long they took to react; repositions made while still in range are marked proactive." },
                { title: "How to read it", content: "On the timeline, the green segment is time earning fees in range; a red segment (when present) is time spent out of range before the LP acted — its length is the rebalance lag. Markers: blue diamond = forced close, green diamond = proactive in-range close, amber diamond = partial trim, hollow circle = open position still held (hold), amber arrow = still out of range now." },
                { title: "Key indicators", content: "Short red segments and a low median time out of range indicate an active, efficient manager; frequent in-range (proactive) closes indicate someone who repositions before drifting out. A large hold count with few rebalances indicates a passive LP. Tighter ranges (smaller ± width) are more capital-efficient but drift out faster." },
              ]
            }}>Historical Rebalances</ChartTitle>
          </ChartHeader>
          <ChartContent
            style={{
              height: Math.min(620, Math.max(260, 170 + Math.min(rebalanceRecords.length, 16) * 26)),
            }}
          >
            {!supportsHistoricalDepthBands ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
            ) : !poolData || (effectiveSelectedOwner && (rebalanceLoading || selectedPositionsLoading)) ? (
              <ChartContentSkeleton variant="bars" />
            ) : (
              <HistoricalRebalances
                records={rebalanceRecords}
                summary={rebalanceSummary}
                otherPositions={rebalanceOtherPositions}
                priceSeries={rebalancePriceSeries}
                toDisplayPrice={rebalanceToDisplayPrice}
                priceUnitLabel={poolUsdConv.canShow ? "USD" : priceChartConfig.unitLabel}
                currentTick={poolData.tick}
                currentPrice={poolData.currentPrice}
                token0Decimals={poolData.token0Decimals}
                token1Decimals={poolData.token1Decimals}
                token0Symbol={poolData.token0Symbol}
                token1Symbol={poolData.token1Symbol}
                token0UsdPrice={usdPrices.token0Usd}
                token1UsdPrice={usdPrices.token1Usd}
                tickSpacing={poolData.tickSpacing}
                nowSec={rebalanceNowSec}
                hasOwner={!!effectiveSelectedOwner}
              />
            )}
          </ChartContent>
        </ChartCard>

        {/* Price Range + Liquidity Target Grid */}
        <div id="custom-metrics" className="ts-flush-grid grid-cols-1 lg:grid-cols-2">
          {/* Price Range Monitor */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Price Range Monitor",
                sections: [
                  { title: "What it shows", content: "The current market price relative to the selected LP's position price range(s)." },
                  { title: "How to read it", content: "The indicator shows where the current price sits within the LP's range. If the price is outside the range, the position is not earning fees." },
                  { title: "Key indicators", content: "Green zone indicates the price is within range and earning fees. Red/outside indicates the position is inactive and may need rebalancing." },
                ]
              }}>Price Range Monitor</ChartTitle>
            </ChartHeader>
            <ChartContent className="p-3 min-h-[80px]">
              {!supportsOwnerCompositionHistory ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
              ) : isAnalyticsStagePending(2) || (effectiveSelectedOwner && selectedPositionsLoading) ? (
                <ChartContentSkeleton variant="line" />
              ) : (
                <PriceRangeChart data={priceRangeDataFromPool} />
              )}
            </ChartContent>
          </ChartCard>

          {/* Inventory */}
          <ChartCard>
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Liquidity Target vs Actual",
                sections: [
                  { title: "What it shows", content: "Compares the selected LP's actual deployed liquidity against their target or desired liquidity level." },
                  { title: "How to read it", content: "The gauge shows how close the actual liquidity is to the target. This helps LPs monitor if they need to add or remove liquidity." },
                  { title: "Key indicators", content: "Being close to target suggests the position is well-maintained. Significant deviation may require rebalancing or adjustment." },
                ]
              }}>Inventory</ChartTitle>
            </ChartHeader>
            <ChartContent className="p-3 min-h-[80px]">
              {!supportsOwnerCompositionHistory ? (
                <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} />
              ) : isAnalyticsStagePending(2) || (effectiveSelectedOwner && selectedPositionsLoading) ? (
                <ChartContentSkeleton variant="bars" />
              ) : (
                <LiquidityTargetChart data={liquidityTargetDataFromPool} />
              )}
            </ChartContent>
          </ChartCard>
        </div>

        {/* Ninth row - LP Historical Activity */}
        <ChartCard id="historical-data">
          <ChartHeader>
            <div className="flex items-center justify-between w-full">
              <ChartTitle helpContent={{
                title: "LP Activity - Historical Data",
                sections: [
                  { title: "What it shows", content: "A comprehensive view of LP activity over time, including price movements, liquidity changes, swap events, and oracle prices." },
                  { title: "How to read it", content: "The chart combines multiple data layers: candlestick prices, LP position ranges, mint/burn events, and volume. Use the oracle selector to compare different price sources." },
                  { title: "Key indicators", content: "Look for correlations between price movements and LP activity. Large position changes during volatile periods may indicate strategic repositioning or panic exits." },
                ]
              }}>LP Activity - Historical Data ({timeRange})</ChartTitle>
              <span className="text-[10px] px-2 py-1 rounded border bg-[var(--bp-bg-card)] border-[var(--bp-border-subtle)] text-[var(--bp-text-secondary)]">
                Oracle: {isDemoPool ? "Demo oracle" : ORACLE_SOURCE_LABELS[oracleSource]}
              </span>
            </div>
          </ChartHeader>
          <div className="flex-1 p-4" style={{ height: 'calc(100% - 50px)', minHeight: '600px' }}>
            {!supportsHistoricalDepthBands ? (
              <ChartUnavailableState message={unsupportedAnalyticsMessages.ownerAttribution} className="h-full" />
            ) : isAnalyticsStagePending(1) || historicalLoading ? (
              <ChartContentSkeleton variant="line" />
            ) : lpActivityDataDisplay ? (
              <LPAddressActivityChart
                data={lpActivityDataDisplay}
                lpRanges={selectedLpRanges}
                // Use atomic positions from useLPHistoricalData to prevent race conditions
                // in impact band calculations (positions + events fetched together)
                allPositions={lpActivityPositions?.length > 0 ? lpActivityPositions : undefined}
                tickData={(lpActivityTickLiquidity?.length ? lpActivityTickLiquidity : tickLiquidityData) ?? null}
                poolData={poolData ?? null}
                lpEvents={lpActivityImpactBandEvents}
                v3Swaps={lpActivityV3Swaps}
                precomputedImpactBand={lpActivityPrecomputedImpactBand}
                precomputedDepthBand={lpActivityPrecomputedDepthBand}
                invertPrice={priceChartConfig.invert}
                token0UsdPrice={usdPrices.token0Usd}
                token1UsdPrice={usdPrices.token1Usd}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[rgba(30,58,95,0.02)] dark:bg-[rgba(74,158,255,0.05)]">
                <p className="text-sm text-[var(--bp-text-light)] font-mono">
                  No data yet for this pool/time range
                </p>
              </div>
            )}
          </div>
        </ChartCard>
        </>
        )}

        {/* Incentives Tab — Kraken xPoints program */}
        {activeTab === "incentives" && incentiveCampaign && isKrakenPool && (
        <div className="ts-flush-stack">
          {/* TVL chart + Campaign History — same layout as Worldchain */}
          <div className="rounded-xl border border-[var(--bp-border-secondary)] bg-[var(--bp-card-bg)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--bp-border-secondary)]">
              <h3 className="text-sm font-semibold text-[var(--bp-text-primary)]">TVL — Incentive Period</h3>
            </div>
            <div className="flex flex-col lg:flex-row overflow-hidden">
              {/* TVL Chart area */}
              <div className="flex-1 min-w-0 h-[420px]">
                {liquidityHistoryIncentiveLoading || tvlIncentiveChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
                  </div>
                ) : (
                  <TvlIncentiveChart
                    tvlData={tvlIncentiveChartData}
                    rewardBars={krakenXpointsBars}
                    campaignPeriods={merklCampaignPeriods}
                    selectedCampaignId={selectedCampaignId}
                    formatRewardAxis={(v) => {
                      if (v <= 0) return "0 xP";
                      if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M xP`;
                      if (v >= 1e3) return `${Math.round(v / 1e3)}K xP`;
                      return `${Math.round(v)} xP`;
                    }}
                    formatRewardTooltip={(v) => `${Math.round(v)} xP`}
                  />
                )}
              </div>
              {/* Campaign History table */}
              <div className="lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--bp-border-secondary)] flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--bp-border-secondary)]">
                  <h4 className="text-xs font-semibold text-[var(--bp-text-muted)] uppercase tracking-wide">Campaign History</h4>
                </div>
                <div className="flex-1 overflow-hidden">
                  <table className="w-full table-fixed text-[11px]">
                    <thead className="sticky top-0 bg-[var(--bp-card-bg)] z-10">
                      <tr className="text-[var(--bp-text-muted)] border-b border-[var(--bp-border-subtle)]">
                        <th className="w-[40%] px-2 py-1.5 text-left font-medium">Period</th>
                        <th className="w-[30%] px-2 py-1.5 text-right font-medium">xPoints/day</th>
                        <th className="w-[30%] px-2 py-1.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[var(--bp-border-subtle)]">
                        <td className="px-2 py-2 text-[var(--bp-text-muted)] whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                            <span>Mar 17 &apos;26 – ongoing</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right text-[var(--bp-text-secondary)] font-mono whitespace-nowrap">500 xP</td>
                        <td className="px-2 py-2 text-right font-mono font-medium text-[var(--bp-text-primary)] whitespace-nowrap">7.5K xP</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Volume chart */}
          <ChartCard id="volume-incentive-kraken" className="h-[400px]">
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Volume — Incentive Period",
                sections: [
                  { title: "What it shows", content: `Daily trading volume from 1 month before the campaign start (${visibleCampaignWindow?.start ?? "?"}) to today.` },
                  { title: "How to read it", content: "Each point represents the total value of swaps on that day. Higher peaks indicate more trading activity." },
                  { title: "Key indicators", content: "Compare volume before and during the incentive campaign to measure its impact on trading activity." },
                ]
              }}>Volume — Incentive Period</ChartTitle>
            </ChartHeader>
            <ChartContent>
              {dayDataIncentiveLoading || volumeIncentiveChartData.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
                </div>
              ) : (
                <Volume1YAreaChart
                  data={volumeIncentiveChartData}
                  campaignPeriods={merklCampaignPeriods}
                  selectedCampaignId={selectedCampaignId}
                  variant="bar"
                />
              )}
            </ChartContent>
          </ChartCard>
        </div>
        )}

        {/* Incentives Tab — only for pools with an incentive campaign (Merkl-based) */}
        {activeTab === "incentives" && effectiveCampaign && !isKrakenPool && (
        <div className="ts-flush-stack">
          {/* TVL + Daily Rewards chart with Campaign History — single card */}
          <div className="rounded-xl border border-[var(--bp-border-secondary)] bg-[var(--bp-card-bg)] overflow-hidden">
            {/* Shared header */}
            <div className="px-4 py-3 border-b border-[var(--bp-border-secondary)]">
              <h3 className="text-sm font-semibold text-[var(--bp-text-primary)]">TVL — Incentive Period</h3>
            </div>
            {/* Chart left + Table right, separated by border */}
            <div className="flex flex-col lg:flex-row overflow-hidden">
              {/* Chart area */}
              <div className="flex-1 min-w-0 h-[420px]">
                {liquidityHistoryIncentiveLoading || tvlIncentiveChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
                  </div>
                ) : (
                  <TvlIncentiveChart
                    tvlData={tvlIncentiveChartData}
                    rewardBars={dailyRewardBars}
                    campaignPeriods={merklCampaignPeriods}
                    selectedCampaignId={selectedCampaignId}
                  />
                )}
              </div>
              {/* Divider + Campaign History table */}
              <div className="lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--bp-border-secondary)] flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--bp-border-secondary)]">
                  <h4 className="text-xs font-semibold text-[var(--bp-text-muted)] uppercase tracking-wide">Campaign History</h4>
                </div>
                {merklOpportunity?.campaigns && merklOpportunity.campaigns.length > 0 ? (
                  <div className="flex-1 overflow-hidden">
                    <table className="w-full table-fixed text-[11px]">
                      <thead className="sticky top-0 bg-[var(--bp-card-bg)] z-10">
                        <tr className="text-[var(--bp-text-muted)] border-b border-[var(--bp-border-subtle)]">
                          <th className="w-[35%] px-2 py-1.5 text-left font-medium">Period</th>
                          <th className="w-[21%] px-2 py-1.5 text-right font-medium">Rate</th>
                          <th className="w-[20%] px-2 py-1.5 text-right font-medium">$/day</th>
                          <th className="w-[24%] px-2 py-1.5 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {merklOpportunity.campaigns.map((c) => {
                          const start = new Date(c.startTimestamp * 1000);
                          const end = new Date(c.endTimestamp * 1000);
                          const isActive = Date.now() / 1000 >= c.startTimestamp && Date.now() / 1000 < c.endTimestamp;
                          const isSelected = selectedCampaignId === c.campaignId;
                          return (
                            <tr
                              key={c.campaignId}
                              className={cn(
                                "border-b border-[var(--bp-border-subtle)] last:border-b-0 cursor-pointer transition-colors hover:bg-[var(--bp-bg-secondary)]/40",
                                isSelected && "bg-[var(--bp-accent-primary)]/8"
                              )}
                              onClick={() => setSelectedCampaignId((prev) => prev === c.campaignId ? null : c.campaignId)}
                            >
                              <td className="px-2 py-2 text-[var(--bp-text-muted)] whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                                  <span>{formatIncentivePeriodRange(start, end)}</span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right text-[var(--bp-text-secondary)] font-mono whitespace-nowrap">
                                {c.dailyRewardTokens >= 1
                                  ? `${formatCompact(c.dailyRewardTokens)} ${c.rewardToken.symbol}`
                                  : `${c.dailyRewardTokens.toFixed(4)} ${c.rewardToken.symbol}`}
                              </td>
                              <td className="px-2 py-2 text-right font-mono font-medium whitespace-nowrap" style={{ color: c.dailyRewardUsd > 0 ? "var(--bp-text-primary)" : "var(--bp-text-muted)" }}>
                                {c.dailyRewardUsd > 0 ? formatUsdCompact(c.dailyRewardUsd) : "$0"}
                              </td>
                              <td className="px-2 py-2 text-right font-mono font-medium whitespace-nowrap" style={{ color: c.totalSpentUsd > 0 ? "var(--bp-text-primary)" : "var(--bp-text-muted)" }}>
                                {c.totalSpentUsd > 0 ? formatUsdCompact(c.totalSpentUsd) : "$0"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex items-center justify-center flex-1 p-4">
                    {merklLoading ? (
                      <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
                    ) : (
                      <p className="text-xs text-[var(--bp-text-muted)]">No campaign data</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Volume chart */}
          <ChartCard id="volume-incentive" className="h-[400px]">
            <ChartHeader>
              <ChartTitle helpContent={{
                title: "Volume — Incentive Period",
                sections: [
                  { title: "What it shows", content: `Daily trading volume from 1 month before the campaign start (${visibleCampaignWindow?.start ?? "?"}) to 1 month after the campaign end (${visibleCampaignWindow?.end ?? "?"}).` },
                  { title: "How to read it", content: "Each point represents the total value of swaps on that day. Higher peaks indicate more trading activity." },
                  { title: "Key indicators", content: "Compare volume before, during, and after the incentive campaign to measure its impact on trading activity." },
                ]
              }}>Volume — Incentive Period</ChartTitle>
            </ChartHeader>
            <ChartContent>
              {dayDataIncentiveLoading || volumeIncentiveChartData.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
                </div>
              ) : (
                <Volume1YAreaChart
                  data={volumeIncentiveChartData}
                  campaignPeriods={merklCampaignPeriods}
                  selectedCampaignId={selectedCampaignId}
                />
              )}
            </ChartContent>
          </ChartCard>
        </div>
        )}


        </div>{/* end space-y wrapper */}
      </div>{/* end padded chart content */}
    </div>
  );
};

export default Dashboard;
