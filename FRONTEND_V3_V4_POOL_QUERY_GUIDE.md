# Frontend Guide: Querying Uniswap **v3 + v4** pool data from this indexer

This indexer stores v3 and v4 data side-by-side and exposes it via a single GraphQL endpoint. Most “chart datasets” use the **same entities** for v3 and v4, but the **pool key** you pass in queries differs (details below).

## Concepts (read this once)

### Pool identifier vs pool key (critical)

- **v3**
  - **Pool identifier**: the **pool contract address** (lowercased).
  - **Pool key used in chart entities** (`Candle.pool`, `TickLiquidity.pool`, etc.): the **same lowercased pool address**.
- **v4**
  - **Pool identifier**: the **poolId** (`bytes32`), as a hex string (`0x` + 64 hex chars).
  - **Pool key used in chart entities**: the indexer uses an opaque “pool reference” string:

```text
poolKey = "${chainId}-v4-${poolIdLowercased}"
example: "480-v4-0xe7bb...a6fa"
```

> Frontend rule of thumb: treat `pool` as an opaque string key.  
> For v3 it happens to be the address; for v4 it is `${chainId}-v4-${poolId}`.

### Protocol field

Most chart entities include `protocol: String!` with values `"v3"` or `"v4"`. You can:
- query by `pool` only (usually enough), or
- query by both `pool` and `protocol` (recommended for safety).

### Which entities are “frontend parity”

Use these entities for charts/metrics for **both v3 and v4**:
- `Candle` (OHLC + volume)
- `PoolDayData`, `PoolHourData` (aggregates)
- `TickLiquidity` (liquidity distribution / depth)
- `LPEvent`, `LPPosition` (LP activity / ranges)
- `OwnerPositionAggregate` (current LPs / active owners)
- `PoolLpAddressBucket` (+ `PoolLpActiveState` / `PoolLpTxOwnerTransition` under the hood)

Avoid v3-only raw event tables (e.g. `UniswapV3Pool_Swap`) if you want v4 parity.

## How the frontend should discover/select pools

### v3 pools

v3 pools are usually **known/configured** by address. The frontend can directly use:
- `poolIdentifier = poolAddressLowercased`
- `poolKey = poolAddressLowercased`

### v4 pools (discover via `Pool`)

v4 pools are created under a singleton PoolManager, so you discover them via the unified `Pool` entity.

#### List v4 pools

```graphql
query ListV4Pools($chainId: Int!) {
  Pool(
    where: { chainId: { _eq: $chainId }, protocol: { _eq: "v4" } }
    order_by: [{ createdAt: desc }]
  ) {
    id
    poolIdentifier
    token0
    token1
    fee
    tickSpacing
    hooks
    createdAt
    updatedAt
  }
}
```

**How to use the response**
- Use `Pool.id` as the **poolKey** for all chart queries (`Candle.pool`, etc.)
- Use `Pool.poolIdentifier` if you want to display/copy the raw poolId.

## Copy/paste GraphQL queries (v3 + v4)

In all examples below:
- For **v3**, pass `$poolKey = poolAddressLowercased`
- For **v4**, pass `$poolKey = Pool.id` (e.g. `"480-v4-0x..."`)

### 1) Price candles (OHLCV)

```graphql
query Candles($poolKey: String!, $interval: Int!, $fromTs: Int!, $limit: Int!) {
  Candle(
    where: {
      pool: { _eq: $poolKey }
      interval: { _eq: $interval }
      timestamp: { _gte: $fromTs }
    }
    order_by: [{ timestamp: asc }]
    limit: $limit
  ) {
    timestamp
    openPrice
    highPrice
    lowPrice
    closePrice
    volume0
    volume1
    txCount
    protocol
  }
}
```

### 2) Daily aggregates

```graphql
query PoolDay($poolKey: String!, $fromDate: Int!, $limit: Int!) {
  PoolDayData(
    where: { pool: { _eq: $poolKey }, date: { _gte: $fromDate } }
    order_by: [{ date: asc }]
    limit: $limit
  ) {
    date
    volumeToken0
    volumeToken1
    feesToken0
    feesToken1
    txCount
    openPrice
    highPrice
    lowPrice
    closePrice
    liquidity
    protocol
  }
}
```

### 3) Hourly aggregates

```graphql
query PoolHour($poolKey: String!, $fromHour: Int!, $limit: Int!) {
  PoolHourData(
    where: { pool: { _eq: $poolKey }, periodStartUnix: { _gte: $fromHour } }
    order_by: [{ periodStartUnix: asc }]
    limit: $limit
  ) {
    periodStartUnix
    volumeToken0
    volumeToken1
    feesToken0
    feesToken1
    txCount
    openPrice
    highPrice
    lowPrice
    closePrice
    liquidity
    protocol
  }
}
```

### 4) Liquidity distribution (ticks)

```graphql
query TickLiquidity($poolKey: String!, $limit: Int!) {
  TickLiquidity(
    where: { pool: { _eq: $poolKey } }
    order_by: [{ tick: asc }]
    limit: $limit
  ) {
    tick
    liquidityGross
    liquidityNet
    updatedAt
    protocol
  }
}
```

### 5) LP events (entries/exits by range)

```graphql
query LPEvents($poolKey: String!, $limit: Int!) {
  LPEvent(
    where: { pool: { _eq: $poolKey } }
    order_by: [{ timestamp: desc }]
    limit: $limit
  ) {
    timestamp
    owner
    eventType
    liquidity
    liquidityDelta
    amount0
    amount1
    tickLower
    tickUpper
    transactionHash
    blockNumber
    protocol
  }
}
```

### 6) Current LP ranges (per owner per tick range)

```graphql
query LPRanges($poolKey: String!, $limit: Int!) {
  LPPosition(
    where: { pool: { _eq: $poolKey } }
    order_by: [{ updatedAt: desc }]
    limit: $limit
  ) {
    owner
    tickLower
    tickUpper
    liquidity
    createdAt
    updatedAt
    protocol
  }
}
```

### 7) “Current LPs” (owner aggregates)

```graphql
query OwnerAgg($poolKey: String!, $limit: Int!) {
  OwnerPositionAggregate(
    where: { pool: { _eq: $poolKey } }
    order_by: [{ liquidityTotal: desc }]
    limit: $limit
  ) {
    owner
    liquidityTotal
    updatedAt
    protocol
  }
}
```

### 8) LP address entries/exits chart (bucketed)

```graphql
query LPAddressBuckets($poolKey: String!, $interval: String!, $fromBucket: Int!, $limit: Int!) {
  PoolLpAddressBucket(
    where: {
      pool: { _eq: $poolKey }
      interval: { _eq: $interval } # "DAY" or "HOUR"
      bucketStart: { _gte: $fromBucket }
    }
    order_by: [{ bucketStart: asc }]
    limit: $limit
  ) {
    bucketStart
    activeAddressesEnd
    addressEntries
    addressExits
    updatedAt
    protocol
  }
}
```

## Frontend helper: unify selection into a single `poolKey`

The simplest approach is to store a `SelectedPool` object and compute a single `poolKey` used in all queries.

```ts
type SelectedPool =
  | { protocol: "v3"; chainId: number; poolAddress: string } // v3 pool contract address
  | { protocol: "v4"; chainId: number; poolId: string; poolKey: string }; // v4 poolId + Pool.id

export function getPoolKey(selected: SelectedPool): string {
  if (selected.protocol === "v3") return selected.poolAddress.toLowerCase();
  // v4: prefer Pool.id returned by the indexer (opaque string key)
  return selected.poolKey;
}
```

To build the v4 `SelectedPool`, query `Pool` first and use:
- `poolId = Pool.poolIdentifier`
- `poolKey = Pool.id`

## Known caveat (important for “My Positions” UX)

`Position` (canonical NFT/tokenId position tracking) is currently **v3-only** in this indexer. For v4 pools:
- use `LPPosition`, `LPEvent`, `OwnerPositionAggregate` for most UI needs, or
- add v4 PositionManager indexing if you need tokenId ownership parity.


