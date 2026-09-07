import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, FileCheck2, SlidersHorizontal } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { listVouchers, type VoucherListItem } from '@/lib/services/voucher.service'
import VoucherFiltersBar from './_components/VoucherFiltersBar'
import PaginationBar from '../transactions/_components/PaginationBar'

// ─── Constants ────────────────────────────────────────────────────────────────

const VOUCHER_TYPES = [
  { value: 'FUNDS_IN',      label: 'Funds In' },
  { value: 'FUNDS_OUT',     label: 'Funds Out' },
  { value: 'ROLLOVER_SLIP', label: 'Rollover Slip' },
  { value: 'TRANSFER_SLIP', label: 'Transfer Slip' },
] as const

const VOUCHER_STATUSES = [
  { value: 'DRAFT',     label: 'Draft' },
  { value: 'FINALISED', label: 'Finalised' },
] as const

const PAGE_SIZES = [10, 25, 50] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(raw: string | number | null | undefined): string {
  if (raw == null) return '—'
  const n = Number(raw)
  if (isNaN(n)) return '—'
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatVoucherType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

function formatTransactionType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

type StatusColor = 'green' | 'amber'

function voucherStatusColor(status: string): StatusColor {
  return status === 'FINALISED' ? 'green' : 'amber'
}

const STATUS_COLOR_CLASSES: Record<StatusColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
}

function StatusBadge({ status }: { status: string }) {
  const color = voucherStatusColor(status)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_COLOR_CLASSES[color]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{
    voucherType?: string
    status?: string
    from?: string
    to?: string
    page?: string
    pageSize?: string
  }>
}

/**
 * Vouchers list page — server component.
 * Queries vouchers JOIN treasury_transactions JOIN customers with filters.
 * Each row links to the transaction workspace.
 *
 * Requirements: 6.6
 */
export default async function VouchersPage({ searchParams }: PageProps) {
  // ── Auth (Req 4.1) ────────────────────────────────────────────────────────
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // ── Parse search params ───────────────────────────────────────────────────
  const params = await searchParams

  const rawPage     = parseInt(params.page     ?? '1',  10)
  const rawPageSize = parseInt(params.pageSize ?? '25', 10)
  const page        = isNaN(rawPage)     || rawPage < 1                       ? 1  : rawPage
  const pageSize    = (PAGE_SIZES as readonly number[]).includes(rawPageSize)
    ? (rawPageSize as 10 | 25 | 50)
    : 25

  const filters = {
    voucherType: params.voucherType || undefined,
    status:      params.status      || undefined,
    from:        params.from        || undefined,
    to:          params.to          || undefined,
    page,
    pageSize,
  }

  // ── Data fetch ────────────────────────────────────────────────────────────
  let vouchers: VoucherListItem[] = []
  let totalCount = 0

  try {
    const result = await listVouchers(filters)
    vouchers   = result.data
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
        <p className="text-sm font-medium text-primary">Settlement documents</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">Vouchers</h2>
        <p className="mt-2 text-muted-foreground">
          {totalCount > 0
            ? `${totalCount.toLocaleString()} voucher${totalCount !== 1 ? 's' : ''} generated across all transactions`
            : 'Generate and track approved payment vouchers.'}
        </p>
      </div>

      {/* Filter bar */}
      <div className="mt-6 rounded-xl border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
        </div>
        <VoucherFiltersBar
          voucherTypes={VOUCHER_TYPES}
          voucherStatuses={VOUCHER_STATUSES}
          currentFilters={{
            voucherType: params.voucherType ?? '',
            status:      params.status      ?? '',
            from:        params.from        ?? '',
            to:          params.to          ?? '',
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
              : 'No vouchers yet.'}
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
        {vouchers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileCheck2 className="mb-3 size-10 text-muted-foreground/40" aria-hidden />
            {hasFilters ? (
              <>
                <p className="text-sm font-medium">No vouchers match these filters.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try adjusting or clearing the filters above.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No vouchers have been generated yet.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Voucher No.</th>
                  <th className="px-5 py-3 font-medium">Transaction</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Net Amount</th>
                  <th className="px-5 py-3 font-medium">Transfer Date</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-border transition-colors duration-150 hover:bg-muted/40"
                  >
                    {/* Voucher number */}
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-primary">
                        <FileCheck2 className="size-3.5 shrink-0" aria-hidden="true" />
                        {v.voucher_number}
                      </span>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatVoucherType(v.voucher_type)}
                      </p>
                    </td>

                    {/* Transaction reference */}
                    <td className="px-5 py-4">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {v.transaction_reference}
                      </span>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatTransactionType(v.transaction_type)}
                      </p>
                    </td>

                    {/* Customer */}
                    <td className="px-5 py-4">
                      {v.customer_name ? (
                        <div>
                          <p className="font-medium">{v.customer_name}</p>
                          {v.customer_number && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {v.customer_number}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Voucher type badge */}
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                        {formatVoucherType(v.voucher_type)}
                      </span>
                    </td>

                    {/* Net amount */}
                    <td className="px-5 py-4 tabular-nums">
                      <span className="font-medium">{formatAmount(v.net_amount)}</span>
                    </td>

                    {/* Transfer date */}
                    <td className="px-5 py-4 text-muted-foreground">
                      {formatDate(v.transfer_date)}
                    </td>

                    {/* Created at */}
                    <td className="px-5 py-4 text-muted-foreground">
                      {formatDate(v.created_at)}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">
                      <StatusBadge status={v.status} />
                    </td>

                    {/* Link to transaction workspace */}
                    <td className="px-5 py-4">
                      <Link
                        href={`/transactions/${v.transaction_id}`}
                        aria-label={`Open transaction workspace for voucher ${v.voucher_number}`}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[.97]"
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
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
