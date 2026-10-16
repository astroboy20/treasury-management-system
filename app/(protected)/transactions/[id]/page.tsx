import { notFound, redirect } from "next/navigation";
import { getTransactionWorkspaceAction } from "@/lib/actions/transaction.actions";
import {
  getAuthenticatedUser,
  resolveUserRole,
} from "@/lib/services/auth.service";
import { buildStepsMeta } from "@/lib/services/workflow.service";
import WorkspaceHeader from "./_components/WorkspaceHeader";
import StepProgressTracker from "./_components/StepProgressTracker";
import WorkspaceSidebar from "./_components/WorkspaceSidebar";
import AuditTimeline from "./_components/AuditTimeline";
import Step1Instruction from "./_components/Step1Instruction";
import Step2SignatureVerification from "./_components/Step2SignatureVerification";
import Step3CustomerConfirmation from "./_components/Step3CustomerConfirmation";
import Step4InvestmentVerification from "./_components/Step4InvestmentVerification";
import Step5VoucherGeneration from "./_components/Step5VoucherGeneration";
import Step6ApprovalChain from "./_components/Step6ApprovalChain";
import OperationsExecutionPanel from "./_components/OperationsExecutionPanel";
import TreasuryCompletionPanel from "./_components/TreasuryCompletionPanel";
import { eazybankzAdapter, EazybankzError } from "@/lib/services/eazybankz";
import type { StepMeta } from "@/lib/services/workflow.service";
import type { TransactionWorkspace } from "@/lib/services/transaction.service";

// Force dynamic rendering — transaction status changes frequently and must
// always reflect the latest DB state (e.g. RETURNED after an approver recalls).
export const dynamic = 'force-dynamic'

// ─── Beneficiary requirement check ───────────────────────────────────────────
// Defined here (server component) to avoid importing a Set from a client module
// across the server/client boundary, which causes serialisation loss of .has().

const BENEFICIARY_TRANSACTION_TYPES = new Set([
  'THIRD_PARTY_PAYMENT',
  'INTERNAL_TRANSFER',
])

function requiresBeneficiary(transactionType: string): boolean {
  return BENEFICIARY_TRANSACTION_TYPES.has(transactionType)
}

// ─── Step label map ───────────────────────────────────────────────────────────

const STEP_LABELS: Record<number, string> = {
  1: "Instruction & Verification",
  2: "Approval Chain",
};

// ─── StepSection wrapper ──────────────────────────────────────────────────────

interface StepSectionProps {
  step: StepMeta;
  children: React.ReactNode;
}

function StepSection({ step, children }: StepSectionProps) {
  const isCompleted = step.state === "completed";
  const isActive = step.state === "active";
  const isLocked = step.state === "locked";

  const headerClasses = [
    "flex w-full items-center gap-3 px-5 py-4 sm:px-6 text-left",
    isCompleted
      ? "text-emerald-700"
      : isActive
      ? "text-foreground"
      : "text-muted-foreground",
  ].join(" ");

  const borderClasses = [
    "rounded-xl border",
    isActive ? "border-primary/30 shadow-sm" : "border-border",
    isLocked ? "bg-muted/30" : "bg-background",
  ].join(" ");

  // Completed steps: collapsible via <details>
  if (isCompleted) {
    return (
      <section
        aria-label={`Step ${step.id}: ${step.label}`}
        className={borderClasses}
      >
        <details>
          <summary
            className={`${headerClasses} cursor-pointer list-none select-none marker:hidden`}
          >
            <StepBadge step={step} />
            <span className="flex-1 text-sm font-medium">
              {STEP_LABELS[step.id]}
            </span>
            <span className="text-xs text-muted-foreground">Completed</span>
            <ChevronIcon />
          </summary>
          <div className="border-t border-border px-5 py-4 sm:px-6">
            {children}
          </div>
        </details>
      </section>
    );
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
          <span className="flex-1 text-sm font-medium">
            {STEP_LABELS[step.id]}
          </span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            In progress
          </span>
        </div>
        <div className="border-t border-border px-5 py-4 sm:px-6">
          {children}
        </div>
      </section>
    );
  }

  // Locked step
  return (
    <section
      aria-label={`Step ${step.id}: ${step.label} — locked`}
      className={borderClasses}
    >
      <div className={`${headerClasses} cursor-default`}>
        <StepBadge step={step} />
        <span className="flex-1 text-sm font-medium">
          {STEP_LABELS[step.id]}
        </span>
        <span className="text-xs text-muted-foreground">Locked</span>
      </div>
      {step.lockedReason && (
        <div className="border-t border-border/50 px-5 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground italic">
            {step.lockedReason}
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Step badge (number or icon) ──────────────────────────────────────────────

function StepBadge({ step }: { step: StepMeta }) {
  if (step.state === "completed") {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-xs font-semibold"
        aria-hidden
      >
        ✓
      </span>
    );
  }
  if (step.state === "active") {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold"
        aria-hidden
      >
        {step.id}
      </span>
    );
  }
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground text-xs"
      aria-hidden
    >
      {step.id}
    </span>
  );
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
  );
}

// ─── Verification section — steps 1–5 as one flat section ────────────────────

interface VerificationSectionProps {
  steps: StepMeta[];
  workspace: TransactionWorkspace;
  userRole: string | null;
  userId: string | null;
  eazybankzData: import("@/lib/services/eazybankz").EazybankzInvestment | null;
}
function VerificationSection({
  steps,
  workspace,
  userRole,
  userId,
  eazybankzData,
}: VerificationSectionProps) {
  // steps[0] is "Instruction & Verification" — the merged treasury-maker section
  const step = steps[0];
  const sectionState = step?.state ?? "locked";
  const lockedReason = step?.lockedReason;

  const headerClasses = [
    "flex w-full items-center gap-3 px-5 py-4 sm:px-6 text-left",
    sectionState === "completed"
      ? "text-emerald-700"
      : sectionState === "active"
      ? "text-foreground"
      : "text-muted-foreground",
  ].join(" ");

  const borderClasses = [
    "rounded-xl border",
    sectionState === "active" ? "border-primary/30 shadow-sm" : "border-border",
    sectionState === "locked" ? "bg-muted/30" : "bg-background",
  ].join(" ");

  const badge = sectionState === "completed" ? (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-xs font-semibold"
      aria-hidden
    >
      ✓
    </span>
  ) : sectionState === "active" ? (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold"
      aria-hidden
    >
      1
    </span>
  ) : (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground text-xs"
      aria-hidden
    >
      1
    </span>
  );

  const isTreasuryMaker = userRole === "TREASURY_OFFICER" || userRole === "ADMIN";

  // Audit officer can fill in the checklist when the transaction is at MIS_APPROVED (their turn)
  const canAuditAct =
    (userRole === "AUDIT" || userRole === "ADMIN") &&
    workspace.transaction.status === "MIS_APPROVED";

  // Render the full flat content of all steps 1–5 with no sub-headings
  const flatContent = (
    <div className="border-t border-border px-5 py-5 sm:px-6 space-y-8">
      {/* Instruction details */}
      <Step1Instruction
        transaction={workspace.transaction}
        customer={workspace.customer}
        createdBy={workspace.createdBy}
        canEdit={isTreasuryMaker}
        canUpload={isTreasuryMaker}
        canReplace={isTreasuryMaker && userId === workspace.transaction.created_by}
        paymentInstructions={workspace.paymentInstructions}
        eazybankzData={eazybankzData}
        investment={workspace.investment}
        sourceDocument={
          workspace.documents.findLast((d) => d.document_type === 'INSTRUCTION') ?? null
        }
      />

      {/* Signature verification form */}
      <Step2SignatureVerification
        transactionId={workspace.transaction.id}
        signatureVerification={workspace.signatureVerification}
        canAct={isTreasuryMaker}
        auditVerification={workspace.auditVerification}
        canAuditAct={canAuditAct}
        existingDocument={
          workspace.documents.findLast((d) => d.document_type === "MANDATE") ?? null
        }
      />

      {/* Customer confirmation form */}
      <Step3CustomerConfirmation
        transactionId={workspace.transaction.id}
        officerName={workspace.createdBy?.full_name ?? "Treasury Officer"}
        requiresBeneficiary={requiresBeneficiary(workspace.transaction.transaction_type)}
        customerConfirmation={workspace.customerConfirmation}
        canAct={isTreasuryMaker}
      />

      {/* Investment verification form */}
      <Step4InvestmentVerification
        transactionId={workspace.transaction.id}
        eazybankzData={eazybankzData}
        investmentVerification={workspace.investmentVerification}
        canAct={isTreasuryMaker}
        existingDocument={
          workspace.documents.find((d) => d.document_type === "EVIDENCE") ?? null
        }
      />

      {/* Voucher preparation form */}
      <Step5VoucherGeneration
        transactionId={workspace.transaction.id}
        transactionType={workspace.transaction.transaction_type}
        transactionStatus={workspace.transaction.status}
        scenarioCode={workspace.transaction.scenario_code}
        investmentVerification={workspace.investmentVerification}
        voucher={workspace.voucher}
        canAct={isTreasuryMaker}
        existingPaymentInstruction={workspace.paymentInstructions?.[0] ?? null}
        existingDocument={
          workspace.documents.find((d) => d.document_type === "SIGNED_FORM") ?? null
        }
      />
    </div>
  );

  return (
    <section aria-label="Instruction, Verification & Voucher" className={borderClasses}>
      {sectionState === "completed" ? (
        <details>
          <summary
            className={`${headerClasses} cursor-pointer list-none select-none marker:hidden`}
          >
            {badge}
            <span className="flex-1 text-sm font-medium">Instruction &amp; Verification</span>
            <span className="text-xs text-muted-foreground">Completed</span>
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
          </summary>
          {flatContent}
        </details>
      ) : sectionState === "active" ? (
        <>
          <div className={`${headerClasses} cursor-default`}>
            {badge}
            <span className="flex-1 text-sm font-medium">Instruction &amp; Verification</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              In progress
            </span>
          </div>
          {flatContent}
        </>
      ) : (
        <>
          <div className={`${headerClasses} cursor-default`}>
            {badge}
            <span className="flex-1 text-sm font-medium">Instruction &amp; Verification</span>
            <span className="text-xs text-muted-foreground">Locked</span>
          </div>
          {lockedReason && (
            <div className="border-t border-border/50 px-5 py-3 sm:px-6">
              <p className="text-xs text-muted-foreground italic">
                {lockedReason}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Step content renderer (approval chain — step 2) ─────────────────────────

interface StepContentProps {
  step: StepMeta;
  workspace: TransactionWorkspace;
  userRole: string | null;
  userId: string | null;
  eazybankzData: import("@/lib/services/eazybankz").EazybankzInvestment | null;
}

function StepContent({
  step,
  workspace,
  userId,
  userRole,
}: StepContentProps) {
  // step.id === 2 → Approval Chain
  return (
    <Step6ApprovalChain
      transactionId={workspace.transaction.id}
      transactionStatus={workspace.transaction.status}
      transactionCreatedBy={workspace.transaction.created_by}
      approvals={workspace.approvals}
      currentUserId={userId ?? ""}
      currentUserRole={userRole}
      auditChecklistDone={!!workspace.auditVerification}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TransactionWorkspacePage({ params }: PageProps) {
  const { id } = await params;
  // Load workspace data server-side
  const result = await getTransactionWorkspaceAction(id);


  if (!result.success) {
    if (result.error === 'Not authenticated.') {
      redirect('/auth/login')
    }
    notFound();
  }

  const workspace = result.data;

  // Resolve role server-side for RBAC checks in step panels
  const user = await getAuthenticatedUser();
  const userRole = user ? await resolveUserRole(user.id) : null;
  const userId = user?.id ?? null;

  console.log(userId,"USER")

  // Fetch Eazybankz investment data server-side for Step 4 (Req 10.1, 30.4).
  // Uses the external_reference from the linked investment record, if present.
  // Falls back to null on any EazybankzError so the page degrades gracefully
  // (Step 4 will display a manual-entry warning instead of crashing).
  const externalRef = workspace.investment?.external_reference ?? null;
  let eazybankzData:
    | import("@/lib/services/eazybankz").EazybankzInvestment
    | null = null;
  if (externalRef) {
    try {
      eazybankzData = await eazybankzAdapter.getInvestment(externalRef);
    } catch (err) {
      if (!(err instanceof EazybankzError)) throw err;
      // EazybankzError (NOT_FOUND, SIMULATED_FAILURE, etc.) — degrade gracefully.
      // Step 4 will show the manual-entry fallback notice to the Treasury Officer.
      console.warn(
        `[Step4] Eazybankz lookup failed for ref "${externalRef}": [${err.code}] ${err.message}`
      );
    }
  }

  // Build step metadata from current transaction status
  const steps = buildStepsMeta(
    workspace.transaction.status,
    workspace.signatureVerification?.signature_result ?? null
  );

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
        <main
          className="flex flex-1 min-w-0 flex-col gap-4"
          aria-label="Transaction workspace"
        >
          {/* Steps 1–5 — Instruction, Verification & Voucher (one section, treasury maker) */}
          <VerificationSection
            steps={steps}
            workspace={workspace}
            userRole={userRole}
            userId={userId}
            eazybankzData={eazybankzData}
          />

          {/* Step 2 — Approval Chain (Head Treasury → MIS → Audit → MD) */}
          {steps.slice(1).map((step) => (
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

          {/* Operations execution panel — visible once MD has approved (Req 14.3, 14.6) */}
          {(workspace.transaction.status === "MD_APPROVED" ||
            workspace.transaction.status === "OPERATIONS_PROCESSING" ||
            workspace.transaction.status === "OPERATIONS_COMPLETED" ||
            workspace.transaction.status === "TREASURY_CONFIRMED" ||
            workspace.transaction.status === "COMPLETED" ||
            workspace.operationsExecution !== null) && (
            <section
              aria-label="Operations execution"
              className="rounded-xl border border-border bg-background"
            >
              {/* Section header */}
              <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
                <span
                  className={[
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    workspace.operationsExecution
                      ? "bg-emerald-500 text-white"
                      : "bg-primary text-primary-foreground",
                  ].join(" ")}
                  aria-hidden
                >
                  {workspace.operationsExecution ? "✓" : "7"}
                </span>
                <span className="flex-1 text-sm font-medium">
                  Operations Execution
                </span>
                {workspace.operationsExecution ? (
                  <span className="text-xs text-muted-foreground">
                    Completed
                  </span>
                ) : (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    In progress
                  </span>
                )}
              </div>
              {/* Panel content */}
              <div className="px-5 py-4 sm:px-6">
                <OperationsExecutionPanel
                  transactionId={workspace.transaction.id}
                  transactionStatus={workspace.transaction.status}
                  operationsExecution={workspace.operationsExecution}
                  canAct={userRole === "OPERATIONS" || userRole === "ADMIN"}
                />
              </div>
            </section>
          )}

          {/* Treasury completion confirmation — visible once Operations has completed (Req 15.1, 15.2, 15.3) */}
          {(workspace.transaction.status === "OPERATIONS_COMPLETED" ||
            workspace.transaction.status === "TREASURY_CONFIRMED" ||
            workspace.transaction.status === "COMPLETED") && (
            <section
              aria-label="Treasury completion confirmation"
              className="rounded-xl border border-border bg-background"
            >
              {/* Section header */}
              <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
                <span
                  className={[
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    workspace.transaction.status === "TREASURY_CONFIRMED" ||
                    workspace.transaction.status === "COMPLETED"
                      ? "bg-emerald-500 text-white"
                      : "bg-primary text-primary-foreground",
                  ].join(" ")}
                  aria-hidden
                >
                  {workspace.transaction.status === "TREASURY_CONFIRMED" ||
                  workspace.transaction.status === "COMPLETED"
                    ? "✓"
                    : "8"}
                </span>
                <span className="flex-1 text-sm font-medium">
                  Treasury Completion
                </span>
                {workspace.transaction.status === "TREASURY_CONFIRMED" ||
                workspace.transaction.status === "COMPLETED" ? (
                  <span className="text-xs text-muted-foreground">
                    Confirmed
                  </span>
                ) : (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Pending confirmation
                  </span>
                )}
              </div>
              {/* Panel content */}
              <div className="px-5 py-4 sm:px-6">
                <TreasuryCompletionPanel
                  transactionId={workspace.transaction.id}
                  transactionStatus={workspace.transaction.status}
                  canAct={
                    userRole === "TREASURY_OFFICER" || userRole === "ADMIN"
                  }
                  operationsCompletedAt={
                    workspace.operationsExecution?.executed_at ?? null
                  }
                />
              </div>
            </section>
          )}
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
  );
}
