'use server'

import { markNotificationsRead } from '@/lib/services/notification.service'
import { getAuthenticatedUser } from '@/lib/services/auth.service'

/**
 * Server action to mark notifications as read.
 * Validates that the calling user matches the userId to prevent cross-user writes.
 *
 * @param userId       The recipient user id
 * @param transactionId  Transaction to scope the update to, or null to mark all read
 */
export async function markNotificationsReadAction(
  userId: string,
  transactionId: string | null,
): Promise<void> {
  const user = await getAuthenticatedUser()
  // Security: only allow users to mark their own notifications
  if (!user || user.id !== userId) return

  await markNotificationsRead(userId, transactionId)
}
