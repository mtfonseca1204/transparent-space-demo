# LP Address Activity Chart - Real Data Implementation

This document explains how the LP Address Activity chart has been updated to use real on-chain historical data via the Envio indexer.

## Overview

The chart now supports two modes:
1. **Mock Data Mode** (default) - Uses generated data based on current pool price
2. **Real Data Mode** - Queries historical on-chain data from the Envio indexer

## Architecture

```
Worldchain (Uniswap V3 Pool)
         ↓ (events)
   Envio HyperIndex
         ↓ (indexes)
     PostgreSQL
         ↓ (GraphQL API)
   Next.js Frontend
         ↓ (renders)
  LP Activity Chart
```

## Components

### 1. Indexer (`/indexer`)

**Purpose:** Index Uniswap V3 pool events and aggregate data

**Key Files:**
- `schema.graphql` - Defines entities (Candle, LPPosition, TickLiquidity)
- `src/EventHandlers.ts` - Processes events and updates entities
- `config.yaml` - Configures which contracts/events to index

**Entities:**
- `Candle` - 5-minute OHLC price candles
- `LPPosition` - Aggregated LP positions by owner
- `TickLiquidity` - Tick-by-tick liquidity for depth calculations
- `UniswapV3Pool_*` - Raw event logs with timestamps

### 2. GraphQL Client (`/lib/envio-client.ts`)

**Purpose:** Connect to Envio's GraphQL API

**Features:**
- Pre-defined queries for candles, LP positions, tick liquidity
- Helper functions to convert sqrtPriceX96 to human-readable prices
- Type definitions for query results

### 3. Data Hook (`/hooks/use-lp-historical-data.ts`)

**Purpose:** Fetch and transform indexed data for the chart

**Features:**
- Time range selection (1h, 4h, 1d, 1w)
- Market maker address filtering
- Transforms raw indexed data into chart-ready format
- Calculates depth from tick liquidity
- Generates oracle price approximation (SMA)

**Returns:**
```typescript
{
  chartData: TradingChartData | null,
  lpRanges: Array<{ upper, lower, owner }>,
  isLoading: boolean,
  error: Error | null
}
```

### 4. Chart Component (`/components/custom-metrics/lp-address-activity.tsx`)

**Updates:**
- Removed hardcoded `LP_RANGE` constant
- Added `lpRanges` prop to accept dynamic LP positions
- Supports multiple LP ranges per market maker
- Shows LP range info in tooltip

### 5. Dashboard (`/components/dashboard/dashboard.tsx`)

**New Features:**
- Toggle between mock and real data
- Market maker address input field
- Time range selector (1h, 4h, 1d, 1w)
- Shows LP position count when address is entered
- Loading states for historical data

## Usage

### Setup

1. **Start the Indexer:**
```bash
cd indexer
pnpm install
pnpm envio dev
```

2. **Configure Frontend:**
Create `.env.local` in project root:
```bash
NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT=http://localhost:8080/v1/graphql
```

3. **Start Frontend:**
```bash
pnpm dev
```

### Using the Chart

1. Navigate to the dashboard
2. Find the "Market Maker Filter" section
3. Check "Use Real Data" to enable real data mode
4. (Optional) Enter a market maker address to filter LP positions
5. Select a time range (1h, 4h, 1d, 1w)
6. The chart will update with real historical data

### Example Market Maker Addresses

To test, you can use any address that has LP positions in the pool:
- Query the indexer for addresses with positions:
```graphql
query GetTopLPs {
  LPPosition(
    where: { liquidity: { _gt: "0" } }
    order_by: { liquidity: desc }
    limit: 10
  ) {
    owner
    liquidity
  }
}
```

## Data Flow

### Mock Data Mode (Default)

```
Current Pool Price (RPC)
         ↓
generateLPActivityData()
         ↓
Mock OHLC, Oracle, Depth
         ↓
      Chart
```

### Real Data Mode

```
User Input (address, timeRange)
         ↓
useLPHistoricalData() hook
         ↓
GraphQL Queries to Envio
         ↓
Transform Data
         ↓
      Chart
```

## Chart Panels Explained

### 1. OHLC Candlesticks
- **Mock:** Generated random walk around current price
- **Real:** Aggregated from actual Swap events (5-min candles)

### 2. Oracle Price Line (Purple)
- **Mock:** Smoothed version of mock price
- **Real:** Simple moving average of swap prices (proxy for oracle)
- **Future:** Index actual Chainlink/Pyth oracle updates

### 3. LP Position Range Lines (Cyan)
- **Mock:** Hardcoded range (0.625 - 0.655)
- **Real:** Dynamic ranges from market maker's actual LP positions
- Supports multiple positions per address

### 4. Price Deviation Panel
- **Mock:** Computed from mock data
- **Real:** Deviation of swap price from SMA oracle proxy

### 5. Depth Panel (Bid/Ask)
- **Mock:** Random values
- **Real:** Calculated from tick liquidity at ±5% from current price
- Uses `TickLiquidity` entity to sum liquidity in price ranges

## Performance Considerations

### Indexer
- Candle aggregation happens on-write (in event handlers)
- No expensive queries needed at read time
- 5-minute intervals balance granularity vs storage

### Frontend
- React Query caching (30s for candles, 60s for positions)
- Only fetches data when "Use Real Data" is enabled
- Time range limits query size

### GraphQL
- Indexed queries on timestamp, owner, pool
- Limit results to prevent large payloads
- Consider pagination for very long time ranges

## Limitations & Future Improvements

### Current Limitations
1. **Oracle Price** - Uses SMA as proxy, not real oracle data
2. **Depth Calculation** - Simplified, doesn't account for all Uniswap V3 complexities
3. **No Historical Snapshots** - Can't query "what were all positions at time T"

### Future Improvements
1. **Add Chainlink Oracle Indexing**
   - Index `AnswerUpdated` events
   - Show real oracle price vs pool price deviation

2. **Historical Snapshots**
   - Store position state at regular intervals
   - Enable time-travel queries

3. **More Aggregations**
   - Hourly/daily candles for longer time ranges
   - TVL over time
   - Fee revenue per position

4. **Advanced Depth**
   - Full tick-by-tick liquidity distribution
   - Visualize liquidity concentration

5. **Multi-Pool Support**
   - Index multiple pools
   - Compare market maker activity across pools

## Troubleshooting

### Chart shows "Loading..." forever
- Check indexer is running: `curl http://localhost:8080/v1/graphql`
- Verify `NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT` is set
- Check browser console for errors

### No LP positions found for address
- Ensure address has active positions (liquidity > 0)
- Check address is checksummed correctly (case-sensitive)
- Query indexer directly to verify data exists

### Indexer not syncing
- Check `indexer/` logs for errors
- Verify database connection
- Ensure RPC endpoint is accessible

### Chart data looks wrong
- Verify sqrtPriceX96 conversion is correct
- Check token decimals (WLD=18, USDC=6)
- Ensure candle aggregation logic handles edge cases

## Testing

### Manual Testing
1. Start indexer and wait for sync
2. Enable "Use Real Data" in dashboard
3. Enter a known LP address
4. Verify chart shows correct price ranges
5. Switch time ranges and verify data updates

### Query Testing
Use GraphQL playground at `http://localhost:8080/v1/graphql`:
- Test candle queries
- Verify LP position filtering
- Check tick liquidity calculations

## Deployment

### Indexer
- Deploy to server with PostgreSQL access
- Or use Envio's hosted service
- Set up monitoring and alerts

### Frontend
- Set `NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT` to production URL
- Ensure CORS is configured on indexer
- Consider CDN for static assets

## Resources

- [Envio Documentation](https://docs.envio.dev)
- [Uniswap V3 Whitepaper](https://uniswap.org/whitepaper-v3.pdf)
- [Worldchain Explorer](https://worldscan.org)
