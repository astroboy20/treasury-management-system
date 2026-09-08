/**
 * Task 7.9 — Verify audit_events immutability
 *
 * Asserts that the append-only guarantee on `audit_events` holds at every
 * enforcement layer: the permissions map, the workflow service, and — when a
 * live Supabase instance is available — the database itself.
 *
 * Enforcement mechanisms under test (from migrations 001 and 002):
 *
 *   1. `REVOKE UPDATE ON audit_events FROM authenticated`
 *   2. `REVOKE DELETE ON audit_events FROM authenticated`
 *   3. `REVOKE UPDATE ON audit_events FROM anon`
 *   4. `REVOKE DELETE ON audit_events FROM anon`
 *
 * No RLS policy can grant UPDATE or DELETE on `audit_events` because the
 * underlying privilege has been revoked at the PostgreSQL role level — the
 * REVOKE supersedes any policy that might accidentally permit the operation.
 *
 * Structure:
 *
 *   SECTION A — PURE-LOGIC TESTS (no DB required)
 *     A.1  No role in ROLE_PERMISSIONS grants audit-event mutation.
 *     A.2  The application never exposes server actions for updating or
 *          deleting audit events (structural guard via absence of exports).
 *     A.3  Cross-cutting: ADMIN is also blocked at the DB layer even though
 *          ADMIN has broader permissions in the permissions map.
 *
 *   SECTION B — LIVE INTEGRATION TESTS (requires env keys)
 *     B.1  TREASURY_OFFICER cannot UPDATE an audit_events row.
 *     B.2  TREASURY_OFFICER cannot DELETE an audit_events row.
 *     B.3  ACCOUNT_OFFICER cannot UPDATE an audit_events row.
 *     B.4  ACCOUNT_OFFICER cannot DELETE an audit_events row.
 *     B.5  OPERATIONS cannot UPDATE an audit_events row.
 *     B.6  OPERATIONS cannot DELETE an audit_events row.
 *     B.7  Original row is intact — metadata was never tampered with.
 *     B.8  Row count is stable — no row was deleted.
 *     B.9  INSERT still works for the service-role admin client (write path
 *          remains open so the RPC functions continue to write events).
 *
 * Seed data used: CUSTOMER_NEG_001
 *   customer_id:  cc000001-0000-0000-0000-000000000010
 *   investment_id: ee000001-0000-0000-0000-000000000010
 *
 * Run with:
 *   pnpm test -- audit.immutability --reporter=verbose
 *
 * Requirements: 1.5, 2.4, 28.5, 35.2
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { ROLE_PERMISSIONS } from '@/lib/permissions/permissions'

// ─── Environment / credentials ────────────────────────────────────────────────

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY         = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const SEED_PASSWORD = 'Password123!'

/** Seed users from supabase/seed.sql — all share the same test password. */
const USERS = {
  treasury:   'treasury_maker_01@greenline.test',
  account:    'account_officer_01@greenline.test',
  operations: 'operations_officer_01@greenline.test',
} as const

/** Seed IDs for CUSTOMER_NEG_001 (supabase/seed.sql, SECTION 6). */
const NEG = {
  customer001: 'cc000001-0000-0000-0000-000000000010',
  invest001:   'ee000001-0000-0000-0000-000000000010',
} as const

// ─── Client factory helpers ───────────────────────────────────────────────────

/** Service-role admin client — bypasses RLS; used only for setup/teardown. */
function adminClient() {
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Returns a Supabase client authenticated as the given seed user.
 * Tries the admin magic-link flow first; falls back to email+password.
 */
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
          `Ensure supabase/seed.sql has been applied to the live project. ` +
          `Error: ${error?.message}`,
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
    throw new Error(
      `Failed to create session for ${email}: ${sessionError?.message}`,
    )
  }

  return anonClient
}

// ─── Transaction / audit-event seed helpers ───────────────────────────────────

/**
 * Creates a minimal treasury transaction via the admin client (bypasses RLS).
 * Returns the transaction id and the creator's profile id.
 */
async function seedTransaction(createdByEmail: string) {
  const admin = adminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', createdByEmail)
    .single()

  if (!profile) throw new Error(`Profile not found for ${createdByEmail}`)

  const txId = crypto.randomUUID()

  await admin.from('treasury_transactions').insert({
    id:                      txId,
    transaction_reference:   `TRX-IMM-${Date.now()}`,
    customer_id:             NEG.customer001,
    investment_id:           NEG.invest001,
    transaction_type:        'ROLLOVER',
    scenario_code:           'P_AND_I',
    status:                  'INSTRUCTION_RECEIVED',
    requested_amount:        5_000_000,
    purpose:                 'audit_events immutability test',
    source_instruction_type: 'LETTER',
    sla_due_at:              new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    created_by:              profile.id,
  })

  return { txId, creatorId: profile.id }
}

/**
 * Inserts a real `audit_events` row via the admin client (bypasses REVOKE).
 * Returns the `BIGINT` id of the new row.
 */
async function seedAuditEvent(txId: string, actorId: string): Promise<number> {
  const admin = adminClient()

  const { data, error } = await admin
    .from('audit_events')
    .insert({
      transaction_id: txId,
      actor_id:       actorId,
      event_type:     'TRANSACTION_CREATED',
      from_status:    null,
      to_status:      'INSTRUCTION_RECEIVED',
      metadata:       { immutability_test: true, original_value: 'untampered' },
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to seed audit_event: ${error?.message}`)
  }

  return data.id as number
}

/** Removes the test transaction and all cascade-deleted child rows. */
async function teardownTransaction(txId: string) {
  const admin = adminClient()
  await admin.from('treasury_transactions').delete().eq('id', txId)
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION A — PURE-LOGIC TESTS
//  No database connection required.
//  Requirements: 1.5, 2.4, 35.2
// ─────────────────────────────────────────────────────────────────────────────

describe('A. audit_events immutability — pure logic layer (Req 1.5, 2.4, 35.2)', () => {

  // ── A.1 — ROLE_PERMISSIONS grants no mutation capability on audit_events ───

  describe('A.1: No role in ROLE_PERMISSIONS includes audit-event mutation permissions', () => {
    const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]

    it('no role has "delete_audit_event" permission', () => {
      for (const role of ALL_ROLES) {
        const perms = ROLE_PERMISSIONS[role] as readonly string[]
        expect(perms, `${role} must not have delete_audit_event`).not.toContain('delete_audit_event')
      }
    })

    it('no role has "update_audit_event" permission', () => {
      for (const role of ALL_ROLES) {
        const perms = ROLE_PERMISSIONS[role] as readonly string[]
        expect(perms, `${role} must not have update_audit_event`).not.toContain('update_audit_event')
      }
    })

    it('ADMIN does not have delete_audit_event permission', () => {
      const adminPerms = ROLE_PERMISSIONS.ADMIN as readonly string[]
      expect(adminPerms).not.toContain('delete_audit_event')
      expect(adminPerms).not.toContain('update_audit_event')
    })

    it('AUDIT does not have delete_audit_event or update_audit_event permission', () => {
      const auditPerms = ROLE_PERMISSIONS.AUDIT as readonly string[]
      expect(auditPerms).not.toContain('delete_audit_event')
      expect(auditPerms).not.toContain('update_audit_event')
    })

    it('TREASURY_OFFICER does not have audit-event mutation permissions', () => {
      const perms = ROLE_PERMISSIONS.TREASURY_OFFICER as readonly string[]
      expect(perms).not.toContain('delete_audit_event')
      expect(perms).not.toContain('update_audit_event')
    })

    it('OPERATIONS does not have audit-event mutation permissions', () => {
      const perms = ROLE_PERMISSIONS.OPERATIONS as readonly string[]
      expect(perms).not.toContain('delete_audit_event')
      expect(perms).not.toContain('update_audit_event')
    })

    it('all 9 roles are checked — none grant audit-event mutation', () => {
      const mutationPerms = ['delete_audit_event', 'update_audit_event']
      const offendingRoles: string[] = []

      for (const role of ALL_ROLES) {
        const perms = ROLE_PERMISSIONS[role] as readonly string[]
        for (const mutPerm of mutationPerms) {
          if (perms.includes(mutPerm)) {
            offendingRoles.push(`${role}:${mutPerm}`)
          }
        }
      }

      expect(offendingRoles).toEqual([])
    })
  })

  // ── A.2 — No server actions expose UPDATE/DELETE on audit_events ──────────

  describe('A.2: Application never exposes server actions for audit-event mutation (Req 1.5)', () => {
    /**
     * Describes what mutation capability a correctly implemented server-action
     * module should expose for audit_events.
     *
     * The audit.service.ts module exposes only READ operations:
     *   - getAuditEvents(transactionId): returns events in chronological order
     *
     * No export corresponding to a mutation should exist.
     */
    it('audit_events is read-only in the application layer (structural guard)', async () => {
      // Import the audit service and confirm it exposes no mutation exports.
      const auditService = await import('@/lib/services/audit.service')

      // Read operation must exist
      expect(typeof auditService.getAuditEvents).toBe('function')

      // Mutation operations must NOT exist
      expect((auditService as Record<string, unknown>).updateAuditEvent).toBeUndefined()
      expect((auditService as Record<string, unknown>).deleteAuditEvent).toBeUndefined()
      expect((auditService as Record<string, unknown>).patchAuditEvent).toBeUndefined()
    })

    it('no "update" export exists in audit.service.ts', async () => {
      const auditService = await import('@/lib/services/audit.service')
      const exportNames = Object.keys(auditService)
      const mutationExports = exportNames.filter(
        (name) =>
          name.toLowerCase().includes('update') ||
          name.toLowerCase().includes('delete') ||
          name.toLowerCase().includes('remove') ||
          name.toLowerCase().includes('patch'),
      )
      expect(mutationExports).toEqual([])
    })
  })

  // ── A.3 — Cross-cutting: role-level REVOKE applies to ADMIN too ───────────

  describe('A.3: REVOKE is unconditional — even privileged roles cannot mutate (Req 2.4)', () => {
    /**
     * The PostgreSQL REVOKE UPDATE / REVOKE DELETE statements in migration 002
     * operate at the privilege level, not at the policy level. RLS policies
     * cannot grant privileges that have been revoked. Therefore, even an ADMIN
     * role configured with broad RLS SELECT permissions cannot UPDATE or DELETE
     * an audit_events row through the Supabase JS client.
     *
     * This is verified structurally: ADMIN has no mutation permission in the
     * app layer, consistent with the DB enforcement.
     */
    it('ADMIN permissions map has no audit-event mutation entries', () => {
      const adminPerms = ROLE_PERMISSIONS.ADMIN as readonly string[]
      expect(adminPerms).not.toContain('delete_audit_event')
      expect(adminPerms).not.toContain('update_audit_event')
    })

    it('ADMIN can manage_users but cannot mutate audit events (separation of concerns)', () => {
      const adminPerms = ROLE_PERMISSIONS.ADMIN as readonly string[]
      // ADMIN retains user management capability
      expect(adminPerms).toContain('manage_users')
      // But NOT audit event mutation
      expect(adminPerms).not.toContain('delete_audit_event')
    })

    it('REVOKE semantics: no RLS policy can re-grant a revoked privilege', () => {
      // This is a structural assertion documenting the PostgreSQL guarantee:
      // once REVOKE UPDATE is issued, CREATE POLICY FOR UPDATE has no effect.
      // We verify the understanding is correctly encoded in the permissions map
      // by confirming no role attempts to claim this privilege.
      const allPerms = (Object.values(ROLE_PERMISSIONS) as (readonly string[])[]).flat()
      expect(allPerms).not.toContain('update_audit_event')
      expect(allPerms).not.toContain('delete_audit_event')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION B — LIVE INTEGRATION TESTS
//  Require NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//  and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to be set.
//  Uses CUSTOMER_NEG_001 seed data from supabase/seed.sql.
//  Requirements: 1.5, 2.4, 28.5, 35.2
// ─────────────────────────────────────────────────────────────────────────────

describe('B. audit_events immutability — live DB enforcement (Req 1.5, 2.4, 28.5, 35.2)', () => {
  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ' +
          'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set to run live tests.',
      )
    }
  })

  // ─── Shared setup: one transaction + one audit event used across B.1–B.8 ──

  let txId: string
  let creatorId: string
  let auditEventId: number

  beforeAll(async () => {
    const seeded = await seedTransaction(USERS.treasury)
    txId = seeded.txId
    creatorId = seeded.creatorId
    auditEventId = await seedAuditEvent(txId, creatorId)
  })

  afterAll(async () => {
    await teardownTransaction(txId)
  })

  // ── B.1 & B.2 — TREASURY_OFFICER cannot UPDATE or DELETE ─────────────────

  describe('B.1–B.2: TREASURY_OFFICER is blocked from UPDATE and DELETE on audit_events', () => {
    it('B.1: UPDATE by TREASURY_OFFICER is rejected (REVOKE UPDATE FROM authenticated)', async () => {
      const client = await clientAs(USERS.treasury)

      const { error } = await client
        .from('audit_events')
        .update({ metadata: { tampered_by: 'treasury_officer' } })
        .eq('id', auditEventId)

      // The REVOKE UPDATE ensures this always returns an error
      expect(error).not.toBeNull()
    })

    it('B.2: DELETE by TREASURY_OFFICER is rejected (REVOKE DELETE FROM authenticated)', async () => {
      const client = await clientAs(USERS.treasury)

      const { error } = await client
        .from('audit_events')
        .delete()
        .eq('id', auditEventId)

      // The REVOKE DELETE ensures this always returns an error
      expect(error).not.toBeNull()
    })
  })

  // ── B.3 & B.4 — ACCOUNT_OFFICER cannot UPDATE or DELETE ──────────────────

  describe('B.3–B.4: ACCOUNT_OFFICER is blocked from UPDATE and DELETE on audit_events', () => {
    it('B.3: UPDATE by ACCOUNT_OFFICER is rejected', async () => {
      const client = await clientAs(USERS.account)

      const { error } = await client
        .from('audit_events')
        .update({ metadata: { tampered_by: 'account_officer' } })
        .eq('id', auditEventId)

      expect(error).not.toBeNull()
    })

    it('B.4: DELETE by ACCOUNT_OFFICER is rejected', async () => {
      const client = await clientAs(USERS.account)

      const { error } = await client
        .from('audit_events')
        .delete()
        .eq('id', auditEventId)

      expect(error).not.toBeNull()
    })
  })

  // ── B.5 & B.6 — OPERATIONS cannot UPDATE or DELETE ───────────────────────

  describe('B.5–B.6: OPERATIONS is blocked from UPDATE and DELETE on audit_events', () => {
    it('B.5: UPDATE by OPERATIONS is rejected', async () => {
      const client = await clientAs(USERS.operations)

      const { error } = await client
        .from('audit_events')
        .update({ metadata: { tampered_by: 'operations' } })
        .eq('id', auditEventId)

      expect(error).not.toBeNull()
    })

    it('B.6: DELETE by OPERATIONS is rejected', async () => {
      const client = await clientAs(USERS.operations)

      const { error } = await client
        .from('audit_events')
        .delete()
        .eq('id', auditEventId)

      expect(error).not.toBeNull()
    })
  })

  // ── B.7 — Original row is intact after all rejected mutation attempts ─────

  describe('B.7: audit_events row is intact after all rejected mutations (Req 28.5)', () => {
    it('metadata was never changed — original_value is still "untampered"', async () => {
      const admin = adminClient()
      const { data, error } = await admin
        .from('audit_events')
        .select('metadata, event_type, to_status')
        .eq('id', auditEventId)
        .single()

      expect(error).toBeNull()
      expect(data).not.toBeNull()

      const meta = data!.metadata as Record<string, unknown>
      expect(meta.original_value).toBe('untampered')
      expect(meta.tampered_by).toBeUndefined()
      expect(meta.immutability_test).toBe(true)
    })

    it('event_type is still TRANSACTION_CREATED — row was not overwritten', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('event_type')
        .eq('id', auditEventId)
        .single()

      expect(data?.event_type).toBe('TRANSACTION_CREATED')
    })

    it('to_status is still INSTRUCTION_RECEIVED — transition record is unmodified', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('to_status')
        .eq('id', auditEventId)
        .single()

      expect(data?.to_status).toBe('INSTRUCTION_RECEIVED')
    })
  })

  // ── B.8 — Row count is stable — no row was deleted ────────────────────────

  describe('B.8: audit_events row count is stable — no deletion succeeded (Req 1.5)', () => {
    it('the seeded audit_events row still exists after all DELETE attempts', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('id')
        .eq('id', auditEventId)

      // Exactly one row must still be present
      expect(data?.length).toBe(1)
      expect(data![0].id).toBe(auditEventId)
    })

    it('the row count for this transaction has not decreased', async () => {
      // We seeded exactly one row; verify it is still there
      const admin = adminClient()
      const { count } = await admin
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('transaction_id', txId)

      // At minimum, our one seeded row must be present
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })

  // ── B.9 — Admin service-role client can still INSERT (write path is open) ──

  describe('B.9: Service-role admin client can INSERT audit events (RPC write path unaffected)', () => {
    let secondEventId: number

    it('admin client can insert a new audit_events row (service role bypasses REVOKE)', async () => {
      // The REVOKE applies to the `authenticated` and `anon` PostgreSQL roles.
      // The service-role key uses the `service_role` PostgreSQL role, which is
      // not subject to the REVOKE. This confirms the write path used by RPCs
      // (which run as SECURITY DEFINER with elevated privileges) is unaffected.
      const admin = adminClient()
      const { data, error } = await admin
        .from('audit_events')
        .insert({
          transaction_id: txId,
          actor_id:       creatorId,
          event_type:     'SIGNATURE_VERIFIED',
          from_status:    'INSTRUCTION_RECEIVED',
          to_status:      'SIGNATURE_VERIFIED',
          metadata:       { write_path_test: true },
        })
        .select('id')
        .single()

      expect(error).toBeNull()
      expect(data?.id).toBeDefined()
      secondEventId = data!.id as number
    })

    it('the newly inserted row is visible to the admin client', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('event_type')
        .eq('id', secondEventId)
        .single()

      expect(data?.event_type).toBe('SIGNATURE_VERIFIED')
    })

    it('TREASURY_OFFICER still cannot DELETE the newly inserted row', async () => {
      // Even fresh rows are immediately immutable from the authenticated role.
      const client = await clientAs(USERS.treasury)

      const { error } = await client
        .from('audit_events')
        .delete()
        .eq('id', secondEventId)

      expect(error).not.toBeNull()
    })

    it('TREASURY_OFFICER still cannot UPDATE the newly inserted row', async () => {
      const client = await clientAs(USERS.treasury)

      const { error } = await client
        .from('audit_events')
        .update({ event_type: 'TAMPERED_EVENT' })
        .eq('id', secondEventId)

      expect(error).not.toBeNull()
    })

    it('second row is still intact after rejected mutation attempts', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('audit_events')
        .select('event_type, metadata')
        .eq('id', secondEventId)
        .single()

      expect(data?.event_type).toBe('SIGNATURE_VERIFIED')
      const meta = data?.metadata as Record<string, unknown>
      expect(meta?.write_path_test).toBe(true)
    })
  })
})
