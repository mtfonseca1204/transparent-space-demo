import { NextRequest, NextResponse } from "next/server";
import { KRAKEN_MONITORED_POOLS } from "@/lib/telegram-kraken-pools";
import type { KrakenMonitoredPool } from "@/lib/telegram-kraken-pools";
import type { PoolPricesRpcResponse } from "@/app/api/pool-prices-rpc/route";

// ── Configuration ──────────────────────────────────────────────────────────────

/** Spread threshold (%) above which an alert fires — 1% for Kraken */
const DEFAULT_THRESHOLD_PCT = 1;

/** Cooldown between repeated alerts for the same pool (ms) */
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Safety kill-switch for Telegram notifications from this cron.
 * Defaults to disabled so monitoring can keep running without paging operators.
 */
function krakenSpreadAlertsEnabled(): boolean {
  const raw = process.env.KRAKEN_SPREAD_ALERTS_ENABLED;
  if (raw === undefined) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}

// ── Per-pool state (module-scope, best-effort for serverless) ────────────────

type PoolAlertState = {
  lastAlertTimestamp: number;
  previousSpreadPct: number | null;
  previousPoolPrice: number | null;
  previousOraclePrice: number | null;
  alertCounter: number;
  wasInAlertState: boolean;
};

const poolStates = new Map<string, PoolAlertState>();

function getState(key: string): PoolAlertState {
  let s = poolStates.get(key);
  if (!s) {
    s = {
      lastAlertTimestamp: 0,
      previousSpreadPct: null,
      previousPoolPrice: null,
      previousOraclePrice: null,
      alertCounter: 0,
      wasInAlertState: false,
    };
    poolStates.set(key, s);
  }
  return s;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getThresholdPct(): number {
  const raw = process.env.KRAKEN_SPREAD_THRESHOLD_PCT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_PCT;
}

function getBaseUrl(): string {
  // Vercel sets VERCEL_URL for deployments; use localhost for local dev
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.transparent.space";
}

/** Send a message using the Kraken bot credentials. */
async function sendKrakenTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.KRAKEN_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.KRAKEN_TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn(
      "[check-spread-kraken] Missing KRAKEN_TELEGRAM_BOT_TOKEN or KRAKEN_TELEGRAM_CHAT_ID – skipping message",
    );
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
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
      console.error("[check-spread-kraken] Failed to send message", {
        status: res.status,
        body: body.slice(0, 400),
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("[check-spread-kraken] Network error sending message", err);
    return false;
  }
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function utcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function severityEmoji(spreadPct: number): string {
  if (spreadPct >= 5) return "\u{1F6A8}"; // 🚨
  return "\u{26A0}\u{FE0F}"; // ⚠️
}

function detectSpreadCause(opts: {
  poolPrice: number;
  oraclePrice: number;
  prevPoolPrice: number | null;
  prevOraclePrice: number | null;
}): { label: string; emoji: string } {
  const { poolPrice, oraclePrice, prevPoolPrice, prevOraclePrice } = opts;

  if (prevPoolPrice === null || prevOraclePrice === null) {
    return { label: "Initial detection", emoji: "\u{1F50D}" };
  }

  const poolChangePct =
    Math.abs((poolPrice - prevPoolPrice) / prevPoolPrice) * 100;
  const oracleChangePct =
    Math.abs((oraclePrice - prevOraclePrice) / prevOraclePrice) * 100;

  const poolMoved = poolChangePct > 0.1;
  const oracleMoved = oracleChangePct > 0.1;

  if (poolMoved && oracleMoved) {
    return { label: "Pool + Oracle moved", emoji: "\u{1F504}" };
  }
  if (poolMoved) {
    return { label: "Pool price moved", emoji: "\u{1F4B1}" };
  }
  if (oracleMoved) {
    return { label: "Oracle price moved", emoji: "\u{1F310}" };
  }
  return { label: "Spread persists", emoji: "\u{23F3}" };
}

// ── Data fetching (reuses /api/pool-prices-rpc — same as birds eye view) ────

async function fetchPoolPricesRpc(): Promise<PoolPricesRpcResponse> {
  const poolAddresses = KRAKEN_MONITORED_POOLS.map((p) => p.poolAddress).join(",");
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/pool-prices-rpc?pools=${poolAddresses}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`pool-prices-rpc returned ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ── Message builders (HTML format for Telegram) ────────────────────────────────

function buildAlertMessage(opts: {
  pool: KrakenMonitoredPool;
  poolPriceUsd: number;
  oraclePriceUsd: number;
  spreadPct: number;
  thresholdPct: number;
  previousSpreadPct: number | null;
  alertNumber: number;
  cause: { label: string; emoji: string };
}): string {
  const {
    pool,
    poolPriceUsd,
    oraclePriceUsd,
    spreadPct,
    thresholdPct,
    previousSpreadPct: prevSpread,
    alertNumber,
    cause,
  } = opts;

  const emoji = severityEmoji(spreadPct);
  const dirArrow = poolPriceUsd > oraclePriceUsd ? "\u2191" : "\u2193";

  let trendLine = "";
  if (prevSpread !== null) {
    const delta = spreadPct - prevSpread;
    const trendArrow =
      delta > 0.01
        ? "\u2197\uFE0F"
        : delta < -0.01
          ? "\u2198\uFE0F"
          : "\u27A1\uFE0F";
    const trendLabel =
      delta > 0.01 ? "worsening" : delta < -0.01 ? "improving" : "stable";
    trendLine = `\n\u{1F4C8} <b>Trend:</b>  <code>${prevSpread.toFixed(2)}%</code> ${trendArrow} <code>${spreadPct.toFixed(2)}%</code>  (${trendLabel})`;
  }

  const solscanUrl = `https://solscan.io/account/${pool.poolAddress}`;
  const dashboardUrl = `https://app.transparent.space/kraken?pool=${pool.poolAddress}`;

  return [
    `${emoji} <b>${pool.label}  \u00b7  Alert #${alertNumber}</b>`,
    ``,
    `\u{1F4CA} <b>Spread:  <code>${spreadPct.toFixed(2)}%</code></b>  ${dirArrow}`,
    `\u{1F3AF} Threshold:  <code>${thresholdPct}%</code>`,
    `${cause.emoji} <b>Cause:</b>  ${cause.label}`,
    ``,
    `\u{1F4B1} Pool:  <code>$${poolPriceUsd.toFixed(4)}</code>  USD per ${pool.token0Symbol}`,
    `\u{1F310} Oracle:  <code>$${oraclePriceUsd.toFixed(4)}</code>  USD per ${pool.token0Symbol}`,
    `${trendLine}`,
    `\u{1F517} <a href="${solscanUrl}">Solscan</a>  \u00b7  <a href="${dashboardUrl}">Dashboard</a>`,
    `\u{1F552} <i>${utcNow()}</i>`,
  ].join("\n");
}

function buildRecoveryMessage(opts: {
  pool: KrakenMonitoredPool;
  spreadPct: number;
  previousSpreadPct: number;
  thresholdPct: number;
  poolPriceUsd: number;
  oraclePriceUsd: number;
}): string {
  const {
    pool,
    spreadPct,
    previousSpreadPct: prevSpread,
    thresholdPct,
    poolPriceUsd,
    oraclePriceUsd,
  } = opts;

  return [
    `\u{2705} <b>${pool.label}  \u00b7  Recovered</b>`,
    ``,
    `\u{1F4C9} Spread:  <code>${spreadPct.toFixed(2)}%</code>  (was <code>${prevSpread.toFixed(2)}%</code>)`,
    `\u{1F3AF} Back below  <code>${thresholdPct}%</code>  threshold`,
    ``,
    `\u{1F4B1} Pool:  <code>$${poolPriceUsd.toFixed(4)}</code>  \u00b7  Oracle:  <code>$${oraclePriceUsd.toFixed(4)}</code>`,
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
    // Reuse /api/pool-prices-rpc — same data source as birds eye view price peg column.
    // Returns both on-chain pool prices (Solana RPC) and oracle prices (CoinGecko)
    // in a single call, ensuring they're comparable.
    const rpcData = await fetchPoolPricesRpc();
    const { prices: rpcPrices, oraclePrices } = rpcData;

    const thresholdPct = getThresholdPct();
    const now = Date.now();
    const results: Record<string, unknown>[] = [];

    // USDC oracle price (should be ~1.0)
    const usdcMintLc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".toLowerCase();
    const usdcPrice = oraclePrices[usdcMintLc] ?? 1;

    for (const pool of KRAKEN_MONITORED_POOLS) {
      const rpcPrice = rpcPrices[pool.poolAddress];
      if (!rpcPrice || rpcPrice.price <= 0) {
        results.push({ pair: pool.label, error: "RPC read failed" });
        continue;
      }

      // Same calculation as birds eye view (use-birds-eye-data.ts lines 562-598):
      // All Kraken pools: tracked token = token0 (xStock), counter = token1 (USDC)
      // isToken0 = true → poolPriceUsd = effectivePoolPrice * counterUsd
      const counterUsd = oraclePrices[pool.token1Mint.toLowerCase()] ?? usdcPrice;
      const poolPriceUsd = rpcPrice.price * counterUsd;

      // Oracle price of tracked token (token0)
      const oraclePriceUsd = oraclePrices[pool.token0Mint.toLowerCase()];
      if (!oraclePriceUsd || oraclePriceUsd <= 0) {
        results.push({
          pair: pool.label,
          poolPriceUsd: Number(poolPriceUsd.toFixed(4)),
          error: "oracle price unavailable",
        });
        continue;
      }

      // Deviation: abs((poolPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 100
      const spreadPct =
        Math.abs((poolPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 100;

      const state = getState(pool.key);

      console.log(`[check-spread-kraken] ${pool.label}`, {
        poolPriceUsd: poolPriceUsd.toFixed(4),
        oraclePriceUsd: oraclePriceUsd.toFixed(4),
        spreadPct: spreadPct.toFixed(2),
        thresholdPct,
        previousSpreadPct: state.previousSpreadPct?.toFixed(2) ?? "n/a",
        wasInAlertState: state.wasInAlertState,
      });

      let alerted = false;
      let recovered = false;

      if (spreadPct > thresholdPct) {
        if (now - state.lastAlertTimestamp > ALERT_COOLDOWN_MS) {
          state.alertCounter += 1;

          const cause = detectSpreadCause({
            poolPrice: poolPriceUsd,
            oraclePrice: oraclePriceUsd,
            prevPoolPrice: state.previousPoolPrice,
            prevOraclePrice: state.previousOraclePrice,
          });

          const message = buildAlertMessage({
            pool,
            poolPriceUsd,
            oraclePriceUsd,
            spreadPct,
            thresholdPct,
            previousSpreadPct: state.previousSpreadPct,
            alertNumber: state.alertCounter,
            cause,
          });

          if (krakenSpreadAlertsEnabled()) {
            const sent = await sendKrakenTelegramMessage(message);
            if (sent) {
              state.lastAlertTimestamp = now;
              alerted = true;
            }
          }
        }
        state.wasInAlertState = true;
      } else {
        if (state.wasInAlertState && state.previousSpreadPct !== null) {
          const message = buildRecoveryMessage({
            pool,
            spreadPct,
            previousSpreadPct: state.previousSpreadPct,
            thresholdPct,
            poolPriceUsd,
            oraclePriceUsd,
          });

          if (krakenSpreadAlertsEnabled()) {
            await sendKrakenTelegramMessage(message);
          }
          recovered = true;
        }
        state.wasInAlertState = false;
      }

      state.previousSpreadPct = spreadPct;
      state.previousPoolPrice = poolPriceUsd;
      state.previousOraclePrice = oraclePriceUsd;

      results.push({
        pair: pool.label,
        poolPriceUsd: Number(poolPriceUsd.toFixed(4)),
        oraclePriceUsd: Number(oraclePriceUsd.toFixed(4)),
        spreadPct: Number(spreadPct.toFixed(2)),
        alerted,
        recovered,
        alertCounter: state.alertCounter,
      });
    }

    return NextResponse.json({ ok: true, thresholdPct, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[check-spread-kraken] Error", message);

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
