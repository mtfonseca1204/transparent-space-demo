-- =============================================
-- Migration: Perle Space
-- Adds a pool-only Perle space with no user credentials.
-- Global admins can enter the space until members are explicitly whitelisted.
-- =============================================

INSERT INTO spaces (name, slug, description, logo_url)
VALUES (
  'Perle',
  'perle',
  'Perle PRL/USDC pool analytics',
  '/icons/perle-logo.webp'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  logo_url = EXCLUDED.logo_url;
