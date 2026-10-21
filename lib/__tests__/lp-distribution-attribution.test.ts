import { describe, expect, it } from "vitest";

import { normalizeSelectedLpAttribution } from "@/lib/lp-distribution-attribution";

describe("LP distribution attribution normalization", () => {
  it("keeps Other LPs nonzero when selected raw position value exceeds the fallback tick total", () => {
    const result = normalizeSelectedLpAttribution({
      selectedRawValue: 4_000,
      allRawValue: 10_000,
      fallbackTotalValue: 1_000,
    });

    expect(result.selectedValue).toBe(4_000);
    expect(result.otherValue).toBe(6_000);
    expect(result.totalValue).toBe(10_000);
  });

  it("does not create selected ownership when attribution rows are empty", () => {
    const result = normalizeSelectedLpAttribution({
      selectedRawValue: 0,
      allRawValue: 0,
      fallbackTotalValue: 1_000,
    });

    expect(result.selectedValue).toBe(0);
    expect(result.otherValue).toBe(1_000);
    expect(result.totalValue).toBe(1_000);
  });
});
