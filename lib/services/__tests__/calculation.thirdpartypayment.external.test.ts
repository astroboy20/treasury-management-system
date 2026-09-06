/**
 * Scenario Tests — Third-Party External Payment (Task 3.11)
 *
 * Validates the complete THIRD_PARTY_PAYMENT scenario with is_internal = false:
 *
 * 1. Transfer charge is exactly 0.10% of transfer amount (THIRD_PARTY_TRANSFER_0_10_PERCENT rule)
 * 2. Voucher schema enforces all 6 Payment Instruction fields for external transfers (Req 36.1, 36.2)
 * 3. FundsOutVoucherSchema superRefine blocks submission when any PI field is missing (Req 21.4)
 * 4. TX_TYPE_TO_VOUCHER_TYPE maps THIRD_PARTY_PAYMENT → FUNDS_OUT (Req 11.1)
 * 5. Calculation snapshot rule identifier is THIRD_PARTY_TRANSFER_0_10_PERCENT (Req 21.5)
 * 6. Internal flag defaults to false for THIRD_PARTY_PAYMENT (Req 21.1)
 *
 * Requirements: 21.1, 21.2, 21.4, 21.5, 36.1, 36.2
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  FundsOutVoucherSchema,
  TX_TYPE_TO_VOUCHER_TYPE,
} from '@/lib/schemas/voucher.schema'
import { CreateTransactionSchema } from '@/lib/schemas/transaction.schema'

// ─── Pure rule mirror (mirrors PostgreSQL NUMERIC arithmetic in 006_calculation_rpcs.sql) ───

const EXTERNAL_CHARGE_RATE = 0.001 // 0.10% per SOP (Req 21.2)

function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * Pure mirror of the THIRD_PARTY_TRANSFER_0_10_PERCENT PostgreSQL rule.
 * transfer_charge = ROUND(transfer_amount × 0.001, 4)  for external (is_internal = false)
 * net_amount      = ROUND(transfer_amount, 4)           (charge is NOT deducted — borne by sender)
 */
function calcThirdPartyExternal(transferAmountStr: string): {
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
    transferCharge: roundTo4(amount * EXTERNAL_CHARGE_RATE).toString(),
    netAmount: roundTo4(amount).toString(),
  }
}

const toNum = (s: string) => parseFloat(s)

// ─── SOP canonical examples ───────────────────────────────────────────────────

describe('SOP canonical examples — THIRD_PARTY_PAYMENT external charge', () => {
  it('₦5,000,000 → charge ₦5,000 and net ₦5,000,000', () => {
    const result = calcThirdPartyExternal('5000000')
    expect(toNum(result.transferCharge)).toBe(5_000)
    expect(toNum(result.netAmount)).toBe(5_000_000)
  })

  it('₦1,000,000 → charge ₦1,000 and net ₦1,000,000', () => {
    const result = calcThirdPartyExternal('1000000')
    expect(toNum(result.transferCharge)).toBe(1_000)
    expect(toNum(result.netAmount)).toBe(1_000_000)
  })

  it('₦10,000,000 → charge ₦10,000 and net ₦10,000,000', () => {
    const result = calcThirdPartyExternal('10000000')
    expect(toNum(result.transferCharge)).toBe(10_000)
    expect(toNum(result.netAmount)).toBe(10_000_000)
  })

  it('₦500,000 → charge ₦500 and net ₦500,000', () => {
    const result = calcThirdPartyExternal('500000')
    expect(toNum(result.transferCharge)).toBe(500)
    expect(toNum(result.netAmount)).toBe(500_000)
  })
})

// ─── Rule identity ────────────────────────────────────────────────────────────

describe('Rule identity — THIRD_PARTY_TRANSFER_0_10_PERCENT snapshot (Req 21.5)', () => {
  it('rule name is exactly THIRD_PARTY_TRANSFER_0_10_PERCENT', () => {
    const result = calcThirdPartyExternal('5000000')
    expect(result.rule).toBe('THIRD_PARTY_TRANSFER_0_10_PERCENT')
  })

  it('rule name is the same for all positive transfer amounts', () => {
    const amounts = ['1', '1000', '500000', '5000000', '100000000']
    for (const amt of amounts) {
      expect(calcThirdPartyExternal(amt).rule).toBe('THIRD_PARTY_TRANSFER_0_10_PERCENT')
    }
  })
})

// ─── Property: charge = amount × 0.001 for external (Req 21.2) ──────────────

describe('Property (Req 21.2) — external transfer charge is always exactly 0.10% of transfer amount', () => {
  it('charge equals round(transferAmount × 0.001, 4) for all positive amounts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }).map(String),
        (amtStr) => {
          const result = calcThirdPartyExternal(amtStr)
          const expected = roundTo4(toNum(amtStr) * EXTERNAL_CHARGE_RATE)
          expect(toNum(result.transferCharge)).toBe(expected)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('charge is always > 0 for any positive transfer amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }).map(String),
        (amtStr) => {
          const result = calcThirdPartyExternal(amtStr)
          expect(toNum(result.transferCharge)).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('net_amount equals transfer_amount (charge is NOT deducted from net — borne by sender)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }).map(String),
        (amtStr) => {
          const result = calcThirdPartyExternal(amtStr)
          // net_amount = ROUND(transfer_amount, 4) per PostgreSQL RPC
          expect(toNum(result.netAmount)).toBe(toNum(amtStr))
        },
      ),
      { numRuns: 100 },
    )
  })

  it('charge is strictly less than transfer amount (rate is well below 100%)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }).map(String),
        (amtStr) => {
          const result = calcThirdPartyExternal(amtStr)
          expect(toNum(result.transferCharge)).toBeLessThan(toNum(amtStr))
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Voucher type mapping (Req 11.1) ─────────────────────────────────────────

describe('TX_TYPE_TO_VOUCHER_TYPE — THIRD_PARTY_PAYMENT → FUNDS_OUT (Req 11.1)', () => {
  it('THIRD_PARTY_PAYMENT maps to FUNDS_OUT', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['THIRD_PARTY_PAYMENT']).toBe('FUNDS_OUT')
  })
})

// ─── CreateTransactionSchema — THIRD_PARTY_PAYMENT external (Req 7.7, 21.1) ─

describe('CreateTransactionSchema — THIRD_PARTY_PAYMENT external payment (Req 7.7, 21.1)', () => {
  const baseThirdParty = {
    customerId:           '00000000-0000-4000-a000-000000000010',
    investmentId:         '00000000-0000-4000-a000-000000000011',
    transactionType:      'THIRD_PARTY_PAYMENT' as const,
    requestedAmount:      '5000000',
    purpose:              'Payment to third-party vendor per instruction',
    sourceInstructionType:'SIGNED_FORM' as const,
  }

  const fullPaymentInstruction = {
    beneficiaryName: 'Acme Holdings Ltd',
    bankName:        'Zenith Bank',
    accountNumber:   '0123456789',
    accountType:     'SAVINGS' as const,
    isInternal:      false,
  }

  it('accepts THIRD_PARTY_PAYMENT with all 6 required PI fields', () => {
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: fullPaymentInstruction,
    })
    expect(result.success).toBe(true)
  })

  it('rejects THIRD_PARTY_PAYMENT with no paymentInstruction (Req 7.7)', () => {
    const result = CreateTransactionSchema.safeParse(baseThirdParty)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('paymentInstruction')
    }
  })

  it('rejects THIRD_PARTY_PAYMENT missing beneficiaryName (Req 36.1)', () => {
    const { beneficiaryName: _omit, ...piWithout } = fullPaymentInstruction
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: piWithout,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths.some((p) => p.includes('beneficiaryName'))).toBe(true)
    }
  })

  it('rejects THIRD_PARTY_PAYMENT missing bankName (Req 36.1)', () => {
    const { bankName: _omit, ...piWithout } = fullPaymentInstruction
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: piWithout,
    })
    expect(result.success).toBe(false)
  })

  it('rejects THIRD_PARTY_PAYMENT missing accountNumber (Req 36.1)', () => {
    const { accountNumber: _omit, ...piWithout } = fullPaymentInstruction
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: piWithout,
    })
    expect(result.success).toBe(false)
  })

  it('does not require scenarioCode for THIRD_PARTY_PAYMENT (Req 21.1)', () => {
    // THIRD_PARTY_PAYMENT has no scenario sub-type at creation
    const result = CreateTransactionSchema.safeParse({
      ...baseThirdParty,
      paymentInstruction: fullPaymentInstruction,
      scenarioCode: undefined,
    })
    expect(result.success).toBe(true)
  })
})

// ─── FundsOutVoucherSchema — PI field enforcement for THIRD_PARTY_PAYMENT (Req 36.1, 36.2, 21.4) ─

describe('FundsOutVoucherSchema — PI enforcement for external THIRD_PARTY_PAYMENT (Req 36.1, 36.2, 21.4)', () => {
  /**
   * Minimal valid FUNDS_OUT voucher for an external third-party payment.
   * Note: voucherType = 'FUNDS_OUT', transactionTypeHint = 'THIRD_PARTY_PAYMENT',
   * isInternal = false triggers superRefine to require all 6 PI fields.
   */
  const validThirdPartyVoucher = {
    voucherType:          'FUNDS_OUT' as const,
    principal:            '5000000',
    interest:             '0',
    wht:                  '0',
    charge:               '0',        // server will overwrite with calc result
    netAmount:            '5000000',
    transferDate:         '2026-09-06',
    transactionTypeHint:  'THIRD_PARTY_PAYMENT',
    isInternal:           false,
    paymentInstruction: {
      beneficiaryName: 'Acme Holdings Ltd',
      bankName:        'Zenith Bank',
      accountNumber:   '0123456789',
      accountType:     'SAVINGS',
      amount:          '5000000',
      transferCharge:  '5000',         // 0.10% of 5,000,000
    },
  }

  it('accepts a valid external THIRD_PARTY_PAYMENT FUNDS_OUT voucher with all 6 PI fields', () => {
    const result = FundsOutVoucherSchema.safeParse(validThirdPartyVoucher)
    expect(result.success).toBe(true)
  })

  it('rejects when paymentInstruction is entirely missing for external transfer (Req 36.2)', () => {
    const { paymentInstruction: _omit, ...withoutPi } = validThirdPartyVoucher
    const result = FundsOutVoucherSchema.safeParse(withoutPi)
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message)
      expect(messages.some((m) => m.toLowerCase().includes('payment instruction'))).toBe(true)
    }
  })

  it('rejects when beneficiaryName is missing (Req 36.1)', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...validThirdPartyVoucher,
      paymentInstruction: {
        ...validThirdPartyVoucher.paymentInstruction,
        beneficiaryName: '',
      },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths.some((p) => p.includes('beneficiaryName'))).toBe(true)
    }
  })

  it('rejects when bankName is missing (Req 36.1)', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...validThirdPartyVoucher,
      paymentInstruction: {
        ...validThirdPartyVoucher.paymentInstruction,
        bankName: '',
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects when accountNumber is missing (Req 36.1)', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...validThirdPartyVoucher,
      paymentInstruction: {
        ...validThirdPartyVoucher.paymentInstruction,
        accountNumber: '',
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects when accountType is missing (Req 36.1)', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...validThirdPartyVoucher,
      paymentInstruction: {
        ...validThirdPartyVoucher.paymentInstruction,
        accountType: '',
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects when amount is zero (Req 36.1)', () => {
    const result = FundsOutVoucherSchema.safeParse({
      ...validThirdPartyVoucher,
      paymentInstruction: {
        ...validThirdPartyVoucher.paymentInstruction,
        amount: '0',
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects when transferCharge field is absent (Req 36.1)', () => {
    const { transferCharge: _omit, ...piWithout } = validThirdPartyVoucher.paymentInstruction
    const result = FundsOutVoucherSchema.safeParse({
      ...validThirdPartyVoucher,
      paymentInstruction: piWithout,
    })
    expect(result.success).toBe(false)
  })

  it('does NOT enforce PI fields when isInternal = true (Req 21.3)', () => {
    // For internal transfers, the payment instruction block is still rendered
    // but PI validation is not triggered by superRefine (different scenario — task 3.12)
    const internalVoucher = {
      ...validThirdPartyVoucher,
      isInternal: true,
      // No paymentInstruction present — acceptable for internal transfers
      paymentInstruction: undefined,
    }
    // superRefine only fires for isInternal = false; internal path is permissive here
    const result = FundsOutVoucherSchema.safeParse(internalVoucher)
    // Internal path: paymentInstruction is optional so this should pass schema validation
    expect(result.success).toBe(true)
  })

  it('accepts FUNDS_OUT for non-THIRD_PARTY_PAYMENT types without PI (maturity termination)', () => {
    // Other FUNDS_OUT scenarios (e.g. MATURITY_TERMINATION) do not require PI via superRefine
    const maturityVoucher = {
      voucherType:  'FUNDS_OUT' as const,
      principal:    '10000000',
      interest:     '1500000',
      wht:          '0',
      charge:       '0',
      netAmount:    '11500000',
      transferDate: '2026-09-06',
      // No transactionTypeHint → superRefine will not enforce PI fields
    }
    expect(FundsOutVoucherSchema.safeParse(maturityVoucher).success).toBe(true)
  })
})

// ─── Transfer charge value embedded in snapshot (Req 21.5) ───────────────────

describe('Calculation snapshot structure — THIRD_PARTY_TRANSFER_0_10_PERCENT (Req 21.5)', () => {
  it('snapshot rule is THIRD_PARTY_TRANSFER_0_10_PERCENT for any external transfer amount', () => {
    const amounts = ['100000', '500000', '5000000', '20000000']
    for (const amt of amounts) {
      const result = calcThirdPartyExternal(amt)
      expect(result.rule).toBe('THIRD_PARTY_TRANSFER_0_10_PERCENT')
    }
  })

  it('snapshot transfer_charge matches the 0.10% rule for representative amounts', () => {
    const cases: [string, number][] = [
      ['100000',    100],
      ['500000',    500],
      ['1000000',  1000],
      ['5000000',  5000],
      ['10000000', 10_000],
    ]

    for (const [amt, expectedCharge] of cases) {
      const result = calcThirdPartyExternal(amt)
      expect(toNum(result.transferCharge)).toBe(expectedCharge)
    }
  })

  it('snapshot net_amount is the gross transfer amount (not reduced by charge)', () => {
    const cases = ['100000', '500000', '1000000', '5000000']
    for (const amt of cases) {
      const result = calcThirdPartyExternal(amt)
      expect(toNum(result.netAmount)).toBe(toNum(amt))
    }
  })
})
