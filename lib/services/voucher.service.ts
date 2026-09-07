import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoucherListItem {
  id: string
  voucher_number: string
  voucher_type: string
  status: string
  net_amount: string | null
  principal: string | null
  interest: string | null
  transfer_date: string | null
  created_at: string
  transaction_id: string
  transaction_reference: string
  transaction_type: string
  customer_name: string | null
  customer_number: string | null
}

export interface VoucherFilters {
  /** Filter by voucher_type (exact match). */
  voucherType?: string
  /** Filter by voucher status (exact match). */
  status?: string
  /** Filter by voucher created_at >= from (ISO date string, e.g. '2024-01-01'). */
  from?: string
  /** Filter by voucher created_at <= to end-of-day (ISO date string, e.g. '2024-12-31'). */
  to?: string
  /** 1-based page number. Defaults to 1. */
  page?: number
  /** Number of rows per page. Defaults to 25. */
  pageSize?: number
}

export interface VoucherListResult {
  data: VoucherListItem[]
  count: number
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Lists vouchers with optional filters and pagination.
 * Joins treasury_transactions (reference, type) and customers (name, number).
 * Orders by created_at DESC.
 *
 * Requirements: 6.6
 */
export async function listVouchers(filters: VoucherFilters = {}): Promise<VoucherListResult> {
  const supabase = await createClient()

  const page     = filters.page     ?? 1
  const pageSize = filters.pageSize ?? 25
  const offset   = (page - 1) * pageSize

  let query = supabase
    .from('vouchers')
    .select(
      `
      id,
      voucher_number,
      voucher_type,
      status,
      net_amount,
      principal,
      interest,
      transfer_date,
      created_at,
      transaction_id,
      treasury_transactions (
        id,
        transaction_reference,
        transaction_type,
        customers (
          name,
          customer_number
        )
      )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  // ── Apply filters ─────────────────────────────────────────────────────────

  if (filters.voucherType) {
    query = query.eq('voucher_type', filters.voucherType)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
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
  const mapped: VoucherListItem[] = data.map((row) => {
    const r   = row as Record<string, unknown>
    const txJoin = r.treasury_transactions as Record<string, unknown> | null

    // customers is nested inside treasury_transactions
    const custJoin = txJoin?.customers as Record<string, unknown> | null

    return {
      id:                    r.id as string,
      voucher_number:        r.voucher_number as string,
      voucher_type:          r.voucher_type as string,
      status:                r.status as string,
      net_amount:            r.net_amount as string | null,
      principal:             r.principal as string | null,
      interest:              r.interest as string | null,
      transfer_date:         r.transfer_date as string | null,
      created_at:            r.created_at as string,
      transaction_id:        r.transaction_id as string,
      transaction_reference: txJoin?.transaction_reference as string ?? '—',
      transaction_type:      txJoin?.transaction_type as string ?? '—',
      customer_name:         custJoin?.name as string | null ?? null,
      customer_number:       custJoin?.customer_number as string | null ?? null,
    }
  })

  return { data: mapped, count: count ?? 0 }
}
