import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionPayload,
  createSignedSessionToken,
  verifySignedSessionToken,
} from "@/lib/auth-cookie";

describe("auth cookie signing", () => {
  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET = "test-session-secret";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AUTH_SESSION_SECRET;
  });

  it("accepts an untampered auth session token", () => {
    const token = createSignedSessionToken(
      createSessionPayload("USER@Transparent.Space", "admin", "auth"),
    );

    expect(verifySignedSessionToken(token, "auth")).toMatchObject({
      email: "user@transparent.space",
      role: "admin",
      kind: "auth",
    });
  });

  it("rejects tampered session bodies", () => {
    const token = createSignedSessionToken(
      createSessionPayload("user@transparent.space", "member", "auth"),
    );
    const [body, signature] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({
        kind: "auth",
        email: "attacker@transparent.space",
        role: "admin",
        iat: 1,
        exp: 9999999999,
      }),
    ).toString("base64url");

    expect(verifySignedSessionToken(`${tamperedBody}.${signature}`, "auth")).toBeNull();
    expect(verifySignedSessionToken(`${body}.bad-signature`, "auth")).toBeNull();
  });

  it("rejects expired sessions", () => {
    vi.setSystemTime(new Date("2026-04-29T12:00:00Z"));
    const token = createSignedSessionToken({
      kind: "auth",
      email: "user@transparent.space",
      role: "member",
      iat: Math.floor(Date.now() / 1000) - 120,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    expect(verifySignedSessionToken(token, "auth")).toBeNull();
  });
});
