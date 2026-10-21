# AGENTS.md

## Documentation Contract

- Read this file before planning, coding, or reviewing.
- If you change behavior, architecture, infrastructure, env vars, services, endpoints, ownership, or workflows, update the affected docs in the same task.
- Treat stale documentation as a bug, not optional cleanup.
- If a task truly has no documentation impact, say `No documentation impact` explicitly in the handoff.

## Repo Snapshot

- Repository: `BrunoEleodoro/transparent-space`
- Role: main Transparent Space frontend and application surface
- Runtime: Next.js on Vercel
- Last verified platform snapshot: `2026-04-01`

## Read Order

1. `docs/ai/project-context.md`
2. `docs/ai/frontend-pool-chart-catalog.md` for pool dashboard work
3. `docs/ai/global-context.md`
4. `docs/ai/documentation-policy.md`
5. If infra-sensitive context is needed and this machine has it, read `/Users/bruno/Documents/GitHub/_transparent-space-private/AGENTS.md`

## Safe Commands

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run lint`
- `vercel project ls --scope bruno-eleodoro-rozas-projects`
- `vercel env ls production --scope bruno-eleodoro-rozas-projects`
- `vercel inspect <deployment-url> --scope bruno-eleodoro-rozas-projects`

## Doc Impact Checklist

- Did I add or change a feature, page, component flow, API route, cron, or alert?
- Did I add, remove, rename, or rewire a pool analytics chart or its data inputs?
- Did I change how this repo reads Solana, Worldchain, Envio, Supabase, CoinGecko, or Telegram data?
- Did I add or rename an env var, external dependency, deploy target, or operational command?
- Did I change anything that another agent would need to know before working here?
- If yes, update `docs/ai/*` before finishing.

## Guardrails

- Never write secret values into repo docs.
- Document env var names, owners, locations, and usage, not their values.
- Prefer live platform facts over memory when they conflict.
- Keep this repo's docs aligned with the private ops pack when infra changes.
- Pool dashboard display/TVL changes must preserve space- and pool-specific behavior. In particular, Worldchain `wARS / USDC` v4 is intentionally special-cased: its display ratio remains `wARS per USDC` through `getPoolDisplayPair` and `lib/__tests__/pool-display.test.ts`, and all-zero indexed `Pool.tvlToken0` / `Pool.tvlToken1` rows remain unusable through `hasUsableIndexedV4Tvl` and `lib/__tests__/v4-tvl-source.test.ts` so the frontend can fall back to active-position TVL. Do not replace these with a broad v4/token-ordering rule unless every affected pool dashboard is audited and tests/docs are updated in the same change.
- Before changing pool price orientation, v4 TVL source selection, pool token ordering, or chart USD conversion, inspect recent commits around `components/dashboard/dashboard.tsx`, `lib/pools.ts`, `app/api/pool/[address]/route.ts`, `lib/pool-display.ts`, and `lib/v4-tvl-source.ts`, then run the targeted tests that cover the affected rules.
