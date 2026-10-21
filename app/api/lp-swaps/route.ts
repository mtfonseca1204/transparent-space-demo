import { NextRequest, NextResponse } from "next/server";
import { GraphQLClient } from "graphql-request";
import { isAddress } from "viem";
import { getSolanaPoolMetadata, isSolanaPool } from "@/lib/pools";
import { fetchAllSolanaPages, type SolanaSwapResponse } from "@/lib/solana-indexer-client";
import {
  humanPriceToSqrtPriceX96,
  humanPriceToTick,
  sqrtPriceX64ToX96,
} from "@/lib/raydium-math";
import {
  fetchRailwayEntityPaginated,
  getRailwayIndexerProtocol,
  isWorldchainIndexerPool,
} from "@/lib/worldchain-indexer-client";
import { getIndexedEvmSwapEntity } from "@/lib/evm-v2-pool-support";
import { retryGraphQLRequest } from "@/lib/graphql-retry";
import { getDemoLpSwaps, isDemoRequest, resolveDemoPoolKey } from "@/lib/demo/fixtures";

// =============================================================================
// /api/lp-swaps - Smart chunking with aliased batching and server-side caching
// Optimization: Uses single query for small ranges, aliased queries for large
// This reduces N HTTP requests to 1 HTTP request for the same data
// Also supports Raydium/Solana pools via Railway API
// =============================================================================

type V3SwapEventData = {
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

type V4SwapEventData = {
  id: string;
  timestamp: number;
  sqrtPriceX96: string;
  liquidity: string;
  tick: string;
  amount0?: string;
  amount1?: string;
  sender?: string;
  transactionHash?: string;
  fee?: string;
};

// Single query for small/medium ranges
const GET_V3_SWAPS_SINGLE_QUERY = `
  query GetV3Swaps($pool: String!, $startTime: Int!, $endTime: Int!, $limit: Int!) {
    uniswapV3PoolSwaps(
      where: { pool: $pool, timestamp_gte: $startTime, timestamp_lt: $endTime }
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

function resolveEnvioEndpoint(): string {
  return (
    process.env.ENVIO_GRAPHQL_ENDPOINT ||
    process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT ||
    "http://localhost:8080/v1/graphql"
  );
}

// Server-side cache
interface CachedSwaps {
  timestamp: number;
  swaps: Array<V3SwapEventData | V4SwapEventData>;
}
const cache = new Map<string, CachedSwaps>();
const CACHE_TTL_MS = 30_000; // 30 seconds

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

function isV4PoolKey(poolKey: string): boolean {
  return /^\d+-v4-0x[0-9a-f]{64}$/.test(poolKey.toLowerCase());
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

function deriveSolanaSwapPrice(
  amount0: string | number,
  amount1: string | number,
  decimals0: number,
  decimals1: number
): number | null {
  const raw0 = Number(amount0);
  const raw1 = Number(amount1);
  if (!Number.isFinite(raw0) || !Number.isFinite(raw1) || raw0 === 0) return null;
  const token0 = Math.abs(raw0) / 10 ** decimals0;
  const token1 = Math.abs(raw1) / 10 ** decimals1;
  if (!Number.isFinite(token0) || !Number.isFinite(token1) || token0 === 0) return null;
  return token1 / token0;
}

export async function GET(request: NextRequest) {
  const startMs = Date.now();

  const poolRaw = request.nextUrl.searchParams.get("pool") ?? "";
  const pool = isSolanaPool(poolRaw) ? poolRaw.trim() : poolRaw.toLowerCase();
  const startTime = Number(request.nextUrl.searchParams.get("startTime")) || 0;
  const endTime = Number(request.nextUrl.searchParams.get("endTime")) || Math.floor(Date.now() / 1000);
  const swapsPageLimit = parseClampedInt(
    request.nextUrl.searchParams.get("swapsPageLimit"),
    1000,
    100,
    1000
  );
  const swapsMaxPages = parseClampedInt(
    request.nextUrl.searchParams.get("swapsMaxPages"),
    5,
    1,
    20
  );
  const isSolana = isSolanaPool(pool);

  if (isDemoRequest(request, pool)) {
    const swaps = getDemoLpSwaps({ poolKey: resolveDemoPoolKey(pool), startTime, endTime });
    return NextResponse.json(swaps, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Source": "demo-fixture",
        "X-Swap-Count": String(swaps.length),
      },
    });
  }

  if (!pool || (!isAddress(pool) && !isV4PoolKey(pool) && !isSolanaPool(pool))) {
    return NextResponse.json({ error: "Missing or invalid pool address" }, { status: 400 });
  }

  if (!isSolana && (!startTime || startTime >= endTime)) {
    return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
  }

  // ── Raydium / Solana pool — proxy to Railway API ──
  if (isSolana) {
    const cacheKey = `${pool}-${startTime}-${endTime}-spp${swapsPageLimit}-spm${swapsMaxPages}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(cached.swaps, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "HIT",
          "X-Source": "railway",
          "X-Swap-Count": String(cached.swaps.length),
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    }

    try {
      const poolMeta = getSolanaPoolMetadata(pool);
      const raw = await fetchAllSolanaPages<SolanaSwapResponse>(
        "/api/swaps",
        {
          pool,
          start_time: startTime,
          end_time: endTime,
        },
        { pageLimit: swapsPageLimit, maxPages: swapsMaxPages }
      );

      const swaps: V3SwapEventData[] = raw.map((s) => {
        const ts = s.block_time ?? s.timestamp ?? "";
        const timestamp = Math.floor(new Date(ts).getTime() / 1000);
        const fallbackPrice =
          poolMeta
            ? deriveSolanaSwapPrice(
                s.amount0,
                s.amount1,
                poolMeta.token0Decimals,
                poolMeta.token1Decimals
              )
            : null;
        return {
          id: s.swap_id ?? s.id ?? "",
          timestamp,
          sqrtPriceX96:
            s.sqrt_price_x64 !== null && s.sqrt_price_x64 !== undefined
              ? sqrtPriceX64ToX96(s.sqrt_price_x64)
              : fallbackPrice !== null && poolMeta
                ? humanPriceToSqrtPriceX96(
                    fallbackPrice,
                    poolMeta.token0Decimals,
                    poolMeta.token1Decimals
                  )
                : "0",
          liquidity: normalizeIntegerLike(s.liquidity),
          tick:
            s.tick !== null && s.tick !== undefined
              ? normalizeIntegerLike(s.tick)
              : fallbackPrice !== null && poolMeta
                ? String(
                    humanPriceToTick(
                      fallbackPrice,
                      poolMeta.token0Decimals,
                      poolMeta.token1Decimals
                    )
                  )
                : "0",
          amount0: String(s.amount0),
          amount1: String(s.amount1),
          sender: s.sender,
          recipient: s.recipient,
        };
      })
        .filter((s) => s.timestamp >= startTime && s.timestamp < endTime)
        .sort((a, b) => a.timestamp - b.timestamp);
      cache.set(cacheKey, { timestamp: Date.now(), swaps });

      const durationMs = Date.now() - startMs;
      console.log(`[api/lp-swaps] Raydium: ${swaps.length} swaps in ${durationMs}ms`);
      return NextResponse.json(swaps, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "MISS",
          "X-Source": "railway",
          "X-Swap-Count": String(swaps.length),
          "X-Fetch-Duration-Ms": String(durationMs),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api/lp-swaps] Raydium fetch failed", { message, pool });
      return NextResponse.json({ error: "Failed to fetch Raydium swaps" }, { status: 502 });
    }
  }

  // ── Worldchain pools — fetch from the Worldchain REST indexer ──
  if (isWorldchainIndexerPool(pool)) {
    const cacheKey = `${pool}-${startTime}-${endTime}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(cached.swaps, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "HIT",
          "X-Source": "railway-worldchain",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Swap-Count": String(cached.swaps.length),
        },
      });
    }

    try {
      const entity = getIndexedEvmSwapEntity(getRailwayIndexerProtocol(pool));
      const raw = await fetchRailwayEntityPaginated<V3SwapEventData | V4SwapEventData>(entity, {
        pool: pool.toLowerCase(),
        from: startTime,
        to: endTime,
      }, 10);

      const swaps = raw
        .filter((s) => s.timestamp >= startTime && s.timestamp < endTime)
        .sort((a, b) => a.timestamp - b.timestamp);

      cache.set(cacheKey, { timestamp: Date.now(), swaps });

      const durationMs = Date.now() - startMs;
      console.log(`[api/lp-swaps] Railway Worldchain: ${swaps.length} swaps in ${durationMs}ms`);

      return NextResponse.json(swaps, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "MISS",
          "X-Source": "railway-worldchain",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Swap-Count": String(swaps.length),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api/lp-swaps] Railway Worldchain fetch failed", { message, pool });
      return NextResponse.json({ error: "Failed to fetch Railway Worldchain swaps" }, { status: 502 });
    }
  }

  // ── EVM pools — existing Envio GraphQL logic ──

  // Check cache
  const cacheKey = `${pool}-${startTime}-${endTime}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const durationMs = Date.now() - startMs;
    return NextResponse.json(cached.swaps, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Cache": "HIT",
        "X-Fetch-Duration-Ms": String(durationMs),
        "X-Swap-Count": String(cached.swaps.length),
      },
    });
  }

  try {
    const client = new GraphQLClient(resolveEnvioEndpoint());

    // Legacy GraphQL max limit is 1000
    const MAX_LIMIT = 1000;
    const MAX_TOTAL = 10000; // Safety cap for UI rendering
    
    const allSwaps: V3SwapEventData[] = [];
    let queryMode = "single";
    let currentStartTime = startTime;

    // Paginated fetch with max 1000 per request
    while (allSwaps.length < MAX_TOTAL) {
      const response = await retryGraphQLRequest(() => client.request<{ uniswapV3PoolSwaps: V3SwapEventData[] }>(
        GET_V3_SWAPS_SINGLE_QUERY,
        { pool, startTime: currentStartTime, endTime, limit: MAX_LIMIT }
      ));
      
      const swaps = response.uniswapV3PoolSwaps ?? [];
      allSwaps.push(...swaps);
      
      // If we got less than the limit, we've reached the end
      if (swaps.length < MAX_LIMIT) {
        break;
      }
      
      // Update startTime to continue from last swap
      const lastSwap = swaps[swaps.length - 1];
      currentStartTime = lastSwap.timestamp + 1;
      queryMode = "paginated";
    }

    // Sort by timestamp (aliased queries may return out of order)
    allSwaps.sort((a, b) => a.timestamp - b.timestamp);

    // Trim to max if exceeded
    const result = allSwaps.slice(0, MAX_TOTAL);

    // Store in cache
    cache.set(cacheKey, { timestamp: Date.now(), swaps: result });

    // Prune old cache entries occasionally
    if (cache.size > 50 && Math.random() < 0.1) {
      const now = Date.now();
      for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS * 2) {
          cache.delete(key);
        }
      }
    }

    const durationMs = Date.now() - startMs;
    console.log(`[api/lp-swaps] Fetched ${result.length} swaps in ${durationMs}ms (mode: ${queryMode})`);

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Cache": "MISS",
        "X-Fetch-Duration-Ms": String(durationMs),
        "X-Swap-Count": String(result.length),
        "X-Query-Mode": queryMode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/lp-swaps] Failed to fetch swaps", { message, pool });
    return NextResponse.json({ error: "Failed to fetch swap data" }, { status: 502 });
  }
}
