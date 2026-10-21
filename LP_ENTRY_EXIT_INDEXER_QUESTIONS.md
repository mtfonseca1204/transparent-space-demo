## Instructions for indexer dev: LP entries/exits + active LP addresses (Dune-like chart)

We want a chart with 3 time series (daily or hourly UTC buckets), matching the definition:
- **Active LP addresses** = distinct addresses with **any open liquidity position** at bucket end.
- **Address entries** = addresses that become **active** in that bucket (first time or re-entry).
- **Address exits** = addresses that become **inactive** in that bucket (liquidity across all positions hits 0), including **withdraw-to-zero without burn** and **transfer-away of last active position**.

### What to add (do not change existing entities)
Add new entities (names can vary; schema shape matters):

1) **`PoolLpAddressBucket`** (the chart datasource)
- **id**: `${chainId}-${pool}-${interval}-${bucketStart}`
- **pool**: lowercased pool address
- **chainId**: int
- **interval**: `DAY` or `HOUR`
- **bucketStart**: unix seconds (UTC-aligned)
- **activeAddressesEnd**: int
- **addressEntries**: int
- **addressExits**: int
- (optional) `updatedAt`

2) **`PoolLpActiveState`** (optional, but recommended for performance)
- **id**: `${chainId}-${pool}-${interval}`
- **activeOwnerCount**: int (running count)
- (optional) `currentBucketStart`

### Source of truth (critical)
Compute these metrics from **NPM-derived owner liquidity** (the same logic that keeps `Position.owner` and `OwnerPositionAggregate.liquidityTotal` correct).  
Do **not** compute address entries/exits from pool Mint/Burn `LPEvent` (owner may not represent the actual NFT owner wallet).

### Bucket semantics + transition logic
For each affected owner on each relevant NPM event (`Transfer`, `IncreaseLiquidity`, `DecreaseLiquidity`, `Burn`):

1) Compute **prev** and **next** totals for that owner on that pool:
- `prevActive = prevLiquidityTotal > 0`
- `nextActive = nextLiquidityTotal > 0`

2) Compute bucket start:
- **DAY**: `bucketStart = floor(timestamp / 86400) * 86400`
- **HOUR**: `bucketStart = floor(timestamp / 3600) * 3600`

3) Update bucket counters:
- If `!prevActive && nextActive`: `addressEntries += 1`
- If `prevActive && !nextActive`: `addressExits += 1`

4) Maintain `activeAddressesEnd`:
- Either via `PoolLpActiveState.activeOwnerCount` updated on each transition, and set `bucket.activeAddressesEnd = activeOwnerCount`
- Or if you don’t add `PoolLpActiveState`, you’ll need another efficient way to get active count at bucket end (avoid scanning all owners every bucket).

**Transfers affect two owners**: apply the same transition logic for both `from` and `to`.

### Idempotency / preload / reorg safety
- Ensure increments do **not double-apply** under preload (`preload_handlers`) or replays.
- If multiple actions in a tx affect the same owner, only apply the final `prevActive → nextActive` once per owner per tx.

### Frontend query requirements
Expose a query returning, for a pool + interval + time range (ordered asc):
- `bucketStart`
- `activeAddressesEnd`
- `addressEntries`
- `addressExits`

That’s enough to plot the Dune-like chart: a line for `activeAddressesEnd` + bars for entries/exits.
