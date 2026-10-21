"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type RfqTab = "price-impact" | "total-cost" | "route-split" | "depth-curve" | "depth" | "historical";

const TABS: { id: RfqTab; label: string }[] = [
  { id: "depth", label: "Depth" },
  { id: "historical", label: "Historical" },
  { id: "price-impact", label: "Price Impact" },
  { id: "total-cost", label: "Total Cost" },
  { id: "route-split", label: "Route Split" },
  { id: "depth-curve", label: "Implied Price" },
];

interface RfqTabNavProps {
  activeTab: RfqTab;
  onChange: (tab: RfqTab) => void;
}

export function RfqTabNav({ activeTab, onChange }: RfqTabNavProps) {
  return (
    <div className="border-b border-[var(--bp-border-secondary)]">
      <nav className="flex gap-0.5" aria-label="RFQ dashboard tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "px-4 py-2.5 text-[13px] font-semibold tracking-wide transition-colors relative whitespace-nowrap cursor-pointer",
              activeTab === tab.id
                ? "text-[var(--bp-accent-primary)]"
                : "text-[var(--bp-text-secondary)] hover:text-[var(--bp-text-primary)]"
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--bp-accent-primary)] rounded-full" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
