import { describe, expect, it } from "vitest";

import {
  buildHip3BookLadderRows,
  buildHip3DepthRows,
  getHip3LiveState,
  getUsableHip3Markouts,
  selectRecentHip3AccountHistoryRows,
  selectRecentHip3FillHourlyRows,
  selectRecentHip3HourlyRows,
  type Hip3AccountHistoryRow,
  type Hip3BookSample,
  type Hip3FillHourlyRow,
  type Hip3HourlyRow,
} from "@/lib/hip3-market-quality";

const BOOK: Hip3BookSample = {
  sampled_at: "2026-05-25T20:00:00.000Z",
  best_bid_px: 99.5,
  best_ask_px: 100.5,
  mid_px: 100,
  mark_px: 0,
  spread_bps: 100,
  depth_usd: {
    "10bps": { bid: 12_000, ask: 11_000 },
    "25bps": { bid: 20_000, ask: 18_000 },
    "50bps": { bid: 30_000, ask: 24_000 },
    "100bps": { bid: 45_000, ask: 42_000 },
  },
  raw_bids: [
    { px: "99.5", sz: "2", n: 1 },
    { px: "99", sz: "3", n: 1 },
  ],
  raw_asks: [
    { px: "100.5", sz: "4", n: 1 },
    { px: "101", sz: "5", n: 1 },
  ],
};

describe("HIP-3 market quality frontend helpers", () => {
  it("builds depth rows in display order with totals", () => {
    expect(buildHip3DepthRows(BOOK)).toEqual([
      { band: "10bps", bandBps: 10, bidUsd: 12_000, askUsd: 11_000, totalUsd: 23_000 },
      { band: "25bps", bandBps: 25, bidUsd: 20_000, askUsd: 18_000, totalUsd: 38_000 },
      { band: "50bps", bandBps: 50, bidUsd: 30_000, askUsd: 24_000, totalUsd: 54_000 },
      { band: "100bps", bandBps: 100, bidUsd: 45_000, askUsd: 42_000, totalUsd: 87_000 },
    ]);
  });

  it("builds a bid/ask ladder with USD notional", () => {
    expect(buildHip3BookLadderRows(BOOK, 1)).toEqual([
      {
        index: 0,
        bidPx: 99.5,
        bidSz: 2,
        bidNotionalUsd: 199,
        askPx: 100.5,
        askSz: 4,
        askNotionalUsd: 402,
      },
    ]);
  });

  it("classifies live, thin, stale, and empty book states", () => {
    const nowMs = Date.parse("2026-05-25T20:00:30.000Z");

    expect(getHip3LiveState({ latestBook: BOOK, nowMs })).toBe("live");
    expect(
      getHip3LiveState({
        latestBook: {
          ...BOOK,
          depth_usd: { ...BOOK.depth_usd, "50bps": { bid: 9_999, ask: 20_000 } },
        },
        nowMs,
      })
    ).toBe("thin");
    expect(getHip3LiveState({ latestBook: BOOK, nowMs: Date.parse("2026-05-25T20:04:00.000Z") })).toBe(
      "stale"
    );
    expect(getHip3LiveState({ latestBook: null, nowMs })).toBe("empty");
  });

  it("selects the newest hourly rows without reordering", () => {
    const rows = Array.from({ length: 4 }, (_, index): Hip3HourlyRow => ({
      hour: `2026-05-25T0${index}:00:00.000Z`,
      expected_samples: 3600,
      sample_count: index,
      sampling_uptime_pct: index,
      quote_up_samples: index,
      quote_uptime_pct: index,
      avg_spread_bps: null,
      avg_bid_depth_usd: null,
      avg_ask_depth_usd: null,
      latest_sample_at: null,
    }));

    expect(selectRecentHip3HourlyRows(rows, 2).map((row) => row.hour)).toEqual([
      "2026-05-25T02:00:00.000Z",
      "2026-05-25T03:00:00.000Z",
    ]);
  });

  it("selects recent MM account and fill rows without reordering", () => {
    const accountRows = Array.from({ length: 3 }, (_, index): Hip3AccountHistoryRow => ({
      hour: `2026-05-25T0${index}:00:00.000Z`,
      sampled_at: `2026-05-25T0${index}:30:00.000Z`,
      user_address: "0x01e187f06c9e7871986f0ed4e9d2bf528af9b2cf",
      account_value_usd: 100_000 + index,
      margin_used_usd: 50_000,
      position_size: -100,
      position_value_usd: 40_000,
      entry_px: 420,
      unrealized_pnl_usd: index,
      open_order_count: index,
      bid_open_order_count: index,
      ask_open_order_count: index,
    }));
    const fillRows = Array.from({ length: 3 }, (_, index): Hip3FillHourlyRow => ({
      hour: `2026-05-25T0${index}:00:00.000Z`,
      fill_count: index,
      maker_fill_count: index,
      taker_fill_count: 0,
      buy_fill_count: index,
      sell_fill_count: 0,
      notional_usd: index * 1000,
      maker_notional_usd: index * 1000,
      taker_notional_usd: 0,
      fee_usd: index,
      closed_pnl_usd: index,
      latest_fill_at: null,
    }));

    expect(selectRecentHip3AccountHistoryRows(accountRows, 2).map((row) => row.hour)).toEqual([
      "2026-05-25T01:00:00.000Z",
      "2026-05-25T02:00:00.000Z",
    ]);
    expect(selectRecentHip3FillHourlyRows(fillRows, 2).map((row) => row.hour)).toEqual([
      "2026-05-25T01:00:00.000Z",
      "2026-05-25T02:00:00.000Z",
    ]);
  });

  it("filters unusable markouts caused by zero reference prices", () => {
    expect(
      getUsableHip3Markouts([
        {
          horizon_ms: 60_000,
          side: "buy",
          fill_count: 1,
          avg_markout_bps: -10_000,
          p50_markout_bps: -10_000,
        },
        {
          horizon_ms: 60_000,
          side: "sell",
          fill_count: 2,
          avg_markout_bps: "12.5",
          p50_markout_bps: "10.1",
        },
      ])
    ).toEqual([
      {
        horizon_ms: 60_000,
        side: "sell",
        fill_count: 2,
        avg_markout_bps: "12.5",
        p50_markout_bps: "10.1",
      },
    ]);
  });
});
