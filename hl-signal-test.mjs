// HL Signal Spec Validation — Using real Bebop RFQ data + HL candles
// Tests the actual signal: SIGNAL = (HL 5-min return) - (Bebop capture return)

const HL_API = "https://api.hyperliquid.xyz/info";
const BEBOP_API = "https://indexer-solana-production.up.railway.app/api/rfq/bebop/latest";

const TOKEN_DECIMALS = 18;
const USDC_DECIMALS = 6;

// ─── Helpers ────────────────────────────────────────────────────────────────

function rawToNumber(raw, decimals) {
  if (!raw || raw === "0") return 0;
  const bigVal = BigInt(raw);
  const divisor = BigInt(10 ** decimals);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

function computeBebopTokenPrice(q) {
  const sellDecimals = q.direction === "forward" ? USDC_DECIMALS : TOKEN_DECIMALS;
  const buyDecimals = q.direction === "forward" ? TOKEN_DECIMALS : USDC_DECIMALS;
  const sellAmount = rawToNumber(q.requested_sell_amount_raw, sellDecimals);
  const buyAmount = rawToNumber(q.quote_buy_amount_raw, buyDecimals);
  if (q.direction === "forward") {
    return buyAmount > 0 ? sellAmount / buyAmount : 0;
  }
  return sellAmount > 0 ? buyAmount / sellAmount : 0;
}

// ─── Fetch Bebop RFQ History (paginated, 7 days) ───────────────────────────

async function fetchBebopHistory(asset) {
  const allQuotes = [];
  let cursor = null;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (let page = 0; page < 15; page++) {
    const url = new URL(BEBOP_API);
    url.searchParams.set("asset", asset);
    url.searchParams.set("include_routes", "false");
    url.searchParams.set("limit", "10000");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Bebop API ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    if (!json.data || json.data.length === 0) break;

    const filtered = json.data.filter(q => q.is_success);
    allQuotes.push(...filtered);

    const oldest = json.data[json.data.length - 1];
    if (oldest && new Date(oldest.quote_at).getTime() < cutoff) break;
    if (!json.pagination?.has_more || !json.pagination.next_cursor) break;
    cursor = json.pagination.next_cursor;

    await new Promise(r => setTimeout(r, 200));
  }

  return allQuotes;
}

// ─── Build Bebop capture timeseries (mid price per capture) ─────────────────

function buildBebopCaptures(quotes) {
  // Group by capture_id
  const captures = new Map();
  for (const q of quotes) {
    let cap = captures.get(q.capture_id);
    if (!cap) {
      cap = { quoteAt: q.quote_at, quotes: [] };
      captures.set(q.capture_id, cap);
    }
    cap.quotes.push(q);
  }

  // For each capture, compute mid price from smallest notional tier
  const points = [];
  for (const cap of captures.values()) {
    // Use $1K or smallest notional forward quotes for mid
    const forwardQuotes = cap.quotes.filter(q => q.direction === "forward");
    const reverseQuotes = cap.quotes.filter(q => q.direction === "reverse");

    if (forwardQuotes.length === 0) continue;

    // Sort by notional, pick smallest
    forwardQuotes.sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd));
    reverseQuotes.sort((a, b) => parseFloat(a.notional_usd) - parseFloat(b.notional_usd));

    const fwdPrice = computeBebopTokenPrice(forwardQuotes[0]);
    const revPrice = reverseQuotes.length > 0 ? computeBebopTokenPrice(reverseQuotes[0]) : fwdPrice;

    const midPrice = (fwdPrice + revPrice) / 2;
    if (midPrice <= 0) continue;

    points.push({
      timestamp: new Date(cap.quoteAt).getTime(),
      midPrice,
      fwdPrice,
      revPrice,
    });
  }

  points.sort((a, b) => a.timestamp - b.timestamp);

  // Remove outliers (>20% from median)
  if (points.length >= 3) {
    const mids = points.map(p => p.midPrice).sort((a, b) => a - b);
    const median = mids[Math.floor(mids.length / 2)];
    const lo = median * 0.8, hi = median * 1.2;
    return points.filter(p => p.midPrice >= lo && p.midPrice <= hi);
  }
  return points;
}

// ─── Fetch HL Candles ──────────────────────────────────────────────────────

async function fetchHLCandles(coin, startTime, endTime) {
  let cursor = startTime;
  const out = [];

  while (cursor < endTime) {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin, interval: "1m", startTime: cursor, endTime }
      })
    });
    if (!res.ok) throw new Error(`HL HTTP ${res.status}`);
    const data = await res.json();
    if (!data.length) break;
    out.push(...data);
    const last = data[data.length - 1].t;
    if (last <= cursor) break;
    cursor = last + 1;
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

// ─── Build HL price lookup (timestamp → close price) ───────────────────────

function buildHLPriceLookup(candles) {
  // Map: minute-aligned timestamp → close price
  const map = new Map();
  for (const c of candles) {
    map.set(c.t, parseFloat(c.c));
  }
  return map;
}

function getHLPriceAt(hlMap, targetMs, toleranceMs = 90_000) {
  // Find nearest candle within tolerance
  let bestKey = null;
  let bestDist = Infinity;
  for (const [t] of hlMap) {
    const dist = Math.abs(t - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = t;
    }
  }
  if (bestKey !== null && bestDist <= toleranceMs) {
    return { price: hlMap.get(bestKey), timestamp: bestKey };
  }
  return null;
}

// ─── Signal Computation ────────────────────────────────────────────────────

function computeSignals(bebopCaptures, hlMap, asset) {
  const HL_WINDOW_MS = 5 * 60 * 1000; // 5 min
  const THRESHOLD = 30;                // bps
  const COOLDOWN_MS = 10 * 60 * 1000;  // 10 min
  const OUTLIER_FILTER = 200;          // bps
  const STOP_LOSS = -50;               // bps

  const signals = [];
  let lastSignalTime = -Infinity;

  for (let i = 1; i < bebopCaptures.length; i++) {
    const cap = bebopCaptures[i];
    const prevCap = bebopCaptures[i - 1];

    // Bebop capture-to-capture return
    const bebopReturn = ((cap.midPrice - prevCap.midPrice) / prevCap.midPrice) * 10000;

    // HL 5-min return at this capture's timestamp
    const hlNow = getHLPriceAt(hlMap, cap.timestamp);
    const hl5mAgo = getHLPriceAt(hlMap, cap.timestamp - HL_WINDOW_MS);
    if (!hlNow || !hl5mAgo) continue;

    const hlReturn = ((hlNow.price - hl5mAgo.price) / hl5mAgo.price) * 10000;

    // THE SIGNAL: HL moved more than Bebop
    const delta = hlReturn - bebopReturn;

    if (Math.abs(delta) > OUTLIER_FILTER) continue;
    if (Math.abs(delta) < THRESHOLD) continue;
    if (cap.timestamp - lastSignalTime < COOLDOWN_MS) continue;

    const direction = delta > 0 ? "LONG" : "SHORT";

    // Simulate exit: look at next 1, 2, 5 Bebop captures
    const exit1 = bebopCaptures[i + 1] || null;
    const exit2 = bebopCaptures[i + 2] || null;
    const exit5 = bebopCaptures[i + 5] || null;

    const entryPrice = cap.midPrice;

    function calcPnl(exitCap) {
      if (!exitCap) return null;
      const exitPrice = exitCap.midPrice;
      return direction === "LONG"
        ? ((exitPrice - entryPrice) / entryPrice) * 10000
        : ((entryPrice - exitPrice) / entryPrice) * 10000;
    }

    const pnl1 = calcPnl(exit1);
    const pnl2 = calcPnl(exit2);
    const pnl5 = calcPnl(exit5);

    // Apply stop-loss check on pnl1
    let stopped = false;
    if (pnl1 !== null && pnl1 < STOP_LOSS) stopped = true;

    signals.push({
      time: new Date(cap.timestamp).toISOString(),
      asset,
      direction,
      delta: delta.toFixed(1),
      hlReturn: hlReturn.toFixed(1),
      bebopReturn: bebopReturn.toFixed(1),
      entryPrice: entryPrice.toFixed(2),
      pnl1: pnl1,
      pnl2: pnl2,
      pnl5: pnl5,
      stopped,
      exitTime1: exit1 ? new Date(exit1.timestamp).toISOString() : null,
      exitTime2: exit2 ? new Date(exit2.timestamp).toISOString() : null,
      captureInterval: exit1 ? ((exit1.timestamp - cap.timestamp) / 60000).toFixed(1) : null,
    });

    lastSignalTime = cap.timestamp;
  }

  return signals;
}

// ─── Reporting ─────────────────────────────────────────────────────────────

function summarize(signals, label) {
  if (!signals.length) {
    console.log(`\n=== ${label}: No signals found ===`);
    return;
  }

  const valid1 = signals.filter(s => s.pnl1 !== null);
  const valid2 = signals.filter(s => s.pnl2 !== null);
  const valid5 = signals.filter(s => s.pnl5 !== null);

  const wins1 = valid1.filter(s => s.pnl1 > 0).length;
  const wins2 = valid2.filter(s => s.pnl2 > 0).length;
  const wins5 = valid5.filter(s => s.pnl5 > 0).length;

  const avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
  const avgPnl1 = avg(valid1.map(s => s.pnl1));
  const avgPnl2 = avg(valid2.map(s => s.pnl2));
  const avgPnl5 = valid5.length > 0 ? avg(valid5.map(s => s.pnl5)) : 0;

  const maxLoss2 = valid2.length ? Math.min(...valid2.map(s => s.pnl2)) : 0;
  const maxWin2 = valid2.length ? Math.max(...valid2.map(s => s.pnl2)) : 0;

  const avgWin2 = valid2.filter(s => s.pnl2 > 0).length > 0
    ? avg(valid2.filter(s => s.pnl2 > 0).map(s => s.pnl2)) : 0;
  const avgLoss2 = valid2.filter(s => s.pnl2 <= 0).length > 0
    ? avg(valid2.filter(s => s.pnl2 <= 0).map(s => s.pnl2)) : 0;

  // Cost-adjusted (5 bps per trade as per spec)
  const COST_BPS = 5;
  const netAvgPnl2 = avgPnl2 - COST_BPS;

  console.log(`\n${"=".repeat(65)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(65)}`);
  console.log(`  Total signals:     ${signals.length}`);
  console.log(`  Avg capture gap:   ${signals.filter(s => s.captureInterval).length > 0 ? avg(signals.filter(s => s.captureInterval).map(s => parseFloat(s.captureInterval))).toFixed(1) : "?"} min`);
  console.log(`  ---`);
  console.log(`  Exit @ 1 cap:   WR=${(wins1/valid1.length*100).toFixed(0)}%  Avg=${avgPnl1.toFixed(1)} bps  (${valid1.length} trades)`);
  console.log(`  Exit @ 2 caps:  WR=${(wins2/valid2.length*100).toFixed(0)}%  Avg=${avgPnl2.toFixed(1)} bps  (${valid2.length} trades)`);
  console.log(`  Exit @ 5 caps:  WR=${(wins5/valid5.length*100).toFixed(0)}%  Avg=${avgPnl5.toFixed(1)} bps  (${valid5.length} trades)`);
  console.log(`  ---`);
  console.log(`  Avg Win (2cap):    +${avgWin2.toFixed(1)} bps`);
  console.log(`  Avg Loss (2cap):   ${avgLoss2.toFixed(1)} bps`);
  console.log(`  Max Win (2cap):    +${maxWin2.toFixed(1)} bps`);
  console.log(`  Max Loss (2cap):   ${maxLoss2.toFixed(1)} bps`);
  console.log(`  ---`);
  console.log(`  Net Avg P&L (2cap, -${COST_BPS}bps cost): ${netAvgPnl2.toFixed(1)} bps`);
  console.log(`  Est. daily P&L @ $50K: $${(netAvgPnl2 / 10000 * 50000 * signals.length / 7).toFixed(0)}/day`);

  // Show recent signals
  console.log(`\n  Recent signals (last 15):`);
  const recent = signals.slice(-15);
  for (const s of recent) {
    const win = s.pnl2 !== null ? (s.pnl2 > 0 ? "✅" : "❌") : "⏳";
    const pnl2Str = s.pnl2 !== null ? `${s.pnl2.toFixed(1)}bps` : "N/A";
    console.log(`    ${win} ${s.time.slice(5,16)} | ${s.direction.padEnd(5)} | Δ=${s.delta}bps (HL=${s.hlReturn}, Beb=${s.bebopReturn}) | $${s.entryPrice} | P&L@2cap=${pnl2Str}`);
  }

  return { signals: signals.length, winRate: wins2/valid2.length, avgPnl: avgPnl2, netAvgPnl: netAvgPnl2 };
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  const end = Date.now();
  const start = end - 7 * 24 * 60 * 60 * 1000;

  const assets = [
    { hlCoin: "xyz:GOOGL", bebopAsset: "GOOGLx", name: "GOOGL" },
    { hlCoin: "xyz:NVDA",  bebopAsset: "NVDAx",  name: "NVDA" },
    { hlCoin: "xyz:CRCL",  bebopAsset: "CRCLx",  name: "CRCL" },
    { hlCoin: "xyz:TSLA",  bebopAsset: "TSLAx",  name: "TSLA" },
    { hlCoin: "xyz:META",  bebopAsset: "METAx",  name: "META" },
  ];

  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║  HL Signal Spec Validation — REAL Bebop RFQ + HL Candle Data    ║`);
  console.log(`╠══════════════════════════════════════════════════════════════════╣`);
  console.log(`║  Period: ${new Date(start).toISOString().slice(0,10)} → ${new Date(end).toISOString().slice(0,10)} (7 days)              ║`);
  console.log(`║  Signal: DELTA = HL_5m_return − Bebop_capture_return            ║`);
  console.log(`║  Threshold: >30 bps | Cooldown: 10 min | Outlier: >200 bps     ║`);
  console.log(`║  Cost: 5 bps/trade | Stop-loss: -50 bps                        ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

  let allSignals = [];
  const results = {};

  for (const { hlCoin, bebopAsset, name } of assets) {
    process.stdout.write(`📡 Fetching ${name}... `);

    try {
      // Fetch both data sources
      process.stdout.write("Bebop RFQ...");
      const bebopQuotes = await fetchBebopHistory(bebopAsset);
      process.stdout.write(` ${bebopQuotes.length} quotes`);

      const bebopCaptures = buildBebopCaptures(bebopQuotes);
      process.stdout.write(` → ${bebopCaptures.length} captures`);

      process.stdout.write(" | HL candles...");
      const hlCandles = await fetchHLCandles(hlCoin, start, end);
      console.log(` ${hlCandles.length} candles`);

      if (bebopCaptures.length < 5 || hlCandles.length < 10) {
        console.log(`  ⚠️  Too few data points for ${name}, skipping`);
        continue;
      }

      // Build HL price lookup
      const hlMap = buildHLPriceLookup(hlCandles);

      // Compute signals
      const signals = computeSignals(bebopCaptures, hlMap, name);
      allSignals.push(...signals);
      results[name] = summarize(signals, name);

    } catch (err) {
      console.log(` ❌ Error: ${err.message}`);
    }
  }

  // ─── Portfolio Summary ────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(65)}`);
  console.log(`  PORTFOLIO SUMMARY (all assets, net of 5bps costs)`);
  console.log(`${"═".repeat(65)}`);
  console.log(`  Total signals: ${allSignals.length}`);

  const valid2 = allSignals.filter(s => s.pnl2 !== null);
  if (valid2.length > 0) {
    const winRate = valid2.filter(s => s.pnl2 > 0).length / valid2.length * 100;
    const avgPnl = valid2.reduce((s, x) => s + x.pnl2, 0) / valid2.length;
    const netPnl = avgPnl - 5;
    console.log(`  Overall WR (2-cap exit):  ${winRate.toFixed(0)}%`);
    console.log(`  Overall Avg P&L (gross):  ${avgPnl.toFixed(1)} bps`);
    console.log(`  Overall Avg P&L (net):    ${netPnl.toFixed(1)} bps`);
    console.log(`  Est. daily P&L @ $50K:    $${(netPnl / 10000 * 50000 * allSignals.length / 7).toFixed(0)}/day`);

    // ─── Comparison Table ───────────────────────────────────────────────────
    console.log(`\n${"═".repeat(65)}`);
    console.log(`  COMPARISON: Our Results vs Spec (Mar 19-25 backtest)`);
    console.log(`${"═".repeat(65)}`);
    console.log(`  ${"Asset".padEnd(8)} ${"Trades".padEnd(8)} ${"WR(ours)".padEnd(10)} ${"WR(spec)".padEnd(10)} ${"AvgP&L".padEnd(10)} ${"$/day(ours)".padEnd(12)} ${"$/day(spec)".padEnd(12)}`);
    console.log(`  ${"─".repeat(60)}`);

    const specData = {
      GOOGL: { trades: 39, wr: 82, avgPnl: 15.7, daily: 437 },
      NVDA:  { trades: 47, wr: 85, avgPnl: 12.0, daily: 404 },
      CRCL:  { trades: 246, wr: 82, avgPnl: 30.8, daily: 5418 },
    };

    for (const [name, r] of Object.entries(results)) {
      if (!r) continue;
      const sp = specData[name];
      const dailyEst = (r.netAvgPnl / 10000 * 50000 * r.signals / 7).toFixed(0);
      console.log(`  ${name.padEnd(8)} ${String(r.signals).padEnd(8)} ${(r.winRate*100).toFixed(0).padEnd(10)}% ${sp ? `${sp.wr}%`.padEnd(10) : "N/A".padEnd(10)} ${r.avgPnl.toFixed(1).padEnd(10)} $${dailyEst.padEnd(11)} ${sp ? `$${sp.daily}` : "N/A"}`);
    }

    // Session analysis
    console.log(`\n${"═".repeat(65)}`);
    console.log(`  SESSION ANALYSIS (Market Hours 13:30-20:00 UTC vs After-Hours)`);
    console.log(`${"═".repeat(65)}`);

    const mhSignals = allSignals.filter(s => {
      const h = new Date(s.time).getUTCHours();
      return h >= 13 && h < 20;
    });
    const ahSignals = allSignals.filter(s => {
      const h = new Date(s.time).getUTCHours();
      return !(h >= 13 && h < 20);
    });

    const mhValid = mhSignals.filter(s => s.pnl2 !== null);
    const ahValid = ahSignals.filter(s => s.pnl2 !== null);

    if (mhValid.length > 0) {
      const mhWr = mhValid.filter(s => s.pnl2 > 0).length / mhValid.length * 100;
      const mhAvg = mhValid.reduce((s, x) => s + x.pnl2, 0) / mhValid.length;
      console.log(`  Market Hours:  ${mhValid.length} trades, WR=${mhWr.toFixed(0)}%, Avg=${mhAvg.toFixed(1)} bps`);
    }
    if (ahValid.length > 0) {
      const ahWr = ahValid.filter(s => s.pnl2 > 0).length / ahValid.length * 100;
      const ahAvg = ahValid.reduce((s, x) => s + x.pnl2, 0) / ahValid.length;
      console.log(`  After-Hours:   ${ahValid.length} trades, WR=${ahWr.toFixed(0)}%, Avg=${ahAvg.toFixed(1)} bps`);
    }

    // Day-by-day breakdown
    console.log(`\n${"═".repeat(65)}`);
    console.log(`  DAY-BY-DAY BREAKDOWN`);
    console.log(`${"═".repeat(65)}`);

    const byDay = new Map();
    for (const s of allSignals) {
      const day = s.time.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(s);
    }

    for (const [day, daySignals] of [...byDay.entries()].sort()) {
      const dv = daySignals.filter(s => s.pnl2 !== null);
      if (dv.length === 0) continue;
      const wr = dv.filter(s => s.pnl2 > 0).length / dv.length * 100;
      const avg = dv.reduce((s, x) => s + x.pnl2, 0) / dv.length;
      const totalPnl = dv.reduce((s, x) => s + x.pnl2, 0);
      const dollarPnl = ((totalPnl - 5 * dv.length) / 10000 * 50000);
      console.log(`  ${day}  ${String(dv.length).padEnd(4)} signals  WR=${wr.toFixed(0).padEnd(3)}%  Avg=${avg.toFixed(1).padEnd(6)} bps  Est=$${dollarPnl.toFixed(0)}`);
    }

    // Top 10 best and worst trades
    console.log(`\n${"═".repeat(65)}`);
    console.log(`  TOP 10 BEST OPPORTUNITIES`);
    console.log(`${"═".repeat(65)}`);
    const sorted = [...valid2].sort((a, b) => b.pnl2 - a.pnl2);
    for (const s of sorted.slice(0, 10)) {
      console.log(`  ✅ ${s.time.slice(0,16)} ${s.asset.padEnd(6)} ${s.direction.padEnd(5)} Δ=${s.delta}bps → +${s.pnl2.toFixed(1)}bps ($${(s.pnl2/10000*50000).toFixed(0)} on $50K)`);
    }

    console.log(`\n  WORST 10 TRADES`);
    for (const s of sorted.slice(-10).reverse()) {
      console.log(`  ❌ ${s.time.slice(0,16)} ${s.asset.padEnd(6)} ${s.direction.padEnd(5)} Δ=${s.delta}bps → ${s.pnl2.toFixed(1)}bps ($${(s.pnl2/10000*50000).toFixed(0)} on $50K)`);
    }
  }

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  CONCLUSION`);
  console.log(`${"═".repeat(65)}`);
  const v2 = allSignals.filter(s => s.pnl2 !== null);
  if (v2.length > 0) {
    const wr = v2.filter(s => s.pnl2 > 0).length / v2.length * 100;
    if (wr > 60) {
      console.log(`  ✅ Signal VALIDATED — ${wr.toFixed(0)}% win rate across ${allSignals.length} signals`);
      console.log(`     The HL-Bebop lag is real and tradeable.`);
    } else if (wr > 50) {
      console.log(`  ⚠️  Signal MARGINAL — ${wr.toFixed(0)}% win rate across ${allSignals.length} signals`);
      console.log(`     Edge exists but may not survive execution costs.`);
    } else {
      console.log(`  ❌ Signal NOT VALIDATED — ${wr.toFixed(0)}% win rate across ${allSignals.length} signals`);
      console.log(`     The edge from the spec period may not persist.`);
    }
  }
  console.log(``);
})();
