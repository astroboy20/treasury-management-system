-- ============================================================
-- Migration 010: Create transaction-documents Storage bucket
-- ============================================================
-- The bucket must exist before any upload can succeed.
-- Previously migration 002 added Storage RLS policies but
-- never created the bucket itself, causing "bucket not found"
-- errors from the upload action (Req 27.1).
--
-- bucket_id: transaction-documents
-- public: false  — all access is via signed URLs only (Req 27.3)
-- file_size_limit: 10 MB (10485760 bytes)  (Req 27.2)
-- allowed_mime_types: PDF, JPEG, PNG only  (Req 27.2)
-- ============================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'transaction-documents',
  'transaction-documents',
  false,
  10485760,   -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 10485760,
      allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];

-- ============================================================
-- Expand Storage upload policy (Req 27.6)
-- Previously restricted to TREASURY_OFFICER + ACCOUNT_OFFICER.
-- HEAD_TREASURY, MIS, AUDIT, MD and OPERATIONS all have an
-- authorised relationship to transactions they can view, so
-- they should also be able to attach supporting evidence.
-- ============================================================

DROP POLICY IF EXISTS "storage_documents_upload" ON storage.objects;

CREATE POLICY "storage_documents_upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'transaction-documents'
    AND get_user_role() IN (
      'TREASURY_OFFICER',
      'ACCOUNT_OFFICER',
      'HEAD_TREASURY',
      'MIS',
      'AUDIT',
      'MD',
      'OPERATIONS',
      'ADMIN'
    )
  );
