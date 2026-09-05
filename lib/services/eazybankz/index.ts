/**
 * Exports the currently active Eazybankz adapter implementation.
 *
 * Phase 1–5: mock adapter (reads from local investments table).
 * Phase 6:   real HTTP adapter (reads from live Eazybankz API).
 *
 * Swap the export here when the real adapter is ready.
 */

export { mockEazybankzAdapter as eazybankzAdapter } from './mock.adapter'
export type {
  EazybankzAdapter,
  EazybankzInvestment,
  CreateInvestmentInput,
  CreateInvestmentResult,
} from './adapter.interface'
