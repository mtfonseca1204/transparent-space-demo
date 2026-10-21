import { describe, expect, it } from "vitest";

import { getPoolDisplayPair } from "@/lib/pool-display";
import {
  BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
  WARS_USDC_V4_POOL_KEY,
  ZEROG_W0G_USDCE_V3_POOL_KEY,
} from "@/lib/pools";

describe("pool display pairs", () => {
  it("keeps the legacy wARS/USDC v4 ratio as wARS per USDC", () => {
    expect(
      getPoolDisplayPair({
        poolKey: WARS_USDC_V4_POOL_KEY,
        token0Symbol: "wARS",
        token1Symbol: "USDC",
      }),
    ).toMatchObject({
      pairLabel: "wARS/USDC",
      unitLabel: "wARS per USDC",
      invert: true,
    });
  });

  it("does not apply the wARS override to other token0/USDC pools", () => {
    expect(
      getPoolDisplayPair({
        poolKey: "480-v4-0xdcab9c556ed41c6e046f1ca00cb1f1a4ea7a9c0952cd76bdd9db4534e9e8b9ea",
        token0Symbol: "oXAUT",
        token1Symbol: "USDC",
      }),
    ).toMatchObject({
      pairLabel: "oXAUT/USDC",
      unitLabel: "oXAUT per USDC",
      invert: false,
    });
  });

  it("still inverts pairs where the stable token is token0", () => {
    expect(
      getPoolDisplayPair({
        poolKey: "0xexample",
        token0Symbol: "USDC",
        token1Symbol: "WETH",
      }),
    ).toMatchObject({
      pairLabel: "WETH/USDC",
      unitLabel: "WETH per USDC",
      invert: true,
    });
  });

  it("treats USDC.e as the quote token for 0G W0G pools", () => {
    expect(
      getPoolDisplayPair({
        poolKey: ZEROG_W0G_USDCE_V3_POOL_KEY,
        token0Symbol: "USDC.e",
        token1Symbol: "W0G",
      }),
    ).toMatchObject({
      pairLabel: "W0G/USDC.e",
      unitLabel: "W0G per USDC.e",
      invert: true,
    });
  });

  it("treats BSC USDT as the quote token for 0G pools", () => {
    expect(
      getPoolDisplayPair({
        poolKey: BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
        token0Symbol: "0G",
        token1Symbol: "USDT",
      }),
    ).toMatchObject({
      pairLabel: "0G/USDT",
      unitLabel: "0G per USDT",
      invert: false,
    });
  });
});
