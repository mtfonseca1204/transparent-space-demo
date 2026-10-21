// Shared concentrated-liquidity "bars" math.
//
// A `DepthBand` is a position reduced to a tick range + active window [openedAt,
// end) + a single liquidity scalar `L` (peak liquidity for the lifecycle). A
// `DepthBar` is one price (tick) bin. Given the pool price tick at a timestamp,
// we distribute each band's liquidity across the bins it overlaps using the same
// Uniswap-v3 sqrt-price amount math as the liquidity-distribution chart, then
// value the per-bin token amounts in USD (or token1 units).
//
// Extracted from the LP-distribution replay (`historical-rebalances.tsx`) so the
// replay AND the historical liquidity-depth heatmap share ONE implementation of
// the math. All ticks are raw Uniswap ticks; all prices are raw token1/token0.

/** A position reduced to a tick range + active window + peak liquidity. */
export interface DepthBand {
  tickLower: number;
  tickUpper: number;
  /** Peak liquidity for the lifecycle (constant across [openedAt, end)). */
  L: number;
  openedAt: number;
  /** closedAt ?? nowSec — the position is live for t in [openedAt, end). */
  end: number;
  /** LP wallet (lowercased), when known. Used to filter the heatmap by address. */
  owner?: string;
  /** True when the underlying position has fully closed (an "inactive" LP). */
  closed?: boolean;
}

/** One price (tick) bin on the Y axis. */
export interface DepthBar {
  minTick: number;
  maxTick: number;
  tickMid: number;
}

/** Valuation inputs for converting per-bin token amounts to a single value. */
export interface DepthValueParams {
  token0Decimals: number;
  token1Decimals: number;
  /** When true, value in USD via t0Usd/t1Usd; else token1 units via fallbackPrice. */
  valueIsUsd: boolean;
  t0Usd: number | null;
  t1Usd: number | null;
  /** token1-per-token0 price used to value token0 when not in USD mode. */
  fallbackPrice: number;
}

export function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

/** Build uniform-step price bins spanning [minTickAligned, maxTickAligned). */
export function makeBarsBetween(
  minTick: number,
  maxTick: number,
  tickSpacing: number,
  targetBars: number,
): DepthBar[] {
  const spacing = Math.max(1, tickSpacing);
  const range = Math.max(1, maxTick - minTick);
  const step = Math.max(spacing, Math.round(range / targetBars / spacing) * spacing);
  const out: DepthBar[] = [];
  for (let tk = minTick; tk < maxTick; tk += step) {
    const mn = tk;
    const mx = Math.min(maxTick, tk + step);
    out.push({ minTick: mn, maxTick: mx, tickMid: (mn + mx) / 2 });
  }
  return out;
}

/**
 * Price bins of width `~2·tickRange`, centered on `centerTick`, aligned to
 * `tickSpacing`, ~`targetBars` bars. Matches the LP Liquidity Distribution chart
 * window so the replay and distribution charts agree.
 */
export function makeBars(
  centerTick: number,
  tickSpacing: number,
  tickRange = 8000,
  targetBars = 80,
): DepthBar[] {
  const spacing = Math.max(1, tickSpacing);
  const alignDown = (tk: number) => Math.floor(tk / spacing) * spacing;
  const minTick = alignDown(centerTick - tickRange);
  const maxTick = alignDown(centerTick + tickRange) + spacing;
  return makeBarsBetween(minTick, maxTick, spacing, targetBars);
}

/** Convert summed per-bin token amounts (already decimal-adjusted) to value. */
function valueAmount(amt0: number, amt1: number, p: DepthValueParams): number {
  return p.valueIsUsd
    ? amt0 * (p.t0Usd ?? 0) + amt1 * (p.t1Usd ?? 0)
    : amt0 * p.fallbackPrice + amt1;
}

/**
 * Value every band in `list` that is live at time `t`, distributed across
 * `bars` by tick overlap. `priceTick` is the pool price at `t` (sets the
 * token0/token1 split). Returns one value per bar.
 *
 * This is the per-bin form used by the replay (small bar count, called per
 * frame). For the heatmap's dense grids, prefer `valueColumn`.
 */
export function valueBarsFor(
  list: DepthBand[],
  bars: DepthBar[],
  priceTick: number,
  t: number,
  p: DepthValueParams,
): number[] {
  const out = new Array(bars.length).fill(0);
  const sqrtP = tickToSqrtPrice(priceTick);
  const pow0 = Math.pow(10, p.token0Decimals);
  const pow1 = Math.pow(10, p.token1Decimals);
  for (let bi = 0; bi < bars.length; bi++) {
    const { minTick, maxTick } = bars[bi];
    let amt0 = 0;
    let amt1 = 0;
    for (const b of list) {
      if (b.openedAt > t || t >= b.end) continue;
      const lo = Math.max(b.tickLower, minTick);
      const hi = Math.min(b.tickUpper, maxTick);
      if (lo >= hi) continue;
      const sqrtA = tickToSqrtPrice(lo);
      const sqrtB = tickToSqrtPrice(hi);
      const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
      const dUp = Math.max(0, sqrtB - clamped);
      const dDown = Math.max(0, clamped - sqrtA);
      amt0 += clamped > 0 && sqrtB > 0 ? (b.L * dUp) / (clamped * sqrtB) / pow0 : 0;
      amt1 += (b.L * dDown) / pow1;
    }
    out[bi] = valueAmount(amt0, amt1, p);
  }
  return out;
}

/**
 * Build one heatmap column: value `activeBands` (already filtered to bands live
 * at this timestamp) across `P` uniform bins of width `step` starting at the
 * absolute tick `binLo0`, with the pool price at `priceTick`.
 *
 * Band-centric: each band writes only the bins its tick range overlaps, so cost
 * is O(active × binsPerBand) rather than O(active × P). Requires uniform bins.
 */
export function valueColumn(
  activeBands: DepthBand[],
  binLo0: number,
  step: number,
  P: number,
  priceTick: number,
  p: DepthValueParams,
): Float64Array {
  const amt0 = new Float64Array(P);
  const amt1 = new Float64Array(P);
  const sqrtP = tickToSqrtPrice(priceTick);
  const gridHi = binLo0 + P * step;
  for (const b of activeBands) {
    const bandLo = Math.max(b.tickLower, binLo0);
    const bandHi = Math.min(b.tickUpper, gridHi);
    if (bandLo >= bandHi) continue;
    let jStart = Math.floor((bandLo - binLo0) / step);
    let jEnd = Math.floor((bandHi - binLo0 - 1e-9) / step);
    if (jStart < 0) jStart = 0;
    if (jEnd >= P) jEnd = P - 1;
    const L = b.L;
    for (let j = jStart; j <= jEnd; j++) {
      const cellLo = binLo0 + j * step;
      const cellHi = cellLo + step;
      const lo = Math.max(b.tickLower, cellLo);
      const hi = Math.min(b.tickUpper, cellHi);
      if (lo >= hi) continue;
      const sqrtA = tickToSqrtPrice(lo);
      const sqrtB = tickToSqrtPrice(hi);
      const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
      const dUp = Math.max(0, sqrtB - clamped);
      const dDown = Math.max(0, clamped - sqrtA);
      amt0[j] += clamped > 0 && sqrtB > 0 ? (L * dUp) / (clamped * sqrtB) : 0;
      amt1[j] += L * dDown;
    }
  }
  const pow0 = Math.pow(10, p.token0Decimals);
  const pow1 = Math.pow(10, p.token1Decimals);
  const out = new Float64Array(P);
  for (let j = 0; j < P; j++) {
    out[j] = valueAmount(amt0[j] / pow0, amt1[j] / pow1, p);
  }
  return out;
}

/**
 * Break down the liquidity value in a single cell — the tick band
 * [cellLoTick, cellHiTick) at time `t` and pool price `priceTick` — by owner.
 * Used for the heatmap's per-cell attribution drill-down. Returns owners sorted
 * by descending value (only owners with a positive contribution).
 */
export function cellOwnerBreakdown(
  bands: DepthBand[],
  t: number,
  cellLoTick: number,
  cellHiTick: number,
  priceTick: number,
  p: DepthValueParams,
): Array<{ owner: string; value: number }> {
  if (cellHiTick <= cellLoTick) return [];
  const sqrtP = tickToSqrtPrice(priceTick);
  const pow0 = Math.pow(10, p.token0Decimals);
  const pow1 = Math.pow(10, p.token1Decimals);
  const a0 = new Map<string, number>();
  const a1 = new Map<string, number>();
  for (const b of bands) {
    if (b.openedAt > t || t >= b.end) continue;
    const lo = Math.max(b.tickLower, cellLoTick);
    const hi = Math.min(b.tickUpper, cellHiTick);
    if (lo >= hi) continue;
    const sqrtA = tickToSqrtPrice(lo);
    const sqrtB = tickToSqrtPrice(hi);
    const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
    const dUp = Math.max(0, sqrtB - clamped);
    const dDown = Math.max(0, clamped - sqrtA);
    const amt0 = clamped > 0 && sqrtB > 0 ? (b.L * dUp) / (clamped * sqrtB) : 0;
    const amt1 = b.L * dDown;
    const o = b.owner ?? "";
    a0.set(o, (a0.get(o) ?? 0) + amt0);
    a1.set(o, (a1.get(o) ?? 0) + amt1);
  }
  const out: Array<{ owner: string; value: number }> = [];
  const owners = new Set<string>([...a0.keys(), ...a1.keys()]);
  for (const o of owners) {
    const value = valueAmount((a0.get(o) ?? 0) / pow0, (a1.get(o) ?? 0) / pow1, p);
    if (value > 0) out.push({ owner: o, value });
  }
  out.sort((x, y) => y.value - x.value);
  return out;
}
