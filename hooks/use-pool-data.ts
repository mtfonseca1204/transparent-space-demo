import { useQuery } from "@tanstack/react-query";
import type { PoolData } from "@/app/api/pool/[address]/route";

async function fetchPoolData(poolAddress: string): Promise<PoolData> {
  const response = await fetch(`/api/pool/${poolAddress}`);

  if (!response.ok) {
    throw new Error("Failed to fetch pool data");
  }

  return response.json();
}

export function usePoolData(poolAddress: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["pool", poolAddress],
    queryFn: () => fetchPoolData(poolAddress),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000, // 30 seconds
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchInterval: 30_000, // Refetch every 30 seconds
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnMount: false, // Don't refetch if data is fresh
    retry: 2,
  });
}

// Helper to format large numbers
export function formatBalance(balance: string, decimals: number = 2): string {
  const num = parseFloat(balance);

  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(decimals)} B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(decimals)} M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(decimals)} K`;
  }

  return num.toFixed(decimals);
}

// Helper to format fee tier
export function formatFeeTier(fee: number): string {
  return `${(fee / 10000).toFixed(2)}%`;
}



