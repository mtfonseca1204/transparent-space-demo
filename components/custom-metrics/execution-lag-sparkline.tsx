"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { LinePath } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { metricColors } from "./metric-colors";
import { motion, useReducedMotion } from "framer-motion";

// Types
export interface ExecutionLagDataPoint {
  timestamp: number;
  lagMs: number;
}

export interface ExecutionLagData {
  points: ExecutionLagDataPoint[];
  pairLabel: string;
  status?: "balanced" | "warning" | "critical";
  thresholdMs?: number;
  minMs?: number;
  maxMs?: number;
  disabled?: boolean;
}

// Root component
export const ExecutionLagMonitor = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("flex flex-col w-full h-full min-w-0 overflow-hidden", className)}>
      {children}
    </div>
  );
};

// Alert indicator
export const ExecutionLagAlertIndicator = ({
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

// Y-axis labels container
export const ExecutionLagYAxis = ({
  minLabel,
  maxLabel,
  className,
}: {
  minLabel: string;
  maxLabel: string;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex flex-col justify-between text-xs pr-2 py-1",
        className
      )}
      style={{ minWidth: 40, color: metricColors.neutral.muted }}
    >
      <span>{maxLabel}</span>
      <span>{minLabel}</span>
    </div>
  );
};

// Sparkline chart using visx
export const ExecutionLagSparkline = ({
  data,
  width,
  height,
  minMs = 0,
  maxMs = 500,
  strokeColor = metricColors.success.fill,
  animationKey,
  className,
}: {
  data: ExecutionLagDataPoint[];
  width: number;
  height: number;
  minMs?: number;
  maxMs?: number;
  strokeColor?: string;
  animationKey?: string;
  className?: string;
}) => {
  if (data.length === 0 || width <= 0 || height <= 0) {
    return null;
  }

  const reduceMotion = useReducedMotion();
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Scales
  const xScale = scaleLinear({
    domain: [0, data.length - 1],
    range: [0, innerWidth],
  });

  const yScale = scaleLinear({
    domain: [minMs, maxMs],
    range: [innerHeight, 0],
  });

  // Accessors
  const getX = (_: ExecutionLagDataPoint, i: number) => xScale(i) ?? 0;
  const getY = (d: ExecutionLagDataPoint) => yScale(d.lagMs) ?? 0;

  return (
    <svg width={width} height={height} className={className}>
      {/* Horizontal grid lines */}
      <line
        x1={padding.left}
        y1={padding.top}
        x2={width - padding.right}
        y2={padding.top}
        stroke={metricColors.neutral.grid}
        strokeWidth={0.5}
      />
      <line
        x1={padding.left}
        y1={padding.top + innerHeight / 2}
        x2={width - padding.right}
        y2={padding.top + innerHeight / 2}
        stroke={metricColors.neutral.grid}
        strokeWidth={0.5}
      />
      <line
        x1={padding.left}
        y1={height - padding.bottom}
        x2={width - padding.right}
        y2={height - padding.bottom}
        stroke={metricColors.neutral.grid}
        strokeWidth={0.5}
      />

      {/* Line path */}
      <motion.g
        key={animationKey}
        transform={`translate(${padding.left}, ${padding.top})`}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.22 }}
      >
        <LinePath
          data={data}
          x={getX}
          y={getY}
          stroke={strokeColor}
          strokeWidth={1.5}
          curve={curveMonotoneX}
        />
      </motion.g>
    </svg>
  );
};

// Responsive wrapper for sparkline
export const ExecutionLagSparklineResponsive = ({
  data,
  minMs,
  maxMs,
  strokeColor,
  animationKey,
  className,
}: {
  data: ExecutionLagDataPoint[];
  minMs?: number;
  maxMs?: number;
  strokeColor?: string;
  animationKey?: string;
  className?: string;
}) => {
  return (
    <div className={cn("flex-1 min-w-0 h-[100px]", className)}>
      <ParentSize>
        {({ width, height }) => (
          <ExecutionLagSparkline
            data={data}
            width={width}
            height={height}
            minMs={minMs}
            maxMs={maxMs}
            strokeColor={strokeColor}
            animationKey={animationKey}
          />
        )}
      </ParentSize>
    </div>
  );
};

// Pair label at bottom
export const ExecutionLagLabel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn("text-sm text-center mt-2", className)}
      style={{ color: metricColors.neutral.muted }}
    >
      {children}
    </div>
  );
};

// Status text at bottom
export const ExecutionLagStatus = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "text-lg sm:text-base font-medium flex items-center justify-center",
        className
      )}
      style={{ color: metricColors.neutral.muted }}
    >
      {children}
    </div>
  );
};

// Utility to determine status from lag data
const getStatusFromLag = (
  points: ExecutionLagDataPoint[],
  thresholdMs: number = 200
): "balanced" | "warning" | "critical" => {
  if (points.length === 0) return "balanced";
  
  const maxLag = Math.max(...points.map((p) => p.lagMs));
  
  if (maxLag >= thresholdMs * 2) return "critical";
  if (maxLag >= thresholdMs) return "warning";
  return "balanced";
};

// Get status display text
const getStatusText = (
  status: "balanced" | "warning" | "critical"
): string => {
  switch (status) {
    case "balanced":
      return "BALANCED";
    case "warning":
      return "WARNING";
    case "critical":
      return "CRITICAL";
  }
};

// Convenience component that renders the full chart from data
export const ExecutionLagChart = ({
  data,
  className,
}: {
  data: ExecutionLagData;
  className?: string;
}) => {
  const {
    points,
    pairLabel,
    thresholdMs = 200,
    minMs = 50,
    maxMs = 500,
    disabled = false,
  } = data;

  // Calculate status if not provided
  const status = data.status ?? getStatusFromLag(points, thresholdMs);
  const strokeColor = disabled
    ? metricColors.disabled.fill
    : status === "critical"
      ? metricColors.danger.fill
      : status === "warning"
        ? metricColors.warning.fill
        : metricColors.success.fill;
  const animationKey = `${status}-${points.length}-${points[points.length - 1]?.timestamp ?? 0}`;

  return (
    <ExecutionLagMonitor className={className}>
      {/* Alert indicator */}
      <div className="flex justify-end mb-2">
        <ExecutionLagAlertIndicator />
      </div>

      {/* Chart content area */}
      <div className="flex-1 flex flex-col justify-center w-full min-w-0">
        {/* Chart area with Y-axis */}
        <div className="flex min-w-0">
          {/* Y-axis labels */}
          <ExecutionLagYAxis
            minLabel={`${minMs}ms`}
            maxLabel={`${maxMs}ms`}
          />
          
          {/* Sparkline */}
          <ExecutionLagSparklineResponsive
            data={points}
            minMs={minMs}
            maxMs={maxMs}
            strokeColor={strokeColor}
            animationKey={animationKey}
          />
        </div>

        {/* Pair label */}
        <ExecutionLagLabel>{pairLabel}</ExecutionLagLabel>
      </div>

      {/* Status */}
      <ExecutionLagStatus>Status: {getStatusText(status)}</ExecutionLagStatus>
    </ExecutionLagMonitor>
  );
};

