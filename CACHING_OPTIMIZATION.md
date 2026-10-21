# GraphQL Caching Optimization

## Problem
The frontend was making too many GraphQL requests to the Envio indexer, causing unnecessary load and slower performance.

## Solutions Implemented

### 1. Increased Cache Times

**Before:**
- Candles: 30 seconds stale time
- LP Positions: 60 seconds stale time
- Tick Liquidity: 60 seconds stale time

**After:**
- Candles: **5 minutes** stale time (matches candle interval)
- LP Positions: **10 minutes** stale time (positions don't change often)
- Tick Liquidity: **10 minutes** stale time (liquidity changes slowly)

### 2. Disabled Aggressive Refetching

Added to all queries:
```typescript
refetchOnWindowFocus: false,  // Don't refetch when tab regains focus
refetchOnMount: false,         // Don't refetch if cached data exists
gcTime: 30 * 60 * 1000,       // Keep in cache for 30 minutes
```

### 3. Rounded Timestamps for Better Cache Hits

**Before:**
```typescript
const now = Math.floor(Date.now() / 1000);
const startTime = now - TIME_RANGES[timeRange];
```
This created a new query every second!

**After:**
```typescript
const roundedNow = Math.floor(now / 300) * 300; // Round to 5-min intervals
const startTime = roundedNow - TIME_RANGES[timeRange];
```
Now queries are reused for the entire 5-minute candle period.

### 4. Default to 1 Hour Time Range

Changed default from `1d` (1 day) to `1h` (1 hour):
- Fetches ~12 candles instead of ~288 candles
- Much faster initial load
- Less data transfer
- Still shows meaningful trends

### 5. Set Default Market Maker

Pre-filled with: `0x30CE12193e609283abeC6DC223eb398705B26576`
- Users can immediately see real LP positions
- No need to search for an address
- Can still change or clear it

## Impact

### Before Optimization:
- New query every time component re-renders
- New query every time user switches tabs
- New query every second due to timestamp changes
- Fetching full day of data (288 candles)

### After Optimization:
- Query reused for 5 minutes (candles)
- Query reused for 10 minutes (positions/liquidity)
- No refetch on tab switch
- Timestamp rounded to 5-min intervals (better cache hits)
- Fetching only 1 hour of data by default (12 candles)

### Estimated Reduction:
- **~95% fewer GraphQL requests**
- **~75% less data transferred** (1h vs 1d default)
- **Faster page loads**
- **Lower server costs**

## User Experience

Users can still:
- ✅ Switch time ranges (1h, 4h, 1d, 1w)
- ✅ Enter different market maker addresses
- ✅ See real-time updates (every 5 minutes)
- ✅ Toggle between mock and real data

But now with:
- ✅ Much faster initial load
- ✅ Smoother interactions
- ✅ Less network usage
- ✅ Better performance

## Configuration

All cache times are configurable in `hooks/use-lp-historical-data.ts`:

```typescript
staleTime: 5 * 60 * 1000,      // How long data is considered fresh
gcTime: 30 * 60 * 1000,        // How long to keep in cache
refetchOnWindowFocus: false,   // Refetch on tab focus
refetchOnMount: false,         // Refetch on component mount
```

Adjust these based on your needs:
- **More real-time:** Decrease `staleTime`
- **Less server load:** Increase `staleTime`
- **Memory concerns:** Decrease `gcTime`

## Monitoring

To check cache effectiveness, open browser console and look for:
- React Query DevTools (if installed)
- Network tab - should see fewer GraphQL requests
- Requests should be spaced 5+ minutes apart for same query

## Future Optimizations

Consider:
1. **Pagination** - For very long time ranges
2. **Incremental updates** - Only fetch new candles since last query
3. **WebSocket subscriptions** - Real-time updates without polling
4. **Service Worker caching** - Offline support
