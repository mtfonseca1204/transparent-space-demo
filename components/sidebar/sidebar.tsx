"use client";

import React, { useCallback, useMemo, useState } from "react";
import { SettingsIcon, ChevronRight, Search, LogOut, Moon, Sun, RefreshCw, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/lib/auth-store";
import { usePoolStore } from "@/stores/pool-store";
import { useTokenViewStore } from "@/stores/token-view-store";
import {
  getSolanaPoolMetadata,
  inferPoolProtocol,
  isWorldchainSolanaSupportedPool,
  normalizePoolKey,
} from "@/lib/pools";
import type { SupportedPool } from "@/lib/pools";
import { TokenIcon } from "@/components/dashboard/pool-header";
import { useIndexerPools } from "@/hooks/use-indexer-pools";
import { useTokenMeta } from "@/hooks/use-token-meta";
import {
  getRfqHistoryQueryOptions,
  getRfqLatestQueryOptions,
} from "@/hooks/use-rfq-data";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { AdminPanel } from "@/components/admin/admin-panel";
import {
  ASSET_ORDER,
  getTrackedAsset,
  getTrackedAssetForPool,
  normalizeTrackedAssetSymbol,
} from "@/lib/token-utils";
import {
  isPoolsDirectorySpace,
  isRfqDirectorySpace,
  isRfqDisabledSpace,
} from "@/lib/space-policy";
import { isDemoSpaceSlug } from "@/lib/demo/constants";
import {
  sidebarAssetRowClass,
  sidebarCollapsedGlyphClass,
  sidebarNavRowClass,
  sidebarTreeItemClass,
} from "@/lib/demo/sidebar-ui";

// ─── Brand mark SVG (reticle, matches v7 spec) ──────────────────────────────

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <rect x="18.5" y="2.5" width="43" height="43" />
      <rect x="10.5" y="10.5" width="43" height="43" />
      <rect x="2.5" y="18.5" width="43" height="43" />
    </svg>
  );
}

// ─── Sidebar root ───────────────────────────────────────────────────────────

export const Sidebar = () => {
  const isOpen = useSidebarStore((state) => state.isOpen);
  const toggle = useSidebarStore((state) => state.toggle);
  const email = useAuthStore((state) => state.email);
  const role = useAuthStore((state) => state.role);
  const spaces = useAuthStore((state) => state.spaces);
  const currentSpaceId = useAuthStore((state) => state.currentSpaceId);
  const logout = useAuthStore((state) => state.logout);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supportedPools = usePoolStore((s) => s.supportedPools);
  const selectedPoolKey = usePoolStore((s) => s.selectedPoolKey);
  const [poolSearch, setPoolSearch] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const selectedTokenSymbol = useTokenViewStore((s) => s.selectedTokenSymbol);
  const setSelectedToken = useTokenViewStore((s) => s.setSelectedToken);
  const dashboardView = useTokenViewStore((s) => s.dashboardView);
  const setRfqView = useTokenViewStore((s) => s.setRfqView);
  const setRfqCowswapView = useTokenViewStore((s) => s.setRfqCowswapView);
  const setRfqBebopView = useTokenViewStore((s) => s.setRfqBebopView);
  const setRfq0xView = useTokenViewStore((s) => s.setRfq0xView);
  const setRfq1inchView = useTokenViewStore((s) => s.setRfq1inchView);
  const setRfqJupzView = useTokenViewStore((s) => s.setRfqJupzView);
  const setBirdsEyeView = useTokenViewStore((s) => s.setBirdsEyeView);
  const queryClient = useQueryClient();

  const currentSpace = spaces.find((s) => s.id === currentSpaceId);
  const isDemoShowcase = isDemoSpaceSlug(currentSpace?.slug);
  const isAdmin = role === "admin";
  const hasPoolsDirectory = isPoolsDirectorySpace(currentSpace?.slug);
  const hasRfqDirectory = isRfqDirectorySpace(currentSpace?.slug);
  const isPoolsRoute = pathname.endsWith("/pools");
  const isRfqRoute = pathname.endsWith("/rfq");
  const dashboardPath = currentSpace?.slug ? `/${currentSpace.slug}` : "/";
  const hasPoolsInSpace = supportedPools.length > 0;

  const { data: v4Pools } = useIndexerPools({ protocol: "v4", limit: 50 });

  type SidebarPoolRow =
    | (SupportedPool & { kind: "static" })
    | {
        kind: "indexer";
        key: string;
        poolKey: string;
        protocol: "v2" | "v3" | "v4" | "raydium";
        token0: string;
        token1: string;
      };

  const isWorldchain = currentSpace?.slug === "worldchain";
  const isRfqDisabled = isRfqDisabledSpace(currentSpace?.slug);

  const mergedPools = useMemo<SidebarPoolRow[]>(() => {
    const base: SidebarPoolRow[] = supportedPools.map((p) => ({ ...p, kind: "static" as const }));
    if (!isWorldchain) return base;
    const v4: SidebarPoolRow[] = (v4Pools ?? []).map((p) => ({
      kind: "indexer" as const,
      key: p.id,
      poolKey: p.id.toLowerCase(),
      protocol: "v4",
      token0: p.token0,
      token1: p.token1,
    }));
    const byKey = new Map<string, SidebarPoolRow>();
    for (const row of v4) byKey.set(row.poolKey, row);
    for (const row of base) byKey.set(row.poolKey, row);
    return [...byKey.values()];
  }, [supportedPools, v4Pools, isWorldchain]);

  const filteredPools = useMemo<SidebarPoolRow[]>(() => {
    const q = poolSearch.trim().toLowerCase();
    if (!q) return mergedPools;
    return mergedPools.filter((p) => {
      const hay =
        p.kind === "static"
          ? `${p.label} ${p.key} ${p.poolKey} ${p.protocol}`.toLowerCase()
          : `${p.poolKey} ${p.token0} ${p.token1} ${p.protocol}`.toLowerCase();
      return hay.includes(q);
    });
  }, [mergedPools, poolSearch]);

  type AssetGroup = {
    trackedAsset: string;
    originalSymbol: string;
    pools: SidebarPoolRow[];
  };

  const groupedAssets = useMemo<AssetGroup[]>(() => {
    const groups = new Map<string, SidebarPoolRow[]>();
    const originalSymbols = new Map<string, string>();

    for (const pool of filteredPools) {
      const { symbol } =
        pool.kind === "static"
          ? getTrackedAssetForPool(pool)
          : getTrackedAsset(pool.token0, pool.token1);
      const normalizedSymbol = normalizeTrackedAssetSymbol(symbol);

      if (!groups.has(normalizedSymbol)) {
        groups.set(normalizedSymbol, []);
        originalSymbols.set(normalizedSymbol, symbol);
      }
      groups.get(normalizedSymbol)!.push(pool);
    }

    const result: AssetGroup[] = [];
    for (const [asset, pools] of groups) {
      result.push({ trackedAsset: asset, originalSymbol: originalSymbols.get(asset) || asset, pools });
    }

    return result.sort((a, b) => {
      const aIndex = ASSET_ORDER.indexOf(a.trackedAsset.toUpperCase());
      const bIndex = ASSET_ORDER.indexOf(b.trackedAsset.toUpperCase());
      const aPos = aIndex === -1 ? 999 : aIndex;
      const bPos = bIndex === -1 ? 999 : bIndex;
      return aPos - bPos;
    });
  }, [filteredPools]);

  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(() => new Set<string>());

  const pushToDashboard = useCallback(
    (nextParams?: URLSearchParams) => {
      const target = nextParams?.toString()
        ? `${dashboardPath}?${nextParams.toString()}`
        : dashboardPath;
      router.push(target);
    },
    [dashboardPath, router]
  );

  const handleAssetClick = (asset: UnifiedAssetGroup) => {
    const normalized = asset.trackedAsset;
    const isCurrentlySelected =
      selectedTokenSymbol?.toUpperCase().replace(/\.E$/, "") === normalized;

    if (isCurrentlySelected) {
      setSelectedToken(null);
      setExpandedAssets((prev) => {
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
    } else {
      setSelectedToken(asset.originalSymbol);
      setExpandedAssets((prev) => new Set(prev).add(normalized));
    }

    if (pathname !== dashboardPath) {
      const next = new URLSearchParams(searchParams.toString());
      pushToDashboard(next);
    }
  };

  const handleToggleExpansion = (asset: UnifiedAssetGroup) => {
    const normalized = asset.trackedAsset;
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  };

  // ─── RFQ Section ──────────────────────────────────────────────────────────
  const rfqPools = useMemo(() => {
    if (isRfqDisabled) return [];
    return supportedPools.filter(
      (p) => (p.protocol === "raydium" || p.protocol === "meteora") && p.chain === "solana"
    );
  }, [isRfqDisabled, supportedPools]);

  const rfqGroupedAssets = useMemo<AssetGroup[]>(() => {
    const groups = new Map<string, SidebarPoolRow[]>();
    const originalSymbols = new Map<string, string>();
    for (const pool of rfqPools) {
      const { symbol } = getTrackedAssetForPool(pool);
      const normalized = normalizeTrackedAssetSymbol(symbol);
      if (!groups.has(normalized)) {
        groups.set(normalized, []);
        originalSymbols.set(normalized, symbol);
      }
      groups.get(normalized)!.push({ ...pool, kind: "static" as const });
    }
    const result: AssetGroup[] = [];
    for (const [asset, pools] of groups) {
      result.push({ trackedAsset: asset, originalSymbol: originalSymbols.get(asset) || asset, pools });
    }
    return result.sort((a, b) => {
      const aPos = ASSET_ORDER.indexOf(a.trackedAsset.toUpperCase());
      const bPos = ASSET_ORDER.indexOf(b.trackedAsset.toUpperCase());
      return (aPos === -1 ? 999 : aPos) - (bPos === -1 ? 999 : bPos);
    });
  }, [rfqPools]);

  type UnifiedAssetGroup = {
    trackedAsset: string;
    originalSymbol: string;
    pools: SidebarPoolRow[];
    rfqPools: SidebarPoolRow[];
    poolCount: number;
  };

  const unifiedAssets = useMemo<UnifiedAssetGroup[]>(() => {
    const map = new Map<string, UnifiedAssetGroup>();

    for (const group of groupedAssets) {
      map.set(group.trackedAsset, {
        trackedAsset: group.trackedAsset,
        originalSymbol: group.originalSymbol,
        pools: group.pools,
        rfqPools: [],
        poolCount: group.pools.length,
      });
    }

    for (const rfqGroup of rfqGroupedAssets) {
      const existing = map.get(rfqGroup.trackedAsset);
      if (existing) {
        existing.rfqPools = rfqGroup.pools;
      } else {
        map.set(rfqGroup.trackedAsset, {
          trackedAsset: rfqGroup.trackedAsset,
          originalSymbol: rfqGroup.originalSymbol,
          pools: [],
          rfqPools: rfqGroup.pools,
          poolCount: 0,
        });
      }
    }

    return [...map.values()].sort((a, b) => {
      const aPos = ASSET_ORDER.indexOf(a.trackedAsset.toUpperCase());
      const bPos = ASSET_ORDER.indexOf(b.trackedAsset.toUpperCase());
      return (aPos === -1 ? 999 : aPos) - (bPos === -1 ? 999 : bPos);
    });
  }, [groupedAssets, rfqGroupedAssets]);

  // Auto-expand the group containing the selected pool — but only when the
  // dashboard is actually showing that pool. `selectedPoolKey` is persisted
  // across navigation, so without this guard the sidebar would expand a
  // stale group on Birds-eye / RFQ / directory views.
  React.useEffect(() => {
    if (dashboardView.kind !== "pool") return;
    for (const group of unifiedAssets) {
      if (group.pools.some((p) => p.poolKey === selectedPoolKey)) {
        setExpandedAssets((prev) => new Set(prev).add(group.trackedAsset));
        setExpandedSubSections((prev) => new Set(prev).add(`${group.trackedAsset}:pools`));
        break;
      }
    }
  }, [selectedPoolKey, unifiedAssets, dashboardView.kind]);

  const [expandedSubSections, setExpandedSubSections] = useState<Set<string>>(() => new Set<string>());

  const toggleSubSection = (asset: string, section: "pools" | "rfq") => {
    const key = `${asset}:${section}`;
    setExpandedSubSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  React.useEffect(() => {
    if (isRfqDisabled) return;
    if (dashboardView.kind === "rfq") {
      for (const group of unifiedAssets) {
        if (group.rfqPools.some((p) => p.poolKey === dashboardView.poolKey)) {
          setExpandedAssets((prev) => new Set(prev).add(group.trackedAsset));
          setExpandedSubSections((prev) => new Set(prev).add(`${group.trackedAsset}:rfq`));
          break;
        }
      }
    } else if (
      dashboardView.kind === "rfq-cowswap" ||
      dashboardView.kind === "rfq-bebop" ||
      dashboardView.kind === "rfq-0x" ||
      dashboardView.kind === "rfq-1inch" ||
      dashboardView.kind === "rfq-jupz"
    ) {
      for (const group of unifiedAssets) {
        if (group.originalSymbol === dashboardView.asset) {
          setExpandedAssets((prev) => new Set(prev).add(group.trackedAsset));
          setExpandedSubSections((prev) => new Set(prev).add(`${group.trackedAsset}:rfq`));
          break;
        }
      }
    }
  }, [dashboardView, isRfqDisabled, unifiedAssets]);

  const rfqPrefetchLastRunByPoolRef = React.useRef<Map<string, number>>(new Map());

  const prefetchRfqPool = useCallback(
    (poolKey: string, options: { includeHistory?: boolean; force?: boolean } = {}) => {
      if (!poolKey) return;
      const { includeHistory = false, force = false } = options;
      const now = Date.now();
      const lastPrefetch = rfqPrefetchLastRunByPoolRef.current.get(poolKey) ?? 0;
      if (!force && now - lastPrefetch < 30_000) return;

      const latestState = queryClient.getQueryState(["rfq", "latest", poolKey]);
      if (!force && latestState?.dataUpdatedAt && now - latestState.dataUpdatedAt < 45_000) return;

      rfqPrefetchLastRunByPoolRef.current.set(poolKey, now);
      void queryClient.prefetchQuery(getRfqLatestQueryOptions(poolKey));
      if (includeHistory) {
        void queryClient.prefetchQuery(getRfqHistoryQueryOptions(poolKey));
      }
    },
    [queryClient]
  );

  React.useEffect(() => {
    if (isRfqDisabled || dashboardView.kind !== "rfq") return;
    prefetchRfqPool(dashboardView.poolKey);
  }, [dashboardView, isRfqDisabled, prefetchRfqPool]);

  const selectPool = (poolKey: string) => {
    const lc = normalizePoolKey(poolKey);
    setSelectedToken(null);
    if (lc === selectedPoolKey && pathname === dashboardPath) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("pool", lc);
    pushToDashboard(next);
  };

  const toggleSidebar = () => {
    toggle();
  };

  const openBirdsEye = useCallback(() => {
    setSelectedToken(null);
    setBirdsEyeView();
    const next = new URLSearchParams(searchParams.toString());
    pushToDashboard(next);
  }, [pushToDashboard, searchParams, setBirdsEyeView, setSelectedToken]);

  const openRfqJupiter = useCallback(
    (poolKey: string) => {
      prefetchRfqPool(poolKey);
      setRfqView(poolKey);
      const next = new URLSearchParams(searchParams.toString());
      next.set("pool", normalizePoolKey(poolKey));
      pushToDashboard(next);
    },
    [prefetchRfqPool, pushToDashboard, searchParams, setRfqView]
  );

  const openRfqAssetView = useCallback(
    (
      setter:
        | typeof setRfqCowswapView
        | typeof setRfqBebopView
        | typeof setRfq0xView
        | typeof setRfq1inchView
        | typeof setRfqJupzView,
      asset: string
    ) => {
      setter(asset);
      const next = new URLSearchParams(searchParams.toString());
      pushToDashboard(next);
    },
    [pushToDashboard, searchParams]
  );

  const openPoolsDirectory = useCallback(() => {
    if (!currentSpace?.slug) return;
    const next = new URLSearchParams(searchParams.toString());
    const basePath = `/${currentSpace.slug}/pools`;
    router.push(next.toString() ? `${basePath}?${next.toString()}` : basePath);
  }, [currentSpace?.slug, router, searchParams]);

  const openRfqDirectory = useCallback(() => {
    if (!currentSpace?.slug) return;
    const next = new URLSearchParams(searchParams.toString());
    const basePath = `/${currentSpace.slug}/rfq`;
    router.push(next.toString() ? `${basePath}?${next.toString()}` : basePath);
  }, [currentSpace?.slug, router, searchParams]);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle("dark");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      setIsRefreshing(false);
    }
  };

  const getUserInitials = () => {
    if (!email) return "A";
    return email.charAt(0).toUpperCase();
  };

  const spaceLabel = currentSpace?.name ?? "Worldchain";

  return (
    <div className="fixed top-0 left-0 h-screen z-50">
      {/* Sidebar toggle handle — anchored to the top of the sidebar, on its right edge */}
      <motion.button
        type="button"
        className={cn(
          "fixed z-[60] w-5 h-7",
          "bg-[var(--ts-surface)] border border-l-0 border-[var(--ts-line-hard)]",
          "cursor-pointer flex items-center justify-center",
          "hover:bg-[var(--ts-surface-3)] transition-colors"
        )}
        animate={{ left: isOpen ? "287px" : "77px" }}
        transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
        style={{ top: "14px" }}
        onClick={toggleSidebar}
        title={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
        >
          <ChevronRight className="w-3.5 h-3.5 text-[var(--ts-ink-3)]" />
        </motion.div>
      </motion.button>

      {/* Sidebar shell */}
      <motion.aside
        className={cn(
          "relative h-full demo-showcase-sidebar",
          isDemoShowcase
            ? "bg-[var(--ts-surface)] border border-[var(--ts-line-soft)]"
            : "bg-[var(--ts-surface-2)] border border-[var(--ts-line-hard)]",
          isDemoShowcase
            ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.95),_0_1px_2px_rgba(31,71,220,0.06)]"
            : "shadow-[inset_0_1px_0_rgba(255,255,255,0.8),_0_1px_3px_rgba(10,9,6,0.06),_0_24px_60px_-24px_rgba(10,9,6,0.18)]",
          "overflow-hidden font-mono"
        )}
        animate={{ width: isOpen ? 287 : 77 }}
        transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
      >
        {/* Blueprint grid overlay — hidden in Demo showcase for a cleaner sidebar */}
        {!isDemoShowcase ? (
          <div
            className="absolute inset-0 pointer-events-none opacity-50"
            style={{
              backgroundImage:
                "linear-gradient(var(--ts-line-grid) 1px, transparent 1px), linear-gradient(90deg, var(--ts-line-grid) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
        ) : null}

        <div className="relative h-full flex flex-col">

          {/* ── Brand ──────────────────────────────────────────────────── */}
          <header
            className={cn(
              "flex items-center gap-2.5 px-4 py-3.5",
              "border-b border-[var(--ts-line)]",
              !isOpen && "justify-center px-2"
            )}
          >
            <button
              type="button"
              className="shrink-0 cursor-pointer flex items-center justify-center"
              style={{ color: isDemoShowcase ? "var(--bp-accent-primary)" : "var(--ts-ink-0)" }}
              onClick={openBirdsEye}
              title="Birds-eye View"
            >
              <BrandMark size={32} />
            </button>
            <motion.div
              className="flex flex-col min-w-0 overflow-hidden leading-[1.2]"
              animate={{ opacity: isOpen ? 1 : 0, width: isOpen ? "auto" : 0 }}
              transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
            >
              <span className="font-mono text-[13px] font-semibold tracking-[-0.04em] whitespace-nowrap text-[var(--ts-ink-0)]">
                transparent
                <span className={isDemoShowcase ? "text-[var(--bp-accent-primary)]" : "text-[var(--ts-ink-3)]"}>
                  .space
                </span>
              </span>
              <span
                className={cn(
                  "text-[9px] uppercase tracking-[0.18em] font-medium mt-0.5 whitespace-nowrap",
                  isDemoShowcase ? "text-[var(--bp-accent-secondary)]" : "text-[var(--ts-ink-3)]",
                )}
              >
                {spaceLabel}
              </span>
            </motion.div>
          </header>

          {hasPoolsInSpace ? (
            <>
              {/* ── Search ────────────────────────────────────────────── */}
              <div
                className={cn(
                  "px-3 py-2.5 border-b border-[var(--ts-line)]",
                  !isOpen && "px-2"
                )}
              >
                <div
                  className={cn(
                    "relative flex items-center h-[30px] overflow-hidden",
                    "border border-[var(--ts-line-hard)] bg-[var(--ts-surface)]",
                    "shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
                  )}
                >
                  <Search className="absolute left-2 w-3.5 h-3.5 text-[var(--ts-ink-3)] pointer-events-none" />
                  <input
                    type="text"
                    placeholder={isOpen ? "Search pools, tokens…" : ""}
                    value={poolSearch}
                    onChange={(e) => setPoolSearch(e.target.value)}
                    className={cn(
                      "w-full bg-transparent border-none outline-none h-full",
                      "font-mono text-[11.5px] text-[var(--ts-ink-0)]",
                      "placeholder:text-[var(--ts-ink-3)]",
                      isOpen ? "px-9" : "px-7"
                    )}
                  />
                  {isOpen && (
                    <kbd className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[9px] px-1 py-px bg-[var(--ts-surface-2)] border border-[var(--ts-line)] text-[var(--ts-ink-3)] font-medium">
                      ⌘K
                    </kbd>
                  )}
                </div>
              </div>

              {/* ── Primary nav ──────────────────────────────────────── */}
              <nav className="py-1.5 border-b border-[var(--ts-line)]">
                <NavRow
                  active={dashboardView.kind === "birds-eye" && !isPoolsRoute && !isRfqRoute}
                  onClick={openBirdsEye}
                  isOpen={isOpen}
                  isDemoShowcase={isDemoShowcase}
                  title="Birds-eye View"
                  icon={
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3v18" />
                    </svg>
                  }
                  label="Birds-eye View"
                />
                {hasPoolsDirectory && (
                  <NavRow
                    active={isPoolsRoute}
                    onClick={openPoolsDirectory}
                    isOpen={isOpen}
                    isDemoShowcase={isDemoShowcase}
                    title="Pool Directory"
                    icon={
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="5" width="18" height="14" rx="1" />
                        <path d="M3 10h18" />
                      </svg>
                    }
                    label="Pool Directory"
                  />
                )}
                {hasRfqDirectory && (
                  <NavRow
                    active={isRfqRoute}
                    onClick={openRfqDirectory}
                    isOpen={isOpen}
                    isDemoShowcase={isDemoShowcase}
                    title="RFQ Directory"
                    icon={
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 7h12l4 4v6H4z" />
                        <path d="M4 7V5h10l2 2" />
                        <path d="M8 12h8" />
                      </svg>
                    }
                    label="RFQ Directory"
                  />
                )}
              </nav>

              {/* ── Section header ───────────────────────────────────── */}
              <motion.div
                className={cn(
                  "px-4 pt-3 pb-2 flex justify-between items-center gap-2",
                  !isOpen && "hidden"
                )}
                animate={{ opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.4 }}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--ts-ink-3)]">
                  Control Panel
                </span>
                <span className="text-[8.5px] font-medium tracking-[0.14em] text-[var(--ts-ink-4)]">
                  {unifiedAssets.length} {unifiedAssets.length === 1 ? "asset" : "assets"}
                </span>
              </motion.div>

              {/* ── Token tree ───────────────────────────────────────── */}
              <div className="flex-1 min-h-0 overflow-y-auto pb-2 scrollbar-thin">
                {unifiedAssets.map((asset) => (
                  <SidebarUnifiedAsset
                    key={asset.trackedAsset}
                    asset={asset}
                    isExpanded={expandedAssets.has(asset.trackedAsset)}
                    isPoolsExpanded={expandedSubSections.has(`${asset.trackedAsset}:pools`)}
                    isRfqExpanded={expandedSubSections.has(`${asset.trackedAsset}:rfq`)}
                    isSelected={
                      selectedTokenSymbol?.toUpperCase().replace(/\.E$/, "") === asset.trackedAsset
                    }
                    onAssetClick={() => handleAssetClick(asset)}
                    onToggleExpansion={() => handleToggleExpansion(asset)}
                    onTogglePoolsSection={() => toggleSubSection(asset.trackedAsset, "pools")}
                    onToggleRfqSection={() => toggleSubSection(asset.trackedAsset, "rfq")}
                    selectedPoolKey={selectedPoolKey}
                    selectedTokenSymbol={selectedTokenSymbol}
                    dashboardView={dashboardView}
                    onSelectPool={selectPool}
                    onRfqJupiterClick={openRfqJupiter}
                    onRfqJupiterHover={(poolKey) => prefetchRfqPool(poolKey)}
                    onRfqCowswapClick={(sym) => openRfqAssetView(setRfqCowswapView, sym)}
                    onRfqBebopClick={(sym) => openRfqAssetView(setRfqBebopView, sym)}
                    onRfq0xClick={(sym) => openRfqAssetView(setRfq0xView, sym)}
                    onRfq1inchClick={(sym) => openRfqAssetView(setRfq1inchView, sym)}
                    onRfqJupzClick={(sym) => openRfqAssetView(setRfqJupzView, sym)}
                    isOpen={isOpen}
                    isDemoShowcase={isDemoShowcase}
                  />
                ))}
              </div>
            </>
          ) : (
            <motion.div
              className="flex-1 flex flex-col items-center justify-center py-12 px-4 text-center"
              animate={{ opacity: isOpen ? 1 : 0.5 }}
              transition={{ duration: 0.3 }}
            >
              {isOpen && (
                <>
                  <div className="w-10 h-10 border border-[var(--ts-line-hard)] bg-[var(--ts-surface)] flex items-center justify-center mb-3 font-mono text-[var(--ts-ink-3)] font-semibold">
                    {currentSpace?.name.charAt(0) || "?"}
                  </div>
                  <p className="text-[12px] font-medium font-mono text-[var(--ts-ink-2)]">
                    {currentSpace?.name || "Space"}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ts-ink-4)] mt-1">
                    No pools configured
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* ── User pill ─────────────────────────────────────────────── */}
          <div
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5",
              "border-t border-[var(--ts-line)] shrink-0 relative",
              isDemoShowcase ? "bg-[#fafbff]" : "bg-[var(--ts-surface-2)]",
              !isOpen && "justify-center"
            )}
          >
            <button
              type="button"
              className={cn(
                "flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer text-left",
                "hover:opacity-80 transition-opacity duration-150",
                !isOpen && "justify-center"
              )}
              onClick={() => setShowProfileMenu(true)}
              title="Account settings"
            >
              <div
                className={cn(
                  "w-7 h-7 shrink-0 grid place-items-center",
                  "border border-[var(--ts-line-hard)] bg-[var(--ts-surface)]",
                  "font-mono font-semibold text-[11px] text-[var(--ts-ink-0)]",
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
                )}
              >
                {getUserInitials()}
              </div>
              <motion.div
                className="flex-1 min-w-0 overflow-hidden leading-[1.25]"
                animate={{ opacity: isOpen ? 1 : 0, width: isOpen ? "auto" : 0 }}
                transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
              >
                <div className="font-mono text-[11px] font-medium text-[var(--ts-ink-0)] truncate tracking-[-0.01em]">
                  {email || "user"}
                </div>
                {role && (
                  <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[var(--ts-ink-3)] mt-0.5 font-medium">
                    {role === "admin" ? "Admin · Operator" : "Member"}
                  </div>
                )}
              </motion.div>
            </button>
            <motion.button
              type="button"
              className={cn(
                "p-1 grid place-items-center cursor-pointer shrink-0",
                "text-[var(--ts-ink-3)] hover:text-[var(--ts-ink-0)] hover:bg-[var(--ts-surface-3)]",
                "transition-colors"
              )}
              onClick={logout}
              title="Sign out"
              animate={{ opacity: isOpen ? 1 : 0, scale: isOpen ? 1 : 0.8 }}
              transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
              style={{ display: isOpen ? "flex" : "none" }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </motion.button>
          </div>

          {/* ── Profile Menu Modal ──────────────────────────────────── */}
          <AnimatePresence>
            {showProfileMenu && (
              <motion.div
                className="fixed inset-0 z-[60] flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  className="absolute inset-0 bg-[rgba(10,9,6,0.4)]"
                  onClick={() => setShowProfileMenu(false)}
                />
                <motion.div
                  className={cn(
                    "relative z-10 w-[320px] overflow-hidden",
                    "bg-[var(--ts-surface)] border border-[var(--ts-line-hard)]",
                    "shadow-[0_24px_60px_-24px_rgba(10,9,6,0.4)]"
                  )}
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="px-4 py-4 border-b border-[var(--ts-line)]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 shrink-0 grid place-items-center border border-[var(--ts-line-hard)] bg-[var(--ts-surface-2)] font-mono font-semibold text-sm text-[var(--ts-ink-0)]">
                        {getUserInitials()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[12px] font-medium text-[var(--ts-ink-0)] truncate">
                          {email || "user"}
                        </div>
                        {role && (
                          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ts-ink-3)] mt-1 font-medium">
                            {role === "admin" ? "Admin · Operator" : "Member"}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="py-1.5">
                    {isAdmin && (
                      <ProfileMenuItem
                        icon={<Users className="w-3.5 h-3.5" />}
                        label="Admin Panel"
                        onClick={() => {
                          setShowProfileMenu(false);
                          setShowAdminPanel(true);
                        }}
                      />
                    )}
                    <ProfileMenuItem
                      icon={<RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />}
                      label="Refresh Data"
                      disabled={isRefreshing}
                      onClick={() => {
                        setShowProfileMenu(false);
                        handleRefresh();
                      }}
                    />
                    <ProfileMenuItem
                      icon={<SettingsIcon className="w-3.5 h-3.5" />}
                      label="Settings"
                    />
                    {!isDemoShowcase ? (
                      <ProfileMenuItem
                        icon={isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        label={isDarkMode ? "Light Mode" : "Dark Mode"}
                        onClick={toggleDarkMode}
                      />
                    ) : null}
                  </div>

                  <div className="border-t border-[var(--ts-line)] py-1.5">
                    <ProfileMenuItem
                      icon={<LogOut className="w-3.5 h-3.5" />}
                      label="Sign Out"
                      destructive
                      onClick={() => {
                        setShowProfileMenu(false);
                        logout();
                      }}
                    />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.aside>

      {showAdminPanel && isAdmin && <AdminPanel onClose={() => setShowAdminPanel(false)} />}
    </div>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function NavRow({
  active,
  onClick,
  isOpen,
  isDemoShowcase,
  title,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  isOpen: boolean;
  isDemoShowcase: boolean;
  title: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        sidebarNavRowClass(active, isDemoShowcase),
        !isOpen && "justify-center px-2",
      )}
      onClick={onClick}
      title={!isOpen ? title : undefined}
    >
      <span
        className={cn(
          "shrink-0 grid place-items-center w-4",
          active && isDemoShowcase ? "text-[var(--bp-accent-primary)]" : "text-[var(--ts-ink-3)]",
        )}
      >
        {icon}
      </span>
      <motion.span
        className="overflow-hidden whitespace-nowrap"
        animate={{ opacity: isOpen ? 1 : 0, width: isOpen ? "auto" : 0 }}
        transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
      >
        {label}
      </motion.span>
    </button>
  );
}

function ProfileMenuItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2.5 w-full px-4 py-2 cursor-pointer",
        "font-mono text-[11.5px] transition-colors",
        destructive
          ? "text-[var(--ts-bad)] hover:bg-[var(--ts-bad-soft)]"
          : "text-[var(--ts-ink-1)] hover:bg-[rgba(10,9,6,0.04)]"
      )}
    >
      <span className={destructive ? "text-[var(--ts-bad)]" : "text-[var(--ts-ink-3)]"}>{icon}</span>
      {label}
    </button>
  );
}

// ─── Token logo placeholder (square, 18px, diagonal slash fallback) ────────

function TokenLogoPlaceholder({ symbol }: { symbol: string }) {
  // TokenIcon's `.ts-coin` class hardcodes `position: absolute; width: 38px; height: 38px`
  // (designed for the dashboard's overlapping coin stack). We use a relative slot and
  // force the icon's size via the `!` modifier so it doesn't lose to `.ts-coin`'s width.
  return (
    <span className="relative shrink-0 inline-block" style={{ width: 22, height: 22 }}>
      <TokenIcon
        symbol={symbol}
        className="!w-[22px] !h-[22px]"
      />
    </span>
  );
}

// ─── Unified asset row (top-level token in the tree) ───────────────────────

function SidebarUnifiedAsset({
  asset,
  isExpanded,
  isPoolsExpanded,
  isRfqExpanded,
  isSelected,
  onAssetClick,
  onToggleExpansion,
  onTogglePoolsSection,
  onToggleRfqSection,
  selectedPoolKey,
  selectedTokenSymbol,
  dashboardView,
  onSelectPool,
  onRfqJupiterClick,
  onRfqJupiterHover,
  onRfqCowswapClick,
  onRfqBebopClick,
  onRfq0xClick,
  onRfq1inchClick,
  onRfqJupzClick,
  isOpen,
  isDemoShowcase,
}: {
  asset: {
    trackedAsset: string;
    originalSymbol: string;
    pools: Array<
      | (SupportedPool & { kind: "static" })
      | {
          kind: "indexer";
          key: string;
          poolKey: string;
          protocol: "v2" | "v3" | "v4" | "raydium";
          token0: string;
          token1: string;
        }
    >;
    rfqPools: Array<
      | (SupportedPool & { kind: "static" })
      | {
          kind: "indexer";
          key: string;
          poolKey: string;
          protocol: "v2" | "v3" | "v4" | "raydium";
          token0: string;
          token1: string;
        }
    >;
    poolCount: number;
  };
  isExpanded: boolean;
  isPoolsExpanded: boolean;
  isRfqExpanded: boolean;
  isSelected: boolean;
  onAssetClick: () => void;
  onToggleExpansion: () => void;
  onTogglePoolsSection: () => void;
  onToggleRfqSection: () => void;
  selectedPoolKey: string;
  selectedTokenSymbol: string | null;
  dashboardView: { kind: string; poolKey?: string; asset?: string };
  onSelectPool: (poolKey: string) => void;
  onRfqJupiterClick: (poolKey: string) => void;
  onRfqJupiterHover: (poolKey: string) => void;
  onRfqCowswapClick: (originalSymbol: string) => void;
  onRfqBebopClick: (originalSymbol: string) => void;
  onRfq0xClick: (originalSymbol: string) => void;
  onRfq1inchClick: (originalSymbol: string) => void;
  onRfqJupzClick: (originalSymbol: string) => void;
  isOpen: boolean;
  isDemoShowcase: boolean;
}) {
  const hasRfq = asset.rfqPools.length > 0;
  const hasPools = asset.pools.length > 0;

  // Highlight a token group as holding the active pool only when we're on
  // the per-pool view. On Birds-eye / RFQ / directory the persisted
  // `selectedPoolKey` would otherwise falsely mark a group as active.
  const hasActivePool =
    dashboardView.kind === "pool" &&
    !selectedTokenSymbol &&
    asset.pools.some((p) => p.poolKey === selectedPoolKey);
  const hasActiveRfq =
    (dashboardView.kind === "rfq" &&
      asset.rfqPools.some((p) => p.poolKey === dashboardView.poolKey)) ||
    (dashboardView.kind === "rfq-cowswap" && dashboardView.asset === asset.originalSymbol) ||
    (dashboardView.kind === "rfq-bebop" && dashboardView.asset === asset.originalSymbol) ||
    (dashboardView.kind === "rfq-0x" && dashboardView.asset === asset.originalSymbol) ||
    (dashboardView.kind === "rfq-1inch" && dashboardView.asset === asset.originalSymbol) ||
    (dashboardView.kind === "rfq-jupz" && dashboardView.asset === asset.originalSymbol);

  const isActive = isSelected || hasActivePool || hasActiveRfq;

  return (
    <div className="flex flex-col">
      {/* Top-level row */}
      <div className={sidebarAssetRowClass(isActive, isDemoShowcase)}>
        <button
          type="button"
          className={cn(
            "flex-1 min-w-0 grid items-center gap-2.5 pl-3.5 py-1.5 cursor-pointer text-left",
            isOpen ? "pr-2" : "px-2"
          )}
          style={{
            gridTemplateColumns: isOpen ? "22px 1fr" : "1fr",
            justifyItems: isOpen ? undefined : "center",
          }}
          onClick={onAssetClick}
          title={!isOpen ? asset.trackedAsset : undefined}
        >
          <TokenLogoPlaceholder symbol={asset.trackedAsset} />
          {isOpen && (
            <span className="flex items-baseline gap-2 min-w-0 overflow-hidden">
              <span className="font-mono font-semibold text-[11.5px] tracking-[0.02em]">
                {asset.trackedAsset}
              </span>
              <span className="text-[10px] text-[var(--ts-ink-4)] truncate">
                · {asset.poolCount} {asset.poolCount === 1 ? "pool" : "pools"}
              </span>
            </span>
          )}
        </button>
        {isOpen && (
          <button
            type="button"
            onClick={onToggleExpansion}
            aria-label={isExpanded ? `Collapse ${asset.trackedAsset}` : `Expand ${asset.trackedAsset}`}
            className={cn(
              "shrink-0 grid place-items-center w-9 cursor-pointer transition-colors",
              isActive
                ? "hover:bg-[rgba(255,255,255,0.08)]"
                : "hover:bg-[var(--ts-surface-2)]"
            )}
          >
            <ChevronRight
              className={cn(
                "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
                isExpanded && "rotate-90",
                isActive ? "text-[var(--ts-ink-4)]" : "text-[var(--ts-ink-3)]"
              )}
            />
          </button>
        )}
      </div>

      {/* Expanded — open sidebar */}
      <AnimatePresence>
        {isExpanded && isOpen && (
          <motion.div
            className="bg-[var(--ts-surface)] border-y border-[var(--ts-line)] relative"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {/* Vertical tree rail */}
            {(hasPools || hasRfq) && (
              <span
                aria-hidden
                className="absolute left-6 top-1 bottom-1 w-px bg-[var(--ts-line)] pointer-events-none"
              />
            )}

            {/* Pools sub-section */}
            {hasPools && (
              <>
                <SubSectionHeader
                  label="Pools"
                  expanded={isPoolsExpanded}
                  onClick={onTogglePoolsSection}
                />
                <AnimatePresence>
                  {isPoolsExpanded && (
                    <motion.div
                      className="flex flex-col"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      {asset.pools.map((p) => (
                        <SidebarPoolMenuItem
                          key={p.key}
                          row={p}
                          isActive={
                            dashboardView.kind === "pool" &&
                            !selectedTokenSymbol &&
                            p.poolKey === selectedPoolKey
                          }
                          onSelect={onSelectPool}
                          isOpen={isOpen}
                          isNested
                          isDemoShowcase={isDemoShowcase}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}

            {/* RFQ sub-section */}
            {hasRfq && (
              <>
                <SubSectionHeader
                  label="RFQ"
                  expanded={isRfqExpanded}
                  onClick={onToggleRfqSection}
                />
                <AnimatePresence>
                  {isRfqExpanded && (
                    <motion.div
                      className="flex flex-col"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      {asset.rfqPools[0] && (
                        <RfqSourceButton
                          label="Jupiter"
                          isActive={
                            dashboardView.kind === "rfq" &&
                            asset.rfqPools.some((p) => p.poolKey === dashboardView.poolKey)
                          }
                          onClick={() => onRfqJupiterClick(asset.rfqPools[0].poolKey)}
                          onMouseEnter={() => onRfqJupiterHover(asset.rfqPools[0].poolKey)}
                          isDemoShowcase={isDemoShowcase}
                        />
                      )}
                      <RfqSourceButton
                        label="CowSwap"
                        isActive={
                          dashboardView.kind === "rfq-cowswap" &&
                          dashboardView.asset === asset.originalSymbol
                        }
                        onClick={() => onRfqCowswapClick(asset.originalSymbol)}
                        isDemoShowcase={isDemoShowcase}
                      />
                      <RfqSourceButton
                        label="Bebop"
                        isActive={
                          dashboardView.kind === "rfq-bebop" &&
                          dashboardView.asset === asset.originalSymbol
                        }
                        onClick={() => onRfqBebopClick(asset.originalSymbol)}
                        isDemoShowcase={isDemoShowcase}
                      />
                      <RfqSourceButton
                        label="0x"
                        isActive={
                          dashboardView.kind === "rfq-0x" &&
                          dashboardView.asset === asset.originalSymbol
                        }
                        onClick={() => onRfq0xClick(asset.originalSymbol)}
                        isDemoShowcase={isDemoShowcase}
                      />
                      <RfqSourceButton
                        label="1inch"
                        isActive={
                          dashboardView.kind === "rfq-1inch" &&
                          dashboardView.asset === asset.originalSymbol
                        }
                        onClick={() => onRfq1inchClick(asset.originalSymbol)}
                        isDemoShowcase={isDemoShowcase}
                      />
                      <RfqSourceButton
                        label="JupZ"
                        isActive={
                          dashboardView.kind === "rfq-jupz" &&
                          dashboardView.asset === asset.originalSymbol
                        }
                        onClick={() => onRfqJupzClick(asset.originalSymbol)}
                        isDemoShowcase={isDemoShowcase}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed sidebar — icon-only RFQ/pool stack */}
      {!isOpen && isExpanded && (
        <div className="flex flex-col gap-0.5 py-1 bg-[var(--ts-surface)] border-y border-[var(--ts-line)]">
          {hasPools &&
            asset.pools.map((p) => (
              <SidebarPoolMenuItem
                key={p.key}
                row={p}
                isActive={
                  dashboardView.kind === "pool" &&
                  !selectedTokenSymbol &&
                  p.poolKey === selectedPoolKey
                }
                onSelect={onSelectPool}
                isOpen={false}
                isNested
                isDemoShowcase={isDemoShowcase}
              />
            ))}
          {hasRfq && (
            <>
              {asset.rfqPools[0] && (
                <CollapsedRfqGlyph
                  label="J"
                  active={
                    dashboardView.kind === "rfq" &&
                    asset.rfqPools.some((p) => p.poolKey === dashboardView.poolKey)
                  }
                  title={`${asset.trackedAsset} — Jupiter`}
                  onClick={() => onRfqJupiterClick(asset.rfqPools[0].poolKey)}
                  onMouseEnter={() => onRfqJupiterHover(asset.rfqPools[0].poolKey)}
                  isDemoShowcase={isDemoShowcase}
                />
              )}
              <CollapsedRfqGlyph
                label="C"
                active={dashboardView.kind === "rfq-cowswap" && dashboardView.asset === asset.originalSymbol}
                title={`${asset.trackedAsset} — CowSwap`}
                onClick={() => onRfqCowswapClick(asset.originalSymbol)}
                isDemoShowcase={isDemoShowcase}
              />
              <CollapsedRfqGlyph
                label="B"
                active={dashboardView.kind === "rfq-bebop" && dashboardView.asset === asset.originalSymbol}
                title={`${asset.trackedAsset} — Bebop`}
                onClick={() => onRfqBebopClick(asset.originalSymbol)}
                isDemoShowcase={isDemoShowcase}
              />
              <CollapsedRfqGlyph
                label="0x"
                active={dashboardView.kind === "rfq-0x" && dashboardView.asset === asset.originalSymbol}
                title={`${asset.trackedAsset} — 0x`}
                onClick={() => onRfq0xClick(asset.originalSymbol)}
                isDemoShowcase={isDemoShowcase}
              />
              <CollapsedRfqGlyph
                label="1"
                active={dashboardView.kind === "rfq-1inch" && dashboardView.asset === asset.originalSymbol}
                title={`${asset.trackedAsset} — 1inch`}
                onClick={() => onRfq1inchClick(asset.originalSymbol)}
                isDemoShowcase={isDemoShowcase}
              />
              <CollapsedRfqGlyph
                label="Jz"
                active={dashboardView.kind === "rfq-jupz" && dashboardView.asset === asset.originalSymbol}
                title={`${asset.trackedAsset} — JupZ`}
                onClick={() => onRfqJupzClick(asset.originalSymbol)}
                isDemoShowcase={isDemoShowcase}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SubSectionHeader({
  label,
  expanded,
  onClick,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 w-full pl-9 pr-3 py-1.5 cursor-pointer",
        "font-mono text-[9px] font-semibold uppercase tracking-[0.18em]",
        "text-[var(--ts-ink-3)] hover:text-[var(--ts-ink-1)] transition-colors text-left"
      )}
    >
      <ChevronRight
        className={cn(
          "w-2.5 h-2.5 shrink-0 transition-transform duration-150",
          expanded && "rotate-90"
        )}
      />
      <span>{label}</span>
    </button>
  );
}

function CollapsedRfqGlyph({
  label,
  active,
  title,
  onClick,
  onMouseEnter,
  isDemoShowcase,
}: {
  label: string;
  active: boolean;
  title: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  isDemoShowcase: boolean;
}) {
  return (
    <button
      type="button"
      className={sidebarCollapsedGlyphClass(active, isDemoShowcase)}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={title}
    >
      <span className="font-mono text-[10px]">{label}</span>
    </button>
  );
}

// ─── RFQ source row (open sidebar) ─────────────────────────────────────────

function RfqSourceButton({
  label,
  isActive,
  onClick,
  onMouseEnter,
  isDemoShowcase,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  isDemoShowcase: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        sidebarTreeItemClass(isActive, isDemoShowcase),
        "pl-12 pr-3 py-1.5 text-[10.5px]",
      )}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      {/* Tree tick */}
      <span
        aria-hidden
        className={cn(
          "absolute left-6 top-1/2 -translate-y-1/2 w-1.5 h-px",
          isActive ? "bg-[var(--ts-ink-4)]" : "bg-[var(--ts-line)]"
        )}
      />
      <span className="truncate min-w-0 whitespace-nowrap">{label}</span>
      <span
        className={cn(
          "ml-auto shrink-0 font-mono text-[8px] px-1 py-px font-semibold tracking-[0.12em] border",
          isActive
            ? "border-[var(--ts-ink-4)] text-[var(--ts-ink-inv)] bg-transparent"
            : "border-[var(--ts-line-hard)] text-[var(--ts-ink-3)] bg-[var(--ts-surface)]"
        )}
      >
        RFQ
      </span>
    </button>
  );
}

// ─── Pool row (tree-rail item) ─────────────────────────────────────────────

function SidebarPoolMenuItem({
  row,
  isActive,
  onSelect,
  isOpen,
  isNested = false,
  isDemoShowcase = false,
}: {
  row:
    | (SupportedPool & { kind: "static" })
    | {
        kind: "indexer";
        key: string;
        poolKey: string;
        protocol: "v2" | "v3" | "v4" | "raydium";
        token0: string;
        token1: string;
      };
  isActive: boolean;
  onSelect: (poolKey: string) => void;
  isOpen: boolean;
  isNested?: boolean;
  isDemoShowcase?: boolean;
}) {
  const token0Meta = useTokenMeta(row.kind === "indexer" ? row.token0 : undefined);
  const token1Meta = useTokenMeta(row.kind === "indexer" ? row.token1 : undefined);
  const label =
    row.kind === "static"
      ? row.label
      : `${token0Meta.data?.symbol ?? shortAddr(row.token0)} / ${token1Meta.data?.symbol ?? shortAddr(row.token1)}`;

  const badge = row.kind === "static" ? row.protocol : inferPoolProtocol(row.poolKey);
  const isByreal = row.kind === "static" && row.key.startsWith("byreal-");
  const isWorldchainSolana = row.kind === "static" && isWorldchainSolanaSupportedPool(row);
  const isMeteora = row.kind === "static" && row.protocol === "meteora";
  const badgeLabel = isByreal
    ? "REAL"
    : isWorldchainSolana
      ? "SOL"
      : isMeteora
        ? "MET"
        : badge === "v4"
          ? "V4"
          : badge === "v2"
            ? "V2"
          : badge === "raydium"
            ? "RAY"
            : "V3";

  const solMeta = getSolanaPoolMetadata(row.poolKey);
  const feeTierLabel = solMeta?.fee ? `${(solMeta.fee / 10000).toFixed(2)}%` : null;
  const rowLogo = row.kind === "static" ? row.logo : undefined;

  if (!isOpen) {
    return (
      <button
        type="button"
        className={cn(
          "relative flex items-center justify-center w-full py-1 cursor-pointer transition-colors",
          isActive
            ? isDemoShowcase
              ? "bg-[rgba(31,71,220,0.08)]"
              : "bg-[var(--ts-surface-3)]"
            : "hover:bg-[var(--ts-surface-3)]",
        )}
        onClick={() => onSelect(row.poolKey)}
        title={label}
      >
        {rowLogo ? (
          <img src={rowLogo} alt={`${label} logo`} className="h-4 w-4 rounded-full object-cover" />
        ) : (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              isActive
                ? isDemoShowcase
                  ? "bg-[var(--bp-accent-primary)]"
                  : "bg-[var(--ts-ink-0)]"
                : "bg-[var(--ts-ink-3)]"
            )}
          />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        sidebarTreeItemClass(isActive, isDemoShowcase),
        "grid items-center gap-2.5 w-full pl-8 pr-3 py-1 text-[10px] tracking-[-0.005em]",
        isActive && "font-medium",
      )}
      style={{ gridTemplateColumns: "12px 1fr auto" }}
      onClick={() => onSelect(row.poolKey)}
    >
      {/* Tree tick (horizontal, from rail to row) */}
      {isNested && (
        <span
          aria-hidden
          className={cn(
            "absolute left-6 top-1/2 -translate-y-1/2 w-1.5 h-px",
            isActive ? "bg-[var(--ts-ink-4)]" : "bg-[var(--ts-line)]"
          )}
        />
      )}
      {/* Marker dot / pool logo */}
      {rowLogo ? (
        <img
          src={rowLogo}
          alt={`${label} logo`}
          className="h-3 w-3 rounded-full object-cover justify-self-center"
        />
      ) : (
        <span
          className={cn(
            "w-1 h-1 rounded-full justify-self-center",
            isActive ? "bg-[var(--ts-ink-inv)]" : "bg-[var(--ts-ink-3)]"
          )}
        />
      )}
      <span className="truncate min-w-0 whitespace-nowrap flex items-center gap-1">
        <span className="truncate">{label}</span>
        {feeTierLabel && (
          <span className={cn("shrink-0", isActive ? "text-[var(--ts-ink-4)]" : "text-[var(--ts-ink-4)]")}>
            · {feeTierLabel}
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-[8px] px-1 py-px font-semibold tracking-[0.12em] leading-[1.3] border",
          isActive
            ? "border-[var(--ts-ink-4)] text-[var(--ts-ink-inv)] bg-transparent"
            : "border-[var(--ts-line-hard)] text-[var(--ts-ink-3)] bg-[var(--ts-surface)]"
        )}
      >
        {badgeLabel}
      </span>
    </button>
  );
}

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export default Sidebar;
