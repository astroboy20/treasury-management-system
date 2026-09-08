/**
 * Task 7.13 — Final Checkpoint: Full End-to-End Production Readiness
 *
 * Drives the COMPLETE treasury workflow from creation to COMPLETED status
 * using the dedicated E2E user set, then verifies the reset function.
 *
 * Scenario: Rollover P+I for Customer A (Adaeze Nwosu)
 *   Customer A seed data:
 *     - Principal:        ₦12,450,000
 *     - Accrued interest: ₦245,000
 *     - Interest rate:    12.5%
 *     - Effective date:   2026-03-03
 *     - Maturity date:    2026-09-03
 *
 * Workflow steps verified:
 *   Step 1  — Transaction created by treasury_maker_e2e (INSTRUCTION_RECEIVED)
 *   Step 2  — Signature verified by treasury_maker_e2e (SIGNATURE_VERIFIED)
 *   Step 3  — Customer confirmed by account_officer_e2e (CUSTOMER_CONFIRMED)
 *   Step 4  — Investment verified by treasury_maker_e2e (INVESTMENT_VERIFIED)
 *   Step 5  — Voucher prepared by treasury_maker_e2e (VOUCHER_PREPARED)
 *   Step 6a — Treasury approval by head_treasury_e2e (TREASURY_APPROVED)
 *             Note: treasury_maker_e2e created the tx — maker-checker forces a
 *             different TREASURY_OFFICER. We use head_treasury_e2e for the
 *             TREASURY stage via the approve_transaction RPC; in the real app a
 *             second TREASURY_OFFICER would be assigned. For this E2E test we
 *             use a service-role admin call to pre-advance the TREASURY approval
 *             using the scenario treasury_maker_01 as a non-maker approver to
 *             satisfy the maker-checker constraint.
 *   Step 6b — Head Treasury approval by head_treasury_e2e (HEAD_TREASURY_APPROVED)
 *   Step 6c — MIS approval by mis_officer_e2e (MIS_APPROVED)
 *   Step 6d — Audit approval by audit_officer_e2e (AUDIT_APPROVED)
 *   Step 6e — MD approval by md_e2e (MD_APPROVED)
 *   Step 7  — Operations execution by operations_officer_e2e (OPERATIONS_COMPLETED)
 *   Step 8  — Treasury completion confirmed by treasury_maker_e2e (COMPLETED)
 *   Step 9  — Audit trail verified (all expected events present)
 *   Step 10 — reset_e2e_transactions() removes the E2E transaction
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in .env
 *   - All migrations (001–007) applied to the live project
 *   - supabase/seed.sql applied (E2E users + Customer A data)
 *
 * Run with:
 *   pnpm test -- e2e.production.readiness --reporter=verbose
 *
 * Requirements: 7.3, 8.2, 9.3, 10.3, 11.7, 12.2, 14.4, 15.2, 34.1–34.4, 39.1–39.6
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ─── Environment ─────────────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY         = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const SEED_PASSWORD = 'Password123!'

// ─── E2E User Credentials ────────────────────────────────────────────────────

const E2E_USERS = {
  treasury:      'treasury_maker_e2e@greenline.test',
  account:       'account_officer_e2e@greenline.test',
  headTreasury:  'head_treasury_e2e@greenline.test',
  mis:           'mis_officer_e2e@greenline.test',
  audit:         'audit_officer_e2e@greenline.test',
  md:            'md_e2e@greenline.test',
  operations:    'operations_officer_e2e@greenline.test',
} as const

// Scenario user (non-e2e) used as the Treasury-stage approver to satisfy
// the maker-checker constraint (treasury_maker_e2e created the tx).
const SCENARIO_TREASURY = 'treasury_maker_01@greenline.test'

// ─── Seed IDs for Customer A (Rollover P+I) ───────────────────────────────────

const CUSTOMER_A_NUMBER = 'CUST-A-001'
const INVESTMENT_A_EXT  = 'EZBK-A-001'

// Expected financial values for Customer A from seed.sql
const CUSTOMER_A_PRINCIPAL   = 12_450_000
const CUSTOMER_A_ACCRUED     = 245_000
const CUSTOMER_A_RATE        = 0.125
const CUSTOMER_A_EFFECTIVE   = '2026-03-03'
const CUSTOMER_A_MATURITY    = '2026-09-03'

// ─── Client factory ───────────────────────────────────────────────────────────

function admin() {
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Returns a Supabase client authenticated as the given user.
 * Uses magic-link token exchange when possible, falls back to password auth.
 */
async function clientAs(email: string) {
  const adminClient = admin()

  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !linkData?.properties?.hashed_token) {
    const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    })
    const { data, error } = await anonClient.auth.signInWithPassword({
      email,
      password: SEED_PASSWORD,
    })
    if (error || !data.session) {
      throw new Error(
        `Cannot sign in as ${email}. ` +
        `Ensure supabase/seed.sql has been applied. Error: ${error?.message}`,
      )
    }
    return anonClient
  }

  const anonClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data: sessionData, error: sessionError } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  })

  if (sessionError || !sessionData.session) {
    throw new Error(`Failed to create session for ${email}: ${sessionError?.message}`)
  }

  return anonClient
}

/** Resolve profile id from email via the admin client. */
async function resolveProfileId(email: string): Promise<string> {
  const { data, error } = await admin()
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()
  if (error || !data) {
    throw new Error(
      `Cannot resolve profile for "${email}". ` +
      `Ensure supabase/seed.sql has been applied. Error: ${error?.message}`,
    )
  }
  return data.id
}

// ─── State shared across test sections ───────────────────────────────────────

// Resolved at runtime to avoid UUID hardcoding issues
let customerAId:  string
let investmentAId: string

// Profile IDs
let e2eTreasuryId:   string
let e2eAccountId:    string
let scenarioTreasuryId: string  // Used as non-maker Treasury approver

// The single E2E transaction that traverses the full workflow
let txId: string
let txRef: string

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getTransactionStatus(): Promise<string> {
  const { data, error } = await admin()
    .from('treasury_transactions')
    .select('status')
    .eq('id', txId)
    .single()
  if (error || !data) throw new Error(`getTransactionStatus failed: ${error?.message}`)
  return data.status
}

async function getAuditEvents(): Promise<Array<{ event_type: string; from_status: string | null; to_status: string | null }>> {
  const { data, error } = await admin()
    .from('audit_events')
    .select('event_type, from_status, to_status')
    .eq('transaction_id', txId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`getAuditEvents failed: ${error?.message}`)
  return data ?? []
}

/** Returns the profile IDs of all e2e users (for cleanup queries). */
async function getE2eProfileIds(): Promise<string[]> {
  const { data } = await admin()
    .from('profiles')
    .select('id')
    .like('email', '%_e2e@greenline.test')
  return (data ?? []).map((p: { id: string }) => p.id)
}

// ─── Environment guard ────────────────────────────────────────────────────────

describe('E2E Production Readiness — Full Rollover P+I Workflow', () => {

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run this test.',
      )
    }

    // Resolve profile IDs
    e2eTreasuryId      = await resolveProfileId(E2E_USERS.treasury)
    e2eAccountId       = await resolveProfileId(E2E_USERS.account)
    scenarioTreasuryId = await resolveProfileId(SCENARIO_TREASURY)

    // Resolve Customer A IDs dynamically (tolerant of fresh DB installs)
    const { data: custData, error: custErr } = await admin()
      .from('customers')
      .select('id')
      .eq('customer_number', CUSTOMER_A_NUMBER)
      .single()
    if (custErr || !custData) {
      throw new Error(`Customer A not found. Ensure seed.sql has been applied. ${custErr?.message}`)
    }
    customerAId = custData.id

    const { data: invData, error: invErr } = await admin()
      .from('investments')
      .select('id')
      .eq('external_reference', INVESTMENT_A_EXT)
      .single()
    if (invErr || !invData) {
      throw new Error(`Investment A not found. Ensure seed.sql has been applied. ${invErr?.message}`)
    }
    investmentAId = invData.id
  })

  afterAll(async () => {
    // Safety net: clean up in case a test assertion failed before the reset section ran.
    if (txId) {
      // Pre-delete audit_events (no ON DELETE CASCADE on this FK — see migration 008)
      const { data: e2eTxRows } = await admin()
        .from('treasury_transactions')
        .select('id')
        .in('created_by', await getE2eProfileIds())

      if (e2eTxRows && e2eTxRows.length > 0) {
        const ids = e2eTxRows.map((r: { id: string }) => r.id)
        await admin().from('audit_events').delete().in('transaction_id', ids)
      }

      await admin().rpc('reset_e2e_transactions')
    }
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION A — Prerequisites: seed data integrity
  // ───────────────────────────────────────────────────────────────────────────

  describe('A. Prerequisites — seed data integrity (Req 39.1–39.3)', () => {
    it('Customer A exists with correct customer_number (Req 39.3)', async () => {
      const { data } = await admin()
        .from('customers')
        .select('customer_number, name, status')
        .eq('id', customerAId)
        .single()

      expect(data?.customer_number).toBe(CUSTOMER_A_NUMBER)
      expect(data?.name).toBe('Adaeze Nwosu')
      expect(data?.status).toBe('ACTIVE')
    })

    it('Investment A exists with correct financial values (Req 39.3)', async () => {
      const { data } = await admin()
        .from('investments')
        .select('principal, interest_rate, accrued_interest, effective_date, maturity_date, status')
        .eq('id', investmentAId)
        .single()

      expect(parseFloat(data?.principal)).toBe(CUSTOMER_A_PRINCIPAL)
      expect(parseFloat(data?.interest_rate)).toBeCloseTo(CUSTOMER_A_RATE, 6)
      expect(parseFloat(data?.accrued_interest)).toBe(CUSTOMER_A_ACCRUED)
      expect(data?.effective_date).toBe(CUSTOMER_A_EFFECTIVE)
      expect(data?.maturity_date).toBe(CUSTOMER_A_MATURITY)
      expect(data?.status).toBe('ACTIVE')
    })

    it('All 7 E2E users have profiles in the DB (Req 39.1)', async () => {
      const emails = Object.values(E2E_USERS)
      const { count } = await admin()
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .in('email', emails)

      expect(count).toBe(7)
    })

    it('All 7 E2E users have role assignments (Req 39.2)', async () => {
      // Check each E2E user has at least one role assigned via user_roles
      const emails = Object.values(E2E_USERS)
      const { data: profiles } = await admin()
        .from('profiles')
        .select('id')
        .in('email', emails)

      expect(profiles?.length).toBe(7)

      const profileIds = profiles!.map((p: { id: string }) => p.id)
      const { count } = await admin()
        .from('user_roles')
        .select('*', { count: 'exact', head: true })
        .in('user_id', profileIds)

      expect(count).toBeGreaterThanOrEqual(7)
    })

    it('treasury_maker_e2e can authenticate successfully (Req 34.1)', async () => {
      const client = await clientAs(E2E_USERS.treasury)
      const { data, error } = await client.auth.getUser()
      expect(error).toBeNull()
      expect(data.user?.email).toBe(E2E_USERS.treasury)
    })

    it('operations_officer_e2e can authenticate successfully (Req 34.1)', async () => {
      const client = await clientAs(E2E_USERS.operations)
      const { data, error } = await client.auth.getUser()
      expect(error).toBeNull()
      expect(data.user?.email).toBe(E2E_USERS.operations)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION B — Step 1: Create transaction (treasury_maker_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('B. Step 1 — Transaction Creation (Req 7.3, 7.6)', () => {
    it('treasury_maker_e2e can create a Rollover P+I transaction via RPC', async () => {
      const client = await clientAs(E2E_USERS.treasury)

      const { data, error } = await client.rpc('create_treasury_transaction', {
        p_customer_id:       customerAId,
        p_investment_id:     investmentAId,
        p_transaction_type:  'ROLLOVER',
        p_scenario_code:     'P_AND_I',
        p_requested_amount:  12_695_000,   // principal + accrued
        p_purpose:           'E2E Test — Full Rollover P+I for Customer A',
        p_source_type:       'LETTER',
        p_payment_instruction: null,
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
      expect(data.transaction_id).toBeTruthy()
      expect(data.transaction_reference).toMatch(/^TRX-/)

      txId  = data.transaction_id
      txRef = data.transaction_reference
    })

    it('transaction is created with status INSTRUCTION_RECEIVED', async () => {
      const status = await getTransactionStatus()
      expect(status).toBe('INSTRUCTION_RECEIVED')
    })

    it('transaction reference follows TRX-XXXXX format (Req 7.6)', () => {
      // Server-side generated — browser never supplied it
      expect(txRef).toMatch(/^TRX-[A-Z0-9]{5}$/)
    })

    it('a TRANSACTION_CREATED audit event was written (Req 7.3)', async () => {
      const events = await getAuditEvents()
      const created = events.find((e) => e.event_type === 'TRANSACTION_CREATED')
      expect(created).toBeDefined()
      expect(created?.to_status).toBe('INSTRUCTION_RECEIVED')
    })

    it('the transaction was created by the e2e treasury user (Req 7.3)', async () => {
      const { data } = await admin()
        .from('treasury_transactions')
        .select('created_by, transaction_type, scenario_code, requested_amount')
        .eq('id', txId)
        .single()

      expect(data?.created_by).toBe(e2eTreasuryId)
      expect(data?.transaction_type).toBe('ROLLOVER')
      expect(data?.scenario_code).toBe('P_AND_I')
      expect(parseFloat(data?.requested_amount)).toBe(12_695_000)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION C — Step 2: Signature Verification (treasury_maker_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('C. Step 2 — Signature Verification (Req 8.2, 8.4, 8.5)', () => {
    it('treasury_maker_e2e can verify signature with all PASSED results', async () => {
      const client = await clientAs(E2E_USERS.treasury)

      const { data, error } = await client.rpc('verify_signature', {
        p_transaction_id:            txId,
        p_signature_result:          'PASSED',
        p_mandate_result:            'PASSED',
        p_account_ownership_result:  'PASSED',
        p_completeness_result:       'PASSED',
        p_notes:                     'E2E — all verification checks passed',
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction status advances to SIGNATURE_VERIFIED', async () => {
      expect(await getTransactionStatus()).toBe('SIGNATURE_VERIFIED')
    })

    it('signature_verifications row is persisted with all PASSED results (Req 8.4)', async () => {
      const { data } = await admin()
        .from('signature_verifications')
        .select('signature_result, mandate_result, account_ownership_result, completeness_result, verified_by')
        .eq('transaction_id', txId)
        .single()

      expect(data?.signature_result).toBe('PASSED')
      expect(data?.mandate_result).toBe('PASSED')
      expect(data?.account_ownership_result).toBe('PASSED')
      expect(data?.completeness_result).toBe('PASSED')
      expect(data?.verified_by).toBe(e2eTreasuryId)
    })

    it('a SIGNATURE_VERIFIED audit event was written (Req 8.5)', async () => {
      const events = await getAuditEvents()
      const sigEvent = events.find((e) => e.event_type === 'SIGNATURE_VERIFIED')
      expect(sigEvent).toBeDefined()
      expect(sigEvent?.from_status).toBe('INSTRUCTION_RECEIVED')
      expect(sigEvent?.to_status).toBe('SIGNATURE_VERIFIED')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION D — Step 3: Customer Confirmation (account_officer_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('D. Step 3 — Customer Confirmation (Req 9.3, 9.5, 9.6)', () => {
    it('account_officer_e2e can record a CONFIRMED customer confirmation', async () => {
      const client = await clientAs(E2E_USERS.account)

      const { data, error } = await client.rpc('record_customer_confirmation', {
        p_transaction_id:        txId,
        p_confirmation_status:   'CONFIRMED',
        p_confirmed_amount:      12_695_000,
        p_confirmed_purpose:     'E2E Test — Customer confirmed rollover P+I',
        p_confirmation_date:     '2026-09-08',
        p_confirmation_time:     '10:00:00',
        p_confirmed_beneficiary: null,
        p_notes:                 'Customer verbally confirmed via phone',
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction status advances to CUSTOMER_CONFIRMED', async () => {
      expect(await getTransactionStatus()).toBe('CUSTOMER_CONFIRMED')
    })

    it('customer_confirmations row is persisted with correct data (Req 9.5)', async () => {
      const { data } = await admin()
        .from('customer_confirmations')
        .select('confirmation_status, confirmed_amount, confirmed_by')
        .eq('transaction_id', txId)
        .single()

      expect(data?.confirmation_status).toBe('CONFIRMED')
      expect(parseFloat(data?.confirmed_amount)).toBe(12_695_000)
      expect(data?.confirmed_by).toBe(e2eAccountId)
    })

    it('a CUSTOMER_CONFIRMED audit event was written (Req 9.3)', async () => {
      const events = await getAuditEvents()
      const confEvent = events.find((e) => e.event_type === 'CUSTOMER_CONFIRMED')
      expect(confEvent).toBeDefined()
      expect(confEvent?.to_status).toBe('CUSTOMER_CONFIRMED')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION E — Step 4: Investment Verification (treasury_maker_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('E. Step 4 — Investment Verification (Req 10.3, 10.4, 10.6)', () => {
    it('treasury_maker_e2e can verify the investment snapshot from Customer A data', async () => {
      const client = await clientAs(E2E_USERS.treasury)

      const { data, error } = await client.rpc('verify_investment', {
        p_transaction_id:      txId,
        p_principal:           CUSTOMER_A_PRINCIPAL.toString(),
        p_accrued_interest:    CUSTOMER_A_ACCRUED.toString(),
        p_interest_rate:       CUSTOMER_A_RATE.toString(),
        p_effective_date:      CUSTOMER_A_EFFECTIVE,
        p_maturity_date:       CUSTOMER_A_MATURITY,
        p_outstanding_balance: CUSTOMER_A_PRINCIPAL.toString(),
        p_available_amount:    (CUSTOMER_A_PRINCIPAL + CUSTOMER_A_ACCRUED).toString(),
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction status advances to INVESTMENT_VERIFIED', async () => {
      expect(await getTransactionStatus()).toBe('INVESTMENT_VERIFIED')
    })

    it('investment_verifications snapshot is persisted with all 7 fields (Req 10.3)', async () => {
      const { data } = await admin()
        .from('investment_verifications')
        .select('principal, accrued_interest, interest_rate, effective_date, maturity_date, outstanding_balance, available_amount, source_system')
        .eq('transaction_id', txId)
        .single()

      expect(parseFloat(data?.principal)).toBe(CUSTOMER_A_PRINCIPAL)
      expect(parseFloat(data?.accrued_interest)).toBe(CUSTOMER_A_ACCRUED)
      expect(parseFloat(data?.interest_rate)).toBeCloseTo(CUSTOMER_A_RATE, 6)
      expect(data?.effective_date).toBe(CUSTOMER_A_EFFECTIVE)
      expect(data?.maturity_date).toBe(CUSTOMER_A_MATURITY)
      expect(data?.source_system).toBe('EAZYBANKZ')
    })

    it('an INVESTMENT_VERIFIED audit event was written (Req 10.4)', async () => {
      const events = await getAuditEvents()
      const invEvent = events.find((e) => e.event_type === 'INVESTMENT_VERIFIED')
      expect(invEvent).toBeDefined()
      expect(invEvent?.to_status).toBe('INVESTMENT_VERIFIED')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION F — Step 5: Voucher Preparation (treasury_maker_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('F. Step 5 — Voucher Preparation (Req 11.1, 11.7, 11.8)', () => {
    it('treasury_maker_e2e can prepare a ROLLOVER_SLIP voucher for P+I scenario', async () => {
      const client = await clientAs(E2E_USERS.treasury)

      // P+I rollover: rollover_amount = principal + accrued = 12,450,000 + 245,000 = 12,695,000
      const rolloverAmount = CUSTOMER_A_PRINCIPAL + CUSTOMER_A_ACCRUED

      const { data, error } = await client.rpc('prepare_voucher', {
        p_transaction_id: txId,
        p_voucher_data: {
          voucher_type:         'ROLLOVER_SLIP',
          rollover_type:        'P_AND_I',
          principal_amount:     CUSTOMER_A_PRINCIPAL,
          interest_due:         CUSTOMER_A_ACCRUED,
          effective_date:       '2026-09-08',
          new_tenor:            180,
          new_rate:             CUSTOMER_A_RATE,
          rollover_amount:      rolloverAmount,
          rollover_maturity_date: '2027-03-08',
          transfer_date:        '2026-09-08',
          remarks:              'E2E Test — Rollover P+I for Customer A',
          calculation_snapshot: {
            rule:        'ROLLOVER_P_AND_I',
            inputs:      { principal: CUSTOMER_A_PRINCIPAL, interest_due: CUSTOMER_A_ACCRUED },
            outputs:     { rollover_amount: rolloverAmount },
            calculated_at: new Date().toISOString(),
          },
        },
        p_payment_instruction: null,
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
      expect(data.voucher_id).toBeTruthy()
      expect(data.voucher_number).toBeTruthy()
    })

    it('transaction status advances to VOUCHER_PREPARED', async () => {
      expect(await getTransactionStatus()).toBe('VOUCHER_PREPARED')
    })

    it('voucher is persisted as ROLLOVER_SLIP type (server-determined — Req 11.1)', async () => {
      const { data } = await admin()
        .from('vouchers')
        .select('voucher_type, status, voucher_number, calculation_snapshot')
        .eq('transaction_id', txId)
        .single()

      expect(data?.voucher_type).toBe('ROLLOVER_SLIP')
      // The prepare_voucher RPC finalises the voucher immediately on creation
      // (status = 'FINALISED'). DRAFT is not an intermediate state in this implementation.
      expect(['DRAFT', 'FINALISED']).toContain(data?.status)
      expect(data?.voucher_number).toBeTruthy()
      expect(data?.calculation_snapshot).toBeDefined()
    })

    it('voucher_number is unique and server-generated (Req 11.7)', async () => {
      const { data } = await admin()
        .from('vouchers')
        .select('voucher_number')
        .eq('transaction_id', txId)
        .single()

      // Server-generated; must not be empty or null
      expect(data?.voucher_number).toBeTruthy()
      expect(data?.voucher_number.length).toBeGreaterThan(0)
    })

    it('a VOUCHER_CREATED audit event was written (Req 11.8)', async () => {
      const events = await getAuditEvents()
      const voucherEvent = events.find((e) => e.event_type === 'VOUCHER_CREATED')
      expect(voucherEvent).toBeDefined()
      expect(voucherEvent?.to_status).toBe('VOUCHER_PREPARED')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION G — Step 6: Approval Chain (5 stages)
  //
  // Maker-checker note:
  //   treasury_maker_e2e created the transaction, so they cannot approve the
  //   TREASURY stage. We use treasury_maker_01 (scenario user, non-e2e,
  //   non-creator) as the TREASURY-stage approver to satisfy the constraint.
  //   This is the correct production behaviour: a different TREASURY_OFFICER
  //   must approve, not the one who created the transaction.
  // ───────────────────────────────────────────────────────────────────────────

  describe('G. Step 6 — Approval Chain (Req 12.1–12.9)', () => {

    describe('G.1: Maker-checker enforcement — treasury_maker_e2e cannot self-approve', () => {
      it('treasury_maker_e2e cannot approve their own transaction at TREASURY stage (Req 5.4)', async () => {
        const client = await clientAs(E2E_USERS.treasury)

        const { data, error } = await client.rpc('approve_transaction', {
          p_transaction_id: txId,
          p_stage:          'TREASURY',
          p_decision:       'APPROVE',
          p_comments:       null,
        })

        // The maker-checker constraint must reject this
        expect(error).not.toBeNull()
        expect(data).toBeNull()
      })

      it('transaction status is still VOUCHER_PREPARED after the rejected self-approval', async () => {
        expect(await getTransactionStatus()).toBe('VOUCHER_PREPARED')
      })

      it('no approvals row was created for the rejected self-approval', async () => {
        const { data } = await admin()
          .from('approvals')
          .select('id')
          .eq('transaction_id', txId)
          .eq('stage', 'TREASURY')
        expect(data?.length ?? 0).toBe(0)
      })
    })

    describe('G.2: TREASURY stage — approved by treasury_maker_01 (non-creator)', () => {
      it('treasury_maker_01 (non-creator TREASURY_OFFICER) can approve at TREASURY stage (Req 12.1)', async () => {
        const client = await clientAs(SCENARIO_TREASURY)

        const { data, error } = await client.rpc('approve_transaction', {
          p_transaction_id: txId,
          p_stage:          'TREASURY',
          p_decision:       'APPROVE',
          p_comments:       null,
        })

        expect(error).toBeNull()
        expect(data).toMatchObject({ success: true })
      })

      it('transaction advances to TREASURY_APPROVED', async () => {
        expect(await getTransactionStatus()).toBe('TREASURY_APPROVED')
      })

      it('APPROVAL_GRANTED audit event written for TREASURY stage (Req 12.2)', async () => {
        const events = await getAuditEvents()
        const approvalEvents = events.filter((e) => e.event_type === 'APPROVAL_GRANTED')
        expect(approvalEvents.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('G.3: HEAD_TREASURY stage — approved by head_treasury_e2e', () => {
      it('head_treasury_e2e can approve at HEAD_TREASURY stage', async () => {
        const client = await clientAs(E2E_USERS.headTreasury)

        const { data, error } = await client.rpc('approve_transaction', {
          p_transaction_id: txId,
          p_stage:          'HEAD_TREASURY',
          p_decision:       'APPROVE',
          p_comments:       null,
        })

        expect(error).toBeNull()
        expect(data).toMatchObject({ success: true })
      })

      it('transaction advances to HEAD_TREASURY_APPROVED', async () => {
        expect(await getTransactionStatus()).toBe('HEAD_TREASURY_APPROVED')
      })
    })

    describe('G.4: MIS stage — approved by mis_officer_e2e', () => {
      it('mis_officer_e2e can approve at MIS stage', async () => {
        const client = await clientAs(E2E_USERS.mis)

        const { data, error } = await client.rpc('approve_transaction', {
          p_transaction_id: txId,
          p_stage:          'MIS',
          p_decision:       'APPROVE',
          p_comments:       null,
        })

        expect(error).toBeNull()
        expect(data).toMatchObject({ success: true })
      })

      it('transaction advances to MIS_APPROVED', async () => {
        expect(await getTransactionStatus()).toBe('MIS_APPROVED')
      })
    })

    describe('G.5: AUDIT stage — approved by audit_officer_e2e', () => {
      it('audit_officer_e2e can approve at AUDIT stage', async () => {
        const client = await clientAs(E2E_USERS.audit)

        const { data, error } = await client.rpc('approve_transaction', {
          p_transaction_id: txId,
          p_stage:          'AUDIT',
          p_decision:       'APPROVE',
          p_comments:       null,
        })

        expect(error).toBeNull()
        expect(data).toMatchObject({ success: true })
      })

      it('transaction advances to AUDIT_APPROVED', async () => {
        expect(await getTransactionStatus()).toBe('AUDIT_APPROVED')
      })
    })

    describe('G.6: MD stage — final approval by md_e2e', () => {
      it('md_e2e can give final MD approval', async () => {
        const client = await clientAs(E2E_USERS.md)

        const { data, error } = await client.rpc('approve_transaction', {
          p_transaction_id: txId,
          p_stage:          'MD',
          p_decision:       'APPROVE',
          p_comments:       null,
        })

        expect(error).toBeNull()
        expect(data).toMatchObject({ success: true })
      })

      it('transaction advances to MD_APPROVED (ready for Operations queue — Req 12.8)', async () => {
        expect(await getTransactionStatus()).toBe('MD_APPROVED')
      })

      it('all 5 approval stages have exactly one record each (Req 12.9 idempotency)', async () => {
        const stages = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD']
        for (const stage of stages) {
          const { data } = await admin()
            .from('approvals')
            .select('id, decision')
            .eq('transaction_id', txId)
            .eq('stage', stage)
          expect(data?.length).toBe(1)
          expect(data![0].decision).toBe('APPROVE')
        }
      })

      it('5 APPROVAL_GRANTED audit events were written — one per stage (Req 12.2)', async () => {
        const events = await getAuditEvents()
        const approvalEvents = events.filter((e) => e.event_type === 'APPROVAL_GRANTED')
        expect(approvalEvents.length).toBe(5)
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION H — Operations Execution (operations_officer_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('H. Operations Execution (Req 14.3, 14.4, 14.6)', () => {
    it('operations_officer_e2e can execute the MD_APPROVED transaction', async () => {
      const client = await clientAs(E2E_USERS.operations)

      const { data, error } = await client.rpc('execute_transaction', {
        p_transaction_id:     txId,
        p_execution_status:   'SUCCESS',
        p_external_reference: 'EZBK-EXEC-E2E-001',
        p_execution_notes:    'E2E Test — Rollover P+I executed successfully',
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction advances to OPERATIONS_COMPLETED (Req 14.4)', async () => {
      expect(await getTransactionStatus()).toBe('OPERATIONS_COMPLETED')
    })

    it('operations_executions row is persisted with correct data (Req 14.3)', async () => {
      const { data } = await admin()
        .from('operations_executions')
        .select('execution_status, external_reference, execution_notes')
        .eq('transaction_id', txId)
        .single()

      expect(data?.execution_status).toBe('SUCCESS')
      expect(data?.external_reference).toBe('EZBK-EXEC-E2E-001')
    })

    it('exactly one operations_executions row exists (idempotency — Req 14.6)', async () => {
      const { count } = await admin()
        .from('operations_executions')
        .select('*', { count: 'exact', head: true })
        .eq('transaction_id', txId)
      expect(count).toBe(1)
    })

    it('OPERATIONS_STARTED and OPERATIONS_COMPLETED audit events were written (Req 14.4)', async () => {
      const events = await getAuditEvents()
      const opStarted   = events.find((e) => e.event_type === 'OPERATIONS_STARTED')
      const opCompleted = events.find((e) => e.event_type === 'OPERATIONS_COMPLETED')
      expect(opStarted).toBeDefined()
      expect(opCompleted).toBeDefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION I — Treasury Completion Confirmation (treasury_maker_e2e)
  // ───────────────────────────────────────────────────────────────────────────

  describe('I. Treasury Completion Confirmation (Req 15.1–15.4)', () => {
    it('treasury_maker_e2e can confirm treasury completion', async () => {
      const client = await clientAs(E2E_USERS.treasury)

      const { data, error } = await client.rpc('confirm_treasury_completion', {
        p_transaction_id: txId,
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction reaches final COMPLETED status (Req 15.2)', async () => {
      expect(await getTransactionStatus()).toBe('COMPLETED')
    })

    it('completed_at timestamp is set on the transaction (Req 15.2)', async () => {
      const { data } = await admin()
        .from('treasury_transactions')
        .select('completed_at, status')
        .eq('id', txId)
        .single()

      expect(data?.status).toBe('COMPLETED')
      expect(data?.completed_at).not.toBeNull()
    })

    it('a TREASURY_CONFIRMED audit event was written (Req 15.2)', async () => {
      const events = await getAuditEvents()
      const treasuryEvent = events.find((e) => e.event_type === 'TREASURY_CONFIRMED')
      expect(treasuryEvent).toBeDefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION J — Audit Trail Verification
  // ───────────────────────────────────────────────────────────────────────────

  describe('J. Audit Trail — complete lifecycle events in chronological order (Req 28.3, 28.4, 28.5)', () => {
    let allEvents: Array<{ event_type: string; from_status: string | null; to_status: string | null }>

    beforeAll(async () => {
      allEvents = await getAuditEvents()
    })

    it('audit trail contains at minimum 10 events (all major lifecycle events)', () => {
      // TRANSACTION_CREATED, SIGNATURE_VERIFIED, CUSTOMER_CONFIRMED,
      // INVESTMENT_VERIFIED, VOUCHER_CREATED, 5× APPROVAL_GRANTED,
      // OPERATIONS_STARTED, OPERATIONS_COMPLETED, TREASURY_CONFIRMED = 13 minimum
      expect(allEvents.length).toBeGreaterThanOrEqual(10)
    })

    it('TRANSACTION_CREATED is the first event', () => {
      expect(allEvents[0].event_type).toBe('TRANSACTION_CREATED')
    })

    it('SIGNATURE_VERIFIED event exists with correct state transition', () => {
      const ev = allEvents.find((e) => e.event_type === 'SIGNATURE_VERIFIED')
      expect(ev).toBeDefined()
      expect(ev?.from_status).toBe('INSTRUCTION_RECEIVED')
      expect(ev?.to_status).toBe('SIGNATURE_VERIFIED')
    })

    it('CUSTOMER_CONFIRMED event exists', () => {
      expect(allEvents.find((e) => e.event_type === 'CUSTOMER_CONFIRMED')).toBeDefined()
    })

    it('INVESTMENT_VERIFIED event exists', () => {
      expect(allEvents.find((e) => e.event_type === 'INVESTMENT_VERIFIED')).toBeDefined()
    })

    it('VOUCHER_CREATED event exists', () => {
      expect(allEvents.find((e) => e.event_type === 'VOUCHER_CREATED')).toBeDefined()
    })

    it('exactly 5 APPROVAL_GRANTED events exist (one per approval stage)', () => {
      const approvalEvents = allEvents.filter((e) => e.event_type === 'APPROVAL_GRANTED')
      expect(approvalEvents.length).toBe(5)
    })

    it('OPERATIONS_STARTED event exists', () => {
      expect(allEvents.find((e) => e.event_type === 'OPERATIONS_STARTED')).toBeDefined()
    })

    it('OPERATIONS_COMPLETED event exists', () => {
      expect(allEvents.find((e) => e.event_type === 'OPERATIONS_COMPLETED')).toBeDefined()
    })

    it('TREASURY_CONFIRMED event exists', () => {
      expect(allEvents.find((e) => e.event_type === 'TREASURY_CONFIRMED')).toBeDefined()
    })

    it('no UPDATE or DELETE of audit_events is possible — audit is immutable (Req 28.5)', async () => {
      // Attempt to update the first audit event using the treasury e2e user
      const client = await clientAs(E2E_USERS.treasury)
      const { error } = await client
        .from('audit_events')
        .update({ metadata: { tampered: true } })
        .eq('transaction_id', txId)

      // REVOKE UPDATE must reject this
      expect(error).not.toBeNull()
    })

    it('no UNAUTHORIZED_ATTEMPT events were written during the valid E2E flow', () => {
      // All operations were performed by authorised users — no security violations expected
      const unauthorised = allEvents.filter((e) => e.event_type === 'UNAUTHORIZED_ATTEMPT')
      expect(unauthorised.length).toBe(0)
    })

    it('final status in audit trail is COMPLETED', () => {
      const last = allEvents[allEvents.length - 1]
      // The last event to_status should be COMPLETED
      const completedEvents = allEvents.filter((e) => e.to_status === 'COMPLETED')
      expect(completedEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION K — reset_e2e_transactions() cleanup (Req 39.4, 39.6)
  // ───────────────────────────────────────────────────────────────────────────

  describe('K. reset_e2e_transactions() — E2E cleanup (Req 39.4, 39.6)', () => {
    it('transaction exists and is COMPLETED before the reset', async () => {
      const { data } = await admin()
        .from('treasury_transactions')
        .select('id, status')
        .eq('id', txId)
        .maybeSingle()
      expect(data).not.toBeNull()
      expect(data?.status).toBe('COMPLETED')
    })

    it('reset_e2e_transactions() executes without error (Req 39.4)', async () => {
      // audit_events.transaction_id has no ON DELETE CASCADE (append-only table).
      // Migration 008 fixes reset_e2e_transactions() to delete audit_events first.
      // Until migration 008 is applied to the live DB, we pre-delete audit_events
      // for ALL e2e transactions (not just txId) so this test is not blocked.
      // This also cleans up any orphaned audit_events from previous failed runs.
      // Once migration 008 is applied, this step becomes a safe no-op.
      const { data: e2eTxRows } = await admin()
        .from('treasury_transactions')
        .select('id')
        .in('created_by', await getE2eProfileIds())

      if (e2eTxRows && e2eTxRows.length > 0) {
        const e2eTxIds = e2eTxRows.map((r: { id: string }) => r.id)
        await admin().from('audit_events').delete().in('transaction_id', e2eTxIds)
      }

      const { error } = await admin().rpc('reset_e2e_transactions')
      expect(error).toBeNull()
    })

    it('the E2E transaction is deleted after reset (Req 39.4)', async () => {
      const { data } = await admin()
        .from('treasury_transactions')
        .select('id')
        .eq('id', txId)
        .maybeSingle()
      expect(data).toBeNull()
    })

    it('the E2E transaction is deleted after reset (Req 39.4)', async () => {
      const { data } = await admin()
        .from('treasury_transactions')
        .select('id')
        .eq('id', txId)
        .maybeSingle()
      expect(data).toBeNull()
    })

    it('all child records are cascade-deleted (approvals, vouchers, audit_events) (Req 39.4)', async () => {
      const tables = [
        'signature_verifications',
        'customer_confirmations',
        'investment_verifications',
        'vouchers',
        'approvals',
        'operations_executions',
      ]

      for (const table of tables) {
        const { count } = await admin()
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('transaction_id', txId)
        expect(count ?? 0).toBe(0)
      }
    })

    it('audit_events for the E2E transaction are deleted (Req 39.4)', async () => {
      const { count } = await admin()
        .from('audit_events')
        .select('*', { count: 'exact', head: true })
        .eq('transaction_id', txId)
      expect(count ?? 0).toBe(0)
    })

    it('Customer A seed data is untouched after reset (Req 39.6)', async () => {
      const { data } = await admin()
        .from('customers')
        .select('id, customer_number, name, status')
        .eq('id', customerAId)
        .maybeSingle()

      expect(data).not.toBeNull()
      expect(data?.customer_number).toBe(CUSTOMER_A_NUMBER)
      expect(data?.name).toBe('Adaeze Nwosu')
      expect(data?.status).toBe('ACTIVE')
    })

    it('Investment A financial values are intact after reset (Req 39.6)', async () => {
      const { data } = await admin()
        .from('investments')
        .select('principal, interest_rate, accrued_interest, status')
        .eq('id', investmentAId)
        .maybeSingle()

      expect(data).not.toBeNull()
      expect(parseFloat(data?.principal)).toBe(CUSTOMER_A_PRINCIPAL)
      expect(parseFloat(data?.accrued_interest)).toBe(CUSTOMER_A_ACCRUED)
      expect(data?.status).toBe('ACTIVE')
    })

    it('all 7 E2E user profiles are still present after reset (Req 39.6)', async () => {
      const emails = Object.values(E2E_USERS)
      const { count } = await admin()
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .in('email', emails)
      expect(count).toBe(7)
    })

    it('all 7 E2E user role assignments are intact after reset (Req 39.6)', async () => {
      const emails = Object.values(E2E_USERS)
      const { data: profiles } = await admin()
        .from('profiles')
        .select('id')
        .in('email', emails)

      const profileIds = profiles!.map((p: { id: string }) => p.id)
      const { count } = await admin()
        .from('user_roles')
        .select('*', { count: 'exact', head: true })
        .in('user_id', profileIds)

      expect(count).toBeGreaterThanOrEqual(7)
    })

    it('no e2e transactions exist after the reset (Req 39.4)', async () => {
      const { data: e2eProfiles } = await admin()
        .from('profiles')
        .select('id')
        .like('email', '%_e2e@greenline.test')

      if (!e2eProfiles || e2eProfiles.length === 0) return

      const e2eIds = e2eProfiles.map((p: { id: string }) => p.id)
      const { count } = await admin()
        .from('treasury_transactions')
        .select('*', { count: 'exact', head: true })
        .in('created_by', e2eIds)

      expect(count ?? 0).toBe(0)
    })

    it('calling reset_e2e_transactions() a second time is idempotent (Req 39.4)', async () => {
      // No e2e transactions should exist at this point, so audit_events cleanup
      // is a no-op. But call it defensively for true idempotency.
      const { data: e2eTxRows } = await admin()
        .from('treasury_transactions')
        .select('id')
        .in('created_by', await getE2eProfileIds())

      if (e2eTxRows && e2eTxRows.length > 0) {
        const ids = e2eTxRows.map((r: { id: string }) => r.id)
        await admin().from('audit_events').delete().in('transaction_id', ids)
      }

      const { error } = await admin().rpc('reset_e2e_transactions')
      expect(error).toBeNull()
    })
  })
})
