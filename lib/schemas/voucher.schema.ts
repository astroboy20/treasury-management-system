import { z } from 'zod'

// ============================================================
// Shared helpers
// ============================================================

const isoDateString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${fieldName} must be in YYYY-MM-DD format.`)

const positiveNumericString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required.` })
    .min(1, `${fieldName} is required.`)
    .refine(
      (val) => /^\d+(\.\d+)?$/.test(val) && Number(val) > 0,
      `${fieldName} must be a positive number.`,
    )

const numericString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required.` })
    .min(1, `${fieldName} is required.`)
    .refine(
      (val) => /^\d+(\.\d+)?$/.test(val) && Number(val) >= 0,
      `${fieldName} must be a non-negative number.`,
    )

const remarks = z
  .string()
  .max(1000, 'Remarks must be 1 000 characters or fewer.')
  .optional()

// ============================================================
// Payment Instruction sub-schema (Req 36)
// Shared by FUNDS_OUT (external) and ROLLOVER_SLIP (when interest
// is paid out externally).
//
// For THIRD_PARTY_PAYMENT (is_internal = false), all six fields
// are REQUIRED before the voucher may be saved (Req 36.1, 36.2, 21.4).
// For internal transfers, the block is still rendered but Transfer
// Charge is shown as ₦0 and some fields may be optional (Req 36.3).
// ============================================================

export const VoucherPaymentInstructionSchema = z.object({
  /**
   * All fields are optional at the schema level.
   * External transfers (isInternal = false): all 6 fields enforced by FundsOutVoucherSchema.superRefine (Req 36.1, 36.2, 21.4).
   * Internal transfers (isInternal = true): only accountNumber required; charge always 0 (Req 21.3, 36.3).
   */

  /** Full legal name of the external beneficiary — required for external only (Req 36.1). */
  beneficiaryName: z.string().optional(),

  /** Destination bank name — required for external only (Req 36.1). */
  bankName: z.string().optional(),

  /** NUBAN / account number (Req 36.1). */
  accountNumber: z.string().optional(),

  /** Account type at the destination bank — required for external only (Req 36.1). */
  accountType: z.string().optional(),

  /**
   * Transfer amount — required for external only (Req 36.1, 21.4).
   * Validated as a positive NUMERIC-compatible string in superRefine.
   */
  amount: z.string().optional(),

  /**
   * Transfer charge — computed server-side (0.10% for external, 0 for internal).
   * Included in the payment instruction block for display and persistence (Req 36.1).
   * Defaults to "0"; the server always recomputes the authoritative value.
   */
  transferCharge: z.string().optional(),

  /** Optional purpose / narration for the payment (Req 36.1). */
  purpose: z.string().optional(),

  /**
   * Whether this is an intra-company (internal) transfer.
   * Defaults to false — external by default for THIRD_PARTY_PAYMENT (Req 21.1).
   */
  isInternal: z.boolean().optional(),
})

export type VoucherPaymentInstruction = z.infer<typeof VoucherPaymentInstructionSchema>

// ============================================================
// Voucher Type enum
// Mirrors migration 001 CHECK on vouchers.voucher_type
// The server resolves the correct type from the transaction type;
// the frontend passes it through for discriminated union routing only.
// (Req 11.1, 11.2 — frontend cannot override server-resolved type)
// ============================================================

export const VoucherTypeEnum = z.enum([
  'FUNDS_IN',
  'FUNDS_OUT',
  'ROLLOVER_SLIP',
  'TRANSFER_SLIP',
])
export type VoucherType = z.infer<typeof VoucherTypeEnum>

// ============================================================
// Rollover sub-type enum
// ============================================================

export const RolloverTypeEnum = z.enum([
  'P_AND_I',
  'PRINCIPAL_ONLY',
  'PARTIAL_PRINCIPAL',
  'INTEREST_ONLY',
])
export type RolloverType = z.infer<typeof RolloverTypeEnum>

// ============================================================
// FUNDS_IN voucher variant (Req 11.4)
// Used for: INFLOW
// Fields: customer name (display only), amount, rate, tenor,
//         effective date, maturity date.
// ============================================================

export const FundsInVoucherSchema = z.object({
  voucherType: z.literal('FUNDS_IN'),

  // Amount of the inflow
  amount: positiveNumericString('Amount'),

  // Interest rate for the new investment (percentage)
  rate: positiveNumericString('Interest rate'),

  // Tenor in days
  tenor: z
    .number({ error: 'Tenor is required.' })
    .int('Tenor must be a whole number of days.')
    .positive('Tenor must be a positive number of days.'),

  effectiveDate: isoDateString('Effective date'),
  maturityDate: isoDateString('Maturity date'),
  transferDate: isoDateString('Transfer date'),
  remarks,
})

export type FundsInVoucherInput = z.infer<typeof FundsInVoucherSchema>

// ============================================================
// FUNDS_OUT voucher variant (Req 11.3)
// Used for: MATURITY_TERMINATION, ANNIVERSARY_PAYMENT,
//           PRE_LIQUIDATION, THIRD_PARTY_PAYMENT,
//           SAVINGS_FUNDS_OUT, CALL_FUNDS_OUT, CMS_FUNDS_OUT
//
// WHT is stored but defaults to 0 per SOP for maturity
// termination and anniversary payments.
// For SAVINGS/CALL/CMS: availableBalance replaces principal (Req 38).
//
// For THIRD_PARTY_PAYMENT with is_internal = false, paymentInstruction
// is REQUIRED with all 6 fields (Req 36.1, 36.2, 21.4).
// ============================================================

export const FundsOutVoucherSchema = z
  .object({
    voucherType: z.literal('FUNDS_OUT'),

    // principal is required for standard Funds-Out scenarios
    principal: positiveNumericString('Principal'),

    // interest may be 0 for certain scenarios
    interest: numericString('Interest'),

    // WHT — defaults to 0 per SOP
    wht: numericString('WHT').default('0'),

    // charge — pre-liquidation or transfer charge; 0 for maturity/anniversary
    charge: numericString('Charge').default('0'),

    // net_amount — authoritative value computed by server; submitted
    // for display/confirmation; server validates against snapshot
    netAmount: positiveNumericString('Net amount'),

    // availableBalance — for SAVINGS/CALL/CMS Funds-Out (Req 38)
    availableBalance: numericString('Available balance').optional(),

    // requestedPayout — for partial PRE_LIQUIDATION (Req 19.2)
    requestedPayout: positiveNumericString('Requested payout').optional(),

    /**
     * Payment Instruction block (Req 36).
     * Required for THIRD_PARTY_PAYMENT (is_internal = false) — all 6 fields enforced.
     * Optional for other FUNDS_OUT scenarios that may involve external payment.
     * Enforcement for mandatory presence is in .superRefine() below.
     */
    paymentInstruction: VoucherPaymentInstructionSchema.optional(),

    /**
     * Whether this is an internal transfer (Req 21.1).
     * Passed from the form so the server action can derive isInternal correctly.
     * The RPC also reads payment_instructions.is_internal — this is for client-side routing.
     */
    isInternal: z.boolean().optional(),

    /**
     * The transaction type — threaded through so .superRefine() can enforce
     * payment instruction requirements without a separate field lookup.
     * Not persisted on the voucher itself.
     */
    transactionTypeHint: z.string().optional(),

    transferDate: isoDateString('Transfer date'),
    remarks,
  })
  .superRefine((data, ctx) => {
    // Req 36.2, 21.4: For THIRD_PARTY_PAYMENT external transfers, all 6 PI fields are REQUIRED.
    // For internal transfers (isInternal = true), PI is optional and only accountNumber matters.
    const isExternalThirdParty =
      data.transactionTypeHint === 'THIRD_PARTY_PAYMENT' && data.isInternal !== true

    if (isExternalThirdParty) {
      const pi = data.paymentInstruction

      if (!pi) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction'],
          message: 'Payment instruction is required for external third-party payments.',
        })
        return
      }

      // All 6 fields must be present (Req 36.1, 21.4):
      // beneficiaryName, bankName, accountNumber, accountType, amount, transferCharge
      if (!pi.beneficiaryName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'beneficiaryName'],
          message: 'Beneficiary name is required for external payments.',
        })
      }
      if (!pi.bankName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'bankName'],
          message: 'Bank name is required for external payments.',
        })
      }
      if (!pi.accountNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'accountNumber'],
          message: 'Account number is required for external payments.',
        })
      }
      if (!pi.accountType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'accountType'],
          message: 'Account type is required for external payments.',
        })
      }
      if (!pi.amount || Number(pi.amount) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'amount'],
          message: 'Transfer amount is required for external payments.',
        })
      }
      // transferCharge must be present (may be "0" client-side; server overwrites)
      if (pi.transferCharge === undefined || pi.transferCharge === null || pi.transferCharge === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'transferCharge'],
          message: 'Transfer charge is required for external payments.',
        })
      }
    }
  })

export type FundsOutVoucherInput = z.infer<typeof FundsOutVoucherSchema>

// ============================================================
// ROLLOVER_SLIP voucher variant (Req 11.5)
// Used for: ROLLOVER
// Required fields vary by rollover sub-type, but the schema
// captures all possible fields; sub-type specific validation
// is handled in the server action + RPC function.
// ============================================================

export const RolloverSlipVoucherSchema = z.object({
  voucherType: z.literal('ROLLOVER_SLIP'),

  rolloverType: RolloverTypeEnum,

  // Principal being rolled
  principalAmount: positiveNumericString('Principal amount'),

  // Interest due at rollover date
  interestDue: numericString('Interest due'),

  effectiveDate: isoDateString('Effective date'),

  // New terms for the rolled investment
  newTenor: z
    .number({ error: 'New tenor is required.' })
    .int('New tenor must be a whole number of days.')
    .positive('New tenor must be positive.'),

  newRate: positiveNumericString('New rate'),

  // Computed server-side; submitted for display confirmation
  rolloverAmount: positiveNumericString('Rollover amount'),

  rolloverMaturityDate: z.string().optional().refine(
    (val) => !val || val.trim() === '' || /^\d{4}-\d{2}-\d{2}$/.test(val),
    'Rollover maturity date must be in YYYY-MM-DD format.',
  ),

  // Optional: interest payout amount for PRINCIPAL_ONLY / INTEREST_ONLY rollovers
  interestPayout: z.string().optional().refine(
    (val) => !val || val.trim() === '' || (/^\d+(\.\d+)?$/.test(val) && Number(val) >= 0),
    'Interest payout must be a non-negative number.',
  ).transform(v => (!v || v.trim() === '') ? undefined : v),

  // Optional: requested payout amount for PARTIAL_PRINCIPAL rollovers (Req 17.4)
  requestedPayout: z.string().optional().refine(
    (val) => !val || val.trim() === '' || (/^\d+(\.\d+)?$/.test(val) && Number(val) > 0),
    'Requested payout must be a positive number.',
  ).transform(v => (!v || v.trim() === '') ? undefined : v),

  remarks,
})

export type RolloverSlipVoucherInput = z.infer<typeof RolloverSlipVoucherSchema>

// ============================================================
// TRANSFER_SLIP voucher variant (Req 11.6)
// Used for: INTERNAL_TRANSFER, REVERSAL
// ============================================================

export const TransferSlipVoucherSchema = z.object({
  voucherType: z.literal('TRANSFER_SLIP'),

  // Amount being transferred
  amount: positiveNumericString('Transfer amount'),

  // Source and destination account details (for display)
  sourceAccountNumber: z.string().optional(),
  destinationAccountNumber: z.string().optional(),

  transferDate: isoDateString('Transfer date'),
  remarks,
})

export type TransferSlipVoucherInput = z.infer<typeof TransferSlipVoucherSchema>

// ============================================================
// VoucherPreparationSchema — discriminated union (Req 11.1–11.9)
//
// The voucherType is READ from the server; the frontend passes
// it back as a discriminator so the correct variant is validated.
// The RPC function re-derives voucher_type from transaction_type
// and rejects any mismatch, so this is a UI convenience layer.
// ============================================================

export const VoucherPreparationSchema = z.discriminatedUnion('voucherType', [
  FundsInVoucherSchema,
  FundsOutVoucherSchema,
  RolloverSlipVoucherSchema,
  TransferSlipVoucherSchema,
])

export type VoucherPreparationInput = z.infer<typeof VoucherPreparationSchema>

// ============================================================
// Transaction type → Voucher type mapping (Req 11.1)
// Used server-side to validate/resolve voucherType.
// ============================================================

export const TX_TYPE_TO_VOUCHER_TYPE: Record<string, VoucherType> = {
  INFLOW:                 'FUNDS_IN',
  MATURITY_TERMINATION:   'FUNDS_OUT',
  ANNIVERSARY_PAYMENT:    'FUNDS_OUT',
  PRE_LIQUIDATION:        'FUNDS_OUT',
  THIRD_PARTY_PAYMENT:    'FUNDS_OUT',
  SAVINGS_FUNDS_OUT:      'FUNDS_OUT',
  CALL_FUNDS_OUT:         'FUNDS_OUT',
  CMS_FUNDS_OUT:          'FUNDS_OUT',
  ROLLOVER:               'ROLLOVER_SLIP',
  INTERNAL_TRANSFER:      'TRANSFER_SLIP',
  REVERSAL:               'TRANSFER_SLIP',
}
