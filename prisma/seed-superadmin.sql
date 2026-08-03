-- Seed script: creates the initial SUPER_ADMIN user
-- Email:    work@kickoff.africa
-- Password: ChangeMe@2026!  (must be changed on first login)
--
-- Usage:
--   psql $DATABASE_URL -f prisma/seed-superadmin.sql
--
-- Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING.

INSERT INTO users (
  id,
  email,
  name,
  password_hash,
  role,
  is_active,
  must_change_password,
  failed_attempts,
  created_at,
  updated_at
)
VALUES (
  -- generate a fresh cuid via gen_random_uuid() cast as text for portability;
  -- replace with any valid unique string if your PG version lacks pgcrypto
  gen_random_uuid()::text,
  'work@kickoff.africa',
  'Super Admin',
  '$argon2id$v=19$m=19456,t=2,p=1$yNiMmZRWgOkTgMqodwcaXw$PPUDTskiko621FmhN9YpLzfloFmGQszmJnTqMyjzSLE',
  'SUPER_ADMIN',
  true,
  true,   -- forces password change on first login
  0,
  now(),
  now()
)
ON CONFLICT (email) DO NOTHING;
