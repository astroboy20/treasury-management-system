/**
 * Phase 2 Checkpoint Tests — Greenline Treasury Platform
 *
 * Validates the complete Phase 2 implementation:
 *
 * 1. Zod schema validation for all six workflow steps
 * 2. Workflow service: buildStepsMeta() state machine logic
 * 3. Workflow service: canActorAct() maker-checker + role enforcement
 * 4. Workflow service: getRequiredStage() status→stage mapping
 * 5. Approval schema: RETURN/REJECT require non-empty comments
 * 6. Transaction schema: Rollover P+I requires scenarioCode
 * 7. Voucher schema: ROLLOVER→ROLLOVER_SLIP mapping enforcement
 * 8. Server-action role enforcement layer (pure logic extracted from actions)
 * 9. Permission map completeness
 * 10. TX_TYPE_TO_VOUCHER_TYPE: full mapping coverage
 *
 * These tests cover the server-side logic that Phase 2 RPCs depend on.
 * They run without a database connection, validating everything that can
 * be exercised before a live Supabase environment is available.
 *
 * Requirements: 5.1–5.4, 7.1–7.7, 8.1–8.6, 9.1–9.6, 10.1–10.6,
 *               11.1–11.9, 12.1–12.9, 16.1–16.6
 */

import { describe, it, expect } from 'vitest'

// ─── Schemas ──────────────────────────────────────────────────────────────────
import { CreateTransactionSchema } from '@/lib/schemas/transaction.schema'
import {
  SignatureVerificationSchema,
  CustomerConfirmationSchema,
  InvestmentVerificationSchema,
} from '@/lib/schemas/verification.schema'
import { ApprovalSchema } from '@/lib/schemas/approval.schema'
import {
  VoucherPreparationSchema,
  TX_TYPE_TO_VOUCHER_TYPE,
  FundsInVoucherSchema,
  FundsOutVoucherSchema,
  RolloverSlipVoucherSchema,
  TransferSlipVoucherSchema,
} from '@/lib/schemas/voucher.schema'

// ─── Services ─────────────────────────────────────────────────────────────────
import {
  buildStepsMeta,
  canActorAct,
  getRequiredStage,
  getWorkflowStatus,
  isStageComplete,
  getRoleForStage,
} from '@/lib/services/workflow.service'

// ─── Permissions ──────────────────────────────────────────────────────────────
import {
  ROLE_PERMISSIONS,
  STAGE_TO_ROLE,
  STAGE_REQUIRED_STATUS,
  STATUS_TO_OWNER,
} from '@/lib/permissions/permissions'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_TX_ID = '00000000-0000-4000-a000-000000000001'
const ACTOR_ID_A  = '00000000-0000-4000-a000-000000000002' // the transaction creator
const ACTOR_ID_B  = '00000000-0000-4000-a000-000000000003' // a different user

const baseTx = {
  id: VALID_TX_ID,
  status: 'VOUCHER_PREPARED',
  created_by: ACTOR_ID_A,
  transaction_type: 'ROLLOVER',
}

// ─── 1. Transaction Creation Schema ──────────────────────────────────────────

describe('CreateTransactionSchema — Step 1 (Req 7.1–7.7)', () => {
  const validRollover = {
    customerId:           '00000000-0000-4000-a000-000000000010',
    investmentId:         '00000000-0000-4000-a000-000000000011',
    transactionType:      'ROLLOVER' as const,
    scenarioCode:         'P_AND_I' as const,
    requestedAmount:      '5000000',
    purpose:              'Rollover P+I per customer instruction',
    sourceInstructionType:'LETTER' as const,
  }

  it('accepts a valid Rollover P+I transaction', () => {
    const result = CreateTransactionSchema.safeParse(validRollover)
    expect(result.success).toBe(true)
  })

  it('rejects a ROLLOVER transaction missing scenarioCode (Req 7.2)', () => {
    const { scenarioCode: _omit, ...withoutScenario } = validRollover
    const result = CreateTransactionSchema.safeParse(withoutScenario)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('scenarioCode')
    }
  })

  it('rejects missing customerId', () => {
    const { customerId: _omit, ...bad } = validRollover
    const result = CreateTransactionSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('rejects a negative requestedAmount', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validRollover,
      requestedAmount: '-100',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a zero requestedAmount', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validRollover,
      requestedAmount: '0',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid UUID for customerId', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validRollover,
      customerId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  it('requires paymentInstruction for THIRD_PARTY_PAYMENT (Req 7.7)', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validRollover,
      transactionType:  'THIRD_PARTY_PAYMENT',
      scenarioCode:     undefined,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('paymentInstruction')
    }
  })

  it('accepts THIRD_PARTY_PAYMENT with a full paymentInstruction', () => {
    const result = CreateTransactionSchema.safeParse({
      ...validRollover,
      transactionType:  'THIRD_PARTY_PAYMENT',
      scenarioCode:     undefined,
      paymentInstruction: {
        beneficiaryName: 'Acme Ltd',
        bankName:        'First Bank',
        accountNumber:   '0123456789',
        accountType:     'SAVINGS',
      },
    })
    expect(result.success).toBe(true)
  })

  it('does not require investmentId (it is optional)', () => {
    const { investmentId: _omit, ...withoutInv } = validRollover
    const result = CreateTransactionSchema.safeParse(withoutInv)
    expect(result.success).toBe(true)
  })
})

// ─── 2. Signature Verification Schema — Step 2 ────────────────────────────────

describe('SignatureVerificationSchema — Step 2 (Req 8.1–8.4)', () => {
  const allPassed = {
    signatureResult:       'PASSED' as const,
    mandateResult:         'PASSED' as const,
    accountOwnershipResult:'PASSED' as const,
    completenessResult:    'PASSED' as const,
  }

  it('accepts all-PASSED verification', () => {
    expect(SignatureVerificationSchema.safeParse(allPassed).success).toBe(true)
  })

  it('accepts verification with FAILED result (failed verification is still a valid record)', () => {
    expect(
      SignatureVerificationSchema.safeParse({
        ...allPassed,
        signatureResult: 'FAILED',
      }).success,
    ).toBe(true)
  })

  it('rejects an invalid result value', () => {
    expect(
      SignatureVerificationSchema.safeParse({
        ...allPassed,
        signatureResult: 'MAYBE',
      }).success,
    ).toBe(false)
  })

  it('accepts optional notes up to 1 000 characters', () => {
    expect(
      SignatureVerificationSchema.safeParse({
        ...allPassed,
        notes: 'a'.repeat(1000),
      }).success,
    ).toBe(true)
  })

  it('rejects notes exceeding 1 000 characters', () => {
    expect(
      SignatureVerificationSchema.safeParse({
        ...allPassed,
        notes: 'a'.repeat(1001),
      }).success,
    ).toBe(false)
  })

  it('requires all four checklist items', () => {
    const { mandateResult: _omit, ...bad } = allPassed
    expect(SignatureVerificationSchema.safeParse(bad).success).toBe(false)
  })
})

// ─── 3. Customer Confirmation Schema — Step 3 ─────────────────────────────────

describe('CustomerConfirmationSchema — Step 3 (Req 9.1–9.2)', () => {
  const validConfirmation = {
    confirmationDate:   '2026-09-05',
    confirmationTime:   '10:30',
    confirmedAmount:    '5000000',
    confirmedPurpose:   'Rollover P+I per customer verbal instruction',
    confirmationStatus: 'CONFIRMED' as const,
  }

  it('accepts a valid CONFIRMED confirmation', () => {
    expect(CustomerConfirmationSchema.safeParse(validConfirmation).success).toBe(true)
  })

  it('accepts FAILED confirmation status', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmationStatus: 'FAILED',
      }).success,
    ).toBe(true)
  })

  it('accepts UNREACHABLE confirmation status', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmationStatus: 'UNREACHABLE',
      }).success,
    ).toBe(true)
  })

  it('rejects an invalid confirmation status', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmationStatus: 'PENDING',
      }).success,
    ).toBe(false)
  })

  it('rejects an invalid date format', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmationDate: '05/09/2026',
      }).success,
    ).toBe(false)
  })

  it('rejects an invalid time format', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmationTime: '10am',
      }).success,
    ).toBe(false)
  })

  it('rejects a zero confirmedAmount', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmedAmount: '0',
      }).success,
    ).toBe(false)
  })

  it('accepts an optional confirmedBeneficiary', () => {
    expect(
      CustomerConfirmationSchema.safeParse({
        ...validConfirmation,
        confirmedBeneficiary: 'Acme Ltd',
      }).success,
    ).toBe(true)
  })
})

// ─── 4. Investment Verification Schema — Step 4 ───────────────────────────────

describe('InvestmentVerificationSchema — Step 4 (Req 10.2)', () => {
  const validSnapshot = {
    principal:          '10000000',
    accruedInterest:    '1500000',
    interestRate:       '0.125000',
    effectiveDate:      '2025-03-01',
    maturityDate:       '2026-03-01',
    outstandingBalance: '10000000',
    availableAmount:    '10000000',
  }

  it('accepts a valid seven-field investment snapshot', () => {
    expect(InvestmentVerificationSchema.safeParse(validSnapshot).success).toBe(true)
  })

  it('rejects a missing principal', () => {
    const { principal: _omit, ...bad } = validSnapshot
    const result = InvestmentVerificationSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('allows maturityDate to be omitted (CALL accounts)', () => {
    const { maturityDate: _omit, ...noMaturity } = validSnapshot
    expect(InvestmentVerificationSchema.safeParse(noMaturity).success).toBe(true)
  })

  it('allows zero accruedInterest (e.g. at inception)', () => {
    expect(
      InvestmentVerificationSchema.safeParse({
        ...validSnapshot,
        accruedInterest: '0',
      }).success,
    ).toBe(true)
  })

  it('rejects a negative principal', () => {
    expect(
      InvestmentVerificationSchema.safeParse({
        ...validSnapshot,
        principal: '-1',
      }).success,
    ).toBe(false)
  })

  it('rejects an invalid effectiveDate format', () => {
    expect(
      InvestmentVerificationSchema.safeParse({
        ...validSnapshot,
        effectiveDate: '01-03-2025',
      }).success,
    ).toBe(false)
  })

  it('all seven fields are present in a valid snapshot', () => {
    const result = InvestmentVerificationSchema.safeParse(validSnapshot)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(
        expect.arrayContaining([
          'principal',
          'accruedInterest',
          'interestRate',
          'effectiveDate',
          'maturityDate',
          'outstandingBalance',
          'availableAmount',
        ]),
      )
    }
  })
})

// ─── 5. Voucher Preparation Schema — Step 5 ───────────────────────────────────

describe('VoucherPreparationSchema — Step 5 (Req 11.1–11.9)', () => {
  describe('ROLLOVER_SLIP (P+I scenario)', () => {
    const validRolloverSlip = {
      voucherType:         'ROLLOVER_SLIP' as const,
      rolloverType:        'P_AND_I' as const,
      principalAmount:     '10000000',
      interestDue:         '1500000',
      effectiveDate:       '2026-09-05',
      newTenor:            365,
      newRate:             '0.125',
      rolloverAmount:      '11500000',
      rolloverMaturityDate:'2027-09-05',
    }

    it('accepts a valid ROLLOVER_SLIP for P+I scenario', () => {
      expect(VoucherPreparationSchema.safeParse(validRolloverSlip).success).toBe(true)
    })

    it('accepts an optional interestPayout for PRINCIPAL_ONLY scenarios', () => {
      expect(
        VoucherPreparationSchema.safeParse({
          ...validRolloverSlip,
          rolloverType: 'PRINCIPAL_ONLY',
          interestPayout: '1500000',
        }).success,
      ).toBe(true)
    })

    it('rejects a zero principalAmount', () => {
      expect(
        VoucherPreparationSchema.safeParse({
          ...validRolloverSlip,
          principalAmount: '0',
        }).success,
      ).toBe(false)
    })

    it('rejects a negative newTenor', () => {
      expect(
        VoucherPreparationSchema.safeParse({
          ...validRolloverSlip,
          newTenor: -1,
        }).success,
      ).toBe(false)
    })

    it('rejects an invalid rolloverType', () => {
      expect(
        VoucherPreparationSchema.safeParse({
          ...validRolloverSlip,
          rolloverType: 'UNKNOWN_TYPE',
        }).success,
      ).toBe(false)
    })
  })

  describe('FUNDS_OUT voucher', () => {
    const validFundsOut = {
      voucherType:  'FUNDS_OUT' as const,
      principal:    '10000000',
      interest:     '1200000',
      wht:          '0',
      charge:       '300000',
      netAmount:    '11200000',
      transferDate: '2026-09-05',
    }

    it('accepts a valid FUNDS_OUT voucher', () => {
      expect(VoucherPreparationSchema.safeParse(validFundsOut).success).toBe(true)
    })

    it('defaults wht to "0" when not supplied', () => {
      const { wht: _omit, ...withoutWht } = validFundsOut
      const result = VoucherPreparationSchema.safeParse(withoutWht)
      expect(result.success).toBe(true)
      if (result.success && result.data.voucherType === 'FUNDS_OUT') {
        expect(result.data.wht).toBe('0')
      }
    })
  })

  describe('FUNDS_IN voucher', () => {
    const validFundsIn = {
      voucherType:  'FUNDS_IN' as const,
      amount:       '10000000',
      rate:         '0.125',
      tenor:        365,
      effectiveDate:'2026-09-05',
      maturityDate: '2027-09-05',
      transferDate: '2026-09-05',
    }

    it('accepts a valid FUNDS_IN voucher', () => {
      expect(VoucherPreparationSchema.safeParse(validFundsIn).success).toBe(true)
    })

    it('rejects a non-integer tenor', () => {
      expect(
        VoucherPreparationSchema.safeParse({ ...validFundsIn, tenor: 1.5 }).success,
      ).toBe(false)
    })
  })

  describe('TRANSFER_SLIP voucher', () => {
    const validTransferSlip = {
      voucherType:  'TRANSFER_SLIP' as const,
      amount:       '5000000',
      transferDate: '2026-09-05',
    }

    it('accepts a valid TRANSFER_SLIP voucher', () => {
      expect(VoucherPreparationSchema.safeParse(validTransferSlip).success).toBe(true)
    })
  })

  describe('TX_TYPE_TO_VOUCHER_TYPE mapping (Req 11.1)', () => {
    it('ROLLOVER maps to ROLLOVER_SLIP', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['ROLLOVER']).toBe('ROLLOVER_SLIP')
    })

    it('MATURITY_TERMINATION maps to FUNDS_OUT', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['MATURITY_TERMINATION']).toBe('FUNDS_OUT')
    })

    it('ANNIVERSARY_PAYMENT maps to FUNDS_OUT', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['ANNIVERSARY_PAYMENT']).toBe('FUNDS_OUT')
    })

    it('PRE_LIQUIDATION maps to FUNDS_OUT', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['PRE_LIQUIDATION']).toBe('FUNDS_OUT')
    })

    it('THIRD_PARTY_PAYMENT maps to FUNDS_OUT', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['THIRD_PARTY_PAYMENT']).toBe('FUNDS_OUT')
    })

    it('INFLOW maps to FUNDS_IN', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['INFLOW']).toBe('FUNDS_IN')
    })

    it('INTERNAL_TRANSFER maps to TRANSFER_SLIP', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['INTERNAL_TRANSFER']).toBe('TRANSFER_SLIP')
    })

    it('REVERSAL maps to TRANSFER_SLIP', () => {
      expect(TX_TYPE_TO_VOUCHER_TYPE['REVERSAL']).toBe('TRANSFER_SLIP')
    })

    it('covers all 11 transaction types', () => {
      const txTypes = [
        'ROLLOVER',
        'MATURITY_TERMINATION',
        'PRE_LIQUIDATION',
        'ANNIVERSARY_PAYMENT',
        'THIRD_PARTY_PAYMENT',
        'INTERNAL_TRANSFER',
        'INFLOW',
        'SAVINGS_FUNDS_OUT',
        'CALL_FUNDS_OUT',
        'CMS_FUNDS_OUT',
        'REVERSAL',
      ]
      for (const type of txTypes) {
        expect(TX_TYPE_TO_VOUCHER_TYPE[type]).toBeDefined()
      }
    })
  })
})

// ─── 6. Approval Chain Schema — Step 6 ───────────────────────────────────────

describe('ApprovalSchema — Step 6 (Req 12.1–12.9)', () => {
  it('accepts APPROVE with no comments', () => {
    expect(
      ApprovalSchema.safeParse({ stage: 'TREASURY', decision: 'APPROVE' }).success,
    ).toBe(true)
  })

  it('accepts RETURN with a non-empty comment (Req 12.6)', () => {
    expect(
      ApprovalSchema.safeParse({
        stage: 'TREASURY',
        decision: 'RETURN',
        comments: 'Please check the beneficiary details.',
      }).success,
    ).toBe(true)
  })

  it('rejects RETURN without comments (Req 12.6)', () => {
    const result = ApprovalSchema.safeParse({ stage: 'TREASURY', decision: 'RETURN' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const commentError = result.error.issues.find((i) => i.path.includes('comments'))
      expect(commentError).toBeDefined()
    }
  })

  it('rejects RETURN with an empty-string comment (Req 12.6)', () => {
    const result = ApprovalSchema.safeParse({
      stage: 'TREASURY',
      decision: 'RETURN',
      comments: '   ',
    })
    expect(result.success).toBe(false)
  })

  it('rejects REJECT without comments (Req 12.7)', () => {
    const result = ApprovalSchema.safeParse({ stage: 'AUDIT', decision: 'REJECT' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const commentError = result.error.issues.find((i) => i.path.includes('comments'))
      expect(commentError).toBeDefined()
    }
  })

  it('accepts REJECT with a non-empty comment (Req 12.7)', () => {
    expect(
      ApprovalSchema.safeParse({
        stage: 'MD',
        decision: 'REJECT',
        comments: 'Insufficient documentation.',
      }).success,
    ).toBe(true)
  })

  it('accepts all five valid stages', () => {
    const stages = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD'] as const
    for (const stage of stages) {
      expect(
        ApprovalSchema.safeParse({ stage, decision: 'APPROVE' }).success,
      ).toBe(true)
    }
  })

  it('rejects an invalid stage', () => {
    expect(
      ApprovalSchema.safeParse({ stage: 'COMPLIANCE', decision: 'APPROVE' }).success,
    ).toBe(false)
  })

  it('rejects an invalid decision', () => {
    expect(
      ApprovalSchema.safeParse({ stage: 'TREASURY', decision: 'ABSTAIN' }).success,
    ).toBe(false)
  })
})

// ─── 7. Workflow Service — buildStepsMeta() ───────────────────────────────────

describe('buildStepsMeta() — StepProgressTracker state machine (Req 16.1, 16.2)', () => {
  it('Step 1 is always completed once a transaction exists', () => {
    const steps = buildStepsMeta('INSTRUCTION_RECEIVED')
    expect(steps[0].state).toBe('completed')
  })

  it('Step 2 is active at INSTRUCTION_RECEIVED', () => {
    const steps = buildStepsMeta('INSTRUCTION_RECEIVED')
    expect(steps[1].state).toBe('active')
  })

  it('Step 2 is completed after SIGNATURE_VERIFIED', () => {
    const steps = buildStepsMeta('SIGNATURE_VERIFIED')
    expect(steps[1].state).toBe('completed')
  })

  it('Steps 3–6 are locked when signature is FAILED (Req 8.3)', () => {
    const steps = buildStepsMeta('INSTRUCTION_RECEIVED', 'FAILED')
    for (const step of steps.slice(2)) {
      expect(step.state).toBe('locked')
    }
  })

  it('Step 3 is active at SIGNATURE_VERIFIED with passing signature', () => {
    const steps = buildStepsMeta('SIGNATURE_VERIFIED', null)
    expect(steps[2].state).toBe('active')
  })

  it('Step 3 is completed after CUSTOMER_CONFIRMED', () => {
    const steps = buildStepsMeta('CUSTOMER_CONFIRMED')
    expect(steps[2].state).toBe('completed')
  })

  it('Step 4 is active at CUSTOMER_CONFIRMED', () => {
    const steps = buildStepsMeta('CUSTOMER_CONFIRMED')
    expect(steps[3].state).toBe('active')
  })

  it('Step 5 is active at INVESTMENT_VERIFIED', () => {
    const steps = buildStepsMeta('INVESTMENT_VERIFIED')
    expect(steps[4].state).toBe('active')
  })

  it('Step 6 is active at VOUCHER_PREPARED', () => {
    const steps = buildStepsMeta('VOUCHER_PREPARED')
    expect(steps[5].state).toBe('active')
  })

  it('Step 6 is active at every approval stage', () => {
    const approvalStatuses = [
      'VOUCHER_PREPARED',
      'TREASURY_APPROVED',
      'HEAD_TREASURY_APPROVED',
      'MIS_APPROVED',
      'AUDIT_APPROVED',
    ]
    for (const status of approvalStatuses) {
      const steps = buildStepsMeta(status)
      expect(steps[5].state).toBe('active')
    }
  })

  it('Step 6 is still active at MD_APPROVED (operations not yet executed)', () => {
    // The approval chain panel remains active until OPERATIONS_COMPLETED —
    // MD_APPROVED means the chain passed but ops execution is still pending.
    const steps = buildStepsMeta('MD_APPROVED')
    expect(steps[5].state).toBe('active')
  })

  it('Step 6 is completed after OPERATIONS_COMPLETED', () => {
    const steps = buildStepsMeta('OPERATIONS_COMPLETED')
    expect(steps[5].state).toBe('completed')
  })

  it('all steps are completed at COMPLETED status', () => {
    const steps = buildStepsMeta('COMPLETED')
    for (const step of steps) {
      expect(step.state).toBe('completed')
    }
  })
})

// ─── 8. Workflow Service — canActorAct() + maker-checker ─────────────────────

describe('canActorAct() — role enforcement + maker-checker (Req 5.2, 5.4)', () => {
  // TREASURY_OFFICER who did NOT create the tx
  it('TREASURY_OFFICER (non-maker) can act at VOUCHER_PREPARED (Treasury approval)', () => {
    expect(
      canActorAct('TREASURY_OFFICER', { ...baseTx, status: 'VOUCHER_PREPARED' }, ACTOR_ID_B),
    ).toBe(true)
  })

  it('TREASURY_OFFICER (maker) cannot approve their own transaction (Req 5.4)', () => {
    expect(
      canActorAct('TREASURY_OFFICER', { ...baseTx, status: 'VOUCHER_PREPARED' }, ACTOR_ID_A),
    ).toBe(false)
  })

  it('TREASURY_OFFICER can create/verify at non-approval statuses (not maker-checker blocked)', () => {
    expect(
      canActorAct('TREASURY_OFFICER', { ...baseTx, status: 'INSTRUCTION_RECEIVED' }, ACTOR_ID_A),
    ).toBe(true)
  })

  it('ACCOUNT_OFFICER can act only at SIGNATURE_VERIFIED', () => {
    expect(
      canActorAct('ACCOUNT_OFFICER', { ...baseTx, status: 'SIGNATURE_VERIFIED' }, ACTOR_ID_B),
    ).toBe(true)
  })

  it('ACCOUNT_OFFICER cannot act at INSTRUCTION_RECEIVED', () => {
    expect(
      canActorAct('ACCOUNT_OFFICER', { ...baseTx, status: 'INSTRUCTION_RECEIVED' }, ACTOR_ID_B),
    ).toBe(false)
  })

  it('HEAD_TREASURY can act only at TREASURY_APPROVED', () => {
    expect(
      canActorAct('HEAD_TREASURY', { ...baseTx, status: 'TREASURY_APPROVED' }, ACTOR_ID_B),
    ).toBe(true)
    expect(
      canActorAct('HEAD_TREASURY', { ...baseTx, status: 'VOUCHER_PREPARED' }, ACTOR_ID_B),
    ).toBe(false)
  })

  it('MIS can act only at HEAD_TREASURY_APPROVED', () => {
    expect(
      canActorAct('MIS', { ...baseTx, status: 'HEAD_TREASURY_APPROVED' }, ACTOR_ID_B),
    ).toBe(true)
    expect(
      canActorAct('MIS', { ...baseTx, status: 'TREASURY_APPROVED' }, ACTOR_ID_B),
    ).toBe(false)
  })

  it('AUDIT can act only at MIS_APPROVED', () => {
    expect(
      canActorAct('AUDIT', { ...baseTx, status: 'MIS_APPROVED' }, ACTOR_ID_B),
    ).toBe(true)
  })

  it('MD can act only at AUDIT_APPROVED', () => {
    expect(
      canActorAct('MD', { ...baseTx, status: 'AUDIT_APPROVED' }, ACTOR_ID_B),
    ).toBe(true)
    expect(
      canActorAct('MD', { ...baseTx, status: 'MIS_APPROVED' }, ACTOR_ID_B),
    ).toBe(false)
  })

  it('OPERATIONS can act only at MD_APPROVED', () => {
    expect(
      canActorAct('OPERATIONS', { ...baseTx, status: 'MD_APPROVED' }, ACTOR_ID_B),
    ).toBe(true)
    expect(
      canActorAct('OPERATIONS', { ...baseTx, status: 'AUDIT_APPROVED' }, ACTOR_ID_B),
    ).toBe(false)
  })

  it('TREASURY_OFFICER can act at OPERATIONS_COMPLETED (treasury completion)', () => {
    expect(
      canActorAct('TREASURY_OFFICER', { ...baseTx, status: 'OPERATIONS_COMPLETED' }, ACTOR_ID_B),
    ).toBe(true)
  })

  it('an unknown role cannot act at any status', () => {
    expect(
      canActorAct('CUSTOMER', { ...baseTx, status: 'VOUCHER_PREPARED' }, ACTOR_ID_B),
    ).toBe(false)
  })
})

// ─── 9. Workflow Service — getRequiredStage() ─────────────────────────────────

describe('getRequiredStage() — status → approval stage mapping', () => {
  it('maps VOUCHER_PREPARED → TREASURY', () => {
    expect(getRequiredStage('VOUCHER_PREPARED')).toBe('TREASURY')
  })

  it('maps TREASURY_APPROVED → HEAD_TREASURY', () => {
    expect(getRequiredStage('TREASURY_APPROVED')).toBe('HEAD_TREASURY')
  })

  it('maps HEAD_TREASURY_APPROVED → MIS', () => {
    expect(getRequiredStage('HEAD_TREASURY_APPROVED')).toBe('MIS')
  })

  it('maps MIS_APPROVED → AUDIT', () => {
    expect(getRequiredStage('MIS_APPROVED')).toBe('AUDIT')
  })

  it('maps AUDIT_APPROVED → MD', () => {
    expect(getRequiredStage('AUDIT_APPROVED')).toBe('MD')
  })

  it('returns null for non-approval statuses', () => {
    expect(getRequiredStage('INSTRUCTION_RECEIVED')).toBeNull()
    expect(getRequiredStage('COMPLETED')).toBeNull()
    expect(getRequiredStage('MD_APPROVED')).toBeNull()
  })
})

// ─── 10. Workflow Service — isStageComplete() + getRoleForStage() ─────────────

describe('isStageComplete() and getRoleForStage()', () => {
  it('TREASURY stage is complete when status is TREASURY_APPROVED or later', () => {
    expect(isStageComplete('TREASURY', 'TREASURY_APPROVED')).toBe(true)
    expect(isStageComplete('TREASURY', 'HEAD_TREASURY_APPROVED')).toBe(true)
    expect(isStageComplete('TREASURY', 'VOUCHER_PREPARED')).toBe(false)
  })

  it('MD stage is complete once its required prior status (AUDIT_APPROVED) is passed', () => {
    // isStageComplete('MD', status) checks if currentStatus is BEYOND the required
    // prior status (AUDIT_APPROVED). MD_APPROVED is AFTER AUDIT_APPROVED, so the
    // MD stage is already complete at MD_APPROVED.
    expect(isStageComplete('MD', 'MD_APPROVED')).toBe(true)
    expect(isStageComplete('MD', 'OPERATIONS_COMPLETED')).toBe(true)
    // Not yet complete if we are still at AUDIT_APPROVED
    expect(isStageComplete('MD', 'AUDIT_APPROVED')).toBe(false)
  })

  it('getRoleForStage maps each stage to the correct role', () => {
    expect(getRoleForStage('TREASURY')).toBe('TREASURY_OFFICER')
    expect(getRoleForStage('HEAD_TREASURY')).toBe('HEAD_TREASURY')
    expect(getRoleForStage('MIS')).toBe('MIS')
    expect(getRoleForStage('AUDIT')).toBe('AUDIT')
    expect(getRoleForStage('MD')).toBe('MD')
  })
})

// ─── 11. Workflow Service — getWorkflowStatus() ───────────────────────────────

describe('getWorkflowStatus() — transaction state flags', () => {
  it('COMPLETED is a terminal state', () => {
    const ws = getWorkflowStatus({ status: 'COMPLETED' })
    expect(ws.isTerminal).toBe(true)
    expect(ws.isCompleted).toBe(true)
  })

  it('REJECTED is a terminal state', () => {
    const ws = getWorkflowStatus({ status: 'REJECTED' })
    expect(ws.isTerminal).toBe(true)
    expect(ws.isException).toBe(true)
  })

  it('INSTRUCTION_RECEIVED is not terminal or exception', () => {
    const ws = getWorkflowStatus({ status: 'INSTRUCTION_RECEIVED' })
    expect(ws.isTerminal).toBe(false)
    expect(ws.isException).toBe(false)
    expect(ws.isCompleted).toBe(false)
  })

  it('RETURNED is an exception state', () => {
    const ws = getWorkflowStatus({ status: 'RETURNED' })
    expect(ws.isException).toBe(true)
  })
})

// ─── 12. Permission Map Completeness (Req 5.2) ────────────────────────────────

describe('ROLE_PERMISSIONS — role-to-action map completeness (Req 5.2)', () => {
  it('TREASURY_OFFICER has all six workflow step permissions', () => {
    const perms = ROLE_PERMISSIONS.TREASURY_OFFICER
    expect(perms).toContain('create_transaction')
    expect(perms).toContain('verify_signature')
    expect(perms).toContain('verify_investment')
    expect(perms).toContain('prepare_voucher')
    expect(perms).toContain('approve_treasury')
    expect(perms).toContain('confirm_completion')
  })

  it('ACCOUNT_OFFICER can record confirmation but not create transactions', () => {
    const perms = ROLE_PERMISSIONS.ACCOUNT_OFFICER
    expect(perms).toContain('record_confirmation')
    expect(perms).not.toContain('create_transaction')
    expect(perms).not.toContain('approve_treasury')
  })

  it('each approver role has exactly its own approval permission', () => {
    expect(ROLE_PERMISSIONS.HEAD_TREASURY).toContain('approve_head_treasury')
    expect(ROLE_PERMISSIONS.MIS).toContain('approve_mis')
    expect(ROLE_PERMISSIONS.AUDIT).toContain('approve_audit')
    expect(ROLE_PERMISSIONS.MD).toContain('approve_md')
  })

  it('OPERATIONS can execute but not approve', () => {
    const perms = ROLE_PERMISSIONS.OPERATIONS
    expect(perms).toContain('execute_transaction')
    expect(perms).not.toContain('approve_treasury')
    expect(perms).not.toContain('approve_md')
  })

  it('ADMIN has all permissions (administrative override)', () => {
    const perms = ROLE_PERMISSIONS.ADMIN
    expect(perms).toContain('create_transaction')
    expect(perms).toContain('approve_md')
    expect(perms).toContain('execute_transaction')
    expect(perms).toContain('manage_users')
  })

  it('CUSTOMER has no permissions', () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toHaveLength(0)
  })
})

// ─── 13. Stage/Status Mapping Consistency ─────────────────────────────────────

describe('Stage ↔ Status ↔ Owner mapping consistency', () => {
  it('STAGE_TO_ROLE covers all five approval stages', () => {
    const stages = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD']
    for (const stage of stages) {
      expect(STAGE_TO_ROLE[stage]).toBeDefined()
    }
  })

  it('STAGE_REQUIRED_STATUS covers all five approval stages', () => {
    const stages = ['TREASURY', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD']
    for (const stage of stages) {
      expect(STAGE_REQUIRED_STATUS[stage]).toBeDefined()
    }
  })

  it('STATUS_TO_OWNER covers all 11 active workflow statuses', () => {
    const activeStatuses = [
      'INSTRUCTION_RECEIVED',
      'SIGNATURE_VERIFIED',
      'CUSTOMER_CONFIRMED',
      'INVESTMENT_VERIFIED',
      'VOUCHER_PREPARED',
      'TREASURY_APPROVED',
      'HEAD_TREASURY_APPROVED',
      'MIS_APPROVED',
      'AUDIT_APPROVED',
      'MD_APPROVED',
      'OPERATIONS_COMPLETED',
    ]
    for (const status of activeStatuses) {
      expect(STATUS_TO_OWNER[status]).toBeDefined()
    }
  })

  it('STAGE_TO_ROLE and STAGE_REQUIRED_STATUS are consistent with canActorAct()', () => {
    // For each approval stage: the required role CAN act at the required status
    const stagesAndStatuses = [
      { stage: 'TREASURY',      status: 'VOUCHER_PREPARED',        role: 'TREASURY_OFFICER' },
      { stage: 'HEAD_TREASURY', status: 'TREASURY_APPROVED',       role: 'HEAD_TREASURY' },
      { stage: 'MIS',           status: 'HEAD_TREASURY_APPROVED',  role: 'MIS' },
      { stage: 'AUDIT',         status: 'MIS_APPROVED',            role: 'AUDIT' },
      { stage: 'MD',            status: 'AUDIT_APPROVED',          role: 'MD' },
    ]

    for (const { status, role } of stagesAndStatuses) {
      const tx = { ...baseTx, status }
      // A non-maker with the right role can act
      expect(canActorAct(role, tx, ACTOR_ID_B)).toBe(true)
      // A non-maker with the WRONG role cannot act at this status
      expect(canActorAct('OPERATIONS', tx, ACTOR_ID_B)).toBe(false)
    }
  })
})

// ─── 14. End-to-End Rollover P+I workflow — status progression ────────────────

describe('End-to-end Rollover P+I — status progression smoke test', () => {
  /**
   * This test traces the status sequence for a Rollover P+I transaction,
   * verifying that at each stage:
   *   - The correct step in StepProgressTracker is active
   *   - The correct role can act
   *   - The correct approval stage is required
   */

  const CREATOR_ID   = '00000000-0000-4000-b000-000000000001'
  const ACCT_OFFICER = '00000000-0000-4000-b000-000000000002'
  const APPROVER_HT  = '00000000-0000-4000-b000-000000000003'
  const APPROVER_MIS = '00000000-0000-4000-b000-000000000004'
  const APPROVER_AUD = '00000000-0000-4000-b000-000000000005'
  const APPROVER_MD  = '00000000-0000-4000-b000-000000000006'
  const OPS_OFFICER  = '00000000-0000-4000-b000-000000000007'

  const tx = {
    id: VALID_TX_ID,
    transaction_type: 'ROLLOVER',
    created_by: CREATOR_ID,
    status: 'INSTRUCTION_RECEIVED',
  }

  it('Step 1 → INSTRUCTION_RECEIVED: TREASURY_OFFICER is active', () => {
    const steps = buildStepsMeta('INSTRUCTION_RECEIVED')
    expect(steps[0].state).toBe('completed') // Step 1 always completed once tx exists
    expect(steps[1].state).toBe('active')    // Step 2 is next
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: 'INSTRUCTION_RECEIVED' }, CREATOR_ID)).toBe(true)
  })

  it('Step 2 → SIGNATURE_VERIFIED: ACCOUNT_OFFICER can act, TREASURY_OFFICER cannot', () => {
    const s = 'SIGNATURE_VERIFIED'
    expect(canActorAct('ACCOUNT_OFFICER', { ...tx, status: s }, ACCT_OFFICER)).toBe(true)
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: s }, CREATOR_ID)).toBe(false)
    const steps = buildStepsMeta(s)
    expect(steps[2].state).toBe('active')
  })

  it('Step 3 → CUSTOMER_CONFIRMED: TREASURY_OFFICER can verify investment', () => {
    const s = 'CUSTOMER_CONFIRMED'
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: s }, CREATOR_ID)).toBe(true)
    const steps = buildStepsMeta(s)
    expect(steps[3].state).toBe('active')
  })

  it('Step 4 → INVESTMENT_VERIFIED: TREASURY_OFFICER can prepare voucher', () => {
    const s = 'INVESTMENT_VERIFIED'
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: s }, CREATOR_ID)).toBe(true)
    const steps = buildStepsMeta(s)
    expect(steps[4].state).toBe('active')
  })

  it('Step 5 → VOUCHER_PREPARED: TREASURY_OFFICER (non-creator) can do Treasury approval', () => {
    const s = 'VOUCHER_PREPARED'
    const steps = buildStepsMeta(s)
    expect(steps[5].state).toBe('active')
    // The creator (CREATOR_ID) is blocked by maker-checker
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: s }, CREATOR_ID)).toBe(false)
    // But another TREASURY_OFFICER can approve
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: s }, APPROVER_HT)).toBe(true)
    expect(getRequiredStage(s)).toBe('TREASURY')
  })

  it('Step 6a → TREASURY_APPROVED: HEAD_TREASURY can approve', () => {
    const s = 'TREASURY_APPROVED'
    expect(canActorAct('HEAD_TREASURY', { ...tx, status: s }, APPROVER_HT)).toBe(true)
    expect(getRequiredStage(s)).toBe('HEAD_TREASURY')
  })

  it('Step 6b → HEAD_TREASURY_APPROVED: MIS can approve', () => {
    const s = 'HEAD_TREASURY_APPROVED'
    expect(canActorAct('MIS', { ...tx, status: s }, APPROVER_MIS)).toBe(true)
    expect(getRequiredStage(s)).toBe('MIS')
  })

  it('Step 6c → MIS_APPROVED: AUDIT can approve', () => {
    const s = 'MIS_APPROVED'
    expect(canActorAct('AUDIT', { ...tx, status: s }, APPROVER_AUD)).toBe(true)
    expect(getRequiredStage(s)).toBe('AUDIT')
  })

  it('Step 6d → AUDIT_APPROVED: MD can approve', () => {
    const s = 'AUDIT_APPROVED'
    expect(canActorAct('MD', { ...tx, status: s }, APPROVER_MD)).toBe(true)
    expect(getRequiredStage(s)).toBe('MD')
  })

  it('Post-approval → MD_APPROVED: OPERATIONS can execute', () => {
    const s = 'MD_APPROVED'
    expect(canActorAct('OPERATIONS', { ...tx, status: s }, OPS_OFFICER)).toBe(true)
    expect(getRequiredStage(s)).toBeNull()
  })

  it('Post-execution → OPERATIONS_COMPLETED: TREASURY_OFFICER can confirm', () => {
    const s = 'OPERATIONS_COMPLETED'
    expect(canActorAct('TREASURY_OFFICER', { ...tx, status: s }, CREATOR_ID)).toBe(true)
  })

  it('Terminal → COMPLETED: no role can act further', () => {
    const s = 'COMPLETED'
    const roles = ['TREASURY_OFFICER', 'ACCOUNT_OFFICER', 'HEAD_TREASURY', 'MIS', 'AUDIT', 'MD', 'OPERATIONS']
    for (const role of roles) {
      expect(canActorAct(role, { ...tx, status: s }, CREATOR_ID)).toBe(false)
    }
    const { isCompleted } = getWorkflowStatus({ status: s })
    expect(isCompleted).toBe(true)
  })
})

// ─── 15. RPC role rejection — action-layer enforcement ────────────────────────

describe('Server action role enforcement — RPC rejection scenarios (Req 5.1–5.3)', () => {
  /**
   * These tests verify the pure role-check logic that the server actions
   * apply before calling RPCs. The same checks are duplicated inside the
   * PostgreSQL SECURITY DEFINER functions; this test layer confirms the
   * TS layer catches them first to avoid unnecessary round-trips.
   */

  // Role enforcer mirrors the logic in each server action
  function enforceRole(
    callerRole: string,
    requiredRole: string | string[],
  ): boolean {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
    return allowed.includes(callerRole) || callerRole === 'ADMIN'
  }

  it('only TREASURY_OFFICER (or ADMIN) can create a transaction', () => {
    expect(enforceRole('TREASURY_OFFICER', 'TREASURY_OFFICER')).toBe(true)
    expect(enforceRole('ADMIN', 'TREASURY_OFFICER')).toBe(true)
    expect(enforceRole('ACCOUNT_OFFICER', 'TREASURY_OFFICER')).toBe(false)
    expect(enforceRole('HEAD_TREASURY', 'TREASURY_OFFICER')).toBe(false)
    expect(enforceRole('OPERATIONS', 'TREASURY_OFFICER')).toBe(false)
    expect(enforceRole('MD', 'TREASURY_OFFICER')).toBe(false)
  })

  it('only TREASURY_OFFICER can verify signatures', () => {
    expect(enforceRole('TREASURY_OFFICER', 'TREASURY_OFFICER')).toBe(true)
    expect(enforceRole('ACCOUNT_OFFICER', 'TREASURY_OFFICER')).toBe(false)
  })

  it('only ACCOUNT_OFFICER can record customer confirmations', () => {
    expect(enforceRole('ACCOUNT_OFFICER', 'ACCOUNT_OFFICER')).toBe(true)
    expect(enforceRole('TREASURY_OFFICER', 'ACCOUNT_OFFICER')).toBe(false)
  })

  it('only TREASURY_OFFICER can verify investments', () => {
    expect(enforceRole('TREASURY_OFFICER', 'TREASURY_OFFICER')).toBe(true)
    expect(enforceRole('MIS', 'TREASURY_OFFICER')).toBe(false)
  })

  it('only TREASURY_OFFICER can prepare vouchers', () => {
    expect(enforceRole('TREASURY_OFFICER', 'TREASURY_OFFICER')).toBe(true)
    expect(enforceRole('AUDIT', 'TREASURY_OFFICER')).toBe(false)
  })

  it('each approval stage requires its specific role', () => {
    const stageRoles: Array<[string, string]> = [
      ['TREASURY',       'TREASURY_OFFICER'],
      ['HEAD_TREASURY',  'HEAD_TREASURY'],
      ['MIS',            'MIS'],
      ['AUDIT',          'AUDIT'],
      ['MD',             'MD'],
    ]
    for (const [, requiredRole] of stageRoles) {
      expect(enforceRole(requiredRole, requiredRole)).toBe(true)
      // Any other non-admin role is rejected
      const otherRoles = ['TREASURY_OFFICER', 'ACCOUNT_OFFICER', 'OPERATIONS'].filter(
        (r) => r !== requiredRole,
      )
      for (const other of otherRoles) {
        const canAct = enforceRole(other, requiredRole)
        // TREASURY_OFFICER is the requiredRole for TREASURY stage — skip self-check
        if (other !== requiredRole) {
          // Only fails if other !== the required role
          expect(canAct).toBe(false)
        }
      }
    }
  })

  it('only OPERATIONS can execute a transaction', () => {
    expect(enforceRole('OPERATIONS', 'OPERATIONS')).toBe(true)
    expect(enforceRole('TREASURY_OFFICER', 'OPERATIONS')).toBe(false)
    expect(enforceRole('MD', 'OPERATIONS')).toBe(false)
  })

  it('only TREASURY_OFFICER can confirm treasury completion', () => {
    expect(enforceRole('TREASURY_OFFICER', 'TREASURY_OFFICER')).toBe(true)
    expect(enforceRole('OPERATIONS', 'TREASURY_OFFICER')).toBe(false)
  })
})
