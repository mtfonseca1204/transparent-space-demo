"use client";

import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useTokenViewStore } from "@/stores/token-view-store";
import { usePoolStore } from "@/stores/pool-store";
import { useAuthStore } from "@/lib/auth-store";
import { getPoolsForToken, getTrackedAsset } from "@/lib/token-utils";
import { getSolanaPoolMetadata } from "@/lib/pools";
import { isRfqDisabledSpace, showsArbVolumeTable } from "@/lib/space-policy";
import { useTokenDashboardData } from "@/hooks/use-token-dashboard-data";
import { TokenHeader } from "./token-birds-eye/token-header";
import { PoolOverviewTable } from "./token-birds-eye/pool-overview-table";
import { TVLStackedAreaChart } from "./token-birds-eye/tvl-stacked-area-chart";
import { SlippageMatrix } from "./token-birds-eye/slippage-matrix";
import { ArbVolumeTable } from "./token-birds-eye/arb-volume-table";
import { LPEfficiencyTable } from "./token-birds-eye/lp-efficiency-table";
import { MMLiquiditySection } from "./token-birds-eye/mm-liquidity-section";
import { RfqControlPanel } from "./rfq/rfq-control-panel";

/* ── Top-level Pools / RFQ tab nav ───────────── */
type PanelTab = "pools" | "rfq";

function PanelTabNav({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: PanelTab;
  onChange: (tab: PanelTab) => void;
  tabs: { id: PanelTab; label: string }[];
}) {
  return (
    <div className="border-b border-[var(--bp-border-secondary)]">
      <nav className="flex gap-0.5" aria-label="Control panel tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "px-4 py-2.5 text-[13px] font-semibold tracking-wide transition-colors relative whitespace-nowrap cursor-pointer",
              activeTab === tab.id
                ? "text-[var(--bp-accent-primary)]"
                : "text-[var(--bp-text-secondary)] hover:text-[var(--bp-text-primary)]"
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--bp-accent-primary)] rounded-full" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function TokenBirdsEyeDashboard() {
  const selectedTokenSymbol = useTokenViewStore((s) => s.selectedTokenSymbol);
  const supportedPools = usePoolStore((s) => s.supportedPools);

  if (!selectedTokenSymbol) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">No token selected</p>
      </div>
    );
  }

  const tokenPools = getPoolsForToken(supportedPools, selectedTokenSymbol);

  if (tokenPools.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">
          No pools found for {selectedTokenSymbol}
        </p>
      </div>
    );
  }

  return <TokenDashboardContent tokenSymbol={selectedTokenSymbol} pools={tokenPools} />;
}

function TokenDashboardContent({
  tokenSymbol,
  pools,
}: {
  tokenSymbol: string;
  pools: ReturnType<typeof getPoolsForToken>;
}) {
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const currentSpace = spaces.find((s) => s.id === currentSpaceId);
  const isRfqDisabled = isRfqDisabledSpace(currentSpace?.slug);
  const showArbVolume = showsArbVolumeTable(currentSpace?.slug);
  const data = useTokenDashboardData(tokenSymbol, pools, currentSpace?.slug);
  const [panelTab, setPanelTab] = useState<PanelTab>("pools");
  const tabs = useMemo<{ id: PanelTab; label: string }[]>(
    () =>
      isRfqDisabled
        ? [{ id: "pools", label: "Pools" }]
        : [
            { id: "pools", label: "Pools" },
            { id: "rfq", label: "RFQ" },
          ],
    [isRfqDisabled]
  );

  useEffect(() => {
    if (isRfqDisabled && panelTab === "rfq") {
      setPanelTab("pools");
    }
  }, [isRfqDisabled, panelTab]);

  // Resolve original-cased asset symbol (e.g. "TSLAx" not "TSLAX") for RFQ API calls
  const rfqAsset = (() => {
    for (const p of pools) {
      const meta = getSolanaPoolMetadata(p.poolKey);
      if (meta) {
        const { symbol } = getTrackedAsset(meta.token0Symbol, meta.token1Symbol);
        return symbol; // original casing from pool metadata
      }
    }
    return tokenSymbol; // fallback
  })();

  return (
    <div className="dashboard-canvas-wrapper">
      <div className="dashboard-canvas">
        <div className="flex-1 p-4 md:p-6 overflow-auto dashboard-canvas">
          <div id="dashboard-top" className="flex flex-col gap-3">
            {/* Top-level Pools / RFQ tab */}
            <PanelTabNav activeTab={panelTab} onChange={setPanelTab} tabs={tabs} />

            {panelTab === "pools" && (
              <>
                {/* Section 1: Token Header + KPI Strip */}
                <TokenHeader data={data} />

                {/* Section 2: Pool Overview Table */}
                <PoolOverviewTable data={data} spaceSlug={currentSpace?.slug} />

                {/* Section 3: TVL Stacked Area Chart */}
                <TVLStackedAreaChart data={data} />

                {/* Bottom: Arb Volume (Kraken-like) or Slippage Matrix (EVM pool-only spaces) + LP Efficiency */}
                <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
                  {showArbVolume ? (
                    <ArbVolumeTable
                      poolRows={data.pools}
                      trackedTokenSymbol={tokenSymbol}
                      spaceSlug={currentSpace?.slug}
                    />
                  ) : (
                    <SlippageMatrix poolRows={data.pools} trackedTokenSymbol={tokenSymbol} />
                  )}

                  {/* Section 5: LP Efficiency Table */}
                  <LPEfficiencyTable data={data} spaceSlug={currentSpace?.slug} />
                </div>

                {/* Section 6: Market Maker Liquidity Charts (one per named MM) */}
                <MMLiquiditySection data={data} spaceSlug={currentSpace?.slug} />
              </>
            )}

            {panelTab === "rfq" && !isRfqDisabled && (
              <RfqControlPanel asset={rfqAsset} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TokenBirdsEyeDashboard;
