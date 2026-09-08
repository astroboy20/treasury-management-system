'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { X } from 'lucide-react'

interface FilterOption {
  value: string
  label: string
}

interface VoucherFiltersBarProps {
  voucherTypes:   readonly FilterOption[]
  voucherStatuses: readonly FilterOption[]
  currentFilters: {
    voucherType: string
    status:      string
    from:        string
    to:          string
  }
}

export default function VoucherFiltersBar({
  voucherTypes,
  voucherStatuses,
  currentFilters,
}: VoucherFiltersBarProps) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  /**
   * Applies a single filter change and resets to page 1.
   */
  const applyFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      // Reset to first page whenever a filter changes
      params.delete('page')
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    },
    [router, pathname, searchParams],
  )

  /** Clears all filter params, preserves pageSize. */
  const clearAll = useCallback(() => {
    const params = new URLSearchParams()
    const ps = searchParams.get('pageSize')
    if (ps) params.set('pageSize', ps)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }, [router, pathname, searchParams])

  const hasActiveFilters =
    currentFilters.voucherType ||
    currentFilters.status      ||
    currentFilters.from        ||
    currentFilters.to

  return (
    <div
      aria-label="Voucher filters"
      className={`transition-opacity duration-150 ${pending ? 'opacity-60' : 'opacity-100'}`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Voucher type dropdown */}
        <div>
          <label className="sr-only" htmlFor="voucher-filter-type">
            Voucher type
          </label>
          <select
            id="voucher-filter-type"
            value={currentFilters.voucherType}
            onChange={(e) => applyFilter('voucherType', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Filter by voucher type"
          >
            <option value="">All voucher types</option>
            {voucherTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Status dropdown */}
        <div>
          <label className="sr-only" htmlFor="voucher-filter-status">
            Status
          </label>
          <select
            id="voucher-filter-status"
            value={currentFilters.status}
            onChange={(e) => applyFilter('status', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Filter by voucher status"
          >
            <option value="">All statuses</option>
            {voucherStatuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 sm:col-span-2">
          <div className="flex-1">
            <label className="sr-only" htmlFor="voucher-filter-from">
              From date
            </label>
            <input
              id="voucher-filter-from"
              type="date"
              value={currentFilters.from}
              onChange={(e) => applyFilter('from', e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Filter vouchers from date"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">
            to
          </span>
          <div className="flex-1">
            <label className="sr-only" htmlFor="voucher-filter-to">
              To date
            </label>
            <input
              id="voucher-filter-to"
              type="date"
              value={currentFilters.to}
              onChange={(e) => applyFilter('to', e.target.value)}
              min={currentFilters.from || undefined}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Filter vouchers to date"
            />
          </div>
        </div>
      </div>

      {/* Clear filters — only visible when filters are active */}
      {hasActiveFilters && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={clearAll}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground motion-safe:active:scale-[.97] disabled:opacity-50"
          >
            <X className="size-3" />
            Clear filters
          </button>
          {pending && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Updating results…
            </span>
          )}
        </div>
      )}
    </div>
  )
}
