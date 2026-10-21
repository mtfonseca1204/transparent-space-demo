-- =============================================
-- Migration: User Credentials (Password Auth)
-- Adds password authentication for all users
-- =============================================

-- 1. Create user_credentials table
CREATE TABLE IF NOT EXISTS user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_user_credentials_email ON user_credentials(email);

-- Auto-update timestamp trigger
DROP TRIGGER IF EXISTS update_user_credentials_updated_at ON user_credentials;
CREATE TRIGGER update_user_credentials_updated_at
BEFORE UPDATE ON user_credentials
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Seed: Admin credentials (default password: changeme123)
-- All admins will be forced to change on first login
-- =============================================
INSERT INTO user_credentials (email, password_hash, must_change_password)
VALUES
  ('pedro@transparent.space', '$2b$10$QwbnT1XCU.WC3QwVhhlt1.hj3uDh5Z2Ifpkg/mnXsofeI8LOhlPOu', true),
  ('f@transparent.space', '$2b$10$QwbnT1XCU.WC3QwVhhlt1.hj3uDh5Z2Ifpkg/mnXsofeI8LOhlPOu', true),
  ('dev@transparent.space', '$2b$10$QwbnT1XCU.WC3QwVhhlt1.hj3uDh5Z2Ifpkg/mnXsofeI8LOhlPOu', true),
  ('lyuben@launchub.com', '$2b$10$QwbnT1XCU.WC3QwVhhlt1.hj3uDh5Z2Ifpkg/mnXsofeI8LOhlPOu', true)
ON CONFLICT (email) DO NOTHING;

-- =============================================
-- Seed: Existing space member credentials (same default password)
-- Picks up all space_members that don't already have credentials
-- =============================================
INSERT INTO user_credentials (email, password_hash, must_change_password)
SELECT DISTINCT sm.email,
  '$2b$10$QwbnT1XCU.WC3QwVhhlt1.hj3uDh5Z2Ifpkg/mnXsofeI8LOhlPOu',
  true
FROM space_members sm
WHERE NOT EXISTS (
  SELECT 1 FROM user_credentials uc WHERE uc.email = sm.email
);
