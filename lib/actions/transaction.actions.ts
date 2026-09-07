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

  // Map payment instruction to snake_case keys expected by the RPC (Req 7.7, 21.1)
  const paymentInstructionRpc = parsed.data.paymentInstruction
    ? JSON.stringify({
        beneficiary_name: parsed.data.paymentInstruction.beneficiaryName,
        bank_name: parsed.data.paymentInstruction.bankName,
        account_number: parsed.data.paymentInstruction.accountNumber,
        account_type: parsed.data.paymentInstruction.accountType,
        purpose: parsed.data.paymentInstruction.purpose ?? null,
        // is_internal defaults to false for THIRD_PARTY_PAYMENT (Req 21.1)
        is_internal: parsed.data.paymentInstruction.isInternal === true,
        // amount and transfer_charge will be set at voucher preparation stage (Req 21.2)
        amount: null,
        transfer_charge: null,
      })
    : null

  const { data, error } = await supabase.rpc('create_treasury_transaction', {
    p_customer_id: parsed.data.customerId,
    p_investment_id: parsed.data.investmentId ?? null,
    p_transaction_type: parsed.data.transactionType,
    p_scenario_code: parsed.data.scenarioCode ?? null,
    p_requested_amount: parsed.data.requestedAmount,
    p_purpose: parsed.data.purpose,
    p_source_type: parsed.data.sourceInstructionType,
    p_payment_instruction: paymentInstructionRpc,
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

// ─── createReversalAction ─────────────────────────────────────────────────────

/**
 * Creates a new REVERSAL transaction referencing an original completed transaction.
 *
 * Security: resolves caller role from DB — never trusts client-supplied role.
 * Requirement 25.1: the original transaction is NOT deleted or overwritten.
 * Requirement 25.2: reversal reason is required.
 * Requirement 25.5: validates the original is eligible (not DRAFT, CANCELLED, or already reversed).
 *
 * Delegates to create_reversal RPC which atomically:
 *   - Validates actor role (TREASURY_OFFICER)
 *   - Validates the original transaction eligibility
 *   - Checks no active reversal already exists (Req 25.5)
 *   - Creates the REVERSAL transaction with INSTRUCTION_RECEIVED status
 *   - Writes REVERSAL_CREATED audit events on both transactions (Req 25.4)
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 5.1, 5.3
 */
export async function createReversalAction(input: {
  originalTransactionId: string
  reversalReason: string
}): Promise<ActionResult<{ transactionId: string; reference: string }>> {
  // 1. Validate inputs
  if (!input.originalTransactionId || typeof input.originalTransactionId !== 'string') {
    return { success: false, error: 'Original transaction ID is required.' }
  }
  if (!input.reversalReason || input.reversalReason.trim() === '') {
    return { success: false, error: 'Reversal reason is required.' }
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

  // 4. Enforce TREASURY_OFFICER permission
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can create reversal transactions.',
    }
  }

  // 5. Call the create_reversal RPC
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_reversal', {
    p_original_transaction_id: input.originalTransactionId,
    p_reversal_reason: input.reversalReason.trim(),
  })

  if (error) {
    // Surface user-friendly messages for known error cases
    if (error.message?.includes('DUPLICATE')) {
      return { success: false, error: 'A reversal already exists for this transaction.' }
    }
    if (error.message?.includes('INVALID_STATE')) {
      return {
        success: false,
        error: 'This transaction is not eligible for reversal (DRAFT or CANCELLED).',
      }
    }
    if (error.message?.includes('NOT_FOUND')) {
      return { success: false, error: 'Original transaction not found.' }
    }
    return { success: false, error: error.message }
  }

  const result = data as {
    reversal_transaction_id: string
    reversal_reference: string
    status: string
  }

  // 6. Revalidate caches
  revalidatePath('/transactions')
  revalidatePath(`/transactions/${input.originalTransactionId}`)

  return {
    success: true,
    data: {
      transactionId: result.reversal_transaction_id,
      reference: result.reversal_reference,
    },
  }
}

// ─── searchTransactionsByReferenceAction ──────────────────────────────────────

/**
 * Searches transactions by reference prefix for the reversal creation form combobox.
 * Returns a lightweight list of matching transactions suitable for display.
 *
 * Only returns transactions in states that are eligible for reversal
 * (excludes DRAFT and CANCELLED per Req 25.5; also excludes transactions
 * that already have an active reversal).
 *
 * Requirements: 25.5, 22.4
 */
export async function searchTransactionsByReferenceAction(
  query: string,
): Promise<
  ActionResult<
    Array<{
      id: string
      transaction_reference: string
      transaction_type: string
      status: string
      requested_amount: string
      customer_name: string | null
    }>
  >
> {
  if (!query || query.trim().length < 2) {
    return { success: true, data: [] }
  }

  const user = await getAuthenticatedUser()
  if (!user) {
    return { success: false, error: 'Not authenticated.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('treasury_transactions')
    .select(
      `id, transaction_reference, transaction_type, status, requested_amount,
       customers ( name )`,
    )
    .ilike('transaction_reference', `${query.trim()}%`)
    .not('status', 'in', '("DRAFT","CANCELLED")')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return { success: false, error: error.message }
  }

  // Filter out transactions that already have an active (non-rejected/non-cancelled) reversal
  const txIds = (data ?? []).map((t) => (t as Record<string, unknown>).id as string)

  let alreadyReversedIds = new Set<string>()
  if (txIds.length > 0) {
    const { data: reversals } = await supabase
      .from('treasury_transactions')
      .select('original_transaction_id')
      .eq('transaction_type', 'REVERSAL')
      .not('status', 'in', '("REJECTED","CANCELLED")')
      .in('original_transaction_id', txIds)

    alreadyReversedIds = new Set(
      (reversals ?? []).map(
        (r) => (r as Record<string, unknown>).original_transaction_id as string,
      ),
    )
  }

  const results = (data ?? [])
    .filter((t) => !alreadyReversedIds.has((t as Record<string, unknown>).id as string))
    .map((t) => {
      const row = t as Record<string, unknown>
      const customer = row.customers as { name: string } | null
      return {
        id: row.id as string,
        transaction_reference: row.transaction_reference as string,
        transaction_type: row.transaction_type as string,
        status: row.status as string,
        requested_amount: row.requested_amount as string,
        customer_name: customer?.name ?? null,
      }
    })

  return { success: true, data: results }
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
