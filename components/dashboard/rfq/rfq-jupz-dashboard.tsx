"use client";

import React, {
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
  useCallback,
  useEffect,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import {
  useJupzRfqData,
} from "@/hooks/use-jupz-rfq-data";
import {
  useJupzRfqHistory,
  type JupzHistoryPoint,
  type JupzUptimeStats,
} from "@/hooks/use-jupz-rfq-history";
import { usePoolCandles } from "@/hooks/use-pool-candles";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import {
  PoolHeader,
  PoolTokens,
  TokenIcon,
  PoolInfo,
  PoolName,
  PoolBadges,
  PoolBadge,
} from "@/components/dashboard/pool-header";
import {
  ChartCard,
  ChartHeader,
  ChartTitle,
  ChartContent,
  ChartCardSkeleton,
} from "@/components/dashboard/chart-card";
import { SlaHeatmapCalendar } from "./sla-heatmap-calendar";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveStepAfter, curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";

// ─── Main Dashboard ──────────────────────────────────────────────────────────

interface RfqJupzDashboardProps {
  asset: string;
}

export function RfqJupzDashboard({ asset }: RfqJupzDashboardProps) {
  const data = useJupzRfqData(asset);

  if (data.isLoading) {
    return (
      <div className="flex-1 p-4 md:p-6 overflow-auto">
        <div id="dashboard-top" className="flex flex-col gap-3">
          <JupzHeader asset={asset} quoteAt={null} />
          <ChartCardSkeleton />
        </div>
      </div>
    );
  }

  if (data.isError || data.allQuotesFailed) {
    return (
      <div className="flex-1 p-4 md:p-6 overflow-auto">
        <div id="dashboard-top" className="flex flex-col gap-3">
          <JupzHeader asset={asset} quoteAt={data.quoteAt} />
          <div className="bp-card p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <span className="text-xl text-amber-500">0</span>
            </div>
            <p className="text-sm font-medium text-[var(--bp-text-primary)] mb-1">
              No JupZ data available
            </p>
            <p className="text-xs text-[var(--bp-text-muted)]">
              {data.isError
                ? "Failed to load JupZ RFQ data. Will retry automatically."
                : `${asset} has no JupZ RFQ quotes available yet.`}
            </p>
            <p className="text-[10px] text-[var(--bp-text-muted)] mt-3">
              Data refreshes every 60s.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-6 overflow-auto">
      <div id="dashboard-top" className="flex flex-col gap-3">
        <JupzHeader asset={asset} quoteAt={data.quoteAt} />
        <SlaHeatmapCalendar asset={asset} />
        <JupzHistoricalSection asset={asset} />
      </div>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function JupzHeader({
  asset,
  quoteAt,
}: {
  asset: string;
  quoteAt: string | null;
}) {
  const formattedTime = quoteAt
    ? new Date(quoteAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <PoolHeader>
      <PoolTokens>
        <TokenIcon symbol={asset} className="w-[50px] h-[50px]" />
        <TokenIcon symbol="USDC" className="w-[50px] h-[50px]" />
      </PoolTokens>
      <PoolInfo>
        <PoolName>{asset}/USDC RFQ</PoolName>
        <PoolBadges>
          <PoolBadge variant="primary">RFQ</PoolBadge>
          <PoolBadge>JupZ</PoolBadge>
          <PoolBadge>Solana</PoolBadge>
          {formattedTime && <PoolBadge>{formattedTime}</PoolBadge>}
        </PoolBadges>
      </PoolInfo>
    </PoolHeader>
  );
}

// ─── Shared chart helpers ────────────────────────────────────────────────────

const BAND_COLORS = [
  { fill: "#22c55e", stroke: "#22c55e", opacity: 0.25 },
  { fill: "#3b82f6", stroke: "#3b82f6", opacity: 0.18 },
  { fill: "#8b5cf6", stroke: "#8b5cf6", opacity: 0.14 },
  { fill: "#f59e0b", stroke: "#f59e0b", opacity: 0.10 },
  { fill: "#ef4444", stroke: "#ef4444", opacity: 0.08 },
  { fill: "#ec4899", stroke: "#ec4899", opacity: 0.06 },
  { fill: "#6366f1", stroke: "#6366f1", opacity: 0.05 },
];

const formatTimeH = (d: Date): string =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const formatAxisTickH = (d: Date, spanMs: number): string => {
  if (spanMs > 24 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  }
  return formatTimeH(d);
};

const formatDateTimeH = (d: Date): string =>
  d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

function formatDurationH(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

const formatCompactH = (value: number): string => {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
};

function findPoolForAssetJupz(
  asset: string
): { poolKey: string; token0Decimals: number; token1Decimals: number } | null {
  for (const [poolKey, meta] of Object.entries(SOLANA_POOL_METADATA_BY_ADDRESS)) {
    if (meta.token0Symbol.toLowerCase() === asset.toLowerCase()) {
      return {
        poolKey,
        token0Decimals: meta.token0Decimals,
        token1Decimals: meta.token1Decimals,
      };
    }
  }
  return null;
}

// ─── Historical Section ──────────────────────────────────────────────────────

function JupzHistoricalSection({ asset }: { asset: string }) {
  const { points, notionalTiers, uptime, isLoading, isError } =
    useJupzRfqHistory(asset);

  if (isLoading) return <ChartCardSkeleton />;

  if (isError || points.length < 2) {
    return (
      <ChartCard>
        <ChartHeader>
          <ChartTitle>Historical Quoting Activity</ChartTitle>
        </ChartHeader>
        <ChartContent>
          <div className="w-full h-[200px] flex items-center justify-center">
            <p className="text-[11px] text-[var(--bp-text-muted)]">
              {isError
                ? "Failed to load historical data"
                : "Not enough historical data yet"}
            </p>
          </div>
        </ChartContent>
      </ChartCard>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <JupzPriceBandsChart
        points={points}
        notionalTiers={notionalTiers}
        asset={asset}
      />
      <JupzQuoteActivityTimeline points={points} uptime={uptime} />
    </div>
  );
}

// ─── Historical Price Bands ──────────────────────────────────────────────────

function JupzPriceBandsChart({
  points,
  notionalTiers,
  asset,
}: {
  points: JupzHistoryPoint[];
  notionalTiers: number[];
  asset: string;
}) {
  const [showPoolPrice, setShowPoolPrice] = useState(false);
  const [showKrakenXusd, setShowKrakenXusd] = useState(false);
  const [showKrakenSpv, setShowKrakenSpv] = useState(false);
  const [showFinnhub, setShowFinnhub] = useState(false);
  const [enabledEvents, setEnabledEvents] = useState<Set<string>>(new Set());
  const [eventsDropdownOpen, setEventsDropdownOpen] = useState(false);
  const eventsButtonRef = useRef<HTMLButtonElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    dataIndex: number;
  } | null>(null);
  const [zoomRange, setZoomRange] = useState<{
    isSelecting: boolean;
    startIndex: number | null;
    endIndex: number | null;
  }>({ isSelecting: false, startIndex: null, endIndex: null });
  const [activeZoom, setActiveZoom] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const poolInfo = useMemo(() => findPoolForAssetJupz(asset), [asset]);
  const timeRangeDays = useMemo(() => {
    if (points.length < 2) return 7;
    return Math.max(
      1,
      Math.ceil(
        (points[points.length - 1].timestamp.getTime() -
          points[0].timestamp.getTime()) /
          86_400_000
      )
    );
  }, [points]);

  const { data: candles } = usePoolCandles({
    poolAddress: poolInfo?.poolKey ?? "",
    interval: "5m",
    days: timeRangeDays + 1,
    token0Decimals: poolInfo?.token0Decimals ?? 8,
    token1Decimals: poolInfo?.token1Decimals ?? 6,
    enabled: showPoolPrice && !!poolInfo,
  });
  const oracleLine = useMemo(() => {
    if (!showPoolPrice || !candles || candles.length === 0 || points.length < 2)
      return [];
    const [startTs, endTs] = [
      points[0].timestamp.getTime(),
      points[points.length - 1].timestamp.getTime(),
    ];
    return candles
      .filter((c) => {
        const t = c.timestamp.getTime();
        return t >= startTs && t <= endTs && c.close > 0;
      })
      .map((c) => ({ timestamp: c.timestamp, price: c.close }));
  }, [showPoolPrice, candles, points]);

  const krakenXusdPair = useMemo(() => `${asset}USD`, [asset]);
  const krakenSpvPair = useMemo(() => {
    const base = asset.endsWith("x") ? asset.slice(0, -1) : asset;
    return `${base}SPVUSD`;
  }, [asset]);
  const krakenSince = useMemo(
    () =>
      points.length < 2 ? 0 : Math.floor(points[0].timestamp.getTime() / 1000),
    [points]
  );
  const krakenEndTime = useMemo(
    () =>
      points.length < 2
        ? 0
        : Math.ceil(points[points.length - 1].timestamp.getTime() / 1000),
    [points]
  );
  const finnhubSymbol = useMemo(
    () => (asset.endsWith("x") ? asset.slice(0, -1) : asset),
    [asset]
  );

  const { data: krakenXusdCandles } = useQuery({
    queryKey: ["krakenOhlc", krakenXusdPair, 5, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        pair: krakenXusdPair,
        interval: "5",
        since: String(krakenSince),
        endTime: String(krakenEndTime),
      });
      const res = await fetch(`/api/kraken-ohlc?${params}`);
      if (!res.ok) throw new Error(`Kraken API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showKrakenXusd && krakenSince > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: krakenSpvCandles } = useQuery({
    queryKey: ["krakenOhlc", krakenSpvPair, 5, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        pair: krakenSpvPair,
        interval: "5",
        since: String(krakenSince),
        endTime: String(krakenEndTime),
      });
      const res = await fetch(`/api/kraken-ohlc?${params}`);
      if (!res.ok) throw new Error(`Kraken API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showKrakenSpv && krakenSince > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: finnhubCandles } = useQuery({
    queryKey: ["finnhubCandles", finnhubSymbol, krakenSince, krakenEndTime],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol: finnhubSymbol,
        resolution: "5",
        from: String(krakenSince),
        to: String(krakenEndTime),
      });
      const res = await fetch(`/api/finnhub-candles?${params}`);
      if (!res.ok) throw new Error(`Finnhub API error: ${res.status}`);
      return res.json() as Promise<Array<{ timestamp: number; close: number }>>;
    },
    enabled: showFinnhub && krakenSince > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const makeOverlayLine = (
    show: boolean,
    data: Array<{ timestamp: number; close: number }> | undefined
  ) => {
    if (!show || !data || data.length === 0 || points.length < 2) return [];
    const [startTs, endTs] = [
      points[0].timestamp.getTime(),
      points[points.length - 1].timestamp.getTime(),
    ];
    return data
      .filter((c) => {
        const t = c.timestamp * 1000;
        return t >= startTs && t <= endTs && c.close > 0;
      })
      .map((c) => ({ timestamp: new Date(c.timestamp * 1000), price: c.close }));
  };
  const krakenXusdLine = useMemo(
    () => makeOverlayLine(showKrakenXusd, krakenXusdCandles),
    [showKrakenXusd, krakenXusdCandles, points]
  );
  const krakenSpvLine = useMemo(
    () => makeOverlayLine(showKrakenSpv, krakenSpvCandles),
    [showKrakenSpv, krakenSpvCandles, points]
  );
  const finnhubLine = useMemo(
    () => makeOverlayLine(showFinnhub, finnhubCandles),
    [showFinnhub, finnhubCandles, points]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const margin = { top: 16, right: 16, bottom: 40, left: 72 };
  const spreadChartH = 100;
  const spreadGap = 24;
  const innerW = Math.max(0, width - margin.left - margin.right);
  const mainChartH = Math.max(
    0,
    height - margin.top - margin.bottom - spreadChartH - spreadGap
  );
  const innerH = mainChartH;
  const spreadTop = margin.top + mainChartH + spreadGap;
  const spanMs =
    points.length > 1
      ? points[points.length - 1].timestamp.getTime() -
        points[0].timestamp.getTime()
      : 0;

  const visiblePoints = useMemo(() => {
    if (!activeZoom || points.length === 0) return points;
    const si = Math.max(0, Math.min(activeZoom.startIndex, activeZoom.endIndex));
    const ei = Math.min(
      points.length - 1,
      Math.max(activeZoom.startIndex, activeZoom.endIndex)
    );
    return points.slice(si, ei + 1);
  }, [activeZoom, points]);

  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain:
          visiblePoints.length > 1
            ? [
                visiblePoints[0].timestamp,
                visiblePoints[visiblePoints.length - 1].timestamp,
              ]
            : [new Date(), new Date()],
        range: [0, innerW],
      }),
    [visiblePoints, innerW]
  );

  const NYSE_EVENTS = [
    { label: "Early Pre-Mkt", hour: 4, minute: 0, color: "#818cf8" },
    { label: "Pre-Market", hour: 7, minute: 0, color: "#c084fc" },
    { label: "NYSE Open", hour: 9, minute: 30, color: "#4ade80" },
    { label: "NYSE Close", hour: 16, minute: 0, color: "#f87171" },
    { label: "After-Hrs Close", hour: 20, minute: 0, color: "#fbbf24" },
  ];

  const eventLines = useMemo(() => {
    if (enabledEvents.size === 0 || visiblePoints.length < 2) return [];
    const startMs = visiblePoints[0].timestamp.getTime();
    const endMs = visiblePoints[visiblePoints.length - 1].timestamp.getTime();
    if (startMs >= endMs) return [];
    const lines: { x: number; label: string; color: string }[] = [];
    const activeEvts = NYSE_EVENTS.filter((e) => enabledEvents.has(e.label));
    if (activeEvts.length === 0) return [];
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const dd = new Date(startMs);
    dd.setDate(dd.getDate() - 1);
    dd.setHours(0, 0, 0, 0);
    const endDate = new Date(endMs);
    endDate.setDate(endDate.getDate() + 1);
    while (dd <= endDate) {
      const dow = dd.getDay();
      if (dow !== 0 && dow !== 6) {
        for (const evt of activeEvts) {
          const guess = new Date(
            Date.UTC(
              dd.getFullYear(),
              dd.getMonth(),
              dd.getDate(),
              evt.hour,
              evt.minute,
              0
            )
          );
          const parts = etFormatter.formatToParts(guess);
          const getPart = (type: string) =>
            parseInt(parts.find((p) => p.type === type)?.value ?? "0");
          const etHour = getPart("hour");
          const etMinute = getPart("minute");
          const etDay = getPart("day");
          const diffMinutes =
            evt.hour * 60 +
            evt.minute -
            (etHour * 60 + etMinute) +
            (dd.getDate() - etDay) * 1440;
          const evtDate = new Date(guess.getTime() + diffMinutes * 60_000);
          const ts = evtDate.getTime();
          if (ts >= startMs && ts <= endMs) {
            const x = xScale(evtDate) ?? 0;
            lines.push({ x, label: evt.label, color: evt.color });
          }
        }
      }
      dd.setDate(dd.getDate() + 1);
    }
    return lines;
  }, [enabledEvents, visiblePoints, xScale]);

  const yDomain = useMemo(() => {
    if (visiblePoints.length === 0) return [0, 1] as [number, number];
    let min = Infinity,
      max = -Infinity;
    for (const pt of visiblePoints) {
      if (pt.midPrice < min) min = pt.midPrice;
      if (pt.midPrice > max) max = pt.midPrice;
      for (const [, tier] of pt.tiers) {
        if (tier.bidPrice > 0 && tier.bidPrice < min) min = tier.bidPrice;
        if (tier.bidPrice > 0 && tier.bidPrice > max) max = tier.bidPrice;
        if (tier.askPrice > 0 && tier.askPrice < min) min = tier.askPrice;
        if (tier.askPrice > 0 && tier.askPrice > max) max = tier.askPrice;
      }
    }
    for (const lines of [oracleLine, krakenXusdLine, krakenSpvLine, finnhubLine])
      for (const p of lines) {
        if (p.price < min) min = p.price;
        if (p.price > max) max = p.price;
      }
    const pad = (max - min) * 0.1 || 1;
    return [min - pad, max + pad] as [number, number];
  }, [visiblePoints, oracleLine, krakenXusdLine, krakenSpvLine, finnhubLine]);
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: yDomain, range: [innerH, 0], nice: true }),
    [yDomain, innerH]
  );

  const bandPaths = useMemo(() => {
    if (visiblePoints.length < 2 || notionalTiers.length === 0) return [];
    return [...notionalTiers].reverse().map((notional, colorIdx) => {
      const color =
        BAND_COLORS[
          (notionalTiers.length - 1 - colorIdx) % BAND_COLORS.length
        ];
      const validPts = visiblePoints.map((pt) => {
        const td = pt.tiers.get(notional);
        return {
          x: xScale(pt.timestamp) ?? 0,
          buyY: yScale(td && td.bidPrice > 0 ? td.bidPrice : pt.midPrice),
          askY: yScale(td && td.askPrice > 0 ? td.askPrice : pt.midPrice),
          midY: yScale(pt.midPrice),
        };
      });
      if (validPts.length < 2) return null;
      let buyPath = `M ${validPts[0].x} ${validPts[0].midY}`;
      for (const p of validPts) buyPath += ` L ${p.x} ${p.midY}`;
      for (let i = validPts.length - 1; i >= 0; i--)
        buyPath += ` L ${validPts[i].x} ${validPts[i].buyY}`;
      buyPath += " Z";
      let sellPath = `M ${validPts[0].x} ${validPts[0].askY}`;
      for (const p of validPts) sellPath += ` L ${p.x} ${p.askY}`;
      for (let i = validPts.length - 1; i >= 0; i--)
        sellPath += ` L ${validPts[i].x} ${validPts[i].midY}`;
      sellPath += " Z";
      return { notional, buyPath, sellPath, color };
    });
  }, [visiblePoints, notionalTiers, xScale, yScale]);

  const findNearestPrice = (
    line: { timestamp: Date; price: number }[],
    t: number
  ) => {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const p of line) {
      const d = Math.abs(p.timestamp.getTime() - t);
      if (d < bestDist) {
        bestDist = d;
        best = p.price;
      }
    }
    return best;
  };

  const hoverData = useMemo(() => {
    if (hoverIdx === null || !visiblePoints[hoverIdx]) return null;
    const pt = visiblePoints[hoverIdx];
    const t = pt.timestamp.getTime();
    return {
      x: xScale(pt.timestamp) ?? 0,
      midY: yScale(pt.midPrice),
      point: pt,
      poolPrice:
        showPoolPrice && oracleLine.length > 0
          ? findNearestPrice(oracleLine, t)
          : null,
      krakenXusdPrice:
        showKrakenXusd && krakenXusdLine.length > 0
          ? findNearestPrice(krakenXusdLine, t)
          : null,
      krakenSpvPrice:
        showKrakenSpv && krakenSpvLine.length > 0
          ? findNearestPrice(krakenSpvLine, t)
          : null,
      finnhubPrice:
        showFinnhub && finnhubLine.length > 0
          ? findNearestPrice(finnhubLine, t)
          : null,
    };
  }, [
    hoverIdx,
    visiblePoints,
    xScale,
    yScale,
    showPoolPrice,
    oracleLine,
    showKrakenXusd,
    krakenXusdLine,
    showKrakenSpv,
    krakenSpvLine,
    showFinnhub,
    finnhubLine,
  ]);

  const makeSpreadData = (
    show: boolean,
    line: { timestamp: Date; price: number }[]
  ) => {
    if (!show || line.length === 0) return [];
    return visiblePoints
      .map((pt) => {
        const tier = pt.tiers.get(10000);
        const buyPrice = tier?.bidPrice ?? 0;
        if (buyPrice <= 0) return null;
        const ref = findNearestPrice(line, pt.timestamp.getTime());
        if (ref === null) return null;
        return {
          timestamp: pt.timestamp,
          bps: ((buyPrice - ref) / buyPrice) * 10000,
        };
      })
      .filter((d): d is { timestamp: Date; bps: number } => d !== null);
  };
  const spreadXusdData = useMemo(
    () => makeSpreadData(showKrakenXusd, krakenXusdLine),
    [visiblePoints, showKrakenXusd, krakenXusdLine]
  );
  const spreadSpvData = useMemo(
    () => makeSpreadData(showKrakenSpv, krakenSpvLine),
    [visiblePoints, showKrakenSpv, krakenSpvLine]
  );
  const spreadTradFiData = useMemo(
    () => makeSpreadData(showFinnhub, finnhubLine),
    [visiblePoints, showFinnhub, finnhubLine]
  );

  const spreadYDomain = useMemo(() => {
    const allBps = [...spreadXusdData, ...spreadSpvData, ...spreadTradFiData].map(
      (d) => d.bps
    );
    if (allBps.length === 0) return [-50, 50] as [number, number];
    const pad = Math.max((Math.max(...allBps) - Math.min(...allBps)) * 0.15, 5);
    return [Math.min(...allBps) - pad, Math.max(...allBps) + pad] as [
      number,
      number,
    ];
  }, [spreadXusdData, spreadSpvData, spreadTradFiData]);
  const spreadYScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: spreadYDomain,
        range: [spreadChartH, 0],
        nice: true,
      }),
    [spreadYDomain]
  );
  const showSpreadChart =
    (showKrakenXusd && spreadXusdData.length > 1) ||
    (showKrakenSpv && spreadSpvData.length > 1) ||
    (showFinnhub && spreadTradFiData.length > 1);

  const [spreadHoverIdx, setSpreadHoverIdx] = useState<number | null>(null);
  const spreadHoverData = useMemo(() => {
    if (spreadHoverIdx === null || !visiblePoints[spreadHoverIdx]) return null;
    const pt = visiblePoints[spreadHoverIdx];
    const t = pt.timestamp.getTime();
    const tier = pt.tiers.get(10000);
    const buyPrice = tier?.bidPrice ?? 0;
    return {
      x: xScale(pt.timestamp) ?? 0,
      timestamp: pt.timestamp,
      buyPrice,
      xusdBps:
        showKrakenXusd && krakenXusdLine.length > 0 && buyPrice > 0
          ? (() => {
              const kp = findNearestPrice(krakenXusdLine, t);
              return kp !== null ? ((buyPrice - kp) / buyPrice) * 10000 : null;
            })()
          : null,
      spvBps:
        showKrakenSpv && krakenSpvLine.length > 0 && buyPrice > 0
          ? (() => {
              const kp = findNearestPrice(krakenSpvLine, t);
              return kp !== null ? ((buyPrice - kp) / buyPrice) * 10000 : null;
            })()
          : null,
      tradFiBps:
        showFinnhub && finnhubLine.length > 0 && buyPrice > 0
          ? (() => {
              const fp = findNearestPrice(finnhubLine, t);
              return fp !== null ? ((buyPrice - fp) / buyPrice) * 10000 : null;
            })()
          : null,
    };
  }, [
    spreadHoverIdx,
    visiblePoints,
    xScale,
    showKrakenXusd,
    krakenXusdLine,
    showKrakenSpv,
    krakenSpvLine,
    showFinnhub,
    finnhubLine,
  ]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (hoverIdx === null) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setContextMenu({
        visible: true,
        x: Math.min(x, width - 200),
        y: Math.min(y, height - 100),
        dataIndex: hoverIdx,
      });
    },
    [hoverIdx, width, height]
  );

  const handleStartRangeSelect = useCallback(() => {
    if (contextMenu === null) return;
    let fullIndex = contextMenu.dataIndex;
    if (activeZoom) {
      const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
      fullIndex = zoomStart + contextMenu.dataIndex;
    }
    setZoomRange({ isSelecting: true, startIndex: fullIndex, endIndex: null });
  }, [contextMenu, activeZoom]);

  const handleChartClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      if (
        zoomRange.isSelecting &&
        zoomRange.startIndex !== null &&
        hoverIdx !== null
      ) {
        let fullEndIndex = hoverIdx;
        if (activeZoom) {
          const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
          fullEndIndex = zoomStart + hoverIdx;
        }
        setActiveZoom({
          startIndex: zoomRange.startIndex,
          endIndex: fullEndIndex,
        });
        setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
      }
    },
    [zoomRange, hoverIdx, activeZoom]
  );

  const handleResetZoom = useCallback(() => {
    setActiveZoom(null);
    setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && zoomRange.isSelecting) {
        setZoomRange({ isSelecting: false, startIndex: null, endIndex: null });
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [zoomRange.isSelecting]);

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Historical Price Bands</ChartTitle>
        <div className="flex items-center gap-3">
          {[
            { label: "Pool", show: showPoolPrice, set: setShowPoolPrice, color: "orange" },
            { label: "Kraken xUSD", show: showKrakenXusd, set: setShowKrakenXusd, color: "cyan" },
            { label: "Kraken SPV", show: showKrakenSpv, set: setShowKrakenSpv, color: "violet" },
            { label: `TradFi ${finnhubSymbol}`, show: showFinnhub, set: setShowFinnhub, color: "emerald" },
          ].map(({ label, show, set, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--bp-text-muted)]">{label}</span>
              <button
                type="button"
                onClick={() => set((v: boolean) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 transition-colors ${
                  show ? `bg-${color}-500 border-${color}-500` : "bg-gray-300 border-gray-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                    show ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
          <div className="relative flex items-center gap-1.5">
            <button
              ref={eventsButtonRef}
              type="button"
              onClick={() => setEventsDropdownOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                enabledEvents.size > 0
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                  : "border-[var(--bp-border-subtle)] text-[var(--bp-text-muted)] hover:border-[var(--bp-text-muted)]"
              }`}
            >
              Events{enabledEvents.size > 0 ? ` (${enabledEvents.size})` : ""}
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${eventsDropdownOpen ? "rotate-180" : ""}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {eventsDropdownOpen &&
              createPortal(
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => setEventsDropdownOpen(false)} />
                  <div
                    className="fixed z-[9999] min-w-[200px] rounded-lg border border-[var(--bp-border-subtle)] bg-[var(--bp-bg-primary)] shadow-xl py-1"
                    style={(() => {
                      const rect = eventsButtonRef.current?.getBoundingClientRect();
                      if (!rect) return {};
                      return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
                    })()}
                  >
                    {NYSE_EVENTS.map((evt) => {
                      const checked = enabledEvents.has(evt.label);
                      return (
                        <button
                          key={evt.label}
                          type="button"
                          onClick={() => {
                            setEnabledEvents((prev) => {
                              const next = new Set(prev);
                              if (next.has(evt.label)) next.delete(evt.label);
                              else next.add(evt.label);
                              return next;
                            });
                          }}
                          className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left text-[11px] hover:bg-[var(--bp-bg-secondary)] transition-colors"
                        >
                          <span
                            className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors ${
                              checked ? "border-transparent" : "border-[var(--bp-border-subtle)]"
                            }`}
                            style={checked ? { backgroundColor: evt.color } : undefined}
                          >
                            {checked && (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            )}
                          </span>
                          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: evt.color }} />
                          <span style={{ color: checked ? evt.color : "var(--bp-text-secondary)" }}>{evt.label}</span>
                          <span className="ml-auto text-[9px] text-[var(--bp-text-muted)]">
                            {String(evt.hour).padStart(2, "0")}:{String(evt.minute).padStart(2, "0")} ET
                          </span>
                        </button>
                      );
                    })}
                    <div className="border-t border-[var(--bp-border-subtle)] mt-1 pt-1 px-3 py-1 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEnabledEvents(new Set(NYSE_EVENTS.map((e) => e.label)))}
                        className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setEnabledEvents(new Set())}
                        className="text-[10px] text-[var(--bp-text-muted)] hover:text-[var(--bp-text-primary)] transition-colors"
                      >
                        None
                      </button>
                    </div>
                  </div>
                </>,
                document.body
              )}
          </div>
        </div>
      </ChartHeader>
      <ChartContent style={{ height: 660 }}>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Mid price over time with bid/ask spread bands per trade size — wider bands = more slippage at that size
        </p>
        <div
          ref={containerRef}
          className="w-full h-[560px] relative"
          style={{
            cursor: zoomRange.isSelecting ? "crosshair" : undefined,
            pointerEvents: eventsDropdownOpen ? "none" : undefined,
          }}
          onContextMenu={handleContextMenu}
          onClick={handleChartClick}
        >
          {zoomRange.isSelecting && (
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2"
              style={{
                background: "#14b8a6",
                color: "#fff",
                boxShadow: "0 2px 8px rgba(20, 184, 166, 0.4)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              Click to select end of range (Esc to cancel)
            </div>
          )}
          {activeZoom && !zoomRange.isSelecting && (
            <button
              className="absolute top-2 right-4 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-105"
              style={{
                background: "rgba(255,255,255,0.1)",
                color: "var(--bp-text-primary)",
                border: "1px solid var(--bp-border-subtle)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleResetZoom();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              Reset Zoom
            </button>
          )}
          {zoomRange.isSelecting &&
            zoomRange.startIndex !== null &&
            hoverIdx !== null &&
            (() => {
              let displayStartIndex = zoomRange.startIndex;
              if (activeZoom) {
                const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
                displayStartIndex = zoomRange.startIndex - zoomStart;
              }
              const startPt =
                visiblePoints[Math.max(0, Math.min(displayStartIndex, visiblePoints.length - 1))];
              const endPt = visiblePoints[Math.max(0, Math.min(hoverIdx, visiblePoints.length - 1))];
              if (!startPt || !endPt) return null;
              const startX = (xScale(startPt.timestamp) ?? 0) + margin.left;
              const endX = (xScale(endPt.timestamp) ?? 0) + margin.left;
              const left = Math.min(startX, endX);
              const selectionWidth = Math.abs(endX - startX);
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left,
                    top: margin.top,
                    width: Math.max(2, selectionWidth),
                    height: innerH,
                    background: "rgba(20, 184, 166, 0.12)",
                    borderLeft: "2px solid #14b8a6",
                    borderRight: "2px solid #14b8a6",
                  }}
                />
              );
            })()}
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={yScale}
                  width={innerW}
                  stroke="var(--bp-border-subtle)"
                  strokeDasharray="3,3"
                  strokeOpacity={0.6}
                  numTicks={6}
                />
                {enabledEvents.size > 0 &&
                  eventLines.map((evt, i) => (
                    <g key={`evt-${i}`}>
                      <line
                        x1={evt.x}
                        x2={evt.x}
                        y1={0}
                        y2={innerH}
                        stroke={evt.color}
                        strokeWidth={1}
                        strokeDasharray="4,4"
                        opacity={0.5}
                      />
                      <text
                        x={evt.x + 4}
                        y={12}
                        fill={evt.color}
                        fontSize={9}
                        fontFamily="inherit"
                        fontWeight={600}
                        opacity={0.85}
                      >
                        {evt.label}
                      </text>
                    </g>
                  ))}
                {bandPaths.map(
                  (band) =>
                    band && (
                      <g key={band.notional}>
                        <path
                          d={band.buyPath}
                          fill={band.color.fill}
                          fillOpacity={band.color.opacity}
                          stroke={band.color.stroke}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                        <path
                          d={band.sellPath}
                          fill={band.color.fill}
                          fillOpacity={band.color.opacity}
                          stroke={band.color.stroke}
                          strokeOpacity={0.4}
                          strokeWidth={0.5}
                        />
                      </g>
                    )
                )}
                <LinePath
                  data={visiblePoints}
                  x={(d) => xScale(d.timestamp) ?? 0}
                  y={(d) => yScale(d.midPrice)}
                  curve={curveMonotoneX}
                  stroke="var(--bp-text-primary)"
                  strokeWidth={1.5}
                />
                {showPoolPrice && oracleLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={oracleLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#f97316"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                  />
                )}
                {showKrakenXusd && krakenXusdLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={krakenXusdLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                )}
                {showKrakenSpv && krakenSpvLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={krakenSpvLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#8b5cf6"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                )}
                {showFinnhub && finnhubLine.length > 1 && (
                  <LinePath<{ timestamp: Date; price: number }>
                    data={finnhubLine}
                    x={(d) => xScale(d.timestamp) ?? 0}
                    y={(d) => yScale(d.price)}
                    curve={curveStepAfter}
                    stroke="#10b981"
                    strokeWidth={1.5}
                    strokeDasharray="6,3"
                  />
                )}
                {visiblePoints.map((pt, i) => {
                  const x = xScale(pt.timestamp) ?? 0;
                  const step =
                    visiblePoints.length > 1
                      ? innerW / (visiblePoints.length - 1)
                      : innerW;
                  return (
                    <rect
                      key={i}
                      x={x - step / 2}
                      y={0}
                      width={step}
                      height={innerH}
                      fill="transparent"
                      onMouseEnter={() => setHoverIdx(i)}
                      onMouseLeave={() => setHoverIdx(null)}
                    />
                  );
                })}
                {hoverData && (
                  <>
                    <line
                      x1={hoverData.x}
                      x2={hoverData.x}
                      y1={0}
                      y2={innerH}
                      stroke="var(--bp-text-muted)"
                      strokeWidth={1}
                      strokeDasharray="3,3"
                      opacity={0.5}
                      style={{ pointerEvents: "none" }}
                    />
                    <circle
                      cx={hoverData.x}
                      cy={hoverData.midY}
                      r={4}
                      fill="var(--bp-text-primary)"
                      stroke="var(--bp-bg-primary)"
                      strokeWidth={2}
                      style={{ pointerEvents: "none" }}
                    />
                  </>
                )}
                <AxisLeft
                  scale={yScale}
                  stroke="transparent"
                  tickStroke="transparent"
                  numTicks={6}
                  tickFormat={(v) => `$${Number(v).toFixed(2)}`}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "end" as const,
                    dx: -4,
                  }}
                />
              </Group>
              {showSpreadChart && (
                <Group left={margin.left} top={spreadTop}>
                  <line
                    x1={0}
                    x2={innerW}
                    y1={spreadYScale(0)}
                    y2={spreadYScale(0)}
                    stroke="var(--bp-text-muted)"
                    strokeWidth={0.5}
                    strokeDasharray="4,3"
                    opacity={0.5}
                  />
                  <GridRows
                    scale={spreadYScale}
                    width={innerW}
                    stroke="var(--bp-border-subtle)"
                    strokeDasharray="3,3"
                    strokeOpacity={0.4}
                    numTicks={4}
                  />
                  <defs>
                    <clipPath id="jupz-spread-clip-pos">
                      <rect x={0} y={0} width={innerW} height={spreadYScale(0)} />
                    </clipPath>
                    <clipPath id="jupz-spread-clip-neg">
                      <rect
                        x={0}
                        y={spreadYScale(0)}
                        width={innerW}
                        height={spreadChartH - spreadYScale(0)}
                      />
                    </clipPath>
                  </defs>
                  {spreadXusdData.length > 1 && (
                    <>
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadXusdData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#06b6d4"
                        fillOpacity={0.2}
                        clipPath="url(#jupz-spread-clip-pos)"
                      />
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadXusdData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        clipPath="url(#jupz-spread-clip-neg)"
                      />
                      <LinePath<{ timestamp: Date; bps: number }>
                        data={spreadXusdData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        curve={curveStepAfter}
                        stroke="#06b6d4"
                        strokeWidth={1.5}
                      />
                    </>
                  )}
                  {spreadSpvData.length > 1 && (
                    <>
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadSpvData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#8b5cf6"
                        fillOpacity={0.2}
                        clipPath="url(#jupz-spread-clip-pos)"
                      />
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadSpvData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        clipPath="url(#jupz-spread-clip-neg)"
                      />
                      <LinePath<{ timestamp: Date; bps: number }>
                        data={spreadSpvData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        curve={curveStepAfter}
                        stroke="#8b5cf6"
                        strokeWidth={1.5}
                      />
                    </>
                  )}
                  {spreadTradFiData.length > 1 && (
                    <>
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadTradFiData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#10b981"
                        fillOpacity={0.2}
                        clipPath="url(#jupz-spread-clip-pos)"
                      />
                      <AreaClosed<{ timestamp: Date; bps: number }>
                        data={spreadTradFiData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        y0={() => spreadYScale(0)}
                        yScale={spreadYScale}
                        curve={curveStepAfter}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        clipPath="url(#jupz-spread-clip-neg)"
                      />
                      <LinePath<{ timestamp: Date; bps: number }>
                        data={spreadTradFiData}
                        x={(d) => xScale(d.timestamp) ?? 0}
                        y={(d) => spreadYScale(d.bps)}
                        curve={curveStepAfter}
                        stroke="#10b981"
                        strokeWidth={1.5}
                      />
                    </>
                  )}
                  {visiblePoints.map((pt, i) => {
                    const x = xScale(pt.timestamp) ?? 0;
                    const step =
                      visiblePoints.length > 1
                        ? innerW / (visiblePoints.length - 1)
                        : innerW;
                    return (
                      <rect
                        key={i}
                        x={x - step / 2}
                        y={0}
                        width={step}
                        height={spreadChartH}
                        fill="transparent"
                        onMouseEnter={() => setSpreadHoverIdx(i)}
                        onMouseLeave={() => setSpreadHoverIdx(null)}
                      />
                    );
                  })}
                  {spreadHoverData && (
                    <>
                      <line
                        x1={spreadHoverData.x}
                        x2={spreadHoverData.x}
                        y1={0}
                        y2={spreadChartH}
                        stroke="var(--bp-text-muted)"
                        strokeWidth={1}
                        strokeDasharray="3,3"
                        opacity={0.5}
                        style={{ pointerEvents: "none" }}
                      />
                      {spreadHoverData.xusdBps !== null && (
                        <circle
                          cx={spreadHoverData.x}
                          cy={spreadYScale(spreadHoverData.xusdBps)}
                          r={3.5}
                          fill="#06b6d4"
                          stroke="var(--bp-bg-primary)"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {spreadHoverData.spvBps !== null && (
                        <circle
                          cx={spreadHoverData.x}
                          cy={spreadYScale(spreadHoverData.spvBps)}
                          r={3.5}
                          fill="#8b5cf6"
                          stroke="var(--bp-bg-primary)"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {spreadHoverData.tradFiBps !== null && (
                        <circle
                          cx={spreadHoverData.x}
                          cy={spreadYScale(spreadHoverData.tradFiBps)}
                          r={3.5}
                          fill="#10b981"
                          stroke="var(--bp-bg-primary)"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                    </>
                  )}
                  <AxisBottom
                    top={spreadChartH}
                    scale={xScale}
                    stroke="var(--bp-border-subtle)"
                    tickStroke="transparent"
                    numTicks={Math.min(8, Math.floor(innerW / 100))}
                    tickFormat={(v) => formatAxisTickH(v as Date, spanMs)}
                    tickLabelProps={{
                      fill: "var(--bp-text-muted)",
                      fontSize: 10,
                      fontFamily: "inherit",
                      textAnchor: "middle" as const,
                    }}
                  />
                  <AxisLeft
                    scale={spreadYScale}
                    stroke="transparent"
                    tickStroke="transparent"
                    numTicks={4}
                    tickFormat={(v) => `${Number(v).toFixed(0)} bps`}
                    tickLabelProps={{
                      fill: "var(--bp-text-muted)",
                      fontSize: 9,
                      fontFamily: "inherit",
                      textAnchor: "end" as const,
                      dx: -4,
                    }}
                  />
                  <text x={4} y={-6} fill="var(--bp-text-muted)" fontSize={10} fontFamily="inherit">
                    $10K Buy Deviation (bps)
                  </text>
                </Group>
              )}
              {!showSpreadChart && (
                <Group left={margin.left} top={margin.top}>
                  <AxisBottom
                    top={innerH}
                    scale={xScale}
                    stroke="var(--bp-border-subtle)"
                    tickStroke="transparent"
                    numTicks={Math.min(8, Math.floor(innerW / 100))}
                    tickFormat={(v) => formatAxisTickH(v as Date, spanMs)}
                    tickLabelProps={{
                      fill: "var(--bp-text-muted)",
                      fontSize: 10,
                      fontFamily: "inherit",
                      textAnchor: "middle" as const,
                    }}
                  />
                </Group>
              )}
            </svg>
          )}
          {hoverData && (
            <div
              className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
              style={{
                left: Math.min(margin.left + hoverData.x, width - 220),
                top: margin.top + 8,
                transform: "translateX(-50%)",
              }}
            >
              <div className="text-[var(--bp-text-primary)] font-semibold mb-1">
                {formatDateTimeH(hoverData.point.timestamp)} — Mid $
                {hoverData.point.midPrice.toFixed(4)}
                {hoverData.poolPrice !== null && (
                  <span className="text-[#f97316] ml-2">Pool ${hoverData.poolPrice.toFixed(4)}</span>
                )}
                {hoverData.krakenXusdPrice !== null && (
                  <span className="text-[#06b6d4] ml-2">xUSD ${hoverData.krakenXusdPrice.toFixed(4)}</span>
                )}
                {hoverData.krakenSpvPrice !== null && (
                  <span className="text-[#8b5cf6] ml-2">SPV ${hoverData.krakenSpvPrice.toFixed(4)}</span>
                )}
                {hoverData.finnhubPrice !== null && (
                  <span className="text-[#10b981] ml-2">TradFi ${hoverData.finnhubPrice.toFixed(4)}</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {notionalTiers.map((notional, i) => {
                  const tier = hoverData.point.tiers.get(notional);
                  const mid = hoverData.point.midPrice;
                  const bidPrice = tier?.bidPrice || mid;
                  const askPrice = tier?.askPrice || mid;
                  const color = BAND_COLORS[i % BAND_COLORS.length];
                  const spreadBps = ((bidPrice - askPrice) / mid) * 10000;
                  return (
                    <div key={notional} className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: color.fill }} />
                      <span className="text-[var(--bp-text-muted)]">{formatCompactH(notional)}:</span>
                      <span className="text-[var(--bp-text-secondary)]">
                        ${askPrice.toFixed(4)} — ${bidPrice.toFixed(4)}
                      </span>
                      <span className="text-[var(--bp-text-muted)]">({spreadBps.toFixed(1)} bps)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {spreadHoverData &&
            showSpreadChart &&
            (spreadHoverData.xusdBps !== null ||
              spreadHoverData.spvBps !== null ||
              spreadHoverData.tradFiBps !== null) && (
              <div
                className="absolute pointer-events-none bg-[var(--bp-bg-primary)] border border-[var(--bp-border-subtle)] rounded-lg px-3 py-2 shadow-lg text-[11px] font-mono z-10"
                style={{
                  left: Math.min(margin.left + spreadHoverData.x, width - 200),
                  top: spreadTop - 8,
                  transform: "translateX(-50%) translateY(-100%)",
                }}
              >
                <div className="text-[var(--bp-text-primary)] font-semibold mb-0.5">
                  {formatDateTimeH(spreadHoverData.timestamp)}
                </div>
                <div className="text-[var(--bp-text-muted)] mb-0.5">
                  $10K Buy: ${spreadHoverData.buyPrice.toFixed(4)}
                </div>
                {spreadHoverData.xusdBps !== null && (
                  <div className="text-[#06b6d4]">xUSD Deviation: {spreadHoverData.xusdBps.toFixed(1)} bps</div>
                )}
                {spreadHoverData.spvBps !== null && (
                  <div className="text-[#8b5cf6]">SPV Deviation: {spreadHoverData.spvBps.toFixed(1)} bps</div>
                )}
                {spreadHoverData.tradFiBps !== null && (
                  <div className="text-[#10b981]">TradFi Deviation: {spreadHoverData.tradFiBps.toFixed(1)} bps</div>
                )}
              </div>
            )}
          {contextMenu?.visible && (
            <div
              className="absolute z-50 min-w-[180px] rounded-lg border border-[var(--bp-border-subtle)] shadow-lg backdrop-blur-sm overflow-hidden"
              style={{ left: contextMenu.x, top: contextMenu.y, background: "rgba(15, 23, 42, 0.95)" }}
            >
              <button
                className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2 text-[var(--bp-text-primary)] hover:bg-white/5"
                onClick={() => {
                  handleStartRangeSelect();
                  setContextMenu(null);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                Zoom to Range
              </button>
              {activeZoom && (
                <>
                  <div className="h-px bg-[var(--bp-border-subtle)]" />
                  <button
                    className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2 text-[var(--bp-text-primary)] hover:bg-white/5"
                    onClick={() => {
                      handleResetZoom();
                      setContextMenu(null);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                    Reset Zoom
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3 justify-center mt-2">
          <span className="text-[10px] text-[var(--bp-text-primary)] flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-[var(--bp-text-primary)] rounded" />
            Mid Price
          </span>
          {showPoolPrice && (
            <span className="text-[10px] text-[#f97316] flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px] rounded"
                style={{
                  background:
                    "repeating-linear-gradient(to right, #f97316 0, #f97316 4px, transparent 4px, transparent 7px)",
                }}
              />
              Pool Price
            </span>
          )}
          {showKrakenXusd && (
            <span className="text-[10px] text-[#06b6d4] flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px] rounded"
                style={{
                  background:
                    "repeating-linear-gradient(to right, #06b6d4 0, #06b6d4 6px, transparent 6px, transparent 9px)",
                }}
              />
              Kraken xUSD
            </span>
          )}
          {showKrakenSpv && (
            <span className="text-[10px] text-[#8b5cf6] flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-[2px] rounded"
                style={{
                  background:
                    "repeating-linear-gradient(to right, #8b5cf6 0, #8b5cf6 6px, transparent 6px, transparent 9px)",
                }}
              />
              Kraken SPV
            </span>
          )}
          {notionalTiers.map((notional, i) => {
            const color = BAND_COLORS[i % BAND_COLORS.length];
            return (
              <span
                key={notional}
                className="text-[10px] flex items-center gap-1.5"
                style={{ color: color.fill }}
              >
                <span
                  className="inline-block w-3 h-2 rounded-sm"
                  style={{ backgroundColor: color.fill, opacity: 0.4 }}
                />
                {formatCompactH(notional)}
              </span>
            );
          })}
        </div>
      </ChartContent>
    </ChartCard>
  );
}

// ─── Quote Activity Timeline ─────────────────────────────────────────────────

function JupzQuoteActivityTimeline({
  points,
  uptime,
}: {
  points: JupzHistoryPoint[];
  uptime: JupzUptimeStats;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { width, height } = dimensions;
  const margin = { top: 8, right: 16, bottom: 32, left: 72 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);
  const barH = Math.min(innerH, 32);
  const barY = (innerH - barH) / 2;
  const spanMs =
    points.length > 1
      ? points[points.length - 1].timestamp.getTime() -
        points[0].timestamp.getTime()
      : 0;
  const xScale = useMemo(
    () =>
      scaleTime<number>({
        domain:
          points.length > 1
            ? [points[0].timestamp, points[points.length - 1].timestamp]
            : [new Date(), new Date()],
        range: [0, innerW],
      }),
    [points, innerW]
  );

  return (
    <ChartCard>
      <ChartHeader>
        <ChartTitle>Quote Activity Timeline</ChartTitle>
      </ChartHeader>
      <ChartContent>
        <p className="text-[11px] text-[var(--bp-text-muted)] mb-2">
          Each tick = one capture snapshot. Red zones = gaps where no quotes were received (
          {">"}
          {formatDurationH(uptime.expectedIntervalMs * 2)} between captures).
        </p>
        <div ref={containerRef} className="w-full h-[100px] relative">
          {width > 0 && height > 0 && (
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <rect
                  x={0}
                  y={barY}
                  width={innerW}
                  height={barH}
                  rx={4}
                  fill="var(--bp-bg-secondary)"
                  opacity={0.5}
                />
                {uptime.gaps.map((gap, i) => {
                  const x1 = xScale(gap.start) ?? 0;
                  const x2 = xScale(gap.end) ?? 0;
                  return (
                    <g key={i}>
                      <rect
                        x={x1}
                        y={barY}
                        width={Math.max(x2 - x1, 2)}
                        height={barH}
                        rx={2}
                        fill="#ef4444"
                        fillOpacity={0.2}
                        stroke="#ef4444"
                        strokeOpacity={0.4}
                        strokeWidth={0.5}
                      />
                      {x2 - x1 > 40 && (
                        <text
                          x={(x1 + x2) / 2}
                          y={barY + barH / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#ef4444"
                          fontSize={9}
                          fontFamily="inherit"
                          opacity={0.8}
                        >
                          {formatDurationH(gap.durationMs)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {points.map((pt, i) => {
                  const x = xScale(pt.timestamp) ?? 0;
                  return (
                    <line
                      key={i}
                      x1={x}
                      x2={x}
                      y1={barY + 2}
                      y2={barY + barH - 2}
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      strokeOpacity={0.6}
                      strokeLinecap="round"
                    />
                  );
                })}
                <AxisBottom
                  top={innerH}
                  scale={xScale}
                  stroke="var(--bp-border-subtle)"
                  tickStroke="transparent"
                  numTicks={Math.min(8, Math.floor(innerW / 100))}
                  tickFormat={(v) => formatAxisTickH(v as Date, spanMs)}
                  tickLabelProps={{
                    fill: "var(--bp-text-muted)",
                    fontSize: 10,
                    fontFamily: "inherit",
                    textAnchor: "middle" as const,
                  }}
                />
              </Group>
            </svg>
          )}
        </div>
        {uptime.gaps.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-[var(--bp-text-muted)] mb-1 font-semibold uppercase tracking-wide">
              Detected Gaps ({uptime.gaps.length})
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {uptime.gaps.map((gap, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[11px] font-mono px-2 py-1 rounded bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30"
                >
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <span className="text-[var(--bp-text-secondary)]">
                    {formatDateTimeH(gap.start)} — {formatDateTimeH(gap.end)}
                  </span>
                  <span className="text-red-500 font-semibold ml-auto">
                    {formatDurationH(gap.durationMs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ChartContent>
    </ChartCard>
  );
}
