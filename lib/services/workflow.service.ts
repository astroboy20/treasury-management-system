/**
 * Workflow service — pure TypeScript state inspection helpers.
 * No database calls. Used by server actions to validate state
 * before calling PostgreSQL RPCs.
 */

import { STAGE_TO_ROLE, STAGE_REQUIRED_STATUS } from '@/lib/permissions/permissions'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | 'DRAFT'
  | 'INSTRUCTION_RECEIVED'
  | 'SIGNATURE_VERIFIED'
  | 'CUSTOMER_CONFIRMED'
  | 'INVESTMENT_VERIFIED'
  | 'VOUCHER_PREPARED'
  | 'TREASURY_APPROVED'
  | 'HEAD_TREASURY_APPROVED'
  | 'MIS_APPROVED'
  | 'AUDIT_APPROVED'
  | 'MD_APPROVED'
  | 'OPERATIONS_PROCESSING'
  | 'OPERATIONS_COMPLETED'
  | 'TREASURY_CONFIRMED'
  | 'COMPLETED'
  | 'RETURNED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'

export type ApprovalStage = 'TREASURY' | 'HEAD_TREASURY' | 'MIS' | 'AUDIT' | 'MD'

export interface TransactionForWorkflow {
  id: string
  status: string
  created_by: string
  transaction_type: string
}

export type StepState = 'completed' | 'active' | 'locked'

export interface StepMeta {
  id: number
  label: string
  description: string
  state: StepState
  lockedReason?: string
}

// ─── Status ordering for progress checks ─────────────────────────────────────

const STATUS_ORDER: WorkflowStatus[] = [
  'DRAFT',
  'INSTRUCTION_RECEIVED',
  'SIGNATURE_VERIFIED',
  'CUSTOMER_CONFIRMED',
  'INVESTMENT_VERIFIED',
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

const TERMINAL_STATUSES: WorkflowStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']
const EXCEPTION_STATUSES: WorkflowStatus[] = ['RETURNED', 'REJECTED', 'CANCELLED', 'FAILED']

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Returns the current workflow status wrapped with helper flags.
 */
export function getWorkflowStatus(tx: { status: string }) {
  const status = tx.status as WorkflowStatus
  return {
    status,
    isTerminal: TERMINAL_STATUSES.includes(status),
    isException: EXCEPTION_STATUSES.includes(status),
    isCompleted: status === 'COMPLETED',
  }
}

/**
 * Returns the approval stage currently required, or null if
 * the transaction is not in an approval-pending state.
 */
export function getRequiredStage(status: string): ApprovalStage | null {
  const stageMap: Record<string, ApprovalStage> = {
    VOUCHER_PREPARED:        'TREASURY',
    TREASURY_APPROVED:       'HEAD_TREASURY',
    HEAD_TREASURY_APPROVED:  'MIS',
    MIS_APPROVED:            'AUDIT',
    AUDIT_APPROVED:          'MD',
  }
  return stageMap[status] ?? null
}

/**
 * Checks whether a given actor role can take action on the current transaction.
 * Pure function — no DB calls. Server-side DB check remains authoritative.
 */
export function canActorAct(
  role: string,
  tx: TransactionForWorkflow,
  actorId: string,
): boolean {
  const { status } = tx

  // Maker-checker: creator cannot approve at the TREASURY checker stage
  if (tx.created_by === actorId) {
    const approvalStatuses = [
      'VOUCHER_PREPARED',
      'TREASURY_APPROVED',
      'HEAD_TREASURY_APPROVED',
      'MIS_APPROVED',
      'AUDIT_APPROVED',
    ]
    if (approvalStatuses.includes(status)) return false
  }

  switch (role) {
    case 'TREASURY_OFFICER':
      return [
        'INSTRUCTION_RECEIVED',
        'SIGNATURE_VERIFIED',
        'CUSTOMER_CONFIRMED',
        'INVESTMENT_VERIFIED',
        'VOUCHER_PREPARED',      // Treasury checker signs here
        'RETURNED',              // Maker can resubmit after a return
        'OPERATIONS_COMPLETED',
      ].includes(status)

    case 'ACCOUNT_OFFICER':
      return status === 'SIGNATURE_VERIFIED'

    case 'HEAD_TREASURY':
      return status === 'TREASURY_APPROVED'

    case 'MIS':
      return status === 'HEAD_TREASURY_APPROVED'

    case 'AUDIT':
      return status === 'MIS_APPROVED'

    case 'MD':
      return status === 'AUDIT_APPROVED'

    case 'OPERATIONS':
      return status === 'MD_APPROVED'

    default:
      return false
  }
}

/**
 * Builds the step metadata array for the StepProgressTracker.
 * Returns 2 steps matching the UI layout:
 *   1. Instruction & Verification (covers old steps 1–5, managed by Treasury Maker)
 *   2. Approval Chain (Head Treasury → MIS → Audit → MD)
 */
export function buildStepsMeta(status: string, signatureResult?: string | null): StepMeta[] {
  const statusIndex = STATUS_ORDER.indexOf(status as WorkflowStatus)
  const signatureFailed = signatureResult === 'FAILED'

  // ── Step 1: Instruction & Verification ──────────────────────────────────────
  // Active when: transaction exists but VOUCHER_PREPARED not yet reached,
  // OR the transaction was RETURNED (maker needs to correct and resubmit).
  // Completed once VOUCHER_PREPARED is reached (and not RETURNED).
  let step1State: StepState = 'active'
  let step1LockedReason: string | undefined

  if (status === 'RETURNED') {
    // Returned — open Step 1 so the maker can correct and resubmit
    step1State = 'active'
  } else if (signatureFailed) {
    step1State = 'active'
  } else if (statusIndex >= STATUS_ORDER.indexOf('VOUCHER_PREPARED')) {
    step1State = 'completed'
  } else {
    step1State = 'active'
  }

  // ── Step 2: Approval Chain ───────────────────────────────────────────────────
  // Active from VOUCHER_PREPARED onwards (except when RETURNED — chain paused).
  // Completed once MD_APPROVED is passed.
  let step2State: StepState = 'locked'
  let step2LockedReason: string | undefined

  const approvalStart = STATUS_ORDER.indexOf('VOUCHER_PREPARED')
  const approvalDone  = STATUS_ORDER.indexOf('MD_APPROVED')

  if (status === 'RETURNED') {
    step2State = 'locked'
    step2LockedReason = 'Transaction recalled for correction — resubmit voucher to restart chain'
  } else if (signatureFailed) {
    step2State = 'locked'
    step2LockedReason = 'Signature verification failed — contact compliance'
  } else if (statusIndex > approvalDone || status === 'COMPLETED') {
    step2State = 'completed'
  } else if (statusIndex >= approvalStart) {
    step2State = 'active'
  } else {
    step2State = 'locked'
    step2LockedReason = 'Awaiting instruction & verification'
  }

  return [
    {
      id: 1,
      label: 'Instruction & Verification',
      description: 'Treasury maker completes instruction, verification and voucher',
      state: step1State,
      lockedReason: step1LockedReason,
    },
    {
      id: 2,
      label: 'Approval Chain',
      description: 'Treasury Officer → Head of Treasury → MIS → Audit → MD',
      state: step2State,
      lockedReason: step2LockedReason,
    },
  ]
}

/**
 * Determines whether a specific approval stage has been completed.
 */
export function isStageComplete(stage: ApprovalStage, currentStatus: string): boolean {
  const requiredStatus = STAGE_REQUIRED_STATUS[stage]
  const statusIndex = STATUS_ORDER.indexOf(currentStatus as WorkflowStatus)
  const requiredIndex = STATUS_ORDER.indexOf(requiredStatus as WorkflowStatus)
  return statusIndex > requiredIndex
}

/**
 * Returns the required role for a given approval stage.
 */
export function getRoleForStage(stage: ApprovalStage): string {
  return STAGE_TO_ROLE[stage]
}
