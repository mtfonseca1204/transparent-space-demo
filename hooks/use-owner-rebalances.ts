"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { sqrtPriceX96ToPrice, tickToPrice, type CandleData, type PositionData } from "@/lib/envio-client";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";
import { normalizePoolKey } from "@/lib/pools";
import { useLPEntryExitData } from "@/hooks/use-pool-metrics";
import {
  computeRebalances,
  reconstructAllLifecycles,
  type RebalanceCandle,
  type RebalanceRecord,
  type RebalanceSummary,
} from "@/lib/lp-rebalances";

/** Minimal position shape for the distribution replay (range + active window). */
export interface ReplayPosition {
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
  openedAt: number;
  closedAt: number | null;
  liquidity: number;
}

const INTEGER_STRING_RE = /^-?\d+$/;
const DAY = 86400;

// All-time-ish lookback for events. useLPEntryExitData paginates server-side, so
// the full window is returned regardless of interval.
const DEFAULT_LOOKBACK_DAYS = 365;

// Candle resolution is chosen adaptively: pick the FINEST interval whose row
// count over the activity window stays under the candle route's safety cap
// (~10k). Scoping candles to the LP-activity span (not the full 365d) lets young
// pools use 5-minute candles for near-exact out-of-range timing.
const CANDLE_INTERVALS = [300, 900, 3600, 14400, 86400]; // 5m, 15m, 1h, 4h, 1d
const CANDLE_ROW_BUDGET = 9000;

function pickCandleInterval(windowSec: number): number {
  for (const iv of CANDLE_INTERVALS) {
    if (windowSec / iv <= CANDLE_ROW_BUDGET) return iv;
  }
  return CANDLE_INTERVALS[CANDLE_INTERVALS.length - 1];
}

/** Convert a candle close (sqrtPriceX96 integer string on EVM) to a raw
 *  token1/token0 price, matching `tickToPrice(tick, d0, d1)` orientation. */
function candleCloseToRawPrice(
  value: string | number | null | undefined,
  d0: number,
  d1: number,
): number {
  const raw = String(value ?? "0").trim();
  if (INTEGER_STRING_RE.test(raw)) return sqrtPriceX96ToPrice(BigInt(raw), d0, d1);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export interface UseOwnerRebalancesArgs {
  poolAddress: string;
  owner: string | null;
  token0Decimals?: number;
  token1Decimals?: number;
  /** Current pool tick — used to tell whether an open position is OOR right now. */
  currentTick?: number;
  /** The owner's actual current open positions, to prune stale phantom positions. */
  currentPositions?: Array<{ tickLower: number; tickUpper: number }>;
  /** Every current open position in the pool (authoritative `positions` entity).
   *  Used to render LPs whose mints aren't owner-attributed in `lpevents` (e.g.
   *  router/NFT-manager mints) in the rest-of-pool replay layer. */
  allPositions?: PositionData[];
  lookbackDays?: number;
  enabled?: boolean;
  spaceSlug?: string | null;
}

export interface UseOwnerRebalancesResult {
  records: RebalanceRecord[];
  summary: RebalanceSummary;
  /** Every OTHER owner's position lifecycles, for the rest-of-pool replay. */
  otherPositions: ReplayPosition[];
  /** Pool tick over time (from candles), so the replay marker tracks price. */
  priceSeries: Array<{ t: number; tick: number }>;
  nowSec: number;
  isLoading: boolean;
}

/**
 * Reconstructs a single LP's historical rebalances over an all-time window,
 * independent of the dashboard's time-range selector. Events come from
 * `useLPEntryExitData` (which routes correctly per pool — Railway REST for the
 * shared indexer pools like 0G/BSC/Worldchain, Envio GraphQL otherwise, and
 * paginates server-side); price candles come from `/api/candles`.
 */
export function useOwnerRebalances(args: UseOwnerRebalancesArgs): UseOwnerRebalancesResult {
  const {
    poolAddress,
    owner,
    token0Decimals,
    token1Decimals,
    currentTick,
    currentPositions,
    allPositions,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    enabled = true,
    spaceSlug,
  } = args;

  const poolKey = poolAddress ? normalizePoolKey(poolAddress) : "";
  const active =
    enabled &&
    !!poolKey &&
    !!owner &&
    token0Decimals != null &&
    token1Decimals != null &&
    currentTick != null;

  // Stable hourly boundaries for cache friendliness.
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const ownerLc = owner ? owner.toLowerCase() : "";

  // Events first — routes per pool type and paginates server-side, so the full
  // window is returned.
  const { rawEvents, isLoading: eventsLoading } = useLPEntryExitData(poolKey, lookbackDays, active);

  // Scope candles to the pool's actual activity span and pick the finest
  // interval that fits under the row cap. A young pool gets 5-minute candles;
  // a year-long active pool falls back to hourly.
  const { candleStart, candleInterval } = useMemo(() => {
    const fullStart = roundedNow - lookbackDays * DAY;
    let earliest = Infinity;
    for (const e of rawEvents ?? []) {
      if (e.timestamp < earliest) earliest = e.timestamp;
    }
    // Pad a little before the first event for in-range context; clamp to window.
    const start = Number.isFinite(earliest)
      ? Math.max(fullStart, Math.floor((earliest - DAY) / 3600) * 3600)
      : fullStart;
    return { candleStart: start, candleInterval: pickCandleInterval(roundedNow - start) };
  }, [rawEvents, roundedNow, lookbackDays]);

  const candlesReady = active && !!rawEvents && rawEvents.length > 0;

  const { data: candlesData, isLoading: candlesLoading } = useQuery({
    queryKey: ["owner-rebalance-candles", poolKey, candleStart, candleInterval, spaceSlug ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolKey,
        interval: String(candleInterval),
        startTime: String(candleStart),
        endTime: String(roundedNow),
      });
      if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch candles: ${res.status}`);
      return (await res.json()) as CandleData[];
    },
    enabled: candlesReady,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  const result = useMemo((): { records: RebalanceRecord[]; summary: RebalanceSummary } => {
    const empty = {
      records: [] as RebalanceRecord[],
      summary: { count: 0, ongoingCount: 0, holdCount: 0, medianTimeToRebalanceSec: null, avgWidthPct: null },
    };
    if (!active || token0Decimals == null || token1Decimals == null || currentTick == null) {
      return empty;
    }

    const ownerEvents = (rawEvents ?? []).filter((e) => e.owner.toLowerCase() === ownerLc);
    if (ownerEvents.length === 0) return empty;

    const candles: RebalanceCandle[] = (candlesData ?? [])
      .map((c) => {
        const close = candleCloseToRawPrice(c.closePrice, token0Decimals, token1Decimals);
        // highPrice/lowPrice are sqrtPriceX96 extremes; ignore missing/zero values
        // (they convert to 0) so we don't fabricate a spurious out-of-range touch.
        const a = candleCloseToRawPrice(c.highPrice, token0Decimals, token1Decimals);
        const b = candleCloseToRawPrice(c.lowPrice, token0Decimals, token1Decimals);
        const valid = [close, a, b].filter((v) => Number.isFinite(v) && v > 0);
        const high = valid.length ? Math.max(...valid) : close;
        const low = valid.length ? Math.min(...valid) : close;
        return { t: c.timestamp, close, high, low };
      })
      .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.close) && c.close > 0);

    return computeRebalances(ownerEvents, candles, {
      token0Decimals,
      token1Decimals,
      currentTick,
      nowSec: roundedNow,
      currentPositions,
    });
  }, [active, rawEvents, candlesData, ownerLc, token0Decimals, token1Decimals, currentTick, roundedNow, currentPositions]);

  // Other owners' position lifecycles (for the rest-of-pool replay distribution).
  // Reconstructed from events, then UNIONED with the authoritative `positions`
  // snapshot so LPs whose mints aren't owner-attributed in `lpevents` (e.g.
  // router / NFT-manager mints, like 0G `0x6927…`) still render. A snapshot
  // position is added only when no OPEN reconstructed lifecycle already covers
  // its owner+range (so we don't double-count); its open time falls back to the
  // position's `updatedAt` (≈ mint time for a passive holder), or the lookback
  // start if unknown, so it stays visible across the replay.
  const otherPositions = useMemo<ReplayPosition[]>(() => {
    if (!active || token0Decimals == null || token1Decimals == null) return [];

    const lifecycles =
      rawEvents && rawEvents.length > 0
        ? reconstructAllLifecycles(rawEvents, { token0Decimals, token1Decimals })
        : [];

    const out: ReplayPosition[] = [];
    const openKeys = new Set<string>();
    for (const lc of lifecycles) {
      if (lc.owner === ownerLc || lc.liquidity <= 0) continue;
      if (lc.closedAt === null) openKeys.add(`${lc.owner}:${lc.tickLower}:${lc.tickUpper}`);
      out.push({
        tickLower: lc.tickLower,
        tickUpper: lc.tickUpper,
        priceLower: lc.priceLower,
        priceUpper: lc.priceUpper,
        openedAt: lc.openedAt,
        closedAt: lc.closedAt,
        liquidity: lc.liquidity,
      });
    }

    const fallbackOpen = roundedNow - lookbackDays * DAY;
    for (const p of allPositions ?? []) {
      const pOwner = p.owner.toLowerCase();
      if (pOwner === ownerLc) continue;
      const tickLower = Number(p.tickLower);
      const tickUpper = Number(p.tickUpper);
      const liquidity = Number(p.liquidity);
      if (
        !Number.isFinite(tickLower) ||
        !Number.isFinite(tickUpper) ||
        tickLower >= tickUpper ||
        !(liquidity > 0)
      ) {
        continue;
      }
      const key = `${pOwner}:${tickLower}:${tickUpper}`;
      if (openKeys.has(key)) continue; // already represented by an open lifecycle
      openKeys.add(key);
      const a = tickToPrice(tickLower, token0Decimals, token1Decimals);
      const b = tickToPrice(tickUpper, token0Decimals, token1Decimals);
      const opened =
        Number.isFinite(p.updatedAt) && p.updatedAt > 0
          ? Math.min(p.updatedAt, roundedNow)
          : fallbackOpen;
      out.push({
        tickLower,
        tickUpper,
        priceLower: Math.min(a, b),
        priceUpper: Math.max(a, b),
        openedAt: opened,
        closedAt: null,
        liquidity,
      });
    }
    return out;
  }, [active, rawEvents, allPositions, ownerLc, token0Decimals, token1Decimals, roundedNow, lookbackDays]);

  // Pool tick over time, from candle closes — lets the replay marker (and the
  // token0/token1 split in its valuation) track the price at each timestamp.
  const priceSeries = useMemo<Array<{ t: number; tick: number }>>(() => {
    if (token0Decimals == null || token1Decimals == null) return [];
    const ln10001 = Math.log(1.0001);
    const decAdj = Math.pow(10, token0Decimals - token1Decimals);
    const out: Array<{ t: number; tick: number }> = [];
    for (const c of candlesData ?? []) {
      const p = candleCloseToRawPrice(c.closePrice, token0Decimals, token1Decimals);
      if (!(p > 0) || !Number.isFinite(c.timestamp)) continue;
      // Invert tickToPrice: price = 1.0001^tick · 10^(d0-d1).
      out.push({ t: c.timestamp, tick: Math.round(Math.log(p / decAdj) / ln10001) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [candlesData, token0Decimals, token1Decimals]);

  return { ...result, otherPositions, priceSeries, nowSec: roundedNow, isLoading: candlesLoading || eventsLoading };
}
