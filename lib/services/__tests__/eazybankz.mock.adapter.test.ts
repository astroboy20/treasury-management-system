/**
 * Phase 6 — Eazybankz mock adapter integration tests.
 *
 * Verifies that MockEazybankzAdapter handles all scenario paths exercised
 * by executeTransactionAction, and that the EazybankzError path is correctly
 * surfaced with the right shape.
 *
 * Scenarios covered (per task 6.5):
 *   ROLLOVER              → createInvestment()
 *   MATURITY_TERMINATION  → updateInvestment({ status: 'TERMINATED' })
 *   PRE_LIQUIDATION (partial) → updateInvestment() with rebooked principal
 *   ANNIVERSARY_PAYMENT   → updateInvestment() resetting accrued interest
 *   INTERNAL_TRANSFER (CP / Call) → createInvestment()
 *   INFLOW                → createInvestment()
 *   REVERSAL              → reverseTransaction()
 *   SAVINGS_FUNDS_OUT / CALL_FUNDS_OUT / CMS_FUNDS_OUT → updateInvestment() with new balance
 *   Error path            → EazybankzError thrown for 'FAIL_' prefix IDs
 *
 * Requirements: 30.2, 30.5
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mockEazybankzAdapter } from '../eazybankz/mock.adapter'
import { EazybankzError } from '../eazybankz/adapter.interface'
import type { CreateInvestmentData, CreateTransactionData } from '../eazybankz/adapter.interface'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a fresh mock adapter instance for each test.
 * We re-import the module to get a clean in-memory store.
 * Because mockEazybankzAdapter is a singleton, we work against the shared
 * instance but use investment IDs that are isolated per test to avoid
 * cross-test pollution.
 */
const adapter = mockEazybankzAdapter

const BASE_INVESTMENT: CreateInvestmentData = {
  customerId: 'test-customer-001',
  productType: 'FIXED_DEPOSIT',
  principal: '5000000.0000',
  interestRate: '0.125000',
  tenorDays: 180,
  effectiveDate: '2026-09-07',
  sourceTransactionId: 'test-txn-001',
}

const BASE_TX: CreateTransactionData = {
  customerId: 'test-customer-001',
  transactionType: 'THIRD_PARTY_PAYMENT',
  amount: '1000000.0000',
  currency: 'NGN',
  narration: 'Test payment',
  sourceTransactionId: 'test-txn-002',
}

// ─── getInvestment — seeded customers A–R ────────────────────────────────────

describe('getInvestment — seeded customers', () => {
  it('returns Customer A (ROLLOVER P+I) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-A-001')

    expect(inv.id).toBe('EZBK-A-001')
    expect(inv.customerId).toBe('aaaaaaaa-0001-0000-0000-000000000001')
    expect(inv.productType).toBe('FIXED_DEPOSIT')
    expect(inv.principal).toBe('12450000.0000')
    expect(inv.interestRate).toBe('0.125000')
    expect(inv.accruedInterest).toBe('245000.0000')
    expect(inv.status).toBe('ACTIVE')
    expect(inv.externalReference).toBe('EZBK-A-001')
  })

  it('returns Customer E (MATURITY_TERMINATION) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-E-001')

    expect(inv.principal).toBe('25000000.0000')
    expect(inv.accruedInterest).toBe('1250000.0000')
    expect(inv.interestRate).toBe('0.125000')
    expect(inv.status).toBe('ACTIVE')
  })

  it('returns Customer F (PRE_LIQUIDATION canonical) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-F-001')

    // SOP canonical example: accrued ₦1,500,000 → charge ₦300,000 (20%)
    expect(inv.principal).toBe('15000000.0000')
    expect(inv.accruedInterest).toBe('1500000.0000')
    expect(inv.interestRate).toBe('0.125000')
  })

  it('returns Customer G (PARTIAL_PRE_LIQUIDATION) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-G-001')

    expect(inv.principal).toBe('10000000.0000')
    expect(inv.accruedInterest).toBe('1500000.0000')
  })

  it('returns Customer H (ANNIVERSARY_30) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-H-001')

    expect(inv.principal).toBe('6000000.0000')
    expect(inv.interestRate).toBe('0.120000')
    expect(inv.accruedInterest).toBe('60000.0000')
  })

  it('returns Customer I (ANNIVERSARY_60) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-I-001')

    expect(inv.accruedInterest).toBe('120000.0000')
  })

  it('returns Customer J (ANNIVERSARY_90) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-J-001')

    expect(inv.accruedInterest).toBe('180000.0000')
  })

  it('returns Customer P (REVERSAL candidate) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-P-001')

    expect(inv.interestRate).toBe('0.135000') // incorrect rate being reversed
    expect(inv.status).toBe('ACTIVE')
  })

  it('returns Customer R Savings (SAVINGS_FUNDS_OUT) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-R-SV-001')

    expect(inv.productType).toBe('CMS')
    expect(inv.availableAmount).toBe('4500000.0000')
    expect(inv.outstandingBalance).toBe('4500000.0000')
  })

  it('returns Customer R Call (CALL_FUNDS_OUT) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-R-CL-001')

    expect(inv.productType).toBe('CALL')
    expect(inv.availableAmount).toBe('3200000.0000')
  })

  it('returns Customer R CMS (CMS_FUNDS_OUT) seed data correctly', async () => {
    const inv = await adapter.getInvestment('EZBK-R-CM-001')

    expect(inv.availableAmount).toBe('1800000.0000')
  })

  it('returns a shallow copy — mutating the result does not affect the store', async () => {
    const inv = await adapter.getInvestment('EZBK-A-001')
    const originalPrincipal = inv.principal
    inv.principal = '9999.0000' // mutate the returned copy

    const inv2 = await adapter.getInvestment('EZBK-A-001')
    expect(inv2.principal).toBe(originalPrincipal) // store is unchanged
  })
})

// ─── Error path — EazybankzError ─────────────────────────────────────────────

describe('getInvestment — error path', () => {
  it('throws EazybankzError with SIMULATED_FAILURE code for FAIL_ prefix IDs', async () => {
    await expect(adapter.getInvestment('FAIL_test-investment')).rejects.toThrow(EazybankzError)
  })

  it('thrown EazybankzError has code SIMULATED_FAILURE', async () => {
    try {
      await adapter.getInvestment('FAIL_any-id')
      expect.fail('Expected EazybankzError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(EazybankzError)
      expect((err as EazybankzError).code).toBe('SIMULATED_FAILURE')
      expect((err as EazybankzError).name).toBe('EazybankzError')
    }
  })

  it('throws EazybankzError with NOT_FOUND code for unknown IDs', async () => {
    try {
      await adapter.getInvestment('EZBK-DOES-NOT-EXIST')
      expect.fail('Expected EazybankzError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(EazybankzError)
      expect((err as EazybankzError).code).toBe('NOT_FOUND')
    }
  })

  it('EazybankzError is an instanceof Error', () => {
    const err = new EazybankzError('test message', 'TEST_CODE')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(EazybankzError)
    expect(err.message).toBe('test message')
    expect(err.code).toBe('TEST_CODE')
    expect(err.name).toBe('EazybankzError')
  })
})

// ─── ROLLOVER scenario → createInvestment ────────────────────────────────────

describe('ROLLOVER — createInvestment', () => {
  it('creates a new investment and returns a valid EazybankzInvestment shape', async () => {
    const result = await adapter.createInvestment({
      ...BASE_INVESTMENT,
      principal: '12450000.0000',   // rollover amount (P+I)
      interestRate: '0.125000',
      tenorDays: 180,
      effectiveDate: '2026-09-07',
      productType: 'FIXED_DEPOSIT',
      sourceTransactionId: 'rollover-txn-001',
    })

    expect(result.id).toBeTruthy()
    expect(result.externalReference).toBeTruthy()
    expect(result.principal).toBe('12450000.0000')
    expect(result.interestRate).toBe('0.125000')
    expect(result.accruedInterest).toBe('0.0000')   // new investment starts with no accrued interest
    expect(result.status).toBe('ACTIVE')
    expect(result.effectiveDate).toBe('2026-09-07')
    expect(result.productType).toBe('FIXED_DEPOSIT')
  })

  it('newly created investment is retrievable via getInvestment', async () => {
    const created = await adapter.createInvestment({
      ...BASE_INVESTMENT,
      sourceTransactionId: 'rollover-txn-002',
    })

    const fetched = await adapter.getInvestment(created.externalReference)
    expect(fetched.principal).toBe(created.principal)
    expect(fetched.status).toBe('ACTIVE')
  })

  it('computes maturity date from effectiveDate + tenorDays', async () => {
    const result = await adapter.createInvestment({
      ...BASE_INVESTMENT,
      effectiveDate: '2026-09-07',
      tenorDays: 180,
      sourceTransactionId: 'rollover-txn-003',
    })

    // 2026-09-07 + 180 days
    const expected = new Date('2026-09-07')
    expected.setDate(expected.getDate() + 180)
    const expectedStr = expected.toISOString().split('T')[0]

    expect(result.maturityDate).toBe(expectedStr)
  })

  it('each createInvestment call generates a unique externalReference', async () => {
    const a = await adapter.createInvestment({ ...BASE_INVESTMENT, sourceTransactionId: 'r-a' })
    const b = await adapter.createInvestment({ ...BASE_INVESTMENT, sourceTransactionId: 'r-b' })

    expect(a.externalReference).not.toBe(b.externalReference)
  })

  // Req 17.3: PRINCIPAL_ONLY rollover — principal rolls, interest paid out
  it('PRINCIPAL_ONLY: creates investment with principal-only amount, zero accrued interest', async () => {
    const result = await adapter.createInvestment({
      customerId: 'aaaaaaaa-0002-0000-0000-000000000002', // Customer B
      principal: '8000000.0000',    // original principal (interest is paid out separately)
      interestRate: '0.120000',
      tenorDays: 180,
      effectiveDate: '2026-09-07',
      productType: 'FIXED_DEPOSIT',
      sourceTransactionId: 'principal-only-txn-001',
    })

    expect(result.principal).toBe('8000000.0000')
    expect(result.accruedInterest).toBe('0.0000')
    expect(result.status).toBe('ACTIVE')
  })

  // Req 22.3: INTERNAL_TRANSFER → COMMERCIAL_PAPER placement
  it('INTERNAL_TRANSFER PERSONAL_TO_COMMERCIAL_PAPER: creates COMMERCIAL_PAPER investment', async () => {
    const result = await adapter.createInvestment({
      customerId: 'test-cp-customer',
      principal: '5000000.0000',
      interestRate: '0',
      tenorDays: 0,
      effectiveDate: '2026-09-07',
      productType: 'COMMERCIAL_PAPER',
      sourceTransactionId: 'internal-transfer-cp-001',
    })

    expect(result.productType).toBe('COMMERCIAL_PAPER')
    expect(result.status).toBe('ACTIVE')
  })

  // Req 22.3: INTERNAL_TRANSFER → CALL placement
  it('INTERNAL_TRANSFER PERSONAL_TO_CALL_PLACEMENT: creates CALL investment', async () => {
    const result = await adapter.createInvestment({
      customerId: 'test-call-customer',
      principal: '3000000.0000',
      interestRate: '0',
      tenorDays: 0,
      effectiveDate: '2026-09-07',
      productType: 'CALL',
      sourceTransactionId: 'internal-transfer-call-001',
    })

    expect(result.productType).toBe('CALL')
    expect(result.status).toBe('ACTIVE')
  })

  // Req 23.2: INFLOW → creates new investment
  it('INFLOW: creates new FIXED_DEPOSIT investment from inflow voucher data', async () => {
    const result = await adapter.createInvestment({
      customerId: 'test-inflow-customer',
      principal: '10000000.0000',
      interestRate: '0.130000',
      tenorDays: 365,
      effectiveDate: '2026-09-07',
      productType: 'FIXED_DEPOSIT',
      sourceTransactionId: 'inflow-txn-001',
    })

    expect(result.principal).toBe('10000000.0000')
    expect(result.interestRate).toBe('0.130000')
    expect(result.accruedInterest).toBe('0.0000')
    expect(result.status).toBe('ACTIVE')

    // Req 23.3: confirm it exists in the adapter store for Treasury to verify
    const fetched = await adapter.getInvestment(result.externalReference)
    expect(fetched).toBeTruthy()
    expect(fetched.status).toBe('ACTIVE')
  })
})

// ─── MATURITY_TERMINATION scenario → updateInvestment status: TERMINATED ─────

describe('MATURITY_TERMINATION — updateInvestment TERMINATED', () => {
  it('marks Customer E investment as TERMINATED', async () => {
    const updated = await adapter.updateInvestment('EZBK-E-001', {
      status: 'TERMINATED',
      sourceTransactionId: 'maturity-txn-001',
    })

    expect(updated.status).toBe('TERMINATED')
    expect(updated.principal).toBe('25000000.0000') // principal unchanged
  })

  it('updated status is persisted and retrievable', async () => {
    await adapter.updateInvestment('EZBK-E-001', {
      status: 'TERMINATED',
      sourceTransactionId: 'maturity-txn-002',
    })

    const fetched = await adapter.getInvestment('EZBK-E-001')
    expect(fetched.status).toBe('TERMINATED')
  })

  it('throws EazybankzError when updating a FAIL_ prefixed ID', async () => {
    await expect(
      adapter.updateInvestment('FAIL_unknown-id', { status: 'TERMINATED' })
    ).rejects.toThrow(EazybankzError)
  })
})

// ─── PRE_LIQUIDATION (partial) → updateInvestment with rebooked principal ────

describe('PRE_LIQUIDATION partial — updateInvestment rebooked principal', () => {
  it('updates Customer G investment with rebooked principal after partial liquidation', async () => {
    // Original principal ₦10,000,000, payout ₦3,000,000, rebooked ₦7,000,000
    const rebookedPrincipal = '7000000.0000'

    const updated = await adapter.updateInvestment('EZBK-G-001', {
      outstandingBalance: rebookedPrincipal,
      availableAmount: rebookedPrincipal,
      sourceTransactionId: 'preliq-partial-txn-001',
    })

    expect(updated.outstandingBalance).toBe('7000000.0000')
    expect(updated.availableAmount).toBe('7000000.0000')
    expect(updated.status).toBe('ACTIVE') // still active — not terminated (Req 19.5)
  })

  it('PRE_LIQUIDATION full: marks Customer F as TERMINATED', async () => {
    const updated = await adapter.updateInvestment('EZBK-F-001', {
      status: 'TERMINATED',
      sourceTransactionId: 'preliq-full-txn-001',
    })

    expect(updated.status).toBe('TERMINATED')
  })

  it('partial update does not cascade balance changes if principal is not provided', async () => {
    // For partial pre-liquidation we supply outstandingBalance directly
    // without changing principal — the original principal is preserved
    const before = await adapter.getInvestment('EZBK-C-001')

    const updated = await adapter.updateInvestment('EZBK-C-001', {
      outstandingBalance: '6000000.0000',
      availableAmount: '6000000.0000',
      sourceTransactionId: 'preliq-partial-c-001',
    })

    // principal remains unchanged when not explicitly passed
    expect(updated.principal).toBe(before.principal)
    expect(updated.outstandingBalance).toBe('6000000.0000')
  })
})

// ─── ANNIVERSARY_PAYMENT → updateInvestment resetting accrued interest ────────

describe('ANNIVERSARY_PAYMENT — updateInvestment reset accrued interest', () => {
  it('resets accrued interest to 0 for Customer H (30-day) after anniversary payout', async () => {
    const updated = await adapter.updateInvestment('EZBK-H-001', {
      accruedInterest: '0',
      sourceTransactionId: 'anniversary-30-txn-001',
    })

    expect(updated.accruedInterest).toBe('0')
    expect(updated.status).toBe('ACTIVE') // principal remains ACTIVE (Req 20.4)
    expect(updated.principal).toBe('6000000.0000') // principal unchanged
  })

  it('resets accrued interest to 0 for Customer I (60-day)', async () => {
    const updated = await adapter.updateInvestment('EZBK-I-001', {
      accruedInterest: '0',
      sourceTransactionId: 'anniversary-60-txn-001',
    })

    expect(updated.accruedInterest).toBe('0')
    expect(updated.status).toBe('ACTIVE')
  })

  it('resets accrued interest to 0 for Customer J (90-day)', async () => {
    const updated = await adapter.updateInvestment('EZBK-J-001', {
      accruedInterest: '0',
      sourceTransactionId: 'anniversary-90-txn-001',
    })

    expect(updated.accruedInterest).toBe('0')
    expect(updated.status).toBe('ACTIVE')
  })

  it('getAccruedInterest returns the current value from the store', async () => {
    const interest = await adapter.getAccruedInterest('EZBK-B-001')
    expect(interest).toBe('160000.0000')
  })
})

// ─── SAVINGS / CALL / CMS FUNDS-OUT → updateInvestment new balance ────────────

describe('SAVINGS_FUNDS_OUT / CALL_FUNDS_OUT / CMS_FUNDS_OUT — updateInvestment balance', () => {
  it('updates Customer R Savings balance after withdrawal', async () => {
    // ₦4,500,000 available, ₦1,000,000 withdrawal → ₦3,500,000 remaining
    const updated = await adapter.updateInvestment('EZBK-R-SV-001', {
      availableAmount: '3500000.0000',
      outstandingBalance: '3500000.0000',
      sourceTransactionId: 'savings-funds-out-txn-001',
    })

    expect(updated.availableAmount).toBe('3500000.0000')
    expect(updated.outstandingBalance).toBe('3500000.0000')
    expect(updated.status).toBe('ACTIVE')
  })

  it('updates Customer R Call balance after withdrawal', async () => {
    // ₦3,200,000 available, ₦500,000 withdrawal → ₦2,700,000 remaining
    const updated = await adapter.updateInvestment('EZBK-R-CL-001', {
      availableAmount: '2700000.0000',
      outstandingBalance: '2700000.0000',
      sourceTransactionId: 'call-funds-out-txn-001',
    })

    expect(updated.availableAmount).toBe('2700000.0000')
    expect(updated.status).toBe('ACTIVE')
  })

  it('updates Customer R CMS balance after withdrawal', async () => {
    // ₦1,800,000 available, ₦800,000 withdrawal → ₦1,000,000 remaining
    const updated = await adapter.updateInvestment('EZBK-R-CM-001', {
      availableAmount: '1000000.0000',
      outstandingBalance: '1000000.0000',
      sourceTransactionId: 'cms-funds-out-txn-001',
    })

    expect(updated.availableAmount).toBe('1000000.0000')
    expect(updated.status).toBe('ACTIVE')
  })

  it('getBalance returns seeded account balance for Customer R Savings account', async () => {
    const balance = await adapter.getBalance('ac000012-0001-0000-0000-000000000120')

    expect(balance.availableBalance).toBe('4500000.0000')
    expect(balance.currency).toBe('NGN')
  })

  it('getBalance returns seeded account balance for Customer R Call account', async () => {
    const balance = await adapter.getBalance('ac000012-0002-0000-0000-000000000120')

    expect(balance.availableBalance).toBe('3200000.0000')
  })

  it('getBalance throws EazybankzError for unknown account IDs', async () => {
    await expect(adapter.getBalance('unknown-account-id')).rejects.toThrow(EazybankzError)
  })
})

// ─── REVERSAL → reverseTransaction ───────────────────────────────────────────

describe('REVERSAL — reverseTransaction', () => {
  it('creates a reversal record for a previously posted transaction', async () => {
    // First create a transaction to reverse
    const { transactionId } = await adapter.createTransaction({
      ...BASE_TX,
      narration: 'Test reversal scenario',
      sourceTransactionId: 'reversal-source-txn-001',
    })

    const { reversalId } = await adapter.reverseTransaction(
      transactionId,
      'Incorrect rate booked — reversal per SOP Req 25.2',
    )

    expect(reversalId).toBeTruthy()
    expect(typeof reversalId).toBe('string')
  })

  it('creates a synthetic reversal record for transactions not originally posted via createTransaction', async () => {
    // Simulates the case where the original Eazybankz transaction was created outside
    // this mock's createTransaction() (e.g. on a real mirror system in Phase 6).
    const { reversalId } = await adapter.reverseTransaction(
      'EZBK-EXTERNAL-TXN-001',
      'Reversal of externally-posted transaction',
    )

    expect(reversalId).toBeTruthy()
  })

  it('throws ALREADY_REVERSED when reversing a transaction twice', async () => {
    const { transactionId } = await adapter.createTransaction({
      ...BASE_TX,
      sourceTransactionId: 'double-reversal-source',
    })

    await adapter.reverseTransaction(transactionId, 'First reversal')

    try {
      await adapter.reverseTransaction(transactionId, 'Second reversal attempt')
      expect.fail('Expected EazybankzError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(EazybankzError)
      expect((err as EazybankzError).code).toBe('ALREADY_REVERSED')
    }
  })

  it('throws VALIDATION_ERROR when reversal reason is empty', async () => {
    const { transactionId } = await adapter.createTransaction({
      ...BASE_TX,
      sourceTransactionId: 'empty-reason-source',
    })

    try {
      await adapter.reverseTransaction(transactionId, '')
      expect.fail('Expected EazybankzError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(EazybankzError)
      expect((err as EazybankzError).code).toBe('VALIDATION_ERROR')
    }
  })

  it('throws VALIDATION_ERROR when reversal reason is whitespace-only', async () => {
    const { transactionId } = await adapter.createTransaction({
      ...BASE_TX,
      sourceTransactionId: 'whitespace-reason-source',
    })

    await expect(
      adapter.reverseTransaction(transactionId, '   ')
    ).rejects.toThrow(EazybankzError)
  })
})

// ─── createTransaction ────────────────────────────────────────────────────────

describe('createTransaction', () => {
  it('returns a unique transactionId', async () => {
    const result = await adapter.createTransaction(BASE_TX)

    expect(result.transactionId).toBeTruthy()
    expect(typeof result.transactionId).toBe('string')
  })

  it('each call generates a unique transactionId', async () => {
    const a = await adapter.createTransaction({ ...BASE_TX, sourceTransactionId: 'ct-a' })
    const b = await adapter.createTransaction({ ...BASE_TX, sourceTransactionId: 'ct-b' })

    expect(a.transactionId).not.toBe(b.transactionId)
  })

  it('THIRD_PARTY_PAYMENT: records payment with beneficiary details', async () => {
    const result = await adapter.createTransaction({
      customerId: 'test-customer-ext',
      transactionType: 'THIRD_PARTY_PAYMENT',
      amount: '2000000.0000',
      currency: 'NGN',
      beneficiaryAccountNumber: '1234567890',
      beneficiaryBankName: 'Test Bank Nigeria',
      narration: 'Third party payment per instruction',
      sourceTransactionId: 'tpp-ext-001',
    })

    expect(result.transactionId).toBeTruthy()
  })

  it('INTERNAL_TRANSFER: records internal transfer without beneficiary bank', async () => {
    const result = await adapter.createTransaction({
      customerId: 'test-customer-int',
      transactionType: 'INTERNAL_TRANSFER',
      amount: '500000.0000',
      currency: 'NGN',
      narration: 'Savings to Personal transfer',
      sourceTransactionId: 'int-transfer-001',
    })

    expect(result.transactionId).toBeTruthy()
  })
})

// ─── updateInvestment — principal cascade behaviour ───────────────────────────

describe('updateInvestment — principal cascade', () => {
  it('cascades principal to outstandingBalance and availableAmount when principal is updated', async () => {
    const created = await adapter.createInvestment({
      ...BASE_INVESTMENT,
      principal: '5000000.0000',
      sourceTransactionId: 'cascade-test-001',
    })

    const updated = await adapter.updateInvestment(created.externalReference, {
      principal: '3000000.0000', // simulates rebooked principal after partial liquidation
    })

    expect(updated.principal).toBe('3000000.0000')
    expect(updated.outstandingBalance).toBe('3000000.0000')
    expect(updated.availableAmount).toBe('3000000.0000')
  })

  it('allows outstandingBalance override to take precedence over principal cascade', async () => {
    const created = await adapter.createInvestment({
      ...BASE_INVESTMENT,
      principal: '5000000.0000',
      sourceTransactionId: 'cascade-override-001',
    })

    // When both principal and outstandingBalance are supplied, outstandingBalance wins
    const updated = await adapter.updateInvestment(created.externalReference, {
      principal: '5000000.0000',        // principal unchanged
      outstandingBalance: '4200000.0000', // but balance reduced (e.g. partial pay-out)
      availableAmount: '4200000.0000',
    })

    expect(updated.outstandingBalance).toBe('4200000.0000')
    expect(updated.availableAmount).toBe('4200000.0000')
  })
})

// ─── EazybankzError — error class contract ────────────────────────────────────

describe('EazybankzError — class contract', () => {
  it('extends Error', () => {
    const err = new EazybankzError('Something broke', 'ERR_CODE')
    expect(err instanceof Error).toBe(true)
  })

  it('has correct name', () => {
    const err = new EazybankzError('test', 'CODE')
    expect(err.name).toBe('EazybankzError')
  })

  it('stores the code', () => {
    const err = new EazybankzError('test', 500)
    expect(err.code).toBe(500)
  })

  it('stores the cause when provided', () => {
    const cause = new Error('original')
    const err = new EazybankzError('wrapped', 'WRAP', cause)
    expect(err.cause).toBe(cause)
  })

  it('cause is undefined when not provided', () => {
    const err = new EazybankzError('no cause')
    expect(err.cause).toBeUndefined()
  })

  it('is distinguishable from generic Error in catch blocks', () => {
    function mayThrow(fail: boolean) {
      if (fail) throw new EazybankzError('eazybankz error', 'SIMULATED_FAILURE')
      throw new Error('generic error')
    }

    let caughtEazybankz = false
    try {
      mayThrow(true)
    } catch (err) {
      if (err instanceof EazybankzError) caughtEazybankz = true
    }
    expect(caughtEazybankz).toBe(true)

    let caughtGeneric = false
    try {
      mayThrow(false)
    } catch (err) {
      if (!(err instanceof EazybankzError)) caughtGeneric = true
    }
    expect(caughtGeneric).toBe(true)
  })
})
