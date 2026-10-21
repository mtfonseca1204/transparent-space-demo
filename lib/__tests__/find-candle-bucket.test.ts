import { describe, it, expect } from "vitest";
import { findCandleBucket } from "@/lib/find-candle-bucket";

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Generate evenly spaced candle timestamps starting at `startMs`. */
function makeCandleTimes(startMs: number, intervalMs: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => startMs + i * intervalMs);
}

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("findCandleBucket – edge cases", () => {
  it("returns -1 for an empty candle array", () => {
    expect(findCandleBucket([], 1000)).toBe(-1);
  });

  it("returns -1 when event is before the first candle", () => {
    const candles = makeCandleTimes(10_000, 5_000, 5);
    expect(findCandleBucket(candles, 9_999)).toBe(-1);
  });

  it("returns the first candle when event is exactly at the first timestamp", () => {
    const candles = makeCandleTimes(10_000, 5_000, 5);
    expect(findCandleBucket(candles, 10_000)).toBe(10_000);
  });

  it("returns the last candle when event is after all candles", () => {
    const candles = makeCandleTimes(10_000, 5_000, 5);
    // Last candle = 10_000 + 4*5_000 = 30_000
    expect(findCandleBucket(candles, 999_999)).toBe(30_000);
  });

  it("works with a single candle", () => {
    expect(findCandleBucket([5_000], 5_000)).toBe(5_000);
    expect(findCandleBucket([5_000], 6_000)).toBe(5_000);
    expect(findCandleBucket([5_000], 4_999)).toBe(-1);
  });
});

// ─── 5-minute candles (300s = 300_000ms) ─────────────────────────────────────

describe("findCandleBucket – 5-minute candles", () => {
  const INTERVAL_MS = 300_000; // 5 min
  const START = 1_700_000_000_000; // arbitrary epoch ms
  const candles = makeCandleTimes(START, INTERVAL_MS, 12); // 1 hour of 5-min candles

  it("event exactly on a candle boundary → that candle", () => {
    expect(findCandleBucket(candles, START + 3 * INTERVAL_MS)).toBe(
      START + 3 * INTERVAL_MS
    );
  });

  it("event between two candles → the earlier candle", () => {
    // Halfway between candle 2 and candle 3
    const midpoint = START + 2 * INTERVAL_MS + INTERVAL_MS / 2;
    expect(findCandleBucket(candles, midpoint)).toBe(START + 2 * INTERVAL_MS);
  });

  it("event 1ms before a candle → previous candle", () => {
    const justBefore = START + 5 * INTERVAL_MS - 1;
    expect(findCandleBucket(candles, justBefore)).toBe(START + 4 * INTERVAL_MS);
  });
});

// ─── 1-hour candles (3600s = 3_600_000ms) ────────────────────────────────────

describe("findCandleBucket – 1-hour candles", () => {
  const INTERVAL_MS = 3_600_000; // 1 hour
  const START = 1_700_000_000_000;
  const candles = makeCandleTimes(START, INTERVAL_MS, 168); // 1 week of hourly candles

  it("event at candle 100 → candle 100", () => {
    expect(findCandleBucket(candles, START + 100 * INTERVAL_MS)).toBe(
      START + 100 * INTERVAL_MS
    );
  });

  it("event 30 minutes after candle 50 → candle 50", () => {
    const thirtyMin = 1_800_000;
    expect(findCandleBucket(candles, START + 50 * INTERVAL_MS + thirtyMin)).toBe(
      START + 50 * INTERVAL_MS
    );
  });

  it("event at the very last candle → last candle", () => {
    expect(findCandleBucket(candles, START + 167 * INTERVAL_MS)).toBe(
      START + 167 * INTERVAL_MS
    );
  });
});

// ─── 4-hour candles (14400s = 14_400_000ms) ──────────────────────────────────

describe("findCandleBucket – 4-hour candles", () => {
  const INTERVAL_MS = 14_400_000; // 4 hours
  const START = 1_700_000_000_000;
  const candles = makeCandleTimes(START, INTERVAL_MS, 540); // 3 months of 4h candles

  it("event 2 hours into candle 0 → candle 0", () => {
    const twoHours = 7_200_000;
    expect(findCandleBucket(candles, START + twoHours)).toBe(START);
  });

  it("event exactly on candle 539 (last) → candle 539", () => {
    expect(findCandleBucket(candles, START + 539 * INTERVAL_MS)).toBe(
      START + 539 * INTERVAL_MS
    );
  });

  it("event between candle 200 and 201 → candle 200", () => {
    const midpoint = START + 200 * INTERVAL_MS + INTERVAL_MS / 2;
    expect(findCandleBucket(candles, midpoint)).toBe(START + 200 * INTERVAL_MS);
  });
});

// ─── Cross-interval consistency ──────────────────────────────────────────────
// Simulates the same event being bucketed across different granularities.

describe("findCandleBucket – cross-interval consistency", () => {
  const START = 1_700_000_000_000;
  const EVENT_TIME = START + 900_000; // 15 minutes after start

  it("5-min candles: event at +15min lands in candle index 3", () => {
    const candles = makeCandleTimes(START, 300_000, 100);
    expect(findCandleBucket(candles, EVENT_TIME)).toBe(START + 3 * 300_000);
  });

  it("15-min candles: event at +15min lands in candle index 1", () => {
    const candles = makeCandleTimes(START, 900_000, 100);
    expect(findCandleBucket(candles, EVENT_TIME)).toBe(START + 1 * 900_000);
  });

  it("1-hour candles: event at +15min lands in candle index 0", () => {
    const candles = makeCandleTimes(START, 3_600_000, 100);
    expect(findCandleBucket(candles, EVENT_TIME)).toBe(START);
  });

  it("4-hour candles: event at +15min lands in candle index 0", () => {
    const candles = makeCandleTimes(START, 14_400_000, 100);
    expect(findCandleBucket(candles, EVENT_TIME)).toBe(START);
  });

  it("1-day candles: event at +15min lands in candle index 0", () => {
    const candles = makeCandleTimes(START, 86_400_000, 100);
    expect(findCandleBucket(candles, EVENT_TIME)).toBe(START);
  });
});

// ─── All events land in a valid bucket ───────────────────────────────────────
// Simulates a batch of events spread across a candle range and verifies every
// event either gets a valid bucket or is correctly filtered out.

describe("findCandleBucket – batch event assignment", () => {
  const INTERVAL_MS = 3_600_000; // 1h candles
  const START = 1_700_000_000_000;
  const COUNT = 24; // 24 candles = 1 day
  const candles = makeCandleTimes(START, INTERVAL_MS, COUNT);
  const candleSet = new Set(candles);

  it("100 random events within the candle range all land on valid candle timestamps", () => {
    const END = START + (COUNT - 1) * INTERVAL_MS;
    for (let i = 0; i < 100; i++) {
      const evMs = START + Math.floor(Math.random() * (END - START + INTERVAL_MS));
      const bucket = findCandleBucket(candles, evMs);
      if (evMs < START) {
        expect(bucket).toBe(-1);
      } else {
        expect(candleSet.has(bucket)).toBe(true);
        // Bucket should be <= event time
        expect(bucket).toBeLessThanOrEqual(evMs);
      }
    }
  });

  it("events before, during, and after candle range are handled correctly", () => {
    // Before
    expect(findCandleBucket(candles, START - 1)).toBe(-1);
    // At first candle
    expect(findCandleBucket(candles, START)).toBe(START);
    // Mid-range
    const mid = START + 12 * INTERVAL_MS + 500_000;
    const midBucket = findCandleBucket(candles, mid);
    expect(candleSet.has(midBucket)).toBe(true);
    expect(midBucket).toBe(START + 12 * INTERVAL_MS);
    // After last candle
    const afterLast = START + COUNT * INTERVAL_MS;
    expect(findCandleBucket(candles, afterLast)).toBe(candles[candles.length - 1]);
  });
});

// ─── Regression: old hardcoded 5-min bucketing ───────────────────────────────
// Demonstrates why the old `Math.floor(ev.timestamp / 300) * 300 * 1000`
// approach failed for non-5-minute intervals.

describe("regression: hardcoded 5-min bucketing vs binary search", () => {
  const START = 1_700_000_000_000;

  /** Old broken bucketing logic (hardcoded 5-min). */
  function oldBucket(evTimestampSec: number): number {
    return Math.floor(evTimestampSec / 300) * 300 * 1000;
  }

  it("5-min candles aligned to epoch: old and new agree", () => {
    // Use a start time that sits on a 5-minute epoch boundary
    const alignedStart = Math.ceil(START / 300_000) * 300_000; // next 5-min boundary
    const candles = makeCandleTimes(alignedStart, 300_000, 12);
    // Event 7.5 minutes after start
    const evSec = alignedStart / 1000 + 450;
    const evMs = evSec * 1000;

    const oldResult = oldBucket(evSec);
    const newResult = findCandleBucket(candles, evMs);

    // When candles align to epoch 5-min boundaries, both methods agree
    expect(oldResult).toBe(newResult);
  });

  it("5-min candles NOT aligned to epoch: old bucketing diverges", () => {
    // Use a start time offset from any 5-min boundary
    const misalignedStart = START + 60_000; // +1 minute offset
    const candles = makeCandleTimes(misalignedStart, 300_000, 12);
    const evSec = misalignedStart / 1000 + 450;

    const oldResult = oldBucket(evSec);
    const newResult = findCandleBucket(candles, evSec * 1000);

    const candleSet = new Set(candles);
    // Old bucketing rounds to epoch boundary → misaligned with our candle times
    expect(candleSet.has(oldResult)).toBe(false);
    // New bucketing correctly finds the enclosing candle
    expect(candleSet.has(newResult)).toBe(true);
  });

  it("1-hour candles: old bucketing produces keys that DON'T match candle timestamps", () => {
    const candles = makeCandleTimes(START, 3_600_000, 24);
    // Event 30 minutes after start
    const evSec = START / 1000 + 1800;

    const oldResult = oldBucket(evSec);
    const newResult = findCandleBucket(candles, evSec * 1000);

    // Old bucketing rounds to nearest 5-min boundary → NOT a candle timestamp
    const candleSet = new Set(candles);
    // The old result rounds to a 5-min boundary that doesn't match any hourly candle
    // (unless by coincidence the first candle is exactly on a 5-min boundary, the
    //  mid-event bucket won't be the candle)
    expect(candleSet.has(oldResult)).toBe(false);
    // New bucketing correctly finds the enclosing candle
    expect(candleSet.has(newResult)).toBe(true);
    expect(newResult).toBe(START); // should be first candle
  });

  it("4-hour candles: old bucketing loses events", () => {
    const candles = makeCandleTimes(START, 14_400_000, 6); // 24h of 4h candles
    // Event 2 hours after start
    const evSec = START / 1000 + 7200;

    const oldResult = oldBucket(evSec);
    const newResult = findCandleBucket(candles, evSec * 1000);

    const candleSet = new Set(candles);
    // Old 5-min bucketing → key that doesn't exist in 4h candle map → event lost
    expect(candleSet.has(oldResult)).toBe(false);
    // New bucketing → correctly assigned to first candle
    expect(candleSet.has(newResult)).toBe(true);
    expect(newResult).toBe(START);
  });
});
