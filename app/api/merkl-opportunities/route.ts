import { NextRequest, NextResponse } from "next/server";

const MERKL_API_BASE = "https://api.merkl.xyz/v4";
const MERKL_FETCH_TIMEOUT_MS = 20_000;

type FallbackCampaignSeed = {
  campaignId: string;
  start: string;
  end: string;
  rewardToken: {
    symbol: string;
    address: string;
    decimals: number;
    price: number | null;
  };
  dailyRewardTokens: number;
  dailyRewardUsd: number;
};

// Known token address -> coingecko ID for DefiLlama historical prices
const DEFILLAMA_COIN_KEYS: Record<string, string> = {
  "0x2cfc85d8e48f8eab294be644d9e25c3030863003": "coingecko:worldcoin-wld",
  "0x4200000000000000000000000000000000000006": "coingecko:weth",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "coingecko:weth",
};

interface DailyPrice {
  timestamp: number;
  price: number;
}

/** Fetch daily historical prices from DefiLlama for a token over a time range. */
async function fetchHistoricalPrices(
  tokenAddress: string,
  startTs: number,
  endTs: number,
): Promise<DailyPrice[]> {
  const addrLc = tokenAddress.toLowerCase();
  const coinKey = DEFILLAMA_COIN_KEYS[addrLc] ?? `world-chain:${addrLc}`;
  // Use daily granularity (span = number of days, period = 1d), max 500 points
  const spanDays = Math.min(500, Math.ceil((endTs - startTs) / 86400));
  const url = `https://coins.llama.fi/chart/${encodeURIComponent(coinKey)}?start=${startTs}&span=${spanDays}&period=1d`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      coins?: Record<string, { prices?: Array<{ timestamp: number; price: number }> }>;
    };
    return data.coins?.[coinKey]?.prices ?? [];
  } catch {
    return [];
  }
}

async function fetchHistoricalPricesCached(
  tokenAddress: string,
  startTs: number,
  endTs: number,
): Promise<DailyPrice[]> {
  const cacheKey = `${tokenAddress.toLowerCase()}:${startTs}:${endTs}`;
  const cached = priceHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PRICE_HISTORY_CACHE_TTL_MS) {
    return cached.data;
  }

  const prices = await fetchHistoricalPrices(tokenAddress, startTs, endTs);
  if (prices.length > 0) {
    priceHistoryCache.set(cacheKey, { timestamp: Date.now(), data: prices });
  }
  return prices;
}

/**
 * Compute the total USD spent for a campaign using historical daily prices.
 * For each day in the campaign, uses the closest available price point.
 * Falls back to currentPrice * dailyTokens * days if no historical data.
 */
function computeTotalSpentUsd(
  dailyTokens: number,
  startTs: number,
  endTs: number,
  currentPrice: number,
  historicalPrices: DailyPrice[],
): number {
  const durationDays = (endTs - startTs) / 86400;
  if (durationDays <= 0 || dailyTokens <= 0) return 0;

  if (historicalPrices.length === 0) {
    return dailyTokens * currentPrice * durationDays;
  }

  // Sort prices by timestamp
  const sorted = [...historicalPrices].sort((a, b) => a.timestamp - b.timestamp);

  let totalUsd = 0;
  const now = Math.floor(Date.now() / 1000);
  const effectiveEnd = Math.min(endTs, now); // Don't count future days

  for (let dayStart = startTs; dayStart < effectiveEnd; dayStart += 86400) {
    // Find closest price point to this day
    let bestPrice = currentPrice;
    let bestDist = Infinity;
    for (const p of sorted) {
      const dist = Math.abs(p.timestamp - dayStart);
      if (dist < bestDist) {
        bestDist = dist;
        bestPrice = p.price;
      }
      // Once we're past the day and getting further away, stop
      if (p.timestamp > dayStart && dist > bestDist) break;
    }
    totalUsd += dailyTokens * bestPrice;
  }

  return totalUsd;
}

function getObservedDurationDays(startTs: number, endTs: number): number {
  const now = Math.floor(Date.now() / 1000);
  const effectiveEnd = Math.min(endTs, now);
  return effectiveEnd > startTs ? (effectiveEnd - startTs) / 86400 : 0;
}

// Price history cache (per token address, long TTL since historical data doesn't change)
const priceHistoryCache = new Map<string, { timestamp: number; data: DailyPrice[] }>();
const PRICE_HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface MerklCampaign {
  campaignId: string;
  amount: string;
  startTimestamp: number;
  endTimestamp: number;
  rewardToken: {
    symbol: string;
    address: string;
    decimals: number;
    price: number | null;
  };
  /** Computed daily reward in human-readable token units */
  dailyRewardTokens: number;
  /** Average daily reward in USD over observed days, using historical prices when available */
  dailyRewardUsd: number;
  /** Total USD spent in the campaign using historical daily prices */
  totalSpentUsd: number;
  /** Historical token prices (one per day) so the client can compute per-day USD */
  historicalPrices: Array<{ timestamp: number; price: number }>;
}

export interface MerklOpportunity {
  chainId: number;
  identifier: string;
  name: string;
  status: string;
  tvl: number;
  apr: number;
  dailyRewards: number;
  liveCampaigns: number;
  tokens: Array<{
    symbol: string;
    address: string;
    decimals: number;
    price: number | null;
  }>;
  campaigns: MerklCampaign[];
}

type FallbackOpportunity = Omit<MerklOpportunity, "identifier" | "chainId" | "campaigns"> & {
  identifiers: string[];
  campaignSeeds: FallbackCampaignSeed[];
};

const FALLBACK_MERKL_OPPORTUNITIES: Record<string, FallbackOpportunity> = {
  "weth-usdc-worldchain": {
    identifiers: ["0x5f835420502a7702de50cd0e78d8aa3608b2137e"],
    name: "Provide liquidity to UniswapV3 WETH-USDC.e 0.05%",
    status: "PAST",
    tvl: 536875.0881562614,
    apr: 0,
    dailyRewards: 0,
    liveCampaigns: 0,
    tokens: [
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
      { symbol: "USDC.e", address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", decimals: 6, price: 0.999960460611718 },
      { symbol: "WLD", address: "0x2cfc85d8e48f8eab294be644d9e25c3030863003", decimals: 18, price: 0.3959935701834887 },
    ],
    campaignSeeds: [
      {
        campaignId: "fallback-weth-usdc-2024-10-12-weth",
        start: "2024-10-12",
        end: "2024-12-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.099668,
        dailyRewardUsd: 232.44,
      },
      {
        campaignId: "fallback-weth-usdc-2024-12-31-weth",
        start: "2024-12-31",
        end: "2025-01-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.070782,
        dailyRewardUsd: 165.08,
      },
      {
        campaignId: "fallback-weth-usdc-2025-01-31-weth",
        start: "2025-01-31",
        end: "2025-02-28",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.103929,
        dailyRewardUsd: 242.38,
      },
      {
        campaignId: "fallback-weth-usdc-2025-02-28-weth",
        start: "2025-02-28",
        end: "2025-03-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.10183,
        dailyRewardUsd: 237.48,
      },
      {
        campaignId: "fallback-weth-usdc-2025-05-13-wld",
        start: "2025-05-13",
        end: "2025-11-12",
        rewardToken: { symbol: "WLD", address: "0x2cfc85d8e48f8eab294be644d9e25c3030863003", decimals: 18, price: 0.3959935701834887 },
        dailyRewardTokens: 1417.036335,
        dailyRewardUsd: 561.14,
      },
    ],
  },
  "wbtc-usdc-worldchain": {
    identifiers: ["0xdce053d9ba0fa2c5f772416b64f191158cbcc32e"],
    name: "Provide liquidity to UniswapV3 WBTC-USDC.e 0.05%",
    status: "PAST",
    tvl: 492300,
    apr: 0,
    dailyRewards: 0,
    liveCampaigns: 0,
    tokens: [
      { symbol: "WBTC", address: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3", decimals: 8, price: null },
      { symbol: "USDC.e", address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", decimals: 6, price: 0.999960460611718 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
    ],
    campaignSeeds: [
      {
        campaignId: "fallback-wbtc-usdc-2024-10-12-weth",
        start: "2024-10-12",
        end: "2024-12-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.099547,
        dailyRewardUsd: 232.16,
      },
      {
        campaignId: "fallback-wbtc-usdc-2024-12-31-weth",
        start: "2024-12-31",
        end: "2025-01-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.070783,
        dailyRewardUsd: 165.08,
      },
      {
        campaignId: "fallback-wbtc-usdc-2025-01-31-weth",
        start: "2025-01-31",
        end: "2025-02-28",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.103929,
        dailyRewardUsd: 242.38,
      },
      {
        campaignId: "fallback-wbtc-usdc-2025-02-28-weth",
        start: "2025-02-28",
        end: "2025-03-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.10183,
        dailyRewardUsd: 237.48,
      },
      {
        campaignId: "fallback-wbtc-usdc-2025-04-08-weth",
        start: "2025-04-08",
        end: "2025-07-31",
        rewardToken: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, price: 2321.621022333768 },
        dailyRewardTokens: 0.144649,
        dailyRewardUsd: 337.34,
      },
    ],
  },
};

async function buildFallbackOpportunity(identifier: string, chainId: string): Promise<MerklOpportunity | null> {
  const idLc = identifier.toLowerCase();
  const match = Object.values(FALLBACK_MERKL_OPPORTUNITIES).find((entry) =>
    entry.identifiers.some((candidate) => candidate.toLowerCase() === idLc),
  );
  if (!match) return null;

  const campaigns: MerklCampaign[] = await Promise.all(
    match.campaignSeeds.map(async (seed) => {
      const startTimestamp = Math.floor(new Date(`${seed.start}T00:00:00Z`).getTime() / 1000);
      const endTimestamp = Math.floor(new Date(`${seed.end}T00:00:00Z`).getTime() / 1000);
      const durationDays = getObservedDurationDays(startTimestamp, endTimestamp);
      const priceSeries = await fetchHistoricalPricesCached(
        seed.rewardToken.address,
        startTimestamp,
        endTimestamp,
      );
      const historicalPrices = priceSeries
        .filter((point) => point.timestamp >= startTimestamp && point.timestamp <= endTimestamp)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((point) => ({ timestamp: point.timestamp, price: point.price }));
      const totalSpentUsd =
        historicalPrices.length > 0
          ? computeTotalSpentUsd(
              seed.dailyRewardTokens,
              startTimestamp,
              endTimestamp,
              seed.rewardToken.price ?? 0,
              historicalPrices,
            )
          : seed.dailyRewardUsd * durationDays;

      return {
        campaignId: seed.campaignId,
        amount: "0",
        startTimestamp,
        endTimestamp,
        rewardToken: seed.rewardToken,
        dailyRewardTokens: seed.dailyRewardTokens,
        dailyRewardUsd:
          durationDays > 0 && totalSpentUsd > 0
            ? totalSpentUsd / durationDays
            : seed.dailyRewardUsd,
        totalSpentUsd,
        historicalPrices,
      };
    }),
  );

  campaigns.sort((a, b) => b.startTimestamp - a.startTimestamp);

  return {
    chainId: Number(chainId),
    identifier,
    name: match.name,
    status: match.status,
    tvl: match.tvl,
    apr: match.apr,
    dailyRewards: match.dailyRewards,
    liveCampaigns: match.liveCampaigns,
    tokens: match.tokens,
    campaigns,
  };
}

// In-memory cache per pool identifier
const cache = new Map<string, { timestamp: number; data: MerklOpportunity }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function jsonWithCache(data: MerklOpportunity, cacheStatus: "fresh" | "stale" = "fresh") {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "X-Merkl-Cache": cacheStatus,
    },
  });
}

export async function GET(request: NextRequest) {
  const identifier = request.nextUrl.searchParams.get("identifier");
  const chainId = request.nextUrl.searchParams.get("chainId") ?? "480";

  if (!identifier) {
    return NextResponse.json({ error: "Missing identifier param" }, { status: 400 });
  }

  const cacheKey = `${chainId}:${identifier.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return jsonWithCache(cached.data, "fresh");
  }

  try {
    // Fetch opportunity with campaigns
    const url = `${MERKL_API_BASE}/opportunities?chainId=${chainId}&identifier=${encodeURIComponent(identifier)}&items=1&campaigns=true`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(MERKL_FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(`[merkl] Fetch failed: ${res.status}`);
      if (cached) {
        return jsonWithCache(cached.data, "stale");
      }
      const fallback = await buildFallbackOpportunity(identifier, chainId);
      if (fallback) {
        return jsonWithCache(fallback, "stale");
      }
      return NextResponse.json({ error: "Merkl API error" }, { status: 502 });
    }

    const data = await res.json();

    // The response is an array; take the first match
    const raw = Array.isArray(data) ? data[0] : data;
    if (!raw) {
      return NextResponse.json({ error: "No opportunity found" }, { status: 404 });
    }

    // Parse campaigns (first pass: extract token info and daily rates)
    const rawCampaigns = raw.campaigns ?? [];
    interface ParsedCampaign {
      campaignId: string;
      amount: string;
      startTs: number;
      endTs: number;
      decimals: number;
      symbol: string;
      address: string;
      tokenPrice: number;
      dailyTokens: number;
      dailyUsd: number;
    }
    const parsed: ParsedCampaign[] = [];
    const tokenTimeRanges = new Map<string, { minStart: number; maxEnd: number }>();

    for (const c of rawCampaigns) {
      const startTs = Number(c.startTimestamp ?? 0);
      const endTs = Number(c.endTimestamp ?? 0);
      const durationSec = endTs - startTs;
      const durationDays = durationSec > 0 ? durationSec / 86400 : 0;

      const decimals = Number(c.rewardToken?.decimals ?? 18);
      const rawAmount = c.amount ?? "0";
      const amountNum = typeof rawAmount === "string" ? Number(rawAmount) : rawAmount;
      const humanAmount = amountNum / 10 ** decimals;
      const dailyTokens = durationDays > 0 ? humanAmount / durationDays : 0;
      const tokenPrice = Number(c.rewardToken?.price ?? 0);
      const dailyUsd = dailyTokens * tokenPrice;
      const address = (c.rewardToken?.address ?? "").toLowerCase();

      parsed.push({
        campaignId: c.campaignId ?? c.id ?? "",
        amount: String(rawAmount),
        startTs,
        endTs,
        decimals,
        symbol: c.rewardToken?.symbol ?? "???",
        address,
        tokenPrice,
        dailyTokens,
        dailyUsd,
      });

      // Track the full time range needed per token for historical price fetch
      if (address && startTs > 0 && endTs > startTs) {
        const existing = tokenTimeRanges.get(address);
        if (existing) {
          existing.minStart = Math.min(existing.minStart, startTs);
          existing.maxEnd = Math.max(existing.maxEnd, endTs);
        } else {
          tokenTimeRanges.set(address, { minStart: startTs, maxEnd: endTs });
        }
      }
    }

    // Fetch historical prices for each unique reward token (in parallel)
    const historicalPriceMap = new Map<string, DailyPrice[]>();
    await Promise.all(
      [...tokenTimeRanges.entries()].map(async ([address, range]) => {
        const cacheKey = `${address}:${range.minStart}:${range.maxEnd}`;
        const cached2 = priceHistoryCache.get(cacheKey);
        if (cached2 && Date.now() - cached2.timestamp < PRICE_HISTORY_CACHE_TTL_MS) {
          historicalPriceMap.set(address, cached2.data);
          return;
        }
        const prices = await fetchHistoricalPrices(address, range.minStart, range.maxEnd);
        historicalPriceMap.set(address, prices);
        if (prices.length > 0) {
          priceHistoryCache.set(cacheKey, { timestamp: Date.now(), data: prices });
        }
      }),
    );

    // Build final campaigns with totalSpentUsd and historical average $/day.
    const campaigns: MerklCampaign[] = parsed.map((p) => {
      const historicalPrices = (historicalPriceMap.get(p.address) ?? [])
        .filter((hp) => hp.timestamp >= p.startTs && hp.timestamp <= p.endTs)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((hp) => ({ timestamp: hp.timestamp, price: hp.price }));
      const totalSpentUsd = computeTotalSpentUsd(
        p.dailyTokens,
        p.startTs,
        p.endTs,
        p.tokenPrice,
        historicalPriceMap.get(p.address) ?? [],
      );
      const observedDurationDays = getObservedDurationDays(p.startTs, p.endTs);

      return {
        campaignId: p.campaignId,
        amount: p.amount,
        startTimestamp: p.startTs,
        endTimestamp: p.endTs,
        rewardToken: {
          symbol: p.symbol,
          address: p.address,
          decimals: p.decimals,
          price: p.tokenPrice > 0 ? p.tokenPrice : null,
        },
        dailyRewardTokens: p.dailyTokens,
        dailyRewardUsd:
          observedDurationDays > 0 && totalSpentUsd > 0
            ? totalSpentUsd / observedDurationDays
            : p.dailyUsd,
        totalSpentUsd,
        historicalPrices,
      };
    });

    // Sort campaigns by start time descending (newest first)
    campaigns.sort((a, b) => b.startTimestamp - a.startTimestamp);

    const opportunity: MerklOpportunity = {
      chainId: Number(chainId),
      identifier: raw.identifier ?? identifier,
      name: raw.name ?? "",
      status: raw.status ?? "UNKNOWN",
      tvl: Number(raw.tvl ?? 0),
      apr: Number(raw.apr ?? 0),
      dailyRewards: Number(raw.dailyRewards ?? 0),
      liveCampaigns: Number(raw.liveCampaigns ?? 0),
      tokens: (raw.tokens ?? []).map((t: Record<string, unknown>) => ({
        symbol: t.symbol ?? "",
        address: t.address ?? "",
        decimals: Number(t.decimals ?? 18),
        price: typeof t.price === "number" ? t.price : null,
      })),
      campaigns,
    };

    cache.set(cacheKey, { timestamp: Date.now(), data: opportunity });

    return jsonWithCache(opportunity, "fresh");
  } catch (err) {
    console.error("[merkl] Error fetching opportunity:", err);
    if (cached) {
      return jsonWithCache(cached.data, "stale");
    }
    const fallback = await buildFallbackOpportunity(identifier, chainId);
    if (fallback) {
      return jsonWithCache(fallback, "stale");
    }
    return NextResponse.json({ error: "Failed to fetch Merkl data" }, { status: 502 });
  }
}
