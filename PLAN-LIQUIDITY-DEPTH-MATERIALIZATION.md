# Plan — Make Historical Liquidity Depth 100% Complete + Fast (materialized backend)

**Goal:** the Historical Liquidity Depth chart must be (1) **100% complete/correct** — no truncation, no back-filled "static stripe" artifacts, every position's full liquidity history — and (2) **fast to load** (heatmap payload well under 1s).

These two are jointly achievable **only by materializing the reconstruction server-side** and serving a compact, pre-bucketed payload. Client-side folding of a paginated event feed (today's approach) can be complete *or* fast, never both.

> Status: design. Synthesized from a multi-agent design pass (4 grounding audits + 2 architecture proposals completed; the run stalled before the verdicts) plus firsthand measurement of the live feed (see §1). Primary recommendation below.

---

## 1. What we measured (why this is needed)

On the real pool `HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum` (Raydium TSLAx/USDC):

- The all-time LP event feed is paginated and was capped at **5,000 events** → only ~135 days of history → **48% of current positions had no opening MINT** → drawn as flat back-filled bands (the "static stripes").
- Raising the cap to **15,000** (shipped) → ~246 days, **16% snapshot-only**. Better, but the pool is so busy (10,982 DECREASE events/yr) that even 15k doesn't reach a full year, and it costs ~11s / 11MB on first load.
- Conclusion: request-time pagination can't deliver 100% without unacceptable latency. The reconstruction is a **fold over the complete event history** — do it once, offline, store the result.

---

## 2. Bottom line — recommended architecture

**Primary: App-Owned Segment Materialization** (no indexer-team dependency, effort ~M).

A Vercel **cron we own** drains the **full** `/api/position-events` feed per pool *offline* (no request budget → exhaustive `has_more` pagination via the existing `fetchAllSolanaPages`, `lib/solana-indexer-client.ts:109`), folds it to **per-position liquidity segments** (`reconstructLiquiditySegments`, `lib/lp-rebalances.ts:221`), **reconciles** the reconstructed current liquidity against the live positions snapshot (the 100% proof), and writes segments + a pre-bucketed grid to **Supabase**. The heatmap reads one compact, cached row-set → **30–120ms warm**.

- **North star (when the indexer team is reachable): Indexer-Native.** Push the same fold into the Railway indexer (it sees every event + on-chain `personalPositionState`), so completeness is authoritative at the source and served as a tiny endpoint. This is the *correct* long-term home and matches the existing `SOLANA_API_AGGREGATED_CHARTS_REQUIREMENTS.md` backlog. Make it Phase 4 — the app-owned table is forward-compatible (same schema), so it's a drop-in swap later.
- **Optional serving upgrade: Edge-cached blobs.** Instead of (or in addition to) DB reads, write immutable versioned gzipped artifacts to Supabase Storage keyed by `pool + asOfSlot`, served from CDN → constant <1s regardless of history size. Adopt only if DB read latency or concurrency becomes a concern.

**The one decision for you:** can you get changes into the Railway indexer on a useful timeline?
- **No / not soon →** build App-Owned now (this plan). It fully solves *speed* and *pool-level completeness* today.
- **Yes →** still build App-Owned now (it's the bridge + reconciliation harness), and file the Indexer-Native spec in parallel as the durable endpoint.

---

## 3. The completeness guarantee (how we reach *and prove* 100%)

Completeness is **guaranteed at the pool level and proven**, never faked:

1. **Exhaustive drain (no truncation).** The cron runs `fetchAllSolanaPages` with **no `maxPages` cap** (loop until `has_more = false`). Offline, so the request 60s budget doesn't apply. This removes the 5k/15k ceiling entirely.
2. **Fold to segments.** `reconstructLiquiditySegments` replays signed `liquidityDelta` per `owner:tickLower:tickUpper` into constant‑L time slices `{owner, tickLower, tickUpper, L, openedAt, end, closed}` — instant (not peak) liquidity, with lifecycles closed exactly when liquidity hits 0.
3. **Reconciliation checksum (the proof).** Sum each position's *currently-open* segments at `now` and compare to the **live positions snapshot** (`/api/positions`, ground-truth current liquidity per active NFT):
   - **Match → certified complete** for that pool (store `reconciled: true`).
   - **Mismatch → heal + flag, never silently back-fill.** A snapshot position with no reconstructed open segment (its MINT predates even the full feed) gets a best-effort opening segment seeded from its snapshot liquidity dated at `updatedAt`, and is marked `source: 'snapshot-seed'` so the UI can show it as lower-confidence. The pool stores a `completenessPct` (reconciled liquidity ÷ snapshot liquidity).
4. **The honest ceiling.** True 100% *historical* fidelity for a position whose mint predates the entire indexed event stream requires the indexer to read on-chain `personalPositionState` (only the Indexer-Native phase closes this). The checksum makes that gap **measured and visible** (`completenessPct`, per-position `source` flag) instead of an invisible artifact. In practice the exhaustive drain reconciles ~100% of *current* liquidity; the residual is a small tail of very old positions, now labeled rather than faked.

---

## 4. The speed guarantee

- **Stored primitive:** per-position segments (canonical, reusable) + an optional **pre-bucketed grid** (time × price-bin × liquidity, and a top-N owner breakdown) computed once per refresh.
- **Served payload:** one row-set ≈ 300 time buckets × ~120 price bins ≈ 36k cells as flat typed arrays (a few hundred KB, gzipped less), not 11MB of raw events.
- **Caching:** reuse the existing layers — in-memory + `Cache-Control: s-maxage, stale-while-revalidate` (`app/api/pool-data/route.ts`), optionally CDN blobs. **Warm load 30–120ms; cold = one indexed Supabase SELECT.**
- **No client reconstruction:** the browser stops folding events and just renders → removes the ~11s CPU+transfer cost entirely.

---

## 5. Data model

New migration `supabase/migrations/014_lp_segments_analytics.sql` (Supabase is auth-only today; this is the first analytics use — service-role writes, RLS off or read-policy):

```sql
-- Canonical durable form of lib/lp-rebalances.ts PositionLiquiditySegment.
create table lp_position_segments (
  pool        text not null,
  owner       text not null,
  tick_lower  int  not null,
  tick_upper  int  not null,
  liquidity   numeric not null,      -- bigint-safe
  opened_at   bigint not null,       -- unix s
  end_at      bigint not null,       -- closedAt or run nowSec
  closed      boolean not null,
  source      text not null default 'events',  -- 'events' | 'snapshot-seed'
  run_id      bigint not null,
  primary key (pool, owner, tick_lower, tick_upper, opened_at, run_id)
);
create index on lp_position_segments (pool, run_id);
create index on lp_position_segments (pool, opened_at, end_at);

-- Per-refresh health + reconciliation result.
create table lp_segment_runs (
  run_id          bigserial primary key,
  pool            text not null,
  as_of           bigint not null,
  event_count     int  not null,
  position_count  int  not null,
  reconciled      boolean not null,
  completeness_pct numeric not null,
  created_at      timestamptz default now()
);

-- Optional: precomputed render grid per (pool, mode, window) for instant reads.
create table lp_depth_grid (
  pool text, mode text, window_days int, run_id bigint,
  payload jsonb not null,           -- {times[], rowTickMid[], cells[], priceLineRow[], ...}
  primary key (pool, mode, window_days, run_id)
);
```

- **Read API:** `GET /api/liquidity-depth?pool=&window=&mode=` → returns the latest *reconciled* `lp_depth_grid.payload` (or segments for client-side binning). Thin, cached.
- **Frontend swap:** `hooks/use-liquidity-depth-heatmap.ts` gains a path that, when materialized data exists, consumes segments/grid from the new endpoint instead of folding `rawEvents`. Same `DepthHeatmap` output shape → the component (`historical-liquidity-depth-heatmap.tsx`) is unchanged. Gate behind a flag for rollout; fall back to the live reconstruction if no run exists yet.

---

## 6. Incremental freshness + backfill

- **Backfill (once):** cron iterates all supported CLMM pools, exhaustively drains, folds, reconciles, writes a `run`. The heavy one-time pass.
- **Incremental (cheap, cadence e.g. every 5–15 min like the existing rollup crons):** keep a per-pool **cursor watermark**; fetch only events since the last run, **extend/close** affected segments (the fold is append-friendly — new INCREASE/DECREASE/CLOSE only touch their position's open segment), re-run the reconciliation checksum, write a new `run` and flip the "latest" pointer atomically. Old runs are immutable (safe reads, easy rollback).
- Mirrors the established `app/api/cron/check-rfq-daily-rollup` pattern + `vercel.json` crons; `export const maxDuration` already proven on `pool-data`.

---

## 7. Reuse — one table powers many charts

The same `lp_position_segments` is the canonical primitive for **every time-series LP view**, not just the heatmap:
- **Historical Liquidity Depth** (this chart — fixed/follow, precise/peak, per-owner drill-down).
- **Liquidity Distribution Over Time** (`LiquidityHistoryByAddressChart`).
- **Historical Rebalances** + the replay (`useOwnerRebalances`, `historical-rebalances.tsx`).
- **Closed LPs** tab (closed lifecycles = `closed=true` segments).
- **Fee Earnings by LP** (in-range share over time from segments).

So this is leverage across the dashboard, not a one-off.

---

## 8. Phased rollout (each independently shippable)

- **P1 — Segments table + backfill cron.** Migration 014, `/api/cron/materialize-lp-segments`, exhaustive drain + fold + reconciliation, write runs. No UI change. (Effort: M)
- **P2 — Read API + hook swap behind a flag.** `/api/liquidity-depth`, hook consumes materialized data, live-reconstruction fallback. Validate parity on 1–2 pools. (Effort: S–M)
- **P3 — Incremental sync + reconciliation surfaced.** Watermark cursor, 5–15 min refresh, show `completenessPct` / `snapshot-seed` confidence in the UI. (Effort: M)
- **P4 — (optional/north-star) Indexer-native and/or edge-cached blobs.** Move the fold into the indexer (authoritative on-chain reconciliation) and/or CDN blob serving. Drop-in via the same schema. (Effort: L / coordination)

---

## 9. Risks & the honest limit

- **Source-truth ceiling.** Materializing can't fix wrong/missing source events (owner attribution, missing closes). The reconciliation checksum **measures** the gap (`completenessPct`) instead of hiding it; only Indexer-Native + on-chain reads close it fully.
- **Per-wallet vs pool-level completeness.** Pool-level current liquidity reconciles to ~100%; a specific wallet's deep history can still have a labeled `snapshot-seed` tail.
- **Cron cadence staleness.** Sub-cadence (5–15 min) updates; acceptable for an analytical chart, tunable.
- **First analytics use of Supabase.** Adds a write path + a table; keep service-role writes server-only.
- **Very busy pools.** Exhaustive drain is heavy on first backfill (mitigated: offline, incremental thereafter, cached reads).

---

### TL;DR
Build the **App-Owned Segment Materialization** (cron → fold → reconcile → Supabase → thin cached API). It delivers **fast (<1s)** and **proven pool-level completeness today**, stores the **reusable segment primitive** that powers half the LP dashboard, and is a clean drop-in for an **Indexer-Native** endpoint later. The reconciliation checksum is what turns "looks complete" into "provably complete, with the residual labeled."
