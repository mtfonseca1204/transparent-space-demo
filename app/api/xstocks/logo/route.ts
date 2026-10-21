// Same-origin proxy for Backed's xStocks token logos. Upstream
// `xstocks-metadata.backed.fi` returns no Access-Control-Allow-Origin,
// so a direct cross-origin <img crossOrigin="anonymous"> fails to load
// in the Weekend Movers builder and taints the canvas on PNG export.

import { NextRequest, NextResponse } from "next/server";

export const revalidate = 86400;

const UPSTREAM_BASE = "https://xstocks-metadata.backed.fi/logos/tokens";
const TICKER_RE = /^[A-Za-z0-9.]{1,10}x$/;

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("t") ?? "";
  if (!TICKER_RE.test(ticker)) {
    return new NextResponse("invalid ticker", { status: 400 });
  }

  const upstream = `${UPSTREAM_BASE}/${ticker}.png`;
  let res: Response;
  try {
    res = await fetch(upstream, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new NextResponse("upstream fetch failed", { status: 502 });
  }

  if (!res.ok) {
    return new NextResponse(`upstream ${res.status}`, { status: res.status });
  }

  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
    },
  });
}
