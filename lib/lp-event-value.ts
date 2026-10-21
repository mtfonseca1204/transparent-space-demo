import type { LPEventData } from "@/lib/envio-client";
import { isV4PoolKey } from "@/lib/pools";
import { amountsForPosition, bigintToApproxNumber } from "@/lib/uniswap-v3-math";

type EventValueArgs = {
  event: LPEventData;
  poolKey: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null | undefined;
  token1UsdPrice: number | null | undefined;
  sqrtPriceX96?: string | null;
};

function absInteger(value: string | undefined | null): bigint | null {
  if (!value || !/^-?\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed < 0n ? -parsed : parsed;
}

function usdFromAmounts(
  amount0: number,
  amount1: number,
  token0UsdPrice: number | null | undefined,
  token1UsdPrice: number | null | undefined,
): number {
  if (token0UsdPrice != null && token1UsdPrice != null) {
    return amount0 * token0UsdPrice + amount1 * token1UsdPrice;
  }
  if (token0UsdPrice != null) {
    return amount0 * token0UsdPrice * 2;
  }
  if (token1UsdPrice != null) {
    return amount1 * token1UsdPrice * 2;
  }
  return 0;
}

function shouldValueV4EventFromLiquidity(event: LPEventData, poolKey: string): boolean {
  if (!isV4PoolKey(poolKey)) return false;

  const liquidityDelta = absInteger(event.liquidityDelta);
  if (liquidityDelta == null || liquidityDelta === 0n) return false;

  const amount0 = absInteger(event.amount0) ?? 0n;
  const amount1 = absInteger(event.amount1) ?? 0n;

  // Current Railway v4 LPEvent rows expose liquidity deltas in amount0 and
  // leave amount1 empty, so treating amount0 as token0 units undercounts by
  // orders of magnitude. If future indexers provide real token amounts, keep
  // using the token amount path.
  return (
    (amount0 === liquidityDelta && amount1 === 0n) ||
    (amount0 === 0n && amount1 === 0n)
  );
}

export function calculateLPEventUsdValue({
  event,
  poolKey,
  token0Decimals,
  token1Decimals,
  token0UsdPrice,
  token1UsdPrice,
  sqrtPriceX96,
}: EventValueArgs): number {
  if (sqrtPriceX96 && shouldValueV4EventFromLiquidity(event, poolKey)) {
    try {
      const liquidityDelta = absInteger(event.liquidityDelta) ?? 0n;
      const { amount0, amount1 } = amountsForPosition({
        liquidity: liquidityDelta,
        tickLower: Number(event.tickLower),
        tickUpper: Number(event.tickUpper),
        sqrtPriceX96: BigInt(sqrtPriceX96),
      });

      return usdFromAmounts(
        bigintToApproxNumber(amount0, token0Decimals),
        bigintToApproxNumber(amount1, token1Decimals),
        token0UsdPrice,
        token1UsdPrice,
      );
    } catch {
      // Fall through to raw amount valuation if any event row is malformed.
    }
  }

  const amount0 = Math.abs(Number(event.amount0) / Math.pow(10, token0Decimals));
  const amount1 = Math.abs(Number(event.amount1) / Math.pow(10, token1Decimals));
  return usdFromAmounts(amount0, amount1, token0UsdPrice, token1UsdPrice);
}
