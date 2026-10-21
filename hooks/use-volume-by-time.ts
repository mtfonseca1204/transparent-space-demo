import { useQuery } from "@tanstack/react-query";
import { normalizePoolKey, isSolanaPool } from "@/lib/pools";
import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";

export interface HourOfDayVolume {
  hour: number; // 0–23 EST
  label: string; // "12 AM", "1 AM", etc.
  volumeUsd: number;
  swapCount: number;
  dayCount: number; // how many distinct days contributed (for averaging)
}

export interface DayOfWeekVolume {
  day: number; // 0=Sunday … 6=Saturday
  label: string; // "Mon", "Tue", etc.
  volumeUsd: number;
  swapCount: number;
  weekCount: number; // how many distinct weeks contributed
}

export interface VolumeByTimeData {
  byHour: HourOfDayVolume[];
  byDay: DayOfWeekVolume[];
}

const HOUR_LABELS = [
  "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM",
  "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
  "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CandleRow {
  timestamp: number;
  volume0: string;
  volume1: string;
  txCount: number;
}

/**
 * Convert a UTC unix timestamp to an EST Date using Intl.
 * Returns { hour, dayOfWeek, dateKey } in America/New_York.
 */
function toEST(unixSec: number) {
  const d = new Date(unixSec * 1000);
  // formatToParts gives us the EST-adjusted components
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24;
  const weekdayStr = get("weekday"); // "Mon", "Tue", etc.
  const dayOfWeek = DAY_LABELS.indexOf(weekdayStr);
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  // week key for counting distinct weeks
  const weekKey = getISOWeek(d, "America/New_York");

  return { hour, dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : 0, dateKey, weekKey };
}

function getISOWeek(d: Date, tz: string): string {
  // Get the EST date components
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const estDate = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00`);
  const dayOfYear = Math.floor(
    (estDate.getTime() - new Date(estDate.getFullYear(), 0, 1).getTime()) / 86400000
  );
  const weekNum = Math.floor(dayOfYear / 7);
  return `${estDate.getFullYear()}-W${weekNum}`;
}

interface UseVolumeByTimeOptions {
  poolAddress: string;
  token0Decimals?: number;
  token1Decimals?: number;
  token0UsdPrice?: number | null;
  token1UsdPrice?: number | null;
  days?: number;
  enabled?: boolean;
  spaceSlug?: string | null;
}

export function useVolumeByTime({
  poolAddress,
  token0Decimals = 18,
  token1Decimals = 6,
  token0UsdPrice,
  token1UsdPrice,
  days = 30,
  enabled = true,
  spaceSlug,
}: UseVolumeByTimeOptions) {
  const poolKey = normalizePoolKey(poolAddress);
  const isSolana = isSolanaPool(poolKey);

  // Round to current hour for stable cache keys
  const now = Math.floor(Date.now() / 1000);
  const roundedNow = Math.floor(now / 3600) * 3600;
  const startTime = roundedNow - days * 86400;

  return useQuery<VolumeByTimeData, Error>({
    queryKey: [
      "volumeByTime",
      poolKey,
      days,
      startTime,
      token1Decimals,
      token1UsdPrice ?? null,
      token0Decimals,
      token0UsdPrice ?? null,
      spaceSlug ?? null,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        pool: poolKey,
        interval: "3600",
        startTime: String(startTime),
        endTime: String(roundedNow),
      });
      if (isDemoSpaceSlug(spaceSlug)) params.set("space", DEMO_SPACE_SLUG);

      const res = await fetch(`/api/candles?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch candles for volume-by-time: ${res.status}`);
      }

      const candles: CandleRow[] = await res.json();

      // Aggregate by hour-of-day and day-of-week (EST)
      const hourBuckets: Array<{ volumeUsd: number; swapCount: number; dates: Set<string> }> =
        Array.from({ length: 24 }, () => ({ volumeUsd: 0, swapCount: 0, dates: new Set<string>() }));

      const dayBuckets: Array<{ volumeUsd: number; swapCount: number; weeks: Set<string> }> =
        Array.from({ length: 7 }, () => ({ volumeUsd: 0, swapCount: 0, weeks: new Set<string>() }));

      for (const candle of candles) {
        // Use token1 volume to avoid double-counting (consistent with other volume calcs)
        const vol1Raw = Number(candle.volume1);
        if (!Number.isFinite(vol1Raw) || vol1Raw === 0) continue;

        // For Solana pools, volumes may already be in token units if they contain decimals
        const vol1Token = isSolana && String(candle.volume1).includes(".")
          ? vol1Raw
          : vol1Raw / 10 ** token1Decimals;

        // Convert to USD
        let volumeUsd = 0;
        if (token1UsdPrice && token1UsdPrice > 0) {
          volumeUsd = vol1Token * token1UsdPrice;
        } else if (token0UsdPrice && token0UsdPrice > 0) {
          // Fall back to token0
          const vol0Raw = Number(candle.volume0);
          const vol0Token = isSolana && String(candle.volume0).includes(".")
            ? vol0Raw
            : vol0Raw / 10 ** token0Decimals;
          volumeUsd = vol0Token * token0UsdPrice;
        } else {
          // No USD price available, use raw token1 volume
          volumeUsd = vol1Token;
        }

        if (!Number.isFinite(volumeUsd) || volumeUsd <= 0) continue;

        const { hour, dayOfWeek, dateKey, weekKey } = toEST(candle.timestamp);
        const txCount = candle.txCount || 0;

        hourBuckets[hour].volumeUsd += volumeUsd;
        hourBuckets[hour].swapCount += txCount;
        hourBuckets[hour].dates.add(dateKey);

        dayBuckets[dayOfWeek].volumeUsd += volumeUsd;
        dayBuckets[dayOfWeek].swapCount += txCount;
        dayBuckets[dayOfWeek].weeks.add(weekKey);
      }

      const byHour: HourOfDayVolume[] = hourBuckets.map((b, i) => ({
        hour: i,
        label: HOUR_LABELS[i],
        volumeUsd: b.dates.size > 0 ? b.volumeUsd / b.dates.size : 0,
        swapCount: b.dates.size > 0 ? Math.round(b.swapCount / b.dates.size) : 0,
        dayCount: b.dates.size,
      }));

      const byDay: DayOfWeekVolume[] = dayBuckets.map((b, i) => ({
        day: i,
        label: DAY_LABELS[i],
        volumeUsd: b.weeks.size > 0 ? b.volumeUsd / b.weeks.size : 0,
        swapCount: b.weeks.size > 0 ? Math.round(b.swapCount / b.weeks.size) : 0,
        weekCount: b.weeks.size,
      }));

      return { byHour, byDay };
    },
    enabled: enabled && !!poolAddress,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
