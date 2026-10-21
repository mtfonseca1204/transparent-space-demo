import type { NextRequest } from "next/server";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getRateLimitKey(request: NextRequest, email: string) {
  return `${getClientIp(request)}:${email.trim().toLowerCase()}`;
}

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function checkAuthRateLimit(request: NextRequest, email: string) {
  const now = Date.now();
  pruneExpired(now);

  const key = getRateLimitKey(request, email);
  const bucket = buckets.get(key) || {
    count: 0,
    resetAt: now + WINDOW_MS,
  };

  if (bucket.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}

export function resetAuthRateLimit(request: NextRequest, email: string) {
  buckets.delete(getRateLimitKey(request, email));
}
