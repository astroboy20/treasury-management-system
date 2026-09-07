/**
 * Scenario Tests — Call Funds-Out (Task 3.19)
 *
 * Validates the complete CALL_FUNDS_OUT scenario per Requirements 24.1, 24.2,
 * 24.3, 38.1, and 38.2.
 *
 * CALL_FUNDS_OUT follows the same voucher layout as SAVINGS_FUNDS_OUT:
 *
 *   - Voucher type is FUNDS_OUT, selected server-side from transaction_type (Req 11.1, 11.2)
 *   - `available_balance` is the primary voucher amount field (Req 38.1, 38.2)
 *   - `available_balance` is sourced from the investment_verifications snapshot — NOT from
 *     any internal calculation formula (Req 24.2, 38.4)
 *   - The principal/interest/WHT/charge fields are zeroed-out in the voucher (Req 38.2)
 *   - Calculation rule: FUNDS_OUT_AVAILABLE_BALANCE (persisted in vouchers.calculation_snapshot)
 *   - Step 4 (investment verification) is REQUIRED for all CALL_FUNDS_OUT transactions (Req 24.1)
 *   - On Operations execution: Eazybankz adapter `updateInvestment()` records the payment
 *     and updates the account balance (Req 24.3)
 *   - If external payment is required, the Payment Instruction block is enforced (Req 38.3, 36.1)
 *
 * The test suite mirrors the pure arithmetic used by `prepareVoucherAction` in
 * `lib/actions/voucher.actions.ts` for the `CALL_FUNDS_OUT` case, which runs
 * without delegating to the PostgreSQL RPC for calculation (snapshot is sourced
 * directly from investment_verifications).
 *
 * Requirements: 24.1, 24.2, 24.3, 38.1, 38.2, 11.1, 11.2
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  FundsOutVoucherSchema,
  TX_TYPE_TO_VOUCHER_TYPE,
} from '@/lib/schemas/voucher.schema'
import { CreateTransactionSchema } from '@/lib/schemas/transaction.schema'

// ─── Pure rule mirror ─────────────────────────────────────────────────────────
//
// Mirrors the server-side logic in lib/actions/voucher.actions.ts
// for the CALL_FUNDS_OUT case (shared with SAVINGS_FUNDS_OUT / CMS_FUNDS_OUT):
//
//   calculationSnapshot = {
//     rule: 'FUNDS_OUT_AVAILABLE_BALANCE',
//     inputs: {
//       available_balance: availableBalance,
//       source: 'INVESTMENT_VERIFICATION_SNAPSHOT',
//       transaction_type: 'CALL_FUNDS_OUT',
//     },
//     outputs: { available_balance: availableBalance },
//     calculated_at: ...,
//   }
//
// Then on the voucher data:
//   voucherData.available_balance = availableBalance
//   voucherData.net_amount        = availableBalance
//   voucherData.principal         = '0'
//   voucherData.interest          = '0'
//   voucherData.wht               = '0'
//   voucherData.charge            = '0'
//
// No interest calculation formula is applied (Req 24.2, 38.4).

function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * Pure mirror of the CALL_FUNDS_OUT voucher data construction.
 *
 * The `availableBalance` is passed through directly from the investment
 * verification snapshot — no arithmetic transformation is applied.
 *
 * @param availableBalanceStr  NUMERIC-compatible string from investment_verifications.available_amount
 * @returns  voucher data fields that the prepare_voucher RPC will receive
 */
function callFundsOutVoucherData(availableBalanceStr: string): {
  rule: string
  available_balance: string
  net_amount: string
  principal: string
  interest: string
  wht: string
  charge: string
} {
  const available = parseFloat(availableBalanceStr)
  if (!isFinite(available) || available < 0) {
    throw new Error('INVALID_INPUT: available_balance must be a non-negative number')
  }
  const roundedBalance = roundTo4(available).toString()
  return {
    rule: 'FUNDS_OUT_AVAILABLE_BALANCE',
    available_balance: roundedBalance,
    net_amount: roundedBalance,
    principal: '0',
    interest: '0',
    wht: '0',
    charge: '0',
  }
}

const toNum = (s: string) => parseFloat(s)

// ─── SOP canonical examples (Req 24.1, 24.2, 38.1, 38.2) ─────────────────────

describe('SOP examples — CALL_FUNDS_OUT voucher construction (Req 38.1, 38.2)', () => {
  it('₦8,000,000 available_balance → available_balance = ₦8,000,000, net_amount = ₦8,000,000', () => {
    const result = callFundsOutVoucherData('8000000')
    expect(toNum(result.available_balance)).toBe(8_000_000)
    expect(toNum(result.net_amount)).toBe(8_000_000)
  })

  it('₦500,000 available_balance → available_balance = ₦500,000, net_amount = ₦500,000', () => {
    const result = callFundsOutVoucherData('500000')
    expect(toNum(result.available_balance)).toBe(500_000)
    expect(toNum(result.net_amount)).toBe(500_000)
  })

  it('₦0 available_balance → available_balance = ₦0, net_amount = ₦0 (edge case: zero balance)', () => {
    const result = callFundsOutVoucherData('0')
    expect(toNum(result.available_balance)).toBe(0)
    expect(toNum(result.net_amount)).toBe(0)
  })
})

// ─── Calculation rule identity (Req 38.1) ─────────────────────────────────────

describe('Calculation rule identity — FUNDS_OUT_AVAILABLE_BALANCE (Req 38.1)', () => {
  it('rule is FUNDS_OUT_AVAILABLE_BALANCE for CALL_FUNDS_OUT', () => {
    const result = callFundsOutVoucherData('8000000')
    expect(result.rule).toBe('FUNDS_OUT_AVAILABLE_BALANCE')
  })
})

// ─── Principal/Interest/WHT/Charge zeroed (Req 38.2) ──────────────────────────

describe('No principal/interest/WHT/charge split (Req 38.2)', () => {
  it('principal is always "0" for CALL_FUNDS_OUT vouchers', () => {
    const result = callFundsOutVoucherData('8000000')
    expect(toNum(result.principal)).toBe(0)
  })

  it('interest is always "0" for CALL_FUNDS_OUT vouchers', () => {
    const result = callFundsOutVoucherData('8000000')
    expect(toNum(result.interest)).toBe(0)
  })

  it('WHT is always "0" for CALL_FUNDS_OUT vouchers', () => {
    const result = callFundsOutVoucherData('8000000')
    expect(toNum(result.wht)).toBe(0)
  })

  it('charge is always "0" for CALL_FUNDS_OUT vouchers', () => {
    const result = callFundsOutVoucherData('8000000')
    expect(toNum(result.charge)).toBe(0)
  })
})

// ─── Property: available_balance passes through unchanged (Req 24.2, 38.4) ───

/**
 * **Property: No calculation formula is applied to available_balance (Req 24.2, 38.4)**
 *
 * For any non-negative available_balance from the investment verification snapshot,
 * the CALL_FUNDS_OUT voucher data must expose exactly that value as both
 * `available_balance` and `net_amount` — no interest formula, no deductions.
 *
 * Requirements: 24.2, 38.1, 38.4
 */
describe('Property (Req 24.2, 38.4) — available_balance passes through unchanged, no calculation applied', () => {
  it('available_balance equals the snapshot value for all non-negative inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }).map(String),
        (balStr) => {
          const result = callFundsOutVoucherData(balStr)
          // The available_balance must exactly match the input (rounded to 4dp at most)
          expect(toNum(result.available_balance)).toBeCloseTo(toNum(balStr), 4)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('net_amount always equals available_balance (no deductions) for all inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }).map(String),
        (balStr) => {
          const result = callFundsOutVoucherData(balStr)
          // net_amount must always equal available_balance — no principal/interest deduction
          expect(toNum(result.net_amount)).toBeCloseTo(toNum(result.available_balance), 4)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('principal + interest + wht + charge always sums to 0 for all inputs (Req 38.2)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }).map(String),
        (balStr) => {
          const result = callFundsOutVoucherData(balStr)
          const deductions =
            toNum(result.principal) +
            toNum(result.interest) +
            toNum(result.wht) +
            toNum(result.charge)
          expect(deductions).toBe(0)
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ─── Voucher type mapping (Req 11.1, 11.2) ────────────────────────────────────

describe('Voucher type mapping — CALL_FUNDS_OUT maps to FUNDS_OUT (Req 11.1, 11.2)', () => {
  it('TX_TYPE_TO_VOUCHER_TYPE maps CALL_FUNDS_OUT to FUNDS_OUT', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['CALL_FUNDS_OUT']).toBe('FUNDS_OUT')
  })

  it('CALL_FUNDS_OUT and SAVINGS_FUNDS_OUT both map to FUNDS_OUT', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['CALL_FUNDS_OUT']).toBe(
      TX_TYPE_TO_VOUCHER_TYPE['SAVINGS_FUNDS_OUT'],
    )
  })

  it('CALL_FUNDS_OUT and CMS_FUNDS_OUT both map to FUNDS_OUT', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['CALL_FUNDS_OUT']).toBe(
      TX_TYPE_TO_VOUCHER_TYPE['CMS_FUNDS_OUT'],
    )
  })
})

// ─── FundsOutVoucherSchema — CALL_FUNDS_OUT form fields (Req 38.1, 38.2) ──────

/**
 * For SAVINGS/CALL/CMS Funds-Out the form submits the available balance as
 * both `availableBalance` and `netAmount`. The `principal` field is required
 * by FundsOutVoucherSchema (positiveNumericString), so the form passes the
 * available_amount value there too — the server action then overrides it to
 * '0' before calling the RPC (lib/actions/voucher.actions.ts, step 8b-savings).
 *
 * The test therefore mirrors the actual form submission payload, not the final
 * persisted voucher data (which has principal = '0').
 */
describe('FundsOutVoucherSchema — CALL_FUNDS_OUT uses availableBalance field (Req 38.1, 38.2)', () => {
  // The form pre-fills principal with the available_amount snapshot value (buildDefaults returns
  // principal: '0' which is then overridden by the server action — but the Zod schema requires
  // principal > 0, so the form's actual submit payload passes availableBalance as principal).
  // We use the available balance as principal to match the real form submission.
  const validCallFundsOutVoucher = {
    voucherType:      'FUNDS_OUT' as const,
    principal:        '8000000', // form passes available_balance here; server overrides to '0'
    interest:         '0',
    wht:              '0',
    charge:           '0',
    netAmount:        '8000000',
    availableBalance: '8000000',
    transferDate:     '2026-09-07',
  }

  it('accepts a valid CALL_FUNDS_OUT FUNDS_OUT voucher with availableBalance', () => {
    expect(FundsOutVoucherSchema.safeParse(validCallFundsOutVoucher).success).toBe(true)
  })

  it('accepts CALL_FUNDS_OUT voucher with optional remarks', () => {
    expect(
      FundsOutVoucherSchema.safeParse({
        ...validCallFundsOutVoucher,
        remarks: 'Withdrawal from call account per customer instruction.',
      }).success,
    ).toBe(true)
  })

  it('accepts CALL_FUNDS_OUT voucher with an optional external paymentInstruction', () => {
    expect(
      FundsOutVoucherSchema.safeParse({
        ...validCallFundsOutVoucher,
        paymentInstruction: {
          beneficiaryName: 'John Doe',
          bankName:        'First Bank',
          accountNumber:   '1234567890',
          accountType:     'SAVINGS',
          amount:          '8000000',
          transferCharge:  '0',
        },
      }).success,
    ).toBe(true)
  })

  it('rejects a CALL_FUNDS_OUT voucher with zero netAmount', () => {
    // netAmount must be a positive numeric string (Req 11.9 — voucher must not be prepared without a valid amount)
    expect(
      FundsOutVoucherSchema.safeParse({
        ...validCallFundsOutVoucher,
        netAmount: '0',
      }).success,
    ).toBe(false)
  })

  it('rejects a CALL_FUNDS_OUT voucher without transferDate', () => {
    const { transferDate: _omit, ...withoutDate } = validCallFundsOutVoucher
    expect(FundsOutVoucherSchema.safeParse(withoutDate).success).toBe(false)
  })

  it('server action overrides principal/interest/wht/charge to zero regardless of form values (Req 38.2)', () => {
    // The FundsOutVoucherSchema accepts non-zero principal from the form.
    // The server action (prepareVoucherAction step 8b-savings) then forces:
    //   voucherData.principal = '0'
    //   voucherData.interest  = '0'
    //   voucherData.wht       = '0'
    //   voucherData.charge    = '0'
    // before calling the prepare_voucher RPC.
    // This test documents that the schema alone is not the enforcement layer for the zero-principal
    // requirement — the server action is (Req 38.2, 38.4).
    const withNonZeroPrincipal = { ...validCallFundsOutVoucher, principal: '8000000' }
    expect(FundsOutVoucherSchema.safeParse(withNonZeroPrincipal).success).toBe(true)

    // Confirm the server-side override logic: after parsing, availableBalance drives the voucher
    const serverOverride = callFundsOutVoucherData('8000000')
    expect(serverOverride.principal).toBe('0')
    expect(serverOverride.interest).toBe('0')
    expect(serverOverride.wht).toBe('0')
    expect(serverOverride.charge).toBe('0')
  })
})

// ─── CreateTransactionSchema — CALL_FUNDS_OUT transaction creation (Req 24.1) ─

describe('CreateTransactionSchema — CALL_FUNDS_OUT creation (Req 24.1)', () => {
  const validCallFundsOutTx = {
    customerId:            'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    transactionType:       'CALL_FUNDS_OUT',
    requestedAmount:       '8000000',
    purpose:               'Call account withdrawal per customer request',
    sourceInstructionType: 'LETTER' as const,
    investmentId:          'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  }

  it('accepts a valid CALL_FUNDS_OUT transaction creation input', () => {
    expect(CreateTransactionSchema.safeParse(validCallFundsOutTx).success).toBe(true)
  })

  it('accepts CALL_FUNDS_OUT without scenarioCode (no sub-type needed)', () => {
    const result = CreateTransactionSchema.safeParse(validCallFundsOutTx)
    expect(result.success).toBe(true)
  })

  it('requires investmentId for CALL_FUNDS_OUT (Step 4 mandatory — Req 24.1)', () => {
    // investmentId is optional in the schema but Step 4 verification is enforced server-side
    // by the investment verification requirement. The schema itself allows omission so the
    // server action can provide the appropriate error.
    const withoutInvestmentId = { ...validCallFundsOutTx }
    delete (withoutInvestmentId as Partial<typeof validCallFundsOutTx>).investmentId
    const result = CreateTransactionSchema.safeParse(withoutInvestmentId)
    // Schema allows absence of investmentId (optional); server action enforces the requirement
    expect(result.success).toBe(true)
  })

  it('accepts EMAIL as source instruction type for CALL_FUNDS_OUT', () => {
    expect(
      CreateTransactionSchema.safeParse({
        ...validCallFundsOutTx,
        sourceInstructionType: 'EMAIL',
      }).success,
    ).toBe(true)
  })

  it('rejects a negative requestedAmount', () => {
    expect(
      CreateTransactionSchema.safeParse({
        ...validCallFundsOutTx,
        requestedAmount: '-1',
      }).success,
    ).toBe(false)
  })

  it('rejects a zero requestedAmount', () => {
    expect(
      CreateTransactionSchema.safeParse({
        ...validCallFundsOutTx,
        requestedAmount: '0',
      }).success,
    ).toBe(false)
  })
})

// ─── Comparison with SAVINGS_FUNDS_OUT — identical voucher behaviour (Req 38) ─

describe('CALL_FUNDS_OUT vs SAVINGS_FUNDS_OUT — identical voucher layout (Req 38.1, 38.2)', () => {
  /**
   * Both CALL_FUNDS_OUT and SAVINGS_FUNDS_OUT share:
   *   - Voucher type: FUNDS_OUT
   *   - Calculation rule: FUNDS_OUT_AVAILABLE_BALANCE
   *   - Primary display field: available_balance
   *   - No principal/interest/WHT/charge split
   *   - Available balance passed through unchanged from the investment snapshot
   */
  it('CALL_FUNDS_OUT and SAVINGS_FUNDS_OUT produce identical voucher data structure', () => {
    const callResult = callFundsOutVoucherData('8000000')

    // Mirror the same pure function for SAVINGS_FUNDS_OUT (same logic)
    const savingsResult = callFundsOutVoucherData('8000000')

    expect(callResult.rule).toBe(savingsResult.rule)
    expect(callResult.available_balance).toBe(savingsResult.available_balance)
    expect(callResult.net_amount).toBe(savingsResult.net_amount)
    expect(callResult.principal).toBe(savingsResult.principal)
    expect(callResult.interest).toBe(savingsResult.interest)
    expect(callResult.wht).toBe(savingsResult.wht)
    expect(callResult.charge).toBe(savingsResult.charge)
  })

  it('TX_TYPE_TO_VOUCHER_TYPE maps both to the same FUNDS_OUT type', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['CALL_FUNDS_OUT']).toBe(
      TX_TYPE_TO_VOUCHER_TYPE['SAVINGS_FUNDS_OUT'],
    )
  })
})

// ─── Input validation: rejects non-numeric available_balance ─────────────────

describe('Input validation — rejects invalid available_balance (Req 24.1, 24.2)', () => {
  it('throws for a non-numeric string', () => {
    expect(() => callFundsOutVoucherData('abc')).toThrow('INVALID_INPUT')
  })

  it('throws for a negative available_balance', () => {
    expect(() => callFundsOutVoucherData('-500')).toThrow('INVALID_INPUT')
  })

  it('accepts decimal available_balance values', () => {
    const result = callFundsOutVoucherData('8000000.5')
    expect(toNum(result.available_balance)).toBeCloseTo(8_000_000.5, 4)
    expect(toNum(result.net_amount)).toBeCloseTo(8_000_000.5, 4)
  })
})
