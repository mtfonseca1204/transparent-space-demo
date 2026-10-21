import { usePoolData } from "@/hooks/use-pool-data";

export function useV2PoolData(poolKey: string, enabled: boolean = true) {
  return usePoolData(poolKey, { enabled });
}
