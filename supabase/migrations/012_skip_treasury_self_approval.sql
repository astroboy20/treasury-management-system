-- ============================================================
-- Migration 012: Skip Treasury Self-Approval Stage
-- ============================================================
-- The TREASURY approval stage was a self-approval by the Treasury
-- Officer (the same person who created the instruction). This is
-- removed from the approval chain. HEAD_TREASURY now acts first,
-- directly after VOUCHER_PREPARED.
--
-- Changes:
--   1. get_required_status_for_stage() — HEAD_TREASURY now requires
--      VOUCHER_PREPARED instead of TREASURY_APPROVED.
--   2. get_next_status_after_approval() — no change needed for status
--      transitions (TREASURY case can remain for backward compat but
--      is no longer reachable from the UI or server action).
--   3. get_next_action_role() trigger helper — VOUCHER_PREPARED now
--      routes to HEAD_TREASURY instead of TREASURY_OFFICER.
-- ============================================================

-- 1. Update get_required_status_for_stage()
--    HEAD_TREASURY now activates directly after VOUCHER_PREPARED.
CREATE OR REPLACE FUNCTION get_required_status_for_stage(p_stage TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_stage
    WHEN 'HEAD_TREASURY'  THEN 'VOUCHER_PREPARED'
    WHEN 'MIS'            THEN 'HEAD_TREASURY_APPROVED'
    WHEN 'AUDIT'          THEN 'MIS_APPROVED'
    WHEN 'MD'             THEN 'AUDIT_APPROVED'
    -- TREASURY kept for backward compat but no longer used in the chain
    WHEN 'TREASURY'       THEN 'VOUCHER_PREPARED'
    ELSE NULL
  END;
END;
$$;

-- 2. Update get_next_action_role() so the trigger-based notification and
--    STATUS_TO_OWNER map correctly point VOUCHER_PREPARED → HEAD_TREASURY.
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
    WHEN 'VOUCHER_PREPARED'         THEN 'HEAD_TREASURY'
    WHEN 'TREASURY_APPROVED'        THEN 'HEAD_TREASURY'   -- legacy fallback
    WHEN 'HEAD_TREASURY_APPROVED'   THEN 'MIS'
    WHEN 'MIS_APPROVED'             THEN 'AUDIT'
    WHEN 'AUDIT_APPROVED'           THEN 'MD'
    WHEN 'MD_APPROVED'              THEN 'OPERATIONS'
    WHEN 'OPERATIONS_COMPLETED'     THEN 'TREASURY_OFFICER'
    ELSE NULL
  END;
END;
$$;
