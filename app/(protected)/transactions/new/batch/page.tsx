import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Layers } from 'lucide-react'

import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { createClient } from '@/lib/supabase/server'
import BatchTransactionForm from './_components/BatchTransactionForm'

// ─── Server-side customer fetch ───────────────────────────────────────────────

async function fetchCustomers() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, customer_number')
    .eq('status', 'ACTIVE')
    .order('name', { ascending: true })
    .limit(500)

  if (error) return []
  return (data ?? []) as { id: string; name: string; customer_number: string }[]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BatchTransactionPage() {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    redirect('/transactions')
  }

  const customers = await fetchCustomers()

  return (
    <div className="mx-auto max-w-4xl p-5 sm:p-8">
      {/* Back link */}
      <Link
        href="/transactions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to transactions
      </Link>

      {/* Page header */}
      <div className="mt-6">
        <div className="flex items-center gap-2">
          <Layers className="size-5 text-primary" aria-hidden />
          <p className="text-sm font-medium text-primary">Step 1 of 6</p>
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          New Customer Instructions
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Record between 1 and 20 customer instructions at once. Each transaction enters the
          normal 6-step workflow independently after submission.
        </p>
      </div>

      {/* Form */}
      <div className="mt-6 pb-24">
        <BatchTransactionForm customers={customers} />
      </div>
    </div>
  )
}
