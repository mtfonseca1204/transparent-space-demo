/**
 * REST client for the Solana Raydium pool indexer (Railway API).
 * Equivalent to envio-client.ts for the legacy EVM GraphQL indexer.
 */

const SOLANA_INDEXER_BASE =
  process.env.SOLANA_INDEXER_API_URL ??
  "https://indexer-solana-production.up.railway.app";

class SolanaApiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Generic fetch helper with retry + timeout. */
export async function fetchSolanaApi<T>(
  path: string,
  params?: Record<string, string | number | boolean | Array<string | number | boolean>>,
  opts?: { revalidate?: number }
): Promise<T> {
  const url = new URL(path, SOLANA_INDEXER_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item !== undefined && item !== null && item !== "") {
            url.searchParams.append(k, String(item));
          }
        }
        continue;
      }
      url.searchParams.set(k, String(v));
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        next: { revalidate: opts?.revalidate ?? 30 },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const snippet = body.length > 400 ? `${body.slice(0, 400)}...` : body;
        throw new SolanaApiHttpError(
          res.status,
          `Solana indexer ${path}: HTTP ${res.status} (${res.statusText}) | url=${url.toString()} | body=${snippet}`
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof SolanaApiHttpError) {
        // 4xx request errors are deterministic, so retries only add latency.
        if (err.status < 500 && err.status !== 429) {
          throw err;
        }
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export interface SolanaPaginationInfo {
  limit?: number;
  offset?: number;
  total?: number;
  has_more?: boolean;
  next_cursor?: string | null;
}

export interface SolanaListEnvelope<T> {
  data?: T[];
  pagination?: SolanaPaginationInfo;
}

export interface XstocksWeekendMover {
  rank: number;
  ticker: string;
  logo: string | null;
  friClose: number;
  sunHL: number;
  dPct: number;
  narr: string;
  hlOI: number;
  xDepth: number;
}

export interface XstocksWeekendMoversTemplateResponse {
  MOVERS: XstocksWeekendMover[];
  WEEK_LABEL: string;
  POST_TIME: string;
  BRAND_ASSETS: Record<string, string>;
}

/**
 * Fetches all pages from a Solana list endpoint that supports the new API envelope.
 * Falls back to length-based pagination for older responses.
 */
export async function fetchAllSolanaPages<T>(
  path: string,
  baseParams: Record<string, string | number | boolean | Array<string | number | boolean>>,
  opts?: { pageLimit?: number; maxPages?: number; revalidate?: number }
): Promise<T[]> {
  const pageLimit = opts?.pageLimit ?? 1000;
  const maxPages = opts?.maxPages ?? 1000;
  const all: T[] = [];

  let cursor: string | null = null;
  let offset = 0;
  let mode: "cursor" | "offset" | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string | number | boolean | Array<string | number | boolean>> = {
      ...baseParams,
      limit: pageLimit,
    };
    if (mode === "cursor" || (mode === null && cursor)) {
      if (cursor !== null) params.cursor = cursor;
    }
    if (mode === "offset") params.offset = offset;

    const payload = await fetchSolanaApi<SolanaListEnvelope<T> | T[]>(path, params, {
      revalidate: opts?.revalidate,
    });
    const rows = Array.isArray(payload) ? payload : payload.data ?? [];
    all.push(...rows);

    if (rows.length === 0) break;

    const pagination = Array.isArray(payload) ? undefined : payload.pagination;
    if (!pagination) {
      // Legacy fallback: assume fully drained when page smaller than requested limit.
      if (rows.length < pageLimit) break;
      mode = "offset";
      offset += rows.length;
      continue;
    }

    if (!mode) {
      if (pagination.next_cursor !== undefined) mode = "cursor";
      else mode = "offset";
    }

    if (!pagination.has_more) break;

    if (mode === "cursor") {
      if (!pagination.next_cursor) {
        // Defensive fallback if cursor is missing despite has_more=true.
        mode = "offset";
        offset += rows.length;
      } else {
        cursor = String(pagination.next_cursor);
      }
    } else {
      offset = typeof pagination.offset === "number" ? pagination.offset + rows.length : offset + rows.length;
    }
  }

  return all;
}

export async function fetchXstocksWeekendMoversTemplate(): Promise<XstocksWeekendMoversTemplateResponse> {
  return fetchSolanaApi<XstocksWeekendMoversTemplateResponse>(
    "/api/public/xstocks/weekend-movers-template",
    undefined,
    { revalidate: 60 }
  );
}

// ---------------------------------------------------------------------------
// Response types (matching the Railway API shapes)
// ---------------------------------------------------------------------------

export interface SolanaPriceResponse {
  protocol?: string;
  pool?: string;
  price: number;
  sqrt_price_x64?: string | null;
  tick?: string | number | null;
  liquidity?: string | number | null;
  active_bin_id?: number | null;
  last_swap_bin_id?: number | null;
  bin_step_bps?: number | null;
  token0_reserve?: string | number | null;
  token1_reserve?: string | number | null;
  block_time?: string | null;
  transaction_hash?: string | null;
}

export interface SolanaCandleResponse {
  id?: string;
  interval?: string;
  // Railway uses "open_time" (ISO date string)
  open_time?: string;
  // Alias in case the API ever uses "timestamp"
  timestamp?: string | number;
  // Railway uses "price_open" etc (not "open_price")
  price_open?: number | string;
  price_high?: number | string;
  price_low?: number | string;
  price_close?: number | string;
  // Legacy aliases
  open_price?: number | string;
  high_price?: number | string;
  low_price?: number | string;
  close_price?: number | string;
  volume_token0: string | number;
  volume_token1: string | number;
  swap_count?: string | number;
  tx_count?: number;
  total_fees?: number;
  fees_token0?: string;
  fees_token1?: string;
}

export interface SolanaSwapResponse {
  // Railway uses "swap_id"; fallback "id"
  swap_id?: string;
  id?: string;
  pool: string;
  // Railway uses "block_time"; fallback "timestamp"
  block_time?: string;
  timestamp?: string;
  // Railway returns amounts as numbers
  amount0: string | number;
  amount1: string | number;
  // Railway uses "sqrt_price_x64" (number); fallback "price"
  sqrt_price_x64?: number | string;
  price?: string;
  tick: string;
  // Railway returns liquidity as number
  liquidity: string | number;
  fee: number;
  zero_for_one?: boolean;
  sender?: string;
  recipient?: string;
  transaction_hash: string;
  block_slot: number | string;
}

export interface SolanaPositionResponse {
  // Railway uses "position_id"; fallback "nft_mint"
  position_id?: string;
  nft_mint?: string;
  // Railway uses "nft_owner"; fallback "owner"
  nft_owner?: string;
  owner?: string;
  pool?: string;
  tick_lower?: number | null;
  tick_upper?: number | null;
  liquidity?: string | number | null;
  price_lower?: number | string | null;
  price_upper?: number | string | null;
  lower_bin_id?: number | string | null;
  upper_bin_id?: number | string | null;
  active_bin_id_at_update?: number | string | null;
  current_amount0?: string | number | null;
  current_amount1?: string | number | null;
  current_value_usd?: string | number | null;
  updated_at?: string;
  opened_at: string;
  closed_at: string | null;
  is_closed?: boolean;
}

export interface SolanaPositionEventResponse {
  // Railway uses "event_id"; fallback "id"
  event_id?: string;
  id?: string;
  // Railway uses "event_type"; fallback "type"
  event_type?: string;
  type?: string;
  // Railway uses "position_nft_mint"; fallback "nft_mint"
  position_nft_mint?: string;
  nft_mint?: string;
  pool?: string;
  // Railway uses "nft_owner"; fallback "owner"
  nft_owner?: string;
  owner?: string;
  tick_lower?: number;
  tick_upper?: number;
  liquidity?: string | number | null;
  // Railway uses "deposit_amount_0"/"withdraw_amount_0"; fallback "amount0"
  deposit_amount_0?: string | null;
  deposit_amount_1?: string | null;
  withdraw_amount_0?: string | null;
  withdraw_amount_1?: string | null;
  amount0?: string;
  amount1?: string;
  amount0_delta?: string | number | null;
  amount1_delta?: string | number | null;
  lower_bin_id?: number | string | null;
  upper_bin_id?: number | string | null;
  active_bin_id_at_event?: number | string | null;
  position_id?: string;
  // Railway uses "block_time"; fallback "timestamp"
  block_time?: string;
  timestamp?: string;
  transaction_hash: string;
  block_slot: number | string;
}

export interface SolanaPoolDayData {
  date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume_token0: string;
  volume_token1: string;
  swap_count: number;
  total_fees: number;
  fee_rate: number;
  close_liquidity: number;
}

export interface SolanaLPSummary {
  wallet: string;
  total_positions: number;
  active_positions: number;
  active_liquidity: string;
}

export interface SolanaLPDistributionBucket {
  bucket: string;
  count: number;
  total_liquidity: string;
  avg_liquidity: string;
}

export interface SolanaLPEntryExit {
  date: string;
  positions_opened: string;
  positions_closed: string;
  liquidity_added: string;
  liquidity_removed: string;
}

export interface SolanaCapitalEfficiency {
  nft_mint: string;
  owner: string;
  tick_lower: number;
  tick_upper: number;
  price_lower: number;
  price_upper: number;
  liquidity: string;
  efficiency: number;
  current_tick: number;
  in_range: boolean;
}

export interface SolanaStatusResponse {
  pool: string;
  tables: Record<string, { count: number }>;
  checkpoint: {
    updated_at: string;
    last_signature: string;
    last_slot: number;
  };
  latest_swap: {
    block_slot: number;
    block_time: string;
  };
}

export interface SolanaLiquidityDistribution {
  current_tick: string;
  current_liquidity: number;
  data: Array<{
    tick_lower: number;
    tick_upper: number;
    liquidity: string;
  }>;
}
