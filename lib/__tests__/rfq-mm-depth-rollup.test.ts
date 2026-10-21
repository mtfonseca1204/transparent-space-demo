import { describe, expect, it } from "vitest";

import {
  computeRfqMarketMakerAssetDepth,
  computeRfqMarketMakerDepthBuckets,
  summarizeRfqMarketMakerDepthSla,
} from "@/lib/rfq-mm-depth-rollup";

describe("rfq market maker depth rollup", () => {
  it("uses the largest venue depth for a market maker on the same asset", () => {
    expect(
      computeRfqMarketMakerAssetDepth(
        {
          cowswap: { maxDepth: 1_500_000 },
          jupz: { maxDepth: 1_000_000 },
        },
        ["cowswap", "jupz"],
      ),
    ).toBe(1_500_000);
  });

  it("ignores unrelated or missing venues", () => {
    expect(
      computeRfqMarketMakerAssetDepth(
        {
          cowswap: { maxDepth: 0 },
          jupz: null,
          "0x": { maxDepth: 100_000 },
        },
        ["cowswap", "jupz"] as string[],
      ),
    ).toBe(0);
  });

  it("sums every core20 asset into the top-20 bucket instead of only the top three", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      asset: `ASSET${index + 1}x`,
      sources: {
        "1inch": { maxDepth: 1_000_000 },
        bebop: { maxDepth: 50_000 },
        "0x": { maxDepth: 100_000 },
      },
    }));
    const assetConfigs = rows.map((row) => ({
      asset: row.asset,
      group: "core20" as const,
    }));

    expect(
      computeRfqMarketMakerDepthBuckets(rows, ["0x", "bebop", "1inch"], assetConfigs),
    ).toEqual({
      top20Depth: 10_000_000,
      outsideTop20Depth: 0,
    });
  });

  it("keeps configured tail assets in the outside-top-20 bucket", () => {
    const rows = [
      {
        asset: "TSLAx",
        sources: { "1inch": { maxDepth: 1_000_000 } },
      },
      {
        asset: "TAILx",
        sources: { "1inch": { maxDepth: 750_000 } },
      },
    ];

    expect(
      computeRfqMarketMakerDepthBuckets(rows, ["1inch"], [
        { asset: "TSLAx", group: "core20" },
        { asset: "TAILx", group: "tail" },
      ]),
    ).toEqual({
      top20Depth: 1_000_000,
      outsideTop20Depth: 750_000,
    });
  });

  it("reports the headline shortfall against the total $9M requirement", () => {
    expect(
      summarizeRfqMarketMakerDepthSla(7_500_000, 10_000),
    ).toMatchObject({
      totalDepth: 7_510_000,
      totalDeltaUsd: -1_490_000,
      totalShortfall: 1_490_000,
      outsideTop20Shortfall: 3_990_000,
      complianceShortfall: 3_990_000,
    });
  });

  it("keeps bucket compliance separate from the headline total delta", () => {
    expect(
      summarizeRfqMarketMakerDepthSla(10_000_000, 0),
    ).toMatchObject({
      totalDepth: 10_000_000,
      totalDeltaUsd: 1_000_000,
      totalShortfall: 0,
      outsideTop20Shortfall: 4_000_000,
      complianceShortfall: 4_000_000,
    });
  });
});
