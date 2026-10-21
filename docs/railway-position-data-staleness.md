# Railway Indexer: Position Entity Staleness

## Problem

The Railway indexer has a data inconsistency between the `Position` and `OwnerPositionAggregate` entities for pool `0x5f835420502a7702de50cd0e78d8aa3608b2137e` (WETH/USDC on Worldchain).

| Entity | Total rows | Non-zero liquidity | Sum liquidity |
|--------|------------|-------------------|---------------|
| **OwnerPositionAggregate** | 2,857 | **572** | 12,796,581,937,139,393 |
| **Position** | 20,000+ | **48** | 3,877,971,092,304,360 |

The `Position` table is severely stale — most positions show `liquidity: "0"` even though the corresponding `OwnerPositionAggregate` correctly reflects non-zero liquidity.

## Impact

The frontend's "LP Deep Dive" panel showed only **~47 LPs** instead of **572**, and total displayed TVL was **~$30K** instead of the pool's actual **~$116.6K**.

Every downstream chart that depends on position-level data (`tickLower`, `tickUpper`, `liquidity`) was affected:

```
fetchRailwayPositions() → Position entity [48 non-zero]
  → useAllPoolPositions()
    → allLPPositionsData → allPositionsFlattened
      → LiquidityDistributionChart
      → LPDistributionComparisonChart
      → CapitalEfficiencyChart
      → PriceImpactChart
      → LPRangesByAddressChart
    → lpConcentration → LPConcentrationChart
    → useVolumeAttributionHourly()
```

## Root Cause

The Railway indexer updates `OwnerPositionAggregate.liquidityTotal` correctly on mint/burn events, but fails to keep individual `Position.liquidity` values in sync. This means:

- **OwnerPositionAggregate**: Reliable for LP counts, per-owner total liquidity, and sorting.
- **Position**: Unreliable. Only ~48 out of 572 active positions have non-zero liquidity. Cannot be trusted as the sole source of truth for per-position tick-range data.

## Verification

Query the Railway API directly to confirm:

```bash
# OwnerPositionAggregate — returns 572 non-zero entries
curl -s "https://indexer-worldchain-production.up.railway.app/api/entities/OwnerPositionAggregate?pool=0x5f835420502a7702de50cd0e78d8aa3608b2137e&limit=2000" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print(f"total={len(d)}, non-zero={sum(1 for r in d if r[\"liquidityTotal\"]!=\"0\")}")'

# Position — returns only ~48 non-zero entries
curl -s "https://indexer-worldchain-production.up.railway.app/api/entities/Position?pool=0x5f835420502a7702de50cd0e78d8aa3608b2137e&limit=2000" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print(f"total={len(d)}, non-zero={sum(1 for r in d if r[\"liquidity\"]!=\"0\")}")'
```

## Frontend Workarounds Applied

1. **LP list** (`useAllLPPositions`): Switched Railway path to fetch `OwnerPositionAggregate` directly instead of deriving from stale `Position` rows. Now shows all 572 LPs.

2. **USD TVL per LP** (`lpUsdByOwner`): Added proportional fallback — LPs without position-level data get an estimated TVL based on their share of total pool liquidity.

3. **Distribution charts**: Still limited to the ~48 positions that have tick-range data. A proper fix requires either fixing the Railway indexer or falling back to tick-based distribution calculations.

## Recommended Indexer Fix

The Railway indexer should keep `Position.liquidity` in sync with the actual on-chain state. When a mint or burn event updates `OwnerPositionAggregate.liquidityTotal`, the corresponding `Position` row's `liquidity` field must also be updated.
