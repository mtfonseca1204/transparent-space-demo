-- =============================================
-- Migration: Gensyn Space
-- Adds a Kraken-like Gensyn space with no pool data and admin-only access.
-- No space_members rows are created: only global admins (admin_users)
-- can enter the space until members are explicitly whitelisted later.
-- =============================================

INSERT INTO spaces (name, slug, description)
VALUES (
  'Gensyn',
  'gensyn',
  'Gensyn pools and analytics'
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;
