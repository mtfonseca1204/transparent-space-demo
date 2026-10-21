import type { PositionData } from "@/lib/envio-client";

export type MeteoraSyntheticContext = {
  currentTick: number;
  activeBinId: number | null;
  tickSpacing: number;
  token0Decimals: number;
  token1Decimals: number;
  currentPrice: number;
};

export type MeteoraResolvedRange = {
  lowerBinId: number;
  upperBinId: number;
  anchorBinId: number;
  anchorTick: number;
  tickLower: number;
  tickUpper: number;
};

export type MeteoraNativePositionLike = {
  position_id?: string | null;
  nft_mint?: string | null;
  nft_owner?: string | null;
  owner?: string | null;
  lower_bin_id?: number | string | null;
  upper_bin_id?: number | string | null;
  active_bin_id_at_update?: number | string | null;
  current_amount0?: number | string | null;
  current_amount1?: number | string | null;
  liquidity?: number | string | null;
  updated_at?: string | null;
  opened_at?: string | null;
  is_closed?: boolean | null;
};

function parseOptionalNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePositiveNumber(value: number | string | null | undefined): number | null {
  const parsed = parseOptionalNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function resolveMeteoraRange(args: {
  lowerBinId?: number | string | null;
  upperBinId?: number | string | null;
  anchorBinId?: number | string | null;
  context: MeteoraSyntheticContext;
}): MeteoraResolvedRange | null {
  const { context } = args;
  const lowerBinId = parseOptionalNumber(args.lowerBinId);
  const upperBinId = parseOptionalNumber(args.upperBinId);
  const anchorBinId = parseOptionalNumber(args.anchorBinId);
  const fallbackBinId =
    context.activeBinId ??
    anchorBinId ??
    lowerBinId ??
    upperBinId;

  if (!Number.isFinite(context.currentTick) || fallbackBinId === null) {
    return null;
  }

  const resolvedLowerBin = Math.trunc(lowerBinId ?? anchorBinId ?? fallbackBinId);
  const resolvedUpperBin = Math.trunc(upperBinId ?? anchorBinId ?? fallbackBinId);
  const poolActiveBin = Math.trunc(context.activeBinId ?? fallbackBinId);
  const resolvedAnchorBin = Math.trunc(anchorBinId ?? fallbackBinId);
  const tickSpacing = Math.max(1, Math.round(context.tickSpacing || 1));

  const tickLower = Math.round(
    context.currentTick + (resolvedLowerBin - poolActiveBin) * tickSpacing
  );
  const tickUpperExclusive = Math.round(
    context.currentTick + ((resolvedUpperBin + 1) - poolActiveBin) * tickSpacing
  );
  const anchorTick = Math.round(
    context.currentTick + (resolvedAnchorBin - poolActiveBin) * tickSpacing
  );

  return {
    lowerBinId: resolvedLowerBin,
    upperBinId: resolvedUpperBin,
    anchorBinId: resolvedAnchorBin,
    anchorTick,
    tickLower,
    tickUpper: Math.max(tickLower + tickSpacing, tickUpperExclusive),
  };
}

export function estimateMeteoraSyntheticLiquidity(args: {
  tickLower: number;
  tickUpper: number;
  referenceTick: number;
  amount0Raw?: number | string | null;
  amount1Raw?: number | string | null;
  currentPrice: number;
  token0Decimals: number;
  token1Decimals: number;
  fallbackLiquidity?: number | string | null;
}): string {
  const amount0Raw = parsePositiveNumber(args.amount0Raw) ?? 0;
  const amount1Raw = parsePositiveNumber(args.amount1Raw) ?? 0;
  const fallbackLiquidity = parsePositiveNumber(args.fallbackLiquidity);

  if (!Number.isFinite(args.tickLower) || !Number.isFinite(args.tickUpper) || args.tickUpper <= args.tickLower) {
    return fallbackLiquidity !== null ? String(Math.max(1, Math.round(fallbackLiquidity))) : "1";
  }

  const sqrtA = tickToSqrtPrice(args.tickLower);
  const sqrtB = tickToSqrtPrice(args.tickUpper);
  const sqrtP = tickToSqrtPrice(
    Math.min(Math.max(args.referenceTick, args.tickLower), args.tickUpper)
  );
  const eps = 1e-18;
  const candidates: number[] = [];

  if (args.referenceTick <= args.tickLower) {
    if (amount0Raw > 0 && sqrtB > sqrtA && sqrtA > 0) {
      candidates.push((amount0Raw * sqrtA * sqrtB) / Math.max(eps, sqrtB - sqrtA));
    }
  } else if (args.referenceTick >= args.tickUpper) {
    if (amount1Raw > 0 && sqrtB > sqrtA) {
      candidates.push(amount1Raw / Math.max(eps, sqrtB - sqrtA));
    }
  } else {
    if (amount0Raw > 0 && sqrtB > sqrtP && sqrtP > 0) {
      candidates.push((amount0Raw * sqrtP * sqrtB) / Math.max(eps, sqrtB - sqrtP));
    }
    if (amount1Raw > 0 && sqrtP > sqrtA) {
      candidates.push(amount1Raw / Math.max(eps, sqrtP - sqrtA));
    }
  }

  const totalQuoteRaw =
    amount1Raw +
    amount0Raw * Math.max(0, args.currentPrice) * Math.pow(10, args.token1Decimals - args.token0Decimals);

  if (totalQuoteRaw > 0) {
    let unitAmount0Raw = 0;
    let unitAmount1Raw = 0;
    if (args.referenceTick <= args.tickLower) {
      unitAmount0Raw = (sqrtB - sqrtA) / Math.max(eps, sqrtA * sqrtB);
    } else if (args.referenceTick >= args.tickUpper) {
      unitAmount1Raw = Math.max(0, sqrtB - sqrtA);
    } else {
      unitAmount0Raw = (sqrtB - sqrtP) / Math.max(eps, sqrtP * sqrtB);
      unitAmount1Raw = Math.max(0, sqrtP - sqrtA);
    }
    const unitQuoteRaw =
      unitAmount1Raw +
      unitAmount0Raw * Math.max(0, args.currentPrice) * Math.pow(10, args.token1Decimals - args.token0Decimals);
    if (unitQuoteRaw > eps) {
      candidates.push(totalQuoteRaw / unitQuoteRaw);
    }
  }

  const usable = candidates.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length === 0) {
    if (fallbackLiquidity !== null) {
      return String(Math.max(1, Math.round(fallbackLiquidity)));
    }
    return amount0Raw > 0 || amount1Raw > 0 ? String(Math.max(1, Math.round(amount0Raw + amount1Raw))) : "1";
  }

  const liquidity = median(usable);
  return String(Math.max(1, Math.round(liquidity)));
}

export function buildMeteoraSyntheticPosition(
  raw: MeteoraNativePositionLike,
  context: MeteoraSyntheticContext
): { position: PositionData; range: MeteoraResolvedRange } | null {
  const positionId = raw.position_id ?? raw.nft_mint ?? "";
  const owner = raw.nft_owner ?? raw.owner ?? "";
  if (!positionId || !owner) return null;

  const range = resolveMeteoraRange({
    lowerBinId: raw.lower_bin_id,
    upperBinId: raw.upper_bin_id,
    anchorBinId: raw.active_bin_id_at_update,
    context,
  });
  if (!range) return null;

  const liquidity = estimateMeteoraSyntheticLiquidity({
    tickLower: range.tickLower,
    tickUpper: range.tickUpper,
    referenceTick: context.currentTick,
    amount0Raw: raw.current_amount0,
    amount1Raw: raw.current_amount1,
    currentPrice: context.currentPrice,
    token0Decimals: context.token0Decimals,
    token1Decimals: context.token1Decimals,
    fallbackLiquidity: raw.liquidity,
  });

  const updatedAtSource = raw.updated_at ?? raw.opened_at;
  const updatedAt = updatedAtSource
    ? Math.floor(new Date(updatedAtSource).getTime() / 1000)
    : 0;

  return {
    position: {
      id: positionId,
      tokenId: positionId,
      pool: "",
      owner,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      liquidity,
      updatedAt,
    },
    range,
  };
}
