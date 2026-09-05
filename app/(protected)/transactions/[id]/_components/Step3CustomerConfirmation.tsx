'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { recordCustomerConfirmationAction } from '@/lib/actions/verification.actions'
import {
  CustomerConfirmationSchema,
  type CustomerConfirmationInput,
} from '@/lib/schemas/verification.schema'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step3CustomerConfirmationProps {
  transactionId: string
  /** Pre-filled officer name from authenticated profile */
  officerName: string
  /** Whether the transaction type requires a beneficiary confirmation (e.g., third-party payment) */
  requiresBeneficiary: boolean
  /** Existing confirmation record — if present, panel is read-only */
  customerConfirmation: TransactionWorkspace['customerConfirmation']
  /** Whether the current user's role can act (ACCOUNT_OFFICER or ADMIN) */
  canAct: boolean
}

// ─── Transaction types that require beneficiary confirmation ──────────────────

const BENEFICIARY_REQUIRED_TYPES = new Set([
  'THIRD_PARTY_PAYMENT',
  'INTERNAL_TRANSFER',
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: string): string {
  const num = parseFloat(val)
  if (isNaN(num)) return val
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' })
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    CONFIRMED: {
      className: 'bg-emerald-100 text-emerald-700',
      icon: <CheckCircle2 className="size-3" aria-hidden />,
      label: 'Confirmed',
    },
    FAILED: {
      className: 'bg-red-100 text-red-700',
      icon: <AlertTriangle className="size-3" aria-hidden />,
      label: 'Failed',
    },
    UNREACHABLE: {
      className: 'bg-amber-100 text-amber-700',
      icon: <AlertTriangle className="size-3" aria-hidden />,
      label: 'Unreachable',
    },
  }[status] ?? { className: 'bg-muted text-muted-foreground', icon: null, label: status }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
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

// ─── Entry animation styles ───────────────────────────────────────────────────

const PANEL_ANIMATION_STYLE = `
  @keyframes fadeInPanel {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .conf-panel { animation: none !important; }
  }
`

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 3 — Customer Confirmation Panel.
 *
 * Allows an Account Officer to record the result of a telephone confirmation
 * call with the customer before investment verification proceeds.
 *
 * Behaviour:
 *   - Read-only when customerConfirmation is already recorded.
 *   - FAILED or UNREACHABLE status shows a destructive Alert explaining that
 *     Step 4 is locked as a result.
 *   - Visible and actionable only for ACCOUNT_OFFICER (canAct=true).
 *   - On submit: calls recordCustomerConfirmationAction, shows Sonner toast.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export default function Step3CustomerConfirmation({
  transactionId,
  officerName,
  requiresBeneficiary,
  customerConfirmation,
  canAct,
}: Step3CustomerConfirmationProps) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CustomerConfirmationInput>({
    resolver: zodResolver(CustomerConfirmationSchema),
    defaultValues: {
      confirmationDate: new Date().toISOString().slice(0, 10),
      confirmationTime: new Date().toTimeString().slice(0, 5),
      confirmedAmount: '',
      confirmedBeneficiary: '',
      confirmedPurpose: '',
      confirmationStatus: 'CONFIRMED',
      notes: '',
    },
  })

  const confirmationStatus = watch('confirmationStatus')

  async function onSubmit(data: CustomerConfirmationInput) {
    setSubmitting(true)
    setServerError(null)

    const result = await recordCustomerConfirmationAction(transactionId, data)
    setSubmitting(false)

    if (result.success) {
      toast.success('Customer confirmation recorded successfully.')
    } else {
      const msg = result.error ?? 'Submission failed. Please try again.'
      setServerError(msg)
      toast.error(msg)
    }
  }

  // ── Read-only mode ──────────────────────────────────────────────────────────

  if (customerConfirmation) {
    const {
      confirmation_status,
      confirmed_amount,
      confirmed_beneficiary,
      confirmed_purpose,
      confirmation_date,
      confirmation_time,
      notes,
      created_at,
      confirmer,
      confirmed_by,
    } = customerConfirmation

    const isException =
      confirmation_status === 'FAILED' || confirmation_status === 'UNREACHABLE'

    return (
      <div
        className="conf-panel space-y-4"
        style={{ animation: 'fadeInPanel 200ms ease-out both' }}
      >
        <style>{PANEL_ANIMATION_STYLE}</style>

        {/* Req 9.4 — exception alert when confirmation failed or customer unreachable */}
        {isException && (
          <Alert variant="destructive">
            <AlertTitle>
              Customer Confirmation{' '}
              {confirmation_status === 'FAILED' ? 'Failed' : 'Unreachable'}
            </AlertTitle>
            <AlertDescription>
              {confirmation_status === 'FAILED'
                ? 'The customer disputed or declined to confirm this instruction. Step 4 (Investment Verification) is locked. The transaction must be reviewed before it can proceed.'
                : 'The customer could not be reached for confirmation. Step 4 (Investment Verification) is locked pending a successful callback or escalation.'}
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Confirmation Status"
            value={<StatusBadge status={confirmation_status} />}
          />
          <Field label="Confirmed By" value={confirmer?.full_name ?? confirmed_by} />
          <Field label="Confirmation Date" value={confirmation_date} />
          <Field label="Confirmation Time" value={confirmation_time} />
          <Field label="Confirmed Amount" value={formatCurrency(confirmed_amount)} />
          {confirmed_beneficiary && (
            <Field label="Confirmed Beneficiary" value={confirmed_beneficiary} />
          )}
          <div className={confirmed_beneficiary ? '' : 'sm:col-span-2'}>
            <dt className="text-xs font-medium text-muted-foreground">Confirmed Purpose</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {confirmed_purpose}
            </dd>
          </div>
          {notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{notes}</dd>
            </div>
          )}
          <Field label="Recorded At" value={formatDate(created_at)} />
        </dl>
      </div>
    )
  }

  // ── Form mode ───────────────────────────────────────────────────────────────

  const isException =
    confirmationStatus === 'FAILED' || confirmationStatus === 'UNREACHABLE'

  return (
    <div
      className="conf-panel space-y-5"
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

      {/* Live exception preview alert — shown when FAILED/UNREACHABLE is selected */}
      {isException && (
        <Alert variant="destructive">
          <AlertTitle>Exception Status Selected</AlertTitle>
          <AlertDescription>
            Selecting{' '}
            <strong>
              {confirmationStatus === 'FAILED' ? 'Failed' : 'Unreachable'}
            </strong>{' '}
            will lock Step 4 (Investment Verification) and flag this transaction as
            an exception requiring review.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Officer name — pre-filled, read-only (Req 9.1) */}
        <div className="space-y-1.5">
          <Label htmlFor="conf-officer" className="text-xs font-medium text-muted-foreground">
            Account Officer
          </Label>
          <Input
            id="conf-officer"
            value={officerName}
            readOnly
            disabled
            className="bg-muted/40 text-sm"
            aria-label="Account Officer (pre-filled)"
          />
        </div>

        {/* Date and time row */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label
              htmlFor="conf-date"
              className="text-xs font-medium text-muted-foreground"
            >
              Confirmation Date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="conf-date"
              type="date"
              disabled={!canAct || submitting}
              {...register('confirmationDate')}
              aria-describedby={errors.confirmationDate ? 'conf-date-error' : undefined}
              className="text-sm"
            />
            {errors.confirmationDate && (
              <p id="conf-date-error" className="text-xs text-destructive" role="alert">
                {errors.confirmationDate.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="conf-time"
              className="text-xs font-medium text-muted-foreground"
            >
              Confirmation Time <span className="text-destructive">*</span>
            </Label>
            <Input
              id="conf-time"
              type="time"
              disabled={!canAct || submitting}
              {...register('confirmationTime')}
              aria-describedby={errors.confirmationTime ? 'conf-time-error' : undefined}
              className="text-sm"
            />
            {errors.confirmationTime && (
              <p id="conf-time-error" className="text-xs text-destructive" role="alert">
                {errors.confirmationTime.message}
              </p>
            )}
          </div>
        </div>

        {/* Confirmation status */}
        <div className="space-y-1.5">
          <Label
            htmlFor="conf-status"
            className="text-xs font-medium text-muted-foreground"
          >
            Confirmation Status <span className="text-destructive">*</span>
          </Label>
          <Select
            value={confirmationStatus}
            onValueChange={(val) =>
              setValue('confirmationStatus', val as CustomerConfirmationInput['confirmationStatus'], {
                shouldValidate: true,
              })
            }
            disabled={!canAct || submitting}
          >
            <SelectTrigger id="conf-status" className="text-sm">
              <SelectValue placeholder="Select status…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CONFIRMED">Confirmed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="UNREACHABLE">Unreachable</SelectItem>
            </SelectContent>
          </Select>
          {errors.confirmationStatus && (
            <p className="text-xs text-destructive" role="alert">
              {errors.confirmationStatus.message}
            </p>
          )}
        </div>

        {/* Confirmed amount */}
        <div className="space-y-1.5">
          <Label
            htmlFor="conf-amount"
            className="text-xs font-medium text-muted-foreground"
          >
            Confirmed Amount (₦) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="conf-amount"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 5000000.00"
            disabled={!canAct || submitting}
            {...register('confirmedAmount')}
            aria-describedby={errors.confirmedAmount ? 'conf-amount-error' : undefined}
            className="text-sm"
          />
          {errors.confirmedAmount && (
            <p id="conf-amount-error" className="text-xs text-destructive" role="alert">
              {errors.confirmedAmount.message}
            </p>
          )}
        </div>

        {/* Confirmed beneficiary — conditional on transaction type (Req 9.1) */}
        {requiresBeneficiary && (
          <div className="space-y-1.5">
            <Label
              htmlFor="conf-beneficiary"
              className="text-xs font-medium text-muted-foreground"
            >
              Confirmed Beneficiary <span className="text-destructive">*</span>
            </Label>
            <Input
              id="conf-beneficiary"
              type="text"
              placeholder="Beneficiary name or account"
              disabled={!canAct || submitting}
              {...register('confirmedBeneficiary')}
              aria-describedby={
                errors.confirmedBeneficiary ? 'conf-beneficiary-error' : undefined
              }
              className="text-sm"
            />
            {errors.confirmedBeneficiary && (
              <p
                id="conf-beneficiary-error"
                className="text-xs text-destructive"
                role="alert"
              >
                {errors.confirmedBeneficiary.message}
              </p>
            )}
          </div>
        )}

        {/* Confirmed purpose */}
        <div className="space-y-1.5">
          <Label
            htmlFor="conf-purpose"
            className="text-xs font-medium text-muted-foreground"
          >
            Confirmed Purpose <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="conf-purpose"
            rows={2}
            maxLength={500}
            placeholder="State the purpose as confirmed by the customer…"
            disabled={!canAct || submitting}
            {...register('confirmedPurpose')}
            aria-describedby={errors.confirmedPurpose ? 'conf-purpose-error' : undefined}
            className="resize-none text-sm"
          />
          {errors.confirmedPurpose && (
            <p id="conf-purpose-error" className="text-xs text-destructive" role="alert">
              {errors.confirmedPurpose.message}
            </p>
          )}
        </div>

        {/* Notes — optional */}
        <div className="space-y-1.5">
          <Label
            htmlFor="conf-notes"
            className="text-xs font-medium text-muted-foreground"
          >
            Notes{' '}
            <span className="font-normal text-muted-foreground/70">(optional, max 1 000 chars)</span>
          </Label>
          <Textarea
            id="conf-notes"
            rows={3}
            maxLength={1000}
            placeholder="Any additional notes from the confirmation call…"
            disabled={!canAct || submitting}
            {...register('notes')}
            aria-describedby={errors.notes ? 'conf-notes-error' : undefined}
            className="resize-none text-sm"
          />
          {errors.notes && (
            <p id="conf-notes-error" className="text-xs text-destructive" role="alert">
              {errors.notes.message}
            </p>
          )}
        </div>

        {/* Submit / permission notice */}
        {canAct ? (
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? 'Recording…' : 'Record Confirmation'}
            </Button>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Only an Account Officer can record customer confirmation.
          </p>
        )}
      </form>
    </div>
  )
}

// ─── Re-export helper for workspace page to determine requiresBeneficiary ─────

export { BENEFICIARY_REQUIRED_TYPES }
