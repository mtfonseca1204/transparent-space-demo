import type { BirdsEyeRfqRow, RfqSourceKey } from "@/hooks/use-birds-eye-rfq-data";
import type { MarketSession } from "@/lib/market-session";
import { classifySession } from "@/lib/market-session";
import {
  MM_BY_PROVIDER,
  PROVIDERS_BY_MM,
  PROVIDER_LABEL,
  TIER_BANDS,
  type RfqProvider,
  type TierLevel,
} from "@/lib/spread-tiers";

interface SummaryLike {
  medianBps: number | null;
}

export interface SyntheticSeed {
  asset: string;
  provider: RfqProvider;
  quoteAt: string;
  sourceSession: MarketSession;
  worstSideBps: number;
}

export interface ResolvedSyntheticCell {
  bps: number | null;
  isSynthetic: boolean;
  syntheticReason?: string;
  syntheticSourceSession?: MarketSession;
  syntheticQuoteAt?: string;
}

const SYNTHETIC_ALLOWLIST: Record<string, RfqProvider[]> = {
  COINx: ["oneinch", "zerox", "bebop", "cowswap"],
  HOODx: ["oneinch", "zerox", "bebop", "cowswap"],
};

const PROVIDER_TO_SOURCE_KEY: Record<RfqProvider, RfqSourceKey> = {
  oneinch: "1inch",
  zerox: "0x",
  bebop: "bebop",
  cowswap: "cowswap",
  jupz: "jupz",
};

function midpoint(minBps: number, maxBps: number): number {
  return (minBps + maxBps) / 2;
}

function etDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function computeWorstSideBps(
  buyPrice: number,
  sellPrice: number
): number | null {
  if (!(buyPrice > 0) || !(sellPrice > 0)) return null;
  const mid = (buyPrice + sellPrice) / 2;
  if (!(mid > 0)) return null;
  const askSide = Math.abs(buyPrice - mid);
  const bidSide = Math.abs(sellPrice - mid);
  return (Math.max(askSide, bidSide) / mid) * 10_000;
}

export function isSyntheticTargetEligible(
  asset: string,
  provider: RfqProvider,
  session: MarketSession
): boolean {
  const isKnownSession =
    session === "market" || session === "prePost" || session === "weekend";
  return isKnownSession && (SYNTHETIC_ALLOWLIST[asset] ?? []).includes(provider);
}

export function isSyntheticSeedFresh(
  quoteAt: string,
  now: Date = new Date()
): boolean {
  const quoteDate = new Date(quoteAt);
  if (Number.isNaN(quoteDate.getTime())) return false;
  return etDateKey(quoteDate) === etDateKey(now);
}

export function buildSyntheticSeedIndex(
  rows: BirdsEyeRfqRow[]
): Map<string, Map<RfqProvider, SyntheticSeed>> {
  const byAsset = new Map<string, Map<RfqProvider, SyntheticSeed>>();
  for (const row of rows) {
    for (const [provider, sourceKey] of Object.entries(PROVIDER_TO_SOURCE_KEY) as Array<
      [RfqProvider, RfqSourceKey]
    >) {
      const source = row.sources[sourceKey];
      if (!source?.quoteAt) continue;
      if (!Number.isFinite(source.worstSideBps) || source.worstSideBps === null) {
        continue;
      }
      let byProvider = byAsset.get(row.asset);
      if (!byProvider) {
        byProvider = new Map();
        byAsset.set(row.asset, byProvider);
      }
      byProvider.set(provider, {
        asset: row.asset,
        provider,
        quoteAt: source.quoteAt,
        sourceSession: source.sourceSession ?? classifySession(new Date(source.quoteAt)),
        worstSideBps: source.worstSideBps,
      });
    }
  }
  return byAsset;
}

export function pickSyntheticSeedForTarget(
  seeds: Map<RfqProvider, SyntheticSeed> | undefined,
  provider: RfqProvider
): SyntheticSeed | undefined {
  if (!seeds) return undefined;

  const direct = seeds.get(provider);
  if (direct) return direct;

  const sameMmProviders = PROVIDERS_BY_MM[MM_BY_PROVIDER[provider]].filter(
    (candidate) => candidate !== provider
  );
  const sameMmSeeds = sameMmProviders
    .map((candidate) => seeds.get(candidate))
    .filter((seed): seed is SyntheticSeed => Boolean(seed))
    .sort((a, b) => b.quoteAt.localeCompare(a.quoteAt));
  if (sameMmSeeds.length > 0) return sameMmSeeds[0];

  return Array.from(seeds.values()).sort((a, b) => b.quoteAt.localeCompare(a.quoteAt))[0];
}

export function resolveSyntheticCellValue(args: {
  enabled: boolean;
  asset: string;
  provider: RfqProvider;
  session: MarketSession;
  requiredTier: TierLevel | null;
  summary: SummaryLike;
  seed?: SyntheticSeed | null;
  now?: Date;
}): ResolvedSyntheticCell {
  const { enabled, asset, provider, session, requiredTier, summary, seed } = args;
  const now = args.now ?? new Date();
  if (summary.medianBps !== null) {
    return { bps: summary.medianBps, isSynthetic: false };
  }
  if (!enabled) return { bps: null, isSynthetic: false };
  if (requiredTier === null) return { bps: null, isSynthetic: false };
  if (!isSyntheticTargetEligible(asset, provider, session)) {
    return { bps: null, isSynthetic: false };
  }
  if (!seed || !isSyntheticSeedFresh(seed.quoteAt, now)) {
    return { bps: null, isSynthetic: false };
  }

  const sourceBand = TIER_BANDS[requiredTier][seed.sourceSession];
  const targetBand = TIER_BANDS[requiredTier][session];
  const syntheticRaw =
    seed.sourceSession === session
      ? seed.worstSideBps
      : (seed.worstSideBps / midpoint(sourceBand.minBps, sourceBand.maxBps)) *
        midpoint(targetBand.minBps, targetBand.maxBps);
  const bps = Math.min(syntheticRaw, targetBand.maxBps);

  return {
    bps,
    isSynthetic: true,
    syntheticReason: `Estimated from today's ${PROVIDER_LABEL[seed.provider]} quote due to an internal collection gap.`,
    syntheticSourceSession: seed.sourceSession,
    syntheticQuoteAt: seed.quoteAt,
  };
}
