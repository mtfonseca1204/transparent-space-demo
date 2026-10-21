import { describe, expect, it } from "vitest";

import {
  buildDuneNetFlowChartData,
  buildNetFlowChartData,
  type DuneFlowToUsersResponse,
} from "@/lib/xstocks-net-flow";
import type { XstocksMakerVolumeRow } from "@/lib/xstocks-maker-volume-chart";

function rfq(overrides: Partial<XstocksMakerVolumeRow>): XstocksMakerVolumeRow {
  return {
    day: "2026-04-24",
    chain: "evm",
    provider: "1inch",
    label: "1inch",
    maker_address: "0xmaker",
    symbol: "TSLAx",
    direction: "in",
    volume_token: "1",
    volume_usd: "1000",
    price_usd: "1000",
    price_source: "latest_pool_price",
    tx_count: 1,
    updated_at: "2026-04-26T20:00:00.000Z",
    ...overrides,
  };
}

describe("buildNetFlowChartData", () => {
  it("builds Dune project-stacked flow data with cumulative project totals", () => {
    const response: DuneFlowToUsersResponse = {
      rows: [
        {
          day: "2026-04-23",
          project: "Raydium",
          projectSlug: "raydium",
          buyVolumeUsd: "100",
          sellVolumeUsd: "25",
          netFlowUsd: "75",
          grossVolumeUsd: "125",
          cumulativeNetFlowUsd: "300",
          cumulativeBuyUsd: "400",
          cumulativeSellUsd: "100",
        },
        {
          day: "2026-04-23",
          project: "New Venue",
          projectSlug: "new-venue",
          buyVolumeUsd: "40",
          sellVolumeUsd: "70",
          netFlowUsd: "-30",
          grossVolumeUsd: "110",
          cumulativeNetFlowUsd: "-20",
          cumulativeBuyUsd: "90",
          cumulativeSellUsd: "110",
        },
        {
          day: "2026-04-24",
          project: "Raydium",
          projectSlug: "raydium",
          buyVolumeUsd: "50",
          sellVolumeUsd: "10",
          netFlowUsd: "40",
          grossVolumeUsd: "60",
          cumulativeNetFlowUsd: "340",
          cumulativeBuyUsd: "450",
          cumulativeSellUsd: "110",
        },
      ],
      projects: [
        {
          project: "Raydium",
          projectSlug: "raydium",
          cumulativeNetFlowUsd: "340",
          cumulativeBuyUsd: "450",
          cumulativeSellUsd: "110",
          cumulativeGrossUsd: "560",
        },
        {
          project: "New Venue",
          projectSlug: "new-venue",
          cumulativeNetFlowUsd: "-20",
          cumulativeBuyUsd: "90",
          cumulativeSellUsd: "110",
          cumulativeGrossUsd: "200",
        },
      ],
      totals: {
        buyVolumeUsd: 540,
        sellVolumeUsd: 220,
        netFlowUsd: 320,
        grossVolumeUsd: 760,
        rowCount: 3,
      },
      meta: {
        source: "dune",
        queryId: 7549048,
        range: "all",
        days: null,
        startDate: null,
        endDate: "2026-04-24",
        latestDay: "2026-04-24",
        lastExecutionId: "exec-1",
        lastExecutionState: "QUERY_STATE_COMPLETED",
        lastExecutionEndedAt: "2026-04-24T00:00:00.000Z",
        lastUpdatedAt: "2026-04-24T00:00:00.000Z",
        executionCostCredits: "200",
        error: null,
      },
    };

    const result = buildDuneNetFlowChartData(response)!;

    expect(result.days).toHaveLength(2);
    expect(result.series.map((series) => series.source)).toEqual([
      "raydium",
      "new-venue",
    ]);
    expect(result.series[0]).toMatchObject({
      label: "Raydium",
      netUsd: 340,
      sellUsd: 450,
      buyUsd: 110,
    });
    expect(result.series[1].label).toBe("New Venue");
    expect(result.days[0].bySource.raydium).toBe(75);
    expect(result.days[0].bySource["new-venue"]).toBe(-30);
    expect(result.days[0].bySourceDetail.raydium.sellUsd).toBe(100);
    expect(result.days[0].bySourceDetail.raydium.buyUsd).toBe(25);
    expect(result.days[0].cumulativeUsd).toBe(280);
    expect(result.days[1].cumulativeUsd).toBe(320);
    expect(result.totals.netUsd).toBe(320);

    const reorderedResult = buildDuneNetFlowChartData({
      ...response,
      projects: [...response.projects].reverse(),
    })!;
    expect(
      reorderedResult.series.find((series) => series.source === "new-venue")?.color
    ).toBe(result.series.find((series) => series.source === "new-venue")?.color);
  });

  it("computes net flow into user circulation from RFQ rows (out − in, USDC excluded)", () => {
    const result = buildNetFlowChartData({
      rfqRows: [
        // Flowdesk RFQ via 1inch: maker bought 1000 worth of TSLAx back from users
        rfq({ provider: "1inch", direction: "in", volume_usd: "1000" }),
        // Flowdesk via 0x: aggregator-style mirror — should net to zero
        rfq({ provider: "0x", direction: "in", volume_usd: "500" }),
        rfq({ provider: "0x", direction: "out", volume_usd: "500" }),
        // Tokka via cowswap: users acquired 800 of NVDAx
        rfq({
          provider: "cowswap",
          symbol: "NVDAx",
          direction: "out",
          volume_usd: "800",
        }),
        // Tokka via jupz (canonical "jupiterz" in API): maker bought 200 of GLDx back from users
        rfq({
          provider: "jupiterz",
          symbol: "GLDx",
          direction: "in",
          volume_usd: "200",
        }),
        // USDC counterpart row — must be skipped to avoid double-counting
        rfq({
          provider: "1inch",
          symbol: "USDC",
          direction: "out",
          volume_usd: "1000",
        }),
        // Unknown provider — should be ignored
        rfq({ provider: "kyberswap", direction: "in", volume_usd: "999" }),
      ],
      poolDays: null,
      startDate: "2026-04-24",
      endDate: "2026-04-24",
    });

    expect(result.days).toHaveLength(1);
    const day = result.days[0];
    // Flowdesk: -1000 (in via 1inch) + 500-500 (mirror via 0x) = -1000
    expect(day.bySource["rfq-flowdesk"]).toBeCloseTo(-1000, 6);
    expect(day.bySource["rfq-cowswap"]).toBeCloseTo(800, 6);
    expect(day.bySource["rfq-jupz"]).toBeCloseTo(-200, 6);
    expect(day.bySource.pools).toBe(0);
    expect(day.netUsd).toBeCloseTo(-400, 6);
    expect(day.cumulativeUsd).toBeCloseTo(-400, 6);
    // Per-source detail breakdown should retain MM/pool buy/sell separately.
    expect(day.bySourceDetail["rfq-flowdesk"].buyUsd).toBeCloseTo(1500, 6);
    expect(day.bySourceDetail["rfq-flowdesk"].sellUsd).toBeCloseTo(500, 6);
    expect(day.bySourceDetail["rfq-cowswap"].buyUsd).toBeCloseTo(0, 6);
    expect(day.bySourceDetail["rfq-cowswap"].sellUsd).toBeCloseTo(800, 6);
    expect(day.bySourceDetail["rfq-jupz"].buyUsd).toBeCloseTo(200, 6);
    expect(day.bySourceDetail["rfq-jupz"].sellUsd).toBeCloseTo(0, 6);
  });

  it("merges pool buy/sell into the pools series and accumulates over days", () => {
    const result = buildNetFlowChartData({
      rfqRows: [
        rfq({ day: "2026-04-24", provider: "1inch", direction: "in", volume_usd: "1000" }),
        rfq({ day: "2026-04-25", provider: "1inch", direction: "out", volume_usd: "300" }),
      ],
      poolDays: [
        { day: "2026-04-24", buyUsd: 5000, sellUsd: 7000 },
        { day: "2026-04-25", buyUsd: 1000, sellUsd: 200 },
      ],
      startDate: "2026-04-24",
      endDate: "2026-04-25",
    });

    expect(result.days).toHaveLength(2);
    const [d0, d1] = result.days;
    // Day 1: FD -1000, Pools 7000-5000=+2000 → net +1000, cumulative +1000
    expect(d0.bySource["rfq-flowdesk"]).toBeCloseTo(-1000, 6);
    expect(d0.bySource.pools).toBeCloseTo(2000, 6);
    expect(d0.netUsd).toBeCloseTo(1000, 6);
    expect(d0.cumulativeUsd).toBeCloseTo(1000, 6);
    // Day 2: FD +300, Pools 200-1000=-800 → net -500, cumulative +500
    expect(d1.bySource["rfq-flowdesk"]).toBeCloseTo(300, 6);
    expect(d1.bySource.pools).toBeCloseTo(-800, 6);
    expect(d1.netUsd).toBeCloseTo(-500, 6);
    expect(d1.cumulativeUsd).toBeCloseTo(500, 6);

    // Series totals
    const fd = result.series.find((s) => s.source === "rfq-flowdesk")!;
    const pools = result.series.find((s) => s.source === "pools")!;
    expect(fd.netUsd).toBeCloseTo(-700, 6);
    expect(pools.netUsd).toBeCloseTo(1200, 6);
    expect(result.totals.netUsd).toBeCloseTo(500, 6);
  });

  it("treats null volume_usd as missing, not zero, and counts it", () => {
    const result = buildNetFlowChartData({
      rfqRows: [
        rfq({ provider: "1inch", direction: "in", volume_usd: "200" }),
        rfq({ provider: "1inch", direction: "in", volume_usd: null }),
      ],
      poolDays: null,
      startDate: "2026-04-24",
      endDate: "2026-04-24",
    });
    expect(result.days[0].bySource["rfq-flowdesk"]).toBeCloseTo(-200, 6);
    expect(result.rfqMissingUsdRows).toBe(1);
  });

  it("uses on-chain Flowdesk override and drops indexer Flowdesk-mapped rows", () => {
    const result = buildNetFlowChartData({
      rfqRows: [
        // Indexer rows for Flowdesk-mapped providers — should be IGNORED
        // when an on-chain override is provided (otherwise we'd double-count
        // the wash data on top of the real direction).
        rfq({ provider: "1inch", direction: "in", volume_usd: "1000" }),
        rfq({ provider: "1inch", direction: "out", volume_usd: "1000" }),
        rfq({ provider: "0x", direction: "in", volume_usd: "500" }),
        rfq({ provider: "0x", direction: "out", volume_usd: "500" }),
        rfq({ provider: "bebop", direction: "in", volume_usd: "200" }),
        // CoW row for the same day — must STILL be counted (not Flowdesk).
        rfq({ provider: "cowswap", direction: "out", volume_usd: "750" }),
      ],
      poolDays: null,
      flowdeskRfqDays: [
        { day: "2026-04-24", buyUsd: 12_000, sellUsd: 8_000 },
      ],
      startDate: "2026-04-24",
      endDate: "2026-04-24",
    });

    const day = result.days[0];
    // Flowdesk: only the on-chain override counts, not the indexer wash rows.
    // From-user view: sellUsd - buyUsd = 8000 - 12000 = -4000
    expect(day.bySource["rfq-flowdesk"]).toBeCloseTo(-4000, 6);
    expect(day.bySourceDetail["rfq-flowdesk"].buyUsd).toBeCloseTo(12000, 6);
    expect(day.bySourceDetail["rfq-flowdesk"].sellUsd).toBeCloseTo(8000, 6);
    // CoW row from indexer should still show up.
    expect(day.bySource["rfq-cowswap"]).toBeCloseTo(750, 6);
  });

  it("does not clip RFQ days when pool metadata covers a narrower window", () => {
    const result = buildNetFlowChartData({
      rfqRows: [
        rfq({ day: "2026-04-22", provider: "jupiterz", direction: "out", volume_usd: "50" }),
        rfq({ day: "2026-04-24", provider: "jupiterz", direction: "in", volume_usd: "20" }),
      ],
      poolDays: [{ day: "2026-04-24", buyUsd: 100, sellUsd: 0 }],
      startDate: "2026-04-24",
      endDate: "2026-04-24",
    });

    expect(result.startDate).toBe("2026-04-22");
    expect(result.endDate).toBe("2026-04-24");
    expect(result.days.map((day) => day.day)).toEqual([
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
    ]);
    expect(result.days[0].bySource["rfq-jupz"]).toBeCloseTo(50, 6);
    expect(result.days[2].bySource.pools).toBeCloseTo(-100, 6);
  });
});
