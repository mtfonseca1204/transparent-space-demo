import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { normalizePoolKey, type SupportedPool, isSolanaPool } from "@/lib/pools";
import type { PoolData } from "@/app/api/pool/[address]/route";
import type { PoolPricesRpcResponse } from "@/app/api/pool-prices-rpc/route";
import { useAllTokenPrices } from "@/hooks/use-token-price";
import { getTrackedAsset, getTrackedAssetForPool } from "@/lib/token-utils";
import { getSolanaPoolMetadata } from "@/lib/pools";
import { fetchAllPoolPositions } from "@/hooks/use-lp-historical-data";
import type { PositionData } from "@/lib/envio-client";
import { resolvePoolTvlUsd } from "@/lib/pool-tvl";
import type {
  BirdsEyeDepthMetricJob,
  BirdsEyeDepthMetricResult,
  BirdsEyeDepthWorkerResponse,
} from "@/lib/birds-eye-depth-worker-types";
import {
  useBirdsEyeSettingsStore,
  getResolvedThresholds,
  type MetricThresholds,
} from "@/stores/birds-eye-settings-store";
import { isKrakenLikeSpace } from "@/lib/space-policy";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";

export type PoolHealthStatus = "healthy" | "watch" | "critical";

export interface BirdsEyePoolCard {
  pool: SupportedPool;
  poolData: PoolData | null;
  isLoading: boolean;
  positions: PositionsByOwner[];
  token0Usd: number | null;
  token1Usd: number | null;

  // Card front
  trackedAsset: string;
  counterAsset: string;
  /** True when the tracked asset is the V3 token0 of this pool. */
  isTrackedToken0: boolean;
  status: PoolHealthStatus;
  statusText: string;

  // Card back metrics
  poolPriceUsd: number;
  referencePriceUsd: number | null;
  referenceLabel: "CoinGecko Oracle" | "Kraken xUSD" | "Demo oracle";
  pricePegPct: number;
  deviationPct: number;

  // Timestamps for price comparison
  /** When the Solana RPC pool price was fetched (ms) */
  rpcFetchedAt: number | null;
  /** When the reference price response was received (ms) */
  referenceFetchedAt: number | null;
  /** The reference source's own update timestamp (unix seconds when available) */
  referenceUpdatedAt: number | null;
  tvlUsd: number;
  depthBuyAt2PctUsd: number | null;
  depthSellAt2PctUsd: number | null;
  feeTier: string;
  effectiveSpreadPct: number | null;
  activeLpCount: number;
  thresholds: MetricThresholds;
}

export interface BirdsEyeData {
  pools: BirdsEyePoolCard[];
  isLoading: boolean;
  depthMetricsLoading: boolean;
  totalAssets: number;
  healthyCount: number;
  watchCount: number;
  criticalCount: number;
}

type MetricFlag = { level: 0 | 1 | 2; reason: string };

function flagMetrics(args: {
  deviationPct: number;
  thresholds: MetricThresholds;
}): MetricFlag {
  const { deviationPct, thresholds } = args;

  // Only price peg drives alerts
  if (deviationPct >= thresholds.priceDeviation.criticalPct)
    return { level: 2, reason: `Deviation ${deviationPct.toFixed(1)}%` };
  if (deviationPct >= thresholds.priceDeviation.watchPct)
    return { level: 1, reason: `Deviation ${deviationPct.toFixed(1)}%` };

  return { level: 0, reason: "Stable" };
}

function formatCompactNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
}

const LEVEL_TO_STATUS: Record<0 | 1 | 2, PoolHealthStatus> = {
  0: "healthy",
  1: "watch",
  2: "critical",
};

const BIRDS_EYE_BATCH_SIZE = 8;
const BIRDS_EYE_STALE_TIME_MS = 2 * 60_000;
const PRICE_PEG_REFRESH_MS = 15 * 60 * 1000;

type PositionsByOwner = {
  owner: string;
  positions: PositionData[];
  liquidityTotal: bigint | string;
};

type BirdsEyeSnapshotResponse = {
  spaceSlug: string;
  generatedAt: number;
  pools: Array<{
    pool: SupportedPool;
    poolData: PoolData | null;
    positionsByOwner: PositionsByOwner[];
    partial: boolean;
  }>;
  partial: boolean;
};

type DepthMetricsState = {
  requestKey: string;
  byPool: Record<string, BirdsEyeDepthMetricResult>;
};

type BirdsEyeDataCache = {
  key: string;
  value: BirdsEyeData;
};

const EMPTY_DEPTH_METRICS_STATE: DepthMetricsState = {
  requestKey: "",
  byPool: {},
};

function createBirdsEyeDepthWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("../workers/birds-eye-depth.worker.ts", import.meta.url), {
    type: "module",
  });
}

function getPoolTokenSymbols(pool: SupportedPool): [string, string] {
  const solMeta = getSolanaPoolMetadata(pool.poolKey);
  if (solMeta) {
    return [solMeta.token0Symbol, solMeta.token1Symbol];
  }
  const parts = pool.label.split("/").map((s) => s.trim());
  return [parts[0] || "", parts[1] || ""];
}

async function fetchPoolData(poolKey: string): Promise<PoolData> {
  const res = await fetch(`/api/pool/${poolKey}`);
  if (!res.ok) throw new Error("Failed to fetch pool data");
  return res.json();
}

async function fetchBirdsEyeSnapshot(
  spaceSlug: string
): Promise<BirdsEyeSnapshotResponse> {
  const res = await fetch(
    `/api/birds-eye-snapshot?space=${encodeURIComponent(spaceSlug)}`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch birds-eye snapshot");
  }
  return res.json();
}

async function fetchRpcPoolPrices(
  poolKeys: string[],
  spaceSlug?: string | null
): Promise<PoolPricesRpcResponse> {
  if (poolKeys.length === 0) return { prices: {}, oraclePrices: {}, oracleUpdatedAt: {}, rpcFetchedAt: 0, oracleFetchedAt: 0, fetchedAt: 0 };
  const params = new URLSearchParams({ pools: poolKeys.join(",") });
  if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);
  const res = await fetch(`/api/pool-prices-rpc?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch RPC pool prices");
  return res.json();
}

type KrakenXusdPrice = { price: number; timestamp: number };

async function fetchKrakenXusdPrices(
  assets: string[],
  spaceSlug?: string | null
): Promise<{ prices: Record<string, KrakenXusdPrice>; fetchedAt: number }> {
  if (assets.length === 0) return { prices: {}, fetchedAt: Date.now() };

  const endTime = Math.floor(Date.now() / 1000);
  const since = endTime - 3600;

  const settled = await Promise.allSettled(
    assets.map(async (asset) => {
      const params = new URLSearchParams({
        pair: `${asset}USD`,
        interval: "5",
        since: String(since),
        endTime: String(endTime),
      });
      if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/kraken-ohlc?${params}`);
      if (!res.ok) throw new Error(`Kraken xUSD fetch failed for ${asset}`);

      const candles = (await res.json()) as Array<{ timestamp: number; close: number }>;
      const latest = candles[candles.length - 1];
      if (!latest || !Number.isFinite(latest.close) || latest.close <= 0) {
        throw new Error(`Kraken xUSD price unavailable for ${asset}`);
      }

      return [asset, { price: latest.close, timestamp: latest.timestamp }] as const;
    })
  );

  const prices: Record<string, KrakenXusdPrice> = {};
  for (const result of settled) {
    if (result.status === "fulfilled") {
      const [asset, price] = result.value;
      prices[asset] = price;
    }
  }

  return { prices, fetchedAt: Date.now() };
}

export function useBirdsEyeData(
  supportedPools: SupportedPool[],
  options: { enabled?: boolean; includeDepthMetrics?: boolean } = {}
): BirdsEyeData {
  const enabled = options.enabled ?? true;
  const includeDepthMetrics = options.includeDepthMetrics ?? true;
  const depthWorkerRef = useRef<Worker | null>(null);
  const depthRequestIdRef = useRef(0);
  const depthMetricJobsRef = useRef<BirdsEyeDepthMetricJob[]>([]);
  const baseDataCacheRef = useRef<BirdsEyeDataCache | null>(null);
  const [depthMetricsState, setDepthMetricsState] =
    useState<DepthMetricsState>(EMPTY_DEPTH_METRICS_STATE);
  const activeSpaceSlug = supportedPools[0]?.spaceSlug ?? null;
  const allTokenPrices = useAllTokenPrices({ enabled, spaceSlug: activeSpaceSlug });
  const priceMap = useMemo(
    () => allTokenPrices.data?.pricesUsdByAddress ?? {},
    [allTokenPrices.data?.pricesUsdByAddress]
  );
  const overall = useBirdsEyeSettingsStore((s) => s.overall);
  const poolOverrides = useBirdsEyeSettingsStore((s) => s.poolOverrides);
  const isKrakenOrg = useMemo(
    () => supportedPools.length > 0 && supportedPools.every((p) => isKrakenLikeSpace(p.spaceSlug)),
    [supportedPools]
  );
  const isDemoOrg = isDemoSpaceSlug(activeSpaceSlug);
  const supportedPoolKeyList = useMemo(
    () => supportedPools.map((p) => p.poolKey).join("|"),
    [supportedPools]
  );
  const krakenTrackedAssets = useMemo(() => {
    if (!isKrakenOrg) return [] as string[];
    return Array.from(
      new Set(
        supportedPools.map((pool) => {
          return getTrackedAssetForPool(pool).symbol;
        })
      )
    ).sort();
  }, [isKrakenOrg, supportedPools]);

  // ── RPC pool prices: read on-chain sqrt_price_x64 directly from Solana RPC ──
  const solanaPoolKeys = useMemo(
    () => supportedPools.filter((p) => isSolanaPool(p.poolKey)).map((p) => p.poolKey),
    [supportedPools]
  );
  const rpcPricesQuery = useQuery({
    queryKey: ["birdsEyeRpcPoolPrices", activeSpaceSlug, solanaPoolKeys.join(",")],
    queryFn: () => fetchRpcPoolPrices(solanaPoolKeys, activeSpaceSlug),
    enabled: enabled && solanaPoolKeys.length > 0,
    staleTime: PRICE_PEG_REFRESH_MS,
    gcTime: 5 * 60 * 1000,
    refetchInterval: PRICE_PEG_REFRESH_MS,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const rpcPriceMap = useMemo(
    () => rpcPricesQuery.data?.prices ?? {},
    [rpcPricesQuery.data?.prices]
  );
  // Oracle prices fetched in the same request as RPC pool prices (from CoinGecko)
  const rpcOraclePriceMap = useMemo(
    () => rpcPricesQuery.data?.oraclePrices ?? {},
    [rpcPricesQuery.data?.oraclePrices]
  );
  const rpcOracleUpdatedAtMap = useMemo(
    () => rpcPricesQuery.data?.oracleUpdatedAt ?? {},
    [rpcPricesQuery.data?.oracleUpdatedAt]
  );
  const rpcFetchedAt = rpcPricesQuery.data?.rpcFetchedAt ?? null;
  const oracleFetchedAt = rpcPricesQuery.data?.oracleFetchedAt ?? null;
  const krakenXusdPricesQuery = useQuery({
    queryKey: ["birdsEyeKrakenXusdPrices", activeSpaceSlug, krakenTrackedAssets.join(",")],
    queryFn: () => fetchKrakenXusdPrices(krakenTrackedAssets, activeSpaceSlug),
    enabled: enabled && isKrakenOrg && krakenTrackedAssets.length > 0,
    staleTime: PRICE_PEG_REFRESH_MS,
    gcTime: 5 * 60 * 1000,
    refetchInterval: PRICE_PEG_REFRESH_MS,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const krakenXusdPriceMap = useMemo(
    () => krakenXusdPricesQuery.data?.prices ?? {},
    [krakenXusdPricesQuery.data?.prices]
  );
  const krakenXusdFetchedAt = krakenXusdPricesQuery.data?.fetchedAt ?? null;

  const shouldUseSnapshot = useMemo(
    () => supportedPools.length > 0 && supportedPools.every((p) => p.protocol === "raydium" || p.protocol === "meteora"),
    [supportedPools]
  );
  const snapshotSpaceSlug = supportedPools[0]?.spaceSlug ?? "";
  const snapshotQuery = useQuery({
    queryKey: ["birdsEyeSnapshot", snapshotSpaceSlug, supportedPoolKeyList],
    queryFn: () => fetchBirdsEyeSnapshot(snapshotSpaceSlug),
    enabled: enabled && shouldUseSnapshot && !!snapshotSpaceSlug,
    staleTime: BIRDS_EYE_STALE_TIME_MS,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 2,
  });
  const snapshotPoolMap = useMemo(() => {
    const map = new Map<
      string,
      {
        poolData: PoolData | null;
        positionsByOwner: PositionsByOwner[];
      }
    >();
    for (const row of snapshotQuery.data?.pools ?? []) {
      map.set(row.pool.poolKey, {
        poolData: row.poolData,
        positionsByOwner: row.positionsByOwner ?? [],
      });
    }
    return map;
  }, [snapshotQuery.data]);
  const totalBatches = Math.max(
    1,
    Math.ceil(supportedPools.length / BIRDS_EYE_BATCH_SIZE)
  );
  const [activePoolBatches, setActivePoolBatches] = useState(1);
  const [activePositionBatches, setActivePositionBatches] = useState(0);

  useEffect(() => {
    setActivePoolBatches(1);
    setActivePositionBatches(0);
  }, [supportedPoolKeyList]);

  const activePoolCount = Math.min(
    supportedPools.length,
    activePoolBatches * BIRDS_EYE_BATCH_SIZE
  );
  const activePositionCount = Math.min(
    supportedPools.length,
    activePositionBatches * BIRDS_EYE_BATCH_SIZE
  );
  const firstBatchCount = Math.min(BIRDS_EYE_BATCH_SIZE, supportedPools.length);

  const poolQueries = useQueries({
    queries: supportedPools.map((pool, i) => ({
      queryKey: ["pool", pool.poolKey],
      queryFn: () => fetchPoolData(pool.poolKey),
      enabled: enabled && !shouldUseSnapshot && i < activePoolCount,
      staleTime: BIRDS_EYE_STALE_TIME_MS,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 2,
    })),
  });

  const poolPositionsQueries = useQueries({
    queries: supportedPools.map((pool, i) => ({
      queryKey: ["allPoolPositionsBirdsEye", pool.poolKey],
      queryFn: () => fetchAllPoolPositions(pool.poolKey, { mode: "birds-eye" }),
      enabled:
        enabled &&
        !shouldUseSnapshot &&
        i < activePositionCount &&
        (!!poolQueries[i]?.data || !!poolQueries[i]?.error),
      staleTime: BIRDS_EYE_STALE_TIME_MS,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 2,
    })),
  });

  useEffect(() => {
    if (!enabled) return;
    if (shouldUseSnapshot) return;
    if (activePositionBatches > 0) return;
    if (firstBatchCount === 0) return;
    const firstBatchPoolsSettled = poolQueries
      .slice(0, firstBatchCount)
      .every((q) => !q.isLoading && !q.isFetching);
    if (firstBatchPoolsSettled) {
      setActivePositionBatches(1);
    }
  }, [enabled, shouldUseSnapshot, activePositionBatches, firstBatchCount, poolQueries]);

  useEffect(() => {
    if (!enabled) return;
    if (shouldUseSnapshot) return;
    if (activePoolBatches >= totalBatches) return;
    const settledActivePools = poolQueries
      .slice(0, activePoolCount)
      .every((q) => !q.isLoading && !q.isFetching);
    if (settledActivePools) {
      setActivePoolBatches((current) => Math.min(current + 1, totalBatches));
    }
  }, [
    enabled,
    shouldUseSnapshot,
    activePoolBatches,
    totalBatches,
    poolQueries,
    activePoolCount,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (shouldUseSnapshot) return;
    if (activePositionBatches === 0 || activePositionBatches >= totalBatches) {
      return;
    }
    const settledActivePositions = Array.from({
      length: activePositionCount,
    }).every((_, i) => {
      const poolQuery = poolQueries[i];
      const positionQuery = poolPositionsQueries[i];
      if (!poolQuery) return false;
      if (poolQuery.isLoading || poolQuery.isFetching) return false;
      if (poolQuery.error) return true;
      if (!positionQuery) return false;
      return !positionQuery.isLoading && !positionQuery.isFetching;
    });
    if (settledActivePositions) {
      setActivePositionBatches((current) =>
        Math.min(current + 1, totalBatches)
      );
    }
  }, [
    enabled,
    shouldUseSnapshot,
    activePositionBatches,
    totalBatches,
    activePositionCount,
    poolQueries,
    poolPositionsQueries,
  ]);

  const queryStatesKey = useMemo(
    () =>
      poolQueries
        .map((query) =>
          [
            query.isLoading ? 1 : 0,
            query.isFetching ? 1 : 0,
            query.dataUpdatedAt,
            query.errorUpdatedAt,
          ].join(":")
        )
        .join("|"),
    [poolQueries]
  );
  const positionQueryStatesKey = useMemo(
    () =>
      poolPositionsQueries
        .map((query) =>
          [
            query.isLoading ? 1 : 0,
            query.isFetching ? 1 : 0,
            query.dataUpdatedAt,
            query.errorUpdatedAt,
          ].join(":")
        )
        .join("|"),
    [poolPositionsQueries]
  );
  const settingsKey = useMemo(
    () => JSON.stringify([overall, poolOverrides]),
    [overall, poolOverrides]
  );
  const baseDataCacheKey = [
    enabled ? 1 : 0,
    supportedPoolKeyList,
    shouldUseSnapshot ? 1 : 0,
    allTokenPrices.isLoading ? 1 : 0,
    allTokenPrices.data?.updatedAt ?? "",
    isKrakenOrg ? 1 : 0,
    krakenXusdPricesQuery.isLoading ? 1 : 0,
    krakenXusdPricesQuery.dataUpdatedAt,
    krakenXusdFetchedAt ?? "",
    snapshotQuery.isLoading ? 1 : 0,
    snapshotQuery.dataUpdatedAt,
    snapshotQuery.data?.generatedAt ?? "",
    rpcPricesQuery.isLoading ? 1 : 0,
    rpcPricesQuery.dataUpdatedAt,
    rpcFetchedAt ?? "",
    oracleFetchedAt ?? "",
    shouldUseSnapshot ? "" : activePoolBatches,
    shouldUseSnapshot ? "" : activePositionBatches,
    shouldUseSnapshot ? "" : queryStatesKey,
    shouldUseSnapshot ? "" : positionQueryStatesKey,
    settingsKey,
  ].join("|");

  const baseData = useMemo(() => {
    if (baseDataCacheRef.current?.key === baseDataCacheKey) {
      return baseDataCacheRef.current.value;
    }

    if (!enabled) {
      const value = {
        pools: [],
        isLoading: false,
        depthMetricsLoading: false,
        totalAssets: supportedPools.length,
        healthyCount: 0,
        watchCount: 0,
        criticalCount: 0,
      };
      baseDataCacheRef.current = { key: baseDataCacheKey, value };
      return value;
    }

    const isLoading =
      allTokenPrices.isLoading ||
      (isKrakenOrg && krakenXusdPricesQuery.isLoading) ||
      rpcPricesQuery.isLoading ||
      (shouldUseSnapshot
        ? snapshotQuery.isLoading
        : poolQueries.some((q) => q.isLoading) ||
          poolPositionsQueries.some((q) => q.isLoading));

    const cards: BirdsEyePoolCard[] = supportedPools.map((pool, i) => {
      const queryResult = shouldUseSnapshot ? null : poolQueries[i];
      const positionsResult = shouldUseSnapshot ? null : poolPositionsQueries[i];
      const snapshotPool = shouldUseSnapshot
        ? snapshotPoolMap.get(pool.poolKey)
        : null;
      const pd = shouldUseSnapshot
        ? (snapshotPool?.poolData ?? null)
        : (queryResult?.data ?? null);
      const loading = shouldUseSnapshot
        ? snapshotQuery.isLoading
        : (queryResult?.isLoading ?? true);

      const [labelToken0Symbol, labelToken1Symbol] = getPoolTokenSymbols(pool);
      const trackedAssetConfig = getTrackedAssetForPool(pool);
      const trackedAsset = trackedAssetConfig.symbol;
      // The label order doesn't always match the on-chain token0/token1 order
      // (e.g. label "PRL / USDT" but the EVM pool stores USDT as token0 and PRL
      // as token1). Re-derive `isToken0` from the actual pool symbols so price
      // lookups via `card.token0Usd / token1Usd` line up with the tracked asset.
      const chainToken0Symbol = pd?.token0Symbol ?? labelToken0Symbol;
      const chainToken1Symbol = pd?.token1Symbol ?? labelToken1Symbol;
      const trackedSymbolUpper = trackedAsset.toUpperCase();
      const isToken0 =
        chainToken0Symbol.toUpperCase() === trackedSymbolUpper
          ? true
          : chainToken1Symbol.toUpperCase() === trackedSymbolUpper
            ? false
            : trackedAssetConfig.isToken0;
      const counterAsset = isToken0 ? chainToken1Symbol : chainToken0Symbol;

      // Resolve USD prices
      const t0AddrNorm = pd?.token0Address ? normalizePoolKey(pd.token0Address) : "";
      const t1AddrNorm = pd?.token1Address ? normalizePoolKey(pd.token1Address) : "";
      const t0PriceKey = t0AddrNorm.toLowerCase();
      const t1PriceKey = t1AddrNorm.toLowerCase();
      let token0Usd: number | null = t0PriceKey
        ? (priceMap[t0PriceKey] ?? null)
        : null;
      let token1Usd: number | null = t1PriceKey
        ? (priceMap[t1PriceKey] ?? null)
        : null;

      // Derive missing prices from pool ratio
      if (
        token0Usd === null &&
        token1Usd !== null &&
        pd &&
        pd.currentPrice > 0
      ) {
        token0Usd = token1Usd * pd.currentPrice;
      }
      if (
        token1Usd === null &&
        token0Usd !== null &&
        pd &&
        pd.currentPrice > 0
      ) {
        token1Usd = token0Usd / pd.currentPrice;
      }

      // Pool-implied price of tracked token.
      // Prefer the on-chain RPC price (fetched directly from Solana RPC) over
      // the indexed price from Railway so the Price Peg metric uses the actual
      // latest on-chain data, comparable with the oracle reference.
      const rpcPrice = rpcPriceMap[pool.poolKey];
      const effectivePoolPrice =
        rpcPrice && rpcPrice.price > 0 ? rpcPrice.price : (pd?.currentPrice ?? 0);

      let poolPriceUsd = 0;
      if (effectivePoolPrice > 0) {
        if (isToken0) {
          const counterUsd = t1PriceKey
            ? (rpcOraclePriceMap[t1PriceKey] ?? priceMap[t1PriceKey] ?? null)
            : null;
          if (counterUsd !== null) {
            poolPriceUsd = effectivePoolPrice * counterUsd;
          }
        } else {
          const counterUsd = t0PriceKey
            ? (rpcOraclePriceMap[t0PriceKey] ?? priceMap[t0PriceKey] ?? null)
            : null;
          if (counterUsd !== null) {
            poolPriceUsd = counterUsd / effectivePoolPrice;
          }
        }
      }

      // Reference price:
      // - Kraken org: latest Kraken xUSD price for the tracked asset
      // - Other orgs: CoinGecko oracle price fetched alongside the RPC pool price
      const trackedPriceKey = isToken0 ? t0PriceKey : t1PriceKey;
      const krakenXusdPrice = isKrakenOrg
        ? (krakenXusdPriceMap[trackedAsset] ?? null)
        : null;
      const fallbackOraclePriceUsd = trackedPriceKey
        ? (rpcOraclePriceMap[trackedPriceKey] ?? priceMap[trackedPriceKey] ?? null)
        : null;
      const referencePriceUsd = isKrakenOrg
        ? (krakenXusdPrice?.price ?? null)
        : fallbackOraclePriceUsd;
      const referenceLabel = isDemoOrg
        ? "Demo oracle" as const
        : isKrakenOrg
          ? "Kraken xUSD" as const
          : "CoinGecko Oracle" as const;
      const referenceFetchedAt = isKrakenOrg ? krakenXusdFetchedAt : oracleFetchedAt;
      const referenceUpdatedAt = isKrakenOrg
        ? (krakenXusdPrice?.timestamp ?? null)
        : (trackedPriceKey ? (rpcOracleUpdatedAtMap[trackedPriceKey] ?? null) : null);

      // Deviation
      const deviationPct =
        referencePriceUsd && referencePriceUsd > 0 && poolPriceUsd > 0
          ? Math.abs(
              ((poolPriceUsd - referencePriceUsd) / referencePriceUsd) * 100
            )
          : 0;
      const pricePegPct =
        referencePriceUsd && referencePriceUsd > 0 && poolPriceUsd > 0
          ? ((poolPriceUsd - referencePriceUsd) / referencePriceUsd) * 100
          : 0;

      const positionsByOwner = shouldUseSnapshot
        ? (snapshotPool?.positionsByOwner ?? [])
        : (positionsResult?.data ?? []);
      const allPositions = positionsByOwner.flatMap((owner) => owner.positions);
      const tvlUsd = resolvePoolTvlUsd({
        poolData: pd,
        positions: allPositions,
        token0Usd,
        token1Usd,
      });

      // Effective spread = fee × 2 + price impact of a $10k sell
      const fee = pd?.fee ?? 0;
      const feePct = fee / 10000; // basis points → percentage
      const feeTier = `${feePct.toFixed(2)}%`;

      const thresholds = getResolvedThresholds(pool.poolKey, overall, poolOverrides);

      const flag = flagMetrics({
        deviationPct,
        thresholds,
      });
      const status = LEVEL_TO_STATUS[flag.level];
      const statusText = flag.reason;

      return {
        pool,
        poolData: pd,
        isLoading: loading,
        positions: positionsByOwner,
        token0Usd,
        token1Usd,
        trackedAsset,
        counterAsset,
        isTrackedToken0: isToken0,
        status,
        statusText,
        poolPriceUsd,
        referencePriceUsd,
        referenceLabel,
        pricePegPct,
        deviationPct,
        rpcFetchedAt,
        referenceFetchedAt,
        referenceUpdatedAt,
        tvlUsd,
        depthBuyAt2PctUsd: null,
        depthSellAt2PctUsd: null,
        feeTier,
        effectiveSpreadPct: null,
        activeLpCount: positionsByOwner.length,
        thresholds,
      };
    });

    // Sort: critical first, then watch, then healthy
    const statusOrder: Record<PoolHealthStatus, number> = {
      critical: 0,
      watch: 1,
      healthy: 2,
    };
    cards.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const healthyCount = cards.filter((c) => c.status === "healthy").length;
    const watchCount = cards.filter((c) => c.status === "watch").length;
    const criticalCount = cards.filter((c) => c.status === "critical").length;

    const value = {
      pools: cards,
      isLoading,
      depthMetricsLoading: false,
      totalAssets: cards.length,
      healthyCount,
      watchCount,
      criticalCount,
    };
    baseDataCacheRef.current = { key: baseDataCacheKey, value };
    return value;
  }, [
    baseDataCacheKey,
    enabled,
    supportedPools,
    allTokenPrices.isLoading,
    poolQueries,
    poolPositionsQueries,
    shouldUseSnapshot,
    snapshotQuery.isLoading,
    snapshotPoolMap,
    priceMap,
    rpcPriceMap,
    rpcOraclePriceMap,
    rpcOracleUpdatedAtMap,
    rpcFetchedAt,
    oracleFetchedAt,
    isKrakenOrg,
    isDemoOrg,
    krakenXusdPriceMap,
    krakenXusdFetchedAt,
    krakenXusdPricesQuery.isLoading,
    rpcPricesQuery.isLoading,
    activeSpaceSlug,
    overall,
    poolOverrides,
  ]);

  const depthMetricJobs = useMemo<BirdsEyeDepthMetricJob[]>(() => {
    if (!enabled || !includeDepthMetrics) return [];

    return baseData.pools.flatMap((card) => {
      const pd = card.poolData;
      if (!pd || pd.currentPrice <= 0) return [];

      const positionCount = card.positions.reduce(
        (sum, owner) => sum + owner.positions.length,
        0
      );
      if (positionCount === 0) return [];

      const positionFingerprint = card.positions
        .map((owner) =>
          [
            owner.owner,
            owner.positions.length,
            String(owner.liquidityTotal),
            owner.positions
              .map((position) =>
                [
                  position.tickLower,
                  position.tickUpper,
                  position.liquidity,
                ].join(":")
              )
              .join(";"),
          ].join(":")
        )
        .join(",");

      return [
        {
          poolKey: card.pool.poolKey,
          currentPrice: pd.currentPrice,
          currentTick: pd.tick,
          sqrtPriceX96: pd.sqrtPriceX96,
          token0Decimals: pd.token0Decimals,
          token1Decimals: pd.token1Decimals,
          token0UsdPrice: card.token0Usd,
          token1UsdPrice: card.token1Usd,
          isTrackedToken0: card.isTrackedToken0,
          fee: pd.fee,
          positionFingerprint,
          positionsByOwner: card.positions.map((owner) => ({
            positions: owner.positions,
          })),
        },
      ];
    });
  }, [baseData.pools, enabled, includeDepthMetrics]);

  const depthMetricsRequestKey = useMemo(
    () =>
      depthMetricJobs
        .map((job) =>
          [
            job.poolKey,
            job.currentPrice,
            job.currentTick,
            job.sqrtPriceX96,
            job.token0Decimals,
            job.token1Decimals,
            job.token0UsdPrice ?? "",
            job.token1UsdPrice ?? "",
            job.isTrackedToken0 ? 1 : 0,
            job.fee,
            job.positionFingerprint,
          ].join(":")
        )
        .join("|"),
    [depthMetricJobs]
  );

  useEffect(() => {
    depthMetricJobsRef.current = depthMetricJobs;
  }, [depthMetricJobs]);

  useEffect(() => {
    return () => {
      depthWorkerRef.current?.terminate();
      depthWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const jobs = depthMetricJobsRef.current;
    if (
      !enabled ||
      !includeDepthMetrics ||
      jobs.length === 0 ||
      !depthMetricsRequestKey
    ) {
      setDepthMetricsState((current) =>
        current.requestKey === "" ? current : EMPTY_DEPTH_METRICS_STATE
      );
      return;
    }

    let worker = depthWorkerRef.current;
    if (!worker) {
      try {
        worker = createBirdsEyeDepthWorker();
      } catch {
        worker = null;
      }
    }
    if (!worker) {
      setDepthMetricsState((current) =>
        current.requestKey === "" ? current : EMPTY_DEPTH_METRICS_STATE
      );
      return;
    }
    depthWorkerRef.current = worker;

    const requestId = depthRequestIdRef.current + 1;
    depthRequestIdRef.current = requestId;
    let cancelled = false;

    const handleMessage = (event: MessageEvent<BirdsEyeDepthWorkerResponse>) => {
      if (cancelled || event.data.requestId !== depthRequestIdRef.current) {
        return;
      }

      setDepthMetricsState({
        requestKey: depthMetricsRequestKey,
        byPool: Object.fromEntries(
          event.data.results.map((result) => [result.poolKey, result])
        ),
      });
    };

    const handleError = () => {
      if (cancelled || requestId !== depthRequestIdRef.current) return;
      if (depthWorkerRef.current === worker) {
        worker.terminate();
        depthWorkerRef.current = null;
      }
      setDepthMetricsState({
        requestKey: depthMetricsRequestKey,
        byPool: {},
      });
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    try {
      worker.postMessage({ requestId, jobs });
    } catch {
      handleError();
    }

    return () => {
      cancelled = true;
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };
  }, [
    depthMetricsRequestKey,
    enabled,
    includeDepthMetrics,
  ]);

  return useMemo(() => {
    const depthMetricsLoading =
      enabled &&
      includeDepthMetrics &&
      depthMetricJobs.length > 0 &&
      depthMetricsState.requestKey !== depthMetricsRequestKey;

    if (
      !includeDepthMetrics ||
      depthMetricsState.requestKey !== depthMetricsRequestKey
    ) {
      return { ...baseData, depthMetricsLoading };
    }

    return {
      ...baseData,
      depthMetricsLoading,
      pools: baseData.pools.map((card) => {
        const metrics = depthMetricsState.byPool[card.pool.poolKey];
        if (!metrics) return card;

        return {
          ...card,
          depthBuyAt2PctUsd: metrics.depthBuyAt2PctUsd,
          depthSellAt2PctUsd: metrics.depthSellAt2PctUsd,
          effectiveSpreadPct: metrics.effectiveSpreadPct,
        };
      }),
    };
  }, [
    baseData,
    depthMetricJobs.length,
    depthMetricsRequestKey,
    depthMetricsState,
    enabled,
    includeDepthMetrics,
  ]);
}
