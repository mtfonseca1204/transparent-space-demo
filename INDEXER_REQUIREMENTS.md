# Indexer Requirements for Additional Charts

This document outlines what additional data your Envio indexer needs to track to enable the remaining charts with real data.

## ✅ Already Implemented Charts (Using Real Data)

1. **LP Address Activity Chart** - Using `Candle`, `LPPosition`, `TickLiquidity` entities
2. **Current LPs List** - Using `LPPosition` entity
3. **LP Concentration** - Using `LPPosition` entity
4. **WLD/USDC Price Chart** - Using `Candle` entity
5. **Liquidity Distribution** - Using `TickLiquidity` entity

---

## 📊 Charts Needing Additional Indexer Data

### 1. **LPs - New Addresses vs Exits Chart**

**What it shows**: Track LP entry and exit trends over time

**Current limitation**: We can see current positions but not historical entry/exit events

**What the indexer needs to track**:

#### New Entity: `LPEvent`
```graphql
type LPEvent {
  id: ID!
  pool: String!
  owner: String!
  eventType: String!  # "MINT" | "BURN" | "INCREASE" | "DECREASE"
  timestamp: Int!
  blockNumber: Int!
  transactionHash: String!
  liquidity: String!
  liquidityDelta: String!  # Change in liquidity (positive for add, negative for remove)
  amount0: String!
  amount1: String!
  tickLower: Int!
  tickUpper: Int!
}
```

**Events to index**:
- `Mint` event from UniswapV3Pool - New LP position created
- `Burn` event from UniswapV3Pool - LP position removed/reduced
- `IncreaseLiquidity` event from NonfungiblePositionManager
- `DecreaseLiquidity` event from NonfungiblePositionManager

**Query pattern**:
```graphql
query GetLPEvents($pool: String!, $startTime: Int!, $endTime: Int!) {
  LPEvent(
    where: {
      pool: { _eq: $pool }
      timestamp: { _gte: $startTime, _lte: $endTime }
    }
    order_by: { timestamp: asc }
  ) {
    id
    owner
    eventType
    timestamp
    liquidityDelta
  }
}
```

**Calculation logic**:
- Group events by day/hour
- Count unique addresses with first MINT event = "New LPs"
- Count addresses with final BURN (liquidity → 0) = "Exits"

---

### 2. **Overall Pool Metrics (TVL, 24h Volume, 24h Fees)**

**What it shows**: Key pool statistics

**Current limitation**: We have candle volume but not aggregated metrics

**What the indexer needs to track**:

#### New Entity: `PoolDayData`
```graphql
type PoolDayData {
  id: ID!  # pool-address-day-id
  pool: String!
  date: Int!  # Unix timestamp at start of day
  tvlUSD: String!
  volumeUSD: String!
  feesUSD: String!
  txCount: Int!
  token0Price: String!
  token1Price: String!
  token0Amount: String!
  token1Amount: String!
}
```

**Calculation approach**:
1. **TVL**: Calculate from pool's token balances × token prices
   - Listen to `Swap`, `Mint`, `Burn` events
   - Track token0 and token1 reserves
   - Multiply by oracle/market prices

2. **24h Volume**: Sum all swap volumes in last 24 hours
   - Already have this in `Candle` entity
   - Just need to aggregate: `SUM(volume0 + volume1)` for last 24h

3. **24h Fees**: Calculate from volume × fee tier
   - Formula: `24h Volume × (fee / 1000000)`
   - Example: $1M volume × 0.0001 (0.01% fee) = $100 fees

**Query pattern**:
```graphql
query GetPoolMetrics($pool: String!, $date: Int!) {
  PoolDayData(
    where: {
      pool: { _eq: $pool }
      date: { _eq: $date }
    }
  ) {
    tvlUSD
    volumeUSD
    feesUSD
    txCount
  }
}
```

---

### 3. **TVL 7-day and 30-day % Change**

**What it shows**: TVL growth trends

**Current limitation**: Need historical TVL snapshots

**What the indexer needs to track**:

#### Extend `PoolDayData` (from above)
Already includes `tvlUSD` field

**Query pattern**:
```graphql
query GetHistoricalTVL($pool: String!, $days: Int!) {
  PoolDayData(
    where: {
      pool: { _eq: $pool }
    }
    order_by: { date: desc }
    limit: $days
  ) {
    date
    tvlUSD
  }
}
```

**Calculation**:
```typescript
const currentTVL = poolDayData[0].tvlUSD;
const tvl7DaysAgo = poolDayData[7].tvlUSD;
const percentChange = ((currentTVL - tvl7DaysAgo) / tvl7DaysAgo) * 100;
```

---

### 4. **Price Impact Chart**

**What it shows**: How much price moves for different trade sizes

**Current limitation**: Need to calculate from tick liquidity

**What the indexer needs to track**:

#### Use existing `TickLiquidity` entity ✅
No additional indexing needed! Can calculate from existing data.

**Calculation approach**:
1. Get all ticks from current price to target price
2. Sum liquidity across ticks
3. Calculate price impact using Uniswap V3 math:

```typescript
// Pseudocode for price impact calculation
function calculatePriceImpact(
  tickLiquidity: TickLiquidityData[],
  currentPrice: number,
  tradeAmountUSD: number
): number {
  let remainingAmount = tradeAmountUSD;
  let currentTick = priceToTick(currentPrice);
  let priceAfterSwap = currentPrice;
  
  // Walk through ticks until trade is complete
  for (const tick of tickLiquidity) {
    const liquidityInTick = Number(tick.liquidityGross);
    const amountConsumed = Math.min(remainingAmount, liquidityInTick);
    
    // Update price based on liquidity consumed
    priceAfterSwap = tickToPrice(tick.tick);
    remainingAmount -= amountConsumed;
    
    if (remainingAmount <= 0) break;
  }
  
  return ((priceAfterSwap - currentPrice) / currentPrice) * 100;
}
```

**Implementation**: Can be done client-side with existing `TickLiquidity` data

---

### 5. **New LP Positions Count**

**What it shows**: Number of new positions created in a time period

**Current limitation**: Need historical event tracking

**What the indexer needs to track**:

#### Use `LPEvent` entity (from #1 above)

**Query pattern**:
```graphql
query GetNewPositions($pool: String!, $startTime: Int!, $endTime: Int!) {
  LPEvent(
    where: {
      pool: { _eq: $pool }
      eventType: { _eq: "MINT" }
      timestamp: { _gte: $startTime, _lte: $endTime }
    }
  ) {
    id
    owner
    timestamp
  }
}
```

**Calculation**: Count unique `MINT` events in time range

---

## 🎯 Priority Implementation Order

### **High Priority** (Most valuable for users):
1. **PoolDayData** entity - Enables TVL, Volume, Fees metrics
2. **LPEvent** entity - Enables LP behavior tracking

### **Medium Priority** (Nice to have):
3. Historical snapshots for trend analysis

### **Low Priority** (Can calculate client-side):
4. Price Impact - Can calculate from existing TickLiquidity

---

## 📝 Summary of New Entities Needed

### 1. `LPEvent` Entity
- **Purpose**: Track all LP position changes
- **Events**: Mint, Burn, IncreaseLiquidity, DecreaseLiquidity
- **Enables**: LP entry/exit charts, position history

### 2. `PoolDayData` Entity
- **Purpose**: Daily aggregated pool metrics
- **Data**: TVL, Volume, Fees, Token amounts
- **Enables**: TVL trends, volume charts, fee calculations

### 3. `PoolHourData` Entity (Optional)
- **Purpose**: Hourly granularity for more detailed charts
- **Same fields as PoolDayData** but aggregated hourly

---

## 🔧 Implementation Notes

### For `LPEvent` tracking:
```typescript
// In your Envio indexer handler
Pool.Mint.handler(async ({ event, context }) => {
  const lpEvent = {
    id: `${event.transactionHash}-${event.logIndex}`,
    pool: event.srcAddress,
    owner: event.params.owner,
    eventType: "MINT",
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    transactionHash: event.transactionHash,
    liquidity: event.params.amount.toString(),
    liquidityDelta: event.params.amount.toString(),
    amount0: event.params.amount0.toString(),
    amount1: event.params.amount1.toString(),
    tickLower: event.params.tickLower,
    tickUpper: event.params.tickUpper,
  };
  
  await context.LPEvent.set(lpEvent);
});
```

### For `PoolDayData` tracking:
```typescript
// Calculate daily at midnight or on each relevant event
Pool.Swap.handler(async ({ event, context }) => {
  const dayId = Math.floor(event.block.timestamp / 86400) * 86400;
  const poolDayId = `${event.srcAddress}-${dayId}`;
  
  // Get or create day data
  let dayData = await context.PoolDayData.get(poolDayId);
  if (!dayData) {
    dayData = {
      id: poolDayId,
      pool: event.srcAddress,
      date: dayId,
      tvlUSD: "0",
      volumeUSD: "0",
      feesUSD: "0",
      txCount: 0,
      // ... other fields
    };
  }
  
  // Update with swap data
  dayData.volumeUSD = (BigInt(dayData.volumeUSD) + calculateSwapVolume(event)).toString();
  dayData.txCount += 1;
  
  await context.PoolDayData.set(dayData);
});
```

---

## ✅ Checklist for Indexer Updates

- [ ] Add `LPEvent` entity to schema
- [ ] Add handlers for Mint/Burn events
- [ ] Add `PoolDayData` entity to schema
- [ ] Add daily aggregation logic
- [ ] Add `PoolHourData` entity (optional)
- [ ] Test historical data backfill
- [ ] Update GraphQL queries in frontend

---

Let me know which entities you'd like to prioritize, and I can help with the specific Envio configuration!
