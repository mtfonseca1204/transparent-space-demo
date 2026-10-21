"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/auth/login";
import { useAuthStore } from "@/lib/auth-store";

/**
 * Root page — login only.
 * Once authenticated, redirects to /{spaceSlug}.
 * Presentation deploys auto-enter Demo with no email/password.
 */
export default function Home() {
  const {
    isAuthenticated,
    login,
    isLoading,
    error,
    needsSpaceSelection,
    mustChangePassword,
    _tempPassword,
    spaces,
    email,
    currentSpaceId,
    sessionChecked,
    selectSpaceAndComplete,
    changePassword,
    hydrateSession,
    refreshSpaces,
    logout,
  } = useAuthStore();
  const router = useRouter();
  const [presentationBooting, setPresentationBooting] = useState(true);

  const currentSpace = spaces.find((s) => s.id === currentSpaceId);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // Recruiter / presentation deploys: enter Demo with no login form.
        const enter = await fetch("/api/auth/presentation-enter", {
          method: "POST",
          cache: "no-store",
        });
        if (cancelled) return;

        if (enter.ok) {
          const data = (await enter.json()) as { redirectTo?: string };
          await hydrateSession();
          if (cancelled) return;
          router.replace(data.redirectTo || "/demo");
          return;
        }

        if (!mustChangePassword && !needsSpaceSelection) {
          await hydrateSession();
        }
      } catch {
        if (!cancelled && !mustChangePassword && !needsSpaceSelection) {
          await hydrateSession();
        }
      } finally {
        if (!cancelled) setPresentationBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [hydrateSession, mustChangePassword, needsSpaceSelection, router]);

  // Redirect to space dashboard once authenticated
  useEffect(() => {
    if (isAuthenticated && currentSpace?.slug) {
      router.replace(`/${currentSpace.slug}`);
    }
  }, [isAuthenticated, currentSpace?.slug, router]);

  // Refresh persisted auth state from the server-backed session.
  useEffect(() => {
    if (email && isAuthenticated) {
      void refreshSpaces();
    }
  }, [email, isAuthenticated, refreshSpaces]);

  if (presentationBooting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bp-bg-primary,#f6f8fc)]">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--bp-text-muted,#64708a)]">
          Opening Demo…
        </p>
      </div>
    );
  }

  // Already authenticated — show nothing while redirecting
  if (isAuthenticated && currentSpace?.slug) {
    return null;
  }

  if (!sessionChecked && !mustChangePassword && !needsSpaceSelection) {
    return null;
  }

  // Show login screen (email+password step, change-password step, or space selection step)
  return (
    <LoginScreen
      onLogin={login}
      isLoading={isLoading}
      error={error}
      needsSpaceSelection={needsSpaceSelection}
      mustChangePassword={mustChangePassword}
      tempPassword={_tempPassword}
      spaces={spaces}
      email={email}
      onSelectSpace={selectSpaceAndComplete}
      onChangePassword={changePassword}
      onBack={logout}
    />
  );
}
