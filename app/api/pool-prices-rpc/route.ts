import { NextRequest, NextResponse } from "next/server";
import { sqrtPriceX64ToPrice, sqrtPriceX64ToX96 } from "@/lib/raydium-math";
import { getSolanaPoolMetadata } from "@/lib/pools";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";
import { getDemoPoolPricesRpc, isDemoRequest, resolveDemoPoolKey } from "@/lib/demo/fixtures";
import { isDemoPoolKey } from "@/lib/demo/constants";

/**
 * Batch-read Raydium CLMM pool prices directly from Solana RPC
 * using getMultipleAccounts, PLUS fetch CoinGecko oracle prices for
 * the tracked tokens — both in a single request so they're comparable.
 *
 * Query: ?pools=addr1,addr2,...
 */

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

// ── Raydium CLMM PoolState layout offsets ────────────────────────────────
// 8  bytes: Anchor discriminator
// 1  byte:  bump
// 7×32 = 224 bytes: amm_config, owner, token_mint_0, token_mint_1,
//                    token_vault_0, token_vault_1, observation_key
// 1  byte:  mint_decimals_0
// 1  byte:  mint_decimals_1
// 2  bytes: tick_spacing (i16)
// 16 bytes: liquidity (u128)
// 16 bytes: sqrt_price_x64 (u128)
// 4  bytes: tick_current (i32)

const OFFSET_DECIMALS_0 = 8 + 1 + 7 * 32; // 233
const OFFSET_DECIMALS_1 = OFFSET_DECIMALS_0 + 1; // 234
const OFFSET_LIQUIDITY = OFFSET_DECIMALS_1 + 1 + 2; // 237 (skip tick_spacing u16)
const OFFSET_SQRT_PRICE_X64 = OFFSET_LIQUIDITY + 16; // 253
const OFFSET_TICK_CURRENT = OFFSET_SQRT_PRICE_X64 + 16; // 269

function readU128LE(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  return lo + (hi << 64n);
}

export interface RpcPoolPrice {
  price: number;
  tick: number;
  sqrtPriceX64: string;
  sqrtPriceX96: string;
  decimals0: number;
  decimals1: number;
}

export interface PoolPricesRpcResponse {
  prices: Record<string, RpcPoolPrice>;
  /** CoinGecko oracle USD prices keyed by lowercased token mint */
  oraclePrices: Record<string, number>;
  /** CoinGecko `last_updated_at` per coin, keyed by lowercased mint (unix seconds) */
  oracleUpdatedAt: Record<string, number>;
  /** Timestamp (ms) when the Solana RPC response was received */
  rpcFetchedAt: number;
  /** Timestamp (ms) when the CoinGecko response was received */
  oracleFetchedAt: number;
  fetchedAt: number;
}

function parsePoolAccount(
  base64Data: string
): RpcPoolPrice | null {
  try {
    const buf = Buffer.from(base64Data, "base64");
    if (buf.length < OFFSET_TICK_CURRENT + 4) return null;

    const decimals0 = buf[OFFSET_DECIMALS_0];
    const decimals1 = buf[OFFSET_DECIMALS_1];
    const sqrtPriceX64 = readU128LE(buf, OFFSET_SQRT_PRICE_X64);
    const tickCurrent = buf.readInt32LE(OFFSET_TICK_CURRENT);

    if (sqrtPriceX64 === 0n) return null;

    const price = sqrtPriceX64ToPrice(sqrtPriceX64, decimals0, decimals1);
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      price,
      tick: tickCurrent,
      sqrtPriceX64: sqrtPriceX64.toString(),
      sqrtPriceX96: sqrtPriceX64ToX96(sqrtPriceX64),
      decimals0,
      decimals1,
    };
  } catch {
    return null;
  }
}

async function fetchMultipleAccounts(
  addresses: string[]
): Promise<Array<{ data: [string, string] } | null>> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [
          addresses,
          { encoding: "base64", commitment: "confirmed" },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 429 && attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 1000 + 1500 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Solana RPC error: ${res.status}`);

    const json = await res.json();
    return json?.result?.value ?? [];
  }
  throw new Error("Solana RPC: max retries exceeded");
}

// ── CoinGecko oracle price fetching ──────────────────────────────────────

// Persistent cache: Solana mint (original case) → CoinGecko coin ID.
// Survives across requests so contract lookups only happen once per server lifecycle.
const mintToCoinGeckoId = new Map<string, string | null>();

// Known stablecoins — no need to discover via CoinGecko
const KNOWN_COINGECKO_IDS: Record<string, string> = {
  DN4L5JE9VuGpMt1SsEWqyybUqyrYuWuywmTq7Q5GVDFK: "worldcoin-wld", // WLD (wormhole) on Solana
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "usd-coin", // USDC on Solana
};

async function discoverCoinGeckoId(mint: string): Promise<string | null> {
  if (mintToCoinGeckoId.has(mint)) return mintToCoinGeckoId.get(mint)!;

  const known = KNOWN_COINGECKO_IDS[mint];
  if (known) {
    mintToCoinGeckoId.set(mint, known);
    return known;
  }

  try {
    const url = `${getCoinGeckoBaseUrl()}/coins/solana/contract/${mint}`;
    const res = await fetch(url, {
      headers: getCoinGeckoHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      const id = data.id ?? null;
      mintToCoinGeckoId.set(mint, id);
      return id;
    }
  } catch {
    // Network error — don't cache, retry next request
    return null;
  }
  mintToCoinGeckoId.set(mint, null);
  return null;
}

interface OraclePricesResult {
  prices: Record<string, number>;
  /** CoinGecko last_updated_at (unix seconds) keyed by lowercased mint */
  updatedAt: Record<string, number>;
  /** Timestamp (ms) when we received the CoinGecko response */
  fetchedAt: number;
}

/**
 * Fetch CoinGecko oracle prices for a set of Solana token mints.
 * Returns prices + last_updated_at keyed by lowercased mint address.
 */
async function fetchOraclePrices(
  mints: string[]
): Promise<OraclePricesResult> {
  const empty: OraclePricesResult = { prices: {}, updatedAt: {}, fetchedAt: 0 };
  if (mints.length === 0) return empty;

  // 1. Discover CoinGecko IDs for all mints (cached after first call)
  const idByMint = new Map<string, string>();
  await Promise.all(
    mints.map(async (mint) => {
      const id = await discoverCoinGeckoId(mint);
      if (id) idByMint.set(mint, id);
    })
  );

  if (idByMint.size === 0) return empty;

  // 2. Batch-fetch prices in a single CoinGecko /simple/price call
  const uniqueIds = [...new Set(idByMint.values())];
  const base = getCoinGeckoBaseUrl();
  const url = `${base}/simple/price?ids=${encodeURIComponent(uniqueIds.join(","))}&vs_currencies=usd&include_last_updated_at=true`;

  try {
    const res = await fetch(url, {
      headers: getCoinGeckoHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return empty;

    const fetchedAt = Date.now();
    const data = (await res.json()) as Record<string, { usd?: number; last_updated_at?: number } | undefined>;
    const prices: Record<string, number> = {};
    const updatedAt: Record<string, number> = {};

    for (const [mint, coinId] of idByMint.entries()) {
      const entry = data[coinId];
      const usd = entry?.usd;
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
        const key = mint.toLowerCase();
        prices[key] = usd;
        if (typeof entry?.last_updated_at === "number") {
          updatedAt[key] = entry.last_updated_at;
        }
      }
    }
    return { prices, updatedAt, fetchedAt };
  } catch {
    return empty;
  }
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const poolsParam = request.nextUrl.searchParams.get("pools");
  if (!poolsParam) {
    return NextResponse.json(
      { error: "Missing 'pools' query parameter" },
      { status: 400 }
    );
  }

  const addresses = poolsParam
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  if (isDemoRequest(request) || addresses.some((address) => isDemoPoolKey(address))) {
    return NextResponse.json(getDemoPoolPricesRpc(addresses.map((address) => resolveDemoPoolKey(address))), {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
        "X-Source": "demo-fixture",
      },
    });
  }

  if (addresses.length === 0) {
    return NextResponse.json({ prices: {}, oraclePrices: {}, fetchedAt: Date.now() });
  }

  if (addresses.length > 100) {
    return NextResponse.json(
      { error: "Too many pools (max 100)" },
      { status: 400 }
    );
  }

  try {
    // Collect unique token mints that need oracle prices (tracked + counter tokens)
    const allMints = new Set<string>();
    for (const addr of addresses) {
      const meta = getSolanaPoolMetadata(addr);
      if (!meta) continue;
      if (meta.token0Mint) allMints.add(meta.token0Mint);
      if (meta.token1Mint) allMints.add(meta.token1Mint);
    }

    // Fetch RPC pool prices + CoinGecko oracle prices in parallel
    const [accounts, oracleResult] = await Promise.all([
      fetchMultipleAccounts(addresses),
      fetchOraclePrices([...allMints]),
    ]);
    const rpcFetchedAt = Date.now();

    const prices: Record<string, RpcPoolPrice> = {};
    for (let i = 0; i < addresses.length; i++) {
      const acct = accounts[i];
      if (!acct?.data?.[0]) continue;
      const parsed = parsePoolAccount(acct.data[0]);
      if (parsed) {
        prices[addresses[i]] = parsed;
      }
    }

    const response: PoolPricesRpcResponse = {
      prices,
      oraclePrices: oracleResult.prices,
      oracleUpdatedAt: oracleResult.updatedAt,
      rpcFetchedAt,
      oracleFetchedAt: oracleResult.fetchedAt,
      fetchedAt: Date.now(),
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
      },
    });
  } catch (error) {
    console.error("Error fetching pool prices from RPC:", error);
    return NextResponse.json(
      { error: "Failed to fetch pool prices from RPC" },
      { status: 502 }
    );
  }
}
