-- ============================================================
-- Migration 011: Support multiple payment instructions per transaction
--
-- Previously payment_instructions had a UNIQUE constraint on transaction_id
-- (one-to-one). This migration drops that constraint so a single transaction
-- can have multiple beneficiary/account destinations.
--
-- The RPC create_treasury_transaction is updated to accept a JSONB array
-- (p_payment_instructions) instead of a single object. A backward-compatible
-- fallback also handles the old single-object shape.
-- ============================================================

-- 1. Drop the UNIQUE constraint that enforced one-to-one
ALTER TABLE payment_instructions
  DROP CONSTRAINT IF EXISTS payment_instructions_transaction_id_key;

-- 2. Add a sort_order column so UI can preserve entry order
ALTER TABLE payment_instructions
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- 3. Replace the RPC to accept an array of payment instructions
CREATE OR REPLACE FUNCTION create_treasury_transaction(
  p_customer_id            UUID,
  p_investment_id          UUID              DEFAULT NULL,
  p_transaction_type       TEXT              DEFAULT NULL,
  p_scenario_code          TEXT              DEFAULT NULL,
  p_requested_amount       NUMERIC           DEFAULT NULL,
  p_purpose                TEXT              DEFAULT NULL,
  p_source_type            TEXT              DEFAULT NULL,
  -- New: array of payment instruction objects
  p_payment_instructions   JSONB             DEFAULT NULL,
  -- Legacy single-object param kept for backward compatibility
  p_payment_instruction    JSONB             DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id     UUID := auth.uid();
  v_actor_role   TEXT;
  v_tx_id        UUID := gen_random_uuid();
  v_ref          TEXT;
  v_sla_hours    INTEGER := 8;
  v_sla_due_at   TIMESTAMPTZ;
  v_instr        JSONB;
  v_idx          INTEGER := 0;
  v_instructions JSONB;
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

  -- 2. Validate required fields
  IF p_transaction_type IS NULL OR p_requested_amount IS NULL OR
     p_purpose IS NULL OR p_source_type IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: required fields missing'
      USING ERRCODE = '22000';
  END IF;

  -- 3. Generate unique reference
  v_ref := generate_transaction_reference();

  -- 4. Compute SLA deadline
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

  -- 6. Normalise instructions: prefer array param, fall back to legacy single object
  IF p_payment_instructions IS NOT NULL AND jsonb_typeof(p_payment_instructions) = 'array' THEN
    v_instructions := p_payment_instructions;
  ELSIF p_payment_instruction IS NOT NULL THEN
    -- Wrap legacy single object in an array for unified handling
    v_instructions := jsonb_build_array(p_payment_instruction);
  ELSE
    v_instructions := NULL;
  END IF;

  -- 7. Insert each payment instruction row
  IF v_instructions IS NOT NULL THEN
    FOR v_instr IN SELECT * FROM jsonb_array_elements(v_instructions)
    LOOP
      INSERT INTO payment_instructions (
        transaction_id, beneficiary_name, bank_name, account_number,
        account_type, amount, transfer_charge, purpose, is_internal, sort_order
      ) VALUES (
        v_tx_id,
        v_instr->>'beneficiary_name',
        v_instr->>'bank_name',
        v_instr->>'account_number',
        v_instr->>'account_type',
        (v_instr->>'amount')::NUMERIC,
        COALESCE((v_instr->>'transfer_charge')::NUMERIC, 0),
        v_instr->>'purpose',
        COALESCE((v_instr->>'is_internal')::BOOLEAN, false),
        v_idx
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- 8. Write audit event
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
