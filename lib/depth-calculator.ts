import type { TickLiquidityData, PositionData, LPEventData } from "@/lib/envio-client";
import type { PoolData } from "@/app/api/pool/[address]/route";
import type { LiquidityPricingMode } from "@/stores/chart-settings-store";

export type DepthBandPoint = {
  timestamp: Date;
  buyPrice: number; // price after buying token0 with token1 (token1 per token0)
  sellPrice: number; // price after selling token0 for token1 (token1 per token0)
};

export type DepthBandConfig = {
  swapAmountUSD: number;
  /** USD price of token0 — needed for correct swap sizing on non-stablecoin pairs. */
  token0UsdPrice?: number | null;
  /** USD price of token1 — needed for correct swap sizing on non-stablecoin pairs. */
  token1UsdPrice?: number | null;
};

const BI = (v: string) => BigInt(v);
const Q96 = BigInt(2) ** BigInt(96);
const MAX_TICK = 887272;

function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number = 18,
  decimals1: number = 6
): number {
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const price = sqrtPrice * sqrtPrice;
  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  return price * decimalAdjustment;
}

function tickToPrice(
  tick: number,
  decimals0: number = 0,
  decimals1: number = 0
): number {
  const priceRaw = Math.pow(1.0001, tick);
  const decimalAdjustment = 10 ** (decimals0 - decimals1);
  return priceRaw * decimalAdjustment;
}

// Port of Uniswap V3 core TickMath.getSqrtRatioAtTick (exact, bigint)
export function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < -MAX_TICK || tick > MAX_TICK) throw new Error("TICK");
  const absTick = tick < 0 ? -tick : tick;

  let ratio =
    (absTick & 0x1) !== 0
      ? BI("0xfffcb933bd6fad37aa2d162d1a594001")
      : BI("0x100000000000000000000000000000000");
  if ((absTick & 0x2) !== 0) ratio = (ratio * BI("0xfff97272373d413259a46990580e213a")) >> BigInt(128);
  if ((absTick & 0x4) !== 0) ratio = (ratio * BI("0xfff2e50f5f656932ef12357cf3c7fdcc")) >> BigInt(128);
  if ((absTick & 0x8) !== 0) ratio = (ratio * BI("0xffe5caca7e10e4e61c3624eaa0941cd0")) >> BigInt(128);
  if ((absTick & 0x10) !== 0) ratio = (ratio * BI("0xffcb9843d60f6159c9db58835c926644")) >> BigInt(128);
  if ((absTick & 0x20) !== 0) ratio = (ratio * BI("0xff973b41fa98c081472e6896dfb254c0")) >> BigInt(128);
  if ((absTick & 0x40) !== 0) ratio = (ratio * BI("0xff2ea16466c96a3843ec78b326b52861")) >> BigInt(128);
  if ((absTick & 0x80) !== 0) ratio = (ratio * BI("0xfe5dee046a99a2a811c461f1969c3053")) >> BigInt(128);
  if ((absTick & 0x100) !== 0) ratio = (ratio * BI("0xfcbe86c7900a88aedcffc83b479aa3a4")) >> BigInt(128);
  if ((absTick & 0x200) !== 0) ratio = (ratio * BI("0xf987a7253ac413176f2b074cf7815e54")) >> BigInt(128);
  if ((absTick & 0x400) !== 0) ratio = (ratio * BI("0xf3392b0822b70005940c7a398e4b70f3")) >> BigInt(128);
  if ((absTick & 0x800) !== 0) ratio = (ratio * BI("0xe7159475a2c29b7443b29c7fa6e889d9")) >> BigInt(128);
  if ((absTick & 0x1000) !== 0) ratio = (ratio * BI("0xd097f3bdfd2022b8845ad8f792aa5825")) >> BigInt(128);
  if ((absTick & 0x2000) !== 0) ratio = (ratio * BI("0xa9f746462d870fdf8a65dc1f90e061e5")) >> BigInt(128);
  if ((absTick & 0x4000) !== 0) ratio = (ratio * BI("0x70d869a156d2a1b890bb3df62baf32f7")) >> BigInt(128);
  if ((absTick & 0x8000) !== 0) ratio = (ratio * BI("0x31be135f97d08fd981231505542fcfa6")) >> BigInt(128);
  if ((absTick & 0x10000) !== 0) ratio = (ratio * BI("0x9aa508b5b7a84e1c677de54f3e99bc9")) >> BigInt(128);
  if ((absTick & 0x20000) !== 0) ratio = (ratio * BI("0x5d6af8dedb81196699c329225ee604")) >> BigInt(128);
  if ((absTick & 0x40000) !== 0) ratio = (ratio * BI("0x2216e584f5fa1ea926041bedfe98")) >> BigInt(128);
  if ((absTick & 0x80000) !== 0) ratio = (ratio * BI("0x48a170391f7dc42444e8fa2")) >> BigInt(128);

  if (tick > 0) ratio = ((BigInt(2) ** BigInt(256)) - BigInt(1)) / ratio;

  // Downcast from Q128.128 to Q64.96 with rounding up
  const roundBit = ratio & ((BigInt(1) << BigInt(32)) - BigInt(1));
  let sqrtPriceX96 = ratio >> BigInt(32);
  if (roundBit !== BigInt(0)) sqrtPriceX96 += BigInt(1);
  return sqrtPriceX96;
}

function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  return (a * b) / denom;
}

// token1 amount for moving sqrtP up/down within a range (Q96). Returns token1 raw units.
function amount1Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity, b - a, Q96);
}

// token0 amount for moving sqrtP up/down within a range (Q96). Returns token0 raw units.
function amount0Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity << BigInt(96), b - a, b * a);
}

/**
 * Convert a USD amount to raw token amounts for buy/sell swap simulations.
 * Buy token0: pay token1 → need amount1InRaw
 * Sell token0: pay token0 → need amount0InRaw
 *
 * When token USD prices are provided, uses them for accurate conversion.
 * Falls back to assuming token1 ≈ USD (correct for stablecoin-quoted pairs).
 */
function usdToSwapAmounts(args: {
  orderUsd: number;
  token0Decimals: number;
  token1Decimals: number;
  currentPrice: number; // token1 per token0
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
}): { amount1InRaw: bigint; amount0InRaw: bigint } {
  const { orderUsd, token0Decimals, token1Decimals, currentPrice, token0UsdPrice, token1UsdPrice } = args;

  const t0Usd = typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && token0UsdPrice > 0 ? token0UsdPrice : null;
  const t1Usd = typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && token1UsdPrice > 0 ? token1UsdPrice : null;

  // token1 amount: USD → token1
  // If we have token1's USD price, divide to get the correct token1 amount.
  // Otherwise fall back to 1:1 (assumes token1 is USD-pegged).
  const token1Amount = t1Usd !== null ? orderUsd / t1Usd : orderUsd;
  const amount1InRaw = BigInt(Math.floor(token1Amount * 10 ** token1Decimals));

  // token0 amount: USD → token0
  let token0Amount: number;
  if (t0Usd !== null) {
    token0Amount = orderUsd / t0Usd;
  } else if (t1Usd !== null && Number.isFinite(currentPrice) && currentPrice > 0) {
    // Derive: token0UsdPrice = token1UsdPrice * currentPrice
    token0Amount = orderUsd / (t1Usd * currentPrice);
  } else {
    // Fallback: assumes token1 ≈ USD, so token0Price ≈ currentPrice
    token0Amount = Number.isFinite(currentPrice) && currentPrice > 0 ? orderUsd / currentPrice : 0;
  }
  const amount0InRaw = BigInt(Math.floor(token0Amount * 10 ** token0Decimals));

  return { amount1InRaw, amount0InRaw };
}

function clampBigint(v: bigint, min: bigint, max: bigint): bigint {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function nextSqrtPriceFromAmount1In(args: { sqrtP: bigint; liquidity: bigint; amount1In: bigint }): bigint {
  const { sqrtP, liquidity, amount1In } = args;
  if (amount1In <= BigInt(0)) return sqrtP;
  if (liquidity <= BigInt(0)) return sqrtP;
  // sqrtP_next = sqrtP + (amount1In * Q96) / L
  return sqrtP + mulDiv(amount1In, Q96, liquidity);
}

function nextSqrtPriceFromAmount0In(args: { sqrtP: bigint; liquidity: bigint; amount0In: bigint }): bigint {
  const { sqrtP, liquidity, amount0In } = args;
  if (amount0In <= BigInt(0)) return sqrtP;
  if (liquidity <= BigInt(0)) return sqrtP;
  // sqrtP_next = (L*Q96*sqrtP) / (L*Q96 + amount0In*sqrtP)
  const numerator = liquidity * Q96 * sqrtP;
  const denominator = liquidity * Q96 + amount0In * sqrtP;
  if (denominator === BigInt(0)) return sqrtP;
  return numerator / denominator;
}

function computeSqrtPriceAfterAmount1In(args: {
  tickData: TickLiquidityData[];
  currentTick: number;
  currentSqrtPriceX96: bigint;
  currentLiquidity: bigint;
  amount1In: bigint;
}): bigint {
  const { tickData, currentTick, currentSqrtPriceX96, currentLiquidity, amount1In } = args;
  if (amount1In <= BigInt(0)) return currentSqrtPriceX96;
  if (!tickData || tickData.length === 0) return currentSqrtPriceX96;

  // Map tick -> liquidityNet
  const netByTick = new Map<number, bigint>();
  for (const t of tickData) {
    try {
      netByTick.set(t.tick, BigInt(t.liquidityNet));
    } catch {
      // ignore malformed
    }
  }

  const sortedTicks = [...netByTick.keys()].sort((a, b) => a - b);
  const upTicks = sortedTicks.filter((t) => t > currentTick);

  let sqrtP = currentSqrtPriceX96;
  let L = currentLiquidity;
  let remaining = amount1In;

  for (const t of upTicks) {
    if (remaining <= BigInt(0)) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext <= sqrtP) continue;

    // When L=0 the price jumps to the next boundary for free (no tokens consumed)
    if (L <= BigInt(0)) {
      sqrtP = sqrtNext;
      const net = netByTick.get(t) ?? BigInt(0);
      L = L + net;
      continue;
    }

    const maxAmount1 = amount1Delta(L, sqrtP, sqrtNext);
    if (maxAmount1 >= remaining) {
      sqrtP = nextSqrtPriceFromAmount1In({ sqrtP, liquidity: L, amount1In: remaining });
      // ensure we don't overshoot the tick boundary due to rounding
      sqrtP = clampBigint(sqrtP, BigInt(1), sqrtNext);
      remaining = BigInt(0);
      break;
    }

    remaining -= maxAmount1;
    sqrtP = sqrtNext;
    const net = netByTick.get(t) ?? BigInt(0);
    L = L + net; // crossing left->right adds liquidityNet
  }

  return sqrtP;
}

function computeSqrtPriceAfterAmount0In(args: {
  tickData: TickLiquidityData[];
  currentTick: number;
  currentSqrtPriceX96: bigint;
  currentLiquidity: bigint;
  amount0In: bigint;
}): bigint {
  const { tickData, currentTick, currentSqrtPriceX96, currentLiquidity, amount0In } = args;
  if (amount0In <= BigInt(0)) return currentSqrtPriceX96;
  if (!tickData || tickData.length === 0) return currentSqrtPriceX96;

  // Map tick -> liquidityNet
  const netByTick = new Map<number, bigint>();
  for (const t of tickData) {
    try {
      netByTick.set(t.tick, BigInt(t.liquidityNet));
    } catch {
      // ignore malformed
    }
  }

  const sortedTicks = [...netByTick.keys()].sort((a, b) => a - b);
  const downTicks = sortedTicks.filter((t) => t <= currentTick).reverse();

  let sqrtP = currentSqrtPriceX96;
  let L = currentLiquidity;
  let remaining = amount0In;

  for (const t of downTicks) {
    if (remaining <= BigInt(0)) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext >= sqrtP) continue;

    // When L=0 the price jumps to the next boundary for free (no tokens consumed)
    if (L <= BigInt(0)) {
      sqrtP = sqrtNext;
      const net = netByTick.get(t) ?? BigInt(0);
      L = L - net;
      continue;
    }

    const maxAmount0 = amount0Delta(L, sqrtNext, sqrtP);
    if (maxAmount0 >= remaining) {
      sqrtP = nextSqrtPriceFromAmount0In({ sqrtP, liquidity: L, amount0In: remaining });
      // ensure we don't undershoot the tick boundary due to rounding
      sqrtP = clampBigint(sqrtP, sqrtNext, (BigInt(2) ** BigInt(160)) - BigInt(1));
      remaining = BigInt(0);
      break;
    }

    remaining -= maxAmount0;
    sqrtP = sqrtNext;
    const net = netByTick.get(t) ?? BigInt(0);
    L = L - net; // crossing right->left subtracts liquidityNet
  }

  return sqrtP;
}

/**
 * Calculate a depth band time-series for a given swap amount (USD).
 *
 * Notes / assumptions:
 * - Treats token1 as USD when token1 symbol looks like a stablecoin.
 * - For non-stable token1 pools, it falls back to treating token1 as USD anyway
 *   (so the band remains usable, but may be mis-scaled).
 * - Uses current pool liquidity + TickLiquidity.liquidityNet to simulate price movement.
 */
export function calculateDepthBandSeries(args: {
  timestamps: Date[];
  tickData: TickLiquidityData[];
  poolData: PoolData;
  config: DepthBandConfig;
}): DepthBandPoint[] {
  const { timestamps, tickData, poolData, config } = args;
  if (!timestamps || timestamps.length === 0) return [];
  if (!tickData || tickData.length === 0) return [];
  if (!poolData) return [];

  const swapAmountUsd = Number.isFinite(config.swapAmountUSD) ? config.swapAmountUSD : 0;
  if (swapAmountUsd <= 0) return [];

  const currentTick = poolData.tick;
  const currentSqrtP = BigInt(poolData.sqrtPriceX96);
  const currentLiquidity = BigInt(poolData.liquidity);

  const token0Decimals = poolData.token0Decimals;
  const token1Decimals = poolData.token1Decimals;

  const currentPrice = sqrtPriceX96ToPrice(currentSqrtP, token0Decimals, token1Decimals);

  const { amount1InRaw, amount0InRaw } = usdToSwapAmounts({
    orderUsd: swapAmountUsd,
    token0Decimals,
    token1Decimals,
    currentPrice,
    token0UsdPrice: config.token0UsdPrice,
    token1UsdPrice: config.token1UsdPrice,
  });

  const sqrtBuy = computeSqrtPriceAfterAmount1In({
    tickData,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    currentLiquidity,
    amount1In: amount1InRaw,
  });
  const buyPrice = sqrtPriceX96ToPrice(sqrtBuy, token0Decimals, token1Decimals);

  const sqrtSell = computeSqrtPriceAfterAmount0In({
    tickData,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    currentLiquidity,
    amount0In: amount0InRaw,
  });
  const sellPrice = sqrtPriceX96ToPrice(sqrtSell, token0Decimals, token1Decimals);

  if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) return [];

  return timestamps.map((timestamp) => ({
    timestamp,
    buyPrice,
    sellPrice,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION-BASED CALCULATION FUNCTIONS (ground truth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate total liquidity at a specific tick from positions
 */
function getLiquidityAtTickFromPositions(positions: PositionData[], tick: number): bigint {
  let totalLiquidity = 0n;
  for (const pos of positions) {
    if (pos.tickLower <= tick && tick < pos.tickUpper) {
      try {
        totalLiquidity += BigInt(pos.liquidity);
      } catch {
        // ignore malformed
      }
    }
  }
  return totalLiquidity;
}

/**
 * Get all unique tick boundaries from positions (sorted)
 */
function getPositionBoundaries(positions: PositionData[]): number[] {
  const boundarySet = new Set<number>();
  for (const pos of positions) {
    if (BigInt(pos.liquidity) > 0n) {
      boundarySet.add(pos.tickLower);
      boundarySet.add(pos.tickUpper);
    }
  }
  return [...boundarySet].sort((a, b) => a - b);
}

function computeSqrtPriceAfterAmount1InFromPositions(args: {
  positions: PositionData[];
  currentTick: number;
  currentSqrtPriceX96: bigint;
  amount1In: bigint;
}): bigint {
  const { positions, currentTick, currentSqrtPriceX96, amount1In } = args;
  if (amount1In <= BigInt(0)) return currentSqrtPriceX96;
  if (!positions || positions.length === 0) return currentSqrtPriceX96;

  const boundaries = getPositionBoundaries(positions);
  const upTicks = boundaries.filter((t) => t > currentTick);

  let sqrtP = currentSqrtPriceX96;
  let L = getLiquidityAtTickFromPositions(positions, currentTick);
  let remaining = amount1In;

  for (const t of upTicks) {
    if (remaining <= BigInt(0)) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext <= sqrtP) continue;

    // When L=0 the price jumps to the next boundary for free (no tokens consumed)
    if (L <= BigInt(0)) {
      sqrtP = sqrtNext;
      L = getLiquidityAtTickFromPositions(positions, t);
      continue;
    }

    const maxAmount1 = amount1Delta(L, sqrtP, sqrtNext);
    if (maxAmount1 >= remaining) {
      sqrtP = nextSqrtPriceFromAmount1In({ sqrtP, liquidity: L, amount1In: remaining });
      sqrtP = clampBigint(sqrtP, BigInt(1), sqrtNext);
      remaining = BigInt(0);
      break;
    }

    remaining -= maxAmount1;
    sqrtP = sqrtNext;
    L = getLiquidityAtTickFromPositions(positions, t);
  }

  return sqrtP;
}

function computeSqrtPriceAfterAmount0InFromPositions(args: {
  positions: PositionData[];
  currentTick: number;
  currentSqrtPriceX96: bigint;
  amount0In: bigint;
}): bigint {
  const { positions, currentTick, currentSqrtPriceX96, amount0In } = args;
  if (amount0In <= BigInt(0)) return currentSqrtPriceX96;
  if (!positions || positions.length === 0) return currentSqrtPriceX96;

  const boundaries = getPositionBoundaries(positions);
  const downTicks = boundaries.filter((t) => t <= currentTick).reverse();

  let sqrtP = currentSqrtPriceX96;
  let L = getLiquidityAtTickFromPositions(positions, currentTick);
  let remaining = amount0In;

  for (const t of downTicks) {
    if (remaining <= BigInt(0)) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext >= sqrtP) continue;

    // When L=0 the price jumps to the next boundary for free (no tokens consumed)
    if (L <= BigInt(0)) {
      sqrtP = sqrtNext;
      L = getLiquidityAtTickFromPositions(positions, t - 1);
      continue;
    }

    const maxAmount0 = amount0Delta(L, sqrtNext, sqrtP);
    if (maxAmount0 >= remaining) {
      sqrtP = nextSqrtPriceFromAmount0In({ sqrtP, liquidity: L, amount0In: remaining });
      sqrtP = clampBigint(sqrtP, sqrtNext, (BigInt(2) ** BigInt(160)) - BigInt(1));
      remaining = BigInt(0);
      break;
    }

    remaining -= maxAmount0;
    sqrtP = sqrtNext;
    L = getLiquidityAtTickFromPositions(positions, t - 1);
  }

  return sqrtP;
}

/**
 * Calculate a depth band time-series using POSITION-BASED calculation (ground truth).
 */
export function calculateDepthBandSeriesFromPositions(args: {
  timestamps: Date[];
  positions: PositionData[];
  poolData: PoolData;
  config: DepthBandConfig;
}): DepthBandPoint[] {
  const { timestamps, positions, poolData, config } = args;
  if (!timestamps || timestamps.length === 0) return [];
  if (!positions || positions.length === 0) return [];
  if (!poolData) return [];

  const swapAmountUsd = Number.isFinite(config.swapAmountUSD) ? config.swapAmountUSD : 0;
  if (swapAmountUsd <= 0) return [];

  const currentTick = poolData.tick;
  const currentSqrtP = BigInt(poolData.sqrtPriceX96);

  const token0Decimals = poolData.token0Decimals;
  const token1Decimals = poolData.token1Decimals;

  const currentPrice = sqrtPriceX96ToPrice(currentSqrtP, token0Decimals, token1Decimals);

  const { amount1InRaw, amount0InRaw } = usdToSwapAmounts({
    orderUsd: swapAmountUsd,
    token0Decimals,
    token1Decimals,
    currentPrice,
    token0UsdPrice: config.token0UsdPrice,
    token1UsdPrice: config.token1UsdPrice,
  });

  const sqrtBuy = computeSqrtPriceAfterAmount1InFromPositions({
    positions,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    amount1In: amount1InRaw,
  });
  const buyPrice = sqrtPriceX96ToPrice(sqrtBuy, token0Decimals, token1Decimals);

  const sqrtSell = computeSqrtPriceAfterAmount0InFromPositions({
    positions,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    amount0In: amount0InRaw,
  });
  const sellPrice = sqrtPriceX96ToPrice(sqrtSell, token0Decimals, token1Decimals);

  if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) return [];

  return timestamps.map((timestamp) => ({
    timestamp,
    buyPrice,
    sellPrice,
  }));
}

/**
 * Calculate impact prices using POSITION-BASED calculation (ground truth).
 * Returns the resulting price after a buy/sell swap of orderUsd amount.
 */
export function simulateImpactPricesFromPositions(args: {
  positions: PositionData[];
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  currentPrice: number;
  orderUsd: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
}): { buyPrice: number; sellPrice: number } {
  const {
    positions,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    currentPrice,
    orderUsd,
    token0UsdPrice,
    token1UsdPrice,
  } = args;

  if (!positions || positions.length === 0) return { buyPrice: NaN, sellPrice: NaN };
  if (!Number.isFinite(currentTick)) return { buyPrice: NaN, sellPrice: NaN };

  let currentSqrtP: bigint;
  try {
    currentSqrtP = BigInt(sqrtPriceX96);
  } catch {
    return { buyPrice: NaN, sellPrice: NaN };
  }

  const { amount1InRaw, amount0InRaw } = usdToSwapAmounts({
    orderUsd,
    token0Decimals,
    token1Decimals,
    currentPrice,
    token0UsdPrice,
    token1UsdPrice,
  });

  // BUY token0: pay token1, price goes up
  const sqrtBuy = computeSqrtPriceAfterAmount1InFromPositions({
    positions,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    amount1In: amount1InRaw,
  });
  const buyPrice = sqrtPriceX96ToPrice(sqrtBuy, token0Decimals, token1Decimals);

  // SELL token0: pay token0, price goes down
  const sqrtSell = computeSqrtPriceAfterAmount0InFromPositions({
    positions,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    amount0In: amount0InRaw,
  });
  const sellPrice = sqrtPriceX96ToPrice(sqrtSell, token0Decimals, token1Decimals);

  return { buyPrice, sellPrice };
}

// ═══════════════════════════════════════════════════════════════════════════
// POSITION ROLLBACK UTILITIES
// For reconstructing historical position state using LP events
// ═══════════════════════════════════════════════════════════════════════════

/**
 * RangeMap tracks total liquidity per (tickLower, tickUpper) range.
 * Key format: "tickLower:tickUpper"
 */
export type RangeMap = Map<string, bigint>;

/**
 * Build a RangeMap from current positions.
 * Aggregates liquidity by tick range.
 */
export function buildRangeMapFromPositions(positions: PositionData[]): RangeMap {
  const rangeMap: RangeMap = new Map();
  
  for (const pos of positions) {
    const liquidity = BigInt(pos.liquidity);
    if (liquidity <= 0n) continue;
    
    const key = `${pos.tickLower}:${pos.tickUpper}`;
    const existing = rangeMap.get(key) ?? 0n;
    rangeMap.set(key, existing + liquidity);
  }
  
  return rangeMap;
}

/**
 * Apply a rollback for a single LP event.
 * This REVERSES the event's effect on the range map.
 * - For MINT/INCREASE: subtract liquidityDelta
 * - For BURN/DECREASE: add back liquidityDelta (delta is already negative for burns)
 * 
 * Since liquidityDelta is positive for mints and negative for burns,
 * we simply subtract the delta to reverse the event.
 */
export function applyRollbackToRangeMap(rangeMap: RangeMap, event: LPEventData): void {
  const delta = BigInt(event.liquidityDelta);
  const tickLower = Number(event.tickLower);
  const tickUpper = Number(event.tickUpper);
  
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) return;
  
  const key = `${tickLower}:${tickUpper}`;
  const existing = rangeMap.get(key) ?? 0n;
  const newLiquidity = existing - delta;
  
  // If liquidity goes negative (shouldn't happen with valid data), clamp to 0
  if (newLiquidity <= 0n) {
    rangeMap.delete(key);
  } else {
    rangeMap.set(key, newLiquidity);
  }
}

/**
 * Get total liquidity at a specific tick from a RangeMap.
 * Sums liquidity from all ranges that contain the tick.
 */
export function getLiquidityAtTickFromRangeMap(rangeMap: RangeMap, tick: number): bigint {
  let totalLiquidity = 0n;
  
  for (const [key, liquidity] of rangeMap) {
    const [lowerStr, upperStr] = key.split(':');
    const lower = Number(lowerStr);
    const upper = Number(upperStr);
    
    if (lower <= tick && tick < upper && liquidity > 0n) {
      totalLiquidity += liquidity;
    }
  }
  
  return totalLiquidity;
}

/**
 * Get all unique tick boundaries from a RangeMap (sorted).
 */
export function getBoundariesFromRangeMap(rangeMap: RangeMap): number[] {
  const boundarySet = new Set<number>();
  
  for (const [key, liquidity] of rangeMap) {
    if (liquidity <= 0n) continue;
    
    const [lowerStr, upperStr] = key.split(':');
    boundarySet.add(Number(lowerStr));
    boundarySet.add(Number(upperStr));
  }
  
  return [...boundarySet].sort((a, b) => a - b);
}

/**
 * Convert a RangeMap to an array of virtual PositionData for use with existing functions.
 */
export function rangeMapToPositions(rangeMap: RangeMap): PositionData[] {
  const positions: PositionData[] = [];
  
  for (const [key, liquidity] of rangeMap) {
    if (liquidity <= 0n) continue;
    
    const [lowerStr, upperStr] = key.split(':');
    positions.push({
      id: `virtual-${key}`,
      owner: 'virtual',
      pool: 'virtual',
      tickLower: Number(lowerStr),
      tickUpper: Number(upperStr),
      liquidity: liquidity.toString(),
      updatedAt: 0,
      tokenId: '0',
    });
  }
  
  return positions;
}

/**
 * Compute sqrtPrice after swapping amount1In using a RangeMap.
 * Walks up through tick boundaries, recalculating liquidity from RangeMap at each boundary.
 */
export function computeSqrtPriceAfterAmount1InFromRangeMap(args: {
  rangeMap: RangeMap;
  currentTick: number;
  currentSqrtPriceX96: bigint;
  amount1In: bigint;
}): bigint {
  const { rangeMap, currentTick, currentSqrtPriceX96, amount1In } = args;
  if (amount1In <= BigInt(0)) return currentSqrtPriceX96;
  if (rangeMap.size === 0) return currentSqrtPriceX96;

  const boundaries = getBoundariesFromRangeMap(rangeMap);
  const upTicks = boundaries.filter((t) => t > currentTick);

  let sqrtP = currentSqrtPriceX96;
  let L = getLiquidityAtTickFromRangeMap(rangeMap, currentTick);
  let remaining = amount1In;

  for (const t of upTicks) {
    if (remaining <= BigInt(0)) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext <= sqrtP) continue;

    // When L=0 the price jumps to the next boundary for free (no tokens consumed)
    if (L <= BigInt(0)) {
      sqrtP = sqrtNext;
      L = getLiquidityAtTickFromRangeMap(rangeMap, t);
      continue;
    }

    const maxAmount1 = amount1Delta(L, sqrtP, sqrtNext);
    if (maxAmount1 >= remaining) {
      sqrtP = nextSqrtPriceFromAmount1In({ sqrtP, liquidity: L, amount1In: remaining });
      sqrtP = clampBigint(sqrtP, BigInt(1), sqrtNext);
      remaining = BigInt(0);
      break;
    }

    remaining -= maxAmount1;
    sqrtP = sqrtNext;
    L = getLiquidityAtTickFromRangeMap(rangeMap, t);
  }

  return sqrtP;
}

/**
 * Compute sqrtPrice after swapping amount0In using a RangeMap.
 * Walks down through tick boundaries, recalculating liquidity from RangeMap at each boundary.
 */
export function computeSqrtPriceAfterAmount0InFromRangeMap(args: {
  rangeMap: RangeMap;
  currentTick: number;
  currentSqrtPriceX96: bigint;
  amount0In: bigint;
}): bigint {
  const { rangeMap, currentTick, currentSqrtPriceX96, amount0In } = args;
  if (amount0In <= BigInt(0)) return currentSqrtPriceX96;
  if (rangeMap.size === 0) return currentSqrtPriceX96;

  const boundaries = getBoundariesFromRangeMap(rangeMap);
  const downTicks = boundaries.filter((t) => t <= currentTick).reverse();

  let sqrtP = currentSqrtPriceX96;
  let L = getLiquidityAtTickFromRangeMap(rangeMap, currentTick);
  let remaining = amount0In;

  for (const t of downTicks) {
    if (remaining <= BigInt(0)) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext >= sqrtP) continue;

    // When L=0 the price jumps to the next boundary for free (no tokens consumed)
    if (L <= BigInt(0)) {
      sqrtP = sqrtNext;
      L = getLiquidityAtTickFromRangeMap(rangeMap, t - 1);
      continue;
    }

    const maxAmount0 = amount0Delta(L, sqrtNext, sqrtP);
    if (maxAmount0 >= remaining) {
      sqrtP = nextSqrtPriceFromAmount0In({ sqrtP, liquidity: L, amount0In: remaining });
      sqrtP = clampBigint(sqrtP, sqrtNext, (BigInt(2) ** BigInt(160)) - BigInt(1));
      remaining = BigInt(0);
      break;
    }

    remaining -= maxAmount0;
    sqrtP = sqrtNext;
    L = getLiquidityAtTickFromRangeMap(rangeMap, t - 1);
  }

  return sqrtP;
}

/**
 * Simulate impact prices using a RangeMap (for historical calculations).
 */
export function simulateImpactPricesFromRangeMap(args: {
  rangeMap: RangeMap;
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  currentPrice: number;
  orderUsd: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
}): { buyPrice: number; sellPrice: number } {
  const {
    rangeMap,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    currentPrice,
    orderUsd,
    token0UsdPrice,
    token1UsdPrice,
  } = args;

  if (rangeMap.size === 0) return { buyPrice: NaN, sellPrice: NaN };
  if (!Number.isFinite(currentTick)) return { buyPrice: NaN, sellPrice: NaN };

  let currentSqrtP: bigint;
  try {
    currentSqrtP = BigInt(sqrtPriceX96);
  } catch {
    return { buyPrice: NaN, sellPrice: NaN };
  }

  const { amount1InRaw, amount0InRaw } = usdToSwapAmounts({
    orderUsd,
    token0Decimals,
    token1Decimals,
    currentPrice,
    token0UsdPrice,
    token1UsdPrice,
  });

  const sqrtBuy = computeSqrtPriceAfterAmount1InFromRangeMap({
    rangeMap,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    amount1In: amount1InRaw,
  });
  const buyPrice = sqrtPriceX96ToPrice(sqrtBuy, token0Decimals, token1Decimals);

  const sqrtSell = computeSqrtPriceAfterAmount0InFromRangeMap({
    rangeMap,
    currentTick,
    currentSqrtPriceX96: currentSqrtP,
    amount0In: amount0InRaw,
  });
  const sellPrice = sqrtPriceX96ToPrice(sqrtSell, token0Decimals, token1Decimals);

  return { buyPrice, sellPrice };
}

/**
 * Calculate USD depth in a tick range using a RangeMap (position-based).
 * This walks through the tick range and sums the USD value of liquidity.
 * 
 * @param liquidityPricingMode - "current-price" uses fixed oracle prices, "tick-price" uses each tick's implied price
 */
export function calculateDepthFromRangeMap(args: {
  rangeMap: RangeMap;
  currentTick: number;
  targetTick: number;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  currentPrice: number;
  tickSpacing?: number;
  liquidityPricingMode?: LiquidityPricingMode;
}): number {
  const {
    rangeMap,
    currentTick,
    targetTick,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    currentPrice,
    tickSpacing = 200,
    liquidityPricingMode = "current-price",
  } = args;

  if (rangeMap.size === 0) return 0;

  // USD price derivation
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
  const useUsd = t0Usd !== null && t1Usd !== null;
  
  // For tick-price mode, we only need t1Usd to convert to USD
  if (!useUsd && liquidityPricingMode !== "tick-price") return 0;
  if (liquidityPricingMode === "tick-price" && t1Usd === null) return 0;

  // Determine tick range and step
  const minTick = Math.min(currentTick, targetTick);
  const maxTick = Math.max(currentTick, targetTick);
  const step = tickSpacing;

  let totalUsd = 0;

  // Helper to convert bigint to approximate number
  const approxBigIntToNumber = (v: bigint): number => {
    const neg = v < BigInt(0);
    const abs = neg ? -v : v;
    const s = abs.toString();
    if (s.length <= 15) return Number(s) * (neg ? -1 : 1);
    const mantissa = Number(s.slice(0, 15));
    const exponent = s.length - 15;
    return mantissa * Math.pow(10, exponent) * (neg ? -1 : 1);
  };

  // Helper to convert tick to sqrt price
  const tickToSqrtPriceFloat = (tick: number): number => {
    return Math.pow(1.0001, tick / 2);
  };

  for (let t = minTick; t < maxTick; t += step) {
    const tickMin = t;
    const tickMax = Math.min(maxTick, t + step);
    const tickMid = (tickMin + tickMax) / 2;
    const liquidityActive = getLiquidityAtTickFromRangeMap(rangeMap, tickMin);

    // Calculate token amounts using Uniswap v3 math
    const sqrtA = tickToSqrtPriceFloat(tickMin);
    const sqrtB = tickToSqrtPriceFloat(tickMax);
    const Lnum = Math.max(0, approxBigIntToNumber(liquidityActive));

    if (Lnum === 0 || !Number.isFinite(sqrtA) || !Number.isFinite(sqrtB) || sqrtA <= 0 || sqrtB <= 0) {
      continue;
    }

    // Amount of token0 and token1 in this tick range
    const amount0 = Lnum * Math.abs(1 / sqrtA - 1 / sqrtB) / (10 ** token0Decimals);
    const amount1 = Lnum * Math.abs(sqrtB - sqrtA) / (10 ** token1Decimals);

    // Convert to USD based on pricing mode
    let value0: number;
    let value1: number;
    
    if (liquidityPricingMode === "tick-price") {
      // Use the tick's implied price
      const tickPrice = tickToPrice(tickMid, token0Decimals, token1Decimals);
      value0 = amount0 * tickPrice * (t1Usd ?? 1);
      value1 = amount1 * (t1Usd ?? 1);
    } else {
      // Use fixed oracle prices
      value0 = amount0 * (t0Usd ?? 0);
      value1 = amount1 * (t1Usd ?? 0);
    }
    
    totalUsd += value0 + value1;
  }

  return Number.isFinite(totalUsd) ? totalUsd : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// SWAP-TO-SQRT-LIMIT (used by the cross-pool routing engine)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulate a buy (token1 → token0) up to a target sqrt-price limit.
 * Walks tick boundaries upward, consuming token1 within each range until
 * sqrtP reaches `sqrtLimitX96` or liquidity is exhausted.
 * Returns the raw token1 spent and token0 received during the walk.
 */
export function swapBuyToSqrtLimitOnRangeMap(args: {
  rangeMap: RangeMap;
  currentTick: number;
  currentSqrtPriceX96: bigint;
  sqrtLimitX96: bigint;
}): { amount1In: bigint; amount0Out: bigint; sqrtPriceAfter: bigint } {
  const { rangeMap, currentTick, currentSqrtPriceX96, sqrtLimitX96 } = args;
  if (rangeMap.size === 0 || sqrtLimitX96 <= currentSqrtPriceX96) {
    return { amount1In: 0n, amount0Out: 0n, sqrtPriceAfter: currentSqrtPriceX96 };
  }

  const boundaries = getBoundariesFromRangeMap(rangeMap);
  const upTicks = boundaries.filter((t) => t > currentTick);

  let sqrtP = currentSqrtPriceX96;
  let L = getLiquidityAtTickFromRangeMap(rangeMap, currentTick);
  let amount1In = 0n;
  let amount0Out = 0n;

  for (const t of upTicks) {
    if (sqrtP >= sqrtLimitX96) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext <= sqrtP) continue;

    const sqrtTarget = sqrtNext < sqrtLimitX96 ? sqrtNext : sqrtLimitX96;

    if (L > 0n) {
      amount1In += amount1Delta(L, sqrtP, sqrtTarget);
      amount0Out += amount0Delta(L, sqrtP, sqrtTarget);
    }

    sqrtP = sqrtTarget;
    if (sqrtTarget === sqrtLimitX96) break;
    L = getLiquidityAtTickFromRangeMap(rangeMap, t);
  }

  return { amount1In, amount0Out, sqrtPriceAfter: sqrtP };
}

/**
 * Simulate a sell (token0 → token1) down to a target sqrt-price limit.
 * Mirror of `swapBuyToSqrtLimitOnRangeMap` walking downward.
 */
export function swapSellToSqrtLimitOnRangeMap(args: {
  rangeMap: RangeMap;
  currentTick: number;
  currentSqrtPriceX96: bigint;
  sqrtLimitX96: bigint;
}): { amount0In: bigint; amount1Out: bigint; sqrtPriceAfter: bigint } {
  const { rangeMap, currentTick, currentSqrtPriceX96, sqrtLimitX96 } = args;
  if (rangeMap.size === 0 || sqrtLimitX96 >= currentSqrtPriceX96) {
    return { amount0In: 0n, amount1Out: 0n, sqrtPriceAfter: currentSqrtPriceX96 };
  }

  const boundaries = getBoundariesFromRangeMap(rangeMap);
  const downTicks = boundaries.filter((t) => t <= currentTick).reverse();

  let sqrtP = currentSqrtPriceX96;
  let L = getLiquidityAtTickFromRangeMap(rangeMap, currentTick);
  let amount0In = 0n;
  let amount1Out = 0n;

  for (const t of downTicks) {
    if (sqrtP <= sqrtLimitX96) break;
    const sqrtNext = getSqrtRatioAtTick(t);
    if (sqrtNext >= sqrtP) continue;

    const sqrtTarget = sqrtNext > sqrtLimitX96 ? sqrtNext : sqrtLimitX96;

    if (L > 0n) {
      amount0In += amount0Delta(L, sqrtTarget, sqrtP);
      amount1Out += amount1Delta(L, sqrtTarget, sqrtP);
    }

    sqrtP = sqrtTarget;
    if (sqrtTarget === sqrtLimitX96) break;
    L = getLiquidityAtTickFromRangeMap(rangeMap, t - 1);
  }

  return { amount0In, amount1Out, sqrtPriceAfter: sqrtP };
}

/**
 * Convert a decimal-adjusted price (token1 per token0, raw-unit ratio) to a
 * Q64.96 sqrt-price, dynamically scaling to keep intermediate floats inside
 * Number's safe-integer range.
 */
export function decimalAdjustedPriceToSqrtPriceX96(decimalAdjustedPrice: number): bigint {
  if (!Number.isFinite(decimalAdjustedPrice) || decimalAdjustedPrice <= 0) return 0n;
  const ratio = Math.sqrt(decimalAdjustedPrice);
  if (!Number.isFinite(ratio) || ratio <= 0) return 0n;
  const log2Ratio = Math.log2(ratio);
  const k = Math.min(96, Math.max(0, Math.floor(52 - log2Ratio)));
  const scaled = Math.floor(ratio * 2 ** k);
  if (!Number.isFinite(scaled) || scaled < 0) return 0n;
  return BigInt(scaled) << BigInt(96 - k);
}
