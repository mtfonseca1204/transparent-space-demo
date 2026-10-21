"use client";

import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check } from "lucide-react";
import { getLpMeta } from "@/lib/lp-labels";

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / blocked clipboard API
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

export const CurrentLPs = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("", className)}>
      {children}
    </div>
  );
};

export const CurrentLPsHeader = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("bp-table-header", className)}>
      {children}
    </div>
  );
};

export const CurrentLPsTitle = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <span className={cn("", className)}>
      {children}
    </span>
  );
};

export const CurrentLPsList = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("", className)}>{children}</div>
  );
};

export const CurrentLPsRow = ({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) => {
  return (
    <div
      className={cn("bp-table-row", className)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      {children}
    </div>
  );
};

export const LPAddress = ({
  children,
  fullAddress,
  spaceSlug,
  className,
}: {
  children: React.ReactNode;
  fullAddress?: string;
  spaceSlug?: string | null;
  className?: string;
}) => {
  const textToCopy = useMemo(() => {
    if (typeof fullAddress === "string" && fullAddress.length > 0) return fullAddress;
    if (typeof children === "string" && children.length > 0) return children;
    return "";
  }, [children, fullAddress]);
  const meta = useMemo(
    () => getLpMeta(textToCopy || fullAddress, spaceSlug),
    [textToCopy, fullAddress, spaceSlug]
  );

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {meta?.logoSrc && (
        <img
          src={meta.logoSrc}
          alt={`${meta.label} logo`}
          className="w-4 h-4 rounded-sm"
          loading="lazy"
        />
      )}
      <span className="bp-address select-text" title={textToCopy || undefined}>
        {children}
      </span>

      <button
        type="button"
        className={cn(
          "inline-flex items-center justify-center border border-[var(--bp-border-secondary)] bg-[var(--bp-bg-card)] w-6 h-6 text-[var(--bp-text-muted)] hover:bg-[var(--bp-accent-glow)] hover:text-[var(--bp-accent-primary)] hover:border-[var(--bp-border-accent)] transition-colors",
          !textToCopy && "opacity-50 cursor-not-allowed"
        )}
        aria-label={copied ? "Copied" : "Copy address"}
        title={copied ? "Copied" : "Copy"}
        disabled={!textToCopy}
        onClick={async (e) => {
          e.stopPropagation();
          if (!textToCopy) return;
          const ok = await copyTextToClipboard(textToCopy);
          if (ok) setCopied(true);
        }}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  );
};

export const LPSize = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <span className={cn("bp-size", className)}>
      {children}
    </span>
  );
};
