"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  SOLANA_POOL_METADATA_BY_ADDRESS,
  SUPPORTED_POOLS,
} from "@/lib/pools";
import { getDemoPoolNetFlow } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

const INDEXER_BASE =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

export type PoolFlowRange = "all" | "30d" | "90d" | "365d";

export interface PoolNetFlowDay {
  day: string;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  swapCount: number;
}

export interface PoolNetFlowSummary {
  poolKey: string;
  label: string;
  asset: string | null;
  swapCount: number;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
}

export interface PoolNetFlowData {
  days: PoolNetFlowDay[];
  pools: PoolNetFlowSummary[];
  totals: { buyUsd: number; sellUsd: number; netUsd: number; swapCount: number };
  meta: {
    spaceSlug?: string | null;
    range?: PoolFlowRange;
    days: number | null;
    source?: "timescale";
    sourceDetail?: "daily" | "raw";
    fallbackReason?: string | null;
    isPartial?: boolean;
    poolCount: number;
    indexedPoolCount?: number;
    skippedPools: { poolKey: string; reason: string }[];
    requestedStartDate?: string | null;
    requestedEndDate?: string | null;
    startDate: string | null;
    endDate: string | null;
  };
}

interface UseKrakenPoolNetFlowParams {
  spaceSlug?: string;
  range?: PoolFlowRange;
  enabled?: boolean;
}

function getPoolKeysForSpace(spaceSlug: string): string[] {
  return SUPPORTED_POOLS.filter(
    (pool) => pool.spaceSlug === spaceSlug && pool.chain === "solana"
  )
    .filter((pool) => SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey]?.token1Symbol === "USDC")
    .map((pool) => pool.poolKey);
}

export async function fetchKrakenPoolNetFlow(
  spaceSlug: string,
  range: PoolFlowRange,
  signal?: AbortSignal
): Promise<PoolNetFlowData> {
  if (isDemoSpaceSlug(spaceSlug)) {
    return getDemoPoolNetFlow(range) as PoolNetFlowData;
  }

  if (!INDEXER_BASE) throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");
  const poolKeys = getPoolKeysForSpace(spaceSlug);
  const url = new URL(`${INDEXER_BASE}/api/xstocks/pool-net-flow`);
  url.searchParams.set("range", range);
  url.searchParams.set("spaceSlug", spaceSlug);
  url.searchParams.set("pools", poolKeys.join(","));
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new Error(`pool-net-flow HTTP ${res.status}`);
  }
  return (await res.json()) as PoolNetFlowData;
}

export function useKrakenPoolNetFlow({
  spaceSlug = "kraken",
  range = "30d",
  enabled = true,
}: UseKrakenPoolNetFlowParams = {}) {
  return useQuery<PoolNetFlowData, Error>({
    queryKey: ["xstocks-pool-net-flow", spaceSlug, range],
    queryFn: ({ signal }) => fetchKrakenPoolNetFlow(spaceSlug, range, signal),
    enabled: enabled && (isDemoSpaceSlug(spaceSlug) || Boolean(INDEXER_BASE)) && getPoolKeysForSpace(spaceSlug).length > 0,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}
