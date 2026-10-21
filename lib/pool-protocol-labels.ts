import { isWorldchainSolanaSupportedPool, type SupportedPool } from "@/lib/pools";

type PoolProtocolLabelInput = Pick<SupportedPool, "key" | "protocol" | "chain" | "chainId" | "spaceSlug">;

export function getPoolProtocolBadge(pool: PoolProtocolLabelInput): string {
  if (pool.key.startsWith("byreal-")) return "REAL";
  if (pool.chainId === 56) return "BSC";
  if (pool.chainId === 747474) return "KATANA";
  if (pool.chainId === 143) return "MONAD";
  if (isWorldchainSolanaSupportedPool(pool)) return "SOL";
  if (pool.protocol === "v2") return "V2";
  if (pool.protocol === "v4") return "V4";
  if (pool.protocol === "meteora") return "MET";
  if (pool.protocol === "raydium") return "RAY";
  return "V3";
}

export function getPoolProtocolName(pool: PoolProtocolLabelInput): string {
  if (pool.key.startsWith("byreal-")) return "BYREAL";
  if (pool.key.startsWith("pancake-v3-")) return "PANCAKESWAP V3";
  if (pool.chainId === 56) return "PANCAKE INFINITY";
  if (pool.chainId === 747474) return "SUSHI V3";
  if (pool.chainId === 143) return "UNISWAP V2";
  if (isWorldchainSolanaSupportedPool(pool)) return "SOLANA";
  if (pool.protocol === "v2") return "UNISWAP V2";
  if (pool.protocol === "v4") return "UNISWAP V4";
  if (pool.protocol === "meteora") return "METEORA";
  if (pool.protocol === "raydium") return "RAYDIUM";
  return "UNISWAP V3";
}
