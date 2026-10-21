#!/usr/bin/env node

import path from "path";

import {
  buildAuditReport,
  collectAuditSnapshot,
  poolKeyToFilename,
  writeSnapshotFile,
} from "./lib/pool-health-audit.mjs";

const DEFAULT_BASE_URL =
  process.env.POOL_AUDIT_BASE_URL?.trim() || "https://app.transparent.space";

const TARGET_POOLS = [
  {
    label: "WLD / USDC",
    poolKey: "0x610e319b3a3ab56a0ed5562927d37c233774ba39",
    role: "golden",
  },
  {
    label: "WBTC / USDC",
    poolKey: "0xdce053d9ba0fa2c5f772416b64f191158cbcc32e",
    role: "lote1",
  },
  {
    label: "ETH / MADS",
    poolKey: "0x10b3bf9cd0689c4581875b29ce5f106ae6188064",
    role: "lote1",
  },
  {
    label: "wARS / USDC",
    poolKey: "480-v4-0xe7bba98b4e9c077d0af3b91b4ecfcdc68e3214917ed4e361ed28eb60e87ea6fa",
    role: "lote1",
  },
];

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    windowDays: 7,
    snapshotDir: "",
    includeRaw: false,
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
    if (flag === "--window-days") {
      const parsed = Number(nextValue());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--window-days must be a positive number.");
      }
      args.windowDays = Math.max(1, Math.floor(parsed));
      continue;
    }
    if (flag === "--snapshot-dir") {
      args.snapshotDir = nextValue();
      continue;
    }
    if (flag === "--include-raw") {
      args.includeRaw = true;
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
    "  npm run audit:lote1-smoke -- [--base-url <url>] [--window-days <days>] [--snapshot-dir <path>] [--include-raw]",
    "",
    "Examples:",
    "  npm run audit:lote1-smoke -- --base-url https://app.transparent.space",
    "  npm run audit:lote1-smoke -- --base-url https://app.transparent.space --snapshot-dir /tmp/ts-lote1-smoke",
  ].join("\n");
}

function formatCounts(counts) {
  return `ok=${counts.ok} degraded=${counts.degraded} broken=${counts.broken} unsupported=${counts.unsupported} not_rendered=${counts.not_rendered}`;
}

function collectUnexpectedCharts(report) {
  return report.charts.filter((chart) => {
    if (chart.id === "inventory") {
      return chart.status !== "not_rendered";
    }
    return chart.status !== "ok";
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(formatUsage());
    return 0;
  }

  const failures = [];

  for (const target of TARGET_POOLS) {
    const snapshot = await collectAuditSnapshot({
      poolKey: target.poolKey,
      baseUrl: args.baseUrl,
      windowDays: args.windowDays,
      includeRaw: args.includeRaw,
    });

    if (args.snapshotDir) {
      const filename = poolKeyToFilename(target.poolKey, "snapshot.json");
      await writeSnapshotFile(path.join(args.snapshotDir, filename), snapshot);
    }

    const report = buildAuditReport(snapshot);
    const unexpectedCharts = collectUnexpectedCharts(report);

    console.log(
      `[${target.role}] ${target.label} ${report.summary.overallStatus} ${formatCounts(report.summary.counts)}`,
    );

    if (unexpectedCharts.length > 0) {
      failures.push({
        target,
        report,
        unexpectedCharts,
      });
    }
  }

  if (failures.length === 0) {
    console.log("");
    console.log("Lote 1 smoke passed: golden pool and all target pools are fully healthy under the current auditor logic.");
    console.log("This validates live data from the target base URL against the local branch logic without running a local frontend/backend.");
    return 0;
  }

  console.log("");
  console.log("Lote 1 smoke failed:");
  for (const failure of failures) {
    console.log(`- ${failure.target.label} (${failure.target.poolKey})`);
    console.log(`  Overall: ${failure.report.summary.overallStatus}`);
    for (const chart of failure.unexpectedCharts) {
      console.log(`  ${chart.title}: ${chart.status}`);
    }
  }
  return 1;
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
