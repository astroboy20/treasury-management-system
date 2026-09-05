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
// For SAVINGS/CALL/CMS: availableBalance replaces principal (Req 38)
// ============================================================

export const FundsOutVoucherSchema = z.object({
  voucherType: z.literal('FUNDS_OUT'),

  // principal is required for standard Funds-Out scenarios
  principal: positiveNumericString('Principal'),

  // interest may be 0 for certain scenarios
  interest: numericString('Interest'),

  // WHT — defaults to 0 per SOP (optional; server defaults to 0 if absent)
  wht: numericString('WHT').optional(),

  // charge — pre-liquidation charge; 0 for maturity/anniversary (optional; server defaults to 0)
  charge: numericString('Charge').optional(),

  // net_amount — authoritative value computed by server; submitted
  // for display/confirmation; server validates against snapshot
  netAmount: positiveNumericString('Net amount'),

  // availableBalance — for SAVINGS/CALL/CMS Funds-Out (Req 38)
  availableBalance: numericString('Available balance').optional(),

  transferDate: isoDateString('Transfer date'),
  remarks,
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

  rolloverMaturityDate: isoDateString('Rollover maturity date'),

  // Optional: interest payout amount for PRINCIPAL_ONLY / INTEREST_ONLY rollovers
  interestPayout: numericString('Interest payout').optional(),

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
