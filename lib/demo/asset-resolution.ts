import { DEMO_SPACE_SLUG, isDemoSpaceSlug } from "@/lib/demo/constants";
import {
  DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL,
  getDemoCanonicalPoolKey,
  getDemoSourcePoolKey,
  getPoolsForSpace,
} from "@/lib/pools";
import type { DashboardView } from "@/stores/token-view-store";

const DEMO_CONFIG_ENTRIES = Object.entries(DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL);

function normalizeSymbol(value?: string | null): string {
  return value?.trim().toUpperCase().replace(/\.E$/, "") ?? "";
}

function sourceSymbolAliases(sourceSymbol: string): string[] {
  return sourceSymbol.endsWith("x")
    ? [sourceSymbol, sourceSymbol.slice(0, -1)]
    : [sourceSymbol];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isDemoVisibleAssetSymbol(symbol?: string | null): boolean {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return false;
  return DEMO_CONFIG_ENTRIES.some(([, config]) =>
    [config.symbol, ...(config.legacySymbols ?? [])].some(
      (alias) => normalizeSymbol(alias) === normalized
    )
  );
}

export function getDemoAssetSymbol(symbol?: string | null): string | null {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;

  for (const [sourceSymbol, config] of DEMO_CONFIG_ENTRIES) {
    const aliases = [
      ...sourceSymbolAliases(sourceSymbol),
      config.symbol,
      ...(config.legacySymbols ?? []),
    ];
    if (aliases.some((alias) => normalizeSymbol(alias) === normalized)) {
      return config.symbol;
    }
  }

  return null;
}

export function resolveDemoPoolKeyForInput(poolKey?: string | null): string | null {
  const raw = poolKey?.trim();
  if (!raw) return null;

  const canonical = getDemoCanonicalPoolKey(raw);
  if (canonical) return canonical;

  const normalized = raw.toLowerCase();
  const match = getPoolsForSpace(DEMO_SPACE_SLUG).find((pool) => {
    if (pool.poolKey.toLowerCase() === normalized) return true;
    const sourcePoolKey = getDemoSourcePoolKey(pool.poolKey);
    return sourcePoolKey?.toLowerCase() === normalized;
  });

  return match?.poolKey ?? null;
}

function resolveDemoRfqAssetView<TKind extends DashboardView["kind"]>(
  kind: TKind,
  asset: string
): DashboardView {
  const demoAsset = getDemoAssetSymbol(asset);
  return demoAsset ? ({ kind, asset: demoAsset } as DashboardView) : { kind: "birds-eye" };
}

export function resolveDashboardViewForSpace(
  view: DashboardView,
  spaceSlug?: string | null
): DashboardView {
  if (!isDemoSpaceSlug(spaceSlug)) return view;

  if (view.kind === "token") {
    const demoAsset = getDemoAssetSymbol(view.symbol);
    return demoAsset ? { kind: "token", symbol: demoAsset } : { kind: "birds-eye" };
  }

  if (view.kind === "rfq") {
    const demoPoolKey = resolveDemoPoolKeyForInput(view.poolKey);
    return demoPoolKey ? { kind: "rfq", poolKey: demoPoolKey } : { kind: "birds-eye" };
  }

  if (
    view.kind === "rfq-cowswap" ||
    view.kind === "rfq-bebop" ||
    view.kind === "rfq-0x" ||
    view.kind === "rfq-1inch" ||
    view.kind === "rfq-jupz"
  ) {
    return resolveDemoRfqAssetView(view.kind, view.asset);
  }

  return view;
}

export function resolveSelectedTokenForSpace(
  selectedTokenSymbol: string | null,
  dashboardView: DashboardView,
  spaceSlug?: string | null
): string | null {
  if (!isDemoSpaceSlug(spaceSlug)) {
    return selectedTokenSymbol;
  }

  if (dashboardView.kind !== "token") return null;
  return getDemoAssetSymbol(dashboardView.symbol);
}

export function resolvePoolKeyForSpace(
  poolKey: string | null | undefined,
  spaceSlug?: string | null
): string | null {
  if (!poolKey) return null;
  if (!isDemoSpaceSlug(spaceSlug)) return poolKey;
  return resolveDemoPoolKeyForInput(poolKey);
}

export function containsRealXStockDemoSource(value: string): boolean {
  return DEMO_CONFIG_ENTRIES.some(([sourceSymbol]) =>
    sourceSymbolAliases(sourceSymbol).some((alias) =>
      new RegExp(`\\b${escapeRegex(alias)}\\b`).test(value)
    )
  );
}
