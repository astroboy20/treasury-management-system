'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { CheckCircle2, ClipboardList, PlayCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { executeTransactionAction } from '@/lib/actions/operations.actions'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Zod schema ───────────────────────────────────────────────────────────────

const ExecutionSchema = z.object({
  executionStatus: z.enum(['SUCCESS', 'FAILED', 'PARTIAL'], {
    required_error: 'Execution status is required.',
  }),
  externalReference: z
    .string()
    .max(200, 'External reference must be 200 characters or fewer.')
    .optional(),
  executionNotes: z
    .string()
    .max(2000, 'Execution notes must be 2 000 characters or fewer.')
    .optional(),
})

type ExecutionFormValues = z.infer<typeof ExecutionSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  SUCCESS: {
    label: 'Success',
    className: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  },
  FAILED: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
  },
  PARTIAL: {
    label: 'Partial',
    className: 'bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200',
  },
}

// ─── Read-only completed view ─────────────────────────────────────────────────

interface CompletedViewProps {
  execution: NonNullable<TransactionWorkspace['operationsExecution']>
}

function CompletedView({ execution }: CompletedViewProps) {
  const config = STATUS_CONFIG[execution.execution_status] ?? {
    label: execution.execution_status,
    className: 'bg-muted text-muted-foreground',
  }

  return (
    <div className="space-y-4">
      {/* Result header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-emerald-600 shrink-0" aria-hidden />
          <span className="text-sm font-medium">Execution recorded</span>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
        >
          {config.label}
        </span>
      </div>

      {/* Details */}
      <dl className="grid gap-3 sm:grid-cols-2 text-sm pl-6">
        <div>
          <dt className="text-xs text-muted-foreground mb-0.5">Executed at</dt>
          <dd className="font-medium">{formatDateTime(execution.executed_at)}</dd>
        </div>

        {execution.external_reference && (
          <div>
            <dt className="text-xs text-muted-foreground mb-0.5">External reference</dt>
            <dd className="font-mono text-xs font-semibold">{execution.external_reference}</dd>
          </div>
        )}

        {execution.execution_notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground mb-0.5">Notes</dt>
            <dd className="whitespace-pre-wrap text-muted-foreground">
              {execution.execution_notes}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface OperationsExecutionPanelProps {
  transactionId: string
  transactionStatus: string
  operationsExecution: TransactionWorkspace['operationsExecution']
  canAct: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Operations Execution Panel — shown in the transaction workspace.
 *
 * Visibility: only rendered when status = 'MD_APPROVED' (or already executed)
 * AND the current user is an OPERATIONS Officer or ADMIN (enforced in the
 * parent workspace page via the `canAct` prop).
 *
 * When an operations_executions record already exists, the panel renders a
 * read-only summary — idempotency guard (Req 14.6).
 *
 * Requirements: 14.3, 14.6, 33.3
 */
export default function OperationsExecutionPanel({
  transactionId,
  transactionStatus,
  operationsExecution,
  canAct,
}: OperationsExecutionPanelProps) {
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ExecutionFormValues>({
    resolver: zodResolver(ExecutionSchema),
    defaultValues: {
      executionStatus: undefined,
      externalReference: '',
      executionNotes: '',
    },
  })

  const notesValue = watch('executionNotes') ?? ''

  // ── Idempotency guard (Req 14.6) ──────────────────────────────────────────
  // An existing execution record means this is already done — show read-only.
  if (operationsExecution) {
    return <CompletedView execution={operationsExecution} />
  }

  // ── Role / status guard ───────────────────────────────────────────────────
  if (!canAct) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <ClipboardList className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        <p className="text-sm text-muted-foreground">
          {transactionStatus === 'MD_APPROVED'
            ? 'Awaiting Operations execution. Only an Operations Officer can act here.'
            : 'This transaction is being processed by Operations.'}
        </p>
      </div>
    )
  }

  // ── Form submit ───────────────────────────────────────────────────────────

  async function onSubmit(values: ExecutionFormValues) {
    setSubmitting(true)

    const result = await executeTransactionAction(transactionId, {
      executionStatus: values.executionStatus,
      externalReference: values.externalReference?.trim() || undefined,
      executionNotes: values.executionNotes?.trim() || undefined,
    })

    setSubmitting(false)

    if (result.success) {
      toast.success('Transaction execution recorded successfully.')
      // Full reload so the server component workspace reflects the new status.
      window.location.reload()
    } else {
      toast.error(result.error ?? 'Failed to record execution. Please try again.')
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5"
      aria-label="Operations execution form"
      noValidate
    >
      {/* Execution status — required (Req 14.3) */}
      <div className="space-y-1.5">
        <Label htmlFor="exec-status" className="text-sm font-medium">
          Execution status <span className="text-destructive" aria-hidden>*</span>
        </Label>
        <Select
          onValueChange={(value) =>
            setValue('executionStatus', value as 'SUCCESS' | 'FAILED' | 'PARTIAL', {
              shouldValidate: true,
            })
          }
          disabled={submitting}
        >
          <SelectTrigger id="exec-status" aria-describedby={errors.executionStatus ? 'exec-status-error' : undefined}>
            <SelectValue placeholder="Select result…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="SUCCESS">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500 inline-block" aria-hidden />
                Success
              </span>
            </SelectItem>
            <SelectItem value="FAILED">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-red-500 inline-block" aria-hidden />
                Failed
              </span>
            </SelectItem>
            <SelectItem value="PARTIAL">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-500 inline-block" aria-hidden />
                Partial
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        {errors.executionStatus && (
          <p id="exec-status-error" className="text-xs text-destructive" role="alert">
            {errors.executionStatus.message}
          </p>
        )}
      </div>

      {/* External reference — optional */}
      <div className="space-y-1.5">
        <Label htmlFor="exec-ref" className="text-sm font-medium">
          External reference
        </Label>
        <Input
          id="exec-ref"
          {...register('externalReference')}
          placeholder="Bank confirmation / transaction ID…"
          maxLength={200}
          disabled={submitting}
          autoComplete="off"
          className="font-mono text-sm"
          aria-describedby={errors.externalReference ? 'exec-ref-error' : undefined}
        />
        {errors.externalReference && (
          <p id="exec-ref-error" className="text-xs text-destructive" role="alert">
            {errors.externalReference.message}
          </p>
        )}
      </div>

      {/* Execution notes — optional */}
      <div className="space-y-1.5">
        <Label htmlFor="exec-notes" className="text-sm font-medium">
          Execution notes
        </Label>
        <Textarea
          id="exec-notes"
          {...register('executionNotes')}
          placeholder="Any relevant remarks about this execution…"
          rows={3}
          maxLength={2000}
          disabled={submitting}
          className="resize-none text-sm"
          aria-describedby={errors.executionNotes ? 'exec-notes-error' : undefined}
        />
        {errors.executionNotes && (
          <p id="exec-notes-error" className="text-xs text-destructive" role="alert">
            {errors.executionNotes.message}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground/70">
          {notesValue.length} / 2 000 characters
        </p>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={submitting} className="gap-2">
          <PlayCircle className="size-4" aria-hidden />
          {submitting ? 'Recording execution…' : 'Record execution'}
        </Button>
        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
          MD Approved — awaiting execution
        </Badge>
      </div>
    </form>
  )
}
