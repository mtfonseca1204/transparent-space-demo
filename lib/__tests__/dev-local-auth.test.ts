import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  DEV_LOCAL_AUTH_EMAIL,
  DEV_LOCAL_AUTH_PASSWORD,
  getDevLocalAuthAccess,
  isDevLocalAuthEnabled,
  verifyDevLocalPassword,
} from "@/lib/dev-local-auth";

describe("dev-local-auth", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOCAL_AUTH", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables local auth only in development with DEV_LOCAL_AUTH=true", () => {
    expect(isDevLocalAuthEnabled()).toBe(true);
    vi.stubEnv("DEV_LOCAL_AUTH", "false");
    expect(isDevLocalAuthEnabled()).toBe(false);
  });

  it("allows presentation deploys when PRESENTATION_DEMO_AUTH is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_LOCAL_AUTH", "true");
    vi.stubEnv("PRESENTATION_DEMO_AUTH", "true");
    expect(isDevLocalAuthEnabled()).toBe(true);

    vi.stubEnv("PRESENTATION_DEMO_AUTH", "false");
    expect(isDevLocalAuthEnabled()).toBe(false);
  });

  it("returns demo-only access for the seeded dev email", () => {
    const access = getDevLocalAuthAccess(DEV_LOCAL_AUTH_EMAIL);
    expect(access?.spaces).toHaveLength(1);
    expect(access?.spaces[0]?.slug).toBe("demo");
  });

  it("verifies the seeded local password", () => {
    expect(
      verifyDevLocalPassword(DEV_LOCAL_AUTH_EMAIL, DEV_LOCAL_AUTH_PASSWORD),
    ).toBe(true);
    expect(verifyDevLocalPassword(DEV_LOCAL_AUTH_EMAIL, "wrong")).toBe(false);
  });
});
