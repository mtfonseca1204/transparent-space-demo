"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { metricColors } from "./metric-colors";
import { motion, useReducedMotion } from "framer-motion";

// Types
export interface InventoryTiltTokenData {
  symbol: string;
  percent: number;
}

export interface InventoryTiltData {
  leftToken: InventoryTiltTokenData;
  rightToken: InventoryTiltTokenData;
  status?: "balanced" | "imbalanced" | "critical";
  threshold?: number; // e.g., 5% deviation from 50% considered balanced
  disabled?: boolean;
}

// Root component
export const InventoryTiltMonitor = ({
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

// Alert indicator
export const AlertIndicator = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <img 
      src="/icons/error-icon.svg" 
      alt="Alert" 
      className={cn("w-8 h-8", className)}
    />
  );
};

// Header row with token names and percentages
export const InventoryTiltHeader = ({
  leftSymbol,
  leftPercent,
  rightSymbol,
  rightPercent,
  className,
}: {
  leftSymbol: string;
  leftPercent: number;
  rightSymbol: string;
  rightPercent: number;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm font-medium mb-3",
        className
      )}
    >
      <span style={{ color: metricColors.neutral.muted }}>{leftSymbol}</span>
      <span style={{ color: metricColors.neutral.text }}>
        {leftPercent}% | {rightPercent}%
      </span>
      <span style={{ color: metricColors.neutral.muted }}>{rightSymbol}</span>
    </div>
  );
};

// The main balance bar container with center-out fill structure
export const InventoryTiltBar = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "relative w-full h-[36px] rounded-md overflow-hidden",
        className
      )}
      style={{
        backgroundColor: metricColors.surface,
      }}
    >
      {children}
    </div>
  );
};

// Fixed background zones matching thresholds:
// 0-20 red, 20-40 amber, 40-60 green, 60-80 amber, 80-100 red.
export const InventoryTiltZones = ({ className }: { className?: string }) => {
  return (
    <div className={cn("absolute inset-0 flex", className)} aria-hidden="true">
      <div style={{ width: "20%", backgroundColor: metricColors.danger.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.warning.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.success.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.warning.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.danger.fillSoft }} />
    </div>
  );
};

export const InventoryTiltZonesDisabled = ({ className }: { className?: string }) => {
  return (
    <div className={cn("absolute inset-0 flex", className)} aria-hidden="true">
      <div style={{ width: "20%", backgroundColor: metricColors.disabled.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.disabled.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.disabled.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.disabled.fillSoft }} />
      <div style={{ width: "20%", backgroundColor: metricColors.disabled.fillSoft }} />
    </div>
  );
};

// Circular indicator in the center of the bar
export const InventoryTiltIndicator = ({
  position,
  disabled = false,
  className,
}: {
  position: number; // Position as percentage (0-100)
  disabled?: boolean;
  className?: string;
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={cn(
        "absolute w-7 h-7 rounded-full border-2 z-10",
        className
      )}
      initial={false}
      animate={{ left: `${position}%` }}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 28 }
      }
      style={{
        top: "50%",
        transform: "translateX(-50%) translateY(-50%)",
        backgroundColor: "#ffffff",
        borderColor: disabled ? metricColors.disabled.border : metricColors.neutral.tick,
      }}
    />
  );
};

// Arrow/triangle pointing up below the bar (center marker)
export const InventoryTiltArrow = ({
  position,
  disabled = false,
  className,
}: {
  position: number; // Position as percentage (0-100)
  disabled?: boolean;
  className?: string;
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className={cn("relative w-full h-4 mt-1", className)}
    >
      <motion.div
        className="absolute"
        initial={false}
        animate={{ left: `${position}%` }}
        transition={
          reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 28 }
        }
        style={{
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: `10px solid ${disabled ? metricColors.disabled.fill : metricColors.neutral.tick}`,
        }}
      />
    </div>
  );
};

// Status text at bottom
export const InventoryTiltStatus = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "mt-4 text-lg sm:text-base font-medium flex items-center justify-center",
        className
      )}
      style={{ color: metricColors.neutral.muted }}
    >
      {children}
    </div>
  );
};

// Utility to determine status from percentages
const getStatusFromPercents = (
  leftPercent: number,
  threshold: number = 5
): "balanced" | "imbalanced" | "critical" => {
  const deviation = Math.abs(leftPercent - 50);
  if (deviation <= threshold) return "balanced";
  if (deviation <= threshold * 2) return "imbalanced";
  return "critical";
};

// Get status display text
const getStatusText = (status: "balanced" | "imbalanced" | "critical"): string => {
  switch (status) {
    case "balanced":
      return "BALANCED";
    case "imbalanced":
      return "IMBALANCED";
    case "critical":
      return "CRITICAL";
  }
};

// Convenience component that renders the full chart from data
export const InventoryTiltChart = ({
  data,
  className,
}: {
  data: InventoryTiltData;
  className?: string;
}) => {
  const {
    leftToken,
    rightToken,
    threshold = 5,
    disabled = false,
  } = data;

  // Calculate status if not provided
  const status = data.status ?? getStatusFromPercents(leftToken.percent, threshold);
  
  // The indicator position is based on left percentage
  // 50% means perfectly centered, higher means tilted toward left
  const indicatorPosition = leftToken.percent;

  return (
    <InventoryTiltMonitor className={className}>
      {/* Alert indicator */}
      <div className="flex justify-end mb-2">
        <AlertIndicator />
      </div>

      {/* Chart content area */}
      <div className="flex-1 flex flex-col justify-center w-full">
        {/* Header with token names and percentages */}
        <InventoryTiltHeader
          leftSymbol={leftToken.symbol}
          leftPercent={leftToken.percent}
          rightSymbol={rightToken.symbol}
          rightPercent={rightToken.percent}
        />

        {/* Bar */}
        <InventoryTiltBar>
          {/* Fixed zones */}
          {disabled ? <InventoryTiltZonesDisabled /> : <InventoryTiltZones />}
          {/* Center indicator */}
          <InventoryTiltIndicator position={indicatorPosition} disabled={disabled} />
        </InventoryTiltBar>

        {/* Arrow below the bar pointing to center */}
        <InventoryTiltArrow position={indicatorPosition} disabled={disabled} />
      </div>

      {/* Status */}
      <InventoryTiltStatus>
        Status: {getStatusText(status)}
      </InventoryTiltStatus>
    </InventoryTiltMonitor>
  );
};
