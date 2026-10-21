import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChartTimeRange = "1h" | "4h" | "12h" | "1d" | "3d" | "1w" | "2w" | "1m" | "3m" | "1y";

// Candle granularity: "auto" picks the best interval for the time range,
// explicit values let the user override (e.g. keep 5m candles on a 1-month view).
export type ChartGranularity = "auto" | "5m" | "15m" | "1h" | "4h" | "1d";

export const GRANULARITY_LABELS: Record<ChartGranularity, string> = {
  auto: "Auto",
  "5m": "5 Minutes",
  "15m": "15 Minutes",
  "1h": "1 Hour",
  "4h": "4 Hours",
  "1d": "1 Day",
};

// Map granularity string to seconds (used by data hooks)
export const GRANULARITY_SECONDS: Record<Exclude<ChartGranularity, "auto">, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

// Map time range to approximate number of days (for APIs that take a days param)
export const TIME_RANGE_DAYS: Record<ChartTimeRange, number> = {
  "1h": 1,
  "4h": 1,
  "12h": 1,
  "1d": 1,
  "3d": 3,
  "1w": 7,
  "2w": 14,
  "1m": 30,
  "3m": 90,
  "1y": 365,
};

// Panel-level visibility: controls whether expensive data fetching happens
export type PanelVisibilityKey =
  | "tradingVolumeBySize"
  | "slippageHistory";

export type PanelVisibility = Record<PanelVisibilityKey, boolean>;

export const PANEL_LABELS: Record<PanelVisibilityKey, string> = {
  tradingVolumeBySize: "Trading Volume by Size",
  slippageHistory: "Slippage History",
};

export type TopMetricsDenomination = "token0" | "token1";

export type LiquidityTargetMode = "auto" | "manual";

export type PercentRange = { minPct: number; maxPct: number };

export type ChartVisibilityKey =
  | "oracleBand"
  | "oracleLine"
  | "depthAreas"
  | "positionRanges"
  | "bidAskLines"
  | "candlesticks";

export type ChartVisibility = Record<ChartVisibilityKey, boolean>;

export type DepthBandConfig = {
  enabled: boolean;
  swapAmountUSD: number;
  showAsReplacement: boolean; // Replace oracle band vs show both
};

export type OracleSource = "coingecko";

// Liquidity pricing mode: how to value liquidity in charts
// - "current-price": Use current oracle price for all ticks (existing behavior)
// - "tick-price": Use each tick's implied price (shows execution-weighted depth)
export type LiquidityPricingMode = "current-price" | "tick-price";

// Historical Liquidity Depth heatmap (replaces the Capital Efficiency card).
// - priceMode "fixed": shared absolute-price Y axis, the price line sweeps through the grid (default)
// - priceMode "sliding": price-centered offset bins (Bookmap "follow price")
export type HeatmapPriceMode = "fixed" | "sliding";
// - colorScale "percentile": clamp intensity at the 99th percentile (heavy-tailed depth)
// - colorScale "log": log-scaled intensity
export type HeatmapColorScale = "percentile" | "log";
export type HeatmapWindowDays = 7 | 30 | 90 | 365;
// - depthMode "precise": replay signed liquidityDelta so depth varies within a position's life (default, accurate)
// - depthMode "peak": each position held at its peak liquidity across its lifetime (fast approximation)
export type HeatmapDepthMode = "precise" | "peak";

// Liquidity distribution bar width (see `useRealTickSpacing` in ChartSettingsState):
// - false (default): aggregate neighbouring ticks to hit ~80 bars across the display range
// - true: each bar spans exactly one pool `tickSpacing` (real on-chain resolution)

export const ORACLE_SOURCE_LABELS: Record<OracleSource, string> = {
  coingecko: "CoinGecko",
};

interface ChartSettingsState {
  // Global
  timeRange: ChartTimeRange;
  setTimeRange: (timeRange: ChartTimeRange) => void;
  granularity: ChartGranularity;
  setGranularity: (granularity: ChartGranularity) => void;

  // Top metrics display denomination (WLD vs USDC for this pool)
  topMetricsDenomination: TopMetricsDenomination;
  setTopMetricsDenomination: (v: TopMetricsDenomination) => void;

  // Oracle source for historical price reference line
  oracleSource: OracleSource;
  setOracleSource: (source: OracleSource) => void;

  // LP Activity chart (oracle band + depth window)
  lpActivityOracleRange: PercentRange; // used for oracle band + depth window
  setLpActivityOracleRange: (range: PercentRange) => void;

  // Liquidity target (used by <LiquidityTargetChart />)
  liquidityTargetMode: LiquidityTargetMode;
  liquidityTargetUsd: number; // only used when mode === "manual"
  setLiquidityTargetMode: (mode: LiquidityTargetMode) => void;
  setLiquidityTargetUsd: (value: number) => void;

  // LP Activity chart visual settings (moved from per-chart popover)
  lpActivityFocusHeightRatio: number;
  lpActivityMinCandleBodyPx: number;
  lpActivityMinRangeRatioForSplit: number;
  setLpActivityFocusHeightRatio: (v: number) => void;
  setLpActivityMinCandleBodyPx: (v: number) => void;
  setLpActivityMinRangeRatioForSplit: (v: number) => void;

  // LP Activity chart: element visibility (persisted)
  chartVisibility: ChartVisibility;
  toggleChartElement: (element: ChartVisibilityKey) => void;
  setChartVisibility: (visibility: Partial<ChartVisibility>) => void;
  resetChartVisibility: () => void;

  // LP Activity chart: $X depth band config (persisted)
  depthBandConfig: DepthBandConfig;
  setDepthBandConfig: (config: Partial<DepthBandConfig>) => void;
  resetDepthBandConfig: () => void;

  // Slippage History chart: order size for slippage calculation
  slippageOrderSizeUsd: number;
  setSlippageOrderSizeUsd: (value: number) => void;

  // Liquidity pricing mode: current-price vs tick-price
  liquidityPricingMode: LiquidityPricingMode;
  setLiquidityPricingMode: (mode: LiquidityPricingMode) => void;

  // Liquidity distribution bar width: aggregated (~80 bars) vs real tickSpacing
  useRealTickSpacing: boolean;
  setUseRealTickSpacing: (value: boolean) => void;

  // Historical Liquidity Depth heatmap
  heatmapWindowDays: HeatmapWindowDays;
  heatmapPriceMode: HeatmapPriceMode;
  heatmapColorScale: HeatmapColorScale;
  heatmapIncludeInactive: boolean;
  heatmapDepthMode: HeatmapDepthMode;
  setHeatmapWindowDays: (value: HeatmapWindowDays) => void;
  setHeatmapPriceMode: (value: HeatmapPriceMode) => void;
  setHeatmapColorScale: (value: HeatmapColorScale) => void;
  setHeatmapIncludeInactive: (value: boolean) => void;
  setHeatmapDepthMode: (value: HeatmapDepthMode) => void;

  // Panel-level visibility: gates expensive data fetching
  panelVisibility: PanelVisibility;
  togglePanel: (panel: PanelVisibilityKey) => void;
  setPanelVisibility: (visibility: Partial<PanelVisibility>) => void;

  // Convenience
  resetAll: () => void;
}

const DEFAULT_CHART_VISIBILITY: ChartVisibility = {
  oracleBand: true,
  oracleLine: true,
  depthAreas: true,
  positionRanges: true,
  bidAskLines: true,
  candlesticks: true,
};

const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  tradingVolumeBySize: true,
  slippageHistory: true,
};

const DEFAULT_DEPTH_BAND_CONFIG: DepthBandConfig = {
  enabled: false,
  swapAmountUSD: 10_000,
  showAsReplacement: true,
};

const DEFAULTS: Pick<
  ChartSettingsState,
  | "timeRange"
  | "granularity"
  | "topMetricsDenomination"
  | "oracleSource"
  | "lpActivityOracleRange"
  | "liquidityTargetMode"
  | "liquidityTargetUsd"
  | "lpActivityFocusHeightRatio"
  | "lpActivityMinCandleBodyPx"
  | "lpActivityMinRangeRatioForSplit"
  | "chartVisibility"
  | "depthBandConfig"
  | "slippageOrderSizeUsd"
  | "liquidityPricingMode"
  | "useRealTickSpacing"
  | "panelVisibility"
  | "heatmapWindowDays"
  | "heatmapPriceMode"
  | "heatmapColorScale"
  | "heatmapIncludeInactive"
  | "heatmapDepthMode"
> = {
  timeRange: "1d",
  granularity: "auto",
  topMetricsDenomination: "token1",
  oracleSource: "coingecko",
  // Default matches existing UI intent (±1%) and the visual band in the chart.
  lpActivityOracleRange: { minPct: -1, maxPct: 1 },
  liquidityTargetMode: "auto",
  liquidityTargetUsd: 25_000,
  lpActivityFocusHeightRatio: 0.86,
  // Higher default so candles remain visible on low-volatility pools.
  lpActivityMinCandleBodyPx: 8,
  lpActivityMinRangeRatioForSplit: 2.0,
  chartVisibility: DEFAULT_CHART_VISIBILITY,
  depthBandConfig: DEFAULT_DEPTH_BAND_CONFIG,
  slippageOrderSizeUsd: 10_000,
  liquidityPricingMode: "current-price",
  useRealTickSpacing: false,
  panelVisibility: DEFAULT_PANEL_VISIBILITY,
  // Include positions that have since closed by default, so the historical view
  // is truthful (otherwise the past looks artificially thin — only survivors).
  heatmapIncludeInactive: true,
  heatmapWindowDays: 30,
  heatmapPriceMode: "fixed",
  heatmapColorScale: "percentile",
  heatmapDepthMode: "precise",
};

export const useChartSettingsStore = create<ChartSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setTimeRange: (timeRange) => set({ timeRange }),
      setGranularity: (granularity) => set({ granularity }),

      setTopMetricsDenomination: (topMetricsDenomination) => set({ topMetricsDenomination }),

      setOracleSource: (oracleSource) => set({ oracleSource }),

      setLpActivityOracleRange: (lpActivityOracleRange) => set({ lpActivityOracleRange }),

      setLiquidityTargetMode: (liquidityTargetMode) => set({ liquidityTargetMode }),
      setLiquidityTargetUsd: (liquidityTargetUsd) =>
        set({ liquidityTargetUsd: Number.isFinite(liquidityTargetUsd) ? liquidityTargetUsd : DEFAULTS.liquidityTargetUsd }),

      setLpActivityFocusHeightRatio: (lpActivityFocusHeightRatio) => set({ lpActivityFocusHeightRatio }),
      setLpActivityMinCandleBodyPx: (lpActivityMinCandleBodyPx) => set({ lpActivityMinCandleBodyPx }),
      setLpActivityMinRangeRatioForSplit: (lpActivityMinRangeRatioForSplit) => set({ lpActivityMinRangeRatioForSplit }),

      toggleChartElement: (element) =>
        set((state) => ({
          chartVisibility: {
            ...state.chartVisibility,
            [element]: !state.chartVisibility[element],
          },
        })),

      setChartVisibility: (visibility) =>
        set((state) => ({
          chartVisibility: {
            ...state.chartVisibility,
            ...visibility,
          },
        })),

      resetChartVisibility: () => set({ chartVisibility: DEFAULT_CHART_VISIBILITY }),

      setDepthBandConfig: (config) =>
        set((state) => ({
          depthBandConfig: {
            ...state.depthBandConfig,
            ...config,
          },
        })),

      resetDepthBandConfig: () => set({ depthBandConfig: DEFAULT_DEPTH_BAND_CONFIG }),

      setSlippageOrderSizeUsd: (slippageOrderSizeUsd) =>
        set({ slippageOrderSizeUsd: Number.isFinite(slippageOrderSizeUsd) ? slippageOrderSizeUsd : DEFAULTS.slippageOrderSizeUsd }),

      setLiquidityPricingMode: (liquidityPricingMode) => set({ liquidityPricingMode }),

      setUseRealTickSpacing: (useRealTickSpacing) => set({ useRealTickSpacing }),

      setHeatmapWindowDays: (heatmapWindowDays) => set({ heatmapWindowDays }),
      setHeatmapPriceMode: (heatmapPriceMode) => set({ heatmapPriceMode }),
      setHeatmapColorScale: (heatmapColorScale) => set({ heatmapColorScale }),
      setHeatmapIncludeInactive: (heatmapIncludeInactive) => set({ heatmapIncludeInactive }),
      setHeatmapDepthMode: (heatmapDepthMode) => set({ heatmapDepthMode }),

      togglePanel: (panel) =>
        set((state) => ({
          panelVisibility: {
            ...state.panelVisibility,
            [panel]: !state.panelVisibility[panel],
          },
        })),

      setPanelVisibility: (visibility) =>
        set((state) => ({
          panelVisibility: {
            ...state.panelVisibility,
            ...visibility,
          },
        })),

      resetAll: () =>
        set({
          ...DEFAULTS,
          // Ensure we reset to the canonical default objects (not whatever DEFAULTS captured).
          granularity: "auto",
          oracleSource: "coingecko",
          chartVisibility: DEFAULT_CHART_VISIBILITY,
          depthBandConfig: DEFAULT_DEPTH_BAND_CONFIG,
          slippageOrderSizeUsd: 10_000,
          liquidityPricingMode: "current-price",
          useRealTickSpacing: false,
          panelVisibility: DEFAULT_PANEL_VISIBILITY,
        }),
    }),
    {
      name: "chart-settings",
      // Bump this version whenever the persisted schema changes (new keys, type changes, etc.).
      // The migrate function below will backfill missing defaults so stale localStorage
      // doesn't hide new features (e.g., oracle line added after initial persist).
      version: 7,
      migrate: (persisted: unknown, version: number) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = (persisted ?? {}) as Record<string, any>;

        if (version < 2) {
          // Ensure chartVisibility has all keys (backfill new toggles)
          state.chartVisibility = {
            ...DEFAULT_CHART_VISIBILITY,
            ...(state.chartVisibility ?? {}),
          };

          // Ensure depthBandConfig has all keys
          state.depthBandConfig = {
            ...DEFAULT_DEPTH_BAND_CONFIG,
            ...(state.depthBandConfig ?? {}),
          };

          // Ensure oracleSource is a valid value
          if (state.oracleSource !== "coingecko") {
            state.oracleSource = DEFAULTS.oracleSource;
          }

          // Backfill any top-level keys that didn't exist in older versions
          for (const [key, value] of Object.entries(DEFAULTS)) {
            if (!(key in state)) {
              state[key] = value;
            }
          }
        }

        if (version < 3) {
          // Backfill panelVisibility for users with older persisted state
          state.panelVisibility = {
            ...DEFAULT_PANEL_VISIBILITY,
            ...(state.panelVisibility ?? {}),
          };
        }

        if (version < 4) {
          // Backfill useRealTickSpacing toggle (liquidity distribution bar width)
          if (typeof state.useRealTickSpacing !== "boolean") {
            state.useRealTickSpacing = DEFAULTS.useRealTickSpacing;
          }
        }

        if (version < 5) {
          // One-time reset: liquidity distribution resolution (real tick spacing)
          // should be off by default. Force-reset for any user who had it enabled.
          state.useRealTickSpacing = false;
        }

        if (version < 6) {
          // Backfill Historical Liquidity Depth heatmap settings.
          if (typeof state.heatmapIncludeInactive !== "boolean") state.heatmapIncludeInactive = DEFAULTS.heatmapIncludeInactive;
          if (typeof state.heatmapWindowDays !== "number") state.heatmapWindowDays = DEFAULTS.heatmapWindowDays;
          if (state.heatmapPriceMode !== "fixed" && state.heatmapPriceMode !== "sliding") {
            state.heatmapPriceMode = DEFAULTS.heatmapPriceMode;
          }
          if (state.heatmapColorScale !== "percentile" && state.heatmapColorScale !== "log") {
            state.heatmapColorScale = DEFAULTS.heatmapColorScale;
          }
        }

        if (version < 7) {
          // Backfill the heatmap depth mode (precise instant-liquidity vs peak).
          if (state.heatmapDepthMode !== "precise" && state.heatmapDepthMode !== "peak") {
            state.heatmapDepthMode = DEFAULTS.heatmapDepthMode;
          }
        }

        return state;
      },
    }
  )
);
