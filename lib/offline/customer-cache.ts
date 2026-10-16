'use client'

/**
 * Lightweight localStorage cache for the customer list.
 *
 * The batch transaction form needs a customer list to function. When the
 * server is reachable the list is passed as a prop (server-fetched). When
 * offline the service worker serves the cached HTML shell but the
 * server-side fetch can't run, so the form falls back to this cache.
 *
 * localStorage is used (not IndexedDB) because:
 *   - The data is small (≤ 500 records of {id, name, customer_number})
 *   - We need synchronous reads on mount to avoid flashing an empty form
 *   - There are no write-ordering requirements
 */

const KEY     = 'treasury:customers:v1'
const MAX_AGE = 24 * 60 * 60 * 1_000 // 1 day in ms

export interface CachedCustomer {
  id: string
  name: string
  customer_number: string
}

interface CacheEntry {
  data: CachedCustomer[]
  savedAt: number
}

/**
 * Persist a fresh customer list received from the server.
 * Call this any time the page loads successfully online.
 */
export function saveCustomerCache(customers: CachedCustomer[]): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CacheEntry = { data: customers, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(entry))
  } catch {
    // Storage quota exceeded or private mode — silently skip
  }
}

/**
 * Read the cached customer list.
 * Returns an empty array if cache is absent or older than MAX_AGE.
 */
export function loadCustomerCache(): CachedCustomer[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.savedAt > MAX_AGE) return []
    return entry.data
  } catch {
    return []
  }
}
