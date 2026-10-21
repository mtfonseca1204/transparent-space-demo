"use client";

import React, { useMemo, useState } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { Line } from "@visx/shape";
import ParentSize from "@visx/responsive/lib/components/ParentSize";

// Simple Point interface to replace @visx/point
interface Point {
  x: number;
  y: number;
}

export interface LPStrategyMetrics {
  positionSize: number;
  rangeWidth: number;
  timeInRange: number;
  capitalEfficiency: number;
  numPositions: number;
  rebalanceFrequency: number;
}

export interface LPStrategyRadarProps {
  metrics: LPStrategyMetrics | null;
  lpAddress?: string;
  isLoading?: boolean;
  poolAverageMetrics?: LPStrategyMetrics;
}

const METRIC_LABELS: Record<keyof LPStrategyMetrics, string> = {
  positionSize: "Size",
  rangeWidth: "Range",
  timeInRange: "In Range",
  capitalEfficiency: "Efficiency",
  numPositions: "Positions",
  rebalanceFrequency: "Activity",
};

const METRIC_DESCRIPTIONS: Record<keyof LPStrategyMetrics, string> = {
  positionSize: "USD value percentile vs other LPs in this pool",
  rangeWidth: "How concentrated vs other LPs (higher = narrower range)",
  timeInRange: "% of positions currently earning fees at current price",
  capitalEfficiency: "Concentration × in-range status score",
  numPositions: "Number of active positions vs other LPs",
  rebalanceFrequency: "Recent activity level vs other LPs (7 days)",
};

const METRIC_KEYS: (keyof LPStrategyMetrics)[] = [
  "positionSize",
  "rangeWidth",
  "timeInRange",
  "capitalEfficiency",
  "numPositions",
  "rebalanceFrequency",
];

const degrees = 360;

function polarToCartesian(angle: number, radius: number, center: Point): Point {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: center.x + radius * Math.cos(radians),
    y: center.y + radius * Math.sin(radians),
  };
}

interface TooltipData {
  label: string;
  value: number;
  description: string;
  x: number;
  y: number;
}

interface RadarChartInnerProps extends LPStrategyRadarProps {
  width: number;
  height: number;
}

const getValueColor = (value: number): string => {
  if (value >= 70) return "#10b981";
  if (value >= 40) return "#f59e0b";
  return "#6b7280";
};

const RadarChartInner: React.FC<RadarChartInnerProps> = ({
  metrics,
  lpAddress,
  isLoading,
  poolAverageMetrics,
  width,
  height,
}) => {
  const [hoveredMetric, setHoveredMetric] = useState<keyof LPStrategyMetrics | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Radar chart takes most of the space, metrics panel is compact
  const metricsWidth = 90;
  const chartWidth = width - metricsWidth;
  
  const margin = { top: 35, right: 45, bottom: 35, left: 45 };
  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const radius = Math.min(innerWidth, innerHeight) / 2;
  const center: Point = { x: innerWidth / 2, y: innerHeight / 2 };

  const numAxes = METRIC_KEYS.length;
  const angleSlice = degrees / numAxes;

  const radiusScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, 100],
        range: [0, radius],
      }),
    [radius]
  );

  const levels = [25, 50, 75, 100];

  const getPolygonPoints = (data: LPStrategyMetrics): string => {
    return METRIC_KEYS.map((key, i) => {
      const angle = i * angleSlice;
      const value = data[key];
      const point = polarToCartesian(angle, radiusScale(value), center);
      return `${point.x},${point.y}`;
    }).join(" ");
  };

  const handleMouseEnter = (
    event: React.MouseEvent<SVGElement | HTMLDivElement>,
    key: keyof LPStrategyMetrics
  ) => {
    setHoveredMetric(key);
    
    const containerRect = (event.currentTarget.closest('.radar-container') as HTMLElement)?.getBoundingClientRect();
    if (!containerRect || !metrics) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      label: METRIC_LABELS[key],
      value: metrics[key],
      description: METRIC_DESCRIPTIONS[key],
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top,
    });
  };

  const handleMouseLeave = () => {
    setHoveredMetric(null);
    setTooltip(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-[var(--bp-border-subtle)] border-t-[var(--bp-accent-primary)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--bp-text-muted)] px-4">
        <div className="w-12 h-12 mb-2 rounded-full bg-[var(--bp-bg-primary)]/50 flex items-center justify-center">
          <svg className="w-6 h-6 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" />
          </svg>
        </div>
        <span className="text-[10px] text-center opacity-60">Select an LP</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full radar-container flex overflow-hidden">
      {/* LP Address - positioned at absolute top */}
      {lpAddress && (
        <div className="absolute top-0 left-0 right-0 text-center z-10" style={{ right: metricsWidth }}>
          <span className="text-[9px] font-mono text-[var(--bp-accent-primary)]">
            {lpAddress.slice(0, 6)}...{lpAddress.slice(-4)}
          </span>
        </div>
      )}
      
      {/* Radar Chart - Main area */}
      <div className="flex-1 flex flex-col pt-3">
        <svg width={chartWidth} height={height - 12} className="flex-1">
          <Group left={margin.left} top={margin.top}>
            {/* Background hexagon levels - all clearly visible */}
            {levels.map((level) => {
              const points = METRIC_KEYS.map((_, i) => {
                const angle = i * angleSlice;
                const point = polarToCartesian(angle, radiusScale(level), center);
                return `${point.x},${point.y}`;
              }).join(" ");
              
              return (
                <polygon
                  key={level}
                  points={points}
                  fill="none"
                  stroke="var(--bp-text-muted)"
                  strokeOpacity={level === 100 ? 0.4 : 0.25}
                  strokeWidth={1}
                />
              );
            })}

            {/* Axis lines - clearly visible */}
            {METRIC_KEYS.map((key, i) => {
              const angle = i * angleSlice;
              const endPoint = polarToCartesian(angle, radius, center);
              const isHovered = hoveredMetric === key;
              return (
                <Line
                  key={`axis-${i}`}
                  from={center}
                  to={endPoint}
                  stroke={isHovered ? "var(--bp-accent-primary)" : "var(--bp-text-muted)"}
                  strokeOpacity={isHovered ? 0.8 : 0.3}
                  strokeWidth={1}
                />
              );
            })}

            {/* Pool average polygon */}
            {poolAverageMetrics && (
              <polygon
                points={getPolygonPoints(poolAverageMetrics)}
                fill="none"
                stroke="var(--bp-text-muted)"
                strokeOpacity={0.3}
                strokeWidth={1}
                strokeDasharray="2,2"
              />
            )}

            {/* LP data polygon */}
            <polygon
              points={getPolygonPoints(metrics)}
              fill="var(--bp-accent-primary)"
              fillOpacity={0.12}
              stroke="var(--bp-accent-primary)"
              strokeWidth={2}
            />

            {/* Data points */}
            {METRIC_KEYS.map((key, i) => {
              const angle = i * angleSlice;
              const value = metrics[key];
              const point = polarToCartesian(angle, radiusScale(value), center);
              const isHovered = hoveredMetric === key;
              return (
                <circle
                  key={`point-${i}`}
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? 4 : 3}
                  fill="var(--bp-accent-primary)"
                  stroke="var(--bp-bg-card)"
                  strokeWidth={2}
                  style={{ cursor: "pointer", transition: "all 0.1s ease" }}
                  onMouseEnter={(e) => handleMouseEnter(e, key)}
                  onMouseLeave={handleMouseLeave}
                />
              );
            })}

            {/* Labels around the hexagon */}
            {METRIC_KEYS.map((key, i) => {
              const angle = i * angleSlice;
              const labelRadius = radius + 16;
              const point = polarToCartesian(angle, labelRadius, center);
              const value = metrics[key];
              const isHovered = hoveredMetric === key;
              
              // Determine text anchor based on position
              let textAnchor: "start" | "middle" | "end" = "middle";
              let dy = 0;
              
              if (angle === 0) {
                textAnchor = "middle";
                dy = -4;
              } else if (angle === 60) {
                textAnchor = "start";
              } else if (angle === 120) {
                textAnchor = "start";
              } else if (angle === 180) {
                textAnchor = "middle";
                dy = 10;
              } else if (angle === 240) {
                textAnchor = "end";
              } else if (angle === 300) {
                textAnchor = "end";
              }
              
              return (
                <g 
                  key={`label-${i}`}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => handleMouseEnter(e, key)}
                  onMouseLeave={handleMouseLeave}
                >
                  <text
                    x={point.x}
                    y={point.y + dy}
                    textAnchor={textAnchor}
                    dominantBaseline="middle"
                    fontSize={8}
                    fontWeight={isHovered ? 600 : 500}
                    fill={isHovered ? "var(--bp-accent-primary)" : "var(--bp-text-muted)"}
                    style={{ transition: "all 0.1s ease" }}
                  >
                    {METRIC_LABELS[key]}
                  </text>
                  <text
                    x={point.x}
                    y={point.y + dy + 10}
                    textAnchor={textAnchor}
                    dominantBaseline="middle"
                    fontSize={9}
                    fontWeight={600}
                    fill={isHovered ? "var(--bp-accent-primary)" : "var(--bp-text-primary)"}
                    style={{ transition: "all 0.1s ease" }}
                  >
                    {value}%
                  </text>
                </g>
              );
            })}
          </Group>
        </svg>
      </div>

      {/* Compact Metrics Panel */}
      <div 
        className="flex flex-col justify-center border-l border-[var(--bp-border-subtle)]/30 pl-2"
        style={{ width: metricsWidth }}
      >
        <div className="space-y-1">
          {METRIC_KEYS.map((key) => {
            const value = metrics[key];
            const isHovered = hoveredMetric === key;
            return (
              <div
                key={key}
                className={`px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                  isHovered ? "bg-[var(--bp-accent-primary)]/8" : ""
                }`}
                onMouseEnter={(e) => handleMouseEnter(e, key)}
                onMouseLeave={handleMouseLeave}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] text-[var(--bp-text-muted)] truncate">
                    {METRIC_LABELS[key]}
                  </span>
                  <span 
                    className="text-[9px] font-semibold tabular-nums"
                    style={{ color: getValueColor(value) }}
                  >
                    {value}
                  </span>
                </div>
                <div className="h-[3px] rounded-full bg-[var(--bp-border-subtle)]/20 overflow-hidden mt-0.5">
                  <div 
                    className="h-full rounded-full transition-all duration-200"
                    style={{ 
                      width: `${value}%`,
                      backgroundColor: getValueColor(value),
                      opacity: isHovered ? 1 : 0.6,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div 
          className="absolute pointer-events-none z-50 bg-[var(--bp-bg-card)]/50 backdrop-blur-sm border border-[var(--bp-border-subtle)] rounded-md shadow-lg px-2.5 py-1.5"
          style={{
            left: Math.min(Math.max(tooltip.x, 80), width - metricsWidth - 80),
            top: Math.max(tooltip.y - 6, 20),
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[var(--bp-text-primary)]">{tooltip.label}</span>
              <span 
                className="text-[10px] font-bold"
                style={{ color: getValueColor(tooltip.value) }}
              >
                {tooltip.value}%
              </span>
            </div>
            <div className="text-[9px] text-[var(--bp-text-muted)] leading-tight max-w-[160px]">
              {tooltip.description}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const LPStrategyRadar: React.FC<LPStrategyRadarProps> = (props) => {
  return (
    <div className="relative w-full h-full">
      <ParentSize debounceTime={50}>
        {({ width, height }) => {
          const effectiveHeight = Math.max(height, 280);
          const effectiveWidth = Math.max(width, 280);
          return (
            <RadarChartInner
              {...props}
              width={effectiveWidth}
              height={effectiveHeight}
            />
          );
        }}
      </ParentSize>
    </div>
  );
};

export default LPStrategyRadar;
