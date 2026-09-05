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
  'P_AND_I',
  'PRINCIPAL_ONLY',
  'PARTIAL_PRINCIPAL',
  'INTEREST_ONLY',
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
  beneficiaryName: z
    .string({ error: 'Beneficiary name is required.' })
    .min(1, 'Beneficiary name is required.'),
  bankName: z
    .string({ error: 'Bank name is required.' })
    .min(1, 'Bank name is required.'),
  accountNumber: z
    .string({ error: 'Account number is required.' })
    .min(1, 'Account number is required.'),
  accountType: AccountTypeEnum,
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

    // External payment types require a full payment instruction (Req 7.7)
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
