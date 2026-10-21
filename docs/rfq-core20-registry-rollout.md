# Birds-eye RFQ Core20 Registry Rollout

## What changes

- Birds-eye can now read the canonical RFQ registry from:
  `GET /api/rfq/assets-config`
- The top strip uses the real registry split:
  - `top-20 = assets with group=core20`
  - `outside top-20 = assets with group=tail`
- Each market maker row shows the total depth plus explicit `top-20` and
  `outside top-20` values before the proportional bar.
- The SLA delta requires both buckets independently: `$5M` top-20 and `$4M`
  outside top-20. Top-20 surplus does not offset an outside-top-20 shortfall.
- Depth uses each provider's latest valid buy-side ceiling per asset. The
  frontend treats the largest sane returned notional as that asset/provider's
  ceiling and sums those ceilings in `SLAs → RFQ Depth · Notional`.
- To avoid double-counting venues from the same market maker, each asset/MM
  contribution is the largest venue ceiling for that MM, not the sum of its
  venues. For example, Tokka depth for one asset is `max(CoW, JupZ)`.
- The SLA table keeps the original fixed asset list. The registry is only used
  for RFQ depth math in this phase.
- The SLA table has a client window selector for Today, 2 days, and 7 days.
  It changes the calendar-day `days` parameter sent to `/api/rfq/daily-buckets`
  for the bps cells; the venue-count and depth strip stays on latest live RFQ
  data.

## Feature flag

- Frontend registry mode is controlled by:
  `NEXT_PUBLIC_BIRDS_EYE_RFQ_REGISTRY_ENABLED`

Behavior:

- `true`:
  fetch `/api/rfq/assets-config` and use registry-driven assets for the depth split
- `false`:
  fall back to the old 10-asset local config immediately

## Safe rollout

1. Deploy the frontend code with the flag off.
2. Validate backend `fast-core20` workers and `/api/rfq/assets-config`.
3. Enable the flag in preview.
4. Promote the flag to production only after Birds-eye looks correct.

## Tail worker status

- As of 2026-04-24, the VPS runs dedicated `tail-hourly` systemd services for
  `0x`, `1inch`, `cowswap`, `bebop`, and `jupz`:
  - `indexer-solana-rfq-0x-tail`
  - `indexer-solana-rfq-1inch-tail`
  - `indexer-solana-rfq-cowswap-tail`
  - `indexer-solana-rfq-bebop-tail`
  - `indexer-solana-rfq-jupz-tail`
- These services keep the existing `fast-core20` workers untouched and set
  `*_RFQ_PROFILE=tail-hourly`, `*_RFQ_POLL_INTERVAL_MS=3600000`, and
  `*_RFQ_INCLUDE_REVERSE=false`.
- They populate the `outside top-20` bucket from forward/buy-side quotes only.

## Fast rollback

1. Set `NEXT_PUBLIC_BIRDS_EYE_RFQ_REGISTRY_ENABLED=false`
2. Redeploy the frontend

That returns the page to the previous 10-asset hardcoded behavior without touching the backend workers or DB.

## Notes

- Synthetic fill stays separate and still uses:
  `NEXT_PUBLIC_BIRDS_EYE_SYNTHETIC_FILL_ENABLED`
- Assets with unknown `requiredTier` are not rendered in the SLA table during
  this phase. They still contribute to depth if they belong to `core20`.
- Backend workers should discover the buy-side ceiling across the top-20 set,
  then keep quoting the discovered ceiling; the Birds-eye frontend consumes that
  ceiling from the latest RFQ rows as the displayed notional depth.
