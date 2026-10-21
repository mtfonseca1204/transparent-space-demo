import { GraphQLClient } from 'graphql-request';
import { deduplicatedRequest, buildRequestKey } from './request-dedup';
import { retryGraphQLRequest, graphqlQueue } from './graphql-retry';
import type { WorldchainPoolDataMeta } from './worldchain-pool-data';

// Envio GraphQL endpoint - update this when you deploy your indexer
// For local development, this will be http://localhost:8080/v1/graphql
// For production, use your hosted Envio endpoint
const ENDPOINT_OVERRIDE_STORAGE_KEY = "envio_graphql_endpoint_override";

function resolveEnvioGraphqlEndpoint(): string {
  // Allow quick runtime switching in dev/debug without editing `.env.local`.
  // Usage: set localStorage[ENDPOINT_OVERRIDE_STORAGE_KEY] then reload the page.
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(ENDPOINT_OVERRIDE_STORAGE_KEY);
      if (override && override.trim()) return override.trim();
    } catch {
      // ignore
    }
  }

  return process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT || "http://localhost:8080/v1/graphql";
}

export const ENVIO_GRAPHQL_ENDPOINT = resolveEnvioGraphqlEndpoint();

// Create a base client
const baseClient = new GraphQLClient(ENVIO_GRAPHQL_ENDPOINT, {
  headers: {},
});

// Wrap the client with retry logic
export const envioClient = {
  request: async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
    return graphqlQueue.enqueue(() =>
      retryGraphQLRequest(
        () => baseClient.request<T>(query, variables),
        {
          maxRetries: 3,
          initialDelay: 1000, // Start with 1 second
          maxDelay: 10000, // Max 10 seconds
        }
      )
    );
  },
};

export const ENVIO_GRAPHQL_ENDPOINT_OVERRIDE_STORAGE_KEY = ENDPOINT_OVERRIDE_STORAGE_KEY;

// =============================================================================
// Deduplicated request wrapper
// Prevents duplicate in-flight requests to Envio
// If the same query is made while one is pending, reuses the existing promise
// =============================================================================

/**
 * Execute a GraphQL request with deduplication and retry logic
 * If an identical request is already in-flight, returns the existing promise
 * Retries on 429 rate limit errors with exponential backoff
 * @param query GraphQL query string
 * @param variables Query variables
 * @returns Promise that resolves to the query result
 */
export async function envioRequest<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const key = buildRequestKey(query, variables);
  return deduplicatedRequest(key, () =>
    graphqlQueue.enqueue(() =>
      retryGraphQLRequest(() => envioClient.request<T>(query, variables), {
        maxRetries: 3,
        initialDelay: 1000, // Start with 1 second
        maxDelay: 10000, // Max 10 seconds
      })
    )
  );
}

// GraphQL query fragments
export const CANDLE_FRAGMENT = `
  fragment CandleFields on Candle {
    id
    pool
    interval
    timestamp
    open
    high
    low
    close
    volume0
    volume1
    txCount
  }
`;

export const POSITION_FRAGMENT = `
  fragment PositionFields on Position {
    id
    tokenId
    pool
    owner
    tickLower
    tickUpper
    liquidity
    updatedAt
    fee
    token0
    token1
  }
`;

export const OWNER_POSITION_AGGREGATE_FRAGMENT = `
  fragment OwnerPositionAggregateFields on OwnerPositionAggregate {
    id
    pool
    owner
    liquidityTotal
    updatedAt
  }
`;

export const TICK_LIQUIDITY_FRAGMENT = `
  fragment TickLiquidityFields on TickLiquidity {
    id
    pool
    tick
    liquidityGross
    liquidityNet
    updatedAt
  }
`;

// Query to get candles for a time range
// Note: first is required to avoid default row limits
// 1 week @ 5-min candles = ~2016 rows, so we use 3000 to be safe
export const GET_CANDLES_QUERY = `
  query GetCandles($pool: String!, $interval: Int!, $startTime: Int!, $endTime: Int!) {
    candles(
      where: {
        pool: $pool
        interval: $interval
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      interval
      timestamp
      openPrice
      highPrice
      lowPrice
      closePrice
      volume0
      volume1
      txCount
    }
  }
`;

// Query to get canonical tokenId-level positions for a specific owner (source of truth: NPM NFT owner)
export const GET_POSITIONS_BY_OWNER_QUERY = `
  ${POSITION_FRAGMENT}
  query GetPositionsByOwner($owner: String!, $pool: String!, $limit: Int!) {
    positions(
      where: {
        owner: $owner
        pool: $pool
        liquidity_gt: "0"
      }
      orderBy: liquidity
      orderDirection: desc
      first: $limit
    ) {
      ...PositionFields
    }
  }
`;

// Query to get the current top LP owners for a pool (preferred for "Current LPs")
// Supports pagination with skip for fetching ALL owners
export const GET_OWNER_POSITION_AGGREGATES_QUERY = `
  ${OWNER_POSITION_AGGREGATE_FRAGMENT}
  query GetTopLPs($pool: String!, $limit: Int!, $offset: Int!) {
    ownerPositionAggregates(
      where: { pool: $pool, liquidityTotal_gt: "0" }
      orderBy: liquidityTotal
      orderDirection: desc
      first: $limit
      skip: $offset
    ) {
      ...OwnerPositionAggregateFields
    }
  }
`;

// Query to get tick liquidity for depth calculations (with tick range filter)
export const GET_TICK_LIQUIDITY_QUERY = `
  ${TICK_LIQUIDITY_FRAGMENT}
  query GetTickLiquidity($pool: String!, $minTick: Int!, $maxTick: Int!) {
    tickLiquidities(
      where: {
        pool: $pool
        tick_gte: $minTick
        tick_lte: $maxTick
      }
      orderBy: tick
      orderDirection: asc
    ) {
      ...TickLiquidityFields
    }
  }
`;

// Query to get ALL tick liquidity for a pool (for full liquidity distribution chart)
export const GET_ALL_TICK_LIQUIDITY_QUERY = `
  ${TICK_LIQUIDITY_FRAGMENT}
  query GetAllTickLiquidity($pool: String!) {
    tickLiquidities(
      where: {
        pool: $pool
      }
      orderBy: tick
      orderDirection: asc
    ) {
      ...TickLiquidityFields
    }
  }
`;

// Query to get recent swaps for oracle price approximation
export const GET_RECENT_SWAPS_QUERY = `
  query GetRecentSwaps($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!) {
    uniswapV3PoolSwaps(
      where: {
        pool: $pool
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
    ) {
      id
      pool
      timestamp
      sqrtPriceX96
      liquidity
      tick
    }
  }
`;

// Paged swaps query (cursor-style) to cover long windows without truncation.
// Note: This indexer is pool-specific, so we don't filter by pool - just by timestamp.
export const GET_V3_SWAPS_PAGED_QUERY = `
  query GetV3SwapsPaged($after: Int!, $endTime: Int!, $limit: Int!) {
    uniswapV3PoolSwaps(
      where: {
        timestamp_gt: $after
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
    ) {
      id
      timestamp
      sqrtPriceX96
      liquidity
      tick
      amount0
      amount1
      sender
      recipient
    }
  }
`;

// Same query but descending order - fetches most recent data first
export const GET_V3_SWAPS_RECENT_QUERY = `
  query GetV3SwapsRecent($startTime: Int!, $before: Int!, $limit: Int!) {
    uniswapV3PoolSwaps(
      where: {
        timestamp_gte: $startTime
        timestamp_lt: $before
      }
      orderBy: timestamp
      orderDirection: desc
      first: $limit
    ) {
      id
      timestamp
      sqrtPriceX96
      liquidity
      tick
      amount0
      amount1
      sender
      recipient
    }
  }
`;

export type V3SwapEventData = {
  id: string;
  timestamp: number;
  sqrtPriceX96: string;
  liquidity: string;
  tick: string;
  amount0?: string;
  amount1?: string;
  sender?: string;
  recipient?: string;
};

// Query to get LP events for entry/exit tracking
// Note: first is required to avoid default row limits
// Note: tokenId is not available on LPEvent - we look it up from Position data instead
export const GET_LP_EVENTS_QUERY = `
  query GetLPEvents($pool: String!, $startTime: Int!, $endTime: Int!) {
    lpevents(
      where: {
        pool: $pool
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      owner
      eventType
      timestamp
      liquidityDelta
      amount0
      amount1
      tickLower
      tickUpper
    }
  }
`;

export interface V3PoolMintEventData {
  id: string;
  pool: string;
  timestamp: number;
  transactionHash: string;
  tickLower: string;
  tickUpper: string;
  amount: string; // liquidity (uint128) as string
  amount0: string;
  amount1: string;
  owner?: string; // LP owner address (indexed in Uniswap V3 Mint event)
  sender?: string; // Transaction sender (usually NFT Position Manager)
}

export interface V3PoolBurnEventData {
  id: string;
  pool: string;
  timestamp: number;
  transactionHash: string;
  tickLower: string;
  tickUpper: string;
  amount: string; // liquidity (uint128) as string
  amount0: string;
  amount1: string;
  owner?: string; // LP owner address (indexed in Uniswap V3 Burn event)
}

// Pool-level liquidity deltas (source of truth for TickLiquidity updates on v3).
// NOTE: these events do NOT include transactionHash in our schema.
export const GET_V3_POOL_MINT_BURN_EVENTS_QUERY = `
  query GetV3PoolMintBurn($pool: String!, $startTime: Int!, $endTime: Int!) {
    uniswapV3PoolMints(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lte: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      timestamp
      transactionHash
      tickLower
      tickUpper
      amount
      amount0
      amount1
      owner
      sender
    }

    uniswapV3PoolBurns(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lte: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      timestamp
      transactionHash
      tickLower
      tickUpper
      amount
      amount0
      amount1
      owner
    }
  }
`;

// Query to get pool day data
export const GET_POOL_DAY_DATA_QUERY = `
  query GetPoolDayData($pool: String!, $limit: Int!) {
    poolDayDatas(
      where: { pool: $pool }
      orderBy: date
      orderDirection: desc
      first: $limit
    ) {
      id
      date
      volumeToken0
      volumeToken1
      feesToken0
      feesToken1
      txCount
      openPrice
      highPrice
      lowPrice
      closePrice
      liquidity
    }
  }
`;

// Query to get pre-computed daily LP position snapshots
// This provides historical LP liquidity per position per day
export const GET_POSITION_DAILY_SNAPSHOTS_QUERY = `
  query GetPositionDailySnapshots($pool: String!, $startDate: Int!) {
    positionDailySnapshots(
      where: {
        pool: $pool
        date_gte: $startDate
        liquidity_gt: "0"
      }
      orderBy: date
      orderDirection: asc
    ) {
      id
      date
      owner
      pool
      liquidity
      tickLower
      tickUpper
    }
  }
`;

// Query to get pool hour data
export const GET_POOL_HOUR_DATA_QUERY = `
  query GetPoolHourData($pool: String!, $startTime: Int!) {
    poolHourDatas(
      where: {
        pool: $pool
        periodStartUnix_gte: $startTime
      }
      orderBy: periodStartUnix
      orderDirection: asc
    ) {
      id
      periodStartUnix
      volumeToken0
      volumeToken1
      feesToken0
      feesToken1
      txCount
      openPrice
      highPrice
      lowPrice
      closePrice
      liquidity
    }
  }
`;

// Query to list pools (v3 + v4 live side-by-side)
export const GET_POOLS_QUERY = `
  query ListPools($chainId: Int!, $protocol: String!, $limit: Int!) {
    pools(
      where: {
        chainId: $chainId
        protocol: $protocol
      }
      orderBy: createdAt
      orderDirection: desc
      first: $limit
    ) {
      id
      poolIdentifier
      token0
      token1
      fee
      tickSpacing
      hooks
      createdAt
      updatedAt
      protocol
      chainId
    }
  }
`;

// Query to fetch a single pool by id (poolKey)
export const GET_POOL_BY_ID_QUERY = `
  query GetPoolById($id: String!) {
    pool(id: $id) {
      id
      poolIdentifier
      token0
      token1
      fee
      tickSpacing
      hooks
      createdAt
      updatedAt
      protocol
      chainId
    }
  }
`;

// Latest candle for a pool (used as a proxy for current sqrtPriceX96)
export const GET_LATEST_CANDLE_QUERY = `
  query GetLatestCandle($pool: String!, $interval: Int!) {
    candles(
      where: { pool: $pool, interval: $interval }
      orderBy: timestamp
      orderDirection: desc
      first: 1
    ) {
      timestamp
      closePrice
    }
  }
`;

// Latest PoolHourData row (used as a proxy for current liquidity)
export const GET_LATEST_POOL_HOUR_DATA_QUERY = `
  query GetLatestPoolHourData($pool: String!) {
    poolHourDatas(
      where: { pool: $pool }
      orderBy: periodStartUnix
      orderDirection: desc
      first: 1
    ) {
      periodStartUnix
      liquidity
    }
  }
`;

// Query to get new LP positions count
// Note: The Graph doesn't have _aggregate, so we fetch and count client-side
export const GET_NEW_POSITIONS_COUNT_QUERY = `
  query GetNewPositionsCount($pool: String!, $startTime: Int!, $endTime: Int!) {
    lpevents(
      where: {
        pool: $pool
        eventType: "MINT"
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      first: 1000
    ) {
      id
    }
  }
`;

// =============================================================================
// BATCHED QUERY: Combines multiple queries into a single HTTP request
// This reduces rate limit consumption from 5 requests to 1 request
// Combines: TickLiquidity + PoolHourData + LPEvent + UniswapV3Pool_Mint/Burn
// =============================================================================
export const GET_BATCHED_POOL_DATA_QUERY = `
  query BatchedPoolData(
    $pool: String!
    $startTime: Int!
    $endTime: Int!
    $minTick: Int!
    $maxTick: Int!
  ) {
    # Tick liquidity for depth calculations
    tickLiquidities(
      where: {
        pool: $pool
        tick_gte: $minTick
        tick_lte: $maxTick
      }
      orderBy: tick
      orderDirection: asc
    ) {
      id
      pool
      tick
      liquidityGross
      liquidityNet
      updatedAt
    }

    # Pool hour data for historical liquidity
    poolHourDatas(
      where: {
        pool: $pool
        periodStartUnix_gte: $startTime
      }
      orderBy: periodStartUnix
      orderDirection: asc
    ) {
      id
      periodStartUnix
      volumeToken0
      volumeToken1
      feesToken0
      feesToken1
      txCount
      openPrice
      highPrice
      lowPrice
      closePrice
      liquidity
    }

    # LP events for entry/exit tracking
    lpevents(
      where: {
        pool: $pool
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      owner
      eventType
      timestamp
      liquidityDelta
      amount0
      amount1
      tickLower
      tickUpper
    }

    # Pool-level Mint events (source of truth for TickLiquidity updates)
    uniswapV3PoolMints(
      where: {
        pool: $pool
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      timestamp
      transactionHash
      tickLower
      tickUpper
      amount
      amount0
      amount1
      owner
      sender
    }

    # Pool-level Burn events
    uniswapV3PoolBurns(
      where: {
        pool: $pool
        timestamp_gte: $startTime
        timestamp_lte: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      timestamp
      transactionHash
      tickLower
      tickUpper
      amount
      amount0
      amount1
      owner
    }
  }
`;

// TypeScript interface for batched query response
export interface BatchedPoolDataResponse {
  tickLiquidities: TickLiquidityData[];
  poolHourDatas: PoolHourData[];
  lpevents: LPEventData[];
  uniswapV3PoolMints: V3PoolMintEventData[];
  uniswapV3PoolBurns: V3PoolBurnEventData[];
  // Positions are fetched atomically with events to prevent race conditions
  positions?: PositionData[];
  ownerAggregates?: OwnerPositionAggregateData[];
  meta?: WorldchainPoolDataMeta | null;
  lpActivitySeries?: Array<{
    timestamp: number;
    depth_band_buy?: number;
    depth_band_sell?: number;
  }>;
}

// Helper function to convert sqrtPriceX96 to actual price
export function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number = 18, decimals1: number = 6): number {
  // Avoid BigInt literals to support TS targets < ES2020 (while still using bigint values)
  const Q96 = BigInt(2) ** BigInt(96);
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const price = sqrtPrice * sqrtPrice;
  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  return price * decimalAdjustment;
}

// Helper function to convert tick to price
export function tickToPrice(
  tick: number,
  decimals0: number = 0,
  decimals1: number = 0
): number {
  // By default, keep backwards-compatible behavior: return raw tick price (token1/token0)
  // without any token-decimal adjustment.
  //
  // When decimals are provided (e.g. pool token0/token1 decimals), we apply:
  // adjustedPrice = rawPrice * 10^(decimals0 - decimals1)
  const priceRaw = Math.pow(1.0001, tick);
  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  return priceRaw * decimalAdjustment;
}

// Helper function to convert price to tick
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

// Type definitions for query results
export interface CandleData {
  id: string;
  pool: string;
  interval: number;
  timestamp: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume0: string;
  volume1: string;
  txCount: number;
}

export interface PositionData {
  id: string; // ${chainId}-${tokenId}
  tokenId: string;
  pool: string; // lowercased
  owner: string; // lowercased
  tickLower: number;
  tickUpper: number;
  liquidity: string; // BigInt as string
  updatedAt: number;
  fee?: string | null;
  token0?: string | null;
  token1?: string | null;
}

export interface OwnerPositionAggregateData {
  id: string; // ${chainId}-${pool}-${owner}
  pool: string; // lowercased
  owner: string; // lowercased
  liquidityTotal: string; // BigInt as string
  updatedAt: number;
}

export interface TickLiquidityData {
  id: string;
  pool: string;
  tick: number;
  liquidityGross: string;
  liquidityNet: string;
  updatedAt: number;
}

export interface SwapData {
  id: string;
  timestamp: number;
  sqrtPriceX96: string;
  tick: string;
}

export interface LPEventData {
  id: string;
  owner: string;
  eventType: "MINT" | "BURN" | "INCREASE" | "DECREASE";
  timestamp: number;
  liquidityDelta: string;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
}

export interface PoolDayData {
  id: string;
  date: number;
  volumeToken0: string;
  volumeToken1: string;
  feesToken0: string;
  feesToken1: string;
  txCount: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  liquidity: string;
}

export interface PoolHourData {
  id: string;
  periodStartUnix: number;
  volumeToken0: string;
  volumeToken1: string;
  feesToken0: string;
  feesToken1: string;
  txCount: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  liquidity: string;
}

// =============================================================================
// NEW PRE-COMPUTED ENTITIES (PoolCandle, PoolDailyVolumeBySize, PositionDailySnapshot)
// These replace expensive client-side aggregations with indexer-side pre-computation
// =============================================================================

// PoolCandle - Multi-interval OHLC candles (5m, 15m, 1h, 4h, 1d)
export const GET_POOL_CANDLES_QUERY = `
  query GetPoolCandles($pool: String!, $interval: String!, $since: Int!) {
    poolCandles(
      where: {
        pool: $pool
        interval: $interval
        timestamp_gte: $since
      }
      orderBy: timestamp
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      interval
      timestamp
      sqrtPriceX96Open
      sqrtPriceX96Close
      sqrtPriceX96High
      sqrtPriceX96Low
      tickOpen
      tickClose
      liquidityClose
      volumeToken0
      volumeToken1
      feesToken0
      feesToken1
      swapCount
    }
  }
`;

export interface PoolCandleData {
  id: string;
  pool: string;
  interval: string; // "5m", "15m", "1h", "4h", "1d"
  timestamp: number;
  sqrtPriceX96Open: string;
  sqrtPriceX96Close: string;
  sqrtPriceX96High: string;
  sqrtPriceX96Low: string;
  tickOpen: number;
  tickClose: number;
  liquidityClose: string;
  volumeToken0: string;
  volumeToken1: string;
  feesToken0: string;
  feesToken1: string;
  swapCount: number;
}

// PoolDailyVolumeBySize - Pre-aggregated trading volume by size bucket
export const GET_POOL_DAILY_VOLUME_BY_SIZE_QUERY = `
  query GetPoolDailyVolumeBySize($pool: String!, $since: Int!) {
    poolDailyVolumeBySizes(
      where: {
        pool: $pool
        date_gte: $since
      }
      orderBy: date
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      date
      sizeBucket
      volumeToken0
      volumeToken1
      swapCount
    }
  }
`;

export interface PoolDailyVolumeBySizeData {
  id: string;
  pool: string;
  date: number;
  sizeBucket: string; // "below_100", "100_1k", "1k_5k", etc.
  volumeToken0: string;
  volumeToken1: string;
  swapCount: number;
}

// Size bucket definitions (must match indexer)
export const SIZE_BUCKET_ORDER = [
  "below_100",
  "100_1k",
  "1k_5k",
  "5k_10k",
  "10k_25k",
  "25k_50k",
  "50k_100k",
  "100k_250k",
  "250k_500k",
  "500k_1m",
  "1m_plus",
] as const;

export type SizeBucketId = typeof SIZE_BUCKET_ORDER[number];

export interface PositionDailySnapshotData {
  id: string;
  pool: string;
  tokenId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  date: number;
}
