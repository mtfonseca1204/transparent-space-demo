## Frontend notes: multi-pool support (World Chain)

This indexer now supports indexing **multiple Uniswap V3 pool contracts** with the same handlers.

### Tracked pools

All `pool` fields are stored as **lowercased** addresses.

- **WLD / USDC (existing)**: `0x610e319b3a3ab56a0ed5562927d37c233774ba39`

### What changed (important for the UI)

- **Do not assume a single pool**.
- All pool-derived entities now have:
  - a `pool: String!` field containing the **lowercased pool address**, and
  - **IDs that include pool** (and usually chainId) so different pools don’t collide.

If the UI was previously caching / keying off IDs, you must treat IDs as changed.

### Which entities are “per-pool” and should be filtered

These are the main entities the UI will typically query and filter by `pool`:

- **Candles**: `Candle.pool`
- **Daily aggregates**: `PoolDayData.pool`
- **Hourly aggregates**: `PoolHourData.pool`
- **Tick liquidity**: `TickLiquidity.pool`
- **Simplified LP positions (Mint/Burn-based)**: `LPPosition.pool`
- **LP events (Mint/Burn-based)**: `LPEvent.pool`

NFT (NPM) positions also carry pool:

- **Canonical NFT Position**: `Position.pool`
- **Owner aggregate**: `OwnerPositionAggregate.pool`
- **LP entries/exits buckets**: `PoolLpAddressBucket.pool`
- **Running active count**: `PoolLpActiveState.pool`

### ID format changes (high-level)

You generally don’t need to parse IDs on the frontend, but you *should know they changed*.

- **`Candle.id`** is now: `${chainId}-${poolLc}-${interval}-${bucketStart}`
- **`PoolDayData.id`** is now: `${chainId}-${poolLc}-${dayStart}`
- **`PoolHourData.id`** is now: `${chainId}-${poolLc}-${hourStart}`
- **`TickLiquidity.id`** is now: `${chainId}-${poolLc}-${tick}`
- **`LPPosition.id`** is now: `${chainId}-${poolLc}-${ownerLc}-${tickLower}-${tickUpper}`
- **`LPEvent.id`** is now: `${chainId}-${txHash}-${logIndex}`

NFT `Position.id` remains `${chainId}-${tokenId}` (filter by `Position.pool` for per-pool views).

### Pool selector / filtering guidelines

- **Normalize user-selected pool address to lowercase** before using it in queries.
- Prefer filtering by the `pool` field instead of deriving anything from IDs.
- If you support multiple networks later, include `chainId` in the selector as well.

### Example GraphQL queries (patterns)

#### 1) Per-pool candles (chart)

```graphql
query Candles($pool: String!, $limit: Int!) {
  Candle(where: { pool: { eq: $pool } }, limit: $limit, orderBy: { timestamp: DESC }) {
    id
    pool
    interval
    timestamp
    openPrice
    highPrice
    lowPrice
    closePrice
    volume0
    volume1
    txCount
  }
}
```

Variables:

```json
{ "pool": "0x610e319b3a3ab56a0ed5562927d37c233774ba39", "limit": 300 }
```

#### 2) “Current LPs” (per-pool owner aggregates)

```graphql
query OwnerAgg($pool: String!, $limit: Int!) {
  OwnerPositionAggregate(where: { pool: { eq: $pool } }, limit: $limit, orderBy: { liquidityTotal: DESC }) {
    id
    pool
    owner
    liquidityTotal
    updatedAt
  }
}
```

#### 3) NFT Positions (per-pool)

```graphql
query Positions($pool: String!, $limit: Int!) {
  Position(where: { pool: { eq: $pool } }, limit: $limit, orderBy: { updatedAt: DESC }) {
    id
    tokenId
    pool
    owner
    tickLower
    tickUpper
    liquidity
    updatedAt
    fee
    token0
    token1
  }
}
```

### UX recommendation

- In the UI, expose a **Pool dropdown** that shows pool labels.
- Store the selected pool as a lowercase string and pass it into all queries.

### Backend behavior note

The indexer only emits data for pools in its tracked list. If the UI queries a pool address that is not tracked, it will return empty results.
