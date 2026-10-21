"use client";

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear, scaleTime } from "@visx/scale";
import { LinePath, Bar } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { AxisBottom } from "@visx/axis";
import { GridRows } from "@visx/grid";
import type { LPEventData } from "@/lib/envio-client";
import { tickToPrice } from "@/lib/envio-client";
import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";
import { calculateLPEventUsdValue } from "@/lib/lp-event-value";
import { getAddressExplorerUrl } from "@/lib/space-policy";

// Backwards compatible input type:
// - Old: { date, newLPs, exits }
// - New (indexer buckets): { bucketStart, activeAddressesEnd, addressEntries, addressExits }
export type LPEntryExitDataPoint = {
  date?: number;
  newLPs?: number;
  exits?: number;
  bucketStart?: number;
  activeAddressesEnd?: number;
  addressEntries?: number;
  addressExits?: number;
};

type NormalizedPoint = {
  t: number; // unix seconds bucket start
  entries: number;
  exits: number;
  active: number | null;
};

// Processed individual LP event with USD value
interface ProcessedLPEvent {
  id: string;
  tokenId?: string; // NFT token ID (may be null for v4 pools)
  owner: string;
  eventType: "MINT" | "BURN" | "INCREASE" | "DECREASE";
  timestamp: number;
  usdValue: number;
  tickLower: number;
  tickUpper: number;
  priceLower: number;
  priceUpper: number;
  isConcentrated: boolean; // true if range is narrow (< 10% of current price)
}

const formatShortDate = (unixSeconds: number) => {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatDateTime = (unixSeconds: number) => {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString("en-US", { 
    month: "short", 
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatUsdCompact = (value: number): string => {
  if (!Number.isFinite(value)) return "$0";
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (absValue >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

const DEFAULT_MARGIN = { top: 14, right: 44, bottom: 22, left: 18 };

// Premium chart colors - no green/red, uses teals, blues, purples, golds
const COLORS = {
  entries: "#5B9A8B", // Teal - add liquidity
  exits: "#C49052",   // Warm bronze - remove liquidity
  activeLine: "#6A9BD1", // Sky blue
  grid: "#e5e7eb",    // gray-200
  axis: "#d1d5db",    // gray-300
  text: "#6b7280",    // gray-500
  mint: "#5B9A8B",    // Teal - add liquidity
  burn: "#C49052",    // Warm bronze - remove liquidity
  concentrated: "#8B7BA1", // Dusty purple - highlight for concentrated liquidity
};

const normalize = (data: LPEntryExitDataPoint[]): NormalizedPoint[] => {
  return data
    .map((p) => {
      const t = (p.bucketStart ?? p.date ?? 0) | 0;
      const entries = (p.addressEntries ?? p.newLPs ?? 0) || 0;
      const exits = (p.addressExits ?? p.exits ?? 0) || 0;
      const activeRaw = p.activeAddressesEnd;
      const active = typeof activeRaw === "number" && Number.isFinite(activeRaw) ? activeRaw : null;
      return { t, entries, exits, active };
    })
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t);
};

const ChartSvg = ({
  points,
  width,
  height,
}: {
  points: NormalizedPoint[];
  width: number;
  height: number;
}) => {
  const [hoveredT, setHoveredT] = React.useState<number | null>(null);
  const margin = DEFAULT_MARGIN;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  if (points.length === 0 || innerW <= 0 || innerH <= 0) return null;

  const maxFlow = Math.max(1, ...points.flatMap((p) => [p.entries, p.exits]));
  const maxActive = Math.max(0, ...points.map((p) => p.active ?? 0));
  const hasActive = points.some((p) => p.active != null);

  const xScale = scaleBand<number>({
    domain: points.map((p) => p.t),
    range: [0, innerW],
    padding: 0.25,
  });

  // Centered around 0 for inflow/outflow bars.
  const yFlow = scaleLinear<number>({
    domain: [-maxFlow, maxFlow],
    range: [innerH, 0],
    nice: true,
  });

  // Separate right axis for active line.
  const yActive = scaleLinear<number>({
    domain: [0, Math.max(1, maxActive)],
    range: [innerH, 0],
    nice: true,
  });

  const barW = xScale.bandwidth();
  const zeroY = yFlow(0);

  // Grid lines (flow axis)
  const gridYs = [0, 0.5, 1].map((k) => yFlow(maxFlow * (1 - 2 * k))); // max, 0, -max

  const hovered = hoveredT == null ? null : points.find((p) => p.t === hoveredT) ?? null;
  const hoveredX = hovered ? (xScale(hovered.t) ?? 0) + barW / 2 : null;

  return (
    <svg width={width} height={height} role="img" aria-label="LP entries/exits and active addresses">
      <rect width={width} height={height} fill="#ffffff" />
      <Group left={margin.left} top={margin.top}>
        {/* Horizontal grid + zero line */}
        {gridYs.map((y, i) => (
          <line
            key={`grid-${i}`}
            x1={0}
            x2={innerW}
            y1={y}
            y2={y}
            stroke={COLORS.grid}
            strokeWidth={1}
            opacity={i === 1 ? 0.9 : 0.6}
          />
        ))}

        {/* Bars */}
        {points.map((p) => {
          const x0 = xScale(p.t) ?? 0;
          const entriesH = Math.max(0, zeroY - yFlow(p.entries));
          const exitsH = Math.max(0, yFlow(-p.exits) - zeroY);

          return (
            <g key={p.t} transform={`translate(${x0},0)`}>
              {/* entries (up) - full width */}
              <rect
                x={0}
                y={zeroY - entriesH}
                width={barW}
                height={entriesH}
                rx={0}
                fill={COLORS.entries}
                opacity={0.75}
              />
              {/* exits (down) - full width */}
              <rect
                x={0}
                y={zeroY}
                width={barW}
                height={exitsH}
                rx={0}
                fill={COLORS.exits}
                opacity={0.75}
              />
            </g>
          );
        })}

        {/* Active addresses line (on top) */}
        {hasActive && (
          <LinePath
            data={points.filter((p) => p.active != null)}
            x={(d) => (xScale(d.t) ?? 0) + (xScale.bandwidth() / 2)}
            y={(d) => yActive(d.active ?? 0)}
            stroke={COLORS.activeLine}
            strokeWidth={2}
            curve={curveMonotoneX}
          />
        )}

        {/* Hover crosshair */}
        {hoveredX != null && (
          <line
            x1={hoveredX}
            x2={hoveredX}
            y1={0}
            y2={innerH}
            stroke={COLORS.axis}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction overlay */}
        <rect
          x={0}
          y={0}
          width={innerW}
          height={innerH}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            // Find nearest bucket by band center distance
            let best = points[0]!;
            let bestDist = Infinity;
            for (const p of points) {
              const cx = (xScale(p.t) ?? 0) + barW / 2;
              const d = Math.abs(cx - x);
              if (d < bestDist) {
                bestDist = d;
                best = p;
              }
            }
            setHoveredT(best.t);
          }}
          onMouseLeave={() => setHoveredT(null)}
        />

        {/* Minimal x labels (first/middle/last) */}
        {(() => {
          const first = points[0]?.t;
          const last = points[points.length - 1]?.t;
          const mid = points[Math.floor(points.length / 2)]?.t;
          const ticks = [first, mid, last].filter((v, idx, arr) => v != null && arr.indexOf(v) === idx) as number[];
          return ticks.map((t) => {
            const x = (xScale(t) ?? 0) + xScale.bandwidth() / 2;
            return (
              <text
                key={`x-${t}`}
                x={x}
                y={innerH + 16}
                textAnchor="middle"
                fontSize={10}
                fill={COLORS.text}
              >
                {formatShortDate(t)}
              </text>
            );
          });
        })()}

        {/* Right axis labels for active addresses (top/mid/bottom) */}
        {hasActive && (
          <g transform={`translate(${innerW + 8}, 0)`}>
            {[1, 0.5, 0].map((k) => {
              const v = Math.round(maxActive * k);
              const y = yActive(v);
              return (
                <text key={`ya-${k}`} x={0} y={clamp(y, 0, innerH) + 3} fontSize={10} fill={COLORS.text}>
                  {v.toLocaleString()}
                </text>
              );
            })}
          </g>
        )}
      </Group>

      {/* Tooltip */}
      {hovered && hoveredX != null && (
        <foreignObject
          x={margin.left + clamp(hoveredX - 90, 0, innerW - 180)}
          y={margin.top + 6}
          width={180}
          height={70}
          pointerEvents="none"
        >
          <div
            style={{
              background: "rgba(255,255,255,0.95)",
              border: `1px solid ${COLORS.grid}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 11,
              color: "#111827",
              boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ color: COLORS.text, marginBottom: 4 }}>{formatShortDate(hovered.t)}</div>
            {hovered.active != null && (
              <div>
                <span style={{ color: COLORS.activeLine, fontWeight: 600 }}>Active</span>:{" "}
                {Math.round(hovered.active).toLocaleString()}
              </div>
            )}
            <div>
              <span style={{ color: COLORS.entries, fontWeight: 600 }}>Entries</span>:{" "}
              {hovered.entries.toLocaleString()}
            </div>
            <div>
              <span style={{ color: COLORS.exits, fontWeight: 600 }}>Exits</span>:{" "}
              {hovered.exits.toLocaleString()}
            </div>
          </div>
        </foreignObject>
      )}
    </svg>
  );
};

// Premium color palette for LP addresses - no green or red
// Uses blues, purples, teals, and warm golds only
const LP_COLORS = [
  "#6A9BD1", // Sky blue
  "#8B7BA1", // Dusty purple
  "#5B9A8B", // Teal
  "#C49052", // Warm bronze/gold
  "#7AA3CC", // Steel blue
  "#9B8AA8", // Lavender purple
  "#6B9B9B", // Sage teal
  "#D4A55A", // Golden honey
  "#5C85B3", // Ocean blue
  "#A08BB5", // Soft violet
  "#4D8B8B", // Deep teal
  "#B8956E", // Caramel
  "#7B9FD4", // Periwinkle
  "#8A7D99", // Muted plum
  "#6BA39A", // Seafoam
  "#CDA05F", // Amber
];

const addressToColor = (address: string): string => {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  return LP_COLORS[Math.abs(hash) % LP_COLORS.length];
};

// Get hour bucket for timestamp
const getHourBucket = (timestamp: number): number => {
  return Math.floor(timestamp / 3600) * 3600;
};

// Get day bucket for timestamp
const getDayBucket = (timestamp: number): number => {
  return Math.floor(timestamp / 86400) * 86400;
};

// Stacked bar bucket data
interface StackedBucket {
  timestamp: number;
  mints: { owner: string; usdValue: number; events: ProcessedLPEvent[] }[];
  burns: { owner: string; usdValue: number; events: ProcessedLPEvent[] }[];
  totalMints: number;
  totalBurns: number;
}

// Individual events view component - now with stacked bars by address
const IndividualEventsChartSvg = React.memo(({
  events,
  width,
  height,
  currentPrice,
  poolKey,
  spaceSlug,
}: {
  events: ProcessedLPEvent[];
  width: number;
  height: number;
  currentPrice: number;
  poolKey: string;
  spaceSlug?: string | null;
}) => {
  type SegmentSelection = { bucket: StackedBucket; owner: string; isMint: boolean; events: ProcessedLPEvent[] };
  const [hoveredSegment, setHoveredSegment] = useState<SegmentSelection | null>(null);
  // When a bar is clicked we *pin* that segment's tooltip so the user can
  // interact with it (e.g. click the address through to the block explorer).
  // The pinned tooltip shows whenever no other bar is being hovered; hovering
  // a different bar transiently overrides it for previewing.
  const [pinnedSegment, setPinnedSegment] = useState<SegmentSelection | null>(null);
  const activeSegment = hoveredSegment ?? pinnedSegment;
  const segmentMatches = (a: SegmentSelection | null, b: SegmentSelection | null) =>
    !!a && !!b && a.bucket.timestamp === b.bucket.timestamp && a.owner === b.owner && a.isMint === b.isMint;
  const togglePinned = (next: SegmentSelection) => {
    setPinnedSegment((prev) => (segmentMatches(prev, next) ? null : next));
  };
  const margin = { top: 20, right: 52, bottom: 40, left: 65 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  if (events.length === 0 || innerW <= 0 || innerH <= 0) return null;

  // Sort by timestamp
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  
  // Find time range to determine bucket size
  const minTime = Math.min(...sortedEvents.map(e => e.timestamp));
  const maxTime = Math.max(...sortedEvents.map(e => e.timestamp));
  const timeRange = maxTime - minTime;
  
  // Always use hourly buckets
  const getBucket = getHourBucket;
  const bucketSize = 3600;

  // Group events into stacked buckets by time and address
  const bucketMap = new Map<number, StackedBucket>();
  
  for (const event of sortedEvents) {
    const bucketTs = getBucket(event.timestamp);
    
    if (!bucketMap.has(bucketTs)) {
      bucketMap.set(bucketTs, {
        timestamp: bucketTs,
        mints: [],
        burns: [],
        totalMints: 0,
        totalBurns: 0,
      });
    }
    
    const bucket = bucketMap.get(bucketTs)!;
    const isMint = event.eventType === "MINT" || event.eventType === "INCREASE";
    const targetArray = isMint ? bucket.mints : bucket.burns;
    
    // Find or create owner entry
    let ownerEntry = targetArray.find(e => e.owner.toLowerCase() === event.owner.toLowerCase());
    if (!ownerEntry) {
      ownerEntry = { owner: event.owner, usdValue: 0, events: [] };
      targetArray.push(ownerEntry);
    }
    
    ownerEntry.usdValue += event.usdValue;
    ownerEntry.events.push(event);
    
    if (isMint) {
      bucket.totalMints += event.usdValue;
    } else {
      bucket.totalBurns += event.usdValue;
    }
  }

  // Convert to array and sort
  const buckets = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  
  // Sort each bucket's segments by value (largest first for better stacking)
  for (const bucket of buckets) {
    bucket.mints.sort((a, b) => b.usdValue - a.usdValue);
    bucket.burns.sort((a, b) => b.usdValue - a.usdValue);
  }

  // Find max values for scale - use percentile-based cap to handle outliers
  const allMintValues = buckets.flatMap(b => b.mints.map(m => m.usdValue)).sort((a, b) => a - b);
  const allBurnValues = buckets.flatMap(b => b.burns.map(m => m.usdValue)).sort((a, b) => a - b);
  
  // Use 90th percentile as the cap, or max if few data points
  const getPercentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 100;
    if (arr.length < 5) return arr[arr.length - 1] || 100;
    const idx = Math.floor(arr.length * p);
    return arr[Math.min(idx, arr.length - 1)];
  };
  
  const p90Mint = getPercentile(allMintValues, 0.9);
  const p90Burn = getPercentile(allBurnValues, 0.9);
  
  // Cap at 2x the 90th percentile to show some headroom for outliers
  const maxMint = Math.max(Math.min(Math.max(...buckets.map(b => b.totalMints), 100), p90Mint * 2.5), p90Mint * 1.5);
  const maxBurn = Math.max(Math.min(Math.max(...buckets.map(b => b.totalBurns), 100), p90Burn * 2.5), p90Burn * 1.5);
  const maxValue = Math.max(maxMint, maxBurn, 1000); // minimum scale of $1K

  // Time scale
  const xScale = scaleBand<number>({
    domain: buckets.map(b => b.timestamp),
    range: [0, innerW],
    padding: 0.15,
  });

  // Y scale - symmetric around 0 with capped domain
  const yScale = scaleLinear<number>({
    domain: [-maxValue * 1.1, maxValue * 1.1],
    range: [innerH, 0],
    nice: true,
  });

  const zeroY = yScale(0);
  const barWidth = xScale.bandwidth();
  
  // Helper to convert USD value to pixel height (capped for display)
  const valueToHeight = (usdValue: number): number => {
    const cappedValue = Math.min(usdValue, maxValue);
    return Math.abs(yScale(cappedValue) - zeroY);
  };

  // Check if value exceeds the visible scale
  const isOverflow = (usdValue: number): boolean => usdValue > maxValue;

  return (
    <svg
      width={width}
      height={height}
      onClick={() => setPinnedSegment(null)}
    >
      <defs>
        {/* Grain texture pattern */}
        <pattern id="grainPatternEE" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#ffffff" />
      <Group top={margin.top} left={margin.left}>
        {/* Grid */}
        <GridRows
          scale={yScale}
          width={innerW}
          stroke={COLORS.grid}
          strokeOpacity={0.5}
          numTicks={5}
        />

        {/* Zero line */}
        <line
          x1={0}
          x2={innerW}
          y1={zeroY}
          y2={zeroY}
          stroke="#e5e7eb"
          strokeWidth={1}
        />

        {/* Y-axis labels */}
        {/* Zero */}
        <text
          x={-12}
          y={zeroY}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={10}
          fill="#9ca3af"
          fontWeight={500}
        >
          0
        </text>

        {/* Added - with up arrow */}
        <g transform={`translate(0, ${Math.max(zeroY * 0.45, 16)})`}>
          <text
            x={-12}
            y={0}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="#5B9A8B"
            fontWeight={500}
          >
            Added
          </text>
          <text
            x={-12}
            y={-12}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={8}
            fill="#5B9A8B"
            opacity={0.6}
          >
            ▲
          </text>
        </g>

        {/* Removed - with down arrow */}
        <g transform={`translate(0, ${Math.min(zeroY + (innerH - zeroY) * 0.55, innerH - 16)})`}>
          <text
            x={-12}
            y={0}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            fill="#C49052"
            fontWeight={500}
          >
            Removed
          </text>
          <text
            x={-12}
            y={12}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={8}
            fill="#C49052"
            opacity={0.6}
          >
            ▼
          </text>
        </g>

        {/* Stacked bars for each bucket */}
        {buckets.map((bucket) => {
          const x = xScale(bucket.timestamp) ?? 0;
          
          // Render mints (stacked upward from zero)
          let mintOffset = 0;
          const mintBars = bucket.mints.map((entry, i) => {
            const barHeight = valueToHeight(entry.usdValue);
            const y = zeroY - mintOffset - barHeight;
            const segment: SegmentSelection = { bucket, owner: entry.owner, isMint: true, events: entry.events };
            const isHovered = segmentMatches(hoveredSegment, segment);
            const isPinned = segmentMatches(pinnedSegment, segment);
            const isActive = isHovered || isPinned;
            const hasOverflow = isOverflow(bucket.totalMints) && i === 0;
            const bar = (
              <g key={`mint-${bucket.timestamp}-${entry.owner}`}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={addressToColor(entry.owner)}
                  opacity={isActive ? 1 : 0.85}
                  rx={0}
                  stroke={isPinned ? "#0A0906" : isHovered ? "#000" : "rgba(255,255,255,0.4)"}
                  strokeWidth={isPinned ? 2.4 : isHovered ? 2 : 0.5}
                  onMouseEnter={() => setHoveredSegment(segment)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onClick={(e) => { e.stopPropagation(); togglePinned(segment); }}
                  style={{ cursor: "pointer" }}
                />
                {/* Grain overlay */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="url(#grainPatternEE)"
                  opacity={isHovered ? 1 : 0.85}
                  pointerEvents="none"
                />
                {/* Overflow chevron indicator */}
                {hasOverflow && (
                  <g pointerEvents="none">
                    <polygon
                      points={`${x + barWidth/2 - 4},${y + 8} ${x + barWidth/2},${y + 2} ${x + barWidth/2 + 4},${y + 8}`}
                      fill="#fff"
                      opacity={0.9}
                    />
                    <polygon
                      points={`${x + barWidth/2 - 4},${y + 14} ${x + barWidth/2},${y + 8} ${x + barWidth/2 + 4},${y + 14}`}
                      fill="#fff"
                      opacity={0.6}
                    />
                  </g>
                )}
              </g>
            );
            
            mintOffset += barHeight;
            return bar;
          });

          // Render burns (stacked downward from zero)
          let burnOffset = 0;
          const burnBars = bucket.burns.map((entry, i) => {
            const barHeight = valueToHeight(entry.usdValue);
            const y = zeroY + burnOffset;
            const segment: SegmentSelection = { bucket, owner: entry.owner, isMint: false, events: entry.events };
            const isHovered = segmentMatches(hoveredSegment, segment);
            const isPinned = segmentMatches(pinnedSegment, segment);
            const isActive = isHovered || isPinned;
            const hasOverflow = isOverflow(bucket.totalBurns) && i === 0;
            const bottomY = y + barHeight;
            const bar = (
              <g key={`burn-${bucket.timestamp}-${entry.owner}`}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={addressToColor(entry.owner)}
                  opacity={isActive ? 1 : 0.85}
                  rx={0}
                  stroke={isPinned ? "#0A0906" : isHovered ? "#000" : "rgba(255,255,255,0.4)"}
                  strokeWidth={isPinned ? 2.4 : isHovered ? 2 : 0.5}
                  onMouseEnter={() => setHoveredSegment(segment)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onClick={(e) => { e.stopPropagation(); togglePinned(segment); }}
                  style={{ cursor: "pointer" }}
                />
                {/* Grain overlay */}
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill="url(#grainPatternEE)"
                  opacity={isHovered ? 1 : 0.85}
                  pointerEvents="none"
                />
                {/* Overflow chevron indicator (pointing down) */}
                {hasOverflow && (
                  <g pointerEvents="none">
                    <polygon
                      points={`${x + barWidth/2 - 4},${bottomY - 8} ${x + barWidth/2},${bottomY - 2} ${x + barWidth/2 + 4},${bottomY - 8}`}
                      fill="#fff"
                      opacity={0.9}
                    />
                    <polygon
                      points={`${x + barWidth/2 - 4},${bottomY - 14} ${x + barWidth/2},${bottomY - 8} ${x + barWidth/2 + 4},${bottomY - 14}`}
                      fill="#fff"
                      opacity={0.6}
                    />
                  </g>
                )}
              </g>
            );
            
            burnOffset += barHeight;
            return bar;
          });

          return (
            <g key={bucket.timestamp}>
              {mintBars}
              {burnBars}
            </g>
          );
        })}


        {/* X Axis */}
        {(() => {
          // Show a few date labels
          const tickBuckets = buckets.filter((_, i) => i === 0 || i === buckets.length - 1 || i === Math.floor(buckets.length / 2));
          return tickBuckets.map((bucket) => {
            const x = (xScale(bucket.timestamp) ?? 0) + barWidth / 2;
            const date = new Date(bucket.timestamp * 1000);
            return (
              <text
                key={`x-${bucket.timestamp}`}
                x={x}
                y={innerH + 16}
                textAnchor="middle"
                fontSize={10}
                fill={COLORS.text}
              >
                {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </text>
            );
          });
        })()}

        {/* Leader lines for top outliers - angled to right edge */}
        {(() => {
          // Find top mint and burn buckets
          const sortedByMint = [...buckets].sort((a, b) => b.totalMints - a.totalMints);
          const sortedByBurn = [...buckets].sort((a, b) => b.totalBurns - a.totalBurns);

          const topMint = sortedByMint[0];
          const topBurn = sortedByBurn[0];

          // Only show if significant (> $5k)
          const minThreshold = 5000;
          const leaders: React.ReactElement[] = [];

          if (topMint && topMint.totalMints > minThreshold) {
            const barX = (xScale(topMint.timestamp) ?? 0) + barWidth / 2;
            const barTopY = Math.max(zeroY - valueToHeight(topMint.totalMints), 0);
            // Position label at right edge, at a fixed Y near the top
            const labelX = innerW + 8;
            const labelY = 12;

            leaders.push(
              <g key="leader-mint" pointerEvents="none">
                {/* Angled connector line to right edge */}
                <path
                  d={`M ${barX} ${barTopY} Q ${barX + 20} ${barTopY - 10}, ${labelX - 4} ${labelY}`}
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.5}
                />
                {/* Small dot at bar */}
                <circle cx={barX} cy={barTopY} r={2.5} fill="#5B9A8B" opacity={0.9} />
                {/* Label with background pill */}
                <rect
                  x={labelX - 2}
                  y={labelY - 10}
                  width={42}
                  height={14}
                  rx={3}
                  fill="#f0fdfa"
                  stroke="#99f6e4"
                  strokeWidth={0.5}
                />
                <text
                  x={labelX + 19}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#115e59"
                  fontWeight={600}
                >
                  {formatUsdCompact(topMint.totalMints)}
                </text>
              </g>
            );
          }

          if (topBurn && topBurn.totalBurns > minThreshold) {
            const barX = (xScale(topBurn.timestamp) ?? 0) + barWidth / 2;
            const barBottomY = Math.min(zeroY + valueToHeight(topBurn.totalBurns), innerH);
            // Position label at right edge, at a fixed Y near the bottom
            const labelX = innerW + 8;
            const labelY = innerH - 4;

            leaders.push(
              <g key="leader-burn" pointerEvents="none">
                {/* Angled connector line to right edge */}
                <path
                  d={`M ${barX} ${barBottomY} Q ${barX + 20} ${barBottomY + 10}, ${labelX - 4} ${labelY}`}
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.5}
                />
                {/* Small dot at bar */}
                <circle cx={barX} cy={barBottomY} r={2.5} fill="#C49052" opacity={0.9} />
                {/* Label with background pill */}
                <rect
                  x={labelX - 2}
                  y={labelY - 10}
                  width={42}
                  height={14}
                  rx={3}
                  fill="#fef3c7"
                  stroke="#fcd34d"
                  strokeWidth={0.5}
                />
                <text
                  x={labelX + 19}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#92400e"
                  fontWeight={600}
                >
                  {formatUsdCompact(topBurn.totalBurns)}
                </text>
              </g>
            );
          }

          return leaders;
        })()}
      </Group>

      {/* Tooltip - native SVG for speed. Uses `activeSegment` so it persists
          on a click-pinned bar even after the cursor leaves. When the segment
          is the pinned one, the address is rendered as an SVG <a> linking to
          the correct block explorer for the active space, and a small × badge
          lets the user unpin without having to re-click the original bar. */}
      {activeSegment && (() => {
        const total = activeSegment.events.reduce((sum, e) => sum + e.usdValue, 0);
        const date = new Date(activeSegment.bucket.timestamp * 1000);
        const largestEvent = activeSegment.events.reduce((max, e) => e.usdValue > max.usdValue ? e : max, activeSegment.events[0]);
        const concentratedCount = activeSegment.events.filter(e => e.isConcentrated).length;
        const tooltipX = Math.min(Math.max(margin.left + (xScale(activeSegment.bucket.timestamp) ?? 0), 115), width - 115);
        const h = concentratedCount > 0 ? 94 : 82;
        const W = 220; // tooltip width
        const L = -W/2 + 8; // left padding
        const R = W/2 - 8; // right padding
        // Format price compactly
        const formatPrice = (p: number) => {
          if (p >= 1000) return p.toFixed(0);
          if (p >= 1) return p.toFixed(2);
          if (p >= 0.01) return p.toFixed(4);
          return p.toExponential(1);
        };

        const activeMeta = getLpMeta(activeSegment.owner, spaceSlug);
        const labelX = activeMeta?.logoSrc ? L + 26 : L + 12;
        const isPinnedTooltip = segmentMatches(pinnedSegment, activeSegment);
        const explorerHref = getAddressExplorerUrl(activeSegment.owner, spaceSlug, poolKey);

        // Pinned tooltips need to receive pointer events so the link is
        // clickable; hover-only tooltips stay non-interactive so the cursor
        // can still slide between bars.
        return (
          <g
            transform={`translate(${tooltipX}, ${margin.top + 4})`}
            pointerEvents={isPinnedTooltip ? "auto" : "none"}
          >
            <rect
              x={-W/2}
              y={0}
              width={W}
              height={h}
              fill={isPinnedTooltip ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.5)"}
              stroke={isPinnedTooltip ? "#0A0906" : COLORS.grid}
              strokeWidth={isPinnedTooltip ? 1 : 0.5}
              rx={4}
            />
            {/* Row 1: Address (clickable when pinned) */}
            <rect x={L} y={6} width={8} height={8} fill={addressToColor(activeSegment.owner)} rx={1} />
            {activeMeta?.logoSrc && (
              <image href={activeMeta.logoSrc} x={L + 12} y={5} width={10} height={10} />
            )}
            {isPinnedTooltip ? (
              <a
                href={explorerHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{ cursor: "pointer" }}
              >
                <title>{activeSegment.owner} · open in block explorer</title>
                <text
                  x={labelX}
                  y={13}
                  fontSize={9}
                  fill="#1d4ed8"
                  fontWeight={700}
                  textDecoration="underline"
                >
                  {formatLpLabel(activeSegment.owner, spaceSlug)} ↗
                </text>
              </a>
            ) : (
              <text x={labelX} y={13} fontSize={9} fill="#3b82f6" fontWeight={600}>
                {formatLpLabel(activeSegment.owner, spaceSlug)}
              </text>
            )}
            {/* Pinned-only close button */}
            {isPinnedTooltip && (
              <g
                transform={`translate(${R - 4}, 4)`}
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setPinnedSegment(null); }}
              >
                <title>Unpin tooltip</title>
                <rect x={-7} y={-1} width={14} height={14} fill="transparent" />
                <text x={0} y={9} fontSize={11} fill="#5E5B50" textAnchor="middle" fontWeight={700}>×</text>
              </g>
            )}
            {/* Row 2: Type + Total */}
            <text x={L} y={26} fontSize={9} fill={activeSegment.isMint ? COLORS.mint : COLORS.burn} fontWeight={600}>
              {activeSegment.isMint ? "↑ Add" : "↓ Remove"}
            </text>
            <text x={R} y={26} fontSize={9} fill="#111" fontWeight={600} textAnchor="end">{formatUsdCompact(total)}</text>
            {/* Row 3: Events + Date */}
            <text x={L} y={39} fontSize={9} fill={COLORS.text}>{activeSegment.events.length} events</text>
            <text x={R} y={39} fontSize={9} fill={COLORS.text} textAnchor="end">{date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} {date.getHours()}h</text>
            {/* Row 4: Concentrated (optional) */}
            {concentratedCount > 0 && (
              <text x={L} y={52} fontSize={9} fill={COLORS.concentrated} fontWeight={500}>⚡ {concentratedCount} concentrated</text>
            )}
            {/* Divider */}
            <line x1={L} x2={R} y1={concentratedCount > 0 ? 58 : 46} y2={concentratedCount > 0 ? 58 : 46} stroke={COLORS.grid} />
            {/* Largest event */}
            <text x={L} y={concentratedCount > 0 ? 71 : 59} fontSize={9} fill={COLORS.text}>
              Max: {formatUsdCompact(largestEvent.usdValue)}{largestEvent.tokenId ? ` #${largestEvent.tokenId}` : ""}
            </text>
            <text x={L} y={concentratedCount > 0 ? 84 : 72} fontSize={9} fill={COLORS.text}>
              {formatPrice(largestEvent.priceLower)} – {formatPrice(largestEvent.priceUpper)}
            </text>
          </g>
        );
      })()}
    </svg>
  );
});

IndividualEventsChartSvg.displayName = "IndividualEventsChartSvg";

// Position data for tokenId lookup
interface PositionForLookup {
  tokenId: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

interface PositionsByOwnerEntry {
  owner: string;
  positions: PositionForLookup[];
}

export interface LPEntryExitChartProps {
  data: LPEntryExitDataPoint[];
  rawEvents?: LPEventData[];
  token0Decimals?: number;
  token1Decimals?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  currentPrice?: number;
  sqrtPriceX96?: string;
  poolKey?: string;
  positionsByOwner?: PositionsByOwnerEntry[];
  spaceSlug?: string | null;
  className?: string;
}

export const LPEntryExitChart = React.memo(({
  data,
  rawEvents,
  token0Decimals = 18,
  token1Decimals = 6,
  token0UsdPrice,
  token1UsdPrice,
  currentPrice = 1,
  sqrtPriceX96,
  poolKey = "",
  positionsByOwner,
  spaceSlug,
  className,
}: LPEntryExitChartProps) => {
  const points = useMemo(() => normalize(data ?? []), [data]);
  
  // Create a lookup map for tokenId from positions: key = "owner|tickLower|tickUpper"
  const tokenIdLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    if (!positionsByOwner) return lookup;
    
    for (const entry of positionsByOwner) {
      const ownerLc = entry.owner.toLowerCase();
      for (const pos of entry.positions) {
        const key = `${ownerLc}|${pos.tickLower}|${pos.tickUpper}`;
        if (!lookup.has(key)) {
          lookup.set(key, pos.tokenId);
        }
      }
    }
    return lookup;
  }, [positionsByOwner]);
  
  // Process raw events into individual events with USD values
  const processedEvents = useMemo((): ProcessedLPEvent[] => {
    if (!rawEvents || rawEvents.length === 0) return [];
    if (token0UsdPrice == null && token1UsdPrice == null) return [];

    return rawEvents.map((event): ProcessedLPEvent => {
      const usdValue = calculateLPEventUsdValue({
        event,
        poolKey,
        token0Decimals,
        token1Decimals,
        token0UsdPrice,
        token1UsdPrice,
        sqrtPriceX96,
      });
      const tickLower = parseInt(event.tickLower);
      const tickUpper = parseInt(event.tickUpper);
      
      // Calculate prices from ticks
      const priceLower = tickToPrice(tickLower, token0Decimals, token1Decimals);
      const priceUpper = tickToPrice(tickUpper, token0Decimals, token1Decimals);
      
      // Check if this is a concentrated position (range < 10% of current price)
      const rangeWidth = Math.abs(priceUpper - priceLower);
      const isConcentrated = currentPrice > 0 && rangeWidth < currentPrice * 0.1;
      
      // Look up tokenId from positions data
      const lookupKey = `${event.owner.toLowerCase()}|${tickLower}|${tickUpper}`;
      const tokenId = tokenIdLookup.get(lookupKey);

      return {
        id: event.id,
        tokenId: tokenId,
        owner: event.owner,
        eventType: event.eventType,
        timestamp: event.timestamp,
        usdValue,
        tickLower,
        tickUpper,
        priceLower,
        priceUpper,
        isConcentrated,
      };
    }).filter(e => e.usdValue > 0).sort((a, b) => b.usdValue - a.usdValue);
  }, [rawEvents, poolKey, token0Decimals, token1Decimals, token0UsdPrice, token1UsdPrice, sqrtPriceX96, currentPrice, tokenIdLookup]);

  // Calculate stats for individual events
  const eventStats = useMemo(() => {
    if (processedEvents.length === 0) return null;
    const mints = processedEvents.filter(e => e.eventType === "MINT" || e.eventType === "INCREASE");
    const burns = processedEvents.filter(e => e.eventType === "BURN" || e.eventType === "DECREASE");
    const concentrated = processedEvents.filter(e => e.isConcentrated);
    const largestEvent = processedEvents[0];
    const uniqueAddresses = new Set(processedEvents.map(e => e.owner.toLowerCase()));
    
    return {
      totalMints: mints.length,
      totalBurns: burns.length,
      totalMintUsd: mints.reduce((sum, e) => sum + e.usdValue, 0),
      totalBurnUsd: burns.reduce((sum, e) => sum + e.usdValue, 0),
      concentratedCount: concentrated.length,
      largestEvent,
      uniqueAddresses: uniqueAddresses.size,
    };
  }, [processedEvents]);

  if (processedEvents.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full flex flex-col", className)}>
      {/* Stats bar - clean two-row design */}
      {eventStats && (
        <div className="px-3 py-2 border-b border-gray-100 shrink-0">
          {/* Row 1: Key metrics */}
          <div className="flex items-center justify-between text-[11px] mb-1">
            <div className="flex items-center gap-4">
              {/* Added */}
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded" style={{ background: COLORS.mint }} />
                <span className="text-gray-600">Added</span>
                <span className="font-semibold text-gray-800">{formatUsdCompact(eventStats.totalMintUsd)}</span>
                <span className="text-gray-400">({eventStats.totalMints})</span>
              </div>
              {/* Removed */}
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded" style={{ background: COLORS.burn }} />
                <span className="text-gray-600">Removed</span>
                <span className="font-semibold text-gray-800">{formatUsdCompact(eventStats.totalBurnUsd)}</span>
                <span className="text-gray-400">({eventStats.totalBurns})</span>
              </div>
            </div>
            {/* Net flow */}
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Net:</span>
              <span className={`font-semibold ${eventStats.totalMintUsd - eventStats.totalBurnUsd >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                {eventStats.totalMintUsd - eventStats.totalBurnUsd >= 0 ? '+' : ''}{formatUsdCompact(eventStats.totalMintUsd - eventStats.totalBurnUsd)}
              </span>
            </div>
          </div>
          {/* Row 2: Secondary info */}
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <div className="flex items-center gap-3">
              <span>{eventStats.uniqueAddresses} unique addresses</span>
              {eventStats.concentratedCount > 0 && (
                <span className="flex items-center gap-1" title="Positions with range < 10% of current price">
                  <span style={{ color: COLORS.concentrated }}>⚡</span>
                  {eventStats.concentratedCount} concentrated
                </span>
              )}
            </div>
            {eventStats.largestEvent && (() => {
              const largestMeta = getLpMeta(eventStats.largestEvent.owner, spaceSlug);
              return (
                <div className="flex items-center gap-1">
                <span>Largest:</span>
                <span className="font-medium text-gray-600">{formatUsdCompact(eventStats.largestEvent.usdValue)}</span>
                <span>by</span>
                <a
                  href={getAddressExplorerUrl(eventStats.largestEvent.owner, spaceSlug, poolKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[var(--ts-ink-1)] underline decoration-dotted underline-offset-2 hover:text-[var(--ts-ink-0)] font-medium"
                  title={eventStats.largestEvent.owner}
                >
                  {largestMeta?.logoSrc && (
                    <img
                      src={largestMeta.logoSrc}
                      alt={`${largestMeta.label} logo`}
                      className="w-3 h-3 rounded-sm"
                      loading="lazy"
                    />
                  )}
                  {formatLpLabel(eventStats.largestEvent.owner, spaceSlug)}
                </a>
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ParentSize debounceTime={300}>
          {({ width, height }) => (
            <IndividualEventsChartSvg 
              events={processedEvents} 
              width={width > 0 ? width : 520} 
              height={height > 0 ? height : 260}
              currentPrice={currentPrice}
              poolKey={poolKey}
              spaceSlug={spaceSlug}
            />
          )}
        </ParentSize>
      </div>
    </div>
  );
});

LPEntryExitChart.displayName = "LPEntryExitChart";
