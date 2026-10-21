import { NextRequest, NextResponse } from "next/server";
import { SOLANA_POOL_METADATA_BY_ADDRESS } from "@/lib/pools";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";
import { fetchWorldchainPools } from "@/lib/worldchain-indexer-client";
import { getDemoTokenPrices, isDemoRequest } from "@/lib/demo/fixtures";

type DefiLlamaCoin = {
  decimals?: number;
  symbol?: string;
  price?: number;
  timestamp?: number;
  confidence?: number;
};

type DefiLlamaResponse = {
  coins?: Record<string, DefiLlamaCoin | undefined>;
};

type CoinGeckoSimpleResponse = Record<string, { usd?: number } | undefined>;

type CachedPayload = {
  updatedAt: number;
  chain: string;
  tokenCount: number;
  pricesUsdByAddress: Record<string, number | null>;
  metaByCoinKey: Record<string, DefiLlamaCoin>;
};

// Module-scope in-memory cache (works well for Node runtime; best-effort for serverless).
let cache: { timestamp: number; payload: CachedPayload } | null = null;

function getDefiLlamaBaseUrl(): string {
  // Free endpoint is hosted on `coins.llama.fi` (see screenshot + docs usage example).
  // Keep it configurable in case DefiLlama changes domains or you want to route via a proxy.
  return (process.env.DEFILLAMA_BASE_URL ?? "https://coins.llama.fi").trim().replace(/\/+$/, "");
}

function getCacheTTLms(): number {
  const raw = process.env.DEFILLAMA_PRICE_CACHE_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000; // 5 minutes
}

function getMaxCoinsPerRequest(): number {
  const raw = process.env.DEFILLAMA_MAX_COINS_PER_REQUEST;
  const n = raw ? Number(raw) : NaN;
  // Keep the URL path size reasonable; DefiLlama uses a GET with coins in the path.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

function getChainSlugFromEnv(): string {
  // DefiLlama coin keys are "chain:address".
  // For World Chain, set this explicitly if needed:
  // e.g. DEFILLAMA_CHAIN_SLUG=world-chain (or whatever slug DefiLlama uses).
  return (process.env.DEFILLAMA_CHAIN_SLUG ?? "world-chain").trim();
}

// Known tokens (fallback when indexer discovery is unavailable on the server).
// NOTE: these are lowercased for consistent lookups.
const WORLDCHAIN_FALLBACK_TOKEN_ADDRESSES = Object.freeze([
  "0x79a02482a880bce3f13e09da970dc34db4cd24d1", // USDC (World Chain)
  "0x4200000000000000000000000000000000000006", // WETH
  "0x2cfc85d8e48f8eab294be644d9e25c3030863003", // WLD
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC (Ethereum / Gensyn)
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT (Ethereum / Gensyn)
  "0x0000000000000000000000000000000000000000", // ETH (Ethereum / Gensyn v4 native currency)
  "0x4d7078ddd6ccfed2f85db5b7d3ff16828d378d48", // AI (Gensyn)
  "0x55d398326f99059ff775485246999027b3197955", // USDT (BSC / Perle)
  "0xd20fb09a49a8e75fef536a2dbc68222900287bac", // PRL (BSC / Perle)
  "0x4b948d64de1f71fcd12fb586f4c776421a35b3ee", // 0G (BSC)
  "0x203a662b0bd271a6ed5a60edfbd04bfce608fd36", // vbUSDC (Katana)
  "0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62", // vbETH (Katana)
  "0x754704bc059f8c67012fed69bc8a327a5aafb603", // USDC (Monad)
  "0xad96c3dffcd6374294e2573a7fbba96097cc8d7c", // DUST (Monad)
  "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e", // USDC.e (0G)
  "0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c", // W0G (0G)
  "dn4l5je9vugpmt1ssewqyybuqyryuwuywmtq7q5gvdfk", // WLD (Solana wormhole)
  "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v", // USDC (Solana SPL, lowercased)
]);

// DefiLlama can also price via `coingecko:<id>` keys. This is useful when a chain slug
// isn't supported yet or the token contract isn't indexed under that chain.
//
// From our curl tests:
// - `worldchain:<addr>` and `world-chain:<addr>` returned `{ "coins": {} }` for these tokens.
// - `coingecko:weth`, `coingecko:usd-coin`, `coingecko:worldcoin-wld`, `coingecko:solana` returned prices.
const DEFAULT_COIN_KEY_BY_ADDRESS: Record<string, string> = Object.freeze({
  // World Chain EVM tokens
  "0x79a02482a880bce3f13e09da970dc34db4cd24d1": "coingecko:usd-coin",
  "0x4200000000000000000000000000000000000006": "coingecko:weth",
  "0x2cfc85d8e48f8eab294be644d9e25c3030863003": "coingecko:worldcoin-wld",
  "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3": "coingecko:wrapped-bitcoin", // WBTC
  "0x1c60ba0a0ed1019e8eb035e6daf4155a5ce2380b": "coingecko:euro-coin", // EURC
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "coingecko:usd-coin",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "coingecko:tether",
  "0x0000000000000000000000000000000000000000": "coingecko:ethereum",
  "0x4d7078ddd6ccfed2f85db5b7d3ff16828d378d48": "coingecko:gensyn",
  "0x55d398326f99059ff775485246999027b3197955": "coingecko:tether",
  "0xd20fb09a49a8e75fef536a2dbc68222900287bac": "coingecko:perle",
  "0x4b948d64de1f71fcd12fb586f4c776421a35b3ee": "coingecko:wrapped-0g",
  "0x203a662b0bd271a6ed5a60edfbd04bfce608fd36": "coingecko:usd-coin",
  "0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62": "coingecko:ethereum",
  "0x754704bc059f8c67012fed69bc8a327a5aafb603": "coingecko:usd-coin",
  "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e": "coingecko:usd-coin",
  "0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c": "coingecko:wrapped-0g",
  // Solana SPL tokens (lowercased for consistent lookups)
  "dn4l5je9vugpmt1ssewqyybuqyryuwuywmtq7q5gvdfk": "coingecko:worldcoin-wld",
  "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v": "coingecko:usd-coin",
});

function getCoinGeckoIdForAddress(addrLc: string): string | null {
  const key = DEFAULT_COIN_KEY_BY_ADDRESS[addrLc];
  if (!key) return null;
  if (!key.startsWith("coingecko:")) return null;
  return key.slice("coingecko:".length);
}

/**
 * Collect all Solana token mint addresses from pool metadata.
 * Returns both original-case (for CoinGecko API) and lowercased (for priceMap keys).
 */
function getSolanaTokenMints(): Array<{ mint: string; mintLc: string }> {
  const seen = new Set<string>();
  const result: Array<{ mint: string; mintLc: string }> = [];
  for (const meta of Object.values(SOLANA_POOL_METADATA_BY_ADDRESS)) {
    for (const mint of [meta.token0Mint, meta.token1Mint]) {
      if (!mint) continue;
      const lc = mint.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      result.push({ mint, mintLc: lc });
    }
  }
  return result;
}

// Persistent cache: Solana mint (original case) → CoinGecko coin ID (or null if not found).
// Survives across requests so contract lookups only happen once per server lifecycle.
const solanaMintCoinGeckoIdCache = new Map<string, string | null>();

// Rate-limit cooldown: when CoinGecko returns 429, stop all discovery for this period.
let coinGeckoRateLimitedUntil = 0;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Discover the CoinGecko coin ID for a Solana mint via the contract lookup endpoint.
 * Results are cached permanently in module scope.
 * Rate-limit aware: backs off for 5 minutes after a 429.
 */
async function discoverCoinGeckoIdForMint(mint: string): Promise<string | null> {
  if (solanaMintCoinGeckoIdCache.has(mint)) {
    return solanaMintCoinGeckoIdCache.get(mint)!;
  }

  // If we're in a rate-limit cooldown, skip discovery entirely
  if (Date.now() < coinGeckoRateLimitedUntil) {
    return null;
  }

  try {
    const url = `${getCoinGeckoBaseUrl()}/coins/solana/contract/${mint}`;
    const res = await fetch(url, {
      headers: getCoinGeckoHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      const id = data.id ?? null;
      solanaMintCoinGeckoIdCache.set(mint, id);
      return id;
    }
    if (res.status === 429) {
      // Rate limited — set cooldown so we stop hammering CoinGecko
      coinGeckoRateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      console.warn(`[token-prices] CoinGecko rate-limited during Solana ID discovery — backing off ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
      return null;
    }
  } catch {
    // Network error — don't cache
  }
  solanaMintCoinGeckoIdCache.set(mint, null);
  return null;
}

/**
 * Fetch current USD prices for Solana SPL tokens.
 *
 * Strategy:
 * 1. Discover CoinGecko IDs for each mint via contract lookup (cached permanently).
 * 2. Batch-fetch all discovered IDs in a single /simple/price call.
 *
 * The contract lookups only happen once per server lifecycle. Subsequent calls
 * (including after the 30-min price cache expires) reuse cached IDs.
 */
async function fetchSolanaTokenPrices(): Promise<Record<string, number | null>> {
  const mints = getSolanaTokenMints();
  if (mints.length === 0) return {};

  const result: Record<string, number | null> = {};
  for (const m of mints) result[m.mintLc] = null;

  // Skip mints that already have known CoinGecko IDs (e.g., USDC)
  const mintsNeedingDiscovery = mints.filter(
    (m) => !getCoinGeckoIdForAddress(m.mintLc)
  );

  // 1. Discover CoinGecko IDs (sequential with small delay to avoid rate limits;
  //    cached permanently after first run so subsequent calls skip this step)
  const idByMintLc = new Map<string, string>();
  // Also collect already-known IDs from the hardcoded mapping
  for (const m of mints) {
    const knownId = getCoinGeckoIdForAddress(m.mintLc);
    if (knownId) idByMintLc.set(m.mintLc, knownId);
  }
  for (let i = 0; i < mintsNeedingDiscovery.length; i++) {
    // Stop discovery loop if we hit rate limit mid-loop
    if (Date.now() < coinGeckoRateLimitedUntil) break;
    const m = mintsNeedingDiscovery[i]!;
    const id = await discoverCoinGeckoIdForMint(m.mint);
    if (id) idByMintLc.set(m.mintLc, id);
    // Small delay between lookups to stay within CoinGecko free-tier rate limits
    if (i < mintsNeedingDiscovery.length - 1 && !solanaMintCoinGeckoIdCache.has(m.mint)) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (idByMintLc.size === 0) return result;

  // 2. Batch-fetch prices using discovered IDs (single API call)
  const uniqueIds = [...new Set(idByMintLc.values())];
  const base = getCoinGeckoBaseUrl();
  const url = `${base}/simple/price?ids=${encodeURIComponent(uniqueIds.join(","))}&vs_currencies=usd`;

  try {
    const res = await fetch(url, {
      headers: getCoinGeckoHeaders(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (res.status === 429) {
        coinGeckoRateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      }
      console.warn("[token-prices] CoinGecko batch price fetch for Solana tokens failed", {
        status: res.status,
      });
      return result;
    }

    const data = (await res.json()) as CoinGeckoSimpleResponse;

    for (const [mintLc, coinId] of idByMintLc.entries()) {
      const usd = data[coinId]?.usd;
      if (typeof usd === "number" && Number.isFinite(usd)) {
        result[mintLc] = usd;
      }
    }
  } catch (e) {
    console.warn("[token-prices] CoinGecko Solana batch price error:", e);
  }

  return result;
}

function uniqLowerAddrs(addrs: string[]): string[] {
  const set = new Set<string>();
  for (const a of addrs) {
    const v = (a ?? "").trim().toLowerCase();
    if (!v) continue;
    set.add(v);
  }
  return [...set.values()];
}

async function fetchAllTokenAddressesFromIndexer(args: {
  chainId: number;
  v3Limit: number;
  v4Limit: number;
}): Promise<string[]> {
  const { chainId, v3Limit, v4Limit } = args;

  const [v3, v4] = await Promise.all([
    fetchWorldchainPools({
      chainId,
      protocol: "v3",
      limit: v3Limit,
    }),
    fetchWorldchainPools({
      chainId,
      protocol: "v4",
      limit: v4Limit,
    }),
  ]);

  const addrs: string[] = [];
  for (const p of v3) addrs.push(p.token0, p.token1);
  for (const p of v4) addrs.push(p.token0, p.token1);

  return uniqLowerAddrs(addrs);
}

async function fetchDefiLlamaPrices(args: {
  chain: string;
  addresses: string[];
  searchWidth?: string;
}): Promise<{
  pricesUsdByAddress: Record<string, number | null>;
  metaByCoinKey: Record<string, DefiLlamaCoin>;
}> {
  const { chain, addresses, searchWidth } = args;

  // Build coin keys for DefiLlama: prefer known `coingecko:<id>` mappings, else use `chain:address`.
  const addressByCoinKey = new Map<string, string[]>();
  const coinKeys: string[] = [];
  for (const addr of addresses) {
    const coinKey = DEFAULT_COIN_KEY_BY_ADDRESS[addr] ?? `${chain}:${addr}`;
    coinKeys.push(coinKey);
    const existing = addressByCoinKey.get(coinKey) ?? [];
    existing.push(addr);
    addressByCoinKey.set(coinKey, existing);
  }

  const base = getDefiLlamaBaseUrl();
  const maxCoins = getMaxCoinsPerRequest();

  // Free endpoint:
  // GET https://coins.llama.fi/prices/current/{coins}
  // where {coins} is a comma-separated list of coin keys.
  //
  // IMPORTANT: the `{coins}` list lives in the URL path, so it can get too long.
  // We chunk requests server-side to keep the frontend at a single request.
  const coinsObj: Record<string, DefiLlamaCoin | undefined> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < coinKeys.length; i += maxCoins) chunks.push(coinKeys.slice(i, i + maxCoins));

  for (const chunk of chunks) {
    const coinsSegment = chunk.map(encodeURIComponent).join(",");
    const url = `${base}/prices/current/${coinsSegment}` + (searchWidth ? `?searchWidth=${encodeURIComponent(searchWidth)}` : "");
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const preview = body.length > 600 ? `${body.slice(0, 600)}…` : body;
      console.warn("[token-prices] DefiLlama chunk fetch failed; returning partial results", {
        status: res.status,
        statusText: res.statusText,
        urlPrefix: `${base}/prices/current/...`,
        chunkSize: chunk.length,
        bodyPreview: preview || undefined,
      });
      continue;
    }

    const data = (await res.json()) as DefiLlamaResponse;
    const got = data.coins ?? {};
    for (const [k, v] of Object.entries(got)) coinsObj[k] = v;
  }

  const pricesUsdByAddress: Record<string, number | null> = {};
  const metaByCoinKey: Record<string, DefiLlamaCoin> = {};
  for (const addr of addresses) pricesUsdByAddress[addr] = null;

  for (const [coinKey, meta] of Object.entries(coinsObj)) {
    if (!meta) continue;
    metaByCoinKey[coinKey] = meta;
    const p = meta.price;
    const price = typeof p === "number" && Number.isFinite(p) ? p : null;

    // If we used a `coingecko:<id>` mapping, map back to the World Chain contract address(es).
    const mapped = addressByCoinKey.get(coinKey);
    if (mapped && mapped.length > 0) {
      for (const addr of mapped) pricesUsdByAddress[addr] = price;
      continue;
    }

    // Otherwise coinKey should be "chain:address" → extract and map.
    const parts = coinKey.split(":");
    const addr = parts.length >= 2 ? parts.slice(1).join(":") : "";
    const addrLc = addr.toLowerCase();
    if (addrLc) pricesUsdByAddress[addrLc] = price;
  }

  return { pricesUsdByAddress, metaByCoinKey };
}

async function fetchCoinGeckoPrices(args: {
  addresses: string[];
}): Promise<{
  pricesUsdByAddress: Record<string, number | null>;
  metaByCoinKey: Record<string, DefiLlamaCoin>;
}> {
  const { addresses } = args;
  const pricesUsdByAddress: Record<string, number | null> = {};
  const metaByCoinKey: Record<string, DefiLlamaCoin> = {};

  for (const addr of addresses) pricesUsdByAddress[addr] = null;

  // 1. Standard CoinGecko ID-based fetch (EVM tokens with known mappings)
  const idsByAddr = new Map<string, string>();
  for (const addr of addresses) {
    const id = getCoinGeckoIdForAddress(addr);
    if (id) idsByAddr.set(addr, id);
  }

  const ids = [...new Set(idsByAddr.values())];
  if (ids.length > 0) {
    const base = getCoinGeckoBaseUrl();
    const url = `${base}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
    const res = await fetch(url, {
      headers: getCoinGeckoHeaders(),
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const preview = body.length > 600 ? `${body.slice(0, 600)}…` : body;
      console.warn("[token-prices] CoinGecko fetch failed; returning null prices", {
        status: res.status,
        statusText: res.statusText,
        urlPrefix: `${base}/simple/price?...`,
        bodyPreview: preview || undefined,
      });
    } else {
      const data = (await res.json()) as CoinGeckoSimpleResponse;
      const nowSec = Math.floor(Date.now() / 1000);

      for (const [addr, id] of idsByAddr.entries()) {
        const usd = data[id]?.usd;
        const price = typeof usd === "number" && Number.isFinite(usd) ? usd : null;
        pricesUsdByAddress[addr] = price;
        if (price !== null) {
          metaByCoinKey[`coingecko:${id}`] = {
            price,
            timestamp: nowSec,
            confidence: 0.99,
          };
        }
      }
    }
  }

  // 2. Fetch Solana SPL token prices via contract address lookup.
  // This covers Raydium pool tokens (TSLAx, NVDAx, etc.) that don't have
  // hardcoded CoinGecko ID mappings.
  const solanaPrices = await fetchSolanaTokenPrices();
  for (const [addrLc, price] of Object.entries(solanaPrices)) {
    if (price !== null) {
      pricesUsdByAddress[addrLc] = price;
    }
  }

  return { pricesUsdByAddress, metaByCoinKey };
}

function parseAddressesParam(request: NextRequest): string[] {
  const raw = request.nextUrl.searchParams.get("addresses");
  if (!raw) return [];
  return uniqLowerAddrs(raw.split(","));
}

export async function GET(request: NextRequest) {
  if (isDemoRequest(request)) {
    return NextResponse.json(getDemoTokenPrices(), {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Token-Prices-Source": "demo-fixture",
      },
    });
  }

  const ttl = getCacheTTLms();
  const now = Date.now();
  if (cache && now - cache.timestamp < ttl) {
    return NextResponse.json(cache.payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 480);
  const chain = getChainSlugFromEnv();
  const baseUrl = getDefiLlamaBaseUrl();
  const pricingSource = "coingecko"; // Only CoinGecko is enabled

  const v3Limit = Number(request.nextUrl.searchParams.get("v3Limit") ?? "200");
  const v4Limit = Number(request.nextUrl.searchParams.get("v4Limit") ?? "200");
  const searchWidth = request.nextUrl.searchParams.get("searchWidth") ?? "4h";

  try {
    if (!chain) {
      throw new Error("Missing DEFILLAMA_CHAIN_SLUG (chain slug must prefix each address as 'chain:address').");
    }

    // Token selection priority:
    // 1) explicit addresses query param (useful for debugging)
    // 2) discovered from indexer pools
    // 3) fallback known World Chain tokens
    const fromQuery = parseAddressesParam(request);
    let addresses: string[] = fromQuery;
    let source: "query" | "indexer" | "fallback" = fromQuery.length ? "query" : "indexer";

    if (addresses.length === 0) {
      addresses = await fetchAllTokenAddressesFromIndexer({
        chainId,
        v3Limit: Number.isFinite(v3Limit) && v3Limit > 0 ? v3Limit : 200,
        v4Limit: Number.isFinite(v4Limit) && v4Limit > 0 ? v4Limit : 200,
      });
    }

    if (addresses.length === 0) {
      source = "fallback";
      addresses = [...WORLDCHAIN_FALLBACK_TOKEN_ADDRESSES];
      console.warn("[token-prices] Indexer pool discovery returned no tokens; using fallback token list", {
        chainId,
        chainSlug: chain,
        defillamaBaseUrl: baseUrl,
      });
    } else if (source === "indexer") {
      source = "indexer";
    }

    // Always include the known World Chain token list (first) so core pairs
    // have USD prices even if the indexer discovery returns a different token set.
    // This list also carries static BSC Perle and Katana tokens because those
    // indexers are routed by pool rather than included in the default discovery.
    // Also include Solana mint addresses from pool metadata so Raydium tokens are priced.
    const solanaMintAddrsLc = getSolanaTokenMints().map((m) => m.mintLc);
    addresses = uniqLowerAddrs([...WORLDCHAIN_FALLBACK_TOKEN_ADDRESSES, ...solanaMintAddrsLc, ...addresses]);

    const { pricesUsdByAddress, metaByCoinKey } =
      pricingSource === "coingecko"
        ? await fetchCoinGeckoPrices({ addresses })
        : await fetchDefiLlamaPrices({
            chain,
            addresses,
            searchWidth,
          });

    const payload: CachedPayload = {
      updatedAt: now,
      chain,
      tokenCount: addresses.length,
      pricesUsdByAddress,
      metaByCoinKey,
    };

    cache = { timestamp: now, payload };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Token-Prices-Source": source,
        "X-Token-Prices-Pricing": pricingSource,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[token-prices] Failed to fetch token prices", {
      message,
      chainId,
      chainSlug: chain,
      defillamaBaseUrl: baseUrl,
      v3Limit,
      v4Limit,
      searchWidth,
    });

    return NextResponse.json(
      {
        error: "Failed to fetch token prices",
        details: message,
        chainId,
        chainSlug: chain,
        defillamaBaseUrl: baseUrl,
      },
      { status: 502 }
    );
  }
}
