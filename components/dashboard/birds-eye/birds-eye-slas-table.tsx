"use client";

import React, { useMemo, useState } from "react";
import {
  useBirdsEyeRfqData,
  type BirdsEyeRfqRow,
  type RfqSourceKey,
} from "@/hooks/use-birds-eye-rfq-data";
import { useRfqAssetsConfig } from "@/hooks/use-rfq-assets-config";
import {
  useRfqDailyBuckets,
  buildWeeklySessionSummary,
  groupBucketRows,
  type DailyBucketRow,
  type WeeklySessionSummary,
} from "@/hooks/use-rfq-daily-buckets";
import {
  REQUIRED_TIER_BY_ASSET,
  PROVIDERS_BY_MM,
  classifyObservedTier,
  compareObservedToRequired,
  getMarketMakerLabel,
  getMarketMakerShortLabel,
  type MarketMaker,
  type RfqProvider,
  type TierLevel,
} from "@/lib/spread-tiers";
import { getDemoTokenLogo } from "@/lib/demo/logos";
import { SESSION_LABEL, type MarketSession } from "@/lib/market-session";
import type { RfqAssetConfig } from "@/lib/rfq-asset-config";
import {
  computeRfqMarketMakerDepthBuckets,
  RFQ_DEPTH_REQUIRED_USD,
  RFQ_OUTSIDE_TOP20_DEPTH_REQUIRED_USD,
  RFQ_TOP20_DEPTH_REQUIRED_USD,
  summarizeRfqMarketMakerDepthSla,
} from "@/lib/rfq-mm-depth-rollup";
import {
  buildSyntheticSeedIndex,
  pickSyntheticSeedForTarget,
  resolveSyntheticCellValue,
  type SyntheticSeed,
} from "@/lib/rfq-synthetic-fill";
import { isDemoSpaceSlug } from "@/lib/demo/constants";

// ─── SLA attributions ───────────────────────────────────────────────────────
// MMs are attributed to the RFQ aggregators they quote on. Mirrors
// PROVIDERS_BY_MM in lib/spread-tiers.ts but typed with the top-strip's
// RfqSourceKey (which spells "0x"/"1inch" instead of "zerox"/"oneinch").
const FLOWDESK_VENUES: RfqSourceKey[] = ["0x", "bebop", "1inch"];
const TOKKA_VENUES: RfqSourceKey[] = ["cowswap", "jupz"];

const RFQ_VENUE_LABELS: Record<RfqSourceKey, string> = {
  cowswap: "CoW",
  bebop: "BB",
  "1inch": "1inch",
  "0x": "0x",
  jupz: "Jup",
};

const RFQ_VENUES_REQUIRED = 3;
const SLA_WINDOW_OPTIONS = [
  { label: "Today", days: 1 },
  { label: "2 days", days: 2 },
  { label: "7 days", days: 7 },
] as const;
const SLA_DAILY_BUCKET_ASSETS = Object.keys(REQUIRED_TIER_BY_ASSET);
const SLA_DAILY_BUCKET_PROVIDERS: RfqProvider[] = Array.from(
  new Set(Object.values(PROVIDERS_BY_MM).flat())
);
const SLA_DAILY_BUCKET_SESSIONS: MarketSession[] = [
  "market",
  "prePost",
  "weekend",
];

const XSTOCKS_TOKENS: Record<string, string> = {
  TSLAX: "TSLAx",
  NVDAX: "NVDAx",
  SPYX: "SPYx",
  QQQX: "QQQx",
  GLDX: "GLDx",
  GOOGLX: "GOOGLx",
  HOODX: "HOODx",
  CRCLX: "CRCLx",
  METAX: "METAx",
  COINX: "COINx",
  SPCXX: "SPCXx",
};

type Verdict = "good" | "warn" | "bad" | "neutral";

function xStockLogoUrl(symbol: string): string | null {
  if (!symbol) return null;
  const demoLogo = getDemoTokenLogo(symbol);
  if (demoLogo) return demoLogo;
  if (symbol.toUpperCase() === "STRCX") {
    return "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234";
  }
  const xstocksSymbol = XSTOCKS_TOKENS[symbol.toUpperCase()];
  if (!xstocksSymbol) return null;
  return `https://xstocks-metadata.backed.fi/logos/tokens/${xstocksSymbol}.png`;
}

// ─── Data types ─────────────────────────────────────────────────────────────
interface VenueRow {
  mmKey: MarketMaker;
  tone: Verdict;
  active: number;
  required: number;
  list: string;
}

interface DepthRow {
  mmKey: MarketMaker;
  tone: Verdict;
  total: string;
  totalTone: Verdict;
  delta: string;
  deltaTone: Verdict;
  top20: { flex: number; value: string; tone: Verdict };
  remaining: { flex: number; value: string; tone: Verdict };
  capacity: { flex: number };
}

interface SessionCell {
  /** Weekly median of worst-side bps. `null` = no samples yet. */
  bps: number | null;
  tone: Verdict;
  verdictLabel?: "Near limit" | "Breach";
  isSynthetic?: boolean;
  syntheticReason?: string;
  syntheticSourceSession?: MarketSession;
  syntheticQuoteAt?: string;
}

interface ComplianceVenueRow {
  mmKey: MarketMaker;
  venueKey: RfqProvider;
  venueLabel: string;
  tier: TierLevel | null;
  market: SessionCell;
  prePost: SessionCell;
  weekend: SessionCell;
}

interface AssetCompliance {
  sym: string;
  tier: TierLevel | null;
  venues: ComplianceVenueRow[];
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function formatUsdSigned(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${formatUsd(Math.abs(n))}`;
}

function buildDepthRowFromSums(
  mmKey: MarketMaker,
  topSum: number,
  restSum: number,
  isLoading: boolean
): DepthRow {
  const summary = summarizeRfqMarketMakerDepthSla(topSum, restSum);
  const rowTone: Verdict = summary.complianceShortfall === 0
    ? "good"
    : summary.totalDepth >= RFQ_DEPTH_REQUIRED_USD * 0.6
      ? "warn"
      : "bad";
  const totalTone: Verdict = summary.totalShortfall === 0
    ? "good"
    : summary.totalDepth >= RFQ_DEPTH_REQUIRED_USD * 0.6
      ? "warn"
      : "bad";

  const delta = isLoading
    ? "…"
    : summary.totalShortfall === 0
      ? `${formatUsdSigned(summary.totalDeltaUsd)} buffer`
      : `${formatUsdSigned(-summary.totalShortfall)} short`;

  // Individual segment tones: the "top-20" segment turns warn/bad if the top
  // slice falls under $5M; the remaining segment does the same under $4M.
  const topTone: Verdict = topSum >= RFQ_TOP20_DEPTH_REQUIRED_USD ? "good" : topSum >= 3_000_000 ? "warn" : "bad";
  const restTone: Verdict =
    restSum >= RFQ_OUTSIDE_TOP20_DEPTH_REQUIRED_USD ? "good" : restSum >= 2_500_000 ? "warn" : "bad";

  // Use raw USD values as the flex weights so the three segments are always
  // proportional to the $15M loan regardless of total size.
  return {
    mmKey,
    tone: rowTone,
    total: formatUsd(summary.totalDepth),
    totalTone,
    delta,
    deltaTone: totalTone,
    top20: { flex: Math.max(topSum, 1), value: formatUsd(topSum), tone: topTone },
    remaining: {
      flex: Math.max(restSum, 1),
      value: formatUsd(restSum),
      tone: restTone,
    },
    capacity: { flex: Math.max(summary.remainingCapacity, 1) },
  };
}

function buildDepthRow(
  mmKey: MarketMaker,
  rows: BirdsEyeRfqRow[],
  sources: RfqSourceKey[],
  assetConfigs: RfqAssetConfig[],
  isLoading: boolean
): DepthRow {
  const { top20Depth, outsideTop20Depth } = computeRfqMarketMakerDepthBuckets(
    rows,
    sources,
    assetConfigs,
  );

  return buildDepthRowFromSums(mmKey, top20Depth, outsideTop20Depth, isLoading);
}

// Venue rows are attributed statically by MM. "Active" for display counts
// venues that currently return quotes, but the SLA tone is driven purely by
// the count vs the minimum.
function buildVenueRow(
  mmKey: MarketMaker,
  rows: BirdsEyeRfqRow[],
  sources: RfqSourceKey[],
  isLoading: boolean
): VenueRow {
  const activeSources = sources.filter((src) =>
    rows.some((r) => (r.sources[src]?.maxDepth ?? 0) > 0)
  );
  const active = activeSources.length;
  const tone: Verdict = active >= RFQ_VENUES_REQUIRED ? "good" : "bad";
  const list = isLoading
    ? "Loading…"
    : active === 0
      ? "No active venues"
      : activeSources.map((s) => RFQ_VENUE_LABELS[s]).join(" · ");
  return { mmKey, tone, active, required: RFQ_VENUES_REQUIRED, list };
}

// ─── Live compliance-table building ─────────────────────────────────────────
const SYNTHETIC_FILL_ENABLED =
  process.env.NEXT_PUBLIC_BIRDS_EYE_SYNTHETIC_FILL_ENABLED === "true";

const EMPTY_WEEKLY_SUMMARY: WeeklySessionSummary = {
  medianBps: null,
  meanBps: null,
  sampleCount: 0,
  activeDays: 0,
};

function buildSessionCell(args: {
  asset: string;
  provider: RfqProvider;
  session: MarketSession;
  requiredTier: TierLevel | null;
  summary: WeeklySessionSummary;
  syntheticSeed?: SyntheticSeed;
}): SessionCell {
  const { asset, provider, session, requiredTier, summary, syntheticSeed } = args;
  const resolved = resolveSyntheticCellValue({
    enabled: SYNTHETIC_FILL_ENABLED,
    asset,
    provider,
    session,
    requiredTier,
    summary,
    seed: syntheticSeed,
  });
  if (resolved.bps === null) {
    return { bps: null, tone: requiredTier === null ? "neutral" : "good" };
  }
  if (requiredTier === null) {
    return {
      bps: Math.round(resolved.bps),
      tone: "neutral",
      isSynthetic: resolved.isSynthetic,
      syntheticReason: resolved.syntheticReason,
      syntheticSourceSession: resolved.syntheticSourceSession,
      syntheticQuoteAt: resolved.syntheticQuoteAt,
    };
  }
  const observed = classifyObservedTier(resolved.bps, session);
  const compliance = compareObservedToRequired(observed, requiredTier);
  const tone: Verdict =
    compliance === "ok" ? "good" : compliance === "warn" ? "warn" : "bad";
  let verdictLabel: SessionCell["verdictLabel"];
  if (compliance === "warn") verdictLabel = "Near limit";
  else if (compliance === "breach") verdictLabel = "Breach";
  return {
    bps: Math.round(resolved.bps),
    tone,
    verdictLabel,
    isSynthetic: resolved.isSynthetic,
    syntheticReason: resolved.syntheticReason,
    syntheticSourceSession: resolved.syntheticSourceSession,
    syntheticQuoteAt: resolved.syntheticQuoteAt,
  };
}

const MM_ORDER: { key: MarketMaker }[] = [
  { key: "flowdesk" },
  { key: "tokka" },
];

const PROVIDER_LABEL_DISPLAY: Record<RfqProvider, string> = {
  oneinch: "1inch",
  zerox: "0x",
  bebop: "Bebop",
  cowswap: "CowSwap",
  jupz: "JupZ",
};

function venueSessionSummary(
  byProvider: Map<RfqProvider, Map<MarketSession, DailyBucketRow[]>> | undefined,
  provider: RfqProvider,
  session: MarketSession
): WeeklySessionSummary {
  const bySession = byProvider?.get(provider);
  if (!bySession) return EMPTY_WEEKLY_SUMMARY;
  return buildWeeklySessionSummary(bySession.get(session) ?? []);
}

function buildComplianceLegacy(
  byAsset: Map<string, Map<RfqProvider, Map<MarketSession, DailyBucketRow[]>>>,
  syntheticSeedIndex: ReturnType<typeof buildSyntheticSeedIndex>,
  assetConfigs?: RfqAssetConfig[]
): AssetCompliance[] {
  const out: AssetCompliance[] = [];
  const assetRows = assetConfigs?.length
    ? assetConfigs.map((row) => ({
        asset: row.asset,
        requiredTier: row.requiredTier,
      }))
    : Object.keys(REQUIRED_TIER_BY_ASSET).map((asset) => ({
        asset,
        requiredTier: REQUIRED_TIER_BY_ASSET[asset],
      }));

  for (const { asset, requiredTier } of assetRows) {
    const providerIndex = byAsset.get(asset);
    const syntheticSeeds = syntheticSeedIndex.get(asset);
    const venues: ComplianceVenueRow[] = [];

    for (const { key } of MM_ORDER) {
      for (const providerKey of PROVIDERS_BY_MM[key]) {
        venues.push({
          mmKey: key,
          venueKey: providerKey,
          venueLabel: PROVIDER_LABEL_DISPLAY[providerKey],
          tier: requiredTier,
          market: buildSessionCell({
            asset,
            provider: providerKey,
            session: "market",
            requiredTier,
            summary: venueSessionSummary(providerIndex, providerKey, "market"),
            syntheticSeed: pickSyntheticSeedForTarget(syntheticSeeds, providerKey),
          }),
          prePost: buildSessionCell({
            asset,
            provider: providerKey,
            session: "prePost",
            requiredTier,
            summary: venueSessionSummary(providerIndex, providerKey, "prePost"),
            syntheticSeed: pickSyntheticSeedForTarget(syntheticSeeds, providerKey),
          }),
          weekend: buildSessionCell({
            asset,
            provider: providerKey,
            session: "weekend",
            requiredTier,
            summary: venueSessionSummary(providerIndex, providerKey, "weekend"),
            syntheticSeed: pickSyntheticSeedForTarget(syntheticSeeds, providerKey),
          }),
        });
      }
    }

    out.push({ sym: asset, tier: requiredTier, venues });
  }

  out.sort((a, b) => a.sym.localeCompare(b.sym));
  return out;
}

// ─── Tone helpers ───────────────────────────────────────────────────────────
const toneBg = (t: Verdict) =>
  t === "good"
    ? "var(--ts-good-soft)"
    : t === "warn"
      ? "var(--ts-warn-soft)"
      : t === "neutral"
        ? "var(--ts-surface-2)"
        : "var(--ts-bad-soft)";

const toneFg = (t: Verdict) =>
  t === "good"
    ? "var(--ts-good)"
    : t === "warn"
      ? "var(--ts-warn)"
      : t === "neutral"
        ? "var(--ts-ink-1)"
        : "var(--ts-bad)";

const toneSolidFg = (t: Verdict) =>
  t === "warn" ? "var(--ts-ink-0)" : "var(--ts-ink-inv)";

// ─── Shared primitives ──────────────────────────────────────────────────────
function CornerBrackets({
  size = 5,
  inset = 4,
  thickness = 1.5,
  color = "var(--ts-ink-0)",
  z = 10,
}: {
  size?: number;
  inset?: number;
  thickness?: number;
  color?: string;
  z?: number;
}) {
  const border = `${thickness}px solid ${color}`;
  return (
    <>
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: inset,
          left: inset,
          width: size,
          height: size,
          borderTop: border,
          borderLeft: border,
          zIndex: z,
        }}
      />
      <span
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          bottom: inset,
          right: inset,
          width: size,
          height: size,
          borderBottom: border,
          borderRight: border,
          zIndex: z,
        }}
      />
    </>
  );
}

function LogoBox({
  size,
  border = "1px solid var(--ts-line-hard)",
  label,
  tokenSymbol,
  labelSize,
}: {
  size: number;
  border?: string;
  label?: string;
  tokenSymbol?: string;
  labelSize?: number;
}) {
  return (
    <div
      className="relative overflow-hidden shrink-0 grid place-items-center"
      style={{
        width: size,
        height: size,
        border,
        background: "var(--ts-surface)",
        borderRadius: 2,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
    >
      {tokenSymbol && xStockLogoUrl(tokenSymbol) ? (
        <img
          src={xStockLogoUrl(tokenSymbol)!}
          alt={tokenSymbol}
          className="w-full h-full object-cover"
          style={{ display: "block" }}
        />
      ) : (
        <>
          <span
            aria-hidden
            className="absolute left-0 right-0"
            style={{
              top: "50%",
              height: 1,
              background: "var(--ts-line-hard)",
              transform: "rotate(-45deg)",
            }}
          />
          {label && (
            <span
              className="relative font-mono font-bold"
              style={{
                fontSize: labelSize ?? 7,
                color: "var(--ts-ink-3)",
                letterSpacing: "0.14em",
                background: "var(--ts-surface)",
                padding: "1px 2px",
                zIndex: 1,
              }}
            >
              {label}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── SLA matrix (top strip) ────────────────────────────────────────────────
function SlaBlock({
  title,
  rule,
  children,
}: {
  title: string;
  rule: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden flex flex-col"
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-line-hard)",
        borderRadius: 2,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
    >
      <CornerBrackets size={6} inset={5} thickness={1.5} z={2} />
      {/* Head band */}
      <div
        className="flex items-baseline justify-between"
        style={{
          background: "var(--ts-ink-0)",
          color: "var(--ts-ink-inv)",
          padding: "7px 14px 8px",
          gap: 10,
        }}
      >
        <span
          className="font-mono font-bold uppercase"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.22em",
            color: "var(--ts-ink-inv)",
          }}
        >
          {title}
        </span>
        <span
          className="font-mono font-medium"
          style={{
            fontSize: 10,
            color: "var(--ts-ink-4)",
            letterSpacing: "0.04em",
            fontFeatureSettings: 'var(--tnum)',
          }}
        >
          {rule}
        </span>
      </div>
      <div className="grid grid-cols-1 auto-rows-fr flex-1">{children}</div>
    </div>
  );
}

function MMIdentity({
  mmKey,
  tone,
  spaceSlug,
}: {
  mmKey: MarketMaker;
  tone: Verdict;
  spaceSlug?: string | null;
}) {
  const label = getMarketMakerLabel(mmKey, spaceSlug);
  const shortLabel = getMarketMakerShortLabel(mmKey, spaceSlug);
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 100 }}>
      <LogoBox
        size={24}
        border={`1.5px solid ${toneFg(tone)}`}
        label={shortLabel}
        labelSize={7}
      />
      <span
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--bp-font-text)",
          fontSize: 13,
          letterSpacing: "-0.015em",
          color: "var(--ts-ink-0)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function VenueSlaRow({
  row,
  last,
  spaceSlug,
}: {
  row: VenueRow;
  last?: boolean;
  spaceSlug?: string | null;
}) {
  return (
    <div
      className="flex items-center gap-3"
      style={{
        padding: "8px 14px",
        minHeight: 56,
        background: toneBg(row.tone),
        borderBottom: last ? "none" : "1px solid var(--ts-line-soft)",
      }}
    >
      <MMIdentity mmKey={row.mmKey} tone={row.tone} spaceSlug={spaceSlug} />
      <div className="flex items-baseline gap-1 ml-auto">
        <span
          className="font-mono font-bold leading-none"
          style={{
            fontSize: 26,
            letterSpacing: "-0.035em",
            color: toneFg(row.tone),
            fontFeatureSettings: 'var(--tnum)',
          }}
        >
          {row.active}
        </span>
        <span
          className="font-mono font-medium"
          style={{
            fontSize: 14,
            color: "var(--ts-ink-3)",
            letterSpacing: "-0.01em",
          }}
        >
          / {row.required}
        </span>
      </div>
      <span
        className="font-mono font-medium uppercase"
        style={{
          fontSize: 9,
          color: "var(--ts-ink-2)",
          letterSpacing: "0.14em",
          marginLeft: 10,
          paddingLeft: 10,
          borderLeft: "1px dashed var(--ts-line-hard)",
        }}
      >
        {row.list}
      </span>
    </div>
  );
}

function DepthSlaRow({
  row,
  last,
  spaceSlug,
}: {
  row: DepthRow;
  last?: boolean;
  spaceSlug?: string | null;
}) {
  const segs = [
    { flex: row.top20.flex, tone: row.top20.tone, label: row.top20.value },
    { flex: row.remaining.flex, tone: row.remaining.tone, label: row.remaining.value },
    { flex: row.capacity.flex, tone: "muted" as const, label: "" },
  ];
  const splitStats = [
    { label: "top-20", value: row.top20.value, tone: row.top20.tone },
    { label: "outside top-20", value: row.remaining.value, tone: row.remaining.tone },
  ];
  return (
    <div
      className="flex items-center gap-3"
      style={{
        padding: "8px 14px",
        minHeight: 56,
        background: toneBg(row.tone),
        borderBottom: last ? "none" : "1px solid var(--ts-line-soft)",
      }}
    >
      <MMIdentity mmKey={row.mmKey} tone={row.tone} spaceSlug={spaceSlug} />
      <div className="flex-1 flex flex-col gap-[5px] min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono font-bold leading-none"
            style={{
              fontSize: 20,
              letterSpacing: "-0.035em",
              color: toneFg(row.totalTone),
              fontFeatureSettings: 'var(--tnum)',
            }}
          >
            {row.total}
          </span>
          <span
            className="font-mono font-semibold leading-none"
            style={{
              fontSize: 10,
              letterSpacing: "0.04em",
              padding: "2px 5px 3px",
              borderRadius: 1,
              background: toneFg(row.deltaTone),
              color: toneSolidFg(row.deltaTone),
              fontFeatureSettings: 'var(--tnum)',
            }}
          >
            {row.delta}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {splitStats.map((stat) => (
            <span
              key={stat.label}
              className="font-mono font-semibold uppercase"
              style={{
                fontSize: 8.5,
                letterSpacing: "0.08em",
                color: "var(--ts-ink-2)",
                fontFeatureSettings: 'var(--tnum)',
              }}
            >
              {stat.label}{" "}
              <strong
                style={{
                  color: toneFg(stat.tone),
                  fontWeight: 800,
                }}
              >
                {stat.value}
              </strong>
            </span>
          ))}
        </div>
        <div
          className="flex"
          style={{
            height: 10,
            border: "1px solid var(--ts-line-hard)",
            borderRadius: 1,
            overflow: "hidden",
            background: "var(--ts-surface)",
          }}
        >
          {segs.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-center font-mono font-bold whitespace-nowrap overflow-hidden"
              style={{
                flex: s.flex,
                background:
                  s.tone === "muted"
                    ? "var(--ts-surface-4)"
                    : toneFg(s.tone as Verdict),
                color:
                  s.tone === "muted"
                    ? "var(--ts-ink-2)"
                    : toneSolidFg(s.tone as Verdict),
                borderRight:
                  i < segs.length - 1 ? "1px solid var(--ts-ink-0)" : "none",
                fontSize: 7.5,
                letterSpacing: "-0.01em",
                fontFeatureSettings: 'var(--tnum)',
              }}
            >
              {s.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SlaMatrix({
  rows,
  isLoading,
  assetConfigs,
  spaceSlug,
}: {
  rows: BirdsEyeRfqRow[];
  isLoading: boolean;
  assetConfigs: RfqAssetConfig[];
  spaceSlug?: string | null;
}) {
  const { venueRows, depthRows } = useMemo(() => {
    const venueRows: VenueRow[] = [
      buildVenueRow("flowdesk", rows, FLOWDESK_VENUES, isLoading),
      buildVenueRow("tokka", rows, TOKKA_VENUES, isLoading),
    ];
    const depthRows: DepthRow[] = [
      buildDepthRow("flowdesk", rows, FLOWDESK_VENUES, assetConfigs, isLoading),
      buildDepthRow("tokka", rows, TOKKA_VENUES, assetConfigs, isLoading),
    ];
    return { venueRows, depthRows };
  }, [assetConfigs, isLoading, rows]);

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: "1fr 1.3fr" }}
    >
      <SlaBlock
        title="SLA · RFQ Venue Count"
        rule={
          <>
            Min{" "}
            <strong style={{ color: "var(--ts-ink-inv)", fontWeight: 700 }}>
              {RFQ_VENUES_REQUIRED}
            </strong>{" "}
            venues active
          </>
        }
      >
        {venueRows.map((row, i) => (
          <VenueSlaRow key={row.mmKey} row={row} last={i === venueRows.length - 1} spaceSlug={spaceSlug} />
        ))}
      </SlaBlock>
      <SlaBlock
        title="SLA · RFQ Depth · Notional"
        rule={
          <>
            <strong style={{ color: "var(--ts-ink-inv)", fontWeight: 700 }}>$9.0M</strong>{" "}
            req. · $5M top-20 · $4M outside top-20
          </>
        }
      >
        {depthRows.map((row, i) => (
          <DepthSlaRow key={row.mmKey} row={row} last={i === depthRows.length - 1} spaceSlug={spaceSlug} />
        ))}
      </SlaBlock>
    </div>
  );
}

// ─── Compliance table (sessions as columns, per-venue rows) ─────────────────
const TH_STYLE: React.CSSProperties = {
  background: "var(--ts-ink-0)",
  color: "var(--ts-ink-4)",
  padding: "8px 12px 9px",
  textAlign: "left",
  borderRight: "1px solid var(--ts-ink-1)",
  fontFamily: "var(--bp-font-numeric)",
  fontSize: 9,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  fontWeight: 700,
  verticalAlign: "middle",
};

type SortDir = "asc" | "desc";

function SortIndicator({
  active,
  dir,
}: {
  active: boolean;
  dir: SortDir | null;
}) {
  const arrow = dir === "asc" ? "▲" : "▼";
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        marginLeft: 6,
        fontSize: 9,
        lineHeight: 1,
        opacity: active ? 1 : 0.35,
        transition: "opacity 120ms ease",
        color: "var(--ts-ink-inv)",
      }}
    >
      {active && dir ? arrow : "▼"}
    </span>
  );
}

function SessionHeaderCell({
  name,
  rule,
  active,
  dir,
  onClick,
}: {
  name: string;
  rule?: string;
  active?: boolean;
  dir?: SortDir | null;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  return (
    <th
      onClick={onClick}
      style={{
        ...TH_STYLE,
        textAlign: "center",
        padding: "6px 12px 8px",
        cursor: clickable ? "pointer" : undefined,
        userSelect: clickable ? "none" : undefined,
        background: active ? "var(--ts-ink-1)" : TH_STYLE.background,
      }}
    >
      <div className="flex flex-col items-center gap-[2px]">
        <span
          style={{
            fontFamily: "var(--bp-font-text)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--ts-ink-inv)",
            textTransform: "none",
          }}
        >
          {name}
          {clickable && <SortIndicator active={!!active} dir={dir ?? null} />}
        </span>
        {rule && (
          <span
            style={{
              fontSize: 9,
              color: "var(--ts-ink-4)",
              fontWeight: 500,
              letterSpacing: "0.04em",
              textTransform: "none",
            }}
          >
            {rule}
          </span>
        )}
      </div>
    </th>
  );
}

type SortColumn = "tier" | "market" | "prePost" | "weekend";

function sessionSortKey(col: SortColumn): "market" | "prePost" | "weekend" | null {
  switch (col) {
    case "market":
      return "market";
    case "prePost":
      return "prePost";
    case "weekend":
      return "weekend";
    case "tier":
      return null;
  }
  return null;
}

function sortValueFor(asset: AssetCompliance, col: SortColumn): number {
  if (col === "tier") return asset.tier ?? -1;

  const key = sessionSortKey(col);
  if (!key) return -1;

  let worst = Number.NEGATIVE_INFINITY;
  for (const venue of asset.venues) {
    const bps = venue[key].bps;
    if (bps !== null && bps > worst) worst = bps;
  }
  return Number.isFinite(worst) ? worst : -1;
}

interface GranularRow {
  asset: AssetCompliance;
  venue: ComplianceVenueRow;
}

function granularSortValue(row: GranularRow, col: SortColumn): number {
  if (col === "tier") return row.asset.tier ?? -1;
  const key = sessionSortKey(col);
  if (!key) return -1;
  const bps = row.venue[key].bps;
  return bps !== null ? bps : -1;
}

function formatSyntheticQuoteAt(quoteAt: string): string {
  const date = new Date(quoteAt);
  if (Number.isNaN(date.getTime())) return quoteAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function syntheticCellTitle(cell: SessionCell): string | undefined {
  if (!cell.isSynthetic || !cell.syntheticSourceSession || !cell.syntheticQuoteAt) {
    return cell.syntheticReason;
  }
  const from = SESSION_LABEL[cell.syntheticSourceSession];
  const at = formatSyntheticQuoteAt(cell.syntheticQuoteAt);
  return `${cell.syntheticReason} Source: ${from} at ${at} ET.`;
}

function ComplianceBpsCell({
  cell,
  hoverStyle,
}: {
  cell: SessionCell;
  hoverStyle?: React.CSSProperties;
}) {
  const isEmpty = cell.bps === null;
  const bg = isEmpty ? "var(--ts-surface-2)" : toneBg(cell.tone);
  const syntheticTitle = syntheticCellTitle(cell);
  return (
    <td
      style={{
        background: bg,
        padding: 0,
        borderRight: "1px solid var(--ts-line-soft)",
        borderBottom: "1px solid var(--ts-line-soft)",
        transition: "filter 120ms ease",
        ...hoverStyle,
      }}
    >
      <div
        className="flex flex-row justify-center items-center gap-[5px]"
        style={{ padding: "4px 10px", minHeight: 24 }}
      >
        {cell.isSynthetic && !isEmpty && (
          <span
            className="font-mono font-bold uppercase"
            title={syntheticTitle}
            style={{
              fontSize: 7,
              letterSpacing: "0.14em",
              padding: "1px 4px 2px",
              borderRadius: 1,
              background: "var(--ts-ink-2)",
              color: "var(--ts-ink-inv)",
              lineHeight: 1,
              cursor: "help",
            }}
          >
            Est.
          </span>
        )}
        <span
          className="font-mono font-bold leading-none"
          title={syntheticTitle}
          style={{
            fontSize: 13,
            letterSpacing: "-0.025em",
            color: isEmpty ? "var(--ts-ink-4)" : toneFg(cell.tone),
            fontFeatureSettings: "var(--tnum)",
          }}
        >
          {isEmpty ? "—" : cell.bps}
          {!isEmpty && (
            <span
              className="font-medium"
              style={{
                fontSize: 8,
                color: "var(--ts-ink-2)",
                letterSpacing: "-0.005em",
                marginLeft: 2,
              }}
            >
              bps
            </span>
          )}
        </span>
      </div>
    </td>
  );
}

interface HoverKey {
  asset: string;
  mmKey: MarketMaker;
  venueKey: RfqProvider;
}

const HL_TOP = "inset 0 2.5px 0 var(--ts-ink-0)";
const HL_BOTTOM = "inset 0 -2.5px 0 var(--ts-ink-0)";
const HL_LEFT = "inset 2.5px 0 0 var(--ts-ink-0)";
const HL_RIGHT = "inset -2.5px 0 0 var(--ts-ink-0)";
const HL_GLOW_TOP = "inset 0 3.5px 0 -2.5px rgba(255,255,255,0.6)";
const HL_GLOW_BOTTOM = "inset 0 -3.5px 0 -2.5px rgba(10,9,6,0.12)";
const HL_FILTER = "saturate(1.22) brightness(1.07) contrast(1.05)";

function hoverOutlineStyle(
  position: "left" | "middle" | "right"
): React.CSSProperties {
  const parts = [HL_TOP, HL_BOTTOM, HL_GLOW_TOP, HL_GLOW_BOTTOM];
  if (position === "left") parts.push(HL_LEFT);
  if (position === "right") parts.push(HL_RIGHT);
  return {
    boxShadow: parts.join(", "),
    filter: HL_FILTER,
    zIndex: 1,
    position: "relative",
  };
}

function TierBadge({ tier }: { tier: TierLevel | null }) {
  const bg =
    tier === null
      ? "var(--ts-ink-2)"
      : tier === 1
      ? "var(--ts-ink-3)"
      : tier === 2
        ? "var(--ts-ink-1)"
        : "var(--ts-ink-0)";
  return (
    <span
      className="font-mono font-bold"
      style={{
        fontSize: 10,
        padding: "2px 6px 3px",
        borderRadius: 1,
        background: bg,
        color: "var(--ts-ink-inv)",
        letterSpacing: "0.1em",
        lineHeight: 1,
        display: "inline-block",
      }}
    >
      {tier === null ? "T?" : `T${tier}`}
    </span>
  );
}

type SlaViewMode = "mm" | "granular";
const SLA_VIEW_MODE_OPTIONS: { value: SlaViewMode; label: string }[] = [
  { value: "mm", label: "MM" },
  { value: "granular", label: "Granular" },
];

function SlaSegmentedToggle<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-[7px]">
      <span
        className="font-mono font-bold uppercase"
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          color: "var(--ts-ink-3)",
        }}
      >
        {label}
      </span>
      <div
        className="inline-flex overflow-hidden"
        style={{
          border: "1px solid var(--ts-line-hard)",
          borderRadius: 2,
          background: "var(--ts-surface)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {options.map((option, idx) => {
          const isActive = option.value === value;
          const isLast = idx === options.length - 1;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className="font-mono font-bold uppercase"
              style={{
                minWidth: 50,
                padding: "5px 9px 6px",
                border: "none",
                borderRight: isLast ? "none" : "1px solid var(--ts-line)",
                background: isActive ? "var(--ts-ink-0)" : "transparent",
                color: isActive ? "var(--ts-ink-inv)" : "var(--ts-ink-2)",
                fontSize: 9,
                letterSpacing: "0.06em",
                cursor: "pointer",
                transition:
                  "background-color 120ms ease, color 120ms ease, filter 120ms ease",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlaWindowFilter({
  selectedDays,
  onChange,
}: {
  selectedDays: (typeof SLA_WINDOW_OPTIONS)[number]["days"];
  onChange: (days: (typeof SLA_WINDOW_OPTIONS)[number]["days"]) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-[7px]">
      <span
        className="font-mono font-bold uppercase"
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          color: "var(--ts-ink-3)",
        }}
      >
        Window
      </span>
      <div
        className="inline-flex overflow-hidden"
        style={{
          border: "1px solid var(--ts-line-hard)",
          borderRadius: 2,
          background: "var(--ts-surface)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        {SLA_WINDOW_OPTIONS.map((option) => {
          const isActive = option.days === selectedDays;
          return (
            <button
              key={option.days}
              type="button"
              onClick={() => onChange(option.days)}
              className="font-mono font-bold uppercase"
              style={{
                minWidth: 50,
                padding: "5px 9px 6px",
                border: "none",
                borderRight:
                  option.days === 7 ? "none" : "1px solid var(--ts-line)",
                background: isActive ? "var(--ts-ink-0)" : "transparent",
                color: isActive ? "var(--ts-ink-inv)" : "var(--ts-ink-2)",
                fontSize: 9,
                letterSpacing: "0.06em",
                cursor: "pointer",
                transition:
                  "background-color 120ms ease, color 120ms ease, filter 120ms ease",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ComplianceTable({
  assets,
  spaceSlug,
  viewMode,
}: {
  assets: AssetCompliance[];
  spaceSlug?: string | null;
  viewMode: SlaViewMode;
}) {
  const isGranular = viewMode === "granular";
  const [hover, setHover] = useState<HoverKey | null>(null);
  const [sort, setSort] =
    useState<{ col: SortColumn; dir: SortDir } | null>(null);

  const toggleSort = (col: SortColumn) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "desc" };
      if (prev.dir === "desc") return { col, dir: "asc" };
      return null;
    });
  };

  const sortedAssets = useMemo(() => {
    if (!sort) return assets;
    const nextAssets = [...assets];
    nextAssets.sort((a, b) => {
      const aValue = sortValueFor(a, sort.col);
      const bValue = sortValueFor(b, sort.col);
      if (aValue === bValue) return a.sym.localeCompare(b.sym);
      return sort.dir === "asc" ? aValue - bValue : bValue - aValue;
    });
    return nextAssets;
  }, [assets, sort]);

  // In granular mode each (asset, venue) pair is its own row, so sorting must
  // operate on the row's own bps — not the asset's worst — to put the actual
  // biggest values at the top under desc sort.
  const sortedGranularRows = useMemo<GranularRow[]>(() => {
    const rows: GranularRow[] = [];
    for (const asset of assets) {
      for (const venue of asset.venues) rows.push({ asset, venue });
    }
    if (!sort) return rows;
    rows.sort((a, b) => {
      const aValue = granularSortValue(a, sort.col);
      const bValue = granularSortValue(b, sort.col);
      if (aValue === bValue) {
        const symCmp = a.asset.sym.localeCompare(b.asset.sym);
        if (symCmp !== 0) return symCmp;
        return a.venue.venueLabel.localeCompare(b.venue.venueLabel);
      }
      return sort.dir === "asc" ? aValue - bValue : bValue - aValue;
    });
    return rows;
  }, [assets, sort]);

  const sortedCol = sort?.col;
  const sortedDir = sort?.dir ?? null;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-line-hard)",
        borderRadius: 2,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(10,9,6,0.04)",
      }}
    >
      <CornerBrackets size={7} inset={5} thickness={1.5} />
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--bp-font-numeric)",
          fontFeatureSettings: "var(--tnum)",
        }}
      >
        <thead>
          <tr>
            <th style={{ ...TH_STYLE, minWidth: 130 }}>Asset</th>
            <th
              onClick={() => toggleSort("tier")}
              style={{
                ...TH_STYLE,
                minWidth: 56,
                textAlign: "center",
                cursor: "pointer",
                userSelect: "none",
                background:
                  sortedCol === "tier" ? "var(--ts-ink-1)" : TH_STYLE.background,
              }}
            >
              Tier
              <SortIndicator
                active={sortedCol === "tier"}
                dir={sortedCol === "tier" ? sortedDir : null}
              />
            </th>
            <th style={{ ...TH_STYLE, minWidth: 70, textAlign: "center" }}>MM</th>
            <th style={{ ...TH_STYLE, minWidth: 86 }}>Venue</th>
            <SessionHeaderCell
              name="Market Hours"
              active={sortedCol === "market"}
              dir={sortedCol === "market" ? sortedDir : null}
              onClick={() => toggleSort("market")}
            />
            <SessionHeaderCell
              name="Pre / Post"
              active={sortedCol === "prePost"}
              dir={sortedCol === "prePost" ? sortedDir : null}
              onClick={() => toggleSort("prePost")}
            />
            <SessionHeaderCell
              name="Weekend"
              active={sortedCol === "weekend"}
              dir={sortedCol === "weekend" ? sortedDir : null}
              onClick={() => toggleSort("weekend")}
            />
          </tr>
        </thead>
        <tbody>
          {isGranular &&
            sortedGranularRows.map((row, idx) => {
              const { asset, venue } = row;
              const isLast = idx === sortedGranularRows.length - 1;
              const borderBottom = isLast
                ? "none"
                : "1px solid var(--ts-line-soft)";
              // Granular mode: hover highlights ONLY the row under the cursor
              // (not the whole asset block like MM view).
              const rowHovered =
                hover?.asset === asset.sym &&
                hover?.mmKey === venue.mmKey &&
                hover?.venueKey === venue.venueKey;
              const assetOutline = rowHovered
                ? hoverOutlineStyle("left")
                : undefined;
              const tierOutline = rowHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const mmOutline = rowHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const venueOutline = rowHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const marketOutline = rowHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const weekendOutline = rowHovered
                ? hoverOutlineStyle("right")
                : undefined;
              return (
                <tr
                  key={`${asset.sym}-${venue.mmKey}-${venue.venueKey}`}
                  onMouseEnter={() =>
                    setHover({
                      asset: asset.sym,
                      mmKey: venue.mmKey,
                      venueKey: venue.venueKey,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  <td
                    style={{
                      padding: "6px 12px",
                      background: "var(--ts-surface-2)",
                      borderRight: "1px solid var(--ts-line)",
                      borderBottom,
                      verticalAlign: "middle",
                      transition: "filter 120ms ease",
                      ...assetOutline,
                    }}
                  >
                    <div className="flex items-center gap-[9px]">
                      <LogoBox
                        size={24}
                        border="1.5px solid var(--ts-ink-0)"
                        tokenSymbol={asset.sym}
                      />
                      <span
                        className="font-mono font-bold leading-none"
                        style={{
                          fontSize: 12,
                          color: "var(--ts-ink-0)",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {asset.sym.toUpperCase()}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "3px 10px",
                      background: "var(--ts-surface-2)",
                      borderRight: "1px solid var(--ts-line)",
                      borderBottom,
                      verticalAlign: "middle",
                      textAlign: "center",
                      transition: "filter 120ms ease",
                      ...tierOutline,
                    }}
                  >
                    <TierBadge tier={asset.tier} />
                  </td>
                  <td
                    style={{
                      padding: "4px 10px",
                      background: "var(--ts-surface-2)",
                      borderRight: "1px solid var(--ts-line)",
                      borderBottom,
                      verticalAlign: "middle",
                      textAlign: "center",
                      transition: "filter 120ms ease",
                      ...mmOutline,
                    }}
                  >
                    <div className="inline-flex items-center gap-[6px]">
                      <LogoBox
                        size={16}
                        label={getMarketMakerShortLabel(venue.mmKey, spaceSlug)}
                        labelSize={5.5}
                      />
                      <span
                        className="font-mono font-bold"
                        style={{
                          fontSize: 10,
                          color: "var(--ts-ink-0)",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {getMarketMakerShortLabel(venue.mmKey, spaceSlug)}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "3px 12px",
                      background: "var(--ts-surface)",
                      borderRight: "1px solid var(--ts-line)",
                      borderBottom,
                      verticalAlign: "middle",
                      transition: "filter 120ms ease",
                      ...venueOutline,
                    }}
                  >
                    <span
                      className="font-mono font-semibold"
                      style={{
                        fontSize: 10.5,
                        color: "var(--ts-ink-1)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {venue.venueLabel}
                    </span>
                  </td>
                  <ComplianceBpsCell
                    cell={venue.market}
                    hoverStyle={marketOutline}
                  />
                  <ComplianceBpsCell
                    cell={venue.prePost}
                    hoverStyle={marketOutline}
                  />
                  <ComplianceBpsCell
                    cell={venue.weekend}
                    hoverStyle={weekendOutline}
                  />
                </tr>
              );
            })}
          {!isGranular &&
            sortedAssets.map((asset, assetIdx) => {
            const fdVenues = asset.venues.filter((v) => v.mmKey === "flowdesk");
            const tkVenues = asset.venues.filter((v) => v.mmKey === "tokka");
            const totalRows = fdVenues.length + tkVenues.length;
            const isLastAsset = assetIdx === sortedAssets.length - 1;

            return asset.venues.map((venue, venueIdx) => {
              const groupVenues = venue.mmKey === "flowdesk" ? fdVenues : tkVenues;
              const groupStart =
                venue.mmKey === "flowdesk" ? 0 : fdVenues.length;
              const isFirstInGroup = venueIdx === groupStart;
              const isFirstInAsset = venueIdx === 0;
              const isLastRowOfAsset = venueIdx === totalRows - 1;
              const isAbsoluteLast = isLastAsset && isLastRowOfAsset;
              const borderBottom = isAbsoluteLast
                ? "none"
                : isLastRowOfAsset
                  ? "2px solid var(--ts-line-hard)"
                  : "1px solid var(--ts-line-soft)";
              const assetHovered = hover?.asset === asset.sym;
              const mmHovered = assetHovered && hover?.mmKey === venue.mmKey;
              const rowHovered =
                mmHovered && hover?.venueKey === venue.venueKey;
              const assetOutline = assetHovered
                ? hoverOutlineStyle("left")
                : undefined;
              const tierOutline = assetHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const mmOutline = mmHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const venueOutline = rowHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const marketOutline = rowHovered
                ? hoverOutlineStyle("middle")
                : undefined;
              const weekendOutline = rowHovered
                ? hoverOutlineStyle("right")
                : undefined;

              return (
                <tr
                  key={`${asset.sym}-${venue.venueKey}`}
                  onMouseEnter={() =>
                    setHover({
                      asset: asset.sym,
                      mmKey: venue.mmKey,
                      venueKey: venue.venueKey,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  {isFirstInAsset && (
                    <td
                      rowSpan={totalRows}
                      style={{
                        padding: "6px 12px",
                        background: "var(--ts-surface-2)",
                        borderRight: "1px solid var(--ts-line)",
                        borderBottom,
                        verticalAlign: "middle",
                        transition: "filter 120ms ease",
                        ...assetOutline,
                      }}
                    >
                      <div className="flex items-center gap-[9px]">
                        <LogoBox
                          size={24}
                          border="1.5px solid var(--ts-ink-0)"
                          tokenSymbol={asset.sym}
                        />
                        <span
                          className="font-mono font-bold leading-none"
                          style={{
                            fontSize: 12,
                            color: "var(--ts-ink-0)",
                            letterSpacing: "0.02em",
                          }}
                        >
                          {asset.sym.toUpperCase()}
                        </span>
                      </div>
                    </td>
                  )}
                  {isFirstInAsset && (
                    <td
                      rowSpan={totalRows}
                      style={{
                        padding: "3px 10px",
                        background: "var(--ts-surface-2)",
                        borderRight: "1px solid var(--ts-line)",
                        borderBottom,
                        verticalAlign: "middle",
                        textAlign: "center",
                        transition: "filter 120ms ease",
                        ...tierOutline,
                      }}
                    >
                      <TierBadge tier={asset.tier} />
                    </td>
                  )}
                  {isFirstInGroup && (
                    <td
                      rowSpan={groupVenues.length}
                      style={{
                        padding: "4px 10px",
                        background: "var(--ts-surface-2)",
                        borderRight: "1px solid var(--ts-line)",
                        borderBottom,
                        verticalAlign: "middle",
                        textAlign: "center",
                        transition: "filter 120ms ease",
                        ...mmOutline,
                      }}
                    >
                      <div className="inline-flex items-center gap-[6px]">
                        <LogoBox
                          size={16}
                          label={getMarketMakerShortLabel(venue.mmKey, spaceSlug)}
                          labelSize={5.5}
                        />
                        <span
                          className="font-mono font-bold"
                          style={{
                            fontSize: 10,
                            color: "var(--ts-ink-0)",
                            letterSpacing: "0.08em",
                          }}
                        >
                          {getMarketMakerShortLabel(venue.mmKey, spaceSlug)}
                        </span>
                      </div>
                    </td>
                  )}
                  <td
                    style={{
                      padding: "3px 12px",
                      background: "var(--ts-surface)",
                      borderRight: "1px solid var(--ts-line)",
                      borderBottom: isLastRowOfAsset && !isAbsoluteLast
                        ? "2px solid var(--ts-line-hard)"
                        : isAbsoluteLast
                          ? "none"
                          : "1px solid var(--ts-line-soft)",
                      verticalAlign: "middle",
                      transition: "filter 120ms ease",
                      ...venueOutline,
                    }}
                  >
                    <span
                      className="font-mono font-semibold"
                      style={{
                        fontSize: 10.5,
                        color: "var(--ts-ink-1)",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {venue.venueLabel}
                    </span>
                  </td>
                  <ComplianceBpsCell cell={venue.market} hoverStyle={marketOutline} />
                  <ComplianceBpsCell cell={venue.prePost} hoverStyle={marketOutline} />
                  <ComplianceBpsCell cell={venue.weekend} hoverStyle={weekendOutline} />
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────────
export function BirdsEyeSlasTable({
  spaceSlug,
}: {
  spaceSlug?: string | null;
}) {
  // The registry powers the depth split only. The SLA table intentionally
  // keeps the original visible asset list until product expands that matrix.
  const rfqAssetsConfig = useRfqAssetsConfig(spaceSlug);
  const [slaWindowDays, setSlaWindowDays] =
    useState<(typeof SLA_WINDOW_OPTIONS)[number]["days"]>(7);
  const [slaViewMode, setSlaViewMode] = useState<SlaViewMode>("mm");
  const isDemo = isDemoSpaceSlug(spaceSlug);
  const slaAssets = useMemo(
    () => isDemo ? rfqAssetsConfig.assets.map((asset) => asset.asset) : SLA_DAILY_BUCKET_ASSETS,
    [isDemo, rfqAssetsConfig.assets]
  );
  const { data } = useRfqDailyBuckets({
    days: slaWindowDays,
    notionalUsd: "10000",
    assets: slaAssets,
    providers: SLA_DAILY_BUCKET_PROVIDERS,
    sessions: SLA_DAILY_BUCKET_SESSIONS,
    spaceSlug,
  });
  const liveRfq = useBirdsEyeRfqData({
    assets: rfqAssetsConfig.assets,
    includeOraclePrices: false,
    spaceSlug,
  });
  const byAsset = useMemo(() => groupBucketRows(data?.data ?? []), [data]);
  const syntheticSeedIndex = useMemo(
    () => buildSyntheticSeedIndex(liveRfq.rows),
    [liveRfq.rows]
  );
  const assets = useMemo(
    () => buildComplianceLegacy(
      byAsset,
      syntheticSeedIndex,
      isDemo ? rfqAssetsConfig.assets : undefined
    ),
    [byAsset, isDemo, rfqAssetsConfig.assets, syntheticSeedIndex]
  );
  return (
    <div className="flex flex-col">
      <div className="px-4 md:px-6 pb-2 flex items-center justify-end gap-4 flex-wrap">
        <SlaSegmentedToggle<SlaViewMode>
          label="View"
          options={SLA_VIEW_MODE_OPTIONS}
          value={slaViewMode}
          onChange={setSlaViewMode}
        />
        <SlaWindowFilter
          selectedDays={slaWindowDays}
          onChange={setSlaWindowDays}
        />
      </div>
      <SlaMatrix
        rows={liveRfq.rows}
        isLoading={liveRfq.isLoading || rfqAssetsConfig.isLoading}
        assetConfigs={rfqAssetsConfig.assets}
        spaceSlug={spaceSlug}
      />
      <ComplianceTable assets={assets} spaceSlug={spaceSlug} viewMode={slaViewMode} />
    </div>
  );
}
