/**
 * PaymentInstructionBlock — standalone payment instruction section component.
 *
 * Renders a clearly-labelled block showing: Beneficiary Name, Bank Name,
 * Account Number, Account Type, Amount, Transfer Charge, and optional Purpose.
 * Supports both a single instruction object and an array of entries (multi-beneficiary).
 *
 * Req 36.1 — displayed for all FUNDS_OUT and ROLLOVER_SLIP vouchers where
 *             money leaves the company.
 * Req 36.5 — must be a distinct, clearly labelled section separate from the
 *             main voucher fields. Transfer Charge shows as ₦0 for internal
 *             transfers.
 */

import { ArrowRight } from 'lucide-react'

// ─── PaymentInstructionData interface (Req 36.1) ──────────────────────────────

/**
 * Shape of the `payment_instruction` JSONB column.
 * Accepts both snake_case (DB) and camelCase variants for forward compatibility.
 */
export interface PaymentInstructionData {
  beneficiary_name?: string
  beneficiaryName?: string
  bank_name?: string
  bankName?: string
  account_number?: string
  accountNumber?: string
  account_type?: string
  accountType?: string
  amount?: string
  transfer_charge?: string
  transferCharge?: string
  purpose?: string
  /** Transaction type — threaded through so the block can suppress irrelevant fields */
  transaction_type?: string
  transactionType?: string
  is_internal?: boolean | string
  isInternal?: boolean | string
}

// ─── Local helpers ────────────────────────────────────────────────────────────

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

function Field({
  label,
  value,
  fullWidth = false,
}: {
  label: string
  value: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">
        {value ?? <span className="italic text-muted-foreground">—</span>}
      </dd>
    </div>
  )
}

// ─── Single entry renderer ────────────────────────────────────────────────────

function PaymentInstructionEntry({
  data,
  isCotTransaction,
  index,
  total,
}: {
  data: PaymentInstructionData
  isCotTransaction: boolean
  index: number
  total: number
}) {
  const beneficiaryName = data.beneficiary_name ?? data.beneficiaryName
  const bankName        = data.bank_name ?? data.bankName
  const accountNumber   = data.account_number ?? data.accountNumber
  const accountType     = data.account_type ?? data.accountType
  const transferCharge  = data.transfer_charge ?? data.transferCharge ?? '0'
  const isInternalTransfer =
    data.is_internal === true || data.is_internal === 'true' ||
    data.isInternal === true || data.isInternal === 'true'

  return (
    <div className={total > 1 ? 'border-t border-border/60 pt-3 first:border-t-0 first:pt-0' : ''}>
      {total > 1 && (
        <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
          Beneficiary {index + 1}
        </p>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Beneficiary Name" value={beneficiaryName ?? '—'} />
        <Field label="Bank Name" value={bankName ?? '—'} />
        <Field label="Account Number" value={accountNumber ?? '—'} />
        <Field label="Account Type" value={accountType ?? '—'} />
        <Field
          label="Amount"
          value={formatCurrency(typeof data.amount === 'string' ? data.amount : undefined)}
        />
        {!isCotTransaction && (
          <Field
            label={isInternalTransfer ? 'Transfer Charge' : 'Transfer Charge (0.10%)'}
            value={
              <span
                className={
                  isInternalTransfer || parseFloat(String(transferCharge)) === 0
                    ? 'text-muted-foreground'
                    : 'font-medium text-foreground'
                }
              >
                {isInternalTransfer
                  ? '₦0.00 (internal — no charge)'
                  : formatCurrency(String(transferCharge))}
              </span>
            }
          />
        )}
        {data.purpose && (
          <Field label="Purpose" value={String(data.purpose)} fullWidth />
        )}
      </dl>
    </div>
  )
}

// ─── PaymentInstructionBlock (Req 36.1, 36.5) ─────────────────────────────────

/**
 * Renders a distinct, clearly-labelled "Payment Instruction" section.
 * Accepts either a single instruction object or an array of entries.
 *
 * Used in FundsOutVoucher, SavingsFundsOutVoucher, and RolloverSlipVoucher
 * whenever `payment_instruction` is present on the voucher record.
 *
 * Transfer Charge is rendered as ₦0 (muted) for internal transfers (Req 36.5).
 * Transfer Charge is hidden entirely for CALL_FUNDS_OUT / CMS_FUNDS_OUT — those
 * transactions carry a COT charge (shown separately), not a 0.10% transfer fee.
 */
export function PaymentInstructionBlock({
  instruction,
  transactionType,
}: {
  instruction: Record<string, unknown> | Record<string, unknown>[]
  transactionType?: string
}) {
  // Normalise to array
  const entries = (Array.isArray(instruction) ? instruction : [instruction]) as PaymentInstructionData[]

  // Resolve transaction type from prop or first entry
  const firstEntry = entries[0] ?? {}
  const txType = transactionType ?? firstEntry.transaction_type ?? firstEntry.transactionType ?? ''
  const isCotTransaction = txType === 'CALL_FUNDS_OUT' || txType === 'CMS_FUNDS_OUT'

  return (
    <div
      className="rounded-lg border border-border bg-muted/20 p-4 space-y-3"
      role="region"
      aria-label="Payment Instruction"
    >
      <div className="flex items-center gap-2">
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {entries.length > 1 ? `Payment Instructions (${entries.length})` : 'Payment Instruction'}
        </p>
      </div>
      {entries.map((entry, idx) => (
        <PaymentInstructionEntry
          key={idx}
          data={entry}
          isCotTransaction={isCotTransaction}
          index={idx}
          total={entries.length}
        />
      ))}
    </div>
  )
}
