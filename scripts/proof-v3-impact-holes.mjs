#!/usr/bin/env node
/**
 * proof-v3-impact-holes.mjs
 *
 * Goal: Be skeptical + auditable.
 *
 * This script proves (or falsifies) a key assumption behind the LP Activity "$10k impact band" on v3:
 * - The frontend historically rolled back TickLiquidity using LPEvent deltas.
 * - But TickLiquidity (v3) is updated from *pool-level* Mint/Burn events.
 *
 * If LPEvent does NOT fully cover all pool Mint/Burn liquidity changes (e.g. liquidity added directly via pool,
 * or via a non-tracked position manager), then rolling back from LPEvent will drift and the impact band can
 * show huge discontinuities / “holes”, especially on longer windows (1d+).
 *
 * Additionally, this script can disprove the hypothesis "v3 owner == v4 pool manager" by checking whether
 * the provided pool-manager address appears as a dominant LPEvent.owner for that v3 pool.
 *
 * Usage:
 *   NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT="https://.../v1/graphql" node ./scripts/proof-v3-impact-holes.mjs \
 *     --pool 0x... \
 *     --start 2025-12-29T00:00:00Z \
 *     --end   2025-12-30T00:00:00Z
 *
 * Flags:
 *   --endpoint <url>   (default: NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT or http://localhost:8080/v1/graphql)
 *   --pool <0x...>     (required)
 *   --start <ISO Z>    (required)
 *   --end   <ISO Z>    (required)
 *   --poolManager <0x...> (optional) address to test against LPEvent.owner distribution
 */

const ENDPOINT_DEFAULT =
  process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT ?? "http://localhost:8080/v1/graphql";

function usage(exitCode = 0) {
  console.log(`
Usage:
  NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT="https://.../v1/graphql" node ./scripts/proof-v3-impact-holes.mjs --pool 0x... --start <ISO> --end <ISO>

Flags:
  --endpoint <url>
  --pool <0x...>     (required)
  --start <ISO Z>    (required)
  --end   <ISO Z>    (required)
`);
  process.exit(exitCode);
}

function toLcAddress(s) {
  return String(s ?? "").trim().toLowerCase();
}

function parseIsoToEpochSec(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO date: ${iso}`);
  return Math.floor(d.getTime() / 1000);
}

function isoFromEpoch(tsSec) {
  return new Date(tsSec * 1000).toISOString().replace(".000Z", "Z");
}

function absBigInt(x) {
  return x < 0n ? -x : x;
}

function parseArgs(argv) {
  const out = { endpoint: ENDPOINT_DEFAULT, pool: "", startIso: "", endIso: "", poolManager: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Flag ${a} requires a value`);
      return argv[++i];
    };
    if (a === "-h" || a === "--help") usage(0);
    if (a === "--endpoint") out.endpoint = next();
    else if (a === "--pool") out.pool = next();
    else if (a === "--start") out.startIso = next();
    else if (a === "--end") out.endIso = next();
    else if (a === "--poolManager") out.poolManager = next();
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (!out.pool || !out.startIso || !out.endIso) usage(1);
  return out;
}

async function fetchJson(url, payload, { timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text);
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function graphql(endpoint, query, variables) {
  const json = await fetchJson(endpoint, { query, variables });
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message || JSON.stringify(e)).join("; ");
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json.data;
}

const Q_LP = `
  query ProofV3LpEvents($pool: String!, $startTime: Int!, $endTime: Int!) {
    LPEvent(
      where: { pool: { _eq: $pool }, timestamp: { _gte: $startTime, _lte: $endTime } }
      order_by: { timestamp: asc }
      limit: 20000
    ) {
      id
      timestamp
      tickLower
      tickUpper
      liquidityDelta
      eventType
      owner
    }
  }
`;

const Q_POOL = `
  query ProofV3PoolMintBurn($pool: String!, $startTime: Int!, $endTime: Int!) {
    UniswapV3Pool_Mint(
      where: { pool: { _eq: $pool }, timestamp: { _gte: $startTime, _lte: $endTime } }
      order_by: { timestamp: asc }
      limit: 20000
    ) {
      id
      timestamp
      transactionHash
      tickLower
      tickUpper
      amount
    }
    UniswapV3Pool_Burn(
      where: { pool: { _eq: $pool }, timestamp: { _gte: $startTime, _lte: $endTime } }
      order_by: { timestamp: asc }
      limit: 20000
    ) {
      id
      timestamp
      transactionHash
      tickLower
      tickUpper
      amount
    }
  }
`;

function poolEventKey({ timestamp, tickLower, tickUpper, absAmount }) {
  return `${timestamp}:${tickLower}:${tickUpper}:${absAmount}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = args.endpoint;
  const pool = toLcAddress(args.pool);
  const startTime = parseIsoToEpochSec(args.startIso);
  const endTime = parseIsoToEpochSec(args.endIso);
  const poolManagerLc = args.poolManager ? toLcAddress(args.poolManager) : "";

  console.log("=== proof-v3-impact-holes (Node.js) ===");
  console.log(`endpoint: ${endpoint}`);
  console.log(`pool:     ${pool}`);
  console.log(`range:    ${args.startIso} (${startTime}) -> ${args.endIso} (${endTime})`);
  console.log("");

  const lpData = await graphql(endpoint, Q_LP, { pool, startTime, endTime });
  const lpEvents = lpData?.LPEvent ?? [];

  // Owner distribution check (disproves "owner == pool manager" if poolManager isn't dominant here).
  if (poolManagerLc) {
    const byOwnerCount = new Map();
    for (const e of lpEvents) {
      const o = toLcAddress(e.owner);
      byOwnerCount.set(o, (byOwnerCount.get(o) ?? 0) + 1);
    }
    const total = lpEvents.length || 1;
    const pmCount = byOwnerCount.get(poolManagerLc) ?? 0;
    const pmPct = (pmCount / total) * 100;

    console.log("Owner sanity check (v3):");
    console.log(`- poolManager: ${poolManagerLc}`);
    console.log(`- LPEvent rows with owner == poolManager: ${pmCount}/${lpEvents.length} (${pmPct.toFixed(2)}%)`);

    const topOwners = [...byOwnerCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log("- top owners by event count:");
    for (const [o, c] of topOwners) console.log(`  - ${o}: ${c}`);
    console.log("");
  }

  let mints = [];
  let burns = [];
  try {
    const poolData = await graphql(endpoint, Q_POOL, { pool, startTime, endTime });
    mints = poolData?.UniswapV3Pool_Mint ?? [];
    burns = poolData?.UniswapV3Pool_Burn ?? [];
  } catch (e) {
    console.log("Pool Mint/Burn query failed.");
    console.log(
      "This usually means your indexer schema does not expose UniswapV3Pool_Mint/Burn with `pool` + `transactionHash` fields yet.",
    );
    console.log("You can still use the owner check above, but the impact-band mismatch proof requires those fields.");
    console.log("");
    console.log("Error:", e?.message ?? String(e));
    return;
  }

  console.log(`LPEvent rows:               ${lpEvents.length}`);
  console.log(`UniswapV3Pool_Mint rows:    ${mints.length}`);
  console.log(`UniswapV3Pool_Burn rows:    ${burns.length}`);
  console.log("");

  // 1) Compare net liquidity delta sums (this should be near-equal if LPEvent fully covers pool Mint/Burn).
  const sumLp = lpEvents.reduce((acc, e) => acc + BigInt(String(e.liquidityDelta)), 0n);
  const sumPool = [
    ...mints.map((e) => BigInt(String(e.amount))),
    ...burns.map((e) => -BigInt(String(e.amount))),
  ].reduce((acc, v) => acc + v, 0n);

  const diff = sumPool - sumLp;
  console.log("Net liquidityDelta over the window:");
  console.log(`- sum(pool Mint/Burn): ${sumPool.toString()}`);
  console.log(`- sum(LPEvent):        ${sumLp.toString()}`);
  console.log(`- diff(pool - LPEvent): ${diff.toString()}  (abs=${absBigInt(diff).toString()})`);
  console.log("");

  // 2) Heuristic matching: for each pool Mint/Burn, find an LPEvent with same ts/ticks/abs(liquidityDelta).
  const lpKeyCount = new Map();
  for (const e of lpEvents) {
    const ts = Number(e.timestamp);
    const tl = String(e.tickLower);
    const tu = String(e.tickUpper);
    const absAmount = absBigInt(BigInt(String(e.liquidityDelta))).toString();
    const k = poolEventKey({ timestamp: ts, tickLower: tl, tickUpper: tu, absAmount });
    lpKeyCount.set(k, (lpKeyCount.get(k) ?? 0) + 1);
  }

  const poolRows = [];
  for (const m of mints) {
    poolRows.push({
      kind: "MINT",
      id: m.id,
      ts: Number(m.timestamp),
      tx: String(m.transactionHash ?? ""),
      tickLower: String(m.tickLower),
      tickUpper: String(m.tickUpper),
      absAmount: BigInt(String(m.amount)),
      delta: BigInt(String(m.amount)),
    });
  }
  for (const b of burns) {
    poolRows.push({
      kind: "BURN",
      id: b.id,
      ts: Number(b.timestamp),
      tx: String(b.transactionHash ?? ""),
      tickLower: String(b.tickLower),
      tickUpper: String(b.tickUpper),
      absAmount: BigInt(String(b.amount)),
      delta: -BigInt(String(b.amount)),
    });
  }
  poolRows.sort((a, b) => a.ts - b.ts);

  let unmatched = 0;
  const unmatchedRows = [];
  for (const r of poolRows) {
    const k = poolEventKey({
      timestamp: r.ts,
      tickLower: r.tickLower,
      tickUpper: r.tickUpper,
      absAmount: r.absAmount.toString(),
    });
    const c = lpKeyCount.get(k) ?? 0;
    if (c > 0) lpKeyCount.set(k, c - 1);
    else {
      unmatched++;
      unmatchedRows.push(r);
    }
  }

  console.log("Heuristic coverage check (pool Mint/Burn matched to LPEvent by timestamp+ticks+abs(delta)):");
  console.log(`- pool events total: ${poolRows.length}`);
  console.log(`- unmatched pool events: ${unmatched}`);
  console.log("");

  if (unmatchedRows.length) {
    unmatchedRows.sort((a, b) => (a.absAmount === b.absAmount ? 0 : a.absAmount > b.absAmount ? -1 : 1));
    console.log("Top unmatched pool liquidity events (largest |delta|):");
    for (const r of unmatchedRows.slice(0, 10)) {
      console.log(
        `- ${isoFromEpoch(r.ts)} ${r.kind} delta=${r.delta.toString()} ticks=[${r.tickLower},${r.tickUpper}] tx=${r.tx || "(no tx hash)"}`
      );
    }
    console.log("");
    console.log(
      "Interpretation: if you see non-trivial unmatched pool events, LPEvent does NOT fully cover TickLiquidity changes."
    );
    console.log(
      "That makes an LPEvent-based rollback unreliable for v3 impact bands (drift grows with window length), causing spikes/holes."
    );
  } else {
    console.log(
      "No unmatched pool events were found by this heuristic. That suggests LPEvent coverage is good *for this window*,"
    );
    console.log(
      "so if you still see holes, the root cause is likely elsewhere (tick windowing, liquidity snapshots, or math edge cases).",
    );
  }
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? String(err));
  process.exit(1);
});


