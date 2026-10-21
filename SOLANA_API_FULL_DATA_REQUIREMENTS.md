# Solana Indexer API Requirements (Full Dataset, No Chart Truncation)

## Goal
Ensure frontend charts can fetch the **complete dataset from the database** for a given pool and time range, without silent caps/truncation.

This document defines the API contract changes required in the Solana Railway indexer before frontend integration.

## Current Problem Summary
- Several frontend routes currently call Solana API endpoints with fixed limits (for example `500`, `1000`, `5000`, `10000`).
- Some Solana endpoints do not expose enough pagination metadata to drain all rows.
- Some responses are not consistently filtered at source by `pool` and time window.
- Result: charts can be wrong for larger historical ranges because data is truncated.

## Required API Design Rules

### 1) Every list endpoint must support full pagination
Support either offset pagination or cursor pagination (cursor preferred for scale).

#### Option A: Cursor pagination (preferred)
- Request params:
  - `limit` (integer, required or defaulted)
  - `cursor` (string, optional)
- Response fields:
  - `data` (array)
  - `has_more` (boolean)
  - `next_cursor` (string or `null`)
  - `limit` (integer)

#### Option B: Offset pagination (acceptable)
- Request params:
  - `limit` (integer)
  - `offset` (integer)
- Response fields:
  - `data` (array)
  - `total` (integer)
  - `limit` (integer)
  - `offset` (integer)
  - `has_more` (boolean)

### 2) Stable deterministic ordering is mandatory
All paginated endpoints must enforce a deterministic sort key to avoid duplicates/misses between pages.

Recommended:
- `ORDER BY block_time DESC, id DESC` (or equivalent unique tie-breaker)

### 3) Filtering must happen in SQL/database, not in frontend
For chart endpoints, server-side filters are required:
- `pool` (required for pool-scoped endpoints)
- `start_time` (required for historical queries)
- `end_time` (required for historical queries)
- `interval` (required for candles)

### 4) Explicit max page size
- Enforce a max limit (example: `1000`)
- If requested `limit` exceeds max, either:
  - clamp and return applied limit, or
  - return `400` with clear validation error

### 5) Uniform response envelope
All list endpoints should return a consistent shape:

```json
{
  "data": [],
  "pagination": {
    "limit": 1000,
    "has_more": true,
    "next_cursor": "..." 
  },
  "meta": {
    "applied_filters": {
      "pool": "...",
      "start_time": "...",
      "end_time": "...",
      "interval": "..."
    }
  }
}
```

If you keep offset mode, include `total` and `offset` in `pagination`.

## Endpoint-Specific Requirements

## `/api/candles`
### Must support
- `pool` (required)
- `interval` (required, e.g. `5m`, `15m`, `1h`, `4h`, `1d`)
- `start_time` (required)
- `end_time` (required)
- `limit` + (`cursor` or `offset`)

### Must return
- Paginated envelope with `has_more` and continuation token/offset
- Deterministic sort (for example newest first by `open_time`, then unique id)

### Notes
- Current behavior appears to return `data` but not reliable pagination metadata.
- This endpoint is critical for price/volume chart correctness.

## `/api/swaps`
### Must support
- `pool` (required)
- `start_time` (required)
- `end_time` (required)
- `limit` + (`cursor` or `offset`)

### Must return
- Same pagination metadata as above
- Deterministic ordering with unique tie-breaker

### Notes
- Needed for LP swaps, slippage history, and trading volume computations.

## `/api/positions`
### Must support
- `pool` (required)
- optional `active=true|false`
- `limit` + (`cursor` or `offset`)

### Must return
- Paginated full position list for the pool, not globally mixed data.

## `/api/position-events`
### Must support
- `pool` (required)
- `start_time` (required)
- `end_time` (required)
- `event_types[]` (array; example: `CreatePosition`, `IncreaseLiquidity`, `DecreaseLiquidity`)
- `limit` + (`cursor` or `offset`)

### Must return
- Combined event stream from all requested types in one paginated timeline
- Deterministic ordering and full pagination metadata

### Why this matters
- Frontend currently calls event types separately and each call can be capped, causing incomplete replay.

## Validation & Error Contract
- Invalid params -> `400` with machine-readable message.
- `start_time >= end_time` -> `400`.
- Unknown `interval` -> `400`.
- Missing required `pool` on pool-scoped endpoints -> `400`.
- Internal errors -> `5xx` with stable error format.

## Performance / Indexing Expectations
To keep full pagination performant:
- Add composite indexes aligned with filters + sort.
- Examples:
  - candles: `(pool, interval, open_time DESC, id DESC)`
  - swaps: `(pool, block_time DESC, swap_id DESC)`
  - position_events: `(pool, block_time DESC, event_id DESC)`
  - positions: `(pool, updated_at DESC, position_id DESC)`

## Backward Compatibility Strategy
- Keep existing fields in `data` objects unchanged when possible.
- Add new pagination envelope/metadata without removing old fields immediately.
- If response shape changes are breaking, publish `/v2/...` endpoints.

## Acceptance Criteria (must pass before frontend update)

1. Candles full-drain test
- Query a long range where rows > max page size.
- Client paginates until `has_more=false`.
- Total collected rows must equal DB query count for same filters.

2. Swaps full-drain test
- Same as above for swaps.
- No duplicates and no missing rows across page boundaries.

3. Determinism test
- Run same paginated query twice over unchanged dataset.
- Returned ordered ids must match exactly.

4. Filter correctness test
- `pool`, `start_time`, `end_time`, `interval` are fully respected server-side.
- No out-of-range rows returned.

5. Load sanity
- Endpoint handles repeated pagination requests without timing out under normal production ranges.

## Recommended Example Requests

### Cursor mode
```bash
GET /api/candles?pool=<POOL>&interval=5m&start_time=1735689600&end_time=1736294400&limit=1000
GET /api/candles?pool=<POOL>&interval=5m&start_time=1735689600&end_time=1736294400&limit=1000&cursor=<NEXT_CURSOR>
```

### Offset mode
```bash
GET /api/swaps?pool=<POOL>&start_time=1735689600&end_time=1736294400&limit=1000&offset=0
GET /api/swaps?pool=<POOL>&start_time=1735689600&end_time=1736294400&limit=1000&offset=1000
```

## Handoff Note
Once these API changes are implemented and deployed, frontend routes can be updated to:
- iterate pages until completion,
- stop using fixed hard caps as final data,
- return complete datasets for chart calculations.
