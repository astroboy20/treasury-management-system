import { Clock } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SlaState = 'ok' | 'warning' | 'breached' | 'na'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED'])

// ─── Helpers (computed server-side — no Date.now() in render) ─────────────────

/**
 * Computes the SLA state from the deadline and current time.
 * Accepts `now` as a parameter so the computation can be done
 * server-side and passed to the client component as a prop.
 *
 * States:
 *   na       — no deadline set, or transaction is terminal
 *   ok       — more than 2 hours remaining
 *   warning  — ≤ 2 hours remaining but not yet breached
 *   breached — past the deadline
 */
export function computeSlaState(
  sla_due_at: string | null,
  status: string,
  now: number,
): SlaState {
  if (!sla_due_at || TERMINAL_STATUSES.has(status)) return 'na'
  const diff = new Date(sla_due_at).getTime() - now
  if (diff < 0) return 'breached'
  if (diff < 2 * 60 * 60 * 1_000) return 'warning'
  return 'ok'
}

/**
 * Formats a human-readable remaining/overdue string.
 * Accepts `now` as a parameter for server-side computation.
 */
export function formatSlaLabel(sla_due_at: string, now: number): string {
  const diff = new Date(sla_due_at).getTime() - now
  if (diff <= 0) {
    const abs = Math.abs(diff)
    const hours = Math.floor(abs / (60 * 60 * 1_000))
    if (hours > 0) {
      const mins = Math.floor((abs % (60 * 60 * 1_000)) / 60_000)
      return `${hours}h ${mins}m overdue`
    }
    const mins = Math.floor(abs / 60_000)
    return `${mins}m overdue`
  }
  const hours = Math.floor(diff / (60 * 60 * 1_000))
  if (hours > 0) {
    const mins = Math.floor((diff % (60 * 60 * 1_000)) / 60_000)
    return `${hours}h ${mins}m remaining`
  }
  const mins = Math.floor(diff / 60_000)
  return `${mins}m remaining`
}

// ─── State config ─────────────────────────────────────────────────────────────

const STATE_CONFIG = {
  ok: {
    dot:   'bg-emerald-500',
    text:  'text-emerald-700 dark:text-emerald-400',
    label: 'On track',
  },
  warning: {
    dot:   'bg-amber-500',
    text:  'text-amber-700 dark:text-amber-400',
    label: 'Due soon',
  },
  breached: {
    dot:   'bg-red-500',
    text:  'text-red-700 dark:text-red-400',
    label: 'Overdue',
  },
} as const

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SlaIndicatorProps {
  /** ISO timestamp string for the SLA deadline. */
  sla_due_at: string | null
  /** Current transaction status — terminal statuses render as N/A. */
  status: string
  /**
   * Epoch milliseconds representing "now".
   * Must be computed server-side (`Date.now()`) and passed as a prop
   * so the indicator renders with accurate, hydration-safe values.
   */
  now: number
  /** When true, also renders the due date/time below the state label. */
  showDueDate?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SlaIndicator — displays the SLA health of a transaction.
 *
 * Design:
 *   - Green  (ok):      > 2 hours remaining
 *   - Amber  (warning): ≤ 2 hours remaining
 *   - Red    (breached): past SLA deadline
 *   - Muted dash: no SLA set or transaction is terminal
 *
 * The `now` prop must be supplied by a server component calling `Date.now()`.
 * This avoids client/server hydration mismatches for time-sensitive values.
 *
 * Accessibility: colour is never the sole differentiator — the state label
 * text provides the same information in words.
 */
export function SlaIndicator({
  sla_due_at,
  status,
  now,
  showDueDate = true,
}: SlaIndicatorProps) {
  const state = computeSlaState(sla_due_at, status, now)

  // Terminal or no deadline — render a neutral dash
  if (state === 'na') {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        aria-label="SLA: not applicable"
      >
        <Clock className="size-4 shrink-0" aria-hidden />
        <span aria-hidden>—</span>
        <span className="sr-only">No SLA deadline</span>
      </div>
    )
  }

  const cfg   = STATE_CONFIG[state]
  const label = formatSlaLabel(sla_due_at!, now)
  const due   = new Date(sla_due_at!).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-1" role="status" aria-label={`SLA status: ${cfg.label} — ${label}`}>
      <div className="flex items-center gap-2">
        <Clock
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="flex items-center gap-1.5">
          <span
            className={`size-2 rounded-full ${cfg.dot}`}
            aria-hidden
          />
          <span className={`text-sm font-medium ${cfg.text}`}>
            {cfg.label}
          </span>
          <span className="text-xs text-muted-foreground">
            — {label}
          </span>
        </div>
      </div>

      {showDueDate && (
        <p className="pl-6 text-xs text-muted-foreground">
          Due {due}
        </p>
      )}
    </div>
  )
}

export default SlaIndicator
