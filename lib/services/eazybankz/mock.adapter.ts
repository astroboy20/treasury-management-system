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
   * Returns an external_reference in the format EZ-ROLLOVER-<uuid-prefix>.
   */
  async createInvestment(input: CreateInvestmentInput): Promise<CreateInvestmentResult> {
    const supabase = await createClient()

    // Generate a mock external reference
    const externalReference = `EZ-ROLLOVER-${input.sourceTransactionId.slice(0, 8).toUpperCase()}`

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
}

export const mockEazybankzAdapter = new MockEazybankzAdapter()
