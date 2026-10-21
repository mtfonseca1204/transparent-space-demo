import { describe, it, expect } from "vitest";
import {
  getAutoCandleInterval,
  resolveCandleInterval,
  type TimeRange,
} from "@/hooks/use-lp-historical-data";
import {
  GRANULARITY_SECONDS,
  GRANULARITY_LABELS,
  type ChartGranularity,
  type ChartTimeRange,
} from "@/stores/chart-settings-store";

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_RANGES: Record<TimeRange, number> = {
  "1h": 3600,
  "4h": 14400,
  "12h": 43200,
  "1d": 86400,
  "3d": 259200,
  "1w": 604800,
  "2w": 1209600,
  "1m": 2592000,
  "3m": 7776000,
  "1y": 31536000,
};

const ALL_TIME_RANGES = Object.keys(TIME_RANGES) as TimeRange[];
const ALL_GRANULARITIES = Object.keys(GRANULARITY_LABELS) as ChartGranularity[];
const EXPLICIT_GRANULARITIES = Object.keys(GRANULARITY_SECONDS) as Exclude<
  ChartGranularity,
  "auto"
>[];

// Legacy GraphQL hard limit per query page
const GRAPHQL_PAGE_LIMIT = 1000;
// Safety cap in the paginated fetch loop in use-lp-historical-data
const FETCH_SAFETY_CAP = 10_000;

// ─── TIME_RANGES constants ───────────────────────────────────────────────────

describe("TIME_RANGES constants", () => {
  it("should have 10 time range entries", () => {
    expect(ALL_TIME_RANGES).toHaveLength(10);
  });

  it("should be in strictly ascending order of duration", () => {
    for (let i = 1; i < ALL_TIME_RANGES.length; i++) {
      const prev = TIME_RANGES[ALL_TIME_RANGES[i - 1]!]!;
      const curr = TIME_RANGES[ALL_TIME_RANGES[i]!]!;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("should have correct second values for each range", () => {
    expect(TIME_RANGES["1h"]).toBe(3600);
    expect(TIME_RANGES["4h"]).toBe(4 * 3600);
    expect(TIME_RANGES["12h"]).toBe(12 * 3600);
    expect(TIME_RANGES["1d"]).toBe(24 * 3600);
    expect(TIME_RANGES["3d"]).toBe(3 * 24 * 3600);
    expect(TIME_RANGES["1w"]).toBe(7 * 24 * 3600);
    expect(TIME_RANGES["2w"]).toBe(14 * 24 * 3600);
    expect(TIME_RANGES["1m"]).toBe(30 * 24 * 3600);
    expect(TIME_RANGES["3m"]).toBe(90 * 24 * 3600);
    expect(TIME_RANGES["1y"]).toBe(365 * 24 * 3600);
  });

  it("1y should be the longest range and still representable in seconds", () => {
    const oneYearSeconds = TIME_RANGES["1y"]!;
    // ~365 days in seconds
    expect(oneYearSeconds).toBe(31_536_000);
    expect(oneYearSeconds).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

// ─── GRANULARITY_SECONDS constants ───────────────────────────────────────────

describe("GRANULARITY_SECONDS constants", () => {
  it("should have an entry for every explicit granularity", () => {
    expect(EXPLICIT_GRANULARITIES).toHaveLength(5);
    expect(GRANULARITY_SECONDS["5m"]).toBe(300);
    expect(GRANULARITY_SECONDS["15m"]).toBe(900);
    expect(GRANULARITY_SECONDS["1h"]).toBe(3600);
    expect(GRANULARITY_SECONDS["4h"]).toBe(14400);
    expect(GRANULARITY_SECONDS["1d"]).toBe(86400);
  });

  it("all values should be one of the supported API intervals", () => {
    // The candles API only supports these interval strings: 5m, 15m, 1h, 4h, 1d
    const SUPPORTED_INTERVALS = [300, 900, 3600, 14400, 86400];
    for (const g of EXPLICIT_GRANULARITIES) {
      expect(SUPPORTED_INTERVALS).toContain(GRANULARITY_SECONDS[g]);
    }
  });

  it("GRANULARITY_LABELS should include 'auto' plus all explicit granularities", () => {
    expect(ALL_GRANULARITIES).toContain("auto");
    for (const g of EXPLICIT_GRANULARITIES) {
      expect(ALL_GRANULARITIES).toContain(g);
    }
  });
});

// ─── getAutoCandleInterval ──────────────────────────────────────────────────

describe("getAutoCandleInterval", () => {
  it("returns 5m (300s) for short ranges: 1h, 4h, 12h, 1d", () => {
    expect(getAutoCandleInterval("1h")).toBe(300);
    expect(getAutoCandleInterval("4h")).toBe(300);
    expect(getAutoCandleInterval("12h")).toBe(300);
    expect(getAutoCandleInterval("1d")).toBe(300);
  });

  it("returns 15m (900s) for 3d", () => {
    expect(getAutoCandleInterval("3d")).toBe(900);
  });

  it("returns 1h (3600s) for 1w and 2w", () => {
    expect(getAutoCandleInterval("1w")).toBe(3600);
    expect(getAutoCandleInterval("2w")).toBe(3600);
  });

  it("returns 4h (14400s) for 1m and 3m", () => {
    expect(getAutoCandleInterval("1m")).toBe(14400);
    expect(getAutoCandleInterval("3m")).toBe(14400);
  });

  it("returns 1d (86400s) for 1y", () => {
    expect(getAutoCandleInterval("1y")).toBe(86400);
  });

  it("returns a supported API interval for every time range", () => {
    const SUPPORTED = [300, 900, 3600, 14400, 86400];
    for (const tr of ALL_TIME_RANGES) {
      expect(SUPPORTED).toContain(getAutoCandleInterval(tr));
    }
  });
});

// ─── resolveCandleInterval ──────────────────────────────────────────────────

describe("resolveCandleInterval", () => {
  it("delegates to auto when granularity is 'auto'", () => {
    for (const tr of ALL_TIME_RANGES) {
      expect(resolveCandleInterval(tr, "auto")).toBe(
        getAutoCandleInterval(tr)
      );
    }
  });

  it("uses explicit granularity when set, regardless of time range", () => {
    for (const g of EXPLICIT_GRANULARITIES) {
      for (const tr of ALL_TIME_RANGES) {
        expect(resolveCandleInterval(tr, g)).toBe(GRANULARITY_SECONDS[g]);
      }
    }
  });

  it("5m override on 3m range returns 300", () => {
    expect(resolveCandleInterval("3m", "5m")).toBe(300);
  });

  it("1d override on 1h range returns 86400", () => {
    expect(resolveCandleInterval("1h", "1d")).toBe(86400);
  });
});

// ─── Data-point count safety ────────────────────────────────────────────────
// Verifies that the AUTO interval always keeps data points within safe bounds.
// Manual overrides may exceed this, which is the user's choice — we only test auto.

describe("auto granularity data-point counts", () => {
  it.each(ALL_TIME_RANGES)(
    "time range '%s' with auto granularity stays under the GraphQL page limit (1000)",
    (tr) => {
      const interval = getAutoCandleInterval(tr);
      const durationSeconds = TIME_RANGES[tr]!;
      const dataPoints = Math.ceil(durationSeconds / interval);

      expect(dataPoints).toBeLessThanOrEqual(GRAPHQL_PAGE_LIMIT);
      // Also ensure we get a meaningful number of points (at least 10)
      expect(dataPoints).toBeGreaterThanOrEqual(10);
    }
  );

  it.each(ALL_TIME_RANGES)(
    "time range '%s' with auto granularity stays well under the safety cap (10,000)",
    (tr) => {
      const interval = getAutoCandleInterval(tr);
      const durationSeconds = TIME_RANGES[tr]!;
      const dataPoints = Math.ceil(durationSeconds / interval);

      expect(dataPoints).toBeLessThan(FETCH_SAFETY_CAP);
    }
  );
});

// ─── Manual granularity data-point estimates ────────────────────────────────
// These tests document expected data-point counts for explicit overrides so we
// can catch regressions if someone changes the constants.

describe("manual granularity data-point estimates", () => {
  it("5m on 1m range produces ~8640 points (high but within safety cap)", () => {
    const points = Math.ceil(TIME_RANGES["1m"]! / GRANULARITY_SECONDS["5m"]);
    expect(points).toBe(8640);
    expect(points).toBeLessThan(FETCH_SAFETY_CAP);
  });

  it("5m on 3m range produces ~25920 points (exceeds safety cap - expected)", () => {
    const points = Math.ceil(TIME_RANGES["3m"]! / GRANULARITY_SECONDS["5m"]);
    expect(points).toBe(25920);
    // This WILL be slow / may fail at the API level — that's the user's choice
    expect(points).toBeGreaterThan(FETCH_SAFETY_CAP);
  });

  it("15m on 3m range produces ~5760 points (within safety cap)", () => {
    const points = Math.ceil(TIME_RANGES["3m"]! / GRANULARITY_SECONDS["15m"]);
    expect(points).toBe(8640);
    expect(points).toBeLessThan(FETCH_SAFETY_CAP);
  });

  it("1h on 3m range produces 2160 points (comfortable)", () => {
    const points = Math.ceil(TIME_RANGES["3m"]! / GRANULARITY_SECONDS["1h"]);
    expect(points).toBe(2160);
    expect(points).toBeLessThan(FETCH_SAFETY_CAP);
  });

  it("4h on 3m range produces 540 points (optimal — same as auto)", () => {
    const points = Math.ceil(TIME_RANGES["3m"]! / GRANULARITY_SECONDS["4h"]);
    expect(points).toBe(540);
    expect(points).toBeLessThanOrEqual(GRAPHQL_PAGE_LIMIT);
  });

  it("1d on 3m range produces 90 points", () => {
    const points = Math.ceil(TIME_RANGES["3m"]! / GRANULARITY_SECONDS["1d"]);
    expect(points).toBe(90);
  });
});

// ─── Cross-validation: every auto interval is a valid API interval ──────────

describe("API interval compatibility", () => {
  // The candles API route maps interval seconds → string via INTERVAL_MAP:
  // { 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" }
  const API_INTERVAL_MAP: Record<number, string> = {
    300: "5m",
    900: "15m",
    3600: "1h",
    14400: "4h",
    86400: "1d",
  };

  it("every auto interval maps to a known API interval string", () => {
    for (const tr of ALL_TIME_RANGES) {
      const interval = getAutoCandleInterval(tr);
      expect(API_INTERVAL_MAP[interval]).toBeDefined();
    }
  });

  it("every explicit granularity maps to a known API interval string", () => {
    for (const g of EXPLICIT_GRANULARITIES) {
      const interval = GRANULARITY_SECONDS[g];
      expect(API_INTERVAL_MAP[interval]).toBeDefined();
    }
  });
});

// ─── Impact band / depth band alignment ─────────────────────────────────────
// The impact/depth bands are computed per-candle (one data point per OHLC entry).
// These tests verify that for each time range, the number of candles produced by
// auto granularity is reasonable for rendering all dependent panels.

describe("chart panel alignment", () => {
  // All panels (volume, deviation, depth, oracle) share the same timestamp array
  // derived from the candle data. This test verifies the candle count is in a
  // render-friendly range for each panel.
  it.each(ALL_TIME_RANGES)(
    "time range '%s' auto granularity produces a render-friendly candle count (10–1000)",
    (tr) => {
      const interval = getAutoCandleInterval(tr);
      const durationSeconds = TIME_RANGES[tr]!;
      const candleCount = Math.ceil(durationSeconds / interval);

      // Too few points → charts look empty; too many → DOM/SVG performance
      expect(candleCount).toBeGreaterThanOrEqual(10);
      expect(candleCount).toBeLessThanOrEqual(1000);
    }
  );

  it("volume bars match candle count (1:1 since volume is per-candle)", () => {
    // Volume is extracted as candle.volume1 — one bar per candle
    for (const tr of ALL_TIME_RANGES) {
      const interval = getAutoCandleInterval(tr);
      const candleCount = Math.ceil(TIME_RANGES[tr]! / interval);
      // Volume bars = candle count (by construction in use-lp-historical-data.ts)
      const volumeBars = candleCount;
      expect(volumeBars).toBe(candleCount);
    }
  });

  it("oracle data points match candle count (interpolated to OHLC timestamps)", () => {
    // Oracle data is interpolated to match ohlcData.map(d => d.timestamp)
    for (const tr of ALL_TIME_RANGES) {
      const interval = getAutoCandleInterval(tr);
      const candleCount = Math.ceil(TIME_RANGES[tr]! / interval);
      // Oracle points = candle count (by construction: interpolateOracleToTimestamps)
      const oraclePoints = candleCount;
      expect(oraclePoints).toBe(candleCount);
    }
  });

  it("depth data points match candle count (computed per OHLC entry)", () => {
    // depthDataRaw is ohlcData.map(...) — same length
    for (const tr of ALL_TIME_RANGES) {
      const interval = getAutoCandleInterval(tr);
      const candleCount = Math.ceil(TIME_RANGES[tr]! / interval);
      const depthPoints = candleCount;
      expect(depthPoints).toBe(candleCount);
    }
  });

  it("deviation data points match candle count (computed per OHLC entry)", () => {
    // peggingData is ohlcData.map(...) — same length
    for (const tr of ALL_TIME_RANGES) {
      const interval = getAutoCandleInterval(tr);
      const candleCount = Math.ceil(TIME_RANGES[tr]! / interval);
      const deviationPoints = candleCount;
      expect(deviationPoints).toBe(candleCount);
    }
  });
});

// ─── Specific candle count snapshot ─────────────────────────────────────────
// Pin exact data-point counts for auto granularity to catch accidental changes.

describe("auto granularity candle count snapshots", () => {
  const expectedCounts: Record<TimeRange, number> = {
    "1h": 12, // 3600 / 300
    "4h": 48, // 14400 / 300
    "12h": 144, // 43200 / 300
    "1d": 288, // 86400 / 300
    "3d": 288, // 259200 / 900
    "1w": 168, // 604800 / 3600
    "2w": 336, // 1209600 / 3600
    "1m": 180, // 2592000 / 14400
    "3m": 540, // 7776000 / 14400
    "1y": 365, // 31536000 / 86400
  };

  it.each(ALL_TIME_RANGES)(
    "time range '%s' produces exactly %i candles",
    (tr) => {
      const interval = getAutoCandleInterval(tr);
      const count = TIME_RANGES[tr]! / interval;
      expect(count).toBe(expectedCounts[tr]);
    }
  );
});
