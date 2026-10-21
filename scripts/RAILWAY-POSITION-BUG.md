# Railway Solana Indexer — Position Liquidity Bug

## Problem

15 out of 22 Solana pools return `liquidity: "0"` for ALL positions from the Railway `/api/positions` endpoint, even though these pools have active liquidity confirmed by `/api/price` and `/api/liquidity/distribution`.

This breaks **Liquidity Distribution**, **LP Ranges by Address**, and **Active LPs** panels on the frontend for affected pools.

## Evidence

Diagnostic run on 2026-03-02 using `scripts/check-pool-positions.mjs`:

```
Pool        | Total | Active | Status
------------|-------|--------|-------
HHQUnUbmWLr |  1569 |      0 | BROKEN (all liq=0)
4KqQN6u1pFK |  1315 |      0 | BROKEN (all liq=0)
7sHMnvE7WqP |  2010 |      0 | BROKEN (all liq=0)
FknDV1F5n6Q |   879 |      0 | BROKEN (all liq=0)
78ReVNMLGRW |    72 |      0 | BROKEN (all liq=0)
B8YAwjGYk6q |   586 |      0 | BROKEN (all liq=0)
3Z4H4H9bCcL |   197 |     36 | OK
G39wywquKbH |  1774 |      0 | BROKEN (all liq=0)
3L7KbPVaAQA |   192 |      0 | BROKEN (all liq=0)
5pobXosbeGS |   396 |     57 | OK
8aDaBQkTrS6 |     6 |      0 | BROKEN (all liq=0)
49iMatQtoya |    17 |      0 | BROKEN (all liq=0)
6truu3rZuiB |    11 |      0 | BROKEN (all liq=0)
GMjGLWzvK75 |    22 |      0 | BROKEN (all liq=0)
DXWbip5Lduc |   294 |      0 | BROKEN (all liq=0)
GYqHjuDzTiw |    29 |      0 | BROKEN (all liq=0)
3LbRQkdRnah |   153 |      0 | BROKEN (all liq=0)
6FQQyf7UcyU |  5000 |    556 | OK
GjLusGo2z3m |  2751 |    338 | OK
27x6aSxcAm6 |  1238 |    194 | OK
FSLSua26xaX |  2014 |    344 | OK
4k43WcUS8kP |   907 |    161 | OK

Summary: 7 working, 15 broken
```

## How to reproduce

```bash
# Single pool check
curl "https://indexer-solana-production.up.railway.app/api/positions?pool=HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum&limit=5"
# Returns positions with liquidity: "0" and is_closed: true, despite pool being active

# Confirm pool IS active
curl "https://indexer-solana-production.up.railway.app/api/price?pool=HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum"
# Returns liquidity: 2180955293653 — pool clearly has active liquidity

# Confirm tick-level data exists
curl "https://indexer-solana-production.up.railway.app/api/liquidity/distribution?pool=HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum"
# Returns 115 tick buckets with non-zero liquidity

# Run full diagnostic across all pools
node scripts/check-pool-positions.mjs
```

## Observations

- Broken positions have `is_closed: true` and `closed_at: null` simultaneously
- All broken positions have `liquidity: "0"` regardless of `is_closed` status
- The `/api/lp/summary` endpoint also shows `active_positions: 0` for broken pools
- The `/api/capital-efficiency` endpoint returns empty for broken pools
- The 7 working pools return correct non-zero liquidity values

## What needs fixing

The position liquidity field is not being updated correctly for the 15 affected pools. Likely the indexer is not replaying `IncreaseLiquidity` / `DecreaseLiquidity` events into the position row's `liquidity` column for these pools.

## Additional note: `active=true` filter

The Railway `/api/positions?active=true` filter returns 0 results for ALL pools (including the 7 working ones). The frontend has been updated to not send this parameter. Client-side filtering (`liquidity !== "0"`) handles active/inactive separation instead.
