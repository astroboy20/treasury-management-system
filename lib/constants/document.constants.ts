// ─── Document Upload Constants ────────────────────────────────────────────────
// Shared between the server action (lib/actions/document.actions.ts) and the
// client component (components/treasury/DocumentUpload.tsx).
// This file must NOT have "use server" or "use client" — it is a plain module.

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
