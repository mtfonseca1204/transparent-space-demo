"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface ArbitragePressureData {
  poolPrice: number;        // Current pool price (token1 per token0)
  oraclePrice: number;      // External oracle price (token1 per token0)
  token0Symbol: string;
  token1Symbol: string;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  disabled?: boolean;
}

// Calculate arbitrage metrics
function calculateArbitrageMetrics(data: ArbitragePressureData) {
  const { poolPrice, oraclePrice, token0UsdPrice, token1UsdPrice } = data;
  
  if (!poolPrice || !oraclePrice || poolPrice <= 0 || oraclePrice <= 0) {
    return {
      deviationPercent: 0,
      direction: "neutral" as const,
      arbProfitPerK: 0,
      pressure: 0,
    };
  }

  // Calculate deviation: positive = pool price > oracle (sell token0 on pool)
  // negative = pool price < oracle (buy token0 on pool)
  const deviationPercent = ((poolPrice - oraclePrice) / oraclePrice) * 100;
  
  // Direction: if pool price > oracle, arbitrageurs should sell token0 on pool (buy elsewhere)
  // if pool price < oracle, arbitrageurs should buy token0 on pool (sell elsewhere)
  const direction = deviationPercent > 0.05 ? "sell" : deviationPercent < -0.05 ? "buy" : "neutral";
  
  // Estimate profit per $1K trade (simplified)
  // Actual profit depends on slippage, fees, etc.
  const absDeviation = Math.abs(deviationPercent);
  const feePercent = 0.3; // Assume 0.3% pool fee
  const netProfitPercent = Math.max(0, absDeviation - feePercent);
  const arbProfitPerK = netProfitPercent * 10; // $profit per $1K trade
  
  // Pressure: 0-100 scale based on deviation
  // 0.5% deviation = 50 pressure, 1% = 100, etc.
  const pressure = Math.min(100, Math.abs(deviationPercent) * 100);
  
  return {
    deviationPercent,
    direction,
    arbProfitPerK,
    pressure,
  };
}

// Status based on deviation
function getStatus(deviationPercent: number): "stable" | "opportunity" | "significant" {
  const abs = Math.abs(deviationPercent);
  if (abs < 0.3) return "stable";
  if (abs < 1) return "opportunity";
  return "significant";
}

// Format price compactly
function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "-";
  if (price >= 1000) return price.toFixed(0);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toExponential(2);
}

export const ArbitragePressureIndicator = ({
  data,
  className,
}: {
  data: ArbitragePressureData;
  className?: string;
}) => {
  const { poolPrice, oraclePrice, token0Symbol, token1Symbol, disabled = false } = data;
  
  const metrics = useMemo(() => calculateArbitrageMetrics(data), [data]);
  const status = getStatus(metrics.deviationPercent);
  
  // Premium desaturated status colors
  const statusColors = {
    stable: { bg: "rgba(91, 138, 114, 0.1)", border: "#5B8A72", text: "#5B8A72" },       // Sage green
    opportunity: { bg: "rgba(196, 144, 82, 0.1)", border: "#C49052", text: "#C49052" },  // Warm bronze
    significant: { bg: "rgba(201, 134, 134, 0.1)", border: "#C98686", text: "#C98686" }, // Dusty rose
  };
  
  const colors = statusColors[status];
  
  // Pressure bar position: 50 = center (neutral), 0 = full left (buy pressure), 100 = full right (sell pressure)
  const barPosition = 50 + (metrics.deviationPercent * 25); // Scale deviation to bar
  const clampedPosition = Math.max(5, Math.min(95, barPosition));
  
  if (disabled) {
    return (
      <div className={cn("flex flex-col h-full font-mono", className)}>
        <div className="flex-1 flex flex-col justify-center items-center opacity-40">
          <div className="text-[var(--bp-text-muted)] text-sm">No data available</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full font-mono gap-4", className)}>
      {/* Header with prices */}
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">Pool Price</span>
          <span className="text-lg font-medium text-[var(--bp-text-primary)]">
            {formatPrice(poolPrice)}
          </span>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <span className="text-[10px] text-[var(--bp-text-muted)] uppercase tracking-wider">Oracle Price</span>
          <span className="text-lg font-medium text-[var(--bp-text-primary)]">
            {formatPrice(oraclePrice)}
          </span>
        </div>
      </div>

      {/* Main pressure bar */}
      <div className="flex-1 flex flex-col justify-center gap-3">
        {/* Direction labels */}
        <div className="flex justify-between items-center text-[10px]">
          <span className={cn(
            "px-2 py-0.5 rounded",
            metrics.direction === "buy" 
              ? "bg-emerald-500/20 text-emerald-400" 
              : "text-[var(--bp-text-muted)]"
          )}>
            ← BUY {token0Symbol}
          </span>
          <span className={cn(
            "px-2 py-0.5 rounded",
            metrics.direction === "sell" 
              ? "bg-rose-500/20 text-rose-400" 
              : "text-[var(--bp-text-muted)]"
          )}>
            SELL {token0Symbol} →
          </span>
        </div>

        {/* Pressure bar */}
        <div className="relative h-10 rounded-md overflow-hidden bg-[var(--bp-bg-card-alt)]">
          {/* Background gradient zones */}
          <div className="absolute inset-0 flex">
            <div className="flex-1 bg-gradient-to-r from-emerald-500/20 to-transparent" />
            <div className="w-px bg-[var(--bp-border-subtle)]" />
            <div className="flex-1 bg-gradient-to-l from-rose-500/20 to-transparent" />
          </div>
          
          {/* Center line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--bp-border-primary)]" />
          
          {/* Pressure indicator */}
          <div 
            className="absolute top-1 bottom-1 w-1 rounded-full transition-all duration-300"
            style={{ 
              left: `${clampedPosition}%`,
              transform: "translateX(-50%)",
              backgroundColor: metrics.direction === "buy" ? "#34d399" : 
                              metrics.direction === "sell" ? "#f87171" : 
                              "var(--bp-text-muted)",
              boxShadow: metrics.direction !== "neutral" 
                ? `0 0 8px ${metrics.direction === "buy" ? "#34d399" : "#f87171"}` 
                : "none",
            }}
          />
          
          {/* Deviation label on bar */}
          <div 
            className="absolute top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-xs font-medium transition-all duration-300"
            style={{ 
              left: `${clampedPosition}%`,
              transform: "translateX(-50%) translateY(-50%)",
              color: metrics.direction === "buy" ? "#34d399" : 
                    metrics.direction === "sell" ? "#f87171" : 
                    "var(--bp-text-primary)",
            }}
          >
            {metrics.deviationPercent > 0 ? "+" : ""}{metrics.deviationPercent.toFixed(2)}%
          </div>
        </div>

        {/* Scale labels */}
        <div className="flex justify-between text-[9px] text-[var(--bp-text-muted)]">
          <span>-2%</span>
          <span>-1%</span>
          <span>0</span>
          <span>+1%</span>
          <span>+2%</span>
        </div>
      </div>

      {/* Bottom stats */}
      <div className="flex justify-between items-end pt-2 border-t border-[var(--bp-border-subtle)]">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-[var(--bp-text-muted)] uppercase">Est. Arb Profit</span>
          <span className="text-sm font-medium" style={{ color: metrics.arbProfitPerK > 0 ? colors.text : "var(--bp-text-muted)" }}>
            ${metrics.arbProfitPerK.toFixed(2)} <span className="text-[9px] text-[var(--bp-text-muted)]">/ $1K</span>
          </span>
        </div>
        <div 
          className="px-3 py-1 rounded text-xs font-medium"
          style={{ 
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}40`,
          }}
        >
          {status === "stable" ? "STABLE" : status === "opportunity" ? "OPPORTUNITY" : "SIGNIFICANT"}
        </div>
      </div>
    </div>
  );
};

