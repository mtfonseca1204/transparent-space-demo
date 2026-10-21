export interface RfqBuySideTier {
  notionalUsd: number;
  buyPrice: number;
}

export interface RfqDepthCeiling {
  maxDepth: number;
  buyPrice: number;
}

export const RFQ_DEPTH_REFERENCE_NOTIONAL_USD = 1_000;

export function buildMedianBuyPriceMap(
  tiers: RfqBuySideTier[]
): Map<number, number> {
  const byNotional = new Map<number, number[]>();

  for (const tier of tiers) {
    if (!(tier.buyPrice > 0)) continue;
    const prices = byNotional.get(tier.notionalUsd) ?? [];
    prices.push(tier.buyPrice);
    byNotional.set(tier.notionalUsd, prices);
  }

  const medians = new Map<number, number>();
  for (const [notional, prices] of byNotional) {
    prices.sort((left, right) => left - right);
    medians.set(notional, prices[Math.floor(prices.length / 2)]);
  }

  return medians;
}

export function computeRfqBuySideDepthCeiling(
  latestTiers: RfqBuySideTier[],
  medianMap: Map<number, number>
): RfqDepthCeiling {
  if (latestTiers.length === 0) return { maxDepth: 0, buyPrice: 0 };

  const saneTiers = latestTiers.filter((tier) => {
    const median = medianMap.get(tier.notionalUsd);
    if (!median || !(tier.buyPrice > 0)) return false;
    return tier.buyPrice < median * 3 && tier.buyPrice > median / 3;
  });
  if (saneTiers.length === 0) return { maxDepth: 0, buyPrice: 0 };

  const referenceTier = saneTiers.reduce((best, tier) => {
    const tierDistance = Math.abs(
      tier.notionalUsd - RFQ_DEPTH_REFERENCE_NOTIONAL_USD
    );
    const bestDistance = Math.abs(
      best.notionalUsd - RFQ_DEPTH_REFERENCE_NOTIONAL_USD
    );
    return tierDistance < bestDistance ? tier : best;
  });
  const buyPrice = referenceTier.buyPrice;

  const maxDepth = saneTiers.reduce(
    (ceiling, tier) => Math.max(ceiling, tier.notionalUsd),
    0
  );

  return { maxDepth, buyPrice };
}
