import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  SOLANA_POOL_METADATA_BY_ADDRESS,
  type SolanaPoolMetadata,
} from "@/lib/pools";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoPoolKey } from "@/lib/demo/constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RfqRouteLeg {
  leg_index: number;
  amm_key: string;
  amm_label: string;
  leg_percent: number;
  input_mint: string;
  output_mint: string;
  in_amount_raw: string;
  out_amount_raw: string;
}

export interface RfqQuote {
  quote_id: string;
  capture_id: string;
  pool: string;
  pair_key: string;
  direction: "forward" | "reverse";
  provider: string;
  input_mint: string;
  output_mint: string;
  notional_usd: string;
  requested_swap_mode: string;
  quote_in_amount_raw: string;
  quote_out_amount_raw: string;
  slippage_bps: number;
  platform_fee_amount_raw: string;
  platform_fee_bps: number;
  price_impact_pct: string;
  swap_usd_value: string;
  route_count: number;
  is_success: boolean;
  error_message: string | null;
  quote_at: string;
  route_legs: RfqRouteLeg[];
}

export interface RfqApiResponse {
  data: RfqQuote[];
  pagination: { limit: number; has_more: boolean; next_cursor: string | null };
  meta: { applied_filters: { pools: string[] } };
}

// ─── Derived per-tier data ───────────────────────────────────────────────────

export interface RfqTierRow {
  notionalUsd: number;
  label: string;
  direction: "forward" | "reverse";
  quote: RfqQuote;
  // Derived
  tokensOut: number;
  tokensIn: number;
  priceImpactBps: number;
  feeBps: number;
  totalCostBps: number;
  impliedTokenPrice: number;
  routeCount: number;
  routes: { label: string; percent: number }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RFQ_API_BASE = `${process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL}/api/rfq/latest`;
const RFQ_QUERY_STALE_TIME_MS = 60_000;
const RFQ_QUERY_GC_TIME_MS = 10 * 60 * 1000;
const RFQ_QUERY_RETRY_COUNT = 0;
const RFQ_FETCH_TIMEOUT_MS = 10_000;

interface FetchRfqQuotesOptions {
  includeRoutes: boolean;
  limit?: number;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchRfqQuotes(
  poolKey: string,
  options: FetchRfqQuotesOptions,
  signal?: AbortSignal
): Promise<RfqQuote[]> {
  if (isDemoPoolKey(poolKey)) {
    const json = getDemoRfqApiResponse("jupiter", null, poolKey) as unknown as RfqApiResponse;
    return json.data.filter((q) => q.is_success);
  }

  const { includeRoutes, limit } = options;
  const url = new URL(RFQ_API_BASE);
  url.searchParams.set("pool", poolKey);
  url.searchParams.set("include_routes", includeRoutes ? "true" : "false");
  if (typeof limit === "number") {
    url.searchParams.set("limit", String(limit));
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), RFQ_FETCH_TIMEOUT_MS);
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onAbort);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: timeoutController.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
  if (!res.ok) throw new Error(`RFQ API error: ${res.status}`);
  const json: RfqApiResponse = await res.json();
  return json.data.filter((q) => q.is_success);
}

export function getRfqLatestQueryOptions(poolKey: string) {
  return {
    queryKey: ["rfq", "latest", poolKey] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchRfqQuotes(poolKey, {
        includeRoutes: true,
      }, signal),
    staleTime: RFQ_QUERY_STALE_TIME_MS,
    gcTime: RFQ_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    retry: RFQ_QUERY_RETRY_COUNT,
  };
}

export function getRfqHistoryQueryOptions(poolKey: string) {
  return {
    queryKey: ["rfq", "history", poolKey] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchRfqQuotes(poolKey, {
        includeRoutes: false,
        limit: 1000,
      }, signal),
    staleTime: RFQ_QUERY_STALE_TIME_MS,
    gcTime: RFQ_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    retry: RFQ_QUERY_RETRY_COUNT,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawToNumber(raw: string, decimals: number): number {
  // Use BigInt for precision, then convert to float for display
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

function formatNotional(usd: number): string {
  if (usd >= 1_000_000) return `$${usd / 1_000_000}M`;
  if (usd >= 1_000) return `$${usd / 1_000}K`;
  return `$${usd}`;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseRfqDataResult {
  poolKey: string;
  poolMeta: SolanaPoolMetadata | undefined;
  tiers: RfqTierRow[];
  forwardTiers: RfqTierRow[];
  reverseTiers: RfqTierRow[];
  allQuotes: RfqQuote[];
  isLoading: boolean;
  isError: boolean;
  quoteAt: string | null;
}

export function useRfqData(poolKey: string): UseRfqDataResult {
  const query = useQuery({
    ...getRfqLatestQueryOptions(poolKey),
    enabled: !!poolKey,
  });

  const poolMeta = SOLANA_POOL_METADATA_BY_ADDRESS[poolKey];

  const tiers = useMemo<RfqTierRow[]>(() => {
    if (!query.data || !poolMeta) return [];

    // Deduplicate: keep only the latest quote per (notional_usd, direction)
    const latestByKey = new Map<string, RfqQuote>();
    for (const q of query.data) {
      const key = `${q.notional_usd}_${q.direction}`;
      const existing = latestByKey.get(key);
      if (!existing || q.quote_at > existing.quote_at) {
        latestByKey.set(key, q);
      }
    }

    return Array.from(latestByKey.values())
      .sort(
        (a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd)
      )
      .map((q) => {
        const notionalUsd = parseFloat(q.notional_usd);
        const outDecimals =
          q.direction === "forward"
            ? poolMeta.token0Decimals
            : poolMeta.token1Decimals;
        const inDecimals =
          q.direction === "forward"
            ? poolMeta.token1Decimals
            : poolMeta.token0Decimals;

        const tokensOut = rawToNumber(q.quote_out_amount_raw, outDecimals);
        const tokensIn = rawToNumber(q.quote_in_amount_raw, inDecimals);
        const priceImpactBps = parseFloat(q.price_impact_pct) * 100;
        const feeBps = q.platform_fee_bps;
        const totalCostBps = priceImpactBps + feeBps;
        const swapUsdValue = parseFloat(q.swap_usd_value);
        const impliedTokenPrice =
          tokensOut > 0 ? swapUsdValue / tokensOut : 0;

        // Aggregate route legs (some legs are intermediate hops)
        // Only use first-level legs for the route split display
        const routes = q.route_legs
          .filter((leg) => leg.leg_percent > 0)
          .map((leg) => ({
            label: leg.amm_label,
            percent: leg.leg_percent,
          }));

        return {
          notionalUsd,
          label: formatNotional(notionalUsd),
          direction: q.direction,
          quote: q,
          tokensOut,
          tokensIn,
          priceImpactBps,
          feeBps,
          totalCostBps,
          impliedTokenPrice,
          routeCount: q.route_count,
          routes,
        };
      });
  }, [query.data, poolMeta]);

  const forwardTiers = useMemo(
    () => tiers.filter((t) => t.direction === "forward"),
    [tiers]
  );
  const reverseTiers = useMemo(
    () => tiers.filter((t) => t.direction === "reverse"),
    [tiers]
  );

  const quoteAt = query.data?.[0]?.quote_at ?? null;

  return {
    poolKey,
    poolMeta,
    tiers,
    forwardTiers,
    reverseTiers,
    allQuotes: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    quoteAt,
  };
}
