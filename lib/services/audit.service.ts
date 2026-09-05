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
