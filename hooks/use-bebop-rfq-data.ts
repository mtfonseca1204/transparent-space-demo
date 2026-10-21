import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BebopRouteLeg {
  quote_id: string;
  route_index: number;
  route_type: string; // "PMMv3" | "JAMv2" etc.
  route_quote_id: string;
  quote_status: string;
  price_impact: string;
  gas_fee_native: string;
  gas_fee_usd: string;
  makers: string[];
  maker_address: string | null;
  maker_amount_raw: string | null;
  taker_amount_raw: string | null;
  expiry: string;
  buy_tokens: {
    price: number;
    amount: string;
    symbol: string;
    decimals: number;
    priceUsd: number;
    minimumAmount: string;
    priceBeforeFee: number;
    amountBeforeFee: string;
    deltaFromExpected: number;
  };
  sell_tokens: {
    price: number;
    amount: string;
    symbol: string;
    decimals: number;
    priceUsd: number;
    minimumAmount: string;
    priceBeforeFee: number;
    amountBeforeFee: string;
    deltaFromExpected: number;
  };
}

export interface BebopRfqQuote {
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
  best_price: string;
  selected_route_type: string;
  selected_route_index: number;
  selected_route_quote_id: string;
  route_count: number;
  quote_buy_amount_raw: string;
  quote_buy_amount_before_fee_raw: string;
  quote_price: string;
  quote_price_before_fee: string;
  quote_price_usd: string;
  price_impact: string;
  gas_fee_native: string;
  gas_fee_usd: string;
  maker_address: string | null;
  maker_amount_raw: string | null;
  taker_amount_raw: string | null;
  expiry: string;
  is_success: boolean;
  error_code: string | null;
  error_message: string | null;
  quote_at: string;
  route_legs: BebopRouteLeg[];
}

export interface BebopTierRow {
  notionalUsd: number;
  label: string;
  direction: "forward" | "reverse";
  quote: BebopRfqQuote;
  impliedTokenPrice: number;
  priceImpactBps: number;
  gasFeeUsd: number;
  routeType: string;
  makerAddress: string | null;
  routeCount: number;
  routes: BebopRouteLeg[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BEBOP_RFQ_API_BASE = `${process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL}/api/rfq/bebop/latest`;

// Token decimals for Bebop quotes — Ethereum ERC-20 amounts.
const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;

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

export async function fetchBebopRfqQuotes(
  asset: string,
  spaceSlug?: string | null
): Promise<BebopRfqQuote[]> {
  if (isDemoSpaceSlug(spaceSlug)) {
    const json = getDemoRfqApiResponse("bebop", asset) as { data: BebopRfqQuote[] };
    return json.data.filter((q) => q.is_success);
  }

  const url = new URL(BEBOP_RFQ_API_BASE);
  url.searchParams.set("asset", asset);
  url.searchParams.set("include_routes", "true");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Bebop RFQ API error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "Bebop API error");
  if (!json.data) return [];
  return (json.data as BebopRfqQuote[]).filter(
    (q) => q.is_success && parseFloat(q.notional_usd) !== 250_000
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseBebopRfqDataResult {
  asset: string;
  tiers: BebopTierRow[];
  forwardTiers: BebopTierRow[];
  reverseTiers: BebopTierRow[];
  allQuotes: BebopRfqQuote[];
  isLoading: boolean;
  isError: boolean;
  allQuotesFailed: boolean;
  quoteAt: string | null;
}

export function useBebopRfqData(asset: string): UseBebopRfqDataResult {
  const spaceSlug = useCurrentSpaceSlug();
  const query = useQuery({
    queryKey: ["bebop-rfq", asset, spaceSlug],
    queryFn: () => fetchBebopRfqQuotes(asset, spaceSlug),
    enabled: !!asset,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const tiers = useMemo<BebopTierRow[]>(() => {
    if (!query.data) return [];

    // Deduplicate: keep only the latest quote per (notional_usd, direction)
    const latestByKey = new Map<string, BebopRfqQuote>();
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

        // Bebop provides quote_price directly (token/USDC ratio)
        // For forward: quote_price = how many tokens per USDC spent
        // For reverse: quote_price = how many USDC per token sold
        // Implied token price (USD per token):
        const quotePrice = parseFloat(q.quote_price) || 0;

        // Forward = buy token (sell USDC → buy token): price = USDC / tokens
        // Reverse = sell token (sell token → buy USDC): price = USDC / tokens
        const sellDecimals =
          q.direction === "forward" ? USDC_DECIMALS : TOKEN_DECIMALS;
        const buyDecimals =
          q.direction === "forward" ? TOKEN_DECIMALS : USDC_DECIMALS;

        const requestedSellAmount = rawToNumber(
          q.requested_sell_amount_raw,
          sellDecimals
        );
        const buyAmount = rawToNumber(q.quote_buy_amount_raw, buyDecimals);

        // Implied token price
        let impliedTokenPrice = 0;
        if (q.direction === "forward") {
          // Spent requestedSellAmount USDC to buy buyAmount tokens
          impliedTokenPrice = buyAmount > 0 ? requestedSellAmount / buyAmount : 0;
        } else {
          // Sold requestedSellAmount tokens to get buyAmount USDC
          impliedTokenPrice =
            requestedSellAmount > 0 ? buyAmount / requestedSellAmount : 0;
        }

        // Price impact from API (already in percentage, convert to bps)
        const priceImpact = parseFloat(q.price_impact) || 0;
        const priceImpactBps = Math.abs(priceImpact * 100); // API gives fraction, convert to bps

        const gasFeeUsd = parseFloat(q.gas_fee_usd) || 0;

        // Route info
        const selectedLeg = q.route_legs?.find(
          (leg) => leg.route_index === q.selected_route_index
        );
        const makerAddress =
          selectedLeg?.maker_address ?? q.maker_address ?? null;

        return {
          notionalUsd,
          label: formatNotional(notionalUsd),
          direction: q.direction,
          quote: q,
          impliedTokenPrice,
          priceImpactBps,
          gasFeeUsd,
          routeType: q.selected_route_type,
          makerAddress,
          routeCount: q.route_count,
          routes: q.route_legs ?? [],
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
