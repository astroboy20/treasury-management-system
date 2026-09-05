import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step1InstructionProps {
  transaction: TransactionWorkspace['transaction']
  customer:    TransactionWorkspace['customer']
  createdBy:   TransactionWorkspace['createdBy']
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Step1Instruction({ transaction, customer, createdBy }: Step1InstructionProps) {
  return (
    <div>
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
      </dl>
    </div>
  )
}
