'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import type { ActionResult } from '@/lib/actions/transaction.actions'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Accepted MIME types (Req 27.2) */
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

/** Human-readable label used in error messages */
export const ALLOWED_FILE_TYPES_LABEL = 'PDF, JPG, or PNG'

/** Maximum file size: 10 MB in bytes (Req 27.2) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** Signed URL expiry: 3600 seconds (1 hour) (Req 27.3) */
export const SIGNED_URL_EXPIRY_SECONDS = 3600

/** Valid document types matching the DB constraint (Req 27.1) */
export const DOCUMENT_TYPES = ['INSTRUCTION', 'SIGNED_FORM', 'EVIDENCE', 'MANDATE'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// ─── uploadDocumentAction ──────────────────────────────────────────────────────

/**
 * Uploads a transaction document to the `transaction-documents` Supabase Storage
 * bucket, inserts a `transaction_documents` row, and writes a `DOCUMENT_UPLOADED`
 * audit event.
 *
 * Security model (Req 27.6, 35.1):
 *   - Caller must be authenticated; role is resolved from the DB.
 *   - The Storage bucket has RLS policies restricting access to users with
 *     an authorised relationship to the transaction.
 *   - Server validates file type and size before touching Storage — client-side
 *     validation is a UX courtesy only.
 *
 * Storage path format (Req 27.1):
 *   `{transaction_id}/{document_type}/{timestamp}_{filename}`
 *
 * The returned signed URL expires after 3600 s — no permanent public URL is
 * ever issued (Req 27.3).
 *
 * On Storage upload failure or DB insert failure the action returns
 * `{ success: false, error }` so the caller can surface a Sonner toast and
 * retain the partial upload state for retry (Req 27.5).
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6
 */
export async function uploadDocumentAction(
  transactionId: string,
  file: File,
  documentType: DocumentType,
): Promise<ActionResult<{ documentId: string; signedUrl: string; storagePath: string }>> {
  // ── 1. Input guards ──────────────────────────────────────────────────────

  if (!transactionId || typeof transactionId !== 'string') {
    return { success: false, error: 'Transaction ID is required.' }
  }

  if (!DOCUMENT_TYPES.includes(documentType)) {
    return {
      success: false,
      error: `Invalid document type. Must be one of: ${DOCUMENT_TYPES.join(', ')}.`,
    }
  }

  // ── 2. Server-side file validation (Req 27.2) ────────────────────────────
  //    The client performs the same checks for UX, but the server is the
  //    authoritative validation boundary (Req 35.1).

  if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMimeType)) {
    return {
      success: false,
      error: `Invalid file type "${file.type}". Only ${ALLOWED_FILE_TYPES_LABEL} files are accepted.`,
    }
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
    return {
      success: false,
      error: `File is too large (${sizeMB} MB). Maximum allowed size is 10 MB.`,
    }
  }

  // ── 3. Authenticate ──────────────────────────────────────────────────────

  const user = await getAuthenticatedUser()
  if (!user) {
    return { success: false, error: 'Not authenticated.' }
  }

  // ── 4. Resolve role from DB — never trust client body (Req 5.1) ──────────

  const role = await resolveUserRole(user.id)
  if (!role) {
    return { success: false, error: 'No role assigned to your account.' }
  }

  const supabase = await createClient()

  // ── 5. Verify the transaction exists and the user has access to it ────────
  //    The Supabase client operates under the authenticated user's session, so
  //    RLS on `treasury_transactions` enforces read access (Req 27.6).

  const { data: txData, error: txError } = await supabase
    .from('treasury_transactions')
    .select('id, status')
    .eq('id', transactionId)
    .single()

  if (txError || !txData) {
    return { success: false, error: 'Transaction not found or access denied.' }
  }

  // ── 6. Build the Storage path (Req 27.1) ─────────────────────────────────
  //    Format: {transaction_id}/{document_type}/{timestamp}_{sanitised_filename}
  //    Sanitise the filename to remove characters that are unsafe in object keys.

  const sanitisedFilename = file.name
    .replace(/[^a-zA-Z0-9._-]/g, '_') // replace unsafe chars with underscore
    .replace(/__+/g, '_')              // collapse consecutive underscores
    .toLowerCase()

  const timestamp = Date.now()
  const storagePath = `${transactionId}/${documentType}/${timestamp}_${sanitisedFilename}`

  // ── 7. Upload file to Supabase Storage ───────────────────────────────────

  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from('transaction-documents')
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      // upsert: false ensures we never silently overwrite an existing file at the
      // same path; the timestamp prefix makes collisions practically impossible.
      upsert: false,
    })

  if (uploadError) {
    return {
      success: false,
      error: `Upload failed: ${uploadError.message}. Please try again.`,
    }
  }

  // ── 8. Insert transaction_documents row (Req 27.4) ────────────────────────

  const { data: docRow, error: dbError } = await supabase
    .from('transaction_documents')
    .insert({
      transaction_id: transactionId,
      document_type:  documentType,
      storage_path:   storagePath,
      uploaded_by:    user.id,
    })
    .select('id')
    .single()

  if (dbError || !docRow) {
    // Attempt to clean up the orphaned Storage object so storage isn't wasted.
    // Non-fatal if this cleanup also fails — the orphan is a storage concern only.
    await supabase.storage.from('transaction-documents').remove([storagePath])

    return {
      success: false,
      error: `Document record could not be saved: ${dbError?.message ?? 'Unknown error'}. Please try again.`,
    }
  }

  // ── 9. Write DOCUMENT_UPLOADED audit event (Req 27.4, 28.1) ─────────────

  await supabase.from('audit_events').insert({
    transaction_id: transactionId,
    actor_id:       user.id,
    event_type:     'DOCUMENT_UPLOADED',
    from_status:    txData.status,
    to_status:      txData.status, // status unchanged by upload
    metadata: {
      document_id:    docRow.id,
      document_type:  documentType,
      storage_path:   storagePath,
      file_name:      file.name,
      file_size_bytes: file.size,
      mime_type:      file.type,
    },
  })

  // ── 10. Generate short-lived signed URL (Req 27.3) ───────────────────────
  //     3600 s = 60 minutes. Permanent public URLs are never issued.

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('transaction-documents')
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS)

  if (signedUrlError || !signedUrlData?.signedUrl) {
    // The file is uploaded and the DB row is committed. The signed URL is a
    // convenience return; a missing URL is non-fatal — the sidebar will regenerate
    // one when the workspace reloads.
    return {
      success: true,
      data: {
        documentId: docRow.id,
        signedUrl:  '',
        storagePath,
      },
    }
  }

  // ── 11. Revalidate workspace cache ───────────────────────────────────────

  revalidatePath(`/transactions/${transactionId}`)

  return {
    success: true,
    data: {
      documentId: docRow.id,
      signedUrl:  signedUrlData.signedUrl,
      storagePath,
    },
  }
}
