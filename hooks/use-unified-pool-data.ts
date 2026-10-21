import { usePoolData } from "@/hooks/use-pool-data";
import { useV2PoolData } from "@/hooks/use-v2-pool-data";
import { isEvmV2Protocol } from "@/lib/evm-v2-pool-support";
import { inferPoolProtocol, normalizePoolKey } from "@/lib/pools";

export function useUnifiedPoolData(poolKeyRaw: string, enabled: boolean = true) {
  const poolKey = normalizePoolKey(poolKeyRaw);
  const hasPoolKey = !!poolKey;
  const protocol = inferPoolProtocol(poolKey);
  const isV2 = isEvmV2Protocol(protocol);

  const v2 = useV2PoolData(poolKey, enabled && hasPoolKey && isV2);

  // v3: keep existing onchain fetch behavior.
  const v3 = usePoolData(poolKey, { enabled: enabled && hasPoolKey && protocol === "v3" });

  // raydium / meteora: reuse the same /api/pool/:address route (which proxies to Railway)
  const raydium = usePoolData(poolKey, {
    enabled: enabled && hasPoolKey && (protocol === "raydium" || protocol === "meteora"),
  });

  // v4: use the same server snapshot route as v3/Solana so chain-specific
  // token metadata and pool-space routing stay centralized.
  const v4 = usePoolData(poolKey, { enabled: enabled && hasPoolKey && protocol === "v4" });

  if (isV2) return v2;
  if (protocol === "v3") return v3;
  if (protocol === "raydium" || protocol === "meteora") return raydium;
  return v4;
}
