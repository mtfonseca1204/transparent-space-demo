"use client";

import { useQuery } from "@tanstack/react-query";

import {
  buildQuoteActivityAssetSummaries,
  type QuoteActivityApiResponse,
  type QuoteActivityAssetSummary,
} from "@/lib/rfq-quote-activity";
import { getDemoQuoteActivity } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

const INDEXER_BASE =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

const STALE_TIME_MS = 60_000;
const GC_TIME_MS = 10 * 60_000;

export async function fetchRfqQuoteActivity(
  days: number,
  spaceSlug?: string | null,
  signal?: AbortSignal,
): Promise<QuoteActivityApiResponse> {
  if (isDemoSpaceSlug(spaceSlug)) {
    return getDemoQuoteActivity(days);
  }

  if (!INDEXER_BASE) {
    throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");
  }

  const url = new URL(`${INDEXER_BASE}/api/rfq/quote-activity`);
  url.searchParams.set("days", String(days));

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`quote-activity HTTP ${response.status}`);
  }
  return (await response.json()) as QuoteActivityApiResponse;
}

export function useRfqQuoteActivity({
  days = 7,
  enabled = true,
  spaceSlug,
}: {
  days?: number;
  enabled?: boolean;
  spaceSlug?: string | null;
} = {}) {
  const isDemo = isDemoSpaceSlug(spaceSlug);
  const query = useQuery<
    QuoteActivityApiResponse,
    Error,
    { rows: QuoteActivityAssetSummary[]; meta: QuoteActivityApiResponse["meta"] }
  >({
    queryKey: ["rfq-quote-activity", spaceSlug ?? "default", days],
    queryFn: ({ signal }) => fetchRfqQuoteActivity(days, spaceSlug, signal),
    enabled: (isDemo || Boolean(INDEXER_BASE)) && enabled,
    select: (payload) => ({
      rows: buildQuoteActivityAssetSummaries(payload.data),
      meta: payload.meta,
    }),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    ...query,
    isConfigured: Boolean(INDEXER_BASE),
  };
}
