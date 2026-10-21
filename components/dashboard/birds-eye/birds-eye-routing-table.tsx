"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBirdsEyeRouting,
  type AssetRouting,
} from "@/hooks/use-birds-eye-routing";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import {
  ROUTING_ORDER_SIZES_USD,
  type RoutingOrderSize,
} from "@/lib/routing-engine";
import { getDemoTokenLogo } from "@/lib/demo/logos";

// ─── Constants ──────────────────────────────────────────────────────────────

const SIZE_SAMPLES: readonly RoutingOrderSize[] = ROUTING_ORDER_SIZES_USD;

const VB_W = 800;
const VB_H = 290;
const M_L = 56;
const M_R = 56;
const M_T = 8;
const M_B = 50;
const PLOT_W = VB_W - M_L - M_R;
const PLOT_H = VB_H - M_T - M_B;
const LOG_MIN = Math.log10(1000);
const LOG_MAX = Math.log10(100_000);
const DEFAULT_DISPLAY_USD = 10_000;
const DEFAULT_IMPACT_MAX = 10;
const Y_GRID = [0, 25, 50, 75, 100] as const;
const X_TICKS = [1000, 5000, 10000, 25000, 50000, 100000] as const;

const POOL_COLORS = [
  "#2B5F8C",
  "#B47352",
  "#5E8868",
  "#8B6FB0",
  "#C49A4F",
  "#4A8788",
  "#B66A82",
  "#7A8045",
];

// ─── Adapt routing data into chart-friendly shape ───────────────────────────

interface ChartAsset {
  sym: string;
  pools: number;
  buys: number[];
  sells: number[];
  poolNames: string[];
  poolFees: string[];
  /** routing[size_idx][pool_idx] = share %. Sums to 100 unless capacity exceeded. */
  routing: number[][];
  capacityExceeded: boolean[];
  /** Right-axis upper bound for impact %, derived from this asset's max impact. */
  impactMax: number;
}

interface ChartGeometry {
  bands: { d: string; color: string }[];
  buyPath: string;
  sellPath: string;
  ribbonPath: string;
}

function chooseImpactMax(buys: number[], sells: number[]): number {
  let max = 0;
  for (const v of buys) if (Number.isFinite(v) && v > max) max = v;
  for (const v of sells) if (Number.isFinite(v) && v > max) max = v;
  // Prefer 10% as the default scale; step up only when actual data exceeds it.
  if (max <= DEFAULT_IMPACT_MAX) return DEFAULT_IMPACT_MAX;
  if (max <= 25) return 25;
  if (max <= 50) return 50;
  if (max <= 100) return 100;
  return Math.ceil(max / 100) * 100;
}

function chooseImpactTicks(max: number): number[] {
  if (max <= 10) return [0.5, 1, 2, 5, 10];
  if (max <= 25) return [1, 2, 5, 10, 25];
  if (max <= 50) return [1, 5, 10, 25, 50];
  if (max <= 100) return [1, 5, 10, 25, 50, 100];
  return [1, 10, 50, 100, 500].filter((t) => t <= max).concat(max);
}

/**
 * Resolve a token icon URL. Mirrors the lookup in `TokenIcon`
 * (components/dashboard/pool-header.tsx) but renders a plain <img> so we
 * don't inherit the `.ts-coin` global rules (`position: absolute`, `38px`)
 * which would escape and stretch the parent flex layout.
 */
const KATANA_VB_ETH_ICON =
  "https://cdn.sushi.com/image/upload/f_auto,c_limit,w_96/d_unknown.png/native-currency/ethereum.svg";
const DUST_ICON =
  "https://cdn.dexscreener.com/cms/images/a7efe29afe139ac03be1028f0a76ec91169a6961bbda55b70060a8692ba7d09e?width=64&height=64&fit=crop&quality=95&format=auto";
const W0G_ICON =
  "https://storage.googleapis.com/merkl-static-assets/tokens/w0G.svg";
const BSC_0G_ICON =
  "https://tokens.pancakeswap.finance/images/0x4B948d64dE1F71fCd12fB586f4c776421a35b3eE.png";

const XSTOCKS_TOKENS: Record<string, string> = {
  TSLAX: "TSLAx",
  NVDAX: "NVDAx",
  SPYX: "SPYx",
  QQQX: "QQQx",
  GLDX: "GLDx",
  GOOGLX: "GOOGLx",
  HOODX: "HOODx",
  CRCLX: "CRCLx",
  METAX: "METAx",
  COINX: "COINx",
  SPCXX: "SPCXx",
};

function tokenIconUrl(symbol: string): string {
  const s = (symbol || "").toUpperCase();
  const demoLogo = getDemoTokenLogo(s);
  if (demoLogo) return demoLogo;
  if (s === "AI") return "https://assets.coingecko.com/coins/images/71027/standard/gensyn.png?1765331043";
  if (s === "STRCX") return "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234";
  if (s === "PRL") return "/icons/perle-logo.webp";
  if (s === "WLD") return "/icons/worldcoin-icon.svg";
  if (s === "EURC") return "/icons/eurc-icon.png";
  if (s === "OXAUT") return "/icons/oxaut-icon.png";
  if (s === "DUST") return DUST_ICON;
  if (s === "W0G") return W0G_ICON;
  if (s === "0G") return BSC_0G_ICON;
  if (s === "VBETH" || s === "VBUSDC") return KATANA_VB_ETH_ICON;
  if (s.includes("USDT")) return "/icons/usdt-icon.svg";
  if (s.includes("USDC")) return "/icons/usdc-icon.svg";
  if (s === "WBTC" || s === "BTC") return "https://token-icons.s3.amazonaws.com/btc.png";
  if (s === "WETH" || s === "ETH") return "https://token-icons.s3.amazonaws.com/eth.png";
  if (s === "MADS") return "/icons/mads-icon.png";
  const xs = XSTOCKS_TOKENS[s];
  if (xs) return `https://xstocks-metadata.backed.fi/logos/tokens/${xs}.png`;
  return "/icons/usdc-icon.svg";
}

/**
 * Resolve the human-readable venue name from a pool's `SupportedPool.key`,
 * falling back to its `protocol` field. Byreal pools share Raydium's
 * `protocol: "raydium"` but use a `byreal-…` key — the key takes priority.
 */
function venueName(key: string, protocol: string): string {
  const k = (key || "").toLowerCase();
  if (k.startsWith("pancake-infinity-")) return "Pancake Infinity";
  if (k.startsWith("byreal-")) return "Byreal";
  if (k.startsWith("raydium-")) return "Raydium";
  if (k.startsWith("meteora-")) return "Meteora";
  const p = (protocol || "").toLowerCase();
  if (p === "raydium") return "Raydium";
  if (p === "byreal") return "Byreal";
  if (p === "meteora") return "Meteora";
  if (p === "v3") return "Uniswap V3";
  if (p === "v4") return "Uniswap V4";
  return protocol || "Pool";
}

function adaptAsset(a: AssetRouting, sizes: readonly RoutingOrderSize[]): ChartAsset | null {
  const poolMeta = new Map<
    string,
    { key: string; protocol: string; feeTier: string; total: number }
  >();
  for (const size of sizes) {
    const r = a.bySize.get(size);
    if (!r) continue;
    for (const alloc of [...r.buy.allocations, ...r.sell.allocations]) {
      const m = poolMeta.get(alloc.poolKey) ?? {
        key: alloc.key,
        protocol: alloc.venue,
        feeTier: alloc.feeTier,
        total: 0,
      };
      m.total += alloc.inputUsd;
      poolMeta.set(alloc.poolKey, m);
    }
  }
  if (poolMeta.size === 0) return null;

  const orderedKeys = [...poolMeta.entries()]
    .sort((x, y) => y[1].total - x[1].total)
    .map(([k]) => k);

  const baseNames = orderedKeys.map((k) => {
    const m = poolMeta.get(k)!;
    return `${venueName(m.key, m.protocol)} ${m.feeTier}`;
  });
  const counts = new Map<string, number>();
  baseNames.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  const seen = new Map<string, number>();
  const poolNames = baseNames.map((n) => {
    if ((counts.get(n) ?? 0) <= 1) return n;
    const seenCount = (seen.get(n) ?? 0) + 1;
    seen.set(n, seenCount);
    return seenCount === 1 ? n : `${n}·v${seenCount}`;
  });
  const poolFees = orderedKeys.map((k) => poolMeta.get(k)!.feeTier);

  const buys: number[] = [];
  const sells: number[] = [];
  const routing: number[][] = [];
  const capacityExceeded: boolean[] = [];
  for (const size of sizes) {
    const r = a.bySize.get(size);
    if (!r) {
      buys.push(0);
      sells.push(0);
      routing.push(orderedKeys.map(() => 0));
      capacityExceeded.push(true);
      continue;
    }
    buys.push(Number.isFinite(r.buy.effectiveImpactPct) ? r.buy.effectiveImpactPct : 0);
    sells.push(Number.isFinite(r.sell.effectiveImpactPct) ? r.sell.effectiveImpactPct : 0);
    capacityExceeded.push(r.buy.capacityExceeded || r.sell.capacityExceeded);

    const allocByKey = new Map<string, number>();
    for (const alloc of r.buy.allocations) {
      allocByKey.set(alloc.poolKey, alloc.sharePct);
    }
    const totalShare = [...allocByKey.values()].reduce((s, v) => s + v, 0);
    const row = orderedKeys.map((k) => allocByKey.get(k) ?? 0);
    if (totalShare > 0) {
      const factor = 100 / totalShare;
      for (let i = 0; i < row.length; i++) row[i] *= factor;
    }
    routing.push(row);
  }

  return {
    sym: a.asset,
    pools: orderedKeys.length,
    buys,
    sells,
    poolNames,
    poolFees,
    routing,
    capacityExceeded,
    impactMax: chooseImpactMax(buys, sells),
  };
}

// ─── Scales & helpers ───────────────────────────────────────────────────────

function xOfLog(logX: number): number {
  return M_L + ((logX - LOG_MIN) / (LOG_MAX - LOG_MIN)) * PLOT_W;
}
function xOfSize(usd: number): number {
  return xOfLog(Math.log10(usd));
}
function xToSize(x: number): number {
  const t = (x - M_L) / PLOT_W;
  return Math.pow(10, LOG_MIN + t * (LOG_MAX - LOG_MIN));
}
function yOfRouting(pct: number): number {
  return M_T + PLOT_H - (pct / 100) * PLOT_H;
}
function yOfImpact(pct: number, impactMax: number): number {
  const safe = Number.isFinite(pct) && pct > 0 ? pct : 0;
  const norm = Math.sqrt(Math.min(safe, impactMax) / impactMax);
  return M_T + PLOT_H - norm * PLOT_H;
}
function fmtSize(usd: number): { px: string; n: string; un: string } {
  if (usd >= 1_000_000) {
    return {
      px: "$",
      n: (usd / 1_000_000).toFixed(2).replace(/\.?0+$/, ""),
      un: "M",
    };
  }
  if (usd >= 1000) {
    const k = usd / 1000;
    if (k >= 100) return { px: "$", n: Math.round(k).toString(), un: "K" };
    if (k >= 10) return { px: "$", n: k.toFixed(0), un: "K" };
    return { px: "$", n: k.toFixed(1).replace(/\.0$/, ""), un: "K" };
  }
  return { px: "$", n: Math.round(usd).toString(), un: "" };
}
function fmtUSD(usd: number): string {
  const f = fmtSize(usd);
  return f.px + f.n + f.un;
}
function impactState(pct: number): "good" | "warn" | "bad" {
  if (!Number.isFinite(pct)) return "bad";
  if (pct < 0.2) return "good";
  if (pct < 1.0) return "warn";
  return "bad";
}
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const k = 0.35;
  const r = (n: number) => n.toFixed(2);
  let d = `M ${r(pts[0][0])},${r(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * k * 0.45;
    const cp1y = p1[1] + (p2[1] - p0[1]) * k * 0.45;
    const cp2x = p2[0] - (p3[0] - p1[0]) * k * 0.45;
    const cp2y = p2[1] - (p3[1] - p1[1]) * k * 0.45;
    d += ` C ${r(cp1x)},${r(cp1y)} ${r(cp2x)},${r(cp2y)} ${r(p2[0])},${r(p2[1])}`;
  }
  return d;
}

interface Interp {
  routing: number[];
  buy: number;
  sell: number;
}

function interpolate(asset: ChartAsset, logX: number): Interp {
  const sampleLogs = SIZE_SAMPLES.map((s) => Math.log10(s));
  const last = SIZE_SAMPLES.length - 1;
  if (logX <= sampleLogs[0]) {
    return {
      routing: asset.routing[0].slice(),
      buy: asset.buys[0],
      sell: asset.sells[0],
    };
  }
  if (logX >= sampleLogs[last]) {
    const dx = logX - sampleLogs[last];
    const dxLast = sampleLogs[last] - sampleLogs[last - 1];
    const buySlope = (asset.buys[last] - asset.buys[last - 1]) / dxLast;
    const sellSlope = (asset.sells[last] - asset.sells[last - 1]) / dxLast;
    return {
      routing: asset.routing[last].slice(),
      buy: asset.buys[last] + buySlope * dx,
      sell: asset.sells[last] + sellSlope * dx,
    };
  }
  for (let i = 0; i < last; i++) {
    if (logX >= sampleLogs[i] && logX <= sampleLogs[i + 1]) {
      const t = (logX - sampleLogs[i]) / (sampleLogs[i + 1] - sampleLogs[i]);
      const ra = asset.routing[i];
      const rb = asset.routing[i + 1];
      const routing = ra.map((v, k) => v * (1 - t) + (rb[k] ?? 0) * t);
      const buy = asset.buys[i] * (1 - t) + asset.buys[i + 1] * t;
      const sell = asset.sells[i] * (1 - t) + asset.sells[i + 1] * t;
      return { routing, buy, sell };
    }
  }
  return {
    routing: asset.routing[0].slice(),
    buy: asset.buys[0],
    sell: asset.sells[0],
  };
}

// ─── Built SVG paths (pure, memo-friendly) ──────────────────────────────────

function buildChartGeometry(asset: ChartAsset): ChartGeometry {
  const N_SAMPLES = 80;
  const samples: {
    x: number;
    routing: number[];
    buy: number;
    sell: number;
  }[] = [];
  for (let i = 0; i <= N_SAMPLES; i++) {
    const logX = LOG_MIN + (i / N_SAMPLES) * (LOG_MAX - LOG_MIN);
    const r = interpolate(asset, logX);
    samples.push({ x: xOfLog(logX), routing: r.routing, buy: r.buy, sell: r.sell });
  }

  const bands: { d: string; color: string }[] = [];
  const numPools = asset.poolNames.length;
  for (let p = 0; p < numPools; p++) {
    const topPts: [number, number][] = [];
    const botPts: [number, number][] = [];
    for (const s of samples) {
      let cumBelow = 0;
      for (let q = 0; q < p; q++) cumBelow += s.routing[q] || 0;
      const cumAbove = cumBelow + (s.routing[p] || 0);
      botPts.push([s.x, yOfRouting(cumBelow)]);
      topPts.push([s.x, yOfRouting(cumAbove)]);
    }
    const topPath = smoothPath(topPts);
    const botRev = botPts.slice().reverse();
    let d = topPath;
    for (const pt of botRev) {
      d += ` L ${pt[0].toFixed(2)},${pt[1].toFixed(2)}`;
    }
    d += " Z";
    bands.push({ d, color: POOL_COLORS[p % POOL_COLORS.length] });
  }

  const buyPts: [number, number][] = samples.map((s) => [s.x, yOfImpact(s.buy, asset.impactMax)]);
  const sellPts: [number, number][] = samples.map((s) => [s.x, yOfImpact(s.sell, asset.impactMax)]);
  const buyPath = smoothPath(buyPts);
  const sellPath = smoothPath(sellPts);
  let ribbonPath = buyPath;
  for (let i = sellPts.length - 1; i >= 0; i--) {
    ribbonPath += ` L ${sellPts[i][0].toFixed(2)},${sellPts[i][1].toFixed(2)}`;
  }
  ribbonPath += " Z";

  return { bands, buyPath, sellPath, ribbonPath };
}

// ─── Components ─────────────────────────────────────────────────────────────

interface BirdsEyeRoutingTableProps {
  pools: BirdsEyePoolCard[];
  enabled?: boolean;
}

function RoutingChartSkeleton() {
  return (
    <div className="rf-root">
      <RoutingStyles />
      <div className="rf-tabs" aria-hidden="true">
        {Array.from({ length: 1 }).map((_, index) => (
          <div key={index} className="rf-tab rf-tab-active">
            <span className="rf-tab-logo bp-skeleton" />
            <span className="rf-tab-info">
              <span className="h-3 w-20 bp-skeleton rounded" />
              <span className="h-2 w-14 bp-skeleton rounded" />
            </span>
          </div>
        ))}
      </div>
      <div className="rf-chart-card">
        <div className="rf-chart-head">
          <div className="rf-chart-title-block">
            <span className="h-3 w-44 bp-skeleton rounded" />
            <span className="h-4 w-32 bp-skeleton rounded" />
          </div>
          <div className="h-3 w-36 bp-skeleton rounded" />
        </div>
        <div className="rf-chart-frame rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="rf-chart-layout">
            <div className="rf-plot-wrap border-r border-gray-200 p-5 dark:border-gray-700">
              <div className="h-[290px] w-full bp-skeleton rounded" />
            </div>
            <div className="space-y-4 p-5">
              <div className="h-8 w-28 bp-skeleton rounded" />
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-8 w-full bp-skeleton rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BirdsEyeRoutingTable({ pools, enabled = true }: BirdsEyeRoutingTableProps) {
  const routing = useBirdsEyeRouting(pools, { enabled });

  const chartAssets = useMemo<ChartAsset[]>(() => {
    return routing.byAsset
      .map((a) => adaptAsset(a, SIZE_SAMPLES))
      .filter((a): a is ChartAsset => a !== null);
  }, [routing.byAsset]);

  const [activeSym, setActiveSym] = useState<string | null>(null);

  const activeIdx = useMemo(() => {
    if (chartAssets.length === 0) return 0;
    const idx = chartAssets.findIndex((a) => a.sym === activeSym);
    return idx >= 0 ? idx : 0;
  }, [chartAssets, activeSym]);

  if (!enabled) return null;

  if (chartAssets.length === 0) {
    if (routing.isLoading) {
      return <RoutingChartSkeleton />;
    }
    return null;
  }

  const active = chartAssets[activeIdx];

  return (
    <div className="rf-root">
      <RoutingStyles />
      <Tabs
        assets={chartAssets}
        activeIdx={activeIdx}
        onSelect={(i) => setActiveSym(chartAssets[i].sym)}
      />
      <ChartCard asset={active} />
    </div>
  );
}

function Tabs({
  assets,
  activeIdx,
  onSelect,
}: {
  assets: ChartAsset[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="rf-tabs" role="tablist">
      {assets.map((a, i) => {
        const active = i === activeIdx;
        return (
          <button
            key={a.sym}
            type="button"
            role="tab"
            aria-selected={active}
            className={`rf-tab ${active ? "rf-tab-active" : ""}`}
            onClick={() => onSelect(i)}
          >
            <span className="rf-tab-logo">
              <img src={tokenIconUrl(a.sym)} alt={a.sym} draggable={false} />
            </span>
            <span className="rf-tab-info">
              <span className="rf-tab-sym">{a.sym}</span>
              <span className="rf-tab-meta">
                <strong>{a.pools}</strong> pool{a.pools > 1 ? "s" : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChartCard({ asset }: { asset: ChartAsset }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<{
    usd: number | null;
    pos: { x: number; y: number } | null;
  } | null>(null);
  const [hoverUsd, setHoverUsd] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const geometry = useMemo(() => buildChartGeometry(asset), [asset]);

  const commitHover = useCallback(() => {
    frameRef.current = null;
    const next = pendingHoverRef.current;
    if (!next) return;
    setHoverUsd(next.usd);
    setTooltipPos(next.pos);
  }, []);

  const scheduleHover = useCallback((next: {
    usd: number | null;
    pos: { x: number; y: number } | null;
  }) => {
    pendingHoverRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(commitHover);
  }, [commitHover]);

  const clearHover = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    pendingHoverRef.current = null;
    setHoverUsd(null);
    setTooltipPos(null);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingHoverRef.current = null;
    };
  }, []);

  const handleMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const rect = svg.getBoundingClientRect();
    const ratioX = (e.clientX - rect.left) / rect.width;
    const svgX = ratioX * VB_W;
    if (svgX < M_L || svgX > M_L + PLOT_W) {
      scheduleHover({ usd: null, pos: null });
      return;
    }
    const usd = xToSize(svgX);
    const wrapRect = wrap.getBoundingClientRect();
    scheduleHover({
      usd,
      pos: {
        x: e.clientX - wrapRect.left,
        y: e.clientY - wrapRect.top,
      },
    });
  }, [scheduleHover]);

  const displayUsd = hoverUsd ?? DEFAULT_DISPLAY_USD;
  const interp = useMemo(
    () => interpolate(asset, Math.log10(displayUsd)),
    [asset, displayUsd]
  );

  return (
    <div className="rf-chart-card">
      <div className="rf-chart-head">
        <div className="rf-chart-title-block">
          <span className="rf-chart-eyebrow">Routing flow · live output</span>
          <span className="rf-chart-title">
            <strong>{asset.sym}</strong> · {asset.pools} pool{asset.pools > 1 ? "s" : ""}
          </span>
        </div>
        <div className="rf-chart-meta">$1k–$100k sweep · log scale</div>
      </div>
      <div className="rf-chart-frame rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="rf-chart-layout">
        <div
          className="rf-plot-wrap border-r border-gray-200 dark:border-gray-700"
          ref={wrapRef}
        >
          <svg
            ref={svgRef}
            className="rf-plot-svg"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            xmlns="http://www.w3.org/2000/svg"
            onMouseMove={handleMove}
            onMouseLeave={clearHover}
          >
            <StaticPlot asset={asset} geometry={geometry} />
            <HoverPlot hoverUsd={hoverUsd} interp={interp} impactMax={asset.impactMax} />
          </svg>
          {hoverUsd !== null && tooltipPos ? (
            <Tooltip pos={tooltipPos} usd={hoverUsd} interp={interp} asset={asset} />
          ) : null}
        </div>
        <Legend
          asset={asset}
          usd={displayUsd}
          interp={interp}
          hovering={hoverUsd !== null}
        />
        </div>
      </div>
    </div>
  );
}

const StaticPlot = React.memo(function StaticPlot({
  asset,
  geometry,
}: {
  asset: ChartAsset;
  geometry: ChartGeometry;
}) {
  const impactTicks = chooseImpactTicks(asset.impactMax);
  const thresholds = asset.impactMax > 25
    ? []
    : [
        { v: 0.5, color: "var(--rf-warn)" },
        { v: 1.0, color: "var(--rf-bad)" },
      ];

  return (
    <>
      {Y_GRID.map((g) => {
        const y = yOfRouting(g);
        return (
          <g key={`yg-${g}`}>
            <line
              x1={M_L}
              y1={y}
              x2={M_L + PLOT_W}
              y2={y}
              stroke="var(--rf-line-soft)"
              strokeWidth="0.6"
              strokeDasharray="2 3"
              fill="none"
            />
            <text
              x={M_L - 8}
              y={y + 3}
              textAnchor="end"
              fontFamily="JetBrains Mono"
              fontSize="9.5"
              fontWeight="600"
              fill="var(--rf-ink-3)"
            >
              {g}%
            </text>
          </g>
        );
      })}
      <text
        x={M_L - 38}
        y={M_T + PLOT_H / 2}
        textAnchor="middle"
        fontFamily="JetBrains Mono"
        fontSize="9"
        fontWeight="700"
        fill="var(--rf-ink-3)"
        letterSpacing="0.18em"
        transform={`rotate(-90, ${M_L - 38}, ${M_T + PLOT_H / 2})`}
      >
        Pool share
      </text>

      {thresholds.map((t) => {
        const y = yOfImpact(t.v, asset.impactMax);
        return (
          <g key={`th-${t.v}`}>
            <line
              x1={M_L}
              y1={y}
              x2={M_L + PLOT_W}
              y2={y}
              stroke={t.color}
              strokeWidth="0.5"
              strokeDasharray="3 4"
              opacity="0.45"
            />
            <text
              x={M_L + 6}
              y={y - 3}
              fontFamily="JetBrains Mono"
              fontSize="8.5"
              fontWeight="700"
              fill={t.color}
              letterSpacing="0.16em"
            >
              {t.v}% SLIP
            </text>
          </g>
        );
      })}

      {geometry.bands.map((b, p) => (
        <path
          key={`band-${p}`}
          d={b.d}
          fill={b.color}
          opacity="0.78"
          stroke="var(--rf-surface)"
          strokeWidth="0.7"
        />
      ))}

      <path d={geometry.ribbonPath} fill="rgba(43, 41, 33, 0.10)" stroke="none" />
      <path
        d={geometry.buyPath}
        fill="none"
        stroke="var(--rf-good)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d={geometry.sellPath}
        fill="none"
        stroke="var(--rf-bad)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <rect
        x={M_L}
        y={M_T}
        width={PLOT_W}
        height={PLOT_H}
        fill="none"
        stroke="var(--rf-ink-1)"
        strokeWidth="1"
      />

      {impactTicks.map((t) => {
        const y = yOfImpact(t, asset.impactMax);
        if (y < M_T || y > M_T + PLOT_H) return null;
        return (
          <g key={`rt-${t}`}>
            <line
              x1={M_L + PLOT_W}
              y1={y}
              x2={M_L + PLOT_W + 4}
              y2={y}
              stroke="var(--rf-ink-2)"
              strokeWidth="0.8"
            />
            <text
              x={M_L + PLOT_W + 8}
              y={y + 3}
              fontFamily="JetBrains Mono"
              fontSize="9"
              fontWeight="600"
              fill="var(--rf-ink-2)"
            >
              {t}%
            </text>
          </g>
        );
      })}
      <text
        x={M_L + PLOT_W + 38}
        y={M_T + PLOT_H / 2}
        textAnchor="middle"
        fontFamily="JetBrains Mono"
        fontSize="9"
        fontWeight="700"
        fill="var(--rf-ink-3)"
        letterSpacing="0.18em"
        transform={`rotate(-90, ${M_L + PLOT_W + 38}, ${M_T + PLOT_H / 2})`}
      >
        Price impact
      </text>

      {X_TICKS.map((v) => {
        const x = xOfSize(v);
        if (x < M_L - 1 || x > M_L + PLOT_W + 1) return null;
        return (
          <g key={`xt-${v}`}>
            <line
              x1={x}
              y1={M_T + PLOT_H}
              x2={x}
              y2={M_T + PLOT_H + 5}
              stroke="var(--rf-ink-2)"
              strokeWidth="0.8"
            />
            <line
              x1={x}
              y1={M_T}
              x2={x}
              y2={M_T + PLOT_H}
              stroke="var(--rf-line-soft)"
              strokeWidth="0.5"
              strokeDasharray="1.5 3"
            />
            <text
              x={x}
              y={M_T + PLOT_H + 17}
              textAnchor="middle"
              fontFamily="JetBrains Mono"
              fontSize="10"
              fontWeight="700"
              fill="var(--rf-ink-1)"
            >
              {fmtUSD(v)}
            </text>
          </g>
        );
      })}
      <text
        x={M_L + PLOT_W / 2}
        y={M_T + PLOT_H + 38}
        textAnchor="middle"
        fontFamily="JetBrains Mono"
        fontSize="9"
        fontWeight="700"
        fill="var(--rf-ink-3)"
        letterSpacing="0.22em"
      >
        ORDER SIZE · LOG SCALE
      </text>
    </>
  );
});

const HoverPlot = React.memo(function HoverPlot({
  hoverUsd,
  interp,
  impactMax,
}: {
  hoverUsd: number | null;
  interp: Interp;
  impactMax: number;
}) {
  if (hoverUsd === null) return null;

  const x = xOfSize(hoverUsd);

  return (
    <g className="rf-cursor">
      <line
        x1={x}
        y1={M_T}
        x2={x}
        y2={M_T + PLOT_H}
        stroke="var(--rf-ink-0)"
        strokeWidth="1"
        strokeDasharray="3 2"
      />
      <circle
        cx={x}
        cy={yOfImpact(interp.buy, impactMax)}
        r="5"
        fill="var(--rf-good)"
        stroke="var(--rf-surface)"
        strokeWidth="2"
      />
      <circle
        cx={x}
        cy={yOfImpact(interp.sell, impactMax)}
        r="5"
        fill="var(--rf-bad)"
        stroke="var(--rf-surface)"
        strokeWidth="2"
      />
    </g>
  );
});

function Tooltip({
  pos,
  usd,
  interp,
  asset,
}: {
  pos: { x: number; y: number };
  usd: number;
  interp: Interp;
  asset: ChartAsset;
}) {
  const f = fmtSize(usd);
  const buyState = impactState(interp.buy);
  const sellState = impactState(interp.sell);
  return (
    <div
      className="rf-tooltip rf-tooltip-visible"
      style={{ left: pos.x, top: pos.y - 14 }}
    >
      <div className="rf-tt-size">
        <span className="rf-tt-px">{f.px}</span>
        <span>{f.n}</span>
        <span className="rf-tt-un">{f.un}</span>
      </div>
      <div className="rf-tt-pools-list">
        {asset.poolNames.map((name, i) => {
          const pct = interp.routing[i] || 0;
          if (pct < 0.5) return null;
          const allocUSD = (pct / 100) * usd;
          return (
            <div key={i} className="rf-tt-row">
              <span className="rf-tt-name">
                <span
                  className="rf-tt-swatch"
                  style={{ background: POOL_COLORS[i % POOL_COLORS.length] }}
                />
                {name}
              </span>
              <span className="rf-tt-val">
                {fmtUSD(allocUSD)}
                <span className="rf-tt-pct">{pct.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="rf-tt-impact">
        <div className="rf-tt-imp-row">
          <span className="rf-tt-lbl">
            <span className="rf-tt-dot rf-buy" />
            Buy
          </span>
          <span className={`rf-tt-impval rf-${buyState}`}>
            {interp.buy.toFixed(2)}%
          </span>
        </div>
        <div className="rf-tt-imp-row">
          <span className="rf-tt-lbl">
            <span className="rf-tt-dot rf-sell" />
            Sell
          </span>
          <span className={`rf-tt-impval rf-${sellState}`}>
            {interp.sell.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Legend({
  asset,
  usd,
  interp,
  hovering,
}: {
  asset: ChartAsset;
  usd: number;
  interp: Interp;
  hovering: boolean;
}) {
  const f = fmtSize(usd);
  const buyState = impactState(interp.buy);
  const sellState = impactState(interp.sell);
  return (
    <div className="rf-legend">
      <div className="rf-legend-eyebrow">At order size</div>
      <div className="rf-size-display">
        <span className="rf-size-px">{f.px}</span>
        <span>{f.n}</span>
        <span className="rf-size-un">{f.un}</span>
        {!hovering ? <span className="rf-scrub-hint">Hover →</span> : null}
      </div>
      <div className="rf-legend-pools">
        {asset.poolNames.map((name, i) => {
          const pct = interp.routing[i] || 0;
          const dim = pct < 0.5;
          const allocUSD = (pct / 100) * usd;
          return (
            <div
              key={i}
              className="rf-legend-pool"
              style={{ opacity: dim ? 0.35 : 1 }}
            >
              <span
                className="rf-legend-swatch"
                style={{ background: POOL_COLORS[i % POOL_COLORS.length] }}
              />
              <div className="rf-legend-info">
                <span className="rf-legend-name">{name}</span>
                <span className="rf-legend-fee">tier · {asset.poolFees[i]}</span>
              </div>
              <div className="rf-legend-alloc">
                <span className="rf-legend-pct">{pct.toFixed(1)}%</span>
                <span className="rf-legend-usd">
                  {pct >= 0.5 ? fmtUSD(allocUSD) : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="rf-legend-impact">
        <div className="rf-legend-impact-row">
          <span className="rf-legend-impact-lbl rf-buy-text">
            <span className="rf-legend-impact-dot rf-buy" />
            Buy {asset.sym}
          </span>
          <span className={`rf-legend-impact-val rf-${buyState}`}>
            {interp.buy.toFixed(2)}%
          </span>
        </div>
        <div className="rf-legend-impact-row">
          <span className="rf-legend-impact-lbl rf-sell-text">
            <span className="rf-legend-impact-dot rf-sell" />
            Sell {asset.sym}
          </span>
          <span className={`rf-legend-impact-val rf-${sellState}`}>
            {interp.sell.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Scoped styles ──────────────────────────────────────────────────────────

function RoutingStyles() {
  return <style>{ROUTING_CSS}</style>;
}

const ROUTING_CSS = `
.rf-root {
  --rf-page: #F2F1EC;
  --rf-surface: #FAFAF7;
  --rf-surface-2: #F5F4EF;
  --rf-surface-3: #ECEBE4;
  --rf-line: #C8C6BB;
  --rf-line-soft: #DAD8CF;
  --rf-line-hard: #9E9B8E;
  --rf-ink-0: #0A0906;
  --rf-ink-1: #2B2921;
  --rf-ink-2: #5E5B50;
  --rf-ink-3: #86836F;
  --rf-ink-4: #ADAA95;
  --rf-ink-inv: #F2F1EC;
  --rf-good: #4A9D5C;
  --rf-warn: #D49A2E;
  --rf-bad: #C4504B;
  --rf-state-good: #2E6B2E;
  --rf-state-warn: #8B5A00;
  --rf-state-bad: #8B2828;
  --rf-mono: 'JetBrains Mono', ui-monospace, monospace;
  --rf-sans: 'Inter', system-ui, sans-serif;
  font-family: var(--rf-mono);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--rf-ink-0);
  -webkit-font-smoothing: antialiased;
}
.rf-loading {
  text-align: center; padding: 40px;
  font-family: var(--rf-mono); color: var(--rf-ink-3);
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
}
.rf-tabs {
  display: flex;
  margin-bottom: 16px;
  border: 1px solid var(--rf-line);
  border-radius: 4px;
  overflow-x: auto;
  background: var(--rf-surface);
}
.rf-tab {
  flex: 1 1 0;
  min-width: 110px;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 11px;
  background: var(--rf-surface);
  border: none;
  border-right: 1px solid var(--rf-line);
  border-radius: 0;
  cursor: pointer; user-select: none;
  font-family: inherit; color: var(--rf-ink-1);
  text-align: left;
  position: relative;
  transition: background 0.12s;
}
.rf-tab:last-child { border-right: none; }
.rf-tab:hover { background: var(--rf-surface-3); }
.rf-tab:focus-visible {
  outline: 2px solid var(--rf-warn);
  outline-offset: -2px;
}
.rf-tab-active { background: var(--rf-surface); }
.rf-tab-active::before {
  content: ''; position: absolute;
  top: 0; left: 0; right: 0; height: 3px;
  background: var(--rf-warn);
}
.rf-tab-active .rf-tab-sym { color: var(--rf-ink-0); }
.rf-tab-active .rf-tab-meta strong { color: var(--rf-ink-0); }
.rf-tab-logo {
  position: relative;
  width: 28px; height: 28px;
  flex-shrink: 0;
  background: var(--rf-surface-3);
  border: 1px solid var(--rf-line);
  border-radius: 50%;
  overflow: hidden;
}
.rf-tab-logo img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.rf-tab-info {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0; flex: 1;
}
.rf-tab-sym {
  font-family: var(--rf-sans); font-size: 13px; font-weight: 700;
  letter-spacing: -0.015em; line-height: 1.05;
  color: var(--rf-ink-0);
}
.rf-tab-meta {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 9px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--rf-ink-3);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rf-tab-meta strong {
  color: var(--rf-ink-1); font-weight: 700;
}
.rf-tab-active .rf-tab-meta { color: var(--rf-ink-2); }
.rf-tab-active .rf-tab-meta strong { color: var(--rf-ink-0); }

.rf-chart-card {
  background: transparent;
  padding: 0;
  position: relative;
}

.rf-chart-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 2px 16px;
  margin-bottom: 0;
  border-bottom: 1px dashed var(--rf-line);
  gap: 24px;
}
.rf-chart-title-block { display: flex; flex-direction: row; align-items: baseline; gap: 8px; }
.rf-chart-eyebrow {
  font-family: var(--rf-mono); font-size: 8.5px; color: var(--rf-ink-3);
  letter-spacing: 0.22em; text-transform: uppercase; font-weight: 700;
  line-height: 1;
}
.rf-chart-title {
  font-family: var(--rf-sans); font-size: 10px; font-weight: 700;
  letter-spacing: -0.01em; color: var(--rf-ink-0); line-height: 1;
}
.rf-chart-meta {
  font-family: var(--rf-mono); font-size: 9px; line-height: 1;
  color: var(--rf-ink-2); letter-spacing: 0.1em;
}

.rf-chart-layout {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 0;
  align-items: stretch;
}

.rf-plot-wrap { position: relative; }
.rf-plot-svg {
  display: block; width: 100%; height: auto;
  background: transparent;
  cursor: crosshair;
}

.rf-tooltip {
  position: absolute;
  background: var(--rf-ink-0); color: var(--rf-ink-inv);
  padding: 8px 11px 9px;
  border: 1px solid var(--rf-ink-1); border-radius: 1px;
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  box-shadow: 0 4px 12px rgba(10,9,6,0.35);
  pointer-events: none; z-index: 5;
  min-width: 180px;
  transform: translate(12px, -100%);
  opacity: 0; transition: opacity 0.1s;
}
.rf-tooltip-visible { opacity: 1; }

.rf-tt-size {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 16px; font-weight: 800; letter-spacing: -0.025em;
  line-height: 1; color: var(--rf-ink-inv); margin-bottom: 6px;
}
.rf-tt-px, .rf-tt-un { color: var(--rf-ink-4); font-weight: 500; font-size: 12px; }
.rf-tt-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; font-size: 9.5px; padding: 2px 0;
}
.rf-tt-name {
  display: flex; align-items: center; gap: 6px;
  color: var(--rf-ink-4); letter-spacing: 0.06em;
}
.rf-tt-swatch { width: 8px; height: 8px; border-radius: 1px; flex-shrink: 0; }
.rf-tt-val {
  color: var(--rf-ink-inv); font-weight: 700; letter-spacing: -0.01em;
  font-size: 10px;
}
.rf-tt-pct { color: var(--rf-ink-4); margin-left: 4px; font-weight: 500; }
.rf-tt-impact {
  margin-top: 6px; padding-top: 6px;
  border-top: 1px dashed var(--rf-ink-2);
  display: flex; flex-direction: column; gap: 3px;
}
.rf-tt-imp-row { display: flex; justify-content: space-between; align-items: baseline; }
.rf-tt-lbl {
  color: var(--rf-ink-4); letter-spacing: 0.16em; text-transform: uppercase;
  font-weight: 600; font-size: 8.5px;
  display: inline-flex; align-items: center; gap: 5px;
}
.rf-tt-dot { width: 6px; height: 6px; border-radius: 50%; }
.rf-tt-dot.rf-buy { background: var(--rf-good); }
.rf-tt-dot.rf-sell { background: var(--rf-bad); }
.rf-tt-impval {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 12px; font-weight: 800; letter-spacing: -0.015em;
}
.rf-tt-impval.rf-good { color: var(--rf-good); }
.rf-tt-impval.rf-warn { color: var(--rf-warn); }
.rf-tt-impval.rf-bad { color: var(--rf-bad); }

.rf-legend {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 14px 16px 16px 20px;
  box-shadow: none;
  position: relative;
}

.rf-legend-eyebrow {
  font-family: var(--rf-mono); font-size: 9px; color: var(--rf-ink-3);
  letter-spacing: 0.24em; text-transform: uppercase; font-weight: 700;
  margin-bottom: 4px;
}
.rf-size-display {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 24px; font-weight: 800; letter-spacing: -0.03em;
  color: var(--rf-ink-0); line-height: 1;
  margin-bottom: 14px;
  display: flex; align-items: baseline; gap: 3px;
}
.rf-size-px, .rf-size-un { color: var(--rf-ink-3); font-weight: 500; font-size: 14px; }
.rf-scrub-hint {
  margin-left: auto;
  font-family: var(--rf-mono); font-size: 8px; color: var(--rf-ink-3);
  letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600;
  line-height: 1.3; align-self: flex-end;
}

.rf-legend-pool {
  display: grid; grid-template-columns: 10px 1fr auto;
  align-items: center; gap: 8px;
  padding: 7px 0 8px;
  border-bottom: 1px dashed var(--rf-line);
}
.rf-legend-pool:last-of-type { border-bottom: none; }
.rf-legend-swatch {
  width: 10px; height: 10px;
  border-radius: 1px; border: 1px solid rgba(0,0,0,0.15);
}
.rf-legend-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.rf-legend-name {
  font-family: var(--rf-mono); font-size: 10.5px; font-weight: 700;
  color: var(--rf-ink-0); letter-spacing: -0.005em; line-height: 1.1;
}
.rf-legend-fee {
  font-family: var(--rf-mono); font-size: 8.5px;
  color: var(--rf-ink-3); letter-spacing: 0.12em; text-transform: uppercase;
  font-weight: 500;
}
.rf-legend-alloc {
  text-align: right; display: flex; flex-direction: column; gap: 1px;
  align-items: flex-end;
}
.rf-legend-pct {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 13px; font-weight: 800; letter-spacing: -0.02em;
  color: var(--rf-ink-0); line-height: 1;
}
.rf-legend-usd {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 9px; color: var(--rf-ink-3); letter-spacing: -0.01em;
  font-weight: 500;
}

.rf-legend-impact {
  margin-top: 12px; padding-top: 12px;
  border-top: 1.5px solid var(--rf-ink-1);
  display: flex; flex-direction: column; gap: 5px;
}
.rf-legend-impact-row {
  display: flex; align-items: baseline; justify-content: space-between;
}
.rf-legend-impact-lbl {
  font-family: var(--rf-mono); font-size: 9px;
  letter-spacing: 0.22em; text-transform: uppercase; font-weight: 700;
  display: flex; align-items: center; gap: 6px;
}
.rf-buy-text { color: var(--rf-state-good); }
.rf-sell-text { color: var(--rf-state-bad); }
.rf-legend-impact-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.rf-legend-impact-dot.rf-buy { background: var(--rf-good); }
.rf-legend-impact-dot.rf-sell { background: var(--rf-bad); }
.rf-legend-impact-val {
  font-family: var(--rf-mono); font-feature-settings: "tnum" 1;
  font-size: 16px; font-weight: 800; letter-spacing: -0.025em;
  line-height: 1;
}
.rf-legend-impact-val.rf-good { color: var(--rf-state-good); }
.rf-legend-impact-val.rf-warn { color: var(--rf-state-warn); }
.rf-legend-impact-val.rf-bad { color: var(--rf-state-bad); }
`;
