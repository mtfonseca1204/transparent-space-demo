import { NextRequest, NextResponse } from "next/server";
import { GraphQLClient } from "graphql-request";
import { isAddress } from "viem";
import { isSolanaPool } from "@/lib/pools";
import { fetchSolanaApi } from "@/lib/solana-indexer-client";
import { retryGraphQLRequest } from "@/lib/graphql-retry";
import {
  fetchWorldchainPoolDailyVolumeBySize,
  isWorldchainIndexerPool,
} from "@/lib/worldchain-indexer-client";
import { getDemoTradingVolumeBySize, isDemoRequest } from "@/lib/demo/fixtures";

type V3SwapEventData = {
  id: string;
  pool?: string;
  timestamp: number;
  sqrtPriceX96: string;
  liquidity: string;
  tick: string;
  amount0?: string;
  amount1?: string;
  sender?: string;
  recipient?: string;
};

type V4SwapEventData = {
  id: string;
  pool: string;
  timestamp: number;
  sqrtPriceX96: string;
  liquidity: string;
  tick: string;
  fee: string;
  amount0?: string;
  amount1?: string;
  sender?: string;
  transactionHash?: string;
};

type SwapAggRow = {
  id: string;
  pool?: string;
  timestamp: number;
  amount0?: string;
  amount1?: string;
};

type BucketId =
  | "below_100"
  | "100_1k"
  | "1k_5k"
  | "5k_10k"
  | "10k_25k"
  | "25k_50k"
  | "50k_100k"
  | "100k_250k"
  | "250k_500k"
  | "500k_1m"
  | "1m_plus";

type DailyBucketData = {
  date: string; // ISO date string (UTC midnight)
  dateKey: string;
  buckets: Record<BucketId, number>;
  total: number;
};

const SIZE_BUCKETS: Array<{ id: BucketId; min: number; max: number }> = [
  { id: "below_100", min: 0, max: 100 },
  { id: "100_1k", min: 100, max: 1000 },
  { id: "1k_5k", min: 1000, max: 5000 },
  { id: "5k_10k", min: 5000, max: 10000 },
  { id: "10k_25k", min: 10000, max: 25000 },
  { id: "25k_50k", min: 25000, max: 50000 },
  { id: "50k_100k", min: 50000, max: 100000 },
  { id: "100k_250k", min: 100000, max: 250000 },
  { id: "250k_500k", min: 250000, max: 500000 },
  { id: "500k_1m", min: 500000, max: 1000000 },
  { id: "1m_plus", min: 1000000, max: Infinity },
];

const STABLE_USD_BAND = 0.03;

const AGGREGATE_CACHE_TTL_MS = 60_000;
const aggregateCache = new Map<string, { timestamp: number; payload: { dailyData: DailyBucketData[] } }>();

function formatDateKeyUtc(tsSec: number): { dateKey: string; date: Date } {
  const d = new Date(tsSec * 1000);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth() + 1;
  const day = utc.getUTCDate();
  const key = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { dateKey: key, date: utc };
}

function initBuckets(): Record<BucketId, number> {
  return Object.fromEntries(SIZE_BUCKETS.map((b) => [b.id, 0])) as Record<BucketId, number>;
}

function parseNumberParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toCachePart(n: number | null): string {
  if (n === null) return "null";
  return n.toFixed(4);
}

// Query with pool filter in WHERE clause (preferred)
const GET_V3_SWAPS_BY_POOL_QUERY = `
  query GetV3SwapsByPool($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolSwaps(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      pool
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

const GET_V3_SWAPS_BY_POOL_AGG_QUERY = `
  query GetV3SwapsByPoolAgg($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolSwaps(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      timestamp
      amount0
      amount1
    }
  }
`;

// Cursor pagination for pool-filtered swaps (avoids reliance on offset support)
// Note: The Graph doesn't support complex _or conditions, so we use timestamp_gt for cursor pagination
const GET_V3_SWAPS_BY_POOL_CURSOR_QUERY = `
  query GetV3SwapsByPoolCursor($pool: String!, $startTime: Int!, $endTime: Int!, $lastTs: Int!, $lastId: String!, $limit: Int!) {
    uniswapV3PoolSwaps(
      where: {
        pool: $pool
        timestamp_gt: $lastTs
        timestamp_lt: $endTime
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
      amount0
      amount1
      sender
      recipient
    }
  }
`;

const GET_V3_SWAPS_BY_POOL_CURSOR_AGG_QUERY = `
  query GetV3SwapsByPoolCursorAgg($pool: String!, $startTime: Int!, $endTime: Int!, $lastTs: Int!, $lastId: String!, $limit: Int!) {
    uniswapV3PoolSwaps(
      where: {
        pool: $pool
        timestamp_gt: $lastTs
        timestamp_lt: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
    ) {
      id
      timestamp
      amount0
      amount1
    }
  }
`;

const GET_V4_SWAPS_BY_POOL_QUERY = `
  query GetV4SwapsByPool($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV4PoolSwaps(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      pool
      timestamp
      sqrtPriceX96
      liquidity
      tick
      fee
      amount0
      amount1
      sender
      transactionHash
    }
  }
`;

const GET_V4_SWAPS_BY_POOL_AGG_QUERY = `
  query GetV4SwapsByPoolAgg($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV4PoolSwaps(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      timestamp
      amount0
      amount1
    }
  }
`;

const GET_V4_SWAPS_BY_POOL_CURSOR_QUERY = `
  query GetV4SwapsByPoolCursor($pool: String!, $startTime: Int!, $endTime: Int!, $lastTs: Int!, $lastId: String!, $limit: Int!) {
    uniswapV4PoolSwaps(
      where: {
        pool: $pool
        timestamp_gt: $lastTs
        timestamp_lt: $endTime
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
      fee
      amount0
      amount1
      sender
      transactionHash
    }
  }
`;

const GET_V4_SWAPS_BY_POOL_CURSOR_AGG_QUERY = `
  query GetV4SwapsByPoolCursorAgg($pool: String!, $startTime: Int!, $endTime: Int!, $lastTs: Int!, $lastId: String!, $limit: Int!) {
    uniswapV4PoolSwaps(
      where: {
        pool: $pool
        timestamp_gt: $lastTs
        timestamp_lt: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
    ) {
      id
      timestamp
      amount0
      amount1
    }
  }
`;

// Fallback: no pool filter (for indexers that don't support it)
const GET_V3_SWAPS_NO_POOL_FILTER_QUERY = `
  query GetV3SwapsNoPoolFilter($startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolSwaps(
      where: { timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      pool
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

const GET_V3_SWAPS_NO_POOL_FILTER_AGG_QUERY = `
  query GetV3SwapsNoPoolFilterAgg($startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolSwaps(
      where: { timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      pool
      timestamp
      amount0
      amount1
    }
  }
`;

const GET_V3_SWAPS_MINIMAL_QUERY = `
  query GetV3SwapsMinimal($startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolSwaps(
      where: { timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
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

const GET_V4_SWAPS_NO_POOL_FILTER_QUERY = `
  query GetV4SwapsNoPoolFilter($startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV4PoolSwaps(
      where: { timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      pool
      timestamp
      sqrtPriceX96
      liquidity
      tick
      fee
      amount0
      amount1
      sender
      transactionHash
    }
  }
`;

const GET_V4_SWAPS_NO_POOL_FILTER_AGG_QUERY = `
  query GetV4SwapsNoPoolFilterAgg($startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV4PoolSwaps(
      where: { timestamp_gte: $startTime, timestamp_lt: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
    ) {
      id
      pool
      timestamp
      amount0
      amount1
    }
  }
`;

function resolveServerEnvioGraphqlEndpoint(): string {
  return (
    process.env.ENVIO_GRAPHQL_ENDPOINT ||
    process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT ||
    "http://localhost:8080/v1/graphql"
  );
}

function parseDays(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 7;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function isV4PoolKey(poolKey: string): boolean {
  return /^\d+-v4-0x[0-9a-f]{64}$/.test(poolKey.toLowerCase());
}

type QueryMode = "pool-where" | "pool-field" | "minimal";

interface FetchChunkResult {
  rows: Array<V3SwapEventData | V4SwapEventData>;
  newMode: QueryMode;
  truncated: boolean;
}

interface TimeChunk {
  startTime: number;
  endTime: number;
}

// Split time range into parallel chunks (1 day each for optimal parallelism)
function createTimeChunks(startTime: number, endTime: number, chunkSizeSeconds: number = 86400): TimeChunk[] {
  const chunks: TimeChunk[] = [];
  let current = startTime;
  
  while (current < endTime) {
    const chunkEnd = Math.min(current + chunkSizeSeconds, endTime);
    chunks.push({ startTime: current, endTime: chunkEnd });
    current = chunkEnd;
  }
  
  return chunks;
}

// Fetch swaps for a single time chunk with automatic fallback
async function fetchChunkPage(
  client: GraphQLClient,
  chunk: TimeChunk,
  poolAddress: string,
  isV3: boolean,
  queryMode: QueryMode,
  pageLimit: number,
  offset: number,
  selectMode: "full" | "aggregate"
): Promise<{ rows: Array<V3SwapEventData | V4SwapEventData | SwapAggRow>; newMode: QueryMode; rawCount: number }> {
  const { startTime, endTime } = chunk;
  
  // Try pool-filtered query first
  if (queryMode === "pool-where") {
    try {
      if (isV3) {
        const query =
          selectMode === "aggregate" ? GET_V3_SWAPS_BY_POOL_AGG_QUERY : GET_V3_SWAPS_BY_POOL_QUERY;
        const response = await client.request<{ uniswapV3PoolSwaps: Array<V3SwapEventData | SwapAggRow> }>(
          query,
          { pool: poolAddress, startTime, endTime, limit: pageLimit, offset }
        );
        const rows = response.uniswapV3PoolSwaps ?? [];
        return { rows, newMode: "pool-where", rawCount: rows.length };
      } else {
        const query =
          selectMode === "aggregate" ? GET_V4_SWAPS_BY_POOL_AGG_QUERY : GET_V4_SWAPS_BY_POOL_QUERY;
        const response = await client.request<{ uniswapV4PoolSwaps: Array<V4SwapEventData | SwapAggRow> }>(
          query,
          { pool: poolAddress, startTime, endTime, limit: pageLimit, offset }
        );
        const rows = response.uniswapV4PoolSwaps ?? [];
        return { rows, newMode: "pool-where", rawCount: rows.length };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("pool") && (message.includes("not found") || message.includes("args.where"))) {
        // Fall through to try pool-field mode
        queryMode = "pool-field";
      } else {
        throw err;
      }
    }
  }
  
  // Try fetching with pool in selection (filter in JS)
  if (queryMode === "pool-field") {
    try {
      if (isV3) {
        const query =
          selectMode === "aggregate"
            ? GET_V3_SWAPS_NO_POOL_FILTER_AGG_QUERY
            : GET_V3_SWAPS_NO_POOL_FILTER_QUERY;
        const response = await client.request<{ uniswapV3PoolSwaps: Array<V3SwapEventData | SwapAggRow> }>(
          query,
          { startTime, endTime, limit: pageLimit, offset }
        );
        const rawRows = response.uniswapV3PoolSwaps ?? [];
        const filtered = rawRows.filter(
          (r) => r.pool?.toLowerCase() === poolAddress
        );
        return { rows: filtered, newMode: "pool-field", rawCount: rawRows.length };
      } else {
        const query =
          selectMode === "aggregate"
            ? GET_V4_SWAPS_NO_POOL_FILTER_AGG_QUERY
            : GET_V4_SWAPS_NO_POOL_FILTER_QUERY;
        const response = await client.request<{ uniswapV4PoolSwaps: Array<V4SwapEventData | SwapAggRow> }>(
          query,
          { startTime, endTime, limit: pageLimit, offset }
        );
        const rawRows = response.uniswapV4PoolSwaps ?? [];
        const filtered = rawRows.filter(
          (r) => r.pool?.toLowerCase() === poolAddress
        );
        return { rows: filtered, newMode: "pool-field", rawCount: rawRows.length };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("pool") && message.includes("not found")) {
        queryMode = "minimal";
      } else {
        throw err;
      }
    }
  }
  
  // Minimal fallback (no pool filtering possible)
  if (isV3) {
    const response = await client.request<{ uniswapV3PoolSwaps: V3SwapEventData[] }>(
      GET_V3_SWAPS_MINIMAL_QUERY,
      { startTime, endTime, limit: pageLimit, offset }
    );
    const rows = response.uniswapV3PoolSwaps ?? [];
    return { rows, newMode: "minimal", rawCount: rows.length };
  } else {
    const response = await client.request<{ uniswapV4PoolSwaps: V4SwapEventData[] }>(
      GET_V4_SWAPS_NO_POOL_FILTER_QUERY,
      { startTime, endTime, limit: pageLimit, offset }
    );
    const rows = response.uniswapV4PoolSwaps ?? [];
    return { rows, newMode: "minimal", rawCount: rows.length };
  }
}

async function fetchChunkRecursive(
  client: GraphQLClient,
  chunk: TimeChunk,
  poolAddress: string,
  isV3: boolean,
  queryMode: QueryMode,
  pageLimit: number,
  minChunkSeconds: number,
  selectMode: "full" | "aggregate"
): Promise<FetchChunkResult> {
  const first = await fetchChunkPage(client, chunk, poolAddress, isV3, queryMode, pageLimit, 0, selectMode);
  const effectiveMode = first.newMode;
  const duration = chunk.endTime - chunk.startTime;

  if (first.rawCount >= pageLimit && duration > minChunkSeconds) {
    const mid = Math.floor((chunk.startTime + chunk.endTime) / 2);
    const left = await fetchChunkRecursive(
      client,
      { startTime: chunk.startTime, endTime: mid },
      poolAddress,
      isV3,
      effectiveMode,
      pageLimit,
      minChunkSeconds,
      selectMode
    );
    const right = await fetchChunkRecursive(
      client,
      { startTime: mid, endTime: chunk.endTime },
      poolAddress,
      isV3,
      left.newMode,
      pageLimit,
      minChunkSeconds,
      selectMode
    );
    return { rows: [...left.rows, ...right.rows], newMode: right.newMode, truncated: false };
  }

  if (effectiveMode !== "pool-where") {
    return { rows: first.rows, newMode: effectiveMode, truncated: first.rawCount >= pageLimit };
  }

  // Cursor pagination for pool-where (avoids offset behavior differences)
  const rows = [...first.rows];
  if (first.rawCount < pageLimit) {
    return { rows, newMode: effectiveMode, truncated: false };
  }

  let lastTs = first.rows[first.rows.length - 1]?.timestamp ?? chunk.startTime;
  let lastId = first.rows[first.rows.length - 1]?.id ?? "";
  let pageCount = 0;
  const MAX_PAGES = 300;

  while (pageCount < MAX_PAGES) {
    if (isV3) {
      const query =
        selectMode === "aggregate"
          ? GET_V3_SWAPS_BY_POOL_CURSOR_AGG_QUERY
          : GET_V3_SWAPS_BY_POOL_CURSOR_QUERY;
      const response = await client.request<{ uniswapV3PoolSwaps: Array<V3SwapEventData | SwapAggRow> }>(
        query,
        {
          pool: poolAddress,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          lastTs,
          lastId,
          limit: pageLimit,
        }
      );
      const pageRows = response.uniswapV3PoolSwaps ?? [];
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
      if (pageRows.length < pageLimit) break;
      lastTs = pageRows[pageRows.length - 1]?.timestamp ?? lastTs;
      lastId = pageRows[pageRows.length - 1]?.id ?? lastId;
    } else {
      const query =
        selectMode === "aggregate"
          ? GET_V4_SWAPS_BY_POOL_CURSOR_AGG_QUERY
          : GET_V4_SWAPS_BY_POOL_CURSOR_QUERY;
      const response = await client.request<{ uniswapV4PoolSwaps: Array<V4SwapEventData | SwapAggRow> }>(
        query,
        {
          pool: poolAddress,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          lastTs,
          lastId,
          limit: pageLimit,
        }
      );
      const pageRows = response.uniswapV4PoolSwaps ?? [];
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
      if (pageRows.length < pageLimit) break;
      lastTs = pageRows[pageRows.length - 1]?.timestamp ?? lastTs;
      lastId = pageRows[pageRows.length - 1]?.id ?? lastId;
    }
    pageCount += 1;
  }

  return { rows, newMode: effectiveMode, truncated: false };
}

export async function GET(request: NextRequest) {
  const startMs = Date.now();
  
  const poolAddressRaw =
    request.nextUrl.searchParams.get("poolAddress") ??
    request.nextUrl.searchParams.get("pool") ??
    "";
  const days = parseDays(request.nextUrl.searchParams.get("days"));
  const mode = (request.nextUrl.searchParams.get("mode") ?? "").toLowerCase();
  const token0Usd = parseNumberParam(request.nextUrl.searchParams.get("token0Usd"));
  const token1Usd = parseNumberParam(request.nextUrl.searchParams.get("token1Usd"));
  const token0Decimals = parseNumberParam(request.nextUrl.searchParams.get("token0Decimals"));
  const token1Decimals = parseNumberParam(request.nextUrl.searchParams.get("token1Decimals"));

  if (!poolAddressRaw) {
    return NextResponse.json({ error: "Missing poolAddress" }, { status: 400 });
  }

  const isSolana = isSolanaPool(poolAddressRaw);
  const poolAddress = isSolana ? poolAddressRaw.trim() : poolAddressRaw.toLowerCase();
  const isV3 = isAddress(poolAddressRaw);
  const isV4 = isV4PoolKey(poolAddress);

  if (isDemoRequest(request, poolAddress)) {
    return NextResponse.json(getDemoTradingVolumeBySize(), {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "X-Source": "demo-fixture",
      },
    });
  }

  if (!isV3 && !isV4 && !isSolana) {
    return NextResponse.json(
      { error: "Invalid poolAddress (expected v3 address, v4 pool key, or Solana pool)" },
      { status: 400 }
    );
  }

  if (
    mode === "aggregate" &&
    token0Decimals !== null &&
    token1Decimals !== null &&
    (token0Usd !== null || token1Usd !== null)
  ) {
    const cacheKey = [
      poolAddress,
      days,
      toCachePart(token0Usd),
      toCachePart(token1Usd),
      token0Decimals,
      token1Decimals,
    ].join("|");
    const cached = aggregateCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < AGGREGATE_CACHE_TTL_MS) {
      return NextResponse.json(cached.payload, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "X-Query-Mode": "cache",
        },
      });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const startTime = now - days * 24 * 60 * 60;
  const aggregateCacheKey =
    mode === "aggregate" &&
    token0Decimals !== null &&
    token1Decimals !== null &&
    (token0Usd !== null || token1Usd !== null)
      ? [
          poolAddress,
          days,
          toCachePart(token0Usd),
          toCachePart(token1Usd),
          token0Decimals,
          token1Decimals,
        ].join("|")
      : null;

  // ── Raydium / Solana pool — proxy to Railway API ──
  if (isSolana) {
    try {
      const solanaParams: Record<string, string | number | boolean | Array<string | number | boolean>> = {
        pool: poolAddress,
        start_time: startTime,
        end_time: now,
        bucket_period: "1d",
      };
      if (token0Usd !== null) solanaParams.token0_usd = token0Usd;
      if (token1Usd !== null) solanaParams.token1_usd = token1Usd;
      if (token0Decimals !== null) solanaParams.token0_decimals = token0Decimals;
      if (token1Decimals !== null) solanaParams.token1_decimals = token1Decimals;

      const agg = await fetchSolanaApi<{
        series?: Array<{
          pool?: string;
          timestamp: number;
          buckets: Record<BucketId, number>;
          total_usd: number;
        }>;
      }>(
        "/api/charts/volume-by-size",
        solanaParams,
      );
      const series = agg.series ?? [];
      const dailyData: DailyBucketData[] = series
        .filter((row) => !row.pool || row.pool === poolAddress)
        .map((row) => {
          const { dateKey, date } = formatDateKeyUtc(row.timestamp);
          return {
            date: date.toISOString(),
            dateKey,
            buckets: row.buckets,
            total: row.total_usd,
          };
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const durationMs = Date.now() - startMs;
      if (mode === "aggregate") {
        if (aggregateCacheKey) {
          aggregateCache.set(aggregateCacheKey, { timestamp: Date.now(), payload: { dailyData } });
        }
        return NextResponse.json(
          { dailyData },
          {
            headers: {
              "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
              "X-Source": "railway-aggregated",
              "X-Fetch-Duration-Ms": String(durationMs),
            },
          }
        );
      }

      // For non-aggregate mode, preserve previous API shape by flattening daily buckets.
      const allResults: SwapAggRow[] = dailyData.map((d, i) => ({
        id: `agg-${d.dateKey}-${i}`,
        timestamp: Math.floor(new Date(d.date).getTime() / 1000),
        amount0: String(d.total),
        amount1: "0",
      }));
      return NextResponse.json(
        allResults,
        {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
            "X-Source": "railway-aggregated",
            "X-Fetch-Duration-Ms": String(durationMs),
          },
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (aggregateCacheKey) {
        const stale = aggregateCache.get(aggregateCacheKey);
        if (stale) {
          return NextResponse.json(stale.payload, {
            headers: {
              "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
              "X-Query-Mode": "stale",
              "X-Source": "railway-aggregated",
            },
          });
        }
      }
      console.error("[api/trading-volume-by-size] Raydium fetch failed", { message });
      if (mode === "aggregate") {
        return NextResponse.json(
          { dailyData: [] as DailyBucketData[] },
          {
            headers: {
              "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
              "X-Query-Mode": "degraded-empty",
              "X-Source": "railway-aggregated",
            },
          }
        );
      }
      return NextResponse.json([], {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Query-Mode": "degraded-empty",
          "X-Source": "railway-aggregated",
        },
      });
    }
  }

  // ── EVM pools — use pre-computed PoolDailyVolumeBySize entity ──
  // Single REST query instead of hundreds of raw swap fetches.

  if (
    isWorldchainIndexerPool(poolAddress) &&
    token0Decimals !== null &&
    token1Decimals !== null &&
    (token0Usd !== null || token1Usd !== null)
  ) {
    try {
      const rows = await fetchWorldchainPoolDailyVolumeBySize(poolAddress, startTime);
      const durationMs = Date.now() - startMs;
      console.log(
        `[api/trading-volume-by-size] Worldchain pre-computed: ${rows.length} bucket rows in ${durationMs}ms (${days} days)`
      );

      const dayMap = new Map<string, DailyBucketData>();

      for (const row of rows) {
        const { dateKey, date } = formatDateKeyUtc(row.date);
        if (!dayMap.has(dateKey)) {
          dayMap.set(dateKey, {
            date: date.toISOString(),
            dateKey,
            buckets: initBuckets(),
            total: 0,
          });
        }

        const vol0 = Math.abs(Number(row.volumeToken0 || "0")) / Math.pow(10, token0Decimals);
        const vol1 = Math.abs(Number(row.volumeToken1 || "0")) / Math.pow(10, token1Decimals);
        const usd0 = token0Usd !== null ? vol0 * token0Usd : null;
        const usd1 = token1Usd !== null ? vol1 * token1Usd : null;

        let bucketUsd = 0;
        if (usd0 !== null && usd1 !== null) {
          bucketUsd = (usd0 + usd1) / 2;
        } else if (usd0 !== null) {
          bucketUsd = usd0;
        } else if (usd1 !== null) {
          bucketUsd = usd1;
        }

        const bucketId = (SIZE_BUCKETS.find((b) => b.id === row.sizeBucket)?.id ?? "below_100") as BucketId;
        const day = dayMap.get(dateKey)!;
        day.buckets[bucketId] += bucketUsd;
        day.total += bucketUsd;
      }

      const dailyData = Array.from(dayMap.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      if (mode === "aggregate") {
        if (aggregateCacheKey) {
          aggregateCache.set(aggregateCacheKey, { timestamp: Date.now(), payload: { dailyData } });
        }
        return NextResponse.json(
          { dailyData },
          {
            headers: {
              "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
              "X-Query-Mode": "pre-computed",
              "X-Source": "railway-worldchain-precomputed",
              "X-Fetch-Duration-Ms": String(durationMs),
              "X-Row-Count": String(rows.length),
            },
          }
        );
      }

      const allResults: SwapAggRow[] = dailyData.map((d, i) => ({
        id: `agg-${d.dateKey}-${i}`,
        timestamp: Math.floor(new Date(d.date).getTime() / 1000),
        amount0: String(d.total),
        amount1: "0",
      }));
      return NextResponse.json(allResults, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Source": "railway-worldchain-precomputed",
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api/trading-volume-by-size] Worldchain pre-computed query failed", {
        message,
        poolAddress,
        days,
      });
    }
  }

  if (
    mode === "aggregate" &&
    token0Decimals !== null &&
    token1Decimals !== null &&
    (token0Usd !== null || token1Usd !== null)
  ) {
    try {
      const client = new GraphQLClient(resolveServerEnvioGraphqlEndpoint(), {
        headers: {},
      });

      const PRE_COMPUTED_QUERY = `
        query GetPoolDailyVolumeBySize($pool: String!, $since: Int!) {
          poolDailyVolumeBySizes(
            where: { pool: $pool, date_gte: $since }
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

      const response = await retryGraphQLRequest(() =>
        client.request<{
          poolDailyVolumeBySizes: Array<{
            id: string;
            pool: string;
            date: number;
            sizeBucket: string;
            volumeToken0: string;
            volumeToken1: string;
            swapCount: number;
          }>;
        }>(PRE_COMPUTED_QUERY, { pool: poolAddress, since: startTime })
      );

      const rows = response.poolDailyVolumeBySizes ?? [];
      const durationMs = Date.now() - startMs;
      console.log(
        `[api/trading-volume-by-size] Pre-computed: ${rows.length} bucket rows in ${durationMs}ms (${days} days)`
      );

      // Group rows by date → build DailyBucketData
      const dayMap = new Map<string, DailyBucketData>();

      for (const row of rows) {
        const { dateKey, date } = formatDateKeyUtc(row.date);
        if (!dayMap.has(dateKey)) {
          dayMap.set(dateKey, {
            date: date.toISOString(),
            dateKey,
            buckets: initBuckets(),
            total: 0,
          });
        }

        // Convert token volumes to USD
        const vol0 = Math.abs(Number(row.volumeToken0 || "0")) / Math.pow(10, token0Decimals);
        const vol1 = Math.abs(Number(row.volumeToken1 || "0")) / Math.pow(10, token1Decimals);
        const usd0 = token0Usd !== null ? vol0 * token0Usd : null;
        const usd1 = token1Usd !== null ? vol1 * token1Usd : null;

        let bucketUsd = 0;
        if (usd0 !== null && usd1 !== null) {
          bucketUsd = (usd0 + usd1) / 2;
        } else if (usd0 !== null) {
          bucketUsd = usd0;
        } else if (usd1 !== null) {
          bucketUsd = usd1;
        }

        const bucketId = (SIZE_BUCKETS.find((b) => b.id === row.sizeBucket)?.id ?? "below_100") as BucketId;
        const day = dayMap.get(dateKey)!;
        day.buckets[bucketId] += bucketUsd;
        day.total += bucketUsd;
      }

      const dailyData = Array.from(dayMap.values()).sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      const payload = { dailyData };
      const cacheKey = [
        poolAddress,
        days,
        toCachePart(token0Usd),
        toCachePart(token1Usd),
        token0Decimals,
        token1Decimals,
      ].join("|");
      aggregateCache.set(cacheKey, { timestamp: Date.now(), payload });

      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "X-Query-Mode": "pre-computed",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Row-Count": String(rows.length),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api/trading-volume-by-size] Pre-computed query failed, falling back to raw swaps", {
        message,
        poolAddress,
        days,
      });
      // Fall through to raw swap fetching below
    }
  }

  // ── Fallback: raw swap fetching (for non-aggregate mode or if pre-computed fails) ──

  try {
    const client = new GraphQLClient(resolveServerEnvioGraphqlEndpoint(), {
      headers: {},
    });

    const chunks = createTimeChunks(startTime, now);
    const CONCURRENCY = 2;
    const PAGE_LIMIT = 1000;
    const MIN_CHUNK_SECONDS_POOL = 15 * 60;
    const MIN_CHUNK_SECONDS_FALLBACK = 60;

    let queryMode: QueryMode = "pool-where";
    const selectMode: "full" | "aggregate" =
      mode === "aggregate" && (token0Usd !== null || token1Usd !== null) ? "aggregate" : "full";
    const allResults: Array<V3SwapEventData | V4SwapEventData | SwapAggRow> = [];

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);

      const batchPromises = batch.map(async (chunk) => {
        const result = await retryGraphQLRequest(() => fetchChunkRecursive(
          client,
          chunk,
          poolAddress,
          isV3,
          queryMode,
          PAGE_LIMIT,
          queryMode === "pool-where" ? MIN_CHUNK_SECONDS_POOL : MIN_CHUNK_SECONDS_FALLBACK,
          selectMode
        ));
        if (result.newMode !== queryMode) {
          queryMode = result.newMode;
        }
        return result.rows;
      });

      const batchResults = await Promise.all(batchPromises);
      for (const rows of batchResults) {
        allResults.push(...rows);
      }
    }

    if (selectMode === "full") {
      allResults.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    }

    const durationMs = Date.now() - startMs;
    console.log(`[api/trading-volume-by-size] Raw fallback: ${allResults.length} swaps in ${durationMs}ms (${days} days)`);

    return NextResponse.json(allResults, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Query-Mode": queryMode,
        "X-Fetch-Duration-Ms": String(durationMs),
        "X-Swap-Count": String(allResults.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/trading-volume-by-size] Failed to fetch swaps", {
      message,
      poolAddress,
      days,
    });
    return NextResponse.json({ error: "Failed to fetch swap data" }, { status: 502 });
  }
}
