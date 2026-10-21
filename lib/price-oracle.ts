import { getCoinGeckoBaseUrl, getCoinGeckoHeaders } from "@/lib/coingecko";

type TokenPrice = {
  address: string;
  priceUSD: number;
  timestamp: number;
};

function getCoinGeckoPlatformId(): string {
  // CoinGecko uses platform IDs like "ethereum", "arbitrum-one", etc.
  // For this project we default to World Chain, but allow override.
  return (process.env.NEXT_PUBLIC_COINGECKO_PLATFORM_ID ?? "world-chain").trim();
}

class PriceOracle {
  private cache = new Map<string, TokenPrice>();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  async getTokenPriceUSD(tokenAddress: string): Promise<number | null> {
    const addr = tokenAddress.toLowerCase();
    const cached = this.cache.get(addr);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) return cached.priceUSD;

    try {
      const price = await this.fetchFromCoinGecko(addr);
      if (typeof price === "number" && Number.isFinite(price)) {
        this.cache.set(addr, { address: addr, priceUSD: price, timestamp: Date.now() });
        return price;
      }
    } catch {
      // swallow; caller can fall back
    }

    return null;
  }

  clearCache() {
    this.cache.clear();
  }

  isUSDStableBySymbol(symbol?: string): boolean {
    const s = (symbol ?? "").trim().toUpperCase();
    // Some chains/indexers append suffixes like ".e" (e.g. "USDC.e").
    // Treat common stablecoin symbol variants as USD-stable to keep pair ordering consistent.
    return (
      s === "DAI" ||
      s.startsWith("USDC") ||
      s.startsWith("USDT") ||
      s.startsWith("EURC")
    );
  }

  private async fetchFromCoinGecko(tokenAddressLc: string): Promise<number | null> {
    const platformId = getCoinGeckoPlatformId();
    const url =
      `${getCoinGeckoBaseUrl()}/simple/token_price/${encodeURIComponent(platformId)}` +
      `?contract_addresses=${encodeURIComponent(tokenAddressLc)}` +
      `&vs_currencies=usd`;

    const res = await fetch(url, {
      headers: getCoinGeckoHeaders(),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number } | undefined>;
    const entry = data[tokenAddressLc];
    const usd = entry?.usd;
    return typeof usd === "number" && Number.isFinite(usd) ? usd : null;
  }
}

export const priceOracle = new PriceOracle();


