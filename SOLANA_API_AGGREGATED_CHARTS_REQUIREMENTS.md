# Solana Indexer Aggregated Endpoints Requirements (Chart-Ready Data)

## Objective
Move heavy chart computations to the Solana indexer API so Next.js and the browser do not process full raw history.  
The API should return **aggregated/chart-ready series** for each chart panel.

This document complements `SOLANA_API_FULL_DATA_REQUIREMENTS.md`:
- Raw endpoints still exist and remain paginated/full-drain capable.
- New aggregated endpoints are the default path for UI charts.

---

## Why this change
- Full-history raw datasets are too large for frontend `useMemo` processing.
- Browser currently risks `RangeError: Maximum call stack size exceeded` on large arrays.
- Aggregating close to DB is cheaper, faster, and safer.

---

## Design Principles

1. **DB-side aggregation first**
- Use SQL/grouping/window functions/materialized views where possible.
- Do not ship raw swaps/events to frontend for chart math.

2. **Deterministic, bounded response size**
- Every endpoint must cap output points (for example max `5000`).
- Support `resolution` and `max_points` parameters.

3. **Uniform response envelope**
```json
{
  "series": [],
  "meta": {
    "pool": "string",
    "start_time": 0,
    "end_time": 0,
    "resolution": "5m",
    "points": 0,
    "source": "aggregated"
  }
}
```

4. **Required filters**
- `pool` required for all pool-scoped endpoints.
- `start_time` and `end_time` required for all historical endpoints.
- `start_time < end_time` enforced with `400`.

5. **Stable ordering**
- Return series in ascending timestamp order.

---

## Required New Endpoints

## 1) Aggregated Candles
`GET /api/charts/candles`

### Query params
- `pool` (required)
- `start_time` (required, unix sec)
- `end_time` (required, unix sec)
- `resolution` (required: `5m|15m|1h|4h|1d`)
- `max_points` (optional, default `2000`, max `5000`)

### Response
```json
{
  "series": [
    {
      "timestamp": 1735689600,
      "open": "0.6123",
      "high": "0.6200",
      "low": "0.6100",
      "close": "0.6181",
      "volume_token0": "123456",
      "volume_token1": "456789",
      "tx_count": 42
    }
  ],
  "meta": {
    "pool": "HHQ...",
    "start_time": 1735689600,
    "end_time": 1736294400,
    "resolution": "5m",
    "points": 2016,
    "source": "aggregated"
  }
}
```

### Notes
- If base candles table already exists, query directly.
- If downsampling is needed, use time-bucket aggregation.

---

## 2) Aggregated Trading Volume By Size
`GET /api/charts/volume-by-size`

### Query params
- `pool` (required)
- `start_time` (required)
- `end_time` (required)
- `bucket_period` (optional: `1h|1d`, default `1d`)
- `bucket_scheme` (optional, default `standard-v1`)
- `token0_usd` (optional)
- `token1_usd` (optional)
- `token0_decimals` (optional)
- `token1_decimals` (optional)

### Response
```json
{
  "series": [
    {
      "timestamp": 1735689600,
      "buckets": {
        "below_100": 0,
        "100_1k": 0,
        "1k_5k": 12034.22,
        "5k_10k": 8873.11,
        "10k_25k": 0,
        "25k_50k": 0,
        "50k_100k": 0,
        "100k_250k": 0,
        "250k_500k": 0,
        "500k_1m": 0,
        "1m_plus": 0
      },
      "total_usd": 20907.33
    }
  ],
  "meta": {
    "pool": "HHQ...",
    "start_time": 1735689600,
    "end_time": 1736294400,
    "bucket_period": "1d",
    "points": 7,
    "source": "aggregated"
  }
}
```

### Notes
- This endpoint should return already bucketed totals.
- Frontend should not fetch all swaps and bucket client-side.

---

## 3) Aggregated LP Activity Timeline
`GET /api/charts/lp-activity`

### Query params
- `pool` (required)
- `start_time` (required)
- `end_time` (required)
- `resolution` (required: `5m|15m|1h|4h|1d`)
- `include` (optional CSV: `depth_band,price_band,net_liquidity,entries_exits`)
- `impact_usd` (optional, default `10000`)
- `max_points` (optional, default `2000`, max `5000`)

### Response
```json
{
  "series": [
    {
      "timestamp": 1735689600,
      "price": "0.6181",
      "depth_band_buy": "0.6202",
      "depth_band_sell": "0.6159",
      "net_liquidity": "2988890000",
      "positions_opened": 4,
      "positions_closed": 1,
      "liquidity_added": "123000",
      "liquidity_removed": "55000"
    }
  ],
  "meta": {
    "pool": "HHQ...",
    "start_time": 1735689600,
    "end_time": 1736294400,
    "resolution": "1h",
    "impact_usd": 10000,
    "points": 168,
    "source": "aggregated"
  }
}
```

### Notes
- This endpoint replaces expensive client rollback/simulation loops.
- Compute impact/depth band server-side from positions + events + tick/liquidity state.

---

## 4) Aggregated Pool Snapshot (Single request bootstrap)
`GET /api/charts/pool-snapshot`

### Query params
- `pool` (required)
- `start_time` (required)
- `end_time` (required)
- `resolution` (required)

### Response
```json
{
  "candles": [],
  "volume_by_size": [],
  "lp_activity": [],
  "meta": {
    "pool": "HHQ...",
    "start_time": 1735689600,
    "end_time": 1736294400,
    "resolution": "1h",
    "source": "aggregated"
  }
}
```

### Notes
- Optional convenience endpoint to reduce round-trips.
- Internally can call other aggregation modules/queries.

---

## Performance Requirements

1. **Indexes**
- Keep existing:
  - swaps `(pool, block_time DESC, swap_id DESC)`
  - positions `(pool, updated_at DESC, position_id DESC)`
  - position_events `(pool, block_time DESC, event_id DESC)`
- Add candle/time-bucket index if not present:
  - candles `(pool, interval, open_time DESC)`

2. **Execution budget**
- Target P95 < 1000ms for typical ranges:
  - 7d @ 5m
  - 30d @ 1h
  - 90d @ 1d

3. **Optional materialized views**
- If queries are expensive, pre-aggregate hourly/daily views.

4. **Compression**
- Enable gzip/brotli for chart responses.

---

## Validation & Error Contract

- `400` for invalid/missing params.
- `422` for unsupported combinations.
- `500` for server errors.
- Stable shape:
```json
{
  "error": {
    "code": "INVALID_PARAMS",
    "message": "start_time must be < end_time",
    "details": {}
  }
}
```

---

## Acceptance Criteria

1. **No raw full-history in browser**
- Frontend should not need all swaps/events for charts.

2. **Bounded payload**
- For all chart endpoints, response point count obeys `max_points`.

3. **Deterministic output**
- Same params + unchanged DB => identical ordered series.

4. **Numerical parity**
- Aggregated outputs match existing chart math within agreed tolerance.

5. **Stress test**
- 1-year ranges do not crash browser and remain responsive.

---

## Rollout Plan

1. Ship aggregated endpoints in API (no frontend change yet).
2. Validate via curl and compare with current charts.
3. Update Next.js routes to consume aggregated endpoints.
4. Remove client heavy computations after parity confirmation.

---

## Example Requests

```bash
curl "/api/charts/candles?pool=HHQ...&start_time=1735689600&end_time=1736294400&resolution=5m"
curl "/api/charts/volume-by-size?pool=HHQ...&start_time=1735689600&end_time=1736294400&bucket_period=1d"
curl "/api/charts/lp-activity?pool=HHQ...&start_time=1735689600&end_time=1736294400&resolution=1h&impact_usd=10000"
```

