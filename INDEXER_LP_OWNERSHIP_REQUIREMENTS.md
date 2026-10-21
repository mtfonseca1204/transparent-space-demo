# Indexer Upgrade Requirements: Real LP Owners + Meaningful “Current LPs” Size

This document specifies the changes needed in the **Envio indexer** so the frontend “Current LPs” list shows:

- **Real LP addresses** (EOA / multisig) as the current holders of Uniswap V3 position NFTs
- A **meaningful size** per LP (not mock/always `$0`)

## Background / Problem

If the indexer derives `LPPosition.owner` from **UniswapV3Pool Mint/Burn events**, the “owner” is often **not the end-user** (commonly the **NonfungiblePositionManager (NPM)** contract). This makes the “Current LPs” list show incorrect-looking addresses and breaks any per-address sizing logic.

Also, Uniswap V3 `liquidity` is **not a token-decimal-scaled amount**, so naïvely converting it with `1e18` assumptions can produce `$0` displays.

## Goal

Index positions in a way that:

1. **Owner** equals the **current holder of the position NFT** (`tokenId`), updated via **NPM `Transfer` events**
2. Positions can be queried by **pool** with `liquidity > 0`
3. The frontend can compute or directly read a “size” per LP using:
   - raw liquidity (fallback), or
   - aggregated liquidity per owner (recommended), and ideally
   - token amounts and/or a USD approximation (nice-to-have)

---

## Data Model (Entities)

### 1) `Position` (source of truth, keyed by `tokenId`)

- **id**: `tokenId` (string)
- **tokenId**: string (duplicate of id if needed)
- **pool**: string (lowercased pool address)
- **owner**: string (lowercased EOA/multisig address)
- **tickLower**: int
- **tickUpper**: int
- **liquidity**: string (0 when inactive)
- **updatedAt**: int (unix seconds)

Optional (recommended):
- **fee**: int
- **token0**: string (lowercased address)
- **token1**: string (lowercased address)
- **amount0** / **amount1**: string (if you track totals, see below)

### 2) `OwnerPositionAggregate` (recommended for fast “Current LPs”)

Aggregate across positions for a given `pool` + `owner`.

- **id**: `${pool}-${owner}` (both lowercased)
- **pool**: string
- **owner**: string
- **liquidityTotal**: string (sum of `Position.liquidity` for active positions)
- **updatedAt**: int

Optional:
- **amount0Total**: string
- **amount1Total**: string
- **tvlUsdApprox**: string (if computed in-indexer)

---

## Contracts & Events to Index

### NonfungiblePositionManager (NPM) — Required

#### A) Ownership tracking (critical)

- **`Transfer(from, to, tokenId)`**
  - Update `Position.owner = to`
  - Normalize: store `to.toLowerCase()`
  - If `to` is zero-address (burn), mark inactive (liquidity = 0)

#### B) Liquidity and tick range updates (recommended)

- **`IncreaseLiquidity(tokenId, liquidity, amount0, amount1)`**
  - Update `Position.liquidity` from event / recompute from `positions(tokenId)`
  - Optionally accumulate `amount0/amount1` deltas for per-owner amounts

- **`DecreaseLiquidity(tokenId, liquidity, amount0, amount1)`**
  - Update `Position.liquidity` from event / recompute from `positions(tokenId)`
  - Optionally accumulate `amount0/amount1` deltas

- **`Burn(tokenId)`**
  - Set `Position.liquidity = "0"` (or `active=false`)

### Pool identification (required)

To connect a `tokenId` to the target pool:

- Use `NPM.positions(tokenId)` to read at least:
  - `token0`, `token1`, `fee`, `tickLower`, `tickUpper`, `liquidity`
- Determine whether it belongs to the tracked pool by:
  - Comparing `(token0, token1, fee)` to the target pool config, **or**
  - Computing/deriving the pool address via factory rules (if available in your stack)

Store:
- `pool` as a **lowercased** address string
- `owner` as a **lowercased** address string

---

## Write-time Aggregation (Recommended)

Maintain `OwnerPositionAggregate` whenever any of these change:

- Ownership change (`Transfer`)
- Liquidity change (`IncreaseLiquidity`, `DecreaseLiquidity`, `Burn`)

Minimum approach:
- Recompute aggregates from all active `Position` rows for a given owner+pool.

More efficient approach:
- Apply deltas:
  - On `Transfer`: subtract position liquidity from `from`, add to `to`
  - On liquidity changes: add/subtract deltas for that owner

---

## GraphQL Queries Needed by Frontend

### A) Top LPs (aggregated, preferred)

```graphql
query GetTopLPs($pool: String!, $limit: Int!) {
  OwnerPositionAggregate(
    where: { pool: { _eq: $pool }, liquidityTotal: { _gt: "0" } }
    order_by: { liquidityTotal: desc }
    limit: $limit
  ) {
    owner
    liquidityTotal
    amount0Total
    amount1Total
    tvlUsdApprox
    updatedAt
  }
}
```

### B) Active positions (fallback)

```graphql
query GetPositions($pool: String!, $limit: Int!) {
  Position(
    where: { pool: { _eq: $pool }, liquidity: { _gt: "0" } }
    order_by: { liquidity: desc }
    limit: $limit
  ) {
    tokenId
    owner
    tickLower
    tickUpper
    liquidity
    updatedAt
  }
}
```

---

## “Size” Semantics (What we want to display)

Choose one (or support multiple):

1. **Liquidity-based** (easy, always available)
   - Show `liquidityTotal` (or per-position `liquidity`) and/or a **share of total liquidity**

2. **Token-amount-based** (preferred)
   - Track and expose `amount0Total` and `amount1Total` per owner
   - Frontend can value it using pool price

3. **USD approx** (nice-to-have)
   - Compute `tvlUsdApprox` in the indexer (requires reliable price source)

---

## Address Normalization Rules

- Persist all addresses lowercased:
  - `pool`, `owner`, `token0`, `token1`
- Ensure queries are compatible with lowercased inputs:
  - Prefer `_eq` with lowercased strings (recommended)
  - Or `_ilike` if you can’t guarantee caller normalization

---

## Acceptance Criteria

Consider this complete when:

- The “top LPs” query returns **multiple distinct EOAs/multisigs** (not mostly the NPM contract)
- A `Transfer` of a position NFT updates `Position.owner` correctly
- `IncreaseLiquidity` / `DecreaseLiquidity` updates position liquidity correctly
- Filtering by pool returns only positions for that pool
- The frontend can render a “size” that is non-zero and stable:
  - at minimum: **% share of total liquidity**
  - ideally: **token amounts** and/or **USD approx**

---

## Notes / Implementation Tips

- If you already have a legacy `LPPosition` entity keyed by (owner, tickLower, tickUpper), keep it only if it’s still useful for visualization, but **do not use it as the canonical owner** unless it’s derived from `tokenId` ownership.
- TokenId-centric indexing aligns with how Uniswap V3 positions are actually represented on-chain (NFTs).


