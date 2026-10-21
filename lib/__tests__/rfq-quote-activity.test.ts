import { describe, expect, it } from "vitest";

import {
  buildQuoteActivityAssetSummaries,
  formatQuoteActivityAge,
  quoteActivityTone,
  quoteVenueActivityTone,
  type QuoteActivityProviderRow,
} from "@/lib/rfq-quote-activity";

const baseHourly = [
  { hour: "2026-05-11T15:00:00.000Z", expected: 7, success: 7, failed: 0 },
  {
    hour: "2026-05-11T16:00:00.000Z",
    expected: 7,
    success: 1,
    failed: 6,
    failure_reason: "partial_failure",
    error_codes: ["400"],
    error_sample: "Failed to get quotes",
  },
];

describe("rfq quote activity transforms", () => {
  it("groups provider rows by asset and sorts core20 rank before tails", () => {
    const rows: QuoteActivityProviderRow[] = [
      {
        asset: "SPYx",
        group: "core20",
        provider: "jupz",
        uptime_pct: 100,
        expected_slots: 14,
        success_slots: 14,
        failed_slots: 0,
        latest_quote_at: "2026-05-11T16:08:00.000Z",
        latest_success_at: "2026-05-11T16:08:00.000Z",
        directions: ["forward"],
        notionals_usd: ["1000"],
        hourly: baseHourly.map((hour) => ({ ...hour, success: hour.expected, failed: 0 })),
        breaches: [],
      },
      {
        asset: "CVXx",
        group: "core20",
        provider: "jupz",
        uptime_pct: 68.4,
        expected_slots: 100,
        success_slots: 68,
        failed_slots: 32,
        latest_quote_at: "2026-05-11T16:08:00.000Z",
        latest_success_at: "2026-05-11T16:08:00.000Z",
        directions: ["forward"],
        notionals_usd: ["1000"],
        hourly: [
          { hour: "2026-05-11T15:00:00.000Z", expected: 50, success: 34, failed: 16 },
          { hour: "2026-05-11T16:00:00.000Z", expected: 50, success: 34, failed: 16 },
        ],
        breaches: [],
      },
      {
        asset: "AMDx",
        group: "tail",
        provider: "jupz",
        uptime_pct: 57.14,
        expected_slots: 14,
        success_slots: 8,
        failed_slots: 6,
        latest_quote_at: "2026-05-11T16:08:00.000Z",
        latest_success_at: "2026-05-11T16:08:00.000Z",
        directions: ["forward"],
        notionals_usd: ["1000", "10000"],
        hourly: baseHourly,
        breaches: [
          {
            start_at: "2026-05-11T16:00:00.000Z",
            end_at: "2026-05-11T17:00:00.000Z",
            reason: "partial_failure",
            error_codes: ["400"],
          },
        ],
      },
    ];

    const summaries = buildQuoteActivityAssetSummaries(rows);

    expect(summaries.map((row) => row.asset)).toEqual(["SPYx", "CVXx", "AMDx"]);
    expect(summaries[0].status).toBe("healthy");
    expect(summaries[1].status).toBe("healthy");
    expect(summaries[2].status).toBe("down");
    expect(summaries[2].providers[0]).toMatchObject({
      label: "JupZ",
      uptimePct: 57.14,
    });
    expect(summaries[2].providers[0].hourly).toEqual(baseHourly);
    expect(summaries[2].breaches[0]).toMatchObject({
      provider: "jupz",
      providerLabel: "JupZ",
    });
    expect(summaries[2].hourly[1].providerFailures?.[0]).toMatchObject({
      provider: "jupz",
      providerLabel: "JupZ",
      reason: "partial_failure",
      error_codes: ["400"],
      error_sample: "Failed to get quotes",
    });
  });

  it("classifies timeline bucket tones", () => {
    expect(quoteActivityTone({ hour: "h", expected: 10, success: 10, failed: 0 })).toBe("good");
    expect(quoteActivityTone({ hour: "h", expected: 10, success: 6, failed: 4 })).toBe("warn");
    expect(quoteActivityTone({ hour: "h", expected: 10, success: 9, failed: 1 })).toBe("ok");
    expect(quoteActivityTone({ hour: "h", expected: 10, success: 2, failed: 8 })).toBe("critical");
    expect(
      quoteActivityTone({
        hour: "h",
        expected: 200,
        success: 190,
        failed: 10,
        providerBuckets: [
          { provider: "jupz", providerLabel: "JupZ", expected: 100, success: 100, failed: 0 },
          { provider: "zerox", providerLabel: "0x", expected: 100, success: 90, failed: 10 },
        ],
        providerFailures: [
          {
            provider: "zerox",
            providerLabel: "0x",
            reason: "partial_failure",
            error_codes: [],
          },
        ],
      }),
    ).toBe("warn");
    expect(
      quoteActivityTone({
        hour: "h",
        expected: 10,
        success: 9,
        failed: 1,
        providerFailures: [
          {
            provider: "jupz",
            providerLabel: "JupZ",
            reason: "partial_failure",
            error_codes: ["400"],
          },
        ],
      }),
    ).toBe("ok");
    expect(
      quoteActivityTone({
        hour: "h",
        expected: 10,
        success: 5,
        failed: 5,
        providerFailures: [
          {
            provider: "jupz",
            providerLabel: "JupZ",
            reason: "partial_failure",
            error_codes: ["400"],
          },
        ],
      }),
    ).toBe("bad");
    expect(
      quoteActivityTone({
        hour: "h",
        expected: 10,
        success: 9,
        failed: 1,
        providerFailures: [
          {
            provider: "oneinch",
            providerLabel: "1inch",
            reason: "missing_cycle",
            error_codes: [],
          },
        ],
      }),
    ).toBe("missing");
    expect(
      quoteActivityTone({
        hour: "h",
        expected: 10,
        success: 0,
        failed: 10,
        providerFailures: [
          {
            provider: "oneinch",
            providerLabel: "1inch",
            reason: "missing_cycle",
            error_codes: [],
          },
        ],
      }),
    ).toBe("missing");
    expect(quoteActivityTone({ hour: "h", expected: 10, success: 5, failed: 5 })).toBe("bad");
    expect(quoteActivityTone({ hour: "h", expected: 0, success: 0, failed: 0 })).toBe("missing");
  });

  it("classifies per-venue timeline tones against healthy peers", () => {
    const siblingBuckets = [
      { provider: "jupz" as const, providerLabel: "JupZ", expected: 100, success: 100, failed: 0 },
      { provider: "zerox" as const, providerLabel: "0x", expected: 100, success: 90, failed: 10 },
    ];

    expect(
      quoteVenueActivityTone(
        { hour: "h", expected: 100, success: 90, failed: 10, failure_reason: "partial_failure" },
        siblingBuckets,
      ),
    ).toBe("ok");
    expect(
      quoteVenueActivityTone(
        { hour: "h", expected: 100, success: 100, failed: 0 },
        siblingBuckets,
      ),
    ).toBe("good");
    expect(
      quoteVenueActivityTone(
        { hour: "h", expected: 100, success: 70, failed: 30, failure_reason: "partial_failure" },
        siblingBuckets,
      ),
    ).toBe("warn");
    expect(
      quoteVenueActivityTone(
        { hour: "h", expected: 100, success: 50, failed: 50, failure_reason: "partial_failure" },
        siblingBuckets,
      ),
    ).toBe("bad");
    expect(
      quoteVenueActivityTone(
        { hour: "h", expected: 100, success: 10, failed: 90, failure_reason: "partial_failure" },
        siblingBuckets,
      ),
    ).toBe("critical");
    expect(
      quoteVenueActivityTone(
        { hour: "h", expected: 100, success: 90, failed: 10, failure_reason: "missing_cycle" },
        siblingBuckets,
      ),
    ).toBe("missing");
  });

  it("carries provider-level hourly rates for mixed-MM timeline warnings", () => {
    const summaries = buildQuoteActivityAssetSummaries([
      {
        asset: "AMDx",
        group: "tail",
        provider: "jupz",
        uptime_pct: 100,
        expected_slots: 100,
        success_slots: 100,
        failed_slots: 0,
        latest_quote_at: "2026-05-11T16:08:00.000Z",
        latest_success_at: "2026-05-11T16:08:00.000Z",
        directions: ["forward"],
        notionals_usd: ["1000"],
        hourly: [{ hour: "2026-05-11T16:00:00.000Z", expected: 100, success: 100, failed: 0 }],
        breaches: [],
      },
      {
        asset: "AMDx",
        group: "tail",
        provider: "zerox",
        uptime_pct: 90,
        expected_slots: 100,
        success_slots: 90,
        failed_slots: 10,
        latest_quote_at: "2026-05-11T16:08:00.000Z",
        latest_success_at: "2026-05-11T16:08:00.000Z",
        directions: ["forward"],
        notionals_usd: ["1000"],
        hourly: [
          {
            hour: "2026-05-11T16:00:00.000Z",
            expected: 100,
            success: 90,
            failed: 10,
            failure_reason: "partial_failure",
            error_codes: [],
          },
        ],
        breaches: [],
      },
    ]);

    expect(summaries[0].hourly[0].providerBuckets).toEqual([
      { provider: "jupz", providerLabel: "JupZ", expected: 100, success: 100, failed: 0, reason: null },
      { provider: "zerox", providerLabel: "0x", expected: 100, success: 90, failed: 10, reason: "partial_failure" },
    ]);
    expect(quoteActivityTone(summaries[0].hourly[0])).toBe("warn");
  });

  it("keeps provider timelines independent inside an asset summary", () => {
    const summaries = buildQuoteActivityAssetSummaries([
      {
        asset: "Vx",
        group: "tail",
        provider: "jupz",
        uptime_pct: 99.7,
        expected_slots: 7,
        success_slots: 7,
        failed_slots: 0,
        latest_quote_at: "2026-05-11T16:08:00.000Z",
        latest_success_at: "2026-05-11T16:08:00.000Z",
        directions: ["forward"],
        notionals_usd: ["1000"],
        hourly: [{ hour: "2026-05-11T16:00:00.000Z", expected: 7, success: 7, failed: 0 }],
        breaches: [],
      },
    ]);

    expect(summaries[0].providers).toHaveLength(1);
    expect(summaries[0].providers[0]).toMatchObject({
      label: "JupZ",
      hourly: [{ hour: "2026-05-11T16:00:00.000Z", expected: 7, success: 7, failed: 0 }],
    });
    expect(summaries[0].hourly[0]).toMatchObject({
      expected: 7,
      success: 7,
      failed: 0,
    });
  });

  it("formats quote age without relying on the browser clock", () => {
    const now = new Date("2026-05-11T17:30:00.000Z");

    expect(formatQuoteActivityAge("2026-05-11T17:12:00.000Z", now)).toBe("18m");
    expect(formatQuoteActivityAge("2026-05-11T14:30:00.000Z", now)).toBe("3h");
    expect(formatQuoteActivityAge(null, now)).toBe("never");
  });
});
