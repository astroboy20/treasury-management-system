'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import type { ActionResult } from '@/lib/actions/transaction.actions'

// ─── Guard helper ─────────────────────────────────────────────────────────────

/**
 * Shared admin guard — every admin server action must call this first.
 * Re-checks the ADMIN role from the database on every invocation.
 * Returns the authenticated user if authorised, or null.
 */
async function requireAdmin(): Promise<{ userId: string } | null> {
  const user = await getAuthenticatedUser()
  if (!user) return null

  const role = await resolveUserRole(user.id)
  if (role !== 'ADMIN') return null

  return { userId: user.id }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string
  full_name: string
  email: string
  is_active: boolean
  created_at: string
  roles: { id: string; code: string; name: string }[]
}

export interface RoleOption {
  id: string
  code: string
  name: string
}

// ─── listUsersAction ──────────────────────────────────────────────────────────

/**
 * Loads all profiles with their assigned roles for the admin user list.
 * Requires ADMIN role (re-checked from DB).
 *
 * Requirements: 5.2 (ADMIN permissions)
 */
export async function listUsersAction(): Promise<ActionResult<AdminUser[]>> {
  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  const supabase = await createClient()

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, is_active, created_at')
    .order('created_at', { ascending: true })

  if (error) return { success: false, error: error.message }

  if (!profiles || profiles.length === 0) {
    return { success: true, data: [] }
  }

  const userIds = profiles.map((p) => (p as Record<string, unknown>).id as string)

  // Fetch user_roles with role details for all users in one query
  const { data: userRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, roles ( id, code, name )')
    .in('user_id', userIds)

  if (rolesError) return { success: false, error: rolesError.message }

  // Group roles by user_id
  const rolesByUser: Record<string, { id: string; code: string; name: string }[]> = {}
  for (const ur of userRoles ?? []) {
    const row = ur as Record<string, unknown>
    const userId = row.user_id as string
    const role = row.roles as { id: string; code: string; name: string } | null
    if (!role) continue
    if (!rolesByUser[userId]) rolesByUser[userId] = []
    rolesByUser[userId].push(role)
  }

  const users: AdminUser[] = profiles.map((p) => {
    const row = p as Record<string, unknown>
    return {
      id: row.id as string,
      full_name: row.full_name as string,
      email: row.email as string,
      is_active: row.is_active as boolean,
      created_at: row.created_at as string,
      roles: rolesByUser[row.id as string] ?? [],
    }
  })

  return { success: true, data: users }
}

// ─── listRolesAction ──────────────────────────────────────────────────────────

/**
 * Returns all available roles for the "assign role" dropdown.
 * Requires ADMIN role.
 *
 * Requirements: 5.2 (ADMIN permissions)
 */
export async function listRolesAction(): Promise<ActionResult<RoleOption[]>> {
  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('roles')
    .select('id, code, name')
    .order('name', { ascending: true })

  if (error) return { success: false, error: error.message }

  return { success: true, data: (data ?? []) as RoleOption[] }
}

// ─── assignRoleAction ─────────────────────────────────────────────────────────

/**
 * Assigns a role to a user by inserting into user_roles.
 * Idempotent — uses ON CONFLICT DO NOTHING via upsert.
 * Requires ADMIN role (re-checked from DB on every call).
 *
 * Requirements: 5.2 (ADMIN permissions)
 */
export async function assignRoleAction(
  targetUserId: string,
  roleId: string,
): Promise<ActionResult<void>> {
  if (!targetUserId || !roleId) {
    return { success: false, error: 'User ID and role ID are required.' }
  }

  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  const supabase = await createClient()

  const { error } = await supabase.from('user_roles').upsert(
    {
      user_id: targetUserId,
      role_id: roleId,
      assigned_by: actor.userId,
    },
    { onConflict: 'user_id,role_id', ignoreDuplicates: true },
  )

  if (error) return { success: false, error: error.message }

  revalidatePath('/admin')
  return { success: true }
}

// ─── revokeRoleAction ─────────────────────────────────────────────────────────

/**
 * Revokes a role from a user by deleting from user_roles.
 * Requires ADMIN role (re-checked from DB on every call).
 * Guards against an admin revoking their own ADMIN role (would lock out the system).
 *
 * Requirements: 5.2 (ADMIN permissions)
 */
export async function revokeRoleAction(
  targetUserId: string,
  roleId: string,
): Promise<ActionResult<void>> {
  if (!targetUserId || !roleId) {
    return { success: false, error: 'User ID and role ID are required.' }
  }

  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  // Prevent an admin from revoking their own ADMIN role
  if (actor.userId === targetUserId) {
    const supabase = await createClient()
    const { data: roleRow } = await supabase
      .from('roles')
      .select('code')
      .eq('id', roleId)
      .single()
    if (roleRow && (roleRow as Record<string, unknown>).code === 'ADMIN') {
      return { success: false, error: 'You cannot revoke your own ADMIN role.' }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', targetUserId)
    .eq('role_id', roleId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/admin')
  return { success: true }
}

// ─── setUserActiveAction ──────────────────────────────────────────────────────

/**
 * Activates or deactivates a user by updating profiles.is_active.
 * Requires ADMIN role (re-checked from DB on every call).
 * Guards against an admin deactivating themselves.
 *
 * Requirements: 5.2 (ADMIN permissions)
 */
export async function setUserActiveAction(
  targetUserId: string,
  isActive: boolean,
): Promise<ActionResult<void>> {
  if (!targetUserId) {
    return { success: false, error: 'User ID is required.' }
  }

  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  if (actor.userId === targetUserId && !isActive) {
    return { success: false, error: 'You cannot deactivate your own account.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', targetUserId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/admin')
  return { success: true }
}

// ─── SLA Config Types ─────────────────────────────────────────────────────────

export interface SlaConfigRow {
  id: string
  transaction_type: string
  sla_hours: number
  created_at: string
  updated_at: string
}

// ─── listSlaConfigAction ──────────────────────────────────────────────────────

/**
 * Returns all rows from `sla_config`, one per transaction type.
 * Requires ADMIN role.
 *
 * Requirements: 37.5
 */
export async function listSlaConfigAction(): Promise<ActionResult<SlaConfigRow[]>> {
  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sla_config')
    .select('id, transaction_type, sla_hours, created_at, updated_at')
    .order('transaction_type', { ascending: true })

  if (error) return { success: false, error: error.message }

  return { success: true, data: (data ?? []) as SlaConfigRow[] }
}

// ─── updateSlaConfigAction ────────────────────────────────────────────────────

/**
 * Updates the `sla_hours` for a specific `sla_config` row by ID.
 * Validates that `sla_hours` is a positive integer (1–168 hours = 1 week max).
 * Requires ADMIN role (re-checked from DB on every call).
 *
 * Requirements: 37.5
 */
export async function updateSlaConfigAction(
  id: string,
  slaHours: number,
): Promise<ActionResult<SlaConfigRow>> {
  if (!id) return { success: false, error: 'Config ID is required.' }

  if (!Number.isInteger(slaHours) || slaHours < 1 || slaHours > 168) {
    return { success: false, error: 'SLA hours must be a whole number between 1 and 168.' }
  }

  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sla_config')
    .update({ sla_hours: slaHours, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, transaction_type, sla_hours, created_at, updated_at')
    .single()

  if (error) return { success: false, error: error.message }

  revalidatePath('/admin/sla-config')
  revalidatePath('/dashboard')
  revalidatePath('/transactions')

  return { success: true, data: data as SlaConfigRow }
}

// ─── upsertSlaConfigAction ────────────────────────────────────────────────────

/**
 * Inserts a new `sla_config` row for a transaction type that does not yet have
 * a configured SLA, or updates the existing row.
 * Used when the admin wants to add a type that was missing from the initial seed.
 * Requires ADMIN role.
 *
 * Requirements: 37.5
 */
export async function upsertSlaConfigAction(
  transactionType: string,
  slaHours: number,
): Promise<ActionResult<SlaConfigRow>> {
  if (!transactionType || transactionType.trim() === '') {
    return { success: false, error: 'Transaction type is required.' }
  }
  if (!Number.isInteger(slaHours) || slaHours < 1 || slaHours > 168) {
    return { success: false, error: 'SLA hours must be a whole number between 1 and 168.' }
  }

  const actor = await requireAdmin()
  if (!actor) return { success: false, error: 'Forbidden. ADMIN role required.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sla_config')
    .upsert(
      {
        transaction_type: transactionType.trim().toUpperCase(),
        sla_hours: slaHours,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'transaction_type' },
    )
    .select('id, transaction_type, sla_hours, created_at, updated_at')
    .single()

  if (error) return { success: false, error: error.message }

  revalidatePath('/admin/sla-config')
  revalidatePath('/dashboard')
  revalidatePath('/transactions')

  return { success: true, data: data as SlaConfigRow }
}
