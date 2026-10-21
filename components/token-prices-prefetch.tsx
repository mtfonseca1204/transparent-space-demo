"use client";

import { useAllTokenPrices } from "@/hooks/use-token-price";

/**
 * Ensures token prices are fetched once on page load (and then served from cache).
 * No UI; just warms React Query + backend cache.
 */
export function TokenPricesPrefetch() {
  useAllTokenPrices();
  return null;
}


