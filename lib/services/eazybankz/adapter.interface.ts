/**
 * EazybankzAdapter interface.
 *
 * Encapsulates all reads and writes to the Eazybankz banking mirror system.
 * Phase 6 replaces the mock implementation with a real HTTP client.
 *
 * Design: §Eazybankz Adapter
 */

export interface EazybankzInvestment {
  externalReference: string
  productType: string
  principal: string
  interestRate: string
  accruedInterest: string
  effectiveDate: string       // ISO date YYYY-MM-DD
  maturityDate: string | null // null for open-ended products (e.g., CALL)
  outstandingBalance: string
  availableAmount: string
  status: string
}

// ─── Input shape for booking a new rolled investment ─────────────────────────

export interface CreateInvestmentInput {
  /** The Greenline customer ID (UUID) for cross-reference. */
  customerId: string
  /** Amount being invested / rolled (NUMERIC-compatible string). */
  principal: string
  /** Annual interest rate as a decimal string, e.g. "0.125000" for 12.5%. */
  interestRate: string
  /** Tenor in days for the new investment. */
  tenorDays: number
  /** ISO date YYYY-MM-DD — investment effective (start) date. */
  effectiveDate: string
  /** ISO date YYYY-MM-DD — investment maturity date. */
  maturityDate: string
  /** Product type, e.g. "FIXED_DEPOSIT". */
  productType: string
  /** The Greenline transaction ID that triggered the booking. */
  sourceTransactionId: string
}

export interface CreateInvestmentResult {
  /** The external reference assigned by the mirror system. */
  externalReference: string
  /** Confirmation status from the mirror. */
  status: string
}

export interface EazybankzAdapter {
  /**
   * Fetch current investment data for a given external reference.
   * Returns null if the investment is not found in the mirror.
   */
  getInvestment(externalReference: string): Promise<EazybankzInvestment | null>

  /**
   * Book a new investment in the Eazybankz mirror.
   * Called on Operations execution for ROLLOVER transactions (Req 17.7).
   * Phase 1–5: persists to the local `investments` table as a mock.
   * Phase 6: calls the live Eazybankz API.
   */
  createInvestment(input: CreateInvestmentInput): Promise<CreateInvestmentResult>
}
