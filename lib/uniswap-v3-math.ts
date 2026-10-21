// Minimal Uniswap V3 math helpers (bigint) for client-side analytics.
// Ported from Uniswap V3 core TickMath + LiquidityAmounts-style deltas.

const Q96 = BigInt(2) ** BigInt(96);
const MAX_TICK = 887272;

export function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < -MAX_TICK || tick > MAX_TICK) throw new Error("TICK");
  const absTick = tick < 0 ? -tick : tick;

  let ratio =
    (absTick & 0x1) !== 0
      ? BigInt("0xfffcb933bd6fad37aa2d162d1a594001")
      : BigInt("0x100000000000000000000000000000000");
  if ((absTick & 0x2) !== 0) ratio = (ratio * BigInt("0xfff97272373d413259a46990580e213a")) >> BigInt(128);
  if ((absTick & 0x4) !== 0) ratio = (ratio * BigInt("0xfff2e50f5f656932ef12357cf3c7fdcc")) >> BigInt(128);
  if ((absTick & 0x8) !== 0) ratio = (ratio * BigInt("0xffe5caca7e10e4e61c3624eaa0941cd0")) >> BigInt(128);
  if ((absTick & 0x10) !== 0) ratio = (ratio * BigInt("0xffcb9843d60f6159c9db58835c926644")) >> BigInt(128);
  if ((absTick & 0x20) !== 0) ratio = (ratio * BigInt("0xff973b41fa98c081472e6896dfb254c0")) >> BigInt(128);
  if ((absTick & 0x40) !== 0) ratio = (ratio * BigInt("0xff2ea16466c96a3843ec78b326b52861")) >> BigInt(128);
  if ((absTick & 0x80) !== 0) ratio = (ratio * BigInt("0xfe5dee046a99a2a811c461f1969c3053")) >> BigInt(128);
  if ((absTick & 0x100) !== 0) ratio = (ratio * BigInt("0xfcbe86c7900a88aedcffc83b479aa3a4")) >> BigInt(128);
  if ((absTick & 0x200) !== 0) ratio = (ratio * BigInt("0xf987a7253ac413176f2b074cf7815e54")) >> BigInt(128);
  if ((absTick & 0x400) !== 0) ratio = (ratio * BigInt("0xf3392b0822b70005940c7a398e4b70f3")) >> BigInt(128);
  if ((absTick & 0x800) !== 0) ratio = (ratio * BigInt("0xe7159475a2c29b7443b29c7fa6e889d9")) >> BigInt(128);
  if ((absTick & 0x1000) !== 0) ratio = (ratio * BigInt("0xd097f3bdfd2022b8845ad8f792aa5825")) >> BigInt(128);
  if ((absTick & 0x2000) !== 0) ratio = (ratio * BigInt("0xa9f746462d870fdf8a65dc1f90e061e5")) >> BigInt(128);
  if ((absTick & 0x4000) !== 0) ratio = (ratio * BigInt("0x70d869a156d2a1b890bb3df62baf32f7")) >> BigInt(128);
  if ((absTick & 0x8000) !== 0) ratio = (ratio * BigInt("0x31be135f97d08fd981231505542fcfa6")) >> BigInt(128);
  if ((absTick & 0x10000) !== 0) ratio = (ratio * BigInt("0x9aa508b5b7a84e1c677de54f3e99bc9")) >> BigInt(128);
  if ((absTick & 0x20000) !== 0) ratio = (ratio * BigInt("0x5d6af8dedb81196699c329225ee604")) >> BigInt(128);
  if ((absTick & 0x40000) !== 0) ratio = (ratio * BigInt("0x2216e584f5fa1ea926041bedfe98")) >> BigInt(128);
  if ((absTick & 0x80000) !== 0) ratio = (ratio * BigInt("0x48a170391f7dc42444e8fa2")) >> BigInt(128);

  if (tick > 0) ratio = (BigInt(2) ** BigInt(256) - BigInt(1)) / ratio;

  // Downcast from Q128.128 to Q64.96 with rounding up
  const roundBit = ratio & ((BigInt(1) << BigInt(32)) - BigInt(1));
  let sqrtPriceX96 = ratio >> BigInt(32);
  if (roundBit !== BigInt(0)) sqrtPriceX96 += BigInt(1);
  return sqrtPriceX96;
}

function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  return (a * b) / denom;
}

function amount1Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity, b - a, Q96);
}

function amount0Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  // (L << 96) * (b - a) / (b * a)
  return mulDiv(liquidity << BigInt(96), b - a, b * a);
}

export function amountsForPosition(args: {
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  sqrtPriceX96: bigint;
}): { amount0: bigint; amount1: bigint } {
  const { liquidity, tickLower, tickUpper, sqrtPriceX96 } = args;
  if (liquidity <= BigInt(0)) return { amount0: BigInt(0), amount1: BigInt(0) };

  const sqrtA = getSqrtRatioAtTick(tickLower);
  const sqrtB = getSqrtRatioAtTick(tickUpper);

  if (sqrtPriceX96 <= sqrtA) {
    return { amount0: amount0Delta(liquidity, sqrtA, sqrtB), amount1: BigInt(0) };
  }
  if (sqrtPriceX96 < sqrtB) {
    return {
      amount0: amount0Delta(liquidity, sqrtPriceX96, sqrtB),
      amount1: amount1Delta(liquidity, sqrtA, sqrtPriceX96),
    };
  }
  return { amount0: BigInt(0), amount1: amount1Delta(liquidity, sqrtA, sqrtB) };
}

export function bigintToApproxNumber(x: bigint, decimals: number): number {
  const neg = x < BigInt(0);
  const v = neg ? -x : x;
  if (v === BigInt(0)) return 0;

  const base = BigInt(10) ** BigInt(Math.max(decimals, 0));
  const i = v / base;
  const f = v % base;

  const iStr = i.toString();
  let iNum: number;
  if (iStr.length > 15) {
    const lead = Number(iStr.slice(0, 15));
    iNum = lead * 10 ** (iStr.length - 15);
  } else {
    iNum = Number(i);
  }

  const fNum = decimals > 0 ? Number(f) / Number(base) : 0;
  return (neg ? -1 : 1) * (iNum + fNum);
}

/**
 * Calculate the price at a given tick with decimal adjustment.
 * Returns token1 per token0.
 */
export function tickToPrice(
  tick: number,
  token0Decimals: number = 0,
  token1Decimals: number = 0
): number {
  const priceRaw = Math.pow(1.0001, tick);
  const decimalAdjustment = 10 ** (token0Decimals - token1Decimals);
  return priceRaw * decimalAdjustment;
}

/**
 * Calculate the value of liquidity at a specific tick, using either:
 * - "current-price": Fixed oracle prices (t0Usd, t1Usd)
 * - "tick-price": The tick's implied price for token0
 * 
 * For non-USD pairs with tick-based pricing, returns value in token1 units.
 */
export function calculateLiquidityValue(args: {
  amount0: number;
  amount1: number;
  tickCenter: number;
  token0Decimals: number;
  token1Decimals: number;
  pricingMode: "current-price" | "tick-price";
  // For current-price mode or USD conversion in tick-price mode
  t0Usd: number | null;
  t1Usd: number | null;
  // Fallback price if no USD prices available
  currentPrice: number;
}): { value: number; isUsd: boolean } {
  const {
    amount0,
    amount1,
    tickCenter,
    token0Decimals,
    token1Decimals,
    pricingMode,
    t0Usd,
    t1Usd,
    currentPrice,
  } = args;

  if (pricingMode === "tick-price") {
    // Calculate the price of token0 at this tick (in terms of token1)
    const tickPrice = tickToPrice(tickCenter, token0Decimals, token1Decimals);
    
    if (t1Usd !== null && Number.isFinite(t1Usd) && t1Usd > 0) {
      // USD-paired pool: convert to USD using token1's USD price
      const value0 = amount0 * tickPrice * t1Usd;
      const value1 = amount1 * t1Usd;
      return { value: value0 + value1, isUsd: true };
    }
    
    // Non-USD pair: return in token1 units
    const value0 = amount0 * tickPrice;
    return { value: value0 + amount1, isUsd: false };
  }

  // current-price mode: use fixed oracle prices
  if (t0Usd !== null && t1Usd !== null) {
    const value0 = amount0 * t0Usd;
    const value1 = amount1 * t1Usd;
    return { value: value0 + value1, isUsd: true };
  }

  // Fallback: use currentPrice (token0 in terms of token1)
  const value0 = amount0 * currentPrice;
  return { value: value0 + amount1, isUsd: false };
}

/**
 * Helper to calculate USD prices with fallback logic.
 * Returns t0Usd, t1Usd, and whether USD mode is available.
 */
export function deriveUsdPrices(args: {
  token0UsdPrice: number | null | undefined;
  token1UsdPrice: number | null | undefined;
  currentPrice: number;
}): { t0Usd: number | null; t1Usd: number | null; useUsd: boolean } {
  const { token0UsdPrice, token1UsdPrice, currentPrice } = args;

  const t0Usd =
    typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
      ? token0UsdPrice
      : typeof token1UsdPrice === "number" &&
          Number.isFinite(token1UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token1UsdPrice * currentPrice
        : null;

  const t1Usd =
    typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
      ? token1UsdPrice
      : typeof token0UsdPrice === "number" &&
          Number.isFinite(token0UsdPrice) &&
          Number.isFinite(currentPrice) &&
          currentPrice > 0
        ? token0UsdPrice / currentPrice
        : null;

  return { t0Usd, t1Usd, useUsd: t0Usd !== null && t1Usd !== null };
}


