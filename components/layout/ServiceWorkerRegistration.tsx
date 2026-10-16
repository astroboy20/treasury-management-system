'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker once after hydration.
 *
 * Placed in the root layout so it runs on every page.
 * Only registers in browsers that support SW (all modern browsers do).
 * Silently skips in private/incognito modes where SW is blocked.
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        // Swallow silently — offline still works via the online/offline events;
        // the SW just means the app shell loads instead of the browser error page.
        console.warn('[SW] Registration failed:', err)
      })
  }, [])

  return null
}
