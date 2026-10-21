"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings2, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SupportedPool } from "@/lib/pools";
import {
  useBirdsEyeSettingsStore,
  DEFAULT_METRIC_THRESHOLDS,
  type MetricThresholds,
} from "@/stores/birds-eye-settings-store";

// ── Helpers ──

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function formatUsdCompact(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

// ── Component ──

export function BirdsEyeSettingsFab({
  supportedPools,
}: {
  supportedPools: SupportedPool[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedPoolKey, setSelectedPoolKey] = useState<string | null>(null);

  const {
    overall,
    poolOverrides,
    setOverall,
    setPoolOverride,
    clearPoolOverride,
    resetAll,
  } = useBirdsEyeSettingsStore();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Active thresholds for the selected scope
  const activeThresholds: MetricThresholds =
    selectedPoolKey && poolOverrides[selectedPoolKey]
      ? {
          priceDeviation: {
            ...overall.priceDeviation,
            ...poolOverrides[selectedPoolKey]?.priceDeviation,
          },
          tvl: { ...overall.tvl, ...poolOverrides[selectedPoolKey]?.tvl },
          depth: { ...overall.depth, ...poolOverrides[selectedPoolKey]?.depth },
          spread: { ...overall.spread, ...poolOverrides[selectedPoolKey]?.spread },
        }
      : selectedPoolKey
        ? overall // Pool selected but no override yet — show overall
        : overall;

  const hasPoolOverride = selectedPoolKey ? !!poolOverrides[selectedPoolKey] : false;

  // Generic update dispatcher
  function updateThreshold<K extends keyof MetricThresholds>(
    group: K,
    partial: Partial<MetricThresholds[K]>,
  ) {
    if (selectedPoolKey) {
      setPoolOverride(selectedPoolKey, { [group]: partial } as Partial<MetricThresholds>);
    } else {
      setOverall({ [group]: partial } as Partial<MetricThresholds>);
    }
  }

  return (
    <div className="absolute bottom-4 right-4 z-50">
      {/* Backdrop */}
      <AnimatePresence>
        {open ? (
          <motion.button
            type="button"
            aria-label="Close settings backdrop"
            className="fixed inset-0 z-40 cursor-default bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      {/* Anchor container */}
      <div className="relative z-50">
        {/* Blueprint-styled FAB button */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close threshold settings" : "Open threshold settings"}
          className={cn(
            "relative inline-flex items-center justify-center",
            "w-11 h-11",
            "bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)]",
            "text-[var(--bp-text-secondary)]",
            "hover:border-[var(--bp-border-secondary)] hover:text-[var(--bp-accent-primary)]",
            "active:bg-[var(--bp-bg-card-alt)]",
            "transition-all duration-200",
            "shadow-sm",
            open && "border-[var(--bp-accent-primary)] text-[var(--bp-accent-primary)]",
          )}
        >
          {/* Corner markers */}
          <span className="absolute top-1 left-1 w-2 h-2 border-t border-l border-[var(--bp-border-secondary)] opacity-30" />
          <span className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-[var(--bp-border-secondary)] opacity-30" />

          {open ? (
            <X size={18} strokeWidth={1.5} />
          ) : (
            <Settings2 size={18} strokeWidth={1.5} />
          )}
        </button>

        <AnimatePresence>
          {open ? (
            <motion.div
              role="dialog"
              aria-label="Threshold settings"
              className={cn(
                "absolute right-0 top-14",
                "w-[340px] sm:w-[380px]",
                "max-h-[calc(100vh-120px)]",
                "flex flex-col",
                "bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)]",
                "shadow-lg",
                "font-mono",
              )}
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Corner markers */}
              <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t border-l border-[var(--bp-border-secondary)] opacity-20 pointer-events-none" />
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t border-r border-[var(--bp-border-secondary)] opacity-20 pointer-events-none" />
              <span className="absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b border-l border-[var(--bp-border-secondary)] opacity-20 pointer-events-none" />
              <span className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b border-r border-[var(--bp-border-secondary)] opacity-20 pointer-events-none" />

              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--bp-border-subtle)]">
                <div className="flex items-center gap-2">
                  <Settings2
                    size={14}
                    className="text-[var(--bp-accent-primary)]"
                    strokeWidth={1.5}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--bp-text-muted)]">
                    Thresholds
                  </span>
                </div>
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wide text-[var(--bp-text-muted)] hover:text-[var(--bp-accent-primary)] transition-colors"
                  onClick={() => {
                    resetAll();
                    setSelectedPoolKey(null);
                  }}
                >
                  Reset all
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
                {/* Pool selector */}
                <SettingSection title="Scope">
                  <select
                    value={selectedPoolKey ?? "__overall__"}
                    onChange={(e) =>
                      setSelectedPoolKey(
                        e.target.value === "__overall__" ? null : e.target.value,
                      )
                    }
                    className="bp-select"
                  >
                    <option value="__overall__">Overall (Default)</option>
                    {supportedPools.map((p) => (
                      <option key={p.poolKey} value={p.poolKey}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    {selectedPoolKey
                      ? "Per-pool overrides take priority over overall"
                      : "Global defaults for all pools"}
                  </p>
                </SettingSection>

                {/* Clear pool override button */}
                {selectedPoolKey && hasPoolOverride && (
                  <button
                    type="button"
                    onClick={() => {
                      clearPoolOverride(selectedPoolKey);
                    }}
                    className={cn(
                      "w-full flex items-center justify-center gap-2 py-2 px-3",
                      "text-[10px] uppercase tracking-wider font-semibold",
                      "border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400",
                      "hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors",
                    )}
                  >
                    <Trash2 size={12} />
                    Clear pool overrides
                  </button>
                )}

                {/* Price Deviation */}
                <SettingSection title="Price Deviation">
                  <ThresholdInput
                    label="Watch ≥"
                    value={activeThresholds.priceDeviation.watchPct}
                    onChange={(v) =>
                      updateThreshold("priceDeviation", { watchPct: clamp(v, 0.01, 99) })
                    }
                    suffix="%"
                    step={0.1}
                    min={0.01}
                    max={99}
                  />
                  <ThresholdInput
                    label="Critical ≥"
                    value={activeThresholds.priceDeviation.criticalPct}
                    onChange={(v) =>
                      updateThreshold("priceDeviation", { criticalPct: clamp(v, 0.01, 99) })
                    }
                    suffix="%"
                    step={0.1}
                    min={0.01}
                    max={99}
                  />
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    Pool-to-oracle price deviation that triggers Watch / Critical status
                  </p>
                </SettingSection>

                {/* TVL */}
                <SettingSection title="TVL (USD)">
                  <ThresholdInput
                    label="Good >"
                    value={activeThresholds.tvl.okAbove}
                    onChange={(v) =>
                      updateThreshold("tvl", { okAbove: clamp(v, 0, 100_000_000) })
                    }

                    step={10000}
                    min={0}
                    max={100_000_000}
                    formatHint={formatUsdCompact(activeThresholds.tvl.okAbove)}
                  />
                  <ThresholdInput
                    label="Warning >"
                    value={activeThresholds.tvl.warnAbove}
                    onChange={(v) =>
                      updateThreshold("tvl", { warnAbove: clamp(v, 0, 100_000_000) })
                    }

                    step={10000}
                    min={0}
                    max={100_000_000}
                    formatHint={formatUsdCompact(activeThresholds.tvl.warnAbove)}
                  />
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    Total value locked thresholds for Good / Warning color
                  </p>
                </SettingSection>

                {/* Depth */}
                <SettingSection title="Depth (USD)">
                  <ThresholdInput
                    label="Good >"
                    value={activeThresholds.depth.okAbove}
                    onChange={(v) =>
                      updateThreshold("depth", { okAbove: clamp(v, 0, 100_000_000) })
                    }

                    step={1000}
                    min={0}
                    max={100_000_000}
                    formatHint={formatUsdCompact(activeThresholds.depth.okAbove)}
                  />
                  <ThresholdInput
                    label="Warning >"
                    value={activeThresholds.depth.warnAbove}
                    onChange={(v) =>
                      updateThreshold("depth", { warnAbove: clamp(v, 0, 100_000_000) })
                    }

                    step={1000}
                    min={0}
                    max={100_000_000}
                    formatHint={formatUsdCompact(activeThresholds.depth.warnAbove)}
                  />
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    Buy/Sell depth at 2% price impact in USD
                  </p>
                </SettingSection>

                {/* Spread */}
                <SettingSection title="Effective Spread">
                  <ThresholdInput
                    label="Good <"
                    value={activeThresholds.spread.okBelow}
                    onChange={(v) =>
                      updateThreshold("spread", { okBelow: clamp(v, 0.01, 99) })
                    }
                    suffix="%"
                    step={0.1}
                    min={0.01}
                    max={99}
                  />
                  <ThresholdInput
                    label="Warning >"
                    value={activeThresholds.spread.warnBelow}
                    onChange={(v) =>
                      updateThreshold("spread", { warnBelow: clamp(v, 0.01, 99) })
                    }
                    suffix="%"
                    step={0.1}
                    min={0.01}
                    max={99}
                  />
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    Effective spread = 2× fee + $10k sell impact
                  </p>
                </SettingSection>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card-alt)]">
                <p className="text-[10px] text-[var(--bp-text-muted)] text-center">
                  Press{" "}
                  <kbd className="px-1.5 py-0.5 bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)] text-[9px]">
                    ESC
                  </kbd>{" "}
                  to close
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Styles (idempotent — safe if ChartSettingsFab also injects these) */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: var(--bp-bg-card-alt);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--bp-border-secondary);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--bp-accent-primary);
        }
        .bp-input {
          width: 100%;
          padding: 8px 12px;
          font-size: 12px;
          font-family: "IBM Plex Mono", monospace;
          background: var(--bp-bg-card-alt);
          border: 1px solid var(--bp-border-subtle);
          color: var(--bp-text-primary);
          transition: all 0.15s ease;
        }
        .bp-input:hover {
          border-color: var(--bp-border-secondary);
        }
        .bp-input:focus {
          outline: none;
          border-color: var(--bp-accent-primary);
          box-shadow: 0 0 0 1px var(--bp-accent-glow);
        }
        .bp-select {
          width: 100%;
          padding: 8px 12px;
          font-size: 12px;
          font-family: "IBM Plex Mono", monospace;
          background: var(--bp-bg-card-alt);
          border: 1px solid var(--bp-border-subtle);
          color: var(--bp-text-primary);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .bp-select:hover {
          border-color: var(--bp-border-secondary);
        }
        .bp-select:focus {
          outline: none;
          border-color: var(--bp-accent-primary);
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──

function SettingSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--bp-text-muted)]">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function ThresholdInput({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  min = 0,
  max = 100,
  formatHint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  formatHint?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-[var(--bp-text-secondary)] w-[72px] shrink-0">
        {label}
      </span>
      <div className="relative flex-1">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--bp-text-muted)]">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          className={cn("bp-input", prefix && "pl-8", suffix && "pr-8")}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--bp-text-muted)]">
            {suffix}
          </span>
        )}
      </div>
      {formatHint && (
        <span className="text-[10px] text-[var(--bp-text-muted)] w-[52px] text-right shrink-0">
          {formatHint}
        </span>
      )}
    </div>
  );
}
