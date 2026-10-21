import { describe, expect, it } from "vitest";

import { ZEROG_W0G_USDCE_V3_POOL_KEY } from "@/lib/pools";
import {
  normalizeLiquidityDepthPayload,
  supportsHistoricalLiquidityDepth,
} from "@/lib/liquidity-depth";

const RAYDIUM_POOL_KEY = "DYxp5fh3Eh7iDEVHv9bFLGnPwvXwFe5YWpGayJuzzbgd";

describe("liquidity depth payload", () => {
  it("normalizes a valid materialized payload", () => {
    const payload = normalizeLiquidityDepthPayload({
      times: [1, 2],
      priceBins: [99, 100, 101],
      values: [
        [0, 1000, 0],
        [0, 1500, 0],
      ],
      priceLine: [100, 100.5],
      ownerBands: [{
        owner: "ABCDEF123456",
        tickLower: -100,
        tickUpper: 100,
        L: 5000,
        openedAt: 1,
        end: 3,
        closed: false,
      }],
      owners: [{
        owner: "ABCDEF123456",
        valueUsd: 250,
        activeBandCount: 1,
        closedBandCount: 0,
        lastClosedAt: 0,
      }],
      quality: {
        reconciled: true,
        mismatchPct: 0,
        reconstructedLiquidity: 1500,
        indexedLiquidity: 1500,
        latestTick: 0,
        thresholdPct: 5,
        warnings: [],
      },
      meta: {
        pool: RAYDIUM_POOL_KEY,
        protocol: "raydium-clmm",
        schemaVersion: 2,
        windowDays: 7,
        resolution: "1h",
        resolutionSeconds: 3600,
        priceBins: 3,
        startTime: 1,
        endTime: 2,
        source: "indexer-native",
        valueMode: "usd",
        ownerAttribution: true,
        ownerBandCount: 1,
        ownerCount: 1,
        token0Decimals: 8,
        token1Decimals: 6,
        materializedAt: "2026-06-07T00:00:00.000Z",
      },
    });

    expect(payload?.times).toEqual([1, 2]);
    expect(payload?.values[1][1]).toBe(1500);
    expect(payload?.quality.reconciled).toBe(true);
    expect(payload?.meta.valueMode).toBe("usd");
    expect(payload?.meta.ownerAttribution).toBe(true);
    expect(payload?.ownerBands?.[0]?.owner).toBe("abcdef123456");
    expect(payload?.owners?.[0]?.owner).toBe("abcdef123456");
  });

  it("rejects malformed grid dimensions", () => {
    expect(
      normalizeLiquidityDepthPayload({
        times: [1, 2],
        priceBins: [99, 100],
        values: [[1, 2]],
        priceLine: [100, 101],
        quality: { reconciled: false, warnings: [] },
        meta: {},
      })
    ).toBeNull();
  });

  it("preserves EVM v3 protocol metadata", () => {
    const payload = normalizeLiquidityDepthPayload({
      times: [1],
      priceBins: [99, 100],
      values: [[0, 1000]],
      priceLine: [100],
      quality: {
        reconciled: true,
        mismatchPct: 0,
        reconstructedLiquidity: 1000,
        indexedLiquidity: 1000,
        latestTick: 0,
        thresholdPct: 5,
        warnings: [],
      },
      meta: {
        pool: ZEROG_W0G_USDCE_V3_POOL_KEY,
        protocol: "uniswap-v3",
        windowDays: 7,
        resolution: "1h",
        resolutionSeconds: 3600,
        priceBins: 2,
        startTime: 1,
        endTime: 1,
        source: "indexer-native",
        valueMode: "usd",
        token0Decimals: 18,
        token1Decimals: 6,
        materializedAt: "2026-06-08T00:00:00.000Z",
      },
    });

    expect(payload?.meta.protocol).toBe("uniswap-v3");
    expect(payload?.meta.valueMode).toBe("usd");
    expect(payload?.meta.token0Decimals).toBe(18);
    expect(payload?.meta.token1Decimals).toBe(6);
  });

  it("supports real Raydium and allowlisted 0G pools but not Demo synthetic pools", () => {
    expect(supportsHistoricalLiquidityDepth(RAYDIUM_POOL_KEY)).toBe(true);
    expect(supportsHistoricalLiquidityDepth(ZEROG_W0G_USDCE_V3_POOL_KEY)).toBe(true);
    expect(supportsHistoricalLiquidityDepth(`demo-${RAYDIUM_POOL_KEY}`)).toBe(false);
  });
});
