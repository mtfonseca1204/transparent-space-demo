# WBTC/WETH Pool — Data Issues Report

**Last updated:** 2026-02-20

**Pool address:** `0x7c3c2a92598d6d77e57fd55c50e99af4b291f595`

## Issue 1: Price Label Inversion

### Problem

The price chart label says **"WBTC per WETH"** but the value shown is ~34.36, which actually means **34.36 WETH per 1 WBTC**. The label and value are contradictory.

"WBTC per WETH" conventionally reads as "how many WBTC for 1 WETH" (≈ 0.029), not 34.36.

### Root Cause

In `components/dashboard/dashboard.tsx` line 460, the unit label is constructed as:

```ts
unitLabel: `${baseSymbol} per ${quoteSymbol}`,
// Produces: "WBTC per WETH"
```

But `currentPrice` is token1/token0 = WETH/WBTC ≈ 34.36. The label should be:

```ts
unitLabel: `${quoteSymbol} per ${baseSymbol}`,
// Would produce: "WETH per WBTC"
```

### How the display logic works

1. On-chain: `token0` = WBTC (`0x03c7054...`), `token1` = WETH (`0x4200...0006`)
2. `sqrtPriceX96ToPrice()` returns token1-per-token0 = WETH per WBTC ≈ 34.36
3. Neither WBTC nor WETH is a USD stablecoin, so `baseSymbol = token0Symbol = "WBTC"`, `quoteSymbol = token1Symbol = "WETH"`
4. For v3 pools: `invert = (baseSymbol === token1Symbol)` = `("WBTC" === "WETH")` = **false**
5. Since `invert` is false, the displayed price = `currentPrice` ≈ 34.36 (correct value)
6. But the label says "WBTC per WETH" (should say "WETH per WBTC")

### Scope

This label issue affects **all non-stablecoin v3 pairs** (WBTC/WETH, WLD/WETH, WLD/WBTC). The actual price values are correct — only the axis labels are backwards.

---

## Issue 2: Position Entity Bug — `liquidity` Field Not Accumulating

### The Numbers

| Data Source | In-range Coverage | Status |
|-------------|------------------|--------|
| **LPEvent** (reconstructed from events) | **98.7%** | Correct |
| **Position** entity (`liquidity` field) | **5.2%** | **Bug** |
| **TickLiquidity** (tick-level) | **~100%** | Correct, no per-LP attribution |

| Metric | Value |
|--------|-------|
| Pool on-chain liquidity (at current tick) | 33,838,331,841,807 |
| Reconstructed from LPEvents (in-range) | 33,399,607,389,080 (98.7%) |
| Sum of Position entity `liquidity` (in-range) | 1,765,932,816,816 (5.2%) |

### Root Cause: Position Entity Update Bug (NOT a Structural Limitation)

**Previous (incorrect) theory:** `0xec12a9f9...` was thought to operate in both "NFT mode" and "vault mode", with vault positions invisible to the indexer.

**Actual finding:** `0xec12a9f9a09f50550686363766cc153d03c27b5e` **IS the standard Uniswap V3 NonfungiblePositionManager**. Its ABI confirms only standard events:

| Event | Standard NPM? |
|-------|--------------|
| `IncreaseLiquidity(tokenId, liquidity, amount0, amount1)` | Yes |
| `DecreaseLiquidity(tokenId, liquidity, amount0, amount1)` | Yes |
| `Collect(tokenId, recipient, amount0, amount1)` | Yes |
| `Transfer(from, to, tokenId)` | Yes (ERC-721) |
| `Approval` / `ApprovalForAll` | Yes (ERC-721) |

**There is no "vault mode".** ALL 1,995 pool Mints go through the NPM and create NFT positions. The indexer's `LPEvent` entity correctly captures ALL of these with real user addresses (244 distinct owners). The bug is specifically in the **Position entity's `liquidity` field** — it fails to accumulate liquidity from multiple MINT/INCREASE events on the same NFT position.

### The Bug in Detail

When the NPM processes a new position:

1. First `MINT` event → Position entity created, `liquidity` set correctly (= liquidityDelta)
2. Subsequent `INCREASE` event → Position's `liquidity` field goes to **0** instead of accumulating
3. Subsequent `MINT` on same tick range → Position's `liquidity` field goes to **0**

Evidence from the largest LP (`0x00000a96...`):

```
Position entity: tokenId=138861 [264060,265980) liquidity=0
Position entity: tokenId=138092 [263580,265980) liquidity=0

But LPEvent reconstruction shows:
  [264060,265980) net liquidity = 12,431,630,415,137 (12.4T)
  [263580,265980) net liquidity = 17,980,424,308,006 (18.0T)
  Combined: 30.4T of IN-RANGE liquidity (89.8% of pool)
```

The `liq_field` on LPEvent records confirms the pattern: only the first MINT event gets a non-zero `liquidity` field. ALL subsequent INCREASE events show `liquidity: 0`.

### Proof: Reconstructed vs Position Entity

Reconstructing position state by aggregating `liquidityDelta` from LPEvents by `(owner, tickLower, tickUpper)`:

| Owner | Tick Range | LPEvent Net L | Position L | % of Pool |
|-------|-----------|--------------|------------|-----------|
| `0x00000a96...` | [263580, 265980) | 17,980,424,308,006 | **0** | 53.1% |
| `0x00000a96...` | [264060, 265980) | 12,431,630,415,137 | **0** | 36.7% |
| `0x86006764...` | [264480, 266940) | 1,117,096,404,361 | **0** | 3.3% |
| `0x65757203...` | [262980, 267120) | 1,081,551,749,892 | 1,081,551,749,892 | 3.2% |
| `0x75a2bb03...` | [262020, 265980) | 537,364,947,991 | 537,364,947,991 | 1.6% |
| ... | ... | ... | ... | ... |
| **Total in-range** | | **33,399,607,389,080** | **1,765,932,816,816** | **98.7% vs 5.2%** |

Positions where Position entity `liquidity` matches LPEvent reconstruction are ones that only had a single MINT (no subsequent INCREASE events).

### Who Owns This Pool

From LPEvent reconstruction, WBTC/WETH has **244 distinct LP owners**. The pool is dominated by a single automated rebalancer:

| Rank | Owner | In-range L | % of Pool | Events |
|------|-------|-----------|-----------|--------|
| 1 | `0x00000a96386d6ddea78a246abd914e59386aa688` | 30.4T | 89.8% | 257 events (constant rebalancing) |
| 2 | `0x860067643cbff935e77511307a262ebd7f27754f` | 1.1T | 3.3% | 2 events |
| 3 | `0x65757203a250bbd8e68d20ac4fb981f790ba553c` | 1.1T | 3.2% | 1 event |
| 4 | `0x75a2bb03713c61d6fc50bb82419da20d39deecce` | 537B | 1.6% | 1 event |
| | All others | 350B | 1.0% | ~240 owners |

`0x00000a96...` rebalances every 1-3 days, burning its old position and minting a new one with adjusted tick ranges. It has used 40+ different tick ranges over 7 months.

---

## How to Fix

### Option 1: Fix Position Entity in Indexer (Recommended)

This is a fix in the **Railway indexer backend** source code (the service running at `indexer-worldchain-production.up.railway.app`). The indexer has an event handler that processes `IncreaseLiquidity` events from the NonfungiblePositionManager and updates the `Position` entity in PostgreSQL. The bug is in that handler.

**The likely bug:** The handler is overwriting `position.liquidity` with a field from the event instead of accumulating:

```ts
// Current (buggy) — probably something like:
position.liquidity = event.liquidity;  // event.liquidity is 0 for INCREASE events

// Fix — accumulate the delta:
position.liquidity = position.liquidity + event.liquidityDelta;
```

The same pattern applies to `DecreaseLiquidity` events:

```ts
// For DECREASE/BURN:
position.liquidity = position.liquidity - event.liquidityDelta;
```

The LPEvent entity in the **same indexer** correctly records `liquidityDelta` for every event — so the event ingestion pipeline works fine. It's specifically the Position entity's state accumulation that's broken. The `liquidityDelta` values are available; they just aren't being applied to the Position's running total.

**Where to look:** In the indexer source, find the handler for the NPM's `IncreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)` event. Check how it updates the Position entity's `liquidity` field. It should be adding the delta, not replacing.

**What it solves:** Everything — correct Position entity data, LP leaderboard, liquidity distribution.
**Scope:** Indexer-side fix only. No frontend changes needed once Position data is correct.

### Option 2: Reconstruct Positions from LPEvents on Frontend

Since LPEvent captures 98.7% of liquidity with correct per-LP attribution, the frontend could reconstruct Position state:

```ts
// Pseudocode: reconstruct active positions from LPEvents
const positions = new Map<string, bigint>(); // key: owner-tickLower-tickUpper

for (const event of lpEvents) {
  const key = `${event.owner}-${event.tickLower}-${event.tickUpper}`;
  const current = positions.get(key) ?? 0n;
  positions.set(key, current + BigInt(event.liquidityDelta));
}

// Filter to active (positive liquidity) and in-range positions
const activeInRange = [...positions.entries()]
  .filter(([_, liq]) => liq > 0n)
  .filter(([key, _]) => {
    const [_, tl, tu] = key.split('-');
    return Number(tl) <= currentTick && currentTick < Number(tu);
  });
```

**What it solves:** Correct LP leaderboard and ownership data.
**Limitation:** Requires fetching ALL LPEvents (may be >2,000 for active pools).

### Option 3: Use TickLiquidity for Distribution Chart (Quick Fix)

For the Liquidity Distribution chart specifically, prefer `TickLiquidity` over `Position` data when Position coverage is low:

```ts
const positionCoverage = sumPositionInRangeLiquidity / poolOnChainLiquidity;
const { bars } = useLiquidityDistribution({
  allPositions: positionCoverage > 0.5 ? allPositionsFlattened : undefined,
  tickData: tickLiquidityFullRangeData,
  ...
});
```

**What it solves:** Accurate liquidity distribution chart.
**What it doesn't solve:** LP leaderboard, ownership breakdown.

---

## Impact on Dashboard

| Component | Data Source | Accurate? | Fix |
|-----------|-----------|-----------|-----|
| Liquidity Distribution (tick-based) | `TickLiquidity` | **Yes** | None needed |
| Liquidity Distribution (position-based) | `Position` | **No** — 5.2% | Option 3 (fall through to tick data) |
| LP Concentration / Ownership | `Position` | **No** — 5.2% | Option 1 or 2 |
| LP Position Sizes table | `Position` | **No** — 5.2% | Option 1 or 2 |
| Price Impact / Depth | `TickLiquidity` | **Yes** | None needed |
| Price chart | `PoolCandle` | **Yes** | None needed |

---

## Appendix: Position Entity vs LPEvent Data

### Active Position Entities (19 of 1,016)

Only positions with a single MINT event (no INCREASE) show correct liquidity:

| Token ID | Tick Range | Position L | LPEvent Net L | Match? |
|----------|-----------|-----------|--------------|--------|
| #138534 | [262980, 267120) | 1,081,551,749,892 | 1,081,551,749,892 | Yes (single MINT) |
| #130855 | [262020, 265980) | 537,364,947,991 | 537,364,947,991 | Yes (single MINT) |
| #55210 | [265920, 268980) | 21,234,340,522,936 | 21,234,340,522,936 | Yes (single MINT) |
| #138861 | [264060, 265980) | **0** | **12,431,630,415,137** | **No** (has INCREASE) |
| #138092 | [263580, 265980) | **0** | **17,980,424,308,006** | **No** (has multiple MINTs) |

### Pool-Level Mint Event Owners

All 1,995 `UniswapV3Pool_Mint` events have `owner = 0xec12a9f9...` (the standard NPM). This is normal — the NPM calls `pool.mint(address(this), ...)` and then tracks the position internally via NFTs.

### Contract Verification

`0xec12a9f9a09f50550686363766cc153d03c27b5e` verified on Worldchain block explorer:
- **46 ABI entries**: 6 events, 38 functions, 2 constructors
- Standard Uniswap V3 NonfungiblePositionManager functions: `mint`, `burn`, `increaseLiquidity`, `decreaseLiquidity`, `positions`, `ownerOf`, `tokenByIndex`, `tokenOfOwnerByIndex`
- **No custom vault events** — only standard IncreaseLiquidity/DecreaseLiquidity/Collect/Transfer
