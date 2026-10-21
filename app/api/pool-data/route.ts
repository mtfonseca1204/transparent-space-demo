import { NextRequest, NextResponse } from "next/server";
import { GraphQLClient } from "graphql-request";
import { isAddress } from "viem";
import { retryGraphQLRequest } from "@/lib/graphql-retry";
import { isSolanaPool, isMeteoraPool, getSolanaPoolMetadata } from "@/lib/pools";
import {
  buildMeteoraSyntheticPosition,
  estimateMeteoraSyntheticLiquidity,
  resolveMeteoraRange,
  type MeteoraResolvedRange,
  type MeteoraSyntheticContext,
} from "@/lib/meteora-dlmm";
import { humanPriceToTick } from "@/lib/raydium-math";
import {
  fetchRailwayEntityPaginated,
  fetchWorldchainOwnerAggregates,
  fetchWorldchainPoolById,
  fetchWorldchainPoolHourData,
  fetchWorldchainPositions,
  fetchWorldchainTickLiquidity,
  getRailwayIndexerProtocol,
  isWorldchainIndexerPool,
} from "@/lib/worldchain-indexer-client";
import { buildWorldchainPoolDataMeta, type WorldchainPoolDataMeta } from "@/lib/worldchain-pool-data";
import { supportsV3PoolMintBurnEntities } from "@/lib/evm-v2-pool-support";
import {
  fetchSolanaApi,
  fetchAllSolanaPages,
  type SolanaPositionResponse,
  type SolanaPositionEventResponse,
  type SolanaCandleResponse,
  type SolanaPriceResponse,
} from "@/lib/solana-indexer-client";
import { getDemoPoolDataResponse, isDemoRequest, resolveDemoPoolKey } from "@/lib/demo/fixtures";

// Allow deeper Solana event pagination (the all-time LP event feed for the
// liquidity-depth heatmap / rebalance charts can span many pages) without
// hitting the function timeout. Responses are cached (see CACHE_TTL_MS), so the
// deep first-load cost is amortized across users.
export const maxDuration = 60;

// =============================================================================
// /api/pool-data - Batched pool data endpoint with server-side caching
// Combines: TickLiquidity + PoolHourData + LPEvent + UniswapV3Pool_Mint/Burn
// Reduces 4-5 Envio requests to 1 request per cache miss
// Also supports Raydium/Solana pools via Railway API
// =============================================================================

// Validate pool parameter: v3 pools are addresses, v4 pools are "chainId-v4-0x...", or Solana base58
function isValidPoolKey(pool: string): boolean {
  if (!pool) return false;
  if (isAddress(pool)) return true;
  if (/^\d+-v4-0x[0-9a-f]{64}$/i.test(pool)) return true;
  if (isSolanaPool(pool)) return true;
  return false;
}

// Type definitions
interface TickLiquidityData {
  id: string;
  pool: string;
  tick: number;
  liquidityGross: string;
  liquidityNet: string;
  updatedAt: number;
}

interface PoolHourData {
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

interface LPEventData {
  id: string;
  owner: string;
  eventType: string;
  timestamp: number;
  liquidityDelta: string;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
}

interface V3PoolMintEventData {
  id: string;
  pool: string;
  timestamp: number;
  transactionHash: string;
  tickLower: string;
  tickUpper: string;
  amount: string;
  amount0: string;
  amount1: string;
  owner?: string;
  sender?: string;
}

interface V3PoolBurnEventData {
  id: string;
  pool: string;
  timestamp: number;
  transactionHash: string;
  tickLower: string;
  tickUpper: string;
  amount: string;
  amount0: string;
  amount1: string;
  owner?: string;
}

interface PositionData {
  id: string;
  tokenId?: string;
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  updatedAt?: number;
}

interface OwnerAggregateData {
  id: string;
  pool: string;
  owner: string;
  liquidityTotal: string;
  updatedAt: number;
}

interface BatchedPoolDataResponse {
  tickLiquidities: TickLiquidityData[];
  poolHourDatas: PoolHourData[];
  lpevents: LPEventData[];
  uniswapV3PoolMints: V3PoolMintEventData[];
  uniswapV3PoolBurns: V3PoolBurnEventData[];
  positions?: PositionData[];
  ownerAggregates?: OwnerAggregateData[];
  meta?: WorldchainPoolDataMeta | null;
  lpActivitySeries?: Array<{
    timestamp: number;
    depth_band_buy?: number;
    depth_band_sell?: number;
  }>;
}

interface CachedData {
  timestamp: number;
  data: BatchedPoolDataResponse;
}

// Server-side in-memory cache
const cache = new Map<string, CachedData>();
const CACHE_TTL_MS = 60_000; // 1 minute TTL
const IS_DEV = process.env.NODE_ENV !== "production";

// Separate cache for "last good" tick liquidity data per pool
// This ensures we don't return empty tick data for narrow time window queries
interface LastGoodTickData {
  timestamp: number;
  tickLiquidities: TickLiquidityData[];
}
const lastGoodTickCache = new Map<string, LastGoodTickData>();
const LAST_GOOD_TICK_TTL_MS = 5 * 60_000; // 5 minute TTL for last good tick data

type SolanaInclude = "positions" | "events" | "hours" | "lp-activity";
const DEFAULT_SOLANA_INCLUDES: SolanaInclude[] = [
  "positions",
  "events",
  "hours",
  "lp-activity",
];

function parseSolanaIncludes(raw: string | null): Set<SolanaInclude> {
  if (!raw) return new Set(DEFAULT_SOLANA_INCLUDES);
  const includes = new Set<SolanaInclude>();
  for (const token of raw.split(",")) {
    const normalized = token.trim().toLowerCase();
    if (normalized === "positions" || normalized === "events" || normalized === "hours" || normalized === "lp-activity") {
      includes.add(normalized);
    }
  }
  return includes.size > 0 ? includes : new Set(DEFAULT_SOLANA_INCLUDES);
}

function parseClampedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeIntegerLike(
  value: string | number | bigint | null | undefined,
  fallback: string = "0"
): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return trimmed;
  }
  return fallback;
}

function parseOptionalNumber(value: string | number | null | undefined): number | null {
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

function absoluteNumericString(value: string | number | null | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+$/.test(trimmed)) {
      const normalized = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
      return normalized === "0" ? null : normalized;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed === 0) return null;
    return String(Math.abs(parsed));
  }
  const parsed = parseOptionalNumber(value);
  if (parsed === null || parsed === 0) return null;
  return String(Math.abs(parsed));
}

function buildMeteoraSyntheticContext(
  poolKey: string,
  priceSnapshot: SolanaPriceResponse | null
): MeteoraSyntheticContext | null {
  const meta = getSolanaPoolMetadata(poolKey);
  if (!meta) return null;

  const currentPrice =
    typeof priceSnapshot?.price === "number" &&
    Number.isFinite(priceSnapshot.price) &&
    priceSnapshot.price > 0
      ? priceSnapshot.price
      : 1;
  const parsedTick = parseOptionalNumber(priceSnapshot?.tick);
  const derivedTick = humanPriceToTick(
    currentPrice,
    meta.token0Decimals,
    meta.token1Decimals
  );
  const currentTick = parsedTick !== null ? parsedTick : derivedTick;
  if (!Number.isFinite(currentTick)) return null;

  return {
    currentTick,
    activeBinId:
      parseOptionalNumber(priceSnapshot?.active_bin_id) ??
      parseOptionalNumber(priceSnapshot?.last_swap_bin_id),
    tickSpacing: Math.max(1, meta.tickSpacing ?? 1),
    token0Decimals: meta.token0Decimals,
    token1Decimals: meta.token1Decimals,
    currentPrice,
  };
}

function toPositionDataWithPool(
  pool: string,
  built: ReturnType<typeof buildMeteoraSyntheticPosition>
): PositionData | null {
  if (!built) return null;
  return {
    ...built.position,
    pool,
  };
}

function pickSolanaResolution(startTime: number, endTime: number): "5m" | "15m" | "1h" | "4h" | "1d" {
  const span = Math.max(0, endTime - startTime);
  if (span <= 4 * 3600) return "5m";
  if (span <= 24 * 3600) return "15m";
  if (span <= 7 * 24 * 3600) return "1h";
  if (span <= 30 * 24 * 3600) return "4h";
  return "1d";
}

// Prune old cache entries periodically
function pruneCache(): void {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS * 2) {
      cache.delete(key);
    }
  }
  // Limit cache size
  if (cache.size > 100) {
    const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 50; i++) {
      cache.delete(entries[i][0]);
    }
  }
  
  // Also prune last good tick cache
  for (const [key, value] of lastGoodTickCache.entries()) {
    if (now - value.timestamp > LAST_GOOD_TICK_TTL_MS * 2) {
      lastGoodTickCache.delete(key);
    }
  }
}

// Batched query combining all pool data (including positions for atomic fetching)
const GET_BATCHED_POOL_DATA_QUERY = `
  query BatchedPoolData(
    $pool: String!
    $startTime: Int!
    $endTime: Int!
    $minTick: Int!
    $maxTick: Int!
  ) {
    tickLiquidities(
      where: {
        pool: $pool
        tick_gte: $minTick
        tick_lte: $maxTick
      }
      orderBy: tick
      orderDirection: asc
      first: 1000
    ) {
      id
      pool
      tick
      liquidityGross
      liquidityNet
      updatedAt
    }

    poolHourDatas(
      where: {
        pool: $pool
        periodStartUnix_gte: $startTime
      }
      orderBy: periodStartUnix
      orderDirection: asc
      first: 1000
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

    positions(
      where: {
        pool: $pool
        liquidity_gt: "0"
      }
      orderBy: liquidity
      orderDirection: desc
      first: 1000
    ) {
      id
      tokenId
      pool
      owner
      tickLower
      tickUpper
      liquidity
      updatedAt
    }
  }
`;

// Individual pagination queries for when the batched query hits the 1000 limit
const PAGINATE_LPEVENTS_QUERY = `
  query PaginateLPEvents($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    lpevents(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lte: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
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

const PAGINATE_V3_MINTS_QUERY = `
  query PaginateV3Mints($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolMints(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lte: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
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
  }
`;

const PAGINATE_V3_BURNS_QUERY = `
  query PaginateV3Burns($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!, $offset: Int!) {
    uniswapV3PoolBurns(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lte: $endTime }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
      skip: $offset
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

const PAGINATE_POSITIONS_QUERY = `
  query PaginatePositions($pool: String!, $limit: Int!, $offset: Int!) {
    positions(
      where: { pool: $pool, liquidity_gt: "0" }
      orderBy: liquidity
      orderDirection: desc
      first: $limit
      skip: $offset
    ) {
      id
      tokenId
      pool
      owner
      tickLower
      tickUpper
      liquidity
      updatedAt
    }
  }
`;

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // Safety limit: 10k events max

/**
 * Paginate a GraphQL collection that hit the `first: 1000` limit.
 * Fetches subsequent pages and returns all items merged.
 */
async function paginateCollection<T>(
  client: GraphQLClient,
  query: string,
  variables: Record<string, unknown>,
  collectionKey: string,
  firstPage: T[],
): Promise<T[]> {
  const all = [...firstPage];
  let offset = PAGE_SIZE;

  for (let page = 1; page < MAX_PAGES; page++) {
    // Delay between pages to avoid legacy GraphQL rate limiting.
    if (page > 1) await new Promise(r => setTimeout(r, 300));

    const res = await retryGraphQLRequest(
      () => client.request<Record<string, T[]>>(query, {
        ...variables,
        limit: PAGE_SIZE,
        offset,
      }),
      { maxRetries: 3, initialDelay: 2000 }
    );
    const items = res[collectionKey] ?? [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break; // Last page
    offset += PAGE_SIZE;
  }

  return all;
}

function resolveEnvioEndpoint(): string {
  return (
    process.env.ENVIO_GRAPHQL_ENDPOINT ||
    process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT ||
    "http://localhost:8080/v1/graphql"
  );
}

export async function GET(request: NextRequest) {
  const startMs = Date.now();

  // Parse parameters
  const poolRaw = request.nextUrl.searchParams.get("pool") ?? "";
  const pool = isSolanaPool(poolRaw) ? poolRaw.trim() : poolRaw.toLowerCase();
  const startTime = Number(request.nextUrl.searchParams.get("startTime")) || 0;
  const endTime = Number(request.nextUrl.searchParams.get("endTime")) || Math.floor(Date.now() / 1000);
  const minTick = Number(request.nextUrl.searchParams.get("minTick")) || -15000;
  const maxTick = Number(request.nextUrl.searchParams.get("maxTick")) || 15000;
  const includeParam = request.nextUrl.searchParams.get("include");
  const isSolana = isSolanaPool(pool);
  const solanaIncludes = parseSolanaIncludes(includeParam);
  const positionsPageLimit = parseClampedInt(
    request.nextUrl.searchParams.get("positionsPageLimit"),
    5000,
    100,
    5000
  );
  const positionsMaxPages = parseClampedInt(
    request.nextUrl.searchParams.get("positionsMaxPages"),
    10,
    1,
    30
  );

  if (isDemoRequest(request, pool)) {
    return NextResponse.json(
      getDemoPoolDataResponse({ poolKey: resolveDemoPoolKey(pool), startTime, endTime }),
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Source": "demo-fixture",
        },
      }
    );
  }

  // Validate parameters
  if (!pool || !isValidPoolKey(pool)) {
    return NextResponse.json({ error: "Missing or invalid pool key" }, { status: 400 });
  }

  if (!isSolana && (!startTime || startTime >= endTime)) {
    return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
  }

  // ── Raydium / Solana pool — compose from Railway API ──
  if (isSolana) {
    const hasValidSolanaTimeRange = startTime < endTime;
    const effectiveStartTime = hasValidSolanaTimeRange
      ? startTime
      : Math.max(0, endTime - 1);

    // Solana callers often differ by a few seconds; bucket to hour for higher hit-rate and less upstream pressure.
    const roundedStartTime = Math.floor(effectiveStartTime / 3600) * 3600;
    const roundedEndTime = Math.floor(endTime / 3600) * 3600;
    const includeKey = Array.from(solanaIncludes).sort().join(",");
    const positionsBudgetKey = `pp${positionsPageLimit}-pm${positionsMaxPages}`;
    const cacheKey = `${pool}-${roundedStartTime}-${roundedEndTime}-${minTick}-${maxTick}-${includeKey}-${positionsBudgetKey}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "HIT",
          "X-Source": "railway",
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    }

    try {
      const isMeteora = isMeteoraPool(pool);
      const needPositions = solanaIncludes.has("positions");
      const needEvents = hasValidSolanaTimeRange && solanaIncludes.has("events");
      const needHours = hasValidSolanaTimeRange && solanaIncludes.has("hours");
      const needLpActivity =
        hasValidSolanaTimeRange && solanaIncludes.has("lp-activity");
      const needMeteoraRangeHydration = isMeteora && (needPositions || needEvents);

      // Fetch only requested sections; this avoids timeouts from unnecessary heavy queries.
      const [rawPositionsResult, rawEventsResult, rawCandlesResult, lpActivityAggResult, meteoraPriceResult] = await Promise.allSettled([
        needPositions || needMeteoraRangeHydration
          ? fetchAllSolanaPages<SolanaPositionResponse>(
              "/api/positions",
              { pool, ...(isMeteoraPool(pool) ? { active: true } : {}) },
              { pageLimit: positionsPageLimit, maxPages: positionsMaxPages }
            )
          : Promise.resolve([] as SolanaPositionResponse[]),
        needEvents
          ? fetchAllSolanaPages<SolanaPositionEventResponse>(
              "/api/position-events",
              {
                pool,
                start_time: effectiveStartTime,
                end_time: endTime,
                "event_types[]": isMeteoraPool(pool)
                  ? ["CreatePosition", "AddLiquidity", "RemoveLiquidity", "ClosePosition"]
                  : ["CreatePosition", "IncreaseLiquidity", "DecreaseLiquidity", "ClosePosition"],
              },
              // The server filters by start_time/end_time and fetchAllSolanaPages
              // drains via has_more, so short windows still stop after 1-2 pages.
              // The higher page cap only engages for long (e.g. 365d) feeds, where
              // a 5,000-event truncation otherwise dropped the oldest MINTs and
              // forced ~half of current positions to render as flat back-filled
              // bands. pageLimit stays 500 (the server page size) to avoid a
              // premature stop on non-enveloped responses; we raise maxPages only.
              { pageLimit: 500, maxPages: 30 }
            )
          : Promise.resolve([] as SolanaPositionEventResponse[]),
        needHours
          ? fetchAllSolanaPages<SolanaCandleResponse>(
              "/api/candles",
              {
                pool,
                interval: "1h",
                start_time: effectiveStartTime,
                end_time: endTime,
              },
              { pageLimit: 500, maxPages: 6 }
            )
          : Promise.resolve([] as SolanaCandleResponse[]),
        needLpActivity
          ? fetchSolanaApi<{
              series?: Array<{
                pool?: string;
                timestamp: number | string;
                depth_band_buy?: number | string;
                depth_band_sell?: number | string;
              }>;
            }>("/api/charts/lp-activity", {
              pool,
              start_time: effectiveStartTime,
              end_time: endTime,
              resolution: pickSolanaResolution(effectiveStartTime, endTime),
              include: "depth_band",
              impact_usd: 10000,
              max_points: 2000,
            })
          : Promise.resolve({ series: [] as Array<{
              pool?: string;
              timestamp: number | string;
              depth_band_buy?: number | string;
              depth_band_sell?: number | string;
            }> }),
        needMeteoraRangeHydration
          ? fetchSolanaApi<SolanaPriceResponse>("/api/price", { pool })
          : Promise.resolve(null),
      ]);
      const rawPositions = rawPositionsResult.status === "fulfilled" ? rawPositionsResult.value : [];
      const rawEvents = rawEventsResult.status === "fulfilled" ? rawEventsResult.value : [];
      const rawCandles = rawCandlesResult.status === "fulfilled" ? rawCandlesResult.value : [];
      const lpActivityAgg = lpActivityAggResult.status === "fulfilled" ? lpActivityAggResult.value : { series: [] };
      const meteoraPriceSnapshot =
        meteoraPriceResult.status === "fulfilled" ? meteoraPriceResult.value : null;
      const hoursUnavailable = needHours && rawCandlesResult.status === "rejected";
      const partialData =
        rawPositionsResult.status === "rejected" ||
        rawEventsResult.status === "rejected" ||
        hoursUnavailable ||
        lpActivityAggResult.status === "rejected" ||
        (needMeteoraRangeHydration && meteoraPriceResult.status === "rejected");
      if (IS_DEV && partialData) {
        console.warn("[api/pool-data] Raydium partial response", {
          pool,
          includeKey,
          positionsOk: rawPositionsResult.status === "fulfilled",
          eventsOk: rawEventsResult.status === "fulfilled",
          hoursOk: rawCandlesResult.status === "fulfilled",
          lpActivityOk: lpActivityAggResult.status === "fulfilled",
          meteoraPriceOk: meteoraPriceResult.status === "fulfilled",
        });
      }
      if (hoursUnavailable) {
        const durationMs = Date.now() - startMs;
        const message = rawCandlesResult.reason instanceof Error
          ? rawCandlesResult.reason.message
          : String(rawCandlesResult.reason);

        if (cached) {
          return NextResponse.json(cached.data, {
            headers: {
              "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
              "X-Cache": "STALE",
              "X-Source": "railway",
              "X-Partial-Data": "1",
              "X-Fetch-Duration-Ms": String(durationMs),
            },
          });
        }

        return NextResponse.json(
          {
            error: "Raydium hourly candle data unavailable",
            detail: message,
          },
          {
            status: 503,
            headers: {
              "Cache-Control": "no-store",
              "X-Cache": "DEGRADED",
              "X-Source": "railway",
              "X-Partial-Data": "1",
              "X-Fetch-Duration-Ms": String(durationMs),
            },
          }
        );
      }

      // Use Railway's position liquidity directly.
      // The Railway indexer updates the liquidity field on each event, so it reflects
      // the current on-chain state.
      // Railway fields: position_id (not nft_mint), nft_owner (not owner)
      const meteoraContext = isMeteora
        ? buildMeteoraSyntheticContext(pool, meteoraPriceSnapshot)
        : null;
      const meteoraRangesByPositionId = new Map<string, MeteoraResolvedRange>();
      const positions: PositionData[] =
        isMeteora && meteoraContext
          ? rawPositions
              .map((p) => {
                const built = buildMeteoraSyntheticPosition(p, meteoraContext);
                const position = toPositionDataWithPool(pool, built);
                if (!built || !position) return null;
                meteoraRangesByPositionId.set(position.id, built.range);
                return position;
              })
              .filter((p): p is PositionData => !!p)
          : rawPositions
              .map((p) => {
                const posId = p.position_id ?? p.nft_mint ?? "";
                const owner = p.nft_owner || p.owner || "";
                const liquidity = normalizeIntegerLike(p.liquidity);
                const tickLower = Number.isFinite(p.tick_lower) ? p.tick_lower : null;
                const tickUpper = Number.isFinite(p.tick_upper) ? p.tick_upper : null;
                return {
                  id: posId,
                  tokenId: posId,
                  pool,
                  owner,
                  tickLower: tickLower ?? 0,
                  tickUpper: tickUpper ?? 0,
                  liquidity: liquidity || "1",
                  updatedAt: (p.updated_at ?? p.opened_at)
                    ? Math.floor(new Date(p.updated_at ?? p.opened_at).getTime() / 1000)
                    : 0,
                };
              })
              .filter((p) => {
                if (!p.id || !p.owner) return false;
                return p.liquidity !== "0" && p.tickLower < p.tickUpper;
              });

      if (IS_DEV) {
        console.log(`[api/pool-data] Raydium positions: ${rawPositions.length} raw → ${positions.length} active (pool=${pool})`);
      }

      // Build position_id → owner lookup so events missing nft_owner can
      // resolve the wallet from the position table (e.g. ClosePosition events).
      const posOwnerLookup = new Map<string, string>();
      for (const p of rawPositions) {
        const posId = p.position_id || p.nft_mint || "";
        const posOwner = p.nft_owner || p.owner || "";
        if (posId && posOwner) posOwnerLookup.set(posId, posOwner);
      }

      const resolveMeteoraEventRange = (
        event: SolanaPositionEventResponse
      ): MeteoraResolvedRange | null => {
        if (!meteoraContext) return null;
        const positionId = event.position_id ?? event.position_nft_mint ?? event.nft_mint ?? "";
        const liveRange = positionId ? meteoraRangesByPositionId.get(positionId) : null;
        if (liveRange) return liveRange;
        return resolveMeteoraRange({
          lowerBinId: event.lower_bin_id,
          upperBinId: event.upper_bin_id,
          anchorBinId: event.active_bin_id_at_event,
          context: meteoraContext,
        });
      };

      const getMeteoraEventLiquidityMagnitude = (
        event: SolanaPositionEventResponse,
        range: MeteoraResolvedRange | null
      ): string => {
        if (!meteoraContext || !range) return "0";
        const amount0Raw =
          absoluteNumericString(event.amount0_delta) ??
          absoluteNumericString(event.deposit_amount_0) ??
          absoluteNumericString(event.withdraw_amount_0) ??
          absoluteNumericString(event.amount0);
        const amount1Raw =
          absoluteNumericString(event.amount1_delta) ??
          absoluteNumericString(event.deposit_amount_1) ??
          absoluteNumericString(event.withdraw_amount_1) ??
          absoluteNumericString(event.amount1);
        if (!amount0Raw && !amount1Raw) {
          return normalizeIntegerLike(event.liquidity, "0");
        }
        return estimateMeteoraSyntheticLiquidity({
          tickLower: range.tickLower,
          tickUpper: range.tickUpper,
          referenceTick: range.anchorTick,
          amount0Raw,
          amount1Raw,
          currentPrice: meteoraContext.currentPrice,
          token0Decimals: meteoraContext.token0Decimals,
          token1Decimals: meteoraContext.token1Decimals,
          fallbackLiquidity: event.liquidity,
        });
      };

      // Map position events → lpevents shape
      // Railway fields: event_id, event_type, position_nft_mint, nft_owner,
      //   deposit_amount_0/1, withdraw_amount_0/1, block_time
      const lpevents: LPEventData[] = rawEvents.flatMap((e) => {
        const eventType = e.event_type ?? e.type ?? "";
        if (isMeteora && eventType === "RebalancePosition") return [];
        const eventTypeMap: Record<string, string> = {
          CreatePosition: "MINT",
          IncreaseLiquidity: "INCREASE",
          AddLiquidity: "INCREASE",
          DecreaseLiquidity: "DECREASE",
          RemoveLiquidity: "DECREASE",
          ClosePosition: "BURN",
        };
        const ts = e.block_time ?? e.timestamp ?? "";
        const amount0 = e.deposit_amount_0 ?? e.withdraw_amount_0 ?? e.amount0 ?? "0";
        const amount1 = e.deposit_amount_1 ?? e.withdraw_amount_1 ?? e.amount1 ?? "0";
        const posId = e.position_id ?? e.position_nft_mint ?? e.nft_mint ?? "";
        const isBurn =
          eventType === "DecreaseLiquidity" ||
          eventType === "RemoveLiquidity" ||
          eventType === "ClosePosition";
        const range = isMeteora ? resolveMeteoraEventRange(e) : null;
        const magnitude = isMeteora
          ? getMeteoraEventLiquidityMagnitude(e, range)
          : normalizeIntegerLike(e.liquidity);
        const signedDelta = magnitude === "0" ? "0" : isBurn ? `-${magnitude}` : magnitude;
        return [{
          id: e.event_id ?? e.id ?? "",
          owner: e.nft_owner || e.owner || posOwnerLookup.get(posId) || "",
          eventType: eventTypeMap[eventType] ?? eventType,
          timestamp: Math.floor(new Date(ts).getTime() / 1000),
          liquidityDelta: signedDelta,
          amount0,
          amount1,
          tickLower: String(range?.tickLower ?? e.tick_lower ?? 0),
          tickUpper: String(range?.tickUpper ?? e.tick_upper ?? 0),
        }];
      });

      // Map mints / burns from events
      const getEventType = (e: SolanaPositionEventResponse) => e.event_type ?? e.type ?? "";
      const mapEvent = (e: SolanaPositionEventResponse) => {
        const ts = e.block_time ?? e.timestamp ?? "";
        const amount0 = e.deposit_amount_0 ?? e.withdraw_amount_0 ?? e.amount0 ?? "0";
        const amount1 = e.deposit_amount_1 ?? e.withdraw_amount_1 ?? e.amount1 ?? "0";
        const posId = e.position_id ?? e.position_nft_mint ?? e.nft_mint ?? "";
        const range = isMeteora ? resolveMeteoraEventRange(e) : null;
        return {
          id: e.event_id ?? e.id ?? "",
          pool,
          timestamp: Math.floor(new Date(ts).getTime() / 1000),
          transactionHash: e.transaction_hash,
          tickLower: String(range?.tickLower ?? e.tick_lower ?? 0),
          tickUpper: String(range?.tickUpper ?? e.tick_upper ?? 0),
          amount: isMeteora
            ? getMeteoraEventLiquidityMagnitude(e, range)
            : normalizeIntegerLike(e.liquidity),
          amount0,
          amount1,
          owner: e.nft_owner || e.owner || posOwnerLookup.get(posId) || "",
        };
      };

      const uniswapV3PoolMints: V3PoolMintEventData[] = rawEvents
        .filter((e) => {
          const eventType = getEventType(e);
          return eventType === "CreatePosition" || eventType === "IncreaseLiquidity" || eventType === "AddLiquidity";
        })
        .map(mapEvent);

      const uniswapV3PoolBurns: V3PoolBurnEventData[] = rawEvents
        .filter((e) => {
          const eventType = getEventType(e);
          return eventType === "DecreaseLiquidity" || eventType === "RemoveLiquidity" || eventType === "ClosePosition";
        })
        .map(mapEvent);

      // Map hourly candles → poolHourDatas shape
      // Raydium CLMM LP trading fees = volume * feeRate.
      // The candle's total_fees/fees_token0 are SPL Token-2022 transfer fees (often 0),
      // NOT the LP trading fees. Estimate LP fees from volume when transfer fees are absent.
      const poolMeta = getSolanaPoolMetadata(pool);
      const feeRate = (poolMeta?.fee ?? 2500) / 1_000_000; // e.g. 2500 → 0.0025 (0.25%)

      const poolHourDatas: PoolHourData[] = rawCandles.map((c) => {
        // Railway uses "open_time" (ISO string); fall back to "timestamp"
        const rawTs = c.open_time ?? c.timestamp;
        const ts = typeof rawTs === "string"
          ? Math.floor(new Date(rawTs).getTime() / 1000)
          : Number(rawTs);

        // Railway uses "price_open" etc; fall back to "open_price" for compat
        const openP = Number(c.price_open ?? c.open_price ?? 0);
        const highP = Number(c.price_high ?? c.high_price ?? 0);
        const lowP = Number(c.price_low ?? c.low_price ?? 0);
        const closeP = Number(c.price_close ?? c.close_price ?? 0);

        const vol0 = Number(c.volume_token0 ?? 0);
        const vol1 = Number(c.volume_token1 ?? 0);

        // Use explicit fee fields if provided, otherwise estimate from volume * feeRate
        const rawFee0 = Number(c.fees_token0 ?? 0);
        const rawFee1 = Number(c.fees_token1 ?? 0);
        const hasExplicitFees = rawFee0 > 0 || rawFee1 > 0;

        return {
          id: `raydium-hour-${ts}`,
          periodStartUnix: ts,
          volumeToken0: String(vol0),
          volumeToken1: String(vol1),
          feesToken0: hasExplicitFees ? String(rawFee0) : String(vol0 * feeRate),
          feesToken1: hasExplicitFees ? String(rawFee1) : String(vol1 * feeRate),
          txCount: Number(c.swap_count ?? c.tx_count ?? 0),
          openPrice: String(openP),
          highPrice: String(highP),
          lowPrice: String(lowP),
          closePrice: String(closeP),
          liquidity: "0",
        };
      });

      // Railway returns newest-first; sort ascending
      poolHourDatas.sort((a, b) => a.periodStartUnix - b.periodStartUnix);

      const data: BatchedPoolDataResponse = {
        tickLiquidities: [], // Railway /api/liquidity/ticks is empty; positions provide coverage
        poolHourDatas,
        lpevents,
        uniswapV3PoolMints,
        uniswapV3PoolBurns,
        positions,
        lpActivitySeries: (lpActivityAgg.series ?? [])
          .filter((p) => !p.pool || p.pool === pool)
          .map((p) => ({
            timestamp: Number(p.timestamp),
            depth_band_buy: p.depth_band_buy === undefined ? undefined : Number(p.depth_band_buy),
            depth_band_sell: p.depth_band_sell === undefined ? undefined : Number(p.depth_band_sell),
          }))
          .filter((p) => Number.isFinite(p.timestamp)),
      };
      cache.set(cacheKey, { timestamp: Date.now(), data });

      const durationMs = Date.now() - startMs;
      if (IS_DEV) {
        console.log(`[api/pool-data] Raydium: positions=${positions.length} events=${lpevents.length} hours=${poolHourDatas.length} in ${durationMs}ms`);
      }

      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "MISS",
          "X-Source": "railway",
          "X-Partial-Data": partialData ? "1" : "0",
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stale = cache.get(cacheKey);
      if (stale) {
        const durationMs = Date.now() - startMs;
        return NextResponse.json(stale.data, {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
            "X-Cache": "STALE",
            "X-Source": "railway",
            "X-Fetch-Duration-Ms": String(durationMs),
          },
        });
      }
      console.error("[api/pool-data] Raydium fetch failed", { message, pool });
      const durationMs = Date.now() - startMs;
      const empty: BatchedPoolDataResponse = {
        tickLiquidities: [],
        poolHourDatas: [],
        lpevents: [],
        uniswapV3PoolMints: [],
        uniswapV3PoolBurns: [],
        positions: [],
        lpActivitySeries: [],
      };
      return NextResponse.json(empty, {
        headers: {
          "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
          "X-Cache": "DEGRADED",
          "X-Source": "railway",
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    }
  }

  // ── Worldchain pools — fetch from the Worldchain REST indexer ──
  if (isWorldchainIndexerPool(pool)) {
    const cacheKey = `${pool}-${startTime}-${endTime}-${minTick}-${maxTick}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(cached.data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "HIT",
          "X-Source": "railway-worldchain",
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    }

    try {
      const poolLc = pool.toLowerCase();
      const indexerProtocol = getRailwayIndexerProtocol(pool);
      const requestedDays = Math.max(1, Math.ceil((endTime - startTime) / 86400));
      const worldchainEventMaxPages = Math.max(30, Math.ceil(requestedDays / 6));
      const worldchainMintBurnMaxPages = Math.max(20, Math.ceil(requestedDays / 12));

      const [poolSnapshot, tickLiquidities, poolHourDatasRaw, lpeventsRaw, mintsRaw, burnsRaw, positions, ownerAggregates] = await Promise.all([
        fetchWorldchainPoolById(pool),
        fetchWorldchainTickLiquidity(pool),
        fetchWorldchainPoolHourData(pool, startTime, endTime),
        fetchRailwayEntityPaginated<LPEventData>(
          "LPEvent",
          { pool: poolLc, from: startTime, to: endTime },
          worldchainEventMaxPages,
        ),
        supportsV3PoolMintBurnEntities(indexerProtocol)
          ? fetchRailwayEntityPaginated<V3PoolMintEventData>(
              "UniswapV3Pool_Mint",
              { pool: poolLc, from: startTime, to: endTime },
              worldchainMintBurnMaxPages,
            )
          : Promise.resolve([] as V3PoolMintEventData[]),
        supportsV3PoolMintBurnEntities(indexerProtocol)
          ? fetchRailwayEntityPaginated<V3PoolBurnEventData>(
              "UniswapV3Pool_Burn",
              { pool: poolLc, from: startTime, to: endTime },
              worldchainMintBurnMaxPages,
            )
          : Promise.resolve([] as V3PoolBurnEventData[]),
        fetchWorldchainPositions(pool),
        fetchWorldchainOwnerAggregates(pool),
      ]);

      const poolHourDatas = [...poolHourDatasRaw].sort((a, b) => a.periodStartUnix - b.periodStartUnix);
      const lpevents = [...lpeventsRaw].sort((a, b) => a.timestamp - b.timestamp);
      const mints = [...mintsRaw].sort((a, b) => a.timestamp - b.timestamp);
      const burns = [...burnsRaw].sort((a, b) => a.timestamp - b.timestamp);
      const meta = buildWorldchainPoolDataMeta({
        pool: poolSnapshot ?? {},
        positions,
        ownerAggregates: ownerAggregates.map((row) => ({
          id: row.id,
          pool: row.pool,
          owner: row.owner.toLowerCase(),
          liquidityTotal: row.liquidityTotal,
          updatedAt: row.updatedAt,
        })),
        lpevents,
        poolHourDatas,
        tickLiquidities,
        startTime,
        endTime,
      });

      const data: BatchedPoolDataResponse = {
        tickLiquidities,
        poolHourDatas,
        lpevents,
        uniswapV3PoolMints: mints,
        uniswapV3PoolBurns: burns,
        positions,
        ownerAggregates: ownerAggregates.map((row) => ({
          id: row.id,
          pool: row.pool,
          owner: row.owner.toLowerCase(),
          liquidityTotal: row.liquidityTotal,
          updatedAt: row.updatedAt,
        })),
        meta,
      };

      cache.set(cacheKey, { timestamp: Date.now(), data });

      const durationMs = Date.now() - startMs;
      if (IS_DEV) {
        console.log(
          `[api/pool-data] Worldchain indexer: ` +
          `Ticks: ${tickLiquidities.length}, Hours: ${poolHourDatas.length}, ` +
          `Events: ${lpevents.length}, Mints: ${mints.length}, Burns: ${burns.length}, ` +
          `Positions: ${positions.length} in ${durationMs}ms`
        );
      }

      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "MISS",
          "X-Source": "railway-worldchain",
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stale = cache.get(cacheKey);
      if (stale) {
        const durationMs = Date.now() - startMs;
        return NextResponse.json(stale.data, {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
            "X-Cache": "STALE",
            "X-Source": "railway-worldchain",
            "X-Fetch-Duration-Ms": String(durationMs),
          },
        });
      }
      console.error("[api/pool-data] Worldchain indexer fetch failed", { message, pool });
      return NextResponse.json({ error: "Failed to fetch Worldchain pool data" }, { status: 502 });
    }
  }

  // ── EVM pools — existing Envio GraphQL logic ──

  // Check cache
  const cacheKey = `${pool}-${startTime}-${endTime}-${minTick}-${maxTick}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const durationMs = Date.now() - startMs;
    if (IS_DEV) {
      console.log(`[api/pool-data] Cache HIT for ${pool.slice(0, 10)}... in ${durationMs}ms`);
    }
    
    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Cache": "HIT",
        "X-Fetch-Duration-Ms": String(durationMs),
      },
    });
  }

  try {
    const client = new GraphQLClient(resolveEnvioEndpoint());

    // Execute single batched query
    const response = await client.request<BatchedPoolDataResponse>(
      GET_BATCHED_POOL_DATA_QUERY,
      {
        pool,
        startTime,
        endTime,
        minTick,
        maxTick,
      }
    );

    // Normalize response (ensure arrays exist)
    let tickLiquidities = response.tickLiquidities ?? [];
    const poolHourDatas = response.poolHourDatas ?? [];
    let lpevents = response.lpevents ?? [];
    let uniswapV3PoolMints = response.uniswapV3PoolMints ?? [];
    let uniswapV3PoolBurns = response.uniswapV3PoolBurns ?? [];
    let positions = response.positions ?? [];

    // Paginate any collections that hit the 1000 limit
    const paginationVars = { pool, startTime, endTime };
    const paginationTasks: Promise<void>[] = [];

    if (lpevents.length >= PAGE_SIZE) {
      paginationTasks.push(
        paginateCollection<LPEventData>(client, PAGINATE_LPEVENTS_QUERY, paginationVars, 'lpevents', lpevents)
          .then(all => { lpevents = all; })
      );
    }
    if (uniswapV3PoolMints.length >= PAGE_SIZE) {
      paginationTasks.push(
        paginateCollection<V3PoolMintEventData>(client, PAGINATE_V3_MINTS_QUERY, paginationVars, 'uniswapV3PoolMints', uniswapV3PoolMints)
          .then(all => { uniswapV3PoolMints = all; })
      );
    }
    if (positions.length >= PAGE_SIZE) {
      paginationTasks.push(
        paginateCollection<PositionData>(client, PAGINATE_POSITIONS_QUERY, { pool }, 'positions', positions)
          .then(all => { positions = all; })
      );
    }
    if (uniswapV3PoolBurns.length >= PAGE_SIZE) {
      paginationTasks.push(
        paginateCollection<V3PoolBurnEventData>(client, PAGINATE_V3_BURNS_QUERY, paginationVars, 'uniswapV3PoolBurns', uniswapV3PoolBurns)
          .then(all => { uniswapV3PoolBurns = all; })
      );
    }

    if (paginationTasks.length > 0) {
      await Promise.all(paginationTasks);
    }

    // Handle empty tick data by falling back to last good cached data
    // This prevents price impact bands from breaking on narrow time window queries
    let usedCachedTicks = false;
    if (tickLiquidities.length === 0) {
      const lastGood = lastGoodTickCache.get(pool);
      if (lastGood && Date.now() - lastGood.timestamp < LAST_GOOD_TICK_TTL_MS) {
        tickLiquidities = lastGood.tickLiquidities;
        usedCachedTicks = true;
        if (IS_DEV) {
          console.log(`[api/pool-data] Using cached tick data for ${pool.slice(0, 10)}... (${tickLiquidities.length} ticks)`);
        }
      }
    } else {
      // Update last good tick cache with fresh data
      lastGoodTickCache.set(pool, {
        timestamp: Date.now(),
        tickLiquidities,
      });
    }

    const normalizedData: BatchedPoolDataResponse = {
      tickLiquidities,
      poolHourDatas,
      lpevents,
      uniswapV3PoolMints,
      uniswapV3PoolBurns,
      positions,
    };

    // Store in cache
    cache.set(cacheKey, { timestamp: Date.now(), data: normalizedData });

    // Prune old entries periodically
    if (Math.random() < 0.1) {
      pruneCache();
    }

    const durationMs = Date.now() - startMs;
    if (IS_DEV) {
      console.log(
        `[api/pool-data] Cache MISS for ${pool.slice(0, 10)}... - ` +
        `Ticks: ${normalizedData.tickLiquidities.length}${usedCachedTicks ? " (cached)" : ""}, ` +
        `Hours: ${normalizedData.poolHourDatas.length}, ` +
        `Events: ${normalizedData.lpevents.length}, ` +
        `Mints: ${normalizedData.uniswapV3PoolMints.length}, ` +
        `Burns: ${normalizedData.uniswapV3PoolBurns.length}, ` +
        `Positions: ${normalizedData.positions?.length ?? 0} ` +
        `in ${durationMs}ms`
      );
    }

    return NextResponse.json(normalizedData, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Cache": "MISS",
        "X-Fetch-Duration-Ms": String(durationMs),
        "X-Tick-Count": String(normalizedData.tickLiquidities.length),
        "X-Event-Count": String(normalizedData.lpevents.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stale = cache.get(cacheKey);
    if (stale) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(stale.data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "STALE",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Tick-Count": String(stale.data.tickLiquidities.length),
          "X-Event-Count": String(stale.data.lpevents.length),
        },
      });
    }
    console.error("[api/pool-data] Failed to fetch batched pool data", { message, pool });
    return NextResponse.json({ error: "Failed to fetch pool data" }, { status: 502 });
  }
}
