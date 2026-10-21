import { useQuery } from "@tanstack/react-query";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";
import { ZEROG_SPACE_SLUG } from "@/lib/space-policy";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

export interface ArbVolumePool {
  poolAddress: string;
  poolKey: string;
  venue: string;
  feeBps: number | null;
  totalSwaps: number;
  arbSwaps: number;
  totalVolumeUsd: number;
  arbVolumeUsd: number;
  organicVolumeUsd: number;
  arbPct: number;
}

export interface ArbVolumeAsset {
  asset: string;
  hlCoin: string;
  hlCandleCount: number;
  pools: ArbVolumePool[];
  totalVolumeUsd: number;
  arbVolumeUsd: number;
  organicVolumeUsd: number;
  arbPct: number;
}

interface ArbVolumeResponse {
  meta: {
    days: number;
    startTime: string;
    endTime: string;
    assetFilter: string | null;
    poolFilter: string | null;
    totalAssets: number;
    totalPools: number;
  };
  summary: {
    totalVolumeUsd: number;
    arbVolumeUsd: number;
    organicVolumeUsd: number;
    arbPct: number;
  };
  assets: ArbVolumeAsset[];
}

async function fetchArbVolume(
  asset: string,
  spaceSlug?: string | null
): Promise<ArbVolumeAsset | null> {
  const params = new URLSearchParams({
    days: "7",
    asset,
  });
  if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);
  else if (spaceSlug === ZEROG_SPACE_SLUG) params.set("space", ZEROG_SPACE_SLUG);
  const res = await fetch(`/api/arb-volume?${params.toString()}`);
  if (!res.ok) return null;
  const data: ArbVolumeResponse = await res.json();
  return data.assets[0] ?? null;
}

/**
 * Fetches 7-day arb volume classification for a given token symbol (e.g. "TSLAx").
 */
export function useArbVolume(tokenSymbol: string, spaceSlug?: string | null) {
  const currentSpaceSlug = useCurrentSpaceSlug();
  const activeSpaceSlug = spaceSlug ?? currentSpaceSlug;
  return useQuery({
    queryKey: ["arbVolume7d", tokenSymbol, activeSpaceSlug],
    queryFn: () => fetchArbVolume(tokenSymbol, activeSpaceSlug),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
