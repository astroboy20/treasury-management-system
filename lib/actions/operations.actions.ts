'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import type { ActionResult } from '@/lib/actions/transaction.actions'

// ─── ExecutionInput ───────────────────────────────────────────────────────────

export interface ExecutionInput {
  executionStatus: 'SUCCESS' | 'FAILED' | 'PARTIAL'
  externalReference?: string
  executionNotes?: string
}

// ─── executeTransactionAction ─────────────────────────────────────────────────

/**
 * Records Operations execution of an MD-approved transaction.
 *
 * Security: resolves caller role from DB — never trusts client-supplied role.
 * Enforces OPERATIONS role only (Req 14.5, 5.3).
 *
 * State machine:
 *   Delegates to the execute_transaction RPC which atomically:
 *     - Validates MD_APPROVED status (Req 14.5)
 *     - Inserts operations_executions row (idempotent via unique constraint — Req 14.6)
 *     - Transitions status → OPERATIONS_PROCESSING → OPERATIONS_COMPLETED (Req 14.4)
 *     - Writes OPERATIONS_STARTED + OPERATIONS_COMPLETED audit events (Req 14.4)
 *
 * Rollover post-execution (Req 17.7):
 *   After the RPC succeeds, if the transaction type is ROLLOVER, the function
 *   reads the rollover_details row and calls eazybankzAdapter.createInvestment()
 *   to book the new rolled investment in the mirror system.
 *
 * Requirements: 14.3, 14.4, 14.5, 14.6, 17.7, 5.1, 5.3
 */
export async function executeTransactionAction(
  transactionId: string,
  input: ExecutionInput,
): Promise<ActionResult<{ executionId: string }>> {
  // 1. Basic input validation
  if (!transactionId || typeof transactionId !== 'string') {
    return { success: false, error: 'Invalid transaction ID.' }
  }

  const validStatuses = ['SUCCESS', 'FAILED', 'PARTIAL'] as const
  if (!validStatuses.includes(input.executionStatus)) {
    return { success: false, error: 'Invalid execution status.' }
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

  // 4. Enforce OPERATIONS permission (Req 14.5)
  if (role !== 'OPERATIONS' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only an Operations Officer can execute transactions.',
    }
  }

  // 5. Call the PostgreSQL RPC (Req 14.4)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('execute_transaction', {
    p_transaction_id: transactionId,
    p_execution_status: input.executionStatus,
    p_external_reference: input.externalReference ?? null,
    p_execution_notes: input.executionNotes ?? null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const result = data as { execution_id: string; new_status?: string; idempotent?: boolean }

  // 6. Post-execution Eazybankz adapter calls (Req 18.3, 17.7)
  //    Only run for SUCCESS executions to avoid side-effects on failed/partial runs.
  if (input.executionStatus === 'SUCCESS') {
    // Load the transaction to check its type and related data
    const { data: txData } = await supabase
      .from('treasury_transactions')
      .select('transaction_type, customer_id, investment_id')
      .eq('id', transactionId)
      .single()

    if (txData) {
      try {
        const { eazybankzAdapter } = await import('@/lib/services/eazybankz')

        switch (txData.transaction_type) {

          // ── ROLLOVER: book the new rolled investment (Req 17.7) ───────────
          case 'ROLLOVER': {
            const { data: rolloverDetails } = await supabase
              .from('rollover_details')
              .select('*')
              .eq('transaction_id', transactionId)
              .single()

            if (rolloverDetails) {
              await eazybankzAdapter.createInvestment({
                customerId: txData.customer_id,
                principal: String(rolloverDetails.new_rollover_amount),
                interestRate: String(rolloverDetails.new_rate),
                tenorDays: rolloverDetails.new_tenor,
                effectiveDate: rolloverDetails.new_effective_date,
                maturityDate: rolloverDetails.new_maturity_date,
                productType: 'FIXED_DEPOSIT',
                sourceTransactionId: transactionId,
              })
            }
            break
          }

          // ── MATURITY_TERMINATION: mark investment as TERMINATED (Req 18.3) ─
          case 'MATURITY_TERMINATION': {
            if (txData.investment_id) {
              // Resolve the external_reference for the investment
              const { data: investment } = await supabase
                .from('investments')
                .select('external_reference')
                .eq('id', txData.investment_id)
                .maybeSingle()

              if (investment?.external_reference) {
                await eazybankzAdapter.updateInvestment(investment.external_reference, {
                  status: 'TERMINATED',
                  sourceTransactionId: transactionId,
                })
              }
            }
            break
          }

          // ── PRE_LIQUIDATION (partial): rebook remaining principal (Req 19.5) ─
          //    For full pre-liquidation the investment is simply terminated.
          //    For partial pre-liquidation the remaining principal is rebooked:
          //    rebooked_principal = remaining_principal − charge.
          //    The pre_liquidation_details row holds both values (Req 19.3).
          case 'PRE_LIQUIDATION': {
            if (txData.investment_id) {
              const { data: investment } = await supabase
                .from('investments')
                .select('external_reference')
                .eq('id', txData.investment_id)
                .maybeSingle()

              if (investment?.external_reference) {
                // Load pre_liquidation_details to check if this is a partial pre-liquidation
                const { data: preLiqDetails } = await supabase
                  .from('pre_liquidation_details')
                  .select('requested_payout, rebooked_principal, remaining_principal')
                  .eq('transaction_id', transactionId)
                  .maybeSingle()

                if (preLiqDetails?.rebooked_principal && preLiqDetails?.requested_payout) {
                  // Partial pre-liquidation: rebook the remaining investment (Req 19.5)
                  await eazybankzAdapter.updateInvestment(investment.external_reference, {
                    outstandingBalance: String(preLiqDetails.rebooked_principal),
                    availableAmount: String(preLiqDetails.rebooked_principal),
                    sourceTransactionId: transactionId,
                  })
                } else {
                  // Full pre-liquidation: terminate the investment entirely
                  await eazybankzAdapter.updateInvestment(investment.external_reference, {
                    status: 'TERMINATED',
                    sourceTransactionId: transactionId,
                  })
                }
              }
            }
            break
          }

          // ── ANNIVERSARY_PAYMENT: reset accrued interest, principal stays ACTIVE (Req 20.4) ─
          case 'ANNIVERSARY_PAYMENT': {
            if (txData.investment_id) {
              const { data: investment } = await supabase
                .from('investments')
                .select('external_reference')
                .eq('id', txData.investment_id)
                .maybeSingle()

              if (investment?.external_reference) {
                // Record interest payment: accrued_interest resets to 0.
                // The investment status remains ACTIVE — principal is NOT terminated (Req 20.4).
                await eazybankzAdapter.updateInvestment(investment.external_reference, {
                  accruedInterest: '0',
                  sourceTransactionId: transactionId,
                })
              }
            }
            break
          }

          default:
            // Other transaction types are handled in later phases (4.5).
            break
        }
      } catch (adapterError) {
        // Log but don't fail the execution — the Eazybankz call is best-effort
        // in Phase 1–5; Phase 6 adds retry/compensation logic (Req 30.5).
        console.error(
          '[executeTransactionAction] Eazybankz adapter call failed:',
          adapterError instanceof Error ? adapterError.message : adapterError,
        )
      }
    }
  }

  // 7. Revalidate caches
  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')
  revalidatePath('/approvals')

  return {
    success: true,
    data: {
      executionId: result.execution_id,
    },
  }
}

// ─── confirmTreasuryCompletionAction ──────────────────────────────────────────

/**
 * Treasury Officer confirms that Operations has fully completed the transaction.
 *
 * Security: resolves caller role from DB (Req 5.1); enforces TREASURY_OFFICER (Req 15.4).
 *
 * State machine:
 *   Calls confirm_treasury_completion RPC which transitions
 *   OPERATIONS_COMPLETED → COMPLETED (Req 15.2).
 *
 * Requirements: 15.2, 15.3, 15.4, 5.1, 5.3
 */
export async function confirmTreasuryCompletionAction(
  transactionId: string,
): Promise<ActionResult<{ newStatus: string }>> {
  if (!transactionId || typeof transactionId !== 'string') {
    return { success: false, error: 'Invalid transaction ID.' }
  }

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
      error: 'Only a Treasury Officer can confirm transaction completion.',
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('confirm_treasury_completion', {
    p_transaction_id: transactionId,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const result = data as { new_status: string }

  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')

  return {
    success: true,
    data: {
      newStatus: result.new_status,
    },
  }
}
