"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { ChevronRight } from "lucide-react";
import type { BirdsEyeRfqRow, RfqSourceKey } from "@/hooks/use-birds-eye-rfq-data";
import { RFQ_SOURCE_META } from "@/hooks/use-birds-eye-rfq-data";

// ─── Formatting helpers ──────────────────────────────────────────────────────

const METRIC_TEXT =
  "text-[11px] font-semibold font-mono text-gray-700 dark:text-gray-300";

function fmtCompact(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  if (v > 0) return `$${v.toFixed(0)}`;
  return "—";
}

function fmtPrice(v: number): string {
  if (v <= 0) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDiffPct(buyPrice: number, oracle: number | null): { text: string; color: string } | null {
  if (!oracle || oracle <= 0 || buyPrice <= 0) return null;
  const diff = ((buyPrice - oracle) / oracle) * 100;
  const sign = diff >= 0 ? "+" : "";
  const text = `${sign}${diff.toFixed(2)}%`;
  const absDiff = Math.abs(diff);
  const color =
    absDiff < 0.5
      ? "text-emerald-500 dark:text-emerald-400"
      : absDiff < 2
        ? "text-amber-500 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";
  return { text, color };
}

// ─── Depth bar components ────────────────────────────────────────────────────

/** Summary bar: wider, taller, shows total depth across all RFQs */
function SummaryDepthBar({ value, maxValue }: { value: number; maxValue: number }) {
  if (value <= 0 || maxValue <= 0) return <span className={METRIC_TEXT}>—</span>;
  const pct = Math.min((value / maxValue) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-[120px] h-[6px] rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gray-500 to-gray-400 dark:from-gray-300 dark:to-gray-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn(METRIC_TEXT, "whitespace-nowrap font-bold")}>{fmtCompact(value)}</span>
    </div>
  );
}

/** Per-source depth bar with source color */
function SourceDepthBar({
  value,
  maxValue,
  barColor,
  textColor,
}: {
  value: number;
  maxValue: number;
  barColor: string;
  textColor: string;
}) {
  if (value <= 0 || maxValue <= 0) return <span className={METRIC_TEXT}>—</span>;
  const pct = Math.min((value / maxValue) * 100, 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[90px] h-[4px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn(METRIC_TEXT, textColor, "whitespace-nowrap")}>{fmtCompact(value)}</span>
    </div>
  );
}

// ─── Source order ─────────────────────────────────────────────────────────────

const SOURCE_ORDER: RfqSourceKey[] = ["cowswap", "bebop", "1inch", "0x", "jupz"];

// ─── Row component ───────────────────────────────────────────────────────────

function AssetRow({
  row,
  globalMax,
  defaultExpanded = false,
}: {
  row: BirdsEyeRfqRow;
  globalMax: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const anyLoading = row.cowLoading || row.bebLoading;
  const noData = row.totalMaxDepth === 0;

  // Always show all sources
  const activeSources = SOURCE_ORDER;

  return (
    <>
      {/* ── Summary row ─────────────────────────────────────────────────── */}
      <tr
        className={cn(
          "border-b border-gray-200/80 dark:border-gray-700/60 transition-colors cursor-pointer select-none",
          "bg-gray-100/90 dark:bg-gray-800/70",
          noData ? "opacity-50" : "hover:bg-gray-200/80 dark:hover:bg-gray-700/60"
        )}
        onClick={() => !noData && !anyLoading && setExpanded((e) => !e)}
      >
        {/* Expand chevron + Asset */}
        <td className="px-3 py-2.5 w-[180px]">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "w-3.5 h-3.5 text-gray-400 transition-transform duration-200",
                expanded && "rotate-90",
                (noData || anyLoading) && "opacity-0"
              )}
            />
            <span className="relative shrink-0 inline-block" style={{ width: 22, height: 22 }}>
              <TokenIcon symbol={row.asset} className="!w-[22px] !h-[22px]" />
            </span>
            <span className="text-[12px] font-bold font-mono text-gray-900 dark:text-white">
              {row.asset}
            </span>
          </div>
        </td>

        {/* Total max depth bar */}
        <td className="px-3 py-2.5">
          {anyLoading ? (
            <div className="h-4 w-32 bp-skeleton rounded" />
          ) : (
            <SummaryDepthBar value={row.totalMaxDepth} maxValue={globalMax} />
          )}
        </td>

        {/* Oracle price */}
        <td className="px-3 py-2.5 text-right">
          <span className={cn(METRIC_TEXT, "font-bold")}>
            {row.oraclePrice ? fmtPrice(row.oraclePrice) : "—"}
          </span>
        </td>

        {/* Buy @10K — empty in summary row */}
        <td className="px-3 py-2.5" />
        {/* Sell @10K — empty in summary row */}
        <td className="px-3 py-2.5" />
      </tr>

      {/* ── Expanded: per-source breakdown ──────────────────────────────── */}
      {expanded &&
        activeSources.map((key) => {
          const src = row.sources[key];
          const meta = RFQ_SOURCE_META[key];
          const diff = fmtDiffPct(src.buyPrice, row.oraclePrice);

          return (
            <tr
              key={`${row.asset}-${key}`}
              className="border-b border-gray-100/60 dark:border-gray-800/40 bg-gray-50/60 dark:bg-gray-900/30"
            >
              {/* Source favicon + name */}
              <td className="px-3 py-1.5 pl-10">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={meta.favicon}
                    alt={meta.label}
                    className="w-4 h-4 rounded-sm"
                    loading="lazy"
                  />
                  <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-400">
                    {meta.label}
                  </span>
                </div>
              </td>

              {/* Source depth bar */}
              <td className="px-3 py-1.5">
                <SourceDepthBar
                  value={src.maxDepth}
                  maxValue={globalMax}
                  barColor={meta.barColor}
                  textColor={meta.textColor}
                />
              </td>

              {/* Oracle — empty for source rows */}
              <td className="px-3 py-1.5" />

              {/* Buy ($10K Order) */}
              <td className="px-3 py-1.5 text-right">
                <div className="flex items-baseline justify-end gap-1.5">
                  <span className={METRIC_TEXT}>{fmtPrice(src.buyPrice)}</span>
                  {diff && (
                    <span className={cn("text-[9px] font-mono font-semibold", diff.color)}>
                      ({diff.text})
                    </span>
                  )}
                </div>
              </td>

              {/* Sell @10K */}
              <td className="px-3 py-1.5 text-right">
                {(() => {
                  const sellDiff = fmtDiffPct(src.sellPrice, row.oraclePrice);
                  return (
                    <div className="flex items-baseline justify-end gap-1.5">
                      <span className={METRIC_TEXT}>{fmtPrice(src.sellPrice)}</span>
                      {sellDiff && (
                        <span className={cn("text-[9px] font-mono font-semibold", sellDiff.color)}>
                          ({sellDiff.text})
                        </span>
                      )}
                    </div>
                  );
                })()}
              </td>
            </tr>
          );
        })}
    </>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

export function BirdsEyeRfqTable({ rows }: { rows: BirdsEyeRfqRow[] }) {
  const sorted = [...rows].sort((a, b) => b.totalMaxDepth - a.totalMaxDepth);

  // Global max = total depth for bar scaling
  const globalMax = Math.max(...rows.map((r) => r.totalMaxDepth), 1);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            {["Asset", "Max Depth (sum of all RFQs)", "Oracle Price", "Buy ($10K Order)", "Sell ($10K Order)"].map((h) => (
              <th
                key={h}
                className={cn(
                  "px-3 py-2.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap",
                  h !== "Asset" && h !== "Max Depth (sum of all RFQs)" && "text-right"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <AssetRow key={row.asset} row={row} globalMax={globalMax} defaultExpanded={i === 0} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
