import type { RfqProvider } from "@/lib/spread-tiers";
import { REGISTRY_CORE20_ORDER } from "@/lib/rfq-asset-config";
import { PROVIDER_LABEL } from "@/lib/spread-tiers";

export type QuoteActivityGroup = "core20" | "tail";
export type QuoteActivityFailureReason = "missing_cycle" | "all_failed" | "partial_failure" | string;
export type QuoteActivityTone = "good" | "ok" | "warn" | "bad" | "critical" | "missing";

export interface QuoteActivityHourFailure {
  provider: RfqProvider;
  providerLabel: string;
  reason: QuoteActivityFailureReason;
  error_codes: string[];
  error_sample?: string | null;
}

export interface QuoteActivityHourProviderBucket {
  provider: RfqProvider;
  providerLabel: string;
  expected: number;
  success: number;
  failed: number;
  reason?: QuoteActivityFailureReason | null;
}

export interface QuoteActivityHour {
  hour: string;
  expected: number;
  success: number;
  failed: number;
  failure_reason?: QuoteActivityFailureReason | null;
  error_codes?: string[];
  error_sample?: string | null;
  providerFailures?: QuoteActivityHourFailure[];
  providerBuckets?: QuoteActivityHourProviderBucket[];
}

export interface QuoteActivityBreach {
  start_at: string;
  end_at: string;
  reason: QuoteActivityFailureReason;
  error_codes: string[];
  error_sample?: string | null;
}

export interface QuoteActivityProviderRow {
  asset: string;
  group: QuoteActivityGroup;
  provider: RfqProvider;
  uptime_pct: number;
  expected_slots: number;
  success_slots: number;
  failed_slots: number;
  latest_quote_at: string | null;
  latest_success_at: string | null;
  directions: string[];
  notionals_usd: string[];
  hourly: QuoteActivityHour[];
  breaches: QuoteActivityBreach[];
}

export interface QuoteActivityApiResponse {
  data: QuoteActivityProviderRow[];
  meta: {
    generated_at: string;
    days: number;
    uptime_definition: "expected_cycles";
  };
}

export type QuoteActivityStatus = "healthy" | "down";

export interface QuoteActivityProviderSummary {
  provider: RfqProvider;
  label: string;
  uptimePct: number;
  latestQuoteAt: string | null;
  failedSlots: number;
  breaches: QuoteActivityBreach[];
  hourly: QuoteActivityHour[];
}

export interface QuoteActivityAssetSummary {
  asset: string;
  group: QuoteActivityGroup;
  uptimePct: number;
  expectedSlots: number;
  successSlots: number;
  failedSlots: number;
  latestQuoteAt: string | null;
  status: QuoteActivityStatus;
  providers: QuoteActivityProviderSummary[];
  hourly: QuoteActivityHour[];
  breaches: Array<QuoteActivityBreach & { provider: RfqProvider; providerLabel: string }>;
}

const CORE20_RANK = new Map<string, number>(
  REGISTRY_CORE20_ORDER.map((asset, index) => [asset, index]),
);

function latestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function statusForSummary(args: {
  uptimePct: number;
  latestQuoteAt: string | null;
}): QuoteActivityStatus {
  if (!args.latestQuoteAt || args.uptimePct < 60) return "down";
  return "healthy";
}

function mergeHourly(rows: QuoteActivityProviderRow[]): QuoteActivityHour[] {
  const byHour = new Map<string, QuoteActivityHour>();
  for (const row of rows) {
    for (const hour of row.hourly) {
      const existing = byHour.get(hour.hour) ?? {
        hour: hour.hour,
        expected: 0,
        success: 0,
        failed: 0,
        providerFailures: [],
        providerBuckets: [],
      };
      existing.expected += hour.expected;
      existing.success += hour.success;
      existing.failed += hour.failed;
      existing.providerBuckets = [
        ...(existing.providerBuckets ?? []),
        {
          provider: row.provider,
          providerLabel: PROVIDER_LABEL[row.provider],
          expected: hour.expected,
          success: hour.success,
          failed: hour.failed,
          reason: hour.failure_reason ?? null,
        },
      ];
      if (hour.failed > 0) {
        existing.providerFailures = [
          ...(existing.providerFailures ?? []),
          {
            provider: row.provider,
            providerLabel: PROVIDER_LABEL[row.provider],
            reason: hour.failure_reason ?? "partial_failure",
            error_codes: hour.error_codes ?? [],
            error_sample: hour.error_sample ?? null,
          },
        ];
      }
      byHour.set(hour.hour, existing);
    }
  }
  return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

export function buildQuoteActivityAssetSummaries(
  rows: QuoteActivityProviderRow[],
): QuoteActivityAssetSummary[] {
  const byAsset = new Map<string, QuoteActivityProviderRow[]>();
  for (const row of rows) {
    const group = byAsset.get(row.asset) ?? [];
    group.push(row);
    byAsset.set(row.asset, group);
  }

  const summaries = [...byAsset.entries()].map(([asset, providerRows]) => {
    const expectedSlots = providerRows.reduce((sum, row) => sum + row.expected_slots, 0);
    const successSlots = providerRows.reduce((sum, row) => sum + row.success_slots, 0);
    const failedSlots = Math.max(0, expectedSlots - successSlots);
    const uptimePct = expectedSlots > 0 ? (successSlots / expectedSlots) * 100 : 0;
    const latestQuoteAt = providerRows.reduce<string | null>(
      (latest, row) => latestIso(latest, row.latest_quote_at),
      null,
    );
    const providers = providerRows
      .map((row) => ({
        provider: row.provider,
        label: PROVIDER_LABEL[row.provider],
        uptimePct: row.uptime_pct,
        latestQuoteAt: row.latest_quote_at,
        failedSlots: row.failed_slots,
        breaches: row.breaches,
        hourly: row.hourly,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const breaches = providerRows.flatMap((row) =>
      row.breaches.map((breach) => ({
        ...breach,
        provider: row.provider,
        providerLabel: PROVIDER_LABEL[row.provider],
      })),
    );

    return {
      asset,
      group: providerRows[0]?.group ?? "tail",
      uptimePct: Number(uptimePct.toFixed(2)),
      expectedSlots,
      successSlots,
      failedSlots,
      latestQuoteAt,
      status: statusForSummary({ uptimePct, latestQuoteAt }),
      providers,
      hourly: mergeHourly(providerRows),
      breaches,
    };
  });

  return summaries.sort((a, b) => {
    if (a.group !== b.group) return a.group === "core20" ? -1 : 1;
    if (a.group === "core20" && b.group === "core20") {
      return (CORE20_RANK.get(a.asset) ?? Number.MAX_SAFE_INTEGER)
        - (CORE20_RANK.get(b.asset) ?? Number.MAX_SAFE_INTEGER);
    }
    return a.asset.localeCompare(b.asset);
  });
}

export function formatQuoteActivityAge(timestamp: string | null, now = new Date()): string {
  if (!timestamp) return "never";
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "unknown";
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function rateToTone(rate: number): QuoteActivityTone {
  if (rate >= 0.95) return "good";
  if (rate >= 0.80) return "ok";
  if (rate >= 0.60) return "warn";
  if (rate >= 0.30) return "bad";
  return "critical";
}

export function quoteActivityTone(row: QuoteActivityHour): QuoteActivityTone {
  if (row.expected <= 0) return "missing";

  const failures = row.providerFailures ?? [];
  if (
    row.failed > 0
    && failures.length > 0
    && failures.every((failure) => failure.reason === "missing_cycle")
  ) {
    return "missing";
  }

  const providerRates = (row.providerBuckets ?? [])
    .filter((bucket) => bucket.expected > 0)
    .map((bucket) => bucket.success / bucket.expected);
  if (
    providerRates.length > 1
    && providerRates.some((rate) => rate < 0.95)
    && providerRates.some((rate) => rate > 0.95)
  ) {
    return "warn";
  }

  return rateToTone(row.success / row.expected);
}

export function quoteVenueActivityTone(
  row: QuoteActivityHour,
  _siblingBuckets: QuoteActivityHourProviderBucket[] = [],
): QuoteActivityTone {
  if (row.expected <= 0) return "missing";
  if (row.failed > 0 && row.failure_reason === "missing_cycle") return "missing";
  return rateToTone(row.success / row.expected);
}
