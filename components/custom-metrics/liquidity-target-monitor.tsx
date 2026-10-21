"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { metricColors } from "./metric-colors";
import { motion, useReducedMotion } from "framer-motion";
import { TokenIcon } from "@/components/dashboard/pool-header";

// Token-specific colors - pastel transformations of logo colors
// Each token's pastel is derived from its brand/logo color
const TOKEN_COLORS: Record<string, { gradient: string; surface: string; border: string; text: string }> = {
  WLD: {
    // Logo: Black (#000000) → Pastel: Soft gray/silver
    gradient: "linear-gradient(135deg, #E5E7EB 0%, #D1D5DB 100%)",
    surface: "rgba(229, 231, 235, 0.2)",
    border: "rgba(156, 163, 175, 0.4)",
    text: "#374151",
  },
  USDC: {
    // Logo: Blue (#2775CA) → Pastel: Soft blue
    gradient: "linear-gradient(135deg, #BFDBFE 0%, #93C5FD 100%)",
    surface: "rgba(191, 219, 254, 0.2)",
    border: "rgba(147, 197, 253, 0.4)",
    text: "#2563EB",
  },
  WETH: {
    // Logo: Purple-blue (#627EEA) → Pastel: Soft purple-blue
    gradient: "linear-gradient(135deg, #C7D2FE 0%, #A5B4FC 100%)",
    surface: "rgba(199, 210, 254, 0.2)",
    border: "rgba(165, 180, 252, 0.4)",
    text: "#4F46E5",
  },
  ETH: {
    // Logo: Purple-blue (#627EEA) → Pastel: Soft purple-blue
    gradient: "linear-gradient(135deg, #C7D2FE 0%, #A5B4FC 100%)",
    surface: "rgba(199, 210, 254, 0.2)",
    border: "rgba(165, 180, 252, 0.4)",
    text: "#4F46E5",
  },
  WARS: {
    // Logo: Orange/Gold → Pastel: Soft peach/orange
    gradient: "linear-gradient(135deg, #FED7AA 0%, #FDBA74 100%)",
    surface: "rgba(254, 215, 170, 0.2)",
    border: "rgba(253, 186, 116, 0.4)",
    text: "#EA580C",
  },
  USDT: {
    // Logo: Teal (#26A17B) → Pastel: Soft teal
    gradient: "linear-gradient(135deg, #A7F3D0 0%, #6EE7B7 100%)",
    surface: "rgba(167, 243, 208, 0.2)",
    border: "rgba(110, 231, 183, 0.4)",
    text: "#059669",
  },
  DAI: {
    // Logo: Yellow/Gold (#F5AC37) → Pastel: Soft yellow
    gradient: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
    surface: "rgba(254, 243, 199, 0.2)",
    border: "rgba(253, 230, 138, 0.4)",
    text: "#D97706",
  },
};

// Get token color or fallback to default
const getTokenColor = (symbol: string) => {
  const normalized = symbol.toUpperCase();
  return TOKEN_COLORS[normalized] || {
    // Default: Neutral gray pastel
    gradient: "linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%)",
    surface: "rgba(243, 244, 246, 0.2)",
    border: "rgba(209, 213, 219, 0.4)",
    text: "#6B7280",
  };
};

// Types
export interface LiquidityTokenData {
  symbol: string;
  actual: number;
  target: number;
}

export interface LiquidityTargetData {
  tokens: LiquidityTokenData[];
  maxValue?: number; // Maximum value for scaling bars (defaults to max of all values)
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

// Utility to calculate bar width as percentage
const calculateBarWidth = (
  value: number,
  max: number
): number => {
  return Math.min((value / max) * 100, 100);
};

// Utility to calculate target line position as percentage
const calculateTargetPosition = (
  target: number,
  max: number
): number => {
  return Math.min((target / max) * 100, 100);
};

// Root component
export const LiquidityTargetMonitor = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("flex flex-col w-full h-full", className)}>
      {children}
    </div>
  );
};

// Container for the rows with relative positioning for the target line
export const LiquidityTargetRows = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("relative flex flex-col gap-6", className)}>
      {children}
    </div>
  );
};

// Individual token row
export const LiquidityTargetRow = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {children}
    </div>
  );
};

// Token symbol label with icon
export const LiquidityTokenLabel = ({
  children,
  symbol,
  className,
}: {
  children: React.ReactNode;
  symbol?: string;
  className?: string;
}) => {
  return (
    <div className={cn("flex items-center gap-2 w-24 shrink-0", className)}>
      {symbol && (
        // .ts-coin sets position: absolute and a fixed 38px size. Wrap in a
        // relative slot of the intended size and force the icon to fill it.
        <span className="relative shrink-0 inline-block" style={{ width: 20, height: 20 }}>
          <TokenIcon symbol={symbol} className="!w-[20px] !h-[20px] rounded-full" />
        </span>
      )}
      <span
        className="text-base font-medium"
        style={{ color: metricColors.neutral.text, fontSize: "14px" }}
      >
        {children}
      </span>
    </div>
  );
};

// Bar container (holds background bar and fill)
export const LiquidityTargetBar = ({
  children,
  variant = "light",
  tokenSymbol,
  className,
}: {
  children: React.ReactNode;
  variant?: "light" | "dark" | "disabled";
  tokenSymbol?: string;
  className?: string;
}) => {
  // Use token-specific colors if provided
  const tokenColor = tokenSymbol ? getTokenColor(tokenSymbol) : null;
  
  const borderColor = tokenColor
    ? tokenColor.border
    : variant === "disabled"
      ? metricColors.disabled.border
      : variant === "light"
        ? metricColors.success.border
        : metricColors.danger.border;
  const bgColor = tokenColor
    ? tokenColor.surface
    : variant === "disabled"
      ? metricColors.disabled.surface
      : variant === "light"
        ? metricColors.success.surface
        : metricColors.danger.surface;

  return (
    <div
      className={cn("relative flex-1 h-8 rounded overflow-hidden", className)}
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
      }}
    >
      {children}
    </div>
  );
};

// Bar fill (the actual value portion)
export const LiquidityBarFill = ({
  widthPercent,
  variant = "light",
  tokenSymbol,
  className,
}: {
  widthPercent: number;
  variant?: "light" | "dark" | "disabled";
  tokenSymbol?: string;
  className?: string;
}) => {
  // Use token-specific colors if provided
  const tokenColor = tokenSymbol ? getTokenColor(tokenSymbol) : null;
  
  const bgStyle = tokenColor
    ? { background: tokenColor.gradient }
    : {
        backgroundColor:
          variant === "disabled"
            ? metricColors.disabled.fill
            : variant === "light"
              ? metricColors.success.fill
              : metricColors.danger.fill,
      };
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={cn("absolute top-0 left-0 bottom-0 rounded-l", className)}
      initial={false}
      animate={{ width: `${widthPercent}%` }}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 26 }
      }
      style={bgStyle}
    />
  );
};

// Value label inside the bar
export const LiquidityValueLabel = ({
  children,
  variant = "light",
  widthPercent,
  title,
  className,
}: {
  children: React.ReactNode;
  variant?: "light" | "dark" | "disabled";
  widthPercent?: number; // Used for dark variant to position inside fill
  title?: string; // Tooltip with full value
  className?: string;
}) => {
  const textColor =
    variant === "disabled"
      ? metricColors.disabled.text
      : variant === "light"
        ? metricColors.success.text
        : metricColors.danger.text;
  const reduceMotion = useReducedMotion();

  // For dark variant, position inside the fill area; for light, at the end
  const positionStyle: { left?: number | string; right?: string; transform: string } =
    variant !== "light" && variant !== "disabled" && widthPercent !== undefined
      ? (() => {
          // Keep the label inside the bar even when fill is tiny (e.g., 0%).
          const isTiny = widthPercent < 12;
          if (isTiny) {
            return { left: 8, transform: "translateY(-50%)" };
          }
          return {
            left: `calc(${widthPercent}% - 8px)`,
            transform: "translateX(-100%) translateY(-50%)",
          };
        })()
      : { right: "12px", transform: "translateY(-50%)" };

  return (
    <motion.span
      className={cn(
        "absolute top-1/2 z-10 font-medium whitespace-nowrap cursor-default",
        className
      )}
      initial={false}
      animate={positionStyle}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }
      }
      style={{
        color: textColor,
        fontSize: "12px",
      }}
      title={title}
    >
      {children}
    </motion.span>
  );
};

// Target line that spans all rows
export const LiquidityTargetLine = ({
  position,
  className,
}: {
  position: number; // Position as percentage (0-100)
  className?: string;
}) => {
  return (
    <div
      className={cn("absolute top-0 bottom-0 z-20 pointer-events-none", className)}
      style={{
        left: `${position}%`,
      }}
    >
      <div
        className="h-full border-l-2 border-dashed"
        style={{
          borderColor: metricColors.neutral.muted,
        }}
      />
    </div>
  );
};

// Target label (top or bottom)
export const LiquidityTargetLabel = ({
  children,
  position,
  placement = "top",
  className,
}: {
  children: React.ReactNode;
  position: number; // Position as percentage (0-100)
  placement?: "top" | "bottom";
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "relative w-full",
        placement === "top" ? "mb-1" : "mt-1",
        className
      )}
    >
      <span
        className="absolute -translate-x-1/2"
        style={{
          left: `${position}%`,
          fontSize: "8px",
          color: metricColors.neutral.muted,
        }}
      >
        {children}
      </span>
    </div>
  );
};

// Status text at bottom
export const LiquidityTargetStatus = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("mt-6 text-lg sm:text-base font-medium flex items-center justify-center text-gray-500", className)}>
      {children}
    </div>
  );
};

// Failure indicator
export const FailureIndicator = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <img 
      src="/icons/error-icon.svg" 
      alt="Error" 
      className={cn("w-6 h-6", className)}
    />
  );
};

// Warning indicator
export const WarningIndicator = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <img 
      src="/icons/warning-icon.svg" 
      alt="Warning" 
      className={cn("w-8 h-8", className)}
    />
  );
};

// Simple success checkmark
export const SuccessCheck = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <img 
      src="/icons/success-icon.svg" 
      alt="Success" 
      className={cn("w-6 h-6", className)}
    />
  );
};

// Format number with K, M notation
const formatCompact = (value: number): string => {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
};

// Format full number for tooltip
const formatFull = (value: number): string => {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Convenience component that renders the full chart from data
export const LiquidityTargetChart = ({
  data,
  className,
}: {
  data: LiquidityTargetData;
  className?: string;
}) => {
  const {
    tokens,
    formatValue = formatCompact,
    disabled = false,
  } = data;

  // Calculate max value for scaling (use the larger of max actual or max target)
  const allValues = tokens.flatMap(t => [t.actual, t.target]);
  const maxValue = data.maxValue ?? Math.max(...allValues) * 1.2; // 20% padding

  // Get target (assuming all tokens have same target for the shared line)
  const targetValue = tokens[0]?.target ?? 0;
  const targetPosition = calculateTargetPosition(targetValue, maxValue);

  // Surface a chart-level warning only when at least one token misses target.
  const hasShortfall = !disabled && tokens.some((t) => t.actual < t.target);

  // Calculate bar area offset for target line positioning
  // Token label is 96px (w-24) + 12px gap (gap-3) = 108px offset
  const barAreaOffset = 108;
  // Status indicator is roughly 32px + gap
  const barAreaEnd = 44;

  return (
    <LiquidityTargetMonitor className={cn("relative", className)}>
      {/* Warning indicator — pinned to the chart's top-right, only when a token misses target */}
      {hasShortfall && (
        <div className="absolute top-0 right-0 z-10">
          <WarningIndicator />
        </div>
      )}

      {/* Chart content area */}
      <div className="flex-1 flex flex-col justify-center w-full">
        {/* Top target label - positioned relative to bar area */}
        <div className="relative h-4 mb-2" style={{ marginLeft: barAreaOffset, marginRight: barAreaEnd }}>
          <LiquidityTargetLabel position={targetPosition} placement="top">
            Target: {formatCompact(targetValue)}
          </LiquidityTargetLabel>
        </div>

        {/* Rows container with target line */}
        <div className="relative" style={{ marginLeft: 0 }}>
          {/* The target line spanning all rows - positioned in bar area only */}
          <div 
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ 
              left: barAreaOffset,
              right: barAreaEnd,
            }}
          >
            <LiquidityTargetLine position={targetPosition} />
          </div>

          <LiquidityTargetRows>
            {tokens.map((token, index) => {
              const meetsTarget = token.actual >= token.target;
              const variant = disabled ? "disabled" : meetsTarget ? "light" : "dark";
              const barWidth = calculateBarWidth(token.actual, maxValue);

              return (
                <LiquidityTargetRow key={index}>
                  <LiquidityTokenLabel symbol={token.symbol}>{token.symbol}</LiquidityTokenLabel>
                  <LiquidityTargetBar variant={variant} tokenSymbol={token.symbol}>
                    <LiquidityBarFill widthPercent={barWidth} variant={variant} tokenSymbol={token.symbol} />
                    <LiquidityValueLabel
                      variant={variant}
                      widthPercent={barWidth}
                      title={formatFull(token.actual)}
                    >
                      {formatValue(token.actual)}
                    </LiquidityValueLabel>
                  </LiquidityTargetBar>
                  <div className="w-8 flex items-center justify-center shrink-0">
                    {meetsTarget ? <SuccessCheck /> : <FailureIndicator />}
                  </div>
                </LiquidityTargetRow>
              );
            })}
          </LiquidityTargetRows>
        </div>

        {/* Bottom target label - positioned relative to bar area */}
        <div className="relative h-4 mt-2" style={{ marginLeft: barAreaOffset, marginRight: barAreaEnd }}>
          <LiquidityTargetLabel position={targetPosition} placement="bottom">
            Target: {formatCompact(targetValue)}
          </LiquidityTargetLabel>
        </div>
      </div>

      {/* Status */}
      <LiquidityTargetStatus>
        Status: OK
      </LiquidityTargetStatus>
    </LiquidityTargetMonitor>
  );
};
