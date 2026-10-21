import { describe, expect, it } from "vitest";

import { getPoolProtocolName } from "@/lib/pool-protocol-labels";

describe("pool protocol labels", () => {
  it("labels BSC Pancake V3 pools separately from Pancake Infinity", () => {
    expect(
      getPoolProtocolName({
        key: "pancake-v3-0g-usdt",
        protocol: "v3",
        chain: "evm",
        chainId: 56,
        spaceSlug: "0g-ai",
      }),
    ).toBe("PANCAKESWAP V3");
  });

  it("keeps BSC Pancake Infinity CL pools labeled as Pancake Infinity", () => {
    expect(
      getPoolProtocolName({
        key: "pancake-infinity-prl-usdt",
        protocol: "v4",
        chain: "evm",
        chainId: 56,
        spaceSlug: "perle",
      }),
    ).toBe("PANCAKE INFINITY");
  });
});
