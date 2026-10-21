import { describe, expect, it } from "vitest";

import {
  shouldForcePerleBscPancakeTickDistribution,
  shouldUseWorldchainTickDistribution,
  type WorldchainPoolDataMeta,
} from "@/lib/worldchain-pool-data";
import { PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY } from "@/lib/pools";

const WORLDCHAIN_V4_WARS_USDC =
  "480-v4-0xe7bba98b4e9c077d0af3b91b4ecfcdc68e3214917ed4e361ed28eb60e87ea6fa";
const GENSYN_V4_AI_USDC =
  "1-v4-0x45987a457854bb7205086e0826ab2988e556f0fef7af4299ab5febb9fc13d8d4";

function makeMeta(
  distributionSource: WorldchainPoolDataMeta["decisions"]["distributionSource"]
): WorldchainPoolDataMeta {
  return {
    latest: {
      positionUpdatedAt: null,
      ownerAggregateUpdatedAt: null,
      lpEventTimestamp: null,
      poolHourTimestamp: null,
      tickUpdatedAt: null,
      latestTradingSignal: null,
    },
    counts: {
      positions: 0,
      ownerAggregates: 0,
      lpevents: 0,
      poolHourDatas: 0,
      tickLiquidities: 0,
      lpActivitySeries: 0,
      ownerAddressesWithPositions: 0,
      ownerAggregatesMissingPositions: 0,
    },
    selectedOwner: null,
    coverage: {
      rawLiquidityRatio: null,
      rawLiquidityMatchesPool: null,
      valueRatio: null,
      ownerAggregateCoverageRatio: null,
    },
    freshness: {
      positionUpdatedWithinWindow: false,
      ownerAggregateUpdatedWithinWindow: false,
      lpEventsPresentInWindow: false,
      positionLagSeconds: null,
      ownerAggregateLagSeconds: null,
      lpEventLagSeconds: null,
    },
    currentStateStatus: "empty",
    authoritativeEmptyWindow: false,
    decisions: {
      distributionSource,
      ownerSummarySource: "none",
      eventTimeSeriesSource: "none",
      selectedOwnerSource: "none",
    },
  };
}

function selectsTickDistribution(poolKey: string, meta: WorldchainPoolDataMeta): boolean {
  return (
    shouldUseWorldchainTickDistribution(meta) ||
    shouldForcePerleBscPancakeTickDistribution(poolKey)
  );
}

describe("Worldchain pool data source selection", () => {
  it("selects tick distribution for the Perle BSC Pancake Infinity CL pool", () => {
    expect(
      selectsTickDistribution(PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY, makeMeta("positions"))
    ).toBe(true);
  });

  it("keeps Worldchain and Gensyn v4 position-based source behavior unchanged", () => {
    expect(
      selectsTickDistribution(WORLDCHAIN_V4_WARS_USDC, makeMeta("positions"))
    ).toBe(false);
    expect(selectsTickDistribution(GENSYN_V4_AI_USDC, makeMeta("positions"))).toBe(
      false
    );
  });

  it("keeps metadata-driven tick fallback semantics for existing pools", () => {
    expect(selectsTickDistribution(WORLDCHAIN_V4_WARS_USDC, makeMeta("ticks"))).toBe(
      true
    );
    expect(selectsTickDistribution(GENSYN_V4_AI_USDC, makeMeta("ticks"))).toBe(true);
  });

  it("treats non-Worldchain metadata without decisions as position-based", () => {
    const solanaLikeMeta = { source: "demo-fixture", partial: false } as unknown as WorldchainPoolDataMeta;
    expect(shouldUseWorldchainTickDistribution(solanaLikeMeta)).toBe(false);
  });
});
