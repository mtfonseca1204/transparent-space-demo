import { describe, expect, it } from "vitest";

import {
  computeWorstSideBps,
  isSyntheticSeedFresh,
  pickSyntheticSeedForTarget,
  resolveSyntheticCellValue,
  type SyntheticSeed,
} from "@/lib/rfq-synthetic-fill";

const TIER3_MARKET_SEED: SyntheticSeed = {
  asset: "COINx",
  provider: "oneinch",
  quoteAt: "2026-04-22T14:05:00.000Z",
  sourceSession: "market",
  worstSideBps: 18.75,
};

describe("rfq synthetic fill", () => {
  it("keeps real weekly data and never overwrites it with a synthetic value", () => {
    const resolved = resolveSyntheticCellValue({
      enabled: true,
      asset: "COINx",
      provider: "oneinch",
      session: "market",
      requiredTier: 3,
      summary: { medianBps: 91 },
      seed: {
        ...TIER3_MARKET_SEED,
        worstSideBps: 12,
      },
      now: new Date("2026-04-22T16:00:00.000Z"),
    });

    expect(resolved).toEqual({ bps: 91, isSynthetic: false });
  });

  it("fills an eligible internal gap from a fresh same-day seed", () => {
    const resolved = resolveSyntheticCellValue({
      enabled: true,
      asset: "COINx",
      provider: "oneinch",
      session: "prePost",
      requiredTier: 3,
      summary: { medianBps: null },
      seed: TIER3_MARKET_SEED,
      now: new Date("2026-04-22T16:00:00.000Z"),
    });

    expect(resolved.bps).toBe(75);
    expect(resolved.isSynthetic).toBe(true);
    expect(resolved.syntheticSourceSession).toBe("market");
    expect(resolved.syntheticQuoteAt).toBe(TIER3_MARKET_SEED.quoteAt);
  });

  it("does not synthesize values for assets whose required tier is still pending", () => {
    const resolved = resolveSyntheticCellValue({
      enabled: true,
      asset: "AAPLx",
      provider: "oneinch",
      session: "market",
      requiredTier: null,
      summary: { medianBps: null },
      seed: TIER3_MARKET_SEED,
      now: new Date("2026-04-22T16:00:00.000Z"),
    });

    expect(resolved).toEqual({ bps: null, isSynthetic: false });
  });

  it("caps synthetic values at the contract max for the target band", () => {
    const resolved = resolveSyntheticCellValue({
      enabled: true,
      asset: "COINx",
      provider: "oneinch",
      session: "weekend",
      requiredTier: 3,
      summary: { medianBps: null },
      seed: {
        ...TIER3_MARKET_SEED,
        worstSideBps: 40,
      },
      now: new Date("2026-04-22T16:00:00.000Z"),
    });

    expect(resolved.bps).toBe(250);
    expect(resolved.isSynthetic).toBe(true);
  });

  it("fills cowswap weekend cells from a fresh same-day seed", () => {
    const resolved = resolveSyntheticCellValue({
      enabled: true,
      asset: "HOODx",
      provider: "cowswap",
      session: "weekend",
      requiredTier: 3,
      summary: { medianBps: null },
      seed: {
        asset: "HOODx",
        provider: "jupz",
        quoteAt: "2026-04-22T14:05:00.000Z",
        sourceSession: "market",
        worstSideBps: 20,
      },
      now: new Date("2026-04-22T16:00:00.000Z"),
    });

    expect(resolved.bps).toBe(200);
    expect(resolved.isSynthetic).toBe(true);
  });

  it("falls back to the freshest same-MM seed when the venue has no direct seed", () => {
    const seeds = new Map([
      [
        "zerox" as const,
        {
          asset: "COINx",
          provider: "zerox",
          quoteAt: "2026-04-22T14:05:00.000Z",
          sourceSession: "market",
          worstSideBps: 20,
        } satisfies SyntheticSeed,
      ],
      [
        "oneinch" as const,
        {
          asset: "COINx",
          provider: "oneinch",
          quoteAt: "2026-04-22T14:10:00.000Z",
          sourceSession: "market",
          worstSideBps: 18,
        } satisfies SyntheticSeed,
      ],
    ]);

    expect(pickSyntheticSeedForTarget(seeds, "bebop")).toEqual(seeds.get("oneinch"));
  });

  it("requires the seed to be fresh on the current ET date", () => {
    expect(
      isSyntheticSeedFresh(
        "2026-04-22T14:30:00.000Z",
        new Date("2026-04-22T23:30:00.000Z")
      )
    ).toBe(true);
    expect(
      isSyntheticSeedFresh(
        "2026-04-22T14:30:00.000Z",
        new Date("2026-04-23T05:00:00.000Z")
      )
    ).toBe(false);
  });

  it("computes worst-side bps from live bid/ask quotes", () => {
    expect(computeWorstSideBps(101, 99)).toBeCloseTo(100, 6);
    expect(computeWorstSideBps(0, 99)).toBeNull();
  });
});
