export const EVM_V2_POOL_CAPABILITIES = {
  hasCandleHistory: true,
  hasSwapHistory: true,
  hasWalletFeeSummary: false,
  hasOwnerPositionSummary: false,
  hasRangeLiquidityShape: false,
  hasHistoricalDepthBands: false,
  hasCurrentImpactCurve: false,
  hasHistoricalSlippage: false,
  hasOwnerCompositionHistory: false,
} as const;

export function isEvmV2Protocol(protocol: string | null | undefined): protocol is "v2" {
  return protocol === "v2";
}

export function isReserveBackedIndexedPool(protocol: string | null | undefined): boolean {
  return isEvmV2Protocol(protocol);
}

export function supportsV3PoolMintBurnEntities(protocol: string | null | undefined): boolean {
  return protocol === "v3";
}

export function getIndexedEvmSwapEntity(protocol: string | null | undefined): string {
  if (isEvmV2Protocol(protocol)) return "UniswapV2Pair_Swap";
  if (protocol === "v4") return "UniswapV4Pool_Swap";
  return "UniswapV3Pool_Swap";
}
