'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Mounts a Supabase Realtime subscription on the `treasury_transactions` table.
 * Any INSERT, UPDATE, or DELETE triggers a server component refresh so the
 * dashboard always reflects current state without a full page reload.
 *
 * This component renders nothing — it is a pure side-effect mount.
 */
export function RealtimeSubscriber() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('treasury-transactions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'treasury_transactions',
        },
        () => {
          router.refresh()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
