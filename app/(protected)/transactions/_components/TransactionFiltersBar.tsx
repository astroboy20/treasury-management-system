'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search, X } from 'lucide-react'

interface FilterOption {
  value: string
  label: string
}

interface TransactionFiltersBarProps {
  types:    readonly FilterOption[]
  statuses: readonly FilterOption[]
  currentFilters: {
    type:   string
    status: string
    from:   string
    to:     string
    search: string
  }
}

export default function TransactionFiltersBar({
  types,
  statuses,
  currentFilters,
}: TransactionFiltersBarProps) {
  const router        = useRouter()
  const pathname      = usePathname()
  const searchParams  = useSearchParams()
  const [pending, startTransition] = useTransition()

  /**
   * Builds a new URLSearchParams object from the current params,
   * applies the change, resets to page 1, and navigates.
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

  /** Clears all filter params and resets to the base list. */
  const clearAll = useCallback(() => {
    // Preserve only pageSize if set
    const params = new URLSearchParams()
    const ps = searchParams.get('pageSize')
    if (ps) params.set('pageSize', ps)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }, [router, pathname, searchParams])

  const hasActiveFilters =
    currentFilters.type   ||
    currentFilters.status ||
    currentFilters.from   ||
    currentFilters.to     ||
    currentFilters.search

  return (
    <div
      aria-label="Transaction filters"
      className={`transition-opacity duration-150 ${pending ? 'opacity-60' : 'opacity-100'}`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {/* Free-text search — reference or customer name */}
        <div className="relative xl:col-span-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by reference or customer…"
            defaultValue={currentFilters.search}
            onChange={(e) => applyFilter('customer', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Search transactions by reference or customer name"
          />
        </div>

        {/* Transaction type dropdown */}
        <div>
          <select
            value={currentFilters.type}
            onChange={(e) => applyFilter('type', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Filter by transaction type"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Status dropdown */}
        <div>
          <select
            value={currentFilters.status}
            onChange={(e) => applyFilter('status', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Date range — from */}
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1 xl:col-span-1">
          <div className="flex-1">
            <label className="sr-only" htmlFor="filter-from">From date</label>
            <input
              id="filter-from"
              type="date"
              value={currentFilters.from}
              onChange={(e) => applyFilter('from', e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Filter from date"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">to</span>
          <div className="flex-1">
            <label className="sr-only" htmlFor="filter-to">To date</label>
            <input
              id="filter-to"
              type="date"
              value={currentFilters.to}
              onChange={(e) => applyFilter('to', e.target.value)}
              min={currentFilters.from || undefined}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Filter to date"
            />
          </div>
        </div>
      </div>

      {/* Clear filters button — only visible when filters are active */}
      {hasActiveFilters && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={clearAll}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground active:scale-[.97] disabled:opacity-50"
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
