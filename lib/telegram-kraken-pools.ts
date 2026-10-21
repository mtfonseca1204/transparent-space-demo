/**
 * Pool monitoring registry for Kraken Telegram alerts and /metrics command.
 *
 * Alerts still use a curated "primary" pool per asset.
 * The /metrics command exposes all supported Kraken pools grouped by asset.
 */

import {
  SOLANA_POOL_METADATA_BY_ADDRESS,
  SUPPORTED_POOLS,
} from "@/lib/pools";

export type KrakenMonitoredPool = {
  key: string;
  label: string;
  /** Pool address on Solana */
  poolAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  /** Solana mint address for token0 (tracked token) */
  token0Mint: string;
  /** Solana mint address for token1 (USDC) */
  token1Mint: string;
  /** Optional vault addresses for TVL calculation */
  token0Vault?: string;
  token1Vault?: string;
};

export type KrakenMetricsAsset = {
  key: string;
  label: string;
  poolCount: number;
};

export type KrakenMetricsPool = KrakenMonitoredPool & {
  assetKey: string;
  assetLabel: string;
  metricsKey: string;
  venueLabel: string;
  feeTierLabel: string | null;
  poolOptionLabel: string;
  isPrimary: boolean;
};

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const KRAKEN_MONITORED_POOLS: KrakenMonitoredPool[] = [
  {
    key: "tslax-usdc",
    label: "TSLAx / USDC",
    poolAddress: "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum",
    token0Symbol: "TSLAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    token1Mint: USDC_MINT,
    token0Vault: "D2JXvYgyqo2CktPN4aNfdmHn8mK2vrF9essKdH8M4wn7",
    token1Vault: "3h7wgb4hzxjM2F7fmLgwuzZxzuztUvUMdThnrmy9bTdF",
  },
  {
    key: "nvdax-usdc",
    label: "NVDAx / USDC",
    poolAddress: "4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN",
    token0Symbol: "NVDAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    token1Mint: USDC_MINT,
    token0Vault: "8yUe5to4WzcDTM7zY1k9T6d6SZQqeXnKSRxZ6jGseFeX",
    token1Vault: "GHtx7Ff9j79nUTaRq6abyi6VSqgJ5c4XAGBqnWykHtDt",
  },
  {
    key: "spyx-usdc",
    label: "SPYx / USDC",
    poolAddress: "7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME",
    token0Symbol: "SPYx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    token1Mint: USDC_MINT,
    token0Vault: "Hfpwtfbjxtd1CayUHYkqe2S1aim5uYCjbFSEFN6qRokj",
    token1Vault: "BBaEjPrPScXv12hnLzNbSa91L3Te5SopAyCjA37UTBeo",
  },
  {
    key: "qqqx-usdc",
    label: "QQQx / USDC",
    poolAddress: "FknDV1F5n6QaA7rLmjquDjuU6wcPMNm5RYq7zWbqhpZw",
    token0Symbol: "QQQx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    token1Mint: USDC_MINT,
    token0Vault: "EwvUC5UCDsAsdkSXNeVJp77ooQvJRRK21oNcpvgqPyte",
    token1Vault: "4DqRE6N2yvXrT4cUpzenMVSYGswvkE36hjUJdtyCZqSP",
  },
  {
    key: "gldx-usdc",
    label: "GLDx / USDC",
    poolAddress: "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze",
    token0Symbol: "GLDx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    token1Mint: USDC_MINT,
    token0Vault: "Qf2BrMGurzSMiqeXNKQdG6XzbWeWG9FCP7tndHNikNj",
    token1Vault: "8BECXqsvkZcWD1MpzYV4p7NXD8xu5ZzquQ52NNGFqUsm",
  },
  {
    key: "googlx-usdc",
    label: "GOOGLx / USDC",
    poolAddress: "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw",
    token0Symbol: "GOOGLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    token1Mint: USDC_MINT,
    token0Vault: "8egAoaRyscTY8Quo1AKhCCZmXHDdBkUu2WSCF86g7kZK",
    token1Vault: "7fyQSFJLS9hcmp53VTKnvvQ7Rpt2KcZkhvJyKDRJivYg",
  },
  {
    key: "hoodx-usdc",
    label: "HOODx / USDC",
    poolAddress: "3Z4H4H9bCcLyt1MmK44J5KZWkJ7taiU821QDTVZYaCpz",
    token0Symbol: "HOODx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    token1Mint: USDC_MINT,
    token0Vault: "61RmD25gUucxvJqHNUwoPfZ9hj6pu5MCPA7jLMfMHZU7",
    token1Vault: "2QdWwiXzwNQ6YP4JnhwGauN7S2tp4AUycwVfmxbG1vbC",
  },
  {
    key: "crclx-usdc",
    label: "CRCLx / USDC",
    poolAddress: "G39wywquKbHK8F2wZZZFX3fcsyG91VCCbbr6WEVp5axy",
    token0Symbol: "CRCLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    token1Mint: USDC_MINT,
    token0Vault: "2E4iJMqtDz6hhvpBb5HJ1GfQk1RuhnuAp6uCywTB1qYM",
    token1Vault: "TMuoeZMJ4HVJcELyJ44EXGPo6SPRANda5ZHPcRymMSb",
  },
  {
    key: "metax-usdc",
    label: "METAx / USDC",
    poolAddress: "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j",
    token0Symbol: "METAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    token1Mint: USDC_MINT,
    token0Vault: "BMS7RrFtXNByMZoAAyViq4LhhUDDZBLfyY3Ni1W9iptc",
    token1Vault: "EbqkNhtHX6oNRzWuArFut7C5WXfiU2fEVEmg8rmHKsmc",
  },
  {
    key: "coinx-usdc",
    label: "COINx / USDC",
    poolAddress: "5pobXosbeGSCRG3HdaRiw2TaihDDQMXkHFVbUTF24weM",
    token0Symbol: "COINx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    token1Mint: USDC_MINT,
    token0Vault: "HDmBqVr4W6QoZL76y5oeLftHRrnmHDUEmvX75pZCgehg",
    token1Vault: "Bykx81MhyMemTa9bkqCcu54RLTFBc3cM8VwCexXiHTiZ",
  },
];

function formatFeeTier(fee: number | undefined): string | null {
  if (!Number.isFinite(fee)) return null;
  const pct = (fee as number) / 10_000;
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function getKrakenVenueLabel(poolKey: string): string {
  if (poolKey.startsWith("meteora-")) return "Meteora";
  return poolKey.startsWith("byreal-") ? "Byreal" : "Raydium";
}

const PRIMARY_POOL_ADDRESS_SET = new Set(
  KRAKEN_MONITORED_POOLS.map((pool) => pool.poolAddress),
);

const LEGACY_METRICS_KEY_TO_POOL_ADDRESS = new Map(
  KRAKEN_MONITORED_POOLS.map((pool) => [pool.key, pool.poolAddress]),
);

export const KRAKEN_METRICS_POOLS: KrakenMetricsPool[] = SUPPORTED_POOLS
  .filter((pool) => pool.spaceSlug === "kraken" && pool.chain === "solana")
  .map((pool) => {
    const metadata = SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey];

    if (!metadata?.token0Mint || !metadata?.token1Mint) {
      throw new Error(`Missing Solana metadata for Kraken pool ${pool.poolKey}`);
    }

    const venueLabel = getKrakenVenueLabel(pool.key);
    const feeTierLabel = formatFeeTier(metadata.fee);

    return {
      key: pool.key,
      label: `${metadata.token0Symbol} / ${metadata.token1Symbol}`,
      poolAddress: pool.poolKey,
      token0Symbol: metadata.token0Symbol,
      token1Symbol: metadata.token1Symbol,
      token0Decimals: metadata.token0Decimals,
      token1Decimals: metadata.token1Decimals,
      token0Mint: metadata.token0Mint,
      token1Mint: metadata.token1Mint,
      token0Vault: metadata.token0Vault,
      token1Vault: metadata.token1Vault,
      assetKey: metadata.token0Mint,
      assetLabel: metadata.token0Symbol,
      metricsKey: pool.key,
      venueLabel,
      feeTierLabel,
      poolOptionLabel: feeTierLabel
        ? `${venueLabel} ${feeTierLabel}`
        : venueLabel,
      isPrimary: PRIMARY_POOL_ADDRESS_SET.has(pool.poolKey),
    };
  })
  .sort((a, b) => {
    if (a.assetLabel !== b.assetLabel) {
      return a.assetLabel.localeCompare(b.assetLabel);
    }
    if (a.isPrimary !== b.isPrimary) {
      return a.isPrimary ? -1 : 1;
    }
    if (a.venueLabel !== b.venueLabel) {
      return a.venueLabel.localeCompare(b.venueLabel);
    }
    return a.poolOptionLabel.localeCompare(b.poolOptionLabel);
  });

export const KRAKEN_METRICS_ASSETS: KrakenMetricsAsset[] = Array.from(
  KRAKEN_METRICS_POOLS.reduce((map, pool) => {
    const existing = map.get(pool.assetKey);
    if (existing) {
      existing.poolCount += 1;
      return map;
    }

    map.set(pool.assetKey, {
      key: pool.assetKey,
      label: pool.assetLabel,
      poolCount: 1,
    });
    return map;
  }, new Map<string, KrakenMetricsAsset>()),
  ([, asset]) => asset,
).sort((a, b) => a.label.localeCompare(b.label));

/** Get all unique Solana token mints that need oracle prices. */
export function getKrakenUniqueMints(): string[] {
  const mints = new Set<string>();
  for (const pool of KRAKEN_METRICS_POOLS) {
    mints.add(pool.token0Mint);
    mints.add(pool.token1Mint);
  }
  return [...mints];
}

/** Find a primary alert pool by its legacy key. */
export function findKrakenPoolByKey(key: string): KrakenMonitoredPool | undefined {
  return KRAKEN_MONITORED_POOLS.find((p) => p.key === key);
}

export function findKrakenMetricsPoolByKey(
  key: string,
): KrakenMetricsPool | undefined {
  const legacyPoolAddress = LEGACY_METRICS_KEY_TO_POOL_ADDRESS.get(key);
  return KRAKEN_METRICS_POOLS.find(
    (pool) => pool.metricsKey === key || pool.poolAddress === legacyPoolAddress,
  );
}

export function findKrakenMetricsAssetByKey(
  key: string,
): KrakenMetricsAsset | undefined {
  return KRAKEN_METRICS_ASSETS.find((asset) => asset.key === key);
}

export function getKrakenMetricsPoolsForAsset(assetKey: string): KrakenMetricsPool[] {
  return KRAKEN_METRICS_POOLS.filter((pool) => pool.assetKey === assetKey);
}
