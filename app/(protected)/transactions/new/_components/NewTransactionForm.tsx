'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { AlertCircle, FileText, Loader2, Plus, Search, Trash2, Upload, WifiOff, X } from 'lucide-react'

import {
  CreateTransactionSchema,
  type CreateTransactionInput,
  type PaymentInstruction,
  type TransactionType,
} from '@/lib/schemas/transaction.schema'
import { createTransactionAction, createReversalAction, searchTransactionsByReferenceAction } from '@/lib/actions/transaction.actions'
import { uploadDocumentAction } from '@/lib/actions/document.actions'
import { ALLOWED_MIME_TYPES, ALLOWED_FILE_TYPES_LABEL, MAX_FILE_SIZE_BYTES } from '@/lib/constants/document.constants'
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus'
import { enqueue } from '@/lib/offline/queue'

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

const ANNIVERSARY_SCENARIO_OPTIONS = [
  { value: 'ANNIVERSARY_30', label: '30-Day (ANNIVERSARY_30)' },
  { value: 'ANNIVERSARY_60', label: '60-Day (ANNIVERSARY_60)' },
  { value: 'ANNIVERSARY_90', label: '90-Day (ANNIVERSARY_90)' },
] as const

// Scenario codes for INTERNAL_TRANSFER (Req 22.1)
const INTERNAL_TRANSFER_SCENARIO_OPTIONS = [
  { value: 'SAVINGS_TO_PERSONAL',           label: 'Savings → Personal' },
  { value: 'PERSONAL_TO_COMMERCIAL_PAPER',  label: 'Personal → Commercial Paper' },
  { value: 'PERSONAL_TO_CALL_PLACEMENT',    label: 'Personal → Call Placement' },
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

/** Transaction types that require an anniversary scenario code */
const ANNIVERSARY_TYPES: TransactionType[] = ['ANNIVERSARY_PAYMENT']

/** Transaction types that require an internal transfer scenario code (Req 22.1) */
const INTERNAL_TRANSFER_TYPES: TransactionType[] = ['INTERNAL_TRANSFER']

/** Transaction types that require external payment beneficiary fields (Req 7.7) */
const EXTERNAL_PAYMENT_TYPES: TransactionType[] = ['THIRD_PARTY_PAYMENT']

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

// ─── Field helpers ────────────────────────────────────────────────────────────

function FieldError({ message, requiredMessage }: { message?: string; requiredMessage?: string }) {
  if (!message) return null

  // Zod enum errors are verbose (list all valid values). Replace with a short message.
  let display = message
  if (/^Invalid option: expected one of/i.test(message)) {
    display = requiredMessage ?? 'Please select a valid option.'
  }

  return (
    <p className="mt-1.5 break-words text-xs text-destructive" role="alert">
      {display}
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

// ─── Original Transaction result type ────────────────────────────────────────

interface OriginalTransactionOption {
  id: string
  transaction_reference: string
  transaction_type: string
  status: string
  requested_amount: string
  customer_name: string | null
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
              className={`flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted ${
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

// ─── OriginalTransactionCombobox ─────────────────────────────────────────────

/**
 * Searchable combobox for selecting the original transaction to reverse.
 * Queries the server as the user types (min 2 chars) and shows matching
 * transactions that are eligible for reversal (Req 25.5).
 */
function OriginalTransactionCombobox({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (id: string, reference: string) => void
  error?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<OriginalTransactionOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setOptions([])
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      const result = await searchTransactionsByReferenceAction(query.trim())
      if (result.success && result.data) {
        setOptions(result.data)
      }
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Clear options when field is cleared
  useEffect(() => {
    if (!value) {
      setSelectedLabel('')
      setOptions([])
    }
  }, [value])

  function handleSelect(opt: OriginalTransactionOption) {
    onChange(opt.id, opt.transaction_reference)
    setSelectedLabel(`${opt.transaction_reference} — ${opt.customer_name ?? opt.transaction_type}`)
    setQuery('')
    setOpen(false)
  }

  function handleClear() {
    onChange('', '')
    setSelectedLabel('')
    setQuery('')
    setOptions([])
  }

  return (
    <div className="relative">
      {value && selectedLabel ? (
        <div
          className={`flex h-10 items-center justify-between rounded-lg border bg-background px-3 text-sm ${
            error ? 'border-destructive' : 'border-input'
          }`}
        >
          <span className="font-mono text-xs tabular-nums text-foreground">{selectedLabel}</span>
          <button
            type="button"
            onClick={handleClear}
            className="ml-2 rounded-sm p-0.5 text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground focus:outline-none"
            aria-label="Clear selection"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="text"
            autoComplete="off"
            placeholder="Search by reference, e.g. TRX-00001…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className={`h-10 w-full rounded-lg border bg-background py-0 pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
              error ? 'border-destructive' : 'border-input'
            }`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
          />
          {loading && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
          )}
        </div>
      )}

      {open && !value && (
        <>
          {options.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-background shadow-md"
            >
              {options.map((opt) => (
                <li
                  key={opt.id}
                  role="option"
                  aria-selected={opt.id === value}
                  onMouseDown={() => handleSelect(opt)}
                  className="flex cursor-pointer items-start justify-between gap-3 px-3 py-2.5 text-sm transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-xs font-medium tabular-nums">
                      {opt.transaction_reference}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {opt.customer_name ?? '—'} · {opt.transaction_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-xs tabular-nums text-foreground">
                      ₦{Number(opt.requested_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{opt.status.replace(/_/g, ' ')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && query.trim().length >= 2 && options.length === 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground shadow-md">
              No eligible transactions found for &ldquo;{query}&rdquo;.
            </div>
          )}
          {query.trim().length > 0 && query.trim().length < 2 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground shadow-md">
              Type at least 2 characters to search…
            </div>
          )}
        </>
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

  // Eazybankz data for the selected investment
  const [eazybankzData, setEazybankzData] = useState<{
    principal: string
    availableAmount: string
    outstandingBalance: string
    accruedInterest: string
    interestRate: string
    effectiveDate: string
    maturityDate: string
    productType: string
    status: string
  } | null>(null)
  const [loadingEazybankz, setLoadingEazybankz] = useState(false)

  // Multi-account payment instructions for THIRD_PARTY_PAYMENT
  // Each entry has its own internal/external toggle
  const [paymentEntries, setPaymentEntries] = useState<PaymentInstruction[]>([
    { isInternal: false },
  ])

  // Reversal — selected original transaction state (Req 22.4, 25.1)
  const [originalTransactionId, setOriginalTransactionId] = useState('')
  const [originalTransactionRef, setOriginalTransactionRef] = useState('')
  const [reversalReason, setReversalReason] = useState('')
  const [reversalReasonError, setReversalReasonError] = useState('')
  const [originalTxError, setOriginalTxError] = useState('')

  // Source document — required file attachment (uploaded after transaction is created)
  const [sourceDocument, setSourceDocument] = useState<File | null>(null)
  const [sourceDocumentError, setSourceDocumentError] = useState<string | null>(null)
  const sourceDocInputRef = useRef<HTMLInputElement>(null)

  function handleSourceDocChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setSourceDocument(file)
    if (!file) { setSourceDocumentError(null); return }
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      setSourceDocumentError(`Invalid file type. Only ${ALLOWED_FILE_TYPES_LABEL} files are accepted.`)
    } else if (file.size > MAX_FILE_SIZE_BYTES) {
      setSourceDocumentError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`)
    } else {
      setSourceDocumentError(null)
    }
  }

  function handleClearSourceDoc() {
    setSourceDocument(null)
    setSourceDocumentError(null)
    if (sourceDocInputRef.current) sourceDocInputRef.current.value = ''
  }

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
      paymentInstructions: undefined,
    },
  })

  const selectedCustomerId   = watch('customerId')
  const selectedInvestmentId = watch('investmentId')
  const selectedType         = watch('transactionType')
  const selectedScenarioCode = watch('scenarioCode')
  const requestedPayoutValue = watch('requestedPayout')
  const requestedAmountValue = watch('requestedAmount')
  const isRollover           = ROLLOVER_TYPES.includes(selectedType)
  const isAnniversary        = ANNIVERSARY_TYPES.includes(selectedType)
  const isInternalTransfer   = INTERNAL_TRANSFER_TYPES.includes(selectedType)
  const isExternalPayment    = EXTERNAL_PAYMENT_TYPES.includes(selectedType)
  const isReversal           = selectedType === 'REVERSAL'
  const isPartialPrincipal   = isRollover && selectedScenarioCode === 'PARTIAL_PRINCIPAL'
  const needsScenario        = isRollover || isAnniversary || isInternalTransfer

  // Fetch investments when customer changes
  useEffect(() => {
    if (!selectedCustomerId) {
      setInvestments([])
      setValue('investmentId', undefined)
      setEazybankzData(null)
      return
    }

    setLoadingInvestments(true)
    fetch(`/api/investments?customerId=${selectedCustomerId}`)
      .then((r) => r.json())
      .then((data: InvestmentOption[]) => {
        setInvestments(data)
        setValue('investmentId', undefined)
        setEazybankzData(null)
      })
      .catch(() => setInvestments([]))
      .finally(() => setLoadingInvestments(false))
  }, [selectedCustomerId, setValue])

  // Show investment data when investment is selected
  useEffect(() => {
    if (!selectedInvestmentId) {
      setEazybankzData(null)
      return
    }
    const inv = investments.find((i) => i.id === selectedInvestmentId)
    if (!inv) {
      setEazybankzData(null)
      return
    }
    setEazybankzData({
      principal: inv.principal,
      availableAmount: inv.principal,
      outstandingBalance: inv.principal,
      accruedInterest: '0',
      interestRate: '0',
      effectiveDate: '—',
      maturityDate: '—',
      productType: inv.product_type,
      status: 'ACTIVE',
    })
    setLoadingEazybankz(false)
  }, [selectedInvestmentId, investments])
  // Clear payment instructions when type no longer requires them
  useEffect(() => {
    if (!isExternalPayment) {
      setValue('paymentInstructions', undefined)
      setPaymentEntries([{ isInternal: false }])
    }
  }, [isExternalPayment, setValue])

  // Clear scenario code when type no longer requires it
  useEffect(() => {
    if (!isRollover && !isAnniversary && !isInternalTransfer) {
      setValue('scenarioCode', undefined)
    }
  }, [isRollover, isAnniversary, isInternalTransfer, setValue])

  // Clear requestedPayout when not a PARTIAL_PRINCIPAL rollover
  useEffect(() => {
    if (!isPartialPrincipal) {
      setValue('requestedPayout', undefined)
    }
  }, [isPartialPrincipal, setValue])

  // Clear reversal state when type changes away from REVERSAL
  useEffect(() => {
    if (!isReversal) {
      setOriginalTransactionId('')
      setOriginalTransactionRef('')
      setReversalReason('')
      setReversalReasonError('')
      setOriginalTxError('')
    }
  }, [isReversal])

  // Sync paymentEntries → react-hook-form value so Zod validation runs on submit
  useEffect(() => {
    if (isExternalPayment) {
      setValue('paymentInstructions', paymentEntries, { shouldValidate: false })
    }
  }, [paymentEntries, isExternalPayment, setValue])

  // undefined = not yet hydrated → treat as online to avoid flicker
  const networkStatus = useNetworkStatus()
  const isOnline = networkStatus !== false
  const busy = isSubmitting || isPending

  async function onSubmit(data: CreateTransactionInput) {
    // REVERSAL: handled via a dedicated server action (Req 25.1, 25.2)
    if (isReversal) {
      startTransition(async () => {
        let hasError = false

        if (!originalTransactionId) {
          setOriginalTxError('Please select the original transaction to reverse.')
          hasError = true
        } else {
          setOriginalTxError('')
        }

        if (!reversalReason.trim()) {
          setReversalReasonError('Reversal reason is required (Req 25.2).')
          hasError = true
        } else {
          setReversalReasonError('')
        }

        // Source document is required for reversals too
        if (!sourceDocument) {
          setSourceDocumentError('Source document is required.')
          hasError = true
        } else if (sourceDocumentError) {
          hasError = true
        }

        if (hasError) return

        // ── Offline path ──────────────────────────────────────────────────
        if (!isOnline) {
          await enqueue({
            type: 'CREATE_REVERSAL',
            payload: { originalTransactionId, reversalReason: reversalReason.trim() },
          })
          toast.warning('You\'re offline. Reversal saved and will be submitted when you reconnect.')
          return
        }

        const result = await createReversalAction({
          originalTransactionId,
          reversalReason: reversalReason.trim(),
        })

        if (!result.success) {
          toast.error(result.error ?? 'Failed to create reversal transaction.')
          return
        }

        // Upload source document to the newly created transaction
        const uploadResult = await uploadDocumentAction(
          result.data!.transactionId,
          sourceDocument!,
          'INSTRUCTION',
        )
        if (!uploadResult.success) {
          // Transaction created — warn but still navigate so the user can upload manually
          toast.warning(`Reversal created but document upload failed: ${uploadResult.error}`)
        }

        toast.success(`Reversal ${result.data!.reference} created successfully.`)
        router.push(`/transactions/${result.data!.transactionId}`)
      })
      return
    }

    // Guard: source document required before submitting
    if (!sourceDocument) {
      setSourceDocumentError('Source document is required.')
      return
    }
    if (sourceDocumentError) return

    // Standard transaction creation
    startTransition(async () => {
      // ── Offline path ────────────────────────────────────────────────────
      if (!isOnline) {
        await enqueue({ type: 'CREATE_TRANSACTION', payload: { input: data } })
        toast.warning('You\'re offline. Transaction saved and will be submitted when you reconnect.')
        return
      }

      const result = await createTransactionAction(data)

      if (!result.success) {
        toast.error(result.error ?? 'Failed to create transaction.')
        return
      }

      // Upload source document to the newly created transaction
      const uploadResult = await uploadDocumentAction(
        result.data!.transactionId,
        sourceDocument,
        'INSTRUCTION',
      )
      if (!uploadResult.success) {
        // Transaction created — warn but still navigate so user can upload manually
        toast.warning(`Transaction created but document upload failed: ${uploadResult.error}`)
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
      className="space-y-8 min-w-0"
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
                onChange={(id) => setValue('customerId', id, { shouldValidate: id !== '' })}
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
                  onChange={(e) => setValue('investmentId', e.target.value || undefined, { shouldValidate: false })}
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
                  {investments.map((inv) => {
                    const sub = subAccountLabel(inv.external_reference)
                    const typeLabel = sub && sub !== inv.product_type
                      ? `${inv.product_type} (${sub})`
                      : inv.product_type
                    return (
                      <option key={inv.id} value={inv.id}>
                        {typeLabel} — ₦{Number(inv.principal).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                        {inv.external_reference ? ` · ${inv.external_reference}` : ''}
                      </option>
                    )
                  })}
                </select>
              )}
            </div>
            <FieldError message={errors.investmentId?.message} />
          </div>

          {/* Eazybankz investment reference data — shown once investment is selected */}
          {eazybankzData && (
            <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Investment Reference Data
                </p>
                {loadingEazybankz && (
                  <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Product Type</p>
                  <p className="mt-0.5 text-sm text-foreground">{eazybankzData.productType}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Principal</p>
                  <p className="mt-0.5 text-sm text-foreground">
                    ₦{Number(eazybankzData.principal).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Available Amount</p>
                  <p className="mt-0.5 text-sm font-semibold text-emerald-700">
                    ₦{Number(eazybankzData.availableAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Outstanding Balance</p>
                  <p className="mt-0.5 text-sm text-foreground">
                    ₦{Number(eazybankzData.outstandingBalance).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                {eazybankzData.effectiveDate && eazybankzData.effectiveDate !== '—' && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Effective Date</p>
                    <p className="mt-0.5 text-sm text-foreground">{eazybankzData.effectiveDate}</p>
                  </div>
                )}
                {eazybankzData.maturityDate && eazybankzData.maturityDate !== '—' && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Maturity Date</p>
                    <p className="mt-0.5 text-sm text-foreground">{eazybankzData.maturityDate}</p>
                  </div>
                )}
              </div>
            </div>
          )}
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
            <FieldError message={errors.transactionType?.message} requiredMessage="Transaction type is required." />
          </div>

          {/* Scenario code — visible only for ROLLOVER, ANNIVERSARY_PAYMENT, or INTERNAL_TRANSFER */}
          <div className={needsScenario ? 'block' : 'hidden'} aria-hidden={!needsScenario}>
            <Label htmlFor="scenarioCode" required={needsScenario}>
              {isAnniversary ? 'Anniversary Frequency' : isInternalTransfer ? 'Transfer Direction' : 'Rollover Scenario'}
            </Label>
            <div className="mt-2">
              <select
                id="scenarioCode"
                {...register('scenarioCode')}
                className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  errors.scenarioCode ? 'border-destructive' : 'border-input'
                }`}
              >
                <option value="">
                  {isAnniversary ? 'Select frequency…' : isInternalTransfer ? 'Select transfer direction…' : 'Select scenario…'}
                </option>
                {isAnniversary
                  ? ANNIVERSARY_SCENARIO_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  : isInternalTransfer
                  ? INTERNAL_TRANSFER_SCENARIO_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  : SCENARIO_CODE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                }
              </select>
            </div>
            <FieldError message={errors.scenarioCode?.message} />
          </div>

          {/* Requested Payout — visible only for PARTIAL_PRINCIPAL rollover */}
          {isPartialPrincipal && (
            <div>
              <Label htmlFor="requestedPayout" required>
                Requested Payout Amount (₦)
              </Label>
              <div className="mt-2">
                <input
                  id="requestedPayout"
                  type="text"
                  inputMode="decimal"
                  placeholder="Amount to be paid out"
                  {...register('requestedPayout')}
                  className={`h-10 w-full rounded-lg border bg-background px-3 text-sm tabular-nums outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                    errors.requestedPayout ? 'border-destructive' : 'border-input'
                  }`}
                />
              </div>
              <FieldError message={errors.requestedPayout?.message} />
            </div>
          )}

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
            <FieldError message={errors.sourceInstructionType?.message} requiredMessage="Source instruction is required." />
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

      {/* ── Section: Source Document (required) ── */}
      <fieldset className="rounded-xl border border-border bg-background p-6">
        <legend className="px-1 text-sm font-semibold text-foreground">
          Source Document <span className="text-destructive" aria-hidden>*</span>
        </legend>
        <p className="mt-1 text-sm text-muted-foreground">
          Attach the original customer instruction document (letter, email, signed form, etc.).
          Accepted formats: PDF, JPG, PNG, DOC, DOCX · max 10 MB.
        </p>

        <div className="mt-4 space-y-3">
          {sourceDocument && !sourceDocumentError ? (
            /* Selected file preview */
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
              <FileText className="size-4 shrink-0 text-emerald-600" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {sourceDocument.name}
              </span>
              <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                {(sourceDocument.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                type="button"
                onClick={handleClearSourceDoc}
                className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${sourceDocument.name}`}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            /* Drop zone */
            <label
              htmlFor="sourceDocInput"
              className={[
                'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed',
                'px-4 py-6 text-center transition-colors duration-150',
                sourceDocumentError
                  ? 'border-destructive bg-destructive/5'
                  : 'border-border bg-muted/20 [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/40',
              ].join(' ')}
            >
              <Upload className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-xs font-medium text-muted-foreground">
                Click to browse or drop a file here
              </span>
              <span className="text-[0.65rem] text-muted-foreground">
                PDF, JPG, PNG, DOC, DOCX · max 10 MB
              </span>
              <input
                ref={sourceDocInputRef}
                id="sourceDocInput"
                type="file"
                className="sr-only"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleSourceDocChange}
                aria-label="Upload source document"
                aria-required="true"
              />
            </label>
          )}

          {/* Validation error */}
          {sourceDocumentError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
              <p className="text-xs text-destructive" role="alert">{sourceDocumentError}</p>
            </div>
          )}
        </div>
      </fieldset>

      {/* ── Section: Partial Principal Preview — conditionally rendered for PARTIAL_PRINCIPAL rollover ── */}
      {isPartialPrincipal && requestedPayoutValue && requestedAmountValue && (
        (() => {
          const principal = parseFloat(requestedAmountValue)
          const payout = parseFloat(requestedPayoutValue)
          const remaining = isFinite(principal) && isFinite(payout) && payout > 0 && payout < principal
            ? principal - payout
            : null

          return (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-6 space-y-3">
              <p className="text-sm font-semibold text-blue-700">
                Partial Principal Rollover — Calculation Preview
              </p>
              {/* <p className="text-xs text-blue-600/70">
                Authoritative calculations run server-side using PostgreSQL NUMERIC arithmetic.
                Values shown here are estimates for review only.
              </p> */}
              <dl className="grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Original Principal</dt>
                  <dd className="mt-1 font-mono tabular-nums text-foreground">
                    {isFinite(principal) ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(principal) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Requested Payout</dt>
                  <dd className="mt-1 font-mono tabular-nums text-foreground">
                    {isFinite(payout) ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(payout) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Remaining Principal</dt>
                  <dd className="mt-1 font-mono tabular-nums font-semibold text-foreground">
                    {remaining !== null ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(remaining) : <span className="text-destructive text-xs">Payout must be less than principal</span>}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-blue-600/80">
                Rule: remaining_principal = original_principal − requested_payout
              </p>
            </div>
          )
        })()
      )}

      {/* ── Section: Reversal Details — conditionally rendered for REVERSAL ── */}
      {isReversal && (
        <fieldset className="rounded-xl border border-border bg-background p-6">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Reversal Details
          </legend>
          <p className="mt-1 text-sm text-muted-foreground">
            Select the original transaction to reverse and provide a mandatory reason (Req 25.2).
            The original transaction is not modified — a new REVERSAL transaction is created
            that references it (Req 25.1).
          </p>

          <div className="mt-5 space-y-5">
            {/* Original transaction search combobox (Req 22.4, 25.5) */}
            <div>
              <Label htmlFor="original-tx-search" required>
                Original Transaction
              </Label>
              <p className="mt-1 mb-2 text-xs text-muted-foreground">
                Only transactions that are eligible for reversal are shown (DRAFT and CANCELLED
                are excluded; already-reversed transactions are excluded — Req 25.5).
              </p>
              <OriginalTransactionCombobox
                value={originalTransactionId}
                onChange={(id, ref) => {
                  setOriginalTransactionId(id)
                  setOriginalTransactionRef(ref)
                  if (id) setOriginalTxError('')
                }}
                error={originalTxError}
              />
              {originalTxError && (
                <p className="mt-1.5 text-xs text-destructive" role="alert">
                  {originalTxError}
                </p>
              )}
            </div>

            {/* Reversal reason (required — Req 25.2) */}
            <div>
              <Label htmlFor="reversalReason" required>
                Reversal Reason
              </Label>
              <div className="mt-2">
                <textarea
                  id="reversalReason"
                  rows={3}
                  placeholder="Describe why this transaction must be reversed…"
                  value={reversalReason}
                  onChange={(e) => {
                    setReversalReason(e.target.value)
                    if (e.target.value.trim()) setReversalReasonError('')
                  }}
                  className={`w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                    reversalReasonError ? 'border-destructive' : 'border-input'
                  }`}
                />
              </div>
              {reversalReasonError && (
                <p className="mt-1.5 text-xs text-destructive" role="alert">
                  {reversalReasonError}
                </p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Required. This reason is recorded in the audit trail on both the reversal and original
                transaction (Req 25.4).
              </p>
            </div>

            {/* Informational notice */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <p className="text-xs font-medium text-amber-700">
                What happens when a REVERSAL is created:
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-amber-700/80">
                <li>A new REVERSAL transaction is opened at Step 1 (INSTRUCTION_RECEIVED)</li>
                <li>The original transaction is <strong>not changed or deleted</strong></li>
                <li>The reversal passes through all 6 workflow steps + 5-stage approval chain</li>
                <li>On Operations execution, the Eazybankz posting for the original transaction is reversed</li>
                <li>A REVERSAL_CREATED audit event is written on both transactions (Req 25.4)</li>
              </ul>
            </div>
          </div>
        </fieldset>
      )}

      {/* ── Section: Payment Instructions — conditionally rendered for THIRD_PARTY_PAYMENT ── */}
      {isExternalPayment && (
        <fieldset className="rounded-xl border border-border bg-background p-6">
          <legend className="px-1 text-sm font-semibold text-foreground">
            Payment Destinations
          </legend>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one or more beneficiary accounts the client wants the funds sent to.
          </p>

          <div className="mt-5 space-y-4">
            {paymentEntries.map((entry, idx) => {
              const isInternalEntry = entry.isInternal === true
              const entryErrors = (errors.paymentInstructions as Record<string, unknown> | undefined)?.[idx] as Record<string, { message?: string }> | undefined

              function updateEntry(patch: Partial<PaymentInstruction>) {
                setPaymentEntries((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e))
              }

              return (
                <div
                  key={idx}
                  className="relative rounded-lg border border-border bg-muted/20 p-4"
                >
                  {/* Account header */}
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-foreground">
                      Account {idx + 1}
                    </p>
                    <div className="flex items-center gap-2">
                      {/* Internal/External toggle per entry (Req 21.1) */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={!isInternalEntry}
                          onClick={() => updateEntry({ isInternal: false, accountNumber: '', beneficiaryName: '', bankName: '', accountType: undefined })}
                          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                            !isInternalEntry
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-input bg-background text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted'
                          }`}
                        >
                          External
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={isInternalEntry}
                          onClick={() => updateEntry({ isInternal: true, accountNumber: '', beneficiaryName: '', bankName: '', accountType: undefined })}
                          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                            isInternalEntry
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-input bg-background text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted'
                          }`}
                        >
                          Internal
                        </button>
                      </div>

                      {/* Remove button — only if more than one entry */}
                      {paymentEntries.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setPaymentEntries((prev) => prev.filter((_, i) => i !== idx))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:text-destructive"
                          aria-label={`Remove account ${idx + 1}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isInternalEntry ? (
                    /* Internal: only account number required (Req 21.1, 21.3) */
                    <div>
                      <label htmlFor={`pi-${idx}-accountNumber`} className="text-sm font-medium leading-none">
                        Internal Account Number <span className="ml-0.5 text-destructive" aria-hidden>*</span>
                      </label>
                      <div className="mt-2">
                        <input
                          id={`pi-${idx}-accountNumber`}
                          type="text"
                          inputMode="numeric"
                          placeholder="Internal account number"
                          value={entry.accountNumber ?? ''}
                          onChange={(e) => updateEntry({ accountNumber: e.target.value })}
                          className={`h-10 w-full rounded-lg border bg-background px-3 text-sm tabular-nums outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                            entryErrors?.accountNumber ? 'border-destructive' : 'border-input'
                          }`}
                        />
                      </div>
                      {entryErrors?.accountNumber?.message && (
                        <p className="mt-1.5 text-xs text-destructive" role="alert">{entryErrors.accountNumber.message}</p>
                      )}
                    </div>
                  ) : (
                    /* External: full fields required (Req 7.7, 36.1) */
                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Beneficiary name */}
                      <div>
                        <label htmlFor={`pi-${idx}-beneficiaryName`} className="text-sm font-medium leading-none">
                          Beneficiary Name <span className="ml-0.5 text-destructive" aria-hidden>*</span>
                        </label>
                        <div className="mt-2">
                          <input
                            id={`pi-${idx}-beneficiaryName`}
                            type="text"
                            placeholder="Full legal name"
                            value={entry.beneficiaryName ?? ''}
                            onChange={(e) => updateEntry({ beneficiaryName: e.target.value })}
                            className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                              entryErrors?.beneficiaryName ? 'border-destructive' : 'border-input'
                            }`}
                          />
                        </div>
                        {entryErrors?.beneficiaryName?.message && (
                          <p className="mt-1.5 text-xs text-destructive" role="alert">{entryErrors.beneficiaryName.message}</p>
                        )}
                      </div>

                      {/* Bank name */}
                      <div>
                        <label htmlFor={`pi-${idx}-bankName`} className="text-sm font-medium leading-none">
                          Bank Name <span className="ml-0.5 text-destructive" aria-hidden>*</span>
                        </label>
                        <div className="mt-2">
                          <input
                            id={`pi-${idx}-bankName`}
                            type="text"
                            placeholder="e.g. First Bank"
                            value={entry.bankName ?? ''}
                            onChange={(e) => updateEntry({ bankName: e.target.value })}
                            className={`h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                              entryErrors?.bankName ? 'border-destructive' : 'border-input'
                            }`}
                          />
                        </div>
                        {entryErrors?.bankName?.message && (
                          <p className="mt-1.5 text-xs text-destructive" role="alert">{entryErrors.bankName.message}</p>
                        )}
                      </div>

                      {/* Account number */}
                      <div>
                        <label htmlFor={`pi-${idx}-accountNumber`} className="text-sm font-medium leading-none">
                          Account Number <span className="ml-0.5 text-destructive" aria-hidden>*</span>
                        </label>
                        <div className="mt-2">
                          <input
                            id={`pi-${idx}-accountNumber`}
                            type="text"
                            inputMode="numeric"
                            placeholder="10-digit NUBAN"
                            value={entry.accountNumber ?? ''}
                            onChange={(e) => updateEntry({ accountNumber: e.target.value })}
                            className={`h-10 w-full rounded-lg border bg-background px-3 text-sm tabular-nums outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                              entryErrors?.accountNumber ? 'border-destructive' : 'border-input'
                            }`}
                          />
                        </div>
                        {entryErrors?.accountNumber?.message && (
                          <p className="mt-1.5 text-xs text-destructive" role="alert">{entryErrors.accountNumber.message}</p>
                        )}
                      </div>

                      {/* Account type */}
                      <div>
                        <label htmlFor={`pi-${idx}-accountType`} className="text-sm font-medium leading-none">
                          Account Type
                        </label>
                        <div className="mt-2">
                          <select
                            id={`pi-${idx}-accountType`}
                            value={entry.accountType ?? ''}
                            onChange={(e) => updateEntry({ accountType: e.target.value as PaymentInstruction['accountType'] || undefined })}
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30"
                          >
                            <option value="">Select account type…</option>
                            {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add another account button */}
          <button
            type="button"
            onClick={() => setPaymentEntries((prev) => [...prev, { isInternal: false }])}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:border-primary [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary"
          >
            <Plus className="size-3.5" />
            Add another account
          </button>

          {/* Top-level array error (e.g. entire block missing) */}
          {errors.paymentInstructions?.message && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {errors.paymentInstructions.message as string}
            </p>
          )}
        </fieldset>
      )}

      {/* ── Submit ── */}
      <div className="flex items-center justify-end gap-3 pb-6">
        {!isOnline && (
          <span className="flex items-center gap-1.5 text-xs text-amber-700">
            <WifiOff className="size-3.5" aria-hidden />
            Offline — will sync on reconnect
          </span>
        )}
        <a
          href="/transactions"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/90 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? 'Submitting…' : isOnline ? 'Submit instruction' : 'Save for later'}
        </button>
      </div>
    </form>
  )
}
