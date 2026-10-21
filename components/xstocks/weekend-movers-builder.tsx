"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Download, Send, SlidersHorizontal } from "lucide-react";
import { toBlob, toPng } from "html-to-image";
import { TemplateNav } from "./template-nav";
import type {
  XstocksWeekendMover,
  XstocksWeekendMoversTemplateResponse,
} from "@/lib/solana-indexer-client";
import styles from "./weekend-movers-builder.module.css";

type Variant = "ladder" | "tape" | "split";
type Aspect = "1:1" | "16:9" | "4:5";
type Theme = "paper" | "ink";
type Tone = "quiet" | "punchy" | "narrative" | "editorial";
type UpStyle = "gradient" | "green" | "cyan";

type Tweaks = {
  variant: Variant;
  aspect: Aspect;
  theme: Theme;
  count: number;
  showHL: boolean;
  showXS: boolean;
  tone: Tone;
  upStyle: UpStyle;
  accentDown: string;
  showTopTime: boolean;
  showKicker: boolean;
  showSubhead: boolean;
  showMethod: boolean;
  showColHead: boolean;
  showNarr: boolean;
  showWhy: boolean;
  showName: boolean;
  showPriceLabels: boolean;
  showMarquee: boolean;
  showFooter: boolean;
  showBrackets: boolean;
};

const DEFAULT_TWEAKS: Tweaks = {
  variant: "ladder",
  aspect: "1:1",
  theme: "ink",
  count: 5,
  showHL: false,
  showXS: false,
  tone: "punchy",
  upStyle: "gradient",
  accentDown: "#FF5C5C",
  showTopTime: false,
  showKicker: true,
  showSubhead: false,
  showMethod: false,
  showColHead: false,
  showNarr: false,
  showWhy: false,
  showName: true,
  showPriceLabels: true,
  showMarquee: false,
  showFooter: false,
  showBrackets: true,
};

// Hardcoded weekly "why" copy. Indexer's MOVERS[].narr is the long-term
// source but currently empty for every ticker, so we hand-write the line
// per ticker each week. Update these alongside the weekly post; fall back
// to row.narr if the indexer ever populates it.
const WHY_OVERRIDES: Record<string, string> = {
  HOODx: "retail crypto flows hit YTD high",
  AMDx: "MI400 leak hints hyperscaler design win",
  ORCLx: "OCI capacity sold out through 2027",
  LLYx: "GLP-1 supply ramp clears UK trial",
  MSTRx: "BTC dip narrows premium to NAV",
  PLTRx: "new DoD AIP contract option exercised",
  CRCLx: "stablecoin yield rule revives regulatory risk",
  METAx: "Threads ad ARPU now outpaces X",
  TSLAx: "Optimus logs first paid pilot delivery",
  MRVLx: "custom ASIC win at top hyperscaler",
};

function whyFor(row: XstocksWeekendMover): string {
  return WHY_OVERRIDES[row.ticker] || row.narr || "";
}

// Hardcoded company metadata. Indexer doesn't return company names today;
// this lets us label rows ("Robinhood" under "HOODx"). Update when new
// tickers enter the top-10 universe.
const COMPANY_META: Record<string, { name: string }> = {
  HOODx: { name: "Robinhood" },
  AMDx: { name: "AMD" },
  ORCLx: { name: "Oracle" },
  LLYx: { name: "Eli Lilly" },
  MSTRx: { name: "MicroStrategy" },
  PLTRx: { name: "Palantir" },
  CRCLx: { name: "Circle" },
  METAx: { name: "Meta" },
  TSLAx: { name: "Tesla" },
  MRVLx: { name: "Marvell" },
};

function nameFor(row: XstocksWeekendMover): string {
  return COMPANY_META[row.ticker]?.name ?? "";
}

// Strip the trailing `x` so cashtags read like the underlying ticker
// (HOODx -> $HOOD). Only trims one lowercase x.
function cashtag(ticker: string): string {
  return ticker.endsWith("x") ? ticker.slice(0, -1) : ticker;
}

function buildPostText(data: XstocksWeekendMover[]): string {
  const lines: string[] = ["After-hours movers"];
  for (const row of data) {
    const arrow = row.dPct >= 0 ? "▲" : "▼";
    const pct = Math.abs(row.dPct).toFixed(1);
    const why = whyFor(row);
    const tail = why ? ` — ${why}` : "";
    lines.push(`$${cashtag(row.ticker)} ${arrow} ${pct}%${tail}`);
  }
  lines.push("", "All available to trade on-chain with xStocks.");
  return lines.join("\n");
}

const ART_SIZES: Record<Aspect, { width: number; height: number }> = {
  "1:1": { width: 1200, height: 1200 },
  "16:9": { width: 1600, height: 900 },
  "4:5": { width: 1080, height: 1350 },
};

const XS_X_PATH =
  "M388.484 3.05513C388.484 1.49512 387.219 0.230474 385.659 0.230474L259.166 0.230469L194.506 64.8895L129.847 0.230474H3.35396C1.79394 0.230474 0.5293 1.49512 0.5293 3.05513V129.549L65.1884 194.208L0.529302 258.867L0.529297 385.36C0.529297 386.92 1.79394 388.185 3.35396 388.185H129.847L194.506 323.526L259.166 388.185H385.659C387.219 388.185 388.484 386.92 388.484 385.36V258.867L323.825 194.208L388.484 129.549V3.05513Z";

const fmtPct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const fmtM = (value: number) => `$${value.toFixed(1)}M`;
const fmtMshort = (value: number) => `$${value.toFixed(2)}M`;

const XS_GRAD = "linear-gradient(45deg, #1FD59A 0%, #5FCEF0 100%)";

// Pre-fetched per-ticker logo data URLs. html-to-image's canvas
// serialization has a known race when multiple <img> elements need
// re-fetching during export — different tickers end up sharing the
// same bytes. Inlining as data URLs sidesteps the re-fetch entirely.
const LogoDataUrlContext = createContext<Record<string, string>>({});

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function deltaTextStyle(up: boolean, gradientUp: boolean, accentUp: string, accentDown: string) {
  if (!up) return { color: accentDown };
  if (!gradientUp) return { color: accentUp };
  return {
    background: XS_GRAD,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  };
}

function densityFor(count: number) {
  if (count <= 3) return "roomy";
  if (count <= 6) return "medium";
  return "compact";
}

const LADDER_SIZES = {
  roomy: { ticker: 44, delta: 52, mono: 12, narr: 11, head: 11, bar: 10, why: 15, name: 15, price: 15 },
  medium: { ticker: 32, delta: 40, mono: 11, narr: 10, head: 10, bar: 8, why: 13, name: 13, price: 13 },
  compact: { ticker: 24, delta: 30, mono: 10, narr: 0, head: 9.5, bar: 6, why: 11, name: 12, price: 11.5 },
};

const TAPE_SIZES = {
  roomy: { hero: 200, dlt: 80, tk: 26, narr: 14, stat: 11 },
  medium: { hero: 160, dlt: 68, tk: 22, narr: 12, stat: 10.5 },
  compact: { hero: 130, dlt: 56, tk: 18, narr: 11, stat: 10 },
};

const SPLIT_SIZES = {
  roomy: { tk: 24, dlt: 24, mono: 12, narr: 10.5 },
  medium: { tk: 20, dlt: 20, mono: 11, narr: 10 },
  compact: { tk: 17, dlt: 17, mono: 10, narr: 0 },
};

function Brandmark({
  assets,
  theme,
  height,
}: {
  assets: Record<string, string>;
  theme: Theme;
  height: number;
}) {
  const key =
    theme === "ink"
      ? "brand/xstocks-lockup-h-white-gradient.svg"
      : "brand/xstocks-lockup-h-black-gradient.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="xStocks"
      className={styles.brandmark}
      src={assets[key] ?? `/xstocks/${key}`}
      style={{ height }}
    />
  );
}

function TokenLogo({ row, size }: { row: XstocksWeekendMover; size: number }) {
  const logoMap = useContext(LogoDataUrlContext);
  if (!row.logo) return null;

  // Prefer pre-fetched data URL (set after the effect in WeekendMoversBuilder
  // resolves). Falls back to the same-origin proxy for the initial paint so
  // logos still appear before the data URLs land.
  const src = logoMap[row.ticker] ?? `/api/xstocks/logo?t=${encodeURIComponent(row.ticker)}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className={styles.tokenLogo}
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      src={src}
      style={{ width: size, height: size }}
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function XMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 389 389" aria-hidden="true">
      <defs>
        <linearGradient id="xstocks-mark-gradient" x1="0" y1="389" x2="389" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1FD59A" />
          <stop offset="100%" stopColor="#5FCEF0" />
        </linearGradient>
      </defs>
      <path d={XS_X_PATH} fill="url(#xstocks-mark-gradient)" />
    </svg>
  );
}

function Headline({
  tone,
  count,
  aspect,
  showKicker,
  showSubhead,
  weekLabel,
}: {
  tone: Tone;
  count: number;
  aspect: Aspect;
  showKicker: boolean;
  showSubhead: boolean;
  weekLabel: string;
}) {
  const wide = aspect === "16:9";
  const bigBoost = showSubhead ? 1 : 1.15;
  const fontSize =
    tone === "quiet"
      ? (wide ? 56 : 60) * bigBoost
      : tone === "editorial"
        ? (wide ? 48 : 52) * bigBoost
        : tone === "narrative"
          ? (wide ? 52 : 58) * bigBoost
          : (wide ? 64 : 72) * bigBoost;

  // Parse "WK 22 / MAY 22 - 28 2026" -> { week: "WK 22", dates: "MAY 22–28 2026" }
  const [rawWeek, rawDates] = weekLabel.split(" / ");
  const week = rawWeek?.trim() || "WK";
  const dates = (rawDates ?? "").replace(" - ", "–");
  const kickerText =
    tone === "quiet"
      ? "Weekend movers"
      : tone === "editorial"
        ? "Weekend movers · series 01"
        : `Weekend movers · ${week}${dates ? ` · ${dates}` : ""}`;

  return (
    <>
      <div className={styles.kicker}>
        <span className={styles.seqBadge}>
          <XMark size={12} />
          {week} / N
        </span>
        {showKicker && <span>{kickerText}</span>}
      </div>
      <h1 className={styles.display} style={{ fontSize }}>
        {tone === "quiet" ? (
          <>
            What repriced <span>while TradFi slept.</span>
          </>
        ) : tone === "editorial" ? (
          <>TradFi closed Friday. Price discovery didn&apos;t.</>
        ) : tone === "narrative" ? (
          <>
            These {count} have already moved.
            <br />
            <span>Monday will reflect what onchain saw.</span>
          </>
        ) : (
          <>Weekend Movers.</>
        )}
      </h1>
      {showSubhead && (
        <p className={styles.subhead}>
          Friday 4 PM ET close to live Hyperliquid xStocks. Biggest deltas, tradable now on xStocks.
        </p>
      )}
    </>
  );
}

function VariantLadder({
  data,
  showHL,
  showXS,
  accentUp,
  accentDown,
  gradientUp,
  showColHead,
  showNarr,
  showWhy,
  showName,
  showPriceLabels,
}: VariantProps) {
  const density = densityFor(data.length);
  const size = LADDER_SIZES[density];
  const logoSize = density === "roomy" ? 74 : density === "medium" ? 56 : 44;
  const maxAbs = Math.max(1, ...data.map((row) => Math.abs(row.dPct)));
  const tickerMin = density === "roomy" ? 200 : density === "medium" ? 160 : 130;
  const cols = showWhy
    ? ["38px", `minmax(${tickerMin}px, 1.1fr)`, "minmax(160px, 1.3fr)", "1.6fr", "minmax(110px, 1fr)"]
    : ["38px", `minmax(${tickerMin}px, 1.2fr)`, "1.8fr", "minmax(110px, 1fr)"];
  if (showHL) cols.push("minmax(80px, 0.7fr)");
  if (showXS) cols.push("minmax(80px, 0.7fr)");
  const gridTemplateColumns = cols.join(" ");

  return (
    <div className={styles.ladder}>
      {showColHead && (
        <div className={styles.ladderHead} style={{ gridTemplateColumns, fontSize: size.head }}>
          <span>#</span>
          <span>Ticker</span>
          {showWhy && <span>Why</span>}
          <span>Delta / Fri 4PM to HL</span>
          <span className={styles.alignRight}>Delta %</span>
          {showHL && <span className={styles.alignRight}>HL / OI</span>}
          {showXS && <span className={styles.alignRight}>x / depth</span>}
        </div>
      )}
      <div className={styles.ladderRows}>
        {data.map((row) => {
          const width = (Math.abs(row.dPct) / maxAbs) * 100;
          const up = row.dPct >= 0;
          const companyName = nameFor(row);
          return (
            <div key={row.ticker} className={styles.ladderRow} style={{ gridTemplateColumns }}>
              <span className={styles.rank} style={{ fontSize: size.head }}>
                {String(row.rank).padStart(2, "0")}
              </span>
              <div className={styles.tickerCell}>
                <TokenLogo row={row} size={logoSize} />
                <div className={styles.minZero}>
                  <div className={styles.ticker} style={{ fontSize: size.ticker }}>
                    {row.ticker}
                  </div>
                  {showName && companyName && (
                    <div className={styles.companyName} style={{ fontSize: size.name }}>
                      {companyName}
                    </div>
                  )}
                  {showNarr && size.narr > 0 && row.narr && (
                    <div className={styles.narr} style={{ fontSize: size.narr }}>
                      {row.narr}
                    </div>
                  )}
                </div>
              </div>
              {showWhy && (
                <div className={styles.whyCell} style={{ fontSize: size.why }}>
                  {whyFor(row)}
                </div>
              )}
              <div className={styles.barCell}>
                {showPriceLabels && (
                  <div className={styles.priceRow} style={{ fontSize: size.price }}>
                    <span className={styles.priceLeft}>${row.friClose.toFixed(2)}</span>
                    <span className={styles.priceRight}>${row.sunHL.toFixed(2)}</span>
                  </div>
                )}
                <div className={styles.barAxis} style={{ height: size.bar }}>
                  <span
                    className={styles.bar}
                    style={{
                      background: up && gradientUp ? XS_GRAD : up ? accentUp : accentDown,
                      width: `${width}%`,
                    }}
                  />
                </div>
              </div>
              <span
                className={styles.delta}
                style={{ ...deltaTextStyle(up, gradientUp, accentUp, accentDown), fontSize: size.delta }}
              >
                {fmtPct(row.dPct)}
              </span>
              {showHL && (
                <span className={styles.stat} style={{ fontSize: size.mono }}>
                  <span>OI</span>
                  {fmtM(row.hlOI)}
                </span>
              )}
              {showXS && (
                <span className={styles.stat} style={{ fontSize: size.mono }}>
                  <span>depth</span>
                  {fmtMshort(row.xDepth)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type VariantProps = {
  data: XstocksWeekendMover[];
  showHL: boolean;
  showXS: boolean;
  accentUp: string;
  accentDown: string;
  gradientUp: boolean;
  showColHead: boolean;
  showNarr: boolean;
  showWhy: boolean;
  showName: boolean;
  showPriceLabels: boolean;
};

function VariantTape({
  data,
  showHL,
  showXS,
  accentUp,
  accentDown,
  gradientUp,
  showColHead,
  showNarr,
  showPriceLabels,
}: VariantProps) {
  if (!data.length) return null;
  const lead = data[0]!;
  const rest = data.slice(1);
  const leadUp = lead.dPct >= 0;
  const density = densityFor(rest.length || 1);
  const size = TAPE_SIZES[density];
  const logoSize = density === "roomy" ? 30 : density === "medium" ? 26 : 22;
  const leadLogoSize = Math.max(44, Math.min(76, Math.round(size.hero * 0.34)));
  const cols = ["34px", "minmax(104px, 0.9fr)"];
  if (showNarr) cols.push("1.8fr");
  cols.push("minmax(80px, 0.8fr)");
  if (showHL) cols.push("minmax(70px, 0.6fr)");
  if (showXS) cols.push("minmax(70px, 0.6fr)");

  return (
    <div className={styles.tapeWrap}>
      <div className={styles.tapeHero}>
        <div className={styles.minZero}>
          {showColHead && <div className={styles.meta}>#01 / biggest weekend move</div>}
          <div className={styles.leadTitle}>
            <TokenLogo row={lead} size={leadLogoSize} />
            <div className={styles.leadTicker} style={{ fontSize: size.hero }}>
              {lead.ticker}
            </div>
          </div>
          {(showNarr || showPriceLabels) && (
            <div className={styles.metaLine}>
              {showNarr && lead.narr && <span>{lead.narr}</span>}
              {showPriceLabels && (
                <span>
                  FRI ${lead.friClose.toFixed(2)} - SUN ${lead.sunHL.toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className={styles.alignRight}>
          <div
            className={styles.leadDelta}
            style={{
              ...deltaTextStyle(leadUp, gradientUp, accentUp, accentDown),
              fontSize: size.dlt,
            }}
          >
            {fmtPct(lead.dPct)}
          </div>
          {(showHL || showXS) && (
            <div className={styles.metaStats}>
              {showHL && <span>HL OI / {fmtM(lead.hlOI)}</span>}
              {showXS && <span>x depth / {fmtMshort(lead.xDepth)}</span>}
            </div>
          )}
        </div>
      </div>
      <div className={styles.tapeList}>
        {rest.map((row) => {
          const up = row.dPct >= 0;
          return (
            <div key={row.ticker} className={styles.tapeRow} style={{ gridTemplateColumns: cols.join(" ") }}>
              <span className={styles.rank}>{String(row.rank).padStart(2, "0")}</span>
              <span className={styles.tickerCell}>
                <TokenLogo row={row} size={logoSize} />
                <span className={styles.tapeTicker} style={{ fontSize: size.tk }}>
                  {row.ticker}
                </span>
              </span>
              {showNarr && (
                <span className={styles.tapeNarr} style={{ fontSize: size.narr }}>
                  {row.narr}
                </span>
              )}
              <span
                className={styles.tapeDelta}
                style={{ ...deltaTextStyle(up, gradientUp, accentUp, accentDown), fontSize: size.tk + 4 }}
              >
                {fmtPct(row.dPct)}
              </span>
              {showHL && <span className={styles.tapeStat}>OI {fmtM(row.hlOI)}</span>}
              {showXS && <span className={styles.tapeStat}>depth {fmtMshort(row.xDepth)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VariantSplit({
  data,
  showHL,
  showXS,
  accentUp,
  accentDown,
  gradientUp,
  showNarr,
  showPriceLabels,
}: VariantProps) {
  const ups = data.filter((row) => row.dPct >= 0);
  const downs = data.filter((row) => row.dPct < 0);
  const density = densityFor(Math.max(ups.length, downs.length, 1));
  const size = SPLIT_SIZES[density];
  const logoSize = density === "roomy" ? 28 : density === "medium" ? 24 : 20;
  const rowTemplate = showPriceLabels ? "1fr 1fr 80px" : "1fr 80px";

  const Column = ({
    items,
    label,
    isUp,
  }: {
    items: XstocksWeekendMover[];
    label: string;
    isUp: boolean;
  }) => (
    <div className={styles.splitCol}>
      <div className={styles.splitHead}>
        <h3>{label}</h3>
        <span className={styles.meta}>{items.length} {items.length === 1 ? "name" : "names"}</span>
      </div>
      <div className={styles.splitRows}>
        {items.length === 0 && <div className={styles.emptySplit}>none this week</div>}
        {items.map((row) => (
          <div key={row.ticker} className={styles.splitRow} style={{ gridTemplateColumns: rowTemplate }}>
            <div className={styles.tickerCell}>
              <TokenLogo row={row} size={logoSize} />
              <div className={styles.minZero}>
                <div className={styles.splitTicker} style={{ fontSize: size.tk }}>
                  {row.ticker}
                </div>
                {showNarr && size.narr > 0 && row.narr && (
                  <div className={styles.narr} style={{ fontSize: size.narr }}>
                    {row.narr}
                  </div>
                )}
                {(showHL || showXS) && (
                  <div className={styles.splitStats} style={{ fontSize: Math.max(9.5, size.mono - 1) }}>
                    {showHL && <span>OI {fmtM(row.hlOI)}</span>}
                    {showXS && <span>depth {fmtMshort(row.xDepth)}</span>}
                  </div>
                )}
              </div>
            </div>
            {showPriceLabels && (
              <div className={styles.splitPrices} style={{ fontSize: size.mono }}>
                <span>${row.friClose.toFixed(2)}</span>
                <span>-</span>
                <strong>${row.sunHL.toFixed(2)}</strong>
              </div>
            )}
            <span
              className={styles.splitDelta}
              style={{
                ...deltaTextStyle(isUp, gradientUp, accentUp, accentDown),
                fontSize: size.dlt,
              }}
            >
              {fmtPct(row.dPct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className={styles.splitWrap}>
      <Column items={ups} label="Up / onchain" isUp />
      <Column items={downs} label="Down / onchain" isUp={false} />
    </div>
  );
}

function ControlGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.controlGroup}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.toggleRow}>
      <span>{label}</span>
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function CTATape({ data }: { data: XstocksWeekendMover[] }) {
  const segments = Array.from({ length: 3 }).flatMap(() => [
    "TRADABLE NOW ON XSTOCKS",
    ...data.map((row) => row.ticker),
  ]);
  return (
    <div className={styles.marquee}>
      <div className={styles.marqueeInner}>
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`} data-em={segment.startsWith("TRADABLE") ? "1" : "0"}>
            {segment}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WeekendMoversBuilder({
  template,
  error,
}: {
  template: XstocksWeekendMoversTemplateResponse | null;
  error?: string;
}) {
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [scale, setScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postHint, setPostHint] = useState<string | null>(null);
  const [logoMap, setLogoMap] = useState<Record<string, string>>({});
  const [logosReady, setLogosReady] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const maxCount = Math.max(1, Math.min(10, template?.MOVERS.length ?? 1));
  const size = ART_SIZES[tweaks.aspect];

  const data = useMemo(
    () => (template?.MOVERS ?? []).slice(0, Math.min(tweaks.count, maxCount)),
    [maxCount, template?.MOVERS, tweaks.count]
  );

  useEffect(() => {
    const movers = template?.MOVERS ?? [];
    if (!movers.length) {
      setLogoMap({});
      setLogosReady(true);
      return;
    }
    let cancelled = false;
    setLogosReady(false);
    Promise.all(
      movers.map(async (m): Promise<[string, string] | null> => {
        try {
          const res = await fetch(`/api/xstocks/logo?t=${encodeURIComponent(m.ticker)}`);
          if (!res.ok) return null;
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          return [m.ticker, dataUrl];
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const entries = results.filter((r): r is [string, string] => r !== null);
      setLogoMap(Object.fromEntries(entries));
      setLogosReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [template?.MOVERS]);

  useLayoutEffect(() => {
    const fit = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const next = Math.min(rect.width / size.width, rect.height / size.height, 1);
      setScale(Number(Math.max(0.1, next).toFixed(4)));
    };

    fit();
    const observer = new ResizeObserver(fit);
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [size.height, size.width]);

  const setTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks((prev) => ({ ...prev, [key]: value }));
  };

  const accentUp = tweaks.upStyle === "cyan" ? "#5FCEF0" : "#1FD59A";
  const gradientUp = tweaks.upStyle === "gradient";

  const Variant =
    tweaks.variant === "tape"
      ? VariantTape
      : tweaks.variant === "split"
        ? VariantSplit
        : VariantLadder;

  const exportOptions = {
    cacheBust: true,
    pixelRatio: 2,
    width: size.width,
    height: size.height,
    backgroundColor: tweaks.theme === "ink" ? "#181D1C" : "#FFFFFF",
    style: { transform: "none" },
  } as const;

  const fileSlug = template?.WEEK_LABEL
    ? template.WEEK_LABEL.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "weekend-movers";

  async function downloadPng() {
    if (!artRef.current || !template) return;
    setDownloading(true);
    try {
      const png = await toPng(artRef.current, exportOptions);
      const link = document.createElement("a");
      link.download = `${fileSlug}.png`;
      link.href = png;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  async function postOnX() {
    if (!artRef.current || !template) return;
    setPosting(true);
    setPostHint(null);
    try {
      const blob = await toBlob(artRef.current, exportOptions);
      let copied = false;
      if (
        blob &&
        typeof window !== "undefined" &&
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof window.ClipboardItem === "function"
      ) {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (!copied && blob) {
        // Clipboard unsupported or denied — download the PNG so the user
        // can drag it into the X compose box manually.
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${fileSlug}.png`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const text = buildPostText(data);
      const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
      window.open(intent, "_blank", "noopener,noreferrer");
      setPostHint(copied ? "Image copied — paste in the X compose window (⌘V / Ctrl+V)." : "Image downloaded — drag it into the X compose window.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <LogoDataUrlContext.Provider value={logoMap}>
    <main className={styles.builder}>
      <section className={styles.stage} ref={stageRef}>
        <div
          className={styles.artFrame}
          style={{
            width: size.width * scale,
            height: size.height * scale,
          }}
        >
          <div
            className={styles.art}
            data-aspect={tweaks.aspect}
            data-theme={tweaks.theme}
            ref={artRef}
            style={{
              width: size.width,
              height: size.height,
              transform: `scale(${scale})`,
              "--up": accentUp,
              "--down": tweaks.accentDown,
            } as CSSProperties}
          >
            {tweaks.showBrackets && (
              <>
                <span className={`${styles.corner} ${styles.tl}`} />
                <span className={`${styles.corner} ${styles.tr}`} />
                <span className={`${styles.corner} ${styles.bl}`} />
                <span className={`${styles.corner} ${styles.br}`} />
              </>
            )}

            <div className={styles.artTop}>
              <Brandmark assets={template?.BRAND_ASSETS ?? {}} theme={tweaks.theme} height={24} />
              {tweaks.showTopTime && <span className={styles.meta}>{template?.POST_TIME}</span>}
            </div>

            <div className={styles.artHead}>
              <Headline
                aspect={tweaks.aspect}
                count={Math.min(tweaks.count, maxCount)}
                showKicker={tweaks.showKicker}
                showSubhead={tweaks.showSubhead}
                tone={tweaks.tone}
                weekLabel={template?.WEEK_LABEL ?? "WK / unavailable"}
              />
            </div>

            <div className={styles.gradientRule} />

            {tweaks.showMethod ? (
              <div className={styles.methodStrip}>
                <span>Delta / Fri 16:00 ET close to live HL spot</span>
                <span>Ref / Hyperliquid</span>
                <span>Venue / xStocks</span>
              </div>
            ) : (
              <div className={styles.methodGap} />
            )}

            <div className={styles.artViz}>
              {data.length ? (
                <Variant
                  accentDown={tweaks.accentDown}
                  accentUp={accentUp}
                  data={data}
                  gradientUp={gradientUp}
                  showColHead={tweaks.showColHead}
                  showHL={tweaks.showHL}
                  showName={tweaks.showName}
                  showNarr={tweaks.showNarr}
                  showPriceLabels={tweaks.showPriceLabels}
                  showWhy={tweaks.showWhy}
                  showXS={tweaks.showXS}
                />
              ) : (
                <div className={styles.emptyArt}>No template rows available</div>
              )}
            </div>

            {tweaks.showMarquee && (
              <div className={styles.artCta}>
                <CTATape data={data} />
              </div>
            )}

            <div className={styles.artBottom}>
              {tweaks.showFooter && <span className={styles.meta}>Weekend movers / weekly / automated post</span>}
              <span className={styles.footerBrand}>
                {tweaks.showFooter && <span>{tweaks.variant.toUpperCase()} / {tweaks.aspect}</span>}
                <Brandmark assets={template?.BRAND_ASSETS ?? {}} theme={tweaks.theme} height={tweaks.showFooter ? 18 : 20} />
              </span>
            </div>
          </div>
        </div>
      </section>

      <aside className={styles.controls}>
        <header className={styles.controlsHeader}>
          <SlidersHorizontal size={16} />
          <span>xStocks Weekend Movers</span>
        </header>

        <TemplateNav />

        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.actionRow}>
          <button
            className={styles.downloadButton}
            disabled={!template || !data.length || downloading || !logosReady}
            type="button"
            onClick={downloadPng}
          >
            <Download size={16} />
            {downloading ? "Rendering" : !logosReady ? "Loading logos" : "Download PNG"}
          </button>
          <button
            className={styles.postButton}
            disabled={!template || !data.length || posting || !logosReady}
            type="button"
            onClick={postOnX}
          >
            <Send size={16} />
            {posting ? "Preparing" : !logosReady ? "Loading logos" : "Post on X"}
          </button>
        </div>
        {postHint && <div className={styles.postHint}>{postHint}</div>}

        <ControlGroup title="Layout">
          <Segmented
            value={tweaks.variant}
            options={[
              { value: "ladder", label: "Ladder" },
              { value: "tape", label: "Tape" },
              { value: "split", label: "Split" },
            ]}
            onChange={(value) => setTweak("variant", value)}
          />
          <Segmented
            value={tweaks.aspect}
            options={[
              { value: "1:1", label: "1:1" },
              { value: "16:9", label: "16:9" },
              { value: "4:5", label: "4:5" },
            ]}
            onChange={(value) => setTweak("aspect", value)}
          />
          <Segmented
            value={tweaks.theme}
            options={[
              { value: "paper", label: "Paper" },
              { value: "ink", label: "Ink" },
            ]}
            onChange={(value) => setTweak("theme", value)}
          />
        </ControlGroup>

        <ControlGroup title="Data">
          <label className={styles.sliderRow}>
            <span>Count</span>
            <strong>{Math.min(tweaks.count, maxCount)}</strong>
            <input
              max={maxCount}
              min={1}
              step={1}
              type="range"
              value={Math.min(tweaks.count, maxCount)}
              onChange={(event) => setTweak("count", Number(event.target.value))}
            />
          </label>
          <Toggle checked={tweaks.showHL} label="HL OI column" onChange={(value) => setTweak("showHL", value)} />
          <Toggle checked={tweaks.showXS} label="xStocks depth" onChange={(value) => setTweak("showXS", value)} />
        </ControlGroup>

        <ControlGroup title="Voice">
          <Segmented
            value={tweaks.tone}
            options={[
              { value: "quiet", label: "Quiet" },
              { value: "punchy", label: "Punchy" },
              { value: "narrative", label: "Narrative" },
              { value: "editorial", label: "Editorial" },
            ]}
            onChange={(value) => setTweak("tone", value)}
          />
        </ControlGroup>

        <ControlGroup title="Accents">
          <Segmented
            value={tweaks.upStyle}
            options={[
              { value: "gradient", label: "Grad" },
              { value: "green", label: "Green" },
              { value: "cyan", label: "Cyan" },
            ]}
            onChange={(value) => setTweak("upStyle", value)}
          />
          <div className={styles.swatches}>
            {["#FF5C5C", "#FF7A45", "#E5484D", "#FF8C8C", "#181D1C"].map((color) => (
              <button
                aria-label={`Use ${color} for down moves`}
                aria-pressed={tweaks.accentDown === color}
                key={color}
                style={{ background: color }}
                type="button"
                onClick={() => setTweak("accentDown", color)}
              />
            ))}
          </div>
        </ControlGroup>

        <ControlGroup title="Show">
          <Toggle checked={tweaks.showKicker} label="Kicker" onChange={(value) => setTweak("showKicker", value)} />
          <Toggle checked={tweaks.showSubhead} label="Subhead" onChange={(value) => setTweak("showSubhead", value)} />
          <Toggle checked={tweaks.showMethod} label="Method strip" onChange={(value) => setTweak("showMethod", value)} />
          <Toggle checked={tweaks.showColHead} label="Column headers" onChange={(value) => setTweak("showColHead", value)} />
          <Toggle checked={tweaks.showName} label="Company name" onChange={(value) => setTweak("showName", value)} />
          <Toggle checked={tweaks.showNarr} label="Narrative tags" onChange={(value) => setTweak("showNarr", value)} />
          <Toggle checked={tweaks.showWhy} label="Why column (Ladder)" onChange={(value) => setTweak("showWhy", value)} />
          <Toggle checked={tweaks.showPriceLabels} label="Price labels" onChange={(value) => setTweak("showPriceLabels", value)} />
          <Toggle checked={tweaks.showTopTime} label="Top timestamp" onChange={(value) => setTweak("showTopTime", value)} />
          <Toggle checked={tweaks.showMarquee} label="Marquee tape" onChange={(value) => setTweak("showMarquee", value)} />
          <Toggle checked={tweaks.showFooter} label="Footer row" onChange={(value) => setTweak("showFooter", value)} />
          <Toggle checked={tweaks.showBrackets} label="Corner brackets" onChange={(value) => setTweak("showBrackets", value)} />
        </ControlGroup>
      </aside>
    </main>
    </LogoDataUrlContext.Provider>
  );
}
