import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { sqrtPriceX96ToPrice } from "@/lib/envio-client";
import { normalizePoolKey } from "@/lib/pools";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";

export interface SpreadDataPoint {
  timestamp: Date;
  poolPrice: number;
  oraclePrice: number;
  spreadPct: number; // (poolPrice - oraclePrice) / oraclePrice * 100
}

export interface DeviationEvent {
  start: Date;
  end: Date;
  durationMs: number;
  maxAbsSpread: number; // max |spreadPct| during the event
  avgSpread: number;    // average spreadPct during the event
  pointCount: number;
}

/**
 * Detect contiguous periods where |spreadPct| > threshold.
 * Returns events sorted by duration DESC.
 */
export function computeDeviations(
  data: SpreadDataPoint[],
  threshold: number = 2
): DeviationEvent[] {
  if (data.length === 0) return [];

  const events: DeviationEvent[] = [];
  let inDeviation = false;
  let start = 0;
  let maxAbs = 0;
  let sumSpread = 0;
  let count = 0;

  for (let i = 0; i < data.length; i++) {
    const exceeds = Math.abs(data[i].spreadPct) > threshold;

    if (exceeds && !inDeviation) {
      // Start new deviation
      inDeviation = true;
      start = i;
      maxAbs = Math.abs(data[i].spreadPct);
      sumSpread = data[i].spreadPct;
      count = 1;
    } else if (exceeds && inDeviation) {
      // Continue deviation
      maxAbs = Math.max(maxAbs, Math.abs(data[i].spreadPct));
      sumSpread += data[i].spreadPct;
      count++;
    } else if (!exceeds && inDeviation) {
      // End deviation
      inDeviation = false;
      const end = data[i - 1];
      events.push({
        start: data[start].timestamp,
        end: end.timestamp,
        durationMs: end.timestamp.getTime() - data[start].timestamp.getTime(),
        maxAbsSpread: maxAbs,
        avgSpread: sumSpread / count,
        pointCount: count,
      });
    }
  }

  // Close any open deviation at the end of data
  if (inDeviation) {
    const end = data[data.length - 1];
    events.push({
      start: data[start].timestamp,
      end: end.timestamp,
      durationMs: end.timestamp.getTime() - data[start].timestamp.getTime(),
      maxAbsSpread: maxAbs,
      avgSpread: sumSpread / count,
      pointCount: count,
    });
  }

  // Sort by duration DESC
  events.sort((a, b) => b.durationMs - a.durationMs);

  return events;
}

interface UsePriceSpreadDataOptions {
  poolAddress: string;
  token0Address?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  invert?: boolean;
  enabled?: boolean;
  spaceSlug?: string | null;
}

// Stable hour boundary (prevents query key from changing every second)
function stableHourBoundary(): number {
  return Math.floor(Date.now() / (3600 * 1000)) * 3600;
}

interface ApiCandle {
  timestamp: number;
  closePrice: string;
}

// ─── Shared alignment logic ───────────────────────────────────────────────────

function alignCandlesWithOracle(
  candleData: { timestamp: number; close: number }[],
  oracleData: { timestamp: number; price: number }[],
  invert: boolean,
  maxGapMs: number,
): SpreadDataPoint[] {
  if (candleData.length === 0 || oracleData.length === 0) return [];

  const oracleSorted = oracleData
    .map((p) => ({ ts: p.timestamp * 1000, price: p.price }))
    .sort((a, b) => a.ts - b.ts);

  const result: SpreadDataPoint[] = [];

  for (const candle of candleData) {
    const candleTs = candle.timestamp * 1000;
    let closePrice = candle.close;
    if (!Number.isFinite(closePrice) || closePrice <= 0) continue;

    // Binary search for first oracle point >= candleTs
    let lo = 0;
    let hi = oracleSorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (oracleSorted[mid].ts < candleTs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Interpolate between surrounding oracle points
    let oraclePrice: number;

    if (lo === 0) {
      // Before or at first oracle point — use first value if within gap
      if (Math.abs(oracleSorted[0].ts - candleTs) > maxGapMs) continue;
      oraclePrice = oracleSorted[0].price;
    } else if (lo >= oracleSorted.length) {
      // After last oracle point — use last value if within gap
      const last = oracleSorted[oracleSorted.length - 1];
      if (Math.abs(last.ts - candleTs) > maxGapMs) continue;
      oraclePrice = last.price;
    } else {
      const before = oracleSorted[lo - 1];
      const after = oracleSorted[lo];

      // Exact match — no interpolation needed
      if (after.ts === candleTs) {
        oraclePrice = after.price;
      } else {
        // Check gap to surrounding points
        if (candleTs - before.ts > maxGapMs || after.ts - candleTs > maxGapMs) continue;

        // Linear interpolation between surrounding oracle points
        const ratio = (candleTs - before.ts) / (after.ts - before.ts);
        oraclePrice = before.price + (after.price - before.price) * ratio;
      }
    }

    if (!Number.isFinite(oraclePrice) || oraclePrice <= 0) continue;

    if (invert) {
      closePrice = 1 / closePrice;
      oraclePrice = 1 / oraclePrice;
    }

    const spreadPct = ((closePrice - oraclePrice) / oraclePrice) * 100;

    result.push({
      timestamp: new Date(candleTs),
      poolPrice: closePrice,
      oraclePrice,
      spreadPct,
    });
  }

  return result;
}

function parseCandleResponse(
  candles: ApiCandle[],
  token0Decimals: number,
  token1Decimals: number,
): { timestamp: number; close: number }[] {
  return candles.map((c) => {
    const raw = c.closePrice;
    const isRaw = /^-?\d+$/.test(raw) && raw.length > 10;
    const close = isRaw
      ? sqrtPriceX96ToPrice(BigInt(raw), token0Decimals, token1Decimals)
      : Number(raw);
    return { timestamp: c.timestamp, close };
  }).filter((c) => Number.isFinite(c.close) && c.close > 0);
}

// ─── Main hook: 1 year daily overview ─────────────────────────────────────────

/**
 * Fetches 1 year of daily pool candle close prices and CoinGecko oracle prices,
 * then aligns them into a unified time series with spread calculation.
 */
export function usePriceSpreadData({
  poolAddress,
  token0Address,
  token0Decimals = 18,
  token1Decimals = 6,
  invert = false,
  enabled = true,
  spaceSlug,
}: UsePriceSpreadDataOptions) {
  const poolKey = normalizePoolKey(poolAddress);
  const isDemo = isDemoSpaceSlug(spaceSlug);
  const nowHour = stableHourBoundary();
  const oneYearAgo = nowHour - 365 * 86400;

  // 1. Fetch 1 year of daily candles
  const {
    data: candleData,
    isLoading: candlesLoading,
  } = useQuery<{ timestamp: number; close: number }[]>({
    queryKey: ["priceSpreadCandles", poolKey, oneYearAgo, nowHour, isDemo ? DEMO_SPACE_SLUG : null],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolKey,
        interval: "86400",
        startTime: String(oneYearAgo),
        endTime: String(nowHour),
      });
      if (isDemo) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch candles");
      const candles: ApiCandle[] = await res.json();
      return parseCandleResponse(candles, token0Decimals, token1Decimals);
    },
    enabled: enabled && !!poolAddress,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 2. Fetch 1 year of CoinGecko historical prices (daily granularity for >90d range)
  const {
    data: oracleData,
    isLoading: oracleLoading,
  } = useQuery<{ timestamp: number; price: number }[]>({
    queryKey: ["priceSpreadOracle", token0Address, oneYearAgo, nowHour, isDemo ? DEMO_SPACE_SLUG : null],
    queryFn: async () => {
      if (!token0Address) return [];
      const params = new URLSearchParams({
        tokenAddress: token0Address,
        startTime: String(oneYearAgo),
        endTime: String(nowHour),
      });
      if (isDemo) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/historical-prices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch historical prices");
      const json = await res.json();
      return json.prices ?? [];
    },
    enabled: enabled && !!token0Address,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // 3. Align daily candles with daily oracle, allow 24h gap
  const data = useMemo<SpreadDataPoint[]>(() => {
    if (!candleData || !oracleData) return [];
    return alignCandlesWithOracle(candleData, oracleData, invert, 24 * 3600 * 1000);
  }, [candleData, oracleData, invert]);

  return {
    data,
    isLoading: candlesLoading || oracleLoading,
  };
}

// ─── Zoom hook: hourly detail for a specific time window ──────────────────────

export interface UsePriceSpreadZoomOptions {
  poolAddress: string;
  token0Address?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  invert?: boolean;
  spaceSlug?: string | null;
  /** Zoom window start (unix seconds) */
  startTime: number | null;
  /** Zoom window end (unix seconds) */
  endTime: number | null;
}

/**
 * Fetches hourly candles + hourly CoinGecko oracle for a specific zoom window (≤90 days).
 * Only fires when startTime/endTime are set (i.e. user has zoomed into a deviation).
 */
export function usePriceSpreadZoom({
  poolAddress,
  token0Address,
  token0Decimals = 18,
  token1Decimals = 6,
  invert = false,
  spaceSlug,
  startTime,
  endTime,
}: UsePriceSpreadZoomOptions) {
  const poolKey = normalizePoolKey(poolAddress);
  const isDemo = isDemoSpaceSlug(spaceSlug);
  const isActive = startTime != null && endTime != null;

  // Round to hour boundaries for stable query keys
  const start = startTime != null ? Math.floor(startTime / 3600) * 3600 : 0;
  const end = endTime != null ? Math.ceil(endTime / 3600) * 3600 : 0;

  // Fetch hourly candles for zoom window
  const {
    data: candleData,
    isLoading: candlesLoading,
  } = useQuery<{ timestamp: number; close: number }[]>({
    queryKey: ["priceSpreadZoomCandles", poolKey, start, end, isDemo ? DEMO_SPACE_SLUG : null],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolKey,
        interval: "3600",
        startTime: String(start),
        endTime: String(end),
      });
      if (isDemo) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch zoom candles");
      const candles: ApiCandle[] = await res.json();
      return parseCandleResponse(candles, token0Decimals, token1Decimals);
    },
    enabled: isActive && !!poolAddress,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Fetch hourly oracle for zoom window (≤90 days → CoinGecko returns hourly)
  const {
    data: oracleData,
    isLoading: oracleLoading,
  } = useQuery<{ timestamp: number; price: number }[]>({
    queryKey: ["priceSpreadZoomOracle", token0Address, start, end, isDemo ? DEMO_SPACE_SLUG : null],
    queryFn: async () => {
      if (!token0Address) return [];
      const params = new URLSearchParams({
        tokenAddress: token0Address,
        startTime: String(start),
        endTime: String(end),
      });
      if (isDemo) params.set("space", DEMO_SPACE_SLUG);
      const res = await fetch(`/api/historical-prices?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch zoom oracle prices");
      const json = await res.json();
      return json.prices ?? [];
    },
    enabled: isActive && !!token0Address,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Align hourly candles with hourly oracle (2h max gap for hourly data)
  const data = useMemo<SpreadDataPoint[]>(() => {
    if (!isActive || !candleData || !oracleData) return [];
    return alignCandlesWithOracle(candleData, oracleData, invert, 2 * 3600 * 1000);
  }, [isActive, candleData, oracleData, invert]);

  return {
    data,
    isLoading: candlesLoading || oracleLoading,
    isActive,
  };
}
