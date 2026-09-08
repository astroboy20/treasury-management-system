import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Shield } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { getAuditEvents } from '@/lib/services/audit.service'
import { createClient } from '@/lib/supabase/server'
import AuditTimeline from '@/app/(protected)/transactions/[id]/_components/AuditTimeline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a monetary amount as NGN with the ₦ symbol.
 * e.g. 5000000 → "₦5,000,000.00"
 */
function formatNGN(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(num)) return '₦0.00'
  return `₦${num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Map a transaction type to a human-readable label.
 */
function formatTransactionType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Map a status value to a human-readable label.
 */
function formatStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

type StatusColor = 'green' | 'amber' | 'red' | 'blue' | 'slate'

function statusColor(status: string): StatusColor {
  if (
    status === 'COMPLETED' ||
    status === 'TREASURY_CONFIRMED' ||
    status === 'OPERATIONS_COMPLETED'
  )
    return 'green'
  if (status === 'REJECTED' || status === 'CANCELLED') return 'red'
  if (
    status === 'APPROVAL_RETURNED' ||
    status === 'PENDING_APPROVAL' ||
    status === 'PENDING_REVIEW'
  )
    return 'amber'
  if (
    status === 'DRAFT' ||
    status === 'INSTRUCTION_RECEIVED' ||
    status === 'SIGNATURE_VERIFIED' ||
    status === 'CUSTOMER_CONFIRMED' ||
    status === 'INVESTMENT_VERIFIED' ||
    status === 'VOUCHER_CREATED'
  )
    return 'blue'
  return 'slate'
}

const STATUS_BADGE_CLASSES: Record<StatusColor, string> = {
  green:
    'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  amber:
    'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
  slate:
    'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
}

// ─── Transaction header data shape ────────────────────────────────────────────

interface TransactionHeader {
  id: string
  transaction_reference: string
  transaction_type: string
  status: string
  requested_amount: string
  customer_name: string | null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ transactionId: string }>
}

/**
 * Full transaction audit detail page.
 * Accessible to AUDIT, ADMIN, and MD roles only (Req 28.3).
 *
 * Displays every audit event for the transaction in chronological order
 * via the AuditTimeline component (Req 28.4).
 *
 * Requirements: 28.3, 28.4
 */
export default async function TransactionAuditPage({ params }: PageProps) {
  // Resolve dynamic route param (Next.js 15+ params is a Promise)
  const { transactionId } = await params

  // ── Auth ────────────────────────────────────────────────────────────────────
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // Role gate — AUDIT, ADMIN, and MD only (Req 28.3)
  if (role !== 'AUDIT' && role !== 'ADMIN' && role !== 'MD') {
    redirect('/dashboard')
  }

  // ── Load transaction header ─────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: txData, error: txError } = await supabase
    .from('treasury_transactions')
    .select(
      `
      id,
      transaction_reference,
      transaction_type,
      status,
      requested_amount,
      customers ( name )
    `,
    )
    .eq('id', transactionId)
    .single()

  if (txError || !txData) {
    notFound()
  }

  const tx = txData as Record<string, unknown>
  const customerJoin = tx.customers
  let customerName: string | null = null
  if (Array.isArray(customerJoin)) {
    customerName = (customerJoin[0] as { name: string } | undefined)?.name ?? null
  } else if (customerJoin && typeof customerJoin === 'object') {
    customerName = (customerJoin as { name: string }).name ?? null
  }

  const transaction: TransactionHeader = {
    id: tx.id as string,
    transaction_reference: tx.transaction_reference as string,
    transaction_type: tx.transaction_type as string,
    status: tx.status as string,
    requested_amount: tx.requested_amount as string,
    customer_name: customerName,
  }

  // ── Load audit events in chronological order ────────────────────────────────
  // Normalize `actor: null` → `actor: undefined` so the type matches AuditTimeline's props.
  const auditEvents = (await getAuditEvents(transactionId)).map((e) => ({
    ...e,
    actor: e.actor ?? undefined,
  }))

  // ── Render ──────────────────────────────────────────────────────────────────
  const typeColor = statusColor(transaction.status)

  return (
    <div className="mx-auto max-w-4xl p-5 sm:p-8">
      {/* Back link */}
      <div className="mb-6">
        <Link
          href="/audit"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to audit trail
        </Link>
      </div>

      {/* Page heading */}
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">Transaction audit detail</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {transaction.transaction_reference}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Full chronological audit record for this transaction.
        </p>
      </div>

      {/* Transaction header card */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Transaction summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-4">
            {/* Reference */}
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reference
              </dt>
              <dd className="mt-1 font-mono font-semibold">
                {transaction.transaction_reference}
              </dd>
            </div>

            {/* Customer */}
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Customer
              </dt>
              <dd className="mt-1">{transaction.customer_name ?? '—'}</dd>
            </div>

            {/* Transaction type */}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Type
              </dt>
              <dd className="mt-1">
                <Badge variant="secondary" className="text-xs">
                  {formatTransactionType(transaction.transaction_type)}
                </Badge>
              </dd>
            </div>

            {/* Current status */}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[typeColor]}`}
                >
                  {formatStatus(transaction.status)}
                </span>
              </dd>
            </div>

            {/* Requested amount */}
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Requested amount
              </dt>
              <dd className="mt-1 font-semibold tabular-nums">
                {formatNGN(transaction.requested_amount)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Protected record notice */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-background p-4">
        <Shield className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm">
          <strong>Protected record.</strong>{' '}
          <span className="text-muted-foreground">
            Audit events cannot be edited or deleted by workspace users.
          </span>
        </p>
      </div>

      {/* Audit event count */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Audit events{' '}
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground tabular-nums">
            {auditEvents.length}
          </span>
        </h2>
      </div>

      {/* Full audit timeline */}
      <AuditTimeline events={auditEvents} />
    </div>
  )
}
