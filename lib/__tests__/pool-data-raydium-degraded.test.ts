import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const POOL = "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV";
const START_TIME = 1_778_612_400;
const END_TIME = 1_781_204_400;

function request(path: string): NextRequest {
  return new NextRequest(`https://app.transparent.space${path}`);
}

async function loadPoolDataRoute(fetchAllSolanaPages: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock("@/lib/solana-indexer-client", () => ({
    fetchAllSolanaPages,
    fetchSolanaApi: vi.fn().mockResolvedValue({ series: [] }),
  }));
  return import("@/app/api/pool-data/route");
}

function poolDataPath() {
  return `/api/pool-data?pool=${POOL}&startTime=${START_TIME}&endTime=${END_TIME}&include=hours`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/solana-indexer-client");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("Raydium pool-data degraded hourly candles", () => {
  it("returns a degraded error instead of a successful empty hours payload", async () => {
    const fetchAllSolanaPages = vi.fn().mockRejectedValue(new Error("503 BUSY"));
    const { GET } = await loadPoolDataRoute(fetchAllSolanaPages);

    const response = await GET(request(poolDataPath()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("X-Cache")).toBe("DEGRADED");
    expect(response.headers.get("X-Partial-Data")).toBe("1");
    expect(body.error).toBe("Raydium hourly candle data unavailable");
    expect(body.detail).toContain("503 BUSY");
  });

  it("serves stale good data when hourly candles are temporarily unavailable", async () => {
    vi.useFakeTimers({ now: new Date("2026-06-11T19:00:00Z") });

    const candle = {
      open_time: "2026-06-11T18:00:00.000Z",
      price_open: "82.1",
      price_high: "83.0",
      price_low: "81.9",
      price_close: "82.5",
      volume_token0: "123000000",
      volume_token1: "456000000",
      swap_count: 7,
    };
    const fetchAllSolanaPages = vi.fn()
      .mockResolvedValueOnce([candle])
      .mockRejectedValueOnce(new Error("503 BUSY"));
    const { GET } = await loadPoolDataRoute(fetchAllSolanaPages);

    const first = await GET(request(poolDataPath()));
    const firstBody = await first.json();

    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    expect(firstBody.poolHourDatas).toHaveLength(1);

    vi.setSystemTime(new Date("2026-06-11T19:02:00Z"));

    const second = await GET(request(poolDataPath()));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("STALE");
    expect(second.headers.get("X-Partial-Data")).toBe("1");
    expect(secondBody.poolHourDatas).toHaveLength(1);
    expect(secondBody.poolHourDatas[0].txCount).toBe(7);
    expect(fetchAllSolanaPages).toHaveBeenCalledTimes(2);
  });
});
