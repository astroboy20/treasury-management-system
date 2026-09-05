'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface PaginationBarProps {
  page:          number
  pageSize:      number
  totalPages:    number
  totalCount:    number
  pageSizes:     readonly number[]
  /** Current raw search params (so we can preserve filters when paginating). */
  currentParams: Record<string, string | undefined>
  /** 'compact' = page-size selector only; 'full' = prev/next + page-size. */
  variant:       'compact' | 'full'
}

export default function PaginationBar({
  page,
  pageSize,
  totalPages,
  totalCount,
  pageSizes,
  currentParams,
  variant,
}: PaginationBarProps) {
  const router   = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const merged = { ...currentParams, ...overrides }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v)
    }
    return `${pathname}?${params.toString()}`
  }

  function navigate(overrides: Record<string, string | undefined>) {
    startTransition(() => {
      router.push(buildUrl(overrides))
    })
  }

  const canPrev = page > 1
  const canNext = page < totalPages

  const btnBase =
    'inline-flex items-center justify-center size-8 rounded-md text-sm text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40'

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Rows per page</span>
        <select
          value={pageSize}
          disabled={pending}
          onChange={(e) => navigate({ pageSize: e.target.value, page: '1' })}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40"
          aria-label="Rows per page"
        >
          {pageSizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // 'full' variant — prev/next navigation + page info + page size
  const pageWindow = buildPageWindow(page, totalPages)

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {/* Left: result summary */}
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages} &mdash; {totalCount.toLocaleString()} total
      </p>

      {/* Right: controls */}
      <div className="flex items-center gap-1.5">
        {/* First page */}
        <button
          onClick={() => navigate({ page: '1' })}
          disabled={!canPrev || pending}
          className={btnBase}
          aria-label="First page"
        >
          <ChevronsLeft className="size-4" />
        </button>

        {/* Previous page */}
        <button
          onClick={() => navigate({ page: String(page - 1) })}
          disabled={!canPrev || pending}
          className={btnBase}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>

        {/* Page number buttons */}
        {pageWindow.map((p, i) =>
          p === '...' ? (
            <span
              key={`ellipsis-${i}`}
              className="inline-flex size-8 items-center justify-center text-xs text-muted-foreground"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => navigate({ page: String(p) })}
              disabled={p === page || pending}
              aria-current={p === page ? 'page' : undefined}
              className={`${btnBase} ${
                p === page
                  ? 'bg-primary text-primary-foreground ring-primary hover:bg-primary'
                  : ''
              }`}
            >
              {p}
            </button>
          ),
        )}

        {/* Next page */}
        <button
          onClick={() => navigate({ page: String(page + 1) })}
          disabled={!canNext || pending}
          className={btnBase}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>

        {/* Last page */}
        <button
          onClick={() => navigate({ page: String(totalPages) })}
          disabled={!canNext || pending}
          className={btnBase}
          aria-label="Last page"
        >
          <ChevronsRight className="size-4" />
        </button>

        {/* Page size */}
        <div className="ml-2 flex items-center gap-1.5 border-l border-border pl-2">
          <span className="text-xs text-muted-foreground">Per page</span>
          <select
            value={pageSize}
            disabled={pending}
            onChange={(e) => navigate({ pageSize: e.target.value, page: '1' })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/40"
            aria-label="Rows per page"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Builds a compact page-number window with ellipsis.
 * e.g. for page 5 of 20: [1, '...', 4, 5, 6, '...', 20]
 */
function buildPageWindow(
  current: number,
  total: number,
): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages: (number | '...')[] = []

  const addPage = (p: number) => {
    if (pages.at(-1) !== p) pages.push(p)
  }
  const addEllipsis = () => {
    if (pages.at(-1) !== '...') pages.push('...')
  }

  addPage(1)

  const rangeStart = Math.max(2, current - 1)
  const rangeEnd   = Math.min(total - 1, current + 1)

  if (rangeStart > 2) addEllipsis()
  for (let p = rangeStart; p <= rangeEnd; p++) addPage(p)
  if (rangeEnd < total - 1) addEllipsis()

  addPage(total)

  return pages
}
