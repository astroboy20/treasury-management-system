-- ============================================================
-- Greenline Treasury Platform — Seed Data
-- ============================================================
-- Idempotent: all inserts use ON CONFLICT DO NOTHING.
-- Apply to non-production environments only.
-- Run after all migrations (001–005) have been applied.
-- ============================================================

-- ============================================================
-- SECTION 1: Staff Users in auth.users
-- 7 scenario users + 7 e2e users = 14 total
--
-- Passwords are bcrypt hashes of "Password123!" (cost 10).
-- In production, use Supabase Auth APIs — never raw SQL inserts
-- against auth.users. This seed is for dev/staging only.
-- ============================================================

DO $$
DECLARE
  -- Shared bcrypt hash for "Password123!" — replace in real envs
  v_password_hash TEXT := '$2a$10$PtDKxFfvJUeYfbPDDHl7pOs2M9/Py.A9aYUTVJ9qT7Wf3/9Rq0G.e';
BEGIN

  -- ── Scenario user: Treasury Officer ─────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0001-0000-0000-000000000001',
    'treasury_maker_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Treasury Maker 01', 'requested_role', 'TREASURY_OFFICER'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Scenario user: Account Officer ──────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0002-0000-0000-000000000002',
    'account_officer_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Account Officer 01', 'requested_role', 'ACCOUNT_OFFICER'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Scenario user: Head Treasury ────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0003-0000-0000-000000000003',
    'head_treasury_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Head Treasury 01', 'requested_role', 'HEAD_TREASURY'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Scenario user: MIS Officer ──────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0004-0000-0000-000000000004',
    'mis_officer_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'MIS Officer 01', 'requested_role', 'MIS'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Scenario user: Audit Officer ────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0005-0000-0000-000000000005',
    'audit_officer_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Audit Officer 01', 'requested_role', 'AUDIT'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Scenario user: MD ───────────────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0006-0000-0000-000000000006',
    'md_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Managing Director 01', 'requested_role', 'MD'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Scenario user: Operations Officer ───────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '11111111-0007-0000-0000-000000000007',
    'operations_officer_01@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Operations Officer 01', 'requested_role', 'OPERATIONS'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: Treasury Officer ──────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0001-0000-0000-000000000001',
    'treasury_maker_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Treasury Maker E2E', 'requested_role', 'TREASURY_OFFICER'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: Account Officer ───────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0002-0000-0000-000000000002',
    'account_officer_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Account Officer E2E', 'requested_role', 'ACCOUNT_OFFICER'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: Head Treasury ─────────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0003-0000-0000-000000000003',
    'head_treasury_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Head Treasury E2E', 'requested_role', 'HEAD_TREASURY'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: MIS Officer ───────────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0004-0000-0000-000000000004',
    'mis_officer_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'MIS Officer E2E', 'requested_role', 'MIS'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: Audit Officer ─────────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0005-0000-0000-000000000005',
    'audit_officer_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Audit Officer E2E', 'requested_role', 'AUDIT'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: MD ────────────────────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0006-0000-0000-000000000006',
    'md_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Managing Director E2E', 'requested_role', 'MD'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── E2E user: Operations Officer ────────────────────────────
  INSERT INTO auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_user_meta_data, created_at, updated_at,
    aud, role
  )
  VALUES (
    '22222222-0007-0000-0000-000000000007',
    'operations_officer_e2e@greenline.test',
    v_password_hash,
    NOW(),
    jsonb_build_object('full_name', 'Operations Officer E2E', 'requested_role', 'OPERATIONS'),
    NOW(), NOW(), 'authenticated', 'authenticated'
  )
  ON CONFLICT (id) DO NOTHING;

END $$;

-- ============================================================
-- SECTION 2: profiles rows
-- The handle_new_user() trigger creates profiles automatically
-- on auth.users INSERT. These manual inserts handle the case
-- where the seed runs on a fresh DB where triggers may not have
-- fired (e.g. direct SQL seed without auth event emission).
-- ============================================================

INSERT INTO profiles (id, full_name, email, is_active)
VALUES
  -- Scenario users
  ('11111111-0001-0000-0000-000000000001', 'Treasury Maker 01',    'treasury_maker_01@greenline.test',       true),
  ('11111111-0002-0000-0000-000000000002', 'Account Officer 01',   'account_officer_01@greenline.test',      true),
  ('11111111-0003-0000-0000-000000000003', 'Head Treasury 01',     'head_treasury_01@greenline.test',        true),
  ('11111111-0004-0000-0000-000000000004', 'MIS Officer 01',       'mis_officer_01@greenline.test',          true),
  ('11111111-0005-0000-0000-000000000005', 'Audit Officer 01',     'audit_officer_01@greenline.test',        true),
  ('11111111-0006-0000-0000-000000000006', 'Managing Director 01', 'md_01@greenline.test',                   true),
  ('11111111-0007-0000-0000-000000000007', 'Operations Officer 01','operations_officer_01@greenline.test',   true),
  -- E2E users
  ('22222222-0001-0000-0000-000000000001', 'Treasury Maker E2E',    'treasury_maker_e2e@greenline.test',     true),
  ('22222222-0002-0000-0000-000000000002', 'Account Officer E2E',   'account_officer_e2e@greenline.test',    true),
  ('22222222-0003-0000-0000-000000000003', 'Head Treasury E2E',     'head_treasury_e2e@greenline.test',      true),
  ('22222222-0004-0000-0000-000000000004', 'MIS Officer E2E',       'mis_officer_e2e@greenline.test',        true),
  ('22222222-0005-0000-0000-000000000005', 'Audit Officer E2E',     'audit_officer_e2e@greenline.test',      true),
  ('22222222-0006-0000-0000-000000000006', 'Managing Director E2E', 'md_e2e@greenline.test',                 true),
  ('22222222-0007-0000-0000-000000000007', 'Operations Officer E2E','operations_officer_e2e@greenline.test', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SECTION 3: Role Assignments in user_roles
-- Maps each of the 14 users to their assigned role.
-- Assigned by the Treasury Maker 01 user (first user created).
-- ============================================================

INSERT INTO user_roles (user_id, role_id, assigned_by)
SELECT
  p.id AS user_id,
  r.id AS role_id,
  '11111111-0001-0000-0000-000000000001'::UUID AS assigned_by
FROM (VALUES
  -- Scenario users
  ('11111111-0001-0000-0000-000000000001', 'TREASURY_OFFICER'),
  ('11111111-0002-0000-0000-000000000002', 'ACCOUNT_OFFICER'),
  ('11111111-0003-0000-0000-000000000003', 'HEAD_TREASURY'),
  ('11111111-0004-0000-0000-000000000004', 'MIS'),
  ('11111111-0005-0000-0000-000000000005', 'AUDIT'),
  ('11111111-0006-0000-0000-000000000006', 'MD'),
  ('11111111-0007-0000-0000-000000000007', 'OPERATIONS'),
  -- E2E users
  ('22222222-0001-0000-0000-000000000001', 'TREASURY_OFFICER'),
  ('22222222-0002-0000-0000-000000000002', 'ACCOUNT_OFFICER'),
  ('22222222-0003-0000-0000-000000000003', 'HEAD_TREASURY'),
  ('22222222-0004-0000-0000-000000000004', 'MIS'),
  ('22222222-0005-0000-0000-000000000005', 'AUDIT'),
  ('22222222-0006-0000-0000-000000000006', 'MD'),
  ('22222222-0007-0000-0000-000000000007', 'OPERATIONS')
) AS mapping(user_id, role_code)
JOIN roles r ON r.code = mapping.role_code
JOIN profiles p ON p.id = mapping.user_id::UUID
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ============================================================
-- SECTION 4: Test Customers A–R
-- One customer per transaction scenario (Req 39.3).
-- UUIDs use prefix: aaaaaaaa-00NN-... for traceability.
-- ============================================================

INSERT INTO customers (id, customer_number, name, registered_phone, status)
VALUES
  -- Customer A — Full Rollover (P+I)
  ('aaaaaaaa-0001-0000-0000-000000000001', 'CUST-A-001', 'Adaeze Nwosu',       '+2348011111001', 'ACTIVE'),
  -- Customer B — Principal Rollover + Interest Payout
  ('aaaaaaaa-0002-0000-0000-000000000002', 'CUST-B-001', 'Babatunde Okafor',   '+2348011111002', 'ACTIVE'),
  -- Customer C — Partial Rollover
  ('aaaaaaaa-0003-0000-0000-000000000003', 'CUST-C-001', 'Chidi Eze',          '+2348011111003', 'ACTIVE'),
  -- Customer D — Interest Only Rollover
  ('aaaaaaaa-0004-0000-0000-000000000004', 'CUST-D-001', 'Damilola Adeyemi',   '+2348011111004', 'ACTIVE'),
  -- Customer E — Maturity Termination
  ('aaaaaaaa-0005-0000-0000-000000000005', 'CUST-E-001', 'Emeka Okonkwo',      '+2348011111005', 'ACTIVE'),
  -- Customer F — Full Pre-liquidation
  ('aaaaaaaa-0006-0000-0000-000000000006', 'CUST-F-001', 'Fatima Bello',       '+2348011111006', 'ACTIVE'),
  -- Customer G — Partial Pre-liquidation
  ('aaaaaaaa-0007-0000-0000-000000000007', 'CUST-G-001', 'Grace Uchenna',      '+2348011111007', 'ACTIVE'),
  -- Customer H — Anniversary 30 Days
  ('aaaaaaaa-0008-0000-0000-000000000008', 'CUST-H-001', 'Hassan Ibrahim',     '+2348011111008', 'ACTIVE'),
  -- Customer I — Anniversary 60 Days
  ('aaaaaaaa-0009-0000-0000-000000000009', 'CUST-I-001', 'Ifeoma Obi',         '+2348011111009', 'ACTIVE'),
  -- Customer J — Anniversary 90 Days
  ('aaaaaaaa-000a-0000-0000-00000000000a', 'CUST-J-001', 'Joseph Akinwale',    '+2348011111010', 'ACTIVE'),
  -- Customer K — External Third Party Payment
  ('aaaaaaaa-000b-0000-0000-00000000000b', 'CUST-K-001', 'Kelechi Nwachukwu', '+2348011111011', 'ACTIVE'),
  -- Customer L — Internal Third Party Payment
  ('aaaaaaaa-000c-0000-0000-00000000000c', 'CUST-L-001', 'Lola Fashola',       '+2348011111012', 'ACTIVE'),
  -- Customer M — Savings → Personal Transfer
  ('aaaaaaaa-000d-0000-0000-00000000000d', 'CUST-M-001', 'Michael Adesanya',   '+2348011111013', 'ACTIVE'),
  -- Customer N — Personal → Commercial Paper
  ('aaaaaaaa-000e-0000-0000-00000000000e', 'CUST-N-001', 'Ngozi Okoro',        '+2348011111014', 'ACTIVE'),
  -- Customer O — Personal → Call Placement
  ('aaaaaaaa-000f-0000-0000-00000000000f', 'CUST-O-001', 'Olumide Adebayo',    '+2348011111015', 'ACTIVE'),
  -- Customer P — Reversal (incorrect rate for reversal test)
  ('aaaaaaaa-0010-0000-0000-000000000010', 'CUST-P-001', 'Patience Osei',      '+2348011111016', 'ACTIVE'),
  -- Customer Q — Inflow (new placement)
  ('aaaaaaaa-0011-0000-0000-000000000011', 'CUST-Q-001', 'Qudus Lawal',        '+2348011111017', 'ACTIVE'),
  -- Customer R — Savings/Call/CMS Funds-Out
  ('aaaaaaaa-0012-0000-0000-000000000012', 'CUST-R-001', 'Rachael Oduya',      '+2348011111018', 'ACTIVE')
ON CONFLICT (customer_number) DO NOTHING;

-- ============================================================
-- SECTION 5: Customer Accounts
-- UUID scheme for accounts: ac000NNN-00SS-0000-0000-00000000NNN0
--   NNN = customer sequence (001–012 hex)
--   SS  = account sequence within customer (01, 02, 03…)
-- ============================================================

INSERT INTO customer_accounts (id, customer_id, account_number, account_type, status, available_balance)
VALUES
  -- Customer A — Fixed Deposit account
  ('ac000001-0001-0000-0000-000000000010', 'aaaaaaaa-0001-0000-0000-000000000001', 'ACC-A-FD-001',  'PERSONAL',         'ACTIVE', 12450000.0000),
  -- Customer B — Fixed Deposit account
  ('ac000002-0001-0000-0000-000000000020', 'aaaaaaaa-0002-0000-0000-000000000002', 'ACC-B-FD-001',  'PERSONAL',         'ACTIVE',  8000000.0000),
  -- Customer C — Fixed Deposit account
  ('ac000003-0001-0000-0000-000000000030', 'aaaaaaaa-0003-0000-0000-000000000003', 'ACC-C-FD-001',  'PERSONAL',         'ACTIVE', 10000000.0000),
  -- Customer D — Fixed Deposit account
  ('ac000004-0001-0000-0000-000000000040', 'aaaaaaaa-0004-0000-0000-000000000004', 'ACC-D-FD-001',  'PERSONAL',         'ACTIVE',  5000000.0000),
  -- Customer E — Fixed Deposit account
  ('ac000005-0001-0000-0000-000000000050', 'aaaaaaaa-0005-0000-0000-000000000005', 'ACC-E-FD-001',  'PERSONAL',         'ACTIVE', 25000000.0000),
  -- Customer F — Fixed Deposit account
  ('ac000006-0001-0000-0000-000000000060', 'aaaaaaaa-0006-0000-0000-000000000006', 'ACC-F-FD-001',  'PERSONAL',         'ACTIVE', 15000000.0000),
  -- Customer G — Fixed Deposit account
  ('ac000007-0001-0000-0000-000000000070', 'aaaaaaaa-0007-0000-0000-000000000007', 'ACC-G-FD-001',  'PERSONAL',         'ACTIVE', 10000000.0000),
  -- Customer H — Fixed Deposit account
  ('ac000008-0001-0000-0000-000000000080', 'aaaaaaaa-0008-0000-0000-000000000008', 'ACC-H-FD-001',  'PERSONAL',         'ACTIVE',  6000000.0000),
  -- Customer I — Fixed Deposit account
  ('ac000009-0001-0000-0000-000000000090', 'aaaaaaaa-0009-0000-0000-000000000009', 'ACC-I-FD-001',  'PERSONAL',         'ACTIVE',  6000000.0000),
  -- Customer J — Fixed Deposit account
  ('ac00000a-0001-0000-0000-0000000000a0', 'aaaaaaaa-000a-0000-0000-00000000000a', 'ACC-J-FD-001',  'PERSONAL',         'ACTIVE',  6000000.0000),
  -- Customer K — Personal account (source for third-party external)
  ('ac00000b-0001-0000-0000-0000000000b0', 'aaaaaaaa-000b-0000-0000-00000000000b', 'ACC-K-PS-001',  'PERSONAL',         'ACTIVE', 10000000.0000),
  -- Customer L — Personal account (source for third-party internal)
  ('ac00000c-0001-0000-0000-0000000000c0', 'aaaaaaaa-000c-0000-0000-00000000000c', 'ACC-L-PS-001',  'PERSONAL',         'ACTIVE', 10000000.0000),
  -- Customer M — Savings account (source) + Personal (destination)
  ('ac00000d-0001-0000-0000-0000000000d0', 'aaaaaaaa-000d-0000-0000-00000000000d', 'ACC-M-SV-001',  'SAVINGS',          'ACTIVE',  5000000.0000),
  ('ac00000d-0002-0000-0000-0000000000d0', 'aaaaaaaa-000d-0000-0000-00000000000d', 'ACC-M-PS-001',  'PERSONAL',         'ACTIVE',       0.0000),
  -- Customer N — Personal account (source) + Commercial Paper (destination)
  ('ac00000e-0001-0000-0000-0000000000e0', 'aaaaaaaa-000e-0000-0000-00000000000e', 'ACC-N-PS-001',  'PERSONAL',         'ACTIVE',  8000000.0000),
  ('ac00000e-0002-0000-0000-0000000000e0', 'aaaaaaaa-000e-0000-0000-00000000000e', 'ACC-N-CP-001',  'COMMERCIAL_PAPER', 'ACTIVE',       0.0000),
  -- Customer O — Personal account (source) + Call (destination)
  ('ac00000f-0001-0000-0000-0000000000f0', 'aaaaaaaa-000f-0000-0000-00000000000f', 'ACC-O-PS-001',  'PERSONAL',         'ACTIVE',  3000000.0000),
  ('ac00000f-0002-0000-0000-0000000000f0', 'aaaaaaaa-000f-0000-0000-00000000000f', 'ACC-O-CL-001',  'CALL',             'ACTIVE',       0.0000),
  -- Customer P — Fixed Deposit account (reversal test — incorrect rate 13.5%)
  ('ac000010-0001-0000-0000-000000000100', 'aaaaaaaa-0010-0000-0000-000000000010', 'ACC-P-FD-001',  'PERSONAL',         'ACTIVE',  7000000.0000),
  -- Customer Q — Personal account (new inflow placement)
  ('ac000011-0001-0000-0000-000000000110', 'aaaaaaaa-0011-0000-0000-000000000011', 'ACC-Q-PS-001',  'PERSONAL',         'ACTIVE',  2000000.0000),
  -- Customer R — Savings account (Savings/Call/CMS Funds-Out)
  ('ac000012-0001-0000-0000-000000000120', 'aaaaaaaa-0012-0000-0000-000000000012', 'ACC-R-SV-001',  'SAVINGS',          'ACTIVE',  4500000.0000),
  ('ac000012-0002-0000-0000-000000000120', 'aaaaaaaa-0012-0000-0000-000000000012', 'ACC-R-CL-001',  'CALL',             'ACTIVE',  3200000.0000),
  ('ac000012-0003-0000-0000-000000000120', 'aaaaaaaa-0012-0000-0000-000000000012', 'ACC-R-CM-001',  'CMS',              'ACTIVE',  1800000.0000)
ON CONFLICT (account_number) DO NOTHING;

-- ============================================================
-- SECTION 6: Investments (one per scenario customer)
-- Values match the design seed table exactly.
-- UUID scheme: bb0000NN-00SS-0000-0000-00000000NNN0
--   NN = customer sequence, SS = investment sequence
-- Customers A–D: ROLLOVER scenarios
-- Customers E–G: LIQUIDATION/TERMINATION scenarios
-- Customers H–J: ANNIVERSARY scenarios
-- Customers K–L: THIRD_PARTY_PAYMENT scenarios (no investment)
-- Customers M–O: INTERNAL_TRANSFER scenarios (no investment)
-- Customer  P:   REVERSAL scenario
-- Customer  Q:   INFLOW scenario (no existing investment)
-- Customer  R:   SAVINGS_FUNDS_OUT etc. (balance-based)
-- ============================================================

INSERT INTO investments (
  id, customer_id, account_id, external_reference,
  product_type, principal, interest_rate, accrued_interest,
  effective_date, maturity_date, outstanding_balance, available_amount, status
)
VALUES

  -- ── Customer A: Full Rollover (P+I) ─────────────────────────────────────
  -- Principal ₦12,450,000 | Accrued ₦245,000 | Rate 12.5%
  (
    'bb000001-0001-0000-0000-000000000010',
    'aaaaaaaa-0001-0000-0000-000000000001',
    'ac000001-0001-0000-0000-000000000010',
    'EZBK-A-001',
    'FIXED_DEPOSIT',
    12450000.0000, 0.125000, 245000.0000,
    '2026-03-03', '2026-09-03',
    12450000.0000, 12695000.0000,
    'ACTIVE'
  ),

  -- ── Customer B: Principal Rollover + Interest Payout ────────────────────
  -- Principal ₦8,000,000 | Accrued ₦160,000 | Rate 12.0%
  (
    'bb000002-0001-0000-0000-000000000020',
    'aaaaaaaa-0002-0000-0000-000000000002',
    'ac000002-0001-0000-0000-000000000020',
    'EZBK-B-001',
    'FIXED_DEPOSIT',
    8000000.0000, 0.120000, 160000.0000,
    '2026-03-05', '2026-09-05',
    8000000.0000, 8160000.0000,
    'ACTIVE'
  ),

  -- ── Customer C: Partial Rollover ─────────────────────────────────────────
  -- Principal ₦10,000,000 | Accrued ₦0 (no accrued, partial roll) | Rate 12.5%
  (
    'bb000003-0001-0000-0000-000000000030',
    'aaaaaaaa-0003-0000-0000-000000000003',
    'ac000003-0001-0000-0000-000000000030',
    'EZBK-C-001',
    'FIXED_DEPOSIT',
    10000000.0000, 0.125000, 0.0000,
    '2026-03-10', '2026-09-10',
    10000000.0000, 10000000.0000,
    'ACTIVE'
  ),

  -- ── Customer D: Interest Only Rollover ──────────────────────────────────
  -- Principal ₦5,000,000 | Accrued ₦100,000 | Rate 12.0%
  (
    'bb000004-0001-0000-0000-000000000040',
    'aaaaaaaa-0004-0000-0000-000000000004',
    'ac000004-0001-0000-0000-000000000040',
    'EZBK-D-001',
    'FIXED_DEPOSIT',
    5000000.0000, 0.120000, 100000.0000,
    '2026-03-15', '2026-09-15',
    5000000.0000, 5100000.0000,
    'ACTIVE'
  ),

  -- ── Customer E: Maturity Termination ────────────────────────────────────
  -- Principal ₦25,000,000 | Accrued ₦1,250,000 | Rate 12.5%
  (
    'bb000005-0001-0000-0000-000000000050',
    'aaaaaaaa-0005-0000-0000-000000000005',
    'ac000005-0001-0000-0000-000000000050',
    'EZBK-E-001',
    'FIXED_DEPOSIT',
    25000000.0000, 0.125000, 1250000.0000,
    '2026-03-03', '2026-09-03',
    25000000.0000, 26250000.0000,
    'ACTIVE'
  ),

  -- ── Customer F: Full Pre-liquidation ────────────────────────────────────
  -- Principal ₦15,000,000 | Accrued ₦1,500,000 | Rate 12.5%
  -- SOP canonical example: charge = ₦300,000 (20% of ₦1,500,000)
  (
    'bb000006-0001-0000-0000-000000000060',
    'aaaaaaaa-0006-0000-0000-000000000006',
    'ac000006-0001-0000-0000-000000000060',
    'EZBK-F-001',
    'FIXED_DEPOSIT',
    15000000.0000, 0.125000, 1500000.0000,
    '2026-06-03', '2026-12-03',
    15000000.0000, 16200000.0000,
    'ACTIVE'
  ),

  -- ── Customer G: Partial Pre-liquidation ─────────────────────────────────
  -- Principal ₦10,000,000 | Accrued ₦1,500,000 | Rate 12.5%
  (
    'bb000007-0001-0000-0000-000000000070',
    'aaaaaaaa-0007-0000-0000-000000000007',
    'ac000007-0001-0000-0000-000000000070',
    'EZBK-G-001',
    'FIXED_DEPOSIT',
    10000000.0000, 0.125000, 1500000.0000,
    '2026-06-03', '2026-12-03',
    10000000.0000, 11200000.0000,
    'ACTIVE'
  ),

  -- ── Customer H: Anniversary 30 Days ─────────────────────────────────────
  -- Principal ₦6,000,000 | Accrued ₦60,000 | Rate 12.0%
  (
    'bb000008-0001-0000-0000-000000000080',
    'aaaaaaaa-0008-0000-0000-000000000008',
    'ac000008-0001-0000-0000-000000000080',
    'EZBK-H-001',
    'FIXED_DEPOSIT',
    6000000.0000, 0.120000, 60000.0000,
    '2026-08-04', '2027-02-04',
    6000000.0000, 6060000.0000,
    'ACTIVE'
  ),

  -- ── Customer I: Anniversary 60 Days ─────────────────────────────────────
  -- Principal ₦6,000,000 | Accrued ₦120,000 | Rate 12.0%
  (
    'bb000009-0001-0000-0000-000000000090',
    'aaaaaaaa-0009-0000-0000-000000000009',
    'ac000009-0001-0000-0000-000000000090',
    'EZBK-I-001',
    'FIXED_DEPOSIT',
    6000000.0000, 0.120000, 120000.0000,
    '2026-07-05', '2027-01-05',
    6000000.0000, 6120000.0000,
    'ACTIVE'
  ),

  -- ── Customer J: Anniversary 90 Days ─────────────────────────────────────
  -- Principal ₦6,000,000 | Accrued ₦180,000 | Rate 12.0%
  (
    'bb00000a-0001-0000-0000-0000000000a0',
    'aaaaaaaa-000a-0000-0000-00000000000a',
    'ac00000a-0001-0000-0000-0000000000a0',
    'EZBK-J-001',
    'FIXED_DEPOSIT',
    6000000.0000, 0.120000, 180000.0000,
    '2026-06-06', '2026-12-06',
    6000000.0000, 6180000.0000,
    'ACTIVE'
  ),

  -- ── Customer P: Reversal (incorrect rate — 13.5% — to be reversed) ──────
  -- Principal ₦7,000,000 | Accrued ₦140,000 | Rate 13.5% (incorrect)
  (
    'bb000010-0001-0000-0000-000000000100',
    'aaaaaaaa-0010-0000-0000-000000000010',
    'ac000010-0001-0000-0000-000000000100',
    'EZBK-P-001',
    'FIXED_DEPOSIT',
    7000000.0000, 0.135000, 140000.0000,
    '2026-08-01', '2027-02-01',
    7000000.0000, 7140000.0000,
    'ACTIVE'
  ),

  -- ── Customer R: Savings balance-based funds-out ──────────────────────────
  -- Savings account — balance ₦4,500,000 (sourced from Eazybankz)
  (
    'bb000012-0001-0000-0000-000000000120',
    'aaaaaaaa-0012-0000-0000-000000000012',
    'ac000012-0001-0000-0000-000000000120',
    'EZBK-R-SV-001',
    'CMS',
    0.0000, 0.000000, 0.0000,
    '2026-01-01', NULL,
    4500000.0000, 4500000.0000,
    'ACTIVE'
  )

ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SECTION 7: Negative Test Customers (CUSTOMER_NEG_001–005)
-- Req 34.3, 39.5 — each represents a failure scenario
-- UUID scheme: cc0000NN-0000-0000-0000-00000000NNN0
-- ============================================================

INSERT INTO customers (id, customer_number, name, registered_phone, status)
VALUES
  -- NEG-001: Signature mismatch (signature check will fail)
  ('cc000001-0000-0000-0000-000000000010', 'CUSTOMER_NEG_001', 'Negative Test — Signature Mismatch',     '+2348099990001', 'ACTIVE'),
  -- NEG-002: Insufficient available balance
  ('cc000002-0000-0000-0000-000000000020', 'CUSTOMER_NEG_002', 'Negative Test — Insufficient Balance',   '+2348099990002', 'ACTIVE'),
  -- NEG-003: Incomplete instruction (missing fields)
  ('cc000003-0000-0000-0000-000000000030', 'CUSTOMER_NEG_003', 'Negative Test — Incomplete Instruction', '+2348099990003', 'ACTIVE'),
  -- NEG-004: Customer confirmation failed / unreachable
  ('cc000004-0000-0000-0000-000000000040', 'CUSTOMER_NEG_004', 'Negative Test — Confirmation Failed',    '+2348099990004', 'ACTIVE'),
  -- NEG-005: Missing beneficiary data (external payment with no beneficiary)
  ('cc000005-0000-0000-0000-000000000050', 'CUSTOMER_NEG_005', 'Negative Test — Missing Beneficiary',    '+2348099990005', 'ACTIVE')
ON CONFLICT (customer_number) DO NOTHING;

-- Accounts for negative test customers
-- UUID scheme: dd0000NN-00SS-0000-0000-00000000NNN0
INSERT INTO customer_accounts (id, customer_id, account_number, account_type, status, available_balance)
VALUES
  ('dd000001-0001-0000-0000-000000000010', 'cc000001-0000-0000-0000-000000000010', 'NEG-001-FD', 'PERSONAL', 'ACTIVE', 5000000.0000),
  -- NEG-002 has an investment but available_balance = 0 to simulate insufficient balance
  ('dd000002-0001-0000-0000-000000000020', 'cc000002-0000-0000-0000-000000000020', 'NEG-002-FD', 'PERSONAL', 'ACTIVE',       0.0000),
  ('dd000003-0001-0000-0000-000000000030', 'cc000003-0000-0000-0000-000000000030', 'NEG-003-FD', 'PERSONAL', 'ACTIVE', 3000000.0000),
  ('dd000004-0001-0000-0000-000000000040', 'cc000004-0000-0000-0000-000000000040', 'NEG-004-FD', 'PERSONAL', 'ACTIVE', 4000000.0000),
  ('dd000005-0001-0000-0000-000000000050', 'cc000005-0000-0000-0000-000000000050', 'NEG-005-FD', 'PERSONAL', 'ACTIVE', 8000000.0000)
ON CONFLICT (account_number) DO NOTHING;

-- Investments for negative test customers
-- UUID scheme: ee0000NN-0000-0000-0000-00000000NNN0
INSERT INTO investments (
  id, customer_id, account_id, external_reference,
  product_type, principal, interest_rate, accrued_interest,
  effective_date, maturity_date, outstanding_balance, available_amount, status
)
VALUES
  -- NEG-001: Normal investment; signature will be failed manually in test
  (
    'ee000001-0000-0000-0000-000000000010',
    'cc000001-0000-0000-0000-000000000010',
    'dd000001-0001-0000-0000-000000000010',
    'EZBK-NEG-001',
    'FIXED_DEPOSIT',
    5000000.0000, 0.120000, 100000.0000,
    '2026-06-01', '2026-12-01',
    5000000.0000, 5100000.0000,
    'ACTIVE'
  ),
  -- NEG-002: Investment exists but available_amount = 0 (insufficient balance)
  (
    'ee000002-0000-0000-0000-000000000020',
    'cc000002-0000-0000-0000-000000000020',
    'dd000002-0001-0000-0000-000000000020',
    'EZBK-NEG-002',
    'FIXED_DEPOSIT',
    5000000.0000, 0.120000, 200000.0000,
    '2026-06-01', '2026-12-01',
    5000000.0000, 0.0000,           -- available_amount = 0 (insufficient)
    'ACTIVE'
  ),
  -- NEG-003: Normal investment; instruction will be incomplete in test
  (
    'ee000003-0000-0000-0000-000000000030',
    'cc000003-0000-0000-0000-000000000030',
    'dd000003-0001-0000-0000-000000000030',
    'EZBK-NEG-003',
    'FIXED_DEPOSIT',
    3000000.0000, 0.115000, 75000.0000,
    '2026-06-15', '2026-12-15',
    3000000.0000, 3075000.0000,
    'ACTIVE'
  ),
  -- NEG-004: Normal investment; customer confirmation will return UNREACHABLE
  (
    'ee000004-0000-0000-0000-000000000040',
    'cc000004-0000-0000-0000-000000000040',
    'dd000004-0001-0000-0000-000000000040',
    'EZBK-NEG-004',
    'FIXED_DEPOSIT',
    4000000.0000, 0.120000, 90000.0000,
    '2026-07-01', '2027-01-01',
    4000000.0000, 4090000.0000,
    'ACTIVE'
  ),
  -- NEG-005: External payment scenario; beneficiary data will be missing
  (
    'ee000005-0000-0000-0000-000000000050',
    'cc000005-0000-0000-0000-000000000050',
    'dd000005-0001-0000-0000-000000000050',
    'EZBK-NEG-005',
    'FIXED_DEPOSIT',
    8000000.0000, 0.130000, 250000.0000,
    '2026-05-01', '2026-11-01',
    8000000.0000, 8250000.0000,
    'ACTIVE'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SECTION 8: reset_e2e_transactions() — utility function
-- Deletes all transactions created by _e2e users.
-- Cascades to all child tables via FK ON DELETE CASCADE.
-- Safe to run between test runs; does not touch scenario data.
-- ============================================================

CREATE OR REPLACE FUNCTION reset_e2e_transactions()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete all transactions created by any _e2e profile.
  -- Child rows (signature_verifications, customer_confirmations,
  -- investment_verifications, vouchers, rollover_details,
  -- pre_liquidation_details, approvals, operations_executions,
  -- transaction_documents, payment_instructions, notifications,
  -- audit_events) are removed via ON DELETE CASCADE.
  DELETE FROM treasury_transactions
  WHERE created_by IN (
    SELECT id
    FROM profiles
    WHERE email LIKE '%_e2e@greenline.test'
  );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE 'reset_e2e_transactions: % transaction(s) deleted.', v_deleted_count;
END;
$$;

-- ============================================================
-- SEED COMPLETE
-- Summary:
--   Staff users        : 14 (7 scenario + 7 e2e)
--   Role assignments   : 14
--   Test customers     : 18 (A–R) + 5 negative = 23 total
--   Investments seeded : 12 scenario (A–J, P, R) + 5 negative
--   Utility functions  : reset_e2e_transactions()
-- ============================================================
