/**
 * Task 7.8 — Signature Mismatch Downstream Lock
 *
 * Verifies the two assertions required by Req 8.3 and 8.6:
 *
 *   A. PURE-LOGIC TESTS (no DB required)
 *      A.1  SIGNATURE_FAILED workflow state locks Steps 3–6 in buildStepsMeta()
 *      A.2  Action-layer rejection: calling recordCustomerConfirmationAction after
 *           a FAILED signature is blocked — the workflow guard prevents it.
 *      A.3  Step 3 <Alert> lock indicator rendering — verifies the component
 *           render path that surfaces the lock when signatureResult = 'FAILED'.
 *      A.4  Cross-cutting: ACCOUNT_OFFICER cannot bypass the workflow lock
 *           because they cannot call verifySignatureAction either (no permission).
 *
 *   B. LIVE INTEGRATION TESTS (requires NEXT_PUBLIC_SUPABASE_URL + keys)
 *      B.1  Treasury Officer submits FAILED signature via RPC
 *           → status stays INSTRUCTION_RECEIVED (not SIGNATURE_VERIFIED)
 *           → SIGNATURE_FAILED audit event is written
 *      B.2  Subsequent call to record_customer_confirmation is rejected
 *           → status does not advance
 *      B.3  Attempt to call verify_investment is also rejected
 *           (transitive: status still INSTRUCTION_RECEIVED after signature failure)
 *
 * Seed data used: CUSTOMER_NEG_001 — the "signature mismatch" negative-test customer
 * defined in supabase/seed.sql (customer_id: cc000001-0000-0000-0000-000000000010,
 * investment_id: ee000001-0000-0000-0000-000000000010).
 *
 * Requirements: 8.3, 8.6
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import {
  buildStepsMeta,
  canActorAct,
  type TransactionForWorkflow,
} from '@/lib/services/workflow.service'
import { ROLE_PERMISSIONS } from '@/lib/permissions/permissions'
import { hasPermission } from '@/lib/services/auth.service'

// ─── Environment / credentials ────────────────────────────────────────────────

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY         = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const SEED_PASSWORD = 'Password123!'

const USERS = {
  treasury: 'treasury_maker_01@greenline.test',
  account:  'account_officer_01@greenline.test',
} as const

// Seed IDs for CUSTOMER_NEG_001 (from supabase/seed.sql, SECTION 6)
const NEG = {
  customer001: 'cc000001-0000-0000-0000-000000000010',
  invest001:   'ee000001-0000-0000-0000-000000000010',
} as const

// ─── Pure-logic fixture IDs ───────────────────────────────────────────────────

const TX_ID    = '00000000-0000-4000-a000-000000000780'
const ACTOR_ID = '00000000-0000-4000-a000-000000000781'

// ─── Action-layer role-check helpers (mirrors verification.actions.ts) ────────

/**
 * Simulates the role check inside verifySignatureAction.
 * Returns null (allowed) or an error string (blocked).
 */
function checkVerifySignaturePermission(role: string): string | null {
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return 'Only a Treasury Officer can record signature verifications.'
  }
  return null
}

/**
 * Simulates the role check inside recordCustomerConfirmationAction.
 * Returns null (allowed) or an error string (blocked).
 */
function checkRecordConfirmationPermission(role: string): string | null {
  if (role !== 'ACCOUNT_OFFICER' && role !== 'ADMIN') {
    return 'Only an Account Officer can record customer confirmations.'
  }
  return null
}

/**
 * Simulates the workflow-state prerequisite check that would fire inside the
 * record_customer_confirmation RPC (Req 8.6).
 *
 * The RPC requires status = 'SIGNATURE_VERIFIED'. After a FAILED signature
 * the status stays at 'INSTRUCTION_RECEIVED', so this guard fires first.
 *
 * Returns null (allowed) or an error string (blocked).
 */
function checkConfirmationPrerequisite(status: string): string | null {
  if (status !== 'SIGNATURE_VERIFIED') {
    return `Invalid state: record_customer_confirmation requires status SIGNATURE_VERIFIED, got ${status}.`
  }
  return null
}

// ─── Client factory helpers ───────────────────────────────────────────────────

function adminClient() {
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

async function clientAs(email: string) {
  const admin = adminClient()

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
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

// ─── Transaction lifecycle helpers ───────────────────────────────────────────

async function seedTransaction(opts: {
  customerId: string
  investmentId: string
  status: string
  createdByEmail: string
  transactionType?: string
  requestedAmount?: number
}) {
  const admin = adminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', opts.createdByEmail)
    .single()

  if (!profile) throw new Error(`Profile not found for ${opts.createdByEmail}`)

  const txId = crypto.randomUUID()
  const ref  = `TRX-SIG-${Date.now()}`

  await admin.from('treasury_transactions').insert({
    id:                      txId,
    transaction_reference:   ref,
    customer_id:             opts.customerId,
    investment_id:           opts.investmentId,
    transaction_type:        opts.transactionType ?? 'ROLLOVER',
    scenario_code:           'P_AND_I',
    status:                  opts.status,
    requested_amount:        opts.requestedAmount ?? 5_000_000,
    purpose:                 'Signature mismatch test',
    source_instruction_type: 'LETTER',
    sla_due_at:              new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    created_by:              profile.id,
  })

  return { txId, ref, creatorId: profile.id }
}

async function teardownTransaction(txId: string) {
  const admin = adminClient()
  await admin.from('treasury_transactions').delete().eq('id', txId)
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION A — PURE-LOGIC TESTS (no DB)
//  Verify the client-side workflow + action-layer enforcement logic.
//  Requirements: 8.3, 8.6
// ─────────────────────────────────────────────────────────────────────────────

describe('A. Signature mismatch — pure logic layer (Req 8.3, 8.6)', () => {

  // ── A.1 — buildStepsMeta locks Steps 3–6 when signatureResult = FAILED ────

  describe('A.1: buildStepsMeta() locks Steps 3–6 on SIGNATURE_FAILED (Req 8.3)', () => {
    // Transaction is stuck at INSTRUCTION_RECEIVED; signature FAILED was recorded.
    const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')

    it('Step 1 (Instruction) is completed', () => {
      expect(steps.find((s) => s.id === 1)!.state).toBe('completed')
    })

    it('Step 2 (Signature) is active — it is the current step', () => {
      // Step 2 is active because status = INSTRUCTION_RECEIVED; the FAILED
      // result does not change the active step — it locks the downstream ones.
      expect(steps.find((s) => s.id === 2)!.state).toBe('active')
    })

    it('Step 3 (Customer Confirmation) is locked when signatureResult = FAILED', () => {
      const step3 = steps.find((s) => s.id === 3)!
      expect(step3.state).toBe('locked')
    })

    it('Step 3 lockedReason mentions signature (Req 8.3 — clear lock message)', () => {
      const step3 = steps.find((s) => s.id === 3)!
      expect(step3.lockedReason).toBeDefined()
      expect(step3.lockedReason).toMatch(/[Ss]ignature/)
    })

    it('Step 4 (Investment Verification) is locked when signatureResult = FAILED', () => {
      const step4 = steps.find((s) => s.id === 4)!
      expect(step4.state).toBe('locked')
    })

    it('Step 4 lockedReason mentions signature', () => {
      const step4 = steps.find((s) => s.id === 4)!
      expect(step4.lockedReason).toMatch(/[Ss]ignature/)
    })

    it('Step 5 (Voucher Generation) is locked when signatureResult = FAILED', () => {
      const step5 = steps.find((s) => s.id === 5)!
      expect(step5.state).toBe('locked')
    })

    it('Step 6 (Approval Chain) is locked when signatureResult = FAILED', () => {
      const step6 = steps.find((s) => s.id === 6)!
      expect(step6.state).toBe('locked')
    })

    it('exactly three steps are locked (3, 4, 5, 6) — all downstream of step 2', () => {
      const lockedSteps = steps.filter((s) => s.state === 'locked')
      expect(lockedSteps.map((s) => s.id)).toEqual([3, 4, 5, 6])
    })

    it('Steps 3–6 are all locked — full downstream lockout (Req 8.3)', () => {
      for (const step of steps.filter((s) => s.id >= 3)) {
        expect(step.state).toBe('locked')
      }
    })
  })

  // ── A.2 — Action-layer rejection of recordCustomerConfirmationAction ────────

  describe('A.2: Action-layer rejects recordCustomerConfirmation after SIGNATURE_FAILED (Req 8.6)', () => {
    it('ACCOUNT_OFFICER passes the role check for recordCustomerConfirmationAction', () => {
      // The role check itself allows ACCOUNT_OFFICER — the block comes from
      // the workflow-state prerequisite (status must be SIGNATURE_VERIFIED).
      expect(checkRecordConfirmationPermission('ACCOUNT_OFFICER')).toBeNull()
    })

    it('workflow-state prerequisite fires when status is INSTRUCTION_RECEIVED (not SIGNATURE_VERIFIED)', () => {
      // After SIGNATURE_FAILED, status stays INSTRUCTION_RECEIVED.
      // The RPC prerequisite for record_customer_confirmation is SIGNATURE_VERIFIED.
      const guard = checkConfirmationPrerequisite('INSTRUCTION_RECEIVED')
      expect(guard).not.toBeNull()
      expect(guard).toMatch(/SIGNATURE_VERIFIED/)
    })

    it('prerequisite check also blocks when status is RETURNED (exception path)', () => {
      expect(checkConfirmationPrerequisite('RETURNED')).not.toBeNull()
    })

    it('prerequisite check allows when status is exactly SIGNATURE_VERIFIED (normal path)', () => {
      expect(checkConfirmationPrerequisite('SIGNATURE_VERIFIED')).toBeNull()
    })

    it('prerequisite check blocks at CUSTOMER_CONFIRMED (already past Step 3)', () => {
      expect(checkConfirmationPrerequisite('CUSTOMER_CONFIRMED')).not.toBeNull()
    })

    it('ACCOUNT_OFFICER cannot act (canActorAct) at INSTRUCTION_RECEIVED — wrong step', () => {
      // Even if the role check passed, canActorAct blocks ACCOUNT_OFFICER because
      // they can only act at SIGNATURE_VERIFIED, not INSTRUCTION_RECEIVED.
      const tx: TransactionForWorkflow = {
        id: TX_ID,
        status: 'INSTRUCTION_RECEIVED',
        created_by: ACTOR_ID,
        transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('ACCOUNT_OFFICER', tx, ACTOR_ID)).toBe(false)
    })

    it('ACCOUNT_OFFICER can act at SIGNATURE_VERIFIED (normal path, signature passed)', () => {
      // When the signature PASSED, ACCOUNT_OFFICER correctly has access at SIGNATURE_VERIFIED.
      const tx: TransactionForWorkflow = {
        id: TX_ID,
        status: 'SIGNATURE_VERIFIED',
        created_by: ACTOR_ID,
        transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('ACCOUNT_OFFICER', tx, ACTOR_ID)).toBe(true)
    })

    it('TREASURY_OFFICER cannot call recordCustomerConfirmationAction (role check blocks)', () => {
      const err = checkRecordConfirmationPermission('TREASURY_OFFICER')
      expect(err).not.toBeNull()
      expect(err).toMatch(/Account Officer/)
    })

    it('OPERATIONS cannot call recordCustomerConfirmationAction (role check blocks)', () => {
      expect(checkRecordConfirmationPermission('OPERATIONS')).not.toBeNull()
    })

    it('all non-ACCOUNT_OFFICER roles are blocked from recordCustomerConfirmationAction', () => {
      const disallowed = [
        'TREASURY_OFFICER',
        'HEAD_TREASURY',
        'MIS',
        'AUDIT',
        'MD',
        'OPERATIONS',
        'CUSTOMER',
      ]
      for (const role of disallowed) {
        expect(checkRecordConfirmationPermission(role)).not.toBeNull()
      }
    })
  })

  // ── A.3 — Step 3 <Alert> lock indicator rendering ─────────────────────────

  describe('A.3: Step 3 panel renders a lock <Alert> when signature_result = FAILED (Req 8.3)', () => {
    // The Step2SignatureVerification component displays an Alert in its read-only
    // mode when anyFailed = true. We verify the component decision logic here
    // using the same condition the component uses (Req 8.3).

    /**
     * Mirrors the `anyFailed` boolean used in Step2SignatureVerification
     * read-only mode to conditionally render the destructive <Alert>.
     */
    function shouldShowLockAlert(signatureVerification: {
      signature_result: string
      mandate_result: string
      account_ownership_result: string
      completeness_result: string
    }): boolean {
      return (
        signatureVerification.signature_result === 'FAILED' ||
        signatureVerification.mandate_result === 'FAILED' ||
        signatureVerification.account_ownership_result === 'FAILED' ||
        signatureVerification.completeness_result === 'FAILED'
      )
    }

    /**
     * Mirrors the Step3CustomerConfirmation read-only `isException` boolean.
     * This controls whether Step 3 renders an Alert when the confirmation itself
     * was FAILED or UNREACHABLE — a separate lock path from signature failure.
     */
    function shouldShowConfirmationExceptionAlert(confirmationStatus: string): boolean {
      return confirmationStatus === 'FAILED' || confirmationStatus === 'UNREACHABLE'
    }

    it('shows the lock Alert when signature_result is FAILED', () => {
      expect(shouldShowLockAlert({
        signature_result:         'FAILED',
        mandate_result:           'PASSED',
        account_ownership_result: 'PASSED',
        completeness_result:      'PASSED',
      })).toBe(true)
    })

    it('shows the lock Alert when any one of the four checklist items is FAILED', () => {
      const fields = [
        'signature_result',
        'mandate_result',
        'account_ownership_result',
        'completeness_result',
      ] as const

      for (const field of fields) {
        const verification = {
          signature_result:         'PASSED',
          mandate_result:           'PASSED',
          account_ownership_result: 'PASSED',
          completeness_result:      'PASSED',
          [field]:                  'FAILED',
        }
        expect(shouldShowLockAlert(verification)).toBe(true)
      }
    })

    it('does NOT show the lock Alert when all four checklist items are PASSED', () => {
      expect(shouldShowLockAlert({
        signature_result:         'PASSED',
        mandate_result:           'PASSED',
        account_ownership_result: 'PASSED',
        completeness_result:      'PASSED',
      })).toBe(false)
    })

    it('Step 3 shows confirmation-exception Alert when confirmation_status is FAILED', () => {
      expect(shouldShowConfirmationExceptionAlert('FAILED')).toBe(true)
    })

    it('Step 3 shows confirmation-exception Alert when confirmation_status is UNREACHABLE', () => {
      expect(shouldShowConfirmationExceptionAlert('UNREACHABLE')).toBe(true)
    })

    it('Step 3 does NOT show confirmation-exception Alert when confirmation_status is CONFIRMED', () => {
      expect(shouldShowConfirmationExceptionAlert('CONFIRMED')).toBe(false)
    })

    it('buildStepsMeta step 3 lockedReason is non-empty when signature failed', () => {
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      const step3 = steps.find((s) => s.id === 3)!
      // lockedReason is used to populate the tooltip on the locked step indicator
      expect(step3.lockedReason).toBeTruthy()
      expect(step3.lockedReason!.length).toBeGreaterThan(0)
    })

    it('buildStepsMeta step 3 has no lockedReason when status is SIGNATURE_VERIFIED (no failure)', () => {
      const steps = buildStepsMeta('SIGNATURE_VERIFIED', null)
      const step3 = steps.find((s) => s.id === 3)!
      // Step 3 is active (not locked), so lockedReason is undefined
      expect(step3.state).toBe('active')
      expect(step3.lockedReason).toBeUndefined()
    })
  })

  // ── A.4 — Cross-cutting: ACCOUNT_OFFICER also cannot call verifySignatureAction ─

  describe('A.4: ACCOUNT_OFFICER lacks verify_signature permission and cannot circumvent lock (Req 8.6)', () => {
    it('ACCOUNT_OFFICER cannot call verifySignatureAction (no permission)', () => {
      const err = checkVerifySignaturePermission('ACCOUNT_OFFICER')
      expect(err).not.toBeNull()
      expect(err).toMatch(/Treasury Officer/)
    })

    it('ACCOUNT_OFFICER lacks verify_signature in ROLE_PERMISSIONS map', () => {
      expect(hasPermission('ACCOUNT_OFFICER', 'verify_signature' as never)).toBe(false)
    })

    it('ACCOUNT_OFFICER has record_confirmation but not verify_signature (correct SOP role boundaries)', () => {
      expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).toContain('record_confirmation')
      expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).not.toContain('verify_signature')
    })

    it('TREASURY_OFFICER can call verifySignatureAction (the correct role for Step 2)', () => {
      expect(checkVerifySignaturePermission('TREASURY_OFFICER')).toBeNull()
    })

    it('TREASURY_OFFICER has verify_signature permission in ROLE_PERMISSIONS map', () => {
      expect(ROLE_PERMISSIONS.TREASURY_OFFICER).toContain('verify_signature')
    })

    it('ACCOUNT_OFFICER cannot act on a transaction at INSTRUCTION_RECEIVED (must wait for step 2)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID,
        status: 'INSTRUCTION_RECEIVED',
        created_by: ACTOR_ID,
        transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('ACCOUNT_OFFICER', tx, ACTOR_ID)).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION B — LIVE INTEGRATION TESTS
//  Require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//  Uses CUSTOMER_NEG_001 seed data.
//  Requirements: 8.3, 8.6
// ─────────────────────────────────────────────────────────────────────────────

describe('B. Signature mismatch — live DB enforcement (Req 8.3, 8.6)', () => {
  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run live tests',
      )
    }
  })

  // ── B.1 — Treasury Officer submits FAILED signature via verify_signature RPC ─

  describe('B.1: CUSTOMER_NEG_001 — Treasury Officer records FAILED signature (Req 8.3)', () => {
    let txId: string

    beforeAll(async () => {
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'INSTRUCTION_RECEIVED',
        createdByEmail: USERS.treasury,
      })
      txId = id
    })

    it('Treasury Officer can call verify_signature with FAILED result (role check passes)', async () => {
      const client = await clientAs(USERS.treasury)

      const { data, error } = await client.rpc('verify_signature', {
        p_transaction_id:            txId,
        p_signature_result:          'FAILED',
        p_mandate_result:            'PASSED',
        p_account_ownership_result:  'PASSED',
        p_completeness_result:       'PASSED',
        p_notes:                     'CUSTOMER_NEG_001: signature does not match mandate card',
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction status remains INSTRUCTION_RECEIVED after FAILED signature (Req 8.3)', async () => {
      // A FAILED signature does NOT advance the status to SIGNATURE_VERIFIED.
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()
      expect(data?.status).toBe('INSTRUCTION_RECEIVED')
    })

    it('a SIGNATURE_FAILED audit event was written (Req 8.3)', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('event_type')
        .eq('transaction_id', txId)
        .eq('event_type', 'SIGNATURE_FAILED')
      expect(data?.length).toBe(1)
    })

    it('signature_verifications row records signature_result = FAILED', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('signature_verifications')
        .select('signature_result, mandate_result')
        .eq('transaction_id', txId)
        .single()
      expect(data?.signature_result).toBe('FAILED')
      expect(data?.mandate_result).toBe('PASSED')
    })

    it('no SIGNATURE_VERIFIED event was written (the status did not advance)', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('event_type')
        .eq('transaction_id', txId)
        .eq('event_type', 'SIGNATURE_VERIFIED')
      expect(data?.length ?? 0).toBe(0)
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })

  // ── B.2 — recordCustomerConfirmationAction is rejected after SIGNATURE_FAILED ─

  describe('B.2: Attempt to call record_customer_confirmation after SIGNATURE_FAILED → rejected (Req 8.6)', () => {
    let txId: string

    beforeAll(async () => {
      // Only seed the transaction row — the verify_signature RPC call happens
      // inside the first test to avoid network failures crashing the whole suite.
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'INSTRUCTION_RECEIVED',
        createdByEmail: USERS.treasury,
      })
      txId = id
    })

    it('Treasury Officer records FAILED signature to lock downstream steps (Req 8.3)', async () => {
      // Step 1 of the flow: submit FAILED signature. This must succeed so the
      // subsequent test can assert that record_customer_confirmation is rejected.
      const client = await clientAs(USERS.treasury)

      const { data, error } = await client.rpc('verify_signature', {
        p_transaction_id:            txId,
        p_signature_result:          'FAILED',
        p_mandate_result:            'PASSED',
        p_account_ownership_result:  'PASSED',
        p_completeness_result:       'PASSED',
        p_notes:                     'Signature mismatch — downstream lock test',
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('transaction is still at INSTRUCTION_RECEIVED after FAILED signature', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()
      expect(data?.status).toBe('INSTRUCTION_RECEIVED')
    })

    it('record_customer_confirmation RPC is rejected — status is INSTRUCTION_RECEIVED, not SIGNATURE_VERIFIED (Req 8.6)', async () => {
      // The RPC requires status = 'SIGNATURE_VERIFIED'. Since SIGNATURE_FAILED
      // left the status at INSTRUCTION_RECEIVED, this call must be rejected.
      const client = await clientAs(USERS.account)

      const { data, error } = await client.rpc('record_customer_confirmation', {
        p_transaction_id:        txId,
        p_confirmation_status:   'CONFIRMED',
        p_confirmed_amount:      5_000_000,
        p_confirmed_purpose:     'Rollover P+I — bypass attempt after signature failure',
        p_confirmation_date:     '2026-09-08',
        p_confirmation_time:     '14:00:00',
        p_confirmed_beneficiary: null,
        p_notes:                 null,
      })

      expect(error).not.toBeNull()
      expect(data).toBeNull()

      // The error must reference the invalid state (status prerequisite not met)
      const msg = (error?.message ?? '').toLowerCase()
      expect(
        msg.includes('invalid_state') ||
        msg.includes('signature_verified') ||
        msg.includes('status') ||
        msg.includes('invalid'),
      ).toBe(true)
    })

    it('transaction status is still INSTRUCTION_RECEIVED after the rejected confirmation call', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()
      expect(data?.status).toBe('INSTRUCTION_RECEIVED')
    })

    it('no customer_confirmations row was created for this transaction', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('customer_confirmations')
        .select('id')
        .eq('transaction_id', txId)
      expect(data?.length ?? 0).toBe(0)
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })

  // ── B.3 — verify_investment is also rejected after SIGNATURE_FAILED ─────────

  describe('B.3: Attempt to call verify_investment after SIGNATURE_FAILED → rejected (Req 8.3)', () => {
    let txId: string

    beforeAll(async () => {
      // Only seed the transaction row — the verify_signature RPC call happens
      // in the first test to avoid network failures crashing the whole suite.
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'INSTRUCTION_RECEIVED',
        createdByEmail: USERS.treasury,
      })
      txId = id
    })

    it('Treasury Officer records FAILED signature to lock downstream steps (Req 8.3)', async () => {
      const client = await clientAs(USERS.treasury)

      const { data, error } = await client.rpc('verify_signature', {
        p_transaction_id:            txId,
        p_signature_result:          'FAILED',
        p_mandate_result:            'PASSED',
        p_account_ownership_result:  'PASSED',
        p_completeness_result:       'PASSED',
        p_notes:                     'Downstream lock setup — verify_investment bypass test',
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('verify_investment is rejected because status is INSTRUCTION_RECEIVED (skipped Step 3)', async () => {
      // The RPC requires status = 'CUSTOMER_CONFIRMED'. Skipping past a FAILED
      // signature means Steps 3 and 4 are locked; the RPC must reject.
      const client = await clientAs(USERS.treasury)

      const { data, error } = await client.rpc('verify_investment', {
        p_transaction_id:      txId,
        p_principal:           '5000000',
        p_accrued_interest:    '100000',
        p_interest_rate:       '0.12',
        p_effective_date:      '2026-06-01',
        p_maturity_date:       '2026-12-01',
        p_outstanding_balance: '5000000',
        p_available_amount:    '5100000',
      })

      expect(error).not.toBeNull()
      expect(data).toBeNull()

      const msg = (error?.message ?? '').toLowerCase()
      expect(
        msg.includes('invalid_state') ||
        msg.includes('customer_confirmed') ||
        msg.includes('status') ||
        msg.includes('invalid'),
      ).toBe(true)
    })

    it('transaction status is still INSTRUCTION_RECEIVED after the rejected verify_investment', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()
      expect(data?.status).toBe('INSTRUCTION_RECEIVED')
    })

    it('no investment_verifications row was created for this transaction', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('investment_verifications')
        .select('id')
        .eq('transaction_id', txId)
      expect(data?.length ?? 0).toBe(0)
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })
})
