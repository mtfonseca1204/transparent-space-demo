# Solana Position TVL Inflation Bug

## Problem

On Solana/Raydium pools (e.g. NVDAx/USDC), individual position TVL values in the "Active LPs" table are wildly inflated compared to the actual pool TVL. Example: the pool shows **$778K total liquidity** (correct), but the top LP position shows **$1.36M TVL** — nearly 2x the entire pool.

The $778K pool TVL is accurate. The per-position TVL numbers are wrong.

## Root Cause: Uniswap V3 Math Applied to Raydium Liquidity Units

The position TVL calculation reuses Uniswap V3's `amountsForPosition()` formula for Raydium CLMM positions, but **Raydium's `liquidity` field is not in the same units as Uniswap V3's `L` parameter**.

### How pool TVL is calculated (correct)

In `app/api/pool/[address]/route.ts` (lines 103–112), `handleRaydiumPool()` queries **live on-chain SPL vault balances** via `getTokenAccountBalance()`:

```
token0Balance = vault0.amount / 10^decimals
token1Balance = vault1.amount / 10^decimals
TVL = token0Balance * token0UsdPrice + token1Balance * token1UsdPrice
```

This is a direct read of what's actually in the pool vaults. Always accurate.

### How per-position TVL is calculated (broken)

In `components/dashboard/dashboard.tsx` (lines 752–762), the `lpUsdByOwner` memo does:

```typescript
const { amount0, amount1 } = amountsForPosition({
  liquidity: BigInt(p.liquidity),   // <-- Raydium liquidity units from Railway
  tickLower: p.tickLower,
  tickUpper: p.tickUpper,
  sqrtPriceX96,                     // <-- converted from Raydium's sqrtPriceX64
});
```

`amountsForPosition()` lives in `lib/uniswap-v3-math.ts` and implements the standard Uniswap V3 formulas:

- `amount0 = L * 2^96 * (sqrtB - sqrtP) / (sqrtB * sqrtP)`
- `amount1 = L * (sqrtP - sqrtA) / 2^96`

These formulas expect `L` to be Uniswap V3's internal liquidity unit. Raydium CLMM uses a different internal representation for liquidity — the raw integer from `SolanaPositionResponse.liquidity` is **not equivalent** to Uniswap V3's `L`.

### What the code converts vs. what it doesn't

`lib/raydium-math.ts` has a conversion for the **price format**:

```typescript
// sqrtPriceX64 (Raydium Q64.64) → sqrtPriceX96 (Uniswap Q64.96)
sqrtPriceX96 = sqrtPriceX64 * 2^32
```

This conversion is applied in `app/api/pool/[address]/route.ts:131` when building the pool data. So `sqrtPriceX96` in poolData is correct.

But there is **no equivalent conversion for the `liquidity` field**. The raw Raydium liquidity string from Railway's `/api/positions` endpoint is passed directly as a bigint into the Uniswap V3 formulas. This produces token amounts that don't correspond to reality.

## Data Flow Summary

```
Pool TVL ($778K) — CORRECT
  └── Solana RPC → getTokenAccountBalance(vault0, vault1) → real token amounts → USD

Position TVL ($1.36M) — WRONG
  └── Railway API → /api/positions → SolanaPositionResponse.liquidity (Raydium units)
      └── BigInt(p.liquidity)  ← no unit conversion
          └── amountsForPosition()  ← Uniswap V3 math expecting Uniswap V3 L
              └── amount0, amount1  ← inflated token amounts
                  └── * usdPrices → inflated USD
```

## Why the Phase 2 Fallback Works Correctly

The `lpUsdByOwner` memo has a Phase 2 fallback (lines 771–787) for LPs that lack position-level data:

```typescript
const share = Number((ownerLiq * 1_000_000n) / totalLPLiquidity) / 1_000_000;
map.set(ownerLc, poolTvlUsd * share);
```

This distributes the **real pool TVL** proportionally by each LP's share of total liquidity. Since it's a ratio (`ownerLiq / totalLPLiquidity`), the Raydium-vs-Uniswap unit mismatch cancels out — both numerator and denominator use the same Raydium units. The result is correct.

However, Phase 2 only runs for LPs that **don't** have position-level data. LPs that do have positions go through Phase 1 (the broken Uniswap V3 math path).

## Affected Components

Everything downstream of `lpUsdByOwner` Phase 1:
- **Active LPs table** — TVL column shows inflated values
- **LP Position Activity** — USD values derived from position liquidity
- **LP Liquidity Distribution** — proportions are distorted
- Any chart/metric that uses per-position USD amounts

## Fix Options

### Option 1: Use the Phase 2 proportional approach for all Solana positions (quickest)

For Solana pools, skip Phase 1 entirely and always distribute pool TVL proportionally. This gives accurate total USD per LP. Downside: loses per-position granularity (all positions for the same owner are lumped together).

### Option 2: Write Raydium-native `amountsForPosition`

Implement the Raydium CLMM equivalent of `amountsForPosition()` in `lib/raydium-math.ts` that correctly handles Raydium's liquidity units and `sqrtPriceX64` natively, without converting through Uniswap V3 formats. The Raydium CLMM math is similar to Uniswap V3 but the fixed-point scaling is different (Q64.64 vs Q64.96), which affects how `L` maps to token amounts.

### Option 3: Derive position token amounts from events

Use `deposit_amount_0/1` and `withdraw_amount_0/1` from `SolanaPositionEventResponse` to compute net deposited amounts per position, instead of re-deriving from the liquidity field. This avoids the math conversion problem entirely but requires summing event history.

## Files Involved

| File | Role |
|------|------|
| `lib/uniswap-v3-math.ts` | `amountsForPosition()` — Uniswap V3 formulas being misapplied |
| `lib/raydium-math.ts` | Has `sqrtPriceX64ToX96()` but no liquidity conversion |
| `lib/solana-indexer-client.ts` | `SolanaPositionResponse.liquidity` — raw Raydium units |
| `app/api/pool-data/route.ts:510-527` | Maps Raydium positions with no liquidity conversion |
| `app/api/pool/[address]/route.ts:103-112` | Pool TVL from on-chain vaults (correct) |
| `components/dashboard/dashboard.tsx:736-791` | `lpUsdByOwner` — Phase 1 (broken) + Phase 2 (correct fallback) |
