import { describe, expect, it } from "vitest";

import { computeRebalances, type RebalanceCandle } from "@/lib/lp-rebalances";
import type { LPEventData } from "@/lib/envio-client";

// With decimals 0/0, tickToPrice(tick) = 1.0001^tick.
// tick 0 -> price 1, tick 6932 -> price ~2. So range [0, 6932] is the price band [1, 2].
const RANGE_LOWER_TICK = 0;
const RANGE_UPPER_TICK = 6932;

function mint(ts: number, tickLower: number, tickUpper: number, owner = "0xabc"): LPEventData {
  return {
    id: `mint-${ts}`,
    owner,
    eventType: "MINT",
    timestamp: ts,
    liquidityDelta: "1000000",
    amount0: "0",
    amount1: "0",
    tickLower: String(tickLower),
    tickUpper: String(tickUpper),
  };
}

function burn(ts: number, tickLower: number, tickUpper: number, owner = "0xabc"): LPEventData {
  return {
    id: `burn-${ts}`,
    owner,
    eventType: "BURN",
    timestamp: ts,
    liquidityDelta: "-1000000",
    amount0: "0",
    amount1: "0",
    tickLower: String(tickLower),
    tickUpper: String(tickUpper),
  };
}

function decrease(
  ts: number,
  tickLower: number,
  tickUpper: number,
  magnitude: string,
  owner = "0xabc",
): LPEventData {
  return {
    id: `dec-${ts}`,
    owner,
    eventType: "DECREASE",
    timestamp: ts,
    liquidityDelta: `-${magnitude}`,
    amount0: "0",
    amount1: "0",
    tickLower: String(tickLower),
    tickUpper: String(tickUpper),
  };
}

const opts = { token0Decimals: 0, token1Decimals: 0, currentTick: 3000, nowSec: 10_000 };

describe("computeRebalances", () => {
  it("measures time out of range until the LP closes the position", () => {
    const events = [
      mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      burn(3000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
    ];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 }, // in range
      { t: 2000, close: 0.8 }, // out of range (below)
      { t: 2500, close: 0.7 }, // still below
    ];

    const { records, summary } = computeRebalances(events, candles, opts);

    expect(records).toHaveLength(1);
    expect(records[0].outSide).toBe("below");
    expect(records[0].outOfRangeAt).toBe(2000);
    expect(records[0].timeToRebalanceSec).toBe(1000); // 3000 - 2000
    expect(records[0].ongoing).toBe(false);
    expect(records[0].partial).toBe(false); // fully closed
    expect(summary.count).toBe(1);
    expect(summary.medianTimeToRebalanceSec).toBe(1000);
  });

  it("counts a partial withdrawal of an out-of-range position as a rebalance", () => {
    const events = [
      mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      // Trim ~half the liquidity while out of range, but keep holding the rest.
      decrease(2600, RANGE_LOWER_TICK, RANGE_UPPER_TICK, "400000"),
    ];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 }, // in range
      { t: 2000, close: 0.8 }, // out of range (below)
      { t: 5000, close: 0.7 }, // still below
    ];
    // currentTick below the range -> position is still out of range now.
    const { records, summary } = computeRebalances(events, candles, {
      ...opts,
      currentTick: RANGE_LOWER_TICK - 100,
    });

    expect(records).toHaveLength(1);
    expect(records[0].ongoing).toBe(false); // they reacted
    expect(records[0].partial).toBe(true); // but only trimmed
    expect(records[0].closedAt).toBeNull(); // still holding
    expect(records[0].timeToRebalanceSec).toBe(600); // 2600 - 2000
    expect(summary.count).toBe(1);
    expect(summary.ongoingCount).toBe(0);
  });

  it("detects an out-of-range wick via candle low even when the close is in range", () => {
    const events = [
      mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      burn(3000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
    ];
    // Close stays in range, but the bucket low (0.8) traded below the 1.0 bound.
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5, high: 1.6, low: 1.4 },
      { t: 2500, close: 1.2, high: 1.3, low: 0.8 }, // wicked below, closed in range
    ];

    const { records } = computeRebalances(events, candles, opts);
    expect(records).toHaveLength(1);
    expect(records[0].outSide).toBe("below"); // caught by low, not close
    expect(records[0].closedInRange).toBe(false); // forced, not proactive
    expect(records[0].outOfRangeAt).toBe(2500);
  });

  it("records a position closed while in range as a proactive rebalance", () => {
    const events = [
      mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      burn(3000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
    ];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 0.8 }, // briefly below
      { t: 2000, close: 1.5 }, // back in range before close
    ];

    const { records } = computeRebalances(events, candles, opts);
    expect(records).toHaveLength(1);
    expect(records[0].closedInRange).toBe(true);
    expect(records[0].outOfRangeAt).toBeNull();
    expect(records[0].timeToRebalanceSec).toBeNull();
    expect(records[0].rebalancedAt).toBe(3000);
  });

  it("labels an open line with its position NFT id when the range matches", () => {
    const events = [mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK)];
    const candles: RebalanceCandle[] = [{ t: 1100, close: 1.5 }];
    const { records } = computeRebalances(events, candles, {
      ...opts,
      currentTick: 3000,
      currentPositions: [{ tickLower: RANGE_LOWER_TICK, tickUpper: RANGE_UPPER_TICK, tokenId: "2941" }],
    });
    expect(records).toHaveLength(1);
    expect(records[0].isHold).toBe(true);
    expect(records[0].tokenId).toBe("2941");
  });

  it("records an untouched in-range open position as a hold", () => {
    const events = [mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK)];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 }, // in range, never touched
      { t: 2000, close: 1.6 },
    ];
    // currentTick in range, no removals -> a hold (open position, no rebalance).
    const { records, summary } = computeRebalances(events, candles, { ...opts, currentTick: 3000 });
    expect(records).toHaveLength(1);
    expect(records[0].isHold).toBe(true);
    expect(records[0].closedAt).toBeNull();
    expect(records[0].rebalancedAt).toBeNull();
    expect(summary.holdCount).toBe(1);
    expect(summary.count).toBe(0);
  });

  it("records an open, currently-out-of-range position as ongoing", () => {
    const events = [mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK)];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 },
      { t: 5000, close: 2.5 }, // above range
    ];
    // currentTick above the upper tick -> currently out of range.
    const { records, summary } = computeRebalances(events, candles, {
      ...opts,
      currentTick: RANGE_UPPER_TICK + 100,
    });

    expect(records).toHaveLength(1);
    expect(records[0].ongoing).toBe(true);
    expect(records[0].partial).toBe(false);
    expect(records[0].outSide).toBe("above");
    expect(records[0].timeToRebalanceSec).toBe(opts.nowSec - 5000);
    expect(summary.ongoingCount).toBe(1);
    expect(summary.count).toBe(0);
  });

  it("drives open bars from current positions, not stale event lots", () => {
    // A mint with no observed close (e.g. the closing event was truncated).
    const events = [mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK)];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 },
      { t: 5000, close: 2.5 }, // above range
    ];
    const aboveTickOpts = { ...opts, currentTick: RANGE_UPPER_TICK + 100 };

    // No position list supplied → falls back to the event-reconstructed open lot.
    expect(computeRebalances(events, candles, aboveTickOpts).records).toHaveLength(1);

    // Position list provided but it does NOT hold this range → no open bar for it.
    const notHeld = computeRebalances(events, candles, { ...aboveTickOpts, currentPositions: [] });
    expect(notHeld.records).toHaveLength(0);

    // Position list holds this range → one bar for that NFT (currently out of range).
    const held = computeRebalances(events, candles, {
      ...aboveTickOpts,
      currentPositions: [{ tickLower: RANGE_LOWER_TICK, tickUpper: RANGE_UPPER_TICK, tokenId: "77" }],
    });
    expect(held.records).toHaveLength(1);
    expect(held.records[0].ongoing).toBe(true);
    expect(held.records[0].tokenId).toBe("77");
  });

  it("keeps fully-closed rebalances regardless of current positions", () => {
    const events = [
      mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      burn(3000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
    ];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 },
      { t: 2000, close: 0.8 },
    ];
    // Closed positions aren't subject to the current-positions anchor.
    const { records } = computeRebalances(events, candles, { ...opts, currentPositions: [] });
    expect(records).toHaveLength(1);
    expect(records[0].closedAt).toBe(3000);
  });

  it("captures the re-centered range when the LP re-mints near the close", () => {
    const events = [
      mint(1000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      burn(3000, RANGE_LOWER_TICK, RANGE_UPPER_TICK),
      mint(3050, 6000, 13000), // re-centered higher
    ];
    const candles: RebalanceCandle[] = [
      { t: 1100, close: 1.5 },
      { t: 2000, close: 2.4 }, // above
    ];

    const { records } = computeRebalances(events, candles, opts);
    // The closed position is a forced rebalance; the re-mint shows up as a hold.
    const forced = records.find((r) => !r.isHold && r.outOfRangeAt != null);
    expect(forced?.newTickLower).toBe(6000);
    expect(forced?.newTickUpper).toBe(13000);
  });
});
