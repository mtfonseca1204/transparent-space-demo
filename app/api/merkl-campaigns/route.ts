import { NextRequest, NextResponse } from "next/server";

const MERKL_API_BASE = "https://api.merkl.xyz/v4";
const MERKL_FETCH_TIMEOUT_MS = 20_000;
const MERKL_PAGE_SIZE = 100;
const MERKL_MAX_PAGES = 20;

const KATANA_CHAIN_ID = "747474";

export interface MerklCampaignSummary {
  campaignId: string;
  opportunityId: string;
  type: string;
  subType: string | null;
  indexerStatus: string;
  startTimestamp: number;
  endTimestamp: number;
  amount: string;
  dailyRewards: number;
  apr: number;
  creatorAddress: string;
  distributionType: string;
  distributionChainId: number;
  computeChainId: number;
  rewardToken: {
    symbol: string;
    address: string;
    decimals: number;
    price: number | null;
  };
  createdAt: number | null;
}

export interface MerklCampaignsResponse {
  chainId: number;
  status: string;
  count: number;
  campaigns: MerklCampaignSummary[];
}

interface RawCampaign {
  campaignId?: string;
  opportunityId?: string;
  type?: string;
  subType?: string | null;
  campaignStatus?: { status?: string } | string;
  status?: string;
  startTimestamp?: number | string;
  endTimestamp?: number | string;
  amount?: string | number;
  dailyRewards?: number;
  apr?: number;
  creatorAddress?: string;
  distributionType?: string;
  distributionChainId?: number;
  computeChainId?: number;
  createdAt?: number | string;
  rewardToken?: {
    symbol?: string;
    address?: string;
    decimals?: number;
    price?: number | null;
  };
}

const cache = new Map<string, { timestamp: number; data: MerklCampaignsResponse }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function jsonWithCache(data: MerklCampaignsResponse, cacheStatus: "fresh" | "stale") {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "X-Merkl-Cache": cacheStatus,
    },
  });
}

function normalizeCampaign(raw: RawCampaign): MerklCampaignSummary {
  const statusRaw =
    typeof raw.campaignStatus === "object" && raw.campaignStatus
      ? raw.campaignStatus.status
      : (raw.campaignStatus as string | undefined) ?? raw.status;

  const tokenPrice =
    typeof raw.rewardToken?.price === "number" && Number.isFinite(raw.rewardToken.price)
      ? raw.rewardToken.price
      : null;

  return {
    campaignId: raw.campaignId ?? "",
    opportunityId: raw.opportunityId ?? "",
    type: raw.type ?? "",
    subType: raw.subType ?? null,
    indexerStatus: statusRaw ?? "UNKNOWN",
    startTimestamp: Number(raw.startTimestamp ?? 0),
    endTimestamp: Number(raw.endTimestamp ?? 0),
    amount: String(raw.amount ?? "0"),
    dailyRewards: Number(raw.dailyRewards ?? 0),
    apr: Number(raw.apr ?? 0),
    creatorAddress: raw.creatorAddress ?? "",
    distributionType: raw.distributionType ?? "",
    distributionChainId: Number(raw.distributionChainId ?? 0),
    computeChainId: Number(raw.computeChainId ?? 0),
    rewardToken: {
      symbol: raw.rewardToken?.symbol ?? "???",
      address: (raw.rewardToken?.address ?? "").toLowerCase(),
      decimals: Number(raw.rewardToken?.decimals ?? 18),
      price: tokenPrice,
    },
    createdAt: raw.createdAt != null ? Number(raw.createdAt) : null,
  };
}

async function fetchCampaignsPage(
  chainId: string,
  status: string,
  page: number,
): Promise<RawCampaign[]> {
  const url = `${MERKL_API_BASE}/campaigns?chainId=${encodeURIComponent(
    chainId,
  )}&status=${encodeURIComponent(status)}&items=${MERKL_PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(MERKL_FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Merkl campaigns fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as RawCampaign[];
  return Array.isArray(data) ? data : [];
}

export async function GET(request: NextRequest) {
  const chainId = request.nextUrl.searchParams.get("chainId") ?? KATANA_CHAIN_ID;
  const status = (request.nextUrl.searchParams.get("status") ?? "LIVE").toUpperCase();

  const cacheKey = `${chainId}:${status}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return jsonWithCache(cached.data, "fresh");
  }

  try {
    const collected: MerklCampaignSummary[] = [];
    for (let page = 0; page < MERKL_MAX_PAGES; page++) {
      const raw = await fetchCampaignsPage(chainId, status, page);
      if (raw.length === 0) break;
      for (const r of raw) collected.push(normalizeCampaign(r));
      if (raw.length < MERKL_PAGE_SIZE) break;
    }

    collected.sort((a, b) => b.dailyRewards - a.dailyRewards);

    const response: MerklCampaignsResponse = {
      chainId: Number(chainId),
      status,
      count: collected.length,
      campaigns: collected,
    };

    cache.set(cacheKey, { timestamp: Date.now(), data: response });
    return jsonWithCache(response, "fresh");
  } catch (err) {
    console.error("[merkl-campaigns] Error fetching campaigns:", err);
    if (cached) {
      return jsonWithCache(cached.data, "stale");
    }
    return NextResponse.json({ error: "Failed to fetch Merkl campaigns" }, { status: 502 });
  }
}
