import {
  buildRangeMapFromPositions,
  decimalAdjustedPriceToSqrtPriceX96,
  swapBuyToSqrtLimitOnRangeMap,
  swapSellToSqrtLimitOnRangeMap,
} from "@/lib/depth-calculator";
import type { PositionData } from "@/lib/envio-client";

export type RoutingSide = "buyTracked" | "sellTracked";

export interface RoutingPoolInput {
  poolKey: string;
  /** SupportedPool.key — used to disambiguate venues whose `protocol` collides (e.g. Byreal sits on Raydium). */
  key: string;
  label: string;
  venue: string;
  feeTier: string;
  /** Raw V3 fee field — units of 1/1,000,000 (e.g. 2500 = 0.25%). */
  feeRaw: number;
  positions: PositionData[];
  sqrtPriceX96: string;
  currentTick: number;
  /** Pool's current price (token1 per token0, decimal-adjusted). */
  currentPrice: number;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  /** True when the asset being routed is token0 of this pool. */
  isTrackedToken0: boolean;
}

export interface RoutingAllocation {
  poolKey: string;
  key: string;
  label: string;
  venue: string;
  feeTier: string;
  inputUsd: number;
  outputUsd: number;
  /** Effective execution price (USD-out / USD-in) for this slice, post-fee. */
  effectivePrice: number;
  sharePct: number;
}

export interface RoutingResult {
  side: RoutingSide;
  orderUsd: number;
  totalInputUsd: number;
  totalOutputUsd: number;
  /** Price impact + fee combined: 1 − totalOutputUsd / orderUsd, expressed as percent. */
  effectiveImpactPct: number;
  /** True when the requested order exceeds available routable liquidity. */
  capacityExceeded: boolean;
  /** Maximum total input USD this prepared pool set can absorb on this side
   *  before being fully drained. Useful for fragility/depth diagnostics: if
   *  `orderUsd > maxInputUsd`, the order cannot be fully routed. Note: for a
   *  buy that walks sqrtP to extreme high (or sell to extreme low), the USDC
   *  / AI input required to fully drain the pool grows asymptotically — so
   *  this number can be very large. For a *physical* depth metric prefer
   *  `maxOutputUsd`, which is bounded by actual token reserves. */
  maxInputUsd: number;
  /** Maximum total output USD the pool set can produce on this side — i.e.,
   *  the USD value of every token the trader could ever extract on this
   *  swap direction. Bounded by physical reserves, so it's the right metric
   *  for "how much can the pool actually give me on this side". */
  maxOutputUsd: number;
  allocations: RoutingAllocation[];
}

export interface PreparedRoutingPool extends RoutingPoolInput {
  rangeMap: ReturnType<typeof buildRangeMapFromPositions>;
  currentSqrtPriceX96: bigint;
  feeFraction: number;
  /** Pre-fee marginal $-out per $-in at the pool's current sqrt price. */
  initialMarginal: number;
  /** True if the pool is unusable (no liquidity, missing prices, etc.). */
  unusable: boolean;
}

const Q96 = 2n ** 96n;

function bigintToApproxNumber(x: bigint, decimals: number): number {
  const neg = x < 0n;
  const v = neg ? -x : x;
  if (v === 0n) return 0;
  const base = 10n ** BigInt(Math.max(decimals, 0));
  const intPart = v / base;
  const fracPart = v % base;
  const intStr = intPart.toString();
  const intNum =
    intStr.length > 15
      ? Number(intStr.slice(0, 15)) * 10 ** (intStr.length - 15)
      : Number(intPart);
  const fracNum = decimals > 0 ? Number(fracPart) / Number(base) : 0;
  return (neg ? -1 : 1) * (intNum + fracNum);
}

/**
 * Pre-fee marginal "USD-out per USD-in" at a given sqrt price.
 * Buy tracked = paying counter-asset, receiving tracked.
 */
function preFeeMarginal(args: {
  pool: RoutingPoolInput;
  sqrtPriceX96: bigint;
  side: RoutingSide;
}): number {
  const { pool, sqrtPriceX96, side } = args;
  const t0Usd = pool.token0UsdPrice;
  const t1Usd = pool.token1UsdPrice;
  if (!t0Usd || !t1Usd) return 0;

  // price (token1 per token0, decimal-adjusted) = (sqrtP/Q96)^2 / 10^(t0Dec - t1Dec)
  // Use the same approach as sqrtPriceX96ToPrice: ratio = sqrtP / Q96 in float.
  const ratio = Number(sqrtPriceX96) / Number(Q96);
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const decAdj = ratio * ratio; // raw token1 per raw token0
  const priceT1PerT0 = decAdj * 10 ** (pool.token0Decimals - pool.token1Decimals);
  if (!Number.isFinite(priceT1PerT0) || priceT1PerT0 <= 0) return 0;

  const swapsToken0 = (side === "buyTracked") === pool.isTrackedToken0;
  // swapsToken0=true means input is token1 and output is token0.
  if (swapsToken0) {
    // marginal = (token0 per token1) × (t0Usd / t1Usd) = t0Usd / (t1Usd × priceT1PerT0)
    return t0Usd / (t1Usd * priceT1PerT0);
  }
  // input is token0, output is token1: marginal = priceT1PerT0 × t1Usd / t0Usd
  return (priceT1PerT0 * t1Usd) / t0Usd;
}

/**
 * Solve for the sqrt-price stop where the pool's post-fee marginal equals λ.
 * Returns null when pool can't reach λ (i.e., it would need to push past
 * its initial price in the wrong direction).
 */
function sqrtLimitForWaterLevel(args: {
  pool: PreparedRoutingPool;
  side: RoutingSide;
  lambda: number;
}): bigint | null {
  const { pool, side, lambda } = args;
  if (lambda <= 0) return null;
  const t0Usd = pool.token0UsdPrice;
  const t1Usd = pool.token1UsdPrice;
  if (!t0Usd || !t1Usd) return null;

  const swapsToken0 = (side === "buyTracked") === pool.isTrackedToken0;
  // post_fee_marginal = (1 − fee) × pre_fee_marginal = λ
  // → pre_fee_marginal_target = λ / (1 − fee)
  const preFeeTarget = lambda / (1 - pool.feeFraction);

  let priceT1PerT0Target: number;
  if (swapsToken0) {
    // pre_fee_marginal = t0Usd / (t1Usd × priceT1PerT0) = preFeeTarget
    // → priceT1PerT0 = t0Usd / (t1Usd × preFeeTarget)
    priceT1PerT0Target = t0Usd / (t1Usd * preFeeTarget);
  } else {
    // pre_fee_marginal = priceT1PerT0 × t1Usd / t0Usd = preFeeTarget
    // → priceT1PerT0 = preFeeTarget × t0Usd / t1Usd
    priceT1PerT0Target = (preFeeTarget * t0Usd) / t1Usd;
  }

  if (!Number.isFinite(priceT1PerT0Target) || priceT1PerT0Target <= 0) return null;

  const decAdjTarget =
    priceT1PerT0Target * 10 ** (pool.token1Decimals - pool.token0Decimals);
  const sqrtTarget = decimalAdjustedPriceToSqrtPriceX96(decAdjTarget);
  if (sqrtTarget <= 0n) return null;

  // Direction sanity: a buy-token0 swap moves sqrtP up; a sell-token0 swap moves
  // sqrtP down. If the target sits the wrong way, the pool isn't allocating.
  if (swapsToken0) {
    if (sqrtTarget <= pool.currentSqrtPriceX96) return null;
  } else {
    if (sqrtTarget >= pool.currentSqrtPriceX96) return null;
  }

  return sqrtTarget;
}

/**
 * Run a single pool's swap up to a sqrt-price stop and return USD-denominated
 * input/output (post-fee).
 */
function simulatePoolAtStop(args: {
  pool: PreparedRoutingPool;
  side: RoutingSide;
  sqrtLimitX96: bigint;
}): { inputUsd: number; outputUsd: number } {
  const { pool, side, sqrtLimitX96 } = args;
  const swapsToken0 = (side === "buyTracked") === pool.isTrackedToken0;

  if (swapsToken0) {
    const { amount1In, amount0Out } = swapBuyToSqrtLimitOnRangeMap({
      rangeMap: pool.rangeMap,
      currentTick: pool.currentTick,
      currentSqrtPriceX96: pool.currentSqrtPriceX96,
      sqrtLimitX96,
    });
    const t1 = bigintToApproxNumber(amount1In, pool.token1Decimals);
    const t0 = bigintToApproxNumber(amount0Out, pool.token0Decimals);
    const grossInputUsd = t1 * (pool.token1UsdPrice ?? 0);
    const inputUsd = grossInputUsd / Math.max(1 - pool.feeFraction, 1e-9);
    const outputUsd = t0 * (pool.token0UsdPrice ?? 0);
    return { inputUsd, outputUsd };
  }

  const { amount0In, amount1Out } = swapSellToSqrtLimitOnRangeMap({
    rangeMap: pool.rangeMap,
    currentTick: pool.currentTick,
    currentSqrtPriceX96: pool.currentSqrtPriceX96,
    sqrtLimitX96,
  });
  const t0 = bigintToApproxNumber(amount0In, pool.token0Decimals);
  const t1 = bigintToApproxNumber(amount1Out, pool.token1Decimals);
  const grossInputUsd = t0 * (pool.token0UsdPrice ?? 0);
  const inputUsd = grossInputUsd / Math.max(1 - pool.feeFraction, 1e-9);
  const outputUsd = t1 * (pool.token1UsdPrice ?? 0);
  return { inputUsd, outputUsd };
}

function preparePool(pool: RoutingPoolInput): PreparedRoutingPool {
  const rangeMap = buildRangeMapFromPositions(pool.positions);
  let currentSqrtPriceX96 = 0n;
  try {
    currentSqrtPriceX96 = BigInt(pool.sqrtPriceX96);
  } catch {
    currentSqrtPriceX96 = 0n;
  }
  const feeFraction = Math.max(0, Math.min(1, pool.feeRaw / 1_000_000));
  const t0Usd = pool.token0UsdPrice;
  const t1Usd = pool.token1UsdPrice;
  const unusable =
    rangeMap.size === 0 ||
    currentSqrtPriceX96 <= 0n ||
    !Number.isFinite(pool.currentPrice) ||
    pool.currentPrice <= 0 ||
    !t0Usd ||
    !t1Usd;

  const preFeeInitial = unusable
    ? 0
    : preFeeMarginal({
        pool,
        sqrtPriceX96: currentSqrtPriceX96,
        side: "buyTracked",
      });
  // initialMarginal is filled per-side in route(); store the pre-fee here as a
  // placeholder; the side-specific value is recomputed in route().
  return {
    ...pool,
    rangeMap,
    currentSqrtPriceX96,
    feeFraction,
    initialMarginal: preFeeInitial,
    unusable,
  };
}

export function prepareRoutingPools(pools: RoutingPoolInput[]): PreparedRoutingPool[] {
  return pools.map(preparePool);
}

/**
 * Water-fill router. Solves max Σ outputUsd_i(x_i) s.t. Σ x_i = orderUsd by
 * binary-searching the post-fee marginal water level λ.
 */
export function routePreparedOrderAcrossPools(args: {
  preparedPools: PreparedRoutingPool[];
  side: RoutingSide;
  orderUsd: number;
}): RoutingResult {
  const { preparedPools, side, orderUsd } = args;

  if (!Number.isFinite(orderUsd) || orderUsd <= 0 || preparedPools.length === 0) {
    return {
      side,
      orderUsd,
      totalInputUsd: 0,
      totalOutputUsd: 0,
      effectiveImpactPct: 0,
      capacityExceeded: false,
      maxInputUsd: 0,
      maxOutputUsd: 0,
      allocations: [],
    };
  }

  const usable = preparedPools.filter((p) => !p.unusable);

  // Per-side initial post-fee marginals — these set the upper bound for λ.
  const initialPostFee = usable.map((p) => {
    const preFee = preFeeMarginal({
      pool: p,
      sqrtPriceX96: p.currentSqrtPriceX96,
      side,
    });
    return (1 - p.feeFraction) * preFee;
  });
  const lambdaMax = initialPostFee.length ? Math.max(...initialPostFee) : 0;

  if (lambdaMax <= 0) {
    return {
      side,
      orderUsd,
      totalInputUsd: 0,
      totalOutputUsd: 0,
      effectiveImpactPct: 100,
      capacityExceeded: true,
      maxInputUsd: 0,
      maxOutputUsd: 0,
      allocations: [],
    };
  }

  // Maximum input available across all pools (λ → 0 means drain everything in
  // the swap direction). We compute it once to detect capacity exhaustion.
  const maxRun = usable.map((p) => {
    const swapsToken0 = (side === "buyTracked") === p.isTrackedToken0;
    const sqrtFloor = swapsToken0
      ? (1n << 160n) - 1n // arbitrarily high; swap walks until liquidity runs out
      : 1n; // arbitrarily low for sell direction
    return simulatePoolAtStop({ pool: p, side, sqrtLimitX96: sqrtFloor });
  });
  const maxTotalInputUsd = maxRun.reduce((s, r) => s + r.inputUsd, 0);
  const maxTotalOutputUsd = maxRun.reduce((s, r) => s + r.outputUsd, 0);
  const capacityExceeded = orderUsd > maxTotalInputUsd + 1e-6;

  let lo = 0;
  let hi = lambdaMax;
  let lastTotals: ReturnType<typeof simulatePoolAtStop>[] = maxRun;

  if (capacityExceeded) {
    lastTotals = maxRun;
  } else {
    for (let iter = 0; iter < 40; iter++) {
      const lambda = (lo + hi) / 2;
      const totals = usable.map((p) => {
        const stop = sqrtLimitForWaterLevel({ pool: p, side, lambda });
        if (!stop) return { inputUsd: 0, outputUsd: 0 };
        return simulatePoolAtStop({ pool: p, side, sqrtLimitX96: stop });
      });
      const totalInput = totals.reduce((s, r) => s + r.inputUsd, 0);
      lastTotals = totals;
      if (totalInput > orderUsd) {
        lo = lambda;
      } else {
        hi = lambda;
      }
      if (Math.abs(totalInput - orderUsd) / orderUsd < 1e-4) break;
    }
  }

  // Re-normalize so the allocations sum to exactly orderUsd. This corrects
  // residual binary-search error and rounding from sqrtP discretization.
  const rawTotal = lastTotals.reduce((s, r) => s + r.inputUsd, 0);
  const scale =
    !capacityExceeded && rawTotal > 0 ? orderUsd / rawTotal : 1;
  const scaledInputs = lastTotals.map((r) => r.inputUsd * scale);
  const scaledOutputs = lastTotals.map((r) => r.outputUsd * scale);

  const totalInputUsd = scaledInputs.reduce((s, v) => s + v, 0);
  const totalOutputUsd = scaledOutputs.reduce((s, v) => s + v, 0);
  // Impact is always measured against the *requested* orderUsd, not the actual
  // routed input. When the pool can fill the order (totalInputUsd ≈ orderUsd
  // after rescaling) the two are equivalent. When capacity is exceeded the
  // routed input collapses to whatever the pool could absorb, and the unfilled
  // portion of the requested order must be treated as a 100% loss — otherwise
  // a depleted pool that can only fill 10% of a $100k order would report a
  // *lower* impact than a healthy pool, because the partial-fill numerator
  // shrinks faster than the denominator.
  const denominator = orderUsd > 0 ? orderUsd : totalInputUsd;
  const effectiveImpactPct = denominator > 0
    ? Math.max(0, (1 - totalOutputUsd / denominator) * 100)
    : 100;

  const allocations: RoutingAllocation[] = usable
    .map((p, i) => {
      const inputUsd = scaledInputs[i] ?? 0;
      const outputUsd = scaledOutputs[i] ?? 0;
      const sharePct = totalInputUsd > 0 ? (inputUsd / totalInputUsd) * 100 : 0;
      const effectivePrice = inputUsd > 0 ? outputUsd / inputUsd : 0;
      return {
        poolKey: p.poolKey,
        key: p.key,
        label: p.label,
        venue: p.venue,
        feeTier: p.feeTier,
        inputUsd,
        outputUsd,
        effectivePrice,
        sharePct,
      };
    })
    .filter((a) => a.inputUsd > 0)
    .sort((a, b) => b.inputUsd - a.inputUsd);

  return {
    side,
    orderUsd,
    totalInputUsd,
    totalOutputUsd,
    effectiveImpactPct,
    capacityExceeded,
    maxInputUsd: maxTotalInputUsd,
    maxOutputUsd: maxTotalOutputUsd,
    allocations,
  };
}

export function routeOrderAcrossPools(args: {
  pools: RoutingPoolInput[];
  side: RoutingSide;
  orderUsd: number;
}): RoutingResult {
  return routePreparedOrderAcrossPools({
    preparedPools: prepareRoutingPools(args.pools),
    side: args.side,
    orderUsd: args.orderUsd,
  });
}

export const ROUTING_ORDER_SIZES_USD = [
  1_000,
  5_000,
  10_000,
  25_000,
  50_000,
  100_000,
] as const;
export type RoutingOrderSize = (typeof ROUTING_ORDER_SIZES_USD)[number];
