"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { RfqTierRow } from "@/hooks/use-rfq-data";
import type { SolanaPoolMetadata } from "@/lib/pools";
import { ChartCard, ChartHeader, ChartTitle, ChartContent } from "@/components/dashboard/chart-card";

const AMM_COLORS: Record<string, string> = {
  "Raydium CLMM": "#818cf8",
  Byreal: "#fbbf24",
  PancakeSwap: "#06b6d4",
  HumidiFi: "#a78bfa",
  Whirlpool: "#34d399",
  "SolFi V2": "#f472b6",
  TesseraV: "#fb923c",
};

function impactColor(bps: number): string {
  if (bps < 10) return "text-emerald-500";
  if (bps < 50) return "text-amber-500";
  return "text-red-500";
}

interface RfqDataTableProps {
  tiers: RfqTierRow[];
  poolMeta: SolanaPoolMetadata;
}

export function RfqDataTable({ tiers, poolMeta }: RfqDataTableProps) {
  if (tiers.length === 0) return null;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Raw Data</ChartTitle>
      </ChartHeader>
      <ChartContent className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-[var(--bp-border-subtle)]">
              {[
                "Trade Size",
                "Direction",
                "Tokens Out",
                "Price/Token",
                "Impact (bps)",
                "Fee (bps)",
                "Total Cost",
                "Routes",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left py-2 px-2.5 font-semibold text-[var(--bp-text-muted)] text-[10px] uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr
                key={`${tier.direction}-${tier.notionalUsd}`}
                className="border-b border-[var(--bp-border-subtle)]/50 hover:bg-[var(--bp-bg-hover)]"
              >
                <td className="py-2 px-2.5 text-[var(--bp-text-primary)] font-semibold">
                  {tier.label}
                </td>
                <td className="py-2 px-2.5">
                  <span
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 font-medium",
                      tier.direction === "forward"
                        ? "bg-emerald-100/60 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                        : "bg-orange-100/60 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                    )}
                  >
                    {tier.direction === "forward" ? "Buy" : "Sell"}
                  </span>
                </td>
                <td className="py-2 px-2.5 text-[var(--bp-text-secondary)]">
                  {tier.tokensOut < 1
                    ? tier.tokensOut.toFixed(6)
                    : tier.tokensOut.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                </td>
                <td className="py-2 px-2.5 text-[var(--bp-text-secondary)]">
                  ${tier.impliedTokenPrice.toFixed(4)}
                </td>
                <td className={cn("py-2 px-2.5", impactColor(tier.priceImpactBps))}>
                  {tier.priceImpactBps < 0.01
                    ? "~0"
                    : tier.priceImpactBps.toFixed(3)}
                </td>
                <td className="py-2 px-2.5 text-blue-500">
                  {tier.feeBps.toFixed(1)}
                </td>
                <td className="py-2 px-2.5 text-[var(--bp-text-primary)] font-semibold">
                  {tier.totalCostBps.toFixed(2)}
                </td>
                <td className="py-2 px-2.5">
                  <div className="flex flex-wrap gap-1">
                    {tier.routes.map((r, j) => {
                      const color = AMM_COLORS[r.label] ?? "#888";
                      return (
                        <span
                          key={j}
                          className="inline-flex items-center text-[10px] font-medium whitespace-nowrap rounded-full px-2 py-0.5"
                          style={{
                            backgroundColor: `${color}18`,
                            color,
                            border: `1px solid ${color}30`,
                          }}
                        >
                          {r.label} {r.percent}%
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartContent>
    </ChartCard>
  );
}
