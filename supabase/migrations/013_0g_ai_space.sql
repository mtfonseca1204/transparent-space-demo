-- =============================================
-- Migration: 0G AI Space
-- Adds the pool-only 0G AI workspace with admin-only access.
-- Global admins can enter the space until members are explicitly whitelisted.
-- =============================================

INSERT INTO spaces (name, slug, description, logo_url)
VALUES (
  '0G AI',
  '0g-ai',
  '0G pool analytics across 0G mainnet and BSC',
  'https://storage.googleapis.com/merkl-static-assets/tokens/w0G.svg'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  logo_url = EXCLUDED.logo_url;
