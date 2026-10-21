import { isWarsUsdcV4PoolKey } from "@/lib/pools";
import { priceOracle } from "@/lib/price-oracle";

export type PoolDisplayPair = {
  baseSymbol: string;
  quoteSymbol: string;
  pairLabel: string;
  unitLabel: string;
  invert: boolean;
};

export function getPoolDisplayPair(args: {
  poolKey: string;
  token0Symbol: string;
  token1Symbol: string;
}): PoolDisplayPair {
  const stable0 = priceOracle.isUSDStableBySymbol(args.token0Symbol);
  const stable1 = priceOracle.isUSDStableBySymbol(args.token1Symbol);
  const baseSymbol = stable0 && !stable1 ? args.token1Symbol : args.token0Symbol;
  const quoteSymbol = stable0 && !stable1 ? args.token0Symbol : args.token1Symbol;
  const invert = isWarsUsdcV4PoolKey(args.poolKey)
    ? baseSymbol === args.token0Symbol
    : baseSymbol === args.token1Symbol;

  return {
    baseSymbol,
    quoteSymbol,
    pairLabel: `${baseSymbol}/${quoteSymbol}`,
    unitLabel: `${baseSymbol} per ${quoteSymbol}`,
    invert,
  };
}
