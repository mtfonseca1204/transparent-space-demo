import { describe, expect, it } from "vitest";

import {
  BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
  getPoolsForSpace,
  KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY,
  PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY,
  ZEROG_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
  ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
  ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
  ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
} from "@/lib/pools";
import {
  getRailwayIndexerSpace,
  isWorldchainIndexerPool,
  isWorldchainIndexerV3Pool,
  isWorldchainIndexerV4Pool,
} from "@/lib/worldchain-indexer-client";
import {
  GENSYN_SPACE_SLUG,
  KATANA_SPACE_SLUG,
  PERLE_SPACE_SLUG,
  ZEROG_SPACE_SLUG,
} from "@/lib/space-policy";
import { getPublicClientForChainId } from "@/lib/viem";

const GENSYN_V4_AI_USDC =
  "1-v4-0x45987a457854bb7205086e0826ab2988e556f0fef7af4299ab5febb9fc13d8d4";
const GENSYN_V4_AI_USDT =
  "1-v4-0x88ff197d8fe8a68722f59c93eef447a4b54ebe8543bf0392246448a04956915a";
const GENSYN_V4_AI_USDC_2AE30 =
  "1-v4-0x2ae30b23a4fe9be23cb338760727999f1ae6f68f2e086a5c54e0a627f81b5526";
const GENSYN_V4_AI_ETH =
  "1-v4-0x87265ba29f072b718aa93316b12c7d6afefc141d7873a14bd824249b519d346c";
const GENSYN_V4_AI_USDC_4BC08 =
  "1-v4-0x4bc08865f095ab0989f825c51131be96cf4a10334cb94be5a3106d94dabff514";
const GENSYN_V4_AI_USDC_41FBE =
  "1-v4-0x41fbebabb824da94c04965fe387668a70d6a3d44f1313dc4eb5458a2cdd3f815";
const GENSYN_V3_AI_USDC = "0x3198ca64ebff6d008860f2c450cfcbf1faac7677";

const GENSYN_POOL_KEYS = [
  GENSYN_V4_AI_USDC,
  GENSYN_V4_AI_USDT,
  GENSYN_V4_AI_USDC_2AE30,
  GENSYN_V4_AI_ETH,
  GENSYN_V4_AI_USDC_4BC08,
  GENSYN_V4_AI_USDC_41FBE,
  GENSYN_V3_AI_USDC,
];

describe("Gensyn indexer routing", () => {
  it("adds the live Gensyn Ethereum pools to the Gensyn space", () => {
    expect(getPoolsForSpace(GENSYN_SPACE_SLUG).map((pool) => pool.poolKey)).toEqual(GENSYN_POOL_KEYS);
  });

  it("routes Gensyn pools through the Railway EVM indexer path", () => {
    for (const poolKey of GENSYN_POOL_KEYS) {
      expect(isWorldchainIndexerPool(poolKey)).toBe(true);
      expect(getRailwayIndexerSpace(poolKey)).toBe("gensyn");
    }
    for (const poolKey of GENSYN_POOL_KEYS.filter((key) => key !== GENSYN_V3_AI_USDC)) {
      expect(isWorldchainIndexerV4Pool(poolKey)).toBe(true);
    }
    expect(isWorldchainIndexerV4Pool(GENSYN_V3_AI_USDC)).toBe(false);
  });

  it("uses Ethereum mainnet RPC metadata for Gensyn chain 1 pools", () => {
    expect(getPublicClientForChainId(1).chain?.id).toBe(1);
    expect(getPublicClientForChainId(480).chain?.id).toBe(480);
  });
});

describe("BSC indexer routing", () => {
  it("routes the Perle Pancake Infinity CL pool through the BSC Railway indexer path", () => {
    expect(getPoolsForSpace(PERLE_SPACE_SLUG).map((pool) => pool.poolKey)).toContain(
      PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY
    );
    expect(isWorldchainIndexerPool(PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV4Pool(PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY)).toBe(true);
    expect(getRailwayIndexerSpace(PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY)).toBe("bsc");
  });

  it("uses BSC RPC metadata for chain 56 pools", () => {
    expect(getPublicClientForChainId(56).chain?.id).toBe(56);
  });

  it("routes the 0G/USDT Pancake V3 pool through the BSC Railway indexer path", () => {
    expect(getPoolsForSpace(ZEROG_SPACE_SLUG).map((pool) => pool.poolKey)).toContain(
      BSC_PANCAKE_V3_0G_USDT_POOL_KEY
    );
    expect(isWorldchainIndexerPool(BSC_PANCAKE_V3_0G_USDT_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV3Pool(BSC_PANCAKE_V3_0G_USDT_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV4Pool(BSC_PANCAKE_V3_0G_USDT_POOL_KEY)).toBe(false);
    expect(getRailwayIndexerSpace(BSC_PANCAKE_V3_0G_USDT_POOL_KEY)).toBe("bsc");
  });
});

describe("Katana indexer routing", () => {
  it("routes the Sushi V3 vbUSDC/vbETH pool through the Katana Railway indexer path", () => {
    expect(getPoolsForSpace(KATANA_SPACE_SLUG)).toEqual([
      expect.objectContaining({
        key: "katana-sushi-v3-vbusdc-vbeth",
        label: "vbUSDC / vbETH",
        poolKey: KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 747474,
        spaceSlug: KATANA_SPACE_SLUG,
      }),
    ]);
    expect(isWorldchainIndexerPool(KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV4Pool(KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY)).toBe(false);
    expect(getRailwayIndexerSpace(KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY)).toBe("katana");
  });

  it("uses Katana RPC metadata for chain 747474 pools", () => {
    expect(getPublicClientForChainId(747474).chain?.id).toBe(747474);
    expect(getPublicClientForChainId(747474).chain?.contracts?.multicall3?.address).toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11"
    );
  });
});

describe("0G AI indexer routing", () => {
  it("routes 0G AI pools through their chain-specific Railway indexer paths", () => {
    expect(getPoolsForSpace(ZEROG_SPACE_SLUG)).toEqual([
      expect.objectContaining({
        key: "zerog-w0g-usdce-v3",
        label: "W0G / USDC.e",
        poolKey: ZEROG_W0G_USDCE_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "zerog-zia-w0g-usdce-v3",
        label: "Zia W0G / USDC.e",
        poolKey: ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "zerog-zia-w0g-weth-v3",
        label: "Zia W0G / WETH",
        poolKey: ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "zerog-zia-wbtc-w0g-v3",
        label: "Zia WBTC / W0G",
        poolKey: ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "zerog-zia-usdce-weth-v3",
        label: "Zia USDC.e / WETH",
        poolKey: ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "zerog-zia-ousdt-usdce-v3",
        label: "Zia oUSDT / USDC.e",
        poolKey: ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "pancake-v3-0g-usdt",
        label: "0G / USDT",
        poolKey: BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 56,
        spaceSlug: ZEROG_SPACE_SLUG,
      }),
    ]);
    expect(isWorldchainIndexerPool(ZEROG_W0G_USDCE_V3_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV3Pool(ZEROG_W0G_USDCE_V3_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV4Pool(ZEROG_W0G_USDCE_V3_POOL_KEY)).toBe(false);
    expect(getRailwayIndexerSpace(ZEROG_W0G_USDCE_V3_POOL_KEY)).toBe("zerog");
    expect(isWorldchainIndexerPool(ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV3Pool(ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY)).toBe(true);
    expect(isWorldchainIndexerV4Pool(ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY)).toBe(false);
    expect(getRailwayIndexerSpace(ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY)).toBe("zerog");
    for (const poolKey of [
      ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
      ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
      ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
      ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
    ]) {
      expect(isWorldchainIndexerPool(poolKey)).toBe(true);
      expect(isWorldchainIndexerV3Pool(poolKey)).toBe(true);
      expect(isWorldchainIndexerV4Pool(poolKey)).toBe(false);
      expect(getRailwayIndexerSpace(poolKey)).toBe("zerog");
    }
  });

  it("uses 0G RPC metadata for chain 16661 pools", () => {
    expect(getPublicClientForChainId(16661).chain?.id).toBe(16661);
    expect(getPublicClientForChainId(16661).chain?.blockExplorers?.default.url).toBe(
      "https://chainscan.0g.ai"
    );
  });
});
