'use client'

import { WifiOff, RefreshCw, CloudUpload, Loader2 } from 'lucide-react'
import { useOfflineSync } from '@/lib/hooks/useOfflineSync'

/**
 * OfflineBanner
 *
 * Renders a sticky top bar that:
 *   - Appears when the browser is offline (WifiOff icon + "You're offline" message)
 *   - Transitions to a "Syncing…" state when back online and the queue is draining
 *   - Shows a "Sync now" button when online with pending items
 *   - Shows a pending count badge so the user knows how many actions are queued
 *
 * Mounts at the top of the AppShell so it's visible on every protected page.
 */
export default function OfflineBanner() {
  const { isOnline, isSyncing, queueCount, triggerSync } = useOfflineSync()

  // Nothing to show when online and queue is empty
  if (isOnline && queueCount === 0 && !isSyncing) return null

  // ── Syncing state ──────────────────────────────────────────────────────────
  if (isSyncing) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-2 bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Syncing your offline changes…
      </div>
    )
  }

  // ── Online but queue has items (reconnected, waiting for user action or
  //    auto-sync running in background) ────────────────────────────────────
  if (isOnline && queueCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-xs font-medium text-white"
      >
        <CloudUpload className="size-3.5 shrink-0" aria-hidden />
        <span>
          {queueCount} action{queueCount !== 1 ? 's' : ''} pending sync
        </span>
        <button
          type="button"
          onClick={triggerSync}
          className="inline-flex items-center gap-1 rounded-md border border-white/30 bg-white/15 px-2.5 py-0.5 text-xs font-semibold transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/25"
        >
          <RefreshCw className="size-3" aria-hidden />
          Sync now
        </button>
      </div>
    )
  }

  // ── Offline ────────────────────────────────────────────────────────────────
  return (
    <div
      role="status"
      aria-live="assertive"
      className="flex items-center justify-center gap-2 bg-foreground px-4 py-2 text-xs font-medium text-background"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      <span>
        You&apos;re offline.
        {queueCount > 0
          ? ` ${queueCount} action${queueCount !== 1 ? 's' : ''} will sync when you reconnect.`
          : ' Changes you make will be saved and synced when you reconnect.'}
      </span>
    </div>
  )
}
