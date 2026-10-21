"use client";

import Image from "next/image";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpDown, ChevronRight, Droplets, Layers3, RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { cn } from "@/lib/utils";

type KrakenPoolRow = {
  address: string;
  name: string;
  dex: string | null;
  feeTier: string | null;
  feeTierSource?: "coingecko" | "raydium" | "meteora" | "local" | null;
  isTransparentSpacePool: boolean;
  transparentSpaceLabel: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  estimatedFees24hUsd: number | null;
  actualFees24hUsd?: number | null;
  actualFees24hSource?: "raydium" | "meteora" | "orca" | null;
  displayedFees24hUsd?: number | null;
  poolCreatedAt: string | null;
  baseToken: {
    symbol: string | null;
    imageUrl?: string | null;
  };
  quoteToken: {
    symbol: string | null;
    imageUrl?: string | null;
  };
};

type KrakenAssetGroup = {
  symbol: string;
  mint: string;
  poolCount: number;
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  totalEstimatedFees24hUsd: number;
  pools: KrakenPoolRow[];
};

type KrakenPoolsPayload = {
  fetchedAt: string;
  totalAssetCount: number;
  totalPoolCount: number;
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  totalEstimatedFees24hUsd: number;
  assets: KrakenAssetGroup[];
};

type SortKey = "liquidity" | "volume" | "fees";
type SortDirection = "asc" | "desc";

const HEADER_CELL =
  "px-3 py-2.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap";
const BODY_CELL =
  "px-3 py-2.5 text-[11px] font-semibold font-mono text-gray-700 dark:text-gray-300";

async function fetchKrakenPools(spaceSlug?: string | null): Promise<KrakenPoolsPayload> {
  const params = new URLSearchParams();
  if (isDemoSpaceSlug(spaceSlug)) params.set("space", "demo");
  const query = params.toString();
  const response = await fetch(`/api/kraken-pools${query ? `?${query}` : ""}`);
  if (!response.ok) {
    throw new Error(`Failed to load Kraken pools: ${response.status}`);
  }
  return response.json() as Promise<KrakenPoolsPayload>;
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="bp-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
            {label}
          </div>
          <div className="mt-2 text-lg font-semibold text-[var(--bp-text-primary)]">{value}</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--bp-accent-primary)]/10 text-[var(--bp-accent-primary)]">
          {icon}
        </div>
      </div>
    </div>
  );
}

function PoolTokenBadge({
  symbol,
  imageUrl,
  className,
}: {
  symbol: string | null;
  imageUrl?: string | null;
  className?: string;
}) {
  if (imageUrl) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "overflow-hidden rounded-full border border-white/80 bg-white shadow-sm dark:border-gray-900/80 dark:bg-gray-800",
          className
        )}
        style={{
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    );
  }

  return <TokenIcon symbol={symbol ?? "?"} className={className} />;
}

function PoolPairIcons({ pool }: { pool: KrakenPoolRow }) {
  return (
    <div className="flex shrink-0 items-center -space-x-1.5">
      <PoolTokenBadge
        symbol={pool.baseToken.symbol}
        imageUrl={pool.baseToken.imageUrl}
        className="h-5 w-5"
      />
      <PoolTokenBadge
        symbol={pool.quoteToken.symbol}
        imageUrl={pool.quoteToken.imageUrl}
        className="h-5 w-5"
      />
    </div>
  );
}

function TransparentSpaceBadge({
  label,
  onClick,
}: {
  label: string | null;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#7B61FF]/20 bg-white/90 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-[#6B59E6] shadow-sm transition-colors hover:border-[#7B61FF]/35 hover:bg-[#F7F5FF] dark:border-[#7B61FF]/25 dark:bg-[#191B2D]/90 dark:text-[#C7BEFF] dark:hover:bg-[#211F37]"
    >
      <Image
        src="/Logo.svg"
        alt=""
        width={10}
        height={10}
        className="h-2.5 w-2.5 shrink-0"
        aria-hidden="true"
      />
      <span>Transparent Space</span>
      {label ? (
        <span className="text-[8px] font-medium text-[#8A7EF1] dark:text-[#AFA6FF]">
          {label}
        </span>
      ) : null}
    </button>
  );
}

function MetricValueBar({
  value,
  maxValue,
  tone = "violet",
}: {
  value: number;
  maxValue: number;
  tone?: "violet" | "blue" | "amber";
}) {
  const pct = maxValue > 0 ? Math.max(0, Math.min(100, (value / maxValue) * 100)) : 0;
  const toneClasses =
    tone === "violet"
      ? "bg-[var(--bp-accent-primary)] shadow-[0_0_10px_rgba(123,97,255,0.25)]"
      : tone === "amber"
        ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.22)]"
        : "bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.22)]";

  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn(BODY_CELL, "px-0 py-0 font-bold")}>{formatCompact(value)}</span>
        <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500">
          {value > 0 ? `${Math.round(pct)}% of top` : "—"}
        </span>
      </div>
      <div className="birds-eye-metric-bar mt-0.5">
        <div
          className={cn("birds-eye-metric-bar-fill relative", toneClasses)}
          style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }}
        >
          <span className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1/2 rounded-full bg-inherit shadow-inherit" />
        </div>
      </div>
    </div>
  );
}

function FeesComparisonCell({
  pool,
  maxValue,
}: {
  pool: KrakenPoolRow;
  maxValue: number;
}) {
  const primaryValue = pool.displayedFees24hUsd ?? pool.estimatedFees24hUsd;

  if (primaryValue == null) {
    return <span className="text-[11px] font-semibold font-mono text-gray-400 dark:text-gray-500">—</span>;
  }

  return (
    <div className="min-w-[140px]">
      <MetricValueBar value={primaryValue} maxValue={maxValue} tone="amber" />
    </div>
  );
}

function getPoolMetricValue(pool: KrakenPoolRow, sortKey: SortKey): number {
  if (sortKey === "liquidity") return pool.liquidityUsd;
  if (sortKey === "volume") return pool.volume24hUsd;
  return pool.displayedFees24hUsd ?? pool.estimatedFees24hUsd ?? -1;
}

function getAssetMetricValue(asset: KrakenAssetGroup, sortKey: SortKey): number {
  if (sortKey === "liquidity") return asset.totalLiquidityUsd;
  if (sortKey === "volume") return asset.totalVolume24hUsd;
  return asset.totalEstimatedFees24hUsd;
}

function sortByMetricDesc(a: number, b: number, direction: SortDirection): number {
  return direction === "desc" ? b - a : a - b;
}

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDirection,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  sortDirection: SortDirection;
  onToggle: (sortKey: SortKey) => void;
}) {
  const isActive = activeSortKey === sortKey;

  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:text-gray-600 dark:hover:text-gray-300",
        isActive && "text-gray-600 dark:text-gray-300"
      )}
    >
      <span>{label}</span>
      <ArrowUpDown className={cn("h-3 w-3", isActive && "text-[var(--bp-accent-primary)]")} />
      {isActive ? <span className="text-[9px]">{sortDirection === "desc" ? "↓" : "↑"}</span> : null}
    </button>
  );
}

function AssetRow({
  asset,
  defaultExpanded,
  sortKey,
  sortDirection,
}: {
  asset: KrakenAssetGroup;
  defaultExpanded: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const router = useRouter();
  const pathname = usePathname();
  const poolBasePath = pathname.replace(/\/pools$/, "");
  const sortedPools = useMemo(
    () =>
      [...asset.pools].sort((a, b) =>
        sortByMetricDesc(getPoolMetricValue(a, sortKey), getPoolMetricValue(b, sortKey), sortDirection)
      ),
    [asset.pools, sortDirection, sortKey]
  );
  const maxLiquidity = sortedPools.reduce((max, pool) => Math.max(max, pool.liquidityUsd), 0);
  const maxVolume = sortedPools.reduce((max, pool) => Math.max(max, pool.volume24hUsd), 0);
  const maxFees = sortedPools.reduce(
    (max, pool) => Math.max(max, pool.displayedFees24hUsd ?? pool.estimatedFees24hUsd ?? 0),
    0
  );

  const openPool = (poolAddress: string) => {
    router.push(`${poolBasePath}?pool=${encodeURIComponent(poolAddress)}`);
  };

  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-200/80 bg-gray-100/90 transition-colors hover:bg-gray-200/80 dark:border-gray-700/60 dark:bg-gray-800/70 dark:hover:bg-gray-700/60"
        onClick={() => setExpanded((current) => !current)}
      >
        <td className="px-3 py-2.5 w-[280px] min-w-[280px]">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-gray-400 transition-transform duration-200",
                expanded && "rotate-90"
              )}
            />
            <TokenIcon symbol={asset.symbol} className="h-5 w-5" />
            <span className="text-[12px] font-bold font-mono text-gray-900 dark:text-white">
              {asset.symbol}
            </span>
            <span className="rounded bg-gray-200/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-700/60 dark:text-gray-300">
              {asset.poolCount} pools
            </span>
          </div>
        </td>
        <td className={BODY_CELL}> </td>
        <td className={cn(BODY_CELL, "font-bold")}>{formatCompact(asset.totalLiquidityUsd)}</td>
        <td className={cn(BODY_CELL, "font-bold")}>{formatCompact(asset.totalVolume24hUsd)}</td>
        <td className={cn(BODY_CELL, "font-bold")}>{formatCompact(asset.totalEstimatedFees24hUsd)}</td>
      </tr>

      {expanded &&
        sortedPools.map((pool, index) => (
          <tr
            key={`${asset.symbol}-${pool.address}`}
            className={cn(
              "border-b border-gray-100/60 bg-gray-50/60 dark:border-gray-800/40 dark:bg-gray-900/30",
              pool.isTransparentSpacePool &&
                "cursor-pointer bg-[linear-gradient(90deg,rgba(123,97,255,0.10),rgba(123,97,255,0.03)_24%,transparent_55%)] shadow-[inset_2px_0_0_rgba(123,97,255,0.55)] transition-colors hover:bg-[linear-gradient(90deg,rgba(123,97,255,0.15),rgba(123,97,255,0.05)_24%,transparent_55%)] dark:bg-[linear-gradient(90deg,rgba(123,97,255,0.18),rgba(123,97,255,0.06)_26%,rgba(17,24,39,0.10)_55%)] dark:hover:bg-[linear-gradient(90deg,rgba(123,97,255,0.24),rgba(123,97,255,0.08)_26%,rgba(17,24,39,0.14)_55%)]"
            )}
            onClick={pool.isTransparentSpacePool ? () => openPool(pool.address) : undefined}
          >
            <td className="px-3 py-2 pl-10">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-gray-100 px-1 text-[9px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                  #{index + 1}
                </span>
                <PoolPairIcons pool={pool} />
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                  {pool.name}
                </span>
                {pool.feeTier ? (
                  <span className="text-[8px] text-gray-400 dark:text-gray-500">{pool.feeTier}%</span>
                ) : null}
                {pool.isTransparentSpacePool ? (
                  <TransparentSpaceBadge
                    label={pool.transparentSpaceLabel}
                    onClick={() => openPool(pool.address)}
                  />
                ) : null}
              </div>
              <div className="mt-1 text-[10px] font-mono text-gray-400 dark:text-gray-500">
                {pool.address}
              </div>
            </td>
            <td className={BODY_CELL}>{pool.dex ?? "—"}</td>
            <td className="px-3 py-2.5">
              <MetricValueBar value={pool.liquidityUsd} maxValue={maxLiquidity} tone="violet" />
            </td>
            <td className="px-3 py-2.5">
              <MetricValueBar value={pool.volume24hUsd} maxValue={maxVolume} tone="blue" />
            </td>
            <td className="px-3 py-2.5">
              <FeesComparisonCell pool={pool} maxValue={maxFees} />
            </td>
          </tr>
        ))}
    </>
  );
}

export function KrakenPoolsDashboard() {
  const currentSpaceSlug = useCurrentSpaceSlug();
  const isDemoDirectory = isDemoSpaceSlug(currentSpaceSlug);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["krakenPoolsDirectory", currentSpaceSlug ?? null],
    queryFn: () => fetchKrakenPools(currentSpaceSlug),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const [sortKey, setSortKey] = useState<SortKey>("liquidity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const toggleSort = (nextSortKey: SortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("desc");
  };

  const lastSyncLabel = useMemo(() => {
    if (!data?.fetchedAt) return "—";
    const date = new Date(data.fetchedAt);
    return `${date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).toUpperCase()} · ${date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    })} UTC`;
  }, [data?.fetchedAt]);
  const sortedAssets = useMemo(
    () =>
      data?.assets
        ? [...data.assets].sort((a, b) =>
            sortByMetricDesc(getAssetMetricValue(a, sortKey), getAssetMetricValue(b, sortKey), sortDirection)
          )
        : [],
    [data?.assets, sortDirection, sortKey]
  );

  return (
    <div className="dashboard-canvas-wrapper relative">
      <div className="dashboard-canvas">
        <div className="dashboard-canvas flex-1 overflow-auto p-4 md:p-6">
          <div className="flex flex-col gap-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void refetch()}
                className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                label="Assets"
                value={isLoading ? "…" : String(data?.totalAssetCount ?? 0)}
                icon={<Layers3 className="h-4 w-4" />}
              />
              <MetricCard
                label="Pools"
                value={isLoading ? "…" : String(data?.totalPoolCount ?? 0)}
                icon={<Layers3 className="h-4 w-4" />}
              />
              <MetricCard
                label="Total Liquidity"
                value={isLoading ? "…" : formatCompact(data?.totalLiquidityUsd ?? 0)}
                icon={<Droplets className="h-4 w-4" />}
              />
              <MetricCard
                label="24h Volume"
                value={isLoading ? "…" : formatCompact(data?.totalVolume24hUsd ?? 0)}
                icon={<Activity className="h-4 w-4" />}
              />
              <MetricCard
                label="Fees / 24h"
                value={isLoading ? "…" : formatCompact(data?.totalEstimatedFees24hUsd ?? 0)}
                icon={<Droplets className="h-4 w-4" />}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                    <th className={HEADER_CELL}>Asset / Pool</th>
                    <th className={HEADER_CELL}>DEX</th>
                    <th className={HEADER_CELL}>
                      <SortableHeader
                        label="Liquidity"
                        sortKey="liquidity"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onToggle={toggleSort}
                      />
                    </th>
                    <th className={HEADER_CELL}>
                      <SortableHeader
                        label="24h Volume"
                        sortKey="volume"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onToggle={toggleSort}
                      />
                    </th>
                    <th className={HEADER_CELL}>
                      <SortableHeader
                        label="Fees / 24h"
                        sortKey="fees"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onToggle={toggleSort}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b border-gray-100/60 dark:border-gray-800/40">
                        <td colSpan={5} className="px-3 py-3">
                          <div className="h-4 w-full rounded bp-skeleton" />
                        </td>
                      </tr>
                    ))
                  ) : isError ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-red-500 dark:text-red-400"
                      >
                        {error instanceof Error ? error.message : "Failed to load Kraken pools."}
                      </td>
                    </tr>
                  ) : sortedAssets.length > 0 ? (
                    sortedAssets.map((asset, index) => (
                      <AssetRow
                        key={asset.symbol}
                        asset={asset}
                        defaultExpanded={index === 0}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                      />
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                      >
                        {isDemoDirectory
                          ? "No Demo pools were returned."
                          : "No Kraken pools were returned by CoinGecko."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="py-4 text-center">
              <span className="text-[10px] font-mono tracking-wider text-gray-300 dark:text-gray-600">
                LAST SYNC · {lastSyncLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
