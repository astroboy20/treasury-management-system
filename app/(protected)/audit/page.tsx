import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Shield, SlidersHorizontal } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { listAuditEvents, type AuditEventListItem } from '@/lib/services/audit.service'
import AuditFiltersBar from './_components/AuditFiltersBar'
import PaginationBar from '../transactions/_components/PaginationBar'

// ─── Constants ────────────────────────────────────────────────────────────────

const AUDIT_EVENT_TYPES = [
  'TRANSACTION_CREATED',
  'INSTRUCTION_RECEIVED',
  'SIGNATURE_VERIFIED',
  'SIGNATURE_FAILED',
  'CUSTOMER_CONFIRMED',
  'INVESTMENT_VERIFIED',
  'VOUCHER_CREATED',
  'APPROVAL_GRANTED',
  'APPROVAL_RETURNED',
  'APPROVAL_REJECTED',
  'OPERATIONS_STARTED',
  'OPERATIONS_COMPLETED',
  'TREASURY_CONFIRMED',
  'REVERSAL_CREATED',
  'UNAUTHORIZED_ATTEMPT',
  'DOCUMENT_UPLOADED',
] as const

const PAGE_SIZES = [10, 25, 50] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a UTC ISO timestamp as "DD MMM YYYY HH:mm" in UTC.
 * e.g. 2024-03-15T09:42:00Z → "15 Mar 2024 09:42"
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const day   = String(d.getUTCDate()).padStart(2, '0')
  const year  = d.getUTCFullYear()
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
  const hh    = String(d.getUTCHours()).padStart(2, '0')
  const mm    = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year} ${hh}:${mm}`
}

type EventColor = 'green' | 'red' | 'amber' | 'blue'

function eventColor(eventType: string): EventColor {
  if (
    eventType.includes('APPROVED') ||
    eventType.includes('CREATED') ||
    eventType.includes('COMPLETED') ||
    eventType.includes('CONFIRMED') ||
    eventType.includes('VERIFIED')
  ) {
    return 'green'
  }
  if (
    eventType.includes('REJECTED') ||
    eventType.includes('FAILED') ||
    eventType.includes('CANCELLED') ||
    eventType.includes('UNAUTHORIZED')
  ) {
    return 'red'
  }
  if (eventType.includes('RETURNED')) {
    return 'amber'
  }
  return 'blue'
}

const EVENT_COLOR_CLASSES: Record<EventColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red:   'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue:  'bg-blue-50 text-blue-700 ring-blue-200',
}

function EventTypeBadge({ eventType }: { eventType: string }) {
  const color = eventColor(eventType)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${EVENT_COLOR_CLASSES[color]}`}
    >
      {eventType.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{
    reference?: string
    eventType?: string
    actor?: string
    from?: string
    to?: string
    page?: string
    pageSize?: string
  }>
}

export default async function AuditPage({ searchParams }: PageProps) {
  // Resolve authenticated user server-side
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // Role gate — visible to AUDIT and ADMIN only
  if (role !== 'AUDIT' && role !== 'ADMIN') {
    redirect('/dashboard')
  }

  // Await search params (Next.js 15+ requires this)
  const params = await searchParams

  // Parse + validate pagination
  const rawPage     = parseInt(params.page     ?? '1',  10)
  const rawPageSize = parseInt(params.pageSize ?? '25', 10)
  const page        = isNaN(rawPage)     || rawPage < 1                       ? 1  : rawPage
  const pageSize    = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? (rawPageSize as 10 | 25 | 50)
    : 25

  // Build filters from URL params
  const filters = {
    reference: params.reference || undefined,
    eventType: params.eventType || undefined,
    actor:     params.actor     || undefined,
    from:      params.from      || undefined,
    to:        params.to        || undefined,
  }

  // Fetch paginated, filtered results server-side
  let events: AuditEventListItem[] = []
  let totalCount = 0

  try {
    const result = await listAuditEvents(filters, { page, pageSize })
    events     = result.data
    totalCount = result.count
  } catch {
    // Render empty state on error
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const hasFilters = Object.values(filters).some(Boolean)
  const startRow   = (page - 1) * pageSize + 1
  const endRow     = Math.min(page * pageSize, totalCount)

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      {/* Page header */}
      <div>
        <p className="text-sm font-medium text-primary">Evidence and accountability</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">Audit trail</h2>
        <p className="mt-2 text-muted-foreground">
          A chronological, tamper-proof record of every workflow event.
        </p>
      </div>

      {/* Protected record notice */}
      <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-background p-4">
        <Shield className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm">
          <strong>Protected record.</strong>{' '}
          <span className="text-muted-foreground">
            Events cannot be edited or deleted by workspace users.
          </span>
        </p>
      </div>

      {/* Filter bar */}
      <div className="mt-4 rounded-xl border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <SlidersHorizontal className="size-4" />
          Filters
        </div>
        <AuditFiltersBar
          eventTypes={AUDIT_EVENT_TYPES}
          currentFilters={{
            reference: params.reference ?? '',
            eventType: params.eventType ?? '',
            actor:     params.actor     ?? '',
            from:      params.from      ?? '',
            to:        params.to        ?? '',
          }}
        />
      </div>

      {/* Results table */}
      <section className="mt-4 rounded-xl border border-border bg-background">
        {/* Table header row */}
        <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {hasFilters && totalCount === 0
              ? 'No results match your filters.'
              : totalCount > 0
              ? `Showing ${startRow}–${endRow} of ${totalCount.toLocaleString()} result${totalCount !== 1 ? 's' : ''}`
              : 'No audit events yet.'}
          </p>
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
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {hasFilters ? (
              <>
                <p className="text-sm font-medium">No audit events match these filters.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try adjusting or clearing the filters above.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">ID</th>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Event Type</th>
                  <th className="px-5 py-3 font-medium">Actor</th>
                  <th className="px-5 py-3 font-medium">Transaction Ref</th>
                  <th className="px-5 py-3 font-medium">From Status</th>
                  <th className="px-5 py-3 font-medium">To Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className="border-t border-border transition-colors duration-150 hover:bg-muted/40"
                  >
                    {/* ID */}
                    <td className="px-5 py-4">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{event.id}
                      </span>
                    </td>

                    {/* Timestamp */}
                    <td className="px-5 py-4 text-muted-foreground">
                      <span title={event.created_at}>{formatTimestamp(event.created_at)}</span>
                    </td>

                    {/* Event Type badge */}
                    <td className="px-5 py-4">
                      <EventTypeBadge eventType={event.event_type} />
                    </td>

                    {/* Actor */}
                    <td className="px-5 py-4 text-muted-foreground">
                      {event.actor_full_name ?? '—'}
                    </td>

                    {/* Transaction Ref */}
                    <td className="px-5 py-4">
                      {event.transaction_id && event.transaction_reference ? (
                        <Link
                          href={`/transactions/${event.transaction_id}`}
                          className="font-mono text-xs font-semibold text-primary hover:underline"
                        >
                          {event.transaction_reference}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* From Status */}
                    <td className="px-5 py-4 text-muted-foreground">
                      {event.from_status
                        ? event.from_status.replace(/_/g, ' ')
                        : '—'}
                    </td>

                    {/* To Status */}
                    <td className="px-5 py-4 text-muted-foreground">
                      {event.to_status
                        ? event.to_status.replace(/_/g, ' ')
                        : '—'}
                    </td>
                  </tr>
                ))}
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
