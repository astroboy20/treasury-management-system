'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useNetworkStatus } from './useNetworkStatus'
import { processSyncQueue, type SyncProgress } from '@/lib/offline/sync'
import { getQueueCount } from '@/lib/offline/queue'

export interface OfflineSyncState {
  isOnline:    boolean
  isSyncing:   boolean
  queueCount:  number
  /** Call manually to force a sync attempt (e.g. a "Sync now" button) */
  triggerSync: () => void
}

/**
 * Top-level offline sync hook.
 *
 * - Detects online/offline transitions.
 * - On reconnect, automatically drains the queue via processSyncQueue().
 * - Refreshes the router after a successful sync so server components
 *   re-fetch with the latest DB state.
 * - Exposes queueCount so the UI can show a badge while items are pending.
 */
export function useOfflineSync(): OfflineSyncState {
  const networkStatus = useNetworkStatus()
  // Treat undefined (pre-hydration) as online so nothing shows until confirmed
  const isOnline = networkStatus !== false
  const router     = useRouter()
  const syncingRef = useRef(false)

  const [isSyncing,  setIsSyncing]  = useState(false)
  const [queueCount, setQueueCount] = useState(0)

  // Keep queue count fresh on mount and after every sync
  const refreshQueueCount = useCallback(async () => {
    try {
      const count = await getQueueCount()
      setQueueCount(count)
    } catch {
      // IndexedDB may not be available (SSR, private mode)
    }
  }, [])

  useEffect(() => {
    refreshQueueCount()
  }, [refreshQueueCount])

  // ── Auto-sync when coming back online ──────────────────────────────────────

  const runSync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setIsSyncing(true)

    const count = await getQueueCount().catch(() => 0)
    if (count === 0) {
      syncingRef.current = false
      setIsSyncing(false)
      return
    }

    // Show a persistent toast during the sync
    const toastId = toast.loading(`Syncing ${count} pending action${count !== 1 ? 's' : ''}…`)

    let finalProgress: SyncProgress = { total: count, processed: 0, succeeded: 0, failed: 0 }

    try {
      finalProgress = await processSyncQueue((progress) => {
        toast.loading(
          `Syncing ${progress.processed}/${progress.total}…`,
          { id: toastId },
        )
      })
    } catch (err) {
      console.error('[OfflineSync] Sync error:', err)
    }

    toast.dismiss(toastId)

    if (finalProgress.succeeded > 0) {
      toast.success(
        finalProgress.failed === 0
          ? `Sync complete — ${finalProgress.succeeded} action${finalProgress.succeeded !== 1 ? 's' : ''} applied.`
          : `Sync partial — ${finalProgress.succeeded} applied, ${finalProgress.failed} failed.`,
      )
      // Refresh server components so the page reflects the synced data
      router.refresh()
    }

    if (finalProgress.failed > 0 && finalProgress.succeeded === 0) {
      toast.error(`Sync failed — ${finalProgress.failed} action${finalProgress.failed !== 1 ? 's' : ''} could not be applied. They will retry automatically.`)
    }

    await refreshQueueCount()
    syncingRef.current = false
    setIsSyncing(false)
  }, [router, refreshQueueCount])

  // Trigger sync every time we go from offline → online.
  // wasOnlineRef starts as undefined to match the hook's initial state.
  // We only fire runSync when we see a confirmed false → true transition,
  // never on the initial undefined → true hydration step.
  const wasOnlineRef = useRef<boolean | undefined>(undefined)

  useEffect(() => {
    const wasOnline = wasOnlineRef.current
    wasOnlineRef.current = networkStatus

    // Only sync when we've confirmed an offline→online transition
    // (wasOnline must be an explicit false, not undefined)
    if (wasOnline === false && networkStatus === true) {
      runSync()
    }
  }, [networkStatus, runSync])

  return {
    isOnline,
    isSyncing,
    queueCount,
    triggerSync: runSync,
  }
}
