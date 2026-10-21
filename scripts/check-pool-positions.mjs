#!/usr/bin/env node
/**
 * Diagnostic: check which Solana pools have working position data on Railway.
 */

const BASE = process.env.SOLANA_INDEXER_API_URL ?? "https://indexer-solana-production.up.railway.app";

const pools = [
  "HHQUnUbmWLrYzkscDY1C3deEFbGtiGBGoHjpANogmvum",
  "4KqQN6u1pFKroFE2jVEhoepAMRKPcuAzWVDCgm9zRBYN",
  "7sHMnvE7WqP7vQFWJGEnMT4vZg6Za9K7PpddDoXJCqME",
  "FknDV1F5n6QaA7rLmjquDjuU6wcPMNm5RYq7zWbqhpZw",
  "78ReVNMLGRWmjtf2HmBoHUe2pRcsctXTTbxJnbhchyze",
  "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw",
  "3Z4H4H9bCcLyt1MmK44J5KZWkJ7taiU821QDTVZYaCpz",
  "G39wywquKbHK8F2wZZZFX3fcsyG91VCCbbr6WEVp5axy",
  "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j",
  "5pobXosbeGSCRG3HdaRiw2TaihDDQMXkHFVbUTF24weM",
  "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF",
  "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
  "6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE",
  "GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG",
  "DXWbip5LducMAbDSSpLYz9Xik3253EPeAYQufQtx7LXs",
  "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV",
  "3LbRQkdRnahJfAEBBRajCMki8ZBMhBhidmxbgMzp8nVu",
  "6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs",
  "GjLusGo2z3mnXPmebhhNt9ocMDJgfdxrDFctVF8Ev3Kg",
  "27x6aSxcAm6SoazoxmmTtFg6fWMQuNmdKJmHagq1DUZy",
  "FSLSua26xaXSLUG31SnyifgS6wgkRh5SirbCZW9zXNoG",
  "4k43WcUS8kPXkmL7PhgpwCteYYaSgzXvfKU63FEE1WS5",
];

async function main() {
  console.log("Pool        | Total | Active | Status");
  console.log("------------|-------|--------|-------");

  let broken = 0;
  let ok = 0;

  for (const addr of pools) {
    try {
      const res = await fetch(`${BASE}/api/positions?pool=${addr}&limit=5000`, {
        signal: AbortSignal.timeout(20_000),
      });
      const d = await res.json();
      const rows = d.data ?? d;
      const total = Array.isArray(rows) ? rows.length : 0;
      const active = Array.isArray(rows)
        ? rows.filter((r) => r.liquidity !== "0" && r.liquidity !== 0).length
        : 0;
      const status = active > 0 ? "OK" : "BROKEN (all liq=0)";
      if (active > 0) ok++;
      else broken++;
      console.log(
        `${addr.slice(0, 11)}… | ${String(total).padStart(5)} | ${String(active).padStart(6)} | ${status}`
      );
    } catch (e) {
      broken++;
      console.log(`${addr.slice(0, 11)}… |     ? |      ? | ERR: ${e.message.slice(0, 40)}`);
    }
  }

  console.log(`\nSummary: ${ok} working, ${broken} broken out of ${pools.length} pools`);
}

main().catch(console.error);
