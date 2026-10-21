# LP Activity & Vol% Fix — Frontend Bugs (Not Indexer)

The Railway indexer is returning correct data. All issues were in the frontend code — wrong data source, missing event types, and string handling bugs.

## Bug 1: LP Activity chart was empty (Solana pools)

**File:** `hooks/use-pool-metrics.ts` — `useLPEvents()`

The `useLPEvents` hook always queried **Envio GraphQL** to fetch LP events. Envio is the indexer for EVM pools only — it has zero data for Solana/Raydium pools.

```
useLPEvents() → envioClient.request(GET_LP_EVENTS_QUERY) → empty result
```

Meanwhile, the `/api/pool-data` route already correctly fetches Solana position events from Railway and maps them to the same `lpevents` format. It just wasn't being used.

**Fix:** Added a Solana check — Solana pools now fetch from `/api/pool-data`, EVM pools keep using Envio.

## Bug 2: ClosePosition events were never fetched

**File:** `app/api/pool-data/route.ts`

The Railway API request only asked for 3 event types:

```
event_types[]: ["CreatePosition", "IncreaseLiquidity", "DecreaseLiquidity"]
```

`ClosePosition` was missing. This means LP exits (positions closed entirely) were invisible in the chart — only partial withdrawals (DecreaseLiquidity) showed up.

**Fix:** Added `"ClosePosition"` to the fetch and mapped it to `"BURN"` in the event type mapping.

## Bug 3: Vol% was always 0% in LP Efficiency table

**File:** `components/dashboard/dashboard.tsx` — `lpComparisonData` memo

The volume attribution data was stored in a Map with **lowercased** keys:

```js
volumeMap.set(item.address.toLowerCase(), { volumePct, volumeUsd });
```

But the lookup used the **original-cased** address:

```js
const volumeData = volumeMap.get(wallet.owner);  // original case
```

For Solana base58 addresses (mixed case like `Hx3tcoWpKvuz...`), `toLowerCase()` mangles them. The lowercased key never matches the original-case lookup, so every Vol% returned `0`.

**Fix:** `volumeMap.get(wallet.owner.toLowerCase())` — both sides now use the same casing.

## Bug 4: "Largest: $199.5K by [blank]" — missing owner on some events

**File:** `app/api/pool-data/route.ts`

The owner field was extracted using nullish coalescing (`??`):

```js
owner: e.nft_owner ?? e.owner ?? ""
```

`??` only catches `null` and `undefined`. If Railway returns `nft_owner: ""` (empty string) for some events, `??` treats that as a valid value and keeps the empty string — it never falls through to `e.owner`.

**Fix:** Changed to logical OR (`||`), which also catches empty strings:

```js
owner: e.nft_owner || e.owner || ""
```

## Summary

| Bug | Symptom | Root Cause | Indexer issue? |
|-----|---------|------------|----------------|
| Empty LP Activity chart | No bars, "No data" | `useLPEvents` queried Envio instead of Railway for Solana | No — wrong data source in frontend |
| No exit events | Only partial withdrawals shown | `ClosePosition` not in `event_types[]` request | No — frontend omission |
| Vol% always 0% | LP Efficiency table shows 0% for all | Case mismatch in Map key vs lookup | No — frontend string casing bug |
| Missing owner after "by" | "Largest: $199.5K by [blank]" | `??` doesn't catch empty strings from Railway | Partial — Railway returns `""` instead of omitting field, but frontend should handle it |
