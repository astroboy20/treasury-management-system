-- ============================================================
-- Migration 006: Calculation RPC Functions — Greenline Treasury Platform
--
-- All financial calculations run server-side inside PostgreSQL using
-- the NUMERIC type. JavaScript floating-point is NEVER the authoritative
-- result for any monetary computation.
--
-- Each function returns a JSONB calculation_snapshot conforming to:
--   { rule, inputs, outputs, calculated_at }
--
-- These functions are called from lib/services/calculation.service.ts
-- (server-side only) — never from browser components.
-- ============================================================

-- ============================================================
-- RPC: calculate_pre_liquidation(accrued_interest, requested_payout?)
--
-- Full pre-liquidation:
--   charge       = accrued_interest × 0.20
--   net_interest = accrued_interest − charge
--
-- Partial pre-liquidation adds:
--   remaining_principal  = original_principal − requested_payout
--   rebooked_principal   = remaining_principal − charge
--
-- SOP canonical example (Req 26.6):
--   accrued_interest ₦1,500,000 → charge ₦300,000 → net_interest ₦1,200,000
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_pre_liquidation(
  p_accrued_interest  NUMERIC,
  p_original_principal NUMERIC DEFAULT NULL,
  p_requested_payout  NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge_rate        NUMERIC := 0.20;
  v_charge             NUMERIC;
  v_net_interest       NUMERIC;
  v_remaining_principal NUMERIC;
  v_rebooked_principal  NUMERIC;
  v_outputs            JSONB;
  v_inputs             JSONB;
BEGIN
  -- Validate inputs
  IF p_accrued_interest IS NULL OR p_accrued_interest < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: accrued_interest must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;

  -- Core calculation: 20% charge on accrued interest (Req 19.1, 26.6)
  v_charge       := ROUND(p_accrued_interest * v_charge_rate, 4);
  v_net_interest := p_accrued_interest - v_charge;

  -- Build outputs JSONB
  v_outputs := jsonb_build_object(
    'charge',       v_charge::TEXT,
    'net_interest', v_net_interest::TEXT
  );

  -- Build inputs JSONB
  v_inputs := jsonb_build_object(
    'accrued_interest', p_accrued_interest::TEXT,
    'charge_rate',      v_charge_rate::TEXT
  );

  -- Partial pre-liquidation path (Req 19.2)
  IF p_original_principal IS NOT NULL AND p_requested_payout IS NOT NULL THEN
    IF p_requested_payout < 0 OR p_requested_payout > p_original_principal THEN
      RAISE EXCEPTION 'INVALID_INPUT: requested_payout must be between 0 and original_principal'
        USING ERRCODE = '22000';
    END IF;

    v_remaining_principal := p_original_principal - p_requested_payout;
    v_rebooked_principal  := v_remaining_principal - v_charge;

    v_inputs := v_inputs
      || jsonb_build_object(
           'original_principal', p_original_principal::TEXT,
           'requested_payout',   p_requested_payout::TEXT
         );

    v_outputs := v_outputs
      || jsonb_build_object(
           'remaining_principal', v_remaining_principal::TEXT,
           'rebooked_principal',  v_rebooked_principal::TEXT
         );
  END IF;

  RETURN jsonb_build_object(
    'rule',          'PRE_LIQUIDATION_20_PERCENT',
    'inputs',        v_inputs,
    'outputs',       v_outputs,
    'calculated_at', NOW()::TEXT
  );
END;
$$;

-- ============================================================
-- RPC: calculate_rollover(type, principal, interest_due, requested_payout?)
--
-- P_AND_I:
--   rollover_amount = principal + interest_due
--
-- PRINCIPAL_ONLY:
--   principal_rolled = principal
--   interest_paid    = interest_due
--   rollover_amount  = principal
--
-- PARTIAL_PRINCIPAL:
--   remaining_principal = principal − requested_payout
--   rollover_amount     = remaining_principal
--   interest_paid       = interest_due  (paid out via linked FUNDS_OUT)
--
-- INTEREST_ONLY:
--   rollover_amount = principal   (principal stays invested)
--   interest_paid   = interest_due
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_rollover(
  p_rollover_type    TEXT,
  p_principal        NUMERIC,
  p_interest_due     NUMERIC,
  p_requested_payout NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollover_amount   NUMERIC;
  v_interest_paid     NUMERIC;
  v_principal_rolled  NUMERIC;
  v_remaining_principal NUMERIC;
  v_outputs           JSONB;
  v_inputs            JSONB;
  v_rule              TEXT;
BEGIN
  -- Validate inputs
  IF p_principal IS NULL OR p_principal < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: principal must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;
  IF p_interest_due IS NULL OR p_interest_due < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: interest_due must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;
  IF p_rollover_type NOT IN ('P_AND_I', 'PRINCIPAL_ONLY', 'PARTIAL_PRINCIPAL', 'INTEREST_ONLY') THEN
    RAISE EXCEPTION 'INVALID_INPUT: rollover_type must be P_AND_I, PRINCIPAL_ONLY, PARTIAL_PRINCIPAL, or INTEREST_ONLY'
      USING ERRCODE = '22000';
  END IF;

  v_inputs := jsonb_build_object(
    'rollover_type', p_rollover_type,
    'principal',     p_principal::TEXT,
    'interest_due',  p_interest_due::TEXT
  );

  -- Resolve rule name
  v_rule := CASE p_rollover_type
    WHEN 'P_AND_I'           THEN 'ROLLOVER_P_AND_I'
    WHEN 'PRINCIPAL_ONLY'    THEN 'ROLLOVER_PRINCIPAL_ONLY'
    WHEN 'PARTIAL_PRINCIPAL' THEN 'ROLLOVER_PARTIAL_PRINCIPAL'
    WHEN 'INTEREST_ONLY'     THEN 'ROLLOVER_INTEREST_ONLY'
  END;

  CASE p_rollover_type
    WHEN 'P_AND_I' THEN
      -- Full principal + interest rolled (Req 17.2)
      v_rollover_amount  := ROUND(p_principal + p_interest_due, 4);
      v_outputs := jsonb_build_object(
        'rollover_amount', v_rollover_amount::TEXT
      );

    WHEN 'PRINCIPAL_ONLY' THEN
      -- Principal rolls; interest paid out (Req 17.3)
      v_principal_rolled := ROUND(p_principal, 4);
      v_interest_paid    := ROUND(p_interest_due, 4);
      v_rollover_amount  := v_principal_rolled;
      v_outputs := jsonb_build_object(
        'rollover_amount',  v_rollover_amount::TEXT,
        'principal_rolled', v_principal_rolled::TEXT,
        'interest_paid',    v_interest_paid::TEXT
      );

    WHEN 'PARTIAL_PRINCIPAL' THEN
      -- Part of principal paid out; remainder + interest rolled (Req 17.4)
      IF p_requested_payout IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: requested_payout is required for PARTIAL_PRINCIPAL rollover'
          USING ERRCODE = '22000';
      END IF;
      IF p_requested_payout < 0 OR p_requested_payout > p_principal THEN
        RAISE EXCEPTION 'INVALID_INPUT: requested_payout must be between 0 and principal'
          USING ERRCODE = '22000';
      END IF;

      v_remaining_principal := ROUND(p_principal - p_requested_payout, 4);
      v_rollover_amount     := v_remaining_principal;
      v_interest_paid       := ROUND(p_interest_due, 4);

      v_inputs := v_inputs
        || jsonb_build_object('requested_payout', p_requested_payout::TEXT);

      v_outputs := jsonb_build_object(
        'rollover_amount',      v_rollover_amount::TEXT,
        'remaining_principal',  v_remaining_principal::TEXT,
        'interest_paid',        v_interest_paid::TEXT
      );

    WHEN 'INTEREST_ONLY' THEN
      -- Principal stays; only interest paid out (Req 17.5)
      v_rollover_amount := ROUND(p_principal, 4);
      v_interest_paid   := ROUND(p_interest_due, 4);
      v_outputs := jsonb_build_object(
        'rollover_amount', v_rollover_amount::TEXT,
        'interest_paid',   v_interest_paid::TEXT
      );

  END CASE;

  RETURN jsonb_build_object(
    'rule',          v_rule,
    'inputs',        v_inputs,
    'outputs',       v_outputs,
    'calculated_at', NOW()::TEXT
  );
END;
$$;

-- ============================================================
-- RPC: calculate_third_party_charge(transfer_amount, is_internal)
--
-- External: transfer_charge = transfer_amount × 0.001 (0.10%)
-- Internal: transfer_charge = 0
--
-- net_amount = transfer_amount (charge is borne by sender, not deducted here)
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_third_party_charge(
  p_transfer_amount NUMERIC,
  p_is_internal     BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_charge_rate    NUMERIC := 0.001;
  v_transfer_charge NUMERIC;
  v_net_amount      NUMERIC;
  v_rule            TEXT;
BEGIN
  -- Validate inputs
  IF p_transfer_amount IS NULL OR p_transfer_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: transfer_amount must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;
  IF p_is_internal IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT: is_internal must be true or false'
      USING ERRCODE = '22000';
  END IF;

  IF p_is_internal THEN
    -- Internal transfer: no charge (Req 21.3)
    v_transfer_charge := 0;
    v_rule            := 'THIRD_PARTY_TRANSFER_0_10_PERCENT'; -- rule recorded; charge is 0
  ELSE
    -- External transfer: 0.10% charge (Req 21.2)
    v_transfer_charge := ROUND(p_transfer_amount * v_charge_rate, 4);
    v_rule            := 'THIRD_PARTY_TRANSFER_0_10_PERCENT';
  END IF;

  v_net_amount := ROUND(p_transfer_amount, 4);

  RETURN jsonb_build_object(
    'rule',   v_rule,
    'inputs', jsonb_build_object(
      'transfer_amount', p_transfer_amount::TEXT,
      'is_internal',     p_is_internal::TEXT,
      'charge_rate',     CASE WHEN p_is_internal THEN '0' ELSE v_charge_rate::TEXT END
    ),
    'outputs', jsonb_build_object(
      'transfer_charge', v_transfer_charge::TEXT,
      'net_amount',      v_net_amount::TEXT
    ),
    'calculated_at', NOW()::TEXT
  );
END;
$$;

-- ============================================================
-- RPC: calculate_anniversary_payment(principal, interest_rate, frequency_days)
--
-- interest_due = principal × interest_rate × (frequency_days / 365)
--
-- frequency_days must be exactly 30, 60, or 90 (Req 20.1).
-- WHT defaults to 0 per SOP.
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_anniversary_payment(
  p_principal       NUMERIC,
  p_interest_rate   NUMERIC,  -- decimal, e.g. 0.125 for 12.5%
  p_frequency_days  INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interest_due NUMERIC;
BEGIN
  -- Validate inputs
  IF p_principal IS NULL OR p_principal < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: principal must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;
  IF p_interest_rate IS NULL OR p_interest_rate < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: interest_rate must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;
  IF p_frequency_days NOT IN (30, 60, 90) THEN
    RAISE EXCEPTION 'INVALID_INPUT: frequency_days must be exactly 30, 60, or 90'
      USING ERRCODE = '22000';
  END IF;

  -- Calculate interest due for the period (Req 20.2)
  v_interest_due := ROUND(
    p_principal * p_interest_rate * (p_frequency_days::NUMERIC / 365),
    4
  );

  RETURN jsonb_build_object(
    'rule',   'ANNIVERSARY_PAYMENT',
    'inputs', jsonb_build_object(
      'principal',       p_principal::TEXT,
      'interest_rate',   p_interest_rate::TEXT,
      'frequency_days',  p_frequency_days::TEXT
    ),
    'outputs', jsonb_build_object(
      'interest_due', v_interest_due::TEXT,
      'wht',          '0'               -- WHT = 0 per SOP (Req 20.3)
    ),
    'calculated_at', NOW()::TEXT
  );
END;
$$;

-- ============================================================
-- RPC: calculate_maturity_termination(principal, accrued_interest)
--
-- net_amount = principal + accrued_interest
-- WHT        = 0 (per SOP for maturity termination, Req 11.3)
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_maturity_termination(
  p_principal        NUMERIC,
  p_accrued_interest NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net_amount NUMERIC;
BEGIN
  -- Validate inputs
  IF p_principal IS NULL OR p_principal < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: principal must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;
  IF p_accrued_interest IS NULL OR p_accrued_interest < 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT: accrued_interest must be a non-negative number'
      USING ERRCODE = '22000';
  END IF;

  v_net_amount := ROUND(p_principal + p_accrued_interest, 4);

  RETURN jsonb_build_object(
    'rule',   'MATURITY_TERMINATION',
    'inputs', jsonb_build_object(
      'principal',        p_principal::TEXT,
      'accrued_interest', p_accrued_interest::TEXT,
      'wht',              '0'            -- WHT defaulted to 0 per SOP
    ),
    'outputs', jsonb_build_object(
      'net_amount', v_net_amount::TEXT,
      'wht',        '0'
    ),
    'calculated_at', NOW()::TEXT
  );
END;
$$;
