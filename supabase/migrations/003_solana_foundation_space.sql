-- =============================================
-- Migration: Solana Foundation Space
-- Adds a Kraken-like Solana/xStocks space without user credentials.
-- =============================================

INSERT INTO spaces (name, slug, description)
VALUES (
  'Solana Foundation',
  'solana-foundation',
  'Solana Foundation xStocks pools and analytics'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;
