/**
 * Property-Based Tests — Rollover PARTIAL_PRINCIPAL Calculation Rule
 *
 * Tests the ROLLOVER_PARTIAL_PRINCIPAL rule that mirrors the PostgreSQL
 * RPC `calculate_rollover` when called with p_rollover_type = 'PARTIAL_PRINCIPAL'.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * SOP rule for PARTIAL_PRINCIPAL:
 *   remaining_principal = original_principal − requested_payout
 *   rollover_amount     = remaining_principal  (reinvested)
 *   interest_due        = passed through (paid out separately)
 *
 * **Validates: Requirements 17.1, 17.4**
 *
 * Requirements: 17.1, 17.4
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the ROLLOVER_PARTIAL_PRINCIPAL rule ───────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in the calculate_rollover RPC:
//
//   WHEN 'PARTIAL_PRINCIPAL' THEN
//     v_remaining_principal := p_principal - p_requested_payout;
//     v_rollover_amount     := v_remaining_principal;
//     v_interest_paid       := p_interest_due;
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
 * The pure PARTIAL_PRINCIPAL rollover rule, expressed as a TypeScript function
 * that mirrors the PostgreSQL RPC.
 *
 * @param principalStr       NUMERIC-compatible string, e.g. "10000000.0000"
 * @param interestDueStr     NUMERIC-compatible string, e.g. "1500000.0000"
 * @param requestedPayoutStr NUMERIC-compatible string — the payout amount
 * @returns { remainingPrincipal, rolloverAmount, interestPaid } as NUMERIC strings
 */
function rolloverPartialPrincipalCalc(
  principalStr: string,
  interestDueStr: string,
  requestedPayoutStr: string,
): {
  remainingPrincipal: string
  rolloverAmount: string
  interestPaid: string
} {
  const principal = parseFloat(principalStr)
  const interestDue = parseFloat(interestDueStr)
  const requestedPayout = parseFloat(requestedPayoutStr)

  if (!isFinite(principal) || principal <= 0) {
    throw new Error('INVALID_INPUT: principal must be a positive number')
  }
  if (!isFinite(interestDue) || interestDue < 0) {
    throw new Error('INVALID_INPUT: interest_due must be a non-negative number')
  }
  if (!isFinite(requestedPayout) || requestedPayout <= 0) {
    throw new Error('INVALID_INPUT: requested_payout must be a positive number')
  }
  if (requestedPayout >= principal) {
    throw new Error(
      'INVALID_INPUT: requested_payout must be less than principal',
    )
  }

  const remainingPrincipal = roundTo4(principal - requestedPayout)
  const rolloverAmount = remainingPrincipal
  const interestPaid = roundTo4(interestDue)

  return {
    remainingPrincipal: remainingPrincipal.toString(),
    rolloverAmount: rolloverAmount.toString(),
    interestPaid: interestPaid.toString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a NUMERIC string to a JS Number for comparisons. */
const toNum = (s: string) => parseFloat(s)

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generates a valid (principal, requestedPayout) pair where 0 < requestedPayout < principal.
 * Both are integers in [1, 999_999_999] so there are no floating-point ambiguities.
 */
const validPartialPrincipalArbitrary = fc
  .integer({ min: 2, max: 999_999_999 })
  .chain((principal) =>
    fc
      .integer({ min: 1, max: principal - 1 })
      .map((payout) => ({
        principal: principal.toString(),
        requestedPayout: payout.toString(),
      })),
  )

const nonNegativeAmountArbitrary = fc
  .integer({ min: 0, max: 999_999_999 })
  .map((n) => n.toString())

// ─── Canonical SOP example ────────────────────────────────────────────────────

describe('Rollover PARTIAL_PRINCIPAL — canonical SOP example (Req 17.4)', () => {
  it('reproduces canonical example: principal ₦10,000,000 − payout ₦2,000,000 = remaining ₦8,000,000', () => {
    const result = rolloverPartialPrincipalCalc('10000000', '1500000', '2000000')

    // remaining_principal = 10,000,000 − 2,000,000 = 8,000,000
    expect(toNum(result.remainingPrincipal)).toBe(8_000_000)
    // rollover_amount = remaining_principal = 8,000,000
    expect(toNum(result.rolloverAmount)).toBe(8_000_000)
    // interest_due passes through
    expect(toNum(result.interestPaid)).toBe(1_500_000)
  })

  it('remaining_principal = principal − requested_payout for the canonical values', () => {
    const principal = 10_000_000
    const payout = 2_000_000

    const result = rolloverPartialPrincipalCalc(
      principal.toString(),
      '0',
      payout.toString(),
    )

    expect(toNum(result.remainingPrincipal)).toBe(principal - payout)
  })
})

// ─── Property 1: remaining_principal = principal − requested_payout ───────────
//
// **Validates: Requirements 17.1, 17.4**
//
// For any valid principal and requested_payout where 0 < requested_payout < principal:
//   remaining_principal = principal − requested_payout
//
// This is the defining rule of PARTIAL_PRINCIPAL (Req 17.4).

describe('Property 1 (Req 17.4) — remaining_principal = principal − requested_payout, always', () => {
  it('remaining_principal equals principal minus requested_payout for all valid inputs', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestDue) => {
          const result = rolloverPartialPrincipalCalc(principal, interestDue, requestedPayout)

          const expectedRemaining = roundTo4(toNum(principal) - toNum(requestedPayout))

          expect(toNum(result.remainingPrincipal)).toBe(expectedRemaining)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('remaining_principal is always strictly positive when 0 < payout < principal', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestDue) => {
          const result = rolloverPartialPrincipalCalc(principal, interestDue, requestedPayout)

          expect(toNum(result.remainingPrincipal)).toBeGreaterThan(0)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('remaining_principal is always less than original principal', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestDue) => {
          const result = rolloverPartialPrincipalCalc(principal, interestDue, requestedPayout)

          expect(toNum(result.remainingPrincipal)).toBeLessThan(toNum(principal))
        },
      ),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 2: rolloverAmount always equals remainingPrincipal ──────────────
//
// The reinvested amount is exactly the remaining_principal — the portion
// of the original principal that was NOT paid out.

describe('Property 2 (Req 17.4) — rollover_amount always equals remaining_principal', () => {
  it('rolloverAmount equals remainingPrincipal for all valid inputs', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestDue) => {
          const result = rolloverPartialPrincipalCalc(principal, interestDue, requestedPayout)

          expect(toNum(result.rolloverAmount)).toBe(toNum(result.remainingPrincipal))
        },
      ),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 3: conservation — remainingPrincipal + requestedPayout = principal

describe('Property 3 (conservation) — remaining_principal + requested_payout = original_principal', () => {
  it('the split is conservative: no value is lost or gained', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestDue) => {
          const result = rolloverPartialPrincipalCalc(principal, interestDue, requestedPayout)

          const reconstructed = roundTo4(
            toNum(result.remainingPrincipal) + toNum(requestedPayout),
          )
          expect(reconstructed).toBe(toNum(principal))
        },
      ),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 4: independence — interest_due does NOT affect remainingPrincipal
//
// The interest amount has no effect on the remaining_principal calculation.
// Different interest values with the same principal and payout must yield
// the same remaining_principal.

describe('Property 4 (independence) — remainingPrincipal is independent of interestDue', () => {
  it('for fixed principal and payout, remainingPrincipal is the same regardless of interestDue', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestA, interestB) => {
          const resultA = rolloverPartialPrincipalCalc(principal, interestA, requestedPayout)
          const resultB = rolloverPartialPrincipalCalc(principal, interestB, requestedPayout)

          expect(toNum(resultA.remainingPrincipal)).toBe(toNum(resultB.remainingPrincipal))
          expect(toNum(resultA.rolloverAmount)).toBe(toNum(resultB.rolloverAmount))
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ─── Property 5: monotonicity — larger payout → smaller remainingPrincipal ────

describe('Property 5 (monotonicity) — larger payout produces smaller remainingPrincipal', () => {
  it('if payout_a > payout_b then remainingPrincipal(a) < remainingPrincipal(b)', () => {
    fc.assert(
      fc.property(
        // principal in [3, 999_999_999], two distinct payouts both < principal
        fc.integer({ min: 3, max: 999_999_999 }).chain((principal) =>
          fc
            .tuple(
              fc.integer({ min: 1, max: principal - 2 }),
              fc.integer({ min: 1, max: principal - 2 }),
            )
            .filter(([a, b]) => a !== b)
            .map(([a, b]) => ({
              principal: principal.toString(),
              payoutA: a.toString(),
              payoutB: b.toString(),
            })),
        ),
        fc.integer({ min: 0, max: 999_999_999 }),
        ({ principal, payoutA, payoutB }, interest) => {
          const largerPayout = String(Math.max(toNum(payoutA), toNum(payoutB)))
          const smallerPayout = String(Math.min(toNum(payoutA), toNum(payoutB)))
          const interestStr = interest.toString()

          const resultLarger = rolloverPartialPrincipalCalc(principal, interestStr, largerPayout)
          const resultSmaller = rolloverPartialPrincipalCalc(principal, interestStr, smallerPayout)

          expect(toNum(resultLarger.remainingPrincipal)).toBeLessThan(
            toNum(resultSmaller.remainingPrincipal),
          )
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ─── Differentiation from P_AND_I and PRINCIPAL_ONLY ─────────────────────────

describe('PARTIAL_PRINCIPAL vs other rollover types', () => {
  it('PARTIAL_PRINCIPAL rolloverAmount is strictly between 0 and principal', () => {
    const result = rolloverPartialPrincipalCalc('10000000', '1500000', '2000000')

    expect(toNum(result.rolloverAmount)).toBeGreaterThan(0)
    expect(toNum(result.rolloverAmount)).toBeLessThan(10_000_000)
  })

  it('PARTIAL_PRINCIPAL rolloverAmount < PRINCIPAL_ONLY rolloverAmount for any payout > 0', () => {
    const principal = '10000000'
    const interestDue = '1500000'
    const payout = '2000000'

    const partialResult = rolloverPartialPrincipalCalc(principal, interestDue, payout)

    // PRINCIPAL_ONLY: rolloverAmount = principal = 10,000,000
    const principalOnlyRolloverAmount = toNum(principal)

    expect(toNum(partialResult.rolloverAmount)).toBeLessThan(principalOnlyRolloverAmount)
  })

  it('PARTIAL_PRINCIPAL rolloverAmount < P_AND_I rolloverAmount for any valid inputs', () => {
    fc.assert(
      fc.property(
        validPartialPrincipalArbitrary,
        nonNegativeAmountArbitrary,
        ({ principal, requestedPayout }, interestDue) => {
          const partialResult = rolloverPartialPrincipalCalc(principal, interestDue, requestedPayout)

          // P_AND_I: rollover_amount = principal + interest_due
          const pandIRolloverAmount = roundTo4(toNum(principal) + toNum(interestDue))

          expect(toNum(partialResult.rolloverAmount)).toBeLessThan(pandIRolloverAmount)
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws when requestedPayout equals principal', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', '0', '10000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws when requestedPayout exceeds principal', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', '0', '10000001'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on zero requestedPayout', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', '0', '0'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on negative requestedPayout', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', '0', '-1'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on negative principal', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('-1', '0', '500000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on NaN principal', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('not-a-number', '0', '500000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on NaN requestedPayout', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', '0', 'not-a-number'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on NaN interest_due', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', 'not-a-number', '2000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('accepts minimum valid case: payout = 1, principal = 2', () => {
    const result = rolloverPartialPrincipalCalc('2', '0', '1')
    expect(toNum(result.remainingPrincipal)).toBe(1)
    expect(toNum(result.rolloverAmount)).toBe(1)
  })

  it('accepts zero interest_due without throwing', () => {
    expect(() =>
      rolloverPartialPrincipalCalc('10000000', '0', '2000000'),
    ).not.toThrow()
  })
})
