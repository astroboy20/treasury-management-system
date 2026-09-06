/**
 * Property-Based Tests — Anniversary Payment Calculation Rule
 *
 * Tests the ANNIVERSARY_PAYMENT rule that mirrors the PostgreSQL
 * RPC `calculate_anniversary_payment`.
 *
 * The service function (lib/services/calculation.service.ts) delegates to
 * a Supabase RPC, so the pure math rule is extracted here and tested
 * independently with fast-check property-based testing.
 *
 * SOP rule for ANNIVERSARY_PAYMENT (Req 20.2):
 *   interest_due = principal × interest_rate × (frequency_days / 365)
 *
 * WHT is always 0 per SOP (Req 20.3).
 * frequency_days must be exactly 30, 60, or 90 (Req 20.1).
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ─── Pure implementation of the ANNIVERSARY_PAYMENT rule ─────────────────────
//
// Mirrors the PostgreSQL NUMERIC arithmetic in calculate_anniversary_payment:
//
//   v_interest_due := ROUND(
//     p_principal * p_interest_rate * (p_frequency_days::NUMERIC / 365),
//     4
//   );
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
 * The pure ANNIVERSARY_PAYMENT calculation rule, expressed as a TypeScript
 * function that mirrors the PostgreSQL RPC.
 *
 * interest_due = principal × interest_rate × (frequency_days / 365)
 * wht          = 0  (always, per SOP)
 *
 * @param principalStr     NUMERIC-compatible string, e.g. "10000000.0000"
 * @param interestRateStr  NUMERIC-compatible string (decimal), e.g. "0.120000"
 * @param frequencyDays    Exactly 30, 60, or 90
 * @returns { interestDue, wht } as strings
 */
function anniversaryPaymentCalc(
  principalStr: string,
  interestRateStr: string,
  frequencyDays: 30 | 60 | 90,
): {
  interestDue: string
  wht: string
} {
  const principal = parseFloat(principalStr)
  const interestRate = parseFloat(interestRateStr)

  if (!isFinite(principal) || principal < 0) {
    throw new Error('INVALID_INPUT: principal must be a non-negative number')
  }
  if (!isFinite(interestRate) || interestRate < 0) {
    throw new Error('INVALID_INPUT: interest_rate must be a non-negative number')
  }
  if (![30, 60, 90].includes(frequencyDays)) {
    throw new Error('INVALID_INPUT: frequency_days must be exactly 30, 60, or 90')
  }

  const interestDue = roundTo4(principal * interestRate * (frequencyDays / 365))

  return {
    interestDue: interestDue.toString(),
    wht: '0',
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a NUMERIC string to a JS Number for comparisons. */
const toNum = (s: string) => parseFloat(s)

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Principal: 1 to 999,999,999 (whole NGN amounts for simplicity) */
const principalArbitrary = fc
  .integer({ min: 1, max: 999_999_999 })
  .map((n) => n.toString())

/** Interest rate: 0.01 to 0.30 (1% to 30%), represented as two-decimal fractions */
const interestRateArbitrary = fc
  .integer({ min: 1, max: 30 })
  .map((n) => (n / 100).toString())

/** Frequency days: one of the valid three values */
const frequencyDaysArbitrary = fc.constantFrom(30, 60, 90) as fc.Arbitrary<30 | 60 | 90>

// ─── Canonical SOP example ────────────────────────────────────────────────────

describe('Anniversary Payment — canonical SOP example (Req 20.2)', () => {
  it('reproduces the standard 30-day example: ₦10,000,000 × 12% × 30/365 ≈ ₦98,630.14', () => {
    const result = anniversaryPaymentCalc('10000000', '0.12', 30)

    // Expected: 10_000_000 × 0.12 × (30/365) = 98_630.1369...  → rounded to 4dp = 98_630.1370
    const expected = roundTo4(10_000_000 * 0.12 * (30 / 365))
    expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
    // WHT must always be 0 per SOP
    expect(result.wht).toBe('0')
  })

  it('produces the correct 60-day value: ₦10,000,000 × 12% × 60/365', () => {
    const result = anniversaryPaymentCalc('10000000', '0.12', 60)

    const expected = roundTo4(10_000_000 * 0.12 * (60 / 365))
    expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
    expect(result.wht).toBe('0')
  })

  it('produces the correct 90-day value: ₦10,000,000 × 12% × 90/365', () => {
    const result = anniversaryPaymentCalc('10000000', '0.12', 90)

    const expected = roundTo4(10_000_000 * 0.12 * (90 / 365))
    expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
    expect(result.wht).toBe('0')
  })

  it('60-day interest_due is exactly double the 30-day interest_due', () => {
    const result30 = anniversaryPaymentCalc('10000000', '0.12', 30)
    const result60 = anniversaryPaymentCalc('10000000', '0.12', 60)

    expect(toNum(result60.interestDue)).toBeCloseTo(toNum(result30.interestDue) * 2, 4)
  })

  it('90-day interest_due is exactly triple the 30-day interest_due', () => {
    const result30 = anniversaryPaymentCalc('10000000', '0.12', 30)
    const result90 = anniversaryPaymentCalc('10000000', '0.12', 90)

    expect(toNum(result90.interestDue)).toBeCloseTo(toNum(result30.interestDue) * 3, 4)
  })
})

// ─── Property 1: interest_due = principal × rate × (days / 365) ──────────────
//
// **Validates: Requirements 20.1, 20.2**
//
// For any valid principal, interest rate, and frequency (30 | 60 | 90),
// the interest_due must equal principal × rate × (days / 365) rounded to 4dp.

describe('Property 1 (Req 20.2) — interest_due = principal × rate × (days / 365)', () => {
  it('matches the formula for ANNIVERSARY_30 across all valid inputs', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result = anniversaryPaymentCalc(principalStr, rateStr, 30)

        const expected = roundTo4(toNum(principalStr) * toNum(rateStr) * (30 / 365))
        expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
      }),
      { numRuns: 100 },
    )
  })

  it('matches the formula for ANNIVERSARY_60 across all valid inputs', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result = anniversaryPaymentCalc(principalStr, rateStr, 60)

        const expected = roundTo4(toNum(principalStr) * toNum(rateStr) * (60 / 365))
        expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
      }),
      { numRuns: 100 },
    )
  })

  it('matches the formula for ANNIVERSARY_90 across all valid inputs', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result = anniversaryPaymentCalc(principalStr, rateStr, 90)

        const expected = roundTo4(toNum(principalStr) * toNum(rateStr) * (90 / 365))
        expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
      }),
      { numRuns: 100 },
    )
  })

  it('matches the formula for any valid frequency across all valid inputs', () => {
    fc.assert(
      fc.property(
        principalArbitrary,
        interestRateArbitrary,
        frequencyDaysArbitrary,
        (principalStr, rateStr, frequencyDays) => {
          const result = anniversaryPaymentCalc(principalStr, rateStr, frequencyDays)

          const expected = roundTo4(toNum(principalStr) * toNum(rateStr) * (frequencyDays / 365))
          expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 2: WHT is always 0 ──────────────────────────────────────────────
//
// **Validates: Requirement 20.3**
//
// Per SOP, WHT is always zero for anniversary payments.
// This must hold for ALL valid inputs without exception.

describe('Property 2 (Req 20.3) — WHT is always exactly zero', () => {
  it('wht is always "0" regardless of principal, rate, or frequency', () => {
    fc.assert(
      fc.property(
        principalArbitrary,
        interestRateArbitrary,
        frequencyDaysArbitrary,
        (principalStr, rateStr, frequencyDays) => {
          const result = anniversaryPaymentCalc(principalStr, rateStr, frequencyDays)

          expect(result.wht).toBe('0')
        },
      ),
      { numRuns: 50 },
    )
  })

  it('wht is "0" for the canonical SOP example', () => {
    const result = anniversaryPaymentCalc('10000000', '0.12', 30)

    expect(result.wht).toBe('0')
  })
})

// ─── Property 3: frequency proportionality ────────────────────────────────────
//
// For any fixed principal and rate:
//   interest_due(60) / interest_due(30) ≈ 2
//   interest_due(90) / interest_due(30) ≈ 3
//
// The longer the frequency period, the proportionally larger the interest.

describe('Property 3 (Req 20.2) — interest_due scales proportionally with frequency_days', () => {
  it('60-day interest_due is approximately double 30-day interest_due', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result30 = anniversaryPaymentCalc(principalStr, rateStr, 30)
        const result60 = anniversaryPaymentCalc(principalStr, rateStr, 60)

        // Allow a tiny floating-point tolerance from ROUND(x, 4) applied independently
        expect(toNum(result60.interestDue)).toBeCloseTo(toNum(result30.interestDue) * 2, 2)
      }),
      { numRuns: 50 },
    )
  })

  it('90-day interest_due is approximately triple 30-day interest_due', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result30 = anniversaryPaymentCalc(principalStr, rateStr, 30)
        const result90 = anniversaryPaymentCalc(principalStr, rateStr, 90)

        expect(toNum(result90.interestDue)).toBeCloseTo(toNum(result30.interestDue) * 3, 2)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 4: monotonicity with respect to principal ──────────────────────
//
// Larger principal → larger interest_due (for any fixed rate and frequency).

describe('Property 4 (Req 20.2) — interest_due is monotonically increasing in principal', () => {
  it('larger principal always produces larger interest_due', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 499_999_999 }),
        fc.integer({ min: 1, max: 499_999_999 }),
        interestRateArbitrary,
        frequencyDaysArbitrary,
        (a, b, rateStr, frequencyDays) => {
          fc.pre(a !== b)

          const larger = Math.max(a, b).toString()
          const smaller = Math.min(a, b).toString()

          const largerResult = anniversaryPaymentCalc(larger, rateStr, frequencyDays)
          const smallerResult = anniversaryPaymentCalc(smaller, rateStr, frequencyDays)

          expect(toNum(largerResult.interestDue)).toBeGreaterThanOrEqual(
            toNum(smallerResult.interestDue),
          )
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 5: monotonicity with respect to interest rate ──────────────────
//
// Higher rate → higher interest_due (for any fixed principal and frequency).

describe('Property 5 (Req 20.2) — interest_due is monotonically increasing in interest_rate', () => {
  it('higher rate always produces larger or equal interest_due', () => {
    fc.assert(
      fc.property(
        principalArbitrary,
        fc.integer({ min: 1, max: 15 }),
        fc.integer({ min: 1, max: 15 }),
        frequencyDaysArbitrary,
        (principalStr, rateA, rateB, frequencyDays) => {
          fc.pre(rateA !== rateB)

          const higherRate = (Math.max(rateA, rateB) / 100).toString()
          const lowerRate  = (Math.min(rateA, rateB) / 100).toString()

          const higherResult = anniversaryPaymentCalc(principalStr, higherRate, frequencyDays)
          const lowerResult  = anniversaryPaymentCalc(principalStr, lowerRate, frequencyDays)

          expect(toNum(higherResult.interestDue)).toBeGreaterThanOrEqual(
            toNum(lowerResult.interestDue),
          )
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Property 6: interest_due is always non-negative ─────────────────────────

describe('Property 6 (Req 20.2) — interest_due is always non-negative', () => {
  it('interest_due is never negative for any valid inputs', () => {
    fc.assert(
      fc.property(
        principalArbitrary,
        interestRateArbitrary,
        frequencyDaysArbitrary,
        (principalStr, rateStr, frequencyDays) => {
          const result = anniversaryPaymentCalc(principalStr, rateStr, frequencyDays)

          expect(toNum(result.interestDue)).toBeGreaterThanOrEqual(0)
        },
      ),
      { numRuns: 50 },
    )
  })
})

// ─── Input validation ─────────────────────────────────────────────────────────

describe('Input validation', () => {
  it('throws on negative principal', () => {
    expect(() => anniversaryPaymentCalc('-1', '0.12', 30)).toThrow('INVALID_INPUT')
  })

  it('throws on negative interest rate', () => {
    expect(() => anniversaryPaymentCalc('10000000', '-0.01', 30)).toThrow('INVALID_INPUT')
  })

  it('throws on NaN principal', () => {
    expect(() => anniversaryPaymentCalc('not-a-number', '0.12', 30)).toThrow('INVALID_INPUT')
  })

  it('throws on NaN interest rate', () => {
    expect(() => anniversaryPaymentCalc('10000000', 'bad-rate', 30)).toThrow('INVALID_INPUT')
  })

  it('zero interest rate produces zero interest_due', () => {
    const result = anniversaryPaymentCalc('10000000', '0', 30)
    expect(toNum(result.interestDue)).toBe(0)
    expect(result.wht).toBe('0')
  })

  it('zero principal produces zero interest_due', () => {
    const result = anniversaryPaymentCalc('0', '0.12', 30)
    expect(toNum(result.interestDue)).toBe(0)
    expect(result.wht).toBe('0')
  })
})

// ─── ANNIVERSARY_30 scenario code coverage ────────────────────────────────────

describe('ANNIVERSARY_30 scenario (Req 20.1) — 30-day frequency', () => {
  it('ANNIVERSARY_30 uses exactly 30 days in the formula', () => {
    const frequencyDays = 30
    const principal = '5000000'
    const rate = '0.15' // 15%

    const result = anniversaryPaymentCalc(principal, rate, frequencyDays)

    // interest_due = 5,000,000 × 0.15 × (30/365)
    const expected = roundTo4(5_000_000 * 0.15 * (30 / 365))
    expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
    expect(result.wht).toBe('0')
  })

  it('ANNIVERSARY_30 produces strictly less interest than ANNIVERSARY_60', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result30 = anniversaryPaymentCalc(principalStr, rateStr, 30)
        const result60 = anniversaryPaymentCalc(principalStr, rateStr, 60)

        // For any positive rate and principal, 30-day < 60-day
        if (toNum(principalStr) > 0 && toNum(rateStr) > 0) {
          expect(toNum(result30.interestDue)).toBeLessThan(toNum(result60.interestDue))
        }
      }),
      { numRuns: 50 },
    )
  })
})

// ─── ANNIVERSARY_90 scenario code coverage ────────────────────────────────────
//
// Task 3.10: Support scenario_code: 'ANNIVERSARY_90' with
// calculateAnniversaryPayment(principal, interestRate, 90).
//
// **Validates: Requirements 20.1, 20.2, 20.3, 20.4**

describe('ANNIVERSARY_90 scenario (Req 20.1) — 90-day frequency', () => {
  it('ANNIVERSARY_90 canonical example: ₦10,000,000 × 12% × 90/365 ≈ ₦295,890.41', () => {
    const result = anniversaryPaymentCalc('10000000', '0.12', 90)

    // interest_due = 10,000,000 × 0.12 × (90/365) = 295,890.4109...  → rounded to 4dp
    const expected = roundTo4(10_000_000 * 0.12 * (90 / 365))
    expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
    expect(result.wht).toBe('0')
  })

  it('ANNIVERSARY_90 uses exactly 90 days in the formula', () => {
    const principal = '5000000'
    const rate = '0.15' // 15%

    const result = anniversaryPaymentCalc(principal, rate, 90)

    // interest_due = 5,000,000 × 0.15 × (90/365)
    const expected = roundTo4(5_000_000 * 0.15 * (90 / 365))
    expect(toNum(result.interestDue)).toBeCloseTo(expected, 4)
    expect(result.wht).toBe('0')
  })

  it('ANNIVERSARY_90 produces strictly more interest than ANNIVERSARY_60', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result60 = anniversaryPaymentCalc(principalStr, rateStr, 60)
        const result90 = anniversaryPaymentCalc(principalStr, rateStr, 90)

        // For any positive rate and principal, 60-day < 90-day
        if (toNum(principalStr) > 0 && toNum(rateStr) > 0) {
          expect(toNum(result90.interestDue)).toBeGreaterThan(toNum(result60.interestDue))
        }
      }),
      { numRuns: 50 },
    )
  })

  it('ANNIVERSARY_90 produces strictly more interest than ANNIVERSARY_30', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result30 = anniversaryPaymentCalc(principalStr, rateStr, 30)
        const result90 = anniversaryPaymentCalc(principalStr, rateStr, 90)

        if (toNum(principalStr) > 0 && toNum(rateStr) > 0) {
          expect(toNum(result90.interestDue)).toBeGreaterThan(toNum(result30.interestDue))
        }
      }),
      { numRuns: 50 },
    )
  })

  it('WHT is always 0 for ANNIVERSARY_90 per SOP (Req 20.3)', () => {
    fc.assert(
      fc.property(principalArbitrary, interestRateArbitrary, (principalStr, rateStr) => {
        const result = anniversaryPaymentCalc(principalStr, rateStr, 90)
        expect(result.wht).toBe('0')
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Schema validation — only 30, 60, 90 accepted (Req 20.1) ─────────────────
//
// The CreateTransactionSchema must reject any anniversary scenario code that
// is not ANNIVERSARY_30, ANNIVERSARY_60, or ANNIVERSARY_90.
// Server actions must also reject invalid frequency codes at runtime.

import { CreateTransactionSchema } from '@/lib/schemas/transaction.schema'

describe('Schema validation — anniversary frequency enforcement (Req 20.1)', () => {
  const validBase = {
    customerId: '550e8400-e29b-41d4-a716-446655440000',
    transactionType: 'ANNIVERSARY_PAYMENT' as const,
    requestedAmount: '100000',
    purpose: 'Anniversary interest payment',
    sourceInstructionType: 'LETTER' as const,
  }

  it('accepts ANNIVERSARY_30 as a valid scenario code', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validBase,
      scenarioCode: 'ANNIVERSARY_30',
    })
    expect(result.success).toBe(true)
  })

  it('accepts ANNIVERSARY_60 as a valid scenario code', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validBase,
      scenarioCode: 'ANNIVERSARY_60',
    })
    expect(result.success).toBe(true)
  })

  it('accepts ANNIVERSARY_90 as a valid scenario code', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validBase,
      scenarioCode: 'ANNIVERSARY_90',
    })
    expect(result.success).toBe(true)
  })

  it('rejects ANNIVERSARY_PAYMENT without a scenario code', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validBase,
      // scenarioCode deliberately omitted
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path.includes('scenarioCode'))).toBe(true)
    expect(result.error?.issues.some((i) => i.message.includes('required'))).toBe(true)
  })

  it('rejects a rollover scenario code used for an anniversary transaction', () => {
    // P_AND_I is valid for ROLLOVER but not for ANNIVERSARY_PAYMENT
    const result = CreateTransactionSchema.safeParse({
      ...validBase,
      scenarioCode: 'P_AND_I',
    })
    expect(result.success).toBe(false)
    const messages = result.error?.issues.map((i) => i.message).join(' ') ?? ''
    expect(messages).toMatch(/30|60|90|anniversary/i)
  })
})

// ─── anniversaryPaymentCalc rejects non-30/60/90 frequency values (Req 20.1) ──
//
// The pure calculation rule must throw INVALID_INPUT for any frequency
// value that is not exactly 30, 60, or 90.

describe('Frequency validation — only 30, 60, 90 accepted by calculator (Req 20.1)', () => {
  it('throws INVALID_INPUT for frequency 45 (not a supported period)', () => {
    // TypeScript prevents this at compile time; verify runtime guard is also in place
    expect(() => anniversaryPaymentCalc('10000000', '0.12', 45 as unknown as 30)).toThrow(
      'INVALID_INPUT',
    )
  })

  it('throws INVALID_INPUT for frequency 0', () => {
    expect(() => anniversaryPaymentCalc('10000000', '0.12', 0 as unknown as 30)).toThrow(
      'INVALID_INPUT',
    )
  })

  it('throws INVALID_INPUT for frequency 120 (not a supported period)', () => {
    expect(() => anniversaryPaymentCalc('10000000', '0.12', 120 as unknown as 30)).toThrow(
      'INVALID_INPUT',
    )
  })

  it('throws INVALID_INPUT for frequency 365', () => {
    expect(() => anniversaryPaymentCalc('10000000', '0.12', 365 as unknown as 30)).toThrow(
      'INVALID_INPUT',
    )
  })
})
