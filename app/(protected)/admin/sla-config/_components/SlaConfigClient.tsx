'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Clock, Pencil, Check, X, Loader2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateSlaConfigAction, type SlaConfigRow } from '@/lib/actions/admin.actions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Human-readable label for each transaction type code. */
const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  ROLLOVER:             'Rollover',
  MATURITY_TERMINATION: 'Maturity Termination',
  PRE_LIQUIDATION:      'Pre-Liquidation',
  ANNIVERSARY_PAYMENT:  'Anniversary Payment',
  THIRD_PARTY_PAYMENT:  'Third-Party Payment',
  INTERNAL_TRANSFER:    'Internal Transfer',
  INFLOW:               'Inflow',
  SAVINGS_FUNDS_OUT:    'Savings Funds-Out',
  CALL_FUNDS_OUT:       'Call Funds-Out',
  CMS_FUNDS_OUT:        'CMS Funds-Out',
  REVERSAL:             'Reversal',
}

/**
 * Returns a colour variant for the SLA badge based on the configured hours.
 * ≤4h → red (tight); 5–8h → amber (standard); >8h → green (relaxed).
 */
function getSlaVariant(hours: number): 'tight' | 'standard' | 'relaxed' {
  if (hours <= 4) return 'tight'
  if (hours <= 8) return 'standard'
  return 'relaxed'
}

function SlaHoursBadge({ hours }: { hours: number }) {
  const variant = getSlaVariant(hours)
  const classMap = {
    tight:    'bg-red-50    text-red-700    hover:bg-red-50',
    standard: 'bg-amber-50  text-amber-700  hover:bg-amber-50',
    relaxed:  'bg-emerald-50 text-emerald-700 hover:bg-emerald-50',
  }
  return (
    <Badge className={classMap[variant]}>
      {hours}h
    </Badge>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ─── Inline editor row ────────────────────────────────────────────────────────

interface RowEditorProps {
  row: SlaConfigRow
  onSaved: (updated: SlaConfigRow) => void
}

function SlaConfigRowEditor({ row, onSaved }: RowEditorProps) {
  const [editing, setEditing]   = useState(false)
  const [value, setValue]       = useState(String(row.sla_hours))
  const [isPending, startTransition] = useTransition()

  function handleEdit() {
    setValue(String(row.sla_hours))
    setEditing(true)
  }

  function handleCancel() {
    setValue(String(row.sla_hours))
    setEditing(false)
  }

  function handleSave() {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed) || parsed < 1 || parsed > 168) {
      toast.error('SLA hours must be a whole number between 1 and 168.')
      return
    }
    if (parsed === row.sla_hours) {
      setEditing(false)
      return
    }

    startTransition(async () => {
      const result = await updateSlaConfigAction(row.id, parsed)
      if (result.success && result.data) {
        onSaved(result.data)
        toast.success(
          `SLA for ${TRANSACTION_TYPE_LABELS[row.transaction_type] ?? row.transaction_type} updated to ${parsed}h.`,
        )
        setEditing(false)
      } else {
        toast.error(result.error ?? 'Failed to update SLA hours.')
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') handleCancel()
  }

  const label = TRANSACTION_TYPE_LABELS[row.transaction_type] ?? row.transaction_type

  return (
    <TableRow className="group border-t border-border transition-colors duration-150 hover:bg-muted/30">
      {/* Transaction type */}
      <TableCell className="px-5 py-4">
        <span className="font-medium">{label}</span>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.transaction_type}</p>
      </TableCell>

      {/* SLA hours — editable inline */}
      <TableCell className="px-5 py-4">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={168}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 w-24 text-sm"
              aria-label={`SLA hours for ${label}`}
              autoFocus
              disabled={isPending}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700"
              aria-label="Save"
              onClick={handleSave}
              disabled={isPending}
            >
              {isPending
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Check className="size-3.5" />
              }
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              aria-label="Cancel"
              onClick={handleCancel}
              disabled={isPending}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <SlaHoursBadge hours={row.sla_hours} />
            <span className="text-sm text-muted-foreground">
              {row.sla_hours === 1 ? '1 hour' : `${row.sla_hours} hours`}
            </span>
          </div>
        )}
      </TableCell>

      {/* Last updated */}
      <TableCell className="px-5 py-4 text-sm text-muted-foreground">
        {formatDate(row.updated_at)}
      </TableCell>

      {/* Actions */}
      <TableCell className="px-5 py-4">
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary focus:opacity-100"
            onClick={handleEdit}
            aria-label={`Edit SLA for ${label}`}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

// ─── SlaConfigClient ──────────────────────────────────────────────────────────

interface Props {
  initialRows: SlaConfigRow[]
}

export function SlaConfigClient({ initialRows }: Props) {
  const [rows, setRows] = useState<SlaConfigRow[]>(initialRows)

  function handleRowSaved(updated: SlaConfigRow) {
    setRows((prev) =>
      prev.map((r) => (r.id === updated.id ? updated : r)),
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-background py-20 text-center">
        <Clock className="mb-3 size-10 text-muted-foreground/40" aria-hidden />
        <p className="text-sm font-medium">No SLA configuration found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Run the database migrations to seed the default SLA configuration.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-background">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transaction type
            </TableHead>
            <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              SLA duration
            </TableHead>
            <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last updated
            </TableHead>
            <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {/* Actions column — no heading */}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <SlaConfigRowEditor key={row.id} row={row} onSaved={handleRowSaved} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
