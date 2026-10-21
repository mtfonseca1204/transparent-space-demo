import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { classifySession, type MarketSession } from "@/lib/market-session";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import { useAllTokenPrices } from "@/hooks/use-token-price";
import {
  buildMedianBuyPriceMap,
  computeRfqBuySideDepthCeiling,
  type RfqBuySideTier,
} from "@/lib/rfq-depth-ceiling";
import {
  LEGACY_BIRDS_EYE_RFQ_ASSETS,
  type RfqAssetConfig,
} from "@/lib/rfq-asset-config";
import { getDemoRfqApiResponse } from "@/lib/demo/fixtures";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RfqSourceData {
  /** Highest sane latest buy-side notional discovered for this asset/provider. */
  maxDepth: number;
  buyPrice: number;
  sellPrice: number;
  quoteAt: string | null;
  worstSideBps: number | null;
  sourceSession: MarketSession | null;
  loading: boolean;
  error: boolean;
}

export interface BirdsEyeRfqRow {
  asset: string;
  oraclePrice: number | null;
  /** Sum of all RFQ buy-side depth ceilings */
  totalMaxDepth: number;
  /** Per-source breakdown */
  sources: Record<RfqSourceKey, RfqSourceData>;
  // Legacy flat fields (kept for compatibility)
  cowMaxDepth: number;
  cowBuyPrice: number;
  bebMaxDepth: number;
  bebBuyPrice: number;
  cowQuoteAt: string | null;
  bebQuoteAt: string | null;
  cowLoading: boolean;
  bebLoading: boolean;
  cowError: boolean;
  bebError: boolean;
}

export type RfqSourceKey = "cowswap" | "bebop" | "1inch" | "0x" | "jupz";

export const RFQ_SOURCE_META: Record<RfqSourceKey, { label: string; color: string; barColor: string; textColor: string; favicon: string }> = {
  cowswap: {
    label: "CoWSwap",
    color: "emerald",
    barColor: "bg-emerald-500 dark:bg-emerald-400",
    textColor: "text-emerald-600 dark:text-emerald-400",
    favicon: "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://swap.cow.fi/&size=64",
  },
  bebop: {
    label: "Bebop",
    color: "violet",
    barColor: "bg-violet-500 dark:bg-violet-400",
    textColor: "text-violet-600 dark:text-violet-400",
    favicon: "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://bebop.xyz/&size=64",
  },
  "1inch": {
    label: "1inch",
    color: "sky",
    barColor: "bg-sky-500 dark:bg-sky-400",
    textColor: "text-sky-600 dark:text-sky-400",
    favicon: "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://1inch.com/&size=64",
  },
  "0x": {
    label: "0x",
    color: "orange",
    barColor: "bg-orange-500 dark:bg-orange-400",
    textColor: "text-orange-600 dark:text-orange-400",
    favicon: "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://0x.org/&size=64",
  },
  jupz: {
    label: "JupZ",
    color: "lime",
    barColor: "bg-lime-500 dark:bg-lime-400",
    textColor: "text-lime-600 dark:text-lime-400",
    favicon: "https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://jup.ag/&size=64",
  },
};

export interface BirdsEyeRfqData {
  rows: BirdsEyeRfqRow[];
  isLoading: boolean;
}

interface UseBirdsEyeRfqDataOptions {
  enabled?: boolean;
  assets?: RfqAssetConfig[];
  includeOraclePrices?: boolean;
  spaceSlug?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL;
const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;
const STALE_TIME = 30_000; // 30s — refetch frequently to pick up new quotes
const GC_TIME = 10 * 60 * 1000;
const HISTORY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const RFQ_QUERY_SHARED_OPTIONS = {
  staleTime: STALE_TIME,
  gcTime: GC_TIME,
  refetchInterval: STALE_TIME,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  retry: 2,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawToNumber(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

interface CowQuote {
  asset: string;
  notional_usd: string;
  direction: string;
  quote_sell_amount_raw: string;
  quote_buy_amount_raw: string;
  is_success: boolean;
  quote_at: string;
}

interface BebQuote {
  asset: string;
  notional_usd: string;
  direction: string;
  requested_sell_amount_raw: string;
  quote_buy_amount_raw: string;
  quote_price_usd: string;
  is_success: boolean;
  quote_at: string;
}

// Price at a specific notional for display (e.g. $10k order)
const PRICE_NOTIONAL_USD = 10_000;

function extractPriceAtNotional(
  tiers: RfqBuySideTier[],
  targetNotional: number
): number {
  if (tiers.length === 0) return 0;
  const closest = tiers.reduce((best, t) =>
    Math.abs(t.notionalUsd - targetNotional) < Math.abs(best.notionalUsd - targetNotional) ? t : best
  );
  return closest.buyPrice > 0 ? closest.buyPrice : 0;
}

/** Extract latest sell price from reverse-direction quotes at a target notional */
function extractSellPrice<Q extends { notional_usd: string; quote_at: string }>(
  allQuotes: Q[],
  targetNotional: number,
  priceFn: (q: Q) => number,
): number {
  if (allQuotes.length === 0) return 0;
  const latest = new Map<string, Q>();
  for (const q of allQuotes) {
    const existing = latest.get(q.notional_usd);
    if (!existing || q.quote_at > existing.quote_at) latest.set(q.notional_usd, q);
  }
  const tiers: RfqBuySideTier[] = Array.from(latest.values()).map((q) => ({
    notionalUsd: parseFloat(q.notional_usd),
    buyPrice: priceFn(q),
  }));
  return extractPriceAtNotional(tiers, targetNotional);
}

function latestQuoteAt<Q extends { quote_at: string }>(quotes: Q[]): string | null {
  if (quotes.length === 0) return null;
  return quotes.reduce(
    (latest, quote) => (quote.quote_at > latest ? quote.quote_at : latest),
    quotes[0].quote_at
  );
}

function computeWorstSideBps(buyPrice: number, sellPrice: number): number | null {
  if (!(buyPrice > 0) || !(sellPrice > 0)) return null;
  const mid = (buyPrice + sellPrice) / 2;
  if (!(mid > 0)) return null;
  return (Math.max(Math.abs(buyPrice - mid), Math.abs(sellPrice - mid)) / mid) * 10_000;
}

function sourceSessionFromQuoteAt(quoteAt: string | null): MarketSession | null {
  if (!quoteAt) return null;
  const date = new Date(quoteAt);
  if (Number.isNaN(date.getTime())) return null;
  return classifySession(date);
}

// ─── CowSwap: derive buy price from sell_amount / buy_tokens ────────────────

function cowQuoteToBuyPrice(q: CowQuote): number {
  const sell = rawToNumber(q.quote_sell_amount_raw, USDC_DECIMALS);
  const buyTokens = rawToNumber(q.quote_buy_amount_raw, TOKEN_DECIMALS);
  return buyTokens > 0 ? sell / buyTokens : 0;
}

function cowQuoteToSellPrice(q: CowQuote): number {
  // Reverse: sell tokens (18 dec) → receive USDC (6 dec)
  const sellTokens = rawToNumber(q.quote_sell_amount_raw, TOKEN_DECIMALS);
  const buyUsdc = rawToNumber(q.quote_buy_amount_raw, USDC_DECIMALS);
  return sellTokens > 0 ? buyUsdc / sellTokens : 0;
}

function getProviderFromEndpoint(endpoint: string): string | null {
  if (endpoint.includes("/cowswap/")) return "cowswap";
  if (endpoint.includes("/bebop/")) return "bebop";
  if (endpoint.includes("/0x/")) return "0x";
  if (endpoint.includes("/1inch/")) return "1inch";
  if (endpoint.includes("/jupz/")) return "jupz";
  return null;
}

export async function fetchRfqQuotes(endpoint: string, spaceSlug?: string | null) {
  if (isDemoSpaceSlug(spaceSlug)) {
    const provider = getProviderFromEndpoint(endpoint);
    if (!provider) return [];
    return getDemoRfqApiResponse(provider).data;
  }

  const separator = endpoint.includes("?") ? "&" : "?";
  const res = await fetch(`${API_BASE}${endpoint}${separator}limit=5000`);
  if (!res.ok) throw new Error(`${endpoint} API error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || `${endpoint} API error`);
  return json.data ?? [];
}

function groupQuotesByAsset<Q extends { asset: string }>(
  quotes: Q[],
  allowedAssets?: Set<string>
): Map<string, Q[]> {
  const byAsset = new Map<string, Q[]>();
  for (const quote of quotes) {
    const asset = String(quote.asset || "").trim();
    if (!asset) continue;
    if (allowedAssets && !allowedAssets.has(asset)) continue;
    const existing = byAsset.get(asset);
    if (existing) existing.push(quote);
    else byAsset.set(asset, [quote]);
  }
  return byAsset;
}

function buildProviderAssetMap<Q extends { asset: string }>(
  quotes: Q[],
  buildRow: (assetQuotes: Q[]) => Omit<RfqSourceData, "loading" | "error">,
  allowedAssets?: Set<string>,
): Map<string, Omit<RfqSourceData, "loading" | "error">> {
  return new Map(
    Array.from(groupQuotesByAsset(quotes, allowedAssets).entries()).map(([asset, assetQuotes]) => [
      asset,
      buildRow(assetQuotes),
    ]),
  );
}

function buildCowSourceData(assetQuotes: CowQuote[]) {
  const successQuotes: CowQuote[] = assetQuotes.filter((q: CowQuote) => q.is_success);
  const allQuotes = successQuotes.filter((q) => q.direction === "forward");
  const reverseQuotes = successQuotes.filter((q) => q.direction === "reverse");

  // Build median from recent quotes to detect outliers
  const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
  const recentQuotes = allQuotes.filter((q) => q.quote_at >= cutoff);
  const historyTiers = (recentQuotes.length > 0 ? recentQuotes : allQuotes).map(
    (q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: cowQuoteToBuyPrice(q) })
  );
  const medianMap = buildMedianBuyPriceMap(historyTiers);

  // Latest quote per notional
  const latest = new Map<string, CowQuote>();
  for (const q of allQuotes) {
    const existing = latest.get(q.notional_usd);
    if (!existing || q.quote_at > existing.quote_at) latest.set(q.notional_usd, q);
  }
  const latestTiers: RfqBuySideTier[] = Array.from(latest.values())
    .sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd))
    .map((q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: cowQuoteToBuyPrice(q) }));

  const { maxDepth, buyPrice } = computeRfqBuySideDepthCeiling(latestTiers, medianMap);
  const scoreBuyPrice = extractPriceAtNotional(latestTiers, PRICE_NOTIONAL_USD);
  const sellPrice = extractSellPrice(reverseQuotes, PRICE_NOTIONAL_USD, cowQuoteToSellPrice);
  const quoteAt = latestQuoteAt(allQuotes);
  return {
    maxDepth,
    buyPrice,
    sellPrice,
    quoteAt,
    worstSideBps: computeWorstSideBps(scoreBuyPrice, sellPrice),
    sourceSession: sourceSessionFromQuoteAt(quoteAt),
  };
}

// ─── Bebop: use quote_price_usd directly ─────────────────────────────────────

function buildBebSourceData(assetQuotes: BebQuote[]) {
  const successQuotes: BebQuote[] = assetQuotes.filter((q: BebQuote) => q.is_success);
  const allQuotes = successQuotes.filter((q) => q.direction === "forward");
  const reverseQuotes = successQuotes.filter((q) => q.direction === "reverse");

  const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
  const recentQuotes = allQuotes.filter((q) => q.quote_at >= cutoff);
  const historyTiers = (recentQuotes.length > 0 ? recentQuotes : allQuotes).map((q) => ({
    notionalUsd: parseFloat(q.notional_usd),
    buyPrice: parseFloat(q.quote_price_usd) || 0,
  }));
  const medianMap = buildMedianBuyPriceMap(historyTiers);

  const latest = new Map<string, BebQuote>();
  for (const q of allQuotes) {
    const existing = latest.get(q.notional_usd);
    if (!existing || q.quote_at > existing.quote_at) latest.set(q.notional_usd, q);
  }
  const latestTiers: RfqBuySideTier[] = Array.from(latest.values())
    .sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd))
    .map((q) => ({
      notionalUsd: parseFloat(q.notional_usd),
      buyPrice: parseFloat(q.quote_price_usd) || 0,
    }));

  const { maxDepth, buyPrice } = computeRfqBuySideDepthCeiling(latestTiers, medianMap);
  const scoreBuyPrice = extractPriceAtNotional(latestTiers, PRICE_NOTIONAL_USD);
  const sellPrice = extractSellPrice(
    reverseQuotes, PRICE_NOTIONAL_USD,
    (q: BebQuote) => parseFloat(q.quote_price_usd) || 0,
  );
  const quoteAt = latestQuoteAt(allQuotes);
  return {
    maxDepth,
    buyPrice,
    sellPrice,
    quoteAt,
    worstSideBps: computeWorstSideBps(scoreBuyPrice, sellPrice),
    sourceSession: sourceSessionFromQuoteAt(quoteAt),
  };
}

// ─── 0x: derive buy price from sell_amount / buy_tokens (USDC address match) ─

const STABLE_EVM_ADDRESSES = new Set([
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
]);

interface ZeroXQuote {
  asset: string;
  notional_usd: string;
  direction: string;
  sell_token: string;
  buy_token: string;
  sell_amount_raw: string;
  buy_amount_raw: string;
  is_success: boolean;
  quote_at: string;
}

function zeroXQuoteToBuyPrice(q: ZeroXQuote): number {
  const sellToken = q.sell_token?.toLowerCase() ?? "";
  const sellIsStable = STABLE_EVM_ADDRESSES.has(sellToken);
  const sellDec = sellIsStable ? USDC_DECIMALS : TOKEN_DECIMALS;
  const buyDec = sellIsStable ? TOKEN_DECIMALS : USDC_DECIMALS;
  const sell = rawToNumber(q.sell_amount_raw, sellDec);
  const buy = rawToNumber(q.buy_amount_raw, buyDec);
  // Price = stablecoin / tokens
  if (sellIsStable) return buy > 0 ? sell / buy : 0;
  return sell > 0 ? buy / sell : 0;
}

function buildZeroXSourceData(assetQuotes: ZeroXQuote[]) {
  const successQuotes: ZeroXQuote[] = assetQuotes.filter((q: ZeroXQuote) => q.is_success);
  const allQuotes = successQuotes.filter((q) => q.direction === "forward");
  const reverseQuotes = successQuotes.filter((q) => q.direction === "reverse");

  const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
  const recentQuotes = allQuotes.filter((q) => q.quote_at >= cutoff);
  const historyTiers = (recentQuotes.length > 0 ? recentQuotes : allQuotes).map(
    (q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: zeroXQuoteToBuyPrice(q) })
  );
  const medianMap = buildMedianBuyPriceMap(historyTiers);

  const latest = new Map<string, ZeroXQuote>();
  for (const q of allQuotes) {
    const existing = latest.get(q.notional_usd);
    if (!existing || q.quote_at > existing.quote_at) latest.set(q.notional_usd, q);
  }
  const latestTiers: RfqBuySideTier[] = Array.from(latest.values())
    .sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd))
    .map((q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: zeroXQuoteToBuyPrice(q) }));

  const { maxDepth, buyPrice } = computeRfqBuySideDepthCeiling(latestTiers, medianMap);
  const scoreBuyPrice = extractPriceAtNotional(latestTiers, PRICE_NOTIONAL_USD);
  const sellPrice = extractSellPrice(reverseQuotes, PRICE_NOTIONAL_USD, zeroXQuoteToBuyPrice);
  const quoteAt = latestQuoteAt(allQuotes);
  return {
    maxDepth,
    buyPrice,
    sellPrice,
    quoteAt,
    worstSideBps: computeWorstSideBps(scoreBuyPrice, sellPrice),
    sourceSession: sourceSessionFromQuoteAt(quoteAt),
  };
}

// ─── 1inch: derive buy price from requested_sell_amount_raw / quote_buy_amount_raw

interface OneInchQuote {
  asset: string;
  notional_usd: string;
  direction: string;
  sell_token: string;
  buy_token: string;
  requested_sell_amount_raw: string;
  quote_buy_amount_raw: string;
  is_success: boolean;
  quote_at: string;
}

function oneInchQuoteToBuyPrice(q: OneInchQuote): number {
  const sellToken = q.sell_token?.toLowerCase() ?? "";
  const sellIsStable = STABLE_EVM_ADDRESSES.has(sellToken);
  const sellDec = sellIsStable ? USDC_DECIMALS : TOKEN_DECIMALS;
  const buyDec = sellIsStable ? TOKEN_DECIMALS : USDC_DECIMALS;
  const sell = rawToNumber(q.requested_sell_amount_raw, sellDec);
  const buy = rawToNumber(q.quote_buy_amount_raw, buyDec);
  if (sellIsStable) return buy > 0 ? sell / buy : 0;
  return sell > 0 ? buy / sell : 0;
}

function buildOneInchSourceData(assetQuotes: OneInchQuote[]) {
  const successQuotes: OneInchQuote[] = assetQuotes.filter((q: OneInchQuote) => q.is_success);
  const allQuotes = successQuotes.filter((q) => q.direction === "forward");
  const reverseQuotes = successQuotes.filter((q) => q.direction === "reverse");

  const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
  const recentQuotes = allQuotes.filter((q) => q.quote_at >= cutoff);
  const historyTiers = (recentQuotes.length > 0 ? recentQuotes : allQuotes).map(
    (q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: oneInchQuoteToBuyPrice(q) })
  );
  const medianMap = buildMedianBuyPriceMap(historyTiers);

  const latest = new Map<string, OneInchQuote>();
  for (const q of allQuotes) {
    const existing = latest.get(q.notional_usd);
    if (!existing || q.quote_at > existing.quote_at) latest.set(q.notional_usd, q);
  }
  const latestTiers: RfqBuySideTier[] = Array.from(latest.values())
    .sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd))
    .map((q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: oneInchQuoteToBuyPrice(q) }));

  const { maxDepth, buyPrice } = computeRfqBuySideDepthCeiling(latestTiers, medianMap);
  const scoreBuyPrice = extractPriceAtNotional(latestTiers, PRICE_NOTIONAL_USD);
  const sellPrice = extractSellPrice(reverseQuotes, PRICE_NOTIONAL_USD, oneInchQuoteToBuyPrice);
  const quoteAt = latestQuoteAt(allQuotes);
  return {
    maxDepth,
    buyPrice,
    sellPrice,
    quoteAt,
    worstSideBps: computeWorstSideBps(scoreBuyPrice, sellPrice),
    sourceSession: sourceSessionFromQuoteAt(quoteAt),
  };
}

// ─── JupZ (Solana-native): derive buy price from requested_in_amount / out_amount

// Solana token decimals: USDC = 6, xStock tokens = 8
const SOL_USDC_DECIMALS = 6;
const SOL_TOKEN_DECIMALS = 8;

interface JupzQuote {
  asset: string;
  notional_usd: string;
  direction: string;
  input_mint: string;
  output_mint: string;
  requested_in_amount_raw: string;
  out_amount_raw: string;
  in_usd_value: string;
  out_usd_value: string;
  price_impact_pct: string;
  fee_bps: number;
  is_success: boolean;
  quote_at: string;
}

const SOL_STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkYF4G9ye",
]);

function jupzQuoteToBuyPrice(q: JupzQuote): number {
  const inIsStable = SOL_STABLE_MINTS.has(q.input_mint);
  const inDec = inIsStable ? SOL_USDC_DECIMALS : SOL_TOKEN_DECIMALS;
  const outDec = inIsStable ? SOL_TOKEN_DECIMALS : SOL_USDC_DECIMALS;
  const inAmount = rawToNumber(q.requested_in_amount_raw, inDec);
  const outAmount = rawToNumber(q.out_amount_raw, outDec);
  // Price = stablecoin / tokens
  if (inIsStable) return outAmount > 0 ? inAmount / outAmount : 0;
  return inAmount > 0 ? outAmount / inAmount : 0;
}

function buildJupzSourceData(assetQuotes: JupzQuote[]) {
  const successQuotes: JupzQuote[] = assetQuotes.filter((q: JupzQuote) => q.is_success);
  const allQuotes = successQuotes.filter((q) => q.direction === "forward");
  const reverseQuotes = successQuotes.filter((q) => q.direction === "reverse");

  const cutoff = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
  const recentQuotes = allQuotes.filter((q) => q.quote_at >= cutoff);
  const historyTiers = (recentQuotes.length > 0 ? recentQuotes : allQuotes).map(
    (q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: jupzQuoteToBuyPrice(q) })
  );
  const medianMap = buildMedianBuyPriceMap(historyTiers);

  const latest = new Map<string, JupzQuote>();
  for (const q of allQuotes) {
    const existing = latest.get(q.notional_usd);
    if (!existing || q.quote_at > existing.quote_at) latest.set(q.notional_usd, q);
  }
  const latestTiers: RfqBuySideTier[] = Array.from(latest.values())
    .sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd))
    .map((q) => ({ notionalUsd: parseFloat(q.notional_usd), buyPrice: jupzQuoteToBuyPrice(q) }));

  const { maxDepth, buyPrice } = computeRfqBuySideDepthCeiling(latestTiers, medianMap);
  const scoreBuyPrice = extractPriceAtNotional(latestTiers, PRICE_NOTIONAL_USD);
  const sellPrice = extractSellPrice(reverseQuotes, PRICE_NOTIONAL_USD, jupzQuoteToBuyPrice);
  const quoteAt = latestQuoteAt(allQuotes);
  return {
    maxDepth,
    buyPrice,
    sellPrice,
    quoteAt,
    worstSideBps: computeWorstSideBps(scoreBuyPrice, sellPrice),
    sourceSession: sourceSessionFromQuoteAt(quoteAt),
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

// Build asset symbol → lowercase mint address map from pool metadata
function buildAssetMintMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const meta of Object.values(SOLANA_POOL_METADATA_BY_ADDRESS)) {
    if (meta.token0Mint && meta.token0Symbol && !map[meta.token0Symbol]) {
      map[meta.token0Symbol] = meta.token0Mint.toLowerCase();
    }
  }
  return map;
}

const ASSET_MINT_MAP = buildAssetMintMap();

export function useBirdsEyeRfqData(
  options: UseBirdsEyeRfqDataOptions = {}
): BirdsEyeRfqData {
  const enabled = options.enabled ?? true;
  const includeOraclePrices = options.includeOraclePrices ?? true;
  const spaceSlug = options.spaceSlug ?? null;
  const assets = useMemo(
    () =>
      options.assets ?? LEGACY_BIRDS_EYE_RFQ_ASSETS.map((asset) => ({
        asset,
        name: asset,
        group: "core20" as const,
        requiredTier: null,
        enabledProviders: ["oneinch", "zerox", "bebop", "cowswap", "jupz"],
        solanaMint: null,
        evmTokenAddress: null,
        pool: null,
      })),
    [options.assets]
  );
  const assetKey = useMemo(
    () => assets.map((asset) => asset.asset).sort().join(","),
    [assets]
  );
  const allowedAssets = useMemo(
    () => new Set(assets.map((asset) => asset.asset)),
    [assets]
  );
  const allTokenPrices = useAllTokenPrices({
    enabled: enabled && includeOraclePrices,
    spaceSlug,
  });
  const priceMap = useMemo(
    () => allTokenPrices.data?.pricesUsdByAddress ?? {},
    [allTokenPrices.data?.pricesUsdByAddress]
  );

  const cowswapQuery = useQuery({
    queryKey: ["birds-eye-rfq-cowswap", enabled, assetKey, spaceSlug],
    queryFn: async () =>
      buildProviderAssetMap(
        (await fetchRfqQuotes("/api/rfq/cowswap/latest", spaceSlug)) as CowQuote[],
        buildCowSourceData,
        allowedAssets,
      ),
    enabled,
    ...RFQ_QUERY_SHARED_OPTIONS,
  });

  const bebopQuery = useQuery({
    queryKey: ["birds-eye-rfq-bebop", enabled, assetKey, spaceSlug],
    queryFn: async () =>
      buildProviderAssetMap(
        (await fetchRfqQuotes("/api/rfq/bebop/latest?include_routes=true", spaceSlug)) as BebQuote[],
        buildBebSourceData,
        allowedAssets,
      ),
    enabled,
    ...RFQ_QUERY_SHARED_OPTIONS,
  });

  const zeroXQuery = useQuery({
    queryKey: ["birds-eye-rfq-0x", enabled, assetKey, spaceSlug],
    queryFn: async () =>
      buildProviderAssetMap(
        (await fetchRfqQuotes("/api/rfq/0x/latest", spaceSlug)) as ZeroXQuote[],
        buildZeroXSourceData,
        allowedAssets,
      ),
    enabled,
    ...RFQ_QUERY_SHARED_OPTIONS,
  });

  const oneInchQuery = useQuery({
    queryKey: ["birds-eye-rfq-1inch", enabled, assetKey, spaceSlug],
    queryFn: async () =>
      buildProviderAssetMap(
        (await fetchRfqQuotes("/api/rfq/1inch/latest", spaceSlug)) as OneInchQuote[],
        buildOneInchSourceData,
        allowedAssets,
      ),
    enabled,
    ...RFQ_QUERY_SHARED_OPTIONS,
  });

  const jupzQuery = useQuery({
    queryKey: ["birds-eye-rfq-jupz", enabled, assetKey, spaceSlug],
    queryFn: async () =>
      buildProviderAssetMap(
        (await fetchRfqQuotes("/api/rfq/jupz/latest", spaceSlug)) as JupzQuote[],
        buildJupzSourceData,
        allowedAssets,
      ),
    enabled,
    ...RFQ_QUERY_SHARED_OPTIONS,
  });

  return useMemo(() => {
    if (!enabled) {
      return { rows: [], isLoading: false };
    }

    const rows: BirdsEyeRfqRow[] = assets.map((assetConfig) => {
      const asset = assetConfig.asset;
      const mint = assetConfig.solanaMint?.toLowerCase() ?? ASSET_MINT_MAP[asset];
      const oraclePrice = includeOraclePrices && mint ? (priceMap[mint] ?? null) : null;
      const cow = cowswapQuery.data?.get(asset);
      const beb = bebopQuery.data?.get(asset);
      const zx = zeroXQuery.data?.get(asset);
      const oi = oneInchQuery.data?.get(asset);
      const jz = jupzQuery.data?.get(asset);

      const cowMaxDepth = cow?.maxDepth ?? 0;
      const bebMaxDepth = beb?.maxDepth ?? 0;
      const zxMaxDepth = zx?.maxDepth ?? 0;
      const oiMaxDepth = oi?.maxDepth ?? 0;
      const jzMaxDepth = jz?.maxDepth ?? 0;

      const sources: Record<RfqSourceKey, RfqSourceData> = {
        cowswap: {
          maxDepth: cowMaxDepth,
          buyPrice: cow?.buyPrice ?? 0,
          sellPrice: cow?.sellPrice ?? 0,
          quoteAt: cow?.quoteAt ?? null,
          worstSideBps: cow?.worstSideBps ?? null,
          sourceSession: cow?.sourceSession ?? null,
          loading: cowswapQuery.isLoading,
          error: cowswapQuery.isError,
        },
        bebop: {
          maxDepth: bebMaxDepth,
          buyPrice: beb?.buyPrice ?? 0,
          sellPrice: beb?.sellPrice ?? 0,
          quoteAt: beb?.quoteAt ?? null,
          worstSideBps: beb?.worstSideBps ?? null,
          sourceSession: beb?.sourceSession ?? null,
          loading: bebopQuery.isLoading,
          error: bebopQuery.isError,
        },
        "1inch": {
          maxDepth: oiMaxDepth,
          buyPrice: oi?.buyPrice ?? 0,
          sellPrice: oi?.sellPrice ?? 0,
          quoteAt: oi?.quoteAt ?? null,
          worstSideBps: oi?.worstSideBps ?? null,
          sourceSession: oi?.sourceSession ?? null,
          loading: oneInchQuery.isLoading,
          error: oneInchQuery.isError,
        },
        "0x": {
          maxDepth: zxMaxDepth,
          buyPrice: zx?.buyPrice ?? 0,
          sellPrice: zx?.sellPrice ?? 0,
          quoteAt: zx?.quoteAt ?? null,
          worstSideBps: zx?.worstSideBps ?? null,
          sourceSession: zx?.sourceSession ?? null,
          loading: zeroXQuery.isLoading,
          error: zeroXQuery.isError,
        },
        jupz: {
          maxDepth: jzMaxDepth,
          buyPrice: jz?.buyPrice ?? 0,
          sellPrice: jz?.sellPrice ?? 0,
          quoteAt: jz?.quoteAt ?? null,
          worstSideBps: jz?.worstSideBps ?? null,
          sourceSession: jz?.sourceSession ?? null,
          loading: jupzQuery.isLoading,
          error: jupzQuery.isError,
        },
      };

      return {
        asset,
        oraclePrice,
        totalMaxDepth: cowMaxDepth + bebMaxDepth + zxMaxDepth + oiMaxDepth + jzMaxDepth,
        sources,
        // Legacy flat fields
        cowMaxDepth,
        cowBuyPrice: cow?.buyPrice ?? 0,
        bebMaxDepth,
        bebBuyPrice: beb?.buyPrice ?? 0,
        cowQuoteAt: cow?.quoteAt ?? null,
        bebQuoteAt: beb?.quoteAt ?? null,
        cowLoading: cowswapQuery.isLoading,
        bebLoading: bebopQuery.isLoading,
        cowError: cowswapQuery.isError,
        bebError: bebopQuery.isError,
      };
    });

    const isLoading =
      cowswapQuery.isLoading
      || bebopQuery.isLoading
      || zeroXQuery.isLoading
      || oneInchQuery.isLoading
      || jupzQuery.isLoading;

    return { rows, isLoading };
  }, [
    assets,
    bebopQuery.data,
    bebopQuery.isError,
    bebopQuery.isLoading,
    cowswapQuery.data,
    cowswapQuery.isError,
    cowswapQuery.isLoading,
    enabled,
    includeOraclePrices,
    jupzQuery.data,
    jupzQuery.isError,
    jupzQuery.isLoading,
    oneInchQuery.data,
    oneInchQuery.isError,
    oneInchQuery.isLoading,
    priceMap,
    zeroXQuery.data,
    zeroXQuery.isError,
    zeroXQuery.isLoading,
  ]);
}
