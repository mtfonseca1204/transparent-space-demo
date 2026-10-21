"use client";

import React, { useState } from "react";
import { useRfqData } from "@/hooks/use-rfq-data";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import { RfqHeader } from "./rfq-header";
import { RfqSummaryCards } from "./rfq-summary-cards";
import { RfqTabNav, type RfqTab } from "./rfq-tab-nav";
import { RfqPriceImpactChart } from "./rfq-price-impact-chart";
import { RfqTotalCostChart } from "./rfq-total-cost-chart";
import { RfqRouteSplitChart } from "./rfq-route-split-chart";
import { RfqDepthCurveChart } from "./rfq-depth-curve-chart";
import { RfqOrderbookDepthChart } from "./rfq-orderbook-depth-chart";
import { RfqHistoricalChart } from "./rfq-historical-chart";
import { RfqDataTable } from "./rfq-data-table";
import {
  MetricCardSkeleton,
  ChartCardSkeleton,
} from "@/components/dashboard";

/**
 * Inline version of RfqDepthDashboard — renders RFQ content without the
 * outer padding/scroll wrapper so it can be embedded inside another dashboard
 * (e.g. the Pools / RFQ tab in TokenBirdsEyeDashboard).
 */
interface RfqDepthDashboardInlineProps {
  poolKey: string;
}

export function RfqDepthDashboardInline({ poolKey }: RfqDepthDashboardInlineProps) {
  const rfqData = useRfqData(poolKey);
  const [activeTab, setActiveTab] = useState<RfqTab>("depth");

  const poolMeta = SOLANA_POOL_METADATA_BY_ADDRESS[poolKey];

  if (!poolMeta) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-4">
        <h2 className="text-lg font-semibold text-[var(--bp-text-primary)] mb-2">
          Unknown Pool
        </h2>
        <p className="text-sm text-[var(--bp-text-muted)]">
          No metadata found for pool {poolKey.slice(0, 8)}...
        </p>
      </div>
    );
  }

  if (rfqData.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <RfqHeader poolMeta={poolMeta} quoteAt={null} />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </div>
        <ChartCardSkeleton />
      </div>
    );
  }

  if (rfqData.isError) {
    return (
      <div className="flex flex-col gap-3">
        <RfqHeader poolMeta={poolMeta} quoteAt={null} />
        <div className="bp-card p-6 text-center">
          <p className="text-sm text-red-500">
            Failed to load RFQ data. Please try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <RfqHeader poolMeta={poolMeta} quoteAt={rfqData.quoteAt} />

      <RfqSummaryCards
        forwardTiers={rfqData.forwardTiers}
        reverseTiers={rfqData.reverseTiers}
      />

      <RfqTabNav activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "price-impact" && (
        <RfqPriceImpactChart
          forwardTiers={rfqData.forwardTiers}
          reverseTiers={rfqData.reverseTiers}
        />
      )}
      {activeTab === "total-cost" && (
        <RfqTotalCostChart
          forwardTiers={rfqData.forwardTiers}
          reverseTiers={rfqData.reverseTiers}
        />
      )}
      {activeTab === "route-split" && (
        <RfqRouteSplitChart
          forwardTiers={rfqData.forwardTiers}
          reverseTiers={rfqData.reverseTiers}
          poolMeta={poolMeta}
        />
      )}
      {activeTab === "depth-curve" && (
        <RfqDepthCurveChart
          forwardTiers={rfqData.forwardTiers}
          reverseTiers={rfqData.reverseTiers}
        />
      )}
      {activeTab === "depth" && (
        <RfqOrderbookDepthChart
          forwardTiers={rfqData.forwardTiers}
          reverseTiers={rfqData.reverseTiers}
        />
      )}
      {activeTab === "historical" && (
        <RfqHistoricalChart poolKey={poolKey} />
      )}

      <RfqDataTable tiers={rfqData.tiers} poolMeta={poolMeta} />
    </>
  );
}
