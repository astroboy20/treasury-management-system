-- ============================================================
-- Migration 014: Restore Full 5-Stage Approval Chain
-- ============================================================
-- Restores the TREASURY checker stage so the full chain is:
--   Treasury Officer (checker) → Head Treasury → MIS → Audit → MD
--
-- The Treasury Officer who CREATED the transaction cannot approve
-- at the TREASURY stage (maker-checker enforced by the RPC).
-- A different Treasury Officer must sign off first.
--
-- Also restores get_required_status_for_stage() and
-- get_next_action_role() to reflect the full chain.
-- ============================================================

-- 1. Restore get_required_status_for_stage() with all 5 stages
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

-- 2. Restore get_next_action_role() with VOUCHER_PREPARED → TREASURY_OFFICER
CREATE OR REPLACE FUNCTION get_next_action_role(p_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_status
    WHEN 'INSTRUCTION_RECEIVED'     THEN 'TREASURY_OFFICER'
    WHEN 'SIGNATURE_VERIFIED'       THEN 'TREASURY_OFFICER'
    WHEN 'CUSTOMER_CONFIRMED'       THEN 'TREASURY_OFFICER'
    WHEN 'INVESTMENT_VERIFIED'      THEN 'TREASURY_OFFICER'
    WHEN 'VOUCHER_PREPARED'         THEN 'TREASURY_OFFICER'  -- checker signs
    WHEN 'TREASURY_APPROVED'        THEN 'HEAD_TREASURY'
    WHEN 'HEAD_TREASURY_APPROVED'   THEN 'MIS'
    WHEN 'MIS_APPROVED'             THEN 'AUDIT'
    WHEN 'AUDIT_APPROVED'           THEN 'MD'
    WHEN 'MD_APPROVED'              THEN 'OPERATIONS'
    WHEN 'OPERATIONS_COMPLETED'     THEN 'TREASURY_OFFICER'
    ELSE NULL
  END;
END;
$$;
