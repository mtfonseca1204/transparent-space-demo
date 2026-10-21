"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Download, Send, SlidersHorizontal } from "lucide-react";
import { toBlob, toPng } from "html-to-image";
import shell from "./weekend-movers-builder.module.css";
import styles from "./earnings-builder.module.css";
import { TemplateNav } from "./template-nav";

type Aspect = "1:1" | "16:9" | "4:5";
type Theme = "paper" | "ink";
type Verdict = "beat" | "miss" | "inline";
type Mode = "spotlight" | "tape";

type EarningsFixture = {
  ticker: string;
  company: string;
  reportSlot: "AFTER CLOSE" | "BEFORE OPEN";
  reportDateLabel: string;
  eps: { actual: string; est: string; verdict: Verdict };
  rev: { actual: string; est: string; verdict: Verdict };
  guidance: { label: string; verdict: Verdict };
  // The overnight arc — the visual signature of the template.
  printPct: number;        // initial post-print xStocks reaction
  settlePct: number;       // where xStocks sat by morning, before TradFi open
  openPct: number;         // realized TradFi next-session open (gap from prior close)
  printStamp: string;      // e.g. "4:20 PM ET"
  settleStamp: string;     // e.g. "9:00 AM ET"
  openStamp: string;       // e.g. "9:30 AM ET"
  whyLine: string;         // one-liner editorial context
  hlOiShift: string;
  xDepth: string;
};

// Static session header — every render is anchored to the same dark window.
// Update before posting; this is the literal claim the template makes.
const SESSION = {
  state: "dark" as const,
  windowLabel: "WED 4:00 PM ET → THU 9:30 AM ET",
  dateLabel: "MAY 28 → MAY 29 2026",
};

// Public track record. Static for now; eventually rolls from a stored
// history of overnight settle vs. realized NYSE open.
const TRACK_RECORD = {
  hits: 28,
  total: 30,
  periodLabel: "MAR – MAY 2026",
  tolerancePp: 1,
};

// Hand-edited list of prints in this window. Sort applied at render time
// (divergence-first), so the visual ranking surfaces surprises automatically.
const FIXTURES: EarningsFixture[] = [
  {
    ticker: "PLTRx",
    company: "Palantir",
    reportSlot: "AFTER CLOSE",
    reportDateLabel: "MAY 28 2026",
    eps: { actual: "$0.18", est: "$0.16", verdict: "beat" },
    rev: { actual: "$1.05B", est: "$0.99B", verdict: "beat" },
    guidance: { label: "Raised", verdict: "beat" },
    printPct: 0.6,
    settlePct: -2.4,
    openPct: -2.1,
    printStamp: "4:18 PM ET",
    settleStamp: "9:00 AM ET",
    openStamp: "9:30 AM ET",
    whyLine: "beat the print, sold the guide — concentration concerns",
    hlOiShift: "+$11M",
    xDepth: "$2.4M",
  },
  {
    ticker: "NVDAx",
    company: "NVIDIA",
    reportSlot: "AFTER CLOSE",
    reportDateLabel: "MAY 28 2026",
    eps: { actual: "$0.81", est: "$0.75", verdict: "beat" },
    rev: { actual: "$35.1B", est: "$33.0B", verdict: "beat" },
    guidance: { label: "Raised", verdict: "beat" },
    printPct: 8.4,
    settlePct: 6.7,
    openPct: 6.9,
    printStamp: "4:20 PM ET",
    settleStamp: "9:00 AM ET",
    openStamp: "9:30 AM ET",
    whyLine: "demand “insane” — capex thesis intact",
    hlOiShift: "+$28M",
    xDepth: "$4.2M",
  },
  {
    ticker: "METAx",
    company: "Meta Platforms",
    reportSlot: "AFTER CLOSE",
    reportDateLabel: "MAY 28 2026",
    eps: { actual: "$6.41", est: "$5.94", verdict: "beat" },
    rev: { actual: "$48.2B", est: "$45.9B", verdict: "beat" },
    guidance: { label: "In-line", verdict: "inline" },
    printPct: 5.1,
    settlePct: 4.4,
    openPct: 4.6,
    printStamp: "4:15 PM ET",
    settleStamp: "9:00 AM ET",
    openStamp: "9:30 AM ET",
    whyLine: "ad demand resilient, Reality Labs loss in-line",
    hlOiShift: "+$14M",
    xDepth: "$3.1M",
  },
  {
    ticker: "TSLAx",
    company: "Tesla",
    reportSlot: "AFTER CLOSE",
    reportDateLabel: "MAY 28 2026",
    eps: { actual: "$0.52", est: "$0.61", verdict: "miss" },
    rev: { actual: "$24.1B", est: "$25.3B", verdict: "miss" },
    guidance: { label: "Lowered", verdict: "miss" },
    printPct: -5.8,
    settlePct: -4.2,
    openPct: -3.9,
    printStamp: "4:22 PM ET",
    settleStamp: "9:00 AM ET",
    openStamp: "9:30 AM ET",
    whyLine: "delivery guide cut, robotaxi narrative paused",
    hlOiShift: "+$22M",
    xDepth: "$3.8M",
  },
];

const BRAND_LOCKUP = {
  ink: "/xstocks/brand/xstocks-lockup-h-white-gradient.svg",
  paper: "/xstocks/brand/xstocks-lockup-h-black-gradient.svg",
};

const ART_SIZES: Record<Aspect, { width: number; height: number }> = {
  "1:1": { width: 1200, height: 1200 },
  "16:9": { width: 1600, height: 900 },
  "4:5": { width: 1080, height: 1350 },
};

const XS_GRAD = "linear-gradient(45deg, #1FD59A 0%, #5FCEF0 100%)";

const XS_X_PATH =
  "M388.484 3.05513C388.484 1.49512 387.219 0.230474 385.659 0.230474L259.166 0.230469L194.506 64.8895L129.847 0.230474H3.35396C1.79394 0.230474 0.5293 1.49512 0.5293 3.05513V129.549L65.1884 194.208L0.529302 258.867L0.529297 385.36C0.529297 386.92 1.79394 388.185 3.35396 388.185H129.847L194.506 323.526L259.166 388.185H385.659C387.219 388.185 388.484 386.92 388.484 385.36V258.867L323.825 194.208L388.484 129.549V3.05513Z";

const fmtPct1 = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const fmtPctAbs = (value: number) => `${Math.abs(value).toFixed(1)}%`;

function deltaTextStyle(up: boolean, accentDown: string) {
  if (!up) return { color: accentDown };
  return {
    background: XS_GRAD,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function cashtag(ticker: string): string {
  return ticker.endsWith("x") ? ticker.slice(0, -1) : ticker;
}

function verdictText(verdict: Verdict, opts?: { guidance?: string }) {
  if (opts?.guidance) return opts.guidance.toUpperCase();
  if (verdict === "beat") return "BEAT";
  if (verdict === "miss") return "MISS";
  return "IN-LINE";
}

function verdictScore(v: Verdict): number {
  return v === "beat" ? 1 : v === "miss" ? -1 : 0;
}

function printScore(f: EarningsFixture): number {
  return verdictScore(f.eps.verdict) + verdictScore(f.rev.verdict) + verdictScore(f.guidance.verdict);
}

function expectedSign(f: EarningsFixture): -1 | 0 | 1 {
  const s = printScore(f);
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

function actualSign(f: EarningsFixture): -1 | 0 | 1 {
  if (f.settlePct > 0) return 1;
  if (f.settlePct < 0) return -1;
  return 0;
}

function isDivergent(f: EarningsFixture): boolean {
  const e = expectedSign(f);
  const a = actualSign(f);
  if (e === 0 || a === 0) return false;
  return e !== a;
}

function surpriseLabel(f: EarningsFixture): string | null {
  if (!isDivergent(f)) return null;
  return expectedSign(f) > 0 ? "BEAT — BUT SOLD" : "MISS — BUT BOUGHT";
}

function callDeltaPp(f: EarningsFixture): number {
  return f.openPct - f.settlePct;
}

function isCallHit(f: EarningsFixture): boolean {
  return Math.abs(callDeltaPp(f)) <= TRACK_RECORD.tolerancePp;
}

function sortByDivergenceFirst(items: EarningsFixture[]): EarningsFixture[] {
  return [...items].sort((a, b) => {
    const dA = isDivergent(a) ? 1 : 0;
    const dB = isDivergent(b) ? 1 : 0;
    if (dA !== dB) return dB - dA;
    return Math.abs(b.settlePct) - Math.abs(a.settlePct);
  });
}

function XMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 389 389" aria-hidden="true">
      <defs>
        <linearGradient id="earnings-mark-gradient" x1="0" y1="389" x2="389" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1FD59A" />
          <stop offset="100%" stopColor="#5FCEF0" />
        </linearGradient>
      </defs>
      <path d={XS_X_PATH} fill="url(#earnings-mark-gradient)" />
    </svg>
  );
}

function SessionPill({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <div className={styles.sessionPill} data-size={size}>
      <span className={styles.sessionDot} aria-hidden="true" />
      <span>NYSE DARK</span>
      <span className={styles.sessionSep}>·</span>
      <span className={styles.sessionLive}>XSTOCKS LIVE</span>
      <span className={styles.sessionSep}>·</span>
      <span className={styles.sessionWindow}>{SESSION.windowLabel}</span>
    </div>
  );
}

function VerdictPill({ verdict, label }: { verdict: Verdict; label: string }) {
  return (
    <span className={styles.verdictBadge} data-verdict={verdict}>
      {label}
    </span>
  );
}

function SurpriseTag({ label }: { label: string }) {
  return (
    <span className={styles.surpriseTag}>
      <span aria-hidden="true">◆</span>
      {label}
    </span>
  );
}

function ArcBox({
  label,
  pct,
  stamp,
  emphasize,
  accentDown,
}: {
  label: string;
  pct: number;
  stamp: string;
  emphasize?: boolean;
  accentDown: string;
}) {
  const up = pct >= 0;
  return (
    <div className={styles.arcBox} data-emphasize={emphasize ? "1" : "0"}>
      <div className={styles.arcBoxLabel}>{label}</div>
      <div className={styles.arcBoxValue} style={deltaTextStyle(up, accentDown)}>
        {up ? "▲" : "▼"} {fmtPctAbs(pct)}
      </div>
      <div className={styles.arcBoxStamp}>{stamp}</div>
    </div>
  );
}

function CallPill({ hit, deltaPp }: { hit: boolean; deltaPp: number }) {
  const sign = deltaPp >= 0 ? "+" : "−";
  return (
    <span className={styles.callPill} data-hit={hit ? "1" : "0"}>
      <span aria-hidden="true">{hit ? "✓" : "✗"}</span>
      {hit ? "HIT" : "MISS"}
      <span className={styles.callPillDelta}>
        Δ {sign}{Math.abs(deltaPp).toFixed(1)}pp
      </span>
    </span>
  );
}

function TrackRecordLine() {
  return (
    <div className={styles.trackRecord}>
      <span className={styles.trackRecordLabel}>THE CALL · OVERNIGHT VS NYSE OPEN</span>
      <span className={styles.trackRecordScore}>
        {TRACK_RECORD.hits}/{TRACK_RECORD.total}
      </span>
      <span className={styles.trackRecordMeta}>within {TRACK_RECORD.tolerancePp} pp · {TRACK_RECORD.periodLabel}</span>
    </div>
  );
}

function TapeRow({
  fixture,
  rank,
  logoSrc,
  accentDown,
  density,
}: {
  fixture: EarningsFixture;
  rank: number;
  logoSrc: string;
  accentDown: string;
  density: "roomy" | "medium" | "compact";
}) {
  const sizes = TAPE_SIZES[density];
  const surprise = surpriseLabel(fixture);
  const hit = isCallHit(fixture);
  const callPp = callDeltaPp(fixture);
  const printUp = fixture.printPct >= 0;
  const settleUp = fixture.settlePct >= 0;
  const openUp = fixture.openPct >= 0;

  return (
    <div className={styles.tapeRow} data-divergent={surprise ? "1" : "0"}>
      <span className={styles.tapeRank} style={{ fontSize: sizes.rank }}>
        {String(rank).padStart(2, "0")}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className={styles.tapeLogo}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        src={logoSrc}
        style={{ width: sizes.logo, height: sizes.logo }}
      />
      <div className={styles.tapeBody}>
        <div className={styles.tapeRowTop}>
          <div className={styles.tapeIdentity}>
            <div className={styles.tapeTicker} style={{ fontSize: sizes.ticker }}>
              ${cashtag(fixture.ticker)}
            </div>
            <div className={styles.tapeCompany} style={{ fontSize: sizes.company }}>
              {fixture.company}
            </div>
            <div className={styles.tapeSlot} style={{ fontSize: sizes.slot }}>
              {fixture.reportSlot} · {fixture.reportDateLabel}
            </div>
          </div>
          <div className={styles.tapeVerdicts}>
            <VerdictPill verdict={fixture.eps.verdict} label={`EPS ${verdictText(fixture.eps.verdict)}`} />
            <VerdictPill verdict={fixture.rev.verdict} label={`REV ${verdictText(fixture.rev.verdict)}`} />
            <VerdictPill verdict={fixture.guidance.verdict} label={fixture.guidance.label.toUpperCase()} />
          </div>
          {surprise && <SurpriseTag label={surprise} />}
        </div>
        <div className={styles.tapeArc} style={{ fontSize: sizes.arc }}>
          <span className={styles.tapeArcLabel}>PRINT</span>
          <span className={styles.tapeArcValue} style={deltaTextStyle(printUp, accentDown)}>
            {printUp ? "▲" : "▼"} {fmtPctAbs(fixture.printPct)}
          </span>
          <span className={styles.tapeArcArrow} aria-hidden="true">→</span>
          <span className={styles.tapeArcLabel}>SETTLE</span>
          <span className={styles.tapeArcValue} style={deltaTextStyle(settleUp, accentDown)}>
            {settleUp ? "▲" : "▼"} {fmtPctAbs(fixture.settlePct)}
          </span>
          <span className={styles.tapeArcArrow} aria-hidden="true">→</span>
          <span className={styles.tapeArcLabel}>OPEN</span>
          <span className={styles.tapeArcValue} style={deltaTextStyle(openUp, accentDown)}>
            {openUp ? "▲" : "▼"} {fmtPctAbs(fixture.openPct)}
          </span>
          <CallPill hit={hit} deltaPp={callPp} />
        </div>
        <div className={styles.tapeWhy} style={{ fontSize: sizes.why }}>
          &ldquo;{fixture.whyLine}&rdquo;
        </div>
      </div>
    </div>
  );
}

const TAPE_SIZES = {
  roomy: { rank: 13, logo: 88, ticker: 38, company: 16, slot: 11, arc: 22, why: 14 },
  medium: { rank: 12, logo: 74, ticker: 32, company: 15, slot: 11, arc: 18, why: 13 },
  compact: { rank: 11, logo: 60, ticker: 26, company: 14, slot: 10, arc: 15, why: 12 },
};

function tapeDensityFor(count: number): "roomy" | "medium" | "compact" {
  if (count <= 2) return "roomy";
  if (count <= 3) return "medium";
  return "compact";
}

export function EarningsBuilder() {
  const [aspect, setAspect] = useState<Aspect>("1:1");
  const [theme, setTheme] = useState<Theme>("ink");
  const [mode, setMode] = useState<Mode>(FIXTURES.length > 1 ? "tape" : "spotlight");
  const [count, setCount] = useState<number>(Math.min(4, FIXTURES.length));
  const [accentDown] = useState("#FF5C5C");
  const [scale, setScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postHint, setPostHint] = useState<string | null>(null);
  const [logoMap, setLogoMap] = useState<Record<string, string>>({});
  const [logosReady, setLogosReady] = useState(false);
  const [showTrackRecord, setShowTrackRecord] = useState(true);

  const stageRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);

  const size = ART_SIZES[aspect];
  const sortedFixtures = useMemo(() => sortByDivergenceFirst(FIXTURES), []);
  const tapeCount = Math.max(1, Math.min(count, sortedFixtures.length));
  const tapeFixtures = useMemo(() => sortedFixtures.slice(0, tapeCount), [sortedFixtures, tapeCount]);
  const spotlight = sortedFixtures[0]!;
  const tapeDensity = tapeDensityFor(tapeCount);

  useEffect(() => {
    let cancelled = false;
    setLogosReady(false);
    Promise.all(
      FIXTURES.map(async (f): Promise<[string, string] | null> => {
        try {
          const res = await fetch(`/api/xstocks/logo?t=${encodeURIComponent(f.ticker)}`);
          if (!res.ok) return null;
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          return [f.ticker, dataUrl];
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
  }, []);

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

  const exportOptions = {
    cacheBust: true,
    pixelRatio: 2,
    width: size.width,
    height: size.height,
    backgroundColor: theme === "ink" ? "#181D1C" : "#FFFFFF",
    style: { transform: "none" },
  } as const;

  const baseSlug = mode === "spotlight"
    ? `${spotlight.ticker.toLowerCase()}-${spotlight.reportDateLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    : `tape-${SESSION.dateLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const fileSlug = `overnight-${baseSlug}`;

  function buildSpotlightText(f: EarningsFixture): string {
    const surprise = surpriseLabel(f);
    const hit = isCallHit(f);
    const callPp = callDeltaPp(f);
    const lines = [
      `Between the bells.`,
      `When TradFi closed, $${cashtag(f.ticker)} kept trading on xStocks.`,
      ``,
    ];
    if (surprise) {
      lines.push(`Surprise: ${surprise.toLowerCase()}.`);
      lines.push("");
    }
    lines.push(`Print  ${f.printPct >= 0 ? "▲" : "▼"} ${fmtPctAbs(f.printPct)}`);
    lines.push(`Settle ${f.settlePct >= 0 ? "▲" : "▼"} ${fmtPctAbs(f.settlePct)}`);
    lines.push(`NYSE   ${f.openPct >= 0 ? "▲" : "▼"} ${fmtPctAbs(f.openPct)}`);
    lines.push("");
    lines.push(`The call: ${hit ? "✓ HIT" : "✗ MISS"} — overnight off NYSE open by ${Math.abs(callPp).toFixed(1)}pp.`);
    lines.push("");
    lines.push(`Track record: ${TRACK_RECORD.hits}/${TRACK_RECORD.total} within ${TRACK_RECORD.tolerancePp}pp (${TRACK_RECORD.periodLabel}).`);
    lines.push("");
    lines.push(`When the market closes, price discovery doesn't. → xStocks`);
    return lines.join("\n");
  }

  function buildTapeText(items: EarningsFixture[]): string {
    const lines: string[] = [
      `Between the bells.`,
      `${items.length} prints last night. Here's how the overnight tape called them.`,
      ``,
    ];
    let hits = 0;
    for (const f of items) {
      const hit = isCallHit(f);
      if (hit) hits += 1;
      const arrow = (n: number) => (n >= 0 ? "▲" : "▼");
      const verdict = hit ? "✓" : "✗";
      const surprise = surpriseLabel(f);
      const tag = surprise ? ` · ${surprise.toLowerCase()}` : "";
      lines.push(`$${cashtag(f.ticker)}  print ${arrow(f.printPct)} ${fmtPctAbs(f.printPct)} → settle ${arrow(f.settlePct)} ${fmtPctAbs(f.settlePct)} → NYSE ${arrow(f.openPct)} ${fmtPctAbs(f.openPct)}  ${verdict}${tag}`);
    }
    lines.push("");
    lines.push(`Last night's call: ${hits}/${items.length} within ${TRACK_RECORD.tolerancePp}pp.`);
    lines.push(`Track record: ${TRACK_RECORD.hits}/${TRACK_RECORD.total} (${TRACK_RECORD.periodLabel}).`);
    lines.push("");
    lines.push(`When the market closes, price discovery doesn't. → xStocks`);
    return lines.join("\n");
  }

  function buildPostText(): string {
    return mode === "spotlight" ? buildSpotlightText(spotlight) : buildTapeText(tapeFixtures);
  }

  async function downloadPng() {
    if (!artRef.current) return;
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
    if (!artRef.current) return;
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
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${fileSlug}.png`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const text = buildPostText();
      const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
      window.open(intent, "_blank", "noopener,noreferrer");
      setPostHint(copied ? "Image copied — paste in the X compose window (⌘V / Ctrl+V)." : "Image downloaded — drag it into the X compose window.");
    } finally {
      setPosting(false);
    }
  }

  const brandLockupSrc = theme === "ink" ? BRAND_LOCKUP.ink : BRAND_LOCKUP.paper;

  // Headline copy adapts by mode but always anchors to the dark window claim.
  const headlineLine1 = "Between the bells.";
  const headlineLine2 = mode === "spotlight"
    ? `${spotlight.company}, on-chain.`
    : `${tapeCount} prints, on-chain.`;

  return (
    <main className={shell.builder}>
      <section className={shell.stage} ref={stageRef}>
        <div
          className={shell.artFrame}
          style={{
            width: size.width * scale,
            height: size.height * scale,
          }}
        >
          <div
            className={shell.art}
            data-aspect={aspect}
            data-theme={theme}
            ref={artRef}
            style={{
              width: size.width,
              height: size.height,
              transform: `scale(${scale})`,
              "--up": "#1FD59A",
              "--down": accentDown,
            } as CSSProperties}
          >
            <span className={`${shell.corner} ${shell.tl}`} />
            <span className={`${shell.corner} ${shell.tr}`} />
            <span className={`${shell.corner} ${shell.bl}`} />
            <span className={`${shell.corner} ${shell.br}`} />

            <div className={shell.artTop}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="xStocks" className={shell.brandmark} src={brandLockupSrc} style={{ height: 24 }} />
              <span className={shell.meta}>{SESSION.dateLabel}</span>
            </div>

            <div className={shell.artHead}>
              <div className={shell.kicker}>
                <span className={shell.seqBadge}>
                  <XMark size={12} />
                  OVERNIGHT / {mode === "spotlight" ? "SPOTLIGHT" : "TAPE"}
                </span>
              </div>
              <SessionPill />
              <h1 className={shell.display} style={{ fontSize: aspect === "16:9" ? 56 : 64, marginTop: 18 }}>
                {headlineLine1}
                <br />
                <span>{headlineLine2}</span>
              </h1>
            </div>

            <div className={shell.gradientRule} />

            {mode === "spotlight" ? (
              <div className={styles.viz}>
                <div className={styles.hero}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className={styles.heroLogo}
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    src={logoMap[spotlight.ticker] ?? `/api/xstocks/logo?t=${spotlight.ticker}`}
                  />
                  <div className={styles.heroMeta}>
                    <div className={styles.heroTicker}>${cashtag(spotlight.ticker)}</div>
                    <div className={styles.heroCompany}>{spotlight.company}</div>
                    <div className={styles.heroSlot}>
                      {spotlight.reportSlot} · {spotlight.reportDateLabel}
                    </div>
                    <div className={styles.heroVerdictRow}>
                      <VerdictPill verdict={spotlight.eps.verdict} label={`EPS ${verdictText(spotlight.eps.verdict)}`} />
                      <VerdictPill verdict={spotlight.rev.verdict} label={`REV ${verdictText(spotlight.rev.verdict)}`} />
                      <VerdictPill verdict={spotlight.guidance.verdict} label={spotlight.guidance.label.toUpperCase()} />
                    </div>
                    {surpriseLabel(spotlight) && (
                      <div className={styles.heroSurpriseRow}>
                        <SurpriseTag label={surpriseLabel(spotlight)!} />
                      </div>
                    )}
                    <div className={styles.heroWhy}>&ldquo;{spotlight.whyLine}&rdquo;</div>
                  </div>
                </div>

                <div className={styles.arcStrip}>
                  <ArcBox label="POST-PRINT" pct={spotlight.printPct} stamp={spotlight.printStamp} accentDown={accentDown} />
                  <span className={styles.arcStripArrow} aria-hidden="true">→</span>
                  <ArcBox label="SETTLE" pct={spotlight.settlePct} stamp={spotlight.settleStamp} emphasize accentDown={accentDown} />
                  <span className={styles.arcStripArrow} aria-hidden="true">→</span>
                  <ArcBox label="NYSE OPEN" pct={spotlight.openPct} stamp={spotlight.openStamp} accentDown={accentDown} />
                </div>

                <div className={styles.callRow}>
                  <div className={styles.callRowText}>
                    <span className={styles.callRowLabel}>THE CALL</span>
                    <span className={styles.callRowBody}>
                      xStocks overnight settle → realized NYSE open
                    </span>
                  </div>
                  <CallPill hit={isCallHit(spotlight)} deltaPp={callDeltaPp(spotlight)} />
                </div>

                <div className={styles.metaStrip}>
                  <span>HL OI shift / {spotlight.hlOiShift}</span>
                  <span>xDepth / {spotlight.xDepth}</span>
                </div>
              </div>
            ) : (
              <div className={styles.tape}>
                {tapeFixtures.map((f, i) => (
                  <TapeRow
                    key={f.ticker}
                    fixture={f}
                    rank={i + 1}
                    logoSrc={logoMap[f.ticker] ?? `/api/xstocks/logo?t=${f.ticker}`}
                    accentDown={accentDown}
                    density={tapeDensity}
                  />
                ))}
              </div>
            )}

            {showTrackRecord && <TrackRecordLine />}

            <div className={shell.artBottom}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="xStocks" className={shell.brandmark} src={brandLockupSrc} style={{ height: 20 }} />
            </div>
          </div>
        </div>
      </section>

      <aside className={shell.controls}>
        <header className={shell.controlsHeader}>
          <SlidersHorizontal size={16} />
          <span>The Overnight Tape</span>
        </header>

        <TemplateNav />

        <div className={shell.actionRow}>
          <button
            className={shell.downloadButton}
            disabled={downloading || !logosReady}
            type="button"
            onClick={downloadPng}
          >
            <Download size={16} />
            {downloading ? "Rendering" : !logosReady ? "Loading logos" : "Download PNG"}
          </button>
          <button
            className={shell.postButton}
            disabled={posting || !logosReady}
            type="button"
            onClick={postOnX}
          >
            <Send size={16} />
            {posting ? "Preparing" : !logosReady ? "Loading logos" : "Post on X"}
          </button>
        </div>
        {postHint && <div className={shell.postHint}>{postHint}</div>}

        <div className={shell.controlGroup}>
          <h2>Mode</h2>
          <div className={shell.segmented}>
            {(["spotlight", "tape"] as Mode[]).map((value) => (
              <button
                key={value}
                aria-pressed={mode === value}
                type="button"
                onClick={() => setMode(value)}
              >
                {value === "spotlight" ? "Spotlight" : "Tape"}
              </button>
            ))}
          </div>
          {mode === "tape" && (
            <label className={shell.sliderRow}>
              <span>Count</span>
              <strong>{tapeCount}</strong>
              <input
                max={sortedFixtures.length}
                min={1}
                step={1}
                type="range"
                value={tapeCount}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </label>
          )}
          <label className={shell.toggleRow}>
            <span>Track record line</span>
            <input
              type="checkbox"
              checked={showTrackRecord}
              onChange={(event) => setShowTrackRecord(event.target.checked)}
            />
          </label>
        </div>

        <div className={shell.controlGroup}>
          <h2>Layout</h2>
          <div className={shell.segmented}>
            {(["1:1", "16:9", "4:5"] as Aspect[]).map((value) => (
              <button
                key={value}
                aria-pressed={aspect === value}
                type="button"
                onClick={() => setAspect(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className={shell.segmented}>
            {(["ink", "paper"] as Theme[]).map((value) => (
              <button
                key={value}
                aria-pressed={theme === value}
                type="button"
                onClick={() => setTheme(value)}
              >
                {value === "ink" ? "Ink" : "Paper"}
              </button>
            ))}
          </div>
        </div>

        <div className={shell.controlGroup}>
          <h2>Fixtures</h2>
          <p className={styles.fixtureNote}>
            Hardcoded ({FIXTURES.length} prints). Auto-ranked: <strong>divergent prints first</strong> (beat-but-sold / miss-but-bought), then by settle magnitude. Edit <code>FIXTURES</code> and <code>SESSION</code> at the top of <code>earnings-builder.tsx</code> before each post.
          </p>
        </div>
      </aside>
    </main>
  );
}
