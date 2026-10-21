"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  useChartSettingsStore,
  type HeatmapColorScale,
  type HeatmapDepthMode,
  type HeatmapPriceMode,
  type HeatmapWindowDays,
} from "@/stores/chart-settings-store";
import { useLiquidityDepth } from "@/hooks/use-liquidity-depth";
import {
  useLiquidityDepthHeatmap,
  type CellOwnerContribution as LegacyCellOwnerContribution,
  type DepthHeatmap as LegacyDepthHeatmap,
} from "@/hooks/use-liquidity-depth-heatmap";
import { tickToPrice, type LPEventData, type PositionData } from "@/lib/envio-client";
import type { LiquidityDepthOwnerBand, LiquidityDepthPayload } from "@/lib/liquidity-depth";

// Layout constants copied from Pedro's canvas renderer.
const LEFT = 54;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 26;

const WINDOW_OPTIONS: HeatmapWindowDays[] = [7, 30, 90, 365];
const RAYDIUM_HUMAN_PRICE_SCALE = 100;

export interface AddressOption {
  owner: string;
  valueUsd: number | null;
}

export interface ClosedAddressOption {
  owner: string;
  closedCount: number;
  lastClosedAt: number;
}

interface HistoricalLiquidityDepthHeatmapProps {
  poolAddress: string;
  token0Symbol?: string;
  token1Symbol?: string;
  invertPrice?: boolean;
  spaceSlug?: string | null;
  activeOwners?: AddressOption[];
  closedOwners?: ClosedAddressOption[];
  rawEvents?: LPEventData[];
  allPositions?: PositionData[];
  token0Decimals?: number;
  token1Decimals?: number;
  currentTick?: number;
  currentPrice?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  tickSpacing?: number;
  useMaterializedDepth?: boolean;
  enabled?: boolean;
  className?: string;
}

interface DepthHeatmap {
  mode: HeatmapPriceMode;
  windowDays: number;
  times: number[];
  T: number;
  P: number;
  cells: Float64Array;
  priceLineRow: Float32Array;
  rowPrice: number[];
  rowOffsetPct: number[] | null;
  rowIsOffset: boolean;
  colCenterPrice: number[];
  maxCell: number;
  p95: number;
  p99: number;
  valueIsUsd: boolean;
  lastColTotal: number;
  ownerCount: number;
  bandCount: number;
}

interface CellOwnerContribution {
  owner: string;
  value: number;
}

interface Stop {
  at: number;
  c: [number, number, number];
  a: number;
}

const LIGHT_STOPS: Stop[] = [
  { at: 0.0, c: [239, 246, 255], a: 0.0 },
  { at: 0.08, c: [191, 219, 254], a: 0.55 },
  { at: 0.3, c: [96, 165, 250], a: 0.85 },
  { at: 0.52, c: [99, 102, 241], a: 0.92 },
  { at: 0.72, c: [168, 85, 247], a: 0.95 },
  { at: 0.88, c: [225, 29, 72], a: 0.97 },
  { at: 1.0, c: [127, 29, 29], a: 1.0 },
];

const DARK_STOPS: Stop[] = [
  { at: 0.0, c: [20, 30, 60], a: 0.0 },
  { at: 0.1, c: [30, 64, 175], a: 0.5 },
  { at: 0.3, c: [14, 165, 233], a: 0.8 },
  { at: 0.5, c: [16, 185, 129], a: 0.88 },
  { at: 0.7, c: [250, 204, 21], a: 0.95 },
  { at: 0.88, c: [249, 115, 22], a: 0.98 },
  { at: 1.0, c: [255, 255, 255], a: 1.0 },
];

function buildLut(stops: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].at) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const span = Math.max(1e-6, b.at - a.at);
    const f = Math.min(1, Math.max(0, (t - a.at) / span));
    lut[i * 4] = Math.round(a.c[0] + (b.c[0] - a.c[0]) * f);
    lut[i * 4 + 1] = Math.round(a.c[1] + (b.c[1] - a.c[1]) * f);
    lut[i * 4 + 2] = Math.round(a.c[2] + (b.c[2] - a.c[2]) * f);
    lut[i * 4 + 3] = Math.round((a.a + (b.a - a.a) * f) * 255);
  }
  return lut;
}

function legendGradientCss(stops: Stop[]): string {
  const parts = stops.map((s) => `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${s.a}) ${Math.round(s.at * 100)}%`);
  return `linear-gradient(to top, ${parts.join(", ")})`;
}

function colorLuminance(color: string): number {
  const s = color.trim();
  let r = 255;
  let g = 255;
  let b = 255;
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const hex = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (s.startsWith("rgb")) {
    const m = s.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      r = Number(m[0]);
      g = Number(m[1]);
      b = Number(m[2]);
    }
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function normalize(v: number, hm: DepthHeatmap, scale: HeatmapColorScale): number {
  if (!(v > 0)) return -1;
  if (scale === "log") {
    return hm.maxCell > 0 ? Math.log1p(v) / Math.log1p(hm.maxCell) : 0;
  }
  const clampMax = hm.p99 > 0 ? hm.p99 : hm.maxCell;
  return clampMax > 0 ? Math.min(1, v / clampMax) : 0;
}

function fmtUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDepth(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v >= 1e15) return `${(v / 1e15).toFixed(1)}Q`;
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function fmtValue(v: number, valueIsUsd: boolean): string {
  return valueIsUsd ? fmtUsd(v) : fmtDepth(v);
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "-";
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toExponential(2);
}

function fmtPct(p: number): string {
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(p >= 10 || p <= -10 ? 0 : 1)}%`;
}

function fmtTime(ts: number, windowDays: number): string {
  const d = new Date(ts * 1000);
  const mo = d.toLocaleString("en-US", { month: "short" });
  if (windowDays <= 3) return `${mo} ${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
  return `${mo} ${d.getDate()}`;
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

function withPeakDepth(values: number[][]): number[][] {
  const running: number[] = [];
  return values.map((row) =>
    row.map((value, index) => {
      const next = Math.max(running[index] ?? 0, Number.isFinite(value) ? value : 0);
      running[index] = next;
      return next;
    }),
  );
}

function normalizePayloadPriceSide(payload: LiquidityDepthPayload, invertPrice: boolean) {
  const rows = payload.values;
  if (!invertPrice) {
    return {
      priceBins: payload.priceBins,
      values: rows,
      priceLine: payload.priceLine,
    };
  }

  const entries = payload.priceBins
    .map((price, index) => ({ price: price > 0 ? 1 / price : NaN, index }))
    .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
    .sort((a, b) => a.price - b.price);

  return {
    priceBins: entries.map((entry) => entry.price),
    values: rows.map((row) => entries.map((entry) => row[entry.index] ?? 0)),
    priceLine: payload.priceLine.map((price) => (price && price > 0 ? 1 / price : null)),
  };
}

function nearestSample(priceBins: number[], row: number[], price: number): number {
  const index = nearestPriceBinIndex(priceBins, price);
  return index === null ? 0 : row[index] ?? 0;
}

function nearestPriceBinIndex(priceBins: number[], price: number): number | null {
  if (!Number.isFinite(price) || priceBins.length === 0) return null;
  if (price < priceBins[0] || price > priceBins[priceBins.length - 1]) return null;
  let lo = 0;
  let hi = priceBins.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (priceBins[mid] < price) lo = mid + 1;
    else hi = mid;
  }
  const prev = Math.max(0, lo - 1);
  return Math.abs(priceBins[prev] - price) <= Math.abs(priceBins[lo] - price) ? prev : lo;
}

function priceToRaydiumTick(price: number, token0Decimals = 8, token1Decimals = 6): number {
  const scale = Math.pow(10, token0Decimals - token1Decimals);
  const normalized = Number(price) / scale;
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return Math.round(Math.log(normalized) / Math.log(1.0001));
}

function raydiumTickToPrice(tick: number, token0Decimals = 8, token1Decimals = 6): number {
  return Math.pow(1.0001, Number(tick)) * Math.pow(10, token0Decimals - token1Decimals);
}

function buildBinTickEdges(binTicks: number[]): number[] {
  if (binTicks.length === 0) return [];
  if (binTicks.length === 1) {
    const center = Number(binTicks[0]) || 0;
    return [center - 1, center + 1];
  }
  const edges = new Array<number>(binTicks.length + 1);
  for (let i = 1; i < binTicks.length; i++) edges[i] = Math.floor((binTicks[i - 1] + binTicks[i]) / 2);
  const firstGap = Math.max(1, Math.abs(edges[1] - binTicks[0]));
  const lastGap = Math.max(1, Math.abs(binTicks[binTicks.length - 1] - edges[binTicks.length - 1]));
  edges[0] = binTicks[0] - firstGap;
  edges[binTicks.length] = binTicks[binTicks.length - 1] + lastGap;
  for (let i = 1; i < edges.length; i++) {
    if (!(edges[i] > edges[i - 1])) edges[i] = edges[i - 1] + 1;
  }
  return edges;
}

function tickToSqrtPriceForDepth(tick: number): number {
  return Math.pow(1.0001, Number(tick) / 2);
}

function valueBandsForCellUsd(
  bands: LiquidityDepthOwnerBand[],
  cellLoTick: number,
  cellHiTick: number,
  priceTick: number,
  token0Usd: number,
  token0Decimals: number,
  token1Decimals: number,
): number {
  if (cellHiTick <= cellLoTick || bands.length === 0) return 0;
  const sqrtP = tickToSqrtPriceForDepth(priceTick);
  const pow0 = Math.pow(10, token0Decimals);
  const pow1 = Math.pow(10, token1Decimals);
  let amount0Raw = 0;
  let amount1Raw = 0;
  for (const band of bands) {
    const lo = Math.max(band.tickLower, cellLoTick);
    const hi = Math.min(band.tickUpper, cellHiTick);
    if (lo >= hi || !(band.L > 0)) continue;
    const sqrtA = tickToSqrtPriceForDepth(lo);
    const sqrtB = tickToSqrtPriceForDepth(hi);
    const clamped = Math.min(Math.max(sqrtP, sqrtA), sqrtB);
    const dUp = Math.max(0, sqrtB - clamped);
    const dDown = Math.max(0, clamped - sqrtA);
    amount0Raw += clamped > 0 && sqrtB > 0 ? (band.L * dUp) / (clamped * sqrtB) : 0;
    amount1Raw += band.L * dDown;
  }
  return (amount0Raw / pow0) * token0Usd + amount1Raw / pow1;
}

function filterMaterializedOwnerBands(
  payload: LiquidityDepthPayload,
  selectedOwners: string[],
  includeInactive: boolean,
): LiquidityDepthOwnerBand[] {
  const selected = selectedOwners.length > 0 ? new Set(selectedOwners.map((owner) => owner.toLowerCase())) : null;
  return (payload.ownerBands ?? []).filter((band) => {
    if (!includeInactive && band.closed) return false;
    if (selected && !selected.has(band.owner)) return false;
    return true;
  });
}

function buildMaterializedOwnerValues(
  payload: LiquidityDepthPayload,
  selectedOwners: string[],
  includeInactive: boolean,
): { values: number[][]; ownerCount: number; bandCount: number } | null {
  const bands = filterMaterializedOwnerBands(payload, selectedOwners, includeInactive);
  if (bands.length === 0) return { values: payload.times.map(() => payload.priceBins.map(() => 0)), ownerCount: 0, bandCount: 0 };
  const token0Decimals = payload.meta.token0Decimals ?? 8;
  const token1Decimals = payload.meta.token1Decimals ?? 6;
  const binTicks = payload.priceBins.map((price) => priceToRaydiumTick(price, token0Decimals, token1Decimals));
  const binTickEdges = buildBinTickEdges(binTicks);
  const fallbackPrice = payload.priceBins[Math.floor(payload.priceBins.length / 2)] ?? RAYDIUM_HUMAN_PRICE_SCALE;

  const values = payload.times.map((time, col) => {
    const price = payload.priceLine[col] ?? fallbackPrice;
    const priceTick = priceToRaydiumTick(price, token0Decimals, token1Decimals);
    const token0Usd = Number.isFinite(price) && price > 0
      ? price
      : raydiumTickToPrice(priceTick, token0Decimals, token1Decimals);
    const activeBands = bands.filter((band) => band.openedAt <= time && time < band.end);
    return payload.priceBins.map((_, row) => valueBandsForCellUsd(
      activeBands,
      binTickEdges[row],
      binTickEdges[row + 1],
      priceTick,
      token0Usd,
      token0Decimals,
      token1Decimals,
    ));
  });

  return {
    values,
    ownerCount: new Set(bands.map((band) => band.owner)).size,
    bandCount: bands.length,
  };
}

function materializedCellBreakdown(
  payload: LiquidityDepthPayload,
  selectedOwners: string[],
  includeInactive: boolean,
  col: number,
  row: number,
  sampledPrice?: number,
): CellOwnerContribution[] {
  const time = payload.times[col];
  if (!Number.isFinite(time)) return [];
  const token0Decimals = payload.meta.token0Decimals ?? 8;
  const token1Decimals = payload.meta.token1Decimals ?? 6;
  const binTicks = payload.priceBins.map((price) => priceToRaydiumTick(price, token0Decimals, token1Decimals));
  const binTickEdges = buildBinTickEdges(binTicks);
  const sourceRow = sampledPrice === undefined ? row : nearestPriceBinIndex(payload.priceBins, sampledPrice);
  if (sourceRow === null || sourceRow < 0 || sourceRow >= binTickEdges.length - 1) return [];
  const price = payload.priceLine[col] ?? payload.priceBins[Math.floor(payload.priceBins.length / 2)] ?? RAYDIUM_HUMAN_PRICE_SCALE;
  const priceTick = priceToRaydiumTick(price, token0Decimals, token1Decimals);
  const token0Usd = Number.isFinite(price) && price > 0
    ? price
    : raydiumTickToPrice(priceTick, token0Decimals, token1Decimals);
  const selected = selectedOwners.length > 0 ? new Set(selectedOwners.map((owner) => owner.toLowerCase())) : null;
  const byOwner = new Map<string, number>();
  for (const band of payload.ownerBands ?? []) {
    if (!includeInactive && band.closed) continue;
    if (selected && !selected.has(band.owner)) continue;
    if (!(band.openedAt <= time && time < band.end)) continue;
    const value = valueBandsForCellUsd(
      [band],
      binTickEdges[sourceRow],
      binTickEdges[sourceRow + 1],
      priceTick,
      token0Usd,
      token0Decimals,
      token1Decimals,
    );
    if (value > 0) byOwner.set(band.owner, (byOwner.get(band.owner) ?? 0) + value);
  }
  return [...byOwner.entries()]
    .map(([owner, value]) => ({ owner, value }))
    .sort((a, b) => b.value - a.value);
}

function buildDepthHeatmap(
  payload: LiquidityDepthPayload,
  priceMode: HeatmapPriceMode,
  depthMode: HeatmapDepthMode,
  invertPrice: boolean,
  ownerCount: number,
): DepthHeatmap | null {
  const normalized = normalizePayloadPriceSide(payload, invertPrice);
  const priceBins = normalized.priceBins;
  if (payload.times.length === 0 || priceBins.length < 2) return null;

  const sourceValues = depthMode === "peak" ? withPeakDepth(normalized.values) : normalized.values;
  const T = payload.times.length;
  const P = priceBins.length;
  const centers = normalized.priceLine.map((price) => (Number.isFinite(price ?? NaN) && (price ?? 0) > 0 ? price as number : null));
  const fallbackCenter = centers.find((price): price is number => price !== null) ?? priceBins[Math.floor(P / 2)] ?? 1;
  const colCenterPrice = centers.map((price) => price ?? fallbackCenter);

  const cells = new Float64Array(T * P);
  const priceLineRow = new Float32Array(T);
  const rowIsOffset = priceMode === "sliding";
  const rowOffsetPct: number[] | null = rowIsOffset ? [] : null;
  const rowPrice = new Array<number>(P);

  if (rowIsOffset) {
    let maxAbsPct = 0.25;
    for (const center of colCenterPrice) {
      if (!(center > 0)) continue;
      maxAbsPct = Math.max(
        maxAbsPct,
        Math.abs(priceBins[0] / center - 1),
        Math.abs(priceBins[P - 1] / center - 1),
      );
    }
    maxAbsPct = Math.min(0.6, Math.max(0.08, maxAbsPct));
    for (let j = 0; j < P; j++) {
      const pct = -maxAbsPct + ((j + 0.5) / P) * maxAbsPct * 2;
      rowOffsetPct![j] = pct;
      rowPrice[j] = pct;
    }
    for (let c = 0; c < T; c++) {
      const row = sourceValues[c] ?? [];
      const center = colCenterPrice[c];
      for (let j = 0; j < P; j++) {
        cells[c * P + j] = nearestSample(priceBins, row, center * (1 + rowOffsetPct![j]));
      }
      priceLineRow[c] = P / 2;
    }
  } else {
    const minPrice = priceBins[0];
    const maxPrice = priceBins[P - 1];
    const span = Math.max(1e-12, maxPrice - minPrice);
    for (let j = 0; j < P; j++) rowPrice[j] = priceBins[j];
    for (let c = 0; c < T; c++) {
      const row = sourceValues[c] ?? [];
      for (let j = 0; j < P; j++) cells[c * P + j] = row[j] ?? 0;
      priceLineRow[c] = Math.min(P, Math.max(0, ((colCenterPrice[c] - minPrice) / span) * P));
    }
  }

  const positives: number[] = [];
  for (const value of cells) {
    if (Number.isFinite(value) && value > 0) positives.push(value);
  }
  let lastColTotal = 0;
  for (let j = 0; j < P; j++) lastColTotal += cells[(T - 1) * P + j] ?? 0;

  return {
    mode: priceMode,
    windowDays: payload.meta.windowDays,
    times: payload.times,
    T,
    P,
    cells,
    priceLineRow,
    rowPrice,
    rowOffsetPct,
    rowIsOffset,
    colCenterPrice,
    maxCell: positives.length ? Math.max(...positives) : 0,
    p95: percentile(positives, 0.95),
    p99: percentile(positives, 0.99),
    valueIsUsd: payload.meta.valueMode === "usd",
    lastColTotal,
    ownerCount,
    bandCount: positives.length,
  };
}

function adaptLegacyDepthHeatmap(
  heatmap: LegacyDepthHeatmap,
  token0Decimals: number,
  token1Decimals: number,
  invertPrice: boolean,
): DepthHeatmap {
  const rowTicks = invertPrice ? [...heatmap.rowTickMid].reverse() : heatmap.rowTickMid;
  const colCenterPrice = Array.from(heatmap.colPriceTick, (tick) => {
    const raw = tickToPrice(tick, token0Decimals, token1Decimals);
    return invertPrice && raw > 0 ? 1 / raw : raw;
  });
  const rowOffsetPct = heatmap.rowIsOffset
    ? rowTicks.map((tick) => {
        const offset = Math.pow(1.0001, tick);
        return invertPrice && offset > 0 ? 1 / offset - 1 : offset - 1;
      })
    : null;
  const rowPrice = heatmap.rowIsOffset
    ? rowOffsetPct ?? rowTicks
    : rowTicks.map((tick) => {
        const raw = tickToPrice(tick, token0Decimals, token1Decimals);
        return invertPrice && raw > 0 ? 1 / raw : raw;
      });
  const cells = invertPrice ? new Float64Array(heatmap.cells.length) : heatmap.cells;
  const priceLineRow = invertPrice ? new Float32Array(heatmap.priceLineRow.length) : heatmap.priceLineRow;
  if (invertPrice) {
    for (let c = 0; c < heatmap.T; c++) {
      for (let j = 0; j < heatmap.P; j++) {
        cells[c * heatmap.P + (heatmap.P - 1 - j)] = heatmap.cells[c * heatmap.P + j];
      }
      priceLineRow[c] = heatmap.P - heatmap.priceLineRow[c];
    }
  }

  return {
    mode: heatmap.mode,
    windowDays: heatmap.windowDays,
    times: heatmap.times,
    T: heatmap.T,
    P: heatmap.P,
    cells,
    priceLineRow,
    rowPrice,
    rowOffsetPct,
    rowIsOffset: heatmap.rowIsOffset,
    colCenterPrice,
    maxCell: heatmap.maxCell,
    p95: heatmap.p95,
    p99: heatmap.p99,
    valueIsUsd: heatmap.valueIsUsd,
    lastColTotal: heatmap.lastColTotal,
    ownerCount: heatmap.ownerCount,
    bandCount: heatmap.bandCount,
  };
}

interface FrameOpts {
  hover?: { col: number; j: number } | null;
  pinned?: { col: number; j: number } | null;
}

export const HistoricalLiquidityDepthHeatmap = ({
  poolAddress,
  token0Symbol = "token0",
  token1Symbol = "token1",
  invertPrice = false,
  spaceSlug,
  activeOwners = [],
  closedOwners = [],
  rawEvents,
  allPositions,
  token0Decimals = 0,
  token1Decimals = 0,
  currentTick = 0,
  currentPrice = 0,
  token0UsdPrice = null,
  token1UsdPrice = null,
  tickSpacing = 1,
  useMaterializedDepth = true,
  enabled = true,
  className,
}: HistoricalLiquidityDepthHeatmapProps) => {
  const windowDays = useChartSettingsStore((s) => s.heatmapWindowDays);
  const priceMode = useChartSettingsStore((s) => s.heatmapPriceMode);
  const colorScale = useChartSettingsStore((s) => s.heatmapColorScale);
  const includeInactive = useChartSettingsStore((s) => s.heatmapIncludeInactive);
  const depthMode = useChartSettingsStore((s) => s.heatmapDepthMode);
  const setWindowDays = useChartSettingsStore((s) => s.setHeatmapWindowDays);
  const setPriceMode = useChartSettingsStore((s) => s.setHeatmapPriceMode);
  const setColorScale = useChartSettingsStore((s) => s.setHeatmapColorScale);
  const setIncludeInactive = useChartSettingsStore((s) => s.setHeatmapIncludeInactive);
  const setDepthMode = useChartSettingsStore((s) => s.setHeatmapDepthMode);

  const effectiveWindowDays = useMaterializedDepth ? (windowDays === 7 ? 7 : 30) : windowDays;
  useEffect(() => {
    if (useMaterializedDepth && windowDays !== 7 && windowDays !== 30) setWindowDays(30);
  }, [setWindowDays, useMaterializedDepth, windowDays]);

  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const selectionEmpty = selectedOwners.length === 0;
  const selectedSet = useMemo(() => new Set(selectedOwners.map((o) => o.toLowerCase())), [selectedOwners]);
  const [showFilter, setShowFilter] = useState(false);
  const [hover, setHover] = useState<{ col: number; j: number; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<{ col: number; j: number } | null>(null);

  useEffect(() => {
    setSelectedOwners([]);
    setShowFilter(false);
    setPinned(null);
  }, [poolAddress]);

  useEffect(() => {
    setPinned(null);
  }, [windowDays, priceMode, depthMode, includeInactive, selectedOwners]);

  const plotWrapRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 720, h: 300 });
  useEffect(() => {
    const el = plotWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.max(120, r.width), h: Math.max(120, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const targetColumns = useMemo(() => {
    const plotW = Math.max(1, size.w - LEFT - RIGHT);
    return Math.max(40, Math.round(plotW / 4 / 8) * 8);
  }, [size.w]);
  const targetRows = useMemo(() => {
    const plotH = Math.max(1, size.h - TOP - BOTTOM);
    return Math.max(40, Math.round(plotH / 4 / 8) * 8);
  }, [size.h]);
  const materializedEnabled = enabled && useMaterializedDepth;
  const legacyEnabled = enabled && !useMaterializedDepth;

  const {
    data: payload,
    isLoading: materializedLoading,
    isError: materializedError,
  } = useLiquidityDepth({
    poolAddress,
    spaceSlug,
    windowDays: effectiveWindowDays,
    resolution: effectiveWindowDays === 7 ? "1h" : "4h",
    priceBins: 96,
    enabled: materializedEnabled,
  });

  const materializedOwnerControlsEnabled =
    useMaterializedDepth && payload?.meta.ownerAttribution === true && (payload.ownerBands?.length ?? 0) > 0;
  const ownerControlsEnabled = !useMaterializedDepth || materializedOwnerControlsEnabled;

  useEffect(() => {
    if (!ownerControlsEnabled) {
      setSelectedOwners([]);
      setShowFilter(false);
    }
  }, [ownerControlsEnabled]);

  const materializedActiveOwners = useMemo<AddressOption[]>(
    () => (payload?.owners ?? [])
      .filter((owner) => owner.activeBandCount > 0 || owner.valueUsd > 0)
      .map((owner) => ({ owner: owner.owner, valueUsd: owner.valueUsd }))
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    [payload],
  );
  const materializedClosedOwners = useMemo<ClosedAddressOption[]>(
    () => (payload?.owners ?? [])
      .filter((owner) => owner.closedBandCount > 0)
      .map((owner) => ({
        owner: owner.owner,
        closedCount: owner.closedBandCount,
        lastClosedAt: owner.lastClosedAt,
      }))
      .sort((a, b) => b.lastClosedAt - a.lastClosedAt),
    [payload],
  );
  const filterActiveOwners = materializedOwnerControlsEnabled ? materializedActiveOwners : activeOwners;
  const filterClosedOwners = materializedOwnerControlsEnabled ? materializedClosedOwners : closedOwners;
  const materializedOwnerSource = useMemo(() => {
    if (!payload) return null;
    const ownerCount = payload.meta.ownerCount ?? payload.owners?.length ?? activeOwners.length;
    if (!materializedOwnerControlsEnabled || (selectionEmpty && includeInactive)) {
      return { payload, ownerCount };
    }
    const filtered = buildMaterializedOwnerValues(payload, selectedOwners, includeInactive);
    if (!filtered) return { payload, ownerCount };
    return {
      payload: {
        ...payload,
        values: filtered.values,
        meta: {
          ...payload.meta,
          valueMode: "usd" as const,
          ownerCount: filtered.ownerCount,
          ownerBandCount: filtered.bandCount,
        },
      },
      ownerCount: filtered.ownerCount,
    };
  }, [
    activeOwners.length,
    includeInactive,
    materializedOwnerControlsEnabled,
    payload,
    selectedOwners,
    selectionEmpty,
  ]);

  const {
    heatmap: legacyPayload,
    isLoading: legacyLoading,
    cellBreakdown: legacyCellBreakdown,
  } = useLiquidityDepthHeatmap({
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
    windowDays: effectiveWindowDays,
    priceMode,
    depthMode,
    selectedOwners,
    includeInactive,
    targetColumns,
    targetRows,
    spaceSlug,
    enabled: legacyEnabled,
  });

  const materializedHeatmap = useMemo(
    () => materializedOwnerSource
      ? buildDepthHeatmap(
        materializedOwnerSource.payload,
        priceMode,
        depthMode,
        invertPrice,
        materializedOwnerSource.ownerCount,
      )
      : null,
    [depthMode, invertPrice, materializedOwnerSource, priceMode],
  );

  const legacyHeatmap = useMemo(
    () => legacyPayload
      ? adaptLegacyDepthHeatmap(legacyPayload, token0Decimals, token1Decimals, invertPrice)
      : null,
    [invertPrice, legacyPayload, token0Decimals, token1Decimals],
  );
  const heatmap = useMaterializedDepth ? materializedHeatmap : legacyHeatmap;
  const isLoading = useMaterializedDepth ? materializedLoading : legacyLoading;
  const isError = useMaterializedDepth ? materializedError : false;

  const cellBreakdown: (col: number, j: number) => CellOwnerContribution[] = useCallback(
    (col, j) => {
      if (useMaterializedDepth) {
        if (!payload?.meta.ownerAttribution) return [];
        const sampledPrice = heatmap?.rowOffsetPct
          ? heatmap.colCenterPrice[col] * (1 + heatmap.rowOffsetPct[j])
          : undefined;
        return materializedCellBreakdown(payload, selectedOwners, includeInactive, col, j, sampledPrice);
      }
      return legacyCellBreakdown(col, j).map((entry: LegacyCellOwnerContribution) => ({
        owner: entry.owner,
        value: entry.value,
      }));
    },
    [heatmap, includeInactive, legacyCellBreakdown, payload, selectedOwners, useMaterializedDepth],
  );

  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const bg = cs.getPropertyValue("--bp-bg-card").trim() || cs.backgroundColor || "#ffffff";
    setDark(colorLuminance(bg) < 0.45);
  }, []);
  const stops = dark ? DARK_STOPS : LIGHT_STOPS;
  const lut = useMemo(() => buildLut(stops), [stops]);

  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!heatmap) {
      offscreenRef.current = null;
      return;
    }
    const { T, P, cells } = heatmap;
    let off = offscreenRef.current;
    if (!off) {
      off = document.createElement("canvas");
      offscreenRef.current = off;
    }
    off.width = T;
    off.height = P;
    const octx = off.getContext("2d");
    if (!octx) return;
    const img = octx.createImageData(T, P);
    const data = img.data;
    for (let c = 0; c < T; c++) {
      for (let j = 0; j < P; j++) {
        const v = cells[c * P + j];
        const py = P - 1 - j;
        const idx = (py * T + c) * 4;
        const t = normalize(v, heatmap, colorScale);
        if (t < 0) {
          data[idx + 3] = 0;
          continue;
        }
        const li = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
        data[idx] = lut[li];
        data[idx + 1] = lut[li + 1];
        data[idx + 2] = lut[li + 2];
        data[idx + 3] = lut[li + 3];
      }
    }
    octx.putImageData(img, 0, 0);
  }, [heatmap, colorScale, lut]);

  const renderFrame = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, opts: FrameOpts = {}) => {
      const off = offscreenRef.current;
      const cssEl = rootRef.current;
      const cs = cssEl ? getComputedStyle(cssEl) : null;
      const textMuted = cs?.getPropertyValue("--bp-text-muted").trim() || "#6b7280";
      const border = cs?.getPropertyValue("--bp-border-subtle").trim() || "#e5e7eb";
      const cardBg = cs?.getPropertyValue("--bp-bg-card").trim() || (dark ? "#0b0f1a" : "#ffffff");
      const priceLineColor = dark ? "#f8fafc" : "#0f172a";

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = cardBg;
      ctx.fillRect(0, 0, W, H);

      const left = LEFT;
      const top = TOP;
      const pw = Math.max(1, W - LEFT - RIGHT);
      const ph = Math.max(1, H - TOP - BOTTOM);
      if (!heatmap || !off) return;
      const { T, P, times, rowPrice, rowOffsetPct, rowIsOffset, priceLineRow, windowDays: wd } = heatmap;

      const yOfRowUnit = (u: number) => top + (1 - u / P) * ph;
      const xOfCol = (c: number) => left + ((c + 0.5) / T) * pw;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, T, P, left, top, pw, ph);

      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, pw - 1, ph - 1);

      ctx.strokeStyle = priceLineColor;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false;
      for (let c = 0; c < T; c++) {
        const u = Math.min(P, Math.max(0, priceLineRow[c]));
        const x = xOfCol(c);
        const y = yOfRowUnit(u);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = textMuted;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const j = Math.min(P - 1, Math.floor(f * (P - 1)));
        const y = yOfRowUnit(j + 0.5);
        const label = rowIsOffset && rowOffsetPct
          ? fmtPct(rowOffsetPct[j] * 100)
          : fmtPrice(rowPrice[j]);
        ctx.fillText(label, left - 6, y);
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xTicks = 5;
      for (let k = 0; k <= xTicks; k++) {
        const c = Math.min(T - 1, Math.round((k / xTicks) * (T - 1)));
        ctx.fillText(fmtTime(times[c], wd), xOfCol(c), top + ph + 6);
      }

      if (opts.pinned && opts.pinned.col < T && opts.pinned.j < P) {
        const cw = pw / T;
        const chh = ph / P;
        const x = left + opts.pinned.col * cw;
        const y = yOfRowUnit(opts.pinned.j + 1);
        ctx.strokeStyle = priceLineColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, Math.max(2, cw), Math.max(2, chh));
      }

      if (opts.hover && opts.hover.col >= 0 && opts.hover.col < T && opts.hover.j >= 0 && opts.hover.j < P) {
        const x = xOfCol(opts.hover.col);
        const y = yOfRowUnit(opts.hover.j + 0.5);
        ctx.strokeStyle = priceLineColor;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + ph);
        ctx.moveTo(left, y);
        ctx.lineTo(left + pw, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    },
    [heatmap, dark],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const W = size.w;
    const H = size.h;
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    cvs.style.width = `${W}px`;
    cvs.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderFrame(ctx, W, H, { hover, pinned });
  }, [renderFrame, size, hover, pinned]);

  useEffect(() => {
    draw();
  }, [draw]);

  const cellFromEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { col: number; j: number; x: number; y: number } | null => {
      if (!heatmap) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const pw = Math.max(1, size.w - LEFT - RIGHT);
      const ph = Math.max(1, size.h - TOP - BOTTOM);
      if (mx < LEFT || mx > LEFT + pw || my < TOP || my > TOP + ph) return null;
      const col = Math.min(heatmap.T - 1, Math.max(0, Math.floor(((mx - LEFT) / pw) * heatmap.T)));
      const u = (1 - (my - TOP) / ph) * heatmap.P;
      const j = Math.min(heatmap.P - 1, Math.max(0, Math.floor(u)));
      return { col, j, x: mx, y: my };
    },
    [heatmap, size],
  );
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => setHover(cellFromEvent(e)),
    [cellFromEvent],
  );
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const cell = cellFromEvent(e);
      if (!cell) {
        setPinned(null);
        return;
      }
      setPinned((prev) => (prev && prev.col === cell.col && prev.j === cell.j ? null : { col: cell.col, j: cell.j }));
    },
    [cellFromEvent],
  );

  const cellLabel = useCallback(
    (col: number, j: number): { time: string; price: string; offset: string | null } => {
      if (!heatmap) return { time: "", price: "", offset: null };
      const offsetPct = heatmap.rowOffsetPct?.[j] ?? null;
      const price = offsetPct === null
        ? heatmap.rowPrice[j]
        : heatmap.colCenterPrice[col] * (1 + offsetPct);
      return {
        time: fmtTime(heatmap.times[col], heatmap.windowDays),
        price: fmtPrice(price),
        offset: offsetPct === null ? null : fmtPct(offsetPct * 100),
      };
    },
    [heatmap],
  );

  const hoverInfo = useMemo(() => {
    if (!hover || !heatmap) return null;
    const { col, j } = hover;
    const v = heatmap.cells[col * heatmap.P + j];
    let total = 0;
    for (let jj = 0; jj < heatmap.P; jj++) total += heatmap.cells[col * heatmap.P + jj];
    const { time, price, offset } = cellLabel(col, j);
    const contributors = v > 0 ? cellBreakdown(col, j).slice(0, 2) : [];
    return {
      time,
      price,
      offset,
      depth: fmtValue(v, heatmap.valueIsUsd),
      pctOfCol: total > 0 ? (v / total) * 100 : 0,
      contributors,
    };
  }, [hover, heatmap, cellLabel, cellBreakdown]);

  const pinnedInfo = useMemo(() => {
    if (!pinned || !heatmap) return null;
    const { col, j } = pinned;
    if (col >= heatmap.T || j >= heatmap.P) return null;
    const v = heatmap.cells[col * heatmap.P + j];
    const { time, price, offset } = cellLabel(col, j);
    const owners = cellBreakdown(col, j).slice(0, 10);
    const pw = Math.max(1, size.w - LEFT - RIGHT);
    const ph = Math.max(1, size.h - TOP - BOTTOM);
    const x = LEFT + ((col + 0.5) / heatmap.T) * pw;
    const y = TOP + (1 - (j + 0.5) / heatmap.P) * ph;
    return {
      time,
      price,
      offset,
      depth: fmtValue(v, heatmap.valueIsUsd),
      owners,
      x,
      y,
    };
  }, [pinned, heatmap, cellLabel, cellBreakdown, size]);

  const toggleOwner = useCallback((owner: string) => {
    const o = owner.toLowerCase();
    setSelectedOwners((prev) => {
      if (prev.length === 0) return [o];
      const has = prev.includes(o);
      return has ? prev.filter((x) => x !== o) : [...prev, o];
    });
  }, []);
  const selectAll = useCallback(() => setSelectedOwners([]), []);

  const priceUnit = invertPrice
    ? `${token0Symbol} per ${token1Symbol}`
    : `${token1Symbol} per ${token0Symbol}`;

  const segBtn = (active: boolean, disabled = false) =>
    cn(
      "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
      active
        ? "bg-[var(--bp-bg-card-alt)] text-[var(--bp-text-primary)]"
        : "text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)]",
      disabled && "cursor-not-allowed opacity-45 hover:text-[var(--bp-text-muted)]",
    );
  const toolBtn = (active = false) =>
    cn(
      "px-2 py-0.5 rounded text-[11px] font-medium border transition-colors",
      active
        ? "border-[#6366f1] text-[var(--bp-text-primary)]"
        : "border-[var(--bp-border-subtle)] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)]",
    );

  return (
    <div ref={rootRef} className={cn("bp-depth-heatmap h-full flex flex-col min-h-0 select-none", className)}>
      <div className="flex-shrink-0 flex items-center flex-wrap gap-x-4 gap-y-1.5 pb-2 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-[var(--bp-text-muted)] mr-1">Window</span>
          {WINDOW_OPTIONS.map((d) => {
            const disabled = useMaterializedDepth && d > 30;
            return (
              <button
                key={d}
                className={segBtn(windowDays === d, disabled)}
                disabled={disabled}
                onClick={() => setWindowDays(d)}
                title={disabled ? "Materialized Raydium depth is available up to 30d." : undefined}
              >
                {d >= 365 ? "1y" : `${d}d`}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[var(--bp-text-muted)] mr-1">Depth</span>
          <button className={segBtn(depthMode === "precise")} onClick={() => setDepthMode("precise")} title={useMaterializedDepth ? "Materialized instant liquidity depth" : "Replayed instant liquidity depth"}>
            Precise
          </button>
          <button className={segBtn(depthMode === "peak")} onClick={() => setDepthMode("peak")} title="Running peak depth per price row">
            Peak
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[var(--bp-text-muted)] mr-1">Price</span>
          <button className={segBtn(priceMode === "fixed")} onClick={() => setPriceMode("fixed")}>
            Fixed
          </button>
          <button className={segBtn(priceMode === "sliding")} onClick={() => setPriceMode("sliding")}>
            Follow
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[var(--bp-text-muted)] mr-1">Scale</span>
          <button className={segBtn(colorScale === "percentile")} onClick={() => setColorScale("percentile")}>
            Pctl
          </button>
          <button className={segBtn(colorScale === "log")} onClick={() => setColorScale("log")}>
            Log
          </button>
        </div>
        {ownerControlsEnabled && (
          <>
            <label className="flex items-center gap-1.5 cursor-pointer text-[var(--bp-text-muted)]">
              <input
                type="checkbox"
                className="accent-[#6366f1]"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Include inactive
            </label>
            <button className={toolBtn(showFilter)} onClick={() => setShowFilter((v) => !v)}>
              {selectionEmpty ? "Addresses: All" : `Addresses: ${selectedOwners.length}`}
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {heatmap && (
            <span className="text-[var(--bp-text-muted)] flex items-center gap-2">
              <span>{heatmap.ownerCount} LP{heatmap.ownerCount === 1 ? "" : "s"}</span>
              <span>
                Now: <span className="text-[var(--bp-text-secondary)]">{fmtValue(heatmap.lastColTotal, heatmap.valueIsUsd)}</span>
              </span>
              <span className="text-[10px] opacity-70" title={depthMode === "precise" ? "Materialized instant liquidity depth." : "Running peak depth per price row."}>
                {depthMode === "precise" ? "precise depth" : "peak liquidity"}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-2">
        <div ref={plotWrapRef} className="relative flex-1 min-h-0">
          {isLoading && !heatmap ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--bp-text-muted)]">
              Loading depth history...
            </div>
          ) : isError ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--bp-text-muted)]">
              Liquidity depth materialization is unavailable for this pool
            </div>
          ) : !heatmap ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--bp-text-muted)]">
              No liquidity history for this selection
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="block w-full h-full cursor-crosshair"
              onMouseMove={onMouseMove}
              onMouseLeave={() => setHover(null)}
              onClick={onClick}
            />
          )}

          {hoverInfo && hover && (
            <div
              className="absolute z-30 pointer-events-none"
              style={{ left: Math.min(hover.x + 12, size.w - 168), top: Math.max(4, hover.y - 8) }}
            >
              <div className="bg-[var(--bp-bg-card)]/95 backdrop-blur-sm border border-[var(--bp-border-subtle)] rounded-lg shadow-lg px-2.5 py-2 text-[11px] min-w-[148px]">
                <div className="text-[var(--bp-text-muted)] mb-1">{hoverInfo.time}</div>
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--bp-text-muted)]">Price</span>
                  <span className="tabular-nums text-[var(--bp-text-primary)]">
                    {hoverInfo.price}
                    {hoverInfo.offset && <span className="text-[var(--bp-text-muted)] ml-1">({hoverInfo.offset})</span>}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--bp-text-muted)]">Depth</span>
                  <span className="tabular-nums font-semibold text-[var(--bp-text-primary)]">{hoverInfo.depth}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[var(--bp-text-muted)]">% of column</span>
                  <span className="tabular-nums text-[var(--bp-text-secondary)]">{hoverInfo.pctOfCol.toFixed(1)}%</span>
                </div>
                {hoverInfo.contributors.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-[var(--bp-border-subtle)]/60">
                    {hoverInfo.contributors.map((c) => (
                      <div key={c.owner} className="flex justify-between gap-3">
                        <span className="font-mono text-[var(--bp-text-muted)]">{shortAddr(c.owner)}</span>
                        <span className="tabular-nums text-[var(--bp-text-secondary)]">
                          {fmtValue(c.value, !!heatmap?.valueIsUsd)}
                        </span>
                      </div>
                    ))}
                    <div className="text-[9px] text-[var(--bp-text-muted)] mt-0.5">click to pin LPs -&gt;</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {pinnedInfo && (
            <div
              className="absolute z-40"
              style={{
                left: Math.min(Math.max(8, pinnedInfo.x + 12), Math.max(8, size.w - 220)),
                top: Math.min(Math.max(8, pinnedInfo.y - 10), Math.max(8, size.h - 220)),
              }}
            >
              <div className="bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)] rounded-lg shadow-xl px-3 py-2.5 text-[11px] w-[210px]">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[var(--bp-text-secondary)] font-medium">
                    {pinnedInfo.time} - {pinnedInfo.price}
                    {pinnedInfo.offset ? ` (${pinnedInfo.offset})` : ""}
                  </div>
                  <button className="text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)]" onClick={() => setPinned(null)}>
                    x
                  </button>
                </div>
                <div className="flex justify-between gap-3 mb-1.5">
                  <span className="text-[var(--bp-text-muted)]">Cell depth</span>
                  <span className="tabular-nums font-semibold text-[var(--bp-text-primary)]">{pinnedInfo.depth}</span>
                </div>
                {pinnedInfo.owners.length === 0 ? (
                  <div className="text-[var(--bp-text-muted)] py-1">
                    {useMaterializedDepth && !materializedOwnerControlsEnabled ? "Owner attribution is not materialized for this payload." : "No liquidity here."}
                  </div>
                ) : (
                  <div className="max-h-[150px] overflow-y-auto -mx-1">
                    {pinnedInfo.owners.map((c) => {
                      const checked = selectionEmpty || selectedSet.has(c.owner);
                      return (
                        <button
                          key={c.owner}
                          onClick={() => toggleOwner(c.owner)}
                          className="w-full flex items-center gap-2 px-1 py-1 rounded hover:bg-[var(--bp-bg-card-alt)]/60 text-left"
                          title="Toggle this LP in the heatmap"
                        >
                          <span
                            className={cn(
                              "w-3 h-3 rounded-sm border flex items-center justify-center text-[8px]",
                              checked ? "bg-[#6366f1] border-[#6366f1] text-white" : "border-[var(--bp-border-subtle)]",
                            )}
                          >
                            {checked ? "✓" : ""}
                          </span>
                          <span className="font-mono text-[var(--bp-text-secondary)] truncate flex-1">{shortAddr(c.owner)}</span>
                          <span className="tabular-nums text-[var(--bp-text-muted)]">
                            {fmtValue(c.value, !!heatmap?.valueIsUsd)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 w-12 flex flex-col items-center justify-center py-1 text-[9px] text-[var(--bp-text-muted)]">
          <span className="mb-1">{heatmap?.valueIsUsd ? "deep" : "high"}</span>
          <div
            className="flex-1 w-3 rounded-sm border border-[var(--bp-border-subtle)]"
            style={{ background: legendGradientCss(stops) }}
          />
          <span className="mt-1">low</span>
        </div>
      </div>

      <div className="flex-shrink-0 text-center text-[9px] text-[var(--bp-text-muted)] pt-1">
        Price: {priceUnit} - {priceMode === "fixed" ? "fixed axis" : "follow price"} - {depthMode} depth
      </div>

      {ownerControlsEnabled && showFilter && (
        <AddressFilterPanel
          activeOwners={filterActiveOwners}
          closedOwners={filterClosedOwners}
          selectedOwners={selectedOwners}
          selectionEmpty={selectionEmpty}
          includeInactive={includeInactive}
          onToggle={toggleOwner}
          onSelectAll={selectAll}
          valueIsUsd={!!heatmap?.valueIsUsd}
        />
      )}
    </div>
  );
};

function AddressFilterPanel({
  activeOwners,
  closedOwners,
  selectedOwners,
  selectionEmpty,
  includeInactive,
  onToggle,
  onSelectAll,
  valueIsUsd,
}: {
  activeOwners: AddressOption[];
  closedOwners: ClosedAddressOption[];
  selectedOwners: string[];
  selectionEmpty: boolean;
  includeInactive: boolean;
  onToggle: (owner: string) => void;
  onSelectAll: () => void;
  valueIsUsd: boolean;
}) {
  const [search, setSearch] = useState("");
  const [expandActive, setExpandActive] = useState(false);
  const [expandClosed, setExpandClosed] = useState(false);
  const sel = useMemo(() => new Set(selectedOwners.map((o) => o.toLowerCase())), [selectedOwners]);
  const q = search.trim().toLowerCase();

  const filteredActive = useMemo(
    () => activeOwners.filter((o) => !q || o.owner.toLowerCase().includes(q)),
    [activeOwners, q],
  );
  const filteredClosed = useMemo(
    () => closedOwners.filter((o) => !q || o.owner.toLowerCase().includes(q)),
    [closedOwners, q],
  );

  const isChecked = (owner: string) => selectionEmpty || sel.has(owner.toLowerCase());
  const ACTIVE_LIMIT = 24;
  const CLOSED_LIMIT = 24;
  const activeShown = expandActive ? filteredActive : filteredActive.slice(0, ACTIVE_LIMIT);
  const closedShown = expandClosed ? filteredClosed : filteredClosed.slice(0, CLOSED_LIMIT);

  const row = (owner: string, right: React.ReactNode, dim = false) => (
    <label
      key={owner}
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[var(--bp-bg-card-alt)]/60",
        dim && "opacity-60",
      )}
    >
      <input type="checkbox" className="accent-[#6366f1]" checked={isChecked(owner)} onChange={() => onToggle(owner)} />
      <span className="font-mono text-[11px] text-[var(--bp-text-secondary)] truncate">{shortAddr(owner)}</span>
      <span className="ml-auto text-[10px] text-[var(--bp-text-muted)] tabular-nums">{right}</span>
    </label>
  );

  return (
    <div className="flex-shrink-0 mt-2 border-t border-[var(--bp-border-subtle)] pt-2 max-h-[230px] overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 pb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search address..."
          className="flex-1 px-2 py-1 text-[11px] rounded border border-[var(--bp-border-subtle)] bg-transparent text-[var(--bp-text-primary)] outline-none"
        />
        <button
          className={cn(
            "px-2 py-1 rounded text-[11px] font-medium border transition-colors",
            selectionEmpty
              ? "border-[#6366f1] text-[var(--bp-text-primary)]"
              : "border-[var(--bp-border-subtle)] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)]",
          )}
          onClick={onSelectAll}
        >
          All LPs
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-3">
        <div>
          <div className="text-[10px] font-semibold text-[var(--bp-text-muted)] px-2 py-1 sticky top-0 bg-[var(--bp-bg-card)]">
            Active ({filteredActive.length})
          </div>
          {activeShown.map((o) => row(o.owner, valueIsUsd && o.valueUsd != null ? fmtUsd(o.valueUsd) : ""))}
          {filteredActive.length > ACTIVE_LIMIT && (
            <button className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)] px-2 py-1" onClick={() => setExpandActive((v) => !v)}>
              {expandActive ? "Show less" : `+${filteredActive.length - ACTIVE_LIMIT} more`}
            </button>
          )}
        </div>
        <div>
          <div className="text-[10px] font-semibold text-[var(--bp-text-muted)] px-2 py-1 sticky top-0 bg-[var(--bp-bg-card)]">
            Inactive / closed ({filteredClosed.length})
          </div>
          {!includeInactive && filteredClosed.length > 0 && (
            <p className="text-[10px] text-[var(--bp-text-muted)] px-2 pb-1">Enable Include inactive to show these.</p>
          )}
          {closedShown.map((o) => row(o.owner, `${o.closedCount} closed`, !includeInactive))}
          {filteredClosed.length > CLOSED_LIMIT && (
            <button className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-secondary)] px-2 py-1" onClick={() => setExpandClosed((v) => !v)}>
              {expandClosed ? "Show less" : `+${filteredClosed.length - CLOSED_LIMIT} more`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
