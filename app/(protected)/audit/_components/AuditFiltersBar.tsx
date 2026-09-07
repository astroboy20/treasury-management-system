'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search, X } from 'lucide-react'

interface AuditFiltersBarProps {
  eventTypes: readonly string[]
  currentFilters: {
    reference: string
    eventType: string
    actor: string
    from: string
    to: string
  }
}

export default function AuditFiltersBar({ eventTypes, currentFilters }: AuditFiltersBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  /**
   * Applies a single filter change, resets page to 1.
   */
  const applyFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
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
    currentFilters.reference ||
    currentFilters.eventType ||
    currentFilters.actor ||
    currentFilters.from ||
    currentFilters.to

  return (
    <div
      aria-label="Audit event filters"
      className={`transition-opacity duration-150 ${pending ? 'opacity-60' : 'opacity-100'}`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Transaction reference free-text */}
        <div className="relative xl:col-span-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by transaction reference…"
            defaultValue={currentFilters.reference}
            onChange={(e) => applyFilter('reference', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Search by transaction reference"
          />
        </div>

        {/* Actor name free-text */}
        <div className="relative xl:col-span-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search by actor name…"
            defaultValue={currentFilters.actor}
            onChange={(e) => applyFilter('actor', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Search by actor name"
          />
        </div>

        {/* Event type dropdown */}
        <div>
          <select
            value={currentFilters.eventType}
            onChange={(e) => applyFilter('eventType', e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Filter by event type"
          >
            <option value="">All event types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <div className="flex-1">
            <label className="sr-only" htmlFor="audit-filter-from">
              From date
            </label>
            <input
              id="audit-filter-from"
              type="date"
              value={currentFilters.from}
              onChange={(e) => applyFilter('from', e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              aria-label="Filter from date"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">
            to
          </span>
          <div className="flex-1">
            <label className="sr-only" htmlFor="audit-filter-to">
              To date
            </label>
            <input
              id="audit-filter-to"
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

      {/* Clear filters — only when active */}
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
