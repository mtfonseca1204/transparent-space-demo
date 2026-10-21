import { NextRequest, NextResponse } from "next/server";
import { isSolanaPool, normalizePoolKeyInput } from "@/lib/pools";
import { fetchSolanaApi } from "@/lib/solana-indexer-client";
import { getDemoLpSummary, isDemoRequest, resolveDemoPoolKey } from "@/lib/demo/fixtures";

export async function GET(request: NextRequest) {
  const poolRaw = request.nextUrl.searchParams.get("pool")?.trim() ?? "";
  const pool = normalizePoolKeyInput(poolRaw);
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 200;

  if (isDemoRequest(request, pool)) {
    const demoLimit = Number.isFinite(limit) && limit >= 1 ? limit : 200;
    return NextResponse.json(getDemoLpSummary(resolveDemoPoolKey(pool), demoLimit), {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Source": "demo-fixture",
      },
    });
  }

  if (!pool || !isSolanaPool(pool)) {
    return NextResponse.json(
      { error: "Missing or invalid Solana pool" },
      { status: 400 }
    );
  }

  if (!Number.isFinite(limit) || limit < 1) {
    return NextResponse.json(
      { error: "Invalid limit" },
      { status: 400 }
    );
  }

  try {
    const payload = await fetchSolanaApi<{ data?: unknown[] }>("/api/lp/summary", {
      pool,
      limit,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("[api/lp/summary] Failed to fetch Solana LP summary", {
      pool,
      limit,
      error,
    });
    return NextResponse.json(
      { error: "Failed to fetch LP summary" },
      { status: 502 }
    );
  }
}
