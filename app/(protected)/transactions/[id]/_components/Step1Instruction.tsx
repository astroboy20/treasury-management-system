'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ArrowRight, DatabaseZap, AlertTriangle, Pencil, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  updateCustomerAction,
} from '@/lib/actions/customer.actions'
import {
  UpdateCustomerSchema,
} from '@/lib/schemas/customer.schema'
import type { UpdateCustomerInput } from '@/lib/schemas/customer.schema'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'
import type { EazybankzInvestment } from '@/lib/services/eazybankz'
import type { UploadedDocument } from '@/components/treasury/DocumentUpload'
import { DocumentUpload } from '@/components/treasury/DocumentUpload'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step1InstructionProps {
  transaction: TransactionWorkspace['transaction']
  customer:    TransactionWorkspace['customer']
  createdBy:   TransactionWorkspace['createdBy']
  /** Whether the current user can edit customer info (TREASURY_OFFICER or ADMIN) */
  canEdit?: boolean
  /** Whether the current user can upload documents */
  canUpload?: boolean
  /** Previously uploaded instruction document, if any */
  existingDocument?: UploadedDocument | null
  /** Payment instructions (one-to-many) */
  paymentInstructions?: TransactionWorkspace['paymentInstructions']
  /** Live Eazybankz investment data for validation */
  eazybankzData?: EazybankzInvestment | null
  /** Local investment record linked to the transaction */
  investment?: TransactionWorkspace['investment']
  /** Source instruction document (INSTRUCTION type), if already uploaded */
  sourceDocument?: UploadedDocument | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  ROLLOVER:             'Rollover',
  MATURITY_TERMINATION: 'Maturity Termination',
  PRE_LIQUIDATION:      'Pre-Liquidation',
  ANNIVERSARY_PAYMENT:  'Anniversary Payment',
  THIRD_PARTY_PAYMENT:  'Third-Party Payment',
  INTERNAL_TRANSFER:    'Internal Transfer',
  INFLOW:               'Inflow',
  SAVINGS_FUNDS_OUT:    'Savings Funds Out',
  CALL_FUNDS_OUT:       'Call Funds Out',
  CMS_FUNDS_OUT:        'CMS Funds Out',
  REVERSAL:             'Reversal',
}

const SOURCE_LABELS: Record<string, string> = {
  LETTER:      'Letter',
  EMAIL:       'Email',
  SIGNED_FORM: 'Signed Form',
  MANDATED:    'Mandated',
}

function formatAmount(raw: string): string {
  const n = Number(raw)
  if (isNaN(n)) return '—'
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' })
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{value || <span className="italic text-muted-foreground">—</span>}</dd>
    </div>
  )
}

// ─── Update Customer Dialog ───────────────────────────────────────────────────

interface UpdateCustomerDialogProps {
  open: boolean
  onClose: () => void
  customer: NonNullable<TransactionWorkspace['customer']>
  transactionId: string
}

function UpdateCustomerDialog({ open, onClose, customer, transactionId }: UpdateCustomerDialogProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UpdateCustomerInput>({
    resolver: zodResolver(UpdateCustomerSchema),
    defaultValues: {
      name:             customer.name,
      registered_phone: customer.registered_phone ?? '',
      status:           (customer.status as UpdateCustomerInput['status']) ?? 'ACTIVE',
    },
  })

  const status = watch('status')

  async function onSubmit(data: UpdateCustomerInput) {
    setSubmitting(true)
    const result = await updateCustomerAction(customer.id, data, transactionId)
    setSubmitting(false)

    if (result.success) {
      toast.success('Customer information updated.')
      router.refresh()
      onClose()
    } else {
      toast.error(result.error ?? 'Update failed. Please try again.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Update Customer</DialogTitle>
          <DialogDescription>
            Edit basic information for{' '}
            <span className="font-medium text-foreground">{customer.name}</span>{' '}
            ({customer.customer_number})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="cu-name" className="text-xs font-medium">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cu-name"
              type="text"
              disabled={submitting}
              {...register('name')}
              className="text-sm"
              aria-describedby={errors.name ? 'cu-name-error' : undefined}
            />
            {errors.name && (
              <p id="cu-name-error" className="text-xs text-destructive" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

          {/* Registered phone */}
          <div className="space-y-1.5">
            <Label htmlFor="cu-phone" className="text-xs font-medium">
              Registered Phone{' '}
              <span className="font-normal text-muted-foreground/70">(optional)</span>
            </Label>
            <Input
              id="cu-phone"
              type="tel"
              placeholder="+234 800 000 0000"
              disabled={submitting}
              {...register('registered_phone')}
              className="text-sm"
              aria-describedby={errors.registered_phone ? 'cu-phone-error' : undefined}
            />
            {errors.registered_phone && (
              <p id="cu-phone-error" className="text-xs text-destructive" role="alert">
                {errors.registered_phone.message}
              </p>
            )}
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label htmlFor="cu-status" className="text-xs font-medium">
              Account Status <span className="text-destructive">*</span>
            </Label>
            <Select
              value={status}
              onValueChange={(v) =>
                setValue('status', v as UpdateCustomerInput['status'], { shouldValidate: true })
              }
              disabled={submitting}
            >
              <SelectTrigger id="cu-status" className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
              </SelectContent>
            </Select>
            {errors.status && (
              <p className="text-xs text-destructive" role="alert">
                {errors.status.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Step1Instruction({
  transaction,
  customer,
  createdBy,
  canEdit,
  canUpload,
  existingDocument,
  paymentInstructions,
  eazybankzData,
  investment,
  sourceDocument,
}: Step1InstructionProps) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Transaction Reference" value={
          <span className="font-mono font-semibold text-primary">
            {transaction.transaction_reference}
          </span>
        } />
        <Field label="Customer" value={
          customer
            ? `${customer.name} (${customer.customer_number})`
            : transaction.customer_id
        } />
        <Field
          label="Transaction Type"
          value={TYPE_LABELS[transaction.transaction_type] ?? transaction.transaction_type}
        />
        {transaction.scenario_code && (
          <Field label="Scenario Code" value={transaction.scenario_code.replace(/_/g, ' ')} />
        )}
        <Field label="Requested Amount" value={formatAmount(transaction.requested_amount)} />
        <Field
          label="Source Instruction Type"
          value={SOURCE_LABELS[transaction.source_instruction_type] ?? transaction.source_instruction_type}
        />
        <Field label="Currency" value={transaction.currency} />
        <Field label="Purpose" value={transaction.purpose} />
        <Field
          label="Submitted By"
          value={createdBy?.full_name ?? transaction.created_by}
        />
        <Field label="Submitted At" value={formatDate(transaction.created_at)} />
        {transaction.transaction_type === 'REVERSAL' && transaction.original_transaction_id && (
          <Field
            label="Original Transaction ID"
            value={
              <span className="font-mono text-xs text-muted-foreground">
                {transaction.original_transaction_id}
              </span>
            }
          />
        )}
      </dl>

      {/* Payment destinations — shown for THIRD_PARTY_PAYMENT */}
      {paymentInstructions && paymentInstructions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Payment Destination{paymentInstructions.length > 1 ? 's' : ''}
          </p>
          {paymentInstructions.map((pi, idx) => (
            <div
              key={pi.id}
              className="rounded-lg border border-border bg-muted/20 p-4"
              role="region"
              aria-label={`Payment destination ${idx + 1}`}
            >
              <div className="mb-3 flex items-center gap-2">
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs font-semibold text-foreground">
                  Account {idx + 1}
                  {pi.is_internal && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Internal
                    </span>
                  )}
                </p>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                {!pi.is_internal && (
                  <>
                    <Field label="Beneficiary Name" value={pi.beneficiary_name ?? '—'} />
                    <Field label="Bank Name" value={pi.bank_name ?? '—'} />
                  </>
                )}
                <Field label="Account Number" value={pi.account_number ?? '—'} />
                {pi.account_type && <Field label="Account Type" value={pi.account_type} />}
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* Eazybankz investment data + customer details */}
      {(eazybankzData || investment || customer) && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <DatabaseZap className="size-4 text-primary shrink-0" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Investment Reference Data (Eazybankz)
            </p>
          </div>

          {!eazybankzData && investment && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>Live Eazybankz data unavailable. Showing local investment snapshot.</span>
            </div>
          )}

          {(eazybankzData || investment) && (
            <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              <Field
                label="Product Type"
                value={eazybankzData?.productType ?? investment?.product_type ?? '—'}
              />
              <Field
                label="Status"
                value={eazybankzData?.status ?? investment?.status ?? '—'}
              />
              <Field
                label="Principal"
                value={formatAmount(eazybankzData?.principal ?? investment?.principal ?? '')}
              />
              <Field
                label="Available Amount"
                value={
                  <span className="font-semibold text-emerald-700">
                    {formatAmount(eazybankzData?.availableAmount ?? investment?.available_amount ?? '')}
                  </span>
                }
              />
              <Field
                label="Outstanding Balance"
                value={formatAmount(eazybankzData?.outstandingBalance ?? investment?.outstanding_balance ?? '')}
              />
              <Field
                label="Accrued Interest"
                value={formatAmount(eazybankzData?.accruedInterest ?? investment?.accrued_interest ?? '')}
              />
              <Field
                label="Interest Rate"
                value={
                  (() => {
                    const raw = eazybankzData?.interestRate ?? investment?.interest_rate ?? null
                    if (!raw) return '—'
                    const n = parseFloat(raw)
                    if (isNaN(n)) return raw
                    const pct = n < 1 ? n * 100 : n
                    return `${pct.toFixed(4)}%`
                  })()
                }
              />
              <Field
                label="Effective Date"
                value={eazybankzData?.effectiveDate ?? investment?.effective_date ?? '—'}
              />
              <Field
                label="Maturity Date"
                value={eazybankzData?.maturityDate ?? investment?.maturity_date ?? '—'}
              />
            </dl>
          )}

          {/* Customer details + update button */}
          {customer && (
            <div className="border-t border-primary/10 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Customer Details
                </p>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="size-3" aria-hidden />
                    Update
                  </Button>
                )}
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Full Name" value={customer.name} />
                <Field label="Customer Number" value={customer.customer_number} />
                {customer.registered_phone && (
                  <Field label="Registered Phone" value={customer.registered_phone} />
                )}
                <Field label="Account Status" value={customer.status} />
              </dl>
            </div>
          )}
        </div>
      )}

      {/* Source document — shown when one was attached at creation, or allow upload */}
      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source Document
          </p>
        </div>

        {sourceDocument || canUpload ? (
          <DocumentUpload
            transactionId={transaction.id}
            defaultDocumentType="INSTRUCTION"
            existingDocument={sourceDocument ?? null}
          />
        ) : (
          <p className="text-xs text-muted-foreground italic">No source document attached.</p>
        )}
      </div>

      {/* Update customer dialog */}
      {customer && editOpen && (
        <UpdateCustomerDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          customer={customer}
          transactionId={transaction.id}
        />
      )}
    </div>
  )
}
