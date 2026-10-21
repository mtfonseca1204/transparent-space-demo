"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PoolFlowRange } from "@/hooks/use-kraken-pool-net-flow";
import { getDemoFlowdeskRfqFlow } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

export interface FlowdeskRfqFlowDay {
  day: string;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  txCount: number;
}

export interface FlowdeskRfqFlowData {
  days: FlowdeskRfqFlowDay[];
  totals: { buyUsd: number; sellUsd: number; netUsd: number; txCount: number };
  meta: {
    address: string;
    range: string;
    fromBlock: string;
    toBlock: string;
    rfqTxsScanned: number;
    transfersScanned: number;
    xstockTokensSeen: { address: string; symbol: string }[];
    note: string;
  };
}

interface UseFlowdeskRfqFlowParams {
  range?: PoolFlowRange;
  enabled?: boolean;
  spaceSlug?: string | null;
}

export async function fetchFlowdeskRfqFlow(
  range: PoolFlowRange,
  signal?: AbortSignal,
  spaceSlug?: string | null
): Promise<FlowdeskRfqFlowData> {
  if (isDemoSpaceSlug(spaceSlug)) {
    return getDemoFlowdeskRfqFlow(range) as FlowdeskRfqFlowData;
  }

  const url = new URL("/api/xstocks/flowdesk-rfq-flow", window.location.origin);
  url.searchParams.set("range", range);
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`flowdesk-rfq-flow HTTP ${res.status}`);
  return (await res.json()) as FlowdeskRfqFlowData;
}

export function useFlowdeskRfqFlow({
  range = "30d",
  enabled = true,
  spaceSlug,
}: UseFlowdeskRfqFlowParams = {}) {
  return useQuery<FlowdeskRfqFlowData, Error>({
    queryKey: ["flowdesk-rfq-flow", range, spaceSlug ?? null],
    queryFn: ({ signal }) => fetchFlowdeskRfqFlow(range, signal, spaceSlug),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}
