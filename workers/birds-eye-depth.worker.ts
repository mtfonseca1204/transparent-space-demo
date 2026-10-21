import {
  simulateImpactPricesFromRangeMap,
  type RangeMap,
} from "@/lib/depth-calculator";
import type {
  BirdsEyeDepthMetricJob,
  BirdsEyeDepthMetricResult,
  BirdsEyeDepthWorkerRequest,
  BirdsEyeDepthWorkerResponse,
} from "@/lib/birds-eye-depth-worker-types";

function buildRangeMap(job: BirdsEyeDepthMetricJob): RangeMap {
  const rangeMap: RangeMap = new Map();

  for (const owner of job.positionsByOwner) {
    for (const pos of owner.positions) {
      const tickLower = Number(pos.tickLower);
      const tickUpper = Number(pos.tickUpper);
      if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) continue;

      let liquidity: bigint;
      try {
        liquidity = BigInt(pos.liquidity);
      } catch {
        continue;
      }
      if (liquidity <= 0n) continue;

      const key = `${tickLower}:${tickUpper}`;
      rangeMap.set(key, (rangeMap.get(key) ?? 0n) + liquidity);
    }
  }

  return rangeMap;
}

function getTrackedImpacts(args: {
  orderUsd: number;
  currentPrice: number;
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  isTrackedToken0: boolean;
  rangeMap: RangeMap;
}): { buyTrackedPct: number; sellTrackedPct: number } | null {
  const {
    orderUsd,
    currentPrice,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    isTrackedToken0,
    rangeMap,
  } = args;

  if (!Number.isFinite(orderUsd) || orderUsd <= 0) return null;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const { buyPrice, sellPrice } = simulateImpactPricesFromRangeMap({
    rangeMap,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    currentPrice,
    orderUsd,
    token0UsdPrice,
    token1UsdPrice,
  });

  if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) return null;
  if (buyPrice <= 0 || sellPrice <= 0) return null;

  if (isTrackedToken0) {
    return {
      buyTrackedPct: (buyPrice / currentPrice - 1) * 100,
      sellTrackedPct: (sellPrice / currentPrice - 1) * 100,
    };
  }

  return {
    buyTrackedPct: (currentPrice / sellPrice - 1) * 100,
    sellTrackedPct: (currentPrice / buyPrice - 1) * 100,
  };
}

function findOrderUsdForTrackedImpact(args: {
  targetAbsPct: number;
  side: "buyTracked" | "sellTracked";
  currentPrice: number;
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  isTrackedToken0: boolean;
  rangeMap: RangeMap;
}): number | null {
  const {
    targetAbsPct,
    side,
    currentPrice,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    isTrackedToken0,
    rangeMap,
  } = args;

  if (!Number.isFinite(targetAbsPct) || targetAbsPct <= 0) return null;

  const reachesTarget = (impact: {
    buyTrackedPct: number;
    sellTrackedPct: number;
  }) => {
    if (side === "buyTracked") return impact.buyTrackedPct >= targetAbsPct;
    return impact.sellTrackedPct <= -targetAbsPct;
  };

  let low = 0;
  let high = 1_000;

  let impactAtHigh = getTrackedImpacts({
    orderUsd: high,
    currentPrice,
    currentTick,
    sqrtPriceX96,
    token0Decimals,
    token1Decimals,
    token0UsdPrice,
    token1UsdPrice,
    isTrackedToken0,
    rangeMap,
  });

  for (let i = 0; i < 20; i++) {
    if (!impactAtHigh) return null;
    if (reachesTarget(impactAtHigh)) break;
    high *= 2;
    if (high > 1_000_000_000) return null;
    impactAtHigh = getTrackedImpacts({
      orderUsd: high,
      currentPrice,
      currentTick,
      sqrtPriceX96,
      token0Decimals,
      token1Decimals,
      token0UsdPrice,
      token1UsdPrice,
      isTrackedToken0,
      rangeMap,
    });
  }

  if (!impactAtHigh || !reachesTarget(impactAtHigh)) return null;

  for (let i = 0; i < 25; i++) {
    const mid = (low + high) / 2;
    const impactAtMid = getTrackedImpacts({
      orderUsd: mid,
      currentPrice,
      currentTick,
      sqrtPriceX96,
      token0Decimals,
      token1Decimals,
      token0UsdPrice,
      token1UsdPrice,
      isTrackedToken0,
      rangeMap,
    });
    if (!impactAtMid) return null;
    if (reachesTarget(impactAtMid)) high = mid;
    else low = mid;
  }

  return high;
}

function calculateJob(job: BirdsEyeDepthMetricJob): BirdsEyeDepthMetricResult {
  try {
    if (!Number.isFinite(job.currentPrice) || job.currentPrice <= 0) {
      return {
        poolKey: job.poolKey,
        depthBuyAt2PctUsd: null,
        depthSellAt2PctUsd: null,
        effectiveSpreadPct: null,
      };
    }

    const rangeMap = buildRangeMap(job);
    if (rangeMap.size === 0) {
      return {
        poolKey: job.poolKey,
        depthBuyAt2PctUsd: null,
        depthSellAt2PctUsd: null,
        effectiveSpreadPct: null,
      };
    }

    const impactArgs = {
      currentPrice: job.currentPrice,
      currentTick: job.currentTick,
      sqrtPriceX96: job.sqrtPriceX96,
      token0Decimals: job.token0Decimals,
      token1Decimals: job.token1Decimals,
      token0UsdPrice: job.token0UsdPrice,
      token1UsdPrice: job.token1UsdPrice,
      isTrackedToken0: job.isTrackedToken0,
      rangeMap,
    };

    const depthBuyAt2PctUsd = findOrderUsdForTrackedImpact({
      targetAbsPct: 2,
      side: "buyTracked",
      ...impactArgs,
    });
    const depthSellAt2PctUsd = findOrderUsdForTrackedImpact({
      targetAbsPct: 2,
      side: "sellTracked",
      ...impactArgs,
    });

    const feePct = job.fee / 10000;
    let effectiveSpreadPct: number | null = null;
    const impact = getTrackedImpacts({
      orderUsd: 10_000,
      ...impactArgs,
    });
    if (impact) {
      effectiveSpreadPct = feePct * 2 + Math.abs(impact.sellTrackedPct);
    }

    return {
      poolKey: job.poolKey,
      depthBuyAt2PctUsd,
      depthSellAt2PctUsd,
      effectiveSpreadPct,
    };
  } catch (error) {
    return {
      poolKey: job.poolKey,
      depthBuyAt2PctUsd: null,
      depthSellAt2PctUsd: null,
      effectiveSpreadPct: null,
      error: error instanceof Error ? error.message : "Depth calculation failed",
    };
  }
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<BirdsEyeDepthWorkerRequest>) => void) | null;
  postMessage: (message: BirdsEyeDepthWorkerResponse) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (
  event: MessageEvent<BirdsEyeDepthWorkerRequest>
) => {
  const { requestId, jobs } = event.data;
  const response: BirdsEyeDepthWorkerResponse = {
    requestId,
    results: jobs.map(calculateJob),
  };
  workerScope.postMessage(response);
};

export {};
