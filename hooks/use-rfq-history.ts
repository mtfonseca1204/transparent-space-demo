import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  SOLANA_POOL_METADATA_BY_ADDRESS,
  type SolanaPoolMetadata,
} from "@/lib/pools";
import {
  getRfqHistoryQueryOptions,
  type RfqQuote,
} from "./use-rfq-data";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single snapshot in time with mid price and per-tier bid/ask prices */
export interface RfqHistoryPoint {
  timestamp: Date;
  midPrice: number;
  /** Map of notionalUsd → { bidPrice, askPrice } */
  tiers: Map<number, { bidPrice: number; askPrice: number }>;
}

export interface UseRfqHistoryResult {
  points: RfqHistoryPoint[];
  notionalTiers: number[];
  poolMeta: SolanaPoolMetadata | undefined;
  isLoading: boolean;
  isError: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawToNumber(raw: string, decimals: number): number {
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

function computeTokenPrice(
  q: RfqQuote,
  poolMeta: SolanaPoolMetadata
): number {
  if (q.direction === "forward") {
    // USDC → Token: price = USDC_in / tokens_out
    const tokensOut = rawToNumber(
      q.quote_out_amount_raw,
      poolMeta.token0Decimals
    );
    const usdcIn = rawToNumber(q.quote_in_amount_raw, poolMeta.token1Decimals);
    return tokensOut > 0 ? usdcIn / tokensOut : 0;
  }
  // Token → USDC: price = USDC_out / tokens_in
  const usdcOut = rawToNumber(
    q.quote_out_amount_raw,
    poolMeta.token1Decimals
  );
  const tokensIn = rawToNumber(q.quote_in_amount_raw, poolMeta.token0Decimals);
  return tokensIn > 0 ? usdcOut / tokensIn : 0;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRfqHistory(poolKey: string): UseRfqHistoryResult {
  const query = useQuery({
    ...getRfqHistoryQueryOptions(poolKey),
    enabled: !!poolKey,
  });

  const poolMeta = SOLANA_POOL_METADATA_BY_ADDRESS[poolKey];

  const { points, notionalTiers } = useMemo(() => {
    if (!query.data || !poolMeta)
      return { points: [] as RfqHistoryPoint[], notionalTiers: [] as number[] };

    // Group quotes by capture_id
    const captures = new Map<
      string,
      { quoteAt: string; quotes: RfqQuote[] }
    >();
    for (const q of query.data) {
      let cap = captures.get(q.capture_id);
      if (!cap) {
        cap = { quoteAt: q.quote_at, quotes: [] };
        captures.set(q.capture_id, cap);
      }
      cap.quotes.push(q);
    }

    // Collect all notional tiers seen
    const tierSet = new Set<number>();
    for (const q of query.data) {
      tierSet.add(parseFloat(q.notional_usd));
    }
    const sortedTiers = Array.from(tierSet).sort((a, b) => a - b);

    // Build history points sorted by time
    const historyPoints: RfqHistoryPoint[] = [];

    for (const cap of captures.values()) {
      // For each capture, compute the token price for each (notional, direction)
      const tierMap = new Map<
        number,
        { bidPrice: number; askPrice: number }
      >();

      for (const q of cap.quotes) {
        const notional = parseFloat(q.notional_usd);
        const price = computeTokenPrice(q, poolMeta);
        if (price <= 0) continue;

        let entry = tierMap.get(notional);
        if (!entry) entry = { bidPrice: 0, askPrice: 0 };

        if (q.direction === "forward") {
          // Buy price (bid)
          entry.bidPrice = price;
        } else {
          // Sell price (ask)
          entry.askPrice = price;
        }
        tierMap.set(notional, entry);
      }

      // Compute mid price from the smallest tier that has at least one side,
      // or average all available prices if no tier has both sides
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

    return { points: historyPoints, notionalTiers: sortedTiers };
  }, [query.data, poolMeta]);

  return {
    points,
    notionalTiers,
    poolMeta,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
