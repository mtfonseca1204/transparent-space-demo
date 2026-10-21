"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { HelpButton, type HelpSectionData } from "@/components/ui/help-button";

export const ChartCard = ({
  children,
  className,
  id,
  bracketed = true,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** Show registration brackets. Default true for primary panels. */
  bracketed?: boolean;
}) => {
  return (
    <div
      id={id}
      className={cn(
        "ts-panel",
        bracketed && "ts-panel-bracketed",
        className
      )}
    >
      {children}
    </div>
  );
};

export const ChartHeader = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("ts-panel-head", className)}>
      {children}
    </div>
  );
};

export const ChartTitle = ({
  children,
  className,
  helpContent,
  meta,
}: {
  children: React.ReactNode;
  className?: string;
  helpContent?: { title: string; sections: HelpSectionData[] };
  /** Right-side metadata text */
  meta?: string;
}) => {
  return (
    <div className={cn("ts-panel-head-left", className)}>
      <h3 className="ts-panel-title">
        {helpContent ? (
          <HelpButton
            title={helpContent.title}
            sections={helpContent.sections}
          >
            {children}
          </HelpButton>
        ) : (
          children
        )}
      </h3>
      {meta && <span className="ts-panel-meta">{meta}</span>}
    </div>
  );
};

export const ChartContent = ({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) => {
  return (
    <div className={cn("ts-panel-body", className)} style={style}>
      <div className="flex-1 min-h-0 relative h-full">
        {children}
      </div>
    </div>
  );
};

/** Panel footer with legend items and a key stat */
export const ChartFoot = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("ts-panel-foot", className)}>
      {children}
    </div>
  );
};

export const ChartWatermark = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "absolute bottom-4 right-4 flex items-center gap-2 text-[var(--ts-ink-3)] opacity-50",
        className
      )}
    >
      {children}
    </div>
  );
};

// Placeholder chart components with blueprint styling
export const BarChartPlaceholder = ({ className }: { className?: string }) => {
  const bars = [45, 65, 55, 75, 60, 80, 70, 85, 65, 75, 55, 70];

  return (
    <div className={cn("flex items-end justify-between h-full gap-1 pt-8 relative z-10", className)}>
      {bars.map((height, index) => (
        <div
          key={index}
          className="flex-1 transition-all duration-300 hover:opacity-100"
          style={{
            height: `${height}%`,
            background: `var(--ts-ink-3)`,
            opacity: 0.4
          }}
        />
      ))}
    </div>
  );
};

export const AreaChartPlaceholder = ({ className }: { className?: string }) => {
  return (
    <div className={cn("h-full w-full relative z-10", className)}>
      <svg viewBox="0 0 200 100" className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bpAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--ts-ink-3)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--ts-ink-3)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path
          d="M0,80 Q20,70 40,75 T80,60 T120,50 T160,30 T200,20 L200,100 L0,100 Z"
          fill="url(#bpAreaGradient)"
        />
        <path
          d="M0,80 Q20,70 40,75 T80,60 T120,50 T160,30 T200,20"
          fill="none"
          stroke="var(--ts-ink-2)"
          strokeWidth="2"
          opacity="0.6"
        />
      </svg>
    </div>
  );
};

export const LineChartPlaceholder = ({ className }: { className?: string }) => {
  return (
    <div className={cn("h-full w-full relative z-10", className)}>
      <svg viewBox="0 0 400 120" className="w-full h-full" preserveAspectRatio="none">
        <line x1="0" y1="30" x2="400" y2="30" stroke="var(--ts-line-soft)" strokeWidth="1" />
        <line x1="0" y1="60" x2="400" y2="60" stroke="var(--ts-line-soft)" strokeWidth="1" />
        <line x1="0" y1="90" x2="400" y2="90" stroke="var(--ts-line-soft)" strokeWidth="1" />
        <path
          d="M0,60 L20,55 L40,58 L60,52 L80,55 L100,48 L120,52 L140,45 L160,50 L180,42 L200,48 L220,40 L240,45 L260,38 L280,42 L300,35 L320,40 L340,32 L360,38 L380,30 L400,35"
          fill="none"
          stroke="var(--ts-ink-2)"
          strokeWidth="2"
          opacity="0.6"
        />
        {[0, 60, 120, 180, 240, 300, 360].map((x, i) => (
          <circle
            key={i}
            cx={x}
            cy={60 - i * 4}
            r="3"
            fill="var(--ts-ink-2)"
            opacity="0.6"
          />
        ))}
      </svg>
    </div>
  );
};

export const DuneWatermark = () => {
  return (
    <div className="flex items-center gap-1.5 text-[var(--ts-ink-3)] opacity-40">
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
      </svg>
      <span className="font-medium text-xs tracking-wider">DUNE</span>
    </div>
  );
};

// Skeleton components for loading states
export const ChartCardSkeleton = ({ className, variant = "bars" }: { className?: string; variant?: "bars" | "line" | "generic" }) => {
  return (
    <div className={cn("ts-panel", className)}>
      <div className="ts-panel-head">
        <div className="h-4 w-32 bp-skeleton-pulse rounded" />
      </div>
      <div className="ts-panel-body">
        {variant === "bars" && <ChartBarsSkeleton />}
        {variant === "line" && <ChartLineSkeleton />}
        {variant === "generic" && <div className="h-full w-full bp-skeleton rounded" />}
      </div>
    </div>
  );
};

export const ChartContentSkeleton = ({ className, variant = "bars" }: { className?: string; variant?: "bars" | "line" | "generic" }) => {
  if (variant === "bars") {
    return <ChartBarsSkeleton className={className} />;
  }
  if (variant === "line") {
    return <ChartLineSkeleton className={className} />;
  }
  return (
    <div className={cn("ts-panel-body bp-skeleton rounded", className)} />
  );
};

// Bar chart skeleton
export const ChartBarsSkeleton = ({ className }: { className?: string }) => {
  return (
    <div className={cn("bp-skeleton-bars", className)}>
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
      <div className="bp-skeleton-bar" />
    </div>
  );
};

// Line chart skeleton
export const ChartLineSkeleton = ({ className }: { className?: string }) => {
  return <div className={cn("bp-skeleton-line", className)} />;
};

// Loading indicator with spinner and text
export const ChartLoadingIndicator = ({ className, text = "Loading..." }: { className?: string; text?: string }) => {
  return (
    <div className={cn("flex items-center justify-center h-full", className)}>
      <div className="bp-loading-text">
        <div className="bp-spinner" />
        <span>{text}</span>
      </div>
    </div>
  );
};

export const ChartUnavailableState = ({
  title = "Unavailable",
  message,
  className,
}: {
  title?: string;
  message: string;
  className?: string;
}) => {
  return (
    <div className={cn("flex h-full items-center justify-center p-6", className)}>
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-[var(--ts-ink-0)]">{title}</p>
        <p className="mt-2 text-xs leading-5 text-[var(--ts-ink-2)]">{message}</p>
      </div>
    </div>
  );
};
