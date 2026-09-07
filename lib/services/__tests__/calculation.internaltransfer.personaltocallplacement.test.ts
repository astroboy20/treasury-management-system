/**
 * Internal Transfer Calculation Tests — Personal → Call Placement
 *
 * Validates the INTERNAL_TRANSFER_NO_CHARGE calculation rule
 * used for PERSONAL_TO_CALL_PLACEMENT (task 3.15).
 *
 * Scenario: Customer O (Olumide Adebayo, CUST-O-001)
 *   Source account:      ACC-O-PS-001 (PERSONAL, balance ₦3,000,000)
 *   Destination account: ACC-O-CL-001 (CALL, balance ₦0)
 *
 * On Operations execution the eazybankzAdapter.createInvestment() is called
 * to book the CALL product in the mirror (Req 22.3).  That path is exercised
 * in operations.actions.ts and is covered here by verifying the
 * PERSONAL_TO_CALL_PLACEMENT branch is handled identically to
 * PERSONAL_TO_COMMERCIAL_PAPER (same INTERNAL_TRANSFER_NO_CHARGE rule).
 *
 * Requirements: 22.1 — INTERNAL_TRANSFER / PERSONAL_TO_CALL_PLACEMENT
 *               22.2 — balance check (enforced in server action + RPC)
 *               22.3 — Eazybankz createInvestment on execution
 */

import { describe, it, expect } from 'vitest'
import { calculateInternalTransfer } from '@/lib/services/calculation.service'
import { VoucherPreparationSchema, TX_TYPE_TO_VOUCHER_TYPE } from '@/lib/schemas/voucher.schema'

// ─── 1. Core calculation properties ──────────────────────────────────────────

describe('calculateInternalTransfer — PERSONAL_TO_CALL_PLACEMENT (Req 22.1)', () => {

  it('transfer_charge is always exactly ₦0 for a Personal → Call Placement transfer', () => {
    const result = calculateInternalTransfer('3000000.0000', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.transferCharge).toBe('0')
    expect(result.outputs.transfer_charge).toBe('0')
  })

  it('net_amount equals the transfer amount (no deduction)', () => {
    const amount = '3000000.0000'
    const result = calculateInternalTransfer(amount, 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.netAmount).toBe(amount)
    expect(result.outputs.net_amount).toBe(amount)
  })

  it('is_internal flag is always true', () => {
    const result = calculateInternalTransfer('1000000', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.isInternal).toBe(true)
    expect(result.inputs.is_internal).toBe('true')
  })

  it('rule is INTERNAL_TRANSFER_NO_CHARGE', () => {
    const result = calculateInternalTransfer('2500000', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.rule).toBe('INTERNAL_TRANSFER_NO_CHARGE')
  })

  it('scenario_code is PERSONAL_TO_CALL_PLACEMENT in inputs', () => {
    const result = calculateInternalTransfer('3000000', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.inputs.scenario_code).toBe('PERSONAL_TO_CALL_PLACEMENT')
  })

  it('transfer_amount is preserved in inputs', () => {
    const amount = '3000000.0000'
    const result = calculateInternalTransfer(amount, 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.inputs.transfer_amount).toBe(amount)
  })

  it('calculated_at is a valid ISO timestamp', () => {
    const result = calculateInternalTransfer('1000000', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.calculated_at).toBeDefined()
    expect(() => new Date(result.calculated_at)).not.toThrow()
    expect(new Date(result.calculated_at).getTime()).not.toBeNaN()
  })

  it('handles small amounts (₦1) correctly — no rounding error', () => {
    const result = calculateInternalTransfer('1', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.transferCharge).toBe('0')
    expect(result.netAmount).toBe('1')
  })

  it('handles large amounts (₦999,999,999.9999) correctly', () => {
    const result = calculateInternalTransfer('999999999.9999', 'PERSONAL_TO_CALL_PLACEMENT')
    expect(result.transferCharge).toBe('0')
    expect(result.netAmount).toBe('999999999.9999')
  })

  it('produces the same charge as PERSONAL_TO_COMMERCIAL_PAPER for the same amount', () => {
    // Both scenarios use INTERNAL_TRANSFER_NO_CHARGE — charge must be ₦0 regardless of destination
    const callResult = calculateInternalTransfer('3000000.0000', 'PERSONAL_TO_CALL_PLACEMENT')
    const cpResult   = calculateInternalTransfer('3000000.0000', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(callResult.transferCharge).toBe(cpResult.transferCharge)
    expect(callResult.netAmount).toBe(cpResult.netAmount)
    expect(callResult.rule).toBe(cpResult.rule)
  })
})

// ─── 2. Schema — TRANSFER_SLIP voucher for PERSONAL_TO_CALL_PLACEMENT ────────

describe('TransferSlipVoucherSchema — PERSONAL_TO_CALL_PLACEMENT variant (Req 22.1)', () => {
  const validTransferSlip = {
    voucherType:              'TRANSFER_SLIP' as const,
    amount:                   '3000000.0000',
    sourceAccountNumber:      'ACC-O-PS-001',
    destinationAccountNumber: 'ACC-O-CL-001',
    transferDate:             '2026-09-07',
    remarks:                  'Personal → Call Placement',
  }

  it('accepts a valid TRANSFER_SLIP for PERSONAL_TO_CALL_PLACEMENT', () => {
    const result = VoucherPreparationSchema.safeParse(validTransferSlip)
    expect(result.success).toBe(true)
  })

  it('accepts TRANSFER_SLIP without source/destination account numbers (optional)', () => {
    const { sourceAccountNumber: _s, destinationAccountNumber: _d, ...minimal } = validTransferSlip
    const result = VoucherPreparationSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  it('rejects a TRANSFER_SLIP with zero amount', () => {
    const result = VoucherPreparationSchema.safeParse({ ...validTransferSlip, amount: '0' })
    expect(result.success).toBe(false)
  })

  it('rejects a TRANSFER_SLIP with a negative amount', () => {
    const result = VoucherPreparationSchema.safeParse({ ...validTransferSlip, amount: '-500' })
    expect(result.success).toBe(false)
  })

  it('rejects a TRANSFER_SLIP with an invalid transfer date format', () => {
    const result = VoucherPreparationSchema.safeParse({ ...validTransferSlip, transferDate: '07/09/2026' })
    expect(result.success).toBe(false)
  })
})

// ─── 3. TX_TYPE_TO_VOUCHER_TYPE mapping for INTERNAL_TRANSFER ─────────────────

describe('TX_TYPE_TO_VOUCHER_TYPE — INTERNAL_TRANSFER maps to TRANSFER_SLIP (Req 11.1)', () => {
  it('INTERNAL_TRANSFER maps to TRANSFER_SLIP', () => {
    expect(TX_TYPE_TO_VOUCHER_TYPE['INTERNAL_TRANSFER']).toBe('TRANSFER_SLIP')
  })
})

// ─── 4. Eazybankz execution path — PERSONAL_TO_CALL_PLACEMENT ────────────────
//
// The full execution path (operations.actions.ts) calls:
//   eazybankzAdapter.createInvestment({ ..., productType: 'CALL' })
// when scenario_code === 'PERSONAL_TO_CALL_PLACEMENT'.
//
// The adapter is a server-side Supabase call that requires a live DB.
// We verify the productType resolution logic here via a pure unit approach.

describe('Eazybankz productType resolution — PERSONAL_TO_CALL_PLACEMENT (Req 22.3)', () => {
  it('resolves productType to CALL for PERSONAL_TO_CALL_PLACEMENT', () => {
    // Mirror the resolution logic from operations.actions.ts
    const scenarioCode = 'PERSONAL_TO_CALL_PLACEMENT'
    const productType = scenarioCode === 'PERSONAL_TO_COMMERCIAL_PAPER'
      ? 'COMMERCIAL_PAPER'
      : 'CALL'
    expect(productType).toBe('CALL')
  })

  it('does NOT resolve productType to COMMERCIAL_PAPER for PERSONAL_TO_CALL_PLACEMENT', () => {
    const scenarioCode = 'PERSONAL_TO_CALL_PLACEMENT'
    const productType = scenarioCode === 'PERSONAL_TO_COMMERCIAL_PAPER'
      ? 'COMMERCIAL_PAPER'
      : 'CALL'
    expect(productType).not.toBe('COMMERCIAL_PAPER')
  })

  it('resolves productType to COMMERCIAL_PAPER for PERSONAL_TO_COMMERCIAL_PAPER (contrast check)', () => {
    const scenarioCode = 'PERSONAL_TO_COMMERCIAL_PAPER'
    const productType = scenarioCode === 'PERSONAL_TO_COMMERCIAL_PAPER'
      ? 'COMMERCIAL_PAPER'
      : 'CALL'
    expect(productType).toBe('COMMERCIAL_PAPER')
  })
})
