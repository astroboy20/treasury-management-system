'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Calculator,
  Receipt,
  ArrowRight,
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

// ─── Prop types ───────────────────────────────────────────────────────────────

interface Step5VoucherGenerationProps {
  transactionId: string
  transactionType: string
  scenarioCode: string | null
  /** The investment verification snapshot — used for calculation preview */
  investmentVerification: TransactionWorkspace['investmentVerification']
  /** Existing voucher — if present, panel is read-only / completed */
  voucher: TransactionWorkspace['voucher']
  /** Whether the current user can act (TREASURY_OFFICER) */
  canAct: boolean
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
  return `${num.toFixed(4)}%`
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

// ─── Animation style ──────────────────────────────────────────────────────────

const PANEL_ANIMATION_STYLE = `
  @keyframes fadeInPanel {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .voucher-panel { animation: none !important; }
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
}: {
  snapshot: NonNullable<TransactionWorkspace['investmentVerification']>
  transactionType: string
  scenarioCode?: string | null
  /** For PARTIAL_PRINCIPAL: the payout amount entered by the Treasury Officer */
  requestedPayout?: string | null
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
        <Field label="Interest Rate" value={formatRate(snapshot.interest_rate)} />
        <Field label="Available Amount" value={formatCurrency(snapshot.available_amount)} />
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
                  <p className="text-xs font-medium text-blue-700 mt-2">Partial pre-liquidation — intermediate values (Req 19.2)</p>
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
                <div className="sm:col-span-2">
                  <p className="text-xs text-blue-600/80">
                    Rule: rebooked_principal = remaining_principal − charge.
                    Authoritative values computed server-side via PostgreSQL NUMERIC.
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
                Transfer charge (external: 0.10%)
              </p>
            </div>
            <Field
              label="Estimated charge (0.10%)"
              value="Computed server-side at voucher preparation"
            />
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
      <p className="text-[10px] text-blue-600/70">
        Authoritative calculations run server-side using PostgreSQL NUMERIC arithmetic.
        Values shown here are estimates only.
      </p>
    </div>
  )
}

// ─── Payment Instruction Sub-form ─────────────────────────────────────────────

interface PaymentInstructionFormProps {
  disabled: boolean
  register: ReturnType<typeof useForm<VoucherPreparationInput>>['register']
  errors: Record<string, { message?: string } | undefined>
  fieldPrefix?: string
}

/**
 * Reusable payment instruction sub-form block (Req 36).
 * Shown for all voucher types where money leaves the company.
 */
function PaymentInstructionSubForm({ disabled, register, errors }: PaymentInstructionFormProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs font-semibold text-foreground">Payment Instruction</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pi-beneficiary" label="Beneficiary Name" error={(errors as Record<string, { message?: string }>)['paymentInstruction.beneficiaryName']?.message}>
          <Input
            id="pi-beneficiary"
            placeholder="Full beneficiary name"
            disabled={disabled}
            {...register('paymentInstruction.beneficiaryName' as never)}
            className="text-sm"
          />
        </FormField>
        <FormField id="pi-bank" label="Bank Name" error={(errors as Record<string, { message?: string }>)['paymentInstruction.bankName']?.message}>
          <Input
            id="pi-bank"
            placeholder="e.g. First Bank of Nigeria"
            disabled={disabled}
            {...register('paymentInstruction.bankName' as never)}
            className="text-sm"
          />
        </FormField>
        <FormField id="pi-account-number" label="Account Number" error={(errors as Record<string, { message?: string }>)['paymentInstruction.accountNumber']?.message}>
          <Input
            id="pi-account-number"
            placeholder="10-digit NUBAN"
            maxLength={10}
            disabled={disabled}
            {...register('paymentInstruction.accountNumber' as never)}
            className="text-sm"
          />
        </FormField>
        <FormField id="pi-account-type" label="Account Type" error={(errors as Record<string, { message?: string }>)['paymentInstruction.accountType']?.message}>
          <Input
            id="pi-account-type"
            placeholder="e.g. SAVINGS, CURRENT"
            disabled={disabled}
            {...register('paymentInstruction.accountType' as never)}
            className="text-sm"
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormField id="pi-purpose" label="Transfer Purpose" required={false} error={(errors as Record<string, { message?: string }>)['paymentInstruction.purpose']?.message}>
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
}: {
  voucher: NonNullable<TransactionWorkspace['voucher']>
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
              {VOUCHER_TYPE_LABELS[voucher.voucher_type as VoucherType] ?? voucher.voucher_type}
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
        <PaymentInstructionBlock instruction={voucher.payment_instruction} />
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
      <Field label="Interest Rate" value={inputs?.interest_rate ? formatRate(inputs.interest_rate) : '—'} />
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

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {voucher.available_balance ? (
        <Field label="Available Balance" value={formatCurrency(voucher.available_balance)} />
      ) : (
        <Field label="Principal" value={formatCurrency(voucher.principal)} />
      )}
      <Field label="Interest" value={formatCurrency(voucher.interest)} />
      <Field label="WHT" value={formatCurrency(voucher.wht ?? '0')} />
      <Field label="Charge (20% of interest)" value={formatCurrency(voucher.charge ?? '0')} />
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
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
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
}: {
  instruction: Record<string, unknown>
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs font-semibold text-foreground">Payment Instruction</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Beneficiary Name" value={String(instruction.beneficiary_name ?? instruction.beneficiaryName ?? '—')} />
        <Field label="Bank Name" value={String(instruction.bank_name ?? instruction.bankName ?? '—')} />
        <Field label="Account Number" value={String(instruction.account_number ?? instruction.accountNumber ?? '—')} />
        <Field label="Account Type" value={String(instruction.account_type ?? instruction.accountType ?? '—')} />
        <Field label="Transfer Charge" value={formatCurrency(String(instruction.transfer_charge ?? instruction.transferCharge ?? '0'))} />
        {Boolean(instruction.purpose) && (
          <Field label="Purpose" value={String(instruction.purpose)} />
        )}
      </dl>
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

function FundsOutForm({ disabled, register, errors, snapshot, transactionType, scenarioCode, watch }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>
  const isPreLiquidation = transactionType === 'PRE_LIQUIDATION'
  // Partial pre-liquidation: PRE_LIQUIDATION transaction with a requestedPayout value.
  // The scenarioCode is not set on PRE_LIQUIDATION (unlike ROLLOVER); instead the user
  // enters a requestedPayout amount which triggers the partial path server-side (Req 19.2).
  const watchedPayout = (watch?.('requestedPayout' as never) as unknown) as string | undefined
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

  return (
    <div className="space-y-4">
      {isPreLiquidation && !isPartialPreLiquidation && (
        <Alert>
          <AlertTitle>Pre-Liquidation — Full (20% charge)</AlertTitle>
          <AlertDescription>
            The 20% charge on accrued interest has been pre-filled below. Net amount = principal +
            (accrued interest − charge). Confirm these values before preparing the voucher.
            For a partial pre-liquidation, enter a requested payout amount below.
          </AlertDescription>
        </Alert>
      )}
      {isPreLiquidation && isPartialPreLiquidation && (
        <Alert>
          <AlertTitle>Partial Pre-Liquidation — Intermediate Values</AlertTitle>
          <AlertDescription className="space-y-1">
            <span className="block">
              Requested payout: <strong>{formatCurrency(String(parsedPayout))}</strong>
            </span>
            <span className="block">
              Remaining principal (= principal − payout):{' '}
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
              Rebooked principal (= remaining − charge):{' '}
              <strong>
                {rebookedPrincipal !== null
                  ? formatCurrency(String(rebookedPrincipal))
                  : '—'}
              </strong>
            </span>
            <span className="block text-xs text-muted-foreground">
              Authoritative values are computed server-side via PostgreSQL NUMERIC arithmetic.
              These previews are estimates only. Confirm before preparing the voucher.
            </span>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="fo-principal" label="Principal (₦)" hint={`Snapshot: ${formatCurrency(snapshot.principal)}`} error={errs.principal?.message}>
          <Input id="fo-principal" type="text" inputMode="decimal" defaultValue={snapshot.principal} disabled={disabled} {...register('principal' as never)} className="text-sm" />
        </FormField>
        <FormField id="fo-interest" label="Interest (₦)" hint={`Snapshot: ${formatCurrency(snapshot.accrued_interest)}`} error={errs.interest?.message}>
          <Input id="fo-interest" type="text" inputMode="decimal" defaultValue={snapshot.accrued_interest} disabled={disabled} {...register('interest' as never)} className="text-sm" />
        </FormField>
        <FormField id="fo-wht" label="WHT (₦)" hint="Defaults to 0 per SOP" error={errs.wht?.message}>
          <Input id="fo-wht" type="text" inputMode="decimal" defaultValue="0" disabled={disabled} {...register('wht' as never)} className="text-sm" />
        </FormField>
        <FormField id="fo-charge" label="Charge (₦)" hint={isPreLiquidation ? '20% of accrued interest (PRE_LIQUIDATION_20_PERCENT rule)' : 'Pre-liquidation or transfer charge'} error={errs.charge?.message}>
          <Input id="fo-charge" type="text" inputMode="decimal" defaultValue="0" disabled={disabled} {...register('charge' as never)} className="text-sm" />
        </FormField>
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
        <FormField id="fo-net-amount" label="Net Amount (₦)" hint="Server will validate against snapshot" error={errs.netAmount?.message}>
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
          <Input id="rs-principal" type="text" inputMode="decimal" defaultValue={snapshot.principal} disabled={disabled} {...register('principalAmount' as never)} className="text-sm" />
        </FormField>
        <FormField id="rs-interest-due" label="Interest Due (₦)" hint={`Snapshot: ${formatCurrency(snapshot.accrued_interest)}`} error={errs.interestDue?.message}>
          <Input id="rs-interest-due" type="text" inputMode="decimal" defaultValue={snapshot.accrued_interest} disabled={disabled} {...register('interestDue' as never)} className="text-sm" />
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

function TransferSlipForm({ disabled, register, errors }: VariantFormProps) {
  const errs = errors as Record<string, { message?: string } | undefined>
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="ts-amount" label="Transfer Amount (₦)" error={errs.amount?.message}>
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
    const accruedInterest = parseFloat(snapshot?.accrued_interest ?? '0')
    const preLiqCharge = isPreLiquidation && isFinite(accruedInterest)
      ? (Math.round(accruedInterest * 0.20 * 1e4) / 1e4).toString()
      : '0'
    const preLiqNetInterest = isPreLiquidation && isFinite(accruedInterest)
      ? (Math.round((accruedInterest - parseFloat(preLiqCharge)) * 1e4) / 1e4).toString()
      : ''
    const principal = parseFloat(snapshot?.principal ?? '0')
    // For full PRE_LIQUIDATION: net amount = principal + net_interest (interest after charge deducted)
    const preLiqNetAmount = isPreLiquidation && isFinite(principal) && preLiqNetInterest
      ? (Math.round((principal + parseFloat(preLiqNetInterest)) * 1e4) / 1e4).toString()
      : ''

    return {
      voucherType: 'FUNDS_OUT',
      principal: snapshot?.principal ?? '',
      interest: snapshot?.accrued_interest ?? '',
      wht: '0',
      charge: isPreLiquidation ? preLiqCharge : '0',
      netAmount: isPreLiquidation ? preLiqNetAmount : '',
      // requestedPayout starts empty; the Treasury Officer fills it if partial
      requestedPayout: undefined,
      transferDate: todayStr,
      remarks: '',
    } satisfies Partial<FundsOutVoucherInput>
  }

  if (voucherType === 'ROLLOVER_SLIP') {
    // For PRINCIPAL_ONLY:    rolloverAmount = principal; interestPayout pre-filled from snapshot
    // For INTEREST_ONLY:     rolloverAmount = principal (stays invested); interestPayout pre-filled
    // For PARTIAL_PRINCIPAL: rolloverAmount = remaining_principal (computed server-side)
    const isPrincipalOnly = scenarioCode === 'PRINCIPAL_ONLY'
    const isPartialPrincipal = scenarioCode === 'PARTIAL_PRINCIPAL'
    const isInterestOnly = scenarioCode === 'INTEREST_ONLY'

    let rolloverType: 'P_AND_I' | 'PRINCIPAL_ONLY' | 'PARTIAL_PRINCIPAL' | 'INTEREST_ONLY' = 'P_AND_I'
    if (isPrincipalOnly) rolloverType = 'PRINCIPAL_ONLY'
    else if (isPartialPrincipal) rolloverType = 'PARTIAL_PRINCIPAL'
    else if (isInterestOnly) rolloverType = 'INTEREST_ONLY'

    return {
      voucherType: 'ROLLOVER_SLIP',
      rolloverType,
      principalAmount: snapshot?.principal ?? '',
      interestDue: snapshot?.accrued_interest ?? '',
      effectiveDate: snapshot?.effective_date ?? todayStr,
      newTenor: 90,
      newRate: snapshot?.interest_rate ?? '',
      // For PRINCIPAL_ONLY / INTEREST_ONLY: rolloverAmount = principal (interest is paid out separately)
      // For PARTIAL_PRINCIPAL: rolloverAmount = remaining_principal (computed server-side after payout entry)
      rolloverAmount: (isPrincipalOnly || isInterestOnly) ? (snapshot?.principal ?? '') : '',
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
  investmentVerification,
  voucher,
  canAct,
}: Step5VoucherGenerationProps) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Req 11.1 — server-resolved voucher type; frontend reads it, not user-selectable
  const resolvedVoucherType: VoucherType =
    TX_TYPE_TO_VOUCHER_TYPE[transactionType] ?? 'FUNDS_OUT'

  const requiresPaymentInstruction = REQUIRES_PAYMENT_INSTRUCTION.has(transactionType)

  const defaults = buildDefaults(resolvedVoucherType, investmentVerification, scenarioCode, transactionType)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<VoucherPreparationInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(VoucherPreparationSchema) as any,
    defaultValues: defaults as VoucherPreparationInput,
  })

  async function onSubmit(data: VoucherPreparationInput) {
    setSubmitting(true)
    setServerError(null)

    // Dynamically import to avoid bundling server code with this client component
    const { prepareVoucherAction } = await import('@/lib/actions/voucher.actions') as {
      prepareVoucherAction: PrepareVoucherAction
    }

    const result = await prepareVoucherAction(transactionId, data)
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

  // ── Read-only mode — voucher already exists ─────────────────────────────────

  if (voucher) {
    return (
      <div
        className="voucher-panel"
        style={{ animation: 'fadeInPanel 200ms ease-out both' }}
      >
        <style>{PANEL_ANIMATION_STYLE}</style>
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="size-4 text-emerald-600 shrink-0" aria-hidden />
          <p className="text-xs font-medium text-emerald-700">
            Voucher prepared and locked.
          </p>
        </div>
        <FinalisedVoucherDisplay voucher={voucher} />
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
      style={{ animation: 'fadeInPanel 200ms ease-out both' }}
    >
      <style>{PANEL_ANIMATION_STYLE}</style>

      {/* Req 11.1 / 11.2 — Voucher type display: server-resolved, read-only */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Voucher type:</span>
          <Badge variant="secondary" className="text-xs">
            {VOUCHER_TYPE_LABELS[resolvedVoucherType]}
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
          auto-determined from transaction type
        </span>
      </div>

      {/* No investment snapshot warning */}
      {!investmentVerification && (
        <Alert>
          <AlertTitle>Investment snapshot not yet verified</AlertTitle>
          <AlertDescription>
            Step 4 (Investment Verification) must be completed before preparing the voucher.
            Calculation values will not be pre-filled.
          </AlertDescription>
        </Alert>
      )}

      {/* Calculation preview */}
      {investmentVerification && (
        <CalculationPreview
          snapshot={investmentVerification}
          transactionType={transactionType}
          scenarioCode={scenarioCode}
          requestedPayout={watchedRequestedPayout}
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
        {resolvedVoucherType === 'FUNDS_OUT' && <FundsOutForm {...formProps} />}
        {resolvedVoucherType === 'ROLLOVER_SLIP' && <RolloverSlipForm {...formProps} />}
        {resolvedVoucherType === 'TRANSFER_SLIP' && <TransferSlipForm {...formProps} />}

        {/* Payment Instruction sub-form (Req 36) */}
        {requiresPaymentInstruction && (
          <PaymentInstructionSubForm
            disabled={disabled}
            register={register}
            errors={errors as Record<string, { message?: string } | undefined>}
          />
        )}

        {/* Submit / permission notice */}
        {canAct ? (
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? 'Preparing voucher…' : 'Prepare Voucher'}
            </Button>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Only a Treasury Officer can prepare the voucher.
          </p>
        )}
      </form>
    </div>
  )
}
