/**
 * Pool monitoring registry for Telegram alerts and /metrics command.
 *
 * Token ordering (token0/token1) and decimals verified on-chain.
 * CoinGecko IDs used for oracle cross-rate calculation.
 */

export type MonitoredPool = {
  key: string;
  label: string;
  poolAddress: `0x${string}`;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  /** CoinGecko ID for token0 (null if no listing) */
  token0CoinGeckoId: string | null;
  /** CoinGecko ID for token1 (null if no listing) */
  token1CoinGeckoId: string | null;
  /** Whether both tokens have oracle prices (false for ETH/MADS) */
  hasOracle: boolean;
};

export const MONITORED_POOLS: MonitoredPool[] = [
  {
    key: "wld-usdc",
    label: "WLD / USDC",
    poolAddress: "0x610e319b3a3ab56a0ed5562927d37c233774ba39",
    token0Address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
    token1Address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    token0Symbol: "WLD",
    token1Symbol: "USDC",
    token0Decimals: 18,
    token1Decimals: 6,
    token0CoinGeckoId: "worldcoin-wld",
    token1CoinGeckoId: "usd-coin",
    hasOracle: true,
  },
  {
    key: "wld-weth",
    label: "WLD / WETH",
    poolAddress: "0x494d68e3cab640fa50f4c1b3e2499698d1a173a0",
    token0Address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
    token1Address: "0x4200000000000000000000000000000000000006",
    token0Symbol: "WLD",
    token1Symbol: "WETH",
    token0Decimals: 18,
    token1Decimals: 18,
    token0CoinGeckoId: "worldcoin-wld",
    token1CoinGeckoId: "weth",
    hasOracle: true,
  },
  {
    key: "wbtc-usdc",
    label: "WBTC / USDC",
    poolAddress: "0xdce053d9ba0fa2c5f772416b64f191158cbcc32e",
    token0Address: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3",
    token1Address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    token0Symbol: "WBTC",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0CoinGeckoId: "wrapped-bitcoin",
    token1CoinGeckoId: "usd-coin",
    hasOracle: true,
  },
  {
    key: "wbtc-weth",
    label: "WBTC / WETH",
    poolAddress: "0x7c3c2a92598d6d77e57fd55c50e99af4b291f595",
    token0Address: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3",
    token1Address: "0x4200000000000000000000000000000000000006",
    token0Symbol: "WBTC",
    token1Symbol: "WETH",
    token0Decimals: 8,
    token1Decimals: 18,
    token0CoinGeckoId: "wrapped-bitcoin",
    token1CoinGeckoId: "weth",
    hasOracle: true,
  },
  {
    key: "wld-wbtc",
    label: "WLD / WBTC",
    poolAddress: "0x1a4abfe77b9aec6259757805bd0d3c46fca6d494",
    token0Address: "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3",
    token1Address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
    token0Symbol: "WBTC",
    token1Symbol: "WLD",
    token0Decimals: 8,
    token1Decimals: 18,
    token0CoinGeckoId: "wrapped-bitcoin",
    token1CoinGeckoId: "worldcoin-wld",
    hasOracle: true,
  },
  {
    key: "weth-usdc",
    label: "WETH / USDC",
    poolAddress: "0x5f835420502a7702de50cd0e78d8aa3608b2137e",
    token0Address: "0x4200000000000000000000000000000000000006",
    token1Address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    token0Symbol: "WETH",
    token1Symbol: "USDC",
    token0Decimals: 18,
    token1Decimals: 6,
    token0CoinGeckoId: "weth",
    token1CoinGeckoId: "usd-coin",
    hasOracle: true,
  },
  {
    key: "eurc-usdc-e",
    label: "EURC / USDC.e",
    poolAddress: "0xee4c0cd5bc4a68c7573d82bb31d4dc9de1f53eca",
    token0Address: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B",
    token1Address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    token0Symbol: "EURC",
    token1Symbol: "USDC",
    token0Decimals: 6,
    token1Decimals: 6,
    token0CoinGeckoId: "euro-coin",
    token1CoinGeckoId: "usd-coin",
    hasOracle: true,
  },
  {
    key: "eth-mads",
    label: "ETH / MADS",
    poolAddress: "0x10b3bf9cd0689c4581875b29ce5f106ae6188064",
    token0Address: "0x4200000000000000000000000000000000000006",
    token1Address: "0x45F8D06664D8cD20590E9A9aA81B6899f2E13EE6",
    token0Symbol: "WETH",
    token1Symbol: "MADS",
    token0Decimals: 18,
    token1Decimals: 18,
    token0CoinGeckoId: "weth",
    token1CoinGeckoId: null,
    hasOracle: false,
  },
];

/** Get deduplicated CoinGecko IDs needed for oracle pricing. */
export function getUniqueCoinGeckoIds(): string[] {
  const ids = new Set<string>();
  for (const pool of MONITORED_POOLS) {
    if (pool.token0CoinGeckoId) ids.add(pool.token0CoinGeckoId);
    if (pool.token1CoinGeckoId) ids.add(pool.token1CoinGeckoId);
  }
  return [...ids];
}

/** Find a pool by its key. */
export function findPoolByKey(key: string): MonitoredPool | undefined {
  return MONITORED_POOLS.find((p) => p.key === key);
}
