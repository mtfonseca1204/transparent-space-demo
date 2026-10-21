"use client";

import React, { useMemo, useRef, useState, useLayoutEffect } from "react";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import type { RfqTierRow } from "@/hooks/use-rfq-data";
import {
  ChartCard,
  ChartHeader,
  ChartTitle,
  ChartContent,
} from "@/components/dashboard/chart-card";

const formatCompact = (value: number): string => {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

interface RfqDepthCurveChartProps {
  forwardTiers: RfqTierRow[];
  reverseTiers: RfqTierRow[];
}

export function RfqDepthCurveChart({
  forwardTiers,
  reverseTiers,
}: RfqDepthCurveChartProps) {
  const tiers = forwardTiers.length > 0 ? forwardTiers : reverseTiers;

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
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

  const { width, height } = dimensions;
  const margin = { top: 16, right: 16, bottom: 40, left: 64 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xDomain = useMemo(() => {
    if (tiers.length === 0) return [0, 1];
    const min = Math.min(...tiers.map((t) => t.notionalUsd));
    const max = Math.max(...tiers.map((t) => t.notionalUsd));
    return [min * 0.8, max * 1.1];
  }, [tiers]);

  const yDomain = useMemo(() => {
    if (tiers.length === 0) return [0, 1];
    const prices = tiers.map((t) => t.impliedTokenPrice).filter((p) => p > 0);
    if (prices.length === 0) return [0, 1];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.15 || 0.001;
    return [min - pad, max + pad];
  }, [tiers]);

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: xDomain,
        range: [0, innerW],
      }),
    [xDomain, innerW]
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: yDomain,
        range: [innerH, 0],
        nice: true,
      }),
    [yDomain, innerH]
  );

  const gradientId = "rfq-depth-gradient";

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Implied Token Price vs. Trade Size</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Effective price per token as order size increases — flatter = deeper
          liquidity
        </p>
        <div ref={containerRef} className="w-full h-[320px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>

              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={5}
                />

                {/* Area fill */}
                <AreaClosed
                  data={tiers}
                  x={(d) => xScale(d.notionalUsd)}
                  y={(d) => yScale(d.impliedTokenPrice)}
                  yScale={yScale}
                  curve={curveMonotoneX}
                  fill={`url(#${gradientId})`}
                />

                {/* Line */}
                <LinePath
                  data={tiers}
                  x={(d) => xScale(d.notionalUsd)}
                  y={(d) => yScale(d.impliedTokenPrice)}
                  curve={curveMonotoneX}
                  stroke="#3b82f6"
                  strokeWidth={2}
                />

                {/* Dots */}
                {tiers.map((tier, i) => (
                  <circle
                    key={i}
                    cx={xScale(tier.notionalUsd)}
                    cy={yScale(tier.impliedTokenPrice)}
                    r={hoverIdx === i ? 6 : 4}
                    fill="#3b82f6"
                    stroke="var(--bp-bg-primary)"
                    strokeWidth={2}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                    style={{ cursor: "pointer" }}
                  />
                ))}

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  numTicks={tiers.length}
                  tickFormat={(v) => formatCompact(Number(v))}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 11,
                    fontFamily: "inherit",
                    textAnchor: "middle",
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  stroke="transparent"
                  tickStroke="transparent"
                  numTicks={5}
                  tickFormat={(v) => `$${Number(v).toFixed(3)}`}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "end",
                    dx: -4,
                  }}
                />
              </Group>
            </svg>
          )}

          {/* Tooltip */}
          {hoverIdx !== null && tiers[hoverIdx] && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left:
                  margin.left + xScale(tiers[hoverIdx].notionalUsd),
                top:
                  margin.top +
                  yScale(tiers[hoverIdx].impliedTokenPrice) -
                  8,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold">
                ${tiers[hoverIdx].impliedTokenPrice.toFixed(4)}
              </div>
              <div className="text-[var(--bp-text-muted)]">
                {tiers[hoverIdx].label} trade
              </div>
            </div>
          )}
        </div>
      </ChartContent>
    </ChartCard>
  );
}
