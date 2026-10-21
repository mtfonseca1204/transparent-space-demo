import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy for Railway EVM indexer REST APIs.
 * Forwards entity queries from the browser to the Railway backend,
 * avoiding CORS issues.
 *
 * Usage: GET /api/worldchain-entities?entity=TickLiquidity&space=katana&pool=0x...&limit=10000
 */

const WORLDCHAIN_INDEXER_BASE =
  process.env.WORLDCHAIN_INDEXER_API_URL ??
  "https://indexer-worldchain-production.up.railway.app";
const GENSYN_INDEXER_BASE =
  process.env.GENSYN_INDEXER_API_URL ??
  "https://indexer-gensyn-api-production.up.railway.app";
const BSC_INDEXER_BASE =
  process.env.BSC_INDEXER_API_URL ??
  process.env.PERLE_BSC_INDEXER_API_URL ??
  "https://indexer-bsc-api-production.up.railway.app";
const KATANA_INDEXER_BASE =
  process.env.KATANA_INDEXER_API_URL ??
  "https://indexer-katana-api-production.up.railway.app";
const MONAD_INDEXER_BASE =
  process.env.MONAD_INDEXER_API_URL ??
  "https://indexer-monad-api-production.up.railway.app";
const ZEROG_INDEXER_BASE =
  process.env.ZEROG_INDEXER_API_URL ??
  "https://indexer-zerog-api-production.up.railway.app";

function getIndexerBase(space: string | null): string {
  if (space === "bsc") return BSC_INDEXER_BASE;
  if (space === "katana") return KATANA_INDEXER_BASE;
  if (space === "monad") return MONAD_INDEXER_BASE;
  if (space === "zerog") return ZEROG_INDEXER_BASE;
  return space === "gensyn" ? GENSYN_INDEXER_BASE : WORLDCHAIN_INDEXER_BASE;
}

function getCacheControl(entity: string): string {
  const normalized = entity.toLowerCase();
  if (
    normalized === "poolcandle" ||
    normalized === "pooldaydata" ||
    normalized === "pooldailyvolumebysize"
  ) {
    return "public, s-maxage=300, stale-while-revalidate=900";
  }
  return "public, s-maxage=60, stale-while-revalidate=120";
}

export async function GET(request: NextRequest) {
  const entity = request.nextUrl.searchParams.get("entity");
  if (!entity) {
    return NextResponse.json({ error: "Missing entity param" }, { status: 400 });
  }

  // Forward all query params except local proxy controls to the Railway endpoint
  const url = new URL(
    `/api/entities/${encodeURIComponent(entity)}`,
    getIndexerBase(request.nextUrl.searchParams.get("space")),
  );
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === "entity" || key === "space") continue;
    url.searchParams.set(key, value);
  }

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Railway indexer returned ${res.status}` },
        { status: res.status },
      );
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": getCacheControl(entity),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[worldchain-entities] proxy error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
