import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, ClipboardList } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { createClient } from '@/lib/supabase/server'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { SlaIndicator } from '@/components/treasury/SlaIndicator'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperationsQueueItem {
  id: string
  transaction_reference: string
  transaction_type: string
  status: string
  requested_amount: string
  approved_amount: string | null
  sla_due_at: string | null
  customers: { id: string; name: string; customer_number: string } | null
  md_approved_at: string | null
}

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

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Operations queue page — shows all MD_APPROVED transactions ordered by SLA.
 *
 * Requirements: 14.1, 14.2
 * - Visible only to OPERATIONS role (server-side enforced, redirects to /dashboard otherwise)
 * - Queries treasury_transactions WHERE status = 'MD_APPROVED' ordered by sla_due_at ASC
 * - Each row links to the transaction workspace at /transactions/[id]
 */
export default async function OperationsQueuePage() {
  // ── Auth & role check (Req 14.1, 5.1) ────────────────────────────────────
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (role !== 'OPERATIONS' && role !== 'ADMIN') {
    redirect('/dashboard')
  }

  // ── Data fetch: MD_APPROVED transactions ordered by sla_due_at ASC ────────
  const supabase = await createClient()

  // Compute "now" once, server-side, for SlaIndicator hydration safety
  const now = Date.now()

  // Fetch MD_APPROVED transactions with customer join, ordered by SLA urgency
  const { data: transactions, error } = await supabase
    .from('treasury_transactions')
    .select(
      `
      id,
      transaction_reference,
      transaction_type,
      status,
      requested_amount,
      approved_amount,
      sla_due_at,
      customers (
        id,
        name,
        customer_number
      )
    `,
    )
    .eq('status', 'MD_APPROVED')
    .order('sla_due_at', { ascending: true, nullsFirst: false })

  // Fetch MD approval timestamps for each transaction
  let mdApprovals: Record<string, string> = {}
  if (!error && transactions && transactions.length > 0) {
    const txIds = transactions.map((t) => (t as Record<string, unknown>).id as string)
    const { data: approvals } = await supabase
      .from('approvals')
      .select('transaction_id, approved_at')
      .eq('stage', 'MD')
      .in('transaction_id', txIds)

    if (approvals) {
      mdApprovals = Object.fromEntries(
        approvals.map((a) => [
          (a as Record<string, unknown>).transaction_id as string,
          (a as Record<string, unknown>).approved_at as string,
        ]),
      )
    }
  }

  const queue: OperationsQueueItem[] = (transactions ?? []).map((t) => {
    const row = t as Record<string, unknown>
    const customers = row.customers as OperationsQueueItem['customers']
    return {
      id: row.id as string,
      transaction_reference: row.transaction_reference as string,
      transaction_type: row.transaction_type as string,
      status: row.status as string,
      requested_amount: row.requested_amount as string,
      approved_amount: row.approved_amount as string | null,
      sla_due_at: row.sla_due_at as string | null,
      customers: customers ?? null,
      md_approved_at: mdApprovals[row.id as string] ?? null,
    }
  })

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Operations</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">Execution queue</h2>
          <p className="mt-2 text-muted-foreground">
            {queue.length > 0
              ? `${queue.length} transaction${queue.length !== 1 ? 's' : ''} awaiting execution, ordered by SLA urgency`
              : 'No transactions awaiting execution'}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <ClipboardList className="size-3.5" aria-hidden />
          MD Approved
        </div>
      </div>

      {/* Queue table */}
      <section className="mt-6 rounded-xl border border-border bg-background">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ClipboardList className="mb-3 size-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">Queue is empty</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No transactions have reached MD_APPROVED status yet.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Reference
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Customer
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Type
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Amount
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  MD Approved At
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  SLA
                </TableHead>
                <TableHead className="px-5 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((tx) => (
                <TableRow
                  key={tx.id}
                  className="border-t border-border transition-colors duration-150 hover:bg-muted/40"
                >
                  {/* Reference */}
                  <TableCell className="px-5 py-4">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {tx.transaction_reference}
                    </span>
                  </TableCell>

                  {/* Customer */}
                  <TableCell className="px-5 py-4">
                    {tx.customers ? (
                      <div>
                        <p className="font-medium">{tx.customers.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {tx.customers.customer_number}
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Type */}
                  <TableCell className="px-5 py-4">
                    <Badge variant="secondary">
                      {formatType(tx.transaction_type)}
                    </Badge>
                  </TableCell>

                  {/* Amount */}
                  <TableCell className="px-5 py-4 tabular-nums">
                    <span className="font-medium">
                      {formatAmount(tx.approved_amount ?? tx.requested_amount)}
                    </span>
                  </TableCell>

                  {/* MD Approved At */}
                  <TableCell className="px-5 py-4 text-sm text-muted-foreground">
                    {formatDateTime(tx.md_approved_at)}
                  </TableCell>

                  {/* SLA Indicator */}
                  <TableCell className="px-5 py-4">
                    <SlaIndicator
                      sla_due_at={tx.sla_due_at}
                      status={tx.status}
                      now={now}
                      showDueDate={false}
                    />
                  </TableCell>

                  {/* Link to workspace */}
                  <TableCell className="px-5 py-4">
                    <Link
                      href={`/transactions/${tx.id}`}
                      aria-label={`Open transaction ${tx.transaction_reference}`}
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[.97]"
                    >
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* Footer note */}
      {queue.length > 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <ClipboardList className="size-4" aria-hidden />
          Transactions are ordered by SLA deadline — most urgent first.
        </p>
      )}
    </div>
  )
}
