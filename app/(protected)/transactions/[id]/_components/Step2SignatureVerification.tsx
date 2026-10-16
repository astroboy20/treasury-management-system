"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckCircle2, WifiOff, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { verifySignatureAction, recordAuditVerificationAction } from "@/lib/actions/verification.actions";
import {
  SignatureVerificationSchema,
  type SignatureVerificationInput,
  type CheckResult,
} from "@/lib/schemas/verification.schema";
import type { TransactionWorkspace } from "@/lib/services/transaction.service";
import { useNetworkStatus } from "@/lib/hooks/useNetworkStatus";
import { enqueue } from "@/lib/offline/queue";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Step2SignatureVerificationProps {
  transactionId: string;
  /** Treasury Officer's verification record — if present, treasury form is read-only */
  signatureVerification: TransactionWorkspace["signatureVerification"];
  /** Whether the current user is a TREASURY_OFFICER or ADMIN */
  canAct: boolean;
  /** Audit Officer's verification record */
  auditVerification: TransactionWorkspace["auditVerification"];
  /** Whether the current user is an AUDIT officer or ADMIN and the stage is active */
  canAuditAct: boolean;
  /** Previously uploaded mandate document, if any */
  existingDocument?: import("@/components/treasury/DocumentUpload").UploadedDocument | null;
}

// ─── Checklist item config ────────────────────────────────────────────────────

interface ChecklistItem {
  field: keyof Omit<SignatureVerificationInput, "notes">;
  label: string;
  description: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    field: "signatureResult",
    label: "Signature Match",
    description: "Customer signature matches the mandate card on file.",
  },
  {
    field: "mandateResult",
    label: "Mandate Check",
    description: "Mandate requirements are satisfied for this transaction type.",
  },
  {
    field: "accountOwnershipResult",
    label: "Account Ownership",
    description: "Beneficiary account ownership has been verified.",
  },
  {
    field: "completenessResult",
    label: "Instruction Completeness",
    description: "All required fields in the instruction are present and valid.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function ResultBadge({ result }: { result: string }) {
  const isPassed = result === "PASSED";
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        isPassed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
      ].join(" ")}
    >
      {isPassed ? <CheckCircle2 className="size-3" aria-hidden /> : <XCircle className="size-3" aria-hidden />}
      {isPassed ? "Passed" : "Failed"}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">
        {value ?? <span className="italic text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

interface ToggleRowProps {
  item: ChecklistItem;
  value: CheckResult;
  onChange: (val: CheckResult) => void;
  disabled: boolean;
}

function ToggleRow({ item, value, onChange, disabled }: ToggleRowProps) {
  const isPassed = value === "PASSED";
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors",
        isPassed ? "border-emerald-200 bg-emerald-50/50" : "border-border bg-background",
      ].join(" ")}
    >
      <div
        className="min-w-0 flex-1 cursor-pointer"
        onClick={() => onChange(isPassed ? "FAILED" : "PASSED")}
      >
        <p className="text-sm font-medium text-foreground">{item.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
      </div>
      <button
        type="button"
        role="checkbox"
        aria-checked={isPassed}
        aria-label={`${item.label}: ${isPassed ? "Passed" : "Failed"}`}
        disabled={disabled}
        onClick={() => onChange(isPassed ? "FAILED" : "PASSED")}
        className={[
          "flex shrink-0 items-center justify-center rounded-full border-2 size-8 transition-colors",
          isPassed
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-border bg-muted text-muted-foreground",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer [@media(hover:hover)_and_(pointer:fine)]:hover:border-emerald-400",
        ].join(" ")}
      >
        {isPassed ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

// ─── Read-only checklist grid ─────────────────────────────────────────────────

function ChecklistResults({
  signatureResult,
  mandateResult,
  accountOwnershipResult,
  completenessResult,
}: {
  signatureResult: string;
  mandateResult: string;
  accountOwnershipResult: string;
  completenessResult: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[
        { label: "Signature Match",          result: signatureResult },
        { label: "Mandate Check",            result: mandateResult },
        { label: "Account Ownership",        result: accountOwnershipResult },
        { label: "Instruction Completeness", result: completenessResult },
      ].map(({ label, result }) => (
        <div
          key={label}
          className={[
            "flex items-center justify-between gap-3 rounded-lg border p-3",
            result === "PASSED" ? "border-emerald-200 bg-emerald-50/50" : "border-border bg-muted/30",
          ].join(" ")}
        >
          <span className="text-sm text-foreground">{label}</span>
          <ResultBadge result={result} />
        </div>
      ))}
    </div>
  );
}

// ─── Audit checklist form (inline, same style as treasury form) ───────────────

interface AuditChecklistFormProps {
  transactionId: string;
  auditVerification: TransactionWorkspace["auditVerification"];
  canAuditAct: boolean;
}

function AuditChecklistForm({ transactionId, auditVerification, canAuditAct }: AuditChecklistFormProps) {
  const [submitting, setSubmitting] = useState(false);

  const {
    handleSubmit,
    watch,
    setValue,
    register,
    formState: { errors },
  } = useForm<SignatureVerificationInput>({
    resolver: zodResolver(SignatureVerificationSchema),
    defaultValues: {
      signatureResult:        auditVerification?.signature_result         as CheckResult ?? "FAILED",
      mandateResult:          auditVerification?.mandate_result           as CheckResult ?? "FAILED",
      accountOwnershipResult: auditVerification?.account_ownership_result as CheckResult ?? "FAILED",
      completenessResult:     auditVerification?.completeness_result      as CheckResult ?? "FAILED",
      notes:                  auditVerification?.notes ?? "",
    },
  });

  const watchedValues = watch();

  async function onSubmit(data: SignatureVerificationInput) {
    setSubmitting(true);
    const result = await recordAuditVerificationAction(transactionId, data);
    setSubmitting(false);

    if (result.success) {
      toast.success("Audit verification checklist saved.");
    } else {
      toast.error(result.error ?? "Failed to save. Please try again.");
    }
  }

  // Read-only view once submitted (but still shows the form pre-filled for updates)
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        {CHECKLIST_ITEMS.map((item) => (
          <ToggleRow
            key={item.field}
            item={item}
            value={watchedValues[item.field] ?? "FAILED"}
            onChange={(val) => setValue(item.field, val, { shouldValidate: true })}
            disabled={!canAuditAct || submitting}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audit-sig-notes" className="text-xs font-medium text-muted-foreground">
          Notes{" "}
          <span className="font-normal text-muted-foreground/70">(optional, max 1 000 chars)</span>
        </Label>
        <Textarea
          id="audit-sig-notes"
          rows={3}
          maxLength={1000}
          disabled={!canAuditAct || submitting}
          placeholder="Add any notes about your audit review…"
          {...register("notes")}
          aria-describedby={errors.notes ? "audit-sig-notes-error" : undefined}
          className="resize-none text-sm"
        />
        {errors.notes && (
          <p id="audit-sig-notes-error" className="text-xs text-destructive" role="alert">
            {errors.notes.message}
          </p>
        )}
      </div>

      {canAuditAct ? (
        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={submitting} size="sm">
            {submitting ? "Saving…" : auditVerification ? "Update Verification" : "Submit Verification"}
          </Button>
        </div>
      ) : (
        <p className="text-xs italic text-muted-foreground">
          Only an Audit Officer can submit this verification.
        </p>
      )}
    </form>
  );
}

// ─── Entry animation styles ───────────────────────────────────────────────────

const PANEL_ANIMATION_STYLE = `
  @keyframes sigFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes sigFadeInFull {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .sig-panel {
    animation: sigFadeIn 200ms ease-out both;
  }
  @media (not (prefers-reduced-motion: reduce)) {
    .sig-panel {
      animation: sigFadeInFull 200ms ease-out both;
    }
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 2 — Signature Verification Panel.
 *
 * Treasury Officer fills in the 4-item checklist first (Step 1 of the normal
 * flow). Later, when the Audit Officer reaches their approval stage (MIS_APPROVED),
 * the same panel shows a second identical checklist for the Audit Officer to
 * complete independently. Both records are preserved with their respective
 * performer names and timestamps.
 *
 * Read-only display once both records are submitted.
 * Requirements: 8.1–8.5
 */
export default function Step2SignatureVerification({
  transactionId,
  signatureVerification,
  canAct,
  auditVerification,
  canAuditAct,
  existingDocument: _existingDocument,
}: Step2SignatureVerificationProps) {
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // undefined = not yet hydrated → treat as online to avoid flicker
  const networkStatus = useNetworkStatus();
  const isOnline = networkStatus !== false;

  const {
    handleSubmit,
    watch,
    setValue,
    register,
    formState: { errors },
  } = useForm<SignatureVerificationInput>({
    resolver: zodResolver(SignatureVerificationSchema),
    defaultValues: {
      signatureResult: "FAILED",
      mandateResult: "FAILED",
      accountOwnershipResult: "FAILED",
      completenessResult: "FAILED",
    },
  });

  const watchedValues = watch();

  async function onSubmit(data: SignatureVerificationInput) {
    setSubmitting(true);
    setServerError(null);

    if (!isOnline) {
      await enqueue({ type: "VERIFY_SIGNATURE", payload: { transactionId, input: data } });
      setSubmitting(false);
      toast.warning("You're offline. Verification saved and will be submitted when you reconnect.");
      return;
    }

    const result = await verifySignatureAction(transactionId, data);
    setSubmitting(false);

    if (result.success) {
      toast.success("Signature verification submitted successfully.");
    } else {
      const msg = result.error ?? "Submission failed. Please try again.";
      setServerError(msg);
      toast.error(msg);
    }
  }

  // ── Read-only mode (Treasury record exists) ─────────────────────────────────

  if (signatureVerification) {
    const {
      signature_result,
      mandate_result,
      account_ownership_result,
      completeness_result,
      notes,
      verified_at,
      verifier,
    } = signatureVerification;

    const anyFailed =
      signature_result === "FAILED" ||
      mandate_result === "FAILED" ||
      account_ownership_result === "FAILED" ||
      completeness_result === "FAILED";

    return (
      <div className="sig-panel space-y-5">
        <style>{PANEL_ANIMATION_STYLE}</style>

        {/* Downstream lock alert */}
        {anyFailed && (
          <Alert variant="destructive">
            <AlertTitle>Signature Verification Failed</AlertTitle>
            <AlertDescription>
              One or more verification checks failed. Steps 3–6 are locked until
              this transaction is reviewed.
            </AlertDescription>
          </Alert>
        )}

        {/* ── Treasury Officer record ── */}
        <div className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Checklist Results
          </p>
          <ChecklistResults
            signatureResult={signature_result}
            mandateResult={mandate_result}
            accountOwnershipResult={account_ownership_result}
            completenessResult={completeness_result}
          />

          <dl className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Verified By"
              value={verifier?.full_name ?? signatureVerification.verified_by}
            />
            <Field label="Verified At" value={formatDate(verified_at)} />
            {notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">{notes}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* ── Audit Officer section ── */}
        {/* Show when: audit officer is the actor (canAuditAct) OR a record already exists */}
        {(canAuditAct || auditVerification) && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Audit Officer Verification
                </p>
                {auditVerification && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="size-3" aria-hidden />
                    Completed
                  </span>
                )}
              </div>

              {/* If audit record exists — show results first, then allow update if still active */}
              {auditVerification && (
                <div className="space-y-3">
                  <ChecklistResults
                    signatureResult={auditVerification.signature_result}
                    mandateResult={auditVerification.mandate_result}
                    accountOwnershipResult={auditVerification.account_ownership_result}
                    completenessResult={auditVerification.completeness_result}
                  />
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Verified By"
                      value={auditVerification.verifier?.full_name ?? auditVerification.verified_by}
                    />
                    <Field label="Verified At" value={formatDate(auditVerification.verified_at)} />
                    {auditVerification.notes && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                          {auditVerification.notes}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Audit form — shown when it's the audit officer's turn */}
              {canAuditAct && (
                <>
                  {auditVerification && <Separator className="my-2" />}
                  <AuditChecklistForm
                    transactionId={transactionId}
                    auditVerification={auditVerification}
                    canAuditAct={canAuditAct}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Form mode (Treasury Officer hasn't submitted yet) ───────────────────────

  return (
    <div className="sig-panel space-y-4">
      <style>{PANEL_ANIMATION_STYLE}</style>

      {serverError && (
        <Alert variant="destructive">
          <AlertTitle>Submission Error</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Verification Checklist
          </p>
          {CHECKLIST_ITEMS.map((item) => (
            <ToggleRow
              key={item.field}
              item={item}
              value={watchedValues[item.field] ?? "FAILED"}
              onChange={(val) => setValue(item.field, val, { shouldValidate: true })}
              disabled={!canAct || submitting}
            />
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sig-notes" className="text-xs font-medium text-muted-foreground">
            Notes{" "}
            <span className="font-normal text-muted-foreground/70">(optional, max 1 000 chars)</span>
          </Label>
          <Textarea
            id="sig-notes"
            rows={3}
            maxLength={1000}
            disabled={!canAct || submitting}
            placeholder="Add any notes about this verification…"
            {...register("notes")}
            aria-describedby={errors.notes ? "sig-notes-error" : undefined}
            className="resize-none text-sm"
          />
          {errors.notes && (
            <p id="sig-notes-error" className="text-xs text-destructive" role="alert">
              {errors.notes.message}
            </p>
          )}
        </div>

        {canAct ? (
          <div className="flex flex-col gap-1.5 items-end pt-1">
            {!isOnline && (
              <span className="flex items-center gap-1.5 text-xs text-amber-700">
                <WifiOff className="size-3.5" aria-hidden />
                Offline — will sync on reconnect
              </span>
            )}
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? "Submitting…" : isOnline ? "Submit Verification" : "Save for later"}
            </Button>
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Only a Treasury Officer can submit signature verification.
          </p>
        )}
      </form>
    </div>
  );
}
