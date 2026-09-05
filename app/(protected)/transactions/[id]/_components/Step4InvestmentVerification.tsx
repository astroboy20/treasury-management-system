'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CheckCircle2, DatabaseZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { verifyInvestmentAction } from '@/lib/actions/verification.actions'
import {
  InvestmentVerificationSchema,
  type InvestmentVerificationInput,
} from '@/lib/schemas/verification.schema'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'
import type { EazybankzInvestment } from '@/lib/services/eazybankz'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step4InvestmentVerificationProps {
  transactionId: string
  /** Live Eazybankz data shown as pre-filled reference values (Req 10.1) */
  eazybankzData: EazybankzInvestment | null
  /** Existing snapshot — if present, panel is read-only (Req 10.3, 10.5) */
  investmentVerification: TransactionWorkspace['investmentVerification']
  /** Whether the current user's role can act — TREASURY_OFFICER only (Req 10.6) */
  canAct: boolean
}

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

function formatRate(val: string): string {
  const num = parseFloat(val)
  if (isNaN(num)) return val
  return `${num.toFixed(4)}%`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' })
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
    .inv-panel { animation: none !important; }
  }
`

// ─── Field row — editable with reference value ────────────────────────────────

interface VerificationFieldProps {
  id: string
  label: string
  required?: boolean
  referenceValue?: string
  referenceLabel?: string
  disabled: boolean
  type?: 'text' | 'date'
  inputMode?: 'decimal' | 'text'
  placeholder?: string
  error?: string
  registration: ReturnType<ReturnType<typeof useForm<InvestmentVerificationInput>>['register']>
}

function VerificationField({
  id,
  label,
  required = true,
  referenceValue,
  referenceLabel,
  disabled,
  type = 'text',
  inputMode,
  placeholder,
  error,
  registration,
}: VerificationFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {referenceValue && (
        <p className="text-xs text-muted-foreground/80">
          <span className="font-medium text-muted-foreground">
            {referenceLabel ?? 'Eazybankz'}:
          </span>{' '}
          {referenceValue}
        </p>
      )}
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        {...registration}
        aria-describedby={error ? `${id}-error` : undefined}
        className="text-sm"
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Immutable snapshot display ───────────────────────────────────────────────

function SnapshotDisplay({
  snapshot,
}: {
  snapshot: NonNullable<TransactionWorkspace['investmentVerification']>
}) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2 flex items-center gap-2">
        <CheckCircle2 className="size-4 text-emerald-600 shrink-0" aria-hidden />
        <p className="text-xs font-medium text-emerald-700">
          Investment snapshot verified and locked — source: {snapshot.source_system}
        </p>
      </div>

      <Field label="Principal" value={formatCurrency(snapshot.principal)} />
      <Field label="Accrued Interest" value={formatCurrency(snapshot.accrued_interest)} />
      <Field label="Interest Rate" value={formatRate(snapshot.interest_rate)} />
      <Field label="Effective Date" value={snapshot.effective_date} />
      <Field
        label="Maturity Date"
        value={snapshot.maturity_date ?? <span className="italic text-muted-foreground">Open-ended</span>}
      />
      <Field label="Outstanding Balance" value={formatCurrency(snapshot.outstanding_balance)} />
      <Field label="Available Amount" value={formatCurrency(snapshot.available_amount)} />
      <Field
        label="Verified By"
        value={snapshot.verifier?.full_name ?? snapshot.verified_by}
      />
      <Field label="Verified At" value={formatDateTime(snapshot.verified_at)} />
    </dl>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 4 — Investment Verification Panel.
 *
 * Allows a Treasury Officer to review Eazybankz-sourced investment data and
 * submit a confirmed snapshot that becomes the immutable input for all
 * downstream financial calculations.
 *
 * Behaviour:
 *   - Reference values from eazybankzData are displayed above each field.
 *   - Pre-fills form fields with Eazybankz data so the officer only needs
 *     to confirm (or correct) the values.
 *   - Read-only / snapshot view once investmentVerification is recorded (Req 10.5).
 *   - Visible and actionable only for TREASURY_OFFICER role (Req 10.6).
 *   - On submit: calls verifyInvestmentAction, shows Sonner toast.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export default function Step4InvestmentVerification({
  transactionId,
  eazybankzData,
  investmentVerification,
  canAct,
}: Step4InvestmentVerificationProps) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InvestmentVerificationInput>({
    resolver: zodResolver(InvestmentVerificationSchema),
    // Pre-fill from Eazybankz data so the officer confirms rather than re-types (Req 10.1)
    defaultValues: {
      principal: eazybankzData?.principal ?? '',
      accruedInterest: eazybankzData?.accruedInterest ?? '',
      interestRate: eazybankzData?.interestRate ?? '',
      effectiveDate: eazybankzData?.effectiveDate ?? '',
      maturityDate: eazybankzData?.maturityDate ?? '',
      outstandingBalance: eazybankzData?.outstandingBalance ?? '',
      availableAmount: eazybankzData?.availableAmount ?? '',
    },
  })

  async function onSubmit(data: InvestmentVerificationInput) {
    setSubmitting(true)
    setServerError(null)

    const result = await verifyInvestmentAction(transactionId, data)
    setSubmitting(false)

    if (result.success) {
      toast.success('Investment verification saved successfully.')
    } else {
      const msg = result.error ?? 'Submission failed. Please try again.'
      setServerError(msg)
      toast.error(msg)
    }
  }

  // ── Read-only snapshot mode (Req 10.5) ─────────────────────────────────────

  if (investmentVerification) {
    return (
      <div
        className="inv-panel"
        style={{ animation: 'fadeInPanel 200ms ease-out both' }}
      >
        <style>{PANEL_ANIMATION_STYLE}</style>
        <SnapshotDisplay snapshot={investmentVerification} />
      </div>
    )
  }

  // ── Form mode ───────────────────────────────────────────────────────────────

  const disabled = !canAct || submitting

  return (
    <div
      className="inv-panel space-y-5"
      style={{ animation: 'fadeInPanel 200ms ease-out both' }}
    >
      <style>{PANEL_ANIMATION_STYLE}</style>

      {/* Eazybankz data source notice */}
      {eazybankzData && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2.5">
          <DatabaseZap className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
          <p className="text-xs text-blue-700">
            Reference values are sourced from the Eazybankz mirror. Confirm or correct
            each field before submitting the verified snapshot.
          </p>
        </div>
      )}

      {/* No Eazybankz data warning */}
      {!eazybankzData && (
        <Alert>
          <AlertTitle>No Eazybankz data available</AlertTitle>
          <AlertDescription>
            Investment data could not be retrieved from the Eazybankz mirror. Enter
            the verified values manually from the physical investment record.
          </AlertDescription>
        </Alert>
      )}

      {/* Server-side error */}
      {serverError && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Monetary fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <VerificationField
            id="inv-principal"
            label="Principal (₦)"
            referenceValue={
              eazybankzData ? formatCurrency(eazybankzData.principal) : undefined
            }
            disabled={disabled}
            inputMode="decimal"
            placeholder="e.g. 10000000.00"
            error={errors.principal?.message}
            registration={register('principal')}
          />

          <VerificationField
            id="inv-accrued-interest"
            label="Accrued Interest (₦)"
            referenceValue={
              eazybankzData ? formatCurrency(eazybankzData.accruedInterest) : undefined
            }
            disabled={disabled}
            inputMode="decimal"
            placeholder="e.g. 1500000.00"
            error={errors.accruedInterest?.message}
            registration={register('accruedInterest')}
          />

          <VerificationField
            id="inv-interest-rate"
            label="Interest Rate (%)"
            referenceValue={
              eazybankzData ? formatRate(eazybankzData.interestRate) : undefined
            }
            disabled={disabled}
            inputMode="decimal"
            placeholder="e.g. 18.5000"
            error={errors.interestRate?.message}
            registration={register('interestRate')}
          />

          <VerificationField
            id="inv-outstanding-balance"
            label="Outstanding Balance (₦)"
            referenceValue={
              eazybankzData
                ? formatCurrency(eazybankzData.outstandingBalance)
                : undefined
            }
            disabled={disabled}
            inputMode="decimal"
            placeholder="e.g. 10000000.00"
            error={errors.outstandingBalance?.message}
            registration={register('outstandingBalance')}
          />

          <VerificationField
            id="inv-available-amount"
            label="Available Amount (₦)"
            referenceValue={
              eazybankzData
                ? formatCurrency(eazybankzData.availableAmount)
                : undefined
            }
            disabled={disabled}
            inputMode="decimal"
            placeholder="e.g. 10000000.00"
            error={errors.availableAmount?.message}
            registration={register('availableAmount')}
          />
        </div>

        {/* Date fields */}
        <div className="grid gap-4 sm:grid-cols-2">
          <VerificationField
            id="inv-effective-date"
            label="Effective Date"
            referenceValue={eazybankzData?.effectiveDate}
            referenceLabel="Eazybankz"
            disabled={disabled}
            type="date"
            error={errors.effectiveDate?.message}
            registration={register('effectiveDate')}
          />

          <VerificationField
            id="inv-maturity-date"
            label="Maturity Date"
            required={false}
            referenceValue={eazybankzData?.maturityDate ?? undefined}
            referenceLabel="Eazybankz"
            disabled={disabled}
            type="date"
            error={errors.maturityDate?.message}
            registration={register('maturityDate')}
          />
          {/* Maturity date hint for open-ended products */}
          {!eazybankzData?.maturityDate && (
            <p className="col-span-full text-xs text-muted-foreground/70 -mt-2">
              Leave maturity date blank for open-ended products (e.g. CALL accounts).
            </p>
          )}
        </div>

        {/* Submit / permission notice */}
        {canAct ? (
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? 'Saving snapshot…' : 'Confirm & Save Snapshot'}
            </Button>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Only a Treasury Officer can submit investment verification.
          </p>
        )}
      </form>
    </div>
  )
}
