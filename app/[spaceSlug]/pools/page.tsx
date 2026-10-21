"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/sidebar/sidebar";
import { DashboardWrapper } from "@/components/dashboard/dashboard-wrapper";
import { DashboardRouteSkeleton } from "@/components/dashboard/dashboard-route-skeleton";
import { KrakenPoolsDashboard } from "@/components/dashboard/kraken-pools/kraken-pools-dashboard";
import { useAuthStore } from "@/lib/auth-store";
import { isPoolsDirectorySpace } from "@/lib/space-policy";
import { usePoolStore } from "@/stores/pool-store";

export default function KrakenPoolsPage() {
  const { spaceSlug } = useParams<{ spaceSlug: string }>();
  const router = useRouter();

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionChecked = useAuthStore((s) => s.sessionChecked);
  const spaces = useAuthStore((s) => s.spaces);
  const currentSpaceId = useAuthStore((s) => s.currentSpaceId);
  const hydrateSession = useAuthStore((s) => s.hydrateSession);
  const switchSpace = useAuthStore((s) => s.switchSpace);
  const setSpaceSlug = usePoolStore((s) => s.setSpaceSlug);

  const urlSpace = spaces.find((space) => space.slug === spaceSlug);

  useEffect(() => {
    if (!sessionChecked) {
      void hydrateSession();
      return;
    }

    if (!isAuthenticated) {
      router.replace("/");
    }
  }, [hydrateSession, isAuthenticated, router, sessionChecked]);

  useEffect(() => {
    if (urlSpace && urlSpace.id !== currentSpaceId) {
      switchSpace(urlSpace.id);
    }
  }, [currentSpaceId, switchSpace, urlSpace]);

  useEffect(() => {
    if (spaceSlug) {
      setSpaceSlug(spaceSlug);
    }
  }, [setSpaceSlug, spaceSlug]);

  if (!sessionChecked) {
    return <DashboardRouteSkeleton />;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!urlSpace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="mb-2 text-lg font-semibold text-gray-800">Space not found</h2>
          <p className="mb-4 text-sm text-gray-500">
            You don&apos;t have access to &quot;{spaceSlug}&quot; or it doesn&apos;t exist.
          </p>
          <button
            onClick={() => router.replace("/")}
            className="cursor-pointer text-sm text-blue-600 hover:text-blue-700"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <DashboardWrapper>
        {isPoolsDirectorySpace(spaceSlug) ? (
          <KrakenPoolsDashboard />
        ) : (
          <div className="flex min-h-[60vh] items-center justify-center px-4 text-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
                Pools directory unavailable
              </h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                This section is currently available only for Kraken-like spaces.
              </p>
            </div>
          </div>
        )}
      </DashboardWrapper>
    </div>
  );
}
