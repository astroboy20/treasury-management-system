import { notFound } from 'next/navigation'
import { getTransactionWorkspaceAction } from '@/lib/actions/transaction.actions'
import { getAuthenticatedUser, resolveUserRole } from '@/lib/services/auth.service'
import { buildStepsMeta } from '@/lib/services/workflow.service'
import WorkspaceHeader from './_components/WorkspaceHeader'
import StepProgressTracker from './_components/StepProgressTracker'
import WorkspaceSidebar from './_components/WorkspaceSidebar'
import AuditTimeline from './_components/AuditTimeline'
import Step1Instruction from './_components/Step1Instruction'
import Step2SignatureVerification from './_components/Step2SignatureVerification'
import Step3CustomerConfirmation, { BENEFICIARY_REQUIRED_TYPES } from './_components/Step3CustomerConfirmation'
import Step4InvestmentVerification from './_components/Step4InvestmentVerification'
import Step6ApprovalChain from './_components/Step6ApprovalChain'
import { eazybankzAdapter } from '@/lib/services/eazybankz'
import type { StepMeta } from '@/lib/services/workflow.service'
import type { TransactionWorkspace } from '@/lib/services/transaction.service'

// ─── Step label map ───────────────────────────────────────────────────────────

const STEP_LABELS: Record<number, string> = {
  1: 'Instruction',
  2: 'Signature Verification',
  3: 'Customer Confirmation',
  4: 'Investment Verification',
  5: 'Voucher Preparation',
  6: 'Approval Chain',
}

// ─── StepSection wrapper ──────────────────────────────────────────────────────

interface StepSectionProps {
  step: StepMeta
  children: React.ReactNode
}

function StepSection({ step, children }: StepSectionProps) {
  const isCompleted = step.state === 'completed'
  const isActive = step.state === 'active'
  const isLocked = step.state === 'locked'

  const headerClasses = [
    'flex w-full items-center gap-3 px-5 py-4 sm:px-6 text-left',
    isCompleted ? 'text-emerald-700' : isActive ? 'text-foreground' : 'text-muted-foreground',
  ].join(' ')

  const borderClasses = [
    'rounded-xl border',
    isActive ? 'border-primary/30 shadow-sm' : 'border-border',
    isLocked ? 'bg-muted/30' : 'bg-background',
  ].join(' ')

  // Completed steps: collapsible via <details>
  if (isCompleted) {
    return (
      <section
        aria-label={`Step ${step.id}: ${step.label}`}
        className={borderClasses}
      >
        <details>
          <summary className={`${headerClasses} cursor-pointer list-none select-none marker:hidden`}>
            <StepBadge step={step} />
            <span className="flex-1 text-sm font-medium">{STEP_LABELS[step.id]}</span>
            <span className="text-xs text-muted-foreground">Completed</span>
            <ChevronIcon />
          </summary>
          <div className="border-t border-border px-5 py-4 sm:px-6">
            {children}
          </div>
        </details>
      </section>
    )
  }

  // Active step: expanded
  if (isActive) {
    return (
      <section
        aria-label={`Step ${step.id}: ${step.label} — active`}
        className={borderClasses}
      >
        <div className={`${headerClasses} cursor-default`}>
          <StepBadge step={step} />
          <span className="flex-1 text-sm font-medium">{STEP_LABELS[step.id]}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            In progress
          </span>
        </div>
        <div className="border-t border-border px-5 py-4 sm:px-6">
          {children}
        </div>
      </section>
    )
  }

  // Locked step
  return (
    <section
      aria-label={`Step ${step.id}: ${step.label} — locked`}
      className={borderClasses}
    >
      <div className={`${headerClasses} cursor-default`}>
        <StepBadge step={step} />
        <span className="flex-1 text-sm font-medium">{STEP_LABELS[step.id]}</span>
        <span className="text-xs text-muted-foreground">Locked</span>
      </div>
      {step.lockedReason && (
        <div className="border-t border-border/50 px-5 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground italic">{step.lockedReason}</p>
        </div>
      )}
    </section>
  )
}

// ─── Step badge (number or icon) ──────────────────────────────────────────────

function StepBadge({ step }: { step: StepMeta }) {
  if (step.state === 'completed') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-xs font-semibold" aria-hidden>
        ✓
      </span>
    )
  }
  if (step.state === 'active') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold" aria-hidden>
        {step.id}
      </span>
    )
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground text-xs" aria-hidden>
      {step.id}
    </span>
  )
}

// ─── Chevron icon for collapsible ─────────────────────────────────────────────

function ChevronIcon() {
  return (
    <svg
      className="size-4 shrink-0 transition-transform duration-150 [[open]_&]:rotate-180"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ─── Step content renderer ────────────────────────────────────────────────────

interface StepContentProps {
  step: StepMeta
  workspace: TransactionWorkspace
  userRole: string | null
  userId: string | null
  eazybankzData: import('@/lib/services/eazybankz').EazybankzInvestment | null
}

function StepContent({ step, workspace, userRole, userId, eazybankzData }: StepContentProps) {
  switch (step.id) {
    case 1:
      return (
        <Step1Instruction
          transaction={workspace.transaction}
          customer={workspace.customer}
          createdBy={workspace.createdBy}
        />
      )
    case 2:
      return (
        <Step2SignatureVerification
          transactionId={workspace.transaction.id}
          signatureVerification={workspace.signatureVerification}
          canAct={userRole === 'TREASURY_OFFICER' || userRole === 'ADMIN'}
        />
      )
    case 3:
      return (
        <Step3CustomerConfirmation
          transactionId={workspace.transaction.id}
          officerName={workspace.createdBy?.full_name ?? 'Account Officer'}
          requiresBeneficiary={BENEFICIARY_REQUIRED_TYPES.has(workspace.transaction.transaction_type)}
          customerConfirmation={workspace.customerConfirmation}
          canAct={userRole === 'ACCOUNT_OFFICER' || userRole === 'ADMIN'}
        />
      )
    case 4:
      return (
        <Step4InvestmentVerification
          transactionId={workspace.transaction.id}
          eazybankzData={eazybankzData}
          investmentVerification={workspace.investmentVerification}
          canAct={userRole === 'TREASURY_OFFICER' || userRole === 'ADMIN'}
        />
      )
    case 5:
      return (
        <p className="text-sm text-muted-foreground">
          Voucher preparation panel — coming in task 2.18
        </p>
      )
    case 6:
      return (
        <Step6ApprovalChain
          transactionId={workspace.transaction.id}
          transactionStatus={workspace.transaction.status}
          transactionCreatedBy={workspace.transaction.created_by}
          approvals={workspace.approvals}
          currentUserId={userId ?? ''}
          currentUserRole={userRole}
        />
      )
    default:
      return null
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: { id: string }
}

export default async function TransactionWorkspacePage({ params }: PageProps) {
  // Load workspace data server-side
  const result = await getTransactionWorkspaceAction(params.id)

  if (!result.success) {
    notFound()
  }

  const workspace = result.data

  // Resolve role server-side for RBAC checks in step panels
  const user = await getAuthenticatedUser()
  const userRole = user ? await resolveUserRole(user.id) : null
  const userId = user?.id ?? null


  // Fetch Eazybankz investment data server-side for Step 4 (Req 10.1)
  // Uses the external_reference from the linked investment record, if present.
  const externalRef = workspace.investment?.external_reference ?? null
  const eazybankzData = externalRef
    ? await eazybankzAdapter.getInvestment(externalRef)
    : null

  // Build step metadata from current transaction status
  const steps = buildStepsMeta(
    workspace.transaction.status,
    workspace.signatureVerification?.signature_result ?? null,
  )

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      {/* Header — full width */}
      <WorkspaceHeader
        transaction={workspace.transaction}
        customer={workspace.customer}
      />

      {/* Step progress tracker — full width */}
      <StepProgressTracker
        currentStatus={workspace.transaction.status}
        steps={steps}
      />

      {/* Main content + sidebar */}
      <div className="flex flex-1 flex-col gap-6 p-5 sm:p-8 lg:flex-row lg:items-start lg:gap-8">
        {/* Main content column */}
        <main className="flex flex-1 min-w-0 flex-col gap-4" aria-label="Transaction workspace">
          {steps.map((step) => (
            <StepSection key={step.id} step={step}>
              <StepContent
                step={step}
                workspace={workspace}
                userRole={userRole}
                userId={userId}
                eazybankzData={eazybankzData}
              />
            </StepSection>
          ))}
        </main>

        {/* Sidebar column */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <WorkspaceSidebar
            transaction={workspace.transaction}
            approvals={workspace.approvals}
            documents={workspace.documents}
          />
        </div>
      </div>

      {/* Audit timeline — full width */}
      <div className="px-5 pb-8 sm:px-8">
        <AuditTimeline events={workspace.auditEvents} />
      </div>
    </div>
  )
}
