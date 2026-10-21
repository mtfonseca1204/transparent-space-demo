import { describe, expect, it } from "vitest";

import {
  buildXstocksMakerVolumeChart,
  type XstocksMakerVolumeResponse,
  type XstocksMakerVolumeRow,
} from "@/lib/xstocks-maker-volume-chart";

function row(overrides: Partial<XstocksMakerVolumeRow>): XstocksMakerVolumeRow {
  return {
    day: "2026-04-24",
    chain: "evm",
    provider: "bebop",
    label: "Bebop",
    maker_address: "0xmaker",
    symbol: "TSLAx",
    direction: "in",
    volume_token: "1",
    volume_usd: "100",
    price_usd: "100",
    price_source: "latest_pool_price",
    tx_count: 1,
    updated_at: "2026-04-26T20:00:00.000Z",
    ...overrides,
  };
}

function response(rows: XstocksMakerVolumeRow[]): XstocksMakerVolumeResponse {
  return {
    data: rows,
    meta: {
      applied_filters: {
        start_date: "2026-04-23",
        end_date: "2026-04-25",
        days: 3,
      },
    },
  };
}

describe("xStocks maker volume chart reducer", () => {
  it("aggregates gross USD volume by UTC day and normalized provider", () => {
    const chart = buildXstocksMakerVolumeChart(
      response([
        row({ provider: "bebop", direction: "in", volume_usd: "100" }),
        row({ provider: "bebop", direction: "out", volume_usd: "25" }),
        row({ provider: "oneinch", volume_usd: "75" }),
      ])
    );

    const day = chart.days.find((item) => item.day === "2026-04-24");

    expect(day?.totalUsd).toBe(200);
    expect(day?.providerUsd.bebop).toBe(125);
    expect(day?.providerUsd["1inch"]).toBe(75);
    expect(chart.totalUsd).toBe(200);
    expect(chart.pricedRows).toBe(3);
  });

  it("hides jupz rows from the displayed maker-volume chart", () => {
    const chart = buildXstocksMakerVolumeChart(
      response([
        row({ provider: "jupz", volume_usd: "75" }),
        row({ provider: "jupiterz", volume_usd: null }),
        row({ provider: "bebop", volume_usd: "25" }),
      ])
    );

    const day = chart.days.find((item) => item.day === "2026-04-24");

    expect(chart.totalUsd).toBe(25);
    expect(chart.pricedRows).toBe(1);
    expect(chart.missingUsdRows).toBe(0);
    expect(day?.totalUsd).toBe(25);
    expect(day?.missingUsdRows).toBe(0);
    expect(day?.providerUsd.jupiterz).toBeUndefined();
    expect(chart.providers.map((provider) => provider.provider)).toEqual(["bebop"]);
  });

  it("excludes missing or invalid USD rows and tracks missing counts", () => {
    const chart = buildXstocksMakerVolumeChart(
      response([
        row({ volume_usd: null }),
        row({ provider: "cowswap", volume_usd: "bad-number" }),
        row({ provider: "1inch", volume_usd: "40" }),
      ])
    );

    const day = chart.days.find((item) => item.day === "2026-04-24");

    expect(chart.totalUsd).toBe(40);
    expect(chart.missingUsdRows).toBe(2);
    expect(day?.missingUsdRows).toBe(2);
    expect(chart.providers.map((provider) => provider.provider)).toEqual(["1inch"]);
  });

  it("fills the requested date range even when a day has no priced rows", () => {
    const chart = buildXstocksMakerVolumeChart(
      response([row({ day: "2026-04-24", volume_usd: "10" })])
    );

    expect(chart.days.map((day) => day.day)).toEqual([
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
    ]);
    expect(chart.days[0].totalUsd).toBe(0);
    expect(chart.days[2].totalUsd).toBe(0);
  });

  it("orders known providers consistently before unknown venues", () => {
    const chart = buildXstocksMakerVolumeChart(
      response([
        row({ provider: "venue-z", volume_usd: "5" }),
        row({ provider: "0x", volume_usd: "5" }),
        row({ provider: "cowswap", volume_usd: "5" }),
        row({ provider: "bebop", volume_usd: "5" }),
        row({ provider: "kyber", volume_usd: "5" }),
        row({ provider: "jupiterz", volume_usd: "5" }),
      ])
    );

    expect(chart.providers.map((provider) => provider.provider)).toEqual([
      "cowswap",
      "bebop",
      "kyberswap",
      "0x",
      "venue-z",
    ]);
  });
});
