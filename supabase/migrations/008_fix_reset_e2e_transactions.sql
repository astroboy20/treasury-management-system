-- ============================================================
-- Migration 008: Fix reset_e2e_transactions()
--
-- The original function in seed.sql relied on ON DELETE CASCADE to
-- remove audit_events rows when treasury_transactions are deleted.
-- However, audit_events.transaction_id intentionally has NO CASCADE
-- (the table is append-only and the FK is plain to prevent accidental
-- cascades). This caused a FK violation (23503) when the function
-- tried to delete treasury_transactions rows that still had
-- referencing audit_events rows.
--
-- Fix: explicitly delete audit_events first, then delete the
-- transactions (which cascades to all other child tables).
-- ============================================================

CREATE OR REPLACE FUNCTION reset_e2e_transactions()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $reset_fn$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Step 1: Delete audit_events for e2e transactions explicitly.
  -- audit_events.transaction_id has no ON DELETE CASCADE because the
  -- table is append-only.  The parent delete in step 2 would violate
  -- the FK if these rows are not removed first.
  DELETE FROM audit_events
  WHERE transaction_id IN (
    SELECT id
    FROM treasury_transactions
    WHERE created_by IN (
      SELECT id FROM profiles WHERE email LIKE '%_e2e@greenline.test'
    )
  );

  -- Step 2: Delete the parent transactions.
  -- All other child tables (signature_verifications,
  -- customer_confirmations, investment_verifications, vouchers,
  -- rollover_details, pre_liquidation_details, approvals,
  -- operations_executions, transaction_documents,
  -- payment_instructions, notifications) carry ON DELETE CASCADE and
  -- are removed automatically.
  DELETE FROM treasury_transactions
  WHERE created_by IN (
    SELECT id
    FROM profiles
    WHERE email LIKE '%_e2e@greenline.test'
  );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE 'reset_e2e_transactions: % transaction(s) deleted.', v_deleted_count;
END;
$reset_fn$;
