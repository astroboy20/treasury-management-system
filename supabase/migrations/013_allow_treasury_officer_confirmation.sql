-- ============================================================
-- Migration 013: Allow Treasury Officer to Record Customer Confirmation
-- ============================================================
-- Steps 1–5 of the workflow are all performed by a single Treasury
-- Officer. The previous restriction (ACCOUNT_OFFICER only) prevented
-- the Treasury Officer from completing Step 3.
--
-- Change: record_customer_confirmation() now accepts both
--   TREASURY_OFFICER and ACCOUNT_OFFICER (plus ADMIN).
-- ============================================================

CREATE OR REPLACE FUNCTION record_customer_confirmation(
  p_transaction_id        UUID,
  p_confirmation_status   TEXT,
  p_confirmed_amount      NUMERIC,
  p_confirmed_purpose     TEXT,
  p_confirmation_date     DATE,
  p_confirmation_time     TIME,
  p_confirmed_beneficiary TEXT DEFAULT NULL,
  p_notes                 TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   UUID := auth.uid();
  v_actor_role TEXT;
  v_tx         treasury_transactions%ROWTYPE;
  v_new_status TEXT;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  -- 2. Role check — TREASURY_OFFICER, ACCOUNT_OFFICER, or ADMIN
  IF v_actor_role NOT IN ('TREASURY_OFFICER', 'ACCOUNT_OFFICER', 'ADMIN') THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'record_customer_confirmation', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER or ACCOUNT_OFFICER can record confirmations'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction % does not exist', p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate state — must have passed signature verification
  IF v_tx.status != 'SIGNATURE_VERIFIED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected SIGNATURE_VERIFIED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 5. Insert confirmation record
  INSERT INTO customer_confirmations (
    transaction_id, confirmed_by, confirmation_status, confirmed_amount,
    confirmed_beneficiary, confirmed_purpose, confirmation_date, confirmation_time, notes
  ) VALUES (
    p_transaction_id, v_actor_id, p_confirmation_status, p_confirmed_amount,
    p_confirmed_beneficiary, p_confirmed_purpose, p_confirmation_date, p_confirmation_time, p_notes
  );

  -- 6. Determine new status
  IF p_confirmation_status = 'CONFIRMED' THEN
    v_new_status := 'CUSTOMER_CONFIRMED';
  ELSE
    -- FAILED or UNREACHABLE — controlled exception state, routes back for re-assessment
    v_new_status := 'RETURNED';
  END IF;

  -- 7. Update transaction status
  UPDATE treasury_transactions
  SET status = v_new_status, updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 8. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'CUSTOMER_CONFIRMED',
         'SIGNATURE_VERIFIED', v_new_status,
         jsonb_build_object('confirmation_status', p_confirmation_status));

  RETURN jsonb_build_object(
    'success', true,
    'new_status', v_new_status
  );
END;
$$;
