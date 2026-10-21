-- =============================================
-- Migration: Katana user access
-- Adds the Katana workspace member and initial credentials.
-- Initial password follows existing seed convention: changeme123.
-- =============================================

INSERT INTO space_members (email, space_id)
SELECT 'katana@transparent.space', id
FROM spaces
WHERE slug = 'katana'
ON CONFLICT (email, space_id) DO NOTHING;

INSERT INTO user_credentials (email, password_hash, must_change_password)
VALUES (
  'katana@transparent.space',
  '$2b$10$QwbnT1XCU.WC3QwVhhlt1.hj3uDh5Z2Ifpkg/mnXsofeI8LOhlPOu',
  true
)
ON CONFLICT (email) DO NOTHING;
