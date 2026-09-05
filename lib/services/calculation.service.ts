/**
 * Calculation Service — Greenline Treasury Platform
 *
 * All financial calculations are delegated to PostgreSQL RPC functions,
 * which use the NUMERIC type for precision-safe arithmetic.
 *
 * IMPORTANT: This file is server-side only. It must never be imported
 * from browser components or client-side code.
 *
 * All monetary inputs and outputs are represented as NUMERIC-compatible
 * strings (e.g. "1500000.0000") to preserve exact decimal precision
 * through the TypeScript layer. JavaScript floating-point arithmetic
 * is never the authoritative result for any financial calculation.
 *
 * References:
 *   Req 26.1 – all five calculation functions
 *   Req 26.2 – every function returns a CalculationSnapshot
 *   Req 26.3 – server-side numeric arithmetic only
 *   Req 26.4 – server recalculates before saving a voucher
 *   Req 26.5 – snapshot persisted in vouchers.calculation_snapshot
 *   Req 26.6 – pre-liquidation SOP example: ₦1,500,000 → ₦300,000 charge
 */

import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The immutable record of a single financial calculation.
 * Stored in vouchers.calculation_snapshot (JSONB).
 * Once a voucher is FINALISED this record must not be modified.
 */
export interface CalculationSnapshot {
  /** The rule applied — maps directly to the PostgreSQL RPC logic. */
  rule: CalculationRule
  /** All authoritative numeric inputs, as strings. */
  inputs: Record<string, string>
  /** All computed outputs, as strings. */
  outputs: Record<string, string>
  /** ISO 8601 timestamp at which the calculation was performed server-side. */
  calculated_at: string
}

/**
 * The set of all named calculation rules in the system.
 * Each value corresponds to a SECURITY DEFINER PostgreSQL RPC function.
 */
export type CalculationRule =
  | 'PRE_LIQUIDATION_20_PERCENT'
  | 'THIRD_PARTY_TRANSFER_0_10_PERCENT'
  | 'ROLLOVER_P_AND_I'
  | 'ROLLOVER_PRINCIPAL_ONLY'
  | 'ROLLOVER_PARTIAL_PRINCIPAL'
  | 'ROLLOVER_INTEREST_ONLY'
  | 'MATURITY_TERMINATION'
  | 'ANNIVERSARY_PAYMENT'

// ─── Rollover type union (matches PostgreSQL CHECK constraint) ────────────────

export type RolloverType =
  | 'P_AND_I'
  | 'PRINCIPAL_ONLY'
  | 'PARTIAL_PRINCIPAL'
  | 'INTEREST_ONLY'

// ─── Return types ─────────────────────────────────────────────────────────────

export type PreLiquidationResult = CalculationSnapshot & {
  /** 20% of accrued interest. */
  charge: string
  /** accrued_interest − charge. */
  netInterest: string
  /** Only present for partial pre-liquidation. */
  remainingPrincipal?: string
  /** Only present for partial pre-liquidation. */
  rebookedPrincipal?: string
}

export type RolloverResult = CalculationSnapshot & {
  /**
   * The amount being rolled over (reinvested).
   * P_AND_I:           principal + interest_due
   * PRINCIPAL_ONLY:    principal (interest paid out)
   * PARTIAL_PRINCIPAL: remaining_principal (after payout)
   * INTEREST_ONLY:     principal (stays invested)
   */
  rolloverAmount: string
  /** Interest paid out. Present for PRINCIPAL_ONLY, PARTIAL_PRINCIPAL, INTEREST_ONLY. */
  interestPaid?: string
  /** Present for PRINCIPAL_ONLY. Equals principal. */
  principalRolled?: string
}

export type ThirdPartyChargeResult = CalculationSnapshot & {
  /** 0 for internal; transfer_amount × 0.001 for external. */
  transferCharge: string
  /** The transfer amount (charge is separate, not deducted from net_amount here). */
  netAmount: string
}

export type AnniversaryPaymentResult = CalculationSnapshot & {
  /** principal × interest_rate × (frequency_days / 365) */
  interestDue: string
}

export type MaturityTerminationResult = CalculationSnapshot & {
  /** principal + accrued_interest. WHT is 0 per SOP. */
  netAmount: string
}

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Invokes a PostgreSQL calculation RPC and extracts the snapshot JSONB.
 * Throws a descriptive Error if the RPC fails.
 */
async function invokeCalculationRpc(
  rpcName: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(rpcName, params)

  if (error) {
    throw new Error(
      `Calculation RPC '${rpcName}' failed: ${error.message ?? error.code ?? 'unknown error'}`,
    )
  }
  if (!data || typeof data !== 'object') {
    throw new Error(`Calculation RPC '${rpcName}' returned an empty or invalid result`)
  }

  return data as Record<string, unknown>
}

// ─── Calculation Functions ────────────────────────────────────────────────────

/**
 * Calculates the pre-liquidation charge and resulting net interest.
 *
 * Rule: PRE_LIQUIDATION_20_PERCENT
 *   charge       = accrued_interest × 0.20
 *   net_interest = accrued_interest − charge
 *
 * Partial pre-liquidation (when both originalPrincipal and requestedPayout
 * are supplied):
 *   remaining_principal = original_principal − requested_payout
 *   rebooked_principal  = remaining_principal − charge
 *
 * SOP canonical example (Req 26.6):
 *   accruedInterest = "1500000.0000" → charge = "300000.0000"
 *                                    → netInterest = "1200000.0000"
 *
 * @param accruedInterest  NUMERIC string from investment_verifications snapshot.
 * @param originalPrincipal  NUMERIC string — required for partial pre-liquidation.
 * @param requestedPayout  NUMERIC string — partial payout amount.
 */
export async function calculatePreLiquidation(
  accruedInterest: string,
  originalPrincipal?: string,
  requestedPayout?: string,
): Promise<PreLiquidationResult> {
  const params: Record<string, unknown> = {
    p_accrued_interest: accruedInterest,
  }
  if (originalPrincipal !== undefined) {
    params.p_original_principal = originalPrincipal
  }
  if (requestedPayout !== undefined) {
    params.p_requested_payout = requestedPayout
  }

  const raw = await invokeCalculationRpc('calculate_pre_liquidation', params)

  const snapshot: CalculationSnapshot = {
    rule: raw.rule as CalculationRule,
    inputs: raw.inputs as Record<string, string>,
    outputs: raw.outputs as Record<string, string>,
    calculated_at: raw.calculated_at as string,
  }

  const outputs = snapshot.outputs

  const result: PreLiquidationResult = {
    ...snapshot,
    charge: outputs.charge,
    netInterest: outputs.net_interest,
  }

  if (outputs.remaining_principal !== undefined) {
    result.remainingPrincipal = outputs.remaining_principal
  }
  if (outputs.rebooked_principal !== undefined) {
    result.rebookedPrincipal = outputs.rebooked_principal
  }

  return result
}

/**
 * Calculates rollover amounts for all four rollover sub-types.
 *
 * Rules:
 *   P_AND_I:           rollover_amount = principal + interest_due
 *   PRINCIPAL_ONLY:    principal_rolled = principal; interest_paid = interest_due
 *   PARTIAL_PRINCIPAL: remaining_principal = principal − requested_payout; rollover_amount = remaining_principal
 *   INTEREST_ONLY:     rollover_amount = principal; interest_paid = interest_due
 *
 * @param type           The rollover sub-type.
 * @param principal      NUMERIC string from investment_verifications snapshot.
 * @param interestDue    NUMERIC string from investment_verifications snapshot.
 * @param requestedPayout  NUMERIC string — required only for PARTIAL_PRINCIPAL.
 */
export async function calculateRollover(
  type: RolloverType,
  principal: string,
  interestDue: string,
  requestedPayout?: string,
): Promise<RolloverResult> {
  const params: Record<string, unknown> = {
    p_rollover_type: type,
    p_principal: principal,
    p_interest_due: interestDue,
  }
  if (requestedPayout !== undefined) {
    params.p_requested_payout = requestedPayout
  }

  const raw = await invokeCalculationRpc('calculate_rollover', params)

  const snapshot: CalculationSnapshot = {
    rule: raw.rule as CalculationRule,
    inputs: raw.inputs as Record<string, string>,
    outputs: raw.outputs as Record<string, string>,
    calculated_at: raw.calculated_at as string,
  }

  const outputs = snapshot.outputs

  const result: RolloverResult = {
    ...snapshot,
    rolloverAmount: outputs.rollover_amount,
  }

  if (outputs.interest_paid !== undefined) {
    result.interestPaid = outputs.interest_paid
  }
  if (outputs.principal_rolled !== undefined) {
    result.principalRolled = outputs.principal_rolled
  }

  return result
}

/**
 * Calculates the transfer charge for a third-party payment.
 *
 * Rule: THIRD_PARTY_TRANSFER_0_10_PERCENT
 *   External: transfer_charge = transfer_amount × 0.001
 *   Internal: transfer_charge = 0
 *
 * @param transferAmount  NUMERIC string — the gross transfer amount.
 * @param isInternal      Whether this is an internal (intra-company) transfer.
 */
export async function calculateThirdPartyCharge(
  transferAmount: string,
  isInternal: boolean,
): Promise<ThirdPartyChargeResult> {
  const raw = await invokeCalculationRpc('calculate_third_party_charge', {
    p_transfer_amount: transferAmount,
    p_is_internal: isInternal,
  })

  const snapshot: CalculationSnapshot = {
    rule: raw.rule as CalculationRule,
    inputs: raw.inputs as Record<string, string>,
    outputs: raw.outputs as Record<string, string>,
    calculated_at: raw.calculated_at as string,
  }

  return {
    ...snapshot,
    transferCharge: snapshot.outputs.transfer_charge,
    netAmount: snapshot.outputs.net_amount,
  }
}

/**
 * Calculates the interest due for a periodic anniversary payment.
 *
 * Rule: ANNIVERSARY_PAYMENT
 *   interest_due = principal × interest_rate × (frequency_days / 365)
 *
 * frequency_days must be exactly 30, 60, or 90 (Req 20.1).
 * WHT is 0 per SOP (Req 20.3).
 *
 * @param principal      NUMERIC string from investment_verifications snapshot.
 * @param interestRate   NUMERIC string — decimal rate, e.g. "0.125000" for 12.5%.
 * @param frequencyDays  Exactly 30, 60, or 90.
 */
export async function calculateAnniversaryPayment(
  principal: string,
  interestRate: string,
  frequencyDays: 30 | 60 | 90,
): Promise<AnniversaryPaymentResult> {
  const raw = await invokeCalculationRpc('calculate_anniversary_payment', {
    p_principal: principal,
    p_interest_rate: interestRate,
    p_frequency_days: frequencyDays,
  })

  const snapshot: CalculationSnapshot = {
    rule: raw.rule as CalculationRule,
    inputs: raw.inputs as Record<string, string>,
    outputs: raw.outputs as Record<string, string>,
    calculated_at: raw.calculated_at as string,
  }

  return {
    ...snapshot,
    interestDue: snapshot.outputs.interest_due,
  }
}

/**
 * Calculates the net payout for a maturity termination.
 *
 * Rule: MATURITY_TERMINATION
 *   net_amount = principal + accrued_interest
 *   WHT        = 0 (per SOP — Req 11.3)
 *
 * @param principal        NUMERIC string from investment_verifications snapshot.
 * @param accruedInterest  NUMERIC string from investment_verifications snapshot.
 */
export async function calculateMaturityTermination(
  principal: string,
  accruedInterest: string,
): Promise<MaturityTerminationResult> {
  const raw = await invokeCalculationRpc('calculate_maturity_termination', {
    p_principal: principal,
    p_accrued_interest: accruedInterest,
  })

  const snapshot: CalculationSnapshot = {
    rule: raw.rule as CalculationRule,
    inputs: raw.inputs as Record<string, string>,
    outputs: raw.outputs as Record<string, string>,
    calculated_at: raw.calculated_at as string,
  }

  return {
    ...snapshot,
    netAmount: snapshot.outputs.net_amount,
  }
}
