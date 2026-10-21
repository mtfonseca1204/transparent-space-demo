import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CowswapRfqQuote {
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
  quote_sell_amount_raw: string;
  quote_buy_amount_raw: string;
  fee_amount_raw: string;
  protocol_fee_bps: number;
  gas_amount: string;
  gas_price: string;
  sell_token_price: string;
  quote_kind: string;
  quote_valid_to: string;
  quote_ref_id: string;
  is_success: boolean;
  error_type: string | null;
  error_message: string | null;
  quote_at: string;
}

interface CowswapRfqApiResponse {
  data: CowswapRfqQuote[];
  pagination: { limit: number; has_more: boolean; next_cursor: string | null };
  meta: { provider: string; applied_filters: Record<string, unknown> };
}

export interface CowswapTierRow {
  notionalUsd: number;
  label: string;
  direction: "forward" | "reverse";
  quote: CowswapRfqQuote;
  tokensOut: number;
  tokensIn: number;
  priceImpactBps: number;
  feeBps: number;
  totalCostBps: number;
  impliedTokenPrice: number;
  feeAmount: number;
  gasCostGwei: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COWSWAP_RFQ_API_BASE = `${process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL}/api/rfq/cowswap/latest`;

// Token decimals for CowSwap quotes — Ethereum ERC-20 amounts.
// xStocks tokens on Ethereum are 18 decimals, USDC is 6 decimals.
const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;

// USDC on Ethereum mainnet (lowercased for comparison)
const USDC_ETH_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

/** Determine sell/buy decimals from the actual token addresses, not from direction. */
function getQuoteDecimals(q: CowswapRfqQuote): { sellDecimals: number; buyDecimals: number } {
  const sellIsUsdc = q.sell_token?.toLowerCase() === USDC_ETH_ADDRESS;
  const buyIsUsdc = q.buy_token?.toLowerCase() === USDC_ETH_ADDRESS;
  return {
    sellDecimals: sellIsUsdc ? USDC_DECIMALS : TOKEN_DECIMALS,
    buyDecimals: buyIsUsdc ? USDC_DECIMALS : TOKEN_DECIMALS,
  };
}

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

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchCowswapRfqQuotes(
  asset: string,
  spaceSlug?: string | null
): Promise<CowswapRfqQuote[]> {
  if (isDemoSpaceSlug(spaceSlug)) {
    const json = getDemoRfqApiResponse("cowswap", asset) as CowswapRfqApiResponse;
    return json.data.filter((q) => q.is_success);
  }

  const url = new URL(COWSWAP_RFQ_API_BASE);
  url.searchParams.set("asset", asset);
  url.searchParams.set("limit", "500");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`CowSwap RFQ API error: ${res.status}`);
  const json = await res.json();
  // API may return { error: { code: "BUSY", ... } } with 200 status
  if (json.error) throw new Error(json.error.message || "CowSwap API error");
  if (!json.data) return [];
  return (json.data as CowswapRfqQuote[]).filter((q) => q.is_success);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseCowswapRfqDataResult {
  asset: string;
  tiers: CowswapTierRow[];
  forwardTiers: CowswapTierRow[];
  reverseTiers: CowswapTierRow[];
  allQuotes: CowswapRfqQuote[];
  isLoading: boolean;
  isError: boolean;
  allQuotesFailed: boolean;
  quoteAt: string | null;
}

export function useCowswapRfqData(asset: string): UseCowswapRfqDataResult {
  const spaceSlug = useCurrentSpaceSlug();
  const query = useQuery({
    queryKey: ["cowswap-rfq", asset, spaceSlug],
    queryFn: () => fetchCowswapRfqQuotes(asset, spaceSlug),
    enabled: !!asset,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const tiers = useMemo<CowswapTierRow[]>(() => {
    if (!query.data) return [];

    // Only use quotes from the most recent capture to avoid stale tiers
    const latestCaptureId = query.data.reduce(
      (best, q) => (!best || q.quote_at > best.quote_at ? q : best),
      null as CowswapRfqQuote | null
    )?.capture_id;

    const latestByKey = new Map<string, CowswapRfqQuote>();
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

        // Determine decimals from actual sell_token/buy_token addresses
        // rather than trusting the direction field, which may not match
        // the actual token ordering in the quote.
        const { sellDecimals, buyDecimals } = getQuoteDecimals(q);

        const sellAmount = rawToNumber(q.quote_sell_amount_raw, sellDecimals);
        const buyAmount = rawToNumber(q.quote_buy_amount_raw, buyDecimals);

        // tokensOut/tokensIn — what the user gets/gives
        const tokensOut = buyAmount;
        const tokensIn = sellAmount;

        // Implied token price (USD per token) = USDC amount / token amount
        const sellIsUsdc = sellDecimals === USDC_DECIMALS;
        const usdcAmount = sellIsUsdc ? sellAmount : buyAmount;
        const tokenAmount = sellIsUsdc ? buyAmount : sellAmount;
        const impliedTokenPrice =
          tokenAmount > 0 ? usdcAmount / tokenAmount : 0;

        // Price impact: compare quoted sell amount vs requested sell amount
        // The difference represents slippage/price impact
        const requestedSellAmount = rawToNumber(
          q.requested_sell_amount_raw,
          sellDecimals
        );
        const priceImpactBps =
          requestedSellAmount > 0 && sellAmount > 0
            ? Math.abs(
                ((requestedSellAmount - sellAmount) / requestedSellAmount) *
                  10000
              )
            : 0;

        const feeBps = q.protocol_fee_bps;
        const totalCostBps = priceImpactBps + feeBps;

        // Fee amount in sell token's decimals
        const feeAmount = rawToNumber(q.fee_amount_raw, sellDecimals);

        // Gas cost in Gwei
        const gasCostGwei =
          (parseFloat(q.gas_amount) * parseFloat(q.gas_price)) / 1e9;

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
          feeAmount,
          gasCostGwei,
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
