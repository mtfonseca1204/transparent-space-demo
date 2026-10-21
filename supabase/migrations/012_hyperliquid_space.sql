-- =============================================
-- Migration: Hyperliquid Space
-- Adds the HIP-3 market-quality workspace with admin-only access.
-- Global admins can enter the space until members are explicitly whitelisted.
-- =============================================

INSERT INTO spaces (name, slug, description)
VALUES (
  'Hyperliquid',
  'hyperliquid',
  'Hyperliquid HIP-3 market quality analytics'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;
