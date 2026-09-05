import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  recipient_id: string
  transaction_id: string | null
  event_type: string
  message: string
  is_read: boolean
  created_at: string
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Returns the count of unread notifications for a given user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .eq('is_read', false)

  if (error) return 0
  return count ?? 0
}

/**
 * Marks all notifications for a specific transaction as read for the given user.
 * Pass transactionId as null to mark ALL unread notifications read.
 */
export async function markNotificationsRead(
  userId: string,
  transactionId: string | null,
): Promise<void> {
  const supabase = await createClient()

  let query = supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', userId)
    .eq('is_read', false)

  if (transactionId !== null) {
    query = query.eq('transaction_id', transactionId)
  }

  await query
}

/**
 * Returns the most recent unread notifications for a user.
 * Used for the notification bell / dropdown in the header.
 */
export async function getRecentNotifications(
  userId: string,
  limit = 20,
): Promise<Notification[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notifications')
    .select('id, recipient_id, transaction_id, event_type, message, is_read, created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as Notification[]
}
