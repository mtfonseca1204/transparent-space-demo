"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useSidebarStore } from "@/stores/sidebar-store";
import { DEMO_SPACE_SLUG } from "@/lib/demo/constants";
import { useCurrentSpaceSlug } from "@/hooks/use-current-space-slug";

export const DashboardWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const isOpen = useSidebarStore((state) => state.isOpen);
  const currentSpaceSlug = useCurrentSpaceSlug();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection using matchMedia
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    // Set initial state
    handleMediaChange(mediaQuery);

    // Listen for changes
    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, []);

  // Sidebar width: 287 open, 77 collapsed. No outer padding — main content sits flush.
  const marginLeft = isMobile ? 0 : isOpen ? 287 : 77;

  return (
    <div className="bp-grid-background min-h-screen">
      <motion.div
        ref={wrapperRef}
        className="dashboard-canvas-wrapper"
        animate={{
          marginLeft,
        }}
        transition={{
          duration: 0.3,
          ease: "easeInOut",
        }}
      >
        <div className="dashboard-canvas border-l border-[var(--ts-line)] min-h-screen">
          {currentSpaceSlug === DEMO_SPACE_SLUG ? (
            <div className="pointer-events-none fixed right-4 top-3 z-50 border border-[var(--ts-line)] bg-[var(--ts-surface)]/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ts-ink-2)] shadow-sm backdrop-blur">
              Demo data
            </div>
          ) : null}
          {children}
        </div>
      </motion.div>
    </div>
  );
};

export default DashboardWrapper;
