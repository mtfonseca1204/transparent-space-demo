"use client";

import React, { useMemo, useRef, useState, useLayoutEffect } from "react";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveStepAfter, curveStepBefore } from "@visx/curve";
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

interface DepthPoint {
  price: number;
  cumulativeUsd: number;
}

interface RfqOrderbookDepthChartProps {
  forwardTiers: RfqTierRow[];
  reverseTiers: RfqTierRow[];
}

const formatCompact = (value: number): string => {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

/**
 * Compute the effective token price for a tier.
 *
 * Forward (buy token with USDC):
 *   tokensIn = USDC amount, tokensOut = token amount
 *   price = USDC / tokens = tokensIn / tokensOut
 *
 * Reverse (sell token for USDC):
 *   tokensIn = token amount, tokensOut = USDC amount
 *   price = USDC / tokens = tokensOut / tokensIn
 */
function effectiveTokenPrice(tier: RfqTierRow): number {
  if (tier.direction === "forward") {
    return tier.tokensOut > 0 ? tier.tokensIn / tier.tokensOut : 0;
  }
  // reverse: tokensOut is USDC, tokensIn is tokens
  return tier.tokensIn > 0 ? tier.tokensOut / tier.tokensIn : 0;
}

export function RfqOrderbookDepthChart({
  forwardTiers,
  reverseTiers,
}: RfqOrderbookDepthChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverInfo, setHoverInfo] = useState<{
    side: "bid" | "ask";
    idx: number;
  } | null>(null);

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

  // Build bid and ask depth points
  //
  // Bids (green, LEFT) = reverse tiers (selling tokens for USDC)
  //   The price you RECEIVE per token decreases with larger size
  //   Best bid (highest price) near mid, worst bid (lowest) far left
  //   Sorted descending: highest price first → lowest price last
  //
  // Asks (red, RIGHT) = forward tiers (buying tokens with USDC)
  //   The price you PAY per token increases with larger size
  //   Best ask (lowest price) near mid, worst ask (highest) far right
  //   Sorted ascending: lowest price first → highest price last
  const { bidPoints, askPoints, midPrice } = useMemo(() => {
    if (forwardTiers.length === 0 && reverseTiers.length === 0) {
      return { bidPoints: [], askPoints: [], midPrice: 0 };
    }

    // Bids = reverse tiers (sell side, LEFT)
    // Price decreases with size, sorted descending (best bid near mid, worst far left)
    const bids: DepthPoint[] = reverseTiers
      .map((t) => ({
        price: effectiveTokenPrice(t),
        cumulativeUsd: t.notionalUsd,
      }))
      .filter((p) => p.price > 0)
      .sort((a, b) => b.price - a.price);

    // Asks = forward tiers (buy side, RIGHT)
    // Price increases with size, sorted ascending (best ask near mid, worst far right)
    const asks: DepthPoint[] = forwardTiers
      .map((t) => ({
        price: effectiveTokenPrice(t),
        cumulativeUsd: t.notionalUsd,
      }))
      .filter((p) => p.price > 0)
      .sort((a, b) => a.price - b.price);

    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 0;
    const mid =
      bestBid > 0 && bestAsk > 0
        ? (bestBid + bestAsk) / 2
        : bestBid || bestAsk;

    // Compute x-domain edges so we can extend steps to the chart boundary
    const allPrices = [...bids.map((p) => p.price), ...asks.map((p) => p.price)];
    const priceMin = allPrices.length > 0 ? Math.min(...allPrices) : 0;
    const priceMax = allPrices.length > 0 ? Math.max(...allPrices) : 1;
    const priceRange = priceMax - priceMin;
    const edgePad = priceRange * 0.08 || 1;

    // Bids: zero-anchor at best bid (near mid), data descending, extend to left edge
    const bidWithEdges: DepthPoint[] =
      bids.length > 0
        ? [
            { price: bids[0].price, cumulativeUsd: 0 },
            ...bids,
            { price: priceMin - edgePad, cumulativeUsd: bids[bids.length - 1].cumulativeUsd },
          ]
        : [];

    // Asks: zero-anchor at best ask (near mid), data ascending, extend to right edge
    const askWithEdges: DepthPoint[] =
      asks.length > 0
        ? [
            { price: asks[0].price, cumulativeUsd: 0 },
            ...asks,
            { price: priceMax + edgePad, cumulativeUsd: asks[asks.length - 1].cumulativeUsd },
          ]
        : [];

    return {
      bidPoints: bidWithEdges,
      askPoints: askWithEdges,
      midPrice: mid,
    };
  }, [forwardTiers, reverseTiers]);

  const { width, height } = dimensions;
  const margin = { top: 20, right: 20, bottom: 44, left: 64 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const xDomain = useMemo(() => {
    const allPrices = [
      ...bidPoints.map((p) => p.price),
      ...askPoints.map((p) => p.price),
    ];
    if (allPrices.length === 0) return [0, 1];
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    return [min, max];
  }, [bidPoints, askPoints]);

  const yMax = useMemo(() => {
    const allVals = [
      ...bidPoints.map((p) => p.cumulativeUsd),
      ...askPoints.map((p) => p.cumulativeUsd),
    ];
    return Math.max(...allVals, 1) * 1.1;
  }, [bidPoints, askPoints]);

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
        domain: [0, yMax],
        range: [innerH, 0],
        nice: true,
      }),
    [yMax, innerH]
  );

  const hoverPoint = useMemo(() => {
    if (!hoverInfo) return null;
    const points = hoverInfo.side === "bid" ? bidPoints : askPoints;
    // +1 offset to skip the zero-anchor point
    return points[hoverInfo.idx + 1] ?? null;
  }, [hoverInfo, bidPoints, askPoints]);

  if (bidPoints.length <= 1 && askPoints.length <= 1) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Orderbook Depth</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <p className="text-[11px] text-[var(--bp-text-muted)] text-center py-12">
            No depth data available
          </p>
        </ChartContent>
      </ChartCard>
    );
  }

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Orderbook Depth</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Cumulative liquidity at each price level — bids (buy) on left,
          asks (sell) on right
        </p>
        <div ref={containerRef} className="w-full h-[380px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <defs>
                <linearGradient
                  id="ob-bid-gradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient
                  id="ob-ask-gradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
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

                {/* Mid price line */}
                {midPrice > 0 && (
                  <>
                    <line
                      x1={xScale(midPrice)}
                      x2={xScale(midPrice)}
                      y1={0}
                      y2={innerH}
                      stroke="var(--bp-text-muted)"
                      strokeWidth={1}
                      strokeDasharray="4,4"
                      opacity={0.5}
                    />
                    <text
                      x={xScale(midPrice)}
                      y={-6}
                      textAnchor="middle"
                      fill="var(--bp-text-muted)"
                      fontSize={10}
                      fontFamily="inherit"
                    >
                      Mid ${midPrice.toFixed(2)}
                    </text>
                  </>
                )}

                {/* Bid area (green, LEFT — sell prices decrease outward) */}
                {bidPoints.length > 1 && (
                  <>
                    <AreaClosed
                      data={bidPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      yScale={yScale}
                      curve={curveStepBefore}
                      fill="url(#ob-bid-gradient)"
                    />
                    <LinePath
                      data={bidPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      curve={curveStepBefore}
                      stroke="#22c55e"
                      strokeWidth={2}
                    />
                  </>
                )}

                {/* Ask area (red, RIGHT — buy prices increase outward) */}
                {askPoints.length > 1 && (
                  <>
                    <AreaClosed
                      data={askPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      yScale={yScale}
                      curve={curveStepAfter}
                      fill="url(#ob-ask-gradient)"
                    />
                    <LinePath
                      data={askPoints}
                      x={(d) => xScale(d.price)}
                      y={(d) => yScale(d.cumulativeUsd)}
                      curve={curveStepAfter}
                      stroke="#ef4444"
                      strokeWidth={2}
                    />
                  </>
                )}

                {/* Bid dots (skip zero-anchor at start and edge-extension at end) */}
                {bidPoints.slice(1, -1).map((pt, i) => (
                  <circle
                    key={`bid-${i}`}
                    cx={xScale(pt.price)}
                    cy={yScale(pt.cumulativeUsd)}
                    r={
                      hoverInfo?.side === "bid" && hoverInfo.idx === i ? 6 : 4
                    }
                    fill="#22c55e"
                    stroke="var(--bp-bg-primary)"
                    strokeWidth={2}
                    onMouseEnter={() => setHoverInfo({ side: "bid", idx: i })}
                    onMouseLeave={() => setHoverInfo(null)}
                    style={{ cursor: "pointer" }}
                  />
                ))}

                {/* Ask dots (skip zero-anchor at start and edge-extension at end) */}
                {askPoints.slice(1, -1).map((pt, i) => (
                  <circle
                    key={`ask-${i}`}
                    cx={xScale(pt.price)}
                    cy={yScale(pt.cumulativeUsd)}
                    r={
                      hoverInfo?.side === "ask" && hoverInfo.idx === i ? 6 : 4
                    }
                    fill="#ef4444"
                    stroke="var(--bp-bg-primary)"
                    strokeWidth={2}
                    onMouseEnter={() => setHoverInfo({ side: "ask", idx: i })}
                    onMouseLeave={() => setHoverInfo(null)}
                    style={{ cursor: "pointer" }}
                  />
                ))}

                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  numTicks={7}
                  tickFormat={(v) => `$${Number(v).toFixed(0)}`}
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
                  tickFormat={(v) => formatCompact(Number(v))}
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
          {hoverPoint && hoverInfo && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left: margin.left + xScale(hoverPoint.price),
                top: margin.top + yScale(hoverPoint.cumulativeUsd) - 8,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold">
                {formatCompact(hoverPoint.cumulativeUsd)}
              </div>
              <div
                className={
                  hoverInfo.side === "bid"
                    ? "text-emerald-500"
                    : "text-red-500"
                }
              >
                {hoverInfo.side === "bid" ? "Bid" : "Ask"} @{" "}
                ${hoverPoint.price.toFixed(2)}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex gap-6 justify-center mt-2">
          <span className="text-[10px] text-emerald-500 flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-emerald-500 rounded" />
            Bids (Buy)
          </span>
          <span className="text-[10px] text-red-500 flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-red-500 rounded" />
            Asks (Sell)
          </span>
          <span className="text-[10px] text-[var(--bp-text-muted)] flex items-center gap-1.5">
            <span className="inline-block w-3 h-0 border-t border-dashed border-[var(--bp-text-muted)]" />
            Mid Price
          </span>
        </div>
      </ChartContent>
    </ChartCard>
  );
}
