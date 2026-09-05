'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import {
  VoucherPreparationSchema,
  type VoucherPreparationInput,
  TX_TYPE_TO_VOUCHER_TYPE,
} from '@/lib/schemas/voucher.schema'
import type { ActionResult } from '@/lib/actions/transaction.actions'
import type { CalculationSnapshot } from '@/lib/services/calculation.service'

// ─── prepareVoucherAction ─────────────────────────────────────────────────────

/**
 * Prepares a treasury voucher at Step 5 of the workflow.
 *
 * Security: resolves caller role from DB — never trusts client-supplied role.
 * Enforces TREASURY_OFFICER only (Req 11.7, 5.3).
 *
 * Calculation flow (Req 26.4):
 *   1. Load the investment_verifications snapshot for the transaction.
 *   2. Dispatch to the appropriate calculation.service function based on
 *      the transaction's type — this calls a PostgreSQL NUMERIC RPC.
 *   3. Attach the resulting CalculationSnapshot to the voucher payload.
 *   4. Call prepare_voucher RPC with the snapshot so it is persisted in
 *      vouchers.calculation_snapshot (Req 26.5).
 *
 * The prepare_voucher RPC additionally:
 *   - Re-derives voucher_type from transaction_type (Req 11.1, 11.2)
 *   - Generates a unique voucher_number server-side (Req 11.7)
 *   - Transitions status → VOUCHER_PREPARED (Req 11.8)
 *   - Writes VOUCHER_CREATED audit event (Req 11.8)
 *
 * Requirements: 11.7, 11.8, 11.9, 26.4, 26.5, 5.1, 5.3
 */
export async function prepareVoucherAction(
  transactionId: string,
  input: VoucherPreparationInput,
): Promise<ActionResult<{ voucherId: string; voucherNumber: string }>> {
  // 1. Validate inputs with Zod
  const parsed = VoucherPreparationSchema.safeParse(input)
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

  // 4. Enforce TREASURY_OFFICER permission (Req 11.7)
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can prepare vouchers.',
    }
  }

  // 5. Load the transaction + investment snapshot from DB (Req 26.4)
  //    The snapshot is the authoritative source for all downstream calculations.
  const supabase = await createClient()

  const { data: txData, error: txError } = await supabase
    .from('treasury_transactions')
    .select(
      `
      id,
      transaction_type,
      scenario_code,
      investment_verifications (
        principal,
        accrued_interest,
        interest_rate,
        effective_date,
        maturity_date,
        outstanding_balance,
        available_amount
      )
    `,
    )
    .eq('id', transactionId)
    .single()

  if (txError || !txData) {
    return { success: false, error: 'Transaction not found or access denied.' }
  }

  // investment_verifications is a 1:1 relation — Supabase returns an object or null
  const investmentSnapshot = Array.isArray(txData.investment_verifications)
    ? txData.investment_verifications[0]
    : txData.investment_verifications

  if (!investmentSnapshot) {
    return {
      success: false,
      error: 'Investment verification snapshot not found. Complete Step 4 first.',
    }
  }

  const txType: string = txData.transaction_type
  const scenarioCode: string | null = txData.scenario_code ?? null

  // 6. Run server-authoritative calculation (Req 26.3, 26.4)
  //    Dynamically import to keep this module edge-compatible for SSR.
  let calculationSnapshot: CalculationSnapshot | null = null

  try {
    const {
      calculatePreLiquidation,
      calculateRollover,
      calculateThirdPartyCharge,
      calculateAnniversaryPayment,
      calculateMaturityTermination,
    } = await import('@/lib/services/calculation.service')

    switch (txType) {
      case 'PRE_LIQUIDATION': {
        const payout =
          parsed.data.voucherType === 'FUNDS_OUT'
            ? // requestedPayout may come from the voucher form for partial scenarios
              (parsed.data as Record<string, unknown>).requestedPayout as string | undefined
            : undefined

        calculationSnapshot = await calculatePreLiquidation(
          String(investmentSnapshot.accrued_interest),
          String(investmentSnapshot.principal),
          payout,
        )
        break
      }

      case 'MATURITY_TERMINATION': {
        calculationSnapshot = await calculateMaturityTermination(
          String(investmentSnapshot.principal),
          String(investmentSnapshot.accrued_interest),
        )
        break
      }

      case 'ANNIVERSARY_PAYMENT': {
        // Frequency days defaults to 30 unless overridden on the form
        const frequencyDays =
          ((parsed.data as Record<string, unknown>).frequencyDays as 30 | 60 | 90 | undefined) ??
          30

        calculationSnapshot = await calculateAnniversaryPayment(
          String(investmentSnapshot.principal),
          String(investmentSnapshot.interest_rate),
          frequencyDays,
        )
        break
      }

      case 'THIRD_PARTY_PAYMENT': {
        // isInternal: if scenario_code indicates internal or the voucher data sets it
        const isInternal =
          ((parsed.data as Record<string, unknown>).isInternal as boolean | undefined) ?? false

        calculationSnapshot = await calculateThirdPartyCharge(
          String(investmentSnapshot.available_amount),
          isInternal,
        )
        break
      }

      case 'ROLLOVER': {
        if (
          !scenarioCode ||
          !['P_AND_I', 'PRINCIPAL_ONLY', 'PARTIAL_PRINCIPAL', 'INTEREST_ONLY'].includes(
            scenarioCode,
          )
        ) {
          return {
            success: false,
            error: `Invalid or missing rollover scenario code: '${scenarioCode}'.`,
          }
        }

        type RolloverType = 'P_AND_I' | 'PRINCIPAL_ONLY' | 'PARTIAL_PRINCIPAL' | 'INTEREST_ONLY'

        const requestedPayout =
          parsed.data.voucherType === 'ROLLOVER_SLIP' && scenarioCode === 'PARTIAL_PRINCIPAL'
            ? // The ROLLOVER_SLIP form carries the payout amount in interestPayout for partial
              (parsed.data as Record<string, unknown>).interestPayout as string | undefined
            : undefined

        calculationSnapshot = await calculateRollover(
          scenarioCode as RolloverType,
          String(investmentSnapshot.principal),
          String(investmentSnapshot.accrued_interest),
          requestedPayout,
        )
        break
      }

      // INFLOW, INTERNAL_TRANSFER, REVERSAL, SAVINGS_FUNDS_OUT,
      // CALL_FUNDS_OUT, CMS_FUNDS_OUT — no calculation engine call required;
      // the RPC handles any internal arithmetic. Snapshot remains null.
      default:
        break
    }
  } catch (calcError) {
    const message =
      calcError instanceof Error ? calcError.message : 'Calculation failed. Please try again.'
    return { success: false, error: message }
  }

  // 7. Validate that the submitted voucherType matches the server-resolved type (Req 11.2)
  const expectedVoucherType = TX_TYPE_TO_VOUCHER_TYPE[txType]
  if (expectedVoucherType && parsed.data.voucherType !== expectedVoucherType) {
    return {
      success: false,
      error: `Voucher type mismatch: transaction type '${txType}' requires '${expectedVoucherType}', but '${parsed.data.voucherType}' was submitted.`,
    }
  }

  // 8. Build the voucher_data and payment_instruction JSONB payloads
  const { voucherType, ...voucherFields } = parsed.data

  // Extract payment instruction from fields if present
  const paymentInstruction =
    'paymentInstruction' in voucherFields
      ? (voucherFields as Record<string, unknown>).paymentInstruction
      : null

  // Remove paymentInstruction from the voucher_data payload — it goes as a separate param
  const voucherData: Record<string, unknown> = { ...voucherFields }
  delete voucherData.paymentInstruction

  // Attach the calculation snapshot so the RPC can persist it in
  // vouchers.calculation_snapshot (Req 26.5)
  if (calculationSnapshot !== null) {
    voucherData.calculation_snapshot = calculationSnapshot
  }

  // 9. Call the PostgreSQL RPC (Req 11.7)
  const { data, error } = await supabase.rpc('prepare_voucher', {
    p_transaction_id: transactionId,
    p_voucher_data: JSON.stringify(voucherData),
    p_payment_instruction: paymentInstruction ? JSON.stringify(paymentInstruction) : null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns { voucher_id, voucher_number }
  const result = data as { voucher_id: string; voucher_number: string }

  // 10. For ROLLOVER transactions, persist the rollover_details row (Req 17.2, 17.6)
  if (txType === 'ROLLOVER' && scenarioCode && calculationSnapshot !== null) {
    const rolloverCalc = calculationSnapshot as import('@/lib/services/calculation.service').RolloverResult

    const rolloverInput =
      parsed.data.voucherType === 'ROLLOVER_SLIP'
        ? (parsed.data as import('@/lib/schemas/voucher.schema').RolloverSlipVoucherInput)
        : null

    if (rolloverInput) {
      await supabase.from('rollover_details').upsert(
        {
          transaction_id: transactionId,
          rollover_type: scenarioCode,
          original_principal: String(investmentSnapshot.principal),
          interest_due: String(investmentSnapshot.accrued_interest),
          principal_rolled:
            scenarioCode === 'P_AND_I' ? rolloverCalc.rolloverAmount : null,
          interest_paid: rolloverCalc.interestPaid ?? null,
          new_rate: rolloverInput.newRate,
          new_tenor: rolloverInput.newTenor,
          new_effective_date: rolloverInput.effectiveDate,
          new_maturity_date: rolloverInput.rolloverMaturityDate,
          new_rollover_amount: rolloverCalc.rolloverAmount,
        },
        { onConflict: 'transaction_id' },
      )
    }
  }

  // 11. Revalidate caches
  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')

  return {
    success: true,
    data: {
      voucherId: result.voucher_id,
      voucherNumber: result.voucher_number,
    },
  }
}
