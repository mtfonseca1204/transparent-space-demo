# Indexer Price Bug: 10x Price Inflation on Solana Candles

## Problem

The Railway indexer computes candle prices (`price_open`, `price_close`, etc.) assuming **SPL default 9 decimals** for token0, but the xStocks token0 actually has **8 decimals**. This makes all indexed prices **10x too high**.

## Where the workaround lives

Two API routes apply `PRICE_CORRECTION = 0.1` to compensate:

- `app/api/pool-data/route.ts` line 563 — hourly candles
- `app/api/candles/route.ts` line 251 — 5-minute candles

## Why it matters

This correction factor breaks downstream calculations that need to convert the decimal price back to a tick/sqrtPriceX96 (e.g., the Slippage History chart). The corrected price produces the wrong tick, which looks up the wrong liquidity in the range map, giving bogus slippage values.

## Fix

Update the indexer to use the actual token0 decimals (8) when computing prices. Once prices come back correct, remove:

```diff
- const PRICE_CORRECTION = 0.1;
- openPrice: String(openP * PRICE_CORRECTION),
+ openPrice: String(openP),
```

in both `pool-data/route.ts` and `candles/route.ts`.
