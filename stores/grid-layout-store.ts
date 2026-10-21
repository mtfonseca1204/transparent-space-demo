"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Layout } from "react-grid-layout";

// Default layout for dashboard cards - 12 column grid
// Row height is 10px, so h: 12 = 120px, h: 22 = 220px, etc.
export const DEFAULT_LAYOUT: Layout = [
  // Top row - Pool header and metrics (~120px)
  { i: "pool-header", x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 8 },
  { i: "metric-token0", x: 3, y: 0, w: 3, h: 12, minW: 2, minH: 8 },
  { i: "metric-token1", x: 6, y: 0, w: 3, h: 12, minW: 2, minH: 8 },
  { i: "metric-price", x: 9, y: 0, w: 3, h: 12, minW: 2, minH: 8 },
  
  // Second row - Main charts (~220px each)
  { i: "price-chart", x: 0, y: 14, w: 6, h: 22, minW: 3, minH: 15 },
  { i: "liquidity-distribution", x: 6, y: 14, w: 6, h: 22, minW: 3, minH: 15 },
  { i: "price-impact", x: 0, y: 38, w: 6, h: 22, minW: 3, minH: 15 },
  { i: "lp-concentration", x: 6, y: 38, w: 6, h: 22, minW: 3, minH: 15 },
  
  // Third row - Pool analytics and LP Activity (~240px)
  { i: "pool-analytics", x: 0, y: 62, w: 6, h: 24, minW: 4, minH: 15 },
  { i: "lp-activity-chart", x: 6, y: 62, w: 6, h: 24, minW: 4, minH: 15 },
  
  // Fourth row - Capital efficiency, Current LPs (~280px)
  { i: "capital-efficiency", x: 0, y: 88, w: 8, h: 28, minW: 5, minH: 18 },
  { i: "current-lps", x: 8, y: 88, w: 4, h: 28, minW: 3, minH: 15 },
  
  // Fifth row - Arbitrage indicator, Oracle comparison (~300px)
  { i: "arbitrage-indicator", x: 0, y: 118, w: 6, h: 30, minW: 3, minH: 18 },
  { i: "oracle-comparison", x: 6, y: 118, w: 6, h: 30, minW: 3, minH: 18 },
  
  // Sixth row - LP Historical Activity (full width, ~700px)
  { i: "lp-historical", x: 0, y: 150, w: 12, h: 70, minW: 8, minH: 40 },
];

interface GridLayoutState {
  layout: Layout;
  layoutLocked: boolean;
  setLayout: (layout: Layout) => void;
  resetLayout: () => void;
  toggleLayoutLock: () => void;
  setLayoutLocked: (locked: boolean) => void;
}

// Layout version - increment this to force a reset when layout changes
const LAYOUT_VERSION = 6;

export const useGridLayoutStore = create<GridLayoutState>()(
  persist(
    (set) => ({
      layout: DEFAULT_LAYOUT,
      layoutLocked: false,
      setLayout: (layout) => set({ layout }),
      resetLayout: () => set({ layout: DEFAULT_LAYOUT }),
      toggleLayoutLock: () => set((state) => ({ layoutLocked: !state.layoutLocked })),
      setLayoutLocked: (locked) => set({ layoutLocked: locked }),
    }),
    {
      name: "dashboard-grid-layout-v2",
      version: LAYOUT_VERSION,
    }
  )
);

