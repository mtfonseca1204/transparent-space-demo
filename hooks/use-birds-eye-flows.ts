"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  buildDuneNetFlowChartData,
  buildNetFlowChartData,
  type DuneFlowToUsersResponse,
  type NetFlowChartData,
} from "@/lib/xstocks-net-flow";
import type { XstocksMakerVolumeResponse } from "@/lib/xstocks-maker-volume-chart";
import {
  useKrakenPoolNetFlow,
  type PoolFlowRange,
  type PoolNetFlowData,
} from "@/hooks/use-kraken-pool-net-flow";
import {
  useFlowdeskRfqFlow,
  type FlowdeskRfqFlowData,
} from "@/hooks/use-flowdesk-rfq-flow";
import { getDemoMakerVolume } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

const INDEXER_BASE =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

interface UseBirdsEyeFlowsParams {
  spaceSlug?: string;
  range?: PoolFlowRange;
  enabled?: boolean;
}

async function fetchMakerVolume(
  range: PoolFlowRange,
  signal?: AbortSignal,
  spaceSlug?: string | null
): Promise<XstocksMakerVolumeResponse> {
  if (isDemoSpaceSlug(spaceSlug)) {
    return getDemoMakerVolume(range);
  }

  if (!INDEXER_BASE) throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");
  const url = new URL(`${INDEXER_BASE}/api/xstocks/maker-volume`);
  url.searchParams.set("range", range);
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`xstocks maker volume HTTP ${res.status}`);
  return (await res.json()) as XstocksMakerVolumeResponse;
}

async function fetchFlowToUsers(
  range: PoolFlowRange,
  signal?: AbortSignal
): Promise<DuneFlowToUsersResponse> {
  if (!INDEXER_BASE) throw new Error("Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL");
  const url = new URL(`${INDEXER_BASE}/api/xstocks/flow-to-users`);
  url.searchParams.set("range", range);
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`xstocks flow-to-users HTTP ${res.status}`);
  return (await res.json()) as DuneFlowToUsersResponse;
}

export interface BirdsEyeFlowsResult {
  data: NetFlowChartData | null;
  /** True only when no data has ever loaded for this query yet. */
  isLoading: boolean;
  /** True while a fetch is in flight (including a window-switch refetch). */
  isFetching: boolean;
  /** True when pool aggregation is still in flight but RFQ has already populated `data`. */
  isPoolPending: boolean;
  isError: boolean;
  isConfigured: boolean;
  rfqError: Error | null;
  poolError: Error | null;
  flowdeskError: Error | null;
  flowToUsersError: Error | null;
  poolMeta: PoolNetFlowData["meta"] | null;
  flowdeskMeta: FlowdeskRfqFlowData["meta"] | null;
  flowToUsersMeta: DuneFlowToUsersResponse["meta"] | null;
  isPoolPartial: boolean;
}

export function useBirdsEyeFlows({
  spaceSlug = "kraken",
  range = "30d",
  enabled = true,
}: UseBirdsEyeFlowsParams = {}): BirdsEyeFlowsResult {
  const isDemo = isDemoSpaceSlug(spaceSlug);
  const isConfigured = isDemo || Boolean(INDEXER_BASE);

  const flowToUsersQuery = useQuery<DuneFlowToUsersResponse, Error>({
    queryKey: ["xstocks-flow-to-users", range, spaceSlug],
    queryFn: ({ signal }) => fetchFlowToUsers(range, signal),
    enabled: isConfigured && enabled && !isDemo,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const rfqQuery = useQuery<XstocksMakerVolumeResponse, Error>({
    queryKey: ["xstocks-maker-volume-flows", range, spaceSlug],
    queryFn: ({ signal }) => fetchMakerVolume(range, signal, spaceSlug),
    enabled: isConfigured && enabled && isDemo,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const poolQuery = useKrakenPoolNetFlow({ spaceSlug, range, enabled: enabled && isDemo });
  const flowdeskQuery = useFlowdeskRfqFlow({ range, enabled: enabled && isDemo, spaceSlug });

  const data = useMemo<NetFlowChartData | null>(() => {
    if (!enabled) return null;
    if (!isDemo) {
      return buildDuneNetFlowChartData(flowToUsersQuery.data ?? null);
    }
    const rfqRows = rfqQuery.data?.data ?? null;
    const pool: PoolNetFlowData | null = poolQuery.data ?? null;
    const flowdesk: FlowdeskRfqFlowData | null = flowdeskQuery.data ?? null;
    // Render as soon as any source is ready. The pool side aggregates
    // millions of swap rows server-side and can take a minute on a cold
    // cache, so we'd rather show RFQ-only flow first and merge pool data
    // when it arrives.
    if (!rfqRows && !pool && !flowdesk) return null;
    const startDate = pool?.meta?.startDate ?? null;
    const endDate = pool?.meta?.endDate ?? null;
    return buildNetFlowChartData({
      rfqRows,
      poolDays: pool?.days ?? null,
      poolSwapCount: pool?.totals.swapCount ?? 0,
      flowdeskRfqDays: flowdesk?.days ?? null,
      startDate,
      endDate,
    });
  }, [enabled, isDemo, flowToUsersQuery.data, rfqQuery.data, poolQuery.data, flowdeskQuery.data]);

  return {
    data,
    isLoading:
      (flowToUsersQuery.isLoading || rfqQuery.isLoading || poolQuery.isLoading || flowdeskQuery.isLoading) && !data,
    isFetching:
      flowToUsersQuery.isFetching || rfqQuery.isFetching || poolQuery.isFetching || flowdeskQuery.isFetching,
    isPoolPending: isDemo && poolQuery.isFetching && !poolQuery.data,
    isError: isDemo
      ? rfqQuery.isError && poolQuery.isError && flowdeskQuery.isError
      : flowToUsersQuery.isError,
    isConfigured,
    rfqError: rfqQuery.error ?? null,
    poolError: poolQuery.error ?? null,
    flowdeskError: flowdeskQuery.error ?? null,
    flowToUsersError: flowToUsersQuery.error ?? null,
    poolMeta: poolQuery.data?.meta ?? null,
    flowdeskMeta: flowdeskQuery.data?.meta ?? null,
    flowToUsersMeta: flowToUsersQuery.data?.meta ?? null,
    isPoolPartial: Boolean(poolQuery.data?.meta?.isPartial),
  };
}
