'use server'

import {
  markNotificationsRead,
  getRecentNotifications,
  type Notification,
} from '@/lib/services/notification.service'
import { getAuthenticatedUser } from '@/lib/services/auth.service'

/**
 * Server action to mark notifications as read.
 * Validates that the calling user matches the userId to prevent cross-user writes.
 *
 * @param userId         The recipient user id
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

/**
 * Server action to fetch the 10 most recent notifications for the current user.
 * Returns an empty array if not authenticated or userId does not match caller.
 *
 * Requirements: 31.2, 31.4
 */
export async function getRecentNotificationsAction(
  userId: string,
): Promise<Notification[]> {
  const user = await getAuthenticatedUser()
  if (!user || user.id !== userId) return []

  return getRecentNotifications(userId, 10)
}

/**
 * Server action to mark ALL unread notifications as read for the current user.
 * Equivalent to markNotificationsReadAction(userId, null) but semantically explicit.
 *
 * Requirements: 31.3
 */
export async function markAllNotificationsReadAction(userId: string): Promise<void> {
  const user = await getAuthenticatedUser()
  if (!user || user.id !== userId) return

  await markNotificationsRead(userId, null)
}
