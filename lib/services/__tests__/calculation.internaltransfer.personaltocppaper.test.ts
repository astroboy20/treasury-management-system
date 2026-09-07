/**
 * Internal Transfer Calculation Tests — Personal → Commercial Paper
 *
 * Validates the INTERNAL_TRANSFER_NO_CHARGE calculation rule
 * used for PERSONAL_TO_COMMERCIAL_PAPER (task 3.14).
 *
 * Requirements: 22.1 — INTERNAL_TRANSFER / PERSONAL_TO_COMMERCIAL_PAPER
 *               22.2 — balance check (enforced in server action + RPC)
 *               22.3 — Eazybankz createInvestment on execution
 */

import { describe, it, expect } from 'vitest'
import { calculateInternalTransfer } from '@/lib/services/calculation.service'
import { VoucherPreparationSchema, TX_TYPE_TO_VOUCHER_TYPE } from '@/lib/schemas/voucher.schema'

// ─── 1. Core calculation properties ──────────────────────────────────────────

describe('calculateInternalTransfer — PERSONAL_TO_COMMERCIAL_PAPER (Req 22.1)', () => {

  it('transfer_charge is always exactly ₦0 for a Personal → Commercial Paper transfer', () => {
    const result = calculateInternalTransfer('3000000.0000', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.transferCharge).toBe('0')
    expect(result.outputs.transfer_charge).toBe('0')
  })

  it('net_amount equals the transfer amount (no deduction)', () => {
    const amount = '3000000.0000'
    const result = calculateInternalTransfer(amount, 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.netAmount).toBe(amount)
    expect(result.outputs.net_amount).toBe(amount)
  })

  it('is_internal flag is always true', () => {
    const result = calculateInternalTransfer('1000000', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.isInternal).toBe(true)
    expect(result.inputs.is_internal).toBe('true')
  })

  it('rule is INTERNAL_TRANSFER_NO_CHARGE', () => {
    const result = calculateInternalTransfer('2500000', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.rule).toBe('INTERNAL_TRANSFER_NO_CHARGE')
  })

  it('scenario_code is PERSONAL_TO_COMMERCIAL_PAPER in inputs', () => {
    const result = calculateInternalTransfer('3000000', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.inputs.scenario_code).toBe('PERSONAL_TO_COMMERCIAL_PAPER')
  })

  it('transfer_amount is preserved in inputs', () => {
    const amount = '7500000.0000'
    const result = calculateInternalTransfer(amount, 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.inputs.transfer_amount).toBe(amount)
  })

  it('calculated_at is a valid ISO timestamp', () => {
    const result = calculateInternalTransfer('1000000', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.calculated_at).toBeDefined()
    expect(() => new Date(result.calculated_at)).not.toThrow()
    expect(new Date(result.calculated_at).getTime()).not.toBeNaN()
  })

  it('handles small amounts (₦1) correctly — no rounding error', () => {
    const result = calculateInternalTransfer('1', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.transferCharge).toBe('0')
    expect(result.netAmount).toBe('1')
  })

  it('handles large amounts (₦999,999,999.9999) correctly', () => {
    const result = calculateInternalTransfer('999999999.9999', 'PERSONAL_TO_COMMERCIAL_PAPER')
    expect(result.transferCharge).toBe('0')
    expect(result.netAmount).toBe('999999999.9999')
  })
})

// ─── 2. Schema — TRANSFER_SLIP voucher for PERSONAL_TO_COMMERCIAL_PAPER ──────

describe('TransferSlipVoucherSchema — PERSONAL_TO_COMMERCIAL_PAPER variant (Req 22.1)', () => {
  const validTransferSlip = {
    voucherType:              'TRANSFER_SLIP' as const,
    amount:                   '3000000.0000',
    sourceAccountNumber:      'ACC-N-PS-001',
    destinationAccountNumber: 'ACC-N-CP-001',
    transferDate:             '2026-09-07',
    remarks:                  'Personal → Commercial Paper placement',
  }

  it('accepts a valid TRANSFER_SLIP for PERSONAL_TO_COMMERCIAL_PAPER', () => {
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
    const result = VoucherPreparationSchema.safeParse({ ...validTransferSlip, amount: '-1000' })
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
