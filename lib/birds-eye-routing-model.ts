import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import {
  ROUTING_ORDER_SIZES_USD,
  prepareRoutingPools,
  routePreparedOrderAcrossPools,
  type RoutingOrderSize,
  type RoutingPoolInput,
  type RoutingResult,
} from "@/lib/routing-engine";

export interface AssetRouting {
  asset: string;
  poolCount: number;
  bySize: Map<RoutingOrderSize, { buy: RoutingResult; sell: RoutingResult }>;
}

export interface BirdsEyeRoutingData {
  isLoading: boolean;
  byAsset: AssetRouting[];
  sizes: readonly RoutingOrderSize[];
}

export type BirdsEyeRoutingWorkerRequest = {
  requestId: number;
  cards: BirdsEyePoolCard[];
};

export type BirdsEyeRoutingWorkerResponse =
  | {
      requestId: number;
      ok: true;
      data: BirdsEyeRoutingData;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };

function cardToRoutingPool(card: BirdsEyePoolCard): RoutingPoolInput | null {
  if (!card.poolData) return null;
  if (card.token0Usd === null || card.token1Usd === null) return null;
  if (!card.poolData.sqrtPriceX96) return null;
  if (!card.positions.length) return null;

  return {
    poolKey: card.pool.poolKey,
    key: card.pool.key,
    label: card.pool.label,
    venue: card.pool.protocol,
    feeTier: card.feeTier,
    feeRaw: card.poolData.fee ?? 0,
    positions: card.positions.flatMap((entry) => entry.positions),
    sqrtPriceX96: card.poolData.sqrtPriceX96,
    currentTick: card.poolData.tick,
    currentPrice: card.poolData.currentPrice,
    token0Decimals: card.poolData.token0Decimals,
    token1Decimals: card.poolData.token1Decimals,
    token0UsdPrice: card.token0Usd,
    token1UsdPrice: card.token1Usd,
    isTrackedToken0: card.isTrackedToken0,
  };
}

export function buildBirdsEyeRoutingData(cards: BirdsEyePoolCard[]): BirdsEyeRoutingData {
  const isLoading = cards.length === 0 || cards.some((c) => c.isLoading);

  const byAssetPools = new Map<string, RoutingPoolInput[]>();
  for (const card of cards) {
    const input = cardToRoutingPool(card);
    if (!input) continue;
    const arr = byAssetPools.get(card.trackedAsset) ?? [];
    arr.push(input);
    byAssetPools.set(card.trackedAsset, arr);
  }

  const byAsset: AssetRouting[] = [];
  for (const [asset, pools] of byAssetPools) {
    if (pools.length === 0) continue;
    const preparedPools = prepareRoutingPools(pools);
    const bySize = new Map<
      RoutingOrderSize,
      { buy: RoutingResult; sell: RoutingResult }
    >();
    for (const size of ROUTING_ORDER_SIZES_USD) {
      const buy = routePreparedOrderAcrossPools({
        preparedPools,
        side: "buyTracked",
        orderUsd: size,
      });
      const sell = routePreparedOrderAcrossPools({
        preparedPools,
        side: "sellTracked",
        orderUsd: size,
      });
      bySize.set(size, { buy, sell });
    }
    byAsset.push({ asset, poolCount: pools.length, bySize });
  }

  byAsset.sort((a, b) => {
    const aMax = Math.max(...Array.from(a.bySize.values()).map((r) => r.buy.totalInputUsd + r.sell.totalInputUsd));
    const bMax = Math.max(...Array.from(b.bySize.values()).map((r) => r.buy.totalInputUsd + r.sell.totalInputUsd));
    return bMax - aMax;
  });

  return {
    isLoading,
    byAsset,
    sizes: ROUTING_ORDER_SIZES_USD,
  };
}
