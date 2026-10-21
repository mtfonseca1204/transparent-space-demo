import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";
import type { OneInchRfqQuote } from "./use-1inch-rfq-data";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single snapshot in time with mid price and per-tier bid/ask prices */
export interface OneInchHistoryPoint {
  timestamp: Date;
  midPrice: number;
  /** Map of notionalUsd → { bidPrice, askPrice } */
  tiers: Map<number, { bidPrice: number; askPrice: number }>;
}

export interface OneInchUptimeStats {
  totalCaptures: number;
  from: Date | null;
  to: Date | null;
  expectedIntervalMs: number;
  longestGapMs: number;
  longestGapStart: Date | null;
  uptimePct: number;
  gaps: { start: Date; end: Date; durationMs: number }[];
}

export interface UseOneInchRfqHistoryResult {
  points: OneInchHistoryPoint[];
  notionalTiers: number[];
  uptime: OneInchUptimeStats;
  isLoading: boolean;
  isError: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ONEINCH_RFQ_API_BASE = `${process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL}/api/rfq/1inch/latest`;
const FETCH_TIMEOUT_MS = 30_000;
const PAGE_LIMIT = 10_000;
const MAX_PAGES = 10;
const TARGET_DAYS = 7;

// ─── Fetch ───────────────────────────────────────────────────────────────────

interface OneInchApiResponse {
  data: OneInchRfqQuote[];
  pagination?: { limit: number; has_more: boolean; next_cursor: string | null };
  error?: { message: string };
}

async function fetchOneInchHistoryPage(
  asset: string,
  cursor: string | null,
  signal?: AbortSignal
): Promise<OneInchApiResponse> {
  const url = new URL(ONEINCH_RFQ_API_BASE);
  url.searchParams.set("asset", asset);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", onAbort);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: timeoutController.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }

  if (!res.ok) throw new Error(`1inch RFQ history API error: ${res.status}`);
  return res.json();
}

export async function fetchOneInchHistory(
  asset: string,
  signal?: AbortSignal,
  spaceSlug?: string | null
): Promise<OneInchRfqQuote[]> {
  if (isDemoSpaceSlug(spaceSlug)) {
    const json = getDemoRfqApiResponse("1inch", asset) as { data: OneInchRfqQuote[] };
    return json.data.filter((q) => q.is_success);
  }

  const allQuotes: OneInchRfqQuote[] = [];
  let cursor: string | null = null;
  const cutoff = Date.now() - TARGET_DAYS * 24 * 60 * 60 * 1000;

  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await fetchOneInchHistoryPage(asset, cursor, signal);
    if (json.error) throw new Error(json.error.message || "1inch API error");
    if (!json.data || json.data.length === 0) break;

    const filtered = json.data.filter((q) => q.is_success);
    allQuotes.push(...filtered);

    // Stop if we've reached our target time window
    const oldest = json.data[json.data.length - 1];
    if (oldest && new Date(oldest.quote_at).getTime() < cutoff) break;

    if (!json.pagination?.has_more || !json.pagination.next_cursor) break;
    cursor = json.pagination.next_cursor;
  }

  return allQuotes;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;
const USDC_ETH_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

function rawToNumber(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

function computeOneInchTokenPrice(q: OneInchRfqQuote): number {
  const sellIsUsdc = q.sell_token?.toLowerCase() === USDC_ETH_ADDRESS;
  const buyIsUsdc = q.buy_token?.toLowerCase() === USDC_ETH_ADDRESS;
  const sellDecimals = sellIsUsdc ? USDC_DECIMALS : TOKEN_DECIMALS;
  const buyDecimals = buyIsUsdc ? USDC_DECIMALS : TOKEN_DECIMALS;

  const sellAmount = rawToNumber(q.requested_sell_amount_raw, sellDecimals);
  const buyAmount = rawToNumber(q.quote_buy_amount_raw, buyDecimals);

  // Price = USDC / tokens
  if (sellIsUsdc) {
    return buyAmount > 0 ? sellAmount / buyAmount : 0;
  }
  return sellAmount > 0 ? buyAmount / sellAmount : 0;
}

function computeUptime(
  timestamps: Date[],
  totalSpanMs: number
): OneInchUptimeStats {
  const empty: OneInchUptimeStats = {
    totalCaptures: 0,
    from: null,
    to: null,
    expectedIntervalMs: 0,
    longestGapMs: 0,
    longestGapStart: null,
    uptimePct: 0,
    gaps: [],
  };
  if (timestamps.length < 2) {
    return {
      ...empty,
      totalCaptures: timestamps.length,
      from: timestamps[0] ?? null,
      to: timestamps[timestamps.length - 1] ?? null,
      uptimePct: timestamps.length > 0 ? 100 : 0,
    };
  }

  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i].getTime() - sorted[i - 1].getTime());
  }
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  const gapThreshold = medianInterval * 2;

  let longestGapMs = 0;
  let longestGapStart: Date | null = null;
  const gaps: { start: Date; end: Date; durationMs: number }[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i].getTime() - sorted[i - 1].getTime();
    if (dt > gapThreshold) {
      gaps.push({ start: sorted[i - 1], end: sorted[i], durationMs: dt });
    }
    if (dt > longestGapMs) {
      longestGapMs = dt;
      longestGapStart = sorted[i - 1];
    }
  }

  const totalGapMs = gaps.reduce((s, g) => s + g.durationMs, 0);
  const span = totalSpanMs || sorted[sorted.length - 1].getTime() - sorted[0].getTime();
  const uptimePct = span > 0 ? Math.max(0, Math.min(100, ((span - totalGapMs) / span) * 100)) : 0;

  return {
    totalCaptures: sorted.length,
    from: sorted[0],
    to: sorted[sorted.length - 1],
    expectedIntervalMs: medianInterval,
    longestGapMs,
    longestGapStart,
    uptimePct,
    gaps,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOneInchRfqHistory(asset: string): UseOneInchRfqHistoryResult {
  const spaceSlug = useCurrentSpaceSlug();
  const query = useQuery({
    queryKey: ["1inch-rfq", "history", asset, spaceSlug],
    queryFn: ({ signal }) => fetchOneInchHistory(asset, signal, spaceSlug),
    enabled: !!asset,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const { points, notionalTiers, uptime } = useMemo(() => {
    const emptyUptime: OneInchUptimeStats = {
      totalCaptures: 0,
      from: null,
      to: null,
      expectedIntervalMs: 0,
      longestGapMs: 0,
      longestGapStart: null,
      uptimePct: 0,
      gaps: [],
    };
    if (!query.data || query.data.length === 0)
      return {
        points: [] as OneInchHistoryPoint[],
        notionalTiers: [] as number[],
        uptime: emptyUptime,
      };

    // Group quotes by capture_id
    const captures = new Map<
      string,
      { quoteAt: string; quotes: OneInchRfqQuote[] }
    >();
    for (const q of query.data) {
      let cap = captures.get(q.capture_id);
      if (!cap) {
        cap = { quoteAt: q.quote_at, quotes: [] };
        captures.set(q.capture_id, cap);
      }
      cap.quotes.push(q);
    }

    // Collect all notional tiers
    const tierSet = new Set<number>();
    for (const q of query.data) {
      tierSet.add(parseFloat(q.notional_usd));
    }
    const sortedTiers = Array.from(tierSet).sort((a, b) => a - b);

    // Build history points
    const historyPoints: OneInchHistoryPoint[] = [];

    for (const cap of captures.values()) {
      const tierMap = new Map<
        number,
        { bidPrice: number; askPrice: number }
      >();

      for (const q of cap.quotes) {
        const notional = parseFloat(q.notional_usd);
        const price = computeOneInchTokenPrice(q);
        if (price <= 0) continue;

        let entry = tierMap.get(notional);
        if (!entry) entry = { bidPrice: 0, askPrice: 0 };

        if (q.direction === "forward") {
          entry.bidPrice = price;
        } else {
          entry.askPrice = price;
        }
        tierMap.set(notional, entry);
      }

      // Compute mid price from smallest tier with at least one side
      let midPrice = 0;
      for (const notional of sortedTiers) {
        const entry = tierMap.get(notional);
        if (!entry) continue;
        if (entry.bidPrice > 0 && entry.askPrice > 0) {
          midPrice = (entry.bidPrice + entry.askPrice) / 2;
          break;
        }
        if (entry.bidPrice > 0 && midPrice === 0) midPrice = entry.bidPrice;
        if (entry.askPrice > 0 && midPrice === 0) midPrice = entry.askPrice;
      }
      if (midPrice === 0) continue;

      historyPoints.push({
        timestamp: new Date(cap.quoteAt),
        midPrice,
        tiers: tierMap,
      });
    }

    historyPoints.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    // Filter outliers using median mid price ± 20%
    if (historyPoints.length >= 3) {
      const sortedMids = historyPoints.map((p) => p.midPrice).sort((a, b) => a - b);
      const median = sortedMids[Math.floor(sortedMids.length / 2)];
      const lo = median * 0.8;
      const hi = median * 1.2;

      historyPoints.splice(
        0,
        historyPoints.length,
        ...historyPoints.filter((p) => p.midPrice >= lo && p.midPrice <= hi)
      );

      for (const pt of historyPoints) {
        for (const [, tier] of pt.tiers) {
          if (tier.bidPrice > 0 && (tier.bidPrice < lo || tier.bidPrice > hi)) {
            tier.bidPrice = 0;
          }
          if (tier.askPrice > 0 && (tier.askPrice < lo || tier.askPrice > hi)) {
            tier.askPrice = 0;
          }
        }
      }
    }

    // Compute uptime stats
    const captureTimestamps = historyPoints.map((p) => p.timestamp);
    const totalSpanMs =
      historyPoints.length > 1
        ? historyPoints[historyPoints.length - 1].timestamp.getTime() -
          historyPoints[0].timestamp.getTime()
        : 0;
    const uptimeStats = computeUptime(captureTimestamps, totalSpanMs);

    return {
      points: historyPoints,
      notionalTiers: sortedTiers,
      uptime: uptimeStats,
    };
  }, [query.data]);

  return {
    points,
    notionalTiers,
    uptime,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
