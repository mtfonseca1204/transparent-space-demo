import type { PoolData } from "@/app/api/pool/[address]/route";
import type { PositionData } from "@/lib/envio-client";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";

export type PoolTokenBalanceBreakdown = {
  token0BalanceRaw: bigint;
  token1BalanceRaw: bigint;
  token0Balance: number;
  token1Balance: number;
  token0Percent: number;
  token1Percent: number;
};

function validUsdPrice(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function computeTokenPercents(poolData: PoolData, token0: number, token1: number) {
  const price = Number.isFinite(poolData.currentPrice) ? poolData.currentPrice : 0;
  const token0In1 = price > 0 ? token0 * price : 0;
  const totalIn1 = token0In1 + token1;
  const token0Percent = totalIn1 > 0 ? (token0In1 / totalIn1) * 100 : 50;
  return {
    token0Percent,
    token1Percent: 100 - token0Percent,
  };
}

export function computeBalanceTvlUsd(args: {
  poolData: PoolData | null | undefined;
  token0Usd: number | null | undefined;
  token1Usd: number | null | undefined;
}): number {
  const { poolData, token0Usd, token1Usd } = args;
  if (!poolData) return 0;

  const bal0 = parseFloat(poolData.token0Balance) || 0;
  const bal1 = parseFloat(poolData.token1Balance) || 0;
  return bal0 * validUsdPrice(token0Usd) + bal1 * validUsdPrice(token1Usd);
}

export function computePositionTokenBalances(args: {
  poolData: PoolData | null | undefined;
  positions: PositionData[] | null | undefined;
}): PoolTokenBalanceBreakdown | null {
  const { poolData, positions } = args;
  if (!poolData || !positions || positions.length === 0) return null;

  let sqrtPriceX96: bigint;
  try {
    sqrtPriceX96 = BigInt(poolData.sqrtPriceX96);
  } catch {
    return null;
  }
  if (sqrtPriceX96 <= 0n) return null;

  let token0Raw = 0n;
  let token1Raw = 0n;
  let usablePositions = 0;

  for (const position of positions) {
    let liquidity: bigint;
    try {
      liquidity = BigInt(position.liquidity);
    } catch {
      continue;
    }
    if (liquidity <= 0n) continue;

    const tickLower = Number(position.tickLower);
    const tickUpper = Number(position.tickUpper);
    if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickLower >= tickUpper) {
      continue;
    }

    try {
      const { amount0, amount1 } = amountsForPosition({
        liquidity,
        tickLower,
        tickUpper,
        sqrtPriceX96,
      });
      token0Raw += amount0;
      token1Raw += amount1;
      usablePositions += 1;
    } catch {
      continue;
    }
  }

  if (usablePositions === 0) return null;

  const token0Balance = bigintToApproxNumber(token0Raw, poolData.token0Decimals);
  const token1Balance = bigintToApproxNumber(token1Raw, poolData.token1Decimals);
  const { token0Percent, token1Percent } = computeTokenPercents(poolData, token0Balance, token1Balance);

  return {
    token0BalanceRaw: token0Raw,
    token1BalanceRaw: token1Raw,
    token0Balance,
    token1Balance,
    token0Percent,
    token1Percent,
  };
}

export function computePositionTvlUsd(args: {
  poolData: PoolData | null | undefined;
  positions: PositionData[] | null | undefined;
  token0Usd: number | null | undefined;
  token1Usd: number | null | undefined;
}): number {
  const { poolData, positions, token0Usd, token1Usd } = args;
  if (!poolData || !positions || positions.length === 0) return 0;

  const t0Usd = validUsdPrice(token0Usd);
  const t1Usd = validUsdPrice(token1Usd);
  if (t0Usd <= 0 && t1Usd <= 0) return 0;

  const balances = computePositionTokenBalances({ poolData, positions });
  if (!balances) return 0;

  return balances.token0Balance * t0Usd + balances.token1Balance * t1Usd;
}

export function resolvePoolTvlUsd(args: {
  poolData: PoolData | null | undefined;
  positions: PositionData[] | null | undefined;
  token0Usd: number | null | undefined;
  token1Usd: number | null | undefined;
}): number {
  const balanceTvlUsd = computeBalanceTvlUsd(args);
  if (balanceTvlUsd > 0) return balanceTvlUsd;

  return computePositionTvlUsd(args);
}
