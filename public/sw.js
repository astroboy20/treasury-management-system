/**
 * Treasury App — Offline Service Worker
 *
 * Strategy:
 *   - On install: pre-cache the app shell (the root HTML page).
 *   - On fetch: for same-origin navigation requests, try the network first.
 *     If the network is unreachable, serve the cached shell so the React app
 *     loads and the offline banner / IndexedDB queue take over from there.
 *   - Static assets (JS, CSS, images) use a cache-first strategy so the app
 *     remains usable when offline.
 *   - API calls and Supabase requests are network-only — they will fail
 *     gracefully when offline (server actions return errors that the forms
 *     catch and route to the IndexedDB queue).
 *
 * This deliberately stays minimal — no background sync API (not widely
 * supported), no push notifications. The queue drain is triggered by the
 * online event inside useOfflineSync.ts.
 */

const SHELL_CACHE  = 'treasury-shell-v1'
const ASSET_CACHE  = 'treasury-assets-v1'
const SHELL_URL    = '/'

// ─── Install — pre-cache the app shell ───────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL))
  )
  // Take over immediately without waiting for old tabs to close
  self.skipWaiting()
})

// ─── Activate — clean up old caches ──────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  )
  // Claim all existing clients so the SW applies immediately
  self.clients.claim()
})

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 1. Skip non-GET requests — POST/PUT/DELETE go to the network directly.
  //    Server actions are POST requests; they will fail when offline and the
  //    form components catch the error and enqueue via IndexedDB.
  if (request.method !== 'GET') return

  // 2. Skip cross-origin requests (Supabase, analytics, fonts CDN etc.)
  if (url.origin !== self.location.origin) return

  // 3. Skip Next.js internal requests (_next/webpack-hmr, __nextjs_*)
  if (url.pathname.startsWith('/_next/webpack-hmr')) return
  if (url.pathname.startsWith('/__nextjs')) return

  // 4. Navigation requests (HTML pages) — network-first, fall back to shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a fresh copy of the shell on every successful navigation
          if (response.ok) {
            const clone = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, clone))
          }
          return response
        })
        .catch(() =>
          // Network failed — serve the cached shell so React boots offline
          caches.match(SHELL_URL).then(
            (cached) => cached ?? new Response('Offline', { status: 503 })
          )
        )
    )
    return
  }

  // 5. Next.js static assets (_next/static/*) — cache-first
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached

        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    )
    return
  }

  // 6. Public static files (images, fonts, icons) — cache-first
  if (
    url.pathname.startsWith('/Logo') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|ico|woff2?|ttf)$/)
  ) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached

        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    )
    return
  }

  // 7. Everything else — network only (API routes, Supabase calls)
})
