"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scalePoint } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { cn } from "@/lib/utils";
import { ZEROG_CHAIN_ID } from "@/lib/pools";
import { usePoolData } from "@/hooks/use-pool-data";
import { useTokenPrices } from "@/hooks/use-token-price";
import { usePoolDayData } from "@/hooks/use-pool-metrics";
import { useLiquidityHistoryByAddress } from "@/hooks/use-liquidity-history-by-address";
import { useMerklCampaignIncentives } from "@/hooks/use-merkl-campaign-incentives";
import type { ZerogMerklCampaign } from "@/hooks/use-zerog-merkl-opportunity";
import {
  CampaignTvlRangeSelector,
  CAMPAIGN_TVL_DEFAULT_RANGE,
} from "./campaign-tvl-range-selector";

// One distinct color per pool line (cyan, violet, amber, emerald, red, blue).
const POOL_COLORS = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6"];
const DAY = 86400;

// Wallets treated as "0G Foundation" — toggled out of the TVL/depth numerators.
const FOUNDATION_WALLETS = new Set<string>([
  "0x6927779c4d8726241dc39606778eaaa5b4757372",
  "0x55ce0d1fc77a6a3fd3e17453bbaa5fd977081c32",
  "0xd8647c2e8ee29714ca82029b6d59c25ee851071d",
  "0x9585354ff9778813eacd5850498185c932bb99e9",
  "0x1119c4ce8f56d96a51b5a38260fede037c7126f5",
  "0x41501185c3a4e79a33bc48aff202b86f5ac35034",
  "0xb395ae167c64d68c2cf1b669e1b06340f4ccf079",
  // Concentrated wallets — also toggled out via the 0G Foundation filter.
  "0xaa8b95cb39b41a9c9624abc85ec5a2b3182bf77b",
  "0x2815c10740f4d738b20fdc13167c865380156623",
  "0x4988d104d6d0902812fa3b6bc66b2ff5a6fce409",
  "0x46960b436d30e7e7743e7c6075d704e7ea96df23",
  "0xe4a870380e8c5b17c96b3cef307e249504822c58",
]);

type Metric = "tvl" | "depth" | "depthUsd" | "fees";

export interface IncentiveEfficiencyPool {
  poolKey: string;
  poolLabel: string;
  campaigns: ZerogMerklCampaign[];
}

interface EfficiencyPoint {
  date: number; // day-start unix seconds
  dateStr: string;
  multiplier: number; // numerator / the live campaign's allocated incentive
  numerator: number; // TVL, or campaign-wallet ±1% depth (USD)
  budget: number; // incentive allocated to the campaign live that day (USD)
}

function formatMultiplier(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k×`;
  if (n >= 100) return `${Math.round(n)}×`;
  if (n >= 10) return `${n.toFixed(0)}×`;
  return `${n.toFixed(1)}×`;
}

function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Allocated incentive (USD) of the campaign(s) live on each day, keyed by
 *  day-start. A campaign's full allocated budget applies only on the days it is
 *  running (start..end); days with no live campaign get 0. This makes the
 *  multiplier `TVL ÷ the incentive allocated to the campaign running that day`,
 *  not a running total of every campaign ever committed. Overlapping campaigns
 *  on the same day are summed. */
function buildCommittedBudgetByDay(campaigns: ZerogMerklCampaign[]): Map<number, number> {
  const map = new Map<number, number>();
  if (campaigns.length === 0) return map;
  const budgets = campaigns.map((c) => {
    const startDay = Math.floor(c.startTimestamp / DAY) * DAY;
    const endDay = Math.floor(c.endTimestamp / DAY) * DAY;
    const fullDays = Math.max(1, (c.endTimestamp - c.startTimestamp) / DAY);
    return { startDay, endDay, fullBudgetUsd: c.dailyRewardUsd * fullDays };
  });
  const minStart = Math.min(...budgets.map((b) => b.startDay));
  if (!Number.isFinite(minStart)) return map;
  const nowDay = Math.floor(Date.now() / 1000 / DAY) * DAY;
  for (let d = minStart; d <= nowDay; d += DAY) {
    let active = 0;
    for (const b of budgets) if (d >= b.startDay && d <= b.endDay) active += b.fullBudgetUsd;
    map.set(d, active);
  }
  return map;
}

/** Incentive SPEND per day (USD), keyed by day-start: the `dailyRewardUsd` of
 *  every campaign live that day, summed. This is the daily-rate denominator for
 *  the "Fees × Incentive" tab — fees generated vs incentive spent that same day —
 *  as opposed to `buildCommittedBudgetByDay`'s full-committed-budget denominator. */
function buildDailyIncentiveByDay(campaigns: ZerogMerklCampaign[]): Map<number, number> {
  const map = new Map<number, number>();
  if (campaigns.length === 0) return map;
  const rates = campaigns.map((c) => ({
    startDay: Math.floor(c.startTimestamp / DAY) * DAY,
    endDay: Math.floor(c.endTimestamp / DAY) * DAY,
    dailyUsd: c.dailyRewardUsd,
  }));
  const minStart = Math.min(...rates.map((r) => r.startDay));
  if (!Number.isFinite(minStart)) return map;
  const nowDay = Math.floor(Date.now() / 1000 / DAY) * DAY;
  for (let d = minStart; d <= nowDay; d += DAY) {
    let active = 0;
    for (const r of rates) if (d >= r.startDay && d <= r.endDay) active += r.dailyUsd;
    map.set(d, active);
  }
  return map;
}

/**
 * Hidden per-pool worker. Fetches the pool's daily TVL history (same path as the
 * Campaign-TVL chart) and, for the "depth" metric, also fetches campaign
 * recipients and computes the ±1% depth those wallets hold per day. Divides the
 * chosen numerator by committed campaign incentives and reports the series up.
 */
function PoolSeriesProbe({
  pool,
  lookbackDays,
  metric,
  excludeFoundation,
  onSeries,
}: {
  pool: IncentiveEfficiencyPool;
  lookbackDays: number;
  metric: Metric;
  excludeFoundation: boolean;
  onSeries: (poolKey: string, points: EfficiencyPoint[]) => void;
}) {
  const { data: poolData } = usePoolData(pool.poolKey);
  const tokenPriceMap = useTokenPrices([poolData?.token0Address, poolData?.token1Address]);
  // Raw CoinGecko prices — may be missing for bridged 0G tokens (e.g. WETH).
  const rawToken0Usd = poolData?.token0Address
    ? tokenPriceMap.data?.[poolData.token0Address.toLowerCase()] ?? null
    : null;
  const rawToken1Usd = poolData?.token1Address
    ? tokenPriceMap.data?.[poolData.token1Address.toLowerCase()] ?? null
    : null;
  // Anchor the missing side on the pool price (currentPrice = token1 per token0),
  // like the pool dashboard's `usdPrices`. Without this, a token CoinGecko can't
  // price (0G WETH) drops to null and its half of the TVL is lost — so a
  // WETH/USDC.e pool's TVL would only reflect the USDC.e side.
  const { token0UsdPrice, token1UsdPrice } = useMemo(() => {
    const p = poolData?.currentPrice;
    const ok = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
    const priceOk = ok(p ?? null) && (p as number) > 0;
    const t0 = ok(rawToken0Usd)
      ? rawToken0Usd
      : ok(rawToken1Usd) && priceOk
        ? rawToken1Usd * (p as number)
        : null;
    const t1 = ok(rawToken1Usd)
      ? rawToken1Usd
      : ok(rawToken0Usd) && priceOk
        ? rawToken0Usd / (p as number)
        : null;
    return { token0UsdPrice: t0, token1UsdPrice: t1 };
  }, [rawToken0Usd, rawToken1Usd, poolData?.currentPrice]);

  const { data: dayData } = usePoolDayData(pool.poolKey, lookbackDays + 2, true);
  const dailyPriceMap = useMemo(() => {
    if (!dayData) return undefined;
    const map = new Map<number, string>();
    for (const d of dayData) if (d.closePrice) map.set(d.date, d.closePrice);
    return map;
  }, [dayData]);

  // Primary campaign (live, else latest) drives the recipient roster for depth.
  const primaryCampaign = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    return [...pool.campaigns].sort((a, b) => {
      const al = a.startTimestamp <= nowSec && nowSec <= a.endTimestamp ? 1 : 0;
      const bl = b.startTimestamp <= nowSec && nowSec <= b.endTimestamp ? 1 : 0;
      if (al !== bl) return bl - al;
      return b.endTimestamp - a.endTimestamp;
    })[0] ?? null;
  }, [pool.campaigns]);

  const isDepthMetric = metric === "depth" || metric === "depthUsd";
  const { data: recipientData } = useMerklCampaignIncentives({
    chainId: ZEROG_CHAIN_ID,
    campaignId: isDepthMetric ? primaryCampaign?.campaignId ?? null : null,
    enabled: isDepthMetric && Boolean(primaryCampaign?.campaignId),
    limit: 500,
  });

  const walletSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipientData?.recipients ?? []) set.add(r.recipient.toLowerCase());
    for (const w of recipientData?.wrapperAddresses ?? []) set.add(w.toLowerCase());
    return set;
  }, [recipientData]);

  const depthConfig = useMemo(() => {
    if (metric === "tvl") return undefined;
    // Depth counts only campaign wallets — optionally minus the 0G Foundation set.
    const set = excludeFoundation
      ? new Set([...walletSet].filter((a) => !FOUNDATION_WALLETS.has(a)))
      : walletSet;
    if (set.size === 0) return undefined;
    return { walletSet: set, depthPct: 1 };
  }, [metric, walletSet, excludeFoundation]);

  const { data: history } = useLiquidityHistoryByAddress(
    pool.poolKey,
    lookbackDays,
    poolData?.token0Decimals ?? 18,
    poolData?.token1Decimals ?? 6,
    poolData?.sqrtPriceX96,
    token0UsdPrice,
    token1UsdPrice,
    dailyPriceMap,
    Boolean(poolData?.sqrtPriceX96) && metric !== "fees",
    null,
    "day",
    depthConfig,
  );

  const committedBudgetByDay = useMemo(() => buildCommittedBudgetByDay(pool.campaigns), [pool.campaigns]);
  const dailyIncentiveByDay = useMemo(() => buildDailyIncentiveByDay(pool.campaigns), [pool.campaigns]);

  const points = useMemo<EfficiencyPoint[]>(() => {
    // Fees × Incentive: daily trading fees ÷ that day's incentive SPEND. Uses
    // PoolDayData fees (token1 side, like the per-pool fee chart) and the
    // anchored token1 USD price — independent of the TVL/depth history path.
    if (metric === "fees") {
      if (!dayData || dailyIncentiveByDay.size === 0) return [];
      const t1Price = token1UsdPrice ?? 0;
      if (!(t1Price > 0)) return [];
      const t1Div = 10 ** (poolData?.token1Decimals ?? 6);
      const out: EfficiencyPoint[] = [];
      for (const day of [...dayData].sort((a, b) => a.date - b.date)) {
        const dayStart = Math.floor(day.date / DAY) * DAY;
        const incentive = dailyIncentiveByDay.get(dayStart) ?? 0;
        if (incentive <= 0) continue; // only days with a live campaign
        const feesUsd = (parseFloat(day.feesToken1 || "0") / t1Div) * t1Price;
        if (!Number.isFinite(feesUsd) || feesUsd < 0) continue;
        const dateStr = new Date(dayStart * 1000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        out.push({
          date: dayStart,
          dateStr,
          multiplier: feesUsd / incentive,
          numerator: feesUsd,
          budget: incentive,
        });
      }
      return out;
    }

    if (!history || committedBudgetByDay.size === 0) return [];
    const sortedDays = [...committedBudgetByDay.keys()].sort((a, b) => a - b);
    const budgetAt = (dayTs: number): number => {
      if (committedBudgetByDay.has(dayTs)) return committedBudgetByDay.get(dayTs) as number;
      let best = 0;
      for (const d of sortedDays) {
        if (d <= dayTs) best = committedBudgetByDay.get(d) as number;
        else break;
      }
      return best;
    };

    const out: EfficiencyPoint[] = [];
    for (const snap of history.snapshots) {
      const budget = budgetAt(snap.date);
      let numerator: number | undefined;
      if (metric === "tvl") {
        // Pool TVL, optionally minus the 0G Foundation wallets' share that day.
        let foundationUsd = 0;
        if (excludeFoundation) {
          for (const a of FOUNDATION_WALLETS) foundationUsd += snap.byAddress.get(a) ?? 0;
        }
        numerator = snap.totalUsd - foundationUsd;
      } else {
        // Depth already excludes the foundation set via depthConfig when toggled.
        numerator = snap.campaignDepthUsd;
      }
      if (numerator == null || !Number.isFinite(numerator) || numerator <= 0) continue;
      if (metric === "depthUsd") {
        // Raw USD depth over time — no incentive division.
        out.push({ date: snap.date, dateStr: snap.dateStr, multiplier: numerator, numerator, budget });
      } else {
        if (budget <= 0) continue;
        out.push({ date: snap.date, dateStr: snap.dateStr, multiplier: numerator / budget, numerator, budget });
      }
    }
    return out;
  }, [
    history,
    committedBudgetByDay,
    metric,
    excludeFoundation,
    dayData,
    dailyIncentiveByDay,
    token1UsdPrice,
    poolData?.token1Decimals,
  ]);

  useEffect(() => {
    onSeries(pool.poolKey, points);
  }, [points, pool.poolKey, onSeries]);

  return null;
}

interface ChartSeries {
  poolKey: string;
  poolLabel: string;
  color: string;
  points: EfficiencyPoint[];
}

function EfficiencyChartInner({
  series,
  numeratorLabel,
  denomLabel,
  valueKind,
  width,
  height,
}: {
  series: ChartSeries[];
  numeratorLabel: string;
  denomLabel: string;
  valueKind: "multiplier" | "usd";
  width: number;
  height: number;
}) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const fmtValue = (v: number) => (valueKind === "usd" ? formatUsdCompact(v) : formatMultiplier(v));

  const margin = { top: 12, right: 14, bottom: 26, left: 46 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xDomain = useMemo(() => {
    const byLabel = new Map<string, number>();
    for (const s of series) for (const p of s.points) byLabel.set(p.dateStr, p.date);
    return [...byLabel.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  }, [series]);

  const yMax = useMemo(() => {
    let max = 0;
    for (const s of series) for (const p of s.points) if (p.multiplier > max) max = p.multiplier;
    return max > 0 ? max : 1;
  }, [series]);

  const xScale = useMemo(
    () => scalePoint<string>({ domain: xDomain, range: [0, innerW] }),
    [xDomain, innerW],
  );
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, yMax * 1.1], range: [innerH, 0], nice: true }),
    [yMax, innerH],
  );

  if (width <= 0 || height <= 0 || xDomain.length === 0) return null;

  const xTickLabels = xDomain.filter((_, i) => {
    const step = Math.ceil(xDomain.length / 6);
    return i % step === 0;
  });

  const hoverX = hoverDate != null ? xScale(hoverDate) : undefined;

  return (
    <div className="relative w-full h-full">
      <svg width={width} height={height}>
        <Group top={margin.top} left={margin.left}>
          <GridRows scale={yScale} width={innerW} numTicks={4} stroke="#e5e7eb" strokeOpacity={0.6} />

          {hoverX != null && (
            <line x1={hoverX} x2={hoverX} y1={0} y2={innerH} stroke="#9ca3af" strokeDasharray="3 3" />
          )}

          {series.map((s) => (
            <LinePath<EfficiencyPoint>
              key={s.poolKey}
              data={s.points}
              x={(p) => xScale(p.dateStr) ?? 0}
              y={(p) => yScale(p.multiplier)}
              stroke={s.color}
              strokeWidth={1.75}
              curve={curveMonotoneX}
            />
          ))}

          {hoverDate != null &&
            series.map((s) => {
              const p = s.points.find((pt) => pt.dateStr === hoverDate);
              if (!p) return null;
              return (
                <circle
                  key={`dot-${s.poolKey}`}
                  cx={xScale(hoverDate) ?? 0}
                  cy={yScale(p.multiplier)}
                  r={3}
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            })}

          <AxisLeft
            scale={yScale}
            numTicks={4}
            stroke="#d1d5db"
            tickStroke="#d1d5db"
            tickFormat={(v) => fmtValue(v as number)}
            tickLabelProps={() => ({ fill: "#6b7280", fontSize: 9, textAnchor: "end", dx: "-0.25em", dy: "0.25em" })}
          />
          <AxisBottom
            top={innerH}
            scale={xScale}
            tickValues={xTickLabels}
            stroke="#d1d5db"
            tickStroke="#d1d5db"
            tickLabelProps={() => ({ fill: "#6b7280", fontSize: 9, textAnchor: "middle" })}
          />
        </Group>

        <rect
          x={margin.left}
          y={margin.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={(e) => {
            const bounds = (e.target as SVGRectElement).getBoundingClientRect();
            const px = e.clientX - bounds.left;
            let nearest: string | null = null;
            let best = Infinity;
            for (const label of xDomain) {
              const lx = xScale(label) ?? 0;
              const dist = Math.abs(lx - px);
              if (dist < best) {
                best = dist;
                nearest = label;
              }
            }
            setHoverDate(nearest);
          }}
          onMouseLeave={() => setHoverDate(null)}
        />
      </svg>

      {hoverDate != null && hoverX != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-gray-200 bg-white/95 px-2 py-1.5 text-[10px] shadow-sm dark:border-gray-700 dark:bg-gray-900/95"
          style={{ left: Math.min(margin.left + hoverX + 8, width - 160), top: margin.top }}
        >
          <div className="mb-1 font-semibold text-gray-700 dark:text-gray-200">{hoverDate}</div>
          {[...series]
            .map((s) => ({ s, p: s.points.find((pt) => pt.dateStr === hoverDate) }))
            .filter((x) => x.p)
            .sort((a, b) => (b.p!.multiplier - a.p!.multiplier))
            .map(({ s, p }) => (
              <div key={`tt-${s.poolKey}`} className="flex items-center justify-between gap-2 tabular-nums">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-gray-600 dark:text-gray-300">{s.poolLabel}</span>
                </span>
                <span className="font-semibold text-gray-800 dark:text-gray-100">
                  {fmtValue(p!.multiplier)}
                  {valueKind === "multiplier" && (
                    <span className="ml-1 font-normal text-gray-400">
                      {formatUsdCompact(p!.numerator)}/{formatUsdCompact(p!.budget)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          <div className="mt-1 border-t border-gray-100 pt-1 text-[9px] text-gray-400 dark:border-gray-800">
            {valueKind === "usd" ? numeratorLabel : `${numeratorLabel} ÷ ${denomLabel}`}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS: Array<{ key: Metric; label: string }> = [
  { key: "tvl", label: "Incentive × TVL" },
  { key: "depth", label: "Depth × TVL" },
  { key: "depthUsd", label: "Depth × Time" },
  { key: "fees", label: "Fees × Incentive" },
];

const METRIC_META: Record<
  Metric,
  { numeratorLabel: string; denomLabel: string; valueKind: "multiplier" | "usd"; subtitle: string }
> = {
  tvl: {
    numeratorLabel: "Pool TVL",
    denomLabel: "campaign incentive",
    valueKind: "multiplier",
    subtitle: "Pool TVL ÷ the live campaign's allocated incentive · how much TVL each $ of the campaign's incentive is holding",
  },
  depth: {
    numeratorLabel: "±1% depth (campaign wallets)",
    denomLabel: "campaign incentive",
    valueKind: "multiplier",
    subtitle: "Campaign-wallet depth within ±1% ÷ the live campaign's allocated incentive · how much active depth each $ of incentive is buying",
  },
  depthUsd: {
    numeratorLabel: "±1% depth (campaign wallets)",
    denomLabel: "campaign incentive",
    valueKind: "usd",
    subtitle: "USD value of campaign-wallet liquidity within ±1% of price, over time",
  },
  fees: {
    numeratorLabel: "Daily fees",
    denomLabel: "daily incentive",
    valueKind: "multiplier",
    subtitle: "Daily trading fees ÷ that day's incentive spend · >1× means the pool's fees out-earn its incentive cost (productive)",
  },
};

/**
 * Tabbed multi-line efficiency chart for the 0G incentives view:
 *  - "Incentive × TVL": pool TVL ÷ the live campaign's allocated incentive.
 *  - "Depth × TVL": campaign-wallet liquidity depth within ±1% of price ÷ the
 *    live campaign's allocated incentive (only campaign-recipient wallets count).
 * One line per incentivized pool.
 */
// The multiplier charts add short 1D/7D windows on top of the shared presets.
const EFFICIENCY_RANGE_OPTIONS = [1, 7, 30, 45, 60, 90] as const;

export function BirdsEyeZerogIncentiveEfficiencyChart({ pools }: { pools: IncentiveEfficiencyPool[] }) {
  const [metric, setMetric] = useState<Metric>("tvl");
  const [lookbackDays, setLookbackDays] = useState<number>(CAMPAIGN_TVL_DEFAULT_RANGE);
  // Default to excluding the 0G Foundation / concentrated wallets so the
  // multiplier reflects organic LP TVL out of the box. The header toggle can
  // re-include them.
  const [excludeFoundation, setExcludeFoundation] = useState<boolean>(true);
  const [hiddenPools, setHiddenPools] = useState<Set<string>>(new Set());
  const [seriesByPool, setSeriesByPool] = useState<Map<string, EfficiencyPoint[]>>(new Map());

  // Reset collected series whenever the metric changes so stale TVL/depth points
  // from the other tab don't linger.
  useEffect(() => {
    setSeriesByPool(new Map());
  }, [metric]);

  const togglePool = useCallback((poolKey: string) => {
    setHiddenPools((prev) => {
      const next = new Set(prev);
      if (next.has(poolKey)) next.delete(poolKey);
      else next.add(poolKey);
      return next;
    });
  }, []);

  const handleSeries = useCallback((poolKey: string, points: EfficiencyPoint[]) => {
    setSeriesByPool((prev) => {
      const next = new Map(prev);
      next.set(poolKey, points);
      return next;
    });
  }, []);

  const eligiblePools = useMemo(() => pools.filter((p) => p.campaigns.length > 0), [pools]);

  const series = useMemo<ChartSeries[]>(() => {
    return eligiblePools
      .map((p, i) => ({
        poolKey: p.poolKey,
        poolLabel: p.poolLabel,
        color: POOL_COLORS[i % POOL_COLORS.length],
        points: seriesByPool.get(p.poolKey) ?? [],
      }))
      .filter((s) => s.points.length > 0);
  }, [eligiblePools, seriesByPool]);

  const hasData = series.length > 0;
  const visibleSeries = useMemo(
    () => series.filter((s) => !hiddenPools.has(s.poolKey)),
    [series, hiddenPools],
  );
  const { numeratorLabel, denomLabel, valueKind, subtitle } = METRIC_META[metric];

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Hidden per-pool workers (keyed by metric so they fully remount on switch) */}
      {eligiblePools.map((p) => (
        <PoolSeriesProbe
          key={`${metric}-${p.poolKey}`}
          pool={p}
          lookbackDays={lookbackDays}
          metric={metric}
          excludeFoundation={excludeFoundation}
          onSeries={handleSeries}
        />
      ))}

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 md:px-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setMetric(t.key)}
            aria-pressed={metric === t.key}
            className={cn(
              "cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
              metric === t.key
                ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 px-4 py-2 md:px-6">
        <p className="text-[10px] text-gray-500 dark:text-gray-400">{subtitle}</p>
        <div className="flex items-center gap-2 shrink-0">
          {/* The foundation filter only affects the wallet-scoped TVL/depth
              numerators — fees are pool-level, so hide it on the fees tab. */}
          {metric !== "fees" && (
            <button
              type="button"
              onClick={() => setExcludeFoundation((v) => !v)}
              aria-pressed={!excludeFoundation}
              title="Include or exclude the 0G Foundation wallets from the TVL/depth"
              className={cn(
                "cursor-pointer rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                excludeFoundation
                  ? "border-gray-200 bg-transparent text-gray-400 line-through dark:border-gray-700"
                  : "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200",
              )}
            >
              0G Foundation
            </button>
          )}
          <CampaignTvlRangeSelector
            value={lookbackDays}
            onChange={setLookbackDays}
            options={EFFICIENCY_RANGE_OPTIONS}
          />
        </div>
      </div>

      {/* Legend — click a pool to show/hide its line */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-1 md:px-6">
          {series.map((s) => {
            const hidden = hiddenPools.has(s.poolKey);
            return (
              <button
                key={`legend-${s.poolKey}`}
                type="button"
                onClick={() => togglePool(s.poolKey)}
                aria-pressed={!hidden}
                className={cn(
                  "flex items-center gap-1.5 text-[10px] transition-opacity cursor-pointer",
                  hidden
                    ? "opacity-40 text-gray-400 line-through"
                    : "text-gray-600 dark:text-gray-300",
                )}
              >
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
                {s.poolLabel}
              </button>
            );
          })}
        </div>
      )}

      <div className="h-[240px] px-2 pb-4 pt-1 md:px-4">
        {hasData ? (
          <ParentSize debounceTime={120}>
            {({ width, height }) => (
              <EfficiencyChartInner
                series={visibleSeries}
                numeratorLabel={numeratorLabel}
                denomLabel={denomLabel}
                valueKind={valueKind}
                width={width}
                height={height}
              />
            )}
          </ParentSize>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-gray-400">
            {metric === "tvl"
              ? "Loading incentive efficiency…"
              : metric === "fees"
                ? "Loading fee productivity…"
                : "Loading campaign depth…"}
          </div>
        )}
      </div>
    </div>
  );
}
