"use client";

import { useQuery } from "@tanstack/react-query";
import {
  buildXstocksMakerVolumeChart,
  type MakerVolumeChartData,
  type XstocksMakerVolumeResponse,
} from "@/lib/xstocks-maker-volume-chart";
import { getDemoMakerVolume } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

const INDEXER_BASE =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";
const STALE_TIME_MS = 5 * 60_000;
const GC_TIME_MS = 15 * 60_000;

interface UseXstocksMakerVolumeParams {
  days?: number;
  enabled?: boolean;
  spaceSlug?: string | null;
}

export async function fetchXstocksMakerVolume(
  days: number,
  signal?: AbortSignal,
  spaceSlug?: string | null
): Promise<XstocksMakerVolumeResponse> {
  if (isDemoSpaceSlug(spaceSlug)) {
    return getDemoMakerVolume(days);
  }

  if (!INDEXER_BASE) {
    throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");
  }

  const url = new URL(`${INDEXER_BASE}/api/xstocks/maker-volume`);
  url.searchParams.set("days", String(days));

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new Error(`xstocks maker volume HTTP ${res.status}`);
  }
  return (await res.json()) as XstocksMakerVolumeResponse;
}

export function useXstocksMakerVolume({
  days = 7,
  enabled = true,
  spaceSlug,
}: UseXstocksMakerVolumeParams = {}) {
  const currentSpaceSlug = useCurrentSpaceSlug();
  const activeSpaceSlug = spaceSlug ?? currentSpaceSlug;
  const isConfigured = isDemoSpaceSlug(activeSpaceSlug) || Boolean(INDEXER_BASE);
  const query = useQuery<XstocksMakerVolumeResponse, Error, MakerVolumeChartData>({
    queryKey: ["xstocks-maker-volume", days, activeSpaceSlug],
    queryFn: ({ signal }) => fetchXstocksMakerVolume(days, signal, activeSpaceSlug),
    enabled: isConfigured && enabled,
    select: buildXstocksMakerVolumeChart,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    ...query,
    isConfigured,
  };
}
