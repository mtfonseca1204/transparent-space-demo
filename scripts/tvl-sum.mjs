#!/usr/bin/env node
/**
 * Sums Pool Liquidity (TVL) across all tracked pools using the app's own APIs.
 */

const BASE = "http://localhost:3000";

const POOLS = [
  // EVM (Worldchain)
  { key: "wld-usdc", label: "WLD / USDC", address: "0x610e319b3a3ab56a0ed5562927d37c233774ba39" },
  { key: "wld-weth", label: "WLD / WETH", address: "0x494d68e3cab640fa50f4c1b3e2499698d1a173a0" },
  { key: "wbtc-usdc", label: "WBTC / USDC", address: "0xdce053d9ba0fa2c5f772416b64f191158cbcc32e" },
  { key: "wbtc-weth", label: "WBTC / WETH", address: "0x7c3c2a92598d6d77e57fd55c50e99af4b291f595" },
  { key: "wld-wbtc", label: "WLD / WBTC", address: "0x1a4abfe77b9aec6259757805bd0d3c46fca6d494" },
  { key: "weth-usdc", label: "WETH / USDC", address: "0x5f835420502a7702de50cd0e78d8aa3608b2137e" },
  { key: "eurc-usdc", label: "EURC / USDC.e", address: "0xee4c0cd5bc4a68c7573d82bb31d4dc9de1f53eca" },
  { key: "eth-mads", label: "ETH / MADS", address: "0x10b3bf9cd0689c4581875b29ce5f106ae6188064" },
  // V4
  { key: "wars-usdc-v4", label: "wARS / USDC (v4)", address: "480-v4-0xe7bba98b4e9c077d0af3b91b4ecfcdc68e3214917ed4e361ed28eb60e87ea6fa" },
  // Solana Raydium
  { key: "tslax-usdc", label: "TSLAx / USDC", address: "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum" },
  { key: "nvdax-usdc", label: "NVDAx / USDC", address: "4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN" },
  { key: "spyx-usdc", label: "SPYx / USDC", address: "7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME" },
  { key: "qqqx-usdc", label: "QQQx / USDC", address: "FknDV1F5n6QaA7rLmjquDjuU6wcPMNm5RYq7zWbqhpZw" },
  { key: "gldx-usdc", label: "GLDx / USDC", address: "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze" },
  { key: "googlx-usdc", label: "GOOGLx / USDC", address: "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw" },
  { key: "hoodx-usdc", label: "HOODx / USDC", address: "3Z4H4H9bCcLyt1MmK44J5KZWkJ7taiU821QDTVZYaCpz" },
  { key: "crclx-usdc", label: "CRCLx / USDC", address: "G39wywquKbHK8F2wZZZFX3fcsyG91VCCbbr6WEVp5axy" },
  { key: "metax-usdc", label: "METAx / USDC", address: "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j" },
  { key: "coinx-usdc", label: "COINx / USDC", address: "5pobXosbeGSCRG3HdaRiw2TaihDDQMXkHFVbUTF24weM" },
  // Alt fee tier
  { key: "tslax-usdc-2", label: "TSLAx / USDC (2)", address: "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF" },
  { key: "nvdax-usdc-2", label: "NVDAx / USDC (2)", address: "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6" },
  { key: "spyx-usdc-2", label: "SPYx / USDC (2)", address: "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE" },
  { key: "qqqx-usdc-2", label: "QQQx / USDC (2)", address: "GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG" },
  { key: "hoodx-usdc-2", label: "HOODx / USDC (2)", address: "DXWbip5LducMAbDSSpLYz9Xik3253EPeAYQufQtx7LXs" },
  { key: "crclx-usdc-2", label: "CRCLx / USDC (2)", address: "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV" },
  { key: "coinx-usdc-2", label: "COINx / USDC (2)", address: "3LbRQkdRnahJfAEBBRajCMki8ZBMhBhidmxbgMzp8nVu" },
  // Byreal
  { key: "br-tslax", label: "TSLAx / USDC (br)", address: "6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs" },
  { key: "br-nvdax", label: "NVDAx / USDC (br)", address: "GjLusGo2z3mnXPmebhhNt9ocMDJgfdxrDFctVF8Ev3Kg" },
  { key: "br-spyx", label: "SPYx / USDC (br)", address: "27x6aSxcAm6SoazoxmmTtFg6fWMQuNmdKJmHagq1DUZy" },
  { key: "br-qqqx", label: "QQQx / USDC (br)", address: "FSLSua26xaXSLUG31SnyifgS6wgkRh5SirbCZW9zXNoG" },
  { key: "br-googlx", label: "GOOGLx / USDC (br)", address: "4k43WcUS8kPXkmL7PhgpwCteYYaSgzXvfKU63FEE1WS5" },
  { key: "br-crclx", label: "CRCLx / USDC (br)", address: "Hv44BZaqT5URrrAtGk6jvfbWKL2PytWA4ur2r1QnvtQa" },
  { key: "br-metax", label: "METAx / USDC (br)", address: "BqXGCG4vcD81GMiX2Rw9sKrSTqeAAZS6mGR5Ek69B7Lm" },
];

function formatUsd(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

async function main() {
  // 1. Fetch token prices from the app's own API
  console.log("Fetching token prices from app API...");
  const pricesRes = await fetch(`${BASE}/api/token-prices`);
  const pricesData = await pricesRes.json();
  const priceMap = pricesData.pricesUsdByAddress || {};

  // 2. Fetch each pool's data and calculate TVL
  console.log(`\nFetching data for ${POOLS.length} pools...\n`);

  let totalTvl = 0;
  let poolsWithData = 0;
  const results = [];

  for (const pool of POOLS) {
    try {
      const res = await fetch(`${BASE}/api/pool/${encodeURIComponent(pool.address)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        results.push({ label: pool.label, tvl: 0, error: `HTTP ${res.status}` });
        continue;
      }
      const data = await res.json();

      const bal0 = parseFloat(data.token0Balance) || 0;
      const bal1 = parseFloat(data.token1Balance) || 0;
      const t0addr = (data.token0Address || "").toLowerCase();
      const t1addr = (data.token1Address || "").toLowerCase();

      let price0 = priceMap[t0addr] ?? 0;
      let price1 = priceMap[t1addr] ?? 0;

      // For xStock tokens without a direct USD price, use pool price * token1 USD price
      if (price0 === 0 && price1 > 0 && data.currentPrice > 0) {
        price0 = data.currentPrice * price1;
      }
      if (price1 === 0 && price0 > 0 && data.currentPrice > 0) {
        price1 = price0 / data.currentPrice;
      }

      const tvl = bal0 * price0 + bal1 * price1;
      totalTvl += tvl;
      poolsWithData++;

      results.push({
        label: pool.label,
        tvl,
        t0sym: data.token0Symbol,
        t1sym: data.token1Symbol,
        bal0, bal1, price0, price1,
      });
    } catch (e) {
      results.push({ label: pool.label, tvl: 0, error: e.message });
    }
  }

  // 3. Print results
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.label.padEnd(25)} ERROR: ${r.error}`);
    } else {
      console.log(`  ${r.label.padEnd(25)} Pool Liquidity: ${formatUsd(r.tvl).padStart(12)}`);
    }
  }

  console.log("\n" + "=".repeat(55));
  console.log(`  Total Pools:         ${POOLS.length}`);
  console.log(`  Pools with data:     ${poolsWithData}`);
  console.log(`  TOTAL TVL:           ${formatUsd(totalTvl)}`);
  console.log("=".repeat(55));
}

main().catch(console.error);
