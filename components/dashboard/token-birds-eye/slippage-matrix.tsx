"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  useSlippageMatrix,
  SIZE_BUCKETS,
  type PoolSlippageRow,
} from "@/hooks/use-slippage-matrix";
import type { PoolMetricsRow } from "@/hooks/use-token-dashboard-data";

const POOL_COLORS = ["#4A6CF7", "#06B6D4", "#8B5CF6", "#F59E0B", "#EC4899", "#10B981"];

function slippageColor(pct: number): string {
  if (pct < 0.1) return "text-emerald-700 dark:text-emerald-400";
  if (pct < 1) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function formatSlippage(pct: number): string {
  if (pct < 10) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

interface SlippageMatrixProps {
  poolRows: PoolMetricsRow[];
  trackedTokenSymbol: string;
}

export function SlippageMatrix({ poolRows, trackedTokenSymbol }: SlippageMatrixProps) {
  const { data: matrixData, isLoading } = useSlippageMatrix(poolRows, trackedTokenSymbol);

  return (
    <div className="bp-card relative flex flex-col min-w-0 overflow-hidden">
      <div className="bp-card-inner" />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
          Trade Size Slippage
        </span>
        <div className="flex gap-3 text-[10px] text-gray-400 items-center">
          <span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
              &bull;
            </span>{" "}
            &lt;0.1%
          </span>
          <span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">
              &bull;
            </span>{" "}
            0.1&ndash;1%
          </span>
          <span>
            <span className="text-red-600 dark:text-red-400 font-bold">
              &bull;
            </span>{" "}
            &gt;1%
          </span>
        </div>
      </div>
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr>
            <th className="text-left px-2 py-2 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b-2 border-[var(--bp-border-subtle)] w-[22%]">
              Pool
            </th>
            {SIZE_BUCKETS.map((bucket, i) => (
              <th
                key={bucket.id}
                colSpan={2}
                className={cn(
                  "text-center px-1 py-2 text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase border-b-2 border-[var(--bp-border-subtle)]",
                  i % 2 === 0
                    ? "bg-gray-100/70 dark:bg-gray-800/60"
                    : ""
                )}
              >
                <div>{bucket.label}</div>
                <div className="flex justify-center gap-3 mt-0.5 text-[9px] font-semibold text-gray-500 dark:text-gray-400 normal-case tracking-normal">
                  <span>Buy</span>
                  <span>Sell</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td
                colSpan={1 + SIZE_BUCKETS.length * 2}
                className="text-center py-6 text-gray-400 text-sm"
              >
                <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto" />
              </td>
            </tr>
          ) : (
            matrixData.map((row, rowIdx) => (
              <tr key={row.poolKey}>
                <td className="px-2 py-3 font-bold text-[12px] whitespace-nowrap border-b border-gray-100 dark:border-gray-800">
                  <span
                    className="inline-block w-[5px] h-[5px] rounded-full mr-1.5 align-middle"
                    style={{
                      background:
                        POOL_COLORS[rowIdx % POOL_COLORS.length],
                    }}
                  />
                  <div>{row.poolLabel}</div>
                  <div className="text-[9px] text-gray-400 font-medium">
                    {row.fee}
                  </div>
                </td>
                {row.buckets.map((bucket, colIdx) => (
                  <React.Fragment key={`${row.poolKey}-${colIdx}`}>
                    <td
                      className={cn(
                        "text-center px-1 py-3 border-b border-gray-100 dark:border-gray-800",
                        colIdx % 2 === 0
                          ? "bg-gray-100/70 dark:bg-gray-800/60"
                          : ""
                      )}
                    >
                      <span
                        className={cn(
                          "font-mono text-[12px] font-bold",
                          slippageColor(bucket.buyPct)
                        )}
                      >
                        {formatSlippage(bucket.buyPct)}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "text-center px-1 py-3 border-b border-gray-100 dark:border-gray-800",
                        colIdx % 2 === 0
                          ? "bg-gray-100/70 dark:bg-gray-800/60"
                          : "",
                        colIdx < SIZE_BUCKETS.length - 1
                          ? "border-r border-[var(--bp-border-subtle)]"
                          : ""
                      )}
                    >
                      <span
                        className={cn(
                          "font-mono text-[12px] font-bold",
                          slippageColor(bucket.sellPct)
                        )}
                      >
                        {formatSlippage(bucket.sellPct)}
                      </span>
                    </td>
                  </React.Fragment>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
