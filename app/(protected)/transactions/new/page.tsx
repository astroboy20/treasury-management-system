import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { createClient } from '@/lib/supabase/server'
import NewTransactionForm from './_components/NewTransactionForm'

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

export default async function NewTransactionPage() {
  // Auth check — this is a protected route (layout also checks, but we check
  // here too so we can enforce TREASURY_OFFICER before rendering)
  const user = await getAuthenticatedUser()
  if (!user) redirect('/auth/login')

  const role = await resolveUserRole(user.id)
  if (!role) redirect('/auth/login')

  // Only Treasury Officers (and Admins) can reach this page
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    redirect('/transactions')
  }

  // Prefetch customers server-side so the combobox has instant data
  const customers = await fetchCustomers()

  return (
    <div className="mx-auto max-w-3xl p-5 sm:p-8">
      {/* Back link */}
      <Link
        href="/transactions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to transactions
      </Link>

      {/* Page header */}
      <div className="mt-6">
        <p className="text-sm font-medium text-primary">Step 1 of 6</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          New Customer Instruction
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Record the customer&apos;s instruction to start the treasury workflow. A unique
          transaction reference will be assigned automatically.
        </p>
      </div>

      {/* Form */}
      <div className="mt-8">
        <NewTransactionForm customers={customers} />
      </div>
    </div>
  )
}
