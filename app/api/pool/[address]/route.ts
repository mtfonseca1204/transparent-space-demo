import { NextRequest, NextResponse } from "next/server";
import { isAddress, formatUnits } from "viem";
import { getPublicClientForChainId, publicClient } from "@/lib/viem";
import { uniswapV3PoolAbi, erc20Abi } from "@/lib/uniswap-v3-abi";
import {
  getSupportedPool,
  getSolanaPoolMetadata,
  isSolanaPool,
  normalizePoolKeyInput,
} from "@/lib/pools";
import { getPoolAnalyticsProfile, type PoolAnalyticsModel, type PoolCapabilities } from "@/lib/pool-analytics";
import { fetchSolanaApi, type SolanaPriceResponse } from "@/lib/solana-indexer-client";
import {
  humanPriceToSqrtPriceX96,
  humanPriceToTick,
  sqrtPriceX64ToX96,
} from "@/lib/raydium-math";
import {
  fetchWorldchainPoolById,
  isWorldchainIndexerPool,
  getRailwayIndexerSpace,
  usesRailwayIndexedSnapshot,
} from "@/lib/worldchain-indexer-client";
import { hasUsableIndexedV4Tvl } from "@/lib/v4-tvl-source";
import { isReserveBackedIndexedPool } from "@/lib/evm-v2-pool-support";
import { getDemoPoolData, isDemoRequest, resolveDemoPoolKey } from "@/lib/demo/fixtures";

export type PoolData = {
  protocol: string;
  analyticsModel: PoolAnalyticsModel;
  capabilities: PoolCapabilities;

  // Pool info
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  fee: number;
  tickSpacing: number;

  // Token info
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;

  // Current state
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;

  // Balances (formatted)
  token0Balance: string;
  token1Balance: string;
  token0BalanceRaw: string;
  token1BalanceRaw: string;

  // Derived values
  currentPrice: number; // token1 per token0
  token0Percent: number;
  token1Percent: number;

  activeBinId?: number | null;
  binStepBps?: number | null;
  token0Reserve?: string | null;
  token1Reserve?: string | null;
  lastTradeAt?: string | null;
  v4TvlSource?: "indexed-pool" | "unavailable";

  // Fee growth accumulators (cumulative fees per unit of virtual liquidity since pool inception)
  feeGrowthGlobal0X128?: string;
  feeGrowthGlobal1X128?: string;
};

// Convert sqrtPriceX96 to actual price (token1 per token0)
function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  token0Decimals: number,
  token1Decimals: number
): number {
  const Q96 = BigInt(2) ** BigInt(96);
  // Calculate sqrtPrice as a number (sqrtPriceX96 / 2^96)
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  // Square it to get the raw price
  const priceRaw = sqrtPrice * sqrtPrice;
  // Adjust for decimal differences: multiply by 10^(token0Decimals - token1Decimals)
  const price = priceRaw * Math.pow(10, token0Decimals - token1Decimals);
  return price;
}

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DEXSCREENER_API_URL =
  process.env.DEXSCREENER_API_URL ?? "https://api.dexscreener.com";

type DexScreenerPairResponse = {
  pair?: {
    liquidity?: {
      base?: number;
      quote?: number;
    };
    baseToken?: { address?: string };
    quoteToken?: { address?: string };
  };
};

type EvmTokenMetadata = {
  symbol: string;
  decimals: number;
};

const KNOWN_EVM_TOKEN_METADATA: Record<string, EvmTokenMetadata> = {
  "1:0x4d7078ddd6ccfed2f85db5b7d3ff16828d378d48": {
    symbol: "AI",
    decimals: 18,
  },
  "56:0x55d398326f99059ff775485246999027b3197955": {
    symbol: "USDT",
    decimals: 18,
  },
  "56:0xd20fb09a49a8e75fef536a2dbc68222900287bac": {
    symbol: "PRL",
    decimals: 8,
  },
  "56:0x4b948d64de1f71fcd12fb586f4c776421a35b3ee": {
    symbol: "0G",
    decimals: 18,
  },
  "747474:0x203a662b0bd271a6ed5a60edfbd04bfce608fd36": {
    symbol: "vbUSDC",
    decimals: 6,
  },
  "747474:0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62": {
    symbol: "vbETH",
    decimals: 18,
  },
  "143:0x754704bc059f8c67012fed69bc8a327a5aafb603": {
    symbol: "USDC",
    decimals: 6,
  },
  "143:0xad96c3dffcd6374294e2573a7fbba96097cc8d7c": {
    symbol: "DUST",
    decimals: 18,
  },
  "16661:0x1f3aa82227281ca364bfb3d253b0f1af1da6473e": {
    symbol: "USDC.e",
    decimals: 6,
  },
  "16661:0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c": {
    symbol: "W0G",
    decimals: 18,
  },
  "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    symbol: "USDC",
    decimals: 6,
  },
  "1:0xdac17f958d2ee523a2206206994597c13d831ec7": {
    symbol: "USDT",
    decimals: 6,
  },
  "1:0x0000000000000000000000000000000000000000": {
    symbol: "ETH",
    decimals: 18,
  },
};

function getKnownEvmTokenMetadata(
  chainId: number,
  address: string
): EvmTokenMetadata | null {
  return KNOWN_EVM_TOKEN_METADATA[`${chainId}:${address.toLowerCase()}`] ?? null;
}

async function fetchEvmTokenMetadataPair(
  chainId: number,
  token0: string,
  token1: string
) {
  const knownToken0 = getKnownEvmTokenMetadata(chainId, token0);
  const knownToken1 = getKnownEvmTokenMetadata(chainId, token1);
  if (knownToken0 && knownToken1) {
    return [
      knownToken0.symbol,
      knownToken0.decimals,
      knownToken1.symbol,
      knownToken1.decimals,
    ] as const;
  }

  const evmClient = getPublicClientForChainId(chainId);
  return evmClient.multicall({
    contracts: [
      {
        address: token0 as `0x${string}`,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        address: token0 as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals",
      },
      {
        address: token1 as `0x${string}`,
        abi: erc20Abi,
        functionName: "symbol",
      },
      {
        address: token1 as `0x${string}`,
        abi: erc20Abi,
        functionName: "decimals",
      },
    ],
    allowFailure: false,
  });
}

function normalizeIntegerLike(
  value: string | number | bigint | null | undefined,
  fallback: string = "0"
): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return trimmed;
  }
  return fallback;
}

function toRawTokenAmount(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  const fixed = amount.toFixed(Math.min(decimals, 9));
  const [whole, fraction = ""] = fixed.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const normalized = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

async function fetchDexScreenerLiquidityFallback(address: string) {
  try {
    const res = await fetch(
      `${DEXSCREENER_API_URL}/latest/dex/pairs/solana/${address}`,
      {
        signal: AbortSignal.timeout(8_000),
        next: { revalidate: 30 },
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as DexScreenerPairResponse;
    const pair = json.pair;
    if (!pair?.liquidity) return null;
    return {
      base: Number(pair.liquidity.base ?? 0),
      quote: Number(pair.liquidity.quote ?? 0),
      baseTokenAddress: pair.baseToken?.address ?? "",
      quoteTokenAddress: pair.quoteToken?.address ?? "",
    };
  } catch {
    return null;
  }
}

/** Fetch SPL token account balance via Solana JSON-RPC with retry on 429. */
async function getSplTokenBalance(
  vaultAddress: string
): Promise<{ amount: string; decimals: number }> {
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountBalance",
        params: [vaultAddress],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 + 1500 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Solana RPC error: ${res.status}`);
    const json = await res.json();
    const value = json?.result?.value;
    if (!value) throw new Error("No balance returned from Solana RPC");
    return { amount: value.amount, decimals: value.decimals };
  }
  throw new Error("Solana RPC: max retries exceeded");
}

async function handleRaydiumPool(address: string): Promise<NextResponse> {
  const meta = getSolanaPoolMetadata(address);
  if (!meta) {
    throw new Error(`Unsupported Solana pool metadata: ${address}`);
  }
  const analyticsProfile = getPoolAnalyticsProfile(address);

  // Fetch pool-specific price snapshot.
  const data = await fetchSolanaApi<SolanaPriceResponse>("/api/price", { pool: address });

  // Railway returns a human-readable price directly; use it when available.
  // Fallback to a neutral value to avoid hard-failing the route on sparse rows.
  const currentPrice =
    typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0
      ? data.price
      : 1;
  const parsedTick =
    data.tick === null || data.tick === undefined || data.tick === ""
      ? NaN
      : Number(data.tick);
  const derivedTick = humanPriceToTick(
    currentPrice,
    meta.token0Decimals,
    meta.token1Decimals
  );
  const currentTick = Number.isFinite(parsedTick) ? parsedTick : derivedTick;
  const liquidity = normalizeIntegerLike(data.liquidity);
  const sqrtPriceX96 =
    data.sqrt_price_x64 !== null && data.sqrt_price_x64 !== undefined
      ? sqrtPriceX64ToX96(data.sqrt_price_x64)
      : humanPriceToSqrtPriceX96(
          currentPrice,
          meta.token0Decimals,
          meta.token1Decimals
        );

  // Use on-chain vault balances when known; otherwise keep 0 placeholders.
  let token0Balance = 0;
  let token1Balance = 0;
  let token0BalanceRaw = "0";
  let token1BalanceRaw = "0";
  if (meta.token0Vault && meta.token1Vault) {
    try {
      const token0Vault = await getSplTokenBalance(meta.token0Vault);
      const token1Vault = await getSplTokenBalance(meta.token1Vault);
      token0Balance = Number(token0Vault.amount) / 10 ** token0Vault.decimals;
      token1Balance = Number(token1Vault.amount) / 10 ** token1Vault.decimals;
      token0BalanceRaw = token0Vault.amount;
      token1BalanceRaw = token1Vault.amount;
    } catch (err) {
      console.warn(`Failed to fetch vault balances for ${address}, using zeros:`, err);
    }
  }

  if ((token0Balance <= 0 || token1Balance <= 0) && (!meta.token0Vault || !meta.token1Vault)) {
    const fallback = await fetchDexScreenerLiquidityFallback(address);
    const matchesTokenOrder =
      fallback &&
      (!meta.token0Mint || fallback.baseTokenAddress === meta.token0Mint) &&
      (!meta.token1Mint || fallback.quoteTokenAddress === meta.token1Mint);
    if (matchesTokenOrder) {
      token0Balance = fallback.base;
      token1Balance = fallback.quote;
      token0BalanceRaw = toRawTokenAmount(token0Balance, meta.token0Decimals);
      token1BalanceRaw = toRawTokenAmount(token1Balance, meta.token1Decimals);
    }
  }

  // Calculate token percentages by value
  const token0InToken1 = token0Balance * currentPrice;
  const totalInToken1 = token0InToken1 + token1Balance;
  const token0Percent = totalInToken1 > 0 ? (token0InToken1 / totalInToken1) * 100 : 50;
  const activeBinId = Number.isFinite(Number(data.active_bin_id))
    ? Number(data.active_bin_id)
    : Number.isFinite(Number(data.last_swap_bin_id))
      ? Number(data.last_swap_bin_id)
      : null;

  const poolData: PoolData = {
    protocol:
      typeof data.protocol === "string" && data.protocol.trim().length > 0
        ? data.protocol
        : analyticsProfile.analyticsModel === "meteora-dlmm"
          ? "meteora-dlmm"
          : "raydium-clmm",
    analyticsModel: analyticsProfile.analyticsModel,
    capabilities: analyticsProfile.capabilities,

    poolAddress: address,
    token0Address: meta.token0Mint ?? `${address}-token0`,
    token1Address: meta.token1Mint ?? `${address}-token1`,
    fee: meta.fee ?? 2500,
    tickSpacing: meta.tickSpacing ?? 60,

    token0Symbol: meta.token0Symbol,
    token1Symbol: meta.token1Symbol,
    token0Decimals: meta.token0Decimals,
    token1Decimals: meta.token1Decimals,

    sqrtPriceX96,
    tick: currentTick,
    liquidity,

    token0Balance: String(token0Balance),
    token1Balance: String(token1Balance),
    token0BalanceRaw,
    token1BalanceRaw,

    currentPrice,
    token0Percent,
    token1Percent: 100 - token0Percent,
    activeBinId,
    binStepBps:
      typeof data.bin_step_bps === "number" && Number.isFinite(data.bin_step_bps)
        ? data.bin_step_bps
        : null,
    token0Reserve: token0BalanceRaw,
    token1Reserve: token1BalanceRaw,
    lastTradeAt: data.block_time ?? null,
  };

  return NextResponse.json(poolData, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}

async function handleRailwayIndexedEvmPool(poolKey: string): Promise<NextResponse> {
  const pool = await fetchWorldchainPoolById(poolKey);
  if (!pool) {
    return NextResponse.json(
      { error: "Pool not found" },
      { status: 404 }
    );
  }

  const [token0Symbol, token0Decimals, token1Symbol, token1Decimals] =
    await fetchEvmTokenMetadataPair(pool.chainId, pool.token0, pool.token1);

  const currentPrice = sqrtPriceX96ToPrice(
    BigInt(pool.sqrtPriceX96),
    token0Decimals,
    token1Decimals
  );
  const analyticsProfile = getPoolAnalyticsProfile(poolKey);
  const tvlToken0Raw = normalizeIntegerLike(pool.tvlToken0, "0");
  const tvlToken1Raw = normalizeIntegerLike(pool.tvlToken1, "0");
  const isReserveBacked = isReserveBackedIndexedPool(pool.protocol);
  const hasIndexedV4Tvl = !isReserveBacked && hasUsableIndexedV4Tvl({
    poolKey,
    tvlToken0Raw,
    tvlToken1Raw,
  });
  const token0BalanceRaw = isReserveBacked || hasIndexedV4Tvl ? tvlToken0Raw : "0";
  const token1BalanceRaw = isReserveBacked || hasIndexedV4Tvl ? tvlToken1Raw : "0";
  const token0Balance = formatUnits(BigInt(token0BalanceRaw), token0Decimals);
  const token1Balance = formatUnits(BigInt(token1BalanceRaw), token1Decimals);
  const token0InToken1 = Number(token0Balance) * currentPrice;
  const totalInToken1 = token0InToken1 + Number(token1Balance);
  const token0Percent = totalInToken1 > 0 ? (token0InToken1 / totalInToken1) * 100 : 50;

  const poolData: PoolData = {
    protocol: pool.protocol,
    analyticsModel: analyticsProfile.analyticsModel,
    capabilities: analyticsProfile.capabilities,

    poolAddress: pool.id,
    token0Address: pool.token0,
    token1Address: pool.token1,
    fee: Number(pool.fee),
    tickSpacing: Number(pool.tickSpacing),

    token0Symbol,
    token1Symbol,
    token0Decimals,
    token1Decimals,

    sqrtPriceX96: pool.sqrtPriceX96,
    tick: Number(pool.tick),
    liquidity: pool.liquidity,

    token0Balance,
    token1Balance,
    token0BalanceRaw,
    token1BalanceRaw,

    currentPrice,
    token0Percent,
    token1Percent: 100 - token0Percent,
    activeBinId: null,
    binStepBps: null,
    token0Reserve: token0BalanceRaw,
    token1Reserve: token1BalanceRaw,
    lastTradeAt: null,
    v4TvlSource: isReserveBacked ? undefined : hasIndexedV4Tvl ? "indexed-pool" : "unavailable",
  };

  return NextResponse.json(poolData, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const normalizedAddress = normalizePoolKeyInput(address);

  if (isDemoRequest(request, normalizedAddress)) {
    return NextResponse.json(getDemoPoolData(resolveDemoPoolKey(normalizedAddress)), {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Source": "demo-fixture",
      },
    });
  }

  // Raydium / Solana pool — proxy to Railway API
  if (isSolanaPool(normalizedAddress)) {
    try {
      return await handleRaydiumPool(normalizedAddress);
    } catch (error) {
      console.error("Error fetching Raydium pool data:", error);
      return NextResponse.json(
        { error: "Failed to fetch Raydium pool data" },
        { status: 502 }
      );
    }
  }

  if (
    isWorldchainIndexerPool(normalizedAddress) &&
    usesRailwayIndexedSnapshot(normalizedAddress)
  ) {
    try {
      return await handleRailwayIndexedEvmPool(normalizedAddress);
    } catch (error) {
      console.error("Error fetching Railway indexed pool data:", error);
      return NextResponse.json(
        { error: "Failed to fetch Railway indexed pool data" },
        { status: 502 }
      );
    }
  }

  if (!isAddress(normalizedAddress)) {
    return NextResponse.json(
      { error: "Invalid pool address" },
      { status: 400 }
    );
  }

  try {
    const analyticsProfile = getPoolAnalyticsProfile(normalizedAddress);
    const supportedPool = getSupportedPool(normalizedAddress);
    const railwaySpace = getRailwayIndexerSpace(normalizedAddress);
    const evmClient =
      supportedPool?.chainId
        ? getPublicClientForChainId(supportedPool.chainId)
      : railwaySpace === "gensyn"
        ? getPublicClientForChainId(1)
        : publicClient;
    // First batch: Get pool basic info
    const [slot0, liquidity, token0Address, token1Address, fee, tickSpacing, feeGrowthGlobal0X128, feeGrowthGlobal1X128] =
      await evmClient.multicall({
        contracts: [
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "slot0" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "liquidity" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "token0" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "token1" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "fee" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "tickSpacing" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "feeGrowthGlobal0X128" },
          { address: normalizedAddress, abi: uniswapV3PoolAbi, functionName: "feeGrowthGlobal1X128" },
        ],
        allowFailure: false,
      });

    // Second batch: Get token info and balances
    const [
      token0Symbol,
      token0Decimals,
      token0Balance,
      token1Symbol,
      token1Decimals,
      token1Balance,
    ] = await evmClient.multicall({
      contracts: [
        {
          address: token0Address,
          abi: erc20Abi,
          functionName: "symbol",
        },
        {
          address: token0Address,
          abi: erc20Abi,
          functionName: "decimals",
        },
        {
          address: token0Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [normalizedAddress],
        },
        {
          address: token1Address,
          abi: erc20Abi,
          functionName: "symbol",
        },
        {
          address: token1Address,
          abi: erc20Abi,
          functionName: "decimals",
        },
        {
          address: token1Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [normalizedAddress],
        },
      ],
      allowFailure: false,
    });

    // Calculate derived values
    const sqrtPriceX96 = slot0[0];
    const tick = slot0[1];

    const currentPrice = sqrtPriceX96ToPrice(
      sqrtPriceX96,
      token0Decimals,
      token1Decimals
    );

    // Format balances
    const token0BalanceFormatted = formatUnits(token0Balance, token0Decimals);
    const token1BalanceFormatted = formatUnits(token1Balance, token1Decimals);

    // Calculate token percentages (by USD value approximation)
    // Using current price to convert token0 to token1 equivalent
    const token0InToken1 = Number(token0BalanceFormatted) * currentPrice;
    const totalInToken1 = token0InToken1 + Number(token1BalanceFormatted);

    const token0Percent =
      totalInToken1 > 0 ? (token0InToken1 / totalInToken1) * 100 : 50;
    const token1Percent = 100 - token0Percent;

    const poolData: PoolData = {
      protocol: "v3",
      analyticsModel: analyticsProfile.analyticsModel,
      capabilities: analyticsProfile.capabilities,

      poolAddress: normalizedAddress,
      token0Address,
      token1Address,
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),

      token0Symbol,
      token1Symbol,
      token0Decimals,
      token1Decimals,

      sqrtPriceX96: sqrtPriceX96.toString(),
      tick: Number(tick),
      liquidity: liquidity.toString(),

      token0Balance: token0BalanceFormatted,
      token1Balance: token1BalanceFormatted,
      token0BalanceRaw: token0Balance.toString(),
      token1BalanceRaw: token1Balance.toString(),

      currentPrice,
      token0Percent,
      token1Percent,
      activeBinId: null,
      binStepBps: null,
      token0Reserve: token0Balance.toString(),
      token1Reserve: token1Balance.toString(),
      lastTradeAt: null,

      feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
      feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString(),
    };

    return NextResponse.json(poolData, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("Error fetching pool data:", error);
    return NextResponse.json(
      { error: "Failed to fetch pool data" },
      { status: 500 }
    );
  }
}
