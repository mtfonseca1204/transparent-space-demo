#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";

import {
  buildAuditReport,
  collectAuditSnapshot,
  formatUsage as formatPoolUsage,
  poolKeyToFilename,
  readSnapshotFile,
  writeJsonReport,
  writeSnapshotFile,
} from "./lib/pool-health-audit.mjs";
import { loadSupportedPools } from "./lib/load-supported-pools.mjs";

const DEFAULT_BASE_URL =
  process.env.POOL_AUDIT_BASE_URL?.trim() || "https://app.transparent.space";
const STATUS_SEVERITY = {
  ok: 0,
  not_rendered: 0,
  unsupported: 0,
  degraded: 1,
  broken: 2,
};

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    jsonDir: "",
    snapshotDir: "",
    snapshotInputDir: "",
    compareDir: "",
    windowDays: 7,
    includeRaw: false,
    failOn: [],
    spaceSlugs: [],
    poolKeys: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Flag ${flag} requires a value.`);
      }
      index += 1;
      return value;
    };

    if (flag === "--base-url") {
      args.baseUrl = nextValue();
      continue;
    }
    if (flag === "--json-dir") {
      args.jsonDir = nextValue();
      continue;
    }
    if (flag === "--snapshot-dir") {
      args.snapshotDir = nextValue();
      continue;
    }
    if (flag === "--snapshot-input-dir") {
      args.snapshotInputDir = nextValue();
      continue;
    }
    if (flag === "--compare-dir") {
      args.compareDir = nextValue();
      continue;
    }
    if (flag === "--window-days") {
      const parsed = Number(nextValue());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--window-days must be a positive number.");
      }
      args.windowDays = Math.max(1, Math.floor(parsed));
      continue;
    }
    if (flag === "--include-raw") {
      args.includeRaw = true;
      continue;
    }
    if (flag === "--space") {
      args.spaceSlugs.push(...splitCsv(nextValue()));
      continue;
    }
    if (flag === "--pool") {
      args.poolKeys.push(...splitCsv(nextValue()));
      continue;
    }
    if (flag.startsWith("--fail-on=")) {
      args.failOn = splitCsv(flag.slice("--fail-on=".length));
      continue;
    }
    if (flag === "--fail-on") {
      args.failOn = splitCsv(nextValue());
      continue;
    }
    if (flag === "-h" || flag === "--help") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown flag: ${flag}`);
  }

  return args;
}

function formatUsage() {
  return [
    "Usage:",
    "  npm run audit:all-pools -- --json-dir <path> [--base-url <url>] [--snapshot-dir <path>] [--space worldchain]",
    "  npm run audit:all-pools -- --json-dir <path> --snapshot-input-dir <path> [--compare-dir <path>] [--fail-on broken,degraded]",
    "",
    "Examples:",
    "  npm run audit:all-pools -- --json-dir /tmp/ts-health-before --base-url https://app.transparent.space",
    "  npm run audit:all-pools -- --json-dir /tmp/ts-health-targets --snapshot-input-dir /tmp/ts-worldchain-snapshots --space worldchain",
    "  npm run audit:all-pools -- --json-dir /tmp/ts-health-after --snapshot-input-dir /tmp/ts-worldchain-snapshots --compare-dir /tmp/ts-health-before --fail-on broken,degraded",
    "",
    "Single-pool auditor:",
    formatPoolUsage(),
  ].join("\n");
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePath(value) {
  return value ? path.resolve(value) : "";
}

async function ensureDir(dirPath) {
  if (!dirPath) return;
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonFile(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function severity(status) {
  return STATUS_SEVERITY[status] ?? 0;
}

function compareReports(beforeReport, afterReport) {
  if (!beforeReport) {
    return {
      overallBefore: null,
      overallAfter: afterReport.summary.overallStatus,
      worsenedCharts: [],
      improvedCharts: [],
      unchanged: false,
      missingBaseline: true,
    };
  }

  const beforeById = Object.fromEntries(beforeReport.charts.map((chart) => [chart.id, chart]));
  const afterById = Object.fromEntries(afterReport.charts.map((chart) => [chart.id, chart]));
  const worsenedCharts = [];
  const improvedCharts = [];

  for (const chart of afterReport.charts) {
    const previous = beforeById[chart.id];
    if (!previous) continue;
    if (severity(chart.status) > severity(previous.status)) {
      worsenedCharts.push({
        id: chart.id,
        title: chart.title,
        before: previous.status,
        after: chart.status,
      });
      continue;
    }
    if (severity(chart.status) < severity(previous.status)) {
      improvedCharts.push({
        id: chart.id,
        title: chart.title,
        before: previous.status,
        after: chart.status,
      });
    }
  }

  return {
    overallBefore: beforeReport.summary.overallStatus,
    overallAfter: afterReport.summary.overallStatus,
    worsenedCharts,
    improvedCharts,
    unchanged: worsenedCharts.length === 0 && improvedCharts.length === 0,
    missingBaseline: false,
  };
}

async function readExistingReport(reportDir, poolKey) {
  if (!reportDir) return null;
  const primary = path.join(reportDir, poolKeyToFilename(poolKey, "report.json"));
  const fallback = path.join(reportDir, poolKeyToFilename(poolKey, "json"));

  for (const candidate of [primary, fallback]) {
    try {
      const content = await fs.readFile(candidate, "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return null;
}

async function readSnapshotFromDir(snapshotDir, poolKey) {
  const primary = path.join(snapshotDir, poolKeyToFilename(poolKey, "snapshot.json"));
  const fallback = path.join(snapshotDir, poolKeyToFilename(poolKey, "json"));

  for (const candidate of [primary, fallback]) {
    try {
      return await readSnapshotFile(candidate);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Snapshot not found for ${poolKey} in ${snapshotDir}`);
}

function formatCounts(counts) {
  return `ok=${counts.ok} degraded=${counts.degraded} broken=${counts.broken} unsupported=${counts.unsupported} not_rendered=${counts.not_rendered}`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(formatUsage());
    return 0;
  }

  if (!args.jsonDir) {
    console.error("Missing required flag: --json-dir");
    console.error("");
    console.error(formatUsage());
    return 1;
  }

  const jsonDir = normalizePath(args.jsonDir);
  const snapshotDir = normalizePath(args.snapshotDir);
  const snapshotInputDir = normalizePath(args.snapshotInputDir);
  const compareDir = normalizePath(args.compareDir);

  await ensureDir(jsonDir);
  if (snapshotDir) {
    await ensureDir(snapshotDir);
  }

  const allPools = await loadSupportedPools(process.cwd());
  const poolKeyFilter = new Set(args.poolKeys.map((poolKey) => poolKey.toLowerCase()));
  const spaceFilter = new Set(args.spaceSlugs);
  const pools = allPools.filter((pool) => {
    if (spaceFilter.size > 0 && !spaceFilter.has(pool.spaceSlug)) {
      return false;
    }
    if (poolKeyFilter.size > 0 && !poolKeyFilter.has(pool.poolKey.toLowerCase())) {
      return false;
    }
    return true;
  });

  if (pools.length === 0) {
    throw new Error("No pools matched the current filters.");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    jsonDir,
    snapshotDir: snapshotDir || null,
    snapshotInputDir: snapshotInputDir || null,
    compareDir: compareDir || null,
    windowDays: args.windowDays,
    includeRaw: args.includeRaw,
    pools: [],
    countsByOverallStatus: {
      ok: 0,
      degraded: 0,
      broken: 0,
      unsupported: 0,
      not_rendered: 0,
    },
  };
  const diff = {
    comparedAgainst: compareDir || null,
    worsenedPools: [],
    improvedPools: [],
    unchangedPools: [],
    missingBaselinePools: [],
  };

  let sawFailOnStatus = false;
  let sawWorsenedPool = false;

  for (const pool of pools) {
    const snapshot = snapshotInputDir
      ? await readSnapshotFromDir(snapshotInputDir, pool.poolKey)
      : await collectAuditSnapshot({
          poolKey: pool.poolKey,
          baseUrl: args.baseUrl,
          windowDays: args.windowDays,
          includeRaw: args.includeRaw,
        });

    if (snapshotDir && !snapshotInputDir) {
      await writeSnapshotFile(
        path.join(snapshotDir, poolKeyToFilename(pool.poolKey, "snapshot.json")),
        snapshot,
      );
    }

    const report = buildAuditReport(snapshot);
    const reportPath = path.join(jsonDir, poolKeyToFilename(pool.poolKey, "report.json"));
    await writeJsonReport(reportPath, report);

    const poolSummary = {
      key: pool.key,
      label: pool.label,
      poolKey: pool.poolKey,
      protocol: pool.protocol,
      chain: pool.chain,
      spaceSlug: pool.spaceSlug,
      overallStatus: report.summary.overallStatus,
      counts: report.summary.counts,
      reportPath,
      snapshotPath:
        snapshotDir && !snapshotInputDir
          ? path.join(snapshotDir, poolKeyToFilename(pool.poolKey, "snapshot.json"))
          : null,
    };
    summary.pools.push(poolSummary);
    summary.countsByOverallStatus[report.summary.overallStatus] += 1;

    if (args.failOn.some((status) => report.summary.counts[status] > 0)) {
      sawFailOnStatus = true;
    }

    const previousReport = await readExistingReport(compareDir, pool.poolKey);
    const comparison = compareReports(previousReport, report);
    if (comparison.missingBaseline) {
      diff.missingBaselinePools.push({
        poolKey: pool.poolKey,
        label: pool.label,
      });
    } else if (comparison.worsenedCharts.length > 0) {
      sawWorsenedPool = true;
      diff.worsenedPools.push({
        poolKey: pool.poolKey,
        label: pool.label,
        overallBefore: comparison.overallBefore,
        overallAfter: comparison.overallAfter,
        worsenedCharts: comparison.worsenedCharts,
      });
    } else if (comparison.improvedCharts.length > 0) {
      diff.improvedPools.push({
        poolKey: pool.poolKey,
        label: pool.label,
        overallBefore: comparison.overallBefore,
        overallAfter: comparison.overallAfter,
        improvedCharts: comparison.improvedCharts,
      });
    } else if (!comparison.missingBaseline) {
      diff.unchangedPools.push({
        poolKey: pool.poolKey,
        label: pool.label,
        overallBefore: comparison.overallBefore,
        overallAfter: comparison.overallAfter,
      });
    }

    console.log(
      `[${pool.spaceSlug}] ${pool.label} ${report.summary.overallStatus} ${formatCounts(report.summary.counts)}`,
    );
  }

  const summaryPath = path.join(jsonDir, "summary.json");
  const diffPath = path.join(jsonDir, "diff.json");
  await writeJsonFile(summaryPath, summary);
  await writeJsonFile(diffPath, diff);

  console.log("");
  console.log(`Summary: ${summaryPath}`);
  console.log(`Diff: ${diffPath}`);
  console.log(
    `Overall pools: ok=${summary.countsByOverallStatus.ok} degraded=${summary.countsByOverallStatus.degraded} broken=${summary.countsByOverallStatus.broken} unsupported=${summary.countsByOverallStatus.unsupported} not_rendered=${summary.countsByOverallStatus.not_rendered}`,
  );

  if (diff.comparedAgainst) {
    console.log(
      `Diff summary: worsened=${diff.worsenedPools.length} improved=${diff.improvedPools.length} unchanged=${diff.unchangedPools.length} missing_baseline=${diff.missingBaselinePools.length}`,
    );
  }

  if (sawFailOnStatus) {
    return 1;
  }
  if (compareDir && sawWorsenedPool) {
    return 1;
  }
  return 0;
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
