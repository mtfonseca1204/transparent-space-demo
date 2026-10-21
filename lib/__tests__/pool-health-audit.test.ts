import { describe, expect, it } from "vitest";

import { buildAuditReport } from "../../scripts/lib/pool-health-audit.mjs";

import healthySnapshot from "./fixtures/pool-health-audit/healthy-wld-usdc.json";
import emptyActiveLiquidityV4 from "./fixtures/pool-health-audit/empty-active-liquidity-v4.json";
import missingUsdSnapshot from "./fixtures/pool-health-audit/missing-usd-context.json";
import noOwnerSnapshot from "./fixtures/pool-health-audit/no-owner-selection.json";
import solanaPartialPositionCoverage from "./fixtures/pool-health-audit/solana-partial-position-coverage.json";
import staleButRenderableWorldchainV3 from "./fixtures/pool-health-audit/stale-but-renderable-worldchain-v3.json";
import staleButRenderableWorldchainV4 from "./fixtures/pool-health-audit/stale-but-renderable-worldchain-v4.json";

function statusMap(report: ReturnType<typeof buildAuditReport>) {
  return Object.fromEntries(report.charts.map((chart) => [chart.id, chart.status]));
}

describe("pool health audit engine", () => {
  it("marks the healthy WLD/USDC fixture as healthy across mounted charts", () => {
    const report = buildAuditReport(healthySnapshot);
    const statuses = statusMap(report);

    expect(report.summary.counts.broken).toBe(0);
    expect(report.summary.counts.degraded).toBe(0);
    expect(report.summary.overallStatus).toBe("ok");

    for (const chart of report.charts) {
      if (chart.id === "inventory") continue;
      expect(chart.status).toBe("ok");
    }
    expect(statuses.inventory).toBe("not_rendered");
  });

  it("breaks or degrades only the USD-dependent charts when USD context is missing", () => {
    const report = buildAuditReport(missingUsdSnapshot);
    const statuses = statusMap(report);

    const usdSensitive = [
      "slippage_history",
      "lp_concentration_tvl",
      "volume_concentration",
      "lp_efficiency",
      "trading_volume_by_size",
      "fee_earnings_by_lp",
      "liquidity_distribution_over_time",
      "lp_position_activity",
    ];

    for (const chartId of usdSensitive) {
      expect(["broken", "degraded"]).toContain(statuses[chartId]);
    }

    expect(statuses.price_chart).toBe("ok");
    expect(statuses.liquidity_distribution).toBe("ok");
    expect(statuses.pool_price_vs_oracle_spread).toBe("ok");
  });

  it("treats stale-but-renderable Worldchain v3/v4 pools as fully healthy", () => {
    for (const snapshot of [staleButRenderableWorldchainV3, staleButRenderableWorldchainV4]) {
      const report = buildAuditReport(snapshot);
      const statuses = statusMap(report);

      expect(report.summary.counts.broken).toBe(0);
      expect(report.summary.counts.degraded).toBe(0);
      expect(report.summary.overallStatus).toBe("ok");

      expect(statuses.liquidity_distribution).toBe("ok");
      expect(statuses.slippage_history).toBe("ok");
      expect(statuses.lp_concentration_tvl).toBe("ok");
      expect(statuses.volume_concentration).toBe("ok");
      expect(statuses.lp_efficiency).toBe("ok");
      expect(statuses.lp_activity_new_vs_exits).toBe("ok");
      expect(statuses.capital_efficiency).toBe("ok");
      expect(statuses.lp_ranges_by_address).toBe("ok");
      expect(statuses.liquidity_distribution_over_time).toBe("ok");
      expect(statuses.lp_position_activity).toBe("ok");
      expect(statuses.lp_liquidity_distribution).toBe("ok");
      expect(statuses.lp_activity_historical_data).toBe("ok");
      expect(statuses.inventory).toBe("not_rendered");
    }
  });

  it("treats zero active-liquidity v4 pools as an expected empty state", () => {
    const report = buildAuditReport(emptyActiveLiquidityV4);
    const statuses = statusMap(report);

    expect(report.summary.counts.broken).toBe(0);
    expect(report.summary.counts.degraded).toBe(0);
    expect(report.summary.overallStatus).toBe("ok");

    expect(statuses.price_impact).toBe("ok");
    expect(statuses.slippage_history).toBe("ok");
    expect(statuses.lp_concentration_tvl).toBe("ok");
    expect(statuses.volume_concentration).toBe("ok");
    expect(statuses.lp_efficiency).toBe("ok");
    expect(statuses.lp_ranges_by_address).toBe("ok");
    expect(statuses.lp_position_activity).toBe("ok");
    expect(statuses.lp_liquidity_distribution).toBe("ok");
    expect(statuses.price_range_monitor).toBe("ok");
    expect(statuses.inventory).toBe("not_rendered");
  });

  it("degrades the owner-scoped charts when no owner can be selected", () => {
    const report = buildAuditReport(noOwnerSnapshot);
    const statuses = statusMap(report);

    expect(statuses.liquidity_distribution).toBe("ok");
    expect(statuses.price_impact).toBe("ok");
    expect(statuses.lp_ranges_by_address).toBe("degraded");
    expect(statuses.lp_position_activity).toBe("degraded");
    expect(statuses.lp_liquidity_distribution).toBe("degraded");
    expect(statuses.price_range_monitor).toBe("degraded");
    expect(statuses.lp_activity_historical_data).toBe("ok");
    expect(statuses.inventory).toBe("not_rendered");
  });

  it("keeps Solana pools with partial position coverage degraded instead of worsening them", () => {
    const report = buildAuditReport(solanaPartialPositionCoverage);
    const statuses = statusMap(report);

    expect(report.summary.overallStatus).toBe("broken");
    expect(statuses.liquidity_distribution).toBe("degraded");
    expect(statuses.price_impact).toBe("broken");
    expect(statuses.capital_efficiency).toBe("degraded");
    expect(statuses.lp_concentration_tvl).toBe("ok");
    expect(statuses.lp_activity_historical_data).toBe("ok");
    expect(statuses.inventory).toBe("not_rendered");
  });
});
