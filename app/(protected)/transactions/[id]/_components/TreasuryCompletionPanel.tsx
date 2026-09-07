'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Clock, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { confirmTreasuryCompletionAction } from '@/lib/actions/operations.actions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TreasuryCompletionPanelProps {
  /** The treasury transaction ID */
  transactionId: string
  /** Current workflow status */
  transactionStatus: string
  /** Whether the current user is a TREASURY_OFFICER (or ADMIN) */
  canAct: boolean
  /** ISO timestamp of when Operations marked the transaction completed, if available */
  operationsCompletedAt?: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Treasury Completion Panel — renders inside the transaction workspace when
 * the transaction has reached OPERATIONS_COMPLETED status.
 *
 * Visibility rule (enforced in the parent workspace page):
 *   status IN ('OPERATIONS_COMPLETED', 'TREASURY_CONFIRMED', 'COMPLETED')
 *   — the panel is always mounted once this threshold is crossed so that
 *   the completed confirmation remains visible as a read-only record.
 *
 * Behaviour:
 *   - When status = 'OPERATIONS_COMPLETED' AND canAct = true:
 *       Show "Confirm Completion" button that calls confirmTreasuryCompletionAction.
 *       On success: show Sonner toast and reload the workspace.
 *   - When status = 'OPERATIONS_COMPLETED' AND canAct = false:
 *       Show read-only "awaiting Treasury confirmation" notice.
 *   - When status = 'TREASURY_CONFIRMED' or 'COMPLETED':
 *       Show read-only completed confirmation badge.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4
 */
export default function TreasuryCompletionPanel({
  transactionId,
  transactionStatus,
  canAct,
  operationsCompletedAt,
}: TreasuryCompletionPanelProps) {
  const [submitting, setSubmitting] = useState(false)

  const isConfirmed =
    transactionStatus === 'TREASURY_CONFIRMED' || transactionStatus === 'COMPLETED'
  const awaitingConfirmation = transactionStatus === 'OPERATIONS_COMPLETED'

  // ── Already confirmed — read-only record ─────────────────────────────────
  if (isConfirmed) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
        <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-emerald-800">
            Treasury completion confirmed
          </p>
          <p className="text-xs text-emerald-700">
            A Treasury Officer has confirmed that this transaction was fully executed by
            Operations. The workflow is now{' '}
            <span className="font-semibold">
              {transactionStatus === 'COMPLETED' ? 'completed' : 'being finalised'}.
            </span>
          </p>
        </div>
      </div>
    )
  }

  // ── Awaiting confirmation — not the right role ────────────────────────────
  if (awaitingConfirmation && !canAct) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <Lock className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        <p className="text-sm text-muted-foreground">
          Awaiting Treasury Officer completion confirmation. Operations has finished
          executing this transaction.
        </p>
      </div>
    )
  }

  // ── Awaiting confirmation — Treasury Officer action ───────────────────────
  if (awaitingConfirmation && canAct) {
    async function handleConfirm() {
      setSubmitting(true)

      const result = await confirmTreasuryCompletionAction(transactionId)

      setSubmitting(false)

      if (result.success) {
        toast.success('Transaction marked as completed.')
        // Full reload so the server-component workspace reflects COMPLETED status.
        window.location.reload()
      } else {
        toast.error(result.error ?? 'Failed to confirm completion. Please try again.')
      }
    }

    return (
      <div className="space-y-4">
        {/* Status context */}
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <Clock className="size-4 mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Operations has completed execution
            </p>
            <p className="text-xs text-muted-foreground">
              Verify that the payment has been successfully processed before confirming
              completion. Once confirmed, the transaction status will move to{' '}
              <span className="font-medium">COMPLETED</span> and no further actions
              will be possible.
            </p>
            {operationsCompletedAt && (
              <p className="text-xs text-muted-foreground">
                Executed at:{' '}
                <span className="font-medium">
                  {formatDateTime(operationsCompletedAt)}
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Action */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            className="gap-2"
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {submitting ? 'Confirming…' : 'Confirm Completion'}
          </Button>
          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
            Operations completed — awaiting Treasury sign-off
          </Badge>
        </div>
      </div>
    )
  }

  // Should not reach here in practice, but render nothing for unhandled statuses
  return null
}
