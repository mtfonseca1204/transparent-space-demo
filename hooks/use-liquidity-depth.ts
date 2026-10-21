"use client";

import { useQuery } from "@tanstack/react-query";
import { normalizePoolKey } from "@/lib/pools";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import {
  normalizeLiquidityDepthPayload,
  supportsHistoricalLiquidityDepth,
  type LiquidityDepthPayload,
} from "@/lib/liquidity-depth";

interface UseLiquidityDepthOptions {
  poolAddress: string;
  spaceSlug?: string | null;
  enabled?: boolean;
  windowDays?: number;
  resolution?: "1h" | "4h" | "1d";
  priceBins?: number;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

export function useLiquidityDepth({
  poolAddress,
  spaceSlug = null,
  enabled = true,
  windowDays = 7,
  resolution = "1h",
  priceBins = 96,
}: UseLiquidityDepthOptions) {
  const poolAddressNorm = normalizePoolKey(poolAddress);
  const supported = !isDemoSpaceSlug(spaceSlug) && supportsHistoricalLiquidityDepth(poolAddressNorm);
  const boundedWindowDays = clampInt(windowDays, 1, 30, 7);
  const boundedPriceBins = clampInt(priceBins, 24, 180, 96);

  return useQuery<LiquidityDepthPayload | null, Error>({
    queryKey: [
      "liquidityDepth",
      poolAddressNorm,
      spaceSlug ?? "",
      boundedWindowDays,
      resolution,
      boundedPriceBins,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolAddressNorm,
        ...(spaceSlug ? { space: spaceSlug } : {}),
        window_days: String(boundedWindowDays),
        resolution,
        price_bins: String(boundedPriceBins),
      });
      const res = await fetch(`/api/liquidity-depth?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`liquidity-depth fetch failed: ${res.status}`);
      }
      return normalizeLiquidityDepthPayload(await res.json());
    },
    enabled: enabled && supported,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}
