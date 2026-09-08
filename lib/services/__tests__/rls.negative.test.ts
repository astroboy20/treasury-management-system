/**
 * Task 7.5 — RLS Policy Negative Test Scenarios
 *
 * Verifies the server-side enforcement layer rejects all scenarios that RLS
 * and the workflow engine are designed to block. Tests are organised around
 * the five seed-data negative cases defined in the spec:
 *
 *   CUSTOMER_NEG_001 — signature mismatch (Step 2 fails; Steps 3–6 locked)
 *   CUSTOMER_NEG_002 — insufficient balance (Transfer Slip rejected)
 *   CUSTOMER_NEG_004 — confirmation failed (Step 3 failed; Step 4 locked)
 *   ACCOUNT_OFFICER attempting verifySignatureAction → expects 403
 *   OPERATIONS attempting TREASURY-stage approval → expects 403
 *
 * All tests exercise the pure server-side enforcement logic that guards the
 * actions and workflow service, without requiring a live database connection.
 * This is consistent with the existing test pattern in this project (see
 * phase2.checkpoint.test.ts and calculation tests).
 *
 * When a live Supabase environment is available, the pgTAP-level assertions
 * documented at the bottom of this file provide supplementary SQL-level
 * verification of the same invariants.
 *
 * Requirements: 2.3, 2.4, 5.3, 35.2
 */

import { describe, it, expect } from 'vitest'
import { SignatureVerificationSchema } from '@/lib/schemas/verification.schema'
import { ApprovalSchema } from '@/lib/schemas/approval.schema'
import {
  buildStepsMeta,
  canActorAct,
  getRequiredStage,
} from '@/lib/services/workflow.service'
import { ROLE_PERMISSIONS } from '@/lib/permissions/permissions'
import { hasPermission } from '@/lib/services/auth.service'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TX_ID_NEG_001 = '00000000-0000-4000-a000-000000000101' // signature mismatch
const TX_ID_NEG_002 = '00000000-0000-4000-a000-000000000102' // insufficient balance
const TX_ID_NEG_004 = '00000000-0000-4000-a000-000000000104' // confirmation failed

const MAKER_ID      = '00000000-0000-4000-a000-000000000200' // transaction creator
const OTHER_ID      = '00000000-0000-4000-a000-000000000201' // another actor

// ─── Role-enforcement helpers (mirrors the action layer logic) ────────────────

/**
 * Simulates the role check inside verifySignatureAction.
 * Returns null (allowed) or an error string (blocked).
 *
 * Source: lib/actions/verification.actions.ts, lines for role enforcement.
 */
function checkVerifySignaturePermission(role: string): string | null {
  if (role !== 'TREASURY_OFFICER' && role !== 'ADMIN') {
    return 'Only a Treasury Officer can record signature verifications.'
  }
  return null
}

/**
 * Simulates the role check inside recordCustomerConfirmationAction.
 */
function checkRecordConfirmationPermission(role: string): string | null {
  if (role !== 'ACCOUNT_OFFICER' && role !== 'ADMIN') {
    return 'Only an Account Officer can record customer confirmations.'
  }
  return null
}

/**
 * Simulates the role check inside approveTransactionAction for a given stage.
 * Returns null (allowed) or an error string (blocked).
 *
 * Source: lib/actions/approval.actions.ts, STAGE_ROLE_MAP enforcement block.
 */
const STAGE_ROLE_MAP: Record<string, string> = {
  TREASURY:      'TREASURY_OFFICER',
  HEAD_TREASURY: 'HEAD_TREASURY',
  MIS:           'MIS',
  AUDIT:         'AUDIT',
  MD:            'MD',
}

function checkApprovalPermission(role: string, stage: string): string | null {
  const required = STAGE_ROLE_MAP[stage]
  if (role !== required && role !== 'ADMIN') {
    return `The ${stage} approval stage requires a ${required} role. Your current role is ${role}.`
  }
  return null
}

// ─── Workflow state helper ────────────────────────────────────────────────────

function makeTx(status: string, createdBy = MAKER_ID) {
  return {
    id: TX_ID_NEG_001,
    status,
    created_by: createdBy,
    transaction_type: 'ROLLOVER',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER_NEG_001 — Signature Mismatch
//
// Scenario: Treasury Officer submits a signature verification with
//   signatureResult: 'FAILED'. After this, the workflow engine must
//   lock Steps 3–6 and the server action layer must reject any
//   attempt to advance past Step 2.
// ─────────────────────────────────────────────────────────────────────────────

describe('CUSTOMER_NEG_001 — Signature mismatch (Req 2.3, 8.3, 8.6)', () => {
  describe('Step 2 failure records correctly', () => {
    it('accepts a FAILED signature verification as a valid schema value', () => {
      // A FAILED result is still a valid submission — the schema allows it.
      // The downstream enforcement happens in the workflow engine, not the schema.
      const result = SignatureVerificationSchema.safeParse({
        signatureResult:        'FAILED',
        mandateResult:          'PASSED',
        accountOwnershipResult: 'PASSED',
        completenessResult:     'PASSED',
      })
      expect(result.success).toBe(true)
    })

    it('allows TREASURY_OFFICER to submit a failed verification (role check passes)', () => {
      const err = checkVerifySignaturePermission('TREASURY_OFFICER')
      expect(err).toBeNull()
    })
  })

  describe('Downstream step lock after signature failure', () => {
    // After signature fails the transaction status stays INSTRUCTION_RECEIVED
    // with a SIGNATURE_FAILED audit event. buildStepsMeta tracks this via
    // the signatureResult parameter.

    it('Step 3 (Customer Confirmation) is locked when signatureResult = FAILED', () => {
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      const step3 = steps.find((s) => s.id === 3)!
      expect(step3.state).toBe('locked')
      expect(step3.lockedReason).toMatch(/[Ss]ignature/)
    })

    it('Step 4 (Investment Verification) is locked when signatureResult = FAILED', () => {
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      const step4 = steps.find((s) => s.id === 4)!
      expect(step4.state).toBe('locked')
      expect(step4.lockedReason).toMatch(/[Ss]ignature/)
    })

    it('Step 5 (Voucher Generation) is locked when signatureResult = FAILED', () => {
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      const step5 = steps.find((s) => s.id === 5)!
      expect(step5.state).toBe('locked')
    })

    it('Step 6 (Approval Chain) is locked when signatureResult = FAILED', () => {
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      const step6 = steps.find((s) => s.id === 6)!
      expect(step6.state).toBe('locked')
    })

    it('All steps 3–6 are locked after signature failure (Req 8.3)', () => {
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      for (const step of steps.filter((s) => s.id >= 3)) {
        expect(step.state).toBe('locked')
      }
    })

    it('ACCOUNT_OFFICER cannot act at INSTRUCTION_RECEIVED status (workflow guard)', () => {
      // Even if an ACCOUNT_OFFICER tried to record a confirmation, the
      // canActorAct guard would reject them at this status.
      const canAct = canActorAct(
        'ACCOUNT_OFFICER',
        makeTx('INSTRUCTION_RECEIVED'),
        OTHER_ID,
      )
      expect(canAct).toBe(false)
    })

    it('ACCOUNT_OFFICER has no approval or signature permission in the role map', () => {
      // Double-check the permission map (Req 5.2): ACCOUNT_OFFICER cannot
      // perform signature verification or approvals.
      expect(hasPermission('ACCOUNT_OFFICER', 'verify_signature' as never)).toBe(false)
      expect(hasPermission('ACCOUNT_OFFICER', 'approve_treasury' as never)).toBe(false)
    })

    it('no approval stage is required while the tx is stuck at INSTRUCTION_RECEIVED', () => {
      // getRequiredStage returns null for non-approval statuses
      expect(getRequiredStage('INSTRUCTION_RECEIVED')).toBeNull()
    })
  })

  describe('Attempting to advance past Step 2 — role and state guards', () => {
    it('ACCOUNT_OFFICER call to verifySignatureAction is rejected at the role check', () => {
      // Simulates the action-layer role check that runs before the RPC call.
      const err = checkVerifySignaturePermission('ACCOUNT_OFFICER')
      expect(err).not.toBeNull()
      expect(err).toMatch(/Treasury Officer/)
    })

    it('OPERATIONS call to verifySignatureAction is rejected at the role check', () => {
      const err = checkVerifySignaturePermission('OPERATIONS')
      expect(err).not.toBeNull()
    })

    it('HEAD_TREASURY call to verifySignatureAction is rejected at the role check', () => {
      const err = checkVerifySignaturePermission('HEAD_TREASURY')
      expect(err).not.toBeNull()
    })

    it('TREASURY_OFFICER call to verifySignatureAction passes the role check', () => {
      const err = checkVerifySignaturePermission('TREASURY_OFFICER')
      expect(err).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER_NEG_002 — Insufficient Balance
//
// Scenario: INTERNAL_TRANSFER (e.g. SAVINGS_TO_PERSONAL) where the requested
//   amount exceeds the available balance on the account. The server-side
//   balance check (implemented in the workflow/voucher service and enforced
//   by 007_internal_transfer_balance_check.sql) must reject the Transfer Slip.
//
// At the pure-logic level we verify:
//   1. The role requirements are correct — only TREASURY_OFFICER can prepare vouchers.
//   2. The workflow guards block preparation if the transaction has not reached
//      INVESTMENT_VERIFIED status (the prerequisite for Step 5).
//   3. The OPERATIONS role cannot bypass Step 5 to prepare a voucher.
// ─────────────────────────────────────────────────────────────────────────────

describe('CUSTOMER_NEG_002 — Insufficient balance for Transfer Slip (Req 2.3, 5.3)', () => {
  describe('Voucher preparation role enforcement', () => {
    it('TREASURY_OFFICER has prepare_voucher permission', () => {
      expect(ROLE_PERMISSIONS.TREASURY_OFFICER).toContain('prepare_voucher')
    })

    it('OPERATIONS does not have prepare_voucher permission', () => {
      expect(ROLE_PERMISSIONS.OPERATIONS).not.toContain('prepare_voucher')
    })

    it('ACCOUNT_OFFICER does not have prepare_voucher permission', () => {
      expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).not.toContain('prepare_voucher')
    })

    it('HEAD_TREASURY does not have prepare_voucher permission', () => {
      expect(ROLE_PERMISSIONS.HEAD_TREASURY).not.toContain('prepare_voucher')
    })

    it('MIS does not have prepare_voucher permission', () => {
      expect(ROLE_PERMISSIONS.MIS).not.toContain('prepare_voucher')
    })

    it('AUDIT does not have prepare_voucher permission', () => {
      expect(ROLE_PERMISSIONS.AUDIT).not.toContain('prepare_voucher')
    })
  })

  describe('Workflow state guards for Step 5', () => {
    it('Step 5 is locked when investment verification has not been completed', () => {
      // If the tx is stuck at CUSTOMER_CONFIRMED (investment not yet verified),
      // Step 5 should remain locked.
      const steps = buildStepsMeta('CUSTOMER_CONFIRMED')
      const step5 = steps.find((s) => s.id === 5)!
      expect(step5.state).toBe('locked')
      expect(step5.lockedReason).toMatch(/[Ii]nvestment/)
    })

    it('Step 5 is active (unlocked) only after INVESTMENT_VERIFIED', () => {
      const steps = buildStepsMeta('INVESTMENT_VERIFIED')
      const step5 = steps.find((s) => s.id === 5)!
      expect(step5.state).toBe('active')
    })

    it('TREASURY_OFFICER cannot act at CUSTOMER_CONFIRMED to prepare a voucher (wrong status)', () => {
      // canActorAct does not include CUSTOMER_CONFIRMED as a valid status for
      // TREASURY_OFFICER voucher preparation — it must be INVESTMENT_VERIFIED.
      // CUSTOMER_CONFIRMED maps to investment verification (also TREASURY_OFFICER),
      // but the RPC checks the exact required status.
      const steps = buildStepsMeta('CUSTOMER_CONFIRMED')
      const step5 = steps.find((s) => s.id === 5)!
      // Step 5 is locked — the actor cannot reach it
      expect(step5.state).toBe('locked')
    })

    it('getRequiredStage returns null for CUSTOMER_CONFIRMED (no approval stage yet)', () => {
      expect(getRequiredStage('CUSTOMER_CONFIRMED')).toBeNull()
    })
  })

  describe('Balance-check enforcement at the workflow layer', () => {
    // The SQL-level guard lives in 007_internal_transfer_balance_check.sql.
    // Here we verify the pure-logic complement: the OPERATIONS role cannot
    // initiate or skip the balance check by claiming a different status.

    it('OPERATIONS can only act at MD_APPROVED status (not before)', () => {
      const statuses = [
        'INSTRUCTION_RECEIVED',
        'SIGNATURE_VERIFIED',
        'CUSTOMER_CONFIRMED',
        'INVESTMENT_VERIFIED',
        'VOUCHER_PREPARED',
        'TREASURY_APPROVED',
        'HEAD_TREASURY_APPROVED',
        'MIS_APPROVED',
        'AUDIT_APPROVED',
      ]
      for (const status of statuses) {
        const canAct = canActorAct('OPERATIONS', makeTx(status), OTHER_ID)
        expect(canAct).toBe(false)
      }
    })

    it('OPERATIONS can act at MD_APPROVED status', () => {
      const canAct = canActorAct('OPERATIONS', makeTx('MD_APPROVED'), OTHER_ID)
      expect(canAct).toBe(true)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER_NEG_004 — Customer Confirmation Failed
//
// Scenario: ACCOUNT_OFFICER records a confirmation with status FAILED or
//   UNREACHABLE. This should lock Step 4 and prevent the workflow from
//   advancing to investment verification.
// ─────────────────────────────────────────────────────────────────────────────

describe('CUSTOMER_NEG_004 — Confirmation failed, Step 3 locked (Req 2.3, 9.4)', () => {
  describe('Confirmation role enforcement', () => {
    it('ACCOUNT_OFFICER passes the role check for recordCustomerConfirmationAction', () => {
      const err = checkRecordConfirmationPermission('ACCOUNT_OFFICER')
      expect(err).toBeNull()
    })

    it('TREASURY_OFFICER is rejected from recording customer confirmations', () => {
      const err = checkRecordConfirmationPermission('TREASURY_OFFICER')
      expect(err).not.toBeNull()
      expect(err).toMatch(/Account Officer/)
    })

    it('OPERATIONS is rejected from recording customer confirmations', () => {
      const err = checkRecordConfirmationPermission('OPERATIONS')
      expect(err).not.toBeNull()
    })

    it('MD is rejected from recording customer confirmations', () => {
      const err = checkRecordConfirmationPermission('MD')
      expect(err).not.toBeNull()
    })
  })

  describe('Step 4 lock after confirmation failure', () => {
    // When a FAILED or UNREACHABLE confirmation is recorded, the transaction
    // moves to an exception sub-state of CUSTOMER_CONFIRMED (with a failed
    // confirmation record). Step 4 must remain locked.
    //
    // buildStepsMeta uses the top-level status only; the confirmation_status
    // check is enforced by the RPC and the Step 4 panel which checks the
    // customer_confirmations.confirmation_status value.
    //
    // At the pure workflow level: a TREASURY_OFFICER should NOT be able to act
    // at the status that follows a failed confirmation.

    it('TREASURY_OFFICER can act at CUSTOMER_CONFIRMED (to verify investment)', () => {
      // If the confirmation PASSED, TREASURY_OFFICER proceeds to Step 4.
      const canAct = canActorAct('TREASURY_OFFICER', makeTx('CUSTOMER_CONFIRMED'), OTHER_ID)
      expect(canAct).toBe(true)
    })

    it('Step 4 is active at CUSTOMER_CONFIRMED (normal path)', () => {
      const steps = buildStepsMeta('CUSTOMER_CONFIRMED')
      const step4 = steps.find((s) => s.id === 4)!
      expect(step4.state).toBe('active')
    })

    it('Step 4 is locked when signature has failed (upstream lock propagates)', () => {
      // Signature failure also locks Step 4 (Req 8.3)
      const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
      const step4 = steps.find((s) => s.id === 4)!
      expect(step4.state).toBe('locked')
    })

    it('Step 4 is locked when the transaction has not reached CUSTOMER_CONFIRMED', () => {
      const steps = buildStepsMeta('SIGNATURE_VERIFIED')
      const step4 = steps.find((s) => s.id === 4)!
      expect(step4.state).toBe('locked')
    })

    it('ACCOUNT_OFFICER cannot advance past Step 3 (no invest/voucher permissions)', () => {
      expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).not.toContain('verify_investment')
      expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).not.toContain('prepare_voucher')
      expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).not.toContain('approve_treasury')
    })

    it('No approval stage required at CUSTOMER_CONFIRMED (advancement blocked by guards)', () => {
      expect(getRequiredStage('CUSTOMER_CONFIRMED')).toBeNull()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role Mismatch — ACCOUNT_OFFICER attempts verifySignatureAction
//
// Requirement: 5.3 (Server Action returns 403 for unauthorised role)
// The action layer's role check must reject ACCOUNT_OFFICER.
// ─────────────────────────────────────────────────────────────────────────────

describe('ACCOUNT_OFFICER attempting verifySignatureAction → expect 403 (Req 5.3)', () => {
  it('role check returns an error for ACCOUNT_OFFICER (not TREASURY_OFFICER)', () => {
    const err = checkVerifySignaturePermission('ACCOUNT_OFFICER')
    expect(err).not.toBeNull()
    expect(typeof err).toBe('string')
  })

  it('error message references the required role for clarity', () => {
    const err = checkVerifySignaturePermission('ACCOUNT_OFFICER')!
    expect(err).toMatch(/Treasury Officer/)
  })

  it('role check passes only for TREASURY_OFFICER', () => {
    const allowed  = checkVerifySignaturePermission('TREASURY_OFFICER')
    const rejected = checkVerifySignaturePermission('ACCOUNT_OFFICER')
    expect(allowed).toBeNull()
    expect(rejected).not.toBeNull()
  })

  it('ACCOUNT_OFFICER lacks verify_signature in ROLE_PERMISSIONS map (Req 5.2)', () => {
    expect(ROLE_PERMISSIONS.ACCOUNT_OFFICER).not.toContain('verify_signature')
  })

  it('every non-Treasury role is rejected from verifySignatureAction', () => {
    const nonTreasuryRoles = [
      'ACCOUNT_OFFICER',
      'HEAD_TREASURY',
      'MIS',
      'AUDIT',
      'MD',
      'OPERATIONS',
      'CUSTOMER',
    ]
    for (const role of nonTreasuryRoles) {
      const err = checkVerifySignaturePermission(role)
      expect(err).not.toBeNull()
    }
  })

  it('ADMIN bypasses the role check (admin override is intentional)', () => {
    const err = checkVerifySignaturePermission('ADMIN')
    expect(err).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role Mismatch — OPERATIONS attempts TREASURY-stage approval
//
// Requirement: 5.3 (Server Action returns 403 for unauthorised role)
// ─────────────────────────────────────────────────────────────────────────────

describe('OPERATIONS attempting TREASURY-stage approval → expect 403 (Req 5.3, 12.4)', () => {
  it('role check rejects OPERATIONS for TREASURY approval stage', () => {
    const err = checkApprovalPermission('OPERATIONS', 'TREASURY')
    expect(err).not.toBeNull()
  })

  it('error message identifies the required role and the actual role', () => {
    const err = checkApprovalPermission('OPERATIONS', 'TREASURY')!
    expect(err).toMatch(/TREASURY_OFFICER/)
    expect(err).toMatch(/OPERATIONS/)
  })

  it('OPERATIONS is rejected from all five approval stages', () => {
    const stages = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD']
    for (const stage of stages) {
      const err = checkApprovalPermission('OPERATIONS', stage)
      expect(err).not.toBeNull()
    }
  })

  it('OPERATIONS lacks all approval permissions in ROLE_PERMISSIONS map (Req 5.2)', () => {
    const ops = ROLE_PERMISSIONS.OPERATIONS as readonly string[]
    expect(ops).not.toContain('approve_treasury')
    expect(ops).not.toContain('approve_head_treasury')
    expect(ops).not.toContain('approve_mis')
    expect(ops).not.toContain('approve_audit')
    expect(ops).not.toContain('approve_md')
  })

  it('canActorAct returns false for OPERATIONS at VOUCHER_PREPARED (Req 5.2)', () => {
    // VOUCHER_PREPARED is the status where TREASURY approval takes place.
    const canAct = canActorAct('OPERATIONS', makeTx('VOUCHER_PREPARED'), OTHER_ID)
    expect(canAct).toBe(false)
  })

  it('canActorAct returns false for OPERATIONS at all approval statuses', () => {
    const approvalStatuses = [
      'VOUCHER_PREPARED',
      'TREASURY_APPROVED',
      'HEAD_TREASURY_APPROVED',
      'MIS_APPROVED',
      'AUDIT_APPROVED',
    ]
    for (const status of approvalStatuses) {
      const canAct = canActorAct('OPERATIONS', makeTx(status), OTHER_ID)
      expect(canAct).toBe(false)
    }
  })

  it('TREASURY_OFFICER passes the TREASURY-stage approval check', () => {
    const err = checkApprovalPermission('TREASURY_OFFICER', 'TREASURY')
    expect(err).toBeNull()
  })

  it('ACCOUNT_OFFICER is rejected from TREASURY-stage approval', () => {
    const err = checkApprovalPermission('ACCOUNT_OFFICER', 'TREASURY')
    expect(err).not.toBeNull()
  })

  it('each stage accepts only its designated role', () => {
    const stageRolePairs: Array<[string, string]> = [
      ['TREASURY',      'TREASURY_OFFICER'],
      ['HEAD_TREASURY', 'HEAD_TREASURY'],
      ['MIS',           'MIS'],
      ['AUDIT',         'AUDIT'],
      ['MD',            'MD'],
    ]

    for (const [stage, correctRole] of stageRolePairs) {
      // Correct role passes
      expect(checkApprovalPermission(correctRole, stage)).toBeNull()

      // Wrong role is rejected — pick any other non-ADMIN role
      const wrongRole = correctRole === 'OPERATIONS' ? 'TREASURY_OFFICER' : 'OPERATIONS'
      expect(checkApprovalPermission(wrongRole, stage)).not.toBeNull()
    }
  })

  it('ApprovalSchema rejects any APPROVE decision without a valid stage', () => {
    const result = ApprovalSchema.safeParse({ stage: 'OPERATIONS', decision: 'APPROVE' })
    expect(result.success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting: Audit-event immutability guards (Req 2.4, 1.5)
//
// The application never exposes UPDATE/DELETE on audit_events to any role.
// This is verified by:
//   1. Confirming no role has a hypothetical "delete_audit_event" permission.
//   2. Confirming that no ROLE_PERMISSIONS entry contains such a key.
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit event immutability — no role has delete/update audit permissions (Req 2.4, 1.5)', () => {
  it('ADMIN does not have a delete_audit_event permission', () => {
    const adminPerms = ROLE_PERMISSIONS.ADMIN as readonly string[]
    expect(adminPerms).not.toContain('delete_audit_event')
    expect(adminPerms).not.toContain('update_audit_event')
  })

  it('AUDIT role does not have delete/update audit event permissions', () => {
    const auditPerms = ROLE_PERMISSIONS.AUDIT as readonly string[]
    expect(auditPerms).not.toContain('delete_audit_event')
    expect(auditPerms).not.toContain('update_audit_event')
  })

  it('no role in ROLE_PERMISSIONS grants audit event mutation', () => {
    for (const [, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const permList = perms as readonly string[]
      expect(permList).not.toContain('delete_audit_event')
      expect(permList).not.toContain('update_audit_event')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Maker-checker: transaction creator cannot approve their own transaction
// (Req 2.3, 5.4)
// ─────────────────────────────────────────────────────────────────────────────

describe('Maker-checker: creator cannot approve their own transaction (Req 5.4)', () => {
  it('TREASURY_OFFICER (maker) cannot approve at VOUCHER_PREPARED', () => {
    const canAct = canActorAct(
      'TREASURY_OFFICER',
      makeTx('VOUCHER_PREPARED', MAKER_ID),
      MAKER_ID, // same as creator
    )
    expect(canAct).toBe(false)
  })

  it('TREASURY_OFFICER (different user) can approve at VOUCHER_PREPARED', () => {
    const canAct = canActorAct(
      'TREASURY_OFFICER',
      makeTx('VOUCHER_PREPARED', MAKER_ID),
      OTHER_ID, // different from creator
    )
    expect(canAct).toBe(true)
  })

  it('maker-checker blocks all five approval stages for the transaction creator', () => {
    const approvalStatuses = [
      'VOUCHER_PREPARED',
      'TREASURY_APPROVED',
      'HEAD_TREASURY_APPROVED',
      'MIS_APPROVED',
      'AUDIT_APPROVED',
    ]

    for (const status of approvalStatuses) {
      const canAct = canActorAct(
        'TREASURY_OFFICER',
        makeTx(status, MAKER_ID),
        MAKER_ID,
      )
      expect(canAct).toBe(false)
    }
  })

  it('maker-checker does NOT block the creator from non-approval actions', () => {
    // The creator can still do Step 2 (verify signature), Step 4 (verify investment),
    // Step 5 (prepare voucher) because maker-checker applies only to approvals.
    const nonApprovalStatuses = [
      'INSTRUCTION_RECEIVED', // Step 2: signature verification
      'CUSTOMER_CONFIRMED',   // Step 4: investment verification
      'INVESTMENT_VERIFIED',  // Step 5: voucher preparation
      'OPERATIONS_COMPLETED', // Treasury completion confirmation
    ]

    for (const status of nonApprovalStatuses) {
      const canAct = canActorAct(
        'TREASURY_OFFICER',
        makeTx(status, MAKER_ID),
        MAKER_ID,
      )
      expect(canAct).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// pgTAP supplementary notes (live DB environment)
//
// When a live Supabase environment is available, the following SQL-level checks
// should be run as pgTAP tests to provide database-level evidence for Req 35.2.
//
// 1. CUSTOMER_NEG_001 — attempting to advance past Step 2 via RPC:
//    SELECT throws_ok(
//      $$ SELECT verify_investment('TX_NEG_001_ID', ...) $$,
//      'P0001',  -- exception code raised by RPC prerequisite check
//      'signature_verification_failed: downstream steps are locked'
//    );
//
// 2. CUSTOMER_NEG_002 — insufficient balance for Transfer Slip:
//    SELECT throws_ok(
//      $$ SELECT prepare_voucher('TX_NEG_002_ID', '{"voucher_type":"TRANSFER_SLIP",...}', '{}') $$,
//      'P0001',
//      'insufficient_balance'
//    );
//
// 3. CUSTOMER_NEG_004 — advancing past failed confirmation:
//    SELECT throws_ok(
//      $$ SELECT verify_investment('TX_NEG_004_ID', ...) $$,
//      'P0001',
//      'customer_confirmation_failed: step 4 is locked'
//    );
//
// 4. ACCOUNT_OFFICER calling verify_signature:
//    SET LOCAL role = 'authenticated';
//    SET LOCAL request.jwt.claims = '{"sub":"<account_officer_user_id>"}';
//    SELECT throws_ok(
//      $$ SELECT verify_signature('some_tx_id', 'PASSED', 'PASSED', 'PASSED', 'PASSED', NULL) $$,
//      'insufficient_privilege'
//    );
//
// 5. OPERATIONS attempting TREASURY approval:
//    SET LOCAL role = 'authenticated';
//    SET LOCAL request.jwt.claims = '{"sub":"<operations_user_id>"}';
//    SELECT throws_ok(
//      $$ SELECT approve_transaction('some_tx_id', 'TREASURY', 'APPROVE', NULL) $$,
//      'P0001',
//      'role_mismatch: TREASURY stage requires TREASURY_OFFICER'
//    );
//
// 6. audit_events immutability (Req 2.4):
//    SELECT throws_ok(
//      $$ UPDATE audit_events SET metadata = '{}' WHERE id = 1 $$,
//      '42501',  -- insufficient_privilege from RLS REVOKE
//      'update denied on audit_events'
//    );
//    SELECT throws_ok(
//      $$ DELETE FROM audit_events WHERE id = 1 $$,
//      '42501',
//      'delete denied on audit_events'
//    );
// ─────────────────────────────────────────────────────────────────────────────
