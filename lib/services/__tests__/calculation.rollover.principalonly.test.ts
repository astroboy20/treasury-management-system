/**
 * Property-Based Tests — Rollover PRINCIPAL_ONLY Calculation Rule
 *
 * Tests the ROLLOVER_PRINCIPAL_ONLY rule that mirrors the PostgreSQL
 * RPC `calculate_rollover` when called with p_rollover_type = 'PRINCIPAL_ONLY'.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * SOP rule for PRINCIPAL_ONLY:
 *   principal_rolled = principal   (reinvested — does NOT change)
 *   interest_paid    = interest_due (paid out via linked FUNDS_OUT)
 *   rollover_amount  = principal   (only the principal is rolled)
 *
 * Requirements: 17.1, 17.3
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the ROLLOVER_PRINCIPAL_ONLY rule ──────────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in the calculate_rollover RPC:
//
//   WHEN 'PRINCIPAL_ONLY' THEN
//     v_principal_rolled := p_principal;
//     v_interest_paid    := p_interest_due;
//     v_rollover_amount  := p_principal;
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
 * The pure PRINCIPAL_ONLY rollover rule, expressed as a TypeScript function
 * that mirrors the PostgreSQL RPC.
 *
 * @param principalStr     NUMERIC-compatible string, e.g. "10000000.0000"
 * @param interestDueStr   NUMERIC-compatible string, e.g. "1500000.0000"
 * @returns { rolloverAmount, principalRolled, interestPaid } as NUMERIC strings
 */
function rolloverPrincipalOnlyCalc(
  principalStr: string,
  interestDueStr: string,
): {
  rolloverAmount: string
  principalRolled: string
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

  const principalRolled = roundTo4(principal)
  const interestPaid = roundTo4(interestDue)
  const rolloverAmount = roundTo4(principal)

  return {
    rolloverAmount: rolloverAmount.toString(),
    principalRolled: principalRolled.toString(),
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

describe('Rollover PRINCIPAL_ONLY — canonical SOP example (Req 17.3)', () => {
  it('reproduces the standard example: principal ₦10,000,000 + interest ₦1,500,000', () => {
    const result = rolloverPrincipalOnlyCalc('10000000', '1500000')

    // rollover_amount = principal = ₦10,000,000
    expect(toNum(result.rolloverAmount)).toBe(10_000_000)
    // principal_rolled = principal = ₦10,000,000
    expect(toNum(result.principalRolled)).toBe(10_000_000)
    // interest_paid = interest_due = ₦1,500,000 (paid out separately)
    expect(toNum(result.interestPaid)).toBe(1_500_000)
  })

  it('rolloverAmount === principalRolled === original principal', () => {
    const result = rolloverPrincipalOnlyCalc('5000000', '750000')

    expect(toNum(result.rolloverAmount)).toBe(toNum(result.principalRolled))
    expect(toNum(result.rolloverAmount)).toBe(5_000_000)
  })
})

// ─── Property 1: rolloverAmount always equals principal ───────────────────────
//
// For any valid principal and interest_due:
//   rollover_amount = principal   (only principal is reinvested)
//
// This is the defining characteristic of PRINCIPAL_ONLY vs P_AND_I.
// P_AND_I: rollover_amount = principal + interest_due
// PRINCIPAL_ONLY: rollover_amount = principal (interest is paid out)

describe('Property 1 (Req 17.3) — rollover_amount always equals principal', () => {
  it('rolloverAmount equals principal for all valid inputs', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.rolloverAmount)).toBe(toNum(principalStr))
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rolloverAmount is strictly less than P+I rollover for any positive interest', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        positiveAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

          // P_AND_I rollover_amount = principal + interest_due
          const pandIRolloverAmount =
            roundTo4(toNum(principalStr) + toNum(interestDueStr))

          // PRINCIPAL_ONLY rollover_amount = principal < P_AND_I amount
          expect(toNum(result.rolloverAmount)).toBeLessThan(pandIRolloverAmount)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 2: principalRolled always equals original principal ─────────────
//
// The reinvested amount is exactly the original principal — no deduction.

describe('Property 2 (Req 17.3) — principal_rolled equals original principal', () => {
  it('principalRolled equals principal for all valid inputs', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.principalRolled)).toBe(toNum(principalStr))
        },
      ),
      { numRuns: 100 },
    )
  })

  it('rolloverAmount === principalRolled for all valid inputs', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.rolloverAmount)).toBe(toNum(result.principalRolled))
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 3: interestPaid always equals interestDue ───────────────────────
//
// For PRINCIPAL_ONLY rollovers the full interest_due is paid out externally
// via a linked FUNDS_OUT transaction — none is reinvested.

describe('Property 3 (Req 17.3) — interest_paid equals interest_due', () => {
  it('interestPaid equals interestDue for all valid inputs', () => {
    fc.assert(
      fc.property(
        nonNegativeAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

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
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

          expect(toNum(result.interestPaid)).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('zero interest_due results in zero interestPaid', () => {
    const result = rolloverPrincipalOnlyCalc('10000000', '0')

    expect(toNum(result.interestPaid)).toBe(0)
    expect(toNum(result.rolloverAmount)).toBe(10_000_000)
  })
})

// ─── Property 4: conservation — rolloverAmount + interestPaid = P+I total ─────
//
// The sum of what is reinvested and what is paid out always equals
// the total (principal + interest_due), as in the P_AND_I rollover.
// This is the conservation invariant across all rollover types.

describe('Property 4 (conservation) — rolloverAmount + interestPaid = principal + interest_due', () => {
  it('the total payout is conserved across the rollover split', () => {
    fc.assert(
      fc.property(
        nonNegativeAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestDueStr) => {
          const result = rolloverPrincipalOnlyCalc(principalStr, interestDueStr)

          const total = roundTo4(toNum(result.rolloverAmount) + toNum(result.interestPaid))
          const expected = roundTo4(toNum(principalStr) + toNum(interestDueStr))

          expect(total).toBe(expected)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 5: independence — interest_due does NOT affect rolloverAmount ───
//
// The interest amount has no effect on the reinvested (rollover) amount.
// Different interest values with the same principal must yield the same rollover.

describe('Property 5 (independence) — rolloverAmount is independent of interestDue', () => {
  it('for a fixed principal, rolloverAmount is the same regardless of interestDue', () => {
    fc.assert(
      fc.property(
        positiveAmountArbitrary,
        nonNegativeAmountArbitrary,
        nonNegativeAmountArbitrary,
        (principalStr, interestA, interestB) => {
          const resultA = rolloverPrincipalOnlyCalc(principalStr, interestA)
          const resultB = rolloverPrincipalOnlyCalc(principalStr, interestB)

          // Same principal → same rolloverAmount, regardless of interest
          expect(toNum(resultA.rolloverAmount)).toBe(toNum(resultB.rolloverAmount))
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

          const largerResult = rolloverPrincipalOnlyCalc(larger, interestStr)
          const smallerResult = rolloverPrincipalOnlyCalc(smaller, interestStr)

          expect(toNum(largerResult.rolloverAmount)).toBeGreaterThan(
            toNum(smallerResult.rolloverAmount),
          )
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Differentiation from P_AND_I ────────────────────────────────────────────

describe('PRINCIPAL_ONLY vs P_AND_I differentiation', () => {
  it('PRINCIPAL_ONLY rolloverAmount is less than P_AND_I rolloverAmount when interest > 0', () => {
    // PRINCIPAL_ONLY: rollover_amount = principal
    // P_AND_I:        rollover_amount = principal + interest_due
    const principal = '10000000'
    const interestDue = '1500000'

    const principalOnlyResult = rolloverPrincipalOnlyCalc(principal, interestDue)

    // Simulated P_AND_I result for comparison
    const pandIRolloverAmount = roundTo4(toNum(principal) + toNum(interestDue))

    expect(toNum(principalOnlyResult.rolloverAmount)).toBeLessThan(pandIRolloverAmount)
    expect(toNum(principalOnlyResult.rolloverAmount)).toBe(toNum(principal))
    expect(toNum(principalOnlyResult.interestPaid)).toBe(toNum(interestDue))
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws on negative principal', () => {
    expect(() => rolloverPrincipalOnlyCalc('-1', '500000')).toThrow('INVALID_INPUT')
  })

  it('throws on negative interest_due', () => {
    expect(() => rolloverPrincipalOnlyCalc('10000000', '-1')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN principal', () => {
    expect(() => rolloverPrincipalOnlyCalc('not-a-number', '0')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN interest_due', () => {
    expect(() => rolloverPrincipalOnlyCalc('10000000', 'not-a-number')).toThrow('INVALID_INPUT')
  })

  it('accepts zero interest_due without throwing', () => {
    expect(() => rolloverPrincipalOnlyCalc('10000000', '0')).not.toThrow()
  })

  it('accepts zero principal without throwing', () => {
    expect(() => rolloverPrincipalOnlyCalc('0', '1500000')).not.toThrow()
  })
})
