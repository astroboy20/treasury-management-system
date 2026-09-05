import { z } from 'zod'

// ============================================================
// Checklist result enum — PASSED | FAILED
// Mirrors migration 001 CHECK constraints on signature_verifications
// ============================================================

export const CheckResultEnum = z.enum(['PASSED', 'FAILED'])
export type CheckResult = z.infer<typeof CheckResultEnum>

// ============================================================
// SignatureVerificationSchema (Req 8.1–8.4)
// Four checklist items + optional notes.
// ============================================================

export const SignatureVerificationSchema = z.object({
  signatureResult: CheckResultEnum,
  mandateResult: CheckResultEnum,
  accountOwnershipResult: CheckResultEnum,
  completenessResult: CheckResultEnum,
  notes: z
    .string()
    .max(1000, 'Notes must be 1 000 characters or fewer.')
    .optional(),
})

export type SignatureVerificationInput = z.infer<typeof SignatureVerificationSchema>

// ============================================================
// CustomerConfirmationSchema (Req 9.1–9.2)
// Date, time, amounts, beneficiary, purpose, and status.
// ============================================================

export const ConfirmationStatusEnum = z.enum([
  'CONFIRMED',
  'FAILED',
  'UNREACHABLE',
])
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusEnum>

export const CustomerConfirmationSchema = z.object({
  // confirmation_date — ISO date string (YYYY-MM-DD)
  confirmationDate: z
    .string({ error: 'Confirmation date is required.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Confirmation date must be in YYYY-MM-DD format.'),

  // confirmation_time — HH:MM (24-hour)
  confirmationTime: z
    .string({ error: 'Confirmation time is required.' })
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Confirmation time must be in HH:MM format.'),

  // confirmed_amount — NUMERIC-compatible string
  confirmedAmount: z
    .string({ error: 'Confirmed amount is required.' })
    .min(1, 'Confirmed amount is required.')
    .refine(
      (val) => /^\d+(\.\d{1,4})?$/.test(val) && Number(val) > 0,
      'Confirmed amount must be a positive number.',
    ),

  // confirmed_beneficiary — optional; required for payment scenarios
  confirmedBeneficiary: z
    .string()
    .max(300, 'Beneficiary must be 300 characters or fewer.')
    .optional(),

  confirmedPurpose: z
    .string({ error: 'Confirmed purpose is required.' })
    .min(1, 'Confirmed purpose is required.')
    .max(500, 'Confirmed purpose must be 500 characters or fewer.'),

  confirmationStatus: ConfirmationStatusEnum,

  notes: z
    .string()
    .max(1000, 'Notes must be 1 000 characters or fewer.')
    .optional(),
})

export type CustomerConfirmationInput = z.infer<typeof CustomerConfirmationSchema>

// ============================================================
// InvestmentVerificationSchema (Req 10.2)
// Seven confirmed investment fields from the Eazybankz snapshot.
// All monetary/rate values are NUMERIC-compatible strings to
// preserve precision through the TypeScript layer.
// ============================================================

const numericString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required.` })
    .min(1, `${fieldName} is required.`)
    .refine(
      (val) => /^\d+(\.\d+)?$/.test(val) && Number(val) >= 0,
      `${fieldName} must be a non-negative number.`,
    )

const positiveNumericString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required.` })
    .min(1, `${fieldName} is required.`)
    .refine(
      (val) => /^\d+(\.\d+)?$/.test(val) && Number(val) > 0,
      `${fieldName} must be a positive number.`,
    )

const isoDateString = (fieldName: string) =>
  z
    .string({ error: `${fieldName} is required.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${fieldName} must be in YYYY-MM-DD format.`)

export const InvestmentVerificationSchema = z.object({
  principal: positiveNumericString('Principal'),
  accruedInterest: numericString('Accrued interest'),
  interestRate: positiveNumericString('Interest rate'),
  effectiveDate: isoDateString('Effective date'),

  // maturityDate is optional — CALL accounts may have no maturity date
  maturityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Maturity date must be in YYYY-MM-DD format.')
    .optional(),

  outstandingBalance: numericString('Outstanding balance'),
  availableAmount: numericString('Available amount'),
})

export type InvestmentVerificationInput = z.infer<typeof InvestmentVerificationSchema>
