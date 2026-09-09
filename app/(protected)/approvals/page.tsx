import Link from 'next/link'
import { Clock3, ArrowUpRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { redirect } from 'next/navigation'
import { STAGE_TO_ROLE, STAGE_REQUIRED_STATUS, ROLE_LABELS } from '@/lib/permissions/permissions'
import { Badge } from '@/components/ui/badge'
import ApprovalActions from './_components/ApprovalActions'
import type { ApprovalStage } from '@/lib/schemas/approval.schema'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Maps a role code to its approval stage */
const ROLE_TO_STAGE: Record<string, ApprovalStage> = {
  TREASURY_OFFICER: 'TREASURY',
  HEAD_TREASURY:    'HEAD_TREASURY',
  MIS:              'MIS',
  AUDIT:            'AUDIT',
  MD:               'MD',
}

/** Maps transaction type codes to human labels */
function formatType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Currency formatter */
function formatAmount(amount: string | number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
  }).format(Number(amount))
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ApprovalsPage() {
  // 1. Authenticate + resolve role server-side
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // 2. Determine which approval stage this role acts on
  const stage = ROLE_TO_STAGE[role]

  // Non-approver roles (ACCOUNT_OFFICER, OPERATIONS, ADMIN) redirect to transactions
  if (!stage) {
    redirect('/transactions')
  }

  const requiredStatus = STAGE_REQUIRED_STATUS[stage]

  // 3. Fetch transactions pending this role's approval
  const supabase = await createClient()

  const { data: pendingTxs, error } = await supabase
    .from('treasury_transactions')
    .select(`
      id,
      transaction_reference,
      transaction_type,
      requested_amount,
      status,
      created_at,
      created_by,
      customers ( id, name, customer_number )
    `)
    .eq('status', requiredStatus)
    .order('created_at', { ascending: true })

  // 4. Fetch already-approved transactions for this role (last 10, to show history)
  const approvedStatuses: Record<ApprovalStage, string> = {
    TREASURY:      'TREASURY_APPROVED',
    HEAD_TREASURY: 'HEAD_TREASURY_APPROVED',
    MIS:           'MIS_APPROVED',
    AUDIT:         'AUDIT_APPROVED',
    MD:            'MD_APPROVED',
  }
  const approvedStatus = approvedStatuses[stage]

  const { data: recentlyApproved } = await supabase
    .from('treasury_transactions')
    .select(`
      id,
      transaction_reference,
      transaction_type,
      requested_amount,
      status,
      customers ( id, name, customer_number )
    `)
    .eq('status', approvedStatus)
    .order('updated_at', { ascending: false })
    .limit(5)

  const pending = (pendingTxs ?? []) as unknown as Array<{
    id: string
    transaction_reference: string
    transaction_type: string
    requested_amount: string
    status: string
    created_at: string
    created_by: string
    customers: { id: string; name: string; customer_number: string } | null
  }>

  const recent = (recentlyApproved ?? []) as unknown as typeof pending

  const pendingCount = pending.length

  return (
    <main className="min-h-screen bg-muted/30 p-5 sm:p-10">
      <div className="mx-auto max-w-5xl">

        {/* ── Header ── */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Control centre</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Approvals</h1>
            <p className="mt-2 text-muted-foreground">
              Review decisions waiting for your role —{' '}
              <span className="font-medium text-foreground">{ROLE_LABELS[role] ?? role}</span>.
            </p>
          </div>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
              {pendingCount} pending
            </span>
          )}
        </div>

        {/* ── Pending approvals ── */}
        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-background">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1.4fr_1fr_1fr_auto] gap-4 border-b border-border bg-muted/50 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Reference</span>
            <span>Customer</span>
            <span>Instruction</span>
            <span>Amount</span>
            <span>Decision</span>
          </div>

          {pending.length === 0 && recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Clock3 className="size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No transactions pending your approval</p>
              <p className="text-xs text-muted-foreground">
                Transactions will appear here once they reach the{' '}
                <span className="font-mono">{stage}</span> approval stage.
              </p>
            </div>
          ) : (
            <>
              {/* Pending rows */}
              {pending.map((tx) => (
                <div
                  key={tx.id}
                  className="grid grid-cols-[1fr_1.4fr_1fr_1fr_auto] items-center gap-4 border-b border-border px-5 py-4 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/transactions/${tx.id}`}
                      className="font-mono text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {tx.transaction_reference}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ROLE_LABELS[role] ?? role}
                    </p>
                  </div>
                  <span className="truncate font-medium">
                    {tx.customers?.name ?? '—'}
                  </span>
                  <span className="text-muted-foreground">{formatType(tx.transaction_type)}</span>
                  <span className="font-medium tabular-nums">
                    {formatAmount(tx.requested_amount)}
                  </span>
                  <ApprovalActions transactionId={tx.id} stage={stage} />
                </div>
              ))}

              {/* Recently approved rows (read-only history) */}
              {recent.map((tx) => (
                <div
                  key={tx.id}
                  className="grid grid-cols-[1fr_1.4fr_1fr_1fr_auto] items-center gap-4 border-b border-border px-5 py-4 text-sm opacity-60 last:border-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/transactions/${tx.id}`}
                      className="font-mono text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {tx.transaction_reference}
                    </Link>
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      Approved
                    </Badge>
                  </div>
                  <span className="truncate font-medium">
                    {tx.customers?.name ?? '—'}
                  </span>
                  <span className="text-muted-foreground">{formatType(tx.transaction_type)}</span>
                  <span className="font-medium tabular-nums">
                    {formatAmount(tx.requested_amount)}
                  </span>
                  <Link
                    href={`/transactions/${tx.id}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    aria-label="View transaction"
                  >
                    View <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              ))}
            </>
          )}
        </div>

        {/* ── Footer note ── */}
        <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="size-4" />
          Approval actions are recorded in the immutable audit trail.
        </div>
      </div>
    </main>
  )
}
