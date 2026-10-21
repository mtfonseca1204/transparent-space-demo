import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { publicClient } from "@/lib/viem";
import { uniswapV3PoolAbi, erc20Abi } from "@/lib/uniswap-v3-abi";
import {
  sendTelegramReply,
  sendTelegramMessageWithKeyboard,
  answerCallbackQuery,
} from "@/lib/telegram";
import {
  MONITORED_POOLS,
  getUniqueCoinGeckoIds,
  findPoolByKey,
} from "@/lib/telegram-pools";
import type { MonitoredPool } from "@/lib/telegram-pools";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";

// ── Helpers (shared with check-spread) ─────────────────────────────────────────

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

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function utcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// ── Data fetching ──────────────────────────────────────────────────────────────

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

async function fetchPoolOnChainData(pool: MonitoredPool) {
  const results = await publicClient.multicall({
    contracts: [
      {
        address: pool.poolAddress,
        abi: uniswapV3PoolAbi,
        functionName: "slot0",
      },
      {
        address: pool.token0Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pool.poolAddress],
      },
      {
        address: pool.token1Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [pool.poolAddress],
      },
    ],
    allowFailure: true,
  });

  const slot0Result = results[0];
  const bal0Result = results[1];
  const bal1Result = results[2];

  if (slot0Result.status !== "success") return null;

  const sqrtPriceX96 = (slot0Result.result as readonly unknown[])[0] as bigint;
  const token0Balance =
    bal0Result.status === "success"
      ? Number(formatUnits(bal0Result.result as bigint, pool.token0Decimals))
      : 0;
  const token1Balance =
    bal1Result.status === "success"
      ? Number(formatUnits(bal1Result.result as bigint, pool.token1Decimals))
      : 0;

  return { sqrtPriceX96, token0Balance, token1Balance };
}

// ── Metrics message builder ────────────────────────────────────────────────────

function buildMetricsMessage(opts: {
  pool: MonitoredPool;
  poolPrice: number;
  oraclePrice: number | null;
  spreadPct: number | null;
  tvlUsd: number;
  token0Balance: number;
  token1Balance: number;
  token0Usd: number;
  token1Usd: number;
}): string {
  const {
    pool,
    poolPrice,
    oraclePrice,
    spreadPct,
    tvlUsd,
    token0Balance,
    token1Balance,
    token0Usd,
    token1Usd,
  } = opts;

  const worldscanUrl = `https://worldscan.org/address/${pool.poolAddress}`;
  const dashboardUrl = `https://app.transparent.space/pool/${pool.poolAddress}`;

  const lines: string[] = [
    `\u{1F4CA} <b>${pool.label}  \u00b7  Metrics</b>`,
    ``,
    `\u{1F4B1} Pool Price:  <code>${poolPrice.toFixed(6)}</code>  ${pool.token1Symbol} per ${pool.token0Symbol}`,
  ];

  if (oraclePrice !== null) {
    lines.push(
      `\u{1F310} Oracle Price:  <code>${oraclePrice.toFixed(6)}</code>  ${pool.token1Symbol} per ${pool.token0Symbol}`,
    );
  } else {
    lines.push(`\u{1F310} Oracle Price:  <i>N/A (no listing)</i>`);
  }

  if (spreadPct !== null) {
    lines.push(`\u{1F4CF} Spread:  <code>${spreadPct.toFixed(2)}%</code>`);
  }

  lines.push(``);
  lines.push(`\u{1F4B0} <b>TVL:  ${formatUsd(tvlUsd)}</b>`);

  // Token breakdown
  const bal0Str =
    token0Balance >= 1_000
      ? token0Balance.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : token0Balance.toFixed(2);
  const bal1Str =
    token1Balance >= 1_000
      ? token1Balance.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : token1Balance.toFixed(2);

  const val0 = token0Usd > 0 ? `  (${formatUsd(token0Balance * token0Usd)})` : "";
  const val1 = token1Usd > 0 ? `  (${formatUsd(token1Balance * token1Usd)})` : "";

  lines.push(`  ${pool.token0Symbol}:  <code>${bal0Str}</code>${val0}`);
  lines.push(`  ${pool.token1Symbol}:  <code>${bal1Str}</code>${val1}`);

  lines.push(``);
  lines.push(
    `\u{1F517} <a href="${worldscanUrl}">Worldscan</a>  \u00b7  <a href="${dashboardUrl}">Dashboard</a>`,
  );
  lines.push(`\u{1F552} <i>${utcNow()}</i>`);

  return lines.join("\n");
}

// ── Command handlers ───────────────────────────────────────────────────────────

async function handleMetricsCommand(chatId: number): Promise<void> {
  // Build inline keyboard: 2 columns of pool buttons
  const keyboard: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < MONITORED_POOLS.length; i += 2) {
    const row: { text: string; callback_data: string }[] = [];
    row.push({
      text: MONITORED_POOLS[i].label,
      callback_data: `metrics:${MONITORED_POOLS[i].key}`,
    });
    if (i + 1 < MONITORED_POOLS.length) {
      row.push({
        text: MONITORED_POOLS[i + 1].label,
        callback_data: `metrics:${MONITORED_POOLS[i + 1].key}`,
      });
    }
    keyboard.push(row);
  }

  await sendTelegramMessageWithKeyboard(
    chatId,
    "\u{1F50D} <b>Select a pair:</b>",
    keyboard,
  );
}

async function handleMetricsCallback(
  chatId: number,
  callbackQueryId: string,
  poolKey: string,
): Promise<void> {
  // Acknowledge the button press immediately
  answerCallbackQuery(callbackQueryId).catch(() => {});

  const pool = findPoolByKey(poolKey);
  if (!pool) {
    await sendTelegramReply(chatId, "\u{274C} Unknown pool.");
    return;
  }

  const [onChain, oraclePrices] = await Promise.all([
    fetchPoolOnChainData(pool),
    fetchOraclePrices(),
  ]);

  if (!onChain) {
    await sendTelegramReply(
      chatId,
      `\u{274C} Failed to read on-chain data for ${pool.label}.`,
    );
    return;
  }

  const poolPrice = sqrtPriceX96ToPrice(
    onChain.sqrtPriceX96,
    pool.token0Decimals,
    pool.token1Decimals,
  );

  const token0Usd = pool.token0CoinGeckoId
    ? (oraclePrices.get(pool.token0CoinGeckoId) ?? 0)
    : 0;
  const token1Usd = pool.token1CoinGeckoId
    ? (oraclePrices.get(pool.token1CoinGeckoId) ?? 0)
    : 0;

  const tvlUsd =
    onChain.token0Balance * token0Usd + onChain.token1Balance * token1Usd;

  let oraclePrice: number | null = null;
  let spreadPct: number | null = null;

  if (pool.hasOracle && token0Usd > 0 && token1Usd > 0) {
    oraclePrice = token0Usd / token1Usd;
    spreadPct = Math.abs((poolPrice - oraclePrice) / oraclePrice) * 100;
  }

  const message = buildMetricsMessage({
    pool,
    poolPrice,
    oraclePrice,
    spreadPct,
    tvlUsd,
    token0Balance: onChain.token0Balance,
    token1Balance: onChain.token1Balance,
    token0Usd,
    token1Usd,
  });

  await sendTelegramReply(chatId, message);
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const update = await request.json();

    // Handle /metrics command
    if (update.message?.text) {
      const text = (update.message.text as string).trim();
      const chatId = update.message.chat?.id as number;

      if (text === "/metrics" || text.startsWith("/metrics@")) {
        await handleMetricsCommand(chatId);
        return NextResponse.json({ ok: true });
      }
    }

    // Handle callback query (button press)
    if (update.callback_query) {
      const callbackData = update.callback_query.data as string;
      const callbackQueryId = update.callback_query.id as string;
      const chatId = update.callback_query.message?.chat?.id as number;

      if (callbackData?.startsWith("metrics:")) {
        const poolKey = callbackData.slice("metrics:".length);
        await handleMetricsCallback(chatId, callbackQueryId, poolKey);
        return NextResponse.json({ ok: true });
      }

      // Unknown callback — still acknowledge to dismiss spinner
      answerCallbackQuery(callbackQueryId).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[telegram-webhook] Error", message);
    // Always return 200 to prevent Telegram retries
    return NextResponse.json({ ok: false, error: message });
  }
}
