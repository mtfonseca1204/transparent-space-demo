# Indexer Ask — Extend the reconciled Liquidity-Depth endpoint to EVM (0G first)

**Goal:** make the Historical Liquidity Depth chart 100%-complete + fast + **historically correct at `now`** for
0G/EVM v3 pools, by extending the existing materialized, on-chain-**reconciled** endpoint
`/api/charts/liquidity-depth` (already live for Raydium/Kraken) to EVM indexer pools.

**Why (the bug this fixes):** on the legacy client-side path, the "now" column shows liquidity for positions that no
longer exist. Diagnosis (0G `W0G/USDC.e` = `0xce77377cdfeb967ff2bb6f223ae74e1ae8dcfc71`): the two offenders
(`0x4534…6a95`, `0x6927…7372`) are **event-less** positions (router/NFT-manager-mediated; no owner-attributed
Mint/Burn events). The frontend's only signal that they exist is the indexer's `Position.active = true` flag, which is
**stale** (positions withdrawn on-chain are still flagged active — see `INDEXER_STALE_POSITION_LIQUIDITY.md`). There is
no client-side way to detect this without on-chain truth. The Raydium path already solved this class of bug via
materialization + on-chain reconciliation (`quality.reconciled`, ~2% mismatch). We need the same for EVM.

---

## 1. The endpoint contract (identical shape to the Raydium version)

`GET /api/charts/liquidity-depth?pool=<addr>&window_days=<n>&resolution=<1h|4h|1d>&price_bins=<n>&chain_id=<id>`

Return the **same payload** the Raydium endpoint already returns (the frontend normalizer + renderer are protocol-
agnostic — see `lib/liquidity-depth.ts`):

```ts
{
  times: number[];                 // bucket centers, unix s
  priceBins: number[];             // ascending, linearly spaced (frontend assumes this)
  values: number[][];              // [time][bin] aggregate liquidity value (USD)
  priceLine: Array<number|null>;   // pool price per bucket (USDC.e per W0G)
  owners: Array<{ owner; valueUsd; activeBandCount; closedBandCount; lastClosedAt }>;
  ownerBands: Array<{ owner; tickLower; tickUpper; L; openedAt; end; closed }>;
  quality: { reconciled; mismatchPct; reconstructedLiquidity; indexedLiquidity; latestTick; thresholdPct; warnings[] };
  meta: {
    pool; protocol; schemaVersion; windowDays; resolution; resolutionSeconds; priceBins;
    startTime; endTime; source: "indexer-native"; valueMode: "usd";
    ownerAttribution: boolean; ownerBandCount; ownerCount; token0Decimals; token1Decimals; materializedAt; cache;
  }
}
```

Only difference: **`meta.protocol`** must carry the EVM protocol (e.g. `"uniswap-v3"`) instead of `"raydium-clmm"`.
(Frontend change needed — see §5.)

---

## 2. EVM reconstruction (history)

Same fold as Raydium, on EVM v3 events: replay the signed per-position liquidity deltas
(`Mint` / `IncreaseLiquidity` = +L, `Burn` / `DecreaseLiquidity` = −L, full withdrawal → close) into constant-`L`
time segments per `(owner, tickLower, tickUpper)`, then aggregate into the `values[time][bin]` grid and per-owner
`ownerBands`. Drain **all** history (no event cap) so old positions reconstruct correctly. Value bands in **USD**
using the token USD map (W0G, USDC.e) so `valueMode: "usd"`.

## 3. Owner attribution (the v3-specific hard part)

v3 pool `Mint`/`Burn` events report the **NonfungiblePositionManager**, not the end wallet — so bands must be keyed by
the **true NFT owner**, resolved per `tokenId` via NPM `Transfer` replay (or `ownerOf(tokenId)` on-chain). See
`INDEXER_LP_OWNERSHIP_REQUIREMENTS.md`. Positions whose owner can't be resolved should still appear in the aggregate
(`values`) but may be grouped under a manager pseudo-owner in `owners`/`ownerBands` (flag via a `warnings` entry), so
the aggregate depth stays correct even where per-owner attribution is incomplete.

## 4. On-chain reconciliation — **the part that fixes the bug**

This is the critical EVM requirement and the reason for materializing server-side:

1. **Current state from on-chain, not the stale `active` flag.** For the most-recent bucket, the "open" set must be
   the positions with **on-chain liquidity > 0** — read `NonfungiblePositionManager.positions(tokenId).liquidity`
   (or equivalent authoritative position state) at materialization time. A position withdrawn on-chain reads `0` and
   is **excluded** from `now`. This drops the stale event-less phantoms (`0x4534…`, `0x6927…`) that the `Position`
   entity currently keeps `active`.
2. **Reconcile the total.** Compare `reconstructedLiquidity` (sum of reconstructed active `L` at `latestTick`) against
   `indexedLiquidity` = the pool's **on-chain active in-range liquidity** (`pool.liquidity()` / `slot0.tick`). Set
   `quality.reconciled = mismatchPct <= thresholdPct` (use the same threshold as Raydium, ~5%). Surface mismatches in
   `warnings` rather than silently rendering wrong depth.
3. **Heal, don't fabricate.** Where reconstruction and on-chain disagree, prefer on-chain for the `now` state and flag
   the residual — never extend a position to `now` that on-chain says is closed.

The acceptance bar: **a position that is closed on-chain must not contribute to the `now` column**, regardless of its
`Position.active` flag or whether it had owner-attributed events.

## 5. Frontend changes (small — once the EVM endpoint is live)

- `lib/liquidity-depth.ts`
  - `supportsHistoricalLiquidityDepth(poolKey)` — currently `inferPoolProtocol === "raydium"`. Extend to include the
    EVM indexer v3 pools that have the endpoint (gate on 0G first, ideally a per-pool capability/allowlist so we light
    it up as the indexer ships pools).
  - `LiquidityDepthPayload.meta.protocol` — widen the type from `"raydium-clmm"` to a union incl. `"uniswap-v3"`; stop
    hardcoding `protocol: "raydium-clmm"` in `normalizeLiquidityDepthPayload` (echo `meta.protocol`).
- `app/api/liquidity-depth/route.ts` — pass a `chain_id` (or reuse `space`) so the indexer routes to the right network
  indexer (0G `chainId=16661` vs Solana). Keep the `window_days` cap aligned with what the indexer materializes.
- `components/dashboard/dashboard.tsx` — no logic change needed: `supportsMaterializedLiquidityDepth` already derives
  from `supportsHistoricalLiquidityDepth`, so 0G automatically switches from the legacy reconstruction to the
  materialized + reconciled path (with working per-owner controls, like Kraken) once the support flag includes it.
- Legacy path stays as the fallback for EVM pools without the endpoint.

## 6. Acceptance criteria (tie-back to the reported bug)

- On 0G `W0G/USDC.e`, hovering **today** does **not** show `0x4534…6a95` / `0x6927…7372` if they're closed on-chain.
- `quality.reconciled === true` (mismatch under threshold) for 0G pools; mismatches appear in `warnings`.
- Each historical bucket reflects the liquidity live at that time; the `now` bucket equals on-chain current liquidity.
- Per-owner filter + cell drill-down + include-inactive work for 0G (owner attribution resolved to true wallets), same
  as Kraken.

## 7. Phasing

- **P1 (indexer):** EVM v3 materialization + owner attribution + **on-chain reconciliation**, exposed at
  `/api/charts/liquidity-depth` for 0G `W0G/USDC.e` (+ the Zia 0G pools). Same payload shape; `protocol: "uniswap-v3"`.
- **P2 (frontend):** widen `supportsHistoricalLiquidityDepth` + `meta.protocol` type + route `chain_id`; verify
  reconciliation passes and the reported phantoms are gone; keep legacy fallback.
- **P3:** extend to the other EVM indexer pools (Worldchain, Katana, BSC) pool-by-pool via the support allowlist.

## 8. Open questions

- Can the indexer read `NonfungiblePositionManager.positions(tokenId).liquidity` (or cache on-chain position state) at
  materialization time for the reconciliation, or do we need a periodic on-chain snapshot job per pool?
- USD valuation source for 0G bands (W0G/USDC.e) — reuse the same token USD map the dashboard uses?
- Materialization cadence / window cap for EVM (start at 30d like Raydium, or longer since EVM event volumes are lower
  than the busy Solana pools)?
