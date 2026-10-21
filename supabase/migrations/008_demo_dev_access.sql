-- =============================================
-- Migration: Demo account access
-- Adds explicit Demo memberships without storing credentials.
-- Additional Demo users should be added through Admin Panel/API.
-- =============================================

INSERT INTO space_members (email, space_id)
SELECT 'dev@transparent.space', id
FROM spaces
WHERE slug = 'demo'
ON CONFLICT (email, space_id) DO NOTHING;

INSERT INTO space_members (email, space_id)
SELECT 'demo@transparent.space', id
FROM spaces
WHERE slug = 'demo'
ON CONFLICT (email, space_id) DO NOTHING;
