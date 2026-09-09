'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { approveTransactionAction } from '@/lib/actions/approval.actions'
import type { ApprovalStage } from '@/lib/schemas/approval.schema'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface ApprovalActionsProps {
  transactionId: string
  stage: ApprovalStage
}

export default function ApprovalActions({ transactionId, stage }: ApprovalActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<'APPROVE' | 'RETURN' | 'REJECT' | null>(null)
  const [comments, setComments] = useState('')
  const [commentsError, setCommentsError] = useState('')

  function openDialog(decision: 'RETURN' | 'REJECT') {
    setPendingDecision(decision)
    setComments('')
    setCommentsError('')
    setDialogOpen(true)
  }

  async function handleApprove() {
    startTransition(async () => {
      const result = await approveTransactionAction(transactionId, stage, 'APPROVE')
      if (!result.success) {
        toast.error(result.error ?? 'Approval failed.')
        return
      }
      toast.success('Transaction approved.')
      router.refresh()
    })
  }

  async function handleDecisionWithComment() {
    if (!pendingDecision) return
    if (!comments.trim()) {
      setCommentsError('A comment is required for this decision.')
      return
    }
    setCommentsError('')
    setDialogOpen(false)

    startTransition(async () => {
      const result = await approveTransactionAction(
        transactionId,
        stage,
        pendingDecision as 'RETURN' | 'REJECT',
        comments.trim(),
      )
      if (!result.success) {
        toast.error(result.error ?? 'Action failed.')
        return
      }
      toast.success(pendingDecision === 'RETURN' ? 'Transaction returned.' : 'Transaction rejected.')
      router.refresh()
    })
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Approve */}
        <button
          onClick={handleApprove}
          disabled={isPending}
          aria-label="Approve"
          className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
        </button>

        {/* Reject */}
        <button
          onClick={() => openDialog('REJECT')}
          disabled={isPending}
          aria-label="Reject"
          className="grid size-8 place-items-center rounded-lg bg-red-50 text-red-700 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-red-600 [@media(hover:hover)_and_(pointer:fine)]:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Comment dialog for RETURN / REJECT */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDecision === 'REJECT' ? 'Reject transaction' : 'Return transaction'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {pendingDecision === 'REJECT'
                ? 'Provide a reason for rejecting this transaction. This cannot be undone.'
                : 'Provide a reason for returning this transaction for correction.'}
            </p>
            <div>
              <textarea
                rows={4}
                value={comments}
                onChange={(e) => {
                  setComments(e.target.value)
                  if (e.target.value.trim()) setCommentsError('')
                }}
                placeholder="Enter your comments…"
                className={`w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30 ${
                  commentsError ? 'border-destructive' : 'border-input'
                }`}
                aria-label="Decision comments"
              />
              {commentsError && (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  {commentsError}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleDecisionWithComment}
              disabled={isPending}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                pendingDecision === 'REJECT'
                  ? 'bg-red-600 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-red-700'
                  : 'bg-amber-600 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-amber-700'
              }`}
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Processing…
                </span>
              ) : pendingDecision === 'REJECT' ? (
                'Confirm Reject'
              ) : (
                'Confirm Return'
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
