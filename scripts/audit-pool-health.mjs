#!/usr/bin/env node

import { runCli } from "./lib/pool-health-audit.mjs";

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;
