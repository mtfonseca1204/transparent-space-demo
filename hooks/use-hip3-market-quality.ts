"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  HIP3_DEFAULT_BAND_BPS,
  HIP3_DEFAULT_DAYS,
  HIP3_DEFAULT_MARKET_KEY,
  HIP3_DEFAULT_MIN_DEPTH_USD,
  HIP3_INDEXER_BASE,
  type Hip3MarketQualityResponse,
  type Hip3MarketsResponse,
} from "@/lib/hip3-market-quality";

async function fetchHip3Markets(signal?: AbortSignal): Promise<Hip3MarketsResponse> {
  if (!HIP3_INDEXER_BASE) throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");

  const response = await fetch(`${HIP3_INDEXER_BASE}/api/hip3/markets`, { signal });
  if (!response.ok) throw new Error(`hip3 markets HTTP ${response.status}`);
  return (await response.json()) as Hip3MarketsResponse;
}

async function fetchHip3MarketQuality({
  market,
  days,
  bandBps,
  minDepthUsd,
  signal,
}: {
  market: string;
  days: number;
  bandBps: number;
  minDepthUsd: number;
  signal?: AbortSignal;
}): Promise<Hip3MarketQualityResponse> {
  if (!HIP3_INDEXER_BASE) throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");

  const url = new URL(`${HIP3_INDEXER_BASE}/api/hip3/market-quality`);
  url.searchParams.set("market", market);
  url.searchParams.set("days", String(days));
  url.searchParams.set("band_bps", String(bandBps));
  url.searchParams.set("min_depth_usd", String(minDepthUsd));

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) throw new Error(`hip3 market quality HTTP ${response.status}`);
  return (await response.json()) as Hip3MarketQualityResponse;
}

export function useHip3Markets({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<Hip3MarketsResponse, Error>({
    queryKey: ["hip3", "markets"],
    queryFn: ({ signal }) => fetchHip3Markets(signal),
    enabled: Boolean(HIP3_INDEXER_BASE) && enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function useHip3MarketQuality({
  market = HIP3_DEFAULT_MARKET_KEY,
  days = HIP3_DEFAULT_DAYS,
  bandBps = HIP3_DEFAULT_BAND_BPS,
  minDepthUsd = HIP3_DEFAULT_MIN_DEPTH_USD,
  enabled = true,
}: {
  market?: string;
  days?: number;
  bandBps?: number;
  minDepthUsd?: number;
  enabled?: boolean;
} = {}) {
  return useQuery<Hip3MarketQualityResponse, Error>({
    queryKey: ["hip3", "market-quality", market, days, bandBps, minDepthUsd],
    queryFn: ({ signal }) =>
      fetchHip3MarketQuality({ market, days, bandBps, minDepthUsd, signal }),
    enabled: Boolean(HIP3_INDEXER_BASE) && enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}
