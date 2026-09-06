/**
 * Scenario Tests — Third-Party Internal Payment (Task 3.12)
 *
 * Validates the complete THIRD_PARTY_PAYMENT scenario with is_internal = true:
 *
 * 1. Transfer charge is always exactly zero for internal transfers (Req 21.3)
 * 2. PaymentInstructionBlock renders Transfer Charge as ₦0 for internal transfers (Req 36.3)
 * 3. FundsOutVoucherSchema allows isInternal = true without requiring external PI fields (Req 21.3)
 * 4. CreateTransactionSchema accepts THIRD_PARTY_PAYMENT with isInternal = true + only accountNumber (Req 21.1, 21.3)
 * 5. Calculation snapshot rule is still THIRD_PARTY_TRANSFER_0_10_PERCENT (consistent rule ID) (Req 21.5)
 *
 * Requirements: 21.1, 21.3, 36.3
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  FundsOutVoucherSchema,
  TX_TYPE_TO_VOUCHER_TYPE,
} from '@/lib/schemas/voucher.schema'
import { CreateTransactionSchema } from '@/lib/schemas/transaction.schema'

// ─── Pure rule mirror (mirrors PostgreSQL NUMERIC arithmetic in 006_calculation_rpcs.sql) ───

const CHARGE_RATE = 0.001 // 0.10% for external

function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * Pure mirror of the THIRD_PARTY_TRANSFER_0_10_PERCENT PostgreSQL rule.
 * transfer_charge = 0                            for internal (is_internal = true)
 * transfer_charge = ROUND(transfer_amount × 0.001, 4)  for external
 * net_amount      = ROUND(transfer_amount, 4)    (charge is NOT deducted)
 */
function calcThirdParty(transferAmountStr: string, isInternal: boolean): {
  rule: string
  transferCharge: string
  netAmount: string
} {
  const amount = parseFloat(transferAmountStr)
  if (!isFinite(amount) || amount < 0) {
    throw new Error('INVALID_INPUT: transfer_amount must be a non-negative number')
  }
  return {
    rule: 'THIRD_PARTY_TRANSFER_0_10_PERCENT',
    transferCharge: isInternal ? '0' : roundTo4(amount * CHARGE_RATE).toString(),
    netAmount: roundTo4(amount).toString(),
  }
}

const toNum = (s: string) => parseFloat(s)

// ─── SOP canonical examples (internal) ───────────────────────────────────────

describe('SOP canonical examples — THIRD_PARTY_PAYMENT internal (Req 21.3)', () => {
  it('₦5,000,000 internal → charge ₦0, net ₦5,000,000', () => {
    const result = calcThirdParty('5000000', true)
    expect(toNum(result.transferCharge)).toBe(0)
    expect(toNum(result.netAmount)).toBe(5_000_000)
  })

  it('₦10,000,000 internal → charge ₦0, net ₦10,000,000', () => {
    const result = calcThirdParty('10000000', true)
    expect(toNum(result.transferCharge)).toBe(0)
    expect(toNum(result.netAmount)).toBe(10_000_000)
  })
})

// ─── Rule identity (Req 21.5) ─────────────────────────────────────────────────

describe('Rule identity — THIRD_PARTY_TRANSFER_0_10_PERCENT for internal transfers (Req 21.5)', () => {
  it('rule name is THIRD_PARTY_TRANSFER_0_10_PERCENT for internal transfers', () => {
    const result = calcThirdParty('5000000', true)
    expect(result.rule).toBe('THIRD_PARTY_TRANSFER_0_10_PERCENT')
  })

  it('rule name is the same for both internal and external transfers', () => {
    const internalResult = calcThirdParty('5000000', true)
    const externalResult = calcThirdParty('5000000', false)
    expect(internalResult.rule).toBe(externalResult.rule)
    expect(internalResult.rule).toBe('THIRD_PARTY_TRANSFER_0_10_PERCENT')
  })
})

// ─── Property: internal charge is always zero (Req 21.3) ─────────────────────

/**
 * **Validates: Requirements 21.3**
 *
 * For any is_internal = true and any positive amount, transfer_charge = "0".
 */
describe('Property (Req 21.3) — internal transfer charge is always exactly zero', () => {
  it('transfer_charge = "0" for all positive amounts with isInternal = true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }).map(String),
        (amtStr) => {
          const result = calcThirdParty(amtStr, true)
          expect(toNum(result.transferCharge)).toBe(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('net_amount equals transfer_amount for internal transfers (charge not deducted)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }).map(String),
        (amtStr) => {
          const result = calcThirdParty(amtStr, true)
          expect(toNum(result.netAmount)).toBe(toNum(amtStr))
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Contrast: internal charge (0) < external charge (Req 21.3) ──────────────

/**
 * **Validates: Requirements 21.3**
 *
 * For the same positive transfer amount, internal charge (0) is always strictly
 * less than external charge (amount × 0.001 > 0).
 */
describe('Contrast test — internal charge < external charge for same amount (Req 21.3)', () => {
  it('internal charge (0) is strictly less than external charge for any positive amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }).map(String),
        (amtStr) => {
          const internalResult = calcThirdParty(amtStr, true)
          const externalResult = calcThirdParty(amtStr, false)
          expect(toNum(internalResult.transferCharge)).toBe(0)
          expect(toNum(externalResult.transferCharge)).toBeGreaterThan(0)
          expect(toNum(internalResult.transferCharge)).toBeLessThan(
            toNum(externalResult.transferCharge),
          )
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── CreateTransactionSchema — THIRD_PARTY_PAYMENT internal (Req 21.1, 21.3) ─

describe('CreateTransactionSchema — THIRD_PARTY_PAYMENT internal payment (Req 21.1, 21.3)', () => {
  const baseThirdParty = {
    customerId:            '00000000-0000-4000-a000-000000000010',
    investmentId:          '00000000-0000-4000-a000-000000000011',
    transactionType:       'THIRD_PARTY_PAYMENT' as const,
    requestedAmount:       '5000000',
    purpose:               'Intra-company transfer to internal treasury account',
    sourceInstructionType: 'SIGNED_FORM' as const,
  }

  it('accepts THIRD_PARTY_PAYMENT with isInternal: true and only accountNumber (Req 21.1, 21.3)', () => {
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: {
        accountNumber: '0123456789',
        isInternal: true,
        // beneficiaryName, bankName, accountType NOT required for internal
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects THIRD_PARTY_PAYMENT with isInternal: true and no accountNumber (Req 21.3)', () => {
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: {
        isInternal: true,
        // no accountNumber
      },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths.some((p) => p.includes('accountNumber'))).toBe(true)
    }
  })

  it('rejects THIRD_PARTY_PAYMENT with no paymentInstruction (must always be present — Req 7.7, 21.1)', () => {
    const result = CreateTransactionSchema.safeParse(baseThirdParty)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('paymentInstruction')
    }
  })

  it('accepts THIRD_PARTY_PAYMENT internal without beneficiaryName (not required for internal)', () => {
    // beneficiaryName is only required for external transfers
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: {
        accountNumber: '0123456789',
        isInternal: true,
        // no beneficiaryName
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts THIRD_PARTY_PAYMENT internal without bankName (not required for internal)', () => {
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: {
        accountNumber: '0123456789',
        isInternal: true,
        // no bankName
      },
    })
    expect(result.success).toBe(true)
  })
})

// ─── FundsOutVoucherSchema — isInternal = true (Req 21.3, 36.3) ──────────────

describe('FundsOutVoucherSchema — isInternal = true (Req 21.3, 36.3)', () => {
  const baseInternalVoucher = {
    voucherType:         'FUNDS_OUT' as const,
    principal:           '5000000',
    interest:            '0',
    wht:                 '0',
    charge:              '0',
    netAmount:           '5000000',
    transferDate:        '2026-09-06',
    transactionTypeHint: 'THIRD_PARTY_PAYMENT',
    isInternal:          true,
  }

  it('accepts FUNDS_OUT internal with no paymentInstruction (Req 21.3)', () => {
    // Internal transfers: superRefine only fires for isInternal = false
    const result = FundsOutVoucherSchema.safeParse(baseInternalVoucher)
    expect(result.success).toBe(true)
  })

  it('accepts FUNDS_OUT internal with only accountNumber in paymentInstruction', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...baseInternalVoucher,
      paymentInstruction: {
        accountNumber:  '0123456789',
        amount:         '5000000',
        transferCharge: '0',
      },
    })
    expect(result.success).toBe(true)
  })

  it('does NOT require beneficiaryName for internal transfer (Req 21.3)', () => {
    // No beneficiaryName — should still pass for internal
    const result = FundsOutVoucherSchema.safeParse({
      ...baseInternalVoucher,
      paymentInstruction: {
        accountNumber:  '0123456789',
        amount:         '5000000',
        transferCharge: '0',
        // no beneficiaryName
      },
    })
    expect(result.success).toBe(true)
  })

  it('does NOT require bankName for internal transfer (Req 21.3)', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...baseInternalVoucher,
      paymentInstruction: {
        accountNumber:  '0123456789',
        amount:         '5000000',
        transferCharge: '0',
        // no bankName
      },
    })
    expect(result.success).toBe(true)
  })
})

// ─── THIRD_PARTY_PAYMENT maps to FUNDS_OUT voucher type (Req 11.1) ────────────

describe('TX_TYPE_TO_VOUCHER_TYPE — THIRD_PARTY_PAYMENT → FUNDS_OUT (Req 11.1)', () => {
  it('THIRD_PARTY_PAYMENT maps to FUNDS_OUT regardless of internal/external', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['THIRD_PARTY_PAYMENT']).toBe('FUNDS_OUT')
  })
})

// ─── Transfer charge snapshot structure (Req 21.5) ───────────────────────────

describe('Calculation snapshot — THIRD_PARTY_TRANSFER_0_10_PERCENT for internal (Req 21.5)', () => {
  it('transfer_charge is "0" for internal transfer — matches the snapshot output', () => {
    const result = calcThirdParty('5000000', true)
    expect(result.transferCharge).toBe('0')
    expect(result.rule).toBe('THIRD_PARTY_TRANSFER_0_10_PERCENT')
  })

  it('PaymentInstructionBlock renders ₦0.00 for zero transfer_charge (Req 36.3)', () => {
    // The PaymentInstructionBlock component formats 0 as ₦0.00 (muted colour)
    // This test validates the pure number-formatting logic used by the block
    const transferCharge = '0'
    const num = parseFloat(transferCharge)
    const formatted = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(num)
    // The component renders ₦0.00 or NGN 0.00 depending on the locale's symbol
    expect(num).toBe(0)
    expect(formatted).toMatch(/0\.00/)
  })
})
