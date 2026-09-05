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

  // Maker-checker: creator cannot approve their own transaction
  if (tx.created_by === actorId) {
    // Only blocks approval stages, not other actions
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
        'CUSTOMER_CONFIRMED',
        'INVESTMENT_VERIFIED',
        'VOUCHER_PREPARED',
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
 * Each step has a state: completed | active | locked.
 */
export function buildStepsMeta(status: string, signatureResult?: string | null): StepMeta[] {
  const statusIndex = STATUS_ORDER.indexOf(status as WorkflowStatus)
  const signatureFailed = signatureResult === 'FAILED'

  const steps: Omit<StepMeta, 'state' | 'lockedReason'>[] = [
    { id: 1, label: 'Instruction',       description: 'Customer instruction recorded' },
    { id: 2, label: 'Signature',         description: 'Signature verification' },
    { id: 3, label: 'Confirmation',      description: 'Customer telephone confirmation' },
    { id: 4, label: 'Investment',        description: 'Investment data verified' },
    { id: 5, label: 'Voucher',           description: 'Treasury voucher prepared' },
    { id: 6, label: 'Approval',          description: 'Five-stage approval chain' },
  ]

  return steps.map((step) => {
    let state: StepState = 'locked'
    let lockedReason: string | undefined

    switch (step.id) {
      case 1:
        // Always completed once a transaction exists
        state = 'completed'
        break

      case 2:
        if (statusIndex >= STATUS_ORDER.indexOf('SIGNATURE_VERIFIED')) {
          state = 'completed'
        } else if (status === 'INSTRUCTION_RECEIVED') {
          state = 'active'
        } else {
          state = 'locked'
          lockedReason = 'Awaiting signature verification'
        }
        break

      case 3:
        if (signatureFailed) {
          state = 'locked'
          lockedReason = 'Signature verification failed — contact compliance'
        } else if (statusIndex >= STATUS_ORDER.indexOf('CUSTOMER_CONFIRMED')) {
          state = 'completed'
        } else if (status === 'SIGNATURE_VERIFIED') {
          state = 'active'
        } else {
          state = 'locked'
          lockedReason = 'Awaiting signature verification'
        }
        break

      case 4:
        if (signatureFailed) {
          state = 'locked'
          lockedReason = 'Signature verification failed — contact compliance'
        } else if (statusIndex >= STATUS_ORDER.indexOf('INVESTMENT_VERIFIED')) {
          state = 'completed'
        } else if (status === 'CUSTOMER_CONFIRMED') {
          state = 'active'
        } else {
          state = 'locked'
          lockedReason = 'Awaiting customer confirmation'
        }
        break

      case 5:
        if (signatureFailed) {
          state = 'locked'
          lockedReason = 'Signature verification failed — contact compliance'
        } else if (statusIndex >= STATUS_ORDER.indexOf('VOUCHER_PREPARED')) {
          state = 'completed'
        } else if (status === 'INVESTMENT_VERIFIED') {
          state = 'active'
        } else {
          state = 'locked'
          lockedReason = 'Awaiting investment verification'
        }
        break

      case 6: {
        const approvalStart = STATUS_ORDER.indexOf('VOUCHER_PREPARED')
        const completed = STATUS_ORDER.indexOf('MD_APPROVED')
        if (signatureFailed) {
          state = 'locked'
          lockedReason = 'Signature verification failed — contact compliance'
        } else if (statusIndex > completed || status === 'COMPLETED') {
          state = 'completed'
        } else if (statusIndex >= approvalStart) {
          state = 'active'
        } else {
          state = 'locked'
          lockedReason = 'Awaiting voucher preparation'
        }
        break
      }
    }

    return { ...step, state, lockedReason }
  })
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
