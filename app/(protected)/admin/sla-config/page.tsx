import { redirect } from 'next/navigation'
import { Clock, Settings } from 'lucide-react'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { listSlaConfigAction } from '@/lib/actions/admin.actions'
import { Alert } from '@/components/ui/alert'
import { SlaConfigClient } from './_components/SlaConfigClient'

/**
 * Admin SLA configuration page — `/admin/sla-config`
 *
 * Server component. Accessible to ADMIN role only (server-side enforced).
 * Displays the current SLA duration (in hours) for each transaction type.
 * The ADMIN can update any row inline; changes take effect immediately and
 * are used by `create_treasury_transaction` to compute `sla_due_at` on new
 * transactions.
 *
 * Requirements: 37.5
 */
export default async function SlaConfigPage() {
  // ── Auth & role guard ──────────────────────────────────────────────────────
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (role !== 'ADMIN') redirect('/dashboard')

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const result = await listSlaConfigAction()
  const rows = result.data ?? []
  const loadError = result.success ? null : result.error

  return (
    <div className="mx-auto max-w-4xl p-5 sm:p-8">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Administration</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">SLA configuration</h2>
          <p className="mt-2 text-muted-foreground">
            Set the maximum processing time (in hours) for each transaction type. These
            values are used to compute the <code className="text-xs font-mono">sla_due_at</code>{' '}
            deadline when a new transaction is created.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          <Settings className="size-3.5" aria-hidden />
          Admin console
        </div>
      </div>

      {/* Legend */}
      <dl className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-3">
        {[
          { label: 'Tight (≤ 4h)',     dot: 'bg-red-400',    desc: 'Transactions with very short processing windows.' },
          { label: 'Standard (5–8h)', dot: 'bg-amber-400',  desc: 'Default business-day SLA.' },
          { label: 'Relaxed (> 8h)',  dot: 'bg-emerald-400', desc: 'Extended SLA for complex or low-urgency types.' },
        ].map(({ label, dot, desc }) => (
          <div key={label} className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${dot}`} aria-hidden />
              <dt className="text-xs font-medium">{label}</dt>
            </div>
            <dd className="mt-1 text-xs text-muted-foreground">{desc}</dd>
          </div>
        ))}
      </dl>

      {/* Error banner */}
      {loadError && (
        <Alert variant="destructive" className="mt-6">
          Failed to load SLA configuration: {loadError}
        </Alert>
      )}

      {/* Config table */}
      <section className="mt-6">
        <SlaConfigClient initialRows={rows} />
      </section>

      {/* Footer note */}
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="size-4" aria-hidden />
        SLA changes apply to new transactions only. In-flight transactions retain the
        SLA deadline computed at creation.
      </p>
    </div>
  )
}
