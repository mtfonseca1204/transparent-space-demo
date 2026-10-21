/**
 * Transforms for the Kraken birds-eye "Flows" tab.
 *
 * Combines net xStock flow into user circulation over time.
 *
 * Kraken now uses the Solana indexer's Dune-backed
 * `/api/xstocks/flow-to-users` endpoint. Demo still uses local RFQ/pool
 * fixtures through the legacy builder below.
 *
 * Legacy fixture mode combines two sources:
 *   1. RFQ maker volume (`/api/xstocks/maker-volume`) — per-row `direction` is
 *      "in" (asset acquired by the maker) or "out" (asset distributed by the
 *      maker). We sum xStock-symbol rows only; USDC rows are the counterpart
 *      leg of the same trade and would double-count net flow.
 *   2. Pool net flow (indexer `/api/xstocks/pool-net-flow`) — Timescale
 *      aggregated Solana swap data: `buyUsd` = LP acquired xStock,
 *      `sellUsd` = LP distributed xStock.
 *
 * Display sign convention: positive = users acquired xStock / inventory moved
 * into circulation; negative = users returned/sold xStock back to MM/pools.
 *
 * RFQ providers are grouped by maker where that grouping is informative, but
 * JupZ is kept separate because it is the dominant directional RFQ source.
 *   flowdesk = ["1inch", "0x", "bebop"]
 *   cowswap  = Tokka CoW rail
 *   jupiterz = Tokka JupZ rail
 *
 * Aggregator providers (0x, bebop, kyberswap) report mirrored in/out rows
 * because the maker_address is a settlement contract that transiently holds
 * both legs of every trade. Their net contribution is structurally ~0 and
 * does not represent directional user acquisition.
 */

import type { XstocksMakerVolumeRow } from "@/lib/xstocks-maker-volume-chart";

export type FlowSource = string;

export interface FlowSourceMeta {
  source: FlowSource;
  label: string;
  shortLabel: string;
  /** Color used for the positive user-acquired bar; negatives use the same hue. */
  color: string;
}

export const FLOW_SOURCE_META: Record<FlowSource, FlowSourceMeta> = {
  "rfq-flowdesk": {
    source: "rfq-flowdesk",
    label: "RFQ · Flowdesk",
    shortLabel: "FD RFQ",
    color: "#0ea5e9",
  },
  "rfq-cowswap": {
    source: "rfq-cowswap",
    label: "RFQ · CoW",
    shortLabel: "CoW RFQ",
    color: "#10b981",
  },
  "rfq-jupz": {
    source: "rfq-jupz",
    label: "RFQ · JupZ",
    shortLabel: "JupZ RFQ",
    color: "#8b5cf6",
  },
  pools: {
    source: "pools",
    label: "AMM Pools",
    shortLabel: "AMM",
    color: "#f59e0b",
  },
};

export const FLOW_SOURCE_ORDER: FlowSource[] = [
  "rfq-flowdesk",
  "rfq-cowswap",
  "rfq-jupz",
  "pools",
];

const DUNE_PROJECT_META: Record<string, { label: string; shortLabel: string; color: string }> = {
  jupiterz: { label: "JupiterZ", shortLabel: "JupZ", color: "#9ca3af" },
  raydium: { label: "Raydium", shortLabel: "Raydium", color: "#4f46e5" },
  byreal: { label: "Byreal", shortLabel: "Byreal", color: "#f97316" },
  "orca-whirlpool": { label: "Orca (Whirlpool)", shortLabel: "Orca", color: "#14b8a6" },
  meteora: { label: "Meteora", shortLabel: "Meteora", color: "#6366f1" },
  manifest: { label: "Manifest", shortLabel: "Manifest", color: "#c084fc" },
  "pancakeswap-solana": { label: "PancakeSwap (Solana)", shortLabel: "Pancake", color: "#facc15" },
};

const DUNE_FALLBACK_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#64748b",
  "#84cc16",
  "#f43f5e",
  "#06b6d4",
];

function stableColorIndex(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % DUNE_FALLBACK_COLORS.length;
}

const PROVIDER_TO_SOURCE: Record<string, FlowSource> = {
  "1inch": "rfq-flowdesk",
  oneinch: "rfq-flowdesk",
  "0x": "rfq-flowdesk",
  zerox: "rfq-flowdesk",
  bebop: "rfq-flowdesk",
  cowswap: "rfq-cowswap",
  cow: "rfq-cowswap",
  cowfi: "rfq-cowswap",
  jupz: "rfq-jupz",
  jupiterz: "rfq-jupz",
};

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

interface DayBucket {
  buyUsd: number;
  sellUsd: number;
}

export interface NetFlowDay {
  day: string;
  label: string;
  /** USD moved to users minus returned to MM/pools across all sources. */
  netUsd: number;
  /** Cumulative sum of `netUsd` from the start of the window. */
  cumulativeUsd: number;
  /** Gross underlying volume (buy + sell across all sources) on this day. */
  volumeUsd: number;
  /** Cumulative sum of `volumeUsd` from the start of the window. */
  cumulativeVolumeUsd: number;
  /** Per-source signed net from the user/circulation perspective (sell - buy). */
  bySource: Record<FlowSource, number>;
  /** Per-source detailed MM/pool buy/sell. */
  bySourceDetail: Record<FlowSource, { buyUsd: number; sellUsd: number }>;
  /** Per-source running cumulative net (sell - buy), inclusive of this day. */
  cumulativeBySource: Record<FlowSource, number>;
  /** Per-source running cumulative gross volume (buy + sell), inclusive of this day. */
  cumulativeVolumeBySource: Record<FlowSource, number>;
}

export interface NetFlowSeriesTotal {
  source: FlowSource;
  label: string;
  shortLabel: string;
  color: string;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
}

export interface NetFlowChartData {
  days: NetFlowDay[];
  series: NetFlowSeriesTotal[];
  totals: { buyUsd: number; sellUsd: number; netUsd: number };
  startDate: string | null;
  endDate: string | null;
  rfqMissingUsdRows: number;
  poolSwapCount: number;
}

export interface DuneFlowToUsersRow {
  day: string;
  project: string;
  projectSlug: string;
  buyVolumeUsd: string;
  sellVolumeUsd: string;
  netFlowUsd: string;
  grossVolumeUsd: string;
  cumulativeNetFlowUsd: string;
  cumulativeBuyUsd: string;
  cumulativeSellUsd: string;
}

export interface DuneFlowToUsersProject {
  project: string;
  projectSlug: string;
  cumulativeNetFlowUsd: string;
  cumulativeBuyUsd: string;
  cumulativeSellUsd: string;
  cumulativeGrossUsd: string;
}

export interface DuneFlowToUsersResponse {
  rows: DuneFlowToUsersRow[];
  projects: DuneFlowToUsersProject[];
  totals: {
    buyVolumeUsd: number;
    sellVolumeUsd: number;
    netFlowUsd: number;
    grossVolumeUsd: number;
    rowCount: number;
  };
  meta: {
    source: "dune";
    queryId: number;
    range: "all" | "30d" | "90d" | "365d";
    days: number | null;
    startDate: string | null;
    endDate: string | null;
    latestDay: string | null;
    lastExecutionId: string | null;
    lastExecutionState: string | null;
    lastExecutionEndedAt: string | null;
    lastUpdatedAt: string | null;
    executionCostCredits: string | null;
    error: { type?: string | null; message: string } | null;
  };
}

interface BuildArgs {
  rfqRows: XstocksMakerVolumeRow[] | null;
  poolDays: { day: string; buyUsd: number; sellUsd: number }[] | null;
  poolSwapCount?: number;
  /**
   * Override Flowdesk RFQ flow with on-chain hot-wallet data instead of the
   * settlement-contract rows that come from the indexer's `maker-volume`
   * endpoint. When provided, the `rfq-flowdesk` series is sourced ENTIRELY
   * from this stream and any 1inch/0x/bebop rows in `rfqRows` are dropped to
   * avoid double-counting.
   */
  flowdeskRfqDays?: { day: string; buyUsd: number; sellUsd: number }[] | null;
  /** UTC YYYY-MM-DD bounds (inclusive). When null, derived from data. */
  startDate?: string | null;
  endDate?: string | null;
}

/** Providers that map onto `rfq-flowdesk` — used to filter out indexer rows
 *  when an on-chain Flowdesk override is supplied. */
const FLOWDESK_PROVIDER_KEYS = new Set([
  "1inch",
  "oneinch",
  "0x",
  "zerox",
  "bebop",
]);

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00.000Z`);
  const e = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return out;
  for (let cursor = new Date(s); cursor.getTime() <= e.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    out.push(cursor.toISOString().slice(0, 10));
    if (out.length > 1200) break;
  }
  return out;
}

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function emptyBuckets(): Record<FlowSource, DayBucket> {
  return {
    "rfq-flowdesk": { buyUsd: 0, sellUsd: 0 },
    "rfq-cowswap": { buyUsd: 0, sellUsd: 0 },
    "rfq-jupz": { buyUsd: 0, sellUsd: 0 },
    pools: { buyUsd: 0, sellUsd: 0 },
  };
}

function minDay(...days: (string | null | undefined)[]): string | null {
  const valid = days.filter((day): day is string => Boolean(day)).sort();
  return valid[0] ?? null;
}

function maxDay(...days: (string | null | undefined)[]): string | null {
  const valid = days.filter((day): day is string => Boolean(day)).sort();
  return valid.at(-1) ?? null;
}

function toNumber(value: string | number | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getDuneProjectMeta(projectSlug: string, project: string): FlowSourceMeta {
  const configured = DUNE_PROJECT_META[projectSlug];
  if (configured) {
    return {
      source: projectSlug,
      label: configured.label,
      shortLabel: configured.shortLabel,
      color: configured.color,
    };
  }
  return {
    source: projectSlug,
    label: project || projectSlug,
    shortLabel: project || projectSlug,
    color: DUNE_FALLBACK_COLORS[stableColorIndex(projectSlug)],
  };
}

export function buildDuneNetFlowChartData(response: DuneFlowToUsersResponse | null): NetFlowChartData | null {
  if (!response) return null;

  const seriesMeta = response.projects.map((project) =>
    getDuneProjectMeta(project.projectSlug, project.project)
  );
  const seriesOrder = seriesMeta.map((series) => series.source);
  const seriesBySlug = new Map(seriesMeta.map((series) => [series.source, series]));
  const rowsByDay = new Map<string, DuneFlowToUsersRow[]>();

  for (const row of response.rows) {
    if (!row.day || !row.projectSlug) continue;
    const bucket = rowsByDay.get(row.day) ?? [];
    bucket.push(row);
    rowsByDay.set(row.day, bucket);
  }

  const dayKeys = [...rowsByDay.keys()].sort();
  const cumulativeBySource = Object.fromEntries(seriesOrder.map((source) => [source, 0])) as Record<FlowSource, number>;
  const cumulativeVolumeBySource = Object.fromEntries(seriesOrder.map((source) => [source, 0])) as Record<FlowSource, number>;
  let cumulativeVolume = 0;
  const days: NetFlowDay[] = dayKeys.map((day) => {
    const rows = rowsByDay.get(day) ?? [];
    const bySource = Object.fromEntries(seriesOrder.map((source) => [source, 0])) as Record<FlowSource, number>;
    const bySourceDetail = Object.fromEntries(
      seriesOrder.map((source) => [source, { buyUsd: 0, sellUsd: 0 }])
    ) as Record<FlowSource, { buyUsd: number; sellUsd: number }>;

    for (const row of rows) {
      if (!seriesBySlug.has(row.projectSlug)) continue;
      const usersAcquiredUsd = toNumber(row.buyVolumeUsd);
      const usersReturnedUsd = toNumber(row.sellVolumeUsd);
      bySource[row.projectSlug] += toNumber(row.netFlowUsd);
      bySourceDetail[row.projectSlug].buyUsd += usersReturnedUsd;
      bySourceDetail[row.projectSlug].sellUsd += usersAcquiredUsd;
      cumulativeBySource[row.projectSlug] = toNumber(row.cumulativeNetFlowUsd);
    }
    for (const source of seriesOrder) {
      cumulativeVolumeBySource[source] += bySourceDetail[source].buyUsd + bySourceDetail[source].sellUsd;
    }
    const cumulativeUsd = seriesOrder.reduce((sum, source) => sum + (cumulativeBySource[source] ?? 0), 0);
    const volumeUsd = seriesOrder.reduce(
      (sum, source) => sum + bySourceDetail[source].buyUsd + bySourceDetail[source].sellUsd,
      0
    );
    cumulativeVolume += volumeUsd;

    return {
      day,
      label: formatDayLabel(day),
      netUsd: seriesOrder.reduce((sum, source) => sum + (bySource[source] ?? 0), 0),
      cumulativeUsd,
      volumeUsd,
      cumulativeVolumeUsd: cumulativeVolume,
      bySource,
      bySourceDetail,
      cumulativeBySource: { ...cumulativeBySource },
      cumulativeVolumeBySource: { ...cumulativeVolumeBySource },
    };
  });

  const latestProjectRows = new Map<string, DuneFlowToUsersProject>();
  for (const project of response.projects) {
    latestProjectRows.set(project.projectSlug, project);
  }

  const series = seriesMeta.map((meta) => {
    const latest = latestProjectRows.get(meta.source);
    return {
      source: meta.source,
      label: meta.label,
      shortLabel: meta.shortLabel,
      color: meta.color,
      buyUsd: toNumber(latest?.cumulativeSellUsd),
      sellUsd: toNumber(latest?.cumulativeBuyUsd),
      netUsd: toNumber(latest?.cumulativeNetFlowUsd),
    };
  });

  return {
    days,
    series,
    totals: {
      buyUsd: series.reduce((sum, item) => sum + item.buyUsd, 0),
      sellUsd: series.reduce((sum, item) => sum + item.sellUsd, 0),
      netUsd: series.reduce((sum, item) => sum + item.netUsd, 0),
    },
    startDate: days[0]?.day ?? null,
    endDate: days.at(-1)?.day ?? null,
    rfqMissingUsdRows: 0,
    poolSwapCount: 0,
  };
}

export function buildNetFlowChartData({
  rfqRows,
  poolDays,
  poolSwapCount = 0,
  flowdeskRfqDays,
  startDate,
  endDate,
}: BuildArgs): NetFlowChartData {
  const byDay = new Map<string, Record<FlowSource, DayBucket>>();
  const seenDays = new Set<string>();
  let rfqMissingUsdRows = 0;
  const hasFlowdeskOverride = Boolean(flowdeskRfqDays);

  // RFQ rows
  if (rfqRows) {
    for (const row of rfqRows) {
      if (!row.day) continue;
      seenDays.add(row.day);
      // Skip USDC counterpart rows so we don't double-count net flow.
      if ((row.symbol ?? "").toUpperCase() === "USDC") continue;
      const provider = normalizeProvider(row.provider ?? "");
      // When an on-chain Flowdesk override is supplied, drop the indexer's
      // settlement-contract rows for the Flowdesk-mapped providers so we
      // don't combine the wash data with the real direction.
      if (hasFlowdeskOverride && FLOWDESK_PROVIDER_KEYS.has(provider)) continue;
      const source = PROVIDER_TO_SOURCE[provider];
      if (!source) continue;
      const usdRaw = row.volume_usd === null ? null : Number(row.volume_usd);
      if (usdRaw === null || !Number.isFinite(usdRaw)) {
        rfqMissingUsdRows += 1;
        continue;
      }
      const usd = Math.abs(usdRaw);
      if (usd <= 0) continue;
      const bucket = byDay.get(row.day) ?? emptyBuckets();
      if (row.direction === "in") {
        bucket[source].buyUsd += usd;
      } else if (row.direction === "out") {
        bucket[source].sellUsd += usd;
      } else {
        // unknown direction — skip to avoid corrupting net
        continue;
      }
      byDay.set(row.day, bucket);
    }
  }

  // Flowdesk on-chain override
  if (flowdeskRfqDays) {
    for (const row of flowdeskRfqDays) {
      if (!row.day) continue;
      seenDays.add(row.day);
      const bucket = byDay.get(row.day) ?? emptyBuckets();
      bucket["rfq-flowdesk"].buyUsd += row.buyUsd;
      bucket["rfq-flowdesk"].sellUsd += row.sellUsd;
      byDay.set(row.day, bucket);
    }
  }

  // Pool rows
  if (poolDays) {
    for (const row of poolDays) {
      if (!row.day) continue;
      seenDays.add(row.day);
      const bucket = byDay.get(row.day) ?? emptyBuckets();
      bucket.pools.buyUsd += row.buyUsd;
      bucket.pools.sellUsd += row.sellUsd;
      byDay.set(row.day, bucket);
    }
  }

  const observedStart = seenDays.size ? [...seenDays].sort()[0] : null;
  const observedEnd = seenDays.size ? [...seenDays].sort().at(-1) ?? null : null;
  const start = startDate ? minDay(startDate, observedStart) : observedStart;
  const end = endDate ? maxDay(endDate, observedEnd) : observedEnd;
  const dayKeys = start && end ? dateRange(start, end) : [...seenDays].sort();

  let cumulative = 0;
  let cumulativeVolume = 0;
  const cumulativeBySourceRunning: Record<FlowSource, number> = {
    "rfq-flowdesk": 0,
    "rfq-cowswap": 0,
    "rfq-jupz": 0,
    pools: 0,
  };
  const cumulativeVolumeBySourceRunning: Record<FlowSource, number> = {
    "rfq-flowdesk": 0,
    "rfq-cowswap": 0,
    "rfq-jupz": 0,
    pools: 0,
  };
  const seriesTotals: Record<FlowSource, { buyUsd: number; sellUsd: number }> = {
    "rfq-flowdesk": { buyUsd: 0, sellUsd: 0 },
    "rfq-cowswap": { buyUsd: 0, sellUsd: 0 },
    "rfq-jupz": { buyUsd: 0, sellUsd: 0 },
    pools: { buyUsd: 0, sellUsd: 0 },
  };

  const days: NetFlowDay[] = dayKeys.map((day) => {
    const buckets = byDay.get(day) ?? emptyBuckets();
    const bySource: Record<FlowSource, number> = {
      "rfq-flowdesk": buckets["rfq-flowdesk"].sellUsd - buckets["rfq-flowdesk"].buyUsd,
      "rfq-cowswap": buckets["rfq-cowswap"].sellUsd - buckets["rfq-cowswap"].buyUsd,
      "rfq-jupz": buckets["rfq-jupz"].sellUsd - buckets["rfq-jupz"].buyUsd,
      pools: buckets.pools.sellUsd - buckets.pools.buyUsd,
    };
    const netUsd = FLOW_SOURCE_ORDER.reduce((sum, source) => sum + bySource[source], 0);
    const volumeUsd = FLOW_SOURCE_ORDER.reduce(
      (sum, source) => sum + buckets[source].buyUsd + buckets[source].sellUsd,
      0
    );
    cumulative += netUsd;
    cumulativeVolume += volumeUsd;
    for (const source of FLOW_SOURCE_ORDER) {
      cumulativeBySourceRunning[source] += bySource[source];
      cumulativeVolumeBySourceRunning[source] += buckets[source].buyUsd + buckets[source].sellUsd;
    }
    seriesTotals["rfq-flowdesk"].buyUsd += buckets["rfq-flowdesk"].buyUsd;
    seriesTotals["rfq-flowdesk"].sellUsd += buckets["rfq-flowdesk"].sellUsd;
    seriesTotals["rfq-cowswap"].buyUsd += buckets["rfq-cowswap"].buyUsd;
    seriesTotals["rfq-cowswap"].sellUsd += buckets["rfq-cowswap"].sellUsd;
    seriesTotals["rfq-jupz"].buyUsd += buckets["rfq-jupz"].buyUsd;
    seriesTotals["rfq-jupz"].sellUsd += buckets["rfq-jupz"].sellUsd;
    seriesTotals.pools.buyUsd += buckets.pools.buyUsd;
    seriesTotals.pools.sellUsd += buckets.pools.sellUsd;
    return {
      day,
      label: formatDayLabel(day),
      netUsd,
      cumulativeUsd: cumulative,
      volumeUsd,
      cumulativeVolumeUsd: cumulativeVolume,
      bySource,
      bySourceDetail: {
        "rfq-flowdesk": buckets["rfq-flowdesk"],
        "rfq-cowswap": buckets["rfq-cowswap"],
        "rfq-jupz": buckets["rfq-jupz"],
        pools: buckets.pools,
      },
      cumulativeBySource: { ...cumulativeBySourceRunning },
      cumulativeVolumeBySource: { ...cumulativeVolumeBySourceRunning },
    };
  });

  const series: NetFlowSeriesTotal[] = FLOW_SOURCE_ORDER.map((source) => {
    const meta = FLOW_SOURCE_META[source];
    const t = seriesTotals[source];
    return {
      source,
      label: meta.label,
      shortLabel: meta.shortLabel,
      color: meta.color,
      buyUsd: t.buyUsd,
      sellUsd: t.sellUsd,
      netUsd: t.sellUsd - t.buyUsd,
    };
  });

  const totals = {
    buyUsd: series.reduce((s, x) => s + x.buyUsd, 0),
    sellUsd: series.reduce((s, x) => s + x.sellUsd, 0),
    netUsd: series.reduce((s, x) => s + x.netUsd, 0),
  };

  return {
    days,
    series,
    totals,
    startDate: dayKeys[0] ?? null,
    endDate: dayKeys.at(-1) ?? null,
    rfqMissingUsdRows,
    poolSwapCount,
  };
}
