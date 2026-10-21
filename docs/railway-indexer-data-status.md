# Railway Worldchain Indexer — Data Completeness Report

**Last updated:** 2026-02-16

## Overview

The Railway Worldchain indexer (`indexer-worldchain-production.up.railway.app`) is the sole data source for 5 Uniswap V3 pools on Worldchain. If Railway is missing data, there is no legacy GraphQL fallback.

### Tracked Pools

| Pool | Address |
|------|---------|
| WLD / WETH | `0x494d68e3cab640fa50f4c1b3e2499698d1a173a0` |
| WBTC / USDC | `0xdce053d9ba0fa2c5f772416b64f191158cbcc32e` |
| WBTC / WETH | `0x7c3c2a92598d6d77e57fd55c50e99af4b291f595` |
| WLD / WBTC | `0x1a4abfe77b9aec6259757805bd0d3c46fca6d494` |
| WETH / USDC | `0x5f835420502a7702de50cd0e78d8aa3608b2137e` |

## Entity Status (as of 2026-02-16)

### Current (healthy)

These entities are up-to-date across all 5 pools:

| Entity | Freshness | Used For |
|--------|-----------|----------|
| `UniswapV3Pool_Swap` | Minutes | Swap data, per-swap impact bands |
| `PoolCandle` | Minutes | Price OHLC charts |
| `PoolHourData` | ~1 hour | Hourly volume, fees, TVL metrics |
| `UniswapV3Pool_Mint` | Hours/days | Mint events, impact band rollback fallback |
| `UniswapV3Pool_Burn` | Hours/days | Burn events, impact band rollback fallback |
| `TickLiquidity` | Hours | Liquidity distribution (fallback), depth calculations, price impact |

### Broken (~215 days behind)

These two entities are stuck at **July 15-16, 2025** across all 5 pools:

| Entity | Latest Data | Gap | Used For |
|--------|-------------|-----|----------|
| `LPEvent` | 2025-07-16 | **~215 days** | LP entry/exit charts, impact band calculations |
| `Position` | 2025-07-16 | **~215 days** | Liquidity distribution (preferred path), LP concentration, position-based depth/slippage |

## Impact on Dashboard

### Liquidity Distribution Chart

The `useLiquidityDistribution` hook has two calculation paths:

1. **Position-based** (preferred) — uses `Position` entity via `fetchRailwayPositions()`
2. **Tick-based** (fallback) — uses `TickLiquidity` entity via `fetchRailwayTickLiquidity()`

Since stale `Position` data exists (109 active positions for WLD/WETH), the chart takes the **preferred path** and renders a **215-day-old liquidity snapshot**. It never falls through to the current `TickLiquidity` data.

**Result:** The distribution chart shows positions from July 2025 — positions that have since been closed, moved, or added are invisible. The tick ranges shown may not correspond to the current price.

**File:** `hooks/use-liquidity-distribution.ts` line 188

### LP Concentration

Uses `useAllPoolPositions()` → `fetchRailwayPositions()` → `Position` entity.

**Result:** Shows LP ownership breakdown from July 2025. New LPs are invisible, closed positions still appear.

### LP Entry/Exit Charts

Uses `LPEvent` entity for mint/burn event tracking.

**Result:** No entry/exit data after July 2025.

### Impact Band Calculations

The code in `useLPHistoricalData` (line ~799) has a fallback: when `LPEvent` is empty, it uses `UniswapV3Pool_Mint` and `UniswapV3Pool_Burn` instead. Since `LPEvent` is not empty (just stale), the fallback doesn't trigger for recent time windows — the mint/burn data gets used only when `LPEvent` returns 0 results for the queried time range.

### Charts That ARE Accurate

- Price chart (uses `PoolCandle`)
- Volume/fees metrics (uses `PoolHourData`)
- Depth panel in price chart (uses `TickLiquidity`)
- Price impact chart (uses `TickLiquidity`)

## Backfill Progress

The `LPEvent`/`Position` pipeline started backfilling on 2026-02-15 and made progress before stalling:

| Timestamp | LPEvent/Position at | Days behind | Progress |
|-----------|---------------------|-------------|----------|
| Feb 15, morning | June 10, 2025 | 250d | baseline |
| Feb 15, afternoon | June 12, 2025 | 248d | +2d |
| Feb 15, evening | June 21, 2025 | 239d | +9d |
| Feb 16, morning | July 15-16, 2025 | 215d | +24d |
| Feb 16, afternoon | July 15-16, 2025 | 215d | **stalled** |

The pipeline processed ~35 days of historical data in ~18 hours, then stopped. The Railway deployment logs should be checked for errors.

## Architecture

```
Browser
  │
  ├─ /api/candles ──────────► Railway: PoolCandle
  ├─ /api/pool-data ────────► Railway: TickLiquidity + PoolHourData + LPEvent + Mint/Burn + Position
  ├─ /api/lp-swaps ─────────► Railway: UniswapV3Pool_Swap
  │
  └─ Hooks
      ├─ useLPHistoricalData()     → /api/pool-data + /api/candles + /api/lp-swaps
      ├─ useAllPoolPositions()     → fetchRailwayPositions() (direct Railway call)
      ├─ useTickLiquidityFullRange() → fetchRailwayTickLiquidity() (direct Railway call)
      └─ useLiquidityDistribution() → positions (preferred) OR tickData (fallback)
```

### Key Code Paths

- **Pool routing:** `isRailwayTrackedPool()` in `lib/worldchain-indexer-client.ts` determines whether a pool uses the Worldchain REST indexer path
- **Position fetch:** `fetchRailwayPositions()` in `lib/worldchain-indexer-client.ts`
- **Tick fetch:** `fetchRailwayTickLiquidity()` in `lib/worldchain-indexer-client.ts`
- **Distribution calc:** `useLiquidityDistribution()` in `hooks/use-liquidity-distribution.ts` — position-based (line 188) vs tick-based (line 411)

## Railway Environment Variables

The Railway indexer has these relevant env vars:

- `TRACKED_V3_POOLS` — comma-separated list of pool addresses to index
- `TRACKED_V3_START_BLOCKS` — corresponding start blocks for each pool
- `NPM_ADDRESS` — Uniswap V3 NonfungiblePositionManager address (source for Position/LPEvent)
- `PG_URL` — PostgreSQL connection string
- `POLL_INTERVAL_MS` — block polling interval

## Potential Fix (Frontend)

Until Position data catches up, the Liquidity Distribution chart could detect stale positions and fall through to TickLiquidity. For example, in `dashboard.tsx` line 713:

```ts
// Skip stale positions for Railway pools — use current TickLiquidity instead
const positionsAreFresh = allPositionsFlattened.length > 0 &&
  allPositionsFlattened.some(p => (p.updatedAt ?? 0) > Date.now() / 1000 - 7 * 86400);

const { bars } = useLiquidityDistribution({
  allPositions: positionsAreFresh ? allPositionsFlattened : undefined,
  tickData: tickLiquidityFullRangeData,
  ...
});
```

This would use the current `TickLiquidity` data (updated hours ago) instead of 215-day-old positions.
