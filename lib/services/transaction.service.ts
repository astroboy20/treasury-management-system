import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionFilters {
  type?: string
  status?: string
  from?: string
  to?: string
  customer?: string
  reference?: string
}

export interface PaginationParams {
  page?: number
  pageSize?: 10 | 25 | 50
}

export interface TransactionListItem {
  id: string
  transaction_reference: string
  transaction_type: string
  status: string
  requested_amount: string
  approved_amount: string | null
  purpose: string
  source_instruction_type: string
  sla_due_at: string | null
  created_at: string
  created_by: string
  customer_id: string
  investment_id: string | null
  customers: { id: string; name: string; customer_number: string } | null
}

export interface TransactionWorkspace {
  transaction: {
    id: string
    transaction_reference: string
    transaction_type: string
    scenario_code: string | null
    status: string
    currency: string
    requested_amount: string
    approved_amount: string | null
    purpose: string
    source_instruction_type: string
    sla_due_at: string | null
    created_by: string
    created_at: string
    updated_at: string
    completed_at: string | null
    customer_id: string
    investment_id: string | null
  }
  customer: {
    id: string
    name: string
    customer_number: string
    registered_phone: string | null
    status: string
  } | null
  investment: {
    id: string
    product_type: string
    principal: string
    interest_rate: string
    accrued_interest: string
    effective_date: string
    maturity_date: string | null
    outstanding_balance: string
    available_amount: string
    status: string
    external_reference: string | null
  } | null
  signatureVerification: {
    id: string
    verified_by: string
    signature_result: string
    mandate_result: string
    account_ownership_result: string
    completeness_result: string
    notes: string | null
    verified_at: string
    verifier?: { full_name: string }
  } | null
  customerConfirmation: {
    id: string
    confirmed_by: string
    confirmation_status: string
    confirmed_amount: string
    confirmed_beneficiary: string | null
    confirmed_purpose: string
    confirmation_date: string
    confirmation_time: string
    notes: string | null
    created_at: string
    confirmer?: { full_name: string }
  } | null
  investmentVerification: {
    id: string
    verified_by: string
    source_system: string
    principal: string
    accrued_interest: string
    interest_rate: string
    effective_date: string
    maturity_date: string | null
    outstanding_balance: string
    available_amount: string
    verified_at: string
    verifier?: { full_name: string }
  } | null
  voucher: {
    id: string
    voucher_number: string
    voucher_type: string
    status: string
    principal: string | null
    interest: string | null
    wht: string | null
    charge: string | null
    net_amount: string | null
    available_balance: string | null
    transfer_date: string | null
    remarks: string | null
    payment_instruction: Record<string, unknown> | null
    calculation_snapshot: Record<string, unknown>
    created_at: string
  } | null
  approvals: Array<{
    id: string
    stage: string
    approver_id: string
    decision: string
    comments: string | null
    approved_at: string
    approver?: { full_name: string }
  }>
  operationsExecution: {
    id: string
    executed_by: string
    execution_status: string
    external_reference: string | null
    execution_notes: string | null
    executed_at: string
  } | null
  documents: Array<{
    id: string
    document_type: string
    storage_path: string
    uploaded_by: string
    created_at: string
  }>
  auditEvents: Array<{
    id: number
    actor_id: string | null
    event_type: string
    from_status: string | null
    to_status: string | null
    metadata: Record<string, unknown>
    created_at: string
    actor?: { full_name: string }
  }>
  createdBy?: { full_name: string }
}

export interface ListTransactionsResult {
  data: TransactionListItem[]
  count: number
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Fetches a single transaction by ID.
 * Returns null if not found or access denied by RLS.
 */
export async function getTransaction(id: string): Promise<TransactionListItem | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('treasury_transactions')
    .select(
      `
      id,
      transaction_reference,
      transaction_type,
      status,
      requested_amount,
      approved_amount,
      purpose,
      source_instruction_type,
      sla_due_at,
      created_at,
      created_by,
      customer_id,
      investment_id,
      customers (
        id,
        name,
        customer_number
      )
    `,
    )
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as unknown as TransactionListItem
}

/**
 * Lists transactions with server-side filtering and pagination.
 * All filters are applied via Supabase query — no client-side filtering.
 */
export async function listTransactions(
  filters: TransactionFilters = {},
  pagination: PaginationParams = {},
): Promise<ListTransactionsResult> {
  const supabase = await createClient()
  const { page = 1, pageSize = 25 } = pagination
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('treasury_transactions')
    .select(
      `
      id,
      transaction_reference,
      transaction_type,
      status,
      requested_amount,
      approved_amount,
      purpose,
      source_instruction_type,
      sla_due_at,
      created_at,
      created_by,
      customer_id,
      investment_id,
      customers (
        id,
        name,
        customer_number
      )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  // Apply filters
  if (filters.type) {
    query = query.eq('transaction_type', filters.type)
  }
  if (filters.status) {
    query = query.eq('status', filters.status)
  }
  if (filters.from) {
    query = query.gte('created_at', filters.from)
  }
  if (filters.to) {
    // Add 1 day to include end date fully
    const toDate = new Date(filters.to)
    toDate.setDate(toDate.getDate() + 1)
    query = query.lt('created_at', toDate.toISOString())
  }
  if (filters.reference) {
    query = query.ilike('transaction_reference', `${filters.reference}%`)
  }

  const { data, error, count } = await query

  if (error) {
    return { data: [], count: 0 }
  }

  return {
    data: (data ?? []) as unknown as TransactionListItem[],
    count: count ?? 0,
  }
}

/**
 * Loads the full transaction workspace: transaction + all step records +
 * approvals + audit events + documents + customer + investment.
 * This is the single data-fetching function for the workspace page.
 */
export async function getTransactionWorkspace(
  transactionId: string,
): Promise<TransactionWorkspace | null> {
  const supabase = await createClient()

  // Load all workspace data in parallel
  const [txResult, sigResult, confResult, invResult, voucherResult, approvalsResult, opsResult, docsResult, auditResult] =
    await Promise.all([
      // Core transaction + customer + investment
      supabase
        .from('treasury_transactions')
        .select(
          `
          id, transaction_reference, transaction_type, scenario_code, status,
          currency, requested_amount, approved_amount, purpose,
          source_instruction_type, sla_due_at, created_by, created_at,
          updated_at, completed_at, customer_id, investment_id,
          customers ( id, name, customer_number, registered_phone, status ),
          investments ( id, product_type, principal, interest_rate, accrued_interest,
            effective_date, maturity_date, outstanding_balance, available_amount,
            status, external_reference ),
          profiles!treasury_transactions_created_by_fkey ( full_name )
        `,
        )
        .eq('id', transactionId)
        .single(),

      // Signature verification
      supabase
        .from('signature_verifications')
        .select(
          `id, verified_by, signature_result, mandate_result, account_ownership_result,
           completeness_result, notes, verified_at,
           profiles!signature_verifications_verified_by_fkey ( full_name )`,
        )
        .eq('transaction_id', transactionId)
        .maybeSingle(),

      // Customer confirmation
      supabase
        .from('customer_confirmations')
        .select(
          `id, confirmed_by, confirmation_status, confirmed_amount, confirmed_beneficiary,
           confirmed_purpose, confirmation_date, confirmation_time, notes, created_at,
           profiles!customer_confirmations_confirmed_by_fkey ( full_name )`,
        )
        .eq('transaction_id', transactionId)
        .maybeSingle(),

      // Investment verification
      supabase
        .from('investment_verifications')
        .select(
          `id, verified_by, source_system, principal, accrued_interest, interest_rate,
           effective_date, maturity_date, outstanding_balance, available_amount, verified_at,
           profiles!investment_verifications_verified_by_fkey ( full_name )`,
        )
        .eq('transaction_id', transactionId)
        .maybeSingle(),

      // Voucher
      supabase
        .from('vouchers')
        .select(
          `id, voucher_number, voucher_type, status, principal, interest, wht, charge,
           net_amount, available_balance, transfer_date, remarks, payment_instruction,
           calculation_snapshot, created_at`,
        )
        .eq('transaction_id', transactionId)
        .maybeSingle(),

      // Approvals
      supabase
        .from('approvals')
        .select(
          `id, stage, approver_id, decision, comments, approved_at,
           profiles!approvals_approver_id_fkey ( full_name )`,
        )
        .eq('transaction_id', transactionId)
        .order('approved_at', { ascending: true }),

      // Operations execution
      supabase
        .from('operations_executions')
        .select('id, executed_by, execution_status, external_reference, execution_notes, executed_at')
        .eq('transaction_id', transactionId)
        .maybeSingle(),

      // Documents
      supabase
        .from('transaction_documents')
        .select('id, document_type, storage_path, uploaded_by, created_at')
        .eq('transaction_id', transactionId)
        .order('created_at', { ascending: true }),

      // Audit events
      supabase
        .from('audit_events')
        .select(
          `id, actor_id, event_type, from_status, to_status, metadata, created_at,
           profiles!audit_events_actor_id_fkey ( full_name )`,
        )
        .eq('transaction_id', transactionId)
        .order('created_at', { ascending: true }),
    ])

  if (txResult.error || !txResult.data) return null

  const tx = txResult.data as Record<string, unknown>

  // Normalise profile joins (Supabase returns as array or object)
  const normaliseProfile = (p: unknown) => {
    if (!p) return undefined
    if (Array.isArray(p)) return p[0] as { full_name: string }
    return p as { full_name: string }
  }

  const normaliseRelated = <T>(r: unknown): T | null => {
    if (!r) return null
    if (Array.isArray(r)) return (r[0] as T) ?? null
    return r as T
  }

  return {
    transaction: {
      id: tx.id as string,
      transaction_reference: tx.transaction_reference as string,
      transaction_type: tx.transaction_type as string,
      scenario_code: tx.scenario_code as string | null,
      status: tx.status as string,
      currency: tx.currency as string,
      requested_amount: tx.requested_amount as string,
      approved_amount: tx.approved_amount as string | null,
      purpose: tx.purpose as string,
      source_instruction_type: tx.source_instruction_type as string,
      sla_due_at: tx.sla_due_at as string | null,
      created_by: tx.created_by as string,
      created_at: tx.created_at as string,
      updated_at: tx.updated_at as string,
      completed_at: tx.completed_at as string | null,
      customer_id: tx.customer_id as string,
      investment_id: tx.investment_id as string | null,
    },
    customer: normaliseRelated(tx.customers),
    investment: normaliseRelated(tx.investments),
    createdBy: normaliseProfile(tx.profiles),
    signatureVerification: sigResult.data
      ? {
          ...sigResult.data,
          verifier: normaliseProfile((sigResult.data as Record<string, unknown>).profiles),
        }
      : null,
    customerConfirmation: confResult.data
      ? {
          ...confResult.data,
          confirmer: normaliseProfile((confResult.data as Record<string, unknown>).profiles),
        }
      : null,
    investmentVerification: invResult.data
      ? {
          ...invResult.data,
          verifier: normaliseProfile((invResult.data as Record<string, unknown>).profiles),
        }
      : null,
    voucher: voucherResult.data as TransactionWorkspace['voucher'],
    approvals: (approvalsResult.data ?? []).map((a) => ({
      ...(a as Record<string, unknown>),
      approver: normaliseProfile((a as Record<string, unknown>).profiles),
    })) as TransactionWorkspace['approvals'],
    operationsExecution: opsResult.data as TransactionWorkspace['operationsExecution'],
    documents: (docsResult.data ?? []) as TransactionWorkspace['documents'],
    auditEvents: (auditResult.data ?? []).map((e) => ({
      ...(e as Record<string, unknown>),
      actor: normaliseProfile((e as Record<string, unknown>).profiles),
    })) as TransactionWorkspace['auditEvents'],
  }
}
