import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Threshold types ──

export interface MetricThresholds {
  priceDeviation: { watchPct: number; criticalPct: number };
  tvl: { okAbove: number; warnAbove: number };
  depth: { okAbove: number; warnAbove: number };
  spread: { okBelow: number; warnBelow: number };
}

export const DEFAULT_METRIC_THRESHOLDS: MetricThresholds = {
  priceDeviation: { watchPct: 1, criticalPct: 2 },
  tvl: { okAbove: 500_000, warnAbove: 100_000 },
  depth: { okAbove: 75_000, warnAbove: 25_000 },    // USD
  spread: { okBelow: 0.3, warnBelow: 1.0 },
};

export type PoolOverrides = Record<string, Partial<MetricThresholds>>;

// ── Resolution helper ──

export function getResolvedThresholds(
  poolKey: string,
  overall: MetricThresholds,
  poolOverrides: PoolOverrides,
): MetricThresholds {
  const override = poolOverrides[poolKey];
  if (!override) return overall;
  return {
    priceDeviation: { ...overall.priceDeviation, ...override.priceDeviation },
    tvl: { ...overall.tvl, ...override.tvl },
    depth: { ...overall.depth, ...override.depth },
    spread: { ...overall.spread, ...override.spread },
  };
}

// ── Store ──

interface BirdsEyeSettingsState {
  overall: MetricThresholds;
  poolOverrides: PoolOverrides;

  setOverall: (partial: Partial<MetricThresholds>) => void;
  setPoolOverride: (poolKey: string, partial: Partial<MetricThresholds>) => void;
  clearPoolOverride: (poolKey: string) => void;
  resetAll: () => void;
}

export const useBirdsEyeSettingsStore = create<BirdsEyeSettingsState>()(
  persist(
    (set) => ({
      overall: DEFAULT_METRIC_THRESHOLDS,
      poolOverrides: {},

      setOverall: (partial) =>
        set((state) => ({
          overall: {
            priceDeviation: { ...state.overall.priceDeviation, ...partial.priceDeviation },
            tvl: { ...state.overall.tvl, ...partial.tvl },
            depth: { ...state.overall.depth, ...partial.depth },
            spread: { ...state.overall.spread, ...partial.spread },
          },
        })),

      setPoolOverride: (poolKey, partial) =>
        set((state) => {
          const existing = state.poolOverrides[poolKey] ?? {};
          const merged: Partial<MetricThresholds> = {
            ...existing,
            ...(partial.priceDeviation && {
              priceDeviation: { ...existing.priceDeviation, ...partial.priceDeviation },
            }),
            ...(partial.tvl && { tvl: { ...existing.tvl, ...partial.tvl } }),
            ...(partial.depth && { depth: { ...existing.depth, ...partial.depth } }),
            ...(partial.spread && { spread: { ...existing.spread, ...partial.spread } }),
          };
          return {
            poolOverrides: { ...state.poolOverrides, [poolKey]: merged },
          };
        }),

      clearPoolOverride: (poolKey) =>
        set((state) => {
          const { [poolKey]: _, ...rest } = state.poolOverrides;
          return { poolOverrides: rest };
        }),

      resetAll: () =>
        set({ overall: DEFAULT_METRIC_THRESHOLDS, poolOverrides: {} }),
    }),
    {
      name: "birds-eye-settings",
      version: 2,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // v1 stored depth as ratio (0.15, 0.08); v2 stores as USD
          const state = persisted as any;
          if (state?.overall?.depth) {
            const d = state.overall.depth;
            if (d.okAbove < 1) state.overall.depth = { okAbove: 75_000, warnAbove: 25_000 };
          }
          for (const key of Object.keys(state?.poolOverrides ?? {})) {
            const d = state.poolOverrides[key]?.depth;
            if (d && (d.okAbove < 1 || d.warnAbove < 1)) {
              delete state.poolOverrides[key].depth;
            }
          }
        }
        return persisted;
      },
    },
  ),
);
