import { isWarsUsdcV4PoolKey } from "@/lib/pools";

export function hasUsableIndexedV4Tvl(args: {
  poolKey: string;
  tvlToken0Raw: string;
  tvlToken1Raw: string;
}): boolean {
  const hasRows = args.tvlToken0Raw !== "" && args.tvlToken1Raw !== "";
  if (!hasRows) return false;

  const allZero = args.tvlToken0Raw === "0" && args.tvlToken1Raw === "0";
  return !(isWarsUsdcV4PoolKey(args.poolKey) && allZero);
}
