export const MONAD_V2_DUST_USDC_POOL_KEY =
  "0x86dbf00485871c901c5129bd525348db96c2eb2d";
export const MONAD_V2_DUST_ADDRESS =
  "0xad96c3dffcd6374294e2573a7fbba96097cc8d7c";
export const MONAD_V2_USDC_ADDRESS =
  "0x754704bc059f8c67012fed69bc8a327a5aafb603";
export const MONAD_V2_DUST_ICON =
  "https://cdn.dexscreener.com/cms/images/a7efe29afe139ac03be1028f0a76ec91169a6961bbda55b70060a8692ba7d09e?width=64&height=64&fit=crop&quality=95&format=auto";

export const MONAD_V2_TICK_RATIO = 1.0272;

export type MonadV2TokenSnapshot = {
  symbol: "USDC" | "DUST";
  address: string;
  decimals: number;
  reserve: number;
  reserveRaw: string;
  priceUsd: number;
  logoUrl?: string;
};

export type MonadV2LpHolder = {
  address: string;
  balance: number;
  balanceRaw: string;
  share: number;
  sharePct: number;
};

export type MonadV2DashboardData = {
  updatedAt: number;
  sources: {
    reserveEntity: "Pool";
    lpTransferEntity: "UniswapV2Pair_Transfer";
    transferRows: number;
    poolUpdatedAt: number;
  };
  pool: {
    address: string;
    chainId: 143;
    feeBps: number;
    protocol: "v2";
    updatedAt: number;
    token0: MonadV2TokenSnapshot;
    token1: MonadV2TokenSnapshot;
    tvlUsd: number;
    currentDustPriceUsd: number;
    dustPerUsdc: number;
    invariantL: number;
    priceSource: "pool-implied";
  };
  lp: {
    holderCount: number;
    transferCount: number;
    totalSupply: number;
    totalSupplyRaw: string;
    topHolders: MonadV2LpHolder[];
    others: MonadV2LpHolder | null;
    partial: boolean;
  };
};

export type MonadV2ChartRange = "local" | "full";

export type MonadV2LiquidityBin = {
  lowerPrice: number;
  upperPrice: number;
  centerPrice: number;
  dustAmount: number;
  usdcAmount: number;
  dustUsd: number;
  usdcUsd: number;
  totalUsd: number;
};

export function buildMonadV2LiquidityBins(args: {
  currentPriceUsd: number;
  invariantL: number;
  range: MonadV2ChartRange;
  tickRatio?: number;
}): MonadV2LiquidityBin[] {
  const { currentPriceUsd, invariantL, range } = args;
  const tickRatio = args.tickRatio ?? MONAD_V2_TICK_RATIO;
  if (
    !Number.isFinite(currentPriceUsd) ||
    !Number.isFinite(invariantL) ||
    currentPriceUsd <= 0 ||
    invariantL <= 0 ||
    tickRatio <= 1
  ) {
    return [];
  }

  const rangeFactor = range === "full" ? 1000 : 2.25;
  const minPrice = currentPriceUsd / rangeFactor;
  const maxPrice = currentPriceUsd * rangeFactor;
  const logStep = Math.log(tickRatio);
  const minIndex = Math.floor(Math.log(minPrice / currentPriceUsd) / logStep);
  const maxIndex = Math.ceil(Math.log(maxPrice / currentPriceUsd) / logStep);
  const sqrtTickRatio = Math.sqrt(tickRatio);
  const bins: MonadV2LiquidityBin[] = [];

  for (let i = minIndex; i <= maxIndex; i++) {
    const centerPrice = currentPriceUsd * Math.pow(tickRatio, i);
    const lowerPrice = Math.max(centerPrice / sqrtTickRatio, minPrice);
    const upperPrice = Math.min(centerPrice * sqrtTickRatio, maxPrice);
    if (upperPrice <= minPrice || lowerPrice >= maxPrice || lowerPrice >= upperPrice) continue;
    bins.push(
      calculateMonadV2Bin({
        lowerPrice,
        upperPrice,
        currentPriceUsd,
        invariantL,
      })
    );
  }

  return bins;
}

function calculateMonadV2Bin(args: {
  lowerPrice: number;
  upperPrice: number;
  currentPriceUsd: number;
  invariantL: number;
}): MonadV2LiquidityBin {
  const { lowerPrice, upperPrice, currentPriceUsd, invariantL } = args;
  let dustAmount = 0;
  let usdcAmount = 0;

  if (upperPrice <= currentPriceUsd) {
    usdcAmount = invariantL * (Math.sqrt(upperPrice) - Math.sqrt(lowerPrice));
  } else if (lowerPrice >= currentPriceUsd) {
    dustAmount =
      invariantL * (1 / Math.sqrt(lowerPrice) - 1 / Math.sqrt(upperPrice));
  } else {
    usdcAmount =
      invariantL * (Math.sqrt(currentPriceUsd) - Math.sqrt(lowerPrice));
    dustAmount =
      invariantL *
      (1 / Math.sqrt(currentPriceUsd) - 1 / Math.sqrt(upperPrice));
  }

  const dustUsd = dustAmount * currentPriceUsd;
  const usdcUsd = usdcAmount;
  return {
    lowerPrice,
    upperPrice,
    centerPrice: Math.sqrt(lowerPrice * upperPrice),
    dustAmount,
    usdcAmount,
    dustUsd,
    usdcUsd,
    totalUsd: dustUsd + usdcUsd,
  };
}
