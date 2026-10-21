"use client";

import React, { useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleBand } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import type { LPEventData } from "@/lib/envio-client";
import { buildWorldchainTimeBuckets } from "@/lib/worldchain-pool-data";

interface LPPositionActivityChartProps {
  lpEvents: LPEventData[];
  selectedOwner: string | null;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  authoritativeEmptyWindow?: boolean;
  windowDays?: number;
  isLoading?: boolean;
}

interface ProcessedEvent {
  id: string;
  timestamp: number;
  eventType: "MINT" | "BURN" | "INCREASE" | "DECREASE";
  usdValue: number;
}

interface HourBucket {
  timestamp: number;
  mints: number;
  burns: number;
  mintCount: number;
  burnCount: number;
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (absValue >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// Premium colors - balanced vibrancy
const COLORS = {
  mint: "#6A9BD1", // Sky blue - add liquidity
  burn: "#D4A55A", // Golden honey - remove liquidity
  grid: "#e5e7eb",
  text: "#6b7280",
};

// Get hour bucket for a timestamp
const getHourBucket = (timestamp: number): number => {
  return Math.floor(timestamp / 3600) * 3600;
};

const LPPositionActivityChartInner: React.FC<
  LPPositionActivityChartProps & { width: number; height: number }
> = ({
  lpEvents,
  selectedOwner,
  token0Decimals,
  token1Decimals,
  token0UsdPrice,
  token1UsdPrice,
  authoritativeEmptyWindow = false,
  windowDays = 7,
  isLoading,
  width,
  height,
}) => {
  const [hoveredBucket, setHoveredBucket] = useState<HourBucket | null>(null);
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const startTime = roundedNow - windowDays * 86400;

  // Filter and process events for the selected owner
  const processedEvents = useMemo((): ProcessedEvent[] => {
    if (!selectedOwner || !lpEvents || lpEvents.length === 0) return [];
    if (token0UsdPrice === null && token1UsdPrice === null) return [];

    const ownerLc = selectedOwner.toLowerCase();
    const filtered = lpEvents.filter((e) => e.owner.toLowerCase() === ownerLc);

    return filtered.map((event): ProcessedEvent => {
      const amount0 = Math.abs(Number(event.amount0) / Math.pow(10, token0Decimals));
      const amount1 = Math.abs(Number(event.amount1) / Math.pow(10, token1Decimals));

      let usdValue = 0;
      if (token0UsdPrice !== null && token1UsdPrice !== null) {
        usdValue = amount0 * token0UsdPrice + amount1 * token1UsdPrice;
      } else if (token0UsdPrice !== null) {
        usdValue = amount0 * token0UsdPrice * 2;
      } else if (token1UsdPrice !== null) {
        usdValue = amount1 * token1UsdPrice * 2;
      }

      return {
        id: event.id,
        timestamp: event.timestamp,
        eventType: event.eventType,
        usdValue,
      };
    });
  }, [lpEvents, selectedOwner, token0Decimals, token1Decimals, token0UsdPrice, token1UsdPrice]);

  // Bucket events by hour
  const buckets = useMemo((): HourBucket[] => {
    if (processedEvents.length === 0) {
      if (!selectedOwner || !authoritativeEmptyWindow) return [];
      return buildWorldchainTimeBuckets(startTime, roundedNow, 3600).map((timestamp) => ({
        timestamp,
        mints: 0,
        burns: 0,
        mintCount: 0,
        burnCount: 0,
      }));
    }

    const bucketMap = new Map<number, HourBucket>();

    for (const event of processedEvents) {
      const bucketTs = getHourBucket(event.timestamp);
      
      if (!bucketMap.has(bucketTs)) {
        bucketMap.set(bucketTs, {
          timestamp: bucketTs,
          mints: 0,
          burns: 0,
          mintCount: 0,
          burnCount: 0,
        });
      }

      const bucket = bucketMap.get(bucketTs)!;
      const isMint = event.eventType === "MINT" || event.eventType === "INCREASE";
      
      if (isMint) {
        bucket.mints += event.usdValue;
        bucket.mintCount++;
      } else {
        bucket.burns += event.usdValue;
        bucket.burnCount++;
      }
    }

    return Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [authoritativeEmptyWindow, processedEvents, roundedNow, selectedOwner, startTime]);

  // Calculate statistics
  const stats = useMemo(() => {
    const totalMintVolume = buckets.reduce((acc, b) => acc + b.mints, 0);
    const totalBurnVolume = buckets.reduce((acc, b) => acc + b.burns, 0);
    const mintCount = buckets.reduce((acc, b) => acc + b.mintCount, 0);
    const burnCount = buckets.reduce((acc, b) => acc + b.burnCount, 0);
    
    return {
      mintCount,
      burnCount,
      totalMintVolume,
      totalBurnVolume,
      totalEvents: mintCount + burnCount,
    };
  }, [buckets]);

  // Dimensions
  const statsHeaderHeight = 44;
  const margin = { top: 16, right: 16, bottom: 36, left: 55 };
  const chartHeight = Math.max(height - statsHeaderHeight, 80);
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, chartHeight - margin.top - margin.bottom);

  // Scales
  const xScale = useMemo(() => {
    return scaleBand<number>({
      domain: buckets.map(b => b.timestamp),
      range: [0, innerWidth],
      padding: 0.2,
    });
  }, [buckets, innerWidth]);

  const yScale = useMemo(() => {
    if (buckets.length === 0) {
      return scaleLinear<number>({
        domain: [-100, 100],
        range: [innerHeight, 0],
        nice: true,
      });
    }
    const maxMint = Math.max(...buckets.map(b => b.mints), 100);
    const maxBurn = Math.max(...buckets.map(b => b.burns), 100);
    const maxValue = Math.max(maxMint, maxBurn);
    return scaleLinear<number>({
      domain: [-maxValue * 1.1, maxValue * 1.1],
      range: [innerHeight, 0],
      nice: true,
    });
  }, [buckets, innerHeight]);

  const barWidth = xScale.bandwidth();
  const zeroY = yScale(0);

  if (width <= 0 || height <= 0) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!selectedOwner) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
        <span>Select an LP address to view position activity</span>
      </div>
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-gray-400 gap-2">
        <span>No position changes found for this address</span>
        <span className="text-xs text-gray-300">
          ({lpEvents?.length ?? 0} total events in range)
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Stats header - matching LP Activity design */}
      <div className="px-3 py-2 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded" style={{ background: COLORS.mint }} />
              <span className="text-gray-600">Added</span>
              <span className="font-semibold text-gray-800">{formatUsdCompact(stats.totalMintVolume)}</span>
              <span className="text-gray-400">({stats.mintCount})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded" style={{ background: COLORS.burn }} />
              <span className="text-gray-600">Removed</span>
              <span className="font-semibold text-gray-800">{formatUsdCompact(stats.totalBurnVolume)}</span>
              <span className="text-gray-400">({stats.burnCount})</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Net:</span>
            <span className={`font-semibold ${stats.totalMintVolume - stats.totalBurnVolume >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
              {stats.totalMintVolume - stats.totalBurnVolume >= 0 ? '+' : ''}{formatUsdCompact(stats.totalMintVolume - stats.totalBurnVolume)}
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <svg width={width} height={chartHeight}>
          <defs>
            {/* Grain texture pattern */}
            <pattern id="grainPatternPA" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
            </pattern>
          </defs>
          <Group top={margin.top} left={margin.left}>
            {/* Grid */}
            <GridRows
              scale={yScale}
              width={innerWidth}
              stroke={COLORS.grid}
              strokeOpacity={0.5}
              numTicks={5}
            />

            {/* Zero line */}
            <line
              x1={0}
              x2={innerWidth}
              y1={zeroY}
              y2={zeroY}
              stroke={COLORS.text}
              strokeWidth={1}
              strokeDasharray="4 2"
            />

            {/* Bars */}
            {buckets.map((bucket) => {
              const x = xScale(bucket.timestamp) ?? 0;
              const isHovered = hoveredBucket?.timestamp === bucket.timestamp;

              // Mint bar (going up)
              const mintHeight = bucket.mints > 0 ? Math.abs(yScale(bucket.mints) - zeroY) : 0;
              const mintY = zeroY - mintHeight;

              // Burn bar (going down)
              const burnHeight = bucket.burns > 0 ? Math.abs(yScale(bucket.burns) - zeroY) : 0;
              const burnY = zeroY;

              return (
                <g 
                  key={bucket.timestamp}
                  onMouseEnter={() => setHoveredBucket(bucket)}
                  onMouseLeave={() => setHoveredBucket(null)}
                  style={{ cursor: "pointer" }}
                >
                  {mintHeight > 0 && (
                    <>
                      <rect
                        x={x}
                        y={mintY}
                        width={barWidth}
                        height={mintHeight}
                        fill={COLORS.mint}
                        opacity={isHovered ? 1 : 0.85}
                        rx={0}
                      />
                      <rect
                        x={x}
                        y={mintY}
                        width={barWidth}
                        height={mintHeight}
                        fill="url(#grainPatternPA)"
                        opacity={isHovered ? 1 : 0.85}
                        pointerEvents="none"
                      />
                    </>
                  )}
                  {burnHeight > 0 && (
                    <>
                      <rect
                        x={x}
                        y={burnY}
                        width={barWidth}
                        height={burnHeight}
                        fill={COLORS.burn}
                        opacity={isHovered ? 1 : 0.85}
                        rx={0}
                      />
                      <rect
                        x={x}
                        y={burnY}
                        width={barWidth}
                        height={burnHeight}
                        fill="url(#grainPatternPA)"
                        opacity={isHovered ? 1 : 0.85}
                        pointerEvents="none"
                      />
                    </>
                  )}
                </g>
              );
            })}

            {/* Y Axis */}
            <AxisLeft
              scale={yScale}
              tickFormat={(d) => formatUsdCompact(d as number)}
              stroke={COLORS.text}
              tickStroke={COLORS.text}
              tickLabelProps={() => ({
                fill: COLORS.text,
                fontSize: 10,
                textAnchor: "end",
                dx: "-0.25em",
                dy: "0.25em",
              })}
              numTicks={5}
            />

            {/* X Axis - show a few date labels */}
            {(() => {
              const tickBuckets = buckets.filter((_, i) => 
                i === 0 || i === buckets.length - 1 || i === Math.floor(buckets.length / 2)
              );
              return tickBuckets.map((bucket) => {
                const x = (xScale(bucket.timestamp) ?? 0) + barWidth / 2;
                const date = new Date(bucket.timestamp * 1000);
                return (
                  <text
                    key={`x-${bucket.timestamp}`}
                    x={x}
                    y={innerHeight + 16}
                    textAnchor="middle"
                    fontSize={10}
                    fill={COLORS.text}
                  >
                    {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </text>
                );
              });
            })()}

            {/* Axis labels */}
            <text x={-8} y={-6} fontSize={8} fill={COLORS.text} textAnchor="end">Added</text>
            <text x={-8} y={innerHeight + 10} fontSize={8} fill={COLORS.text} textAnchor="end">Removed</text>
          </Group>

          {/* Tooltip */}
          {hoveredBucket && (
            <g
              transform={`translate(${Math.min(Math.max(margin.left + (xScale(hoveredBucket.timestamp) ?? 0) + barWidth/2, 90), width - 90)}, ${margin.top + 8})`}
              pointerEvents="none"
            >
              <rect x={-80} y={0} width={160} height={60} fill="rgba(255,255,255,0.5)" stroke={COLORS.grid} rx={4} />
              <text x={-72} y={16} fontSize={10} fill={COLORS.text} fontWeight={500}>
                {new Date(hoveredBucket.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric" })}
              </text>
              <text x={-72} y={32} fontSize={10} fill={COLORS.mint}>
                + {formatUsdCompact(hoveredBucket.mints)} ({hoveredBucket.mintCount})
              </text>
              <text x={-72} y={48} fontSize={10} fill={COLORS.burn}>
                − {formatUsdCompact(hoveredBucket.burns)} ({hoveredBucket.burnCount})
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};

const LPPositionActivityChartWrapper: React.FC<LPPositionActivityChartProps> = (props) => {
  return (
    <ParentSize debounceTime={150}>
      {({ width, height }) => (
        <LPPositionActivityChartInner {...props} width={width} height={height} />
      )}
    </ParentSize>
  );
};

export const LPPositionActivityChart = React.memo(LPPositionActivityChartWrapper);
LPPositionActivityChart.displayName = "LPPositionActivityChart";
