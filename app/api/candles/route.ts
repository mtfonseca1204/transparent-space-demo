import { NextRequest, NextResponse } from "next/server";
import { GraphQLClient } from "graphql-request";
import { isAddress } from "viem";
import { isSolanaPool } from "@/lib/pools";
import { fetchAllSolanaPages, fetchSolanaApi, type SolanaCandleResponse } from "@/lib/solana-indexer-client";
import { fetchWorldchainCandles, isWorldchainIndexerPool } from "@/lib/worldchain-indexer-client";
import { getDemoCandles, isDemoRequest, resolveDemoPoolKey } from "@/lib/demo/fixtures";

// =============================================================================
// /api/candles - Now uses pre-computed PoolCandle entity from the indexer
// Supports multiple intervals: 5m, 15m, 1h, 4h, 1d
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

// Output format (backwards compatible)
type CandleData = {
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
};

// New PoolCandle entity from the indexer
type PoolCandleData = {
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
};

// Map interval seconds to string format used by PoolCandle
const INTERVAL_MAP: Record<number, string> = {
  300: "5m",
  900: "15m",
  3600: "1h",
  14400: "4h",
  86400: "1d",
};

// Query for PoolCandle (pre-computed, multi-interval)
const GET_POOL_CANDLES_QUERY = `
  query GetPoolCandles($pool: String!, $interval: String!, $startTime: Int!, $endTime: Int!, $limit: Int!) {
    poolCandles(
      where: {
        pool: $pool
        interval: $interval
        timestamp_gte: $startTime
        timestamp_lt: $endTime
      }
      orderBy: timestamp
      orderDirection: asc
      first: $limit
    ) {
      id
      pool
      interval
      timestamp
      sqrtPriceX96Open
      sqrtPriceX96Close
      sqrtPriceX96High
      sqrtPriceX96Low
      volumeToken0
      volumeToken1
      swapCount
    }
  }
`;

const GET_LATEST_POOL_CANDLE_QUERY = `
  query GetLatestPoolCandle($pool: String!, $interval: String!) {
    poolCandles(
      where: { pool: $pool, interval: $interval }
      orderBy: timestamp
      orderDirection: desc
      first: 1
    ) {
      timestamp
      sqrtPriceX96Close
    }
  }
`;

// PoolCandle fields fragment for aliased queries
const POOL_CANDLE_FIELDS = `
  id
  pool
  interval
  timestamp
  sqrtPriceX96Open
  sqrtPriceX96Close
  sqrtPriceX96High
  sqrtPriceX96Low
  volumeToken0
  volumeToken1
  swapCount
`;

// Convert PoolCandle to backwards-compatible CandleData format
function convertToLegacyFormat(candle: PoolCandleData, intervalSeconds: number): CandleData {
  return {
    id: candle.id,
    pool: candle.pool,
    interval: intervalSeconds,
    timestamp: candle.timestamp,
    openPrice: candle.sqrtPriceX96Open,
    highPrice: candle.sqrtPriceX96High,
    lowPrice: candle.sqrtPriceX96Low,
    closePrice: candle.sqrtPriceX96Close,
    volume0: candle.volumeToken0,
    volume1: candle.volumeToken1,
    txCount: candle.swapCount,
  };
}

function resolveEnvioEndpoint(): string {
  return (
    process.env.ENVIO_GRAPHQL_ENDPOINT ||
    process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT ||
    "http://localhost:8080/v1/graphql"
  );
}

interface TimeChunk {
  startTime: number;
  endTime: number;
}

// Server-side cache
interface CachedCandles {
  timestamp: number;
  candles: CandleData[];
}
const cache = new Map<string, CachedCandles>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const RAILWAY_CANDLE_CACHE_TTL_MS = 5 * 60 * 1000;
const RAILWAY_CANDLE_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=900";
const IS_DEV = process.env.NODE_ENV !== "production";

// Split time range into chunks
function createTimeChunks(startTime: number, endTime: number, chunkCount: number): TimeChunk[] {
  const totalDuration = endTime - startTime;
  const chunkDuration = Math.ceil(totalDuration / chunkCount);
  const chunks: TimeChunk[] = [];
  
  let current = startTime;
  while (current < endTime) {
    const chunkEnd = Math.min(current + chunkDuration, endTime);
    chunks.push({ startTime: current, endTime: chunkEnd });
    current = chunkEnd;
  }
  
  return chunks;
}

// Build aliased query for multiple chunks - ONE HTTP request instead of N
function buildAliasedQuery(pool: string, intervalStr: string, chunks: TimeChunk[], limit: number): string {
  const aliasedQueries = chunks.map((chunk, i) => `
    chunk${i}: poolCandles(
      where: {
        pool: "${pool}"
        interval: "${intervalStr}"
        timestamp_gte: ${chunk.startTime}
        timestamp_lt: ${chunk.endTime}
      }
      orderBy: timestamp
      orderDirection: asc
      first: ${limit}
    ) {
      ${POOL_CANDLE_FIELDS}
    }
  `).join('\n');

  return `query AliasedPoolCandles { ${aliasedQueries} }`;
}

export async function GET(request: NextRequest) {
  const startMs = Date.now();

  const poolRaw = request.nextUrl.searchParams.get("pool") ?? "";
  // Solana base58 keys are case-sensitive; only lowercase EVM keys
  const pool = isSolanaPool(poolRaw) ? poolRaw.trim() : poolRaw.toLowerCase();
  const intervalSeconds = Number(request.nextUrl.searchParams.get("interval")) || 300;
  const startTime = Number(request.nextUrl.searchParams.get("startTime")) || 0;
  const endTime = Number(request.nextUrl.searchParams.get("endTime")) || Math.floor(Date.now() / 1000);
  const isSolana = isSolanaPool(pool);

  if (isDemoRequest(request, pool)) {
    return NextResponse.json(
      getDemoCandles({ poolKey: resolveDemoPoolKey(pool), intervalSeconds, startTime, endTime }),
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Source": "demo-fixture",
        },
      }
    );
  }

  if (!pool || !isValidPoolKey(pool)) {
    return NextResponse.json({ error: "Missing or invalid pool key" }, { status: 400 });
  }

  if (!isSolana && (!startTime || startTime >= endTime)) {
    return NextResponse.json({ error: "Invalid time range" }, { status: 400 });
  }

  // Map interval to string format (PoolCandle uses "5m", "15m", etc.)
  const intervalStr = INTERVAL_MAP[intervalSeconds] ?? "5m";
  // Solana callers frequently vary by seconds; bucket keys by candle interval for better cache reuse.
  const intervalBucket = Math.max(300, intervalSeconds);

  // ── Raydium / Solana pool — proxy to Railway API ──
  if (isSolana) {
    const roundedStartTime = Math.floor(startTime / intervalBucket) * intervalBucket;
    const roundedEndTime = Math.floor(endTime / intervalBucket) * intervalBucket;
    const cacheKey = `${pool}-${intervalStr}-${roundedStartTime}-${roundedEndTime}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(cached.candles, {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
          "X-Cache": "HIT",
          "X-Source": "railway",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Candle-Count": String(cached.candles.length),
          "X-Interval": intervalStr,
        },
      });
    }

    try {
      if (IS_DEV) {
        console.log(
          `[api/candles][solana] upstream query -> pool=${pool} resolution=${intervalStr} start_time=${startTime} end_time=${endTime}`
        );
      }
      const chartCandles = await fetchSolanaApi<{
        series?: Array<{
          pool?: string;
          timestamp: number | string;
          open: string | number;
          high: string | number;
          low: string | number;
          close: string | number;
          volume_token0?: string | number;
          volume_token1?: string | number;
          tx_count?: number | string;
        }>;
      }>(
        "/api/charts/candles",
        {
          pool,
          resolution: intervalStr,
          start_time: startTime,
          end_time: endTime,
          max_points: 5000,
        },
      );
      const raw = chartCandles.series ?? [];
      if (IS_DEV) {
        console.log(
          `[api/candles][solana] upstream response <- rows=${raw.length} pool=${pool} resolution=${intervalStr} start_time=${startTime} end_time=${endTime}`
        );
      }

      const candles: CandleData[] = raw.map((c) => {
        const ts = Number(c.timestamp);
        const openP = Number(c.open ?? 0);
        const highP = Number(c.high ?? 0);
        const lowP = Number(c.low ?? 0);
        const closeP = Number(c.close ?? 0);

        return {
          id: `raydium-${intervalStr}-${ts}`,
          pool: c.pool ?? pool,
          interval: intervalSeconds,
          timestamp: ts,
          openPrice: String(openP),
          highPrice: String(highP),
          lowPrice: String(lowP),
          closePrice: String(closeP),
          volume0: String(c.volume_token0 ?? "0"),
          volume1: String(c.volume_token1 ?? "0"),
          txCount: Number(c.tx_count ?? 0),
        };
      }).filter((c) => c.pool === pool && c.timestamp >= startTime && c.timestamp < endTime);

      // Railway returns newest-first; sort ascending for chart consumption
      candles.sort((a, b) => a.timestamp - b.timestamp);
      cache.set(cacheKey, { timestamp: Date.now(), candles });

      const durationMs = Date.now() - startMs;
      if (IS_DEV) {
        console.log(`[api/candles] Raydium: ${candles.length} candles in ${durationMs}ms`);
      }
      return NextResponse.json(candles, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
          "X-Cache": "MISS",
          "X-Source": "railway",
          "X-Candle-Count": String(candles.length),
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Upstream-Start-Time": String(startTime),
          "X-Upstream-End-Time": String(endTime),
          "X-Upstream-Resolution": intervalStr,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        // Fallback to raw hourly candles endpoint when charts API fails under load.
        const fallbackRaw = await fetchAllSolanaPages<SolanaCandleResponse>(
          "/api/candles",
          {
            pool,
            interval: intervalStr,
            start_time: startTime,
            end_time: endTime,
          },
          { pageLimit: 500, maxPages: 6 }
        );
        const fallbackCandles: CandleData[] = fallbackRaw
          .map((c) => {
            const rawTs = c.open_time ?? c.timestamp;
            const ts = typeof rawTs === "string"
              ? Math.floor(new Date(rawTs).getTime() / 1000)
              : Number(rawTs);
            return {
              id: String(c.id ?? `raydium-${intervalStr}-${ts}`),
              pool,
              interval: intervalSeconds,
              timestamp: ts,
              openPrice: String(c.price_open ?? c.open_price ?? 0),
              highPrice: String(c.price_high ?? c.high_price ?? 0),
              lowPrice: String(c.price_low ?? c.low_price ?? 0),
              closePrice: String(c.price_close ?? c.close_price ?? 0),
              volume0: String(c.volume_token0 ?? "0"),
              volume1: String(c.volume_token1 ?? "0"),
              txCount: Number(c.swap_count ?? c.tx_count ?? 0),
            };
          })
          .filter((c) => Number.isFinite(c.timestamp) && c.timestamp >= startTime && c.timestamp < endTime)
          .sort((a, b) => a.timestamp - b.timestamp);
        cache.set(cacheKey, { timestamp: Date.now(), candles: fallbackCandles });
        const durationMs = Date.now() - startMs;
        return NextResponse.json(fallbackCandles, {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
            "X-Cache": "MISS",
            "X-Source": "railway-fallback",
            "X-Candle-Count": String(fallbackCandles.length),
            "X-Fetch-Duration-Ms": String(durationMs),
            "X-Interval": intervalStr,
          },
        });
      } catch {
        // Continue to stale/502 handling.
      }
      const stale = cache.get(cacheKey);
      if (stale) {
        const durationMs = Date.now() - startMs;
        return NextResponse.json(stale.candles, {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
            "X-Cache": "STALE",
            "X-Source": "railway",
            "X-Fetch-Duration-Ms": String(durationMs),
            "X-Candle-Count": String(stale.candles.length),
            "X-Interval": intervalStr,
          },
        });
      }
      console.error("[api/candles] Raydium fetch failed", {
        message,
        pool,
        interval: intervalStr,
        startTime,
        endTime,
      });
      const durationMs = Date.now() - startMs;
      return NextResponse.json([], {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "X-Cache": "DEGRADED",
          "X-Source": "railway",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Candle-Count": "0",
          "X-Interval": intervalStr,
        },
      });
    }
  }

  // ── Worldchain pools — fetch from the Worldchain REST indexer ──
  if (isWorldchainIndexerPool(pool)) {
    // Check cache first (shared with legacy GraphQL path)
    const cacheKey = `${pool}-${intervalStr}-${startTime}-${endTime}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RAILWAY_CANDLE_CACHE_TTL_MS) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(cached.candles, {
        headers: {
          "Cache-Control": RAILWAY_CANDLE_CACHE_CONTROL,
          "X-Cache": "HIT",
          "X-Source": "railway-worldchain",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Candle-Count": String(cached.candles.length),
        },
      });
    }

    try {
      const railwayCandles = await fetchWorldchainCandles(pool, intervalStr, startTime, endTime);

      const allCandles: CandleData[] = railwayCandles.map((c) =>
        convertToLegacyFormat(c as unknown as PoolCandleData, intervalSeconds)
      );

      // Sort ascending by timestamp and deduplicate (Railway may return dupes)
      allCandles.sort((a, b) => a.timestamp - b.timestamp);
      const deduped = allCandles.filter(
        (c, i) => i === 0 || c.timestamp !== allCandles[i - 1].timestamp
      );

      // Store in cache
      cache.set(cacheKey, { timestamp: Date.now(), candles: deduped });

      const durationMs = Date.now() - startMs;
      if (IS_DEV) {
        console.log(`[api/candles] Railway Worldchain: ${deduped.length} candles in ${durationMs}ms (interval: ${intervalStr})`);
      }

      return NextResponse.json(deduped, {
        headers: {
          "Cache-Control": RAILWAY_CANDLE_CACHE_CONTROL,
          "X-Cache": "MISS",
          "X-Source": "railway-worldchain",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Candle-Count": String(deduped.length),
          "X-Interval": intervalStr,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stale = cache.get(cacheKey);
      if (stale) {
        const durationMs = Date.now() - startMs;
        return NextResponse.json(stale.candles, {
          headers: {
            "Cache-Control": RAILWAY_CANDLE_CACHE_CONTROL,
            "X-Cache": "STALE",
            "X-Source": "railway-worldchain",
            "X-Fetch-Duration-Ms": String(durationMs),
            "X-Candle-Count": String(stale.candles.length),
            "X-Interval": intervalStr,
          },
        });
      }
      console.error("[api/candles] Railway Worldchain fetch failed", {
        message,
        pool,
        interval: intervalStr,
        startTime,
        endTime,
      });
      return NextResponse.json(
        { error: "Failed to fetch Railway Worldchain candles", details: message },
        { status: 502 }
      );
    }
  }

  // ── EVM pools — existing Envio GraphQL logic ──

  // Check cache
  const cacheKey = `${pool}-${intervalStr}-${startTime}-${endTime}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const durationMs = Date.now() - startMs;
    return NextResponse.json(cached.candles, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        "X-Cache": "HIT",
        "X-Fetch-Duration-Ms": String(durationMs),
        "X-Candle-Count": String(cached.candles.length),
      },
    });
  }

  try {
    const client = new GraphQLClient(resolveEnvioEndpoint());

    // Legacy GraphQL has a max limit of 1000 per query
    const MAX_LIMIT = 1000;
    
    const allPoolCandles: PoolCandleData[] = [];
    let queryMode = "single";

    // Single paginated query approach
    let hasMore = true;
    let currentStartTime = startTime; // Use local variable for pagination
    let pageCount = 0;
    
    while (hasMore && allPoolCandles.length < 10000) { // Safety cap
      const response = await client.request<{ poolCandles: PoolCandleData[] }>(
        GET_POOL_CANDLES_QUERY,
        { pool, interval: intervalStr, startTime: currentStartTime, endTime, limit: MAX_LIMIT }
      );
      
      const candles = response.poolCandles ?? [];
      allPoolCandles.push(...candles);
      pageCount++;
      
      // If we got less than the limit, we've reached the end
      if (candles.length < MAX_LIMIT) {
        hasMore = false;
      } else {
        // Update startTime to continue from last candle
        const lastCandle = candles[candles.length - 1];
        currentStartTime = lastCandle.timestamp + 1; // Next timestamp
      }
      
      queryMode = pageCount > 1 ? `paginated-${pageCount}` : "single";
    }

    // Sort by timestamp (aliased queries may return out of order)
    allPoolCandles.sort((a, b) => a.timestamp - b.timestamp);

    // Convert to backwards-compatible format
    const allCandles = allPoolCandles.map(c => convertToLegacyFormat(c, intervalSeconds));

    // If no candles found, try to generate synthetic candles from latest known price
    if (allCandles.length === 0) {
      const latest = await client.request<{ poolCandles: Array<{ timestamp: number; sqrtPriceX96Close: string }> }>(
        GET_LATEST_POOL_CANDLE_QUERY,
        { pool, interval: intervalStr }
      );
      const last = latest.poolCandles?.[0];
      
      if (last) {
        const synthetic: CandleData[] = [];
        for (let ts = startTime; ts <= endTime; ts += intervalSeconds) {
          synthetic.push({
            id: `synthetic-${pool}-${intervalSeconds}-${ts}`,
            pool,
            interval: intervalSeconds,
            timestamp: ts,
            openPrice: last.sqrtPriceX96Close,
            highPrice: last.sqrtPriceX96Close,
            lowPrice: last.sqrtPriceX96Close,
            closePrice: last.sqrtPriceX96Close,
            volume0: "0",
            volume1: "0",
            txCount: 0,
          });
        }
        
        const durationMs = Date.now() - startMs;
        if (IS_DEV) {
          console.log(`[api/candles] Generated ${synthetic.length} synthetic candles in ${durationMs}ms`);
        }
        
        return NextResponse.json(synthetic, {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
            "X-Synthetic": "true",
            "X-Fetch-Duration-Ms": String(durationMs),
          },
        });
      }
    }

    // Store in cache
    cache.set(cacheKey, { timestamp: Date.now(), candles: allCandles });

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
    if (IS_DEV) {
      console.log(`[api/candles] Fetched ${allCandles.length} candles in ${durationMs}ms (mode: ${queryMode}, interval: ${intervalStr})`);
    }

    return NextResponse.json(allCandles, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
        "X-Cache": "MISS",
        "X-Fetch-Duration-Ms": String(durationMs),
        "X-Candle-Count": String(allCandles.length),
        "X-Query-Mode": queryMode,
        "X-Interval": intervalStr,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stale = cache.get(cacheKey);
    if (stale) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json(stale.candles, {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
          "X-Cache": "STALE",
          "X-Fetch-Duration-Ms": String(durationMs),
          "X-Candle-Count": String(stale.candles.length),
          "X-Interval": intervalStr,
        },
      });
    }
    console.error("[api/candles] Failed to fetch candles", { message, pool, interval: intervalStr });
    return NextResponse.json({ error: "Failed to fetch candles" }, { status: 502 });
  }
}
