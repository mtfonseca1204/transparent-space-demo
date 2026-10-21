import { inferPoolProtocol, type SupportedPool } from "@/lib/pools";
import { EVM_V2_POOL_CAPABILITIES } from "@/lib/evm-v2-pool-support";

export type PoolAnalyticsModel =
  | "evm-v2"
  | "evm-v3"
  | "evm-v4"
  | "raydium-clmm"
  | "meteora-dlmm";

export type PoolCapabilities = {
  hasCandleHistory: boolean;
  hasSwapHistory: boolean;
  hasWalletFeeSummary: boolean;
  hasOwnerPositionSummary: boolean;
  hasRangeLiquidityShape: boolean;
  hasHistoricalDepthBands: boolean;
  hasCurrentImpactCurve: boolean;
  hasHistoricalSlippage: boolean;
  hasOwnerCompositionHistory: boolean;
};

export type PoolAnalyticsProfile = {
  protocol: SupportedPool["protocol"];
  analyticsModel: PoolAnalyticsModel;
  capabilities: PoolCapabilities;
};

function getAnalyticsModel(protocol: SupportedPool["protocol"]): PoolAnalyticsModel {
  switch (protocol) {
    case "v2":
      return "evm-v2";
    case "v3":
      return "evm-v3";
    case "v4":
      return "evm-v4";
    case "raydium":
      return "raydium-clmm";
    case "meteora":
      return "meteora-dlmm";
  }
}

function getCapabilities(analyticsModel: PoolAnalyticsModel): PoolCapabilities {
  switch (analyticsModel) {
    case "evm-v2":
      return EVM_V2_POOL_CAPABILITIES;
    case "meteora-dlmm":
      return {
        hasCandleHistory: true,
        hasSwapHistory: true,
        hasWalletFeeSummary: true,
        hasOwnerPositionSummary: true,
        hasRangeLiquidityShape: true,
        hasHistoricalDepthBands: true,
        hasCurrentImpactCurve: true,
        hasHistoricalSlippage: true,
        hasOwnerCompositionHistory: true,
      };
    case "evm-v3":
    case "evm-v4":
    case "raydium-clmm":
      return {
        hasCandleHistory: true,
        hasSwapHistory: true,
        hasWalletFeeSummary: true,
        hasOwnerPositionSummary: true,
        hasRangeLiquidityShape: true,
        hasHistoricalDepthBands: true,
        hasCurrentImpactCurve: true,
        hasHistoricalSlippage: true,
        hasOwnerCompositionHistory: true,
      };
  }
}

export function getPoolAnalyticsProfile(poolKey: string): PoolAnalyticsProfile {
  const protocol = inferPoolProtocol(poolKey);
  const analyticsModel = getAnalyticsModel(protocol);
  return {
    protocol,
    analyticsModel,
    capabilities: getCapabilities(analyticsModel),
  };
}
