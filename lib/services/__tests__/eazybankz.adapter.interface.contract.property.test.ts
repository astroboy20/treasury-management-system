/**
 * Property-Based Tests — Eazybankz Adapter Interface Contract
 *
 * Property 4: All `EazybankzAdapter` methods return defined shapes for valid inputs.
 *
 * Focus: `createInvestment(data)` — for any call with structurally valid
 * `CreateInvestmentData`, the returned `EazybankzInvestment` object must:
 *   1. Satisfy the full `EazybankzInvestment` interface (all required fields present
 *      and correctly typed).
 *   2. Have all monetary fields (principal, interestRate, accruedInterest,
 *      outstandingBalance, availableAmount) be NUMERIC-compatible strings — i.e.
 *      parseable as finite, non-negative numbers.
 *   3. Carry back the exact `customerId`, `principal`, `interestRate`, and
 *      `effectiveDate` that were supplied in the input (echo invariant).
 *   4. Initialise `accruedInterest` to `"0.0000"` for a brand-new investment.
 *   5. Have `outstandingBalance` and `availableAmount` equal to the supplied
 *      `principal` for a brand-new investment.
 *   6. Return `status: 'ACTIVE'` for every newly created investment.
 *   7. Assign a unique, non-empty `id` / `externalReference` that differs from all
 *      previously created IDs (uniqueness invariant).
 *   8. Compute `maturityDate` as `effectiveDate + tenorDays` calendar days.
 *
 * Secondary methods tested for shape completeness:
 *   - `getBalance(accountId)` on a seeded account returns a valid `EazybankzBalance`.
 *   - `getAccruedInterest(investmentId)` returns a non-empty NUMERIC-compatible string.
 *   - `createTransaction(data)` returns `{ transactionId }` where `transactionId`
 *     is a non-empty string.
 *   - `reverseTransaction(id, reason)` returns `{ reversalId }` where `reversalId`
 *     is a non-empty string.
 *
 * Requirements: 30.1, 30.3
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// Import the mock adapter class by re-exporting its singleton's prototype access.
// Because the MockEazybankzAdapter class is not publicly exported, we exercise
// the contract through the exported singleton.  A fresh adapter instance per
// describe block is not required here — we test createInvestment on the shared
// singleton and verify independence by checking ID uniqueness across runs.
import { mockEazybankzAdapter } from '../eazybankz/mock.adapter'
import type {
  EazybankzInvestment,
  EazybankzBalance,
  CreateInvestmentData,
} from '../eazybankz/adapter.interface'
import { EazybankzError } from '../eazybankz/adapter.interface'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true iff the value is a string parseable as a finite, non-negative number.
 * This is the NUMERIC-compatible string requirement from Req 30.3.
 */
function isNumericCompatibleString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.trim() === '') return false
  const n = parseFloat(value)
  return isFinite(n) && n >= 0
}

/**
 * Returns true iff the value looks like a valid ISO date string YYYY-MM-DD.
 * We accept any string that creates a valid Date — the adapter must not
 * produce garbage date strings.
 */
function isValidISODate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value === '') return true // open-ended products (e.g. CALL) may have empty maturityDate
  const d = new Date(value)
  return !isNaN(d.getTime())
}

/**
 * Full structural validator for an `EazybankzInvestment` object.
 * Checks presence, type, and value constraints for every interface field.
 */
function assertInvestmentContract(
  inv: unknown,
  label: string,
): asserts inv is EazybankzInvestment {
  expect(inv, `${label}: must not be null/undefined`).toBeDefined()
  expect(typeof inv, `${label}: must be an object`).toBe('object')

  const i = inv as Record<string, unknown>

  // ── Identity fields ────────────────────────────────────────────────────────

  expect(typeof i.id, `${label}: id must be a string`).toBe('string')
  expect((i.id as string).length, `${label}: id must be non-empty`).toBeGreaterThan(0)

  expect(typeof i.customerId, `${label}: customerId must be a string`).toBe('string')
  expect((i.customerId as string).length, `${label}: customerId must be non-empty`).toBeGreaterThan(0)

  expect(typeof i.externalReference, `${label}: externalReference must be a string`).toBe('string')
  expect(
    (i.externalReference as string).length,
    `${label}: externalReference must be non-empty`,
  ).toBeGreaterThan(0)

  // id and externalReference must be the same value (interface contract)
  expect(i.id, `${label}: id must equal externalReference`).toBe(i.externalReference)

  // ── Product type ───────────────────────────────────────────────────────────

  const validProductTypes = ['FIXED_DEPOSIT', 'CALL', 'COMMERCIAL_PAPER', 'CMS']
  expect(
    validProductTypes,
    `${label}: productType '${i.productType}' must be a valid product type`,
  ).toContain(i.productType)

  // ── Status ─────────────────────────────────────────────────────────────────

  const validStatuses = ['ACTIVE', 'TERMINATED', 'ROLLED_OVER', 'MATURED']
  expect(
    validStatuses,
    `${label}: status '${i.status}' must be a valid status`,
  ).toContain(i.status)

  // ── Monetary fields — NUMERIC-compatible strings (Req 30.3) ───────────────

  const monetaryFields = [
    'principal',
    'interestRate',
    'accruedInterest',
    'outstandingBalance',
    'availableAmount',
  ] as const

  for (const field of monetaryFields) {
    expect(
      isNumericCompatibleString(i[field]),
      `${label}: ${field} '${i[field]}' must be a NUMERIC-compatible string`,
    ).toBe(true)
  }

  // ── Date fields ────────────────────────────────────────────────────────────

  expect(typeof i.effectiveDate, `${label}: effectiveDate must be a string`).toBe('string')
  expect(
    isValidISODate(i.effectiveDate),
    `${label}: effectiveDate '${i.effectiveDate}' must be a valid ISO date`,
  ).toBe(true)
  expect(
    (i.effectiveDate as string).length,
    `${label}: effectiveDate must not be empty`,
  ).toBeGreaterThan(0)

  expect(typeof i.maturityDate, `${label}: maturityDate must be a string`).toBe('string')
  expect(
    isValidISODate(i.maturityDate),
    `${label}: maturityDate '${i.maturityDate}' must be a valid ISO date or empty string`,
  ).toBe(true)
}

/**
 * Full structural validator for an `EazybankzBalance` object.
 */
function assertBalanceContract(bal: unknown, label: string): asserts bal is EazybankzBalance {
  expect(bal, `${label}: must not be null/undefined`).toBeDefined()
  expect(typeof bal, `${label}: must be an object`).toBe('object')

  const b = bal as Record<string, unknown>

  expect(typeof b.accountId, `${label}: accountId must be a string`).toBe('string')
  expect((b.accountId as string).length, `${label}: accountId must be non-empty`).toBeGreaterThan(0)

  expect(
    isNumericCompatibleString(b.availableBalance),
    `${label}: availableBalance '${b.availableBalance}' must be a NUMERIC-compatible string`,
  ).toBe(true)
  expect(
    isNumericCompatibleString(b.ledgerBalance),
    `${label}: ledgerBalance '${b.ledgerBalance}' must be a NUMERIC-compatible string`,
  ).toBe(true)

  expect(typeof b.currency, `${label}: currency must be a string`).toBe('string')
  expect((b.currency as string).length, `${label}: currency must be non-empty`).toBeGreaterThan(0)
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generates a NUMERIC-compatible string in the range [1, 999_999_999].
 * Used for principal and amount fields. Excludes zero so the investment
 * always represents a meaningful booking.
 */
const numericAmountArbitrary = fc
  .integer({ min: 1, max: 999_999_999 })
  .map((n) => n.toFixed(4))

/**
 * Generates a realistic interest rate string in the range [0.01, 0.30]
 * (1%–30% per annum), expressed as a decimal string with 6dp, matching
 * the adapter's stored format (e.g. "0.125000" for 12.5%).
 */
const interestRateArbitrary = fc
  .integer({ min: 1, max: 30 })
  .chain((integerPct) =>
    fc.integer({ min: 0, max: 99 }).map((fractionalBp) => {
      // Construct a rate like 0.125000 from integer percent + fractional basis points
      const rate = (integerPct / 100 + fractionalBp / 10000).toFixed(6)
      return rate
    }),
  )

/**
 * Generates a valid ISO date string (YYYY-MM-DD) in a realistic range.
 * We use a fixed Unix-timestamp offset rather than fc.date() to avoid
 * fast-check v4 generating invalid dates during shrinking.
 *
 * Range: 2020-01-01 (1577836800000) through 2030-12-31 (1924905600000).
 */
const ISO_DATE_MIN_MS = 1577836800000 // 2020-01-01
const ISO_DATE_MAX_MS = 1924905600000 // 2030-12-31

const isoDateArbitrary = fc
  .integer({ min: ISO_DATE_MIN_MS, max: ISO_DATE_MAX_MS })
  .map((ms) => new Date(ms).toISOString().split('T')[0])

/**
 * Generates a valid tenor in days: 30, 60, 90, 180, or 365.
 * These are the realistic tenors used in the treasury SOP.
 */
const tenorArbitrary = fc.constantFrom(30, 60, 90, 180, 365)

/**
 * Generates a valid product type for new investments.
 */
const productTypeArbitrary = fc.constantFrom(
  'FIXED_DEPOSIT',
  'CALL',
  'COMMERCIAL_PAPER',
  'CMS',
)

/**
 * Generates a structurally valid `CreateInvestmentData` object.
 * customerId is a fixed test UUID to avoid coupling to the seeded store.
 */
const createInvestmentDataArbitrary = fc.record<CreateInvestmentData>({
  customerId: fc.constant('ffffffff-ffff-ffff-ffff-ffffffffffff'),
  productType: productTypeArbitrary,
  principal: numericAmountArbitrary,
  interestRate: interestRateArbitrary,
  tenorDays: tenorArbitrary,
  effectiveDate: isoDateArbitrary,
  sourceTransactionId: fc.constant('test-source-txn-id'),
})

// ─── Seeded account IDs for getBalance / getAccruedInterest tests ─────────────
//
// These are a subset of the IDs in the mock adapter's SEEDED_BALANCES /
// SEEDED_INVESTMENTS maps.  We pick a small representative set to avoid
// hard-coding all 30+ IDs.

const SEEDED_ACCOUNT_IDS = [
  'ac000001-0001-0000-0000-000000000010', // Customer A
  'ac000005-0001-0000-0000-000000000050', // Customer E
  'ac000012-0001-0000-0000-000000000120', // Customer R Savings
  'ac000012-0002-0000-0000-000000000120', // Customer R Call
  'ac000012-0003-0000-0000-000000000120', // Customer R CMS
]

const SEEDED_INVESTMENT_IDS = [
  'EZBK-A-001',
  'EZBK-F-001', // SOP canonical pre-liquidation example
  'EZBK-E-001',
  'EZBK-H-001',
  'EZBK-R-SV-001',
]

// ─── Property 4a: createInvestment returns a valid EazybankzInvestment ────────

describe('Property 4a — createInvestment returns a fully-shaped EazybankzInvestment (Req 30.1, 30.3)', () => {
  /**
   * Core property: for any structurally valid CreateInvestmentData,
   * createInvestment() returns an object satisfying the full
   * EazybankzInvestment interface contract.
   *
   * This is the primary correctness property for task 6.7.
   */
  it('returned object satisfies EazybankzInvestment interface for any valid input', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)
        assertInvestmentContract(inv, `createInvestment(principal=${data.principal})`)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * Echo invariant: the returned investment must carry back the exact
   * customerId, principal, interestRate, and effectiveDate from the input.
   */
  it('echo invariant — input fields are reflected in the returned investment', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)

        expect(inv.customerId, 'customerId must match input').toBe(data.customerId)
        expect(inv.principal, 'principal must match input').toBe(data.principal)
        expect(inv.interestRate, 'interestRate must match input').toBe(data.interestRate)
        expect(inv.effectiveDate, 'effectiveDate must match input').toBe(data.effectiveDate)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * New-investment invariant: accruedInterest starts at zero for every
   * freshly created investment (no interest has accrued at the moment of booking).
   */
  it('accruedInterest is "0.0000" for every newly created investment', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)
        expect(inv.accruedInterest, 'accruedInterest must be "0.0000" on creation').toBe('0.0000')
      }),
      { numRuns: 100 },
    )
  })

  /**
   * Balance invariant: for a brand-new investment, both outstandingBalance
   * and availableAmount must equal the supplied principal.
   * (No draws or charges have been applied yet.)
   */
  it('outstandingBalance and availableAmount equal principal for a new investment', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)

        expect(
          inv.outstandingBalance,
          'outstandingBalance must equal principal on creation',
        ).toBe(data.principal)
        expect(
          inv.availableAmount,
          'availableAmount must equal principal on creation',
        ).toBe(data.principal)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * Status invariant: every newly created investment starts as 'ACTIVE'.
   */
  it('status is always "ACTIVE" for every newly created investment', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)
        expect(inv.status, 'status must be ACTIVE on creation').toBe('ACTIVE')
      }),
      { numRuns: 100 },
    )
  })

  /**
   * Maturity date invariant: maturityDate must be exactly tenorDays calendar
   * days after effectiveDate.
   *
   * The adapter is required to compute this server-side (Req 30.1) so the
   * browser never derives financial dates independently.
   */
  it('maturityDate is effectiveDate + tenorDays calendar days', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)

        const effective = new Date(data.effectiveDate)
        const expectedMaturity = new Date(effective)
        expectedMaturity.setDate(expectedMaturity.getDate() + data.tenorDays)
        const expectedDateStr = expectedMaturity.toISOString().split('T')[0]

        expect(
          inv.maturityDate,
          `maturityDate must be effectiveDate(${data.effectiveDate}) + tenorDays(${data.tenorDays})`,
        ).toBe(expectedDateStr)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 4b: createInvestment ID uniqueness ──────────────────────────────

describe('Property 4b — createInvestment assigns a unique ID for each call (Req 30.1)', () => {
  /**
   * Uniqueness invariant: two successive calls with the same or different
   * inputs must always return investments with distinct IDs.
   *
   * The adapter is the source of truth for assignment — the caller must
   * never be able to predict or control the returned ID.
   */
  it('two calls with identical inputs return investments with different IDs', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv1 = await mockEazybankzAdapter.createInvestment(data)
        const inv2 = await mockEazybankzAdapter.createInvestment(data)

        expect(inv1.id, 'IDs must differ across successive calls').not.toBe(inv2.id)
        expect(
          inv1.externalReference,
          'externalReferences must differ across successive calls',
        ).not.toBe(inv2.externalReference)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * The assigned ID must not be an empty string or a reserved sentinel value.
   */
  it('assigned ID is always a non-empty, non-whitespace string', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)

        expect(inv.id.trim().length).toBeGreaterThan(0)
        expect(inv.externalReference.trim().length).toBeGreaterThan(0)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 4c: createInvestment result is retrievable via getInvestment ────

describe('Property 4c — created investment is immediately retrievable via getInvestment (Req 30.1)', () => {
  /**
   * Persistence invariant: after createInvestment() returns, the assigned ID
   * must be resolvable by getInvestment() and return the same field values.
   *
   * This confirms the adapter's in-memory store is consistent across methods.
   */
  it('getInvestment returns the created investment by the returned ID', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const created = await mockEazybankzAdapter.createInvestment(data)
        const fetched = await mockEazybankzAdapter.getInvestment(created.id)

        expect(fetched.id, 'fetched id must match created id').toBe(created.id)
        expect(fetched.customerId, 'fetched customerId must match').toBe(created.customerId)
        expect(fetched.principal, 'fetched principal must match').toBe(created.principal)
        expect(fetched.interestRate, 'fetched interestRate must match').toBe(created.interestRate)
        expect(fetched.effectiveDate, 'fetched effectiveDate must match').toBe(created.effectiveDate)
        expect(fetched.maturityDate, 'fetched maturityDate must match').toBe(created.maturityDate)
        expect(fetched.status, 'fetched status must be ACTIVE').toBe('ACTIVE')
      }),
      { numRuns: 80 },
    )
  })

  /**
   * The fetched record is a defensive copy — mutating it must not affect
   * subsequent fetches for the same ID.
   */
  it('fetched created investment is a defensive copy — store is immutable from caller', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const created = await mockEazybankzAdapter.createInvestment(data)

        const copy1 = await mockEazybankzAdapter.getInvestment(created.id)
        const originalPrincipal = copy1.principal
        copy1.principal = '0.0001' // mutate the copy

        const copy2 = await mockEazybankzAdapter.getInvestment(created.id)
        expect(
          copy2.principal,
          'store must not be affected by mutation of a fetched copy',
        ).toBe(originalPrincipal)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 4d: NUMERIC-compatible string constraint — monetary fields ──────

describe('Property 4d — monetary fields are NUMERIC-compatible strings (Req 30.3)', () => {
  /**
   * Req 30.3 mandates that all monetary values travel through the TypeScript
   * layer as strings to preserve PostgreSQL NUMERIC precision. This property
   * verifies the invariant universally across all inputs.
   */
  it('all monetary fields parse as finite non-negative numbers for any input', async () => {
    await fc.assert(
      fc.asyncProperty(createInvestmentDataArbitrary, async (data) => {
        const inv = await mockEazybankzAdapter.createInvestment(data)

        const monetaryFields = [
          'principal',
          'interestRate',
          'accruedInterest',
          'outstandingBalance',
          'availableAmount',
        ] as const

        for (const field of monetaryFields) {
          const value = inv[field]
          expect(typeof value, `${field} must be a string`).toBe('string')
          const parsed = parseFloat(value)
          expect(isFinite(parsed), `${field} '${value}' must parse as a finite number`).toBe(true)
          expect(parsed, `${field} '${value}' must be non-negative`).toBeGreaterThanOrEqual(0)
        }
      }),
      { numRuns: 100 },
    )
  })

  /**
   * The returned principal string must represent the same numeric value as the
   * input (no precision loss from numeric round-trips through the adapter).
   */
  it('principal numeric value is preserved through the adapter without precision loss', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 999_999_999 }).map((n) => n.toFixed(4)),
        async (principalStr) => {
          const data: CreateInvestmentData = {
            customerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            productType: 'FIXED_DEPOSIT',
            principal: principalStr,
            interestRate: '0.125000',
            tenorDays: 180,
            effectiveDate: '2026-09-07',
            sourceTransactionId: 'test-source-txn-id',
          }
          const inv = await mockEazybankzAdapter.createInvestment(data)

          // The numeric value must be identical — no rounding artefacts
          expect(
            parseFloat(inv.principal),
            `principal numeric value must be preserved: input=${principalStr}`,
          ).toBe(parseFloat(principalStr))
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ─── Property 4e: getBalance returns a valid EazybankzBalance ─────────────────

describe('Property 4e — getBalance returns a valid EazybankzBalance for seeded accounts (Req 30.1, 30.3)', () => {
  /**
   * For any seeded account ID, getBalance() must return an object satisfying
   * the full EazybankzBalance interface contract.
   */
  it('returned shape satisfies EazybankzBalance interface for all seeded account IDs', async () => {
    const accountIdArbitrary = fc.constantFrom(...SEEDED_ACCOUNT_IDS)

    await fc.assert(
      fc.asyncProperty(accountIdArbitrary, async (accountId) => {
        const balance = await mockEazybankzAdapter.getBalance(accountId)
        assertBalanceContract(balance, `getBalance(${accountId})`)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * The returned accountId field must echo the requested account ID.
   */
  it('returned accountId matches the requested accountId', async () => {
    const accountIdArbitrary = fc.constantFrom(...SEEDED_ACCOUNT_IDS)

    await fc.assert(
      fc.asyncProperty(accountIdArbitrary, async (accountId) => {
        const balance = await mockEazybankzAdapter.getBalance(accountId)
        expect(balance.accountId, 'accountId must match request').toBe(accountId)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * Balance values must be non-negative for all seeded accounts.
   */
  it('availableBalance and ledgerBalance are always non-negative', async () => {
    const accountIdArbitrary = fc.constantFrom(...SEEDED_ACCOUNT_IDS)

    await fc.assert(
      fc.asyncProperty(accountIdArbitrary, async (accountId) => {
        const balance = await mockEazybankzAdapter.getBalance(accountId)
        expect(parseFloat(balance.availableBalance)).toBeGreaterThanOrEqual(0)
        expect(parseFloat(balance.ledgerBalance)).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * getBalance must throw EazybankzError (not a generic Error) for unknown IDs.
   */
  it('throws EazybankzError for an unknown accountId', async () => {
    await expect(
      mockEazybankzAdapter.getBalance('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(EazybankzError)
  })
})

// ─── Property 4f: getAccruedInterest returns a NUMERIC-compatible string ──────

describe('Property 4f — getAccruedInterest returns a NUMERIC-compatible string (Req 30.1, 30.3)', () => {
  /**
   * For any seeded investment, getAccruedInterest() must return a string that
   * is parseable as a finite non-negative number.
   */
  it('returned accrued interest is a NUMERIC-compatible string for all seeded investments', async () => {
    const investmentIdArbitrary = fc.constantFrom(...SEEDED_INVESTMENT_IDS)

    await fc.assert(
      fc.asyncProperty(investmentIdArbitrary, async (investmentId) => {
        const accruedInterest = await mockEazybankzAdapter.getAccruedInterest(investmentId)

        expect(
          typeof accruedInterest,
          'getAccruedInterest must return a string',
        ).toBe('string')
        expect(
          isNumericCompatibleString(accruedInterest),
          `'${accruedInterest}' must be a NUMERIC-compatible string`,
        ).toBe(true)
        expect(
          parseFloat(accruedInterest),
          'accrued interest must be non-negative',
        ).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * getAccruedInterest must return the same value as the `accruedInterest`
   * field on the corresponding investment record (consistency invariant).
   */
  it('matches the accruedInterest field on the full investment record', async () => {
    const investmentIdArbitrary = fc.constantFrom(...SEEDED_INVESTMENT_IDS)

    await fc.assert(
      fc.asyncProperty(investmentIdArbitrary, async (investmentId) => {
        const [accruedStr, fullInvestment] = await Promise.all([
          mockEazybankzAdapter.getAccruedInterest(investmentId),
          mockEazybankzAdapter.getInvestment(investmentId),
        ])
        expect(
          accruedStr,
          'getAccruedInterest must match investment.accruedInterest',
        ).toBe(fullInvestment.accruedInterest)
      }),
      { numRuns: 50 },
    )
  })
})

// ─── Property 4g: createTransaction returns { transactionId: string } ─────────

describe('Property 4g — createTransaction returns a valid { transactionId } shape (Req 30.3)', () => {
  /**
   * For any valid CreateTransactionData, createTransaction() must return an
   * object with a single `transactionId` field that is a non-empty string.
   */
  it('returned shape has a non-empty transactionId string for any valid input', async () => {
    const createTransactionDataArbitrary = fc.record({
      customerId: fc.constant('ffffffff-ffff-ffff-ffff-ffffffffffff'),
      transactionType: fc.constantFrom('THIRD_PARTY_PAYMENT', 'INTERNAL_TRANSFER'),
      amount: numericAmountArbitrary,
      currency: fc.constant('NGN'),
      narration: fc.string({ minLength: 1, maxLength: 100 }),
      sourceTransactionId: fc.constant('test-source-txn-id'),
    })

    await fc.assert(
      fc.asyncProperty(createTransactionDataArbitrary, async (data) => {
        const result = await mockEazybankzAdapter.createTransaction(data)

        expect(typeof result, 'must return an object').toBe('object')
        expect(result, 'result must not be null').not.toBeNull()
        expect(typeof result.transactionId, 'transactionId must be a string').toBe('string')
        expect(
          result.transactionId.trim().length,
          'transactionId must be non-empty',
        ).toBeGreaterThan(0)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * Uniqueness: two calls with the same data must return different transactionIds.
   */
  it('each call returns a distinct transactionId', async () => {
    const data = {
      customerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      transactionType: 'THIRD_PARTY_PAYMENT',
      amount: '1000000.0000',
      currency: 'NGN',
      narration: 'test transfer',
      sourceTransactionId: 'test-source-txn-id',
    }

    const result1 = await mockEazybankzAdapter.createTransaction(data)
    const result2 = await mockEazybankzAdapter.createTransaction(data)

    expect(result1.transactionId).not.toBe(result2.transactionId)
  })
})

// ─── Property 4h: reverseTransaction returns { reversalId: string } ───────────

describe('Property 4h — reverseTransaction returns a valid { reversalId } shape (Req 30.3)', () => {
  /**
   * For a previously created transaction, reverseTransaction() must return an
   * object with a single `reversalId` field that is a non-empty string.
   */
  it('returned shape has a non-empty reversalId for a created transaction', async () => {
    const { transactionId } = await mockEazybankzAdapter.createTransaction({
      customerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      transactionType: 'THIRD_PARTY_PAYMENT',
      amount: '500000.0000',
      currency: 'NGN',
      narration: 'reversal test base transaction',
      sourceTransactionId: 'test-source-txn-id',
    })

    const reversal = await mockEazybankzAdapter.reverseTransaction(
      transactionId,
      'Customer cancelled the transaction',
    )

    expect(typeof reversal, 'must return an object').toBe('object')
    expect(reversal, 'result must not be null').not.toBeNull()
    expect(typeof reversal.reversalId, 'reversalId must be a string').toBe('string')
    expect(reversal.reversalId.trim().length, 'reversalId must be non-empty').toBeGreaterThan(0)
  })

  /**
   * reverseTransaction must accept an unknown transactionId (e.g. one created
   * outside the mock's ledger — the real adapter handles this path) and still
   * return a valid reversalId shape.
   */
  it('returns a valid reversalId for an unknown transactionId (synthetic reversal path)', async () => {
    const reversal = await mockEazybankzAdapter.reverseTransaction(
      'unknown-external-ezbk-txn-id',
      'Reversal of externally created transaction',
    )

    expect(typeof reversal.reversalId, 'reversalId must be a string').toBe('string')
    expect(reversal.reversalId.trim().length, 'reversalId must be non-empty').toBeGreaterThan(0)
  })

  /**
   * reverseTransaction must throw EazybankzError when the reason string is
   * empty (Req 25.2 — non-empty reversal reason is mandatory).
   */
  it('throws EazybankzError when reason is empty (Req 25.2)', async () => {
    const { transactionId } = await mockEazybankzAdapter.createTransaction({
      customerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      transactionType: 'THIRD_PARTY_PAYMENT',
      amount: '250000.0000',
      currency: 'NGN',
      narration: 'empty reason test base transaction',
      sourceTransactionId: 'test-source-txn-id',
    })

    await expect(
      mockEazybankzAdapter.reverseTransaction(transactionId, ''),
    ).rejects.toBeInstanceOf(EazybankzError)
  })

  /**
   * Reversing the same transaction twice must throw EazybankzError
   * (the ALREADY_REVERSED guard — idempotency protection).
   */
  it('throws EazybankzError when the same transaction is reversed twice', async () => {
    const { transactionId } = await mockEazybankzAdapter.createTransaction({
      customerId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      transactionType: 'THIRD_PARTY_PAYMENT',
      amount: '1500000.0000',
      currency: 'NGN',
      narration: 'double reversal test base transaction',
      sourceTransactionId: 'test-source-txn-id',
    })

    await mockEazybankzAdapter.reverseTransaction(transactionId, 'First reversal')

    await expect(
      mockEazybankzAdapter.reverseTransaction(transactionId, 'Second reversal attempt'),
    ).rejects.toBeInstanceOf(EazybankzError)
  })
})

// ─── Property 4i: FAIL_ prefix triggers EazybankzError ───────────────────────

describe('Property 4i — FAIL_ prefix simulates Eazybankz system failure (Req 30.2)', () => {
  /**
   * The mock adapter exposes a failure simulation mechanism: any investment ID
   * that starts with 'FAIL_' must cause getInvestment() to throw an
   * EazybankzError with code 'SIMULATED_FAILURE'.
   *
   * This enables failure-path testing without special DB setup.
   */
  it('getInvestment throws EazybankzError for any FAIL_-prefixed ID', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => `FAIL_${s}`),
        async (failId) => {
          await expect(
            mockEazybankzAdapter.getInvestment(failId),
          ).rejects.toBeInstanceOf(EazybankzError)
        },
      ),
      { numRuns: 50 },
    )
  })

  /**
   * The thrown EazybankzError must have code 'SIMULATED_FAILURE'
   * so callers can distinguish this from real errors.
   */
  it('thrown error has code SIMULATED_FAILURE for FAIL_-prefixed IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => `FAIL_${s}`),
        async (failId) => {
          let caught: unknown = null
          try {
            await mockEazybankzAdapter.getInvestment(failId)
          } catch (err) {
            caught = err
          }
          expect(caught).toBeInstanceOf(EazybankzError)
          expect((caught as EazybankzError).code).toBe('SIMULATED_FAILURE')
        },
      ),
      { numRuns: 50 },
    )
  })

  /**
   * getInvestment must throw EazybankzError with code 'NOT_FOUND' for IDs
   * that are not prefixed with FAIL_ and not in the seed store.
   */
  it('getInvestment throws EazybankzError(NOT_FOUND) for completely unknown non-FAIL IDs', async () => {
    let caught: unknown = null
    try {
      await mockEazybankzAdapter.getInvestment('UNKNOWN-INVESTMENT-ID-THAT-DOES-NOT-EXIST')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EazybankzError)
    expect((caught as EazybankzError).code).toBe('NOT_FOUND')
  })
})
