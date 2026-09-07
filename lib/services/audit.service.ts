import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: number
  transaction_id: string | null
  actor_id: string | null
  event_type: string
  from_status: string | null
  to_status: string | null
  metadata: Record<string, unknown>
  created_at: string
  actor?: { full_name: string } | null
}

export interface AuditEventListItem {
  id: number
  transaction_id: string | null
  actor_id: string | null
  event_type: string
  from_status: string | null
  to_status: string | null
  created_at: string
  actor_full_name: string | null
  transaction_reference: string | null
}

export interface AuditEventFilters {
  reference?: string   // matches treasury_transactions.transaction_reference
  eventType?: string   // matches audit_events.event_type exactly
  actor?: string       // free-text search on profiles.full_name (ilike)
  from?: string        // ISO date string, inclusive
  to?: string          // ISO date string, inclusive
}

export interface AuditEventListResult {
  data: AuditEventListItem[]
  count: number
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Reads all audit events for a transaction in chronological ASC order.
 * Joins the actor profile for display purposes.
 */
export async function getAuditEvents(transactionId: string): Promise<AuditEvent[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('audit_events')
    .select(
      `
      id,
      transaction_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      metadata,
      created_at,
      profiles!audit_events_actor_id_fkey ( full_name )
    `,
    )
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true })

  if (error || !data) return []

  return data.map((row) => {
    const r = row as Record<string, unknown>
    const profileJoin = r.profiles
    let actor: { full_name: string } | null = null
    if (Array.isArray(profileJoin)) {
      actor = (profileJoin[0] as { full_name: string }) ?? null
    } else if (profileJoin && typeof profileJoin === 'object') {
      actor = profileJoin as { full_name: string }
    }

    return {
      id: r.id as number,
      transaction_id: r.transaction_id as string | null,
      actor_id: r.actor_id as string | null,
      event_type: r.event_type as string,
      from_status: r.from_status as string | null,
      to_status: r.to_status as string | null,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      created_at: r.created_at as string,
      actor,
    }
  })
}

/**
 * Lists audit events with optional filters and pagination.
 * Joins profiles (actor name) and treasury_transactions (reference).
 * Orders by created_at DESC.
 */
export async function listAuditEvents(
  filters: AuditEventFilters,
  pagination: { page: number; pageSize: number },
): Promise<AuditEventListResult> {
  const supabase = await createClient()

  const { page, pageSize } = pagination
  const offset = (page - 1) * pageSize

  // ── Resolve transaction IDs from reference filter ─────────────────────────
  let transactionIds: string[] | null = null
  if (filters.reference) {
    const { data: txRows } = await supabase
      .from('treasury_transactions')
      .select('id')
      .ilike('transaction_reference', `%${filters.reference}%`)

    if (!txRows || txRows.length === 0) {
      // No matching transactions — return empty immediately
      return { data: [], count: 0 }
    }
    transactionIds = txRows.map((r: { id: string }) => r.id)
  }

  // ── Resolve actor IDs from actor name filter ──────────────────────────────
  let actorIds: string[] | null = null
  if (filters.actor) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id')
      .ilike('full_name', `%${filters.actor}%`)

    if (!profileRows || profileRows.length === 0) {
      // No matching actors — return empty immediately
      return { data: [], count: 0 }
    }
    actorIds = profileRows.map((r: { id: string }) => r.id)
  }

  // ── Build base query ──────────────────────────────────────────────────────
  let query = supabase
    .from('audit_events')
    .select(
      `
      id,
      transaction_id,
      actor_id,
      event_type,
      from_status,
      to_status,
      created_at,
      profiles!audit_events_actor_id_fkey ( full_name ),
      treasury_transactions ( transaction_reference )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  // ── Apply filters ─────────────────────────────────────────────────────────
  if (transactionIds !== null) {
    query = query.in('transaction_id', transactionIds)
  }

  if (actorIds !== null) {
    query = query.in('actor_id', actorIds)
  }

  if (filters.eventType) {
    query = query.eq('event_type', filters.eventType)
  }

  if (filters.from) {
    query = query.gte('created_at', `${filters.from}T00:00:00Z`)
  }

  if (filters.to) {
    query = query.lte('created_at', `${filters.to}T23:59:59Z`)
  }

  const { data, error, count } = await query

  if (error || !data) return { data: [], count: 0 }

  // ── Map joined rows to flat shape ─────────────────────────────────────────
  const mapped: AuditEventListItem[] = data.map((row) => {
    const r = row as Record<string, unknown>

    // profiles join
    const profileJoin = r.profiles
    let actorFullName: string | null = null
    if (Array.isArray(profileJoin)) {
      actorFullName = (profileJoin[0] as { full_name: string } | undefined)?.full_name ?? null
    } else if (profileJoin && typeof profileJoin === 'object') {
      actorFullName = (profileJoin as { full_name: string }).full_name ?? null
    }

    // treasury_transactions join
    const txJoin = r.treasury_transactions
    let transactionReference: string | null = null
    if (Array.isArray(txJoin)) {
      transactionReference =
        (txJoin[0] as { transaction_reference: string } | undefined)?.transaction_reference ?? null
    } else if (txJoin && typeof txJoin === 'object') {
      transactionReference =
        (txJoin as { transaction_reference: string }).transaction_reference ?? null
    }

    return {
      id: r.id as number,
      transaction_id: r.transaction_id as string | null,
      actor_id: r.actor_id as string | null,
      event_type: r.event_type as string,
      from_status: r.from_status as string | null,
      to_status: r.to_status as string | null,
      created_at: r.created_at as string,
      actor_full_name: actorFullName,
      transaction_reference: transactionReference,
    }
  })

  return { data: mapped, count: count ?? 0 }
}
