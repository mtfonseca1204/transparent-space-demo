#!/usr/bin/env node
/**
 * Aggregates LP-level TVL by asset across Kraken Solana pools.
 *
 * For each pool:
 *   - Fetches pool state (sqrtPriceX96, tick, decimals, prices) from /api/pool
 *   - Fetches active positions from the Solana indexer (Railway)
 *   - Uses Uniswap V3 math to compute each LP's USD-denominated TVL
 *
 * Then groups LPs across all configured pools and prints the top LPs by TVL.
 */

const APP_BASE = process.env.APP_BASE ?? "http://localhost:3000";
const SOLANA_INDEXER =
  process.env.SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

// Kraken Solana pools (Raydium primary, Raydium alt-fee, Byreal).
const POOLS = [
  // Raydium primary
  { address: "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum", venue: "Raydium 0.25%" },
  { address: "4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN", venue: "Raydium 0.25%" },
  { address: "7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME", venue: "Raydium 0.25%" },
  { address: "FknDV1F5n6QaA7rLmjquDjuU6wcPMNm5RYq7zWbqhpZw", venue: "Raydium 0.25%" },
  { address: "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze", venue: "Raydium 0.25%" },
  { address: "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw", venue: "Raydium 0.25%" },
  { address: "3Z4H4H9bCcLyt1MmK44J5KZWkJ7taiU821QDTVZYaCpz", venue: "Raydium 0.25%" },
  { address: "G39wywquKbHK8F2wZZZFX3fcsyG91VCCbbr6WEVp5axy", venue: "Raydium 0.25%" },
  { address: "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j", venue: "Raydium 0.25%" },
  { address: "5pobXosbeGSCRG3HdaRiw2TaihDDQMXkHFVbUTF24weM", venue: "Raydium 0.25%" },
  // Raydium alt-fee
  { address: "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF", venue: "Raydium 0.10%" },
  { address: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6", venue: "Raydium 0.10%" },
  { address: "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE", venue: "Raydium 0.10%" },
  { address: "GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG", venue: "Raydium 0.10%" },
  { address: "DXWbip5LducMAbDSSpLYz9Xik3253EPeAYQufQtx7LXs", venue: "Raydium 0.10%" },
  { address: "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV", venue: "Raydium 0.10%" },
  { address: "4J8ovNwnTcPP8cYfveMNvhT7k6LfmJh2Fd8kboyGJfGq", venue: "Raydium 1.00%" },
  { address: "3LbRQkdRnahJfAEBBRajCMki8ZBMhBhidmxbgMzp8nVu", venue: "Raydium 0.10%" },
  // Byreal
  { address: "6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs", venue: "Byreal 0.10%" },
  { address: "GjLusGo2z3mnXPmebhhNt9ocMDJgfdxrDFctVF8Ev3Kg", venue: "Byreal 0.10%" },
  { address: "27x6aSxcAm6SoazoxmmTtFg6fWMQuNmdKJmHagq1DUZy", venue: "Byreal 0.10%" },
  { address: "FSLSua26xaXSLUG31SnyifgS6wgkRh5SirbCZW9zXNoG", venue: "Byreal 0.10%" },
  { address: "4k43WcUS8kPXkmL7PhgpwCteYYaSgzXvfKU63FEE1WS5", venue: "Byreal 0.10%" },
  { address: "Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa", venue: "Byreal 0.10%" },
  { address: "BqXGCG4vcD81GMiX2Rw9sKrSTqeAAZS6mGR5Ek69B7Lm", venue: "Byreal 0.10%" },
];

// ---- Uniswap V3 math (ported from lib/uniswap-v3-math.ts) ----
const Q96 = 2n ** 96n;
const MAX_TICK = 887272;

function getSqrtRatioAtTick(tick) {
  if (tick < -MAX_TICK || tick > MAX_TICK) throw new Error("TICK");
  const absTick = tick < 0 ? -tick : tick;
  let ratio = (absTick & 0x1) !== 0
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;
  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;
  const roundBit = ratio & ((1n << 32n) - 1n);
  let sqrtPriceX96 = ratio >> 32n;
  if (roundBit !== 0n) sqrtPriceX96 += 1n;
  return sqrtPriceX96;
}

function mulDiv(a, b, denom) {
  return (a * b) / denom;
}

function amount1Delta(liquidity, sqrtPA, sqrtPB) {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity, b - a, Q96);
}

function amount0Delta(liquidity, sqrtPA, sqrtPB) {
  const [a, b] = sqrtPA <= sqrtPB ? [sqrtPA, sqrtPB] : [sqrtPB, sqrtPA];
  return mulDiv(liquidity << 96n, b - a, b * a);
}

function amountsForPosition({ liquidity, tickLower, tickUpper, sqrtPriceX96 }) {
  if (liquidity <= 0n) return { amount0: 0n, amount1: 0n };
  const sqrtA = getSqrtRatioAtTick(tickLower);
  const sqrtB = getSqrtRatioAtTick(tickUpper);
  if (sqrtPriceX96 <= sqrtA) {
    return { amount0: amount0Delta(liquidity, sqrtA, sqrtB), amount1: 0n };
  }
  if (sqrtPriceX96 < sqrtB) {
    return {
      amount0: amount0Delta(liquidity, sqrtPriceX96, sqrtB),
      amount1: amount1Delta(liquidity, sqrtA, sqrtPriceX96),
    };
  }
  return { amount0: 0n, amount1: amount1Delta(liquidity, sqrtA, sqrtB) };
}

function bigintToApproxNumber(x, decimals) {
  const neg = x < 0n;
  const v = neg ? -x : x;
  if (v === 0n) return 0;
  const base = 10n ** BigInt(Math.max(decimals, 0));
  const i = v / base;
  const f = v % base;
  const iStr = i.toString();
  let iNum;
  if (iStr.length > 15) {
    iNum = Number(iStr.slice(0, 15)) * 10 ** (iStr.length - 15);
  } else {
    iNum = Number(i);
  }
  const fNum = decimals > 0 ? Number(f) / Number(base) : 0;
  return (neg ? -1 : 1) * (iNum + fNum);
}
// ---- end math ----

function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function shortAddr(a) {
  if (!a) return "?";
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function shortVenue(v) {
  return v.replace("Raydium", "Ray").replace("Byreal", "Byr");
}

async function fetchJson(url, timeoutMs = 30000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function fetchPoolMeta(addr) {
  return fetchJson(`${APP_BASE}/api/pool/${encodeURIComponent(addr)}`);
}

async function fetchPositions(addr) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${SOLANA_INDEXER}/api/positions`);
    url.searchParams.set("pool", addr);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("active", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const d = await fetchJson(url.toString(), 45000);
    const rows = Array.isArray(d) ? d : (d.data ?? []);
    all.push(...rows);
    const next = d?.pagination?.next_cursor;
    if (!d?.pagination?.has_more || !next) break;
    cursor = next;
  }
  return all;
}

async function fetchTokenPrices() {
  return fetchJson(`${APP_BASE}/api/token-prices`);
}

async function processPool(pool, priceMap) {
  const meta = await fetchPoolMeta(pool.address);
  const positions = await fetchPositions(pool.address);

  const sqrtPriceX96 = BigInt(meta.sqrtPriceX96);
  const t0Dec = meta.token0Decimals;
  const t1Dec = meta.token1Decimals;

  // Determine USD prices for token0/token1.
  const t0Addr = (meta.token0Address || "").toLowerCase();
  const t1Addr = (meta.token1Address || "").toLowerCase();
  let p0 = priceMap[t0Addr] ?? 0;
  let p1 = priceMap[t1Addr] ?? 0;
  // Derive missing price from currentPrice (token1 per token0).
  if (p1 > 0 && p0 === 0 && meta.currentPrice > 0) p0 = meta.currentPrice * p1;
  if (p0 > 0 && p1 === 0 && meta.currentPrice > 0) p1 = p0 / meta.currentPrice;

  // Aggregate per-owner TVL.
  const ownerTvl = new Map();
  for (const pos of positions) {
    const liq = BigInt(pos.liquidity ?? "0");
    if (liq <= 0n) continue;
    const owner = (pos.nft_owner ?? pos.owner ?? "").toString();
    if (!owner) continue;
    const tickLower = Number(pos.tick_lower ?? pos.tickLower);
    const tickUpper = Number(pos.tick_upper ?? pos.tickUpper);
    const { amount0, amount1 } = amountsForPosition({
      liquidity: liq,
      tickLower,
      tickUpper,
      sqrtPriceX96,
    });
    const usd =
      bigintToApproxNumber(amount0, t0Dec) * p0 +
      bigintToApproxNumber(amount1, t1Dec) * p1;
    if (usd <= 0) continue;
    ownerTvl.set(owner, (ownerTvl.get(owner) ?? 0) + usd);
  }

  return {
    address: pool.address,
    venue: pool.venue,
    asset: meta.token0Symbol,
    quote: meta.token1Symbol,
    poolTvl: [...ownerTvl.values()].reduce((s, v) => s + v, 0),
    ownerTvl,
  };
}

async function main() {
  console.log("Fetching token prices...");
  const prices = await fetchTokenPrices();
  const priceMap = prices.pricesUsdByAddress ?? {};

  console.log(`Processing ${POOLS.length} Kraken Solana pools...\n`);

  const poolResults = [];
  for (const pool of POOLS) {
    process.stdout.write(`  ${shortAddr(pool.address)} ${pool.venue.padEnd(14)} … `);
    try {
      const r = await processPool(pool, priceMap);
      poolResults.push(r);
      console.log(
        `${(r.asset + "/" + r.quote).padEnd(14)} TVL ${fmt(r.poolTvl).padStart(10)} (${r.ownerTvl.size} LPs)`
      );
    } catch (e) {
      console.log(`ERR ${e.message}`);
    }
  }

  // Aggregate per-LP across ALL Kraken pools.
  const lpAgg = new Map(); // owner -> { tvl, perPool: Map<poolKey, { asset, venue, usd }>, assets: Set, venues: Set }
  let grandTvl = 0;
  const allAssets = new Set();
  for (const r of poolResults) {
    grandTvl += r.poolTvl;
    allAssets.add(r.asset);
    for (const [owner, usd] of r.ownerTvl) {
      let g = lpAgg.get(owner);
      if (!g) {
        g = { tvl: 0, perPool: new Map(), assets: new Set(), venues: new Set() };
        lpAgg.set(owner, g);
      }
      g.tvl += usd;
      g.assets.add(r.asset);
      g.venues.add(r.venue);
      g.perPool.set(`${r.asset}·${r.venue}`, { asset: r.asset, venue: r.venue, usd });
    }
  }

  const lps = [...lpAgg.entries()].sort((a, b) => b[1].tvl - a[1].tvl);
  const top5Tvl = lps.slice(0, 5).reduce((s, [, v]) => s + v.tvl, 0);
  const top10Tvl = lps.slice(0, 10).reduce((s, [, v]) => s + v.tvl, 0);
  const top20Tvl = lps.slice(0, 20).reduce((s, [, v]) => s + v.tvl, 0);

  console.log("\n" + "=".repeat(110));
  console.log(`LP TVL across ALL Kraken Solana pools — ${poolResults.length} pools, ${allAssets.size} assets, ${fmt(grandTvl)} total`);
  console.log(`${lps.length} unique LPs · Top 5 = ${((top5Tvl/grandTvl)*100).toFixed(1)}% · Top 10 = ${((top10Tvl/grandTvl)*100).toFixed(1)}% · Top 20 = ${((top20Tvl/grandTvl)*100).toFixed(1)}%`);
  console.log("=".repeat(110));
  console.log("");
  console.log("  #   LP                #Assets  Assets                                       Venues                              TVL    LIQ%");
  console.log("  " + "─".repeat(119));

  const TOP_N = 30;
  for (let i = 0; i < Math.min(TOP_N, lps.length); i++) {
    const [owner, info] = lps[i];
    const pct = grandTvl > 0 ? (info.tvl / grandTvl) * 100 : 0;
    const assetsList = [...info.assets].sort().join(", ");
    const venuesList = [...info.venues].sort().map(shortVenue).join(", ");
    console.log(
      `  ${String(i + 1).padStart(2)}  ${shortAddr(owner).padEnd(17)} ${String(info.assets.size).padStart(4)}     ${assetsList.padEnd(44).slice(0, 44)} ${venuesList.padEnd(34).slice(0, 34)} ${fmt(info.tvl).padStart(8)} ${pct.toFixed(2).padStart(6)}%`
    );
  }

  console.log("\n  Per-LP breakdown by asset (top " + Math.min(TOP_N, lps.length) + "):");
  console.log("  " + "─".repeat(106));
  for (let i = 0; i < Math.min(TOP_N, lps.length); i++) {
    const [owner, info] = lps[i];
    const breakdown = [...info.perPool.values()]
      .sort((a, b) => b.usd - a.usd)
      .map((p) => `${p.asset}/${shortVenue(p.venue)}=${fmt(p.usd)}`)
      .join("  ");
    console.log(`  ${String(i + 1).padStart(2)} ${shortAddr(owner).padEnd(20)} ${fmt(info.tvl).padStart(8)}  ${breakdown}`);
  }

  console.log("\n" + "=".repeat(110));
  console.log(`TOTAL: ${lps.length} LPs · ${poolResults.length} pools · ${fmt(grandTvl)} aggregate TVL`);
  console.log("=".repeat(110));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
