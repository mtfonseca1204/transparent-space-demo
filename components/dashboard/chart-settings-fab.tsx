"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChartSettingsStore, GRANULARITY_LABELS, PANEL_LABELS, type ChartGranularity, type PanelVisibilityKey } from "@/stores/chart-settings-store";

export function ChartSettingsFab() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const {
    timeRange,
    setTimeRange,
    granularity,
    setGranularity,
    slippageOrderSizeUsd,
    setSlippageOrderSizeUsd,
    liquidityPricingMode,
    setLiquidityPricingMode,
    useRealTickSpacing,
    setUseRealTickSpacing,
    panelVisibility,
    togglePanel,
    resetAll,
  } = useChartSettingsStore();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const clampInt = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(v)));

  return (
    <div className="fixed top-4 right-4 z-50">
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
          aria-label={open ? "Close chart settings" : "Open chart settings"}
          className={cn(
            "relative inline-flex items-center justify-center",
            "w-11 h-11",
            "bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)]",
            "text-[var(--bp-text-secondary)]",
            "hover:border-[var(--bp-border-secondary)] hover:text-[var(--bp-accent-primary)]",
            "active:bg-[var(--bp-bg-card-alt)]",
            "transition-all duration-200",
            "shadow-sm",
            open && "border-[var(--bp-accent-primary)] text-[var(--bp-accent-primary)]"
          )}
        >
          {/* Corner markers */}
          <span className="absolute top-1 left-1 w-2 h-2 border-t border-l border-[var(--bp-border-secondary)] opacity-30" />
          <span className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-[var(--bp-border-secondary)] opacity-30" />
          
          {open ? <X size={18} strokeWidth={1.5} /> : <Settings2 size={18} strokeWidth={1.5} />}
        </button>

        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label="Global chart settings"
              className={cn(
                "absolute right-0 top-14",
                "w-[340px] sm:w-[380px]",
                "max-h-[calc(100vh-120px)]",
                "flex flex-col",
                "bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)]",
                "shadow-lg",
                "font-mono"
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

              {/* Header - fixed */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--bp-border-subtle)]">
                <div className="flex items-center gap-2">
                  <Settings2 size={14} className="text-[var(--bp-accent-primary)]" strokeWidth={1.5} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--bp-text-muted)]">
                    Settings
                  </span>
                </div>
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-wide text-[var(--bp-text-muted)] hover:text-[var(--bp-accent-primary)] transition-colors"
                  onClick={() => resetAll()}
                >
                  Reset all
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 custom-scrollbar">
                {/* Liquidity Valuation */}
                <SettingSection title="Liquidity Valuation">
                  <ToggleRow
                    label="Tick-based pricing"
                    description="Value liquidity at each tick's price"
                    checked={liquidityPricingMode === "tick-price"}
                    onToggle={() =>
                      setLiquidityPricingMode(liquidityPricingMode === "tick-price" ? "current-price" : "tick-price")
                    }
                  />
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    {liquidityPricingMode === "tick-price"
                      ? "Shows execution-weighted depth at each tick"
                      : "Uses current oracle price for all ticks"}
                  </p>
                </SettingSection>

                {/* Liquidity Distribution Resolution */}
                <SettingSection title="Liquidity Distribution Resolution">
                  <ToggleRow
                    label="Real tick spacing"
                    description="1 bar = 1 pool tickSpacing"
                    checked={useRealTickSpacing}
                    onToggle={() => setUseRealTickSpacing(!useRealTickSpacing)}
                  />
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    {useRealTickSpacing
                      ? "Each bar spans exactly one tickSpacing (on-chain resolution). Zoom controls tighten the window."
                      : "Bars are aggregated to ~80 across the display range. Default, smoother shape."}
                  </p>
                </SettingSection>

                {/* Time range */}
                <SettingSection title="Time Range">
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as any)}
                    className="bp-select"
                  >
                    <option value="1h">1 Hour</option>
                    <option value="4h">4 Hours</option>
                    <option value="12h">12 Hours</option>
                    <option value="1d">1 Day</option>
                    <option value="3d">3 Days</option>
                    <option value="1w">1 Week</option>
                    <option value="2w">2 Weeks</option>
                    <option value="1m">1 Month</option>
                    <option value="3m">3 Months</option>
                    <option value="1y">1 Year</option>
                  </select>
                </SettingSection>

                {/* Granularity */}
                <SettingSection title="Granularity">
                  <select
                    value={granularity}
                    onChange={(e) => setGranularity(e.target.value as ChartGranularity)}
                    className="bp-select"
                  >
                    {(Object.keys(GRANULARITY_LABELS) as ChartGranularity[]).map((key) => (
                      <option key={key} value={key}>
                        {GRANULARITY_LABELS[key]}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    {granularity === "auto"
                      ? "Automatically picks the best resolution for the time range"
                      : "Fine granularity on long ranges may be slow"}
                  </p>
                </SettingSection>

                {/* Slippage Order Size */}
                <SettingSection title="Slippage Order Size (USD)">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--bp-text-muted)]">$</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={100}
                      max={10_000_000}
                      step={1000}
                      value={slippageOrderSizeUsd}
                      onChange={(e) => setSlippageOrderSizeUsd(clampInt(Number(e.target.value || 0), 100, 10_000_000))}
                      className="bp-input pl-7"
                    />
                  </div>
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    Slippage history chart order size
                  </p>
                </SettingSection>

                {/* Panel Visibility */}
                <SettingSection title="Chart Panels">
                  {(Object.keys(PANEL_LABELS) as PanelVisibilityKey[]).map((key) => (
                    <ToggleRow
                      key={key}
                      label={PANEL_LABELS[key]}
                      description={panelVisibility[key] ? "Fetching data" : "Disabled — saves API quota"}
                      checked={panelVisibility[key]}
                      onToggle={() => togglePanel(key)}
                    />
                  ))}
                  <p className="text-[10px] text-[var(--bp-text-muted)] mt-1.5">
                    Disable panels to reduce API load and avoid rate limits
                  </p>
                </SettingSection>
              </div>

              {/* Footer - fixed */}
              <div className="px-5 py-3 border-t border-[var(--bp-border-subtle)] bg-[var(--bp-bg-card-alt)]">
                <p className="text-[10px] text-[var(--bp-text-muted)] text-center">
                  Press <kbd className="px-1.5 py-0.5 bg-[var(--bp-bg-card)] border border-[var(--bp-border-subtle)] text-[9px]">ESC</kbd> to close
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Custom scrollbar styles */}
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
          font-family: 'IBM Plex Mono', monospace;
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
        .bp-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .bp-select {
          width: 100%;
          padding: 8px 12px;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
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
        
        .bp-input-group {
          padding: 10px 12px;
          background: var(--bp-bg-card-alt);
          border: 1px solid var(--bp-border-subtle);
        }
        
        /* Custom range slider for blueprint style */
        input[type="range"] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          background: var(--bp-bg-card-alt);
          border: 1px solid var(--bp-border-subtle);
          cursor: pointer;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          background: var(--bp-accent-primary);
          border: 2px solid var(--bp-bg-card);
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          background: var(--bp-accent-primary);
          border: 2px solid var(--bp-bg-card);
          cursor: pointer;
          border-radius: 0;
        }
      `}</style>
    </div>
  );
}

function SettingSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--bp-text-muted)]">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bp-input-group">
      <div className="min-w-0">
        <div className="text-[12px] text-[var(--bp-text-primary)]">{label}</div>
        <div className="text-[10px] text-[var(--bp-text-muted)]">{description}</div>
      </div>

      <BlueprintToggle checked={checked} onToggle={onToggle} ariaLabel={label} />
    </div>
  );
}

function BlueprintToggle({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center transition-all duration-200",
        "border",
        checked
          ? "bg-[var(--bp-accent-primary)]/20 border-[var(--bp-accent-primary)]"
          : "bg-[var(--bp-bg-card-alt)] border-[var(--bp-border-subtle)]"
      )}
      aria-label={ariaLabel}
      aria-pressed={checked}
      onClick={onToggle}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 transform transition-all duration-200",
          checked
            ? "translate-x-5 bg-[var(--bp-accent-primary)]"
            : "translate-x-1 bg-[var(--bp-text-muted)]"
        )}
      />
    </button>
  );
}
