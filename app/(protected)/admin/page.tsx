import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { listUsersAction, listRolesAction } from '@/lib/actions/admin.actions'
import { Alert } from '@/components/ui/alert'
import { UserManagementClient } from './_components/UserManagementClient'

/**
 * Admin user management page — `/admin`
 *
 * Server component. Accessible to ADMIN role only (server-side enforced).
 * Loads all profiles with assigned roles, then passes data to the
 * interactive client component for role assignment, revocation, and
 * deactivation actions.
 *
 * Requirements: 5.2 (ADMIN permissions)
 */
export default async function AdminUsersPage() {
  // ── Auth & role guard ──────────────────────────────────────────────────────
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (role !== 'ADMIN') redirect('/dashboard')

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const [usersResult, rolesResult] = await Promise.all([listUsersAction(), listRolesAction()])

  const users = usersResult.data ?? []
  const roles = rolesResult.data ?? []

  const loadError = !usersResult.success
    ? usersResult.error
    : !rolesResult.success
      ? rolesResult.error
      : null

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Administration</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">User management</h2>
          <p className="mt-2 text-muted-foreground">
            {users.length > 0
              ? `${users.length} user${users.length !== 1 ? 's' : ''} registered on the platform`
              : 'Manage staff accounts and role assignments'}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          <Users className="size-3.5" aria-hidden />
          Admin console
        </div>
      </div>

      {/* Error banner */}
      {loadError && (
        <Alert variant="destructive" className="mt-6">
          Failed to load user data: {loadError}
        </Alert>
      )}

      {/* User table */}
      <section className="mt-6">
        <UserManagementClient
          initialUsers={users}
          roles={roles}
          currentUserId={user.id}
        />
      </section>

      {/* Footer note */}
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="size-4" aria-hidden />
        All role changes take effect immediately and are enforced server-side on every request.
      </p>
    </div>
  )
}
