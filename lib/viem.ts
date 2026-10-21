import { createPublicClient, http, defineChain } from "viem";
import { bsc, mainnet } from "viem/chains";

// Define Worldchain (World Chain mainnet)
export const worldchain = defineChain({
  id: 480,
  name: "World Chain",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://worldchain-mainnet.g.alchemy.com/public"],
    },
  },
  blockExplorers: {
    default: {
      name: "Worldscan",
      url: "https://worldscan.org",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

export const katana = defineChain({
  id: 747474,
  name: "Katana",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.katana.network/"],
    },
  },
  blockExplorers: {
    default: {
      name: "Katanascan",
      url: "https://katanascan.com",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: {
    decimals: 18,
    name: "MON",
    symbol: "MON",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monadscan",
      url: "https://monadscan.com",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

export const zerog = defineChain({
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "0G",
    symbol: "0G",
  },
  rpcUrls: {
    default: {
      http: ["https://evmrpc.0g.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "0G ChainScan",
      url: "https://chainscan.0g.ai",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

// Public client for read operations
export const publicClient = createPublicClient({
  chain: worldchain,
  transport: http(),
});

const ETHEREUM_RPC_URL =
  process.env.ETHEREUM_RPC_URL ?? "https://ethereum.publicnode.com";
const BSC_RPC_URL =
  process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org";
const KATANA_RPC_URL =
  process.env.KATANA_RPC_URL ?? "https://rpc.katana.network/";
const MONAD_RPC_URL =
  process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const ZEROG_RPC_URL =
  process.env.ZEROG_RPC_URL ?? "https://evmrpc.0g.ai";

export const ethereumPublicClient = createPublicClient({
  chain: mainnet,
  transport: http(ETHEREUM_RPC_URL),
});

export const bscPublicClient = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC_URL),
});

export const katanaPublicClient = createPublicClient({
  chain: katana,
  transport: http(KATANA_RPC_URL),
});

export const monadPublicClient = createPublicClient({
  chain: monad,
  transport: http(MONAD_RPC_URL),
});

export const zerogPublicClient = createPublicClient({
  chain: zerog,
  transport: http(ZEROG_RPC_URL),
});

export function getPublicClientForChainId(chainId: number | null | undefined) {
  if (chainId === 1) return ethereumPublicClient;
  if (chainId === 56) return bscPublicClient;
  if (chainId === 143) return monadPublicClient;
  if (chainId === 16661) return zerogPublicClient;
  if (chainId === 747474) return katanaPublicClient;
  return publicClient;
}
