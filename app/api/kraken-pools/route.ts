import { NextRequest, NextResponse } from "next/server";
import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";
import { KRAKEN_METRICS_POOLS } from "@/lib/telegram-kraken-pools";
import { ASSET_ORDER } from "@/lib/token-utils";
import { getSolanaPoolMetadata } from "@/lib/pools";
import { getDemoKrakenPools, isDemoRequest } from "@/lib/demo/fixtures";

type CoinGeckoIncluded = {
  id: string;
  type: string;
  attributes?: {
    address?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    image_url?: string;
    coingecko_coin_id?: string;
  };
};

type CoinGeckoSearchPool = {
  id: string;
  type: "pool";
  attributes?: {
    address?: string;
    name?: string;
    reserve_in_usd?: string;
    volume_usd?: {
      h24?: string;
    };
    pool_created_at?: string;
  };
  relationships?: {
    base_token?: { data?: { id?: string; type?: string } };
    quote_token?: { data?: { id?: string; type?: string } };
    dex?: { data?: { id?: string; type?: string } };
  };
};

type CoinGeckoSearchResponse = {
  data?: CoinGeckoSearchPool[];
  included?: CoinGeckoIncluded[];
};

type CoinGeckoMultiPool = {
  id: string;
  type: "pool";
  attributes?: {
    address?: string;
    name?: string;
    pool_fee_percentage?: string | null;
    reserve_in_usd?: string;
    volume_usd?: {
      h24?: string;
    };
    pool_created_at?: string;
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
    base_token_balance?: string;
    base_token_liquidity_usd?: string;
    quote_token_balance?: string;
    quote_token_liquidity_usd?: string;
    locked_liquidity_percentage?: string | null;
  };
  relationships?: {
    base_token?: { data?: { id?: string; type?: string } };
    quote_token?: { data?: { id?: string; type?: string } };
    dex?: { data?: { id?: string; type?: string } };
  };
};

type CoinGeckoMultiResponse = {
  data?: CoinGeckoMultiPool[];
  included?: CoinGeckoIncluded[];
};

type RaydiumPoolInfo = {
  id: string;
  feeRate?: number;
  day?: {
    volumeFee?: number;
  };
};

type RaydiumPoolsInfoResponse = {
  success?: boolean;
  data?: RaydiumPoolInfo[];
};

type MeteoraPoolInfo = {
  address: string;
  name?: string;
  tvl?: number | string;
  liquidity?: number | string;
  total_liquidity?: number | string;
  volume_24h?: number | string;
  trade_volume_24h?: number | string;
  volume?: {
    h24?: number | string;
  };
  dynamic_fee_pct?: number;
  pool_config?: {
    base_fee_pct?: number;
  };
  fees?: {
    "24h"?: number;
  };
};

type OrcaPoolInfo = {
  address: string;
  feeRate?: number;
  stats?: {
    "24h"?: {
      fees?: string;
    };
  };
};

type OrcaPoolsResponse = {
  data?: OrcaPoolInfo[];
};

type KrakenPoolRow = {
  address: string;
  name: string;
  dex: string | null;
  feeTier: string | null;
  feeTierSource: "coingecko" | "raydium" | "meteora" | "local" | null;
  isTransparentSpacePool: boolean;
  transparentSpaceLabel: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  estimatedFees24hUsd: number | null;
  actualFees24hUsd: number | null;
  actualFees24hSource: "raydium" | "meteora" | "orca" | null;
  displayedFees24hUsd: number | null;
  poolCreatedAt: string | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  baseToken: {
    address: string | null;
    name: string | null;
    symbol: string | null;
    imageUrl: string | null;
    coingeckoCoinId: string | null;
  };
  quoteToken: {
    address: string | null;
    name: string | null;
    symbol: string | null;
    imageUrl: string | null;
    coingeckoCoinId: string | null;
  };
  baseTokenBalance: string | null;
  baseTokenLiquidityUsd: number | null;
  quoteTokenBalance: string | null;
  quoteTokenLiquidityUsd: number | null;
  lockedLiquidityPercentage: string | null;
};

type KrakenAssetGroup = {
  symbol: string;
  mint: string;
  poolCount: number;
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  totalEstimatedFees24hUsd: number;
  pools: KrakenPoolRow[];
};

type KrakenPoolsPayload = {
  fetchedAt: string;
  totalAssetCount: number;
  totalPoolCount: number;
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  totalEstimatedFees24hUsd: number;
  assets: KrakenAssetGroup[];
};

const SEARCH_PAGE_LIMIT = 20;
const MULTI_ADDRESS_LIMIT = 50;
const CACHE_TTL_MS = 30_000;
const CACHE_STALE_TTL_MS = 10 * 60_000;
const CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=300";
const EXCLUDED_KRAKEN_POOL_ADDRESSES = new Set([
  "BcDD5CcYozhqwHwPoSwoLmSKEbDNRZPAEYegJpe29ouP",
  "CRadM7ursqZ81Pp6WnWXKU55kaaGrv5udGb1ST5mVmuU",
]);

let cache: { fetchedAt: number; payload: KrakenPoolsPayload } | null = null;
let inflightRefresh: Promise<KrakenPoolsPayload> | null = null;

const TRANSPARENT_SPACE_POOL_BY_ADDRESS = new Map(
  KRAKEN_METRICS_POOLS.map((pool) => [
    pool.poolAddress,
    {
      label: pool.poolOptionLabel,
      metricsKey: pool.metricsKey,
      venueLabel: pool.venueLabel,
    },
  ])
);

function num(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNum(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function feeBpsToPctString(feeBps: number | undefined): string | null {
  if (!Number.isFinite(feeBps)) return null;
  return ((feeBps as number) / 10_000).toFixed(2).replace(/\.?0+$/, "");
}

function pctNumberToString(value: number | undefined): string | null {
  if (!Number.isFinite(value)) return null;
  return (value as number).toFixed(4).replace(/\.?0+$/, "");
}

function estimateFees24hUsd(volume24hUsd: number, feeTierPctRaw: string | null | undefined): number | null {
  const feeTierPct = nullableNum(feeTierPctRaw);
  if (feeTierPct == null) return null;
  return volume24hUsd * (feeTierPct / 100);
}

async function fetchRaydiumPoolInfoByIds(addresses: string[]): Promise<Map<string, RaydiumPoolInfo>> {
  if (addresses.length === 0) return new Map();

  const responses = await Promise.all(
    chunk(addresses, 50).map(async (ids) => {
      const response = await fetch(
        `https://api-v3.raydium.io/pools/info/ids?ids=${ids.join(",")}`,
        { next: { revalidate: 30 } }
      );
      if (!response.ok) return [] as RaydiumPoolInfo[];
      const payload = (await response.json()) as RaydiumPoolsInfoResponse;
      return payload.data ?? [];
    })
  );

  const pools = responses.flat().filter((pool): pool is RaydiumPoolInfo => Boolean(pool?.id));
  return new Map(pools.map((pool) => [pool.id, pool]));
}

async function fetchMeteoraPoolInfoByIds(addresses: string[]): Promise<Map<string, MeteoraPoolInfo>> {
  if (addresses.length === 0) return new Map();

  const pools: MeteoraPoolInfo[] = [];

  for (const batch of chunk(addresses, 25)) {
    const results = await Promise.all(
      batch.map(async (address) => {
        const response = await fetch(`https://dlmm.datapi.meteora.ag/pools/${address}`, {
          next: { revalidate: 30 },
        });
        if (!response.ok) return null;
        const payload = (await response.json()) as MeteoraPoolInfo;
        return payload.address ? payload : null;
      })
    );

    pools.push(...results.filter((pool): pool is MeteoraPoolInfo => Boolean(pool)));
  }

  return new Map(pools.map((pool) => [pool.address, pool]));
}

async function fetchOrcaPoolInfoByIds(addresses: string[]): Promise<Map<string, OrcaPoolInfo>> {
  if (addresses.length === 0) return new Map();

  const responses = await Promise.all(
    chunk(addresses, 25).map(async (ids) => {
      const params = new URLSearchParams({
        addresses: ids.join(","),
        stats: "24h",
        size: String(ids.length),
      });
      const response = await fetch(`https://api.orca.so/v2/solana/pools?${params.toString()}`, {
        next: { revalidate: 30 },
      });
      if (!response.ok) return [] as OrcaPoolInfo[];
      const payload = (await response.json()) as OrcaPoolsResponse;
      return payload.data ?? [];
    })
  );

  return new Map(responses.flat().map((pool) => [pool.address, pool]));
}

function sortByAssetOrder<T extends { symbol: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ai = ASSET_ORDER.indexOf(a.symbol.toUpperCase());
    const bi = ASSET_ORDER.indexOf(b.symbol.toUpperCase());
    const av = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bv = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    return av - bv;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getKrakenAssets() {
  const byMint = new Map<string, { symbol: string; mint: string }>();
  for (const pool of KRAKEN_METRICS_POOLS) {
    if (!byMint.has(pool.token0Mint)) {
      byMint.set(pool.token0Mint, {
        symbol: pool.token0Symbol,
        mint: pool.token0Mint,
      });
    }
  }
  return sortByAssetOrder([...byMint.values()]);
}

async function coinGeckoFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${getCoinGeckoBaseUrl()}${path}`, {
    headers: getCoinGeckoHeaders(),
    next: { revalidate: 30 },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function searchPoolsForAsset(asset: { symbol: string; mint: string }) {
  const tokenId = `solana_${asset.mint}`;
  const discoveredAddresses = new Set<string>();

  for (const pool of KRAKEN_METRICS_POOLS) {
    if (pool.token0Mint === asset.mint) {
      if (EXCLUDED_KRAKEN_POOL_ADDRESSES.has(pool.poolAddress)) continue;
      discoveredAddresses.add(pool.poolAddress);
    }
  }

  for (let page = 1; page <= 10; page += 1) {
    const data = await coinGeckoFetch<CoinGeckoSearchResponse>(
      `/onchain/search/pools?query=${encodeURIComponent(asset.mint)}&network=solana&include=base_token,quote_token,dex&page=${page}`
    );

    const rows = data.data ?? [];
    for (const row of rows) {
      const baseTokenId = row.relationships?.base_token?.data?.id;
      const quoteTokenId = row.relationships?.quote_token?.data?.id;
      const address = row.attributes?.address;

      if (!address) continue;
      if (EXCLUDED_KRAKEN_POOL_ADDRESSES.has(address)) continue;
      if (baseTokenId !== tokenId && quoteTokenId !== tokenId) continue;
      discoveredAddresses.add(address);
    }

    if (rows.length < SEARCH_PAGE_LIMIT) break;
  }

  return {
    ...asset,
    addresses: [...discoveredAddresses],
  };
}

async function buildPayload(): Promise<KrakenPoolsPayload> {
  const krakenAssets = getKrakenAssets();
  const assetSearchResults = await Promise.all(krakenAssets.map(searchPoolsForAsset));

  const allAddresses = [...new Set(assetSearchResults.flatMap((asset) => asset.addresses))].filter(
    (address) => !EXCLUDED_KRAKEN_POOL_ADDRESSES.has(address)
  );
  const detailMap = new Map<string, KrakenPoolRow>();
  const raydiumCandidateAddresses = new Set<string>();
  const meteoraCandidateAddresses = new Set<string>();
  const orcaCandidateAddresses = new Set<string>();

  for (const addressBatch of chunk(allAddresses, MULTI_ADDRESS_LIMIT)) {
    const data = await coinGeckoFetch<CoinGeckoMultiResponse>(
      `/onchain/networks/solana/pools/multi/${addressBatch.join(",")}?include=base_token,quote_token,dex&include_composition=true&include_volume_breakdown=true`
    );

    const included = new Map((data.included ?? []).map((item) => [item.id, item]));

    for (const row of data.data ?? []) {
      const address = row.attributes?.address;
      if (!address) continue;

      const baseTokenId = row.relationships?.base_token?.data?.id;
      const quoteTokenId = row.relationships?.quote_token?.data?.id;
      const dexId = row.relationships?.dex?.data?.id;
      const baseToken = baseTokenId ? included.get(baseTokenId)?.attributes : undefined;
      const quoteToken = quoteTokenId ? included.get(quoteTokenId)?.attributes : undefined;
      const dex = dexId ? included.get(dexId)?.attributes : undefined;
      const transparentSpacePool = TRANSPARENT_SPACE_POOL_BY_ADDRESS.get(address);
      const volume24hUsd = num(row.attributes?.volume_usd?.h24);
      const localMetadata = getSolanaPoolMetadata(address);
      const coingeckoFeeTier = row.attributes?.pool_fee_percentage ?? null;
      const localFeeTier = feeBpsToPctString(localMetadata?.fee);
      const feeTier = coingeckoFeeTier ?? localFeeTier;
      const feeTierSource: KrakenPoolRow["feeTierSource"] = coingeckoFeeTier
        ? "coingecko"
        : localFeeTier
          ? "local"
          : null;
      const dexName = (dex?.name ?? "").toLowerCase();

      if (dexName.includes("raydium")) {
        raydiumCandidateAddresses.add(address);
      }
      if (dexName.includes("meteora")) {
        meteoraCandidateAddresses.add(address);
      }
      if (dexName.includes("orca")) {
        orcaCandidateAddresses.add(address);
      }

      detailMap.set(address, {
        address,
        name: row.attributes?.name ?? `${baseToken?.symbol ?? "?"} / ${quoteToken?.symbol ?? "?"}`,
        dex: dex?.name ?? null,
        feeTier,
        feeTierSource,
        isTransparentSpacePool: Boolean(transparentSpacePool),
        transparentSpaceLabel: transparentSpacePool?.label ?? null,
        liquidityUsd: num(row.attributes?.reserve_in_usd),
        volume24hUsd,
        estimatedFees24hUsd: estimateFees24hUsd(volume24hUsd, feeTier),
        actualFees24hUsd: null,
        actualFees24hSource: null,
        displayedFees24hUsd: null,
        poolCreatedAt: row.attributes?.pool_created_at ?? null,
        marketCapUsd: nullableNum(row.attributes?.market_cap_usd),
        fdvUsd: nullableNum(row.attributes?.fdv_usd),
        baseToken: {
          address: baseToken?.address ?? null,
          name: baseToken?.name ?? null,
          symbol: baseToken?.symbol ?? null,
          imageUrl: baseToken?.image_url ?? null,
          coingeckoCoinId: baseToken?.coingecko_coin_id ?? null,
        },
        quoteToken: {
          address: quoteToken?.address ?? null,
          name: quoteToken?.name ?? null,
          symbol: quoteToken?.symbol ?? null,
          imageUrl: quoteToken?.image_url ?? null,
          coingeckoCoinId: quoteToken?.coingecko_coin_id ?? null,
        },
        baseTokenBalance: row.attributes?.base_token_balance ?? null,
        baseTokenLiquidityUsd: nullableNum(row.attributes?.base_token_liquidity_usd),
        quoteTokenBalance: row.attributes?.quote_token_balance ?? null,
        quoteTokenLiquidityUsd: nullableNum(row.attributes?.quote_token_liquidity_usd),
        lockedLiquidityPercentage: row.attributes?.locked_liquidity_percentage ?? null,
      });
    }
  }

  for (const address of allAddresses) {
    const transparentSpacePool = TRANSPARENT_SPACE_POOL_BY_ADDRESS.get(address);
    const localMetadata = getSolanaPoolMetadata(address);
    if (!transparentSpacePool || !localMetadata) continue;

    if (transparentSpacePool.metricsKey.startsWith("raydium-")) {
      raydiumCandidateAddresses.add(address);
    }

    if (transparentSpacePool.metricsKey.startsWith("meteora-")) {
      meteoraCandidateAddresses.add(address);
    }

    if (detailMap.has(address)) continue;

    const feeTier = feeBpsToPctString(localMetadata.fee);
    detailMap.set(address, {
      address,
      name: localMetadata.symbol.replace("/", " / "),
      dex: transparentSpacePool.venueLabel,
      feeTier,
      feeTierSource: feeTier ? "local" : null,
      isTransparentSpacePool: true,
      transparentSpaceLabel: transparentSpacePool.label,
      liquidityUsd: 0,
      volume24hUsd: 0,
      estimatedFees24hUsd: null,
      actualFees24hUsd: null,
      actualFees24hSource: null,
      displayedFees24hUsd: null,
      poolCreatedAt: null,
      marketCapUsd: null,
      fdvUsd: null,
      baseToken: {
        address: localMetadata.token0Mint ?? null,
        name: localMetadata.name,
        symbol: localMetadata.token0Symbol,
        imageUrl: localMetadata.logo ?? null,
        coingeckoCoinId: null,
      },
      quoteToken: {
        address: localMetadata.token1Mint ?? null,
        name: localMetadata.token1Symbol,
        symbol: localMetadata.token1Symbol,
        imageUrl: null,
        coingeckoCoinId: null,
      },
      baseTokenBalance: null,
      baseTokenLiquidityUsd: null,
      quoteTokenBalance: null,
      quoteTokenLiquidityUsd: null,
      lockedLiquidityPercentage: null,
    });
  }

  const raydiumPoolInfoById = await fetchRaydiumPoolInfoByIds([...raydiumCandidateAddresses]);
  const meteoraPoolInfoById = await fetchMeteoraPoolInfoByIds([...meteoraCandidateAddresses]);
  const orcaPoolInfoById = await fetchOrcaPoolInfoByIds([...orcaCandidateAddresses]);

  for (const [address, row] of detailMap.entries()) {
    const raydiumPool = raydiumPoolInfoById.get(address);
    if (raydiumPool) {
      const raydiumFeeTier = raydiumPool.feeRate != null ? pctNumberToString(raydiumPool.feeRate * 100) : null;
      if (!row.feeTier && raydiumFeeTier) {
        row.feeTier = raydiumFeeTier;
        row.feeTierSource = "raydium";
        row.estimatedFees24hUsd = estimateFees24hUsd(row.volume24hUsd, raydiumFeeTier);
      }

      row.actualFees24hUsd = nullableNum(
        raydiumPool.day?.volumeFee != null ? String(raydiumPool.day.volumeFee) : null
      );
      row.actualFees24hSource = row.actualFees24hUsd != null ? "raydium" : null;
    }

    const meteoraPool = meteoraPoolInfoById.get(address);
    if (meteoraPool) {
      const meteoraLiquidityUsd = nullableNum(
        meteoraPool.tvl != null
          ? String(meteoraPool.tvl)
          : meteoraPool.liquidity != null
            ? String(meteoraPool.liquidity)
            : meteoraPool.total_liquidity != null
              ? String(meteoraPool.total_liquidity)
              : null
      );
      const meteoraVolume24hUsd = nullableNum(
        meteoraPool.volume_24h != null
          ? String(meteoraPool.volume_24h)
          : meteoraPool.trade_volume_24h != null
            ? String(meteoraPool.trade_volume_24h)
            : meteoraPool.volume?.h24 != null
              ? String(meteoraPool.volume.h24)
              : null
      );
      const meteoraFeeTier =
        (meteoraPool.dynamic_fee_pct ?? 0) > 0
          ? pctNumberToString(meteoraPool.dynamic_fee_pct)
          : pctNumberToString(meteoraPool.pool_config?.base_fee_pct);

      if (meteoraPool.name) row.name = meteoraPool.name.replace("-", " / ");
      if (meteoraLiquidityUsd != null) row.liquidityUsd = meteoraLiquidityUsd;
      if (meteoraVolume24hUsd != null) row.volume24hUsd = meteoraVolume24hUsd;

      if (!row.feeTier && meteoraFeeTier) {
        row.feeTier = meteoraFeeTier;
        row.feeTierSource = "meteora";
      }
      row.estimatedFees24hUsd = estimateFees24hUsd(row.volume24hUsd, row.feeTier);

      const meteoraFees24hUsd = nullableNum(
        meteoraPool.fees?.["24h"] != null ? String(meteoraPool.fees["24h"]) : null
      );
      if (meteoraFees24hUsd != null) {
        row.actualFees24hUsd = meteoraFees24hUsd;
        row.actualFees24hSource = "meteora";
      }
    }

    const orcaPool = orcaPoolInfoById.get(address);
    if (orcaPool) {
      const orcaFees24hUsd = nullableNum(orcaPool.stats?.["24h"]?.fees);
      if (orcaFees24hUsd != null) {
        row.actualFees24hUsd = orcaFees24hUsd;
        row.actualFees24hSource = "orca";
      }
    }

    row.displayedFees24hUsd = row.actualFees24hUsd ?? row.estimatedFees24hUsd;
  }

  const assets: KrakenAssetGroup[] = assetSearchResults
    .map((asset) => {
      const pools = asset.addresses
        .map((address) => detailMap.get(address))
        .filter((pool): pool is KrakenPoolRow => Boolean(pool))
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

      return {
        symbol: asset.symbol,
        mint: asset.mint,
        poolCount: pools.length,
        totalLiquidityUsd: pools.reduce((sum, pool) => sum + pool.liquidityUsd, 0),
        totalVolume24hUsd: pools.reduce((sum, pool) => sum + pool.volume24hUsd, 0),
        totalEstimatedFees24hUsd: pools.reduce(
          (sum, pool) => sum + (pool.displayedFees24hUsd ?? 0),
          0
        ),
        pools,
      };
    })
    .sort((a, b) => b.totalLiquidityUsd - a.totalLiquidityUsd);

  return {
    fetchedAt: new Date().toISOString(),
    totalAssetCount: assets.length,
    totalPoolCount: assets.reduce((sum, asset) => sum + asset.poolCount, 0),
    totalLiquidityUsd: assets.reduce((sum, asset) => sum + asset.totalLiquidityUsd, 0),
    totalVolume24hUsd: assets.reduce((sum, asset) => sum + asset.totalVolume24hUsd, 0),
    totalEstimatedFees24hUsd: assets.reduce(
      (sum, asset) => sum + asset.totalEstimatedFees24hUsd,
      0
    ),
    assets,
  };
}

function jsonPayload(
  payload: KrakenPoolsPayload,
  cacheState: "HIT" | "MISS" | "STALE" | "COALESCED"
) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "X-Cache": cacheState,
    },
  });
}

function refreshPayload(): Promise<KrakenPoolsPayload> {
  if (inflightRefresh) return inflightRefresh;

  const refresh = buildPayload()
    .then((payload) => {
      cache = { fetchedAt: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inflightRefresh = null;
    });

  refresh.catch(() => {});
  inflightRefresh = refresh;
  return refresh;
}

export async function GET(request: NextRequest) {
  if (isDemoRequest(request)) {
    return NextResponse.json(getDemoKrakenPools(), {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "X-Source": "demo-fixture",
      },
    });
  }

  const ageMs = cache ? Date.now() - cache.fetchedAt : Number.POSITIVE_INFINITY;
  if (cache && ageMs < CACHE_TTL_MS) {
    return jsonPayload(cache.payload, "HIT");
  }

  if (cache && ageMs < CACHE_STALE_TTL_MS) {
    void refreshPayload();
    return jsonPayload(cache.payload, "STALE");
  }

  try {
    const hadInflight = Boolean(inflightRefresh);
    const payload = await refreshPayload();
    return jsonPayload(payload, hadInflight ? "COALESCED" : "MISS");
  } catch (error) {
    if (cache) {
      return jsonPayload(cache.payload, "STALE");
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load Kraken pools", details: message },
      { status: 500 }
    );
  }
}
