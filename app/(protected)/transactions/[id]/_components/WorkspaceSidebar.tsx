import { FileText, User, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SlaIndicator } from '@/components/treasury/SlaIndicator'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'
import { STATUS_TO_OWNER } from '@/lib/permissions/permissions'

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorkspaceSidebarProps {
  transaction: TransactionWorkspace['transaction']
  approvals:   TransactionWorkspace['approvals']
  documents:   TransactionWorkspace['documents']
}

// ─── Approval stage constants ─────────────────────────────────────────────────

const APPROVAL_STAGES = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD'] as const

const STAGE_LABELS: Record<string, string> = {
  TREASURY:      'Treasury Officer',
  HEAD_TREASURY: 'Head of Treasury',
  MIS:           'MIS Officer',
  AUDIT:         'Audit Officer',
  MD:            'Managing Director',
}

const STAGE_REQUIRED_STATUS: Record<string, string> = {
  TREASURY:      'VOUCHER_PREPARED',
  HEAD_TREASURY: 'TREASURY_APPROVED',
  MIS:           'HEAD_TREASURY_APPROVED',
  AUDIT:         'MIS_APPROVED',
  MD:            'AUDIT_APPROVED',
}

const STATUS_ORDER = [
  'DRAFT', 'INSTRUCTION_RECEIVED', 'SIGNATURE_VERIFIED', 'CUSTOMER_CONFIRMED',
  'INVESTMENT_VERIFIED', 'VOUCHER_PREPARED', 'TREASURY_APPROVED', 'HEAD_TREASURY_APPROVED',
  'MIS_APPROVED', 'AUDIT_APPROVED', 'MD_APPROVED', 'OPERATIONS_PROCESSING',
  'OPERATIONS_COMPLETED', 'TREASURY_CONFIRMED', 'COMPLETED',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StageState = 'pending' | 'active' | 'approved' | 'returned' | 'rejected'

function getStageState(
  stage: string,
  txStatus: string,
  approvals: TransactionWorkspace['approvals'],
): StageState {
  const approval = approvals.find((a) => a.stage === stage)
  if (approval) {
    if (approval.decision === 'APPROVE') return 'approved'
    if (approval.decision === 'RETURN')  return 'returned'
    if (approval.decision === 'REJECT')  return 'rejected'
  }
  const requiredStatus = STAGE_REQUIRED_STATUS[stage]
  const txIdx  = STATUS_ORDER.indexOf(txStatus)
  const reqIdx = STATUS_ORDER.indexOf(requiredStatus)
  if (txIdx >= reqIdx) return 'active'
  return 'pending'
}

const STAGE_STATE_CONFIG: Record<StageState, { dot: string; text: string }> = {
  pending:  { dot: 'bg-muted-foreground/30', text: 'text-muted-foreground' },
  active:   { dot: 'bg-primary',              text: 'text-foreground font-medium' },
  approved: { dot: 'bg-emerald-500',           text: 'text-emerald-700' },
  returned: { dot: 'bg-amber-500',             text: 'text-amber-700' },
  rejected: { dot: 'bg-red-500',               text: 'text-red-700' },
}

/**
 * Generates a 60-minute signed URL for a document stored in Supabase Storage.
 * Returns null if the client or signing fails — the UI gracefully degrades.
 */
async function getSignedUrl(storagePath: string): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.storage
      .from('transaction-documents')
      .createSignedUrl(storagePath, 60 * 60) // 60-minute expiry per Req 27.3
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}

// ─── Document type label ──────────────────────────────────────────────────────

function documentTypeLabel(raw: string): string {
  return raw
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * WorkspaceSidebar — server component.
 *
 * Displays:
 *   - Current owner (role responsible for the next action)
 *   - SLA indicator (green/amber/red, computed server-side)
 *   - Approval chain summary
 *   - Linked documents with 60-minute signed URL links (per Req 27.3)
 *
 * Requirements: 16.3, 37.3
 */
export default async function WorkspaceSidebar({
  transaction,
  approvals,
  documents,
}: WorkspaceSidebarProps) {
  // Compute "now" server-side to avoid hydration mismatch in SlaIndicator
  const now = Date.now()

  // Generate signed URLs for all documents in parallel (Req 27.3)
  const documentLinks = await Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      signedUrl: await getSignedUrl(doc.storage_path),
    })),
  )

  const nextOwner = STATUS_TO_OWNER[transaction.status]

  return (
    <aside className="flex flex-col gap-5" aria-label="Transaction sidebar">

      {/* ── Current Owner ──────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-background p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Current Owner
        </h2>
        <div className="mt-3 flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
            <User className="size-4 text-primary" aria-hidden />
          </div>
          <span className="text-sm font-medium">
            {nextOwner ?? (
              <span className="italic text-muted-foreground">
                {transaction.status === 'COMPLETED'
                  ? 'Completed'
                  : 'No pending action'}
              </span>
            )}
          </span>
        </div>
      </section>

      {/* ── SLA Status ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-background p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          SLA Status
        </h2>
        <SlaIndicator
          sla_due_at={transaction.sla_due_at}
          status={transaction.status}
          now={now}
          showDueDate
        />
      </section>

      {/* ── Approval Chain ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-background p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Approval Chain
        </h2>
        <ol className="space-y-2.5" aria-label="Approval stages">
          {APPROVAL_STAGES.map((stage) => {
            const state    = getStageState(stage, transaction.status, approvals)
            const approval = approvals.find((a) => a.stage === stage)
            const cfg      = STAGE_STATE_CONFIG[state]

            return (
              <li key={stage} className="flex items-start gap-2.5">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${cfg.dot}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className={`text-xs ${cfg.text}`}>{STAGE_LABELS[stage]}</p>
                  {approval && (
                    <p className="text-[0.65rem] text-muted-foreground">
                      {approval.decision}
                      {approval.approver?.full_name
                        ? ` · ${approval.approver.full_name}`
                        : ''}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {/* ── Documents ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-background p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </h2>
        {documentLinks.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No documents uploaded.
          </p>
        ) : (
          <ul className="space-y-2.5" aria-label="Attached documents">
            {documentLinks.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2">
                <FileText
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {doc.signedUrl ? (
                    <a
                      href={doc.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 truncate text-xs text-primary underline-offset-2 hover:underline"
                      aria-label={`Open ${documentTypeLabel(doc.document_type)} (opens in new tab)`}
                    >
                      <span className="truncate">
                        {documentTypeLabel(doc.document_type)}
                      </span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    <span className="truncate text-xs text-foreground">
                      {documentTypeLabel(doc.document_type)}
                    </span>
                  )}
                  <p className="text-[0.65rem] text-muted-foreground">
                    {new Date(doc.created_at).toLocaleDateString('en-NG', {
                      day:   '2-digit',
                      month: 'short',
                      year:  'numeric',
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

    </aside>
  )
}
