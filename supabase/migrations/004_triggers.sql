-- ============================================================
-- Migration 004: Database Triggers — Greenline Treasury Platform
-- ============================================================

-- ============================================================
-- TRIGGER 1: handle_new_user()
-- Fires AFTER INSERT ON auth.users.
-- Creates a profiles row from Supabase auth metadata.
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Unknown'),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- HELPER: get_next_action_role(status TEXT)
-- Maps each transaction status to the role responsible for
-- the next action. Used by the notify_next_role trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION get_next_action_role(p_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_status
    WHEN 'INSTRUCTION_RECEIVED'     THEN 'TREASURY_OFFICER'   -- needs signature verification
    WHEN 'SIGNATURE_VERIFIED'       THEN 'ACCOUNT_OFFICER'    -- needs customer confirmation
    WHEN 'CUSTOMER_CONFIRMED'       THEN 'TREASURY_OFFICER'   -- needs investment verification
    WHEN 'INVESTMENT_VERIFIED'      THEN 'TREASURY_OFFICER'   -- needs voucher preparation
    WHEN 'VOUCHER_PREPARED'         THEN 'TREASURY_OFFICER'   -- needs Treasury approval
    WHEN 'TREASURY_APPROVED'        THEN 'HEAD_TREASURY'      -- needs HT approval
    WHEN 'HEAD_TREASURY_APPROVED'   THEN 'MIS'                -- needs MIS approval
    WHEN 'MIS_APPROVED'             THEN 'AUDIT'              -- needs Audit approval
    WHEN 'AUDIT_APPROVED'           THEN 'MD'                 -- needs MD approval
    WHEN 'MD_APPROVED'              THEN 'OPERATIONS'         -- ready for execution
    WHEN 'OPERATIONS_COMPLETED'     THEN 'TREASURY_OFFICER'   -- needs completion confirmation
    ELSE NULL  -- terminal states (COMPLETED, REJECTED, etc.) notify nobody
  END;
END;
$$;

-- ============================================================
-- TRIGGER 2: notify_next_role()
-- Fires AFTER INSERT ON audit_events.
-- When a transaction transitions to a new status, creates
-- notification rows for all users holding the next-action role.
-- ============================================================
CREATE OR REPLACE FUNCTION notify_next_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_role TEXT;
  v_tx_ref    TEXT;
BEGIN
  -- Only process events that represent a status transition on a transaction
  IF NEW.transaction_id IS NULL OR NEW.to_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve which role needs to act next
  v_next_role := get_next_action_role(NEW.to_status);

  -- Nothing to notify for terminal or no-action states
  IF v_next_role IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the transaction reference for the notification message
  SELECT transaction_reference INTO v_tx_ref
  FROM treasury_transactions
  WHERE id = NEW.transaction_id;

  -- Fan out notification to all users with the next-action role
  INSERT INTO notifications (recipient_id, transaction_id, event_type, message)
  SELECT
    ur.user_id,
    NEW.transaction_id,
    NEW.event_type,
    format('Transaction %s requires your attention', COALESCE(v_tx_ref, NEW.transaction_id::TEXT))
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  JOIN profiles p ON p.id = ur.user_id
  WHERE r.code = v_next_role
    AND p.is_active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_audit_event_notify ON audit_events;
CREATE TRIGGER on_audit_event_notify
  AFTER INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION notify_next_role();

-- ============================================================
-- TRIGGER 3: update_updated_at()
-- Generic trigger to keep updated_at current on tables that
-- have it. Applied to tables with mutable rows.
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply to all tables with updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_customer_accounts_updated_at ON customer_accounts;
CREATE TRIGGER trg_customer_accounts_updated_at
  BEFORE UPDATE ON customer_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_investments_updated_at ON investments;
CREATE TRIGGER trg_investments_updated_at
  BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_transactions_updated_at ON treasury_transactions;
CREATE TRIGGER trg_treasury_transactions_updated_at
  BEFORE UPDATE ON treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_payment_instructions_updated_at ON payment_instructions;
CREATE TRIGGER trg_payment_instructions_updated_at
  BEFORE UPDATE ON payment_instructions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_vouchers_updated_at ON vouchers;
CREATE TRIGGER trg_vouchers_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_sla_config_updated_at ON sla_config;
CREATE TRIGGER trg_sla_config_updated_at
  BEFORE UPDATE ON sla_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
