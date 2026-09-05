import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, Plus, SlidersHorizontal } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { listTransactions, type TransactionListItem } from '@/lib/services/transaction.service'
import { STATUS_TO_OWNER } from '@/lib/permissions/permissions'
import TransactionFiltersBar from './_components/TransactionFiltersBar'
import PaginationBar from './_components/PaginationBar'

// ─── Constants ────────────────────────────────────────────────────────────────

export const TRANSACTION_TYPES = [
  { value: 'ROLLOVER',             label: 'Rollover' },
  { value: 'MATURITY_TERMINATION', label: 'Maturity Termination' },
  { value: 'PRE_LIQUIDATION',      label: 'Pre-Liquidation' },
  { value: 'ANNIVERSARY_PAYMENT',  label: 'Anniversary Payment' },
  { value: 'THIRD_PARTY_PAYMENT',  label: 'Third Party Payment' },
  { value: 'INTERNAL_TRANSFER',    label: 'Internal Transfer' },
  { value: 'INFLOW',               label: 'Inflow' },
  { value: 'SAVINGS_FUNDS_OUT',    label: 'Savings Funds Out' },
  { value: 'CALL_FUNDS_OUT',       label: 'Call Funds Out' },
  { value: 'CMS_FUNDS_OUT',        label: 'CMS Funds Out' },
  { value: 'REVERSAL',             label: 'Reversal' },
] as const

export const TRANSACTION_STATUSES = [
  { value: 'DRAFT',                    label: 'Draft' },
  { value: 'INSTRUCTION_RECEIVED',     label: 'Instruction Received' },
  { value: 'SIGNATURE_VERIFIED',       label: 'Signature Verified' },
  { value: 'CUSTOMER_CONFIRMED',       label: 'Customer Confirmed' },
  { value: 'INVESTMENT_VERIFIED',      label: 'Investment Verified' },
  { value: 'VOUCHER_PREPARED',         label: 'Voucher Prepared' },
  { value: 'TREASURY_APPROVED',        label: 'Treasury Approved' },
  { value: 'HEAD_TREASURY_APPROVED',   label: 'Head Treasury Approved' },
  { value: 'MIS_APPROVED',             label: 'MIS Approved' },
  { value: 'AUDIT_APPROVED',           label: 'Audit Approved' },
  { value: 'MD_APPROVED',              label: 'MD Approved' },
  { value: 'OPERATIONS_PROCESSING',    label: 'Operations Processing' },
  { value: 'OPERATIONS_COMPLETED',     label: 'Operations Completed' },
  { value: 'TREASURY_CONFIRMED',       label: 'Treasury Confirmed' },
  { value: 'COMPLETED',                label: 'Completed' },
  { value: 'RETURNED',                 label: 'Returned' },
  { value: 'REJECTED',                 label: 'Rejected' },
  { value: 'CANCELLED',                label: 'Cancelled' },
  { value: 'FAILED',                   label: 'Failed' },
] as const

const PAGE_SIZES = [10, 25, 50] as const

const EXCEPTION_STATUSES = new Set(['REJECTED', 'RETURNED', 'FAILED', 'CANCELLED'])
const TERMINAL_STATUSES   = new Set(['COMPLETED', 'REJECTED', 'REJECTED', 'CANCELLED'])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(raw: string | number | null | undefined): string {
  if (raw == null) return '—'
  const n = Number(raw)
  if (isNaN(n)) return '—'
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

type StatusColor = 'green' | 'blue' | 'amber' | 'red' | 'slate'

function statusColor(status: string): StatusColor {
  if (status === 'COMPLETED')                  return 'green'
  if (EXCEPTION_STATUSES.has(status))          return 'red'
  if (status.endsWith('_APPROVED'))            return 'blue'
  if (status === 'VOUCHER_PREPARED')           return 'blue'
  if (status === 'MD_APPROVED' ||
      status.startsWith('OPERATIONS'))         return 'amber'
  if (status === 'DRAFT')                      return 'slate'
  return 'amber'
}

const COLOR_CLASSES: Record<StatusColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue:  'bg-blue-50 text-blue-700 ring-blue-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red:   'bg-red-50 text-red-700 ring-red-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
}

type SlaState = 'ok' | 'warning' | 'breached' | 'na'

function slaState(sla_due_at: string | null, status: string): SlaState {
  if (!sla_due_at || TERMINAL_STATUSES.has(status)) return 'na'
  const due  = new Date(sla_due_at).getTime()
  const now  = Date.now()
  const diff = due - now
  if (diff < 0)                    return 'breached'
  if (diff < 2 * 60 * 60 * 1_000) return 'warning'
  return 'ok'
}

function SlaIndicator({ state }: { state: SlaState }) {
  if (state === 'na') return <span className="text-xs text-muted-foreground">—</span>
  const cfg = {
    ok:      { dot: 'bg-emerald-500', label: 'On track' },
    warning: { dot: 'bg-amber-500',   label: 'Due soon' },
    breached:{ dot: 'bg-red-500',     label: 'Overdue' },
  }[state]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`size-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      <span className={state === 'breached' ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
        {cfg.label}
      </span>
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${COLOR_CLASSES[color]}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function getCustomerName(tx: TransactionListItem): string {
  if (!tx.customers) return '—'
  return tx.customers.name
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{
    type?: string
    status?: string
    from?: string
    to?: string
    customer?: string
    reference?: string
    page?: string
    pageSize?: string
  }>
}

export default async function TransactionsPage({ searchParams }: PageProps) {
  // Resolve authenticated user server-side
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // Await search params (Next.js 15+ requires this)
  const params = await searchParams

  // Parse + validate pagination
  const rawPage     = parseInt(params.page     ?? '1',  10)
  const rawPageSize = parseInt(params.pageSize ?? '25', 10)
  const page        = isNaN(rawPage)     || rawPage < 1         ? 1  : rawPage
  const pageSize    = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? (rawPageSize as 10 | 25 | 50)
    : 25

  // Build filter object from URL params
  const filters = {
    type:      params.type      || undefined,
    status:    params.status    || undefined,
    from:      params.from      || undefined,
    to:        params.to        || undefined,
    customer:  params.customer  || undefined,
    reference: params.reference || undefined,
  }

  // Fetch paginated, filtered results server-side
  let transactions: TransactionListItem[] = []
  let totalCount = 0

  try {
    const result = await listTransactions(filters, { page, pageSize })
    transactions = result.data
    totalCount   = result.count
  } catch {
    // Render with empty state on error; errors show in UI gracefully
  }

  const totalPages    = Math.max(1, Math.ceil(totalCount / pageSize))
  const hasFilters    = Object.values(filters).some(Boolean)
  const startRow      = (page - 1) * pageSize + 1
  const endRow        = Math.min(page * pageSize, totalCount)

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Transaction management</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">All transactions</h2>
          <p className="mt-2 text-muted-foreground">
            {totalCount > 0
              ? `${totalCount.toLocaleString()} instruction${totalCount !== 1 ? 's' : ''} across all workflows`
              : 'No instructions found'}
          </p>
        </div>
        <Link
          href="/transactions/new"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform duration-150 hover:bg-primary/90 active:scale-[.97]"
        >
          <Plus className="size-4" />
          New instruction
        </Link>
      </div>

      {/* Filter bar — client component that reads/writes URL params */}
      <div className="mt-6 rounded-xl border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <SlidersHorizontal className="size-4" />
          Filters
        </div>
        <TransactionFiltersBar
          types={TRANSACTION_TYPES}
          statuses={TRANSACTION_STATUSES}
          currentFilters={{
            type:      params.type      ?? '',
            status:    params.status    ?? '',
            from:      params.from      ?? '',
            to:        params.to        ?? '',
            search:    params.customer ?? params.reference ?? '',
          }}
        />
      </div>

      {/* Results table */}
      <section className="mt-4 rounded-xl border border-border bg-background">
        {/* Table header */}
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {hasFilters && totalCount === 0
              ? 'No results match your filters.'
              : totalCount > 0
              ? `Showing ${startRow}–${endRow} of ${totalCount.toLocaleString()} result${totalCount !== 1 ? 's' : ''}`
              : 'No transactions yet.'}
          </p>
          {/* Page size selector */}
          {totalCount > 0 && (
            <PaginationBar
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSizes={PAGE_SIZES}
              currentParams={params}
              variant="compact"
            />
          )}
        </div>

        {/* Empty state */}
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {hasFilters ? (
              <>
                <p className="text-sm font-medium">No transactions match these filters.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try adjusting or clearing the filters above.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">No transactions yet.</p>
                <Link
                  href="/transactions/new"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  <Plus className="size-4" />
                  Create the first instruction
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Reference</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Current Owner</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">SLA</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const customer = getCustomerName(tx)
                  const owner    = STATUS_TO_OWNER[tx.status] ?? '—'
                  const sla      = slaState(tx.sla_due_at, tx.status)

                  return (
                    <tr
                      key={tx.id}
                      className="border-t border-border transition-colors duration-150 hover:bg-muted/40"
                    >
                      <td className="px-5 py-4">
                        <span className="font-mono text-xs font-semibold text-primary">
                          {tx.transaction_reference}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-medium">{customer}</td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {formatType(tx.transaction_type)}
                      </td>
                      <td className="px-5 py-4 tabular-nums">
                        {formatAmount(tx.requested_amount)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={tx.status} />
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{owner}</td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {formatDate(tx.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <SlaIndicator state={sla} />
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          href={`/transactions/${tx.id}`}
                          aria-label={`Open transaction ${tx.transaction_reference}`}
                          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[.97]"
                        >
                          <ArrowUpRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {totalCount > pageSize && (
          <div className="border-t border-border p-4">
            <PaginationBar
              page={page}
              pageSize={pageSize}
              totalPages={totalPages}
              totalCount={totalCount}
              pageSizes={PAGE_SIZES}
              currentParams={params}
              variant="full"
            />
          </div>
        )}
      </section>
    </div>
  )
}
