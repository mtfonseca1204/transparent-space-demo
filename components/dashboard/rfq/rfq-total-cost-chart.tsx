"use client";

import React, { useMemo, useRef, useState, useLayoutEffect } from "react";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
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

interface RfqTotalCostChartProps {
  forwardTiers: RfqTierRow[];
  reverseTiers: RfqTierRow[];
}

export function RfqTotalCostChart({
  forwardTiers,
  reverseTiers,
}: RfqTotalCostChartProps) {
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
  const margin = { top: 16, right: 16, bottom: 40, left: 56 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: tiers.map((t) => t.label),
        range: [0, innerW],
        padding: 0.35,
      }),
    [tiers, innerW]
  );

  const yMax = useMemo(() => {
    let max = 0;
    for (const t of tiers) {
      if (t.totalCostBps > max) max = t.totalCostBps;
    }
    return max * 1.2 || 1;
  }, [tiers]);

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Total Execution Cost Breakdown</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <div ref={containerRef} className="w-full h-[320px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={5}
                />

                {tiers.map((tier, i) => {
                  const x = xScale(tier.label) ?? 0;
                  const barWidth = xScale.bandwidth();

                  // Fee segment (bottom)
                  const feeH = innerH - yScale(tier.feeBps);
                  const feeY = innerH - feeH;

                  // Impact segment (stacked on top of fee)
                  const impactH = innerH - yScale(tier.priceImpactBps);
                  const impactY = feeY - impactH;

                  return (
                    <g
                      key={tier.label}
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                    >
                      {/* Fee segment */}
                      <Bar
                        x={x}
                        y={feeY}
                        width={barWidth}
                        height={Math.max(0, feeH)}
                        fill="#818cf8"
                        opacity={hoverIdx === i ? 0.9 : 0.6}
                      />
                      {/* Impact segment */}
                      <Bar
                        x={x}
                        y={Math.max(0, impactY)}
                        width={barWidth}
                        height={Math.max(0, impactH)}
                        fill="#22c55e"
                        opacity={hoverIdx === i ? 1 : 0.85}
                        rx={4}
                      />
                    </g>
                  );
                })}

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
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
                  tickFormat={(v) => `${Number(v).toFixed(0)} bps`}
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
                  margin.left +
                  (xScale(tiers[hoverIdx].label) ?? 0) +
                  xScale.bandwidth() / 2,
                top:
                  margin.top +
                  yScale(tiers[hoverIdx].totalCostBps) -
                  8,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold">
                {tiers[hoverIdx].totalCostBps.toFixed(2)} bps total
              </div>
              <div className="text-emerald-500">
                Impact: {tiers[hoverIdx].priceImpactBps.toFixed(2)} bps
              </div>
              <div className="text-indigo-400">
                Fee: {tiers[hoverIdx].feeBps.toFixed(1)} bps
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-4 justify-center mt-2">
          <span className="text-[10px] text-emerald-500 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
            Price Impact
          </span>
          <span className="text-[10px] text-indigo-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-indigo-400" />
            Platform Fee
          </span>
        </div>
      </ChartContent>
    </ChartCard>
  );
}
