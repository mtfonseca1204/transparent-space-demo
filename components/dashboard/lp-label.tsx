"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLpLabel, getLpMeta } from "@/lib/lp-labels";

interface LpLabelProps {
  address: string;
  spaceSlug?: string | null;
  className?: string;
  /** Tailwind classes applied to the text span. */
  textClassName?: string;
  /** Pixel size for the logo / colored dot. Defaults to 12. */
  iconSize?: number;
  /** Hide the copy button. Defaults to true (visible). */
  showCopy?: boolean;
}

/**
 * Renders an LP/MM identifier as: [logo or colored dot] [label] [copy button].
 *
 * - Falls back to the dot when the meta has a `color` but no `logoSrc`.
 * - Falls back to the truncated address when the meta is unknown.
 * - The copy button is its own button so click handlers on parents (e.g.
 *   row-select) keep working — propagation is stopped only on the copy itself.
 */
export function LpLabel({
  address,
  spaceSlug,
  className,
  textClassName,
  iconSize = 12,
  showCopy = true,
}: LpLabelProps) {
  const meta = getLpMeta(address, spaceSlug);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Browsers can deny clipboard access (insecure context, permissions);
      // we silently no-op rather than spamming the console for every row.
    }
  };

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={address}
    >
      {meta?.logoSrc ? (
        <img
          src={meta.logoSrc}
          alt={`${meta.label} logo`}
          className="rounded-sm shrink-0"
          style={{ width: iconSize, height: iconSize }}
          loading="lazy"
        />
      ) : meta?.color ? (
        <span
          aria-hidden
          className="rounded-full shrink-0"
          style={{
            width: iconSize,
            height: iconSize,
            background: meta.color,
            boxShadow: "inset 0 0 0 1px rgba(10,9,6,0.12)",
          }}
        />
      ) : null}
      <span className={textClassName}>{formatLpLabel(address, spaceSlug)}</span>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 inline-flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors cursor-pointer"
          title={copied ? "Copied!" : "Copy address"}
          aria-label={copied ? "Address copied" : "Copy address"}
        >
          {copied ? (
            <Check className="w-3 h-3" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      )}
    </span>
  );
}
