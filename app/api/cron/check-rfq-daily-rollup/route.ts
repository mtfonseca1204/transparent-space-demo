import { NextResponse } from "next/server";

const SOLANA_INDEXER_URL =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

const DASHBOARD_URL = "https://app.transparent.space/kraken";
const NOTIONAL_USD = "10000";
const DEFAULT_STALE_THRESHOLD_MINUTES = 45;
const DEFAULT_RAW_FRESH_THRESHOLD_MINUTES = 30;

type ProviderKey = "0x" | "1inch" | "bebop" | "cowswap" | "jupz";
type DailyProviderKey = "zerox" | "oneinch" | "bebop" | "cowswap" | "jupz";

const PROVIDERS: Array<{
  key: ProviderKey;
  dailyKey: DailyProviderKey;
  label: string;
  path: string;
}> = [
  { key: "0x", dailyKey: "zerox", label: "0x", path: "0x" },
  { key: "1inch", dailyKey: "oneinch", label: "1inch", path: "1inch" },
  { key: "bebop", dailyKey: "bebop", label: "Bebop", path: "bebop" },
  { key: "cowswap", dailyKey: "cowswap", label: "CowSwap", path: "cowswap" },
  { key: "jupz", dailyKey: "jupz", label: "JupZ", path: "jupz" },
];

const DAILY_KEY_BY_PROVIDER = new Map(PROVIDERS.map((provider) => [provider.key, provider.dailyKey]));

interface DailyBucketRow {
  provider: ProviderKey | string;
  last_quote_at: string | null;
}

interface DailyBucketsResponse {
  data?: DailyBucketRow[];
}

interface LatestQuoteRow {
  quote_at?: string | null;
}

interface LatestQuoteResponse {
  data?: LatestQuoteRow[];
}

interface ProviderFreshness {
  provider: ProviderKey;
  label: string;
  latestRawQuoteAt: string | null;
  latestRollupQuoteAt: string | null;
}

function parseMinutesEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function alertsEnabled(): boolean {
  const raw = process.env.RFQ_DAILY_ROLLUP_ALERTS_ENABLED;
  if (raw === undefined) return true;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let max: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) continue;
    if (!max || value > max) max = value;
  }
  return max;
}

function ageMinutes(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 60_000);
}

function formatAge(minutes: number | null): string {
  if (minutes === null) return "missing";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const url = new URL(path, SOLANA_INDEXER_URL);
  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.error("[check-rfq-daily-rollup] fetch failed", {
        path,
        status: res.status,
      });
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error("[check-rfq-daily-rollup] network error", { path, error });
    return null;
  }
}

async function sendKrakenTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.KRAKEN_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.KRAKEN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[check-rfq-daily-rollup] Missing KRAKEN_TELEGRAM_BOT_TOKEN or KRAKEN_TELEGRAM_CHAT_ID");
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[check-rfq-daily-rollup] TG send failed", {
        status: res.status,
        body: body.slice(0, 400),
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error("[check-rfq-daily-rollup] TG network error", error);
    return false;
  }
}

async function getDailyRollupRows(): Promise<DailyBucketRow[] | null> {
  const url = new URL("/api/rfq/daily-buckets", SOLANA_INDEXER_URL);
  url.searchParams.set("days", "1");
  url.searchParams.set("notional_usd", NOTIONAL_USD);
  const response = await fetchJson<DailyBucketsResponse>(`${url.pathname}${url.search}`);
  return response?.data ?? null;
}

async function getProviderLatest(provider: typeof PROVIDERS[number]): Promise<ProviderFreshness> {
  const url = new URL(`/api/rfq/${provider.path}/latest`, SOLANA_INDEXER_URL);
  url.searchParams.set("limit", "1");
  url.searchParams.set("notional_usd", NOTIONAL_USD);
  const response = await fetchJson<LatestQuoteResponse>(`${url.pathname}${url.search}`);
  return {
    provider: provider.key,
    label: provider.label,
    latestRawQuoteAt: response?.data?.[0]?.quote_at ?? null,
    latestRollupQuoteAt: null,
  };
}

function buildAlertMessage(args: {
  freshness: ProviderFreshness[];
  now: Date;
  rawAge: number | null;
  rollupAge: number | null;
  lagMinutes: number | null;
  staleThresholdMinutes: number;
  rawFreshThresholdMinutes: number;
}) {
  const staleProviders = args.freshness
    .filter((entry) => {
      const rawAge = ageMinutes(entry.latestRawQuoteAt, args.now);
      const rollupAge = ageMinutes(entry.latestRollupQuoteAt, args.now);
      return rawAge !== null && rawAge <= args.rawFreshThresholdMinutes
        && (rollupAge === null || rollupAge >= args.staleThresholdMinutes);
    })
    .map((entry) => {
      const rawAge = formatAge(ageMinutes(entry.latestRawQuoteAt, args.now));
      const rollupAge = formatAge(ageMinutes(entry.latestRollupQuoteAt, args.now));
      return `  ${escapeHtml(entry.label)} raw ${rawAge} / rollup ${rollupAge}`;
    });

  return [
    `<b>RFQ SLA rollup stale</b>`,
    ``,
    `Raw RFQ is fresh but <code>/api/rfq/daily-buckets</code> is stale or empty.`,
    `Latest raw age: <b>${escapeHtml(formatAge(args.rawAge))}</b>`,
    `Latest rollup age: <b>${escapeHtml(formatAge(args.rollupAge))}</b>`,
    args.lagMinutes === null ? null : `Raw vs rollup lag: <b>${Math.round(args.lagMinutes)}m</b>`,
    ``,
    staleProviders.length ? `<b>Provider lag</b>\n${staleProviders.join("\n")}` : null,
    ``,
    `Action: check or redeploy <code>indexer-solana-rfq-daily-rollup</code>.`,
    `<a href="${DASHBOARD_URL}">Dashboard</a>`,
  ].filter(Boolean).join("\n");
}

function buildFetchFailureMessage(args: {
  rawAge: number | null;
  rawFreshThresholdMinutes: number;
}) {
  return [
    `<b>RFQ SLA rollup unavailable</b>`,
    ``,
    `Raw RFQ is fresh but <code>/api/rfq/daily-buckets</code> failed.`,
    `Latest raw age: <b>${escapeHtml(formatAge(args.rawAge))}</b>`,
    `Fresh threshold: <b>${args.rawFreshThresholdMinutes}m</b>`,
    ``,
    `Action: check the Solana indexer API and <code>indexer-solana-rfq-daily-rollup</code>.`,
    `<a href="${DASHBOARD_URL}">Dashboard</a>`,
  ].join("\n");
}

export async function GET() {
  const now = new Date();
  const staleThresholdMinutes = parseMinutesEnv(
    "RFQ_DAILY_ROLLUP_STALE_THRESHOLD_MINUTES",
    DEFAULT_STALE_THRESHOLD_MINUTES,
  );
  const rawFreshThresholdMinutes = parseMinutesEnv(
    "RFQ_DAILY_ROLLUP_RAW_FRESH_THRESHOLD_MINUTES",
    DEFAULT_RAW_FRESH_THRESHOLD_MINUTES,
  );

  const [dailyRows, providerFreshness] = await Promise.all([
    getDailyRollupRows(),
    Promise.all(PROVIDERS.map((provider) => getProviderLatest(provider))),
  ]);

  if (!dailyRows) {
    const latestRawQuoteAt = maxIso(providerFreshness.map((entry) => entry.latestRawQuoteAt));
    const rawAge = ageMinutes(latestRawQuoteAt, now);
    const rawFresh = rawAge !== null && rawAge <= rawFreshThresholdMinutes;
    const message = buildFetchFailureMessage({ rawAge, rawFreshThresholdMinutes });
    const sent = rawFresh && alertsEnabled() ? await sendKrakenTelegramMessage(message) : false;

    return NextResponse.json(
      {
        ok: false,
        sent,
        reason: rawFresh ? (sent ? "fetch_failure_alert_sent" : "fetch_failed_alert_not_sent") : "daily-buckets fetch failed",
        latestRawQuoteAt,
        rawAgeMinutes: rawAge,
        providers: providerFreshness,
      },
      { status: 502 },
    );
  }

  const latestRollupByProvider = new Map<DailyProviderKey, string | null>();
  for (const provider of PROVIDERS) {
    latestRollupByProvider.set(
      provider.dailyKey,
      maxIso(dailyRows.filter((row) => row.provider === provider.dailyKey).map((row) => row.last_quote_at)),
    );
  }

  const freshness = providerFreshness.map((entry) => ({
    ...entry,
    latestRollupQuoteAt: latestRollupByProvider.get(DAILY_KEY_BY_PROVIDER.get(entry.provider)!) ?? null,
  }));

  const latestRawQuoteAt = maxIso(freshness.map((entry) => entry.latestRawQuoteAt));
  const latestRollupQuoteAt = maxIso(freshness.map((entry) => entry.latestRollupQuoteAt));
  const rawAge = ageMinutes(latestRawQuoteAt, now);
  const rollupAge = ageMinutes(latestRollupQuoteAt, now);
  const lagMinutes = latestRawQuoteAt && latestRollupQuoteAt
    ? Math.max(0, (new Date(latestRawQuoteAt).getTime() - new Date(latestRollupQuoteAt).getTime()) / 60_000)
    : null;

  const staleProviders = freshness.filter((entry) => {
    const providerRawAge = ageMinutes(entry.latestRawQuoteAt, now);
    const providerRollupAge = ageMinutes(entry.latestRollupQuoteAt, now);
    return providerRawAge !== null
      && providerRawAge <= rawFreshThresholdMinutes
      && (providerRollupAge === null || providerRollupAge >= staleThresholdMinutes);
  });
  const stale = staleProviders.length > 0;

  if (!stale) {
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: "fresh",
      latestRawQuoteAt,
      latestRollupQuoteAt,
      rawAgeMinutes: rawAge,
      rollupAgeMinutes: rollupAge,
      dailyRows: dailyRows.length,
      staleProviders,
      providers: freshness,
    });
  }

  const message = buildAlertMessage({
    freshness,
    now,
    rawAge,
    rollupAge,
    lagMinutes,
    staleThresholdMinutes,
    rawFreshThresholdMinutes,
  });

  if (!alertsEnabled()) {
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: "disabled",
      preview: message,
      latestRawQuoteAt,
      latestRollupQuoteAt,
      rawAgeMinutes: rawAge,
      rollupAgeMinutes: rollupAge,
      dailyRows: dailyRows.length,
      staleProviders,
      providers: freshness,
    });
  }

  const sent = await sendKrakenTelegramMessage(message);
  return NextResponse.json({
    ok: true,
    sent,
    reason: sent ? "stale_alert_sent" : "send_failed",
    latestRawQuoteAt,
    latestRollupQuoteAt,
    rawAgeMinutes: rawAge,
    rollupAgeMinutes: rollupAge,
    dailyRows: dailyRows.length,
    staleProviders,
    providers: freshness,
  });
}
