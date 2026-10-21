# Plan: Add Raydium Pool (Solana) Support

## Overview

Add support for displaying a Raydium CLMM (Concentrated Liquidity) pool on Solana alongside the existing Worldchain Uniswap V3/V4 pools. The Solana pool data is already fully indexed and served by a dedicated REST API on Railway. The main work is integrating this API into the Next.js frontend.

---

## Current Architecture

```
EVM Pools:   Worldchain → Envio HyperIndex → PostgreSQL → GraphQL → Next.js API Routes → React UI
                                                                                     ↑
                                                                        On-chain RPC (Viem) for V3 state
```

- **Chain**: Worldchain (EVM, Chain ID 480)
- **Protocols**: Uniswap V3 + V4
- **Indexer**: Envio HyperIndex → GraphQL
- **Frontend**: Next.js 15 + React + TanStack Query + Zustand
- **On-chain reads**: Viem (EVM multicall)
- **Pool registry**: `lib/pools.ts` (5 pools, `protocol: "v3" | "v4"`)

## New Architecture (Solana)

```
Solana Pool:  Solana → Custom Indexer → PostgreSQL → REST API (Railway) → Next.js API Routes → React UI
```

- **Data source**: `https://indexer-solana-production.up.railway.app/`
- **Pool**: `HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum` (Raydium CLMM)
- **30 REST endpoints** already available (mirrors the same endpoint structure as EVM)
- **No Solana SDK needed** — all data comes pre-indexed from the Railway API
- **Key math difference**: Raydium uses `sqrtPriceX64` (not `sqrtPriceX96`)

---

## Railway API Reference

**Base URL**: `https://indexer-solana-production.up.railway.app`

| Category | Endpoint | Status |
|----------|----------|--------|
| **Health** | `GET /api/health` | ✅ `{ status: "ok", pool: "HHQ..." }` |
| **Status** | `GET /api/status` | ✅ 231k instructions, 215k swaps, 812 positions |
| **Price** | `GET /api/price` | ✅ `{ price, sqrt_price_x64, tick, liquidity, block_time }` |
| **Candles** | `GET /api/candles?interval=1h&limit=168` | ✅ OHLCV with open/high/low/close prices |
| **Day Data** | `GET /api/pool/day-data?limit=30` | ✅ Daily volume, fees, OHLC, liquidity |
| **Swaps** | `GET /api/swaps?limit=100&offset=0` | ✅ `{ id, amount0, amount1, price (sqrtPriceX64), tick }` |
| **Fees Daily** | `GET /api/fees/daily?limit=30` | ✅ (currently 0 fees tracked) |
| **Fees by Wallet** | `GET /api/fees/daily-by-wallet?wallet=xxx` | ✅ |
| **Fees Leaderboard** | `GET /api/fees/by-wallet?limit=50` | ✅ |
| **Uncollected Fees** | `GET /api/fees/uncollected` | ✅ (empty currently) |
| **Fee Snapshots** | `GET /api/fee-snapshots?position=xxx` | ✅ |
| **Positions** | `GET /api/positions?active=true&limit=100` | ✅ `{ nft_mint, owner, tick_lower, tick_upper, liquidity, price_lower, price_upper }` |
| **Position by NFT** | `GET /api/positions/:nftMint` | ✅ |
| **Positions by Wallet** | `GET /api/positions/by-wallet/:address` | ✅ |
| **Position Events** | `GET /api/position-events?type=CreatePosition` | ✅ CreatePosition, IncreaseLiquidity, DecreaseLiquidity |
| **Events by Wallet** | `GET /api/position-events/by-wallet/:address` | ✅ |
| **Liquidity Dist.** | `GET /api/liquidity/distribution?bucket_size=100` | ✅ `{ current_tick, current_liquidity, data }` |
| **Liquidity Ticks** | `GET /api/liquidity/ticks` | ✅ (empty — may need tick changes endpoint) |
| **Liquidity Events** | `GET /api/liquidity/events?limit=100` | ✅ 12,479 events |
| **Liquidity by Wallet** | `GET /api/liquidity/by-wallet/:address` | ✅ |
| **Slippage** | `GET /api/slippage/current-tick?range=1000` | ✅ `{ current_tick, current_liquidity }` |
| **Capital Efficiency** | `GET /api/capital-efficiency?limit=100` | ✅ `{ nft_mint, price_lower, price_upper, liquidity, efficiency }` |
| **LP Distribution** | `GET /api/lp/distribution` | ✅ Size buckets (small/medium) |
| **LP Summary** | `GET /api/lp/summary?limit=50` | ✅ LP leaderboard |
| **LP Entry/Exit** | `GET /api/lp/entry-exit?limit=30` | ✅ Daily positions opened/closed |
| **LP Ranges** | `GET /api/lp/ranges/:address` | ✅ |
| **Raw Instructions** | `GET /api/instructions` | ✅ 231k rows |
| **Decoded Instructions** | `GET /api/instructions/decoded` | ✅ |
| **Transaction** | `GET /api/transactions/:signature` | ✅ |
| **Tick Changes** | `GET /api/tick-changes?limit=100` | ✅ 9,574 rows |

---

## Phase 1: Foundation & Configuration

### 1.1 Environment Variables

**File**: `.env.local`

```bash
SOLANA_INDEXER_API_URL=https://indexer-solana-production.up.railway.app
```

No Solana SDK or RPC needed — all data comes from the Railway REST API.

### 1.2 Solana Indexer Client

**New file**: `lib/solana-indexer-client.ts`

A thin REST client for the Railway API (equivalent to `lib/envio-client.ts` for EVM GraphQL):

```typescript
const SOLANA_INDEXER_BASE = process.env.SOLANA_INDEXER_API_URL
  ?? 'https://indexer-solana-production.up.railway.app';

export async function fetchSolanaApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`/api${path}`, SOLANA_INDEXER_BASE);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`Solana indexer ${path}: ${res.status}`);
  return res.json();
}
```

Features:
- Simple `fetch` wrapper with error handling
- Server-side caching via Next.js `revalidate`
- Type-safe response types for each endpoint
- Retry logic (reuse pattern from `lib/graphql-retry.ts`)

### 1.3 Extend Pool Registry

**File to modify**: `lib/pools.ts`

Extend `SupportedPool` type to include Raydium:

```typescript
export type SupportedPool = {
  key: string;
  label: string;
  poolKey: string;
  protocol: "v3" | "v4" | "raydium";
  chain?: "evm" | "solana";           // default: "evm"
  indexerBaseUrl?: string;             // for Solana: Railway API URL
};

// Add to SUPPORTED_POOLS:
{
  key: "raydium-pool",                 // TBD: proper name once token pair confirmed
  label: "TESLA / USDC (Raydium)",     // Based on Railway API data (~$4002 price)
  poolKey: "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum",
  protocol: "raydium",
  chain: "solana",
}
```

### 1.4 Pool Key Normalization

**File to modify**: `lib/pools.ts`

Update detection functions:

```typescript
export function inferPoolProtocol(poolKey: string): "v3" | "v4" | "raydium" {
  const pool = getSupportedPool(poolKey);
  if (pool) return pool.protocol;
  const lc = normalizePoolKey(poolKey);
  if (lc.includes("-v4-")) return "v4";
  // Solana base58 addresses: no 0x prefix, 32-44 alphanumeric chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(poolKey)) return "raydium";
  return "v3";
}

export function isSolanaPool(poolKey: string): boolean {
  return inferPoolProtocol(poolKey) === "raydium";
}
```

Note: `normalizePoolKey()` should NOT lowercase Solana addresses (base58 is case-sensitive).

### 1.5 Raydium Math Utilities

**New file**: `lib/raydium-math.ts`

Raydium CLMM uses `sqrtPriceX64` (Q64.64 fixed-point) instead of Uniswap's `sqrtPriceX96` (Q64.96):

```typescript
// sqrtPriceX64 → human price
export function sqrtPriceX64ToPrice(
  sqrtPriceX64: bigint,
  decimals0: number,
  decimals1: number
): number {
  const price = Number(sqrtPriceX64) / 2 ** 64;
  return (price * price) * 10 ** (decimals0 - decimals1);
}

// Tick ↔ price conversions (same formula as Uniswap V3: price = 1.0001^tick)
// Can reuse from lib/uniswap-v3-math.ts — the tick math is identical
```

The Railway API already returns computed `price` fields, so this is mainly needed for:
- Converting `sqrt_price_x64` from swap data
- Tick-to-price conversions for position ranges
- Consistency checks

---

## Phase 2: Next.js API Route Adapters

The frontend currently fetches data through Next.js API routes that call the Envio GraphQL indexer. For Solana pools, these routes need to proxy to the Railway API instead.

**Strategy**: Detect pool protocol in each API route and branch:
- `"v3"` / `"v4"` → existing Envio GraphQL logic
- `"raydium"` → forward to Railway REST API

### 2.1 Pool State — `/api/pool/[address]/route.ts`

**Current**: V3 on-chain RPC multicall via Viem
**Raydium**: `GET /api/price` from Railway

Transform Railway response to match `PoolData` interface:

```typescript
// Railway returns:
{ price, sqrt_price_x64, tick, liquidity, block_time, transaction_hash }

// Transform to PoolData:
{
  sqrtPriceX96: convertX64toX96(sqrt_price_x64),  // or store X64 natively
  tick: Number(tick),
  liquidity: liquidity.toString(),
  price: price,
  token0: { symbol, decimals, address },  // from pool config
  token1: { symbol, decimals, address },
  // ... other fields
}
```

### 2.2 Candles — `/api/candles/route.ts`

**Current**: Envio GraphQL `PoolCandle` entity
**Raydium**: `GET /api/candles?interval={}&limit={}` from Railway

The Railway candle response already includes human-readable prices (open, high, low, close) + volumes + tx count. Map to the existing `CandleData` format used by the frontend.

### 2.3 Batched Pool Data — `/api/pool-data/route.ts`

**Current**: Single GraphQL query returning tickLiquidities, poolHourDatas, lpevents, mints, burns, positions
**Raydium**: Multiple Railway API calls composed together:

| Frontend field | Railway endpoint |
|---|---|
| `tickLiquidities` | `GET /api/liquidity/distribution` + `GET /api/tick-changes` |
| `poolHourDatas` | `GET /api/candles?interval=1h` (derive hourly data from candles) |
| `lpevents` | `GET /api/position-events` |
| `positions` | `GET /api/positions?active=true` |
| `uniswapV3PoolMints` | `GET /api/position-events?type=CreatePosition` + `GET /api/position-events?type=IncreaseLiquidity` |
| `uniswapV3PoolBurns` | `GET /api/position-events?type=DecreaseLiquidity` |

Fetch all in parallel with `Promise.all()`, then compose into the same response shape.

### 2.4 Swaps — (new route or extend existing)

**Raydium**: `GET /api/swaps?limit=100&offset=0` from Railway

Response shape is already compatible — map `amount0`, `amount1`, `tick`, `liquidity`, `transaction_hash` to the frontend's swap data model.

### 2.5 Positions — `/api/positions` (if frontend calls directly)

**Raydium**: `GET /api/positions?active=true&limit=100` from Railway

```typescript
// Railway returns:
{ nft_mint, owner, tick_lower, tick_upper, liquidity, price_lower, price_upper, opened_at }

// Map to frontend Position type:
{ id: nft_mint, tokenId: nft_mint, owner, tickLower: tick_lower, tickUpper: tick_upper, liquidity, ... }
```

### 2.6 Fees

**Raydium**: Forward to Railway fee endpoints directly
- `GET /api/fees/daily`
- `GET /api/fees/by-wallet`
- `GET /api/fees/uncollected`

Note: Fee data is currently empty (0 fees) in the Railway API — may need investigation.

### 2.7 LP Analytics

**Raydium**: Forward to Railway LP endpoints:
- `GET /api/lp/summary` → LP leaderboard
- `GET /api/lp/distribution` → Size distribution
- `GET /api/lp/entry-exit` → Daily open/close
- `GET /api/lp/ranges/:address` → Wallet ranges
- `GET /api/capital-efficiency` → Efficiency ranking

### 2.8 Token Prices — `/api/token-prices/route.ts`

**Add Solana token support**:
- CoinGecko: use platform `"solana"` for Solana token addresses
- Add Jupiter Price API as fallback (`https://api.jup.ag/price/v2`)
- Add known Solana tokens to the fallback list

### 2.9 Historical Prices — `/api/historical-prices/route.ts`

**Add Solana support**:
- CoinGecko: use platform `"solana"`
- DefiLlama: use `"solana:"` prefix for token addresses

---

## Phase 3: Frontend Integration

### 3.1 Unified Pool Data Hook

**File**: `hooks/use-unified-pool-data.ts`

Add a third branch for Raydium:

```typescript
const protocol = inferPoolProtocol(poolKey);

if (protocol === "raydium") {
  // Fetch from /api/pool/{poolKey} (which proxies to Railway /api/price)
  // Return unified PoolData shape
} else if (protocol === "v4") {
  // Existing V4 logic (indexer-based)
} else {
  // Existing V3 logic (on-chain RPC)
}
```

### 3.2 Pool Candles Hook

**File**: `hooks/use-pool-candles.ts`

Currently fetches from Envio GraphQL. For Raydium pools, fetch from the Next.js API route (which proxies to Railway):

```typescript
if (isSolanaPool(poolKey)) {
  // Fetch /api/candles?pool={poolKey}&interval={}&limit={}
  // Railway candles already have human-readable prices (no sqrtPriceX96 conversion needed)
} else {
  // Existing Envio GraphQL logic
}
```

### 3.3 Liquidity Distribution Hook

**File**: `hooks/use-liquidity-distribution.ts`

For Raydium, use position data from Railway `/api/positions` and compute the same tick-level histogram. The position-based calculation mode already exists — just feed it Raydium position data.

### 3.4 Other Hooks

Review and update each hook to handle Raydium protocol:
- `hooks/use-pool-metrics.ts` — derive from Railway day-data
- `hooks/use-trading-volume-by-size.ts` — Railway swaps with amount bucketing
- `hooks/use-volume-attribution.ts` — may need adaptation for Solana tx format
- `hooks/use-lp-historical-data.ts` — Railway position events + candles

### 3.5 Pool Selector Component

**Files**: Pool selector / dropdown component in `components/`

- Add the Raydium pool to the list
- Show chain indicator (Solana icon / "SOL" badge)
- Group pools by chain or show flat list with chain labels

### 3.6 Explorer Links

**New file**: `lib/explorer.ts` (or extend existing)

```typescript
export function getExplorerUrl(type: 'tx' | 'address' | 'token', value: string, chain: 'evm' | 'solana') {
  if (chain === 'solana') {
    return `https://solscan.io/${type === 'tx' ? 'tx' : 'account'}/${value}`;
  }
  return `https://worldscan.org/${type}/${value}`;
}
```

Update components that display transaction links, wallet links, and token links to use chain-aware explorer URLs.

---

## Phase 4: Data Model Differences & Mapping

### Price Representation

| Field | Uniswap V3/V4 | Raydium CLMM |
|-------|---------------|--------------|
| sqrt price | `sqrtPriceX96` (Q64.96) | `sqrtPriceX64` (Q64.64) |
| tick formula | `price = 1.0001^tick` | `price = 1.0001^tick` (same) |
| tick spacing | varies by fee tier | varies by fee tier |

**Railway API simplification**: The Railway API already returns human-readable `price` fields on most endpoints (candles, positions, day-data), so `sqrtPriceX64` conversion is only needed for raw swap data.

### Identifiers

| Concept | EVM | Solana |
|---------|-----|--------|
| Pool address | `0x...` (hex, 20 bytes) | Base58 (32-44 chars, case-sensitive) |
| Position ID | NFT token ID (uint256) | NFT mint address (base58 pubkey) |
| Transaction | `0x...` (hex, 32 bytes) | Base58 signature |
| Wallet | `0x...` (hex, 20 bytes) | Base58 pubkey |

### Position Events

| EVM Event | Raydium Equivalent |
|-----------|-------------------|
| `Mint` | `CreatePosition` + `IncreaseLiquidity` |
| `Burn` | `DecreaseLiquidity` |
| `Collect` | (fee collection — tracked separately) |

---

## File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `lib/solana-indexer-client.ts` | REST client for Railway Solana API |
| `lib/raydium-math.ts` | sqrtPriceX64 conversion + tick math |
| `lib/explorer.ts` | Chain-aware block explorer URL helper |

### Modified Files

| File | Changes |
|------|---------|
| `.env.local` | Add `SOLANA_INDEXER_API_URL` |
| `lib/pools.ts` | Add `protocol: "raydium"`, `chain: "solana"`, pool entry, detection functions |
| `app/api/pool/[address]/route.ts` | Branch: Raydium → Railway `/api/price` |
| `app/api/candles/route.ts` | Branch: Raydium → Railway `/api/candles` |
| `app/api/pool-data/route.ts` | Branch: Raydium → compose from multiple Railway endpoints |
| `app/api/token-prices/route.ts` | Add Solana token addresses + Jupiter price source |
| `app/api/historical-prices/route.ts` | Add CoinGecko `solana` platform support |
| `hooks/use-unified-pool-data.ts` | Add Raydium branch in protocol switch |
| `hooks/use-pool-candles.ts` | Add Raydium branch (Railway candles already have human prices) |
| `hooks/use-liquidity-distribution.ts` | Feed Raydium positions into existing position-based calc |
| `hooks/use-pool-metrics.ts` | Derive from Railway day-data for Raydium |
| `stores/pool-store.ts` | Handle Solana pool keys (no lowercasing!) |
| Pool selector component | Add Raydium pool with Solana chain badge |
| Transaction/address link components | Use chain-aware explorer URLs |

### No Changes Needed

- **No new npm dependencies** — Railway API is plain REST, no Solana SDK needed
- **No `lib/viem.ts` changes** — Viem is only for EVM pools
- **No indexer work** — Railway API already handles indexing
- **Chart components** — should work as-is if data model is correctly mapped

---

## Implementation Order

```
Phase 1 (Foundation)           ── config + client
  ├── 1.1  Add SOLANA_INDEXER_API_URL to .env.local
  ├── 1.2  Create lib/solana-indexer-client.ts
  ├── 1.3  Extend lib/pools.ts (types, pool entry, detection)
  ├── 1.4  Update normalizePoolKey to handle base58
  └── 1.5  Create lib/raydium-math.ts

Phase 2 (API Route Adapters)   ── proxy Railway API
  ├── 2.1  /api/pool/[address] → Railway /api/price
  ├── 2.2  /api/candles → Railway /api/candles
  ├── 2.3  /api/pool-data → compose from Railway endpoints
  ├── 2.4  Swap/position/fee routes → proxy Railway
  ├── 2.5  /api/token-prices → add Solana tokens
  └── 2.6  /api/historical-prices → add Solana support

Phase 3 (Frontend Hooks)       ── protocol branching
  ├── 3.1  use-unified-pool-data.ts → Raydium branch
  ├── 3.2  use-pool-candles.ts → Raydium branch
  ├── 3.3  use-liquidity-distribution.ts → Raydium positions
  ├── 3.4  Other hooks (metrics, volume, LP data)
  └── 3.5  stores/pool-store.ts → handle Solana keys

Phase 4 (UI)                   ── pool selector + explorer links
  ├── 4.1  Pool selector with chain badge
  ├── 4.2  Explorer link components (Solscan)
  └── 4.3  Any chart adjustments for Raydium data

Phase 5 (Testing)
  ├── 5.1  Verify all endpoints return correct data for Raydium pool
  ├── 5.2  Test pool switching between EVM ↔ Solana
  ├── 5.3  Validate price/tick math with Railway API data
  └── 5.4  Edge cases (empty data, Railway API down, caching)
```

---

## Endpoint Mapping: Frontend → Railway API

| Frontend Route | Railway API Source | Transform Needed |
|---|---|---|
| `GET /api/pool/:address` | `GET /api/price` | Map `sqrt_price_x64` → PoolData shape |
| `GET /api/candles` | `GET /api/candles` | Minimal — prices already human-readable |
| `GET /api/pool-data` (ticks) | `GET /api/liquidity/distribution` + `/api/tick-changes` | Compose tick liquidity buckets |
| `GET /api/pool-data` (hourly) | `GET /api/candles?interval=1h` | Derive poolHourData from hourly candles |
| `GET /api/pool-data` (positions) | `GET /api/positions?active=true` | Map `nft_mint` → `tokenId` |
| `GET /api/pool-data` (events) | `GET /api/position-events` | Map event types |
| `GET /api/swaps` | `GET /api/swaps` | Map field names |
| `GET /api/positions` | `GET /api/positions` | Map field names |
| `GET /api/positions/:id` | `GET /api/positions/:nftMint` | Direct proxy |
| `GET /api/positions/by-wallet/:addr` | `GET /api/positions/by-wallet/:addr` | Direct proxy |
| `GET /api/fees/daily` | `GET /api/fees/daily` | Direct proxy |
| `GET /api/fees/by-wallet` | `GET /api/fees/by-wallet` | Direct proxy |
| `GET /api/fees/uncollected` | `GET /api/fees/uncollected` | Direct proxy |
| `GET /api/liquidity/distribution` | `GET /api/liquidity/distribution` | Direct proxy |
| `GET /api/liquidity/ticks` | `GET /api/liquidity/ticks` | Direct proxy |
| `GET /api/lp/summary` | `GET /api/lp/summary` | Direct proxy |
| `GET /api/lp/distribution` | `GET /api/lp/distribution` | Direct proxy |
| `GET /api/lp/entry-exit` | `GET /api/lp/entry-exit` | Direct proxy |
| `GET /api/capital-efficiency` | `GET /api/capital-efficiency` | Direct proxy |
| `GET /api/slippage/current-tick` | `GET /api/slippage/current-tick` | Direct proxy |
| `GET /api/token-prices` | CoinGecko + Jupiter (external) | Add Solana token discovery |

Many endpoints are **direct proxies** with minimal or no transformation.

---

## Key Technical Considerations

### 1. sqrtPriceX64 vs sqrtPriceX96

The Railway API uses Raydium's native `sqrtPriceX64` format. Most endpoints already return computed human-readable prices, but for consistency with existing frontend math:

```typescript
// Option A: Convert X64 → X96 for frontend compatibility
sqrtPriceX96 = sqrtPriceX64 * 2n ** 32n;

// Option B (preferred): Use human-readable prices directly
// Railway already returns `price` field on most endpoints
```

### 2. Base58 vs Hex Addresses

Solana addresses are base58-encoded (case-sensitive, no `0x` prefix). Key places to update:
- `normalizePoolKey()` must NOT lowercase Solana addresses
- Pool detection should check for base58 format
- Explorer links need Solscan instead of Worldscan

### 3. Caching

Maintain the same caching strategy:
- Server-side: In-memory cache per endpoint (30-60s TTL)
- Client-side: React Query with stale times matching EVM pools
- Railway API itself may have its own caching

### 4. Error Handling

Add Railway API-specific error handling:
- Network timeout (Railway cold starts can be slow)
- 5xx errors with retry
- Graceful fallback if Railway is down (show stale data or "Solana data unavailable")

---

## Open Questions

1. **Token pair identity** — The Railway API shows price ~$4002 and positions with price ranges ~$4.35-$5.02. Need to confirm token pair (possibly TESLA/USDC with different decimal handling?)
2. **Fee data** — Railway currently returns 0 fees. Is fee tracking implemented in the indexer, or pending?
3. **Tick liquidity** — `/api/liquidity/ticks` returns empty. Is tick-level data available through `/api/tick-changes` instead?
4. **Pool selector UX** — Flat list with chain badges, or grouped by chain?
5. **Railway API stability** — Is there a health check / monitoring for the Railway deployment?

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Railway API cold starts | Slow first request (1-3s) | Pre-warm with periodic health check; aggressive caching |
| Railway API downtime | Solana pool data unavailable | Show last cached data; graceful degradation; don't break EVM pools |
| Response shape mismatch | Frontend crashes | Type-safe API client with validation; unit tests for transforms |
| Base58 case sensitivity bugs | Wrong pool/address lookups | Skip `.toLowerCase()` for Solana keys; add protocol-aware normalization |
| Missing fee/tick data | Incomplete charts | Show "data unavailable" for missing sections; don't hide the pool |
