import { useQuery } from "@tanstack/react-query";
import type { TokenMeta } from "@/app/api/token/[address]/route";

async function fetchTokenMeta(address: string): Promise<TokenMeta> {
  const res = await fetch(`/api/token/${address}`);
  if (!res.ok) throw new Error("Failed to fetch token metadata");
  return res.json();
}

export function useTokenMeta(address: string | undefined) {
  return useQuery({
    queryKey: ["tokenMeta", address?.toLowerCase()],
    queryFn: () => {
      if (!address) throw new Error("Missing token address");
      return fetchTokenMeta(address);
    },
    enabled: !!address,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });
}


