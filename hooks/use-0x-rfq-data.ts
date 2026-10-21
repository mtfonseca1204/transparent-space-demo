import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ZeroXFill {
  from: string;
  to: string;
  source: string;
  proportionBps: string;
}

export interface ZeroXRfqQuote {
  quote_id: string;
  capture_id: string;
  asset: string;
  pool: string | null;
  direction: "forward" | "reverse";
  provider: string;
  notional_usd: string;
  sell_token: string;
  buy_token: string;
  requested_sell_amount_raw: string;
  quote_buy_amount_raw: string;
  sell_amount_raw: string;
  buy_amount_raw: string;
  min_buy_amount_raw: string;
  total_network_fee_raw: string | null;
  gas_estimate: string | null;
  liquidity_available: boolean;
  fill_count: number;
  fills: ZeroXFill[];
  is_success: boolean;
  error_code: string | null;
  error_message: string | null;
  quote_at: string;
}

export interface ZeroXTierRow {
  notionalUsd: number;
  label: string;
  direction: "forward" | "reverse";
  quote: ZeroXRfqQuote;
  impliedTokenPrice: number;
  priceImpactBps: number;
  gasCost: number;
  totalNetworkFee: number;
  liquidityAvailable: boolean;
  fillCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ZEROX_RFQ_API_BASE = `${process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL}/api/rfq/0x/latest`;

// Token decimals for 0x quotes — Ethereum ERC-20 amounts.
const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;

// USDC on Ethereum mainnet (lowercased for comparison)
const USDC_ETH_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawToNumber(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
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

function getQuoteDecimals(q: ZeroXRfqQuote): { sellDecimals: number; buyDecimals: number } {
  const sellIsUsdc = q.sell_token?.toLowerCase() === USDC_ETH_ADDRESS;
  const buyIsUsdc = q.buy_token?.toLowerCase() === USDC_ETH_ADDRESS;
  return {
    sellDecimals: sellIsUsdc ? USDC_DECIMALS : TOKEN_DECIMALS,
    buyDecimals: buyIsUsdc ? USDC_DECIMALS : TOKEN_DECIMALS,
  };
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchZeroXRfqQuotes(
  asset: string,
  spaceSlug?: string | null
): Promise<ZeroXRfqQuote[]> {
  if (isDemoSpaceSlug(spaceSlug)) {
    const json = getDemoRfqApiResponse("0x", asset) as { data: ZeroXRfqQuote[] };
    return json.data.filter((q) => q.is_success);
  }

  const url = new URL(ZEROX_RFQ_API_BASE);
  url.searchParams.set("asset", asset);
  url.searchParams.set("limit", "500");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`0x RFQ API error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "0x API error");
  if (!json.data) return [];
  return (json.data as ZeroXRfqQuote[]).filter((q) => q.is_success);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseZeroXRfqDataResult {
  asset: string;
  tiers: ZeroXTierRow[];
  forwardTiers: ZeroXTierRow[];
  reverseTiers: ZeroXTierRow[];
  allQuotes: ZeroXRfqQuote[];
  isLoading: boolean;
  isError: boolean;
  allQuotesFailed: boolean;
  quoteAt: string | null;
}

export function useZeroXRfqData(asset: string): UseZeroXRfqDataResult {
  const spaceSlug = useCurrentSpaceSlug();
  const query = useQuery({
    queryKey: ["0x-rfq", asset, spaceSlug],
    queryFn: () => fetchZeroXRfqQuotes(asset, spaceSlug),
    enabled: !!asset,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const tiers = useMemo<ZeroXTierRow[]>(() => {
    if (!query.data) return [];

    // Only use quotes from the most recent capture
    const latestCaptureId = query.data.reduce(
      (best, q) => (!best || q.quote_at > best.quote_at ? q : best),
      null as ZeroXRfqQuote | null
    )?.capture_id;

    const latestByKey = new Map<string, ZeroXRfqQuote>();
    for (const q of query.data) {
      if (q.capture_id !== latestCaptureId) continue;
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
        const { sellDecimals, buyDecimals } = getQuoteDecimals(q);

        const sellAmount = rawToNumber(q.sell_amount_raw, sellDecimals);
        const buyAmount = rawToNumber(q.buy_amount_raw, buyDecimals);

        // Implied token price (USD per token) = USDC amount / token amount
        const sellIsUsdc = sellDecimals === USDC_DECIMALS;
        const usdcAmount = sellIsUsdc ? sellAmount : buyAmount;
        const tokenAmount = sellIsUsdc ? buyAmount : sellAmount;
        const impliedTokenPrice =
          tokenAmount > 0 ? usdcAmount / tokenAmount : 0;

        // Price impact: difference between notional and actual USDC amount
        const priceImpactBps =
          notionalUsd > 0 && usdcAmount > 0
            ? Math.abs(((notionalUsd - usdcAmount) / notionalUsd) * 10000)
            : 0;

        const gasCost = parseFloat(q.gas_estimate ?? "0") || 0;
        const totalNetworkFee = parseFloat(q.total_network_fee_raw ?? "0") || 0;

        return {
          notionalUsd,
          label: formatNotional(notionalUsd),
          direction: q.direction,
          quote: q,
          impliedTokenPrice,
          priceImpactBps,
          gasCost,
          totalNetworkFee,
          liquidityAvailable: q.liquidity_available,
          fillCount: q.fill_count ?? q.fills?.length ?? 0,
        };
      });
  }, [query.data]);

  const forwardTiers = useMemo(
    () => tiers.filter((t) => t.direction === "forward"),
    [tiers]
  );
  const reverseTiers = useMemo(
    () => tiers.filter((t) => t.direction === "reverse"),
    [tiers]
  );

  const allQuotesFailed = !!query.data && query.data.length === 0;
  const quoteAt = query.data?.[0]?.quote_at ?? null;

  return {
    asset,
    tiers,
    forwardTiers,
    reverseTiers,
    allQuotes: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    allQuotesFailed,
    quoteAt,
  };
}
