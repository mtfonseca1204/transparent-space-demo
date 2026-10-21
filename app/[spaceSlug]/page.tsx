"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Sidebar from "@/components/sidebar/sidebar";
import { Dashboard } from "@/components/dashboard";
import { DashboardRouteSkeleton } from "@/components/dashboard/dashboard-route-skeleton";
import { DashboardWrapper } from "@/components/dashboard/dashboard-wrapper";
import { TokenBirdsEyeDashboard } from "@/components/dashboard/token-birds-eye-dashboard";
import { RfqDepthDashboard } from "@/components/dashboard/rfq/rfq-depth-dashboard";
import { RfqCowswapDashboard } from "@/components/dashboard/rfq/rfq-cowswap-dashboard";
import { RfqBebopDashboard } from "@/components/dashboard/rfq/rfq-bebop-dashboard";
import { Rfq0xDashboard } from "@/components/dashboard/rfq/rfq-0x-dashboard";
import { Rfq1inchDashboard } from "@/components/dashboard/rfq/rfq-1inch-dashboard";
import { RfqJupzDashboard } from "@/components/dashboard/rfq/rfq-jupz-dashboard";
import { BirdsEyeDashboard } from "@/components/dashboard/birds-eye/birds-eye-dashboard";
import { HyperliquidDashboard } from "@/components/hyperliquid/hyperliquid-dashboard";
import { TokenPricesPrefetch } from "@/components/token-prices-prefetch";
import { useAuthStore } from "@/lib/auth-store";
import { useTokenViewStore, type DashboardView } from "@/stores/token-view-store";
import { usePoolStore } from "@/stores/pool-store";
import { PoolUrlSync } from "@/components/pool/pool-url-sync";
import { isHyperliquidSpace, isRfqDisabledSpace } from "@/lib/space-policy";
import {
  resolveDashboardViewForSpace,
  resolvePoolKeyForSpace,
  resolveSelectedTokenForSpace,
} from "@/lib/demo/asset-resolution";
import { normalizePoolKeyInput } from "@/lib/pools";

const RFQ_DASHBOARD_KINDS = new Set<DashboardView["kind"]>([
  "rfq",
  "rfq-cowswap",
  "rfq-bebop",
  "rfq-0x",
  "rfq-1inch",
  "rfq-jupz",
]);

function isRfqDashboardView(view: DashboardView) {
  return RFQ_DASHBOARD_KINDS.has(view.kind);
}

function dashboardViewsEqual(left: DashboardView, right: DashboardView): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "token" && right.kind === "token") return left.symbol === right.symbol;
  if (left.kind === "rfq" && right.kind === "rfq") return left.poolKey === right.poolKey;
  if (
    (left.kind === "rfq-cowswap" ||
      left.kind === "rfq-bebop" ||
      left.kind === "rfq-0x" ||
      left.kind === "rfq-1inch" ||
      left.kind === "rfq-jupz") &&
    left.kind === right.kind
  ) {
    return left.asset === right.asset;
  }
  return true;
}

/**
 * Space dashboard — /{spaceSlug}?pool=...
 *
 * Validates that:
 * 1. User is authenticated
 * 2. User has access to this space
 * 3. Pools shown belong to this space only
 */
export default function SpaceDashboard() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const appliedPoolViewFromUrlRef = useRef<string | null>(null);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const hydrateSession = useAuthStore((s) => s.hydrateSession);
  const switchSpace = useAuthStore((s) => s.switchSpace);

  const selectedTokenSymbol = useTokenViewStore((s) => s.selectedTokenSymbol);
  const dashboardView = useTokenViewStore((s) => s.dashboardView);
  const setBirdsEyeView = useTokenViewStore((s) => s.setBirdsEyeView);
  const setViewState = useTokenViewStore((s) => s.setViewState);
  const setSpaceSlug = usePoolStore((s) => s.setSpaceSlug);
  const supportedPools = usePoolStore((s) => s.supportedPools);
  const poolFromUrlRaw = searchParams.get("pool");
  const poolFromUrl = poolFromUrlRaw
    ? resolvePoolKeyForSpace(poolFromUrlRaw, spaceSlug) ?? normalizePoolKeyInput(poolFromUrlRaw)
    : null;
  const isPoolFromUrlInSpace = poolFromUrl
    ? supportedPools.some((pool) => pool.poolKey === poolFromUrl)
    : false;

  // Find the space matching the URL slug
  const urlSpace = spaces.find((s) => s.slug === spaceSlug);
  const shouldHideRfqView = isRfqDisabledSpace(spaceSlug) && isRfqDashboardView(dashboardView);
  const spaceResolvedDashboardView = resolveDashboardViewForSpace(dashboardView, spaceSlug);
  const spaceResolvedSelectedToken = resolveSelectedTokenForSpace(
    selectedTokenSymbol,
    spaceResolvedDashboardView,
    spaceSlug
  );
  const needsSpaceStateSanitization =
    spaceResolvedSelectedToken !== selectedTokenSymbol ||
    !dashboardViewsEqual(spaceResolvedDashboardView, dashboardView);
  const effectiveDashboardView: DashboardView = shouldHideRfqView
    ? { kind: "birds-eye" }
    : spaceResolvedDashboardView;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!sessionChecked) {
      void hydrateSession();
      return;
    }

    if (!isAuthenticated) {
      router.replace("/");
    }
  }, [hydrateSession, isAuthenticated, router, sessionChecked]);

  // If the URL space doesn't match the current space, sync it
  useEffect(() => {
    if (urlSpace && urlSpace.id !== currentSpaceId) {
      switchSpace(urlSpace.id);
    }
  }, [urlSpace, currentSpaceId, switchSpace]);

  // Sync pool store with the current space slug from URL
  useEffect(() => {
    if (spaceSlug) {
      setSpaceSlug(spaceSlug);
    }
  }, [spaceSlug, setSpaceSlug]);

  useEffect(() => {
    if (shouldHideRfqView) {
      setBirdsEyeView();
    }
  }, [setBirdsEyeView, shouldHideRfqView]);

  useEffect(() => {
    if (needsSpaceStateSanitization) {
      setViewState({
        selectedTokenSymbol: spaceResolvedSelectedToken,
        dashboardView: spaceResolvedSelectedToken
          ? { kind: "token", symbol: spaceResolvedSelectedToken }
          : spaceResolvedDashboardView,
      });
    }
  }, [
    needsSpaceStateSanitization,
    setViewState,
    spaceResolvedDashboardView,
    spaceResolvedSelectedToken,
  ]);

  useEffect(() => {
    if (!poolFromUrl || !isPoolFromUrlInSpace) return;
    if (appliedPoolViewFromUrlRef.current === poolFromUrl) return;

    appliedPoolViewFromUrlRef.current = poolFromUrl;
    if (dashboardView.kind === "pool") return;

    setViewState({
      selectedTokenSymbol: null,
      dashboardView: { kind: "pool" },
    });
  }, [dashboardView.kind, isPoolFromUrlInSpace, poolFromUrl, setViewState]);

  if (!sessionChecked) {
    return <DashboardRouteSkeleton />;
  }

  // Not authenticated — show nothing while redirecting
  if (!isAuthenticated) {
    return null;
  }

  if (needsSpaceStateSanitization) {
    return <DashboardRouteSkeleton />;
  }

  // Space not found or user doesn't have access
  if (!urlSpace) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            Space not found
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            You don&apos;t have access to &quot;{spaceSlug}&quot; or it doesn&apos;t exist.
          </p>
          <button
            onClick={() => router.replace("/")}
            className="text-sm text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  const hasPools = supportedPools.length > 0;
  const hasHyperliquidDashboard = isHyperliquidSpace(spaceSlug);

  return (
    <div className="min-h-screen">
      {hasPools && <TokenPricesPrefetch />}
      {hasPools && <PoolUrlSync />}
      <Sidebar />
      <DashboardWrapper>
        {hasHyperliquidDashboard ? (
          <HyperliquidDashboard />
        ) : hasPools ? (
          effectiveDashboardView.kind === "birds-eye" ? (
            <BirdsEyeDashboard />
          ) : effectiveDashboardView.kind === "rfq" ? (
            <RfqDepthDashboard poolKey={effectiveDashboardView.poolKey} />
          ) : effectiveDashboardView.kind === "rfq-cowswap" ? (
            <RfqCowswapDashboard asset={effectiveDashboardView.asset} />
          ) : effectiveDashboardView.kind === "rfq-bebop" ? (
            <RfqBebopDashboard asset={effectiveDashboardView.asset} />
          ) : effectiveDashboardView.kind === "rfq-0x" ? (
            <Rfq0xDashboard asset={effectiveDashboardView.asset} />
          ) : effectiveDashboardView.kind === "rfq-1inch" ? (
            <Rfq1inchDashboard asset={effectiveDashboardView.asset} />
          ) : effectiveDashboardView.kind === "rfq-jupz" ? (
            <RfqJupzDashboard asset={effectiveDashboardView.asset} />
          ) : spaceResolvedSelectedToken ? (
            <TokenBirdsEyeDashboard />
          ) : (
            <Dashboard />
          )
        ) : (
          <EmptySpaceDashboard spaceName={urlSpace.name} />
        )}
      </DashboardWrapper>
    </div>
  );
}

function EmptySpaceDashboard({ spaceName }: { spaceName: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
        <span className="text-2xl font-bold text-gray-400 dark:text-gray-500">
          {spaceName.charAt(0)}
        </span>
      </div>
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
        {spaceName}
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
        No pools have been configured for this space yet. An admin will set up the pools and dashboards.
      </p>
    </div>
  );
}
