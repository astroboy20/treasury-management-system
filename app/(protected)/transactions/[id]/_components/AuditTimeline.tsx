'use client'

import { useEffect, useRef, useState } from 'react'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditEvent = TransactionWorkspace['auditEvents'][number]

interface AuditTimelineProps {
  events: TransactionWorkspace['auditEvents']
}

// ─── Badge variant helpers ────────────────────────────────────────────────────

type BadgeVariant = 'green' | 'blue' | 'amber' | 'red' | 'slate'

function eventBadgeVariant(eventType: string): BadgeVariant {
  if (
    eventType === 'TRANSACTION_CREATED' ||
    eventType === 'OPERATIONS_COMPLETED' ||
    eventType === 'TREASURY_CONFIRMED'
  )
    return 'green'
  if (
    eventType.includes('APPROVED') ||
    eventType.includes('VERIFIED') ||
    eventType.includes('CONFIRMED') ||
    eventType === 'OPERATIONS_STARTED' ||
    eventType === 'DOCUMENT_UPLOADED'
  )
    return 'blue'
  if (eventType.includes('RETURNED') || eventType.includes('FAILED'))
    return 'amber'
  if (eventType.includes('REJECTED') || eventType === 'UNAUTHORIZED_ATTEMPT')
    return 'red'
  return 'slate'
}

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800',
  blue:  'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:ring-blue-800',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800',
  red:   'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-800',
  slate: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
}

const DOT_CLASSES: Record<BadgeVariant, string> = {
  green: 'bg-emerald-500',
  blue:  'bg-blue-500',
  amber: 'bg-amber-500',
  red:   'bg-red-500',
  slate: 'bg-muted-foreground',
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diffMs / 1_000)
  if (secs < 60)   return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60)   return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24)  return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7)    return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatEventLabel(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

// ─── Reduced-motion hook ──────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

// ─── EventRow ─────────────────────────────────────────────────────────────────

interface EventRowProps {
  event: AuditEvent
  isLast: boolean
  /** Entry animation delay in milliseconds (30ms × index). */
  delayMs: number
  reducedMotion: boolean
}

function EventRow({ event, isLast, delayMs, reducedMotion }: EventRowProps) {
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const hasMetadata = event.metadata && Object.keys(event.metadata).length > 0
  const variant = eventBadgeVariant(event.event_type)

  // Staggered mount: each row independently transitions in after its delay
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])

  /*
   * Animation spec (task 2.9):
   *   Full motion:   translateY(6px) opacity(0) → translateY(0) opacity(1), 180ms ease-out
   *   Reduced motion: skip translateY, keep opacity fade only (less vestibular impact)
   */
  const rowStyle: React.CSSProperties = reducedMotion
    ? {
        opacity: visible ? 1 : 0,
        transition: `opacity 180ms ease-out`,
      }
    : {
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(6px)',
        transition: `opacity 180ms ease-out, transform 180ms ease-out`,
      }

  return (
    <li className="relative flex gap-4" style={rowStyle}>
      {/* Vertical timeline track line — omitted on last item */}
      {!isLast && (
        <span
          className="absolute left-[0.9375rem] top-7 bottom-0 w-px -translate-x-1/2 bg-border"
          aria-hidden
        />
      )}

      {/* Timeline dot */}
      <span
        className="relative z-10 mt-[0.1875rem] flex size-[1.875rem] shrink-0 items-center justify-center"
        aria-hidden
      >
        <span
          className={`size-2.5 rounded-full ring-2 ring-background ${DOT_CLASSES[variant]}`}
        />
      </span>

      {/* Row content */}
      <div className="mb-5 min-w-0 flex-1">
        {/* Event type badge + status transition */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium leading-none ${BADGE_CLASSES[variant]}`}
          >
            {formatEventLabel(event.event_type)}
          </span>

          {/* from → to status arrow */}
          {event.from_status && event.to_status && (
            <span
              className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground"
              aria-label={`Status changed from ${event.from_status} to ${event.to_status}`}
            >
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono leading-none">
                {event.from_status.replace(/_/g, ' ')}
              </span>
              <span aria-hidden>→</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono leading-none">
                {event.to_status.replace(/_/g, ' ')}
              </span>
            </span>
          )}
        </div>

        {/* Actor + timestamp */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {event.actor?.full_name && (
            <span className="font-medium text-foreground/90">{event.actor.full_name}</span>
          )}
          {/* Relative time shown by default; absolute on hover/focus */}
          <time
            dateTime={event.created_at}
            title={formatAbsolute(event.created_at)}
            className="tabular-nums cursor-default"
          >
            {formatRelative(event.created_at)}
          </time>
          {/* Absolute time always visible on wider screens */}
          <span className="hidden sm:inline text-muted-foreground/60 tabular-nums">
            {formatAbsolute(event.created_at)}
          </span>
        </div>

        {/* Expandable metadata section */}
        {hasMetadata && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[0.65rem] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
              aria-expanded={expanded}
              aria-controls={`audit-meta-${event.id}`}
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>

            {expanded && (
              <pre
                id={`audit-meta-${event.id}`}
                className="mt-2 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-[0.65rem] leading-5 text-muted-foreground"
              >
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// ─── AuditTimeline ────────────────────────────────────────────────────────────

/**
 * Read-only chronological audit timeline for a transaction workspace.
 *
 * Renders audit_events in ASC order (oldest first). Each row shows:
 *   - Event type pill badge (colour-coded by event category)
 *   - from → to status transition arrow
 *   - Actor name
 *   - Relative timestamp (absolute on hover/focus via <time title="...">)
 *   - Expandable metadata section (if metadata is non-empty)
 *
 * Entry animation: stagger 30ms per event.
 *   Full motion:     translateY(6px) opacity(0) → translateY(0) opacity(1), 180ms ease-out
 *   Reduced motion:  opacity(0) → opacity(1) only (no translate)
 *
 * No edit/delete controls are rendered anywhere in this component.
 *
 * Requirements: 16.4, 28.3, 28.4, 32.4, 32.5, 32.9
 */
export default function AuditTimeline({ events }: AuditTimelineProps) {
  const reducedMotion = usePrefersReducedMotion()
  const listRef = useRef<HTMLUListElement>(null)

  if (events.length === 0) {
    return (
      <section
        aria-label="Audit timeline"
        className="rounded-xl border border-border bg-background p-6 text-center"
      >
        <p className="text-sm text-muted-foreground italic">No audit events recorded yet.</p>
      </section>
    )
  }

  return (
    <section aria-label="Audit timeline" className="rounded-xl border border-border bg-background p-5 sm:p-6">
      <h2 className="mb-5 text-sm font-semibold tracking-tight">Audit Timeline</h2>

      <ul
        ref={listRef}
        aria-label="Audit events"
        className="list-none m-0 p-0"
      >
        {events.map((event, index) => (
          <EventRow
            key={event.id}
            event={event}
            isLast={index === events.length - 1}
            delayMs={index * 30}
            reducedMotion={reducedMotion}
          />
        ))}
      </ul>
    </section>
  )
}
