"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RfqProvider, TierLevel } from "@/lib/spread-tiers";
import {
  BIRDS_EYE_RFQ_REGISTRY_ENABLED,
  LEGACY_BIRDS_EYE_RFQ_CONFIG,
  buildPoolBackedRfqAssetConfig,
  mergeRfqAssetConfigs,
  sortRfqAssetConfigs,
  type RfqAssetConfig,
  type RfqAssetGroup,
} from "@/lib/rfq-asset-config";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

const INDEXER_BASE = process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ?? "";

interface AssetsConfigApiRow {
  asset: string;
  name: string;
  group: RfqAssetGroup;
  required_tier: TierLevel | null;
  enabled_providers: RfqProvider[];
  solana_mint: string | null;
  evm_token_address: string | null;
  pool: string | null;
}

interface AssetsConfigApiResponse {
  data: AssetsConfigApiRow[];
}

async function fetchAssetsConfig(signal?: AbortSignal): Promise<RfqAssetConfig[]> {
  if (!INDEXER_BASE) {
    throw new Error(
      "Missing NEXT_PUBLIC_SOLANA_INDEXER_API_URL — can't fetch RFQ assets config",
    );
  }

  const res = await fetch(`${INDEXER_BASE}/api/rfq/assets-config`, { signal });
  if (!res.ok) {
    throw new Error(`assets-config HTTP ${res.status}`);
  }

  const json = (await res.json()) as AssetsConfigApiResponse;
  return sortRfqAssetConfigs(
    (json.data ?? []).map((row) => ({
      asset: row.asset,
      name: row.name,
      group: row.group,
      requiredTier: row.required_tier,
      enabledProviders: row.enabled_providers,
      solanaMint: row.solana_mint,
      evmTokenAddress: row.evm_token_address,
      pool: row.pool,
    })),
  );
}

export function useRfqAssetsConfig(
  spaceSlug?: string | null,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const query = useQuery<RfqAssetConfig[], Error>({
    queryKey: ["rfq-assets-config", spaceSlug ?? null],
    queryFn: ({ signal }) => fetchAssetsConfig(signal),
    enabled: enabled && !isDemoSpaceSlug(spaceSlug) && BIRDS_EYE_RFQ_REGISTRY_ENABLED && !!INDEXER_BASE,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const poolBackedAssets = useMemo(
    () => buildPoolBackedRfqAssetConfig(spaceSlug),
    [spaceSlug],
  );

  const assets = useMemo(() => {
    if (BIRDS_EYE_RFQ_REGISTRY_ENABLED && query.data?.length) {
      return mergeRfqAssetConfigs(query.data, poolBackedAssets);
    }
    return poolBackedAssets.length > 0 ? poolBackedAssets : LEGACY_BIRDS_EYE_RFQ_CONFIG;
  }, [poolBackedAssets, query.data]);

  return {
    assets,
    isRegistryMode: !isDemoSpaceSlug(spaceSlug) && BIRDS_EYE_RFQ_REGISTRY_ENABLED && !!query.data?.length,
    isLoading: !isDemoSpaceSlug(spaceSlug) && BIRDS_EYE_RFQ_REGISTRY_ENABLED ? query.isLoading : false,
    error: query.error ?? null,
  };
}
