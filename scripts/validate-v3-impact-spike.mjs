#!/usr/bin/env node
/**
 * validate-v3-impact-spike.mjs
 *
 * Script "auditável" para validar os insumos do gráfico "LP Activity - Historical Data" (v3):
 * - Candles (intervalo de 5m): verifica continuidade e pega candle exato nos horários alvo
 * - PoolHourData: imprime liquidez (L) por hora e destaca mudanças fortes
 * - LPEvent: lista eventos do owner (se houver) e explica quando vier 0 (owner atribuído a outro endereço)
 *
 * Requisitos:
 * - Node.js 18+ (ideal Node 20)
 *
 * Uso:
 *   NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT="https://indexer.hyperindex.xyz/5e2a875/v1/graphql" \
 *   node ./scripts/validate-v3-impact-spike.mjs
 *
 * Flags opcionais:
 *   --endpoint <url>
 *   --pool <0x...>
 *   --owner <0x...>
 *   --start <ISO-8601 Z>   (ex: 2025-12-27T02:00:00Z)
 *   --end   <ISO-8601 Z>
 *   --t1    <ISO-8601 Z>
 *   --t2    <ISO-8601 Z>
 *   --t3    <ISO-8601 Z>
 *   --interval <seconds>   (default 300)
 */

const DEFAULTS = {
  pool: "0x610e319b3a3ab56a0ed5562927d37c233774ba39",
  owner: "0x56991da88cf345bfe80ec1b0c99759f60e8c88c1",
  startIso: "2025-12-27T02:00:00Z",
  endIso: "2025-12-27T08:00:00Z",
  t1Iso: "2025-12-27T02:00:00Z",
  t2Iso: "2025-12-27T03:15:00Z",
  t3Iso: "2025-12-27T07:50:00Z",
  intervalSec: 300,
};

const ENDPOINT_DEFAULT =
  process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT ?? "http://localhost:8080/v1/graphql";

function usage(exitCode = 0) {
  console.log(`
Uso:
  NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT="https://.../v1/graphql" node ./scripts/validate-v3-impact-spike.mjs

Flags:
  --endpoint <url>
  --pool <0x...>
  --owner <0x...>
  --start <ISO-8601 Z>
  --end   <ISO-8601 Z>
  --t1    <ISO-8601 Z>
  --t2    <ISO-8601 Z>
  --t3    <ISO-8601 Z>
  --interval <seconds>   (default ${DEFAULTS.intervalSec})
`);
  process.exit(exitCode);
}

function toLcAddress(s) {
  return String(s ?? "").trim().toLowerCase();
}

function parseIsoToEpochSec(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`ISO inválido: ${iso}`);
  return Math.floor(d.getTime() / 1000);
}

function isoFromEpoch(tsSec) {
  return new Date(tsSec * 1000).toISOString().replace(".000Z", "Z");
}

function abs(n) {
  return n < 0 ? -n : n;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function parseArgs(argv) {
  const out = {
    endpoint: ENDPOINT_DEFAULT,
    pool: DEFAULTS.pool,
    owner: DEFAULTS.owner,
    startIso: DEFAULTS.startIso,
    endIso: DEFAULTS.endIso,
    t1Iso: DEFAULTS.t1Iso,
    t2Iso: DEFAULTS.t2Iso,
    t3Iso: DEFAULTS.t3Iso,
    intervalSec: DEFAULTS.intervalSec,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Flag ${a} requer valor`);
      return argv[++i];
    };
    if (a === "-h" || a === "--help") usage(0);
    if (a === "--endpoint") out.endpoint = next();
    else if (a === "--pool") out.pool = next();
    else if (a === "--owner") out.owner = next();
    else if (a === "--start") out.startIso = next();
    else if (a === "--end") out.endIso = next();
    else if (a === "--t1") out.t1Iso = next();
    else if (a === "--t2") out.t2Iso = next();
    else if (a === "--t3") out.t3Iso = next();
    else if (a === "--interval") out.intervalSec = Number(next());
    else throw new Error(`Flag desconhecida: ${a}`);
  }
  if (!Number.isFinite(out.intervalSec) || out.intervalSec <= 0) {
    throw new Error(`--interval inválido: ${out.intervalSec}`);
  }
  return out;
}

async function fetchJson(url, payload, { timeoutMs = 30_000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();
      const status = res.status;

      if (!text || !text.trim()) {
        throw new Error(`HTTP ${status} com body vazio`);
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        const preview = text.slice(0, 500).replace(/\s+/g, " ").trim();
        throw new Error(`HTTP ${status} não-JSON. Prévia: ${preview}`);
      }

      if (!res.ok) {
        throw new Error(`HTTP ${status}: ${JSON.stringify(json).slice(0, 500)}`);
      }

      return { status, json };
    } catch (e) {
      lastErr = e;
      clearTimeout(t);
      if (attempt < retries) {
        const backoff = 250 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr ?? new Error("Falha desconhecida");
}

async function graphql(endpoint, query, variables) {
  const { json } = await fetchJson(endpoint, { query, variables });
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message || JSON.stringify(e)).join("; ");
    throw new Error(`ERRO GraphQL: ${msg}`);
  }
  return json.data;
}

const Q_CANDLES = `
  query GetCandles($pool: String!, $interval: Int!, $startTime: Int!, $endTime: Int!) {
    Candle(
      where: { pool: { _eq: $pool }, interval: { _eq: $interval }, timestamp: { _gte: $startTime, _lte: $endTime } }
      order_by: { timestamp: asc }
    ) {
      timestamp
      openPrice
      highPrice
      lowPrice
      closePrice
      volume0
      volume1
      txCount
    }
  }
`;

const Q_POOL_HOUR = `
  query GetPoolHourData($pool: String!, $startTime: Int!, $endTime: Int!) {
    PoolHourData(
      where: { pool: { _eq: $pool }, periodStartUnix: { _gte: $startTime, _lte: $endTime } }
      order_by: { periodStartUnix: asc }
    ) {
      periodStartUnix
      liquidity
      txCount
      openPrice
      highPrice
      lowPrice
      closePrice
      volumeToken0
      volumeToken1
    }
  }
`;

const Q_LP_EVENTS_OWNER = `
  query GetLpEvents($pool: String!, $owner: String!, $startTime: Int!, $endTime: Int!) {
    LPEvent(
      where: { pool: { _eq: $pool }, owner: { _eq: $owner }, timestamp: { _gte: $startTime, _lte: $endTime } }
      order_by: { timestamp: asc }
    ) {
      timestamp
      eventType
      liquidityDelta
      tickLower
      tickUpper
      blockNumber
      transactionHash
    }
  }
`;

function countMissingCandleSlots(candles, intervalSec) {
  let missing = 0;
  for (let i = 1; i < candles.length; i++) {
    const prev = Number(candles[i - 1].timestamp);
    const cur = Number(candles[i].timestamp);
    const gap = cur - prev;
    if (gap > intervalSec) {
      const slots = Math.floor(gap / intervalSec) - 1;
      if (slots > 0) missing += slots;
    }
  }
  return missing;
}

function nearestCandle(candles, targetTs) {
  let best = null;
  let bestDist = Infinity;
  for (const c of candles) {
    const ts = Number(c.timestamp);
    const d = abs(ts - targetTs);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best ? { candle: best, absDiffSec: bestDist } : null;
}

function formatPctFromBigint(prev, next) {
  if (prev <= 0n) return null;
  const diff = next - prev;
  // pct with 2 decimals: (diff/prev)*100
  const pctTimes10k = (diff * 10_000n) / prev; // 2 casas * 100
  const pct = Number(pctTimes10k) / 100;
  return pct;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const pool = toLcAddress(args.pool);
  const owner = toLcAddress(args.owner);
  const endpoint = args.endpoint;

  const startTs = parseIsoToEpochSec(args.startIso);
  const endTs = parseIsoToEpochSec(args.endIso);
  const t1Ts = parseIsoToEpochSec(args.t1Iso);
  const t2Ts = parseIsoToEpochSec(args.t2Iso);
  const t3Ts = parseIsoToEpochSec(args.t3Iso);

  console.log("=== validate-v3-impact-spike (Node.js) ===");
  console.log(`endpoint: ${endpoint}`);
  console.log(`pool:     ${pool}`);
  console.log(`owner:    ${owner}`);
  console.log(`range:    ${args.startIso} (${startTs}) -> ${args.endIso} (${endTs})`);
  console.log(
    `targets:  t1=${args.t1Iso} (${t1Ts}), t2=${args.t2Iso} (${t2Ts}), t3=${args.t3Iso} (${t3Ts})`
  );
  console.log(`interval: ${args.intervalSec}s`);
  console.log("");

  console.log("Buscando Candles...");
  const candleData = await graphql(endpoint, Q_CANDLES, {
    pool,
    interval: args.intervalSec,
    startTime: startTs,
    endTime: endTs,
  });
  const candles = candleData?.Candle ?? [];
  console.log(`Candle count: ${candles.length}`);
  console.log(
    `Continuidade (esperado 1 candle a cada ${args.intervalSec}s = ${args.intervalSec / 60}min):`
  );
  const missing = countMissingCandleSlots(candles, args.intervalSec);
  console.log(`- Buracos reais (slots faltando): ${missing}`);
  console.log("");

  console.log("Candles nos horários-alvo (t1/t2/t3):");
  for (const { label, ts } of [
    { label: "t1 (02:00)", ts: t1Ts },
    { label: "t2 (03:15)", ts: t2Ts },
    { label: "t3 (07:50)", ts: t3Ts },
  ]) {
    const hit = nearestCandle(candles, ts);
    if (!hit) {
      console.log(`- ${label}: sem candle encontrado`);
      continue;
    }
    const c = hit.candle;
    console.log(
      `- ${label}: target=${isoFromEpoch(ts)}  candle_ts=${isoFromEpoch(Number(c.timestamp))} (diff=${hit.absDiffSec}s)` +
        `  closePrice(sqrtPriceX96)=${c.closePrice}  txCount=${c.txCount}`
    );
  }
  console.log("");

  console.log("Buscando PoolHourData...");
  const hourData = await graphql(endpoint, Q_POOL_HOUR, {
    pool,
    startTime: startTs,
    endTime: endTs,
  });
  const hours = hourData?.PoolHourData ?? [];
  console.log(`PoolHourData count: ${hours.length}`);
  if (hours.length) {
    console.log("PoolHourData (por hora) — LIQUIDITY (L) que o gráfico usa na simulação do impacto:");
    let prevL = null;
    for (const r of hours) {
      const ts = Number(r.periodStartUnix);
      const L = BigInt(String(r.liquidity));
      const tx = Number(r.txCount);
      let note = "";
      if (prevL !== null) {
        const pct = formatPctFromBigint(prevL, L);
        if (pct !== null && Math.abs(pct) >= 50) note = `  <<< MUDANÇA FORTE (${pct > 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      }
      console.log(`${isoFromEpoch(ts)}  L=${L.toString()}  txCount=${tx}${note}`);
      prevL = L;
    }
  }
  console.log("");

  console.log("Buscando LPEvent (filtrado pelo owner)...");
  const evData = await graphql(endpoint, Q_LP_EVENTS_OWNER, {
    pool,
    owner,
    startTime: startTs,
    endTime: endTs,
  });
  const events = evData?.LPEvent ?? [];
  console.log(`LPEvent count (owner): ${events.length}`);
  if (!events.length) {
    console.log("");
    console.log("OBS: não apareceu nenhum LPEvent para esse owner nesse intervalo.");
    console.log(
      "Isso geralmente significa que a atribuição de 'owner' no indexer está indo para outro endereço (ex.: PositionManager/Router),"
    );
    console.log("então esse filtro pode estar escondendo os eventos que realmente mexeram na liquidez.");
  } else {
    const byType = new Map();
    for (const e of events) byType.set(e.eventType, (byType.get(e.eventType) || 0) + 1);
    console.log("Contagem por tipo:");
    for (const [k, v] of [...byType.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      console.log(`- ${k}: ${v}`);
    }
    console.log("");
    const top = events
      .map((e) => {
        const d = BigInt(String(e.liquidityDelta));
        const absD = d < 0n ? -d : d;
        return { e, absD };
      })
      .sort((a, b) => (a.absD === b.absD ? 0 : a.absD > b.absD ? -1 : 1))
      .slice(0, 10);
    console.log("Top 10 eventos por |liquidityDelta| (prováveis causas de spike):");
    for (const { e } of top) {
      console.log(
        `- ${isoFromEpoch(Number(e.timestamp))} ${e.eventType} liqDelta=${e.liquidityDelta} ticks=[${e.tickLower},${e.tickUpper}] tx=${e.transactionHash}`
      );
    }
  }

  console.log("");
  console.log("Próxima validação recomendada (se LPEvent por owner vier 0):");
  console.log("- Rodar uma query de LPEvent sem filtro de owner e agrupar por owner para achar quem está recebendo a atribuição.");
}

main().catch((err) => {
  console.error("ERRO:", err?.message ?? String(err));
  process.exit(1);
});


