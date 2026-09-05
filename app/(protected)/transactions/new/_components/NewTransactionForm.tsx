'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import {
  CreateTransactionSchema,
  type CreateTransactionInput,
  type TransactionType,
} from '@/lib/schemas/transaction.schema'
import { createTransactionAction } from '@/lib/actions/transaction.actions'

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

interface Props {
  /** Customers prefetched server-side for the combobox */
  customers: CustomerOption[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

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
  { value: 'REVERSAL',             label: 'Reversal' },
]

const SOURCE_INSTRUCTION_OPTIONS = [
  { value: 'LETTER',      label: 'Letter' },
  { value: 'EMAIL',       label: 'Email' },
  { value: 'SIGNED_FORM', label: 'Signed Form' },
  { value: 'MANDATED',    label: 'Mandated' },
] as const

const SCENARIO_CODE_OPTIONS = [
  { value: 'P_AND_I',          label: 'Principal + Interest' },
  { value: 'PRINCIPAL_ONLY',   label: 'Principal Only' },
  { value: 'PARTIAL_PRINCIPAL',label: 'Partial Principal' },
  { value: 'INTEREST_ONLY',    label: 'Interest Only' },
] as const

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'SAVINGS',          label: 'Savings' },
  { value: 'PERSONAL',         label: 'Personal' },
  { value: 'COMMERCIAL_PAPER', label: 'Commercial Paper' },
  { value: 'CALL',             label: 'Call' },
  { value: 'CMS',              label: 'CMS' },
] as const

/** Transaction types that require a rollover scenario code */
const ROLLOVER_TYPES: TransactionType[] = ['ROLLOVER']

/** Transaction types that require external payment beneficiary fields (Req 7.7) */
const EXTERNAL_PAYMENT_TYPES: TransactionType[] = ['THIRD_PARTY_PAYMENT']

// ─── Field helpers ────────────────────────────────────────────────────────────

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1.5 text-xs text-destructive" role="alert">
      {message}
    </p>
  )
}

function Label({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
    >
      {children}
      {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
    </label>
  )
}

// ─── Customer Combobox ────────────────────────────────────────────────────────

function CustomerCombobox({
  customers,
  value,
  onChange,
  error,
}: {
  customers: CustomerOption[]
  value: string
  onChange: (id: string) => void
  error?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = query.trim()
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.customer_number.toLowerCase().includes(query.toLowerCase()),
      )
    : customers

  const selected = customers.find((c) => c.id === value)

  return (
    <div className="relative">
      <input
        id="customerId-input"
        type="text"
        autoComplete="off"
        placeholder="Search by name or customer number…"
        value={selected ? `${selected.name} (${selected.customer_number})` : query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange('')
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close to allow option click to register
          setTimeout(() => setOpen(false), 150)
        }}
        className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
          error ? 'border-destructive' : 'border-input'
        }`}
        aria-autocomplete="list"
        aria-controls="customer-listbox"
        aria-expanded={open}
        role="combobox"
      />

      {open && filtered.length > 0 && (
        <ul
          id="customer-listbox"
          role="listbox"
          className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border bg-background shadow-md"
        >
          {filtered.slice(0, 50).map((c) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              onMouseDown={() => {
                onChange(c.id)
                setQuery('')
                setOpen(false)
              }}
              className={`flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-muted ${
                c.id === value ? 'bg-muted font-medium' : ''
              }`}
            >
              <span>{c.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{c.customer_number}</span>
            </li>
          ))}
        </ul>
      )}

      {open && query.length > 0 && filtered.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground shadow-md">
          No customers found for &ldquo;{query}&rdquo;.
        </div>
      )}
    </div>
  )
}

// ─── Main form component ──────────────────────────────────────────────────────

export default function NewTransactionForm({ customers }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Customer investments (fetched client-side when customer changes)
  const [investments, setInvestments] = useState<InvestmentOption[]>([])
  const [loadingInvestments, setLoadingInvestments] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateTransactionInput>({
    resolver: zodResolver(CreateTransactionSchema),
    defaultValues: {
      customerId: '',
      transactionType: undefined,
      requestedAmount: '',
      purpose: '',
      sourceInstructionType: undefined,
      paymentInstruction: undefined,
    },
  })

  const selectedCustomerId   = watch('customerId')
  const selectedType         = watch('transactionType')
  const isRollover           = ROLLOVER_TYPES.includes(selectedType)
  const isExternalPayment    = EXTERNAL_PAYMENT_TYPES.includes(selectedType)

  // Fetch investments when customer changes
  useEffect(() => {
    if (!selectedCustomerId) {
      setInvestments([])
      setValue('investmentId', undefined)
      return
    }

    setLoadingInvestments(true)
    fetch(`/api/investments?customerId=${selectedCustomerId}`)
      .then((r) => r.json())
      .then((data: InvestmentOption[]) => {
        setInvestments(data)
        setValue('investmentId', undefined)
      })
      .catch(() => setInvestments([]))
      .finally(() => setLoadingInvestments(false))
  }, [selectedCustomerId, setValue])

  // Clear payment instruction when type no longer requires it
  useEffect(() => {
    if (!isExternalPayment) {
      setValue('paymentInstruction', undefined)
    }
  }, [isExternalPayment, setValue])

  // Clear scenario code when type no longer requires it
  useEffect(() => {
    if (!isRollover) {
      setValue('scenarioCode', undefined)
    }
  }, [isRollover, setValue])

  const busy = isSubmitting || isPending

  async function onSubmit(data: CreateTransactionInput) {
    startTransition(async () => {
      const result = await createTransactionAction(data)

      if (!result.success) {
        toast.error(result.error ?? 'Failed to create transaction.')
        return
      }

      toast.success(`Transaction ${result.data!.reference} created successfully.`)
      router.push(`/transactions/${result.data!.transactionId}`)
    })
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="New transaction form"
      className="space-y-8"
    >
      {/* ── Section: Customer & Investment ── */}
      <fieldset className="rounded-xl border border-border bg-background p-6">
        <legend className="px-1 text-sm font-semibold text-foreground">
          Customer &amp; Investment
        </legend>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {/* Customer combobox */}
          <div className="sm:col-span-2">
            <Label htmlFor="customerId-input" required>
              Customer
            </Label>
            <div className="mt-2">
              <CustomerCombobox
                customers={customers}
                value={selectedCustomerId}
                onChange={(id) => setValue('customerId', id, { shouldValidate: true })}
                error={errors.customerId?.message}
              />
            </div>
            <FieldError message={errors.customerId?.message} />
          </div>

          {/* Investment (optional, populated once customer selected) */}
          <div className="sm:col-span-2">
            <Label htmlFor="investmentId">
              Investment{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="mt-2">
              {loadingInvestments ? (
                <div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading investments…
                </div>
              ) : (
                <select
                  id="investmentId"
                  {...register('investmentId')}
                  disabled={!selectedCustomerId || investments.length === 0}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {!selectedCustomerId
                      ? 'Select a customer first'
                      : investments.length === 0
                      ? 'No investments found'
                      : 'Select investment (optional)'}
                  </option>
                  {investments.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.product_type} — ₦{Number(inv.principal).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                      {inv.external_reference ? ` (${inv.external_reference})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <FieldError message={errors.investmentId?.message} />
          </div>
        </div>
      </fieldset>

      {/* ── Section: Transaction Details ── */}
      <fieldset className="rounded-xl border border-border bg-background p-6">
        <legend className="px-1 text-sm font-semibold text-foreground">
          Transaction Details
        </legend>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {/* Transaction type */}
          <div>
            <Label htmlFor="transactionType" required>
              Transaction Type
            </Label>
            <div className="mt-2">
              <select
                id="transactionType"
                {...register('transactionType')}
                className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  errors.transactionType ? 'border-destructive' : 'border-input'
                }`}
              >
                <option value="">Select type…</option>
                {TRANSACTION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <FieldError message={errors.transactionType?.message} />
          </div>

          {/* Scenario code — visible only for ROLLOVER */}
          <div className={isRollover ? 'block' : 'hidden'} aria-hidden={!isRollover}>
            <Label htmlFor="scenarioCode" required={isRollover}>
              Rollover Scenario
            </Label>
            <div className="mt-2">
              <select
                id="scenarioCode"
                {...register('scenarioCode')}
                className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  errors.scenarioCode ? 'border-destructive' : 'border-input'
                }`}
              >
                <option value="">Select scenario…</option>
                {SCENARIO_CODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <FieldError message={errors.scenarioCode?.message} />
          </div>

          {/* Requested amount */}
          <div>
            <Label htmlFor="requestedAmount" required>
              Requested Amount (₦)
            </Label>
            <div className="mt-2">
              <input
                id="requestedAmount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                {...register('requestedAmount')}
                className={`h-10 w-full rounded-lg border bg-background px-3 text-sm tabular-nums outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  errors.requestedAmount ? 'border-destructive' : 'border-input'
                }`}
              />
            </div>
            <FieldError message={errors.requestedAmount?.message} />
          </div>

          {/* Source instruction type */}
          <div>
            <Label htmlFor="sourceInstructionType" required>
              Source Instruction Type
            </Label>
            <div className="mt-2">
              <select
                id="sourceInstructionType"
                {...register('sourceInstructionType')}
                className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  errors.sourceInstructionType ? 'border-destructive' : 'border-input'
                }`}
              >
                <option value="">Select source…</option>
                {SOURCE_INSTRUCTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <FieldError message={errors.sourceInstructionType?.message} />
          </div>

          {/* Purpose */}
          <div className="sm:col-span-2">
            <Label htmlFor="purpose" required>
              Purpose
            </Label>
            <div className="mt-2">
              <textarea
                id="purpose"
                rows={3}
                placeholder="Describe the customer instruction…"
                {...register('purpose')}
                className={`w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  errors.purpose ? 'border-destructive' : 'border-input'
                }`}
              />
            </div>
            <FieldError message={errors.purpose?.message} />
          </div>
        </div>
      </fieldset>

      {/* ── Section: Payment Instruction — conditionally rendered for THIRD_PARTY_PAYMENT ── */}
      {isExternalPayment && (
        <fieldset className="rounded-xl border border-border bg-background p-6">
          <legend className="px-1 text-sm font-semibold text-foreground">
            External Payment Beneficiary
          </legend>
          <p className="mt-1 text-sm text-muted-foreground">
            Required for third-party external payments. All fields below are mandatory.
          </p>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {/* Beneficiary name */}
            <div>
              <Label htmlFor="paymentInstruction.beneficiaryName" required>
                Beneficiary Name
              </Label>
              <div className="mt-2">
                <input
                  id="paymentInstruction.beneficiaryName"
                  type="text"
                  placeholder="Full legal name"
                  {...register('paymentInstruction.beneficiaryName')}
                  className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                    errors.paymentInstruction?.beneficiaryName ? 'border-destructive' : 'border-input'
                  }`}
                />
              </div>
              <FieldError message={errors.paymentInstruction?.beneficiaryName?.message} />
            </div>

            {/* Bank name */}
            <div>
              <Label htmlFor="paymentInstruction.bankName" required>
                Bank Name
              </Label>
              <div className="mt-2">
                <input
                  id="paymentInstruction.bankName"
                  type="text"
                  placeholder="e.g. First Bank"
                  {...register('paymentInstruction.bankName')}
                  className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                    errors.paymentInstruction?.bankName ? 'border-destructive' : 'border-input'
                  }`}
                />
              </div>
              <FieldError message={errors.paymentInstruction?.bankName?.message} />
            </div>

            {/* Account number */}
            <div>
              <Label htmlFor="paymentInstruction.accountNumber" required>
                Account Number
              </Label>
              <div className="mt-2">
                <input
                  id="paymentInstruction.accountNumber"
                  type="text"
                  inputMode="numeric"
                  placeholder="10-digit NUBAN"
                  {...register('paymentInstruction.accountNumber')}
                  className={`h-10 w-full rounded-lg border bg-background px-3 text-sm tabular-nums outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                    errors.paymentInstruction?.accountNumber ? 'border-destructive' : 'border-input'
                  }`}
                />
              </div>
              <FieldError message={errors.paymentInstruction?.accountNumber?.message} />
            </div>

            {/* Account type */}
            <div>
              <Label htmlFor="paymentInstruction.accountType" required>
                Account Type
              </Label>
              <div className="mt-2">
                <select
                  id="paymentInstruction.accountType"
                  {...register('paymentInstruction.accountType')}
                  className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                    errors.paymentInstruction?.accountType ? 'border-destructive' : 'border-input'
                  }`}
                >
                  <option value="">Select account type…</option>
                  {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <FieldError message={errors.paymentInstruction?.accountType?.message} />
            </div>

            {/* Hidden — is_internal defaults to false for THIRD_PARTY_PAYMENT */}
            <input
              type="hidden"
              {...register('paymentInstruction.isInternal')}
              value="false"
            />
          </div>

          {/* Top-level payment instruction error (e.g. entire block missing) */}
          {errors.paymentInstruction?.root?.message && (
            <FieldError message={errors.paymentInstruction.root.message} />
          )}
        </fieldset>
      )}

      {/* ── Submit ── */}
      <div className="flex items-center justify-end gap-3 pb-6">
        <a
          href="/transactions"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform duration-150 hover:bg-primary/90 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? 'Submitting…' : 'Submit instruction'}
        </button>
      </div>
    </form>
  )
}
