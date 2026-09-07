/**
 * Mock Eazybankz adapter — in-memory implementation.
 *
 * Phase 1–5: satisfies the EazybankzAdapter contract using an in-memory
 * store seeded with the 18 test customers A–R from supabase/seed.sql.
 * All financial values match the seed exactly so Step 4 pre-fill and
 * property tests get consistent, predictable data without a live DB.
 *
 * Phase 6: replace with RealEazybankzAdapter (live HTTP client).
 *
 * Design: §Eazybankz Adapter
 * Requirements: 30.2, 30.3
 */

import type {
  EazybankzAdapter,
  EazybankzInvestment,
  EazybankzBalance,
  CreateInvestmentData,
  CreateTransactionData,
} from './adapter.interface'
import { EazybankzError } from './adapter.interface'

// ─── In-memory store types ────────────────────────────────────────────────────

interface StoredTransaction {
  transactionId: string
  data: CreateTransactionData
  reversed: boolean
  reversalId?: string
}

// ─── Seed data — Customers A–R ────────────────────────────────────────────────
//
// Values match supabase/seed.sql SECTION 6 exactly.
// Keys are the `external_reference` values from the investments table.
// Customers K, L, M, N, O, Q have no investment (transfer/inflow scenarios).

const SEEDED_INVESTMENTS: Record<string, EazybankzInvestment> = {
  // ── Customer A: Full Rollover (P+I) ─────────────────────────────────────
  // Principal ₦12,450,000 | Accrued ₦245,000 | Rate 12.5%
  'EZBK-A-001': {
    id: 'EZBK-A-001',
    customerId: 'aaaaaaaa-0001-0000-0000-000000000001',
    productType: 'FIXED_DEPOSIT',
    principal: '12450000.0000',
    interestRate: '0.125000',
    accruedInterest: '245000.0000',
    effectiveDate: '2026-03-03',
    maturityDate: '2026-09-03',
    outstandingBalance: '12450000.0000',
    availableAmount: '12695000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-A-001',
  },

  // ── Customer B: Principal Rollover + Interest Payout ────────────────────
  // Principal ₦8,000,000 | Accrued ₦160,000 | Rate 12.0%
  'EZBK-B-001': {
    id: 'EZBK-B-001',
    customerId: 'aaaaaaaa-0002-0000-0000-000000000002',
    productType: 'FIXED_DEPOSIT',
    principal: '8000000.0000',
    interestRate: '0.120000',
    accruedInterest: '160000.0000',
    effectiveDate: '2026-03-05',
    maturityDate: '2026-09-05',
    outstandingBalance: '8000000.0000',
    availableAmount: '8160000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-B-001',
  },

  // ── Customer C: Partial Rollover ─────────────────────────────────────────
  // Principal ₦10,000,000 | Accrued ₦0 | Rate 12.5%
  'EZBK-C-001': {
    id: 'EZBK-C-001',
    customerId: 'aaaaaaaa-0003-0000-0000-000000000003',
    productType: 'FIXED_DEPOSIT',
    principal: '10000000.0000',
    interestRate: '0.125000',
    accruedInterest: '0.0000',
    effectiveDate: '2026-03-10',
    maturityDate: '2026-09-10',
    outstandingBalance: '10000000.0000',
    availableAmount: '10000000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-C-001',
  },

  // ── Customer D: Interest Only Rollover ──────────────────────────────────
  // Principal ₦5,000,000 | Accrued ₦100,000 | Rate 12.0%
  'EZBK-D-001': {
    id: 'EZBK-D-001',
    customerId: 'aaaaaaaa-0004-0000-0000-000000000004',
    productType: 'FIXED_DEPOSIT',
    principal: '5000000.0000',
    interestRate: '0.120000',
    accruedInterest: '100000.0000',
    effectiveDate: '2026-03-15',
    maturityDate: '2026-09-15',
    outstandingBalance: '5000000.0000',
    availableAmount: '5100000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-D-001',
  },

  // ── Customer E: Maturity Termination ────────────────────────────────────
  // Principal ₦25,000,000 | Accrued ₦1,250,000 | Rate 12.5%
  'EZBK-E-001': {
    id: 'EZBK-E-001',
    customerId: 'aaaaaaaa-0005-0000-0000-000000000005',
    productType: 'FIXED_DEPOSIT',
    principal: '25000000.0000',
    interestRate: '0.125000',
    accruedInterest: '1250000.0000',
    effectiveDate: '2026-03-03',
    maturityDate: '2026-09-03',
    outstandingBalance: '25000000.0000',
    availableAmount: '26250000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-E-001',
  },

  // ── Customer F: Full Pre-liquidation ────────────────────────────────────
  // SOP canonical example: charge = ₦300,000 (20% of ₦1,500,000)
  // Principal ₦15,000,000 | Accrued ₦1,500,000 | Rate 12.5%
  'EZBK-F-001': {
    id: 'EZBK-F-001',
    customerId: 'aaaaaaaa-0006-0000-0000-000000000006',
    productType: 'FIXED_DEPOSIT',
    principal: '15000000.0000',
    interestRate: '0.125000',
    accruedInterest: '1500000.0000',
    effectiveDate: '2026-06-03',
    maturityDate: '2026-12-03',
    outstandingBalance: '15000000.0000',
    availableAmount: '16200000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-F-001',
  },

  // ── Customer G: Partial Pre-liquidation ─────────────────────────────────
  // Principal ₦10,000,000 | Accrued ₦1,500,000 | Rate 12.5%
  'EZBK-G-001': {
    id: 'EZBK-G-001',
    customerId: 'aaaaaaaa-0007-0000-0000-000000000007',
    productType: 'FIXED_DEPOSIT',
    principal: '10000000.0000',
    interestRate: '0.125000',
    accruedInterest: '1500000.0000',
    effectiveDate: '2026-06-03',
    maturityDate: '2026-12-03',
    outstandingBalance: '10000000.0000',
    availableAmount: '11200000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-G-001',
  },

  // ── Customer H: Anniversary 30 Days ─────────────────────────────────────
  // Principal ₦6,000,000 | Accrued ₦60,000 | Rate 12.0%
  'EZBK-H-001': {
    id: 'EZBK-H-001',
    customerId: 'aaaaaaaa-0008-0000-0000-000000000008',
    productType: 'FIXED_DEPOSIT',
    principal: '6000000.0000',
    interestRate: '0.120000',
    accruedInterest: '60000.0000',
    effectiveDate: '2026-08-04',
    maturityDate: '2027-02-04',
    outstandingBalance: '6000000.0000',
    availableAmount: '6060000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-H-001',
  },

  // ── Customer I: Anniversary 60 Days ─────────────────────────────────────
  // Principal ₦6,000,000 | Accrued ₦120,000 | Rate 12.0%
  'EZBK-I-001': {
    id: 'EZBK-I-001',
    customerId: 'aaaaaaaa-0009-0000-0000-000000000009',
    productType: 'FIXED_DEPOSIT',
    principal: '6000000.0000',
    interestRate: '0.120000',
    accruedInterest: '120000.0000',
    effectiveDate: '2026-07-05',
    maturityDate: '2027-01-05',
    outstandingBalance: '6000000.0000',
    availableAmount: '6120000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-I-001',
  },

  // ── Customer J: Anniversary 90 Days ─────────────────────────────────────
  // Principal ₦6,000,000 | Accrued ₦180,000 | Rate 12.0%
  'EZBK-J-001': {
    id: 'EZBK-J-001',
    customerId: 'aaaaaaaa-000a-0000-0000-00000000000a',
    productType: 'FIXED_DEPOSIT',
    principal: '6000000.0000',
    interestRate: '0.120000',
    accruedInterest: '180000.0000',
    effectiveDate: '2026-06-06',
    maturityDate: '2026-12-06',
    outstandingBalance: '6000000.0000',
    availableAmount: '6180000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-J-001',
  },

  // ── Customer P: Reversal (incorrect rate 13.5% — to be reversed) ────────
  // Principal ₦7,000,000 | Accrued ₦140,000 | Rate 13.5%
  'EZBK-P-001': {
    id: 'EZBK-P-001',
    customerId: 'aaaaaaaa-0010-0000-0000-000000000010',
    productType: 'FIXED_DEPOSIT',
    principal: '7000000.0000',
    interestRate: '0.135000',
    accruedInterest: '140000.0000',
    effectiveDate: '2026-08-01',
    maturityDate: '2027-02-01',
    outstandingBalance: '7000000.0000',
    availableAmount: '7140000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-P-001',
  },

  // ── Customer R: Savings Funds-Out ────────────────────────────────────────
  // Balance-based; ₦4,500,000 available
  'EZBK-R-SV-001': {
    id: 'EZBK-R-SV-001',
    customerId: 'aaaaaaaa-0012-0000-0000-000000000012',
    productType: 'CMS',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    effectiveDate: '2026-01-01',
    maturityDate: '',
    outstandingBalance: '4500000.0000',
    availableAmount: '4500000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-R-SV-001',
  },

  // ── Customer R: Call Funds-Out ───────────────────────────────────────────
  // Balance-based; ₦3,200,000 available
  'EZBK-R-CL-001': {
    id: 'EZBK-R-CL-001',
    customerId: 'aaaaaaaa-0012-0000-0000-000000000012',
    productType: 'CALL',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    effectiveDate: '2026-01-01',
    maturityDate: '',
    outstandingBalance: '3200000.0000',
    availableAmount: '3200000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-R-CL-001',
  },

  // ── Customer R: CMS Funds-Out ─────────────────────────────────────────────
  // Balance-based; ₦1,800,000 available
  'EZBK-R-CM-001': {
    id: 'EZBK-R-CM-001',
    customerId: 'aaaaaaaa-0012-0000-0000-000000000012',
    productType: 'CMS',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    effectiveDate: '2026-01-01',
    maturityDate: '',
    outstandingBalance: '1800000.0000',
    availableAmount: '1800000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-R-CM-001',
  },

  // ── Negative test customers ───────────────────────────────────────────────
  'EZBK-NEG-001': {
    id: 'EZBK-NEG-001',
    customerId: 'cc000001-0000-0000-0000-000000000010',
    productType: 'FIXED_DEPOSIT',
    principal: '5000000.0000',
    interestRate: '0.120000',
    accruedInterest: '100000.0000',
    effectiveDate: '2026-06-01',
    maturityDate: '2026-12-01',
    outstandingBalance: '5000000.0000',
    availableAmount: '5100000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-NEG-001',
  },
  'EZBK-NEG-002': {
    id: 'EZBK-NEG-002',
    customerId: 'cc000002-0000-0000-0000-000000000020',
    productType: 'FIXED_DEPOSIT',
    principal: '5000000.0000',
    interestRate: '0.120000',
    accruedInterest: '200000.0000',
    effectiveDate: '2026-06-01',
    maturityDate: '2026-12-01',
    outstandingBalance: '5000000.0000',
    availableAmount: '0.0000', // insufficient balance
    status: 'ACTIVE',
    externalReference: 'EZBK-NEG-002',
  },
  'EZBK-NEG-003': {
    id: 'EZBK-NEG-003',
    customerId: 'cc000003-0000-0000-0000-000000000030',
    productType: 'FIXED_DEPOSIT',
    principal: '3000000.0000',
    interestRate: '0.115000',
    accruedInterest: '75000.0000',
    effectiveDate: '2026-06-15',
    maturityDate: '2026-12-15',
    outstandingBalance: '3000000.0000',
    availableAmount: '3075000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-NEG-003',
  },
  'EZBK-NEG-004': {
    id: 'EZBK-NEG-004',
    customerId: 'cc000004-0000-0000-0000-000000000040',
    productType: 'FIXED_DEPOSIT',
    principal: '4000000.0000',
    interestRate: '0.120000',
    accruedInterest: '90000.0000',
    effectiveDate: '2026-07-01',
    maturityDate: '2027-01-01',
    outstandingBalance: '4000000.0000',
    availableAmount: '4090000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-NEG-004',
  },
  'EZBK-NEG-005': {
    id: 'EZBK-NEG-005',
    customerId: 'cc000005-0000-0000-0000-000000000050',
    productType: 'FIXED_DEPOSIT',
    principal: '8000000.0000',
    interestRate: '0.130000',
    accruedInterest: '250000.0000',
    effectiveDate: '2026-05-01',
    maturityDate: '2026-11-01',
    outstandingBalance: '8000000.0000',
    availableAmount: '8250000.0000',
    status: 'ACTIVE',
    externalReference: 'EZBK-NEG-005',
  },
  'EZBK-NEG-006': {
    id: 'EZBK-NEG-006',
    customerId: 'cc000006-0000-0000-0000-000000000060',
    productType: 'FIXED_DEPOSIT',
    principal: '0.0000',
    interestRate: '0.000000',
    accruedInterest: '0.0000',
    effectiveDate: '2026-01-01',
    maturityDate: '',
    outstandingBalance: '500000.0000',
    availableAmount: '500000.0000', // insufficient for ₦1,000,000 transfer
    status: 'ACTIVE',
    externalReference: 'EZBK-NEG-006',
  },
}

// ─── Seeded account balances ──────────────────────────────────────────────────
//
// Keyed by customer_accounts.id from supabase/seed.sql SECTION 5.
// Used by getBalance() for SAVINGS_FUNDS_OUT, CALL_FUNDS_OUT, CMS_FUNDS_OUT.

const SEEDED_BALANCES: Record<string, EazybankzBalance> = {
  'ac000001-0001-0000-0000-000000000010': { accountId: 'ac000001-0001-0000-0000-000000000010', availableBalance: '12450000.0000', ledgerBalance: '12450000.0000', currency: 'NGN' },
  'ac000002-0001-0000-0000-000000000020': { accountId: 'ac000002-0001-0000-0000-000000000020', availableBalance: '8000000.0000',  ledgerBalance: '8000000.0000',  currency: 'NGN' },
  'ac000003-0001-0000-0000-000000000030': { accountId: 'ac000003-0001-0000-0000-000000000030', availableBalance: '10000000.0000', ledgerBalance: '10000000.0000', currency: 'NGN' },
  'ac000004-0001-0000-0000-000000000040': { accountId: 'ac000004-0001-0000-0000-000000000040', availableBalance: '5000000.0000',  ledgerBalance: '5000000.0000',  currency: 'NGN' },
  'ac000005-0001-0000-0000-000000000050': { accountId: 'ac000005-0001-0000-0000-000000000050', availableBalance: '25000000.0000', ledgerBalance: '25000000.0000', currency: 'NGN' },
  'ac000006-0001-0000-0000-000000000060': { accountId: 'ac000006-0001-0000-0000-000000000060', availableBalance: '15000000.0000', ledgerBalance: '15000000.0000', currency: 'NGN' },
  'ac000007-0001-0000-0000-000000000070': { accountId: 'ac000007-0001-0000-0000-000000000070', availableBalance: '10000000.0000', ledgerBalance: '10000000.0000', currency: 'NGN' },
  'ac000008-0001-0000-0000-000000000080': { accountId: 'ac000008-0001-0000-0000-000000000080', availableBalance: '6000000.0000',  ledgerBalance: '6000000.0000',  currency: 'NGN' },
  'ac000009-0001-0000-0000-000000000090': { accountId: 'ac000009-0001-0000-0000-000000000090', availableBalance: '6000000.0000',  ledgerBalance: '6000000.0000',  currency: 'NGN' },
  'ac00000a-0001-0000-0000-0000000000a0': { accountId: 'ac00000a-0001-0000-0000-0000000000a0', availableBalance: '6000000.0000',  ledgerBalance: '6000000.0000',  currency: 'NGN' },
  'ac00000b-0001-0000-0000-0000000000b0': { accountId: 'ac00000b-0001-0000-0000-0000000000b0', availableBalance: '10000000.0000', ledgerBalance: '10000000.0000', currency: 'NGN' },
  'ac00000c-0001-0000-0000-0000000000c0': { accountId: 'ac00000c-0001-0000-0000-0000000000c0', availableBalance: '10000000.0000', ledgerBalance: '10000000.0000', currency: 'NGN' },
  'ac00000d-0001-0000-0000-0000000000d0': { accountId: 'ac00000d-0001-0000-0000-0000000000d0', availableBalance: '5000000.0000',  ledgerBalance: '5000000.0000',  currency: 'NGN' }, // Savings
  'ac00000d-0002-0000-0000-0000000000d0': { accountId: 'ac00000d-0002-0000-0000-0000000000d0', availableBalance: '0.0000',        ledgerBalance: '0.0000',        currency: 'NGN' }, // Personal dest
  'ac00000e-0001-0000-0000-0000000000e0': { accountId: 'ac00000e-0001-0000-0000-0000000000e0', availableBalance: '8000000.0000',  ledgerBalance: '8000000.0000',  currency: 'NGN' },
  'ac00000e-0002-0000-0000-0000000000e0': { accountId: 'ac00000e-0002-0000-0000-0000000000e0', availableBalance: '0.0000',        ledgerBalance: '0.0000',        currency: 'NGN' },
  'ac00000f-0001-0000-0000-0000000000f0': { accountId: 'ac00000f-0001-0000-0000-0000000000f0', availableBalance: '3000000.0000',  ledgerBalance: '3000000.0000',  currency: 'NGN' },
  'ac00000f-0002-0000-0000-0000000000f0': { accountId: 'ac00000f-0002-0000-0000-0000000000f0', availableBalance: '0.0000',        ledgerBalance: '0.0000',        currency: 'NGN' },
  'ac000010-0001-0000-0000-000000000100': { accountId: 'ac000010-0001-0000-0000-000000000100', availableBalance: '7000000.0000',  ledgerBalance: '7000000.0000',  currency: 'NGN' },
  'ac000011-0001-0000-0000-000000000110': { accountId: 'ac000011-0001-0000-0000-000000000110', availableBalance: '2000000.0000',  ledgerBalance: '2000000.0000',  currency: 'NGN' },
  // Customer R — Savings / Call / CMS accounts
  'ac000012-0001-0000-0000-000000000120': { accountId: 'ac000012-0001-0000-0000-000000000120', availableBalance: '4500000.0000',  ledgerBalance: '4500000.0000',  currency: 'NGN' },
  'ac000012-0002-0000-0000-000000000120': { accountId: 'ac000012-0002-0000-0000-000000000120', availableBalance: '3200000.0000',  ledgerBalance: '3200000.0000',  currency: 'NGN' },
  'ac000012-0003-0000-0000-000000000120': { accountId: 'ac000012-0003-0000-0000-000000000120', availableBalance: '1800000.0000',  ledgerBalance: '1800000.0000',  currency: 'NGN' },
  // Negative test accounts
  'dd000001-0001-0000-0000-000000000010': { accountId: 'dd000001-0001-0000-0000-000000000010', availableBalance: '5000000.0000',  ledgerBalance: '5000000.0000',  currency: 'NGN' },
  'dd000002-0001-0000-0000-000000000020': { accountId: 'dd000002-0001-0000-0000-000000000020', availableBalance: '0.0000',        ledgerBalance: '0.0000',        currency: 'NGN' },
  'dd000003-0001-0000-0000-000000000030': { accountId: 'dd000003-0001-0000-0000-000000000030', availableBalance: '3000000.0000',  ledgerBalance: '3000000.0000',  currency: 'NGN' },
  'dd000004-0001-0000-0000-000000000040': { accountId: 'dd000004-0001-0000-0000-000000000040', availableBalance: '4000000.0000',  ledgerBalance: '4000000.0000',  currency: 'NGN' },
  'dd000005-0001-0000-0000-000000000050': { accountId: 'dd000005-0001-0000-0000-000000000050', availableBalance: '8000000.0000',  ledgerBalance: '8000000.0000',  currency: 'NGN' },
  'dd000006-0001-0000-0000-000000000060': { accountId: 'dd000006-0001-0000-0000-000000000060', availableBalance: '500000.0000',   ledgerBalance: '500000.0000',   currency: 'NGN' },
  'dd000006-0002-0000-0000-000000000060': { accountId: 'dd000006-0002-0000-0000-000000000060', availableBalance: '0.0000',        ledgerBalance: '0.0000',        currency: 'NGN' },
}

// ─── Counter for generating unique IDs ───────────────────────────────────────

let _idCounter = 1

function nextId(prefix: string): string {
  return `${prefix}-${String(_idCounter++).padStart(6, '0')}-${Date.now()}`
}

// ─── Mock adapter implementation ─────────────────────────────────────────────

class MockEazybankzAdapter implements EazybankzAdapter {
  /**
   * Mutable in-memory investment store.
   * Starts with the A–R seed data; createInvestment() and updateInvestment()
   * mutate this map so tests and linked scenarios see consistent state.
   */
  private readonly investments: Map<string, EazybankzInvestment> = new Map(
    Object.entries(SEEDED_INVESTMENTS).map(([k, v]) => [k, { ...v }]),
  )

  /**
   * In-memory transaction ledger.
   * createTransaction() appends here; reverseTransaction() marks reversed.
   */
  private readonly transactions: Map<string, StoredTransaction> = new Map()

  // ── getInvestment ──────────────────────────────────────────────────────────

  /**
   * Returns the investment record for the given external reference.
   *
   * Throws EazybankzError('NOT_FOUND') for unknown IDs.
   * Throws EazybankzError('SIMULATED_FAILURE') for IDs prefixed with 'FAIL_',
   * enabling failure-path testing without special DB setup (Req 30.2).
   */
  async getInvestment(investmentId: string): Promise<EazybankzInvestment> {
    if (investmentId.startsWith('FAIL_')) {
      throw new EazybankzError(
        `Simulated Eazybankz failure for investment: ${investmentId}`,
        'SIMULATED_FAILURE',
      )
    }

    const investment = this.investments.get(investmentId)
    if (!investment) {
      throw new EazybankzError(
        `Investment not found in Eazybankz mirror: ${investmentId}`,
        'NOT_FOUND',
      )
    }

    // Return a shallow copy so callers cannot mutate the store directly
    return { ...investment }
  }

  // ── getBalance ─────────────────────────────────────────────────────────────

  /**
   * Returns the account balance for the given account ID.
   * Used for SAVINGS_FUNDS_OUT, CALL_FUNDS_OUT, and CMS_FUNDS_OUT (Req 30.1).
   */
  async getBalance(accountId: string): Promise<EazybankzBalance> {
    const balance = SEEDED_BALANCES[accountId]
    if (!balance) {
      throw new EazybankzError(
        `Account not found in Eazybankz mirror: ${accountId}`,
        'NOT_FOUND',
      )
    }
    return { ...balance }
  }

  // ── getAccruedInterest ─────────────────────────────────────────────────────

  /**
   * Returns the accrued interest string for the given investment ID.
   * Used for ANNIVERSARY_PAYMENT and PRE_LIQUIDATION scenarios (Req 30.1).
   */
  async getAccruedInterest(investmentId: string): Promise<string> {
    const investment = await this.getInvestment(investmentId)
    return investment.accruedInterest
  }

  // ── createInvestment ───────────────────────────────────────────────────────

  /**
   * Creates and stores a new investment entry in the in-memory store.
   * Called on Operations execution for ROLLOVER, INFLOW, and
   * INTERNAL_TRANSFER (Commercial Paper / Call) scenarios (Req 17.7).
   */
  async createInvestment(data: CreateInvestmentData): Promise<EazybankzInvestment> {
    const externalReference = nextId('EZBK-NEW')

    const maturityDate = computeMaturityDate(data.effectiveDate, data.tenorDays)

    const investment: EazybankzInvestment = {
      id: externalReference,
      customerId: data.customerId,
      productType: (data.productType as EazybankzInvestment['productType']) ?? 'FIXED_DEPOSIT',
      principal: data.principal,
      interestRate: data.interestRate,
      accruedInterest: '0.0000',
      effectiveDate: data.effectiveDate,
      maturityDate,
      outstandingBalance: data.principal,
      availableAmount: data.principal,
      status: 'ACTIVE',
      externalReference,
    }

    this.investments.set(externalReference, investment)
    return { ...investment }
  }

  // ── updateInvestment ───────────────────────────────────────────────────────

  /**
   * Merges the supplied partial data into the stored investment entry
   * and returns the updated record.
   *
   * Handles status transitions for:
   *   - MATURITY_TERMINATION  → status: 'TERMINATED' (Req 18.3)
   *   - PRE_LIQUIDATION       → rebooking / balance  (Req 19.5)
   *   - ANNIVERSARY_PAYMENT   → reset accrued interest (Req 20.4)
   *   - SAVINGS/CALL/CMS      → updated balance        (Req 24.3)
   */
  async updateInvestment(
    investmentId: string,
    data: Partial<CreateInvestmentData> & {
      status?: EazybankzInvestment['status']
      accruedInterest?: string
      outstandingBalance?: string
      availableAmount?: string
    },
  ): Promise<EazybankzInvestment> {
    const existing = await this.getInvestment(investmentId)

    const updated: EazybankzInvestment = {
      ...existing,
      // If principal is explicitly updated, cascade to balance fields (unless overridden below)
      ...(data.principal !== undefined && {
        principal: data.principal,
        outstandingBalance: data.principal,
        availableAmount: data.principal,
      }),
      ...(data.interestRate !== undefined && { interestRate: data.interestRate }),
      ...(data.effectiveDate !== undefined && { effectiveDate: data.effectiveDate }),
      ...(data.status !== undefined && { status: data.status }),
      // Allow callers to override balance fields directly (e.g. partial pre-liquidation, funds-out)
      ...(data.outstandingBalance !== undefined && { outstandingBalance: data.outstandingBalance }),
      ...(data.availableAmount !== undefined && { availableAmount: data.availableAmount }),
      // Allow callers to reset accrued interest (e.g. after anniversary payment payout)
      ...(data.accruedInterest !== undefined && { accruedInterest: data.accruedInterest }),
    }

    this.investments.set(investmentId, updated)
    return { ...updated }
  }

  // ── createTransaction ──────────────────────────────────────────────────────

  /**
   * Records a payment transaction in the in-memory ledger.
   * Called for THIRD_PARTY_PAYMENT and INTERNAL_TRANSFER scenarios (Req 30.3).
   * Returns a unique Eazybankz-assigned transaction ID.
   */
  async createTransaction(data: CreateTransactionData): Promise<{ transactionId: string }> {
    const transactionId = nextId('EZBK-TXN')

    this.transactions.set(transactionId, {
      transactionId,
      data,
      reversed: false,
    })

    return { transactionId }
  }

  // ── reverseTransaction ─────────────────────────────────────────────────────

  /**
   * Marks the original Eazybankz transaction as reversed.
   * Called on Operations execution for REVERSAL type (Req 25.3).
   *
   * @param transactionId  The Eazybankz transaction ID of the original posting.
   * @param reason         Non-empty reversal reason (Req 25.2).
   */
  async reverseTransaction(
    transactionId: string,
    reason: string,
  ): Promise<{ reversalId: string }> {
    if (!reason || reason.trim() === '') {
      throw new EazybankzError(
        'reverseTransaction: reason must not be empty (Req 25.2)',
        'VALIDATION_ERROR',
      )
    }

    const stored = this.transactions.get(transactionId)
    if (!stored) {
      // The transaction may not have been created via createTransaction()
      // in this process (e.g. the original was created by a DB-backed flow).
      // Create a synthetic reversal record so the reversal ID is trackable.
      const reversalId = nextId('EZBK-REVERSAL')
      this.transactions.set(transactionId, {
        transactionId,
        data: {} as CreateTransactionData,
        reversed: true,
        reversalId,
      })
      return { reversalId }
    }

    if (stored.reversed) {
      throw new EazybankzError(
        `Transaction ${transactionId} is already reversed`,
        'ALREADY_REVERSED',
      )
    }

    const reversalId = nextId('EZBK-REVERSAL')
    stored.reversed = true
    stored.reversalId = reversalId

    return { reversalId }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Computes ISO date string (YYYY-MM-DD) for effectiveDate + tenorDays. */
function computeMaturityDate(effectiveDate: string, tenorDays: number): string {
  const date = new Date(effectiveDate)
  date.setDate(date.getDate() + tenorDays)
  return date.toISOString().split('T')[0]
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const mockEazybankzAdapter = new MockEazybankzAdapter()
