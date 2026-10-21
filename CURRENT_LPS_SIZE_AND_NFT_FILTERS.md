# Current LPs Size + Position(NFT) Chip Filters (Implementation Notes for Indexer Fix)

This doc explains **how the UI populates**:

- **“Current LPs” / “Size”** (the “Current LPs Size” card/table on the dashboard)
- The **filters rendered as chips** (position/NFT ids), and how they affect calculations

The goal is to help the indexer dev fix **Uniswap v4** position/owner data so these UI features work correctly.

---

## What the UI is doing (high-level)

### Current LPs Size (table)

1. Fetch a list of current LP owners (aggregated per owner).
2. For the **top 8** owners, fetch their **tokenId-level positions** (tickLower, tickUpper, liquidity).
3. Compute each owner’s **USD size** by:
   - converting each position’s liquidity + ticks into amounts of token0/token1 at current pool price, then
   - valuing token0 as `token0Amount * currentPrice` and token1 as `token1Amount` (assumes token1 is USD-like, e.g. USDC)
4. Display the table **sorted by computed USD size**, falling back to “liquidity share × pool TVL approximation” if needed.

### Position “NFT id chips” (filters)

1. When an LP owner is selected, fetch **all positions for that owner**.
2. Render one **chip per position**, labeled as `#${tokenId}`.
3. Clicking a chip **toggles it excluded/included**.
4. Downstream widgets (custom metrics + LP activity overlays) use only the **active positions** (included chips).

---

## Where this lives in code

### Dashboard page (UI wiring)

- `components/dashboard/dashboard.tsx`
  - “Current LPs” section (table) and “Filters” section (chips).
  - Selection state:
    - `selectedOwner` → the currently selected LP owner
    - `excludedPositionIds: Set<string>` → position ids that are “deselected” via chips
    - `activePositions` → `selectedPositions` filtered by `excludedPositionIds`

### Data hooks (Envio GraphQL)

- `hooks/use-lp-historical-data.ts`
  - `useAllLPPositions(poolKey)` → aggregated owners list for “Current LPs”
  - `usePositionsByOwner({ poolAddress, owner })` → tokenId-level positions for the selected owner (chips)
  - `usePositionsForOwners({ poolAddress, owners })` → tokenId-level positions for the top owners (USD sizing)

### GraphQL client + canonical queries

- `lib/envio-client.ts`
  - `GET_OWNER_POSITION_AGGREGATES_QUERY` (preferred for “Current LPs”)
  - `GET_POSITIONS_BY_OWNER_QUERY` (canonical tokenId-level positions, **v3**)

---

## “Current LPs Size”: exact computation path

### Step 1: Get owners list (aggregates)

Hook: `useAllLPPositions(poolKey)` in `hooks/use-lp-historical-data.ts`

Preferred query: `GET_OWNER_POSITION_AGGREGATES_QUERY` from `lib/envio-client.ts`

Expected fields per row:

- `OwnerPositionAggregate.id`
- `OwnerPositionAggregate.pool`
- `OwnerPositionAggregate.owner` (**must be the end-owner address, lowercased**)
- `OwnerPositionAggregate.liquidityTotal` (string BigInt)
- `OwnerPositionAggregate.updatedAt`

Fallback (legacy) used only if aggregates are empty:

- Querying `LPPosition(where: { pool, liquidity > 0 })` then grouping by `owner` client-side.
- The code comments explicitly warn this legacy data may reflect the **NPM contract as owner** (wrong for UI selection).

### Step 2: Pick top owners

In `components/dashboard/dashboard.tsx`:

- `topLPOwners = allLPPositions.slice(0, 8).map(lp => lp.owner)`

### Step 3: Fetch tokenId-level positions for those owners

Hook: `usePositionsForOwners({ poolAddress: poolKey, owners: topLPOwners, limit: 500 })`

#### v3 path (canonical)

GraphQL: `GET_POSITIONS_BY_OWNER_QUERY` in `lib/envio-client.ts`

Entity: `Position`

Expected fields:

- `Position.id`
- `Position.tokenId` (**the NFT token id**)
- `Position.owner` (**NFT owner / end-user address**)
- `Position.pool`
- `Position.tickLower`, `Position.tickUpper`
- `Position.liquidity`
- `Position.updatedAt`

#### v4 path (current workaround in UI)

The hook checks `isV4PoolKey(poolAddress)` and **does not query `Position`**.

Instead it queries `LPPosition` rows and maps them into `PositionData` with:

- `PositionData.id = LPPosition.id`
- `PositionData.tokenId = LPPosition.id` (**synthetic, not a real NFT id**)
- `PositionData.owner = LPPosition.owner`
- `tickLower`, `tickUpper`, `liquidity`, `updatedAt` copied
- `fee/token0/token1 = null`

This is the core reason the “NFT id chips” and position identity for v4 can look wrong: **we’re using `LPPosition.id` as `tokenId`.**

### Step 4: Compute per-owner USD size

In `components/dashboard/dashboard.tsx`:

- The code builds `lpUsdByOwner: Map<ownerLowercase, usdNumber>`.
- For each position:
  - Convert liquidity + ticks → amounts:
    - `amountsForPosition({ liquidity, tickLower, tickUpper, sqrtPriceX96 })` (from `lib/uniswap-v3-math`)
  - Convert BigInt amounts to numbers using decimals:
    - `bigintToApproxNumber(amount0, token0Decimals)`
    - `bigintToApproxNumber(amount1, token1Decimals)`
  - Value in “token1 units”:
    - `usdValue = amt0 * currentPrice + amt1`

Important: This requires `poolData.sqrtPriceX96`, `poolData.currentPrice`, and token decimals. Those come from `useUnifiedPoolData(poolKey)`.

### Step 5: Display and sorting

For each owner row:

- If computed USD exists → display it and sort by it.
- Else fallback:
  - If per-owner positions are still loading → show `"---"`.
  - Else approximate using `formatLPSize(liquidityTotal, totalLPLiquidity, pool TVL)`:
    - estimates row share = `liquidityTotal / totalLPLiquidity`
    - estimates pool TVL in token1 as `token0Balance*currentPrice + token1Balance`
    - displays `share * tvlToken1` as compact number

Note on v4 pool balances:

- The UI has a dedicated comment: **v4 pools don’t have a per-pool contract address**, so ERC20 `balanceOf(pool)` cannot be used.
- For v4 only, it tries to approximate balances from tick liquidity (`estimatePoolBalancesFromTickLiquidity`).

---

## Position “NFT id chips”: exact implementation path

### Step 1: Determine selected owner

In `components/dashboard/dashboard.tsx`:

- `selectedOwner` is set by:
  - clicking a row in Current LPs table, or
  - picking in `LPSelectorFab`, or
  - typing in the filter input.
- If `selectedOwner` is null, it defaults to the first LP owner from aggregates:
  - `effectiveSelectedOwner = selectedOwner ?? allLPPositions?.[0]?.owner ?? null`

### Step 2: Fetch positions for that owner

Hook: `usePositionsByOwner({ poolAddress: poolKey, owner: effectiveSelectedOwner, limit: 500 })`

#### v3 path (canonical)

- Uses `GET_POSITIONS_BY_OWNER_QUERY` → `Position[]`
- Chips display `#${position.tokenId}` (true NFT id)

#### v4 path (current workaround)

- Queries `LPPosition` and maps it to `PositionData` with:
  - `tokenId = id` (**synthetic**)
- Chips display `#${position.tokenId}` → effectively `#${LPPosition.id}`

### Step 3: Excluding/including positions (chip toggle)

State:

- `excludedPositionIds: Set<string>`

Logic:

- `togglePositionSelection(tokenId)` adds/removes that tokenId from the set.
- `activePositions = selectedPositions.filter(p => !excludedPositionIds.has(p.tokenId))`

Impact:

- Custom metric widgets and the LP activity overlays use **activePositions**, not the full set.

---

## What the indexer must provide (to fix Uniswap v4)

Today the UI can work “enough” for v3 because `Position.tokenId` is real and `Position.owner` is the NFT owner.
For v4, we currently fall back to `LPPosition` which **does not provide a stable, meaningful `tokenId`** in this code.

### Minimum requirements for v4 to work correctly in this UI

#### 1) Correct owner identity

- The UI assumes `owner` is the **end-user LP address** used for:
  - selecting owners (Current LPs table click)
  - querying positions by that owner
  - showing “Found N positions for this address”

If the indexer reports a contract address (hook manager / position manager / NPM-like wrapper) as `owner`,
selection and “Current LPs” will not match what users expect.

#### 2) Stable per-position identity (tokenId-equivalent)

The UI renders and toggles chips by `position.tokenId`:

- The chip label is `#${tokenId}`
- The exclusion set is keyed by `tokenId`
- The “selected positions” list is keyed by `position.id` but toggles by `position.tokenId`

For v4, the current workaround sets `tokenId = LPPosition.id`.
If `LPPosition.id` is not:

- stable over time, or
- unique per user position, or
- human-friendly / numeric,

then chips will be confusing and the exclusion toggles may behave unexpectedly.

**Indexer ask:** expose a real `tokenId`/`positionId` field for v4 positions that is:

- stable
- unique
- consistently returned by “positions by owner”

It can be a string; the UI doesn’t strictly require a number, but it prints it as `#${id}`.

#### 3) Per-position economics fields used by size calculations

For computing USD size, the UI needs, per position:

- `tickLower`, `tickUpper`
- `liquidity` (string BigInt)

And per pool:

- `sqrtPriceX96` (or an equivalent value that lets us compute current price)
- `token0Decimals`, `token1Decimals`
- `currentPrice`

If v4 indexing doesn’t produce `tickLower/tickUpper` in a v3-like sense, then either:

- the indexer needs to translate v4 position bands into equivalent tick ranges, or
- the UI needs a different math path (but today it uses v3 math for both).

---

## Quick checklist you can send to the indexer dev

- **OwnerPositionAggregate**
  - Does `owner` represent the **actual LP address**, not a manager contract?
  - Is `liquidityTotal` correct and non-zero for active LPs?
- **Positions by owner (v4)**
  - Can you return a per-position `tokenId` (or `positionId`) that is stable and unique?
  - Are `tickLower`, `tickUpper`, and `liquidity` present and correct?
- **Data consistency**
  - Do the owners returned in aggregates match the owners returned in “positions by owner”?
  - If an owner has N positions, do we reliably get the same N identifiers on every query?

---

## References (exact files)

- UI:
  - `components/dashboard/dashboard.tsx`
  - `components/dashboard/current-lps.tsx` (presentation components)
- Hooks:
  - `hooks/use-lp-historical-data.ts` (`useAllLPPositions`, `usePositionsByOwner`, `usePositionsForOwners`)
- GraphQL:
  - `lib/envio-client.ts` (queries + types)


