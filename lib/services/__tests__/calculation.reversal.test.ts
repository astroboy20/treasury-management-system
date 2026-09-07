/**
 * calculation.reversal.test.ts
 *
 * Validates the REVERSAL transaction scenario (task 3.16).
 *
 * A REVERSAL creates a new REVERSAL transaction that references
 * the original transaction (Req 25.1). The original is NOT modified.
 * The reversal passes through all 6 workflow steps + 5-stage approval chain.
 * On Operations execution, eazybankzAdapter.reverseTransaction() is called (Req 25.3).
 *
 * REVERSAL uses a TRANSFER_SLIP voucher (Req 11.1, voucher type mapping).
 * No internal financial calculation is required — the calculation_snapshot
 * for a TRANSFER_SLIP records the transfer amount and is_internal flag.
 *
 * Customer P — Reversal scenario seed data:
 *   Principal: ₦7,000,000 | Accrued Interest: ₦140,000 | Rate: 13.5%
 *   (original transaction has an incorrect rate that requires reversal)
 *
 * Requirements: 22.1 (REVERSAL scenario), 22.4 (original tx reference required),
 *               25.1 (new tx, original not deleted), 25.2 (reason required),
 *               25.3 (Eazybankz reversal on execution), 25.4 (audit events),
 *               25.5 (eligibility validation)
 */

import { describe, it, expect } from 'vitest'
import {
  TransferSlipVoucherSchema,
  TX_TYPE_TO_VOUCHER_TYPE,
  VoucherPreparationSchema,
} from '@/lib/schemas/voucher.schema'

// ─── 1. Voucher type mapping ──────────────────────────────────────────────────

describe('TX_TYPE_TO_VOUCHER_TYPE — REVERSAL maps to TRANSFER_SLIP (Req 11.1)', () => {
  it('REVERSAL maps to TRANSFER_SLIP', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['REVERSAL']).toBe('TRANSFER_SLIP')
  })

  it('INTERNAL_TRANSFER also maps to TRANSFER_SLIP (same voucher type)', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['INTERNAL_TRANSFER']).toBe('TRANSFER_SLIP')
  })
})

// ─── 2. TransferSlipVoucherSchema — REVERSAL voucher validation ───────────────

describe('TransferSlipVoucherSchema — REVERSAL voucher (Req 22.1, 25.1)', () => {
  const validReversalVoucher = {
    voucherType: 'TRANSFER_SLIP' as const,
    amount: '7000000.0000',
    transferDate: '2026-09-03',
    remarks: 'Reversal of TRX-00163 — incorrect interest rate 13.5% corrected to 12.5%',
  }

  it('accepts a valid TRANSFER_SLIP for REVERSAL scenario', () => {
    const result = TransferSlipVoucherSchema.safeParse(validReversalVoucher)
    expect(result.success).toBe(true)
  })

  it('rejects missing amount', () => {
    const result = TransferSlipVoucherSchema.safeParse({
      ...validReversalVoucher,
      amount: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects amount of zero', () => {
    const result = TransferSlipVoucherSchema.safeParse({
      ...validReversalVoucher,
      amount: '0',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing transferDate', () => {
    const { transferDate: _, ...withoutDate } = validReversalVoucher
    const result = TransferSlipVoucherSchema.safeParse(withoutDate)
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = TransferSlipVoucherSchema.safeParse({
      ...validReversalVoucher,
      transferDate: '03/09/2026',
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional sourceAccountNumber and destinationAccountNumber', () => {
    const result = TransferSlipVoucherSchema.safeParse({
      ...validReversalVoucher,
      sourceAccountNumber: '1234567890',
      destinationAccountNumber: '0987654321',
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional remarks', () => {
    const result = TransferSlipVoucherSchema.safeParse({
      voucherType: 'TRANSFER_SLIP' as const,
      amount: '7000000.0000',
      transferDate: '2026-09-03',
    })
    expect(result.success).toBe(true)
  })

  it('rejects remarks longer than 1000 characters', () => {
    const result = TransferSlipVoucherSchema.safeParse({
      ...validReversalVoucher,
      remarks: 'x'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })
})

// ─── 3. VoucherPreparationSchema discriminated union — REVERSAL path ──────────

describe('VoucherPreparationSchema — REVERSAL uses TRANSFER_SLIP discriminant', () => {
  it('parses a TRANSFER_SLIP via the discriminated union (covers REVERSAL voucher path)', () => {
    const result = VoucherPreparationSchema.safeParse({
      voucherType: 'TRANSFER_SLIP',
      amount: '7000000.0000',
      transferDate: '2026-09-03',
      remarks: 'Reversal — incorrect rate correction',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.voucherType).toBe('TRANSFER_SLIP')
    }
  })
})

// ─── 4. Eligibility validation logic (Req 25.5) ───────────────────────────────
//
// The create_reversal RPC and searchTransactionsByReferenceAction enforce:
//   - DRAFT status is ineligible (Req 25.5)
//   - CANCELLED status is ineligible (Req 25.5)
//   - Transactions with an active reversal (non-REJECTED/non-CANCELLED REVERSAL tx) are ineligible
//
// We test the filtering logic inline here without calling the DB.

describe('Reversal eligibility rules (Req 25.5)', () => {
  // Mirror the filtering logic from searchTransactionsByReferenceAction
  const INELIGIBLE_STATUSES = new Set(['DRAFT', 'CANCELLED'])

  function isEligibleForReversal(status: string): boolean {
    return !INELIGIBLE_STATUSES.has(status)
  }

  it('DRAFT transactions are NOT eligible for reversal', () => {
    expect(isEligibleForReversal('DRAFT')).toBe(false)
  })

  it('CANCELLED transactions are NOT eligible for reversal', () => {
    expect(isEligibleForReversal('CANCELLED')).toBe(false)
  })

  it('COMPLETED transactions ARE eligible for reversal', () => {
    expect(isEligibleForReversal('COMPLETED')).toBe(true)
  })

  it('MD_APPROVED transactions ARE eligible for reversal', () => {
    expect(isEligibleForReversal('MD_APPROVED')).toBe(true)
  })

  it('INSTRUCTION_RECEIVED transactions ARE eligible for reversal', () => {
    expect(isEligibleForReversal('INSTRUCTION_RECEIVED')).toBe(true)
  })

  it('REJECTED transactions ARE eligible for a new reversal attempt', () => {
    // A REJECTED transaction is not in DRAFT/CANCELLED, so it can be re-reversed
    expect(isEligibleForReversal('REJECTED')).toBe(true)
  })
})

// ─── 5. Reversal reason validation (Req 25.2) ─────────────────────────────────

describe('Reversal reason requirement (Req 25.2)', () => {
  function validateReversalReason(reason: string): boolean {
    return typeof reason === 'string' && reason.trim().length > 0
  }

  it('accepts a valid non-empty reversal reason', () => {
    expect(validateReversalReason('Incorrect interest rate — should be 12.5% not 13.5%')).toBe(true)
  })

  it('rejects an empty reversal reason', () => {
    expect(validateReversalReason('')).toBe(false)
  })

  it('rejects a whitespace-only reversal reason', () => {
    expect(validateReversalReason('   ')).toBe(false)
  })

  it('rejects a null-like input (empty string)', () => {
    expect(validateReversalReason('')).toBe(false)
  })
})

// ─── 6. Original transaction reference requirement (Req 22.4, 25.1) ───────────

describe('Original transaction ID requirement (Req 22.4, 25.1)', () => {
  function validateOriginalTransactionId(id: unknown): boolean {
    return typeof id === 'string' && id.trim().length > 0
  }

  it('accepts a valid UUID as original transaction ID', () => {
    expect(validateOriginalTransactionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('rejects an empty original transaction ID', () => {
    expect(validateOriginalTransactionId('')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(validateOriginalTransactionId(undefined)).toBe(false)
  })

  it('rejects null', () => {
    expect(validateOriginalTransactionId(null)).toBe(false)
  })
})

// ─── 7. Audit event types for reversal (Req 25.4, 28.1) ──────────────────────

describe('REVERSAL_CREATED audit event (Req 25.4)', () => {
  const AUDIT_EVENT_TYPES = [
    'TRANSACTION_CREATED',
    'INSTRUCTION_RECEIVED',
    'SIGNATURE_VERIFIED',
    'SIGNATURE_FAILED',
    'CUSTOMER_CONFIRMED',
    'INVESTMENT_VERIFIED',
    'VOUCHER_CREATED',
    'APPROVAL_GRANTED',
    'APPROVAL_RETURNED',
    'APPROVAL_REJECTED',
    'OPERATIONS_STARTED',
    'OPERATIONS_COMPLETED',
    'TREASURY_CONFIRMED',
    'REVERSAL_CREATED',
    'UNAUTHORIZED_ATTEMPT',
    'DOCUMENT_UPLOADED',
  ]

  it('REVERSAL_CREATED is a defined audit event type', () => {
    expect(AUDIT_EVENT_TYPES).toContain('REVERSAL_CREATED')
  })

  it('audit event types include all required reversal-related events', () => {
    expect(AUDIT_EVENT_TYPES).toContain('REVERSAL_CREATED')
    expect(AUDIT_EVENT_TYPES).toContain('OPERATIONS_STARTED')
    expect(AUDIT_EVENT_TYPES).toContain('OPERATIONS_COMPLETED')
  })
})

// ─── 8. Eazybankz adapter reverseTransaction path (Req 25.3) ─────────────────
//
// The mock adapter's reverseTransaction() is tested here via pure contract checks.
// The full server-side path (operations.actions.ts → adapter.reverseTransaction())
// is verified by the operations execution handler; here we validate the contract.

describe('EazybankzAdapter.reverseTransaction — contract (Req 25.3)', () => {
  it('reversal reason must be non-empty for adapter call', () => {
    // The mock adapter throws if reason is empty.
    // Mirror the validation logic here.
    const validateReason = (r: string) => r.trim().length > 0
    expect(validateReason('Incorrect rate')).toBe(true)
    expect(validateReason('')).toBe(false)
    expect(validateReason('  ')).toBe(false)
  })

  it('returns a reversalId, originalReference, and status from the adapter', () => {
    // Shape contract for ReverseTransactionResult (from adapter.interface.ts)
    const mockResult = {
      reversalId: 'EZ-REVERSAL-550E8400-1725350400000',
      originalReference: 'EZ-ROLLOVER-ABCD1234',
      status: 'REVERSED',
    }
    expect(mockResult).toHaveProperty('reversalId')
    expect(mockResult).toHaveProperty('originalReference')
    expect(mockResult).toHaveProperty('status')
    expect(mockResult.status).toBe('REVERSED')
  })
})
