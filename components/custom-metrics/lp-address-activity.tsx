"use client";

import React, { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { findCandleBucket } from "@/lib/find-candle-bucket";
import { X } from "lucide-react";
import { LinePath, Line } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { Group } from "@visx/group";
import { AxisRight, AxisBottom } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { useChartSettingsStore, ORACLE_SOURCE_LABELS, type OracleSource } from "@/stores/chart-settings-store";
import type { TickLiquidityData, PositionData } from "@/lib/envio-client";
import type { PoolData } from "@/app/api/pool/[address]/route";
import { getExplorerUrl } from "@/lib/pools";
import { 
  calculateDepthBandSeries, 
  calculateDepthBandSeriesFromPositions, 
  simulateImpactPricesFromPositions,
  buildRangeMapFromPositions,
  applyRollbackToRangeMap,
  simulateImpactPricesFromRangeMap,
  type DepthBandPoint,
  type RangeMap,
} from "@/lib/depth-calculator";
import { priceToTick, sqrtPriceX96ToPrice, type LPEventData, type V3SwapEventData } from "@/lib/envio-client";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// OHLC Candlestick data
export interface OHLCDataPoint {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Raw on-chain values for per-candle simulations (optional).
  sqrtPriceX96?: string;
  liquidity?: string;
}

// Depth data at a specific price level
export interface DepthDataPoint {
  timestamp: Date;
  bidDepth: number; // depth at $X on buy side
  askDepth: number; // depth at $X on sell side
}

// Price pegging/deviation data
export interface PeggingDataPoint {
  timestamp: Date;
  twapPrice: number;
  oraclePrice: number;
  deviation: number; // percentage deviation
  smaDeviation: number; // smoothed deviation
}

// LP Activity data per candle bucket
export interface LPActivityDataPoint {
  timestamp: Date;
  mintVolume: number;   // USD value of MINT/INCREASE events
  burnVolume: number;   // USD value of BURN/DECREASE events (absolute)
  netFlow: number;      // mintVolume - burnVolume (positive = net inflow)
}

// Oracle price line data
export interface OraclePricePoint {
  timestamp: Date;
  price: number;
}

// Combined chart data
export interface TradingChartData {
  ohlcData: OHLCDataPoint[];
  oracleData: OraclePricePoint[];
  depthData: DepthDataPoint[];
  peggingData: PeggingDataPoint[];
  depthLevels?: number[]; // Available depth price levels
}

// Tooltip data for crosshair
interface CrosshairData {
  timestamp: Date;
  x: number;
  ohlc?: OHLCDataPoint;
  oracle?: number;
  bidDepth?: number;
  askDepth?: number;
  deviation?: number;
  smaDeviation?: number;
}

// Chart dimensions
interface ChartDimensions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

// ============================================================================
// CONSTANTS & THEME
// ============================================================================

// Premium desaturated brand colors for professional appearance
const BRAND_COLORS = {
  green: "#7DB88F",   // Sage green - muted, sophisticated
  red: "#C98686",     // Dusty rose - soft, not alarming  
  purple: "#8B7BA1",  // Dusty purple - refined, from LP palette
  bronze: "#C49052",  // Warm bronze - for highlights
  teal: "#6B8E9B",    // Slate teal - for LP ranges
  oracle: "#E8A838",  // Golden amber - distinctive oracle line color
};

type ResolvedThemeMode = "light" | "dark";

type ChartTheme = {
  mode: ResolvedThemeMode;
  background: string;
  panelBg: string;
  divider: string;
  gridLine: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  candleUp: string;
  candleDown: string;
  oracleLine: string;
  deviationLine: string;
  bidDepth: string;
  askDepth: string;
  crosshair: string;
  lpRangeLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  areaOpacity: number;
  bandOpacity: number;
};

type ChartThemeWithOracle = ChartTheme & {
  __oracleMinPct?: number;
  __oracleMaxPct?: number;
};

const getChartTheme = (mode: ResolvedThemeMode): ChartTheme => {
  if (mode === "light") {
    return {
      mode,
      background: "#F8FAFC",
      panelBg: "#FFFFFF",
      divider: "#E2E8F0",
      gridLine: "#E5E7EB",
      textPrimary: "#0F172A",
      textSecondary: "#475569",
      textMuted: "#64748B",
      candleUp: BRAND_COLORS.green,
      candleDown: BRAND_COLORS.red,
      oracleLine: BRAND_COLORS.oracle,
      deviationLine: "#0F172A",
      bidDepth: BRAND_COLORS.green,
      askDepth: BRAND_COLORS.red,
      crosshair: "#94A3B8",
      lpRangeLine: BRAND_COLORS.teal,
      tooltipBg: "rgba(255, 255, 255, 0.5)",
      tooltipBorder: "rgba(148, 163, 184, 0.45)",
      areaOpacity: 0.65,
      bandOpacity: 0.28,
    };
  }

  return {
    mode,
    background: "#0B1220",
    panelBg: "#0F172A",
    divider: "#1F2937",
    gridLine: "#263241",
    textPrimary: "#E5E7EB",
    textSecondary: "#A1A1AA",
    textMuted: "#71717A",
    candleUp: BRAND_COLORS.green,
    candleDown: BRAND_COLORS.red,
    oracleLine: BRAND_COLORS.oracle,
    deviationLine: "#E5E7EB",
    bidDepth: BRAND_COLORS.green,
    askDepth: BRAND_COLORS.red,
    crosshair: "#6B7280",
    lpRangeLine: "#7A9EB5", // Steel blue - premium feel in dark mode
    tooltipBg: "rgba(15, 23, 42, 0.5)",
    tooltipBorder: "rgba(55, 65, 81, 0.55)",
    areaOpacity: 0.45,
    bandOpacity: 0.18,
  };
};

const LIGHT_THEME = getChartTheme("light");

const DEFAULT_MARGIN = { top: 10, right: 60, bottom: 20, left: 10 };

// Shared hover utility (all chart panels)
const findNearestIndex = (
  data: { timestamp: Date }[],
  xScale: ReturnType<typeof scaleTime<number>>,
  mouseX: number
): number => {
  if (data.length === 0) return 0;

  let nearestIndex = 0;
  let nearestDistance = Infinity;

  data.forEach((d, i) => {
    const x = xScale(d.timestamp) ?? 0;
    const distance = Math.abs(x - mouseX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  });

  return nearestIndex;
};

// LP Range type
export interface LPRange {
  upper: number;
  lower: number;
  owner?: string;
}

// ============================================================================
// CONTEXT MENU & ANCHOR POINT TYPES
// ============================================================================

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  dataIndex: number;
}

interface AnchorPoint {
  index: number;
  timestamp: Date;
  price: number;
  oraclePrice?: number;
  volume: number;
  deviation?: number;
  bidDepth?: number;
  askDepth?: number;
}

interface DrillDownState {
  visible: boolean;
  dataIndex: number;
}

interface ZoomRangeState {
  isSelecting: boolean;
  startIndex: number | null;
  endIndex: number | null;
}

interface ActiveZoom {
  startIndex: number;
  endIndex: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatPrice = (price: number): string => {
  if (price >= 1000) return `$${price.toFixed(0)}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
};

// Tooltip-only: show more precision so values don't collapse to the same rounded number
// on tight ranges (common on high-priced assets).
const formatTooltipPrice = (price: number): string => {
  if (!Number.isFinite(price)) return "-";
  if (price >= 1000) return `$${price.toFixed(2)}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(6)}`;
};

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatDateTime = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatUsdCompact = (usd: number): string => {
  const v = Number(usd);
  if (!Number.isFinite(v)) return "$0";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

const formatSignedPct = (pct: number): string => {
  if (!Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
};

const formatLiquidityCompact = (liq: bigint): string => {
  const abs = liq < 0n ? -liq : liq;
  const num = Number(abs);
  if (num >= 1e18) return `${(num / 1e18).toFixed(1)}E`;
  if (num >= 1e15) return `${(num / 1e15).toFixed(1)}P`;
  if (num >= 1e12) return `${(num / 1e12).toFixed(1)}T`;
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K`;
  return num.toFixed(0);
};

const EVM_TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

function getLpEventTxCandidate(eventId: string | undefined): string | null {
  if (!eventId) return null;
  if (EVM_TX_HASH_RE.test(eventId) || SOLANA_SIGNATURE_RE.test(eventId)) return eventId;

  const dashPrefix = eventId.includes("-") ? eventId.split("-")[0] : null;
  if (dashPrefix && EVM_TX_HASH_RE.test(dashPrefix)) return dashPrefix;

  const colonSignature = eventId
    .split(":")
    .find((part) => SOLANA_SIGNATURE_RE.test(part));
  return colonSignature ?? null;
}

function getLpEventExplorerUrl(event: LPEventData, poolKey?: string | null): string {
  const explorerPoolKey = poolKey || event.owner;
  const txCandidate = getLpEventTxCandidate(event.id);

  if (txCandidate) {
    return getExplorerUrl(explorerPoolKey, "tx", txCandidate);
  }

  return getExplorerUrl(explorerPoolKey, "address", event.owner);
}

// ============================================================================
// CHART CONTEXT MENU COMPONENT
// ============================================================================

interface ChartContextMenuProps {
  x: number;
  y: number;
  onSetAnchor: () => void;
  onViewDetails: () => void;
  onStartRangeSelect: () => void;
  onLockRange: () => void;
  hasRanges: boolean;
  onClose: () => void;
  theme: ChartTheme;
}

const ChartContextMenu: React.FC<ChartContextMenuProps> = ({
  x,
  y,
  onSetAnchor,
  onViewDetails,
  onStartRangeSelect,
  onLockRange,
  hasRanges,
  onClose,
  theme,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    // Delay adding listeners to avoid immediate trigger
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute z-50 min-w-[180px] rounded-lg border shadow-lg backdrop-blur-sm overflow-hidden"
      style={{
        left: x,
        top: y,
        background: theme.mode === "light" ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.95)",
        borderColor: theme.divider,
      }}
    >
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2"
        style={{ color: theme.textPrimary }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={() => {
          onSetAnchor();
          onClose();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
        Set as Comparison Anchor
      </button>
      <div className="h-px" style={{ background: theme.divider }} />
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2"
        style={{ color: theme.textPrimary }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={() => {
          onViewDetails();
          onClose();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        View Details
      </button>
      <div className="h-px" style={{ background: theme.divider }} />
      <button
        className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2"
        style={{ color: theme.textPrimary }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={() => {
          onStartRangeSelect();
          onClose();
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
      {hasRanges && (
        <>
          <div className="h-px" style={{ background: theme.divider }} />
          <button
            className="w-full px-4 py-2.5 text-left text-sm font-medium transition-colors flex items-center gap-2"
            style={{ color: theme.textPrimary }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            onClick={() => {
              onLockRange();
              onClose();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Lock Range
          </button>
        </>
      )}
    </div>
  );
};

// ============================================================================
// DRILL-DOWN DRAWER COMPONENT
// ============================================================================

interface DrillDownDrawerProps {
  visible: boolean;
  dataIndex: number;
  data: TradingChartData;
  theme: ChartTheme;
  onClose: () => void;
  anchorXPercent?: number; // 0-1, position of anchor as percentage of chart width
  lpEvents?: LPEventData[];
  v3Swaps?: V3SwapEventData[];
  poolData?: PoolData | null;
}

const DrillDownDrawer: React.FC<DrillDownDrawerProps> = ({
  visible,
  dataIndex,
  data,
  theme,
  onClose,
  anchorXPercent = 0.5,
  lpEvents = [],
  v3Swaps = [],
  poolData,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const ohlc = data.ohlcData[dataIndex];
  const oracle = data.oracleData[dataIndex];
  const depth = data.depthData[dataIndex];
  const pegging = data.peggingData[dataIndex];

  if (!ohlc) return null;

  // Filter events for this candle's time window (5-min interval)
  const candleStartTs = Math.floor(ohlc.timestamp.getTime() / 1000);
  const candleEndTs = candleStartTs + 300; // 5 minutes

  const candleLpEvents = lpEvents.filter(
    (e) => e.timestamp >= candleStartTs && e.timestamp < candleEndTs
  );

  const candleSwaps = v3Swaps.filter(
    (s) => s.timestamp >= candleStartTs && s.timestamp < candleEndTs
  );

  // Calculate swap summary
  const swapCount = candleSwaps.length;
  const totalSwapVolume = candleSwaps.reduce((sum, s) => {
    const amt0 = Math.abs(Number(s.amount0 || 0));
    const amt1 = Math.abs(Number(s.amount1 || 0));
    return sum + Math.max(amt0, amt1);
  }, 0);

  // Count mints vs burns (eventType can be MINT, BURN, INCREASE, DECREASE)
  const mintCount = candleLpEvents.filter((e) => e.eventType === "MINT" || e.eventType === "INCREASE").length;
  const burnCount = candleLpEvents.filter((e) => e.eventType === "BURN" || e.eventType === "DECREASE").length;

  const isUp = ohlc.close >= ohlc.open;

  // Position drawer on opposite side of anchor to keep anchor line visible
  // If anchor is on right half (>60%), show drawer on left; otherwise show on right
  const showOnLeft = anchorXPercent > 0.6;

  return (
    <>
      {/* Transparent click-away area (no blur, no darkening - chart stays visible) */}
      <div
        className="absolute inset-0 z-40"
        onClick={onClose}
        style={{ background: "transparent" }}
      />

      {/* Drawer - position dynamically based on anchor location */}
      <div
        ref={drawerRef}
        className={cn(
          "absolute top-0 bottom-0 z-50 w-72 shadow-xl overflow-y-auto",
          showOnLeft ? "left-0 border-r" : "right-0 border-l"
        )}
        style={{
          background: theme.mode === "light" ? "rgba(255, 255, 255, 0.92)" : "rgba(15, 23, 42, 0.92)",
          borderColor: theme.divider,
          animation: showOnLeft ? "slideInLeft 0.2s ease-out" : "slideInRight 0.2s ease-out",
          backdropFilter: "blur(8px)",
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes slideInLeft {
            from { transform: translateX(-100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        {/* Header */}
        <div className="sticky top-0 z-10 px-4 py-3 border-b flex items-center justify-between"
          style={{
            background: theme.mode === "light" ? "rgba(255, 255, 255, 0.85)" : "rgba(15, 23, 42, 0.85)",
            borderColor: theme.divider,
            backdropFilter: "blur(8px)",
          }}
        >
          <div>
            <h3 className="font-semibold text-sm" style={{ color: theme.textPrimary }}>
              Point Details
            </h3>
            <p className="text-xs mt-0.5" style={{ color: theme.textMuted }}>
              {formatDateTime(ohlc.timestamp)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: theme.textMuted }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Price Section */}
          <div className="rounded-lg p-3" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)" }}>
            <h4 className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: theme.textMuted }}>
              Price Data
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: theme.textSecondary }}>Market Price</span>
                <span className="text-sm font-semibold" style={{ color: isUp ? theme.candleUp : theme.candleDown }}>
                  {formatTooltipPrice(ohlc.close)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: theme.textSecondary }}>Open</span>
                <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{formatTooltipPrice(ohlc.open)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: theme.textSecondary }}>High</span>
                <span className="text-sm font-medium" style={{ color: theme.candleUp }}>{formatTooltipPrice(ohlc.high)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: theme.textSecondary }}>Low</span>
                <span className="text-sm font-medium" style={{ color: theme.candleDown }}>{formatTooltipPrice(ohlc.low)}</span>
              </div>
              {oracle && (
                <div className="flex justify-between items-center pt-1 border-t" style={{ borderColor: theme.divider }}>
                  <span className="text-sm" style={{ color: theme.oracleLine }}>Oracle Price</span>
                  <span className="text-sm font-semibold" style={{ color: theme.textPrimary }}>{formatTooltipPrice(oracle.price)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Volume Section */}
          <div className="rounded-lg p-3" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)" }}>
            <h4 className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: theme.textMuted }}>
              Volume
            </h4>
            <div className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
              {formatUsdCompact(ohlc.volume)}
            </div>
          </div>

          {/* Deviation Section */}
          {pegging && (
            <div className="rounded-lg p-3" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)" }}>
              <h4 className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: theme.textMuted }}>
                Price Deviation
              </h4>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-2xl font-bold"
                  style={{ color: pegging.deviation >= 0 ? theme.candleUp : theme.candleDown }}
                >
                  {formatSignedPct(pegging.deviation)}
                </span>
                <span className="text-xs" style={{ color: theme.textMuted }}>from oracle</span>
              </div>
            </div>
          )}

          {/* Depth Section */}
          {depth && (
            <div className="rounded-lg p-3" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)" }}>
              <h4 className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: theme.textMuted }}>
                Liquidity Depth
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm" style={{ color: theme.bidDepth }}>Bid Depth</span>
                  <span className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                    {formatUsdCompact(depth.bidDepth)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm" style={{ color: theme.askDepth }}>Ask Depth</span>
                  <span className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                    {formatUsdCompact(depth.askDepth)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Activity Section - LP Events & Swaps */}
          <div className="rounded-lg p-3" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.03)" }}>
            <h4 className="text-xs font-medium mb-2 uppercase tracking-wide" style={{ color: theme.textMuted }}>
              Activity
            </h4>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded p-2" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.02)" }}>
                <div className="text-xs" style={{ color: theme.textMuted }}>Swaps</div>
                <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>{swapCount}</div>
              </div>
              <div className="rounded p-2" style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.02)" }}>
                <div className="text-xs" style={{ color: theme.textMuted }}>LP Events</div>
                <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  {mintCount + burnCount}
                  {(mintCount > 0 || burnCount > 0) && (
                    <span className="text-xs font-normal ml-1" style={{ color: theme.textMuted }}>
                      ({mintCount > 0 && <span style={{ color: theme.candleUp }}>+{mintCount}</span>}
                      {mintCount > 0 && burnCount > 0 && " / "}
                      {burnCount > 0 && <span style={{ color: theme.candleDown }}>-{burnCount}</span>})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* LP Events List */}
            {candleLpEvents.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-medium mb-1.5" style={{ color: theme.textSecondary }}>
                  Liquidity Changes
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {candleLpEvents.slice(0, 5).map((event, idx) => {
                    const isMint = event.eventType === "MINT" || event.eventType === "INCREASE";

                    // Calculate USD value from token amounts
                    // amount0 = base token (e.g., WETH), amount1 = quote token (e.g., USDC)
                    const token0Decimals = poolData?.token0Decimals ?? 18;
                    const token1Decimals = poolData?.token1Decimals ?? 6;
                    const currentPrice = ohlc.close; // Use candle close price

                    const amt0Raw = Math.abs(Number(event.amount0 || "0"));
                    const amt1Raw = Math.abs(Number(event.amount1 || "0"));
                    const amt0 = amt0Raw / Math.pow(10, token0Decimals);
                    const amt1 = amt1Raw / Math.pow(10, token1Decimals);

                    // Total USD: amount0 * price + amount1 (assuming token1 is USD-denominated)
                    const usdValue = (amt0 * currentPrice) + amt1;
                    const isPositive = isMint;

                    const explorerUrl = getLpEventExplorerUrl(event, poolData?.poolAddress);

                    return (
                      <div
                        key={event.id || idx}
                        className="flex items-center justify-between text-xs p-1.5 rounded"
                        style={{ background: theme.mode === "light" ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.02)" }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{
                              background: isMint ? `${theme.candleUp}20` : `${theme.candleDown}20`,
                              color: isMint ? theme.candleUp : theme.candleDown,
                            }}
                          >
                            {isMint ? "ADD" : "REMOVE"}
                          </span>
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono hover:underline"
                            style={{ color: theme.textMuted }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {event.owner.slice(0, 6)}...{event.owner.slice(-4)}
                          </a>
                        </div>
                        <span style={{ color: isPositive ? theme.candleUp : theme.candleDown }}>
                          {isPositive ? "+" : "-"}{formatUsdCompact(usdValue)}
                        </span>
                      </div>
                    );
                  })}
                  {candleLpEvents.length > 5 && (
                    <div className="text-xs text-center py-1" style={{ color: theme.textMuted }}>
                      +{candleLpEvents.length - 5} more events
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Swap Activity */}
            {swapCount > 0 && (
              <div>
                <div className="text-xs font-medium mb-1.5" style={{ color: theme.textSecondary }}>
                  Swap Volume
                </div>
                <div className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                  {formatUsdCompact(totalSwapVolume)} in {swapCount} swap{swapCount !== 1 ? "s" : ""}
                </div>
              </div>
            )}

            {/* Empty State */}
            {candleLpEvents.length === 0 && swapCount === 0 && (
              <p className="text-xs text-center py-2" style={{ color: theme.textMuted }}>
                No activity in this period
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// ============================================================================
// ANCHOR INDICATOR COMPONENT
// ============================================================================

interface AnchorIndicatorProps {
  anchor: AnchorPoint | null;
  xScale: ReturnType<typeof scaleTime<number>>;
  height: number;
  margin: typeof DEFAULT_MARGIN;
  theme: ChartTheme;
  onClear: () => void;
}

const AnchorIndicator: React.FC<AnchorIndicatorProps> = ({
  anchor,
  xScale,
  height,
  margin,
  theme,
  onClear,
}) => {
  if (!anchor) return null;

  const x = (xScale(anchor.timestamp) ?? 0) + margin.left;

  return (
    <>
      {/* Vertical anchor line */}
      <div
        className="absolute top-0 w-px pointer-events-none"
        style={{
          left: x,
          height: height - margin.bottom,
          background: `linear-gradient(to bottom, ${BRAND_COLORS.purple}, transparent)`,
          opacity: 0.7,
        }}
      />

      {/* Anchor badge */}
      <div
        className="absolute flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:scale-105"
        style={{
          left: x - 40,
          top: margin.top + 4,
          background: BRAND_COLORS.purple,
          color: "#fff",
          boxShadow: "0 2px 8px rgba(139, 123, 161, 0.4)",
        }}
        onClick={onClear}
        title="Click to clear anchor"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
        <span>Anchor</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
    </>
  );
};

// ============================================================================
// V3-LIKE PRICE IMPACT SIMULATOR (tick-liquidity walk)
// ============================================================================
// This matches the exact approach used in `components/dashboard/price-impact-chart.tsx`,
// but returns a single {buyPrice, sellPrice} result for a given USD-sized order.

const Q96 = BigInt(2) ** BigInt(96);
const MAX_TICK = 887272;

// Port of Uniswap V3 core TickMath.getSqrtRatioAtTick (exact, bigint)
function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < -MAX_TICK || tick > MAX_TICK) throw new Error("TICK");
  const absTick = tick < 0 ? -tick : tick;

  const BI = (v: string) => BigInt(v);
  let ratio =
    (absTick & 0x1) !== 0
      ? BI("0xfffcb933bd6fad37aa2d162d1a594001")
      : BI("0x100000000000000000000000000000000");
  if ((absTick & 0x2) !== 0) ratio = (ratio * BI("0xfff97272373d413259a46990580e213a")) >> BigInt(128);
  if ((absTick & 0x4) !== 0) ratio = (ratio * BI("0xfff2e50f5f656932ef12357cf3c7fdcc")) >> BigInt(128);
  if ((absTick & 0x8) !== 0) ratio = (ratio * BI("0xffe5caca7e10e4e61c3624eaa0941cd0")) >> BigInt(128);
  if ((absTick & 0x10) !== 0) ratio = (ratio * BI("0xffcb9843d60f6159c9db58835c926644")) >> BigInt(128);
  if ((absTick & 0x20) !== 0) ratio = (ratio * BI("0xff973b41fa98c081472e6896dfb254c0")) >> BigInt(128);
  if ((absTick & 0x40) !== 0) ratio = (ratio * BI("0xff2ea16466c96a3843ec78b326b52861")) >> BigInt(128);
  if ((absTick & 0x80) !== 0) ratio = (ratio * BI("0xfe5dee046a99a2a811c461f1969c3053")) >> BigInt(128);
  if ((absTick & 0x100) !== 0) ratio = (ratio * BI("0xfcbe86c7900a88aedcffc83b479aa3a4")) >> BigInt(128);
  if ((absTick & 0x200) !== 0) ratio = (ratio * BI("0xf987a7253ac413176f2b074cf7815e54")) >> BigInt(128);
  if ((absTick & 0x400) !== 0) ratio = (ratio * BI("0xf3392b0822b70005940c7a398e4b70f3")) >> BigInt(128);
  if ((absTick & 0x800) !== 0) ratio = (ratio * BI("0xe7159475a2c29b7443b29c7fa6e889d9")) >> BigInt(128);
  if ((absTick & 0x1000) !== 0) ratio = (ratio * BI("0xd097f3bdfd2022b8845ad8f792aa5825")) >> BigInt(128);
  if ((absTick & 0x2000) !== 0) ratio = (ratio * BI("0xa9f746462d870fdf8a65dc1f90e061e5")) >> BigInt(128);
  if ((absTick & 0x4000) !== 0) ratio = (ratio * BI("0x70d869a156d2a1b890bb3df62baf32f7")) >> BigInt(128);
  if ((absTick & 0x8000) !== 0) ratio = (ratio * BI("0x31be135f97d08fd981231505542fcfa6")) >> BigInt(128);
  if ((absTick & 0x10000) !== 0) ratio = (ratio * BI("0x9aa508b5b7a84e1c677de54f3e99bc9")) >> BigInt(128);
  if ((absTick & 0x20000) !== 0) ratio = (ratio * BI("0x5d6af8dedb81196699c329225ee604")) >> BigInt(128);
  if ((absTick & 0x40000) !== 0) ratio = (ratio * BI("0x2216e584f5fa1ea926041bedfe98")) >> BigInt(128);
  if ((absTick & 0x80000) !== 0) ratio = (ratio * BI("0x48a170391f7dc42444e8fa2")) >> BigInt(128);

  if (tick > 0) ratio = ((BigInt(2) ** BigInt(256)) - BigInt(1)) / ratio;

  // Downcast from Q128.128 to Q64.96 with rounding up
  const roundBit = ratio & ((BigInt(1) << BigInt(32)) - BigInt(1));
  let sqrtPriceX96 = ratio >> BigInt(32);
  if (roundBit !== BigInt(0)) sqrtPriceX96 += BigInt(1);
  return sqrtPriceX96;
}

function mulDiv(a: bigint, b: bigint, denom: bigint): bigint {
  return (a * b) / denom;
}

// amount1 for moving sqrtP up/down within a range (Q96). Returns token1 raw units.
function amount1Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity, b - a, Q96);
}

// amount0 for moving sqrtP up/down within a range (Q96). Returns token0 raw units.
function amount0Delta(liquidity: bigint, sqrtPA: bigint, sqrtPB: bigint): bigint {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  // (L << 96) * (b - a) / (b * a)
  return mulDiv(liquidity << BigInt(96), b - a, b * a);
}

const numberToRawBigint = (amount: number, decimals: number): bigint => {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const d = Math.max(0, Math.floor(decimals));
  // Keep float rounding bounded: take up to 6 decimal places from JS number, then scale.
  const p = Math.min(6, d);
  const scaled = Math.round(amount * 10 ** p);
  let out = BigInt(Math.max(0, scaled));
  const rem = d - p;
  if (rem > 0) out *= 10n ** BigInt(rem);
  return out;
};

const simulateImpactPricesUsd = (args: {
  tickData: TickLiquidityData[];
  currentTick: number;
  sqrtPriceX96: string;
  liquidity: string;
  token0Decimals: number;
  token1Decimals: number;
  currentPrice: number; // token1 per token0 (human)
  orderUsd: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
}): { buyPrice: number; sellPrice: number } => {
  const {
    tickData,
    currentTick,
    sqrtPriceX96,
    liquidity,
    token0Decimals,
    token1Decimals,
    currentPrice,
    orderUsd,
    token0UsdPrice,
    token1UsdPrice,
  } = args;

  if (!tickData || tickData.length === 0) return { buyPrice: NaN, sellPrice: NaN };
  if (!Number.isFinite(currentTick)) return { buyPrice: NaN, sellPrice: NaN };

  let currentSqrtP: bigint;
  let L0: bigint;
  try {
    currentSqrtP = BigInt(sqrtPriceX96);
    L0 = BigInt(liquidity);
  } catch {
    return { buyPrice: NaN, sellPrice: NaN };
  }

  // Map tick -> liquidityNet
  const netByTick = new Map<number, bigint>();
  for (const t of tickData) {
    try {
      netByTick.set(t.tick, BigInt(t.liquidityNet));
    } catch {
      // ignore malformed
    }
  }
  const sortedTicks = [...netByTick.keys()].sort((a, b) => a - b);
  if (sortedTicks.length === 0) return { buyPrice: NaN, sellPrice: NaN };

  // Convert USD to raw token amounts, using actual USD prices when available.
  // Without USD prices, falls back to assuming token1 ≈ USD (correct for stablecoin pairs).
  const t0Usd = typeof token0UsdPrice === "number" && Number.isFinite(token0UsdPrice) && token0UsdPrice > 0 ? token0UsdPrice : null;
  const t1Usd = typeof token1UsdPrice === "number" && Number.isFinite(token1UsdPrice) && token1UsdPrice > 0 ? token1UsdPrice : null;

  // Buy side (token1 in): convert USD to token1 amount
  const token1Amount = t1Usd !== null ? orderUsd / t1Usd : orderUsd;
  const amount1InRaw = numberToRawBigint(token1Amount, token1Decimals);

  // Sell side (token0 in): convert USD to token0 amount
  let token0Amount: number;
  if (t0Usd !== null) {
    token0Amount = orderUsd / t0Usd;
  } else if (t1Usd !== null && Number.isFinite(currentPrice) && currentPrice > 0) {
    token0Amount = orderUsd / (t1Usd * currentPrice);
  } else {
    token0Amount = Number.isFinite(currentPrice) && currentPrice > 0 ? orderUsd / currentPrice : NaN;
  }
  const amount0InRaw = numberToRawBigint(token0Amount, token0Decimals);

  // Walk up: token1 in, price increases.
  let sqrtPUp = currentSqrtP;
  let L = L0;
  let remaining1 = amount1InRaw;
  for (const t of sortedTicks.filter((x) => x > currentTick)) {
    let sqrtNext: bigint;
    try {
      sqrtNext = getSqrtRatioAtTick(t);
    } catch {
      continue;
    }
    if (sqrtNext === sqrtPUp) continue;

    // If L is zero, you can't consume amount within this range; just cross to next tick.
    const maxIn = L > 0n ? amount1Delta(L, sqrtPUp, sqrtNext) : 0n;
    if (L > 0n && remaining1 <= maxIn) {
      // sqrtTarget = sqrtP + amount1 * Q96 / L
      sqrtPUp = sqrtPUp + (remaining1 * Q96) / L;
      remaining1 = 0n;
      break;
    }
    remaining1 = remaining1 > maxIn ? remaining1 - maxIn : 0n;
    sqrtPUp = sqrtNext;
    const net = netByTick.get(t) ?? 0n;
    L = L + net; // crossing left->right adds liquidityNet
    if (remaining1 === 0n) break;
  }

  // Walk down: token0 in, price decreases.
  let sqrtPDown = currentSqrtP;
  L = L0;
  let remaining0 = amount0InRaw;
  const downTicks = sortedTicks.filter((x) => x <= currentTick).slice().reverse();
  for (const t of downTicks) {
    let sqrtNext: bigint;
    try {
      sqrtNext = getSqrtRatioAtTick(t);
    } catch {
      continue;
    }
    if (sqrtNext === sqrtPDown) continue;

    const maxIn = L > 0n ? amount0Delta(L, sqrtPDown, sqrtNext) : 0n;
    if (L > 0n && remaining0 <= maxIn) {
      // Solve for sqrtTarget (moving down):
      // amount0 = (L<<96) * (sqrtP - sqrtT) / (sqrtP * sqrtT)
      // sqrtT = (B*sqrtP) / (amount0*sqrtP + B), where B = (L<<96)
      const B = L << 96n;
      const denom = remaining0 * sqrtPDown + B;
      if (denom > 0n) sqrtPDown = (B * sqrtPDown) / denom;
      remaining0 = 0n;
      break;
    }
    remaining0 = remaining0 > maxIn ? remaining0 - maxIn : 0n;
    sqrtPDown = sqrtNext;
    const net = netByTick.get(t) ?? 0n;
    L = L - net; // crossing right->left subtracts liquidityNet
    if (remaining0 === 0n) break;
  }

  const buyPrice = sqrtPriceX96ToPrice(sqrtPUp, token0Decimals, token1Decimals);
  const sellPrice = sqrtPriceX96ToPrice(sqrtPDown, token0Decimals, token1Decimals);

  return { buyPrice, sellPrice };
};

// ============================================================================
// OHLC CANDLESTICK CHART COMPONENT
// ============================================================================

interface OHLCChartProps {
  data: OHLCDataPoint[];
  oracleData: OraclePricePoint[];
  lpRanges?: LPRange[];
  depthBand?: DepthBandPoint[] | null;
  impactBand?: (DepthBandPoint & { basePrice?: number })[] | null;
  impactBandSwapUsd?: number;
  showCandles?: boolean;
  showOracleBand?: boolean;
  showOracleLine?: boolean;
  showPositionRanges?: boolean;
  lockedRanges?: Set<number>;
  width: number;
  height: number;
  margin?: typeof DEFAULT_MARGIN;
  xScale: ReturnType<typeof scaleTime<number>>;
  hoveredIndex: number | null;
  hoverTimestamp: Date | null;
  onHover: (index: number | null, x: number) => void;
  theme: ChartTheme;
  focusHeightRatio?: number;
  minRangeRatioForSplit?: number;
  minCandleBodyPx?: number;
}

const OHLCChart: React.FC<OHLCChartProps> = ({
  data,
  oracleData,
  lpRanges = [],
  depthBand = null,
  impactBand = null,
  impactBandSwapUsd = 10_000,
  showCandles = true,
  showOracleBand = true,
  showOracleLine = true,
  showPositionRanges = true,
  lockedRanges,
  width,
  height,
  margin = DEFAULT_MARGIN,
  xScale,
  hoveredIndex,
  hoverTimestamp,
  onHover,
  theme,
  focusHeightRatio = 0.86,
  minRangeRatioForSplit = 2.0,
  // Default higher so low-volatility pools don't look like a flat line.
  minCandleBodyPx = 8,
}) => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  

  if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

  const isFinitePositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  // Safe min/max that avoid call-stack overflow from Math.max(...hugeArray)
  const safeMax = (arr: number[]) => arr.reduce((m, v) => (v > m ? v : m), -Infinity);
  const safeMin = (arr: number[]) => arr.reduce((m, v) => (v < m ? v : m), Infinity);

  const safeX = (ts: Date) => {
    const x = xScale(ts);
    return Number.isFinite(x as number) ? (x as number) : 0;
  };

  const safeY = (p: number) => {
    const y = yForPrice(p);
    return Number.isFinite(y as number) ? (y as number) : 0;
  };

  const getBaseline = (i: number, fallback: number) => {
    const o = oracleData[i]?.price;
    if (isFinitePositive(o)) return o;
    const c = data[i]?.close;
    if (isFinitePositive(c)) return c;
    const oLast = oracleData[oracleData.length - 1]?.price;
    if (isFinitePositive(oLast)) return oLast;
    const cLast = data[data.length - 1]?.close;
    if (isFinitePositive(cLast)) return cLast;
    return fallback;
  };

  const getBaselineAt = (ts: Date, fallback: number) => {
    if (!ts) return fallback;
    const t = ts.getTime();
    let best = fallback;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < oracleData.length; i++) {
      const p = oracleData[i];
      if (!p) continue;
      const dt = Math.abs(p.timestamp.getTime() - t);
      if (dt < bestDist) {
        bestDist = dt;
        if (isFinitePositive(p.price)) best = p.price;
      }
    }
    if (Number.isFinite(bestDist) && bestDist !== Number.POSITIVE_INFINITY) return best;
    // Fall back to candle close nearest by time
    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      if (!d) continue;
      const dt = Math.abs(d.timestamp.getTime() - t);
      if (dt < bestDist) {
        bestDist = dt;
        if (isFinitePositive(d.close)) best = d.close;
      }
    }
    return best;
  };

  const oracleMinPct = (theme as ChartThemeWithOracle).__oracleMinPct ?? -1;
  const oracleMaxPct = (theme as ChartThemeWithOracle).__oracleMaxPct ?? 1;

  // Compute a padded [min,max] domain for price charts.
  // We want enough padding for readability, but not so much that low-volatility series look "flat".
  const paddedDomain = (
    minV: number,
    maxV: number,
    opts?: {
      // Minimum padding as a fraction of the mid price (e.g. 0.001 = ±0.1%).
      minMidPct?: number;
      // Additional padding as a fraction of the observed range (e.g. 0.2 = add 20% of range).
      rangeFrac?: number;
    }
  ): [number, number] => {
    const minMidPct = opts?.minMidPct ?? 0.001;
    const rangeFrac = opts?.rangeFrac ?? 0.2;

    const min = Number.isFinite(minV) ? minV : 1;
    const max = Number.isFinite(maxV) ? maxV : 1;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);

    const mid = (lo + hi) / 2;
    const range = Math.max(1e-18, hi - lo);
    const padAbs = Math.max(Math.abs(mid) * minMidPct, range * rangeFrac);

    // Prices should be > 0, but keep this defensive.
    const paddedLo = Math.max(1e-18, lo - padAbs);
    const paddedHi = Math.max(paddedLo + 1e-18, hi + padAbs);
    return [paddedLo, paddedHi];
  };

  // Focus range = what we want readable (candles + oracle + impact band).
  // Important: if LP ranges are extreme (e.g. very wide ticks), we may "split" the y-scale to keep
  // the focus region readable. The impact band must stay inside the focus region; otherwise it can look
  // artificially capped/compressed at the LP range boundaries.
  const focusImpactPrices =
    impactBand && impactBand.length > 0
      ? impactBand.flatMap((d) => [d.buyPrice, d.sellPrice]).filter(isFinitePositive)
      : [];
  const focusPrices = [
    ...data.flatMap((d) => [d.high, d.low]).filter(isFinitePositive),
    ...oracleData.map((d) => d.price).filter(isFinitePositive),
    ...focusImpactPrices,
  ];
  const [focusMin, focusMax] = (() => {
    const lo = focusPrices.length ? safeMin(focusPrices) : 1;
    const hi = focusPrices.length ? safeMax(focusPrices) : 1;
    // Default to ±0.1% minimum padding, plus 20% of the observed range.
    // This keeps low-volatility markets readable without zooming out too much.
    return paddedDomain(lo, hi, { minMidPct: 0.001, rangeFrac: 0.2 });
  })();

  // Full range includes LP ranges (which can be far from market)
  // Filter out extreme LP range prices that would distort the chart (e.g., full-range positions with ticks ±887220)
  // Only include LP range prices within 100x of the focus price range
  const focusMid = (focusMin + focusMax) / 2;
  const lpRangeMaxMultiple = 100; // Cap at 100x above/below focus midpoint
  const lpRangePrices = lpRanges
    .flatMap((range) => [range.upper, range.lower])
    .filter((p) => isFinitePositive(p) && p < focusMid * lpRangeMaxMultiple && p > focusMid / lpRangeMaxMultiple);
  const impactPrices =
    impactBand && impactBand.length > 0
      ? impactBand.flatMap((d) => [d.buyPrice, d.sellPrice]).filter(isFinitePositive)
      : [];
  const allPrices = [
    ...data.flatMap((d) => [d.high, d.low]).filter(isFinitePositive),
    ...oracleData.map((d) => d.price).filter(isFinitePositive),
    ...lpRangePrices, // Already filtered above
    ...impactPrices,
  ];
  const [minPrice, maxPrice] = (() => {
    const lo = allPrices.length ? safeMin(allPrices) : 1;
    const hi = allPrices.length ? safeMax(allPrices) : 1;
    // Full domain includes LP ranges/outliers; keep padding conservative.
    return paddedDomain(lo, hi, { minMidPct: 0.001, rangeFrac: 0.05 });
  })();

  const focusRange = Math.max(1e-12, focusMax - focusMin);
  const fullRange = Math.max(1e-12, maxPrice - minPrice);
  const rangeRatio = fullRange / focusRange;

  const shouldSplit = Number.isFinite(rangeRatio) && rangeRatio >= Math.max(1, minRangeRatioForSplit);

  // If LP ranges are far from price, keep candles/oracle readable by reserving
  // most of the vertical space for the "focus" range and compressing outliers.
  const aboveOut = Math.max(0, maxPrice - focusMax);
  const belowOut = Math.max(0, focusMin - minPrice);
  const remaining = innerHeight * (1 - Math.min(0.98, Math.max(0.5, focusHeightRatio)));
  const denom = aboveOut + belowOut;
  const remTop = shouldSplit && denom > 0 ? remaining * (aboveOut / denom) : 0;
  const remBottom = shouldSplit && denom > 0 ? remaining - remTop : 0;
  const focusTopY = remTop;
  const focusBottomY = innerHeight - remBottom;

  const yScale = scaleLinear({
    domain: shouldSplit ? [focusMin, focusMax] : [minPrice, maxPrice],
    range: shouldSplit ? [focusBottomY, focusTopY] : [innerHeight, 0],
    nice: true,
  });

  const yScaleAbove =
    shouldSplit && aboveOut > 0
      ? scaleLinear({
          domain: [focusMax, maxPrice],
          range: [focusTopY, 0],
        })
      : null;

  const yScaleBelow =
    shouldSplit && belowOut > 0
      ? scaleLinear({
          domain: [minPrice, focusMin],
          range: [innerHeight, focusBottomY],
        })
      : null;

  const yForPrice = (p: number) => {
    if (!shouldSplit) return yScale(p);
    if (p > focusMax && yScaleAbove) return yScaleAbove(p);
    if (p < focusMin && yScaleBelow) return yScaleBelow(p);
    return yScale(p);
  };

  // Clamp any price to the computed full domain so our SVG paths never see Infinity/NaN.
  // This avoids self-intersecting filled polygons which can render as visible "holes" in SVG.
  const clampToFullDomain = (p: number, fallback: number) => {
    const v = Number.isFinite(p) ? p : fallback;
    if (!Number.isFinite(v)) return fallback;
    return Math.min(maxPrice, Math.max(minPrice, v));
  };

  // Handle mouse interaction
  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;

    // Find nearest data point
    const nearestIndex = findNearestIndex(data, xScale, mouseX);
    onHover(nearestIndex, (xScale(data[nearestIndex].timestamp) ?? 0) + margin.left);
  };

  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.panelBg} />

      <Group left={margin.left} top={margin.top}>
        {/* Grid lines */}
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke={theme.gridLine}
          strokeOpacity={0.5}
          numTicks={5}
        />

        {/* Impact band for a fixed USD order size (drawn behind candles) */}
        {impactBand && impactBand.length > 0 && (
          <>
            {/*
              Baseline is the market price (candle close) - NOT the oracle price.
              The impact bands show $10k buy/sell from market price.
            */}
            {(() => {
              // Build a "sanitized" series that guarantees:
              // - finite x/y coordinates
              // - buy >= baseline >= sell (in displayed units)
              // This prevents self-intersecting polygons (the usual source of SVG "holes").
              const n = impactBand.length;
              const pts = impactBand.map((d, i) => {
                // Use candle close (market price) as baseline, NOT oracle price
                const candleClose = data?.[i]?.close;
                const baseRaw =
                  (d as any)?.basePrice && isFinitePositive((d as any).basePrice)
                    ? Number((d as any).basePrice)
                    : isFinitePositive(candleClose) 
                      ? candleClose 
                      : (d.buyPrice + d.sellPrice) / 2;
                const base = clampToFullDomain(baseRaw, baseRaw);
                let buy = clampToFullDomain(d.buyPrice, base);
                let sell = clampToFullDomain(d.sellPrice, base);

                // Force consistent convention regardless of inversion or weird sims.
                if (buy < base && sell > base) {
                  const tmp = buy;
                  buy = sell;
                  sell = tmp;
                }
                buy = Math.max(buy, base);
                sell = Math.min(sell, base);

                return { timestamp: d.timestamp, x: safeX(d.timestamp), base, buy, sell };
              });

              const buildBandPath = (
                upper: (p: (typeof pts)[number]) => number,
                lower: (p: (typeof pts)[number]) => number
              ) => {
                if (n === 0) return "";
                let path = `M ${pts[0]!.x} ${safeY(lower(pts[0]!))}`;
                for (let i = 0; i < n; i++) path += ` L ${pts[i]!.x} ${safeY(lower(pts[i]!))}`;
                for (let i = n - 1; i >= 0; i--) path += ` L ${pts[i]!.x} ${safeY(upper(pts[i]!))}`;
                path += " Z";
                return path;
              };

              // Buy band: baseline -> buy (green, "up")
              const buyPath = buildBandPath((p) => p.buy, (p) => p.base);
              // Sell band: sell -> baseline (red, "down")
              const sellPath = buildBandPath((p) => p.base, (p) => p.sell);

              return (
                <>
                  <path
                    d={buyPath}
                    fill={theme.candleUp}
                    fillOpacity={theme.bandOpacity}
                    fillRule="nonzero"
                    stroke={theme.candleUp}
                    strokeOpacity={0.55}
                    strokeWidth={1}
                  />
                  <path
                    d={sellPath}
                    fill={theme.candleDown}
                    fillOpacity={theme.bandOpacity}
                    fillRule="nonzero"
                    stroke={theme.candleDown}
                    strokeOpacity={0.55}
                    strokeWidth={1}
                  />
                </>
              );
            })()}
          </>
        )}

        {/* Depth band (swap amount -> price range) */}
        {depthBand && depthBand.length > 0 ? (
          <>
            <defs>
              <linearGradient id="depth-band-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#D4A76D" stopOpacity={0.85} />
                <stop offset="100%" stopColor="#C49052" stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <path
              d={`
                M ${xScale(depthBand[0].timestamp) ?? 0} ${yForPrice(depthBand[0].buyPrice)}
                ${depthBand
                  .map((d) => `L ${xScale(d.timestamp) ?? 0} ${yForPrice(d.buyPrice)}`)
                  .join(" ")}
                ${[...depthBand]
                  .reverse()
                  .map((d) => `L ${xScale(d.timestamp) ?? 0} ${yForPrice(d.sellPrice)}`)
                  .join(" ")}
                Z
              `}
              fill="url(#depth-band-gradient)"
              fillOpacity={0.22}
              stroke="#C49052"
              strokeOpacity={0.65}
              strokeWidth={1}
            />
          </>
        ) : null}

        {/* Market Price Line (close prices) */}
        {showCandles ? (
          <LinePath
            data={data}
            x={(d: OHLCDataPoint) => xScale(d.timestamp) ?? 0}
            y={(d: OHLCDataPoint) => yForPrice(d.close)}
            stroke={theme.textPrimary}
            strokeWidth={1.5}
            curve={curveMonotoneX}
          />
        ) : null}

        {/* Oracle price line - dashed for distinction from market price */}
        {showOracleLine ? (
          <LinePath
            data={oracleData}
            x={(d: OraclePricePoint) => xScale(d.timestamp) ?? 0}
            y={(d: OraclePricePoint) => yForPrice(d.price)}
            stroke={theme.oracleLine}
            strokeWidth={2}
            strokeDasharray="6,3"
            curve={curveMonotoneX}
          />
        ) : null}

        {/* Crosshair vertical line */}
        {hoveredIndex !== null && hoverTimestamp && (
          <line
            x1={xScale(hoverTimestamp) ?? 0}
            y1={0}
            x2={xScale(hoverTimestamp) ?? 0}
            y2={innerHeight}
            stroke={theme.crosshair}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction area */}
        <rect
          x={0}
          y={0}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHover(null, 0)}
        />

        {/* LP Position Range Lines */}
        {showPositionRanges
          ? lpRanges
              .filter((range) => {
                // Skip full-range positions (extreme ticks) that would render off-chart
                const rangeOk = isFinitePositive(range.upper) && isFinitePositive(range.lower) &&
                  range.upper < focusMid * lpRangeMaxMultiple && range.lower > focusMid / lpRangeMaxMultiple;
                return rangeOk;
              })
              .map((range, idx) => {
                const isLocked = lockedRanges?.has(idx) ?? false;
                const hasAnyLocked = lockedRanges && lockedRanges.size > 0;
                
                // If there are locked ranges, only show locked ones
                if (hasAnyLocked && !isLocked) return null;
                
                const upperY = yForPrice(range.upper);
                const lowerY = yForPrice(range.lower);
                
                return (
                  <g key={`lp-range-${idx}`}>
                    {/* Upper line */}
                    <line
                      x1={0}
                      y1={upperY}
                      x2={innerWidth}
                      y2={upperY}
                      stroke={isLocked ? "#1e293b" : theme.lpRangeLine}
                      strokeWidth={1.5}
                      strokeDasharray={isLocked ? "none" : "6 4"}
                      pointerEvents="none"
                    />
                    {/* Lower line */}
                    <line
                      x1={0}
                      y1={lowerY}
                      x2={innerWidth}
                      y2={lowerY}
                      stroke={isLocked ? "#1e293b" : theme.lpRangeLine}
                      strokeWidth={1.5}
                      strokeDasharray={isLocked ? "none" : "6 4"}
                      pointerEvents="none"
                    />
                  </g>
                );
              })
          : null}
      </Group>

      {/* Y-axis (right side) */}
      <AxisRight
        scale={yScale}
        left={width - margin.right}
        top={margin.top}
        stroke={theme.gridLine}
        tickStroke={theme.gridLine}
        tickLabelProps={() => ({
          fill: theme.textSecondary,
          fontSize: 10,
          textAnchor: "start",
          dx: 4,
        })}
        numTicks={5}
        tickFormat={(v) => formatPrice(Number(v))}
      />

      {/* LP Range Labels for locked ranges */}
      {showPositionRanges && lockedRanges && lockedRanges.size > 0 && (() => {
        const filteredRanges = lpRanges.filter((range) => {
          const rangeOk = isFinitePositive(range.upper) && isFinitePositive(range.lower) &&
            range.upper < focusMid * lpRangeMaxMultiple && range.lower > focusMid / lpRangeMaxMultiple;
          return rangeOk;
        });
        
        const axisX = width - margin.right;
        
        return (
          <g>
            {filteredRanges.map((range, idx) => {
              if (!lockedRanges.has(idx)) return null;
              
              const upperY = yForPrice(range.upper) + margin.top;
              const lowerY = yForPrice(range.lower) + margin.top;
              
              return (
                <g key={`label-${idx}`}>
                  {/* Upper price label */}
                  <foreignObject x={axisX - 2} y={upperY - 12} width={74} height={24}>
                    <div style={{
                      background: "#1e293b",
                      borderRadius: 4,
                      padding: "4px 8px",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: "center",
                      lineHeight: "16px",
                    }}>
                      {formatPrice(range.upper)}
                    </div>
                  </foreignObject>
                  
                  {/* Lower price label */}
                  <foreignObject x={axisX - 2} y={lowerY - 12} width={74} height={24}>
                    <div style={{
                      background: "#1e293b",
                      borderRadius: 4,
                      padding: "4px 8px",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: "center",
                      lineHeight: "16px",
                    }}>
                      {formatPrice(range.lower)}
                    </div>
                  </foreignObject>
                  
                  {/* Range identifier at left */}
                  <foreignObject x={margin.left + 8} y={(upperY + lowerY) / 2 - 12} width={72} height={24}>
                    <div style={{
                      background: "#1e293b",
                      borderRadius: 4,
                      padding: "4px 8px",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: "center",
                      lineHeight: "16px",
                    }}>
                      Range {idx + 1}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        );
      })()}
    </svg>
  );
};

// ============================================================================
// PRICE DEVIATION PANEL (AREA CHART)
// ============================================================================

interface PeggingPanelProps {
  data: PeggingDataPoint[];
  width: number;
  height: number;
  margin?: typeof DEFAULT_MARGIN;
  xScale: ReturnType<typeof scaleTime<number>>;
  hoveredIndex: number | null;
  hoverTimestamp: Date | null;
  hoverData: { timestamp: Date }[];
  onHover: (index: number | null, x: number) => void;
  theme: ChartTheme;
}

const PeggingPanel: React.FC<PeggingPanelProps> = ({
  data,
  width,
  height,
  margin = DEFAULT_MARGIN,
  xScale,
  hoveredIndex,
  hoverTimestamp,
  hoverData,
  onHover,
  theme,
}) => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

  // Calculate deviation range for y-scale (symmetric around 0)
  const maxAbsDeviation = Math.max(
    ...data.map((d) => Math.abs(d.deviation)),
    2 // minimum ±2% range
  );
  const deviationRange = Math.ceil(maxAbsDeviation * 1.2); // Add 20% padding

  const yScale = scaleLinear({
    domain: [-deviationRange, deviationRange],
    range: [innerHeight, 0],
  });

  const zeroY = yScale(0);

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const nearestIndex = findNearestIndex(hoverData, xScale, mouseX);
    onHover(nearestIndex, (xScale(hoverData[nearestIndex]?.timestamp) ?? 0) + margin.left);
  };

  // Build path for positive deviation area (green, above zero line)
  const buildPositiveAreaPath = () => {
    let path = `M ${xScale(data[0].timestamp) ?? 0} ${zeroY}`;
    data.forEach((d) => {
      const x = xScale(d.timestamp) ?? 0;
      const y = d.deviation > 0 ? yScale(d.deviation) : zeroY;
      path += ` L ${x} ${y}`;
    });
    path += ` L ${xScale(data[data.length - 1].timestamp) ?? 0} ${zeroY} Z`;
    return path;
  };

  // Build path for negative deviation area (red, below zero line)
  const buildNegativeAreaPath = () => {
    let path = `M ${xScale(data[0].timestamp) ?? 0} ${zeroY}`;
    data.forEach((d) => {
      const x = xScale(d.timestamp) ?? 0;
      const y = d.deviation < 0 ? yScale(d.deviation) : zeroY;
      path += ` L ${x} ${y}`;
    });
    path += ` L ${xScale(data[data.length - 1].timestamp) ?? 0} ${zeroY} Z`;
    return path;
  };

  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.panelBg} />

      <Group left={margin.left} top={margin.top}>
        {/* Grid lines */}
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke={theme.gridLine}
          strokeOpacity={0.3}
          numTicks={5}
        />

        {/* Zero line (baseline) */}
        <line
          x1={0}
          y1={zeroY}
          x2={innerWidth}
          y2={zeroY}
          stroke={theme.textSecondary}
          strokeWidth={1}
        />

        {/* Positive deviation area (green) */}
        <path
          d={buildPositiveAreaPath()}
          fill={theme.candleUp}
          fillOpacity={theme.areaOpacity}
        />

        {/* Negative deviation area (red) */}
        <path
          d={buildNegativeAreaPath()}
          fill={theme.candleDown}
          fillOpacity={theme.areaOpacity}
        />

        {/* Deviation line */}
        <LinePath
          data={data}
          x={(d: PeggingDataPoint) => xScale(d.timestamp) ?? 0}
          y={(d: PeggingDataPoint) => yScale(d.deviation)}
          stroke={theme.textPrimary}
          strokeWidth={1.5}
          curve={curveMonotoneX}
        />

        {/* Crosshair */}
        {hoveredIndex !== null && hoverTimestamp && (
          <line
            x1={xScale(hoverTimestamp) ?? 0}
            y1={0}
            x2={xScale(hoverTimestamp) ?? 0}
            y2={innerHeight}
            stroke={theme.crosshair}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction area */}
        <rect
          x={0}
          y={0}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHover(null, 0)}
        />
      </Group>

      {/* Y-axis */}
      <AxisRight
        scale={yScale}
        left={width - margin.right}
        top={margin.top}
        stroke={theme.gridLine}
        tickStroke={theme.gridLine}
        tickLabelProps={() => ({
          fill: theme.textSecondary,
          fontSize: 10,
          textAnchor: "start",
          dx: 4,
        })}
        numTicks={5}
        tickFormat={(v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`}
      />

      {/* Panel label */}
      <text x={margin.left + 5} y={margin.top + 12} fill={theme.textSecondary} fontSize={9} fontWeight={500}>
        Price Deviation
      </text>

      {/* Legend */}
      <g transform={`translate(${margin.left + 100}, ${margin.top + 8})`}>
        <rect x={0} y={-6} width={10} height={10} fill={theme.candleUp} fillOpacity={0.75} />
        <text x={14} y={2} fill={theme.textMuted} fontSize={8}>Above Oracle</text>
        <rect x={90} y={-6} width={10} height={10} fill={theme.candleDown} fillOpacity={0.75} />
        <text x={104} y={2} fill={theme.textMuted} fontSize={8}>Below Oracle</text>
      </g>
    </svg>
  );
};

// ============================================================================
// DEPTH LINES PANEL
// ============================================================================

interface DepthLinesPanelProps {
  data: DepthDataPoint[];
  showLines?: boolean;
  showAreas?: boolean;
  width: number;
  height: number;
  margin?: typeof DEFAULT_MARGIN;
  xScale: ReturnType<typeof scaleTime<number>>;
  hoveredIndex: number | null;
  hoverTimestamp: Date | null;
  hoverData: { timestamp: Date }[];
  onHover: (index: number | null, x: number) => void;
  theme: ChartTheme;
}

const DepthLinesPanel: React.FC<DepthLinesPanelProps> = ({
  data,
  showLines = true,
  showAreas = true,
  width,
  height,
  margin = DEFAULT_MARGIN,
  xScale,
  hoveredIndex,
  hoverTimestamp,
  hoverData,
  onHover,
  theme,
}) => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

  let maxDepthRaw = -Infinity;
  for (const d of data) {
    if (d.bidDepth > maxDepthRaw) maxDepthRaw = d.bidDepth;
    if (d.askDepth > maxDepthRaw) maxDepthRaw = d.askDepth;
  }
  const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : 0;

  const yScale = scaleLinear({
    // Avoid degenerate [0, 0] domains which can make yScale return NaN and render SVG "holes".
    domain: [0, maxDepth > 0 ? maxDepth * 1.1 : 1],
    range: [innerHeight, 0],
    nice: true,
  });

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const nearestIndex = findNearestIndex(hoverData, xScale, mouseX);
    onHover(nearestIndex, (xScale(hoverData[nearestIndex]?.timestamp) ?? 0) + margin.left);
  };

  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.panelBg} />

      <Group left={margin.left} top={margin.top}>
        {/* Grid */}
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke={theme.gridLine}
          strokeOpacity={0.3}
          numTicks={3}
        />

        {/* Depth areas (optional) */}
        {showAreas ? (
          <>
            <path
              d={(() => {
                let path = `M ${xScale(data[0].timestamp) ?? 0} ${yScale(0)}`;
                data.forEach((d) => {
                  path += ` L ${xScale(d.timestamp) ?? 0} ${yScale(d.bidDepth)}`;
                });
                path += ` L ${xScale(data[data.length - 1].timestamp) ?? 0} ${yScale(0)} Z`;
                return path;
              })()}
              fill={theme.bidDepth}
              fillOpacity={0.18}
            />
            <path
              d={(() => {
                let path = `M ${xScale(data[0].timestamp) ?? 0} ${yScale(0)}`;
                data.forEach((d) => {
                  path += ` L ${xScale(d.timestamp) ?? 0} ${yScale(d.askDepth)}`;
                });
                path += ` L ${xScale(data[data.length - 1].timestamp) ?? 0} ${yScale(0)} Z`;
                return path;
              })()}
              fill={theme.askDepth}
              fillOpacity={0.18}
            />
          </>
        ) : null}

        {/* Bid/ask lines (optional) */}
        {showLines ? (
          <>
            <LinePath
              data={data}
              x={(d: DepthDataPoint) => xScale(d.timestamp) ?? 0}
              y={(d: DepthDataPoint) => yScale(d.bidDepth)}
              stroke={theme.bidDepth}
              strokeWidth={1.5}
              curve={curveMonotoneX}
            />
            <LinePath
              data={data}
              x={(d: DepthDataPoint) => xScale(d.timestamp) ?? 0}
              y={(d: DepthDataPoint) => yScale(d.askDepth)}
              stroke={theme.askDepth}
              strokeWidth={1.5}
              curve={curveMonotoneX}
            />
          </>
        ) : null}

        {/* Crosshair */}
        {hoveredIndex !== null && hoverTimestamp && (
          <line
            x1={xScale(hoverTimestamp) ?? 0}
            y1={0}
            x2={xScale(hoverTimestamp) ?? 0}
            y2={innerHeight}
            stroke={theme.crosshair}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction area */}
        <rect
          x={0}
          y={0}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHover(null, 0)}
        />
      </Group>

      {/* Y-axis */}
      <AxisRight
        scale={yScale}
        left={width - margin.right}
        top={margin.top}
        stroke={theme.gridLine}
        tickStroke={theme.gridLine}
        tickLabelProps={() => ({
          fill: theme.textSecondary,
          fontSize: 10,
          textAnchor: "start",
          dx: 4,
        })}
        numTicks={3}
        tickFormat={(v) => `$${(Number(v) / 1000).toFixed(0)}k`}
      />

      {/* Legend */}
      <g transform={`translate(${margin.left + 5}, ${margin.top + 10})`}>
        <text fill={theme.textSecondary} fontSize={9} fontWeight={500}>
          Depth {(theme as ChartThemeWithOracle).__oracleMinPct ?? -1}% / {(theme as ChartThemeWithOracle).__oracleMaxPct ?? 1}%
        </text>
        <circle cx={70} cy={-3} r={4} fill={theme.bidDepth} />
        <text x={78} y={0} fill={theme.textMuted} fontSize={8}>
          {(theme as ChartThemeWithOracle).__oracleMinPct ?? -1}%
        </text>
        <circle cx={105} cy={-3} r={4} fill={theme.askDepth} />
        <text x={113} y={0} fill={theme.textMuted} fontSize={8}>
          {(theme as ChartThemeWithOracle).__oracleMaxPct ?? 1}%
        </text>
      </g>
    </svg>
  );
};

// ============================================================================
// VOLUME PANEL
// ============================================================================

interface VolumePanelProps {
  data: OHLCDataPoint[];
  width: number;
  height: number;
  margin?: typeof DEFAULT_MARGIN;
  xScale: ReturnType<typeof scaleTime<number>>;
  hoveredIndex: number | null;
  hoverTimestamp: Date | null;
  hoverData: { timestamp: Date }[];
  onHover: (index: number | null, x: number) => void;
  theme: ChartTheme;
}

const VolumePanel: React.FC<VolumePanelProps> = ({
  data,
  width,
  height,
  margin = DEFAULT_MARGIN,
  xScale,
  hoveredIndex,
  hoverTimestamp,
  hoverData,
  onHover,
  theme,
}) => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

  let maxVolume = 0;
  for (const d of data) {
    const v = d.volume || 0;
    if (v > maxVolume) maxVolume = v;
  }

  const yScale = scaleLinear({
    domain: [0, maxVolume * 1.1],
    range: [innerHeight, 0],
    nice: true,
  });

  // Calculate bar width
  const barWidth = Math.max(2, (innerWidth / data.length) * 0.7);

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const nearestIndex = findNearestIndex(hoverData, xScale, mouseX);
    onHover(nearestIndex, (xScale(hoverData[nearestIndex]?.timestamp) ?? 0) + margin.left);
  };

  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.panelBg} />

      <Group left={margin.left} top={margin.top}>
        {/* Grid */}
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke={theme.gridLine}
          strokeOpacity={0.3}
          numTicks={3}
        />

        {/* Volume bars */}
        {data.map((d, i) => {
          const x = Math.round((xScale(d.timestamp) ?? 0) * 100) / 100;
          const volHeight = Math.round((innerHeight - yScale(d.volume || 0)) * 100) / 100;

          return (
            <rect
              key={`volume-${i}`}
              x={x - barWidth / 2}
              y={innerHeight - volHeight}
              width={barWidth}
              height={volHeight}
              fill={theme.mode === "light" ? "#CBD5E1" : "#374151"}
              fillOpacity={theme.mode === "light" ? 0.85 : 0.65}
            />
          );
        })}

        {/* Crosshair */}
        {hoveredIndex !== null && hoverTimestamp && (
          <line
            x1={xScale(hoverTimestamp) ?? 0}
            y1={0}
            x2={xScale(hoverTimestamp) ?? 0}
            y2={innerHeight}
            stroke={theme.crosshair}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction area */}
        <rect
          x={0}
          y={0}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHover(null, 0)}
        />
      </Group>

      {/* Y-axis */}
      <AxisRight
        scale={yScale}
        left={width - margin.right}
        top={margin.top}
        stroke={theme.gridLine}
        tickStroke={theme.gridLine}
        tickLabelProps={() => ({
          fill: theme.textSecondary,
          fontSize: 10,
          textAnchor: "start",
          dx: 4,
        })}
        numTicks={3}
        tickFormat={(v) => {
          const val = Number(v);
          if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
          if (val >= 1000) return `$${(val / 1000).toFixed(0)}k`;
          return `$${val.toFixed(0)}`;
        }}
      />

      {/* Panel label */}
      <text x={margin.left + 5} y={margin.top + 12} fill={theme.textSecondary} fontSize={9} fontWeight={500}>
        Volume
      </text>
    </svg>
  );
};

// ============================================================================
// LP ACTIVITY PANEL COMPONENT
// ============================================================================

interface LPActivityPanelProps {
  data: LPActivityDataPoint[];
  width: number;
  height: number;
  margin?: typeof DEFAULT_MARGIN;
  xScale: ReturnType<typeof scaleTime<number>>;
  hoveredIndex: number | null;
  hoverTimestamp: Date | null;
  hoverData: { timestamp: Date }[];
  onHover: (index: number | null, x: number) => void;
  theme: ChartTheme;
}

const LPActivityPanel: React.FC<LPActivityPanelProps> = ({
  data,
  width,
  height,
  margin = DEFAULT_MARGIN,
  xScale,
  hoveredIndex,
  hoverTimestamp,
  hoverData,
  onHover,
  theme,
}) => {
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (data.length === 0 || innerWidth <= 0 || innerHeight <= 0) return null;

  // Symmetric y-scale around zero
  const maxVal = Math.max(
    ...data.map((d) => d.mintVolume),
    ...data.map((d) => d.burnVolume),
    1, // minimum to avoid empty scale
  );

  const yScale = scaleLinear({
    domain: [-maxVal * 1.1, maxVal * 1.1],
    range: [innerHeight, 0],
    nice: true,
  });

  const zeroY = yScale(0);
  const barWidth = Math.max(2, (innerWidth / data.length) * 0.7);

  const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const nearestIndex = findNearestIndex(hoverData, xScale, mouseX);
    onHover(nearestIndex, (xScale(hoverData[nearestIndex]?.timestamp) ?? 0) + margin.left);
  };

  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.panelBg} />

      <Group left={margin.left} top={margin.top}>
        {/* Grid */}
        <GridRows
          scale={yScale}
          width={innerWidth}
          stroke={theme.gridLine}
          strokeOpacity={0.3}
          numTicks={4}
        />

        {/* Zero line */}
        <line
          x1={0}
          y1={zeroY}
          x2={innerWidth}
          y2={zeroY}
          stroke={theme.textSecondary}
          strokeWidth={1}
          strokeOpacity={0.5}
        />

        {/* Diverging bars */}
        {data.map((d, i) => {
          const x = Math.round((xScale(d.timestamp) ?? 0) * 100) / 100;
          const isNetInflow = d.netFlow >= 0;

          const mintHeight = d.mintVolume > 0 ? Math.max(0, zeroY - yScale(d.mintVolume)) : 0;
          const burnHeight = d.burnVolume > 0 ? Math.max(0, yScale(-d.burnVolume) - zeroY) : 0;

          return (
            <g key={`lp-activity-${i}`}>
              {/* Mint bar (up from zero) */}
              {d.mintVolume > 0 && (
                <rect
                  x={x - barWidth / 2}
                  y={zeroY - mintHeight}
                  width={barWidth}
                  height={mintHeight}
                  fill={BRAND_COLORS.green}
                  fillOpacity={isNetInflow ? 0.85 : 0.45}
                  stroke={isNetInflow ? BRAND_COLORS.green : undefined}
                  strokeWidth={isNetInflow ? 0.5 : 0}
                />
              )}
              {/* Burn bar (down from zero) */}
              {d.burnVolume > 0 && (
                <rect
                  x={x - barWidth / 2}
                  y={zeroY}
                  width={barWidth}
                  height={burnHeight}
                  fill={BRAND_COLORS.red}
                  fillOpacity={!isNetInflow ? 0.85 : 0.45}
                  stroke={!isNetInflow ? BRAND_COLORS.red : undefined}
                  strokeWidth={!isNetInflow ? 0.5 : 0}
                />
              )}
            </g>
          );
        })}

        {/* Crosshair */}
        {hoveredIndex !== null && hoverTimestamp && (
          <line
            x1={xScale(hoverTimestamp) ?? 0}
            y1={0}
            x2={xScale(hoverTimestamp) ?? 0}
            y2={innerHeight}
            stroke={theme.crosshair}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Hover interaction area */}
        <rect
          x={0}
          y={0}
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHover(null, 0)}
        />
      </Group>

      {/* Y-axis */}
      <AxisRight
        scale={yScale}
        left={width - margin.right}
        top={margin.top}
        stroke={theme.gridLine}
        tickStroke={theme.gridLine}
        tickLabelProps={() => ({
          fill: theme.textSecondary,
          fontSize: 10,
          textAnchor: "start",
          dx: 4,
        })}
        numTicks={4}
        tickFormat={(v) => {
          const val = Number(v);
          const abs = Math.abs(val);
          const sign = val < 0 ? "-" : "";
          if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
          if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
          if (abs === 0) return "$0";
          return `${sign}$${abs.toFixed(0)}`;
        }}
      />

      {/* Panel label */}
      <text x={margin.left + 5} y={margin.top + 12} fill={theme.textSecondary} fontSize={9} fontWeight={500}>
        LP Activity
      </text>

      {/* Legend */}
      <g transform={`translate(${margin.left + 80}, ${margin.top + 8})`}>
        <rect x={0} y={-6} width={8} height={8} rx={1} fill={BRAND_COLORS.green} fillOpacity={0.75} />
        <text x={12} y={1} fill={theme.textMuted} fontSize={8}>Mint</text>
        <rect x={42} y={-6} width={8} height={8} rx={1} fill={BRAND_COLORS.red} fillOpacity={0.75} />
        <text x={54} y={1} fill={theme.textMuted} fontSize={8}>Burn</text>
      </g>
    </svg>
  );
};

// ============================================================================
// TIME AXIS COMPONENT
// ============================================================================

interface TimeAxisProps {
  width: number;
  height: number;
  margin?: typeof DEFAULT_MARGIN;
  xScale: ReturnType<typeof scaleTime<number>>;
  data: { timestamp: Date }[];
  theme: ChartTheme;
}

const TimeAxis: React.FC<TimeAxisProps> = ({
  width,
  height,
  margin = DEFAULT_MARGIN,
  xScale,
  data,
  theme,
}) => {
  return (
    <svg width={width} height={height}>
      <AxisBottom
        scale={xScale}
        top={0}
        left={margin.left}
        stroke={theme.gridLine}
        tickStroke={theme.gridLine}
        tickLength={3}
        tickLabelProps={() => ({
          fill: theme.textSecondary,
          fontSize: 10,
          textAnchor: "middle",
          dy: -2,
        })}
        numTicks={Math.min(8, data.length)}
        tickFormat={(v) => formatTime(v instanceof Date ? v : new Date(Number(v)))}
      />
    </svg>
  );
};

// ============================================================================
// TOOLTIP / INFO PANEL
// ============================================================================

interface InfoPanelProps {
  data: TradingChartData;
  lpRanges?: LPRange[];
  impactBand?: DepthBandPoint[] | null;
  impactBandSwapUsd?: number;
  hoveredIndex: number | null;
  anchorPoint?: AnchorPoint | null;
  theme: ChartTheme;
  crosshairX?: number | null;
  chartWidth?: number;
}

const InfoPanel: React.FC<InfoPanelProps> = ({
  data,
  lpRanges = [],
  impactBand = null,
  impactBandSwapUsd = 10_000,
  hoveredIndex,
  anchorPoint = null,
  theme,
  crosshairX = null,
  chartWidth = 0,
}) => {
  if (hoveredIndex === null) return null;

  const ohlc = data.ohlcData[hoveredIndex];
  const oracle = data.oracleData[hoveredIndex];
  const depth = data.depthData[hoveredIndex];
  const pegging = data.peggingData[hoveredIndex];

  if (!ohlc) return null;

  const isUp = ohlc.close >= ohlc.open;
  const oracleMinPct = (theme as ChartThemeWithOracle).__oracleMinPct ?? -1;
  const oracleMaxPct = (theme as ChartThemeWithOracle).__oracleMaxPct ?? 1;
  const impactPoint = impactBand?.[Math.min(hoveredIndex, (impactBand?.length ?? 0) - 1)];
  // Use market price (candle close) as baseline for impact band percentages, not oracle
  const baselinePrice = ohlc.close;

  // Calculate deltas from anchor point
  const hasAnchor = anchorPoint !== null;
  const priceDelta = hasAnchor && anchorPoint.price > 0
    ? ((ohlc.close - anchorPoint.price) / anchorPoint.price) * 100
    : null;
  const volumeDelta = hasAnchor && anchorPoint.volume > 0
    ? ((ohlc.volume - anchorPoint.volume) / anchorPoint.volume) * 100
    : null;
  const deviationDelta = hasAnchor && pegging && anchorPoint.deviation !== undefined
    ? pegging.deviation - anchorPoint.deviation
    : null;
  const bidDepthDelta = hasAnchor && depth && anchorPoint.bidDepth && anchorPoint.bidDepth > 0
    ? ((depth.bidDepth - anchorPoint.bidDepth) / anchorPoint.bidDepth) * 100
    : null;
  const askDepthDelta = hasAnchor && depth && anchorPoint.askDepth && anchorPoint.askDepth > 0
    ? ((depth.askDepth - anchorPoint.askDepth) / anchorPoint.askDepth) * 100
    : null;

  // Helper to render delta badge
  const DeltaBadge = ({ value, suffix = "%" }: { value: number | null; suffix?: string }) => {
    if (value === null || !Number.isFinite(value)) return null;
    const isPositive = value > 0;
    const color = isPositive ? theme.candleUp : value < 0 ? theme.candleDown : theme.textMuted;
    return (
      <span
        className="ml-1 px-1 py-0.5 rounded text-[9px] font-semibold"
        style={{
          background: `${color}20`,
          color: color,
        }}
      >
        {isPositive ? "+" : ""}{value.toFixed(2)}{suffix}
      </span>
    );
  };

  // Determine if tooltip should be on the right side (when crosshair is on the left half)
  const showOnRight = crosshairX !== null && chartWidth > 0 && crosshairX < chartWidth / 2;

  return (
    <div
      className={`absolute top-2 backdrop-blur-sm rounded-lg px-3 py-2 text-xs border z-10 pointer-events-none ${showOnRight ? 'right-2' : 'left-2'}`}
      style={{
        background: theme.tooltipBg,
        borderColor: hasAnchor ? BRAND_COLORS.purple : theme.tooltipBorder,
        color: theme.textPrimary,
        boxShadow: hasAnchor ? `0 0 0 1px ${BRAND_COLORS.purple}40` : undefined,
      }}
    >
      {/* Anchor comparison header */}
      {hasAnchor && (
        <div
          className="mb-2 pb-1.5 border-b flex items-center gap-1.5"
          style={{ borderColor: `${BRAND_COLORS.purple}40` }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={BRAND_COLORS.purple} strokeWidth="2.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          <span className="text-[9px] font-medium" style={{ color: BRAND_COLORS.purple }}>
            Comparing to {formatDateTime(anchorPoint.timestamp)}
          </span>
        </div>
      )}

      <div className="mb-1.5 font-medium" style={{ color: theme.textPrimary }}>
        {formatDateTime(ohlc.timestamp)}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="font-medium" style={{ color: theme.textPrimary }}>Market Price:</span>
        <span className="font-semibold" style={{ color: isUp ? theme.candleUp : theme.candleDown }}>
          {formatTooltipPrice(ohlc.close)}
          <DeltaBadge value={priceDelta} />
        </span>
        <span className="font-medium" style={{ color: theme.textPrimary }}>Volume:</span>
        <span className="font-semibold" style={{ color: theme.textPrimary }}>
          ${ohlc.volume >= 1000000
            ? `${(ohlc.volume / 1000000).toFixed(2)}M`
            : ohlc.volume >= 1000
              ? `${(ohlc.volume / 1000).toFixed(0)}k`
              : ohlc.volume.toFixed(0)}
          <DeltaBadge value={volumeDelta} />
        </span>
        {oracle && (
          <>
            <span className="font-medium" style={{ color: theme.oracleLine }}>Oracle:</span>
            <span className="font-semibold" style={{ color: theme.textPrimary }}>{formatTooltipPrice(oracle.price)}</span>
            {impactPoint ? (
              <>
                <span className="font-medium" style={{ color: theme.candleUp }}>
                  Buy ({formatUsdCompact(impactBandSwapUsd)}):
                </span>
                <span className="font-semibold" style={{ color: theme.candleUp }}>
                  {formatTooltipPrice(impactPoint.buyPrice)}{" "}
                  <span className="font-normal opacity-80">
                  {baselinePrice > 0
                    ? `(+${(((impactPoint.buyPrice / baselinePrice) - 1) * 100).toFixed(2)}%)`
                    : ""}
                  </span>
                </span>
                <span className="font-medium" style={{ color: theme.candleDown }}>
                  Sell ({formatUsdCompact(impactBandSwapUsd)}):
                </span>
                <span className="font-semibold" style={{ color: theme.candleDown }}>
                  {formatTooltipPrice(impactPoint.sellPrice)}{" "}
                  <span className="font-normal opacity-80">
                  {baselinePrice > 0
                    ? `(${(((impactPoint.sellPrice / baselinePrice) - 1) * 100).toFixed(2)}%)`
                    : ""}
                  </span>
                </span>
              </>
            ) : (
              <>
            <span className="font-medium" style={{ color: BRAND_COLORS.bronze }}>Oracle {oracleMaxPct}%:</span>
            <span className="font-semibold" style={{ color: theme.textPrimary }}>
              {formatTooltipPrice(oracle.price * (1 + oracleMaxPct / 100))}
            </span>
            <span className="font-medium" style={{ color: BRAND_COLORS.bronze }}>Oracle {oracleMinPct}%:</span>
            <span className="font-semibold" style={{ color: theme.textPrimary }}>
              {formatTooltipPrice(oracle.price * (1 + oracleMinPct / 100))}
            </span>
          </>
        )}
          </>
        )}
        {!oracle && impactPoint ? (
          <>
            <span className="font-medium" style={{ color: theme.textPrimary }}>Market Price:</span>
            <span className="font-semibold" style={{ color: isUp ? theme.candleUp : theme.candleDown }}>{formatTooltipPrice(ohlc.close)}</span>
            <span className="font-medium" style={{ color: theme.candleUp }}>
              Buy ({formatUsdCompact(impactBandSwapUsd)}):
            </span>
            <span className="font-semibold" style={{ color: theme.candleUp }}>
              {formatTooltipPrice(impactPoint.buyPrice)}{" "}
              <span className="font-normal opacity-80">
              {baselinePrice > 0 ? `(+${(((impactPoint.buyPrice / baselinePrice) - 1) * 100).toFixed(2)}%)` : ""}
              </span>
            </span>
            <span className="font-medium" style={{ color: theme.candleDown }}>
              Sell ({formatUsdCompact(impactBandSwapUsd)}):
            </span>
            <span className="font-semibold" style={{ color: theme.candleDown }}>
              {formatTooltipPrice(impactPoint.sellPrice)}{" "}
              <span className="font-normal opacity-80">
              {baselinePrice > 0 ? `(${(((impactPoint.sellPrice / baselinePrice) - 1) * 100).toFixed(2)}%)` : ""}
              </span>
            </span>
          </>
        ) : null}
        {lpRanges.length > 0 && (
          <>
            <span className="font-medium" style={{ color: theme.lpRangeLine }}>LP Ranges:</span>
            <span className="font-semibold" style={{ color: theme.textPrimary }}>{lpRanges.length} position{lpRanges.length > 1 ? 's' : ''}</span>
            {lpRanges.slice(0, 2).map((range, idx) => (
              <React.Fragment key={idx}>
                <span className="font-medium" style={{ color: theme.textMuted }}>Range {idx + 1}:</span>
                <span className="font-semibold" style={{ color: theme.textPrimary }}>{formatTooltipPrice(range.lower)} - {formatTooltipPrice(range.upper)}</span>
              </React.Fragment>
            ))}
          </>
        )}
        {pegging && (
          <>
            <span className="font-medium" style={{ color: theme.textPrimary }}>Deviation:</span>
            <span className="font-semibold" style={{ color: pegging.deviation >= 0 ? theme.candleUp : theme.candleDown }}>
              {pegging.deviation >= 0 ? "+" : ""}{pegging.deviation.toFixed(2)}%
              {deviationDelta !== null && (
                <DeltaBadge value={deviationDelta} suffix="pp" />
              )}
            </span>
          </>
        )}
        {depth && (
          <>
            <span className="font-medium" style={{ color: theme.bidDepth }}>Depth {oracleMinPct}%:</span>
            <span className="font-semibold" style={{ color: theme.textPrimary }}>
              ${(depth.bidDepth / 1000).toFixed(0)}k
              <DeltaBadge value={bidDepthDelta} />
            </span>
            <span className="font-medium" style={{ color: theme.askDepth }}>Depth {oracleMaxPct}%:</span>
            <span className="font-semibold" style={{ color: theme.textPrimary }}>
              ${(depth.askDepth / 1000).toFixed(0)}k
              <DeltaBadge value={askDepthDelta} />
            </span>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN TRADING CHART COMPONENT
// ============================================================================

interface TradingChartProps {
  data: TradingChartData;
  lpRanges?: LPRange[];
  depthBand?: DepthBandPoint[] | null;
  impactBand?: DepthBandPoint[] | null;
  impactBandSwapUsd?: number;
  visibility?: {
    candlesticks: boolean;
    oracleBand: boolean;
    oracleLine: boolean;
    positionRanges: boolean;
    depthAreas: boolean;
    bidAskLines: boolean;
  };
  width: number;
  height: number;
  className?: string;
  theme: ChartTheme;
  focusHeightRatio?: number;
  minRangeRatioForSplit?: number;
  minCandleBodyPx?: number;
  // Events for drill-down drawer activity display
  lpEvents?: LPEventData[];
  v3Swaps?: V3SwapEventData[];
  poolData?: PoolData | null;
}

const TradingChart: React.FC<TradingChartProps> = ({
  data,
  lpRanges = [],
  depthBand = null,
  impactBand = null,
  impactBandSwapUsd = 10_000,
  visibility,
  width,
  height,
  className,
  theme,
  focusHeightRatio,
  minRangeRatioForSplit,
  minCandleBodyPx,
  lpEvents = [],
  v3Swaps = [],
  poolData,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [crosshairX, setCrosshairX] = useState<number | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Locked ranges state
  const [lockedRanges, setLockedRanges] = useState<Set<number>>(new Set());
  const [showLockRangeSelector, setShowLockRangeSelector] = useState(false);

  // Anchor point for comparison
  const [anchorPoint, setAnchorPoint] = useState<AnchorPoint | null>(null);

  // Drill-down drawer state
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

  // Zoom range selection state
  const [zoomRange, setZoomRange] = useState<ZoomRangeState>({
    isSelecting: false,
    startIndex: null,
    endIndex: null,
  });

  // Active zoom state (when zoomed in)
  const [activeZoom, setActiveZoom] = useState<ActiveZoom | null>(null);

  // Calculate panel heights (total ≈ 100%)
  // Calculate panel heights (total ≈ 100%)
  const mainChartHeight = height * 0.36;
  const volumePanelHeight = height * 0.15;
  const lpActivityPanelHeight = height * 0.15;
  const peggingPanelHeight = height * 0.15;
  const depthPanelHeight = height * 0.15;
  const timeAxisHeight = height * 0.02;

  // Safe access to full data
  const fullOhlcData = data?.ohlcData ?? [];
  const fullOracleData = data?.oracleData ?? [];
  const fullDepthData = data?.depthData ?? [];
  const fullPeggingData = data?.peggingData ?? [];

  // Apply zoom if active - slice data to zoomed range
  const ohlcData = useMemo(() => {
    if (!activeZoom) return fullOhlcData;
    const start = Math.min(activeZoom.startIndex, activeZoom.endIndex);
    const end = Math.max(activeZoom.startIndex, activeZoom.endIndex);
    return fullOhlcData.slice(start, end + 1);
  }, [fullOhlcData, activeZoom]);

  const oracleData = useMemo(() => {
    if (!activeZoom) return fullOracleData;
    const start = Math.min(activeZoom.startIndex, activeZoom.endIndex);
    const end = Math.max(activeZoom.startIndex, activeZoom.endIndex);
    return fullOracleData.slice(start, end + 1);
  }, [fullOracleData, activeZoom]);

  const depthData = useMemo(() => {
    if (!activeZoom) return fullDepthData;
    const start = Math.min(activeZoom.startIndex, activeZoom.endIndex);
    const end = Math.max(activeZoom.startIndex, activeZoom.endIndex);
    return fullDepthData.slice(start, end + 1);
  }, [fullDepthData, activeZoom]);

  const peggingData = useMemo(() => {
    if (!activeZoom) return fullPeggingData;
    const start = Math.min(activeZoom.startIndex, activeZoom.endIndex);
    const end = Math.max(activeZoom.startIndex, activeZoom.endIndex);
    return fullPeggingData.slice(start, end + 1);
  }, [fullPeggingData, activeZoom]);

  // ── LP Activity: aggregate mint/burn USD volumes per candle bucket ──
  // Events are snapped to the nearest candle timestamp so the bucketing
  // adapts to whatever candle interval is active (5m, 15m, 1h, 4h, etc.).
  const fullLpActivityData = useMemo((): LPActivityDataPoint[] => {
    if (fullOhlcData.length === 0) return [];

    const token0Dec = poolData?.token0Decimals ?? 18;
    const token1Dec = poolData?.token1Decimals ?? 6;

    // Build sorted array of candle timestamps (ms) for binary-search bucketing
    const candleTimesMs = fullOhlcData.map((c) => c.timestamp.getTime());

    // bucket timestamp (ms) → { mintVolume, burnVolume }
    const bucketMap = new Map<number, { mintVolume: number; burnVolume: number }>();
    const closePriceMap = new Map<number, number>();

    for (const candle of fullOhlcData) {
      const ms = candle.timestamp.getTime();
      bucketMap.set(ms, { mintVolume: 0, burnVolume: 0 });
      closePriceMap.set(ms, candle.close);
    }

    for (const ev of lpEvents) {
      const evMs = ev.timestamp * 1000;
      const bucketMs = findCandleBucket(candleTimesMs, evMs);
      if (bucketMs < 0) continue; // before first candle

      const bucket = bucketMap.get(bucketMs);
      if (!bucket) continue;

      const closePrice = closePriceMap.get(bucketMs) ?? 0;
      const amt0 = Math.abs(Number(ev.amount0 || "0")) / Math.pow(10, token0Dec);
      const amt1 = Math.abs(Number(ev.amount1 || "0")) / Math.pow(10, token1Dec);
      const usdValue = (amt0 * closePrice) + amt1;

      if (ev.eventType === "MINT" || ev.eventType === "INCREASE") {
        bucket.mintVolume += usdValue;
      } else {
        bucket.burnVolume += usdValue;
      }
    }

    return fullOhlcData.map((candle) => {
      const b = bucketMap.get(candle.timestamp.getTime()) ?? { mintVolume: 0, burnVolume: 0 };
      return {
        timestamp: candle.timestamp,
        mintVolume: b.mintVolume,
        burnVolume: b.burnVolume,
        netFlow: b.mintVolume - b.burnVolume,
      };
    });
  }, [fullOhlcData, lpEvents, poolData]);

  const lpActivityData = useMemo(() => {
    if (!activeZoom) return fullLpActivityData;
    const start = Math.min(activeZoom.startIndex, activeZoom.endIndex);
    const end = Math.max(activeZoom.startIndex, activeZoom.endIndex);
    return fullLpActivityData.slice(start, end + 1);
  }, [fullLpActivityData, activeZoom]);

  // Shared x-scale (uses zoomed data)
  const xScale = useMemo(() => {
    if (ohlcData.length === 0) return scaleTime({ domain: [new Date(), new Date()], range: [0, Math.max(1, width - 70)] });
    return scaleTime({
      domain: [
        ohlcData[0].timestamp,
        ohlcData[ohlcData.length - 1].timestamp,
      ],
      range: [0, Math.max(1, width - 70)],
    });
  }, [ohlcData, width]);

  const hoverTimestamp = useMemo(() => {
    if (hoveredIndex === null) return null;
    return ohlcData[hoveredIndex]?.timestamp ?? null;
  }, [hoveredIndex, ohlcData]);

  const impactDebug = useMemo(() => {
    const idx = hoveredIndex ?? Math.max(0, ohlcData.length - 1);
    const o = oracleData[idx]?.price;
    const c = ohlcData[idx]?.close;
    const base =
      typeof o === "number" && Number.isFinite(o) && o > 0
        ? o
        : typeof c === "number" && Number.isFinite(c) && c > 0
          ? c
          : NaN;

    const pt = impactBand?.[Math.min(idx, (impactBand?.length ?? 0) - 1)];
    const buy = pt?.buyPrice;
    const sell = pt?.sellPrice;

    const buyPct =
      Number.isFinite(base) && base > 0 && typeof buy === "number" && Number.isFinite(buy) && buy > 0
        ? ((buy / base) - 1) * 100
        : NaN;
    const sellPct =
      Number.isFinite(base) && base > 0 && typeof sell === "number" && Number.isFinite(sell) && sell > 0
        ? ((sell / base) - 1) * 100
        : NaN;

    return {
      idx,
      orderUsd: impactBandSwapUsd,
      base,
      buy: typeof buy === "number" ? buy : NaN,
      sell: typeof sell === "number" ? sell : NaN,
      buyPct,
      sellPct,
      sampling: "candle" as const,
    };
  }, [hoveredIndex, impactBand, impactBandSwapUsd, ohlcData, oracleData]);

  const handleHover = useCallback((index: number | null, x: number) => {
    setHoveredIndex(index);
    setCrosshairX(index !== null ? x : null);
  }, []);

  // Handle right-click to show context menu
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (hoveredIndex === null) return;

    // Get position relative to the chart container
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setContextMenu({
      visible: true,
      x: Math.min(x, width - 200), // Keep menu within bounds
      y: Math.min(y, height - 100),
      dataIndex: hoveredIndex,
    });
  }, [hoveredIndex, width, height]);

  // Set anchor point for comparison
  const handleSetAnchor = useCallback(() => {
    if (contextMenu === null) return;

    const idx = contextMenu.dataIndex;
    const ohlc = ohlcData[idx];
    const oracle = oracleData[idx];
    const depth = depthData[idx];
    const pegging = peggingData[idx];

    if (!ohlc) return;

    setAnchorPoint({
      index: idx,
      timestamp: ohlc.timestamp,
      price: ohlc.close,
      oraclePrice: oracle?.price,
      volume: ohlc.volume,
      deviation: pegging?.deviation,
      bidDepth: depth?.bidDepth,
      askDepth: depth?.askDepth,
    });
  }, [contextMenu, ohlcData, oracleData, depthData, peggingData]);

  // Clear anchor point
  const handleClearAnchor = useCallback(() => {
    setAnchorPoint(null);
  }, []);

  // Open drill-down drawer (also sets anchor)
  const handleViewDetails = useCallback(() => {
    if (contextMenu === null) return;

    const idx = contextMenu.dataIndex;
    const ohlc = ohlcData[idx];
    const oracle = oracleData[idx];
    const depth = depthData[idx];
    const pegging = peggingData[idx];

    if (ohlc) {
      // Also set anchor when viewing details
      setAnchorPoint({
        index: idx,
        timestamp: ohlc.timestamp,
        price: ohlc.close,
        oraclePrice: oracle?.price,
        volume: ohlc.volume,
        deviation: pegging?.deviation,
        bidDepth: depth?.bidDepth,
        askDepth: depth?.askDepth,
      });
    }

    setDrillDown({
      visible: true,
      dataIndex: idx,
    });
  }, [contextMenu, ohlcData, oracleData, depthData, peggingData]);

  // Close context menu
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Close drill-down drawer (also clears anchor since it was set by View Details)
  const handleCloseDrillDown = useCallback(() => {
    setDrillDown(null);
    setAnchorPoint(null);
  }, []);

  // Start range selection for zoom
  const handleStartRangeSelect = useCallback(() => {
    if (contextMenu === null) return;

    // Use the index in the full data, not zoomed data
    // If we're already zoomed, we need to translate the index
    let fullIndex = contextMenu.dataIndex;
    if (activeZoom) {
      const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
      fullIndex = zoomStart + contextMenu.dataIndex;
    }

    setZoomRange({
      isSelecting: true,
      startIndex: fullIndex,
      endIndex: null,
    });
  }, [contextMenu, activeZoom]);

  // Open lock range selector
  const handleLockRange = useCallback(() => {
    setShowLockRangeSelector(true);
  }, []);

  // Handle click during range selection or normal operation
  const handleChartClick = useCallback((event: React.MouseEvent) => {
    // Only handle left clicks
    if (event.button !== 0) return;

    // If we're in range selection mode, complete the selection
    if (zoomRange.isSelecting && zoomRange.startIndex !== null && hoveredIndex !== null) {
      // Translate hoveredIndex to full data index if zoomed
      let fullEndIndex = hoveredIndex;
      if (activeZoom) {
        const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
        fullEndIndex = zoomStart + hoveredIndex;
      }

      // Apply the zoom
      setActiveZoom({
        startIndex: zoomRange.startIndex,
        endIndex: fullEndIndex,
      });

      // Clear selection state
      setZoomRange({
        isSelecting: false,
        startIndex: null,
        endIndex: null,
      });
    }
  }, [zoomRange, hoveredIndex, activeZoom]);

  // Reset zoom to show full data
  const handleResetZoom = useCallback(() => {
    setActiveZoom(null);
    setZoomRange({
      isSelecting: false,
      startIndex: null,
      endIndex: null,
    });
  }, []);

  // Cancel range selection on Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && zoomRange.isSelecting) {
        setZoomRange({
          isSelecting: false,
          startIndex: null,
          endIndex: null,
        });
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [zoomRange.isSelecting]);

  // Early returns after all hooks
  if (width <= 0 || height <= 0) return null;

  if (ohlcData.length === 0) {
    return (
      <div
        className={cn("w-full h-full flex items-center justify-center", className)}
        style={{ background: theme.background, color: theme.textMuted }}
      >
        Loading chart data...
      </div>
    );
  }

  return (
    <div
      className={cn("relative flex flex-col", className)}
      style={{
        width,
        height,
        background: theme.background,
        cursor: zoomRange.isSelecting ? "crosshair" : undefined,
      }}
      onContextMenu={handleContextMenu}
      onClick={handleChartClick}
    >
      {/* Range selection indicator */}
      {zoomRange.isSelecting && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2"
          style={{
            background: BRAND_COLORS.teal,
            color: "#fff",
            boxShadow: "0 2px 8px rgba(107, 142, 155, 0.4)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          Click to select end of range (Esc to cancel)
        </div>
      )}

      {/* Reset zoom button */}
      {activeZoom && !zoomRange.isSelecting && (
        <button
          className="absolute top-2 right-16 z-30 px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all hover:scale-105"
          style={{
            background: theme.mode === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)",
            color: theme.textPrimary,
            border: `1px solid ${theme.divider}`,
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

      {/* Info panel */}
      <InfoPanel
        data={{ ohlcData, oracleData, depthData, peggingData }}
        lpRanges={lpRanges}
        impactBand={impactBand}
        impactBandSwapUsd={impactBandSwapUsd}
        hoveredIndex={hoveredIndex}
        anchorPoint={anchorPoint}
        theme={theme}
        crosshairX={crosshairX}
        chartWidth={width}
      />

      {/* Anchor indicator */}
      <AnchorIndicator
        anchor={anchorPoint}
        xScale={xScale}
        height={height}
        margin={DEFAULT_MARGIN}
        theme={theme}
        onClear={handleClearAnchor}
      />

      {/* Range selection overlay */}
      {zoomRange.isSelecting && zoomRange.startIndex !== null && hoveredIndex !== null && (
        (() => {
          // Calculate positions for the selection range
          // Need to translate startIndex from full data to current (potentially zoomed) xScale
          let displayStartIndex = zoomRange.startIndex;
          if (activeZoom) {
            const zoomStart = Math.min(activeZoom.startIndex, activeZoom.endIndex);
            displayStartIndex = zoomRange.startIndex - zoomStart;
          }

          const startTimestamp = ohlcData[Math.max(0, Math.min(displayStartIndex, ohlcData.length - 1))]?.timestamp;
          const endTimestamp = ohlcData[hoveredIndex]?.timestamp;

          if (!startTimestamp || !endTimestamp) return null;

          const startX = (xScale(startTimestamp) ?? 0) + DEFAULT_MARGIN.left;
          const endX = (xScale(endTimestamp) ?? 0) + DEFAULT_MARGIN.left;

          const left = Math.min(startX, endX);
          const selectionWidth = Math.abs(endX - startX);

          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left,
                top: DEFAULT_MARGIN.top,
                width: Math.max(2, selectionWidth),
                height: height - DEFAULT_MARGIN.top - DEFAULT_MARGIN.bottom - 30,
                background: `${BRAND_COLORS.teal}20`,
                borderLeft: `2px solid ${BRAND_COLORS.teal}`,
                borderRight: `2px solid ${BRAND_COLORS.teal}`,
              }}
            />
          );
        })()
      )}

      {/* Main OHLC chart */}
      <OHLCChart
        data={ohlcData}
        oracleData={oracleData}
        lpRanges={lpRanges}
        depthBand={depthBand}
        impactBand={impactBand}
        impactBandSwapUsd={impactBandSwapUsd}
        lockedRanges={lockedRanges}
        width={width}
        height={mainChartHeight}
        xScale={xScale}
        hoveredIndex={hoveredIndex}
        hoverTimestamp={hoverTimestamp}
        onHover={handleHover}
        theme={theme}
        showCandles={visibility?.candlesticks ?? true}
        showOracleBand={visibility?.oracleBand ?? true}
        showOracleLine={visibility?.oracleLine ?? true}
        showPositionRanges={visibility?.positionRanges ?? true}
        focusHeightRatio={focusHeightRatio}
        minRangeRatioForSplit={minRangeRatioForSplit}
        minCandleBodyPx={minCandleBodyPx}
      />

      {/* Separator */}
      <div className="h-px" style={{ background: theme.divider }} />

      {/* Volume panel */}
      <VolumePanel
        data={ohlcData}
        width={width}
        height={volumePanelHeight}
        xScale={xScale}
        hoveredIndex={hoveredIndex}
        hoverTimestamp={hoverTimestamp}
        hoverData={ohlcData}
        onHover={handleHover}
        theme={theme}
      />

      {/* Separator */}
      <div className="h-px" style={{ background: theme.divider }} />

      {/* LP Activity panel */}
      <LPActivityPanel
        data={lpActivityData}
        width={width}
        height={lpActivityPanelHeight}
        xScale={xScale}
        hoveredIndex={hoveredIndex}
        hoverTimestamp={hoverTimestamp}
        hoverData={ohlcData}
        onHover={handleHover}
        theme={theme}
      />

      {/* Separator */}
      <div className="h-px" style={{ background: theme.divider }} />

      {/* Pegging oscillator panel */}
      <PeggingPanel
        data={peggingData}
        width={width}
        height={peggingPanelHeight}
        xScale={xScale}
        hoveredIndex={hoveredIndex}
        hoverTimestamp={hoverTimestamp}
        hoverData={ohlcData}
        onHover={handleHover}
        theme={theme}
      />

      {/* Separator */}
      <div className="h-px" style={{ background: theme.divider }} />

      {/* Depth lines panel */}
      <DepthLinesPanel
        data={depthData}
        width={width}
        height={depthPanelHeight}
        xScale={xScale}
        hoveredIndex={hoveredIndex}
        hoverTimestamp={hoverTimestamp}
        hoverData={ohlcData}
        onHover={handleHover}
        theme={theme}
        showLines={visibility?.bidAskLines ?? true}
        showAreas={visibility?.depthAreas ?? true}
      />

      {/* Time axis */}
      <TimeAxis
        width={width}
        height={timeAxisHeight}
        xScale={xScale}
        data={ohlcData}
        theme={theme}
      />

      {/* Context menu */}
      {contextMenu && contextMenu.visible && (
        <ChartContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onSetAnchor={handleSetAnchor}
          onViewDetails={handleViewDetails}
          onStartRangeSelect={handleStartRangeSelect}
          onLockRange={handleLockRange}
          hasRanges={lpRanges.length > 0}
          onClose={handleCloseContextMenu}
          theme={theme}
        />
      )}

      {/* Lock Range Selector */}
      {showLockRangeSelector && lpRanges.length > 0 && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.3)" }}
            onClick={() => setShowLockRangeSelector(false)}
          />
          {/* Selector Panel */}
          <div
            className="absolute z-50 rounded-lg border shadow-xl overflow-hidden"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: theme.mode === "light" ? "rgba(255,255,255,0.98)" : "rgba(15,23,42,0.98)",
              borderColor: theme.divider,
              minWidth: 280,
            }}
          >
            <div className="px-4 py-3 border-b" style={{ borderColor: theme.divider }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm" style={{ color: theme.textPrimary }}>
                  Lock LP Ranges
                </span>
                <button
                  type="button"
                  onClick={() => setShowLockRangeSelector(false)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs mt-1" style={{ color: theme.textMuted }}>
                Select ranges to keep visible on the chart
              </p>
            </div>
            <div className="p-2 max-h-[300px] overflow-y-auto">
              {lpRanges.map((range, idx) => {
                const isLocked = lockedRanges.has(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-3 transition-colors"
                    style={{
                      background: isLocked
                        ? theme.mode === "light" ? "rgba(30,41,59,0.1)" : "rgba(30,41,59,0.3)"
                        : "transparent",
                      color: theme.textPrimary,
                    }}
                    onMouseEnter={(e) => {
                      if (!isLocked) {
                        e.currentTarget.style.background = theme.mode === "light" ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isLocked) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                    onClick={() => {
                      const newLocked = new Set(lockedRanges);
                      if (isLocked) {
                        newLocked.delete(idx);
                      } else {
                        newLocked.add(idx);
                      }
                      setLockedRanges(newLocked);
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded border-2 flex items-center justify-center"
                      style={{
                        borderColor: isLocked ? "#1e293b" : theme.divider,
                        background: isLocked ? "#1e293b" : "transparent",
                      }}
                    >
                      {isLocked && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">Range {idx + 1}</div>
                      <div className="text-xs" style={{ color: theme.textMuted }}>
                        ${range.lower.toFixed(4)} – ${range.upper.toFixed(4)}
                      </div>
                    </div>
                    {isLocked && (
                      <span style={{ color: "#1e293b" }}>🔒</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t flex gap-2" style={{ borderColor: theme.divider }}>
              <button
                type="button"
                className="flex-1 px-3 py-1.5 rounded text-sm font-medium"
                style={{
                  background: theme.mode === "light" ? "#f1f5f9" : "#334155",
                  color: theme.textPrimary,
                }}
                onClick={() => setLockedRanges(new Set())}
              >
                Clear All
              </button>
              <button
                type="button"
                className="flex-1 px-3 py-1.5 rounded text-sm font-medium"
                style={{
                  background: "#1e293b",
                  color: "#fff",
                }}
                onClick={() => setShowLockRangeSelector(false)}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}

      {/* Drill-down drawer */}
      <DrillDownDrawer
        visible={drillDown?.visible ?? false}
        dataIndex={drillDown?.dataIndex ?? 0}
        data={{ ohlcData, oracleData, depthData, peggingData }}
        theme={theme}
        onClose={handleCloseDrillDown}
        anchorXPercent={anchorPoint && ohlcData.length > 1 ? anchorPoint.index / (ohlcData.length - 1) : 0.5}
        lpEvents={lpEvents}
        v3Swaps={v3Swaps}
        poolData={poolData}
      />
    </div>
  );
};

// ============================================================================
// RESPONSIVE WRAPPER
// ============================================================================

export interface LPAddressActivityData extends TradingChartData {}

export const LPAddressActivityChart: React.FC<{
  data: LPAddressActivityData;
  lpRanges?: LPRange[];
  // Position-based calculation (preferred - more accurate)
  allPositions?: PositionData[] | null;
  // Tick-based calculation (fallback)
  tickData?: TickLiquidityData[] | null;
  poolData?: PoolData | null;
  lpEvents?: LPEventData[];
  v3Swaps?: V3SwapEventData[];
  precomputedImpactBand?: DepthBandPoint[] | null;
  precomputedDepthBand?: DepthBandPoint[] | null;
  invertPrice?: boolean;
  className?: string;
  /** USD price of token0 — for correct swap sizing on non-stablecoin pairs. */
  token0UsdPrice?: number | null;
  /** USD price of token1 — for correct swap sizing on non-stablecoin pairs. */
  token1UsdPrice?: number | null;
}> = ({
  data,
  lpRanges,
  allPositions,
  tickData,
  poolData,
  lpEvents = [],
  v3Swaps = [],
  precomputedImpactBand = null,
  precomputedDepthBand = null,
  invertPrice = false,
  className,
  token0UsdPrice,
  token1UsdPrice,
}) => {
  const baseTheme = LIGHT_THEME;
  const {
    lpActivityOracleRange,
    lpActivityFocusHeightRatio,
    lpActivityMinCandleBodyPx,
    lpActivityMinRangeRatioForSplit,
    chartVisibility,
    depthBandConfig,
    oracleSource,
    setOracleSource,
    liquidityPricingMode,
  } = useChartSettingsStore();
  const hasPrecomputedBands = !!precomputedImpactBand && precomputedImpactBand.length > 0;

  const externalImpactBand = useMemo(() => {
    if (!precomputedImpactBand || precomputedImpactBand.length === 0) return null;
    if (!invertPrice) return precomputedImpactBand;
    return precomputedImpactBand.map((p) => ({
      ...p,
      buyPrice: Number.isFinite(p.buyPrice) && p.buyPrice > 0 ? 1 / p.buyPrice : NaN,
      sellPrice: Number.isFinite(p.sellPrice) && p.sellPrice > 0 ? 1 / p.sellPrice : NaN,
    }));
  }, [precomputedImpactBand, invertPrice]);

  const externalDepthBand = useMemo(() => {
    if (!precomputedDepthBand || precomputedDepthBand.length === 0) return null;
    if (!invertPrice) return precomputedDepthBand;
    return precomputedDepthBand.map((p) => ({
      ...p,
      buyPrice: Number.isFinite(p.buyPrice) && p.buyPrice > 0 ? 1 / p.buyPrice : NaN,
      sellPrice: Number.isFinite(p.sellPrice) && p.sellPrice > 0 ? 1 / p.sellPrice : NaN,
    }));
  }, [precomputedDepthBand, invertPrice]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STABILITY: Prevent unnecessary recalculations while always using fresh data
  // Strategy: Use content-based fingerprints to detect actual changes (not reference changes)
  // This ensures the chart always reflects reality while avoiding spurious recalculations
  // ═══════════════════════════════════════════════════════════════════════════

  // Create fingerprints that capture meaningful data changes
  // These trigger recalculation ONLY when actual content changes
  const positionsFingerprint = useMemo(() => {
    if (hasPrecomputedBands) return 'external';
    if (!allPositions || allPositions.length === 0) return 'empty';
    // Include total liquidity to detect liquidity changes even if position count is same
    const totalLiq = allPositions.reduce((sum, p) => sum + BigInt(p.liquidity), BigInt(0));
    const firstPos = allPositions[0];
    const lastPos = allPositions[allPositions.length - 1];
    return `${allPositions.length}-${firstPos?.id}-${firstPos?.liquidity}-${lastPos?.id}-${lastPos?.liquidity}-${totalLiq.toString()}`;
  }, [allPositions, hasPrecomputedBands]);

  const eventsFingerprint = useMemo(() => {
    if (hasPrecomputedBands) return 'external';
    if (!lpEvents || lpEvents.length === 0) return 'empty';
    const first = lpEvents[0];
    const last = lpEvents[lpEvents.length - 1];
    return `${lpEvents.length}-${first?.id}-${first?.timestamp}-${last?.id}-${last?.timestamp}`;
  }, [lpEvents, hasPrecomputedBands]);

  const ohlcFingerprint = useMemo(() => {
    const ohlc = data?.ohlcData;
    if (!ohlc || ohlc.length === 0) return 'empty';
    const first = ohlc[0];
    const last = ohlc[ohlc.length - 1];
    // Include close price to detect price changes
    return `${ohlc.length}-${first?.timestamp.getTime()}-${last?.timestamp.getTime()}-${last?.close}`;
  }, [data?.ohlcData]);

  const tickDataFingerprint = useMemo(() => {
    if (hasPrecomputedBands) return 'external';
    if (!tickData || tickData.length === 0) return 'empty';
    // Include liquidity values to detect changes
    const first = tickData[0];
    const last = tickData[tickData.length - 1];
    return `${tickData.length}-${first?.tick}-${first?.liquidityGross}-${last?.tick}-${last?.liquidityGross}`;
  }, [tickData, hasPrecomputedBands]);

  const poolDataFingerprint = useMemo(() => {
    if (!poolData) return 'empty';
    return `${poolData.poolAddress}-${poolData.currentPrice}-${poolData.sqrtPriceX96}`;
  }, [poolData]);

  // Combined fingerprint - recalculate when ANY meaningful data changes
  const dataFingerprint = `${positionsFingerprint}|${eventsFingerprint}|${ohlcFingerprint}|${tickDataFingerprint}|${poolDataFingerprint}|${invertPrice}`;

  // Attach oracle range to theme (keeps changes localized; avoids prop-drilling through many panels).
  const theme = useMemo(() => {
    return {
      ...baseTheme,
      __oracleMinPct: lpActivityOracleRange.minPct,
      __oracleMaxPct: lpActivityOracleRange.maxPct,
    } satisfies ChartThemeWithOracle;
  }, [baseTheme, lpActivityOracleRange.maxPct, lpActivityOracleRange.minPct]);

  const depthBand = useMemo(() => {
    if (!depthBandConfig.enabled) return null;
    if (externalDepthBand && externalDepthBand.length > 0) return externalDepthBand;
    if (!poolData) return null;
    const timestamps = (data?.ohlcData ?? []).map((d) => d.timestamp);
    if (timestamps.length === 0) return null;

    const depthConfig = { swapAmountUSD: depthBandConfig.swapAmountUSD, token0UsdPrice, token1UsdPrice };

    // Prefer position-based calculation (ground truth)
    if (allPositions && allPositions.length > 0) {
      return calculateDepthBandSeriesFromPositions({
        timestamps,
        positions: allPositions,
        poolData,
        config: depthConfig,
      });
    }

    // Fall back to tick-based calculation
    if (!tickData || tickData.length === 0) return null;
    return calculateDepthBandSeries({
      timestamps,
      tickData,
      poolData,
      config: depthConfig,
    });
  }, [data?.ohlcData, depthBandConfig.enabled, depthBandConfig.swapAmountUSD, poolData, allPositions, tickData, externalDepthBand, token0UsdPrice, token1UsdPrice]);

  // Oracle band is deprecated for LP Activity; replaced by the $10k impact band overlay.
  // Keep the toggle semantics, but always hide the legacy oracle band.
  const showOracleBand = false;

  // New default: show a $10k price-impact band (buy up / sell down) computed per candle.
  // We reconstruct historical position state by rolling back LPEvents from the current positions,
  // then calculate impact using position-based (ground truth) methodology.
  //
  // NOTE: Positions, tick liquidity, and events are now fetched atomically via useLPHistoricalData
  // to prevent race conditions that previously caused intermittent impact band display issues.
  const impactBandSwapUsd = 10_000;

  // Cache for smooth transitions during brief loading states
  const lastValidImpactBandRef = useRef<DepthBandPoint[] | null>(null);

  const impactBand = useMemo(() => {
    if (externalImpactBand && externalImpactBand.length > 0) return externalImpactBand;
    // Always use actual props - never stale data
    // The fingerprint-based dependency ensures we only recalculate when content changes

    if (!poolData) {
      // Only use cache during initial load, not for stale data
      return lastValidImpactBandRef.current;
    }

    // Need positions for position-based rollback
    const hasPositions = allPositions && allPositions.length > 0;
    const hasEvents = lpEvents && lpEvents.length > 0;

    // Fall back to tick data if no positions available
    const hasTickData = tickData && tickData.length > 0;

    if (!hasPositions && !hasTickData) {
      return lastValidImpactBandRef.current;
    }

    const ohlc = data?.ohlcData ?? [];
    if (ohlc.length === 0) return lastValidImpactBandRef.current;

    // IMPORTANT: the dashboard may invert the whole LP Activity series for display ("base per quote").
    const invertSimToDisplay = !!invertPrice;
    const poolPriceNow =
      invertSimToDisplay && Number.isFinite(poolData.currentPrice) && poolData.currentPrice > 0
        ? 1 / poolData.currentPrice
        : poolData.currentPrice;

    // ═══════════════════════════════════════════════════════════════════════
    // POSITION-BASED ROLLBACK (preferred - ground truth)
    // When events are available, we can roll back positions through time.
    // When only positions are available (no events), we use current positions
    // for all time points (less accurate but prevents band disappearing).
    // ═══════════════════════════════════════════════════════════════════════
    if (hasPositions) {
      // Use events for rollback if available, otherwise use static positions
      const useRollback = hasEvents;
      // Build initial range map from current positions
      const rangeMap: RangeMap = buildRangeMapFromPositions(allPositions!);

      // Sort events newest -> oldest for rollback (only if we have events)
      const sortedEvents = useRollback 
        ? [...lpEvents!].filter((e) => Number.isFinite(e.timestamp)).sort((a, b) => b.timestamp - a.timestamp)
        : [];
      
      let evIdx = 0;
      const points: DepthBandPoint[] = new Array(ohlc.length);
      
      // Iterate candles from newest -> oldest, applying rollbacks as we go
      for (let i = ohlc.length - 1; i >= 0; i--) {
        const candle = ohlc[i]!;
        const tsSec = Math.floor(candle.timestamp.getTime() / 1000);
        
        // Roll back any events that happened after this candle timestamp (only if rollback enabled)
        while (useRollback && evIdx < sortedEvents.length && sortedEvents[evIdx]!.timestamp > tsSec) {
          applyRollbackToRangeMap(rangeMap, sortedEvents[evIdx]!);
          evIdx++;
        }
        
        const sqrtX96 = candle.sqrtPriceX96;
        if (!sqrtX96) {
          points[i] = { timestamp: candle.timestamp, buyPrice: NaN, sellPrice: NaN };
          continue;
        }
        
        let currentSqrt: bigint;
        try {
          currentSqrt = BigInt(sqrtX96);
        } catch {
          points[i] = { timestamp: candle.timestamp, buyPrice: NaN, sellPrice: NaN };
          continue;
        }
        
        // Derive tick from sqrtPriceX96
        const rawPrice = sqrtPriceX96ToPrice(currentSqrt, 0, 0);
        const tick = priceToTick(rawPrice);
        const currentPrice = sqrtPriceX96ToPrice(currentSqrt, poolData.token0Decimals, poolData.token1Decimals);

        // Calculate impact using position-based rollback (ground truth)
        const imp = simulateImpactPricesFromRangeMap({
          rangeMap,
          currentTick: tick,
          sqrtPriceX96: sqrtX96,
          token0Decimals: poolData.token0Decimals,
          token1Decimals: poolData.token1Decimals,
          currentPrice,
          orderUsd: impactBandSwapUsd,
          token0UsdPrice,
          token1UsdPrice,
        });

        // Convert to display units if inverted
        const buy = invertSimToDisplay && imp.buyPrice > 0 ? 1 / imp.buyPrice : imp.buyPrice;
        const sell = invertSimToDisplay && imp.sellPrice > 0 ? 1 / imp.sellPrice : imp.sellPrice;
        
        points[i] = {
          timestamp: candle.timestamp,
          buyPrice: Number.isFinite(buy) && buy > 0 ? buy : NaN,
          sellPrice: Number.isFinite(sell) && sell > 0 ? sell : NaN,
        };
      }
      
      // Apply roll-forward fill and clamping (same as before)
      const result = applyRollForwardAndClamp(points, ohlc, poolPriceNow, data?.ohlcData);
      const validPointCount = result?.filter(p => Number.isFinite(p.buyPrice) && Number.isFinite(p.sellPrice)).length ?? 0;

      // Only update cache if we have a meaningful number of valid points (at least 10% of total)
      if (result && validPointCount > result.length * 0.1) {
        lastValidImpactBandRef.current = result;
        return result;
      }

      // Return cached result if new calculation produces poor data - smooth transition
      return lastValidImpactBandRef.current;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TICK-BASED FALLBACK (legacy - when no positions available)
    // ═══════════════════════════════════════════════════════════════════════
    if (hasTickData) {
      // Build tick map from tick data
      const tickMap = new Map<number, { gross: bigint; net: bigint }>();
      for (const t of tickData!) {
        try {
          tickMap.set(t.tick, {
            gross: BigInt(t.liquidityGross),
            net: BigInt(t.liquidityNet),
          });
        } catch {
          // ignore malformed
        }
      }

      if (tickMap.size === 0) return null;

      // Sort events for tick-based rollback
      const sortedEvents = (lpEvents ?? [])
        .slice()
        .filter((e) => Number.isFinite(e.timestamp))
        .sort((a, b) => b.timestamp - a.timestamp);
      
      let evIdx = 0;
      
      const applyTickRollback = (e: LPEventData) => {
        const delta = BigInt(e.liquidityDelta);
        const abs = delta < 0n ? -delta : delta;
        const lower = Number(e.tickLower);
        const upper = Number(e.tickUpper);
        if (!Number.isFinite(lower) || !Number.isFinite(upper)) return;
        
        const lowerRow = tickMap.get(lower) ?? { gross: 0n, net: 0n };
        const upperRow = tickMap.get(upper) ?? { gross: 0n, net: 0n };
        tickMap.set(lower, {
          gross: (lowerRow.gross - abs) < 0n ? 0n : (lowerRow.gross - abs),
          net: lowerRow.net - delta,
        });
        tickMap.set(upper, {
          gross: (upperRow.gross - abs) < 0n ? 0n : (upperRow.gross - abs),
          net: upperRow.net + delta,
        });
      };
      
      const points: DepthBandPoint[] = new Array(ohlc.length);
      
      for (let i = ohlc.length - 1; i >= 0; i--) {
        const candle = ohlc[i]!;
        const tsSec = Math.floor(candle.timestamp.getTime() / 1000);
        
        while (evIdx < sortedEvents.length && sortedEvents[evIdx]!.timestamp > tsSec) {
          applyTickRollback(sortedEvents[evIdx]!);
          evIdx++;
        }
        
        const sqrtX96 = candle.sqrtPriceX96;
        const liqStr = candle.liquidity;
        if (!sqrtX96 || !liqStr) {
          points[i] = { timestamp: candle.timestamp, buyPrice: NaN, sellPrice: NaN };
          continue;
        }
        
        let currentSqrt: bigint;
        let currentLiquidity: bigint;
        try {
          currentSqrt = BigInt(sqrtX96);
          currentLiquidity = BigInt(liqStr);
        } catch {
          points[i] = { timestamp: candle.timestamp, buyPrice: NaN, sellPrice: NaN };
          continue;
        }
        
        const rawPrice = sqrtPriceX96ToPrice(currentSqrt, 0, 0);
        const tick = priceToTick(rawPrice);
        
        const tickDataAtTime: TickLiquidityData[] = [];
        for (const [tickKey, row] of tickMap.entries()) {
          if (row.gross <= 0n && row.net === 0n) continue;
          tickDataAtTime.push({
            id: `t-${tickKey}`,
            pool: poolData.poolAddress,
            tick: tickKey,
            liquidityGross: row.gross.toString(),
            liquidityNet: row.net.toString(),
            updatedAt: tsSec,
          });
        }

        const imp = simulateImpactPricesUsd({
          tickData: tickDataAtTime,
          currentTick: tick,
          sqrtPriceX96: sqrtX96,
          liquidity: currentLiquidity.toString(),
          token0Decimals: poolData.token0Decimals,
          token1Decimals: poolData.token1Decimals,
          currentPrice: sqrtPriceX96ToPrice(currentSqrt, poolData.token0Decimals, poolData.token1Decimals),
          orderUsd: impactBandSwapUsd,
          token0UsdPrice,
          token1UsdPrice,
        });
        
        const buy = invertSimToDisplay && imp.buyPrice > 0 ? 1 / imp.buyPrice : imp.buyPrice;
        const sell = invertSimToDisplay && imp.sellPrice > 0 ? 1 / imp.sellPrice : imp.sellPrice;
        
        points[i] = {
          timestamp: candle.timestamp,
          buyPrice: Number.isFinite(buy) && buy > 0 ? buy : NaN,
          sellPrice: Number.isFinite(sell) && sell > 0 ? sell : NaN,
        };
      }

      const result = applyRollForwardAndClamp(points, ohlc, poolPriceNow, data?.ohlcData);
      const validPointCount = result?.filter(p => Number.isFinite(p.buyPrice) && Number.isFinite(p.sellPrice)).length ?? 0;

      // Only update cache if we have a meaningful number of valid points
      if (result && validPointCount > result.length * 0.1) {
        lastValidImpactBandRef.current = result;
        return result;
      }

      // Return cached result if new calculation produces poor data - smooth transition
      return lastValidImpactBandRef.current;
    }

    // No valid calculation possible, return cached for smooth transition
    return lastValidImpactBandRef.current;
    
    // Helper function to apply roll-forward fill and clamping
    function applyRollForwardAndClamp(
      points: DepthBandPoint[], 
      ohlc: OHLCDataPoint[], 
      poolPriceNow: number,
      ohlcData?: OHLCDataPoint[]
    ): DepthBandPoint[] {
      const rollForward = (values: number[]): number[] => {
        const n = values.length;
        const out = values.map((v) => (Number.isFinite(v) && v > 0 ? v : NaN));
        
        let firstValid = -1;
        for (let i = 0; i < n; i++) {
          if (Number.isFinite(out[i]!)) {
            firstValid = i;
            break;
          }
        }
        if (firstValid === -1) return new Array(n).fill(NaN);
        
        for (let i = 0; i < firstValid; i++) out[i] = out[firstValid]!;
        for (let i = firstValid + 1; i < n; i++) {
          if (!Number.isFinite(out[i]!)) out[i] = out[i - 1]!;
        }
        
        return out;
      };
      
      const baselineSeries = rollForward(
        points.map((_, i) => {
          const closeP = (ohlcData ?? [])[i]?.close;
          if (Number.isFinite(closeP) && (closeP as number) > 0) return closeP as number;
          return poolPriceNow;
        })
      );
      
      const buySeries = rollForward(points.map((p) => p.buyPrice));
      const sellSeries = rollForward(points.map((p) => p.sellPrice));

      return points.map((p, i) => {
        const base = Number.isFinite(baselineSeries[i]!) && baselineSeries[i]! > 0 ? baselineSeries[i]! : poolPriceNow;
        let buy = Number.isFinite(buySeries[i]!) && buySeries[i]! > 0 ? buySeries[i]! : base;
        let sell = Number.isFinite(sellSeries[i]!) && sellSeries[i]! > 0 ? sellSeries[i]! : base;

        // Ensure buy >= base and sell <= base (correct orientation)
        if (Number.isFinite(base) && base > 0 && Number.isFinite(buy) && buy > 0 && Number.isFinite(sell) && sell > 0) {
          if (buy < base && sell > base) {
            const tmp = buy;
            buy = sell;
            sell = tmp;
          }
          buy = Math.max(buy, base);
          sell = Math.min(sell, base);
        }

        return { ...p, buyPrice: buy, sellPrice: sell };
      });
    }
  // Use debounced fingerprint to prevent rapid recalculations when data references change
  // The stable refs ensure we always have access to the latest data while controlling update frequency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFingerprint, externalImpactBand, token0UsdPrice, token1UsdPrice]);

  // ═══════════════════════════════════════════════════════════════════════
  // DEPTH DATA OVERRIDE: Use position-based rollback for historical depth
  // Depth = how much USD can be traded before moving price by 1%
  // Uses same gap-filled data and rollback as impact band for consistency
  // ═══════════════════════════════════════════════════════════════════════
  const lastValidDepthDataRef = useRef<DepthDataPoint[] | null>(null);

  const depthDataOverride = useMemo<DepthDataPoint[] | null>(() => {
    if (externalImpactBand && externalImpactBand.length > 0) return null;
    // Always use actual props - never stale data
    if (!poolData) return lastValidDepthDataRef.current;

    const hasPositions = allPositions && allPositions.length > 0;
    const hasEvents = lpEvents && lpEvents.length > 0;
    if (!hasPositions || !hasEvents) return lastValidDepthDataRef.current;

    const rawOhlc = data?.ohlcData ?? [];
    if (rawOhlc.length === 0) return lastValidDepthDataRef.current;
    
    // ═══════════════════════════════════════════════════════════════════════
    // GAP-FILL: Generate complete timeline at 5-minute intervals (same as impact band)
    // ═══════════════════════════════════════════════════════════════════════
    const INTERVAL_MS = 5 * 60 * 1000;
    const rawStartTs = rawOhlc[0]!.timestamp.getTime();
    const rawEndTs = rawOhlc[rawOhlc.length - 1]!.timestamp.getTime();
    const startTs = Math.floor(rawStartTs / INTERVAL_MS) * INTERVAL_MS;
    const endTs = Math.ceil(rawEndTs / INTERVAL_MS) * INTERVAL_MS;
    
    const candleMap = new Map<number, OHLCDataPoint>();
    for (const candle of rawOhlc) {
      const flooredTs = Math.floor(candle.timestamp.getTime() / INTERVAL_MS) * INTERVAL_MS;
      const existing = candleMap.get(flooredTs);
      if (!existing || candle.timestamp.getTime() > existing.timestamp.getTime()) {
        candleMap.set(flooredTs, candle);
      }
    }
    
    const ohlc: OHLCDataPoint[] = [];
    let lastCandle: OHLCDataPoint | null = null;
    
    for (let ts = startTs; ts <= endTs; ts += INTERVAL_MS) {
      const existing = candleMap.get(ts);
      if (existing) {
        lastCandle = existing;
        ohlc.push(existing);
      } else if (lastCandle) {
        ohlc.push({
          ...lastCandle,
          timestamp: new Date(ts),
          open: lastCandle.close,
          high: lastCandle.close,
          low: lastCandle.close,
          volume: 0,
        });
      }
    }
    
    if (ohlc.length === 0) return null;
    
    // ═══════════════════════════════════════════════════════════════════════
    // POSITION-BASED ROLLBACK for historical depth
    // ═══════════════════════════════════════════════════════════════════════
    const rangeMap: RangeMap = buildRangeMapFromPositions(allPositions!);

    const sortedEvents = [...lpEvents!]
      .filter((e) => Number.isFinite(e.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp);
    
    let evIdx = 0;
    const depthPoints: DepthDataPoint[] = new Array(ohlc.length);
    
    // Target slippage for depth calculation (1%)
    const targetSlippagePct = 1;
    const testSwapUsd = 10000;
    const maxDepth = 500_000; // Cap at $500k
    const minDepth = 100; // Minimum $100
    
    // Track last valid depth for forward-filling gaps
    let lastBidDepth = minDepth;
    let lastAskDepth = minDepth;
    
    // Iterate candles from newest -> oldest, applying rollbacks
    for (let i = ohlc.length - 1; i >= 0; i--) {
      const candle = ohlc[i]!;
      const tsSec = Math.floor(candle.timestamp.getTime() / 1000);
      
      // Roll back any events that happened after this candle timestamp
      while (evIdx < sortedEvents.length && sortedEvents[evIdx]!.timestamp > tsSec) {
        applyRollbackToRangeMap(rangeMap, sortedEvents[evIdx]!);
        evIdx++;
      }
      
      const sqrtX96 = candle.sqrtPriceX96;
      const currentPrice = candle.close;
      
      if (!sqrtX96 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
        // Use last valid depth values
        depthPoints[i] = { timestamp: candle.timestamp, bidDepth: lastBidDepth, askDepth: lastAskDepth };
        continue;
      }
      
      // Derive tick from sqrtPriceX96
      const rawPrice = sqrtPriceX96ToPrice(BigInt(sqrtX96), 0, 0);
      const tick = priceToTick(rawPrice);
      
      // Simulate a $10k swap to get the slippage percentage
      const impactResult = simulateImpactPricesFromRangeMap({
        rangeMap,
        currentTick: tick,
        sqrtPriceX96: sqrtX96,
        token0Decimals: poolData.token0Decimals,
        token1Decimals: poolData.token1Decimals,
        currentPrice,
        orderUsd: testSwapUsd,
        token0UsdPrice,
        token1UsdPrice,
      });
      
      // Calculate slippage percentages
      const buySlippagePct = Number.isFinite(impactResult.buyPrice) && impactResult.buyPrice > 0
        ? Math.abs((impactResult.buyPrice / currentPrice) - 1) * 100
        : 0;
      const sellSlippagePct = Number.isFinite(impactResult.sellPrice) && impactResult.sellPrice > 0
        ? Math.abs(1 - (impactResult.sellPrice / currentPrice)) * 100
        : 0;
      
      // Estimate depth: if $10k causes X% slippage, then depth at 1% ≈ $10k * (1% / X%)
      let askDepth = buySlippagePct > 0.01 
        ? testSwapUsd * (targetSlippagePct / buySlippagePct) 
        : maxDepth;
      let bidDepth = sellSlippagePct > 0.01 
        ? testSwapUsd * (targetSlippagePct / sellSlippagePct) 
        : maxDepth;
      
      // Clamp to reasonable values
      askDepth = Math.max(minDepth, Math.min(maxDepth, Number.isFinite(askDepth) ? askDepth : lastAskDepth));
      bidDepth = Math.max(minDepth, Math.min(maxDepth, Number.isFinite(bidDepth) ? bidDepth : lastBidDepth));
      
      // Update last valid values for forward-fill
      lastBidDepth = bidDepth;
      lastAskDepth = askDepth;
      
      depthPoints[i] = { timestamp: candle.timestamp, bidDepth, askDepth };
    }
    
    // Forward-fill any remaining gaps from the beginning
    for (let i = 1; i < depthPoints.length; i++) {
      if (depthPoints[i]!.bidDepth === minDepth && depthPoints[i - 1]!.bidDepth > minDepth) {
        depthPoints[i]!.bidDepth = depthPoints[i - 1]!.bidDepth;
      }
      if (depthPoints[i]!.askDepth === minDepth && depthPoints[i - 1]!.askDepth > minDepth) {
        depthPoints[i]!.askDepth = depthPoints[i - 1]!.askDepth;
      }
    }

    // Cache valid result for smooth transitions
    lastValidDepthDataRef.current = depthPoints;
    return depthPoints;
  // Use debounced fingerprint for stability, same as impact band
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFingerprint, externalImpactBand, token0UsdPrice, token1UsdPrice]);

  // Create data with overridden depth if available
  const dataWithDepthOverride = useMemo(() => {
    if (!data) return data;
    if (!depthDataOverride) return data;
    return {
      ...data,
      depthData: depthDataOverride,
    };
  }, [data, depthDataOverride]);

  return (
    <div className={cn("relative w-full h-full", className)} style={{ background: theme.background }}>
      {/* Chart area */}
      <div className="w-full h-full rounded-lg overflow-hidden" style={{ background: theme.background }}>
        <ParentSize debounceTime={10}>
          {({ width, height }: { width: number; height: number }) => {
            // Use minimum height if parent size returns 0
            const chartWidth = width > 0 ? width : 800;
            const chartHeight = height > 0 ? height : 600;
            return (
              <TradingChart
                data={dataWithDepthOverride}
                lpRanges={lpRanges}
                width={chartWidth}
                height={chartHeight}
                theme={theme}
                depthBand={depthBandConfig.enabled ? depthBand : null}
                impactBand={impactBand}
                impactBandSwapUsd={impactBandSwapUsd}
                visibility={{
                  candlesticks: chartVisibility.candlesticks,
                  oracleBand: showOracleBand,
                  oracleLine: chartVisibility.oracleLine,
                  positionRanges: chartVisibility.positionRanges,
                  depthAreas: chartVisibility.depthAreas,
                  bidAskLines: chartVisibility.bidAskLines,
                }}
                focusHeightRatio={lpActivityFocusHeightRatio}
                minRangeRatioForSplit={lpActivityMinRangeRatioForSplit}
                minCandleBodyPx={lpActivityMinCandleBodyPx}
                lpEvents={lpEvents}
                v3Swaps={v3Swaps}
                poolData={poolData}
              />
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
};

// ============================================================================
// LEGACY EXPORTS (for backwards compatibility)
// ============================================================================

export const LPAddressActivityMonitor = LPAddressActivityChart;

// Types are already exported at definition above
