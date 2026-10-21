import { NextRequest, NextResponse } from "next/server";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";
import { getDemoHistoricalPrices, isDemoRequest } from "@/lib/demo/fixtures";

// ============================================================================
// TYPES
// ============================================================================

export type OracleSource = "coingecko";

type PricePoint = {
  timestamp: number; // Unix seconds
  price: number;
};

type CachedData = {
  fetchedAt: number;
  data: PricePoint[];
};

// ============================================================================
// IN-MEMORY CACHE (5-minute TTL)
// ============================================================================

const cache = new Map<string, CachedData>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(source: OracleSource, tokenAddress: string, startTime: number, endTime: number): string {
  // Round times to hour boundaries for better cache hits
  const startHour = Math.floor(startTime / 3600) * 3600;
  const endHour = Math.ceil(endTime / 3600) * 3600;
  return `${source}:${tokenAddress.toLowerCase()}:${startHour}:${endHour}`;
}

function getCached(key: string): PricePoint[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: PricePoint[]): void {
  cache.set(key, { fetchedAt: Date.now(), data });
  // Prune old entries (keep cache from growing unbounded)
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.fetchedAt > CACHE_TTL_MS) cache.delete(k);
    }
  }
}

// ============================================================================
// DEFILLAMA FETCHER
// ============================================================================

// Known token address -> coingecko ID mappings (same as token-prices route)
const COINGECKO_ID_BY_ADDRESS: Record<string, string> = {
  "0x79a02482a880bce3f13e09da970dc34db4cd24d1": "usd-coin",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "usd-coin",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "tether",
  "0x0000000000000000000000000000000000000000": "ethereum",
  "0x4d7078ddd6ccfed2f85db5b7d3ff16828d378d48": "gensyn",
  "0x55d398326f99059ff775485246999027b3197955": "tether",
  "0xd20fb09a49a8e75fef536a2dbc68222900287bac": "perle",
  "0x4b948d64de1f71fcd12fb586f4c776421a35b3ee": "wrapped-0g",
  "0x754704bc059f8c67012fed69bc8a327a5aafb603": "usd-coin",
  "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e": "usd-coin",
  "0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c": "wrapped-0g",
  "0x4200000000000000000000000000000000000006": "weth",
  "0x2cfc85d8e48f8eab294be644d9e25c3030863003": "worldcoin-wld",
  "0x1c60ba0a0ed1019e8eb035e6daf4155a5ce2380b": "euro-coin", // EURC
};

async function fetchDefiLlama(
  tokenAddress: string,
  startTime: number,
  endTime: number
): Promise<PricePoint[]> {
  const chain = (process.env.DEFILLAMA_CHAIN_SLUG ?? "world-chain").trim();
  const baseUrl = (process.env.DEFILLAMA_BASE_URL ?? "https://coins.llama.fi").trim().replace(/\/+$/, "");
  
  // Try coingecko ID first if we have a mapping
  const addrLc = tokenAddress.toLowerCase();
  const cgId = COINGECKO_ID_BY_ADDRESS[addrLc];
  const coinKey = cgId ? `coingecko:${cgId}` : `${chain}:${addrLc}`;
  
  // DefiLlama chart endpoint: /chart/{coins}?start={timestamp}&span={hours}
  // Returns hourly prices
  const spanHours = Math.ceil((endTime - startTime) / 3600);
  const url = `${baseUrl}/chart/${encodeURIComponent(coinKey)}?start=${startTime}&span=${spanHours}`;
  
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 }, // Next.js cache for 5 min
  });
  
  if (!res.ok) {
    console.warn(`[historical-prices] DefiLlama fetch failed: ${res.status} ${res.statusText}`);
    return [];
  }
  
  const data = await res.json() as {
    coins?: Record<string, { prices?: Array<{ timestamp: number; price: number }> }>;
  };
  
  const prices = data.coins?.[coinKey]?.prices ?? [];
  
  return prices
    .filter((p) => p.timestamp >= startTime && p.timestamp <= endTime)
    .map((p) => ({ timestamp: p.timestamp, price: p.price }));
}

// ============================================================================
// COINGECKO FETCHER
// ============================================================================

// Detect Solana base58 addresses (case-sensitive, no 0x prefix)
function isSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

async function fetchCoinGecko(
  tokenAddress: string,
  startTime: number,
  endTime: number
): Promise<PricePoint[]> {
  const isSolana = isSolanaAddress(tokenAddress);
  // Solana addresses are case-sensitive; EVM addresses are lowercased
  const addrNorm = isSolana ? tokenAddress : tokenAddress.toLowerCase();

  // First try to get the coin ID from our mapping
  let coinId = COINGECKO_ID_BY_ADDRESS[addrNorm];

  if (!coinId) {
    // Try to look up by contract address
    const platform = isSolana
      ? "solana"
      : (process.env.NEXT_PUBLIC_COINGECKO_PLATFORM_ID ?? "world-chain").trim();
    const lookupUrl = `${getCoinGeckoBaseUrl()}/coins/${platform}/contract/${addrNorm}`;

    try {
      const lookupRes = await fetch(lookupUrl, {
        headers: getCoinGeckoHeaders(),
      });
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json() as { id?: string };
        if (lookupData.id) {
          coinId = lookupData.id;
        }
      }
    } catch {
      // Lookup failed, will return empty
    }
  }

  if (!coinId) {
    // If tokenAddress looks like a coin ID (no 0x prefix, no base58), try it directly
    if (!tokenAddress.startsWith("0x") && !isSolanaAddress(tokenAddress)) {
      coinId = addrNorm;
    } else {
      console.warn(`[historical-prices] CoinGecko: No coin ID found for ${tokenAddress}`);
      return [];
    }
  }

  // Fetch market chart range
  const url = `${getCoinGeckoBaseUrl()}/coins/${coinId}/market_chart/range?vs_currency=usd&from=${startTime}&to=${endTime}`;

  const res = await fetch(url, {
    headers: getCoinGeckoHeaders(),
  });
  
  if (!res.ok) {
    if (res.status === 429) {
      console.warn(`[historical-prices] CoinGecko rate limited`);
    } else {
      console.warn(`[historical-prices] CoinGecko fetch failed: ${res.status} ${res.statusText}`);
    }
    return [];
  }
  
  const data = await res.json() as {
    prices?: Array<[number, number]>; // [timestamp_ms, price]
  };
  
  const prices = data.prices ?? [];
  
  return prices.map(([tsMs, price]) => ({
    timestamp: Math.floor(tsMs / 1000),
    price,
  }));
}

// ============================================================================
// PYTH FETCHER (Limited token support)
// ============================================================================

// Pyth price feed IDs for supported tokens
// See: https://pyth.network/developers/price-feed-ids
const PYTH_FEED_IDS: Record<string, string> = {
  // ETH/USD
  "0x4200000000000000000000000000000000000006": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  // WLD/USD (if available)
  "0x2cfc85d8e48f8eab294be644d9e25c3030863003": "0xd6835ad1f773571853eb8b2dec94236eac1be9285b0d7d2f1f5531295c4b74a3",
};

async function fetchPyth(
  tokenAddress: string,
  startTime: number,
  endTime: number
): Promise<PricePoint[]> {
  const addrLc = tokenAddress.toLowerCase();
  const feedId = PYTH_FEED_IDS[addrLc];
  
  if (!feedId) {
    console.warn(`[historical-prices] Pyth: No feed ID for ${tokenAddress}`);
    return [];
  }
  
  // Pyth Hermes provides historical prices via benchmarks endpoint
  // Note: Historical data access may be limited on free tier
  const hermesUrl = "https://hermes.pyth.network";
  
  try {
    // Get current price as a starting point (Pyth historical is complex)
    const url = `${hermesUrl}/v2/updates/price/latest?ids[]=${feedId}`;
    
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    
    if (!res.ok) {
      console.warn(`[historical-prices] Pyth fetch failed: ${res.status}`);
      return [];
    }
    
    const data = await res.json() as {
      parsed?: Array<{
        price?: { price: string; expo: number };
        ema_price?: { price: string; expo: number };
      }>;
    };
    
    const parsed = data.parsed?.[0];
    if (!parsed?.price) return [];
    
    const price = Number(parsed.price.price) * Math.pow(10, parsed.price.expo);
    const now = Math.floor(Date.now() / 1000);
    
    // Pyth Hermes doesn't easily provide historical data via REST
    // Return current price as a single point (UI will show limitation)
    return [{ timestamp: now, price }];
  } catch (e) {
    console.warn(`[historical-prices] Pyth error:`, e);
    return [];
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  
  const source = "coingecko" as OracleSource; // Only CoinGecko is enabled
  const tokenAddress = searchParams.get("tokenAddress") ?? "";
  const startTime = Number(searchParams.get("startTime") ?? 0);
  const endTime = Number(searchParams.get("endTime") ?? Math.floor(Date.now() / 1000));
  
  if (!tokenAddress) {
    return NextResponse.json(
      { error: "Missing tokenAddress parameter" },
      { status: 400 }
    );
  }

  if (isDemoRequest(request)) {
    return NextResponse.json(
      getDemoHistoricalPrices({ tokenAddress, startTime, endTime }),
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "X-Source": "demo-fixture",
        },
      }
    );
  }
  
  // DEX TWAP is computed client-side from existing candle data
  if (source === "dex-twap") {
    return NextResponse.json({
      source: "dex-twap",
      tokenAddress,
      prices: [], // Empty = use client-side SMA computation
      message: "DEX TWAP is computed client-side from indexed swap data",
    });
  }
  
  // Check cache
  const cacheKey = getCacheKey(source, tokenAddress, startTime, endTime);
  const cached = getCached(cacheKey);
  
  if (cached) {
    return NextResponse.json({
      source,
      tokenAddress,
      prices: cached,
      cached: true,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  }
  
  // Fetch from CoinGecko only
  let prices: PricePoint[] = [];
  
  try {
    prices = await fetchCoinGecko(tokenAddress, startTime, endTime);
  } catch (e) {
    console.error(`[historical-prices] Error fetching from CoinGecko:`, e);
    // Return empty if fetch fails
  }
  
  // Cache result
  if (prices.length > 0) {
    setCache(cacheKey, prices);
  }
  
  return NextResponse.json({
    source,
    tokenAddress,
    prices,
    cached: false,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
