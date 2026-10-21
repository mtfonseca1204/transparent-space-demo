"use client";

import React from "react";
import { cn } from "@/lib/utils";

/** Lookback windows offered on the "Campaign TVL Over Time" charts. */
export const CAMPAIGN_TVL_RANGE_OPTIONS = [30, 45, 60, 90] as const;
export type CampaignTvlRange = (typeof CAMPAIGN_TVL_RANGE_OPTIONS)[number];

/** Default window — bounded enough to keep the initial event-replay payload
 *  reasonable while still revealing the immediately-previous campaign. */
export const CAMPAIGN_TVL_DEFAULT_RANGE: CampaignTvlRange = 60;

/**
 * Segmented range control shared by the Campaign-TVL-over-time charts (Uniswap-v3
 * generic + Monad v2) and the 0G incentive-efficiency chart. Defaults to the
 * 30/45/60/90D options; callers can pass a custom `options` list (e.g. the
 * efficiency chart adds 1D/7D). Styling mirrors the other birds-eye range pills.
 */
export function CampaignTvlRangeSelector<T extends number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (days: T) => void;
  options?: readonly T[];
}) {
  const opts = options ?? (CAMPAIGN_TVL_RANGE_OPTIONS as readonly number[] as readonly T[]);
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md bg-gray-100/70 p-0.5 dark:bg-gray-800/50"
      role="group"
      aria-label="Time range"
    >
      {opts.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-pressed={value === n}
          className={cn(
            "cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
            value === n
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
          )}
        >
          {n}D
        </button>
      ))}
    </div>
  );
}
