'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks the browser's online/offline status.
 *
 * Returns `undefined` until the first effect runs (post-hydration).
 * This eliminates the SSR/hydration flicker: the initial server render
 * produces `undefined`, so no banner is shown until the browser has
 * actually confirmed its network state.
 *
 * Only returns `false` after the `offline` event fires — never on the
 * first render, which prevents the false-offline flash on page load.
 */
export function useNetworkStatus(): boolean | undefined {
  // Start as undefined so the banner renders nothing until hydrated
  const [isOnline, setIsOnline] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    // Set to the real browser value immediately on mount (post-hydration)
    setIsOnline(navigator.onLine)

    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}
