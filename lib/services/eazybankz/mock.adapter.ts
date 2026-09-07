/**
 * Mock Eazybankz adapter.
 *
 * Phase 1–5: returns investment data sourced directly from the local
 * `investments` table (already seeded with Eazybankz mirror data).
 * The workspace page passes the investment record from the transaction,
 * which this adapter echoes back — keeping the contract stable for
 * Phase 6 when a real HTTP call will replace this implementation.
 *
 * Design: §Eazybankz Adapter
 */

import type {
  EazybankzAdapter,
  EazybankzInvestment,
  CreateInvestmentInput,
  CreateInvestmentResult,
  UpdateInvestmentInput,
  UpdateInvestmentResult,
  ReverseTransactionResult,
} from './adapter.interface'
import { createClient } from '@/lib/supabase/server'

class MockEazybankzAdapter implements EazybankzAdapter {
  async getInvestment(externalReference: string): Promise<EazybankzInvestment | null> {
    // In Phase 1–5 we read from the local investments table.
    // The external_reference column stores the Eazybankz investment ID.
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('investments')
      .select(
        `external_reference, product_type, principal, interest_rate,
         accrued_interest, effective_date, maturity_date,
         outstanding_balance, available_amount, status`,
      )
      .eq('external_reference', externalReference)
      .maybeSingle()

    if (error || !data) return null

    return {
      externalReference: data.external_reference ?? externalReference,
      productType: data.product_type,
      principal: String(data.principal),
      interestRate: String(data.interest_rate),
      accruedInterest: String(data.accrued_interest),
      effectiveDate: data.effective_date,
      maturityDate: data.maturity_date ?? null,
      outstandingBalance: String(data.outstanding_balance),
      availableAmount: String(data.available_amount),
      status: data.status,
    }
  }

  /**
   * Mock implementation of createInvestment (Req 17.7).
   *
   * Phase 1–5: writes a new row to the local `investments` table so that
   * the rolled investment exists in the mirror database.
   * Phase 6: this will be replaced by a live HTTP call to Eazybankz.
   *
   * Returns an external_reference in the format EZ-INV-<uuid-prefix>.
   */
  async createInvestment(input: CreateInvestmentInput): Promise<CreateInvestmentResult> {
    const supabase = await createClient()

    // Generate a mock external reference
    const externalReference = `EZ-INV-${input.sourceTransactionId.slice(0, 8).toUpperCase()}`

    const { error } = await supabase.from('investments').insert({
      customer_id: input.customerId,
      external_reference: externalReference,
      product_type: input.productType,
      principal: input.principal,
      interest_rate: input.interestRate,
      accrued_interest: '0',
      effective_date: input.effectiveDate,
      maturity_date: input.maturityDate,
      outstanding_balance: input.principal,
      available_amount: input.principal,
      status: 'ACTIVE',
      source_system: 'EAZYBANKZ',
    })

    if (error) {
      throw new Error(
        `MockEazybankzAdapter.createInvestment failed: ${error.message ?? error.code ?? 'unknown'}`,
      )
    }

    return {
      externalReference,
      status: 'ACTIVE',
    }
  }

  /**
   * Mock implementation of updateInvestment.
   *
   * Handles status transitions and balance updates for:
   *   - MATURITY_TERMINATION  → status: 'TERMINATED'  (Req 18.3)
   *   - PRE_LIQUIDATION       → rebooking / balance   (Req 19.5)
   *   - ANNIVERSARY_PAYMENT   → reset accrued interest (Req 20.4)
   *   - SAVINGS/CALL/CMS      → updated balance        (Req 24.3)
   *
   * Phase 1–5: updates the local `investments` table.
   * Phase 6: will be replaced by a live Eazybankz HTTP call.
   */
  async updateInvestment(
    externalReference: string,
    data: UpdateInvestmentInput,
  ): Promise<UpdateInvestmentResult> {
    const supabase = await createClient()

    // Build only the columns that were supplied
    const updatePayload: Record<string, unknown> = {}
    if (data.status !== undefined) updatePayload.status = data.status
    if (data.outstandingBalance !== undefined)
      updatePayload.outstanding_balance = data.outstandingBalance
    if (data.availableAmount !== undefined) updatePayload.available_amount = data.availableAmount
    if (data.accruedInterest !== undefined) updatePayload.accrued_interest = data.accruedInterest

    if (Object.keys(updatePayload).length === 0) {
      // Nothing to update — return the current status
      const { data: existing } = await supabase
        .from('investments')
        .select('status')
        .eq('external_reference', externalReference)
        .maybeSingle()

      return {
        externalReference,
        status: (existing?.status as string) ?? 'UNKNOWN',
      }
    }

    const { data: updated, error } = await supabase
      .from('investments')
      .update(updatePayload)
      .eq('external_reference', externalReference)
      .select('status')
      .maybeSingle()

    if (error) {
      throw new Error(
        `MockEazybankzAdapter.updateInvestment failed: ${error.message ?? error.code ?? 'unknown'}`,
      )
    }

    return {
      externalReference,
      status: (updated?.status as string) ?? (data.status ?? 'UNKNOWN'),
    }
  }

  /**
   * Mock implementation of reverseTransaction (Req 25.3).
   *
   * Phase 1–5: marks the investment in the local `investments` table as
   * ROLLED_OVER (a surrogate for "reversed") so the mirror record reflects the
   * reversal.  In Phase 6 this will be replaced by a live Eazybankz API call.
   *
   * Returns a `reversalId` in the format EZ-REVERSAL-<uuid-prefix>.
   */
  async reverseTransaction(
    originalExternalReference: string,
    reason: string,
  ): Promise<ReverseTransactionResult> {
    if (!reason || reason.trim() === '') {
      throw new Error('MockEazybankzAdapter.reverseTransaction: reason is required')
    }

    const supabase = await createClient()

    // Mark the original investment as ROLLED_OVER (proxy for "reversed" in mock)
    const { error } = await supabase
      .from('investments')
      .update({ status: 'ROLLED_OVER', updated_at: new Date().toISOString() })
      .eq('external_reference', originalExternalReference)

    if (error) {
      throw new Error(
        `MockEazybankzAdapter.reverseTransaction failed: ${error.message ?? error.code ?? 'unknown'}`,
      )
    }

    const reversalId = `EZ-REVERSAL-${originalExternalReference.slice(0, 8).toUpperCase()}-${Date.now()}`

    return {
      reversalId,
      originalReference: originalExternalReference,
      status: 'REVERSED',
    }
  }
}

export const mockEazybankzAdapter = new MockEazybankzAdapter()
