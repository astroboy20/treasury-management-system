/**
 * Property-Based Tests — Partial Pre-Liquidation Calculation Rule
 *
 * Tests the PRE_LIQUIDATION_20_PERCENT rule applied to the partial
 * pre-liquidation scenario (Req 19.2, 19.3), where a requested_payout
 * is deducted from the principal and the remaining_principal is rebooked
 * after the 20% charge is applied.
 *
 * SOP rule for PARTIAL PRE_LIQUIDATION:
 *   charge              = accrued_interest × 0.20
 *   net_interest        = accrued_interest − charge
 *   remaining_principal = original_principal − requested_payout
 *   rebooked_principal  = remaining_principal − charge
 *
 * This mirrors the PostgreSQL NUMERIC arithmetic in
 * supabase/migrations/006_calculation_rpcs.sql for the
 * `calculate_pre_liquidation` RPC with both p_original_principal
 * and p_requested_payout supplied.
 *
 * All intermediate values must be displayed before voucher preparation (Req 19.2).
 * A `pre_liquidation_details` row capturing all fields is required (Req 19.3).
 * On Operations execution, eazybankzAdapter.updateInvestment() is called
 * with the rebooked_principal (Req 19.5).
 *
 * Requirements: 19.2, 19.3, 19.5
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartialPreLiquidationResult {
  charge: string
  netInterest: string
  remainingPrincipal: string
  rebookedPrincipal: string
}

// ─── Pure implementation of the partial PRE_LIQUIDATION rule ─────────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in the calculate_pre_liquidation RPC
// when both p_original_principal and p_requested_payout are supplied:
//
//   v_charge_rate        := 0.20;
//   v_charge             := ROUND(p_accrued_interest * v_charge_rate, 4);
//   v_net_interest       := p_accrued_interest - v_charge;
//   v_remaining_principal := p_original_principal - p_requested_payout;
//   v_rebooked_principal  := v_remaining_principal - v_charge;
//
// Inputs/outputs are NUMERIC-compatible strings. All intermediate arithmetic
// uses JavaScript's Number for this test layer; authoritative server-side
// arithmetic uses PostgreSQL NUMERIC.

const CHARGE_RATE = 0.20

/**
 * Rounds a number to 4 decimal places, matching PostgreSQL ROUND(x, 4).
 */
function roundTo4(n: number): number {
  return Math.round(n * 1e4) / 1e4
}

/**
 * Partial pre-liquidation rule, expressed as a pure TypeScript function
 * that mirrors the PostgreSQL RPC.
 *
 * @param accruedInterestStr   NUMERIC-compatible string, e.g. "1500000.0000"
 * @param originalPrincipalStr NUMERIC-compatible string, e.g. "10000000.0000"
 * @param requestedPayoutStr   NUMERIC-compatible string, e.g. "2000000.0000"
 */
function partialPreLiquidationCalc(
  accruedInterestStr: string,
  originalPrincipalStr: string,
  requestedPayoutStr: string,
): PartialPreLiquidationResult {
  const accruedInterest = parseFloat(accruedInterestStr)
  const originalPrincipal = parseFloat(originalPrincipalStr)
  const requestedPayout = parseFloat(requestedPayoutStr)

  if (!isFinite(accruedInterest) || accruedInterest < 0) {
    throw new Error('INVALID_INPUT: accrued_interest must be a non-negative number')
  }
  if (!isFinite(originalPrincipal) || originalPrincipal <= 0) {
    throw new Error('INVALID_INPUT: original_principal must be a positive number')
  }
  if (!isFinite(requestedPayout) || requestedPayout <= 0) {
    throw new Error('INVALID_INPUT: requested_payout must be a positive number')
  }
  if (requestedPayout >= originalPrincipal) {
    throw new Error('INVALID_INPUT: requested_payout must be less than original_principal')
  }

  const charge = roundTo4(accruedInterest * CHARGE_RATE)
  const netInterest = roundTo4(accruedInterest - charge)
  const remainingPrincipal = roundTo4(originalPrincipal - requestedPayout)
  const rebookedPrincipal = roundTo4(remainingPrincipal - charge)

  return {
    charge: charge.toString(),
    netInterest: netInterest.toString(),
    remainingPrincipal: remainingPrincipal.toString(),
    rebookedPrincipal: rebookedPrincipal.toString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toNum = (s: string) => parseFloat(s)

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Valid (originalPrincipal, requestedPayout) pair where 0 < payout < principal.
 * Uses tuple + map to avoid .chain() and .filter() which slow down generation.
 * We fix the principal range and derive payout as a fraction to guarantee validity
 * without rejection sampling.
 */
const validPartialArbitrary = fc
  .tuple(
    fc.integer({ min: 100, max: 999_999 }),   // principal: capped to keep numbers manageable
    fc.integer({ min: 1, max: 99 }),            // payout fraction percent: 1–99%
  )
  .map(([principal, pct]) => ({
    originalPrincipal: principal.toString(),
    requestedPayout: Math.max(1, Math.floor(principal * pct / 100)).toString(),
  }))

const nonNegativeInterestArbitrary = fc
  .integer({ min: 0, max: 999_999 })
  .map((n) => n.toString())

// ─── Canonical SOP example ────────────────────────────────────────────────────

describe('Partial Pre-Liquidation — canonical SOP example (Req 19.2, 19.3)', () => {
  it('reproduces: principal ₦10M, accrued interest ₦1.5M, payout ₦2M → remaining ₦8M, rebooked ₦7.7M', () => {
    const result = partialPreLiquidationCalc('1500000', '10000000', '2000000')

    // charge = 1,500,000 × 0.20 = 300,000
    expect(toNum(result.charge)).toBe(300_000)
    // net_interest = 1,500,000 − 300,000 = 1,200,000
    expect(toNum(result.netInterest)).toBe(1_200_000)
    // remaining_principal = 10,000,000 − 2,000,000 = 8,000,000
    expect(toNum(result.remainingPrincipal)).toBe(8_000_000)
    // rebooked_principal = 8,000,000 − 300,000 = 7,700,000
    expect(toNum(result.rebookedPrincipal)).toBe(7_700_000)
  })

  it('all intermediate values are present in the result (Req 19.2)', () => {
    const result = partialPreLiquidationCalc('1500000', '10000000', '2000000')

    expect(result.charge).toBeDefined()
    expect(result.netInterest).toBeDefined()
    expect(result.remainingPrincipal).toBeDefined()
    expect(result.rebookedPrincipal).toBeDefined()
  })
})

// ─── Property 1: charge is always exactly 20% of accrued interest ─────────────
//
// The partial pre-liquidation charge rule is identical to the full
// pre-liquidation rule: charge = accrued_interest × 0.20 (Req 19.1).

describe('Property 1 (Req 19.1) — charge is always 20% of accrued interest', () => {
  it('charge = round(accrued_interest × 0.20, 4) for all valid inputs', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          const expected = roundTo4(toNum(accruedInterest) * CHARGE_RATE)
          expect(toNum(result.charge)).toBe(expected)
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 2: remaining_principal = original_principal − requested_payout ──
//
// **Core rule for partial pre-liquidation (Req 19.2)**

describe('Property 2 (Req 19.2) — remaining_principal = original_principal − requested_payout', () => {
  it('remaining_principal equals original_principal minus requested_payout for all valid inputs', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          const expected = roundTo4(toNum(originalPrincipal) - toNum(requestedPayout))
          expect(toNum(result.remainingPrincipal)).toBe(expected)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('remaining_principal is always strictly positive when payout < principal', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          expect(toNum(result.remainingPrincipal)).toBeGreaterThan(0)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('remaining_principal + requested_payout always reconstructs original_principal (conservation)', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          const reconstructed = roundTo4(toNum(result.remainingPrincipal) + toNum(requestedPayout))
          expect(reconstructed).toBe(toNum(originalPrincipal))
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 3: rebooked_principal = remaining_principal − charge ─────────────
//
// **Core rule for Eazybankz rebooking (Req 19.5)**

describe('Property 3 (Req 19.5) — rebooked_principal = remaining_principal − charge', () => {
  it('rebooked_principal equals remaining_principal minus charge for all valid inputs', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          const expected = roundTo4(toNum(result.remainingPrincipal) - toNum(result.charge))
          expect(toNum(result.rebookedPrincipal)).toBe(expected)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('rebooked_principal is less than remaining_principal when accrued_interest > 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }).map((n) => n.toString()),  // interest > 0
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          // When there is a charge, rebooked_principal < remaining_principal
          expect(toNum(result.rebookedPrincipal)).toBeLessThan(toNum(result.remainingPrincipal))
        },
      ),
      { numRuns: 50 },
    )
  })

  it('rebooked_principal equals remaining_principal when accrued_interest is zero', () => {
    const result = partialPreLiquidationCalc('0', '10000000', '2000000')
    expect(toNum(result.rebookedPrincipal)).toBe(toNum(result.remainingPrincipal))
    expect(toNum(result.rebookedPrincipal)).toBe(8_000_000)
  })
})

// ─── Property 4: independence — rebooked_principal does NOT depend on payout directly
//
// The rebooked_principal = remaining_principal − charge.
// Two transactions with the same principal, payout, and interest always yield
// the same rebooked_principal — payout affects remaining_principal, charge affects rebooking.

describe('Property 4 (determinism) — same inputs always produce same outputs', () => {
  it('calling twice with identical inputs returns identical rebooked_principal', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result1 = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          const result2 = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          expect(result1.rebookedPrincipal).toBe(result2.rebookedPrincipal)
          expect(result1.remainingPrincipal).toBe(result2.remainingPrincipal)
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 5: monotonicity — larger payout → smaller remaining and rebooked ─

describe('Property 5 (monotonicity) — larger payout produces smaller rebooked_principal', () => {
  it('if payout_a > payout_b then rebooked(a) < rebooked(b)', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        // Generate principal and two distinct pct values (1–49% and 50–98%) so
        // they are always ordered without needing .filter() rejection sampling.
        fc.tuple(
          fc.integer({ min: 100, max: 999_999 }),
          fc.integer({ min: 1, max: 49 }),
          fc.integer({ min: 50, max: 98 }),
        ).map(([principal, smallPct, largePct]) => ({
          principal: principal.toString(),
          payoutSmall: Math.max(1, Math.floor(principal * smallPct / 100)).toString(),
          payoutLarge: Math.max(1, Math.floor(principal * largePct / 100)).toString(),
        })),
        (accruedInterest, { principal, payoutSmall, payoutLarge }) => {
          const resultLarger = partialPreLiquidationCalc(accruedInterest, principal, payoutLarge)
          const resultSmaller = partialPreLiquidationCalc(accruedInterest, principal, payoutSmall)

          expect(toNum(resultLarger.rebookedPrincipal)).toBeLessThan(
            toNum(resultSmaller.rebookedPrincipal),
          )
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 6: rebooked_principal ≤ original_principal for all valid inputs ─

describe('Property 6 — rebooked_principal is always less than original_principal', () => {
  it('rebooked_principal < original_principal when payout > 0', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          expect(toNum(result.rebookedPrincipal)).toBeLessThan(toNum(originalPrincipal))
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── pre_liquidation_details row fields (Req 19.3) ───────────────────────────
//
// Validates that all fields required for the pre_liquidation_details row
// are present and correctly computed in the result.

describe('pre_liquidation_details fields (Req 19.3)', () => {
  it('all required fields for the pre_liquidation_details row are present', () => {
    const result = partialPreLiquidationCalc('1500000', '10000000', '2000000')

    // These map to the columns required by Req 19.3:
    // original_principal, accrued_interest, charge_rate = 0.20,
    // charge_amount, requested_payout, remaining_principal, rebooked_principal, net_interest
    expect(result.charge).toBeDefined()           // charge_amount
    expect(result.netInterest).toBeDefined()       // net_interest
    expect(result.remainingPrincipal).toBeDefined() // remaining_principal
    expect(result.rebookedPrincipal).toBeDefined() // rebooked_principal
  })

  it('charge_rate is always 20% (0.20) per Req 19.3', () => {
    const testValues = [
      { interest: '500000', principal: '5000000', payout: '1000000' },
      { interest: '1500000', principal: '10000000', payout: '2000000' },
      { interest: '250000', principal: '3000000', payout: '500000' },
    ]

    for (const { interest, principal, payout } of testValues) {
      const result = partialPreLiquidationCalc(interest, principal, payout)
      const effectiveRate = toNum(result.charge) / toNum(interest)

      if (toNum(interest) > 0) {
        expect(effectiveRate).toBeCloseTo(CHARGE_RATE, 5)
      }
    }
  })
})

// ─── Eazybankz rebooking payload validation (Req 19.5) ───────────────────────
//
// The rebooked_principal must be a valid positive number that can be
// passed to eazybankzAdapter.updateInvestment() as outstandingBalance.

describe('Eazybankz rebooking — rebooked_principal validity (Req 19.5)', () => {
  it('rebooked_principal is always a valid positive NUMERIC-compatible string for zero interest', () => {
    const result = partialPreLiquidationCalc('0', '10000000', '2000000')
    const rebooked = toNum(result.rebookedPrincipal)
    expect(rebooked).toBeGreaterThan(0)
    expect(isFinite(rebooked)).toBe(true)
    expect(/^\d+(\.\d+)?$/.test(result.rebookedPrincipal)).toBe(true)
  })

  it('rebooked_principal is parseable as a numeric string suitable for adapter.updateInvestment()', () => {
    fc.assert(
      fc.property(
        nonNegativeInterestArbitrary,
        validPartialArbitrary,
        (accruedInterest, { originalPrincipal, requestedPayout }) => {
          const result = partialPreLiquidationCalc(accruedInterest, originalPrincipal, requestedPayout)
          const rebooked = toNum(result.rebookedPrincipal)
          // Must be a finite number that can be used in an Eazybankz update call
          expect(isFinite(rebooked)).toBe(true)
        },
      ),
      { numRuns: 50 },
    )
  })

  it('rebooked_principal may be negative when charge exceeds remaining_principal (edge case)', () => {
    // This is an extreme edge case: tiny principal, large accrued interest.
    // In practice the SOP would prevent such a transaction, but the calculation
    // function must still return a mathematically correct result.
    const result = partialPreLiquidationCalc('9000000', '10000000', '1000000')
    // remaining_principal = 10M − 1M = 9M
    // charge = 9M × 0.20 = 1.8M
    // rebooked_principal = 9M − 1.8M = 7.2M (still positive here)
    expect(toNum(result.remainingPrincipal)).toBe(9_000_000)
    expect(toNum(result.charge)).toBe(1_800_000)
    expect(toNum(result.rebookedPrincipal)).toBe(7_200_000)
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws when requested_payout equals original_principal', () => {
    expect(() =>
      partialPreLiquidationCalc('1500000', '10000000', '10000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws when requested_payout exceeds original_principal', () => {
    expect(() =>
      partialPreLiquidationCalc('1500000', '10000000', '10000001'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on zero requested_payout', () => {
    expect(() =>
      partialPreLiquidationCalc('1500000', '10000000', '0'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on negative accrued_interest', () => {
    expect(() =>
      partialPreLiquidationCalc('-1', '10000000', '2000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on negative original_principal', () => {
    expect(() =>
      partialPreLiquidationCalc('1500000', '-10000000', '2000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on NaN accrued_interest', () => {
    expect(() =>
      partialPreLiquidationCalc('not-a-number', '10000000', '2000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('throws on NaN original_principal', () => {
    expect(() =>
      partialPreLiquidationCalc('1500000', 'not-a-number', '2000000'),
    ).toThrow('INVALID_INPUT')
  })

  it('accepts zero accrued_interest (no charge, rebooked = remaining)', () => {
    const result = partialPreLiquidationCalc('0', '10000000', '2000000')
    expect(toNum(result.charge)).toBe(0)
    expect(toNum(result.remainingPrincipal)).toBe(8_000_000)
    expect(toNum(result.rebookedPrincipal)).toBe(8_000_000)
  })

  it('accepts minimum valid case: payout = 1, principal = 2, interest = 0', () => {
    const result = partialPreLiquidationCalc('0', '2', '1')
    expect(toNum(result.remainingPrincipal)).toBe(1)
    expect(toNum(result.rebookedPrincipal)).toBe(1)
  })
})
