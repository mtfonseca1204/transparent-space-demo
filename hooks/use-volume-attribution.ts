"use client";

import { useMemo } from "react";
import type { PositionData, V3SwapEventData } from "@/lib/envio-client";

export interface VolumeAttributionData {
  address: string;
  volumeUsd: number;
  volumePercentage: number;
  swapCount: number;
}

export interface VolumeAttributionResult {
  attribution: VolumeAttributionData[];
  totalVolumeUsd: number;
  totalSwaps: number;
  isLoading: boolean;
}

interface UseVolumeAttributionOptions {
  swaps: V3SwapEventData[] | null | undefined;
  positionsByOwner: { owner: string; positions: PositionData[] }[] | null | undefined;
  token0Decimals?: number;
  token1Decimals?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  // Filter to today's swaps only
  filterToday?: boolean;
}

/**
 * Calculate volume attribution by LP
 * 
 * For each swap, we:
 * 1. Find all positions that cover the swap's tick
 * 2. Calculate each position's share of liquidity at that tick
 * 3. Attribute the swap's USD volume proportionally to each LP
 */
export function useVolumeAttribution({
  swaps,
  positionsByOwner,
  token0Decimals = 18,
  token1Decimals = 6,
  token0UsdPrice,
  token1UsdPrice,
  filterToday = true,
}: UseVolumeAttributionOptions): VolumeAttributionResult {
  return useMemo(() => {
    if (!swaps || swaps.length === 0 || !positionsByOwner || positionsByOwner.length === 0) {
      return {
        attribution: [],
        totalVolumeUsd: 0,
        totalSwaps: 0,
        isLoading: !swaps || !positionsByOwner,
      };
    }

    // Calculate USD prices
    const currentPrice = token1UsdPrice && token0UsdPrice 
      ? token0UsdPrice / token1UsdPrice 
      : 1;
    
    const t0Usd = token0UsdPrice ?? (token1UsdPrice ? token1UsdPrice * currentPrice : null);
    const t1Usd = token1UsdPrice ?? (token0UsdPrice ? token0UsdPrice / currentPrice : null);

    // Filter to today's swaps if requested
    let filteredSwaps = swaps;
    if (filterToday) {
      const now = Date.now();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startTimestamp = Math.floor(startOfToday.getTime() / 1000);
      
      filteredSwaps = swaps.filter((swap) => swap.timestamp >= startTimestamp);
    }

    if (filteredSwaps.length === 0) {
      return {
        attribution: [],
        totalVolumeUsd: 0,
        totalSwaps: 0,
        isLoading: false,
      };
    }

    // Build a flat list of all positions with their ACTUAL owner (wallet address)
    // NOTE: Use position.owner (actual wallet) instead of ownerData.owner (may be tokenId)
    const allPositions: { owner: string; position: PositionData }[] = [];
    for (const ownerData of positionsByOwner) {
      for (const position of ownerData.positions) {
        if (BigInt(position.liquidity) > 0n) {
          // Use the actual owner from the position, not from the wrapper
          const actualOwner = position.owner?.toLowerCase() ?? ownerData.owner.toLowerCase();
          allPositions.push({ owner: actualOwner, position });
        }
      }
    }

    // Track volume attribution by owner
    const volumeByOwner = new Map<string, { volumeUsd: number; swapCount: number }>();
    let totalVolumeUsd = 0;

    // Process each swap
    for (const swap of filteredSwaps) {
      const swapTick = Number(swap.tick);
      
      // Calculate swap volume in USD
      const amount0 = swap.amount0 ? Math.abs(Number(swap.amount0)) / Math.pow(10, token0Decimals) : 0;
      const amount1 = swap.amount1 ? Math.abs(Number(swap.amount1)) / Math.pow(10, token1Decimals) : 0;
      
      // Use the larger of the two amounts for volume (they should be roughly equal in USD value)
      let swapVolumeUsd = 0;
      if (t0Usd !== null && amount0 > 0) {
        swapVolumeUsd = amount0 * t0Usd;
      } else if (t1Usd !== null && amount1 > 0) {
        swapVolumeUsd = amount1 * t1Usd;
      } else {
        // Fallback: use amount1 as value (assuming token1 is quote currency)
        swapVolumeUsd = amount1;
      }

      totalVolumeUsd += swapVolumeUsd;

      // Find all positions that cover this tick
      const coveringPositions: { owner: string; liquidity: bigint }[] = [];
      let totalLiquidityAtTick = 0n;

      for (const { owner, position } of allPositions) {
        const tickLower = position.tickLower;
        const tickUpper = position.tickUpper;

        // Position covers the tick if tickLower <= tick < tickUpper
        if (tickLower <= swapTick && swapTick < tickUpper) {
          const liquidity = BigInt(position.liquidity);
          coveringPositions.push({ owner, liquidity });
          totalLiquidityAtTick += liquidity;
        }
      }

      // Attribute volume to each LP proportionally
      if (totalLiquidityAtTick > 0n && coveringPositions.length > 0) {
        for (const { owner, liquidity } of coveringPositions) {
          const share = Number(liquidity * 10000n / totalLiquidityAtTick) / 10000;
          const attributedVolume = swapVolumeUsd * share;

          const existing = volumeByOwner.get(owner.toLowerCase()) || { volumeUsd: 0, swapCount: 0 };
          volumeByOwner.set(owner.toLowerCase(), {
            volumeUsd: existing.volumeUsd + attributedVolume,
            swapCount: existing.swapCount + 1,
          });
        }
      }
    }

    // Convert to sorted array
    const attribution: VolumeAttributionData[] = Array.from(volumeByOwner.entries())
      .map(([address, data]) => ({
        address,
        volumeUsd: data.volumeUsd,
        volumePercentage: totalVolumeUsd > 0 ? (data.volumeUsd / totalVolumeUsd) * 100 : 0,
        swapCount: data.swapCount,
      }))
      .sort((a, b) => b.volumeUsd - a.volumeUsd);

    return {
      attribution,
      totalVolumeUsd,
      totalSwaps: filteredSwaps.length,
      isLoading: false,
    };
  }, [swaps, positionsByOwner, token0Decimals, token1Decimals, token0UsdPrice, token1UsdPrice, filterToday]);
}
