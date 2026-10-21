"use client";

import { useQuery } from "@tanstack/react-query";
import type { CampaignRecipientsResponse } from "@/app/api/merkl-campaign-recipients/route";

interface UseMerklCampaignIncentivesParams {
  chainId: number;
  campaignId: string | null | undefined;
  enabled?: boolean;
  limit?: number;
}

async function fetchCampaignIncentives(
  chainId: number,
  campaignId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<CampaignRecipientsResponse> {
  const url = `/api/merkl-campaign-recipients?chainId=${chainId}&campaignId=${encodeURIComponent(
    campaignId,
  )}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`merkl-campaign-recipients HTTP ${res.status}`);
  }
  return (await res.json()) as CampaignRecipientsResponse;
}

/**
 * Generic Merkl campaign-recipients fetcher (per-position rewards + wrapper
 * detection + past-campaign metadata). Used by all per-org incentive views.
 */
export function useMerklCampaignIncentives({
  chainId,
  campaignId,
  enabled = true,
  limit = 500,
}: UseMerklCampaignIncentivesParams) {
  return useQuery<CampaignRecipientsResponse, Error>({
    queryKey: ["merkl-campaign-incentives", chainId, campaignId ?? null, limit],
    queryFn: ({ signal }) =>
      fetchCampaignIncentives(chainId, campaignId as string, limit, signal),
    enabled: enabled && !!campaignId,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}
