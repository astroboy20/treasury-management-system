import Link from 'next/link'
import { ArrowUpRight, Plus } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { createClient } from '@/lib/supabase/server'
import { STATUS_TO_OWNER } from '@/lib/permissions/permissions'
import { RealtimeSubscriber } from '@/components/treasury/RealtimeSubscriber'

// ─── Types ───────────────────────────────────────────────────────────────────

interface RecentTransaction {
  id: string
  transaction_reference: string
  transaction_type: string
  requested_amount: number
  status: string
  created_at: string
  customers: { name: string } | null
}

interface DashboardMetrics {
  pendingMyAction: number
  inProgress: number
  completedThisWeekCount: number
  completedThisWeekAmount: number
  exceptions: number
  slaBreachCount: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Statuses that count as "in-progress" (between INSTRUCTION_RECEIVED and MD_APPROVED). */
const IN_PROGRESS_STATUSES = [
  'INSTRUCTION_RECEIVED',
  'SIGNATURE_VERIFIED',
  'CUSTOMER_CONFIRMED',
  'INVESTMENT_VERIFIED',
  'VOUCHER_PREPARED',
  'TREASURY_APPROVED',
  'HEAD_TREASURY_APPROVED',
  'MIS_APPROVED',
  'AUDIT_APPROVED',
  'MD_APPROVED',
] as const

/** Statuses that count as exceptions. */
const EXCEPTION_STATUSES = ['REJECTED', 'RETURNED', 'FAILED', 'CANCELLED'] as const

/** Maps each role to the transaction statuses they are responsible for. */
const ROLE_ACTION_STATUSES: Record<string, string[]> = {
  TREASURY_OFFICER: [
    'INSTRUCTION_RECEIVED',
    'CUSTOMER_CONFIRMED',
    'INVESTMENT_VERIFIED',
    'VOUCHER_PREPARED',
    'OPERATIONS_COMPLETED',
  ],
  ACCOUNT_OFFICER: ['SIGNATURE_VERIFIED'],
  HEAD_TREASURY: ['TREASURY_APPROVED'],
  MIS: ['HEAD_TREASURY_APPROVED'],
  AUDIT: ['MIS_APPROVED'],
  MD: ['AUDIT_APPROVED'],
  OPERATIONS: ['MD_APPROVED'],
  // ADMIN sees all in-progress
  ADMIN: [...IN_PROGRESS_STATUSES],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOwnerRole(status: string): string {
  return STATUS_TO_OWNER[status] ?? 'Unknown'
}

function formatAmount(amount: number | null | undefined): string {
  if (amount == null) return '—'
  const millions = amount / 1_000_000
  if (millions >= 1) return `₦${millions.toFixed(1)}m`
  const thousands = amount / 1_000
  if (thousands >= 1) return `₦${thousands.toFixed(0)}k`
  return `₦${amount.toLocaleString()}`
}

function getStatusColor(status: string): string {
  if (status === 'COMPLETED') return 'green'
  if (EXCEPTION_STATUSES.includes(status as (typeof EXCEPTION_STATUSES)[number])) return 'red'
  if (IN_PROGRESS_STATUSES.includes(status as (typeof IN_PROGRESS_STATUSES)[number])) return 'blue'
  return 'amber'
}

function formatTransactionType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchDashboardData(
  role: string,
): Promise<{ metrics: DashboardMetrics; recentTransactions: RecentTransaction[] }> {
  const supabase = await createClient()

  // Compute start of current calendar week (Sunday)
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())

  // Determine which statuses are "pending my action" for this role
  const pendingStatuses = ROLE_ACTION_STATUSES[role] ?? []

  // Run all count queries in parallel
  const [
    pendingResult,
    inProgressResult,
    completedResult,
    exceptionsResult,
    slaBreachResult,
    recentResult,
  ] = await Promise.all([
    // 1. Pending my action
    pendingStatuses.length > 0
      ? supabase
          .from('treasury_transactions')
          .select('*', { count: 'exact', head: true })
          .in('status', pendingStatuses)
      : Promise.resolve({ count: 0, error: null }),

    // 2. In progress
    supabase
      .from('treasury_transactions')
      .select('*', { count: 'exact', head: true })
      .in('status', IN_PROGRESS_STATUSES),

    // 3. Completed this week — fetch rows to sum approved_amount
    supabase
      .from('treasury_transactions')
      .select('approved_amount')
      .eq('status', 'COMPLETED')
      .gte('completed_at', weekStart.toISOString()),

    // 4. Exceptions count
    supabase
      .from('treasury_transactions')
      .select('*', { count: 'exact', head: true })
      .in('status', EXCEPTION_STATUSES),

    // 5. SLA breach count within exceptions
    supabase
      .from('treasury_transactions')
      .select('*', { count: 'exact', head: true })
      .in('status', EXCEPTION_STATUSES)
      .lt('sla_due_at', new Date().toISOString()),

    // 6. Most recent 10 transactions with customer name
    supabase
      .from('treasury_transactions')
      .select(
        `
        id,
        transaction_reference,
        transaction_type,
        requested_amount,
        status,
        created_at,
        customers!inner (
          name
        )
      `,
      )
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Compute completed-this-week totals
  const completedRows = completedResult.data ?? []
  const completedThisWeekCount = completedRows.length
  const completedThisWeekAmount = completedRows.reduce(
    (sum, row) => sum + (Number(row.approved_amount) || 0),
    0,
  )

  const metrics: DashboardMetrics = {
    pendingMyAction: pendingResult.count ?? 0,
    inProgress: inProgressResult.count ?? 0,
    completedThisWeekCount,
    completedThisWeekAmount,
    exceptions: exceptionsResult.count ?? 0,
    slaBreachCount: slaBreachResult.count ?? 0,
  }

  // Supabase returns the inner join as an array; we take the first element
  const recentTransactions: RecentTransaction[] = (recentResult.data ?? []).map((row) => ({
    id: row.id as string,
    transaction_reference: row.transaction_reference as string,
    transaction_type: row.transaction_type as string,
    requested_amount: Number(row.requested_amount),
    status: row.status as string,
    created_at: row.created_at as string,
    customers: Array.isArray(row.customers)
      ? (row.customers[0] as { name: string }) ?? null
      : (row.customers as { name: string } | null),
  }))

  return { metrics, recentTransactions }
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // Resolve user and role server-side
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // Fetch all dashboard data
  let metrics: DashboardMetrics = {
    pendingMyAction: 0,
    inProgress: 0,
    completedThisWeekCount: 0,
    completedThisWeekAmount: 0,
    exceptions: 0,
    slaBreachCount: 0,
  }
  let recentTransactions: RecentTransaction[] = []

  try {
    const data = await fetchDashboardData(role)
    metrics = data.metrics
    recentTransactions = data.recentTransactions
  } catch {
    // If queries fail, render with zero counts and empty table
  }

  // Build metric cards
  const metricCards = [
    {
      label: 'Pending my action',
      value: String(metrics.pendingMyAction).padStart(2, '0'),
      sub: 'Needs attention',
      color: 'amber',
    },
    {
      label: 'In progress',
      value: String(metrics.inProgress).padStart(2, '0'),
      sub: 'Across all stages',
      color: 'blue',
    },
    {
      label: 'Completed this week',
      value:
        metrics.completedThisWeekAmount > 0
          ? formatAmount(metrics.completedThisWeekAmount)
          : '₦0',
      sub: `${metrics.completedThisWeekCount} instruction${metrics.completedThisWeekCount !== 1 ? 's' : ''}`,
      color: 'green',
    },
    {
      label: 'Exceptions',
      value: String(metrics.exceptions).padStart(2, '0'),
      sub:
        metrics.slaBreachCount > 0
          ? `${metrics.slaBreachCount} SLA breach${metrics.slaBreachCount !== 1 ? 'es' : ''}`
          : 'Requires review',
      color: 'red',
    },
  ]

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      {/* Live status refresh — re-renders this server component on any transaction change */}
      <RealtimeSubscriber />

      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Operations overview</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">Your workspace</h2>
          <p className="mt-2 text-muted-foreground">Keep every instruction moving with confidence.</p>
        </div>
        <Link
          href="/transactions/new"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform duration-150 hover:bg-primary/90 active:scale-[.97]"
        >
          <Plus className="size-4" />
          New instruction
        </Link>
      </div>

      {/* Metric cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(({ label, value, sub, color }) => (
          <div key={label} className="rounded-xl border border-border bg-background p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{label}</p>
              <span
                className={`size-2 rounded-full ${
                  color === 'green'
                    ? 'bg-emerald-500'
                    : color === 'blue'
                      ? 'bg-blue-500'
                      : color === 'red'
                        ? 'bg-red-500'
                        : 'bg-amber-500'
                }`}
              />
            </div>
            <p className="mt-5 text-3xl font-semibold tracking-tight">{value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {/* Recent instructions table */}
      <section className="mt-8 rounded-xl border border-border bg-background">
        <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Recent instructions</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The latest activity across your workflow.
            </p>
          </div>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
            <Link
              href="/transactions/new"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Plus className="size-4" />
              Create the first instruction
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Reference</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((tx) => {
                  const color = getStatusColor(tx.status)
                  const owner = getOwnerRole(tx.status)
                  const customerName = tx.customers?.name ?? '—'

                  return (
                    <tr
                      key={tx.id}
                      className="border-t border-border transition-colors hover:bg-muted/40"
                    >
                      <td className="px-5 py-4 font-mono text-xs font-medium text-primary">
                        {tx.transaction_reference}
                      </td>
                      <td className="px-5 py-4 font-medium">{customerName}</td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {formatTransactionType(tx.transaction_type)}
                      </td>
                      <td className="px-5 py-4 font-medium">
                        {formatAmount(tx.requested_amount)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            color === 'green'
                              ? 'bg-emerald-50 text-emerald-700'
                              : color === 'blue'
                                ? 'bg-blue-50 text-blue-700'
                                : color === 'red'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {tx.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{owner}</td>
                      <td className="px-5 py-4">
                        <Link href={`/transactions/${tx.id}`}>
                          <ArrowUpRight className="size-4 text-muted-foreground" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
