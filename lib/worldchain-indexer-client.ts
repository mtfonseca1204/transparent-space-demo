/**
 * REST client for the Worldchain pool indexer.
 * Browser requests go through /api/worldchain-entities to avoid CORS.
 * Server-side requests go directly to Railway.
 */

import type {
  PoolCandleData,
  PoolDayData,
  PoolHourData,
  PositionData,
  TickLiquidityData,
} from "./envio-client";
import { isEvmV2Protocol, isReserveBackedIndexedPool } from "./evm-v2-pool-support";
import { SUPPORTED_POOLS, isV4PoolKey, normalizePoolKey } from "./pools";

const WORLDCHAIN_INDEXER_BASE =
  process.env.WORLDCHAIN_INDEXER_API_URL ??
  "https://indexer-worldchain-production.up.railway.app";

const GENSYN_INDEXER_BASE =
  process.env.GENSYN_INDEXER_API_URL ??
  "https://indexer-gensyn-api-production.up.railway.app";

const BSC_INDEXER_BASE =
  process.env.BSC_INDEXER_API_URL ??
  process.env.PERLE_BSC_INDEXER_API_URL ??
  "https://indexer-bsc-api-production.up.railway.app";

const KATANA_INDEXER_BASE =
  process.env.KATANA_INDEXER_API_URL ??
  "https://indexer-katana-api-production.up.railway.app";

const MONAD_INDEXER_BASE =
  process.env.MONAD_INDEXER_API_URL ??
  "https://indexer-monad-api-production.up.railway.app";

const ZEROG_INDEXER_BASE =
  process.env.ZEROG_INDEXER_API_URL ??
  "https://indexer-zerog-api-production.up.railway.app";

export type RailwayIndexerSpace =
  | "worldchain"
  | "gensyn"
  | "bsc"
  | "katana"
  | "monad"
  | "zerog";

const DEFAULT_RAILWAY_INDEXER_SPACE: RailwayIndexerSpace = "worldchain";
const RAILWAY_INDEXER_BASE_BY_SPACE: Record<RailwayIndexerSpace, string> = {
  worldchain: WORLDCHAIN_INDEXER_BASE,
  gensyn: GENSYN_INDEXER_BASE,
  bsc: BSC_INDEXER_BASE,
  katana: KATANA_INDEXER_BASE,
  monad: MONAD_INDEXER_BASE,
  zerog: ZEROG_INDEXER_BASE,
};

function isRailwayIndexerSpace(spaceSlug: string): spaceSlug is RailwayIndexerSpace {
  return (
    spaceSlug === "worldchain" ||
    spaceSlug === "gensyn" ||
    spaceSlug === "bsc" ||
    spaceSlug === "katana" ||
    spaceSlug === "monad" ||
    spaceSlug === "zerog"
  );
}

function getRailwayIndexerSpaceForPool(
  pool: (typeof SUPPORTED_POOLS)[number],
): RailwayIndexerSpace | null {
  if (pool.chain === "solana") return null;
  if (pool.chainId === 56) return "bsc";
  if (pool.chainId === 747474) return "katana";
  if (pool.chainId === 16661) return "zerog";
  if (isRailwayIndexerSpace(pool.spaceSlug)) return pool.spaceSlug;
  return null;
}

const RAILWAY_INDEXER_POOL_SPACE_BY_KEY = new Map<string, RailwayIndexerSpace>(
  SUPPORTED_POOLS.flatMap((pool): Array<[string, RailwayIndexerSpace]> => {
    const indexerSpace = getRailwayIndexerSpaceForPool(pool);
    if (!indexerSpace) return [];
    return [[normalizePoolKey(pool.poolKey), indexerSpace]];
  }),
);

const RAILWAY_INDEXER_POOL_PROTOCOL_BY_KEY = new Map(
  SUPPORTED_POOLS.flatMap((pool): Array<[string, (typeof SUPPORTED_POOLS)[number]["protocol"]]> => {
    const indexerSpace = getRailwayIndexerSpaceForPool(pool);
    if (!indexerSpace) return [];
    return [[normalizePoolKey(pool.poolKey), pool.protocol]];
  }),
);

const RAILWAY_INDEXER_POOL_KEYS = Array.from(RAILWAY_INDEXER_POOL_SPACE_BY_KEY.keys());
const RAILWAY_INDEXER_POOLS = new Set(RAILWAY_INDEXER_POOL_KEYS);
const RAILWAY_INDEXER_V3_POOLS = new Set(
  RAILWAY_INDEXER_POOL_KEYS.filter((poolKey) => RAILWAY_INDEXER_POOL_PROTOCOL_BY_KEY.get(poolKey) === "v3"),
);
const RAILWAY_INDEXER_V2_POOLS = new Set(
  RAILWAY_INDEXER_POOL_KEYS.filter((poolKey) => isEvmV2Protocol(RAILWAY_INDEXER_POOL_PROTOCOL_BY_KEY.get(poolKey))),
);
const RAILWAY_INDEXER_V4_POOLS = new Set(
  RAILWAY_INDEXER_POOL_KEYS.filter((poolKey) => isV4PoolKey(poolKey)),
);

export function getRailwayIndexerSpace(poolKey: string): RailwayIndexerSpace | null {
  return RAILWAY_INDEXER_POOL_SPACE_BY_KEY.get(normalizePoolKey(poolKey)) ?? null;
}

export function getRailwayIndexerProtocol(poolKey: string): "v2" | "v3" | "v4" | null {
  const protocol = RAILWAY_INDEXER_POOL_PROTOCOL_BY_KEY.get(normalizePoolKey(poolKey));
  if (isEvmV2Protocol(protocol) || protocol === "v3" || protocol === "v4") return protocol;
  return null;
}

export function usesRailwayIndexedSnapshot(poolKey: string): boolean {
  const protocol = getRailwayIndexerProtocol(poolKey);
  return isReserveBackedIndexedPool(protocol) || protocol === "v4";
}

export function isWorldchainIndexerPool(poolKey: string): boolean {
  return RAILWAY_INDEXER_POOLS.has(normalizePoolKey(poolKey));
}

export function isWorldchainIndexerV3Pool(poolKey: string): boolean {
  return RAILWAY_INDEXER_V3_POOLS.has(normalizePoolKey(poolKey));
}

export function isWorldchainIndexerV2Pool(poolKey: string): boolean {
  return RAILWAY_INDEXER_V2_POOLS.has(normalizePoolKey(poolKey));
}

export function isWorldchainIndexerV4Pool(poolKey: string): boolean {
  return RAILWAY_INDEXER_V4_POOLS.has(normalizePoolKey(poolKey));
}

/**
 * Kept for compatibility with older call sites that treat the REST indexer as
 * a special-case v3 path.
 */
export function isRailwayTrackedPool(poolKey: string): boolean {
  return isWorldchainIndexerV3Pool(poolKey);
}

const isBrowser = typeof window !== "undefined";

interface RailwayEntityResponse<T> {
  entity: string;
  data: T[];
  pagination: { limit: number; offset: number; returned: number };
}

function getRailwayIndexerSpaceForParams(
  params: Record<string, string | number>,
): RailwayIndexerSpace {
  const explicitSpace = params.space;
  if (typeof explicitSpace === "string" && isRailwayIndexerSpace(explicitSpace)) {
    return explicitSpace;
  }
  const pool = params.pool;
  if (typeof pool === "string" || typeof pool === "number") {
    return getRailwayIndexerSpace(String(pool)) ?? DEFAULT_RAILWAY_INDEXER_SPACE;
  }
  const chainId = Number(params.chainId);
  if (chainId === 1) return "gensyn";
  if (chainId === 56) return "bsc";
  if (chainId === 143) return "monad";
  if (chainId === 16661) return "zerog";
  if (chainId === 747474) return "katana";
  return DEFAULT_RAILWAY_INDEXER_SPACE;
}

export async function fetchRailwayEntity<T>(
  entity: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const space = getRailwayIndexerSpaceForParams(params);
  let url: URL;
  if (isBrowser) {
    // Browser: proxy through Next.js API route to avoid CORS
    url = new URL("/api/worldchain-entities", window.location.origin);
    url.searchParams.set("entity", entity);
    url.searchParams.set("space", space);
  } else {
    // Server: call Railway directly
    url = new URL(`/api/entities/${entity}`, RAILWAY_INDEXER_BASE_BY_SPACE[space]);
  }
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`Worldchain indexer ${entity}: HTTP ${res.status}`);
      }
      const json = (await res.json()) as RailwayEntityResponse<T>;
      return json.data ?? [];
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Paginated fetch for Railway entities.
 * The Railway API caps at 2000 rows per page, so for entities that may have
 * more rows in the time range (e.g. PoolHourData for 1 year = 8760 rows),
 * we need to paginate.
 */
export async function fetchRailwayEntityPaginated<T>(
  entity: string,
  params: Record<string, string | number>,
  maxPages = 10,
): Promise<T[]> {
  const PAGE_SIZE = 2000;
  const all: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchRailwayEntity<T>(entity, {
      ...params,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return all;
}

interface RailwayTickRow {
  id: string;
  pool: string;
  protocol: string;
  tick: number;
  liquidityGross: string;
  liquidityNet: string;
  updatedAt: number;
}

interface RailwayPositionRow {
  id: string;
  tokenId: string;
  pool: string;
  protocol: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  updatedAt: number;
  fee: number;
  token0: string;
  token1: string;
  hooks: string | null;
}

interface WorldchainLPPositionRow {
  id: string;
  pool: string;
  protocol: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorldchainOwnerAggregateRow {
  id: string;
  pool: string;
  protocol: string;
  owner: string;
  liquidityTotal: string;
  updatedAt: number;
}

interface RailwayPoolCandleRow {
  id: string;
  pool: string;
  interval: string;
  timestamp: number;
  sqrtPriceX96Open: string;
  sqrtPriceX96Close: string;
  sqrtPriceX96High: string;
  sqrtPriceX96Low: string;
  volumeToken0: string;
  volumeToken1: string;
  swapCount: number;
}

export interface WorldchainPoolRow {
  id: string;
  chainId: number;
  protocol: "v2" | "v3" | "v4";
  poolIdentifier: string;
  poolManagerAddress: string | null;
  hooks: string | null;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  liquidity: string;
  tvlToken0?: string | null;
  tvlToken1?: string | null;
  sqrtPriceX96: string;
  tick: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorldchainPoolDailyVolumeBySizeRow {
  id: string;
  pool: string;
  protocol: string;
  chainId: number;
  date: number;
  sizeBucket: string;
  volumeToken0: string;
  volumeToken1: string;
  swapCount: number;
  updatedAt: number;
}

/**
 * Fetch PoolCandle data for a Railway-tracked pool.
 *
 * The API returns all intervals mixed together in descending order, so we
 * paginate and filter interval/time client-side.
 *
 * With 10k rows/page, 1 year of 5 timeframes is still manageable with bounded
 * pagination.
 */
export async function fetchWorldchainCandles(
  poolKey: string,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<RailwayPoolCandleRow[]> {
  const PAGE_SIZE = 10000;
  const MAX_PAGES = 20; // 20 pages × 10k × ~24 days/page ≈ 480 days max
  const pool = normalizePoolKey(poolKey);
  const matched: RailwayPoolCandleRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchRailwayEntity<RailwayPoolCandleRow>("PoolCandle", {
      pool,
      from: startTime,
      to: endTime,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.interval === interval && row.timestamp >= startTime && row.timestamp < endTime) {
        matched.push(row);
      }
    }

    // Stop once the oldest row in this page is before our startTime
    const oldestTs = rows[rows.length - 1]?.timestamp ?? 0;
    if (oldestTs < startTime) break;

    // Stop if we got fewer rows than page size (end of data)
    if (rows.length < PAGE_SIZE) break;
  }

  // Sort ascending by timestamp
  matched.sort((a, b) => a.timestamp - b.timestamp);
  return matched;
}

export async function fetchRailwayCandles(
  poolKey: string,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<RailwayPoolCandleRow[]> {
  return fetchWorldchainCandles(poolKey, interval, startTime, endTime);
}

/** Fetch all tick liquidity for a pool from the Worldchain indexer. */
export async function fetchWorldchainTickLiquidity(
  poolKey: string,
): Promise<TickLiquidityData[]> {
  if (isWorldchainIndexerV2Pool(poolKey)) return [];
  const rows = await fetchRailwayEntity<RailwayTickRow>("TickLiquidity", {
    pool: normalizePoolKey(poolKey),
    limit: 10000,
  });
  return rows
    .map((r) => ({
      id: r.id,
      pool: normalizePoolKey(poolKey),
      tick: r.tick,
      liquidityGross: r.liquidityGross,
      liquidityNet: r.liquidityNet,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => a.tick - b.tick);
}

export async function fetchRailwayTickLiquidity(
  poolKey: string,
): Promise<TickLiquidityData[]> {
  return fetchWorldchainTickLiquidity(poolKey);
}

function mapV3PositionRow(poolKey: string, row: RailwayPositionRow): PositionData {
  return {
    id: row.id,
    tokenId: row.tokenId,
    pool: normalizePoolKey(poolKey),
    owner: row.owner.toLowerCase(),
    tickLower: row.tickLower,
    tickUpper: row.tickUpper,
    liquidity: row.liquidity,
    updatedAt: row.updatedAt,
    fee: String(row.fee),
    token0: row.token0,
    token1: row.token1,
  };
}

function mapV4PositionRow(poolKey: string, row: WorldchainLPPositionRow): PositionData {
  return {
    id: row.id,
    tokenId: row.id,
    pool: normalizePoolKey(poolKey),
    owner: row.owner.toLowerCase(),
    tickLower: row.tickLower,
    tickUpper: row.tickUpper,
    liquidity: row.liquidity,
    updatedAt: row.updatedAt,
    fee: null,
    token0: null,
    token1: null,
  };
}

async function fetchWorldchainV3Positions(
  poolKey: string,
): Promise<PositionData[]> {
  const rows = await fetchRailwayEntityPaginated<RailwayPositionRow>("Position", {
    pool: normalizePoolKey(poolKey),
    active: "true",
  });
  return rows.map((row) => mapV3PositionRow(poolKey, row));
}

async function fetchWorldchainV4Positions(
  poolKey: string,
): Promise<PositionData[]> {
  const rows = await fetchRailwayEntityPaginated<WorldchainLPPositionRow>("LPPosition", {
    pool: normalizePoolKey(poolKey),
    active: "true",
  });
  return rows.map((row) => mapV4PositionRow(poolKey, row));
}

/** Fetch all active positions (liquidity > 0) for a pool from the Worldchain indexer. */
export async function fetchWorldchainPositions(
  poolKey: string,
): Promise<PositionData[]> {
  if (isWorldchainIndexerV2Pool(poolKey)) return [];
  if (isWorldchainIndexerV4Pool(poolKey)) {
    return fetchWorldchainV4Positions(poolKey);
  }
  return fetchWorldchainV3Positions(poolKey);
}

export async function fetchRailwayPositions(
  poolKey: string,
): Promise<PositionData[]> {
  return fetchWorldchainPositions(poolKey);
}

export async function fetchWorldchainPositionsByOwner(
  poolKey: string,
  owner: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<PositionData[]> {
  const ownerLc = owner.toLowerCase();
  const positions = await fetchWorldchainPositions(poolKey);
  return positions.filter((position) => position.owner.toLowerCase() === ownerLc).slice(0, limit);
}

export async function fetchWorldchainOwnerAggregates(
  poolKey: string,
  maxPages = 10,
): Promise<WorldchainOwnerAggregateRow[]> {
  if (isWorldchainIndexerV2Pool(poolKey)) return [];
  const rows = await fetchRailwayEntityPaginated<WorldchainOwnerAggregateRow>(
    "OwnerPositionAggregate",
    { pool: normalizePoolKey(poolKey), active: "true" },
    maxPages,
  );
  return rows.sort((a, b) => {
    const la = BigInt(a.liquidityTotal);
    const lb = BigInt(b.liquidityTotal);
    return la > lb ? -1 : la < lb ? 1 : 0;
  });
}

export async function fetchWorldchainPoolById(
  poolKey: string,
): Promise<WorldchainPoolRow | null> {
  const rows = await fetchRailwayEntity<WorldchainPoolRow>("Pool", {
    pool: normalizePoolKey(poolKey),
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function fetchWorldchainPools(args?: {
  chainId?: number;
  protocol?: "v2" | "v3" | "v4";
  limit?: number;
}): Promise<WorldchainPoolRow[]> {
  const rows = await fetchRailwayEntityPaginated<WorldchainPoolRow>(
    "Pool",
    {},
    3,
  );

  const chainId = args?.chainId;
  const protocol = args?.protocol;
  const limit = args?.limit ?? rows.length;

  return rows
    .filter((row) => (chainId == null ? true : row.chainId === chainId))
    .filter((row) => (protocol == null ? true : row.protocol === protocol))
    .slice(0, limit);
}

export async function fetchWorldchainLatestPoolHour(
  poolKey: string,
): Promise<PoolHourData | null> {
  const rows = await fetchRailwayEntity<PoolHourData>("PoolHourData", {
    pool: normalizePoolKey(poolKey),
    limit: 1,
  });
  return rows[0] ?? null;
}

export async function fetchWorldchainLatestPoolCandle(
  poolKey: string,
  interval: string,
): Promise<PoolCandleData | null> {
  const rows = await fetchRailwayEntity<RailwayPoolCandleRow>("PoolCandle", {
    pool: normalizePoolKey(poolKey),
    limit: 500,
  });
  const match = rows.find((row) => row.interval === interval);
  if (!match) return null;

  return {
    ...match,
    tickOpen: 0,
    tickClose: 0,
    liquidityClose: "0",
    feesToken0: "0",
    feesToken1: "0",
  };
}

export async function fetchWorldchainPoolDayData(
  poolKey: string,
  startTime: number,
): Promise<PoolDayData[]> {
  const rows = await fetchRailwayEntityPaginated<PoolDayData>(
    "PoolDayData",
    {
      pool: normalizePoolKey(poolKey),
      from: startTime,
    },
    2,
  );
  return rows.sort((a, b) => a.date - b.date);
}

export async function fetchWorldchainPoolHourData(
  poolKey: string,
  startTime: number,
  endTime?: number,
): Promise<PoolHourData[]> {
  const rows = await fetchRailwayEntityPaginated<PoolHourData>(
    "PoolHourData",
    {
      pool: normalizePoolKey(poolKey),
      from: startTime,
      ...(endTime == null ? {} : { to: endTime }),
    },
    6,
  );
  return rows.sort((a, b) => a.periodStartUnix - b.periodStartUnix);
}

export async function fetchWorldchainPoolDailyVolumeBySize(
  poolKey: string,
  startTime: number,
): Promise<WorldchainPoolDailyVolumeBySizeRow[]> {
  const rows = await fetchRailwayEntityPaginated<WorldchainPoolDailyVolumeBySizeRow>(
    "PoolDailyVolumeBySize",
    {
      pool: normalizePoolKey(poolKey),
      from: startTime,
    },
    2,
  );
  return rows.sort((a, b) => a.date - b.date);
}
