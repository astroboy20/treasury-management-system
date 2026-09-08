'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { markNotificationsReadAction } from '@/lib/actions/notification.actions'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { Notification } from '@/lib/services/notification.service'

// ─── Props ────────────────────────────────────────────────────────────────────

interface NotificationBellProps {
  userId: string
  initialNotifications: Notification[]
  initialUnreadCount: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Human-readable relative time without an external dependency */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

/** Maps DB event_type codes to readable labels */
const EVENT_LABELS: Record<string, string> = {
  TRANSACTION_CREATED:  'Transaction Created',
  SIGNATURE_VERIFIED:   'Signature Verified',
  SIGNATURE_FAILED:     'Signature Failed',
  CUSTOMER_CONFIRMED:   'Customer Confirmed',
  INVESTMENT_VERIFIED:  'Investment Verified',
  VOUCHER_CREATED:      'Voucher Created',
  APPROVAL_GRANTED:     'Approval Granted',
  APPROVAL_RETURNED:    'Approval Returned',
  APPROVAL_REJECTED:    'Approval Rejected',
  OPERATIONS_STARTED:   'Operations Started',
  OPERATIONS_COMPLETED: 'Operations Completed',
  TREASURY_CONFIRMED:   'Treasury Confirmed',
  REVERSAL_CREATED:     'Reversal Created',
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * NotificationBell
 *
 * Client component that:
 * - Displays an unread-count badge (red) on the bell icon when count > 0
 * - Shows a dropdown with up to 10 recent notifications
 * - Subscribes to Supabase Realtime INSERT events on the `notifications` table
 *   filtered to the current user, keeping the count and list live
 * - Navigates to the relevant transaction workspace on click
 *
 * Requirements: 31.1, 31.2, 31.3, 31.4
 */
export function NotificationBell({
  userId,
  initialNotifications,
  initialUnreadCount,
}: NotificationBellProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [unreadCount, setUnreadCount] = useState<number>(initialUnreadCount)
  const [open, setOpen] = useState(false)

  // Base UI onOpenChange receives (open, eventDetails)
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
  }, [])

  // Sync with fresh server-supplied props (e.g. after router.refresh())
  useEffect(() => {
    setNotifications(initialNotifications)
    setUnreadCount(initialUnreadCount)
  }, [initialNotifications, initialUnreadCount])

  // Subscribe to Supabase Realtime for INSERT events on notifications filtered by recipient
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const incoming = payload.new as Notification
          setNotifications((prev) => [incoming, ...prev].slice(0, 10))
          setUnreadCount((prev) => prev + 1)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  /** Navigate to the transaction workspace and mark related notifications read */
  const handleNotificationClick = useCallback(
    async (notification: Notification) => {
      setOpen(false)

      if (!notification.is_read) {
        // Optimistic update
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n)),
        )
        setUnreadCount((prev) => Math.max(0, prev - 1))

        // Persist server-side
        await markNotificationsReadAction(userId, notification.transaction_id)
      }

      if (notification.transaction_id) {
        router.push(`/transactions/${notification.transaction_id}`)
      }
    },
    [userId, router],
  )

  /** Mark every visible notification as read */
  const handleMarkAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
    await markNotificationsReadAction(userId, null)
    router.refresh()
  }, [userId, router])

  const displayed = notifications.slice(0, 10)

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        className="relative rounded-md p-2 text-muted-foreground transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground motion-safe:active:scale-[.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
            : 'Notifications'
        }
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0" sideOffset={8}>
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 bg-white!">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-primary [@media(hover:hover)_and_(pointer:fine)]:hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>

        <DropdownMenuSeparator className="m-0" />

        {/* ── List ── */}
        <div className="max-h-[400px] overflow-y-auto bg-white">
          {displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Bell className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
            </div>
          ) : (
            displayed.map((notification, index) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
                isLast={index === displayed.length - 1}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Notification item ────────────────────────────────────────────────────────

interface NotificationItemProps {
  notification: Notification
  onClick: () => void
  isLast: boolean
}

function NotificationItem({ notification, onClick, isLast }: NotificationItemProps) {
  const label =
    EVENT_LABELS[notification.event_type] ??
    notification.event_type.replace(/_/g, ' ')

  return (
    <>
      <button
        onClick={onClick}
        className={`
          w-full px-4 py-3 text-left transition-colors
          [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/60 motion-safe:active:scale-[0.99]
          ${!notification.is_read ? 'bg-primary/5' : ''}
        `}
      >
        <div className="flex items-start gap-3">
          {/* Unread dot */}
          <span
            className={`
              mt-1.5 size-2 shrink-0 rounded-full
              ${!notification.is_read ? 'bg-primary' : 'bg-transparent'}
            `}
            aria-hidden="true"
          />

          <div className="min-w-0 flex-1">
            {/* Event type */}
            <p className="mb-0.5 truncate text-xs font-medium text-muted-foreground">
              {label}
            </p>

            {/* Message */}
            <p className="line-clamp-2 text-sm text-foreground">
              {notification.message}
            </p>

            {/* Timestamp */}
            <p className="mt-1 text-xs text-muted-foreground">
              {timeAgo(notification.created_at)}
            </p>
          </div>
        </div>
      </button>
      {!isLast && <DropdownMenuSeparator className="m-0" />}
    </>
  )
}
