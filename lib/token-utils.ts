import type { SupportedPool } from "@/lib/pools";
import { getSolanaPoolMetadata } from "@/lib/pools";

// Quote tokens - used to determine the "tracked" asset in a pair
export const QUOTE_TOKENS = ["USDC", "USDC.E", "USDT", "WETH", "ETH"];

// Custom sort order for tracked assets
export const ASSET_ORDER = [
  "WARS", "WLD", "W0G", "0G", "WBTC", "WETH", "OUSDT", "EURC", "OXAUT", "MADS",
  "TSLAX", "NVDAX", "SPYX", "QQQX", "GLDX",
  "GOOGLX", "HOODX", "CRCLX", "METAX", "COINX", "STRCX", "SPCXX",
];

// Get the tracked asset from a token pair (the non-quote token)
export function getTrackedAsset(
  token0: string,
  token1: string
): { symbol: string; isToken0: boolean } {
  const t0 = token0.toUpperCase();
  const t1 = token1.toUpperCase();

  // If token1 is a quote token, track token0
  if (QUOTE_TOKENS.some((q) => t1.includes(q))) {
    return { symbol: token0, isToken0: true };
  }
  // If token0 is a quote token, track token1
  if (QUOTE_TOKENS.some((q) => t0.includes(q))) {
    return { symbol: token1, isToken0: false };
  }
  // Default to token0 (first token in pair)
  return { symbol: token0, isToken0: true };
}

export function normalizeTrackedAssetSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/\.E$/, "");
}

function tokenSymbolMatches(token: string, symbol: string): boolean {
  const normalizedSymbol = symbol.toUpperCase();
  const parts = token.toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean);
  return token.toUpperCase() === normalizedSymbol || parts.includes(normalizedSymbol);
}

export function getTrackedAssetForPool(pool: SupportedPool): { symbol: string; isToken0: boolean } {
  const [token0, token1] = getPoolTokenSymbols(pool);
  const fallback = getTrackedAsset(token0, token1);
  const override = pool.trackedAssetSymbol?.trim();

  if (!override) return fallback;

  if (tokenSymbolMatches(token0, override)) {
    return { symbol: override, isToken0: true };
  }
  if (tokenSymbolMatches(token1, override)) {
    return { symbol: override, isToken0: false };
  }
  return { symbol: override, isToken0: fallback.isToken0 };
}

export interface TokenInfo {
  symbol: string;
  poolCount: number;
  pools: SupportedPool[];
}

/** Extract token symbols from a pool label (e.g. "WLD / USDC" → ["WLD", "USDC"]) */
function getPoolTokenSymbols(pool: SupportedPool): [string, string] {
  const solMeta = getSolanaPoolMetadata(pool.poolKey);
  if (solMeta) {
    return [solMeta.token0Symbol, solMeta.token1Symbol];
  }
  const parts = pool.label.split("/").map((s) => s.trim());
  return [parts[0] || "", parts[1] || ""];
}

/** Get unique tracked tokens from a list of pools, sorted by ASSET_ORDER */
export function getUniqueTokensForPools(pools: SupportedPool[]): TokenInfo[] {
  const groups = new Map<string, SupportedPool[]>();

  for (const pool of pools) {
    const { symbol } = getTrackedAssetForPool(pool);
    const normalized = normalizeTrackedAssetSymbol(symbol);

    if (!groups.has(normalized)) {
      groups.set(normalized, []);
    }
    groups.get(normalized)!.push(pool);
  }

  const result: TokenInfo[] = [];
  for (const [symbol, tokenPools] of groups) {
    result.push({ symbol, poolCount: tokenPools.length, pools: tokenPools });
  }

  return result.sort((a, b) => {
    const aIndex = ASSET_ORDER.indexOf(a.symbol.toUpperCase());
    const bIndex = ASSET_ORDER.indexOf(b.symbol.toUpperCase());
    const aPos = aIndex === -1 ? 999 : aIndex;
    const bPos = bIndex === -1 ? 999 : bIndex;
    return aPos - bPos;
  });
}

/** Get all pools containing a specific token (by tracked asset symbol) */
export function getPoolsForToken(
  pools: SupportedPool[],
  tokenSymbol: string
): SupportedPool[] {
  const target = tokenSymbol.toUpperCase().replace(/\.E$/, "");
  return pools.filter((pool) => {
    const { symbol } = getTrackedAssetForPool(pool);
    return normalizeTrackedAssetSymbol(symbol) === target;
  });
}

/** Get both token symbols for a pool */
export { getPoolTokenSymbols };
