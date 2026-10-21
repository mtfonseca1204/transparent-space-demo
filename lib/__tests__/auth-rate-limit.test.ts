import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkAuthRateLimit, resetAuthRateLimit } from "@/lib/auth-rate-limit";

function requestFromIp(ip: string) {
  return new NextRequest("https://app.transparent.space/api/auth/verify", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("auth rate limit", () => {
  it("blocks the ninth attempt for the same ip and email", () => {
    const request = requestFromIp("203.0.113.10");
    const email = "limit-test@transparent.space";

    for (let i = 0; i < 8; i += 1) {
      expect(checkAuthRateLimit(request, email).allowed).toBe(true);
    }

    expect(checkAuthRateLimit(request, email)).toMatchObject({
      allowed: false,
    });

    resetAuthRateLimit(request, email);
    expect(checkAuthRateLimit(request, email).allowed).toBe(true);
  });
});
