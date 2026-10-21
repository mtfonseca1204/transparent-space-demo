# Volume Panel Update & Hydration Fix

## Changes Made

### 1. Volume Data from Indexer ✅

The indexer already provides volume data in the `Candle` entity:
- `volume0` - Token0 (WLD) volume in wei (18 decimals)
- `volume1` - Token1 (USDC) volume in smallest units (6 decimals)

**Conversion to USD:**
```typescript
const volume0 = Number(candle.volume0) / 1e18; // WLD amount
const volume1 = Number(candle.volume1) / 1e6;  // USDC amount
const avgPrice = sqrtPriceX96ToPrice(BigInt(candle.closePrice));
const volumeUSD = (volume0 * avgPrice) + volume1; // Total USD volume
```

### 2. Chart Updates (Your Changes) ✅

You added:
- **Volume Panel** - New panel showing trading volume as bars
- **Volume in Tooltip** - Displays formatted volume on hover
- **Changed ±5% to ±1%** - More realistic oracle and depth ranges

### 3. Hydration Error Fix ✅

**Problem:** Floating-point calculations produced slightly different results on server vs client, causing React hydration mismatch.

**Solution:** Round all calculated positions to 2 decimal places:
```typescript
const x = Math.round((xScale(d.timestamp) ?? 0) * 100) / 100;
const bodyTop = Math.round(yScale(Math.max(d.open, d.close)) * 100) / 100;
```

This ensures consistent values between server and client rendering.

## Data Requirements Summary

### Already Available from Indexer:
- ✅ OHLC prices (openPrice, highPrice, lowPrice, closePrice)
- ✅ Volume (volume0, volume1)
- ✅ Timestamps
- ✅ LP positions (tickLower, tickUpper, liquidity, owner)
- ✅ Tick liquidity for depth calculations

### Not Yet Indexed (Optional):
- ⚠️ Real oracle prices (currently using SMA as proxy)
- ⚠️ More granular tick-by-tick data (for very accurate depth)

## Chart Panels Overview

| Panel | Data Source | Status |
|-------|-------------|--------|
| **OHLC Candles** | `Candle.{openPrice,highPrice,lowPrice,closePrice}` | ✅ Working |
| **Volume Bars** | `Candle.{volume0,volume1}` | ✅ Working |
| **Oracle ±1% Band** | SMA of swap prices (proxy) | ✅ Working |
| **LP Position Ranges** | `LPPosition.{tickLower,tickUpper}` | ✅ Working |
| **Price Deviation** | Computed from OHLC vs SMA | ✅ Working |
| **Depth ±1%** | `TickLiquidity` aggregation | ✅ Working |

## No Additional Indexer Changes Needed! 🎉

The current indexer schema already provides all the data needed for the updated chart. The volume data was already being indexed, we just needed to:
1. Extract it from the GraphQL response
2. Convert it to USD value
3. Add it to the chart

## Testing Volume Data

To verify volume data from indexer:

```bash
curl -X POST https://indexer.dev.hyperindex.xyz/e305878/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ Candle(limit: 5, order_by: { timestamp: desc }) { timestamp volume0 volume1 closePrice } }"}' | jq .
```

Example response:
```json
{
  "timestamp": 1765416600,
  "volume0": "201269273470115743716",  // ~0.2 WLD
  "volume1": "121849720",               // ~121 USDC
  "closePrice": "61655388332189898397706"
}
```

Converted to USD:
- WLD volume: 0.2 WLD × $0.60 = $0.12
- USDC volume: $121.85
- **Total: ~$122 USD volume for that 5-min candle**

## Performance Impact

The volume calculation adds minimal overhead:
- Simple arithmetic operations
- No additional GraphQL queries needed
- Volume data already fetched with candles
- Negligible performance impact

## Future Enhancements

Consider adding:
1. **Volume-weighted average price (VWAP)** indicator
2. **Volume profile** (horizontal volume bars at price levels)
3. **Volume alerts** (notify on unusual volume spikes)
4. **Cumulative volume** over time periods


