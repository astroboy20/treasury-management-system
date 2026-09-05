'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { verifySignatureAction } from '@/lib/actions/verification.actions'
import {
  SignatureVerificationSchema,
  type SignatureVerificationInput,
  type CheckResult,
} from '@/lib/schemas/verification.schema'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step2SignatureVerificationProps {
  transactionId: string
  /** Existing verification record — if present, panel is read-only */
  signatureVerification: TransactionWorkspace['signatureVerification']
  /** Whether the current user's role can act (TREASURY_OFFICER or ADMIN) */
  canAct: boolean
}

// ─── Checklist item config ────────────────────────────────────────────────────

interface ChecklistItem {
  field: keyof Omit<SignatureVerificationInput, 'notes'>
  label: string
  description: string
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    field: 'signatureResult',
    label: 'Signature Match',
    description: 'Customer signature matches the mandate card on file.',
  },
  {
    field: 'mandateResult',
    label: 'Mandate Check',
    description: 'Mandate requirements are satisfied for this transaction type.',
  },
  {
    field: 'accountOwnershipResult',
    label: 'Account Ownership',
    description: 'Beneficiary account ownership has been verified.',
  },
  {
    field: 'completenessResult',
    label: 'Instruction Completeness',
    description: 'All required fields in the instruction are present and valid.',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' })
}

function ResultBadge({ result }: { result: string }) {
  const isPassed = result === 'PASSED'
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        isPassed
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-red-100 text-red-700',
      ].join(' ')}
    >
      {isPassed ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : (
        <XCircle className="size-3" aria-hidden />
      )}
      {isPassed ? 'Passed' : 'Failed'}
    </span>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">
        {value ?? <span className="italic text-muted-foreground">—</span>}
      </dd>
    </div>
  )
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

interface ToggleRowProps {
  item: ChecklistItem
  value: CheckResult
  onChange: (val: CheckResult) => void
  disabled: boolean
}

function ToggleRow({ item, value, onChange, disabled }: ToggleRowProps) {
  const isPassed = value === 'PASSED'

  return (
    <div
      className={[
        'flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
        isPassed
          ? 'border-emerald-200 bg-emerald-50/50'
          : 'border-border bg-background',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
      </div>
      <button
        type="button"
        role="checkbox"
        aria-checked={isPassed}
        aria-label={`${item.label}: ${isPassed ? 'Passed' : 'Failed'}`}
        disabled={disabled}
        onClick={() => onChange(isPassed ? 'FAILED' : 'PASSED')}
        className={[
          'flex shrink-0 items-center justify-center rounded-full border-2 size-8 transition-colors',
          isPassed
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-border bg-muted text-muted-foreground',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-emerald-400',
        ].join(' ')}
      >
        {isPassed ? (
          <CheckCircle2 className="size-4" aria-hidden />
        ) : (
          <XCircle className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

// ─── Entry animation styles ───────────────────────────────────────────────────

const PANEL_ANIMATION_STYLE = `
  @keyframes fadeInPanel {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sig-panel { animation: none !important; }
  }
`

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 2 — Signature Verification Panel.
 *
 * Shows a four-item checklist form for TREASURY_OFFICER to verify the
 * customer's instruction against mandates and account records.
 *
 * Behaviour:
 *   - Read-only when signatureVerification is already recorded.
 *   - Any FAILED result shows a destructive Alert explaining the downstream lock.
 *   - On submit: calls verifySignatureAction, shows Sonner toast on result.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */
export default function Step2SignatureVerification({
  transactionId,
  signatureVerification,
  canAct,
}: Step2SignatureVerificationProps) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    handleSubmit,
    watch,
    setValue,
    register,
    formState: { errors },
  } = useForm<SignatureVerificationInput>({
    resolver: zodResolver(SignatureVerificationSchema),
    defaultValues: {
      signatureResult: 'FAILED',
      mandateResult: 'FAILED',
      accountOwnershipResult: 'FAILED',
      completenessResult: 'FAILED',
    },
  })

  const watchedValues = watch()

  async function onSubmit(data: SignatureVerificationInput) {
    setSubmitting(true)
    setServerError(null)

    const result = await verifySignatureAction(transactionId, data)
    setSubmitting(false)

    if (result.success) {
      toast.success('Signature verification submitted successfully.')
    } else {
      const msg = result.error ?? 'Submission failed. Please try again.'
      setServerError(msg)
      toast.error(msg)
    }
  }

  // ── Read-only mode ──────────────────────────────────────────────────────────

  if (signatureVerification) {
    const {
      signature_result,
      mandate_result,
      account_ownership_result,
      completeness_result,
      notes,
      verified_at,
      verifier,
    } = signatureVerification

    const anyFailed =
      signature_result === 'FAILED' ||
      mandate_result === 'FAILED' ||
      account_ownership_result === 'FAILED' ||
      completeness_result === 'FAILED'

    return (
      <div
        className="sig-panel space-y-4"
        style={{ animation: 'fadeInPanel 200ms ease-out both' }}
      >
        <style>{PANEL_ANIMATION_STYLE}</style>

        {/* Req 8.3 — downstream lock alert for any FAILED result */}
        {anyFailed && (
          <Alert variant="destructive">
            <AlertTitle>Signature Verification Failed</AlertTitle>
            <AlertDescription>
              One or more verification checks failed. Steps 3–6 are locked until this
              transaction is reviewed.
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid gap-4 sm:grid-cols-2">
          {/* Checklist results */}
          <div className="sm:col-span-2">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Checklist Results
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { label: 'Signature Match', result: signature_result },
                { label: 'Mandate Check', result: mandate_result },
                { label: 'Account Ownership', result: account_ownership_result },
                { label: 'Instruction Completeness', result: completeness_result },
              ].map(({ label, result }) => (
                <div
                  key={label}
                  className={[
                    'flex items-center justify-between gap-3 rounded-lg border p-3',
                    result === 'PASSED'
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-border bg-muted/30',
                  ].join(' ')}
                >
                  <span className="text-sm text-foreground">{label}</span>
                  <ResultBadge result={result} />
                </div>
              ))}
            </div>
          </div>

          <Field
            label="Verified By"
            value={verifier?.full_name ?? signatureVerification.verified_by}
          />
          <Field label="Verified At" value={formatDate(verified_at)} />

          {notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{notes}</dd>
            </div>
          )}
        </dl>
      </div>
    )
  }

  // ── Form mode ───────────────────────────────────────────────────────────────

  return (
    <div
      className="sig-panel space-y-4"
      style={{ animation: 'fadeInPanel 200ms ease-out both' }}
    >
      <style>{PANEL_ANIMATION_STYLE}</style>

      {/* Server-side error alert */}
      {serverError && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Checklist toggles — Req 8.1 */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Verification Checklist
          </p>
          {CHECKLIST_ITEMS.map((item) => (
            <ToggleRow
              key={item.field}
              item={item}
              value={watchedValues[item.field] ?? 'FAILED'}
              onChange={(val) => setValue(item.field, val, { shouldValidate: true })}
              disabled={!canAct || submitting}
            />
          ))}
        </div>

        {/* Notes textarea — optional */}
        <div className="space-y-1.5">
          <Label
            htmlFor="sig-notes"
            className="text-xs font-medium text-muted-foreground"
          >
            Notes{' '}
            <span className="font-normal text-muted-foreground/70">
              (optional, max 1 000 chars)
            </span>
          </Label>
          <Textarea
            id="sig-notes"
            rows={3}
            maxLength={1000}
            disabled={!canAct || submitting}
            placeholder="Add any notes about this verification…"
            {...register('notes')}
            aria-describedby={errors.notes ? 'sig-notes-error' : undefined}
            className="resize-none text-sm"
          />
          {errors.notes && (
            <p
              id="sig-notes-error"
              className="text-xs text-destructive"
              role="alert"
            >
              {errors.notes.message}
            </p>
          )}
        </div>

        {/* Submit / permission notice */}
        {canAct ? (
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? 'Submitting…' : 'Submit Verification'}
            </Button>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Only a Treasury Officer can submit signature verification.
          </p>
        )}
      </form>
    </div>
  )
}
