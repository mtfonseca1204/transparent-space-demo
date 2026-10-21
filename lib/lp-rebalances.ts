// Historical rebalance reconstruction for a single LP address.
//
// In a Uniswap V3 / concentrated-liquidity pool an LP "rebalances" by burning a
// position whose range the price has drifted out of and minting a fresh one
// centered on the current price. Pool-level Mint/Burn events do not carry a
// position/tokenId, so we reconstruct each position's lifecycle by matching
// adds and removes that share the same tick range, then use the price candles
// to measure how long the position sat out of range before the LP acted.
//
// All prices here are in the RAW token1/token0 orientation (same as
// `tickToPrice(tick, d0, d1)` and `PoolData.currentPrice`). Display orientation
// / USD conversion is applied by the consumer, not here, so detection stays
// orientation-safe.

import type { LPEventData } from "@/lib/envio-client";
import { tickToPrice } from "@/lib/envio-client";

export interface RebalanceCandle {
  /** Unix seconds. */
  t: number;
  /** Close price, raw token1/token0. */
  close: number;
  /** Intra-bucket high price (raw token1/token0). Defaults to `close` when absent. */
  high?: number;
  /** Intra-bucket low price (raw token1/token0). Defaults to `close` when absent. */
  low?: number;
}

export interface RebalanceRecord {
  id: string;
  tickLower: number;
  tickUpper: number;
  /** Raw token1/token0 price bounds (priceLower < priceUpper). */
  priceLower: number;
  priceUpper: number;
  /** Range width as a percentage of the mid price — smaller = more concentrated. */
  widthPct: number;
  openedAt: number;
  /** When the LP closed/rebalanced the position; null while still open. */
  closedAt: number | null;
  /** When the LP acted on this position (first removal / close). null while a
   *  still-open position remains untouched (ongoing). */
  rebalancedAt: number | null;
  /** When price entered the out-of-range stretch preceding the action; null if
   *  the position never drifted out of range (a proactive in-range rebalance). */
  outOfRangeAt: number | null;
  outSide: "above" | "below" | null;
  /** Raw price at the moment the position went out of range; null if in range. */
  outPrice: number | null;
  /** Seconds the position spent out of range before the LP responded (or, if
   *  ongoing, before `nowSec`). null for proactive in-range rebalances. */
  timeToRebalanceSec: number | null;
  /** True when the position is still open and currently out of range, with no
   *  liquidity removed since it drifted out (the LP has not yet reacted). */
  ongoing: boolean;
  /** True when the LP responded by trimming liquidity but is still holding the
   *  position (a partial withdrawal rather than a full close). */
  partial: boolean;
  /** True when the LP closed/trimmed while the price was still in range — a
   *  proactive rebalance rather than one forced by drifting out of range. */
  closedInRange: boolean;
  /** True when this is an open position the LP is simply holding — it was minted
   *  and never closed or trimmed (no rebalance action). */
  isHold: boolean;
  /** New range the LP re-centered into, when a re-mint was found near the close. */
  newTickLower: number | null;
  newTickUpper: number | null;
  /** Raw token1/token0 price bounds of the re-centered range, when known. */
  newPriceLower: number | null;
  newPriceUpper: number | null;
  /** Approx liquidity deployed (peak), for relative sizing only. */
  liquidity: number;
  /** Position NFT id, when the line maps to a currently-held position of the
   *  owner with a unique tick range. Null for closed positions (no current NFT
   *  to map to) or when multiple NFTs share the same range. */
  tokenId: string | null;
}

export interface RebalanceSummary {
  /** Rebalances the LP has acted on — out-of-range positions they have since
   *  trimmed (partial) or fully closed. */
  count: number;
  ongoingCount: number;
  /** Open positions minted and still held with no rebalance action. */
  holdCount: number;
  medianTimeToRebalanceSec: number | null;
  avgWidthPct: number | null;
}

export interface ComputeRebalancesOptions {
  token0Decimals: number;
  token1Decimals: number;
  /** Current pool tick — used to tell whether an open position is OOR right now. */
  currentTick: number;
  nowSec: number;
  /** The owner's actual current open positions (liquidity > 0). When provided, a
   *  reconstructed position that we never saw close is only kept if its range is
   *  still held — this prunes phantom "open" positions whose closing events were
   *  missed (e.g. truncated event history). `tokenId`, when present, labels open
   *  lines with their position NFT id. */
  currentPositions?: Array<{ tickLower: number; tickUpper: number; tokenId?: string; liquidity?: string }>;
}

interface OpenLot {
  tickLower: number;
  tickUpper: number;
  openedAt: number;
  liq: bigint;
  peakLiq: bigint;
  /** Timestamps of every liquidity-removal event (partial or full). */
  removals: number[];
}

interface Lifecycle {
  tickLower: number;
  tickUpper: number;
  openedAt: number;
  closedAt: number | null;
  liquidity: bigint;
  /** Timestamps of every liquidity-removal event (partial or full). */
  removals: number[];
}

const rangeKey = (tickLower: number, tickUpper: number): string => `${tickLower}:${tickUpper}`;

const isAddEvent = (e: LPEventData): boolean => e.eventType === "MINT" || e.eventType === "INCREASE";

function safeBigIntMagnitude(value: string): bigint {
  try {
    const v = BigInt(value);
    return v < BigInt(0) ? -v : v;
  } catch {
    return BigInt(0);
  }
}

/** A reconstructed position lifecycle for any owner — range, active window, and
 *  peak liquidity — used to draw the rest-of-pool distribution in the replay. */
export interface PoolPositionLifecycle {
  owner: string;
  tickLower: number;
  tickUpper: number;
  priceLower: number; // raw token1/token0
  priceUpper: number;
  openedAt: number;
  closedAt: number | null;
  liquidity: number;
}

/**
 * Reconstruct position lifecycles for EVERY owner from pool events (keyed by
 * owner + tick range). Used to render the "other LPs" distribution over time.
 */
export function reconstructAllLifecycles(
  events: LPEventData[],
  opts: { token0Decimals: number; token1Decimals: number },
): PoolPositionLifecycle[] {
  if (!events || events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  interface Lot {
    owner: string;
    tickLower: number;
    tickUpper: number;
    openedAt: number;
    liq: bigint;
    peakLiq: bigint;
  }
  const lots = new Map<string, Lot>();
  const out: PoolPositionLifecycle[] = [];

  const toLifecycle = (lot: Lot, closedAt: number | null): PoolPositionLifecycle => {
    const a = tickToPrice(lot.tickLower, opts.token0Decimals, opts.token1Decimals);
    const b = tickToPrice(lot.tickUpper, opts.token0Decimals, opts.token1Decimals);
    return {
      owner: lot.owner.toLowerCase(),
      tickLower: lot.tickLower,
      tickUpper: lot.tickUpper,
      priceLower: Math.min(a, b),
      priceUpper: Math.max(a, b),
      openedAt: lot.openedAt,
      closedAt,
      liquidity: Number(lot.peakLiq),
    };
  };

  for (const e of sorted) {
    const tickLower = Number(e.tickLower);
    const tickUpper = Number(e.tickUpper);
    if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickLower >= tickUpper) continue;
    const key = `${e.owner.toLowerCase()}:${tickLower}:${tickUpper}`;
    const mag = safeBigIntMagnitude(e.liquidityDelta);

    if (isAddEvent(e)) {
      const lot = lots.get(key);
      if (lot) {
        lot.liq += mag;
        if (lot.liq > lot.peakLiq) lot.peakLiq = lot.liq;
      } else {
        lots.set(key, { owner: e.owner, tickLower, tickUpper, openedAt: e.timestamp, liq: mag, peakLiq: mag });
      }
    } else {
      const lot = lots.get(key);
      if (!lot) continue;
      lot.liq -= mag;
      if (lot.liq <= BigInt(0)) {
        out.push(toLifecycle(lot, e.timestamp));
        lots.delete(key);
      }
    }
  }
  for (const lot of lots.values()) out.push(toLifecycle(lot, null));
  return out;
}

/** A constant-liquidity slice of a position's life: liquidity `L` held over
 *  [openedAt, end). One position produces several segments as it is topped up or
 *  trimmed, so summing the segment active at time `t` gives the *instant* (not
 *  peak) liquidity — the precise-depth model. `closed` is true when the lifecycle
 *  this segment belongs to was fully withdrawn (an inactive LP). */
export interface PositionLiquiditySegment {
  owner: string;
  tickLower: number;
  tickUpper: number;
  L: number;
  openedAt: number;
  end: number;
  closed: boolean;
}

/**
 * Reconstruct per-position liquidity SEGMENTS by replaying the signed
 * liquidityDelta stream for every owner+range, so liquidity varies within a
 * position's life (partial trims step down, top-ups step up) instead of being a
 * single peak scalar. Each full withdrawal ends a lifecycle (its segments are
 * flagged closed); a later add to the same range begins a fresh lifecycle, so
 * re-mints don't alias.
 */
export function reconstructLiquiditySegments(
  events: LPEventData[],
  opts: { token0Decimals: number; token1Decimals: number },
  nowSec: number,
): PositionLiquiditySegment[] {
  void opts; // decimals not needed for segment ticks/liquidity; kept for call-site symmetry
  if (!events || events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // Group by owner+range, preserving the typed fields (don't re-parse the key).
  const groups = new Map<
    string,
    { owner: string; tickLower: number; tickUpper: number; evs: LPEventData[] }
  >();
  for (const e of sorted) {
    const tickLower = Number(e.tickLower);
    const tickUpper = Number(e.tickUpper);
    if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickLower >= tickUpper) continue;
    const owner = e.owner.toLowerCase();
    const key = `${owner}:${tickLower}:${tickUpper}`;
    let g = groups.get(key);
    if (!g) {
      g = { owner, tickLower, tickUpper, evs: [] };
      groups.set(key, g);
    }
    g.evs.push(e);
  }

  const out: PositionLiquiditySegment[] = [];
  const ZERO = BigInt(0);

  for (const g of groups.values()) {
    let liq = ZERO;
    let segStart: number | null = null;
    let life: Array<{ start: number; end: number | null; L: bigint }> = [];

    const flush = (closed: boolean) => {
      for (const s of life) {
        out.push({
          owner: g.owner,
          tickLower: g.tickLower,
          tickUpper: g.tickUpper,
          L: Number(s.L),
          openedAt: s.start,
          end: s.end ?? nowSec,
          closed,
        });
      }
      life = [];
    };

    for (const e of g.evs) {
      const t = e.timestamp;
      const mag = safeBigIntMagnitude(e.liquidityDelta);
      // The level `liq` was held from segStart up to this event time.
      if (liq > ZERO && segStart != null && t > segStart) {
        life.push({ start: segStart, end: t, L: liq });
      }
      const newLiq = isAddEvent(e) ? liq + mag : liq > mag ? liq - mag : ZERO;
      if (liq > ZERO && newLiq === ZERO) {
        // Lifecycle fully closed at t — flush its segments as inactive.
        flush(true);
        segStart = null;
      } else if (newLiq > ZERO) {
        segStart = t;
      } else {
        segStart = null;
      }
      liq = newLiq;
    }

    if (liq > ZERO && segStart != null) {
      life.push({ start: segStart, end: null, L: liq });
      flush(false); // still-open lifecycle → active
    } else {
      flush(true);
    }
  }

  return out;
}

/**
 * Find the final out-of-range stretch that ends the position's life. Uses each
 * candle's intra-bucket high/low (not just the close) so a price that *traded*
 * outside the range is caught even if it closed back inside — this catches every
 * out-of-range excursion the pool had, at whatever candle resolution. A position
 * that came back in range before closing was a voluntary exit and returns null.
 */
function findFinalOutOfRange(
  candles: RebalanceCandle[],
  priceLower: number,
  priceUpper: number,
  startTs: number,
  endTs: number,
): { outAt: number; side: "above" | "below"; outPrice: number } | null {
  let runStart: RebalanceCandle | null = null;
  let runSide: "above" | "below" | null = null;
  let runOutPrice: number | null = null;
  let lastOor = false;

  for (const c of candles) {
    if (c.t < startTs || c.t > endTs) continue;
    const hi = c.high ?? c.close;
    const lo = c.low ?? c.close;
    const below = lo < priceLower;
    const above = hi > priceUpper;
    // If the bucket swept across the whole range, attribute it by where it closed.
    const side: "above" | "below" | null =
      below && above ? (c.close > priceUpper ? "above" : "below") : below ? "below" : above ? "above" : null;

    if (side) {
      // A fresh run starts whenever we were in range, or the side flipped
      // without ever returning in range.
      if (!lastOor || side !== runSide) {
        runStart = c;
        runSide = side;
        runOutPrice = side === "below" ? lo : hi;
      }
      lastOor = true;
    } else {
      lastOor = false;
      runStart = null;
      runSide = null;
      runOutPrice = null;
    }
  }

  if (lastOor && runStart && runSide) {
    return { outAt: runStart.t, side: runSide, outPrice: runOutPrice ?? runStart.close };
  }
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Reconstruct an LP's historical rebalances from their own mint/burn events plus
 * the pool's price candles. `events` must already be filtered to a single owner.
 */
export function computeRebalances(
  events: LPEventData[],
  candles: RebalanceCandle[],
  opts: ComputeRebalancesOptions,
): { records: RebalanceRecord[]; summary: RebalanceSummary } {
  const empty = {
    records: [] as RebalanceRecord[],
    summary: { count: 0, ongoingCount: 0, holdCount: 0, medianTimeToRebalanceSec: null, avgWidthPct: null },
  };
  if (!events || events.length === 0) return empty;

  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const sortedCandles = [...candles].sort((a, b) => a.t - b.t);

  // The owner's actual current positions (one per NFT). Open bars are driven off
  // this list so every held NFT gets its own row; reconstructed events supply the
  // mint time and trim history per range.
  const isPositiveLiquidity = (v: string | undefined): boolean => {
    if (v == null) return true; // unknown → assume held
    try {
      return BigInt(v) > BigInt(0);
    } catch {
      return Number(v) > 0;
    }
  };
  const validPositions = (opts.currentPositions ?? []).filter(
    (p) =>
      Number.isFinite(p.tickLower) &&
      Number.isFinite(p.tickUpper) &&
      p.tickLower < p.tickUpper &&
      isPositiveLiquidity(p.liquidity),
  );

  // 1. Reconstruct position lifecycles by matching adds/removes on the same range.
  const openLots = new Map<string, OpenLot>();
  const lifecycles: Lifecycle[] = [];
  const addEvents: Array<{ ts: number; tickLower: number; tickUpper: number; key: string }> = [];

  for (const e of sortedEvents) {
    const tickLower = Number(e.tickLower);
    const tickUpper = Number(e.tickUpper);
    if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || tickLower >= tickUpper) continue;

    const key = rangeKey(tickLower, tickUpper);
    const mag = safeBigIntMagnitude(e.liquidityDelta);

    if (isAddEvent(e)) {
      addEvents.push({ ts: e.timestamp, tickLower, tickUpper, key });
      const lot = openLots.get(key);
      if (lot) {
        lot.liq += mag;
        if (lot.liq > lot.peakLiq) lot.peakLiq = lot.liq;
      } else {
        openLots.set(key, {
          tickLower,
          tickUpper,
          openedAt: e.timestamp,
          liq: mag,
          peakLiq: mag,
          removals: [],
        });
      }
    } else {
      const lot = openLots.get(key);
      if (!lot) continue;
      // Record every removal — even a partial one is the LP reacting to drift.
      lot.removals.push(e.timestamp);
      lot.liq -= mag;
      if (lot.liq <= BigInt(0)) {
        lifecycles.push({
          tickLower: lot.tickLower,
          tickUpper: lot.tickUpper,
          openedAt: lot.openedAt,
          closedAt: e.timestamp,
          liquidity: lot.peakLiq,
          removals: lot.removals,
        });
        openLots.delete(key);
      }
    }
  }

  // Earliest add per range — a mint-time fallback for positions whose open lot
  // wasn't reconstructed (e.g. NFT received by transfer, or truncated history).
  const firstAddByRange = new Map<string, number>();
  for (const a of addEvents) {
    const cur = firstAddByRange.get(a.key);
    if (cur === undefined || a.ts < cur) firstAddByRange.set(a.key, a.ts);
  }

  // Build the units to classify: every CLOSED lifecycle (history) plus one OPEN
  // unit per current position so each held NFT gets its own bar. When no position
  // list is supplied, fall back to the event-reconstructed open lots.
  interface Unit extends Lifecycle {
    tokenId: string | null;
  }
  const fallbackOpenTs = sortedCandles[0]?.t ?? opts.nowSec;
  const units: Unit[] = lifecycles.map((lc) => ({ ...lc, tokenId: null }));

  if (opts.currentPositions) {
    for (const p of validPositions) {
      const key = rangeKey(p.tickLower, p.tickUpper);
      const lot = openLots.get(key);
      units.push({
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        openedAt: lot?.openedAt ?? firstAddByRange.get(key) ?? fallbackOpenTs,
        closedAt: null,
        liquidity: lot?.peakLiq ?? BigInt(1),
        removals: lot?.removals ?? [],
        tokenId: p.tokenId ?? null,
      });
    }
  } else {
    for (const lot of openLots.values()) {
      units.push({
        tickLower: lot.tickLower,
        tickUpper: lot.tickUpper,
        openedAt: lot.openedAt,
        closedAt: null,
        liquidity: lot.peakLiq,
        removals: lot.removals,
        tokenId: null,
      });
    }
  }

  // 2. Classify each unit: holds, partial trims, proactive/forced closes, ongoing.
  const records: RebalanceRecord[] = [];

  for (let i = 0; i < units.length; i++) {
    const lc = units[i];
    const rawLower = tickToPrice(lc.tickLower, opts.token0Decimals, opts.token1Decimals);
    const rawUpper = tickToPrice(lc.tickUpper, opts.token0Decimals, opts.token1Decimals);
    const priceLower = Math.min(rawLower, rawUpper);
    const priceUpper = Math.max(rawLower, rawUpper);
    const mid = (priceLower + priceUpper) / 2;
    const widthPct = mid > 0 ? ((priceUpper - priceLower) / mid) * 100 : 0;

    const isOpen = lc.closedAt === null;
    const endTs = lc.closedAt ?? opts.nowSec;
    const hasRemoval = lc.removals.length > 0;

    const oor = findFinalOutOfRange(sortedCandles, priceLower, priceUpper, lc.openedAt, endTs);

    let rebalancedAt: number | null;
    let timeToRebalanceSec: number | null;
    let ongoing: boolean;
    let partial: boolean;
    let closedInRange: boolean;
    let isHold: boolean;
    let outOfRangeAt: number | null = null;
    let outSide: "above" | "below" | null = null;
    let outPrice: number | null = null;

    const responseAt = oor ? lc.removals.find((ts) => ts >= oor.outAt) ?? null : null;

    if (oor && responseAt !== null) {
      // Drifted out of range, then the LP reacted (first removal — trim or close).
      outOfRangeAt = oor.outAt;
      outSide = oor.side;
      outPrice = oor.outPrice;
      rebalancedAt = responseAt;
      timeToRebalanceSec = Math.max(0, responseAt - oor.outAt);
      ongoing = false;
      partial = isOpen; // still holding the rest → partial trim
      closedInRange = false;
      isHold = false;
    } else if (oor && isOpen && (opts.currentTick < lc.tickLower || opts.currentTick >= lc.tickUpper)) {
      // Open, currently out of range, untouched since it drifted out.
      outOfRangeAt = oor.outAt;
      outSide = oor.side;
      outPrice = oor.outPrice;
      rebalancedAt = null;
      timeToRebalanceSec = Math.max(0, opts.nowSec - oor.outAt);
      ongoing = true;
      partial = false;
      closedInRange = false;
      isHold = false;
    } else if (hasRemoval) {
      // Closed/trimmed while in range — a proactive rebalance.
      rebalancedAt = lc.closedAt ?? lc.removals[lc.removals.length - 1];
      timeToRebalanceSec = null;
      ongoing = false;
      partial = isOpen;
      closedInRange = true;
      isHold = false;
    } else if (isOpen) {
      // Open position minted and never closed or trimmed — a hold (includes ones
      // that briefly drifted out and came back in range).
      rebalancedAt = null;
      timeToRebalanceSec = null;
      ongoing = false;
      partial = false;
      closedInRange = false;
      isHold = true;
    } else {
      // Closed with no removal recorded after its final out-of-range stretch.
      continue;
    }

    // Look for the re-mint that re-centered the LP (a new range opened near the response).
    let newTickLower: number | null = null;
    let newTickUpper: number | null = null;
    let newPriceLower: number | null = null;
    let newPriceUpper: number | null = null;
    if (rebalancedAt !== null) {
      const reMint = addEvents.find(
        (a) =>
          a.key !== rangeKey(lc.tickLower, lc.tickUpper) &&
          a.ts >= rebalancedAt - 60 &&
          a.ts <= rebalancedAt + 86400,
      );
      if (reMint) {
        newTickLower = reMint.tickLower;
        newTickUpper = reMint.tickUpper;
        const nRawLower = tickToPrice(reMint.tickLower, opts.token0Decimals, opts.token1Decimals);
        const nRawUpper = tickToPrice(reMint.tickUpper, opts.token0Decimals, opts.token1Decimals);
        newPriceLower = Math.min(nRawLower, nRawUpper);
        newPriceUpper = Math.max(nRawLower, nRawUpper);
      }
    }

    records.push({
      id: `${rangeKey(lc.tickLower, lc.tickUpper)}-${lc.openedAt}-${i}`,
      tickLower: lc.tickLower,
      tickUpper: lc.tickUpper,
      priceLower,
      priceUpper,
      widthPct,
      openedAt: lc.openedAt,
      closedAt: lc.closedAt,
      rebalancedAt,
      outOfRangeAt,
      outSide,
      outPrice,
      timeToRebalanceSec,
      ongoing,
      partial,
      closedInRange,
      isHold,
      newTickLower,
      newTickUpper,
      newPriceLower,
      newPriceUpper,
      liquidity: Number(lc.liquidity),
      tokenId: lc.tokenId,
    });
  }

  // Most recent rebalance first (fall back to drift time, then open time).
  const sortKey = (r: RebalanceRecord) => r.rebalancedAt ?? r.outOfRangeAt ?? r.closedAt ?? r.openedAt;
  records.sort((a, b) => sortKey(b) - sortKey(a));

  // A "rebalance" is an action the LP took (close or trim); holds and still-open
  // out-of-range positions are not counted as completed rebalances.
  const rebalanceCount = records.filter((r) => !r.ongoing && !r.isHold).length;
  const oorTimes = records
    .filter((r) => !r.ongoing && !r.isHold && r.timeToRebalanceSec != null)
    .map((r) => r.timeToRebalanceSec as number);
  const widths = records.map((r) => r.widthPct).filter(Number.isFinite);
  const summary: RebalanceSummary = {
    count: rebalanceCount,
    ongoingCount: records.filter((r) => r.ongoing).length,
    holdCount: records.filter((r) => r.isHold).length,
    medianTimeToRebalanceSec: median(oorTimes),
    avgWidthPct: widths.length > 0 ? widths.reduce((s, w) => s + w, 0) / widths.length : null,
  };

  return { records, summary };
}
