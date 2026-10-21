import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const MARKETING_HOSTS = new Set(["transparent.space", "www.transparent.space"]);
const XSTOCKS_HOSTS = new Set(["xstocks.transparent.space"]);

export function middleware(req: NextRequest) {
  const hostHeader = req.headers.get("host") ?? "";
  const host = hostHeader.split(":")[0].toLowerCase();
  const { pathname } = req.nextUrl;

  // Let static / internal assets through so they load on all other domains.
  const isAssetPath =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/Logo.svg" ||
    pathname === "/og-image.svg" ||
    pathname === "/site.webmanifest";

  // Marketing / landing-page hosts → rewrite everything to /landing.
  const isMarketingHost = MARKETING_HOSTS.has(host);
  const isXstocksHost = XSTOCKS_HOSTS.has(host);
  if (isXstocksHost) {
    if (isAssetPath || pathname.startsWith("/xstocks")) {
      return NextResponse.next();
    }

    const url = req.nextUrl.clone();
    url.pathname = "/xstocks";
    return NextResponse.rewrite(url);
  }

  if (!isMarketingHost) {
    return NextResponse.next();
  }

  // Keep landing route and its static assets accessible.
  if (isAssetPath || pathname.startsWith("/landing")) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/landing";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/:path*"],
};
