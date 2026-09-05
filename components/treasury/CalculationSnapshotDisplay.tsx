/**
 * CalculationSnapshotDisplay — renders a `calculation_snapshot` JSONB record.
 *
 * Displays:
 *   - Rule name (human-readable label derived from the CalculationRule code)
 *   - Inputs table (all authoritative numeric inputs used in the calculation)
 *   - Outputs table (all computed results)
 *   - `calculated_at` timestamp (when the server performed the calculation)
 *
 * Used in:
 *   - Approval context panel (Req 13.1) — approvers see the full calculation
 *     backing the voucher so they can make an informed decision.
 *   - Voucher display (Req 26.5) — the immutable snapshot is attached to
 *     every finalised voucher.
 *
 * Design notes:
 *   - The component is purely read-only; it has no interactive controls.
 *   - All monetary values are rendered with ₦ prefix and 2–4 decimal places.
 *   - Rate values (interest_rate, charge_rate) are rendered as percentages.
 *   - The snapshot is the authoritative record of the calculation —
 *     it must never be edited after the voucher is FINALISED.
 *   - Entry animation follows Emil Kowalski principles: opacity + translateY,
 *     220 ms ease-out. `prefers-reduced-motion` skips the transform.
 *
 * Requirements: 13.1, 26.5
 */

import { Calculator } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import type { CalculationRule } from '@/lib/services/calculation.service'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of the `calculation_snapshot` JSONB column persisted in `vouchers`.
 * Mirrors `CalculationSnapshot` from `lib/services/calculation.service.ts`.
 */
export interface CalculationSnapshotData {
  rule: string
  inputs: Record<string, string | number>
  outputs: Record<string, string | number>
  calculated_at: string
}

// ─── Human-readable rule labels ───────────────────────────────────────────────

const RULE_LABELS: Record<CalculationRule, string> = {
  PRE_LIQUIDATION_20_PERCENT:         'Pre-Liquidation — 20% Charge',
  THIRD_PARTY_TRANSFER_0_10_PERCENT:  'Third-Party Transfer — 0.10% Charge',
  ROLLOVER_P_AND_I:                   'Rollover — Principal & Interest',
  ROLLOVER_PRINCIPAL_ONLY:            'Rollover — Principal Only',
  ROLLOVER_PARTIAL_PRINCIPAL:         'Rollover — Partial Principal',
  ROLLOVER_INTEREST_ONLY:             'Rollover — Interest Only',
  MATURITY_TERMINATION:               'Maturity Termination',
  ANNIVERSARY_PAYMENT:                'Anniversary Payment',
}

// ─── Field classification helpers ────────────────────────────────────────────

/**
 * Keys whose values are monetary amounts (formatted as ₦ currency).
 */
const MONETARY_KEYS = new Set([
  'accrued_interest',
  'charge',
  'net_interest',
  'remaining_principal',
  'rebooked_principal',
  'original_principal',
  'requested_payout',
  'principal',
  'interest_due',
  'rollover_amount',
  'interest_paid',
  'principal_rolled',
  'transfer_amount',
  'transfer_charge',
  'net_amount',
  'available_balance',
  'interest',
  'amount',
])

/**
 * Keys whose values are rate/percentage decimals (formatted as a percentage).
 * E.g. "0.200000" → "20.0000%"
 */
const RATE_KEYS = new Set([
  'charge_rate',
  'interest_rate',
  'rate',
])

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatCurrency(val: string | number): string {
  const num = typeof val === 'number' ? val : parseFloat(String(val))
  if (isNaN(num)) return String(val)
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num)
}

function formatRate(val: string | number): string {
  const num = typeof val === 'number' ? val : parseFloat(String(val))
  if (isNaN(num)) return String(val)
  // Store as decimal (e.g. 0.20), display as percentage (e.g. 20.0000%)
  return `${(num * 100).toFixed(4)}%`
}

function formatDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NG', {
      dateStyle: 'long',
      timeStyle: 'medium',
    })
  } catch {
    return iso
  }
}

/**
 * Converts a snake_case key to a human-readable label.
 * e.g. "accrued_interest" → "Accrued Interest"
 */
function toLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Formats a raw snapshot value according to its key classification.
 */
function formatValue(key: string, val: string | number): string {
  if (MONETARY_KEYS.has(key)) return formatCurrency(val)
  if (RATE_KEYS.has(key)) return formatRate(val)
  // Dates (effective_date, maturity_date, new_maturity_date, etc.)
  if (key.endsWith('_date') || key === 'effective_date' || key === 'maturity_date') {
    return String(val)
  }
  // Tenor (days)
  if (key === 'tenor' || key === 'new_tenor' || key === 'frequency_days') {
    return `${val} days`
  }
  return String(val)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SnapshotTable({
  title,
  entries,
}: {
  title: string
  entries: [string, string | number][]
}) {
  if (entries.length === 0) return null

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <table
        className="w-full text-sm"
        aria-label={title}
      >
        <tbody>
          {entries.map(([key, val]) => (
            <tr
              key={key}
              className="border-b border-border/50 last:border-0"
            >
              <td className="py-1.5 pr-4 text-muted-foreground align-top w-1/2">
                {toLabel(key)}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-foreground align-top">
                {formatValue(key, val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── CalculationSnapshotDisplay ───────────────────────────────────────────────

export interface CalculationSnapshotDisplayProps {
  /**
   * The `calculation_snapshot` JSONB value from the `vouchers` table.
   * Accepts `Record<string, unknown>` as it comes directly from the DB query;
   * the component handles nullish/unknown fields gracefully.
   */
  snapshot: Record<string, unknown>
  /**
   * When true, the section header ("Calculation Snapshot") is omitted.
   * Useful when the parent already provides a heading.
   */
  hideHeader?: boolean
}

/**
 * CalculationSnapshotDisplay — read-only view of a voucher's calculation record.
 *
 * Renders the rule name, inputs, outputs, and calculation timestamp from the
 * `calculation_snapshot` JSONB field.  Used on the approval context panel
 * (Req 13.1) and within voucher display components (Req 26.5).
 *
 * The snapshot is immutable once the voucher is FINALISED — this component
 * renders it as a read-only record, never as a form.
 *
 * Entry animation: opacity 0 → 1 with subtle translateY, 220 ms ease-out.
 * `prefers-reduced-motion`: skips translateY, keeps opacity fade.
 */
export function CalculationSnapshotDisplay({
  snapshot,
  hideHeader = false,
}: CalculationSnapshotDisplayProps) {
  // Defensive cast — the JSONB can arrive from multiple query shapes
  const data = snapshot as Partial<CalculationSnapshotData>

  const rule = data.rule as CalculationRule | undefined
  const ruleLabel = rule
    ? (RULE_LABELS[rule] ?? rule.replace(/_/g, ' '))
    : 'Unknown Rule'

  const inputs  = data.inputs  ? Object.entries(data.inputs)  : []
  const outputs = data.outputs ? Object.entries(data.outputs) : []

  const calculatedAt = data.calculated_at

  return (
    <>
      {/* Animation — scoped to this component */}
      <style>{`
        @keyframes snapshotFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .calc-snapshot-root {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>

      <div
        className="calc-snapshot-root space-y-4"
        style={{
          animation: 'snapshotFadeIn 220ms cubic-bezier(0.23, 1, 0.32, 1) both',
        }}
        role="region"
        aria-label="Calculation Snapshot"
      >
        {!hideHeader && (
          <>
            {/* Header */}
            <div className="flex items-center gap-2">
              <Calculator
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
                Calculation Snapshot
              </p>
            </div>
            <Separator />
          </>
        )}

        {/* Rule name */}
        <div>
          <p className="text-xs font-medium text-muted-foreground">Rule Applied</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {ruleLabel}
          </p>
        </div>

        {/* Inputs table */}
        <SnapshotTable title="Inputs" entries={inputs} />

        {/* Outputs table */}
        <SnapshotTable title="Outputs" entries={outputs} />

        {/* Calculated at timestamp */}
        {calculatedAt && (
          <p className="text-xs text-muted-foreground">
            Calculated{' '}
            <time dateTime={calculatedAt}>
              {formatDatetime(calculatedAt)}
            </time>
          </p>
        )}

        {/* Fallback when snapshot is empty / malformed */}
        {!rule && inputs.length === 0 && outputs.length === 0 && (
          <p className="text-sm text-muted-foreground italic">
            No calculation data available.
          </p>
        )}
      </div>
    </>
  )
}

export default CalculationSnapshotDisplay
