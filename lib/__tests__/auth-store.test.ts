import { afterEach, describe, expect, it, vi } from "vitest";

import type { Space } from "@/lib/auth-store";

const storage = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => storage.get(key) || null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

vi.stubGlobal("localStorage", localStorageMock);

const { useAuthStore } = await import("@/lib/auth-store");

const KRAKEN_SPACE: Space = {
  id: "kraken-id",
  name: "Kraken",
  slug: "kraken",
};

const SOLANA_FOUNDATION_SPACE: Space = {
  id: "solana-foundation-id",
  name: "Solana Foundation",
  slug: "solana-foundation",
};

const resetAuthStore = () => {
  useAuthStore.setState({
    isAuthenticated: false,
    email: null,
    role: null,
    spaces: [],
    currentSpaceId: null,
    isLoading: false,
    error: null,
    sessionChecked: false,
    needsSpaceSelection: false,
    mustChangePassword: false,
    _tempPassword: null,
  });
};

describe("auth store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthStore();
    storage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("refreshes persisted space selection state from the server session", async () => {
    useAuthStore.setState({
      email: "dev@transparent.space",
      role: "admin",
      spaces: [KRAKEN_SPACE],
      needsSpaceSelection: true,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        role: "admin",
        spaces: [KRAKEN_SPACE, SOLANA_FOUNDATION_SPACE],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(useAuthStore.getState().refreshSpaces()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      { cache: "no-store" },
    );
    expect(useAuthStore.getState().spaces.map((space) => space.slug)).toEqual([
      "kraken",
      "solana-foundation",
    ]);
  });
});
