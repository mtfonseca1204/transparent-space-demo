-- =============================================
-- Migration: Monad Space
-- Adds the pool-only Monad workspace with admin-only access.
-- Global admins can enter the space until members are explicitly whitelisted.
-- =============================================

INSERT INTO spaces (name, slug, description)
VALUES (
  'Monad',
  'monad',
  'Monad DUST/USDC Uniswap V2 pool analytics'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;
