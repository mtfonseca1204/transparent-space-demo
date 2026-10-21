/**
 * Raydium CLMM math utilities.
 *
 * Raydium uses sqrtPriceX64 (Q64.64 fixed-point) whereas Uniswap V3 uses
 * sqrtPriceX96 (Q64.96). The tick formula is identical: price = 1.0001^tick.
 */

import { getSqrtRatioAtTick } from "./uniswap-v3-math";

const Q64 = BigInt(2) ** BigInt(64);
const Q96 = BigInt(2) ** BigInt(96);

/** Convert Raydium sqrtPriceX64 to a human-readable price (token1 per token0). */
export function sqrtPriceX64ToPrice(
  sqrtPriceX64: bigint,
  decimals0: number,
  decimals1: number
): number {
  const sqrtPrice = Number(sqrtPriceX64) / Number(Q64);
  const price = sqrtPrice * sqrtPrice;
  return price * 10 ** (decimals0 - decimals1);
}

/** Convert Raydium sqrtPriceX64 → Uniswap-compatible sqrtPriceX96 string. */
export function sqrtPriceX64ToX96(
  sqrtPriceX64: bigint | string | number | null | undefined
): string {
  let v: bigint;
  if (typeof sqrtPriceX64 === "bigint") {
    v = sqrtPriceX64;
  } else if (typeof sqrtPriceX64 === "number") {
    v = Number.isFinite(sqrtPriceX64) ? BigInt(Math.trunc(sqrtPriceX64)) : 0n;
  } else if (typeof sqrtPriceX64 === "string") {
    const normalized = sqrtPriceX64.trim();
    const integerPart = normalized.split(".")[0] ?? "";
    v = /^-?\d+$/.test(integerPart) ? BigInt(integerPart) : 0n;
  } else {
    v = 0n;
  }

  // X96 = X64 * 2^32
  return (v * (Q96 / Q64)).toString();
}

/** Convert tick to price (same formula as Uniswap V3). */
export function tickToPrice(
  tick: number,
  decimals0: number = 0,
  decimals1: number = 0
): number {
  const priceRaw = Math.pow(1.0001, tick);
  return priceRaw * 10 ** (decimals0 - decimals1);
}

/** Convert price to tick (same formula as Uniswap V3). */
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

/** Convert a human-readable price (token1 per token0) into a Uniswap-style tick. */
export function humanPriceToTick(
  price: number,
  decimals0: number,
  decimals1: number
): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const rawPrice = price * 10 ** (decimals1 - decimals0);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  return priceToTick(rawPrice);
}

/** Convert a human-readable price (token1 per token0) into sqrtPriceX96. */
export function humanPriceToSqrtPriceX96(
  price: number,
  decimals0: number,
  decimals1: number
): string {
  try {
    return getSqrtRatioAtTick(
      humanPriceToTick(price, decimals0, decimals1)
    ).toString();
  } catch {
    return "0";
  }
}
