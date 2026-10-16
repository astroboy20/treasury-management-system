'use client'

/**
 * Offline sync processor.
 *
 * Called automatically when the browser transitions from offline → online.
 * Iterates the IndexedDB queue in insertion order and calls the matching
 * server action for each item.  Partial failures are tolerated — a failed
 * item stays in the queue (up to MAX_ATTEMPTS) while successful items are
 * removed immediately.
 *
 * "Already done" detection:
 * Many RPCs have unique constraints (e.g. one signature_verification per
 * transaction).  If an item was applied before a page refresh and the queue
 * still holds the entry, the RPC will return an error.  We detect these by
 * matching known Postgres constraint / duplicate error substrings and treat
 * them as successful (remove from queue, don't surface an error toast).
 */

import {
  getPendingActions,
  removeFromQueue,
  updateQueueItem,
  type QueuedAction,
} from './queue'

// Server actions — imported by name so tree-shaking keeps the bundle lean.
// These are 'use server' functions; Next.js 15 handles the serialisation
// boundary automatically when called from a client module.
import { createTransactionAction, createReversalAction } from '@/lib/actions/transaction.actions'
import { createTransactionBatchAction }                  from '@/lib/actions/batch.actions'
import {
  verifySignatureAction,
  recordCustomerConfirmationAction,
  verifyInvestmentAction,
  recordAuditVerificationAction,
} from '@/lib/actions/verification.actions'
import { prepareVoucherAction }    from '@/lib/actions/voucher.actions'
import { approveTransactionAction } from '@/lib/actions/approval.actions'
import { executeTransactionAction } from '@/lib/actions/operations.actions'

import type { CreateTransactionInput } from '@/lib/schemas/transaction.schema'
import type { SignatureVerificationInput, CustomerConfirmationInput, InvestmentVerificationInput } from '@/lib/schemas/verification.schema'
import type { VoucherPreparationInput } from '@/lib/schemas/voucher.schema'
import type { ApprovalStage, ApprovalDecision } from '@/lib/schemas/approval.schema'
import type { ExecutionInput } from '@/lib/actions/operations.actions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncProgress {
  total:     number
  processed: number
  succeeded: number
  failed:    number
}

export type SyncProgressCallback = (progress: SyncProgress) => void

// ─── "Already applied" heuristic ─────────────────────────────────────────────

/**
 * Some Postgres errors indicate the RPC was already applied (duplicate key,
 * unique constraint, wrong status transition).  We treat these as "done" so
 * the item is removed from the queue and no error is surfaced to the user.
 */
const IDEMPOTENT_ERROR_PATTERNS = [
  'duplicate key',
  'unique constraint',
  'already exists',
  'already been verified',
  'already been recorded',
  'already prepared',
  'already been submitted',
  'invalid status transition',
]

function isAlreadyApplied(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase()
  return IDEMPOTENT_ERROR_PATTERNS.some((p) => lower.includes(p))
}

// ─── Payload types (mirrors enqueue call-sites) ────────────────────────────────

interface CreateTransactionPayload { input: CreateTransactionInput }
interface CreateReversalPayload    { originalTransactionId: string; reversalReason: string }
interface BatchPayload             { rows: CreateTransactionInput[] }
interface VerifySignaturePayload   { transactionId: string; input: SignatureVerificationInput }
interface ConfirmationPayload      { transactionId: string; input: CustomerConfirmationInput }
interface InvestmentPayload        { transactionId: string; input: InvestmentVerificationInput }
interface VoucherPayload           { transactionId: string; input: VoucherPreparationInput }
interface ApprovalPayload          { transactionId: string; stage: ApprovalStage; decision: ApprovalDecision; comments?: string }
interface ExecutionPayload         { transactionId: string; input: ExecutionInput }
interface AuditVerificationPayload { transactionId: string; input: SignatureVerificationInput }

// ─── Action dispatcher ────────────────────────────────────────────────────────

async function dispatchAction(item: QueuedAction): Promise<{ success: boolean; error?: string }> {
  switch (item.type) {
    case 'CREATE_TRANSACTION': {
      const p = item.payload as CreateTransactionPayload
      return createTransactionAction(p.input)
    }

    case 'CREATE_REVERSAL': {
      const p = item.payload as CreateReversalPayload
      return createReversalAction(p)
    }

    case 'CREATE_TRANSACTION_BATCH': {
      const p = item.payload as BatchPayload
      const result = await createTransactionBatchAction(p.rows)
      // Treat as success if the action itself ran (partial row failures are
      // acceptable and surfaced through the batch results).
      return { success: result.success, error: result.error }
    }

    case 'VERIFY_SIGNATURE': {
      const p = item.payload as VerifySignaturePayload
      return verifySignatureAction(p.transactionId, p.input)
    }

    case 'RECORD_CUSTOMER_CONFIRMATION': {
      const p = item.payload as ConfirmationPayload
      return recordCustomerConfirmationAction(p.transactionId, p.input)
    }

    case 'VERIFY_INVESTMENT': {
      const p = item.payload as InvestmentPayload
      return verifyInvestmentAction(p.transactionId, p.input)
    }

    case 'PREPARE_VOUCHER': {
      const p = item.payload as VoucherPayload
      return prepareVoucherAction(p.transactionId, p.input)
    }

    case 'APPROVE_TRANSACTION': {
      const p = item.payload as ApprovalPayload
      return approveTransactionAction(p.transactionId, p.stage, p.decision, p.comments)
    }

    case 'EXECUTE_TRANSACTION': {
      const p = item.payload as ExecutionPayload
      return executeTransactionAction(p.transactionId, p.input)
    }

    case 'RECORD_AUDIT_VERIFICATION': {
      const p = item.payload as AuditVerificationPayload
      return recordAuditVerificationAction(p.transactionId, p.input)
    }

    default:
      return { success: false, error: `Unknown action type: ${(item as QueuedAction).type}` }
  }
}

// ─── Main sync function ───────────────────────────────────────────────────────

/**
 * Process all queued actions in order.
 *
 * Returns a summary of what happened.  The caller is responsible for
 * refreshing the router / revalidating data after a successful sync.
 *
 * @param onProgress  Called after each item is processed so the UI can show
 *                    a live progress indicator.
 */
export async function processSyncQueue(
  onProgress?: SyncProgressCallback,
): Promise<SyncProgress> {
  const pending = await getPendingActions()

  const progress: SyncProgress = {
    total:     pending.length,
    processed: 0,
    succeeded: 0,
    failed:    0,
  }

  if (pending.length === 0) return progress

  for (const item of pending) {
    // Mark as syncing so the UI knows this item is in-flight
    await updateQueueItem(item.id, { status: 'syncing' })

    let result: { success: boolean; error?: string }

    try {
      result = await dispatchAction(item)
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error during sync.',
      }
    }

    progress.processed++

    if (result.success) {
      await removeFromQueue(item.id)
      progress.succeeded++
    } else {
      const errorMsg = result.error ?? 'Action failed.'

      // If the server tells us the operation was already applied, silently
      // remove the item — it doesn't need retrying.
      if (isAlreadyApplied(errorMsg)) {
        await removeFromQueue(item.id)
        progress.succeeded++ // counts as a win — data is consistent
      } else {
        const newAttempts = item.attempts + 1
        const isFatal = newAttempts >= 3
        await updateQueueItem(item.id, {
          status:       isFatal ? 'failed' : 'pending',
          attempts:     newAttempts,
          errorMessage: errorMsg,
        })
        progress.failed++
      }
    }

    onProgress?.(progress)
  }

  return progress
}
