/**
 * Property-Based Tests — Maturity Termination Calculation Rule
 *
 * Tests the MATURITY_TERMINATION rule that mirrors the PostgreSQL
 * RPC `calculate_maturity_termination` in
 * supabase/migrations/006_calculation_rpcs.sql.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * SOP rule:
 *   net_amount = principal + accrued_interest
 *   WHT        = 0 (per SOP — Req 11.3, 18.1)
 *
 * Requirements: 18.1, 18.2, 18.3, 26.1, 26.2
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the MATURITY_TERMINATION rule ────────────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic:
//
//   v_wht        := 0;   -- WHT is always 0 per SOP (Req 11.3)
//   v_net_amount := p_principal + p_accrued_interest;
//
// Inputs and outputs are NUMERIC-compatible strings, exactly as the
// TypeScript service layer receives them from the RPC.
// All intermediate arithmetic uses JavaScript's Number for this test layer;
// the authoritative server-side arithmetic uses PostgreSQL NUMERIC.

/**
 * Rounds a number to 4 decimal places, matching PostgreSQL ROUND(x, 4).
 */
function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * The pure maturity termination rule, expressed as a TypeScript function that
 * mirrors the PostgreSQL RPC.
 *
 * @param principalStr       NUMERIC-compatible string, e.g. "25000000.0000"
 * @param accruedInterestStr NUMERIC-compatible string, e.g. "1250000.0000"
 * @returns { netAmount, wht } as NUMERIC-compatible strings
 */
function maturityTerminationCalc(
  principalStr: string,
  accruedInterestStr: string,
): { netAmount: string; wht: string } {
  const principal = parseFloat(principalStr)
  const accruedInterest = parseFloat(accruedInterestStr)

  if (!isFinite(principal) || principal < 0) {
    throw new Error('INVALID_INPUT: principal must be a non-negative number')
  }
  if (!isFinite(accruedInterest) || accruedInterest < 0) {
    throw new Error('INVALID_INPUT: accrued_interest must be a non-negative number')
  }

  const wht = 0          // always 0 per SOP
  const netAmount = roundTo4(principal + accruedInterest)

  return {
    netAmount: netAmount.toString(),
    wht: wht.toString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a NUMERIC string to a JS Number for comparisons. */
const toNum = (s: string) => parseFloat(s)

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Integer amounts in [0, 999_999_999] expressed as strings.
 * Integers ensure no floating-point ambiguity in the test generator.
 */
const amountArbitrary = fc
  .integer({ min: 0, max: 999_999_999 })
  .map((n) => n.toString())

// ─── Canonical seed example (Customer E from design.md) ──────────────────────

describe('Maturity Termination — seed example (Customer E: ₦25M principal, ₦1.25M interest)', () => {
  it('reproduces the exact seed example: principal ₦25,000,000 + interest ₦1,250,000 = ₦26,250,000', () => {
    const result = maturityTerminationCalc('25000000.0000', '1250000.0000')

    expect(toNum(result.netAmount)).toBe(26_250_000)
    expect(toNum(result.wht)).toBe(0)
  })

  it('also accepts integer string form', () => {
    const result = maturityTerminationCalc('25000000', '1250000')

    expect(toNum(result.netAmount)).toBe(26_250_000)
    expect(toNum(result.wht)).toBe(0)
  })
})

// ─── Property 1: WHT is always exactly zero ───────────────────────────────────
//
// Per SOP (Req 11.3, 18.1): WHT is defaulted to zero for maturity termination.

describe('Property 1 — WHT is always zero for maturity termination (Req 11.3, 18.1)', () => {
  it('wht = 0 for all valid input combinations', () => {
    fc.assert(
      fc.property(amountArbitrary, amountArbitrary, (principalStr, accruedInterestStr) => {
        const result = maturityTerminationCalc(principalStr, accruedInterestStr)

        expect(toNum(result.wht)).toBe(0)
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 2: net_amount = principal + accrued_interest ────────────────────
//
// Per Req 18.1: net_amount = principal + accrued_interest.

describe('Property 2 — net_amount = principal + accrued_interest (Req 18.1)', () => {
  it('net_amount equals the sum of principal and accrued interest for all valid inputs', () => {
    fc.assert(
      fc.property(amountArbitrary, amountArbitrary, (principalStr, accruedInterestStr) => {
        const result = maturityTerminationCalc(principalStr, accruedInterestStr)

        const principal = toNum(principalStr)
        const accruedInterest = toNum(accruedInterestStr)
        const expectedNetAmount = roundTo4(principal + accruedInterest)

        expect(toNum(result.netAmount)).toBe(expectedNetAmount)
      }),
      { numRuns: 1000 },
    )
  })

  it('net_amount is always >= principal (accrued interest is non-negative)', () => {
    fc.assert(
      fc.property(amountArbitrary, amountArbitrary, (principalStr, accruedInterestStr) => {
        const result = maturityTerminationCalc(principalStr, accruedInterestStr)

        expect(toNum(result.netAmount)).toBeGreaterThanOrEqual(toNum(principalStr))
      }),
      { numRuns: 1000 },
    )
  })

  it('net_amount is always >= accrued_interest (principal is non-negative)', () => {
    fc.assert(
      fc.property(amountArbitrary, amountArbitrary, (principalStr, accruedInterestStr) => {
        const result = maturityTerminationCalc(principalStr, accruedInterestStr)

        expect(toNum(result.netAmount)).toBeGreaterThanOrEqual(toNum(accruedInterestStr))
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 3: identity law — zero accrued interest returns principal ────────

describe('Property 3 — identity law: zero accrued interest means net_amount = principal', () => {
  it('net_amount equals principal when accrued_interest = 0', () => {
    fc.assert(
      fc.property(amountArbitrary, (principalStr) => {
        const result = maturityTerminationCalc(principalStr, '0')

        expect(toNum(result.netAmount)).toBe(toNum(principalStr))
      }),
      { numRuns: 500 },
    )
  })

  it('net_amount equals accrued_interest when principal = 0', () => {
    fc.assert(
      fc.property(amountArbitrary, (accruedInterestStr) => {
        const result = maturityTerminationCalc('0', accruedInterestStr)

        expect(toNum(result.netAmount)).toBe(toNum(accruedInterestStr))
      }),
      { numRuns: 500 },
    )
  })

  it('net_amount is 0 when both inputs are 0', () => {
    const result = maturityTerminationCalc('0', '0')

    expect(toNum(result.netAmount)).toBe(0)
    expect(toNum(result.wht)).toBe(0)
  })
})

// ─── Property 4: monotonicity ─────────────────────────────────────────────────

describe('Property 4 — monotonicity: larger inputs produce larger net_amount', () => {
  it('if principal_a > principal_b and accrued_interest is equal, then net_amount(a) > net_amount(b)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (a, b, interest) => {
          fc.pre(a !== b)

          const larger = Math.max(a, b).toString()
          const smaller = Math.min(a, b).toString()
          const interestStr = interest.toString()

          const largerResult = maturityTerminationCalc(larger, interestStr)
          const smallerResult = maturityTerminationCalc(smaller, interestStr)

          expect(toNum(largerResult.netAmount)).toBeGreaterThan(toNum(smallerResult.netAmount))
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ─── Property 5: commutativity — order of principal and interest doesn't matter ─
//
// The sum is commutative: net_amount(p, i) = net_amount(i, p)
// (Not a financial law, but a sanity check on the implementation.)

describe('Property 5 — commutativity: sum is order-independent', () => {
  it('maturityTerminationCalc(a, b).netAmount equals maturityTerminationCalc(b, a).netAmount', () => {
    fc.assert(
      fc.property(amountArbitrary, amountArbitrary, (a, b) => {
        const resultAB = maturityTerminationCalc(a, b)
        const resultBA = maturityTerminationCalc(b, a)

        expect(toNum(resultAB.netAmount)).toBe(toNum(resultBA.netAmount))
      }),
      { numRuns: 500 },
    )
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws on negative principal', () => {
    expect(() => maturityTerminationCalc('-1', '100')).toThrow('INVALID_INPUT')
  })

  it('throws on negative accrued interest', () => {
    expect(() => maturityTerminationCalc('1000', '-1')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN principal', () => {
    expect(() => maturityTerminationCalc('not-a-number', '100')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN accrued interest', () => {
    expect(() => maturityTerminationCalc('1000', 'not-a-number')).toThrow('INVALID_INPUT')
  })
})
