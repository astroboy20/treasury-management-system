-- ============================================================
-- Migration 005: Seed Roles — Greenline Treasury Platform
-- ============================================================
-- Inserts all application roles. Safe to re-run (idempotent).
-- ============================================================

INSERT INTO roles (code, name) VALUES
  ('CUSTOMER',         'Customer'),
  ('ACCOUNT_OFFICER',  'Account Officer'),
  ('TREASURY_OFFICER', 'Treasury Officer'),
  ('HEAD_TREASURY',    'Head of Treasury'),
  ('MIS',              'MIS Officer'),
  ('AUDIT',            'Audit Officer'),
  ('MD',               'Managing Director'),
  ('OPERATIONS',       'Operations Officer'),
  ('ADMIN',            'System Administrator')
ON CONFLICT (code) DO NOTHING;
