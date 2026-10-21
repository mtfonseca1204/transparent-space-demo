import { useMemo } from "react";
import { buildRangeMapFromPositions } from "@/lib/depth-calculator";
import { calculateSlippageFromRangeMap } from "@/hooks/use-historical-slippage";
import type { PoolMetricsRow } from "@/hooks/use-token-dashboard-data";
import { formatFeeTier } from "@/hooks/use-pool-data";

export const SIZE_BUCKETS = [
  { id: "lt1k", label: "<$1K", sizeUsd: 500 },
  { id: "1k-5k", label: "$1K–5K", sizeUsd: 3000 },
  { id: "5k-25k", label: "$5K–25K", sizeUsd: 15000 },
  { id: "25k-100k", label: "$25K–100K", sizeUsd: 50000 },
  { id: "gt100k", label: "$100K+", sizeUsd: 100000 },
] as const;

export type SlippageBucket = { buyPct: number; sellPct: number };

export type PoolSlippageRow = {
  poolKey: string;
  poolLabel: string;
  fee: string;
  buckets: SlippageBucket[];
};

export function useSlippageMatrix(poolRows: PoolMetricsRow[], trackedTokenSymbol: string): {
  data: PoolSlippageRow[];
  isLoading: boolean;
} {
  return useMemo(() => {
    const isLoading = poolRows.some(
      (r) => !r.poolData || r.positions.length === 0
    );

    const data: PoolSlippageRow[] = [];

    for (const row of poolRows) {
      const pd = row.poolData;
      if (!pd) {
        data.push({
          poolKey: row.pool.poolKey,
          poolLabel: row.pool.label,
          fee: "",
          buckets: SIZE_BUCKETS.map(() => ({ buyPct: 0, sellPct: 0 })),
        });
        continue;
      }

      // Build RangeMap from all positions in this pool
      const allPositions = row.positions.flatMap((g) => g.positions);
      const rangeMap = buildRangeMapFromPositions(allPositions);

      // calculateSlippageFromRangeMap returns buy/sell from token0's perspective.
      // When the tracked token is token1 we need to swap buy/sell.
      const trackedUpper = trackedTokenSymbol.toUpperCase();
      const trackedIsToken0 =
        (pd.token0Symbol ?? "").toUpperCase() === trackedUpper;

      const buckets: SlippageBucket[] = SIZE_BUCKETS.map((bucket) => {
        const result = calculateSlippageFromRangeMap(
          bucket.sizeUsd,
          rangeMap,
          pd.tick,
          pd.sqrtPriceX96,
          pd.token0Decimals,
          pd.token1Decimals,
          row.token0Usd,
          row.token1Usd
        );
        return trackedIsToken0
          ? { buyPct: result.buyPct, sellPct: result.sellPct }
          : { buyPct: result.sellPct, sellPct: result.buyPct };
      });

      const feeStr = formatFeeTier(pd.fee ?? 0);

      data.push({
        poolKey: row.pool.poolKey,
        poolLabel: row.pool.label,
        fee: feeStr,
        buckets,
      });
    }

    return { data, isLoading };
  }, [poolRows, trackedTokenSymbol]);
}
