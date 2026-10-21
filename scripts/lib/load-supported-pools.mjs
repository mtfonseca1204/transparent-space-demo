import fs from "fs/promises";
import path from "path";

import ts from "typescript";

export async function loadSupportedPools(cwd = process.cwd()) {
  const sourcePath = path.resolve(cwd, "lib/pools.ts");
  const source = await fs.readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  const loadedModule = await import(moduleUrl);

  if (!Array.isArray(loadedModule.SUPPORTED_POOLS)) {
    throw new Error(`SUPPORTED_POOLS not found in ${sourcePath}`);
  }

  return loadedModule.SUPPORTED_POOLS.map((pool) => ({
    key: String(pool.key),
    label: String(pool.label),
    poolKey: String(pool.poolKey),
    protocol: String(pool.protocol),
    chain: pool.chain ? String(pool.chain) : null,
    spaceSlug: String(pool.spaceSlug),
  }));
}
