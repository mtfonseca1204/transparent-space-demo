"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { LpLabel } from "@/components/dashboard/lp-label";

interface LPComparisonRow {
  address: string;
  liquidityPct: number;
  volumePct: number;
  liquidityUsd?: number;
  volumeUsd?: number;
}

interface LPComparisonTableProps {
  data: LPComparisonRow[];
  className?: string;
  onSelect?: (address: string) => void;
  selectedAddress?: string | null;
  spaceSlug?: string | null;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function getEfficiencyColor(ratio: number): string {
  if (ratio >= 1.2) return "text-green-600";
  if (ratio >= 0.8) return "text-gray-600";
  return "text-red-500";
}

function getEfficiencyBg(ratio: number): string {
  if (ratio >= 1.2) return "bg-green-50";
  if (ratio >= 0.8) return "bg-gray-50";
  return "bg-red-50";
}

export const LPComparisonTable: React.FC<LPComparisonTableProps> = ({
  data,
  className,
  onSelect,
  selectedAddress,
  spaceSlug,
}) => {
  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-[var(--bp-text-muted)]">No data available</p>
      </div>
    );
  }

  // Sort by liquidity percentage descending - show ALL LPs
  const sortedData = [...data].sort((a, b) => b.liquidityPct - a.liquidityPct);

  return (
    <div className={cn("h-full w-full flex flex-col", className)}>
      {/* Fixed header */}
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-[var(--bp-border-subtle)]">
            <th className="text-left py-1.5 px-2 font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider text-[9px]">
              LP
            </th>
            <th className="text-right py-1.5 px-2 font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider text-[9px]">
              Liq %
            </th>
            <th className="text-right py-1.5 px-2 font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider text-[9px]">
              Vol %
            </th>
            <th className="text-right py-1.5 px-2 font-semibold text-[var(--bp-text-muted)] uppercase tracking-wider text-[9px]">
              Eff.
            </th>
          </tr>
        </thead>
      </table>
      
      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <table className="w-full text-[11px] font-mono">
          <tbody>
            {sortedData.map((row) => {
              const efficiency = row.liquidityPct > 0 ? row.volumePct / row.liquidityPct : 0;
              const isSelected = selectedAddress?.toLowerCase() === row.address.toLowerCase();

              return (
                <tr
                  key={row.address}
                  className={cn(
                    "border-b border-[var(--bp-border-subtle)] last:border-b-0 transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[var(--ts-surface-2)] hover:bg-[var(--ts-surface-3)]"
                      : "hover:bg-[var(--bp-bg-hover)]"
                  )}
                  onClick={() => onSelect?.(row.address)}
                >
                  <td className="py-1 px-2">
                    <LpLabel
                      address={row.address}
                      spaceSlug={spaceSlug}
                      className={cn(
                        "text-[var(--bp-text-secondary)]",
                        isSelected && "font-semibold text-[var(--ts-ink-0)]"
                      )}
                    />
                  </td>
                  <td className="text-right py-1 px-2 tabular-nums text-[var(--bp-text-primary)]">
                    {formatPct(row.liquidityPct)}
                  </td>
                  <td className="text-right py-1 px-2 tabular-nums text-[var(--bp-text-primary)]">
                    {formatPct(row.volumePct)}
                  </td>
                  <td className="text-right py-1 px-2">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums",
                        getEfficiencyColor(efficiency),
                        getEfficiencyBg(efficiency)
                      )}
                    >
                      {efficiency >= 0.01 ? `${efficiency.toFixed(2)}x` : "-"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* Legend - fixed at bottom */}
      <div className="shrink-0 mt-2 pt-2 border-t border-[var(--bp-border-subtle)] px-2">
        <div className="flex items-center justify-between text-[9px] text-[var(--bp-text-muted)]">
          <span>{sortedData.length} LPs</span>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-green-500" />
              &gt;1.2x
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-gray-400" />
              0.8-1.2x
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-red-400" />
              &lt;0.8x
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LPComparisonTable;
