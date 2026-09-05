'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import {
  SignatureVerificationSchema,
  type SignatureVerificationInput,
  CustomerConfirmationSchema,
  type CustomerConfirmationInput,
  InvestmentVerificationSchema,
  type InvestmentVerificationInput,
} from '@/lib/schemas/verification.schema'
import type { ActionResult } from '@/lib/actions/transaction.actions'

// ─── verifySignatureAction ────────────────────────────────────────────────────

/**
 * Records a signature verification result for Step 2 of the workflow.
 *
 * Security: resolves caller role from DB — never trusts client-supplied role.
 * Enforces TREASURY_OFFICER only (Req 8.6, 5.3).
 * Delegates to verify_signature RPC which atomically updates the transaction
 * status and writes a SIGNATURE_VERIFIED or SIGNATURE_FAILED audit event.
 *
 * Requirements: 8.1–8.6, 5.1, 5.3
 */
export async function verifySignatureAction(
  transactionId: string,
  input: SignatureVerificationInput,
): Promise<ActionResult<{ newStatus: string }>> {
  // 1. Validate inputs with Zod
  const parsed = SignatureVerificationSchema.safeParse(input)
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

  // 4. Enforce TREASURY_OFFICER permission (Req 8.6)
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can record signature verifications.',
    }
  }

  // 5. Call the PostgreSQL RPC (Req 8.2)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('verify_signature', {
    p_transaction_id: transactionId,
    p_signature_result: parsed.data.signatureResult,
    p_mandate_result: parsed.data.mandateResult,
    p_account_ownership_result: parsed.data.accountOwnershipResult,
    p_completeness_result: parsed.data.completenessResult,
    p_notes: parsed.data.notes ?? null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns { new_status, audit_event_id }
  const result = data as { new_status: string; audit_event_id: string }

  // 6. Revalidate the transaction workspace cache
  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')

  return {
    success: true,
    data: { newStatus: result.new_status },
  }
}

// ─── recordCustomerConfirmationAction ────────────────────────────────────────

/**
 * Records the telephone confirmation result for Step 3 of the workflow.
 *
 * Security: enforces ACCOUNT_OFFICER role only (Req 9.6, 5.3).
 * Delegates to record_customer_confirmation RPC which atomically updates
 * the transaction status and writes a CUSTOMER_CONFIRMED audit event.
 *
 * Requirements: 9.1–9.6, 5.1, 5.3
 */
export async function recordCustomerConfirmationAction(
  transactionId: string,
  input: CustomerConfirmationInput,
): Promise<ActionResult<{ newStatus: string }>> {
  // 1. Validate inputs with Zod
  const parsed = CustomerConfirmationSchema.safeParse(input)
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

  // 4. Enforce ACCOUNT_OFFICER permission (Req 9.6)
  if (role !== 'ACCOUNT_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only an Account Officer can record customer confirmations.',
    }
  }

  // 5. Call the PostgreSQL RPC (Req 9.3)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_customer_confirmation', {
    p_transaction_id: transactionId,
    p_confirmation_status: parsed.data.confirmationStatus,
    p_confirmed_amount: parsed.data.confirmedAmount,
    p_confirmed_beneficiary: parsed.data.confirmedBeneficiary ?? null,
    p_confirmed_purpose: parsed.data.confirmedPurpose,
    p_confirmation_date: parsed.data.confirmationDate,
    p_confirmation_time: parsed.data.confirmationTime,
    p_notes: parsed.data.notes ?? null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns { new_status }
  const result = data as { new_status: string }

  // 6. Revalidate the transaction workspace cache
  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')

  return {
    success: true,
    data: { newStatus: result.new_status },
  }
}

// ─── verifyInvestmentAction ───────────────────────────────────────────────────

/**
 * Records the investment verification snapshot for Step 4 of the workflow.
 *
 * Security: enforces TREASURY_OFFICER role only (Req 10.6, 5.3).
 * Delegates to verify_investment RPC which atomically persists the immutable
 * investment snapshot, updates transaction status, and writes an
 * INVESTMENT_VERIFIED audit event.
 *
 * All monetary/rate values are passed as NUMERIC-compatible strings to
 * preserve precision; PostgreSQL performs the authoritative cast (Req 10.3).
 *
 * Requirements: 10.1–10.6, 5.1, 5.3
 */
export async function verifyInvestmentAction(
  transactionId: string,
  input: InvestmentVerificationInput,
): Promise<ActionResult<{ newStatus: string; snapshot: InvestmentVerificationInput }>> {
  // 1. Validate inputs with Zod
  const parsed = InvestmentVerificationSchema.safeParse(input)
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

  // 4. Enforce TREASURY_OFFICER permission (Req 10.6)
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can record investment verifications.',
    }
  }

  // 5. Call the PostgreSQL RPC (Req 10.3)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('verify_investment', {
    p_transaction_id: transactionId,
    p_principal: parsed.data.principal,
    p_accrued_interest: parsed.data.accruedInterest,
    p_interest_rate: parsed.data.interestRate,
    p_effective_date: parsed.data.effectiveDate,
    p_maturity_date: parsed.data.maturityDate ?? null,
    p_outstanding_balance: parsed.data.outstandingBalance,
    p_available_amount: parsed.data.availableAmount,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  // RPC returns { new_status, snapshot }
  const result = data as { new_status: string; snapshot: InvestmentVerificationInput }

  // 6. Revalidate the transaction workspace cache
  revalidatePath(`/transactions/${transactionId}`)
  revalidatePath('/transactions')

  return {
    success: true,
    data: {
      newStatus: result.new_status,
      snapshot: result.snapshot,
    },
  }
}
