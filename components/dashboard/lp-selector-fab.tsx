"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, X } from "lucide-react";
import type { OwnerPositionAggregateData } from "@/lib/envio-client";
import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";

export function LPSelectorFab(props: {
  lps: OwnerPositionAggregateData[] | undefined;
  selectedOwner: string | null;
  onSelect: (owner: string) => void;
  spaceSlug?: string | null;
  className?: string;
}) {
  const { lps, selectedOwner, onSelect, spaceSlug, className } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const rows = lps ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.owner.toLowerCase().includes(q)) return true;
      const meta = getLpMeta(r.owner, spaceSlug);
      return !!meta?.label.toLowerCase().includes(q);
    });
  }, [lps, query, spaceSlug]);

  return (
    <>
      {/* FAB */}
      <div className={cn("fixed bottom-6 right-6 z-50", className)}>
        <Button
          className="rounded-full shadow-lg h-11 px-4 gap-2"
          onClick={() => setOpen(true)}
        >
          <Users className="w-4 h-4" />
          Select LP
        </Button>
      </div>

      {/* Modal */}
      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-2xl max-w-xl mx-auto overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">
                  Select LP
                </div>
                <button
                  type="button"
                  className="w-9 h-9 inline-flex items-center justify-center rounded-md hover:bg-gray-50 text-gray-600"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by address (0x...)"
                />

                <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-50 border border-gray-100 rounded-lg">
                  {filtered.length === 0 ? (
                    <div className="text-sm text-gray-500 px-3 py-6 text-center">
                      No LPs found
                    </div>
                  ) : (
                    filtered.slice(0, 100).map((lp) => {
                      const isSelected =
                        !!selectedOwner &&
                        selectedOwner.toLowerCase() === lp.owner.toLowerCase();
                      return (
                        <button
                          key={lp.id}
                          type="button"
                          className={cn(
                            "w-full px-3 py-3 flex items-center justify-between text-left hover:bg-gray-50",
                            isSelected && "bg-gray-50"
                          )}
                          onClick={() => {
                            onSelect(lp.owner);
                            setOpen(false);
                          }}
                        >
                          <span className="inline-flex items-center gap-2 font-mono text-sm text-gray-800">
                            {(() => {
                              const meta = getLpMeta(lp.owner, spaceSlug);
                              return meta?.logoSrc ? (
                                <img
                                  src={meta.logoSrc}
                                  alt={`${meta.label} logo`}
                                  className="w-4 h-4 rounded-sm"
                                  loading="lazy"
                                />
                              ) : null;
                            })()}
                            {formatLpLabel(lp.owner, spaceSlug)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {lp.liquidityTotal}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

