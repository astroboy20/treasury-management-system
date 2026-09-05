import { z } from 'zod'

// ============================================================
// Approval Stage enum
// Mirrors migration 001 CHECK on approvals.stage
// ============================================================

export const ApprovalStageEnum = z.enum([
  'TREASURY',
  'HEAD_TREASURY',
  'MIS',
  'AUDIT',
  'MD',
])
export type ApprovalStage = z.infer<typeof ApprovalStageEnum>

// ============================================================
// Approval Decision enum (Req 12.5)
// ============================================================

export const ApprovalDecisionEnum = z.enum(['APPROVE', 'RETURN', 'REJECT'])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionEnum>

// ============================================================
// ApprovalSchema (Req 12.6)
// RETURN and REJECT decisions require a non-empty comments field.
// ============================================================

export const ApprovalSchema = z
  .object({
    stage: ApprovalStageEnum,
    decision: ApprovalDecisionEnum,
    comments: z
      .string()
      .max(2000, 'Comments must be 2 000 characters or fewer.')
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Comments are mandatory for RETURN and REJECT decisions (Req 12.6, 12.7)
    if (data.decision === 'RETURN' || data.decision === 'REJECT') {
      if (!data.comments || data.comments.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['comments'],
          message:
            data.decision === 'RETURN'
              ? 'A comment is required when returning a transaction.'
              : 'A comment is required when rejecting a transaction.',
        })
      }
    }
  })

export type ApprovalInput = z.infer<typeof ApprovalSchema>
