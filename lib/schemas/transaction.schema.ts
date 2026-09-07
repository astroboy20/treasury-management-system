import { z } from 'zod'

// ============================================================
// Enums — derived from migration 001 CHECK constraints
// ============================================================

export const TransactionTypeEnum = z.enum([
  'ROLLOVER',
  'MATURITY_TERMINATION',
  'PRE_LIQUIDATION',
  'ANNIVERSARY_PAYMENT',
  'THIRD_PARTY_PAYMENT',
  'INTERNAL_TRANSFER',
  'INFLOW',
  'SAVINGS_FUNDS_OUT',
  'CALL_FUNDS_OUT',
  'CMS_FUNDS_OUT',
  'REVERSAL',
])
export type TransactionType = z.infer<typeof TransactionTypeEnum>

export const ScenarioCodeEnum = z.enum([
  // Rollover scenario codes
  'P_AND_I',
  'PRINCIPAL_ONLY',
  'PARTIAL_PRINCIPAL',
  'INTEREST_ONLY',
  // Anniversary payment scenario codes (Req 20.1)
  'ANNIVERSARY_30',
  'ANNIVERSARY_60',
  'ANNIVERSARY_90',
  // Internal transfer scenario codes (Req 22.1)
  'SAVINGS_TO_PERSONAL',
  'PERSONAL_TO_COMMERCIAL_PAPER',
  'PERSONAL_TO_CALL_PLACEMENT',
])
export type ScenarioCode = z.infer<typeof ScenarioCodeEnum>

export const SourceInstructionTypeEnum = z.enum([
  'LETTER',
  'EMAIL',
  'SIGNED_FORM',
  'MANDATED',
])
export type SourceInstructionType = z.infer<typeof SourceInstructionTypeEnum>

export const AccountTypeEnum = z.enum([
  'SAVINGS',
  'PERSONAL',
  'COMMERCIAL_PAPER',
  'CALL',
  'CMS',
])
export type AccountType = z.infer<typeof AccountTypeEnum>

// ============================================================
// Payment Instruction sub-schema
// Used for external third-party payment fields (Req 7.7)
// ============================================================

export const PaymentInstructionSchema = z.object({
  // Optional at the schema level — required fields are enforced in superRefine
  // based on isInternal. External: beneficiaryName + bankName + accountNumber + accountType.
  // Internal: accountNumber only (Req 21.1, 21.3).
  beneficiaryName: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountType: AccountTypeEnum.optional(),
  isInternal: z.boolean().optional(),
  purpose: z.string().optional(),
})
export type PaymentInstruction = z.infer<typeof PaymentInstructionSchema>

// ============================================================
// Transaction types that require an external payment instruction
// ============================================================
const EXTERNAL_PAYMENT_TYPES: TransactionType[] = [
  'THIRD_PARTY_PAYMENT',
]

// ============================================================
// CreateTransactionSchema (Req 7.1–7.7)
// ============================================================

export const CreateTransactionSchema = z
  .object({
    customerId: z
      .string({ error: 'Customer is required.' })
      .uuid('Invalid customer ID.'),

    investmentId: z.string().uuid('Invalid investment ID.').optional(),

    transactionType: TransactionTypeEnum,

    // scenarioCode is required for ROLLOVER; optional for others
    scenarioCode: ScenarioCodeEnum.optional(),

    requestedAmount: z
      .string({ error: 'Requested amount is required.' })
      .min(1, 'Requested amount is required.')
      .refine(
        (val) => /^\d+(\.\d{1,4})?$/.test(val) && Number(val) > 0,
        'Requested amount must be a positive number.',
      ),

    purpose: z
      .string({ error: 'Purpose is required.' })
      .min(1, 'Purpose is required.')
      .max(500, 'Purpose must be 500 characters or fewer.'),

    sourceInstructionType: SourceInstructionTypeEnum,

    // paymentInstruction is conditionally required — enforced in .superRefine()
    paymentInstruction: PaymentInstructionSchema.optional(),

    // requestedPayout is conditionally required for PARTIAL_PRINCIPAL rollovers
    requestedPayout: z
      .string()
      .refine(
        (val) => !val || (/^\d+(\.\d{1,4})?$/.test(val) && Number(val) > 0),
        'Requested payout must be a positive number.',
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    // ROLLOVER transactions must supply a scenario code
    if (data.transactionType === 'ROLLOVER' && !data.scenarioCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenarioCode'],
        message: 'Scenario code is required for rollover transactions.',
      })
    }

    // ANNIVERSARY_PAYMENT transactions must supply a scenario code
    if (data.transactionType === 'ANNIVERSARY_PAYMENT' && !data.scenarioCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenarioCode'],
        message: 'Scenario code is required for anniversary payment transactions.',
      })
    }

    // ANNIVERSARY_PAYMENT scenario code must be exactly ANNIVERSARY_30, ANNIVERSARY_60, or ANNIVERSARY_90 (Req 20.1)
    const VALID_ANNIVERSARY_CODES = new Set(['ANNIVERSARY_30', 'ANNIVERSARY_60', 'ANNIVERSARY_90'])
    if (
      data.transactionType === 'ANNIVERSARY_PAYMENT' &&
      data.scenarioCode &&
      !VALID_ANNIVERSARY_CODES.has(data.scenarioCode)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenarioCode'],
        message:
          'Anniversary payments only support frequencies of 30, 60, or 90 days (ANNIVERSARY_30, ANNIVERSARY_60, ANNIVERSARY_90).',
      })
    }

    // INTERNAL_TRANSFER transactions must supply a scenario code
    if (data.transactionType === 'INTERNAL_TRANSFER' && !data.scenarioCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenarioCode'],
        message: 'Scenario code is required for internal transfer transactions.',
      })
    }

    // PARTIAL_PRINCIPAL rollovers require a requestedPayout
    if (
      data.transactionType === 'ROLLOVER' &&
      data.scenarioCode === 'PARTIAL_PRINCIPAL' &&
      !data.requestedPayout
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedPayout'],
        message: 'Requested payout amount is required for Partial Principal rollovers.',
      })
    }

    // THIRD_PARTY_PAYMENT always requires a paymentInstruction block (Req 7.7, 21.1)
    if (EXTERNAL_PAYMENT_TYPES.includes(data.transactionType)) {
      if (!data.paymentInstruction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction'],
          message: 'Payment instruction is required for this transaction type.',
        })
        return
      }

      const pi = data.paymentInstruction

      // Internal transfers (Req 21.1, 21.3): only accountNumber is required
      if (pi.isInternal === true) {
        if (!pi.accountNumber) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['paymentInstruction', 'accountNumber'],
            message: 'Internal account number is required for internal transfers.',
          })
        }
        return
      }

      // External transfers (Req 7.7, 36.1): all 3 fields required
      if (!pi.beneficiaryName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'beneficiaryName'],
          message: 'Beneficiary name is required.',
        })
      }
      if (!pi.bankName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'bankName'],
          message: 'Bank name is required.',
        })
      }
      if (!pi.accountNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentInstruction', 'accountNumber'],
          message: 'Account number is required.',
        })
      }
    }
  })

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>
