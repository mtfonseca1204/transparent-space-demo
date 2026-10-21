export type BirdsEyeDepthMetricPosition = {
  tickLower: number;
  tickUpper: number;
  liquidity: string;
};

export type BirdsEyeDepthMetricPositionGroup = {
  positions: BirdsEyeDepthMetricPosition[];
};

export type BirdsEyeDepthMetricJob = {
  poolKey: string;
  currentPrice: number;
  currentTick: number;
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
  token0UsdPrice: number | null;
  token1UsdPrice: number | null;
  isTrackedToken0: boolean;
  fee: number;
  positionFingerprint: string;
  positionsByOwner: BirdsEyeDepthMetricPositionGroup[];
};

export type BirdsEyeDepthMetricResult = {
  poolKey: string;
  depthBuyAt2PctUsd: number | null;
  depthSellAt2PctUsd: number | null;
  effectiveSpreadPct: number | null;
  error?: string;
};

export type BirdsEyeDepthWorkerRequest = {
  requestId: number;
  jobs: BirdsEyeDepthMetricJob[];
};

export type BirdsEyeDepthWorkerResponse = {
  requestId: number;
  results: BirdsEyeDepthMetricResult[];
};
