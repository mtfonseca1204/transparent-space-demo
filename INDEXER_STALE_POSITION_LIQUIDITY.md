## Bug report: stale `Position.liquidity` causes incorrect “position chips” (e.g. tokenId `128896`)

### Summary
In the dashboard UI, under **Filters → Market Maker Address**, we render a list of “position chips” for the selected owner. Each chip shows:
- the **Uniswap V3 position NFT tokenId** (e.g. `#128896`)
- an **approx USD value** computed from the position’s current `liquidity` and the pool’s current price

We are observing that some positions shown in this chip list are **already empty on-chain (liquidity = 0)**, but they still appear in the list and/or still show a non-zero USD value.

This points to **stale indexer state**: the frontend is displaying exactly what the Envio GraphQL indexer returns for `Position.liquidity`.

---

### Where this data comes from (frontend)
The chip list is built from `selectedPositions`, which is fetched by `usePositionsByOwner()`.

- Hook: `hooks/use-lp-historical-data.ts` → `usePositionsByOwner()`
- Backend query: `lib/envio-client.ts` → `GET_POSITIONS_BY_OWNER_QUERY`

The query explicitly filters for *non-zero liquidity*:

```graphql
Position(
  where: {
    owner: { _eq: $owner }
    pool: { _eq: $pool }
    liquidity: { _gt: "0" }
  }
  order_by: { liquidity: desc }
  limit: $limit
) {
  ...PositionFields
}
```

So if a “should-be-empty” position (like tokenId `128896`) is still returned by this query, it means the indexer still has `Position.liquidity > 0` for it.

The dashboard then computes the USD value directly from that `Position.liquidity`:
- File: `components/dashboard/dashboard.tsx`
- The chip’s USD value comes from `BigInt(position.liquidity)` passed into `amountsForPosition(...)`.

There is no additional caching/aggregation in the UI that could “invent” liquidity; it is driven by the indexer response.

#### Note on “not updating” while the page is open
The query is cached client-side with React Query (`staleTime: 60_000`) and there is **no polling** (`refetchInterval` is not set). That means changes may not appear immediately unless a refetch is triggered (e.g. page refresh or window focus after the query becomes stale).

However, even with perfect refetching behavior, **an already-empty-on-chain position should not be returned at all** because the backend query filters `liquidity: { _gt: "0" }`. If it still appears, the indexer’s `Position.liquidity` is wrong/stale.

---

### Expected behavior
When a Uniswap V3 position is emptied (liquidity reduced to 0) **even if the NFT is not burned**, the indexer should update:
- `Position.liquidity = "0"` (so it no longer matches the `_gt: "0"` filter)
- `Position.updatedAt` should update accordingly
- `OwnerPositionAggregate.liquidityTotal` should reflect the reduction as well

As a result, empty positions should **disappear** from the chip list.

---

### Actual behavior
- The chip list still includes at least one tokenId that is empty on-chain (example reported: `128896`).
- The chip shows a non-zero USD value (derived from the stale `Position.liquidity`).

This implies the indexer is not updating `Position.liquidity` (and possibly owner aggregates) correctly on the events that bring liquidity to zero.

---

### Reproduction steps
1. Open the dashboard.
2. In **Filters → Market Maker Address**, set the owner address that holds/held tokenId `128896`.
3. Observe that the chip list includes `#128896` and shows a USD value.
4. Verify on-chain (NonfungiblePositionManager) that tokenId `128896` has `liquidity = 0`.
5. Query the indexer’s GraphQL directly:

```graphql
query DebugPosition($pool: String!, $owner: String!, $limit: Int!) {
  Position(
    where: { owner: { _eq: $owner }, pool: { _eq: $pool } }
    order_by: { updatedAt: desc }
    limit: $limit
  ) {
    id
    tokenId
    owner
    pool
    liquidity
    updatedAt
    tickLower
    tickUpper
  }
}
```

If `tokenId == "128896"` still returns `liquidity > "0"`, the indexer state is stale/incorrect.

---

### Likely indexer root cause
The indexer appears to miss (or incorrectly apply) one of the “liquidity goes to zero” paths:
- **`DecreaseLiquidity` to zero** (withdraw-to-zero without burn)
- **`Burn`** (if used)
- **`Transfer`** events (if the position is transferred away, the previous owner’s active set must be updated)

This repo already documents that **withdraw-to-zero without burn must count as an exit** and must be derived from NPM ownership/liquidity (not pool Mint/Burn logs). See:
- `LP_ENTRY_EXIT_INDEXER_QUESTIONS.md` (lines describing “withdraw-to-zero without burn” and “transfer-away of last active position”).

If the indexer is only updating liquidity on Mint/Burn, or not applying the final per-tokenId liquidity after multiple actions in the same tx, it can leave `Position.liquidity` stale.

---

### What the indexer should ensure
- `Position.liquidity` is updated on every relevant NPM event (increase/decrease/burn).
- When `Position.liquidity` hits 0, it must be persisted as 0 (so it drops out of the `_gt: "0"` query).
- `updatedAt` should reflect the last event timestamp that modified the position.
- If `OwnerPositionAggregate` is used, it must stay consistent with token-level positions.
- Backfill/recompute may be needed for existing stale rows (e.g. `tokenId=128896`).

---

### Frontend impact
This bug affects:
- the correctness of the **position chip list**
- the correctness of **custom metric widgets** that sum `position.liquidity` across selected positions

Even though the UI labels this section “Live Data”, it is only as accurate as the indexer’s `Position` table.

---

## Indexer fix (implemented)
The indexer dev implemented a fix to make token-level liquidity **idempotent** and prevent drift/stale values.

### Root cause (confirmed)
`Position.liquidity` could drift/stay stale because it was previously updated via **event deltas** (increment/decrement). If a tokenId is fully withdrawn (liquidity → 0) and not burned, the indexer could still have `Position.liquidity > 0`, so the frontend query `liquidity: { _gt: "0" }` would incorrectly keep returning it.

### Fix summary
- In `src/EventHandlers.ts`, the `NonfungiblePositionManager.IncreaseLiquidity` and `NonfungiblePositionManager.DecreaseLiquidity` handlers now set `Position.liquidity` from the on-chain `NonfungiblePositionManager.positions(tokenId).liquidity` at the event block (via a `getNpmPositionCore` effect), instead of applying deltas.
- This makes updates idempotent and ensures liquidity hits/stays **exactly 0** when emptied.

### Aggregates consistency
`OwnerPositionAggregate.liquidityTotal` is updated using the diff \(nextLiquidity - prevLiquidity\) so owner totals remain consistent with per-tokenId liquidity.

### Codegen note
Indexer dev ran `pnpm codegen` to sync generated types with `schema.graphql` after a brief mismatch; **no schema changes** were required.

---

## Deploy/backfill expectations
- The fix takes effect once the indexer has replayed past the tx where a position is withdrawn to zero (example tokenId `128896`), or after a backfill/reindex.
- After replay/backfill, positions that are empty on-chain should drop out of the GraphQL filter `liquidity: { _gt: "0" }` and disappear from the chip list.

---

## Verification checklist (post-deploy)
1. Identify the owner address that previously showed the stale chip (e.g. the owner associated with tokenId `128896`).  
2. Run the GraphQL debug query (see above) and confirm the affected tokenId now returns `liquidity = "0"` (or is not returned by the `_gt: "0"` query).
3. Refresh the dashboard and confirm the chip for that tokenId is gone.
