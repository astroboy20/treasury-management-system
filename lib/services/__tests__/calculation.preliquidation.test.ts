/**
 * Property-Based Tests — Pre-Liquidation Calculation Rule
 *
 * Tests the PRE_LIQUIDATION_20_PERCENT rule that mirrors the PostgreSQL
 * RPC `calculate_pre_liquidation` in supabase/migrations/006_calculation_rpcs.sql.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * Requirements: 26.6 (SOP canonical example), 19.1 (20% charge)
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the PRE_LIQUIDATION_20_PERCENT rule ──────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in 006_calculation_rpcs.sql:
//
//   v_charge_rate  := 0.20;
//   v_charge       := ROUND(p_accrued_interest * v_charge_rate, 4);
//   v_net_interest := p_accrued_interest - v_charge;
//
// Inputs and outputs are NUMERIC-compatible strings, exactly as the
// TypeScript service layer receives them from the RPC.
// All intermediate arithmetic uses JavaScript's Number for this test layer;
// the authoritative server-side arithmetic uses PostgreSQL NUMERIC.

const CHARGE_RATE = 0.20

/**
 * Rounds a number to 4 decimal places, matching PostgreSQL ROUND(x, 4).
 */
function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * The pure pre-liquidation rule, expressed as a TypeScript function that
 * mirrors the PostgreSQL RPC.
 *
 * @param accruedInterestStr  NUMERIC-compatible string, e.g. "1500000.0000"
 * @returns { charge, netInterest } as NUMERIC-compatible strings
 */
function preLiquidationCalc(accruedInterestStr: string): {
  charge: string
  netInterest: string
} {
  const accruedInterest = parseFloat(accruedInterestStr)

  if (!isFinite(accruedInterest) || accruedInterest < 0) {
    throw new Error('INVALID_INPUT: accrued_interest must be a non-negative number')
  }

  const charge = roundTo4(accruedInterest * CHARGE_RATE)
  const netInterest = roundTo4(accruedInterest - charge)

  return {
    charge: charge.toString(),
    netInterest: netInterest.toString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a NUMERIC string to a JS Number for comparisons. */
const toNum = (s: string) => parseFloat(s)

// ─── Canonical SOP example ────────────────────────────────────────────────────

describe('Pre-Liquidation Calculation — SOP canonical example (Req 26.6)', () => {
  it('reproduces the exact SOP example: ₦1,500,000 → charge ₦300,000, net ₦1,200,000', () => {
    const result = preLiquidationCalc('1500000.0000')

    expect(toNum(result.charge)).toBe(300_000)
    expect(toNum(result.netInterest)).toBe(1_200_000)
  })

  it('also accepts the integer string form "1500000"', () => {
    const result = preLiquidationCalc('1500000')

    expect(toNum(result.charge)).toBe(300_000)
    expect(toNum(result.netInterest)).toBe(1_200_000)
  })
})

// ─── Property 1: charge is always exactly 20% of accrued interest ────────────
//
// For any valid non-negative accrued interest value in [0, 999_999_999]:
//   charge = round(accrued_interest × 0.20, 4)

describe('Property 1 — charge is always exactly 20% of accrued interest (Req 19.1, 26.6)', () => {
  /**
   * Arbitrary: integer amounts in [0, 999_999_999] expressed as strings.
   * Integers ensure no floating-point ambiguity in the test generator.
   */
  const accruedInterestArbitrary = fc
    .integer({ min: 0, max: 999_999_999 })
    .map((n) => n.toString())

  it('charge equals round(accrued_interest × 0.20, 4) for all valid inputs', () => {
    fc.assert(
      fc.property(accruedInterestArbitrary, (accruedInterestStr) => {
        const result = preLiquidationCalc(accruedInterestStr)

        const accruedInterest = toNum(accruedInterestStr)
        const expectedCharge = roundTo4(accruedInterest * CHARGE_RATE)

        expect(toNum(result.charge)).toBe(expectedCharge)
      }),
      { numRuns: 1000 },
    )
  })

  it('charge is always between 0 and accrued_interest inclusive', () => {
    fc.assert(
      fc.property(accruedInterestArbitrary, (accruedInterestStr) => {
        const result = preLiquidationCalc(accruedInterestStr)

        const charge = toNum(result.charge)
        const accruedInterest = toNum(accruedInterestStr)

        expect(charge).toBeGreaterThanOrEqual(0)
        expect(charge).toBeLessThanOrEqual(accruedInterest)
      }),
      { numRuns: 1000 },
    )
  })

  it('charge is never negative, even for zero accrued interest', () => {
    const result = preLiquidationCalc('0')

    expect(toNum(result.charge)).toBe(0)
    expect(toNum(result.netInterest)).toBe(0)
  })
})

// ─── Property 2: net_interest is always accrued_interest − charge ─────────────

describe('Property 2 — net_interest = accrued_interest − charge (Req 26.6)', () => {
  const accruedInterestArbitrary = fc
    .integer({ min: 0, max: 999_999_999 })
    .map((n) => n.toString())

  it('net_interest equals accrued_interest − charge for all valid inputs', () => {
    fc.assert(
      fc.property(accruedInterestArbitrary, (accruedInterestStr) => {
        const result = preLiquidationCalc(accruedInterestStr)

        const accruedInterest = toNum(accruedInterestStr)
        const expectedNetInterest = roundTo4(accruedInterest - toNum(result.charge))

        expect(toNum(result.netInterest)).toBe(expectedNetInterest)
      }),
      { numRuns: 1000 },
    )
  })

  it('charge + net_interest always equals accrued_interest (conservation law)', () => {
    fc.assert(
      fc.property(accruedInterestArbitrary, (accruedInterestStr) => {
        const result = preLiquidationCalc(accruedInterestStr)

        const charge = toNum(result.charge)
        const netInterest = toNum(result.netInterest)
        const accruedInterest = toNum(accruedInterestStr)

        // charge + net_interest reconstructs the original accrued interest
        // (allowing for the rounding delta applied to charge)
        expect(roundTo4(charge + netInterest)).toBe(accruedInterest)
      }),
      { numRuns: 1000 },
    )
  })

  it('net_interest is 80% of accrued interest (the complement of the 20% charge)', () => {
    fc.assert(
      fc.property(accruedInterestArbitrary, (accruedInterestStr) => {
        const result = preLiquidationCalc(accruedInterestStr)

        const accruedInterest = toNum(accruedInterestStr)
        const netInterest = toNum(result.netInterest)

        // net_interest ≈ 80% of accrued interest (subject to rounding delta ≤ 0.0001)
        const expected80Pct = roundTo4(accruedInterest * 0.80)
        expect(Math.abs(netInterest - expected80Pct)).toBeLessThanOrEqual(0.0001)
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 3: monotonicity — higher accrued interest → higher charge ───────

describe('Property 3 — monotonicity: larger input produces larger charge', () => {
  it('if a > b then charge(a) > charge(b)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 1, max: 999_999_999 }),
        (a, b) => {
          fc.pre(a !== b)

          const larger = Math.max(a, b).toString()
          const smaller = Math.min(a, b).toString()

          const largerResult = preLiquidationCalc(larger)
          const smallerResult = preLiquidationCalc(smaller)

          expect(toNum(largerResult.charge)).toBeGreaterThan(toNum(smallerResult.charge))
          expect(toNum(largerResult.netInterest)).toBeGreaterThan(
            toNum(smallerResult.netInterest),
          )
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ─── Property 4: rule identity ───────────────────────────────────────────────

describe('Property 4 — rule identity is always PRE_LIQUIDATION_20_PERCENT', () => {
  it('charge rate is always 20% regardless of input magnitude', () => {
    // Spot-check a range of representative values
    const testValues = [
      '0',
      '1',
      '100',
      '999.9999',
      '10000',
      '500000',
      '1500000',          // SOP canonical
      '50000000',
      '999999999',
    ]

    for (const v of testValues) {
      const result = preLiquidationCalc(v)
      const accruedInterest = toNum(v)
      const charge = toNum(result.charge)

      if (accruedInterest > 0) {
        // effective rate = charge / accrued_interest; must be exactly 0.20
        // (rounding delta ≤ 0.0001 / accrued_interest, which is negligible)
        const effectiveRate = charge / accruedInterest
        expect(effectiveRate).toBeCloseTo(0.20, 5)
      }
    }
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws on negative accrued interest', () => {
    expect(() => preLiquidationCalc('-1')).toThrow('INVALID_INPUT')
  })

  it('throws on NaN input', () => {
    expect(() => preLiquidationCalc('not-a-number')).toThrow('INVALID_INPUT')
  })
})
