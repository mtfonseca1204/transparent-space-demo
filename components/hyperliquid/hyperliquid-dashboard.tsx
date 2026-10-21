"use client";

import React, { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock3,
  Database,
  Gauge,
  Layers3,
  LineChart,
  RefreshCw,
  ShieldCheck,
  Target,
  WalletCards,
} from "lucide-react";

import {
  ChartCard,
  ChartContent,
  ChartFoot,
  ChartHeader,
  ChartTitle,
} from "@/components/dashboard/chart-card";
import { useHip3MarketQuality, useHip3Markets } from "@/hooks/use-hip3-market-quality";
import {
  HIP3_DEFAULT_BAND_BPS,
  HIP3_DEFAULT_MARKET_KEY,
  HIP3_DEFAULT_MIN_DEPTH_USD,
  buildHip3BookLadderRows,
  buildHip3DepthRows,
  getHip3LiveState,
  getHip3SampleAgeMs,
  getUsableHip3Markouts,
  selectRecentHip3AccountHistoryRows,
  selectRecentHip3FillHourlyRows,
  selectRecentHip3HourlyRows,
  type Hip3AccountHistoryRow,
  type Hip3AccountSnapshot,
  type Hip3BookSample,
  type Hip3FillHourlyRow,
  type Hip3HourlyRow,
  type Hip3LiveState,
  type Hip3Summary,
} from "@/lib/hip3-market-quality";
import { cn } from "@/lib/utils";

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PRICE_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function formatUsd(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return USD_FORMAT.format(value);
}

function formatPrice(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return PRICE_FORMAT.format(value);
}

function formatBps(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)} bps`;
}

function formatPct(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

function formatSignedBps(value?: number | string | null): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return "n/a";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(1)} bps`;
}

function formatSignedUsd(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatAge(value?: string | null): string {
  const ageMs = getHip3SampleAgeMs(value);
  if (ageMs === null) return "n/a";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatShortAddress(value?: string | null): string {
  if (!value) return "n/a";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function statusLabel(state: Hip3LiveState): string {
  if (state === "live") return "Live";
  if (state === "thin") return "Thin depth";
  if (state === "stale") return "Stale";
  return "No samples";
}

function statusClassName(state: Hip3LiveState): string {
  if (state === "live") return "border-[var(--ts-good-line)] bg-[var(--ts-good-soft)] text-[var(--ts-good)]";
  if (state === "thin") return "border-[var(--ts-warn-line)] bg-[var(--ts-warn-soft)] text-[var(--ts-warn)]";
  return "border-[var(--ts-bad-line)] bg-[var(--ts-bad-soft)] text-[var(--ts-bad)]";
}

export function HyperliquidDashboard() {
  const marketsQuery = useHip3Markets();
  const qualityQuery = useHip3MarketQuality({
    market: HIP3_DEFAULT_MARKET_KEY,
    bandBps: HIP3_DEFAULT_BAND_BPS,
    minDepthUsd: HIP3_DEFAULT_MIN_DEPTH_USD,
  });

  const payload = qualityQuery.data;
  const market = payload?.market;
  const latestBook = payload?.latest.book ?? null;
  const latestAccount = payload?.latest.account ?? null;
  const depthRows = useMemo(() => buildHip3DepthRows(latestBook), [latestBook]);
  const ladderRows = useMemo(() => buildHip3BookLadderRows(latestBook, 12), [latestBook]);
  const hourlyRows = useMemo(
    () => selectRecentHip3HourlyRows(payload?.hourly, 48),
    [payload?.hourly]
  );
  const populatedHourlyRows = useMemo(
    () => selectRecentHip3HourlyRows((payload?.hourly ?? []).filter((row) => row.sample_count > 0), 48),
    [payload?.hourly]
  );
  const accountHistoryRows = useMemo(
    () => selectRecentHip3AccountHistoryRows(payload?.account_history, 48),
    [payload?.account_history]
  );
  const fillHourlyRows = useMemo(
    () => selectRecentHip3FillHourlyRows(payload?.fill_hourly, 48),
    [payload?.fill_hourly]
  );
  const usableMarkouts = useMemo(() => getUsableHip3Markouts(payload?.markouts), [payload?.markouts]);
  const liveState = getHip3LiveState({ latestBook });
  const activeMarketCount = marketsQuery.data?.data.length ?? 0;
  const maxDepth = Math.max(1, ...depthRows.map((row) => row.totalUsd));

  const handleRefresh = () => {
    void marketsQuery.refetch();
    void qualityQuery.refetch();
  };

  return (
    <div className="dashboard-canvas-wrapper relative">
      <div className="dashboard-canvas flex-1 overflow-auto">
        <main className="space-y-4 p-4 md:p-6">
          <section className="border border-[var(--ts-line)] bg-[var(--ts-surface)] p-4 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] uppercase text-[var(--ts-ink-3)]">
                    Hyperliquid HIP-3
                  </span>
                  <StatusPill state={liveState} />
                </div>
                <h1 className="mt-2 font-mono text-2xl font-semibold text-[var(--ts-ink-0)] md:text-3xl">
                  {market?.label ?? "Nova NLP / Paragon AVGO"}
                </h1>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--ts-ink-3)]">
                  <span>{market?.coin ?? "para:AVGO"}</span>
                  <span>{market?.dex ?? "para"}</span>
                  <span>{activeMarketCount || 1} market</span>
                  <span>Last book {formatAge(latestBook?.sampled_at)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={qualityQuery.isFetching || marketsQuery.isFetching}
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--ts-line-hard)]",
                  "bg-[var(--ts-surface-2)] text-[var(--ts-ink-2)] transition-colors",
                  "hover:bg-[var(--ts-surface-3)] hover:text-[var(--ts-ink-0)] disabled:opacity-50"
                )}
                title="Refresh HIP-3 data"
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    (qualityQuery.isFetching || marketsQuery.isFetching) && "animate-spin"
                  )}
                />
              </button>
            </div>
          </section>

          {qualityQuery.isError ? (
            <ErrorPanel message={qualityQuery.error.message} />
          ) : qualityQuery.isLoading ? (
            <LoadingPanel />
          ) : (
            <>
              <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricPanel
                  icon={<Activity className="h-4 w-4" />}
                  label="Mid price"
                  value={formatPrice(latestBook?.mid_px)}
                  meta={`Bid ${formatPrice(latestBook?.best_bid_px)} / Ask ${formatPrice(latestBook?.best_ask_px)}`}
                />
                <MetricPanel
                  icon={<BarChart3 className="h-4 w-4" />}
                  label="Spread"
                  value={formatBps(latestBook?.spread_bps)}
                  meta={`7d avg ${formatBps(payload?.summary.avg_spread_bps)}`}
                />
                <MetricPanel
                  icon={<Database className="h-4 w-4" />}
                  label="Book samples"
                  value={NUMBER_FORMAT.format(payload?.summary.sample_count ?? 0)}
                  meta={`Uptime ${formatPct(payload?.summary.sampling_uptime_pct)}`}
                />
                <MetricPanel
                  icon={<Clock3 className="h-4 w-4" />}
                  label="Fills"
                  value={NUMBER_FORMAT.format(payload?.fills.count ?? 0)}
                  meta={`Latest ${formatAge(payload?.fills.latest_fill_at)}`}
                />
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
                <HourlyUptimePanel rows={hourlyRows} />
                <DepthPanel rows={depthRows} maxDepth={maxDepth} latestBook={latestBook} />
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
                <SpreadDepthTrendPanel rows={populatedHourlyRows} />
                <MarketIdentityPanel
                  marketKey={market?.market_key}
                  coin={market?.coin}
                  dex={market?.dex}
                  venue={market?.venue}
                  curator={market?.curator}
                  source={market?.source}
                  mmAddress={market?.mm_address}
                  vaultAddress={market?.vault_address}
                />
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
                <OrderBookPanel rows={ladderRows} />
                <AccountPanel
                  userAddress={latestAccount?.user_address}
                  vaultAddress={market?.vault_address}
                  accountValueUsd={latestAccount?.account_value_usd}
                  marginUsedUsd={latestAccount?.margin_used_usd}
                  positionSize={latestAccount?.position_size}
                  positionValueUsd={latestAccount?.position_value_usd}
                  unrealizedPnlUsd={latestAccount?.unrealized_pnl_usd}
                  openOrderCount={latestAccount?.open_order_count}
                  bidOpenOrderCount={latestAccount?.bid_open_order_count}
                  askOpenOrderCount={latestAccount?.ask_open_order_count}
                  sampledAt={latestAccount?.sampled_at}
                  fillCount={payload?.fills.count}
                  latestFillAt={payload?.fills.latest_fill_at}
                />
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <MmAccountTrendPanel rows={accountHistoryRows} latestAccount={latestAccount} />
                <MmExecutionFlowPanel rows={fillHourlyRows} accountRows={accountHistoryRows} />
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <FillsMarkoutsPanel
                  rows={payload?.markouts ?? []}
                  usableRows={usableMarkouts}
                  fillCount={payload?.fills.count ?? 0}
                  latestFillAt={payload?.fills.latest_fill_at}
                />
                <ReplenishmentPanel
                  count={payload?.summary.replenishment_event_count ?? 0}
                  depthRows={depthRows}
                />
              </section>

              <section>
                <MetricCoveragePanel
                  latestBook={latestBook}
                  summary={payload?.summary}
                  account={latestAccount}
                  fillCount={payload?.fills.count ?? 0}
                  latestFillAt={payload?.fills.latest_fill_at}
                  markoutCount={payload?.markouts.length ?? 0}
                  accountHistoryCount={payload?.account_history.length ?? 0}
                  fillHourlyCount={payload?.fill_hourly.length ?? 0}
                  replenishmentCount={payload?.summary.replenishment_event_count ?? 0}
                />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function MarketIdentityPanel({
  marketKey,
  coin,
  dex,
  venue,
  curator,
  source,
  mmAddress,
  vaultAddress,
}: {
  marketKey?: string | null;
  coin?: string | null;
  dex?: string | null;
  venue?: string | null;
  curator?: string | null;
  source?: string | null;
  mmAddress?: string | null;
  vaultAddress?: string | null;
}) {
  const rows = [
    ["Market", marketKey ?? "n/a"],
    ["Coin", coin ?? "n/a"],
    ["Dex", dex ?? "n/a"],
    ["Venue", venue ?? "n/a"],
    ["Curator", curator ?? "n/a"],
    ["MM address", formatShortAddress(mmAddress)],
    ["Vault", formatShortAddress(vaultAddress)],
    ["Source", source ?? "n/a"],
  ];

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="Lagoon MM">
          Market Identity
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[320px]">
        <div className="grid h-full content-start gap-2">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2"
            >
              <span className="font-mono text-[10px] uppercase text-[var(--ts-ink-3)]">{label}</span>
              <span className="truncate text-right font-mono text-[11px] font-semibold text-[var(--ts-ink-0)]">
                {value}
              </span>
            </div>
          ))}
        </div>
      </ChartContent>
      <ChartFoot>
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>{formatShortAddress(mmAddress)}</span>
      </ChartFoot>
    </ChartCard>
  );
}

function SpreadDepthTrendPanel({ rows }: { rows: Hip3HourlyRow[] }) {
  const width = 640;
  const height = 220;
  const plotTop = 18;
  const plotBottom = 190;
  const plotHeight = plotBottom - plotTop;
  const maxDepth = Math.max(
    1,
    ...rows.map((row) => (row.avg_bid_depth_usd ?? 0) + (row.avg_ask_depth_usd ?? 0))
  );
  const maxSpread = Math.max(1, ...rows.map((row) => row.avg_spread_bps ?? 0));
  const step = rows.length > 1 ? width / (rows.length - 1) : width;
  const spreadPath = rows
    .map((row, index) => {
      const x = rows.length > 1 ? index * step : width / 2;
      const y = plotBottom - (((row.avg_spread_bps ?? 0) / maxSpread) * plotHeight);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="populated hours">
          Spread and Depth Trend
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[320px]">
        {rows.length ? (
          <div className="h-full">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
              {[plotTop, (plotTop + plotBottom) / 2, plotBottom].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--ts-line-soft)"
                  strokeWidth="1"
                />
              ))}
              {rows.map((row, index) => {
                const x = rows.length > 1 ? index * step : width / 2;
                const barWidth = Math.max(3, Math.min(12, step * 0.45));
                const bidHeight = ((row.avg_bid_depth_usd ?? 0) / maxDepth) * plotHeight;
                const askHeight = ((row.avg_ask_depth_usd ?? 0) / maxDepth) * plotHeight;
                return (
                  <g key={row.hour}>
                    <rect
                      x={x - barWidth / 2}
                      y={plotBottom - bidHeight}
                      width={barWidth / 2}
                      height={bidHeight}
                      fill="var(--ts-info)"
                      opacity="0.55"
                    />
                    <rect
                      x={x}
                      y={plotBottom - askHeight}
                      width={barWidth / 2}
                      height={askHeight}
                      fill="var(--ts-good)"
                      opacity="0.55"
                    />
                  </g>
                );
              })}
              <path d={spreadPath} fill="none" stroke="var(--ts-ink-0)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-2 grid grid-cols-3 font-mono text-[10px] text-[var(--ts-ink-3)]">
              <span>{formatUsd(rows.at(-1)?.avg_bid_depth_usd)} bid</span>
              <span className="text-center">spread {formatBps(rows.at(-1)?.avg_spread_bps)}</span>
              <span className="text-right">{formatUsd(rows.at(-1)?.avg_ask_depth_usd)} ask</span>
            </div>
          </div>
        ) : (
          <EmptyPanelState label="Waiting for populated hourly buckets" />
        )}
      </ChartContent>
      <ChartFoot>
        <LineChart className="h-3.5 w-3.5" />
        <LegendSwatch label="Bid depth" className="bg-[var(--ts-info)]" />
        <LegendSwatch label="Ask depth" className="bg-[var(--ts-good)]" />
        <span>Spread line</span>
      </ChartFoot>
    </ChartCard>
  );
}

function StatusPill({ state }: { state: Hip3LiveState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-2 py-1 font-mono text-[10px] font-semibold uppercase",
        statusClassName(state)
      )}
    >
      <span className="h-1.5 w-1.5 bg-current" />
      {statusLabel(state)}
    </span>
  );
}

function MetricPanel({
  icon,
  label,
  value,
  meta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="ts-panel ts-panel-bracketed min-h-[124px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase text-[var(--ts-ink-3)]">{label}</div>
          <div className="mt-3 truncate font-mono text-2xl font-semibold text-[var(--ts-ink-0)]">
            {value}
          </div>
        </div>
        <div className="grid h-8 w-8 place-items-center border border-[var(--ts-line)] bg-[var(--ts-surface-2)] text-[var(--ts-ink-2)]">
          {icon}
        </div>
      </div>
      <div className="mt-3 font-mono text-[11px] text-[var(--ts-ink-3)]">{meta}</div>
    </div>
  );
}

function HourlyUptimePanel({ rows }: { rows: Hip3HourlyRow[] }) {
  const maxSamples = Math.max(1, ...rows.map((row) => row.expected_samples || row.sample_count || 0));

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="48H">
          Sampling and Quote Uptime
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[300px]">
        <div className="flex h-full flex-col">
          <div className="flex flex-1 items-end gap-1">
            {rows.map((row) => {
              const sampleHeight =
                row.sample_count > 0 ? Math.max(2, (row.sample_count / maxSamples) * 100) : 0;
              const quoteHeight = Math.max(0, Math.min(sampleHeight, (row.quote_up_samples / maxSamples) * 100));
              return (
                <div
                  key={row.hour}
                  className="relative flex h-full min-w-0 flex-1 items-end border-x border-[var(--ts-line-soft)] bg-[var(--ts-surface-2)]"
                  title={`${new Date(row.hour).toLocaleString()} · samples ${row.sample_count}/${row.expected_samples} · quote ${formatPct(row.quote_uptime_pct)}`}
                >
                  <div
                    className="w-full bg-[var(--ts-info-soft)]"
                    style={{ height: `${sampleHeight}%` }}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-[var(--ts-good)] opacity-70"
                    style={{ height: `${quoteHeight}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-3 font-mono text-[10px] text-[var(--ts-ink-3)]">
            <span>{rows[0]?.hour ? new Date(rows[0].hour).toLocaleDateString() : "n/a"}</span>
            <span className="text-center">hourly samples</span>
            <span className="text-right">
              {rows.at(-1)?.hour ? new Date(rows.at(-1)!.hour).toLocaleTimeString() : "n/a"}
            </span>
          </div>
        </div>
      </ChartContent>
      <ChartFoot>
        <LegendSwatch label="Samples" className="bg-[var(--ts-info-soft)]" />
        <LegendSwatch label="Quote up" className="bg-[var(--ts-good)]" />
      </ChartFoot>
    </ChartCard>
  );
}

function DepthPanel({
  rows,
  maxDepth,
  latestBook,
}: {
  rows: ReturnType<typeof buildHip3DepthRows>;
  maxDepth: number;
  latestBook: Hip3BookSample | null;
}) {
  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="latest">
          Depth by Band
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[330px]">
        <div className="flex h-full flex-col justify-center gap-3">
          {rows.map((row) => (
            <div key={row.band} className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[11px] text-[var(--ts-ink-2)]">
                <span>{row.bandBps} bps</span>
                <span>{formatUsd(row.totalUsd)}</span>
              </div>
              <div className="grid h-8 grid-cols-2 overflow-hidden border border-[var(--ts-line)] bg-[var(--ts-surface-2)]">
                <div className="flex items-center justify-end border-r border-[var(--ts-line)]">
                  <div
                    className="h-full bg-[var(--ts-info)] opacity-65"
                    style={{ width: row.bidUsd > 0 ? `${Math.max(2, (row.bidUsd / maxDepth) * 100)}%` : "0%" }}
                  />
                </div>
                <div className="flex items-center justify-start">
                  <div
                    className="h-full bg-[var(--ts-good)] opacity-65"
                    style={{ width: row.askUsd > 0 ? `${Math.max(2, (row.askUsd / maxDepth) * 100)}%` : "0%" }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 font-mono text-[10px] text-[var(--ts-ink-3)]">
                <span>Bid {formatUsd(row.bidUsd)}</span>
                <span className="text-right">Ask {formatUsd(row.askUsd)}</span>
              </div>
            </div>
          ))}
        </div>
      </ChartContent>
      <ChartFoot>
        <Gauge className="h-3.5 w-3.5" />
        <span>Book {formatAge(latestBook?.sampled_at)}</span>
        <span>Spread {formatBps(latestBook?.spread_bps)}</span>
      </ChartFoot>
    </ChartCard>
  );
}

function OrderBookPanel({ rows }: { rows: ReturnType<typeof buildHip3BookLadderRows> }) {
  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="top 12">
          Order Book Ladder
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[380px]">
        <div className="h-full overflow-hidden border border-[var(--ts-line)]">
          <div className="grid grid-cols-[1fr_0.8fr_0.9fr_0.9fr_0.8fr_1fr] border-b border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2 font-mono text-[10px] uppercase text-[var(--ts-ink-3)]">
            <span>Bid px</span>
            <span className="text-right">Bid sz</span>
            <span className="text-right">Bid USD</span>
            <span className="text-right">Ask USD</span>
            <span className="text-right">Ask sz</span>
            <span className="text-right">Ask px</span>
          </div>
          <div className="divide-y divide-[var(--ts-line-soft)]">
            {rows.map((row) => (
              <div
                key={row.index}
                className="grid grid-cols-[1fr_0.8fr_0.9fr_0.9fr_0.8fr_1fr] px-3 py-2 font-mono text-[11px]"
              >
                <span className="text-[var(--ts-info)]">{formatPrice(row.bidPx)}</span>
                <span className="text-right text-[var(--ts-ink-2)]">{formatPrice(row.bidSz)}</span>
                <span className="text-right text-[var(--ts-ink-3)]">{formatUsd(row.bidNotionalUsd)}</span>
                <span className="text-right text-[var(--ts-ink-3)]">{formatUsd(row.askNotionalUsd)}</span>
                <span className="text-right text-[var(--ts-ink-2)]">{formatPrice(row.askSz)}</span>
                <span className="text-right text-[var(--ts-good)]">{formatPrice(row.askPx)}</span>
              </div>
            ))}
          </div>
        </div>
      </ChartContent>
      <ChartFoot>
        <Layers3 className="h-3.5 w-3.5" />
        <span>Compact raw L2 levels from latest sample</span>
      </ChartFoot>
    </ChartCard>
  );
}

function AccountPanel({
  userAddress,
  vaultAddress,
  accountValueUsd,
  marginUsedUsd,
  positionSize,
  positionValueUsd,
  unrealizedPnlUsd,
  openOrderCount,
  bidOpenOrderCount,
  askOpenOrderCount,
  sampledAt,
  fillCount,
  latestFillAt,
}: {
  userAddress?: string | null;
  vaultAddress?: string | null;
  accountValueUsd?: number | null;
  marginUsedUsd?: number | null;
  positionSize?: number | null;
  positionValueUsd?: number | null;
  unrealizedPnlUsd?: number | null;
  openOrderCount?: number | null;
  bidOpenOrderCount?: number | null;
  askOpenOrderCount?: number | null;
  sampledAt?: string | null;
  fillCount?: number | null;
  latestFillAt?: string | null;
}) {
  const hasLiveExposure =
    Math.abs(positionSize ?? 0) > 0 || Math.abs(positionValueUsd ?? 0) > 0 || (openOrderCount ?? 0) > 0;
  const rows = [
    ["Safe", formatShortAddress(userAddress)],
    ["Vault", formatShortAddress(vaultAddress)],
    ["Account value", formatUsd(accountValueUsd)],
    ["Margin used", formatUsd(marginUsedUsd)],
    ["Current position", `${formatPrice(positionSize)} / ${formatUsd(positionValueUsd)}`],
    ["Open orders", `${openOrderCount ?? 0} (${bidOpenOrderCount ?? 0} bid / ${askOpenOrderCount ?? 0} ask)`],
    ["7d fills", `${NUMBER_FORMAT.format(fillCount ?? 0)} · latest ${formatAge(latestFillAt)}`],
    ["Unrealized PnL", formatUsd(unrealizedPnlUsd)],
  ];

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta={formatAge(sampledAt)}>
          Market Maker Account
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[380px]">
        <div className="grid h-full content-start gap-2">
          <div
            className={cn(
              "border px-3 py-2 font-mono text-[11px] font-semibold uppercase",
              hasLiveExposure
                ? "border-[var(--ts-good-line)] bg-[var(--ts-good-soft)] text-[var(--ts-good)]"
                : "border-[var(--ts-line)] bg-[var(--ts-surface-2)] text-[var(--ts-ink-2)]"
            )}
          >
            {hasLiveExposure ? "Live exposure detected" : "No current position or open orders"}
          </div>
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 border border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2"
            >
              <span className="font-mono text-[11px] text-[var(--ts-ink-3)]">{label}</span>
              <span className="truncate font-mono text-[12px] font-semibold text-[var(--ts-ink-0)]">
                {value}
              </span>
            </div>
          ))}
        </div>
      </ChartContent>
      <ChartFoot>
        <WalletCards className="h-3.5 w-3.5" />
        <span>Public Hyperliquid account state</span>
      </ChartFoot>
    </ChartCard>
  );
}

function MmAccountTrendPanel({
  rows,
  latestAccount,
}: {
  rows: Hip3AccountHistoryRow[];
  latestAccount: Hip3AccountSnapshot | null;
}) {
  const width = 640;
  const height = 220;
  const plotTop = 18;
  const plotBottom = 184;
  const plotHeight = plotBottom - plotTop;
  const maxUsd = Math.max(
    1,
    ...rows.flatMap((row) => [
      Math.abs(row.account_value_usd ?? 0),
      Math.abs(row.margin_used_usd ?? 0),
      Math.abs(row.position_value_usd ?? 0),
    ])
  );
  const step = rows.length > 1 ? width / (rows.length - 1) : width;
  const linePath = (getValue: (row: Hip3AccountHistoryRow) => number | null | undefined) =>
    rows
      .map((row, index) => {
        const x = rows.length > 1 ? index * step : width / 2;
        const y = plotBottom - ((Math.abs(getValue(row) ?? 0) / maxUsd) * plotHeight);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="hourly latest">
          MM Account Risk Trend
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[320px]">
        {rows.length ? (
          <div className="h-full">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
              {[plotTop, (plotTop + plotBottom) / 2, plotBottom].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--ts-line-soft)"
                  strokeWidth="1"
                />
              ))}
              {rows.map((row, index) => {
                const x = rows.length > 1 ? index * step : width / 2;
                const barWidth = Math.max(4, Math.min(14, step * 0.45));
                const positionHeight = (Math.abs(row.position_value_usd ?? 0) / maxUsd) * plotHeight;
                return (
                  <rect
                    key={row.hour ?? row.sampled_at}
                    x={x - barWidth / 2}
                    y={plotBottom - positionHeight}
                    width={barWidth}
                    height={positionHeight}
                    fill="var(--ts-info)"
                    opacity="0.45"
                  />
                );
              })}
              <path
                d={linePath((row) => row.account_value_usd)}
                fill="none"
                stroke="var(--ts-ink-0)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={linePath((row) => row.margin_used_usd)}
                fill="none"
                stroke="var(--ts-warn)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-[var(--ts-ink-3)]">
              <span>Value {formatUsd(latestAccount?.account_value_usd)}</span>
              <span className="text-center">Margin {formatUsd(latestAccount?.margin_used_usd)}</span>
              <span className="text-right">Position {formatUsd(latestAccount?.position_value_usd)}</span>
            </div>
          </div>
        ) : (
          <EmptyPanelState label="Waiting for MM account history" />
        )}
      </ChartContent>
      <ChartFoot>
        <LineChart className="h-3.5 w-3.5" />
        <LegendSwatch label="Position notional" className="bg-[var(--ts-info)]" />
        <span>Account value</span>
        <span>Margin line</span>
      </ChartFoot>
    </ChartCard>
  );
}

function MmExecutionFlowPanel({
  rows,
  accountRows,
}: {
  rows: Hip3FillHourlyRow[];
  accountRows: Hip3AccountHistoryRow[];
}) {
  const width = 640;
  const height = 220;
  const plotTop = 18;
  const plotBottom = 184;
  const plotHeight = plotBottom - plotTop;
  const accountByHour = new Map(accountRows.map((row) => [row.hour, row]));
  const timelineRows =
    rows.length > 0
      ? rows
      : accountRows.map((row) => ({
          hour: row.hour,
          fill_count: 0,
          maker_fill_count: 0,
          taker_fill_count: 0,
          buy_fill_count: 0,
          sell_fill_count: 0,
          notional_usd: 0,
          maker_notional_usd: 0,
          taker_notional_usd: 0,
          fee_usd: 0,
          closed_pnl_usd: 0,
          latest_fill_at: null,
        }));
  const maxFills = Math.max(1, ...timelineRows.map((row) => row.fill_count));
  const maxOpenOrders = Math.max(1, ...accountRows.map((row) => row.open_order_count ?? 0));
  const step = timelineRows.length > 1 ? width / (timelineRows.length - 1) : width;
  const openOrderPath = timelineRows
    .map((row, index) => {
      const x = timelineRows.length > 1 ? index * step : width / 2;
      const openOrders = accountByHour.get(row.hour)?.open_order_count ?? 0;
      const y = plotBottom - ((openOrders / maxOpenOrders) * plotHeight);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const makerCount = rows.reduce((sum, row) => sum + row.maker_fill_count, 0);
  const takerCount = rows.reduce((sum, row) => sum + row.taker_fill_count, 0);
  const latestPnl = rows.reduce((sum, row) => sum + (row.closed_pnl_usd ?? 0), 0);

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="maker / taker">
          MM Execution Flow
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[320px]">
        {timelineRows.length ? (
          <div className="h-full">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
              {[plotTop, (plotTop + plotBottom) / 2, plotBottom].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--ts-line-soft)"
                  strokeWidth="1"
                />
              ))}
              {timelineRows.map((row, index) => {
                const x = timelineRows.length > 1 ? index * step : width / 2;
                const barWidth = Math.max(4, Math.min(14, step * 0.45));
                const makerHeight = (row.maker_fill_count / maxFills) * plotHeight;
                const takerHeight = (row.taker_fill_count / maxFills) * plotHeight;
                return (
                  <g key={row.hour ?? index}>
                    <rect
                      x={x - barWidth / 2}
                      y={plotBottom - makerHeight}
                      width={barWidth}
                      height={makerHeight}
                      fill="var(--ts-good)"
                      opacity="0.65"
                    />
                    <rect
                      x={x - barWidth / 2}
                      y={plotBottom - makerHeight - takerHeight}
                      width={barWidth}
                      height={takerHeight}
                      fill="var(--ts-warn)"
                      opacity="0.58"
                    />
                  </g>
                );
              })}
              <path
                d={openOrderPath}
                fill="none"
                stroke="var(--ts-ink-0)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-[var(--ts-ink-3)]">
              <span>Maker {NUMBER_FORMAT.format(makerCount)}</span>
              <span className="text-center">Taker {NUMBER_FORMAT.format(takerCount)}</span>
              <span className="text-right">PnL {formatSignedUsd(latestPnl)}</span>
            </div>
          </div>
        ) : (
          <EmptyPanelState label="Waiting for MM execution history" />
        )}
      </ChartContent>
      <ChartFoot>
        <BarChart3 className="h-3.5 w-3.5" />
        <LegendSwatch label="Maker fills" className="bg-[var(--ts-good)]" />
        <LegendSwatch label="Taker fills" className="bg-[var(--ts-warn)]" />
        <span>Open orders line</span>
      </ChartFoot>
    </ChartCard>
  );
}

function FillsMarkoutsPanel({
  rows,
  usableRows,
  fillCount,
  latestFillAt,
}: {
  rows: ReturnType<typeof getUsableHip3Markouts>;
  usableRows: ReturnType<typeof getUsableHip3Markouts>;
  fillCount: number;
  latestFillAt?: string | null;
}) {
  const displayRows = usableRows;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta={`${usableRows.length}/${rows.length} usable`}>
          Fills and Markouts
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[260px]">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="border border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-[var(--ts-ink-3)]">7d fills</div>
            <div className="mt-1 font-mono text-xl font-semibold text-[var(--ts-ink-0)]">
              {NUMBER_FORMAT.format(fillCount)}
            </div>
          </div>
          <div className="border border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-[var(--ts-ink-3)]">Latest fill</div>
            <div className="mt-1 font-mono text-xl font-semibold text-[var(--ts-ink-0)]">
              {formatAge(latestFillAt)}
            </div>
          </div>
        </div>
        {displayRows.length ? (
          <div className="grid h-full content-start gap-2">
            {displayRows.map((row) => (
              <div
                key={`${row.horizon_ms}-${row.side}`}
                className="grid grid-cols-[0.6fr_0.7fr_1fr_1fr_0.7fr] border border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2 font-mono text-[11px]"
              >
                <span>{row.horizon_ms / 1000}s</span>
                <span>{row.side}</span>
                <span className="text-right">{formatSignedBps(row.avg_markout_bps)}</span>
                <span className="text-right">{formatSignedBps(row.p50_markout_bps)}</span>
                <span className="text-right">{row.fill_count} fills</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanelState label="Waiting for usable post-sample fills" />
        )}
      </ChartContent>
    </ChartCard>
  );
}

function ReplenishmentPanel({
  count,
  depthRows,
}: {
  count: number;
  depthRows: ReturnType<typeof buildHip3DepthRows>;
}) {
  const row50 = depthRows.find((row) => row.band === "50bps");
  const bidPct = Math.min(100, ((row50?.bidUsd ?? 0) / HIP3_DEFAULT_MIN_DEPTH_USD) * 100);
  const askPct = Math.min(100, ((row50?.askUsd ?? 0) / HIP3_DEFAULT_MIN_DEPTH_USD) * 100);
  const isCurrentlyUp = (row50?.bidUsd ?? 0) >= HIP3_DEFAULT_MIN_DEPTH_USD && (row50?.askUsd ?? 0) >= HIP3_DEFAULT_MIN_DEPTH_USD;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="50 bps / $10k">
          Replenishment Events
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[260px]">
        <div className="grid h-full content-center gap-4">
          <div className="text-center">
            <div className="font-mono text-5xl font-semibold text-[var(--ts-ink-0)]">{count}</div>
            <div className="mt-2 font-mono text-[11px] uppercase text-[var(--ts-ink-3)]">
              Depth impairment recoveries
            </div>
          </div>
          <div className="space-y-2">
            {[
              ["Bid 50bps", row50?.bidUsd ?? 0, bidPct],
              ["Ask 50bps", row50?.askUsd ?? 0, askPct],
            ].map(([label, value, pct]) => (
              <div key={String(label)}>
                <div className="mb-1 flex justify-between font-mono text-[10px] text-[var(--ts-ink-3)]">
                  <span>{label}</span>
                  <span>{formatUsd(Number(value))}</span>
                </div>
                <div className="h-3 border border-[var(--ts-line)] bg-[var(--ts-surface-2)]">
                  <div
                    className="h-full bg-[var(--ts-good)] opacity-70"
                    style={{ width: `${Math.max(0, Number(pct))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="border border-[var(--ts-line)] bg-[var(--ts-surface-2)] px-3 py-2 text-center font-mono text-[11px] uppercase text-[var(--ts-ink-2)]">
            {isCurrentlyUp ? "Current quote state up" : "Current quote state impaired"}
          </div>
        </div>
      </ChartContent>
    </ChartCard>
  );
}

function MetricCoveragePanel({
  latestBook,
  summary,
  account,
  fillCount,
  latestFillAt,
  markoutCount,
  accountHistoryCount,
  fillHourlyCount,
  replenishmentCount,
}: {
  latestBook: Hip3BookSample | null;
  summary?: Partial<Hip3Summary>;
  account: Hip3AccountSnapshot | null;
  fillCount: number;
  latestFillAt?: string | null;
  markoutCount: number;
  accountHistoryCount: number;
  fillHourlyCount: number;
  replenishmentCount: number;
}) {
  const rows = [
    ["Book", "top bid / ask", `${formatPrice(latestBook?.best_bid_px)} / ${formatPrice(latestBook?.best_ask_px)}`],
    ["Book", "mid / mark", `${formatPrice(latestBook?.mid_px)} / ${formatPrice(latestBook?.mark_px)}`],
    ["Book", "spread", formatBps(latestBook?.spread_bps ?? summary?.avg_spread_bps)],
    ["Depth", "10/25/50/100 bps", "bid + ask USD bands"],
    ["Ladder", "raw levels", `${latestBook?.raw_bids?.length ?? 0} bid / ${latestBook?.raw_asks?.length ?? 0} ask`],
    ["Sampling", "samples / quote up", `${NUMBER_FORMAT.format(summary?.sample_count ?? 0)} / ${NUMBER_FORMAT.format(summary?.quote_up_samples ?? 0)}`],
    ["Sampling", "uptime / quote uptime", `${formatPct(summary?.sampling_uptime_pct)} / ${formatPct(summary?.quote_uptime_pct)}`],
    ["Hourly", "avg spread", formatBps(summary?.avg_spread_bps)],
    ["Hourly", "avg bid / ask depth", `${formatUsd(summary?.avg_bid_depth_usd)} / ${formatUsd(summary?.avg_ask_depth_usd)}`],
    ["Account", "value / margin", `${formatUsd(account?.account_value_usd)} / ${formatUsd(account?.margin_used_usd)}`],
    ["Account", "position / orders", `${formatPrice(account?.position_size)} / ${account?.open_order_count ?? 0}`],
    ["Account", "history buckets", NUMBER_FORMAT.format(accountHistoryCount)],
    ["Fills", "count / latest", `${NUMBER_FORMAT.format(fillCount)} / ${formatAge(latestFillAt)}`],
    ["Fills", "hourly buckets", NUMBER_FORMAT.format(fillHourlyCount)],
    ["Markouts", "horizon rows", NUMBER_FORMAT.format(markoutCount)],
    ["Replenishment", "events", NUMBER_FORMAT.format(replenishmentCount)],
  ];

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle meta="indexed fields">
          Metric Coverage
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="!h-[420px]">
        <div className="grid h-full grid-cols-1 content-start overflow-auto border border-[var(--ts-line)] md:grid-cols-2">
          {rows.map(([family, metric, value]) => (
            <div
              key={`${family}-${metric}`}
              className="grid grid-cols-[0.85fr_1fr_1.25fr] gap-3 border-b border-[var(--ts-line-soft)] px-3 py-2 font-mono text-[11px] odd:bg-[var(--ts-surface-2)]"
            >
              <span className="uppercase text-[var(--ts-ink-3)]">{family}</span>
              <span className="text-[var(--ts-ink-2)]">{metric}</span>
              <span className="truncate text-right font-semibold text-[var(--ts-ink-0)]">{value}</span>
            </div>
          ))}
        </div>
      </ChartContent>
      <ChartFoot>
        <Target className="h-3.5 w-3.5" />
        <span>MM-focused HIP-3 indexer surface</span>
      </ChartFoot>
    </ChartCard>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="ts-panel ts-panel-bracketed p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-[var(--ts-bad)]" />
        <div>
          <h2 className="font-mono text-base font-semibold text-[var(--ts-ink-0)]">
            HIP-3 feed unavailable
          </h2>
          <p className="mt-2 font-mono text-[12px] text-[var(--ts-ink-3)]">{message}</p>
        </div>
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="ts-panel ts-panel-bracketed flex min-h-[280px] items-center justify-center p-6">
      <div className="flex items-center gap-3 font-mono text-[12px] text-[var(--ts-ink-3)]">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading HIP-3 feed
      </div>
    </div>
  );
}

function EmptyPanelState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center border border-dashed border-[var(--ts-line)] bg-[var(--ts-surface-2)]">
      <span className="font-mono text-[12px] text-[var(--ts-ink-3)]">{label}</span>
    </div>
  );
}

function LegendSwatch({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5", className)} />
      {label}
    </span>
  );
}
