#!/usr/bin/env node
const BASE = process.env.SOLANA_INDEXER_API_URL ?? "https://indexer-solana-production.up.railway.app";
const pool = process.argv[2] || "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum";

async function main() {
  let totalRows = 0;
  let totalActive = 0;
  const owners = new Set();
  let page = 0;
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const url = new URL(`${BASE}/api/positions`);
    url.searchParams.set("pool", pool);
    url.searchParams.set("limit", "5000");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
    const d = await res.json();
    const rows = d.data ?? [];
    const active = rows.filter((r) => r.liquidity !== "0" && r.liquidity !== 0);

    totalRows += rows.length;
    totalActive += active.length;
    for (const p of active) {
      owners.add(p.nft_owner || p.owner || "unknown");
    }

    page++;
    console.log(`Page ${page}: ${rows.length} rows, ${active.length} active`);

    hasMore = d.pagination?.has_more === true && d.pagination?.next_cursor;
    cursor = d.pagination?.next_cursor ?? null;
  }

  console.log(`\nTotal positions: ${totalRows}`);
  console.log(`Active positions: ${totalActive}`);
  console.log(`Unique owners (LPs): ${owners.size}`);
  console.log(`Pages fetched: ${page}`);

  // Now check what pool-data returns (simulates frontend)
  const now = Math.floor(Date.now() / 1000);
  const start = now - 30 * 86400;
  const pdUrl = `https://transparent-space.vercel.app/api/pool-data?pool=${pool}&startTime=${start}&endTime=${now}&include=positions&positionsPageLimit=5000&positionsMaxPages=10`;
  console.log(`\nChecking /api/pool-data...`);
  try {
    const pdRes = await fetch(pdUrl, { signal: AbortSignal.timeout(60000) });
    if (!pdRes.ok) {
      console.log(`  HTTP ${pdRes.status}`);
      return;
    }
    const pd = await pdRes.json();
    const positions = pd.positions ?? [];
    const pdOwners = new Set();
    for (const p of positions) {
      if (p.owner) pdOwners.add(p.owner);
    }
    console.log(`  Positions returned: ${positions.length}`);
    console.log(`  Unique owners: ${pdOwners.size}`);
    if (positions.length < totalActive) {
      console.log(`  GAP: Railway has ${totalActive} active, pool-data returns ${positions.length} (missing ${totalActive - positions.length})`);
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
}

main().catch(console.error);
