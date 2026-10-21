import { describe, expect, it } from "vitest";

import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";
import {
  BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
  KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY,
  PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY,
  ZEROG_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
  ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
  ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
  ZEROG_ZIA_W0G_USDCE_LOGO,
  ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
  getPoolsForSpace,
  getSolanaPoolMetadata,
} from "@/lib/pools";
import {
  DEMO_SPACE_SLUG,
  GENSYN_SPACE_SLUG,
  HYPERLIQUID_SPACE_SLUG,
  KATANA_SPACE_SLUG,
  KRAKEN_SPACE_SLUG,
  PERLE_SPACE_SLUG,
  SOLANA_FOUNDATION_SPACE_SLUG,
  ZEROG_SPACE_SLUG,
  getAddressExplorerUrl,
  isHyperliquidSpace,
  isKrakenLikeSpace,
  isPoolsDirectorySpace,
  isRfqDirectorySpace,
  isRfqDisabledSpace,
  showsArbVolumeTable,
} from "@/lib/space-policy";
import { getMarketMakerLabel, getMarketMakerShortLabel } from "@/lib/spread-tiers";
import { getPoolsForToken, getUniqueTokensForPools } from "@/lib/token-utils";

const FLOWDESK_LP_ADDRESS = "b42ufb14x8rtlfup1bl9szwe5ylrw1yqhf9ng9zfb9ko";

describe("Solana Foundation space policy", () => {
  it("copies the Kraken Solana pool catalog into Solana Foundation", () => {
    const krakenPools = getPoolsForSpace(KRAKEN_SPACE_SLUG).filter((pool) => pool.chain === "solana");
    const solanaFoundationPools = getPoolsForSpace(SOLANA_FOUNDATION_SPACE_SLUG);

    expect(solanaFoundationPools).toHaveLength(krakenPools.length);
    expect(
      solanaFoundationPools.map((pool) => ({
        label: pool.label,
        poolKey: pool.poolKey,
        protocol: pool.protocol,
        chain: pool.chain,
      })),
    ).toEqual(
      krakenPools.map((pool) => ({
        label: pool.label,
        poolKey: pool.poolKey,
        protocol: pool.protocol,
        chain: pool.chain,
      })),
    );
    expect(solanaFoundationPools.every((pool) => pool.spaceSlug === SOLANA_FOUNDATION_SPACE_SLUG)).toBe(true);
    expect(solanaFoundationPools.every((pool) => pool.key.startsWith(`${SOLANA_FOUNDATION_SPACE_SLUG}-`))).toBe(true);
  });

  it("keeps Kraken market maker labels public", () => {
    expect(formatLpLabel(FLOWDESK_LP_ADDRESS, KRAKEN_SPACE_SLUG)).toBe("Flowdesk");
    expect(getLpMeta(FLOWDESK_LP_ADDRESS, KRAKEN_SPACE_SLUG)?.logoSrc).toBe("/mm/flowdesk.ico");
    expect(getMarketMakerLabel("flowdesk", KRAKEN_SPACE_SLUG)).toBe("Flowdesk");
    expect(getMarketMakerLabel("tokka", KRAKEN_SPACE_SLUG)).toBe("Tokka Labs");
    expect(getMarketMakerShortLabel("flowdesk", KRAKEN_SPACE_SLUG)).toBe("FD");
    expect(getMarketMakerShortLabel("tokka", KRAKEN_SPACE_SLUG)).toBe("TK");
  });

  it("anonymizes Solana Foundation market maker labels and logos", () => {
    const labels = [
      formatLpLabel(FLOWDESK_LP_ADDRESS, SOLANA_FOUNDATION_SPACE_SLUG),
      getLpMeta(FLOWDESK_LP_ADDRESS, SOLANA_FOUNDATION_SPACE_SLUG)?.label,
      getMarketMakerLabel("flowdesk", SOLANA_FOUNDATION_SPACE_SLUG),
      getMarketMakerLabel("tokka", SOLANA_FOUNDATION_SPACE_SLUG),
    ];

    expect(labels).toEqual(["MM A", "MM A", "MM A", "MM B"]);
    expect(labels.join(" ")).not.toMatch(/Flowdesk|Tokka Labs/);
    expect(getLpMeta(FLOWDESK_LP_ADDRESS, SOLANA_FOUNDATION_SPACE_SLUG)?.logoSrc).toBeNull();
  });

  it("anonymizes Demo market maker labels and logos", () => {
    const labels = [
      formatLpLabel(FLOWDESK_LP_ADDRESS, DEMO_SPACE_SLUG),
      getLpMeta(FLOWDESK_LP_ADDRESS, DEMO_SPACE_SLUG)?.label,
      getMarketMakerLabel("flowdesk", DEMO_SPACE_SLUG),
      getMarketMakerLabel("tokka", DEMO_SPACE_SLUG),
    ];

    expect(labels).toEqual(["MM A", "MM A", "MM A", "MM B"]);
    expect(labels.join(" ")).not.toMatch(/Flowdesk|Tokka Labs/);
    expect(getLpMeta(FLOWDESK_LP_ADDRESS, DEMO_SPACE_SLUG)?.logoSrc).toBeNull();
  });

  it("enables the pools directory for Kraken and Solana Foundation", () => {
    expect(isPoolsDirectorySpace(KRAKEN_SPACE_SLUG)).toBe(true);
    expect(isPoolsDirectorySpace(SOLANA_FOUNDATION_SPACE_SLUG)).toBe(true);
    expect(isPoolsDirectorySpace(DEMO_SPACE_SLUG)).toBe(true);
    expect(isPoolsDirectorySpace("worldchain")).toBe(false);
  });

  it("enables quote activity directory for Kraken and Demo only", () => {
    expect(isRfqDirectorySpace(KRAKEN_SPACE_SLUG)).toBe(true);
    expect(isRfqDirectorySpace(DEMO_SPACE_SLUG)).toBe(true);
    expect(isRfqDirectorySpace(SOLANA_FOUNDATION_SPACE_SLUG)).toBe(false);
    expect(isRfqDirectorySpace("worldchain")).toBe(false);
  });

  it("disables RFQ surfaces for pool-only spaces", () => {
    expect(isRfqDisabledSpace("worldchain")).toBe(true);
    expect(isRfqDisabledSpace(GENSYN_SPACE_SLUG)).toBe(true);
    expect(isRfqDisabledSpace(KATANA_SPACE_SLUG)).toBe(true);
    expect(isRfqDisabledSpace(PERLE_SPACE_SLUG)).toBe(true);
    expect(isRfqDisabledSpace(ZEROG_SPACE_SLUG)).toBe(true);
    expect(isRfqDisabledSpace(HYPERLIQUID_SPACE_SLUG)).toBe(true);
    expect(isRfqDisabledSpace(KRAKEN_SPACE_SLUG)).toBe(false);
    expect(isRfqDisabledSpace(SOLANA_FOUNDATION_SPACE_SLUG)).toBe(false);
    expect(isRfqDisabledSpace(DEMO_SPACE_SLUG)).toBe(false);
  });

  it("treats Demo as Kraken-like while preserving Solana explorer behavior", () => {
    expect(isKrakenLikeSpace(DEMO_SPACE_SLUG)).toBe(true);
    expect(getAddressExplorerUrl("demo-owner", DEMO_SPACE_SLUG)).toBe(
      "https://solscan.io/account/demo-owner"
    );
  });
});

describe("Hyperliquid space policy", () => {
  it("keeps HIP-3 as a dedicated no-pool dashboard space", () => {
    expect(isHyperliquidSpace(HYPERLIQUID_SPACE_SLUG)).toBe(true);
    expect(getPoolsForSpace(HYPERLIQUID_SPACE_SLUG)).toEqual([]);
    expect(isPoolsDirectorySpace(HYPERLIQUID_SPACE_SLUG)).toBe(false);
    expect(isRfqDirectorySpace(HYPERLIQUID_SPACE_SLUG)).toBe(false);
    expect(isRfqDisabledSpace(HYPERLIQUID_SPACE_SLUG)).toBe(true);
  });
});

describe("Katana space policy", () => {
  it("exposes the Sushi V3 vbUSDC/vbETH pool", () => {
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
  });

  it("keeps Katana pool-only and resolves Katana explorer links", () => {
    expect(isRfqDisabledSpace(KATANA_SPACE_SLUG)).toBe(true);
    expect(isPoolsDirectorySpace(KATANA_SPACE_SLUG)).toBe(false);
    expect(getAddressExplorerUrl("0xabc0000000000000000000000000000000000000", KATANA_SPACE_SLUG)).toBe(
      "https://katanascan.com/address/0xabc0000000000000000000000000000000000000"
    );
    expect(
      getAddressExplorerUrl(
        "0xabc0000000000000000000000000000000000000",
        KATANA_SPACE_SLUG,
        KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY
      )
    ).toBe("https://katanascan.com/address/0xabc0000000000000000000000000000000000000");
  });
});

describe("Perle space policy", () => {
  it("exposes the Solana and BSC PRL pools", () => {
    expect(getPoolsForSpace(PERLE_SPACE_SLUG)).toEqual([
      expect.objectContaining({
        key: "raydium-prl-usdc",
        label: "PRL / USDC",
        poolKey: "DYxp5fh3Eh7iDEVHv9bFLGnPwvXwFe5YWpGayJuzzbgd",
        protocol: "raydium",
        chain: "solana",
        spaceSlug: PERLE_SPACE_SLUG,
      }),
      expect.objectContaining({
        key: "pancake-infinity-prl-usdt",
        label: "PRL / USDT",
        poolKey: PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY,
        protocol: "v4",
        chain: "evm",
        chainId: 56,
        spaceSlug: PERLE_SPACE_SLUG,
      }),
    ]);

    expect(getSolanaPoolMetadata("DYxp5fh3Eh7iDEVHv9bFLGnPwvXwFe5YWpGayJuzzbgd")).toEqual(
      expect.objectContaining({
        symbol: "PRL/USDC",
        token0Mint: "PERLEQKUNUp1dgFZ8EvyXHdN9d6ZQqfGxALDvfs6pDs",
        token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        token0Decimals: 8,
        token1Decimals: 6,
        logo: "/icons/perle-logo.webp",
        fee: 1000,
        tickSpacing: 10,
      })
    );
  });

  it("keeps Perle pool-only and resolves explorers by pool network", () => {
    expect(isRfqDisabledSpace(PERLE_SPACE_SLUG)).toBe(true);
    expect(isPoolsDirectorySpace(PERLE_SPACE_SLUG)).toBe(false);
    expect(getAddressExplorerUrl("abc123", PERLE_SPACE_SLUG)).toBe(
      "https://solscan.io/account/abc123"
    );
    expect(
      getAddressExplorerUrl("0xabc0000000000000000000000000000000000000", PERLE_SPACE_SLUG, PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY)
    ).toBe("https://bscscan.com/address/0xabc0000000000000000000000000000000000000");
  });
});

describe("0G AI space policy", () => {
  it("exposes the 0G mainnet and BSC pools", () => {
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
        trackedAssetSymbol: "W0G",
        logo: ZEROG_ZIA_W0G_USDCE_LOGO,
      }),
      expect.objectContaining({
        key: "zerog-zia-w0g-weth-v3",
        label: "Zia W0G / WETH",
        poolKey: ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
        trackedAssetSymbol: "W0G",
        logo: ZEROG_ZIA_W0G_USDCE_LOGO,
      }),
      expect.objectContaining({
        key: "zerog-zia-wbtc-w0g-v3",
        label: "Zia WBTC / W0G",
        poolKey: ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
        trackedAssetSymbol: "WBTC",
        logo: ZEROG_ZIA_W0G_USDCE_LOGO,
      }),
      expect.objectContaining({
        key: "zerog-zia-usdce-weth-v3",
        label: "Zia USDC.e / WETH",
        poolKey: ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
        trackedAssetSymbol: "WETH",
        logo: ZEROG_ZIA_W0G_USDCE_LOGO,
      }),
      expect.objectContaining({
        key: "zerog-zia-ousdt-usdce-v3",
        label: "Zia oUSDT / USDC.e",
        poolKey: ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
        protocol: "v3",
        chain: "evm",
        chainId: 16661,
        spaceSlug: ZEROG_SPACE_SLUG,
        trackedAssetSymbol: "oUSDT",
        logo: ZEROG_ZIA_W0G_USDCE_LOGO,
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
  });

  it("groups the Zia W0G pool under the existing W0G asset", () => {
    const pools = getPoolsForSpace(ZEROG_SPACE_SLUG);

    expect(
      getUniqueTokensForPools(pools).map((token) => ({
        symbol: token.symbol,
        poolCount: token.poolCount,
      }))
    ).toEqual([
      { symbol: "W0G", poolCount: 3 },
      { symbol: "0G", poolCount: 1 },
      { symbol: "WBTC", poolCount: 1 },
      { symbol: "WETH", poolCount: 1 },
      { symbol: "OUSDT", poolCount: 1 },
    ]);
    expect(getPoolsForToken(pools, "W0G").map((pool) => pool.poolKey)).toEqual([
      ZEROG_W0G_USDCE_V3_POOL_KEY,
      ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
      ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
    ]);
    expect(getPoolsForToken(pools, "WETH").map((pool) => pool.poolKey)).toEqual([
      ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
    ]);
    expect(getPoolsForToken(pools, "oUSDT").map((pool) => pool.poolKey)).toEqual([
      ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
    ]);
    expect(getPoolsForToken(pools, "ZIA W0G")).toEqual([]);
  });

  it("shows the Arb Volume table for 0G AI even though RFQ is disabled", () => {
    expect(showsArbVolumeTable(ZEROG_SPACE_SLUG)).toBe(true);
    // Kraken-like spaces keep the arb table; other RFQ-disabled spaces keep the
    // Trade Size Slippage matrix.
    expect(showsArbVolumeTable(KRAKEN_SPACE_SLUG)).toBe(true);
    expect(showsArbVolumeTable(DEMO_SPACE_SLUG)).toBe(true);
    expect(showsArbVolumeTable(SOLANA_FOUNDATION_SPACE_SLUG)).toBe(true);
    expect(showsArbVolumeTable(GENSYN_SPACE_SLUG)).toBe(false);
    expect(showsArbVolumeTable(KATANA_SPACE_SLUG)).toBe(false);
    expect(showsArbVolumeTable(PERLE_SPACE_SLUG)).toBe(false);
    expect(showsArbVolumeTable("worldchain")).toBe(false);
  });

  it("keeps 0G AI pool-only and resolves explorers by pool network", () => {
    expect(isRfqDisabledSpace(ZEROG_SPACE_SLUG)).toBe(true);
    expect(isPoolsDirectorySpace(ZEROG_SPACE_SLUG)).toBe(false);
    expect(getAddressExplorerUrl("0xabc0000000000000000000000000000000000000", ZEROG_SPACE_SLUG)).toBe(
      "https://chainscan.0g.ai/address/0xabc0000000000000000000000000000000000000"
    );
    expect(
      getAddressExplorerUrl(
        "0xabc0000000000000000000000000000000000000",
        ZEROG_SPACE_SLUG,
        ZEROG_W0G_USDCE_V3_POOL_KEY
      )
    ).toBe("https://chainscan.0g.ai/address/0xabc0000000000000000000000000000000000000");
    expect(
      getAddressExplorerUrl(
        "0xabc0000000000000000000000000000000000000",
        ZEROG_SPACE_SLUG,
        BSC_PANCAKE_V3_0G_USDT_POOL_KEY
      )
    ).toBe("https://bscscan.com/address/0xabc0000000000000000000000000000000000000");
  });
});
