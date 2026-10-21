import { describe, expect, it } from "vitest";

import { getSqrtRatioAtTick } from "@/lib/depth-calculator";
import type { PositionData } from "@/lib/envio-client";
import {
  ROUTING_ORDER_SIZES_USD,
  prepareRoutingPools,
  routeOrderAcrossPools,
  routePreparedOrderAcrossPools,
  type RoutingPoolInput,
  type RoutingResult,
  type RoutingSide,
} from "@/lib/routing-engine";

function makePosition(overrides: Partial<PositionData> = {}): PositionData {
  return {
    id: "position-1",
    tokenId: "position-1",
    pool: "1-v4-0xpool-a",
    owner: "0xowner",
    tickLower: -600,
    tickUpper: 600,
    liquidity: "100000000000000000000",
    updatedAt: 0,
    ...overrides,
  };
}

function makeRoutingPool(overrides: Partial<RoutingPoolInput> = {}): RoutingPoolInput {
  const poolKey = overrides.poolKey ?? "1-v4-0xpool-a";

  return {
    poolKey,
    key: "uniswap-v4-ai-usdc-099",
    label: "AI / USDC",
    venue: "v4",
    feeTier: "0.99%",
    feeRaw: 9900,
    positions: [makePosition({ pool: poolKey })],
    sqrtPriceX96: getSqrtRatioAtTick(0).toString(),
    currentTick: 0,
    currentPrice: 1,
    token0Decimals: 6,
    token1Decimals: 6,
    token0UsdPrice: 1,
    token1UsdPrice: 1,
    isTrackedToken0: true,
    ...overrides,
  };
}

function expectRoutingClose(actual: RoutingResult, expected: RoutingResult) {
  expect(actual.side).toBe(expected.side);
  expect(actual.orderUsd).toBe(expected.orderUsd);
  expect(actual.capacityExceeded).toBe(expected.capacityExceeded);
  expect(actual.totalInputUsd).toBeCloseTo(expected.totalInputUsd, 8);
  expect(actual.totalOutputUsd).toBeCloseTo(expected.totalOutputUsd, 8);
  expect(actual.effectiveImpactPct).toBeCloseTo(expected.effectiveImpactPct, 8);
  expect(actual.allocations).toHaveLength(expected.allocations.length);

  for (let i = 0; i < expected.allocations.length; i++) {
    const actualAlloc = actual.allocations[i];
    const expectedAlloc = expected.allocations[i];
    expect(actualAlloc.poolKey).toBe(expectedAlloc.poolKey);
    expect(actualAlloc.inputUsd).toBeCloseTo(expectedAlloc.inputUsd, 8);
    expect(actualAlloc.outputUsd).toBeCloseTo(expectedAlloc.outputUsd, 8);
    expect(actualAlloc.sharePct).toBeCloseTo(expectedAlloc.sharePct, 8);
    expect(actualAlloc.effectivePrice).toBeCloseTo(expectedAlloc.effectivePrice, 8);
  }
}

describe("effectiveImpactPct under capacity pressure", () => {
  it("penalises the unfilled portion when the requested order exceeds available liquidity", () => {
    // Tiny pool: liquidity is ~12 orders of magnitude smaller than the standard
    // makeRoutingPool default. A $100k order against this pool can only absorb a
    // small fraction of the request before the swap drains every active tick.
    const tinyPool = makeRoutingPool({
      positions: [makePosition({ liquidity: "1000000000" })],
    });

    const result = routeOrderAcrossPools({
      pools: [tinyPool],
      side: "buyTracked",
      orderUsd: 100_000,
    });

    expect(result.capacityExceeded).toBe(true);
    expect(result.totalInputUsd).toBeLessThan(100_000);
    // Impact must be measured against the *requested* $100k, not the partial
    // fill: an order that can only route ~$X out of $100k has effectively lost
    // most of its value to the unfillable portion. A previous bug used the
    // partial-fill input as the denominator and happily reported tiny impacts
    // for severely depleted pools — which made "remove 90% of the LPs" look
    // like depth got better.
    expect(result.effectiveImpactPct).toBeGreaterThan(50);
  });

  it("collapses to baseline impact when capacity is plenty", () => {
    // A well-funded pool — the default position has ~1e20 raw liquidity.
    const healthyPool = makeRoutingPool();

    const result = routeOrderAcrossPools({
      pools: [healthyPool],
      side: "buyTracked",
      orderUsd: 10_000,
    });

    expect(result.capacityExceeded).toBe(false);
    expect(result.totalInputUsd).toBeCloseTo(10_000, 4);
    // Order sat well within capacity, so impact should reflect just fee + a
    // sliver of price movement — well under the 50% capacity-exceeded floor.
    expect(result.effectiveImpactPct).toBeLessThan(5);
  });
});

describe("asymmetric LP removal — direction selectivity", () => {
  // Validates the V3 invariant the user expected: removing an LP whose
  // positions are *entirely below* currentTick (USDC-side only, for an
  // AI/USDC pool with AI=token0) must NOT degrade buy depth, only sell
  // depth. A position with tickUpper ≤ currentTick is never touched by a
  // buy swap (which walks UP through ticks > currentTick), so removing it
  // is invisible to the buy side.
  it("removing a USDC-only LP (range entirely below currentTick) leaves buy depth untouched and only degrades sell depth", () => {
    // Two LPs at the same liquidity scale, but in disjoint ranges:
    //   - "usdcOnly":  ticks [-2000, -100]  → entirely below currentTick=0  → 100% USDC
    //   - "aiOnly":    ticks [100, 2000]    → entirely above currentTick=0  → 100% AI
    const usdcOnly = makePosition({
      id: "usdc-only-1",
      tokenId: "usdc-only-1",
      owner: "0xusdc",
      tickLower: -2000,
      tickUpper: -100,
      liquidity: "100000000000000000000",
    });
    const aiOnly = makePosition({
      id: "ai-only-1",
      tokenId: "ai-only-1",
      owner: "0xai",
      tickLower: 100,
      tickUpper: 2000,
      liquidity: "100000000000000000000",
    });

    const baseline = makeRoutingPool({ positions: [usdcOnly, aiOnly] });
    // Scenario: simulate fragility chart removing the usdc-only owner.
    const usdcRemoved = makeRoutingPool({ positions: [aiOnly] });
    // Inverse scenario: remove the ai-only owner.
    const aiRemoved = makeRoutingPool({ positions: [usdcOnly] });

    // BUY side
    const baselineBuy = routeOrderAcrossPools({ pools: [baseline], side: "buyTracked", orderUsd: 10_000 });
    const usdcRemovedBuy = routeOrderAcrossPools({ pools: [usdcRemoved], side: "buyTracked", orderUsd: 10_000 });
    const aiRemovedBuy = routeOrderAcrossPools({ pools: [aiRemoved], side: "buyTracked", orderUsd: 10_000 });

    // Removing the USDC-only LP must not change buy impact at all (its range
    // is below currentTick, never reached by a buy that walks upward).
    expect(usdcRemovedBuy.effectiveImpactPct).toBeCloseTo(baselineBuy.effectiveImpactPct, 6);
    // Removing the AI-only LP wipes out all buy-side depth (only LP that had
    // AI is gone) — capacity must be exceeded.
    expect(aiRemovedBuy.capacityExceeded).toBe(true);
    expect(aiRemovedBuy.effectiveImpactPct).toBeGreaterThan(baselineBuy.effectiveImpactPct);

    // SELL side — mirror image
    const baselineSell = routeOrderAcrossPools({ pools: [baseline], side: "sellTracked", orderUsd: 10_000 });
    const usdcRemovedSell = routeOrderAcrossPools({ pools: [usdcRemoved], side: "sellTracked", orderUsd: 10_000 });
    const aiRemovedSell = routeOrderAcrossPools({ pools: [aiRemoved], side: "sellTracked", orderUsd: 10_000 });

    // Removing the USDC-only LP wipes out sell-side depth.
    expect(usdcRemovedSell.capacityExceeded).toBe(true);
    expect(usdcRemovedSell.effectiveImpactPct).toBeGreaterThan(baselineSell.effectiveImpactPct);
    // Removing the AI-only LP must not change sell impact.
    expect(aiRemovedSell.effectiveImpactPct).toBeCloseTo(baselineSell.effectiveImpactPct, 6);
  });
});

describe("prepared routing helpers", () => {
  it("uses the Gensyn audit ladder for both buy and sell impact samples", () => {
    expect(ROUTING_ORDER_SIZES_USD).toEqual([
      1_000,
      5_000,
      10_000,
      25_000,
      50_000,
      100_000,
    ]);

    const preparedPools = prepareRoutingPools([makeRoutingPool()]);
    const sides: RoutingSide[] = ["buyTracked", "sellTracked"];

    for (const side of sides) {
      const impacts = ROUTING_ORDER_SIZES_USD.map((orderUsd) => {
        const result = routePreparedOrderAcrossPools({
          preparedPools,
          side,
          orderUsd,
        });
        expect(result.orderUsd).toBe(orderUsd);
        expect(result.totalInputUsd).toBeCloseTo(orderUsd, 4);
        expect(result.capacityExceeded).toBe(false);
        return result.effectiveImpactPct;
      });

      for (let i = 1; i < impacts.length; i++) {
        expect(impacts[i]).toBeGreaterThanOrEqual(impacts[i - 1]!);
      }
    }
  });

  it("matches routeOrderAcrossPools for every dashboard order size and side", () => {
    const pools = [
      makeRoutingPool(),
      makeRoutingPool({
        poolKey: "1-v4-0xpool-b",
        key: "uniswap-v3-ai-usdc-001",
        venue: "v3",
        feeTier: "0.01%",
        feeRaw: 100,
        positions: [
          makePosition({
            id: "position-2",
            tokenId: "position-2",
            pool: "1-v4-0xpool-b",
            tickLower: -300,
            tickUpper: 300,
            liquidity: "60000000000000000000",
          }),
        ],
      }),
    ];
    const preparedPools = prepareRoutingPools(pools);
    const sides: RoutingSide[] = ["buyTracked", "sellTracked"];

    for (const side of sides) {
      for (const orderUsd of ROUTING_ORDER_SIZES_USD) {
        const legacy = routeOrderAcrossPools({ pools, side, orderUsd });
        const prepared = routePreparedOrderAcrossPools({
          preparedPools,
          side,
          orderUsd,
        });
        expectRoutingClose(prepared, legacy);
      }
    }
  });
});
