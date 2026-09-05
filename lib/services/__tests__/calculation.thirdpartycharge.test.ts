/**
 * Property-Based Tests — Third-Party Transfer Charge Calculation Rule
 *
 * Tests the THIRD_PARTY_TRANSFER_0_10_PERCENT rule that mirrors the PostgreSQL
 * RPC `calculate_third_party_charge` in supabase/migrations/006_calculation_rpcs.sql.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * Requirements:
 *   21.2 — External transfer charge is exactly 0.10% of transfer amount
 *   21.3 — Internal transfer charge is always exactly zero
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the THIRD_PARTY_TRANSFER_0_10_PERCENT rule ────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in 006_calculation_rpcs.sql:
//
//   IF p_is_internal THEN
//     v_transfer_charge := 0;
//   ELSE
//     v_transfer_charge := ROUND(p_transfer_amount * v_charge_rate, 4);
//   END IF;
//   v_net_amount := ROUND(p_transfer_amount, 4);
//
// Inputs and outputs are NUMERIC-compatible strings, exactly as the
// TypeScript service layer receives them from the RPC.
// All intermediate arithmetic uses JavaScript's Number for this test layer;
// the authoritative server-side arithmetic uses PostgreSQL NUMERIC.

const CHARGE_RATE = 0.001 // 0.10% per SOP (Req 21.2)

/**
 * Rounds a number to 4 decimal places, matching PostgreSQL ROUND(x, 4).
 */
function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * The pure third-party transfer charge rule, expressed as a TypeScript
 * function that mirrors the PostgreSQL RPC.
 *
 * @param transferAmountStr  NUMERIC-compatible string, e.g. "5000000.0000"
 * @param isInternal         true for intra-company transfers; false for external
 * @returns { transferCharge, netAmount } as NUMERIC-compatible strings
 */
function thirdPartyChargeCalc(
  transferAmountStr: string,
  isInternal: boolean,
): { transferCharge: string; netAmount: string } {
  const transferAmount = parseFloat(transferAmountStr)

  if (!isFinite(transferAmount) || transferAmount < 0) {
    throw new Error('INVALID_INPUT: transfer_amount must be a non-negative number')
  }

  const transferCharge = isInternal ? 0 : roundTo4(transferAmount * CHARGE_RATE)
  const netAmount = roundTo4(transferAmount)

  return {
    transferCharge: transferCharge.toString(),
    netAmount: netAmount.toString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a NUMERIC string to a JS Number for comparisons. */
const toNum = (s: string) => parseFloat(s)

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Integer transfer amounts in [1, 999_999_999] expressed as strings.
 * Integers avoid floating-point ambiguity in the test generator.
 * Lower bound is 1 to satisfy the "isInternal = false → charge > 0" property.
 */
const positiveTransferAmountArbitrary = fc
  .integer({ min: 1, max: 999_999_999 })
  .map((n) => n.toString())

/**
 * Non-negative integer transfer amounts including zero, expressed as strings.
 */
const nonNegativeTransferAmountArbitrary = fc
  .integer({ min: 0, max: 999_999_999 })
  .map((n) => n.toString())

// ─── Canonical SOP examples ───────────────────────────────────────────────────

describe('Third-Party Charge — SOP canonical examples', () => {
  it('external transfer of ₦5,000,000 → charge ₦5,000, net ₦5,000,000', () => {
    const result = thirdPartyChargeCalc('5000000', false)

    expect(toNum(result.transferCharge)).toBe(5_000)
    expect(toNum(result.netAmount)).toBe(5_000_000)
  })

  it('internal transfer of ₦5,000,000 → charge ₦0, net ₦5,000,000', () => {
    const result = thirdPartyChargeCalc('5000000', true)

    expect(toNum(result.transferCharge)).toBe(0)
    expect(toNum(result.netAmount)).toBe(5_000_000)
  })

  it('external transfer of ₦1,000,000 → charge ₦1,000, net ₦1,000,000', () => {
    const result = thirdPartyChargeCalc('1000000', false)

    expect(toNum(result.transferCharge)).toBe(1_000)
    expect(toNum(result.netAmount)).toBe(1_000_000)
  })
})

// ─── Property 1 (Req 21.3): internal charge is always exactly zero ────────────
//
// For any transfer_amount and isInternal = true,
// transferCharge must equal "0".

describe('Property 1 (Req 21.3) — internal transfer charge is always exactly zero', () => {
  it('transferCharge is "0" for all internal transfers regardless of amount', () => {
    fc.assert(
      fc.property(nonNegativeTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, true)

        expect(toNum(result.transferCharge)).toBe(0)
      }),
      { numRuns: 1000 },
    )
  })

  it('transferCharge is "0" for zero-amount internal transfers', () => {
    const result = thirdPartyChargeCalc('0', true)

    expect(toNum(result.transferCharge)).toBe(0)
  })

  it('net_amount equals transfer_amount for all internal transfers', () => {
    fc.assert(
      fc.property(nonNegativeTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, true)

        expect(toNum(result.netAmount)).toBe(toNum(transferAmountStr))
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 2 (Req 21.2): external charge is always exactly 0.10% ──────────
//
// For any transfer_amount > 0 and isInternal = false,
// transferCharge must equal round(transfer_amount × 0.001, 4) and be > 0.

describe('Property 2 (Req 21.2) — external transfer charge is always exactly 0.10%', () => {
  it('transferCharge equals round(transferAmount × 0.001, 4) for all external transfers', () => {
    fc.assert(
      fc.property(positiveTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, false)

        const transferAmount = toNum(transferAmountStr)
        const expectedCharge = roundTo4(transferAmount * CHARGE_RATE)

        expect(toNum(result.transferCharge)).toBe(expectedCharge)
      }),
      { numRuns: 1000 },
    )
  })

  it('transferCharge is always greater than zero for any positive external transfer', () => {
    fc.assert(
      fc.property(positiveTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, false)

        expect(toNum(result.transferCharge)).toBeGreaterThan(0)
      }),
      { numRuns: 1000 },
    )
  })

  it('effective rate of external charge is always exactly 0.10% (charge ÷ amount = 0.001)', () => {
    fc.assert(
      fc.property(positiveTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, false)

        const transferAmount = toNum(transferAmountStr)
        const charge = toNum(result.transferCharge)

        // effective rate = charge / transfer_amount ≈ 0.001
        // (rounding delta ≤ 0.0001 / transfer_amount, negligible for amounts ≥ 1)
        const effectiveRate = charge / transferAmount
        expect(effectiveRate).toBeCloseTo(0.001, 5)
      }),
      { numRuns: 1000 },
    )
  })

  it('net_amount equals transfer_amount for all external transfers (charge is not deducted)', () => {
    fc.assert(
      fc.property(positiveTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, false)

        // Per the PostgreSQL RPC: net_amount = ROUND(p_transfer_amount, 4)
        // The charge is borne by the sender separately — it is NOT deducted from net_amount.
        expect(toNum(result.netAmount)).toBe(toNum(transferAmountStr))
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 3: internal vs external charge divergence ──────────────────────
//
// For the same positive transfer amount, the external charge is strictly
// greater than the internal charge (which is zero).

describe('Property 3 — external charge is always strictly greater than internal charge', () => {
  it('for any positive amount, external charge > internal charge', () => {
    fc.assert(
      fc.property(positiveTransferAmountArbitrary, (transferAmountStr) => {
        const internalResult = thirdPartyChargeCalc(transferAmountStr, true)
        const externalResult = thirdPartyChargeCalc(transferAmountStr, false)

        expect(toNum(externalResult.transferCharge)).toBeGreaterThan(
          toNum(internalResult.transferCharge),
        )
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Property 4: monotonicity — higher transfer amount → higher external charge

describe('Property 4 — monotonicity: larger transfer amount produces larger external charge', () => {
  it('if a > b then externalCharge(a) > externalCharge(b)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 1, max: 999_999_999 }),
        (a, b) => {
          fc.pre(a !== b)

          const larger = Math.max(a, b).toString()
          const smaller = Math.min(a, b).toString()

          const largerResult = thirdPartyChargeCalc(larger, false)
          const smallerResult = thirdPartyChargeCalc(smaller, false)

          expect(toNum(largerResult.transferCharge)).toBeGreaterThan(
            toNum(smallerResult.transferCharge),
          )
        },
      ),
      { numRuns: 500 },
    )
  })

  it('internal charge is always 0 regardless of amount magnitude', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.integer({ min: 1, max: 999_999_999 }),
        (a, b) => {
          fc.pre(a !== b)

          const larger = Math.max(a, b).toString()
          const smaller = Math.min(a, b).toString()

          const largerResult = thirdPartyChargeCalc(larger, true)
          const smallerResult = thirdPartyChargeCalc(smaller, true)

          // Both are zero — monotonicity does not apply; they are equal
          expect(toNum(largerResult.transferCharge)).toBe(0)
          expect(toNum(smallerResult.transferCharge)).toBe(0)
        },
      ),
      { numRuns: 500 },
    )
  })
})

// ─── Property 5: charge is always less than transfer amount ──────────────────

describe('Property 5 — charge is always less than transfer amount (charge < 1%)', () => {
  it('external transferCharge < transferAmount for all positive amounts', () => {
    fc.assert(
      fc.property(positiveTransferAmountArbitrary, (transferAmountStr) => {
        const result = thirdPartyChargeCalc(transferAmountStr, false)

        const charge = toNum(result.transferCharge)
        const transferAmount = toNum(transferAmountStr)

        expect(charge).toBeLessThan(transferAmount)
      }),
      { numRuns: 1000 },
    )
  })
})

// ─── Rule identity ────────────────────────────────────────────────────────────

describe('Rule identity — 0.10% rate is applied consistently across representative values', () => {
  it('external charge rate is 0.001 for all representative transfer amounts', () => {
    const testValues = [
      '1',
      '100',
      '1000',
      '10000',
      '100000',
      '500000',
      '1000000',
      '5000000',    // canonical SOP example
      '50000000',
      '999999999',
    ]

    for (const v of testValues) {
      const result = thirdPartyChargeCalc(v, false)
      const transferAmount = toNum(v)
      const charge = toNum(result.transferCharge)

      const effectiveRate = charge / transferAmount
      expect(effectiveRate).toBeCloseTo(0.001, 5)
    }
  })

  it('internal charge is zero for all representative transfer amounts', () => {
    const testValues = [
      '0',
      '1',
      '100',
      '1000000',
      '5000000',
      '999999999',
    ]

    for (const v of testValues) {
      const result = thirdPartyChargeCalc(v, true)
      expect(toNum(result.transferCharge)).toBe(0)
    }
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws on negative transfer amount', () => {
    expect(() => thirdPartyChargeCalc('-1', false)).toThrow('INVALID_INPUT')
    expect(() => thirdPartyChargeCalc('-1', true)).toThrow('INVALID_INPUT')
  })

  it('throws on NaN input', () => {
    expect(() => thirdPartyChargeCalc('not-a-number', false)).toThrow('INVALID_INPUT')
  })

  it('accepts zero transfer amount without throwing', () => {
    expect(() => thirdPartyChargeCalc('0', false)).not.toThrow()
    expect(() => thirdPartyChargeCalc('0', true)).not.toThrow()
  })

  it('external charge for zero transfer amount is zero', () => {
    const result = thirdPartyChargeCalc('0', false)

    expect(toNum(result.transferCharge)).toBe(0)
    expect(toNum(result.netAmount)).toBe(0)
  })
})
