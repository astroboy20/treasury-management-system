import { createClient } from '@/lib/supabase/server'
import { ROLE_PERMISSIONS, type Permission } from '@/lib/permissions/permissions'

export interface Profile {
  id: string
  full_name: string
  email: string
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserRole {
  code: string
  name: string
}

/**
 * Resolves the role code for the given user ID by querying
 * the user_roles → roles join. Returns null if no role assigned.
 * Never trusts a role from the browser — always reads from DB.
 */
export async function resolveUserRole(userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('user_roles')
    .select('roles(code)')
    .eq('user_id', userId)
    .limit(1)
    .single()

  if (error || !data) return null
  // @ts-expect-error — Supabase join returns nested object
  return (data.roles?.code as string) ?? null
}

/**
 * Loads the profile record for the given user ID.
 * Returns null if not found.
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !data) return null
  return data as Profile
}

/**
 * Returns the authenticated user from the current Supabase session.
 * Returns null if no session exists.
 */
export async function getAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return user
}

/**
 * Pure function — checks whether a role has a given permission.
 * Never reads from DB; consults the ROLE_PERMISSIONS map only.
 */
export function hasPermission(role: string, action: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]
  if (!permissions) return false
  return (permissions as readonly string[]).includes(action)
}
