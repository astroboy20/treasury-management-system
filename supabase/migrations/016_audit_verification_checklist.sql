-- ============================================================
-- Migration 016: Audit Verification Checklist
-- ============================================================
-- Adds a separate verification checklist performed by the Audit
-- Officer during the AUDIT stage of the approval chain.
-- The Audit Officer must complete this checklist before they can
-- approve/recall/reject the transaction.
--
-- The Treasury Officer's checklist (signature_verifications) is
-- unchanged. Both records are preserved for audit purposes,
-- including the performer's name and timestamp.
-- ============================================================

-- ============================================================
-- TABLE: audit_verifications
-- One-to-one with treasury_transactions (only one per transaction
-- since the approval chain is sequential — AUDIT stage is unique).
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_verifications (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id           UUID NOT NULL UNIQUE
                             REFERENCES treasury_transactions(id) ON DELETE CASCADE,
  verified_by              UUID NOT NULL REFERENCES profiles(id),
  signature_result         TEXT NOT NULL CHECK (signature_result IN ('PASSED','FAILED')),
  mandate_result           TEXT NOT NULL CHECK (mandate_result IN ('PASSED','FAILED')),
  account_ownership_result TEXT NOT NULL CHECK (account_ownership_result IN ('PASSED','FAILED')),
  completeness_result      TEXT NOT NULL CHECK (completeness_result IN ('PASSED','FAILED')),
  notes                    TEXT,
  verified_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_verifications_tx
  ON audit_verifications(transaction_id);

-- ============================================================
-- RLS: Same pattern as signature_verifications — roles that can
-- read transactions can read audit_verifications.
-- ============================================================
ALTER TABLE audit_verifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users with any treasury role to read
CREATE POLICY "audit_verifications_read" ON audit_verifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.code IN (
          'TREASURY_OFFICER','ACCOUNT_OFFICER','HEAD_TREASURY',
          'MIS','AUDIT','MD','OPERATIONS','ADMIN'
        )
    )
  );

-- Only AUDIT role (and ADMIN) can insert — enforced by RPC too
CREATE POLICY "audit_verifications_insert" ON audit_verifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND r.code IN ('AUDIT','ADMIN')
    )
  );

-- ============================================================
-- RPC: record_audit_verification()
-- Records the Audit Officer's independent verification checklist.
-- Must be called before approve_transaction('AUDIT', ...).
-- Actor must be AUDIT (or ADMIN).
-- Transaction must be in MIS_APPROVED status.
-- Idempotent: re-submitting replaces the existing record.
-- ============================================================
CREATE OR REPLACE FUNCTION record_audit_verification(
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
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = v_actor_id;

  IF v_actor_role NOT IN ('AUDIT', 'ADMIN') THEN
    INSERT INTO audit_events(transaction_id, actor_id, event_type, metadata)
    VALUES(p_transaction_id, v_actor_id, 'UNAUTHORIZED_ATTEMPT',
           jsonb_build_object('action', 'record_audit_verification', 'role', v_actor_role));
    RAISE EXCEPTION 'UNAUTHORIZED: only AUDIT can record audit verifications'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
  WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction % does not exist', p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Validate state — transaction must be at MIS_APPROVED (AUDIT stage active)
  IF v_tx.status != 'MIS_APPROVED' THEN
    RAISE EXCEPTION 'INVALID_STATE: transaction is in status %, expected MIS_APPROVED',
      v_tx.status USING ERRCODE = '23514';
  END IF;

  -- 4. Upsert verification record (idempotent — audit officer may re-check)
  INSERT INTO audit_verifications (
    transaction_id, verified_by,
    signature_result, mandate_result,
    account_ownership_result, completeness_result, notes
  ) VALUES (
    p_transaction_id, v_actor_id,
    p_signature_result, p_mandate_result,
    p_account_ownership_result, p_completeness_result, p_notes
  )
  ON CONFLICT (transaction_id) DO UPDATE SET
    verified_by              = EXCLUDED.verified_by,
    signature_result         = EXCLUDED.signature_result,
    mandate_result           = EXCLUDED.mandate_result,
    account_ownership_result = EXCLUDED.account_ownership_result,
    completeness_result      = EXCLUDED.completeness_result,
    notes                    = EXCLUDED.notes,
    verified_at              = NOW();

  -- 5. Write audit event
  INSERT INTO audit_events(transaction_id, actor_id, event_type, from_status, to_status, metadata)
  VALUES(
    p_transaction_id, v_actor_id, 'AUDIT_VERIFICATION_RECORDED',
    v_tx.status, v_tx.status,
    jsonb_build_object(
      'signature_result',         p_signature_result,
      'mandate_result',           p_mandate_result,
      'account_ownership_result', p_account_ownership_result,
      'completeness_result',      p_completeness_result
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Audit verification recorded'
  );
END;
$$;
