# RFQ Synthetic Fill Rollout

## Purpose
- Temporary Birds-eye SLA patch for internal collection gaps only.
- Synthetic fill applies only inside the SLA table.
- Top venue-count and depth strips remain fully real.

## Target gaps
- Eligible synthetic targets:
  - `COINx` and `HOODx` on `oneinch`, `zerox`, `bebop`, `cowswap`
- Hard exclusions:
  - every `cowswap × weekend` cell stays empty

## Frontend flag
- Kill switch:
  - `NEXT_PUBLIC_BIRDS_EYE_SYNTHETIC_FILL_ENABLED`
- Safe default:
  - keep it `"false"` on initial deploy

## Rollout order
1. Deploy the frontend with the synthetic-fill code and the flag still off.
2. Run one-shot `$10k` captures for `COINx` and `HOODx` on:
   - EC2 workers: `1inch`, `0x`, `cowswap`
   - Railway workers: `bebop`
3. Validate that each eligible `asset × provider` has at least one fresh successful quote for the current ET day.
4. Spot-check the SLA table:
   - real cells still win over synthetic
   - `cowswap weekend` remains empty
   - only the SLA table shows `Est.` badges
5. Turn `NEXT_PUBLIC_BIRDS_EYE_SYNTHETIC_FILL_ENABLED` to `"true"` and redeploy.

## Rollback
1. Set `NEXT_PUBLIC_BIRDS_EYE_SYNTHETIC_FILL_ENABLED="false"`.
2. Redeploy the frontend.
3. Confirm the SLA table is back to real values plus `—` gaps.
4. Stop any extra one-shot seed runs if they are still being scheduled manually.

## Notes
- The synthetic overlay expires naturally if the seed quote is not from the current ET day.
- This patch is intentionally reversible without touching the API, DB, or continuous RFQ workers.
