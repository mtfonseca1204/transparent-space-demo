# Transparent Space Global Context

Last verified: `2026-06-02`

This copy lives inside `transparent-space`. Keep it aligned with the equivalent `global-context.md` files in the sibling Transparent Space repositories.

## Verification Labels

- `verified live`: confirmed from Vercel, Railway, GitHub, or SSH during this session
- `verified from code`: confirmed from local repository files during this session
- `user-reported`: came from Bruno's project description and has not been independently confirmed live

## Team And Ownership Surface

- Team members: Bruno, Pedro, Federico (`user-reported`)
- Vercel frontend hosting is `verified live` under Bruno's Vercel workspace `bruno-eleodoro-rozas-projects`
- Railway infrastructure is `verified live` under Bruno's Railway workspace `Bruno Eleodoro Roza's Projects`
- Some credentials and service ownership had been described as living under Pedro in the past, but the current live Railway snapshot shows Helius, RFQ-provider, Redis, and Timescale-backed runtime wiring under Bruno's Railway project
- When memory and live platform state conflict, prefer live state and document the discrepancy

## Repository And Service Map

- `transparent-space`
  - Repo: `BrunoEleodoro/transparent-space` (`verified live`)
  - Role: main frontend and app surface (`verified from code`)
  - Deploy: Vercel project `transparent-space` (`verified live`)
  - Authenticated spaces include Worldchain, Kraken, Demo, Solana Foundation, Gensyn, Perle, Katana, Monad, 0G AI, and Hyperliquid. Demo is a protected fake-data organization at `/demo`: it reuses Kraken-like navigation and dashboards with synthetic three-letter random token + USDC/USDT pool labels, synthetic pool keys, local fixtures, local static token logos under `public/demo/logos/`, and anonymized MM labels, while auth/session/admin membership APIs stay live. Demo also resolves stale Kraken token/RFQ dashboard state and stale Kraken pool URLs into synthetic Demo symbols/pools before render, and `/demo/rfq` uses local quote-activity fixtures instead of the Solana indexer. `dev@transparent.space` is seeded as an explicit Demo member without changing credentials; later Demo users should be added through the Admin Panel/API. Gensyn has six Ethereum UniV4 pools plus one UniV3 pool in `lib/pools.ts` and currently remains admin-only unless `space_members` rows are added. Perle has Solana Raydium CLMM `PRL / USDC` plus BSC PancakeSwap Infinity CL `PRL / USDT`; it remains pool-only with a single birds-eye `Pools` tab. Katana has Sushi V3 `vbUSDC / vbETH` at `0x2a2c512beaa8eb15495726c235472d82effb7a6b`; it remains pool-only/RFQ-disabled and seeds `katana@transparent.space` as a Katana member with initial password rotation required. Monad has Uniswap V2 `DUST / USDC` at `0x86dbf00485871c901c5129bd525348db96c2eb2d`; it remains pool-only/RFQ-disabled and `supabase/migrations/011_monad_space.sql` seeds only the `spaces` row, so access is admin-only until memberships are added. 0G AI has two 0G mainnet V3 `W0G / USDC.e` pools, `0xCE77377CDfEb967FF2Bb6f223AE74e1ae8DCFC71` and Zia `0x159fe1d57b464eD60E2bfbBCA0dF444999131673`, plus BSC PancakeSwap V3 `0G / USDT` at `0x808a3f77c4be4e1ae5dab0f63cca2cbfde281dc5`; it remains pool-only/RFQ-disabled, keeps `0G` and `W0G` as separate assets, has no Merkl UI in v1, and `supabase/migrations/013_0g_ai_space.sql` seeds only the `spaces` row, so access is admin-only until memberships are added. Hyperliquid has no pool catalog entries; `/hyperliquid` renders a HIP-3-focused dashboard for `nova-para-avgo` through the Solana indexer HIP-3 endpoints and is seeded by `supabase/migrations/012_hyperliquid_space.sql` with admin-only access until memberships are added. The Monad `spaces` row and Railway API/indexer services were verified live on `2026-05-17`. The Hyperliquid frontend route and seed migration were verified from code on `2026-05-25`, and the upstream HIP-3 Solana indexer endpoint was verified live by HTTP on `2026-05-25`. The Q&A tab was removed from all dashboards on `2026-05-14`. Perle's Supabase `spaces` row was verified live on `2026-05-04` with no `space_members` rows.
  - Public xStocks Weekend Movers is code-supported at `/xstocks`, with `xstocks.transparent.space` middleware rewrite support pending live Vercel domain verification. It reads the Solana indexer `GET /api/public/xstocks/weekend-movers-template` endpoint server-side, uses vendored official xStocks brand lockups from `public/xstocks/brand/`, and renders per-token row logos through the same-origin proxy `GET /api/xstocks/logo?t=<TICKER>` (the indexer returns absolute `xstocks-metadata.backed.fi` URLs in `MOVERS[].logo`, but that host returns no CORS headers, which breaks the `crossOrigin="anonymous"` loads required for the `html-to-image` PNG export).
- `indexer-worldchain`
  - Repo: `pdotall/indexer-worldchain` (`verified live`)
  - Role: Worldchain v3/v4 indexer plus REST API; same codebase also powers isolated Gensyn Ethereum, BSC, Katana, Monad, and 0G services (`verified live 2026-05-17` for Monad API/indexer; 0G verified live 2026-05-26)
  - Deploy: Railway service `indexer-worldchain` serving Worldchain API plus `indexer-gensyn-api` and `indexer-gensyn-indexer` for Gensyn (`verified live`)
  - BSC deploy: Railway services `indexer-bsc-api` and `indexer-bsc-indexer` for BSC PancakeSwap Infinity CL (`verified live`)
  - Katana deploy: Railway services `indexer-katana-api` and `indexer-katana-indexer` for Sushi V3 vbUSDC/vbETH, two-week pilot starting at block `30921479` (`verified live`, 2026-05-15)
  - 0G deploy: Railway services `indexer-zerog-api` and `indexer-zerog-indexer` for 0G mainnet V3 W0G/USDC.e pools on chain `16661`; original pool deployed on `2026-05-26` after the final 0G RPC passed historical `eth_getLogs` windows of `2000` blocks, and Zia pool `0x159fe1d57b464eD60E2bfbBCA0dF444999131673` was verified from Merkl/public RPC on `2026-06-02` pending env rollout
- `indexer-solana`
  - Local repo directory: `transparent-space-solana-indexer` (`verified from code`)
  - Remote repo: `BrunoEleodoro/indexer-solana` (`verified live`)
  - Role: Solana pool indexing, RFQ capture, API, Dune-backed xStocks flow ingestion, HIP-3 market-quality capture, and execution-side experiments (`verified from code`)
  - Deploy: split across Railway and AWS VPS (`verified live`)

## Verified Live Platform State

### Vercel

- Project: `transparent-space`
- Project ID: `prj_d0Usi1e8SJbWc7zCxro2tn8tdIcw`
- Team: `team_mCiN1eTAr2CJBp2dTY6h2dJD`
- Verified domains include:
  - `transparent.space`
  - `app.transparent.space`
  - `transparent-space.vercel.app`
- Verified Perle preview:
  - `https://transparent-space-eenukrpai-bruno-eleodoro-rozas-projects.vercel.app`
  - branch alias `https://transparent-space-git-code-feaa04-bruno-eleodoro-rozas-projects.vercel.app`
  - branch-scoped preview env points Solana indexer calls at `https://indexer-solana-perle-api-preview-production.up.railway.app`
- Latest verified production deploy on `2026-03-31`

### Railway

- Project: `Transparent Space Infra`
- Environment: `production`
- Verified services currently present and reporting `SUCCESS`, `stopped=false`:
  - `indexer-solana`
  - `indexer-worldchain`
  - `indexer-gensyn-api`
  - `indexer-gensyn-indexer`
  - `indexer-bsc-api`
  - `indexer-bsc-indexer`
  - `Redis`
  - `indexer-solana-rfq-bebop-a`
  - `indexer-solana-rfq-bebop-b`
  - `indexer-solana-rfq-jupz-a`
  - `indexer-solana-rfq-jupz-b`
- Verified public Railway domains:
  - `indexer-solana-production.up.railway.app`
  - `indexer-worldchain-production.up.railway.app`
  - `indexer-gensyn-api-production.up.railway.app`
  - `indexer-bsc-api-production.up.railway.app`
- Redis has a verified mounted volume in region `us-east4-eqdc4a`

### AWS VPS

- Verified host: `35.169.61.217`
- Verified remote repo path: `/home/bitnami/indexer-solana`
- Verified active systemd units:
  - `indexer-solana-complete`
  - `indexer-solana-rfq-0x`
  - `indexer-solana-rfq-1inch`
  - `xstocks-arb-dashboard`
- Verified inactive systemd unit:
  - `indexer-solana-rfq-jupz`

## Cross-Project Data Flow

1. Users access `transparent-space` through Vercel.
2. The frontend reads Solana data from `indexer-solana-production.up.railway.app` through REST clients and hooks; Kraken's Flows chart uses the Solana API's Dune-backed `/api/xstocks/flow-to-users` endpoint, `/xstocks` uses the public-safe Solana API `/api/public/xstocks/weekend-movers-template` endpoint, and `/hyperliquid` uses the Solana API's HIP-3 endpoints `/api/hip3/markets` and `/api/hip3/market-quality` for read-only Hyperliquid market quality. The HIP-3 ingestion worker has no active deployment as of `2026-05-28` while the client deal is under review, so `/hyperliquid` can show stale stored data until the worker is restarted. Perle preview branches should override the Solana API envs to the Perle Railway API preview before testing `/perle`.
   - Quote Activity Timeline preview branches should override `NEXT_PUBLIC_SOLANA_INDEXER_API_URL` and `SOLANA_INDEXER_API_URL` to a dedicated Solana API Railway preview service before testing `/kraken`, then switch back to the production Solana API only after approval.
3. The supported frontend pool dashboards read Worldchain data through the Railway REST API at `indexer-worldchain-production.up.railway.app`, either directly from server code or through `/api/worldchain-entities`.
4. The Gensyn space uses the same frontend EVM indexer path, routed by pool/network to `indexer-gensyn-api-production.up.railway.app`.
5. The Perle BSC pool uses the same frontend EVM indexer path, routed by pool/network to `indexer-bsc-api-production.up.railway.app` unless `BSC_INDEXER_API_URL` overrides it.
6. The Katana Sushi V3 pool uses the same frontend EVM indexer path, routed by pool/network to `indexer-katana-api-production.up.railway.app` unless `KATANA_INDEXER_API_URL` overrides it.
7. The Monad Uniswap V2 pool uses the same frontend EVM indexer path, routed by pool/network to `indexer-monad-api-production.up.railway.app` unless `MONAD_INDEXER_API_URL` overrides it (`verified live 2026-05-17`).
8. The 0G AI pool dashboard uses the same frontend EVM indexer path for both chains: both 0G mainnet W0G/USDC.e pools route by `chainId=16661` to `indexer-zerog-api-production.up.railway.app` unless `ZEROG_INDEXER_API_URL` overrides it, while BSC 0G/USDT routes by `chainId=56` to `indexer-bsc-api-production.up.railway.app` unless `BSC_INDEXER_API_URL` overrides it. The final 0G RPC passed the historical log-range gate on `2026-05-26`, and the Railway backfill is running in the isolated `zerog` schema. The Zia pool was added to the frontend catalog on `2026-06-02`; production indexing still requires the 0G Railway env rollout to list both 0G mainnet pools. On `2026-05-27`, the BSC 0G/USDT env rollout was applied to `indexer-bsc-api` and `indexer-bsc-indexer`; `/api/health` shows the V3 pool plus the existing Perle Pancake Infinity CL pool, and `/api/status` shows live `pool:` / `npm:` checkpoints backfilling.
9. Demo uses the frontend app-local fake-data boundary instead of external data systems: synthetic `demo-*` pool keys and `space=demo` requests must resolve from `lib/demo/*` fixtures before Solana RPC, Railway indexers, CoinGecko, Kraken/FMP/Finnhub, Telegram, Hyperliquid, Envio/GraphQL, or xStocks live endpoints can run. Demo-visible pool labels use three-letter random token symbols paired with USDC/USDT, not xStock symbols; Demo token icons use local static logos from `public/demo/logos/`; and real market-maker names are masked.
10. Legacy GraphQL helpers still exist for unsupported/debug EVM paths, but supported spaces should not add new browser-side GraphQL calls.
11. Solana on-chain ingestion runs primarily on the AWS VPS and writes to Postgres/Timescale-backed storage used by the Railway API.
12. Worldchain API is verified on Railway; the Gensyn API and indexer are verified running on Railway.
13. Redis is used as shared cache infrastructure for the Solana API path.

## External Systems

- Vercel: frontend deploys and env management (`verified live`)
- Railway: Solana API, Worldchain API, Gensyn API/indexer, BSC API/indexer, Katana API/indexer, Monad API/indexer, 0G API/indexer, Redis, RFQ shard services (`verified live`; Monad verified 2026-05-17, 0G verified 2026-05-26)
- AWS VPS: Solana complete indexer and selected RFQ workers (`verified live`)
- Timescale/Postgres: active in Railway envs (`verified live`)
- Helius: active in Railway envs for Solana ingestion (`verified live`)
- Supabase: frontend integration (`verified from code` and env inventory)
- CoinGecko: frontend oracle and cron use (`verified from code` and Vercel env inventory)
- Resend: contact/email flow (`verified from code` and Vercel env inventory)
- Telegram: alerting and bot-related flows (`verified from code` and Vercel env inventory)
- Dune: Solana indexer runtime source for Kraken xStocks flow-to-users query `7549048`; `DUNE_API_KEY` belongs only in the indexer runtime/Railway secrets, not frontend env (`verified from code`)
- Hyperliquid: source of HIP-3 order-book, account, fills, markout, and replenishment data captured by the Solana indexer worker and consumed by the frontend `/hyperliquid` space. The worker has no active deployment as of `2026-05-28` while the client deal is under review, so only stored data remains available until restart.
- Retired hosted-subgraph tooling is not a current external system for this repo (`verified from code` on `2026-04-29`)

## Secret Handling Rules

- Never store raw secret values in repo docs.
- Document env var names and locations only.
- Use `/Users/bruno/Documents/GitHub/_transparent-space-private` for sensitive operational context.
- Known exception to clean secret handling: `transparent-space/app/api/finnhub-candles/route.ts` contains a hardcoded FMP key in code. Do not copy the value into docs; treat it as migration debt.
- Solana Foundation initial user access is planned for `private@transparent.space`, and `dev@transparent.space` should also have access through the seeded Solana Foundation membership. Temporary passwords or credential changes must be created through the Admin Panel/API and kept outside the repo.

## Documentation Maintenance Rule

- Any AI-driven change that affects behavior, architecture, infra, env vars, services, endpoints, ownership, or workflows must update the relevant docs in the same task.
- If no doc update is required, the agent must say `No documentation impact`.
