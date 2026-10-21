import { NextRequest, NextResponse } from "next/server";
import {
  buildQuoteActivityAssetSummaries,
  type QuoteActivityApiResponse,
  type QuoteActivityHour,
} from "@/lib/rfq-quote-activity";

/**
 * Cron: aggregated twice-daily RFQ quote-activity report.
 *
 * Vercel `vercel.json` triggers this route at:
 *   - `0 14 * * *` (10:00 AM ET during EDT, 9:00 AM ET during EST)
 *   - `0 21 * * *` (5:00 PM ET during EDT, 4:00 PM ET during EST)
 *
 * Each run pulls the hourly RFQ quote-activity feed, looks back to the
 * previous scheduled run (≈17h at 10am ET, ≈7h at 5pm ET), and finds any
 * `(asset, venue)` pair that had ≥ STREAK_THRESHOLD consecutive hours with
 * zero successful responses (any reason — explicit failures or missing
 * cycles both count). Every flagged pair goes into a single aggregated
 * Telegram message. If no token tripped in the window, no message is sent.
 *
 * Kill-switch env: `QUOTE_ACTIVITY_ALERTS_ENABLED` (defaults to off — the
 * route still runs and returns the would-have-been payload but does not
 * post to Telegram).
 */

const SOLANA_INDEXER_URL =
  process.env.NEXT_PUBLIC_SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

const STREAK_THRESHOLD = 3;
const ACTIVITY_WINDOW_DAYS = 2;
const DASHBOARD_URL = "https://app.transparent.space/kraken/rfq";

function quoteActivityAlertsEnabled(): boolean {
  const raw = process.env.QUOTE_ACTIVITY_ALERTS_ENABLED;
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}

async function sendKrakenTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.KRAKEN_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.KRAKEN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[check-quote-activity] Missing KRAKEN_TELEGRAM_BOT_TOKEN or KRAKEN_TELEGRAM_CHAT_ID");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[check-quote-activity] TG send failed", { status: res.status, body: body.slice(0, 400) });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[check-quote-activity] TG network error", err);
    return false;
  }
}

type RunWindow = {
  label: string;
  lookbackMs: number;
};

/**
 * Map the current UTC hour to one of the two scheduled runs. The wide hour
 * window (13–15 UTC for morning, 20–22 UTC for afternoon) absorbs DST drift
 * — Vercel triggers at fixed UTC times so the local ET label slides by an
 * hour twice a year.
 */
function classifyRun(utcHour: number): RunWindow {
  if (utcHour >= 13 && utcHour <= 15) {
    return { label: "10:00 AM ET", lookbackMs: 17 * 60 * 60 * 1000 };
  }
  if (utcHour >= 20 && utcHour <= 22) {
    return { label: "5:00 PM ET", lookbackMs: 7 * 60 * 60 * 1000 };
  }
  return { label: "Ad-hoc", lookbackMs: 7 * 60 * 60 * 1000 };
}

type Streak = {
  start: string;
  end: string;
  length: number;
};

/**
 * Find every ≥STREAK_THRESHOLD-hour run of zero-success hours within the
 * window. An hour counts as "zero responses" when it was expected to receive
 * quotes (expected > 0) but produced no successes — whether the cycle ran and
 * every attempt failed, or the cycle was missing entirely.
 */
function findZeroResponseStreaksInWindow(
  hours: QuoteActivityHour[],
  sinceMs: number,
): Streak[] {
  const filtered = hours
    .filter((h) => {
      const t = new Date(h.hour).getTime();
      return Number.isFinite(t) && t >= sinceMs;
    })
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const streaks: Streak[] = [];
  let current: QuoteActivityHour[] = [];

  const flush = () => {
    if (current.length >= STREAK_THRESHOLD) {
      streaks.push({
        start: current[0].hour,
        end: current[current.length - 1].hour,
        length: current.length,
      });
    }
    current = [];
  };

  for (const h of filtered) {
    if (h.expected > 0 && h.success === 0) {
      current.push(h);
    } else {
      flush();
    }
  }
  flush();
  return streaks;
}

type Flagged = { asset: string; venueLabel: string };

function formatDateLabel(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function renderEntries(entries: Flagged[]): string {
  // Stable order: asset alphabetical, then venue alphabetical.
  const sorted = [...entries].sort((a, b) =>
    a.asset.localeCompare(b.asset) || a.venueLabel.localeCompare(b.venueLabel),
  );
  return sorted.map((e) => `  ${e.asset} · <code>${e.venueLabel}</code>`).join("\n");
}

function buildAlertMessage(opts: {
  runLabel: string;
  dateLabel: string;
  flagged: Flagged[];
}): string {
  const { runLabel, dateLabel, flagged } = opts;

  return [
    `\u{1F6A8} <b>RFQ Quote Activity · ${runLabel} · ${dateLabel}</b>`,
    ``,
    `\u{1F534} <b>No responses</b>`,
    renderEntries(flagged),
    ``,
    `≥${STREAK_THRESHOLD} consecutive hours with 0 successful quotes since the last check.`,
    ``,
    `\u{1F517} <a href="${DASHBOARD_URL}">Dashboard</a>`,
  ].join("\n");
}

async function fetchQuoteActivity(days: number): Promise<QuoteActivityApiResponse | null> {
  const url = `${SOLANA_INDEXER_URL}/api/rfq/quote-activity?days=${days}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      console.error("[check-quote-activity] fetch failed", { status: res.status });
      return null;
    }
    return (await res.json()) as QuoteActivityApiResponse;
  } catch (err) {
    console.error("[check-quote-activity] network error", err);
    return null;
  }
}

export async function GET(_request: NextRequest) {
  const now = new Date();
  const run = classifyRun(now.getUTCHours());
  const sinceMs = now.getTime() - run.lookbackMs;

  const activity = await fetchQuoteActivity(ACTIVITY_WINDOW_DAYS);
  if (!activity) {
    return NextResponse.json({ ok: false, error: "quote-activity fetch failed" }, { status: 502 });
  }

  const summaries = buildQuoteActivityAssetSummaries(activity.data);
  const flagged: Flagged[] = [];

  for (const assetRow of summaries) {
    for (const provider of assetRow.providers) {
      const streaks = findZeroResponseStreaksInWindow(provider.hourly, sinceMs);
      if (streaks.length === 0) continue;
      flagged.push({ asset: assetRow.asset, venueLabel: provider.label });
    }
  }

  if (flagged.length === 0) {
    return NextResponse.json({
      ok: true,
      run: run.label,
      sinceUtc: new Date(sinceMs).toISOString(),
      sent: false,
      reason: "no_issues",
      flagged: 0,
    });
  }

  const message = buildAlertMessage({
    runLabel: run.label,
    dateLabel: formatDateLabel(now),
    flagged,
  });

  const alertingEnabled = quoteActivityAlertsEnabled();
  if (!alertingEnabled) {
    return NextResponse.json({
      ok: true,
      run: run.label,
      sinceUtc: new Date(sinceMs).toISOString(),
      sent: false,
      reason: "disabled",
      preview: message,
      flagged: flagged.length,
    });
  }

  const sent = await sendKrakenTelegramMessage(message);
  return NextResponse.json({
    ok: true,
    run: run.label,
    sinceUtc: new Date(sinceMs).toISOString(),
    sent,
    reason: sent ? undefined : "send_failed",
    flagged: flagged.length,
  });
}
