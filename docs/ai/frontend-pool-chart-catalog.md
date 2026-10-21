# Frontend Pool Chart Catalog

Last verified: `2026-06-02`

This file maps the pool-level analytics cards rendered by `components/dashboard/dashboard.tsx`. It is meant to help AI agents quickly answer three questions before touching the frontend:

1. Which chart/card is this?
2. Which frontend endpoints or data hooks feed it?
3. What does the frontend join or derive before plotting it?

## Scope Notes

- The chart titles below use the product labels visible in the UI. Some titles are dynamic in code.
- Example: `WLD Price (USD) (1d)` is the dynamic price card rendered as `${token0Symbol} Price (USD) (${timeRange})` when USD conversion is available.
- Several data paths depend on pool family:
  - Solana / Raydium / Meteora pools mostly flow through Next.js API routes that proxy to Railway.
  - Demo uses synthetic `demo-*` Solana pool keys, three-letter random token labels paired with USDC/USDT, and `space=demo` request guards. Those paths must return local `lib/demo/*` fixtures before any live Railway, Solana RPC, CoinGecko, Kraken/FMP/Finnhub, Envio/GraphQL, Telegram, Hyperliquid, or xStocks endpoint can run.
  - Perle has a Solana / Raydium pool and a BSC / PancakeSwap Infinity CL pool. The Solana pool uses the same Solana Railway proxy paths as other Raydium dashboards; the BSC pool uses the same EVM Railway REST entity shape as v4 pools.
  - Katana has one Sushi V3 vbUSDC/vbETH pool. It uses the same EVM Railway REST entity shape as v3 pools and routes to the Katana indexer by pool/network.
  - Monad has one Uniswap V2 DUST/USDC pool. It uses the EVM Railway REST path routed by pool/network to the Monad indexer, but the main `/monad` dashboard intentionally disables generic concentrated-liquidity range/LP analytics. For the Monad DUST/USDC V2 pool, `/monad` embeds V2-native liquidity-distribution and LP-share charts from reserve-backed pool state and LP token transfers; `/monad/v2` remains a direct fallback route for the same module. Keep generic V2-specific frontend behavior in `lib/evm-v2-pool-support.ts` and `hooks/use-v2-pool-data.ts`; keep the Monad-only V2 chart surface under `components/monad-v2/*` and `app/api/monad-v2/*`.
  - 0G AI has two 0G mainnet V3 W0G/USDC.e pools and one BSC PancakeSwap V3 0G/USDT pool. All three use the same EVM Railway REST entity shape as v3 pools; the two 0G mainnet pools route to the 0G indexer by `chainId=16661`, while the BSC pool routes to the BSC indexer by `chainId=56`. The production 0G API/indexer is live for the original W0G/USDC.e pool and needs the 2026-06-02 Zia env rollout before listing the second 0G mainnet pool; the BSC 0G/USDT env rollout was applied on `2026-05-27` and live `pool:` / `npm:` checkpoints are backfilling.
  - Worldchain, Gensyn, BSC, Katana, Monad, and 0G indexer pools use a mix of Next.js API routes and `lib/worldchain-indexer-client.ts`.
  - Legacy unsupported EVM fallback code may still use Envio/GraphQL, but supported spaces should not add new browser-side GraphQL calls.

## Shared Data Feeds

### Pool Snapshot

- Primary hook: `useUnifiedPoolData`
- Main inputs:
  - `GET /api/pool/:poolKey` for v2, v3, v4, Raydium, and Meteora pools
  - Demo synthetic pool keys return fixture snapshots from `lib/demo/fixtures.ts` and set a demo source header; they should not reach live pool fetchers.
  - v2/v3/v4 EVM snapshots are resolved server-side so Worldchain/Gensyn/BSC/Katana/Monad/0G pool routing and chain-specific token metadata stay on one path
  - V2 pools enter through `hooks/use-v2-pool-data.ts`, which currently wraps the shared snapshot endpoint and is the extension point for future V2-only fetch behavior.
- Used for:
  - `currentPrice`
  - `tick`
  - `sqrtPriceX96`
  - `liquidity`
  - token symbols and decimals
  - token balances when available
  - pool TVL; v2 overview surfaces use reserve-backed indexed balances from `Pool.tvlToken0` / `Pool.tvlToken1`; v4 overview surfaces prefer indexed PoolManager balances from the same fields when `/api/pool/:poolKey` marks `v4TvlSource: "indexed-pool"`, then fall back to active position-derived token balances, then tick-liquidity reconstruction. The `wARS / USDC` Worldchain v4 pool intentionally treats all-zero indexed TVL rows as unavailable so it can use the active-position fallback.
  - explicit no-active-liquidity states for v4 pools whose indexed PoolManager balances are nonzero but whose current `Pool.liquidity` and active LP position rows are zero

### Candle History

- Primary hook: `useLPHistoricalData`
- Main endpoint: `GET /api/candles?pool=...&interval=...&startTime=...&endTime=...`
- Upstream behavior:
  - Demo: returns local fixture candles for `demo-*` pool keys
  - Solana: proxies to Railway candle/chart endpoints
  - Worldchain/Gensyn/BSC/Katana/Monad/0G indexer pools: pulls from Railway candle entities through the Next.js proxy, with a longer short-lived cache for aggregated candle responses
  - Legacy unsupported EVM pools: may fall back to server-side GraphQL inside API routes
- Used for:
  - OHLC price series
  - volume bars in the price chart
  - the base time axis for the LP historical monitor

### Batched Historical Pool Data

- Primary hook: `useLPHistoricalData`
- Main endpoint: `GET /api/pool-data?...&include=positions,events,hours,lp-activity`
- Used for:
  - current position snapshot for rollback-aware charts
  - LP events
  - hourly candles / liquidity rows
  - precomputed LP activity series when present
  - Demo: the same response shape is generated locally by `getDemoPoolDataResponse()` for every Demo pool

### Owner Position Snapshots

- Main hooks:
  - `useAllPoolPositions`
  - `useAllLPPositions`
  - `usePositionsByOwner`
- Birds-eye Pools table:
  - `useBirdsEyeData` reads the batched `GET /api/birds-eye-snapshot?space=...` response for Solana-only spaces and now exposes `positions`, `token0Usd`, `token1Usd`, and `isTrackedToken0` on each pool card.
  - The Q&A tab was removed from all dashboards on `2026-05-14`. Gensyn and Perle now show only the birds-eye `Pools` tab. The `GensynQaTab` / `PerleQaTab` exports, the `QaDashboard` wrapper, the `{ kind: "qa" }` DashboardView, and the sidebar Q&A entrypoint are deleted; token-view-store v3 migrates persisted `qa` views to `birds-eye`.
  - `BirdsEyeLpAggregateTable` values every active position with `lib/uniswap-v3-math.ts`, aggregates by LP owner across all birds-eye pools, and renders the Top LPs ranking above the existing asset/pool overview table. It receives the active `spaceSlug` for shared LP labels so Solana Foundation and Demo market-maker masking still applies.
  - `BirdsEyePriceComparisonChart` (`components/dashboard/birds-eye/birds-eye-price-comparison-chart.tsx`) renders only for the 0G AI space, inserted in the `Pools` tab immediately above `BirdsEyeLpAggregateTable` (the Top LPs section). It plots both 0G pool prices (W0G/USDC.e on 0G mainnet and 0G/USDT on BSC, via `usePoolCandles` with each pool's decimals — pool price is `token1/token0`, i.e. USD per 0G) against the Binance spot `0GUSDT` close reference (`useBinanceKlines` → `GET /api/binance-klines`, sourced from Binance public market data, https://github.com/binance/binance-public-data/) on one shared visx line chart with a 1D/3D/7D/30D selector (candle resolution auto-scales per range: 5m/15m/1h/4h). Clicking a legend entry toggles that series off and rescales the axes. Directly below the price lines it appends a `Price Deviation vs Binance (bps)` panel sharing the same time axis: per visible pool it plots `(pool / binance − 1) × 10_000` aligned by candle bucket, on a symmetric zero-centred axis with a zero reference line. The pool set is fixed config in the component (mirrors `ZEROG_ARB_POOLS` in `app/api/arb-volume/route.ts`); the chart is gated by `spaceSlug === ZEROG_SPACE_SLUG` and lazy/viewport-deferred like the other Pools sections.
  - `BirdsEyeLiquidityFragilityTable` (user-facing title: `Liquidity Resilience`; Depth section, rendered immediately below `BirdsEyeRoutingTable` and above the Pool Health table) renders a tracked-asset selector tab strip (token icon + symbol + pool count, mirroring the `BirdsEyeRoutingTable` tabs) above a single `FragilityCard` for the selected asset. The default selection is the asset with the highest active liquidity. Each card stacks two charts in the left column that share a unified USD-per-asset price X axis (±50% around spot, log-spaced into 60 bins): `LiquidityByPricePanel` on top and `ImpactByPricePanel` below. The wrap div owns a single `hoverPriceUsd` state — its `onMouseMove` maps cursor X via `priceUsdOfX` and both panels render their crosshair from the same value, so the hover line crosses both charts and each panel emits its own tooltip (LP breakdown above, order-size needed to reach that target price below). The liquidity panel aggregates each pool's positions via `buildLiquidityBins`: for every (pool × LP × position × bin) it intersects the position's tick range with the bin's tick range in that pool's tick space (mapped from USD-per-asset using the pool's `token0Usd`/`token1Usd` and `isTrackedToken0`), then values the intersection with the same Uniswap-v3 sqrt-price math as `LPRangesByAddressChart.calcLPValueAtTick`. Fees are intentionally not applied — bars show raw on-chain liquidity, not fee-adjusted depth. Bars are stacked by LP owner with a stable color from `LP_COLORS` for the top 10, plus a single gray `OTHERS_COLOR` segment aggregating every LP outside the top 10 (counted but not individually toggleable; surfaced as a non-clickable footer row in the right LP panel and as a segment + tooltip entry in the chart). Toggling top-10 LPs in the right panel removes their contributions from both the liquidity bars and the order-size curves in the same render pass; the Others bucket is unaffected. The impact panel inverts a *dense* routing-engine sweep so the curves span the full ±50% X axis instead of clustering near spot. `computeImpactCurve` runs `routePreparedOrderAcrossPools` at 25 log-spaced sizes from $1k to $10M (real engine output, not extrapolation; with monotone-non-decreasing enforcement and capacity-asymptote handling), and `orderSizeForImpact` bisects within that sampled range to find the order size that yields the impact required to push price to each X-axis target. Targets beyond the largest sampled impact (physically unreachable for the pool set) drop out of the curve rather than producing extrapolated nonsense. Y axis is data-driven and log-scaled — bounds snap to the powers of 10 just outside the actual curve min/max so ticks always land on round labels and we never waste vertical space on empty decades. Buy curve sits right of spot, sell curve sits left. Top-10 LPs are computed by valuing each LP's positions against the live pool price (same `amountsForPosition` math as the LP Aggregate table). Each row is a checkbox; checking an LP rebuilds `RoutingPoolInput.positions` for each pool with that owner's positions filtered out, then re-runs `prepareRoutingPools` + `routePreparedOrderAcrossPools` for the same $1k/$5k/$10k/$25k/$50k/$100k sweep. The chart renders only the buy/sell impact lines (no stacked routing bands): faint dashed = baseline (all LPs), solid bold = scenario (selected LPs removed). A side stat strip shows removed TVL absolute + %, and baseline → scenario impact at **$10k** for both buy and sell (`KPI_ORDER_SIZE_USD = 10_000`, indexed into the `SIZE_SAMPLES` buckets via `KPI_ORDER_SIZE_INDEX` — **not** `buys[length-1]`, which is the $100k sample; that off-by-the-wrong-bucket read previously made the "@ $25k"-labeled KPI actually show the $100k impact, ~5–7× too high and inconsistent with the routing chart). Lives inside the same `useNearViewport` lazy gate as `BirdsEyeRoutingTable` so the expensive simulations don't run before the user scrolls into the Depth section.
  - `BirdsEyeRoutingTable` (Depth section, rendered between the LP Aggregate table and `BirdsEyeLiquidityFragilityTable`) groups pool cards by tracked asset and runs prepared routing helpers from `lib/routing-engine.ts` for $1k/$5k/$10k/$25k/$50k/$100k buy and sell orders. `prepareRoutingPools` builds each pool range map once, then `routePreparedOrderAcrossPools` reuses that prepared pool set across all dashboard order-size samples. `useBirdsEyeRouting(cards, { enabled })` must stay gated by the Depth viewport lazy render in `BirdsEyeDashboard`, so the expensive route simulations do not run while the user is still above the Depth section. The router solves the Lagrangian split — water-fill on a post-fee marginal "$-out per $-in" water level — using `swapBuyToSqrtLimitOnRangeMap` / `swapSellToSqrtLimitOnRangeMap` (V3 swap-to-sqrt-limit helpers in `lib/depth-calculator.ts`) so a single-pool optimum falls out naturally when one venue dominates. The component renders an interactive SVG: stacked pool-share bands across order sizes (log-scale x-axis, $1k–$100k), buy/sell impact lines on a sqrt-scaled right axis with a dynamic 0–10% default cap (auto-scales up to 25/50/100% when an asset's worst-case impact exceeds the prior cap), and a hover crosshair that drives a floating tooltip plus a live legend panel with per-pool USD allocations. When not hovering it quotes the legend/impacts at `DEFAULT_DISPLAY_USD = 10_000` ($10k). The asset selector is a row of TokenIcon-anchored cards that disambiguate Byreal vs Raydium pools by `SupportedPool.key` rather than `protocol`.
  - `BirdsEyeFlowsChart` renders Kraken's Dune-backed xStocks flow-to-users chart from the Solana indexer endpoint `/api/xstocks/flow-to-users`, using project series such as JupiterZ, Raydium, Orca (Whirlpool), and Meteora. Demo remains local-fixture backed and anonymized.
  - `BirdsEyeFlowsCostChart` renders the Flowdesk Funding opportunity-cost view for Kraken and the anonymized Liquidity Funding view for Demo. It lets the user choose whether the one-year AUM projection keeps growing by the observed average daily net-flow rate or holds today's AUM constant. The selected mode changes only the projected management-fee income curve; the realized loan-live window still comes from observed net-flow days.
  - `BirdsEyeDashboard` should also keep tab-level data gated: `useBirdsEyeData` is enabled only for `Pools`/`RFQ`, and full RFQ table config/data is enabled only for the `RFQ` tab. Kraken and Demo expose an RFQ Directory separate from the RFQ tab at `/kraken/rfq` and `/demo/rfq`: it renders `BirdsEyeQuoteActivity` with a `7D` default selector plus a `14D` option. Kraken fetches `GET /api/rfq/quote-activity?days=...` through `hooks/use-rfq-quote-activity.ts`, while Demo short-circuits to `getDemoQuoteActivity()` from `lib/demo/fixtures.ts` before any indexer fetch, then both paths group uptime/breach summaries by asset. The Quote view renders each asset as a bracketed terminal-style card with a header bar (circular asset logo from `xstocks-metadata.backed.fi`, asset, `Core`/`Tail` badge, active age, venue count, window-scoped Quote Success %, fail count, channel index, Healthy/Down badge) above a body grid with one hourly timeline row per active venue/provider plus per-venue `Health %` and `Fails` columns. Each venue row prefixes its label with a circular provider favicon from `RFQ_SOURCE_META`. The card body has no horizontal scroll — the timeline grid uses `minmax(0, 1fr)` so all hourly buckets and the daily UTC guide marks fit the card width. Hourly buckets are color-toned squares keyed to success rate (good >=95%, ok >=80%, warn >=60%, bad >=30%, critical below 30%, missing=pale emerald). Hovering/focusing an hourly bucket opens a viewport-clamped floating tooltip; clicking a venue's fail count expands that venue's failure windows. The displayed "Fails" terminology is a UI rename only — the underlying API and `QuoteActivityProviderSummary.breaches` field are unchanged. The 30D full-registry view is intentionally deferred until the Solana indexer has a pre-aggregated/materialized path. The `SLAs` tab has its own lighter path with filtered daily buckets and `useBirdsEyeRfqData({ includeOraclePrices: false })`.
  - Kraken RFQ depth split uses `useRfqAssetsConfig()` against Solana indexer `GET /api/rfq/assets-config` to classify `core20` vs `tail` assets. The registry path is enabled by default when `NEXT_PUBLIC_SOLANA_INDEXER_API_URL` exists; `NEXT_PUBLIC_BIRDS_EYE_RFQ_REGISTRY_ENABLED=false` is only a kill switch. If registry fetch fails, it falls back to pool-backed/local config.
- Network path depends on pool family:
  - Demo: local fixtures from `lib/demo/*` via the same app routes/hooks
  - Solana / Raydium / Meteora: `GET /api/pool-data?...&include=positions`
  - Meteora owner summary fallback: `GET /api/lp/summary?pool=...`
  - Worldchain/Gensyn/BSC/Katana/Monad/0G indexer pools: Railway entity fetch helpers in `lib/worldchain-indexer-client.ts`, routed by pool/network
  - Legacy unsupported EVM pools: GraphQL fallback code remains, but supported pool dashboards should avoid direct browser GraphQL
- Used as the TVL fallback for v4 overview surfaces when `/api/pool/:poolKey` does not expose usable indexed PoolManager balances: the frontend values active positions with `sqrtPriceX96`, `tickLower`, `tickUpper`, `liquidity`, token decimals, and the Token USD Map. The same position-derived token balance should feed the pool header/token breakdown, the in-range liquidity denominator, and LP concentration fallback sizing before tick-liquidity reconstruction is considered. For `wARS / USDC`, zero indexed balances are not usable because they hide real active LP positions. V2/Monad pools do not enter this fallback; their reserves are the pool-level token balances.

### Tick Liquidity

- Main hooks:
  - `useTickLiquidity`
  - `useTickLiquidityFullRange`
- Network path depends on pool family:
  - Legacy unsupported EVM pools: GraphQL `tickLiquidities`
  - Worldchain/Gensyn/BSC/Katana/0G Railway `TickLiquidity`
  - Monad / V2 Railway pools return no tick liquidity; V2 dashboards should render capability-driven unavailable states for range-liquidity views.
  - Solana / Raydium pools do not use GraphQL tick-liquidity queries; the Railway `/api/pool-data` path returns positions and `tickLiquidities: []`, and the frontend derives range liquidity from positions.
- Used as fallback when position-based reconstruction is unavailable.

### Daily Pool Stats

- Main hook: `usePoolDayData`
- Network path:
  - Solana pools: `GET /api/pool-data?...&include=hours`, then aggregated client-side to daily
  - Worldchain / Gensyn / BSC / Katana / Monad / 0G indexer pools: Railway `PoolDayData` through `lib/worldchain-indexer-client.ts` and `/api/worldchain-entities`, avoiding the larger hourly `pool-data` payload when only daily stats are needed
  - Legacy unsupported EVM pools: GraphQL `poolDayDatas`
- Used for:
  - fee bars
  - daily volume
  - daily close-price maps for event replay

### Token USD Map

- Main hook: `useTokenPrices` / `useAllTokenPrices`
- Main endpoint: `GET /api/token-prices?source=coingecko`
- Gensyn token pricing uses the Ethereum AI/USDC/USDT fallback mappings in `app/api/token-prices/route.ts`; Katana token pricing maps vbUSDC/vbETH to USDC/ETH fallbacks there; Monad token pricing maps USDC to the USDC fallback and includes DUST as a known address with no hardcoded USD fallback yet; 0G token pricing maps both W0G and BSC 0G to `coingecko:wrapped-0g`, USDC.e to `coingecko:usd-coin`, and BSC USDT to `coingecko:tether`.
- Used for:
  - USD conversion of pool price
  - LP inventory valuation
  - fee and volume valuation
  - slippage normalization

### Monad V2 Native Charts

- UI surfaces: embedded in the main `/monad` DUST/USDC pool dashboard, with `/monad/v2` as a direct fallback route
- UI component: `components/monad-v2/monad-v2-dashboard.tsx`
- Main endpoint: `GET /api/monad-v2/dashboard`
- Main feeds:
  - Monad Railway `Pool` entity for reserve-backed `tvlToken0` / `tvlToken1`
  - Monad Railway `UniswapV2Pair_Transfer` rows for LP-token holder reconstruction
- Frontend assembly:
  - The endpoint is Monad-only and hard-scoped to the DUST/USDC V2 pair `0x86dbf00485871c901c5129bd525348db96c2eb2d`.
  - DUST USD price is pool-implied from reserves (`USDC reserve / DUST reserve`), so the V2 tent charts remain internally consistent even while DUST has no shared CoinGecko mapping.
  - LP shares are reconstructed by netting every indexed LP-token transfer, subtracting non-zero `from` balances and adding non-zero `to` balances; the zero address is excluded so mint/burn bookkeeping does not become a displayed LP.
  - The API response exposes source metadata for `Pool` reserve rows and `UniswapV2Pair_Transfer` LP rows. The route deduplicates concurrent reconstruction and keeps a short in-memory/edge cache so repeated dashboard loads do not page every LP transfer from Railway.
  - The dashboard renders the V2 charts as full-width rows; liquidity-distribution charts expose pool/token copy/explorer controls, and LP-share charts expose copy/explorer controls for each displayed LP address.
  - Chart math lives in `lib/monad-v2-dashboard.ts`: local and full-range views use a constant log tick ratio and compute the per-log-tick V2 value envelope from `L = sqrt(DUST reserve * USDC reserve)`.
  - The route does not extend `useUnifiedPoolData`, `useV2PoolData`, `useLPHistoricalData`, or the main dashboard chart capability map.
- Rendered charts:
  - Local `LIQUIDITY DISTRIBUTION`
  - Local `LP SHARES`
  - Full-range `LIQUIDITY DISTRIBUTION`
  - Full-range `LP SHARES`

### Historical Oracle

- Main hook: `useHistoricalOracle`
- Main endpoint: `GET /api/historical-prices?source=...&tokenAddress=...&startTime=...&endTime=...`
- Gensyn AI, Ethereum USDC, Ethereum USDT, 0G W0G, BSC 0G, 0G USDC.e, and BSC USDT are mapped directly to CoinGecko IDs for historical oracle lookups.
- Used for:
  - oracle overlays in the LP historical monitor
  - pool vs oracle spread chart
- If source is `dex-twap`, the frontend computes the oracle locally from candle closes.

### Trading Volume By Size Buckets

- Main hook: `useTradingVolumeBySize`
- Main endpoint: `GET /api/trading-volume-by-size?poolAddress=...&days=...&mode=aggregate...`
- Dashboard path uses pre-aggregated `dailyData`; it does not pass raw swap rows.

### V3 Swap History

- Main hook path: `useLPHistoricalData`
- Main endpoint: `GET /api/lp-swaps?pool=...&startTime=...&endTime=...`
- Used only for v3-only layers in `LP Activity - Historical Data`.

## Chart Catalog

### WLD Price (USD) (1d)

- UI component: `LightweightPriceChart`
- Main feeds:
  - Candle History
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - `useLPHistoricalData` builds `ohlcData` from `/api/candles`.
  - `dashboard.tsx` converts OHLC to USD through `poolUsdConv` when token USD prices exist.
  - If the preferred display pair is inverted, OHLC values are inverted and high/low are swapped.
  - Volume bars come from candle `volume1`.
- Plot style:
  - `lightweight-charts` candlestick chart with a transparent background and histogram volume strip.

### Liquidity Distribution

- UI component: `LiquidityDistributionChart`
- Main feeds:
  - Pool Snapshot
  - Owner Position Snapshots
  - Tick Liquidity fallback
  - Token USD Map
- Frontend assembly:
  - Prefers flattened live positions from `useAllPoolPositions`.
  - Falls back to full-range tick liquidity when position data is unavailable.
  - Perle BSC Pancake Infinity CL `PRL / USDT` is an explicit pool-level display exception: Liquidity Distribution uses Pancake `LPPosition` rows when available so the visible bars match LP-owner attribution charts; BSC Railway `TickLiquidity` remains the fallback when position rows are unavailable.
  - That Pancake exception is scoped to the Perle BSC pool only. Pancake LP attribution charts also use Pancake `LPPosition` rows for selected and other LP attribution inside the hovered bin, so they do not collapse Other LPs to zero when Pancake tick totals diverge from active position rows; other v4 pools, including Worldchain `wARS / USDC`, keep their existing source-selection behavior.
  - If the data source resolves successfully but all active range liquidity values are zero, the card renders a no-active-liquidity state instead of a zero-valued chart.
  - For Solana / Raydium, position data is the supported range-liquidity source; `useTickLiquidity` and `useTickLiquidityFullRange` are disabled to avoid leaking Solana pool keys into the legacy GraphQL path.
  - For each tick bar, the frontend recomputes token0/token1 amounts with Uniswap V3 math and values them in USD or quote units depending on pricing mode. Position-backed bars use the real overlap between each position range and display bin; tick-backed bars split the display bin at initialized ticks so narrow tick-liquidity changes inside a wider bin are not dropped.
  - When the active display pair is inverted, the chart reverses only the visual bin order so the displayed X-axis price still increases left-to-right; raw tick ordering and liquidity math remain unchanged.
  - `currentPrice`, `currentTick`, `currentLiquidity`, and `tickSpacing` define the visible window and bar sizing.
  - Bar width is controlled by the `useRealTickSpacing` setting in `chart-settings-store`:
    - `false` (default): aggregate to ~80 bars across the display range (±8000 ticks). Step snaps to `tickSpacing`.
    - `true`: each bar spans exactly one `tickSpacing`. Display range is additionally capped so bar count ≤ 200, centered on `currentTick`, to keep tight-spacing pools (e.g. Raydium CLMM tickSpacing=10) readable at default zoom.
  - Applies to all pool families — uses `poolData.tickSpacing` which is populated by Solana metadata, Worldchain v3/v4 indexer, and EVM v3 onchain paths.
- Plot style:
  - Custom SVG-style histogram rendered inside React with hover and zoom behavior.

### Price Impact

- UI component: `PriceImpactChart`
- Main feeds:
  - Pool Snapshot
  - Owner Position Snapshots
  - Tick Liquidity fallback
  - Token USD Map
- Frontend assembly:
  - Prefers position-based liquidity as ground truth.
  - Builds enriched tick lists from position boundaries.
  - Simulates buy and sell impact curves by walking liquidity across ticks and converting each incremental move into USD order size.
  - Falls back to tick liquidity when positions are not ready.
  - If current active pool liquidity is zero, the card renders a no-active-liquidity state because impact cannot be simulated from PoolManager TVL balances alone.
- Plot style:
  - Custom SVG curve chart with buy/sell impact lines over USD order size.

### Slippage History ($10k)

- UI component: `SlippageHistoryChart`
- Main feeds:
  - Owner Position Snapshots
  - LP events from `useLPEntryExitData`
  - Hourly pool data from `useHistoricalSlippage`
  - Token USD Map
- Main endpoints:
  - Solana / Worldchain: `GET /api/pool-data?...&include=hours,events`
  - Legacy unsupported EVM pools: GraphQL `poolHourDatas` plus `lpevents`
- Frontend assembly:
  - Starts from current live positions.
  - Replays LP events backwards per hour to reconstruct historical active liquidity.
  - For each hour, simulates a fixed USD order against the reconstructed range map.
  - Produces separate buy and sell slippage series.
- Plot style:
  - Visx time-series chart with two filled lines, one for buy slippage and one for sell slippage.
- Lookback: a dedicated **7/14/30/60/90/120-day** segmented selector in the chart header (`slippageLookbackDays` state, default 7D) — independent of the dashboard's global time-range. It drives a new `lookbackDays` override on `useHistoricalSlippage` (when set, `startTime = endTime − days·86400`, overriding the `ChartTimeRange` preset so 60/120D — which aren't presets — are selectable). The `startTime` is in the query key, so switching ranges refetches. For Worldchain/0G pools the hour+event window is fetched per-range from `/api/pool-data` (so longer ranges genuinely extend coverage, subject to indexer backfill); legacy EVM pools still roll back the passed-in 7-day `lpEvents`, so their long ranges are bounded by that event window.

### LP CONCENTRATION TVL

- UI component: `LPConcentrationChart`
- Main feeds:
  - Owner Position Snapshots
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - Re-values every active position at the current `sqrtPriceX96`.
  - Aggregates USD by wallet owner.
  - Sorts owners by USD value and passes every wallet to `LPConcentrationChart`; the renderer keeps the top 4 separate and groups the remaining LPs into `Others`.
  - Computes each wallet's percentage of total pool TVL.
  - If indexed PoolManager balances exist but active LP position rows are empty, the card renders a no-active-LP-position state because the TVL cannot be attributed to wallets.
- Plot style:
  - Treemap-style concentration view, not an XY line chart.

### Volume Concentration (24h)

- UI component: `LPConcentrationChart`
- Main feeds:
  - Owner Position Snapshots
  - Hourly candles / hours from `useVolumeAttributionHourly`
  - Token USD Map
- Main endpoints:
  - Solana: `GET /api/pool-data?...&include=hours`
  - Worldchain: Railway `PoolCandle` entity fetch
  - Legacy unsupported EVM pools: no supported browser-side GraphQL path
- Frontend assembly:
  - For each 1h bucket, finds which LP positions were in range at `tickClose`.
  - Attributes that hour's volume proportionally to active liquidity share.
  - Sums attributed USD volume across the last 24h.
  - Sorts by `volumeUsd` and passes every LP to `LPConcentrationChart`; the renderer keeps the top 4 separate and groups the remaining LPs into `Others`.
- Plot style:
  - Same treemap renderer as LP concentration, but the value being visualized is attributed volume instead of TVL.

### LP Efficiency

- UI component: `LPComparisonTable`
- Main feeds:
  - LP CONCENTRATION TVL derived output
  - Volume Concentration derived output
- Frontend assembly:
  - Recomputes every LP's liquidity share in USD.
  - Joins that with hourly-attributed volume share by address.
  - Computes an efficiency ratio from `volumePct / liquidityPct`.
- Plot style:
  - Table-style comparison card, not a plotted SVG chart.

### LP Activity - New vs Exits (7 days)

- UI component: `LPEntryExitChart`
- Main feeds:
  - LP events from `useLPEntryExitData`
  - raw LP events
  - Token USD Map
  - Owner Position Snapshots for contextual labels
- Main endpoints:
  - Solana / Worldchain: `GET /api/pool-data?...&include=events`
  - Legacy unsupported EVM pools: GraphQL `lpevents`
- Frontend assembly:
  - `useLPEntryExitData` builds aggregate entry/exit counts by day bucket.
  - The chart also receives `rawEvents` to compute USD-sized mint/burn movements and richer hover details. For Railway v4 pools whose event rows expose liquidity deltas instead of token amounts, it values each movement from `liquidityDelta`, tick range, and current `sqrtPriceX96`.
  - `positionsByOwner` is passed so the chart can contextualize LP identity and current ownership.
  - For pools displayed in inverted price convention, the dashboard requests oracle history for the displayed non-stable token side and recomputes displayed price deviation after OHLC conversion. This keeps Perle BSC `USDT/PRL` raw pool prices from being compared against the USDT `$1` oracle.
- Plot style:
  - Mixed custom chart with positive/negative bars plus an active-addresses line.

### Historical Liquidity Depth (heatmap)

- Card id: `capital-efficiency` (unchanged for layout continuity; `stores/grid-layout-store.ts` entry and tab gating are the same — Overview / Performance).
- UI component: **`HistoricalLiquidityDepthHeatmap`** (`components/dashboard/historical-liquidity-depth-heatmap.tsx`). A Bookmap / Sierra-Chart "Market Depth Historical Graph" style heatmap: **X = time, Y = price, color gradient = liquidity depth** at that price over time, with the pool price line overlaid. It keeps Pedro's Canvas-2D renderer, controls, hover crosshair, tooltip, colorbar, Fixed vs Follow price modes, Percentile vs Log scale, and Precise vs Peak depth mode.
- The legacy `CapitalEfficiencyChart` band/density view was **removed** (file `components/dashboard/capital-efficiency-chart.tsx` deleted); the heatmap is the sole renderer for this card.
- Heatmap data path:
  - Frontend hook: `hooks/use-liquidity-depth.ts` calls same-origin `GET /api/liquidity-depth`.
  - Server route: `app/api/liquidity-depth/route.ts` proxies Raydium CLMM pools to the Solana indexer native endpoint and allowlisted 0G mainnet V3 pools to `ZEROG_INDEXER_API_URL` with `chain_id=16661`. Both upstreams expose `GET /api/charts/liquidity-depth?pool=&window_days=&resolution=&price_bins=`, with EVM also receiving `chain_id`. The route is `force-dynamic` / `no-store` so it does not serve stale materialized grids during preview or prod deploys.
  - Indexer payload: `{ times, priceBins, values, priceLine, owners, ownerBands, quality, meta }`, where `values` is the materialized time x price-bin liquidity matrix. The frontend does not page `/api/position-events` at request time for this chart.
  - `Precise` renders the materialized instant liquidity matrix. `Peak` is a frontend display mode that holds each price row at its running maximum across time.
  - `Fixed` uses the absolute `priceBins` axis. `Follow` re-centers rows around each column's `priceLine` by sampling the materialized absolute grid into relative percent rows.
  - Address-picker lists use materialized payload owner attribution when `meta.ownerAttribution=true`; otherwise the dashboard falls back to the legacy owner lists and disables materialized owner drilldown for payloads without owner bands.
- Settings (persisted, `stores/chart-settings-store.ts`, schema **version 7** with `version < 6` and `version < 7` migrate backfills): `heatmapWindowDays`, `heatmapPriceMode` (`fixed`|`sliding`), `heatmapColorScale` (`percentile`|`log`), `heatmapIncludeInactive` (default `true`), `heatmapDepthMode` (`precise`|`peak`, default `precise`). Address selection itself is pool-scoped local component state (resets on pool switch), not persisted.
- Pool-family gating: materialized liquidity depth is gated via `supportsHistoricalLiquidityDepth()` to real Raydium CLMM pools and the allowlisted 0G mainnet V3 pools. Demo pools, BSC 0G, and non-allowlisted EVM pool families render unavailable until their indexer endpoint is shipped.
- Known caveats (surfaced in the card help + an in-UI note):
  - **Owner attribution:** per-owner filters and cell drilldown require `ownerBands` from the materialized endpoint. Payloads with `owner_attribution_incomplete` warnings still render aggregate depth, but owner-level attribution may be incomplete.
  - **Historical fidelity:** the indexer returns `quality.reconciled`, `mismatchPct`, latest reconstructed liquidity, latest indexed liquidity, and warnings. The UI/data contract should surface reconciliation status rather than claiming perfect replay.
  - **Windows:** the frontend controls still show Pedro's 7d/30d/90d/1y shape, but the indexer-native v1 route bounds `window_days` to 30d; 90d/1y are deferred until the materializer supports those windows.
- Plot style:
  - Canvas-2D heatmap (offscreen `T×P` bitmap from a 256-entry colormap LUT, blitted scaled with smoothing off) + an overlaid price line and hover crosshair/tooltip + a pinned drill-down popover; a CSS-gradient colorbar legend. A reusable `renderFrame(ctx, W, H, opts)` draws the live canvas. Renderer plumbing mirrors `drawReplayFrame` in `historical-rebalances.tsx`.

### Trading Volume by Size

- UI component: `TradingVolumeBySizeChart`
- Main feed:
  - Trading Volume By Size Buckets
- Main endpoint:
  - `GET /api/trading-volume-by-size?poolAddress=...&days=...&mode=aggregate...`
- Frontend assembly:
  - Dashboard passes `dailyData` only.
  - Worldchain/Gensyn/BSC/Katana/Monad Railway data comes from `PoolDailyVolumeBySize`; the indexer must bucket by USD notional from the known stablecoin side, not by a hardcoded token1 6-decimal assumption.
  - The component converts ISO dates to `Date` objects and plots each size bucket as its own series.
  - No extra client-side swap bucketing happens in the dashboard path.
- Plot style:
  - Visx multi-line time-series chart, one line per trade-size bucket.

### Fee Earnings by LP (7D)

- UI component: `FeeEarningsChart`
- Main feeds:
  - Daily Pool Stats
  - Owner LP summary from `useAllLPPositions`
  - Historical owner liquidity snapshots from `useLiquidityHistoryByAddress`
  - Token USD Map
- Frontend assembly:
  - Uses only `feesToken1` from each day to avoid double-counting both swap sides.
  - Converts daily fees to USD with current token1 USD price.
  - Distributes each day's total fees across LPs by that day's reconstructed owner liquidity share.
  - Falls back to current `liquidityTotal` shares only when no historical owner snapshots are available.
- Plot style:
  - Visx stacked bar chart.
- Important nuance:
  - This is an estimate. It does not reconstruct each LP's exact historical in-range fee accrual.

### Volume by Time (30D Avg, EST)

- UI component: `VolumeByTimeChart`
- Tab visibility: Overview, Trading
- Main feed:
  - Candle History at `1h` interval via `useVolumeByTime` hook
  - Token USD Map
- Main endpoint:
  - `GET /api/candles?pool=...&interval=3600&startTime=...&endTime=...`
- Frontend assembly:
  - `useVolumeByTime` fetches 30 days of hourly candles.
  - For each candle, converts the UTC timestamp to EST (America/New_York) and extracts hour-of-day (0–23) and day-of-week (Sun–Sat).
  - Uses `volumeToken1` (divided by `10^token1Decimals`) times `token1UsdPrice` to compute USD volume per candle. Falls back to token0 side when token1 price is unavailable.
  - Aggregates into two arrays: by-hour averages (total volume for that hour / number of distinct days with data) and by-day-of-week averages (total / distinct weeks).
- Plot style:
  - Two side-by-side visx bar charts rendered inside a single `ChartCard`. Left chart (60% width) shows 24 hourly bars; right chart (40% width) shows 7 day-of-week bars. Hover shows crosshair + tooltip with formatted USD value.

### LP Ranges by Address

- UI component: `LPRangesByAddressChart`
- Main feeds:
  - Liquidity Distribution derived bars
  - Owner Position Snapshots
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - Reuses the total distribution background from `useLiquidityDistribution`.
  - Re-values each LP's active range per tick bucket using the actual tick overlap between each position and display bin, so narrow LP ranges inside a wider bin are not dropped.
  - Keeps top 20 LPs separate and groups the rest into `Others`.
  - Overlays owner-colored range segments on top of the pool-wide distribution.
  - Dashboard passes the active display inversion flag to `LPRangesByAddressChart`, so inverted stable-token0 pools use the same increasing-left-to-right price axis and current-price marker as the other pool charts.
  - If the upstream position request resolves to zero active range rows, the card renders a no-active-LP-ranges state instead of staying in the loading spinner.
- Plot style:
  - Custom distribution chart with per-owner stacked/overlay segments.

### In-Range Liquidity

- UI component: `InRangeLiquidityChart`
- Main feeds:
  - Owner Position Snapshots
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - Iterates `allLPPositionsData` and keeps positions where `tickLower <= currentTick < tickUpper`.
  - For each in-range position, computes `amountsForPosition` against the live `sqrtPriceX96` and converts both legs to USD using `usdPrices.token0Usd` and `usdPrices.token1Usd`.
  - Aggregates the resulting USD by owner, sorts desc, keeps top 10 LPs and groups the rest into `Others`.
  - Total in-range USD is the numerator. Denominator for the "% of TVL" counter comes from `poolData.token0Balance * t0Usd + poolData.token1Balance * t1Usd`.
  - If no active position rows exist, the card renders a no-in-range-LP-position state instead of waiting indefinitely.
- Plot style:
  - Left counter showing in-range USD, % of pool TVL, active LP / position counts; right side renders horizontal bars per in-range LP, ranked by USD share.

### Liquidity Distribution Over Time

- UI component: `LiquidityHistoryByAddressChart`
- Main feeds:
  - Daily Pool Stats
  - Owner Position Snapshots
  - LP event history
  - Token USD Map
- Main endpoints:
  - Solana / Worldchain: `GET /api/pool-data?...&include=positions,events`
  - Legacy unsupported EVM pools: no supported browser-side GraphQL path
  - Daily close-price helper from `usePoolDayData`
- Frontend assembly:
  - Starts from current position state.
  - Replays LP events backwards in **hourly** buckets across the 7-day window (168 snapshots) — the consumer in `dashboard.tsx` calls `useLiquidityHistoryByAddress(..., "hour")`. Other consumers of the hook (fee earnings, incentive bars, multi-pool token dashboard) keep the default `"day"` granularity since they index snapshots by day-aligned timestamps.
  - Re-values each bucket using the daily close-price map (the same `sqrtPriceX96` is reused for all 24 hours of that day) plus current token USD prices.
  - Converts snapshots into a stacked area payload with the top addresses selected by max observed USD value anywhere in the window, plus `others`; this keeps large LPs that fully withdrew visible instead of burying their drop in `Others`.
- Plot style:
  - Visx stacked area chart. The X axis sparsely labels one tick per UTC midnight so 168 hourly points stay legible; tooltip shows the full `Mon DD HH:00` label.

### Pool Price vs Oracle Spread

- UI component: `PriceSpreadChart`
- Main feeds:
  - Candle History at `1d`
  - Historical Oracle
- Main endpoints:
  - `GET /api/candles?interval=86400...`
  - `GET /api/historical-prices?...`
- Frontend assembly:
  - Parses daily pool closes from candle data.
  - Aligns them with oracle prices by interpolation.
  - Computes `spreadPct = (poolPrice - oraclePrice) / oraclePrice`.
  - Builds deviation events whenever `|spreadPct| > 2%`.
- Plot style:
  - Visx dual-line chart with filled spread area plus a linked deviation ranking panel.

### LP Deep Dive — Active / Closed LPs list

- UI: inline in `components/dashboard/dashboard.tsx` (the "LP Deep Dive" right column), driven by a `lpListTab: "active" | "closed"` state with two header tabs.
- **Active LPs** (default): `currentLPsSortedForDisplay` — current open positions aggregated by wallet (`allLPPositions` / `ownerPositionAggregates`), sorted by USD TVL. Right column shows TVL (or position count when `supportsRangeLiquidityShape` is false).
- **Closed LPs**: `closedLPsSortedForDisplay` — every wallet with at least one CLOSED position lifecycle, aggregated by owner. Built by running `reconstructAllLifecycles` (from `lib/lp-rebalances.ts`) over a **365-day** pool-events fetch (`useLPEntryExitData(poolKey, 365, …)` — a separate long-lookback call from the 7-day one that feeds the activity charts; it shares React Query cache with `useOwnerRebalances`' internal 365-day fetch, so it's essentially free) and keeping lifecycles with `closedAt != null`. Each row aggregates `{closedCount, peakLiquidity, lastClosedAt}`; sorted by most-recent exit. Includes wallets that are **still active** (their past closed positions, flagged "· still active") as well as fully-exited LPs. Right column shows `{n} closed`; a muted subline shows the last-exit date. Both tabs' rows call `setSelectedOwner(owner)` on click, driving the rest of the LP Deep Dive (Historical Rebalances, replay, etc.). Note: closed positions are inherently event-derived, so an LP whose closes weren't owner-attributed in `lpevents` won't appear (same attribution caveat as elsewhere); the replay's *open*-position gap is separately patched via the `positions`-snapshot union, but closed history has no equivalent snapshot source.

### LP Position Activity

- UI component: `LPPositionActivityChart`
- Main feeds:
  - raw LP events
  - selected owner from `usePositionsByOwner`
  - Token USD Map
- Main endpoints:
  - same event sources as `LP Activity - New vs Exits (7 days)`
- Frontend assembly:
  - Filters raw LP events to the selected owner only.
  - Converts `amount0` and `amount1` into USD, with the same v4 liquidity-delta valuation fallback as `LP Activity - New vs Exits`.
  - Buckets mint/increase vs burn/decrease activity by hour.
- Plot style:
  - Visx positive/negative bar chart with a stats header.

### LP Liquidity Distribution

- UI component: `LPDistributionComparisonChart`
- Main feeds:
  - Liquidity Distribution derived bars
  - Owner Position Snapshots
  - selected owner positions from the same owner snapshot used by `LP Ranges By Address`, with `usePositionsByOwner` as a fallback
  - Tick Liquidity fallback
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - Reuses the pool-wide liquidity distribution as the background layer.
  - Recomputes the selected LP's value at each bar using the same pricing mode; narrow selected LP ranges count when they overlap a wider display bin, not only when they start at the bin's first tick.
  - Overlays the selected LP distribution on top of the total pool distribution.
  - For the Perle BSC Pancake Infinity CL pool only, selected and `Other LPs` values are computed from all active position rows in the hovered bin, matching `LP Ranges by Address` attribution instead of capping against the divergent Pancake tick total. Other v4 pools are unchanged.
  - When the active display pair is inverted, it reverses only the visual bin order so the X-axis matches the other liquidity charts.
- Plot style:
  - Custom comparison histogram / overlay chart.

### Historical Rebalances

- UI component: `HistoricalRebalances` (`components/dashboard/historical-rebalances.tsx`)
- Pure logic: `computeRebalances` in `lib/lp-rebalances.ts` (unit-tested in `lib/__tests__/lp-rebalances.test.ts`)
- Main feeds:
  - `lpEvents` from `useLPHistoricalData` (per-owner LPEvent stream, keyed to the real LP wallet — same owner semantics as `LP Position Activity`, not the pool-level impact-band events whose owner can be an NFT-manager on v3)
  - Candle History (`chartData.ohlcData`, raw token1/token0 close prices over the selected `timeRange`)
  - Pool Snapshot (token decimals, current tick)
- Frontend assembly:
  - **One bar per NFT (open positions) + one per closed lifecycle (history).** Open bars are driven off the owner's current positions (`currentPositions`, from `usePositionsByOwner`, liquidity > 0) — so each held NFT gets its own row labeled with its `tokenId`, even if two NFTs share a tick range. The mint time and trim history for each are taken from the matching range's reconstructed events. Closed positions (fully withdrawn) come from event reconstruction and have no `tokenId` (the `lpevents` feed carries none). When no position list is supplied, open bars fall back to event-reconstructed open lots (unlabeled).
  - Reconstructs each range's lifecycle by matching the selected LP's adds/removes on the same tick range, tracking running liquidity to find open/close timestamps and recording every removal timestamp (partial or full).
  - Emits a row for **every** position the LP held in the window — opens/holds as well as rebalances. For each lifecycle it finds the final out-of-range stretch from the candle high/low (vs the range's `tickToPrice` bounds) and classifies:
    - drifted out of range then acted → the response is the **first liquidity removal — partial or full — after** it went out, `timeToRebalanceSec` = response − drift start, `outOfRangeAt`/`outSide`/`outPrice` set;
    - closed/trimmed while still in range → `closedInRange: true` (a proactive rebalance), `outOfRangeAt`/`timeToRebalanceSec` null;
    - out of range now, untouched since drifting → `ongoing: true`;
    - open, minted and never closed or trimmed → `isHold: true` (a hold; includes positions that briefly drifted out and came back). Holds carry no `outOfRangeAt`/`rebalancedAt`.
  - A removal that leaves the position still open is flagged `partial: true` (trimmed but still holding). `summary` reports `count` (rebalances acted on), `holdCount`, and `ongoingCount` separately.
  - **NFT id labeling:** open bars carry the position `tokenId` (from `currentPositions`) and render it in the table, the tooltip, and a left-gutter label on the timeline. Two NFTs at the same range each get their own bar (they're driven off the position list), though they share the same range-derived event history. Closed bars stay unlabeled — the `lpevents` feed has no tokenId, so a closed range can't be tied to a specific NFT. A true per-tokenId history for closed positions would require `tokenId` on the `lpevents` indexer feed.
  - **Phantom pruning:** reconstructed "open" positions are anchored to the owner's actual current positions (`selectedPositions` from `usePositionsByOwner`, passed as `currentPositions`). A position we never saw close is dropped unless its range is still held — this prevents stale positions (whose closing events were missed) from showing as false "ongoing out of range" rows. Fully-closed positions are never pruned.
  - Concentration is the range width as ± percent of the mid price; the re-centered range is the LP's next mint at a different range near the response.
  - All detection runs in raw token1/token0 orientation; display orientation/USD is applied via `rebalanceToDisplayPrice` in `dashboard.tsx`.
- Data window: a dedicated all-time path in `hooks/use-owner-rebalances.ts` over a long lookback (default 365d), independent of the dashboard's time-range selector.
- Candle resolution: **adaptive**. Candles are scoped to the pool's actual activity span (earliest event → now), and `pickCandleInterval` chooses the finest interval (5m/15m/1h/4h/1d) whose row count stays under the candle route's ~10k cap (`CANDLE_ROW_BUDGET`). A young pool like 0G gets 5-minute candles; a pool with a full year of activity falls back to hourly. `PoolCandle` rows only exist for intervals that had swaps, so finer requests return only active buckets — exactly where price (and out-of-range transitions) move. The candle query is keyed to the pool span, so it is shared across owner selections.
- Out-of-range detection uses each candle's **intra-bucket high/low** (`RebalanceCandle.high`/`low`), not just the close. Because price only moves on swaps and every swap bucket has a candle, high/low captures *every* out-of-range excursion the pool had — including a spike that crossed the band and closed back inside — independent of the chosen interval. The interval only sets the *timing* precision of when, within a bucket, it happened. (Rebalance **events** themselves come from the complete `lpevents` feed, so no rebalance action is ever missed regardless of candles.)
- Events: `hooks/use-owner-rebalances.ts` gets events from **`useLPEntryExitData`** (over `lookbackDays`, default 365), then filters by owner client-side (case-insensitive). This is essential: `useLPEntryExitData` → `useLPEvents` routes per pool — Railway REST `/api/pool-data?include=events` for the shared-indexer pools (0G/BSC/Worldchain/Gensyn/Katana/Monad), Envio GraphQL otherwise — and the REST route paginates server-side so the full window comes back. Do **not** call `envioClient.request(GET_LP_EVENTS_QUERY)` directly here: 0G and the other Railway pools are classified by `isWorldchainIndexerPool`, their data does **not** live on the Envio GraphQL endpoint, and gating the hook on a hand-rolled `isEvm` check silently excluded every 0G address (the panel showed "No rebalances" for all of them).
  - **Known limitation:** if a pool's `lpevents.owner` is the NFT-manager/router rather than the LP wallet, events can't be attributed to the wallet and the panel is empty for that LP even though they hold positions (e.g. 0G `0x6927…7372` has zero owner-attributed events while holding a large in-range position). The existing per-owner charts (LP Position Activity, New vs Exits) have the same limitation.
- Gating: shown when `supportsHistoricalDepthBands` (so it appears for 0g-ai and other owner-attribution-capable spaces); empty state when the selected LP had no out-of-range episodes in the window.
- Plot style:
  - Two-column layout: visx Gantt-style timeline on the left (green in-range segment → red out-of-range segment whose length is the response lag; blue diamond = full close, amber diamond = partial trim, amber arrow = still ongoing) and a detail table on the right (range + concentration, out-of-range moment/price, time to rebalance with partial/ongoing tag, re-centered range).
  - **Replay overlay** (`RebalanceDistributionReplay` in the same file, opened via the "▶ Replay distribution" button in the summary header): because each record is a position lifecycle with an active window `[openedAt, closedAt ?? now)`, it reconstructs the pool's liquidity distribution at any instant and animates it. A `requestAnimationFrame` loop scrubs `t` across the window (with play/pause + a range slider). **It mirrors the V3 Liquidity Distribution chart's methodology** (`ReplayHistogram`, ~80 bars): bins are in **tick space** over a bounded window — the same width and step as the distribution chart default (±8000 ticks, aligned to `tickSpacing`, ~80 bars) but **centered on the price at the scrubbed timestamp** (not the fixed current tick), so the window *follows price* and the marker + live liquidity stay in view as price moves. Each bar's height is the **USD value** of the liquidity live at `t` whose tick range overlaps that bar, computed with the same V3 amount math (`amount0/amount1` via `1.0001^(tick/2)` sqrt-price, clamped at the price tick for `t`, ÷ 10^decimals, × token USD prices). Token USD prices are derived like the chart: if one is missing, infer it from the other via the current pool price; with no USD prices it falls back to token1-unit value. The y-scale is **stable** — its max stacked total is sampled across time with each sampled instant using its *own* price-centered window, so the scale doesn't rescale frame-to-frame as the window slides. **Two stacked series**: the selected LP (green, baseline) and the *rest of the pool* (grey, above) so each bar's total height is whole-pool liquidity at that price; a dashed **price marker tracks the pool price at the scrubbed timestamp** (centered, since the window follows it) and a right-side value axis matches the distribution chart. The marker tick (and the token0/token1 split used to value each bar, and the window center) come from a `priceSeries` (`{t, tick}[]`) exposed by `useOwnerRebalances` — built from the candle closes it already fetches (`tick = round(ln(rawPrice·10^(d1−d0))/ln 1.0001)`, the inverse of `tickToPrice`) — step-interpolated per frame via a binary search (`tickAt(t)`). The window-builder (`makeBars(centerTick)`) and valuation (`valueBarsFor(list, bars, priceTick, t)`) are pure of the current frame so `yMax` can sample them at arbitrary times. The rest-of-pool layer comes from `otherPositions` (prop on `HistoricalRebalancesProps`, sourced from `useOwnerRebalances().otherPositions`), which is `reconstructAllLifecycles(rawEvents)` (in `lib/lp-rebalances.ts` — keys every pool position by `owner:tickLower:tickUpper`, emits a `{owner, tickLower, tickUpper, priceLower, priceUpper, openedAt, closedAt, liquidity}` lifecycle) filtered to other owners, **then UNIONED with the authoritative `positions` snapshot** (`allPositions`, passed from the dashboard's `allPositionsFlattened` — the same source the LP Liquidity Distribution chart uses). The union is essential: LPs whose mints aren't owner-attributed in `lpevents` (router / NFT-manager mints, e.g. 0G `0x6927…`) have **zero events**, so reconstruction alone misses them entirely; a snapshot position is added only when no *open* reconstructed lifecycle already covers its `owner:tickLower:tickUpper` (no double-counting), with `openedAt` falling back to the position's `updatedAt` (≈ mint time) or the lookback start. This guarantees every currently-held position renders. Both series carry **ticks + raw `Number(peakLiq)` liquidity** (same scale for the green/red and grey, so they stack consistently). **All positions render** (no width exclusion) — like the distribution chart, a wide/full-range position just contributes a thin layer across the bars its tick range overlaps within the window. **Rebalance-focused playback:** the selected LP's live positions are split each frame into **in-range (green)** vs **out-of-range (red)** by testing the price tick at `t` against each position's `[tickLower, tickUpper)`; out-of-range liquidity is painted red and stacked above the green, so a drifted position is obvious. Playback speed is **rebalance-aware**. The out-of-range episodes are precomputed from the records (`oorSpans`: each record's `outOfRangeAt → closedAt ?? rebalancedAt ?? now`, merged) and each episode is stretched to play over a **fixed wall-clock budget** (`OOR_WALLCLOCK_MS = 1500`) — advancing at `(span.end − span.start) / 1500` pool-sec per ms — so a minutes-long rebalance inside a months-long replay still dwells visibly on the red (a flat proportional slowdown does NOT work: a brief episode is one frame even at 0.06×). Outside episodes the speed is proportional: **0.2× for a post-rebalance grace** (5% of the span after the episode, via `graceUntilRef`, so the next in-range position settling is watchable), **1× while holding in-range**, **1× through dead stretches**. A dashed **price marker shows the price at `t` as a label** above the line and turns **red + bold with a "⚠ OUT OF RANGE" tag** when the LP is out of range (also surfaced in the subtitle). A header legend shows In range / Out of range / Other LPs. The dashboard passes `currentPrice`, `token0/1UsdPrice` (from `usdPrices`), and `tickSpacing` so the bars are valued in USD. **Start time** is anchored to THIS LP's first position (`tMin` = the selected LP's earliest `openedAt` minus a lead-in of ~6% of the remaining span, capped to [12h, 7d]) rather than the pool's inception, falling back to the earliest position overall when the LP has none — so the replay doesn't sit through empty pool history before the subject LP appears. **MP4 export:** a "Download MP4" button records a single tMin→tMax pass to an offscreen `<canvas>` (`drawReplayFrame`, which mirrors `ReplayHistogram` + header in canvas-2D) via `canvas.captureStream(30)` + `MediaRecorder`, preferring `video/mp4` (H.264) and falling back to `video/webm` (`pickRecorderMime`). The pacing function (`advanceReplayTime`) is shared by the on-screen rAF loop and the recorder so the video matches playback (rebalance dwell included), with a 120s safety cap. `COLORS` are plain hex so they render directly to canvas; there is no ffmpeg/mp4-muxer dependency, so on browsers whose `MediaRecorder` can't emit MP4 the download is a `.webm`.

### Price Range Monitor

- UI component: `PriceRangeChart`
- Main feeds:
  - selected owner positions from `usePositionsByOwner`
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - Builds `priceRangeDataFromPool` from the selected LP's active positions.
  - Converts ranges to USD when token USD prices are available.
  - Applies display inversion rules so the visual range matches the rest of the dashboard.
- Plot style:
  - Framer Motion driven horizontal range bar with active-band shading and a moving marker.

### Inventory

- UI status:
  - Derived in frontend state
  - Not currently mounted as a visible card in `dashboard.tsx`
- Derived data object:
  - `selectedLpDerived.inventoryTiltData`
- Main feeds:
  - selected owner positions from `usePositionsByOwner`
  - Pool Snapshot
  - Token USD Map
- Frontend assembly:
  - Values the selected LP's active positions in token0 USD and token1 USD.
  - Converts that into left/right percentage weights.
  - Builds `InventoryTiltData` for `InventoryTiltChart`.
- Plot style:
  - Intended renderer is `InventoryTiltChart`, a horizontal balance / tilt monitor.
- Important nuance:
  - The component exists in `components/custom-metrics/inventory-tilt-monitor.tsx`, but the card is not rendered in the main pool dashboard today.

### LP Activity - Historical Data (1d)

- UI component: `LPAddressActivityChart`
- Main feeds:
  - Candle History
  - Batched Historical Pool Data
  - V3 Swap History when available
  - Historical Oracle or local DEX TWAP
  - selected LP ranges from `usePositionsByOwner`
  - Pool Snapshot
  - Token USD Map
- Main endpoints:
  - `GET /api/candles?...`
  - `GET /api/pool-data?...&include=positions,events,hours,lp-activity`
  - `GET /api/lp-swaps?...` for v3-only swap-band overlays
  - `GET /api/historical-prices?...` when external oracle source is selected
- Frontend assembly:
  - Builds a single `TradingChartData` object with:
    - `ohlcData`
    - `oracleData`
    - `depthData`
    - `peggingData`
  - Joins selected LP ranges, raw LP events, live positions, tick liquidity, and optional precomputed impact/depth bands.
  - Applies display inversion consistently across candles, oracle overlays, and impact bands.
  - Point Details → Activity → Liquidity Changes uses the current pool key to route event links to the correct explorer: Solana pools open Solscan, Worldchain/EVM pools open Worldscan. Solana event ids may arrive as `pool:signature:pos:n`; the frontend extracts the signature for transaction links and falls back to the LP owner address when no transaction id is available.
- Plot style:
  - Large multi-layer custom SVG monitor combining candles, oracle line, depth bands, LP ranges, and event overlays.

## Maintenance Notes

- If a new pool analytics card is added, removed, renamed, or rewired, update this file in the same task.
- If a card changes endpoints or changes how frontend joins data before plotting, update both this file and `docs/ai/project-context.md`.
- If a chart is only partially implemented, call that out explicitly instead of leaving the catalog ambiguous.
