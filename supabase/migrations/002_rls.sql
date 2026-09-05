-- ============================================================
-- Migration 002: Row Level Security — Greenline Treasury Platform
-- ============================================================
-- RLS is the primary security boundary. Every table that holds
-- financial or customer data has policies enforced here.
-- The frontend may hide UI elements, but the database always
-- independently enforces access regardless of what the app sends.
-- ============================================================

-- ============================================================
-- HELPER FUNCTION: get_user_role()
-- Returns the role code for the currently authenticated user.
-- SECURITY DEFINER so it runs with elevated privileges regardless
-- of the calling user's grants. Cached as STABLE for performance.
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.code
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
  LIMIT 1;
$$;

-- ============================================================
-- HELPER FUNCTION: is_staff_role()
-- Returns TRUE if the current user holds any treasury staff role.
-- ============================================================
CREATE OR REPLACE FUNCTION is_staff_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_user_role() IN (
    'ACCOUNT_OFFICER','TREASURY_OFFICER','HEAD_TREASURY',
    'MIS','AUDIT','MD','OPERATIONS','ADMIN'
  );
$$;

-- ============================================================
-- HELPER FUNCTION: can_view_transaction(tx_id UUID)
-- Returns TRUE if the current user's role permits reading the
-- given transaction. Used in policies on child tables.
-- ============================================================
CREATE OR REPLACE FUNCTION can_view_transaction(tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM treasury_transactions t
    WHERE t.id = tx_id
    AND (
      -- Full treasury/approver chain sees everything
      get_user_role() IN ('TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN')
      -- Account Officers see transactions they confirmed
      OR (
        get_user_role() = 'ACCOUNT_OFFICER'
        AND EXISTS (
          SELECT 1 FROM customer_confirmations cc
          WHERE cc.transaction_id = t.id
          AND cc.confirmed_by = auth.uid()
        )
      )
      -- Operations sees MD-approved and beyond
      OR (
        get_user_role() = 'OPERATIONS'
        AND t.status IN (
          'MD_APPROVED','OPERATIONS_PROCESSING','OPERATIONS_COMPLETED',
          'TREASURY_CONFIRMED','COMPLETED'
        )
      )
    )
  );
$$;

-- ============================================================
-- Enable RLS on every table
-- ============================================================
ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_instructions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_verifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_confirmations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_verifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollover_details          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_liquidation_details   ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_executions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_config                ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: profiles
-- ============================================================
-- Own row SELECT + ADMIN reads all
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT
  USING (id = auth.uid() OR get_user_role() = 'ADMIN');

-- Own row UPDATE only
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT handled exclusively by the handle_new_user trigger (migration 004)
-- No direct INSERT policy for authenticated role

-- ============================================================
-- TABLE: roles
-- ============================================================
-- Any authenticated user may read roles (needed for UI role labels)
CREATE POLICY "roles_select_authenticated" ON roles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only ADMIN may modify roles
CREATE POLICY "roles_insert_admin" ON roles
  FOR INSERT
  WITH CHECK (get_user_role() = 'ADMIN');

CREATE POLICY "roles_update_admin" ON roles
  FOR UPDATE
  USING (get_user_role() = 'ADMIN');

CREATE POLICY "roles_delete_admin" ON roles
  FOR DELETE
  USING (get_user_role() = 'ADMIN');

-- ============================================================
-- TABLE: user_roles
-- ============================================================
-- Users see their own role assignments; ADMIN sees all
CREATE POLICY "user_roles_select" ON user_roles
  FOR SELECT
  USING (user_id = auth.uid() OR get_user_role() = 'ADMIN');

-- Only ADMIN may assign or revoke roles
CREATE POLICY "user_roles_insert_admin" ON user_roles
  FOR INSERT
  WITH CHECK (get_user_role() = 'ADMIN');

CREATE POLICY "user_roles_delete_admin" ON user_roles
  FOR DELETE
  USING (get_user_role() = 'ADMIN');

-- ============================================================
-- TABLE: customers
-- ============================================================
-- All staff roles can read customers
CREATE POLICY "customers_select_staff" ON customers
  FOR SELECT
  USING (is_staff_role());

-- Treasury Officer and ADMIN can create/update customer records
CREATE POLICY "customers_insert_treasury_admin" ON customers
  FOR INSERT
  WITH CHECK (get_user_role() IN ('TREASURY_OFFICER','ADMIN'));

CREATE POLICY "customers_update_treasury_admin" ON customers
  FOR UPDATE
  USING (get_user_role() IN ('TREASURY_OFFICER','ADMIN'));

-- Only ADMIN can delete customer records
CREATE POLICY "customers_delete_admin" ON customers
  FOR DELETE
  USING (get_user_role() = 'ADMIN');

-- ============================================================
-- TABLE: customer_accounts
-- ============================================================
CREATE POLICY "customer_accounts_select_staff" ON customer_accounts
  FOR SELECT
  USING (is_staff_role());

CREATE POLICY "customer_accounts_insert_treasury_ops_admin" ON customer_accounts
  FOR INSERT
  WITH CHECK (get_user_role() IN ('TREASURY_OFFICER','OPERATIONS','ADMIN'));

CREATE POLICY "customer_accounts_update_treasury_ops_admin" ON customer_accounts
  FOR UPDATE
  USING (get_user_role() IN ('TREASURY_OFFICER','OPERATIONS','ADMIN'));

CREATE POLICY "customer_accounts_delete_admin" ON customer_accounts
  FOR DELETE
  USING (get_user_role() = 'ADMIN');

-- ============================================================
-- TABLE: investments
-- ============================================================
CREATE POLICY "investments_select_staff" ON investments
  FOR SELECT
  USING (is_staff_role());

CREATE POLICY "investments_insert_treasury_ops_admin" ON investments
  FOR INSERT
  WITH CHECK (get_user_role() IN ('TREASURY_OFFICER','OPERATIONS','ADMIN'));

CREATE POLICY "investments_update_treasury_ops_admin" ON investments
  FOR UPDATE
  USING (get_user_role() IN ('TREASURY_OFFICER','OPERATIONS','ADMIN'));

CREATE POLICY "investments_delete_admin" ON investments
  FOR DELETE
  USING (get_user_role() = 'ADMIN');

-- ============================================================
-- TABLE: treasury_transactions
-- Role-scoped SELECT — each role sees only what they are
-- permitted to see per the SOP workflow design.
-- INSERT/UPDATE/DELETE are locked out for direct client use;
-- all mutations go through PostgreSQL RPC functions.
-- ============================================================
CREATE POLICY "tt_select_treasury_approvers_admin" ON treasury_transactions
  FOR SELECT
  USING (
    get_user_role() IN ('TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN')
  );

-- Account Officers see transactions they have confirmed
CREATE POLICY "tt_select_account_officer" ON treasury_transactions
  FOR SELECT
  USING (
    get_user_role() = 'ACCOUNT_OFFICER'
    AND EXISTS (
      SELECT 1 FROM customer_confirmations cc
      WHERE cc.transaction_id = id
      AND cc.confirmed_by = auth.uid()
    )
  );

-- Account Officers also see transactions awaiting their confirmation
-- (status = SIGNATURE_VERIFIED means the ball is in Account Officer's court)
CREATE POLICY "tt_select_account_officer_pending" ON treasury_transactions
  FOR SELECT
  USING (
    get_user_role() = 'ACCOUNT_OFFICER'
    AND status = 'SIGNATURE_VERIFIED'
  );

-- Operations sees MD-approved and execution-stage transactions
CREATE POLICY "tt_select_operations" ON treasury_transactions
  FOR SELECT
  USING (
    get_user_role() = 'OPERATIONS'
    AND status IN (
      'MD_APPROVED','OPERATIONS_PROCESSING','OPERATIONS_COMPLETED',
      'TREASURY_CONFIRMED','COMPLETED'
    )
  );

-- Direct INSERT/UPDATE/DELETE from authenticated role are DENIED.
-- Mutations happen exclusively through RPC functions (SECURITY DEFINER).
-- No INSERT, UPDATE, or DELETE policies are defined for authenticated users.

-- ============================================================
-- TABLE: payment_instructions
-- ============================================================
CREATE POLICY "payment_instructions_select" ON payment_instructions
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','OPERATIONS','ADMIN'
    )
    OR (
      get_user_role() = 'ACCOUNT_OFFICER'
      AND can_view_transaction(transaction_id)
    )
  );

-- INSERT/UPDATE via RPC only — no direct policy for authenticated

-- ============================================================
-- TABLE: signature_verifications
-- ============================================================
CREATE POLICY "sig_verifications_select" ON signature_verifications
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','OPERATIONS','ADMIN'
    )
    OR (
      get_user_role() = 'ACCOUNT_OFFICER'
      AND can_view_transaction(transaction_id)
    )
  );

-- INSERT/UPDATE/DELETE via RPC only

-- ============================================================
-- TABLE: customer_confirmations
-- ============================================================
CREATE POLICY "customer_confirmations_select" ON customer_confirmations
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','OPERATIONS','ADMIN'
    )
    OR (
      get_user_role() = 'ACCOUNT_OFFICER'
      AND confirmed_by = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE via RPC only

-- ============================================================
-- TABLE: investment_verifications
-- ============================================================
CREATE POLICY "investment_verifications_select" ON investment_verifications
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','OPERATIONS','ADMIN'
    )
  );

-- INSERT/UPDATE/DELETE via RPC only

-- ============================================================
-- TABLE: vouchers
-- ============================================================
CREATE POLICY "vouchers_select" ON vouchers
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','OPERATIONS','ADMIN'
    )
  );

-- No direct INSERT/UPDATE/DELETE for authenticated role:
-- All mutations via prepare_voucher() RPC.
-- Vouchers with status = 'FINALISED' cannot be updated even via RPC.

-- ============================================================
-- TABLE: rollover_details
-- ============================================================
CREATE POLICY "rollover_details_select" ON rollover_details
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN'
    )
  );

-- ============================================================
-- TABLE: pre_liquidation_details
-- ============================================================
CREATE POLICY "pre_liquidation_details_select" ON pre_liquidation_details
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN'
    )
  );

-- ============================================================
-- TABLE: approvals
-- ============================================================
-- Any role that can view the transaction can read its approvals
CREATE POLICY "approvals_select" ON approvals
  FOR SELECT
  USING (can_view_transaction(transaction_id));

-- Direct INSERT/UPDATE/DELETE DENIED for all authenticated users.
-- Approval records are created exclusively by the approve_transaction() RPC.

-- ============================================================
-- TABLE: operations_executions
-- ============================================================
CREATE POLICY "ops_executions_select" ON operations_executions
  FOR SELECT
  USING (
    get_user_role() IN ('OPERATIONS','TREASURY_OFFICER','ADMIN')
  );

-- INSERT via execute_transaction() RPC only

-- ============================================================
-- TABLE: audit_events
-- CRITICAL: UPDATE and DELETE are REVOKED from all roles.
-- This table is append-only — correction requires a new event.
-- ============================================================

-- AUDIT and ADMIN see all audit events
CREATE POLICY "audit_events_select_admin_audit" ON audit_events
  FOR SELECT
  USING (get_user_role() IN ('AUDIT','ADMIN'));

-- Other staff roles can see audit events for their accessible transactions
CREATE POLICY "audit_events_select_staff" ON audit_events
  FOR SELECT
  USING (
    get_user_role() IN (
      'TREASURY_OFFICER','HEAD_TREASURY','MIS','MD','OPERATIONS','ACCOUNT_OFFICER'
    )
    AND (
      transaction_id IS NULL
      OR can_view_transaction(transaction_id)
    )
  );

-- INSERT via RPC functions only (SECURITY DEFINER).
-- Explicitly REVOKE UPDATE and DELETE to make append-only enforcement
-- unconditional even if a superuser accidentally grants permissions.
REVOKE UPDATE ON audit_events FROM authenticated;
REVOKE DELETE ON audit_events FROM authenticated;
REVOKE UPDATE ON audit_events FROM anon;
REVOKE DELETE ON audit_events FROM anon;

-- ============================================================
-- TABLE: transaction_documents
-- ============================================================
-- Users can read documents only if they can view the transaction
CREATE POLICY "transaction_documents_select" ON transaction_documents
  FOR SELECT
  USING (can_view_transaction(transaction_id));

-- TREASURY_OFFICER and ACCOUNT_OFFICER can upload documents.
-- ADMIN can upload to any transaction.
CREATE POLICY "transaction_documents_insert" ON transaction_documents
  FOR INSERT
  WITH CHECK (
    get_user_role() IN ('TREASURY_OFFICER','ACCOUNT_OFFICER','ADMIN')
    AND can_view_transaction(transaction_id)
  );

-- No UPDATE or DELETE for any role

-- ============================================================
-- TABLE: notifications
-- ============================================================
-- Users see only their own notifications
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT
  USING (recipient_id = auth.uid());

-- Mark-read: users can update their own notifications' is_read field
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- INSERT via notify_next_role trigger (SECURITY DEFINER) only

-- ============================================================
-- TABLE: sla_config
-- ============================================================
-- All staff can read SLA config (needed to display SLA indicators)
CREATE POLICY "sla_config_select_staff" ON sla_config
  FOR SELECT
  USING (is_staff_role());

-- Only ADMIN can update SLA config
CREATE POLICY "sla_config_update_admin" ON sla_config
  FOR UPDATE
  USING (get_user_role() = 'ADMIN');

CREATE POLICY "sla_config_insert_admin" ON sla_config
  FOR INSERT
  WITH CHECK (get_user_role() = 'ADMIN');

-- ============================================================
-- STORAGE POLICIES for transaction-documents bucket
-- These apply to storage.objects in the private bucket.
-- Bucket must be created as PRIVATE in the Supabase dashboard
-- or via supabase storage create.
-- ============================================================

-- Allow read if user has an authorised relationship to the transaction
CREATE POLICY "storage_documents_read" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'transaction-documents'
    AND EXISTS (
      SELECT 1 FROM transaction_documents td
      WHERE td.storage_path = name
      AND can_view_transaction(td.transaction_id)
    )
  );

-- Allow upload for TREASURY_OFFICER, ACCOUNT_OFFICER, ADMIN
CREATE POLICY "storage_documents_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'transaction-documents'
    AND get_user_role() IN ('TREASURY_OFFICER','ACCOUNT_OFFICER','ADMIN')
  );

-- No UPDATE or DELETE on storage objects
-- (documents are immutable once uploaded; corrections are new uploads)
