'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Calculator,
  Receipt,
  ArrowRight,
  Plus,
  Trash2,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  VoucherPreparationSchema,
  TX_TYPE_TO_VOUCHER_TYPE,
  type VoucherPreparationInput,
  type VoucherType,
  type FundsInVoucherInput,
  type FundsOutVoucherInput,
  type RolloverSlipVoucherInput,
  type TransferSlipVoucherInput,
} from '@/lib/schemas/voucher.schema'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'
import { DocumentUpload } from '@/components/treasury/DocumentUpload'
import type { UploadedDocument } from '@/components/treasury/DocumentUpload'
import { VoucherDisplay } from '@/components/treasury/VoucherDisplay'
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus'
import { enqueue } from '@/lib/offline/queue'

// ─── Prop types ───────────────────────────────────────────────────────────────

interface Step5VoucherGenerationProps {
  transactionId: string
  transactionType: string
  scenarioCode: string | null
  /** Current transaction status — used to detect RETURNED state for resubmission */
  transactionStatus: string
  /** The investment verification snapshot — used for calculation preview */
  investmentVerification: TransactionWorkspace['investmentVerification']
  /** Existing voucher — if present, panel is read-only unless status is RETURNED */
  voucher: TransactionWorkspace['voucher']
  /** Whether the current user can act (TREASURY_OFFICER) */
  canAct: boolean
  /**
   * Payment instruction data from the transaction record.
   * Used to determine if this is an internal THIRD_PARTY_PAYMENT (Req 21.1, 21.3).
   */
  existingPaymentInstruction?: { is_internal?: boolean } | null
  /** Previously uploaded signed-form document, if any */
  existingDocument?: UploadedDocument | null
}

// ─── Types for voucher action (forward declaration to avoid circular import) ──
// The prepareVoucherAction is imported dynamically because it lives in a
// separate actions file that task 2.19 creates.

type PrepareVoucherAction = (
  transactionId: string,
  input: VoucherPreparationInput,
) => Promise<{ success: boolean; data?: { voucherId: string; voucherNumber: string }; error?: string }>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(val: string | null | undefined): string {
  if (!val) return '₦0.00'
  const num = parseFloat(val)
  if (isNaN(num)) return val
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num)
}

function formatRate(val: string | null | undefined): string {
  if (!val) return '—'
  const num = parseFloat(val)
  if (isNaN(num)) return val
  const pct = num < 1 ? num * 100 : num
  return `${pct.toFixed(4)}%`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Voucher type label map ───────────────────────────────────────────────────

const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  FUNDS_IN: 'Funds-In Voucher',
  FUNDS_OUT: 'Funds-Out Voucher',
  ROLLOVER_SLIP: 'Rollover Slip',
  TRANSFER_SLIP: 'Transfer Slip',
}

/** Returns a more specific voucher label for Savings/Call/CMS Funds-Out types */
function getFundsOutLabel(transactionType: string): string {
  switch (transactionType) {
    case 'SAVINGS_FUNDS_OUT': return 'Savings Funds-Out Voucher'
    case 'CALL_FUNDS_OUT':    return 'Call Funds-Out Voucher'
    case 'CMS_FUNDS_OUT':     return 'CMS Funds-Out Voucher'
    default:                  return VOUCHER_TYPE_LABELS.FUNDS_OUT
  }
}

// Transaction types that require a Payment Instruction sub-form (Req 36)
const REQUIRES_PAYMENT_INSTRUCTION = new Set([
  'THIRD_PARTY_PAYMENT',
  'MATURITY_TERMINATION',
  'ANNIVERSARY_PAYMENT',
  'PRE_LIQUIDATION',
  'SAVINGS_FUNDS_OUT',
  'CALL_FUNDS_OUT',
  'CMS_FUNDS_OUT',
  'ROLLOVER',          // for PRINCIPAL_ONLY / PARTIAL_PRINCIPAL / INTEREST_ONLY sub-types
])

// Transaction types that use the Savings/Call/CMS Funds-Out layout (Req 38)
const SAVINGS_FUNDS_OUT_TYPES = new Set([
  'SAVINGS_FUNDS_OUT',
  'CALL_FUNDS_OUT',
  'CMS_FUNDS_OUT',
])

// ─── Animation style ──────────────────────────────────────────────────────────

// The panel uses an opacity-only fade for the reduced-motion path (no transform).
// For full-motion, a subtle translateY is added via a separate keyframe.
// Both are defined in globals.css / inline below so the transform guard is explicit.
const PANEL_ANIMATION_STYLE = `
  @keyframes fadeInPanel {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes fadeInPanelFull {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .voucher-panel {
    animation: fadeInPanel 200ms ease-out both;
  }
  @media (not (prefers-reduced-motion: reduce)) {
    .voucher-panel {
      animation: fadeInPanelFull 200ms ease-out both;
    }
  }
`

// ─── Shared form field components ─────────────────────────────────────────────

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

interface FormFieldProps {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}

function FormField({ id, label, required = true, hint, error, children }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Partial Principal Intermediate Values ────────────────────────────────────

/**
 * Displays the intermediate values for a PARTIAL_PRINCIPAL rollover before
 * voucher preparation (Req 17.4).
 *
 * Shows Original Principal, Requested Payout, Remaining Principal, and
 * Interest Due — computed live from the investment snapshot so the Treasury
 * Officer can confirm the figures before proceeding.
 *
 * Note: the `requestedPayout` value is read from the `calculation_snapshot`
 * on the investment verification record when available. If not yet persisted,
 * it falls back to the voucher form's state (handled by the parent component).
 * Authoritative computation runs server-side via PostgreSQL NUMERIC.
 */
function PartialPrincipalIntermediateValues({
  snapshot,
  requestedPayout,
}: {
  snapshot: NonNullable<TransactionWorkspace['investmentVerification']>
  requestedPayout?: string | null
}) {
  const principal = parseFloat(snapshot.principal)
  const payout = requestedPayout ? parseFloat(requestedPayout) : null
  const remaining =
    payout !== null && isFinite(payout) && isFinite(principal) && payout > 0 && payout < principal
      ? (principal - payout).toFixed(4)
      : null

  return (
    <>
      <Field label="Original Principal" value={formatCurrency(snapshot.principal)} />
      <Field
        label="Requested Payout"
        value={
          payout !== null && isFinite(payout)
            ? formatCurrency(String(payout))
            : <span className="italic text-muted-foreground">Enter requested payout in the form below</span>
        }
      />
      <Field
        label="Remaining Principal (= Principal − Payout)"
        value={
          remaining !== null
            ? formatCurrency(remaining)
            : <span className="italic text-muted-foreground text-xs">Computed once payout is entered</span>
        }
      />
      <Field label="Interest Due" value={formatCurrency(snapshot.accrued_interest)} />
      <div className="sm:col-span-2">
        <p className="text-xs text-blue-600/80">
          Rule: remaining_principal = original_principal − requested_payout.
          Confirm these values before proceeding to voucher preparation.
        </p>
      </div>
    </>
  )
}

// ─── Calculation Preview ──────────────────────────────────────────────────────

/**
 * Shows a read-only preview of the investment snapshot that will
 * be used as inputs for server-side calculations (Req 10.5, 11.7).
 */
function CalculationPreview({
  snapshot,
  transactionType,
  scenarioCode,
  requestedPayout,
  isInternalPayment,
}: {
  snapshot: NonNullable<TransactionWorkspace['investmentVerification']>
  transactionType: string
  scenarioCode?: string | null
  /** For PARTIAL_PRINCIPAL: the payout amount entered by the Treasury Officer */
  requestedPayout?: string | null
  /** For THIRD_PARTY_PAYMENT: whether this is an internal transfer (Req 21.3) */
  isInternalPayment?: boolean
}) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Calculator className="size-4 shrink-0 text-blue-600" aria-hidden />
        <p className="text-xs font-medium text-blue-700">
          Calculation inputs (from verified investment snapshot)
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <Field label="Principal" value={formatCurrency(snapshot.principal)} />
        <Field label="Accrued Interest" value={formatCurrency(snapshot.accrued_interest)} />
        <Field
          label="Interest Rate"
          value={
            (transactionType === 'SAVINGS_FUNDS_OUT' || transactionType === 'CALL_FUNDS_OUT' || transactionType === 'CMS_FUNDS_OUT')
              ? <span className="italic text-muted-foreground">N/A (balance-based)</span>
              : formatRate(snapshot.interest_rate)
          }
        />
        <Field label="Available Amount" value={formatCurrency(snapshot.available_amount)} />
        {/* Savings/Call/CMS Funds-Out: available_balance is the primary field (Req 38.1, 38.2) */}
        {(transactionType === 'SAVINGS_FUNDS_OUT' || transactionType === 'CALL_FUNDS_OUT' || transactionType === 'CMS_FUNDS_OUT') && (
          <>
            <div className="sm:col-span-2">
              <Separator className="my-1" />
              <p className="text-xs font-medium text-blue-700 mt-2">
                {transactionType === 'CALL_FUNDS_OUT' ? 'Call' : transactionType === 'CMS_FUNDS_OUT' ? 'CMS' : 'Savings'} Funds-Out — Available Balance
              </p>
            </div>
            {(transactionType === 'CALL_FUNDS_OUT' || transactionType === 'CMS_FUNDS_OUT') && (
              <>
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-amber-700 mt-1">COT (Commission on Turnover) — select rate in form below</p>
                </div>
                <Field
                  label="COT @ ₦2/mille (estimate)"
                  value={
                    parseFloat(snapshot.available_amount) > 0
                      ? formatCurrency(String(Math.round((2 * parseFloat(snapshot.available_amount)) / 1000 * 1e4) / 1e4))
                      : '—'
                  }
                />
                <Field
                  label="COT @ ₦5/mille (estimate)"
                  value={
                    parseFloat(snapshot.available_amount) > 0
                      ? formatCurrency(String(Math.round((5 * parseFloat(snapshot.available_amount)) / 1000 * 1e4) / 1e4))
                      : '—'
                  }
                />
              </>
            )}
            <div className="sm:col-span-2">
              <p className="text-xs text-blue-600/80">
                {transactionType === 'CALL_FUNDS_OUT' || transactionType === 'CMS_FUNDS_OUT'
                  ? 'COT formula: (Rate per mille × Transaction Value) ÷ 1,000. Select the applicable rate tier in the form below. Server computes the authoritative COT charge.'
                  : 'Rule: FUNDS_OUT_AVAILABLE_BALANCE — available_balance is sourced from the investment verification snapshot. No interest calculation formula is applied.'}
              </p>
            </div>
          </>
        )}
        {(transactionType === 'PRE_LIQUIDATION') && (
          <>
            <div className="sm:col-span-2">
              <Separator className="my-1" />
              <p className="text-xs font-medium text-blue-700 mt-2">Pre-liquidation charge (20%)</p>
            </div>
            <Field
              label="Charge (20% of accrued interest)"
              value={formatCurrency(
                String(parseFloat(snapshot.accrued_interest) * 0.2),
              )}
            />
            <Field
              label="Net Interest after charge"
              value={formatCurrency(
                String(parseFloat(snapshot.accrued_interest) * 0.8),
              )}
            />
            {requestedPayout && Number(requestedPayout) > 0 && (
              <>
                <div className="sm:col-span-2">
                  <Separator className="my-1" />
                  <p className="text-xs font-medium text-blue-700 mt-2">Partial pre-liquidation — intermediate values</p>
                </div>
                <Field
                  label="Original Principal"
                  value={formatCurrency(snapshot.principal)}
                />
                <Field
                  label="Requested Payout"
                  value={formatCurrency(String(Number(requestedPayout)))}
                />
                <Field
                  label="Remaining Principal (= Principal − Payout)"
                  value={
                    Number(requestedPayout) < parseFloat(snapshot.principal)
                      ? formatCurrency(String(parseFloat(snapshot.principal) - Number(requestedPayout)))
                      : <span className="text-destructive text-xs">Payout exceeds principal</span>
                  }
                />
                <Field
                  label="Rebooked Principal (= Remaining − Charge)"
                  value={
                    Number(requestedPayout) < parseFloat(snapshot.principal)
                      ? formatCurrency(
                          String(
                            parseFloat(snapshot.principal) -
                              Number(requestedPayout) -
                              parseFloat(snapshot.accrued_interest) * 0.2,
                          ),
                        )
                      : '—'
                  }
                />
                <Field
                  label="Funds-Out to Customer (= Requested Payout)"
                  value={
                    <span className="font-semibold text-foreground">
                      {formatCurrency(String(Number(requestedPayout)))}
                    </span>
                  }
                />
                <div className="sm:col-span-2">
                  <p className="text-xs text-blue-600/80">
                    SOP 3: customer receives the full requested payout — the 20% charge is deducted from the rebooked principal, not from the customer payout.
                    rebooked_principal = remaining_principal − charge.
                    The customer receives the full requested payout.
                  </p>
                </div>
              </>
            )}
          </>
        )}
        {transactionType === 'THIRD_PARTY_PAYMENT' && (
          <>
            <div className="sm:col-span-2">
              <Separator className="my-1" />
              <p className="text-xs font-medium text-blue-700 mt-2">
                {isInternalPayment
                  ? 'Transfer charge (internal: ₦0 — THIRD_PARTY_TRANSFER_0_10_PERCENT, internal path)'
                  : 'Transfer charge (external: 0.10% — THIRD_PARTY_TRANSFER_0_10_PERCENT)'}
              </p>
            </div>
            <Field
              label="Available Amount (snapshot)"
              value={formatCurrency(snapshot.available_amount)}
            />
            {isInternalPayment ? (
              <Field
                label="Transfer Charge"
                value={<span className="text-muted-foreground">₦0.00 (internal — no charge)</span>}
              />
            ) : (
              <Field
                label="Estimated charge (0.10% of transfer amount)"
                value={
                  parseFloat(snapshot.available_amount) > 0
                    ? formatCurrency(
                        String(Math.round(parseFloat(snapshot.available_amount) * 0.001 * 1e4) / 1e4)
                      )
                    : 'Enter transfer amount in the form below'
                }
              />
            )}
            <div className="sm:col-span-2">
              <p className="text-xs text-blue-600/80">
                {isInternalPayment
                  ? 'Rule: THIRD_PARTY_TRANSFER_0_10_PERCENT (internal path) — transfer_charge = 0. No charge for intra-company transfers.'
                  : 'Rule: transfer_charge = transfer_amount × 0.001. Server computes the authoritative charge and overwrites any client value (Req 21.2, 26.4). All 6 Payment Instruction fields are required before the voucher can be saved (Req 36.2).'}
              </p>
            </div>
          </>
        )}
        {transactionType === 'ROLLOVER' && (
          <>
            <div className="sm:col-span-2">
              <Separator className="my-1" />
              <p className="text-xs font-medium text-blue-700 mt-2">
                {scenarioCode === 'PRINCIPAL_ONLY'
                  ? 'Principal Only Rollover — estimated amounts'
                  : scenarioCode === 'PARTIAL_PRINCIPAL'
                  ? 'Partial Principal Rollover — intermediate values'
                  : scenarioCode === 'INTEREST_ONLY'
                  ? 'Interest Only Rollover — estimated amounts'
                  : 'P+I Rollover — estimated amounts'}
              </p>
            </div>
            {scenarioCode === 'PRINCIPAL_ONLY' ? (
              <>
                <Field
                  label="Rollover Amount (Principal only)"
                  value={formatCurrency(snapshot.principal)}
                />
                <Field
                  label="Interest Payout (Funds-Out)"
                  value={formatCurrency(snapshot.accrued_interest)}
                />
                <div className="sm:col-span-2">
                  <p className="text-xs text-blue-600/80">
                    Principal is reinvested. A linked Funds-Out transaction for the interest payout
                    will be created automatically after the voucher is prepared.
                  </p>
                </div>
              </>
            ) : scenarioCode === 'INTEREST_ONLY' ? (
              <>
                <Field
                  label="Principal (remains invested)"
                  value={formatCurrency(snapshot.principal)}
                />
                <Field
                  label="Interest Payout (Funds-Out)"
                  value={formatCurrency(snapshot.accrued_interest)}
                />
                <div className="sm:col-span-2">
                  <p className="text-xs text-blue-600/80">
                    Principal investment stays active — it is NOT terminated.
                    Only the accrued interest is paid out via a linked Funds-Out transaction
                    created automatically after the voucher is prepared.
                  </p>
                </div>
              </>
            ) : scenarioCode === 'PARTIAL_PRINCIPAL' ? (
              <PartialPrincipalIntermediateValues snapshot={snapshot} requestedPayout={requestedPayout} />
            ) : (
              <>
                <Field
                  label="Rollover Amount (Principal + Interest)"
                  value={formatCurrency(
                    String(parseFloat(snapshot.principal) + parseFloat(snapshot.accrued_interest)),
                  )}
                />
                <Field
                  label="No external payment"
                  value="Both principal and interest are reinvested"
                />
              </>
            )}
          </>
        )}
      </dl>
      {/* <p className="text-[10px] text-blue-600/70">
        Authoritative calculations run server-side using PostgreSQL NUMERIC arithmetic.
        Values shown here are estimates only.
      </p> */}
    </div>
  )
}

// ─── Payment Instruction Sub-form ─────────────────────────────────────────────

interface PaymentInstructionFormProps {
  disabled: boolean
  register: ReturnType<typeof useForm<VoucherPreparationInput>>['register']
  errors: Record<string, { message?: string } | undefined>
  fieldPrefix?: string
  /** When true, show only Internal Account Number (Req 21.1, 21.3) */
  isInternalPayment?: boolean
}

/**
 * Reusable payment instruction sub-form block (Req 36).
 * Shown for all voucher types where money leaves the company.
 * For internal THIRD_PARTY_PAYMENT, shows only the account number field (Req 21.3).
 *
 * FIX: previously this sub-form never rendered inputs for
 * `paymentInstruction.amount` or `paymentInstruction.transferCharge`, even
 * though `FundsOutVoucherSchema.superRefine()` requires both for external
 * THIRD_PARTY_PAYMENT submissions. That meant those two fields could never
 * be captured by react-hook-form, so validation failed on every external
 * submission no matter what the user entered. Both fields are now
 * registered below — `transferCharge` is shown read-only since the server
 * always recomputes the authoritative value.
 */
function PaymentInstructionSubForm({ disabled, register, errors, isInternalPayment }: PaymentInstructionFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>

  if (isInternalPayment) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs font-semibold text-foreground">Payment Instruction — Internal Transfer</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Internal transfer — Transfer Charge: ₦0.00 (no charge for intra-company transfers)
        </p>
        <div className="grid gap-4">
          <FormField id="pi-internal-account-number" label="Internal Account Number" error={errs['paymentInstruction.accountNumber']?.message}>
            <Input
              id="pi-internal-account-number"
              placeholder="Internal account number"
              disabled={disabled}
              {...register('paymentInstruction.accountNumber' as never)}
              className="text-sm"
            />
          </FormField>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs font-semibold text-foreground">Payment Instruction</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pi-beneficiary" label="Beneficiary Name" error={errs['paymentInstruction.beneficiaryName']?.message}>
          <Input
            id="pi-beneficiary"
            placeholder="Full beneficiary name"
            disabled={disabled}
            {...register('paymentInstruction.beneficiaryName' as never)}
            className="text-sm"
          />
        </FormField>
        <FormField id="pi-bank" label="Bank Name" error={errs['paymentInstruction.bankName']?.message}>
          <Input
            id="pi-bank"
            placeholder="e.g. First Bank of Nigeria"
            disabled={disabled}
            {...register('paymentInstruction.bankName' as never)}
            className="text-sm"
          />
        </FormField>
        <FormField id="pi-account-number" label="Account Number" error={errs['paymentInstruction.accountNumber']?.message}>
          <Input
            id="pi-account-number"
            placeholder="10-digit NUBAN"
            maxLength={10}
            disabled={disabled}
            {...register('paymentInstruction.accountNumber' as never)}
            className="text-sm"
          />
        </FormField>
        <FormField id="pi-account-type" label="Account Type" error={errs['paymentInstruction.accountType']?.message}>
          <Input
            id="pi-account-type"
            placeholder="e.g. SAVINGS, CURRENT"
            disabled={disabled}
            {...register('paymentInstruction.accountType' as never)}
            className="text-sm"
          />
        </FormField>
        {/* FIX: was missing — required by superRefine() for external transfers */}
        <FormField
          id="pi-amount"
          label="Transfer Amount"
          hint="Pre-filled from net amount — edit for partial withdrawals"
          error={errs['paymentInstruction.amount']?.message}
        >
          <Input
            id="pi-amount"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 5000000.00"
            disabled={disabled}
            {...register('paymentInstruction.amount' as never)}
            className="text-sm"
          />
        </FormField>
        {/* FIX: was missing — required by superRefine() for external transfers.
            Kept read-only/disabled since the server always recomputes the
            authoritative 0.10% charge; still registered so it's present
            in the submitted payload instead of being permanently undefined. */}
        <FormField
          id="pi-transfer-charge"
          label="Transfer Charge (estimated)"
          required={false}
          hint="Server recalculates the authoritative 0.10% charge on submit"
          error={errs['paymentInstruction.transferCharge']?.message}
        >
          <Input
            id="pi-transfer-charge"
            type="text"
            inputMode="decimal"
            disabled
            {...register('paymentInstruction.transferCharge' as never)}
            className="text-sm"
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormField id="pi-purpose" label="Transfer Purpose" required={false} error={errs['paymentInstruction.purpose']?.message}>
            <Input
              id="pi-purpose"
              placeholder="Purpose of transfer"
              disabled={disabled}
              {...register('paymentInstruction.purpose' as never)}
              className="text-sm"
            />
          </FormField>
        </div>
      </div>
    </div>
  )
}

// ─── Finalised Voucher Display ────────────────────────────────────────────────

/**
 * Shows a completed/finalised voucher in read-only form.
 * Switches on voucher_type to render the correct layout (Req 11.3–11.6).
 */
function FinalisedVoucherDisplay({
  voucher,
  transactionType,
}: {
  voucher: NonNullable<TransactionWorkspace['voucher']>
  transactionType?: string
}) {
  const isFinalised = voucher.status === 'FINALISED'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Receipt className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {SAVINGS_FUNDS_OUT_TYPES.has(transactionType ?? '')
                ? getFundsOutLabel(transactionType ?? '')
                : VOUCHER_TYPE_LABELS[voucher.voucher_type as VoucherType] ?? voucher.voucher_type}
            </p>
            <Badge
              variant={isFinalised ? 'default' : 'secondary'}
              className={isFinalised ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}
            >
              {isFinalised ? 'Finalised' : 'Draft'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Voucher #{voucher.voucher_number} · Generated {formatDateTime(voucher.created_at)}
          </p>
        </div>
      </div>

      <Separator />

      {/* Content per voucher type */}
      {voucher.voucher_type === 'FUNDS_IN' && (
        <FundsInVoucherContent voucher={voucher} />
      )}
      {voucher.voucher_type === 'FUNDS_OUT' && (
        <FundsOutVoucherContent voucher={voucher} />
      )}
      {voucher.voucher_type === 'ROLLOVER_SLIP' && (
        <RolloverSlipContent voucher={voucher} />
      )}
      {voucher.voucher_type === 'TRANSFER_SLIP' && (
        <TransferSlipContent voucher={voucher} />
      )}

      {/* Payment instruction block */}
      {voucher.payment_instruction && (
        <PaymentInstructionBlock
          instruction={voucher.payment_instruction as Record<string, unknown> | Record<string, unknown>[]}
          transactionType={transactionType}
        />
      )}
    </div>
  )
}

// ─── FUNDS_IN voucher content (Req 11.4) ─────────────────────────────────────

function FundsInVoucherContent({ voucher }: { voucher: NonNullable<TransactionWorkspace['voucher']> }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown>
  const inputs = snap?.inputs as Record<string, string> | undefined
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <Field label="Amount" value={formatCurrency(voucher.net_amount)} />
      <Field label="Interest Rate" value={(inputs?.rate ?? inputs?.interest_rate) ? formatRate((inputs?.rate ?? inputs?.interest_rate)!) : '—'} />
      <Field label="Tenor (days)" value={inputs?.tenor ?? '—'} />
      <Field label="Effective Date" value={inputs?.effective_date ?? '—'} />
      <Field label="Maturity Date" value={inputs?.maturity_date ?? '—'} />
      <Field label="Transfer Date" value={voucher.transfer_date ?? '—'} />
      {voucher.remarks && (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">Remarks</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{voucher.remarks}</dd>
        </div>
      )}
    </dl>
  )
}

// ─── FUNDS_OUT voucher content (Req 11.3) ─────────────────────────────────────

function FundsOutVoucherContent({ voucher }: { voucher: NonNullable<TransactionWorkspace['voucher']> }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown> | null
  const outputs = snap?.outputs as Record<string, string> | undefined
  const inputs = snap?.inputs as Record<string, string> | undefined

  const isPartialPreLiquidation =
    (snap?.rule as string | undefined) === 'PRE_LIQUIDATION_20_PERCENT' &&
    Boolean(inputs?.requested_payout && Number(inputs.requested_payout) > 0)

  const isThirdPartyTransfer =
    (snap?.rule as string | undefined) === 'THIRD_PARTY_TRANSFER_0_10_PERCENT'

  const isInternalTransfer = isThirdPartyTransfer && inputs?.is_internal === 'true'

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {voucher.available_balance ? (
        <Field label="Available Balance" value={formatCurrency(voucher.available_balance)} />
      ) : (
        <Field label={isThirdPartyTransfer ? 'Transfer Amount' : 'Principal'} value={formatCurrency(voucher.principal)} />
      )}
      {!isThirdPartyTransfer && (
        <Field label="Interest" value={formatCurrency(voucher.interest)} />
      )}
      {!isThirdPartyTransfer && (
        <Field label="WHT" value={formatCurrency(voucher.wht ?? '0')} />
      )}
      {!isThirdPartyTransfer && (
        <Field label="Charge (20% of accrued interest)" value={formatCurrency(voucher.charge ?? '0')} />
      )}
      {isThirdPartyTransfer && (
        <>
          <Field
            label="Transfer Charge (0.10%)"
            value={
              <span className={isInternalTransfer ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                {isInternalTransfer
                  ? '₦0.00 (internal transfer)'
                  : formatCurrency(outputs?.transfer_charge ?? voucher.charge ?? '0')}
              </span>
            }
          />
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Calculation Rule</dt>
            <dd className="mt-1 font-mono text-xs text-muted-foreground">
              THIRD_PARTY_TRANSFER_0_10_PERCENT
              {isInternalTransfer ? ' (internal — charge = ₦0)' : ' (external — charge = amount × 0.001)'}
            </dd>
          </div>
        </>
      )}
      {isPartialPreLiquidation && (
        <>
          <Field label="Requested Payout" value={formatCurrency(inputs?.requested_payout ?? '0')} />
          <Field label="Remaining Principal (= Principal − Payout)" value={formatCurrency(outputs?.remaining_principal ?? '—')} />
          <Field label="Rebooked Principal (= Remaining − Charge)" value={formatCurrency(outputs?.rebooked_principal ?? '—')} />
        </>
      )}
      <div className="sm:col-span-2 flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Net Amount:</span>
        <span className="text-sm font-semibold text-foreground">{formatCurrency(voucher.net_amount)}</span>
      </div>
      <Field label="Transfer Date" value={voucher.transfer_date ?? '—'} />
      {voucher.remarks && (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">Remarks</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{voucher.remarks}</dd>
        </div>
      )}
    </dl>
  )
}

// ─── ROLLOVER_SLIP voucher content (Req 11.5) ─────────────────────────────────

function RolloverSlipContent({ voucher }: { voucher: NonNullable<TransactionWorkspace['voucher']> }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown>
  const outputs = snap?.outputs as Record<string, string> | undefined
  const inputs = snap?.inputs as Record<string, string> | undefined

  // Detect PRINCIPAL_ONLY scenario from the calculation snapshot rule
  const isPrincipalOnly =
    (snap?.rule as string | undefined) === 'ROLLOVER_PRINCIPAL_ONLY'

  // Detect PARTIAL_PRINCIPAL scenario from the calculation snapshot rule
  const isPartialPrincipal =
    (snap?.rule as string | undefined) === 'ROLLOVER_PARTIAL_PRINCIPAL'

  // Detect INTEREST_ONLY scenario from the calculation snapshot rule
  const isInterestOnly =
    (snap?.rule as string | undefined) === 'ROLLOVER_INTEREST_ONLY'

  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Principal Amount" value={formatCurrency(voucher.principal)} />
        <Field label="Interest Due" value={formatCurrency(voucher.interest)} />
        {isPartialPrincipal && inputs?.requested_payout && (
          <Field label="Requested Payout" value={formatCurrency(inputs.requested_payout)} />
        )}
        {isPartialPrincipal && outputs?.remaining_principal && (
          <Field label="Remaining Principal (Rolled)" value={formatCurrency(outputs.remaining_principal)} />
        )}
        <Field label="Effective Date" value={inputs?.effective_date ?? '—'} />
        <Field label="New Tenor (days)" value={inputs?.new_tenor ?? '—'} />
        <Field label="New Rate" value={inputs?.new_rate ? formatRate(inputs.new_rate) : '—'} />
        <Field label="Rollover Amount (reinvested)" value={formatCurrency(outputs?.rollover_amount ?? voucher.net_amount)} />
        <Field label="Rollover Maturity Date" value={inputs?.rollover_maturity_date ?? '—'} />
        {outputs?.interest_paid && (
          <Field label="Interest Payout (Funds-Out)" value={formatCurrency(outputs.interest_paid)} />
        )}
        {voucher.remarks && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Remarks</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{voucher.remarks}</dd>
          </div>
        )}
      </dl>
      {isPrincipalOnly && (
        <Alert>
          <AlertTitle>Linked interest payout transaction</AlertTitle>
          <AlertDescription>
            A linked Funds-Out transaction was automatically created for the interest payout
            of {formatCurrency(outputs?.interest_paid ?? voucher.interest)}. You can find it
            in the transaction list referencing this rollover.
          </AlertDescription>
        </Alert>
      )}
      {isInterestOnly && (
        <Alert>
          <AlertTitle>Interest Only — principal stays invested</AlertTitle>
          <AlertDescription>
            The principal of {formatCurrency(voucher.principal)} remains active and was NOT terminated.
            A linked Funds-Out transaction was automatically created for the interest payout
            of {formatCurrency(outputs?.interest_paid ?? voucher.interest)}.
          </AlertDescription>
        </Alert>
      )}
      {isPartialPrincipal && (
        <Alert>
          <AlertTitle>Partial Principal Rollover</AlertTitle>
          <AlertDescription>
            Original principal: {formatCurrency(voucher.principal)} · Requested payout: {formatCurrency(inputs?.requested_payout ?? '0')} · Remaining principal rolled: {formatCurrency(outputs?.remaining_principal ?? '0')}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ─── TRANSFER_SLIP voucher content (Req 11.6) ─────────────────────────────────

function TransferSlipContent({ voucher }: { voucher: NonNullable<TransactionWorkspace['voucher']> }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown> | null
  const scenarioCode = snap
    ? ((snap.scenario_code ?? (snap.inputs as Record<string, unknown> | undefined)?.scenario_code) as string | undefined)
    : undefined

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {scenarioCode && (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">Scenario</dt>
          <dd className="mt-1 font-mono text-xs text-muted-foreground">{scenarioCode}</dd>
        </div>
      )}
      <Field label="Transfer Amount" value={formatCurrency(voucher.net_amount)} />
      <Field label="Transfer Date" value={voucher.transfer_date ?? '—'} />
      {voucher.remarks && (
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">Remarks</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{voucher.remarks}</dd>
        </div>
      )}
    </dl>
  )
}

// ─── Payment Instruction Block (Req 36) ───────────────────────────────────────

function PaymentInstructionBlock({
  instruction,
  transactionType,
}: {
  instruction: Record<string, unknown> | Record<string, unknown>[]
  transactionType?: string
}) {
  // Normalise to array — single object or array both handled
  const entries: Record<string, unknown>[] = Array.isArray(instruction) ? instruction : [instruction]
  const isCotTransaction = transactionType === 'CALL_FUNDS_OUT' || transactionType === 'CMS_FUNDS_OUT'

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs font-semibold text-foreground">
          Payment {entries.length > 1 ? `Instructions (${entries.length})` : 'Instruction'}
        </p>
      </div>
      {entries.map((instr, idx) => {
        const isInternal = instr.is_internal === true || instr.is_internal === 'true' ||
          instr.isInternal === true || instr.isInternal === 'true'
        const transferCharge = String(instr.transfer_charge ?? instr.transferCharge ?? '0')
        return (
          <div key={idx} className={entries.length > 1 ? 'border-t border-border/60 pt-3 first:border-t-0 first:pt-0' : ''}>
            {entries.length > 1 && (
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">Beneficiary {idx + 1}</p>
            )}
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Beneficiary Name" value={String(instr.beneficiary_name ?? instr.beneficiaryName ?? '—')} />
              <Field label="Bank Name" value={String(instr.bank_name ?? instr.bankName ?? '—')} />
              <Field label="Account Number" value={String(instr.account_number ?? instr.accountNumber ?? '—')} />
              <Field label="Account Type" value={String(instr.account_type ?? instr.accountType ?? '—')} />
              <Field label="Amount" value={formatCurrency(String(instr.amount ?? '0'))} />
              {!isCotTransaction && (
                <Field
                  label={isInternal ? 'Transfer Charge' : 'Transfer Charge (0.10%)'}
                  value={
                    <span className={isInternal || parseFloat(transferCharge) === 0 ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                      {isInternal ? '₦0.00 (internal — no charge)' : formatCurrency(transferCharge)}
                    </span>
                  }
                />
              )}
              {Boolean(instr.purpose) && (
                <Field label="Purpose" value={String(instr.purpose)} />
              )}
            </dl>
          </div>
        )
      })}
    </div>
  )
}

// ─── Variant forms ────────────────────────────────────────────────────────────

interface VariantFormProps {
  disabled: boolean
  register: ReturnType<typeof useForm<VoucherPreparationInput>>['register']
  watch: ReturnType<typeof useForm<VoucherPreparationInput>>['watch']
  setValue: ReturnType<typeof useForm<VoucherPreparationInput>>['setValue']
  errors: ReturnType<typeof useForm<VoucherPreparationInput>>['formState']['errors']
  snapshot: NonNullable<TransactionWorkspace['investmentVerification']>
  /** Optional scenario code for scenario-specific UI hints */
  scenarioCode?: string | null
  /** Optional transaction type for type-specific UI hints */
  transactionType?: string
  /** Whether this THIRD_PARTY_PAYMENT is an internal transfer (Req 21.1, 21.3) */
  isInternalPayment?: boolean
  /**
   * For Savings/Call/CMS: a ref the child form can write a sync callback into.
   * The parent calls it before submit to flush PI entries into RHF state.
   * Returns false if PI validation failed.
   */
  piSyncRef?: React.MutableRefObject<(() => boolean) | null>
  /**
   * For Savings/Call/CMS: a ref the parent owns. The child validates PI entries
   * and writes the clean array directly here — bypassing RHF entirely.
   * onSubmit reads from this ref and passes it straight to prepareVoucherAction.
   */
  piDataRef?: React.MutableRefObject<Record<string, unknown> | Record<string, unknown>[] | null>
  /**
   * For Savings/Call/CMS resubmission: existing payment_instruction(s) from the
   * previously-prepared voucher that was returned. Used to seed piEntries on mount.
   */
  existingVoucherPi?: Record<string, unknown> | Record<string, unknown>[] | null
}

// ─── Multi-entry payment instruction row type ─────────────────────────────────

interface PiEntry {
  id: string
  beneficiaryName: string
  bankName: string
  accountNumber: string
  accountType: string
  amount: string
  purpose: string
}

function makePiEntry(id: string): PiEntry {
  return { id, beneficiaryName: '', bankName: '', accountNumber: '', accountType: '', amount: '', purpose: '' }
}

const ACCOUNT_TYPE_OPTS = ['SAVINGS', 'CURRENT', 'DOMICILIARY', 'CORPORATE', 'CMS', 'CALL', 'COMMERCIAL_PAPER', 'PERSONAL']

// ─── Savings/Call/CMS Funds-Out form (Req 38) ────────────────────────────────

/**
 * Simplified Funds-Out form for SAVINGS_FUNDS_OUT, CALL_FUNDS_OUT, CMS_FUNDS_OUT.
 *
 * Per Req 38.2: Available Balance is the primary field. The standard
 * principal/interest/WHT/charge fields are NOT shown. Interest is sourced
 * from Eazybankz and not internally calculated (Req 38.4).
 *
 * For CALL_FUNDS_OUT and CMS_FUNDS_OUT: a COT rate selector is shown
 * (₦2/mille or ₦5/mille per the COT SOP). The COT charge is computed
 * server-side and displayed as a live preview.
 *
 * Multiple payment instruction entries are supported — the entries are
 * serialised as a JSON array and written into the single paymentInstruction
 * field before the RHF form submission fires.
 *
 * Requirements: 38.1, 38.2, 38.3, 38.4, 24.1, 24.2, 36.1, COT SOP
 */
function SavingsFundsOutForm({ disabled, register, errors, snapshot, transactionType, watch, setValue, piSyncRef, piDataRef, existingVoucherPi }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>
  const isCall = transactionType === 'CALL_FUNDS_OUT'
  const isCms = transactionType === 'CMS_FUNDS_OUT'
  const isCot = isCall || isCms
  const txTypeLabel = isCall ? 'Call' : isCms ? 'CMS' : 'Savings'

  // ── Payment instruction entries ─────────────────────────────────────────────
  // Seed from the previously-saved voucher PI when resubmitting a RETURNED transaction.
  const [piEntries, setPiEntries] = useState<PiEntry[]>(() => {
    if (existingVoucherPi) {
      const raw = Array.isArray(existingVoucherPi) ? existingVoucherPi : [existingVoucherPi]
      const seeded = raw.map(r => ({
        id: crypto.randomUUID(),
        beneficiaryName:  String(r.beneficiaryName ?? r.beneficiary_name ?? ''),
        bankName:         String(r.bankName         ?? r.bank_name        ?? ''),
        accountNumber:    String(r.accountNumber    ?? r.account_number   ?? ''),
        accountType:      String(r.accountType      ?? r.account_type     ?? ''),
        amount:           String(r.amount           ?? ''),
        purpose:          String(r.purpose          ?? ''),
      }))
      if (seeded.length > 0) return seeded
    }
    return [makePiEntry(crypto.randomUUID())]
  })
  const [piErrors, setPiErrors] = useState<Record<string, Partial<Record<keyof PiEntry, string>>>>({})

  const addPiEntry = useCallback(() => {
    // Validate the current last entry before allowing a new one to be added
    const last = piEntries[piEntries.length - 1]
    if (last) {
      const fieldErrors: Partial<Record<keyof PiEntry, string>> = {}
      if (!last.beneficiaryName.trim()) fieldErrors.beneficiaryName = 'Required'
      if (!last.bankName.trim())        fieldErrors.bankName = 'Required'
      if (!last.accountNumber.trim())   fieldErrors.accountNumber = 'Required'
      if (!last.amount.trim() || isNaN(parseFloat(last.amount)) || parseFloat(last.amount) <= 0) {
        fieldErrors.amount = 'Valid amount required'
      }
      if (Object.keys(fieldErrors).length > 0) {
        setPiErrors(prev => ({ ...prev, [last.id]: fieldErrors }))
        return // block adding until the current entry is complete
      }
    }
    setPiEntries(prev => [...prev, makePiEntry(crypto.randomUUID())])
  }, [piEntries])

  const removePiEntry = useCallback((id: string) => {
    setPiEntries(prev => prev.length > 1 ? prev.filter(e => e.id !== id) : prev)
    setPiErrors(prev => { const next = { ...prev }; delete next[id]; return next })
  }, [])

  const updatePiEntry = useCallback((id: string, field: keyof PiEntry, value: string) => {
    setPiEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    // Clear field error on change
    setPiErrors(prev => {
      const entry = prev[id]
      if (!entry) return prev
      const next = { ...entry }
      delete next[field]
      return { ...prev, [id]: next }
    })
  }, [])

  // Sync PI entries → RHF before the form submits.
  // Returns true if valid, false if validation fails.
  // PI is REQUIRED for these transaction types — an all-blank single entry is invalid.
  const syncPiToForm = useCallback(() => {
    const newErrors: Record<string, Partial<Record<keyof PiEntry, string>>> = {}
    let hasError = false

    // Validate every entry — PI is mandatory
    for (const e of piEntries) {
      const fieldErrors: Partial<Record<keyof PiEntry, string>> = {}
      if (!e.beneficiaryName.trim()) { fieldErrors.beneficiaryName = 'Required'; hasError = true }
      if (!e.bankName.trim())        { fieldErrors.bankName = 'Required'; hasError = true }
      if (!e.accountNumber.trim())   { fieldErrors.accountNumber = 'Required'; hasError = true }
      if (!e.amount.trim() || isNaN(parseFloat(e.amount)) || parseFloat(e.amount) <= 0) {
        fieldErrors.amount = 'Valid amount required'; hasError = true
      }
      if (Object.keys(fieldErrors).length) newErrors[e.id] = fieldErrors
    }

    // Balance check — total must not exceed net amount (after COT for Call/CMS).
    // Read netAmount from RHF — it's kept in sync by the COT useEffect.
    const netAmountStr = (watch?.('netAmount' as never) as unknown) as string | undefined
    const availBal = parseFloat(snapshot.available_amount ?? '0')
    const spendable = isCot && netAmountStr && parseFloat(netAmountStr) > 0
      ? parseFloat(netAmountStr)
      : availBal
    const totalAmount = piEntries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
    if (!hasError && isFinite(spendable) && spendable > 0 && totalAmount > spendable) {
      for (const e of piEntries) {
        newErrors[e.id] = {
          ...(newErrors[e.id] ?? {}),
          amount: `Total (${formatCurrency(String(totalAmount))}) exceeds ${isCot ? 'net amount after COT' : 'available balance'} (${formatCurrency(String(spendable))})`,
        }
      }
      hasError = true
    }

    if (hasError) { setPiErrors(newErrors); return false }

    setPiErrors({})
    // Strip the internal `id` field (React key) before persisting
    const toSave = piEntries.map(({ id: _id, ...rest }) => rest)
    // Write directly to the parent's data ref — bypasses RHF entirely.
    // RHF cannot hold arrays through hidden inputs so we skip setValue here.
    if (piDataRef) {
      piDataRef.current = toSave.length === 1 ? toSave[0] : toSave
    }
    return true
  }, [piEntries, piDataRef, isCot, watch, snapshot.available_amount])

  // Register sync fn into parent ref so onSubmit can call it
  useEffect(() => {
    if (piSyncRef) piSyncRef.current = syncPiToForm
    return () => { if (piSyncRef) piSyncRef.current = null }
  }, [piSyncRef, syncPiToForm])

  // ── COT preview ─────────────────────────────────────────────────────────────
  const watchedAvailBal = (watch?.('availableBalance' as never) as unknown) as string | undefined
  const watchedCotTier  = (watch?.('cotRateTier' as never) as unknown) as string | undefined
  const availVal = parseFloat(watchedAvailBal ?? snapshot.available_amount ?? '0')
  const ratePerMille = watchedCotTier === 'MILLE_5' ? 5 : watchedCotTier === 'MILLE_2' ? 2 : null
  const estimatedCot =
    ratePerMille !== null && isFinite(availVal) && availVal > 0
      ? (Math.round((ratePerMille * availVal) / 1000 * 1e4) / 1e4)
      : null
  const estimatedNetAmount =
    isCot && estimatedCot !== null
      ? (Math.round((availVal - estimatedCot) * 1e4) / 1e4)
      : availVal

  // Push snapshot values into RHF on mount / snapshot change.
  // Using setValue here because the hidden inputs (principal, interest, wht, charge)
  // use a static value="0" in JSX which RHF ignores — setValue is the only way to
  // ensure RHF's internal store has the correct value at submit time.
  useEffect(() => {
    if (!setValue) return
    const avail = snapshot.available_amount ?? '0'
    // Numeric fields for the Zod schema
    setValue('principal' as never, '0' as never, { shouldValidate: false })
    setValue('interest' as never, '0' as never, { shouldValidate: false })
    setValue('wht' as never, '0' as never, { shouldValidate: false })
    setValue('charge' as never, '0' as never, { shouldValidate: false })
    setValue('availableBalance' as never, avail as never, { shouldValidate: false })
    setValue('netAmount' as never, avail as never, { shouldValidate: false })
    if (isCot) {
      setValue('transactionTypeHint' as never, transactionType as never, { shouldValidate: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.available_amount])

  // Keep COT-derived values in sync
  useEffect(() => {
    if (!setValue || !isCot) return
    if (estimatedCot !== null) {
      setValue('cotCharge' as never, String(estimatedCot) as never, { shouldValidate: false })
      setValue('netAmount' as never, String(estimatedNetAmount) as never, { shouldValidate: false })
    }
  }, [estimatedCot, estimatedNetAmount, isCot, setValue])

  return (
    <div className="space-y-4">
      {/* Contextual notice */}
      <Alert>
        <AlertTitle>{txTypeLabel} Funds-Out — Available Balance{isCot ? ' + COT Charge' : ''}</AlertTitle>
        <AlertDescription className="space-y-1">
          <span className="block">
            The <strong>Available Balance</strong> is sourced from the investment verification snapshot.
            No interest calculation is applied.
          </span>
          {isCot && (
            <span className="block">
              <strong>COT (Commission on Turnover)</strong> applies to {txTypeLabel} transactions.
              Select the applicable rate — ₦2 per mille or ₦5 per mille — before preparing the voucher.
              Formula: COT = (Rate × Transaction Value) ÷ 1,000.
            </span>
          )}
        </AlertDescription>
      </Alert>

      {/* Hidden fields managed via setValue in useEffect above */}
      <input type="hidden" {...(register('principal' as never))} />
      <input type="hidden" {...(register('interest' as never))} />
      <input type="hidden" {...(register('wht' as never))} />
      <input type="hidden" {...(register('charge' as never))} />
      {isCot && <input type="hidden" {...(register('transactionTypeHint' as never))} />}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Available Balance */}
        <FormField
          id="sfo-available-balance"
          label="Available Balance (₦)"
          hint={`Snapshot: ${formatCurrency(snapshot.available_amount)}`}
          error={errs.availableBalance?.message}
        >
          <Input
            id="sfo-available-balance"
            type="text"
            inputMode="decimal"
            disabled={disabled}
            {...register('availableBalance' as never)}
            className="text-sm"
          />
        </FormField>

        {/* Net Amount */}
        <FormField
          id="sfo-net-amount"
          label="Net Amount (₦)"
          hint={isCot ? 'Available Balance minus COT Charge' : 'Equals the available balance for this type'}
          error={errs.netAmount?.message}
        >
          <Input
            id="sfo-net-amount"
            type="text"
            inputMode="decimal"
            readOnly={isCot}
            disabled={disabled}
            {...register('netAmount' as never)}
            className={`text-sm ${isCot ? 'bg-muted/40 font-medium' : ''}`}
          />
        </FormField>

        {/* COT Rate — Call and CMS only */}
        {isCot && (
          <>
            <FormField
              id="sfo-cot-rate"
              label="COT Rate Tier"
              hint="Select the applicable Commission on Turnover rate"
              error={errs.cotRateTier?.message}
            >
              <select
                id="sfo-cot-rate"
                disabled={disabled}
                {...(register('cotRateTier' as never))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Select rate…</option>
                <option value="MILLE_2">₦2 per mille (₦2 per ₦1,000)</option>
                <option value="MILLE_5">₦5 per mille (₦5 per ₦1,000)</option>
              </select>
            </FormField>

            <FormField
              id="sfo-cot-charge"
              label="COT Charge (estimated)"
              required={false}
              hint="Server recomputes the authoritative COT on submit"
              error={errs.cotCharge?.message}
            >
              <Input
                id="sfo-cot-charge"
                type="text"
                inputMode="decimal"
                disabled
                value={estimatedCot !== null ? formatCurrency(String(estimatedCot)) : '—'}
                readOnly
                className="text-sm bg-muted/40 font-medium"
              />
              <input type="hidden" {...(register('cotCharge' as never))} />
            </FormField>

            {estimatedCot !== null && ratePerMille !== null && (
              <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5 space-y-1">
                <p className="text-xs font-semibold text-amber-800">COT Calculation Preview</p>
                <p className="font-mono text-xs text-amber-700">
                  COT = (₦{ratePerMille} × {formatCurrency(String(availVal))}) ÷ 1,000 = {formatCurrency(String(estimatedCot))}
                </p>
                <p className="font-mono text-xs text-amber-700">
                  Net Amount = {formatCurrency(String(availVal))} − {formatCurrency(String(estimatedCot))} = {formatCurrency(String(estimatedNetAmount))}
                </p>
              </div>
            )}
          </>
        )}

        <FormField id="sfo-transfer-date" label="Transfer Date" error={errs.transferDate?.message}>
          <Input id="sfo-transfer-date" type="date" disabled={disabled} {...register('transferDate' as never)} className="text-sm" />
        </FormField>
      </div>

      <FormField id="sfo-remarks" label="Remarks" required={false} error={errs.remarks?.message}>
        <Textarea id="sfo-remarks" rows={2} maxLength={1000} placeholder="Optional remarks…" disabled={disabled} {...register('remarks' as never)} className="resize-none text-sm" />
      </FormField>

      {/* ── Payment Instructions (multi-entry) ────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-xs font-semibold text-foreground">
              Payment Instructions
              <span className="ml-1.5 font-normal text-muted-foreground">(optional — add one per beneficiary)</span>
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={addPiEntry}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="size-3" />
              Add beneficiary
            </button>
          )}
        </div>

        {/* Live balance tracker */}
        {(() => {
          // estimatedNetAmount = availVal when no COT rate selected yet,
          // = availVal - COT once rate is chosen.
          const spendable = estimatedNetAmount
          const total = piEntries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
          const remaining = spendable - total
          const isOver = total > spendable && spendable > 0
          if (total <= 0) return null
          const cotPending = isCot && estimatedCot === null
          return (
            <div className={`rounded-md px-3 py-2 text-xs space-y-0.5 ${
              isOver
                ? 'bg-destructive/10 border border-destructive/30 text-destructive'
                : 'bg-muted/40 border border-border text-muted-foreground'
            }`}>
              <div className="flex items-center justify-between gap-3">
                <span>Total allocated: <strong>{formatCurrency(String(total))}</strong></span>
                <span>
                  {isOver
                    ? `Exceeds net by ${formatCurrency(String(Math.abs(remaining)))}`
                    : `Remaining: ${formatCurrency(String(remaining))}`}
                </span>
              </div>
              {cotPending && (
                <p className="text-[10px] text-amber-600">
                  Select a COT rate above — remaining will update once the net amount is computed.
                </p>
              )}
              {isCot && estimatedCot !== null && (
                <p className="text-[10px] text-muted-foreground/70">
                  Based on net after COT: {formatCurrency(String(spendable))}
                </p>
              )}
            </div>
          )
        })()}

        {piEntries.map((entry, idx) => {
          const entryErrs = piErrors[entry.id] ?? {}
          return (
            <div
              key={entry.id}
              className="rounded-lg border border-border bg-muted/20 p-4 space-y-3"
            >
              {/* Row header */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Beneficiary {idx + 1}
                </p>
                {piEntries.length > 1 && !disabled && (
                  <button
                    type="button"
                    onClick={() => removePiEntry(entry.id)}
                    className="inline-flex size-6 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                    aria-label={`Remove beneficiary ${idx + 1}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Beneficiary Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Beneficiary Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="Full legal name"
                    disabled={disabled}
                    value={entry.beneficiaryName}
                    onChange={e => updatePiEntry(entry.id, 'beneficiaryName', e.target.value)}
                    className="text-sm"
                  />
                  {entryErrs.beneficiaryName && (
                    <p className="text-xs text-destructive">{entryErrs.beneficiaryName}</p>
                  )}
                </div>

                {/* Bank Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Bank Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. First Bank of Nigeria"
                    disabled={disabled}
                    value={entry.bankName}
                    onChange={e => updatePiEntry(entry.id, 'bankName', e.target.value)}
                    className="text-sm"
                  />
                  {entryErrs.bankName && (
                    <p className="text-xs text-destructive">{entryErrs.bankName}</p>
                  )}
                </div>

                {/* Account Number */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Account Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="10-digit NUBAN"
                    maxLength={10}
                    inputMode="numeric"
                    disabled={disabled}
                    value={entry.accountNumber}
                    onChange={e => updatePiEntry(entry.id, 'accountNumber', e.target.value)}
                    className="text-sm"
                  />
                  {entryErrs.accountNumber && (
                    <p className="text-xs text-destructive">{entryErrs.accountNumber}</p>
                  )}
                </div>

                {/* Account Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Account Type</Label>
                  <select
                    disabled={disabled}
                    value={entry.accountType}
                    onChange={e => updatePiEntry(entry.id, 'accountType', e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Select type…</option>
                    {ACCOUNT_TYPE_OPTS.map(t => (
                      <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>

                {/* Amount */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Amount (₦) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 1500000.00"
                    disabled={disabled}
                    value={entry.amount}
                    onChange={e => updatePiEntry(entry.id, 'amount', e.target.value)}
                    className="text-sm"
                  />
                  {entryErrs.amount && (
                    <p className="text-xs text-destructive">{entryErrs.amount}</p>
                  )}
                </div>

                {/* Purpose */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Purpose</Label>
                  <Input
                    placeholder="Optional purpose / narration"
                    disabled={disabled}
                    value={entry.purpose}
                    onChange={e => updatePiEntry(entry.id, 'purpose', e.target.value)}
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

    </div>
  )
}

function FundsInForm({ disabled, register, errors }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="fi-amount" label="Amount (₦)" error={errs.amount?.message}>
          <Input id="fi-amount" type="text" inputMode="decimal" placeholder="e.g. 5000000.00" disabled={disabled} {...register('amount' as never)} className="text-sm" />
        </FormField>
        <FormField id="fi-rate" label="Interest Rate (%)" error={errs.rate?.message}>
          <Input id="fi-rate" type="text" inputMode="decimal" placeholder="e.g. 18.5" disabled={disabled} {...register('rate' as never)} className="text-sm" />
        </FormField>
        <FormField id="fi-tenor" label="Tenor (days)" error={errs.tenor?.message}>
          <Input id="fi-tenor" type="number" placeholder="e.g. 90" min={1} disabled={disabled} {...register('tenor' as never, { valueAsNumber: true })} className="text-sm" />
        </FormField>
        <FormField id="fi-transfer-date" label="Transfer Date" error={errs.transferDate?.message}>
          <Input id="fi-transfer-date" type="date" disabled={disabled} {...register('transferDate' as never)} className="text-sm" />
        </FormField>
        <FormField id="fi-effective-date" label="Effective Date" error={errs.effectiveDate?.message}>
          <Input id="fi-effective-date" type="date" disabled={disabled} {...register('effectiveDate' as never)} className="text-sm" />
        </FormField>
        <FormField id="fi-maturity-date" label="Maturity Date" error={errs.maturityDate?.message}>
          <Input id="fi-maturity-date" type="date" disabled={disabled} {...register('maturityDate' as never)} className="text-sm" />
        </FormField>
      </div>
      <FormField id="fi-remarks" label="Remarks" required={false} error={errs.remarks?.message}>
        <Textarea id="fi-remarks" rows={2} maxLength={1000} placeholder="Optional remarks…" disabled={disabled} {...register('remarks' as never)} className="resize-none text-sm" />
      </FormField>
    </div>
  )
}

function FundsOutForm({ disabled, register, errors, snapshot, transactionType, scenarioCode, watch, setValue, isInternalPayment }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>
  const isPreLiquidation = transactionType === 'PRE_LIQUIDATION'
  const isThirdParty = transactionType === 'THIRD_PARTY_PAYMENT'

  // Partial pre-liquidation: PRE_LIQUIDATION transaction with a requestedPayout value.
  // The scenarioCode is not set on PRE_LIQUIDATION (unlike ROLLOVER); instead the user
  // enters a requestedPayout amount which triggers the partial path server-side (Req 19.2).
  const watchedPayout = (watch?.('requestedPayout' as never) as unknown) as string | undefined
  const watchedNetAmount = (watch?.('netAmount' as never) as unknown) as string | undefined
  const isPartialPreLiquidation = isPreLiquidation && Boolean(watchedPayout && Number(watchedPayout) > 0)

  // Live intermediate values for partial pre-liquidation display (Req 19.2)
  const principal = parseFloat(snapshot.principal)
  const accruedInterest = parseFloat(snapshot.accrued_interest)
  const parsedPayout = isPartialPreLiquidation ? parseFloat(watchedPayout!) : NaN
  const charge = isFinite(accruedInterest) ? Math.round(accruedInterest * 0.2 * 1e4) / 1e4 : 0
  const netInterest = isFinite(accruedInterest) ? Math.round((accruedInterest - charge) * 1e4) / 1e4 : 0
  const remainingPrincipal =
    isPartialPreLiquidation && isFinite(parsedPayout) && parsedPayout > 0 && parsedPayout < principal
      ? Math.round((principal - parsedPayout) * 1e4) / 1e4
      : null
  const rebookedPrincipal =
    remainingPrincipal !== null
      ? Math.round((remainingPrincipal - charge) * 1e4) / 1e4
      : null

  // Third-party charge preview — estimated client-side (0.10%); server is authoritative (Req 21.2)
  const parsedNetAmount = watchedNetAmount ? parseFloat(watchedNetAmount) : NaN
  const estimatedThirdPartyCharge =
    isThirdParty && isFinite(parsedNetAmount) && parsedNetAmount > 0
      ? Math.round(parsedNetAmount * 0.001 * 1e4) / 1e4
      : null

  // FIX: keep paymentInstruction.amount / transferCharge in sync with the
  // top-level netAmount for external third-party payments, so the user isn't
  // asked to enter the same number twice and the two values can't silently
  // diverge. Only auto-fills paymentInstruction.amount while the user hasn't
  // typed a different value into that field directly.
  //
  // FIX (SOP 3 — Partial Pre-Liquidation): per the SOP, the customer receives
  // the full requested payout amount. The charge is deducted from the rebooked
  // principal, NOT from the customer's payout. Auto-fill netAmount = requestedPayout
  // so the Treasury Officer doesn't have to re-enter the same number, and the
  // two values stay consistent.
  useEffect(() => {
    if (!setValue) return

    // Partial pre-liquidation: netAmount = requestedPayout (SOP 3 — customer gets full requested amount)
    if (isPreLiquidation && isPartialPreLiquidation && parsedPayout > 0 && isFinite(parsedPayout)) {
      setValue('netAmount' as never, String(parsedPayout) as never, { shouldValidate: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedPayout, isPreLiquidation, isPartialPreLiquidation])

  useEffect(() => {
    if (!isThirdParty || isInternalPayment) return
    if (!setValue || !watch) return

    // Always keep paymentInstruction.amount in sync with netAmount so it's
    // pre-filled and stays up to date if the net amount changes (e.g. COT rate
    // selection changes the net amount for Call/CMS transactions).
    if (watchedNetAmount) {
      setValue('paymentInstruction.amount' as never, watchedNetAmount as never, { shouldValidate: false })
    }
    if (estimatedThirdPartyCharge !== null) {
      setValue(
        'paymentInstruction.transferCharge' as never,
        String(estimatedThirdPartyCharge) as never,
        { shouldValidate: false },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedNetAmount, estimatedThirdPartyCharge, isThirdParty, isInternalPayment])

  return (
    <div className="space-y-4">
      {/* Hidden fields so Zod .superRefine() can route validation correctly (Req 36.2, 21.4) */}
      {isThirdParty && (
        <>
          <input type="hidden" {...(register('transactionTypeHint' as never))} value="THIRD_PARTY_PAYMENT" />
          <input type="hidden" {...(register('isInternal' as never))} value={isInternalPayment ? "true" : "false"} />
        </>
      )}

      {isPreLiquidation && !isPartialPreLiquidation && (
        <Alert>
          <AlertTitle>Pre-Liquidation — Full (20% charge on accrued interest)</AlertTitle>
          <AlertDescription>
            Per SOP 3: charge = 20% × accrued interest. Net amount = principal + accrued interest − charge.
            The charge and net amount have been pre-filled from the investment snapshot. Confirm before preparing the voucher.
            To process a partial pre-liquidation instead, enter a requested payout amount below.
          </AlertDescription>
        </Alert>
      )}
      {isPreLiquidation && isPartialPreLiquidation && (
        <Alert>
          <AlertTitle>Partial Pre-Liquidation — SOP 3</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block text-xs font-semibold text-muted-foreground">Per SOP 3:</span>
            <span className="block">
              Customer receives full requested payout: <strong>{formatCurrency(String(parsedPayout))}</strong> — charge does NOT reduce the customer payout.
            </span>
            <span className="block">
              Remaining principal (principal − payout):{' '}
              <strong>
                {remainingPrincipal !== null
                  ? formatCurrency(String(remainingPrincipal))
                  : 'Enter a valid payout amount'}
              </strong>
            </span>
            <span className="block">
              20% charge on accrued interest:{' '}
              <strong>{formatCurrency(String(charge))}</strong>
            </span>
            <span className="block">
              Rebooked principal (remaining − charge):{' '}
              <strong>
                {rebookedPrincipal !== null
                  ? formatCurrency(String(rebookedPrincipal))
                  : '—'}
              </strong>
            </span>
            <span className="block">
              Net Amount (Funds-Out to customer) = Requested Payout: <strong>{formatCurrency(String(parsedPayout))}</strong>
            </span>
            <span className="block text-xs text-muted-foreground">
              Authoritative values computed server-side via PostgreSQL NUMERIC. These are estimates only.
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Third-party payment notice — internal vs external (Req 21.1, 21.2, 21.3, 21.4) */}
      {isThirdParty && isInternalPayment && (
        <Alert>
          <AlertTitle>Internal Transfer — No Transfer Charge</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">
              Rule: <strong>THIRD_PARTY_TRANSFER_0_10_PERCENT</strong> (internal path) — transfer_charge = 0.
            </span>
            <span className="block text-xs text-muted-foreground">
              This is an intra-company transfer. No transfer charge applies.
              Enter the internal account details in the Payment Instruction block below.
            </span>
          </AlertDescription>
        </Alert>
      )}
      {isThirdParty && !isInternalPayment && (
        <Alert>
          <AlertTitle>Third-Party External Payment — 0.10% Transfer Charge</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">
              Rule: <strong>THIRD_PARTY_TRANSFER_0_10_PERCENT</strong> — transfer charge = transfer amount × 0.001.
            </span>
            {estimatedThirdPartyCharge !== null && (
              <span className="block">
                Estimated charge on{' '}
                <strong>{formatCurrency(String(parsedNetAmount))}</strong>:{' '}
                <strong className="tabular-nums">{formatCurrency(String(estimatedThirdPartyCharge))}</strong>
              </span>
            )}
            <span className="block text-xs text-muted-foreground">
              The server computes the authoritative charge via PostgreSQL NUMERIC and overwrites
              any client-supplied value. All 6 Payment Instruction fields are required (Req 36.2).
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* For THIRD_PARTY_PAYMENT: show "Transfer Amount" label instead of "Principal" */}
        <FormField
          id="fo-principal"
          label={isThirdParty ? 'Transfer Amount (₦)' : 'Principal (₦)'}
          hint={isThirdParty ? 'The gross amount being transferred to the beneficiary' : `Snapshot: ${formatCurrency(snapshot.principal)}`}
          error={errs.principal?.message}
        >
          <Input
            id="fo-principal"
            type="text"
            inputMode="decimal"
            disabled={disabled}
            {...register('principal' as never)}
            className="text-sm"
          />
        </FormField>
        {/* Interest field — hidden for THIRD_PARTY_PAYMENT (no interest component) */}
        {!isThirdParty && (
          <FormField id="fo-interest" label="Interest (₦)" hint={`Snapshot: ${formatCurrency(snapshot.accrued_interest)}`} error={errs.interest?.message}>
            <Input id="fo-interest" type="text" inputMode="decimal" defaultValue={snapshot.accrued_interest} disabled={disabled} {...register('interest' as never)} className="text-sm" />
          </FormField>
        )}
        {!isThirdParty && (
          <FormField id="fo-wht" label="WHT (₦)" hint="Defaults to 0 per SOP" error={errs.wht?.message}>
            <Input id="fo-wht" type="text" inputMode="decimal" defaultValue="0" disabled={disabled} {...register('wht' as never)} className="text-sm" />
          </FormField>
        )}
        {/* Charge — hidden for THIRD_PARTY_PAYMENT; server computes from PI block (Req 21.2) */}
        {!isThirdParty && (
          <FormField id="fo-charge" label="Charge (₦)" hint={isPreLiquidation ? '20% of accrued interest (PRE_LIQUIDATION_20_PERCENT rule)' : 'Pre-liquidation or transfer charge'} error={errs.charge?.message}>
            <Input id="fo-charge" type="text" inputMode="decimal" defaultValue="0" disabled={disabled} {...register('charge' as never)} className="text-sm" />
          </FormField>
        )}
        {/* Hidden defaults for THIRD_PARTY_PAYMENT so Zod schema passes numeric validation */}
        {isThirdParty && (
          <>
            <input type="hidden" {...(register('interest' as never))} value="0" />
            <input type="hidden" {...(register('wht' as never))} value="0" />
            <input type="hidden" {...(register('charge' as never))} value="0" />
          </>
        )}
        {isPreLiquidation && (
          <FormField
            id="fo-requested-payout"
            label="Requested Payout (₦)"
            required={false}
            hint="Leave blank for full pre-liquidation; enter amount for partial pre-liquidation (Req 19.2)"
            error={errs.requestedPayout?.message}
          >
            <Input
              id="fo-requested-payout"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 2000000.00 (optional)"
              disabled={disabled}
              {...register('requestedPayout' as never)}
              className="text-sm"
            />
          </FormField>
        )}
        <FormField
          id="fo-net-amount"
          label={isThirdParty ? 'Net Amount / Transfer Amount (₦)' : 'Net Amount (₦)'}
          hint={
            isThirdParty
              ? 'Enter the transfer amount; the Payment Instruction amount below stays in sync automatically'
              : isPartialPreLiquidation
                ? 'Auto-filled from Requested Payout (SOP 3: customer receives full requested amount)'
                : 'Server will validate against snapshot'
          }
          error={errs.netAmount?.message}
        >
          <Input id="fo-net-amount" type="text" inputMode="decimal" placeholder="Computed net amount" disabled={disabled} {...register('netAmount' as never)} className="text-sm" />
        </FormField>
        <FormField id="fo-transfer-date" label="Transfer Date" error={errs.transferDate?.message}>
          <Input id="fo-transfer-date" type="date" disabled={disabled} {...register('transferDate' as never)} className="text-sm" />
        </FormField>
      </div>
      <FormField id="fo-remarks" label="Remarks" required={false} error={errs.remarks?.message}>
        <Textarea id="fo-remarks" rows={2} maxLength={1000} placeholder="Optional remarks…" disabled={disabled} {...register('remarks' as never)} className="resize-none text-sm" />
      </FormField>
    </div>
  )
}

function RolloverSlipForm({ disabled, register, errors, snapshot, scenarioCode }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>
  const isPrincipalOnly = scenarioCode === 'PRINCIPAL_ONLY'
  const isPartialPrincipal = scenarioCode === 'PARTIAL_PRINCIPAL'
  const isInterestOnly = scenarioCode === 'INTEREST_ONLY'
  return (
    <div className="space-y-4">
      {isPrincipalOnly && (
        <Alert>
          <AlertTitle>Principal Only Rollover</AlertTitle>
          <AlertDescription>
            The principal will be reinvested. The interest due ({formatCurrency(snapshot.accrued_interest)}) will be
            paid out via a linked Funds-Out transaction created automatically after voucher preparation. Confirm
            the interest payout amount below.
          </AlertDescription>
        </Alert>
      )}
      {isInterestOnly && (
        <Alert>
          <AlertTitle>Interest Only Rollover</AlertTitle>
          <AlertDescription>
            The principal investment ({formatCurrency(snapshot.principal)}) remains active and is NOT terminated.
            Only the accrued interest ({formatCurrency(snapshot.accrued_interest)}) will be paid out via a linked
            Funds-Out transaction created automatically after voucher preparation. Confirm the interest payout
            amount below.
          </AlertDescription>
        </Alert>
      )}
      {isPartialPrincipal && (
        <Alert>
          <AlertTitle>Partial Principal Rollover</AlertTitle>
          <AlertDescription>
            A portion of the principal will be paid out as requested. The remaining principal
            (original principal − requested payout) will be rolled over and reinvested.
            Confirm the requested payout amount below before preparing the voucher.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="rs-principal" label="Principal Amount (₦)" hint={`Snapshot: ${formatCurrency(snapshot.principal)}`} error={errs.principalAmount?.message}>
          <Input id="rs-principal" type="text" inputMode="decimal" placeholder={snapshot.principal} disabled={disabled} {...register('principalAmount' as never)} className="text-sm" />
        </FormField>
        <FormField id="rs-interest-due" label="Interest Due (₦)" hint={`Snapshot: ${formatCurrency(snapshot.accrued_interest)}`} error={errs.interestDue?.message}>
          <Input id="rs-interest-due" type="text" inputMode="decimal" placeholder={snapshot.accrued_interest} disabled={disabled} {...register('interestDue' as never)} className="text-sm" />
        </FormField>
        {isPartialPrincipal && (
          <FormField
            id="rs-requested-payout"
            label="Requested Payout (₦)"
            hint="Amount to be paid out from principal"
            error={errs.requestedPayout?.message}
          >
            <Input id="rs-requested-payout" type="text" inputMode="decimal" placeholder="e.g. 2000000.00" disabled={disabled} {...register('requestedPayout' as never)} className="text-sm" />
          </FormField>
        )}
        <FormField id="rs-effective-date" label="Effective Date" error={errs.effectiveDate?.message}>
          <Input id="rs-effective-date" type="date" disabled={disabled} {...register('effectiveDate' as never)} className="text-sm" />
        </FormField>
        <FormField id="rs-new-tenor" label="New Tenor (days)" error={errs.newTenor?.message}>
          <Input id="rs-new-tenor" type="number" placeholder="e.g. 90" min={1} disabled={disabled} {...register('newTenor' as never, { valueAsNumber: true })} className="text-sm" />
        </FormField>
        <FormField id="rs-new-rate" label="New Rate (%)" hint={`Current: ${formatRate(snapshot.interest_rate)}`} error={errs.newRate?.message}>
          <Input id="rs-new-rate" type="text" inputMode="decimal" placeholder="e.g. 19.5" disabled={disabled} {...register('newRate' as never)} className="text-sm" />
        </FormField>
        <FormField
          id="rs-rollover-amount"
          label="Rollover Amount (₦)"
          hint={
            isPrincipalOnly
              ? 'Principal only — interest is paid out separately'
              : isInterestOnly
              ? 'Principal stays invested — interest paid out separately'
              : isPartialPrincipal
              ? 'Remaining principal after payout — computed server-side'
              : 'Computed server-side; enter for confirmation'
          }
          error={errs.rolloverAmount?.message}
        >
          <Input id="rs-rollover-amount" type="text" inputMode="decimal" placeholder="e.g. 10000000.00" disabled={disabled} {...register('rolloverAmount' as never)} className="text-sm" />
        </FormField>
        <FormField id="rs-maturity-date" label="Rollover Maturity Date" error={errs.rolloverMaturityDate?.message}>
          <Input id="rs-maturity-date" type="date" disabled={disabled} {...register('rolloverMaturityDate' as never)} className="text-sm" />
        </FormField>
        <FormField
          id="rs-interest-payout"
          label="Interest Payout (₦)"
          required={isPrincipalOnly || isInterestOnly}
          hint={
            isPrincipalOnly
              ? 'Required — equals the accrued interest from the snapshot'
              : isInterestOnly
              ? 'Required — equals the accrued interest paid out via linked Funds-Out'
              : 'For PRINCIPAL_ONLY / INTEREST_ONLY rollovers'
          }
          error={errs.interestPayout?.message}
        >
          <Input id="rs-interest-payout" type="text" inputMode="decimal" placeholder={isPrincipalOnly || isInterestOnly ? snapshot.accrued_interest : 'Optional'} disabled={disabled} {...register('interestPayout' as never)} className="text-sm" />
        </FormField>
      </div>
      <FormField id="rs-remarks" label="Remarks" required={false} error={errs.remarks?.message}>
        <Textarea id="rs-remarks" rows={2} maxLength={1000} placeholder="Optional remarks…" disabled={disabled} {...register('remarks' as never)} className="resize-none text-sm" />
      </FormField>
    </div>
  )
}

function TransferSlipForm({ disabled, register, errors, snapshot, scenarioCode, transactionType }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>

  const isSavingsToPersonal = scenarioCode === 'SAVINGS_TO_PERSONAL'
  const isPersonalToCommercialPaper = scenarioCode === 'PERSONAL_TO_COMMERCIAL_PAPER'
  const isPersonalToCallPlacement = scenarioCode === 'PERSONAL_TO_CALL_PLACEMENT'
  const isReversal = transactionType === 'REVERSAL'

  return (
    <div className="space-y-4">
      {/* REVERSAL-specific contextual notice (Req 22.1, 25.1–25.5) */}
      {isReversal && (
        <Alert>
          <AlertTitle>Reversal Transaction — Transfer Slip</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">
              This is a <strong>REVERSAL</strong> transaction. A <strong>Transfer Slip</strong> voucher is
              generated automatically (Req 11.1, 11.6).
            </span>
            <span className="block">
              The transfer amount should match the original transaction amount.
              On Operations execution, <strong>eazybankzAdapter.reverseTransaction()</strong> will be
              called to reverse the original Eazybankz posting (Req 25.3).
            </span>
            <span className="block text-xs text-muted-foreground">
              The original transaction is preserved — its status is not changed by this reversal (Req 25.1).
              Confirm the transfer amount and date below before preparing the voucher.
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Scenario-specific contextual notice (Req 22.1) */}
      {isSavingsToPersonal && (
        <Alert>
          <AlertTitle>Savings → Personal — Transfer Slip</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">
              Scenario: <strong>SAVINGS_TO_PERSONAL</strong> — funds moving from a Savings account to a Personal account.
            </span>
            <span className="block">
              Available balance (snapshot): <strong>{formatCurrency(snapshot.available_amount)}</strong>.
              The transfer amount must not exceed this value (Req 22.2).
            </span>
            <span className="block text-xs text-muted-foreground">
              The server enforces the balance check before the voucher can be saved.
              Voucher preparation will be rejected if the transfer amount exceeds available balance.
            </span>
          </AlertDescription>
        </Alert>
      )}
      {isPersonalToCommercialPaper && (
        <Alert>
          <AlertTitle>Personal → Commercial Paper — Transfer Slip</AlertTitle>
          <AlertDescription>
            Scenario: <strong>PERSONAL_TO_COMMERCIAL_PAPER</strong> — funds transferred to a Commercial Paper placement.
            Available balance (snapshot): <strong>{formatCurrency(snapshot.available_amount)}</strong>.
          </AlertDescription>
        </Alert>
      )}
      {isPersonalToCallPlacement && (
        <Alert>
          <AlertTitle>Personal → Call Placement — Transfer Slip</AlertTitle>
          <AlertDescription>
            Scenario: <strong>PERSONAL_TO_CALL_PLACEMENT</strong> — funds transferred to a Call Placement.
            Available balance (snapshot): <strong>{formatCurrency(snapshot.available_amount)}</strong>.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="ts-amount"
          label="Transfer Amount (₦)"
          hint={
            isSavingsToPersonal || isPersonalToCommercialPaper || isPersonalToCallPlacement
              ? `Must not exceed available balance: ${formatCurrency(snapshot.available_amount)}`
              : undefined
          }
          error={errs.amount?.message}
        >
          <Input id="ts-amount" type="text" inputMode="decimal" placeholder="e.g. 5000000.00" disabled={disabled} {...register('amount' as never)} className="text-sm" />
        </FormField>
        <FormField id="ts-transfer-date" label="Transfer Date" error={errs.transferDate?.message}>
          <Input id="ts-transfer-date" type="date" disabled={disabled} {...register('transferDate' as never)} className="text-sm" />
        </FormField>
        <FormField id="ts-source" label="Source Account Number" required={false} error={errs.sourceAccountNumber?.message}>
          <Input id="ts-source" type="text" placeholder="Optional" disabled={disabled} {...register('sourceAccountNumber' as never)} className="text-sm" />
        </FormField>
        <FormField id="ts-dest" label="Destination Account Number" required={false} error={errs.destinationAccountNumber?.message}>
          <Input id="ts-dest" type="text" placeholder="Optional" disabled={disabled} {...register('destinationAccountNumber' as never)} className="text-sm" />
        </FormField>
      </div>
      <FormField id="ts-remarks" label="Remarks" required={false} error={errs.remarks?.message}>
        <Textarea id="ts-remarks" rows={2} maxLength={1000} placeholder="Optional remarks…" disabled={disabled} {...register('remarks' as never)} className="resize-none text-sm" />
      </FormField>
    </div>
  )
}

// ─── Build default form values per voucher type ───────────────────────────────

function buildDefaults(
  voucherType: VoucherType,
  snapshot: TransactionWorkspace['investmentVerification'],
  scenarioCode?: string | null,
  transactionType?: string,
  isInternalPayment?: boolean,
): Partial<VoucherPreparationInput> {
  const todayStr = today()

  if (voucherType === 'FUNDS_IN') {
    return {
      voucherType: 'FUNDS_IN',
      amount: snapshot?.available_amount ?? '',
      rate: snapshot?.interest_rate ?? '',
      tenor: 90,
      effectiveDate: snapshot?.effective_date ?? todayStr,
      maturityDate: snapshot?.maturity_date ?? '',
      transferDate: todayStr,
      remarks: '',
    } satisfies Partial<FundsInVoucherInput>
  }

  if (voucherType === 'FUNDS_OUT') {
    // For PRE_LIQUIDATION, pre-fill the 20% charge and net amount from the snapshot (Req 19.3, 19.4)
    const isPreLiquidation = transactionType === 'PRE_LIQUIDATION'
    const isThirdParty = transactionType === 'THIRD_PARTY_PAYMENT'
    // For SAVINGS/CALL/CMS Funds-Out: available_balance is the primary field (Req 38.1, 38.2)
    const isSavingsFundsOut = SAVINGS_FUNDS_OUT_TYPES.has(transactionType ?? '')
    const accruedInterest = parseFloat(snapshot?.accrued_interest ?? '0')
    const preLiqCharge = isPreLiquidation && isFinite(accruedInterest)
      ? (Math.round(accruedInterest * 0.20 * 1e4) / 1e4).toString()
      : '0'
    const preLiqNetInterest = isPreLiquidation && isFinite(accruedInterest)
      ? (Math.round((accruedInterest - parseFloat(preLiqCharge)) * 1e4) / 1e4).toString()
      : ''
    const principal = parseFloat(snapshot?.principal ?? '0')
    // For full PRE_LIQUIDATION: net amount = principal + net_interest (interest after charge deducted).
    // For partial PRE_LIQUIDATION: netAmount starts empty — it is auto-filled from requestedPayout
    // by the useEffect in FundsOutForm (SOP 3: customer receives full requested payout).
    const preLiqNetAmount = isPreLiquidation && isFinite(principal) && preLiqNetInterest
      ? (Math.round((principal + parseFloat(preLiqNetInterest)) * 1e4) / 1e4).toString()
      : ''

    // Savings/Call/CMS Funds-Out: pre-fill availableBalance from snapshot (Req 38.1)
    if (isSavingsFundsOut) {
      const availAmount = snapshot?.available_amount ?? ''
      return {
        voucherType: 'FUNDS_OUT',
        principal: '0',
        interest: '0',
        wht: '0',
        charge: '0',
        availableBalance: availAmount,
        netAmount: availAmount,
        transferDate: todayStr,
        remarks: '',
        cotRateTier: undefined,
        cotCharge: '0',
        transactionTypeHint: transactionType,
        // paymentInstruction is managed by SavingsFundsOutForm local state — not pre-filled here
        paymentInstruction: undefined,
      } satisfies Partial<FundsOutVoucherInput>
    }

    return {
      voucherType: 'FUNDS_OUT',
      // FIX: previously this always defaulted to snapshot.principal, even for
      // THIRD_PARTY_PAYMENT — but the "Principal" field is relabelled "Transfer
      // Amount" and left blank on purpose for that transaction type (the JSX
      // used `defaultValue={isThirdParty ? '' : snapshot.principal}`). Because
      // react-hook-form's `defaultValues` wins over a plain JSX `defaultValue`,
      // the field was silently pre-filled with the old snapshot principal
      // instead of being blank, and validation/submission used that stale
      // value without the user ever touching the field.
      principal: isThirdParty ? '' : (snapshot?.principal ?? ''),
      interest: snapshot?.accrued_interest ?? '',
      wht: '0',
      charge: isPreLiquidation ? preLiqCharge : '0',
      netAmount: isPreLiquidation ? preLiqNetAmount : '',
      // requestedPayout starts empty; the Treasury Officer fills it if partial
      requestedPayout: undefined,
      transferDate: todayStr,
      remarks: '',
      // Req 36.2, 21.4: thread transactionTypeHint and isInternal so
      // Zod .superRefine() can enforce all 6 PI fields for THIRD_PARTY_PAYMENT external
      transactionTypeHint: isThirdParty ? 'THIRD_PARTY_PAYMENT' : undefined,
      isInternal: isThirdParty ? (isInternalPayment ?? false) : undefined,
      // FIX: paymentInstruction.transferCharge previously had no default and
      // started as `undefined`/`''`, which fails the superRefine() check
      // `pi.transferCharge === ''` even before the server recalculates it.
      // Give it an explicit "0" starting value; the sync effect in
      // FundsOutForm keeps it updated as netAmount changes.
      paymentInstruction: isThirdParty
        ? {
            beneficiaryName: '',
            bankName: '',
            accountNumber: '',
            accountType: '',
            amount: '',
            transferCharge: '0',
            purpose: '',
            isInternal: isInternalPayment ?? false,
          }
        : undefined,
    } satisfies Partial<FundsOutVoucherInput>
  }

  if (voucherType === 'ROLLOVER_SLIP') {
    // For PRINCIPAL_ONLY:    rolloverAmount = principal; interestPayout pre-filled from snapshot
    // For INTEREST_ONLY:     rolloverAmount = principal (stays invested); interestPayout pre-filled
    // For PARTIAL_PRINCIPAL: rolloverAmount = remaining_principal (computed server-side after payout entry)
    // For P_AND_I:           rolloverAmount = principal + accrued_interest
    const isPrincipalOnly = scenarioCode === 'PRINCIPAL_ONLY'
    const isPartialPrincipal = scenarioCode === 'PARTIAL_PRINCIPAL'
    const isInterestOnly = scenarioCode === 'INTEREST_ONLY'
    const isPandI = !isPrincipalOnly && !isPartialPrincipal && !isInterestOnly

    let rolloverType: 'P_AND_I' | 'PRINCIPAL_ONLY' | 'PARTIAL_PRINCIPAL' | 'INTEREST_ONLY' = 'P_AND_I'
    if (isPrincipalOnly) rolloverType = 'PRINCIPAL_ONLY'
    else if (isPartialPrincipal) rolloverType = 'PARTIAL_PRINCIPAL'
    else if (isInterestOnly) rolloverType = 'INTEREST_ONLY'

    // Pre-compute rolloverAmount for scenarios where we know it from the snapshot.
    // This prevents Zod positiveNumericString failing on submit with an empty string.
    const snapshotPrincipal = parseFloat(snapshot?.principal ?? '0')
    const snapshotInterest = parseFloat(snapshot?.accrued_interest ?? '0')
    const pandIRollover =
      isPandI && isFinite(snapshotPrincipal) && isFinite(snapshotInterest)
        ? (Math.round((snapshotPrincipal + snapshotInterest) * 1e4) / 1e4).toString()
        : snapshot?.principal ?? ''

    return {
      voucherType: 'ROLLOVER_SLIP',
      rolloverType,
      principalAmount: snapshot?.principal ?? '',
      interestDue: snapshot?.accrued_interest ?? '',
      effectiveDate: snapshot?.effective_date ?? todayStr,
      newTenor: 90,
      // newRate: stored as decimal (0.125000) — display shows 12.5000%; pass as-is for the
      // RolloverSlipForm hint label and for persistence in the snapshot inputs.
      newRate: snapshot?.interest_rate ?? '',
      // Pre-fill rolloverAmount for all known scenarios so positiveNumericString validation passes:
      //   P_AND_I:        principal + interest_due
      //   PRINCIPAL_ONLY: principal (interest paid out separately)
      //   INTEREST_ONLY:  principal (stays invested)
      //   PARTIAL_PRINCIPAL: '' (Treasury Officer enters payout; server derives remaining)
      rolloverAmount: isPartialPrincipal
        ? ''
        : (isPandI ? pandIRollover : (snapshot?.principal ?? '')),
      rolloverMaturityDate: '',
      // Pre-fill interestPayout so the Treasury Officer can confirm it
      // Req 17.3 (PRINCIPAL_ONLY) / Req 17.5 (INTEREST_ONLY)
      interestPayout: (isPrincipalOnly || isInterestOnly)
        ? (snapshot?.accrued_interest ?? '')
        : undefined,
      // requestedPayout is entered by the Treasury Officer for PARTIAL_PRINCIPAL
      requestedPayout: isPartialPrincipal ? '' : undefined,
      remarks: '',
    } satisfies Partial<RolloverSlipVoucherInput>
  }

  // TRANSFER_SLIP
  return {
    voucherType: 'TRANSFER_SLIP',
    amount: snapshot?.available_amount ?? '',
    transferDate: todayStr,
    remarks: '',
  } satisfies Partial<TransferSlipVoucherInput>
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Step 5 — Voucher Generation Panel.
 *
 * Displays the auto-determined voucher type (server-resolved, not user-selectable — Req 11.1, 11.2),
 * a calculation preview from the investment snapshot, and a type-specific form.
 *
 * Behaviour:
 *   - Voucher type is derived from `transactionType` via `TX_TYPE_TO_VOUCHER_TYPE`; displayed
 *     as read-only — the user cannot override it.
 *   - Calculation preview shows investment snapshot inputs and estimated outputs.
 *   - Form renders the correct variant based on resolved voucher type.
 *   - Payment Instruction sub-form appears for scenarios where money leaves the company (Req 36).
 *   - On submit: calls `prepareVoucherAction`, shows Sonner toast.
 *   - Read-only / finalised voucher display once `voucher` record exists.
 *   - Visible and actionable only for TREASURY_OFFICER (canAct = true).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
 */
export default function Step5VoucherGeneration({
  transactionId,
  transactionType,
  scenarioCode,
  transactionStatus,
  investmentVerification,
  voucher,
  canAct,
  existingPaymentInstruction,
  existingDocument,
}: Step5VoucherGenerationProps) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // undefined = not yet hydrated → treat as online to avoid flicker
  const networkStatus = useNetworkStatus()
  const isOnline = networkStatus !== false

  // Ref that SavingsFundsOutForm writes its validated PI entries into.
  // We bypass RHF entirely for PI data — RHF can't hold arrays in hidden inputs.
  // Shape: null (untouched), false (validation failed), or the serialised entries.
  const piDataRef = React.useRef<Record<string, unknown> | Record<string, unknown>[] | null>(null)
  // Ref for the sync/validate callback — returns true if PI is valid, false if not
  const piSyncRef = React.useRef<(() => boolean) | null>(null)

  // Derive isInternalPayment from the transaction's payment instruction (Req 21.1, 21.3)
  const isInternalPayment = existingPaymentInstruction?.is_internal ?? false

  // Req 11.1 — server-resolved voucher type; frontend reads it, not user-selectable
  const resolvedVoucherType: VoucherType =
    TX_TYPE_TO_VOUCHER_TYPE[transactionType] ?? 'FUNDS_OUT'

  const requiresPaymentInstruction = transactionType === 'THIRD_PARTY_PAYMENT'
    || transactionType === 'MATURITY_TERMINATION'
    || transactionType === 'ANNIVERSARY_PAYMENT'
    || transactionType === 'PRE_LIQUIDATION'
    // SAVINGS/CALL/CMS handle payment instructions internally in SavingsFundsOutForm
    // ROLLOVER only needs a payment instruction for scenarios where money leaves the company
    || (transactionType === 'ROLLOVER' && (
      scenarioCode === 'PRINCIPAL_ONLY' ||
      scenarioCode === 'PARTIAL_PRINCIPAL' ||
      scenarioCode === 'INTEREST_ONLY'
    ))

  const defaults = buildDefaults(resolvedVoucherType, investmentVerification, scenarioCode, transactionType, isInternalPayment)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<VoucherPreparationInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(VoucherPreparationSchema) as any,
    defaultValues: defaults as VoucherPreparationInput,
  })

  // Reset the form whenever the investment snapshot changes so that
  // RHF's internal state reflects the pre-filled snapshot values.
  // RHF ignores HTML defaultValue on registered inputs — only
  // defaultValues / reset() populate the internal state correctly.
  //
  // FIX: previously this effect only depended on `investmentVerification?.id`,
  // so switching transactionType / scenarioCode / isInternalPayment while the
  // underlying investment stayed the same left the form holding defaults built
  // for the *previous* mode. Those stale values were then validated against
  // the *new* mode's Zod rules — which looked exactly like "a prefilled field
  // trips validation" even though the user never touched it. The effect now
  // re-syncs whenever any of the inputs to buildDefaults() change.
  useEffect(() => {
    reset(
      buildDefaults(
        resolvedVoucherType,
        investmentVerification,
        scenarioCode,
        transactionType,
        isInternalPayment,
      ) as VoucherPreparationInput,
    )
  }, [investmentVerification?.id, resolvedVoucherType, scenarioCode, transactionType, isInternalPayment])

  async function onSubmit(data: VoucherPreparationInput) {
    // For Savings/Call/CMS: validate PI entries and get the data from piDataRef.
    // piSyncRef.current() validates, writes to piDataRef, returns false on error.
    if (SAVINGS_FUNDS_OUT_TYPES.has(transactionType)) {
      if (piSyncRef.current) {
        const valid = piSyncRef.current()
        if (!valid) {
          setServerError('Please complete all payment instruction fields before preparing the voucher.')
          return
        }
      }
    }

    setSubmitting(true)
    setServerError(null)

    // Inject the PI data from the ref directly into the input object.
    const inputWithPi =
      SAVINGS_FUNDS_OUT_TYPES.has(transactionType) && piDataRef.current
        ? ({ ...data, paymentInstruction: piDataRef.current } as unknown as VoucherPreparationInput)
        : data

    // ── Offline path ──────────────────────────────────────────────────────
    if (!isOnline) {
      await enqueue({ type: 'PREPARE_VOUCHER', payload: { transactionId, input: inputWithPi } })
      setSubmitting(false)
      toast.warning("You're offline. Voucher saved and will be prepared when you reconnect.")
      return
    }

    const { prepareVoucherAction } = await import('@/lib/actions/voucher.actions') as {
      prepareVoucherAction: PrepareVoucherAction
    }

    const result = await prepareVoucherAction(transactionId, inputWithPi)
    setSubmitting(false)

    if (result.success) {
      toast.success(`Voucher #${result.data?.voucherNumber ?? ''} prepared successfully.`)
    } else {
      const msg = result.error ?? 'Voucher preparation failed. Please try again.'
      setServerError(msg)
      toast.error(msg)
    }
  }

  const disabled = !canAct || submitting

  // Watch requestedPayout for PARTIAL_PRINCIPAL live preview
  const watchedRequestedPayout = (watch('requestedPayout' as never) as unknown) as string | undefined

  // ── Read-only mode — voucher already exists (unless RETURNED for resubmission) ──

  const isReturned = transactionStatus === 'RETURNED'

  if (voucher && !isReturned) {
    return (
      <div className="voucher-panel space-y-5">
        <style>{PANEL_ANIMATION_STYLE}</style>
        <VoucherDisplay voucher={voucher} transactionType={transactionType} />
      </div>
    )
  }

  // ── Form mode ───────────────────────────────────────────────────────────────

  const formProps: VariantFormProps = {
    disabled,
    register,
    watch,
    setValue,
    errors,
    scenarioCode,
    transactionType,
    isInternalPayment,
    piSyncRef,
    piDataRef,
    existingVoucherPi: isReturned && voucher?.payment_instruction
      ? voucher.payment_instruction as Record<string, unknown> | Record<string, unknown>[]
      : null,
    snapshot: investmentVerification ?? {
      id: '', verified_by: '', source_system: 'EAZYBANKZ',
      principal: '0', accrued_interest: '0', interest_rate: '0',
      effective_date: today(), maturity_date: null,
      outstanding_balance: '0', available_amount: '0',
      verified_at: new Date().toISOString(),
    },
  }

  return (
    <div
      className="voucher-panel space-y-5"
    >
      <style>{PANEL_ANIMATION_STYLE}</style>

      {/* Return notice — shown when resubmitting after an approver returned the transaction */}
      {isReturned && (
        <Alert variant="destructive">
          <AlertTitle>Transaction Recalled for Correction</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">
              An approver has recalled this transaction. Review the recall comment in the
              Approval Chain section, make any necessary corrections, then re-prepare the
              voucher below to restart the approval chain.
            </span>
            {!canAct && (
              <span className="block font-medium">
                Only the Treasury Officer can edit and resubmit this voucher.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Req 11.1 / 11.2 — Voucher type display: server-resolved, read-only */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Voucher type:</span>
          <Badge variant="secondary" className="text-xs">
            {SAVINGS_FUNDS_OUT_TYPES.has(transactionType)
              ? getFundsOutLabel(transactionType)
              : VOUCHER_TYPE_LABELS[resolvedVoucherType]}
          </Badge>
          {scenarioCode && (
            <>
              <span className="text-xs text-muted-foreground/60">·</span>
              <Badge variant="outline" className="text-xs">
                {scenarioCode}
              </Badge>
            </>
          )}
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          Auto-determined from transaction type
        </span>
      </div>

      {/* No investment snapshot warning */}
      {!investmentVerification && transactionType !== 'INFLOW' && (
        <Alert>
          <AlertTitle>Investment snapshot not yet verified</AlertTitle>
          <AlertDescription>
            Step 4 (Investment Verification) must be completed before preparing the voucher.
            Calculation values will not be pre-filled.
          </AlertDescription>
        </Alert>
      )}

      {/* INFLOW: Step 4 is skipped by design — show informational notice instead of CalculationPreview */}
      {transactionType === 'INFLOW' && (
        <Alert>
          <AlertTitle>New Investment — Inflow</AlertTitle>
          <AlertDescription>
            INFLOW transactions create a brand-new investment. There is no existing investment
            to verify in Step 4 (Req 23.1). Enter the investment details below to generate the
            Funds-In voucher.
          </AlertDescription>
        </Alert>
      )}

      {/* Calculation preview — not shown for INFLOW (no investment snapshot) */}
      {investmentVerification && transactionType !== 'INFLOW' && (
        <CalculationPreview
          snapshot={investmentVerification}
          transactionType={transactionType}
          scenarioCode={scenarioCode}
          requestedPayout={watchedRequestedPayout}
          isInternalPayment={isInternalPayment}
        />
      )}

      {/* Server error */}
      {serverError && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit as Parameters<typeof handleSubmit>[0])} className="space-y-5" noValidate>
        {/* Variant-specific form fields */}
        {resolvedVoucherType === 'FUNDS_IN' && <FundsInForm {...formProps} />}
        {resolvedVoucherType === 'FUNDS_OUT' && SAVINGS_FUNDS_OUT_TYPES.has(transactionType) && <SavingsFundsOutForm {...formProps} />}
        {resolvedVoucherType === 'FUNDS_OUT' && !SAVINGS_FUNDS_OUT_TYPES.has(transactionType) && <FundsOutForm {...formProps} />}
        {resolvedVoucherType === 'ROLLOVER_SLIP' && <RolloverSlipForm {...formProps} />}
        {resolvedVoucherType === 'TRANSFER_SLIP' && <TransferSlipForm {...formProps} />}

        {/* Payment Instruction sub-form (Req 36) */}
        {requiresPaymentInstruction && (
          <PaymentInstructionSubForm
            disabled={disabled}
            register={register}
            errors={errors as Record<string, { message?: string } | undefined>}
            isInternalPayment={transactionType === 'THIRD_PARTY_PAYMENT' ? isInternalPayment : false}
          />
        )}

        {/* Submit / permission notice */}
        {canAct ? (
          <div className="flex flex-col gap-1.5 items-end pt-1">
            {!isOnline && (
              <span className="flex items-center gap-1.5 text-xs text-amber-700">
                <WifiOff className="size-3.5" aria-hidden />
                Offline — will sync on reconnect
              </span>
            )}
            <Button type="submit" disabled={submitting} size="sm">
              {submitting
                ? (isReturned ? 'Resubmitting…' : 'Preparing voucher…')
                : isOnline
                  ? (isReturned ? 'Resubmit Voucher' : 'Prepare Voucher')
                  : 'Save for later'}
            </Button>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Only a Treasury Officer can prepare the voucher.
          </p>
        )}
      </form>

      {/* Signed form upload — commented out, not needed in current flow */}
      {/* <div className="rounded-lg border border-border bg-muted/20 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Attach Signed Form <span className="text-destructive">*</span>
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Upload the physically signed instruction or mandate form before preparing the voucher.
        </p>
        <DocumentUpload
          transactionId={transactionId}
          defaultDocumentType="SIGNED_FORM"
          required
          existingDocument={existingDocument}
          onUploadSuccess={() => setDocumentUploaded(true)}
        />
      </div> */}
    </div>
  )
}