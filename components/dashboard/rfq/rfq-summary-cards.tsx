"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { RfqTierRow } from "@/hooks/use-rfq-data";
import {
  MetricCard,
  MetricLabel,
  MetricValue,
  MetricUnit,
} from "@/components/dashboard/metric-card";

interface RfqSummaryCardsProps {
  forwardTiers: RfqTierRow[];
  reverseTiers: RfqTierRow[];
}

function impactColor(bps: number): string {
  if (bps < 10) return "text-emerald-500";
  if (bps < 50) return "text-amber-500";
  return "text-red-500";
}

export function RfqSummaryCards({
  forwardTiers,
  reverseTiers,
}: RfqSummaryCardsProps) {
  const [direction, setDirection] = useState<"forward" | "reverse">("forward");
  const tiers = direction === "forward" ? forwardTiers : reverseTiers;

  return (
    <div className="flex flex-col gap-3">
      {/* Direction toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDirection("forward")}
          className={cn(
            "px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
            direction === "forward"
              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          )}
        >
          Buy {tiers[0]?.quote ? "Token" : ""}
        </button>
        <button
          type="button"
          onClick={() => setDirection("reverse")}
          className={cn(
            "px-3 py-1 text-[11px] font-medium transition-colors cursor-pointer",
            direction === "reverse"
              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          )}
        >
          Sell {tiers[0]?.quote ? "Token" : ""}
        </button>
      </div>

      {/* Cards grid — stretch to fill available width */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
        {tiers.map((tier) => (
          <MetricCard key={`${tier.direction}-${tier.notionalUsd}`}>
            <MetricLabel>{tier.label} swap</MetricLabel>
            <MetricValue>
              <span className={impactColor(tier.priceImpactBps)}>
                {tier.priceImpactBps < 0.01
                  ? "~0"
                  : tier.priceImpactBps.toFixed(2)}
              </span>
            </MetricValue>
            <MetricUnit>bps impact</MetricUnit>
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
                {tier.tokensOut < 1
                  ? tier.tokensOut.toFixed(6)
                  : tier.tokensOut < 100
                    ? tier.tokensOut.toFixed(2)
                    : Math.round(tier.tokensOut).toLocaleString()}{" "}
                tokens out
              </span>
              <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
                {tier.routeCount} route{tier.routeCount !== 1 ? "s" : ""}
              </span>
            </div>
          </MetricCard>
        ))}
      </div>
    </div>
  );
}
