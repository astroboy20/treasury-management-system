'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Lock,
  Clock,
  XCircle,
  CornerUpLeft,
  ThumbsUp,
  AlertTriangle,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { approveTransactionAction } from '@/lib/actions/approval.actions'
import type { ApprovalStage, ApprovalDecision } from '@/lib/schemas/approval.schema'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'
import { useNetworkStatus } from '@/lib/hooks/useNetworkStatus'
import { enqueue } from '@/lib/offline/queue'

// ─── Approval stage configuration ────────────────────────────────────────────

interface StageDef {
  stage: ApprovalStage
  label: string
  roleCode: string
  roleLabel: string
  prerequisiteStatus: string
  approvedStatus: string
}

const STAGES: StageDef[] = [
  {
    stage: 'TREASURY',
    label: 'Treasury Sign-off',
    roleCode: 'TREASURY_OFFICER',
    roleLabel: 'Treasury Officer (Checker)',
    prerequisiteStatus: 'VOUCHER_PREPARED',
    approvedStatus: 'TREASURY_APPROVED',
  },
  {
    stage: 'HEAD_TREASURY',
    label: 'Head Treasury Review',
    roleCode: 'HEAD_TREASURY',
    roleLabel: 'Head of Treasury',
    prerequisiteStatus: 'TREASURY_APPROVED',
    approvedStatus: 'HEAD_TREASURY_APPROVED',
  },
  {
    stage: 'MIS',
    label: 'MIS Review',
    roleCode: 'MIS',
    roleLabel: 'MIS Officer',
    prerequisiteStatus: 'HEAD_TREASURY_APPROVED',
    approvedStatus: 'MIS_APPROVED',
  },
  {
    stage: 'AUDIT',
    label: 'Audit Review',
    roleCode: 'AUDIT',
    roleLabel: 'Audit Officer',
    prerequisiteStatus: 'MIS_APPROVED',
    approvedStatus: 'AUDIT_APPROVED',
  },
  {
    stage: 'MD',
    label: 'MD Approval',
    roleCode: 'MD',
    roleLabel: 'Managing Director',
    prerequisiteStatus: 'AUDIT_APPROVED',
    approvedStatus: 'MD_APPROVED',
  },
]

const STATUS_ORDER = [
  'VOUCHER_PREPARED',
  'TREASURY_APPROVED',
  'HEAD_TREASURY_APPROVED',
  'MIS_APPROVED',
  'AUDIT_APPROVED',
  'MD_APPROVED',
  'OPERATIONS_PROCESSING',
  'OPERATIONS_COMPLETED',
  'TREASURY_CONFIRMED',
  'COMPLETED',
]

const EXCEPTION_STATUSES = new Set(['RETURNED', 'REJECTED', 'CANCELLED', 'FAILED'])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

type StageState = 'completed' | 'active' | 'locked'

function resolveStageState(stage: StageDef, currentStatus: string): StageState {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus)
  const approvedIdx = STATUS_ORDER.indexOf(stage.approvedStatus)
  const prereqIdx = STATUS_ORDER.indexOf(stage.prerequisiteStatus)

  if (EXCEPTION_STATUSES.has(currentStatus)) {
    if (currentStatus === 'RETURNED') return 'locked'
    if (approvedIdx !== -1 && currentIdx !== -1 && approvedIdx < currentIdx) return 'completed'
    return 'locked'
  }

  if (approvedIdx !== -1 && currentIdx !== -1 && approvedIdx <= currentIdx) return 'completed'
  if (prereqIdx !== -1 && currentIdx !== -1 && prereqIdx <= currentIdx) return 'active'
  return 'locked'
}

// ─── Decision badge ───────────────────────────────────────────────────────────

const DECISION_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  APPROVE: {
    label: 'Approved',
    className: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    icon: <CheckCircle2 className="size-3" aria-hidden />,
  },
  RETURN: {
    label: 'Recalled',
    className: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200',
    icon: <CornerUpLeft className="size-3" aria-hidden />,
  },
  REJECT: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
    icon: <XCircle className="size-3" aria-hidden />,
  },
}

function DecisionBadge({ decision }: { decision: string }) {
  const config = DECISION_CONFIG[decision] ?? {
    label: decision,
    className: 'bg-muted text-muted-foreground',
    icon: null,
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  )
}

// ─── Completed stage row ──────────────────────────────────────────────────────

interface CompletedRowProps {
  stageDef: StageDef
  approval: TransactionWorkspace['approvals'][number]
}

function CompletedRow({ stageDef, approval }: CompletedRowProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
          <span className="text-sm font-medium text-foreground">{stageDef.label}</span>
          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
            {stageDef.roleLabel}
          </Badge>
        </div>
        <DecisionBadge decision={approval.decision} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground pl-6">
        {approval.approver?.full_name && (
          <span className="font-medium text-foreground/80">{approval.approver.full_name}</span>
        )}
        <time dateTime={approval.approved_at}>{formatDateTime(approval.approved_at)}</time>
      </div>

      {approval.comments && (
        <div className="rounded-md border border-border bg-background px-3 py-2 mt-1 ml-6">
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">
            {approval.comments}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Locked stage row ─────────────────────────────────────────────────────────

function LockedRow({ stageDef }: { stageDef: StageDef }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
      aria-label={`${stageDef.label} — locked`}
    >
      <Lock className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-muted-foreground">{stageDef.label}</span>
        <span className="text-xs text-muted-foreground/70">
          Awaiting {stageDef.roleLabel} · Prior stage must be completed first
        </span>
      </div>
    </div>
  )
}

// ─── Active stage row ─────────────────────────────────────────────────────────

interface ActiveRowProps {
  stageDef: StageDef
  transactionId: string
  transactionCreatedBy: string
  currentUserId: string
  currentUserRole: string | null
  onActionComplete: () => void
  /**
   * AUDIT stage only: whether the audit checklist has been submitted.
   * Approval buttons are gated until this is true.
   */
  auditChecklistDone?: boolean
}

function ActiveRow({
  stageDef,
  transactionId,
  transactionCreatedBy,
  currentUserId,
  currentUserRole,
  onActionComplete,
  auditChecklistDone,
}: ActiveRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<ApprovalDecision | null>(null)
  const [comments, setComments] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // undefined = not yet hydrated → treat as online to avoid flicker
  const networkStatus = useNetworkStatus()
  const isOnline = networkStatus !== false

  const isMaker = currentUserId === transactionCreatedBy
  const canAct =
    (currentUserRole === stageDef.roleCode || currentUserRole === 'ADMIN') && !isMaker

  const isAuditStage = stageDef.stage === 'AUDIT'
  const canApprove = canAct && (!isAuditStage || !!auditChecklistDone)

  function openDialog(decision: ApprovalDecision) {
    setPendingDecision(decision)
    setComments('')
    setCommentsError('')
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setPendingDecision(null)
    setComments('')
    setCommentsError('')
  }

  async function handleApprove() {
    setSubmitting(true)

    if (!isOnline) {
      await enqueue({
        type: 'APPROVE_TRANSACTION',
        payload: { transactionId, stage: stageDef.stage, decision: 'APPROVE', comments: undefined },
      })
      setSubmitting(false)
      toast.warning("You're offline. Approval queued and will be submitted when you reconnect.")
      return
    }

    const result = await approveTransactionAction(
      transactionId,
      stageDef.stage,
      'APPROVE',
      undefined,
    )
    setSubmitting(false)

    if (result.success) {
      toast.success(`Transaction approved at ${stageDef.label} stage.`)
      onActionComplete()
    } else {
      toast.error(result.error ?? 'Approval failed. Please try again.')
    }
  }

  async function handleDialogConfirm() {
    if (!pendingDecision) return

    if (!comments.trim()) {
      setCommentsError(
        pendingDecision === 'RETURN'
          ? 'A comment is required when returning a transaction.'
          : 'A comment is required when rejecting a transaction.',
      )
      return
    }

    setSubmitting(true)

    if (!isOnline) {
      await enqueue({
        type: 'APPROVE_TRANSACTION',
        payload: { transactionId, stage: stageDef.stage, decision: pendingDecision, comments: comments.trim() },
      })
      setSubmitting(false)
      const label = pendingDecision === 'RETURN' ? 'Recall' : 'Rejection'
      toast.warning(`You're offline. ${label} queued and will be submitted when you reconnect.`)
      closeDialog()
      return
    }

    const result = await approveTransactionAction(
      transactionId,
      stageDef.stage,
      pendingDecision,
      comments.trim(),
    )
    setSubmitting(false)

    if (result.success) {
      const label = pendingDecision === 'RETURN' ? 'returned' : 'rejected'
      toast.success(`Transaction ${label} at ${stageDef.label} stage.`)
      closeDialog()
      onActionComplete()
    } else {
      toast.error(result.error ?? 'Action failed. Please try again.')
    }
  }

  const dialogTitle =
    pendingDecision === 'RETURN' ? 'Recall Transaction' : 'Reject Transaction'
  const dialogDescription =
    pendingDecision === 'RETURN'
      ? 'The transaction will be recalled and sent back to the maker for correction. A non-empty comment is required.'
      : 'The transaction will be permanently rejected and no further action can be taken. A non-empty comment is required.'
  const dialogActionLabel =
    pendingDecision === 'RETURN' ? 'Confirm Recall' : 'Confirm Reject'
  const dialogActionVariant: 'default' | 'destructive' =
    pendingDecision === 'REJECT' ? 'destructive' : 'default'

  return (
    <>
      <div
        className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-background p-4 shadow-sm"
        aria-label={`${stageDef.label} — awaiting action`}
      >
        {/* Stage header */}
        <div className="flex flex-wrap items-center gap-2">
          <Clock className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="text-sm font-medium text-foreground">{stageDef.label}</span>
          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
            {stageDef.roleLabel}
          </Badge>
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Awaiting approval
          </span>
        </div>

        {/* Action area */}
        {canAct ? (
          <div className="flex flex-col gap-2 pt-1 pl-6">
            {/* Audit checklist gate notice */}
            {isAuditStage && !auditChecklistDone && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Complete your verification checklist in the Instruction &amp; Verification panel above before approving, recalling, or rejecting.
              </p>
            )}
            {/* Offline notice */}
            {!isOnline && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <WifiOff className="size-3.5 shrink-0" aria-hidden />
                Offline — actions will be queued and synced when you reconnect.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleApprove}
                disabled={submitting || !canApprove}
                className="gap-1.5"
              >
                <ThumbsUp className="size-3.5" aria-hidden />
                {isOnline ? 'Approve' : 'Approve (queued)'}
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => openDialog('RETURN')}
                disabled={submitting || !canApprove}
                className="gap-1.5"
              >
                <CornerUpLeft className="size-3.5" aria-hidden />
                Recall
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => openDialog('REJECT')}
                disabled={submitting || !canApprove}
                className="gap-1.5 text-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:text-destructive"
              >
                <XCircle className="size-3.5" aria-hidden />
                Reject
              </Button>
            </div>
          </div>
        ) : (
          <p className="pl-6 text-xs italic text-muted-foreground">
            {isMaker
              ? 'You created this transaction and cannot approve it (maker-checker policy).'
              : `Only a ${stageDef.roleLabel} can act on this stage.`}
          </p>
        )}
      </div>

      {/* Return / Reject dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="approval-comments" className="text-xs font-medium">
              Comment <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="approval-comments"
              rows={4}
              maxLength={2000}
              placeholder={
                pendingDecision === 'RETURN'
                  ? 'Explain what needs to be corrected before resubmission…'
                  : 'Provide the reason for rejection…'
              }
              value={comments}
              onChange={(e) => {
                setComments(e.target.value)
                if (commentsError && e.target.value.trim()) setCommentsError('')
              }}
              disabled={submitting}
              aria-describedby={commentsError ? 'comments-error' : undefined}
              className="resize-none text-sm"
            />
            {commentsError && (
              <p id="comments-error" className="text-xs text-destructive" role="alert">
                {commentsError}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground/70">
              {comments.length} / 2 000 characters
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={dialogActionVariant}
              size="sm"
              onClick={handleDialogConfirm}
              disabled={submitting || !comments.trim()}
            >
              {submitting ? 'Submitting…' : dialogActionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step6ApprovalChainProps {
  transactionId: string
  transactionStatus: string
  transactionCreatedBy: string
  approvals: TransactionWorkspace['approvals']
  currentUserId: string
  currentUserRole: string | null
  /** Whether the Audit Officer's checklist has been submitted (gates AUDIT approval buttons) */
  auditChecklistDone: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Approval Chain Panel.
 *
 * Renders all five approval stages (Treasury → Head Treasury → MIS → Audit → MD).
 * For the AUDIT stage, the approval buttons are gated behind the audit checklist
 * which is completed in the Instruction & Verification panel (Step 2).
 *
 * Requirements: 12.1, 12.5, 12.6, 12.7, 13.1–13.5
 */
export default function Step6ApprovalChain({
  transactionId,
  transactionStatus,
  transactionCreatedBy,
  approvals,
  currentUserId,
  currentUserRole,
  auditChecklistDone,
}: Step6ApprovalChainProps) {
  const approvalMap = new Map(approvals.map((a) => [a.stage, a]))
  const isException = EXCEPTION_STATUSES.has(transactionStatus)
  const router = useRouter()

  function handleActionComplete() {
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {/* Exception notice */}
      {isException && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-amber-800">
              Approval chain{' '}
              {transactionStatus === 'REJECTED'
                ? 'rejected'
                : transactionStatus === 'RETURNED'
                ? 'recalled for correction'
                : 'halted'}
            </p>
            <p className="text-xs text-amber-700">
              {transactionStatus === 'REJECTED'
                ? 'This transaction has been permanently rejected. No further actions are possible.'
                : transactionStatus === 'RETURNED'
                ? 'This transaction has been recalled by an approver. The maker must correct and resubmit the voucher to restart the approval chain.'
                : 'This transaction is in an exception state and requires review before the approval chain can resume.'}
            </p>
          </div>
        </div>
      )}

      {/* Stage list — all 5 always rendered for full context (Req 13.1) */}
      <ol className="space-y-3 list-none m-0 p-0" aria-label="Approval stages">
        {STAGES.map((stageDef, index) => {
          const existingApproval = approvalMap.get(stageDef.stage)
          const stageState = resolveStageState(stageDef, transactionStatus)
          const effectiveState: StageState = existingApproval ? 'completed' : stageState

          return (
            <li key={stageDef.stage}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <span
                  className={[
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    effectiveState === 'completed'
                      ? 'bg-emerald-500 text-white'
                      : effectiveState === 'active'
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-muted text-muted-foreground',
                  ].join(' ')}
                  aria-hidden
                >
                  {effectiveState === 'completed' ? '✓' : index + 1}
                </span>
              </div>

              {effectiveState === 'completed' && existingApproval ? (
                <CompletedRow stageDef={stageDef} approval={existingApproval} />
              ) : effectiveState === 'active' && !isException ? (
                <ActiveRow
                  stageDef={stageDef}
                  transactionId={transactionId}
                  transactionCreatedBy={transactionCreatedBy}
                  currentUserId={currentUserId}
                  currentUserRole={currentUserRole}
                  onActionComplete={handleActionComplete}
                  auditChecklistDone={stageDef.stage === 'AUDIT' ? auditChecklistDone : undefined}
                />
              ) : (
                <LockedRow stageDef={stageDef} />
              )}

              {index < STAGES.length - 1 && <Separator className="mt-3" />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
