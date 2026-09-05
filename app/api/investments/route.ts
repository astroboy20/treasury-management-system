import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser } from '@/lib/services/auth.service'

/**
 * GET /api/investments?customerId=<uuid>
 *
 * Returns active investments for a given customer. Used by the
 * NewTransactionForm combobox to populate the investment selector
 * after the user picks a customer.
 */
export async function GET(request: NextRequest) {
  // Require authentication — RLS will also enforce this at the DB level
  const user = await getAuthenticatedUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const customerId = request.nextUrl.searchParams.get('customerId')
  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('investments')
    .select('id, product_type, principal, external_reference')
    .eq('customer_id', customerId)
    .in('status', ['ACTIVE', 'MATURED'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
