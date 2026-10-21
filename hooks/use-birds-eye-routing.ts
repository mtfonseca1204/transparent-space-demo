import { useEffect, useMemo, useState } from "react";
import type { BirdsEyePoolCard } from "@/hooks/use-birds-eye-data";
import { ROUTING_ORDER_SIZES_USD } from "@/lib/routing-engine";
import type {
  AssetRouting,
  BirdsEyeRoutingData,
  BirdsEyeRoutingWorkerResponse,
} from "@/lib/birds-eye-routing-model";

export type { AssetRouting, BirdsEyeRoutingData };

export interface UseBirdsEyeRoutingOptions {
  enabled?: boolean;
}

const ROUTING_CACHE_TTL_MS = 2 * 60_000;

type RoutingCacheEntry = {
  timestamp: number;
  data: BirdsEyeRoutingData;
};

const routingCache = new Map<string, RoutingCacheEntry>();
let routingRequestSeq = 0;

const EMPTY_ROUTING_DATA: BirdsEyeRoutingData = {
  isLoading: false,
  byAsset: [],
  sizes: ROUTING_ORDER_SIZES_USD,
};

function createRoutingWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("../workers/birds-eye-routing.worker.ts", import.meta.url), {
    type: "module",
  });
}

function buildRoutingCacheKey(cards: BirdsEyePoolCard[]) {
  return cards
    .map((card) => {
      let positionCount = 0;
      let liquidityTotal = 0n;
      for (const owner of card.positions) {
        positionCount += owner.positions.length;
        try {
          liquidityTotal += BigInt(owner.liquidityTotal ?? "0");
        } catch {
          // Worker uses concrete position liquidity; this only fingerprints
          // the model cheaply enough to avoid rerouting unchanged data.
        }
      }

      return [
        card.pool.poolKey,
        card.trackedAsset,
        card.poolData?.sqrtPriceX96 ?? "",
        card.poolData?.tick ?? "",
        card.poolData?.fee ?? "",
        card.token0Usd ?? "",
        card.token1Usd ?? "",
        card.positions.length,
        positionCount,
        liquidityTotal.toString(),
      ].join(":");
    })
    .join("|");
}

function getCachedRouting(cacheKey: string): BirdsEyeRoutingData | null {
  const cached = routingCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > ROUTING_CACHE_TTL_MS) {
    routingCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function setCachedRouting(cacheKey: string, data: BirdsEyeRoutingData) {
  routingCache.set(cacheKey, { timestamp: Date.now(), data });
  if (routingCache.size > 8) {
    const oldest = routingCache.keys().next().value;
    if (oldest) routingCache.delete(oldest);
  }
}

export function useBirdsEyeRouting(
  cards: BirdsEyePoolCard[],
  options: UseBirdsEyeRoutingOptions = {}
): BirdsEyeRoutingData {
  const enabled = options.enabled ?? true;
  const cacheKey = useMemo(() => buildRoutingCacheKey(cards), [cards]);
  const hasRoutableCards = cards.some(
    (card) => !card.isLoading && Boolean(card.poolData) && card.positions.length > 0
  );
  const [data, setData] = useState<BirdsEyeRoutingData>(() => {
    if (!enabled || !hasRoutableCards) return EMPTY_ROUTING_DATA;
    return getCachedRouting(cacheKey) ?? {
      ...EMPTY_ROUTING_DATA,
      isLoading: true,
    };
  });

  useEffect(() => {
    if (!enabled) {
      setData(EMPTY_ROUTING_DATA);
      return;
    }
    if (!hasRoutableCards) {
      setData({
        ...EMPTY_ROUTING_DATA,
        isLoading: cards.length === 0 || cards.some((card) => card.isLoading),
      });
      return;
    }

    const cached = getCachedRouting(cacheKey);
    if (cached) {
      setData(cached);
      return;
    }

    const worker = createRoutingWorker();
    if (!worker) {
      setData(EMPTY_ROUTING_DATA);
      return;
    }

    let cancelled = false;
    const requestId = ++routingRequestSeq;
    setData({
      ...EMPTY_ROUTING_DATA,
      isLoading: true,
    });

    worker.onmessage = (event: MessageEvent<BirdsEyeRoutingWorkerResponse>) => {
      const response = event.data;
      if (cancelled || response.requestId !== requestId) return;
      worker.terminate();
      if (response.ok) {
        setCachedRouting(cacheKey, response.data);
        setData(response.data);
      } else {
        setData(EMPTY_ROUTING_DATA);
      }
    };
    worker.onerror = () => {
      if (cancelled) return;
      worker.terminate();
      setData(EMPTY_ROUTING_DATA);
    };
    worker.postMessage({ requestId, cards });

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [cacheKey, cards, enabled, hasRoutableCards]);

  return data;
}
