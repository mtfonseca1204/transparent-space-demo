import {
  ZEROG_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
  ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
  ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
  inferPoolProtocol,
  normalizePoolKey,
} from "@/lib/pools";
import { isDemoPoolKey } from "@/lib/demo/constants";

export type LiquidityDepthQuality = {
  reconciled: boolean;
  mismatchPct: number | null;
  reconstructedLiquidity: number | null;
  indexedLiquidity: number | null;
  latestTick: number | null;
  thresholdPct: number;
  warnings: string[];
};

export type LiquidityDepthPayload = {
  times: number[];
  priceBins: number[];
  values: number[][];
  priceLine: Array<number | null>;
  ownerBands?: LiquidityDepthOwnerBand[];
  owners?: LiquidityDepthOwnerSummary[];
  quality: LiquidityDepthQuality;
  meta: {
    pool: string;
    protocol: LiquidityDepthProtocol;
    schemaVersion?: number;
    windowDays: number;
    resolution: string;
    resolutionSeconds: number;
    priceBins: number;
    startTime: number;
    endTime: number;
    source: "indexer-native";
    valueMode?: "usd" | "raw-liquidity";
    ownerAttribution?: boolean;
    ownerBandCount?: number;
    ownerCount?: number;
    token0Decimals?: number;
    token1Decimals?: number;
    materializedAt: string;
    cache?: string;
  };
};

export type LiquidityDepthOwnerBand = {
  owner: string;
  tickLower: number;
  tickUpper: number;
  L: number;
  openedAt: number;
  end: number;
  closed: boolean;
};

export type LiquidityDepthOwnerSummary = {
  owner: string;
  valueUsd: number;
  activeBandCount: number;
  closedBandCount: number;
  lastClosedAt: number;
};

export type LiquidityDepthProtocol = "raydium-clmm" | "uniswap-v3";

const MATERIALIZED_EVM_LIQUIDITY_DEPTH_POOLS = new Set(
  [
    ZEROG_W0G_USDCE_V3_POOL_KEY,
    ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
    ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
    ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
    ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
    ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
  ].map(normalizePoolKey),
);

export function supportsHistoricalLiquidityDepth(poolKey: string | null | undefined): boolean {
  if (!poolKey) return false;
  const normalized = normalizePoolKey(poolKey);
  if (isDemoPoolKey(normalized)) return false;
  return inferPoolProtocol(normalized) === "raydium" || MATERIALIZED_EVM_LIQUIDITY_DEPTH_POOLS.has(normalized);
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(toFiniteNumber).filter((n): n is number => n !== null);
}

function normalizeNullableNumberArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return [];
  return value.map(toFiniteNumber);
}

function normalizeOwnerBands(value: unknown): LiquidityDepthOwnerBand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Partial<LiquidityDepthOwnerBand>;
    const tickLower = toFiniteNumber(row.tickLower);
    const tickUpper = toFiniteNumber(row.tickUpper);
    const L = toFiniteNumber(row.L);
    const openedAt = toFiniteNumber(row.openedAt);
    const end = toFiniteNumber(row.end);
    const owner = String(row.owner ?? "").trim().toLowerCase();
    if (!owner || tickLower === null || tickUpper === null || L === null || openedAt === null || end === null) {
      return [];
    }
    if (!(tickLower < tickUpper) || !(L > 0) || !(end > openedAt)) return [];
    return [{
      owner,
      tickLower,
      tickUpper,
      L,
      openedAt,
      end,
      closed: row.closed === true,
    }];
  });
}

function normalizeOwners(value: unknown): LiquidityDepthOwnerSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Partial<LiquidityDepthOwnerSummary>;
    const owner = String(row.owner ?? "").trim().toLowerCase();
    if (!owner) return [];
    return [{
      owner,
      valueUsd: toFiniteNumber(row.valueUsd) ?? 0,
      activeBandCount: toFiniteNumber(row.activeBandCount) ?? 0,
      closedBandCount: toFiniteNumber(row.closedBandCount) ?? 0,
      lastClosedAt: toFiniteNumber(row.lastClosedAt) ?? 0,
    }];
  });
}

function normalizeProtocol(value: unknown): LiquidityDepthProtocol {
  return value === "uniswap-v3" ? "uniswap-v3" : "raydium-clmm";
}

export function normalizeLiquidityDepthPayload(payload: unknown): LiquidityDepthPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Partial<LiquidityDepthPayload>;
  const times = normalizeNumberArray(raw.times);
  const priceBins = normalizeNumberArray(raw.priceBins);
  const priceLine = normalizeNullableNumberArray(raw.priceLine);
  const rawValues = Array.isArray(raw.values) ? raw.values : [];
  const values = rawValues.map(normalizeNumberArray);
  const ownerBands = normalizeOwnerBands(raw.ownerBands);
  const owners = normalizeOwners(raw.owners);

  if (times.length === 0 || priceBins.length === 0) return null;
  if (priceLine.length !== times.length) return null;
  if (values.length !== times.length) return null;
  if (values.some((row) => row.length !== priceBins.length)) return null;

  const quality = raw.quality;
  const meta = raw.meta;
  if (!quality || !meta) return null;

  return {
    times,
    priceBins,
    values,
    priceLine,
    ownerBands,
    owners,
    quality: {
      reconciled: quality.reconciled === true,
      mismatchPct: toFiniteNumber(quality.mismatchPct),
      reconstructedLiquidity: toFiniteNumber(quality.reconstructedLiquidity),
      indexedLiquidity: toFiniteNumber(quality.indexedLiquidity),
      latestTick: toFiniteNumber(quality.latestTick),
      thresholdPct: toFiniteNumber(quality.thresholdPct) ?? 5,
      warnings: Array.isArray(quality.warnings)
        ? quality.warnings.map(String)
        : [],
    },
    meta: {
      pool: String(meta.pool ?? ""),
      protocol: normalizeProtocol(meta.protocol),
      schemaVersion: toFiniteNumber(meta.schemaVersion) ?? 1,
      windowDays: toFiniteNumber(meta.windowDays) ?? 7,
      resolution: String(meta.resolution ?? "1h"),
      resolutionSeconds: toFiniteNumber(meta.resolutionSeconds) ?? 3600,
      priceBins: toFiniteNumber(meta.priceBins) ?? priceBins.length,
      startTime: toFiniteNumber(meta.startTime) ?? times[0],
      endTime: toFiniteNumber(meta.endTime) ?? times[times.length - 1],
      source: "indexer-native",
      valueMode: meta.valueMode === "usd" ? "usd" : "raw-liquidity",
      ownerAttribution: meta.ownerAttribution === true && ownerBands.length > 0,
      ownerBandCount: toFiniteNumber(meta.ownerBandCount) ?? ownerBands.length,
      ownerCount: toFiniteNumber(meta.ownerCount) ?? owners.length,
      token0Decimals: toFiniteNumber(meta.token0Decimals) ?? 8,
      token1Decimals: toFiniteNumber(meta.token1Decimals) ?? 6,
      materializedAt: String(meta.materializedAt ?? ""),
      cache: meta.cache === undefined ? undefined : String(meta.cache),
    },
  };
}
