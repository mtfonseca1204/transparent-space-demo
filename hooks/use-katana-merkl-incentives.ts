"use client";

import { useQuery } from "@tanstack/react-query";
import type { CampaignRecipientsResponse } from "@/app/api/merkl-campaign-recipients/route";

// Katana pilot incentive: Sushi V3 vbUSDC-vbETH 0.05% on chain 747474.
// The opportunity has one LIVE Merkl campaign right now; hardcoded here while
// Katana has a single supported pool. When more pools land we can lift this
// into a registry keyed by pool/space.
export const KATANA_INCENTIVE = {
  chainId: 747474,
  campaignId: "0x33ace1dc270bfc3bb13f88d1a858aeea9d04a42959363a8fab516580df4fa05f",
  opportunityId: "3947659107824395816",
  poolName: "Sushi V3 vbUSDC-vbETH 0.05%",
} as const;

async function fetchKatanaIncentive(
  limit: number,
  signal?: AbortSignal,
): Promise<CampaignRecipientsResponse> {
  const url = `/api/merkl-campaign-recipients?chainId=${KATANA_INCENTIVE.chainId}&campaignId=${KATANA_INCENTIVE.campaignId}&limit=${limit}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`merkl-campaign-recipients HTTP ${res.status}`);
  }
  return (await res.json()) as CampaignRecipientsResponse;
}

export function useKatanaMerklIncentives(
  options: { enabled?: boolean; limit?: number } = {},
) {
  const enabled = options.enabled ?? true;
  const limit = options.limit ?? 50;
  return useQuery<CampaignRecipientsResponse, Error>({
    queryKey: ["katana-merkl-incentives", KATANA_INCENTIVE.campaignId, limit],
    queryFn: ({ signal }) => fetchKatanaIncentive(limit, signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}
