-- ============================================================
-- Migration 009: Fix user_roles UUID mismatch
--
-- The seed.sql inserted user_roles rows using hardcoded UUIDs
-- (11111111-0001-... and 22222222-0001-...). However, Supabase
-- Auth assigns its own UUIDs when users are created via the
-- Auth API. This means auth.uid() returns the real Auth UUID,
-- but user_roles.user_id has the seed UUID — they never match,
-- so get_user_role() returns NULL for every user.
--
-- This migration re-links user_roles to the actual auth UUIDs
-- by joining on email via the profiles table.
--
-- It also re-links the profiles rows themselves to use the
-- correct auth UUID as their primary key.
--
-- Run this ONCE after the seed is applied to a fresh DB where
-- Supabase Auth assigned different UUIDs than the seed constants.
-- ============================================================

-- Step 1: Delete all user_roles rows (we will re-insert them correctly below)
DELETE FROM user_roles;

-- Step 2: Delete all profiles rows that used the seed's hardcoded UUIDs
-- but keep any that were created by the auth trigger (which used the real UUID)
-- We identify seed-UUID profiles as those whose id does NOT exist in auth.users
DELETE FROM profiles
WHERE id NOT IN (SELECT id FROM auth.users);

-- Step 3: Ensure profiles exist for all auth users (backfill any missing ones)
INSERT INTO profiles (id, full_name, email, is_active)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  u.email,
  true
FROM auth.users u
WHERE u.email LIKE '%@greenline.test'
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  email     = EXCLUDED.email;

-- Step 4: Re-insert user_roles using the real auth UUIDs, matched by email
INSERT INTO user_roles (user_id, role_id)
SELECT
  p.id,
  r.id
FROM profiles p
JOIN roles r ON r.code = (
  CASE
    WHEN p.email LIKE 'treasury_maker%'      THEN 'TREASURY_OFFICER'
    WHEN p.email LIKE 'account_officer%'     THEN 'ACCOUNT_OFFICER'
    WHEN p.email LIKE 'head_treasury%'       THEN 'HEAD_TREASURY'
    WHEN p.email LIKE 'mis_officer%'         THEN 'MIS'
    WHEN p.email LIKE 'audit_officer%'       THEN 'AUDIT'
    WHEN p.email LIKE 'md_%'                 THEN 'MD'
    WHEN p.email LIKE 'operations_officer%'  THEN 'OPERATIONS'
    ELSE NULL
  END
)
WHERE p.email LIKE '%@greenline.test'
  AND r.code IS NOT NULL
ON CONFLICT (user_id, role_id) DO NOTHING;
