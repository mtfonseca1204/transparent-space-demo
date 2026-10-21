export interface RfqDepthSource {
  maxDepth?: number | null;
}

export interface RfqDepthAssetRow<SourceKey extends string> {
  asset: string;
  sources: Partial<Record<SourceKey, RfqDepthSource | null | undefined>>;
}

export interface RfqDepthAssetConfig {
  asset: string;
  group: "core20" | "tail";
}

export const RFQ_LOAN_CAPACITY_USD = 15_000_000;
export const RFQ_DEPTH_REQUIRED_USD = 9_000_000;
export const RFQ_TOP20_DEPTH_REQUIRED_USD = 5_000_000;
export const RFQ_OUTSIDE_TOP20_DEPTH_REQUIRED_USD = 4_000_000;

export interface RfqMarketMakerDepthSlaSummary {
  totalDepth: number;
  totalDeltaUsd: number;
  remainingCapacity: number;
  top20Shortfall: number;
  outsideTop20Shortfall: number;
  segmentShortfall: number;
  totalShortfall: number;
  complianceShortfall: number;
}

export function computeRfqMarketMakerAssetDepth<
  SourceKey extends string,
>(
  sources: Partial<Record<SourceKey, RfqDepthSource | null | undefined>>,
  marketMakerSources: SourceKey[],
): number {
  let maxDepth = 0;

  for (const sourceKey of marketMakerSources) {
    const depth = sources[sourceKey]?.maxDepth ?? 0;
    if (depth > maxDepth) maxDepth = depth;
  }

  return maxDepth;
}

export function computeRfqMarketMakerDepthBuckets<
  SourceKey extends string,
>(
  rows: RfqDepthAssetRow<SourceKey>[],
  marketMakerSources: SourceKey[],
  assetConfigs: RfqDepthAssetConfig[],
): { top20Depth: number; outsideTop20Depth: number } {
  const groupByAsset = new Map(
    assetConfigs.map((assetConfig) => [assetConfig.asset, assetConfig.group]),
  );
  let top20Depth = 0;
  let outsideTop20Depth = 0;

  for (const row of rows) {
    const depth = computeRfqMarketMakerAssetDepth(row.sources, marketMakerSources);
    if (groupByAsset.get(row.asset) === "tail") {
      outsideTop20Depth += depth;
    } else {
      top20Depth += depth;
    }
  }

  return { top20Depth, outsideTop20Depth };
}

export function summarizeRfqMarketMakerDepthSla(
  top20Depth: number,
  outsideTop20Depth: number,
): RfqMarketMakerDepthSlaSummary {
  const totalDepth = top20Depth + outsideTop20Depth;
  const top20Shortfall = Math.max(0, RFQ_TOP20_DEPTH_REQUIRED_USD - top20Depth);
  const outsideTop20Shortfall = Math.max(
    0,
    RFQ_OUTSIDE_TOP20_DEPTH_REQUIRED_USD - outsideTop20Depth,
  );
  const segmentShortfall = top20Shortfall + outsideTop20Shortfall;
  const totalShortfall = Math.max(0, RFQ_DEPTH_REQUIRED_USD - totalDepth);

  return {
    totalDepth,
    totalDeltaUsd: totalDepth - RFQ_DEPTH_REQUIRED_USD,
    remainingCapacity: Math.max(0, RFQ_LOAN_CAPACITY_USD - totalDepth),
    top20Shortfall,
    outsideTop20Shortfall,
    segmentShortfall,
    totalShortfall,
    complianceShortfall: Math.max(segmentShortfall, totalShortfall),
  };
}
