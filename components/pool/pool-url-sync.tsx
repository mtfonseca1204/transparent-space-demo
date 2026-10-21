"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePoolStore } from "@/stores/pool-store";
import { normalizePoolKeyInput } from "@/lib/pools";
import { resolvePoolKeyForSpace } from "@/lib/demo/asset-resolution";

/**
 * Keeps the zustand-selected pool and `?pool=` URL param in sync.
 *
 * Source of truth:
 * - If URL has `pool` AND it belongs to the current space's pools, it wins.
 * - If URL has `pool` that does NOT belong to the current space, we override with the space's default.
 * - If URL does NOT have `pool`, we write the zustand-selected value into the URL.
 */
export function PoolUrlSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const selectedPoolKey = usePoolStore((s) => s.selectedPoolKey);
  const setSelectedPoolKey = usePoolStore((s) => s.setSelectedPoolKey);
  const supportedPools = usePoolStore((s) => s.supportedPools);
  const spaceSlug = pathname.split("/").filter(Boolean)[0] ?? null;

  const poolFromUrlRaw = searchParams.get("pool");
  const poolFromUrl = poolFromUrlRaw
    ? resolvePoolKeyForSpace(poolFromUrlRaw, spaceSlug) ?? normalizePoolKeyInput(poolFromUrlRaw)
    : null;

  // Validate that the pool from URL belongs to the current space
  const isPoolInSpace = poolFromUrl
    ? supportedPools.some((p) => p.poolKey === poolFromUrl)
    : false;

  // store -> URL (only when URL missing pool param)
  useEffect(() => {
    if (poolFromUrl) return;
    const next = new URLSearchParams(searchParamsString);
    next.set("pool", selectedPoolKey);
    router.replace(`${pathname}?${next.toString()}`);
  }, [poolFromUrl, pathname, router, searchParamsString, selectedPoolKey]);

  // URL -> store (only if pool belongs to this space)
  useEffect(() => {
    if (!poolFromUrl) return;

    if (isPoolInSpace) {
      // Pool is valid for this space — sync it
      if (poolFromUrl !== selectedPoolKey) {
        setSelectedPoolKey(poolFromUrl);
      }
      if (poolFromUrlRaw !== poolFromUrl) {
        const next = new URLSearchParams(searchParamsString);
        next.set("pool", poolFromUrl);
        router.replace(`${pathname}?${next.toString()}`);
      }
    } else {
      // Pool is NOT in this space — override URL with the current space's default
      const next = new URLSearchParams(searchParamsString);
      next.set("pool", selectedPoolKey);
      router.replace(`${pathname}?${next.toString()}`);
    }
  }, [poolFromUrl, poolFromUrlRaw, isPoolInSpace, selectedPoolKey, setSelectedPoolKey, pathname, router, searchParamsString]);

  return null;
}
