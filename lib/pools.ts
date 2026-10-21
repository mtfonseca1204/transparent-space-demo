import { DEMO_POOL_KEY_PREFIX, DEMO_SPACE_SLUG } from "@/lib/demo/constants";
import { getDemoTokenLogo } from "@/lib/demo/logos";

export type SupportedPool = {
  key: string;
  label: string;
  /**
   * For v3 pools this is the pool contract address (lowercased).
   * For v4 pools this should be the indexer Pool.id (opaque poolKey).
   * For v2 pools this is the pair contract address (lowercased).
   * For raydium pools this is the Solana pool pubkey (base58, case-sensitive).
   */
  poolKey: string;
  protocol: "v2" | "v3" | "v4" | "raydium" | "meteora";
  chain?: "evm" | "solana";
  chainId?: number;
  /** Which space this pool belongs to */
  spaceSlug: string;
  /** Optional override for UI asset grouping when the visible label is venue-specific. */
  trackedAssetSymbol?: string;
  /** Optional pool/venue logo shown where UI renders this pool specifically. */
  logo?: string;
};

export type SolanaPoolMetadata = {
  name: string;
  symbol: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  token0Mint?: string;
  token1Mint?: string;
  token0Vault?: string;
  token1Vault?: string;
  logo?: string;

  fee?: number;
  tickSpacing?: number;
};

const KRAKEN_SPACE_SLUG = "kraken";
const DEMO_SPACE_SLUG_INTERNAL = DEMO_SPACE_SLUG;
const SOLANA_FOUNDATION_SPACE_SLUG = "solana-foundation";
const GENSYN_SPACE_SLUG = "gensyn";
const KATANA_SPACE_SLUG = "katana";
const PERLE_SPACE_SLUG = "perle";
const MONAD_SPACE_SLUG = "monad";
const ZEROG_SPACE_SLUG = "0g-ai";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkYF4G9ye";

type DemoQuoteSymbol = "USDC" | "USDT";

export type DemoTokenConfig = {
  symbol: string;
  name: string;
  quote: DemoQuoteSymbol;
  priceUsd: number;
  mint: string;
  legacySymbols?: string[];
};

export const DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL: Record<string, DemoTokenConfig> = {
  TSLAx: {
    symbol: "AZR",
    name: "Azura",
    quote: "USDC",
    priceUsd: 28.5,
    mint: "demo-token-mint-azr",
    legacySymbols: ["AZUR"],
  },
  NVDAx: {
    symbol: "BOR",
    name: "Bora",
    quote: "USDT",
    priceUsd: 18.4,
    mint: "demo-token-mint-bor",
    legacySymbols: ["BORA"],
  },
  SPYx: {
    symbol: "CYR",
    name: "Cyra",
    quote: "USDC",
    priceUsd: 59,
    mint: "demo-token-mint-cyr",
    legacySymbols: ["CYRA"],
  },
  QQQx: {
    symbol: "DOV",
    name: "Dova",
    quote: "USDT",
    priceUsd: 51,
    mint: "demo-token-mint-dov",
    legacySymbols: ["DOVA"],
  },
  GLDx: {
    symbol: "ELA",
    name: "Elia",
    quote: "USDC",
    priceUsd: 31.4,
    mint: "demo-token-mint-ela",
    legacySymbols: ["ELIA"],
  },
  GOOGLx: {
    symbol: "FAR",
    name: "Faro",
    quote: "USDT",
    priceUsd: 17.2,
    mint: "demo-token-mint-far",
    legacySymbols: ["FARO"],
  },
  HOODx: {
    symbol: "GLM",
    name: "Glim",
    quote: "USDC",
    priceUsd: 6.9,
    mint: "demo-token-mint-glm",
    legacySymbols: ["GLIM"],
  },
  CRCLx: {
    symbol: "HEL",
    name: "Heli",
    quote: "USDT",
    priceUsd: 9.2,
    mint: "demo-token-mint-hel",
    legacySymbols: ["HELI"],
  },
  METAx: {
    symbol: "IVR",
    name: "Ivra",
    quote: "USDC",
    priceUsd: 64.2,
    mint: "demo-token-mint-ivr",
    legacySymbols: ["IVRA"],
  },
  COINx: {
    symbol: "JUR",
    name: "Jura",
    quote: "USDT",
    priceUsd: 25.6,
    mint: "demo-token-mint-jur",
    legacySymbols: ["JURA"],
  },
  STRCx: {
    symbol: "LYR",
    name: "Lyra",
    quote: "USDC",
    priceUsd: 37.1,
    mint: "demo-token-mint-lyr",
    legacySymbols: ["LYRA"],
  },
  SPCXx: {
    symbol: "KAI",
    name: "Kaia",
    quote: "USDC",
    priceUsd: 42.8,
    mint: "demo-token-mint-kai",
    legacySymbols: ["KAIA"],
  },
};

export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 480);
export const PERLE_BSC_PANCAKE_INFINITY_CL_POOL_ID =
  "0xb0bab780d44ca5245a4b6da9ea8fd79e04e7a92850cfc2b52a33c4d82463726b";
export const PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY =
  `56-v4-${PERLE_BSC_PANCAKE_INFINITY_CL_POOL_ID}`;
export const KATANA_CHAIN_ID = 747474;
export const KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY =
  "0x2a2c512beaa8eb15495726c235472d82effb7a6b";
export const MONAD_CHAIN_ID = 143;
export const MONAD_DUST_USDC_V2_POOL_KEY =
  "0x86dbf00485871c901c5129bd525348db96c2eb2d";
export const ZEROG_CHAIN_ID = 16661;
export const ZEROG_W0G_USDCE_V3_POOL_KEY =
  "0xce77377cdfeb967ff2bb6f223ae74e1ae8dcfc71";
export const ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY =
  "0x159fe1d57b464ed60e2bfbbca0df444999131673";
export const ZEROG_ZIA_W0G_USDCE_LOGO =
  "https://storage.googleapis.com/merkl-static-assets/protocols/zia.jpg";
export const ZEROG_ZIA_W0G_WETH_V3_POOL_KEY =
  "0x8d3f4d8276f02c1deebc73348894e676026196cd";
export const ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY =
  "0x0d227571872b8305afd53b9dbd384bdbcde15f82";
export const ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY =
  "0x22b46cd7402773878b1d74a02037d83f58e942ec";
export const ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY =
  "0x526df22afa26aca3af82ee24a114ea333c32851a";
export const BSC_CHAIN_ID = 56;
export const BSC_PANCAKE_V3_0G_USDT_POOL_KEY =
  "0x808a3f77c4be4e1ae5dab0f63cca2cbfde281dc5";
export const WARS_USDC_V4_POOL_KEY =
  `${DEFAULT_CHAIN_ID}-v4-0xe7bba98b4e9c077d0af3b91b4ecfcdc68e3214917ed4e361ed28eb60e87ea6fa`;

export const SOLANA_POOL_METADATA_BY_ADDRESS: Record<string, SolanaPoolMetadata> = {
  FkkbETZWmBFXqVHLxZHJAyML2YeEuAjfm2U7yywckQiQ: {
    name: "Worldcoin",
    symbol: "WLD/USDC",
    token0Symbol: "WLD",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "DN4L5JE9VuGpMt1SsEWqyybUqyrYuWuywmTq7Q5GVDFK",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    fee: 2500,
    tickSpacing: 80,
  },
  HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum: {
    name: "Tesla",
    symbol: "TSLAx/USDC",
    token0Symbol: "TSLAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "D2JXvYgyqo2CktPN4aNfdmHn8mK2vrF9essKdH8M4wn7",
    token1Vault: "3h7wgb4hzxjM2F7fmLgwuzZxzuztUvUMdThnrmy9bTdF",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",

    fee: 2500,
    tickSpacing: 60,
  },
  "4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN": {
    name: "NVIDIA",
    symbol: "NVDAx/USDC",
    token0Symbol: "NVDAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "8yUe5to4WzcDTM7zY1k9T6d6SZQqeXnKSRxZ6jGseFeX",
    token1Vault: "GHtx7Ff9j79nUTaRq6abyi6VSqgJ5c4XAGBqnWykHtDt",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",

    fee: 2500,
    tickSpacing: 60,
  },
  "7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME": {
    name: "S&P 500",
    symbol: "SPYx/USDC",
    token0Symbol: "SPYx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "Hfpwtfbjxtd1CayUHYkqe2S1aim5uYCjbFSEFN6qRokj",
    token1Vault: "BBaEjPrPScXv12hnLzNbSa91L3Te5SopAyCjA37UTBeo",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/SPYx.png",

    fee: 2500,
    tickSpacing: 60,
  },
  FknDV1F5n6QaA7rLmjquDjuU6wcPMNm5RYq7zWbqhpZw: {
    name: "Nasdaq-100",
    symbol: "QQQx/USDC",
    token0Symbol: "QQQx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "EwvUC5UCDsAsdkSXNeVJp77ooQvJRRK21oNcpvgqPyte",
    token1Vault: "4DqRE6N2yvXrT4cUpzenMVSYGswvkE36hjUJdtyCZqSP",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/QQQx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze": {
    name: "Gold",
    symbol: "GLDx/USDC",
    token0Symbol: "GLDx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "Qf2BrMGurzSMiqeXNKQdG6XzbWeWG9FCP7tndHNikNj",
    token1Vault: "8BECXqsvkZcWD1MpzYV4p7NXD8xu5ZzquQ52NNGFqUsm",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/GLDx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw: {
    name: "Alphabet",
    symbol: "GOOGLx/USDC",
    token0Symbol: "GOOGLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "8egAoaRyscTY8Quo1AKhCCZmXHDdBkUu2WSCF86g7kZK",
    token1Vault: "7fyQSFJLS9hcmp53VTKnvvQ7Rpt2KcZkhvJyKDRJivYg",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/GOOGLx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  "3Z4H4H9bCcLyt1MmK44J5KZWkJ7taiU821QDTVZYaCpz": {
    name: "Robinhood",
    symbol: "HOODx/USDC",
    token0Symbol: "HOODx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "61RmD25gUucxvJqHNUwoPfZ9hj6pu5MCPA7jLMfMHZU7",
    token1Vault: "2QdWwiXzwNQ6YP4JnhwGauN7S2tp4AUycwVfmxbG1vbC",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/HOODx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  G39wywquKbHK8F2wZZZFX3fcsyG91VCCbbr6WEVp5axy: {
    name: "Circle",
    symbol: "CRCLx/USDC",
    token0Symbol: "CRCLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "2E4iJMqtDz6hhvpBb5HJ1GfQk1RuhnuAp6uCywTB1qYM",
    token1Vault: "TMuoeZMJ4HVJcELyJ44EXGPo6SPRANda5ZHPcRymMSb",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/CRCLx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j": {
    name: "Meta Platforms",
    symbol: "METAx/USDC",
    token0Symbol: "METAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "BMS7RrFtXNByMZoAAyViq4LhhUDDZBLfyY3Ni1W9iptc",
    token1Vault: "EbqkNhtHX6oNRzWuArFut7C5WXfiU2fEVEmg8rmHKsmc",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/METAx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  "5pobXosbeGSCRG3HdaRiw2TaihDDQMXkHFVbUTF24weM": {
    name: "Coinbase",
    symbol: "COINx/USDC",
    token0Symbol: "COINx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "HDmBqVr4W6QoZL76y5oeLftHRrnmHDUEmvX75pZCgehg",
    token1Vault: "Bykx81MhyMemTa9bkqCcu54RLTFBc3cM8VwCexXiHTiZ",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/COINx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  DU9dgBU6Yh2JjsYcjtRY21G14dhQxn6Xm5PT949Sa4tA: {
    name: "Strategy",
    symbol: "STRCx/USDC",
    token0Symbol: "STRCx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "CkcDtniHJTCifvDFEb1dTJmnSHDwseFGUDx8eBHqn8NE",
    token1Vault: "9thvy3baPRwCfg7q4Boei8ug4Y5Yj5hnhykJ2Q8PHVcB",
    logo: "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234",
    fee: 1000,
    tickSpacing: 10,
  },
  DppCVaAGq5VA9gGK32u21JNqBf5d7jqH7RGDEvj39gQY: {
    name: "Strategy",
    symbol: "STRCx/USDC",
    token0Symbol: "STRCx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "3eATDADEUAQmssCpvWARXX8fha2zzo3dFjYDHRgyXKvN",
    token1Vault: "2s5YuMT9LhxQjta7ekfaiva5cL2RcRr8wqPGLXuskUYM",
    logo: "https://coin-images.coingecko.com/coins/images/71033/large/Ticker_STRCx__Company_Name_Strategy_PP_Variable__size_200x200.png?1765380234",
    fee: 2000,
    tickSpacing: 10,
  },
  AHNN6JmvaGG6XUoSg7sEr38gRYDB2jTbUvqXVuqaRHpq: {
    name: "SpaceX",
    symbol: "SPCXx/USDC",
    token0Symbol: "SPCXx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "2wmq9LoqAjyKr5YkenAkGozA7xZvbfrCqJXFUuyQHYoa",
    token1Vault: "AUpEZuNEZfqUXqsoiTymSEwiRXwT67Vvr1bnBqyQSzNv",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/SPCXx.png",
    fee: 8000,
    tickSpacing: 60,
  },
  AisqJxdYQFBbJtsCtTLzFVW5zDMSXK7QJ9F86ybpX8c6: {
    name: "SpaceX",
    symbol: "SPCXx/USDC",
    token0Symbol: "SPCXx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "DCPtPsT4NxLPV9ZNz7DXz9rt4GdqS9KsE18R7Eng8j6W",
    token1Vault: "GGu8AAWAgmLm66ZXhsvRumsYuDinCsMUaqQzUy2oyBme",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/SPCXx.png",
    fee: 2500,
    tickSpacing: 60,
  },
  DYxp5fh3Eh7iDEVHv9bFLGnPwvXwFe5YWpGayJuzzbgd: {
    name: "Perle",
    symbol: "PRL/USDC",
    token0Symbol: "PRL",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "PERLEQKUNUp1dgFZ8EvyXHdN9d6ZQqfGxALDvfs6pDs",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "TqtSGpqMCN4rbZeDrqBr8BZgf3JLNCUtrECrnj7YcqH",
    token1Vault: "8tEdehwfon974LXywDLh4bpygZU2odt32FfgyXAff1Yx",
    logo: "/icons/perle-logo.webp",
    fee: 1000,
    tickSpacing: 10,
  },
  // ── Raydium CLMM alternate fee-tier pools ──
  "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF": {
    name: "Tesla",
    symbol: "TSLAx/USDC",
    token0Symbol: "TSLAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "CYfaMvz6ft1YahGnetsGP3E8GWkURdJcDSzfihGrH8Qo",
    token1Vault: "8JyAULXLSRjxAmzE2MfrgeHhTg8J1DRMqas1gaRn85ot",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6": {
    name: "NVIDIA",
    symbol: "NVDAx/USDC",
    token0Symbol: "NVDAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "DyKsypuzQvhi37K8UvjCMBC43h4HtW4r6jhWoqHyrSSe",
    token1Vault: "4JEtq7NraU9U5URcCKSv6sWRRgDSuSnUjYDqpSJSWohY",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE": {
    name: "S&P 500",
    symbol: "SPYx/USDC",
    token0Symbol: "SPYx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "CiQuPAfYp5v82vijk6u7wqFnaZqtGdJfUUSjDKAtT9ML",
    token1Vault: "3EmW8zJDHrfgwpQJAt1oD6nxgQZLUwrCRSKk8Gr3iKRF",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/SPYx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG: {
    name: "Nasdaq-100",
    symbol: "QQQx/USDC",
    token0Symbol: "QQQx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "4RWQkhLbmgQ4xeQyY2iqAqiEFkRNWB5gdChZkXaFUVxY",
    token1Vault: "D3JT9Uam9DAuBysFvpYDTxQqLuTxRrVwuj5je1XCLLU7",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/QQQx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  DXWbip5LducMAbDSSpLYz9Xik3253EPeAYQufQtx7LXs: {
    name: "Robinhood",
    symbol: "HOODx/USDC",
    token0Symbol: "HOODx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "9DydSm4vvfDRKTg81sFqadFvPb21aayxwNLkW7MNwVMD",
    token1Vault: "93QSfpPGq7KS79fgFLu5nQ9ACPjCpf4JLmuu3i8VXymM",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/HOODx.png",
    fee: 10000,
    tickSpacing: 120,
  },
  GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV: {
    name: "Circle",
    symbol: "CRCLx/USDC",
    token0Symbol: "CRCLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "DMQver7kdMua1ANBY1rJPEFCX594zWn81ihv2yMVFEsF",
    token1Vault: "8awg4iLSUmmmrkUGgj3T8VuWyvHRPudsLz8skyb3xV92",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/CRCLx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  "4J8ovNwnTcPP8cYfveMNvhT7k6LfmJh2Fd8kboyGJfGq": {
    name: "Circle",
    symbol: "CRCLx/USDC",
    token0Symbol: "CRCLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "9aP8CaQD6xYcmru5fo5izoYCHFtsmP6mgGSZZwx3UvzU",
    token1Vault: "Br7mf3hxtvvMK7QTScmdvMeWF8zioQser5Utyf6iAJjs",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/CRCLx.png",
    fee: 10000,
    tickSpacing: 120,
  },
  "3LbRQkdRnahJfAEBBRajCMki8ZBMhBhidmxbgMzp8nVu": {
    name: "Coinbase",
    symbol: "COINx/USDC",
    token0Symbol: "COINx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "79LbpCh2UwQYvurRk9wcU8Pa6JBzAUKeQH87d5hvDJxY",
    token1Vault: "HtjroMGtKtpairL33Bzdwr4tN4vS63MnuhSavodZbeQv",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/COINx.png",
    fee: 10000,
    tickSpacing: 120,
  },
  // ── Byreal pools ──
  "6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs": {
    name: "Tesla",
    symbol: "TSLAx/USDC",
    token0Symbol: "TSLAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "3jw1BUabindVnNny6Y7PTUwYSD4JXofWE6oHraQjvbcB",
    token1Vault: "DmFeEheo21zeRi6y7CLUSVpFVq33MjMYeDeL51iKYwgg",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  GjLusGo2z3mnXPmebhhNt9ocMDJgfdxrDFctVF8Ev3Kg: {
    name: "NVIDIA",
    symbol: "NVDAx/USDC",
    token0Symbol: "NVDAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "14fhv98NmX6sDiyiLDsP2WrDHJuD4k5gd5SmiqaJgh7U",
    token1Vault: "H66hccvb28JaK6p7jqsNyFkyrc5vNzyDBzWvTveyJFds",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  "27x6aSxcAm6SoazoxmmTtFg6fWMQuNmdKJmHagq1DUZy": {
    name: "S&P 500",
    symbol: "SPYx/USDC",
    token0Symbol: "SPYx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "EmgcRJvrSwnHKnqTe8RHyeRsu9GukAYXRQkv8qspGsnf",
    token1Vault: "FGdm1Ww1ch138kWjjEigFUFncxzkvfZ6m8Fo1YvM8BMu",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/SPYx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  FSLSua26xaXSLUG31SnyifgS6wgkRh5SirbCZW9zXNoG: {
    name: "Nasdaq-100",
    symbol: "QQQx/USDC",
    token0Symbol: "QQQx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "4ggNsGJHgBLJAk4SdKySq8QFpvFQ5qvvPqbwvYCAJBg3",
    token1Vault: "8Q161sJzS6E9SD14eRsHxjLLxr599axBemwcgZy651jx",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/QQQx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  "4k43WcUS8kPXkmL7PhgpwCteYYaSgzXvfKU63FEE1WS5": {
    name: "Alphabet",
    symbol: "GOOGLx/USDC",
    token0Symbol: "GOOGLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "4CKe7EYKUnqGUenBWDi42K8U28Ekn4bFYpNbiPVHXfro",
    token1Vault: "G3z1p6vFkV15QSpvLKSey7LJCGeSX96pLxu8dV9w99id",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/GOOGLx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa: {
    name: "Circle",
    symbol: "CRCLx/USDC",
    token0Symbol: "CRCLx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "8feVD1rbhaE17kZiWhTssFrC75DUoJUCX9SLZ6C9oxhd",
    token1Vault: "5JcntpKHEy2vyjCiiLY5e4Te1ZVG1zU6pp6ZU667d6tw",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/CRCLx.png",
    fee: 1000,
    tickSpacing: 10,
  },
  BqXGCG4vcD81GMiX2Rw9sKrSTqeAAZS6mGR5Ek69B7Lm: {
    name: "Meta Platforms",
    symbol: "METAx/USDC",
    token0Symbol: "METAx",
    token1Symbol: "USDC",
    token0Decimals: 8,
    token1Decimals: 6,
    token0Mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    token1Mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    token0Vault: "HhYTmxZJnQffnVE1VFVeF8ywZJ9G3k2Nf71pSNwMHmXX",
    token1Vault: "2oy56ynCrDwnLZygaVd4V2bDwMkzWQRa3x6VpyFbmZbL",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/METAx.png",
    fee: 1000,
    tickSpacing: 10,
  },
};

const BASE_SUPPORTED_POOLS: SupportedPool[] = [
  // ── Worldchain pools ──
  {
    key: "wld-usdc",
    label: "WLD / USDC",
    poolKey: "0x610e319b3a3ab56a0ed5562927d37c233774ba39",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "solana-wld-usdc",
    label: "WLD / USDC",
    poolKey: "FkkbETZWmBFXqVHLxZHJAyML2YeEuAjfm2U7yywckQiQ",
    protocol: "meteora",
    chain: "solana",
    spaceSlug: "worldchain",
  },
  {
    key: "wld-weth",
    label: "WLD / WETH",
    poolKey: "0x494d68e3cab640fa50f4c1b3e2499698d1a173a0",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "wbtc-usdc",
    label: "WBTC / USDC",
    poolKey: "0xdce053d9ba0fa2c5f772416b64f191158cbcc32e",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "wbtc-weth",
    label: "WBTC / WETH",
    poolKey: "0x7c3c2a92598d6d77e57fd55c50e99af4b291f595",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "wld-wbtc",
    label: "WLD / WBTC",
    poolKey: "0x1a4abfe77b9aec6259757805bd0d3c46fca6d494",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "weth-usdc",
    label: "WETH / USDC",
    poolKey: "0x5f835420502a7702de50cd0e78d8aa3608b2137e",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "eurc-usdc-e",
    label: "EURC / USDC.e",
    poolKey: "0xee4c0cd5bc4a68c7573d82bb31d4dc9de1f53eca",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "eth-mads",
    label: "ETH / MADS",
    poolKey: "0x10b3bf9cd0689c4581875b29ce5f106ae6188064",
    protocol: "v3",
    spaceSlug: "worldchain",
  },
  {
    key: "wars-usdc-v4",
    label: "wARS / USDC",
    poolKey: WARS_USDC_V4_POOL_KEY,
    protocol: "v4",
    spaceSlug: "worldchain",
  },
  {
    key: "oxaut-usdc-v4",
    label: "oXAUT / USDC",
    poolKey: `${DEFAULT_CHAIN_ID}-v4-0xdcab9c556ed41c6e046f1ca00cb1f1a4ea7a9c0952cd76bdd9db4534e9e8b9ea`,
    protocol: "v4",
    spaceSlug: "worldchain",
  },
  // ── Gensyn Ethereum pools ──
  {
    key: "gensyn-ai-usdc-v4",
    label: "AI / USDC",
    poolKey: "1-v4-0x45987a457854bb7205086e0826ab2988e556f0fef7af4299ab5febb9fc13d8d4",
    protocol: "v4",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  {
    key: "gensyn-ai-usdt-v4",
    label: "AI / USDT",
    poolKey: "1-v4-0x88ff197d8fe8a68722f59c93eef447a4b54ebe8543bf0392246448a04956915a",
    protocol: "v4",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  {
    key: "gensyn-ai-usdc-v4-2ae30",
    label: "AI / USDC · 2ae30",
    poolKey: "1-v4-0x2ae30b23a4fe9be23cb338760727999f1ae6f68f2e086a5c54e0a627f81b5526",
    protocol: "v4",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  {
    key: "gensyn-ai-eth-v4",
    label: "AI / ETH",
    poolKey: "1-v4-0x87265ba29f072b718aa93316b12c7d6afefc141d7873a14bd824249b519d346c",
    protocol: "v4",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  {
    key: "gensyn-ai-usdc-v4-4bc08",
    label: "AI / USDC · 4bc08",
    poolKey: "1-v4-0x4bc08865f095ab0989f825c51131be96cf4a10334cb94be5a3106d94dabff514",
    protocol: "v4",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  {
    key: "gensyn-ai-usdc-v4-41fbe",
    label: "AI / USDC · 41fbe",
    poolKey: "1-v4-0x41fbebabb824da94c04965fe387668a70d6a3d44f1313dc4eb5458a2cdd3f815",
    protocol: "v4",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  {
    key: "gensyn-ai-usdc-v3",
    label: "AI / USDC",
    poolKey: "0x3198ca64ebff6d008860f2c450cfcbf1faac7677",
    protocol: "v3",
    spaceSlug: GENSYN_SPACE_SLUG,
  },
  // -- Katana Sushi V3 pools --
  {
    key: "katana-sushi-v3-vbusdc-vbeth",
    label: "vbUSDC / vbETH",
    poolKey: KATANA_SUSHI_V3_VBUSDC_VBETH_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: KATANA_CHAIN_ID,
    spaceSlug: KATANA_SPACE_SLUG,
  },
  // ── Monad Uniswap V2 pools ──
  {
    key: "monad-dust-usdc-v2",
    label: "DUST / USDC",
    poolKey: MONAD_DUST_USDC_V2_POOL_KEY,
    protocol: "v2",
    chain: "evm",
    chainId: MONAD_CHAIN_ID,
    spaceSlug: MONAD_SPACE_SLUG,
  },
  // ── 0G AI Uniswap V3 pools ──
  {
    key: "zerog-w0g-usdce-v3",
    label: "W0G / USDC.e",
    poolKey: ZEROG_W0G_USDCE_V3_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: ZEROG_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
  },
  {
    key: "zerog-zia-w0g-usdce-v3",
    label: "Zia W0G / USDC.e",
    poolKey: ZEROG_ZIA_W0G_USDCE_V3_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: ZEROG_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
    trackedAssetSymbol: "W0G",
    logo: ZEROG_ZIA_W0G_USDCE_LOGO,
  },
  {
    key: "zerog-zia-w0g-weth-v3",
    label: "Zia W0G / WETH",
    poolKey: ZEROG_ZIA_W0G_WETH_V3_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: ZEROG_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
    trackedAssetSymbol: "W0G",
    logo: ZEROG_ZIA_W0G_USDCE_LOGO,
  },
  {
    key: "zerog-zia-wbtc-w0g-v3",
    label: "Zia WBTC / W0G",
    poolKey: ZEROG_ZIA_WBTC_W0G_V3_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: ZEROG_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
    trackedAssetSymbol: "WBTC",
    logo: ZEROG_ZIA_W0G_USDCE_LOGO,
  },
  {
    key: "zerog-zia-usdce-weth-v3",
    label: "Zia USDC.e / WETH",
    poolKey: ZEROG_ZIA_USDCE_WETH_V3_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: ZEROG_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
    trackedAssetSymbol: "WETH",
    logo: ZEROG_ZIA_W0G_USDCE_LOGO,
  },
  {
    key: "zerog-zia-ousdt-usdce-v3",
    label: "Zia oUSDT / USDC.e",
    poolKey: ZEROG_ZIA_OUSDT_USDCE_V3_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: ZEROG_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
    trackedAssetSymbol: "oUSDT",
    logo: ZEROG_ZIA_W0G_USDCE_LOGO,
  },
  {
    key: "pancake-v3-0g-usdt",
    label: "0G / USDT",
    poolKey: BSC_PANCAKE_V3_0G_USDT_POOL_KEY,
    protocol: "v3",
    chain: "evm",
    chainId: BSC_CHAIN_ID,
    spaceSlug: ZEROG_SPACE_SLUG,
  },
  // ── Perle pools ──
  {
    key: "raydium-prl-usdc",
    label: "PRL / USDC",
    poolKey: "DYxp5fh3Eh7iDEVHv9bFLGnPwvXwFe5YWpGayJuzzbgd",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: PERLE_SPACE_SLUG,
  },
  {
    key: "pancake-infinity-prl-usdt",
    label: "PRL / USDT",
    poolKey: PERLE_BSC_PANCAKE_INFINITY_CL_POOL_KEY,
    protocol: "v4",
    chain: "evm",
    chainId: 56,
    spaceSlug: PERLE_SPACE_SLUG,
  },
  // ── Kraken pools ──
  {
    key: "raydium-tslax-usdc",
    label: "TSLAx / USDC",
    poolKey: "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-nvdax-usdc",
    label: "NVDAx / USDC",
    poolKey: "4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-spyx-usdc",
    label: "SPYx / USDC",
    poolKey: "7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-qqqx-usdc",
    label: "QQQx / USDC",
    poolKey: "FknDV1F5n6QaA7rLmjquDjuU6wcPMNm5RYq7zWbqhpZw",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-gldx-usdc",
    label: "GLDx / USDC",
    poolKey: "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-googlx-usdc",
    label: "GOOGLx / USDC",
    poolKey: "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-hoodx-usdc",
    label: "HOODx / USDC",
    poolKey: "3Z4H4H9bCcLyt1MmK44J5KZWkJ7taiU821QDTVZYaCpz",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-crclx-usdc",
    label: "CRCLx / USDC",
    poolKey: "G39wywquKbHK8F2wZZZFX3fcsyG91VCCbbr6WEVp5axy",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-metax-usdc",
    label: "METAx / USDC",
    poolKey: "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-coinx-usdc",
    label: "COINx / USDC",
    poolKey: "5pobXosbeGSCRG3HdaRiw2TaihDDQMXkHFVbUTF24weM",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-strcx-usdc",
    label: "STRCx / USDC",
    poolKey: "DU9dgBU6Yh2JjsYcjtRY21G14dhQxn6Xm5PT949Sa4tA",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-spcxx-usdc",
    label: "SPCXx / USDC",
    poolKey: "AHNN6JmvaGG6XUoSg7sEr38gRYDB2jTbUvqXVuqaRHpq",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-spcxx-usdc-2",
    label: "SPCXx / USDC",
    poolKey: "AisqJxdYQFBbJtsCtTLzFVW5zDMSXK7QJ9F86ybpX8c6",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  // ── Kraken Raydium CLMM alternate fee-tier pools ──
  {
    key: "raydium-tslax-usdc-2",
    label: "TSLAx / USDC",
    poolKey: "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-nvdax-usdc-2",
    label: "NVDAx / USDC",
    poolKey: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-spyx-usdc-2",
    label: "SPYx / USDC",
    poolKey: "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-qqqx-usdc-2",
    label: "QQQx / USDC",
    poolKey: "GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-hoodx-usdc-2",
    label: "HOODx / USDC",
    poolKey: "DXWbip5LducMAbDSSpLYz9Xik3253EPeAYQufQtx7LXs",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-crclx-usdc-2",
    label: "CRCLx / USDC",
    poolKey: "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-crclx-usdc-3",
    label: "CRCLx / USDC",
    poolKey: "4J8ovNwnTcPP8cYfveMNvhT7k6LfmJh2Fd8kboyGJfGq",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-coinx-usdc-2",
    label: "COINx / USDC",
    poolKey: "3LbRQkdRnahJfAEBBRajCMki8ZBMhBhidmxbgMzp8nVu",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "raydium-strcx-usdc-2",
    label: "STRCx / USDC",
    poolKey: "DppCVaAGq5VA9gGK32u21JNqBf5d7jqH7RGDEvj39gQY",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  // ── Kraken Byreal pools ──
  {
    key: "byreal-tslax-usdc",
    label: "TSLAx / USDC",
    poolKey: "6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "byreal-nvdax-usdc",
    label: "NVDAx / USDC",
    poolKey: "GjLusGo2z3mnXPmebhhNt9ocMDJgfdxrDFctVF8Ev3Kg",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "byreal-spyx-usdc",
    label: "SPYx / USDC",
    poolKey: "27x6aSxcAm6SoazoxmmTtFg6fWMQuNmdKJmHagq1DUZy",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "byreal-qqqx-usdc",
    label: "QQQx / USDC",
    poolKey: "FSLSua26xaXSLUG31SnyifgS6wgkRh5SirbCZW9zXNoG",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "byreal-googlx-usdc",
    label: "GOOGLx / USDC",
    poolKey: "4k43WcUS8kPXkmL7PhgpwCteYYaSgzXvfKU63FEE1WS5",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "byreal-crclx-usdc",
    label: "CRCLx / USDC",
    poolKey: "Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
  {
    key: "byreal-metax-usdc",
    label: "METAx / USDC",
    poolKey: "BqXGCG4vcD81GMiX2Rw9sKrSTqeAAZS6mGR5Ek69B7Lm",
    protocol: "raydium",
    chain: "solana",
    spaceSlug: KRAKEN_SPACE_SLUG,
  },
];

const SOLANA_FOUNDATION_POOLS: SupportedPool[] = BASE_SUPPORTED_POOLS
  .filter((pool) => pool.spaceSlug === KRAKEN_SPACE_SLUG && pool.chain === "solana")
  .map((pool) => ({
    ...pool,
    key: `${SOLANA_FOUNDATION_SPACE_SLUG}-${pool.key}`,
    spaceSlug: SOLANA_FOUNDATION_SPACE_SLUG,
  }));

const DEMO_SOURCE_POOL_KEY_BY_POOL_KEY = new Map<string, string>();
const DEMO_POOL_KEY_BY_LEGACY_KEY = new Map<string, string>();

function getDemoTokenConfig(sourceMetadata?: SolanaPoolMetadata): DemoTokenConfig | null {
  if (!sourceMetadata) return null;
  return DEMO_TOKEN_CONFIG_BY_SOURCE_SYMBOL[sourceMetadata.token0Symbol] ?? null;
}

function getDemoQuoteMint(quote: DemoQuoteSymbol): string {
  return quote === "USDT" ? SOLANA_USDT_MINT : SOLANA_USDC_MINT;
}

function getDemoPoolKey(sourcePool: SupportedPool, config: DemoTokenConfig, symbol = config.symbol): string {
  const venue = sourcePool.key.startsWith("byreal-")
    ? "byreal"
    : sourcePool.key.startsWith("meteora-")
      ? "meteora"
      : "raydium";
  const tierSuffix = sourcePool.key.match(/-(\d+)$/)?.[0] ?? "";
  return `${DEMO_POOL_KEY_PREFIX}${venue}-${symbol.toLowerCase()}-${config.quote.toLowerCase()}${tierSuffix}`;
}

const DEMO_POOLS: SupportedPool[] = BASE_SUPPORTED_POOLS
  .filter((pool) => pool.spaceSlug === KRAKEN_SPACE_SLUG && pool.chain === "solana")
  .map((pool) => {
    const sourceMetadata = SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey];
    const demoConfig = getDemoTokenConfig(sourceMetadata);
    const demoPoolKey = demoConfig
      ? getDemoPoolKey(pool, demoConfig)
      : `${DEMO_POOL_KEY_PREFIX}${pool.key}`;
    DEMO_POOL_KEY_BY_LEGACY_KEY.set(`${DEMO_POOL_KEY_PREFIX}${pool.key}`, demoPoolKey);
    if (demoConfig) {
      for (const legacySymbol of demoConfig.legacySymbols ?? []) {
        DEMO_POOL_KEY_BY_LEGACY_KEY.set(getDemoPoolKey(pool, demoConfig, legacySymbol), demoPoolKey);
      }
    }
    DEMO_SOURCE_POOL_KEY_BY_POOL_KEY.set(demoPoolKey, pool.poolKey);
    return {
      ...pool,
      key: demoPoolKey,
      label: demoConfig ? `${demoConfig.symbol} / ${demoConfig.quote}` : pool.label,
      poolKey: demoPoolKey,
      spaceSlug: DEMO_SPACE_SLUG_INTERNAL,
    };
  });

for (const pool of DEMO_POOLS) {
  const sourcePoolKey = DEMO_SOURCE_POOL_KEY_BY_POOL_KEY.get(pool.poolKey);
  const sourceMetadata = sourcePoolKey
    ? SOLANA_POOL_METADATA_BY_ADDRESS[sourcePoolKey]
    : undefined;
  const demoConfig = getDemoTokenConfig(sourceMetadata);
  if (sourceMetadata && demoConfig) {
    SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey] = {
      ...sourceMetadata,
      name: demoConfig.name,
      symbol: `${demoConfig.symbol}/${demoConfig.quote}`,
      token0Symbol: demoConfig.symbol,
      token1Symbol: demoConfig.quote,
      token0Mint: demoConfig.mint,
      token1Mint: getDemoQuoteMint(demoConfig.quote),
      token0Vault: undefined,
      token1Vault: undefined,
      logo: getDemoTokenLogo(demoConfig.symbol) ?? undefined,
    };
  } else if (sourceMetadata) {
    SOLANA_POOL_METADATA_BY_ADDRESS[pool.poolKey] = { ...sourceMetadata };
  }
}

export const SUPPORTED_POOLS: SupportedPool[] = [
  ...BASE_SUPPORTED_POOLS,
  ...SOLANA_FOUNDATION_POOLS,
  ...DEMO_POOLS,
];

export const DEFAULT_POOL_KEY = SUPPORTED_POOLS[0]!.poolKey;

/** Get pools that belong to a specific space */
export function getPoolsForSpace(spaceSlug: string): SupportedPool[] {
  return SUPPORTED_POOLS.filter((p) => p.spaceSlug === spaceSlug);
}

/** Get the default pool key for a given space */
export function getDefaultPoolKeyForSpace(spaceSlug: string): string {
  const spacePools = getPoolsForSpace(spaceSlug);
  return spacePools.length > 0 ? spacePools[0].poolKey : DEFAULT_POOL_KEY;
}

/** Normalize pool key. Solana base58 keys are case-sensitive so we only lowercase EVM keys. */
export function normalizePoolKey(poolKey: string): string {
  const trimmed = poolKey.trim();
  // Solana base58 addresses: don't lowercase
  if (isSolanaAddress(trimmed)) return trimmed;
  return trimmed.toLowerCase();
}

/** Check if a string looks like a Solana base58 address (32-44 chars, no 0x prefix). */
function isSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

function isHex32Bytes(s: string): boolean {
  const v = s.trim().toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(v);
}

function getSupportedV4PoolKeyForPoolId(poolId: string): string | null {
  const normalized = poolId.toLowerCase();
  const suffix = `-v4-${normalized}`;
  return SUPPORTED_POOLS.find((pool) => pool.protocol === "v4" && pool.poolKey.toLowerCase().endsWith(suffix))
    ?.poolKey ?? null;
}

/**
 * Accept either:
 * - v3 pool address (0x + 40 hex chars)
 * - v4 poolKey (e.g. "480-v4-0x...64hex")
 * - v4 poolIdentifier / poolId (0x + 64 hex chars) -> we convert to poolKey
 * - Solana base58 address (preserved as-is, case-sensitive)
 */
export function normalizePoolKeyInput(input: string): string {
  const v = input.trim();
  if (!v) return v;

  // Solana base58 address - preserve case
  if (isSolanaAddress(v)) return v;

  const lc = v.toLowerCase();

  // Already a v4 poolKey
  if (lc.includes("-v4-0x")) return lc;

  // Raw v4 poolId (bytes32) -> supported poolKey when known, else default-chain poolKey.
  if (isHex32Bytes(lc)) return getSupportedV4PoolKeyForPoolId(lc) ?? `${DEFAULT_CHAIN_ID}-v4-${lc}`;

  // Otherwise treat as plain poolKey (v3 address or other opaque key)
  return lc;
}

export function isSupportedPoolKey(poolKey: string): boolean {
  const nk = normalizePoolKey(poolKey);
  return SUPPORTED_POOLS.some((p) => p.poolKey === nk);
}

export function getSupportedPool(poolKey: string): SupportedPool | undefined {
  const nk = normalizePoolKey(poolKey);
  return SUPPORTED_POOLS.find((p) => p.poolKey === nk);
}

export function isWarsUsdcV4PoolKey(poolKey: string): boolean {
  return normalizePoolKey(poolKey) === WARS_USDC_V4_POOL_KEY;
}

export function isWorldchainSolanaSupportedPool(
  pool: Pick<SupportedPool, "spaceSlug" | "chain"> | undefined
): boolean {
  return pool?.spaceSlug === "worldchain" && pool.chain === "solana";
}

export function inferPoolProtocol(poolKey: string): "v2" | "v3" | "v4" | "raydium" | "meteora" {
  // Check supported pools first for explicit protocol
  const pool = getSupportedPool(poolKey);
  if (pool) return pool.protocol;
  // Heuristic detection
  const trimmed = poolKey.trim();
  if (trimmed.toLowerCase().includes("-v4-")) return "v4";
  if (isSolanaAddress(trimmed)) return "raydium";
  return "v3";
}

export function isV4PoolKey(poolKey: string): boolean {
  return inferPoolProtocol(poolKey) === "v4";
}

/** Returns true for any Solana-chain pool (Raydium CLMM or Meteora DLMM). */
export function isSolanaPool(poolKey: string): boolean {
  const p = inferPoolProtocol(poolKey);
  return p === "raydium" || p === "meteora";
}

/** Returns true only for Meteora DLMM pools (bins, not ticks). */
export function isMeteoraPool(poolKey: string): boolean {
  return inferPoolProtocol(poolKey) === "meteora";
}

export function getPoolChain(poolKey: string): "evm" | "solana" {
  const pool = getSupportedPool(poolKey);
  return pool?.chain ?? (isSolanaPool(poolKey) ? "solana" : "evm");
}

export function getExplorerUrl(poolKey: string, type: "address" | "tx", value: string): string {
  if (isSolanaPool(poolKey)) {
    return type === "tx"
      ? `https://solscan.io/tx/${value}`
      : `https://solscan.io/account/${value}`;
  }
  const supportedPool = getSupportedPool(poolKey);
  const normalizedPoolKey = poolKey.toLowerCase();
  const chainId =
    supportedPool?.chainId ??
    (supportedPool?.spaceSlug === GENSYN_SPACE_SLUG || normalizedPoolKey.startsWith("1-v4-")
      ? 1
      : normalizedPoolKey.startsWith("56-v4-")
        ? 56
        : DEFAULT_CHAIN_ID);
  if (chainId === 56) {
    return type === "tx"
      ? `https://bscscan.com/tx/${value}`
      : `https://bscscan.com/address/${value}`;
  }
  if (chainId === KATANA_CHAIN_ID) {
    return type === "tx"
      ? `https://katanascan.com/tx/${value}`
      : `https://katanascan.com/address/${value}`;
  }
  if (chainId === MONAD_CHAIN_ID) {
    return type === "tx"
      ? `https://monadscan.com/tx/${value}`
      : `https://monadscan.com/address/${value}`;
  }
  if (chainId === ZEROG_CHAIN_ID) {
    return type === "tx"
      ? `https://chainscan.0g.ai/tx/${value}`
      : `https://chainscan.0g.ai/address/${value}`;
  }
  if (chainId === 1) {
    return type === "tx"
      ? `https://etherscan.io/tx/${value}`
      : `https://etherscan.io/address/${value}`;
  }
  return type === "tx"
    ? `https://worldscan.org/tx/${value}`
    : `https://worldscan.org/address/${value}`;
}

export function getSolanaPoolMetadata(poolKey: string): SolanaPoolMetadata | undefined {
  return SOLANA_POOL_METADATA_BY_ADDRESS[poolKey];
}

export function getDemoSourcePoolKey(poolKey: string): string | undefined {
  return DEMO_SOURCE_POOL_KEY_BY_POOL_KEY.get(poolKey);
}

export function getDemoCanonicalPoolKey(poolKey: string): string | undefined {
  const normalized = poolKey.trim().toLowerCase();
  if (DEMO_SOURCE_POOL_KEY_BY_POOL_KEY.has(normalized)) return normalized;
  return DEMO_POOL_KEY_BY_LEGACY_KEY.get(normalized);
}
