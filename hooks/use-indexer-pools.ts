import { useQuery } from "@tanstack/react-query";
import {
  fetchWorldchainPoolById,
  fetchWorldchainPools,
  type WorldchainPoolRow,
} from "@/lib/worldchain-indexer-client";

export type IndexerPool = {
  id: string; // poolKey
  poolIdentifier: string; // v3 address or v4 poolId (bytes32)
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  hooks?: string | null;
  createdAt: number;
  updatedAt: number;
  protocol: "v2" | "v3" | "v4";
  chainId: number;
  liquidity?: string;
  sqrtPriceX96?: string;
  tick?: number;
};

const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 480);

export function useIndexerPools(args?: { protocol?: "v2" | "v3" | "v4"; limit?: number; chainId?: number }) {
  const protocol = args?.protocol ?? "v4";
  const limit = args?.limit ?? 50;
  const chainId = args?.chainId ?? DEFAULT_CHAIN_ID;

  return useQuery({
    queryKey: ["indexerPools", chainId, protocol, limit],
    queryFn: async () => {
      const rows = await fetchWorldchainPools({ chainId, protocol, limit });
      return rows as IndexerPool[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useIndexerPoolById(poolKey: string | undefined) {
  const id = poolKey?.toLowerCase();
  return useQuery({
    queryKey: ["indexerPoolById", id],
    queryFn: async () => {
      if (!id) return null;
      const row = await fetchWorldchainPoolById(id);
      return (row as WorldchainPoolRow | null) ?? null;
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
