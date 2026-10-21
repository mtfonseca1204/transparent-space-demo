export interface XstocksMakerVolumeRow {
  day: string;
  chain: string;
  provider: string;
  label: string;
  maker_address: string;
  symbol: string;
  direction: string;
  volume_token: string;
  volume_usd: string | null;
  price_usd: string | null;
  price_source: string;
  tx_count: number;
  updated_at: string;
}

export interface XstocksMakerVolumeResponse {
  data: XstocksMakerVolumeRow[];
  meta?: {
    applied_filters?: {
      range?: "all" | "30d" | "90d" | "365d" | null;
      start_date?: string;
      end_date?: string;
      days?: number | null;
    };
  };
}

export interface MakerVolumeProviderSeries {
  provider: string;
  label: string;
  color: string;
  totalUsd: number;
}

export interface MakerVolumeChartDay {
  day: string;
  label: string;
  totalUsd: number;
  missingUsdRows: number;
  providerUsd: Record<string, number>;
}

export interface MakerVolumeChartData {
  days: MakerVolumeChartDay[];
  providers: MakerVolumeProviderSeries[];
  totalUsd: number;
  pricedRows: number;
  missingUsdRows: number;
  startDate: string | null;
  endDate: string | null;
}

const HIDDEN_PROVIDERS = new Set(["jupiterz"]);
const PROVIDER_ORDER = ["cowswap", "bebop", "kyberswap", "1inch", "0x"];

const PROVIDER_META: Record<string, { label: string; color: string }> = {
  cowswap: { label: "CoWSwap", color: "#10b981" },
  bebop: { label: "Bebop", color: "#8b5cf6" },
  kyberswap: { label: "KyberSwap", color: "#f59e0b" },
  "1inch": { label: "1inch", color: "#0ea5e9" },
  "0x": { label: "0x", color: "#f97316" },
  jupiterz: { label: "JupZ", color: "#84cc16" },
};

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "cow" || normalized === "cowfi" || normalized === "cowswap") {
    return "cowswap";
  }
  if (normalized === "oneinch") return "1inch";
  if (normalized === "zerox") return "0x";
  if (normalized === "kyber") return "kyberswap";
  if (normalized === "jupz") return "jupiterz";
  return normalized;
}

export function getMakerVolumeProviderMeta(provider: string) {
  const key = normalizeProvider(provider);
  return PROVIDER_META[key] ?? { label: provider, color: "#64748b" };
}

function providerSort(left: string, right: string): number {
  const leftIndex = PROVIDER_ORDER.indexOf(left);
  const rightIndex = PROVIDER_ORDER.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return left.localeCompare(right);
}

function parseUsd(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(parsed);
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

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDayRange(startDate?: string, endDate?: string): string[] {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.getTime() > end.getTime()
  ) {
    return [];
  }

  const days: string[] = [];
  const cursor = new Date(start);
  for (let i = 0; cursor.getTime() <= end.getTime() && i < 1200; i += 1) {
    days.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function buildXstocksMakerVolumeChart(
  response: XstocksMakerVolumeResponse
): MakerVolumeChartData {
  const startDate = response.meta?.applied_filters?.start_date ?? null;
  const endDate = response.meta?.applied_filters?.end_date ?? null;
  const days = new Set(buildDayRange(startDate ?? undefined, endDate ?? undefined));
  const dailyProviderUsd = new Map<string, Map<string, number>>();
  const dailyMissingUsdRows = new Map<string, number>();
  const providerTotals = new Map<string, number>();
  let totalUsd = 0;
  let pricedRows = 0;
  let missingUsdRows = 0;

  for (const row of response.data) {
    if (!row.day) continue;
    days.add(row.day);
    const provider = normalizeProvider(row.provider);
    if (HIDDEN_PROVIDERS.has(provider)) continue;
    const usd = parseUsd(row.volume_usd);

    if (usd === null) {
      missingUsdRows += 1;
      dailyMissingUsdRows.set(row.day, (dailyMissingUsdRows.get(row.day) ?? 0) + 1);
      continue;
    }

    pricedRows += 1;
    totalUsd += usd;
    providerTotals.set(provider, (providerTotals.get(provider) ?? 0) + usd);

    let providerMap = dailyProviderUsd.get(row.day);
    if (!providerMap) {
      providerMap = new Map();
      dailyProviderUsd.set(row.day, providerMap);
    }
    providerMap.set(provider, (providerMap.get(provider) ?? 0) + usd);
  }

  const providers = [...providerTotals.entries()]
    .filter(([, value]) => value > 0)
    .sort(([left], [right]) => providerSort(left, right))
    .map(([provider, providerTotalUsd]) => {
      const meta = getMakerVolumeProviderMeta(provider);
      return {
        provider,
        label: meta.label,
        color: meta.color,
        totalUsd: providerTotalUsd,
      };
    });

  const chartDays = [...days].sort().map((day) => {
    const providerMap = dailyProviderUsd.get(day);
    const providerUsd = Object.fromEntries(
      providers.map(({ provider }) => [provider, providerMap?.get(provider) ?? 0])
    );
    const dayTotalUsd = Object.values(providerUsd).reduce((sum, value) => sum + value, 0);
    return {
      day,
      label: formatDayLabel(day),
      totalUsd: dayTotalUsd,
      missingUsdRows: dailyMissingUsdRows.get(day) ?? 0,
      providerUsd,
    };
  });

  return {
    days: chartDays,
    providers,
    totalUsd,
    pricedRows,
    missingUsdRows,
    startDate,
    endDate,
  };
}
