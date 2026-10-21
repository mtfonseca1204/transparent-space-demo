# Indexer Data Types Reference

This document describes all data types fetched from the HyperIndex indexer by the transparent-space frontend.

---

## Table of Contents

1. [Candle](#1-candle)
2. [Position](#2-position)
3. [OwnerPositionAggregate](#3-ownerpositionaggregate)
4. [TickLiquidity](#4-tickliquidity)
5. [UniswapV3Pool_Swap](#5-uniswapv3pool_swap)
6. [LPEvent](#6-lpevent)
7. [UniswapV3Pool_Mint / Burn](#7-uniswapv3pool_mint--burn)
8. [PoolDayData](#8-pooldaydata)
9. [PoolHourData](#9-poolhourdata)
10. [Pool](#10-pool)
11. [LPPosition](#11-lpposition)
12. [GraphQL Queries Reference](#graphql-queries-reference)
13. [Data Flow Architecture](#data-flow-architecture)

---

## 1. Candle

OHLCV price data aggregated at configurable intervals (default: 5 minutes).

### Schema

```graphql
type Candle {
  id: ID!
  pool: String!
  protocol: String!    # "v3" or "v4"
  interval: Int!       # Seconds (e.g., 300 = 5 minutes)
  timestamp: Int!
  openPrice: BigInt!   # sqrtPriceX96 format
  highPrice: BigInt!
  lowPrice: BigInt!
  closePrice: BigInt!
  volume0: BigInt!
  volume1: BigInt!
  txCount: Int!
}
```

### TypeScript Interface

```typescript
interface CandleData {
  id: string;
  pool: string;
  interval: number;
  timestamp: number;
  openPrice: string;   // sqrtPriceX96 as string
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume0: string;     // BigInt as string
  volume1: string;
  txCount: number;
}
```

### Usage

- Price charts (OHLC candlestick rendering)
- Volume analysis
- Current price approximation (latest candle)

### Related Hooks

- `useLPHistoricalData()` - Fetches candles for time range
- `useUnifiedPoolData()` - Fetches latest candle for current price

---

## 2. Position

Canonical Uniswap position state tracked via NFT tokenId (primarily v3).

### Schema

```graphql
type Position {
  id: ID!              # ${chainId}-${tokenId}
  tokenId: BigInt!
  pool: String!
  protocol: String!    # "v3" or "v4"
  owner: String!
  tickLower: Int!
  tickUpper: Int!
  liquidity: BigInt!
  updatedAt: Int!
  fee: Int
  token0: String
  token1: String
  hooks: String        # v4 only: hook address
}
```

### TypeScript Interface

```typescript
interface PositionData {
  id: string;
  tokenId: string;
  pool: string;
  owner: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  updatedAt: number;
  fee?: string | null;
  token0?: string | null;
  token1?: string | null;
}
```

### Usage

- Individual LP position tracking
- Position range visualization on charts
- LP concentration analysis per owner

### Related Hooks

- `usePositionsByOwner()` - Positions for specific owner
- `usePositionsForOwners()` - Batch fetch for multiple owners

---

## 3. OwnerPositionAggregate

Pre-aggregated total liquidity per owner per pool.

### Schema

```graphql
type OwnerPositionAggregate {
  id: ID!              # ${chainId}-${pool}-${owner}
  pool: String!
  protocol: String!    # "v3" or "v4"
  owner: String!
  liquidityTotal: BigInt!
  updatedAt: Int!
}
```

### TypeScript Interface

```typescript
interface OwnerPositionAggregateData {
  id: string;
  pool: string;
  owner: string;
  liquidityTotal: string;
  updatedAt: number;
}
```

### Usage

- "Current LPs" leaderboard
- Top LP owners ranking by total liquidity
- Quick lookup without aggregating individual positions

### Related Hooks

- `useAllLPPositions()` - Top LP owners for a pool

---

## 4. TickLiquidity

Liquidity state at each initialized tick.

### Schema

```graphql
type TickLiquidity {
  id: ID!
  pool: String!
  protocol: String!    # "v3" or "v4"
  tick: Int!
  liquidityGross: BigInt!
  liquidityNet: BigInt!
  updatedAt: Int!
}
```

### TypeScript Interface

```typescript
interface TickLiquidityData {
  id: string;
  pool: string;
  tick: number;
  liquidityGross: string;
  liquidityNet: string;
  updatedAt: number;
}
```

### Usage

- Depth charts (bid/ask liquidity visualization)
- Liquidity distribution heatmaps
- Price impact calculations
- Historical liquidity rollback for impact bands

### Related Hooks

- `useTickLiquidity()` - Tick liquidity within ±8000 of current tick
- `useTickLiquidityFullRange()` - All ticks for comprehensive analysis
- `useLPHistoricalData()` - Fetches tick liquidity for depth calculations

---

## 5. UniswapV3Pool_Swap

Raw swap events from Uniswap v3 pools.

### Schema

```graphql
type UniswapV3Pool_Swap {
  id: ID!
  pool: String
  timestamp: Int!
  blockNumber: Int!
  transactionHash: String
  sender: String!
  recipient: String!
  amount0: BigInt!
  amount1: BigInt!
  sqrtPriceX96: BigInt!
  liquidity: BigInt!
  tick: BigInt!
}
```

### TypeScript Interface

```typescript
interface V3SwapEventData {
  id: string;
  pool: string;
  timestamp: number;
  sqrtPriceX96: string;
  liquidity: string;
  tick: string;
  transactionHash?: string;
}
```

### Usage

- Historical price oracle approximation
- Per-swap impact band rendering
- Swap volume analysis

### Related Hooks

- `useLPHistoricalData()` - Fetches v3 swaps for impact visualization

---

## 6. LPEvent

LP entry/exit events (mint, burn, increase, decrease).

### Schema

```graphql
type LPEvent {
  id: ID!
  pool: String!
  protocol: String!    # "v3" or "v4"
  owner: String!
  eventType: String!   # "MINT" | "BURN" | "INCREASE" | "DECREASE"
  timestamp: Int!
  blockNumber: Int!
  transactionHash: String!
  liquidity: BigInt!
  liquidityDelta: BigInt!
  amount0: BigInt!
  amount1: BigInt!
  tickLower: BigInt!
  tickUpper: BigInt!
}
```

### TypeScript Interface

```typescript
interface LPEventData {
  id: string;
  owner: string;
  eventType: "MINT" | "BURN" | "INCREASE" | "DECREASE";
  timestamp: number;
  liquidityDelta: string;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
}
```

### Usage

- LP entry/exit tracking and charts
- Historical liquidity state reconstruction
- New LP positions counting
- Owner activity analysis

### Related Hooks

- `useLPEvents()` - LP events for time range
- `useLPEntryExitData()` - Processed entry/exit chart data
- `useNewPositionsCount()` - Count of new positions in range

---

## 7. UniswapV3Pool_Mint / Burn

Pool-level liquidity delta events (source of truth for TickLiquidity updates).

### Schema

```graphql
type UniswapV3Pool_Mint {
  id: ID!
  pool: String
  timestamp: Int!
  blockNumber: Int!
  transactionHash: String
  sender: String!
  owner: String!
  tickLower: BigInt!
  tickUpper: BigInt!
  amount: BigInt!      # Liquidity amount (uint128)
  amount0: BigInt!
  amount1: BigInt!
}

type UniswapV3Pool_Burn {
  id: ID!
  pool: String
  timestamp: Int!
  blockNumber: Int!
  transactionHash: String
  owner: String!
  tickLower: BigInt!
  tickUpper: BigInt!
  amount: BigInt!
  amount0: BigInt!
  amount1: BigInt!
}
```

### TypeScript Interfaces

```typescript
interface V3PoolMintEventData {
  id: string;
  pool: string;
  timestamp: number;
  transactionHash: string;
  tickLower: string;
  tickUpper: string;
  amount: string;
  amount0: string;
  amount1: string;
}

interface V3PoolBurnEventData {
  // Same structure as Mint
}
```

### Usage

- Reconstructing historical tick liquidity state
- Impact band calculations (more accurate than LPEvent for v3)
- Pool-level liquidity delta tracking

### Related Hooks

- `useLPHistoricalData()` - Uses these for v3 impact band rollback

---

## 8. PoolDayData

Daily aggregated pool metrics.

### Schema

```graphql
type PoolDayData {
  id: ID!
  pool: String!
  protocol: String!    # "v3" or "v4"
  date: Int!           # Unix timestamp (UTC midnight)
  tvlToken0: BigInt!
  tvlToken1: BigInt!
  volumeToken0: BigInt!
  volumeToken1: BigInt!
  feesToken0: BigInt!
  feesToken1: BigInt!
  txCount: Int!
  openPrice: BigInt!
  highPrice: BigInt!
  lowPrice: BigInt!
  closePrice: BigInt!
  liquidity: BigInt!
}
```

### TypeScript Interface

```typescript
interface PoolDayData {
  id: string;
  date: number;
  volumeToken0: string;
  volumeToken1: string;
  feesToken0: string;
  feesToken1: string;
  txCount: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  liquidity: string;
}
```

### Usage

- 24h volume metrics
- Daily fee collection
- TVL trend analysis (7d, 30d changes)
- Daily transaction counts

### Related Hooks

- `usePoolDayData()` - Fetches daily data for metrics
- `usePoolMetrics()` - Processed metrics from daily data

---

## 9. PoolHourData

Hourly aggregated pool metrics.

### Schema

```graphql
type PoolHourData {
  id: ID!
  pool: String!
  protocol: String!    # "v3" or "v4"
  periodStartUnix: Int!
  tvlToken0: BigInt!
  tvlToken1: BigInt!
  volumeToken0: BigInt!
  volumeToken1: BigInt!
  feesToken0: BigInt!
  feesToken1: BigInt!
  txCount: Int!
  openPrice: BigInt!
  highPrice: BigInt!
  lowPrice: BigInt!
  closePrice: BigInt!
  liquidity: BigInt!
}
```

### TypeScript Interface

```typescript
interface PoolHourData {
  id: string;
  periodStartUnix: number;
  volumeToken0: string;
  volumeToken1: string;
  feesToken0: string;
  feesToken1: string;
  txCount: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  liquidity: string;
}
```

### Usage

- Per-candle liquidity lookups
- Hourly volume/fee breakdown
- Current liquidity approximation (latest hour)

### Related Hooks

- `useLPHistoricalData()` - Uses hourly data for liquidity per candle
- `useUnifiedPoolData()` - Fetches latest hour for current liquidity

---

## 10. Pool

Pool metadata for both v3 and v4 pools.

### Schema

```graphql
type Pool {
  id: ID!              # ${chainId}-${protocol}-${poolIdentifier}
  chainId: Int!
  protocol: String!    # "v3" or "v4"
  poolIdentifier: String!  # v3: pool address, v4: poolId (bytes32)
  poolManagerAddress: String  # v4 only
  hooks: String        # v4 only: hook address (0x0 if none)
  token0: String!
  token1: String!
  fee: Int!
  tickSpacing: Int!
  liquidity: BigInt!
  sqrtPriceX96: BigInt!
  tick: Int
  createdAt: Int!
  updatedAt: Int!
}
```

### TypeScript Interface

```typescript
interface IndexerPool {
  id: string;
  poolIdentifier: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  hooks?: string | null;
  createdAt: number;
  updatedAt: number;
  protocol: "v3" | "v4";
  chainId: number;
}
```

### Usage

- Pool discovery and listing
- Pool selection UI
- v4 pool configuration (hooks, poolManager)
- Token pair identification

### Related Hooks

- `useIndexerPools()` - List pools by protocol
- `useIndexerPoolById()` - Single pool lookup

---

## 11. LPPosition

Legacy LP position entity (also used for v4 positions).

### Schema

```graphql
type LPPosition {
  id: ID!
  owner: String!
  pool: String!
  protocol: String!    # "v3" or "v4"
  tickLower: BigInt!
  tickUpper: BigInt!
  liquidity: BigInt!
  createdAt: Int!
  updatedAt: Int!
}
```

### Usage

- v4 position tracking (no NFT tokenId)
- Fallback for OwnerPositionAggregate when not available
- Legacy deployment compatibility

### Related Hooks

- `useAllLPPositions()` - Falls back to LPPosition for aggregation
- `usePositionsByOwner()` - Uses LPPosition for v4 pools

---

## GraphQL Queries Reference

| Query | Entity | Description |
|-------|--------|-------------|
| `GET_CANDLES_QUERY` | Candle | Price chart OHLCV data for time range |
| `GET_LATEST_CANDLE_QUERY` | Candle | Most recent candle (current price proxy) |
| `GET_POSITIONS_BY_OWNER_QUERY` | Position | LP positions for specific owner |
| `GET_OWNER_POSITION_AGGREGATES_QUERY` | OwnerPositionAggregate | Top LPs leaderboard |
| `GET_TICK_LIQUIDITY_QUERY` | TickLiquidity | Liquidity in tick range |
| `GET_ALL_TICK_LIQUIDITY_QUERY` | TickLiquidity | Full liquidity distribution |
| `GET_RECENT_SWAPS_QUERY` | UniswapV3Pool_Swap | Recent swaps for oracle |
| `GET_V3_SWAPS_PAGED_QUERY` | UniswapV3Pool_Swap | Paginated swap history |
| `GET_LP_EVENTS_QUERY` | LPEvent | LP entry/exit events |
| `GET_V3_POOL_MINT_BURN_EVENTS_QUERY` | Mint/Burn | Pool-level liquidity deltas |
| `GET_POOL_DAY_DATA_QUERY` | PoolDayData | Daily aggregates |
| `GET_POOL_HOUR_DATA_QUERY` | PoolHourData | Hourly aggregates |
| `GET_POOLS_QUERY` | Pool | List pools by chain/protocol |
| `GET_POOL_BY_ID_QUERY` | Pool | Single pool by ID |
| `GET_NEW_POSITIONS_COUNT_QUERY` | LPEvent_aggregate | Count new positions |
| `GET_LATEST_POOL_HOUR_DATA_QUERY` | PoolHourData | Latest hour (current liquidity) |

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    HyperIndex Indexer                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Uniswap v3  │  │ Uniswap v4  │  │   Hasura    │             │
│  │   Events    │  │   Events    │  │   GraphQL   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         └────────────────┴────────────────┘                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │ GraphQL
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Layer                              │
│  ┌─────────────┐                                                │
│  │ envioClient │ ◄── graphql-request library                    │
│  └──────┬──────┘                                                │
│         │                                                        │
│  ┌──────▼──────────────────────────────────────────────┐        │
│  │              React Query Hooks                       │        │
│  │  ┌────────────────┐  ┌────────────────┐             │        │
│  │  │useLPHistorical │  │usePoolMetrics  │             │        │
│  │  │     Data       │  │                │             │        │
│  │  └────────────────┘  └────────────────┘             │        │
│  │  ┌────────────────┐  ┌────────────────┐             │        │
│  │  │useIndexerPools │  │useTickLiquidity│             │        │
│  │  └────────────────┘  └────────────────┘             │        │
│  │  ┌────────────────┐  ┌────────────────┐             │        │
│  │  │useAllLPPositions│ │useUnifiedPool  │             │        │
│  │  │                │  │     Data       │             │        │
│  │  └────────────────┘  └────────────────┘             │        │
│  └─────────────────────────────────────────────────────┘        │
│         │                                                        │
│  ┌──────▼──────────────────────────────────────────────┐        │
│  │              UI Components                           │        │
│  │  Price Charts │ Depth Charts │ LP Leaderboard       │        │
│  │  Metrics Cards │ Position Details │ Pool Selector   │        │
│  └─────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Protocol Differences

### v3 Pools
- Pool identified by contract address (0x + 40 hex chars)
- Positions tracked via NonfungiblePositionManager NFTs
- Uses `Position` entity with `tokenId`
- Pool-level Mint/Burn events for liquidity deltas

### v4 Pools
- Pool identified by poolId (bytes32, 0x + 64 hex chars)
- Managed by singleton PoolManager contract
- Supports hooks for custom logic
- Uses `LPPosition` entity (no tokenId)
- ModifyLiquidity events via PositionManager

### Pool Key Format
- **v3**: `0x{40-char address}` (lowercased)
- **v4**: `{chainId}-v4-0x{64-char poolId}` (e.g., `480-v4-0xe7bba98b...`)

---

## Additional Indexed Entities

These entities exist in the schema but are used internally or for advanced analytics:

### PoolLpAddressBucket
Bucketed LP address metrics for charting active addresses, entries, and exits.

### PoolLpActiveState
Running active owner count per pool (optimization to avoid scanning all owners).

### PoolLpTxOwnerTransition
Per-transaction owner state for idempotent bucket counter updates.

### HookStats (v4 only)
Statistics per hook address (number of pools, swaps, TVL, volume, fees).

---

## File Locations

| File | Purpose |
|------|---------|
| `lib/envio-client.ts` | GraphQL client, queries, type definitions |
| `hooks/use-lp-historical-data.ts` | Main chart data hook |
| `hooks/use-pool-metrics.ts` | Pool metrics hooks |
| `hooks/use-indexer-pools.ts` | Pool listing hooks |
| `hooks/use-unified-pool-data.ts` | Unified v3/v4 pool data |
| `lib/pools.ts` | Pool configuration and helpers |

