import { NextRequest, NextResponse } from "next/server";
import { fetchSolanaApi } from "@/lib/solana-indexer-client";
import { getSupportedPool, inferPoolProtocol, normalizePoolKeyInput } from "@/lib/pools";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import {
  normalizeLiquidityDepthPayload,
  supportsHistoricalLiquidityDepth,
  type LiquidityDepthPayload,
} from "@/lib/liquidity-depth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ZEROG_INDEXER_BASE =
  process.env.ZEROG_INDEXER_API_URL ??
  "https://indexer-zerog-api-production.up.railway.app";

function boundedInt(raw: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function fetchEvmLiquidityDepth(
  baseUrl: string,
  params: Record<string, string | number>,
): Promise<LiquidityDepthPayload> {
  const url = new URL("/api/charts/liquidity-depth", baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`EVM liquidity depth returned ${res.status}`);
  }
  return res.json() as Promise<LiquidityDepthPayload>;
}

export async function GET(request: NextRequest) {
  const poolRaw = request.nextUrl.searchParams.get("pool")?.trim() ?? "";
  const pool = normalizePoolKeyInput(poolRaw);
  const spaceSlug = request.nextUrl.searchParams.get("space")?.trim() ?? null;

  if (!pool || isDemoSpaceSlug(spaceSlug) || !supportsHistoricalLiquidityDepth(pool)) {
    return NextResponse.json(
      { error: "Historical liquidity depth is supported only for materialized Raydium CLMM and allowlisted 0G V3 pools" },
      { status: 422 }
    );
  }

  const windowDays = boundedInt(request.nextUrl.searchParams.get("window_days"), 1, 30, 7);
  const priceBins = boundedInt(request.nextUrl.searchParams.get("price_bins"), 24, 180, 96);
  const resolutionRaw = request.nextUrl.searchParams.get("resolution")?.trim().toLowerCase() ?? "1h";
  const resolution = ["1h", "4h", "1d"].includes(resolutionRaw) ? resolutionRaw : "1h";
  const supportedPool = getSupportedPool(pool);
  const chainId = supportedPool?.chainId;
  const protocol = inferPoolProtocol(pool);

  try {
    const commonParams = {
      pool,
      window_days: windowDays,
      resolution,
      price_bins: priceBins,
    };
    const payload = protocol === "raydium"
      ? await fetchSolanaApi<LiquidityDepthPayload>("/api/charts/liquidity-depth", commonParams, {
        revalidate: 0,
      })
      : await fetchEvmLiquidityDepth(ZEROG_INDEXER_BASE, {
        ...commonParams,
        chain_id: chainId ?? 16661,
      });
    const normalized = normalizeLiquidityDepthPayload(payload);
    if (!normalized) {
      return NextResponse.json(
        { error: "Liquidity depth payload was empty or malformed" },
        { status: 502 }
      );
    }

    return NextResponse.json(normalized, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[api/liquidity-depth] Failed to fetch liquidity depth", {
      pool,
      windowDays,
      resolution,
      priceBins,
      error,
    });
    return NextResponse.json(
      { error: "Failed to fetch liquidity depth" },
      { status: 502 }
    );
  }
}
