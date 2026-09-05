import { redirect } from 'next/navigation'
import { getAuthenticatedUser, getProfile, resolveUserRole } from '@/lib/services/auth.service'
import AppShell from '@/components/layout/AppShell'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Load user server-side — never trust client-supplied identity
  const user = await getAuthenticatedUser()

  if (!user) {
    redirect('/auth/login')
  }

  const [profile, role] = await Promise.all([
    getProfile(user.id),
    resolveUserRole(user.id),
  ])

  // Role not yet assigned — show pending activation screen
  if (!role) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/30 p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-background p-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-100 text-amber-700">
            <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Pending activation</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Your account has been created but a role hasn&apos;t been assigned yet.
            Contact your administrator to complete your workspace access.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      user={{ id: user.id, email: user.email ?? '' }}
      profile={profile}
      role={role}
    >
      {children}
    </AppShell>
  )
}
