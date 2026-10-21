"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { usePoolStore } from "@/stores/pool-store";
import { useAuthStore } from "@/lib/auth-store";
import { useBirdsEyeData } from "@/hooks/use-birds-eye-data";
import { useBirdsEyeRfqData } from "@/hooks/use-birds-eye-rfq-data";
import { useRfqAssetsConfig } from "@/hooks/use-rfq-assets-config";
import {
  DEMO_SPACE_SLUG,
  KATANA_SPACE_SLUG,
  KRAKEN_SPACE_SLUG,
  MONAD_SPACE_SLUG,
  ZEROG_SPACE_SLUG,
  isRfqDisabledSpace,
} from "@/lib/space-policy";
import { BirdsEyeSectionDivider } from "./birds-eye-section-divider";

type BirdsEyeTab = "slas" | "pools" | "incentives" | "rfq" | "flows";

const DEPTH_PLACEHOLDER_MIN_HEIGHT = 620;
const DEFERRED_POOL_DETAILS_DELAY_MS = 180;
const KATANA_POOL_DETAILS_DELAY_MS = 3500;

const cachedTabPanelBaseStyle: CSSProperties = {
  contentVisibility: "visible",
  contain: "layout style paint",
  inset: "0 0 auto 0",
  position: "absolute",
  width: "100%",
};

const cachedTabPanelInactiveStyle: CSSProperties = {
  ...cachedTabPanelBaseStyle,
  opacity: 0,
  pointerEvents: "none",
  transform: "translate3d(-100vw, 0, 0)",
  visibility: "hidden",
  zIndex: 0,
};

const cachedTabPanelActiveStyle: CSSProperties = {
  ...cachedTabPanelBaseStyle,
  opacity: 1,
  pointerEvents: "auto",
  transform: "translate3d(0, 0, 0)",
  visibility: "visible",
  zIndex: 1,
};

const cachedPoolDetailsInactiveStyle: CSSProperties = {
  contentVisibility: "visible",
  contain: "layout style paint",
  height: 0,
  minHeight: 0,
  overflow: "hidden",
  pointerEvents: "none",
  visibility: "hidden",
};

const cachedPoolDetailsActiveStyle: CSSProperties = {
  contentVisibility: "visible",
};

const cachedTabStackBaseStyle: CSSProperties = {
  position: "relative",
  width: "100%",
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function useNearViewport<T extends HTMLElement>(rootMargin = "360px 0px") {
  const ref = useRef<T | null>(null);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    if (isNear) return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsNear(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNear(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isNear, rootMargin]);

  return [ref, isNear] as const;
}

function RoutingDeferredPlaceholder() {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white/45 p-4 dark:border-gray-800 dark:bg-gray-950/20"
      style={{ minHeight: DEPTH_PLACEHOLDER_MIN_HEIGHT }}
      aria-hidden="true"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="h-4 w-44 bp-skeleton-pulse rounded" />
        <div className="h-4 w-28 bp-skeleton-pulse rounded" />
      </div>
      <div className="grid h-[calc(100%-48px)] min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="h-full w-full bp-skeleton rounded" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-10 w-full bp-skeleton-pulse rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

function DeferredPoolSectionPlaceholder({ minHeight }: { minHeight: number }) {
  return (
    <div
      className="border-b border-gray-200 bg-white/35 p-4 dark:border-gray-800 dark:bg-gray-950/20"
      style={{ minHeight }}
      aria-hidden="true"
    >
      <div className="mb-4 h-4 w-56 bp-skeleton-pulse rounded" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="h-[calc(100%-40px)] min-h-[180px] w-full bp-skeleton rounded" />
        <div className="space-y-3">
          {Array.from({ length: Math.max(3, Math.min(8, Math.floor(minHeight / 72))) }).map(
            (_, index) => (
              <div key={index} className="h-9 w-full bp-skeleton-pulse rounded" />
            )
          )}
        </div>
      </div>
    </div>
  );
}

const BirdsEyeTable = dynamic(
  () => import("./birds-eye-table").then((mod) => mod.BirdsEyeTable),
  { loading: () => <DeferredPoolSectionPlaceholder minHeight={240} /> },
);

const BirdsEyeRfqTable = dynamic(
  () => import("./birds-eye-rfq-table").then((mod) => mod.BirdsEyeRfqTable),
  { loading: () => <DeferredPoolSectionPlaceholder minHeight={360} /> },
);

const BirdsEyeMakerVolumeChart = dynamic(
  () => import("./birds-eye-maker-volume-chart").then((mod) => mod.BirdsEyeMakerVolumeChart),
  { ssr: false, loading: () => <DeferredPoolSectionPlaceholder minHeight={360} /> },
);

const BirdsEyeSettingsFab = dynamic(
  () => import("./birds-eye-settings-fab").then((mod) => mod.BirdsEyeSettingsFab),
  { ssr: false },
);

const BirdsEyeSlasTable = dynamic(
  () => import("./birds-eye-slas-table").then((mod) => mod.BirdsEyeSlasTable),
  { loading: () => <DeferredPoolSectionPlaceholder minHeight={520} /> },
);

const BirdsEyeLpAggregateTable = dynamic(
  () => import("./birds-eye-lp-aggregate-table").then((mod) => mod.BirdsEyeLpAggregateTable),
  { ssr: false, loading: () => <DeferredPoolSectionPlaceholder minHeight={320} /> },
);

const BirdsEyePriceComparisonChart = dynamic(
  () =>
    import("./birds-eye-price-comparison-chart").then(
      (mod) => mod.BirdsEyePriceComparisonChart,
    ),
  { ssr: false, loading: () => <DeferredPoolSectionPlaceholder minHeight={360} /> },
);

const BirdsEyeRoutingTable = dynamic(
  () => import("./birds-eye-routing-table").then((mod) => mod.BirdsEyeRoutingTable),
  { ssr: false, loading: () => <RoutingDeferredPlaceholder /> },
);

const BirdsEyeLiquidityFragilityTable = dynamic(
  () =>
    import("./birds-eye-liquidity-fragility-table").then(
      (mod) => mod.BirdsEyeLiquidityFragilityTable,
    ),
  { ssr: false, loading: () => <DeferredPoolSectionPlaceholder minHeight={360} /> },
);

const BirdsEyeFlowsChart = dynamic(
  () => import("./birds-eye-flows-chart").then((mod) => mod.BirdsEyeFlowsChart),
  { ssr: false, loading: () => <DeferredPoolSectionPlaceholder minHeight={360} /> },
);

const BirdsEyeFlowsCostChart = dynamic(
  () => import("./birds-eye-flows-cost-chart").then((mod) => mod.BirdsEyeFlowsCostChart),
  { ssr: false, loading: () => <DeferredPoolSectionPlaceholder minHeight={360} /> },
);

const BirdsEyeKatanaIncentives = dynamic(
  () => import("./birds-eye-katana-incentives").then((mod) => mod.BirdsEyeKatanaIncentives),
  { loading: () => <DeferredPoolSectionPlaceholder minHeight={520} /> },
);

const BirdsEyeMonadIncentives = dynamic(
  () => import("./birds-eye-monad-incentives").then((mod) => mod.BirdsEyeMonadIncentives),
  { loading: () => <DeferredPoolSectionPlaceholder minHeight={520} /> },
);

const BirdsEyeZerogIncentives = dynamic(
  () => import("./birds-eye-zerog-incentives").then((mod) => mod.BirdsEyeZerogIncentives),
  { loading: () => <DeferredPoolSectionPlaceholder minHeight={520} /> },
);

function scheduleDeferredActivation(callback: () => void, delayMs = DEFERRED_POOL_DETAILS_DELAY_MS) {
  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  let cancelled = false;
  let timeoutId: number | null = null;
  let idleId: number | null = null;
  let frameId: number | null = null;
  let secondFrameId: number | null = null;

  const activate = () => {
    if (!cancelled) callback();
  };

  frameId = window.requestAnimationFrame(() => {
    secondFrameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        const idleWindow = window as IdleWindow;
        if (idleWindow.requestIdleCallback) {
          idleId = idleWindow.requestIdleCallback(activate, {
            timeout: 700,
          });
        } else {
          activate();
        }
      }, delayMs);
    });
  });

  return () => {
    cancelled = true;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    if (secondFrameId !== null) window.cancelAnimationFrame(secondFrameId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (idleId !== null) {
      (window as IdleWindow).cancelIdleCallback?.(idleId);
    }
  };
}

function CachedTabPanel({
  active,
  className,
  panelRef,
  children,
}: {
  active: boolean;
  className?: string;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={panelRef}
      className={className}
      style={active ? cachedTabPanelActiveStyle : cachedTabPanelInactiveStyle}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function CachedPoolDetails({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={active ? cachedPoolDetailsActiveStyle : cachedPoolDetailsInactiveStyle}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function ViewportDeferredSection({
  id,
  minHeight,
  children,
  onNear,
  eager = false,
}: {
  id: string;
  minHeight: number;
  children: ReactNode;
  onNear?: () => void;
  eager?: boolean;
}) {
  const [ref, isNear] = useNearViewport<HTMLDivElement>("720px 0px");
  const shouldRender = eager || isNear;

  useEffect(() => {
    if (shouldRender) onNear?.();
  }, [onNear, shouldRender]);

  return (
    <div id={id} ref={ref} className="scroll-mt-20">
      {shouldRender ? children : <DeferredPoolSectionPlaceholder minHeight={minHeight} />}
    </div>
  );
}

function LazyDepthRouting({
  pools,
  onNear,
  eager = false,
  renderDelayMs = 0,
}: {
  pools: ReturnType<typeof useBirdsEyeData>["pools"];
  onNear?: () => void;
  eager?: boolean;
  renderDelayMs?: number;
}) {
  const [ref, shouldRenderRouting] = useNearViewport<HTMLDivElement>();
  const shouldPrepare = eager || shouldRenderRouting;
  const [deferredReady, setDeferredReady] = useState(false);
  const shouldRender = shouldPrepare && deferredReady;

  useEffect(() => {
    if (shouldPrepare) onNear?.();
  }, [onNear, shouldPrepare]);

  useEffect(() => {
    if (!shouldPrepare) {
      setDeferredReady(false);
      return;
    }
    if (deferredReady) return;
    return scheduleDeferredActivation(
      () => setDeferredReady(true),
      renderDelayMs
    );
  }, [deferredReady, renderDelayMs, shouldPrepare]);

  return (
    <div id="depth" ref={ref} className="scroll-mt-20">
      <BirdsEyeSectionDivider label="Depth" />
      {shouldRender ? (
        <div id="depth-routing" className="scroll-mt-20">
          <BirdsEyeRoutingTable pools={pools} enabled />
        </div>
      ) : (
        <RoutingDeferredPlaceholder />
      )}
    </div>
  );
}

function LiquidityDistributionSection({
  pools,
  spaceSlug,
}: {
  pools: ReturnType<typeof useBirdsEyeData>["pools"];
  spaceSlug?: string | null;
}) {
  return (
    <>
      <BirdsEyeLiquidityFragilityTable pools={pools} spaceSlug={spaceSlug} />
    </>
  );
}

export function BirdsEyeDashboard() {
  const supportedPools = usePoolStore((s) => s.supportedPools);
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const currentSpace = spaces.find((s) => s.id === currentSpaceId);
  const hasFlowsTab =
    currentSpace?.slug === KRAKEN_SPACE_SLUG || currentSpace?.slug === DEMO_SPACE_SLUG;
  const hasIncentivesTab =
    currentSpace?.slug === KATANA_SPACE_SLUG ||
    currentSpace?.slug === MONAD_SPACE_SLUG ||
    currentSpace?.slug === ZEROG_SPACE_SLUG;
  const incentivesSpaceSlug = currentSpace?.slug;
  const isRfqDisabled = isRfqDisabledSpace(currentSpace?.slug);
  const initialBirdsEyeTab = hasIncentivesTab ? "incentives" : isRfqDisabled ? "pools" : "slas";
  const [birdsEyeTab, setBirdsEyeTab] = useState<BirdsEyeTab>(
    initialBirdsEyeTab
  );
  const [visualBirdsEyeTab, setVisualBirdsEyeTab] = useState<BirdsEyeTab>(
    initialBirdsEyeTab
  );
  const [, startTabTransition] = useTransition();
  const hasSelectedKatanaDefaultRef = useRef(false);
  const tabActivationCancelRef = useRef<(() => void) | null>(null);
  const supportedPoolsKey = useMemo(
    () => supportedPools.map((pool) => pool.poolKey).join("|"),
    [supportedPools]
  );
  const [hasOpenedPools, setHasOpenedPools] = useState(
    initialBirdsEyeTab === "pools"
  );
  const [hasOpenedIncentives, setHasOpenedIncentives] = useState(hasIncentivesTab);
  const poolsPanelRef = useRef<HTMLDivElement | null>(null);
  const incentivesPanelRef = useRef<HTMLDivElement | null>(null);
  const [katanaPanelHeights, setKatanaPanelHeights] = useState({
    pools: 0,
    incentives: 0,
  });
  const tabs = useMemo<{ id: BirdsEyeTab; label: string }[]>(
    () =>
      isRfqDisabled
        ? hasIncentivesTab
          ? [
              { id: "pools", label: "Pools" },
              { id: "incentives", label: "Incentives" },
            ]
          : [{ id: "pools", label: "Pools" }]
        : hasFlowsTab
        ? [
            { id: "slas", label: "SLAs" },
            { id: "pools", label: "Pools" },
            { id: "rfq", label: "RFQ" },
            { id: "flows", label: "Flows" },
          ]
        : [
            { id: "slas", label: "SLAs" },
            { id: "pools", label: "Pools" },
            { id: "rfq", label: "RFQ" },
          ],
    [hasFlowsTab, hasIncentivesTab, isRfqDisabled]
  );

  const needsPoolData =
    birdsEyeTab === "pools" ||
    birdsEyeTab === "rfq" ||
    (hasIncentivesTab && hasOpenedPools);
  const needsRfqTabData = birdsEyeTab === "rfq" && !isRfqDisabled;
  const [poolDetailsReady, setPoolDetailsReady] = useState(false);
  const [poolDetailsVisible, setPoolDetailsVisible] = useState(false);
  const [hasMountedPoolDetails, setHasMountedPoolDetails] = useState(false);
  const [poolDepthMetricsRequested, setPoolDepthMetricsRequested] = useState(false);
  const requestPoolDepthMetrics = useCallback(() => {
    setPoolDepthMetricsRequested(true);
  }, []);
  const data = useBirdsEyeData(supportedPools, {
    enabled: needsPoolData,
    includeDepthMetrics: poolDepthMetricsRequested,
  });
  const deferredPools = useDeferredValue(data.pools);
  const rfqAssetsConfig = useRfqAssetsConfig(currentSpace?.slug, { enabled: needsRfqTabData });
  const rfqData = useBirdsEyeRfqData({
    enabled: needsRfqTabData,
    assets: rfqAssetsConfig.assets,
    spaceSlug: currentSpace?.slug,
  });

  const measureKatanaPanels = useCallback(() => {
    const poolsHeight = Math.ceil(poolsPanelRef.current?.scrollHeight ?? 0);
    const incentivesHeight = Math.ceil(incentivesPanelRef.current?.scrollHeight ?? 0);
    setKatanaPanelHeights((current) => {
      if (current.pools === poolsHeight && current.incentives === incentivesHeight) {
        return current;
      }
      return { pools: poolsHeight, incentives: incentivesHeight };
    });
  }, []);

  const handleTabClick = useCallback(
    (tabId: BirdsEyeTab) => {
      tabActivationCancelRef.current?.();
      tabActivationCancelRef.current = null;
      setVisualBirdsEyeTab(tabId);

      const activateTab = () => {
        startTabTransition(() => {
          setBirdsEyeTab(tabId);
        });
      };

      startTabTransition(() => {
        if (tabId === "pools") {
          setHasOpenedPools(true);
        }
        if (tabId === "incentives") {
          setHasOpenedIncentives(true);
        }
      });

      activateTab();
    },
    [startTabTransition]
  );

  useEffect(() => {
    return () => {
      tabActivationCancelRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (birdsEyeTab === "incentives") {
      setHasOpenedIncentives(true);
    }
    if (birdsEyeTab === "pools") {
      setHasOpenedPools(true);
    }
    if (isRfqDisabled && birdsEyeTab !== "pools" && birdsEyeTab !== "incentives") {
      setVisualBirdsEyeTab(hasIncentivesTab ? "incentives" : "pools");
      setBirdsEyeTab(hasIncentivesTab ? "incentives" : "pools");
      return;
    }
    if (birdsEyeTab === "incentives" && !hasIncentivesTab) {
      setVisualBirdsEyeTab("pools");
      setBirdsEyeTab("pools");
      return;
    }
    if (!hasFlowsTab && birdsEyeTab === "flows") {
      setVisualBirdsEyeTab(isRfqDisabled ? "pools" : "slas");
      setBirdsEyeTab(isRfqDisabled ? "pools" : "slas");
    }
  }, [birdsEyeTab, hasFlowsTab, hasIncentivesTab, isRfqDisabled]);

  useEffect(() => {
    if (!hasIncentivesTab || !isRfqDisabled || hasSelectedKatanaDefaultRef.current) return;
    hasSelectedKatanaDefaultRef.current = true;
    setHasOpenedIncentives(true);
    setVisualBirdsEyeTab("incentives");
    setBirdsEyeTab("incentives");
  }, [hasIncentivesTab, isRfqDisabled]);

  useEffect(() => {
    if (!hasIncentivesTab) return;
    if (typeof window === "undefined") return;
    const nodes = [poolsPanelRef.current, incentivesPanelRef.current].filter(
      Boolean
    ) as HTMLDivElement[];
    if (nodes.length === 0) return;

    measureKatanaPanels();
    const frameId = window.requestAnimationFrame(measureKatanaPanels);
    const observer =
      "ResizeObserver" in window ? new ResizeObserver(measureKatanaPanels) : null;
    for (const node of nodes) observer?.observe(node);
    window.addEventListener("resize", measureKatanaPanels);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", measureKatanaPanels);
    };
  }, [
    hasIncentivesTab,
    hasOpenedIncentives,
    hasOpenedPools,
    hasMountedPoolDetails,
    measureKatanaPanels,
    poolDetailsReady,
    poolDetailsVisible,
  ]);

  useEffect(() => {
    tabActivationCancelRef.current?.();
    tabActivationCancelRef.current = null;
    setVisualBirdsEyeTab(initialBirdsEyeTab);
    setBirdsEyeTab(initialBirdsEyeTab);
    setPoolDetailsReady(false);
    setPoolDetailsVisible(false);
    setHasMountedPoolDetails(false);
    setPoolDepthMetricsRequested(false);
    setHasOpenedPools(initialBirdsEyeTab === "pools");
    setKatanaPanelHeights({ pools: 0, incentives: 0 });
  }, [currentSpace?.slug, hasIncentivesTab, initialBirdsEyeTab, supportedPoolsKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    if (birdsEyeTab !== "pools" && !isRfqDisabled) {
      setVisualBirdsEyeTab("pools");
      setBirdsEyeTab("pools");
      return;
    }
    const timer = window.setTimeout(() => {
      const target = document.getElementById(hash) ?? document.getElementById("depth");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [birdsEyeTab, isRfqDisabled]);

  useEffect(() => {
    if (birdsEyeTab !== "pools") return;
    if (data.isLoading) return;
    if (poolDetailsReady) return;
    setPoolDetailsReady(false);
    return scheduleDeferredActivation(
      () => setPoolDetailsReady(true),
      hasIncentivesTab ? KATANA_POOL_DETAILS_DELAY_MS : DEFERRED_POOL_DETAILS_DELAY_MS
    );
  }, [birdsEyeTab, data.isLoading, hasIncentivesTab, poolDetailsReady]);

  useEffect(() => {
    if (birdsEyeTab !== "pools") {
      setPoolDetailsVisible(false);
      return;
    }
    if (!poolDetailsReady || poolDetailsVisible) return;
    const revealDelayMs =
      hasMountedPoolDetails ? 0 : DEFERRED_POOL_DETAILS_DELAY_MS;
    return scheduleDeferredActivation(() => {
      setHasMountedPoolDetails(true);
      setPoolDetailsVisible(true);
    }, revealDelayMs);
  }, [
    birdsEyeTab,
    hasIncentivesTab,
    hasMountedPoolDetails,
    poolDetailsReady,
    poolDetailsVisible,
  ]);

  useEffect(() => {
    if (birdsEyeTab !== "pools" || data.isLoading || poolDepthMetricsRequested) return;
    if (hasIncentivesTab && !poolDetailsVisible) return;
    return scheduleDeferredActivation(
      requestPoolDepthMetrics,
      hasIncentivesTab ? 6000 : 450
    );
  }, [
    birdsEyeTab,
    data.isLoading,
    hasIncentivesTab,
    poolDepthMetricsRequested,
    poolDetailsVisible,
    requestPoolDepthMetrics,
  ]);

  const shouldRenderPoolDetails =
    poolDetailsReady && hasMountedPoolDetails;
  const shouldRevealPoolDetails = shouldRenderPoolDetails && poolDetailsVisible;
  const activeKatanaPanelHeight =
    birdsEyeTab === "pools" ? katanaPanelHeights.pools : katanaPanelHeights.incentives;
  const fallbackKatanaPanelHeight =
    birdsEyeTab === "pools"
      ? 240 + 360 + DEPTH_PLACEHOLDER_MIN_HEIGHT + 320
      : 520;
  const katanaPanelStackStyle = useMemo<CSSProperties>(
    () => ({
      ...cachedTabStackBaseStyle,
      height: activeKatanaPanelHeight || fallbackKatanaPanelHeight,
      minHeight: activeKatanaPanelHeight || fallbackKatanaPanelHeight,
    }),
    [activeKatanaPanelHeight, fallbackKatanaPanelHeight]
  );

  const poolHealthSection = (
    <div id="pool-health" className="scroll-mt-20">
      <BirdsEyeSectionDivider label="Pool Health" />
      <BirdsEyeTable
        pools={data.pools}
        isLoading={
          data.isLoading ||
          !poolDepthMetricsRequested ||
          data.depthMetricsLoading
        }
      />
    </div>
  );
  const poolDepthSections = (
    <>
      {shouldRenderPoolDetails ? (
        <CachedPoolDetails active={shouldRevealPoolDetails}>
          <ViewportDeferredSection
            id="liquidity-fragility"
            minHeight={360}
            onNear={requestPoolDepthMetrics}
          >
            <LiquidityDistributionSection pools={deferredPools} spaceSlug={currentSpace?.slug} />
          </ViewportDeferredSection>
          <LazyDepthRouting
            pools={deferredPools}
            onNear={requestPoolDepthMetrics}
            renderDelayMs={hasIncentivesTab ? 2600 : 0}
          />
        </CachedPoolDetails>
      ) : null}
      {!shouldRevealPoolDetails ? (
        <>
          <DeferredPoolSectionPlaceholder minHeight={360} />
          <DeferredPoolSectionPlaceholder minHeight={DEPTH_PLACEHOLDER_MIN_HEIGHT} />
        </>
      ) : null}
    </>
  );
  const lpAggregateSection = (
    <>
      {shouldRenderPoolDetails ? (
        <CachedPoolDetails active={shouldRevealPoolDetails}>
          <ViewportDeferredSection
            id="lp-constellation"
            minHeight={320}
          >
            <BirdsEyeLpAggregateTable pools={deferredPools} spaceSlug={currentSpace?.slug} />
          </ViewportDeferredSection>
        </CachedPoolDetails>
      ) : null}
      {!shouldRevealPoolDetails ? (
        <DeferredPoolSectionPlaceholder minHeight={320} />
      ) : null}
    </>
  );
  // 0G AI: pool price vs Binance spot reference, rendered above Top LPs.
  const priceComparisonSection =
    currentSpace?.slug === ZEROG_SPACE_SLUG ? (
      <>
        {shouldRenderPoolDetails ? (
          <CachedPoolDetails active={shouldRevealPoolDetails}>
            <ViewportDeferredSection id="price-comparison" minHeight={360}>
              <BirdsEyePriceComparisonChart
                pools={deferredPools}
                spaceSlug={currentSpace?.slug}
              />
            </ViewportDeferredSection>
          </CachedPoolDetails>
        ) : null}
        {!shouldRevealPoolDetails ? (
          <DeferredPoolSectionPlaceholder minHeight={360} />
        ) : null}
      </>
    ) : null;

  return (
    <div className="dashboard-canvas-wrapper relative">
      <BirdsEyeSettingsFab supportedPools={supportedPools} />
      <div className="dashboard-canvas">
        <div className="flex-1 overflow-auto dashboard-canvas">
          <div className="flex flex-col">
            {/* Header: static title + tab toggle */}
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6">
              <div className="flex items-center gap-2.5">
                <div className="w-1 h-4 bg-[var(--bp-accent-primary)] rounded-full" />
                <div className="flex items-center gap-1 bg-gray-100/70 dark:bg-gray-800/50 rounded-lg p-0.5">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleTabClick(tab.id)}
                      className={cn(
                        "cursor-pointer px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all duration-200 ease-out active:scale-[0.97]",
                        visualBirdsEyeTab === tab.id
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:bg-white/70 hover:text-gray-800 hover:shadow-sm dark:hover:bg-gray-700/60 dark:hover:text-gray-200"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <h2 className="text-sm font-semibold tracking-wide text-[var(--bp-text-primary)]">
                  Birds-eye View
                </h2>
              </div>

            </div>

            {/* Content */}
            {hasIncentivesTab ? (
              <div style={katanaPanelStackStyle}>
                {hasOpenedPools ? (
                  <CachedTabPanel
                    active={birdsEyeTab === "pools"}
                    className="flex flex-col"
                    panelRef={poolsPanelRef}
                  >
                    {poolHealthSection}
                    {poolDepthSections}
                    {priceComparisonSection}
                    {lpAggregateSection}
                  </CachedTabPanel>
                ) : null}
                {hasOpenedIncentives ? (
                  <CachedTabPanel
                    active={birdsEyeTab === "incentives"}
                    panelRef={incentivesPanelRef}
                  >
                    {incentivesSpaceSlug === MONAD_SPACE_SLUG ? (
                      <BirdsEyeMonadIncentives />
                    ) : incentivesSpaceSlug === ZEROG_SPACE_SLUG ? (
                      <BirdsEyeZerogIncentives />
                    ) : (
                      <BirdsEyeKatanaIncentives />
                    )}
                  </CachedTabPanel>
                ) : null}
              </div>
            ) : birdsEyeTab === "slas" ? (
              <BirdsEyeSlasTable spaceSlug={currentSpace?.slug} />
            ) : birdsEyeTab === "pools" ? (
              <div className="flex flex-col">
                {hasIncentivesTab ? poolHealthSection : poolDepthSections}
                {hasIncentivesTab ? poolDepthSections : poolHealthSection}
                {priceComparisonSection}
                {lpAggregateSection}
              </div>
            ) : birdsEyeTab === "incentives" ? (
              hasOpenedIncentives
                ? incentivesSpaceSlug === MONAD_SPACE_SLUG
                  ? <BirdsEyeMonadIncentives />
                  : incentivesSpaceSlug === ZEROG_SPACE_SLUG
                    ? <BirdsEyeZerogIncentives />
                    : <BirdsEyeKatanaIncentives />
                : null
            ) : birdsEyeTab === "rfq" ? (
              <div className="flex flex-col">
                <BirdsEyeRfqTable rows={rfqData.rows} />
                <BirdsEyeMakerVolumeChart pools={data.pools} />
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-4 px-4 md:px-6">
                <BirdsEyeFlowsChart
                  spaceSlug={currentSpace?.slug}
                  enabled={birdsEyeTab === "flows" && hasFlowsTab}
                />
                <BirdsEyeFlowsCostChart
                  spaceSlug={currentSpace?.slug}
                  enabled={birdsEyeTab === "flows" && hasFlowsTab}
                />
              </div>
            )}

            {/* Footer */}
            <div className="text-center py-4">
              <span className="text-[10px] font-mono text-gray-300 dark:text-gray-600 tracking-wider">
                LAST SYNC &middot;{" "}
                {new Date().toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).toUpperCase()}{" "}
                &middot;{" "}
                {new Date().toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: "UTC",
                })}{" "}
                UTC
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
