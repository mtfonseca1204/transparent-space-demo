import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_POOL_KEY,
  normalizePoolKeyInput,
  SUPPORTED_POOLS,
  getPoolsForSpace,
  type SupportedPool,
} from "@/lib/pools";
import { resolvePoolKeyForSpace } from "@/lib/demo/asset-resolution";

export interface PoolState {
  selectedPoolKey: string; // lowercased; v3 address OR v4 Pool.id
  setSelectedPoolKey: (poolKey: string) => void;

  supportedPools: SupportedPool[];

  /** Set the active space slug — filters supportedPools; keeps selected pool if valid for the space */
  setSpaceSlug: (spaceSlug: string) => void;
}

export const usePoolStore = create<PoolState>()(
  persist(
    (set) => ({
      selectedPoolKey: DEFAULT_POOL_KEY,
      setSelectedPoolKey: (poolKey) => set({ selectedPoolKey: normalizePoolKeyInput(poolKey) }),

      supportedPools: SUPPORTED_POOLS,

      setSpaceSlug: (spaceSlug: string) =>
        set((state) => {
          const spacePools = getPoolsForSpace(spaceSlug);
          const selectedPoolKey =
            resolvePoolKeyForSpace(state.selectedPoolKey, spaceSlug) ?? state.selectedPoolKey;
          // Keep the current pool if it belongs to this space (preserves selection on reload)
          const currentIsValid = spacePools.some(
            (p) => p.poolKey === selectedPoolKey
          );
          const defaultKey =
            spacePools.length > 0 ? spacePools[0].poolKey : DEFAULT_POOL_KEY;
          return {
            supportedPools: spacePools,
            selectedPoolKey: currentIsValid
              ? selectedPoolKey
              : defaultKey,
          };
        }),
    }),
    {
      name: "selected-pool",
      partialize: (state) => ({ selectedPoolKey: state.selectedPoolKey }),
    }
  )
);
