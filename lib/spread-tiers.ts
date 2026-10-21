import type { MarketSession } from "@/lib/market-session";
import {
  getMarketMakerDisplayLabel,
  getMarketMakerDisplayShortLabel,
} from "@/lib/space-policy";

export type TierLevel = 1 | 2 | 3;

export interface TierBand {
  minBps: number;
  maxBps: number;
}

/**
 * xStock spread tier bands per session (bps from mid, one-sided).
 * Source: xStock Market Maker SLA — Spread Requirements table.
 */
export const TIER_BANDS: Record<TierLevel, Record<MarketSession, TierBand>> = {
  1: {
    market: { minBps: 5, maxBps: 10 },
    prePost: { minBps: 20, maxBps: 40 },
    weekend: { minBps: 50, maxBps: 100 },
  },
  2: {
    market: { minBps: 7.5, maxBps: 15 },
    prePost: { minBps: 30, maxBps: 60 },
    weekend: { minBps: 75, maxBps: 100 },
  },
  3: {
    market: { minBps: 12.5, maxBps: 25 },
    prePost: { minBps: 50, maxBps: 100 },
    weekend: { minBps: 125, maxBps: 250 },
  },
};

/**
 * Required tier per xStock (from 3-month annualized volatility of the underlying equity).
 * These values are temporary defaults until the weekly FMP cron + Supabase
 * `equity_volatility` table lands; override in that pipeline when it ships.
 * Tier 1 < 40% vol, Tier 2 40-80%, Tier 3 > 80%.
 */
export const REQUIRED_TIER_BY_ASSET: Record<string, TierLevel> = {
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

export function getRequiredTier(asset: string): TierLevel | null {
  return REQUIRED_TIER_BY_ASSET[asset] ?? null;
}

export interface ObservedTierResult {
  tier: TierLevel;
  /** True when observed bps exceeds even T3's max for that session */
  beyondMax: boolean;
}

/**
 * Map a worst-side bps reading in a given session to the smallest tier
 * whose maxBps still contains it. Beyond T3's max is flagged as beyondMax.
 */
export function classifyObservedTier(
  worstSideBps: number,
  session: MarketSession
): ObservedTierResult {
  const levels: TierLevel[] = [1, 2, 3];
  for (const level of levels) {
    if (worstSideBps <= TIER_BANDS[level][session].maxBps) {
      return { tier: level, beyondMax: false };
    }
  }
  return { tier: 3, beyondMax: true };
}

export type ComplianceStatus = "ok" | "warn" | "breach";

/** Compliance read for an observed tier vs. the asset's required tier. */
export function compareObservedToRequired(
  observed: ObservedTierResult,
  required: TierLevel
): ComplianceStatus {
  if (observed.beyondMax) return "breach";
  if (observed.tier <= required) return "ok";
  if (observed.tier === required + 1) return "warn";
  return "breach";
}

export type MarketMaker = "flowdesk" | "tokka";
export type RfqProvider = "oneinch" | "zerox" | "bebop" | "cowswap" | "jupz";

export const MM_BY_PROVIDER: Record<RfqProvider, MarketMaker> = {
  oneinch: "flowdesk",
  zerox: "flowdesk",
  bebop: "flowdesk",
  cowswap: "tokka",
  jupz: "tokka",
};

export const MM_LABEL: Record<MarketMaker, string> = {
  flowdesk: "Flowdesk",
  tokka: "Tokka Labs",
};

export const MM_SHORT_LABEL: Record<MarketMaker, string> = {
  flowdesk: "FD",
  tokka: "TK",
};

export function getMarketMakerLabel(
  marketMaker: MarketMaker,
  spaceSlug?: string | null
): string {
  return getMarketMakerDisplayLabel(marketMaker, MM_LABEL[marketMaker], spaceSlug);
}

export function getMarketMakerShortLabel(
  marketMaker: MarketMaker,
  spaceSlug?: string | null
): string {
  return getMarketMakerDisplayShortLabel(marketMaker, MM_SHORT_LABEL[marketMaker], spaceSlug);
}

export const PROVIDER_LABEL: Record<RfqProvider, string> = {
  oneinch: "1inch",
  zerox: "0x",
  bebop: "Bebop",
  cowswap: "CoW",
  jupz: "JupZ",
};

export const PROVIDERS_BY_MM: Record<MarketMaker, RfqProvider[]> = {
  flowdesk: ["zerox", "bebop", "oneinch"],
  tokka: ["cowswap", "jupz"],
};

/** Notional we score against the SLA bands (smallest tier ≥ this is selected). */
export const SPREAD_SCORE_NOTIONAL_USD = 10_000;
