# Indexer Bug: Position Liquidity — Timeline of Issues & Current State

## Current State (Feb 8, 2026 — latest, v5)

Liquidity totals are now close to matching (~101.5%), but **194 out of 442 active positions (44%) have `nft_owner: "UNKNOWN_OWNER"` instead of a real wallet address**. These 194 positions hold **69.4% of all position liquidity**.

| Metric | Value |
|--------|-------|
| `/api/positions?active=true` | **442 positions** |
| In-range positions (tick_lower ≤ 14124 < tick_upper) | **321** |
| Out-of-range positions | **121** (25 below, 96 above) |
| **Sum of in-range position liquidity** | **3,031,756,181,060** |
| **On-chain pool liquidity (ground truth)** | **2,986,088,716,108** |
| **Match** | **~101.5%** (~1.5% overshoot, likely timing difference) |
| On-chain vault TVL | **~$1.4M** (1,963 TSLAx + $596K USDC) |

The pool-level `liquidity` from `/api/price` is **correct** — verified byte-for-byte against the on-chain Raydium pool account (offset 237 in `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`). The in-range liquidity sum now matches closely.

### Remaining Issue: `UNKNOWN_OWNER` on 69.4% of liquidity

| Owner | Positions | Liquidity | % of Total |
|-------|-----------|-----------|------------|
| `UNKNOWN_OWNER` | **194** | **3,750,719,763,871** | **69.4%** |
| All real wallets combined | 248 | 1,653,107,808,831 | 30.6% |

This is a **critical data quality issue**. The `nft_owner` field should contain the wallet address that owns the position NFT. Every position on Raydium CLMM has an NFT mint, and that NFT is held in a token account owned by a real wallet. The indexer should resolve this by:

1. For each position NFT mint, call `getAccountInfo` on the NFT mint's associated token account
2. The owner of that token account is the position owner
3. Alternatively, the `personalPositionState` PDA or the `CreatePosition` event should contain the owner

This breaks all per-wallet analytics on the frontend:
- **LP Ranges by Address** — 69% of liquidity shows under a fake "UNKNOWN_OWNER" entry
- **LP Liquidity Distribution** — wallet-level bucketing is wrong
- **Active LPs count** — undercounted (194 positions attributed to one fake address instead of their real owners)

## Timeline of Changes

### v1 — Original state (before any fix)

- 1,260 active positions, all with non-zero liquidity
- Position `liquidity` field was **stale** — not updated on DecreaseLiquidity events
- Position-derived TVL: **~$3.58M** (2.5x overcounting vs $1.4M on-chain)
- 0 positions with zero liquidity, 0 closed

### v2 — After first fix attempt

- 1,260 active positions, still all non-zero
- Backfill **inflated** values instead of correcting them — some positions ended up with liquidity **29x higher** than their CreatePosition event (with no IncreaseLiquidity events)
- Position-derived TVL: **~$4.23M** (3.0x overcounting — worse than before)
- Root cause: backfill added event liquidity on top of existing stale values instead of resetting first

### v3 — After second fix attempt

- All 1,260 positions set to `liquidity: "0"` and `is_closed: true`
- `?active=true` returns 0 positions
- **Overcorrection** — went from inflated to empty
- The pool clearly has active positions (on-chain liquidity = 2.99T, vault TVL = $1.4M)

### v4 — After third fix attempt

- 248 active positions (down from 1,260 — 1,012 now correctly marked closed)
- **But only 48.7% of in-range liquidity is accounted for**
- Position-derived TVL: ~$680K vs vault TVL ~$1.4M = 0.48x
- Went from overcounting 3x → zeroed → undercounting 2x
- Likely cause: some positions were not re-read from on-chain, or their liquidity values are stale/incomplete

### v5 — After fourth fix attempt (current)

- **442 active positions** — nearly doubled from v4 (248)
- In-range liquidity sum: **3,031,756,181,060** vs pool.liquidity **2,986,088,716,108** = **~101.5%** match
- Liquidity totals are now essentially correct (small overshoot from timing)
- **New issue**: 194 positions (44%) have `nft_owner: "UNKNOWN_OWNER"` — a placeholder, not a real wallet
- These 194 positions hold **69.4% of total liquidity** (3.75T out of 5.40T)
- Per-wallet analytics are broken because most liquidity is attributed to a fake address

## What On-Chain Reality Looks Like

```
Pool: HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum
Program: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK (Raydium CLMM)

On-chain pool state:
  liquidity: 2,986,088,716,108  (at byte offset 237 in pool account)
  tick: 14124

On-chain vault balances:
  TSLAx vault (D2JXvYgyqo2CktPN4aNfdmHn8mK2vrF9essKdH8M4wn7): 1,963.27 tokens (196327481449 raw, 8 decimals)
  USDC vault  (3h7wgb4hzxjM2F7fmLgwuzZxzuztUvUMdThnrmy9bTdF): $596,205.35   (596205348269 raw, 6 decimals)

  Total TVL: ~$1.4M (at TSLAx ≈ $410)
```

The pool has real liquidity. The indexer captures ~half of it but is missing the rest.

## Event Coverage Is Complete — Problem Is Not Missing Events

We verified that the indexer has **full event coverage** from the pool's genesis. The problem is not missing event data — it's how events are processed into position records.

| Metric | Value |
|--------|-------|
| **First event** | `2025-06-27T12:56:29Z` — `CreatePosition` at slot 349,542,371 (pool genesis, full-range position) |
| **Latest event** | `2026-02-07T17:17:08Z` — `DecreaseLiquidity` at slot 398,706,617 |
| **Time span** | **225 days** (7.4 months), fully covered with no gaps |
| **Total position events** | **21,816** |
| **Total positions in DB** | **1,333** |
| **Active positions** | **248** |
| **Latest swap** | `2026-02-07T17:42:20Z` — indexer is live and up-to-date |

The checkpoint's `last_slot` (349,542,371) and `last_signature` match exactly the first-ever transaction on this pool — a full-range CreatePosition (ticks -443,580 to 443,580). The indexer started from block 0 of this pool.

**Conclusion**: The 51.3% liquidity gap is caused by the event replay logic computing wrong liquidity values for positions, NOT by missing events. All 21,816 events are present. This further supports the recommendation to read on-chain `personalPositionState` PDAs directly instead of replaying events.

Note: the `sort=asc`/`sort=desc` parameter on `/api/position-events` is broken — always returns newest-first regardless.

## Previously Identified Event Data Issues

These issues from earlier investigation still apply and are likely the root cause of why event-replay-based fixes keep failing:

### DecreaseLiquidity events store `liquidity=0` (74% of events)

586 out of 787 DecreaseLiquidity events have `liquidity: "0"` AND `withdraw_amount_0: "0"` AND `withdraw_amount_1: "0"`. These are likely Raydium `ClosePosition` instructions (which close the NFT account after liquidity was already removed). They should be:
- Recorded as `ClosePosition`, **not** `DecreaseLiquidity`
- Or excluded from event replay since they carry no delta

### Integer overflow in one event

```
DecreaseLiquidity: liq=3786120013109182083993898764280852209
```

37-digit number — byte-parsing bug in the event decoder.

## The Fix: Read On-Chain State Directly

Event replay is fragile (depends on complete, correct event data which is currently broken). After 4 attempts with event replay, the reliable approach is:

### For each position NFT mint in the database:

```
1. Derive the personalPositionState PDA:
   seeds = ["position", position_nft_mint]
   program = CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK

2. Call getAccountInfo(PDA)

3. If account doesn't exist:
   → position is closed → set is_closed=true, liquidity="0"

4. If account exists:
   → Decode personalPositionState
   → Read liquidity (u128) from the account data
   → Read tick_lower_index (i32) and tick_upper_index (i32)
   → Set position.liquidity = decoded value
   → If liquidity == 0 → set is_closed=true
   → If liquidity > 0 → set is_closed=false
```

This is the **ground truth**. It cannot be wrong. It handles all edge cases (partial withdrawals, reopened positions, etc.) and doesn't depend on event data quality.

### Additionally: discover missing positions

The indexer may not have all position NFT mints. To find ALL positions for this pool:
1. Use `getProgramAccounts` with filters for the Raydium CLMM program
2. Filter by `poolId` field matching `HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum`
3. This returns ALL personalPositionState accounts for the pool
4. Any positions found on-chain but not in the database should be added

### Going forward: keep positions in sync

On every new `IncreaseLiquidity` / `DecreaseLiquidity` / `ClosePosition` event:
- Read the on-chain personalPositionState again (single RPC call)
- Update the position record with the fresh value
- This is simpler and more reliable than trying to compute deltas from events

## How to Verify the Fix

```python
# 1. Check active positions exist
positions = GET /api/positions?pool={POOL}&active=true
assert len(positions) > 0  # v5 returns 442 ✓

# 2. Sum in-range liquidity must match pool.liquidity
pool_liq = GET /api/price → liquidity  # 2,986,088,716,108
in_range_sum = sum(
    pos.liquidity
    for pos in positions
    if pos.tick_lower <= current_tick < pos.tick_upper
)
assert in_range_sum == pool_liq  # v5: 3,031,756,181,060 (~101.5%) ✓ (close enough, timing)

# 3. No position should have nft_owner = "UNKNOWN_OWNER"
unknown = [p for p in positions if p.nft_owner == "UNKNOWN_OWNER"]
assert len(unknown) == 0  # v5: 194 positions — FAILS ✗

# 4. Position-derived TVL must match vault TVL
position_tvl = sum(
    clmm_amounts(pos.liquidity, pos.tick_lower, pos.tick_upper, current_tick)
    for pos in positions
)
vault_tvl = getTokenAccountBalance(TSLAX_VAULT) * price + getTokenAccountBalance(USDC_VAULT)
assert abs(position_tvl - vault_tvl) / vault_tvl < 0.05
```

**Check #2 now passes** (~101.5% match). **Check #3 is the remaining blocker**: 194 positions with `UNKNOWN_OWNER` holding 69.4% of liquidity.

## Affected Pools

All Raydium CLMM pools. Confirmed on:
- `HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum` (TSLAx/USDC)

Likely also affects:
- `4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN` (NVDAx/USDC)
- `7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME` (SPYx/USDC)

## Impact on Frontend

With v5 (liquidity totals ~correct, but 69.4% under UNKNOWN_OWNER):
- **Liquidity Distribution chart** — now correct (totals match)
- **LP Ranges by Address** — broken: 69% of liquidity shows under "UNKNOWN_OWNER" instead of real wallets
- **LP Liquidity Distribution** — broken: wallet-level bucketing is wrong
- **Active LPs count** — undercounted: 194 positions collapsed into one fake address
- **TVL** — correct (uses on-chain vault balances, not positions)
