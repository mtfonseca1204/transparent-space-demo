# Removal of `priceCorrection: 0.1`

## What it was

A multiplier applied to on-chain prices for xStocks tokens (TSLAx, NVDAx, SPYx) in `SOLANA_POOL_METADATA_BY_ADDRESS`. It was only used in `/api/pool/[address]/route.ts` to scale `data.price * 0.1` before returning `currentPrice`.

## Why it was removed

- The correction was only applied to the **current price** endpoint but NOT to candle prices in `/api/pool-data` or `/api/candles`, causing a 10x mismatch between the displayed spot price and historical OHLC/volume/fee data.
- Fee Earnings (7D), Volume Concentration (24h), and `usePoolMetrics` all consumed uncorrected candle prices, producing values 10x off from the corrected spot price.
- Rather than propagating the correction to every consumer, the root cause was addressed: the on-chain price is the real price. No correction needed.

## Files changed

| File | Change |
|------|--------|
| `lib/pools.ts` | Removed `priceCorrection` from `SolanaPoolMetadata` type and all 3 pool entries |
| `app/api/pool/[address]/route.ts` | `currentPrice = data.price` (was `data.price * PRICE_CORRECTION`) |
| `app/api/pool-data/route.ts` | Removed `priceCorrection` variable that was briefly added for candle prices |
