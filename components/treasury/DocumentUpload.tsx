'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Upload, FileText, Loader2, AlertCircle, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  uploadDocumentAction,
  ALLOWED_MIME_TYPES,
  ALLOWED_FILE_TYPES_LABEL,
  MAX_FILE_SIZE_BYTES,
  DOCUMENT_TYPES,
  type DocumentType,
} from '@/lib/actions/document.actions'

// ─── Props ────────────────────────────────────────────────────────────────────

interface DocumentUploadProps {
  transactionId: string
  /** Pre-select a document type. Omit to let the user choose. */
  defaultDocumentType?: DocumentType
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
export function DocumentUpload({ transactionId, defaultDocumentType }: DocumentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile]           = useState<File | null>(null)
  const [documentType, setDocumentType]           = useState<DocumentType | ''>(
    defaultDocumentType ?? '',
  )
  const [validationError, setValidationError]     = useState<string | null>(null)
  const [isPending, startTransition]              = useTransition()

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

    // Re-run client-side validation as a safety net before the server call
    const clientErr = validateFile(selectedFile)
    if (clientErr) {
      setValidationError(clientErr)
      return
    }

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
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setSelectedFile(file)
    const err = validateFile(file)
    setValidationError(err)
  }

  function handleDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
  }

  // ── Derived state ───────────────────────────────────────────────────────

  const canUpload =
    selectedFile !== null &&
    documentType !== '' &&
    validationError === null &&
    !isPending

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">

      {/* Document type selector */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doc-type-select" className="text-xs font-medium text-muted-foreground">
          Document Type
        </Label>
        <Select
          value={documentType}
          onValueChange={(v) => setDocumentType(v as DocumentType)}
          disabled={isPending}
        >
          <SelectTrigger
            id="doc-type-select"
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

      {/* Inline validation alert (Req 27.2) */}
      {validationError && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="size-3.5" aria-hidden />
          <AlertDescription className="text-xs">{validationError}</AlertDescription>
        </Alert>
      )}

      {/* Drop zone / file picker */}
      {selectedFile ? (
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
          htmlFor="doc-file-input"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={[
            'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed',
            'border-border bg-muted/20 px-4 py-5 text-center transition-colors duration-150',
            '[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40',
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
            id="doc-file-input"
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={handleFileChange}
            disabled={isPending}
            aria-label="Upload document"
          />
        </label>
      )}

      {/* Upload button */}
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

    </div>
  )
}
