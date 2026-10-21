import { NextRequest, NextResponse } from "next/server";

const MERKL_API_BASE = "https://api.merkl.xyz/v4";
const MERKL_FETCH_TIMEOUT_MS = 20_000;
const REWARDS_PAGE_SIZE = 100;
const REWARDS_MAX_PAGES = 50;
const REWARDS_PAGE_BATCH_SIZE = 8;
const DEFAULT_RECIPIENT_LIMIT = 50;
const MAX_RECIPIENT_LIMIT = 500;

const KATANA_CHAIN_ID = "747474";
const KATANA_INDEXER_API_URL =
  process.env.KATANA_INDEXER_API_URL ?? "https://indexer-katana-api-production.up.railway.app";

interface RawReward {
  recipient?: string;
  amount?: string;
  claimed?: string;
  pending?: string;
  reason?: string;
  rewardTokenAddress?: string;
}

interface RawCampaign {
  id?: string;
  campaignId?: string;
  amount?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  dailyRewards?: number;
  apr?: number;
  creatorAddress?: string;
  opportunityId?: string;
  rewardToken?: {
    symbol?: string;
    address?: string;
    decimals?: number;
    price?: number | null;
  };
  creator?: { name?: string; address?: string } | null;
}

interface RawOpportunity {
  id?: string;
  identifier?: string;
  name?: string;
  status?: string;
  tvl?: number;
  apr?: number;
  dailyRewards?: number;
  liveCampaigns?: number;
  type?: string;
  action?: string;
  explorerAddress?: string;
  tokens?: Array<{ symbol?: string; address?: string; decimals?: number; price?: number | null }>;
}

export interface CampaignRecipient {
  recipient: string;
  totalAmount: string;
  totalAmountTokens: number;
  totalAmountUsd: number;
  claimedAmount: string;
  claimedAmountTokens: number;
  pendingAmount: string;
  pendingAmountTokens: number;
  positions: number;
  positionIds: string[];
  shareOfCampaignPct: number;
}

/**
 * One reward row from Merkl, kept ungrouped so the UI can present a per-LP-
 * position ranking that matches Merkl's own table (same wallet can occupy
 * multiple ranks when it holds several positions).
 */
export interface CampaignPositionRow {
  rank: number;
  recipient: string;
  positionId: string | null;
  amount: string;
  amountTokens: number;
  amountUsd: number;
  claimedAmount: string;
  claimedAmountTokens: number;
  pendingAmount: string;
  pendingAmountTokens: number;
  shareOfCampaignPct: number;
  /** Free-form source label parsed from the reward reason (e.g. "SUSHI"). */
  source: string | null;
  /** Wrapper contract that owns the position on-chain (e.g. SushiStaker). */
  wrapperAddress: string | null;
}

export interface CampaignRecipientsResponse {
  chainId: number;
  campaign: {
    campaignId: string;
    opportunityId: string;
    startTimestamp: number;
    endTimestamp: number;
    dailyRewards: number;
    apr: number;
    creatorAddress: string;
    budgetTokens: number;
    rewardToken: {
      symbol: string;
      address: string;
      decimals: number;
      price: number | null;
    };
  };
  pool: {
    name: string;
    identifier: string;
    type: string;
    action: string;
    status: string;
    tvlUsd: number;
    aprPct: number;
    dailyRewardsUsd: number;
    explorerAddress: string;
    tokens: Array<{ symbol: string; address: string; decimals: number; price: number | null }>;
  };
  totals: {
    recipientCount: number;
    distributedTokens: number;
    distributedUsd: number;
    unclaimedTokens: number;
    unclaimedUsd: number;
    claimedTokens: number;
    claimedUsd: number;
  };
  recipients: CampaignRecipient[];
  recipientsReturned: number;
  recipientsTruncated: boolean;
  /** Ungrouped per-position reward rows (sorted desc by amount). */
  positionRows: CampaignPositionRow[];
  positionRowsTotal: number;
  /**
   * Contract addresses that own positions on behalf of LPs (e.g. SushiStaker).
   * The TVL chart merges these into the "campaign LP" bucket so positions
   * wrapped by these contracts aren't miscategorised as "other LPs".
   */
  wrapperAddresses: string[];
  fetchedAt: number;
}

const cache = new Map<string, { timestamp: number; data: CampaignRecipientsResponse }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function jsonWithCache(data: CampaignRecipientsResponse, cacheStatus: "fresh" | "stale") {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "X-Merkl-Cache": cacheStatus,
    },
  });
}

async function proxyKatanaCampaignRecipients(
  request: NextRequest,
): Promise<NextResponse<CampaignRecipientsResponse> | null> {
  const upstreamUrl = new URL("/api/merkl/campaign-recipients", KATANA_INDEXER_API_URL);
  request.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });
  if (!upstreamUrl.searchParams.has("chainId")) {
    upstreamUrl.searchParams.set("chainId", KATANA_CHAIN_ID);
  }

  try {
    const res = await fetch(upstreamUrl, {
      signal: AbortSignal.timeout(MERKL_FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[merkl-campaign-recipients] Katana API proxy failed:", res.status);
      return null;
    }
    const data = (await res.json()) as CampaignRecipientsResponse;
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": res.headers.get("Cache-Control") ?? "public, s-maxage=300, stale-while-revalidate=600",
        "X-Merkl-Cache": res.headers.get("X-Merkl-Cache") ?? "proxy",
      },
    });
  } catch (err) {
    console.warn("[merkl-campaign-recipients] Katana API proxy error:", err);
    return null;
  }
}

async function merklFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${MERKL_API_BASE}${path}`, {
    signal: AbortSignal.timeout(MERKL_FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Merkl ${path} → ${res.status}`);
  return (await res.json()) as T;
}

function parseRecipientLimit(raw: string | null): number {
  if (raw === "all") return MAX_RECIPIENT_LIMIT;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RECIPIENT_LIMIT;
  return Math.min(parsed, MAX_RECIPIENT_LIMIT);
}

function toFloat(raw: string | number | undefined, decimals: number): number {
  if (raw == null) return 0;
  try {
    const big = typeof raw === "string" ? BigInt(raw) : BigInt(Math.trunc(raw));
    const denom = 10n ** BigInt(decimals);
    const whole = big / denom;
    const frac = big % denom;
    return Number(whole) + Number(frac) / Number(denom);
  } catch {
    return 0;
  }
}

function extractPositionId(reason: string): string | null {
  const head = reason.split("~")[0] ?? "";
  const parts = head.split("_");
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : null;
}

/**
 * Pull the first non-pool 0x-address out of the reward reason. For Sushi V3
 * positions held in SushiStaker the reason looks like:
 *   SUSHI_SWAP_<pool>_<id>~<...>_SUSHI_STAKER_<wrapperAddr>_<id>
 * so anything that isn't the pool address (and isn't the 32-byte zero word)
 * is the wrapping contract.
 */
function extractWrapperAddress(reason: string, poolAddressLc: string): string | null {
  const matches = reason.match(/0x[0-9a-fA-F]{40}/g);
  if (!matches) return null;
  for (const m of matches) {
    const lc = m.toLowerCase();
    if (lc === poolAddressLc) continue;
    if (/^0x0+$/.test(lc)) continue;
    return lc;
  }
  return null;
}

/** First underscore-delimited token of the reason — e.g. "SUSHI". */
function extractSourceLabel(reason: string): string | null {
  const head = reason.split("~")[0] ?? "";
  const first = head.split("_")[0] ?? "";
  return first.length > 0 ? first : null;
}

async function fetchRewardsPage(
  chainId: string,
  campaignId: string,
  page: number,
): Promise<RawReward[]> {
  return merklFetch<RawReward[]>(
    `/rewards/?chainId=${encodeURIComponent(chainId)}&campaignId=${encodeURIComponent(
      campaignId,
    )}&items=${REWARDS_PAGE_SIZE}&page=${page}`,
  );
}

async function fetchAllRewards(chainId: string, campaignId: string): Promise<RawReward[]> {
  const out: RawReward[] = [];
  for (let pageStart = 0; pageStart < REWARDS_MAX_PAGES; pageStart += REWARDS_PAGE_BATCH_SIZE) {
    const pages = Array.from(
      { length: Math.min(REWARDS_PAGE_BATCH_SIZE, REWARDS_MAX_PAGES - pageStart) },
      (_, i) => pageStart + i,
    );
    const pageRows = await Promise.all(
      pages.map((page) => fetchRewardsPage(chainId, campaignId, page)),
    );

    for (let i = 0; i < pageRows.length; i++) {
      const rows = pageRows[i];
      if (rows.length > 0) out.push(...rows);
      if (rows.length < REWARDS_PAGE_SIZE) return out;
    }
  }
  return out;
}

export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get("campaignId");
  const chainId = request.nextUrl.searchParams.get("chainId") ?? KATANA_CHAIN_ID;
  const recipientLimit = parseRecipientLimit(request.nextUrl.searchParams.get("limit"));
  const includePositionIds = request.nextUrl.searchParams.get("includePositionIds") === "1";

  if (!campaignId) {
    return NextResponse.json({ error: "Missing campaignId param" }, { status: 400 });
  }

  // The Katana indexer proxy returns the legacy shape (no per-position rows /
  // wrapper-address detection). We need those fields locally, so the proxy is
  // bypassed and we hit Merkl directly. `proxyKatanaCampaignRecipients` is
  // kept exported for a future fallback path; reference it here so the linter
  // doesn't flag it as unused.
  void proxyKatanaCampaignRecipients;

  const cacheKey = `${chainId}:${campaignId.toLowerCase()}:limit=${recipientLimit}:positions=${includePositionIds ? "1" : "0"}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return jsonWithCache(cached.data, "fresh");
  }

  try {
    const campaign = await merklFetch<RawCampaign>(
      `/campaigns/${encodeURIComponent(`${chainId}-${campaignId}`)}`,
    );

    const opportunityId = campaign.opportunityId ?? "";
    const [opportunity, rewards] = await Promise.all([
      opportunityId
        ? merklFetch<RawOpportunity>(`/opportunities/${encodeURIComponent(opportunityId)}`)
        : Promise.resolve({} as RawOpportunity),
      fetchAllRewards(chainId, campaignId),
    ]);

    const decimals = Number(campaign.rewardToken?.decimals ?? 18);
    const tokenPrice =
      typeof campaign.rewardToken?.price === "number" && Number.isFinite(campaign.rewardToken.price)
        ? campaign.rewardToken.price
        : 0;

    // Aggregate per recipient (one LP can hold multiple position NFTs)
    const byRecipient = new Map<
      string,
      {
        totalRaw: bigint;
        claimedRaw: bigint;
        pendingRaw: bigint;
        positionIds: Set<string>;
      }
    >();

    // Ungrouped per-position rows + the set of wrapper contracts that own
    // positions on behalf of LPs. These power the per-position LP table and
    // the chart's "campaign LPs vs other LPs" split.
    const rawPositionRows: Array<{
      recipient: string;
      positionId: string | null;
      amountRaw: bigint;
      claimedRaw: bigint;
      pendingRaw: bigint;
      source: string | null;
      wrapperAddress: string | null;
    }> = [];
    const wrapperSet = new Set<string>();
    const poolAddrLc = (opportunity.explorerAddress ?? "").toLowerCase();

    for (const r of rewards) {
      const addr = r.recipient ?? "";
      if (!addr) continue;
      const key = addr.toLowerCase();
      const agg = byRecipient.get(key) ?? {
        totalRaw: 0n,
        claimedRaw: 0n,
        pendingRaw: 0n,
        positionIds: new Set<string>(),
      };
      let amountRaw = 0n;
      let claimedRowRaw = 0n;
      let pendingRowRaw = 0n;
      try {
        amountRaw = BigInt(r.amount ?? "0");
        claimedRowRaw = BigInt(r.claimed ?? "0");
        pendingRowRaw = BigInt(r.pending ?? "0");
        agg.totalRaw += amountRaw;
        agg.claimedRaw += claimedRowRaw;
        agg.pendingRaw += pendingRowRaw;
      } catch {
        // skip malformed amount
      }
      const reason = r.reason ?? "";
      const pid = extractPositionId(reason);
      if (pid) agg.positionIds.add(pid);
      const wrapper = extractWrapperAddress(reason, poolAddrLc);
      if (wrapper) wrapperSet.add(wrapper);
      rawPositionRows.push({
        recipient: key,
        positionId: pid,
        amountRaw,
        claimedRaw: claimedRowRaw,
        pendingRaw: pendingRowRaw,
        source: extractSourceLabel(reason),
        wrapperAddress: wrapper,
      });
      byRecipient.set(key, agg);
    }

    let distributedRaw = 0n;
    let claimedRaw = 0n;
    for (const agg of byRecipient.values()) {
      distributedRaw += agg.totalRaw;
      claimedRaw += agg.claimedRaw;
    }

    const distributedTokens = toFloat(distributedRaw.toString(), decimals);
    const recipients: CampaignRecipient[] = [];
    for (const [addr, agg] of byRecipient.entries()) {
      const tokens = toFloat(agg.totalRaw.toString(), decimals);
      const claimedTokens = toFloat(agg.claimedRaw.toString(), decimals);
      const pendingTokens = toFloat(agg.pendingRaw.toString(), decimals);
      const positionIds = [...agg.positionIds].sort();
      recipients.push({
        recipient: addr,
        totalAmount: agg.totalRaw.toString(),
        totalAmountTokens: tokens,
        totalAmountUsd: tokens * tokenPrice,
        claimedAmount: agg.claimedRaw.toString(),
        claimedAmountTokens: claimedTokens,
        pendingAmount: agg.pendingRaw.toString(),
        pendingAmountTokens: pendingTokens,
        positions: positionIds.length,
        positionIds,
        shareOfCampaignPct: distributedTokens > 0 ? (tokens / distributedTokens) * 100 : 0,
      });
    }

    recipients.sort((a, b) => b.totalAmountTokens - a.totalAmountTokens);
    const totalRecipientCount = recipients.length;
    const limitedRecipients = recipients.slice(0, recipientLimit).map((recipient) =>
      includePositionIds ? recipient : { ...recipient, positionIds: [] },
    );

    // Per-position table rows. Sorted desc by tokens earned, then ranked.
    const sortedPositionRows = rawPositionRows
      .filter((row) => row.amountRaw > 0n)
      .map((row) => {
        const tokens = toFloat(row.amountRaw.toString(), decimals);
        return {
          recipient: row.recipient,
          positionId: row.positionId,
          amount: row.amountRaw.toString(),
          amountTokens: tokens,
          amountUsd: tokens * tokenPrice,
          claimedAmount: row.claimedRaw.toString(),
          claimedAmountTokens: toFloat(row.claimedRaw.toString(), decimals),
          pendingAmount: row.pendingRaw.toString(),
          pendingAmountTokens: toFloat(row.pendingRaw.toString(), decimals),
          shareOfCampaignPct: distributedTokens > 0 ? (tokens / distributedTokens) * 100 : 0,
          source: row.source,
          wrapperAddress: row.wrapperAddress,
        };
      })
      .sort((a, b) => b.amountTokens - a.amountTokens);
    const limitedPositionRows: CampaignPositionRow[] = sortedPositionRows
      .slice(0, recipientLimit)
      .map((row, idx) => ({ rank: idx + 1, ...row }));

    const response: CampaignRecipientsResponse = {
      chainId: Number(chainId),
      campaign: {
        campaignId: campaign.campaignId ?? campaignId,
        opportunityId,
        startTimestamp: Number(campaign.startTimestamp ?? 0),
        endTimestamp: Number(campaign.endTimestamp ?? 0),
        dailyRewards: Number(campaign.dailyRewards ?? 0),
        apr: Number(campaign.apr ?? 0),
        creatorAddress: campaign.creatorAddress ?? "",
        budgetTokens: toFloat(campaign.amount ?? "0", decimals),
        rewardToken: {
          symbol: campaign.rewardToken?.symbol ?? "???",
          address: (campaign.rewardToken?.address ?? "").toLowerCase(),
          decimals,
          price: tokenPrice > 0 ? tokenPrice : null,
        },
      },
      pool: {
        name: opportunity.name ?? "",
        identifier: opportunity.identifier ?? "",
        type: opportunity.type ?? "",
        action: opportunity.action ?? "",
        status: opportunity.status ?? "",
        tvlUsd: Number(opportunity.tvl ?? 0),
        aprPct: Number(opportunity.apr ?? 0),
        dailyRewardsUsd: Number(opportunity.dailyRewards ?? 0),
        explorerAddress: opportunity.explorerAddress ?? "",
        tokens: (opportunity.tokens ?? []).map((t) => ({
          symbol: t.symbol ?? "",
          address: (t.address ?? "").toLowerCase(),
          decimals: Number(t.decimals ?? 18),
          price: typeof t.price === "number" ? t.price : null,
        })),
      },
      totals: {
        recipientCount: totalRecipientCount,
        distributedTokens,
        distributedUsd: distributedTokens * tokenPrice,
        unclaimedTokens: toFloat((distributedRaw - claimedRaw).toString(), decimals),
        unclaimedUsd: toFloat((distributedRaw - claimedRaw).toString(), decimals) * tokenPrice,
        claimedTokens: toFloat(claimedRaw.toString(), decimals),
        claimedUsd: toFloat(claimedRaw.toString(), decimals) * tokenPrice,
      },
      recipients: limitedRecipients,
      recipientsReturned: limitedRecipients.length,
      recipientsTruncated: totalRecipientCount > limitedRecipients.length,
      positionRows: limitedPositionRows,
      positionRowsTotal: sortedPositionRows.length,
      wrapperAddresses: [...wrapperSet],
      fetchedAt: Date.now(),
    };

    cache.set(cacheKey, { timestamp: Date.now(), data: response });
    return jsonWithCache(response, "fresh");
  } catch (err) {
    console.error("[merkl-campaign-recipients] Error:", err);
    if (cached) {
      return jsonWithCache(cached.data, "stale");
    }
    return NextResponse.json({ error: "Failed to fetch Merkl campaign recipients" }, { status: 502 });
  }
}
