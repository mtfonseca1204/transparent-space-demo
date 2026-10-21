import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET as getArbVolume } from "@/app/api/arb-volume/route";
import { GET as getBirdsEyeSnapshot } from "@/app/api/birds-eye-snapshot/route";
import { GET as getCandles } from "@/app/api/candles/route";
import { GET as getFinnhubCandles } from "@/app/api/finnhub-candles/route";
import { GET as getHistoricalPrices } from "@/app/api/historical-prices/route";
import { GET as getKrakenOhlc } from "@/app/api/kraken-ohlc/route";
import { GET as getKrakenPools } from "@/app/api/kraken-pools/route";
import { GET as getLpSwaps } from "@/app/api/lp-swaps/route";
import { GET as getLpSummary } from "@/app/api/lp/summary/route";
import { GET as getPoolData } from "@/app/api/pool-data/route";
import { GET as getPoolPricesRpc } from "@/app/api/pool-prices-rpc/route";
import { GET as getPool } from "@/app/api/pool/[address]/route";
import { GET as getTokenPrices } from "@/app/api/token-prices/route";
import { GET as getTradingVolumeBySize } from "@/app/api/trading-volume-by-size/route";
import { GET as getFlowdeskRfqFlow } from "@/app/api/xstocks/flowdesk-rfq-flow/route";
import { fetchZeroXRfqQuotes } from "@/hooks/use-0x-rfq-data";
import { fetchZeroXHistory } from "@/hooks/use-0x-rfq-history";
import { fetchOneInchRfqQuotes } from "@/hooks/use-1inch-rfq-data";
import { fetchOneInchHistory } from "@/hooks/use-1inch-rfq-history";
import { fetchBebopRfqQuotes } from "@/hooks/use-bebop-rfq-data";
import { fetchBebopHistory } from "@/hooks/use-bebop-rfq-history";
import { fetchRfqQuotes as fetchBirdsEyeRfqQuotes } from "@/hooks/use-birds-eye-rfq-data";
import { fetchCowswapRfqQuotes } from "@/hooks/use-cowswap-rfq-data";
import { fetchCowswapHistory } from "@/hooks/use-cowswap-rfq-history";
import { fetchFlowdeskRfqFlow } from "@/hooks/use-flowdesk-rfq-flow";
import { fetchJupzRfqQuotes } from "@/hooks/use-jupz-rfq-data";
import { fetchJupzHistory } from "@/hooks/use-jupz-rfq-history";
import { fetchKrakenPoolNetFlow } from "@/hooks/use-kraken-pool-net-flow";
import { fetchRfqQuotes as fetchJupiterRfqQuotes } from "@/hooks/use-rfq-data";
import { fetchDailyBuckets } from "@/hooks/use-rfq-daily-buckets";
import { fetchRfqQuoteActivity } from "@/hooks/use-rfq-quote-activity";
import { fetchXstocksMakerVolume } from "@/hooks/use-xstocks-maker-volume";
import { DEMO_POOL_KEY_PREFIX, DEMO_SPACE_SLUG } from "@/lib/demo/constants";
import { getDemoTokenLogo } from "@/lib/demo/logos";
import {
  getDemoArbVolume,
  getDemoBirdsEyeSnapshot,
  getDemoCandles,
  getDemoDailyBuckets,
  getDemoFinnhubCandles,
  getDemoFlowdeskRfqFlow,
  getDemoHistoricalPrices,
  getDemoKrakenPools,
  getDemoLpSummary,
  getDemoLpSwaps,
  getDemoMakerVolume,
  getDemoOhlcCandles,
  getDemoPoolBackedAssets,
  getDemoQuoteActivity,
  getDemoRfqApiResponse,
  getDemoPoolNetFlow,
  getDemoPoolData,
  getDemoPoolDataResponse,
  getDemoPoolPricesRpc,
  getDemoTokenPrices,
  getDemoTradingVolumeBySize,
  resolveDemoPoolKey,
} from "@/lib/demo/fixtures";
import {
  containsRealXStockDemoSource,
  getDemoAssetSymbol,
  resolveDashboardViewForSpace,
  resolvePoolKeyForSpace,
  resolveSelectedTokenForSpace,
} from "@/lib/demo/asset-resolution";
import {
  DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL,
  getDemoSourcePoolKey,
  getPoolsForSpace,
  getSolanaPoolMetadata,
} from "@/lib/pools";
import { buildPoolBackedRfqAssetConfig } from "@/lib/rfq-asset-config";
import { KRAKEN_SPACE_SLUG } from "@/lib/space-policy";

const END_TIME = 1_762_622_400;
const START_TIME = END_TIME - 3600;
const SOURCE_SYMBOL_PATTERN = /TSLAx|NVDAx|SPYx|QQQx|GLDx|GOOGLx|HOODx|CRCLx|METAx|COINx|STRCx|SPCXx/;

function request(path: string): NextRequest {
  return new NextRequest(`https://demo.transparent.space${path}`);
}

describe("Demo pool catalog", () => {
  it("copies Kraken visible Solana pool structure with synthetic token labels and keys only", () => {
    const krakenPools = getPoolsForSpace(KRAKEN_SPACE_SLUG).filter(
      (pool) => pool.chain === "solana",
    );
    const demoPools = getPoolsForSpace(DEMO_SPACE_SLUG);
    const krakenPoolKeys = new Set(krakenPools.map((pool) => pool.poolKey));
    const sourceSymbols = new Set(Object.keys(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL));
    const demoVisibleLabels = new Set(
      Object.values(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL).map(
        (config) => `${config.symbol} / ${config.quote}`,
      ),
    );

    expect(demoPools).toHaveLength(krakenPools.length);
    expect(
      demoPools.map((pool) => ({ protocol: pool.protocol, chain: pool.chain })),
    ).toEqual(
      krakenPools.map((pool) => ({ protocol: pool.protocol, chain: pool.chain })),
    );
    expect(demoPools.every((pool) => pool.spaceSlug === DEMO_SPACE_SLUG)).toBe(true);
    expect(demoPools.every((pool) => pool.key.startsWith(DEMO_POOL_KEY_PREFIX))).toBe(true);
    expect(demoPools.every((pool) => pool.poolKey.startsWith(DEMO_POOL_KEY_PREFIX))).toBe(true);
    expect(demoPools.some((pool) => krakenPoolKeys.has(pool.poolKey))).toBe(false);
    expect(resolveDemoPoolKey(`${DEMO_POOL_KEY_PREFIX}${krakenPools[0].key}`)).toBe(demoPools[0].poolKey);
    expect(resolveDemoPoolKey("demo-raydium-azur-usdc")).toBe(demoPools[0].poolKey);
    expect(demoPools.every((pool) => demoVisibleLabels.has(pool.label))).toBe(true);
    expect(demoPools.some((pool, index) => pool.label === krakenPools[index]?.label)).toBe(false);

    for (const pool of demoPools) {
      const metadata = getSolanaPoolMetadata(pool.poolKey);
      expect(metadata).toBeTruthy();
      expect(sourceSymbols.has(metadata?.token0Symbol ?? "")).toBe(false);
      expect(metadata?.token0Symbol).toHaveLength(3);
      expect(metadata?.token0Symbol).not.toMatch(/x$/i);
      expect(metadata?.symbol).not.toMatch(/x\/USD/i);
      expect(metadata?.logo).toBe(getDemoTokenLogo(metadata?.token0Symbol));
    }
  });

  it("uses fake local tokens for Demo Birds-eye RFQ asset config", () => {
    const rows = buildPoolBackedRfqAssetConfig(DEMO_SPACE_SLUG);
    const assets = rows.map((row) => row.asset);

    expect(assets).toEqual(
      Object.values(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL).map((config) => config.symbol),
    );
    expect(assets.every((asset) => asset.length === 3)).toBe(true);
    expect(assets.join(" ")).not.toMatch(SOURCE_SYMBOL_PATTERN);
    expect(rows.every((row) => row.pool?.startsWith(DEMO_POOL_KEY_PREFIX))).toBe(true);
  });

  it("has fixture coverage for every Demo pool", () => {
    for (const pool of getPoolsForSpace(DEMO_SPACE_SLUG)) {
      expect(getDemoSourcePoolKey(pool.poolKey)).toBeTruthy();
      expect(getSolanaPoolMetadata(pool.poolKey)).toBeTruthy();
      expect(getDemoPoolData(pool.poolKey).poolAddress).toBe(pool.poolKey);
      expect(getDemoPoolDataResponse({ poolKey: pool.poolKey }).positions.length).toBeGreaterThan(0);
      expect(getDemoCandles({ poolKey: pool.poolKey, startTime: START_TIME, endTime: END_TIME }).length).toBeGreaterThan(0);
    }
  });

  it("generates plausible non-repetitive fake candles", () => {
    const cyrPool = getPoolsForSpace(DEMO_SPACE_SLUG).find((pool) =>
      pool.label.startsWith(`${DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.SPYx.symbol} /`),
    );
    if (!cyrPool) throw new Error("Missing Demo CYR pool fixture");

    const candles = getDemoCandles({
      poolKey: cyrPool.poolKey,
      intervalSeconds: 300,
      startTime: END_TIME - 86400,
      endTime: END_TIME,
      maxPoints: 180,
    });
    const basePrice = getDemoPoolData(cyrPool.poolKey).currentPrice;
    const closes = candles.map((candle) => Number(candle.closePrice));
    const volumes = candles.map((candle) => Number(candle.volume1));
    const directions = candles.map((candle) =>
      Number(candle.closePrice) >= Number(candle.openPrice) ? "up" : "down",
    );
    const longestRun = directions.reduce(
      (state, direction, index) => {
        const current = index > 0 && direction === directions[index - 1] ? state.current + 1 : 1;
        return { current, max: Math.max(state.max, current) };
      },
      { current: 0, max: 0 },
    ).max;
    const greenCount = directions.filter((direction) => direction === "up").length;
    const volumeIncreaseCount = volumes.filter((volume, index) => index > 0 && volume > volumes[index - 1]).length;
    const priceRangePct = (Math.max(...closes) - Math.min(...closes)) / basePrice;

    expect(candles.length).toBeGreaterThan(100);
    expect(priceRangePct).toBeGreaterThan(0.003);
    expect(priceRangePct).toBeLessThan(0.09);
    expect(greenCount).toBeGreaterThan(candles.length * 0.25);
    expect(greenCount).toBeLessThan(candles.length * 0.75);
    expect(longestRun).toBeLessThan(25);
    expect(volumeIncreaseCount).toBeGreaterThan(candles.length * 0.25);
    expect(volumeIncreaseCount).toBeLessThan(candles.length * 0.75);
  });
});

describe("Demo asset and persisted-state resolution", () => {
  it("maps source xStock assets to Demo symbols and resets unknown source assets", () => {
    expect(getDemoAssetSymbol("TSLAx")).toBe(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol);
    expect(getDemoAssetSymbol("TSLA")).toBe(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol);
    expect(getDemoAssetSymbol("AZUR")).toBe(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol);

    expect(resolveDashboardViewForSpace(
      { kind: "token", symbol: "TSLAx" },
      DEMO_SPACE_SLUG,
    )).toEqual({ kind: "token", symbol: DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol });
    expect(resolveSelectedTokenForSpace(
      null,
      { kind: "token", symbol: DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol },
      DEMO_SPACE_SLUG,
    )).toBe(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol);
    expect(resolveDashboardViewForSpace(
      { kind: "rfq-cowswap", asset: "TSLAx" },
      DEMO_SPACE_SLUG,
    )).toEqual({ kind: "rfq-cowswap", asset: DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol });
    expect(resolveDashboardViewForSpace(
      { kind: "rfq-cowswap", asset: "AAPLx" },
      DEMO_SPACE_SLUG,
    )).toEqual({ kind: "birds-eye" });
  });

  it("maps source Kraken pool keys and stale Demo preview keys to canonical Demo pools", () => {
    const demoPool = getPoolsForSpace(DEMO_SPACE_SLUG)[0];
    if (!demoPool) throw new Error("Missing Demo pool fixture");
    const sourcePoolKey = getDemoSourcePoolKey(demoPool.poolKey);
    if (!sourcePoolKey) throw new Error("Missing Demo source pool key");
    const sourcePool = getPoolsForSpace(KRAKEN_SPACE_SLUG).find((pool) => pool.poolKey === sourcePoolKey);
    if (!sourcePool) throw new Error("Missing Demo source pool");

    expect(resolvePoolKeyForSpace(sourcePoolKey, DEMO_SPACE_SLUG)).toBe(demoPool.poolKey);
    expect(resolveDashboardViewForSpace(
      { kind: "rfq", poolKey: sourcePoolKey },
      DEMO_SPACE_SLUG,
    )).toEqual({ kind: "rfq", poolKey: demoPool.poolKey });
    expect(resolvePoolKeyForSpace(`demo-${sourcePool.key}`, DEMO_SPACE_SLUG))
      .toBe(demoPool.poolKey);
  });

  it("keeps Demo RFQ and SLA fixtures synthetic even when callers pass source xStock symbols", () => {
    const response = getDemoRfqApiResponse("cowswap", "TSLAx") as { data: Array<{ asset?: string }>; meta: unknown };
    const buckets = getDemoDailyBuckets({ assets: ["TSLAx", "SPYx"], days: 2 });
    const serialized = JSON.stringify({ response, buckets });

    expect(response.data.length).toBeGreaterThan(0);
    expect(buckets.data.length).toBeGreaterThan(0);
    expect(response.data.every((row) => row.asset === DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol)).toBe(true);
    expect(buckets.data.every((row) =>
      row.asset === DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol ||
      row.asset === DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.SPYx.symbol
    )).toBe(true);
    expect(containsRealXStockDemoSource(serialized)).toBe(false);
    expect(serialized).not.toMatch(SOURCE_SYMBOL_PATTERN);
  });
});

describe("Demo chart fixture sufficiency against Kraken structure", () => {
  it("has one coherent Demo chart data bundle for each Kraken-visible Solana pool", () => {
    const krakenPools = getPoolsForSpace(KRAKEN_SPACE_SLUG).filter(
      (pool) => pool.chain === "solana",
    );
    const demoPools = getPoolsForSpace(DEMO_SPACE_SLUG);
    const tokenPrices = getDemoTokenPrices();
    const priceRpc = getDemoPoolPricesRpc(demoPools.map((pool) => pool.poolKey));
    const tradingVolume = getDemoTradingVolumeBySize();

    expect(demoPools).toHaveLength(krakenPools.length);
    expect(tradingVolume.dailyData.length).toBeGreaterThan(7);
    expect(tradingVolume.dailyData.every((row) => row.total > 0)).toBe(true);

    for (const demoPool of demoPools) {
      const sourcePoolKey = getDemoSourcePoolKey(demoPool.poolKey);
      const sourcePool = krakenPools.find((pool) => pool.poolKey === sourcePoolKey);
      expect(sourcePool).toBeTruthy();
      expect(demoPool.protocol).toBe(sourcePool?.protocol);
      expect(demoPool.chain).toBe(sourcePool?.chain);

      const metadata = getSolanaPoolMetadata(demoPool.poolKey);
      if (!metadata?.token0Mint || !metadata.token1Mint) {
        throw new Error(`Missing Demo metadata for ${demoPool.poolKey}`);
      }

      const pool = getDemoPoolData(demoPool.poolKey);
      const positions = getDemoPoolDataResponse({
        poolKey: demoPool.poolKey,
        startTime: END_TIME - 7 * 86400,
        endTime: END_TIME,
      });
      const candles = getDemoCandles({
        poolKey: demoPool.poolKey,
        intervalSeconds: 300,
        startTime: END_TIME - 86400,
        endTime: END_TIME,
      });
      const historicalPrices = getDemoHistoricalPrices({
        tokenAddress: metadata.token0Mint,
        startTime: END_TIME - 7 * 86400,
        endTime: END_TIME,
      });
      const swaps = getDemoLpSwaps({
        poolKey: demoPool.poolKey,
        startTime: END_TIME - 86400,
        endTime: END_TIME,
      });
      const lpSummary = getDemoLpSummary(demoPool.poolKey);

      expect(pool.currentPrice).toBeGreaterThan(0);
      expect(Number(pool.liquidity)).toBeGreaterThan(0);
      expect(Number(pool.token0Balance)).toBeGreaterThan(0);
      expect(Number(pool.token1Balance)).toBeGreaterThan(0);
      expect(priceRpc.prices[demoPool.poolKey]?.price).toBeGreaterThan(0);
      expect(tokenPrices.pricesUsdByAddress[metadata.token0Mint.toLowerCase()]).toBeGreaterThan(0);
      expect(tokenPrices.pricesUsdByAddress[metadata.token1Mint.toLowerCase()]).toBeGreaterThan(0);

      expect(candles.length).toBeGreaterThan(100);
      expect(candles.every((candle) => {
        const open = Number(candle.openPrice);
        const high = Number(candle.highPrice);
        const low = Number(candle.lowPrice);
        const close = Number(candle.closePrice);
        return low <= open && low <= close && high >= open && high >= close && Number(candle.volume1) > 0;
      })).toBe(true);

      expect(positions.positions.length).toBeGreaterThan(0);
      expect(positions.positions.some((position) =>
        position.tickLower < pool.tick && position.tickUpper > pool.tick
      )).toBe(true);
      expect(positions.ownerAggregates.length).toBeGreaterThan(0);
      expect(positions.lpevents.length).toBeGreaterThan(0);
      expect(positions.uniswapV3PoolMints.length).toBeGreaterThan(0);
      expect(positions.poolHourDatas.length).toBeGreaterThan(24);
      expect(positions.poolHourDatas.every((row) =>
        Number(row.volumeToken1) > 0 &&
        Number(row.feesToken1) > 0 &&
        Number(row.closePrice) > 0
      )).toBe(true);
      expect(positions.lpActivitySeries.length).toBeGreaterThan(24);
      expect(positions.lpActivitySeries.every((row) =>
        row.depth_band_buy > 0 && row.depth_band_sell > 0
      )).toBe(true);

      expect(historicalPrices.prices.length).toBeGreaterThan(24);
      expect(historicalPrices.prices.every((point) => point.price > 0)).toBe(true);
      expect(swaps.length).toBeGreaterThanOrEqual(24);
      expect(lpSummary.data.length).toBeGreaterThan(0);
    }
  });

  it("feeds every Kraken-level Demo surface with non-empty synthetic-only fixtures", () => {
    const demoAssets = Object.values(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL).map((config) => config.symbol);
    const birdsEye = getDemoBirdsEyeSnapshot();
    const krakenPools = getDemoKrakenPools();
    const makerVolume = getDemoMakerVolume(30);
    const poolNetFlow = getDemoPoolNetFlow("30d");
    const flowdeskFlow = getDemoFlowdeskRfqFlow("30d");
    const arbVolume = getDemoArbVolume();
    const poolBackedAssets = getDemoPoolBackedAssets();
    const dailyBuckets = getDemoDailyBuckets({
      assets: ["TSLAx", "SPYx", "NVDAx"],
      days: 7,
    });

    expect(birdsEye.pools.length).toBe(getPoolsForSpace(DEMO_SPACE_SLUG).length);
    expect(birdsEye.pools.every((row) =>
      row.positionsByOwner.length > 0 &&
      Number(row.poolData.liquidity) > 0
    )).toBe(true);

    expect(krakenPools.assets.length).toBe(demoAssets.length);
    expect(krakenPools.totalPoolCount).toBe(getPoolsForSpace(DEMO_SPACE_SLUG).length);
    expect(krakenPools.assets.every((asset) =>
      demoAssets.includes(asset.symbol) &&
      asset.poolCount > 0 &&
      asset.totalLiquidityUsd > 0 &&
      asset.totalVolume24hUsd > 0
    )).toBe(true);

    expect(arbVolume.assets.length).toBe(demoAssets.length);
    expect(arbVolume.summary.totalVolumeUsd).toBeGreaterThan(0);
    expect(arbVolume.assets.every((asset) =>
      demoAssets.includes(asset.asset) &&
      asset.pools.length > 0 &&
      asset.totalVolumeUsd > 0
    )).toBe(true);

    expect(makerVolume.data.length).toBeGreaterThan(0);
    expect(new Set(makerVolume.data.map((row) => row.symbol)).size).toBeGreaterThan(1);
    expect(makerVolume.data.every((row) =>
      demoAssets.includes(row.symbol) &&
      Number(row.volume_usd) > 0 &&
      Number(row.price_usd) > 0
    )).toBe(true);

    expect(poolNetFlow.days.length).toBeGreaterThan(20);
    expect(poolNetFlow.pools.length).toBe(getPoolsForSpace(DEMO_SPACE_SLUG).length);
    expect(poolNetFlow.totals.swapCount).toBeGreaterThan(0);
    expect(flowdeskFlow.days.length).toBeGreaterThan(20);
    expect(flowdeskFlow.totals.txCount).toBeGreaterThan(0);
    expect(dailyBuckets.data.length).toBeGreaterThan(0);
    expect(dailyBuckets.data.every((row) =>
      demoAssets.includes(row.asset) &&
      row.sample_count > 0 &&
      row.median_bps > 0
    )).toBe(true);

    for (const provider of ["jupiter", "cowswap", "bebop", "0x", "1inch", "jupz"]) {
      for (const asset of ["TSLAx", demoAssets[0]]) {
        const response = getDemoRfqApiResponse(provider, asset) as {
          data: Array<{
            asset?: string;
            pair_key?: string;
            notional_usd?: string;
            is_success?: boolean;
          }>;
          meta?: { applied_filters?: { asset?: string | null } };
        };
        expect(response.data.length).toBeGreaterThan(0);
        expect(demoAssets).toContain(response.meta?.applied_filters?.asset);
        expect(response.data.every((row) =>
          Boolean(row.is_success) &&
          (row.asset ? demoAssets.includes(row.asset) : demoAssets.some((demoAsset) => row.pair_key?.startsWith(`${demoAsset}/`))) &&
          Number(row.notional_usd) > 0
        )).toBe(true);
      }
    }

    for (const asset of ["TSLAx", demoAssets[0]]) {
      expect(getDemoOhlcCandles({ pair: `${asset}USD`, since: START_TIME, endTime: END_TIME }).length)
        .toBeGreaterThan(0);
      expect(getDemoFinnhubCandles({ symbol: asset, resolution: "5", from: START_TIME, to: END_TIME }).length)
        .toBeGreaterThan(0);
    }

    expect(poolBackedAssets.length).toBe(getPoolsForSpace(DEMO_SPACE_SLUG).length);
    expect(JSON.stringify({
      birdsEye,
      krakenPools,
      makerVolume,
      poolNetFlow,
      flowdeskFlow,
      arbVolume,
      poolBackedAssets,
      dailyBuckets,
    })).not.toMatch(SOURCE_SYMBOL_PATTERN);
  });
});

describe("Demo route guards", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let demoPoolKey: string;
  let demoSourcePoolKey: string;
  let demoAsset: string;
  let demoMint: string;

  beforeEach(() => {
    const demoPool = getPoolsForSpace(DEMO_SPACE_SLUG)[0];
    if (!demoPool) throw new Error("Missing Demo pool fixture");
    const metadata = getSolanaPoolMetadata(demoPool.poolKey);
    if (!metadata?.token0Mint) throw new Error("Missing Demo pool metadata");
    const sourcePoolKey = getDemoSourcePoolKey(demoPool.poolKey);
    if (!sourcePoolKey) throw new Error("Missing Demo source pool key");
    demoPoolKey = demoPool.poolKey;
    demoSourcePoolKey = sourcePoolKey;
    demoAsset = metadata.token0Symbol;
    demoMint = metadata.token0Mint;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("live fetch blocked"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fixtures before live fetchers for Kraken-visible endpoints", async () => {
    const routeCalls: Array<() => Promise<Response>> = [
      () => getPool(request(`/api/pool/${demoPoolKey}`), { params: Promise.resolve({ address: demoPoolKey }) }),
      () => getPoolData(request(`/api/pool-data?pool=${demoPoolKey}&startTime=${START_TIME}&endTime=${END_TIME}`)),
      () => getPoolData(request(`/api/pool-data?pool=${demoSourcePoolKey}&startTime=${START_TIME}&endTime=${END_TIME}&space=demo`)),
      () => getCandles(request(`/api/candles?pool=${demoPoolKey}&interval=300&startTime=${START_TIME}&endTime=${END_TIME}`)),
      () => getPoolPricesRpc(request(`/api/pool-prices-rpc?pools=${demoPoolKey}`)),
      () => getPoolPricesRpc(request(`/api/pool-prices-rpc?pools=${demoSourcePoolKey}&space=demo`)),
      () => getHistoricalPrices(request(`/api/historical-prices?tokenAddress=${demoMint}&startTime=${START_TIME}&endTime=${END_TIME}&space=demo`)),
      () => getKrakenOhlc(request(`/api/kraken-ohlc?pair=${demoAsset}USD&interval=5&since=${START_TIME}&endTime=${END_TIME}&space=demo`)),
      () => getFinnhubCandles(request(`/api/finnhub-candles?symbol=${demoAsset}&resolution=5&from=${START_TIME}&to=${END_TIME}&space=demo`)),
      () => getTokenPrices(request("/api/token-prices?space=demo")),
      () => getLpSwaps(request(`/api/lp-swaps?pool=${demoPoolKey}&startTime=${START_TIME}&endTime=${END_TIME}`)),
      () => getLpSummary(request(`/api/lp/summary?pool=${demoPoolKey}&limit=10`)),
      () => getTradingVolumeBySize(request(`/api/trading-volume-by-size?pool=${demoPoolKey}&days=7`)),
      () => getArbVolume(request(`/api/arb-volume?pool=${demoPoolKey}&space=demo`)),
      () => getArbVolume(request(`/api/arb-volume?asset=${demoAsset}`)),
      () => getKrakenPools(request("/api/kraken-pools?space=demo")),
      () => getBirdsEyeSnapshot(request("/api/birds-eye-snapshot?space=demo")),
      () => getFlowdeskRfqFlow(request("/api/xstocks/flowdesk-rfq-flow?space=demo&range=30d")),
    ];

    for (const call of routeCalls) {
      const response = await call();
      expect(response.status).toBe(200);
      await response.json();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Demo direct-indexer hook fetchers", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("live fetch blocked"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns local RFQ and Flow fixtures without external URLs", async () => {
    const demoPoolKey = getPoolsForSpace(DEMO_SPACE_SLUG)[0]?.poolKey;
    if (!demoPoolKey) throw new Error("Missing Demo pool fixture");
    const demoAsset = DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL.TSLAx.symbol;

    const results = await Promise.all([
      fetchJupiterRfqQuotes(demoPoolKey, { includeRoutes: true }),
      fetchCowswapRfqQuotes(demoAsset, DEMO_SPACE_SLUG),
      fetchCowswapHistory(demoAsset, undefined, DEMO_SPACE_SLUG),
      fetchBebopRfqQuotes(demoAsset, DEMO_SPACE_SLUG),
      fetchBebopHistory(demoAsset, undefined, DEMO_SPACE_SLUG),
      fetchZeroXRfqQuotes(demoAsset, DEMO_SPACE_SLUG),
      fetchZeroXHistory(demoAsset, undefined, DEMO_SPACE_SLUG),
      fetchOneInchRfqQuotes(demoAsset, DEMO_SPACE_SLUG),
      fetchOneInchHistory(demoAsset, undefined, DEMO_SPACE_SLUG),
      fetchJupzRfqQuotes(demoAsset, DEMO_SPACE_SLUG),
      fetchJupzHistory(demoAsset, undefined, DEMO_SPACE_SLUG),
      fetchBirdsEyeRfqQuotes("/api/rfq/cowswap/latest", DEMO_SPACE_SLUG),
      fetchDailyBuckets({ spaceSlug: DEMO_SPACE_SLUG, assets: [demoAsset], days: 7 }),
      fetchRfqQuoteActivity(7, DEMO_SPACE_SLUG),
      fetchXstocksMakerVolume(7, undefined, DEMO_SPACE_SLUG),
      fetchKrakenPoolNetFlow(DEMO_SPACE_SLUG, "30d"),
      fetchFlowdeskRfqFlow("30d", undefined, DEMO_SPACE_SLUG),
    ]);

    expect(results.every((result) => {
      if (Array.isArray(result)) return result.length > 0;
      if (result && typeof result === "object" && "data" in result) return Array.isArray(result.data) && result.data.length > 0;
      if (result && typeof result === "object" && "days" in result) return Array.isArray(result.days) && result.days.length > 0;
      return Boolean(result);
    })).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps Demo quote activity synthetic and source-label free", () => {
    const response = getDemoQuoteActivity(7);
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.meta).toMatchObject({
      days: 7,
      uptime_definition: "expected_cycles",
    });
    expect(response.data.every((row) => row.asset.length === 3)).toBe(true);
    expect(JSON.stringify(response)).not.toMatch(SOURCE_SYMBOL_PATTERN);
  });
});
