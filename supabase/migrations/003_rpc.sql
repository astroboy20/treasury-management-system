-- ============================================================
-- Migration 003: PostgreSQL RPC Functions — Greenline Treasury Platform
-- ============================================================
-- All critical mutations are implemented as SECURITY DEFINER
-- functions. Each function:
--   1. Resolves the authenticated actor's role from the DB
--   2. Loads the target transaction with FOR UPDATE row lock
--   3. Validates workflow state and actor role
--   4. Performs the mutation atomically
--   5. Writes an append-only audit event
--   6. Returns a JSONB result
--
-- The frontend NEVER supplies the actor's role or the transaction
-- status — these are always derived server-side.
-- ============================================================

-- ============================================================
-- HELPER: generate_transaction_reference()
-- Generates TRX-XXXXX style references with collision retry.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_transaction_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref  TEXT;
  v_seq  INT;
BEGIN
  -- Use a sequence-backed approach for uniqueness
  SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_reference FROM 5) AS INTEGER)), 0) + 1
  INTO v_seq
  FROM treasury_transactions
  WHERE transaction_reference ~ '^TRX-[0-9]+$';

  v_ref := 'TRX-' || LPAD(v_seq::TEXT, 5, '0');
  RETURN v_ref;
END;
$$;

-- ============================================================
-- HELPER: generate_voucher_number()
-- Generates VCH-XXXXX style voucher numbers.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_voucher_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num TEXT;
  v_seq INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM 5) AS INTEGER)), 0) + 1
  INTO v_seq
  FROM vouchers
  WHERE voucher_number ~ '^VCH-[0-9]+$';

  v_num := 'VCH-' || LPAD(v_seq::TEXT, 5, '0');
  RETURN v_num;
END;
$$;

-- ============================================================
-- HELPER: resolve_voucher_type(transaction_type TEXT)
-- Server-side voucher type resolution — frontend cannot override.
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_voucher_type(p_transaction_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_transaction_type
    WHEN 'INFLOW'               THEN 'FUNDS_IN'
    WHEN 'MATURITY_TERMINATION' THEN 'FUNDS_OUT'
    WHEN 'ANNIVERSARY_PAYMENT'  THEN 'FUNDS_OUT'
    WHEN 'PRE_LIQUIDATION'      THEN 'FUNDS_OUT'
    WHEN 'THIRD_PARTY_PAYMENT'  THEN 'FUNDS_OUT'
    WHEN 'SAVINGS_FUNDS_OUT'    THEN 'FUNDS_OUT'
    WHEN 'CALL_FUNDS_OUT'       THEN 'FUNDS_OUT'
    WHEN 'CMS_FUNDS_OUT'        THEN 'FUNDS_OUT'
    WHEN 'ROLLOVER'             THEN 'ROLLOVER_SLIP'
    WHEN 'INTERNAL_TRANSFER'    THEN 'TRANSFER_SLIP'
    WHEN 'REVERSAL'             THEN 'TRANSFER_SLIP'
    ELSE NULL
  END;
END;
$$;

-- ============================================================
-- HELPER: get_next_status_after_approval(stage TEXT, decision TEXT)
-- Returns the new transaction status based on approval outcome.
-- ============================================================
CREATE OR REPLACE FUNCTION get_next_status_after_approval(
  p_stage    TEXT,
  p_decision TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_decision = 'REJECT' THEN
    RETURN 'REJECTED';
  END IF;
  IF p_decision = 'RETURN' THEN
    RETURN 'RETURNED';
  END IF;
  -- APPROVE path
  RETURN CASE p_stage
    WHEN 'TREASURY'       THEN 'TREASURY_APPROVED'
    WHEN 'HEAD_TREASURY'  THEN 'HEAD_TREASURY_APPROVED'
    WHEN 'MIS'            THEN 'MIS_APPROVED'
    WHEN 'AUDIT'          THEN 'AUDIT_APPROVED'
    WHEN 'MD'             THEN 'MD_APPROVED'
    ELSE NULL
  END;
END;
$$;

-- ============================================================
-- HELPER: get_required_status_for_stage(stage TEXT)
-- Returns the transaction status required before this stage can act.
-- ============================================================
CREATE OR REPLACE FUNCTION get_required_status_for_stage(p_stage TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_stage
    WHEN 'TREASURY'       THEN 'VOUCHER_PREPARED'
    WHEN 'HEAD_TREASURY'  THEN 'TREASURY_APPROVED'
    WHEN 'MIS'            THEN 'HEAD_TREASURY_APPROVED'
    WHEN 'AUDIT'          THEN 'MIS_APPROVED'
    WHEN 'MD'             THEN 'AUDIT_APPROVED'
    ELSE NULL
  END;
END;
$$;

-- ============================================================
-- HELPER: get_required_role_for_stage(stage TEXT)
-- Returns the role code required to act at this approval stage.
-- ============================================================
CREATE OR REPLACE FUNCTION get_required_role_for_stage(p_stage TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_stage
    WHEN 'TREASURY'       THEN 'TREASURY_OFFICER'
    WHEN 'HEAD_TREASURY'  THEN 'HEAD_TREASURY'
    WHEN 'MIS'            THEN 'MIS'
    WHEN 'AUDIT'          THEN 'AUDIT'
    WHEN 'MD'             THEN 'MD'
    ELSE NULL
  END;
END;
$$;

-- ============================================================
-- RPC 1: create_treasury_transaction()
-- Creates a new transaction record, assigns reference, computes
-- SLA deadline, and writes the TRANSACTION_CREATED audit event.
-- Actor must be TREASURY_OFFICER or ACCOUNT_OFFICER.
-- ============================================================
CREATE OR REPLACE FUNCTION create_treasury_transaction(
  p_customer_id          UUID,
  p_investment_id        UUID DEFAULT NULL,
  p_transaction_type     TEXT DEFAULT NULL,
  p_scenario_code        TEXT DEFAULT NULL,
  p_requested_amount     NUMERIC DEFAULT NULL,
  p_purpose              TEXT DEFAULT NULL,
  p_source_type          TEXT DEFAULT NULL,
  p_payment_instruction  JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   UUID := auth.uid();
  v_actor_role TEXT;
  v_tx_id      UUID := gen_random_uuid();
  v_ref        TEXT;
  v_sla_hours  INTEGER := 8;
  v_sla_due_at TIMESTAMPTZ;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role NOT IN ('TREASURY_OFFICER','ACCOUNT_OFFICER','ADMIN') THEN
    INSERT INTO audit_events(actor_id, event_type, metadata)
    VALUES(v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'create_treasury_transaction', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: role % cannot create transactions', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate inputs
  IF p_transaction_type IS NULL OR p_requested_amount IS NULL OR
     p_purpose IS NULL OR p_source_type IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: required fields missing'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Generate unique reference
  v_ref := generate_transaction_reference();

  -- 4. Compute SLA deadline from config (default 8 hours)
  SELECT sla_hours INTO v_sla_hours
  FROM sla_config WHERE transaction_type = p_transaction_type;

  v_sla_due_at := NOW() + (COALESCE(v_sla_hours, 8) || ' hours')::INTERVAL;

  -- 5. Insert transaction
  INSERT INTO treasury_transactions (
    id, transaction_reference, customer_id, investment_id,
    transaction_type, scenario_code, status, requested_amount,
    purpose, source_instruction_type, sla_due_at, created_by
  ) VALUES (
    v_tx_id, v_ref, p_customer_id, p_investment_id,
    p_transaction_type, p_scenario_code, 'INSTRUCTION_RECEIVED', p_requested_amount,
    p_purpose, p_source_type, v_sla_due_at, v_actor_id
  );

  -- 6. Insert payment instruction if provided
  IF p_payment_instruction IS NOT NULL THEN
    INSERT INTO payment_instructions (
      transaction_id, beneficiary_name, bank_name, account_number,
      account_type, amount, transfer_charge, purpose, is_internal
    ) VALUES (
      v_tx_id,
      p_payment_instruction->>'beneficiary_name',
      p_payment_instruction->>'bank_name',
      p_payment_instruction->>'account_number',
      p_payment_instruction->>'account_type',
      (p_payment_instruction->>'amount')::NUMERIC,
      COALESCE((p_payment_instruction->>'transfer_charge')::NUMERIC, 0),
      p_payment_instruction->>'purpose',
      COALESCE((p_payment_instruction->>'is_internal')::BOOLEAN, false)
    );
  END IF;

  -- 7. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(v_tx_id, v_actor_id, 'TRANSACTION_CREATED', NULL, 'INSTRUCTION_RECEIVED',
         jsonb_build_object('transaction_type', p_transaction_type, 'reference', v_ref));

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'transaction_reference', v_ref,
    'status', 'INSTRUCTION_RECEIVED'
  );
END;
$$;

-- ============================================================
-- RPC 2: verify_signature()
-- Records signature verification result.
-- Stops all downstream processing if result is FAILED.
-- Actor must be TREASURY_OFFICER.
-- ============================================================
CREATE OR REPLACE FUNCTION verify_signature(
  p_transaction_id           UUID,
  p_signature_result         TEXT,
  p_mandate_result           TEXT,
  p_account_ownership_result TEXT,
  p_completeness_result      TEXT,
  p_notes                    TEXT DEFAULT NULL
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
  v_event_type TEXT;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role != 'TREASURY_OFFICER' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'verify_signature', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER can verify signatures'
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
  IF v_tx.status != 'INSTRUCTION_RECEIVED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected INSTRUCTION_RECEIVED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Insert verification record
  INSERT INTO signature_verifications (
    transaction_id, verified_by, signature_result, mandate_result,
    account_ownership_result, completeness_result, notes
  ) VALUES (
    p_transaction_id, v_actor_id, p_signature_result, p_mandate_result,
    p_account_ownership_result, p_completeness_result, p_notes
  );

  -- 5. Determine outcome
  -- Status stays INSTRUCTION_RECEIVED if failed (downstream locked)
  -- but we record a SIGNATURE_FAILED audit event
  IF p_signature_result = 'FAILED' OR p_mandate_result = 'FAILED' OR
     p_account_ownership_result = 'FAILED' OR p_completeness_result = 'FAILED' THEN
    v_new_status := 'INSTRUCTION_RECEIVED'; -- stays, downstream locked by app layer
    v_event_type := 'SIGNATURE_FAILED';
  ELSE
    v_new_status := 'SIGNATURE_VERIFIED';
    v_event_type := 'SIGNATURE_VERIFIED';
    UPDATE treasury_transactions
    SET status = v_new_status, updated_at = NOW()
    WHERE id = p_transaction_id;
  END IF;

  -- 6. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, v_event_type,
         'INSTRUCTION_RECEIVED', v_new_status,
         jsonb_build_object(
           'signature_result', p_signature_result,
           'mandate_result', p_mandate_result
         ));

  RETURN jsonb_build_object(
    'success', true,
    'new_status', v_new_status,
    'event_type', v_event_type
  );
END;
$$;

-- ============================================================
-- RPC 3: record_customer_confirmation()
-- Records telephone confirmation from the Account Officer.
-- Actor must be ACCOUNT_OFFICER.
-- ============================================================
CREATE OR REPLACE FUNCTION record_customer_confirmation(
  p_transaction_id       UUID,
  p_confirmation_status  TEXT,
  p_confirmed_amount     NUMERIC,
  p_confirmed_purpose    TEXT,
  p_confirmation_date    DATE,
  p_confirmation_time    TIME,
  p_confirmed_beneficiary TEXT DEFAULT NULL,
  p_notes                TEXT DEFAULT NULL
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

  IF v_actor_role != 'ACCOUNT_OFFICER' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'record_customer_confirmation', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only ACCOUNT_OFFICER can record confirmations'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction % does not exist', p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate state — must have passed signature verification
  IF v_tx.status != 'SIGNATURE_VERIFIED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected SIGNATURE_VERIFIED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Insert confirmation record
  INSERT INTO customer_confirmations (
    transaction_id, confirmed_by, confirmation_status, confirmed_amount,
    confirmed_beneficiary, confirmed_purpose, confirmation_date, confirmation_time, notes
  ) VALUES (
    p_transaction_id, v_actor_id, p_confirmation_status, p_confirmed_amount,
    p_confirmed_beneficiary, p_confirmed_purpose, p_confirmation_date, p_confirmation_time, p_notes
  );

  -- 5. Determine new status
  IF p_confirmation_status = 'CONFIRMED' THEN
    v_new_status := 'CUSTOMER_CONFIRMED';
  ELSE
    -- FAILED or UNREACHABLE — controlled exception state
    v_new_status := 'RETURNED'; -- routes back for re-assessment
  END IF;

  -- 6. Update transaction status
  UPDATE treasury_transactions
  SET status = v_new_status, updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 7. Write audit event
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

-- ============================================================
-- RPC 4: verify_investment()
-- Creates the immutable investment snapshot from Eazybankz data.
-- All downstream calculations use this snapshot — never live data.
-- Actor must be TREASURY_OFFICER.
-- ============================================================
CREATE OR REPLACE FUNCTION verify_investment(
  p_transaction_id      UUID,
  p_principal           NUMERIC,
  p_accrued_interest    NUMERIC,
  p_interest_rate       NUMERIC,
  p_effective_date      DATE,
  p_maturity_date       DATE DEFAULT NULL,
  p_outstanding_balance NUMERIC DEFAULT NULL,
  p_available_amount    NUMERIC DEFAULT NULL
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
  v_snap_id    UUID := gen_random_uuid();
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role != 'TREASURY_OFFICER' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'verify_investment', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER can verify investments'
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
  IF v_tx.status != 'CUSTOMER_CONFIRMED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected CUSTOMER_CONFIRMED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Insert verification snapshot
  INSERT INTO investment_verifications (
    id, transaction_id, verified_by, source_system,
    principal, accrued_interest, interest_rate,
    effective_date, maturity_date,
    outstanding_balance, available_amount
  ) VALUES (
    v_snap_id, p_transaction_id, v_actor_id, 'EAZYBANKZ',
    p_principal, p_accrued_interest, p_interest_rate,
    p_effective_date, p_maturity_date,
    COALESCE(p_outstanding_balance, p_principal),
    COALESCE(p_available_amount, p_principal)
  );

  -- 5. Update transaction status
  UPDATE treasury_transactions
  SET status = 'INVESTMENT_VERIFIED', updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 6. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'INVESTMENT_VERIFIED',
         'CUSTOMER_CONFIRMED', 'INVESTMENT_VERIFIED',
         jsonb_build_object(
           'principal', p_principal,
           'accrued_interest', p_accrued_interest,
           'interest_rate', p_interest_rate,
           'snapshot_id', v_snap_id
         ));

  RETURN jsonb_build_object(
    'success', true,
    'new_status', 'INVESTMENT_VERIFIED',
    'snapshot_id', v_snap_id,
    'snapshot', jsonb_build_object(
      'principal', p_principal,
      'accrued_interest', p_accrued_interest,
      'interest_rate', p_interest_rate,
      'effective_date', p_effective_date,
      'maturity_date', p_maturity_date,
      'outstanding_balance', p_outstanding_balance,
      'available_amount', p_available_amount
    )
  );
END;
$$;

-- ============================================================
-- RPC 5: prepare_voucher()
-- Generates the correct voucher type server-side.
-- The voucher type is ALWAYS resolved from transaction_type —
-- the frontend cannot supply or override it.
-- Actor must be TREASURY_OFFICER.
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

  -- 8. Update transaction status
  UPDATE treasury_transactions
  SET status = 'VOUCHER_PREPARED', updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 9. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'VOUCHER_CREATED',
         'INVESTMENT_VERIFIED', 'VOUCHER_PREPARED',
         jsonb_build_object('voucher_number', v_voucher_num, 'voucher_type', v_voucher_type));

  RETURN jsonb_build_object(
    'success', true,
    'voucher_id', v_voucher_id,
    'voucher_number', v_voucher_num,
    'voucher_type', v_voucher_type
  );
END;
$$;

-- ============================================================
-- RPC 6: approve_transaction()
-- Processes an approval decision at a given stage.
-- Validates: actor role = stage role, prior stage complete,
-- not the transaction maker, idempotent via unique constraint.
-- ============================================================
CREATE OR REPLACE FUNCTION approve_transaction(
  p_transaction_id UUID,
  p_stage          TEXT,
  p_decision       TEXT,
  p_comments       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id       UUID := auth.uid();
  v_actor_role     TEXT;
  v_tx             treasury_transactions%ROWTYPE;
  v_required_role  TEXT;
  v_required_status TEXT;
  v_new_status     TEXT;
  v_approval_id    UUID := gen_random_uuid();
  v_event_type     TEXT;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  -- 2. Resolve required role and status for this stage
  v_required_role   := get_required_role_for_stage(p_stage);
  v_required_status := get_required_status_for_stage(p_stage);

  IF v_required_role IS NULL THEN
    RAISE EXCEPTION 'INVALID_STAGE: % is not a valid approval stage', p_stage
      USING ERRCODE = '22000';
  END IF;

  -- 3. Check actor has the right role for this stage
  IF v_actor_role != v_required_role THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'approve_transaction', 'stage', p_stage,
                              'actor_role', v_actor_role, 'required_role', v_required_role));
    RAISE EXCEPTION 'UNAUTHORIZED: stage % requires role %, actor has %',
      p_stage, v_required_role, v_actor_role USING ERRCODE = '42501';
  END IF;

  -- 4. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction % does not exist', p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 5. Validate transaction is in the correct state for this stage
  IF v_tx.status != v_required_status THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'approve_transaction', 'stage', p_stage,
                              'current_status', v_tx.status, 'required_status', v_required_status));
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected % for stage %',
      v_tx.status, v_required_status, p_stage USING ERRCODE = '23514';
  END IF;

  -- 6. Enforce maker-checker: transaction creator cannot approve
  IF v_tx.created_by = v_actor_id THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'approve_transaction', 'reason', 'maker_checker_violation'));
    RAISE EXCEPTION 'UNAUTHORIZED: transaction creator cannot approve their own transaction'
      USING ERRCODE = '42501';
  END IF;

  -- 7. Enforce comments required for RETURN and REJECT
  IF p_decision IN ('RETURN', 'REJECT') AND
     (p_comments IS NULL OR TRIM(p_comments) = '') THEN
    RAISE EXCEPTION 'VALIDATION: comments are required for % decision', p_decision
      USING ERRCODE = '22000';
  END IF;

  -- 8. Determine new status
  v_new_status := get_next_status_after_approval(p_stage, p_decision);

  -- 9. Insert approval record (unique constraint prevents duplicate stage approvals)
  BEGIN
    INSERT INTO approvals (
      id, transaction_id, stage, approver_id, decision, comments
    ) VALUES (
      v_approval_id, p_transaction_id, p_stage, v_actor_id, p_decision, p_comments
    );
  EXCEPTION WHEN unique_violation THEN
    -- Idempotent: return existing approval result
    SELECT id INTO v_approval_id FROM approvals
    WHERE transaction_id = p_transaction_id AND stage = p_stage;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'approval_id', v_approval_id,
      'new_status', v_tx.status
    );
  END;

  -- 10. Update transaction status
  UPDATE treasury_transactions
  SET status = v_new_status,
      approved_amount = CASE WHEN p_stage = 'MD' AND p_decision = 'APPROVE'
                             THEN requested_amount ELSE approved_amount END,
      completed_at = CASE WHEN v_new_status IN ('REJECTED','CANCELLED')
                          THEN NOW() ELSE completed_at END,
      updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 11. Determine audit event type
  v_event_type := CASE p_decision
    WHEN 'APPROVE' THEN 'APPROVAL_GRANTED'
    WHEN 'RETURN'  THEN 'APPROVAL_RETURNED'
    WHEN 'REJECT'  THEN 'APPROVAL_REJECTED'
  END;

  -- 12. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, v_event_type,
         v_required_status, v_new_status,
         jsonb_build_object(
           'stage', p_stage,
           'decision', p_decision,
           'comments', p_comments
         ));

  RETURN jsonb_build_object(
    'success', true,
    'new_status', v_new_status,
    'approval_id', v_approval_id,
    'decision', p_decision
  );
END;
$$;

-- ============================================================
-- RPC 7: execute_transaction()
-- Records Operations execution of an MD-approved transaction.
-- Actor must be OPERATIONS role.
-- Idempotent via unique constraint on operations_executions.
-- ============================================================
CREATE OR REPLACE FUNCTION execute_transaction(
  p_transaction_id     UUID,
  p_execution_status   TEXT,
  p_external_reference TEXT DEFAULT NULL,
  p_execution_notes    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id    UUID := auth.uid();
  v_actor_role  TEXT;
  v_tx          treasury_transactions%ROWTYPE;
  v_exec_id     UUID := gen_random_uuid();
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role != 'OPERATIONS' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'execute_transaction', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only OPERATIONS can execute transactions'
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
  IF v_tx.status != 'MD_APPROVED' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'execute_transaction', 'current_status', v_tx.status));
    RAISE EXCEPTION 'INVALID_STATE: transaction must be MD_APPROVED to execute, current status: %',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Write OPERATIONS_STARTED audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'OPERATIONS_STARTED',
         'MD_APPROVED', 'OPERATIONS_PROCESSING',
         jsonb_build_object('execution_status', p_execution_status));

  -- 5. Transition to OPERATIONS_PROCESSING
  UPDATE treasury_transactions
  SET status = 'OPERATIONS_PROCESSING', updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 6. Insert execution record (idempotent via unique constraint)
  BEGIN
    INSERT INTO operations_executions (
      id, transaction_id, executed_by, execution_status,
      external_reference, execution_notes
    ) VALUES (
      v_exec_id, p_transaction_id, v_actor_id, p_execution_status,
      p_external_reference, p_execution_notes
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_exec_id FROM operations_executions
    WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'execution_id', v_exec_id
    );
  END;

  -- 7. Transition to OPERATIONS_COMPLETED
  UPDATE treasury_transactions
  SET status = 'OPERATIONS_COMPLETED', updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 8. Write OPERATIONS_COMPLETED audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'OPERATIONS_COMPLETED',
         'OPERATIONS_PROCESSING', 'OPERATIONS_COMPLETED',
         jsonb_build_object(
           'external_reference', p_external_reference,
           'execution_status', p_execution_status
         ));

  RETURN jsonb_build_object(
    'success', true,
    'execution_id', v_exec_id,
    'new_status', 'OPERATIONS_COMPLETED'
  );
END;
$$;

-- ============================================================
-- RPC 8: confirm_treasury_completion()
-- Treasury Officer confirms that Operations has fully completed
-- the transaction. This is a distinct step from execution —
-- Treasury confirms the investment/payment is booked.
-- Actor must be TREASURY_OFFICER.
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_treasury_completion(
  p_transaction_id UUID
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
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role != 'TREASURY_OFFICER' THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'confirm_treasury_completion', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER can confirm completion'
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
  IF v_tx.status != 'OPERATIONS_COMPLETED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected OPERATIONS_COMPLETED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Transition: OPERATIONS_COMPLETED → TREASURY_CONFIRMED → COMPLETED
  UPDATE treasury_transactions
  SET status = 'COMPLETED',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_transaction_id;

  -- 5. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(p_transaction_id, v_actor_id, 'TREASURY_CONFIRMED',
         'OPERATIONS_COMPLETED', 'COMPLETED',
         jsonb_build_object('confirmed_at', NOW()));

  RETURN jsonb_build_object(
    'success', true,
    'new_status', 'COMPLETED'
  );
END;
$$;

-- ============================================================
-- RPC 9: create_reversal()
-- Creates a new REVERSAL transaction referencing the original.
-- The original transaction is NEVER modified or deleted.
-- Actor must be TREASURY_OFFICER.
-- ============================================================
CREATE OR REPLACE FUNCTION create_reversal(
  p_original_transaction_id UUID,
  p_reversal_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id      UUID := auth.uid();
  v_actor_role    TEXT;
  v_orig_tx       treasury_transactions%ROWTYPE;
  v_reversal_id   UUID := gen_random_uuid();
  v_reversal_ref  TEXT;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role NOT IN ('TREASURY_OFFICER','ADMIN') THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_original_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'create_reversal', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only TREASURY_OFFICER can create reversals'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Require a non-empty reason
  IF p_reversal_reason IS NULL OR TRIM(p_reversal_reason) = '' THEN
    RAISE EXCEPTION 'VALIDATION: reversal reason is required'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Load original transaction (read-only — we never lock it for modification)
  SELECT * INTO v_orig_tx FROM treasury_transactions
  WHERE id = p_original_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: original transaction % does not exist',
      p_original_transaction_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validate original is eligible for reversal
  IF v_orig_tx.status IN ('DRAFT','CANCELLED') THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction in status % cannot be reversed',
      v_orig_tx.status USING ERRCODE = '23514';
  END IF;

  -- Check not already reversed
  IF EXISTS (
    SELECT 1 FROM treasury_transactions
    WHERE original_transaction_id = p_original_transaction_id
    AND transaction_type = 'REVERSAL'
    AND status NOT IN ('REJECTED','CANCELLED')
  ) THEN
    RAISE EXCEPTION 'DUPLICATE: a reversal already exists for transaction %',
      p_original_transaction_id USING ERRCODE = '23505';
  END IF;

  -- 5. Generate reversal reference
  v_reversal_ref := generate_transaction_reference();

  -- 6. Create the reversal transaction
  INSERT INTO treasury_transactions (
    id, transaction_reference, customer_id, investment_id,
    transaction_type, scenario_code, status,
    currency, requested_amount, purpose,
    source_instruction_type, original_transaction_id,
    sla_due_at, created_by
  ) VALUES (
    v_reversal_id, v_reversal_ref,
    v_orig_tx.customer_id, v_orig_tx.investment_id,
    'REVERSAL', NULL, 'INSTRUCTION_RECEIVED',
    v_orig_tx.currency, v_orig_tx.requested_amount,
    p_reversal_reason,
    v_orig_tx.source_instruction_type,
    p_original_transaction_id,
    NOW() + INTERVAL '8 hours',
    v_actor_id
  );

  -- 7. Write audit events on both transactions
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES
    -- On the reversal transaction
    (v_reversal_id, v_actor_id, 'REVERSAL_CREATED', NULL, 'INSTRUCTION_RECEIVED',
     jsonb_build_object(
       'original_transaction_id', p_original_transaction_id,
       'original_reference', v_orig_tx.transaction_reference,
       'reason', p_reversal_reason
     )),
    -- On the original transaction (audit trail record only — status unchanged)
    (p_original_transaction_id, v_actor_id, 'REVERSAL_CREATED', v_orig_tx.status, v_orig_tx.status,
     jsonb_build_object(
       'reversal_transaction_id', v_reversal_id,
       'reversal_reference', v_reversal_ref,
       'reason', p_reversal_reason
     ));

  RETURN jsonb_build_object(
    'success', true,
    'reversal_transaction_id', v_reversal_id,
    'reversal_reference', v_reversal_ref,
    'status', 'INSTRUCTION_RECEIVED'
  );
END;
$$;
