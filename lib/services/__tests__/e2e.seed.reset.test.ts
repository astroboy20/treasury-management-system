/**
 * Task 7.12 — E2E Seed Reset Function Verification
 *
 * Verifies that `reset_e2e_transactions()` correctly:
 *
 *   1. Deletes ALL transactions created by _e2e users (including those at
 *      various workflow stages, with various child records attached).
 *   2. Cascades the delete to all child tables:
 *      - audit_events
 *      - signature_verifications
 *      - customer_confirmations
 *      - investment_verifications
 *      - vouchers
 *      - approvals
 *      - operations_executions
 *      - payment_instructions
 *      - transaction_documents
 *   3. Does NOT touch transactions created by scenario (_01) users.
 *   4. Does NOT touch the scenario customer/investment/account seed data.
 *   5. Is idempotent — calling it a second time with no e2e transactions is safe.
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
 *   - All migrations (001–007) applied to the live project
 *   - supabase/seed.sql applied (provides _e2e and _01 profiles, customers A–R)
 *
 * Run with:
 *   pnpm test -- e2e.seed.reset --reporter=verbose
 *
 * Requirements: 39.4, 39.6
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ─── Env ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ─── Known customer / investment IDs from seed.sql ───────────────────────────
// Customer A (rollover scenario) — used to create e2e transactions
const CUSTOMER_A    = 'aaaaaaaa-0001-0000-0000-000000000001'
const INVESTMENT_A  = 'bb000001-0001-0000-0000-000000000010'

// Customer E (maturity termination) — used for a second e2e transaction
const CUSTOMER_E    = 'aaaaaaaa-0005-0000-0000-000000000005'
const INVESTMENT_E  = 'bb000005-0001-0000-0000-000000000050'

// ─── Profile IDs resolved at runtime from the live DB ────────────────────────
// We look up by email so the test works whether IDs match the seed constants
// or not (e.g. when the DB was seeded via Supabase Auth API which assigns
// its own UUIDs, or when the seed was applied on a fresh instance).
let E2E_TREASURY_ID:    string
let E2E_ACCOUNT_ID:     string
let E2E_OPERATIONS_ID:  string
let SCENARIO_TREASURY_ID: string

// ─── Client factory ───────────────────────────────────────────────────────────

/** Service-role client. Bypasses RLS. Used for all setup/assertions here. */
function admin() {
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// ─── Transaction seeding helpers ─────────────────────────────────────────────

interface SeedTxOpts {
  customerId:     string
  investmentId:   string
  createdById:    string
  transactionType?: string
  status?:        string
}

/** Inserts a treasury_transaction row directly (admin client, bypasses RLS). */
async function seedTx(opts: SeedTxOpts): Promise<string> {
  const txId = crypto.randomUUID()
  const ref  = `TRX-E2E-RESET-${Date.now()}-${txId.slice(0, 8)}`

  const { error } = await admin().from('treasury_transactions').insert({
    id:                     txId,
    transaction_reference:  ref,
    customer_id:            opts.customerId,
    investment_id:          opts.investmentId,
    transaction_type:       opts.transactionType ?? 'ROLLOVER',
    scenario_code:          'P_AND_I',
    status:                 opts.status ?? 'INSTRUCTION_RECEIVED',
    requested_amount:       5_000_000,
    purpose:                'E2E reset verification test',
    source_instruction_type:'LETTER',
    sla_due_at:             new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    created_by:             opts.createdById,
  })

  if (error) throw new Error(`seedTx failed: ${error.message}`)
  return txId
}

/** Attaches a signature_verifications child row to a transaction. */
async function seedSignatureVerification(txId: string, verifiedById: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('signature_verifications').insert({
    id,
    transaction_id:            txId,
    verified_by:               verifiedById,
    signature_result:          'PASSED',
    mandate_result:            'PASSED',
    account_ownership_result:  'PASSED',
    completeness_result:       'PASSED',
    notes:                     'E2E reset test',
  })
  if (error) throw new Error(`seedSignatureVerification failed: ${error.message}`)
  return id
}

/** Attaches a customer_confirmations child row to a transaction. */
async function seedCustomerConfirmation(txId: string, confirmedById: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('customer_confirmations').insert({
    id,
    transaction_id:      txId,
    confirmed_by:        confirmedById,
    confirmation_status: 'CONFIRMED',
    confirmed_amount:    5_000_000,
    confirmed_purpose:   'E2E reset test',
    confirmation_date:   '2026-09-08',
    confirmation_time:   '10:00:00',
  })
  if (error) throw new Error(`seedCustomerConfirmation failed: ${error.message}`)
  return id
}

/** Attaches an investment_verifications child row to a transaction. */
async function seedInvestmentVerification(txId: string, verifiedById: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('investment_verifications').insert({
    id,
    transaction_id:     txId,
    verified_by:        verifiedById,
    source_system:      'EAZYBANKZ',
    principal:          12_450_000,
    accrued_interest:   245_000,
    interest_rate:      0.125,
    effective_date:     '2026-03-03',
    maturity_date:      '2026-09-03',
    outstanding_balance:12_450_000,
    available_amount:   12_695_000,
  })
  if (error) throw new Error(`seedInvestmentVerification failed: ${error.message}`)
  return id
}

/** Attaches a voucher row to a transaction. */
async function seedVoucher(txId: string, createdById: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('vouchers').insert({
    id,
    transaction_id:       txId,
    voucher_number:       `VCH-E2E-${id.slice(0, 8)}`,
    voucher_type:         'ROLLOVER_SLIP',
    status:               'DRAFT',
    principal:            12_450_000,
    interest:             245_000,
    net_amount:           12_695_000,
    transfer_date:        '2026-09-08',
    calculation_snapshot: { rule: 'P_AND_I', inputs: {}, outputs: {} },
    created_by:           createdById,
  })
  if (error) throw new Error(`seedVoucher failed: ${error.message}`)
  return id
}

/** Attaches an approvals row to a transaction. */
async function seedApproval(txId: string, approverId: string, stage: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('approvals').insert({
    id,
    transaction_id: txId,
    stage,
    approver_id:    approverId,
    decision:       'APPROVE',
    comments:       null,
  })
  if (error) throw new Error(`seedApproval(${stage}) failed: ${error.message}`)
  return id
}

/** Attaches an operations_executions row to a transaction. */
async function seedOperationsExecution(txId: string, executedById: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('operations_executions').insert({
    id,
    transaction_id:   txId,
    executed_by:      executedById,
    execution_status: 'SUCCESS',
    external_reference: 'EXTREF-E2E-001',
    execution_notes:  'E2E reset test execution',
  })
  if (error) throw new Error(`seedOperationsExecution failed: ${error.message}`)
  return id
}

/** Attaches a payment_instructions row to a transaction. */
async function seedPaymentInstruction(txId: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin().from('payment_instructions').insert({
    id,
    transaction_id:   txId,
    beneficiary_name: 'Test Beneficiary',
    bank_name:        'Test Bank',
    account_number:   '0012345678',
    account_type:     'PERSONAL',
    amount:           12_695_000,
    transfer_charge:  0,
    purpose:          'E2E reset test',
    is_internal:      false,
  })
  if (error) throw new Error(`seedPaymentInstruction failed: ${error.message}`)
  return id
}

/** Attaches an audit_events row to a transaction. */
async function seedAuditEvent(txId: string, actorId: string): Promise<number> {
  const { data, error } = await admin()
    .from('audit_events')
    .insert({
      transaction_id: txId,
      actor_id:       actorId,
      event_type:     'TRANSACTION_CREATED',
      from_status:    null,
      to_status:      'INSTRUCTION_RECEIVED',
      metadata:       { source: 'e2e_reset_test' },
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`seedAuditEvent failed: ${error?.message}`)
  return data.id
}

// ─── Helpers to count child rows ──────────────────────────────────────────────

async function countChildRows(table: string, txId: string): Promise<number> {
  const { count, error } = await admin()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('transaction_id', txId)

  if (error) throw new Error(`count ${table} failed: ${error.message}`)
  return count ?? 0
}

async function txExists(txId: string): Promise<boolean> {
  const { data } = await admin()
    .from('treasury_transactions')
    .select('id')
    .eq('id', txId)
    .maybeSingle()
  return data !== null
}

// ─── State captured in beforeAll ─────────────────────────────────────────────

// E2E transactions that MUST be deleted after reset
let e2eTxId1: string       // Customer A — fully built-out with all child records
let e2eTxId2: string       // Customer E — minimal (transaction row only)
let e2eTxId3: string       // Customer A again — MATURITY_TERMINATION type
// Audit event IDs stored for the cascade assertion
let auditEventId1: number
let auditEventId2: number

// Scenario transaction that MUST survive the reset
let scenarioTxId: string

// Resolved IDs from the live DB (populated in beforeAll)
let resolvedIds: {
  customerAId:   string
  investmentAId: string
  customerEId:   string
  investmentEId: string
}

// ─── Helper: resolve a profile ID from the live DB by email ──────────────────

async function resolveProfileId(email: string): Promise<string> {
  const { data, error } = await admin()
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  if (error || !data) {
    throw new Error(
      `Cannot resolve profile for "${email}". ` +
      `Ensure supabase/seed.sql has been applied to the live project. ` +
      `Error: ${error?.message ?? 'row not found'}`,
    )
  }
  return data.id
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('E2E seed reset function — reset_e2e_transactions()', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set ' +
        'to run live integration tests.',
      )
    }

    // ── Resolve actual profile IDs from the live DB ────────────────────────
    // We look up by email so the test works regardless of whether the UUIDs
    // in the live DB match the constants in seed.sql (they may differ if the
    // seed was applied via Supabase Auth API, which assigns its own UUIDs).
    E2E_TREASURY_ID      = await resolveProfileId('treasury_maker_e2e@greenline.test')
    E2E_ACCOUNT_ID       = await resolveProfileId('account_officer_e2e@greenline.test')
    E2E_OPERATIONS_ID    = await resolveProfileId('operations_officer_e2e@greenline.test')
    SCENARIO_TREASURY_ID = await resolveProfileId('treasury_maker_01@greenline.test')

    // ── Create three e2e transactions at different workflow stages ─────────
    // Resolve customer/investment IDs from the live DB by customer_number
    // so the test works even if seed UUIDs differ from the constants.
    const resolveCustomer = async (customerNumber: string) => {
      const { data, error } = await admin()
        .from('customers')
        .select('id')
        .eq('customer_number', customerNumber)
        .single()
      if (error || !data) throw new Error(`Customer ${customerNumber} not found: ${error?.message}`)
      return data.id as string
    }
    const resolveInvestment = async (externalRef: string) => {
      const { data, error } = await admin()
        .from('investments')
        .select('id')
        .eq('external_reference', externalRef)
        .single()
      if (error || !data) throw new Error(`Investment ${externalRef} not found: ${error?.message}`)
      return data.id as string
    }

    const customerAId   = await resolveCustomer('CUST-A-001')
    const investmentAId = await resolveInvestment('EZBK-A-001')
    const customerEId   = await resolveCustomer('CUST-E-001')
    const investmentEId = await resolveInvestment('EZBK-E-001')

    // TX 1: Customer A — fully built out (signature, confirmation, investment,
    //        voucher, approval, execution, payment instruction, audit event)
    e2eTxId1 = await seedTx({
      customerId:   customerAId,
      investmentId: investmentAId,
      createdById:  E2E_TREASURY_ID,
      status:       'COMPLETED',
    })
    await seedSignatureVerification(e2eTxId1, E2E_TREASURY_ID)
    await seedCustomerConfirmation(e2eTxId1, E2E_ACCOUNT_ID)
    await seedInvestmentVerification(e2eTxId1, E2E_TREASURY_ID)
    await seedVoucher(e2eTxId1, E2E_TREASURY_ID)
    await seedApproval(e2eTxId1, E2E_TREASURY_ID, 'TREASURY')
    await seedOperationsExecution(e2eTxId1, E2E_OPERATIONS_ID)
    await seedPaymentInstruction(e2eTxId1)
    auditEventId1 = await seedAuditEvent(e2eTxId1, E2E_TREASURY_ID)

    // TX 2: Customer E — minimal transaction row (status INSTRUCTION_RECEIVED)
    e2eTxId2 = await seedTx({
      customerId:   customerEId,
      investmentId: investmentEId,
      createdById:  E2E_TREASURY_ID,
      status:       'INSTRUCTION_RECEIVED',
    })
    auditEventId2 = await seedAuditEvent(e2eTxId2, E2E_TREASURY_ID)

    // TX 3: Customer A again — a second e2e transaction of a different type
    e2eTxId3 = await seedTx({
      customerId:      customerAId,
      investmentId:    investmentAId,
      createdById:     E2E_TREASURY_ID,
      transactionType: 'MATURITY_TERMINATION',
      status:          'VOUCHER_PREPARED',
    })
    await seedVoucher(e2eTxId3, E2E_TREASURY_ID)
    await seedAuditEvent(e2eTxId3, E2E_TREASURY_ID)

    // ── Create a scenario (_01) transaction that MUST survive ──────────────
    scenarioTxId = await seedTx({
      customerId:   customerAId,
      investmentId: investmentAId,
      createdById:  SCENARIO_TREASURY_ID,
      status:       'INSTRUCTION_RECEIVED',
    })
    await seedAuditEvent(scenarioTxId, SCENARIO_TREASURY_ID)

    // Store the resolved IDs on module scope for use in assertions below
    resolvedIds = { customerAId, investmentAId, customerEId, investmentEId }
  })

  afterAll(async () => {
    // Clean up the scenario transaction (it will not be cleaned up by the reset
    // function — that is the invariant we are testing). We delete it here so as
    // not to leave orphan data in the dev/staging DB.
    await admin()
      .from('treasury_transactions')
      .delete()
      .eq('id', scenarioTxId)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section A — Baseline: all seed data exists before reset
  // ─────────────────────────────────────────────────────────────────────────

  describe('A. Baseline — all seeded data exists before reset', () => {
    it('e2e TX 1 exists (fully built-out)', async () => {
      expect(await txExists(e2eTxId1)).toBe(true)
    })

    it('e2e TX 1 has a signature_verifications child row', async () => {
      expect(await countChildRows('signature_verifications', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has a customer_confirmations child row', async () => {
      expect(await countChildRows('customer_confirmations', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has an investment_verifications child row', async () => {
      expect(await countChildRows('investment_verifications', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has a vouchers child row', async () => {
      expect(await countChildRows('vouchers', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has an approvals child row', async () => {
      expect(await countChildRows('approvals', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has an operations_executions child row', async () => {
      expect(await countChildRows('operations_executions', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has a payment_instructions child row', async () => {
      expect(await countChildRows('payment_instructions', e2eTxId1)).toBe(1)
    })

    it('e2e TX 1 has an audit_events child row', async () => {
      expect(await countChildRows('audit_events', e2eTxId1)).toBeGreaterThanOrEqual(1)
    })

    it('e2e TX 2 exists (minimal)', async () => {
      expect(await txExists(e2eTxId2)).toBe(true)
    })

    it('e2e TX 3 exists (MATURITY_TERMINATION type)', async () => {
      expect(await txExists(e2eTxId3)).toBe(true)
    })

    it('scenario TX exists (must survive reset)', async () => {
      expect(await txExists(scenarioTxId)).toBe(true)
    })

    it('Customer A seed data is intact (Req 39.6)', async () => {
      const { data } = await admin()
        .from('customers')
        .select('id')
        .eq('id', resolvedIds.customerAId)
        .maybeSingle()
      expect(data).not.toBeNull()
    })

    it('Customer E seed data is intact (Req 39.6)', async () => {
      const { data } = await admin()
        .from('customers')
        .select('id')
        .eq('id', resolvedIds.customerEId)
        .maybeSingle()
      expect(data).not.toBeNull()
    })

    it('Investment A seed data is intact (Req 39.6)', async () => {
      const { data } = await admin()
        .from('investments')
        .select('id')
        .eq('id', resolvedIds.investmentAId)
        .maybeSingle()
      expect(data).not.toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section B — Execute reset_e2e_transactions()
  // ─────────────────────────────────────────────────────────────────────────

  describe('B. Reset — calling reset_e2e_transactions()', () => {
    it('reset_e2e_transactions() executes without error (Req 39.4)', async () => {
      const { error } = await admin().rpc('reset_e2e_transactions')
      expect(error).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section C — Post-reset: all e2e transactions are gone
  // ─────────────────────────────────────────────────────────────────────────

  describe('C. Post-reset — e2e transactions deleted (Req 39.4)', () => {
    it('e2e TX 1 (fully built-out) is deleted', async () => {
      expect(await txExists(e2eTxId1)).toBe(false)
    })

    it('e2e TX 2 (minimal) is deleted', async () => {
      expect(await txExists(e2eTxId2)).toBe(false)
    })

    it('e2e TX 3 (MATURITY_TERMINATION) is deleted', async () => {
      expect(await txExists(e2eTxId3)).toBe(false)
    })

    it('no treasury_transactions rows exist for any _e2e profile', async () => {
      // Query all e2e profile IDs and confirm no transactions remain
      const { data: e2eProfiles } = await admin()
        .from('profiles')
        .select('id')
        .like('email', '%_e2e@greenline.test')

      if (!e2eProfiles || e2eProfiles.length === 0) return

      const e2eProfileIds = e2eProfiles.map((p: { id: string }) => p.id)

      const { count } = await admin()
        .from('treasury_transactions')
        .select('*', { count: 'exact', head: true })
        .in('created_by', e2eProfileIds)

      expect(count ?? 0).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section D — Post-reset: child records cascade-deleted (Req 39.4)
  // ─────────────────────────────────────────────────────────────────────────

  describe('D. Post-reset — child records cascade-deleted (Req 39.4)', () => {
    it('signature_verifications for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('signature_verifications', e2eTxId1)).toBe(0)
    })

    it('customer_confirmations for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('customer_confirmations', e2eTxId1)).toBe(0)
    })

    it('investment_verifications for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('investment_verifications', e2eTxId1)).toBe(0)
    })

    it('vouchers for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('vouchers', e2eTxId1)).toBe(0)
    })

    it('vouchers for e2e TX 3 (MATURITY_TERMINATION) are deleted', async () => {
      expect(await countChildRows('vouchers', e2eTxId3)).toBe(0)
    })

    it('approvals for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('approvals', e2eTxId1)).toBe(0)
    })

    it('operations_executions for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('operations_executions', e2eTxId1)).toBe(0)
    })

    it('payment_instructions for e2e TX 1 are deleted', async () => {
      expect(await countChildRows('payment_instructions', e2eTxId1)).toBe(0)
    })

    it('audit_events for e2e TX 1 are deleted (cascade from treasury_transactions)', async () => {
      expect(await countChildRows('audit_events', e2eTxId1)).toBe(0)
    })

    it('audit_events for e2e TX 2 are deleted', async () => {
      expect(await countChildRows('audit_events', e2eTxId2)).toBe(0)
    })

    it('the specific audit event ID seeded for TX 1 no longer exists', async () => {
      const { data } = await admin()
        .from('audit_events')
        .select('id')
        .eq('id', auditEventId1)
        .maybeSingle()
      expect(data).toBeNull()
    })

    it('the specific audit event ID seeded for TX 2 no longer exists', async () => {
      const { data } = await admin()
        .from('audit_events')
        .select('id')
        .eq('id', auditEventId2)
        .maybeSingle()
      expect(data).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section E — Scenario data untouched (Req 39.6)
  // ─────────────────────────────────────────────────────────────────────────

  describe('E. Scenario data untouched after reset (Req 39.6)', () => {
    it('scenario TX (created by _01 user) still exists after reset', async () => {
      expect(await txExists(scenarioTxId)).toBe(true)
    })

    it('Customer A row is intact after reset', async () => {
      const { data } = await admin()
        .from('customers')
        .select('id, name, customer_number')
        .eq('id', resolvedIds.customerAId)
        .maybeSingle()
      expect(data).not.toBeNull()
      expect(data?.customer_number).toBe('CUST-A-001')
    })

    it('Customer E row is intact after reset', async () => {
      const { data } = await admin()
        .from('customers')
        .select('id, customer_number')
        .eq('id', resolvedIds.customerEId)
        .maybeSingle()
      expect(data).not.toBeNull()
      expect(data?.customer_number).toBe('CUST-E-001')
    })

    it('Investment A row is intact after reset (principal, rate, accrued interest unchanged)', async () => {
      const { data } = await admin()
        .from('investments')
        .select('id, principal, interest_rate, accrued_interest, status')
        .eq('id', resolvedIds.investmentAId)
        .maybeSingle()
      expect(data).not.toBeNull()
      expect(parseFloat(data?.principal)).toBe(12_450_000)
      expect(parseFloat(data?.interest_rate)).toBeCloseTo(0.125, 6)
      expect(parseFloat(data?.accrued_interest)).toBe(245_000)
      expect(data?.status).toBe('ACTIVE')
    })

    it('Investment E row is intact after reset', async () => {
      const { data } = await admin()
        .from('investments')
        .select('id, principal, status')
        .eq('id', resolvedIds.investmentEId)
        .maybeSingle()
      expect(data).not.toBeNull()
      expect(parseFloat(data?.principal)).toBe(25_000_000)
      expect(data?.status).toBe('ACTIVE')
    })

    it('all 18 scenario customers (A–R) are present after reset', async () => {
      // Customer IDs follow the aaaaaaaa-00NN-... prefix pattern
      const { count } = await admin()
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .like('id', 'aaaaaaaa-%')

      // 18 scenario customers (A–R)
      expect(count).toBeGreaterThanOrEqual(18)
    })

    it('all 14 staff profiles are present after reset', async () => {
      // Profile IDs: 11111111-000X (scenario) and 22222222-000X (e2e) — 14 total
      const { count: scenario } = await admin()
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .like('id', '11111111-%')

      const { count: e2e } = await admin()
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .like('id', '22222222-%')

      expect(scenario).toBeGreaterThanOrEqual(7)
      expect(e2e).toBeGreaterThanOrEqual(7)
    })

    it('user_roles assignments are intact after reset', async () => {
      // The reset function only touches treasury_transactions — user_roles must be untouched
      const { count } = await admin()
        .from('user_roles')
        .select('*', { count: 'exact', head: true })
        .in('user_id', [
          E2E_TREASURY_ID,
          E2E_ACCOUNT_ID,
          E2E_OPERATIONS_ID,
          SCENARIO_TREASURY_ID,
        ])

      // Each of the 4 checked users has exactly one role assigned
      expect(count).toBeGreaterThanOrEqual(4)
    })

    it('audit events for the scenario TX are not affected by the reset', async () => {
      // The scenario TX audit event was seeded; after reset it must still be there
      expect(await countChildRows('audit_events', scenarioTxId)).toBeGreaterThanOrEqual(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section F — Idempotency: calling reset twice is safe (Req 39.4)
  // ─────────────────────────────────────────────────────────────────────────

  describe('F. Idempotency — calling reset_e2e_transactions() again is safe (Req 39.4)', () => {
    it('second call to reset_e2e_transactions() returns no error', async () => {
      const { error } = await admin().rpc('reset_e2e_transactions')
      expect(error).toBeNull()
    })

    it('scenario TX is still intact after second reset call', async () => {
      expect(await txExists(scenarioTxId)).toBe(true)
    })

    it('no e2e transactions exist after second reset call', async () => {
      const { data: e2eProfiles } = await admin()
        .from('profiles')
        .select('id')
        .like('email', '%_e2e@greenline.test')

      if (!e2eProfiles || e2eProfiles.length === 0) return

      const e2eProfileIds = e2eProfiles.map((p: { id: string }) => p.id)

      const { count } = await admin()
        .from('treasury_transactions')
        .select('*', { count: 'exact', head: true })
        .in('created_by', e2eProfileIds)

      expect(count ?? 0).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Section G — New e2e transaction after reset is also cleanable (Req 39.4)
  // Proves the function is re-usable, not a one-shot.
  // ─────────────────────────────────────────────────────────────────────────

  describe('G. Re-usability — new e2e transaction created post-reset is also deleted', () => {
    let newE2eTxId: string

    it('can create a new e2e transaction after the reset', async () => {
      newE2eTxId = await seedTx({
        customerId:   resolvedIds.customerAId,
        investmentId: resolvedIds.investmentAId,
        createdById:  E2E_TREASURY_ID,
        status:       'INSTRUCTION_RECEIVED',
      })
      expect(await txExists(newE2eTxId)).toBe(true)
    })

    it('reset_e2e_transactions() deletes the newly created e2e transaction', async () => {
      const { error } = await admin().rpc('reset_e2e_transactions')
      expect(error).toBeNull()
      expect(await txExists(newE2eTxId)).toBe(false)
    })

    it('scenario TX is still intact after third reset call', async () => {
      expect(await txExists(scenarioTxId)).toBe(true)
    })
  })
})
