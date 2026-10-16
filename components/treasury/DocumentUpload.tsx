'use client'

import { useRef, useState, useTransition, useId } from 'react'
import { toast } from 'sonner'
import { Upload, FileText, Loader2, AlertCircle, X, CheckCircle2, ExternalLink } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { uploadDocumentAction, getDocumentSignedUrlAction } from '@/lib/actions/document.actions'
import {
  ALLOWED_MIME_TYPES,
  ALLOWED_FILE_TYPES_LABEL,
  MAX_FILE_SIZE_BYTES,
  DOCUMENT_TYPES,
  type DocumentType,
} from '@/lib/constants/document.constants'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UploadedDocument {
  id: string
  storage_path: string
  uploaded_by: string
  created_at: string
}

interface DocumentUploadProps {
  transactionId: string
  /** Pre-select a document type. Omit to let the user choose. */
  defaultDocumentType?: DocumentType
  /**
   * When true, a document must be uploaded before the enclosing form can
   * proceed. Shows a required indicator and blocks the upload panel's internal
   * submit (the parent form still controls its own submit gate).
   */
  required?: boolean
  /**
   * Previously uploaded document for this slot. When provided the component
   * shows the file info and a link to view it instead of (or in addition to)
   * the upload zone.
   */
  existingDocument?: UploadedDocument | null
  /**
   * When false (default when existingDocument is present), hides the replace
   * upload zone. Only the creator of the transaction should be able to replace
   * the source document after submission.
   */
  canReplace?: boolean
  /**
   * Called after a successful upload so the parent can update its gate state.
   */
  onUploadSuccess?: (documentId: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  INSTRUCTION: 'Customer Instruction',
  SIGNED_FORM: 'Signed Form',
  EVIDENCE:    'Supporting Evidence',
  MANDATE:     'Mandate Document',
}

/**
 * Client-side file validation — mirrors the server validation in
 * `uploadDocumentAction` for immediate UX feedback (Req 27.2).
 * Returns an error string or null if valid.
 */
function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return `Invalid file type "${file.type}". Only ${ALLOWED_FILE_TYPES_LABEL} files are accepted.`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
    return `File too large (${sizeMB} MB). Maximum allowed size is 10 MB.`
  }
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * DocumentUpload — client component.
 *
 * Allows staff users to attach PDF, JPG, or PNG documents to a transaction.
 * Validates file type and size client-side and surfaces a shadcn `Alert` for
 * invalid files (Req 27.2).
 *
 * When `existingDocument` is provided the component shows the previously
 * uploaded file and still allows a replacement upload.
 * When `required` is true a required indicator is shown and `onUploadSuccess`
 * is called after a successful upload so the parent form can gate its submit.
 *
 * On successful upload: shows a Sonner toast with the file name.
 * On failure: shows a Sonner toast with the error message; the component
 * retains the selected file and document type so the user can retry (Req 27.5).
 *
 * The workspace server component re-renders after upload because
 * `uploadDocumentAction` calls `revalidatePath`, refreshing the document list
 * in the sidebar.
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5
 */
export function DocumentUpload({
  transactionId,
  defaultDocumentType,
  required = false,
  existingDocument = null,
  canReplace = false,
  onUploadSuccess,
}: DocumentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const instanceId = useId() // unique per component instance — prevents id collisions when multiple DocumentUpload components are on the same page
  const fileInputId = `doc-file-input-${instanceId}`
  const docTypeSelectId = `doc-type-select-${instanceId}`

  const [selectedFile, setSelectedFile]           = useState<File | null>(null)
  const [documentType, setDocumentType]           = useState<DocumentType | ''>(
    defaultDocumentType ?? '',
  )
  const [validationError, setValidationError]     = useState<string | null>(null)
  const [isPending, startTransition]              = useTransition()
  const [loadingUrl, setLoadingUrl]               = useState(false)
  const [isDragActive, setIsDragActive]           = useState(false)

  // ── File selection ──────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)

    if (!file) {
      setValidationError(null)
      return
    }

    // Client-side validation for immediate inline feedback (Req 27.2)
    const err = validateFile(file)
    setValidationError(err)
  }

  function handleClearFile() {
    setSelectedFile(null)
    setValidationError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  function handleUpload() {
    if (!selectedFile || !documentType || validationError) return

    startTransition(async () => {
      const result = await uploadDocumentAction(
        transactionId,
        selectedFile,
        documentType as DocumentType,
      )

      if (result.success) {
        // Success: toast and reset form
        toast.success(`"${selectedFile.name}" uploaded successfully.`)
        setSelectedFile(null)
        setValidationError(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onUploadSuccess?.(result.data!.documentId)
      } else {
        // Failure (Req 27.5): toast with error; retain file + type so the
        // user can retry without reselecting.
        toast.error(result.error ?? 'Upload failed. Please try again.')
      }
    })
  }

  // ── Drag-and-drop ───────────────────────────────────────────────────────

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setSelectedFile(file)
    const err = validateFile(file)
    setValidationError(err)
  }

  function handleDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragActive(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setIsDragActive(false)
  }

  // ── Derived state ───────────────────────────────────────────────────────

  const canUpload =
    selectedFile !== null &&
    documentType !== '' &&
    validationError === null &&
    !isPending

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Derive the filename from a storage_path like "txId/TYPE/ts_name.pdf" */
  function fileNameFromPath(path: string): string {
    const parts = path.split('/')
    const last = parts[parts.length - 1] ?? path
    // Strip the timestamp prefix: "1234567890_filename.pdf" → "filename.pdf"
    return last.replace(/^\d+_/, '')
  }

  async function handleViewDocument() {
    if (!existingDocument) return
    setLoadingUrl(true)
    const result = await getDocumentSignedUrlAction(existingDocument.storage_path)
    setLoadingUrl(false)
    if (result.success && result.data?.signedUrl) {
      window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer')
    } else {
      toast.error('Could not generate a view link. Please try again.')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">

      {/* Previously uploaded file — shown when existingDocument is provided */}
      {existingDocument && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {fileNameFromPath(existingDocument.storage_path)}
          </span>
          <span className="shrink-0 text-[0.65rem] text-muted-foreground">
            {new Date(existingDocument.created_at).toLocaleDateString('en-NG')}
          </span>
          <button
            type="button"
            onClick={handleViewDocument}
            disabled={loadingUrl}
            className="ml-1 shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] font-medium text-emerald-700 ring-1 ring-emerald-300 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            aria-label="View uploaded document"
          >
            {loadingUrl ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <ExternalLink className="size-3" aria-hidden />
            )}
            View
          </button>
        </div>
      )}

      {/* Upload label — with required indicator when needed */}
      {existingDocument ? (
        canReplace ? (
          <p className="text-xs font-medium text-muted-foreground">Replace document</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Upload document
            {required && <span className="ml-1 text-destructive" aria-hidden>*</span>}
          </p>
          {required && (
            <p className="text-xs text-muted-foreground/70">
              A document must be uploaded before you can submit this step.
            </p>
          )}
        </div>
      )}

      {/* Document type selector — hidden when type is pre-set by the parent */}
      {(!existingDocument || canReplace) && !defaultDocumentType && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={docTypeSelectId} className="text-xs font-medium text-muted-foreground">
            Document Type
          </Label>
          <Select
            value={documentType}
            onValueChange={(v) => setDocumentType(v as DocumentType)}
            disabled={isPending}
          >
            <SelectTrigger
              id={docTypeSelectId}
              className="h-8 text-xs"
              aria-label="Select document type"
            >
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type} className="text-xs">
                  {DOCUMENT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Inline validation alert (Req 27.2) */}
      {(!existingDocument || canReplace) && validationError && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="size-3.5" aria-hidden />
          <AlertDescription className="text-xs">{validationError}</AlertDescription>
        </Alert>
      )}

      {/* Drop zone / file picker — only shown when no existing doc, or creator is replacing */}
      {(!existingDocument || canReplace) && (
        selectedFile ? (
          /* Selected file preview */
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {selectedFile.name}
            </span>
            <span className="shrink-0 text-[0.65rem] text-muted-foreground">
              {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
            </span>
            {!isPending && (
              <button
                type="button"
                onClick={handleClearFile}
                className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${selectedFile.name}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </div>
        ) : (
          /* Drop target */
          <label
            htmlFor={fileInputId}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={[
              'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed',
              'px-4 py-5 text-center transition-colors duration-150',
              isDragActive
                ? 'border-primary/70 bg-primary/5'
                : 'border-border bg-muted/20 [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40',
              isPending ? 'pointer-events-none opacity-50' : '',
            ].join(' ')}
          >
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-xs font-medium text-muted-foreground">
              Click to browse or drop a file here
            </span>
            <span className="text-[0.65rem] text-muted-foreground">
              {ALLOWED_FILE_TYPES_LABEL} · max 10 MB
            </span>
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              className="sr-only"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
              disabled={isPending}
              aria-label="Upload document"
            />
          </label>
        )
      )}

      {/* Upload button — only shown when upload zone is visible */}
      {(!existingDocument || canReplace) && (
        <Button
          type="button"
          size="sm"
          onClick={handleUpload}
          disabled={!canUpload}
          className="w-full text-xs"
          aria-label={selectedFile ? `Upload ${selectedFile.name}` : 'Upload document'}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
              Uploading…
            </>
          ) : (
            <>
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              Upload Document
            </>
          )}
        </Button>
      )}

    </div>
  )
}
