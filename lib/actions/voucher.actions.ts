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
import type { CalculationSnapshot, RolloverResult } from '@/lib/services/calculation.service'

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
      requested_amount,
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

  // 5b. For THIRD_PARTY_PAYMENT: look up payment_instructions row to resolve isInternal.
  //     Do this before the calculation switch so the result is available in step 8.
  let thirdPartyIsInternal = false
  let thirdPartyPiRow: { is_internal: boolean } | null = null
  if (txType === 'THIRD_PARTY_PAYMENT') {
    const { data: piLookup } = await supabase
      .from('payment_instructions')
      .select('is_internal')
      .eq('transaction_id', transactionId)
      .maybeSingle()
    thirdPartyPiRow = piLookup
    if (piLookup !== null && piLookup !== undefined) {
      thirdPartyIsInternal = piLookup.is_internal === true
    } else if (parsed.data.voucherType === 'FUNDS_OUT') {
      thirdPartyIsInternal =
        ((parsed.data as Record<string, unknown>).isInternal as boolean | undefined) ?? false
    }
  }

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
        // Frequency days derived from scenario_code (ANNIVERSARY_30/60/90).
        // Req 20.1: only 30, 60, 90 are valid — reject any other value.
        const scenarioToFrequency: Record<string, 30 | 60 | 90> = {
          ANNIVERSARY_30: 30,
          ANNIVERSARY_60: 60,
          ANNIVERSARY_90: 90,
        }

        if (!scenarioCode || !(scenarioCode in scenarioToFrequency)) {
          return {
            success: false,
            error:
              `Invalid anniversary scenario code: '${scenarioCode ?? 'none'}'. ` +
              'Only ANNIVERSARY_30, ANNIVERSARY_60, and ANNIVERSARY_90 are accepted (Req 20.1).',
          }
        }

        const frequencyDays: 30 | 60 | 90 = scenarioToFrequency[scenarioCode]

        calculationSnapshot = await calculateAnniversaryPayment(
          String(investmentSnapshot.principal),
          String(investmentSnapshot.interest_rate),
          frequencyDays,
        )
        break
      }

      case 'THIRD_PARTY_PAYMENT': {
        // isInternal is already resolved above (thirdPartyIsInternal).
        // Transfer amount = the transaction's requested_amount (Req 21.2, 21.4).
        const transferAmount = String(txData.requested_amount ?? investmentSnapshot.available_amount)
        calculationSnapshot = await calculateThirdPartyCharge(transferAmount, thirdPartyIsInternal)
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
            ? // The ROLLOVER_SLIP form carries the payout amount in requestedPayout for PARTIAL_PRINCIPAL (Req 17.4)
              (parsed.data as import('@/lib/schemas/voucher.schema').RolloverSlipVoucherInput).requestedPayout
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

  // Remove transient client-only fields from the voucher_data payload
  const voucherData: Record<string, unknown> = { ...voucherFields }
  delete voucherData.paymentInstruction
  delete voucherData.isInternal
  delete voucherData.transactionTypeHint

  // Attach the calculation snapshot so the RPC can persist it in
  // vouchers.calculation_snapshot (Req 26.5)
  if (calculationSnapshot !== null) {
    voucherData.calculation_snapshot = calculationSnapshot
  }

  // 8a. For THIRD_PARTY_PAYMENT external transfers: validate all 6 PI fields
  //     (Req 36.2, 21.4) — server-side re-enforcement beyond Zod schema.
  if (txType === 'THIRD_PARTY_PAYMENT') {
    const piData = paymentInstruction as Record<string, unknown> | null
    // Determine isExternal from the DB-resolved flag
    const isExternalTransfer = !thirdPartyIsInternal

    if (isExternalTransfer) {
      const missingFields: string[] = []
      if (!piData?.beneficiaryName) missingFields.push('Beneficiary Name')
      if (!piData?.bankName) missingFields.push('Bank Name')
      if (!piData?.accountNumber) missingFields.push('Account Number')
      if (!piData?.accountType) missingFields.push('Account Type')
      if (!piData?.amount) missingFields.push('Amount')
      if (piData?.transferCharge === undefined || piData?.transferCharge === null || piData?.transferCharge === '') {
        missingFields.push('Transfer Charge')
      }

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `External third-party payment requires all Payment Instruction fields. Missing: ${missingFields.join(', ')}. (Req 36.2)`,
        }
      }
    }

    // 8b. Attach server-authoritative transfer charge to the payment instruction (Req 21.2).
    //     The calculation snapshot holds the canonical charge value; override whatever the
    //     client submitted so the persisted PI block always reflects the server calculation.
    if (calculationSnapshot !== null && paymentInstruction) {
      const serverCharge = calculationSnapshot.outputs.transfer_charge
      const piWithCharge: Record<string, unknown> = {
        ...(paymentInstruction as Record<string, unknown>),
        transferCharge: serverCharge,
        transfer_charge: serverCharge,
      }
      // Replace the paymentInstruction so the RPC call below uses the corrected value
      ;(voucherFields as Record<string, unknown>).paymentInstruction = piWithCharge
    }
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

  // 10. For PRE_LIQUIDATION transactions, persist the pre_liquidation_details row (Req 19.3)
  //     The calculation snapshot holds the authoritative values computed by the RPC.
  if (txType === 'PRE_LIQUIDATION' && calculationSnapshot !== null) {
    const preLiqCalc = calculationSnapshot as import('@/lib/services/calculation.service').PreLiquidationResult

    await supabase.from('pre_liquidation_details').upsert(
      {
        transaction_id:      transactionId,
        original_principal:  String(investmentSnapshot.principal),
        accrued_interest:    String(investmentSnapshot.accrued_interest),
        charge_rate:         '0.20',                // always 20% for PRE_LIQUIDATION (Req 19.3)
        charge_amount:       preLiqCalc.charge,
        net_interest:        preLiqCalc.netInterest,
        // Partial pre-liquidation fields — only present when requestedPayout was supplied
        requested_payout:    preLiqCalc.outputs?.requested_payout ?? null,
        remaining_principal: preLiqCalc.remainingPrincipal ?? null,
        rebooked_principal:  preLiqCalc.rebookedPrincipal ?? null,
      },
      { onConflict: 'transaction_id' },
    )
  }

  // 11. For ROLLOVER transactions, persist the rollover_details row (Req 17.2, 17.3, 17.6)
  if (txType === 'ROLLOVER' && scenarioCode && calculationSnapshot !== null) {
    const rolloverCalc = calculationSnapshot as RolloverResult

    const rolloverInput =
      parsed.data.voucherType === 'ROLLOVER_SLIP'
        ? (parsed.data as import('@/lib/schemas/voucher.schema').RolloverSlipVoucherInput)
        : null

    if (rolloverInput) {
      // For PRINCIPAL_ONLY:    principal_rolled = principal; interest_paid = interest_due
      // For P_AND_I:           principal_rolled = rolloverAmount (principal + interest reinvested)
      // For PARTIAL_PRINCIPAL: principal_rolled = remainingPrincipal (original_principal − requested_payout)
      // For INTEREST_ONLY:     principal_rolled = principal (stays invested — not terminated)
      const principalRolled =
        scenarioCode === 'PRINCIPAL_ONLY'
          ? rolloverCalc.principalRolled ?? null
          : scenarioCode === 'P_AND_I'
            ? rolloverCalc.rolloverAmount
            : scenarioCode === 'PARTIAL_PRINCIPAL'
              ? rolloverCalc.remainingPrincipal ?? null
              : scenarioCode === 'INTEREST_ONLY'
                ? rolloverCalc.rolloverAmount   // = principal (investment remains active)
                : null

      // requested_payout comes from the form's requestedPayout field for PARTIAL_PRINCIPAL (Req 17.4);
      // for other rollover types (PRINCIPAL_ONLY / INTEREST_ONLY) it uses interestPayout.
      const requestedPayoutValue =
        scenarioCode === 'PARTIAL_PRINCIPAL'
          ? rolloverInput.requestedPayout ?? null
          : rolloverInput.interestPayout ?? null

      await supabase.from('rollover_details').upsert(
        {
          transaction_id: transactionId,
          rollover_type: scenarioCode,
          original_principal: String(investmentSnapshot.principal),
          interest_due: String(investmentSnapshot.accrued_interest),
          principal_rolled: principalRolled,
          interest_paid: rolloverCalc.interestPaid ?? null,
          requested_payout: requestedPayoutValue,
          new_rate: rolloverInput.newRate,
          new_tenor: rolloverInput.newTenor,
          new_effective_date: rolloverInput.effectiveDate,
          new_maturity_date: rolloverInput.rolloverMaturityDate,
          new_rollover_amount: rolloverCalc.rolloverAmount,
        },
        { onConflict: 'transaction_id' },
      )
    }

    // 10a. PRINCIPAL_ONLY / INTEREST_ONLY: create a linked FUNDS_OUT transaction for the interest payout.
    //      Req 17.3 — PRINCIPAL_ONLY: after rollover voucher, create a linked FUNDS_OUT for interest payout.
    //      Req 17.5 — INTEREST_ONLY:  principal stays invested; only interest is paid out via FUNDS_OUT.
    if ((scenarioCode === 'PRINCIPAL_ONLY' || scenarioCode === 'INTEREST_ONLY') && rolloverInput) {
      const interestPayoutAmount =
        rolloverCalc.interestPaid ?? String(investmentSnapshot.accrued_interest)

      // Load parent transaction to copy customer/investment details
      const { data: parentTx } = await supabase
        .from('treasury_transactions')
        .select('customer_id, investment_id, created_by, purpose')
        .eq('id', transactionId)
        .single()

      if (parentTx) {
        // Build payment instruction payload from the rollover form if present
        const rolloverData = parsed.data as import('@/lib/schemas/voucher.schema').RolloverSlipVoucherInput
        const paymentInstructionPayload =
          (rolloverData as Record<string, unknown>).paymentInstruction
            ? JSON.stringify((rolloverData as Record<string, unknown>).paymentInstruction)
            : null

        const scenarioLabel =
          scenarioCode === 'INTEREST_ONLY' ? 'Interest Only' : 'Principal Only'

        // Create the linked FUNDS_OUT transaction via the RPC.
        // The RPC generates its own TRX reference and audit event.
        const { error: linkedTxError } = await supabase.rpc(
          'create_treasury_transaction',
          {
            p_customer_id: parentTx.customer_id,
            p_investment_id: parentTx.investment_id,
            p_transaction_type: 'THIRD_PARTY_PAYMENT',
            p_scenario_code: `${scenarioCode}_INTEREST_PAYOUT`,
            p_requested_amount: interestPayoutAmount,
            p_purpose: `Interest payout for Rollover (${scenarioLabel}) — linked to ${transactionId}`,
            p_source_type: 'MANDATED',
            p_payment_instruction: paymentInstructionPayload,
          },
        )

        if (linkedTxError) {
          // Non-fatal: log the failure but do not roll back the primary voucher.
          // The Treasury Officer can create the FUNDS_OUT transaction manually.
          console.error(
            `[prepareVoucherAction] Failed to create linked FUNDS_OUT for ${scenarioCode} interest payout:`,
            linkedTxError.message,
          )
        }
      }
    }
  }

  // 12. Revalidate caches
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
