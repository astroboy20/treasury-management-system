-- ============================================================
-- Migration 001: Full Schema — Greenline Treasury Platform
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE 1: profiles
-- Mirrors auth.users. Created via trigger on user sign-up.
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 2: roles
-- Static lookup. Seeded in migration 005.
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

-- ============================================================
-- TABLE 3: user_roles
-- Many-to-many: a user may hold multiple roles.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES profiles(id),
  PRIMARY KEY (user_id, role_id)
);

-- ============================================================
-- TABLE 4: customers
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_number  TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  registered_phone TEXT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 5: customer_accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  account_number    TEXT NOT NULL UNIQUE,
  account_type      TEXT NOT NULL
                      CHECK (account_type IN ('SAVINGS','PERSONAL','COMMERCIAL_PAPER','CALL','CMS')),
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','INACTIVE','CLOSED')),
  available_balance NUMERIC(20,4) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 6: investments
-- ============================================================
CREATE TABLE IF NOT EXISTS investments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES customers(id),
  account_id          UUID REFERENCES customer_accounts(id),
  external_reference  TEXT,   -- Eazybankz investment ID
  product_type        TEXT NOT NULL
                        CHECK (product_type IN ('FIXED_DEPOSIT','CALL','COMMERCIAL_PAPER','CMS')),
  principal           NUMERIC(20,4) NOT NULL,
  interest_rate       NUMERIC(10,6) NOT NULL,
  accrued_interest    NUMERIC(20,4) NOT NULL DEFAULT 0,
  effective_date      DATE NOT NULL,
  maturity_date       DATE,
  outstanding_balance NUMERIC(20,4) NOT NULL,
  available_amount    NUMERIC(20,4) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','TERMINATED','ROLLED_OVER','MATURED')),
  source_system       TEXT NOT NULL DEFAULT 'EAZYBANKZ',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investments_customer_status ON investments(customer_id, status);

-- ============================================================
-- TABLE 7: treasury_transactions
-- Central workflow table. Status column drives the state machine.
-- ============================================================
CREATE TABLE IF NOT EXISTS treasury_transactions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_reference   TEXT NOT NULL UNIQUE,
  customer_id             UUID NOT NULL REFERENCES customers(id),
  investment_id           UUID REFERENCES investments(id),
  transaction_type        TEXT NOT NULL
                            CHECK (transaction_type IN (
                              'ROLLOVER','MATURITY_TERMINATION','PRE_LIQUIDATION',
                              'ANNIVERSARY_PAYMENT','THIRD_PARTY_PAYMENT','INTERNAL_TRANSFER',
                              'INFLOW','SAVINGS_FUNDS_OUT','CALL_FUNDS_OUT','CMS_FUNDS_OUT','REVERSAL'
                            )),
  scenario_code           TEXT,  -- P_AND_I, PRINCIPAL_ONLY, PARTIAL_PRINCIPAL, INTEREST_ONLY, etc.
  status                  TEXT NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN (
                              'DRAFT','INSTRUCTION_RECEIVED','SIGNATURE_VERIFIED',
                              'CUSTOMER_CONFIRMED','INVESTMENT_VERIFIED','VOUCHER_PREPARED',
                              'TREASURY_APPROVED','HEAD_TREASURY_APPROVED','MIS_APPROVED',
                              'AUDIT_APPROVED','MD_APPROVED','OPERATIONS_PROCESSING',
                              'OPERATIONS_COMPLETED','TREASURY_CONFIRMED','COMPLETED',
                              'RETURNED','REJECTED','CANCELLED','FAILED'
                            )),
  currency                TEXT NOT NULL DEFAULT 'NGN',
  requested_amount        NUMERIC(20,4) NOT NULL,
  approved_amount         NUMERIC(20,4),  -- set at MD approval
  purpose                 TEXT NOT NULL,
  source_instruction_type TEXT NOT NULL
                            CHECK (source_instruction_type IN ('LETTER','EMAIL','SIGNED_FORM','MANDATED')),
  sla_due_at              TIMESTAMPTZ,   -- computed server-side at creation
  original_transaction_id UUID REFERENCES treasury_transactions(id),  -- for REVERSAL
  created_by              UUID NOT NULL REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ   -- set when status → COMPLETED/REJECTED/CANCELLED
);

CREATE INDEX IF NOT EXISTS idx_tt_status       ON treasury_transactions(status);
CREATE INDEX IF NOT EXISTS idx_tt_type         ON treasury_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_tt_customer     ON treasury_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_tt_created_at   ON treasury_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tt_created_by   ON treasury_transactions(created_by);

-- ============================================================
-- TABLE 8: payment_instructions
-- One-to-one with treasury_transactions. Structured data.
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_instructions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  beneficiary_name TEXT,
  bank_name        TEXT,
  account_number   TEXT,
  account_type     TEXT,
  amount           NUMERIC(20,4),
  transfer_charge  NUMERIC(20,4) NOT NULL DEFAULT 0,
  purpose          TEXT,
  is_internal      BOOLEAN NOT NULL DEFAULT false,
  verified_at      TIMESTAMPTZ,
  verified_by      UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 9: signature_verifications
-- ============================================================
CREATE TABLE IF NOT EXISTS signature_verifications (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id           UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  verified_by              UUID NOT NULL REFERENCES profiles(id),
  signature_result         TEXT NOT NULL CHECK (signature_result IN ('PASSED','FAILED')),
  mandate_result           TEXT NOT NULL CHECK (mandate_result IN ('PASSED','FAILED')),
  account_ownership_result TEXT NOT NULL CHECK (account_ownership_result IN ('PASSED','FAILED')),
  completeness_result      TEXT NOT NULL CHECK (completeness_result IN ('PASSED','FAILED')),
  notes                    TEXT,
  verified_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 10: customer_confirmations
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_confirmations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  confirmed_by         UUID NOT NULL REFERENCES profiles(id),
  confirmation_status  TEXT NOT NULL CHECK (confirmation_status IN ('CONFIRMED','FAILED','UNREACHABLE')),
  confirmed_amount     NUMERIC(20,4) NOT NULL,
  confirmed_beneficiary TEXT,
  confirmed_purpose    TEXT NOT NULL,
  confirmation_date    DATE NOT NULL,
  confirmation_time    TIME NOT NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 11: investment_verifications
-- Immutable snapshot that drives all downstream calculations.
-- ============================================================
CREATE TABLE IF NOT EXISTS investment_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  verified_by         UUID NOT NULL REFERENCES profiles(id),
  source_system       TEXT NOT NULL DEFAULT 'EAZYBANKZ',
  principal           NUMERIC(20,4) NOT NULL,
  accrued_interest    NUMERIC(20,4) NOT NULL,
  interest_rate       NUMERIC(10,6) NOT NULL,
  effective_date      DATE NOT NULL,
  maturity_date       DATE,
  outstanding_balance NUMERIC(20,4) NOT NULL,
  available_amount    NUMERIC(20,4) NOT NULL,
  verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 12: vouchers
-- ============================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  voucher_number       TEXT NOT NULL UNIQUE,
  voucher_type         TEXT NOT NULL
                         CHECK (voucher_type IN ('FUNDS_IN','FUNDS_OUT','ROLLOVER_SLIP','TRANSFER_SLIP')),
  status               TEXT NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','FINALISED')),
  principal            NUMERIC(20,4),
  interest             NUMERIC(20,4),
  wht                  NUMERIC(20,4) NOT NULL DEFAULT 0,
  charge               NUMERIC(20,4) NOT NULL DEFAULT 0,
  net_amount           NUMERIC(20,4),
  available_balance    NUMERIC(20,4),   -- for SAVINGS/CALL/CMS Funds-Out (Req 38)
  transfer_date        DATE,
  remarks              TEXT,
  payment_instruction  JSONB,           -- standardised Payment Instruction block (Req 36)
  calculation_snapshot JSONB NOT NULL DEFAULT '{}',
  created_by           UUID NOT NULL REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 13: rollover_details
-- ============================================================
CREATE TABLE IF NOT EXISTS rollover_details (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  rollover_type       TEXT NOT NULL
                        CHECK (rollover_type IN ('P_AND_I','PRINCIPAL_ONLY','PARTIAL_PRINCIPAL','INTEREST_ONLY')),
  original_principal  NUMERIC(20,4) NOT NULL,
  interest_due        NUMERIC(20,4) NOT NULL,
  principal_rolled    NUMERIC(20,4),
  interest_paid       NUMERIC(20,4),
  requested_payout    NUMERIC(20,4),
  new_rate            NUMERIC(10,6),
  new_tenor           INTEGER,           -- days
  new_effective_date  DATE,
  new_maturity_date   DATE,
  new_rollover_amount NUMERIC(20,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 14: pre_liquidation_details
-- ============================================================
CREATE TABLE IF NOT EXISTS pre_liquidation_details (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  original_principal  NUMERIC(20,4) NOT NULL,
  accrued_interest    NUMERIC(20,4) NOT NULL,
  charge_rate         NUMERIC(10,6) NOT NULL DEFAULT 0.200000,
  charge_amount       NUMERIC(20,4) NOT NULL,
  requested_payout    NUMERIC(20,4),
  remaining_principal NUMERIC(20,4),
  rebooked_principal  NUMERIC(20,4),
  net_interest        NUMERIC(20,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 15: approvals
-- Unique constraint prevents duplicate stage approvals.
-- ============================================================
CREATE TABLE IF NOT EXISTS approvals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  stage          TEXT NOT NULL
                   CHECK (stage IN ('TREASURY','HEAD_TREASURY','MIS','AUDIT','MD')),
  approver_id    UUID NOT NULL REFERENCES profiles(id),
  decision       TEXT NOT NULL CHECK (decision IN ('APPROVE','RETURN','REJECT')),
  comments       TEXT,
  approved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_approvals_tx_stage ON approvals(transaction_id, stage);

-- ============================================================
-- TABLE 16: operations_executions
-- Unique on transaction_id prevents double execution.
-- ============================================================
CREATE TABLE IF NOT EXISTS operations_executions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL UNIQUE REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  executed_by      UUID NOT NULL REFERENCES profiles(id),
  execution_status TEXT NOT NULL CHECK (execution_status IN ('SUCCESS','FAILED','PARTIAL')),
  external_reference TEXT,
  execution_notes  TEXT,
  executed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_exec_tx ON operations_executions(transaction_id);

-- ============================================================
-- TABLE 17: audit_events
-- Append-only. UPDATE and DELETE revoked in migration 002.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id UUID REFERENCES treasury_transactions(id),
  actor_id       UUID REFERENCES profiles(id),
  event_type     TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_tx_created ON audit_events(transaction_id, created_at ASC);

-- ============================================================
-- TABLE 18: transaction_documents
-- ============================================================
CREATE TABLE IF NOT EXISTS transaction_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  document_type  TEXT NOT NULL
                   CHECK (document_type IN ('INSTRUCTION','SIGNED_FORM','EVIDENCE','MANDATE')),
  storage_path   TEXT NOT NULL,
  uploaded_by    UUID NOT NULL REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE 19: notifications
-- Lightweight notification fan-out per role transition.
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,
  message        TEXT NOT NULL,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);

-- ============================================================
-- TABLE 20: sla_config
-- Configurable SLA per transaction type (ADMIN-managed).
-- ============================================================
CREATE TABLE IF NOT EXISTS sla_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type TEXT NOT NULL UNIQUE,
  sla_hours        INTEGER NOT NULL DEFAULT 8,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default SLA config for all transaction types
INSERT INTO sla_config (transaction_type, sla_hours) VALUES
  ('ROLLOVER', 8),
  ('MATURITY_TERMINATION', 8),
  ('PRE_LIQUIDATION', 8),
  ('ANNIVERSARY_PAYMENT', 8),
  ('THIRD_PARTY_PAYMENT', 8),
  ('INTERNAL_TRANSFER', 8),
  ('INFLOW', 8),
  ('SAVINGS_FUNDS_OUT', 8),
  ('CALL_FUNDS_OUT', 8),
  ('CMS_FUNDS_OUT', 8),
  ('REVERSAL', 8)
ON CONFLICT (transaction_type) DO NOTHING;
