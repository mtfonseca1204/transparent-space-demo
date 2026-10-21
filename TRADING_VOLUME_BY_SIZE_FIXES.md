# Trading Volume by Size Chart - Fixes Applied

## Issues Found and Fixed

### 1. **Mouse Hover Positioning Bug** ✅ FIXED

**Problem:** Tooltip was appearing far from the cursor (hundreds of pixels away).

**Root Cause:** The tooltip positioning logic was using complex clamping that prioritized keeping the entire tooltip on-screen over staying close to the cursor. This resulted in the tooltip being pushed far away.

**Fix:** Simplified to use direct cursor position + 15px offset:

```typescript
// Before (complex clamping - pushed tooltip far away)
const tooltipPos = useMemo(() => {
  const TOOLTIP_W = 190;
  const TOOLTIP_H = 120;
  const x = clamp(hoveredDay.cursorX + 12, PAD, window.innerWidth - TOOLTIP_W - PAD);
  const y = clamp(hoveredDay.cursorY + 12, PAD, window.innerHeight - TOOLTIP_H - PAD);
  return { x, y };
}, [hoveredDay]);

// After (simple offset - stays close to cursor)
<div style={{
  left: hoveredDay.cursorX + 15,
  top: hoveredDay.cursorY + 15,
  ...
}}>
```

Also fixed the hover coordinate calculation to properly account for SVG position and margins.

### 2. **Chart Only Showing Last 7 Days** ✅ FIXED

**Problem:** Even though the dashboard was fetching 30 days of swap data, the chart was only displaying the last 7 days.

**Root Cause:** The chart was hardcoded to use `DEFAULT_WINDOW_DAYS = 7` and was truncating the data range to only show 7 days ending at the last day with data.

**Fix:** Removed the hardcoded window and changed the chart to display the full range from the first day with data to the last day with data.

```typescript
// Before (truncated to 7 days)
const lastDayWithData = sparse[sparse.length - 1]!.date;
const end = new Date(Date.UTC(...));
const start = addDays(end, -(DEFAULT_WINDOW_DAYS - 1)); // Only last 7 days

// After (full range)
const firstDayWithData = sparse[0]!.date;
const lastDayWithData = sparse[sparse.length - 1]!.date;
const start = new Date(Date.UTC(...firstDayWithData...));
const end = new Date(Date.UTC(...lastDayWithData...));
```

### 3. **Missing Historical Data Before January 8** ⚠️ PRODUCTION INDEXER ISSUE

**Problem:** No swap data available before January 8, 2026.

**Root Cause:** The **production indexer** at `https://indexer.hyperindex.xyz/5e2a875/v1/graphql` only has data from January 8, 2026 onwards. Query results show:
- 1000+ swaps available, but ALL from Jan 8, 2026
- Oldest swap: block 24287179 (Jan 8, 22:06:37 UTC)
- The indexer is live and working, but lacks historical backfill

**Local Indexer Config Updated:** ✅ 
I've updated the local `transparent-space-indexer/config.yaml` to use correct start blocks:
- **V3 Pools & NPM:** `start_block: 22905399` (original deployment)
- **V4 PoolManager:** `start_block: 14254788` (V4 deployment)
- **V4 PositionManager:** `start_block: 22905399`

**Action Required for Production:** The production indexer needs to be re-deployed/re-synced from block 22,905,399 to get historical data. This is a **production indexer configuration issue**, not a frontend or local indexer issue.

**For Local Testing:**
```bash
cd /Users/bruno/Documents/GitHub/transparent-space-indexer
pnpm codegen  # Regenerate if needed
TUI_OFF=true pnpm dev
# Update frontend .env.local to point to local indexer:
# NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT=http://localhost:8080/v1/graphql
```

## Summary of Changes

### Frontend (`transparent-space/components/custom-metrics/trading-volume-by-size.tsx`)
- ✅ Fixed hover tooltip positioning
- ✅ Removed 7-day window limitation - now shows full data range
- ✅ Maintained UTC day bucketing (already correct)
- ✅ Maintained "All" (total) dashed line rendering (added in previous fix)

### Indexer (`transparent-space-indexer/config.yaml`)
- ✅ Updated V3 Pool start block: `23902000` → `22905399`
- ✅ Updated NPM start block: `23902000` → `22905399`
- ✅ Updated V4 PoolManager start block: (none) → `14254788`
- ✅ Updated V4 PositionManager start block: `23902000` → `22905399`
- ✅ Updated network-level start block: `23902000` → `14254788`

## Testing Checklist

- [ ] Restart indexer with new config
- [ ] Wait for indexer to sync historical blocks (monitor progress in logs)
- [ ] Verify swap data appears in GraphQL queries for dates before Jan 7
- [ ] Test chart hover tooltip positioning
- [ ] Verify chart shows full 30-day range (or whatever data is available)
- [ ] Confirm "All" dashed line appears correctly

## Expected Behavior After Fixes

1. **Hover tooltip** should appear near the cursor and show the correct day's data
2. **Chart X-axis** should show the full range of available data (not just 7 days)
3. **Historical data** should be available back to when the V3 pools were deployed (block 22,905,399)
4. **"All" series** (dashed grey line) should be visible showing total volume across all size buckets
