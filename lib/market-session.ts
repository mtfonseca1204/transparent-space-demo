export type MarketSession = "market" | "prePost" | "weekend";

/**
 * NYSE full-day holidays (ET date strings). Extend annually — used to treat
 * weekday closures as "prePost" for spread-tier scoring.
 */
const NYSE_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents' Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; July 4 is Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01",
  "2027-01-18", // MLK Day
  "2027-02-15", // Presidents' Day
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed; Jun 19 is Saturday)
  "2027-07-05", // Independence Day (observed; July 4 is Sunday)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving
  "2027-12-24", // Christmas (observed; Dec 25 is Saturday)
]);

/** NYSE early-close days (1:00pm ET close instead of 4:00pm). */
const NYSE_EARLY_CLOSES = new Set<string>([
  // 2026
  "2026-11-27", // Black Friday
  "2026-12-24", // Christmas Eve
  // 2027
  "2027-11-26", // Black Friday
]);

const MARKET_OPEN_MIN = 9 * 60 + 30; // 9:30 AM ET
const REGULAR_CLOSE_MIN = 16 * 60; // 4:00 PM ET
const EARLY_CLOSE_MIN = 13 * 60; // 1:00 PM ET

interface EtParts {
  weekday: string;
  dateKey: string;
  minutesOfDay: number;
}

function getEtParts(date: Date): EtParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24; // some runtimes return "24" at midnight
  const minute = parseInt(get("minute"), 10);
  return {
    weekday: get("weekday"),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: hour * 60 + minute,
  };
}

export function classifySession(date: Date): MarketSession {
  const { weekday, dateKey, minutesOfDay } = getEtParts(date);
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  if (NYSE_HOLIDAYS.has(dateKey)) return "prePost";
  const isEarlyClose = NYSE_EARLY_CLOSES.has(dateKey);
  const close = isEarlyClose ? EARLY_CLOSE_MIN : REGULAR_CLOSE_MIN;
  if (minutesOfDay >= MARKET_OPEN_MIN && minutesOfDay < close) return "market";
  // Parity with backend rollup: Friday after close rolls directly into the
  // weekend bucket rather than sitting in prePost for the last few hours.
  if (weekday === "Fri" && minutesOfDay >= close) return "weekend";
  return "prePost";
}

export const SESSION_LABEL: Record<MarketSession, string> = {
  market: "Market Hours",
  prePost: "Pre/Post",
  weekend: "Weekend",
};
