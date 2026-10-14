-- ============================================================
-- Migration 015: Allow Voucher Resubmission After Return
-- ============================================================
-- When an approver recalls a transaction, status becomes RETURNED.
-- The maker needs to correct and re-prepare the voucher to restart
-- the approval chain from the TREASURY stage.
--
-- Changes to prepare_voucher():
--   - Accepts RETURNED status in addition to INVESTMENT_VERIFIED
--   - When resubmitting from RETURNED, deletes the previous voucher
--     and all prior approval records so the chain restarts cleanly
--   - Transitions back to VOUCHER_PREPARED so the chain restarts
-- ============================================================

-- Must drop first because the existing function has INVESTMENT_VERIFIED-only guard
DROP FUNCTION IF EXISTS prepare_voucher(UUID, JSONB, JSONB);

CREATE OR REPLACE FUNCTION prepare_voucher(
  p_transaction_id      UUID,
  p_voucher_data        JSONB DEFAULT '{}',
  p_payment_instruction JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id      UUID := auth.uid();
  v_actor_role    TEXT;
  v_tx            treasury_transactions%ROWTYPE;
  v_voucher_type  TEXT;
  v_voucher_id    UUID := gen_random_uuid();
  v_voucher_num   TEXT;
  v_calc_snapshot JSONB;
  v_is_resubmit   BOOLEAN := FALSE;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  -- 2. Role check
  IF v_actor_role NOT IN ('TREASURY_OFFICER', 'ADMIN') THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'prepare_voucher', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER can prepare vouchers'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction % does not exist', p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate state — INVESTMENT_VERIFIED (first time) or RETURNED (resubmission)
  IF v_tx.status NOT IN ('INVESTMENT_VERIFIED', 'RETURNED') THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected INVESTMENT_VERIFIED or RETURNED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  v_is_resubmit := v_tx.status = 'RETURNED';

  -- 5. If resubmitting: remove previous voucher and all approval records
  --    so the approval chain restarts cleanly from the TREASURY stage
  IF v_is_resubmit THEN
    DELETE FROM vouchers  WHERE transaction_id = p_transaction_id;
    DELETE FROM approvals WHERE transaction_id = p_transaction_id;
  END IF;

  -- 6. For INTERNAL_TRANSFER: enforce available balance >= requested_amount (Req 22.2)
  IF v_tx.transaction_type = 'INTERNAL_TRANSFER' THEN
    DECLARE
      v_available NUMERIC;
      v_requested NUMERIC := v_tx.requested_amount;
    BEGIN
      SELECT available_amount INTO v_available
      FROM investment_verifications
      WHERE transaction_id = p_transaction_id
      ORDER BY verified_at DESC
      LIMIT 1;

      IF v_available IS NOT NULL AND v_requested IS NOT NULL AND v_available < v_requested THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available % is less than requested %',
          v_available, v_requested USING ERRCODE = 'P0001';
      END IF;
    END;
  END IF;

  -- 7. Resolve voucher type from transaction type
  v_voucher_type := CASE v_tx.transaction_type
    WHEN 'ROLLOVER'              THEN 'ROLLOVER_SLIP'
    WHEN 'MATURITY_TERMINATION'  THEN 'FUNDS_OUT'
    WHEN 'PRE_LIQUIDATION'       THEN 'FUNDS_OUT'
    WHEN 'ANNIVERSARY_PAYMENT'   THEN 'FUNDS_OUT'
    WHEN 'THIRD_PARTY_PAYMENT'   THEN 'FUNDS_OUT'
    WHEN 'INTERNAL_TRANSFER'     THEN 'TRANSFER_SLIP'
    WHEN 'INFLOW'                THEN 'FUNDS_IN'
    WHEN 'SAVINGS_FUNDS_OUT'     THEN 'FUNDS_OUT'
    WHEN 'CALL_FUNDS_OUT'        THEN 'FUNDS_OUT'
    WHEN 'CMS_FUNDS_OUT'         THEN 'FUNDS_OUT'
    WHEN 'REVERSAL'              THEN 'TRANSFER_SLIP'
    ELSE 'FUNDS_OUT'
  END;

  -- 8. Generate voucher number and extract calculation snapshot
  v_voucher_num   := generate_voucher_number();
  v_calc_snapshot := COALESCE(p_voucher_data->'calculation_snapshot', '{}');

  -- 9. Insert voucher using the correct table columns (no voucher_data column — explicit fields)
  INSERT INTO vouchers (
    id, transaction_id, voucher_number, voucher_type, status,
    principal, interest, wht, charge, net_amount, available_balance,
    transfer_date, remarks, payment_instruction, calculation_snapshot,
    created_by
  ) VALUES (
    v_voucher_id,
    p_transaction_id,
    v_voucher_num,
    v_voucher_type,
    'FINALISED',
    (p_voucher_data->>'principal')::NUMERIC,
    (p_voucher_data->>'interest')::NUMERIC,
    COALESCE((p_voucher_data->>'wht')::NUMERIC, 0),
    COALESCE((p_voucher_data->>'charge')::NUMERIC, 0),
    (p_voucher_data->>'net_amount')::NUMERIC,
    (p_voucher_data->>'available_balance')::NUMERIC,
    (p_voucher_data->>'transfer_date')::DATE,
    p_voucher_data->>'remarks',
    p_payment_instruction,
    v_calc_snapshot,
    v_actor_id
  );

  -- 10. Update transaction status → VOUCHER_PREPARED
  UPDATE treasury_transactions
  SET status = 'VOUCHER_PREPARED', updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 11. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'VOUCHER_CREATED',
         v_tx.status, 'VOUCHER_PREPARED',
         jsonb_build_object(
           'voucher_number', v_voucher_num,
           'voucher_type',   v_voucher_type,
           'resubmission',   v_is_resubmit
         ));

  RETURN jsonb_build_object(
    'success',        true,
    'new_status',     'VOUCHER_PREPARED',
    'voucher_id',     v_voucher_id,
    'voucher_number', v_voucher_num,
    'voucher_type',   v_voucher_type,
    'resubmission',   v_is_resubmit
  );
END;
$$;
