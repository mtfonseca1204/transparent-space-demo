import fs from "fs/promises";
import path from "path";

const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;
const Q96 = 2n ** 96n;
const MAX_TICK = 887_272;
const DEFAULT_BASE_URL =
  process.env.POOL_AUDIT_BASE_URL?.trim() || "https://app.transparent.space";
const DEFAULT_WORLDCHAIN_RAILWAY_BASE =
  process.env.WORLDCHAIN_INDEXER_API_URL?.trim() ||
  "https://indexer-worldchain-production.up.railway.app";
const DEFAULT_SOLANA_RAILWAY_BASE =
  process.env.SOLANA_INDEXER_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL?.trim() ||
  "https://indexer-solana-production.up.railway.app";
const REQUEST_TIMEOUT_MS = 20_000;
const STATUS_SEVERITY = {
  ok: 0,
  not_rendered: 0,
  unsupported: 0,
  degraded: 1,
  broken: 2,
};

const BASE_CAPABILITIES = Object.freeze({
  hasCandleHistory: true,
  hasSwapHistory: true,
  hasWalletFeeSummary: true,
  hasOwnerPositionSummary: true,
  hasRangeLiquidityShape: true,
  hasHistoricalDepthBands: true,
  hasCurrentImpactCurve: true,
  hasHistoricalSlippage: true,
  hasOwnerCompositionHistory: true,
});

function getSqrtRatioAtTick(tick) {
  if (!Number.isInteger(tick) || tick < -MAX_TICK || tick > MAX_TICK) {
    throw new Error(`Tick out of range: ${tick}`);
  }
  const absTick = tick < 0 ? -tick : tick;

  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0) {
    ratio = ((1n << 256n) - 1n) / ratio;
  }

  let sqrtPriceX96 = ratio >> 32n;
  if ((ratio & ((1n << 32n) - 1n)) !== 0n) {
    sqrtPriceX96 += 1n;
  }
  return sqrtPriceX96;
}

function mulDiv(a, b, denominator) {
  return (a * b) / denominator;
}

function amount0Delta(liquidity, sqrtPA, sqrtPB) {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity << 96n, b - a, b * a);
}

function amount1Delta(liquidity, sqrtPA, sqrtPB) {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity, b - a, Q96);
}

function amountsForPosition({ liquidity, tickLower, tickUpper, sqrtPriceX96 }) {
  if (liquidity <= 0n) return { amount0: 0n, amount1: 0n };
  const sqrtA = getSqrtRatioAtTick(tickLower);
  const sqrtB = getSqrtRatioAtTick(tickUpper);

  if (sqrtPriceX96 <= sqrtA) {
    return { amount0: amount0Delta(liquidity, sqrtA, sqrtB), amount1: 0n };
  }
  if (sqrtPriceX96 < sqrtB) {
    return {
      amount0: amount0Delta(liquidity, sqrtPriceX96, sqrtB),
      amount1: amount1Delta(liquidity, sqrtA, sqrtPriceX96),
    };
  }
  return { amount0: 0n, amount1: amount1Delta(liquidity, sqrtA, sqrtB) };
}

function bigintToApproxNumber(value, decimals) {
  const negative = value < 0n;
  const normalized = negative ? -value : value;
  if (normalized === 0n) return 0;

  const base = 10n ** BigInt(Math.max(0, Math.trunc(decimals)));
  const integer = normalized / base;
  const fraction = normalized % base;

  return (negative ? -1 : 1) * (Number(integer) + Number(fraction) / Number(base));
}

const CHARTS = [
  {
    id: "price_chart",
    title: "Price Chart",
    capability: "hasCandleHistory",
    evaluate: (ctx) => {
      const result = requireCandles(ctx, {
        id: "price_chart",
        title: "Price Chart",
        probeIds: ["pool", "candlesPrimary"],
      });
      if (result) return result;
      return okResult("price_chart", "Price Chart", ["pool", "candlesPrimary"]);
    },
  },
  {
    id: "liquidity_distribution",
    title: "Liquidity Distribution",
    capability: "hasRangeLiquidityShape",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "liquidity_distribution", "Liquidity Distribution", [
        "pool",
        "poolData",
      ]);
      if (missingPool) return missingPool;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("liquidity_distribution", "Liquidity Distribution", ["pool", "poolData"]);
      }
      if (ctx.distributionSource === "positions" || ctx.distributionSource === "ticks") {
        return okResult("liquidity_distribution", "Liquidity Distribution", ["pool", "poolData"]);
      }
      if (ctx.positionInputsDegraded) {
        return makeChartResult("liquidity_distribution", "Liquidity Distribution", "degraded", {
          probeIds: ["pool", "poolData"],
          reasons: [
            "Position data exists and is fresh enough to render, but it only covers part of the pool value, so the rendered distribution is only partially trustworthy.",
          ],
          rootCauses: collectRootCauses(ctx, { includePosition: true }),
        });
      }
      if (ctx.hasTickLiquidity) {
        return makeChartResult("liquidity_distribution", "Liquidity Distribution", "broken", {
          probeIds: ["pool", "poolData"],
          reasons: [
            "The dashboard has tick liquidity available, but the preferred position-based reconstruction is stale or incomplete for this pool.",
          ],
          rootCauses: [
            "position_stale_or_incomplete",
            "tick_fallback_available_but_preferred_path_broken",
          ],
        });
      }
      return missingDatasetResult(ctx, "liquidity_distribution", "Liquidity Distribution", {
        probeIds: ["poolData"],
        missing: "tick liquidity and active positions",
        rootCauses: ["missing_positions", "missing_tick_liquidity"],
      });
    },
  },
  {
    id: "price_impact",
    title: "Price Impact",
    capability: "hasCurrentImpactCurve",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "price_impact", "Price Impact", ["pool", "poolData"]);
      if (missingPool) return missingPool;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("price_impact", "Price Impact", ["pool", "poolData"]);
      }
      if (ctx.positionInputsHealthy || ctx.hasTickLiquidity) {
        const notes = [];
        if (!ctx.positionInputsHealthy && ctx.hasTickLiquidity) {
          notes.push("Falling back to tick liquidity keeps this chart renderable even though position coverage is degraded.");
        }
        return okResult("price_impact", "Price Impact", ["pool", "poolData"], notes);
      }
      return missingDatasetResult(ctx, "price_impact", "Price Impact", {
        probeIds: ["poolData"],
        missing: "tick liquidity",
        rootCauses: ["missing_tick_liquidity"],
      });
    },
  },
  {
    id: "slippage_history",
    title: "Slippage History ($10k)",
    capability: "hasHistoricalSlippage",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "slippage_history", "Slippage History ($10k)", [
        "pool",
        "poolData",
        "tokenPrices",
      ]);
      if (missingPool) return missingPool;
      const missingUsd = requireUsdContext(ctx, "slippage_history", "Slippage History ($10k)", [
        "pool",
        "tokenPrices",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("slippage_history", "Slippage History ($10k)", ["poolData", "tokenPrices"]);
      }
      if (!ctx.hasPoolHours) {
        return missingDatasetResult(ctx, "slippage_history", "Slippage History ($10k)", {
          probeIds: ["poolData"],
          missing: "hourly pool data",
          rootCauses: ["missing_hourly_pool_data"],
        });
      }
      if (!ctx.hasPositions) {
        return missingDatasetResult(ctx, "slippage_history", "Slippage History ($10k)", {
          probeIds: ["poolData"],
          missing: "positions",
          rootCauses: ["missing_positions"],
        });
      }
      if (ctx.hasLpEvents || ctx.eventTimeSeriesSource === "zero-fill") {
        return okResult("slippage_history", "Slippage History ($10k)", ["poolData", "tokenPrices"]);
      }
      return missingDatasetResult(ctx, "slippage_history", "Slippage History ($10k)", {
        probeIds: ["poolData"],
        missing: "LP events",
        rootCauses: ["missing_lp_events"],
      });
    },
  },
  {
    id: "lp_concentration_tvl",
    title: "LP CONCENTRATION TVL",
    capability: "hasOwnerPositionSummary",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "lp_concentration_tvl", "LP CONCENTRATION TVL", [
        "pool",
        "poolData",
        "tokenPrices",
      ]);
      if (missingPool) return missingPool;
      const missingUsd = requireUsdContext(ctx, "lp_concentration_tvl", "LP CONCENTRATION TVL", [
        "pool",
        "tokenPrices",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("lp_concentration_tvl", "LP CONCENTRATION TVL", ["poolData", "tokenPrices"]);
      }
      if (!ctx.hasOwners) {
        return missingDatasetResult(ctx, "lp_concentration_tvl", "LP CONCENTRATION TVL", {
          probeIds: ["poolData"],
          missing: "owner-position data",
          rootCauses: ["missing_positions"],
        });
      }
      return okResult("lp_concentration_tvl", "LP CONCENTRATION TVL", ["poolData", "tokenPrices"]);
    },
  },
  {
    id: "volume_concentration",
    title: "Volume Concentration (24h)",
    capability: "hasHistoricalDepthBands",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "volume_concentration", "Volume Concentration (24h)", [
        "pool",
        "poolData",
        "tokenPrices",
      ]);
      if (missingPool) return missingPool;
      const missingUsd = requireUsdContext(ctx, "volume_concentration", "Volume Concentration (24h)", [
        "pool",
        "tokenPrices",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("volume_concentration", "Volume Concentration (24h)", [
          "poolData",
          "tokenPrices",
        ]);
      }
      if (!ctx.hasPoolHours) {
        return missingDatasetResult(ctx, "volume_concentration", "Volume Concentration (24h)", {
          probeIds: ["poolData"],
          missing: "hourly pool data",
          rootCauses: ["missing_hourly_pool_data"],
        });
      }
      if (!ctx.hasOwners) {
        return missingDatasetResult(ctx, "volume_concentration", "Volume Concentration (24h)", {
          probeIds: ["poolData"],
          missing: "positions by owner",
          rootCauses: ["missing_positions"],
        });
      }
      return okResult("volume_concentration", "Volume Concentration (24h)", ["poolData", "tokenPrices"]);
    },
  },
  {
    id: "lp_efficiency",
    title: "LP Efficiency",
    capability: "hasHistoricalDepthBands",
    evaluate: (ctx) => {
      if (!ctx.chartIndex.lp_concentration_tvl || !ctx.chartIndex.volume_concentration) {
        return makeChartResult("lp_efficiency", "LP Efficiency", "broken", {
          probeIds: ["poolData", "tokenPrices"],
          reasons: ["This derived table depends on the LP concentration and volume concentration calculations."],
        });
      }
      const dependencies = [
        ctx.chartIndex.lp_concentration_tvl.status,
        ctx.chartIndex.volume_concentration.status,
      ];
      if (dependencies.includes("broken")) {
        return makeChartResult("lp_efficiency", "LP Efficiency", "broken", {
          probeIds: ["poolData", "tokenPrices"],
          reasons: ["The upstream concentration inputs are broken, so the efficiency ratio cannot be trusted."],
          rootCauses: unionRootCauses([
            ctx.chartIndex.lp_concentration_tvl.rootCauses,
            ctx.chartIndex.volume_concentration.rootCauses,
          ]),
        });
      }
      if (dependencies.includes("degraded")) {
        return makeChartResult("lp_efficiency", "LP Efficiency", "degraded", {
          probeIds: ["poolData", "tokenPrices"],
          reasons: ["The upstream concentration inputs are partially degraded, so the efficiency ratio is only partially reliable."],
          rootCauses: unionRootCauses([
            ctx.chartIndex.lp_concentration_tvl.rootCauses,
            ctx.chartIndex.volume_concentration.rootCauses,
          ]),
        });
      }
      return okResult("lp_efficiency", "LP Efficiency", ["poolData", "tokenPrices"]);
    },
  },
  {
    id: "lp_activity_new_vs_exits",
    title: "LP Activity - New vs Exits (7 days)",
    capability: "hasHistoricalDepthBands",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "lp_activity_new_vs_exits", "LP Activity - New vs Exits (7 days)", [
        "poolData",
      ]);
      if (missingPool) return missingPool;
      if (ctx.hasLpEvents || ctx.eventTimeSeriesSource === "zero-fill") {
        return okResult("lp_activity_new_vs_exits", "LP Activity - New vs Exits (7 days)", ["poolData"]);
      }
      return missingDatasetResult(ctx, "lp_activity_new_vs_exits", "LP Activity - New vs Exits (7 days)", {
        probeIds: ["poolData"],
        missing: "LP events",
        rootCauses: ["missing_lp_events"],
      });
    },
  },
  {
    id: "capital_efficiency",
    title: "Liquidity Density & Capital Efficiency",
    capability: "hasRangeLiquidityShape",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "capital_efficiency", "Liquidity Density & Capital Efficiency", [
        "pool",
        "poolData",
      ]);
      if (missingPool) return missingPool;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("capital_efficiency", "Liquidity Density & Capital Efficiency", [
          "pool",
          "poolData",
        ]);
      }
      if (ctx.distributionSource === "positions" || ctx.distributionSource === "ticks") {
        return okResult("capital_efficiency", "Liquidity Density & Capital Efficiency", ["pool", "poolData"]);
      }
      if (ctx.positionInputsDegraded) {
        return makeChartResult("capital_efficiency", "Liquidity Density & Capital Efficiency", "degraded", {
          probeIds: ["pool", "poolData"],
          reasons: [
            "The density model can render from the current position set, but that snapshot only covers part of the pool value, so efficiency is only partially reliable.",
          ],
          rootCauses: collectRootCauses(ctx, { includePosition: true }),
        });
      }
      if (ctx.hasTickLiquidity) {
        return makeChartResult("capital_efficiency", "Liquidity Density & Capital Efficiency", "broken", {
          probeIds: ["pool", "poolData"],
          reasons: [
            "This chart shares the same liquidity reconstruction path as Liquidity Distribution, so stale or incomplete positions still break the preferred render path.",
          ],
          rootCauses: [
            "position_stale_or_incomplete",
            "tick_fallback_available_but_preferred_path_broken",
          ],
        });
      }
      return missingDatasetResult(ctx, "capital_efficiency", "Liquidity Density & Capital Efficiency", {
        probeIds: ["poolData"],
        missing: "tick liquidity and active positions",
        rootCauses: ["missing_positions", "missing_tick_liquidity"],
      });
    },
  },
  {
    id: "trading_volume_by_size",
    title: "Trading Volume by Size",
    capability: "hasSwapHistory",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "trading_volume_by_size", "Trading Volume by Size", [
        "pool",
        "tokenPrices",
        "tradingVolumeBySize",
      ]);
      if (missingPool) return missingPool;
      const missingUsd = requireUsdContext(ctx, "trading_volume_by_size", "Trading Volume by Size", [
        "pool",
        "tokenPrices",
        "tradingVolumeBySize",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.frontend.tradingVolumeBySize?.ok && ctx.frontend.tradingVolumeBySize.data?.dayCount > 0) {
        return okResult("trading_volume_by_size", "Trading Volume by Size", [
          "pool",
          "tokenPrices",
          "tradingVolumeBySize",
        ]);
      }
      const rootCauses = [];
      if (ctx.frontend.tradingVolumeBySize && !ctx.frontend.tradingVolumeBySize.ok && hasHealthyUpstreamVolumeBuckets(ctx)) {
        rootCauses.push("frontend_endpoint_degraded_but_upstream_healthy");
      }
      return missingDatasetResult(ctx, "trading_volume_by_size", "Trading Volume by Size", {
        probeIds: ["tokenPrices", "tradingVolumeBySize"],
        missing: "pre-aggregated volume buckets",
        rootCauses,
      });
    },
  },
  {
    id: "fee_earnings_by_lp",
    title: "Fee Earnings by LP (7D)",
    capability: "hasWalletFeeSummary",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "fee_earnings_by_lp", "Fee Earnings by LP (7D)", [
        "pool",
        "poolData",
        "tokenPrices",
      ]);
      if (missingPool) return missingPool;
      const missingUsd = requireUsdContext(ctx, "fee_earnings_by_lp", "Fee Earnings by LP (7D)", [
        "pool",
        "tokenPrices",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("fee_earnings_by_lp", "Fee Earnings by LP (7D)", ["poolData", "tokenPrices"]);
      }
      if (!ctx.hasPoolHours) {
        return missingDatasetResult(ctx, "fee_earnings_by_lp", "Fee Earnings by LP (7D)", {
          probeIds: ["poolData"],
          missing: "daily/hourly pool stats",
          rootCauses: ["missing_hourly_pool_data"],
        });
      }
      if (!ctx.hasOwnerSummary) {
        return missingDatasetResult(ctx, "fee_earnings_by_lp", "Fee Earnings by LP (7D)", {
          probeIds: ["poolData"],
          missing: "owner-position summary",
          rootCauses: ["missing_owner_summary"],
        });
      }
      const notes = [];
      if (!ctx.hasOwners && ctx.hasOwnerSummary) {
        notes.push("Owner summary is available from the indexer aggregate even though detailed position rows are sparse.");
      }
      return okResult("fee_earnings_by_lp", "Fee Earnings by LP (7D)", ["poolData", "tokenPrices"], notes);
    },
  },
  {
    id: "lp_ranges_by_address",
    title: "LP Ranges by Address",
    capability: "hasOwnerCompositionHistory",
    evaluate: (ctx) => evaluateOwnerScopedDistributionChart(ctx, {
      id: "lp_ranges_by_address",
      title: "LP Ranges by Address",
    }),
  },
  {
    id: "liquidity_distribution_over_time",
    title: "Liquidity Distribution Over Time",
    capability: "hasOwnerCompositionHistory",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "liquidity_distribution_over_time", "Liquidity Distribution Over Time", [
        "poolData",
        "tokenPrices",
      ]);
      if (missingPool) return missingPool;
      const missingUsd = requireUsdContext(ctx, "liquidity_distribution_over_time", "Liquidity Distribution Over Time", [
        "pool",
        "tokenPrices",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.isActiveLiquidityEmpty) {
        return emptyLiquidityResult("liquidity_distribution_over_time", "Liquidity Distribution Over Time", [
          "poolData",
          "tokenPrices",
        ]);
      }
      if (!ctx.hasPoolHours) {
        return missingDatasetResult(ctx, "liquidity_distribution_over_time", "Liquidity Distribution Over Time", {
          probeIds: ["poolData"],
          missing: "daily/hourly pool stats",
          rootCauses: ["missing_hourly_pool_data"],
        });
      }
      if (!ctx.hasPositions) {
        return missingDatasetResult(ctx, "liquidity_distribution_over_time", "Liquidity Distribution Over Time", {
          probeIds: ["poolData"],
          missing: "positions",
          rootCauses: ["missing_positions"],
        });
      }
      if (ctx.hasLpEvents || ctx.eventTimeSeriesSource === "zero-fill") {
        return okResult("liquidity_distribution_over_time", "Liquidity Distribution Over Time", [
          "poolData",
          "tokenPrices",
        ]);
      }
      return missingDatasetResult(ctx, "liquidity_distribution_over_time", "Liquidity Distribution Over Time", {
        probeIds: ["poolData"],
        missing: "LP events",
        rootCauses: ["missing_lp_events"],
      });
    },
  },
  {
    id: "pool_price_vs_oracle_spread",
    title: "Pool Price vs Oracle Spread",
    capability: "hasCandleHistory",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "pool_price_vs_oracle_spread", "Pool Price vs Oracle Spread", [
        "pool",
        "candlesDaily",
        "historicalPrices",
      ]);
      if (missingPool) return missingPool;
      if (!ctx.hasDailyCandles) {
        return missingDatasetResult(ctx, "pool_price_vs_oracle_spread", "Pool Price vs Oracle Spread", {
          probeIds: ["candlesDaily"],
          missing: "daily candle history",
          rootCauses: ["missing_candle_history"],
        });
      }
      if (!ctx.hasOracleHistory) {
        return missingDatasetResult(ctx, "pool_price_vs_oracle_spread", "Pool Price vs Oracle Spread", {
          probeIds: ["historicalPrices"],
          missing: "oracle history",
          rootCauses: ["missing_oracle_history"],
        });
      }
      return okResult("pool_price_vs_oracle_spread", "Pool Price vs Oracle Spread", [
        "candlesDaily",
        "historicalPrices",
      ]);
    },
  },
  {
    id: "lp_position_activity",
    title: "LP Position Activity",
    capability: "hasOwnerCompositionHistory",
    evaluate: (ctx) => {
      const ownerGate = requireSelectedOwner(ctx, "lp_position_activity", "LP Position Activity", [
        "poolData",
        "tokenPrices",
      ]);
      if (ownerGate) return ownerGate;
      const missingUsd = requireUsdContext(ctx, "lp_position_activity", "LP Position Activity", [
        "pool",
        "tokenPrices",
      ]);
      if (missingUsd) return missingUsd;
      if (ctx.hasLpEvents || ctx.eventTimeSeriesSource === "zero-fill") {
        return okResult("lp_position_activity", "LP Position Activity", ["poolData", "tokenPrices"]);
      }
      return missingDatasetResult(ctx, "lp_position_activity", "LP Position Activity", {
        probeIds: ["poolData"],
        missing: "LP events",
        rootCauses: ["missing_lp_events"],
      });
    },
  },
  {
    id: "lp_liquidity_distribution",
    title: "LP Liquidity Distribution",
    capability: "hasOwnerCompositionHistory",
    evaluate: (ctx) => evaluateOwnerScopedDistributionChart(ctx, {
      id: "lp_liquidity_distribution",
      title: "LP Liquidity Distribution",
    }),
  },
  {
    id: "price_range_monitor",
    title: "Price Range Monitor",
    capability: "hasOwnerCompositionHistory",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "price_range_monitor", "Price Range Monitor", [
        "pool",
        "poolData",
      ]);
      if (missingPool) return missingPool;
      const ownerGate = requireSelectedOwner(ctx, "price_range_monitor", "Price Range Monitor", [
        "poolData",
      ]);
      if (ownerGate) return ownerGate;
      return okResult("price_range_monitor", "Price Range Monitor", ["pool", "poolData"]);
    },
  },
  {
    id: "inventory",
    title: "Inventory",
    capability: "hasOwnerCompositionHistory",
    evaluate: () =>
      makeChartResult("inventory", "Inventory", "not_rendered", {
        reasons: ["The component exists in the repo, but the main dashboard does not mount this card today."],
      }),
  },
  {
    id: "lp_activity_historical_data",
    title: "LP Activity - Historical Data (1d)",
    capability: "hasOwnerCompositionHistory",
    evaluate: (ctx) => {
      const missingPool = requirePoolSnapshot(ctx, "lp_activity_historical_data", "LP Activity - Historical Data (1d)", [
        "pool",
        "poolData",
        "candlesPrimary",
      ]);
      if (missingPool) return missingPool;
      if (!ctx.hasPrimaryCandles) {
        return missingDatasetResult(ctx, "lp_activity_historical_data", "LP Activity - Historical Data (1d)", {
          probeIds: ["candlesPrimary"],
          missing: "candle history",
          rootCauses: ["missing_candle_history"],
        });
      }
      if (!ctx.hasPoolHours) {
        return missingDatasetResult(ctx, "lp_activity_historical_data", "LP Activity - Historical Data (1d)", {
          probeIds: ["poolData"],
          missing: "hourly pool data",
          rootCauses: ["missing_hourly_pool_data"],
        });
      }
      if (!ctx.hasPositions && !ctx.hasTickLiquidity) {
        return missingDatasetResult(ctx, "lp_activity_historical_data", "LP Activity - Historical Data (1d)", {
          probeIds: ["poolData"],
          missing: "positions or tick liquidity",
          rootCauses: ["missing_positions", "missing_tick_liquidity"],
        });
      }
      if (!ctx.hasPositions && ctx.hasTickLiquidity) {
        const notes = [
          "The chart can still render pool-level price, oracle, and depth layers from tick liquidity even without active positions.",
        ];
        if (!ctx.selectedOwnerAvailable) {
          notes.push("No active LP is selected, so owner-specific range overlays stay disabled while the pool-level layers still render.");
        }
        if (ctx.pool.protocol === "v3" && !ctx.hasSwapHistoryWindow) {
          notes.push("The v3-only swap overlay is missing, but the core monitor layers still have enough data to render.");
        }
        if (!ctx.hasOracleHistory) {
          notes.push("Oracle history is missing, but the chart can still fall back to the local DEX TWAP overlay.");
        }
        return okResult("lp_activity_historical_data", "LP Activity - Historical Data (1d)", [
          "poolData",
          "candlesPrimary",
          "lpSwaps",
          "historicalPrices",
        ], notes);
      }
      if (ctx.currentStateStatus !== "renderable") {
        return makeChartResult("lp_activity_historical_data", "LP Activity - Historical Data (1d)", "broken", {
          probeIds: ["poolData", "candlesPrimary"],
          reasons: ["The historical monitor needs fresh positions to build LP ranges and depth overlays."],
          rootCauses: collectRootCauses(ctx, { includePosition: true }),
        });
      }
      const notes = [];
      if (!ctx.selectedOwnerAvailable) {
        notes.push("No active LP is selected, so owner-specific range overlays stay disabled while the pool-level layers still render.");
      }
      if (ctx.pool.protocol === "v3" && !ctx.hasSwapHistoryWindow) {
        notes.push("The v3-only swap overlay is missing, but the core monitor layers still have enough data to render.");
      }
      if (!ctx.hasOracleHistory) {
        notes.push("Oracle history is missing, but the chart can still fall back to the local DEX TWAP overlay.");
      }
      return okResult("lp_activity_historical_data", "LP Activity - Historical Data (1d)", [
        "poolData",
        "candlesPrimary",
        "lpSwaps",
        "historicalPrices",
      ], notes);
    },
  },
];

export function parseArgs(argv) {
  const args = {
    pool: "",
    baseUrl: DEFAULT_BASE_URL,
    jsonOut: "",
    snapshotFile: "",
    snapshotOut: "",
    windowDays: 7,
    failOn: [],
    includeRaw: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Flag ${flag} requires a value.`);
      }
      index += 1;
      return value;
    };

    if (flag === "--pool") {
      args.pool = nextValue();
      continue;
    }
    if (flag === "--base-url") {
      args.baseUrl = nextValue();
      continue;
    }
    if (flag === "--json-out") {
      args.jsonOut = nextValue();
      continue;
    }
    if (flag === "--snapshot-file") {
      args.snapshotFile = nextValue();
      continue;
    }
    if (flag === "--snapshot-out") {
      args.snapshotOut = nextValue();
      continue;
    }
    if (flag === "--window-days") {
      const parsed = Number(nextValue());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--window-days must be a positive number.");
      }
      args.windowDays = Math.max(1, Math.floor(parsed));
      continue;
    }
    if (flag === "--include-raw") {
      args.includeRaw = true;
      continue;
    }
    if (flag.startsWith("--fail-on=")) {
      args.failOn = normalizeFailOn(flag.slice("--fail-on=".length));
      continue;
    }
    if (flag === "--fail-on") {
      args.failOn = normalizeFailOn(nextValue());
      continue;
    }
    if (flag === "-h" || flag === "--help") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown flag: ${flag}`);
  }

  return args;
}

export function formatUsage() {
  return [
    "Usage:",
    "  npm run audit:pool -- --pool <poolKey> [--base-url <url>] [--json-out <path>] [--snapshot-out <path>] [--window-days <days>] [--fail-on broken,degraded]",
    "  npm run audit:pool -- --snapshot-file <path> [--json-out <path>] [--fail-on broken,degraded]",
    "",
    "Examples:",
    "  npm run audit:pool -- --pool 0x610e319b3a3ab56a0ed5562927d37c233774ba39",
    "  npm run audit:pool -- --pool HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum --json-out /tmp/audit.json",
    "  npm run audit:pool -- --pool 0xdce053d9ba0fa2c5f772416b64f191158cbcc32e --snapshot-out /tmp/wbtc-usdc.snapshot.json --include-raw",
    "  npm run audit:pool -- --snapshot-file /tmp/wbtc-usdc.snapshot.json --json-out /tmp/wbtc-usdc.report.json",
  ].join("\n");
}

export async function collectAuditSnapshot({
  poolKey,
  baseUrl = DEFAULT_BASE_URL,
  windowDays = 7,
  now = Math.floor(Date.now() / 1000),
  includeRaw = false,
}) {
  const normalizedPoolKey = normalizePoolKey(poolKey);
  const roundedNow = Math.floor(now / HOUR_SECONDS) * HOUR_SECONDS;
  const startTime = roundedNow - windowDays * DAY_SECONDS;
  const oracleStartTime = roundedNow - 365 * DAY_SECONDS;
  const env = await loadEnvConfig(process.cwd());

  const snapshot = {
    meta: {
      poolKey: normalizedPoolKey,
      baseUrl: stripTrailingSlash(baseUrl),
      windowDays,
      now: roundedNow,
      kind: inferPoolKind(normalizedPoolKey),
    },
    frontend: {},
    upstream: {
      kind: "skipped",
      probes: {},
    },
  };

  const poolProbe = await fetchPoolProbe(snapshot.meta.baseUrl, normalizedPoolKey, { includeRaw });
  snapshot.frontend.pool = poolProbe;

  if (!poolProbe.ok || !poolProbe.data) {
    return snapshot;
  }

  const pool = poolProbe.data;
  const [
    poolDataProbe,
    primaryCandlesProbe,
    dailyCandlesProbe,
    tokenPricesProbe,
    swapHistoryProbe,
  ] = await Promise.all([
    fetchPoolDataProbe(snapshot.meta.baseUrl, normalizedPoolKey, startTime, roundedNow, pool, { includeRaw }),
    fetchCandlesProbe(snapshot.meta.baseUrl, normalizedPoolKey, startTime, roundedNow, 3600, "candlesPrimary", { includeRaw }),
    fetchCandlesProbe(snapshot.meta.baseUrl, normalizedPoolKey, oracleStartTime, roundedNow, 86400, "candlesDaily", { includeRaw }),
    fetchTokenPricesProbe(snapshot.meta.baseUrl, pool, { includeRaw }),
    shouldFetchSwapHistory(pool)
      ? fetchLpSwapsProbe(snapshot.meta.baseUrl, normalizedPoolKey, startTime, roundedNow, { includeRaw })
      : skippedProbe("lpSwaps", "Swap history is only required for the v3 overlay."),
  ]);

  snapshot.frontend.poolData = poolDataProbe;
  snapshot.frontend.candlesPrimary = primaryCandlesProbe;
  snapshot.frontend.candlesDaily = dailyCandlesProbe;
  snapshot.frontend.tokenPrices = tokenPricesProbe;
  snapshot.frontend.lpSwaps = swapHistoryProbe;

  snapshot.frontend.historicalPrices = pool.token0Address
    ? await fetchHistoricalPricesProbe(snapshot.meta.baseUrl, pool.token0Address, oracleStartTime, roundedNow, { includeRaw })
    : skippedProbe("historicalPrices", "The pool snapshot did not include token0Address.");

  const usdContext = tokenPricesProbe.data;
  snapshot.frontend.tradingVolumeBySize =
    usdContext?.hasCompleteUsdContext && hasFiniteNumber(pool.token0Decimals) && hasFiniteNumber(pool.token1Decimals)
      ? await fetchTradingVolumeBySizeProbe(
          snapshot.meta.baseUrl,
          normalizedPoolKey,
          windowDays,
          usdContext,
          pool,
          { includeRaw },
        )
      : skippedProbe(
          "tradingVolumeBySize",
          "Missing USD prices or token decimals for the aggregated volume-by-size request.",
        );

  return maybeAttachUpstream(snapshot, env, { includeRaw });
}

export function buildAuditReport(snapshot, options = {}) {
  const derived = deriveAuditState(snapshot);
  const charts = [];

  for (const definition of CHARTS) {
    if (definition.capability && !derived.capabilities[definition.capability]) {
      charts.push(
        makeChartResult(definition.id, definition.title, "unsupported", {
          reasons: [`This pool does not advertise ${definition.capability}.`],
        }),
      );
      continue;
    }

    const result = definition.evaluate({
      ...derived,
      chartIndex: Object.fromEntries(charts.map((chart) => [chart.id, chart])),
    });
    charts.push(result);
  }

  const counts = { ok: 0, degraded: 0, broken: 0, unsupported: 0, not_rendered: 0 };
  for (const chart of charts) {
    counts[chart.status] += 1;
  }

  const overallStatus = charts.reduce((current, chart) => {
    return STATUS_SEVERITY[chart.status] > STATUS_SEVERITY[current] ? chart.status : current;
  }, "ok");

  const summary = {
    overallStatus,
    counts,
    brokenCharts: charts.filter((chart) => chart.status === "broken").map((chart) => chart.title),
    degradedCharts: charts.filter((chart) => chart.status === "degraded").map((chart) => chart.title),
    tvlParity: derived.tvlParity,
  };

  const failOn = normalizeFailOn(options.failOn ?? []);
  const failingStatuses = failOn.filter((status) => counts[status] > 0);
  const exitReason = failingStatuses.length > 0 ? `failed:${failingStatuses.join(",")}` : "ok";

  return {
    pool: {
      poolKey: snapshot.meta.poolKey,
      baseUrl: snapshot.meta.baseUrl,
      windowDays: snapshot.meta.windowDays,
      kind: snapshot.meta.kind,
      label: derived.pairLabel,
      protocol: derived.pool.protocol ?? null,
      analyticsModel: derived.pool.analyticsModel ?? null,
    },
    probes: {
      frontend: snapshot.frontend,
      upstream: snapshot.upstream,
    },
    charts,
    summary,
    exitReason,
  };
}

export function formatAuditReport(report) {
  const lines = [];
  lines.push("Pool Health Audit");
  lines.push(`Pool: ${report.pool.label} (${report.pool.poolKey})`);
  lines.push(`Base URL: ${report.pool.baseUrl}`);
  lines.push(`Window: ${report.pool.windowDays}d`);
  lines.push(`Overall: ${report.summary.overallStatus}`);
  lines.push(
    `Counts: ok=${report.summary.counts.ok} degraded=${report.summary.counts.degraded} broken=${report.summary.counts.broken} unsupported=${report.summary.counts.unsupported} not_rendered=${report.summary.counts.not_rendered}`,
  );

  appendTvlParitySection(lines, report.summary.tvlParity);
  appendChartSection(lines, "Broken", report.charts.filter((chart) => chart.status === "broken"));
  appendChartSection(lines, "Degraded", report.charts.filter((chart) => chart.status === "degraded"));
  appendChartSection(lines, "Not Rendered", report.charts.filter((chart) => chart.status === "not_rendered"));

  return lines.join("\n");
}

export async function writeJsonReport(jsonOut, report) {
  const outputPath = path.resolve(jsonOut);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

export async function writeSnapshotFile(snapshotOut, snapshot) {
  const outputPath = path.resolve(snapshotOut);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return outputPath;
}

export async function readSnapshotFile(snapshotFile) {
  const inputPath = path.resolve(snapshotFile);
  const content = await fs.readFile(inputPath, "utf8");
  return JSON.parse(content);
}

export function poolKeyToFilename(poolKey, suffix = "json") {
  const safe = normalizePoolKey(poolKey)
    .replace(/[^a-z0-9]+/giu, "_")
    .replace(/^_+|_+$/gu, "");
  return `${safe || "pool"}.${suffix}`;
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(formatUsage());
    return 0;
  }
  if (!args.pool && !args.snapshotFile) {
    console.error("Missing required flag: --pool or --snapshot-file");
    console.error("");
    console.error(formatUsage());
    return 1;
  }

  const snapshot = args.snapshotFile
    ? await readSnapshotFile(args.snapshotFile)
    : await collectAuditSnapshot({
        poolKey: args.pool,
        baseUrl: args.baseUrl,
        windowDays: args.windowDays,
        includeRaw: args.includeRaw,
      });
  const report = buildAuditReport(snapshot, { failOn: args.failOn });

  console.log(formatAuditReport(report));

  if (args.snapshotOut) {
    const snapshotPath = await writeSnapshotFile(args.snapshotOut, snapshot);
    console.log(`Snapshot: ${snapshotPath}`);
  }

  if (args.jsonOut) {
    const jsonPath = await writeJsonReport(args.jsonOut, report);
    console.log(`JSON report: ${jsonPath}`);
  }

  return report.exitReason === "ok" ? 0 : 1;
}

function appendChartSection(lines, title, charts) {
  if (charts.length === 0) return;
  lines.push("");
  lines.push(`${title}:`);
  for (const chart of charts) {
    lines.push(`- ${chart.title}`);
    for (const reason of chart.reasons) {
      lines.push(`  ${reason}`);
    }
    if (chart.notes.length > 0) {
      for (const note of chart.notes) {
        lines.push(`  Note: ${note}`);
      }
    }
    if (chart.rootCauses.length > 0) {
      lines.push(`  Root causes: ${chart.rootCauses.join(", ")}`);
    }
  }
}

function appendTvlParitySection(lines, parity) {
  if (!parity) return;
  lines.push("");
  lines.push("TVL Parity:");
  lines.push(`- Pool.liquidity: ${parity.poolLiquidityRaw ?? "n/a"}`);
  lines.push(
    `- Tick-net liquidity at current tick: ${parity.tickNetLiquidityAtCurrentTickRaw ?? "n/a"} (${formatParityCoverage(parity.tickNetLiquidityCoverageRatio, parity.poolLiquidityMatchesTickNet)})`,
  );
  lines.push(
    `- In-range position liquidity: ${parity.inRangePositionLiquidityRaw ?? "n/a"} (${formatParityCoverage(parity.inRangePositionLiquidityCoverageRatio, parity.poolLiquidityMatchesInRangePositions)})`,
  );
  lines.push(
    `- Position-derived TVL: ${formatUsdValue(parity.positionTvlUsd)} (${formatTokenAmount(parity.positionToken0Balance)} token0 + ${formatTokenAmount(parity.positionToken1Balance)} token1)`,
  );
  lines.push(
    `- Pool balance TVL: ${formatUsdValue(parity.poolBalanceTvlUsd)} (${formatTokenAmount(parity.poolToken0Balance)} token0 + ${formatTokenAmount(parity.poolToken1Balance)} token1)`,
  );
  lines.push(`- Displayed TVL: ${formatUsdValue(parity.displayedTvlUsd)} via ${parity.displayedSource ?? "n/a"}`);
}

function formatParityCoverage(ratio, matches) {
  const pct = hasFiniteNumber(ratio) ? `${(ratio * 100).toFixed(2)}%` : "n/a";
  const status = matches === true ? "matches" : matches === false ? "mismatch" : "unknown";
  return `${pct}, ${status}`;
}

function formatUsdValue(value) {
  if (!hasFiniteNumber(value)) return "n/a";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatTokenAmount(value) {
  if (!hasFiniteNumber(value)) return "n/a";
  if (Math.abs(value) >= 1_000_000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toPrecision(4);
}

async function maybeAttachUpstream(snapshot, env, { includeRaw = false } = {}) {
  const firstPass = buildAuditReport(snapshot);
  const needsUpstream = firstPass.summary.counts.broken > 0 || firstPass.summary.counts.degraded > 0;
  if (!needsUpstream) return snapshot;

  if (snapshot.meta.kind === "worldchain") {
    snapshot.upstream = await fetchWorldchainUpstream(snapshot, env, { includeRaw });
    return snapshot;
  }

  if (snapshot.meta.kind === "solana") {
    snapshot.upstream = await fetchSolanaUpstream(snapshot, env, { includeRaw });
    return snapshot;
  }

  snapshot.upstream = {
    kind: "skipped",
    probes: {},
    notes: ["No direct upstream probe is configured for this pool kind."],
  };
  return snapshot;
}

async function fetchWorldchainUpstream(snapshot, env, { includeRaw = false } = {}) {
  const baseUrl = env.worldchainRailwayBase || DEFAULT_WORLDCHAIN_RAILWAY_BASE;
  const poolKey = snapshot.meta.poolKey;
  const positionEntity = snapshot.frontend.pool?.data?.protocol === "v4" ? "LPPosition" : "Position";
  const probes = {
    pool: await fetchWorldchainEntityProbe(baseUrl, "Pool", {
      pool: poolKey,
      limit: 1,
    }, { includeRaw }),
    tickLiquidity: await fetchWorldchainEntityProbe(baseUrl, "TickLiquidity", {
      pool: poolKey,
      limit: 1,
      orderBy: "updatedAt",
      orderDirection: "desc",
    }, { includeRaw }),
    poolHourData: await fetchWorldchainEntityProbe(baseUrl, "PoolHourData", {
      pool: poolKey,
      limit: 1,
      orderBy: "periodStartUnix",
      orderDirection: "desc",
    }, { includeRaw }),
    lpEvent: await fetchWorldchainEntityProbe(baseUrl, "LPEvent", {
      pool: poolKey,
      limit: 1,
      orderBy: "timestamp",
      orderDirection: "desc",
    }, { includeRaw }),
    position: await fetchWorldchainEntityProbe(baseUrl, positionEntity, {
      pool: poolKey,
      active: "true",
      limit: 1,
      orderBy: "updatedAt",
      orderDirection: "desc",
    }, { includeRaw }),
    ownerAggregate: await fetchWorldchainEntityProbe(baseUrl, "OwnerPositionAggregate", {
      pool: poolKey,
      active: "true",
      limit: 1,
      orderBy: "updatedAt",
      orderDirection: "desc",
    }, { includeRaw }),
    poolDailyVolumeBySize: await fetchWorldchainEntityProbe(baseUrl, "PoolDailyVolumeBySize", {
      pool: poolKey,
      limit: 1,
      orderBy: "date",
      orderDirection: "desc",
    }, { includeRaw }),
  };

  return {
    kind: "worldchain",
    baseUrl,
    probes,
  };
}

async function fetchSolanaUpstream(snapshot, env, { includeRaw = false } = {}) {
  const baseUrl = env.solanaRailwayBase || DEFAULT_SOLANA_RAILWAY_BASE;
  const poolKey = snapshot.meta.poolKey;
  const now = snapshot.meta.now;
  const start = now - snapshot.meta.windowDays * DAY_SECONDS;
  const priceProbe = await fetchJsonProbe("solanaPrice", buildUrl(baseUrl, "/api/price", { pool: poolKey }), (json) => json, { includeRaw });
  const candlesProbe = await fetchJsonProbe(
    "solanaCandles",
    buildUrl(baseUrl, "/api/charts/candles", {
      pool: poolKey,
      resolution: "1h",
      start_time: start,
      end_time: now,
    }),
    summarizeSolanaCandlesResponse,
    { includeRaw },
  );
  const positionsProbe = await fetchJsonProbe(
    "solanaPositions",
    buildUrl(baseUrl, "/api/positions", {
      pool: poolKey,
      limit: 1,
    }),
    summarizeSolanaCollectionResponse,
    { includeRaw },
  );
  const positionEventsProbe = await fetchJsonProbe(
    "solanaPositionEvents",
    buildUrl(baseUrl, "/api/position-events", {
      pool: poolKey,
      start_time: start,
      end_time: now,
    }),
    summarizeSolanaCollectionResponse,
    { includeRaw },
  );

  const volumeProbe = snapshot.frontend.tradingVolumeBySize?.skipped
    ? skippedProbe("solanaVolumeBySize", "Skipped because the frontend aggregate request was skipped.")
    : await fetchJsonProbe(
        "solanaVolumeBySize",
        buildUrl(baseUrl, "/api/charts/volume-by-size", {
          pool: poolKey,
          start_time: start,
          end_time: now,
          bucket_period: "1d",
          token0_usd: snapshot.frontend.tokenPrices?.data?.token0Usd,
          token1_usd: snapshot.frontend.tokenPrices?.data?.token1Usd,
          token0_decimals: snapshot.frontend.pool?.data?.token0Decimals,
          token1_decimals: snapshot.frontend.pool?.data?.token1Decimals,
        }),
        summarizeSolanaVolumeBySizeResponse,
        { includeRaw },
      );

  return {
    kind: "solana",
    baseUrl,
    probes: {
      price: summarizeUpstreamTimestampProbe(priceProbe, "block_time"),
      candles: candlesProbe,
      positions: positionsProbe,
      positionEvents: positionEventsProbe,
      volumeBySize: volumeProbe,
    },
  };
}

async function fetchPoolProbe(baseUrl, poolKey, options = {}) {
  return fetchJsonProbe(
    "pool",
    `${stripTrailingSlash(baseUrl)}/api/pool/${encodeURIComponent(poolKey)}`,
    (json) => ({
      protocol: normalizeString(json.protocol),
      analyticsModel: normalizeString(json.analyticsModel),
      capabilities: normalizeCapabilities(json.capabilities),
      token0Address: normalizeString(json.token0Address),
      token1Address: normalizeString(json.token1Address),
      token0Symbol: normalizeString(json.token0Symbol),
      token1Symbol: normalizeString(json.token1Symbol),
      token0Decimals: toFiniteNumber(json.token0Decimals),
      token1Decimals: toFiniteNumber(json.token1Decimals),
      fee: toFiniteNumber(json.fee),
      tickSpacing: toFiniteNumber(json.tickSpacing),
      sqrtPriceX96: normalizeIntegerLike(json.sqrtPriceX96),
      currentPrice: toFiniteNumber(json.currentPrice),
      tick: toFiniteNumber(json.tick),
      liquidity: normalizeIntegerLike(json.liquidity),
      token0Balance: toFiniteNumber(json.token0Balance),
      token1Balance: toFiniteNumber(json.token1Balance),
      token0BalanceRaw: normalizeIntegerLike(json.token0BalanceRaw),
      token1BalanceRaw: normalizeIntegerLike(json.token1BalanceRaw),
      lastTradeAt: toUnixTimestamp(json.lastTradeAt),
    }),
    options,
  );
}

async function fetchPoolDataProbe(baseUrl, poolKey, startTime, endTime, pool, options = {}) {
  return fetchJsonProbe(
    "poolData",
    buildUrl(baseUrl, "/api/pool-data", {
      pool: poolKey,
      startTime,
      endTime,
      include: "positions,events,hours,lp-activity",
    }),
    (json) => summarizePoolData(json, pool),
    options,
  );
}

async function fetchCandlesProbe(baseUrl, poolKey, startTime, endTime, interval, id, options = {}) {
  return fetchJsonProbe(
    id,
    buildUrl(baseUrl, "/api/candles", {
      pool: poolKey,
      interval,
      startTime,
      endTime,
    }),
    (json) => summarizeCandleSeries(json, interval),
    options,
  );
}

async function fetchTokenPricesProbe(baseUrl, pool, options = {}) {
  return fetchJsonProbe(
    "tokenPrices",
    buildUrl(baseUrl, "/api/token-prices", { source: "coingecko" }),
    (json) => summarizeTokenPrices(json, pool),
    options,
  );
}

async function fetchHistoricalPricesProbe(baseUrl, tokenAddress, startTime, endTime, options = {}) {
  return fetchJsonProbe(
    "historicalPrices",
    buildUrl(baseUrl, "/api/historical-prices", {
      tokenAddress,
      startTime,
      endTime,
    }),
    summarizeHistoricalPricesResponse,
    options,
  );
}

async function fetchTradingVolumeBySizeProbe(baseUrl, poolKey, windowDays, usdContext, pool, options = {}) {
  return fetchJsonProbe(
    "tradingVolumeBySize",
    buildUrl(baseUrl, "/api/trading-volume-by-size", {
      poolAddress: poolKey,
      days: windowDays,
      mode: "aggregate",
      token0Usd: usdContext.token0Usd,
      token1Usd: usdContext.token1Usd,
      token0Decimals: pool.token0Decimals,
      token1Decimals: pool.token1Decimals,
    }),
    summarizeTradingVolumeBySizeResponse,
    options,
  );
}

async function fetchLpSwapsProbe(baseUrl, poolKey, startTime, endTime, options = {}) {
  return fetchJsonProbe(
    "lpSwaps",
    buildUrl(baseUrl, "/api/lp-swaps", {
      pool: poolKey,
      startTime,
      endTime,
    }),
    summarizeLpSwapsResponse,
    options,
  );
}

async function fetchWorldchainEntityProbe(baseUrl, entity, params, options = {}) {
  return fetchJsonProbe(
    entity,
    buildUrl(baseUrl, `/api/entities/${entity}`, params),
    summarizeWorldchainEntityResponse,
    options,
  );
}

async function fetchJsonProbe(id, url, summarizer = (json) => json, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : null;
    if (!response.ok) {
      return {
        id,
        ok: false,
        status: response.status,
        url,
        error: parsed?.error || response.statusText || "Request failed",
      };
    }
    return {
      id,
      ok: true,
      status: response.status,
      url,
      data: summarizer(parsed),
      ...(options.includeRaw ? { raw: parsed } : {}),
    };
  } catch (error) {
    return {
      id,
      ok: false,
      status: 0,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function deriveAuditState(snapshot) {
  const pool = snapshot.frontend.pool?.data ?? {};
  const capabilities = normalizeCapabilities(pool.capabilities);
  const poolData = snapshot.frontend.poolData?.data ?? {};
  const tokenPrices = snapshot.frontend.tokenPrices?.data ?? {};
  const tvlParity = summarizeTvlParityUsd(poolData.tvlParity, tokenPrices);

  const latestTradingSignal = maxDefined([
    poolData.latest?.latestTradingSignal,
    snapshot.frontend.candlesPrimary?.data?.latestTimestamp,
    snapshot.frontend.poolData?.data?.latest?.poolHourTimestamp,
    snapshot.frontend.poolData?.data?.latest?.tickUpdatedAt,
    snapshot.frontend.lpSwaps?.data?.latestTimestamp,
  ]);
  const staleThreshold = Math.max(7 * DAY_SECONDS, snapshot.meta.windowDays * DAY_SECONDS);
  const hasRecentActivity =
    hasFiniteNumber(latestTradingSignal) &&
    snapshot.meta.now - latestTradingSignal <= Math.max(3 * DAY_SECONDS, snapshot.meta.windowDays * DAY_SECONDS);
  const latestPositionUpdatedAt = snapshot.frontend.poolData?.data?.latest?.positionUpdatedAt ?? null;
  const latestLpEventTimestamp = snapshot.frontend.poolData?.data?.latest?.lpEventTimestamp ?? null;

  const positionsFresh =
    typeof poolData.freshness?.positionUpdatedWithinWindow === "boolean"
      ? poolData.freshness.positionUpdatedWithinWindow
      : !poolData.positionCount
        ? false
        : !hasFiniteNumber(latestTradingSignal)
          ? hasFiniteNumber(latestPositionUpdatedAt)
          : hasFiniteNumber(latestPositionUpdatedAt) &&
            latestTradingSignal - latestPositionUpdatedAt <= staleThreshold;

  const lpEventsFresh =
    typeof poolData.freshness?.lpEventsPresentInWindow === "boolean"
      ? poolData.freshness.lpEventsPresentInWindow
      : !poolData.lpEventCount
        ? false
        : !hasFiniteNumber(latestTradingSignal)
          ? hasFiniteNumber(latestLpEventTimestamp)
          : hasFiniteNumber(latestLpEventTimestamp) &&
            latestTradingSignal - latestLpEventTimestamp <= staleThreshold;

  const positionCoverageRatio = toFiniteNumber(
    poolData.positionValueCoverageRatio ?? poolData.positionCoverageRatio,
  );
  const positionCoverageStatus =
    positionCoverageRatio === null
      ? poolData.positionCount > 0
        ? "unknown"
        : "broken"
      : positionCoverageRatio >= 0.75
        ? "ok"
        : positionCoverageRatio >= 0.5
          ? "degraded"
          : "broken";
  const positionCoverageAdequate =
    positionCoverageStatus === "ok" || (positionCoverageStatus === "unknown" && poolData.positionCount > 0);

  const frontendPoolDataHealthy =
    Boolean(snapshot.frontend.poolData?.ok) &&
    (poolData.positionCount > 0 ||
      poolData.lpEventCount > 0 ||
      poolData.poolHourCount > 0 ||
      poolData.tickLiquidityCount > 0);
  const hasOwnerSummary =
    (poolData.ownerAggregateCount ?? 0) > 0 ||
    (poolData.ownerCount ?? 0) > 0 ||
    Boolean(snapshot.upstream?.probes?.ownerAggregate?.ok);
  const authoritativeEmptyWindow =
    Boolean(poolData.authoritativeEmptyWindow) ||
    ((poolData.lpEventCount ?? 0) === 0 &&
      (poolData.poolHourCount ?? 0) > 0 &&
      (poolData.tickLiquidityCount ?? 0) > 0 &&
      (poolData.positionCount ?? 0) > 0);
  const distributionSource =
    poolData.decisions?.distributionSource ??
    (poolData.positionCount > 0 && positionsFresh && positionCoverageAdequate
      ? "positions"
      : poolData.tickLiquidityCount > 0
        ? "ticks"
        : "empty");
  const eventTimeSeriesSource =
    poolData.decisions?.eventTimeSeriesSource ??
    ((poolData.lpEventCount ?? 0) > 0 ? "events" : authoritativeEmptyWindow ? "zero-fill" : "none");
  const tvlPoolLiquidity = parseBigInt(tvlParity?.poolLiquidityRaw ?? pool.liquidity);
  const tvlTickLiquidity =
    tvlParity?.tickNetLiquidityAtCurrentTickRaw === null ||
    typeof tvlParity?.tickNetLiquidityAtCurrentTickRaw === "undefined"
      ? null
      : parseBigInt(tvlParity.tickNetLiquidityAtCurrentTickRaw);
  const tvlInRangePositionLiquidity =
    tvlParity?.inRangePositionLiquidityRaw === null ||
    typeof tvlParity?.inRangePositionLiquidityRaw === "undefined"
      ? null
      : parseBigInt(tvlParity.inRangePositionLiquidityRaw);
  const isActiveLiquidityEmpty =
    tvlPoolLiquidity === 0n &&
    (tvlTickLiquidity === null || tvlTickLiquidity === 0n) &&
    (tvlInRangePositionLiquidity === null || tvlInRangePositionLiquidity === 0n);

  return {
    meta: snapshot.meta,
    frontend: snapshot.frontend,
    upstream: snapshot.upstream,
    pool,
    capabilities,
    pairLabel: [pool.token0Symbol, pool.token1Symbol].filter(Boolean).join(" / ") || snapshot.meta.poolKey,
    hasPrimaryCandles: (snapshot.frontend.candlesPrimary?.data?.count ?? 0) > 0,
    hasDailyCandles: (snapshot.frontend.candlesDaily?.data?.count ?? 0) > 0,
    hasPoolHours: (poolData.poolHourCount ?? 0) > 0,
    hasPositions: (poolData.positionCount ?? 0) > 0,
    hasTickLiquidity: (poolData.tickLiquidityCount ?? 0) > 0,
    hasOwners: Math.max(poolData.ownerCount ?? 0, poolData.ownerAggregateCount ?? 0) > 0,
    hasOwnerSummary,
    hasLpEvents: (poolData.lpEventCount ?? 0) > 0,
    hasOracleHistory: (snapshot.frontend.historicalPrices?.data?.count ?? 0) > 0,
    hasSwapHistoryWindow: (snapshot.frontend.lpSwaps?.data?.count ?? 0) > 0,
    hasRecentActivity,
    positionCoverageAdequate,
    positionCoverageStatus,
    positionCoverageRatio,
    positionInputsHealthy: Boolean(poolData.positionCount) && positionCoverageAdequate && positionsFresh,
    positionInputsDegraded:
      Boolean(poolData.positionCount) &&
      positionsFresh &&
      positionCoverageStatus === "degraded",
    positionsFresh,
    lpEventsFresh,
    authoritativeEmptyWindow,
    currentStateStatus:
      isActiveLiquidityEmpty ? "empty" : poolData.currentStateStatus ?? (frontendPoolDataHealthy ? "renderable" : "empty"),
    distributionSource,
    eventTimeSeriesSource,
    selectedOwnerAvailable:
      !isActiveLiquidityEmpty &&
      Boolean(poolData.selectedOwner?.owner) &&
      (poolData.selectedOwner?.positionCount ?? 0) > 0,
    hasCompleteUsdContext: Boolean(tokenPrices.hasCompleteUsdContext),
    tvlParity,
    frontendPoolDataHealthy,
    latestTradingSignal,
    isActiveLiquidityEmpty,
  };
}

function summarizeTvlParityUsd(tvlParity, tokenPrices) {
  if (!tvlParity || typeof tvlParity !== "object") return null;
  const token0Usd = toFiniteNumber(tokenPrices?.token0Usd);
  const token1Usd = toFiniteNumber(tokenPrices?.token1Usd);
  const hasUsd = token0Usd !== null && token1Usd !== null;
  const positionToken0 = toFiniteNumber(tvlParity.positionToken0Balance);
  const positionToken1 = toFiniteNumber(tvlParity.positionToken1Balance);
  const poolToken0 = toFiniteNumber(tvlParity.poolToken0Balance);
  const poolToken1 = toFiniteNumber(tvlParity.poolToken1Balance);

  const positionTvlUsd =
    hasUsd && positionToken0 !== null && positionToken1 !== null
      ? positionToken0 * token0Usd + positionToken1 * token1Usd
      : null;
  const poolBalanceTvlUsd =
    hasUsd && poolToken0 !== null && poolToken1 !== null
      ? poolToken0 * token0Usd + poolToken1 * token1Usd
      : null;
  const displayedTvlUsd =
    poolBalanceTvlUsd !== null && poolBalanceTvlUsd > 0 ? poolBalanceTvlUsd : positionTvlUsd;

  return {
    ...tvlParity,
    positionTvlUsd: hasFiniteNumber(positionTvlUsd) ? Number(positionTvlUsd.toFixed(2)) : null,
    poolBalanceTvlUsd: hasFiniteNumber(poolBalanceTvlUsd) ? Number(poolBalanceTvlUsd.toFixed(2)) : null,
    displayedTvlUsd: hasFiniteNumber(displayedTvlUsd) ? Number(displayedTvlUsd.toFixed(2)) : null,
  };
}

function summarizePoolTvlParity({ positions, tickLiquidities, pool }) {
  const currentTick = toFiniteNumber(pool.tick);
  const poolLiquidity = parseBigInt(pool.liquidity);
  const sqrtPriceX96 = parseBigInt(pool.sqrtPriceX96);
  const token0Decimals = toFiniteNumber(pool.token0Decimals) ?? 0;
  const token1Decimals = toFiniteNumber(pool.token1Decimals) ?? 0;
  const poolToken0Balance = toFiniteNumber(pool.token0Balance);
  const poolToken1Balance = toFiniteNumber(pool.token1Balance);
  const currentPrice = toFiniteNumber(pool.currentPrice);

  let tickNetLiquidityAtCurrentTick = null;
  if (currentTick !== null && tickLiquidities.length > 0) {
    let tickLiquidity = 0n;
    for (const tickRow of tickLiquidities) {
      const tick = toFiniteNumber(tickRow.tick);
      if (tick === null || tick > currentTick) continue;
      tickLiquidity += parseBigInt(tickRow.liquidityNet);
    }
    tickNetLiquidityAtCurrentTick = tickLiquidity;
  }

  let inRangePositionLiquidity = null;
  if (currentTick !== null && positions.length > 0) {
    let liquidity = 0n;
    for (const position of positions) {
      const tickLower = toFiniteNumber(position.tickLower);
      const tickUpper = toFiniteNumber(position.tickUpper);
      if (tickLower === null || tickUpper === null) continue;
      if (tickLower <= currentTick && currentTick < tickUpper) {
        liquidity += parseBigInt(position.liquidity);
      }
    }
    inRangePositionLiquidity = liquidity;
  }

  let positionToken0Raw = 0n;
  let positionToken1Raw = 0n;
  let usablePositionCount = 0;
  if (sqrtPriceX96 > 0n) {
    for (const position of positions) {
      const liquidity = parseBigInt(position.liquidity);
      const tickLower = toFiniteNumber(position.tickLower);
      const tickUpper = toFiniteNumber(position.tickUpper);
      if (liquidity <= 0n || tickLower === null || tickUpper === null || tickLower >= tickUpper) {
        continue;
      }
      try {
        const { amount0, amount1 } = amountsForPosition({
          liquidity,
          tickLower,
          tickUpper,
          sqrtPriceX96,
        });
        positionToken0Raw += amount0;
        positionToken1Raw += amount1;
        usablePositionCount += 1;
      } catch {
        // Ignore malformed tick ranges and keep the audit running.
      }
    }
  }

  const positionToken0Balance = bigintToApproxNumber(positionToken0Raw, token0Decimals);
  const positionToken1Balance = bigintToApproxNumber(positionToken1Raw, token1Decimals);
  const positionValueInToken1 =
    currentPrice !== null && currentPrice > 0
      ? positionToken0Balance * currentPrice + positionToken1Balance
      : null;
  const poolBalanceValueInToken1 =
    poolToken0Balance !== null &&
    poolToken1Balance !== null &&
    currentPrice !== null &&
    currentPrice > 0
      ? poolToken0Balance * currentPrice + poolToken1Balance
      : null;
  const displayedValueInToken1 =
    poolBalanceValueInToken1 !== null && poolBalanceValueInToken1 > 0
      ? poolBalanceValueInToken1
      : positionValueInToken1;

  const liquidityRatio = (value) =>
    value === null || poolLiquidity <= 0n ? null : Number((Number(value) / Number(poolLiquidity)).toFixed(4));
  const liquidityMatches = (value) => (value === null ? null : value === poolLiquidity);
  const rounded = (value, digits = 6) =>
    hasFiniteNumber(value) ? Number(value.toFixed(digits)) : null;

  return {
    currentTick,
    poolLiquidityRaw: poolLiquidity.toString(),
    tickNetLiquidityAtCurrentTickRaw:
      tickNetLiquidityAtCurrentTick === null ? null : tickNetLiquidityAtCurrentTick.toString(),
    inRangePositionLiquidityRaw:
      inRangePositionLiquidity === null ? null : inRangePositionLiquidity.toString(),
    tickNetLiquidityCoverageRatio: liquidityRatio(tickNetLiquidityAtCurrentTick),
    inRangePositionLiquidityCoverageRatio: liquidityRatio(inRangePositionLiquidity),
    poolLiquidityMatchesTickNet: liquidityMatches(tickNetLiquidityAtCurrentTick),
    poolLiquidityMatchesInRangePositions: liquidityMatches(inRangePositionLiquidity),
    positionCount: positions.length,
    usablePositionCount,
    tickLiquidityCount: tickLiquidities.length,
    positionToken0Balance: rounded(positionToken0Balance),
    positionToken1Balance: rounded(positionToken1Balance),
    poolToken0Balance: poolToken0Balance === null ? null : rounded(poolToken0Balance),
    poolToken1Balance: poolToken1Balance === null ? null : rounded(poolToken1Balance),
    positionValueInToken1: rounded(positionValueInToken1, 4),
    poolBalanceValueInToken1: rounded(poolBalanceValueInToken1, 4),
    displayedValueInToken1: rounded(displayedValueInToken1, 4),
    displayedSource:
      poolBalanceValueInToken1 !== null && poolBalanceValueInToken1 > 0
        ? "pool-balances"
        : positionValueInToken1 !== null
          ? "positions"
          : "unavailable",
  };
}

function summarizePoolData(json, pool) {
  const positions = Array.isArray(json.positions) ? json.positions : [];
  const ownerAggregates = Array.isArray(json.ownerAggregates) ? json.ownerAggregates : [];
  const lpEvents = Array.isArray(json.lpevents) ? json.lpevents : [];
  const poolHourDatas = Array.isArray(json.poolHourDatas) ? json.poolHourDatas : [];
  const tickLiquidities = Array.isArray(json.tickLiquidities) ? json.tickLiquidities : [];
  const lpActivitySeries = Array.isArray(json.lpActivitySeries) ? json.lpActivitySeries : [];
  const explicitMeta = json?.meta ?? null;
  const tvlParity = summarizePoolTvlParity({ positions, tickLiquidities, pool });

  const ownerMap = new Map();
  for (const position of positions) {
    const owner = normalizeString(position.owner)?.toLowerCase();
    if (!owner) continue;
    const liquidity = parseBigInt(position.liquidity);
    const existing = ownerMap.get(owner) ?? {
      owner,
      positionCount: 0,
      liquidity: 0n,
    };
    existing.positionCount += 1;
    existing.liquidity += liquidity;
    ownerMap.set(owner, existing);
  }

  const selectedOwner = [...ownerMap.values()].sort((left, right) => {
    return right.liquidity > left.liquidity ? 1 : right.liquidity < left.liquidity ? -1 : 0;
  })[0] ?? null;

  if (explicitMeta) {
    return {
      positionCount: explicitMeta.counts?.positions ?? positions.length,
      lpEventCount: explicitMeta.counts?.lpevents ?? lpEvents.length,
      poolHourCount: explicitMeta.counts?.poolHourDatas ?? poolHourDatas.length,
      tickLiquidityCount: explicitMeta.counts?.tickLiquidities ?? tickLiquidities.length,
      lpActivitySeriesCount: explicitMeta.counts?.lpActivitySeries ?? lpActivitySeries.length,
      ownerCount:
        Math.max(
          explicitMeta.counts?.ownerAggregates ?? 0,
          explicitMeta.counts?.ownerAddressesWithPositions ?? 0,
        ) || ownerMap.size,
      ownerAggregateCount: explicitMeta.counts?.ownerAggregates ?? ownerAggregates.length,
      ownerAggregatesMissingPositions:
        explicitMeta.counts?.ownerAggregatesMissingPositions ?? 0,
      selectedOwner: explicitMeta.selectedOwner ??
        (selectedOwner
          ? {
              owner: selectedOwner.owner,
              positionCount: selectedOwner.positionCount,
              liquidity: selectedOwner.liquidity.toString(),
            }
          : null),
      positionCoverageRatio:
        explicitMeta.coverage?.valueRatio ?? explicitMeta.coverage?.rawLiquidityRatio ?? null,
      positionValueCoverageRatio: explicitMeta.coverage?.valueRatio ?? null,
      positionRawLiquidityCoverageRatio: explicitMeta.coverage?.rawLiquidityRatio ?? null,
      tvlParity,
      authoritativeEmptyWindow: Boolean(explicitMeta.authoritativeEmptyWindow),
      currentStateStatus: explicitMeta.currentStateStatus ?? "empty",
      decisions: explicitMeta.decisions ?? null,
      freshness: explicitMeta.freshness ?? null,
      latest: {
        positionUpdatedAt: explicitMeta.latest?.positionUpdatedAt ?? null,
        ownerAggregateUpdatedAt: explicitMeta.latest?.ownerAggregateUpdatedAt ?? null,
        lpEventTimestamp: explicitMeta.latest?.lpEventTimestamp ?? null,
        poolHourTimestamp: explicitMeta.latest?.poolHourTimestamp ?? null,
        tickUpdatedAt: explicitMeta.latest?.tickUpdatedAt ?? null,
        latestTradingSignal: explicitMeta.latest?.latestTradingSignal ?? null,
      },
    };
  }

  const currentTick = toFiniteNumber(pool.tick);
  const inRangePositionLiquidity =
    currentTick === null
      ? null
      : positions.reduce((total, position) => {
          const tickLower = toFiniteNumber(position.tickLower);
          const tickUpper = toFiniteNumber(position.tickUpper);
          if (tickLower === null || tickUpper === null) return total;
          if (tickLower <= currentTick && currentTick < tickUpper) {
            return total + parseBigInt(position.liquidity);
          }
          return total;
        }, 0n);
  const poolLiquidity = parseBigInt(pool.liquidity);
  const positionRawLiquidityCoverageRatio =
    currentTick === null || poolLiquidity <= 0n || inRangePositionLiquidity === null
      ? null
      : Number(inRangePositionLiquidity) / Number(poolLiquidity);

  const sqrtPriceX96 = parseBigInt(pool.sqrtPriceX96);
  const token0Decimals = toFiniteNumber(pool.token0Decimals) ?? 0;
  const token1Decimals = toFiniteNumber(pool.token1Decimals) ?? 0;
  const poolToken0Balance = toFiniteNumber(pool.token0Balance);
  const poolToken1Balance = toFiniteNumber(pool.token1Balance);
  const currentPrice = toFiniteNumber(pool.currentPrice);

  let positionToken0Total = 0;
  let positionToken1Total = 0;
  if (sqrtPriceX96 > 0n) {
    for (const position of positions) {
      const liquidity = parseBigInt(position.liquidity);
      const tickLower = toFiniteNumber(position.tickLower);
      const tickUpper = toFiniteNumber(position.tickUpper);
      if (liquidity <= 0n || tickLower === null || tickUpper === null || tickLower >= tickUpper) {
        continue;
      }
      try {
        const { amount0, amount1 } = amountsForPosition({
          liquidity,
          tickLower,
          tickUpper,
          sqrtPriceX96,
        });
        positionToken0Total += bigintToApproxNumber(amount0, token0Decimals);
        positionToken1Total += bigintToApproxNumber(amount1, token1Decimals);
      } catch {
        // Ignore malformed tick ranges and keep the audit running.
      }
    }
  }

  const positionValueCoverageRatio =
    poolToken0Balance === null ||
    poolToken1Balance === null ||
    currentPrice === null ||
    currentPrice <= 0
      ? null
      : (() => {
          const poolValueInToken1 = poolToken0Balance * currentPrice + poolToken1Balance;
          if (!Number.isFinite(poolValueInToken1) || poolValueInToken1 <= 0) return null;
          const positionValueInToken1 = positionToken0Total * currentPrice + positionToken1Total;
          if (!Number.isFinite(positionValueInToken1) || positionValueInToken1 < 0) return null;
          return positionValueInToken1 / poolValueInToken1;
        })();

  return {
    positionCount: positions.length,
    lpEventCount: lpEvents.length,
    poolHourCount: poolHourDatas.length,
    tickLiquidityCount: tickLiquidities.length,
    lpActivitySeriesCount: lpActivitySeries.length,
    ownerCount: ownerMap.size,
    ownerAggregateCount: ownerAggregates.length,
    ownerAggregatesMissingPositions: 0,
    selectedOwner: selectedOwner
      ? {
          owner: selectedOwner.owner,
          positionCount: selectedOwner.positionCount,
          liquidity: selectedOwner.liquidity.toString(),
        }
      : null,
    positionCoverageRatio:
      positionValueCoverageRatio !== null && Number.isFinite(positionValueCoverageRatio)
        ? Number(positionValueCoverageRatio.toFixed(4))
        : null,
    positionValueCoverageRatio:
      positionValueCoverageRatio !== null && Number.isFinite(positionValueCoverageRatio)
        ? Number(positionValueCoverageRatio.toFixed(4))
        : null,
    positionRawLiquidityCoverageRatio:
      positionRawLiquidityCoverageRatio !== null && Number.isFinite(positionRawLiquidityCoverageRatio)
        ? Number(positionRawLiquidityCoverageRatio.toFixed(4))
        : null,
    tvlParity,
    latest: {
      positionUpdatedAt: maxDefined(positions.map((position) => toFiniteNumber(position.updatedAt))),
      ownerAggregateUpdatedAt: maxDefined(ownerAggregates.map((row) => toFiniteNumber(row.updatedAt))),
      lpEventTimestamp: maxDefined(lpEvents.map((event) => toFiniteNumber(event.timestamp))),
      poolHourTimestamp: maxDefined(poolHourDatas.map((row) => toFiniteNumber(row.periodStartUnix))),
      tickUpdatedAt: maxDefined(tickLiquidities.map((row) => toFiniteNumber(row.updatedAt))),
      latestTradingSignal: maxDefined([
        maxDefined(poolHourDatas.map((row) => toFiniteNumber(row.periodStartUnix))),
        maxDefined(tickLiquidities.map((row) => toFiniteNumber(row.updatedAt))),
      ]),
    },
    authoritativeEmptyWindow: false,
    currentStateStatus:
      tickLiquidities.length > 0 || positions.length > 0 || ownerAggregates.length > 0
        ? "renderable"
        : "empty",
    decisions: null,
    freshness: null,
  };
}

function summarizeCandleSeries(json, intervalSeconds) {
  const candles = Array.isArray(json) ? json : [];
  return {
    intervalSeconds,
    count: candles.length,
    firstTimestamp: candles.length > 0 ? toFiniteNumber(candles[0]?.timestamp) : null,
    latestTimestamp: candles.length > 0 ? toFiniteNumber(candles[candles.length - 1]?.timestamp) : null,
  };
}

function summarizeTokenPrices(json, pool) {
  const pricesByAddress = json?.pricesUsdByAddress ?? {};
  const token0Address = normalizeString(pool.token0Address)?.toLowerCase() ?? "";
  const token1Address = normalizeString(pool.token1Address)?.toLowerCase() ?? "";
  const token0Raw = toFiniteNumber(pricesByAddress[token0Address]);
  const token1Raw = toFiniteNumber(pricesByAddress[token1Address]);
  const currentPrice = toFiniteNumber(pool.currentPrice);

  const token0Usd =
    token0Raw ??
    (token1Raw !== null && currentPrice !== null && currentPrice > 0 ? token1Raw * currentPrice : null);
  const token1Usd =
    token1Raw ??
    (token0Raw !== null && currentPrice !== null && currentPrice > 0 ? token0Raw / currentPrice : null);

  return {
    token0Usd: hasFiniteNumber(token0Usd) ? Number(token0Usd.toFixed(8)) : null,
    token1Usd: hasFiniteNumber(token1Usd) ? Number(token1Usd.toFixed(8)) : null,
    hasCompleteUsdContext: hasFiniteNumber(token0Usd) && hasFiniteNumber(token1Usd),
  };
}

function summarizeHistoricalPricesResponse(json) {
  const prices = Array.isArray(json?.prices) ? json.prices : [];
  return {
    count: prices.length,
    firstTimestamp: prices.length > 0 ? toFiniteNumber(prices[0]?.timestamp) : null,
    latestTimestamp: prices.length > 0 ? toFiniteNumber(prices[prices.length - 1]?.timestamp) : null,
  };
}

function summarizeTradingVolumeBySizeResponse(json) {
  const dailyData = Array.isArray(json?.dailyData) ? json.dailyData : [];
  return {
    dayCount: dailyData.length,
    firstDateKey: dailyData.length > 0 ? normalizeString(dailyData[0]?.dateKey) : null,
    latestDateKey:
      dailyData.length > 0 ? normalizeString(dailyData[dailyData.length - 1]?.dateKey) : null,
  };
}

function summarizeLpSwapsResponse(json) {
  const swaps = Array.isArray(json) ? json : [];
  return {
    count: swaps.length,
    firstTimestamp: swaps.length > 0 ? toFiniteNumber(swaps[0]?.timestamp) : null,
    latestTimestamp: swaps.length > 0 ? toFiniteNumber(swaps[swaps.length - 1]?.timestamp) : null,
  };
}

function summarizeWorldchainEntityResponse(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return {
    rowCount: rows.length,
    latestTimestamp: maxDefined(
      rows.flatMap((row) => [
        toFiniteNumber(row.updatedAt),
        toFiniteNumber(row.timestamp),
        toFiniteNumber(row.periodStartUnix),
        toFiniteNumber(row.date),
      ]),
    ),
  };
}

function summarizeSolanaCandlesResponse(json) {
  const rows = Array.isArray(json?.series) ? json.series : [];
  return {
    rowCount: rows.length,
    latestTimestamp: maxDefined(rows.map((row) => toFiniteNumber(row.timestamp))),
  };
}

function summarizeSolanaCollectionResponse(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return {
    rowCount: rows.length,
    latestTimestamp: maxDefined(
      rows.flatMap((row) => [
        toUnixTimestamp(row.block_time),
        toUnixTimestamp(row.timestamp),
        toFiniteNumber(row.updatedAt),
        toFiniteNumber(row.updated_at),
      ]),
    ),
  };
}

function summarizeSolanaVolumeBySizeResponse(json) {
  const rows = Array.isArray(json?.series) ? json.series : [];
  return {
    rowCount: rows.length,
    latestTimestamp: maxDefined(rows.map((row) => toFiniteNumber(row.timestamp))),
  };
}

function summarizeUpstreamTimestampProbe(probe, fieldName) {
  if (!probe.ok) return probe;
  return {
    ...probe,
    data: {
      latestTimestamp: toUnixTimestamp(probe.data?.[fieldName]) ?? probe.data?.latestTimestamp ?? null,
    },
  };
}

function requirePoolSnapshot(ctx, id, title, probeIds) {
  if (ctx.frontend.pool?.ok && ctx.pool.protocol) {
    return null;
  }
  return makeChartResult(id, title, "broken", {
    probeIds,
    reasons: ["The pool snapshot endpoint did not return enough metadata to evaluate this chart."],
    rootCauses: ["missing_pool_snapshot"],
  });
}

function requireUsdContext(ctx, id, title, probeIds) {
  if (ctx.hasCompleteUsdContext) return null;
  return makeChartResult(id, title, "broken", {
    probeIds,
    reasons: ["This chart depends on complete USD pricing context for both pool tokens."],
    rootCauses: ["missing_usd_context"],
  });
}

function requireCandles(ctx, { id, title, probeIds }) {
  const missingPool = requirePoolSnapshot(ctx, id, title, probeIds);
  if (missingPool) return missingPool;
  if (ctx.hasPrimaryCandles) return null;
  return missingDatasetResult(ctx, id, title, {
    probeIds,
    missing: "candle history",
    rootCauses: ["missing_candle_history"],
  });
}

function requireSelectedOwner(ctx, id, title, probeIds) {
  if (ctx.selectedOwnerAvailable) return null;
  if (ctx.isActiveLiquidityEmpty) {
    return emptyLiquidityResult(id, title, probeIds);
  }
  return makeChartResult(id, title, "degraded", {
    probeIds,
    reasons: ["The dashboard cannot pick an active LP owner for this pool, so the owner-scoped view stays disabled."],
    rootCauses: ["owner_selection_unavailable"],
  });
}

function evaluateOwnerScopedDistributionChart(ctx, { id, title }) {
  const ownerGate = requireSelectedOwner(ctx, id, title, ["poolData"]);
  if (ownerGate) return ownerGate;
  if (ctx.currentStateStatus === "renderable") {
    return okResult(id, title, ["poolData"]);
  }
  return missingDatasetResult(ctx, id, title, {
    probeIds: ["poolData"],
    missing: "positions",
    rootCauses: ["missing_positions"],
  });
}

function missingDatasetResult(ctx, id, title, { probeIds, missing, rootCauses = [] }) {
  if (ctx.isActiveLiquidityEmpty && rootCauses.includes("missing_positions")) {
    return emptyLiquidityResult(id, title, probeIds);
  }
  const status = ctx.hasRecentActivity ? "broken" : "degraded";
  return makeChartResult(id, title, status, {
    probeIds,
    reasons: [
      `Missing ${missing}${status === "degraded" ? " while the pool also shows little or no recent activity." : " even though the pool has recent activity."}`,
    ],
    rootCauses,
  });
}

function emptyLiquidityResult(id, title, probeIds) {
  return okResult(id, title, probeIds, [
    "Pool has zero active liquidity, so LP-owner and concentration views are expected to be empty.",
  ]);
}

function collectRootCauses(ctx, flags = {}) {
  const out = [];
  if (flags.includePosition && !ctx.positionsFresh) out.push("position_stale_or_incomplete");
  if (flags.includePosition && ctx.positionCoverageStatus === "degraded") out.push("position_value_coverage_partial");
  if (flags.includePosition && ctx.positionCoverageStatus === "broken") out.push("position_value_coverage_low");
  if (flags.includeEvents && !ctx.lpEventsFresh) out.push("lpevent_stale");
  if (flags.includeUsd && !ctx.hasCompleteUsdContext) out.push("missing_usd_context");
  if (flags.includeOwner && !ctx.selectedOwnerAvailable) out.push("owner_selection_unavailable");
  return [...new Set(out)];
}

function hasHealthyUpstreamVolumeBuckets(ctx) {
  if (ctx.upstream?.kind === "worldchain") {
    return Boolean(ctx.upstream.probes?.poolDailyVolumeBySize?.ok);
  }
  if (ctx.upstream?.kind === "solana") {
    return Boolean(ctx.upstream.probes?.volumeBySize?.ok);
  }
  return false;
}

function makeChartResult(id, title, status, { reasons = [], rootCauses = [], probeIds = [], notes = [] } = {}) {
  return {
    id,
    title,
    status,
    reasons,
    rootCauses: [...new Set(rootCauses)],
    probeIds,
    notes,
  };
}

function okResult(id, title, probeIds, notes = []) {
  return makeChartResult(id, title, "ok", { probeIds, notes });
}

function unionRootCauses(lists) {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

function shouldFetchSwapHistory(pool) {
  return normalizeString(pool.protocol) === "v3";
}

async function loadEnvConfig(cwd) {
  const files = [".env", ".env.local"];
  const values = {};
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(cwd, file), "utf8");
      parseDotEnv(content, values);
    } catch {
      // ignore missing env files
    }
  }
  return {
    worldchainRailwayBase:
      normalizeString(values.WORLDCHAIN_INDEXER_API_URL) || DEFAULT_WORLDCHAIN_RAILWAY_BASE,
    solanaRailwayBase:
      normalizeString(values.SOLANA_INDEXER_API_URL) ||
      normalizeString(values.NEXT_PUBLIC_SOLANA_INDEXER_API_URL) ||
      DEFAULT_SOLANA_RAILWAY_BASE,
  };
}

function parseDotEnv(content, target) {
  const lines = content.split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    target[key] = value;
  }
}

function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(pathname, ensureTrailingSlash(baseUrl));
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/u, "");
}

function inferPoolKind(poolKey) {
  if (isSolanaPoolKey(poolKey)) return "solana";
  if (isEvmAddress(poolKey) || isV4PoolKey(poolKey)) return "worldchain";
  return "unknown";
}

function isEvmAddress(value) {
  return /^0x[0-9a-f]{40}$/iu.test(value);
}

function isV4PoolKey(value) {
  return /^\d+-v4-0x[0-9a-f]{64}$/iu.test(value);
}

function isSolanaPoolKey(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value);
}

function normalizePoolKey(poolKey) {
  const trimmed = String(poolKey ?? "").trim();
  return isSolanaPoolKey(trimmed) ? trimmed : trimmed.toLowerCase();
}

function normalizeCapabilities(value) {
  return {
    ...BASE_CAPABILITIES,
    ...(value && typeof value === "object" ? value : {}),
  };
}

function normalizeFailOn(value) {
  const statuses = Array.isArray(value) ? value : String(value ?? "").split(",");
  return statuses
    .map((status) => status.trim())
    .filter((status) => status === "broken" || status === "degraded");
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUnixTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const direct = Number(value);
    if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
    const time = Date.parse(value);
    if (Number.isFinite(time)) return Math.floor(time / 1000);
  }
  return null;
}

function normalizeIntegerLike(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/u.test(value.trim())) return value.trim();
  return "0";
}

function parseBigInt(value) {
  try {
    return BigInt(normalizeIntegerLike(value));
  } catch {
    return 0n;
  }
}

function maxDefined(values) {
  const filtered = values.filter((value) => hasFiniteNumber(value));
  if (filtered.length === 0) return null;
  return Math.max(...filtered);
}

function hasFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function skippedProbe(id, reason) {
  return {
    id,
    ok: false,
    skipped: true,
    status: null,
    reason,
  };
}
