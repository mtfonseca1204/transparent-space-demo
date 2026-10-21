"use client";

import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { BAR_COLOR_PALETTES } from "@/components/custom-metrics/metric-colors";
import { getLpMeta } from "@/lib/lp-labels";

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

export const LPConcentration = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("bp-card", className)}>
      <div className="bp-card-inner" />
      {children}
    </div>
  );
};

export const LPConcentrationTitle = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <h3 className={cn("bp-chart-title mb-4", className)}>
      {children}
    </h3>
  );
};

// Use centralized premium color palette
const BAR_COLORS = BAR_COLOR_PALETTES;

interface PositionData {
  tokenId: string;
  usdValue: number;
}

interface LPData {
  address: string;
  percentage: number;
  label: string;
  positions?: PositionData[];
  totalUsd?: number;
}

export const LPConcentrationBars = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("", className)}>
      {children}
    </div>
  );
};

// Simple treemap layout algorithm
function computeTreemapLayout(
  items: { id: string; value: number }[],
  width: number,
  height: number
): Array<{ id: string; x: number; y: number; w: number; h: number; value: number }> {
  if (items.length === 0 || width <= 0 || height <= 0) return [];
  
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];

  const sorted = [...items].sort((a, b) => b.value - a.value);
  
  const result: Array<{ id: string; x: number; y: number; w: number; h: number; value: number }> = [];
  let currentX = 0;
  let currentY = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let remainingTotal = total;
  let isHorizontal = width >= height;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const ratio = item.value / remainingTotal;
    
    let w: number, h: number;
    if (isHorizontal) {
      w = remainingWidth * ratio;
      h = remainingHeight;
      result.push({ id: item.id, x: currentX, y: currentY, w, h, value: item.value });
      currentX += w;
      remainingWidth -= w;
    } else {
      w = remainingWidth;
      h = remainingHeight * ratio;
      result.push({ id: item.id, x: currentX, y: currentY, w, h, value: item.value });
      currentY += h;
      remainingHeight -= h;
    }
    
    remainingTotal -= item.value;
    
    if (i < sorted.length - 1 && (i + 1) % 2 === 0) {
      isHorizontal = !isHorizontal;
    }
  }

  return result;
}

function formatUsdShort(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value.toFixed(0)}`;
}

function formatValueShort(value: number, unit?: string): string {
  const u = unit?.trim();
  return u ? `${formatUsdShort(value)} ${u}` : formatUsdShort(value);
}

const TreemapSegment = ({
  positions,
  colorPalette,
  valueUnit,
  showLabels = false,
}: {
  positions: PositionData[];
  colorPalette: { bg: string; light: string; lighter: string };
  totalUsd?: number;
  isSelected?: boolean;
  valueUnit?: string;
  percentage?: number;
  label?: string;
  showLabels?: boolean;
}) => {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Use useLayoutEffect for synchronous dimension reading
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }
  }, [showLabels]); // Re-run when showLabels changes (expanded/collapsed)

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return [];
    return computeTreemapLayout(
      positions.map((p) => ({ id: p.tokenId, value: p.usdValue })),
      dimensions.width,
      dimensions.height
    );
  }, [positions, dimensions]);

  const colors = [colorPalette.bg, colorPalette.light, colorPalette.lighter];

  // Fallback for expanded view when layout hasn't computed yet
  if (showLabels && layout.length === 0 && positions.length > 0) {
    const sortedPositions = [...positions].sort((a, b) => b.usdValue - a.usdValue);
    const total = sortedPositions.reduce((s, p) => s + p.usdValue, 0);
    return (
      <div ref={containerRef} className="w-full h-full flex">
        {sortedPositions.map((pos, i) => {
          const color = colors[i % colors.length];
          const isLight = i % 3 >= 1;
          const pct = total > 0 ? (pos.usdValue / total) * 100 : 100 / sortedPositions.length;
          return (
            <div
              key={pos.tokenId}
              className="h-full flex flex-col items-center justify-center"
              style={{ 
                width: `${pct}%`,
                minWidth: '50px',
                backgroundColor: color 
              }}
            >
              <span className={cn(
                "text-[11px] font-mono font-semibold truncate max-w-full px-2",
                isLight ? "text-[var(--bp-text-primary)]" : "text-white"
              )}>
                #{pos.tokenId.length > 6 ? `${pos.tokenId.slice(0, 5)}..` : pos.tokenId}
              </span>
              <span className={cn(
                "text-[10px] font-mono truncate max-w-full px-2 opacity-80",
                isLight ? "text-[var(--bp-text-primary)]" : "text-white"
              )}>
                {formatValueShort(pos.usdValue, valueUnit)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {layout.map((rect, i) => {
        const color = colors[i % colors.length];
        const isLight = i % 3 >= 1;
        return (
          <div
            key={rect.id}
            className="absolute overflow-hidden border-r border-b border-white/10 flex flex-col items-center justify-center"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              backgroundColor: color,
            }}
            title={`#${rect.id}: ${formatValueShort(rect.value, valueUnit)}`}
          >
            {/* Only show labels in expanded view (showLabels=true) */}
            {showLabels && (
              <>
                <span className={cn(
                  "text-[11px] font-mono font-semibold truncate max-w-full px-1",
                  isLight ? "text-[var(--bp-text-primary)]" : "text-white"
                )}>
                  #{rect.id.length > 6 ? `${rect.id.slice(0, 5)}..` : rect.id}
                </span>
                <span className={cn(
                  "text-[10px] font-mono truncate max-w-full px-1 opacity-80",
                  isLight ? "text-[var(--bp-text-primary)]" : "text-white"
                )}>
                  {formatValueShort(rect.value, valueUnit)}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const LPConcentrationChart = ({
  data,
  valueUnit,
  selectedAddress,
  onSelect,
  spaceSlug,
  className,
}: {
  data: LPData[];
  valueUnit?: string;
  selectedAddress?: string | null;
  onSelect?: (address: string) => void;
  spaceSlug?: string | null;
  className?: string;
}) => {
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const [expandedLP, setExpandedLP] = useState<string | null>(null);

  const top4 = data.slice(0, 4);
  const othersData = data.slice(4);
  const othersPercentage = othersData.reduce((sum, lp) => sum + lp.percentage, 0);
  const remaining = 100 - top4.reduce((sum, lp) => sum + lp.percentage, 0) - othersPercentage;

  const segments = [
    ...top4.map((lp, i) => ({
      ...lp,
      colorPalette: BAR_COLORS[i],
      textColor: "text-white",
      isOthers: false,
    })),
    ...(othersPercentage > 0 || remaining > 0
      ? [
          {
            address: "others",
            percentage: othersPercentage + remaining,
            label: "Others",
            positions: [] as PositionData[],
            totalUsd: 0,
            colorPalette: BAR_COLORS[4],
            textColor: "text-[var(--bp-text-secondary)]",
            isOthers: true,
          },
        ]
      : []),
  ];

  const expandedSegment = expandedLP 
    ? segments.find(s => s.address.toLowerCase() === expandedLP.toLowerCase())
    : null;

  const totalPct = segments.reduce((sum, s) => {
    const v = Number.isFinite(s.percentage) ? s.percentage : 0;
    return sum + v;
  }, 0);

  const handleSegmentClick = (segment: typeof segments[0]) => {
    if (segment.isOthers) return;
    
    if (expandedLP?.toLowerCase() === segment.address.toLowerCase()) {
      setExpandedLP(null);
    } else {
      setExpandedLP(segment.address);
      onSelect?.(segment.address);
    }
  };

  // Expanded view
  if (expandedSegment && expandedSegment.positions && expandedSegment.positions.length > 0) {
    return (
      <div className={cn("h-full w-full flex flex-col min-h-[200px]", className)}>
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <button
            onClick={() => setExpandedLP(null)}
            className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[var(--bp-text-muted)] hover:text-[var(--bp-accent-primary)] transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <span className="text-[var(--bp-border-secondary)]">|</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-medium text-[var(--bp-text-secondary)]">
            {(() => {
              const meta = getLpMeta(expandedSegment.address, spaceSlug);
              return meta?.logoSrc ? (
                <img
                  src={meta.logoSrc}
                  alt={`${meta.label} logo`}
                  className="w-3 h-3 rounded-sm"
                  loading="lazy"
                />
              ) : null;
            })()}
            {expandedSegment.label}
          </span>
          <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">({expandedSegment.percentage.toFixed(1)}%)</span>
          {(expandedSegment.totalUsd ?? 0) > 0 && (
            <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">{formatValueShort(expandedSegment.totalUsd ?? 0, valueUnit)}</span>
          )}
          <span className="text-[var(--bp-border-secondary)]">|</span>
          <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">{expandedSegment.positions?.length ?? 0} position{(expandedSegment.positions?.length ?? 0) !== 1 ? 's' : ''}</span>
        </div>
        
        <div 
          className="w-full flex-1 min-h-[160px] overflow-hidden cursor-pointer border border-[var(--bp-border-subtle)]"
          style={{ backgroundColor: expandedSegment.colorPalette.bg }}
          onClick={() => setExpandedLP(null)}
        >
          <TreemapSegment
            positions={expandedSegment.positions}
            colorPalette={expandedSegment.colorPalette}
            totalUsd={expandedSegment.totalUsd || 0}
            isSelected={true}
            valueUnit={valueUnit}
            percentage={expandedSegment.percentage}
            label={expandedSegment.label}
            showLabels={true}
          />
        </div>
      </div>
    );
  }

  // Default view
  return (
    <div className={cn("h-full w-full", className)}>
      <div
        className="w-full h-full grid overflow-hidden border border-[var(--bp-border-subtle)] min-h-[200px]"
        style={{
          gridTemplateColumns: segments
            .map((segment) => {
              const safePct = Number.isFinite(segment.percentage) ? segment.percentage : 0;
              const effectivePct = totalPct > 0 ? safePct : 100 / Math.max(segments.length, 1);
              return `${Math.max(effectivePct, 1)}fr`;
            })
            .join(" "),
        }}
      >
        {segments.map((segment) => {
          const hasPositions = segment.positions && segment.positions.length > 0;
          const isSelected = selectedAddress?.toLowerCase() === segment.address.toLowerCase();
          const isHovered = hoveredSegment === segment.address;

          const safePct = Number.isFinite(segment.percentage) ? segment.percentage : 0;
          const effectivePct = totalPct > 0 ? safePct : 100 / Math.max(segments.length, 1);
          const showLabel = effectivePct >= 10;
          const showValue = effectivePct >= 14;

          return (
            <div
              key={segment.address}
              className={cn(
                "h-full relative transition-all cursor-pointer overflow-hidden",
                isSelected && "ring-2 ring-inset ring-[var(--bp-accent-primary)]",
                !segment.isOthers && "hover:brightness-75"
              )}
              style={{
                backgroundColor: segment.colorPalette?.bg ?? "#64748b",
                minWidth: "60px",
              }}
              onClick={() => handleSegmentClick(segment)}
              onMouseEnter={() => setHoveredSegment(segment.address)}
              onMouseLeave={() => setHoveredSegment(null)}
              title={segment.isOthers ? "Others" : `${segment.label} - Click to see ${segment.positions?.length ?? 0} position(s)`}
            >
              {/* Background treemap (if positions exist) */}
              {hasPositions && (
                <TreemapSegment
                  positions={segment.positions!}
                  colorPalette={segment.colorPalette}
                  totalUsd={segment.totalUsd || 0}
                  isSelected={isSelected}
                  valueUnit={valueUnit}
                  percentage={segment.percentage}
                  label={segment.label}
                />
              )}

              {/* Show NFT ID, USD, and percentage on hover */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
                {segment.isOthers ? (
                  // Others segment
                  <>
                    {isHovered && (
                      <span className="text-white text-sm font-mono font-bold drop-shadow-md">
                        {segment.percentage.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-white/90 text-[11px] font-mono font-semibold drop-shadow-md">
                      Others
                    </span>
                  </>
                ) : (
                  // Regular segments: show wallet label, USD value, and percentage on hover
                  <>
                    {isHovered && (
                      <span className="text-white text-sm font-mono font-bold drop-shadow-md">
                        {segment.percentage.toFixed(1)}%
                      </span>
                    )}
                    {/* Show wallet label (address) as primary identifier */}
                    <span className="text-white text-[10px] font-mono font-semibold truncate max-w-full px-1 drop-shadow-md">
                      {segment.label}
                    </span>
                    {/* Show position count if multiple NFTs */}
                    {hasPositions && segment.positions!.length > 1 && (
                      <span className="text-white/70 text-[8px] font-mono drop-shadow-md">
                        {segment.positions!.length} positions
                      </span>
                    )}
                    {segment.totalUsd != null && segment.totalUsd > 0 && (
                      <span className="text-white/90 text-[9px] font-mono drop-shadow-md">
                        {formatValueShort(segment.totalUsd, valueUnit)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const LPConcentrationBar = ({
  percentage,
  label,
  fullLabel,
  onSelect,
  selected = false,
  colorIndex = 0,
  className,
}: {
  percentage: number;
  label: string;
  fullLabel?: string;
  onSelect?: () => void;
  selected?: boolean;
  variant?: "dark" | "light" | "outline";
  colorIndex?: number;
  className?: string;
}) => {
  return null;
};
