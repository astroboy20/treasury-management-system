/**
 * EazybankzAdapter interface.
 *
 * Encapsulates all reads and writes to the Eazybankz banking mirror system.
 * Phase 6 replaces the mock implementation with a real HTTP client.
 *
 * Design: §Eazybankz Adapter Interface
 * Requirements: 30.1, 30.3
 */

// ─── Error class ─────────────────────────────────────────────────────────────

/**
 * Typed error thrown by any EazybankzAdapter implementation.
 * Callers should catch this specifically to distinguish Eazybankz errors
 * from other application errors.
 */
export class EazybankzError extends Error {
  /** HTTP status code or internal error code from the mirror system. */
  readonly code: string | number
  /** The original cause, if any. */
  readonly cause?: unknown

  constructor(message: string, code: string | number = 'EAZYBANKZ_ERROR', cause?: unknown) {
    super(message)
    this.name = 'EazybankzError'
    this.code = code
    this.cause = cause
  }
}

// ─── Data shapes ─────────────────────────────────────────────────────────────

/**
 * Investment record returned by the Eazybankz mirror.
 * All monetary values are strings to preserve NUMERIC precision through
 * the TypeScript layer (Req 30.3).
 */
export interface EazybankzInvestment {
  /** Eazybankz-assigned external reference for this investment. */
  id: string
  /** The Greenline customer ID cross-referenced in the mirror. */
  customerId: string
  productType: 'FIXED_DEPOSIT' | 'CALL' | 'COMMERCIAL_PAPER' | 'CMS'
  /** Principal amount as a NUMERIC-compatible string, e.g. "5000000.0000". */
  principal: string
  /** Annual interest rate as a decimal string, e.g. "0.125000" for 12.5%. */
  interestRate: string
  /** Accrued interest to date as a NUMERIC-compatible string. */
  accruedInterest: string
  /** ISO date YYYY-MM-DD — investment effective (start) date. */
  effectiveDate: string
  /** ISO date YYYY-MM-DD — maturity date; may be null for open-ended products. */
  maturityDate: string
  /** Outstanding balance as a NUMERIC-compatible string. */
  outstandingBalance: string
  /** Amount available for withdrawal as a NUMERIC-compatible string. */
  availableAmount: string
  status: 'ACTIVE' | 'TERMINATED' | 'ROLLED_OVER' | 'MATURED'
  /** The same Eazybankz external reference, exposed as a named field for clarity. */
  externalReference: string
}

/**
 * Account balance record returned by the Eazybankz mirror.
 * All monetary values are strings to preserve NUMERIC precision (Req 30.3).
 */
export interface EazybankzBalance {
  /** The Eazybankz account identifier. */
  accountId: string
  /** Funds available for immediate use as a NUMERIC-compatible string. */
  availableBalance: string
  /** Total ledger balance (including cleared but unsettled funds) as a NUMERIC-compatible string. */
  ledgerBalance: string
  /** ISO 4217 currency code, e.g. "NGN". */
  currency: string
}

/**
 * Input shape for booking a new investment in the Eazybankz mirror.
 * Called on Operations execution for ROLLOVER transactions (Req 17.7).
 */
export interface CreateInvestmentData {
  /** The Greenline customer ID (UUID) for cross-reference. */
  customerId: string
  /** Product type to create. */
  productType: string
  /** Amount being invested / rolled as a NUMERIC-compatible string. */
  principal: string
  /** Annual interest rate as a decimal string, e.g. "0.125000" for 12.5%. */
  interestRate: string
  /** Tenor in days for the new investment. */
  tenorDays: number
  /** ISO date YYYY-MM-DD — investment effective (start) date. */
  effectiveDate: string
  /** The Greenline transaction ID that triggered the booking. */
  sourceTransactionId: string
}

/**
 * Input shape for posting a transaction entry in the Eazybankz mirror.
 * Used for THIRD_PARTY_PAYMENT, INTERNAL_TRANSFER, and similar scenarios
 * where an accounting entry must be created in the mirror.
 */
export interface CreateTransactionData {
  /** The Greenline customer ID (UUID). */
  customerId: string
  /** Transaction type as recognised by the Eazybankz mirror. */
  transactionType: string
  /** Amount being transacted as a NUMERIC-compatible string. */
  amount: string
  /** ISO 4217 currency code, e.g. "NGN". */
  currency: string
  /** Beneficiary account number (for external transfers). */
  beneficiaryAccountNumber?: string
  /** Beneficiary bank name (for external transfers). */
  beneficiaryBankName?: string
  /** Narration / purpose of the transaction. */
  narration: string
  /** The Greenline transaction ID that triggered this posting. */
  sourceTransactionId: string
}

// ─── Adapter interface ────────────────────────────────────────────────────────

/**
 * Contract for all Eazybankz mirror interactions.
 *
 * Phase 1–5: satisfied by MockEazybankzAdapter (reads/writes local DB).
 * Phase 6: satisfied by RealEazybankzAdapter (calls live Eazybankz HTTP API).
 *
 * Implementations MUST:
 *   - Return all monetary values as strings.
 *   - Throw EazybankzError on any system-level failure.
 *   - Never be called directly from components or pages — only from
 *     Server Actions or service layer functions.
 */
export interface EazybankzAdapter {
  /**
   * Fetch current investment data by Eazybankz external reference.
   * Returns the full investment record or throws EazybankzError if not found.
   *
   * Used in Step 4 (Investment Verification) to pre-fill reference values.
   * Req 30.1
   */
  getInvestment(investmentId: string): Promise<EazybankzInvestment>

  /**
   * Fetch current account balance for a given account ID.
   * Returns the balance record or throws EazybankzError if not found.
   *
   * Used for SAVINGS_FUNDS_OUT, CALL_FUNDS_OUT, and CMS_FUNDS_OUT scenarios
   * to display available balance at Step 4.
   * Req 30.1
   */
  getBalance(accountId: string): Promise<EazybankzBalance>

  /**
   * Fetch the current accrued interest for an investment.
   * Returns the accrued interest as a NUMERIC-compatible string.
   *
   * Used for ANNIVERSARY_PAYMENT and PRE_LIQUIDATION scenarios.
   * Req 30.1
   */
  getAccruedInterest(investmentId: string): Promise<string>

  /**
   * Book a new investment in the Eazybankz mirror.
   * Returns the created investment record including the assigned external reference.
   *
   * Called on Operations execution for ROLLOVER transactions (Req 17.7).
   * Phase 6: calls the live Eazybankz API.
   */
  createInvestment(data: CreateInvestmentData): Promise<EazybankzInvestment>

  /**
   * Update an existing investment record in the Eazybankz mirror.
   * Returns the updated investment record.
   *
   * Called on Operations execution for:
   *   - MATURITY_TERMINATION → status: 'TERMINATED' (Req 18.3)
   *   - PRE_LIQUIDATION (partial) → updated principal after rebooking (Req 19.5)
   *   - ANNIVERSARY_PAYMENT → updated accrued interest after payout (Req 20.4)
   *   - SAVINGS/CALL/CMS_FUNDS_OUT → updated balance after withdrawal (Req 24.3)
   */
  updateInvestment(
    investmentId: string,
    data: Partial<CreateInvestmentData>,
  ): Promise<EazybankzInvestment>

  /**
   * Post a transaction entry in the Eazybankz mirror.
   * Returns the Eazybankz-assigned transaction ID.
   *
   * Called for THIRD_PARTY_PAYMENT and INTERNAL_TRANSFER scenarios
   * when an accounting entry must exist in the mirror.
   * Req 30.3
   */
  createTransaction(data: CreateTransactionData): Promise<{ transactionId: string }>

  /**
   * Reverse the original Eazybankz posting for a REVERSAL transaction.
   * Returns the mirror-assigned reversal ID.
   *
   * Called on Operations execution for REVERSAL type (Req 25.3).
   * @param transactionId  The Eazybankz transaction ID of the original posting.
   * @param reason         Non-empty reversal reason (Req 25.2).
   */
  reverseTransaction(transactionId: string, reason: string): Promise<{ reversalId: string }>
}
