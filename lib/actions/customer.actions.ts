'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { UpdateCustomerSchema } from '@/lib/schemas/customer.schema'
import type { UpdateCustomerInput } from '@/lib/schemas/customer.schema'
import type { ActionResult } from '@/lib/actions/transaction.actions'

// ─── updateCustomerAction ─────────────────────────────────────────────────────

/**
 * Updates basic customer information (name, phone, status).
 * Only TREASURY_OFFICER and ADMIN can call this.
 */
export async function updateCustomerAction(
  customerId: string,
  input: UpdateCustomerInput,
  transactionId: string,
): Promise<ActionResult<{ customerId: string }>> {
  // 1. Validate
  const parsed = UpdateCustomerSchema.safeParse(input)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Invalid input.'
    return { success: false, error: firstError }
  }

  if (!customerId) {
    return { success: false, error: 'Customer ID is required.' }
  }

  // 2. Authenticate
  const user = await getAuthenticatedUser()
  if (!user) {
    return { success: false, error: 'Not authenticated.' }
  }

  // 3. Resolve role
  const role = await resolveUserRole(user.id)
  if (!role) {
    return { success: false, error: 'No role assigned to your account.' }
  }

  // 4. Only Treasury Officer or Admin can update customer info
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return {
      success: false,
      error: 'Only a Treasury Officer can update customer information.',
    }
  }

  // 5. Update
  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({
      name:             parsed.data.name,
      registered_phone: parsed.data.registered_phone || null,
      status:           parsed.data.status,
      updated_at:       new Date().toISOString(),
    })
    .eq('id', customerId)

  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath(`/transactions/${transactionId}`)

  return { success: true, data: { customerId } }
}
