# Plan — Historical Liquidity Depth Heatmap

Replace the **Liquidity Density & Capital Efficiency** card (`components/dashboard/capital-efficiency-chart.tsx`)
with a **Bookmap / Sierra-Chart "Market Depth Historical Graph"** style view for on-chain concentrated liquidity:

- **X = time, Y = price, color gradient = liquidity depth/concentration** at each price level over time.
- The **pool price line** is overlaid and sweeps through the heat.
- **Select LP addresses** (all / individual / multi), and **include inactive (closed) LPs**, to watch how a wallet's
  footprint changed over time.

Status: **Shipped** (Phases 0–4). The heatmap is the **sole renderer** for this card — the legacy
`CapitalEfficiencyChart` and the `useDepthHeatmap` toggle were removed. PNG/video **export was intentionally dropped**.

---

## 1. Feasibility — verified against the code

The full data path already exists in this repo; the heatmap is a **2D grid of the columns the LP-replay already
computes one frame at a time**. No new indexer work.

Reused building blocks:

| Block | File | Role in the heatmap |
|---|---|---|
| `reconstructAllLifecycles(events, {d0,d1})` | `lib/lp-rebalances.ts:154` | Every position as `{owner, tickLower, tickUpper, openedAt, closedAt, liquidity}`. Closed/inactive LPs = `closedAt != null`. Owner on every row → address filtering. |
| `valueBarsFor` / `makeBars` / `tickToSqrtPrice` | `components/dashboard/historical-rebalances.tsx` (replay) → **extracted to** `lib/liquidity-depth-bars.ts` | V3 sqrt-price amount math + USD valuation per price bin at a timestamp `t`. One call = one heatmap column. |
| `priceSeries {t, tick}` | `hooks/use-owner-rebalances.ts:276` | Pool tick over time → the price-line overlay and the token0/token1 split per column. |
| snapshot union | `hooks/use-owner-rebalances.ts:213` | Merge reconstructed lifecycles with the authoritative `positions` snapshot so router/NFT-manager mints still render. |
| events already fetched | `dashboard.tsx:993` `lpLifecycleRawEvents` (365d, shared cache) | No new query at the mount point. |

## 2. Verified risks / product decisions

1. **Peak vs instant liquidity (chosen: peak now, precise later).** `reconstructAllLifecycles` stores `peakLiq` and
   holds it flat across `[openedAt, closedAt)`. So depth is **overstated after a partial trim** and INCREASEs are
   mistimed. MVP ships on peak, **clearly labeled**; a "precise depth" mode (replay signed `liquidityDelta` into a
   per-bucket running sum) is a Phase 4 upgrade.
2. **Closed-LP attribution (inherited caveat).** `LPEventData.owner` is the Mint event's indexed `owner`
   (`lib/envio-client.ts:360`), which for NPM-routed v3 mints is the position manager, not the end LP. Active
   positions are re-keyed to the true NFT owner via the snapshot; **closed** positions live only in the event stream
   and may aggregate under a manager address. This is the **same caveat the shipping "Closed LPs" tab and every
   per-LP chart already carry** — the heatmap inherits it; the UI surfaces a note.
3. **USD valuation uses current token USD prices applied historically** (same approximation as the replay) — this
   isolates *liquidity* changes from *price-of-token* changes. Labeled.
4. **Compute is the bottleneck, not pixel fill.** The matrix build (`O(columns × bins × activePositions)`) dominates.
   Mitigation: build once (memoized), band-centric distribution (each position writes only the bins it overlaps),
   render to one cached bitmap, and drive only the price-line + crosshair on an overlay layer per `mousemove`.

## 3. Data model

`hooks/use-liquidity-depth-heatmap.ts` → `DepthHeatmap`:

- `times: number[]` (T bucket centers), `rowTickMid: number[]` (P price bins).
- `cells: Float64Array` (T×P, row-major), `priceLineRow: Float32Array` (fractional row of pool price per column).
- `maxCell`, `p95`, `p99` for normalization; `valueIsUsd`, `mode`, `windowDays`, totals.

Builder:
1. `reconstructAllLifecycles(rawEvents)` → `DepthBand[]` (carry `owner` + `closed`), unioned with the snapshot.
2. Filter by `selectedOwners` (empty = all) and `includeInactive` (drop `closed` bands when off).
3. Time bucket `[tMin, tMax]`, `tMin = max(now − windowDays·86400, earliest activity)`.
4. Price bins focused on the window's price excursion ± padding, aligned to `tickSpacing`, log-spaced (`1.0001^tick`).
   - **Fixed** (default): one shared absolute-price Y axis; the price line moves diagonally through the grid.
   - **Sliding**: price-centered offset bins (Bookmap "follow price"); the price line is flat-centered.
5. Per column: value the active bands across bins with the extracted V3 math (band-centric for speed).

Pool families: builder is family-agnostic (unified `/api/pool-data` shape). Gate on `hasRangeLiquidityShape`;
Meteora DLMM (no per-LP events) falls back to the snapshot-only band set.

Window/granularity ceiling: candle row budget caps 365d → daily columns; 7d → hourly. Same `pickCandleInterval`.

## 4. Rendering

- **Two stacked canvases.** Layer A: heatmap bitmap — write RGBA per cell from a precomputed 256-entry colormap LUT
  into an offscreen T×P canvas, `drawImage`-scaled with `imageSmoothingEnabled=false`. Rebuilt only on
  data/theme/normalization change. Layer B: price line + crosshair + readout, redrawn per `mousemove`.
- **Colormap:** theme-aware (`--bp-*` luminance) sequential ramp; near-zero cells render as card background (voids =
  low-liquidity signal). **Normalization:** percentile-clamped (default, `p99`) or log — depth is heavy-tailed.
- **Crosshair/tooltip:** uniform grid → `(col,bin)` by arithmetic; DOM tooltip with time, price, depth USD, % of column.
- **Export:** intentionally not included (removed per product decision).

## 5. Address-selection UX

- Multi-select `Set<string>` (do **not** reuse the single `selectedOwner`). BirdsEye checkbox precedent
  (`birds-eye-liquidity-fragility-table.tsx`): toggle / All / Reset, search box, top-N + "more".
- **Active** section ← `currentLPsSortedForDisplay`; **Inactive (closed)** section ← `closedLPsSortedForDisplay`
  (with the attribution note). "Include inactive" is an independent toggle.
- Address selection is **pool-scoped local state** (resets on pool switch). Global toggles
  (window, price mode, color scale, include-inactive, depth mode) persist in `chart-settings-store`.

## 6. Files

New: `lib/liquidity-depth-bars.ts`, `hooks/use-liquidity-depth-heatmap.ts`,
`components/dashboard/historical-liquidity-depth-heatmap.tsx` (+ inline address filter).
Modified: `components/dashboard/historical-rebalances.tsx` (import the extracted math),
`stores/chart-settings-store.ts` (heatmap keys, version 5→6 + migrate),
`components/dashboard/dashboard.tsx` (renders the heatmap at the `capital-efficiency` card),
`docs/ai/frontend-pool-chart-catalog.md` (rewrite the section).

## 7. Phased rollout

- **P0** — extract the math to `lib/liquidity-depth-bars.ts` (regression-safe; replay still imports it). ✅
- **P1** — static all-LP heatmap (fixed axis, peak liquidity, percentile color). ✅
- **P2** — crosshair/tooltip + window / price-mode / color-scale controls. ✅
- **P3** — address multi-select (active + closed), include-inactive. ✅
- **P4** — drill-to-owners-per-cell + **precise (instant) depth** toggle. ✅ (export was dropped)
  - Precise depth: `reconstructLiquiditySegments` (`lib/lp-rebalances.ts`) replays signed `liquidityDelta` into constant-`L` time segments (default mode; `peak` kept as a toggle).
  - Per-cell attribution: `cellOwnerBreakdown` (`lib/liquidity-depth-bars.ts`) + `cellBreakdown(col,row)` from the hook; hover shows top contributors, click pins a drill-down whose owner rows toggle the address selection.
- **P5** — `CapitalEfficiencyChart` + the `useDepthHeatmap` flag retired (file deleted). ✅ Validation across all pool families remains ongoing.

## 7b. Data-coverage fix (Solana event pagination)

The all-time LP event feed was silently truncated at 5,000 events (`app/api/pool-data/route.ts`, events `maxPages: 10 × pageLimit: 500`). For busy Solana pools that only reached ~135 days back, so ~half of current positions had no in-feed opening MINT and were drawn as **flat back-filled bands** (the "static stripes" — largely an artifact, not real LP behavior).

Fix: raised events `maxPages: 10 → 30` (15k ceiling; `pageLimit` kept at 500 to avoid a premature stop on non-enveloped pages) and added `export const maxDuration = 60`. `fetchAllSolanaPages` drains via `has_more` and the server filters by `start_time`, so short windows still stop after 1–2 pages; only the long (365d) feed pages deep, and the response is cached (60s in-memory + `s-maxage`/SWR).

Measured on Raydium TSLAx/USDC: snapshot-only positions **48% → 16%**, coverage **135d → 246d**. Residual: extremely busy pools can still exceed 15k events over a year; and a position whose MINT is truncated but with in-feed deltas still falls back to the flat snapshot (orphan deltas ignored). Further levers if needed: higher cap, or seed opening liquidity from the snapshot to consume orphan deltas.

## 8. Open questions

- Confirm per-family whether `lpevents.owner` resolves the NFT owner or the pool-event owner (affects the *closed*
  per-address filter completeness). If unresolved for a family, show "include inactive" as aggregate-only there.
- Decide the worker-offload threshold for mega-pools (position count) before P4.
