import { describe, expect, it } from "vitest";

import { reconstructLiquiditySegments } from "@/lib/lp-rebalances";
import { cellOwnerBreakdown, type DepthBand, type DepthValueParams } from "@/lib/liquidity-depth-bars";
import type { LPEventData } from "@/lib/envio-client";

const DEC = { token0Decimals: 0, token1Decimals: 0 };
const NOW = 1000;

function ev(
  eventType: LPEventData["eventType"],
  ts: number,
  magnitude: number,
  owner = "0xabc",
  tickLower = 0,
  tickUpper = 100,
): LPEventData {
  return {
    id: `${eventType}-${ts}-${owner}`,
    owner,
    eventType,
    timestamp: ts,
    liquidityDelta: String(magnitude),
    amount0: "0",
    amount1: "0",
    tickLower: String(tickLower),
    tickUpper: String(tickUpper),
  };
}

describe("reconstructLiquiditySegments (precise instant-liquidity)", () => {
  it("steps liquidity UP on a top-up (INCREASE)", () => {
    const segs = reconstructLiquiditySegments([ev("MINT", 10, 100), ev("INCREASE", 20, 400)], DEC, NOW);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ L: 100, openedAt: 10, end: 20, closed: false });
    expect(segs[1]).toMatchObject({ L: 500, openedAt: 20, end: NOW, closed: false });
  });

  it("steps liquidity DOWN on a partial trim, then closes (all flagged inactive)", () => {
    const segs = reconstructLiquiditySegments(
      [ev("MINT", 10, 500), ev("DECREASE", 20, 300), ev("BURN", 30, 200)],
      DEC,
      NOW,
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ L: 500, openedAt: 10, end: 20, closed: true });
    expect(segs[1]).toMatchObject({ L: 200, openedAt: 20, end: 30, closed: true });
  });

  it("treats a re-mint of the same range as a distinct lifecycle", () => {
    const segs = reconstructLiquiditySegments(
      [ev("MINT", 10, 100), ev("BURN", 20, 100), ev("MINT", 30, 200)],
      DEC,
      NOW,
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ L: 100, openedAt: 10, end: 20, closed: true });
    expect(segs[1]).toMatchObject({ L: 200, openedAt: 30, end: NOW, closed: false });
  });

  it("emits a single open segment for a held position", () => {
    const segs = reconstructLiquiditySegments([ev("MINT", 10, 100)], DEC, NOW);
    expect(segs).toEqual([
      { owner: "0xabc", tickLower: 0, tickUpper: 100, L: 100, openedAt: 10, end: NOW, closed: false },
    ]);
  });

  it("keeps owners and ranges separate", () => {
    const segs = reconstructLiquiditySegments(
      [ev("MINT", 10, 100, "0xaaa"), ev("MINT", 12, 200, "0xbbb", 0, 200)],
      DEC,
      NOW,
    );
    expect(segs).toHaveLength(2);
    expect(segs.find((s) => s.owner === "0xaaa")).toMatchObject({ L: 100, tickUpper: 100 });
    expect(segs.find((s) => s.owner === "0xbbb")).toMatchObject({ L: 200, tickUpper: 200 });
  });

  it("ignores degenerate ranges and empty input", () => {
    expect(reconstructLiquiditySegments([], DEC, NOW)).toEqual([]);
    const bad = reconstructLiquiditySegments([ev("MINT", 10, 100, "0xabc", 50, 50)], DEC, NOW);
    expect(bad).toEqual([]);
  });
});

describe("cellOwnerBreakdown", () => {
  const params: DepthValueParams = {
    token0Decimals: 0,
    token1Decimals: 0,
    valueIsUsd: false,
    t0Usd: null,
    t1Usd: null,
    fallbackPrice: 1,
  };
  const band: DepthBand = { tickLower: 0, tickUpper: 100, L: 1e12, openedAt: 0, end: NOW, owner: "0xa", closed: false };

  it("attributes a cell's value to the contributing owner", () => {
    const out = cellOwnerBreakdown([band], 50, 0, 100, 50, params);
    expect(out).toHaveLength(1);
    expect(out[0].owner).toBe("0xa");
    expect(out[0].value).toBeGreaterThan(0);
  });

  it("excludes bands not live at the sampled time", () => {
    const future = { ...band, openedAt: 200, end: 300 };
    expect(cellOwnerBreakdown([future], 50, 0, 100, 50, params)).toHaveLength(0);
  });

  it("sorts owners by descending contribution", () => {
    const big: DepthBand = { ...band, owner: "0xbig", L: 5e12 };
    const small: DepthBand = { ...band, owner: "0xsmall", L: 1e11 };
    const out = cellOwnerBreakdown([small, big], 50, 0, 100, 50, params);
    expect(out.map((o) => o.owner)).toEqual(["0xbig", "0xsmall"]);
  });
});
