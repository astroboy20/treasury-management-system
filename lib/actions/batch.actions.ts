'use server'

import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { createTransactionAction } from '@/lib/actions/transaction.actions'
import type { CreateTransactionInput } from '@/lib/schemas/transaction.schema'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchRowResult {
  /** 0-based index of the row in the submitted batch */
  index: number
  success: boolean
  transactionId?: string
  reference?: string
  error?: string
}

export interface BatchCreateResult {
  results: BatchRowResult[]
  successCount: number
  failCount: number
}

// ─── createTransactionBatchAction ─────────────────────────────────────────────

/**
 * Creates up to 10 treasury transactions in a single server action call.
 *
 * Each row is validated and submitted independently via the existing
 * createTransactionAction. Partial failures are allowed — a failed row
 * does not prevent the rest from being created. The caller receives a
 * per-row result array so the UI can highlight exactly which rows failed.
 *
 * Max rows: 10 (enforced server-side — clients must not exceed this).
 * Role: TREASURY_OFFICER or ADMIN only (same as single creation).
 */
export async function createTransactionBatchAction(
  rows: CreateTransactionInput[],
): Promise<{ success: boolean; data?: BatchCreateResult; error?: string }> {
  // Auth gate — check once before looping
  const user = await getAuthenticatedUser()
  if (!user) {
    return { success: false, error: 'Not authenticated.' }
  }

  const role = await resolveUserRole(user.id)
  if (!role) {
    return { success: false, error: 'No role assigned to your account.' }
  }

  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can create transactions.',
    }
  }

  // Enforce max batch size server-side
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, error: 'Batch must contain at least one transaction.' }
  }
  if (rows.length > 10) {
    return { success: false, error: 'Batch cannot exceed 10 transactions.' }
  }

  // Process each row sequentially — avoids overwhelming the DB connection
  // pool and keeps audit events in chronological order.
  const results: BatchRowResult[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const result = await createTransactionAction(row)
      if (result.success && result.data) {
        results.push({
          index: i,
          success: true,
          transactionId: result.data.transactionId,
          reference: result.data.reference,
        })
      } else {
        results.push({
          index: i,
          success: false,
          error: result.error ?? 'Unknown error.',
        })
      }
    } catch (err) {
      results.push({
        index: i,
        success: false,
        error: err instanceof Error ? err.message : 'Unexpected error.',
      })
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length

  return {
    success: true,
    data: { results, successCount, failCount },
  }
}
