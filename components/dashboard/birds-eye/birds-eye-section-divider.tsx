"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Section divider used at the top of every Birds-eye section (Pool Health,
 * Depth, Liquidity Distribution, etc.). It paints two thin rules with the
 * section label centered between them and changes accent color on hover so
 * that the section is visually scannable. Sections separated by this divider
 * meet edge-to-edge — no outer gap, no rounded card border.
 */
export function BirdsEyeSectionDivider({ label }: { label: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex items-center gap-6 cursor-pointer border-b border-gray-200 px-4 py-3 dark:border-gray-700 md:px-6"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex-1 h-px transition-all duration-300",
          hovered ? "bg-[var(--bp-accent-primary)]" : "bg-[var(--bp-border-subtle)]",
        )}
      />
      <h2
        className={cn(
          "text-sm uppercase tracking-[0.2em] whitespace-nowrap transition-colors duration-300",
          hovered ? "text-[var(--bp-accent-primary)]" : "text-[var(--bp-text-primary)]",
        )}
        style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}
      >
        {label}
      </h2>
      <div
        className={cn(
          "flex-1 h-px transition-all duration-300",
          hovered ? "bg-[var(--bp-accent-primary)]" : "bg-[var(--bp-border-subtle)]",
        )}
      />
    </div>
  );
}
