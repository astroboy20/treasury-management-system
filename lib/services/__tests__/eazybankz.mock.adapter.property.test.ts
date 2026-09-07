/**
 * Property-Based Tests — Mock Eazybankz Adapter (Customers A–R)
 *
 * Property 3: For every seeded customer A–R, `getInvestment()` returns a value
 * with the correct shape and matches the seed principal/rate values.
 *
 * This test file enumerates all 18 customer external_reference IDs from the
 * mock adapter seed data and uses fast-check to assert structural and financial
 * correctness properties across the full set.
 *
 * Customers K, L, M, N, O, Q have no investment record (they cover
 * transfer/inflow scenarios that don't require a pre-existing investment).
 * Customer R has three investment records (Savings, Call, CMS).
 * All others (A–J, P) have exactly one investment record each.
 *
 * Requirements: 30.2, 39.3
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { mockEazybankzAdapter } from '../eazybankz/mock.adapter'
import type { EazybankzInvestment } from '../eazybankz/adapter.interface'

// ─── Seeded investment catalogue ─────────────────────────────────────────────
//
// Each entry mirrors the seed data in mock.adapter.ts exactly.
// Used as both the enumeration source for parameterised tests and as the
// expected-value lookup for property assertions.

interface SeedEntry {
  /** Eazybankz external reference — the key used in getInvestment(). */
  externalRef: string
  /** Customer label (A–R) for test descriptions. */
  customerLabel: string
  /** Scenario description for test output. */
  scenario: string
  /** Expected principal as a NUMERIC string. */
  principal: string
  /** Expected interest rate as a decimal string. */
  interestRate: string
  /** Expected accrued interest as a NUMERIC string. */
  accruedInterest: string
  /** Expected product type. */
  productType: 'FIXED_DEPOSIT' | 'CALL' | 'COMMERCIAL_PAPER' | 'CMS'
  /** Expected status. */
  status: 'ACTIVE' | 'TERMINATED' | 'ROLLED_OVER' | 'MATURED'
}

const SEEDED_CUSTOMERS: SeedEntry[] = [
  {
    externalRef: 'EZBK-A-001',
    customerLabel: 'A',
    scenario: 'Full Rollover P+I',
    principal: '12450000.0000',
    interestRate: '0.125000',
    accruedInterest: '245000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-B-001',
    customerLabel: 'B',
    scenario: 'Principal Rollover + Interest Payout',
    principal: '8000000.0000',
    interestRate: '0.120000',
    accruedInterest: '160000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-C-001',
    customerLabel: 'C',
    scenario: 'Partial Rollover',
    principal: '10000000.0000',
    interestRate: '0.125000',
    accruedInterest: '0.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-D-001',
    customerLabel: 'D',
    scenario: 'Interest Only Rollover',
    principal: '5000000.0000',
    interestRate: '0.120000',
    accruedInterest: '100000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-E-001',
    customerLabel: 'E',
    scenario: 'Maturity Termination',
    principal: '25000000.0000',
    interestRate: '0.125000',
    accruedInterest: '1250000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-F-001',
    customerLabel: 'F',
    scenario: 'Full Pre-liquidation (SOP canonical: charge = 20% of ₦1,500,000)',
    principal: '15000000.0000',
    interestRate: '0.125000',
    accruedInterest: '1500000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-G-001',
    customerLabel: 'G',
    scenario: 'Partial Pre-liquidation',
    principal: '10000000.0000',
    interestRate: '0.125000',
    accruedInterest: '1500000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-H-001',
    customerLabel: 'H',
    scenario: 'Anniversary 30 Days',
    principal: '6000000.0000',
    interestRate: '0.120000',
    accruedInterest: '60000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-I-001',
    customerLabel: 'I',
    scenario: 'Anniversary 60 Days',
    principal: '6000000.0000',
    interestRate: '0.120000',
    accruedInterest: '120000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-J-001',
    customerLabel: 'J',
    scenario: 'Anniversary 90 Days',
    principal: '6000000.0000',
    interestRate: '0.120000',
    accruedInterest: '180000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  // Customers K, L, M, N, O, Q: no investment (transfer/inflow scenarios — omitted)
  {
    externalRef: 'EZBK-P-001',
    customerLabel: 'P',
    scenario: 'Reversal (incorrect rate 13.5%)',
    principal: '7000000.0000',
    interestRate: '0.135000',
    accruedInterest: '140000.0000',
    productType: 'FIXED_DEPOSIT',
    status: 'ACTIVE',
  },
  // Customer R has three sub-accounts
  {
    externalRef: 'EZBK-R-SV-001',
    customerLabel: 'R (Savings)',
    scenario: 'Savings Funds-Out',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    productType: 'CMS',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-R-CL-001',
    customerLabel: 'R (Call)',
    scenario: 'Call Funds-Out',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    productType: 'CALL',
    status: 'ACTIVE',
  },
  {
    externalRef: 'EZBK-R-CM-001',
    customerLabel: 'R (CMS)',
    scenario: 'CMS Funds-Out',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    productType: 'CMS',
    status: 'ACTIVE',
  },
]

// ─── Shape validator ──────────────────────────────────────────────────────────

/**
 * Validates that an `EazybankzInvestment` has all required fields present
 * and non-empty, and that monetary fields are parseable as finite numbers.
 *
 * This encodes the structural property: no field may be null/undefined, and
 * every monetary string must represent a finite numeric value.
 */
function assertInvestmentShape(inv: EazybankzInvestment, ref: string): void {
  // Required identity fields
  expect(inv.id, `${ref}: id must be present`).toBeTruthy()
  expect(typeof inv.id, `${ref}: id must be a string`).toBe('string')

  expect(inv.externalReference, `${ref}: externalReference must be present`).toBeTruthy()
  expect(typeof inv.externalReference, `${ref}: externalReference must be a string`).toBe('string')

  expect(inv.customerId, `${ref}: customerId must be present`).toBeTruthy()
  expect(typeof inv.customerId, `${ref}: customerId must be a string`).toBe('string')

  // Product type must be one of the four valid values
  const validProductTypes = ['FIXED_DEPOSIT', 'CALL', 'COMMERCIAL_PAPER', 'CMS']
  expect(
    validProductTypes,
    `${ref}: productType '${inv.productType}' must be a valid product type`,
  ).toContain(inv.productType)

  // Status must be one of the four valid values
  const validStatuses = ['ACTIVE', 'TERMINATED', 'ROLLED_OVER', 'MATURED']
  expect(
    validStatuses,
    `${ref}: status '${inv.status}' must be a valid status`,
  ).toContain(inv.status)

  // Monetary fields must be present, be strings, and parse as finite numbers
  const monetaryFields: (keyof EazybankzInvestment)[] = [
    'principal',
    'interestRate',
    'accruedInterest',
    'outstandingBalance',
    'availableAmount',
  ]

  for (const field of monetaryFields) {
    const value = inv[field] as string
    expect(value, `${ref}: ${field} must be present`).toBeDefined()
    expect(typeof value, `${ref}: ${field} must be a string`).toBe('string')

    const parsed = parseFloat(value)
    expect(
      isFinite(parsed),
      `${ref}: ${field} '${value}' must parse as a finite number`,
    ).toBe(true)
    expect(
      parsed,
      `${ref}: ${field} '${value}' must be non-negative`,
    ).toBeGreaterThanOrEqual(0)
  }

  // Date fields must be present strings (maturityDate may be empty for open-ended products)
  expect(typeof inv.effectiveDate, `${ref}: effectiveDate must be a string`).toBe('string')
  expect(inv.effectiveDate.length, `${ref}: effectiveDate must not be empty`).toBeGreaterThan(0)

  // effectiveDate must be a valid ISO date
  const parsedDate = new Date(inv.effectiveDate)
  expect(
    isNaN(parsedDate.getTime()),
    `${ref}: effectiveDate '${inv.effectiveDate}' must be a valid ISO date`,
  ).toBe(false)
}

// ─── Property 3: Structural shape property ────────────────────────────────────

describe('Property 3 — getInvestment returns correct shape for all seeded customers A–R', () => {
  /**
   * Parameterised test: for each of the 14 seeded investment records,
   * assert the returned object satisfies the full EazybankzInvestment schema.
   */
  it.each(SEEDED_CUSTOMERS)(
    'Customer $customerLabel ($scenario): returned shape is valid',
    async ({ externalRef }) => {
      const inv = await mockEazybankzAdapter.getInvestment(externalRef)
      assertInvestmentShape(inv, externalRef)
    },
  )

  /**
   * fast-check property: randomly select from the set of all 14 valid
   * external references and assert the returned shape is always valid.
   *
   * This is the property-based complement to the parameterised tests above.
   * It repeatedly draws from the full seeded set to confirm the shape
   * invariant holds universally — not just in a single sequential pass.
   */
  it('shape invariant holds for any randomly sampled seeded external reference', async () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const refArbitrary = fc.constantFrom(...refs)

    await fc.assert(
      fc.asyncProperty(refArbitrary, async (ref) => {
        const inv = await mockEazybankzAdapter.getInvestment(ref)
        assertInvestmentShape(inv, ref)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 3b: Financial values match seed exactly ────────────────────────

describe('Property 3b — getInvestment financial values match seed data for all customers A–R', () => {
  /**
   * Parameterised test: for each seeded customer, assert that the principal,
   * interestRate, and accruedInterest values match the seed catalogue exactly.
   *
   * This guards against accidental mutation of the in-memory store across
   * test runs or by other test files that also use the shared mock adapter.
   */
  it.each(SEEDED_CUSTOMERS)(
    'Customer $customerLabel ($scenario): principal=$principal, rate=$interestRate, accrued=$accruedInterest',
    async ({ externalRef, principal, interestRate, accruedInterest, productType, status }) => {
      const inv = await mockEazybankzAdapter.getInvestment(externalRef)

      expect(inv.principal, `${externalRef}: principal`).toBe(principal)
      expect(inv.interestRate, `${externalRef}: interestRate`).toBe(interestRate)
      expect(inv.accruedInterest, `${externalRef}: accruedInterest`).toBe(accruedInterest)
      expect(inv.productType, `${externalRef}: productType`).toBe(productType)
      expect(inv.status, `${externalRef}: status`).toBe(status)
    },
  )

  /**
   * fast-check property: randomly sample from the seeded catalogue and assert
   * that financial values match the expected seed data for the drawn record.
   *
   * This runs more samples than the parameterised tests to give higher
   * confidence that the in-memory store is not drifting between calls.
   */
  it('financial values match seed catalogue for any randomly sampled customer', async () => {
    const entryArbitrary = fc.constantFrom(...SEEDED_CUSTOMERS)

    await fc.assert(
      fc.asyncProperty(entryArbitrary, async (entry) => {
        const inv = await mockEazybankzAdapter.getInvestment(entry.externalRef)

        expect(inv.principal).toBe(entry.principal)
        expect(inv.interestRate).toBe(entry.interestRate)
        expect(inv.accruedInterest).toBe(entry.accruedInterest)
        expect(inv.productType).toBe(entry.productType)
        expect(inv.status).toBe(entry.status)
      }),
      { numRuns: 70 },
    )
  })
})

// ─── Property 3c: Immutability — returned copies don't affect the store ───────

describe('Property 3c — getInvestment returns a shallow copy (store is immutable from callers)', () => {
  /**
   * fast-check property: mutating the returned EazybankzInvestment object
   * must not affect subsequent calls for the same ID.
   *
   * The adapter is expected to return a defensive copy on each call.
   */
  it('mutating returned investment does not corrupt the store for any seeded customer', async () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const refArbitrary = fc.constantFrom(...refs)

    await fc.assert(
      fc.asyncProperty(refArbitrary, async (ref) => {
        const inv1 = await mockEazybankzAdapter.getInvestment(ref)
        const originalPrincipal = inv1.principal
        const originalRate = inv1.interestRate

        // Mutate the returned copy
        inv1.principal = '0.0001'
        inv1.interestRate = '99.000000'
        inv1.status = 'TERMINATED'

        // The store must be unchanged
        const inv2 = await mockEazybankzAdapter.getInvestment(ref)
        expect(inv2.principal, `${ref}: store principal must be unchanged after mutation`).toBe(
          originalPrincipal,
        )
        expect(inv2.interestRate, `${ref}: store interestRate must be unchanged after mutation`).toBe(
          originalRate,
        )
      }),
      { numRuns: 50 },
    )
  })

  /**
   * Each call returns a distinct object reference — not the same instance.
   * Two successive calls for the same ID must return different object references.
   */
  it('successive calls for the same ID return distinct object references', async () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const refArbitrary = fc.constantFrom(...refs)

    await fc.assert(
      fc.asyncProperty(refArbitrary, async (ref) => {
        const inv1 = await mockEazybankzAdapter.getInvestment(ref)
        const inv2 = await mockEazybankzAdapter.getInvestment(ref)

        // Different object references — proving defensive copy semantics
        expect(inv1).not.toBe(inv2)
        // But equal values
        expect(inv1.principal).toBe(inv2.principal)
        expect(inv1.interestRate).toBe(inv2.interestRate)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 3d: id and externalReference are consistent ────────────────────

describe('Property 3d — id and externalReference fields are consistent for all seeded customers', () => {
  /**
   * The EazybankzInvestment interface exposes the same value under both
   * `id` and `externalReference`. This property asserts they always match
   * for every seeded record.
   */
  it('id equals externalReference for any seeded customer', async () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const refArbitrary = fc.constantFrom(...refs)

    await fc.assert(
      fc.asyncProperty(refArbitrary, async (ref) => {
        const inv = await mockEazybankzAdapter.getInvestment(ref)
        expect(inv.id).toBe(inv.externalReference)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * The returned `id` / `externalReference` must equal the requested key.
   * The adapter must not return a record under a different key than requested.
   */
  it('returned id matches the requested external reference', async () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const refArbitrary = fc.constantFrom(...refs)

    await fc.assert(
      fc.asyncProperty(refArbitrary, async (ref) => {
        const inv = await mockEazybankzAdapter.getInvestment(ref)
        expect(inv.id).toBe(ref)
        expect(inv.externalReference).toBe(ref)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 3e: availableAmount ≥ 0 for all seeded customers ───────────────

describe('Property 3e — financial invariants hold across all seeded customers', () => {
  /**
   * availableAmount must always be ≥ 0.
   * outstandingBalance must always be ≥ 0.
   * interestRate must always be ≥ 0.
   */
  it('all balance and rate fields are non-negative for any seeded customer', async () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const refArbitrary = fc.constantFrom(...refs)

    await fc.assert(
      fc.asyncProperty(refArbitrary, async (ref) => {
        const inv = await mockEazybankzAdapter.getInvestment(ref)

        expect(parseFloat(inv.availableAmount)).toBeGreaterThanOrEqual(0)
        expect(parseFloat(inv.outstandingBalance)).toBeGreaterThanOrEqual(0)
        expect(parseFloat(inv.interestRate)).toBeGreaterThanOrEqual(0)
        expect(parseFloat(inv.principal)).toBeGreaterThanOrEqual(0)
        expect(parseFloat(inv.accruedInterest)).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * For FIXED_DEPOSIT customers (A–J, P), the available amount must not
   * exceed principal + accrued interest (it may be less where the seed
   * already reflects a pending charge, e.g. Customer F's pre-liquidation
   * penalty of ₦300,000 is deducted from the available amount in the seed).
   *
   * The invariant is: availableAmount ≤ principal + accruedInterest.
   *
   * For balance-based products (Customer R), principal is 0 and
   * availableAmount reflects the account balance directly, so the
   * ≤ invariant holds trivially (both sides are non-negative).
   */
  it('FIXED_DEPOSIT customers: availableAmount does not exceed principal + accruedInterest', async () => {
    const fixedDepositEntries = SEEDED_CUSTOMERS.filter(
      (c) => c.productType === 'FIXED_DEPOSIT',
    )

    for (const entry of fixedDepositEntries) {
      const inv = await mockEazybankzAdapter.getInvestment(entry.externalRef)

      const principal = parseFloat(inv.principal)
      const accruedInterest = parseFloat(inv.accruedInterest)
      const availableAmount = parseFloat(inv.availableAmount)

      // available ≤ principal + accrued (charges may already be deducted in the seed)
      expect(availableAmount).toBeLessThanOrEqual(principal + accruedInterest + 0.0001)
    }
  })

  /**
   * For balance-based products (Customer R: Savings, Call, CMS),
   * principal is always zero and interest rate is zero.
   */
  it('balance-based products (R): principal and interestRate are zero', async () => {
    const balanceBasedEntries = SEEDED_CUSTOMERS.filter(
      (c) => c.externalRef.startsWith('EZBK-R-'),
    )

    for (const entry of balanceBasedEntries) {
      const inv = await mockEazybankzAdapter.getInvestment(entry.externalRef)

      expect(parseFloat(inv.principal)).toBe(0)
      expect(parseFloat(inv.interestRate)).toBe(0)
    }
  })
})

// ─── Coverage summary ─────────────────────────────────────────────────────────

describe('Coverage: all 14 seeded investment records are covered by the catalogue', () => {
  it('SEEDED_CUSTOMERS catalogue contains exactly 14 entries (11 customers + 3 for R)', () => {
    expect(SEEDED_CUSTOMERS).toHaveLength(14)
  })

  it('all 14 external references are distinct', () => {
    const refs = SEEDED_CUSTOMERS.map((c) => c.externalRef)
    const uniqueRefs = new Set(refs)
    expect(uniqueRefs.size).toBe(14)
  })

  it('adapter resolves all 14 external references without error', async () => {
    const results = await Promise.all(
      SEEDED_CUSTOMERS.map((c) => mockEazybankzAdapter.getInvestment(c.externalRef)),
    )
    expect(results).toHaveLength(14)
    for (const inv of results) {
      expect(inv).toBeTruthy()
    }
  })
})
