import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { publicClient } from "@/lib/viem";
import { uniswapV3PoolAbi, erc20Abi } from "@/lib/uniswap-v3-abi";
import { sendTelegramMessage } from "@/lib/telegram";
import { MONITORED_POOLS, getUniqueCoinGeckoIds } from "@/lib/telegram-pools";
import type { MonitoredPool } from "@/lib/telegram-pools";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";

// ── Configuration ──────────────────────────────────────────────────────────────

/** Default spread threshold (%) above which an alert fires */
const DEFAULT_THRESHOLD_PCT = 2;

/** Cooldown between repeated alerts for the same pool (ms) */
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Safety kill-switch for Telegram notifications from this cron.
 * Defaults to disabled so monitoring can keep running without paging operators.
 */
function spreadAlertsEnabled(): boolean {
  const raw = process.env.SPREAD_ALERTS_ENABLED;
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
  const raw = process.env.SPREAD_THRESHOLD_PCT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_PCT;
}

/**
 * Convert sqrtPriceX96 to a human-readable price (token1 per token0).
 */
function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  const Q96 = BigInt(2) ** BigInt(96);
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  const priceRaw = sqrtPrice * sqrtPrice;
  return priceRaw * 10 ** (decimals0 - decimals1);
}

/** Format a number as compact USD (e.g. $245.3K, $1.2M) */
function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/** Get current UTC timestamp formatted for display */
function utcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Pick a severity emoji based on spread size */
function severityEmoji(spreadPct: number): string {
  if (spreadPct >= 10) return "\u{1F6A8}"; // 🚨
  return "\u{26A0}\u{FE0F}"; // ⚠️
}

/** Determine what caused the spread change. */
function detectSpreadCause(opts: {
  poolPrice: number;
  oraclePrice: number;
  prevPoolPrice: number | null;
  prevOraclePrice: number | null;
}): { label: string; emoji: string } {
  const { poolPrice, oraclePrice, prevPoolPrice, prevOraclePrice } = opts;

  if (prevPoolPrice === null || prevOraclePrice === null) {
    return { label: "Initial detection", emoji: "\u{1F50D}" }; // 🔍
  }

  const poolChangePct =
    Math.abs((poolPrice - prevPoolPrice) / prevPoolPrice) * 100;
  const oracleChangePct =
    Math.abs((oraclePrice - prevOraclePrice) / prevOraclePrice) * 100;

  // Threshold: consider a >0.1% move as "moved"
  const poolMoved = poolChangePct > 0.1;
  const oracleMoved = oracleChangePct > 0.1;

  if (poolMoved && oracleMoved) {
    return { label: "Pool + Oracle moved", emoji: "\u{1F504}" }; // 🔄
  }
  if (poolMoved) {
    return { label: "Pool price moved", emoji: "\u{1F4B1}" }; // 💱
  }
  if (oracleMoved) {
    return { label: "Oracle price moved", emoji: "\u{1F310}" }; // 🌐
  }
  return { label: "Spread persists", emoji: "\u{23F3}" }; // ⏳
}

/** Fetch oracle prices for all tokens in a single CoinGecko batch call. */
async function fetchOraclePrices(): Promise<Map<string, number>> {
  const ids = getUniqueCoinGeckoIds();
  const base = getCoinGeckoBaseUrl();

  const url = `${base}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
  const res = await fetch(url, {
    headers: getCoinGeckoHeaders(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`CoinGecko returned ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as Record<
    string,
    { usd?: number } | undefined
  >;

  const prices = new Map<string, number>();
  for (const id of ids) {
    const usd = data[id]?.usd;
    if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
      prices.set(id, usd);
    }
  }
  return prices;
}

/**
 * Batch-read on-chain data for all pools:
 * For each pool: slot0 (price) + token0 balanceOf + token1 balanceOf
 */
async function fetchAllPoolData(): Promise<
  Map<
    string,
    {
      sqrtPriceX96: bigint;
      token0Balance: number;
      token1Balance: number;
    }
  >
> {
  const contracts = MONITORED_POOLS.flatMap((pool) => [
    {
      address: pool.poolAddress,
      abi: uniswapV3PoolAbi,
      functionName: "slot0" as const,
    },
    {
      address: pool.token0Address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [pool.poolAddress],
    },
    {
      address: pool.token1Address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [pool.poolAddress],
    },
  ]);

  const results = await publicClient.multicall({
    contracts,
    allowFailure: true,
  });

  const poolData = new Map<
    string,
    { sqrtPriceX96: bigint; token0Balance: number; token1Balance: number }
  >();

  for (let i = 0; i < MONITORED_POOLS.length; i++) {
    const pool = MONITORED_POOLS[i];
    const slot0Result = results[i * 3];
    const bal0Result = results[i * 3 + 1];
    const bal1Result = results[i * 3 + 2];

    if (slot0Result.status !== "success") continue;

    const sqrtPriceX96 = (slot0Result.result as readonly unknown[])[0] as bigint;

    const token0Balance =
      bal0Result.status === "success"
        ? Number(formatUnits(bal0Result.result as bigint, pool.token0Decimals))
        : 0;

    const token1Balance =
      bal1Result.status === "success"
        ? Number(formatUnits(bal1Result.result as bigint, pool.token1Decimals))
        : 0;

    poolData.set(pool.key, { sqrtPriceX96, token0Balance, token1Balance });
  }

  return poolData;
}

// ── Message builders (HTML format for Telegram) ────────────────────────────────

function buildAlertMessage(opts: {
  pool: MonitoredPool;
  poolPrice: number;
  oraclePrice: number;
  spreadPct: number;
  thresholdPct: number;
  previousSpreadPct: number | null;
  tvlUsd: number;
  alertNumber: number;
  cause: { label: string; emoji: string };
}): string {
  const {
    pool,
    poolPrice,
    oraclePrice,
    spreadPct,
    thresholdPct,
    previousSpreadPct: prevSpread,
    tvlUsd,
    alertNumber,
    cause,
  } = opts;

  const emoji = severityEmoji(spreadPct);
  const dirArrow = poolPrice > oraclePrice ? "\u2191" : "\u2193";

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

  const worldscanUrl = `https://worldscan.org/address/${pool.poolAddress}`;
  const dashboardUrl = `https://app.transparent.space/pool/${pool.poolAddress}`;

  return [
    `${emoji} <b>${pool.label}  \u00b7  Alert #${alertNumber}</b>`,
    ``,
    `\u{1F4CA} <b>Spread:  <code>${spreadPct.toFixed(2)}%</code></b>  ${dirArrow}`,
    `\u{1F3AF} Threshold:  <code>${thresholdPct}%</code>`,
    `${cause.emoji} <b>Cause:</b>  ${cause.label}`,
    ``,
    `\u{1F4B1} Pool:  <code>${poolPrice.toFixed(4)}</code>  ${pool.token1Symbol} per ${pool.token0Symbol}`,
    `\u{1F310} Oracle:  <code>${oraclePrice.toFixed(4)}</code>  ${pool.token1Symbol} per ${pool.token0Symbol}`,
    `\u{1F4B0} TVL:  <code>${formatUsd(tvlUsd)}</code>${trendLine}`,
    ``,
    `\u{1F517} <a href="${worldscanUrl}">Worldscan</a>  \u00b7  <a href="${dashboardUrl}">Dashboard</a>`,
    `\u{1F552} <i>${utcNow()}</i>`,
  ].join("\n");
}

function buildRecoveryMessage(opts: {
  pool: MonitoredPool;
  spreadPct: number;
  previousSpreadPct: number;
  thresholdPct: number;
  poolPrice: number;
  oraclePrice: number;
}): string {
  const {
    pool,
    spreadPct,
    previousSpreadPct: prevSpread,
    thresholdPct,
    poolPrice,
    oraclePrice,
  } = opts;

  return [
    `\u{2705} <b>${pool.label}  \u00b7  Recovered</b>`,
    ``,
    `\u{1F4C9} Spread:  <code>${spreadPct.toFixed(2)}%</code>  (was <code>${prevSpread.toFixed(2)}%</code>)`,
    `\u{1F3AF} Back below  <code>${thresholdPct}%</code>  threshold`,
    ``,
    `\u{1F4B1} Pool:  <code>${poolPrice.toFixed(4)}</code>  \u00b7  Oracle:  <code>${oraclePrice.toFixed(4)}</code>`,
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
    // Fetch all on-chain data and oracle prices in parallel
    const [poolDataMap, oraclePrices] = await Promise.all([
      fetchAllPoolData(),
      fetchOraclePrices(),
    ]);

    const thresholdPct = getThresholdPct();
    const now = Date.now();
    const results: Record<string, unknown>[] = [];

    // Process each pool
    for (const pool of MONITORED_POOLS) {
      const onChain = poolDataMap.get(pool.key);
      if (!onChain) {
        results.push({ pair: pool.label, error: "on-chain read failed" });
        continue;
      }

      const poolPrice = sqrtPriceX96ToPrice(
        onChain.sqrtPriceX96,
        pool.token0Decimals,
        pool.token1Decimals,
      );

      // Compute TVL
      const token0Usd = pool.token0CoinGeckoId
        ? (oraclePrices.get(pool.token0CoinGeckoId) ?? 0)
        : 0;
      const token1Usd = pool.token1CoinGeckoId
        ? (oraclePrices.get(pool.token1CoinGeckoId) ?? 0)
        : 0;
      const tvlUsd =
        onChain.token0Balance * token0Usd + onChain.token1Balance * token1Usd;

      // Skip spread monitoring for pools without oracle
      if (!pool.hasOracle) {
        results.push({
          pair: pool.label,
          poolPrice: Number(poolPrice.toFixed(6)),
          tvlUsd: Number(tvlUsd.toFixed(0)),
          skipped: "no oracle for spread",
        });
        continue;
      }

      // Compute oracle cross-rate: price of token0 in terms of token1
      if (token0Usd <= 0 || token1Usd <= 0) {
        results.push({
          pair: pool.label,
          error: "oracle price unavailable",
        });
        continue;
      }
      const oraclePrice = token0Usd / token1Usd;

      const spreadPct =
        Math.abs((poolPrice - oraclePrice) / oraclePrice) * 100;

      const state = getState(pool.key);

      console.log(`[check-spread] ${pool.label}`, {
        poolPrice: poolPrice.toFixed(6),
        oraclePrice: oraclePrice.toFixed(4),
        spreadPct: spreadPct.toFixed(2),
        thresholdPct,
        tvlUsd: tvlUsd.toFixed(0),
        previousSpreadPct: state.previousSpreadPct?.toFixed(2) ?? "n/a",
        wasInAlertState: state.wasInAlertState,
      });

      let alerted = false;
      let recovered = false;

      if (spreadPct > thresholdPct) {
        if (now - state.lastAlertTimestamp > ALERT_COOLDOWN_MS) {
          state.alertCounter += 1;

          const cause = detectSpreadCause({
            poolPrice,
            oraclePrice,
            prevPoolPrice: state.previousPoolPrice,
            prevOraclePrice: state.previousOraclePrice,
          });

          const message = buildAlertMessage({
            pool,
            poolPrice,
            oraclePrice,
            spreadPct,
            thresholdPct,
            previousSpreadPct: state.previousSpreadPct,
            tvlUsd,
            alertNumber: state.alertCounter,
            cause,
          });

          if (spreadAlertsEnabled()) {
            const sent = await sendTelegramMessage(message);
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
            poolPrice,
            oraclePrice,
          });

          if (spreadAlertsEnabled()) {
            await sendTelegramMessage(message);
            recovered = true;
          }
        }
        state.wasInAlertState = false;
      }

      state.previousSpreadPct = spreadPct;
      state.previousPoolPrice = poolPrice;
      state.previousOraclePrice = oraclePrice;

      results.push({
        pair: pool.label,
        poolPrice: Number(poolPrice.toFixed(6)),
        oraclePrice: Number(oraclePrice.toFixed(4)),
        spreadPct: Number(spreadPct.toFixed(2)),
        tvlUsd: Number(tvlUsd.toFixed(0)),
        alerted,
        recovered,
        alertCounter: state.alertCounter,
      });
    }

    return NextResponse.json({ ok: true, thresholdPct, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[check-spread] Error", message);

    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
