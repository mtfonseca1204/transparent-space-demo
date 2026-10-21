#!/usr/bin/env node
/**
 * Diagnostic script: test-pool-data-freshness.mjs
 *
 * Tests two critical issues:
 * 1. Price/candle freshness — verifies Railway API returns recent data
 * 2. Position pagination — verifies all positions are fetched (not truncated)
 *
 * Usage:
 *   node scripts/test-pool-data-freshness.mjs [pool_address]
 *
 * Defaults to HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum if no pool given.
 */

const RAILWAY_BASE =
  process.env.SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

const pool = process.argv[2] || "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum";

const LOCAL_BASE = process.env.LOCAL_BASE ?? "http://localhost:3001";

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchJson(url, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`  [FAIL] ${label}: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`  [FAIL] ${label}: ${err.message}`);
    return null;
  }
}

function agoStr(isoDate) {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ${hours % 24}h ago`;
  if (hours >= 1) return `${hours}h ${mins % 60}m ago`;
  return `${mins}m ago`;
}

// ─── Test 1: Price freshness from Railway ──────────────────────────────────

async function testPriceFreshness() {
  console.log("\n=== TEST 1: Price Freshness (Railway /api/price) ===");
  const data = await fetchJson(
    `${RAILWAY_BASE}/api/price?pool=${pool}`,
    "Railway /api/price"
  );
  if (!data) return;

  const blockTime = data.block_time;
  const age = Date.now() - new Date(blockTime).getTime();
  const ageMinutes = Math.round(age / 60_000);

  console.log(`  Pool:       ${pool}`);
  console.log(`  Price:      ${data.price}`);
  console.log(`  Block time: ${blockTime} (${agoStr(blockTime)})`);
  console.log(`  Tick:       ${data.tick}`);

  if (ageMinutes > 10) {
    console.log(`  [WARN] Price is ${ageMinutes} minutes old — pool may have low activity`);
  } else {
    console.log(`  [OK] Price is fresh (${ageMinutes}m old)`);
  }
}

// ─── Test 2: Candle freshness from Railway ─────────────────────────────────

async function testCandleFreshness() {
  console.log("\n=== TEST 2: Candle Freshness (Railway /api/charts/candles) ===");
  const end = Math.floor(Date.now() / 1000);
  const start = end - 24 * 3600; // last 24h
  // Railway uses "resolution" not "interval"
  const data = await fetchJson(
    `${RAILWAY_BASE}/api/charts/candles?pool=${pool}&resolution=1h&start_time=${start}&end_time=${end}`,
    "Railway /api/charts/candles"
  );
  if (!data) return;

  const rows = data.series ?? data.data ?? data;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("  [WARN] No candles returned for last 24h");
    return;
  }

  const last = rows[rows.length - 1];
  const lastTs = Number(last.timestamp);
  const lastTime = new Date(lastTs * 1000).toISOString();
  console.log(`  Candles returned: ${rows.length}`);
  console.log(`  First candle:     ${new Date(Number(rows[0].timestamp) * 1000).toISOString()}`);
  console.log(`  Last candle:      ${lastTime} (${agoStr(lastTime)})`);
  console.log(`  Last close price: ${last.close}`);

  const lastAge = Date.now() - lastTs * 1000;
  if (lastAge > 2 * 3600_000) {
    console.log(`  [WARN] Latest candle is ${Math.round(lastAge / 3600_000)}h old — pool may have low activity`);
  } else {
    console.log(`  [OK] Candles are up to date`);
  }
}

// ─── Test 3: Position count & pagination ───────────────────────────────────

async function testPositionPagination() {
  console.log("\n=== TEST 3: Position Pagination (Railway /api/positions) ===");

  // Count positions by paginating through Railway directly
  let totalFetched = 0;
  let page = 0;
  const PAGE_LIMIT = 1000;
  const MAX_PAGES = 30;
  let cursor = null;
  let hasMore = true;

  while (hasMore && page < MAX_PAGES) {
    const params = new URLSearchParams({
      pool,
      limit: String(PAGE_LIMIT),
    });
    if (cursor) params.set("cursor", cursor);

    const data = await fetchJson(
      `${RAILWAY_BASE}/api/positions?${params}`,
      `positions page ${page}`
    );
    if (!data) break;

    const rows = data.data ?? data;
    if (!Array.isArray(rows) || rows.length === 0) break;
    totalFetched += rows.length;
    page++;

    const pagination = Array.isArray(data) ? null : data.pagination;
    if (!pagination?.has_more) {
      hasMore = false;
    } else {
      cursor = pagination.next_cursor ?? null;
      if (!cursor) hasMore = false;
    }

    process.stdout.write(`  Fetched page ${page}: ${rows.length} positions (total: ${totalFetched})\r`);
  }

  console.log(`  Total positions: ${totalFetched} (across ${page} pages)          `);

  // Test old limits vs new limits
  const oldBirdsEyeMax = 2 * 500;  // old: maxPages=2 * pageLimit=500
  const newBirdsEyeMax = 5 * 500;  // new: maxPages=5 * pageLimit=500
  const oldFullMax = 5 * 1000;      // old: maxPages=5 * pageLimit=1000 (but server clamped to 10)
  const newFullMax = 30 * 1000;     // new: maxPages=30 * pageLimit=1000

  console.log(`\n  Coverage comparison:`);
  console.log(`    Old birds-eye: ${Math.min(oldBirdsEyeMax, totalFetched)}/${totalFetched} (${Math.round(Math.min(oldBirdsEyeMax, totalFetched) / totalFetched * 100)}%)`);
  console.log(`    New birds-eye: ${Math.min(newBirdsEyeMax, totalFetched)}/${totalFetched} (${Math.round(Math.min(newBirdsEyeMax, totalFetched) / totalFetched * 100)}%)`);
  console.log(`    Old full mode: ${Math.min(oldFullMax, totalFetched)}/${totalFetched} (${Math.round(Math.min(oldFullMax, totalFetched) / totalFetched * 100)}%)`);
  console.log(`    New full mode: ${Math.min(newFullMax, totalFetched)}/${totalFetched} (${Math.round(Math.min(newFullMax, totalFetched) / totalFetched * 100)}%)`);

  if (totalFetched > newFullMax) {
    console.log(`  [WARN] Pool has ${totalFetched} positions — exceeds new full-mode max of ${newFullMax}`);
  } else {
    console.log(`  [OK] New full-mode limit (${newFullMax}) covers all ${totalFetched} positions`);
  }
}

// ─── Test 4: Local API freshness (optional) ────────────────────────────────

async function testLocalApi() {
  console.log("\n=== TEST 4: Local API Pool Data ===");
  const data = await fetchJson(
    `${LOCAL_BASE}/api/pool/${pool}`,
    "Local /api/pool"
  );
  if (!data) {
    console.log("  [SKIP] Local server not running");
    return;
  }

  console.log(`  Current price: ${data.currentPrice}`);
  console.log(`  Last trade:    ${data.lastTradeAt ?? "N/A"} ${data.lastTradeAt ? `(${agoStr(data.lastTradeAt)})` : ""}`);
  console.log(`  Liquidity:     ${data.liquidity}`);
  console.log(`  Tick:          ${data.tick}`);
}

// ─── Run all tests ─────────────────────────────────────────────────────────

async function main() {
  console.log(`Pool Data Freshness & Pagination Diagnostic`);
  console.log(`Pool: ${pool}`);
  console.log(`Time: ${new Date().toISOString()}`);

  await testPriceFreshness();
  await testCandleFreshness();
  await testPositionPagination();
  await testLocalApi();

  console.log("\n=== DONE ===\n");
}

main().catch(console.error);
