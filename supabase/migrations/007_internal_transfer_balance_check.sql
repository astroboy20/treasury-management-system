-- ============================================================
-- Migration 007: Internal Transfer Balance Check — Greenline Treasury Platform
--
-- Adds server-side available balance validation to the prepare_voucher
-- RPC for INTERNAL_TRANSFER transactions (Req 22.2).
--
-- Before a Transfer Slip voucher can be prepared, the system verifies
-- that the customer's available balance in customer_accounts (or the
-- investment snapshot's available_amount) is ≥ the transaction's
-- requested_amount. This prevents voucher preparation when funds are
-- insufficient.
--
-- This is a CREATE OR REPLACE of prepare_voucher that adds an
-- INTERNAL_TRANSFER-specific guard block before voucher insertion.
-- All other behaviour is unchanged from migration 003.
-- ============================================================

-- ============================================================
-- HELPER: validate_transfer_balance(transaction_id)
--
-- Returns TRUE if the transaction's requested_amount does not
-- exceed the available balance of the linked customer account
-- (or investment verification snapshot, whichever is available).
--
-- Called by prepare_voucher before inserting the TRANSFER_SLIP voucher.
-- Requirements: 22.2
-- ============================================================
CREATE OR REPLACE FUNCTION validate_transfer_balance(p_transaction_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx              treasury_transactions%ROWTYPE;
  v_requested       NUMERIC;
  v_available       NUMERIC := NULL;
BEGIN
  -- 1. Load the transaction to get requested_amount and customer/investment refs
  SELECT * INTO v_tx
  FROM treasury_transactions
  WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_requested := v_tx.requested_amount;

  -- 2. Prefer the investment verification snapshot's available_amount
  --    (this is the confirmed, immutable value from Step 4 — Req 10.5)
  SELECT iv.available_amount INTO v_available
  FROM investment_verifications iv
  WHERE iv.transaction_id = p_transaction_id
  LIMIT 1;

  -- 3. Fall back to the live customer_accounts.available_balance for
  --    SAVINGS_TO_PERSONAL where an investment may not be linked
  IF v_available IS NULL THEN
    SELECT ca.available_balance INTO v_available
    FROM customer_accounts ca
    WHERE ca.customer_id = v_tx.customer_id
      AND ca.account_type = 'SAVINGS'
      AND ca.status = 'ACTIVE'
    ORDER BY ca.available_balance DESC
    LIMIT 1;
  END IF;

  -- 4. If we still cannot find a balance, deny the operation
  IF v_available IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 5. The balance must be >= the requested transfer amount (Req 22.2)
  RETURN v_available >= v_requested;
END;
$$;


-- ============================================================
-- Update prepare_voucher() to enforce balance check for
-- INTERNAL_TRANSFER before inserting the TRANSFER_SLIP voucher.
--
-- All other logic is unchanged — only the INTERNAL_TRANSFER
-- guard block is new.
-- ============================================================
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
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role != 'TREASURY_OFFICER' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'prepare_voucher', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER can prepare vouchers'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction % does not exist', p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate state
  IF v_tx.status != 'INVESTMENT_VERIFIED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected INVESTMENT_VERIFIED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Resolve voucher type SERVER-SIDE (frontend cannot set this)
  v_voucher_type := resolve_voucher_type(v_tx.transaction_type);
  IF v_voucher_type IS NULL THEN
    RAISE EXCEPTION 'INVALID_TYPE: no voucher type defined for transaction type %',
      v_tx.transaction_type USING ERRCODE = '22000';
  END IF;

  -- ── NEW: Balance check for INTERNAL_TRANSFER (Req 22.2) ──────────────────
  -- Verify available balance ≥ requested_amount before allowing Transfer Slip
  -- voucher preparation. Rejected with a clear business error, not a generic one.
  IF v_tx.transaction_type = 'INTERNAL_TRANSFER' THEN
    IF NOT validate_transfer_balance(p_transaction_id) THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: available balance is less than the requested transfer amount of %. Verify the account balance in Step 4 before preparing the voucher.',
        v_tx.requested_amount USING ERRCODE = '23514';
    END IF;
  END IF;
  -- ─────────────────────────────────────────────────────────────────────────

  -- 5. Generate voucher number
  v_voucher_num := generate_voucher_number();

  -- 6. Build calculation snapshot from voucher data
  v_calc_snapshot := COALESCE(p_voucher_data->'calculation_snapshot', '{}');

  -- 7. Insert voucher record
  INSERT INTO vouchers (
    id, transaction_id, voucher_number, voucher_type, status,
    principal, interest, wht, charge, net_amount, available_balance,
    transfer_date, remarks, payment_instruction, calculation_snapshot,
    created_by
  ) VALUES (
    v_voucher_id, p_transaction_id, v_voucher_num, v_voucher_type, 'FINALISED',
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

  -- 7a. For PRE_LIQUIDATION transactions, persist the pre_liquidation_details row (Req 19.3)
  IF v_tx.transaction_type = 'PRE_LIQUIDATION' THEN
    DECLARE
      v_snap_outputs   JSONB := COALESCE(v_calc_snapshot->'outputs', '{}');
      v_snap_inputs    JSONB := COALESCE(v_calc_snapshot->'inputs',  '{}');
      v_inv            investment_verifications%ROWTYPE;
    BEGIN
      SELECT * INTO v_inv FROM investment_verifications
      WHERE transaction_id = p_transaction_id;

      INSERT INTO pre_liquidation_details (
        transaction_id,
        original_principal,
        accrued_interest,
        charge_rate,
        charge_amount,
        net_interest,
        requested_payout,
        remaining_principal,
        rebooked_principal
      ) VALUES (
        p_transaction_id,
        COALESCE(v_inv.principal, (p_voucher_data->>'principal')::NUMERIC),
        COALESCE(
          v_inv.accrued_interest,
          (v_snap_inputs->>'accrued_interest')::NUMERIC,
          (p_voucher_data->>'interest')::NUMERIC
        ),
        0.20,
        COALESCE(
          (v_snap_outputs->>'charge')::NUMERIC,
          (p_voucher_data->>'charge')::NUMERIC,
          0
        ),
        COALESCE(
          (v_snap_outputs->>'net_interest')::NUMERIC
        ),
        NULLIF((v_snap_inputs->>'requested_payout')::TEXT, '')::NUMERIC,
        NULLIF((v_snap_outputs->>'remaining_principal')::TEXT, '')::NUMERIC,
        NULLIF((v_snap_outputs->>'rebooked_principal')::TEXT, '')::NUMERIC
      )
      ON CONFLICT (transaction_id) DO UPDATE SET
        charge_amount       = EXCLUDED.charge_amount,
        net_interest        = EXCLUDED.net_interest,
        requested_payout    = EXCLUDED.requested_payout,
        remaining_principal = EXCLUDED.remaining_principal,
        rebooked_principal  = EXCLUDED.rebooked_principal;
    END;
  END IF;

  -- 8. Update transaction status
  UPDATE treasury_transactions
  SET status = 'VOUCHER_PREPARED', updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 9. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'VOUCHER_CREATED',
         'INVESTMENT_VERIFIED', 'VOUCHER_PREPARED',
         jsonb_build_object(
           'voucher_number', v_voucher_num,
           'voucher_type', v_voucher_type,
           'scenario_code', v_tx.scenario_code
         ));

  RETURN jsonb_build_object(
    'success', true,
    'voucher_id', v_voucher_id,
    'voucher_number', v_voucher_num,
    'voucher_type', v_voucher_type
  );
END;
$$;
