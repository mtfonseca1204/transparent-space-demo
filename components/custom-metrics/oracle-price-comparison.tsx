"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { LinePath, Line, Bar } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";

// Types
export interface OraclePricePoint {
  timestamp: Date;
  price: number;
}

export interface OraclePriceData {
  market: OraclePricePoint[];
  defillama?: OraclePricePoint[];
  coingecko?: OraclePricePoint[];
  pyth?: OraclePricePoint[];
  dexTwap?: OraclePricePoint[];
}

export interface OraclePriceComparisonProps {
  data: OraclePriceData;
  pairLabel: string;
  className?: string;
}

// Oracle configuration
type OracleLineConfig = {
  color: string;
  label: string;
  dashArray?: string;
  strokeWidth: number;
};

// Premium desaturated oracle colors for professional appearance
const ORACLE_CONFIG: Record<"market" | "defillama" | "coingecko" | "pyth" | "dexTwap", OracleLineConfig> = {
  market: { color: "var(--bp-text-primary)", label: "Market", strokeWidth: 2 },
  defillama: { color: "#8B7BA1", label: "DefiLlama", dashArray: "6 3", strokeWidth: 1.5 },  // Dusty purple
  coingecko: { color: "#C49052", label: "CoinGecko", dashArray: "4 4", strokeWidth: 1.5 }, // Warm bronze
  pyth: { color: "#5B8A72", label: "Pyth", dashArray: "2 4", strokeWidth: 1.5 },           // Sage green
  dexTwap: { color: "#A67D94", label: "DEX TWAP", dashArray: "8 2 2 2", strokeWidth: 1.5 }, // Mauve
};

// Format price for axis - handles both small decimals and large numbers
function formatPriceAxis(price: number): string {
  if (!Number.isFinite(price)) return "0";
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

// Format price for tooltip (more precision)
function formatPriceTooltip(price: number): string {
  if (!Number.isFinite(price)) return "0";
  if (price >= 1000) return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toExponential(4);
}

// Find nearest point by timestamp
function findNearestPoint(series: OraclePricePoint[], targetTime: number): OraclePricePoint | null {
  if (!series || series.length === 0) return null;
  
  let nearest = series[0];
  let minDiff = Math.abs(series[0].timestamp.getTime() - targetTime);
  
  for (const point of series) {
    const diff = Math.abs(point.timestamp.getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = point;
    }
  }
  
  return nearest;
}

// Tooltip data type
interface TooltipData {
  timestamp: Date;
  market?: number;
  defillama?: number;
  coingecko?: number;
  pyth?: number;
  dexTwap?: number;
}

// Main chart component
const OraclePriceChart = ({
  data,
  width,
  height,
  pairLabel,
}: {
  data: OraclePriceData;
  width: number;
  height: number;
  pairLabel: string;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [tooltipLeft, setTooltipLeft] = useState<number>(0);
  const [tooltipTop, setTooltipTop] = useState<number>(0);

  const padding = { top: 20, right: 15, bottom: 40, left: 65 };
  const innerWidth = Math.max(0, width - padding.left - padding.right);
  const innerHeight = Math.max(0, height - padding.top - padding.bottom);

  // Calculate domains from all data
  const { xDomain, yDomain } = useMemo(() => {
    const allPoints: OraclePricePoint[] = [
      ...data.market,
      ...(data.defillama ?? []),
      ...(data.coingecko ?? []),
      ...(data.pyth ?? []),
      ...(data.dexTwap ?? []),
    ];

    if (allPoints.length === 0) {
      return {
        xDomain: [new Date(), new Date()] as [Date, Date],
        yDomain: [0, 1] as [number, number],
      };
    }

    const timestamps = allPoints.map((p) => p.timestamp.getTime());
    const prices = allPoints.map((p) => p.price);
    
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    // Add 5% padding to price range
    const pricePadding = (maxPrice - minPrice) * 0.05 || maxPrice * 0.01;
    
    return {
      xDomain: [new Date(minTime), new Date(maxTime)] as [Date, Date],
      yDomain: [minPrice - pricePadding, maxPrice + pricePadding] as [number, number],
    };
  }, [data]);

  // Scales
  const xScale = useMemo(() => scaleTime({
    domain: xDomain,
    range: [0, innerWidth],
  }), [xDomain, innerWidth]);

  const yScale = useMemo(() => scaleLinear({
    domain: yDomain,
    range: [innerHeight, 0],
    nice: true,
  }), [yDomain, innerHeight]);

  // Accessors
  const getX = (d: OraclePricePoint) => xScale(d.timestamp) ?? 0;
  const getY = (d: OraclePricePoint) => yScale(d.price) ?? 0;

  // Handle mouse move using native event
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left - padding.left;
      const y = event.clientY - rect.top;
      
      // Convert x position to timestamp
      const targetTime = xScale.invert(x).getTime();
      
      // Find nearest points from each series
      const marketPoint = findNearestPoint(data.market, targetTime);
      const defillamaPoint = findNearestPoint(data.defillama ?? [], targetTime);
      const coingeckoPoint = findNearestPoint(data.coingecko ?? [], targetTime);
      const pythPoint = findNearestPoint(data.pyth ?? [], targetTime);
      const dexTwapPoint = findNearestPoint(data.dexTwap ?? [], targetTime);
      
      const timestamp = marketPoint?.timestamp ?? new Date(targetTime);
      
      const newTooltipData: TooltipData = {
        timestamp,
        market: marketPoint?.price,
        defillama: defillamaPoint?.price,
        coingecko: coingeckoPoint?.price,
        pyth: pythPoint?.price,
        dexTwap: dexTwapPoint?.price,
      };

      setTooltipData(newTooltipData);
      setTooltipLeft(event.clientX - rect.left);
      setTooltipTop(y);
    },
    [xScale, padding.left, data]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltipData(null);
  }, []);

  // Early return after all hooks
  if (width <= 0 || height <= 0) return null;

  return (
    <div className="relative">
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          <clipPath id="oracle-chart-clip">
            <rect x={0} y={0} width={innerWidth} height={innerHeight} />
          </clipPath>
        </defs>

        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* Grid */}
          <GridRows
            scale={yScale}
            width={innerWidth}
            stroke="var(--bp-border-subtle)"
            strokeOpacity={0.5}
            strokeDasharray="2 4"
            numTicks={5}
          />

          {/* Chart lines */}
          <g clipPath="url(#oracle-chart-clip)">
            {/* DEX TWAP (background) */}
            {data.dexTwap && data.dexTwap.length > 1 && (
              <LinePath
                data={data.dexTwap}
                x={getX}
                y={getY}
                stroke={ORACLE_CONFIG.dexTwap.color}
                strokeWidth={ORACLE_CONFIG.dexTwap.strokeWidth}
                strokeDasharray={ORACLE_CONFIG.dexTwap.dashArray}
                curve={curveMonotoneX}
                strokeOpacity={0.8}
              />
            )}

            {/* Pyth */}
            {data.pyth && data.pyth.length > 1 && (
              <LinePath
                data={data.pyth}
                x={getX}
                y={getY}
                stroke={ORACLE_CONFIG.pyth.color}
                strokeWidth={ORACLE_CONFIG.pyth.strokeWidth}
                strokeDasharray={ORACLE_CONFIG.pyth.dashArray}
                curve={curveMonotoneX}
                strokeOpacity={0.8}
              />
            )}

            {/* CoinGecko */}
            {data.coingecko && data.coingecko.length > 1 && (
              <LinePath
                data={data.coingecko}
                x={getX}
                y={getY}
                stroke={ORACLE_CONFIG.coingecko.color}
                strokeWidth={ORACLE_CONFIG.coingecko.strokeWidth}
                strokeDasharray={ORACLE_CONFIG.coingecko.dashArray}
                curve={curveMonotoneX}
                strokeOpacity={0.8}
              />
            )}

            {/* DefiLlama */}
            {data.defillama && data.defillama.length > 1 && (
              <LinePath
                data={data.defillama}
                x={getX}
                y={getY}
                stroke={ORACLE_CONFIG.defillama.color}
                strokeWidth={ORACLE_CONFIG.defillama.strokeWidth}
                strokeDasharray={ORACLE_CONFIG.defillama.dashArray}
                curve={curveMonotoneX}
                strokeOpacity={0.8}
              />
            )}

            {/* Market price (on top, solid) */}
            {data.market.length > 1 && (
              <LinePath
                data={data.market}
                x={getX}
                y={getY}
                stroke={ORACLE_CONFIG.market.color}
                strokeWidth={ORACLE_CONFIG.market.strokeWidth}
                curve={curveMonotoneX}
              />
            )}
          </g>

          {/* Tooltip vertical line */}
          {tooltipData && (
            <Line
              from={{ x: xScale(tooltipData.timestamp), y: 0 }}
              to={{ x: xScale(tooltipData.timestamp), y: innerHeight }}
              stroke="var(--bp-text-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          )}

          {/* Y Axis with $0.000 format */}
          <AxisLeft
            scale={yScale}
            numTicks={5}
            stroke="var(--bp-border-subtle)"
            tickStroke="var(--bp-border-subtle)"
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 11,
              fontFamily: "var(--bp-font-mono)",
              textAnchor: "end" as const,
              dx: -4,
              dy: 3,
            })}
            tickFormat={(v) => formatPriceAxis(v as number)}
          />

          {/* X Axis */}
          <AxisBottom
            scale={xScale}
            top={innerHeight}
            numTicks={5}
            stroke="var(--bp-border-subtle)"
            tickStroke="var(--bp-border-subtle)"
            tickLabelProps={() => ({
              fill: "var(--bp-text-muted)",
              fontSize: 11,
              fontFamily: "var(--bp-font-mono)",
              textAnchor: "middle" as const,
              dy: 4,
            })}
            tickFormat={(v) => {
              const d = v as Date;
              return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            }}
          />

          {/* Invisible rect for capturing mouse events */}
          <Bar
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </g>
      </svg>

      {/* Tooltip */}
      {tooltipData && (
        <div
          className="absolute pointer-events-none z-20 rounded border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card)]/50 px-3 py-2 text-[10px] backdrop-blur-sm shadow-lg"
          style={{
            left: Math.min(tooltipLeft + 10, width - 150),
            top: Math.max(tooltipTop - 80, 10),
          }}
        >
          <div className="font-mono text-[var(--bp-text-muted)] mb-1.5 pb-1.5 border-b border-[var(--bp-border-subtle)]">
            {tooltipData.timestamp.toLocaleTimeString()}
          </div>
          <div className="space-y-1">
            {tooltipData.market !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-0.5 rounded" style={{ background: ORACLE_CONFIG.market.color }} />
                  <span style={{ color: ORACLE_CONFIG.market.color }}>Market</span>
                </span>
                <span className="font-mono font-medium text-[var(--bp-text-primary)]">
                  {formatPriceTooltip(tooltipData.market)}
                </span>
              </div>
            )}
            {tooltipData.defillama !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-0.5 rounded" style={{ background: ORACLE_CONFIG.defillama.color }} />
                  <span style={{ color: ORACLE_CONFIG.defillama.color }}>DefiLlama</span>
                </span>
                <span className="font-mono text-[var(--bp-text-secondary)]">
                  {formatPriceTooltip(tooltipData.defillama)}
                </span>
              </div>
            )}
            {tooltipData.coingecko !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-0.5 rounded" style={{ background: ORACLE_CONFIG.coingecko.color }} />
                  <span style={{ color: ORACLE_CONFIG.coingecko.color }}>CoinGecko</span>
                </span>
                <span className="font-mono text-[var(--bp-text-secondary)]">
                  {formatPriceTooltip(tooltipData.coingecko)}
                </span>
              </div>
            )}
            {tooltipData.pyth !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-0.5 rounded" style={{ background: ORACLE_CONFIG.pyth.color }} />
                  <span style={{ color: ORACLE_CONFIG.pyth.color }}>Pyth</span>
                </span>
                <span className="font-mono text-[var(--bp-text-secondary)]">
                  {formatPriceTooltip(tooltipData.pyth)}
                </span>
              </div>
            )}
            {tooltipData.dexTwap !== undefined && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-0.5 rounded" style={{ background: ORACLE_CONFIG.dexTwap.color }} />
                  <span style={{ color: ORACLE_CONFIG.dexTwap.color }}>DEX TWAP</span>
                </span>
                <span className="font-mono text-[var(--bp-text-secondary)]">
                  {formatPriceTooltip(tooltipData.dexTwap)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Legend component
const OracleLegend = ({ data }: { data: OraclePriceData }) => {
  const activeOracles = useMemo(() => {
    const oracles: { key: string; config: OracleLineConfig }[] = [];
    
    if (data.market.length > 0) oracles.push({ key: "market", config: ORACLE_CONFIG.market });
    if (data.defillama && data.defillama.length > 0) oracles.push({ key: "defillama", config: ORACLE_CONFIG.defillama });
    if (data.coingecko && data.coingecko.length > 0) oracles.push({ key: "coingecko", config: ORACLE_CONFIG.coingecko });
    if (data.pyth && data.pyth.length > 0) oracles.push({ key: "pyth", config: ORACLE_CONFIG.pyth });
    if (data.dexTwap && data.dexTwap.length > 0) oracles.push({ key: "dexTwap", config: ORACLE_CONFIG.dexTwap });
    
    return oracles;
  }, [data]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-3">
      {activeOracles.map(({ key, config }) => (
        <div key={key} className="flex items-center gap-2">
          <svg width="24" height="12">
            <line
              x1="0"
              y1="6"
              x2="24"
              y2="6"
              stroke={config.color}
              strokeWidth={config.strokeWidth}
              strokeDasharray={config.dashArray}
            />
          </svg>
          <span className="text-[10px] font-mono text-[var(--bp-text-muted)]">
            {config.label}
          </span>
        </div>
      ))}
    </div>
  );
};

// Main exported component
export const OraclePriceComparisonChart = ({
  data,
  pairLabel,
  className,
}: OraclePriceComparisonProps) => {
  return (
    <div className={cn("flex flex-col w-full h-full min-h-[200px]", className)}>
      <div className="flex-1 min-h-[160px] relative">
        <ParentSize debounceTime={50}>
          {({ width, height }) => (
            <OraclePriceChart
              data={data}
              width={width}
              height={Math.max(height, 160)}
              pairLabel={pairLabel}
            />
          )}
        </ParentSize>
      </div>
      <OracleLegend data={data} />
    </div>
  );
};

// Generate mock data for demonstration
export function generateMockOracleData(
  basePrice: number,
  points: number = 50,
  hoursBack: number = 24
): OraclePriceData {
  const now = Date.now();
  const msPerPoint = (hoursBack * 60 * 60 * 1000) / points;
  
  const generateLine = (volatility: number, lag: number = 0): OraclePricePoint[] => {
    const result: OraclePricePoint[] = [];
    let price = basePrice;
    
    for (let i = 0; i < points; i++) {
      const timestamp = new Date(now - (points - i - 1) * msPerPoint - lag);
      const change = (Math.random() - 0.5) * volatility * basePrice;
      price = price + change;
      // Keep price within reasonable bounds
      price = Math.max(basePrice * 0.95, Math.min(basePrice * 1.05, price));
      result.push({ timestamp, price });
    }
    
    return result;
  };

  return {
    market: generateLine(0.002),
    defillama: generateLine(0.002, 5000), // 5s lag
    coingecko: generateLine(0.0025, 30000), // 30s lag
    pyth: generateLine(0.0015, 1000), // 1s lag
    dexTwap: generateLine(0.003, 60000), // 60s lag
  };
}
