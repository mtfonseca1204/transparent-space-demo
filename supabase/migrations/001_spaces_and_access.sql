-- =============================================
-- Migration: Spaces and Access Control
-- Creates the core tables for multi-space access
-- =============================================

-- 1. Create spaces table (each organization has one space)
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast slug lookups
CREATE INDEX IF NOT EXISTS idx_spaces_slug ON spaces(slug);

-- 2. Create admin_users table (global admins who can access all spaces)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- 3. Create space_members table (whitelisted users per space)
CREATE TABLE IF NOT EXISTS space_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email, space_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_space_members_email ON space_members(email);
CREATE INDEX IF NOT EXISTS idx_space_members_space_id ON space_members(space_id);

-- 4. Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_spaces_updated_at ON spaces;
CREATE TRIGGER update_spaces_updated_at
BEFORE UPDATE ON spaces
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Seed Data
-- =============================================

-- Insert the Worldchain space
INSERT INTO spaces (name, slug, description)
VALUES ('Worldchain', 'worldchain', 'Worldchain Uniswap pools and analytics')
ON CONFLICT (slug) DO NOTHING;

-- Insert initial admin users
INSERT INTO admin_users (email) VALUES ('pedro@transparent.space') ON CONFLICT (email) DO NOTHING;
INSERT INTO admin_users (email) VALUES ('f@transparent.space') ON CONFLICT (email) DO NOTHING;
INSERT INTO admin_users (email) VALUES ('dev@transparent.space') ON CONFLICT (email) DO NOTHING;
INSERT INTO admin_users (email) VALUES ('lyuben@launchub.com') ON CONFLICT (email) DO NOTHING;
