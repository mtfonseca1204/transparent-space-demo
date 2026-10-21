import { useQuery } from "@tanstack/react-query";
import type { MerklOpportunity } from "@/app/api/merkl-opportunities/route";

async function fetchMerklOpportunity(
  identifier: string,
  chainId = 480,
): Promise<MerklOpportunity> {
  const res = await fetch(
    `/api/merkl-opportunities?identifier=${encodeURIComponent(identifier)}&chainId=${chainId}`,
  );
  if (!res.ok) throw new Error(`merkl-opportunities fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch Merkl opportunity data (TVL, campaigns, daily rewards) for a pool.
 * Only enabled when the pool has an incentive campaign configured.
 */
export function useMerklOpportunity(
  poolIdentifier: string | undefined,
  chainId = 480,
  enabled = true,
) {
  return useQuery({
    queryKey: ["merklOpportunity", chainId, poolIdentifier?.toLowerCase()],
    queryFn: () => fetchMerklOpportunity(poolIdentifier!, chainId),
    enabled: enabled && !!poolIdentifier,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
}
