'use client'

import { useState, useTransition, useId, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
  Copy,
  Upload,
  FileText,
  WifiOff,
  X,
} from 'lucide-react'

import {
  CreateTransactionSchema,
  type CreateTransactionInput,
  type TransactionType,
  type PaymentInstruction,
} from '@/lib/schemas/transaction.schema'
import { createTransactionBatchAction, type BatchRowResult } from '@/lib/actions/batch.actions'
import { uploadDocumentAction } from '@/lib/actions/document.actions'
import { ALLOWED_MIME_TYPES, ALLOWED_FILE_TYPES_LABEL, MAX_FILE_SIZE_BYTES } from '@/lib/constants/document.constants'
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus'
import { enqueue } from '@/lib/offline/queue'
import { saveCustomerCache, loadCustomerCache } from '@/lib/offline/customer-cache'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerOption {
  id: string
  name: string
  customer_number: string
}

interface InvestmentOption {
  id: string
  product_type: string
  principal: string
  external_reference: string | null
}

export interface BatchTransactionFormProps {
  customers: CustomerOption[]
}

// ─── Row state — one entry per transaction in the batch ───────────────────────

interface RowState {
  id: string                           // stable client key for React
  customerId: string
  investmentId: string
  transactionType: TransactionType | ''
  scenarioCode: string
  requestedAmount: string
  requestedPayout: string
  sourceInstructionType: string
  purpose: string
  // Payment instruction (for THIRD_PARTY_PAYMENT)
  paymentInstruction: PaymentInstruction
  // Per-row investments list (fetched when customer changes)
  investments: InvestmentOption[]
  loadingInvestments: boolean
  // Per-row validation errors (populated on submit attempt)
  errors: Partial<Record<keyof CreateTransactionInput | 'general', string>>
  // Source document to upload after transaction is created
  sourceDocument: File | null
  sourceDocumentError: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ROWS = 20

const TRANSACTION_TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'ROLLOVER',             label: 'Rollover' },
  { value: 'MATURITY_TERMINATION', label: 'Maturity Termination' },
  { value: 'PRE_LIQUIDATION',      label: 'Pre-Liquidation' },
  { value: 'ANNIVERSARY_PAYMENT',  label: 'Anniversary Payment' },
  { value: 'THIRD_PARTY_PAYMENT',  label: 'Third-Party Payment' },
  { value: 'INTERNAL_TRANSFER',    label: 'Internal Transfer' },
  { value: 'INFLOW',               label: 'Inflow' },
  { value: 'SAVINGS_FUNDS_OUT',    label: 'Savings Funds Out' },
  { value: 'CALL_FUNDS_OUT',       label: 'Call Funds Out' },
  { value: 'CMS_FUNDS_OUT',        label: 'CMS Funds Out' },
]

const SOURCE_OPTIONS = [
  { value: 'LETTER',      label: 'Letter' },
  { value: 'EMAIL',       label: 'Email' },
  { value: 'SIGNED_FORM', label: 'Signed Form' },
  { value: 'MANDATED',    label: 'Mandated' },
] as const

const ROLLOVER_SCENARIO_OPTIONS = [
  { value: 'P_AND_I',           label: 'Principal + Interest' },
  { value: 'PRINCIPAL_ONLY',    label: 'Principal Only' },
  { value: 'PARTIAL_PRINCIPAL', label: 'Partial Principal' },
  { value: 'INTEREST_ONLY',     label: 'Interest Only' },
] as const

const ANNIVERSARY_SCENARIO_OPTIONS = [
  { value: 'ANNIVERSARY_30', label: '30-Day' },
  { value: 'ANNIVERSARY_60', label: '60-Day' },
  { value: 'ANNIVERSARY_90', label: '90-Day' },
] as const

const INTERNAL_TRANSFER_SCENARIO_OPTIONS = [
  { value: 'SAVINGS_TO_PERSONAL',          label: 'Savings → Personal' },
  { value: 'PERSONAL_TO_COMMERCIAL_PAPER', label: 'Personal → Commercial Paper' },
  { value: 'PERSONAL_TO_CALL_PLACEMENT',   label: 'Personal → Call Placement' },
] as const

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'SAVINGS',          label: 'Savings' },
  { value: 'PERSONAL',         label: 'Personal' },
  { value: 'COMMERCIAL_PAPER', label: 'Commercial Paper' },
  { value: 'CALL',             label: 'Call' },
  { value: 'CMS',              label: 'CMS' },
] as const

// ─── Investment label helper ──────────────────────────────────────────────────

/**
 * Derives a human-readable sub-account qualifier from an external reference.
 * e.g. "EZBK-R-SV-001" → "Savings", "EZBK-R-CL-001" → "Call", "EZBK-R-CM-001" → "CMS"
 * Returns null when no qualifier can be determined.
 */
function subAccountLabel(extRef: string | null): string | null {
  if (!extRef) return null
  const code = extRef.split('-').slice(-2, -1)[0]?.toUpperCase()
  switch (code) {
    case 'SV': return 'Savings'
    case 'CL': return 'Call'
    case 'CM': return 'CMS'
    case 'PS': return 'Personal'
    case 'CP': return 'Commercial Paper'
    default:   return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmptyRow(id: string): RowState {
  return {
    id,
    customerId: '',
    investmentId: '',
    transactionType: '',
    scenarioCode: '',
    requestedAmount: '',
    requestedPayout: '',
    sourceInstructionType: '',
    purpose: '',
    paymentInstruction: { isInternal: false },
    investments: [],
    loadingInvestments: false,
    errors: {},
    sourceDocument: null,
    sourceDocumentError: null,
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function needsScenario(type: TransactionType | '') {
  return type === 'ROLLOVER' || type === 'ANNIVERSARY_PAYMENT' || type === 'INTERNAL_TRANSFER'
}

function scenarioOptions(type: TransactionType | '') {
  if (type === 'ROLLOVER')            return ROLLOVER_SCENARIO_OPTIONS
  if (type === 'ANNIVERSARY_PAYMENT') return ANNIVERSARY_SCENARIO_OPTIONS
  if (type === 'INTERNAL_TRANSFER')   return INTERNAL_TRANSFER_SCENARIO_OPTIONS
  return []
}

function scenarioLabel(type: TransactionType | '') {
  if (type === 'ANNIVERSARY_PAYMENT') return 'Anniversary Frequency'
  if (type === 'INTERNAL_TRANSFER')   return 'Transfer Direction'
  return 'Rollover Scenario'
}

function formatCurrency(val: string) {
  const n = parseFloat(val)
  if (isNaN(n)) return val
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(n)
}

function validateSourceDocumentFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return `Invalid file type. Only ${ALLOWED_FILE_TYPES_LABEL} files are accepted.`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
    return `File too large (${sizeMB} MB). Maximum allowed size is 10 MB.`
  }
  return null
}

// ─── Field error helper ───────────────────────────────────────────────────────

function RowFieldError({ message }: { message?: string }) {
  if (!message) return null
  // Zod enum errors list all valid values verbosely — replace with a short message.
  const display = /^Invalid option: expected one of/i.test(message)
    ? 'Please select a valid option.'
    : message
  return (
    <p className="mt-1 break-words text-[11px] text-destructive" role="alert">
      {display}
    </p>
  )
}

// ─── CustomerSelect — inline searchable select ───────────────────────────────

function CustomerSelect({
  customers,
  value,
  rowId,
  onChange,
  error,
}: {
  customers: CustomerOption[]
  value: string
  rowId: string
  onChange: (id: string) => void
  error?: string
}) {
  return (
    <select
      id={`${rowId}-customer`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 w-full rounded-md border bg-background px-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
        error ? 'border-destructive' : 'border-input'
      }`}
    >
      <option value="">Select customer…</option>
      {customers.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({c.customer_number})
        </option>
      ))}
    </select>
  )
}

// ─── SourceDocumentUpload — inline file picker for a row ─────────────────────

function SourceDocumentUpload({
  rowId,
  file,
  fileError,
  onFileChange,
}: {
  rowId: string
  file: File | null
  fileError: string | null
  onFileChange: (file: File | null) => void
}) {
  const inputId = `src-doc-${rowId}`

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    onFileChange(picked)
    // reset so re-selecting same file triggers onChange
    e.target.value = ''
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Source Document{' '}
        <span className="text-destructive" aria-hidden>*</span>
      </p>

      {file ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
            {file.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {(file.size / (1024 * 1024)).toFixed(1)} MB
          </span>
          <button
            type="button"
            onClick={() => onFileChange(null)}
            className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
            aria-label={`Remove ${file.name}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/50 [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
        >
          <Upload className="size-3.5 shrink-0" aria-hidden />
          Click to attach a document (PDF, JPG, PNG · max 10 MB)
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={handleChange}
            aria-label="Attach source document"
          />
        </label>
      )}

      {fileError && (
        <p className="text-[11px] text-destructive">{fileError}</p>
      )}
    </div>
  )
}

// ─── RowCard — renders a single batch row ─────────────────────────────────────

function RowCard({
  row,
  index,
  total,
  customers,
  result,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  row: RowState
  index: number
  total: number
  customers: CustomerOption[]
  result?: BatchRowResult
  onUpdate: (patch: Partial<RowState>) => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const baseId = `row-${row.id}`
  const isThirdParty = row.transactionType === 'THIRD_PARTY_PAYMENT'
  const isPartialPrincipal = row.transactionType === 'ROLLOVER' && row.scenarioCode === 'PARTIAL_PRINCIPAL'
  const hasScenario = needsScenario(row.transactionType)
  const scenarios = scenarioOptions(row.transactionType)

  // Fetch investments when customer changes
  async function handleCustomerChange(customerId: string) {
    onUpdate({ customerId, investmentId: '', investments: [], loadingInvestments: !!customerId })
    if (!customerId) return
    try {
      const res = await fetch(`/api/investments?customerId=${customerId}`)
      const data: InvestmentOption[] = await res.json()
      onUpdate({ investments: data, loadingInvestments: false })
    } catch {
      onUpdate({ investments: [], loadingInvestments: false })
    }
  }

  // Status indicator when results are available
  const statusBadge = result ? (
    result.success ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 className="size-3" />
        {result.reference}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <XCircle className="size-3" />
        Failed
      </span>
    )
  ) : null

  const fieldCls = (err?: string) =>
    `h-9 w-full rounded-md border bg-background px-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
      err ? 'border-destructive' : 'border-input'
    }`

  return (
    <div
      className={`rounded-xl border p-4 space-y-4 transition-colors ${
        result?.success
          ? 'border-emerald-200 bg-emerald-50/40'
          : result && !result.success
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-border bg-background'
      }`}
    >
      {/* Row header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
          <span className="text-xs font-semibold text-foreground">
            {row.transactionType
              ? TRANSACTION_TYPE_OPTIONS.find((o) => o.value === row.transactionType)?.label ?? row.transactionType
              : 'New Instruction'}
          </span>
          {statusBadge}
        </div>
        <div className="flex items-center gap-1">
          {/* Duplicate row */}
          {total < MAX_ROWS && (
            <button
              type="button"
              onClick={onDuplicate}
              title="Duplicate this row"
              className="inline-flex size-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
            >
              <Copy className="size-3.5" />
            </button>
          )}
          {/* Remove row */}
          {total > 1 && (
            <button
              type="button"
              onClick={onRemove}
              title="Remove this row"
              className="inline-flex size-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Result error message */}
      {result && !result.success && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {result.error}
        </p>
      )}

      {/* Fields grid */}
      <div className="grid gap-3 sm:grid-cols-2">

        {/* Customer */}
        <div className="sm:col-span-2">
          <label htmlFor={`${baseId}-customer`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Customer <span className="text-destructive">*</span>
          </label>
          <CustomerSelect
            customers={customers}
            value={row.customerId}
            rowId={row.id}
            onChange={handleCustomerChange}
            error={row.errors.customerId}
          />
          <RowFieldError message={row.errors.customerId} />
        </div>

        {/* Investment */}
        <div className="sm:col-span-2">
          <label htmlFor={`${baseId}-investment`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Investment <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
          </label>
          {row.loadingInvestments ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading…
            </div>
          ) : (
            <select
              id={`${baseId}-investment`}
              value={row.investmentId}
              onChange={(e) => onUpdate({ investmentId: e.target.value })}
              disabled={!row.customerId || row.investments.length === 0}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {!row.customerId
                  ? 'Select customer first'
                  : row.investments.length === 0
                  ? 'No investments found'
                  : 'Select investment…'}
              </option>
              {row.investments.map((inv) => {
                const sub = subAccountLabel(inv.external_reference)
                const typeLabel = sub && sub !== inv.product_type
                  ? `${inv.product_type} (${sub})`
                  : inv.product_type
                return (
                  <option key={inv.id} value={inv.id}>
                    {typeLabel} — {formatCurrency(inv.principal)}
                    {inv.external_reference ? ` · ${inv.external_reference}` : ''}
                  </option>
                )
              })}
            </select>
          )}
        </div>

        {/* Transaction type */}
        <div>
          <label htmlFor={`${baseId}-type`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Transaction Type <span className="text-destructive">*</span>
          </label>
          <select
            id={`${baseId}-type`}
            value={row.transactionType}
            onChange={(e) => {
              const t = e.target.value as TransactionType | ''
              onUpdate({
                transactionType: t,
                scenarioCode: '',
                requestedPayout: '',
                paymentInstruction: { isInternal: false },
              })
            }}
            className={fieldCls(row.errors.transactionType)}
          >
            <option value="">Select type…</option>
            {TRANSACTION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <RowFieldError message={row.errors.transactionType} />
        </div>

        {/* Scenario code — only when required */}
        {hasScenario && (
          <div>
            <label htmlFor={`${baseId}-scenario`} className="mb-1 block text-xs font-medium text-muted-foreground">
              {scenarioLabel(row.transactionType)} <span className="text-destructive">*</span>
            </label>
            <select
              id={`${baseId}-scenario`}
              value={row.scenarioCode}
              onChange={(e) => onUpdate({ scenarioCode: e.target.value, requestedPayout: '' })}
              className={fieldCls(row.errors.scenarioCode)}
            >
              <option value="">Select…</option>
              {scenarios.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <RowFieldError message={row.errors.scenarioCode} />
          </div>
        )}

        {/* Requested Payout — PARTIAL_PRINCIPAL only */}
        {isPartialPrincipal && (
          <div>
            <label htmlFor={`${baseId}-payout`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Requested Payout (₦) <span className="text-destructive">*</span>
            </label>
            <input
              id={`${baseId}-payout`}
              type="text"
              inputMode="decimal"
              placeholder="Payout amount"
              value={row.requestedPayout}
              onChange={(e) => onUpdate({ requestedPayout: e.target.value })}
              className={fieldCls(row.errors.requestedPayout)}
            />
            <RowFieldError message={row.errors.requestedPayout} />
          </div>
        )}

        {/* Requested amount */}
        <div>
          <label htmlFor={`${baseId}-amount`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Requested Amount (₦) <span className="text-destructive">*</span>
          </label>
          <input
            id={`${baseId}-amount`}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={row.requestedAmount}
            onChange={(e) => onUpdate({ requestedAmount: e.target.value })}
            className={fieldCls(row.errors.requestedAmount)}
          />
          {row.errors.requestedAmount && (
            <p className="mt-1 text-[11px] text-destructive">{row.errors.requestedAmount}</p>
          )}
        </div>

        {/* Source instruction type */}
        <div>
          <label htmlFor={`${baseId}-source`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Source Instruction <span className="text-destructive">*</span>
          </label>
          <select
            id={`${baseId}-source`}
            value={row.sourceInstructionType}
            onChange={(e) => onUpdate({ sourceInstructionType: e.target.value })}
            className={fieldCls(row.errors.sourceInstructionType)}
          >
            <option value="">Select source…</option>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {row.errors.sourceInstructionType && (
            <p className="mt-1 text-[11px] text-destructive">{row.errors.sourceInstructionType}</p>
          )}
        </div>

        {/* Purpose */}
        <div className="sm:col-span-2">
          <label htmlFor={`${baseId}-purpose`} className="mb-1 block text-xs font-medium text-muted-foreground">
            Purpose <span className="text-destructive">*</span>
          </label>
          <textarea
            id={`${baseId}-purpose`}
            rows={2}
            placeholder="Describe the customer instruction…"
            value={row.purpose}
            onChange={(e) => onUpdate({ purpose: e.target.value })}
            className={`w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
              row.errors.purpose ? 'border-destructive' : 'border-input'
            }`}
          />
          {row.errors.purpose && (
            <p className="mt-1 text-[11px] text-destructive">{row.errors.purpose}</p>
          )}
        </div>

        {/* Payment instruction — THIRD_PARTY_PAYMENT only */}
        {isThirdParty && (
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Payment Instruction
              </p>
              {/* Internal / External toggle */}
              <div className="flex items-center gap-1">
                {(['External', 'Internal'] as const).map((label) => {
                  const isInternal = label === 'Internal'
                  const active = row.paymentInstruction.isInternal === isInternal
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        onUpdate({
                          paymentInstruction: {
                            isInternal,
                            accountNumber: '',
                            beneficiaryName: '',
                            bankName: '',
                            accountType: undefined,
                          },
                        })
                      }
                      className={`h-6 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input bg-background text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {row.paymentInstruction.isInternal ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Internal Account Number <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Internal account number"
                  value={row.paymentInstruction.accountNumber ?? ''}
                  onChange={(e) =>
                    onUpdate({
                      paymentInstruction: { ...row.paymentInstruction, accountNumber: e.target.value },
                    })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30"
                />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'beneficiaryName', label: 'Beneficiary Name', placeholder: 'Full legal name' },
                  { key: 'bankName',        label: 'Bank Name',        placeholder: 'e.g. First Bank' },
                  { key: 'accountNumber',   label: 'Account Number',   placeholder: '10-digit NUBAN' },
                ] .map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      {label} <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder={placeholder}
                      value={(row.paymentInstruction as Record<string, string | undefined>)[key] ?? ''}
                      onChange={(e) =>
                        onUpdate({
                          paymentInstruction: { ...row.paymentInstruction, [key]: e.target.value },
                        })
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Account Type
                  </label>
                  <select
                    value={row.paymentInstruction.accountType ?? ''}
                    onChange={(e) =>
                      onUpdate({
                        paymentInstruction: {
                          ...row.paymentInstruction,
                          accountType: (e.target.value as PaymentInstruction['accountType']) || undefined,
                        },
                      })
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none transition-shadow focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="">Select type…</option>
                    {ACCOUNT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {row.errors.paymentInstructions && (
              <p className="text-[11px] text-destructive">{row.errors.paymentInstructions}</p>
            )}
          </div>
        )}
      </div>

      {/* Source document upload */}
      <SourceDocumentUpload
        rowId={row.id}
        file={row.sourceDocument}
        fileError={row.sourceDocumentError ?? row.errors.general ?? null}
        onFileChange={(file) =>
          onUpdate({
            sourceDocument: file,
            sourceDocumentError: file ? validateSourceDocumentFile(file) : null,
            errors: { ...row.errors, general: undefined },
          })
        }
      />
    </div>
  )
}

// ─── Results summary panel ────────────────────────────────────────────────────

function ResultsSummary({
  results,
  rows,
  onRetryFailed,
  onDone,
}: {
  results: BatchRowResult[]
  rows: RowState[]
  onRetryFailed: () => void
  onDone: () => void
}) {
  const router = useRouter()
  const succeeded = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="rounded-xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-base font-semibold text-foreground">Batch Submission Results</h2>
        <div className="flex flex-wrap gap-3">
          {succeeded.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" />
              {succeeded.length} created
            </span>
          )}
          {failed.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
              <XCircle className="size-3.5" />
              {failed.length} failed
            </span>
          )}
        </div>
        {failed.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Failed rows are highlighted below. Fix the errors and re-submit to retry only the failed rows.
          </p>
        )}
      </div>

      {/* Per-row results */}
      <div className="space-y-3">
        {results.map((r) => {
          const row = rows[r.index]
          const txType = row?.transactionType
            ? TRANSACTION_TYPE_OPTIONS.find((o) => o.value === row.transactionType)?.label
            : `Row ${r.index + 1}`

          return (
            <div
              key={r.index}
              className={`flex items-start justify-between gap-4 rounded-lg border p-3.5 ${
                r.success
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-destructive/30 bg-destructive/5'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                {r.success ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Row {r.index + 1} — {txType ?? '—'}
                  </p>
                  {r.success ? (
                    <p className="mt-0.5 font-mono text-xs text-emerald-700">{r.reference}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-destructive">{r.error}</p>
                  )}
                </div>
              </div>
              {r.success && r.transactionId && (
                <button
                  type="button"
                  onClick={() => router.push(`/transactions/${r.transactionId}`)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-emerald-50"
                >
                  Open
                  <ArrowRight className="size-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pb-6">
        {failed.length > 0 && (
          <button
            type="button"
            onClick={onRetryFailed}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
          >
            Retry failed rows
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/90"
        >
          {failed.length === 0 ? 'View transactions' : 'Done'}
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BatchTransactionForm({ customers: serverCustomers }: BatchTransactionFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const formId = useId()
  // undefined = not yet hydrated → treat as online to avoid flicker
  const networkStatus = useNetworkStatus()
  const isOnline = networkStatus !== false

  // ── Customer list ─────────────────────────────────────────────────────────
  // Lazy initialiser: use serverCustomers if available (online), otherwise
  // fall back to localStorage cache (offline). Runs only once on mount.
  const [customers, setCustomers] = useState<CustomerOption[]>(() => {
    if (serverCustomers.length > 0) return serverCustomers
    return loadCustomerCache()
  })

  // Persist a fresh list whenever the server sends one (online path).
  // useRef tracks whether we've already saved this exact prop value so the
  // effect only fires once per page load, not on every render.
  const savedRef = useRef(false)
  useEffect(() => {
    if (serverCustomers.length > 0 && !savedRef.current) {
      savedRef.current = true
      saveCustomerCache(serverCustomers)
      // Also update state in case the lazy init ran before serverCustomers arrived
      setCustomers(serverCustomers)
    }
  }, [serverCustomers])

  // Row list — starts with one empty row
  const [rows, setRows] = useState<RowState[]>([makeEmptyRow(uid())])

  // Batch submission results — null until submitted
  const [results, setResults] = useState<BatchRowResult[] | null>(null)

  // ── Row mutation helpers ────────────────────────────────────────────────────

  function updateRow(id: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, errors: patch.errors !== undefined ? patch.errors : r.errors } : r)),
    )
  }

  function addRow() {
    if (rows.length >= MAX_ROWS) return
    setRows((prev) => [...prev, makeEmptyRow(uid())])
  }

  function removeRow(id: string) {
    setRows((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.id !== id)
    })
  }

  function duplicateRow(id: string) {
    if (rows.length >= MAX_ROWS) return
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === id)
      if (idx === -1) return prev
      const source = prev[idx]
      const copy: RowState = {
        ...source,
        id: uid(),
        errors: {},
        // Reset result-state fields
        investments: source.investments,
        loadingInvestments: false,
      }
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
  }

  // ── Client-side validation — runs before server action ─────────────────────

  function validateRows(): boolean {
    let allValid = true
    const updated = rows.map((row) => {
      const input: Partial<CreateTransactionInput> = {
        customerId: row.customerId,
        transactionType: row.transactionType as TransactionType,
        requestedAmount: row.requestedAmount,
        purpose: row.purpose,
        sourceInstructionType: row.sourceInstructionType as CreateTransactionInput['sourceInstructionType'],
        scenarioCode: row.scenarioCode as CreateTransactionInput['scenarioCode'] || undefined,
        requestedPayout: row.requestedPayout || undefined,
        investmentId: row.investmentId || undefined,
        paymentInstructions:
          row.transactionType === 'THIRD_PARTY_PAYMENT'
            ? [row.paymentInstruction]
            : undefined,
      }

      const parsed = CreateTransactionSchema.safeParse(input)
      const errs: RowState['errors'] = {}

      if (!parsed.success) {
        allValid = false
        for (const issue of parsed.error.issues) {
          const field = issue.path[0] as keyof CreateTransactionInput | undefined
          if (field && !errs[field]) {
            errs[field] = issue.message
          }
        }
      }

      // Source document is required
      if (!row.sourceDocument) {
        allValid = false
        errs.general = 'Source document is required.'
      } else if (row.sourceDocumentError) {
        allValid = false
        errs.general = row.sourceDocumentError
      }

      return { ...row, errors: errs }
    })

    setRows(updated)
    return allValid
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!validateRows()) {
      toast.error('Fix the highlighted errors before submitting.')
      return
    }

    startTransition(async () => {
      const inputs: CreateTransactionInput[] = rows.map((row) => ({
        customerId: row.customerId,
        transactionType: row.transactionType as TransactionType,
        requestedAmount: row.requestedAmount,
        purpose: row.purpose,
        sourceInstructionType: row.sourceInstructionType as CreateTransactionInput['sourceInstructionType'],
        scenarioCode: row.scenarioCode as CreateTransactionInput['scenarioCode'] || undefined,
        requestedPayout: row.requestedPayout || undefined,
        investmentId: row.investmentId || undefined,
        paymentInstructions:
          row.transactionType === 'THIRD_PARTY_PAYMENT'
            ? [row.paymentInstruction]
            : undefined,
      }))

      // ── Offline path ──────────────────────────────────────────────────────
      if (!isOnline) {
        await enqueue({ type: 'CREATE_TRANSACTION_BATCH', payload: { rows: inputs } })
        toast.warning(
          `You're offline. ${inputs.length} instruction${inputs.length !== 1 ? 's' : ''} saved and will be submitted when you reconnect.`,
        )
        return
      }

      const result = await createTransactionBatchAction(inputs)

      if (!result.success) {
        toast.error(result.error ?? 'Batch submission failed.')
        return
      }

      const { results: batchResults, successCount, failCount } = result.data!

      // Upload source documents for successfully created transactions
      const uploadPromises = batchResults
        .filter((r) => r.success && r.transactionId)
        .map((r) => {
          const row = rows[r.index]
          if (!row?.sourceDocument) return Promise.resolve()
          return uploadDocumentAction(r.transactionId!, row.sourceDocument, 'INSTRUCTION').then(
            (uploadResult) => {
              if (!uploadResult.success) {
                console.warn(
                  `[BatchForm] Source document upload failed for row ${r.index + 1}: ${uploadResult.error}`,
                )
              }
            },
          )
        })

      await Promise.all(uploadPromises)

      setResults(batchResults)

      if (failCount === 0) {
        toast.success(
          `All ${successCount} instruction${successCount !== 1 ? 's' : ''} created successfully.`,
        )
      } else if (successCount === 0) {
        toast.error('All rows failed. Review the errors and try again.')
      } else {
        toast.warning(`${successCount} created, ${failCount} failed. Review the results below.`)
      }
    })
  }

  // ── Retry failed rows only ──────────────────────────────────────────────────

  function retryFailed() {
    if (!results) return
    const failedIndexes = new Set(results.filter((r) => !r.success).map((r) => r.index))
    setRows((prev) => prev.filter((_, i) => failedIndexes.has(i)))
    setResults(null)
  }

  // ── Show results screen if submitted ───────────────────────────────────────

  if (results) {
    return (
      <ResultsSummary
        results={results}
        rows={rows}
        onRetryFailed={retryFailed}
        onDone={() => router.push('/transactions')}
      />
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  const busy = isPending

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4"
      aria-label="Batch transaction creation form"
    >
      {/* Row list */}
      {rows.map((row, index) => (
        <RowCard
          key={row.id}
          row={row}
          index={index}
          total={rows.length}
          customers={customers}
          result={undefined}
          onUpdate={(patch) => updateRow(row.id, patch)}
          onRemove={() => removeRow(row.id)}
          onDuplicate={() => duplicateRow(row.id)}
        />
      ))}

      {/* Add row button */}
      {rows.length < MAX_ROWS && (
        <button
          type="button"
          onClick={addRow}
          className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/5 [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
        >
          <Plus className="size-4" />
          Add instruction ({rows.length}/{MAX_ROWS})
        </button>
      )}

      {rows.length >= MAX_ROWS && (
        <p className="text-center text-xs text-muted-foreground">
          Maximum of {MAX_ROWS} instructions per batch reached.
        </p>
      )}

      {/* Submit bar */}
      <div className="sticky bottom-0 flex flex-col gap-2 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5">
        <div className="flex items-center justify-between gap-2 sm:contents">
          <p className="text-xs text-muted-foreground">
            {rows.length} instruction{rows.length !== 1 ? 's' : ''} ready to submit
          </p>
          {!isOnline && (
            <span className="flex items-center gap-1.5 text-xs text-amber-700 sm:hidden">
              <WifiOff className="size-3.5" aria-hidden />
              Offline
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isOnline && (
            <span className="hidden items-center gap-1.5 text-xs text-amber-700 sm:flex">
              <WifiOff className="size-3.5" aria-hidden />
              Offline
            </span>
          )}
          <a
            href="/transactions"
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors sm:flex-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground sm:flex-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy
              ? 'Submitting…'
              : isOnline
              ? `Submit ${rows.length} instruction${rows.length !== 1 ? 's' : ''}`
              : `Save ${rows.length} for later`}
          </button>
        </div>
      </div>
    </form>
  )
}
