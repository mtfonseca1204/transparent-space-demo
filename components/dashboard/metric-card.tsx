"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { TokenIcon } from "./pool-header";

export const MetricCard = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "ts-kpi relative",
        className
      )}
    >
      {children}
    </div>
  );
};

export const MetricLabel = ({
  children,
  className,
  helpTooltip,
}: {
  children: React.ReactNode;
  className?: string;
  helpTooltip?: string;
}) => {
  return (
    <div className={cn("ts-kpi-label", className)}>
      {helpTooltip ? (
        <span className="ts-term" title={helpTooltip}>{children}</span>
      ) : (
        children
      )}
    </div>
  );
};

/**
 * Renders a KPI value with proper instrument styling:
 * - `$` sign → smaller, ink-3
 * - digits → full size, ink-0
 * - magnitude suffix (K/M/B) → smaller, ink-3
 *
 * Accepts a string like "$2.17M" or "$2,460" and splits automatically.
 */
export const MetricValue = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  // Auto-split string values like "$2.17M"
  if (typeof children === "string") {
    const match = children.match(/^(\$)?([\d,.eE+\-]+)([KMBkmb%]?)$/);
    if (match) {
      const [, dollar, digits, mag] = match;
      return (
        <span className={cn("ts-kpi-value", className)}>
          {dollar && <span className="ts-kpi-dollar">{dollar}</span>}
          {digits}
          {mag && <span className="ts-kpi-mag">{mag}</span>}
        </span>
      );
    }
  }
  return (
    <span className={cn("ts-kpi-value", className)}>
      {children}
    </span>
  );
};

export const MetricUnit = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <span className={cn("ts-kpi-unit", className)}>
      {children}
    </span>
  );
};

/** KPI sub-breakdown row (e.g. CRCLx: $1.16M | USDC: $1.01M) */
export const MetricBreakdown = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("ts-kpi-breakdown", className)}>
      {children}
    </div>
  );
};

export const MetricBreakdownItem = ({
  label,
  value,
  tokenSymbol,
  className,
}: {
  label: string;
  value: string;
  /** Token symbol to show its logo. Falls back to label if not provided. */
  tokenSymbol?: string;
  className?: string;
}) => {
  return (
    <div className={cn("ts-kpi-sub-with-icon", className)}>
      <TokenIcon symbol={tokenSymbol ?? label} className="ts-kpi-token-icon" />
      <div className="ts-kpi-sub-text">
        <span className="ts-kpi-sub-label">{label}</span>
        <span className="ts-kpi-sub-val">{value}</span>
      </div>
    </div>
  );
};

// Skeleton components for loading states
export const MetricCardSkeleton = ({ className }: { className?: string }) => {
  return (
    <div
      className={cn(
        "ts-kpi",
        className
      )}
    >
      <div className="bp-skeleton-metric">
        <div className="bp-skeleton-metric-label" />
        <div className="bp-skeleton-metric-value" />
        <div className="bp-skeleton-metric-unit" />
      </div>
    </div>
  );
};

export const MetricLabelSkeleton = ({ className }: { className?: string }) => {
  return (
    <div className={cn("bp-skeleton-metric-label", className)} />
  );
};

export const MetricValueSkeleton = ({ className }: { className?: string }) => {
  return (
    <div className={cn("bp-skeleton-metric-value", className)} />
  );
};

export const MetricUnitSkeleton = ({ className }: { className?: string }) => {
  return (
    <div className={cn("bp-skeleton-metric-unit", className)} />
  );
};
