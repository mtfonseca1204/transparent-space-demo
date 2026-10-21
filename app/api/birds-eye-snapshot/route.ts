import { NextRequest, NextResponse } from "next/server";
import type { PoolData } from "@/app/api/pool/[address]/route";
import type { PositionData } from "@/lib/envio-client";
import { getPoolsForSpace, type SupportedPool } from "@/lib/pools";
import { getDemoBirdsEyeSnapshot } from "@/lib/demo/fixtures";
import { DEMO_SPACE_SLUG } from "@/lib/demo/constants";

type OwnerPositions = {
  owner: string;
  positions: PositionData[];
  liquidityTotal: string;
};

type SnapshotPool = {
  pool: SupportedPool;
  poolData: PoolData | null;
  positionsByOwner: OwnerPositions[];
  partial: boolean;
};

type SnapshotResponse = {
  spaceSlug: string;
  generatedAt: number;
  pools: SnapshotPool[];
  partial: boolean;
};

type CachedSnapshot = {
  timestamp: number;
  data: SnapshotResponse;
};

const cache = new Map<string, CachedSnapshot>();
const inflightRefreshes = new Map<string, Promise<SnapshotResponse>>();
const CACHE_TTL_MS = 60_000;
const CACHE_STALE_TTL_MS = 5 * 60_000;
const CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";
const POSITION_PAGE_LIMIT = 5000;
const POSITION_MAX_PAGES = 5;
const FETCH_CONCURRENCY = 6;

function groupPositionsByOwner(positions: PositionData[]): OwnerPositions[] {
  const byOwner = new Map<
    string,
    {
      positions: PositionData[];
      liquidityTotal: bigint;
    }
  >();

  for (const pos of positions) {
    const owner = pos.owner?.trim();
    if (!owner) continue;
    const liq = BigInt(pos.liquidity ?? "0");
    if (liq <= 0n) continue;
    const existing = byOwner.get(owner);
    if (existing) {
      existing.positions.push(pos);
      existing.liquidityTotal += liq;
    } else {
      byOwner.set(owner, {
        positions: [pos],
        liquidityTotal: liq,
      });
    }
  }

  return [...byOwner.entries()]
    .map(([owner, data]) => ({
      owner,
      positions: data.positions.sort((a, b) => {
        const la = BigInt(a.liquidity ?? "0");
        const lb = BigInt(b.liquidity ?? "0");
        return la > lb ? -1 : la < lb ? 1 : 0;
      }),
      liquidityTotal: data.liquidityTotal.toString(),
    }))
    .sort((a, b) => {
      const la = BigInt(a.liquidityTotal);
      const lb = BigInt(b.liquidityTotal);
      return la > lb ? -1 : la < lb ? 1 : 0;
    });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }).map(
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) break;
        results[index] = await worker(items[index]!);
      }
    }
  );

  await Promise.all(runners);
  return results;
}

async function fetchPoolSnapshot(
  origin: string,
  pool: SupportedPool
): Promise<SnapshotPool> {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - 7 * 24 * 3600;
  const poolUrl = new URL(`/api/pool/${pool.poolKey}`, origin);
  const positionsUrl = new URL(`/api/pool-data`, origin);
  positionsUrl.searchParams.set("pool", pool.poolKey);
  positionsUrl.searchParams.set("startTime", String(startTime));
  positionsUrl.searchParams.set("endTime", String(now));
  positionsUrl.searchParams.set("include", "positions");
  positionsUrl.searchParams.set(
    "positionsPageLimit",
    String(POSITION_PAGE_LIMIT)
  );
  positionsUrl.searchParams.set("positionsMaxPages", String(POSITION_MAX_PAGES));

  const [poolResult, positionsResult] = await Promise.allSettled([
    fetch(poolUrl.toString(), { next: { revalidate: 30 } }),
    fetch(positionsUrl.toString(), { next: { revalidate: 30 } }),
  ]);

  let partial = false;

  let poolData: PoolData | null = null;
  if (poolResult.status === "fulfilled" && poolResult.value.ok) {
    poolData = (await poolResult.value.json()) as PoolData;
  } else {
    partial = true;
  }

  let positionsByOwner: OwnerPositions[] = [];
  if (positionsResult.status === "fulfilled" && positionsResult.value.ok) {
    const payload = (await positionsResult.value.json()) as {
      positions?: PositionData[];
    };
    positionsByOwner = groupPositionsByOwner(payload.positions ?? []);
  } else {
    partial = true;
  }

  return {
    pool,
    poolData,
    positionsByOwner,
    partial,
  };
}

function jsonSnapshot(
  data: SnapshotResponse,
  cacheState: "HIT" | "MISS" | "STALE" | "COALESCED"
) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "X-Cache": cacheState,
      "X-Partial-Data": data.partial ? "1" : "0",
    },
  });
}

async function buildSnapshot(
  origin: string,
  spaceSlug: string,
  pools: SupportedPool[]
): Promise<SnapshotResponse> {
  const snapshots = await mapWithConcurrency(
    pools,
    FETCH_CONCURRENCY,
    async (pool) => fetchPoolSnapshot(origin, pool)
  );
  const partial = snapshots.some((s) => s.partial);
  return {
    spaceSlug,
    generatedAt: Date.now(),
    pools: snapshots,
    partial,
  };
}

function refreshSnapshot(
  cacheKey: string,
  origin: string,
  spaceSlug: string,
  pools: SupportedPool[]
): Promise<SnapshotResponse> {
  const existing = inflightRefreshes.get(cacheKey);
  if (existing) return existing;

  const refresh = buildSnapshot(origin, spaceSlug, pools)
    .then((data) => {
      cache.set(cacheKey, {
        timestamp: Date.now(),
        data,
      });
      return data;
    })
    .finally(() => {
      inflightRefreshes.delete(cacheKey);
    });

  refresh.catch(() => {});
  inflightRefreshes.set(cacheKey, refresh);
  return refresh;
}

export async function GET(request: NextRequest) {
  const spaceSlug = request.nextUrl.searchParams.get("space")?.trim() ?? "";
  if (!spaceSlug) {
    return NextResponse.json(
      { error: "Missing required query parameter: space" },
      { status: 400 }
    );
  }

  if (spaceSlug === DEMO_SPACE_SLUG) {
    return NextResponse.json(getDemoBirdsEyeSnapshot(), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "X-Cache": "MISS",
        "X-Source": "demo-fixture",
        "X-Partial-Data": "0",
      },
    });
  }

  const pools = getPoolsForSpace(spaceSlug);
  if (pools.length === 0) {
    return NextResponse.json(
      { error: `No pools configured for space ${spaceSlug}` },
      { status: 404 }
    );
  }

  const cacheKey = `${spaceSlug}-pl${POSITION_PAGE_LIMIT}-pm${POSITION_MAX_PAGES}`;
  const cached = cache.get(cacheKey);
  const ageMs = cached ? Date.now() - cached.timestamp : Number.POSITIVE_INFINITY;
  if (cached && ageMs < CACHE_TTL_MS) {
    return jsonSnapshot(cached.data, "HIT");
  }

  if (cached && ageMs < CACHE_STALE_TTL_MS) {
    void refreshSnapshot(cacheKey, request.nextUrl.origin, spaceSlug, pools);
    return jsonSnapshot(cached.data, "STALE");
  }

  const hadInflight = inflightRefreshes.has(cacheKey);
  const data = await refreshSnapshot(
    cacheKey,
    request.nextUrl.origin,
    spaceSlug,
    pools
  );

  return jsonSnapshot(data, hadInflight ? "COALESCED" : "MISS");
}
