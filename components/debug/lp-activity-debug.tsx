"use client";

import React, { useMemo, useState } from "react";
import { LPAddressActivityChart } from "@/components/custom-metrics/lp-address-activity";
import { SUPPORTED_POOLS, type SupportedPool } from "@/lib/pools";
import { useLPHistoricalData, type TimeRange } from "@/hooks/use-lp-historical-data";
import { useUnifiedPoolData } from "@/hooks/use-unified-pool-data";
import { ENVIO_GRAPHQL_ENDPOINT, ENVIO_GRAPHQL_ENDPOINT_OVERRIDE_STORAGE_KEY } from "@/lib/envio-client";
import { GRANULARITY_LABELS, type ChartGranularity } from "@/stores/chart-settings-store";

function clamp<T extends string>(v: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function formatPct(x: number) {
  if (!Number.isFinite(x)) return "—";
  const sign = x >= 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(2)}%`;
}

export const LPActivityDebug: React.FC = () => {
  const pools = SUPPORTED_POOLS;
  const [pool, setPool] = useState<SupportedPool>(pools[0]!);
  const [timeRange, setTimeRange] = useState<TimeRange>("4h");
  const [granularity, setGranularity] = useState<ChartGranularity>("auto");
  const [invertPrice, setInvertPrice] = useState<boolean>(false);
  const [endpointDraft, setEndpointDraft] = useState<string>("");

  const poolKey = pool.poolKey;

  const { data: poolData } = useUnifiedPoolData(poolKey);
  const lp = useLPHistoricalData({
    poolAddress: poolKey,
    timeRange,
    granularity,
    enabled: true,
  });

  const chartData = lp.chartData;

  const impactStats = useMemo(() => {
    const ohlc = chartData?.ohlcData ?? [];
    if (ohlc.length === 0) return null;

    const closes = ohlc.map((d) => d.close).filter((x) => Number.isFinite(x) && x > 0);
    const minClose = closes.length ? Math.min(...closes) : NaN;
    const maxClose = closes.length ? Math.max(...closes) : NaN;

    const volumes = ohlc.map((d) => d.volume).filter((x) => Number.isFinite(x) && x >= 0);
    const totalVol = volumes.reduce((a, b) => a + b, 0);

    // We can't access the internal computed impactBand directly here, but we *can* at least flag
    // suspicious candles that will tend to cause spikes/holes: missing sqrtPrice/liquidity or zeros.
    const missing = ohlc.filter((d) => !d.sqrtPriceX96 || !d.liquidity).length;

    // Detect "flat looking" close series
    const relRange = Number.isFinite(minClose) && Number.isFinite(maxClose) && minClose > 0 ? (maxClose - minClose) / minClose : NaN;

    return {
      candles: ohlc.length,
      minClose,
      maxClose,
      relRange,
      totalVol,
      missingSqrtOrLiq: missing,
    };
  }, [chartData]);

  const timeRanges: TimeRange[] = ["1h", "4h", "12h", "1d", "3d", "1w", "2w", "1m", "3m"];

  return (
    <div className="min-h-screen w-full p-4 bg-gray-50">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-500">Pool</div>
            <select
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              value={pool.key}
              onChange={(e) => {
                const nextKey = e.target.value;
                const next = pools.find((p) => p.key === nextKey) ?? pools[0]!;
                setPool(next);
              }}
            >
              {pools.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} ({p.protocol})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-500">Time range</div>
            <select
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              value={timeRange}
              onChange={(e) => setTimeRange(clamp(e.target.value, timeRanges, "4h"))}
            >
              {timeRanges.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-500">Granularity</div>
            <select
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm"
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as ChartGranularity)}
            >
              {(Object.keys(GRANULARITY_LABELS) as ChartGranularity[]).map((g) => (
                <option key={g} value={g}>
                  {GRANULARITY_LABELS[g]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input type="checkbox" checked={invertPrice} onChange={(e) => setInvertPrice(e.target.checked)} />
            invert price
          </label>

          <div className="ml-auto flex flex-col gap-1">
            <div className="text-xs text-gray-500">
              Endpoint: <span className="font-mono">{ENVIO_GRAPHQL_ENDPOINT}</span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                className="px-2 py-1 rounded border border-gray-200 text-xs w-[360px]"
                placeholder="Override endpoint (e.g. https://indexer.hyperindex.xyz/.../v1/graphql)"
                value={endpointDraft}
                onChange={(e) => setEndpointDraft(e.target.value)}
              />
              <button
                type="button"
                className="px-2 py-1 rounded bg-gray-900 text-white text-xs"
                onClick={() => {
                  try {
                    const v = endpointDraft.trim();
                    if (!v) return;
                    window.localStorage.setItem(ENVIO_GRAPHQL_ENDPOINT_OVERRIDE_STORAGE_KEY, v);
                    window.location.reload();
                  } catch {
                    // ignore
                  }
                }}
              >
                Apply & Reload
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border border-gray-200 text-xs"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(ENVIO_GRAPHQL_ENDPOINT_OVERRIDE_STORAGE_KEY);
                    window.location.reload();
                  } catch {
                    // ignore
                  }
                }}
              >
                Clear
              </button>
            </div>
            <div className="text-[11px] text-gray-400">
              Override key: <span className="font-mono">{ENVIO_GRAPHQL_ENDPOINT_OVERRIDE_STORAGE_KEY}</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold mb-2">LP Activity Chart (isolated)</div>
          <div style={{ height: 720 }} className="w-full">
            {chartData ? (
              <LPAddressActivityChart
                data={chartData}
                lpRanges={[]}
                tickData={lp.tickLiquidity?.length ? lp.tickLiquidity : null}
                poolData={poolData ?? null}
                lpEvents={lp.impactBandEvents ?? []}
                v3Swaps={lp.v3Swaps ?? []}
                invertPrice={invertPrice}
              />
            ) : lp.isLoading ? (
              <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">Loading…</div>
            ) : (
              <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">No data.</div>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-sm font-semibold mb-2">Diagnostics</div>

          {impactStats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">Candles</div>
                <div className="font-mono">{impactStats.candles}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total volume (USD approx)</div>
                <div className="font-mono">{impactStats.totalVol.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Close range</div>
                <div className="font-mono">
                  {Number.isFinite(impactStats.minClose) ? impactStats.minClose.toFixed(6) : "—"} →{" "}
                  {Number.isFinite(impactStats.maxClose) ? impactStats.maxClose.toFixed(6) : "—"} ({formatPct(impactStats.relRange)})
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Candles missing sqrt/liquidity</div>
                <div className="font-mono">{impactStats.missingSqrtOrLiq}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No stats yet.</div>
          )}

          <div className="mt-3 text-xs text-gray-500">
            Tip: If you still see “holes”, the usual cause is at least one point in a filled SVG path using NaN/Infinity.
            The next step is to add a per-point validation + spike clamp inside the impact-band builder.
          </div>
        </div>
      </div>
    </div>
  );
};


