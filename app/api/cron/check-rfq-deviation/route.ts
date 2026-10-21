import { NextRequest, NextResponse } from "next/server";
import { KRAKEN_MONITORED_POOLS } from "@/lib/telegram-kraken-pools";

/**
 * Cron: Compare RFQ mid prices (from all aggregators) against Kraken xUSD
 * and alert on deviations > 1%.
 *
 * Uses the same data sources as the Historical Price Bands chart:
 *  - RFQ quotes from the Solana indexer (/api/rfq/{aggregator}/latest)
 *  - Kraken xUSD from the Kraken public OHLC API
 */

// ── Configuration ──────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD_PCT = 2;
const ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Safety kill-switch for Telegram notifications from this cron.
 * Defaults to disabled so monitoring can keep running without paging operators.
 */
function krakenRfqAlertsEnabled(): boolean {
  const raw = process.env.KRAKEN_RFQ_ALERTS_ENABLED;
  if (raw === undefined) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}

const SOLANA_INDEXER_URL =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

const AGGREGATORS = ["cowswap", "bebop", "0x", "1inch", "jupz"] as const;
type Aggregator = (typeof AGGREGATORS)[number];

const AGG_DISPLAY_NAMES: Record<Aggregator, string> = {
  cowswap: "COW",
  bebop: "BEB",
  "0x": "0x",
  "1inch": "1inch",
  jupz: "JupZ",
};

// Assets to monitor — derived from the primary Kraken pools
const MONITORED_ASSETS = KRAKEN_MONITORED_POOLS.map((p) => p.token0Symbol);

const USDC_ETH_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// ── Per-key state ──────────────────────────────────────────────────────────────

type AlertState = {
  lastAlertTimestamp: number;
  previousDevPct: number | null;
  alertCounter: number;
  wasInAlertState: boolean;
};

const alertStates = new Map<string, AlertState>();

function getState(key: string): AlertState {
  let s = alertStates.get(key);
  if (!s) {
    s = {
      lastAlertTimestamp: 0,
      previousDevPct: null,
      alertCounter: 0,
      wasInAlertState: false,
    };
    alertStates.set(key, s);
  }
  return s;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getThresholdPct(): number {
  const raw = process.env.KRAKEN_RFQ_THRESHOLD_PCT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_PCT;
}

async function sendKrakenTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.KRAKEN_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.KRAKEN_TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[check-rfq-deviation] Missing KRAKEN_TELEGRAM_BOT_TOKEN or KRAKEN_TELEGRAM_CHAT_ID");
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
      console.error("[check-rfq-deviation] TG send failed", { status: res.status, body: body.slice(0, 400) });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[check-rfq-deviation] TG network error", err);
    return false;
  }
}

function utcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function severityEmoji(pct: number): string {
  if (pct >= 5) return "\u{1F6A8}";
  return "\u{26A0}\u{FE0F}";
}

// ── RFQ mid price (same calculation as use-cowswap-rfq-history.ts) ───────────

function rawToNumber(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

interface RfqQuote {
  capture_id: string;
  direction: string;
  notional_usd: string;
  sell_token: string;
  buy_token: string;
  // Different aggregators use different field names for sell amount
  quote_sell_amount_raw?: string;
  requested_sell_amount_raw?: string;
  sell_amount_raw?: string;
  quote_buy_amount_raw: string;
  is_success: boolean;
  quote_at: string;
}

function getSellAmountRaw(q: RfqQuote): string {
  return q.quote_sell_amount_raw ?? q.requested_sell_amount_raw ?? q.sell_amount_raw ?? "0";
}

function computeTokenPrice(q: RfqQuote): number {
  const sellIsUsdc = q.sell_token?.toLowerCase() === USDC_ETH_ADDRESS;
  const buyIsUsdc = q.buy_token?.toLowerCase() === USDC_ETH_ADDRESS;
  const sellDec = sellIsUsdc ? 6 : 18;
  const buyDec = buyIsUsdc ? 6 : 18;

  const sellAmount = rawToNumber(getSellAmountRaw(q), sellDec);
  const buyAmount = rawToNumber(q.quote_buy_amount_raw, buyDec);

  if (sellIsUsdc) {
    return buyAmount > 0 ? sellAmount / buyAmount : 0;
  }
  return sellAmount > 0 ? buyAmount / sellAmount : 0;
}

async function fetchLatestRfqMid(
  asset: string,
  aggregator: Aggregator,
): Promise<{ midPrice: number; quoteAt: string } | null> {
  try {
    const url = `${SOLANA_INDEXER_URL}/api/rfq/${aggregator}/latest?asset=${asset}&limit=100`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    const json = (await res.json()) as { data?: RfqQuote[] };
    const quotes = (json.data ?? []).filter((q) => q.is_success);
    if (quotes.length === 0) return null;

    // Group by capture_id, find the latest capture
    const captures = new Map<string, { quoteAt: string; quotes: RfqQuote[] }>();
    for (const q of quotes) {
      let cap = captures.get(q.capture_id);
      if (!cap) {
        cap = { quoteAt: q.quote_at, quotes: [] };
        captures.set(q.capture_id, cap);
      }
      cap.quotes.push(q);
    }

    let latestCap: { quoteAt: string; quotes: RfqQuote[] } | null = null;
    let latestTs = 0;
    for (const cap of captures.values()) {
      const t = new Date(cap.quoteAt).getTime();
      if (t > latestTs) {
        latestTs = t;
        latestCap = cap;
      }
    }
    if (!latestCap) return null;

    // Build tier map and compute mid (same logic as use-cowswap-rfq-history.ts)
    const tiers = new Map<number, { bid: number; ask: number }>();
    for (const q of latestCap.quotes) {
      const notional = parseFloat(q.notional_usd);
      const price = computeTokenPrice(q);
      if (price <= 0) continue;

      let entry = tiers.get(notional) ?? { bid: 0, ask: 0 };
      if (q.direction === "forward") {
        entry.bid = price;
      } else {
        entry.ask = price;
      }
      tiers.set(notional, entry);
    }

    // Mid from smallest tier with both sides, fallback to any side
    const sortedTiers = [...tiers.keys()].sort((a, b) => a - b);
    let midPrice = 0;
    for (const n of sortedTiers) {
      const e = tiers.get(n)!;
      if (e.bid > 0 && e.ask > 0) {
        midPrice = (e.bid + e.ask) / 2;
        break;
      }
      if (e.bid > 0 && midPrice === 0) midPrice = e.bid;
      if (e.ask > 0 && midPrice === 0) midPrice = e.ask;
    }

    if (midPrice <= 0) return null;
    return { midPrice, quoteAt: latestCap.quoteAt };
  } catch {
    return null;
  }
}

// ── Kraken xUSD price (same as Historical Price Bands chart) ────────────────

async function fetchKrakenXusdPrice(
  asset: string,
): Promise<{ price: number; timestamp: number } | null> {
  try {
    const pair = `${asset}USD`;
    const since = Math.floor(Date.now() / 1000) - 3600;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=5&asset_class=tokenized_asset&since=${since}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      error?: string[];
      result?: Record<string, unknown>;
    };
    if (json.error && json.error.length > 0) return null;

    const result = json.result ?? {};
    let candles: unknown[] = [];
    for (const [key, val] of Object.entries(result)) {
      if (key !== "last" && Array.isArray(val)) candles = val;
    }
    if (candles.length === 0) return null;

    const last = candles[candles.length - 1] as (string | number)[];
    return {
      price: Number(last[4]), // close
      timestamp: Number(last[0]),
    };
  } catch {
    return null;
  }
}

// ── Message builders ────────────────────────────────────────────────────────

function buildAlertMessage(opts: {
  asset: string;
  aggregator: string;
  rfqMid: number;
  krakenPrice: number;
  deviationPct: number;
  thresholdPct: number;
  previousDevPct: number | null;
  alertNumber: number;
}): string {
  const {
    asset,
    aggregator,
    rfqMid,
    krakenPrice,
    deviationPct,
    thresholdPct,
    previousDevPct: prevDev,
    alertNumber,
  } = opts;

  const emoji = severityEmoji(deviationPct);
  const dirArrow = rfqMid > krakenPrice ? "\u2191" : "\u2193";

  let trendLine = "";
  if (prevDev !== null) {
    const delta = deviationPct - prevDev;
    const trendArrow =
      delta > 0.01
        ? "\u2197\uFE0F"
        : delta < -0.01
          ? "\u2198\uFE0F"
          : "\u27A1\uFE0F";
    const trendLabel =
      delta > 0.01 ? "worsening" : delta < -0.01 ? "improving" : "stable";
    trendLine = `\n\u{1F4C8} <b>Trend:</b>  <code>${prevDev.toFixed(2)}%</code> ${trendArrow} <code>${deviationPct.toFixed(2)}%</code>  (${trendLabel})`;
  }

  const dashboardUrl = `https://app.transparent.space/kraken`;

  return [
    `${emoji} <b>${asset}  \u00b7  RFQ ${aggregator}  \u00b7  Alert #${alertNumber}</b>`,
    ``,
    `\u{1F4CA} <b>Deviation:  <code>${deviationPct.toFixed(2)}%</code></b>  ${dirArrow}`,
    `\u{1F3AF} Threshold:  <code>${thresholdPct}%</code>`,
    ``,
    `\u{1F4B1} RFQ Mid:  <code>$${rfqMid.toFixed(4)}</code>`,
    `\u{1F310} Kraken xUSD:  <code>$${krakenPrice.toFixed(4)}</code>`,
    `${trendLine}`,
    `\u{1F517} <a href="${dashboardUrl}">Dashboard</a>`,
    `\u{1F552} <i>${utcNow()}</i>`,
  ].join("\n");
}

function buildRecoveryMessage(opts: {
  asset: string;
  aggregator: string;
  deviationPct: number;
  previousDevPct: number;
  thresholdPct: number;
  rfqMid: number;
  krakenPrice: number;
}): string {
  const {
    asset,
    aggregator,
    deviationPct,
    previousDevPct: prevDev,
    thresholdPct,
    rfqMid,
    krakenPrice,
  } = opts;

  return [
    `\u{2705} <b>${asset}  \u00b7  RFQ ${aggregator}  \u00b7  Recovered</b>`,
    ``,
    `\u{1F4C9} Deviation:  <code>${deviationPct.toFixed(2)}%</code>  (was <code>${prevDev.toFixed(2)}%</code>)`,
    `\u{1F3AF} Back below  <code>${thresholdPct}%</code>  threshold`,
    ``,
    `\u{1F4B1} RFQ Mid:  <code>$${rfqMid.toFixed(4)}</code>  \u00b7  Kraken:  <code>$${krakenPrice.toFixed(4)}</code>`,
    ``,
    `\u{1F552} <i>${utcNow()}</i>`,
  ].join("\n");
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const thresholdPct = getThresholdPct();
    const now = Date.now();
    const results: Record<string, unknown>[] = [];

    for (const asset of MONITORED_ASSETS) {
      // Fetch Kraken xUSD price once per asset
      const kraken = await fetchKrakenXusdPrice(asset);
      if (!kraken) {
        results.push({ asset, error: "Kraken xUSD unavailable" });
        continue;
      }

      // Check each aggregator
      for (const agg of AGGREGATORS) {
        const rfq = await fetchLatestRfqMid(asset, agg);
        if (!rfq) continue; // Aggregator has no data for this asset — skip silently

        const deviationPct =
          Math.abs((rfq.midPrice - kraken.price) / kraken.price) * 100;

        const stateKey = `${asset}:${agg}`;
        const state = getState(stateKey);

        console.log(`[check-rfq-deviation] ${asset} ${AGG_DISPLAY_NAMES[agg]}`, {
          rfqMid: rfq.midPrice.toFixed(4),
          krakenPrice: kraken.price.toFixed(4),
          deviationPct: deviationPct.toFixed(2),
          thresholdPct,
        });

        let alerted = false;
        let recovered = false;

        if (deviationPct > thresholdPct) {
          if (now - state.lastAlertTimestamp > ALERT_COOLDOWN_MS) {
            state.alertCounter += 1;

            const message = buildAlertMessage({
              asset,
              aggregator: AGG_DISPLAY_NAMES[agg],
              rfqMid: rfq.midPrice,
              krakenPrice: kraken.price,
              deviationPct,
              thresholdPct,
              previousDevPct: state.previousDevPct,
              alertNumber: state.alertCounter,
            });

            if (krakenRfqAlertsEnabled()) {
              const sent = await sendKrakenTelegramMessage(message);
              if (sent) {
                state.lastAlertTimestamp = now;
                alerted = true;
              }
            }
          }
          state.wasInAlertState = true;
        } else {
          if (state.wasInAlertState && state.previousDevPct !== null) {
            const message = buildRecoveryMessage({
              asset,
              aggregator: AGG_DISPLAY_NAMES[agg],
              deviationPct,
              previousDevPct: state.previousDevPct,
              thresholdPct,
              rfqMid: rfq.midPrice,
              krakenPrice: kraken.price,
            });

            if (krakenRfqAlertsEnabled()) {
              await sendKrakenTelegramMessage(message);
            }
            recovered = true;
          }
          state.wasInAlertState = false;
        }

        state.previousDevPct = deviationPct;

        results.push({
          asset,
          aggregator: AGG_DISPLAY_NAMES[agg],
          rfqMid: Number(rfq.midPrice.toFixed(4)),
          krakenPrice: Number(kraken.price.toFixed(4)),
          deviationPct: Number(deviationPct.toFixed(2)),
          alerted,
          recovered,
          alertCounter: state.alertCounter,
        });
      }
    }

    return NextResponse.json({ ok: true, thresholdPct, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[check-rfq-deviation] Error", message);

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
