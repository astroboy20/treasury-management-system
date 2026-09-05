'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Lock,
  Clock,
  XCircle,
  CornerUpLeft,
  ThumbsUp,
  AlertTriangle,
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

// ─── Approval stage configuration ────────────────────────────────────────────

interface StageDef {
  stage: ApprovalStage
  label: string
  roleCode: string
  roleLabel: string
  /** Transaction status required before this stage becomes active */
  prerequisiteStatus: string
  /** Transaction status set when this stage is approved */
  approvedStatus: string
}

const STAGES: StageDef[] = [
  {
    stage: 'TREASURY',
    label: 'Treasury Approval',
    roleCode: 'TREASURY_OFFICER',
    roleLabel: 'Treasury Officer',
    prerequisiteStatus: 'VOUCHER_PREPARED',
    approvedStatus: 'TREASURY_APPROVED',
  },
  {
    stage: 'HEAD_TREASURY',
    label: 'Head Treasury Approval',
    roleCode: 'HEAD_TREASURY',
    roleLabel: 'Head of Treasury',
    prerequisiteStatus: 'TREASURY_APPROVED',
    approvedStatus: 'HEAD_TREASURY_APPROVED',
  },
  {
    stage: 'MIS',
    label: 'MIS Approval',
    roleCode: 'MIS',
    roleLabel: 'MIS Officer',
    prerequisiteStatus: 'HEAD_TREASURY_APPROVED',
    approvedStatus: 'MIS_APPROVED',
  },
  {
    stage: 'AUDIT',
    label: 'Audit Approval',
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

// Statuses that mean the approval chain is at or past this stage
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

// Terminal exception statuses — show in the chain header
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

  // If current status is an exception, all stages before the exception are either
  // completed (if their approved status comes before the last approved one) or locked.
  if (EXCEPTION_STATUSES.has(currentStatus)) {
    // A stage is completed if its approval record exists (checked at render via approvals map)
    // For exception statuses we fall back to index comparison
    if (approvedIdx !== -1 && currentIdx !== -1 && approvedIdx < currentIdx) return 'completed'
    return 'locked'
  }

  if (approvedIdx !== -1 && currentIdx !== -1 && approvedIdx <= currentIdx) return 'completed'
  if (prereqIdx !== -1 && currentIdx !== -1 && prereqIdx <= currentIdx) return 'active'
  return 'locked'
}

/**
 * Returns true if `currentStatus` is at or past `status` in the workflow order.
 */
function isAtOrPast(currentStatus: string, status: string): boolean {
  const ci = STATUS_ORDER.indexOf(currentStatus)
  const si = STATUS_ORDER.indexOf(status)
  return ci !== -1 && si !== -1 && ci >= si
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
    label: 'Returned',
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
      {/* Stage header */}
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

      {/* Actor + timestamp */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground pl-6">
        {approval.approver?.full_name && (
          <span className="font-medium text-foreground/80">{approval.approver.full_name}</span>
        )}
        <time dateTime={approval.approved_at}>{formatDateTime(approval.approved_at)}</time>
      </div>

      {/* Comments (shown for RETURN and REJECT; also optional APPROVE comments) */}
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
}

function ActiveRow({
  stageDef,
  transactionId,
  transactionCreatedBy,
  currentUserId,
  currentUserRole,
  onActionComplete,
}: ActiveRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<ApprovalDecision | null>(null)
  const [comments, setComments] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Req 12.4 — maker-checker: creator cannot approve their own transaction
  const isMaker = currentUserId === transactionCreatedBy
  // Role check: only the required role can act (Req 5.2, 12.4)
  const canAct =
    (currentUserRole === stageDef.roleCode || currentUserRole === 'ADMIN') && !isMaker

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

    // Client-side comments validation (schema also validates server-side)
    if (!comments.trim()) {
      setCommentsError(
        pendingDecision === 'RETURN'
          ? 'A comment is required when returning a transaction.'
          : 'A comment is required when rejecting a transaction.',
      )
      return
    }

    setSubmitting(true)
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
    pendingDecision === 'RETURN' ? 'Return Transaction' : 'Reject Transaction'
  const dialogDescription =
    pendingDecision === 'RETURN'
      ? 'The transaction will be sent back to the maker for correction. A non-empty comment is required.'
      : 'The transaction will be permanently rejected and no further action can be taken. A non-empty comment is required.'
  const dialogActionLabel =
    pendingDecision === 'RETURN' ? 'Confirm Return' : 'Confirm Reject'
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
          <div className="flex flex-wrap items-center gap-2 pt-1 pl-6">
            {/* Approve */}
            <Button
              size="sm"
              variant="default"
              onClick={handleApprove}
              disabled={submitting}
              className="gap-1.5"
            >
              <ThumbsUp className="size-3.5" aria-hidden />
              Approve
            </Button>

            {/* Return */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog('RETURN')}
              disabled={submitting}
              className="gap-1.5"
            >
              <CornerUpLeft className="size-3.5" aria-hidden />
              Return
            </Button>

            {/* Reject */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog('REJECT')}
              disabled={submitting}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <XCircle className="size-3.5" aria-hidden />
              Reject
            </Button>
          </div>
        ) : (
          <p className="pl-6 text-xs italic text-muted-foreground">
            {isMaker
              ? 'You created this transaction and cannot approve it (maker-checker policy).'
              : `Only a ${stageDef.roleLabel} can act on this stage.`}
          </p>
        )}
      </div>

      {/* Return / Reject dialog — requires mandatory comments (Req 13.4, 12.6, 12.7) */}
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
                if (commentsError && e.target.value.trim()) {
                  setCommentsError('')
                }
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
            <Button
              variant="outline"
              size="sm"
              onClick={closeDialog}
              disabled={submitting}
            >
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
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 6 — Approval Chain Panel.
 *
 * Renders all five approval stages with contextual state per stage:
 *   - `completed` → read-only row: actor, decision badge, timestamp, comments
 *   - `active`    → action row with Approve / Return / Reject buttons (role-gated)
 *   - `locked`    → greyed-out placeholder with locked icon
 *
 * Rules enforced:
 *   - Action buttons only shown when currentUser.role === stage.roleCode AND user ≠ tx creator (Req 5.4, 12.4)
 *   - Return/Reject decisions open a Dialog requiring non-empty comments (Req 12.6, 12.7, 13.4)
 *   - Approval submitted via approveTransactionAction; Sonner toast on result
 *   - All five stages always visible for full context (Req 13.1, 13.5)
 *
 * After any successful action the page is refreshed via router.refresh() to
 * re-hydrate the server-component workspace with the new status.
 *
 * Requirements: 12.1, 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 13.5
 */
export default function Step6ApprovalChain({
  transactionId,
  transactionStatus,
  transactionCreatedBy,
  approvals,
  currentUserId,
  currentUserRole,
}: Step6ApprovalChainProps) {
  // Build a fast lookup from stage → approval record
  const approvalMap = new Map(approvals.map((a) => [a.stage, a]))

  const isException = EXCEPTION_STATUSES.has(transactionStatus)

  function handleActionComplete() {
    // Trigger a full server component refresh so the workspace reflects the new status
    window.location.reload()
  }

  return (
    <div className="space-y-3">
      {/* Exception notice — shown when chain is in a terminal exception state */}
      {isException && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-amber-800">
              Approval chain{' '}
              {transactionStatus === 'REJECTED'
                ? 'rejected'
                : transactionStatus === 'RETURNED'
                ? 'returned for correction'
                : 'halted'}
            </p>
            <p className="text-xs text-amber-700">
              {transactionStatus === 'REJECTED'
                ? 'This transaction has been permanently rejected. No further actions are possible.'
                : transactionStatus === 'RETURNED'
                ? 'This transaction has been returned to the maker for correction. Once resubmitted it will re-enter the approval chain.'
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

          // A stage with an existing approval record is always completed —
          // the DB unique constraint prevents duplicate approval records.
          const effectiveState: StageState = existingApproval ? 'completed' : stageState

          return (
            <li key={stageDef.stage}>
              {/* Step number indicator */}
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

              {/* Stage content */}
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
                />
              ) : (
                <LockedRow stageDef={stageDef} />
              )}

              {/* Divider between stages (omit after last) */}
              {index < STAGES.length - 1 && (
                <Separator className="mt-3" />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
