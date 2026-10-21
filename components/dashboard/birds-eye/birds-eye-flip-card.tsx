"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { useTokenViewStore } from "@/stores/token-view-store";
import { formatCompact } from "@/hooks/use-token-dashboard-data";
import type { BirdsEyePoolCard, PoolHealthStatus } from "@/hooks/use-birds-eye-data";
import { getPoolProtocolBadge } from "@/lib/pool-protocol-labels";

const STATUS_CONFIG: Record<
  PoolHealthStatus,
  { label: string; dotClass: string; badgeClass: string; cardClass: string }
> = {
  critical: {
    label: "CRITICAL",
    dotClass: "birds-eye-status-dot--critical",
    badgeClass: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    cardClass: "birds-eye-card--critical",
  },
  watch: {
    label: "WATCH",
    dotClass: "birds-eye-status-dot--watch",
    badgeClass:
      "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    cardClass: "birds-eye-card--watch",
  },
  healthy: {
    label: "HEALTHY",
    dotClass: "birds-eye-status-dot--healthy",
    badgeClass:
      "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
    cardClass: "",
  },
};

interface MetricRowProps {
  label: string;
  labelTitle?: string;
  value: string;
  barPct: number;
  color: "ok" | "warn" | "bad" | "neutral";
}

const METRIC_COLORS = {
  ok: {
    text: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  warn: { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  bad: { text: "text-red-500 dark:text-red-400", bar: "bg-red-500" },
  neutral: { text: "text-gray-700 dark:text-gray-300", bar: "bg-gray-400" },
};

function MetricRow({ label, labelTitle, value, barPct, color }: MetricRowProps) {
  return (
    <div className="flex flex-col px-3 py-[5px] border-b border-gray-100/60 dark:border-gray-800/40 last:border-b-0 flex-1 justify-center">
      <div className="flex justify-between items-center">
        <span
          className="text-[9px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider"
          title={labelTitle}
        >
          {label}
        </span>
        <span
          className={cn(
            "text-[11px] font-semibold font-mono tracking-tight",
            METRIC_COLORS[color].text
          )}
        >
          {value}
        </span>
      </div>
      <div className="birds-eye-metric-bar mt-1">
        <div
          className={cn("birds-eye-metric-bar-fill", METRIC_COLORS[color].bar)}
          style={{ width: `${Math.min(barPct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export function BirdsEyeFlipCard({ card }: { card: BirdsEyePoolCard }) {
  const router = useRouter();
  const pathname = usePathname();
  const setSelectedToken = useTokenViewStore((s) => s.setSelectedToken);
  const config = STATUS_CONFIG[card.status];

  const handleClick = () => {
    setSelectedToken(null);
    const next = new URLSearchParams();
    next.set("pool", card.pool.poolKey);
    router.push(`${pathname}?${next.toString()}`);
  };

  // Resolved thresholds (per-pool or overall)
  const { priceDeviation: devTh, tvl: tvlTh, depth: depthTh, spread: spreadTh } = card.thresholds;

  // Deviation color
  const pegAbsPct = Math.abs(card.pricePegPct);
  const devColor: MetricRowProps["color"] =
    pegAbsPct >= devTh.criticalPct ? "bad" : pegAbsPct >= devTh.watchPct ? "warn" : "ok";
  const devBarPct = Math.min(pegAbsPct * 25, 100);

  // TVL bar (relative to $5M as "full")
  const tvlBarPct = Math.min((card.tvlUsd / 5_000_000) * 100, 100);
  const tvlColor: MetricRowProps["color"] =
    card.tvlUsd > tvlTh.okAbove ? "ok" : card.tvlUsd > tvlTh.warnAbove ? "warn" : "bad";
  const depthBuyColor: MetricRowProps["color"] =
    card.depthBuyAt2PctUsd === null
      ? "neutral"
      : card.depthBuyAt2PctUsd > depthTh.okAbove
        ? "ok"
        : card.depthBuyAt2PctUsd > depthTh.warnAbove
          ? "warn"
          : "bad";
  const depthSellColor: MetricRowProps["color"] =
    card.depthSellAt2PctUsd === null
      ? "neutral"
      : card.depthSellAt2PctUsd > depthTh.okAbove
        ? "ok"
        : card.depthSellAt2PctUsd > depthTh.warnAbove
          ? "warn"
          : "bad";
  const depthBuyBarPct =
    card.depthBuyAt2PctUsd === null
      ? 0
      : Math.min((card.depthBuyAt2PctUsd / (card.tvlUsd || 1)) * 500, 100);
  const depthSellBarPct =
    card.depthSellAt2PctUsd === null
      ? 0
      : Math.min((card.depthSellAt2PctUsd / (card.tvlUsd || 1)) * 500, 100);

  // Effective spread color & bar
  const spreadColor: MetricRowProps["color"] =
    card.effectiveSpreadPct === null
      ? "neutral"
      : card.effectiveSpreadPct < spreadTh.okBelow
        ? "ok"
        : card.effectiveSpreadPct < spreadTh.warnBelow
          ? "warn"
          : "bad";
  const spreadBarPct =
    card.effectiveSpreadPct === null
      ? 0
      : Math.min(card.effectiveSpreadPct * 50, 100);

  const protocolBadge = getPoolProtocolBadge(card.pool);

  if (card.isLoading) {
    return (
      <div className="birds-eye-flip-card-container">
        <div className="bp-card h-full flex flex-col items-center justify-center gap-2">
          <div className="w-12 h-12 rounded-full bp-skeleton" />
          <div className="w-16 h-4 bp-skeleton rounded" />
          <div className="w-20 h-3 bp-skeleton rounded" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("birds-eye-flip-card-container cursor-pointer", config.cardClass)}
      onClick={handleClick}
    >
      <div className="birds-eye-flip-card">
        {/* ──── FRONT ──── */}
        <div className="birds-eye-flip-card-front bp-card">
          {/* Status badge (top right) */}
          {card.status !== "healthy" && (
            <div
              className={cn(
                "absolute top-2 right-2 z-10",
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold",
                config.badgeClass
              )}
            >
              <span
                className={cn("birds-eye-status-dot w-[6px] h-[6px]", config.dotClass)}
              />
              {config.label}
            </div>
          )}

          <div className="flex flex-col items-center justify-center gap-2 flex-1 px-4 py-5">
            {/* Token icon */}
            <TokenIcon symbol={card.trackedAsset} className="w-12 h-12" />

            {/* Ticker */}
            <span className="text-sm font-bold font-mono tracking-tight text-gray-900 dark:text-white">
              {card.trackedAsset}
            </span>

            {/* Pool label */}
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
              {card.pool.label}
            </span>

            {/* Status text */}
            <span
              className={cn(
                "text-[10px] font-semibold",
                card.status === "critical"
                  ? "text-red-500"
                  : card.status === "watch"
                    ? "text-amber-500"
                    : "text-emerald-500"
              )}
            >
              {card.statusText}
            </span>

            {/* Protocol badge + last trade */}
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-medium px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">
                {protocolBadge}
              </span>
              {isWorldchainSolanaPool && (
                <span className="text-[8px] font-medium px-1.5 py-0.5 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-300 rounded">
                  Solana
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ──── BACK ──── */}
        <div className="birds-eye-flip-card-back bp-card">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 shrink-0">
            <TokenIcon symbol={card.trackedAsset} className="w-5 h-5" />
            <span className="text-[12px] font-bold font-mono text-gray-900 dark:text-white">
              {card.trackedAsset}
            </span>
            <span
              className={cn(
                "ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded",
                config.badgeClass
              )}
            >
              {config.label}
            </span>
          </div>

          {/* Metrics */}
          <div className="flex flex-col flex-1">
            <MetricRow
              label="TVL"
              value={formatCompact(card.tvlUsd)}
              barPct={tvlBarPct}
              color={tvlColor}
            />
            <MetricRow
              label="Depth (+2%)"
              value={
                card.depthBuyAt2PctUsd === null
                  ? "—"
                  : formatCompact(card.depthBuyAt2PctUsd)
              }
              barPct={depthBuyBarPct}
              color={depthBuyColor}
            />
            <MetricRow
              label="Depth (-2%)"
              value={
                card.depthSellAt2PctUsd === null
                  ? "—"
                  : formatCompact(card.depthSellAt2PctUsd)
              }
              barPct={depthSellBarPct}
              color={depthSellColor}
            />
            <MetricRow
              label="Spread"
              value={
                card.effectiveSpreadPct === null
                  ? card.feeTier
                  : `${card.effectiveSpreadPct.toFixed(2)}%`
              }
              barPct={spreadBarPct}
              color={spreadColor}
            />
            <MetricRow
              label="Price Peg"
              labelTitle={card.referenceLabel === "Kraken xUSD" ? "Pool price deviation vs Kraken USD price" : undefined}
              value={`${card.pricePegPct >= 0 ? "+" : ""}${card.pricePegPct.toFixed(2)}%`}
              barPct={devBarPct}
              color={devColor}
            />
            <MetricRow
              label="Org. Vol."
              value="—"
              barPct={0}
              color="neutral"
            />
            <MetricRow
              label="Arb. Vol."
              value="—"
              barPct={0}
              color="neutral"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
