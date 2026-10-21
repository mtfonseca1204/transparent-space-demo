import type { RfqProvider, TierLevel } from "@/lib/spread-tiers";
import {
  SOLANA_POOL_METADATA_BY_ADDRESS,
  getPoolsForSpace,
} from "@/lib/pools";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

export type RfqAssetGroup = "core20" | "tail";

export interface RfqAssetConfig {
  asset: string;
  name: string;
  group: RfqAssetGroup;
  requiredTier: TierLevel | null;
  enabledProviders: RfqProvider[];
  solanaMint: string | null;
  evmTokenAddress: string | null;
  pool: string | null;
}

export function isBirdsEyeRfqRegistryEnabled(value?: string): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0";
}

export const BIRDS_EYE_RFQ_REGISTRY_ENABLED = isBirdsEyeRfqRegistryEnabled(
  process.env.NEXT_PUBLIC_BIRDS_EYE_RFQ_REGISTRY_ENABLED,
);

export const LEGACY_BIRDS_EYE_RFQ_ASSETS = [
  "TSLAx",
  "NVDAx",
  "SPYx",
  "QQQx",
  "GLDx",
  "GOOGLx",
  "HOODx",
  "CRCLx",
  "METAx",
  "COINx",
] as const;

export const REGISTRY_CORE20_ORDER = [
  "STRCx",
  "TSLAx",
  "CRCLx",
  "MSTRx",
  "SPYx",
  "NVDAx",
  "QQQx",
  "GOOGLx",
  "GLDx",
  "AAPLx",
  "AMZNx",
  "COINx",
  "HOODx",
  "MSFTx",
  "METAx",
  "VTx",
  "TQQQx",
  "INTCx",
  "CVXx",
  "VTIx",
] as const;

const LEGACY_REQUIRED_TIER_BY_ASSET: Record<string, TierLevel> = {
  SPYx: 1,
  QQQx: 1,
  GLDx: 1,
  GOOGLx: 1,
  METAx: 1,
  TSLAx: 2,
  NVDAx: 2,
  HOODx: 3,
  COINx: 3,
  CRCLx: 3,
};

export const LEGACY_BIRDS_EYE_RFQ_CONFIG: RfqAssetConfig[] =
  LEGACY_BIRDS_EYE_RFQ_ASSETS.map((asset) => ({
    asset,
    name: asset,
    group: "core20",
    requiredTier: LEGACY_REQUIRED_TIER_BY_ASSET[asset] ?? null,
    enabledProviders: ["oneinch", "zerox", "bebop", "cowswap", "jupz"],
    solanaMint: null,
    evmTokenAddress: null,
    pool: null,
  }));

const CORE20_INDEX = new Map<string, number>(
  REGISTRY_CORE20_ORDER.map((asset, index) => [asset, index]),
);

const DEFAULT_ENABLED_PROVIDERS: RfqProvider[] = [
  "oneinch",
  "zerox",
  "bebop",
  "cowswap",
  "jupz",
];

const CORE20_ASSETS = new Set<string>(REGISTRY_CORE20_ORDER);

export function sortRfqAssetConfigs(rows: RfqAssetConfig[]): RfqAssetConfig[] {
  return [...rows].sort((left, right) => {
    if (left.group !== right.group) {
      return left.group === "core20" ? -1 : 1;
    }
    if (left.group === "core20" && right.group === "core20") {
      return (CORE20_INDEX.get(left.asset) ?? Number.MAX_SAFE_INTEGER)
        - (CORE20_INDEX.get(right.asset) ?? Number.MAX_SAFE_INTEGER);
    }
    return left.asset.localeCompare(right.asset);
  });
}

export function buildPoolBackedRfqAssetConfig(spaceSlug?: string | null): RfqAssetConfig[] {
  if (!spaceSlug) return [];

  const isDemo = isDemoSpaceSlug(spaceSlug);
  const seen = new Set<string>();
  const rows: RfqAssetConfig[] = [];

  for (const pool of getPoolsForSpace(spaceSlug)) {
    if (pool.chain !== "solana") continue;
    const metadata = SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey];
    const asset = metadata?.token0Symbol;
    if (!asset || (!isDemo && !asset.endsWith("x")) || seen.has(asset)) continue;

    seen.add(asset);
    rows.push({
      asset,
      name: metadata.name,
      group: isDemo || CORE20_ASSETS.has(asset) ? "core20" : "tail",
      requiredTier: isDemo ? 1 : LEGACY_REQUIRED_TIER_BY_ASSET[asset] ?? null,
      enabledProviders: DEFAULT_ENABLED_PROVIDERS,
      solanaMint: metadata.token0Mint ?? null,
      evmTokenAddress: null,
      pool: pool.poolKey,
    });
  }

  return sortRfqAssetConfigs(rows);
}

export function mergeRfqAssetConfigs(
  primary: RfqAssetConfig[],
  fallback: RfqAssetConfig[],
): RfqAssetConfig[] {
  const byAsset = new Map<string, RfqAssetConfig>();
  for (const row of primary) byAsset.set(row.asset, row);
  for (const row of fallback) {
    if (!byAsset.has(row.asset)) byAsset.set(row.asset, row);
  }
  return sortRfqAssetConfigs([...byAsset.values()]);
}
