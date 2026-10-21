"use client";

import { useQuery } from "@tanstack/react-query";
import type { MerklCampaign, MerklOpportunity } from "@/app/api/merkl-opportunities/route";
import {
  ZEROG_CHAIN_ID,
  ZEROG_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
  ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
  ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
  ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
} from "@/lib/pools";

export interface ZerogMerklCampaign extends MerklCampaign {
  poolKey: string;
  poolLabel: string;
  tokenSymbols: readonly [string, string];
  opportunityIdentifier: string;
  opportunityName: string;
}

export interface ZerogMerklOpportunity extends MerklOpportunity {
  poolKey: string;
  poolLabel: string;
  tokenSymbols: readonly [string, string];
}

export interface ZerogMerklOpportunitiesData {
  chainId: number;
  opportunities: ZerogMerklOpportunity[];
  campaigns: ZerogMerklCampaign[];
}

const ZEROG_MERKL_POOL_CONFIGS = [
  {
    poolKey: ZEROG_W0G_USDCE_V3_POOL_KEY,
    poolLabel: "W0G / USDC.e",
    tokenSymbols: ["W0G", "USDC.e"],
  },
  {
    poolKey: ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
    poolLabel: "Zia W0G / USDC.e",
    tokenSymbols: ["W0G", "USDC.e"],
  },
  {
    poolKey: ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
    poolLabel: "Zia W0G / WETH",
    tokenSymbols: ["W0G", "WETH"],
  },
  {
    poolKey: ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
    poolLabel: "Zia WBTC / W0G",
    tokenSymbols: ["WBTC", "W0G"],
  },
  {
    poolKey: ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
    poolLabel: "Zia USDC.e / WETH",
    tokenSymbols: ["USDC.e", "WETH"],
  },
  {
    poolKey: ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
    poolLabel: "Zia oUSDT / USDC.e",
    tokenSymbols: ["oUSDT", "USDC.e"],
  },
] as const;

async function fetchOpportunity(
  config: (typeof ZEROG_MERKL_POOL_CONFIGS)[number],
  signal?: AbortSignal,
): Promise<ZerogMerklOpportunity | null> {
  const url = `/api/merkl-opportunities?chainId=${ZEROG_CHAIN_ID}&identifier=${encodeURIComponent(
    config.poolKey,
  )}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    return null;
  }
  const opportunity = (await res.json()) as MerklOpportunity;
  return {
    ...opportunity,
    poolKey: config.poolKey,
    poolLabel: config.poolLabel,
    tokenSymbols: config.tokenSymbols,
  };
}

async function fetchZerogOpportunities(signal?: AbortSignal): Promise<ZerogMerklOpportunitiesData> {
  const opportunities = (
    await Promise.all(
      ZEROG_MERKL_POOL_CONFIGS.map(async (config) => {
        try {
          return await fetchOpportunity(config, signal);
        } catch (err) {
          if (signal?.aborted) throw err;
          return null;
        }
      }),
    )
  ).filter((opportunity): opportunity is ZerogMerklOpportunity => Boolean(opportunity));

  if (opportunities.length === 0) {
    throw new Error("No 0G Merkl opportunities returned");
  }

  const campaigns = opportunities.flatMap((opportunity) =>
    (opportunity.campaigns ?? []).map((campaign) => ({
      ...campaign,
      poolKey: opportunity.poolKey,
      poolLabel: opportunity.poolLabel,
      tokenSymbols: opportunity.tokenSymbols,
      opportunityIdentifier: opportunity.identifier,
      opportunityName: opportunity.name,
    })),
  );

  return {
    chainId: ZEROG_CHAIN_ID,
    opportunities,
    campaigns,
  };
}

/** Fetches every 0G mainnet Merkl opportunity used by the Birds-eye incentives view. */
export function useZerogMerklOpportunity(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery<ZerogMerklOpportunitiesData, Error>({
    queryKey: [
      "zerog-merkl-opportunities",
      ZEROG_MERKL_POOL_CONFIGS.map((config) => config.poolKey),
    ],
    queryFn: ({ signal }) => fetchZerogOpportunities(signal),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}
