import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JupzRfqQuote {
  quote_id: string;
  capture_id: string;
  asset: string;
  pool: string | null;
  direction: "forward" | "reverse";
  provider: string;
  notional_usd: string;
  input_mint: string;
  output_mint: string;
  requested_in_amount_raw: string;
  out_amount_raw: string;
  in_usd_value: string;
  out_usd_value: string;
  slippage_bps: number;
  fee_bps: number;
  swap_type: string | null;
  router: string | null;
  jup_quote_id: string | null;
  maker: string | null;
  platform_fee_amount: string | null;
  platform_fee_bps: number;
  price_impact: string | null;
  price_impact_pct: string;
  mode: string | null;
  total_time_ms: number | null;
  route_label: string | null;
  route_amm_key: string | null;
  is_success: boolean;
  error_code: string | null;
  error_message: string | null;
  quote_at: string;
}

export interface JupzTierRow {
  notionalUsd: number;
  label: string;
  direction: "forward" | "reverse";
  quote: JupzRfqQuote;
  impliedTokenPrice: number;
  priceImpactBps: number;
  feeBps: number;
  routeLabel: string | null;
  maker: string | null;
  totalTimeMs: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const JUPZ_RFQ_API_BASE = `${process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL}/api/rfq/jupz/latest`;

// Solana decimals
const SOL_TOKEN_DECIMALS = 8;
const SOL_USDC_DECIMALS = 6;
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

function getQuoteDecimals(q: JupzRfqQuote): { inDecimals: number; outDecimals: number } {
  const inIsUsdc = q.input_mint === SOL_USDC_MINT;
  return {
    inDecimals: inIsUsdc ? SOL_USDC_DECIMALS : SOL_TOKEN_DECIMALS,
    outDecimals: inIsUsdc ? SOL_TOKEN_DECIMALS : SOL_USDC_DECIMALS,
  };
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchJupzRfqQuotes(
  asset: string,
  spaceSlug?: string | null
): Promise<JupzRfqQuote[]> {
  if (isDemoSpaceSlug(spaceSlug)) {
    const json = getDemoRfqApiResponse("jupz", asset) as { data: JupzRfqQuote[] };
    return json.data.filter((q) => q.is_success);
  }

  const url = new URL(JUPZ_RFQ_API_BASE);
  url.searchParams.set("asset", asset);
  url.searchParams.set("limit", "500");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`JupZ RFQ API error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "JupZ API error");
  if (!json.data) return [];
  return (json.data as JupzRfqQuote[]).filter((q) => q.is_success);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseJupzRfqDataResult {
  asset: string;
  tiers: JupzTierRow[];
  forwardTiers: JupzTierRow[];
  reverseTiers: JupzTierRow[];
  allQuotes: JupzRfqQuote[];
  isLoading: boolean;
  isError: boolean;
  allQuotesFailed: boolean;
  quoteAt: string | null;
}

export function useJupzRfqData(asset: string): UseJupzRfqDataResult {
  const spaceSlug = useCurrentSpaceSlug();
  const query = useQuery({
    queryKey: ["jupz-rfq", asset, spaceSlug],
    queryFn: () => fetchJupzRfqQuotes(asset, spaceSlug),
    enabled: !!asset,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const tiers = useMemo<JupzTierRow[]>(() => {
    if (!query.data) return [];

    // Only use quotes from the most recent capture
    const latestCaptureId = query.data.reduce(
      (best, q) => (!best || q.quote_at > best.quote_at ? q : best),
      null as JupzRfqQuote | null
    )?.capture_id;

    const latestByKey = new Map<string, JupzRfqQuote>();
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
        const { inDecimals, outDecimals } = getQuoteDecimals(q);

        const inAmount = rawToNumber(q.requested_in_amount_raw, inDecimals);
        const outAmount = rawToNumber(q.out_amount_raw, outDecimals);

        // Implied token price (USD per token) = USDC amount / token amount
        const inIsUsdc = q.input_mint === SOL_USDC_MINT;
        const usdcAmount = inIsUsdc ? inAmount : outAmount;
        const tokenAmount = inIsUsdc ? outAmount : inAmount;
        const impliedTokenPrice =
          tokenAmount > 0 ? usdcAmount / tokenAmount : 0;

        const priceImpactBps = parseFloat(q.price_impact_pct) * 100 || 0;

        return {
          notionalUsd,
          label: formatNotional(notionalUsd),
          direction: q.direction,
          quote: q,
          impliedTokenPrice,
          priceImpactBps,
          feeBps: q.fee_bps ?? 0,
          routeLabel: q.route_label,
          maker: q.maker,
          totalTimeMs: q.total_time_ms,
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
