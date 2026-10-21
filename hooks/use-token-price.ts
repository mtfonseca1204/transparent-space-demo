import { useQuery } from "@tanstack/react-query";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

export type AllTokenPricesResponse = {
  updatedAt: number;
  chain: string;
  tokenCount: number;
  pricesUsdByAddress: Record<string, number | null>;
  metaByCoinKey: Record<
    string,
    { decimals?: number; symbol?: string; price?: number; timestamp?: number; confidence?: number }
  >;
};

async function fetchAllTokenPrices(spaceSlug?: string | null): Promise<AllTokenPricesResponse> {
  // Prefer CoinGecko for USD pricing.
  const params = new URLSearchParams({ source: "coingecko" });
  if (isDemoSpaceSlug(spaceSlug)) params.set("space", "demo");
  const res = await fetch(`/api/token-prices?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch token prices");
  return res.json();
}

/**
 * Fetches *all* token prices (token0/token1 across v3+v4 pools) in a single backend call.
 * Backend is responsible for batching + caching the upstream DefiLlama request.
 */
export function useAllTokenPrices(options: { enabled?: boolean; spaceSlug?: string | null } = {}) {
  const enabled = options.enabled ?? true;
  const currentSpaceSlug = useCurrentSpaceSlug();
  const spaceSlug = options.spaceSlug ?? currentSpaceSlug;

  return useQuery({
    queryKey: ["allTokenPrices", spaceSlug ?? null],
    queryFn: () => fetchAllTokenPrices(spaceSlug),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
    refetchInterval: 5 * 60 * 1000, // poll every 5 minutes (CoinGecko free tier: ~10 req/min)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // Keep previous data while refetching
    placeholderData: (previousData) => previousData,
  });
}

export function useTokenPrice(tokenAddress: string | undefined) {
  const all = useAllTokenPrices();
  const addr = tokenAddress?.toLowerCase();
  return { ...all, data: addr ? all.data?.pricesUsdByAddress?.[addr] ?? null : null };
}

export function useTokenPrices(tokenAddresses: Array<string | undefined>) {
  const all = useAllTokenPrices();
  const addrs = tokenAddresses.filter(Boolean).map((a) => a!.toLowerCase());
  const out: Record<string, number | null> = {};
  for (const a of addrs) out[a] = all.data?.pricesUsdByAddress?.[a] ?? null;
  return { ...all, data: out };
}
