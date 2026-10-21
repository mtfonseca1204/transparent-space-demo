/**
 * Arb Volume Classification API
 *
 * For each Kraken pool, fetches on-chain swaps from the Solana indexer and
 * compares against Hyperliquid 1-minute candle closes to classify swaps as
 * "arb" (moved pool price toward HL) or "organic".
 *
 * Query params:
 *   days     – lookback window (default 1, max 10)
 *   asset    – optional filter by token0 symbol (e.g. "TSLAx")
 *   pool     – optional filter by pool address
 *
 * Returns JSON grouped by asset → pool with arb volume, total volume,
 * arb percentage, and swap counts.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchAllSolanaPages,
  type SolanaSwapResponse,
} from "@/lib/solana-indexer-client";
import { sqrtPriceX64ToPrice } from "@/lib/raydium-math";
import { sqrtPriceX96ToPrice } from "@/lib/envio-client";
import {
  SUPPORTED_POOLS,
  SOLANA_POOL_METADATA_BY_ADDRESS,
  ZEROG_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
  BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
} from "@/lib/pools";
import { fetchRailwayEntityPaginated } from "@/lib/worldchain-indexer-client";
import { getIndexedEvmSwapEntity } from "@/lib/evm-v2-pool-support";
import { fetchBinance1mKlines, buildBinanceCloseMap } from "@/lib/binance-klines";
import { ZEROG_SPACE_SLUG } from "@/lib/space-policy";
import { getDemoArbVolume, isDemoRequest } from "@/lib/demo/fixtures";

// ---------------------------------------------------------------------------
// HL symbol mapping: token0Symbol → Hyperliquid perp coin
// ---------------------------------------------------------------------------

const HL_COIN_MAP: Record<string, string> = {
  TSLAx: "xyz:TSLA",
  NVDAx: "xyz:NVDA",
  SPYx: "xyz:SPY",
  QQQx: "xyz:QQQ",
  GLDx: "xyz:GLD",
  GOOGLx: "xyz:GOOGL",
  HOODx: "xyz:HOOD",
  CRCLx: "xyz:CRCL",
  METAx: "xyz:META",
  COINx: "xyz:COIN",
};

const HL_API = "https://api.hyperliquid.xyz/info";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HLCandle = { t: number; o: string; h: string; l: string; c: string; v: string };

type PoolArbResult = {
  poolAddress: string;
  poolKey: string;
  venue: string;
  feeBps: number | null;
  totalSwaps: number;
  arbSwaps: number;
  totalVolumeUsd: number;
  arbVolumeUsd: number;
  organicVolumeUsd: number;
  arbPct: number;
};

type AssetArbResult = {
  asset: string;
  hlCoin: string;
  hlCandleCount: number;
  pools: PoolArbResult[];
  totalVolumeUsd: number;
  arbVolumeUsd: number;
  organicVolumeUsd: number;
  arbPct: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function floorToMinuteMs(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

function getVenueLabel(poolKey: string): string {
  const pool = SUPPORTED_POOLS.find((p) => p.poolKey === poolKey);
  if (!pool) return "Unknown";
  if (pool.key.startsWith("byreal-")) return "Byreal";
  if (pool.key.endsWith("-2")) return "Raydium (alt fee)";
  return "Raydium";
}

// ---------------------------------------------------------------------------
// 0G AI (Binance spot reference)
//
// 0G pools live on EVM chains (0G mainnet + BSC), are indexed by the Railway
// REST indexer, and are classified against Binance spot 0G/USDT 1-minute k-line
// closes instead of Hyperliquid perps. Token0 is the 0G asset in every pool. For
// the USDC.e / USDT pools token1 is a USD stable, so the pool price (token1/token0)
// is already USD-per-0G. For the W0G/WETH pool token1 is WETH, so its price is
// WETH-per-0G; we convert it (and the swap notional) to USD via the Binance
// ETHUSDT 1-minute close (`token1RefSymbol`) before comparing to the 0GUSDT ref.
// ---------------------------------------------------------------------------

const ZEROG_BINANCE_SYMBOL = "0GUSDT";

type ZerogArbPool = {
  address: string;
  poolKey: string;
  label: string;
  venue: string;
  token0Decimals: number;
  token1Decimals: number;
  feeBps: number | null;
  /** Binance symbol that prices token1 in USD when token1 is NOT a USD stable
   *  (e.g. "ETHUSDT" for a W0G/WETH pool). Omit/null when token1 is USD. */
  token1RefSymbol?: string | null;
};

const ZEROG_ARB_POOLS: ZerogArbPool[] = [
  {
    address: ZEROG_W0G_USDCE_V3_POOL_KEY,
    poolKey: "zerog-w0g-usdce-v3",
    label: "W0G / USDC.e",
    venue: "0G · Uniswap V3",
    token0Decimals: 18,
    token1Decimals: 6,
    feeBps: 100, // on-chain fee 10000 = 1.00%
  },
  {
    address: ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
    poolKey: "zerog-zia-w0g-usdce-v3",
    label: "Zia W0G / USDC.e",
    venue: "0G · Zia V3",
    token0Decimals: 18,
    token1Decimals: 6,
    feeBps: 100, // on-chain fee 10000 = 1.00%
  },
  {
    address: ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
    poolKey: "zerog-zia-w0g-weth-v3",
    label: "Zia W0G / WETH",
    venue: "0G · Zia V3",
    token0Decimals: 18,
    token1Decimals: 18, // token1 = WETH (priced in USD via ETHUSDT)
    feeBps: 100, // on-chain fee 10000 = 1.00%
    token1RefSymbol: "ETHUSDT",
  },
  {
    address: BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
    poolKey: "pancake-v3-0g-usdt",
    label: "0G / USDT",
    venue: "BSC · PancakeSwap V3",
    token0Decimals: 18,
    token1Decimals: 18,
    feeBps: 1, // on-chain fee 100 = 0.01%
  },
];

type EvmSwapRow = {
  id: string;
  timestamp: number; // seconds
  sqrtPriceX96: string;
  amount0: string;
  amount1: string;
  tick: number;
};

async function fetchEvmPoolSwaps(
  poolAddress: string,
  startTimeSec: number,
  endTimeSec: number,
): Promise<EvmSwapRow[]> {
  const rows = await fetchRailwayEntityPaginated<EvmSwapRow>(
    getIndexedEvmSwapEntity("v3"),
    { pool: poolAddress.toLowerCase(), from: startTimeSec, to: endTimeSec },
    10,
  );
  return rows
    .filter((s) => s.timestamp >= startTimeSec && s.timestamp < endTimeSec)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function classifyEvmPoolArb(
  swaps: EvmSwapRow[],
  refMap: Map<number, number>,
  decimals0: number,
  decimals1: number,
  // USD price of one token1, per minute. `null` ⇒ token1 is a USD stable (=1).
  // Used to convert WETH-quoted pools (price + notional) into USD before the
  // comparison, so they're on the same axis as the 0GUSDT reference.
  quote1UsdMap: Map<number, number> | null,
): { arbSwaps: number; arbVolumeUsd: number; totalVolumeUsd: number; totalSwaps: number } {
  const sorted = [...swaps].sort((a, b) => a.timestamp - b.timestamp);

  let arbSwaps = 0;
  let arbVolumeUsd = 0;
  let totalVolumeUsd = 0;

  const quoteAt = (minuteMs: number): number | undefined =>
    quote1UsdMap ? quote1UsdMap.get(minuteMs) : 1;

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const minuteMs = floorToMinuteMs(curr.timestamp * 1000);
    const q1 = quoteAt(minuteMs);
    // Can't value token1 in USD for this minute (missing ETHUSDT close) — skip.
    if (q1 === undefined || !(q1 > 0)) continue;

    const notionalUsd = (Math.abs(Number(curr.amount1)) / 10 ** decimals1) * q1;
    totalVolumeUsd += notionalUsd;

    if (i === 0) continue; // need a previous swap to compare

    const prev = sorted[i - 1];
    if (!curr.sqrtPriceX96 || !prev.sqrtPriceX96) continue;
    const prevMinuteMs = floorToMinuteMs(prev.timestamp * 1000);
    const q1prev = quoteAt(prevMinuteMs);
    if (q1prev === undefined || !(q1prev > 0)) continue;

    let currPrice: number;
    let prevPrice: number;
    try {
      currPrice = sqrtPriceX96ToPrice(BigInt(curr.sqrtPriceX96), decimals0, decimals1);
      prevPrice = sqrtPriceX96ToPrice(BigInt(prev.sqrtPriceX96), decimals0, decimals1);
    } catch {
      continue;
    }

    if (!Number.isFinite(currPrice) || !Number.isFinite(prevPrice) || prevPrice === 0) continue;

    // Convert pool price (token1 per token0) to USD per token0 so it's on the
    // same axis as the 0GUSDT reference (a no-op for USD-stable pools, q1=1).
    const currPriceUsd = currPrice * q1;
    const prevPriceUsd = prevPrice * q1prev;
    if (prevPriceUsd === 0) continue;

    // Price delta in bps
    const deltaBps = (currPriceUsd / prevPriceUsd - 1) * 10_000;

    // Look up the Binance spot close at curr's minute
    const refPrice = refMap.get(minuteMs);
    if (refPrice === undefined) continue;

    // Gap before and after the swap
    const gapBefore = refPrice - prevPriceUsd;
    const gapAfter = refPrice - currPriceUsd;

    // Classify: arb if swap moved pool TOWARD the reference AND meaningful move
    const isArb = Math.abs(gapAfter) < Math.abs(gapBefore) && Math.abs(deltaBps) >= 2;

    if (isArb) {
      arbSwaps++;
      arbVolumeUsd += notionalUsd;
    }
  }

  return { arbSwaps, arbVolumeUsd, totalVolumeUsd, totalSwaps: sorted.length };
}

async function handleZerogArbVolume(args: {
  days: number;
  startMs: number;
  endMs: number;
  startSec: number;
  endSec: number;
  assetFilter: string | null;
  poolFilter: string | null;
}): Promise<NextResponse> {
  const { days, startMs, endMs, startSec, endSec, assetFilter, poolFilter } = args;

  const pools = ZEROG_ARB_POOLS.filter(
    (p) => !poolFilter || p.address.toLowerCase() === poolFilter.toLowerCase(),
  );

  // Binance spot 0G/USDT reference candles
  let refMap = new Map<number, number>();
  let candleCount = 0;
  try {
    const klines = await fetchBinance1mKlines(ZEROG_BINANCE_SYMBOL, startMs, endMs);
    refMap = buildBinanceCloseMap(klines);
    candleCount = klines.length;
  } catch {
    refMap = new Map();
    candleCount = 0;
  }

  // USD reference for any non-stable quote token (e.g. WETH → ETHUSDT), so those
  // pools' price + notional can be converted to USD like the stable pools.
  const quoteRefMaps = new Map<string, Map<number, number>>();
  const quoteSymbols = new Set(
    pools.map((p) => p.token1RefSymbol).filter((s): s is string => !!s),
  );
  for (const sym of quoteSymbols) {
    try {
      const k = await fetchBinance1mKlines(sym, startMs, endMs);
      quoteRefMaps.set(sym, buildBinanceCloseMap(k));
    } catch {
      quoteRefMaps.set(sym, new Map());
    }
  }

  const poolResults: PoolArbResult[] = [];
  for (const pool of pools) {
    let swaps: EvmSwapRow[];
    try {
      swaps = await fetchEvmPoolSwaps(pool.address, startSec, endSec);
    } catch {
      swaps = [];
    }

    const quote1UsdMap = pool.token1RefSymbol
      ? quoteRefMaps.get(pool.token1RefSymbol) ?? new Map<number, number>()
      : null;
    const { arbSwaps, arbVolumeUsd, totalVolumeUsd, totalSwaps } = classifyEvmPoolArb(
      swaps,
      refMap,
      pool.token0Decimals,
      pool.token1Decimals,
      quote1UsdMap,
    );

    poolResults.push({
      poolAddress: pool.address,
      poolKey: pool.poolKey,
      venue: pool.venue,
      feeBps: pool.feeBps,
      totalSwaps,
      arbSwaps,
      totalVolumeUsd: Math.round(totalVolumeUsd * 100) / 100,
      arbVolumeUsd: Math.round(arbVolumeUsd * 100) / 100,
      organicVolumeUsd: Math.round((totalVolumeUsd - arbVolumeUsd) * 100) / 100,
      arbPct: totalVolumeUsd > 0 ? Math.round((arbVolumeUsd / totalVolumeUsd) * 10000) / 100 : 0,
    });
  }

  const assetTotalVol = poolResults.reduce((s, p) => s + p.totalVolumeUsd, 0);
  const assetArbVol = poolResults.reduce((s, p) => s + p.arbVolumeUsd, 0);

  const asset: AssetArbResult = {
    asset: assetFilter || "0G",
    hlCoin: ZEROG_BINANCE_SYMBOL,
    hlCandleCount: candleCount,
    pools: poolResults,
    totalVolumeUsd: Math.round(assetTotalVol * 100) / 100,
    arbVolumeUsd: Math.round(assetArbVol * 100) / 100,
    organicVolumeUsd: Math.round((assetTotalVol - assetArbVol) * 100) / 100,
    arbPct: assetTotalVol > 0 ? Math.round((assetArbVol / assetTotalVol) * 10000) / 100 : 0,
  };

  return NextResponse.json({
    meta: {
      days,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      assetFilter,
      poolFilter,
      totalAssets: 1,
      totalPools: poolResults.length,
    },
    summary: {
      totalVolumeUsd: asset.totalVolumeUsd,
      arbVolumeUsd: asset.arbVolumeUsd,
      organicVolumeUsd: asset.organicVolumeUsd,
      arbPct: asset.arbPct,
    },
    assets: [asset],
  });
}

// ---------------------------------------------------------------------------
// Fetch HL 1-minute candles (chunks at ~12h per request)
// ---------------------------------------------------------------------------

async function fetchHLCandles(
  coin: string,
  startMs: number,
  endMs: number,
): Promise<HLCandle[]> {
  // HL API supports large ranges in a single request — no chunking needed.
  // For very large windows (>10d) we chunk at 7-day intervals to stay safe.
  const CHUNK_MS = 7 * 24 * 60 * 60 * 1000;
  const all: HLCandle[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + CHUNK_MS, endMs);
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin, interval: "1m", startTime: cursor, endTime: chunkEnd },
      }),
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) return [];
      throw new Error(`HL HTTP ${res.status} for ${coin}`);
    }
    const data: HLCandle[] = await res.json();
    if (data.length) {
      all.push(...data);
    }
    // Always advance cursor — don't break on empty chunks (market closed gaps)
    cursor = chunkEnd + 1;
  }

  return all;
}

function buildHLMap(candles: HLCandle[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const c of candles) {
    map.set(c.t, parseFloat(c.c));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fetch swaps for a pool from the Solana indexer
// ---------------------------------------------------------------------------

async function fetchPoolSwaps(
  poolAddress: string,
  startTimeSec: number,
  endTimeSec: number,
): Promise<SolanaSwapResponse[]> {
  return fetchAllSolanaPages<SolanaSwapResponse>("/api/swaps", {
    pool: poolAddress,
    start_time: startTimeSec,
    end_time: endTimeSec,
  }, { pageLimit: 1000, maxPages: 50 });
}

// ---------------------------------------------------------------------------
// Classify swaps for a single pool
// ---------------------------------------------------------------------------

function classifyPoolArb(
  swaps: SolanaSwapResponse[],
  hlMap: Map<number, number>,
  decimals0: number,
  decimals1: number,
): { arbSwaps: number; arbVolumeUsd: number; totalVolumeUsd: number; totalSwaps: number } {
  // Sort swaps by block_time ASC
  const sorted = [...swaps].sort((a, b) => {
    const ta = new Date(a.block_time ?? a.timestamp ?? 0).getTime();
    const tb = new Date(b.block_time ?? b.timestamp ?? 0).getTime();
    return ta - tb;
  });

  let arbSwaps = 0;
  let arbVolumeUsd = 0;
  let totalVolumeUsd = 0;

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const tsMs = new Date(curr.block_time ?? curr.timestamp ?? 0).getTime();
    const notionalUsd = Math.abs(Number(curr.amount1)) / 10 ** decimals1;
    totalVolumeUsd += notionalUsd;

    if (i === 0) continue; // need a previous swap to compare

    const prev = sorted[i - 1];

    // Compute pool prices from sqrt_price_x64
    const currSqrt = curr.sqrt_price_x64;
    const prevSqrt = prev.sqrt_price_x64;
    if (!currSqrt || !prevSqrt) continue;

    const currPrice = sqrtPriceX64ToPrice(
      BigInt(Math.trunc(Number(currSqrt))),
      decimals0,
      decimals1,
    );
    const prevPrice = sqrtPriceX64ToPrice(
      BigInt(Math.trunc(Number(prevSqrt))),
      decimals0,
      decimals1,
    );

    if (!Number.isFinite(currPrice) || !Number.isFinite(prevPrice) || prevPrice === 0) continue;

    // Price delta in bps
    const deltaBps = ((currPrice / prevPrice) - 1) * 10_000;

    // Look up HL close at curr's minute
    const minuteMs = floorToMinuteMs(tsMs);
    const hlPrice = hlMap.get(minuteMs);
    if (hlPrice === undefined) continue;

    // Gap before and after the swap
    const gapBefore = hlPrice - prevPrice;
    const gapAfter = hlPrice - currPrice;

    // Classify: arb if swap moved pool TOWARD HL AND meaningful price move
    const isArb = Math.abs(gapAfter) < Math.abs(gapBefore) && Math.abs(deltaBps) >= 2;

    if (isArb) {
      arbSwaps++;
      arbVolumeUsd += notionalUsd;
    }
  }

  return { arbSwaps, arbVolumeUsd, totalVolumeUsd, totalSwaps: sorted.length };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(params.get("days")) || 1, 1), 10);
  const assetFilter = params.get("asset") ?? null;
  const poolFilter = params.get("pool") ?? null;

  if (isDemoRequest(req, poolFilter)) {
    return NextResponse.json(getDemoArbVolume(), {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "X-Source": "demo-fixture",
      },
    });
  }

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);

  // 0G AI: EVM pools classified against Binance spot 0G/USDT k-line closes.
  if (params.get("space") === ZEROG_SPACE_SLUG) {
    return handleZerogArbVolume({
      days,
      startMs,
      endMs,
      startSec,
      endSec,
      assetFilter,
      poolFilter,
    });
  }

  // Gather all Kraken Solana pools
  const krakenPools = SUPPORTED_POOLS.filter(
    (p) => p.spaceSlug === "kraken" && p.chain === "solana",
  );

  // Group pools by asset (token0Symbol)
  const poolsByAsset = new Map<string, typeof krakenPools>();
  for (const pool of krakenPools) {
    const meta = SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey];
    if (!meta) continue;
    const asset = meta.token0Symbol;

    if (assetFilter && asset !== assetFilter) continue;
    if (poolFilter && pool.poolKey !== poolFilter) continue;

    if (!poolsByAsset.has(asset)) poolsByAsset.set(asset, []);
    poolsByAsset.get(asset)!.push(pool);
  }

  const results: AssetArbResult[] = [];

  // Process each asset
  for (const [asset, pools] of poolsByAsset) {
    const hlCoin = HL_COIN_MAP[asset];
    if (!hlCoin) {
      results.push({
        asset,
        hlCoin: "N/A",
        hlCandleCount: 0,
        pools: pools.map((p) => {
          const meta = SOLANA_POOL_METADATA_BY_ADDRESS[p.poolKey];
          return {
            poolAddress: p.poolKey,
            poolKey: p.key,
            venue: getVenueLabel(p.poolKey),
            feeBps: meta?.fee ?? null,
            totalSwaps: 0,
            arbSwaps: 0,
            totalVolumeUsd: 0,
            arbVolumeUsd: 0,
            organicVolumeUsd: 0,
            arbPct: 0,
          };
        }),
        totalVolumeUsd: 0,
        arbVolumeUsd: 0,
        organicVolumeUsd: 0,
        arbPct: 0,
      });
      continue;
    }

    // Fetch HL candles for this asset
    let hlCandles: HLCandle[];
    try {
      hlCandles = await fetchHLCandles(hlCoin, startMs, endMs);
    } catch {
      hlCandles = [];
    }
    const hlMap = buildHLMap(hlCandles);

    const poolResults: PoolArbResult[] = [];

    // Process each pool for this asset
    for (const pool of pools) {
      const meta = SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey];
      if (!meta) continue;

      let swaps: SolanaSwapResponse[];
      try {
        swaps = await fetchPoolSwaps(pool.poolKey, startSec, endSec);
      } catch {
        swaps = [];
      }

      const { arbSwaps, arbVolumeUsd, totalVolumeUsd, totalSwaps } =
        hlMap.size > 0
          ? classifyPoolArb(swaps, hlMap, meta.token0Decimals, meta.token1Decimals)
          : { arbSwaps: 0, arbVolumeUsd: 0, totalVolumeUsd: swaps.reduce((s, sw) => s + Math.abs(Number(sw.amount1)) / 10 ** meta.token1Decimals, 0), totalSwaps: swaps.length };

      poolResults.push({
        poolAddress: pool.poolKey,
        poolKey: pool.key,
        venue: getVenueLabel(pool.poolKey),
        feeBps: meta.fee ?? null,
        totalSwaps,
        arbSwaps,
        totalVolumeUsd: Math.round(totalVolumeUsd * 100) / 100,
        arbVolumeUsd: Math.round(arbVolumeUsd * 100) / 100,
        organicVolumeUsd: Math.round((totalVolumeUsd - arbVolumeUsd) * 100) / 100,
        arbPct: totalVolumeUsd > 0 ? Math.round((arbVolumeUsd / totalVolumeUsd) * 10000) / 100 : 0,
      });
    }

    const assetTotalVol = poolResults.reduce((s, p) => s + p.totalVolumeUsd, 0);
    const assetArbVol = poolResults.reduce((s, p) => s + p.arbVolumeUsd, 0);

    results.push({
      asset,
      hlCoin,
      hlCandleCount: hlCandles.length,
      pools: poolResults,
      totalVolumeUsd: Math.round(assetTotalVol * 100) / 100,
      arbVolumeUsd: Math.round(assetArbVol * 100) / 100,
      organicVolumeUsd: Math.round((assetTotalVol - assetArbVol) * 100) / 100,
      arbPct: assetTotalVol > 0 ? Math.round((assetArbVol / assetTotalVol) * 10000) / 100 : 0,
    });
  }

  // Sort by asset name
  results.sort((a, b) => a.asset.localeCompare(b.asset));

  // Compute totals
  const grandTotalVol = results.reduce((s, r) => s + r.totalVolumeUsd, 0);
  const grandArbVol = results.reduce((s, r) => s + r.arbVolumeUsd, 0);

  return NextResponse.json({
    meta: {
      days,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      assetFilter,
      poolFilter,
      totalAssets: results.length,
      totalPools: results.reduce((s, r) => s + r.pools.length, 0),
    },
    summary: {
      totalVolumeUsd: Math.round(grandTotalVol * 100) / 100,
      arbVolumeUsd: Math.round(grandArbVol * 100) / 100,
      organicVolumeUsd: Math.round((grandTotalVol - grandArbVol) * 100) / 100,
      arbPct: grandTotalVol > 0 ? Math.round((grandArbVol / grandTotalVol) * 10000) / 100 : 0,
    },
    assets: results,
  });
}
