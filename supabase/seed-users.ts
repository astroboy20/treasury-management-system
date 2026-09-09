/**
 * Seed Users Script — Greenline Treasury Platform
 *
 * Creates the 14 test staff users via the Supabase Admin API, then seeds
 * their profiles and role assignments using the actual UUIDs returned by
 * the API.
 *
 * This replaces the direct auth.users SQL insert approach from seed.sql
 * Section 1, which doesn't work on hosted Supabase because:
 *   1. Custom UUIDs cannot be specified via the Admin API on hosted projects
 *   2. auth.identities entries are missing from raw SQL inserts, breaking sign-in
 *
 * Run with:
 *   npx tsx supabase/seed-users.ts
 *
 * Prerequisites:
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env
 *
 * After this script runs, apply the REST of seed.sql (sections 4–8: customers,
 * accounts, investments) in the Supabase SQL Editor.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import path from 'node:path'

// Load .env from project root
config({ path: path.resolve(process.cwd(), '.env') })

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const SEED_PASSWORD = 'Password123!'

// The 14 seed users — emails and roles must match seed.sql Section 1
const USERS = [
  // ── Scenario users ──────────────────────────────────────────
  { email: 'treasury_maker_01@greenline.test',    full_name: 'Treasury Maker 01',     role: 'TREASURY_OFFICER' },
  { email: 'treasury_checker_01@greenline.test',  full_name: 'Treasury Checker 01',   role: 'TREASURY_OFFICER' },
  { email: 'account_officer_01@greenline.test',   full_name: 'Account Officer 01',    role: 'ACCOUNT_OFFICER'  },
  { email: 'head_treasury_01@greenline.test',     full_name: 'Head Treasury 01',      role: 'HEAD_TREASURY'    },
  { email: 'mis_officer_01@greenline.test',       full_name: 'MIS Officer 01',        role: 'MIS'              },
  { email: 'audit_officer_01@greenline.test',     full_name: 'Audit Officer 01',      role: 'AUDIT'            },
  { email: 'md_01@greenline.test',                full_name: 'Managing Director 01',  role: 'MD'               },
  { email: 'operations_officer_01@greenline.test',full_name: 'Operations Officer 01', role: 'OPERATIONS'       },
  // ── E2E users ───────────────────────────────────────────────
  { email: 'treasury_maker_e2e@greenline.test',    full_name: 'Treasury Maker E2E',     role: 'TREASURY_OFFICER' },
  { email: 'account_officer_e2e@greenline.test',   full_name: 'Account Officer E2E',    role: 'ACCOUNT_OFFICER'  },
  { email: 'head_treasury_e2e@greenline.test',     full_name: 'Head Treasury E2E',      role: 'HEAD_TREASURY'    },
  { email: 'mis_officer_e2e@greenline.test',       full_name: 'MIS Officer E2E',        role: 'MIS'              },
  { email: 'audit_officer_e2e@greenline.test',     full_name: 'Audit Officer E2E',      role: 'AUDIT'            },
  { email: 'md_e2e@greenline.test',                full_name: 'Managing Director E2E',  role: 'MD'               },
  { email: 'operations_officer_e2e@greenline.test',full_name: 'Operations Officer E2E', role: 'OPERATIONS'       },
]

async function seedUsers() {
  console.log(`🌱  Seeding ${USERS.length} users into ${SUPABASE_URL}\n`)

  const createdUsers: Array<{ id: string; email: string; role: string; full_name: string }> = []

  // ── Step 1: Create auth users ──────────────────────────────
  for (const user of USERS) {
    // Check if the user already exists
    const { data: list } = await admin.auth.admin.listUsers()
    const existing = list?.users?.find((u) => u.email === user.email)

    if (existing) {
      console.log(`  ⏭   Already exists: ${user.email} (${existing.id})`)
      createdUsers.push({ id: existing.id, email: user.email, role: user.role, full_name: user.full_name })
      continue
    }

    const { data, error } = await admin.auth.admin.createUser({
      email:         user.email,
      password:      SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: user.full_name, requested_role: user.role },
    })

    if (error || !data.user) {
      console.error(`  ❌  Failed: ${user.email} — ${error?.message}`)
      continue
    }

    console.log(`  ✅  Created: ${user.email} (${data.user.id})`)
    createdUsers.push({ id: data.user.id, email: user.email, role: user.role, full_name: user.full_name })
  }

  console.log(`\n📋  ${createdUsers.length}/${USERS.length} users ready\n`)

  // ── Step 2: Ensure profiles rows exist ────────────────────
  // The handle_new_user trigger should have created them, but seed them
  // explicitly to handle cases where the trigger didn't fire.
  console.log('👤  Ensuring profiles rows...')
  for (const user of createdUsers) {
    const { error } = await admin.from('profiles').upsert({
      id:        user.id,
      full_name: user.full_name,
      email:     user.email,
      is_active: true,
    }, { onConflict: 'id', ignoreDuplicates: true })

    if (error) {
      console.error(`  ⚠   Profile upsert failed for ${user.email}: ${error.message}`)
    }
  }
  console.log('  ✅  Profiles done\n')

  // ── Step 3: Assign roles ───────────────────────────────────
  console.log('🔑  Assigning roles...')

  // Load all roles from the roles table
  const { data: roles, error: rolesError } = await admin.from('roles').select('id, code')
  if (rolesError || !roles?.length) {
    console.error('  ❌  Cannot load roles table. Have you run migration 005_roles_seed.sql?')
    console.error(`      Error: ${rolesError?.message}`)
    process.exit(1)
  }

  const roleMap = Object.fromEntries(roles.map((r: { id: string; code: string }) => [r.code, r.id]))
  const assignedById = createdUsers[0]?.id // Treasury Maker 01 assigns all roles

  for (const user of createdUsers) {
    const roleId = roleMap[user.role]
    if (!roleId) {
      console.error(`  ⚠   Role code "${user.role}" not found in roles table`)
      continue
    }

    const { error } = await admin.from('user_roles').upsert({
      user_id:     user.id,
      role_id:     roleId,
      assigned_by: assignedById,
    }, { onConflict: 'user_id,role_id', ignoreDuplicates: true })

    if (error) {
      console.error(`  ⚠   Role assignment failed for ${user.email}: ${error.message}`)
    } else {
      console.log(`  ✅  ${user.email} → ${user.role}`)
    }
  }

  console.log('\n🎉  User seeding complete!\n')
  console.log('Next steps:')
  console.log('  1. In Supabase SQL Editor, run sections 4–8 of supabase/seed.sql')
  console.log('     (customers, customer_accounts, investments, negative test customers)')
  console.log('  2. Run: pnpm test -- rls.live --reporter=verbose')
}

seedUsers().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
