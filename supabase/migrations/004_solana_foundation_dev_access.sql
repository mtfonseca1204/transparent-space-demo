-- =============================================
-- Migration: Solana Foundation dev access
-- Adds explicit Solana Foundation membership without user credentials.
-- =============================================

INSERT INTO space_members (email, space_id)
SELECT 'dev@transparent.space', id
FROM spaces
WHERE slug = 'solana-foundation'
ON CONFLICT (email, space_id) DO NOTHING;
