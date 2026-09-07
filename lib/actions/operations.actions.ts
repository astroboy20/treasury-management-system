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
      .select('transaction_type, customer_id, investment_id, scenario_code')
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

          // ── REVERSAL: reverse the original Eazybankz posting (Req 25.3) ─────
          //    Load the original transaction's investment external_reference and
          //    call reverseTransaction() on the mock/real adapter.
          case 'REVERSAL': {
            // Load the reversal transaction's original_transaction_id
            const { data: reversalTx } = await supabase
              .from('treasury_transactions')
              .select('original_transaction_id, purpose')
              .eq('id', transactionId)
              .single()

            if (reversalTx?.original_transaction_id) {
              // Load the original transaction's linked investment
              const { data: originalTx } = await supabase
                .from('treasury_transactions')
                .select('investment_id, purpose')
                .eq('id', reversalTx.original_transaction_id)
                .single()

              if (originalTx?.investment_id) {
                const { data: investment } = await supabase
                  .from('investments')
                  .select('external_reference')
                  .eq('id', originalTx.investment_id)
                  .maybeSingle()

                if (investment?.external_reference) {
                  await eazybankzAdapter.reverseTransaction(
                    investment.external_reference,
                    (reversalTx.purpose as string | null) ?? 'Reversal',
                  )
                }
              }
            }
            break
          }

          // ── INFLOW: book the new investment in Eazybankz mirror (Req 23.2) ────────
          //    INFLOW creates a brand-new investment. The voucher snapshot holds all
          //    fields (amount, rate, tenor, effectiveDate, maturityDate) captured at
          //    Step 5. On successful execution, the new investment is written to the
          //    mirror so Treasury can verify it exists before confirming COMPLETED (Req 23.3).
          case 'INFLOW': {
            // Load the FUNDS_IN voucher to get the investment details entered at Step 5
            const { data: inflowVoucher } = await supabase
              .from('vouchers')
              .select('calculation_snapshot, net_amount, transfer_date')
              .eq('transaction_id', transactionId)
              .maybeSingle()

            if (inflowVoucher) {
              const snap = inflowVoucher.calculation_snapshot as Record<string, unknown> | null
              const inputs = snap?.inputs as Record<string, string> | undefined

              if (inputs) {
                const externalRef = await eazybankzAdapter.createInvestment({
                  customerId: txData.customer_id,
                  principal: inputs.amount ?? String(inflowVoucher.net_amount ?? '0'),
                  interestRate: inputs.rate ?? '0',
                  tenorDays: parseInt(inputs.tenor ?? '0', 10),
                  effectiveDate:
                    inputs.effective_date ??
                    (inflowVoucher.transfer_date as string | null) ??
                    new Date().toISOString().slice(0, 10),
                  maturityDate:
                    inputs.maturity_date ??
                    new Date().toISOString().slice(0, 10),
                  productType: 'FIXED_DEPOSIT',
                  sourceTransactionId: transactionId,
                })

                // Store the new external_reference on the investments table so
                // confirmTreasuryCompletionAction can verify it via the adapter (Req 23.3).
                // We upsert a new investments row linked to this customer with the
                // Eazybankz-assigned reference.
                await supabase.from('investments').update({
                  external_reference: externalRef.externalReference,
                  status: 'ACTIVE',
                }).eq('id', txData.investment_id ?? '').then(() => {
                  // If no existing investment_id, the new row was created by createInvestment()
                  // (mock adapter inserts the row already). Nothing further to do.
                })
              }
            }
            break
          }

          // ── INTERNAL_TRANSFER: book destination investment for applicable scenarios ─
          //    PERSONAL_TO_COMMERCIAL_PAPER → createInvestment (Req 22.3)
          //    PERSONAL_TO_CALL_PLACEMENT   → createInvestment (Req 22.3)
          //    SAVINGS_TO_PERSONAL          → pure account transfer; no new investment to book
          case 'INTERNAL_TRANSFER': {
            const scenarioCode = (txData as { scenario_code?: string | null }).scenario_code ?? null

            if (
              scenarioCode === 'PERSONAL_TO_COMMERCIAL_PAPER' ||
              scenarioCode === 'PERSONAL_TO_CALL_PLACEMENT'
            ) {
              // Load the voucher to get the transfer amount and related details
              const { data: voucher } = await supabase
                .from('vouchers')
                .select('net_amount, transfer_date')
                .eq('transaction_id', transactionId)
                .maybeSingle()

              if (voucher) {
                const productType =
                  scenarioCode === 'PERSONAL_TO_COMMERCIAL_PAPER'
                    ? 'COMMERCIAL_PAPER'
                    : 'CALL'

                await eazybankzAdapter.createInvestment({
                  customerId: txData.customer_id,
                  principal: String(voucher.net_amount),
                  interestRate: '0',        // Rate is set when the investment is formally booked
                  tenorDays: 0,             // Open-ended for CALL; set at formal booking for CP
                  effectiveDate: (voucher.transfer_date as string | null) ?? new Date().toISOString().slice(0, 10),
                  maturityDate: (voucher.transfer_date as string | null) ?? new Date().toISOString().slice(0, 10),
                  productType,
                  sourceTransactionId: transactionId,
                })
              }
            }
            // SAVINGS_TO_PERSONAL: no new investment to book — pure account transfer
            break
          }

          // ── SAVINGS_FUNDS_OUT / CALL_FUNDS_OUT / CMS_FUNDS_OUT:
          //    update balance after withdrawal (Req 24.3, 38.1) ─────────────
          //    All three types share the same execution logic: record the payment
          //    and update the account balance in the Eazybankz mirror.
          //    available_balance is sourced from the investment_verifications snapshot
          //    (not recalculated — Req 38.4).  The new balance = snapshot_balance minus
          //    the withdrawal amount (requested_amount on the transaction).
          case 'SAVINGS_FUNDS_OUT':
          case 'CALL_FUNDS_OUT':
          case 'CMS_FUNDS_OUT': {
            if (txData.investment_id) {
              const { data: investment } = await supabase
                .from('investments')
                .select('external_reference, available_amount')
                .eq('id', txData.investment_id)
                .maybeSingle()

              if (investment?.external_reference) {
                // Load the investment_verifications snapshot to get confirmed available_balance
                const { data: invVerification } = await supabase
                  .from('investment_verifications')
                  .select('available_amount')
                  .eq('transaction_id', transactionId)
                  .maybeSingle()

                // Load the transaction's requested_amount (the withdrawal amount)
                const { data: txForAmount } = await supabase
                  .from('treasury_transactions')
                  .select('requested_amount')
                  .eq('id', transactionId)
                  .single()

                const snapshotBalance = invVerification?.available_amount
                  ? Number(invVerification.available_amount)
                  : Number(investment.available_amount ?? 0)
                const withdrawalAmount = Number(txForAmount?.requested_amount ?? 0)
                const newBalance = Math.max(0, snapshotBalance - withdrawalAmount)

                // Update the investment record with the new balance after the withdrawal (Req 24.3)
                await eazybankzAdapter.updateInvestment(investment.external_reference, {
                  availableAmount: String(newBalance.toFixed(4)),
                  outstandingBalance: String(newBalance.toFixed(4)),
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

  // Req 23.3: For INFLOW transactions, verify the new investment was successfully created
  // in the Eazybankz mirror before marking the transaction COMPLETED.
  // The mock adapter stores the investment in the local `investments` table;
  // we use the adapter's getInvestment() to confirm it exists.
  const { data: txCheck } = await supabase
    .from('treasury_transactions')
    .select('transaction_type, investment_id')
    .eq('id', transactionId)
    .single()

  if (txCheck?.transaction_type === 'INFLOW') {
    // For INFLOW the mock adapter writes a new investments row with an EZ-INV-* reference.
    // Look up the most recent investment created by this transaction's execution
    // (identified by source_transaction_id stored in the mock's external_reference prefix).
    const sourcePrefix = `EZ-INV-${transactionId.slice(0, 8).toUpperCase()}`
    const { data: newInvestment } = await supabase
      .from('investments')
      .select('external_reference, status')
      .ilike('external_reference', `${sourcePrefix}%`)
      .maybeSingle()

    if (!newInvestment) {
      // As a secondary check, attempt via the adapter directly if we have an investment_id
      let verifiedViaAdapter = false
      if (txCheck.investment_id) {
        const { data: invRecord } = await supabase
          .from('investments')
          .select('external_reference')
          .eq('id', txCheck.investment_id)
          .maybeSingle()

        if (invRecord?.external_reference) {
          const { eazybankzAdapter } = await import('@/lib/services/eazybankz')
          const adapterInvestment = await eazybankzAdapter.getInvestment(invRecord.external_reference)
          verifiedViaAdapter = adapterInvestment !== null
        }
      }

      if (!verifiedViaAdapter) {
        return {
          success: false,
          error:
            'Cannot confirm completion: the new investment record was not found in the Eazybankz mirror. ' +
            'Verify that Operations execution completed successfully and the investment was booked. (Req 23.3)',
        }
      }
    }
    // Investment exists — proceed to completion confirmation
  }

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
