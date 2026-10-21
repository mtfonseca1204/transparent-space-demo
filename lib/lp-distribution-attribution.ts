export interface NormalizedSelectedLpAttribution {
  selectedValue: number;
  otherValue: number;
  totalValue: number;
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeSelectedLpAttribution(args: {
  selectedRawValue: number;
  allRawValue: number;
  fallbackTotalValue: number;
}): NormalizedSelectedLpAttribution {
  const selectedRawValue = positiveFinite(args.selectedRawValue);
  const allRawValue = positiveFinite(args.allRawValue);
  const fallbackTotalValue = positiveFinite(args.fallbackTotalValue);

  if (allRawValue > 0) {
    const selectedValue = Math.min(selectedRawValue, allRawValue);
    return {
      selectedValue,
      otherValue: Math.max(0, allRawValue - selectedValue),
      totalValue: allRawValue,
    };
  }

  if (fallbackTotalValue <= 0) {
    return { selectedValue: 0, otherValue: 0, totalValue: 0 };
  }

  return {
    selectedValue: 0,
    otherValue: fallbackTotalValue,
    totalValue: fallbackTotalValue,
  };
}
