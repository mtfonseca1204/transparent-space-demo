"use client";

import { useQuery } from "@tanstack/react-query";
import type { MerklOpportunity } from "@/app/api/merkl-opportunities/route";
import { KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY, KATANA_CHAIN_ID } from "@/lib/pools";

async function fetchOpportunity(signal?: AbortSignal): Promise<MerklOpportunity> {
  const url = `/api/merkl-opportunities?chainId=${KATANA_CHAIN_ID}&identifier=${encodeURIComponent(
    KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY,
  )}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`merkl-opportunities HTTP ${res.status}`);
  }
  return (await res.json()) as MerklOpportunity;
}

/**
 * Fetches the Katana Sushi V3 vbUSDC-vbETH opportunity along with every
 * campaign Merkl has indexed on it (live + past). Used by the campaign LIVE
 * dashboard to render campaign delimitations on the TVL chart and a list of
 * previous campaigns.
 */
export function useKatanaMerklOpportunity(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery<MerklOpportunity, Error>({
    queryKey: ["katana-merkl-opportunity", KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY],
    queryFn: ({ signal }) => fetchOpportunity(signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}
