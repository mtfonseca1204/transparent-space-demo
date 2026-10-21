"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { getDemoTokenLogo } from "@/lib/demo/logos";

const KATANA_VB_ETH_ICON =
  "https://cdn.sushi.com/image/upload/f_auto,c_limit,w_96/d_unknown.png/native-currency/ethereum.svg";
const DUST_ICON =
  "https://cdn.dexscreener.com/cms/images/a7efe29afe139ac03be1028f0a76ec91169a6961bbda55b70060a8692ba7d09e?width=64&height=64&fit=crop&quality=95&format=auto";
const W0G_ICON =
  "https://storage.googleapis.com/merkl-static-assets/tokens/w0G.svg";
const BSC_0G_ICON =
  "https://tokens.pancakeswap.finance/images/0x4B948d64dE1F71fCd12fB586f4c776421a35b3eE.png";

export const PoolHeader = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "ts-topbar relative z-[1] border-b border-[var(--ts-line)]",
        className
      )}
    >
      <div className="relative flex items-center gap-5 px-7 py-5">
        {children}
      </div>
    </div>
  );
};

export const PoolInfo = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("flex flex-col gap-2.5 min-w-0", className)}>{children}</div>
  );
};

export const PoolName = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  // If children is a string like "CRCLx/USDC", render with styled separator
  const content = typeof children === "string" && children.includes("/")
    ? (() => {
        const [a, b] = children.split("/");
        return (
          <>
            <span>{a}</span>
            <span className="text-[var(--ts-ink-3)] font-normal text-[18px] relative top-[-1px]">&times;</span>
            <span>{b}</span>
          </>
        );
      })()
    : children;

  return (
    <span
      className={cn(
        "ts-pool-title",
        className
      )}
    >
      {content}
    </span>
  );
};

export const PoolBadges = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("ts-spec-chips", className)}>{children}</div>
  );
};

export const PoolBadge = ({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "primary";
  className?: string;
}) => {
  return (
    <span
      className={cn(
        "ts-spec-chip",
        variant === "primary" && "ts-spec-chip-accent",
        className
      )}
    >
      {children}
    </span>
  );
};

export const PoolTokens = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("ts-coin-frame", className)}>
      <div className="ts-coin-stack">
        {children}
      </div>
    </div>
  );
};

export const TokenIcon = ({
  symbol,
  className,
  src,
}: {
  symbol: "WLD" | "USDC" | string;
  className?: string;
  src?: string | null;
}) => {
  // Map common token symbols to their icons
  const getIconSrc = (sym: string): string => {
    const normalizedSymbol = sym.toUpperCase();
    const demoLogo = getDemoTokenLogo(normalizedSymbol);
    if (demoLogo) return demoLogo;
    if (normalizedSymbol === "AI") {
      return "https://assets.coingecko.com/coins/images/71027/standard/gensyn.png?1765331043";
    }
    if (normalizedSymbol === "STRCX") {
      return "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234";
    }
    if (normalizedSymbol === "PRL") return "/icons/perle-logo.webp";
    if (normalizedSymbol === "WLD") return "/icons/worldcoin-icon.svg";
    if (normalizedSymbol === "EURC") return "/icons/eurc-icon.png";
    if (normalizedSymbol === "OXAUT") return "/icons/oxaut-icon.png";
    if (normalizedSymbol === "DUST") return DUST_ICON;
    if (normalizedSymbol === "W0G") return W0G_ICON;
    if (normalizedSymbol === "0G") return BSC_0G_ICON;
    if (normalizedSymbol === "VBETH" || normalizedSymbol === "VBUSDC") {
      return KATANA_VB_ETH_ICON;
    }
    if (normalizedSymbol.includes("USDT")) return "/icons/usdt-icon.svg";
    if (normalizedSymbol.includes("USDC")) return "/icons/usdc-icon.svg";
    if (normalizedSymbol === "WARS" || normalizedSymbol === "WARS") {
      return "https://coin-images.coingecko.com/coins/images/70846/large/world_logos_wars_logo_3.png?1764176749";
    }
    if (normalizedSymbol === "WBTC" || normalizedSymbol === "BTC") {
      return "https://token-icons.s3.amazonaws.com/btc.png";
    }
    if (normalizedSymbol === "WETH" || normalizedSymbol === "ETH") {
      return "https://token-icons.s3.amazonaws.com/eth.png";
    }
    if (normalizedSymbol === "MADS") {
      return "/icons/mads-icon.png";
    }
    // xStocks tokens — logos from Backed Finance metadata API
    const XSTOCKS_TOKENS: Record<string, string> = {
      TSLAX: "TSLAx",
      NVDAX: "NVDAx",
      SPYX: "SPYx",
      QQQX: "QQQx",
      GLDX: "GLDx",
      GOOGLX: "GOOGLx",
      HOODX: "HOODx",
      CRCLX: "CRCLx",
      METAX: "METAx",
      COINX: "COINx",
      SPCXX: "SPCXx",
    };
    const xstocksKey = XSTOCKS_TOKENS[normalizedSymbol];
    if (xstocksKey) {
      return `https://xstocks-metadata.backed.fi/logos/tokens/${xstocksKey}.png`;
    }
    // Fallback for unknown tokens
    return "/icons/usdc-icon.svg";
  };

  const iconSrc = src ?? getIconSrc(symbol);

  return (
    <div className={cn("ts-coin", className)}>
      <img
        src={iconSrc}
        alt={symbol}
        className="w-full h-full object-cover rounded-full"
      />
    </div>
  );
};

/** Readout: label + value + optional delta, as seen in the instrument strip */
export const PoolReadout = ({
  label,
  value,
  delta,
  deltaDirection,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
}) => {
  return (
    <span className="ts-readout">
      <span className="ts-readout-label">{label}</span>
      <span className="ts-readout-value">{value}</span>
      {delta && (
        <span
          className={cn(
            "ts-readout-delta",
            deltaDirection === "down" && "down"
          )}
        >
          {delta}
        </span>
      )}
    </span>
  );
};

/** Vertical separator for the sub-meta row */
export const PoolSubDivider = () => (
  <span className="ts-sub-divider-vert" />
);

/** Contract address inline link. `href` opens an explorer in a new tab; the copy icon
 * is a separate button that copies the full address. */
export const PoolAddress = ({
  network = "POOL",
  address,
  href,
  onCopy,
}: {
  network?: string;
  address: string;
  href?: string;
  onCopy?: () => void;
}) => {
  const short = address.length > 10
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : address;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onCopy) onCopy();
    else void navigator.clipboard.writeText(address);
  };

  const inner = (
    <>
      <span className="ts-net-label">{network}</span>
      {short}
    </>
  );

  return (
    <span className="ts-addr-inline">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="ts-addr-link"
          title={address}
        >
          {inner}
        </a>
      ) : (
        inner
      )}
      <button
        type="button"
        onClick={handleCopy}
        className="ts-addr-copy"
        title="Copy address"
        aria-label="Copy address"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="11" height="11" rx="1.5" />
          <path d="M5 15V5a1 1 0 011-1h10" />
        </svg>
      </button>
    </span>
  );
};

// Skeleton components for loading states
export const PoolHeaderSkeleton = ({ className }: { className?: string }) => {
  return (
    <div
      className={cn(
        "ts-topbar relative z-[1] border-b border-[var(--ts-line)]",
        className
      )}
    >
      <div className="relative flex items-center gap-5 px-7 py-5">
        <div className="ts-coin-frame">
          <div className="ts-coin-stack">
            <div className="ts-coin bp-skeleton" />
            <div className="ts-coin bp-skeleton" />
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="h-6 w-36 bp-skeleton rounded" />
            <div className="h-6 w-10 bp-skeleton rounded" />
            <div className="h-6 w-14 bp-skeleton rounded" />
          </div>
          <div className="h-3.5 w-64 bp-skeleton rounded" />
        </div>
      </div>
    </div>
  );
};
