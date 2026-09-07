/**
 * Real Eazybankz adapter — live HTTP client stub.
 *
 * Phase 1–5: this file is a placeholder stub that throws NOT_IMPLEMENTED
 * for every method. It exists so the module-load-time adapter selection
 * in index.ts can reference RealEazybankzAdapter without a compile error.
 *
 * Phase 6: replace this stub with a real HTTP client that calls the live
 * Eazybankz API. All methods should make authenticated HTTP requests to
 * the Eazybankz mirror and return the appropriately typed responses.
 *
 * Design: §Eazybankz Adapter
 * Requirements: 30.3, 30.4
 */

import type {
  EazybankzAdapter,
  EazybankzInvestment,
  EazybankzBalance,
  CreateInvestmentData,
  CreateTransactionData,
} from './adapter.interface'
import { EazybankzError } from './adapter.interface'

// ─── Real adapter (Phase 6 stub) ─────────────────────────────────────────────

/**
 * Placeholder implementation of EazybankzAdapter for the real HTTP integration.
 *
 * Every method throws EazybankzError with code 'NOT_IMPLEMENTED' until
 * Phase 6 replaces this class with a working HTTP client.
 *
 * This is intentionally NOT a singleton — when the real implementation
 * lands it will hold HTTP client state (auth tokens, base URL, etc.)
 * that should not be shared across module instances.
 */
export class RealEazybankzAdapter implements EazybankzAdapter {
  // ── getInvestment ──────────────────────────────────────────────────────────

  async getInvestment(_investmentId: string): Promise<EazybankzInvestment> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }

  // ── getBalance ─────────────────────────────────────────────────────────────

  async getBalance(_accountId: string): Promise<EazybankzBalance> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }

  // ── getAccruedInterest ─────────────────────────────────────────────────────

  async getAccruedInterest(_investmentId: string): Promise<string> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }

  // ── createInvestment ───────────────────────────────────────────────────────

  async createInvestment(_data: CreateInvestmentData): Promise<EazybankzInvestment> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }

  // ── updateInvestment ───────────────────────────────────────────────────────

  async updateInvestment(
    _investmentId: string,
    _data: Partial<CreateInvestmentData>,
  ): Promise<EazybankzInvestment> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }

  // ── createTransaction ──────────────────────────────────────────────────────

  async createTransaction(_data: CreateTransactionData): Promise<{ transactionId: string }> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }

  // ── reverseTransaction ─────────────────────────────────────────────────────

  async reverseTransaction(
    _transactionId: string,
    _reason: string,
  ): Promise<{ reversalId: string }> {
    throw new EazybankzError('NOT_IMPLEMENTED', 'REAL_ADAPTER_STUB')
  }
}
