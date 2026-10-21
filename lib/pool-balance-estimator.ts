import type { PoolData } from "@/app/api/pool/[address]/route";
import type { TickLiquidityData } from "@/lib/envio-client";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";

export type EstimatedPoolBalances = {
  token0BalanceRaw: bigint;
  token1BalanceRaw: bigint;
  token0Balance: number; // human units
  token1Balance: number; // human units
  token0Percent: number;
  token1Percent: number;
};

function safeGetNetByTick(tickData: TickLiquidityData[]): Map<number, bigint> {
  const m = new Map<number, bigint>();
  for (const t of tickData) {
    try {
      m.set(t.tick, BigInt(t.liquidityNet));
    } catch {
      // ignore malformed rows
    }
  }
  return m;
}

function uniqSortedTicksFromNet(netByTick: Map<number, bigint>): number[] {
  return [...netByTick.keys()].sort((a, b) => a - b);
}

function upperBound(arr: number[], x: number): number {
  // first index i where arr[i] > x
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Estimate pool balances from TickLiquidity + current liquidity/price.
 *
 * Notes:
 * - This is an approximation when the tick window is truncated (we only sum across provided ticks).
 * - Works for both v3 and v4 as long as `poolData` uses Uniswap v3-style sqrtPriceX96/tick/liquidity semantics.
 */
export function estimatePoolBalancesFromTickLiquidity(args: {
  tickData: TickLiquidityData[] | null | undefined;
  poolData: PoolData | null | undefined;
}): EstimatedPoolBalances | null {
  const { tickData, poolData } = args;
  if (!poolData) return null;
  if (!tickData || tickData.length < 2) return null;

  let currentLiquidity: bigint;
  let currentSqrtPriceX96: bigint;
  try {
    currentLiquidity = BigInt(poolData.liquidity);
    currentSqrtPriceX96 = BigInt(poolData.sqrtPriceX96);
  } catch {
    return null;
  }
  if (currentLiquidity <= BigInt(0)) return null;

  const netByTick = safeGetNetByTick(tickData);
  const ticks = uniqSortedTicksFromNet(netByTick);
  if (ticks.length < 2) return null;

  const currentTick = poolData.tick;
  const ub = upperBound(ticks, currentTick);
  const intervalIdx = ub - 1; // ticks[intervalIdx] <= currentTick < ticks[intervalIdx+1]
  if (intervalIdx < 0 || intervalIdx >= ticks.length - 1) return null;

  const liqByInterval: bigint[] = new Array(ticks.length - 1);
  liqByInterval[intervalIdx] = currentLiquidity;

  // Walk upward: crossing tick ticks[i] (left -> right) adds liquidityNet at that tick.
  let L = currentLiquidity;
  for (let i = intervalIdx + 1; i < ticks.length - 1; i++) {
    const t = ticks[i]!;
    L = L + (netByTick.get(t) ?? BigInt(0));
    liqByInterval[i] = L;
  }

  // Walk downward: crossing tick ticks[i+1] (right -> left) subtracts liquidityNet at that tick.
  L = currentLiquidity;
  for (let i = intervalIdx - 1; i >= 0; i--) {
    const boundary = ticks[i + 1]!;
    L = L - (netByTick.get(boundary) ?? BigInt(0));
    liqByInterval[i] = L;
  }

  let token0Raw = BigInt(0);
  let token1Raw = BigInt(0);

  for (let i = 0; i < ticks.length - 1; i++) {
    const liq = liqByInterval[i] ?? BigInt(0);
    if (liq <= BigInt(0)) continue;
    const tickLower = ticks[i]!;
    const tickUpper = ticks[i + 1]!;

    const { amount0, amount1 } = amountsForPosition({
      liquidity: liq,
      tickLower,
      tickUpper,
      sqrtPriceX96: currentSqrtPriceX96,
    });
    token0Raw += amount0;
    token1Raw += amount1;
  }

  const token0 = bigintToApproxNumber(token0Raw, poolData.token0Decimals);
  const token1 = bigintToApproxNumber(token1Raw, poolData.token1Decimals);

  const price = Number.isFinite(poolData.currentPrice) ? poolData.currentPrice : 0;
  const token0In1 = price > 0 ? token0 * price : 0;
  const totalIn1 = token0In1 + token1;
  const token0Percent = totalIn1 > 0 ? (token0In1 / totalIn1) * 100 : 50;
  const token1Percent = 100 - token0Percent;

  return {
    token0BalanceRaw: token0Raw,
    token1BalanceRaw: token1Raw,
    token0Balance: token0,
    token1Balance: token1,
    token0Percent,
    token1Percent,
  };
}


