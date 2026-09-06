/**
 * Property-Based Tests — Rollover INTEREST_ONLY Calculation Rule
 *
 * Tests the ROLLOVER_INTEREST_ONLY rule that mirrors the PostgreSQL
 * RPC `calculate_rollover` when called with p_rollover_type = 'INTEREST_ONLY'.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * SOP rule for INTEREST_ONLY:
 *   rollover_amount = principal  (principal stays invested — unchanged)
 *   interest_paid   = interest_due (paid out via linked FUNDS_OUT)
 *
 * The defining characteristic of INTEREST_ONLY vs PRINCIPAL_ONLY:
 *   - Both reinvest the full principal (rollover_amount = principal)
 *   - Both pay out the interest (interest_paid = interest_due)
 *   - The semantic difference is that INTEREST_ONLY is scheduled
 *     periodically (the principal is never "rolled" — it stays active)
 *     whereas PRINCIPAL_ONLY terminates the original investment and
 *     creates a new one.
 *
 * Requirements: 17.1, 17.5
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the ROLLOVER_INTEREST_ONLY rule ──────────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in the calculate_rollover RPC:
//
//   WHEN 'INTEREST_ONLY' THEN
//     v_rollover_amount := ROUND(p_principal, 4);
//     v_interest_paid   := ROUND(p_interest_due, 4);
//     v_outputs := jsonb_build_object(
//       'rollover_amount', v_rollover_amount::TEXT,
//       'interest_paid',   v_interest_paid::TEXT
//     );
//
// Inputs and outputs are NUMERIC-compatible strings, exactly as the
// TypeScript service layer receives them from the RPC.

/**
 * Rounds a number to 4 decimal places, matching PostgreSQL ROUND(x, 4).
 */
function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * The pure INTEREST_ONLY rollover rule, expressed as a TypeScript function
 * that mirrors the PostgreSQL RPC.
 *
 * For INTEREST_ONLY:
 *   - The principal investment remains active — it is NOT terminated.
 *   - Only the accrued interest is paid out via a linked FUNDS_OUT.
 *   - rollover_amount = principal (principal stays invested)
 *   - interest_paid   = interest_due
 *
 * @param principalStr     NUMERIC-compatible string, e.g. "10000000.0000"
 * @param interestDueStr   NUMERIC-compatible string, e.g. "1500000.0000"
 * @returns { rolloverAmount, interestPaid } as NUMERIC strings
 */
function rolloverInterestOnlyCalc(
  principalStr: string,
  interestDueStr: string,
): {
  rolloverAmount: string
  interestPaid: string
} {
  const principal = parseFloat(principalStr)
  const interestDue = parseFloat(interestDueStr)

  if (!isFinite(principal) || principal < 0) {
    throw new Error('INVALID_INPUT: principal must be a non-negative number')
  }
  if (!isFinite(interestDue) || interestDue < 0) {
    throw new Error('INVALID_INPUT: interest_due must be a non-negative number')
  }

  const rolloverAmount = roundTo4(principal)
  const interestPaid = roundTo4(interestDue)

  return {
    rolloverAmount: rolloverAmount.toString(),
    interestPaid: interestPaid.toString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a NUMERIC string to a JS Number for comparisons. */
const toNum = (s: string) => parseFloat(s)

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const positiveAmountArbitrary = fc
  .integer({ min: 1, max: 999_999_999 })
  .map((n) => n.toString())

const nonNegativeAmountArbitrary = fc
  .integer({ min: 0, max: 999_999_999 })
  .map((n) => n.toString())

// ─── Canonical SOP example ────────────────────────────────────────────────────

describe('Rollover INTEREST_ONLY — canonical SOP example (Req 17.5)', () => {
  it('reproduces the standard example: principal ₦10,000,000 stays invested; interest ₦1,500,000 paid out', () => {
    const result = rolloverInterestOnlyCalc('10000000', '1500000')

    // rollover_amount = principal = ₦10,000,000 (principal stays active)
    expect(toNum(result.rolloverAmount)).toBe(10_000_000)
    // interest_paid = interest_due = ₦1,500,000 (paid out separately)
    expect(toNum(result.interestPaid)).toBe(1_500_000)
  })

  it('rolloverAmount equals original principal when interest > 0', () => {
    const result = rolloverInterestOnlyCalc('5000000', '750000')

    expect(toNum(result.rolloverAmount)).toBe(5_000_000)
    expect(toNum(result.interestPaid)).toBe(750_000)
  })

  it('principal stays fully invested — rolloverAmount equals input principal', () => {
    const result = rolloverInterestOnlyCalc('25000000', '3125000')

    // Principal is not touched — rolloverAmount = original principal
    expect(toNum(result.rolloverAmount)).toBe(25_000_000)
    expect(toNum(result.interestPaid)).toBe(3_125_000)
  })
})

// ─── Property 1: rolloverAmount always equals principal ───────────────────────
//
// **Validates: Requirements 17.1, 17.5**
//
// For any valid principal and interest_due:
//   rollover_amount = principal   (principal investment remains active)
//
// This is the defining rule of INTEREST_ONLY (Req 17.5):
//   the principal is NOT paid out or replaced — it continues to be invested.

describe('Property 1 (Req 17.5) — rollover_amount always equals principal', () => {
  it('rolloverAmount equals principal for all valid inputs', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.rolloverAmount)).toBe(toNum(principalStr))
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rolloverAmount is always strictly positive when principal > 0', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.rolloverAmount)).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 2: interestPaid always equals interestDue ───────────────────────
//
// For INTEREST_ONLY rollovers the full interest_due is paid out externally
// via a linked FUNDS_OUT transaction — none is reinvested.

describe('Property 2 (Req 17.5) — interest_paid equals interest_due', () => {
  it('interestPaid equals interestDue for all valid inputs', () => {
    fc.assert(
      fc.property(
        nonNegativeAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.interestPaid)).toBe(toNum(interestDueStr))
        },
      ),
      { numRuns: 100 },
    )
  })

  it('interestPaid is always greater than zero when interest_due is positive', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        positiveAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.interestPaid)).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('zero interest_due results in zero interestPaid without affecting rolloverAmount', () => {
    const result = rolloverInterestOnlyCalc('10000000', '0')

    expect(toNum(result.interestPaid)).toBe(0)
    expect(toNum(result.rolloverAmount)).toBe(10_000_000)
  })
})

// ─── Property 3: principal unchanged — no deduction from rolloverAmount ───────
//
// Unlike PARTIAL_PRINCIPAL (which deducts a payout from the principal),
// INTEREST_ONLY must never reduce the rolloverAmount below the input principal.

describe('Property 3 (Req 17.5) — rolloverAmount equals input principal exactly (no deduction)', () => {
  it('rolloverAmount is never less than the input principal', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          // The principal is never reduced — it stays invested in full
          expect(toNum(result.rolloverAmount)).toBeGreaterThanOrEqual(toNum(principalStr))
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rolloverAmount is never greater than the input principal either (exact equality)', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.rolloverAmount)).toBe(roundTo4(toNum(principalStr)))
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 4: independence — interest_due does NOT affect rolloverAmount ───
//
// The interest amount has no effect on the reinvested (rollover) amount.
// Different interest values with the same principal must yield the same rollover.

describe('Property 4 (independence) — rolloverAmount is independent of interestDue', () => {
  it('for a fixed principal, rolloverAmount is the same regardless of interestDue', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestA, interestB) => {
          const resultA = rolloverInterestOnlyCalc(principalStr, interestA)
          const resultB = rolloverInterestOnlyCalc(principalStr, interestB)

          // Same principal → same rolloverAmount, regardless of interest
          expect(toNum(resultA.rolloverAmount)).toBe(toNum(resultB.rolloverAmount))
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 5: independence — principal does NOT affect interestPaid ────────
//
// The principal amount has no effect on the interest_paid output.

describe('Property 5 (independence) — interestPaid is independent of principal', () => {
  it('for a fixed interest_due, interestPaid is the same regardless of principal', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalA, principalB, interestDue) => {
          const resultA = rolloverInterestOnlyCalc(principalA, interestDue)
          const resultB = rolloverInterestOnlyCalc(principalB, interestDue)

          // Same interest_due → same interestPaid, regardless of principal
          expect(toNum(resultA.interestPaid)).toBe(toNum(resultB.interestPaid))
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 6: monotonicity — larger principal → larger rolloverAmount ──────

describe('Property 6 (monotonicity) — larger principal produces larger rolloverAmount', () => {
  it('if principal_a > principal_b then rolloverAmount(a) > rolloverAmount(b)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 0, max: 999_999_999 }),
        (a, b, interest) => {
          fc.pre(a !== b)

          const larger = Math.max(a, b).toString()
          const smaller = Math.min(a, b).toString()
          const interestStr = interest.toString()

          const largerResult = rolloverInterestOnlyCalc(larger, interestStr)
          const smallerResult = rolloverInterestOnlyCalc(smaller, interestStr)

          expect(toNum(largerResult.rolloverAmount)).toBeGreaterThan(
            toNum(smallerResult.rolloverAmount),
          )
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Differentiation from other rollover types ───────────────────────────────

describe('INTEREST_ONLY vs other rollover types', () => {
  it('INTEREST_ONLY rolloverAmount equals PRINCIPAL_ONLY rolloverAmount (same formula)', () => {
    // Both INTEREST_ONLY and PRINCIPAL_ONLY: rollover_amount = principal
    // The semantic difference is the operation on the investment record,
    // not the arithmetic formula.
    const principal = '10000000'
    const interestDue = '1500000'

    const result = rolloverInterestOnlyCalc(principal, interestDue)

    // rollover_amount = principal in both cases
    expect(toNum(result.rolloverAmount)).toBe(10_000_000)
  })

  it('INTEREST_ONLY rolloverAmount is strictly less than P+I rolloverAmount for any positive interest', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        positiveAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverInterestOnlyCalc(principalStr, interestDueStr)

          // P_AND_I rollover_amount = principal + interest_due
          const pandIRolloverAmount = roundTo4(
            toNum(principalStr) + toNum(interestDueStr),
          )

          // INTEREST_ONLY rollover_amount = principal < P_AND_I amount (when interest > 0)
          expect(toNum(result.rolloverAmount)).toBeLessThan(pandIRolloverAmount)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('INTEREST_ONLY rolloverAmount is strictly greater than PARTIAL_PRINCIPAL rolloverAmount for any valid payout > 0', () => {
    // PARTIAL_PRINCIPAL: rollover_amount = principal - payout < principal
    // INTEREST_ONLY: rollover_amount = principal
    const principal = 10_000_000
    const payout = 2_000_000 // deducted from principal for PARTIAL_PRINCIPAL

    const interestOnlyResult = rolloverInterestOnlyCalc(
      principal.toString(),
      '1500000',
    )
    const partialPrincipalRolloverAmount = roundTo4(principal - payout)

    expect(toNum(interestOnlyResult.rolloverAmount)).toBeGreaterThan(partialPrincipalRolloverAmount)
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws on negative principal', () => {
    expect(() => rolloverInterestOnlyCalc('-1', '500000')).toThrow('INVALID_INPUT')
  })

  it('throws on negative interest_due', () => {
    expect(() => rolloverInterestOnlyCalc('10000000', '-1')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN principal', () => {
    expect(() => rolloverInterestOnlyCalc('not-a-number', '0')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN interest_due', () => {
    expect(() => rolloverInterestOnlyCalc('10000000', 'not-a-number')).toThrow('INVALID_INPUT')
  })

  it('accepts zero interest_due without throwing', () => {
    expect(() => rolloverInterestOnlyCalc('10000000', '0')).not.toThrow()
  })

  it('accepts zero principal without throwing', () => {
    expect(() => rolloverInterestOnlyCalc('0', '1500000')).not.toThrow()
  })

  it('accepts minimum valid case: principal = 1, interest = 0', () => {
    const result = rolloverInterestOnlyCalc('1', '0')
    expect(toNum(result.rolloverAmount)).toBe(1)
    expect(toNum(result.interestPaid)).toBe(0)
  })
})
