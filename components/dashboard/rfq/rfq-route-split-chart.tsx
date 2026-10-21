"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  sankey as d3Sankey,
  sankeyJustify,
  type SankeyNode,
  type SankeyLink,
} from "d3-sankey";
import type { RfqTierRow } from "@/hooks/use-rfq-data";
import type { SolanaPoolMetadata } from "@/lib/pools";
import {
  ChartCard,
  ChartHeader,
  ChartTitle,
  ChartContent,
} from "@/components/dashboard/chart-card";

// ─── Colors ──────────────────────────────────────────────────────────────────

const AMM_COLORS: Record<string, string> = {
  "Raydium CLMM": "#818cf8",
  Byreal: "#fbbf24",
  PancakeSwap: "#06b6d4",
  HumidiFi: "#a78bfa",
  Whirlpool: "#34d399",
  "SolFi V2": "#f472b6",
  TesseraV: "#fb923c",
  "Meteora DLMM": "#6ee7b7",
};

const FALLBACK_COLORS = [
  "#94a3b8",
  "#e879f9",
  "#38bdf8",
  "#fca5a5",
  "#86efac",
];

function getColor(label: string, idx: number): string {
  return AMM_COLORS[label] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

// ─── Token icon resolver ────────────────────────────────────────────────────

const KATANA_VB_ETH_ICON =
  "https://cdn.sushi.com/image/upload/f_auto,c_limit,w_96/d_unknown.png/native-currency/ethereum.svg";

function getTokenIconSrc(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s === "AI") return "https://assets.coingecko.com/coins/images/71027/standard/gensyn.png?1765331043";
  if (s === "STRCX") return "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234";
  if (s === "WLD") return "/icons/worldcoin-icon.svg";
  if (s === "EURC") return "/icons/eurc-icon.png";
  if (s === "VBETH" || s === "VBUSDC") return KATANA_VB_ETH_ICON;
  if (s.includes("USDC")) return "/icons/usdc-icon.svg";
  if (s === "WARS") return "https://coin-images.coingecko.com/coins/images/70846/large/world_logos_wars_logo_3.png?1764176749";
  if (s === "WBTC" || s === "BTC") return "https://token-icons.s3.amazonaws.com/btc.png";
  if (s === "WETH" || s === "ETH") return "https://token-icons.s3.amazonaws.com/eth.png";
  if (s === "MADS") return "/icons/mads-icon.png";
  const xstocks: Record<string, string> = {
    TSLAX: "TSLAx", NVDAX: "NVDAx", SPYX: "SPYx", QQQX: "QQQx",
    GLDX: "GLDx", GOOGLX: "GOOGLx", HOODX: "HOODx", CRCLX: "CRCLx",
    METAX: "METAx", COINX: "COINx", SPCXX: "SPCXx",
  };
  if (xstocks[s]) return `https://xstocks-metadata.backed.fi/logos/tokens/${xstocks[s]}.png`;
  return "/icons/usdc-icon.svg";
}

function formatTokenAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const TOKEN_COLORS: Record<string, string> = {
  USDC: "#2775CA",
  EURC: "#2f54eb",
  WLD: "#4d4dff",
  WBTC: "#f7931a",
  BTC: "#f7931a",
  ETH: "#627eea",
  WETH: "#627eea",
  WARS: "#e74c3c",
  MADS: "#ff6b6b",
};

function getTokenColor(symbol: string): string {
  const s = symbol.toUpperCase();
  if (TOKEN_COLORS[s]) return TOKEN_COLORS[s];
  // xStocks tokens
  if (s.endsWith("X") && s.length > 2) return "#cc0000";
  return "#94a3b8";
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface NodeExtra {
  id: string;
  color: string;
  displayLabel: string;
}

interface LinkExtra {
  sourceId: string;
  targetId: string;
  value: number;
}

type SNode = SankeyNode<NodeExtra, LinkExtra>;
type SLink = SankeyLink<NodeExtra, LinkExtra>;

// ─── Sankey SVG ──────────────────────────────────────────────────────────────

interface SankeyDiagramProps {
  tier: RfqTierRow;
  direction: "forward" | "reverse";
  allLabels: string[];
  inputSymbol: string;
  outputSymbol: string;
}

function SankeyDiagram({
  tier,
  direction,
  allLabels,
  inputSymbol,
  outputSymbol,
}: SankeyDiagramProps) {
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);

  const width = 1200;
  const height = 380;
  const margin = { top: 8, right: 200, bottom: 8, left: 170 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const inputIconSrc = getTokenIconSrc(inputSymbol);
  const outputIconSrc = getTokenIconSrc(outputSymbol);
  const inputColor = getTokenColor(inputSymbol);
  const outputColor = getTokenColor(outputSymbol);

  const { nodes, links } = useMemo(() => {
    const inputId = "__input__";
    const outputId = "__output__";

    // Aggregate duplicate AMM legs
    const ammMap = new Map<string, number>();
    for (const r of tier.routes) {
      ammMap.set(r.label, (ammMap.get(r.label) ?? 0) + r.percent);
    }
    const ammEntries = [...ammMap.entries()].sort((a, b) => b[1] - a[1]);

    const rawNodes: NodeExtra[] = [
      { id: inputId, color: inputColor, displayLabel: inputId },
      ...ammEntries.map(([label]) => ({
        id: label,
        color: getColor(label, allLabels.indexOf(label)),
        displayLabel: label,
      })),
      { id: outputId, color: outputColor, displayLabel: outputId },
    ];

    const rawLinks: LinkExtra[] = ammEntries.flatMap(([label, percent]) => [
      { sourceId: inputId, targetId: label, value: percent },
      { sourceId: label, targetId: outputId, value: percent },
    ]);

    const sankeyNodes = rawNodes.map((n) => ({ ...n }));
    const sankeyLinks = rawLinks.map((l) => ({
      ...l,
      source: l.sourceId,
      target: l.targetId,
    }));

    const generator = d3Sankey<NodeExtra, LinkExtra>()
      .nodeId((d: any) => d.id)
      .nodeWidth(14)
      .nodePadding(14)
      .nodeAlign(sankeyJustify)
      .extent([
        [0, 0],
        [innerW, innerH],
      ]);

    const graph = generator({
      nodes: sankeyNodes,
      links: sankeyLinks,
    });

    return { nodes: graph.nodes, links: graph.links };
  }, [tier, allLabels, innerW, innerH]);

  // Pair up Input→AMM and AMM→Output links into single continuous ribbons
  const mergedRibbons = useMemo(() => {
    const inLinks = links.filter(
      (l) => ((l.source as SNode).depth ?? 0) === 0
    );
    return inLinks.map((inLink) => {
      const ammNode = inLink.target as SNode;
      const outLink = links.find(
        (l) =>
          (l.source as SNode).id === ammNode.id &&
          ((l.source as SNode).depth ?? 0) === 1
      );
      return { inLink, outLink: outLink!, ammNode };
    });
  }, [links]);

  // Build a single filled ribbon from input to output, passing through the AMM
  function fullRibbonPath(inLink: SLink, outLink: SLink): string {
    const inputNode = inLink.source as SNode;
    const outputNode = outLink.target as SNode;
    const w = (inLink as any).width ?? 0;

    const x0 = inputNode.x1 ?? 0;
    const x3 = outputNode.x0 ?? 0;
    const sy = (inLink as any).y0 ?? 0;
    const ty = (outLink as any).y1 ?? 0;

    const ammNode = inLink.target as SNode;
    const xMidL = ammNode.x0 ?? 0;
    const xMidR = ammNode.x1 ?? 0;
    const my = (inLink as any).y1 ?? 0;

    const cpIn = (x0 + xMidL) / 2;
    const cpOut = (xMidR + x3) / 2;

    return [
      `M ${x0},${sy - w / 2}`,
      `C ${cpIn},${sy - w / 2} ${cpIn},${my - w / 2} ${xMidL},${my - w / 2}`,
      `L ${xMidR},${my - w / 2}`,
      `C ${cpOut},${my - w / 2} ${cpOut},${ty - w / 2} ${x3},${ty - w / 2}`,
      `L ${x3},${ty + w / 2}`,
      `C ${cpOut},${ty + w / 2} ${cpOut},${my + w / 2} ${xMidR},${my + w / 2}`,
      `L ${xMidL},${my + w / 2}`,
      `C ${cpIn},${my + w / 2} ${cpIn},${sy + w / 2} ${x0},${sy + w / 2}`,
      "Z",
    ].join(" ");
  }

  // Find input and output nodes for label positioning
  const inputNode = nodes.find((n) => (n as SNode).id === "__input__") as
    | SNode
    | undefined;
  const outputNode = nodes.find((n) => (n as SNode).id === "__output__") as
    | SNode
    | undefined;

  const inputAmount = direction === "forward" ? tier.tokensIn : tier.tokensIn;
  const outputAmount = tier.tokensOut;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="icon-clip-circle">
          <circle cx="24" cy="24" r="24" />
        </clipPath>
        {mergedRibbons.map(({ ammNode }, i) => (
          <linearGradient
            key={`grad-${i}`}
            id={`ribbon-grad-${i}`}
            x1="0" y1="0" x2="1" y2="0"
          >
            <stop offset="0%" stopColor={inputColor} />
            <stop offset="50%" stopColor={ammNode.color} />
            <stop offset="100%" stopColor={outputColor} />
          </linearGradient>
        ))}
      </defs>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Merged ribbons */}
        {mergedRibbons.map(({ inLink, outLink, ammNode }, i) => {
          const dimmed = hoveredLink !== null && hoveredLink !== i;
          return (
            <path
              key={ammNode.id}
              d={fullRibbonPath(inLink, outLink)}
              fill={`url(#ribbon-grad-${i})`}
              stroke="none"
              opacity={dimmed ? 0.06 : 0.35}
              className="transition-opacity duration-200"
              onMouseEnter={() => setHoveredLink(i)}
              onMouseLeave={() => setHoveredLink(null)}
              style={{ cursor: "pointer" }}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const n = node as SNode;
          const x0 = n.x0 ?? 0;
          const x1 = n.x1 ?? 0;
          const y0 = n.y0 ?? 0;
          const y1 = n.y1 ?? 0;
          const h = y1 - y0;
          const w = x1 - x0;
          const depth = n.depth ?? 0;
          const isLeft = depth === 0;
          const isMiddle = depth === 1;
          const isRight = depth === 2;

          return (
            <g key={n.id}>
              {/* Only render bars on the end nodes */}
              {!isMiddle && (
                <rect
                  x={x0}
                  y={y0}
                  width={w}
                  height={Math.max(h, 2)}
                  rx={3}
                  fill={n.color}
                  opacity={0.95}
                />
              )}

              {/* Middle AMM labels */}
              {isMiddle && (
                <>
                  <text
                    x={x0 + w / 2}
                    y={y0 + h / 2 - 7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={600}
                    fill={n.color}
                    className="select-none"
                  >
                    {n.displayLabel}
                  </text>
                  <text
                    x={x0 + w / 2}
                    y={y0 + h / 2 + 9}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={10}
                    fill="var(--bp-text-muted)"
                    className="select-none"
                  >
                    {(n.value ?? 0).toFixed(1)}% · {formatUsd(tier.notionalUsd * (n.value ?? 0) / 100)}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Left label: size + input icon */}
        {inputNode && (() => {
          const y0 = inputNode.y0 ?? 0;
          const y1 = inputNode.y1 ?? 0;
          const x0 = inputNode.x0 ?? 0;
          const cy = (y0 + y1) / 2;
          return (
            <g>
              <g transform={`translate(${x0 - 60},${cy - 24})`} clipPath="url(#icon-clip-circle)">
                <image
                  href={inputIconSrc}
                  x={0}
                  y={0}
                  width={48}
                  height={48}
                />
              </g>
              <text
                x={x0 - 76}
                y={cy - 4}
                textAnchor="end"
                dominantBaseline="auto"
                fontSize={30}
                fontWeight={700}
                fill="var(--bp-text-primary)"
                className="select-none"
              >
                {tier.label}
              </text>
              <text
                x={x0 - 76}
                y={cy + 8}
                textAnchor="end"
                dominantBaseline="hanging"
                fontSize={20}
                fill="var(--bp-text-muted)"
                className="select-none"
              >
                {inputSymbol}
              </text>
            </g>
          );
        })()}

        {/* Right label: output amount + token icon */}
        {outputNode && (() => {
          const y0 = outputNode.y0 ?? 0;
          const y1 = outputNode.y1 ?? 0;
          const x1 = outputNode.x1 ?? 0;
          const cy = (y0 + y1) / 2;
          return (
            <g>
              <g transform={`translate(${x1 + 16},${cy - 24})`} clipPath="url(#icon-clip-circle)">
                <image
                  href={outputIconSrc}
                  x={0}
                  y={0}
                  width={48}
                  height={48}
                />
              </g>
              <text
                x={x1 + 80}
                y={cy - 4}
                textAnchor="start"
                dominantBaseline="auto"
                fontSize={30}
                fontWeight={700}
                fill="var(--bp-text-primary)"
                className="select-none"
              >
                {formatTokenAmount(outputAmount)}
              </text>
              <text
                x={x1 + 80}
                y={cy + 8}
                textAnchor="start"
                dominantBaseline="hanging"
                fontSize={20}
                fill="var(--bp-text-muted)"
                className="select-none"
              >
                {outputSymbol}
              </text>
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface RfqRouteSplitChartProps {
  forwardTiers: RfqTierRow[];
  reverseTiers: RfqTierRow[];
  poolMeta: SolanaPoolMetadata;
}

export function RfqRouteSplitChart({
  forwardTiers,
  reverseTiers,
  poolMeta,
}: RfqRouteSplitChartProps) {
  const hasFwd = forwardTiers.length > 0;
  const hasRev = reverseTiers.length > 0;

  const defaultDir = hasFwd ? "forward" : "reverse";
  const [direction, setDirection] = useState<"forward" | "reverse">(defaultDir);

  const activeDir =
    direction === "forward" && !hasFwd
      ? "reverse"
      : direction === "reverse" && !hasRev
        ? "forward"
        : direction;
  const tiers = activeDir === "forward" ? forwardTiers : reverseTiers;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const tierIdx = Math.min(selectedIdx, Math.max(tiers.length - 1, 0));
  const tier = tiers[tierIdx];

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of [...forwardTiers, ...reverseTiers]) {
      for (const r of t.routes) set.add(r.label);
    }
    return [...set];
  }, [forwardTiers, reverseTiers]);

  // Determine input/output token symbols based on direction
  // forward = USDC → Token (token0), reverse = Token → USDC
  const inputSymbol =
    activeDir === "forward" ? poolMeta.token1Symbol : poolMeta.token0Symbol;
  const outputSymbol =
    activeDir === "forward" ? poolMeta.token0Symbol : poolMeta.token1Symbol;

  if (!tier) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Route Split</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="flex items-center justify-center h-64 text-sm text-[var(--bp-text-muted)]">
            No route data available
          </div>
        </ChartContent>
      </ChartCard>
    );
  }

  const poolCount = new Set(tier.routes.map((r) => r.label)).size;

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Route Split</ChartTitle>
      </ChartHeader>

      <ChartContent>
        {/* Size toggle pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {tiers.map((t, i) => (
            <button
              key={`${t.direction}-${t.notionalUsd}`}
              type="button"
              onClick={() => setSelectedIdx(i)}
              className={cn(
                "px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                tierIdx === i
                  ? "bg-[var(--bp-accent-primary)]/15 text-[var(--bp-accent-primary)] ring-1 ring-[var(--bp-accent-primary)]/30"
                  : "bg-[var(--bp-bg-surface)] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)]"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Route count subtitle */}
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-3">
          {tier.routeCount} route{tier.routeCount > 1 ? "s" : ""} — split
          across {poolCount} pool{poolCount > 1 ? "s" : ""}
        </p>

        {/* Direction indicator with token icons */}
        <button
          type="button"
          onClick={() => {
            if (hasFwd && hasRev) {
              setDirection((d) => (d === "forward" ? "reverse" : "forward"));
              setSelectedIdx(0);
            }
          }}
          className={cn(
            "flex items-center justify-center gap-2 mx-auto mb-3",
            hasFwd && hasRev
              ? "cursor-pointer hover:opacity-80"
              : "cursor-default"
          )}
        >
          <img
            src={getTokenIconSrc(inputSymbol)}
            alt={inputSymbol}
            className="w-5 h-5 rounded-full"
          />
          <span className="text-[11px] font-semibold text-[var(--bp-text-primary)]">
            {inputSymbol}
          </span>

          <div className="flex flex-col gap-px text-[var(--bp-text-muted)]">
            <svg width="14" height="7" viewBox="0 0 14 7" fill="none">
              <path d="M0 3.5h11m0 0l-3-3m3 3l-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg width="14" height="7" viewBox="0 0 14 7" fill="none">
              <path d="M14 3.5H3m0 0l3-3M3 3.5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <span className="text-[11px] font-semibold text-[var(--bp-text-primary)]">
            {outputSymbol}
          </span>
          <img
            src={getTokenIconSrc(outputSymbol)}
            alt={outputSymbol}
            className="w-5 h-5 rounded-full"
          />
        </button>

        {/* Sankey diagram */}
        <div className="w-full" style={{ height: 380 }}>
          {tier.routes.length > 0 ? (
            <SankeyDiagram
              tier={tier}
              direction={activeDir}
              allLabels={allLabels}
              inputSymbol={inputSymbol}
              outputSymbol={outputSymbol}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-[var(--bp-text-muted)]">
              No route legs for this tier
            </div>
          )}
        </div>
      </ChartContent>
    </ChartCard>
  );
}
