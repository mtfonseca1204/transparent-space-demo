import { describe, expect, it } from "vitest";

import { WARS_USDC_V4_POOL_KEY } from "@/lib/pools";
import { hasUsableIndexedV4Tvl } from "@/lib/v4-tvl-source";

describe("v4 TVL source selection", () => {
  it("does not treat zero indexed wARS/USDC balances as usable", () => {
    expect(
      hasUsableIndexedV4Tvl({
        poolKey: WARS_USDC_V4_POOL_KEY,
        tvlToken0Raw: "0",
        tvlToken1Raw: "0",
      }),
    ).toBe(false);
  });

  it("uses nonzero indexed wARS/USDC balances when the indexer provides them", () => {
    expect(
      hasUsableIndexedV4Tvl({
        poolKey: WARS_USDC_V4_POOL_KEY,
        tvlToken0Raw: "1",
        tvlToken1Raw: "0",
      }),
    ).toBe(true);
  });

  it("preserves zero indexed balance behavior for other v4 pools", () => {
    expect(
      hasUsableIndexedV4Tvl({
        poolKey: "480-v4-0xdcab9c556ed41c6e046f1ca00cb1f1a4ea7a9c0952cd76bdd9db4534e9e8b9ea",
        tvlToken0Raw: "0",
        tvlToken1Raw: "0",
      }),
    ).toBe(true);
  });

  it("falls back when the indexer row does not include TVL fields", () => {
    expect(
      hasUsableIndexedV4Tvl({
        poolKey: "480-v4-0xdcab9c556ed41c6e046f1ca00cb1f1a4ea7a9c0952cd76bdd9db4534e9e8b9ea",
        tvlToken0Raw: "",
        tvlToken1Raw: "0",
      }),
    ).toBe(false);
  });
});
