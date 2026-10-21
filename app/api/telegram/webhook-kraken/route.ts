import { NextRequest, NextResponse } from "next/server";
import {
  KRAKEN_METRICS_ASSETS,
  findKrakenMetricsAssetByKey,
  findKrakenMetricsPoolByKey,
  getKrakenMetricsPoolsForAsset,
} from "@/lib/telegram-kraken-pools";
import type { KrakenMetricsPool } from "@/lib/telegram-kraken-pools";
import type { PoolPricesRpcResponse } from "@/app/api/pool-prices-rpc/route";

// ── RFQ constants ────────────────────────────────────────────────────────────

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

const USDC_ETH_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// ── Telegram helpers (use Kraken bot credentials) ───────────────────────────

function getKrakenBotToken(): string | undefined {
  return process.env.KRAKEN_TELEGRAM_BOT_TOKEN;
}

async function sendKrakenReply(
  chatId: string | number,
  text: string,
): Promise<boolean> {
  const token = getKrakenBotToken();
  if (!token) {
    console.warn("[webhook-kraken] Missing KRAKEN_TELEGRAM_BOT_TOKEN");
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
      console.error("[webhook-kraken] Failed to send message", {
        status: res.status,
        body: body.slice(0, 400),
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[webhook-kraken] Network error", err);
    return false;
  }
}

async function sendKrakenMessageWithKeyboard(
  chatId: string | number,
  text: string,
  keyboard: { text: string; callback_data: string }[][],
): Promise<boolean> {
  const token = getKrakenBotToken();
  if (!token) return false;

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
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function answerKrakenCallbackQuery(callbackQueryId: string): Promise<boolean> {
  const token = getKrakenBotToken();
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://app.transparent.space";
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function utcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function chunkButtons(
  buttons: { text: string; callback_data: string }[],
  columns: number,
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < buttons.length; i += columns) {
    rows.push(buttons.slice(i, i + columns));
  }
  return rows;
}

// ── Data fetching (reuses /api/pool-prices-rpc — same as birds eye view) ────

async function fetchPoolPricesRpc(poolAddresses: string[]): Promise<PoolPricesRpcResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/pool-prices-rpc?pools=${poolAddresses.join(",")}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`pool-prices-rpc returned ${res.status}`);
  return res.json();
}

// ── Metrics message builder ────────────────────────────────────────────────

function buildMetricsMessage(opts: {
  pool: KrakenMetricsPool;
  poolPriceUsd: number;
  oraclePriceUsd: number | null;
  spreadPct: number | null;
}): string {
  const { pool, poolPriceUsd, oraclePriceUsd, spreadPct } = opts;

  const solscanUrl = `https://solscan.io/account/${pool.poolAddress}`;
  const dashboardUrl = `https://app.transparent.space/kraken?pool=${pool.poolAddress}`;

  const lines: string[] = [
    `\u{1F4CA} <b>${pool.label}  \u00b7  ${pool.poolOptionLabel}</b>`,
    ``,
    `\u{1F4B1} Pool Price:  <code>$${poolPriceUsd.toFixed(4)}</code>  USD per ${pool.token0Symbol}`,
  ];

  if (oraclePriceUsd !== null) {
    lines.push(
      `\u{1F310} Oracle Price:  <code>$${oraclePriceUsd.toFixed(4)}</code>  USD per ${pool.token0Symbol}`,
    );
  } else {
    lines.push(`\u{1F310} Oracle Price:  <i>N/A</i>`);
  }

  if (spreadPct !== null) {
    lines.push(`\u{1F4CF} Deviation:  <code>${spreadPct.toFixed(2)}%</code>`);
  }

  lines.push(``);
  lines.push(
    `\u{1F517} <a href="${solscanUrl}">Solscan</a>  \u00b7  <a href="${dashboardUrl}">Dashboard</a>`,
  );
  lines.push(`\u{1F552} <i>${utcNow()}</i>`);

  return lines.join("\n");
}

// ── Command handlers ───────────────────────────────────────────────────────

async function handleMetricsCommand(chatId: number): Promise<void> {
  const keyboard = chunkButtons(
    KRAKEN_METRICS_ASSETS.map((asset) => ({
      text: asset.label,
      callback_data: `kasset:${asset.key}`,
    })),
    2,
  );

  await sendKrakenMessageWithKeyboard(
    chatId,
    "\u{1F50D} <b>Select an asset:</b>",
    keyboard,
  );
}

async function handleAssetCallback(
  chatId: number,
  callbackQueryId: string,
  assetKey: string,
): Promise<void> {
  answerKrakenCallbackQuery(callbackQueryId).catch(() => {});

  const asset = findKrakenMetricsAssetByKey(assetKey);
  const pools = getKrakenMetricsPoolsForAsset(assetKey);
  if (!asset || pools.length === 0) {
    await sendKrakenReply(chatId, "\u{274C} Unknown asset.");
    return;
  }

  // Pool buttons
  const keyboard = chunkButtons(
    pools.map((pool) => ({
      text: pool.poolOptionLabel,
      callback_data: `kpool:${pool.metricsKey}`,
    })),
    1,
  );

  // RFQ aggregator buttons
  const rfqButtons = AGGREGATORS.map((agg) => ({
    text: `RFQ ${AGG_DISPLAY_NAMES[agg]}`,
    callback_data: `krfq:${asset.label}:${agg}`,
  }));
  keyboard.push(...chunkButtons(rfqButtons, 3));

  keyboard.push([{ text: "\u2B05\uFE0F Back", callback_data: "kassets" }]);

  await sendKrakenMessageWithKeyboard(
    chatId,
    `\u{1F50D} <b>${asset.label}</b>\nSelect a pool or RFQ source:`,
    keyboard,
  );
}

async function handlePoolMetricsCallback(
  chatId: number,
  callbackQueryId: string,
  poolKey: string,
): Promise<void> {
  answerKrakenCallbackQuery(callbackQueryId).catch(() => {});

  const pool = findKrakenMetricsPoolByKey(poolKey);
  if (!pool) {
    await sendKrakenReply(chatId, "\u{274C} Unknown pool.");
    return;
  }

  let rpcData: PoolPricesRpcResponse;
  try {
    rpcData = await fetchPoolPricesRpc([pool.poolAddress]);
  } catch {
    await sendKrakenReply(chatId, `\u{274C} Failed to fetch data for ${pool.label}.`);
    return;
  }

  const rpcPrice = rpcData.prices[pool.poolAddress];
  if (!rpcPrice || rpcPrice.price <= 0) {
    await sendKrakenReply(chatId, `\u{274C} No on-chain price for ${pool.label}.`);
    return;
  }

  // Same calculation as birds eye view
  const usdcMintLc = pool.token1Mint.toLowerCase();
  const counterUsd = rpcData.oraclePrices[usdcMintLc] ?? 1;
  const poolPriceUsd = rpcPrice.price * counterUsd;

  const trackedMintLc = pool.token0Mint.toLowerCase();
  const oraclePriceUsd = rpcData.oraclePrices[trackedMintLc] ?? null;

  let spreadPct: number | null = null;
  if (oraclePriceUsd !== null && oraclePriceUsd > 0) {
    spreadPct = Math.abs((poolPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 100;
  }

  const message = buildMetricsMessage({
    pool,
    poolPriceUsd,
    oraclePriceUsd,
    spreadPct,
  });

  await sendKrakenReply(chatId, message);
}

// ── RFQ data fetching (same logic as check-rfq-deviation cron) ──────────────

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

function rawToNumber(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
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

    const tiers = new Map<number, { bid: number; ask: number }>();
    for (const q of latestCap.quotes) {
      const notional = parseFloat(q.notional_usd);
      const price = computeTokenPrice(q);
      if (price <= 0) continue;

      const entry = tiers.get(notional) ?? { bid: 0, ask: 0 };
      if (q.direction === "forward") {
        entry.bid = price;
      } else {
        entry.ask = price;
      }
      tiers.set(notional, entry);
    }

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
      price: Number(last[4]),
      timestamp: Number(last[0]),
    };
  } catch {
    return null;
  }
}

// ── RFQ metrics handler ─────────────────────────────────────────────────────

function buildRfqMetricsMessage(opts: {
  asset: string;
  aggregator: string;
  rfqMid: number;
  krakenPrice: number;
  deviationPct: number;
  quoteAt: string;
}): string {
  const { asset, aggregator, rfqMid, krakenPrice, deviationPct, quoteAt } = opts;
  const dashboardUrl = `https://app.transparent.space/kraken`;

  return [
    `\u{1F4CA} <b>${asset}  \u00b7  RFQ ${aggregator}</b>`,
    ``,
    `\u{1F4B1} RFQ Mid:  <code>$${rfqMid.toFixed(4)}</code>`,
    `\u{1F310} Kraken xUSD:  <code>$${krakenPrice.toFixed(4)}</code>`,
    `\u{1F4CF} Deviation:  <code>${deviationPct.toFixed(2)}%</code>`,
    ``,
    `\u{1F4C5} Quote at:  <i>${quoteAt}</i>`,
    `\u{1F517} <a href="${dashboardUrl}">Dashboard</a>`,
    `\u{1F552} <i>${utcNow()}</i>`,
  ].join("\n");
}

async function handleRfqMetricsCallback(
  chatId: number,
  callbackQueryId: string,
  assetSymbol: string,
  aggregator: Aggregator,
): Promise<void> {
  answerKrakenCallbackQuery(callbackQueryId).catch(() => {});

  const [rfq, kraken] = await Promise.all([
    fetchLatestRfqMid(assetSymbol, aggregator),
    fetchKrakenXusdPrice(assetSymbol),
  ]);

  if (!rfq) {
    await sendKrakenReply(chatId, `\u{274C} No RFQ data for ${assetSymbol} on ${AGG_DISPLAY_NAMES[aggregator]}.`);
    return;
  }

  if (!kraken) {
    await sendKrakenReply(chatId, `\u{274C} Kraken xUSD price unavailable for ${assetSymbol}.`);
    return;
  }

  const deviationPct = Math.abs((rfq.midPrice - kraken.price) / kraken.price) * 100;

  const message = buildRfqMetricsMessage({
    asset: assetSymbol,
    aggregator: AGG_DISPLAY_NAMES[aggregator],
    rfqMid: rfq.midPrice,
    krakenPrice: kraken.price,
    deviationPct,
    quoteAt: rfq.quoteAt,
  });

  await sendKrakenReply(chatId, message);
}

// ── Route handler ──────────────────────────────────────────────────────────

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

      if (callbackData === "kassets") {
        answerKrakenCallbackQuery(callbackQueryId).catch(() => {});
        await handleMetricsCommand(chatId);
        return NextResponse.json({ ok: true });
      }

      if (callbackData?.startsWith("kasset:")) {
        const assetKey = callbackData.slice("kasset:".length);
        await handleAssetCallback(chatId, callbackQueryId, assetKey);
        return NextResponse.json({ ok: true });
      }

      if (callbackData?.startsWith("kpool:")) {
        const poolKey = callbackData.slice("kpool:".length);
        await handlePoolMetricsCallback(chatId, callbackQueryId, poolKey);
        return NextResponse.json({ ok: true });
      }

      if (callbackData?.startsWith("kmetrics:")) {
        const poolKey = callbackData.slice("kmetrics:".length);
        await handlePoolMetricsCallback(chatId, callbackQueryId, poolKey);
        return NextResponse.json({ ok: true });
      }

      if (callbackData?.startsWith("krfq:")) {
        const parts = callbackData.slice("krfq:".length).split(":");
        const assetSymbol = parts[0];
        const aggregator = parts[1] as Aggregator;
        if (assetSymbol && AGGREGATORS.includes(aggregator)) {
          await handleRfqMetricsCallback(chatId, callbackQueryId, assetSymbol, aggregator);
          return NextResponse.json({ ok: true });
        }
      }

      answerKrakenCallbackQuery(callbackQueryId).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[webhook-kraken] Error", message);
    return NextResponse.json({ ok: false, error: message });
  }
}
