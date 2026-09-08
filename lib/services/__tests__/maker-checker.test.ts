/**
 * Task 7.7 — Maker-Checker Enforcement Tests
 *
 * Verifies that the transaction creator (treasury_maker_01) cannot approve
 * their own transaction at any stage of the five-stage approval chain.
 *
 * Two sections:
 *   A. Pure-logic tests (no DB) — canActorAct, role-check helpers, ROLE_PERMISSIONS
 *   B. Live integration tests — approve_transaction RPC called as the creator;
 *      asserts error returned and no approvals row created
 *
 * Requirements: 5.4, 12.2
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import {
  canActorAct,
  type TransactionForWorkflow,
} from '@/lib/services/workflow.service'
import { ROLE_PERMISSIONS, STAGE_TO_ROLE } from '@/lib/permissions/permissions'

// ─── Env / credentials ───────────────────────────────────────────────────────

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY         = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const SEED_PASSWORD = 'Password123!'

const USERS = {
  treasuryMaker: 'treasury_maker_01@greenline.test',
  headTreasury:  'head_treasury_01@greenline.test',
} as const

// Seed negative-test customer/investment IDs (from supabase/seed.sql)
const NEG = {
  customer001: 'cc000001-0000-0000-0000-000000000010',
  invest001:   'ee000001-0000-0000-0000-000000000010',
} as const

// ─── Pure-logic fixture IDs ───────────────────────────────────────────────────

const TX_ID     = '00000000-0000-4000-a000-000000000770'
const MAKER_ID  = '00000000-0000-4000-a000-000000000771'
const OTHER_ID  = '00000000-0000-4000-a000-000000000772'

// ─── STAGE_ROLE_MAP (mirrors approval.actions.ts — tested directly here) ─────

const STAGE_ROLE_MAP: Record<string, string> = {
  TREASURY:      'TREASURY_OFFICER',
  HEAD_TREASURY: 'HEAD_TREASURY',
  MIS:           'MIS',
  AUDIT:         'AUDIT',
  MD:            'MD',
}

/**
 * Simulates the approveTransactionAction role-check (Step 4 in the action).
 * Returns null when the actor is allowed, or an error string when blocked.
 */
function checkApprovalRolePermission(role: string, stage: string): string | null {
  const required = STAGE_ROLE_MAP[stage]
  if (role !== required && role !== 'ADMIN') {
    return `The ${stage} approval stage requires a ${required} role. Your current role is ${role}.`
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
        `Cannot sign in as ${email}. Ensure seed.sql has been applied. Error: ${error?.message}`,
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
  const ref  = `TRX-MCK-${Date.now()}`

  await admin.from('treasury_transactions').insert({
    id:                      txId,
    transaction_reference:   ref,
    customer_id:             opts.customerId,
    investment_id:           opts.investmentId,
    transaction_type:        opts.transactionType ?? 'ROLLOVER',
    scenario_code:           'P_AND_I',
    status:                  opts.status,
    requested_amount:        opts.requestedAmount ?? 5_000_000,
    purpose:                 'Maker-checker test',
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
//  SECTION A — PURE-LOGIC MAKER-CHECKER TESTS (no DB required)
//  Requirements: 5.4, 12.2
// ─────────────────────────────────────────────────────────────────────────────

describe('A. Maker-checker — pure logic layer (Req 5.4, 12.2)', () => {

  // ── A.1 — Creator blocked from all five approval stages ──────────────────

  describe('A.1: canActorAct blocks the transaction creator at all five approval stages (Req 5.4)', () => {
    const approvalStatuses = [
      'VOUCHER_PREPARED',
      'TREASURY_APPROVED',
      'HEAD_TREASURY_APPROVED',
      'MIS_APPROVED',
      'AUDIT_APPROVED',
    ]

    it('creator (TREASURY_OFFICER) is blocked at VOUCHER_PREPARED (TREASURY stage)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'VOUCHER_PREPARED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
    })

    it('creator is blocked at TREASURY_APPROVED (HEAD_TREASURY stage)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'TREASURY_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
    })

    it('creator is blocked at HEAD_TREASURY_APPROVED (MIS stage)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'HEAD_TREASURY_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
    })

    it('creator is blocked at MIS_APPROVED (AUDIT stage)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'MIS_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
    })

    it('creator is blocked at AUDIT_APPROVED (MD stage)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'AUDIT_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
    })

    it('maker-checker blocks the creator at all five approval stages in a loop', () => {
      for (const status of approvalStatuses) {
        const tx: TransactionForWorkflow = {
          id: TX_ID, status, created_by: MAKER_ID, transaction_type: 'ROLLOVER',
        }
        expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
      }
    })
  })

  // ── A.2 — A different TREASURY_OFFICER (non-creator) can approve ──────────

  describe('A.2: A different TREASURY_OFFICER (non-creator) can approve at VOUCHER_PREPARED (Req 5.4)', () => {
    it('non-creator TREASURY_OFFICER is allowed at VOUCHER_PREPARED', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'VOUCHER_PREPARED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, OTHER_ID)).toBe(true)
    })

    it('non-creator HEAD_TREASURY can approve at TREASURY_APPROVED', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'TREASURY_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('HEAD_TREASURY', tx, OTHER_ID)).toBe(true)
    })

    it('non-creator MIS can approve at HEAD_TREASURY_APPROVED', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'HEAD_TREASURY_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('MIS', tx, OTHER_ID)).toBe(true)
    })

    it('non-creator AUDIT can approve at MIS_APPROVED', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'MIS_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('AUDIT', tx, OTHER_ID)).toBe(true)
    })

    it('non-creator MD can approve at AUDIT_APPROVED', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'AUDIT_APPROVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('MD', tx, OTHER_ID)).toBe(true)
    })
  })

  // ── A.3 — Maker-checker does NOT block creator from non-approval actions ──

  describe('A.3: Maker-checker does NOT block the creator from non-approval actions (Req 5.4)', () => {
    it('creator can act at INSTRUCTION_RECEIVED (signature verification — Step 2)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'INSTRUCTION_RECEIVED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(true)
    })

    it('creator can act at CUSTOMER_CONFIRMED (investment verification — Step 4)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'CUSTOMER_CONFIRMED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(true)
    })

    it('creator can act at INVESTMENT_VERIFIED (voucher preparation — Step 5)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'INVESTMENT_VERIFIED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(true)
    })

    it('creator can act at OPERATIONS_COMPLETED (treasury completion confirmation)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'OPERATIONS_COMPLETED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(true)
    })

    it('maker-checker is only triggered during the five approval-stage statuses', () => {
      // The four non-approval statuses where a TREASURY_OFFICER legitimately acts
      const nonApprovalStatuses = [
        'INSTRUCTION_RECEIVED',
        'CUSTOMER_CONFIRMED',
        'INVESTMENT_VERIFIED',
        'OPERATIONS_COMPLETED',
      ]
      for (const status of nonApprovalStatuses) {
        const tx: TransactionForWorkflow = {
          id: TX_ID, status, created_by: MAKER_ID, transaction_type: 'ROLLOVER',
        }
        expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(true)
      }
    })
  })

  // ── A.4 — STAGE_ROLE_MAP enforcement via the approveTransactionAction helper

  describe('A.4: approveTransactionAction STAGE_ROLE_MAP enforcement (Req 12.2)', () => {
    it('TREASURY_OFFICER passes the role check for TREASURY stage', () => {
      expect(checkApprovalRolePermission('TREASURY_OFFICER', 'TREASURY')).toBeNull()
    })

    it('TREASURY_OFFICER is rejected from all other approval stages', () => {
      const otherStages = ['HEAD_TREASURY', 'MIS', 'AUDIT', 'MD']
      for (const stage of otherStages) {
        expect(checkApprovalRolePermission('TREASURY_OFFICER', stage)).not.toBeNull()
      }
    })

    it('HEAD_TREASURY passes the role check for HEAD_TREASURY stage only', () => {
      expect(checkApprovalRolePermission('HEAD_TREASURY', 'HEAD_TREASURY')).toBeNull()
      expect(checkApprovalRolePermission('HEAD_TREASURY', 'TREASURY')).not.toBeNull()
    })

    it('MIS passes the role check for MIS stage only', () => {
      expect(checkApprovalRolePermission('MIS', 'MIS')).toBeNull()
      expect(checkApprovalRolePermission('MIS', 'TREASURY')).not.toBeNull()
    })

    it('AUDIT passes the role check for AUDIT stage only', () => {
      expect(checkApprovalRolePermission('AUDIT', 'AUDIT')).toBeNull()
      expect(checkApprovalRolePermission('AUDIT', 'MIS')).not.toBeNull()
    })

    it('MD passes the role check for MD stage only', () => {
      expect(checkApprovalRolePermission('MD', 'MD')).toBeNull()
      expect(checkApprovalRolePermission('MD', 'AUDIT')).not.toBeNull()
    })

    it('OPERATIONS is rejected from all five stages', () => {
      for (const stage of Object.keys(STAGE_ROLE_MAP)) {
        expect(checkApprovalRolePermission('OPERATIONS', stage)).not.toBeNull()
      }
    })

    it('ADMIN bypasses the role check for all stages (administrative override)', () => {
      for (const stage of Object.keys(STAGE_ROLE_MAP)) {
        expect(checkApprovalRolePermission('ADMIN', stage)).toBeNull()
      }
    })

    it('error message from role mismatch names the required role and the actual role', () => {
      const err = checkApprovalRolePermission('OPERATIONS', 'TREASURY')!
      expect(err).toMatch(/TREASURY_OFFICER/)
      expect(err).toMatch(/OPERATIONS/)
    })

    it('STAGE_ROLE_MAP covers all five stages and matches STAGE_TO_ROLE from permissions', () => {
      const stages = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD']
      for (const stage of stages) {
        expect(STAGE_ROLE_MAP[stage]).toBeDefined()
        expect(STAGE_ROLE_MAP[stage]).toBe(STAGE_TO_ROLE[stage])
      }
    })
  })

  // ── A.5 — ROLE_PERMISSIONS confirms TREASURY_OFFICER has approve_treasury ─

  describe('A.5: ROLE_PERMISSIONS — TREASURY_OFFICER has approve_treasury; maker-checker blocks the creator specifically (Req 5.4, 12.2)', () => {
    it('TREASURY_OFFICER has approve_treasury permission in ROLE_PERMISSIONS', () => {
      expect(ROLE_PERMISSIONS.TREASURY_OFFICER).toContain('approve_treasury')
    })

    it('maker-checker does not remove approve_treasury from the role — it blocks the creator specifically', () => {
      // The role itself still has the permission; the check is against the actor's identity.
      // A different TREASURY_OFFICER (OTHER_ID) can still approve.
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'VOUCHER_PREPARED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      // Creator is blocked despite having the role permission
      expect(canActorAct('TREASURY_OFFICER', tx, MAKER_ID)).toBe(false)
      // A different actor with the same role is allowed
      expect(canActorAct('TREASURY_OFFICER', tx, OTHER_ID)).toBe(true)
    })

    it('HEAD_TREASURY has approve_head_treasury but NOT approve_treasury', () => {
      expect(ROLE_PERMISSIONS.HEAD_TREASURY).toContain('approve_head_treasury')
      expect(ROLE_PERMISSIONS.HEAD_TREASURY).not.toContain('approve_treasury')
    })

    it('HEAD_TREASURY cannot approve at VOUCHER_PREPARED (wrong stage)', () => {
      const tx: TransactionForWorkflow = {
        id: TX_ID, status: 'VOUCHER_PREPARED', created_by: MAKER_ID, transaction_type: 'ROLLOVER',
      }
      expect(canActorAct('HEAD_TREASURY', tx, OTHER_ID)).toBe(false)
    })

    it('OPERATIONS has no approval permissions in ROLE_PERMISSIONS', () => {
      const opsPerms = ROLE_PERMISSIONS.OPERATIONS as readonly string[]
      expect(opsPerms).not.toContain('approve_treasury')
      expect(opsPerms).not.toContain('approve_head_treasury')
      expect(opsPerms).not.toContain('approve_mis')
      expect(opsPerms).not.toContain('approve_audit')
      expect(opsPerms).not.toContain('approve_md')
    })

    it('TREASURY_OFFICER also has create_transaction permission (confirming the maker role)', () => {
      expect(ROLE_PERMISSIONS.TREASURY_OFFICER).toContain('create_transaction')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION B — LIVE INTEGRATION MAKER-CHECKER TESTS
//  Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//  Requirements: 5.4, 12.2
// ─────────────────────────────────────────────────────────────────────────────

describe('B. Maker-checker — live DB enforcement (Req 5.4, 12.2)', () => {
  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run live tests',
      )
    }
  })

  // ── B.1 — Creator (treasury_maker_01) is blocked from approving own transaction ─

  describe('B.1: Creator (treasury_maker_01) cannot approve their own TREASURY-stage transaction', () => {
    let txId: string

    beforeAll(async () => {
      // Seed a transaction at VOUCHER_PREPARED created by treasury_maker_01
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'VOUCHER_PREPARED',
        createdByEmail: USERS.treasuryMaker,
      })
      txId = id
    })

    it('approve_transaction RPC returns an error when the creator calls it', async () => {
      const client = await clientAs(USERS.treasuryMaker)

      const { data, error } = await client.rpc('approve_transaction', {
        p_transaction_id: txId,
        p_stage:          'TREASURY',
        p_decision:       'APPROVE',
        p_comments:       null,
      })

      // The RPC must reject — no data should come back
      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })

    it('the error references maker/checker, unauthorized, or creator', async () => {
      const client = await clientAs(USERS.treasuryMaker)

      const { error } = await client.rpc('approve_transaction', {
        p_transaction_id: txId,
        p_stage:          'TREASURY',
        p_decision:       'APPROVE',
        p_comments:       null,
      })

      const msg = (error?.message ?? '').toLowerCase()
      expect(
        msg.includes('maker') ||
        msg.includes('checker') ||
        msg.includes('creator') ||
        msg.includes('unauthorized') ||
        msg.includes('cannot') ||
        msg.includes('own'),
      ).toBe(true)
    })

    it('transaction status is still VOUCHER_PREPARED after the rejected approval', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()

      expect(data?.status).toBe('VOUCHER_PREPARED')
    })

    it('no approvals row was created for this transaction', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('approvals')
        .select('id')
        .eq('transaction_id', txId)

      expect(data?.length ?? 0).toBe(0)
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })

  // ── B.2 — Creator blocked even if using RETURN decision ───────────────────

  describe('B.2: Creator cannot RETURN their own transaction either (Req 5.4)', () => {
    let txId: string

    beforeAll(async () => {
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'VOUCHER_PREPARED',
        createdByEmail: USERS.treasuryMaker,
      })
      txId = id
    })

    it('approve_transaction RPC with RETURN decision is also rejected for the creator', async () => {
      const client = await clientAs(USERS.treasuryMaker)

      const { data, error } = await client.rpc('approve_transaction', {
        p_transaction_id: txId,
        p_stage:          'TREASURY',
        p_decision:       'RETURN',
        p_comments:       'Self-return attempt',
      })

      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })

    it('transaction status is still VOUCHER_PREPARED after the rejected RETURN', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()

      expect(data?.status).toBe('VOUCHER_PREPARED')
    })

    it('no approvals row was created for the RETURN attempt', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('approvals')
        .select('id')
        .eq('transaction_id', txId)

      expect(data?.length ?? 0).toBe(0)
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })

  // ── B.3 — A different TREASURY_OFFICER can approve the same transaction ───

  describe('B.3: A different TREASURY_OFFICER (head_treasury_01 is not a TREASURY_OFFICER, so we verify the creator-block is the specific enforcement)', () => {
    // head_treasury_01 has HEAD_TREASURY role, not TREASURY_OFFICER, so
    // they would be blocked by the stage-role mismatch (not maker-checker).
    // This test proves the maker-checker enforcement is the specific block
    // when the creator calls (distinct from the role mismatch block).
    let txId: string

    beforeAll(async () => {
      // Seed a transaction created by head_treasury_01
      // so that treasury_maker_01 (TREASURY_OFFICER, non-creator) can approve it
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'VOUCHER_PREPARED',
        createdByEmail: USERS.headTreasury, // creator is HEAD_TREASURY user
      })
      txId = id
    })

    it('treasury_maker_01 (TREASURY_OFFICER, non-creator) can approve the transaction', async () => {
      const client = await clientAs(USERS.treasuryMaker)

      const { data, error } = await client.rpc('approve_transaction', {
        p_transaction_id: txId,
        p_stage:          'TREASURY',
        p_decision:       'APPROVE',
        p_comments:       null,
      })

      // The non-creator TREASURY_OFFICER must succeed
      expect(error).toBeNull()
      expect(data).toMatchObject({ success: true })
    })

    it('one approvals row was created after the successful approval', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('approvals')
        .select('id, stage, decision')
        .eq('transaction_id', txId)
        .eq('stage', 'TREASURY')

      expect(data).toHaveLength(1)
      expect(data![0].decision).toBe('APPROVE')
    })

    it('transaction status has advanced to TREASURY_APPROVED', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()

      expect(data?.status).toBe('TREASURY_APPROVED')
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })

  // ── B.4 — Creator is also blocked at HEAD_TREASURY stage (double enforcement) ─

  describe('B.4: Creator cannot attempt HEAD_TREASURY stage (role mismatch is the first block)', () => {
    // treasury_maker_01 is a TREASURY_OFFICER, so they cannot approve at HEAD_TREASURY.
    // Even if they try, the stage-role check fires before maker-checker.
    // This demonstrates double enforcement: role mismatch + (would also) maker-checker.
    let txId: string

    beforeAll(async () => {
      // Seed a transaction at TREASURY_APPROVED (HEAD_TREASURY stage is next)
      const { txId: id } = await seedTransaction({
        customerId:     NEG.customer001,
        investmentId:   NEG.invest001,
        status:         'TREASURY_APPROVED',
        createdByEmail: USERS.treasuryMaker, // creator is treasury_maker_01
      })
      txId = id
    })

    it('treasury_maker_01 (TREASURY_OFFICER) cannot approve at HEAD_TREASURY stage (role mismatch)', async () => {
      const client = await clientAs(USERS.treasuryMaker)

      const { data, error } = await client.rpc('approve_transaction', {
        p_transaction_id: txId,
        p_stage:          'HEAD_TREASURY',
        p_decision:       'APPROVE',
        p_comments:       null,
      })

      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })

    it('transaction status is still TREASURY_APPROVED after the rejected attempt', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('treasury_transactions')
        .select('status')
        .eq('id', txId)
        .single()

      expect(data?.status).toBe('TREASURY_APPROVED')
    })

    it('no approvals row for HEAD_TREASURY stage was created', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('approvals')
        .select('id')
        .eq('transaction_id', txId)
        .eq('stage', 'HEAD_TREASURY')

      expect(data?.length ?? 0).toBe(0)
    })

    afterAll(async () => { await teardownTransaction(txId) })
  })
})
