/** Shared CoinGecko Pro API helpers. */

export function getCoinGeckoBaseUrl(): string {
  return (process.env.COINGECKO_BASE_URL ?? "https://api.coingecko.com/api/v3")
    .trim()
    .replace(/\/+$/, "");
}

export function getCoinGeckoHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.COINGECKO_API_KEY?.trim();
  if (key) {
    headers["x-cg-pro-api-key"] = key;
  }
  return headers;
}
