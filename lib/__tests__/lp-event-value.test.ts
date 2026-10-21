import { describe, expect, it } from "vitest";
import { calculateLPEventUsdValue } from "@/lib/lp-event-value";
import type { LPEventData } from "@/lib/envio-client";

const baseEvent: LPEventData = {
  id: "event-1",
  owner: "0x0000000000000000000000000000000000000001",
  eventType: "MINT",
  timestamp: 1777479419,
  liquidityDelta: "0",
  amount0: "0",
  amount1: "0",
  tickLower: "-308200",
  tickUpper: "-308000",
};

describe("calculateLPEventUsdValue", () => {
  it("values Gensyn v4 liquidity-only events from liquidity and tick range", () => {
    const value = calculateLPEventUsdValue({
      event: {
        ...baseEvent,
        liquidityDelta: "1031945494757071912960",
        amount0: "1031945494757071912960",
      },
      poolKey: "1-v4-0x88ff197d8fe8a68722f59c93eef447a4b54ebe8543bf0392246448a04956915a",
      token0Decimals: 18,
      token1Decimals: 6,
      token0UsdPrice: 0.03704853615299433,
      token1UsdPrice: 1,
      sqrtPriceX96: "15249833788585923818719",
    });

    expect(value).toBeGreaterThan(1_800_000);
    expect(value).toBeLessThan(1_900_000);
  });

  it("keeps using raw token amounts for v3-style events", () => {
    const value = calculateLPEventUsdValue({
      event: {
        ...baseEvent,
        liquidityDelta: "999",
        amount0: "1000000000000000000",
        amount1: "2000000",
      },
      poolKey: "0x3198ca64ebff6d008860f2c450cfcbf1faac7677",
      token0Decimals: 18,
      token1Decimals: 6,
      token0UsdPrice: 10,
      token1UsdPrice: 1,
      sqrtPriceX96: "15249833788585923818719",
    });

    expect(value).toBe(12);
  });
});
