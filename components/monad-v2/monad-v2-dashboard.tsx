"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import Sidebar from "@/components/sidebar/sidebar";
import { DashboardWrapper } from "@/components/dashboard/dashboard-wrapper";
import {
  ChartCard,
  ChartContent,
  ChartFoot,
  ChartHeader,
  ChartTitle,
} from "@/components/dashboard/chart-card";
import {
  PoolAddress,
  PoolBadge,
  PoolBadges,
  PoolHeader,
  PoolInfo,
  PoolName,
  PoolReadout,
  PoolSubDivider,
  PoolTokens,
  TokenIcon,
} from "@/components/dashboard/pool-header";
import { useAuthStore } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import {
  buildMonadV2LiquidityBins,
  MONAD_V2_DUST_USDC_POOL_KEY,
  type MonadV2ChartRange,
  type MonadV2DashboardData,
  type MonadV2LiquidityBin,
  type MonadV2LpHolder,
} from "@/lib/monad-v2-dashboard";
import { usePoolStore } from "@/stores/pool-store";

const MONAD_SPACE_SLUG = "monad";
const MONAD_EXPLORER_URL = `https://monadscan.com/address/${MONAD_V2_DUST_USDC_POOL_KEY}`;

const CHART_WIDTH = 760;
const CHART_HEIGHT = 300;
const CHART_MARGIN = { top: 24, right: 22, bottom: 46, left: 62 };
const PLOT_WIDTH = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
const PLOT_BOTTOM = CHART_MARGIN.top + PLOT_HEIGHT;

const LP_COLORS = [
  "#2F6FED",
  "#1F9D8A",
  "#C18F1C",
  "#C45757",
  "#5F6F7A",
  "#2D8FBD",
  "#7F7A65",
  "#7A5F9F",
  "#B8B4AA",
];

async function fetchMonadV2Dashboard(): Promise<MonadV2DashboardData> {
  const res = await fetch("/api/monad-v2/dashboard");
  if (!res.ok) throw new Error("Failed to fetch Monad V2 dashboard data");
  return res.json();
}

export function MonadV2DashboardShell() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const hydrateSession = useAuthStore((s) => s.hydrateSession);
  const switchSpace = useAuthStore((s) => s.switchSpace);
  const setSpaceSlug = usePoolStore((s) => s.setSpaceSlug);
  const monadSpace = spaces.find((space) => space.slug === MONAD_SPACE_SLUG);

  useEffect(() => {
    if (!sessionChecked) {
      void hydrateSession();
      return;
    }
    if (!isAuthenticated) router.replace("/");
  }, [hydrateSession, isAuthenticated, router, sessionChecked]);

  useEffect(() => {
    setSpaceSlug(MONAD_SPACE_SLUG);
  }, [setSpaceSlug]);

  useEffect(() => {
    if (monadSpace && monadSpace.id !== currentSpaceId) {
      switchSpace(monadSpace.id);
    }
  }, [currentSpaceId, monadSpace, switchSpace]);

  if (!sessionChecked || !isAuthenticated) return null;

  if (!monadSpace) {
    return (
      <div className="min-h-screen bg-[var(--ts-surface)] flex items-center justify-center px-4">
        <div className="ts-panel ts-panel-bracketed max-w-md p-8 text-center">
          <h2 className="font-[var(--bp-font-numeric)] text-sm uppercase tracking-[0.16em] text-[var(--ts-ink-0)]">
            Monad access unavailable
          </h2>
          <p className="mt-3 text-sm text-[var(--ts-ink-3)]">
            This V2 surface is scoped to the Monad space.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <DashboardWrapper>
        <MonadV2Dashboard />
      </DashboardWrapper>
    </div>
  );
}

function MonadV2Dashboard() {
  const query = useQuery({
    queryKey: ["monad-v2-dashboard"],
    queryFn: fetchMonadV2Dashboard,
    staleTime: 30_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const data = query.data;
  const localBins = useMemo(
    () =>
      data
        ? buildMonadV2LiquidityBins({
            currentPriceUsd: data.pool.currentDustPriceUsd,
            invariantL: data.pool.invariantL,
            range: "local",
          })
        : [],
    [data]
  );
  const fullBins = useMemo(
    () =>
      data
        ? buildMonadV2LiquidityBins({
            currentPriceUsd: data.pool.currentDustPriceUsd,
            invariantL: data.pool.invariantL,
            range: "full",
          })
        : [],
    [data]
  );
  const holders = useMemo(() => {
    if (!data) return [];
    return data.lp.others
      ? [...data.lp.topHolders, data.lp.others]
      : data.lp.topHolders;
  }, [data]);

  return (
    <div className="min-h-screen bg-[var(--ts-surface)]">
      <PoolHeader>
        <PoolTokens>
          <TokenIcon symbol="DUST" className="z-[2]" />
          <TokenIcon symbol="USDC" className="left-[28px] z-[1]" />
        </PoolTokens>
        <PoolInfo className="flex-1">
          <div className="flex flex-wrap items-center gap-4">
            <PoolName>DUST/USDC</PoolName>
            <PoolBadges>
              <PoolBadge variant="primary">V2</PoolBadge>
              <PoolBadge>0.30%</PoolBadge>
              <PoolBadge>MONAD</PoolBadge>
            </PoolBadges>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PoolReadout
              label="DUST PRICE"
              value={data ? formatUsd(data.pool.currentDustPriceUsd) : "--"}
            />
            <PoolSubDivider />
            <PoolReadout label="SOURCE" value="POOL IMPLIED" />
            <PoolSubDivider />
            <PoolAddress
              network="PAIR"
              address={MONAD_V2_DUST_USDC_POOL_KEY}
              href={MONAD_EXPLORER_URL}
            />
          </div>
        </PoolInfo>
        <Link
          href="/monad"
          className="hidden md:inline-flex h-9 items-center gap-2 border border-[var(--ts-line)] px-3 font-[var(--bp-font-numeric)] text-[10px] uppercase tracking-[0.14em] text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]"
        >
          Main dashboard
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="inline-flex h-9 w-9 items-center justify-center border border-[var(--ts-line)] text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw
            className={cn("h-4 w-4", query.isFetching && "animate-spin")}
            aria-hidden="true"
          />
        </button>
      </PoolHeader>

      <KpiStrip data={data} loading={query.isLoading} />

      <div className="grid grid-cols-1">
        <V2ChartPanel
          title="Liquidity Distribution"
          meta="LOCAL"
          bins={localBins}
          holders={holders}
          data={data}
          mode="distribution"
          range="local"
          loading={query.isLoading}
          error={query.error}
        />
        <V2ChartPanel
          title="LP Shares"
          meta="LOCAL"
          bins={localBins}
          holders={holders}
          data={data}
          mode="lp"
          range="local"
          loading={query.isLoading}
          error={query.error}
        />
        <V2ChartPanel
          title="Liquidity Distribution"
          meta="FULL RANGE"
          bins={fullBins}
          holders={holders}
          data={data}
          mode="distribution"
          range="full"
          loading={query.isLoading}
          error={query.error}
        />
        <V2ChartPanel
          title="LP Shares"
          meta="FULL RANGE"
          bins={fullBins}
          holders={holders}
          data={data}
          mode="lp"
          range="full"
          loading={query.isLoading}
          error={query.error}
        />
      </div>

      {data?.lp.partial ? (
        <div className="border-t border-[var(--ts-line)] px-6 py-3 font-[var(--bp-font-numeric)] text-[10px] uppercase tracking-[0.12em] text-[var(--ts-ink-3)]">
          LP holder reconstruction hit the transfer page cap.
        </div>
      ) : null}
    </div>
  );
}

export function MonadV2NativeCharts({ className }: { className?: string }) {
  const query = useQuery({
    queryKey: ["monad-v2-dashboard"],
    queryFn: fetchMonadV2Dashboard,
    staleTime: 30_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const data = query.data;
  const localBins = useMemo(
    () =>
      data
        ? buildMonadV2LiquidityBins({
            currentPriceUsd: data.pool.currentDustPriceUsd,
            invariantL: data.pool.invariantL,
            range: "local",
          })
        : [],
    [data]
  );
  const fullBins = useMemo(
    () =>
      data
        ? buildMonadV2LiquidityBins({
            currentPriceUsd: data.pool.currentDustPriceUsd,
            invariantL: data.pool.invariantL,
            range: "full",
          })
        : [],
    [data]
  );
  const holders = useMemo(() => {
    if (!data) return [];
    return data.lp.others
      ? [...data.lp.topHolders, data.lp.others]
      : data.lp.topHolders;
  }, [data]);

  return (
    <>
      <div className={cn("grid grid-cols-1", className)}>
        <V2ChartPanel
          title="Liquidity Distribution"
          meta="LOCAL"
          bins={localBins}
          holders={holders}
          data={data}
          mode="distribution"
          range="local"
          loading={query.isLoading}
          error={query.error}
        />
        <V2ChartPanel
          title="LP Shares"
          meta="LOCAL"
          bins={localBins}
          holders={holders}
          data={data}
          mode="lp"
          range="local"
          loading={query.isLoading}
          error={query.error}
        />
        <V2ChartPanel
          title="Liquidity Distribution"
          meta="FULL RANGE"
          bins={fullBins}
          holders={holders}
          data={data}
          mode="distribution"
          range="full"
          loading={query.isLoading}
          error={query.error}
        />
        <V2ChartPanel
          title="LP Shares"
          meta="FULL RANGE"
          bins={fullBins}
          holders={holders}
          data={data}
          mode="lp"
          range="full"
          loading={query.isLoading}
          error={query.error}
        />
      </div>

      {data?.lp.partial ? (
        <div className="border-t border-[var(--ts-line)] px-6 py-3 font-[var(--bp-font-numeric)] text-[10px] uppercase tracking-[0.12em] text-[var(--ts-ink-3)]">
          LP holder reconstruction hit the transfer page cap.
        </div>
      ) : null}
    </>
  );
}

function KpiStrip({
  data,
  loading,
}: {
  data?: MonadV2DashboardData;
  loading: boolean;
}) {
  return (
    <div className="ts-kpi-row">
      <KpiCard
        label="POOL LIQUIDITY"
        value={data ? formatCompactUsd(data.pool.tvlUsd) : loading ? "..." : "--"}
        unit="USD"
        breakdown={[
          {
            label: "USDC",
            value: data ? formatCompact(data.pool.token0.reserve) : "--",
          },
          {
            label: "DUST",
            value: data ? formatCompact(data.pool.token1.reserve) : "--",
          },
        ]}
      />
      <KpiCard
        label="DUST RESERVE"
        value={data ? formatCompact(data.pool.token1.reserve) : loading ? "..." : "--"}
        unit="DUST"
      />
      <KpiCard
        label="LP HOLDERS"
        value={data ? String(data.lp.holderCount) : loading ? "..." : "--"}
        unit={`${data?.lp.transferCount ?? 0} transfers`}
      />
      <KpiCard
        label="INVARIANT L"
        value={data ? formatCompact(data.pool.invariantL) : loading ? "..." : "--"}
        unit="SQRT(K)"
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  breakdown,
}: {
  label: string;
  value: string;
  unit: string;
  breakdown?: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="ts-kpi">
      <div className="ts-kpi-label">{label}</div>
      <div>
        <div className="ts-kpi-value">{value}</div>
        <div className="ts-kpi-unit mt-2">{unit}</div>
      </div>
      {breakdown ? (
        <div className="ts-kpi-breakdown">
          {breakdown.map((item) => (
            <div className="ts-kpi-sub" key={item.label}>
              <span className="ts-kpi-sub-label">{item.label}</span>
              <span className="ts-kpi-sub-val">{item.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function V2ChartPanel({
  title,
  meta,
  bins,
  holders,
  data,
  mode,
  range,
  loading,
  error,
  highlightedAddresses,
  holderValueMode = "pct",
}: {
  title: string;
  meta: string;
  bins: MonadV2LiquidityBin[];
  holders: MonadV2LpHolder[];
  data?: MonadV2DashboardData;
  mode: "distribution" | "lp";
  range: MonadV2ChartRange;
  loading: boolean;
  error: Error | null;
  // Optional. When provided, the LP-shares chart paints any holder whose
  // address is in this set with the "campaign LP" cyan, and everyone else
  // with a muted grey — same semantics as Katana's distribution chart.
  highlightedAddresses?: Set<string> | null;
  // Controls how per-holder values are rendered in the chart's tooltip and
  // the legend footer:
  //   "pct" → share of pool TVL as a percentage (default).
  //   "usd" → absolute USD value (share × bin or pool TVL).
  holderValueMode?: "pct" | "usd";
}) {
  return (
    <ChartCard className="min-h-[420px] border-l-0 border-t-0">
      <ChartHeader>
        <ChartTitle meta={meta}>
          {title}
        </ChartTitle>
      </ChartHeader>
      <ChartContent className="h-[340px]">
        {loading ? (
          <PanelState label="Loading" />
        ) : error ? (
          <PanelState label="Unavailable" />
        ) : bins.length === 0 ? (
          <PanelState label="No data" />
        ) : (
          <V2TentChart
            bins={bins}
            holders={holders}
            mode={mode}
            range={range}
            highlightedAddresses={highlightedAddresses}
            holderValueMode={holderValueMode}
          />
        )}
      </ChartContent>
      <ChartFoot className={cn(mode === "lp" && "max-h-[156px] overflow-y-auto")}>
        {mode === "distribution" ? (
          <>
            <LegendSwatch color="#2F6FED" label="DUST" />
            <LegendSwatch color="#B9B9B1" label="USDC" />
            <span className="ml-auto">
              INDEXED {data?.sources.reserveEntity ?? "Pool"} · {data ? formatDataTimestamp(data.sources.poolUpdatedAt) : "--"}
            </span>
            <InlineAddressActions
              label="POOL"
              address={data?.pool.address ?? MONAD_V2_DUST_USDC_POOL_KEY}
            />
            {data ? (
              <>
                <InlineAddressActions label="DUST" address={data.pool.token1.address} />
                <InlineAddressActions label="USDC" address={data.pool.token0.address} />
              </>
            ) : null}
          </>
        ) : (
          <LpHolderRows
            holders={holders}
            data={data}
            highlightedAddresses={highlightedAddresses}
            holderValueMode={holderValueMode}
          />
        )}
      </ChartFoot>
    </ChartCard>
  );
}

function LpHolderRows({
  holders,
  data,
  highlightedAddresses,
  holderValueMode = "pct",
}: {
  holders: MonadV2LpHolder[];
  data?: MonadV2DashboardData;
  highlightedAddresses?: Set<string> | null;
  holderValueMode?: "pct" | "usd";
}) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const visibleHolders = holders.slice(0, 9);

  const copyAddress = async (address: string) => {
    if (address === "others") return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress(null), 1200);
    } catch {
      setCopiedAddress(null);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.14em] text-[var(--ts-ink-3)]">
        <span>INDEXED {data?.sources.lpTransferEntity ?? "UniswapV2Pair_Transfer"}</span>
        <span>·</span>
        <span>{data ? data.sources.transferRows.toLocaleString("en-US") : "--"} rows</span>
        <span>·</span>
        <span>{data ? data.lp.holderCount.toLocaleString("en-US") : "--"} holders</span>
      </div>
      <div className="grid w-full grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3">
        {visibleHolders.map((holder) => (
          <div
            key={holder.address}
            className="flex min-w-0 items-center gap-2 border border-[var(--ts-line)] bg-[var(--ts-surface)] px-2 py-1.5"
          >
            <span
              className="h-2.5 w-2.5 flex-none border border-[var(--ts-line)]"
              style={{ background: getLpColor(holder.address, holders, highlightedAddresses) }}
            />
            <span className="min-w-0 flex-1 truncate text-[var(--ts-ink-1)]">
              {holder.address === "others" ? "Others" : holder.address}
            </span>
            <span className="flex-none text-[var(--ts-ink-3)]">
              {holderValueMode === "usd" && data
                ? formatCompactUsd(holder.share * data.pool.tvlUsd)
                : formatPct(holder.sharePct)}
            </span>
            {holder.address !== "others" ? (
              <>
                <button
                  type="button"
                  onClick={() => void copyAddress(holder.address)}
                  className="grid h-6 w-6 flex-none place-items-center border border-[var(--ts-line)] text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]"
                  title="Copy LP address"
                  aria-label={`Copy LP address ${holder.address}`}
                >
                  {copiedAddress === holder.address ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                <a
                  href={`https://monadscan.com/address/${holder.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid h-6 w-6 flex-none place-items-center border border-[var(--ts-line)] text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]"
                  title="Open LP on MonadScan"
                  aria-label={`Open LP address ${holder.address} on MonadScan`}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineAddressActions({ label, address }: { label: string; address: string }) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1 border border-[var(--ts-line)] bg-[var(--ts-surface)] px-1.5 py-1">
      <span>
        {label} {shortAddress(address)}
      </span>
      <button
        type="button"
        onClick={() => void copyAddress()}
        className="grid h-5 w-5 place-items-center text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]"
        title={`Copy ${label} address`}
        aria-label={`Copy ${label} address ${address}`}
      >
        {copied ? (
          <Check className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      <a
        href={`https://monadscan.com/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="grid h-5 w-5 place-items-center text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]"
        title={`Open ${label} on MonadScan`}
        aria-label={`Open ${label} address ${address} on MonadScan`}
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </span>
  );
}

function V2TentChart({
  bins,
  holders,
  mode,
  range,
  highlightedAddresses,
  holderValueMode = "pct",
}: {
  bins: MonadV2LiquidityBin[];
  holders: MonadV2LpHolder[];
  mode: "distribution" | "lp";
  range: MonadV2ChartRange;
  highlightedAddresses?: Set<string> | null;
  holderValueMode?: "pct" | "usd";
}) {
  const [hover, setHover] = useState<{ bin: MonadV2LiquidityBin; leftPct: number } | null>(
    null
  );
  const minPrice = bins[0]?.lowerPrice ?? 0;
  const maxPrice = bins[bins.length - 1]?.upperPrice ?? 1;
  const currentPrice =
    bins.find((bin) => bin.dustUsd > 0 && bin.usdcUsd > 0)?.centerPrice ??
    bins[Math.floor(bins.length / 2)]?.centerPrice ??
    1;
  const yMax = Math.max(...bins.map((bin) => bin.totalUsd), 1);
  const logMin = Math.log(minPrice);
  const logMax = Math.log(maxPrice);
  const currentX = xScale(currentPrice, logMin, logMax);
  const xTicks =
    range === "full"
      ? [minPrice, currentPrice, maxPrice]
      : [minPrice, Math.sqrt(minPrice * currentPrice), currentPrice, Math.sqrt(currentPrice * maxPrice), maxPrice];
  const sortedHolders = useMemo(
    () => [...holders].sort((left, right) => left.share - right.share),
    [holders]
  );
  const gradientId = `v2-usdc-hatch-${mode}-${range}`;

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
    const pct = Math.min(
      1,
      Math.max(0, (localX - CHART_MARGIN.left) / PLOT_WIDTH)
    );
    const price = Math.exp(logMin + pct * (logMax - logMin));
    const bin = findNearestBin(bins, price);
    setHover({ bin, leftPct: Math.min(84, Math.max(16, pct * 100)) });
  };

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-full w-full"
        role="img"
        aria-label={mode === "distribution" ? "V2 liquidity distribution" : "V2 LP shares"}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <pattern
            id={gradientId}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="7" fill="#B9B9B1" opacity="0.34" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="#8F8D84" strokeWidth="2" opacity="0.38" />
          </pattern>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((tick) => {
          const y = yScale(yMax * tick, yMax);
          return (
            <g key={tick}>
              <line
                x1={CHART_MARGIN.left}
                x2={CHART_WIDTH - CHART_MARGIN.right}
                y1={y}
                y2={y}
                stroke="var(--ts-line-soft)"
                strokeDasharray="4 4"
              />
              <text
                x={CHART_MARGIN.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-[var(--ts-ink-3)] text-[10px] font-mono"
              >
                {formatCompactUsd(yMax * tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={CHART_MARGIN.left}
          x2={CHART_WIDTH - CHART_MARGIN.right}
          y1={PLOT_BOTTOM}
          y2={PLOT_BOTTOM}
          stroke="var(--ts-line)"
        />
        <line
          x1={CHART_MARGIN.left}
          x2={CHART_MARGIN.left}
          y1={CHART_MARGIN.top}
          y2={PLOT_BOTTOM}
          stroke="var(--ts-line)"
        />

        {bins.map((bin) => {
          const x0 = xScale(bin.lowerPrice, logMin, logMax);
          const x1 = xScale(bin.upperPrice, logMin, logMax);
          const width = Math.max(0.7, x1 - x0 - 0.35);
          if (mode === "distribution") {
            const usdcTop = yScale(bin.usdcUsd, yMax);
            const totalTop = yScale(bin.totalUsd, yMax);
            return (
              <g key={`${bin.lowerPrice}-${bin.upperPrice}`}>
                {bin.usdcUsd > 0 ? (
                  <rect
                    x={x0}
                    y={usdcTop}
                    width={width}
                    height={Math.max(0, PLOT_BOTTOM - usdcTop)}
                    fill={`url(#${gradientId})`}
                  />
                ) : null}
                {bin.dustUsd > 0 ? (
                  <rect
                    x={x0}
                    y={totalTop}
                    width={width}
                    height={Math.max(0, usdcTop - totalTop)}
                    fill="#2F6FED"
                    opacity="0.82"
                  />
                ) : null}
              </g>
            );
          }

          let accrued = 0;
          return (
            <g key={`${bin.lowerPrice}-${bin.upperPrice}`}>
              {sortedHolders.map((holder) => {
                const next = accrued + bin.totalUsd * holder.share;
                const y0 = yScale(accrued, yMax);
                const y1 = yScale(next, yMax);
                accrued = next;
                return (
                  <rect
                    key={holder.address}
                    x={x0}
                    y={y1}
                    width={width}
                    height={Math.max(0, y0 - y1)}
                    fill={getLpColor(holder.address, holders, highlightedAddresses)}
                    opacity={holder.address === "others" ? 0.45 : 0.78}
                  />
                );
              })}
            </g>
          );
        })}

        <line
          x1={currentX}
          x2={currentX}
          y1={CHART_MARGIN.top}
          y2={PLOT_BOTTOM}
          stroke="var(--ts-ink-1)"
          strokeDasharray="6 5"
          strokeWidth="1.2"
        />
        <text
          x={currentX + 8}
          y={CHART_MARGIN.top + 12}
          className="fill-[var(--ts-ink-2)] text-[10px] font-mono"
        >
          spot
        </text>

        {hover ? (
          <line
            x1={xScale(hover.bin.centerPrice, logMin, logMax)}
            x2={xScale(hover.bin.centerPrice, logMin, logMax)}
            y1={CHART_MARGIN.top}
            y2={PLOT_BOTTOM}
            stroke="var(--ts-ink-0)"
            strokeDasharray="2 3"
            strokeWidth="1"
            opacity="0.55"
          />
        ) : null}

        {xTicks.map((price) => (
          <text
            key={price}
            x={xScale(price, logMin, logMax)}
            y={CHART_HEIGHT - 16}
            textAnchor="middle"
            className="fill-[var(--ts-ink-3)] text-[10px] font-mono"
          >
            {formatAxisPrice(price)}
          </text>
        ))}
        <text
          x={CHART_WIDTH - CHART_MARGIN.right}
          y={CHART_HEIGHT - 2}
          textAnchor="end"
          className="fill-[var(--ts-ink-4)] text-[9px] font-mono"
        >
          DUST USD
        </text>
      </svg>

      {hover ? (
        <div
          className="pointer-events-none absolute top-7 z-10 w-[220px] border border-[var(--ts-line)] bg-[var(--ts-surface)] p-3 shadow-sm"
          style={{ left: `${hover.leftPct}%`, transform: "translateX(-50%)" } as CSSProperties}
        >
          <div className="font-[var(--bp-font-numeric)] text-[10px] uppercase tracking-[0.12em] text-[var(--ts-ink-2)]">
            {formatAxisPrice(hover.bin.lowerPrice)} - {formatAxisPrice(hover.bin.upperPrice)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-[var(--bp-font-numeric)] text-[10px] uppercase tracking-[0.08em] text-[var(--ts-ink-3)]">
            <span>Total</span>
            <span className="text-right text-[var(--ts-ink-0)]">
              {formatCompactUsd(hover.bin.totalUsd)}
            </span>
            {mode === "distribution" ? (
              <>
                <span>DUST</span>
                <span className="text-right text-[var(--ts-ink-0)]">
                  {formatCompactUsd(hover.bin.dustUsd)}
                </span>
                <span>USDC</span>
                <span className="text-right text-[var(--ts-ink-0)]">
                  {formatCompactUsd(hover.bin.usdcUsd)}
                </span>
              </>
            ) : (
              sortedHolders.slice(-4).reverse().map((holder) => (
                <span className="contents" key={holder.address}>
                  <span>
                    {holder.address === "others" ? "Others" : shortAddress(holder.address)}
                  </span>
                  <span className="text-right text-[var(--ts-ink-0)]">
                    {holderValueMode === "usd"
                      ? formatCompactUsd(hover.bin.totalUsd * holder.share)
                      : formatPct(holder.sharePct)}
                  </span>
                </span>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PanelState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center font-[var(--bp-font-numeric)] text-[11px] uppercase tracking-[0.16em] text-[var(--ts-ink-3)]">
      {label}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2.5 w-2.5 border border-[var(--ts-line)]" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

// When `highlightedAddresses` is provided, the chart switches to a two-tone
// palette: cyan for any holder whose address is in the set (e.g. an LP earning
// rewards on a Merkl campaign) and a muted grey for everyone else. With no
// highlight set, the legacy multi-colour scheme is used.
const LP_HIGHLIGHT_COLOR = "#06b6d4"; // tailwind cyan-500
const LP_NEUTRAL_COLOR = "#9ca3af"; // tailwind gray-400

function getLpColor(
  address: string,
  holders: MonadV2LpHolder[],
  highlightedAddresses?: Set<string> | null,
) {
  if (highlightedAddresses && highlightedAddresses.size > 0) {
    if (address === "others") return LP_NEUTRAL_COLOR;
    return highlightedAddresses.has(address.toLowerCase())
      ? LP_HIGHLIGHT_COLOR
      : LP_NEUTRAL_COLOR;
  }
  if (address === "others") return LP_COLORS[LP_COLORS.length - 1];
  const index = Math.max(0, holders.findIndex((holder) => holder.address === address));
  return LP_COLORS[index % (LP_COLORS.length - 1)];
}

function formatDataTimestamp(timestampSeconds: number) {
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return "--";
  return new Date(timestampSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function xScale(price: number, logMin: number, logMax: number) {
  const pct = (Math.log(price) - logMin) / (logMax - logMin);
  return CHART_MARGIN.left + pct * PLOT_WIDTH;
}

function yScale(value: number, maxValue: number) {
  return PLOT_BOTTOM - (value / maxValue) * PLOT_HEIGHT;
}

function findNearestBin(bins: MonadV2LiquidityBin[], price: number) {
  let best = bins[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const bin of bins) {
    const distance = Math.abs(Math.log(bin.centerPrice / price));
    if (distance < bestDistance) {
      best = bin;
      bestDistance = distance;
    }
  }
  return best;
}

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(3)}`;
}

function formatCompactUsd(value: number) {
  if (!Number.isFinite(value)) return "--";
  return `$${formatCompact(value)}`;
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

function formatAxisPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value >= 1000) return `$${formatCompact(value)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toPrecision(2)}`;
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(2)}%`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
