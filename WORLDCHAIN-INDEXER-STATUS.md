# World Chain Indexer — Data Status Report

**Date:** 2026-02-11
**Indexer:** `https://indexer-worldchain-production.up.railway.app`
**API pattern:** `GET /api/entities/:entity?pool=<addr>&limit=N&offset=N&from=N&to=N`

---

## Indexer Health

The indexer is running with **3 checkpoints**, each at a different block height:

| Checkpoint source | Last block | Updated |
|-------------------|-----------|---------|
| `pool:0x494d68e3cab640fa50f4c1b3e2499698d1a173a0` (WLD/WETH) | **7,048,596** | 2026-02-11T19:10:38Z |
| `pool:0xdce053d9ba0fa2c5f772416b64f191158cbcc32e` (WBTC/WLD) | **3,056,302** | 2026-02-11T19:10:41Z |
| `npm:0xec12a9f9a09f50550686363766cc153d03c27b5e` (NonfungiblePositionManager) | **3,056,302** | 2026-02-11T19:10:41Z |

| Metric | Value |
|--------|-------|
| Chain head | block **25,741,332** |
| WLD/WETH blocks behind | **~18,700,000** |
| WBTC/WLD blocks behind | **~22,700,000** |

Both pool checkpoints are far behind the chain head. The `updatedAt` timestamps refresh (today's date), but the blocks are not advancing — the indexer is alive but stuck/stalled.

### Global Entity Counts (across both pools)

| Entity | Count |
|--------|------:|
| `uniswap_v3_pool_swap` | 44,109 |
| `uniswap_v3_pool_mint` | 228 |
| `uniswap_v3_pool_burn` | 212 |
| `uniswap_v3_pool_collect` | 211 |
| `candle` | 9,783 |
| `pool_hour_data` | 1,169 |
| `pool_day_data` | 52 |
| `pool_candle` | 15,587 |
| `pool_daily_volume_by_size` | 171 |
| `tick_liquidity` | 110 |
| `position_state` | 1 |
| `lp_event` | 1 |
| `owner_position_aggregate` | 1 |
| `pool_lp_address_bucket` | 2 |
| `pool_lp_active_state` | 2 |
| `pool_lp_tx_owner_transition` | 2 |
| `position_daily_snapshot` | 1 |
| `pool_active_positions` | 1 |
| `swap_volume_attribution` | 0 |
| `pool_volume_stats_24h` | 2 |
| `pool` | 2 |

---

## WLD/WETH — `0x494d68e3cab640fa50f4c1b3e2499698d1a173a0`

**Pool:** WLD (token0: `0x2cfc85d8...`) / WETH (token1: `0x42000000...`), fee=3000 (0.3%), protocol=v3

### Data Available (Oct 18 – Dec 5, 2024)

| Entity | Count | Earliest | Latest |
|--------|------:|----------|--------|
| `UniswapV3Pool_Swap` | ~44,105 | Oct 18, 2024 06:37 UTC | Dec 5, 2024 21:07 UTC |
| `UniswapV3Pool_Mint` | ~227 | Oct 18, 2024 06:27 UTC | Dec 5, 2024 |
| `UniswapV3Pool_Burn` | ~212 | within same range | within same range |
| `UniswapV3Pool_Collect` | ~211 | within same range | within same range |
| `PoolHourData` | 1,166 | Oct 18, 2024 06:00 UTC | Dec 5, 2024 21:00 UTC |
| `PoolDayData` | 49 | Oct 18, 2024 | Dec 5, 2024 |
| `PoolCandle` | ~15,570 | Oct 18, 2024 | Dec 5, 2024 |
| `Candle` (5-min) | ~9,780 | within same range | within same range |
| `TickLiquidity` | ~108 | snapshot as of Dec 5 | snapshot as of Dec 5 |
| `PoolDailyVolumeBySize` | ~168 | within same range | within same range |

**Data span:** 49 days (Oct 18 – Dec 5, 2024)
**Hourly completeness:** 1,166 rows / ~1,176 expected hours (49 days) = **99.1%**
**Current pool state:** tick=-69191, liquidity=969,684,013,994,263,507,897

### Missing LP/Position Data

All position-related entities return **0 rows** for this pool:

| Entity | Count |
|--------|------:|
| `Position` | 0 |
| `LPEvent` | 0 |
| `OwnerPositionAggregate` | 0 |
| `PositionDailySnapshot` | 0 |
| `PoolActivePositions` | 0 |
| `SwapVolumeAttribution` | 0 |

The NPM checkpoint is at block 3,056,302 (Sep 4, 2024), well before the WLD/WETH pool's first swap. This means the NonfungiblePositionManager indexer has not reached the blocks where WLD/WETH positions were created.

### What's Missing

The pool has **on-chain activity after Dec 5, 2024**, but the indexer is stuck at block 7,048,596. All swaps, mints, burns, and aggregated data from **Dec 6, 2024 to present (Feb 11, 2026)** — roughly **14 months** — are missing.

---

## WBTC/WLD — `0xdce053d9ba0fa2c5f772416b64f191158cbcc32e`

**Pool:** WBTC (token0: `0x03c7054b...`) / WLD (token1: `0x79a02482...`), fee=500 (0.05%), protocol=v3

### Data Available (Aug 31 – Sep 4, 2024)

| Entity | Count | Earliest | Latest |
|--------|------:|----------|--------|
| `UniswapV3Pool_Swap` | 4 | Aug 31, 2024 18:00 UTC | Sep 4, 2024 07:46 UTC |
| `UniswapV3Pool_Mint` | 1 | within same range | within same range |
| `UniswapV3Pool_Burn` | 0 | — | — |
| `PoolHourData` | 3 | Aug 31, 2024 18:00 UTC | Sep 4, 2024 07:00 UTC |
| `PoolDayData` | 3 | Aug 31, 2024 | Sep 4, 2024 |
| `PoolCandle` | ~18 | within same range | within same range |
| `TickLiquidity` | 2 | snapshot as of Sep 4 | snapshot as of Sep 4 |
| `Position` | 1 | — | — |
| `LPEvent` | 1 | — | — |

**Data span:** 3.6 days
**Current pool state:** tick=63420, liquidity=36,742,346 (very low)

### All 4 Swaps

All from the same sender (`0x091ad9e2...`) to recipient (`0x45ced21e...`), with tiny volumes (10,000–22,000 token0 units = WBTC 8-decimal amounts).

| # | Timestamp | Block | amount0 | amount1 |
|---|-----------|-------|---------|---------|
| 1 | Aug 31, 2024 18:00 | 2,895,788 | 10,000 | -5,957,304 |
| 2 | Sep 1, 2024 01:02 | 2,926,268 | 10,000 | -5,878,957 |
| 3 | Sep 4, 2024 07:41 | 3,050,029 | 11,000 | -6,377,906 |
| 4 | Sep 4, 2024 07:46 | 3,050,171 | 11,000 | -6,286,959 |

### What's Missing

The indexer is stuck at block 3,056,302 (Sep 4, 2024). All on-chain activity from **Sep 5, 2024 to present (Feb 11, 2026)** — roughly **17 months** — is missing. Given the extremely low activity in the indexed window (4 swaps in 3 days), this pool may have very limited activity overall.

---

## Summary of Issues

| Issue | Impact | Root cause |
|-------|--------|------------|
| **WLD/WETH indexer stuck at block 7,048,596** | Missing ~14 months of data (Dec 6, 2024 – present) | Indexer not advancing |
| **WBTC/WLD indexer stuck at block 3,056,302** | Missing ~17 months of data (Sep 5, 2024 – present) | Indexer not advancing |
| **NPM indexer stuck at block 3,056,302** | No position data for WLD/WETH (positions created after Sep 4, 2024) | NPM checkpoint behind pool activity |
| **WLD/WETH LP data empty** | No Position, LPEvent, OwnerPositionAggregate, PositionDailySnapshot | NPM hasn't reached relevant blocks |
| **WBTC/WLD very low activity** | Only 4 swaps, 1 mint, minimal liquidity in indexed window | Pool may be genuinely low-activity |

### Next Steps

1. **Unblock the indexer** — investigate why all three checkpoints (both pools + NPM) are stuck and not advancing despite the process being alive.
2. **Backfill gap** — once unblocked, the indexer needs to process ~19M+ blocks to catch up to chain head.
3. **Verify WBTC/WLD on-chain** — confirm whether this pool has meaningful activity beyond Sep 4, 2024 via [Worldscan](https://worldscan.org/address/0xdce053d9ba0fa2c5f772416b64f191158cbcc32e).
