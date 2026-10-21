# Bug Fix: Price Conversion Issue

## Problem
The chart was showing `0.0000` for all prices when using real data from the indexer.

## Root Cause
The `sqrtPriceX96ToPrice` function had the decimal adjustment backwards:

**Before (WRONG):**
```typescript
const decimalAdjustment = 10 ** (decimals1 - decimals0);
// = 10 ** (6 - 18) = 10 ** -12 = 0.000000000001
```

This made prices extremely small (e.g., `6.056e-25` instead of `0.6056`).

**After (CORRECT):**
```typescript
const decimalAdjustment = 10 ** (decimals0 - decimals1);
// = 10 ** (18 - 6) = 10 ** 12 = 1000000000000
```

## Why This Matters

Uniswap V3 stores prices as `sqrtPriceX96`, which is:
- Square root of the price
- Multiplied by 2^96 (Q96 fixed-point format)
- In terms of token0/token1 with their native decimals

For WLD/USDC pool:
- WLD (token0) has 18 decimals
- USDC (token1) has 6 decimals
- Price is in "USDC per WLD"

To convert to human-readable price:
1. Divide by 2^96 to get sqrtPrice
2. Square it to get price
3. Adjust for decimal difference: multiply by 10^(18-6) = 10^12

## Example Calculation

Given `sqrtPriceX96 = 61655626075058217101264`:

```
sqrtPrice = 61655626075058217101264 / 2^96 = 7.782e-7
price = (7.782e-7)^2 = 6.056e-13
adjusted = 6.056e-13 * 10^12 = 0.6056 USDC per WLD ✅
```

## Other Issues Fixed

### 1. Default Market Maker Address
**Before:** `0x30CE12193e609283abeC6DC223eb398705B26576` (no LP positions)
**After:** `0xec12a9F9a09f50550686363766Cc153D03c27b5e` (has active positions)

### 2. Default Time Range
**Before:** 1 day (288 candles)
**After:** 1 hour (12 candles) - faster load

## Testing

To verify the fix works:

```bash
# Test price conversion
curl -X POST https://indexer.dev.hyperindex.xyz/e305878/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ Candle(limit: 1, order_by: { timestamp: desc }) { closePrice } }"}' | jq -r '.data.Candle[0].closePrice'

# Should return something like: 61655626075058217101264
# Which converts to ~0.60 USDC per WLD
```

## Impact

- ✅ Chart now shows correct prices (~0.60 instead of 0.0000)
- ✅ OHLC candles display properly
- ✅ Oracle price line shows correct values
- ✅ Price deviation calculations work
- ✅ LP ranges display at correct price levels

## Related Files

- `lib/envio-client.ts` - Fixed `sqrtPriceX96ToPrice` function
- `components/dashboard/dashboard.tsx` - Updated default market maker address
- `hooks/use-lp-historical-data.ts` - Uses the fixed conversion function
