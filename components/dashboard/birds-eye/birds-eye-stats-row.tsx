"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Check, AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { BirdsEyeData } from "@/hooks/use-birds-eye-data";

const STATS = [
  {
    key: "total",
    label: "TOTAL ASSETS",
    unit: "monitored",
    getValue: (d: BirdsEyeData) => d.totalAssets,
    valueColor: "text-gray-900 dark:text-white",
    iconBg: "bg-gray-400/80 dark:bg-gray-500/80",
    stroke: "!border-gray-300 dark:!border-gray-600",
    fill: "!bg-gray-100/50 dark:!bg-gray-800/30",
    Icon: Info,
  },
  {
    key: "healthy",
    label: "HEALTHY",
    unit: "no issues",
    getValue: (d: BirdsEyeData) => d.healthyCount,
    valueColor: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-500 dark:bg-emerald-500",
    stroke: "!border-emerald-400 dark:!border-emerald-500/60",
    fill: "!bg-emerald-50/60 dark:!bg-emerald-950/20",
    Icon: Check,
  },
  {
    key: "watch",
    label: "WATCH",
    unit: "minor concerns",
    getValue: (d: BirdsEyeData) => d.watchCount,
    valueColor: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-500 dark:bg-amber-500",
    stroke: "!border-amber-400 dark:!border-amber-500/60",
    fill: "!bg-amber-50/60 dark:!bg-amber-950/20",
    Icon: AlertTriangle,
  },
  {
    key: "critical",
    label: "CRITICAL",
    unit: "action needed",
    getValue: (d: BirdsEyeData) => d.criticalCount,
    valueColor: "text-red-600 dark:text-red-400",
    iconBg: "bg-red-500 dark:bg-red-500",
    stroke: "!border-red-400 dark:!border-red-500/60",
    fill: "!bg-red-50/60 dark:!bg-red-950/20",
    Icon: AlertCircle,
  },
] as const;

export function BirdsEyeStatsRow({ data }: { data: BirdsEyeData }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {STATS.map((stat) => (
        <div key={stat.key} className={cn("bp-card", stat.stroke, stat.fill)}>
          <div className="bp-card-inner" />
          <div className="flex items-start justify-between mb-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              {stat.label}
            </div>
            <div
              className={cn(
                "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
                stat.iconBg
              )}
            >
              <stat.Icon className="w-3 h-3 text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div
            className={cn(
              "text-3xl font-bold font-mono tracking-tight leading-none",
              stat.valueColor
            )}
          >
            {data.isLoading ? "\u2014" : stat.getValue(data)}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
            {stat.unit}
          </div>
        </div>
      ))}
    </div>
  );
}
