import { describe, expect, it } from "vitest";

import type { PoolData } from "@/app/api/pool/[address]/route";
import type { PositionData } from "@/lib/envio-client";
import {
  computeBalanceTvlUsd,
  computePositionTokenBalances,
  computePositionTvlUsd,
  resolvePoolTvlUsd,
} from "@/lib/pool-tvl";
import { getSqrtRatioAtTick } from "@/lib/uniswap-v3-math";

function makePool(overrides: Partial<PoolData> = {}): PoolData {
  return {
    protocol: "v4",
    analyticsModel: "evm-v4",
    capabilities: {
      hasCandleHistory: true,
      hasSwapHistory: true,
      hasWalletFeeSummary: true,
      hasOwnerPositionSummary: true,
      hasRangeLiquidityShape: true,
      hasHistoricalDepthBands: true,
      hasCurrentImpactCurve: true,
      hasHistoricalSlippage: true,
      hasOwnerCompositionHistory: true,
    },
    poolAddress: "1-v4-0xpool",
    token0Address: "0xtoken0",
    token1Address: "0xtoken1",
    fee: 3000,
    tickSpacing: 60,
    token0Symbol: "AI",
    token1Symbol: "USDC",
    token0Decimals: 6,
    token1Decimals: 6,
    sqrtPriceX96: getSqrtRatioAtTick(0).toString(),
    tick: 0,
    liquidity: "1000000000000",
    token0Balance: "0",
    token1Balance: "0",
    token0BalanceRaw: "0",
    token1BalanceRaw: "0",
    currentPrice: 1,
    token0Percent: 50,
    token1Percent: 50,
    ...overrides,
  };
}

function makePosition(overrides: Partial<PositionData> = {}): PositionData {
  return {
    id: "position-1",
    tokenId: "position-1",
    pool: "1-v4-0xpool",
    owner: "0xowner",
    tickLower: -120,
    tickUpper: 120,
    liquidity: "1000000000000",
    updatedAt: 0,
    ...overrides,
  };
}

describe("pool TVL helpers", () => {
  it("uses pool balances when they are available", () => {
    const poolData = makePool({
      token0Balance: "10",
      token1Balance: "20",
    });

    const tvlUsd = resolvePoolTvlUsd({
      poolData,
      positions: [makePosition()],
      token0Usd: 2,
      token1Usd: 1,
    });

    expect(computeBalanceTvlUsd({ poolData, token0Usd: 2, token1Usd: 1 })).toBe(40);
    expect(tvlUsd).toBe(40);
  });

  it("falls back to active position value when v4 balances are zero", () => {
    const poolData = makePool();
    const positions = [makePosition()];

    const positionTvlUsd = computePositionTvlUsd({
      poolData,
      positions,
      token0Usd: 2,
      token1Usd: 1,
    });
    const tvlUsd = resolvePoolTvlUsd({
      poolData,
      positions,
      token0Usd: 2,
      token1Usd: 1,
    });

    expect(positionTvlUsd).toBeGreaterThan(0);
    expect(tvlUsd).toBe(positionTvlUsd);
  });

  it("derives token balances from active positions for v4 zero-balance pools", () => {
    const poolData = makePool();
    const positions = [
      makePosition({
        id: "position-below",
        tokenId: "position-below",
        tickLower: -120,
        tickUpper: 120,
      }),
      makePosition({
        id: "position-above",
        tokenId: "position-above",
        tickLower: 120,
        tickUpper: 240,
      }),
    ];

    const balances = computePositionTokenBalances({ poolData, positions });
    expect(balances).not.toBeNull();
    expect(balances?.token0Balance).toBeGreaterThan(0);
    expect(balances?.token1Balance).toBeGreaterThan(0);
    expect(balances?.token0Percent).toBeGreaterThan(0);
    expect(balances?.token1Percent).toBeGreaterThan(0);

    const positionTvlUsd = computePositionTvlUsd({
      poolData,
      positions,
      token0Usd: 2,
      token1Usd: 1,
    });
    expect(positionTvlUsd).toBeCloseTo(
      (balances?.token0Balance ?? 0) * 2 + (balances?.token1Balance ?? 0),
      8,
    );
  });
});
