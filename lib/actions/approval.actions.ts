'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import {
  ApprovalSchema,
  type ApprovalStage,
  type ApprovalDecision,
} from '@/lib/schemas/approval.schema'
import type { ActionResult } from '@/lib/actions/transaction.actions'

// ─── Stage → required role mapping ───────────────────────────────────────────

/**
 * Maps each approval stage to the role that must perform it.
 * Used for server-side role enforcement before calling the RPC (Req 5.2, 12.1).
 */
const STAGE_ROLE_MAP: Record<ApprovalStage, string> = {
  TREASURY: 'TREASURY_OFFICER',
  HEAD_TREASURY: 'HEAD_TREASURY',
  MIS: 'MIS',
  AUDIT: 'AUDIT',
  MD: 'MD',
}

// ─── approveTransactionAction ─────────────────────────────────────────────────

/**
 * Submits an approval decision for a given stage of the approval chain.
 *
 * Security:
 * - Resolves caller role from DB — never trusts client-supplied role (Req 5.1).
 * - Enforces that the actor's role matches the stage being approved (Req 5.2, 12.4).
 * - Maker-checker: the RPC rejects the actor if they created the transaction (Req 5.4).
 *
 * State machine:
 * - Delegates to the approve_transaction RPC which atomically validates prior
 *   stage completion, records the approvals row, transitions transaction status,
 *   and writes an APPROVAL_GRANTED / APPROVAL_RETURNED / APPROVAL_REJECTED
 *   audit event (Req 12.2).
 * - RETURN and REJECT decisions require non-empty comments (enforced by Zod
 *   schema and by the RPC) (Req 12.6, 12.7).
 * - Idempotent: the unique constraint on (transaction_id, stage) prevents
 *   duplicate approval records (Req 12.9).
 *
 * Requirements: 12.2, 12.8, 12.9, 5.3, 5.4
 */
export async function approveTransactionAction(
  transactionId: string,
  stage: ApprovalStage,
  decision: ApprovalDecision,
  comments?: string,
): Promise<ActionResult<{ newStatus: string; approvalId: string }>> {
  // 1. Validate inputs with Zod (enforces comments requirement for RETURN/REJECT)
  const parsed = ApprovalSchema.safeParse({ stage, decision, comments })
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Invalid input.'
    return { success: false, error: firstError }
  }

  if (!transactionId || typeof transactionId !== 'string') {
    return { success: false, error: 'Invalid transaction ID.' }
  }

  // 2. Authenticate
  const user = await getAuthenticatedUser()
  if (!user) {
    return { success: false, error: 'Not authenticated.' }
  }

  // 3. Resolve role from DB — never from request body (Req 5.1)
  const role = await resolveUserRole(user.id)
  if (!role) {
    return { success: false, error: 'No role assigned to your account.' }
  }

  // 4. Enforce that the actor's role matches the approval stage (Req 5.2, 12.4)
  //    ADMIN bypasses this check to allow administrative override.
  const requiredRole = STAGE_ROLE_MAP[parsed.data.stage]
  if (role !== requiredRole && role !== 'ADMIN') {
    return {
      success: false,
      error: `The ${parsed.data.stage} approval stage requires a ${requiredRole} role. Your current role is ${role}.`,
    }
  }

  // 5. Call the PostgreSQL RPC (Req 12.2)
  //    The RPC performs the full atomic operation:
  //      - authenticate actor
  //      - load transaction with FOR UPDATE lock
  //      - verify prior stage is complete
  //      - enforce maker-checker (Req 5.4)
  //      - INSERT into approvals
  //      - UPDATE treasury_transactions status
  //      - INSERT into audit_events
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('approve_transaction', {
    p_transaction_id: transactionId,
    p_stage: parsed.data.stage,
    p_decision: parsed.data.decision,
    p_comments: parsed.data.comments ?? null,
  })

  if (error) {
    // Surface RPC-level errors (prior stage incomplete, maker-checker violation,
    // duplicate submission, etc.) directly to the caller.
    return { success: false, error: error.message }
  }

  // RPC returns { new_status, approval_id }
  const result = data as { new_status: string; approval_id: string }

  // 6. Revalidate caches so the workspace and list reflect the new status
  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')
  revalidatePath('/approvals')

  return {
    success: true,
    data: {
      newStatus: result.new_status,
      approvalId: result.approval_id,
    },
  }
}
