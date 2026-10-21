"use client";

import { useQuery } from "@tanstack/react-query";
import type { MerklOpportunity } from "@/app/api/merkl-opportunities/route";
import { MONAD_CHAIN_ID, MONAD_DUST_USDC_V2_POOL_KEY } from "@/lib/pools";

async function fetchOpportunity(signal?: AbortSignal): Promise<MerklOpportunity> {
  const url = `/api/merkl-opportunities?chainId=${MONAD_CHAIN_ID}&identifier=${encodeURIComponent(
    MONAD_DUST_USDC_V2_POOL_KEY,
  )}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`merkl-opportunities HTTP ${res.status}`);
  }
  return (await res.json()) as MerklOpportunity;
}

/**
 * Fetches the Monad UniswapV2 DUST-USDC opportunity along with every Merkl
 * campaign indexed on it (live + past). The incentives dashboard uses the
 * campaigns array to resolve the currently live campaign and list previous
 * ones.
 */
export function useMonadMerklOpportunity(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery<MerklOpportunity, Error>({
    queryKey: ["monad-merkl-opportunity", MONAD_DUST_USDC_V2_POOL_KEY],
    queryFn: ({ signal }) => fetchOpportunity(signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}
