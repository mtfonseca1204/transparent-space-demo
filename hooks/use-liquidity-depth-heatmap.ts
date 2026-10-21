"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  sqrtPriceX96ToPrice,
  type CandleData,
  type LPEventData,
  type PositionData,
} from "@/lib/envio-client";
import { normalizePoolKey } from "@/lib/pools";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";
import { reconstructAllLifecycles, reconstructLiquiditySegments } from "@/lib/lp-rebalances";
import {
  valueColumn,
  cellOwnerBreakdown,
  type DepthBand,
  type DepthValueParams,
} from "@/lib/liquidity-depth-bars";
import type { HeatmapPriceMode, HeatmapDepthMode } from "@/stores/chart-settings-store";

const DAY = 86400;
const INTEGER_STRING_RE = /^-?\d+$/;
const LN_1_0001 = Math.log(1.0001);
// Tick deltas for ±N% price moves (ln(1+p)/ln(1.0001)).
const TICKS_12PCT = Math.round(Math.log(1.12) / LN_1_0001);
const TICKS_15PCT = Math.round(Math.log(1.15) / LN_1_0001);
const TICKS_25PCT = Math.round(Math.log(1.25) / LN_1_0001);

const CANDLE_INTERVALS = [300, 900, 3600, 14400, 86400]; // 5m, 15m, 1h, 4h, 1d
const CANDLE_ROW_BUDGET = 9000;

function pickCandleInterval(windowSec: number): number {
  for (const iv of CANDLE_INTERVALS) {
    if (windowSec / iv <= CANDLE_ROW_BUDGET) return iv;
  }
  return CANDLE_INTERVALS[CANDLE_INTERVALS.length - 1];
}

/** Candle close (sqrtPriceX96 integer string on EVM, else human price) → raw token1/token0. */
function candleCloseToRawPrice(value: string | number | null | undefined, d0: number, d1: number): number {
  const raw = String(value ?? "0").trim();
  if (INTEGER_STRING_RE.test(raw)) return sqrtPriceX96ToPrice(BigInt(raw), d0, d1);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Raw token1/token0 price → Uniswap tick (inverse of tickToPrice). */
function rawPriceToTick(price: number, d0: number, d1: number): number {
  const decAdj = Math.pow(10, d0 - d1);
  if (!(price > 0)) return 0;
  return Math.round(Math.log(price / decAdj) / LN_1_0001);
}

export interface DepthHeatmap {
  mode: HeatmapPriceMode;
  windowDays: number;
  tMin: number;
  tMax: number;
  /** Bucket-center timestamps, length T. */
  times: number[];
  T: number;
  P: number;
  /** Tick width of each price row. */
  step: number;
  /** Liquidity value per cell, row-major [c*P + j]; j=0 is the lowest price. */
  cells: Float64Array;
  /** Fractional row index (0..P) of the pool price in each column, length T. */
  priceLineRow: Float32Array;
  /** Pool price tick used per column (for the token split + cell drill-down), length T. */
  colPriceTick: Float64Array;
  /** Mid tick of each row, length P. Absolute (fixed) or offset-from-spot (sliding). */
  rowTickMid: number[];
  /** True when rows are offsets from spot (sliding mode) rather than absolute ticks. */
  rowIsOffset: boolean;
  /** Lowest tick edge of row 0 for each column, length T (varies in sliding mode). */
  colBinLo0: Float64Array;
  maxCell: number;
  p95: number;
  p99: number;
  valueIsUsd: boolean;
  /** Total liquidity value visible in the most recent column. */
  lastColTotal: number;
  ownerCount: number;
  bandCount: number;
}

export interface UseLiquidityDepthHeatmapArgs {
  poolAddress: string;
  /** All-time LP lifecycle events (e.g. dashboard's `lpLifecycleRawEvents`). */
  rawEvents: LPEventData[] | undefined;
  /** Authoritative current positions (all owners) to union with reconstructed lifecycles. */
  allPositions: PositionData[] | undefined;
  token0Decimals: number;
  token1Decimals: number;
  currentTick: number;
  currentPrice: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  tickSpacing: number;
  windowDays: number;
  priceMode: HeatmapPriceMode;
  /** "precise" replays signed deltas (instant L); "peak" uses peak L per lifecycle. */
  depthMode: HeatmapDepthMode;
  /** Owner subset to show (lowercased). Empty = all owners. */
  selectedOwners: string[];
  includeInactive: boolean;
  /** Target X/Y resolution, derived from the canvas size. */
  targetColumns: number;
  targetRows: number;
  spaceSlug?: string | null;
  enabled?: boolean;
}

export interface CellOwnerContribution {
  owner: string;
  value: number;
}

export interface UseLiquidityDepthHeatmapResult {
  heatmap: DepthHeatmap | null;
  isLoading: boolean;
  /** Per-owner contributions to a single (column, row) cell, sorted desc. */
  cellBreakdown: (col: number, row: number) => CellOwnerContribution[];
}

/**
 * Builds the time × price liquidity-depth matrix for the historical depth
 * heatmap, reusing the position-lifecycle reconstruction and the shared v3
 * amount math. Liquidity is PEAK per lifecycle (the same approximation the
 * replay uses); USD valuation applies current token USD prices historically.
 */
export function useLiquidityDepthHeatmap(args: UseLiquidityDepthHeatmapArgs): UseLiquidityDepthHeatmapResult {
  const {
    poolAddress,
    rawEvents,
    allPositions,
    token0Decimals,
    token1Decimals,
    currentTick,
    currentPrice,
    token0UsdPrice,
    token1UsdPrice,
    tickSpacing,
    windowDays,
    priceMode,
    depthMode,
    selectedOwners,
    includeInactive,
    targetColumns,
    targetRows,
    spaceSlug,
    enabled = true,
  } = args;

  const poolKey = poolAddress ? normalizePoolKey(poolAddress) : "";
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const windowSec = windowDays * DAY;
  const windowStart = roundedNow - windowSec;
  const candleInterval = pickCandleInterval(windowSec);

  // Price candles over the heatmap window (own query key; shares cache by params).
  const candlesEnabled = enabled && !!poolKey;
  const { data: candlesData, isLoading: candlesLoading } = useQuery({
    queryKey: ["depth-heatmap-candles", poolKey, windowStart, candleInterval, spaceSlug ?? null],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolKey,
        interval: String(candleInterval),
        startTime: String(windowStart),
        endTime: String(roundedNow),
      });
      if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch candles: ${res.status}`);
      return (await res.json()) as CandleData[];
    },
    enabled: candlesEnabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData,
  });

  // Pool tick over time, for the price-line overlay and the token0/token1 split.
  const priceSeries = useMemo<Array<{ t: number; tick: number }>>(() => {
    const out: Array<{ t: number; tick: number }> = [];
    for (const c of candlesData ?? []) {
      const p = candleCloseToRawPrice(c.closePrice, token0Decimals, token1Decimals);
      if (!(p > 0) || !Number.isFinite(c.timestamp)) continue;
      out.push({ t: c.timestamp, tick: rawPriceToTick(p, token0Decimals, token1Decimals) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [candlesData, token0Decimals, token1Decimals]);

  // All position bands (every owner), reconstructed from events and unioned with
  // the authoritative snapshot so router/NFT-manager mints still render.
  const allBands = useMemo<DepthBand[]>(() => {
    const out: DepthBand[] = [];
    if (rawEvents && rawEvents.length > 0) {
      const openKeys = new Set<string>();
      if (depthMode === "precise") {
        // Instant liquidity: signed-delta segments (L varies within a position's life).
        const segments = reconstructLiquiditySegments(rawEvents, { token0Decimals, token1Decimals }, roundedNow);
        for (const s of segments) {
          if (!(s.L > 0)) continue;
          if (!s.closed) openKeys.add(`${s.owner}:${s.tickLower}:${s.tickUpper}`);
          out.push({
            tickLower: s.tickLower,
            tickUpper: s.tickUpper,
            L: s.L,
            openedAt: s.openedAt,
            end: s.end,
            owner: s.owner,
            closed: s.closed,
          });
        }
      } else {
        // Peak liquidity: one constant scalar per lifecycle.
        const lifecycles = reconstructAllLifecycles(rawEvents, { token0Decimals, token1Decimals });
        for (const lc of lifecycles) {
          if (!(lc.liquidity > 0)) continue;
          const closed = lc.closedAt !== null;
          if (!closed) openKeys.add(`${lc.owner}:${lc.tickLower}:${lc.tickUpper}`);
          out.push({
            tickLower: lc.tickLower,
            tickUpper: lc.tickUpper,
            L: lc.liquidity,
            openedAt: lc.openedAt,
            end: lc.closedAt ?? roundedNow,
            owner: lc.owner,
            closed,
          });
        }
      }
      const fallbackOpen = windowStart;
      for (const p of allPositions ?? []) {
        const owner = p.owner.toLowerCase();
        const tl = Number(p.tickLower);
        const tu = Number(p.tickUpper);
        const L = Number(p.liquidity);
        if (!Number.isFinite(tl) || !Number.isFinite(tu) || tl >= tu || !(L > 0)) continue;
        const key = `${owner}:${tl}:${tu}`;
        if (openKeys.has(key)) continue;
        openKeys.add(key);
        const opened =
          Number.isFinite(p.updatedAt) && p.updatedAt > 0 ? Math.min(p.updatedAt, roundedNow) : fallbackOpen;
        out.push({ tickLower: tl, tickUpper: tu, L, openedAt: opened, end: roundedNow, owner, closed: false });
      }
    } else {
      // No events (e.g. attribution-less pool): fall back to the snapshot only.
      for (const p of allPositions ?? []) {
        const owner = p.owner.toLowerCase();
        const tl = Number(p.tickLower);
        const tu = Number(p.tickUpper);
        const L = Number(p.liquidity);
        if (!Number.isFinite(tl) || !Number.isFinite(tu) || tl >= tu || !(L > 0)) continue;
        out.push({ tickLower: tl, tickUpper: tu, L, openedAt: windowStart, end: roundedNow, owner, closed: false });
      }
    }
    return out;
  }, [rawEvents, allPositions, token0Decimals, token1Decimals, roundedNow, windowStart, depthMode]);

  const selectedKey = useMemo(
    () => [...selectedOwners].map((o) => o.toLowerCase()).sort().join(","),
    [selectedOwners],
  );

  const filteredBands = useMemo<DepthBand[]>(() => {
    const sel = selectedKey ? new Set(selectedKey.split(",")) : null;
    return allBands.filter((b) => {
      if (!includeInactive && b.closed) return false;
      if (sel && sel.size > 0 && !sel.has(b.owner ?? "")) return false;
      return true;
    });
  }, [allBands, includeInactive, selectedKey]);

  const valueParams = useMemo<DepthValueParams>(() => {
    const p = currentPrice;
    const t0 =
      typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice)
        ? token0UsdPrice
        : typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && p > 0
          ? token1UsdPrice * p
          : null;
    const t1 =
      typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice)
        ? token1UsdPrice
        : typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && p > 0
          ? token0UsdPrice / p
          : null;
    return {
      token0Decimals,
      token1Decimals,
      valueIsUsd: t0 !== null && t1 !== null,
      t0Usd: t0,
      t1Usd: t1,
      fallbackPrice: currentPrice,
    };
  }, [token0UsdPrice, token1UsdPrice, currentPrice, token0Decimals, token1Decimals]);

  const heatmap = useMemo<DepthHeatmap | null>(() => {
    if (filteredBands.length === 0) return null;

    const spacing = Math.max(1, Math.floor(tickSpacing) || 1);
    const tMax = roundedNow;
    // Stable X start: pool inception within the window (over ALL bands, so the
    // axis doesn't jump when toggling addresses).
    let earliestAll = Infinity;
    for (const b of allBands) if (b.openedAt < earliestAll) earliestAll = b.openedAt;
    const tMin = Math.max(windowStart, Number.isFinite(earliestAll) ? earliestAll : windowStart);
    if (!(tMax > tMin)) return null;

    const T = Math.max(40, Math.min(420, Math.round(targetColumns)));
    const rows = Math.max(40, Math.min(240, Math.round(targetRows)));
    const dt = (tMax - tMin) / T;
    const times = new Array<number>(T);
    for (let c = 0; c < T; c++) times[c] = tMin + (c + 0.5) * dt;

    // Pool tick at a timestamp (step-interpolated from the candle series).
    const ps = priceSeries;
    const tickAt = (tt: number): number => {
      if (ps.length === 0) return currentTick;
      if (tt <= ps[0].t) return ps[0].tick;
      if (tt >= ps[ps.length - 1].t) return ps[ps.length - 1].tick;
      let lo = 0;
      let hi = ps.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ps[mid].t <= tt) lo = mid;
        else hi = mid - 1;
      }
      return ps[lo].tick;
    };

    // Price (tick) extent over the window — focus Y near where price traded.
    let minPt = Infinity;
    let maxPt = -Infinity;
    for (const s of ps) {
      if (s.t < tMin || s.t > tMax) continue;
      if (s.tick < minPt) minPt = s.tick;
      if (s.tick > maxPt) maxPt = s.tick;
    }
    if (!Number.isFinite(minPt) || !Number.isFinite(maxPt)) {
      minPt = currentTick;
      maxPt = currentTick;
    }
    minPt = Math.min(minPt, currentTick);
    maxPt = Math.max(maxPt, currentTick);

    // Y span (tick offsets in sliding mode, absolute ticks in fixed mode).
    const alignDown = (tk: number) => Math.floor(tk / spacing) * spacing;
    let spanLo: number;
    let spanHi: number;
    const rowIsOffset = priceMode === "sliding";
    if (rowIsOffset) {
      const half = Math.max(TICKS_15PCT, Math.round((maxPt - minPt) / 2) + TICKS_12PCT);
      spanLo = alignDown(-half);
      spanHi = alignDown(half) + spacing;
    } else {
      const pad = Math.max(Math.round((maxPt - minPt) * 0.6), TICKS_12PCT);
      let lo = minPt - pad;
      let hi = maxPt + pad;
      if (hi - lo < TICKS_25PCT) {
        const center = Math.round((lo + hi) / 2);
        lo = center - Math.round(TICKS_25PCT / 2);
        hi = center + Math.round(TICKS_25PCT / 2);
      }
      spanLo = alignDown(lo);
      spanHi = alignDown(hi) + spacing;
    }
    const span = Math.max(spacing, spanHi - spanLo);
    const step = Math.max(spacing, Math.round(span / rows / spacing) * spacing);
    const P = Math.max(1, Math.ceil(span / step));

    const rowTickMid = new Array<number>(P);
    for (let j = 0; j < P; j++) rowTickMid[j] = spanLo + (j + 0.5) * step;

    const cells = new Float64Array(T * P);
    const priceLineRow = new Float32Array(T);
    const colBinLo0 = new Float64Array(T);
    const colPriceTick = new Float64Array(T);

    // Per-column active-band filter then band-centric fill.
    for (let c = 0; c < T; c++) {
      const t = times[c];
      const priceTick = tickAt(t);
      const binLo0 = rowIsOffset ? priceTick + spanLo : spanLo;
      colBinLo0[c] = binLo0;
      colPriceTick[c] = priceTick;
      priceLineRow[c] = (priceTick - binLo0) / step;

      const active: DepthBand[] = [];
      for (const b of filteredBands) {
        if (b.openedAt <= t && t < b.end) active.push(b);
      }
      if (active.length === 0) continue;
      const col = valueColumn(active, binLo0, step, P, priceTick, valueParams);
      cells.set(col, c * P);
    }

    // Normalization stats over non-zero cells.
    let maxCell = 0;
    const nz: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v > 0) {
        nz.push(v);
        if (v > maxCell) maxCell = v;
      }
    }
    nz.sort((a, b) => a - b);
    const pct = (q: number) => (nz.length === 0 ? 0 : nz[Math.min(nz.length - 1, Math.floor(q * nz.length))]);
    const p95 = pct(0.95);
    const p99 = pct(0.99);

    let lastColTotal = 0;
    for (let j = 0; j < P; j++) lastColTotal += cells[(T - 1) * P + j];

    const owners = new Set<string>();
    for (const b of filteredBands) owners.add(b.owner ?? "");

    return {
      mode: priceMode,
      windowDays,
      tMin,
      tMax,
      times,
      T,
      P,
      step,
      cells,
      priceLineRow,
      colPriceTick,
      rowTickMid,
      rowIsOffset,
      colBinLo0,
      maxCell,
      p95,
      p99,
      valueIsUsd: valueParams.valueIsUsd,
      lastColTotal,
      ownerCount: owners.size,
      bandCount: filteredBands.length,
    };
  }, [
    filteredBands,
    allBands,
    priceSeries,
    priceMode,
    windowDays,
    tickSpacing,
    targetColumns,
    targetRows,
    currentTick,
    valueParams,
    roundedNow,
    windowStart,
  ]);

  // Per-cell owner attribution drill-down (computed on demand for one cell).
  const cellBreakdown = useCallback(
    (col: number, row: number): CellOwnerContribution[] => {
      if (!heatmap) return [];
      const { T, P, times, colBinLo0, colPriceTick, step } = heatmap;
      if (col < 0 || col >= T || row < 0 || row >= P) return [];
      const cellLo = colBinLo0[col] + row * step;
      return cellOwnerBreakdown(filteredBands, times[col], cellLo, cellLo + step, colPriceTick[col], valueParams);
    },
    [heatmap, filteredBands, valueParams],
  );

  return { heatmap, isLoading: candlesLoading, cellBreakdown };
}
