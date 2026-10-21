-- =============================================
-- Migration: Katana Space
-- Adds the pool-only Katana workspace with admin-only access.
-- Global admins can enter the space until members are explicitly whitelisted.
-- =============================================

INSERT INTO spaces (name, slug, description)
VALUES (
  'Katana',
  'katana',
  'Katana Sushi V3 vbUSDC/vbETH pool analytics'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;
