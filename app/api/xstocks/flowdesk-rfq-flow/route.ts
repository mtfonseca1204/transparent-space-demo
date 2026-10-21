/**
 * Daily NET RFQ flow (USD) for Flowdesk's actual on-chain hot wallet,
 * computed by scanning Ethereum ERC-20 Transfer events involving the
 * configured maker address rather than the settlement contracts that the
 * indexer's `xstocks/maker-volume` endpoint groups by.
 *
 * Why this exists:
 *   The indexer keys RFQ rows by the protocol's settlement contract
 *   (0x Settler, CoW GPv2, Bebop, 1inch RFQ, KyberSwap router). Those
 *   contracts hold both legs of every fill transiently, so per-asset
 *   `in == out` to the cent. Net direction for an MM is unrecoverable
 *   that way. Pointing the watcher at Flowdesk's actual hot wallet
 *   recovers true buy/sell direction because the wallet is on one side
 *   of each trade only.
 *
 * Method per scanned tx:
 *   1. Pull Transfer events where `to == hotWallet` (in) and
 *      `from == hotWallet` (out) over the requested block range.
 *   2. Group by tx hash. Each on-chain RFQ fill is one tx with two
 *      ERC-20 transfers: the xStock leg and the USDC leg.
 *   3. If the xStock flowed INTO the wallet → maker bought xStock,
 *      buyUsd += paired USDC amount.
 *      If the xStock flowed OUT of the wallet → maker sold xStock,
 *      sellUsd += paired USDC amount.
 *      Txs without a clean (xStock + USDC) pair are ignored.
 *   4. Bucket by UTC day from the block timestamp.
 *
 * Query params:
 *   - range  "30d" (default) | "90d" | "all" (caps at 180d for RPC sanity)
 *   - addr   override hot wallet (default = FLOWDESK_HOT_WALLETS[0])
 */

import { NextRequest, NextResponse } from "next/server";
import { ethereumPublicClient } from "@/lib/viem";
import {
  FLOWDESK_FLOW_SNAPSHOT,
  FLOWDESK_FLOW_SNAPSHOT_META,
} from "@/lib/flowdesk-rfq-flow-snapshot";
import { getDemoFlowdeskRfqFlow, isDemoRequest } from "@/lib/demo/fixtures";

export const maxDuration = 600;
export const revalidate = 1800;

/**
 * Public RPCs that we'll try in order for getLogs queries. The configured
 * `ETHEREUM_RPC_URL` (used by viem's main client) is tried first via
 * `ethereumPublicClient`; this list is the fallback path for getLogs which
 * many free RPCs rate-limit or reject for large ranges.
 */
const FALLBACK_RPCS = [
  process.env.ETHEREUM_RPC_URL,
  "https://eth.llamarpc.com",
  "https://ethereum.publicnode.com",
  "https://1rpc.io/eth",
  "https://eth-mainnet.public.blastapi.io",
].filter((u): u is string => Boolean(u));

interface RawRpcLog {
  address: `0x${string}`;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: string;
}

async function rpcGetLogs(filter: {
  fromBlock: bigint;
  toBlock: bigint;
  topics: (string | null)[];
  address?: string | string[];
}): Promise<RawRpcLog[]> {
  const params: Record<string, unknown> = {
    fromBlock: `0x${filter.fromBlock.toString(16)}`,
    toBlock: `0x${filter.toBlock.toString(16)}`,
    topics: filter.topics,
  };
  if (filter.address) params.address = filter.address;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [params],
  });
  let lastErr: unknown;
  for (const url of FALLBACK_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "transparent-space" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastErr = `${url} HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { result?: RawRpcLog[]; error?: { message?: string } };
      if (json.error) {
        lastErr = `${url} ${json.error.message ?? "rpc error"}`;
        continue;
      }
      return json.result ?? [];
    } catch (err) {
      lastErr = `${url} ${(err as Error).message}`;
      continue;
    }
  }
  throw new Error(`all RPCs failed: ${String(lastErr)}`);
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const USDC_MAINNET = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDC_DECIMALS = 6;

/**
 * Known Flowdesk RFQ hot wallets on Ethereum mainnet. The first one is the
 * wallet you flagged after we saw it receive direct Bebop settlement
 * transfers and trade native + wrapped xStocks alongside USDC.
 */
export const FLOWDESK_HOT_WALLETS: `0x${string}`[] = [
  "0xCdDDbcb65F01D7696ecCA0E635F425cE4d429010",
];

/**
 * Curated xStock + USDC token contracts on Ethereum mainnet, used as an
 * `address` filter on `eth_getLogs` so we can query 10k+ blocks per call.
 * Built from the wallet's observed token activity. Add new addresses as
 * Backed lists more wrapped xStocks. USDC is included because we need it to
 * dollar-value the xStock leg.
 */
const TRACKED_TOKENS: `0x${string}`[] = [
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC (mainnet)
  "0x266e5923f6118f8b340ca5a23ae7f71897361476", // wMSTRx
  "0x93e62845c1dd5822ebc807ab71a5fb750decd15a", // wNVDAx
  "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48", // SPYx
  "0xae2f842ef90c0d5213259ab82639d5bbf649b08e", // MSTRx
  "0xc88fcd8b874fdb3256e8b55b3decb8c24eab4c02", // wSPYx
  "0xdbd9232fee15351068fe02f0683146e16d9f2cea", // wQQQx
  "0xfebded1b0986a8ee107f5ab1a1c5a813491deceb", // CRCLx
  "0x2380f2673c640fb67e2d6b55b44c62f0e0e69da9", // GLDx
];

const RESULT_CACHE_TTL_MS = 30 * 60 * 1000;
const resultCache = new Map<string, { ts: number; payload: unknown }>();

const symbolCache = new Map<string, { symbol: string; decimals: number; isXstock: boolean }>();

const SECONDS_PER_BLOCK = 12;
const RANGE_TO_DAYS: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
  all: 365,
};

interface RawTransfer {
  txHash: string;
  blockNumber: bigint;
  blockTime: number; // unix seconds
  token: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
}

interface DayBucket {
  buyUsd: number;
  sellUsd: number;
  txCount: number;
}

interface FlowdeskFlowDay {
  day: string;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  txCount: number;
}

interface FlowdeskFlowResponse {
  days: FlowdeskFlowDay[];
  totals: { buyUsd: number; sellUsd: number; netUsd: number; txCount: number };
  meta: {
    address: string;
    range: string;
    fromBlock: string;
    toBlock: string;
    rfqTxsScanned: number;
    transfersScanned: number;
    xstockTokensSeen: { address: string; symbol: string }[];
    note: string;
  };
}

function addrTopic(addr: string): `0x${string}` {
  return `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}` as `0x${string}`;
}

function topicAddr(t: string): `0x${string}` {
  return `0x${t.slice(-40).toLowerCase()}` as `0x${string}`;
}

function isXstockSymbol(sym: string): boolean {
  if (!sym) return false;
  // Native xStocks end with `x` (TSLAx, NVDAx, GLDx, BRK.Bx, etc.)
  // Wrapped xStocks have the same with a `w` prefix (wTSLAx, wMSTRx, etc.)
  // Tokenized funds also end with `x` (SPYx, QQQx, TQQQx, TBLLx).
  return /^w?[A-Z0-9.]{1,8}x$/.test(sym);
}

async function getTokenMeta(
  token: `0x${string}`
): Promise<{ symbol: string; decimals: number; isXstock: boolean }> {
  const cached = symbolCache.get(token);
  if (cached) return cached;
  try {
    const [symbol, decimals] = await Promise.all([
      ethereumPublicClient.readContract({
        address: token,
        abi: [
          {
            name: "symbol",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "string" }],
          },
        ],
        functionName: "symbol",
      }) as Promise<string>,
      ethereumPublicClient.readContract({
        address: token,
        abi: [
          {
            name: "decimals",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint8" }],
          },
        ],
        functionName: "decimals",
      }) as Promise<number>,
    ]);
    const meta = {
      symbol,
      decimals: Number(decimals),
      isXstock: isXstockSymbol(symbol),
    };
    symbolCache.set(token, meta);
    return meta;
  } catch {
    const meta = { symbol: "", decimals: 18, isXstock: false };
    symbolCache.set(token, meta);
    return meta;
  }
}

async function fetchTransfers(
  hotWallet: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint
): Promise<RawTransfer[]> {
  const out: RawTransfer[] = [];
  // With an `address` filter limited to ~10 token contracts, public RPCs
  // accept much larger block ranges than for an unfiltered Transfer query.
  // 10k blocks ≈ 1.4 days of mainnet, so 30d = 22 chunks.
  const CHUNK = 10_000n;
  let start = fromBlock;
  const blockTimeCache = new Map<bigint, number>();

  async function getBlockTime(bn: bigint): Promise<number> {
    if (blockTimeCache.has(bn)) return blockTimeCache.get(bn)!;
    try {
      const block = await ethereumPublicClient.getBlock({ blockNumber: bn });
      const t = Number(block.timestamp);
      blockTimeCache.set(bn, t);
      return t;
    } catch {
      return 0;
    }
  }

  while (start <= toBlock) {
    let end = start + CHUNK - 1n;
    if (end > toBlock) end = toBlock;
    try {
      const [inRaw, outRaw] = await Promise.all([
        rpcGetLogs({
          fromBlock: start,
          toBlock: end,
          address: TRACKED_TOKENS,
          topics: [TRANSFER_TOPIC, null, addrTopic(hotWallet)],
        }),
        rpcGetLogs({
          fromBlock: start,
          toBlock: end,
          address: TRACKED_TOKENS,
          topics: [TRANSFER_TOPIC, addrTopic(hotWallet), null],
        }),
      ]);

      // Block timestamps for any transfers we collected
      const uniqueBlocks = new Set<bigint>();
      for (const log of [...inRaw, ...outRaw]) {
        uniqueBlocks.add(BigInt(log.blockNumber));
      }
      const blockArr = [...uniqueBlocks];
      const concurrency = 6;
      for (let i = 0; i < blockArr.length; i += concurrency) {
        await Promise.all(
          blockArr.slice(i, i + concurrency).map((b) => getBlockTime(b))
        );
      }

      for (const log of inRaw) {
        if (log.topics.length < 3) continue;
        out.push({
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
          blockTime: blockTimeCache.get(BigInt(log.blockNumber)) ?? 0,
          token: log.address,
          from: topicAddr(log.topics[1]),
          to: topicAddr(log.topics[2]),
          amount: BigInt(log.data || "0x0"),
        });
      }
      for (const log of outRaw) {
        if (log.topics.length < 3) continue;
        out.push({
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
          blockTime: blockTimeCache.get(BigInt(log.blockNumber)) ?? 0,
          token: log.address,
          from: topicAddr(log.topics[1]),
          to: topicAddr(log.topics[2]),
          amount: BigInt(log.data || "0x0"),
        });
      }
    } catch (err) {
      console.warn(
        `[flowdesk-rfq-flow] giving up on blocks ${start}-${end}: ${(err as Error)?.message?.slice(0, 200)}`
      );
    }
    start = end + 1n;
  }

  return out;
}

function utcDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function aggregateRfqTxs(
  hotWallet: string,
  transfers: RawTransfer[],
  metaByToken: Map<string, { symbol: string; decimals: number; isXstock: boolean }>
): {
  byDay: Map<string, DayBucket>;
  rfqTxs: number;
  xstockTokensSeen: { address: string; symbol: string }[];
} {
  const wallet = hotWallet.toLowerCase();
  // Group by tx
  const byTx = new Map<string, RawTransfer[]>();
  for (const t of transfers) {
    const arr = byTx.get(t.txHash) ?? [];
    arr.push(t);
    byTx.set(t.txHash, arr);
  }

  const byDay = new Map<string, DayBucket>();
  let rfqTxs = 0;
  const xstockTokensSeen = new Map<string, string>();

  for (const [, txTransfers] of byTx) {
    // Find the xStock leg (token meta says isXstock) and the USDC leg
    const xstockLegs = txTransfers.filter((t) => metaByToken.get(t.token.toLowerCase())?.isXstock);
    const usdcLegs = txTransfers.filter((t) => t.token.toLowerCase() === USDC_MAINNET);
    if (xstockLegs.length === 0 || usdcLegs.length === 0) continue;

    // Pick the xStock leg involving the wallet directly
    const xstockLeg = xstockLegs.find(
      (t) => t.to.toLowerCase() === wallet || t.from.toLowerCase() === wallet
    );
    const usdcLeg = usdcLegs.find(
      (t) => t.to.toLowerCase() === wallet || t.from.toLowerCase() === wallet
    );
    if (!xstockLeg || !usdcLeg) continue;

    const xstockToWallet = xstockLeg.to.toLowerCase() === wallet;
    const usdcToWallet = usdcLeg.to.toLowerCase() === wallet;
    // Sanity: a normal RFQ trade has opposite flows for the two legs
    if (xstockToWallet === usdcToWallet) continue;

    const usdAmount = Number(usdcLeg.amount) / 10 ** USDC_DECIMALS;
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) continue;

    const ts = xstockLeg.blockTime || usdcLeg.blockTime;
    if (!ts) continue;
    const day = utcDay(ts);
    const bucket = byDay.get(day) ?? { buyUsd: 0, sellUsd: 0, txCount: 0 };
    if (xstockToWallet) bucket.buyUsd += usdAmount;
    else bucket.sellUsd += usdAmount;
    bucket.txCount += 1;
    byDay.set(day, bucket);
    rfqTxs += 1;

    const m = metaByToken.get(xstockLeg.token.toLowerCase());
    if (m) xstockTokensSeen.set(xstockLeg.token.toLowerCase(), m.symbol);
  }

  return {
    byDay,
    rfqTxs,
    xstockTokensSeen: [...xstockTokensSeen.entries()].map(([address, symbol]) => ({
      address,
      symbol,
    })),
  };
}

function utcDayMinusDays(days: number): string {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

function buildSnapshotResponse(
  range: string,
  days: number,
  wallet: string
): FlowdeskFlowResponse {
  const cutoff = utcDayMinusDays(days);
  const sliced = FLOWDESK_FLOW_SNAPSHOT.filter((d) => d.day >= cutoff);
  const days_: FlowdeskFlowDay[] = sliced.map((d) => ({
    day: d.day,
    buyUsd: d.buyUsd,
    sellUsd: d.sellUsd,
    netUsd: d.netUsd,
    txCount: d.txCount,
  }));
  const totals = days_.reduce(
    (acc, d) => ({
      buyUsd: acc.buyUsd + d.buyUsd,
      sellUsd: acc.sellUsd + d.sellUsd,
      netUsd: acc.netUsd + d.netUsd,
      txCount: acc.txCount + d.txCount,
    }),
    { buyUsd: 0, sellUsd: 0, netUsd: 0, txCount: 0 }
  );
  return {
    days: days_,
    totals,
    meta: {
      address: wallet,
      range,
      fromBlock: FLOWDESK_FLOW_SNAPSHOT_META.fromBlock,
      toBlock: FLOWDESK_FLOW_SNAPSHOT_META.toBlock,
      rfqTxsScanned: totals.txCount,
      transfersScanned: 0,
      xstockTokensSeen: [...FLOWDESK_FLOW_SNAPSHOT_META.xstockTokensSeen],
      note: `Static snapshot generated ${FLOWDESK_FLOW_SNAPSHOT_META.generatedAt} (180-day window from on-chain Flowdesk hot-wallet scan). Pass ?live=1 to force a fresh ~8min scan.`,
    },
  };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const range = params.get("range") || "30d";
  const days = Math.min(Math.max(RANGE_TO_DAYS[range] ?? 30, 1), 365);
  const addrParam = params.get("addr");
  const wallet = (addrParam ?? FLOWDESK_HOT_WALLETS[0]) as `0x${string}`;
  const live = params.get("live") === "1";

  if (isDemoRequest(req)) {
    return NextResponse.json(getDemoFlowdeskRfqFlow(range), {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Result-Cache": "demo-fixture",
      },
    });
  }

  // Default path: serve the hardcoded snapshot, sliced to the requested range.
  // The live-RPC path is too slow (~8min cold for all-time) to be on the
  // critical path of the chart. Pass ?live=1 to force a fresh fetch.
  if (!live && wallet.toLowerCase() === FLOWDESK_HOT_WALLETS[0].toLowerCase()) {
    const snapshot = buildSnapshotResponse(range, days, wallet);
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
        "X-Result-Cache": "snapshot",
      },
    });
  }

  const cacheKey = `${wallet.toLowerCase()}:${days}:live`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESULT_CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
        "X-Result-Cache": "hit",
      },
    });
  }

  const head = await ethereumPublicClient.getBlockNumber();
  const blocksPerDay = BigInt(Math.floor((24 * 60 * 60) / SECONDS_PER_BLOCK));
  const fromBlock = head - blocksPerDay * BigInt(days);
  const toBlock = head;

  const transfers = await fetchTransfers(wallet, fromBlock, toBlock);

  // Resolve token metas
  const uniqueTokens = [...new Set(transfers.map((t) => t.token.toLowerCase()))];
  const metaPairs = await Promise.all(
    uniqueTokens.map(async (t) => [t, await getTokenMeta(t as `0x${string}`)] as const)
  );
  const metaByToken = new Map(metaPairs);

  const { byDay, rfqTxs, xstockTokensSeen } = aggregateRfqTxs(
    wallet,
    transfers,
    metaByToken
  );

  const orderedDays = [...byDay.keys()].sort();
  const days_: FlowdeskFlowDay[] = orderedDays.map((day) => {
    const b = byDay.get(day)!;
    return {
      day,
      buyUsd: b.buyUsd,
      sellUsd: b.sellUsd,
      netUsd: b.buyUsd - b.sellUsd,
      txCount: b.txCount,
    };
  });

  const totals = days_.reduce(
    (acc, d) => ({
      buyUsd: acc.buyUsd + d.buyUsd,
      sellUsd: acc.sellUsd + d.sellUsd,
      netUsd: acc.netUsd + d.netUsd,
      txCount: acc.txCount + d.txCount,
    }),
    { buyUsd: 0, sellUsd: 0, netUsd: 0, txCount: 0 }
  );

  const payload: FlowdeskFlowResponse = {
    days: days_,
    totals,
    meta: {
      address: wallet,
      range,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      rfqTxsScanned: rfqTxs,
      transfersScanned: transfers.length,
      xstockTokensSeen,
      note:
        "Per-tx xStock+USDC pairing on the configured maker wallet. Direction is from the wallet's perspective: buyUsd = wallet acquired xStock (paid USDC), sellUsd = wallet distributed xStock (received USDC).",
    },
  };

  resultCache.set(cacheKey, { ts: Date.now(), payload });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
      "X-Result-Cache": "miss",
    },
  });
}
