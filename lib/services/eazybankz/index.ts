/**
 * Exports the currently active Eazybankz adapter implementation.
 *
 * The active adapter is resolved once at module load time based on
 * the EAZYBANKZ_MODE environment variable:
 *
 *   EAZYBANKZ_MODE=real   → RealEazybankzAdapter  (Phase 6 live HTTP client)
 *   default               → MockEazybankzAdapter  (Phase 1–5 in-memory store)
 *
 * Phase 6: set EAZYBANKZ_MODE=real in the production environment once
 * RealEazybankzAdapter has been fully implemented.
 *
 * Requirements: 30.3, 30.4
 */

import type { EazybankzAdapter } from './adapter.interface'
import { mockEazybankzAdapter } from './mock.adapter'
import { RealEazybankzAdapter } from './real.adapter'

// ─── Runtime adapter selection ────────────────────────────────────────────────

/**
 * The active Eazybankz adapter, typed as the interface so callers are
 * programming to the contract rather than the concrete implementation.
 */
export const eazybankzAdapter: EazybankzAdapter =
  process.env.EAZYBANKZ_MODE === 'real'
    ? new RealEazybankzAdapter()
    : mockEazybankzAdapter

// ─── Re-export types and classes ─────────────────────────────────────────────

export { RealEazybankzAdapter } from './real.adapter'
export {
  EazybankzError,
  type EazybankzAdapter,
  type EazybankzInvestment,
  type EazybankzBalance,
  type CreateInvestmentData,
  type CreateTransactionData,
} from './adapter.interface'
