import Link from 'next/link'
import { ArrowLeft, Clock } from 'lucide-react'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceHeaderProps {
  transaction: TransactionWorkspace['transaction']
  customer: TransactionWorkspace['customer']
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

type StatusColor = 'green' | 'blue' | 'amber' | 'red' | 'slate'

const EXCEPTION_STATUSES = new Set(['REJECTED', 'RETURNED', 'FAILED', 'CANCELLED'])

function statusColor(status: string): StatusColor {
  if (status === 'COMPLETED') return 'green'
  if (EXCEPTION_STATUSES.has(status)) return 'red'
  if (status.endsWith('_APPROVED')) return 'blue'
  if (status === 'VOUCHER_PREPARED') return 'blue'
  if (status === 'MD_APPROVED' || status.startsWith('OPERATIONS')) return 'amber'
  if (status === 'DRAFT') return 'slate'
  return 'amber'
}

const COLOR_CLASSES: Record<StatusColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  blue:  'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  red:   'bg-red-50 text-red-700 ring-1 ring-red-200',
  slate: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
}

function formatAmount(raw: string | null | undefined): string {
  if (!raw) return '—'
  const n = Number(raw)
  if (isNaN(n)) return '—'
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type SlaState = 'ok' | 'warning' | 'breached' | 'na'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED'])

function getSlaState(sla_due_at: string | null, status: string): SlaState {
  if (!sla_due_at || TERMINAL_STATUSES.has(status)) return 'na'
  const due  = new Date(sla_due_at).getTime()
  const now  = Date.now()
  const diff = due - now
  if (diff < 0) return 'breached'
  if (diff < 2 * 60 * 60 * 1_000) return 'warning'
  return 'ok'
}

function formatSlaRemaining(sla_due_at: string): string {
  const diff = new Date(sla_due_at).getTime() - Date.now()
  if (diff <= 0) {
    const overdue = Math.abs(diff)
    const hours = Math.floor(overdue / (60 * 60 * 1_000))
    if (hours > 0) return `${hours}h overdue`
    const mins = Math.floor(overdue / 60_000)
    return `${mins}m overdue`
  }
  const hours = Math.floor(diff / (60 * 60 * 1_000))
  if (hours > 0) {
    const mins = Math.floor((diff % (60 * 60 * 1_000)) / 60_000)
    return `${hours}h ${mins}m remaining`
  }
  const mins = Math.floor(diff / 60_000)
  return `${mins}m remaining`
}

// ─── SLA Indicator ────────────────────────────────────────────────────────────

function SlaChip({ sla_due_at, status }: { sla_due_at: string | null; status: string }) {
  const state = getSlaState(sla_due_at, status)
  if (state === 'na') return null

  const cfg = {
    ok:       { dot: 'bg-emerald-500', text: 'text-emerald-700', label: formatSlaRemaining(sla_due_at!) },
    warning:  { dot: 'bg-amber-500',   text: 'text-amber-700',   label: formatSlaRemaining(sla_due_at!) },
    breached: { dot: 'bg-red-500',     text: 'text-red-700',     label: formatSlaRemaining(sla_due_at!) },
  }[state]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.text} bg-current/5`}
      title={`SLA due: ${new Date(sla_due_at!).toLocaleString('en-NG')}`}
    >
      <Clock className="size-3" aria-hidden />
      <span className={`size-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      {cfg.label}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkspaceHeader({ transaction, customer }: WorkspaceHeaderProps) {
  const color = statusColor(transaction.status)
  const typeLabel = TYPE_LABELS[transaction.transaction_type] ?? transaction.transaction_type

  return (
    <div className="border-b border-border bg-background px-5 py-5 sm:px-8">
      {/* Back navigation */}
      <Link
        href="/transactions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All transactions
      </Link>

      {/* Main header row */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: Reference + customer */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {transaction.transaction_reference}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${COLOR_CLASSES[color]}`}
            >
              {transaction.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {customer?.name
              ? <><span className="font-medium text-foreground">{customer.name}</span>{' '}<span className="text-muted-foreground">· {customer.customer_number}</span></>
              : <span className="italic">Customer not found</span>
            }
          </p>
        </div>

        {/* Right: Type + amount + SLA */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{typeLabel}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {formatAmount(transaction.requested_amount)}
            </p>
            {transaction.approved_amount && transaction.approved_amount !== transaction.requested_amount && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Approved: {formatAmount(transaction.approved_amount)}
              </p>
            )}
          </div>
          <SlaChip sla_due_at={transaction.sla_due_at} status={transaction.status} />
        </div>
      </div>
    </div>
  )
}
