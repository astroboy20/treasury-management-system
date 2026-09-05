'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import {
  CreateTransactionSchema,
  type CreateTransactionInput,
} from '@/lib/schemas/transaction.schema'

// ─── Result type ─────────────────────────────────────────────────────────────

export interface ActionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ─── createTransactionAction ─────────────────────────────────────────────────

/**
 * Creates a new treasury transaction.
 *
 * Security: resolves caller role from DB — never trusts client-supplied role.
 * State machine: delegates to the create_treasury_transaction RPC which
 * atomically inserts the row, generates TRX-XXXXX reference, and writes the
 * TRANSACTION_CREATED audit event.
 *
 * Requirements: 7.1–7.7, 5.1, 5.3
 */
export async function createTransactionAction(
  input: CreateTransactionInput,
): Promise<ActionResult<{ transactionId: string; reference: string }>> {
  // 1. Validate inputs with Zod
  const parsed = CreateTransactionSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Invalid input.'
    return { success: false, error: firstError }
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

  // 4. Enforce TREASURY_OFFICER permission (Req 7.3)
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can create transactions.',
    }
  }

  // 5. Call the PostgreSQL RPC (Req 7.3)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_treasury_transaction', {
    p_customer_id: parsed.data.customerId,
    p_investment_id: parsed.data.investmentId ?? null,
    p_transaction_type: parsed.data.transactionType,
    p_scenario_code: parsed.data.scenarioCode ?? null,
    p_requested_amount: parsed.data.requestedAmount,
    p_purpose: parsed.data.purpose,
    p_source_type: parsed.data.sourceInstructionType,
    p_payment_instruction: parsed.data.paymentInstruction
      ? JSON.stringify(parsed.data.paymentInstruction)
      : null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns { transaction_id, transaction_reference, status }
  const result = data as { transaction_id: string; transaction_reference: string; status: string }

  // 6. Revalidate transaction list cache
  revalidatePath('/transactions')

  return {
    success: true,
    data: {
      transactionId: result.transaction_id,
      reference: result.transaction_reference,
    },
  }
}

// ─── getTransactionWorkspaceAction ───────────────────────────────────────────

/**
 * Loads the full transaction workspace data for /transactions/[id].
 * Requirements: 7.6, 5.1
 */
export async function getTransactionWorkspaceAction(transactionId: string) {
  const user = await getAuthenticatedUser()
  if (!user) return { success: false as const, error: 'Not authenticated.' }

  const { getTransactionWorkspace } = await import('@/lib/services/transaction.service')
  const workspace = await getTransactionWorkspace(transactionId)
  if (!workspace) return { success: false as const, error: 'Transaction not found.' }

  return { success: true as const, data: workspace }
}
