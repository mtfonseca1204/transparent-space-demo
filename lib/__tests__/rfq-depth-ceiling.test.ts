import { describe, expect, it } from "vitest";

import {
  buildMedianBuyPriceMap,
  computeRfqBuySideDepthCeiling,
  type RfqBuySideTier,
} from "@/lib/rfq-depth-ceiling";

describe("rfq depth ceiling", () => {
  it("uses the highest sane buy-side notional as the discovered ceiling", () => {
    const latestTiers: RfqBuySideTier[] = [
      { notionalUsd: 1_000, buyPrice: 100 },
      { notionalUsd: 10_000, buyPrice: 101 },
      { notionalUsd: 75_000, buyPrice: 108 },
    ];

    expect(
      computeRfqBuySideDepthCeiling(latestTiers, buildMedianBuyPriceMap(latestTiers))
    ).toEqual({
      maxDepth: 75_000,
      buyPrice: 100,
    });
  });

  it("ignores invalid or outlier tiers before selecting the ceiling", () => {
    const historyTiers: RfqBuySideTier[] = [
      { notionalUsd: 1_000, buyPrice: 100 },
      { notionalUsd: 10_000, buyPrice: 100 },
      { notionalUsd: 50_000, buyPrice: 100 },
    ];
    const latestTiers: RfqBuySideTier[] = [
      { notionalUsd: 1_000, buyPrice: 100 },
      { notionalUsd: 10_000, buyPrice: 0 },
      { notionalUsd: 50_000, buyPrice: 500 },
    ];

    expect(
      computeRfqBuySideDepthCeiling(
        latestTiers,
        buildMedianBuyPriceMap(historyTiers)
      )
    ).toEqual({
      maxDepth: 1_000,
      buyPrice: 100,
    });
  });

  it("returns zero depth when no buy-side tier is usable", () => {
    const latestTiers: RfqBuySideTier[] = [
      { notionalUsd: 1_000, buyPrice: 0 },
      { notionalUsd: 10_000, buyPrice: 0 },
    ];

    expect(
      computeRfqBuySideDepthCeiling(latestTiers, buildMedianBuyPriceMap(latestTiers))
    ).toEqual({
      maxDepth: 0,
      buyPrice: 0,
    });
  });
});
