"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { metricColors } from "./metric-colors";
import { motion, useReducedMotion } from "framer-motion";

// Types
export interface PriceRangeData {
  currentPrice: number;
  minPrice: number;
  maxPrice: number;
  rangeStart: number; // Active range start price
  rangeEnd: number;   // Active range end price
  tickCount?: number; // Number of tick marks (default: 10)
  labelCount?: number; // Number of price labels (default: 3)
  priceLabel?: string; // Label prefix (e.g., "World Price")
  formatPrice?: (price: number) => string;
  /**
   * Optional prefix for displayed values (e.g. "$" for USD-denominated metrics).
   * IMPORTANT: for price ratios like "wARS per USDC", this should be empty.
   */
  valuePrefix?: string;
  disabled?: boolean;
}

// Utility to calculate position as percentage
const calculatePosition = (
  value: number,
  min: number,
  max: number
): number => {
  return ((value - min) / (max - min)) * 100;
};

const toOddTickCount = (n: number): number => {
  const safe = Number.isFinite(n) ? Math.floor(n) : 0;
  if (safe <= 0) return 1;
  return safe % 2 === 1 ? safe : safe + 1;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// Root component
export const PriceRangeMonitor = ({
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

// Price label at the top
export const PriceRangeLabel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <h3
      className={cn(
        "text-base sm:text-sm font-medium text-gray-700 text-center mb-3",
        className
      )}
    >
      {children}
    </h3>
  );
};

// The visual bar container
export const PriceRangeBar = ({
  children,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) => {
  return (
    <div
      className={cn(
        "relative w-full h-[50px] rounded-md border-2 overflow-hidden",
        className
      )}
      style={{
        backgroundColor: disabled ? metricColors.disabled.surface : metricColors.surface,
        borderColor: disabled ? metricColors.disabled.border : metricColors.border,
      }}
    >
      {children}
    </div>
  );
};

// Active range highlight (the darker middle portion)
export const PriceRangeActive = ({
  startPercent,
  endPercent,
  disabled = false,
  className,
}: {
  startPercent: number;
  endPercent: number;
  disabled?: boolean;
  className?: string;
}) => {
  const width = endPercent - startPercent;
  const reduceMotion = useReducedMotion();
  
  return (
    <motion.div
      className={cn("absolute top-0 bottom-0", className)}
      initial={false}
      animate={{
        left: `${startPercent}%`,
        width: `${width}%`,
      }}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }
      }
      style={{
        backgroundColor: disabled ? metricColors.disabled.fillSoft : metricColors.success.fillSoft,
      }}
    />
  );
};

// Current price indicator (the diamond marker)
export const PriceRangeMarker = ({
  position,
  inRange = true,
  disabled = false,
  className,
}: {
  position: number; // Position as percentage (0-100)
  inRange?: boolean;
  disabled?: boolean;
  className?: string;
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={cn(
        "absolute w-5 h-5 border-2 z-10",
        className
      )}
      initial={false}
      animate={{ left: `${position}%` }}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 28 }
      }
      style={{
        top: "50%",
        transform: "translateX(-50%) translateY(-50%) rotate(45deg)",
        backgroundColor: "transparent",
        borderColor: disabled ? metricColors.disabled.border : "rgba(0, 0, 0, 0.92)",
      }}
    >
      {/* Inner fill to create padding between fill and border */}
      <div
        className="absolute inset-[2px]"
        style={{
          backgroundColor: disabled
            ? metricColors.disabled.fill
            : inRange
              ? "#6DC965"
              : "#F29797",
        }}
      />
    </motion.div>
  );
};

// Tick marks container
export const PriceRangeTicks = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("relative w-full h-6 mt-2", className)}>
      {children}
    </div>
  );
};

// Individual tick mark
export const PriceRangeTick = ({
  position,
  variant = "default",
  disabled = false,
  className,
}: {
  position: number; // Position as percentage (0-100)
  variant?: "default" | "center" | "current";
  disabled?: boolean;
  className?: string;
}) => {
  const color =
    disabled
      ? metricColors.disabled.fill
      : variant === "current"
        ? metricColors.neutral.text
        : variant === "center"
          ? metricColors.neutral.muted
          : metricColors.neutral.tick;

  const height = variant === "current" ? 10 : variant === "center" ? 8 : 6;

  return (
    <div
      className={cn("absolute top-0 rounded-full", className)}
      style={{
        left: `${position}%`,
        transform: "translateX(-50%)",
        width: 2,
        height,
        backgroundColor: color,
      }}
    />
  );
};

export const PriceRangeStatus = ({
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

// Success indicator
export const SuccessIndicator = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <img 
      src="/icons/success-icon.svg" 
      alt="Success" 
      className={cn("w-8 h-8", className)}
    />
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
      className={cn("w-8 h-8", className)}
    />
  );
};

// Price labels container
export const PriceRangeLabels = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("relative w-full h-5 mt-1", className)}>
      {children}
    </div>
  );
};

// Individual price label
export const PriceRangePriceLabel = ({
  children,
  position,
  isActive = false,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  position: number; // Position as percentage (0-100)
  isActive?: boolean;
  disabled?: boolean;
  className?: string;
}) => {
  const align =
    position <= 0 ? "left" : position >= 100 ? "right" : "center";

  const translateX =
    align === "left" ? "0%" : align === "right" ? "-100%" : "-50%";

  return (
    <span
      className={cn(
        "absolute text-gray-500 leading-none max-w-[44%] overflow-hidden text-ellipsis whitespace-nowrap",
        isActive ? "text-xs font-semibold text-gray-700" : "text-[11px]",
        className
      )}
      style={{
        left: `${position}%`,
        transform: `translateX(${translateX})`,
        color: disabled ? metricColors.disabled.text : undefined,
      }}
    >
      {children}
    </span>
  );
};

// Convenience component that renders the full chart from data
export const PriceRangeChart = ({
  data,
  className,
}: {
  data: PriceRangeData;
  className?: string;
}) => {
  const reduceMotion = useReducedMotion();
  const {
    currentPrice,
    minPrice,
    maxPrice,
    rangeStart,
    rangeEnd,
    tickCount = 10,
    labelCount = 3,
    priceLabel = "Price",
    formatPrice = (p) => p.toFixed(2),
    valuePrefix = "",
    disabled = false,
  } = data;

  // Calculate positions
  const markerPosition = calculatePosition(currentPrice, minPrice, maxPrice);
  const rangeStartPercent = calculatePosition(rangeStart, minPrice, maxPrice);
  const rangeEndPercent = calculatePosition(rangeEnd, minPrice, maxPrice);
  const rangeLow = Math.min(rangeStart, rangeEnd);
  const rangeHigh = Math.max(rangeStart, rangeEnd);
  const inRange = currentPrice >= rangeLow && currentPrice <= rangeHigh;

  // Generate tick marks
  const oddTickCount = toOddTickCount(tickCount);
  const ticks = Array.from({ length: oddTickCount }, (_, i) => ({
    index: i,
    position: oddTickCount === 1 ? 50 : (i / (oddTickCount - 1)) * 100,
  }));
  const centerTickIndex = Math.floor(oddTickCount / 2);

  // Generate price labels at start, middle, and end (or custom count)
  const formattedCurrentPrice = formatPrice(currentPrice);
  const labels = Array.from({ length: labelCount }, (_, i) => {
    const percent = labelCount === 1 ? 50 : (i / (labelCount - 1)) * 100;
    const price = minPrice + ((maxPrice - minPrice) * percent) / 100;
    const value = formatPrice(price);
    return {
      position: percent,
      value,
      isActive: value === formattedCurrentPrice,
    };
  });

  const [hover, setHover] = React.useState<{
    xPx: number;
    percent: number;
  } | null>(null);

  const handleBarMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = rect.width > 0 ? (x / rect.width) * 100 : 0;
    setHover({ xPx: x, percent: clamp(percent, 0, 100) });
  };

  const handleBarLeave: React.MouseEventHandler<HTMLDivElement> = () => {
    setHover(null);
  };

  const hoveredPrice =
    hover == null
      ? null
      : minPrice + ((maxPrice - minPrice) * hover.percent) / 100;

  return (
    <PriceRangeMonitor className={className}>
      {/* Status indicator */}
      <div className="flex justify-end mb-2">
        {!disabled ? (inRange ? <SuccessIndicator /> : <FailureIndicator />) : null}
      </div>

      {/* Chart content area */}
      <div className="flex-1 flex flex-col justify-center w-full">
        <PriceRangeLabel>
          {priceLabel}: {valuePrefix}
          {formatPrice(currentPrice)}
        </PriceRangeLabel>

        <div
          className="relative"
          onMouseMove={handleBarMove}
          onMouseEnter={handleBarMove}
          onMouseLeave={handleBarLeave}
        >
          <PriceRangeBar disabled={disabled}>
            <PriceRangeActive
              startPercent={rangeStartPercent}
              endPercent={rangeEndPercent}
              disabled={disabled}
            />
            <PriceRangeMarker position={markerPosition} disabled={disabled} inRange={inRange} />

            {/* Hover guide line */}
            {hover && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  left: `${hover.percent}%`,
                  transform: "translateX(-50%)",
                  width: 1,
                  backgroundColor: metricColors.neutral.tick,
                  opacity: 0.9,
                }}
              />
            )}
          </PriceRangeBar>

          {/* Tooltip */}
          {hover && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.16 }}
              className="absolute -top-2 z-20 pointer-events-none"
              style={{
                left: `${hover.percent}%`,
                transform:
                  hover.percent <= 8
                    ? "translateX(0%) translateY(-100%)"
                    : hover.percent >= 92
                      ? "translateX(-100%) translateY(-100%)"
                      : "translateX(-50%) translateY(-100%)",
              }}
            >
              <div
                className="rounded-md border px-2 py-1 shadow-sm"
                style={{
                  backgroundColor: "#ffffff",
                  borderColor: disabled ? metricColors.disabled.border : metricColors.border,
                  color: disabled ? metricColors.disabled.strongText : metricColors.neutral.text,
                  fontSize: 11,
                  lineHeight: "14px",
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ color: metricColors.neutral.muted }}>
                  Range: {valuePrefix}
                  {formatPrice(rangeStart)} – {valuePrefix}
                  {formatPrice(rangeEnd)}
                </div>
                <div>
                  Current: {valuePrefix}
                  {formatPrice(currentPrice)}
                </div>
                {hoveredPrice != null && (
                  <div style={{ color: metricColors.neutral.muted }}>
                    Hover: {valuePrefix}
                    {formatPrice(hoveredPrice)}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>

        <PriceRangeTicks>
          {ticks.map((tick) => (
            <PriceRangeTick
              key={tick.index}
              position={tick.position}
              variant={tick.index === centerTickIndex ? "center" : "default"}
              disabled={disabled}
            />
          ))}
          {/* Current price tick indicator (always aligned with marker) */}
          <PriceRangeTick position={markerPosition} variant="current" disabled={disabled} />
        </PriceRangeTicks>

        <PriceRangeLabels>
          {labels.map((label, index) => (
            <PriceRangePriceLabel
              key={index}
              position={label.position}
              isActive={label.isActive}
              disabled={disabled}
            >
              {valuePrefix}{label.value}
            </PriceRangePriceLabel>
          ))}
        </PriceRangeLabels>
      </div>

      {/* Price Range Status */}
      <PriceRangeStatus>
        Status: OK
      </PriceRangeStatus>
    </PriceRangeMonitor>
  );
};

