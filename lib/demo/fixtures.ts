import type { PoolData } from "@/app/api/pool/[address]/route";
import type { PoolPricesRpcResponse } from "@/app/api/pool-prices-rpc/route";
import type {
  QuoteActivityApiResponse,
  QuoteActivityBreach,
  QuoteActivityFailureReason,
  QuoteActivityHour,
} from "@/lib/rfq-quote-activity";
import type { RfqProvider } from "@/lib/spread-tiers";
import { getPoolAnalyticsProfile } from "@/lib/pool-analytics";
import {
  getDemoCanonicalPoolKey,
  getDemoSourcePoolKey,
  DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL,
  getPoolsForSpace,
  getSolanaPoolMetadata,
  type SolanaPoolMetadata,
  type SupportedPool,
} from "@/lib/pools";
import { humanPriceToSqrtPriceX96, humanPriceToTick } from "@/lib/raydium-math";
import { getTrackedAsset } from "@/lib/token-utils";
import type { XstocksMakerVolumeResponse } from "@/lib/xstocks-maker-volume-chart";
import { getDemoAssetSymbol, isDemoVisibleAssetSymbol } from "./asset-resolution";
import { DEMO_SPACE_SLUG, isDemoPoolKey, isDemoSpaceSlug } from "./constants";

type DemoRequestLike = {
  nextUrl: URL;
  headers: Headers;
};

type PositionData = {
  id: string;
  tokenId?: string;
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  updatedAt?: number;
};

type OwnerPositions = {
  owner: string;
  positions: PositionData[];
  liquidityTotal: string;
};

type PoolDataResponse = {
  tickLiquidities: unknown[];
  poolHourDatas: Array<{
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
  }>;
  lpevents: Array<{
    id: string;
    owner: string;
    eventType: string;
    timestamp: number;
    liquidityDelta: string;
    amount0: string;
    amount1: string;
    tickLower: string;
    tickUpper: string;
  }>;
  uniswapV3PoolMints: Array<{
    id: string;
    pool: string;
    timestamp: number;
    transactionHash: string;
    tickLower: string;
    tickUpper: string;
    amount: string;
    amount0: string;
    amount1: string;
    owner: string;
    sender?: string;
  }>;
  uniswapV3PoolBurns: Array<{
    id: string;
    pool: string;
    timestamp: number;
    transactionHash: string;
    tickLower: string;
    tickUpper: string;
    amount: string;
    amount0: string;
    amount1: string;
    owner: string;
  }>;
  positions: PositionData[];
  ownerAggregates: Array<{
    id: string;
    pool: string;
    owner: string;
    liquidityTotal: string;
    updatedAt: number;
  }>;
  lpActivitySeries: Array<{
    timestamp: number;
    depth_band_buy: number;
    depth_band_sell: number;
  }>;
  meta: {
    source: "demo-fixture";
    partial: false;
  };
};

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

type PoolNetFlowResponse = {
  days: Array<{
    day: string;
    buyUsd: number;
    sellUsd: number;
    netUsd: number;
    swapCount: number;
  }>;
  pools: Array<{
    poolKey: string;
    label: string;
    asset: string | null;
    swapCount: number;
    buyUsd: number;
    sellUsd: number;
    netUsd: number;
  }>;
  totals: { buyUsd: number; sellUsd: number; netUsd: number; swapCount: number };
  meta: {
    spaceSlug: string;
    range: string;
    days: number | null;
    source: "timescale";
    sourceDetail: "daily";
    fallbackReason: null;
    isPartial: false;
    poolCount: number;
    indexedPoolCount: number;
    skippedPools: [];
    requestedStartDate: string | null;
    requestedEndDate: string | null;
    startDate: string | null;
    endDate: string | null;
    demo: true;
  };
};

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const DEMO_NOW = Date.UTC(2026, 4, 8, 16, 0, 0);
const DEMO_NOW_SEC = Math.floor(DEMO_NOW / 1000);
const DEMO_OWNER_A = "8xQhYtY4WQmN7pR3sV6aB9cD2fG5kL8nP1rT4vX7zM2";
const DEMO_OWNER_B = "5mN8pQ2rT6vX9zB3cD7fG1kL4sV8aY2hW6jP9qR3t";
const DEMO_OWNER_C = "2rT5vX8zB1cD4fG7kL2sV5aY8hW1jP4qR7tM3nN6";

const DEMO_ASSET_PRICES: Record<string, number> = Object.fromEntries(
  Object.values(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL).map((config) => [
    config.symbol,
    config.priceUsd,
  ]),
);
const DEFAULT_DEMO_ASSET = DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol;

function resolveDemoFixtureAsset(asset?: string | null): string | null {
  return getDemoAssetSymbol(asset);
}

function resolveDemoFixtureAssets(assets?: string[] | null): string[] {
  if (!assets?.length) return Object.keys(DEMO_ASSET_PRICES);
  return assets
    .map((asset) => resolveDemoFixtureAsset(asset))
    .filter((asset): asset is string => Boolean(asset));
}

function getDemoAssetFromPair(pair?: string | null): string {
  const raw = (pair ?? `${DEFAULT_DEMO_ASSET}USD`).trim();
  const asset = raw.replace(/SPVUSD$/i, "").replace(/USD$/i, "");
  return resolveDemoFixtureAsset(asset) ?? DEFAULT_DEMO_ASSET;
}

const PROVIDER_LABELS: Record<string, string> = {
  jupiter: "Jupiter",
  cowswap: "CowSwap",
  bebop: "Bebop",
  "0x": "0x",
  "1inch": "1inch",
  jupz: "JupZ",
  kyberswap: "KyberSwap",
};

function getRefererPathname(headers: Headers): string | null {
  const ref = headers.get("referer");
  if (!ref) return null;
  try {
    return new URL(ref).pathname;
  } catch {
    return null;
  }
}

export function isDemoRequest(
  request: DemoRequestLike,
  poolKey?: string | null
): boolean {
  const params = request.nextUrl.searchParams;
  const pairAsset = params.get("pair")?.replace(/SPVUSD$/i, "").replace(/USD$/i, "");
  const symbolAsset = params.get("symbol");
  const asset = params.get("asset");
  if (isDemoPoolKey(poolKey)) return true;
  if (isDemoSpaceSlug(params.get("space"))) return true;
  if (isDemoSpaceSlug(params.get("spaceSlug"))) return true;
  if (isDemoVisibleAssetSymbol(asset)) return true;
  if (isDemoVisibleAssetSymbol(pairAsset)) return true;
  if (isDemoVisibleAssetSymbol(symbolAsset)) return true;
  if (isDemoPoolKey(params.get("pool"))) return true;
  if ((params.get("pools") ?? "").split(",").some((pool) => isDemoPoolKey(pool))) {
    return true;
  }

  const refererPathname = getRefererPathname(request.headers);
  return refererPathname?.split("/").filter(Boolean)[0] === DEMO_SPACE_SLUG;
}

export function getDemoPools(): SupportedPool[] {
  return getPoolsForSpace(DEMO_SPACE_SLUG);
}

export function getDemoPool(poolKey: string): SupportedPool | undefined {
  return getDemoPools().find((pool) => pool.poolKey === poolKey);
}

export function getDemoPoolSourceKey(poolKey: string): string | undefined {
  return getDemoSourcePoolKey(poolKey);
}

export function resolveDemoPoolKey(poolKey?: string | null): string {
  const raw = poolKey?.trim() ?? "";
  const canonical = getDemoCanonicalPoolKey(raw);
  if (canonical) return canonical;
  const rawLower = raw.toLowerCase();
  const bySource = getDemoPools().find((pool) => {
    const source = getDemoPoolSourceKey(pool.poolKey);
    return source === raw || source?.toLowerCase() === rawLower;
  });
  if (bySource) return bySource.poolKey;
  const fallback = getDemoPools()[0]?.poolKey;
  if (!fallback) throw new Error("No Demo pool fixtures registered");
  return fallback;
}

export function getDemoPoolMetadata(poolKey: string): SolanaPoolMetadata | undefined {
  return getSolanaPoolMetadata(poolKey);
}

function getAssetPrice(asset: string | undefined): number {
  if (!asset) return 100;
  if (asset === "USDC" || asset === "USDT") return 1;
  return DEMO_ASSET_PRICES[asset] ?? 100;
}

function toRawAmount(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  const fixed = amount.toFixed(Math.min(decimals, 8));
  const [whole, fraction = ""] = fixed.split(".");
  const raw = `${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`;
  return raw.replace(/^0+(?=\d)/, "") || "0";
}

function dateKeyFromOffset(daysAgo: number): string {
  const date = new Date(DEMO_NOW);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function labelForPool(pool: SupportedPool): string {
  if (pool.key.startsWith("demo-byreal-")) return "Byreal";
  if (pool.key.includes("-2") || pool.key.includes("-3")) return "Raydium alt";
  return "Raydium";
}

function getPoolIndex(poolKey: string): number {
  return Math.max(0, getDemoPools().findIndex((pool) => pool.poolKey === poolKey));
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDemoPrice(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

type DemoMarketCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
  txCount: number;
};

function getDemoMarketCandles(args: {
  seedKey: string;
  basePrice: number;
  intervalSeconds: number;
  startTime: number;
  endTime: number;
  maxPoints: number;
}): DemoMarketCandle[] {
  const span = Math.max(args.intervalSeconds, args.endTime - args.startTime);
  const pointCount = Math.min(args.maxPoints, Math.max(2, Math.floor(span / args.intervalSeconds)));
  const step = Math.max(args.intervalSeconds, Math.floor(span / pointCount));
  const seed = hashString(`${args.seedKey}:${args.intervalSeconds}:${Math.floor(args.startTime / 86400)}`);
  const random = createSeededRandom(seed);
  const phase = random() * Math.PI * 2;
  const intervalScale = Math.sqrt(Math.max(step, args.intervalSeconds) / 300);
  const volatility = 0.00085 * intervalScale;
  const baseVolume = 18_000 + (seed % 11_000);
  let previousClose = args.basePrice * (1 + (random() - 0.5) * 0.006);

  return Array.from({ length: pointCount }, (_, index) => {
    const timestamp = args.startTime + index * step;
    const open = previousClose;
    const dayProgress = ((timestamp % 86400) + 86400) % 86400 / 86400;
    const sessionShape = 0.9 + Math.sin(dayProgress * Math.PI * 2 - Math.PI / 3) * 0.12;
    const rhythm =
      Math.sin(index / 29 + phase) * volatility * 0.22 +
      Math.sin(index / 73 + phase * 0.37) * volatility * 0.14;
    const meanReversion = ((args.basePrice - open) / args.basePrice) * 0.075;
    const shock = (random() - 0.5) * volatility * 2.1;
    const close = clampNumber(
      open * (1 + rhythm + meanReversion + shock),
      args.basePrice * 0.955,
      args.basePrice * 1.045,
    );
    const wickSize = args.basePrice * (0.00035 + random() * 0.00115) * intervalScale;
    const high = Math.max(open, close) + wickSize * (0.8 + random() * 0.7);
    const low = Math.max(0.000001, Math.min(open, close) - wickSize * (0.8 + random() * 0.7));
    const activity = Math.min(3, Math.abs((close - open) / open) / Math.max(volatility, 0.000001));
    const volumeUsd =
      baseVolume *
      Math.max(1, step / 300) *
      sessionShape *
      (0.68 + random() * 0.72) *
      (1 + activity * 0.28);
    previousClose = close;

    return {
      timestamp,
      open,
      high,
      low,
      close,
      volumeUsd,
      txCount: Math.max(2, Math.round((4 + random() * 10) * Math.max(1, step / 300))),
    };
  });
}

export function getDemoPoolData(poolKey: string): PoolData {
  const metadata = getDemoPoolMetadata(poolKey);
  if (!metadata) throw new Error(`Missing Demo metadata for ${poolKey}`);

  const price = getAssetPrice(metadata.token0Symbol) * (1 + (getPoolIndex(poolKey) % 5 - 2) * 0.0015);
  const tick = humanPriceToTick(price, metadata.token0Decimals, metadata.token1Decimals);
  const token0Balance = 8_500 + getPoolIndex(poolKey) * 720;
  const token1Balance = Math.round(token0Balance * price * 0.92);
  const token0BalanceRaw = toRawAmount(token0Balance, metadata.token0Decimals);
  const token1BalanceRaw = toRawAmount(token1Balance, metadata.token1Decimals);
  const token0Value = token0Balance * price;
  const totalValue = token0Value + token1Balance;
  const analyticsProfile = getPoolAnalyticsProfile(poolKey);

  return {
    protocol: "raydium-clmm",
    analyticsModel: analyticsProfile.analyticsModel,
    capabilities: analyticsProfile.capabilities,
    poolAddress: poolKey,
    token0Address: metadata.token0Mint ?? `${poolKey}-token0`,
    token1Address: metadata.token1Mint ?? USDC_MINT,
    fee: metadata.fee ?? 2500,
    tickSpacing: metadata.tickSpacing ?? 60,
    token0Symbol: metadata.token0Symbol,
    token1Symbol: metadata.token1Symbol,
    token0Decimals: metadata.token0Decimals,
    token1Decimals: metadata.token1Decimals,
    sqrtPriceX96: humanPriceToSqrtPriceX96(price, metadata.token0Decimals, metadata.token1Decimals),
    tick,
    liquidity: String(8_000_000_000_000 + getPoolIndex(poolKey) * 500_000_000_000),
    token0Balance: String(Math.round(token0Balance * 100) / 100),
    token1Balance: String(token1Balance),
    token0BalanceRaw,
    token1BalanceRaw,
    currentPrice: price,
    token0Percent: totalValue > 0 ? (token0Value / totalValue) * 100 : 50,
    token1Percent: totalValue > 0 ? (token1Balance / totalValue) * 100 : 50,
    activeBinId: null,
    binStepBps: null,
    token0Reserve: token0BalanceRaw,
    token1Reserve: token1BalanceRaw,
    lastTradeAt: new Date(DEMO_NOW - getPoolIndex(poolKey) * 120_000).toISOString(),
  };
}

export function getDemoPoolPositions(poolKey: string): PositionData[] {
  const pool = getDemoPoolData(poolKey);
  const spacing = Math.max(pool.tickSpacing, 10);
  const baseTick = Math.floor(pool.tick / spacing) * spacing;
  const rows = [
    { owner: DEMO_OWNER_A, width: 80, liquidity: 4_800_000_000_000 },
    { owner: DEMO_OWNER_B, width: 140, liquidity: 2_600_000_000_000 },
    { owner: DEMO_OWNER_C, width: 220, liquidity: 1_200_000_000_000 },
  ];

  return rows.map((row, index) => ({
    id: `${poolKey}-position-${index + 1}`,
    tokenId: `${poolKey}-position-${index + 1}`,
    pool: poolKey,
    owner: row.owner,
    tickLower: baseTick - spacing * row.width,
    tickUpper: baseTick + spacing * row.width,
    liquidity: String(row.liquidity + getPoolIndex(poolKey) * 100_000_000_000),
    updatedAt: DEMO_NOW_SEC - index * 3600,
  }));
}

function groupPositionsByOwner(positions: PositionData[]): OwnerPositions[] {
  return positions.map((position) => ({
    owner: position.owner,
    positions: [position],
    liquidityTotal: position.liquidity,
  }));
}

export function getDemoCandles(args: {
  poolKey: string;
  intervalSeconds?: number;
  startTime?: number;
  endTime?: number;
  maxPoints?: number;
}): CandleData[] {
  const pool = getDemoPoolData(args.poolKey);
  const interval = args.intervalSeconds ?? 300;
  const maxPoints = args.maxPoints ?? 180;
  const end = args.endTime && args.endTime > 0 ? args.endTime : DEMO_NOW_SEC;
  const start = args.startTime && args.startTime > 0 ? args.startTime : end - interval * 120;
  const marketCandles = getDemoMarketCandles({
    seedKey: args.poolKey,
    basePrice: pool.currentPrice,
    intervalSeconds: interval,
    startTime: start,
    endTime: end,
    maxPoints,
  });

  return marketCandles.map((candle) => {
    return {
      id: `demo-candle-${args.poolKey}-${candle.timestamp}`,
      pool: args.poolKey,
      interval,
      timestamp: candle.timestamp,
      openPrice: formatDemoPrice(candle.open),
      highPrice: formatDemoPrice(candle.high),
      lowPrice: formatDemoPrice(candle.low),
      closePrice: formatDemoPrice(candle.close),
      volume0: String(Math.round((candle.volumeUsd / candle.close) * 1_000_000) / 1_000_000),
      volume1: String(Math.round(candle.volumeUsd * 100) / 100),
      txCount: candle.txCount,
    };
  });
}

export function getDemoPoolDataResponse(args: {
  poolKey: string;
  startTime?: number;
  endTime?: number;
}): PoolDataResponse {
  const pool = getDemoPoolData(args.poolKey);
  const positions = getDemoPoolPositions(args.poolKey);
  const start = args.startTime && args.startTime > 0 ? args.startTime : DEMO_NOW_SEC - 7 * 86400;
  const end = args.endTime && args.endTime > start ? args.endTime : DEMO_NOW_SEC;
  const candles = getDemoCandles({
    poolKey: args.poolKey,
    intervalSeconds: 3600,
    startTime: start,
    endTime: end,
    maxPoints: 168,
  });
  const feeRate = pool.fee / 1_000_000;
  const events = positions.flatMap((position, index) => {
    const baseTs = start + (index + 1) * Math.max(3600, Math.floor((end - start) / 5));
    return [
      {
        id: `${position.id}-mint`,
        owner: position.owner,
        eventType: "MINT",
        timestamp: baseTs,
        liquidityDelta: position.liquidity,
        amount0: toRawAmount(20 + index * 4, pool.token0Decimals),
        amount1: toRawAmount((20 + index * 4) * pool.currentPrice, pool.token1Decimals),
        tickLower: String(position.tickLower),
        tickUpper: String(position.tickUpper),
      },
      {
        id: `${position.id}-rebalance`,
        owner: position.owner,
        eventType: "INCREASE",
        timestamp: baseTs + 86400,
        liquidityDelta: String(Math.floor(Number(position.liquidity) * 0.08)),
        amount0: toRawAmount(3 + index, pool.token0Decimals),
        amount1: toRawAmount((3 + index) * pool.currentPrice, pool.token1Decimals),
        tickLower: String(position.tickLower),
        tickUpper: String(position.tickUpper),
      },
    ];
  });

  return {
    tickLiquidities: [],
    poolHourDatas: candles.map((c) => ({
      id: `demo-hour-${c.timestamp}`,
      periodStartUnix: c.timestamp,
      volumeToken0: c.volume0,
      volumeToken1: c.volume1,
      feesToken0: String(Number(c.volume0) * feeRate),
      feesToken1: String(Number(c.volume1) * feeRate),
      txCount: c.txCount,
      openPrice: c.openPrice,
      highPrice: c.highPrice,
      lowPrice: c.lowPrice,
      closePrice: c.closePrice,
      liquidity: pool.liquidity,
    })),
    lpevents: events,
    uniswapV3PoolMints: events.filter((e) => e.eventType === "MINT").map((e) => ({
      ...e,
      pool: args.poolKey,
      transactionHash: `${e.id}-tx`,
      amount: e.liquidityDelta,
      sender: e.owner,
    })),
    uniswapV3PoolBurns: [],
    positions,
    ownerAggregates: groupPositionsByOwner(positions).map((row) => ({
      id: `${args.poolKey}-${row.owner}`,
      pool: args.poolKey,
      owner: row.owner,
      liquidityTotal: String(row.liquidityTotal),
      updatedAt: DEMO_NOW_SEC,
    })),
    lpActivitySeries: candles.map((c) => ({
      timestamp: c.timestamp,
      depth_band_buy: 85_000 + Number(c.volume1) * 0.4,
      depth_band_sell: 79_000 + Number(c.volume1) * 0.36,
    })),
    meta: { source: "demo-fixture", partial: false },
  };
}

export function getDemoBirdsEyeSnapshot() {
  const pools = getDemoPools().map((pool) => {
    const positions = getDemoPoolPositions(pool.poolKey);
    return {
      pool,
      poolData: getDemoPoolData(pool.poolKey),
      positionsByOwner: groupPositionsByOwner(positions),
      partial: false,
    };
  });
  return {
    spaceSlug: DEMO_SPACE_SLUG,
    generatedAt: DEMO_NOW,
    pools,
    partial: false,
  };
}

export function getDemoPoolPricesRpc(poolKeys: string[]): PoolPricesRpcResponse {
  const prices: PoolPricesRpcResponse["prices"] = {};
  const oraclePrices: Record<string, number> = {};
  const oracleUpdatedAt: Record<string, number> = {};

  const keys = poolKeys.length > 0 ? poolKeys : getDemoPools().map((pool) => pool.poolKey);
  for (const poolKey of keys) {
    if (!isDemoPoolKey(poolKey)) continue;
    const data = getDemoPoolData(poolKey);
    prices[poolKey] = {
      price: data.currentPrice,
      tick: data.tick,
      sqrtPriceX64: "0",
      sqrtPriceX96: data.sqrtPriceX96,
      decimals0: data.token0Decimals,
      decimals1: data.token1Decimals,
    };
    const meta = getDemoPoolMetadata(poolKey);
    if (meta?.token0Mint) {
      oraclePrices[meta.token0Mint.toLowerCase()] = getAssetPrice(meta.token0Symbol);
      oracleUpdatedAt[meta.token0Mint.toLowerCase()] = DEMO_NOW_SEC;
    }
    if (meta?.token1Mint) {
      oraclePrices[meta.token1Mint.toLowerCase()] = 1;
      oracleUpdatedAt[meta.token1Mint.toLowerCase()] = DEMO_NOW_SEC;
    }
  }

  return {
    prices,
    oraclePrices,
    oracleUpdatedAt,
    rpcFetchedAt: DEMO_NOW,
    oracleFetchedAt: DEMO_NOW,
    fetchedAt: DEMO_NOW,
  };
}

export function getDemoTokenPrices() {
  const pricesUsdByAddress: Record<string, number | null> = {};
  const metaByCoinKey: Record<string, { price: number; symbol: string; timestamp: number; confidence: number }> = {};
  for (const pool of getDemoPools()) {
    const meta = getDemoPoolMetadata(pool.poolKey);
    if (!meta) continue;
    if (meta.token0Mint) {
      const price = getAssetPrice(meta.token0Symbol);
      pricesUsdByAddress[meta.token0Mint.toLowerCase()] = price;
      metaByCoinKey[`demo:${meta.token0Symbol}`] = {
        price,
        symbol: meta.token0Symbol,
        timestamp: DEMO_NOW_SEC,
        confidence: 1,
      };
    }
    if (meta.token1Mint) {
      pricesUsdByAddress[meta.token1Mint.toLowerCase()] = 1;
    }
  }
  pricesUsdByAddress[USDC_ETH] = 1;
  pricesUsdByAddress[USDT_ETH] = 1;
  return {
    updatedAt: DEMO_NOW,
    chain: "demo",
    tokenCount: Object.keys(pricesUsdByAddress).length,
    pricesUsdByAddress,
    metaByCoinKey,
    demo: true,
  };
}

export function getDemoHistoricalPrices(args: {
  tokenAddress: string;
  startTime?: number;
  endTime?: number;
}) {
  const tokenLc = args.tokenAddress.toLowerCase();
  const meta = Object.values(getDemoPools())
    .map((pool) => getDemoPoolMetadata(pool.poolKey))
    .find((row) => row?.token0Mint?.toLowerCase() === tokenLc || row?.token1Mint?.toLowerCase() === tokenLc);
  const base = meta?.token0Mint?.toLowerCase() === tokenLc ? getAssetPrice(meta.token0Symbol) : 1;
  const end = args.endTime && args.endTime > 0 ? args.endTime : DEMO_NOW_SEC;
  const start = args.startTime && args.startTime > 0 ? args.startTime : end - 7 * 86400;
  const points = getDemoTimePoints(start, end, 96).map((timestamp, index) => ({
    timestamp,
    price: base * (1 + Math.sin(index / 6) * 0.01),
  }));
  return {
    source: "coingecko",
    tokenAddress: args.tokenAddress,
    prices: points,
    cached: false,
    demo: true,
  };
}

function getDemoTimePoints(startTime: number, endTime: number, maxPoints: number): number[] {
  const start = Math.max(0, startTime);
  const end = Math.max(start + 1, endTime);
  const count = Math.min(maxPoints, Math.max(2, Math.floor((end - start) / 3600)));
  const step = Math.max(3600, Math.floor((end - start) / count));
  return Array.from({ length: count }, (_, index) => start + index * step);
}

export function getDemoLpSwaps(args: {
  poolKey: string;
  startTime?: number;
  endTime?: number;
}) {
  const pool = getDemoPoolData(args.poolKey);
  const start = args.startTime && args.startTime > 0 ? args.startTime : DEMO_NOW_SEC - 86400;
  const end = args.endTime && args.endTime > start ? args.endTime : DEMO_NOW_SEC;
  return getDemoTimePoints(start, end, 120).map((timestamp, index) => {
    const amount0 = (index % 2 === 0 ? 1 : -1) * (2 + index / 10);
    const amount1 = -amount0 * pool.currentPrice;
    return {
      id: `demo-swap-${args.poolKey}-${timestamp}`,
      timestamp,
      sqrtPriceX96: pool.sqrtPriceX96,
      liquidity: pool.liquidity,
      tick: String(pool.tick + ((index % 7) - 3)),
      amount0: toRawAmount(Math.abs(amount0), pool.token0Decimals),
      amount1: String(Math.trunc(amount1 * 10 ** pool.token1Decimals)),
      sender: DEMO_OWNER_A,
      recipient: DEMO_OWNER_B,
    };
  });
}

export function getDemoLpSummary(poolKey: string, limit = 200) {
  const positions = getDemoPoolPositions(poolKey).slice(0, limit);
  return {
    data: positions.map((position) => ({
      owner: position.owner,
      position_id: position.id,
      liquidity: position.liquidity,
      tick_lower: position.tickLower,
      tick_upper: position.tickUpper,
      updated_at: new Date((position.updatedAt ?? DEMO_NOW_SEC) * 1000).toISOString(),
      pool: poolKey,
    })),
    meta: { pool: poolKey, limit, demo: true },
  };
}

export function getDemoTradingVolumeBySize() {
  const buckets = {
    below_100: 1_200,
    "100_1k": 8_400,
    "1k_5k": 31_000,
    "5k_10k": 44_500,
    "10k_25k": 97_000,
    "25k_50k": 140_000,
    "50k_100k": 188_000,
    "100k_250k": 230_000,
    "250k_500k": 190_000,
    "500k_1m": 80_000,
    "1m_plus": 35_000,
  };
  const dailyData = Array.from({ length: 14 }, (_, index) => {
    const day = dateKeyFromOffset(13 - index);
    const scale = 0.82 + index * 0.025;
    const scaled = Object.fromEntries(
      Object.entries(buckets).map(([key, value]) => [key, Math.round(value * scale)])
    );
    const total = Object.values(scaled).reduce((sum, value) => sum + Number(value), 0);
    return { date: `${day}T00:00:00.000Z`, dateKey: day, buckets: scaled, total };
  });
  return { dailyData };
}

export function getDemoArbVolume() {
  const assets = Array.from(new Set(getDemoPools().map((pool) => getDemoPoolMetadata(pool.poolKey)?.token0Symbol).filter(Boolean)))
    .map((asset) => {
      const pools = getDemoPools()
        .filter((pool) => getDemoPoolMetadata(pool.poolKey)?.token0Symbol === asset)
        .map((pool) => {
          const volume = 180_000 + getPoolIndex(pool.poolKey) * 11_000;
          const arb = volume * (0.18 + (getPoolIndex(pool.poolKey) % 4) * 0.03);
          return {
            poolAddress: pool.poolKey,
            poolKey: pool.key,
            venue: labelForPool(pool),
            feeBps: getDemoPoolMetadata(pool.poolKey)?.fee ?? null,
            totalSwaps: 80 + getPoolIndex(pool.poolKey) * 3,
            arbSwaps: 14 + getPoolIndex(pool.poolKey),
            totalVolumeUsd: Math.round(volume),
            arbVolumeUsd: Math.round(arb),
            organicVolumeUsd: Math.round(volume - arb),
            arbPct: Math.round((arb / volume) * 10_000) / 100,
          };
        });
      const totalVolumeUsd = pools.reduce((sum, pool) => sum + pool.totalVolumeUsd, 0);
      const arbVolumeUsd = pools.reduce((sum, pool) => sum + pool.arbVolumeUsd, 0);
      return {
        asset: asset as string,
        hlCoin: `xyz:${String(asset).replace(/x$/, "")}`,
        hlCandleCount: 1440,
        pools,
        totalVolumeUsd,
        arbVolumeUsd,
        organicVolumeUsd: totalVolumeUsd - arbVolumeUsd,
        arbPct: totalVolumeUsd > 0 ? Math.round((arbVolumeUsd / totalVolumeUsd) * 10_000) / 100 : 0,
      };
    });
  const totalVolumeUsd = assets.reduce((sum, asset) => sum + asset.totalVolumeUsd, 0);
  const arbVolumeUsd = assets.reduce((sum, asset) => sum + asset.arbVolumeUsd, 0);
  return {
    meta: {
      days: 7,
      startTime: new Date(DEMO_NOW - 7 * 86400_000).toISOString(),
      endTime: new Date(DEMO_NOW).toISOString(),
      assetFilter: null,
      poolFilter: null,
      totalAssets: assets.length,
      totalPools: assets.reduce((sum, asset) => sum + asset.pools.length, 0),
      demo: true,
    },
    summary: {
      totalVolumeUsd,
      arbVolumeUsd,
      organicVolumeUsd: totalVolumeUsd - arbVolumeUsd,
      arbPct: totalVolumeUsd > 0 ? Math.round((arbVolumeUsd / totalVolumeUsd) * 10_000) / 100 : 0,
    },
    assets,
  };
}

export function getDemoKrakenPools() {
  const assets = Array.from(new Set(getDemoPools().map((pool) => getDemoPoolMetadata(pool.poolKey)?.token0Symbol).filter(Boolean)))
    .map((symbol) => {
      const pools = getDemoPools()
        .filter((pool) => getDemoPoolMetadata(pool.poolKey)?.token0Symbol === symbol)
        .map((pool) => {
          const metadata = getDemoPoolMetadata(pool.poolKey)!;
          const liquidity = 1_200_000 + getPoolIndex(pool.poolKey) * 95_000;
          const volume = 280_000 + getPoolIndex(pool.poolKey) * 23_000;
          const feeTier = metadata.fee ? String(metadata.fee / 10_000) : null;
          const feeUsd = feeTier ? volume * (Number(feeTier) / 100) : null;
          return {
            address: pool.poolKey,
            name: pool.label,
            dex: labelForPool(pool),
            feeTier,
            feeTierSource: "local" as const,
            isTransparentSpacePool: true,
            transparentSpaceLabel: pool.label,
            liquidityUsd: liquidity,
            volume24hUsd: volume,
            estimatedFees24hUsd: feeUsd,
            actualFees24hUsd: feeUsd,
            actualFees24hSource: "raydium" as const,
            displayedFees24hUsd: feeUsd,
            poolCreatedAt: "2026-04-15T00:00:00.000Z",
            marketCapUsd: null,
            fdvUsd: null,
            baseToken: {
              address: metadata.token0Mint ?? null,
              name: metadata.name,
              symbol: metadata.token0Symbol,
              imageUrl: metadata.logo ?? null,
              coingeckoCoinId: null,
            },
            quoteToken: {
              address: metadata.token1Mint ?? null,
              name: metadata.token1Symbol === "USDT" ? "Tether USD" : "USD Coin",
              symbol: metadata.token1Symbol,
              imageUrl: null,
              coingeckoCoinId: metadata.token1Symbol === "USDT" ? "tether" : "usd-coin",
            },
            baseTokenBalance: String(Math.round(liquidity / getAssetPrice(metadata.token0Symbol) / 2)),
            baseTokenLiquidityUsd: liquidity / 2,
            quoteTokenBalance: String(Math.round(liquidity / 2)),
            quoteTokenLiquidityUsd: liquidity / 2,
            lockedLiquidityPercentage: null,
          };
        })
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
      return {
        symbol: symbol as string,
        mint: getDemoPoolMetadata(pools[0]?.address ?? "")?.token0Mint ?? "",
        poolCount: pools.length,
        totalLiquidityUsd: pools.reduce((sum, pool) => sum + pool.liquidityUsd, 0),
        totalVolume24hUsd: pools.reduce((sum, pool) => sum + pool.volume24hUsd, 0),
        totalEstimatedFees24hUsd: pools.reduce((sum, pool) => sum + (pool.displayedFees24hUsd ?? 0), 0),
        pools,
      };
    })
    .sort((a, b) => b.totalLiquidityUsd - a.totalLiquidityUsd);
  return {
    fetchedAt: new Date(DEMO_NOW).toISOString(),
    totalAssetCount: assets.length,
    totalPoolCount: assets.reduce((sum, asset) => sum + asset.poolCount, 0),
    totalLiquidityUsd: assets.reduce((sum, asset) => sum + asset.totalLiquidityUsd, 0),
    totalVolume24hUsd: assets.reduce((sum, asset) => sum + asset.totalVolume24hUsd, 0),
    totalEstimatedFees24hUsd: assets.reduce((sum, asset) => sum + asset.totalEstimatedFees24hUsd, 0),
    assets,
    demo: true,
  };
}

function getAssetMetadata(asset: string) {
  return getDemoPools()
    .map((pool) => getDemoPoolMetadata(pool.poolKey))
    .find((metadata) => metadata?.token0Symbol === asset);
}

function buildProviderQuote(provider: string, asset: string, notional: number, direction: "forward" | "reverse", index: number) {
  const metadata = getAssetMetadata(asset);
  const price = getAssetPrice(asset);
  const spread = 0.0015 + index * 0.00035;
  const buyPrice = price * (1 + spread);
  const sellPrice = price * (1 - spread);
  const tokenAmount = notional / (direction === "forward" ? buyPrice : sellPrice);
  const quoteAt = new Date(DEMO_NOW - index * 45_000).toISOString();
  const evmToken = metadata?.token0Mint ?? "0x0000000000000000000000000000000000000001";
  const solToken = metadata?.token0Mint ?? "DemoTokenMint11111111111111111111111111111";
  const quoteSymbol = metadata?.token1Symbol ?? "USDC";
  const quoteMint = metadata?.token1Mint ?? USDC_MINT;
  const evmQuoteToken = quoteSymbol === "USDT" ? USDT_ETH : USDC_ETH;
  const quoteDecimals = metadata?.token1Decimals ?? 6;
  const isForward = direction === "forward";
  const sellToken = isForward ? evmQuoteToken : evmToken;
  const buyToken = isForward ? evmToken : evmQuoteToken;
  const sellRaw18 = toRawAmount(isForward ? notional : tokenAmount, isForward ? quoteDecimals : 18);
  const buyRaw18 = toRawAmount(isForward ? tokenAmount : notional * (1 - spread), isForward ? 18 : quoteDecimals);
  const solInRaw = toRawAmount(isForward ? notional : tokenAmount, isForward ? quoteDecimals : 8);
  const solOutRaw = toRawAmount(isForward ? tokenAmount : notional * (1 - spread), isForward ? 8 : quoteDecimals);
  const base = {
    quote_id: `demo-${provider}-${asset}-${direction}-${notional}`,
    capture_id: `demo-${provider}-${asset}-${index}`,
    asset,
    pool: getDemoPools().find((pool) => getDemoPoolMetadata(pool.poolKey)?.token0Symbol === asset)?.poolKey ?? null,
    direction,
    provider,
    notional_usd: String(notional),
    is_success: true,
    error_code: null,
    error_message: null,
    quote_at: quoteAt,
  };

  if (provider === "jupz") {
    return {
      ...base,
      input_mint: isForward ? quoteMint : solToken,
      output_mint: isForward ? solToken : quoteMint,
      requested_in_amount_raw: solInRaw,
      out_amount_raw: solOutRaw,
      in_usd_value: String(notional),
      out_usd_value: String(notional * (1 - spread)),
      slippage_bps: Math.round(spread * 10_000),
      fee_bps: 2,
      swap_type: "ExactIn",
      router: "demo-jupz",
      jup_quote_id: `demo-jupz-${asset}-${notional}`,
      maker: "MM B",
      platform_fee_amount: "0",
      platform_fee_bps: 0,
      price_impact: String(spread),
      price_impact_pct: String(spread),
      mode: "demo",
      total_time_ms: 42,
      route_label: "JupZ RFQ",
      route_amm_key: "demo-jupz",
    };
  }

  if (provider === "bebop") {
    return {
      ...base,
      sell_token: sellToken,
      buy_token: buyToken,
      requested_sell_amount_raw: sellRaw18,
      best_price: String(isForward ? buyPrice : sellPrice),
      selected_route_type: "PMMv3",
      selected_route_index: 0,
      selected_route_quote_id: `demo-bebop-route-${asset}-${notional}`,
      route_count: 1,
      quote_buy_amount_raw: buyRaw18,
      quote_buy_amount_before_fee_raw: buyRaw18,
      quote_price: String(isForward ? buyPrice : sellPrice),
      quote_price_before_fee: String(isForward ? buyPrice : sellPrice),
      quote_price_usd: String(isForward ? buyPrice : sellPrice),
      price_impact: String(spread),
      gas_fee_native: "0.0004",
      gas_fee_usd: "1.25",
      maker_address: "0x00000000000000000000000000000000beef0001",
      maker_amount_raw: buyRaw18,
      taker_amount_raw: sellRaw18,
      expiry: new Date(DEMO_NOW + 300_000).toISOString(),
      route_legs: [],
    };
  }

  if (provider === "cowswap") {
    return {
      ...base,
      sell_token: sellToken,
      buy_token: buyToken,
      requested_sell_amount_raw: sellRaw18,
      quote_sell_amount_raw: sellRaw18,
      quote_buy_amount_raw: buyRaw18,
      fee_amount_raw: "0",
      protocol_fee_bps: 1,
      gas_amount: "185000",
      gas_price: "1200000000",
      sell_token_price: isForward ? "1" : String(price),
      quote_kind: "sell",
      quote_valid_to: new Date(DEMO_NOW + 300_000).toISOString(),
      quote_ref_id: `demo-cow-${asset}-${notional}`,
      error_type: null,
    };
  }

  if (provider === "1inch") {
    return {
      ...base,
      sell_token: sellToken,
      buy_token: buyToken,
      requested_sell_amount_raw: sellRaw18,
      quote_buy_amount_raw: buyRaw18,
      fusion_quote_id: `demo-1inch-${asset}-${notional}`,
      recommended_preset: "fast",
      settlement_address: "0x000000000000000000000000000000001inch001",
      fee_token: null,
      estimated_gas: 160000,
      volume: { usd: { toToken: String(notional), fromToken: String(notional) } },
      whitelist_count: 2,
      prices: { usd: { toToken: String(price), fromToken: "1" } },
      preset_fast: {
        points: 3,
        auctionDuration: 180,
        auctionEndAmount: buyRaw18,
        auctionStartAmount: buyRaw18,
      },
      preset_medium: null,
      preset_slow: null,
    };
  }

  return {
    ...base,
    sell_token: sellToken,
    buy_token: buyToken,
    requested_sell_amount_raw: sellRaw18,
    quote_buy_amount_raw: buyRaw18,
    sell_amount_raw: sellRaw18,
    buy_amount_raw: buyRaw18,
    min_buy_amount_raw: buyRaw18,
    total_network_fee_raw: "0",
    gas_estimate: "155000",
    liquidity_available: true,
    fill_count: 1,
    fills: [{
      from: sellToken,
      to: buyToken,
      source: "Demo RFQ",
      proportionBps: "10000",
    }],
  };
}

export function getDemoRfqRows(provider: string, asset?: string | null) {
  const assets = asset ? resolveDemoFixtureAssets([asset]) : Object.keys(DEMO_ASSET_PRICES);
  const notionals = [10_000, 50_000, 100_000, 500_000, 1_000_000];
  return assets.flatMap((assetSymbol) =>
    notionals.flatMap((notional, index) => [
      buildProviderQuote(provider, assetSymbol, notional, "forward", index),
      buildProviderQuote(provider, assetSymbol, notional, "reverse", index),
    ])
  );
}

export function getDemoRfqApiResponse(provider: string, asset?: string | null, poolKey?: string | null) {
  const metadata = poolKey ? getDemoPoolMetadata(poolKey) : undefined;
  const requestedAsset = resolveDemoFixtureAsset(asset ?? metadata?.token0Symbol ?? null);
  const rows = getDemoRfqRows(provider, requestedAsset).map((row) => {
    if (provider !== "jupiter") return row;
    const q = row as ReturnType<typeof buildProviderQuote> & Record<string, unknown>;
    const isForward = q.direction === "forward";
    const meta = metadata ?? getAssetMetadata(String(q.asset));
    const quoteSymbol = meta?.token1Symbol ?? "USDC";
    const quoteMint = meta?.token1Mint ?? USDC_MINT;
    return {
      quote_id: q.quote_id,
      capture_id: q.capture_id,
      pool: poolKey ?? q.pool,
      pair_key: `${q.asset}/${quoteSymbol}`,
      direction: q.direction,
      provider: "jupiter",
      input_mint: isForward ? quoteMint : meta?.token0Mint ?? "",
      output_mint: isForward ? meta?.token0Mint ?? "" : quoteMint,
      notional_usd: q.notional_usd,
      requested_swap_mode: "ExactIn",
      quote_in_amount_raw: q.requested_in_amount_raw ?? q.requested_sell_amount_raw ?? q.quote_sell_amount_raw ?? "0",
      quote_out_amount_raw: q.out_amount_raw ?? q.quote_buy_amount_raw ?? "0",
      slippage_bps: 4,
      platform_fee_amount_raw: "0",
      platform_fee_bps: 0,
      price_impact_pct: "0.001",
      swap_usd_value: q.notional_usd,
      route_count: 1,
      is_success: true,
      error_message: null,
      quote_at: q.quote_at,
      route_legs: [{
        leg_index: 0,
        amm_key: "demo-raydium",
        amm_label: "Raydium CLMM",
        leg_percent: 100,
        input_mint: isForward ? quoteMint : meta?.token0Mint ?? "",
        output_mint: isForward ? meta?.token0Mint ?? "" : quoteMint,
        in_amount_raw: q.requested_in_amount_raw ?? q.requested_sell_amount_raw ?? "0",
        out_amount_raw: q.out_amount_raw ?? "0",
      }],
    };
  });
  return {
    data: rows,
    pagination: { limit: rows.length, has_more: false, next_cursor: null },
    meta: {
      provider,
      applied_filters: {
        asset: requestedAsset,
        pools: poolKey ? [poolKey] : [],
        demo: true,
      },
    },
  };
}

export function getDemoDailyBuckets(args: {
  assets?: string[];
  providers?: string[];
  sessions?: string[];
  days?: number;
  notionalUsd?: string;
}) {
  const assets = resolveDemoFixtureAssets(args.assets);
  const providers = args.providers?.length ? args.providers : ["1inch", "0x", "bebop", "cowswap", "jupz"];
  const sessions = args.sessions?.length ? args.sessions : ["market", "prePost", "weekend"];
  const days = args.days ?? 7;
  const rows = [];
  for (let dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
    for (const asset of assets) {
      for (const provider of providers) {
        for (const session of sessions) {
          const base = 9 + (asset.length % 4) * 2 + (provider.length % 5);
          rows.push({
            date: dateKeyFromOffset(dayOffset),
            session_bucket: session,
            asset,
            provider,
            notional_usd: args.notionalUsd ?? "10000",
            mean_bps: base + dayOffset * 0.3,
            median_bps: base + dayOffset * 0.22,
            sample_count: 16 + dayOffset,
            first_quote_at: new Date(DEMO_NOW - dayOffset * 86400_000).toISOString(),
            last_quote_at: new Date(DEMO_NOW - dayOffset * 86400_000 + 3600_000).toISOString(),
          });
        }
      }
    }
  }
  return {
    data: rows,
    meta: {
      timezone: "America/New_York",
      metric: "worst_side_bps",
      applied_filters: {
        assets,
        providers,
        sessions,
        start_date: dateKeyFromOffset(days - 1),
        end_date: dateKeyFromOffset(0),
        days,
        notional_usd: args.notionalUsd ?? "10000",
      },
      demo: true,
    },
  };
}

const DEMO_QUOTE_ACTIVITY_PROVIDERS: RfqProvider[] = ["oneinch", "zerox", "bebop", "cowswap", "jupz"];

function getDemoQuoteActivityHour(args: {
  assetIndex: number;
  providerIndex: number;
  hourIndex: number;
  hour: string;
}): QuoteActivityHour {
  const expected = 4;
  const score = ((args.assetIndex + 1) * 17) + ((args.providerIndex + 1) * 11) + args.hourIndex;
  let success = expected;
  let failureReason: QuoteActivityFailureReason | null = null;
  let errorCodes: string[] = [];
  let errorSample: string | null = null;

  if (score % 67 === 0) {
    success = 0;
    failureReason = "missing_cycle";
  } else if (score % 41 === 0) {
    success = 2;
    failureReason = "partial_failure";
    errorCodes = ["DEMO_QUOTE_TIMEOUT"];
    errorSample = "Demo maker delayed quote response";
  }

  return {
    hour: args.hour,
    expected,
    success,
    failed: expected - success,
    failure_reason: failureReason,
    error_codes: errorCodes,
    error_sample: errorSample,
  };
}

function getDemoQuoteActivityBreaches(hourly: QuoteActivityHour[]): QuoteActivityBreach[] {
  return hourly
    .filter((hour) => hour.failed > 0 && hour.failure_reason !== "missing_cycle")
    .slice(0, 3)
    .map((hour) => {
      const start = new Date(hour.hour);
      const end = new Date(start.getTime() + 3600_000);
      return {
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        reason: hour.failure_reason ?? "partial_failure",
        error_codes: hour.error_codes ?? [],
        error_sample: hour.error_sample ?? null,
      };
    });
}

export function getDemoQuoteActivity(days = 7): QuoteActivityApiResponse {
  const requestedDays = Number.isFinite(days) ? Math.floor(days) : 7;
  const safeDays = Math.max(1, Math.min(14, requestedDays));
  const hourCount = safeDays * 24;
  const assets = Object.keys(DEMO_ASSET_PRICES);
  const hours = Array.from({ length: hourCount }, (_, index) => {
    const timestamp = DEMO_NOW - (hourCount - index - 1) * 3600_000;
    return new Date(timestamp).toISOString();
  });

  const data = assets.flatMap((asset, assetIndex) =>
    DEMO_QUOTE_ACTIVITY_PROVIDERS.map((provider, providerIndex) => {
      const hourly = hours.map((hour, hourIndex) =>
        getDemoQuoteActivityHour({ assetIndex, providerIndex, hourIndex, hour })
      );
      const expectedSlots = hourly.reduce((sum, hour) => sum + hour.expected, 0);
      const successSlots = hourly.reduce((sum, hour) => sum + hour.success, 0);
      const failedSlots = expectedSlots - successSlots;
      const latestSuccessHour = [...hourly].reverse().find((hour) => hour.success > 0);
      const latestQuoteAt = latestSuccessHour
        ? new Date(new Date(latestSuccessHour.hour).getTime() + 8 * 60_000).toISOString()
        : null;

      return {
        asset,
        group: "core20" as const,
        provider,
        uptime_pct: Number(((successSlots / expectedSlots) * 100).toFixed(2)),
        expected_slots: expectedSlots,
        success_slots: successSlots,
        failed_slots: failedSlots,
        latest_quote_at: latestQuoteAt,
        latest_success_at: latestQuoteAt,
        directions: ["forward", "reverse"],
        notionals_usd: ["10000", "50000", "100000"],
        hourly,
        breaches: getDemoQuoteActivityBreaches(hourly),
      };
    })
  );

  return {
    data,
    meta: {
      generated_at: new Date(DEMO_NOW).toISOString(),
      days: safeDays,
      uptime_definition: "expected_cycles",
    },
  };
}

export function getDemoMakerVolume(rangeOrDays: string | number = 30): XstocksMakerVolumeResponse {
  const days = typeof rangeOrDays === "number"
    ? rangeOrDays
    : rangeOrDays === "90d"
      ? 90
      : rangeOrDays === "365d" || rangeOrDays === "all"
        ? 365
        : 30;
  const providers = ["cowswap", "bebop", "kyberswap", "1inch", "0x", "jupiterz"];
  const assets = Object.keys(DEMO_ASSET_PRICES);
  const data = Array.from({ length: Math.min(days, 90) }, (_, dayIndex) => {
    const day = dateKeyFromOffset(Math.min(days, 90) - dayIndex - 1);
    return providers.flatMap((provider, providerIndex) =>
      assets.slice(0, 5).map((asset, assetIndex) => {
        const volume = 15_000 + providerIndex * 2_500 + assetIndex * 1_800 + dayIndex * 220;
        return {
          day,
          chain: provider === "jupiterz" ? "solana" : "ethereum",
          provider,
          label: PROVIDER_LABELS[provider] ?? provider,
          maker_address: `demo-${provider}-maker`,
          symbol: asset,
          direction: (assetIndex + dayIndex + providerIndex) % 2 === 0 ? "out" : "in",
          volume_token: String(volume / getAssetPrice(asset)),
          volume_usd: String(volume),
          price_usd: String(getAssetPrice(asset)),
          price_source: "demo-fixture",
          tx_count: 3 + ((assetIndex + dayIndex) % 5),
          updated_at: new Date(DEMO_NOW).toISOString(),
        };
      })
    );
  }).flat();
  return {
    data,
    meta: {
      applied_filters: {
        range: typeof rangeOrDays === "string" ? rangeOrDays as "all" | "30d" | "90d" | "365d" : null,
        start_date: dateKeyFromOffset(Math.min(days, 90) - 1),
        end_date: dateKeyFromOffset(0),
        days,
      },
    },
  };
}

export function getDemoPoolNetFlow(range = "30d"): PoolNetFlowResponse {
  const days = range === "90d" ? 90 : range === "365d" || range === "all" ? 365 : 30;
  const visibleDays = Math.min(days, 90);
  const dayRows = Array.from({ length: visibleDays }, (_, index) => {
    const buyUsd = 90_000 + index * 1_200;
    const sellUsd = 115_000 + Math.sin(index / 3) * 15_000 + index * 900;
    return {
      day: dateKeyFromOffset(visibleDays - index - 1),
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      netUsd: Math.round(sellUsd - buyUsd),
      swapCount: 40 + (index % 12),
    };
  });
  const pools = getDemoPools().map((pool) => {
    const asset = getDemoPoolMetadata(pool.poolKey)?.token0Symbol ?? null;
    const buyUsd = 35_000 + getPoolIndex(pool.poolKey) * 3_100;
    const sellUsd = 44_000 + getPoolIndex(pool.poolKey) * 3_700;
    return {
      poolKey: pool.poolKey,
      label: pool.label,
      asset,
      swapCount: 80 + getPoolIndex(pool.poolKey),
      buyUsd,
      sellUsd,
      netUsd: sellUsd - buyUsd,
    };
  });
  const totals = dayRows.reduce(
    (acc, row) => ({
      buyUsd: acc.buyUsd + row.buyUsd,
      sellUsd: acc.sellUsd + row.sellUsd,
      netUsd: acc.netUsd + row.netUsd,
      swapCount: acc.swapCount + row.swapCount,
    }),
    { buyUsd: 0, sellUsd: 0, netUsd: 0, swapCount: 0 }
  );
  return {
    days: dayRows,
    pools,
    totals,
    meta: {
      spaceSlug: DEMO_SPACE_SLUG,
      range,
      days,
      source: "timescale",
      sourceDetail: "daily",
      fallbackReason: null,
      isPartial: false,
      poolCount: pools.length,
      indexedPoolCount: pools.length,
      skippedPools: [],
      requestedStartDate: dateKeyFromOffset(visibleDays - 1),
      requestedEndDate: dateKeyFromOffset(0),
      startDate: dateKeyFromOffset(visibleDays - 1),
      endDate: dateKeyFromOffset(0),
      demo: true,
    },
  };
}

export function getDemoFlowdeskRfqFlow(range = "30d") {
  const days = range === "90d" ? 90 : range === "365d" || range === "all" ? 365 : 30;
  const visibleDays = Math.min(days, 90);
  const rows = Array.from({ length: visibleDays }, (_, index) => {
    const buyUsd = 42_000 + index * 900;
    const sellUsd = 51_000 + Math.cos(index / 5) * 9_000 + index * 1_100;
    return {
      day: dateKeyFromOffset(visibleDays - index - 1),
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      netUsd: Math.round(sellUsd - buyUsd),
      txCount: 6 + (index % 8),
    };
  });
  const totals = rows.reduce(
    (acc, row) => ({
      buyUsd: acc.buyUsd + row.buyUsd,
      sellUsd: acc.sellUsd + row.sellUsd,
      netUsd: acc.netUsd + row.netUsd,
      txCount: acc.txCount + row.txCount,
    }),
    { buyUsd: 0, sellUsd: 0, netUsd: 0, txCount: 0 }
  );
  return {
    days: rows,
    totals,
    meta: {
      address: "demo-liquidity-wallet",
      range,
      fromBlock: "0",
      toBlock: "0",
      rfqTxsScanned: totals.txCount,
      transfersScanned: totals.txCount * 2,
      xstockTokensSeen: Object.keys(DEMO_ASSET_PRICES).map((symbol) => ({
        address: `demo-${symbol.toLowerCase()}`,
        symbol,
      })),
      note: "Demo fixture flow. No RPC scan was performed.",
      demo: true,
    },
  };
}

export function getDemoOhlcCandles(args: {
  pair?: string | null;
  intervalMinutes?: number;
  since?: number;
  endTime?: number;
}) {
  const asset = getDemoAssetFromPair(args.pair);
  const intervalSec = Math.max(60, (args.intervalMinutes ?? 5) * 60);
  const end = args.endTime && args.endTime > 0 ? args.endTime : DEMO_NOW_SEC;
  const start = args.since && args.since > 0 ? args.since : end - intervalSec * 120;
  const base = getAssetPrice(asset);
  const candles = getDemoMarketCandles({
    seedKey: `ohlc:${asset}`,
    basePrice: base,
    intervalSeconds: intervalSec,
    startTime: start,
    endTime: end,
    maxPoints: 180,
  });

  return candles.map((candle) => {
    return {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      vwap: (candle.open + candle.high + candle.low + candle.close) / 4,
      volume: Math.round(candle.volumeUsd / Math.max(candle.close, 1)),
      count: candle.txCount,
    };
  });
}

export function getDemoFinnhubCandles(args: {
  symbol?: string | null;
  resolution?: string | null;
  from?: number;
  to?: number;
}) {
  return getDemoOhlcCandles({
    pair: `${resolveDemoFixtureAsset(args.symbol) ?? DEFAULT_DEMO_ASSET}USD`,
    intervalMinutes: Number(args.resolution ?? 5),
    since: args.from,
    endTime: args.to,
  }).map(({ timestamp, open, high, low, close, volume }) => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  }));
}

export function getDemoPoolBackedAssets() {
  return getDemoPools().map((pool) => {
    const metadata = getDemoPoolMetadata(pool.poolKey);
    const tracked = getTrackedAsset(metadata?.token0Symbol ?? "", metadata?.token1Symbol ?? "");
    return {
      pool,
      metadata,
      trackedAsset: tracked.symbol,
    };
  });
}
