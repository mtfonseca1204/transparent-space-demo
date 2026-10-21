import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import {
  MONAD_V2_DUST_ADDRESS,
  MONAD_V2_DUST_ICON,
  MONAD_V2_DUST_USDC_POOL_KEY,
  MONAD_V2_USDC_ADDRESS,
  type MonadV2DashboardData,
  type MonadV2LpHolder,
} from "@/lib/monad-v2-dashboard";
import {
  fetchRailwayEntityPaginated,
  fetchWorldchainPoolById,
} from "@/lib/worldchain-indexer-client";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LP_DECIMALS = 18;
const USDC_DECIMALS = 6;
const DUST_DECIMALS = 18;
const MAX_TRANSFER_PAGES = 8;
const TOP_HOLDER_LIMIT = 8;
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=900";

let cachedDashboard:
  | { timestamp: number; payload: MonadV2DashboardData }
  | null = null;
let pendingDashboard: Promise<MonadV2DashboardData> | null = null;

class DashboardNotFoundError extends Error {}

type UniswapV2PairTransferRow = {
  id: string;
  from: string;
  to: string;
  value: string;
};

function addBalance(map: Map<string, bigint>, address: string, delta: bigint) {
  const key = address.toLowerCase();
  map.set(key, (map.get(key) ?? 0n) + delta);
}

function toNumberUnit(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

function normalizeRawAmount(value: string | null | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

function reconstructLpHolders(transfers: UniswapV2PairTransferRow[]) {
  const balances = new Map<string, bigint>();

  for (const transfer of transfers) {
    const value = normalizeRawAmount(transfer.value);
    if (value === 0n) continue;
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    if (from !== ZERO_ADDRESS) addBalance(balances, from, -value);
    if (to !== ZERO_ADDRESS) addBalance(balances, to, value);
  }

  const rows = Array.from(balances.entries())
    .filter(([, balance]) => balance > 0n)
    .sort(([, left], [, right]) => (left > right ? -1 : left < right ? 1 : 0));
  const totalRaw = rows.reduce((sum, [, balance]) => sum + balance, 0n);
  const totalSupply = toNumberUnit(totalRaw, LP_DECIMALS);

  const holders: MonadV2LpHolder[] = rows.map(([address, balance]) => {
    const balanceNumber = toNumberUnit(balance, LP_DECIMALS);
    const share = totalRaw > 0n ? balanceNumber / totalSupply : 0;
    return {
      address,
      balance: balanceNumber,
      balanceRaw: balance.toString(),
      share,
      sharePct: share * 100,
    };
  });

  const topHolders = holders.slice(0, TOP_HOLDER_LIMIT);
  const othersRaw = holders
    .slice(TOP_HOLDER_LIMIT)
    .reduce((sum, holder) => sum + BigInt(holder.balanceRaw), 0n);
  const othersBalance = toNumberUnit(othersRaw, LP_DECIMALS);
  const othersShare = totalSupply > 0 ? othersBalance / totalSupply : 0;

  return {
    holderCount: holders.length,
    totalSupply,
    totalSupplyRaw: totalRaw.toString(),
    topHolders,
    others:
      othersRaw > 0n
        ? {
            address: "others",
            balance: othersBalance,
            balanceRaw: othersRaw.toString(),
            share: othersShare,
            sharePct: othersShare * 100,
          }
        : null,
  };
}

async function buildDashboardPayload(): Promise<MonadV2DashboardData> {
  const [pool, transfers] = await Promise.all([
    fetchWorldchainPoolById(MONAD_V2_DUST_USDC_POOL_KEY),
    fetchRailwayEntityPaginated<UniswapV2PairTransferRow>(
      "UniswapV2Pair_Transfer",
      { pool: MONAD_V2_DUST_USDC_POOL_KEY },
      MAX_TRANSFER_PAGES
    ),
  ]);

  if (!pool || pool.protocol !== "v2") {
    throw new DashboardNotFoundError("Monad V2 pool not found");
  }

  const usdcReserveRaw = normalizeRawAmount(pool.tvlToken0);
  const dustReserveRaw = normalizeRawAmount(pool.tvlToken1);
  const usdcReserve = toNumberUnit(usdcReserveRaw, USDC_DECIMALS);
  const dustReserve = toNumberUnit(dustReserveRaw, DUST_DECIMALS);
  const currentDustPriceUsd = dustReserve > 0 ? usdcReserve / dustReserve : 0;
  const dustPerUsdc = currentDustPriceUsd > 0 ? 1 / currentDustPriceUsd : 0;
  const tvlUsd = usdcReserve + dustReserve * currentDustPriceUsd;
  const invariantL =
    usdcReserve > 0 && dustReserve > 0 ? Math.sqrt(usdcReserve * dustReserve) : 0;
  const lp = reconstructLpHolders(transfers);
  const partial = transfers.length === MAX_TRANSFER_PAGES * 2000;

  return {
    updatedAt: Date.now(),
    sources: {
      reserveEntity: "Pool",
      lpTransferEntity: "UniswapV2Pair_Transfer",
      transferRows: transfers.length,
      poolUpdatedAt: Number(pool.updatedAt),
    },
    pool: {
      address: MONAD_V2_DUST_USDC_POOL_KEY,
      chainId: 143,
      feeBps: Number(pool.fee),
      protocol: "v2",
      updatedAt: Number(pool.updatedAt),
      token0: {
        symbol: "USDC",
        address: MONAD_V2_USDC_ADDRESS,
        decimals: USDC_DECIMALS,
        reserve: usdcReserve,
        reserveRaw: usdcReserveRaw.toString(),
        priceUsd: 1,
      },
      token1: {
        symbol: "DUST",
        address: MONAD_V2_DUST_ADDRESS,
        decimals: DUST_DECIMALS,
        reserve: dustReserve,
        reserveRaw: dustReserveRaw.toString(),
        priceUsd: currentDustPriceUsd,
        logoUrl: MONAD_V2_DUST_ICON,
      },
      tvlUsd,
      currentDustPriceUsd,
      dustPerUsdc,
      invariantL,
      priceSource: "pool-implied",
    },
    lp: {
      ...lp,
      transferCount: transfers.length,
      partial,
    },
  };
}

export async function GET() {
  try {
    const now = Date.now();
    if (cachedDashboard && now - cachedDashboard.timestamp < DASHBOARD_CACHE_TTL_MS) {
      return NextResponse.json(cachedDashboard.payload, {
        headers: {
          "Cache-Control": DASHBOARD_CACHE_CONTROL,
          "X-Cache": "HIT",
        },
      });
    }

    pendingDashboard ??= buildDashboardPayload().finally(() => {
      pendingDashboard = null;
    });
    const payload = await pendingDashboard;
    cachedDashboard = { timestamp: Date.now(), payload };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": DASHBOARD_CACHE_CONTROL,
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    if (error instanceof DashboardNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (cachedDashboard) {
      return NextResponse.json(cachedDashboard.payload, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          "X-Cache": "STALE",
        },
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[monad-v2-dashboard] failed to build dashboard payload", message);
    return NextResponse.json(
      { error: "Failed to load Monad V2 dashboard", details: message },
      { status: 502 }
    );
  }
}
