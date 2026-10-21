import { useMemo } from "react";
import { useUnifiedPoolData } from "@/hooks/use-unified-pool-data";
import { usePoolDayData } from "@/hooks/use-pool-metrics";
import { useAllPoolPositions } from "@/hooks/use-lp-historical-data";
import { useAllTokenPrices } from "@/hooks/use-token-price";
import { useHistoricalOracle } from "@/hooks/use-historical-oracle";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";
import { normalizePoolKey, type SupportedPool } from "@/lib/pools";
import { resolvePoolTvlUsd } from "@/lib/pool-tvl";
import type { PoolData } from "@/app/api/pool/[address]/route";
import type { PoolDayData, PositionData } from "@/lib/envio-client";
import { useLiquidityHistoryByAddress } from "@/hooks/use-liquidity-history-by-address";

export interface PoolMetricsRow {
  pool: SupportedPool;
  poolData: PoolData | null;
  dayData: PoolDayData[];
  positions: { owner: string; positions: PositionData[]; liquidityTotal: bigint }[];
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  txCount24h: number;
  depthAt2PctUsd: number;
  price: number;
  priceUsd: number;
  token0Usd: number | null;
  token1Usd: number | null;
  activeLpCount: number;
  /** Pre-computed historical TVL per day (same order as dayData: newest first). */
  dailyTvl: { date: number; tvlUsd: number }[];
}

export interface TokenDashboardData {
  tokenSymbol: string;
  tokenUsdPrice: number | null;
  priceChange24hPct: number | null;
  pools: PoolMetricsRow[];
  totalTVL: number;
  total24hVolume: number;
  total24hFees: number;
  totalTxns: number;
  totalActiveLPs: number;
  referencePoolKey: string | null;
  maxSpreadPct: number;
  netFlow7dUsd: number;
  isLoading: boolean;
}

// Format compact USD values
export const formatCompact = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) {
    const k = value / 1_000;
    return `$${k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `$${value.toFixed(0)}`;
};

/** Use pool data for up to 6 pools. Returns individual hooks results. */
function useMultiPoolData(pools: SupportedPool[]) {
  // We call hooks unconditionally for up to 6 pools (max in any token group)
  const p0 = useUnifiedPoolData(pools[0]?.poolKey ?? "", pools.length > 0);
  const p1 = useUnifiedPoolData(pools[1]?.poolKey ?? "", pools.length > 1);
  const p2 = useUnifiedPoolData(pools[2]?.poolKey ?? "", pools.length > 2);
  const p3 = useUnifiedPoolData(pools[3]?.poolKey ?? "", pools.length > 3);
  const p4 = useUnifiedPoolData(pools[4]?.poolKey ?? "", pools.length > 4);
  const p5 = useUnifiedPoolData(pools[5]?.poolKey ?? "", pools.length > 5);
  const all = [p0, p1, p2, p3, p4, p5];
  return all.slice(0, pools.length);
}

function useMultiPoolDayData(pools: SupportedPool[]) {
  const p0 = usePoolDayData(pools[0]?.poolKey ?? "", 14, pools.length > 0);
  const p1 = usePoolDayData(pools[1]?.poolKey ?? "", 14, pools.length > 1);
  const p2 = usePoolDayData(pools[2]?.poolKey ?? "", 14, pools.length > 2);
  const p3 = usePoolDayData(pools[3]?.poolKey ?? "", 14, pools.length > 3);
  const p4 = usePoolDayData(pools[4]?.poolKey ?? "", 14, pools.length > 4);
  const p5 = usePoolDayData(pools[5]?.poolKey ?? "", 14, pools.length > 5);
  const all = [p0, p1, p2, p3, p4, p5];
  return all.slice(0, pools.length);
}

function useMultiPoolPositions(pools: SupportedPool[]) {
  const p0 = useAllPoolPositions(pools[0]?.poolKey ?? "", pools.length > 0);
  const p1 = useAllPoolPositions(pools[1]?.poolKey ?? "", pools.length > 1);
  const p2 = useAllPoolPositions(pools[2]?.poolKey ?? "", pools.length > 2);
  const p3 = useAllPoolPositions(pools[3]?.poolKey ?? "", pools.length > 3);
  const p4 = useAllPoolPositions(pools[4]?.poolKey ?? "", pools.length > 4);
  const p5 = useAllPoolPositions(pools[5]?.poolKey ?? "", pools.length > 5);
  const all = [p0, p1, p2, p3, p4, p5];
  return all.slice(0, pools.length);
}

function buildDailyPriceMap(dayData: PoolDayData[] | undefined): Map<number, string> | undefined {
  if (!dayData || dayData.length === 0) return undefined;
  const map = new Map<number, string>();
  for (const day of dayData) {
    if (day.closePrice) {
      map.set(day.date, day.closePrice);
    }
  }
  return map;
}

function useMultiPoolLiquidityHistory(
  pools: SupportedPool[],
  poolDataResults: { data: PoolData | null | undefined }[],
  dayDataResults: { data: PoolDayData[] | undefined }[],
  priceMap: Record<string, number | null>
) {
  const getParams = (i: number) => {
    const pd = i < pools.length ? (poolDataResults[i]?.data ?? null) : null;
    if (i >= pools.length) {
      return {
        poolKey: "",
        token0Decimals: 18,
        token1Decimals: 6,
        sqrtPriceX96: undefined as string | undefined,
        t0Usd: null as number | null,
        t1Usd: null as number | null,
        dailyPriceMap: undefined as Map<number, string> | undefined,
        spaceSlug: null as string | null,
      };
    }
    const t0Addr = pd?.token0Address?.toLowerCase();
    const t1Addr = pd?.token1Address?.toLowerCase();
    let t0Usd: number | null = t0Addr ? (priceMap[t0Addr] ?? null) : null;
    let t1Usd: number | null = t1Addr ? (priceMap[t1Addr] ?? null) : null;
    if (t0Usd === null && t1Usd !== null && pd && pd.currentPrice > 0) t0Usd = t1Usd * pd.currentPrice;
    if (t1Usd === null && t0Usd !== null && pd && pd.currentPrice > 0) t1Usd = t0Usd / pd.currentPrice;
    return {
      poolKey: pools[i]?.poolKey ?? "",
      token0Decimals: pd?.token0Decimals ?? 18,
      token1Decimals: pd?.token1Decimals ?? 6,
      sqrtPriceX96: pd?.sqrtPriceX96 || undefined,
      t0Usd,
      t1Usd,
      dailyPriceMap: buildDailyPriceMap(dayDataResults[i]?.data),
      spaceSlug: pools[i]?.spaceSlug ?? null,
    };
  };

  const p0 = getParams(0);
  const p1 = getParams(1);
  const p2 = getParams(2);
  const p3 = getParams(3);
  const p4 = getParams(4);
  const p5 = getParams(5);

  const h0 = useLiquidityHistoryByAddress(p0.poolKey, 14, p0.token0Decimals, p0.token1Decimals, p0.sqrtPriceX96, p0.t0Usd, p0.t1Usd, p0.dailyPriceMap, pools.length > 0, p0.spaceSlug);
  const h1 = useLiquidityHistoryByAddress(p1.poolKey, 14, p1.token0Decimals, p1.token1Decimals, p1.sqrtPriceX96, p1.t0Usd, p1.t1Usd, p1.dailyPriceMap, pools.length > 1, p1.spaceSlug);
  const h2 = useLiquidityHistoryByAddress(p2.poolKey, 14, p2.token0Decimals, p2.token1Decimals, p2.sqrtPriceX96, p2.t0Usd, p2.t1Usd, p2.dailyPriceMap, pools.length > 2, p2.spaceSlug);
  const h3 = useLiquidityHistoryByAddress(p3.poolKey, 14, p3.token0Decimals, p3.token1Decimals, p3.sqrtPriceX96, p3.t0Usd, p3.t1Usd, p3.dailyPriceMap, pools.length > 3, p3.spaceSlug);
  const h4 = useLiquidityHistoryByAddress(p4.poolKey, 14, p4.token0Decimals, p4.token1Decimals, p4.sqrtPriceX96, p4.t0Usd, p4.t1Usd, p4.dailyPriceMap, pools.length > 4, p4.spaceSlug);
  const h5 = useLiquidityHistoryByAddress(p5.poolKey, 14, p5.token0Decimals, p5.token1Decimals, p5.sqrtPriceX96, p5.t0Usd, p5.t1Usd, p5.dailyPriceMap, pools.length > 5, p5.spaceSlug);

  const all = [h0, h1, h2, h3, h4, h5];
  return all.slice(0, pools.length);
}

function computeDepthAt2Pct(
  positions: PositionData[],
  currentTick: number,
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number,
  token0Usd: number,
  token1Usd: number
): number {
  const ticksForPercent = Math.abs(Math.log(1.02) / Math.log(1.0001));
  const minTick = Math.floor(currentTick - ticksForPercent);
  const maxTick = Math.ceil(currentTick + ticksForPercent);

  let depth = 0;
  for (const pos of positions) {
    const liq = BigInt(pos.liquidity);
    if (liq <= 0n) continue;
    if (pos.tickUpper <= minTick || pos.tickLower >= maxTick) continue;

    const overlapLower = Math.max(pos.tickLower, minTick);
    const overlapUpper = Math.min(pos.tickUpper, maxTick);
    if (overlapLower >= overlapUpper) continue;

    const { amount0, amount1 } = amountsForPosition({
      liquidity: liq,
      tickLower: overlapLower,
      tickUpper: overlapUpper,
      sqrtPriceX96,
    });
    const amt0 = bigintToApproxNumber(amount0, token0Decimals);
    const amt1 = bigintToApproxNumber(amount1, token1Decimals);
    depth += amt0 * token0Usd + amt1 * token1Usd;
  }
  return depth;
}

export function useTokenDashboardData(
  tokenSymbol: string,
  pools: SupportedPool[],
  spaceSlug?: string | null
): TokenDashboardData {
  const effectiveSpaceSlug = spaceSlug ?? pools[0]?.spaceSlug ?? null;
  const allTokenPrices = useAllTokenPrices({ spaceSlug: effectiveSpaceSlug });
  const poolDataResults = useMultiPoolData(pools);
  const dayDataResults = useMultiPoolDayData(pools);
  const positionResults = useMultiPoolPositions(pools);

  const priceMap = allTokenPrices.data?.pricesUsdByAddress ?? {};
  const historyResults = useMultiPoolLiquidityHistory(pools, poolDataResults, dayDataResults, priceMap);

  // Determine the tracked token's contract address for real oracle lookup
  const trackedTokenAddress = useMemo(() => {
    for (const result of poolDataResults) {
      const pd = result?.data;
      if (!pd) continue;
      const isT0 = (pd.token0Symbol?.toUpperCase() ?? "") === tokenSymbol.toUpperCase();
      const addr = isT0 ? (pd.token0Address ?? "") : (pd.token1Address ?? "");
      return normalizePoolKey(addr);
    }
    return "";
  }, [poolDataResults, tokenSymbol]);

  // Fetch real CoinGecko oracle price via market_chart/range API
  // (same source as individual pool dashboards — Arbitrage Pressure, LP Activity, etc.)
  const oracleTimeEnd = useMemo(() => Math.floor(Date.now() / 1000 / 300) * 300, []);
  const oracleResult = useHistoricalOracle({
    source: "coingecko",
    tokenAddress: trackedTokenAddress,
    startTime: oracleTimeEnd - 86400,
    endTime: oracleTimeEnd,
    enabled: !!trackedTokenAddress,
    spaceSlug: effectiveSpaceSlug,
  });

  return useMemo(() => {
    const isLoading =
      allTokenPrices.isLoading ||
      oracleResult.isLoading ||
      poolDataResults.some((r) => r.isLoading) ||
      dayDataResults.some((r) => r.isLoading) ||
      positionResults.some((r) => r.isLoading);

    const poolRows: PoolMetricsRow[] = [];

    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      const pd = poolDataResults[i]?.data ?? null;
      const dd = dayDataResults[i]?.data ?? [];
      const posData = positionResults[i]?.data ?? [];

      // Resolve USD prices
      const t0Addr = pd?.token0Address?.toLowerCase();
      const t1Addr = pd?.token1Address?.toLowerCase();
      let token0Usd: number | null = t0Addr ? (priceMap[t0Addr] ?? null) : null;
      let token1Usd: number | null = t1Addr ? (priceMap[t1Addr] ?? null) : null;

      // Derive missing prices
      if (token0Usd === null && token1Usd !== null && pd && pd.currentPrice > 0) {
        token0Usd = token1Usd * pd.currentPrice;
      }
      if (token1Usd === null && token0Usd !== null && pd && pd.currentPrice > 0) {
        token1Usd = token0Usd / pd.currentPrice;
      }

      // Volume & fees from day data
      const today = dd[0];
      const token1Decimals = pd?.token1Decimals ?? 6;
      const vol1Raw = today ? Number(today.volumeToken1) : 0;
      const fees1Raw = today ? Number(today.feesToken1) : 0;
      const volume24hUsd = (vol1Raw / 10 ** token1Decimals) * (token1Usd ?? 0);
      const fees24hUsd = (fees1Raw / 10 ** token1Decimals) * (token1Usd ?? 0);
      const txCount24h = today?.txCount ?? 0;

      // Flatten all positions once for depth and daily TVL computation
      const allPositions = posData.flatMap((g) => g.positions);

      const tvlUsd = resolvePoolTvlUsd({
        poolData: pd,
        positions: allPositions,
        token0Usd,
        token1Usd,
      });

      // Depth ±2%
      let depthAt2PctUsd = 0;
      if (pd && token0Usd !== null && token1Usd !== null) {
        depthAt2PctUsd = computeDepthAt2Pct(
          allPositions,
          pd.tick,
          BigInt(pd.sqrtPriceX96),
          pd.token0Decimals,
          pd.token1Decimals,
          token0Usd,
          token1Usd
        );
      }

      // Populate dailyTvl from event-replay history (same approach as
      // "Liquidity Distribution Over Time" in individual pool dashboards).
      // Reconstructs historical position states via backward MINT/BURN replay.
      const dailyTvl: { date: number; tvlUsd: number }[] = [];
      const histResult = historyResults[i];
      if (histResult?.data?.snapshots) {
        // Snapshots are chronological (oldest first); store newest-first
        // to match the dayData convention used elsewhere.
        const snaps = histResult.data.snapshots;
        for (let si = snaps.length - 1; si >= 0; si--) {
          dailyTvl.push({ date: snaps[si].date, tvlUsd: snaps[si].totalUsd });
        }
      }

      // Pool-implied USD price of tracked token using counter-token's CoinGecko price
      let priceUsd = 0;
      if (pd && pd.currentPrice > 0) {
        const isToken0 = (pd.token0Symbol?.toUpperCase() ?? "") === tokenSymbol.toUpperCase();
        if (isToken0) {
          // tracked = token0: price = currentPrice (token1/token0) × token1 CoinGecko USD
          const counterUsd = t1Addr ? (priceMap[t1Addr] ?? null) : null;
          if (counterUsd !== null) {
            priceUsd = pd.currentPrice * counterUsd;
          }
        } else {
          // tracked = token1: price = token0 CoinGecko USD / currentPrice
          const counterUsd = t0Addr ? (priceMap[t0Addr] ?? null) : null;
          if (counterUsd !== null) {
            priceUsd = counterUsd / pd.currentPrice;
          }
        }
      }

      poolRows.push({
        pool,
        poolData: pd,
        dayData: dd,
        positions: posData,
        tvlUsd,
        volume24hUsd,
        fees24hUsd,
        txCount24h,
        depthAt2PctUsd,
        price: pd?.currentPrice ?? 0,
        priceUsd,
        token0Usd,
        token1Usd,
        activeLpCount: posData.length,
        dailyTvl,
      });
    }

    // Aggregates
    const totalTVL = poolRows.reduce((s, r) => s + r.tvlUsd, 0);
    const total24hVolume = poolRows.reduce((s, r) => s + r.volume24hUsd, 0);
    const total24hFees = poolRows.reduce((s, r) => s + r.fees24hUsd, 0);
    const totalTxns = poolRows.reduce((s, r) => s + r.txCount24h, 0);

    // Unique LP count
    const lpSet = new Set<string>();
    for (const row of poolRows) {
      for (const g of row.positions) {
        lpSet.add(g.owner.toLowerCase());
      }
    }
    const totalActiveLPs = lpSet.size;

    // Reference pool (highest TVL)
    const refRow = poolRows.reduce<PoolMetricsRow | null>(
      (best, r) => (!best || r.tvlUsd > best.tvlUsd ? r : best),
      null
    );
    const referencePoolKey = refRow?.pool.poolKey ?? null;

    // Real CoinGecko oracle price from market_chart/range API
    // (same source as individual pool dashboards: Arbitrage Pressure, LP Activity charts)
    let oraclePrice: number | null = null;
    if (oracleResult.data && oracleResult.data.length > 0) {
      const latest = oracleResult.data[oracleResult.data.length - 1];
      if (latest && Number.isFinite(latest.price) && latest.price > 0) {
        oraclePrice = latest.price;
      }
    }

    // Max spread (compare pool-implied prices vs CoinGecko oracle)
    let maxSpreadPct = 0;
    if (oraclePrice && oraclePrice > 0) {
      for (const row of poolRows) {
        if (row.priceUsd > 0) {
          const dev = Math.abs((row.priceUsd - oraclePrice) / oraclePrice) * 100;
          if (dev > maxSpreadPct) maxSpreadPct = dev;
        }
      }
    }

    // Net TVL 7d (TVL change over last 7 days using position-based historical TVL)
    let netFlow7dUsd = 0;
    for (const row of poolRows) {
      if (row.dailyTvl.length >= 2) {
        const earliestIdx = Math.min(6, row.dailyTvl.length - 1);
        const earliestTvl = row.dailyTvl[earliestIdx]?.tvlUsd ?? 0;
        netFlow7dUsd += row.tvlUsd - earliestTvl;
      }
    }

    // Token USD price — direct CoinGecko oracle only (no pool-derived fallback)
    const tokenUsdPrice: number | null =
      oraclePrice && oraclePrice > 0
        ? oraclePrice
        : null;

    // 24h price change from day data
    let priceChange24hPct: number | null = null;
    if (refRow && refRow.dayData.length >= 2) {
      const todayClose = Number(refRow.dayData[0]?.closePrice ?? 0);
      const yesterdayClose = Number(refRow.dayData[1]?.closePrice ?? 0);
      if (yesterdayClose > 0 && todayClose > 0) {
        priceChange24hPct = ((todayClose - yesterdayClose) / yesterdayClose) * 100;
      }
    }

    return {
      tokenSymbol,
      tokenUsdPrice,
      priceChange24hPct,
      pools: poolRows,
      totalTVL,
      total24hVolume,
      total24hFees,
      totalTxns,
      totalActiveLPs,
      referencePoolKey,
      maxSpreadPct,
      netFlow7dUsd: netFlow7dUsd,
      isLoading,
    };
  }, [
    tokenSymbol,
    pools,
    allTokenPrices.isLoading,
    allTokenPrices.data,
    poolDataResults,
    dayDataResults,
    positionResults,
    historyResults,
    priceMap,
    oracleResult.data,
    oracleResult.isLoading,
  ]);
}
