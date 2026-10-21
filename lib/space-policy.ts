import { getExplorerUrl, getSupportedPool, isSolanaPool } from "@/lib/pools";
import { DEMO_SPACE_SLUG } from "@/lib/demo/constants";

export const KRAKEN_SPACE_SLUG = "kraken";
export { DEMO_SPACE_SLUG };
export const SOLANA_FOUNDATION_SPACE_SLUG = "solana-foundation";
export const GENSYN_SPACE_SLUG = "gensyn";
export const KATANA_SPACE_SLUG = "katana";
export const PERLE_SPACE_SLUG = "perle";
export const MONAD_SPACE_SLUG = "monad";
export const ZEROG_SPACE_SLUG = "0g-ai";
export const HYPERLIQUID_SPACE_SLUG = "hyperliquid";

type AnonymizedMarketMaker = "flowdesk" | "tokka";

const ANONYMIZED_MARKET_MAKER_DISPLAY: Record<
  AnonymizedMarketMaker,
  { label: string; shortLabel: string }
> = {
  flowdesk: { label: "MM A", shortLabel: "MM A" },
  tokka: { label: "MM B", shortLabel: "MM B" },
};

export function isKrakenLikeSpace(spaceSlug?: string | null): boolean {
  return (
    spaceSlug === KRAKEN_SPACE_SLUG ||
    spaceSlug === SOLANA_FOUNDATION_SPACE_SLUG ||
    spaceSlug === DEMO_SPACE_SLUG
  );
}

export function isPoolsDirectorySpace(spaceSlug?: string | null): boolean {
  return isKrakenLikeSpace(spaceSlug);
}

export function isRfqDirectorySpace(spaceSlug?: string | null): boolean {
  return spaceSlug === KRAKEN_SPACE_SLUG || spaceSlug === DEMO_SPACE_SLUG;
}

export function isRfqDisabledSpace(spaceSlug?: string | null): boolean {
  return (
    spaceSlug === "worldchain" ||
    spaceSlug === GENSYN_SPACE_SLUG ||
    spaceSlug === KATANA_SPACE_SLUG ||
    spaceSlug === PERLE_SPACE_SLUG ||
    spaceSlug === MONAD_SPACE_SLUG ||
    spaceSlug === ZEROG_SPACE_SLUG ||
    spaceSlug === HYPERLIQUID_SPACE_SLUG
  );
}

export function isHyperliquidSpace(spaceSlug?: string | null): boolean {
  return spaceSlug === HYPERLIQUID_SPACE_SLUG;
}

/**
 * Whether the token birds-eye dashboard shows the "Arb Volume (7d)" table
 * instead of the "Trade Size Slippage" matrix. Kraken-like spaces have always
 * used arb volume; 0G AI opts in too, sourcing reference prices from Binance
 * spot k-line data instead of Hyperliquid perps.
 */
export function showsArbVolumeTable(spaceSlug?: string | null): boolean {
  return isKrakenLikeSpace(spaceSlug) || spaceSlug === ZEROG_SPACE_SLUG;
}

export function shouldAnonymizeMarketMakers(spaceSlug?: string | null): boolean {
  return spaceSlug === SOLANA_FOUNDATION_SPACE_SLUG || spaceSlug === DEMO_SPACE_SLUG;
}

export function getMarketMakerDisplayLabel(
  marketMaker: string,
  fallbackLabel: string,
  spaceSlug?: string | null
): string {
  if (!shouldAnonymizeMarketMakers(spaceSlug)) return fallbackLabel;
  return ANONYMIZED_MARKET_MAKER_DISPLAY[marketMaker as AnonymizedMarketMaker]?.label ?? fallbackLabel;
}

export function getMarketMakerDisplayShortLabel(
  marketMaker: string,
  fallbackLabel: string,
  spaceSlug?: string | null
): string {
  if (!shouldAnonymizeMarketMakers(spaceSlug)) return fallbackLabel;
  return ANONYMIZED_MARKET_MAKER_DISPLAY[marketMaker as AnonymizedMarketMaker]?.shortLabel ?? fallbackLabel;
}

/**
 * Resolve the correct block-explorer URL for an address based on the active
 * space's underlying chain. Centralised here so address-link UI doesn't have
 * to repeat the per-space chain mapping.
 */
export function getAddressExplorerUrl(
  address: string,
  spaceSlug?: string | null,
  poolKey?: string | null
): string {
  if (poolKey) {
    const pool = getSupportedPool(poolKey);
    if (pool?.chain === "solana" || isSolanaPool(poolKey)) {
      return `https://solscan.io/account/${address}`;
    }
    return getExplorerUrl(poolKey, "address", address);
  }
  if (spaceSlug === GENSYN_SPACE_SLUG) {
    // Gensyn AI lives on Ethereum mainnet.
    return `https://etherscan.io/address/${address}`;
  }
  if (spaceSlug === KATANA_SPACE_SLUG) {
    return `https://katanascan.com/address/${address}`;
  }
  if (spaceSlug === MONAD_SPACE_SLUG) {
    return `https://monadscan.com/address/${address}`;
  }
  if (spaceSlug === ZEROG_SPACE_SLUG) {
    return `https://chainscan.0g.ai/address/${address}`;
  }
  if (
    spaceSlug === KRAKEN_SPACE_SLUG ||
    spaceSlug === DEMO_SPACE_SLUG ||
    spaceSlug === SOLANA_FOUNDATION_SPACE_SLUG ||
    spaceSlug === PERLE_SPACE_SLUG
  ) {
    // These spaces live on Solana.
    return `https://solscan.io/account/${address}`;
  }
  // Default for Worldchain (the original default of this codebase).
  return `https://worldscan.org/address/${address}`;
}
