'use client'

/**
 * Offline action queue backed by IndexedDB.
 *
 * All server actions that mutate transaction state are wrapped here so that
 * when the browser is offline the payload is persisted locally and replayed
 * once connectivity is restored — identical to Google Docs offline mode.
 *
 * Design constraints for this app:
 *   - All mutations go through PostgreSQL RPCs that enforce auth, role checks,
 *     and atomic state transitions server-side.  We queue the *function name +
 *     arguments* — not raw DB writes.
 *   - Idempotency: every RPC has a DB-level unique constraint (e.g. one
 *     signature_verification per transaction).  A queued item that was already
 *     applied before the page refreshed will return an error; we treat that
 *     specific error pattern as "already done" and remove the item from the
 *     queue.
 *   - Step 5 (prepareVoucherAction) runs server-authoritative NUMERIC
 *     calculations.  It is intentionally included in the queue — the user's
 *     form inputs are stored and submitted on reconnect.
 *   - File uploads (documents) are NOT queued — IndexedDB on mobile can
 *     struggle with large blobs.  We surface a "re-upload when online" notice
 *     for those instead.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueuedActionType =
  | 'CREATE_TRANSACTION'
  | 'CREATE_REVERSAL'
  | 'CREATE_TRANSACTION_BATCH'
  | 'VERIFY_SIGNATURE'
  | 'RECORD_CUSTOMER_CONFIRMATION'
  | 'VERIFY_INVESTMENT'
  | 'PREPARE_VOUCHER'
  | 'APPROVE_TRANSACTION'
  | 'EXECUTE_TRANSACTION'
  | 'RECORD_AUDIT_VERIFICATION'

export interface QueuedAction {
  /** Stable random UUID — used as IndexedDB keyPath */
  id: string
  type: QueuedActionType
  /** Serialised arguments for the server action */
  payload: unknown
  createdAt: string
  attempts: number
  /** Retry cap — actions failing more than MAX_ATTEMPTS times are marked failed */
  status: 'pending' | 'syncing' | 'failed'
  errorMessage?: string
}

export type QueuedActionInsert = Omit<QueuedAction, 'id' | 'createdAt' | 'attempts' | 'status'>

// ─── IndexedDB plumbing ───────────────────────────────────────────────────────

const DB_NAME    = 'treasury-offline-queue'
const STORE_NAME = 'actions'
const DB_VERSION = 1
const MAX_ATTEMPTS = 3

let _db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    req.onsuccess = () => {
      _db = req.result
      resolve(_db)
    }

    req.onerror = () => reject(req.error)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a new action to the queue.
 * Returns the auto-generated ID.
 */
export async function enqueue(action: QueuedActionInsert): Promise<string> {
  const db = await openDB()
  const item: QueuedAction = {
    ...action,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(item)
    tx.oncomplete = () => resolve(item.id)
    tx.onerror    = () => reject(tx.error)
  })
}

/**
 * Return all pending items (status !== 'failed' or attempts < MAX_ATTEMPTS).
 * Items are sorted by createdAt ascending to preserve submission order.
 */
export async function getPendingActions(): Promise<QueuedAction[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()

    req.onsuccess = () => {
      const all: QueuedAction[] = req.result
      const pending = all
        .filter((a) => a.status !== 'failed' || a.attempts < MAX_ATTEMPTS)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      resolve(pending)
    }
    req.onerror = () => reject(req.error)
  })
}

/** Return total count of items in the queue (pending + failed), for badge display. */
export async function getQueueCount(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

/** Remove a successfully synced item from the queue. */
export async function removeFromQueue(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

/** Update an item's status + attempt count + optional error message. */
export async function updateQueueItem(
  id: string,
  patch: Partial<Pick<QueuedAction, 'status' | 'attempts' | 'errorMessage'>>,
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const get   = store.get(id)

    get.onsuccess = () => {
      const item: QueuedAction = get.result
      if (!item) { resolve(); return }
      const updated = { ...item, ...patch }
      store.put(updated)
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    }
    get.onerror = () => reject(get.error)
  })
}

/** Clear every item — used after a full successful sync to clean up. */
export async function clearQueue(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
