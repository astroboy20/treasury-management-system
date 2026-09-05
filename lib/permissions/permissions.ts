// ============================================================
// Role-to-Permission Map — Greenline Treasury Platform
// ============================================================
// This is the client-side convenience map for UI rendering
// decisions (e.g. showing/hiding buttons).
//
// IMPORTANT: This map is NOT the security boundary.
// The PostgreSQL RPC functions enforce the same rules
// server-side and cannot be bypassed by editing this file.
// ============================================================

export const ROLE_PERMISSIONS = {
  ACCOUNT_OFFICER: [
    'record_confirmation',
    'view_transactions',
    'upload_document',
  ],
  TREASURY_OFFICER: [
    'create_transaction',
    'verify_signature',
    'verify_investment',
    'prepare_voucher',
    'approve_treasury',
    'confirm_completion',
    'view_transactions',
    'upload_document',
    'create_reversal',
  ],
  HEAD_TREASURY: [
    'approve_head_treasury',
    'view_transactions',
  ],
  MIS: [
    'approve_mis',
    'view_transactions',
  ],
  AUDIT: [
    'approve_audit',
    'view_transactions',
    'view_audit_history',
  ],
  MD: [
    'approve_md',
    'view_transactions',
  ],
  OPERATIONS: [
    'execute_transaction',
    'view_transactions',
  ],
  ADMIN: [
    'manage_users',
    'manage_sla_config',
    'view_transactions',
    'view_audit_history',
    'create_transaction',
    'verify_signature',
    'verify_investment',
    'prepare_voucher',
    'approve_treasury',
    'approve_head_treasury',
    'approve_mis',
    'approve_audit',
    'approve_md',
    'execute_transaction',
    'confirm_completion',
    'upload_document',
    'create_reversal',
  ],
  CUSTOMER: [],
} as const

export type Role = keyof typeof ROLE_PERMISSIONS
export type Permission = (typeof ROLE_PERMISSIONS)[Role][number]

/**
 * Returns the human-readable label for a role code.
 */
export const ROLE_LABELS: Record<string, string> = {
  CUSTOMER:         'Customer',
  ACCOUNT_OFFICER:  'Account Officer',
  TREASURY_OFFICER: 'Treasury Officer',
  HEAD_TREASURY:    'Head of Treasury',
  MIS:              'MIS Officer',
  AUDIT:            'Audit Officer',
  MD:               'Managing Director',
  OPERATIONS:       'Operations Officer',
  ADMIN:            'System Administrator',
}

/**
 * Maps a transaction status to the role responsible for
 * the next action. Mirrors the PostgreSQL get_next_action_role() function.
 */
export const STATUS_TO_OWNER: Record<string, string> = {
  INSTRUCTION_RECEIVED:   'Treasury Officer',
  SIGNATURE_VERIFIED:     'Account Officer',
  CUSTOMER_CONFIRMED:     'Treasury Officer',
  INVESTMENT_VERIFIED:    'Treasury Officer',
  VOUCHER_PREPARED:       'Treasury Officer',
  TREASURY_APPROVED:      'Head of Treasury',
  HEAD_TREASURY_APPROVED: 'MIS Officer',
  MIS_APPROVED:           'Audit Officer',
  AUDIT_APPROVED:         'Managing Director',
  MD_APPROVED:            'Operations Officer',
  OPERATIONS_COMPLETED:   'Treasury Officer',
}

/**
 * Maps each approval stage to the role code that can act on it.
 */
export const STAGE_TO_ROLE: Record<string, string> = {
  TREASURY:      'TREASURY_OFFICER',
  HEAD_TREASURY: 'HEAD_TREASURY',
  MIS:           'MIS',
  AUDIT:         'AUDIT',
  MD:            'MD',
}

/**
 * Maps each approval stage to the transaction status required
 * before that stage can act.
 */
export const STAGE_REQUIRED_STATUS: Record<string, string> = {
  TREASURY:      'VOUCHER_PREPARED',
  HEAD_TREASURY: 'TREASURY_APPROVED',
  MIS:           'HEAD_TREASURY_APPROVED',
  AUDIT:         'MIS_APPROVED',
  MD:            'AUDIT_APPROVED',
}
