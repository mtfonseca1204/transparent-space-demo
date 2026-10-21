"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type PoolCandleData,
  type PoolHourData,
  type PositionData,
} from "@/lib/envio-client";
import { isSolanaPool, normalizePoolKey } from "@/lib/pools";
import {
  fetchRailwayEntityPaginated,
  isWorldchainIndexerPool,
} from "@/lib/worldchain-indexer-client";


export interface VolumeAttributionData {
  address: string;
  volumeUsd: number;
  volumePercentage: number;
  /** Number of hours this LP was in-range and captured fees */
  hoursActive: number;
}

export interface VolumeAttributionResult {
  attribution: VolumeAttributionData[];
  totalVolumeUsd: number;
  totalFeesUsd: number;
  isLoading: boolean;
}

interface UseVolumeAttributionHourlyOptions {
  poolAddress: string;
  /** Current positions grouped by owner - from useAllPoolPositions */
  positionsByOwner?: { owner: string; positions: PositionData[] }[];
  token1Decimals?: number;
  token1UsdPrice?: number | null;
  enabled?: boolean;
}

/**
 * Calculate volume attribution by LP using hourly candle data
 *
 * This is a much more efficient approach than per-swap attribution:
 * - Fetches pre-aggregated hourly candles with tick and fee data (24 rows max)
 * - Uses tickClose from each candle to determine which LPs were in-range
 * - Attributes fees proportionally by liquidity share at each hour
 *
 * Accuracy: Very high - uses exact tick data, real fee data
 * Cost: O(hours × positions) = ~24 × N positions vs O(swaps × events) = potentially millions
 *
 * Key insight: Fee share = Volume share (since all positions have same fee rate)
 */
export function useVolumeAttributionHourly({
  poolAddress,
  positionsByOwner,
  token1Decimals = 6,
  token1UsdPrice,
  enabled = true,
}: UseVolumeAttributionHourlyOptions): VolumeAttributionResult {
  const poolAddressLc = normalizePoolKey(poolAddress);
  const solana = isSolanaPool(poolAddressLc);
  const worldchain = isWorldchainIndexerPool(poolAddressLc);

  // Fetch 1h candles for last 24h
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const since24h = roundedNow - 86400;

  const { data: worldchainCandleData, isLoading: worldchainCandleLoading } = useQuery({
    queryKey: ["worldchainPoolCandles1h", poolAddressLc, Math.floor(since24h / 3600)],
    queryFn: async () => {
      const rows = await fetchRailwayEntityPaginated<PoolCandleData>(
        "PoolCandle",
        {
          pool: poolAddressLc,
          from: since24h,
          to: roundedNow,
        },
        1,
      );
      return rows
        .filter((row) => row.interval === "1h" && row.timestamp >= since24h)
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    enabled: enabled && worldchain,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Solana: fetch hourly data from pool-data API
  const { data: solanaCandleData, isLoading: solanaCandleLoading } = useQuery({
    queryKey: ["solanaPoolHour24h", poolAddressLc, Math.floor(since24h / 3600)],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolAddressLc,
        startTime: String(since24h),
        endTime: String(roundedNow),
        include: "hours",
      });
      const res = await fetch(`/api/pool-data?${params.toString()}`);
      if (!res.ok) throw new Error(`pool-data fetch failed: ${res.status}`);
      const data = await res.json();
      return (data.poolHourDatas ?? []) as PoolHourData[];
    },
    enabled: enabled && solana,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const candleLoading = solana
    ? solanaCandleLoading
    : worldchain
      ? worldchainCandleLoading
      : false;

  // Calculate attribution
  const result = useMemo<VolumeAttributionResult>(() => {
    const hasCandleData = solana
      ? solanaCandleData && solanaCandleData.length > 0
      : worldchain
        ? worldchainCandleData && worldchainCandleData.length > 0
        : false;

    if (!hasCandleData || !positionsByOwner || positionsByOwner.length === 0) {
      return {
        attribution: [],
        totalVolumeUsd: 0,
        totalFeesUsd: 0,
        isLoading: candleLoading || !positionsByOwner,
      };
    }

    // USD price for fee/volume conversion (use token1 side only to avoid double-counting)
    const t1Usd = token1UsdPrice ?? 0;

    // Build flat list of positions with owner reference
    const allPositions: { owner: string; position: PositionData }[] = [];
    for (const ownerData of positionsByOwner) {
      for (const position of ownerData.positions) {
        if (BigInt(position.liquidity) > 0n) {
          allPositions.push({
            owner: ownerData.owner.toLowerCase(),
            position,
          });
        }
      }
    }

    if (allPositions.length === 0) {
      return {
        attribution: [],
        totalVolumeUsd: 0,
        totalFeesUsd: 0,
        isLoading: false,
      };
    }

    // ── Solana: proportional volume attribution by liquidity share ──
    if (solana && solanaCandleData) {
      let totalVolumeUsd = 0;
      let totalFeesUsd = 0;

      for (const hour of solanaCandleData) {
        // Use only token1 side to avoid double-counting (both columns represent the same trades)
        const vol1 = Number(hour.volumeToken1 || 0) / Math.pow(10, token1Decimals);
        totalVolumeUsd += vol1 * t1Usd;
        const fee1 = Number(hour.feesToken1 || 0) / Math.pow(10, token1Decimals);
        totalFeesUsd += fee1 * t1Usd;
      }

      // Calculate each LP's liquidity share
      let totalLiquidity = 0n;
      const liquidityByOwner = new Map<string, bigint>();
      for (const { owner, position } of allPositions) {
        const liq = BigInt(position.liquidity);
        totalLiquidity += liq;
        liquidityByOwner.set(owner, (liquidityByOwner.get(owner) ?? 0n) + liq);
      }

      if (totalLiquidity === 0n) {
        return { attribution: [], totalVolumeUsd, totalFeesUsd, isLoading: false };
      }

      const attribution: VolumeAttributionData[] = Array.from(liquidityByOwner.entries())
        .map(([address, liquidity]) => {
          const share = Number(liquidity * 10000n / totalLiquidity) / 10000;
          return {
            address,
            volumeUsd: totalVolumeUsd * share,
            volumePercentage: share * 100,
            hoursActive: solanaCandleData.length,
          };
        })
        .sort((a, b) => b.volumeUsd - a.volumeUsd);

      return { attribution, totalVolumeUsd, totalFeesUsd, isLoading: false };
    }

    // ── Worldchain: tick-based attribution using candle tickClose ──
    const candleData = worldchainCandleData!;

    // Track fee attribution by owner
    const feesByOwner = new Map<string, { feesUsd: number; hoursActive: number }>();
    let totalFeesUsd = 0;
    let totalVolumeUsd = 0;

    // Process each hourly candle
    for (const candle of candleData) {
      // Use only token1 side to avoid double-counting (both columns represent the same trades)
      const fees1 = Number(candle.feesToken1 || "0") / Math.pow(10, token1Decimals);
      const hourFeesUsd = fees1 * t1Usd;

      const vol1 = Number(candle.volumeToken1 || "0") / Math.pow(10, token1Decimals);
      const hourVolumeUsd = vol1 * t1Usd;

      totalFeesUsd += hourFeesUsd;
      totalVolumeUsd += hourVolumeUsd;

      // Skip if no fees this hour
      if (hourFeesUsd <= 0) continue;

      // Use tickClose directly from candle data
      const hourTick = candle.tickClose;

      // Find all positions that cover this hour's tick
      const coveringPositions: { owner: string; liquidity: bigint }[] = [];
      let totalLiquidityAtTick = 0n;

      for (const { owner, position } of allPositions) {
        const tickLower = position.tickLower;
        const tickUpper = position.tickUpper;

        // Position covers the tick if tickLower <= tick < tickUpper
        if (tickLower <= hourTick && hourTick < tickUpper) {
          const liquidity = BigInt(position.liquidity);
          coveringPositions.push({ owner, liquidity });
          totalLiquidityAtTick += liquidity;
        }
      }

      // Attribute fees to each LP proportionally
      if (totalLiquidityAtTick > 0n && coveringPositions.length > 0) {
        // Aggregate liquidity by owner first (an owner may have multiple covering positions)
        const liquidityByOwner = new Map<string, bigint>();
        for (const { owner, liquidity } of coveringPositions) {
          const existing = liquidityByOwner.get(owner) ?? 0n;
          liquidityByOwner.set(owner, existing + liquidity);
        }

        // Attribute fees
        for (const [owner, liquidity] of liquidityByOwner.entries()) {
          const share = Number(liquidity * 10000n / totalLiquidityAtTick) / 10000;
          const attributedFees = hourFeesUsd * share;

          const existing = feesByOwner.get(owner) ?? { feesUsd: 0, hoursActive: 0 };
          feesByOwner.set(owner, {
            feesUsd: existing.feesUsd + attributedFees,
            hoursActive: existing.hoursActive + 1,
          });
        }
      }
    }

    // Convert to sorted array
    // Fee share = Volume share (same fee rate for all positions in pool)
    const attribution: VolumeAttributionData[] = Array.from(feesByOwner.entries())
      .map(([address, data]) => ({
        address,
        volumeUsd: totalVolumeUsd > 0 && totalFeesUsd > 0
          ? (data.feesUsd / totalFeesUsd) * totalVolumeUsd
          : 0,
        volumePercentage: totalFeesUsd > 0 ? (data.feesUsd / totalFeesUsd) * 100 : 0,
        hoursActive: data.hoursActive,
      }))
      .sort((a, b) => b.volumeUsd - a.volumeUsd);

    return {
      attribution,
      totalVolumeUsd,
      totalFeesUsd,
      isLoading: false,
    };
  }, [
    solana,
    worldchain,
    solanaCandleData,
    worldchainCandleData,
    positionsByOwner,
    token1Decimals,
    token1UsdPrice,
    candleLoading,
  ]);

  return {
    ...result,
    isLoading: result.isLoading || candleLoading,
  };
}
