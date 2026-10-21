import { describe, expect, it } from "vitest";

import {
  REGISTRY_CORE20_ORDER,
  buildPoolBackedRfqAssetConfig,
  isBirdsEyeRfqRegistryEnabled,
  mergeRfqAssetConfigs,
  sortRfqAssetConfigs,
  type RfqAssetConfig,
} from "@/lib/rfq-asset-config";
import { SOLANA_FOUNDATION_SPACE_SLUG } from "@/lib/space-policy";

describe("rfq asset config", () => {
  it("enables the registry by default unless explicitly disabled", () => {
    expect(isBirdsEyeRfqRegistryEnabled(undefined)).toBe(true);
    expect(isBirdsEyeRfqRegistryEnabled("true")).toBe(true);
    expect(isBirdsEyeRfqRegistryEnabled("false")).toBe(false);
    expect(isBirdsEyeRfqRegistryEnabled("0")).toBe(false);
  });

  it("keeps core20 in the curated AUM order and tails alphabetized after", () => {
    const rows: RfqAssetConfig[] = [
      {
        asset: "PLTRx",
        name: "Palantir xStock",
        group: "tail",
        requiredTier: null,
        enabledProviders: ["jupz"],
        solanaMint: null,
        evmTokenAddress: null,
        pool: null,
      },
      {
        asset: REGISTRY_CORE20_ORDER[1],
        name: "Tesla xStock",
        group: "core20",
        requiredTier: 2,
        enabledProviders: ["jupz"],
        solanaMint: null,
        evmTokenAddress: null,
        pool: null,
      },
      {
        asset: REGISTRY_CORE20_ORDER[0],
        name: "Strategy PP Variable xStock",
        group: "core20",
        requiredTier: null,
        enabledProviders: ["jupz"],
        solanaMint: null,
        evmTokenAddress: null,
        pool: null,
      },
      {
        asset: "AVGOx",
        name: "Broadcom xStock",
        group: "tail",
        requiredTier: null,
        enabledProviders: ["jupz"],
        solanaMint: null,
        evmTokenAddress: null,
        pool: null,
      },
    ];

    expect(sortRfqAssetConfigs(rows).map((row) => row.asset)).toEqual([
      REGISTRY_CORE20_ORDER[0],
      REGISTRY_CORE20_ORDER[1],
      "AVGOx",
      "PLTRx",
    ]);
  });

  it("builds RFQ asset config from the existing Solana Foundation pools", () => {
    const rows = buildPoolBackedRfqAssetConfig(SOLANA_FOUNDATION_SPACE_SLUG);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.asset)).toContain("TSLAx");
    expect(rows.find((row) => row.asset === "TSLAx")?.group).toBe("core20");
    expect(rows.find((row) => row.asset === "SPCXx")?.group).toBe("tail");
    expect(rows.every((row) => row.enabledProviders.includes("oneinch"))).toBe(true);
  });

  it("preserves registry rows and appends pool-backed assets missing from the registry", () => {
    const rows = mergeRfqAssetConfigs(
      [
        {
          asset: "TSLAx",
          name: "Tesla from registry",
          group: "core20",
          requiredTier: 2,
          enabledProviders: ["jupz"],
          solanaMint: null,
          evmTokenAddress: null,
          pool: null,
        },
      ],
      [
        {
          asset: "TSLAx",
          name: "Tesla from pools",
          group: "core20",
          requiredTier: null,
          enabledProviders: ["oneinch"],
          solanaMint: "pool-mint",
          evmTokenAddress: null,
          pool: "pool",
        },
        {
          asset: "TAILx",
          name: "Tail asset from pools",
          group: "tail",
          requiredTier: null,
          enabledProviders: ["oneinch"],
          solanaMint: "tail-mint",
          evmTokenAddress: null,
          pool: "tail-pool",
        },
      ],
    );

    expect(rows).toEqual([
      {
        asset: "TSLAx",
        name: "Tesla from registry",
        group: "core20",
        requiredTier: 2,
        enabledProviders: ["jupz"],
        solanaMint: null,
        evmTokenAddress: null,
        pool: null,
      },
      {
        asset: "TAILx",
        name: "Tail asset from pools",
        group: "tail",
        requiredTier: null,
        enabledProviders: ["oneinch"],
        solanaMint: "tail-mint",
        evmTokenAddress: null,
        pool: "tail-pool",
      },
    ]);
  });
});
