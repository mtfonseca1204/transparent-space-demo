import { amountsForPosition, bigintToApproxNumber } from "./uniswap-v3-math";
import { PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY, normalizePoolKey } from "./pools";
import { getRailwayIndexerSpace } from "./worldchain-indexer-client";
import type {
  LPEventData,
  OwnerPositionAggregateData,
  PoolHourData,
  PositionData,
  TickLiquidityData,
} from "./envio-client";

type IntegerLike = string | number | bigint | null | undefined;

export interface WorldchainSelectedOwnerSummary {
  owner: string;
  positionCount: number;
  liquidity: string;
}

export interface WorldchainPoolDataMeta {
  latest: {
    positionUpdatedAt: number | null;
    ownerAggregateUpdatedAt: number | null;
    lpEventTimestamp: number | null;
    poolHourTimestamp: number | null;
    tickUpdatedAt: number | null;
    latestTradingSignal: number | null;
  };
  counts: {
    positions: number;
    ownerAggregates: number;
    lpevents: number;
    poolHourDatas: number;
    tickLiquidities: number;
    lpActivitySeries: number;
    ownerAddressesWithPositions: number;
    ownerAggregatesMissingPositions: number;
  };
  selectedOwner: WorldchainSelectedOwnerSummary | null;
  coverage: {
    rawLiquidityRatio: number | null;
    rawLiquidityMatchesPool: boolean | null;
    valueRatio: number | null;
    ownerAggregateCoverageRatio: number | null;
  };
  freshness: {
    positionUpdatedWithinWindow: boolean;
    ownerAggregateUpdatedWithinWindow: boolean;
    lpEventsPresentInWindow: boolean;
    positionLagSeconds: number | null;
    ownerAggregateLagSeconds: number | null;
    lpEventLagSeconds: number | null;
  };
  currentStateStatus: "renderable" | "empty";
  authoritativeEmptyWindow: boolean;
  decisions: {
    distributionSource: "positions" | "ticks" | "empty";
    ownerSummarySource: "ownerAggregates" | "positions" | "none";
    eventTimeSeriesSource: "events" | "zero-fill" | "none";
    selectedOwnerSource: "positions" | "ownerAggregates" | "none";
  };
}

interface BuildWorldchainPoolDataMetaArgs {
  pool: {
    tick?: number | string | null;
    liquidity?: IntegerLike;
    sqrtPriceX96?: IntegerLike;
    token0Decimals?: number | string | null;
    token1Decimals?: number | string | null;
    token0Balance?: number | string | null;
    token1Balance?: number | string | null;
    currentPrice?: number | string | null;
  };
  positions?: PositionData[] | null;
  ownerAggregates?: OwnerPositionAggregateData[] | null;
  lpevents?: LPEventData[] | null;
  poolHourDatas?: PoolHourData[] | null;
  tickLiquidities?: TickLiquidityData[] | null;
  lpActivitySeries?: Array<{
    timestamp: number;
    depth_band_buy?: number;
    depth_band_sell?: number;
  }> | null;
  startTime: number;
  endTime: number;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseBigInt(value: IntegerLike): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);
  }
  return 0n;
}

function maxDefined(values: Array<number | null | undefined>): number | null {
  let maxValue: number | null = null;
  for (const value of values) {
    if (!Number.isFinite(value ?? null)) continue;
    if (maxValue === null || (value as number) > maxValue) {
      maxValue = value as number;
    }
  }
  return maxValue;
}

function ratioOrNull(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  return Number(numerator) / Number(denominator);
}

function roundRatio(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(4));
}

export function buildWorldchainTimeBuckets(
  startTime: number,
  endTime: number,
  bucketSeconds: number,
): number[] {
  const safeBucket = Math.max(1, Math.trunc(bucketSeconds));
  const safeStart = Math.max(0, Math.trunc(startTime));
  const safeEnd = Math.max(safeStart + 1, Math.trunc(endTime));
  const alignedStart = Math.floor(safeStart / safeBucket) * safeBucket;
  const lastIncluded = Math.floor((safeEnd - 1) / safeBucket) * safeBucket;
  const buckets: number[] = [];
  for (let timestamp = alignedStart; timestamp <= lastIncluded; timestamp += safeBucket) {
    buckets.push(timestamp);
  }
  return buckets;
}

export function buildWorldchainPoolDataMeta({
  pool,
  positions = [],
  ownerAggregates = [],
  lpevents = [],
  poolHourDatas = [],
  tickLiquidities = [],
  lpActivitySeries = [],
  startTime,
  endTime,
}: BuildWorldchainPoolDataMetaArgs): WorldchainPoolDataMeta {
  const ownerPositions = new Map<string, { positionCount: number; liquidity: bigint }>();
  for (const position of positions) {
    const owner = position.owner?.toLowerCase();
    if (!owner) continue;
    const existing = ownerPositions.get(owner) ?? {
      positionCount: 0,
      liquidity: 0n,
    };
    existing.positionCount += 1;
    existing.liquidity += parseBigInt(position.liquidity);
    ownerPositions.set(owner, existing);
  }

  const selectedOwnerFromPositions =
    [...ownerPositions.entries()]
      .sort((left, right) =>
        right[1].liquidity > left[1].liquidity ? 1 : right[1].liquidity < left[1].liquidity ? -1 : 0,
      )[0] ?? null;
  const selectedOwnerFromOwnerAggregates =
    ownerAggregates.find((row) => Boolean(row.owner)) ?? null;

  const selectedOwner =
    selectedOwnerFromPositions !== null
      ? {
          owner: selectedOwnerFromPositions[0],
          positionCount: selectedOwnerFromPositions[1].positionCount,
          liquidity: selectedOwnerFromPositions[1].liquidity.toString(),
        }
      : selectedOwnerFromOwnerAggregates
        ? {
            owner: selectedOwnerFromOwnerAggregates.owner.toLowerCase(),
            positionCount: 0,
            liquidity: selectedOwnerFromOwnerAggregates.liquidityTotal,
          }
        : null;

  const currentTick = toFiniteNumber(pool.tick);
  const poolLiquidity = parseBigInt(pool.liquidity);
  const inRangePositionLiquidity =
    currentTick === null
      ? null
      : positions.reduce((total, position) => {
          const tickLower = toFiniteNumber(position.tickLower);
          const tickUpper = toFiniteNumber(position.tickUpper);
          if (tickLower === null || tickUpper === null) return total;
          if (tickLower <= currentTick && currentTick < tickUpper) {
            return total + parseBigInt(position.liquidity);
          }
          return total;
        }, 0n);

  const rawLiquidityRatio =
    currentTick === null || inRangePositionLiquidity === null
      ? null
      : ratioOrNull(inRangePositionLiquidity, poolLiquidity);
  const rawLiquidityMatchesPool =
    currentTick === null || inRangePositionLiquidity === null || poolLiquidity <= 0n
      ? null
      : inRangePositionLiquidity === poolLiquidity;

  const sqrtPriceX96 = parseBigInt(pool.sqrtPriceX96);
  const token0Decimals = toFiniteNumber(pool.token0Decimals) ?? 0;
  const token1Decimals = toFiniteNumber(pool.token1Decimals) ?? 0;
  const poolToken0Balance = toFiniteNumber(pool.token0Balance);
  const poolToken1Balance = toFiniteNumber(pool.token1Balance);
  const currentPrice = toFiniteNumber(pool.currentPrice);

  let positionToken0Total = 0;
  let positionToken1Total = 0;
  if (sqrtPriceX96 > 0n) {
    for (const position of positions) {
      const liquidity = parseBigInt(position.liquidity);
      const tickLower = toFiniteNumber(position.tickLower);
      const tickUpper = toFiniteNumber(position.tickUpper);
      if (liquidity <= 0n || tickLower === null || tickUpper === null || tickLower >= tickUpper) {
        continue;
      }
      try {
        const { amount0, amount1 } = amountsForPosition({
          liquidity,
          tickLower,
          tickUpper,
          sqrtPriceX96,
        });
        positionToken0Total += bigintToApproxNumber(amount0, token0Decimals);
        positionToken1Total += bigintToApproxNumber(amount1, token1Decimals);
      } catch {
        // Ignore malformed position math and keep the meta usable.
      }
    }
  }

  const valueRatio =
    poolToken0Balance === null ||
    poolToken1Balance === null ||
    currentPrice === null ||
    currentPrice <= 0
      ? null
      : (() => {
          const poolValueInToken1 = poolToken0Balance * currentPrice + poolToken1Balance;
          if (!Number.isFinite(poolValueInToken1) || poolValueInToken1 <= 0) return null;
          const positionValueInToken1 = positionToken0Total * currentPrice + positionToken1Total;
          if (!Number.isFinite(positionValueInToken1) || positionValueInToken1 < 0) return null;
          return positionValueInToken1 / poolValueInToken1;
        })();

  const ownerAggregatesMissingPositions = ownerAggregates.reduce((count, row) => {
    const owner = row.owner?.toLowerCase();
    if (!owner) return count;
    return ownerPositions.has(owner) ? count : count + 1;
  }, 0);
  const ownerAggregateCoverageRatio =
    ownerAggregates.length > 0
      ? (ownerAggregates.length - ownerAggregatesMissingPositions) / ownerAggregates.length
      : null;

  const latest = {
    positionUpdatedAt: maxDefined(positions.map((position) => toFiniteNumber(position.updatedAt))),
    ownerAggregateUpdatedAt: maxDefined(ownerAggregates.map((row) => toFiniteNumber(row.updatedAt))),
    lpEventTimestamp: maxDefined(lpevents.map((event) => toFiniteNumber(event.timestamp))),
    poolHourTimestamp: maxDefined(poolHourDatas.map((row) => toFiniteNumber(row.periodStartUnix))),
    tickUpdatedAt: maxDefined(tickLiquidities.map((row) => toFiniteNumber(row.updatedAt))),
    latestTradingSignal: null as number | null,
  };
  latest.latestTradingSignal = maxDefined([latest.poolHourTimestamp, latest.tickUpdatedAt]);

  const positionLagSeconds =
    latest.latestTradingSignal !== null && latest.positionUpdatedAt !== null
      ? Math.max(0, latest.latestTradingSignal - latest.positionUpdatedAt)
      : null;
  const ownerAggregateLagSeconds =
    latest.latestTradingSignal !== null && latest.ownerAggregateUpdatedAt !== null
      ? Math.max(0, latest.latestTradingSignal - latest.ownerAggregateUpdatedAt)
      : null;
  const lpEventLagSeconds =
    latest.latestTradingSignal !== null && latest.lpEventTimestamp !== null
      ? Math.max(0, latest.latestTradingSignal - latest.lpEventTimestamp)
      : null;

  const positionUpdatedWithinWindow =
    latest.positionUpdatedAt !== null &&
    latest.positionUpdatedAt >= startTime &&
    latest.positionUpdatedAt <= endTime;
  const ownerAggregateUpdatedWithinWindow =
    latest.ownerAggregateUpdatedAt !== null &&
    latest.ownerAggregateUpdatedAt >= startTime &&
    latest.ownerAggregateUpdatedAt <= endTime;
  const lpEventsPresentInWindow = lpevents.length > 0;

  const currentStateStatus =
    tickLiquidities.length > 0 || positions.length > 0 || ownerAggregates.length > 0
      ? "renderable"
      : "empty";
  const authoritativeEmptyWindow =
    lpevents.length === 0 &&
    currentStateStatus === "renderable" &&
    poolHourDatas.length > 0 &&
    tickLiquidities.length > 0;

  const distributionSource =
    positions.length > 0 &&
    positionUpdatedWithinWindow &&
    rawLiquidityMatchesPool === true &&
    ownerAggregatesMissingPositions === 0
      ? "positions"
      : tickLiquidities.length > 0
        ? "ticks"
        : positions.length > 0
          ? "positions"
          : "empty";

  const ownerSummarySource =
    ownerAggregates.length > 0 ? "ownerAggregates" : ownerPositions.size > 0 ? "positions" : "none";
  const selectedOwnerSource =
    selectedOwnerFromPositions !== null
      ? "positions"
      : selectedOwnerFromOwnerAggregates
        ? "ownerAggregates"
        : "none";
  const eventTimeSeriesSource =
    lpevents.length > 0 ? "events" : authoritativeEmptyWindow ? "zero-fill" : "none";

  return {
    latest,
    counts: {
      positions: positions.length,
      ownerAggregates: ownerAggregates.length,
      lpevents: lpevents.length,
      poolHourDatas: poolHourDatas.length,
      tickLiquidities: tickLiquidities.length,
      lpActivitySeries: lpActivitySeries.length,
      ownerAddressesWithPositions: ownerPositions.size,
      ownerAggregatesMissingPositions,
    },
    selectedOwner,
    coverage: {
      rawLiquidityRatio: roundRatio(rawLiquidityRatio),
      rawLiquidityMatchesPool,
      valueRatio: roundRatio(valueRatio),
      ownerAggregateCoverageRatio: roundRatio(ownerAggregateCoverageRatio),
    },
    freshness: {
      positionUpdatedWithinWindow,
      ownerAggregateUpdatedWithinWindow,
      lpEventsPresentInWindow,
      positionLagSeconds,
      ownerAggregateLagSeconds,
      lpEventLagSeconds,
    },
    currentStateStatus,
    authoritativeEmptyWindow,
    decisions: {
      distributionSource,
      ownerSummarySource,
      eventTimeSeriesSource,
      selectedOwnerSource,
    },
  };
}

export function shouldUseWorldchainTickDistribution(
  meta: WorldchainPoolDataMeta | null | undefined,
): boolean {
  return meta?.decisions?.distributionSource === "ticks";
}

export function shouldForcePerleBscPancakeTickDistribution(poolKey: string): boolean {
  return (
    normalizePoolKey(poolKey) ===
      normalizePoolKey(PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY) &&
    getRailwayIndexerSpace(poolKey) === "bsc"
  );
}

export function shouldUseWorldchainZeroFill(
  meta: WorldchainPoolDataMeta | null | undefined,
): boolean {
  return meta?.decisions?.eventTimeSeriesSource === "zero-fill";
}
