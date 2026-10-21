"use client";

import React from "react";
import type { SolanaPoolMetadata } from "@/lib/pools";
import {
  PoolHeader,
  PoolTokens,
  TokenIcon,
  PoolInfo,
  PoolName,
  PoolBadges,
  PoolBadge,
} from "@/components/dashboard/pool-header";

interface RfqHeaderProps {
  poolMeta: SolanaPoolMetadata;
  quoteAt: string | null;
}

export function RfqHeader({ poolMeta, quoteAt }: RfqHeaderProps) {
  const formattedTime = quoteAt
    ? new Date(quoteAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <PoolHeader>
      <PoolTokens>
        <TokenIcon
          symbol={poolMeta.token0Symbol}
          className="w-[50px] h-[50px]"
        />
        <TokenIcon
          symbol={poolMeta.token1Symbol}
          className="w-[50px] h-[50px]"
        />
      </PoolTokens>
      <PoolInfo>
        <PoolName>
          {poolMeta.token0Symbol}/{poolMeta.token1Symbol} RFQ
        </PoolName>
        <PoolBadges>
          <PoolBadge variant="primary">RFQ</PoolBadge>
          <PoolBadge>Jupiter</PoolBadge>
          {formattedTime && <PoolBadge>{formattedTime}</PoolBadge>}
        </PoolBadges>
      </PoolInfo>
    </PoolHeader>
  );
}
