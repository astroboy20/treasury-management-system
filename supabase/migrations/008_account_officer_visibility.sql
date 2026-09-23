-- ============================================================
-- Migration 008: Account Officer Transaction Visibility Fix
--
-- Problem: After Step 3 (customer confirmation), the transaction
-- status moves from SIGNATURE_VERIFIED to CUSTOMER_CONFIRMED.
-- The existing RLS policies only let Account Officers see:
--   1. status = SIGNATURE_VERIFIED (pending confirmation)
--   2. Transactions they have a customer_confirmations row for
--
-- Policy #2 should cover post-confirmation, but the transaction
-- then moves through many more statuses (INVESTMENT_VERIFIED,
-- VOUCHER_PREPARED, etc.) and the Account Officer loses visibility
-- because the confirmed_by check only works once the row exists
-- AND the RLS evaluator sees it within the same request context.
--
-- Fix: Replace the two narrow Account Officer SELECT policies
-- with a single broader unified policy that lets them see:
--   - Transactions awaiting their action (SIGNATURE_VERIFIED)
--   - Transactions they have confirmed (any subsequent status)
--
-- Also update can_view_transaction() helper to match, so all
-- child-table policies stay consistent.
-- ============================================================

-- Drop old narrow policies
DROP POLICY IF EXISTS "tt_select_account_officer" ON treasury_transactions;
DROP POLICY IF EXISTS "tt_select_account_officer_pending" ON treasury_transactions;

-- Single unified policy for Account Officers
DROP POLICY IF EXISTS "tt_select_account_officer_unified" ON treasury_transactions;
CREATE POLICY "tt_select_account_officer_unified" ON treasury_transactions
  FOR SELECT
  USING (
    get_user_role() = 'ACCOUNT_OFFICER'
    AND (
      -- Awaiting confirmation — any AO can see and action these
      status = 'SIGNATURE_VERIFIED'
      -- Already confirmed by this AO — visible at all subsequent statuses
      OR EXISTS (
        SELECT 1 FROM customer_confirmations cc
        WHERE cc.transaction_id = id
          AND cc.confirmed_by = auth.uid()
      )
    )
  );

-- Update can_view_transaction() to mirror the new visibility rule
-- so child-table policies (signature_verifications, payment_instructions,
-- audit_events, approvals, etc.) remain consistent.
CREATE OR REPLACE FUNCTION can_view_transaction(tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM treasury_transactions t
    WHERE t.id = tx_id
    AND (
      -- Full treasury/approver chain sees everything
      get_user_role() IN ('TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN')
      -- Account Officers: awaiting confirmation OR already confirmed by them
      OR (
        get_user_role() = 'ACCOUNT_OFFICER'
        AND (
          t.status = 'SIGNATURE_VERIFIED'
          OR EXISTS (
            SELECT 1 FROM customer_confirmations cc
            WHERE cc.transaction_id = t.id
              AND cc.confirmed_by = auth.uid()
          )
        )
      )
      -- Operations sees MD-approved and execution-stage transactions
      OR (
        get_user_role() = 'OPERATIONS'
        AND t.status IN (
          'MD_APPROVED','OPERATIONS_PROCESSING','OPERATIONS_COMPLETED',
          'TREASURY_CONFIRMED','COMPLETED'
        )
      )
    )
  );
$$;
