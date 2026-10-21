"use client";

import { useMemo, useState } from "react";

import { useRfqQuoteActivity } from "@/hooks/use-rfq-quote-activity";
import { RFQ_SOURCE_META, type RfqSourceKey } from "@/hooks/use-birds-eye-rfq-data";
import {
  formatQuoteActivityAge,
  quoteActivityTone,
  quoteVenueActivityTone,
  type QuoteActivityAssetSummary,
  type QuoteActivityHour,
  type QuoteActivityStatus,
} from "@/lib/rfq-quote-activity";
import { cn } from "@/lib/utils";
import { getDemoTokenLogo } from "@/lib/demo/logos";
import type { RfqProvider } from "@/lib/spread-tiers";

const PROVIDER_TO_SOURCE_KEY: Record<RfqProvider, RfqSourceKey> = {
  oneinch: "1inch",
  zerox: "0x",
  bebop: "bebop",
  cowswap: "cowswap",
  jupz: "jupz",
};

function assetLogoUrl(asset: string): string | null {
  const trimmed = asset.trim();
  if (!trimmed) return null;
  const demoLogo = getDemoTokenLogo(trimmed);
  if (demoLogo) return demoLogo;
  if (trimmed.toUpperCase() === "STRCX") {
    return "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234";
  }
  if (/x$/i.test(trimmed)) {
    return `https://xstocks-metadata.backed.fi/logos/tokens/${trimmed}.png`;
  }
  return null;
}

type FilterMode = "all" | "issues" | "core20" | "tail";
type QuoteActivityWindow = 7 | 14;

const WINDOW_OPTIONS: QuoteActivityWindow[] = [7, 14];
const VENUE_LABEL_COLUMN_PX = 110;
const HEALTH_COLUMN_PX = 80;
const FAIL_COLUMN_PX = 86;
const TIMELINE_TICK_GAP_PX = 1;
const TIMELINE_GUIDE_INTERVAL_HOURS = 24;
const TIMELINE_GUIDE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const TOOLTIP_MARGIN_PX = 12;
const TOOLTIP_WIDTH_PX = 360;
const TOOLTIP_MAX_HEIGHT_PX = 260;

const STATUS_LABEL: Record<QuoteActivityStatus, string> = {
  healthy: "HEALTHY",
  down: "DOWN",
};

const STATUS_STYLE: Record<QuoteActivityStatus, string> = {
  healthy: "border-emerald-600/50 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-300",
  down: "border-rose-500/50 text-rose-700 dark:border-rose-500/50 dark:text-rose-300",
};

const STATUS_DOT: Record<QuoteActivityStatus, string> = {
  healthy: "bg-emerald-500 dark:bg-emerald-400",
  down: "bg-rose-500 dark:bg-rose-400",
};

const TONE_STYLE = {
  good: "bg-emerald-600 dark:bg-emerald-500",
  ok: "bg-emerald-400 dark:bg-emerald-400/80",
  warn: "bg-amber-400 dark:bg-amber-300",
  bad: "bg-orange-500 dark:bg-orange-400",
  critical: "bg-rose-700 dark:bg-rose-500",
  missing: "bg-emerald-100/70 dark:bg-emerald-900/40",
} as const;

const EMPTY_ROWS: QuoteActivityAssetSummary[] = [];

type ExpandedVenue = { asset: string; provider: RfqProvider };

type TimelineTooltip = {
  hour: string;
  left: number;
  width: number;
  maxHeight: number;
} & (
  | { placement: "above"; bottom: number }
  | { placement: "below"; top: number }
);

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getVenueRowGridStyle() {
  return {
    gridTemplateColumns: `${VENUE_LABEL_COLUMN_PX}px minmax(0, 1fr) ${HEALTH_COLUMN_PX}px ${FAIL_COLUMN_PX}px`,
  };
}

function isTimelineGuideTick(index: number) {
  return index % TIMELINE_GUIDE_INTERVAL_HOURS === 0;
}

function formatGuideLabel(hour: string) {
  const date = new Date(hour);
  if (Number.isNaN(date.getTime())) return { month: "", day: "" };
  const parts = TIMELINE_GUIDE_DATE_FORMATTER.formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return { month: month.toUpperCase(), day };
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 99.95) return "100%";
  return `${value.toFixed(1)}%`;
}

function uptimeToneClass(value: number) {
  if (!Number.isFinite(value)) return "text-gray-400";
  if (value >= 90) return "text-emerald-700 dark:text-emerald-300";
  return "text-rose-600 dark:text-rose-400";
}

function formatFailReason(reason: string) {
  if (reason === "missing_cycle") return "Missing request";
  if (reason === "all_failed") return "All quote requests failed";
  if (reason === "partial_failure") return "Some quote requests failed";
  return reason.replaceAll("_", " ");
}

function formatFailureSource(reason: string) {
  if (reason === "missing_cycle") return "Our RFQ worker did not record a request for this expected cycle.";
  if (reason === "all_failed") return "The request ran, but no expected quote path returned success.";
  if (reason === "partial_failure") return "The request ran, but part of the expected quote set failed.";
  return null;
}

function formatErrorCodes(codes: string[], reason?: string | null) {
  if (codes.length) return codes.join(", ");
  if (reason === "missing_cycle") return "No quote request recorded";
  return "No provider error code returned";
}

function AssetLogo({ asset }: { asset: string }) {
  const [errored, setErrored] = useState(false);
  const url = assetLogoUrl(asset);
  if (!url || errored) {
    return (
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
        <span className="font-mono text-[10px] font-semibold text-gray-500 dark:text-gray-400">
          {asset.slice(0, 3).toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${asset} logo`}
        className="h-full w-full object-cover"
        onError={() => setErrored(true)}
      />
    </div>
  );
}

function VenueLogo({ provider, label }: { provider: RfqProvider; label: string }) {
  const [errored, setErrored] = useState(false);
  const meta = RFQ_SOURCE_META[PROVIDER_TO_SOURCE_KEY[provider]];
  if (!meta || errored) {
    return <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full bg-gray-800 dark:bg-gray-300" />;
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={meta.favicon}
      alt={`${label} logo`}
      className="h-4 w-4 shrink-0 rounded-full object-cover"
      onError={() => setErrored(true)}
    />
  );
}

function Timeline({
  hours,
  contextHours,
  provider,
  providerLabel,
}: {
  hours: QuoteActivityHour[];
  contextHours?: QuoteActivityHour[];
  provider?: RfqProvider;
  providerLabel?: string;
}) {
  const [tooltip, setTooltip] = useState<TimelineTooltip | null>(null);
  const visibleHours = hours;
  const visibleHourCount = Math.max(1, visibleHours.length);
  const selectedBucket = tooltip
    ? visibleHours.find((hour) => hour.hour === tooltip.hour) ?? null
    : null;
  const selectedUptime =
    selectedBucket && selectedBucket.expected > 0
      ? (selectedBucket.success / selectedBucket.expected) * 100
      : 0;
  const selectedFailures = selectedBucket?.providerFailures?.length
    ? selectedBucket.providerFailures
    : selectedBucket && selectedBucket.failed > 0 && providerLabel
      ? [
          {
            providerLabel,
            reason: selectedBucket.failure_reason ?? "partial_failure",
            error_codes: selectedBucket.error_codes ?? [],
            error_sample: selectedBucket.error_sample ?? null,
          },
        ]
      : [];

  function showTooltip(hour: string, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(TOOLTIP_WIDTH_PX, viewportWidth - TOOLTIP_MARGIN_PX * 2);
    const maxLeft = Math.max(TOOLTIP_MARGIN_PX, viewportWidth - width - TOOLTIP_MARGIN_PX);
    const left = clamp(
      rect.left + rect.width / 2 - width / 2,
      TOOLTIP_MARGIN_PX,
      maxLeft,
    );
    const availableAbove = Math.max(0, rect.top - TOOLTIP_MARGIN_PX * 2);
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - TOOLTIP_MARGIN_PX * 2);
    const placement = availableAbove >= 120 || availableAbove >= availableBelow ? "above" : "below";
    const availableHeight = placement === "above" ? availableAbove : availableBelow;
    const maxHeight = Math.max(72, Math.min(TOOLTIP_MAX_HEIGHT_PX, availableHeight || TOOLTIP_MAX_HEIGHT_PX));

    setTooltip(
      placement === "above"
        ? {
            hour,
            left,
            width,
            maxHeight,
            placement,
            bottom: viewportHeight - rect.top + TOOLTIP_MARGIN_PX,
          }
        : {
            hour,
            left,
            width,
            maxHeight,
            placement,
            top: clamp(rect.bottom + TOOLTIP_MARGIN_PX, TOOLTIP_MARGIN_PX, viewportHeight - maxHeight - TOOLTIP_MARGIN_PX),
          },
    );
  }

  return (
    <div className="relative h-6 w-full min-w-0">
      {selectedBucket ? (
        <div
          className="pointer-events-none fixed z-[1000] overflow-y-auto border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-[10px] text-white shadow-xl"
          style={{
            left: `${tooltip?.left ?? TOOLTIP_MARGIN_PX}px`,
            width: `${tooltip?.width ?? TOOLTIP_WIDTH_PX}px`,
            maxHeight: `${tooltip?.maxHeight ?? TOOLTIP_MAX_HEIGHT_PX}px`,
            ...(tooltip?.placement === "above"
              ? { bottom: `${tooltip.bottom}px` }
              : { top: `${tooltip?.top ?? TOOLTIP_MARGIN_PX}px` }),
          }}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {providerLabel ? <span className="font-semibold">{providerLabel}</span> : null}
            <span>{new Date(selectedBucket.hour).toLocaleString()}</span>
            <span>
              {selectedBucket.success}/{selectedBucket.expected} success
            </span>
            <span>{selectedBucket.failed} failed</span>
            <span>{formatPct(selectedUptime)}</span>
          </div>
          {selectedFailures.length ? (
            <div className="mt-1 max-w-[720px] space-y-1 border-t border-white/15 pt-1">
              {selectedFailures.slice(0, 4).map((failure) => (
                <div key={`${failure.providerLabel}-${failure.reason}-${failure.error_sample ?? ""}`}>
                  <span className="font-semibold">{failure.providerLabel}</span>
                  <span> · {formatFailReason(failure.reason)}</span>
                  <span> · {formatErrorCodes(failure.error_codes, failure.reason)}</span>
                  {formatFailureSource(failure.reason) ? (
                    <span className="block text-white/60">{formatFailureSource(failure.reason)}</span>
                  ) : null}
                  {failure.error_sample ? (
                    <span className="block truncate text-white/75">{failure.error_sample}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : selectedBucket.failed > 0 ? (
            <div className="mt-1 border-t border-white/15 pt-1 text-white/75">
              No provider error message for this bucket.
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid"
        style={{
          gap: `${TIMELINE_TICK_GAP_PX}px`,
          gridTemplateColumns: `repeat(${visibleHourCount}, minmax(0, 1fr))`,
        }}
      >
        {visibleHours.map((hour, index) =>
          index > 0 && isTimelineGuideTick(index) ? (
            <span
              key={`guide-${hour.hour}`}
              className="border-l border-gray-300/70 dark:border-gray-700/70"
              style={{ gridColumnStart: index + 1 }}
            />
          ) : null,
        )}
      </div>

      <div
        className="absolute inset-0 grid"
        style={{
          gap: `${TIMELINE_TICK_GAP_PX}px`,
          gridTemplateColumns: `repeat(${visibleHourCount}, minmax(0, 1fr))`,
        }}
      >
        {visibleHours.map((hour) => {
          const contextBucket = contextHours?.find((item) => item.hour === hour.hour);
          const tone = provider
            ? quoteVenueActivityTone(hour, contextBucket?.providerBuckets ?? [])
            : quoteActivityTone(hour);
          const isSelected = hour.hour === tooltip?.hour;
          return (
            <button
              key={hour.hour}
              type="button"
              onClick={(event) => showTooltip(hour.hour, event.currentTarget)}
              onFocus={(event) => showTooltip(hour.hour, event.currentTarget)}
              onBlur={() => setTooltip(null)}
              onMouseEnter={(event) => showTooltip(hour.hour, event.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              className={cn(
                "h-full min-w-0 outline-none transition-opacity hover:opacity-80 focus:z-10",
                TONE_STYLE[tone],
                isSelected && "ring-1 ring-gray-900 dark:ring-white",
              )}
              aria-label={`${providerLabel ? `${providerLabel} ` : ""}${new Date(hour.hour).toLocaleString()} ${hour.success} of ${hour.expected} success, ${hour.failed} failed`}
            />
          );
        })}
      </div>
    </div>
  );
}

function TimelineGuide({
  hours,
}: {
  hours: QuoteActivityHour[];
}) {
  const visibleHourCount = Math.max(1, hours.length);

  return (
    <div className="relative h-9 w-full min-w-0">
      <div
        className="grid h-full w-full"
        style={{
          gap: `${TIMELINE_TICK_GAP_PX}px`,
          gridTemplateColumns: `repeat(${visibleHourCount}, minmax(0, 1fr))`,
        }}
      >
        {hours.map((hour, index) => {
          if (!isTimelineGuideTick(index)) return null;
          const { month, day } = formatGuideLabel(hour.hour);
          return (
            <span
              key={hour.hour}
              className="relative"
              style={{ gridColumnStart: index + 1 }}
              title={`${hour.hour.slice(0, 16).replace("T", " ")} UTC`}
            >
              <span className="absolute left-1 top-0 font-mono text-[9px] leading-none text-gray-500 dark:text-gray-400">
                {month}
              </span>
              <span className="absolute left-1 top-3 font-mono text-[10px] font-semibold leading-none text-gray-700 dark:text-gray-300">
                {day}
              </span>
              <span className="absolute left-0 bottom-1 h-2 border-l border-gray-300 dark:border-gray-700" />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function VenueFailsPanel({
  provider,
}: {
  provider: QuoteActivityAssetSummary["providers"][number];
}) {
  const fails = provider.breaches.slice(-10).reverse();
  if (!fails.length) {
    return (
      <div className="border-t border-gray-300/70 px-4 py-3 font-mono text-[10px] uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
        No fails for {provider.label} in this window.
      </div>
    );
  }

  return (
    <div className="border-t border-gray-300/70 bg-gray-50/60 px-4 py-3 dark:border-gray-700 dark:bg-gray-950/40">
      <div className="grid gap-2 md:grid-cols-2">
        {fails.map((fail, index) => (
          <div
            key={`${provider.provider}-${fail.start_at}-${index}`}
            className="border border-gray-300/70 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {provider.label} · {formatFailReason(fail.reason)}
              </span>
              <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                {formatErrorCodes(fail.error_codes, fail.reason)}
              </span>
            </div>
            <div className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
              {new Date(fail.start_at).toLocaleString()} {"->"} {new Date(fail.end_at).toLocaleString()}
            </div>
            {fail.error_sample ? (
              <div className="mt-2 line-clamp-2 text-gray-600 dark:text-gray-300">
                {fail.error_sample}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function VenueRow({
  asset,
  provider,
  contextHours,
  expanded,
  onToggle,
}: {
  asset: string;
  provider: QuoteActivityAssetSummary["providers"][number];
  contextHours: QuoteActivityHour[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const failCount = provider.breaches.length;
  return (
    <div>
      <div
        className="grid items-center gap-4 px-4 py-2"
        style={getVenueRowGridStyle()}
      >
        <div className="flex min-w-0 items-center gap-2">
          <VenueLogo provider={provider.provider} label={provider.label} />
          <span className="truncate font-mono text-[13px] text-gray-900 dark:text-gray-100">
            {provider.label}
          </span>
        </div>
        <Timeline
          hours={provider.hourly}
          contextHours={contextHours}
          provider={provider.provider}
          providerLabel={provider.label}
        />
        <div className={cn("text-right font-mono text-[13px] font-semibold", uptimeToneClass(provider.uptimePct))}>
          {formatPct(provider.uptimePct)}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${asset} ${provider.label}: ${failCount} fails`}
          className="flex flex-col items-end gap-0.5 outline-none focus:ring-1 focus:ring-rose-400"
        >
          <span className="font-mono text-[15px] font-semibold text-rose-700 dark:text-rose-400">
            {failCount}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Fails
          </span>
        </button>
      </div>
      {expanded ? <VenueFailsPanel provider={provider} /> : null}
    </div>
  );
}

function AssetCard({
  row,
  windowDays,
  expandedVenue,
  onToggleVenue,
}: {
  row: QuoteActivityAssetSummary;
  windowDays: QuoteActivityWindow;
  expandedVenue: ExpandedVenue | null;
  onToggleVenue: (asset: string, provider: RfqProvider) => void;
}) {
  const venueCount = row.providers.length;

  return (
    <article
      className={cn(
        "relative border-b border-gray-300 bg-[#FAFAF5] dark:border-gray-700 dark:bg-gray-900/60",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l border-t border-gray-500 dark:border-gray-400"
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 pl-10">
        <div className="flex min-w-0 items-center gap-3">
          <AssetLogo asset={row.asset} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold tracking-wide text-gray-950 dark:text-gray-50">
                {row.asset}
              </span>
              <span className="bg-gray-900 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-white dark:bg-gray-700">
                {row.group === "core20" ? "Core" : "Tail"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 font-mono text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <span>
                Active{" "}
                <span className="text-gray-700 dark:text-gray-200">
                  {formatQuoteActivityAge(row.latestQuoteAt)}
                </span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="text-gray-700 dark:text-gray-200">{venueCount}</span> venues
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-8 gap-y-3">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Fails · {windowDays}D
            </span>
            <span className="font-mono text-2xl font-semibold leading-tight text-gray-900 dark:text-gray-100">
              {row.breaches.length}
            </span>
          </div>

          <span
            className={cn(
              "inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider",
              STATUS_STYLE[row.status],
            )}
          >
            <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[row.status])} />
            {STATUS_LABEL[row.status]}
          </span>
        </div>
      </div>

      <div className="border-t border-gray-300 dark:border-gray-700">
        <div
          className="grid items-end gap-4 px-4 pb-1 pt-3"
          style={getVenueRowGridStyle()}
        >
          <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400 dark:text-gray-500">
            UTC Day
          </span>
          <TimelineGuide hours={row.hourly} />
          <span className="text-right font-mono text-[9px] uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Success
          </span>
          <span className="text-right font-mono text-[9px] uppercase tracking-widest text-gray-400 dark:text-gray-500">
            Fails
          </span>
        </div>

        <div>
          {row.providers.map((provider) => {
            const isExpanded =
              expandedVenue?.asset === row.asset && expandedVenue?.provider === provider.provider;
            return (
              <VenueRow
                key={provider.provider}
                asset={row.asset}
                provider={provider}
                contextHours={row.hourly}
                expanded={isExpanded}
                onToggle={() => onToggleVenue(row.asset, provider.provider)}
              />
            );
          })}
        </div>
      </div>
    </article>
  );
}

export function BirdsEyeQuoteActivity({
  enabled,
  spaceSlug,
}: {
  enabled: boolean;
  spaceSlug?: string | null;
}) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [windowDays, setWindowDays] = useState<QuoteActivityWindow>(7);
  const [expandedVenue, setExpandedVenue] = useState<ExpandedVenue | null>(null);
  const { data, isLoading, isError } = useRfqQuoteActivity({
    days: windowDays,
    enabled,
    spaceSlug,
  });
  const rows = data?.rows ?? EMPTY_ROWS;

  const counts = useMemo(
    () => ({
      all: rows.length,
      issues: rows.filter((row) => row.status !== "healthy").length,
      core20: rows.filter((row) => row.group === "core20").length,
      tail: rows.filter((row) => row.group === "tail").length,
    }),
    [rows],
  );

  const visibleRows = useMemo(() => {
    if (filter === "issues") return rows.filter((row) => row.status !== "healthy");
    if (filter === "core20") return rows.filter((row) => row.group === "core20");
    if (filter === "tail") return rows.filter((row) => row.group === "tail");
    return rows;
  }, [filter, rows]);

  const filters: { id: FilterMode; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "issues", label: "Issues", count: counts.issues },
    { id: "core20", label: "Core", count: counts.core20 },
    { id: "tail", label: "Tail", count: counts.tail },
  ];

  function toggleVenue(asset: string, provider: RfqProvider) {
    setExpandedVenue((current) =>
      current && current.asset === asset && current.provider === provider
        ? null
        : { asset, provider },
    );
  }

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-300 px-4 py-4 dark:border-gray-700 md:px-6">
        <h3 className="font-mono text-base font-semibold uppercase tracking-wide text-gray-950 dark:text-gray-50">
          Historical Quotes
        </h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center border border-gray-300 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
            {WINDOW_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setWindowDays(days)}
                className={cn(
                  "min-w-12 px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide transition",
                  windowDays === days
                    ? "bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
                )}
              >
                {days}D
              </button>
            ))}
          </div>
          <div className="flex items-center border border-gray-300 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "min-w-16 px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide transition",
                  filter === item.id
                    ? "bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
                )}
              >
                {item.label} <span className="opacity-70">{item.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="border-b border-gray-300 bg-[#FAFAF5] px-4 py-10 text-center font-mono text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
          Loading quote activity...
        </div>
      ) : isError ? (
        <div className="border-b border-rose-300 bg-rose-50 px-4 py-10 text-center font-mono text-xs uppercase tracking-wide text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          Quote activity unavailable.
        </div>
      ) : visibleRows.length ? (
        <div className="flex flex-col">
          {visibleRows.map((row) => (
            <AssetCard
              key={row.asset}
              row={row}
              windowDays={windowDays}
              expandedVenue={expandedVenue}
              onToggleVenue={toggleVenue}
            />
          ))}
        </div>
      ) : (
        <div className="border-b border-gray-300 bg-[#FAFAF5] px-4 py-10 text-center font-mono text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
          No rows for this filter.
        </div>
      )}
    </section>
  );
}
