"use client";

import { useQuery } from "@tanstack/react-query";
import type { MonadV2DashboardData } from "@/lib/monad-v2-dashboard";

async function fetchMonadV2Dashboard(): Promise<MonadV2DashboardData> {
  const res = await fetch("/api/monad-v2/dashboard");
  if (!res.ok) throw new Error("Failed to fetch Monad V2 dashboard data");
  return (await res.json()) as MonadV2DashboardData;
}

/**
 * Shares its queryKey with the standalone Monad V2 dashboard page so the cache
 * is reused between the two surfaces — opening the incentives tab after the
 * dashboard hydrates avoids a second network round-trip.
 */
export function useMonadV2Dashboard(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery<MonadV2DashboardData, Error>({
    queryKey: ["monad-v2-dashboard"],
    queryFn: fetchMonadV2Dashboard,
    enabled,
    staleTime: 30_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}
