'use client'

/**
 * VoucherDisplay — reusable read-only voucher rendering components.
 *
 * Exports a single <VoucherDisplay> entry-point that switches on `voucher_type`
 * to render the correct layout per Req 11.3–11.6, 36, 38.2.
 *
 * Sub-components are also exported for use in approval/operations panels:
 *   - FundsOutVoucher      (Req 11.3) — standard Funds-Out layout
 *   - SavingsFundsOutVoucher (Req 38) — available_balance-first Funds-Out
 *   - FundsInVoucher       (Req 11.4)
 *   - RolloverSlipVoucher  (Req 11.5)
 *   - TransferSlipVoucher  (Req 11.6)
 *   - PaymentInstructionBlock (Req 36) — now in ./PaymentInstructionBlock
 *
 * Design notes:
 *   - All monetary values are formatted with ₦ and 2–4 decimal places.
 *   - The component is intentionally import-free from the form layer so it
 *     can be composed on approval and operations pages without form context.
 *   - Entry animation follows Emil Kowalski principles (opacity + subtle
 *     translateY, ease-out, under 300 ms, prefers-reduced-motion respected).
 */

import { Receipt, Banknote, Printer } from 'lucide-react'
import { PaymentInstructionBlock } from './PaymentInstructionBlock'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import type { VoucherType } from '@/lib/schemas/voucher.schema'

// ─── Voucher data shape (mirrors TransactionWorkspace['voucher']) ──────────────

export interface VoucherData {
  id: string
  voucher_number: string
  voucher_type: string
  status: string
  principal: string | null
  interest: string | null
  wht: string | null
  charge: string | null
  net_amount: string | null
  available_balance: string | null
  transfer_date: string | null
  remarks: string | null
  payment_instruction: Record<string, unknown> | null
  calculation_snapshot: Record<string, unknown>
  created_at: string
}

// ─── Transaction types that use the Savings/Call/CMS Funds-Out layout ─────────

const SAVINGS_TYPE_VOUCHERS = new Set([
  'SAVINGS_FUNDS_OUT',
  'CALL_FUNDS_OUT',
  'CMS_FUNDS_OUT',
])

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
  // Rates are stored as decimals (e.g. 0.125000 = 12.5%).
  // If the value is < 1 it's a decimal — multiply by 100 to get the percentage.
  // Values ≥ 1 are already in percentage form (legacy display).
  const pct = num < 1 ? num * 100 : num
  return `${pct.toFixed(4)}%`
}

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

// ─── Shared field display ─────────────────────────────────────────────────────

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

// ─── Voucher type label map ────────────────────────────────────────────────────

const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  FUNDS_IN: 'Funds-In Voucher',
  FUNDS_OUT: 'Funds-Out Voucher',
  ROLLOVER_SLIP: 'Rollover Slip',
  TRANSFER_SLIP: 'Transfer Slip',
}

// ─── FundsOutVoucher (Req 11.3) ───────────────────────────────────────────────

/**
 * Standard Funds-Out voucher layout.
 * Fields: principal, interest, WHT, charge, net amount (highlighted),
 * transfer date, remarks, + PaymentInstructionBlock if payment_instruction set.
 *
 * Used for: MATURITY_TERMINATION, ANNIVERSARY_PAYMENT, PRE_LIQUIDATION,
 *           THIRD_PARTY_PAYMENT.
 *
 * For THIRD_PARTY_PAYMENT (is_internal = false):
 *   - Shows "Transfer Amount" instead of "Principal"
 *   - Shows transfer charge from calculation_snapshot (THIRD_PARTY_TRANSFER_0_10_PERCENT rule)
 *   - Hides irrelevant interest/WHT fields
 */
export function FundsOutVoucher({ voucher }: { voucher: VoucherData }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown> | null
  const snapRule = snap?.rule as string | undefined
  const snapOutputs = snap?.outputs as Record<string, string> | undefined
  const snapInputs = snap?.inputs as Record<string, string> | undefined

  // Detect THIRD_PARTY_TRANSFER_0_10_PERCENT rule (Req 21.2, 21.5)
  const isThirdPartyTransfer = snapRule === 'THIRD_PARTY_TRANSFER_0_10_PERCENT'
  const isInternalTransfer = isThirdPartyTransfer && snapInputs?.is_internal === 'true'

  // Detect partial pre-liquidation
  const isPartialPreLiquidation =
    snapRule === 'PRE_LIQUIDATION_20_PERCENT' &&
    Boolean(snapInputs?.requested_payout && Number(snapInputs.requested_payout) > 0)

  // Server-computed transfer charge (Req 21.2) — authoritative
  const thirdPartyCharge = snapOutputs?.transfer_charge ?? voucher.charge ?? '0'

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {/* For THIRD_PARTY_PAYMENT: "Transfer Amount"; others: "Principal" */}
        <Field
          label={isThirdPartyTransfer ? 'Transfer Amount' : 'Principal'}
          value={formatCurrency(voucher.principal)}
        />

        {/* Interest — hidden for THIRD_PARTY_PAYMENT (no interest component) */}
        {!isThirdPartyTransfer && (
          <Field label="Interest" value={formatCurrency(voucher.interest)} />
        )}

        {/* WHT — hidden for THIRD_PARTY_PAYMENT */}
        {!isThirdPartyTransfer && (
          <Field
            label="WHT"
            value={
              <span className="text-muted-foreground">
                {formatCurrency(voucher.wht ?? '0')}
              </span>
            }
          />
        )}

        {/* Charge field: for PRE_LIQUIDATION show "Charge"; for THIRD_PARTY show Transfer Charge */}
        {isThirdPartyTransfer ? (
          <Field
            label="Transfer Charge (0.10%)"
            value={
              <span className={isInternalTransfer ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                {isInternalTransfer
                  ? '₦0.00 (internal transfer — no charge)'
                  : formatCurrency(thirdPartyCharge)}
              </span>
            }
          />
        ) : (
          <Field
            label="Charge"
            value={formatCurrency(voucher.charge ?? '0')}
          />
        )}

        {/* Calculation rule badge for THIRD_PARTY_PAYMENT (Req 21.5) */}
        {isThirdPartyTransfer && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground">Calculation Rule</dt>
            <dd className="mt-1 font-mono text-xs text-muted-foreground">
              THIRD_PARTY_TRANSFER_0_10_PERCENT
              {isInternalTransfer
                ? ' — internal transfer (charge = ₦0)'
                : ' — external transfer (charge = amount × 0.001)'}
            </dd>
          </div>
        )}

        {/* Partial pre-liquidation intermediate values */}
        {isPartialPreLiquidation && (
          <>
            <Field label="Requested Payout" value={formatCurrency(snapInputs?.requested_payout ?? '0')} />
            <Field
              label="Remaining Principal (= Principal − Payout)"
              value={formatCurrency(snapOutputs?.remaining_principal ?? '—')}
            />
            <Field
              label="Rebooked Principal (= Remaining − Charge)"
              value={formatCurrency(snapOutputs?.rebooked_principal ?? '—')}
            />
          </>
        )}

        {/* Net amount — highlighted as primary output (Req 11.3) */}
        <div className="sm:col-span-2 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Net Amount</span>
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatCurrency(voucher.net_amount)}
          </span>
        </div>
        <Field label="Transfer Date" value={voucher.transfer_date ?? '—'} />
        {voucher.remarks && (
          <Field
            label="Remarks"
            value={
              <span className="whitespace-pre-wrap">{voucher.remarks}</span>
            }
            fullWidth
          />
        )}
      </dl>

      {/* Payment Instruction — required for external payments (Req 36.1) */}
      {voucher.payment_instruction && (
        <>
          <Separator />
          <PaymentInstructionBlock instruction={voucher.payment_instruction} />
        </>
      )}
    </div>
  )
}

// ─── SavingsFundsOutVoucher (Req 38) ──────────────────────────────────────────

/**
 * Savings/Call/CMS Funds-Out voucher layout.
 * Uses `available_balance` as the primary amount field instead of the
 * principal/interest/WHT breakdown (Req 38.1, 38.2).
 *
 * Fields: available balance (prominent), transfer date, remarks,
 * + PaymentInstructionBlock if external (Req 38.3).
 */
export function SavingsFundsOutVoucher({ voucher }: { voucher: VoucherData }) {
  return (
    <div className="space-y-4">
      {/* Available Balance — primary display (Req 38.2) */}
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Available Balance</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
            {formatCurrency(voucher.available_balance)}
          </p>
        </div>
        <Banknote className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Transfer Date" value={voucher.transfer_date ?? '—'} />
        {voucher.remarks && (
          <Field
            label="Remarks"
            value={
              <span className="whitespace-pre-wrap">{voucher.remarks}</span>
            }
            fullWidth
          />
        )}
      </dl>

      {/* Payment Instruction — required for external payments (Req 38.3, 36.1) */}
      {voucher.payment_instruction && (
        <>
          <Separator />
          <PaymentInstructionBlock instruction={voucher.payment_instruction} />
        </>
      )}
    </div>
  )
}

// ─── FundsInVoucher (Req 11.4) ────────────────────────────────────────────────

/**
 * Funds-In voucher layout.
 * Fields: customer name (from calculation_snapshot), amount, rate, tenor,
 * effective date, maturity date.
 *
 * Remarks and transfer date are also shown if present.
 */
export function FundsInVoucher({ voucher }: { voucher: VoucherData }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown>
  const inputs = snap?.inputs as Record<string, string | number> | undefined
  const customerName = (snap?.customer_name ?? inputs?.customer_name) as string | undefined

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {customerName && (
        <Field label="Customer Name" value={String(customerName)} fullWidth />
      )}
      <Field label="Amount" value={formatCurrency(voucher.net_amount)} />
      <Field
        label="Interest Rate"
        value={
          inputs?.rate
            ? formatRate(String(inputs.rate))
            : inputs?.interest_rate
              ? formatRate(String(inputs.interest_rate))
              : '—'
        }
      />
      <Field
        label="Tenor (days)"
        value={inputs?.tenor ? String(inputs.tenor) : '—'}
      />
      <Field
        label="Effective Date"
        value={inputs?.effective_date ? String(inputs.effective_date) : '—'}
      />
      <Field
        label="Maturity Date"
        value={inputs?.maturity_date ? String(inputs.maturity_date) : '—'}
      />
      {voucher.transfer_date && (
        <Field label="Transfer Date" value={voucher.transfer_date} />
      )}
      {voucher.remarks && (
        <Field
          label="Remarks"
          value={<span className="whitespace-pre-wrap">{voucher.remarks}</span>}
          fullWidth
        />
      )}
    </dl>
  )
}

// ─── RolloverSlipVoucher (Req 11.5) ───────────────────────────────────────────

/**
 * Rollover Slip voucher layout.
 * Fields: principal amount, interest due, effective date, new tenor, new rate,
 * rollover amount (highlighted), rollover maturity date.
 * Optional: interest payout (for PRINCIPAL_ONLY / INTEREST_ONLY sub-types).
 * + PaymentInstructionBlock when interest is paid out (Req 11.5).
 */
export function RolloverSlipVoucher({ voucher }: { voucher: VoucherData }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown>
  const inputs = snap?.inputs as Record<string, string | number> | undefined
  const outputs = snap?.outputs as Record<string, string | number> | undefined

  const newTenor = inputs?.new_tenor
  const newRate = inputs?.new_rate
  const effectiveDate = inputs?.effective_date
  const rolloverMaturityDate = inputs?.rollover_maturity_date ?? inputs?.new_maturity_date
  const rolloverAmount = outputs?.rollover_amount ?? voucher.net_amount

  // principal / interest: prefer the voucher columns (populated by the server action),
  // fall back to snapshot inputs when columns are null (legacy vouchers saved before the fix).
  const principalDisplay =
    voucher.principal ?? (inputs?.principal ? String(inputs.principal) : null)
  const interestDisplay =
    voucher.interest ?? (inputs?.interest_due ? String(inputs.interest_due) : null)

  const interestPaid = outputs?.interest_paid ?? outputs?.interest_payout

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="Principal Amount" value={formatCurrency(principalDisplay)} />
        <Field label="Interest Due" value={formatCurrency(interestDisplay)} />
        <Field
          label="Effective Date"
          value={effectiveDate ? String(effectiveDate) : '—'}
        />
        <Field
          label="New Tenor (days)"
          value={newTenor ? String(newTenor) : '—'}
        />
        <Field
          label="New Rate"
          value={newRate ? formatRate(String(newRate)) : '—'}
        />

        {/* Rollover amount — primary output (Req 11.5) */}
        <div className="sm:col-span-2 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Rollover Amount</span>
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatCurrency(rolloverAmount !== null && rolloverAmount !== undefined ? String(rolloverAmount) : null)}
          </span>
        </div>

        <Field
          label="Rollover Maturity Date"
          value={rolloverMaturityDate ? String(rolloverMaturityDate) : '—'}
        />

        {/* Interest payout — PRINCIPAL_ONLY / INTEREST_ONLY rollovers (Req 17.3, 17.5) */}
        {interestPaid && (
          <Field label="Interest Payout" value={formatCurrency(String(interestPaid))} />
        )}

        {voucher.remarks && (
          <Field
            label="Remarks"
            value={<span className="whitespace-pre-wrap">{voucher.remarks}</span>}
            fullWidth
          />
        )}
      </dl>

      {/* Payment Instruction — when interest is paid out externally (Req 11.5) */}
      {voucher.payment_instruction && (
        <>
          <Separator />
          <PaymentInstructionBlock instruction={voucher.payment_instruction} />
        </>
      )}
    </div>
  )
}

// ─── TransferSlipVoucher (Req 11.6) ───────────────────────────────────────────

/**
 * Transfer Slip voucher layout.
 * Fields applicable to the specific transfer scenario (Req 11.6):
 * transfer amount, transfer date, and optional source/destination accounts.
 * Remarks shown if present.
 */
export function TransferSlipVoucher({ voucher }: { voucher: VoucherData }) {
  const snap = voucher.calculation_snapshot as Record<string, unknown>
  const inputs = snap?.inputs as Record<string, string | number> | undefined

  const sourceAccount =
    inputs?.source_account_number ?? inputs?.sourceAccountNumber
  const destAccount =
    inputs?.destination_account_number ?? inputs?.destinationAccountNumber
  const originalTxRef =
    inputs?.original_transaction_reference ?? inputs?.originalTransactionReference

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {/* Transfer amount — primary display */}
      <div className="sm:col-span-2 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Transfer Amount</span>
        <span className="text-base font-semibold tabular-nums text-foreground">
          {formatCurrency(voucher.net_amount)}
        </span>
      </div>

      <Field label="Transfer Date" value={voucher.transfer_date ?? '—'} />

      {sourceAccount && (
        <Field label="Source Account" value={String(sourceAccount)} />
      )}
      {destAccount && (
        <Field label="Destination Account" value={String(destAccount)} />
      )}
      {originalTxRef && (
        <Field
          label="Original Transaction Reference"
          value={String(originalTxRef)}
          fullWidth
        />
      )}
      {voucher.remarks && (
        <Field
          label="Remarks"
          value={<span className="whitespace-pre-wrap">{voucher.remarks}</span>}
          fullWidth
        />
      )}
    </dl>
  )
}

// ─── VoucherHeader ─────────────────────────────────────────────────────────────

function VoucherHeader({
  voucher,
  transactionType,
  onPrint,
}: {
  voucher: VoucherData
  transactionType?: string
  onPrint?: () => void
}) {
  const isFinalised = voucher.status === 'FINALISED'
  const label =
    VOUCHER_TYPE_LABELS[voucher.voucher_type as VoucherType] ?? voucher.voucher_type

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <Receipt className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{label}</p>
            {transactionType && (
              <span className="text-xs text-muted-foreground">
                · {transactionType.replace(/_/g, ' ')}
              </span>
            )}
            <Badge
              variant={isFinalised ? 'default' : 'secondary'}
              className={
                isFinalised
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : ''
              }
            >
              {isFinalised ? 'Finalised' : 'Draft'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Voucher #{voucher.voucher_number}
            {' · '}
            Generated {formatDatetime(voucher.created_at)}
          </p>
        </div>
      </div>

      {/* Print / download button — only shown for finalised vouchers */}
      {isFinalised && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5 text-xs print:hidden print-hidden"
          onClick={onPrint}
          aria-label={`Print voucher ${voucher.voucher_number}`}
        >
          <Printer className="size-3.5" aria-hidden />
          Print
        </Button>
      )}
    </div>
  )
}

// ─── VoucherDisplay — main entry-point ────────────────────────────────────────

export interface VoucherDisplayProps {
  /** The voucher data from TransactionWorkspace['voucher']. */
  voucher: VoucherData
  /**
   * The transaction type (e.g. 'SAVINGS_FUNDS_OUT') — used to select the
   * correct Funds-Out sub-layout and shown as a label in the header.
   */
  transactionType?: string
  /** When true, hides the voucher header (useful when parent already shows it). */
  hideHeader?: boolean
}

/**
 * VoucherDisplay — canonical read-only voucher renderer.
 *
 * Switches on `voucher_type` to render the correct layout:
 *   FUNDS_OUT   → FundsOutVoucher  OR  SavingsFundsOutVoucher (Req 38)
 *   FUNDS_IN    → FundsInVoucher
 *   ROLLOVER_SLIP → RolloverSlipVoucher
 *   TRANSFER_SLIP → TransferSlipVoucher
 *
 * The `transactionType` prop is used to distinguish the savings/call/CMS
 * variant of FUNDS_OUT from the standard layout (Req 38.2).
 *
 * Entry animation: opacity 0 → 1 with subtle translateY, 220 ms ease-out.
 * Respects `prefers-reduced-motion` (Req 32.9).
 *
 * Print: clicking the Print button scopes a @media print rule so only the
 * voucher content is visible — the rest of the page is hidden. This avoids
 * needing a PDF library dependency.
 */
export function VoucherDisplay({
  voucher,
  transactionType,
  hideHeader = false,
}: VoucherDisplayProps) {
  // Stable ID so the print CSS can target exactly this voucher instance
  // (multiple vouchers might be on the same page in future).
  const printId = `voucher-print-${voucher.voucher_number.replace(/[^a-z0-9]/gi, '-')}`

  function handlePrint() {
    const el = document.getElementById(printId)
    if (!el) return

    const win = window.open('', '_blank', 'width=820,height=750')
    if (!win) return

    // Build a clean HTML document with only the voucher content.
    // Tailwind class names are stripped in the new window, so we inline
    // minimal reset + layout CSS that matches the component's visual output.
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Voucher ${voucher.voucher_number}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      color: #111827;
      padding: 40px;
      background: #fff;
    }

    /* ── Header ── */
    .voucher-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
    .voucher-title { font-size: 16px; font-weight: 600; }
    .voucher-subtitle { font-size: 11px; color: #6b7280; margin-top: 3px; }
    .badge {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 9999px;
      font-size: 11px; font-weight: 500;
      background: #d1fae5; color: #047857; border: 1px solid #a7f3d0;
      margin-left: 6px;
    }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }

    /* ── Field grid ── */
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; }
    dt { font-size: 11px; font-weight: 500; color: #6b7280; margin-bottom: 2px; }
    dd { font-size: 13px; color: #111827; }
    .full-width { grid-column: span 2; }

    /* ── Highlighted row (rollover amount / net amount) ── */
    .amount-row {
      grid-column: span 2;
      display: flex; justify-content: space-between; align-items: center;
      background: #f3f4f6; padding: 8px 12px; border-radius: 6px;
      margin: 4px 0;
    }
    .amount-row-label { font-size: 11px; font-weight: 500; color: #6b7280; }
    .amount-row-value { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }

    /* ── Payment instruction block ── */
    .pi-block {
      border: 1px solid #e5e7eb; border-radius: 6px;
      padding: 12px; margin-top: 8px;
    }
    .pi-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #374151; margin-bottom: 8px; }

    /* ── Hide interactive elements ── */
    button, [role="button"] { display: none !important; }

    /* ── Print media ── */
    @media print {
      body { padding: 20px; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  ${el.innerHTML}
</body>
</html>`)

    win.document.close()

    // Remove any buttons that copied over (Print button, View button, etc.)
    win.document.querySelectorAll('button, [role="button"], svg').forEach(n => n.remove())

    // Wait for layout to settle, then print. Do NOT close the window —
    // let the user close it after saving/printing.
    win.onload = () => {
      setTimeout(() => win.print(), 250)
    }
    // Fallback if onload already fired
    if (win.document.readyState === 'complete') {
      setTimeout(() => win.print(), 250)
    }
  }

  // Determine whether to use the Savings/Call/CMS layout (Req 38)
  const isSavingsLayout =
    transactionType != null && SAVINGS_TYPE_VOUCHERS.has(transactionType)

  return (
    <>
      {/* Animation styles — scoped to this component */}
      <style>{`
        @keyframes voucherFadeInFull {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes voucherFadeInReduced {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .voucher-display-root {
          animation: voucherFadeInReduced 220ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @media (not (prefers-reduced-motion: reduce)) {
          .voucher-display-root {
            animation: voucherFadeInFull 220ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }
        }
      `}</style>

      <div
        id={printId}
        className="voucher-display-root space-y-4"
        role="region"
        aria-label={`Voucher ${voucher.voucher_number}`}
      >
        {!hideHeader && (
          <>
            <VoucherHeader
              voucher={voucher}
              transactionType={transactionType}
              onPrint={handlePrint}
            />
            <Separator />
          </>
        )}

        {/* Route to the correct sub-component */}
        {voucher.voucher_type === 'FUNDS_OUT' && isSavingsLayout && (
          <SavingsFundsOutVoucher voucher={voucher} />
        )}

        {voucher.voucher_type === 'FUNDS_OUT' && !isSavingsLayout && (
          <FundsOutVoucher voucher={voucher} />
        )}

        {voucher.voucher_type === 'FUNDS_IN' && (
          <FundsInVoucher voucher={voucher} />
        )}

        {voucher.voucher_type === 'ROLLOVER_SLIP' && (
          <RolloverSlipVoucher voucher={voucher} />
        )}

        {voucher.voucher_type === 'TRANSFER_SLIP' && (
          <TransferSlipVoucher voucher={voucher} />
        )}

        {/* Fallback for unknown voucher types */}
        {!['FUNDS_OUT', 'FUNDS_IN', 'ROLLOVER_SLIP', 'TRANSFER_SLIP'].includes(
          voucher.voucher_type,
        ) && (
          <p className="text-sm text-muted-foreground italic">
            Unknown voucher type: {voucher.voucher_type}
          </p>
        )}
      </div>
    </>
  )
}

export default VoucherDisplay
