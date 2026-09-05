# Implementation Plan: Greenline Treasury Platform

## Overview

Seven phases build the platform incrementally from database foundation through full production hardening. Each phase produces a working vertical slice. Phase 2 produces the first end-to-end runnable transaction; subsequent phases extend coverage to all scenarios and operational concerns.

All code is TypeScript. The stack is Next.js 16 App Router + React 19 + Tailwind CSS v4 + Supabase (PostgreSQL + Auth + Storage + Realtime) + shadcn/ui + React Hook Form + Zod + Sonner.

---

## Tasks

- [-] 1. Phase 1 — Foundation
  - [x] 1.1 Install required shadcn/ui components
    - Run `pnpm dlx shadcn@latest add sonner alert dialog form badge input label select textarea separator skeleton dropdown-menu avatar` to add all components needed across the platform.
    - Confirm each component file lands in `components/ui/`.
    - _Requirements: 32.1, 32.2, 32.3_

  - [x] 1.2 Add Sonner `<Toaster />` to root layout
    - Import `Toaster` from `sonner` in `app/layout.tsx`.
    - Mount `<Toaster position="bottom-right" richColors />` at the end of `<body>`.
    - _Requirements: 32.1_

  - [x] 1.3 Create Supabase migration 001 — full schema (18 tables)
    - Create `supabase/migrations/001_schema.sql`.
    - Define all 18 tables in dependency order: `profiles`, `roles`, `user_roles`, `customers`, `customer_accounts`, `investments`, `treasury_transactions`, `payment_instructions`, `signature_verifications`, `customer_confirmations`, `investment_verifications`, `vouchers`, `rollover_details`, `pre_liquidation_details`, `approvals`, `operations_executions`, `audit_events`, `transaction_documents`.
    - All monetary/rate columns must use `NUMERIC` — never `FLOAT` or `DOUBLE PRECISION`.
    - Include all FK constraints, UNIQUE constraints, and indexes documented in the design: `treasury_transactions(status)`, `treasury_transactions(transaction_type)`, `treasury_transactions(customer_id)`, `treasury_transactions(created_at DESC)`, `approvals(transaction_id, stage)`, `audit_events(transaction_id, created_at ASC)`, `investments(customer_id, status)`, `operations_executions(transaction_id)`.
    - Include `UNIQUE(transaction_id, stage)` on `approvals`.
    - Add a `notifications` table (table 19) per the design: `id UUID PK`, `recipient_id UUID FK → profiles.id`, `transaction_id UUID FK → treasury_transactions.id`, `event_type TEXT NOT NULL`, `message TEXT NOT NULL`, `is_read BOOLEAN DEFAULT false`, `created_at TIMESTAMPTZ DEFAULT NOW()`; index on `(recipient_id, is_read, created_at DESC)`.
    - Add an `sla_config` table: `id UUID PK`, `transaction_type TEXT NOT NULL UNIQUE`, `sla_hours INTEGER NOT NULL DEFAULT 8`, `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.4 Create Supabase migration 002 — RLS policies
    - Create `supabase/migrations/002_rls.sql`.
    - Enable RLS on every table created in migration 001.
    - Create `get_user_role()` helper function (`SECURITY DEFINER`, returns `TEXT`, queries `user_roles JOIN roles` for `auth.uid()`).
    - Implement per-table policies exactly as specified in the design's "Supabase RLS Policy Design" section:
      - `profiles`: own row SELECT/UPDATE; ADMIN reads all; INSERT/DELETE via trigger only.
      - `roles`: authenticated SELECT; ADMIN INSERT/UPDATE/DELETE.
      - `user_roles`: own rows SELECT; ADMIN all; INSERT/DELETE ADMIN only.
      - `customers`, `customer_accounts`, `investments`: SELECT for all staff roles; INSERT/UPDATE for TREASURY_OFFICER, OPERATIONS, ADMIN; DELETE for ADMIN only.
      - `treasury_transactions`: role-scoped SELECT policy; INSERT via RPC; UPDATE/DELETE DENIED for all app roles.
      - `signature_verifications`, `customer_confirmations`, `investment_verifications`: SELECT for treasury/approver roles; INSERT via RPC; UPDATE/DELETE DENIED.
      - `vouchers`: SELECT for TREASURY_OFFICER, HEAD_TREASURY, MIS, AUDIT, MD, OPERATIONS, ADMIN; INSERT via RPC; UPDATE DENIED once `status = 'FINALISED'`.
      - `approvals`: SELECT for any role that can view the transaction; INSERT/UPDATE/DELETE DENIED for authenticated — via RPC only.
      - `operations_executions`: SELECT for OPERATIONS, TREASURY_OFFICER, ADMIN; INSERT via RPC.
      - `audit_events`: SELECT for AUDIT, ADMIN (all); other roles can read events for their accessible transactions; `REVOKE UPDATE, DELETE ON audit_events FROM authenticated; REVOKE UPDATE, DELETE ON audit_events FROM anon;`.
      - `transaction_documents`: SELECT only if user has authorised relationship to transaction.
      - `payment_instructions`: SELECT for treasury/approver/operations roles; INSERT/UPDATE via RPC.
      - `notifications`: SELECT/UPDATE own rows; INSERT via trigger.
    - Storage policies for `transaction-documents` bucket: `document_read` and `document_upload` policies as specified in the design.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 35.2_

  - [x] 1.5 Create Supabase migration 003 — PostgreSQL RPC functions
    - Create `supabase/migrations/003_rpc.sql`.
    - Implement all 9 `SECURITY DEFINER` RPC functions, each following the standard template (resolve actor role → load tx with FOR UPDATE → validate state/role → mutate + audit event → return JSONB):
      - `create_treasury_transaction(p_customer_id, p_investment_id, p_transaction_type, p_scenario_code, p_requested_amount, p_purpose, p_source_type, p_payment_instruction)` → `{ transaction_id, transaction_reference, status }`. Generates `TRX-XXXXX` reference server-side. Computes `sla_due_at` from `sla_config` or defaults to end-of-business-day. Writes `TRANSACTION_CREATED` audit event.
      - `verify_signature(p_transaction_id, p_signature_result, p_mandate_result, p_account_ownership_result, p_completeness_result, p_notes)` → `{ new_status, audit_event_id }`. Requires `status = 'INSTRUCTION_RECEIVED'`; writes `SIGNATURE_VERIFIED` or `SIGNATURE_FAILED` event.
      - `record_customer_confirmation(p_transaction_id, p_confirmation_status, p_confirmed_amount, p_confirmed_beneficiary, p_confirmed_purpose, p_confirmation_date, p_confirmation_time, p_notes)` → `{ new_status }`. Requires `status = 'SIGNATURE_VERIFIED'`; enforces ACCOUNT_OFFICER role.
      - `verify_investment(p_transaction_id, p_principal, p_accrued_interest, p_interest_rate, p_effective_date, p_maturity_date, p_outstanding_balance, p_available_amount)` → `{ new_status, snapshot }`. Requires `status = 'CUSTOMER_CONFIRMED'`; enforces TREASURY_OFFICER role.
      - `prepare_voucher(p_transaction_id, p_voucher_data JSONB, p_payment_instruction JSONB)` → `{ voucher_id, voucher_number }`. Server resolves `voucher_type` from `transaction_type`; frontend cannot override. Generates `voucher_number` server-side. Writes `VOUCHER_CREATED` event.
      - `approve_transaction(p_transaction_id, p_stage, p_decision, p_comments)` → `{ new_status, approval_id }`. Validates: actor role = stage role; prior stage complete; not maker; idempotent (unique constraint). Enforces RETURN/REJECT require non-empty comments. Writes `APPROVAL_GRANTED`, `APPROVAL_RETURNED`, or `APPROVAL_REJECTED` event.
      - `execute_transaction(p_transaction_id, p_execution_status, p_external_reference, p_execution_notes)` → `{ execution_id }`. Requires `status = 'MD_APPROVED'`; enforces OPERATIONS role. Idempotent via unique constraint on `operations_executions(transaction_id)`. Writes `OPERATIONS_STARTED` + `OPERATIONS_COMPLETED` events.
      - `confirm_treasury_completion(p_transaction_id)` → `{ new_status }`. Requires `status = 'OPERATIONS_COMPLETED'`; enforces TREASURY_OFFICER role. Transitions to `TREASURY_CONFIRMED` then `COMPLETED`. Sets `completed_at`. Writes `TREASURY_CONFIRMED` event.
      - `create_reversal(p_original_transaction_id, p_reversal_reason)` → `{ reversal_transaction_id, reversal_reference }`. Validates original tx is eligible (not DRAFT, CANCELLED, or already reversed). Creates new REVERSAL transaction referencing original. Writes `REVERSAL_CREATED` event. Original transaction is NOT modified.
    - _Requirements: 7.3, 8.2, 9.3, 10.3, 11.7, 12.2, 14.4, 15.2, 25.1, 33.1, 33.2, 33.3, 35.3_

  - [x] 1.6 Create Supabase migration 004 — database triggers
    - Create `supabase/migrations/004_triggers.sql`.
    - `handle_new_user()` trigger: fires `AFTER INSERT ON auth.users`; creates a `profiles` row from `NEW.raw_user_meta_data->>'full_name'` and `NEW.email`.
    - `notify_next_role()` trigger: fires `AFTER INSERT ON audit_events`; reads `NEW.to_status`; calls a helper `get_next_action_role(status TEXT)` function to resolve the next role; bulk-inserts `notifications` rows for all users with that role.
    - Implement `get_next_action_role(status TEXT) RETURNS TEXT` mapping each workflow status to its responsible role.
    - _Requirements: 3.5, 31.1_

  - [x] 1.7 Create Supabase migration 005 — seed roles table
    - Create `supabase/migrations/005_roles_seed.sql`.
    - Insert roles using `ON CONFLICT (code) DO NOTHING`: `CUSTOMER`, `ACCOUNT_OFFICER`, `TREASURY_OFFICER`, `HEAD_TREASURY`, `MIS`, `AUDIT`, `MD`, `OPERATIONS`, `ADMIN`.
    - _Requirements: 1.6_

  - [x] 1.8 Enhance middleware to redirect unauthenticated users
    - Modify `middleware.ts` to call `supabase.auth.getUser()` on every protected request.
    - Define protected route matcher: all paths except `/`, `/auth/**`, `/_next/**`, and static asset extensions.
    - Redirect to `/auth/login` if no session or on session error; never expose protected content.
    - Retain `updateSession()` call to refresh session cookies.
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 1.9 Create protected route layout with server-side profile and role loading
    - Create `app/(protected)/layout.tsx` as a server component.
    - Call `createServerClient()` and `supabase.auth.getUser()` — redirect to `/auth/login` if no user.
    - Query `user_roles JOIN roles` to resolve the user's role code; redirect to `/auth/login` if no role assigned (show "pending activation" screen instead).
    - Pass `{ user, role, profile }` to child server components via props or server-side context.
    - Migrate existing `app/dashboard/page.tsx`, `app/approvals/page.tsx`, `app/audit/page.tsx`, `app/vouchers/page.tsx` under `app/(protected)/`.
    - _Requirements: 3.7, 4.2, 5.1_

  - [x] 1.10 Wire auth login page to use shadcn Alert
    - Update `app/auth/login/page.tsx` to replace any raw `div` error display with `<Alert variant="destructive">`.
    - Display "Invalid email or password." on `invalid_credentials` error from Supabase.
    - Display "Too many attempts. Please wait a moment and try again." on HTTP 429.
    - _Requirements: 3.3, 3.4_

  - [x] 1.11 Wire auth sign-up page to use shadcn Alert
    - Update `app/auth/sign-up/page.tsx` (and consolidate the duplicate `app/auth/signup/page.tsx` if applicable).
    - Capture `full_name` and `requested_role` in the form; pass as Supabase auth metadata on sign-up.
    - Replace any raw error `div` with `<Alert variant="destructive">`.
    - After successful sign-up, show a confirmation message rather than redirecting to a protected page.
    - _Requirements: 3.5_

  - [x] 1.12 Create `lib/services/auth.service.ts`
    - Implement `resolveUserRole(userId: string): Promise<string | null>` — queries `user_roles JOIN roles` for a given user id; returns role code or null.
    - Implement `getProfile(userId: string): Promise<Profile | null>` — queries `profiles` by `id`.
    - Implement `hasPermission(role: string, action: string): boolean` — pure function that checks against the permissions map.
    - _Requirements: 5.1, 5.2_

  - [x] 1.13 Create `lib/permissions/permissions.ts`
    - Define `ROLE_PERMISSIONS` constant: a map from each role code to an array of allowed action strings (e.g., `'create_transaction'`, `'verify_signature'`, `'record_confirmation'`, `'verify_investment'`, `'prepare_voucher'`, `'approve_treasury'`, `'approve_head_treasury'`, `'approve_mis'`, `'approve_audit'`, `'approve_md'`, `'execute_transaction'`, `'confirm_completion'`, `'manage_users'`).
    - Export typed `Role` and `Permission` types derived from the map.
    - _Requirements: 5.2_

  - [x] 1.14 Create Zod schemas in `lib/schemas/`
    - Create `lib/schemas/transaction.schema.ts`: `CreateTransactionSchema` with fields `customerId`, `investmentId` (optional), `transactionType`, `scenarioCode` (optional), `requestedAmount`, `purpose`, `sourceInstructionType`, and nested `paymentInstruction` (conditional on transaction type).
    - Create `lib/schemas/verification.schema.ts`: `SignatureVerificationSchema` (four checklist items + notes); `CustomerConfirmationSchema` (date, time, amount, beneficiary, purpose, status); `InvestmentVerificationSchema` (7 investment fields).
    - Create `lib/schemas/approval.schema.ts`: `ApprovalSchema` with `stage` (enum), `decision` (enum `APPROVE | RETURN | REJECT`), `comments` (required for RETURN/REJECT via `.superRefine()`).
    - Create `lib/schemas/voucher.schema.ts`: `VoucherPreparationSchema` with discriminated union by `voucherType`; each variant requires only its applicable fields.
    - _Requirements: 7.4, 8.4, 9.2, 12.6, 26.1_

  - [x] 1.15 Replace dashboard hardcoded data with live DB queries scoped by role
    - Convert `app/(protected)/dashboard/page.tsx` to a server component.
    - Query `treasury_transactions` for four metric counts: pending-my-action (status matches current role's action stage), in-progress (status between `INSTRUCTION_RECEIVED` and `MD_APPROVED`), completed-this-week (status `COMPLETED` + sum `approved_amount`), exceptions (status IN `REJECTED`, `RETURNED`, `FAILED`, `CANCELLED`).
    - Query most recent 10 transactions for the "Recent instructions" table with columns: reference, customer name (JOIN customers), type, amount, status, current owner (derived from status → role mapping).
    - Compute SLA breach count for exceptions using `sla_due_at < NOW()`.
    - Wrap dashboard in the protected layout; remove hardcoded `rows` array.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 37.2_

  - [x] 1.16 Add Supabase Realtime subscription to dashboard for live status updates
    - Create `components/treasury/RealtimeSubscriber.tsx` as a client component.
    - Subscribe to `treasury_transactions` table changes via `supabase.channel()`.
    - On change event call `router.refresh()` to re-render the server component dashboard.
    - Mount `<RealtimeSubscriber />` inside the server component dashboard.
    - _Requirements: 6.7_

  - [x] 1.17 Create `supabase/seed.sql` — staff users, customers A–R, and negative test records
    - Insert 14 staff users into `auth.users` (7 scenario: `treasury_maker_01`, `account_officer_01`, `head_treasury_01`, `mis_officer_01`, `audit_officer_01`, `md_01`, `operations_officer_01`; 7 e2e: same names with `_e2e` suffix) with hashed passwords and `raw_user_meta_data`.
    - Assign roles in `user_roles` for all 14 users.
    - Insert customers A–R in `customers` with corresponding `customer_accounts` and `investments` records matching the seed values in the design (principals, accrued interest, rates, balances for each scenario letter).
    - Insert 5 negative test customers (`CUSTOMER_NEG_001` through `CUSTOMER_NEG_005`) for the negative test scenarios: signature mismatch, insufficient balance, incomplete instruction, customer confirmation failed, missing beneficiary.
    - Implement `reset_e2e_transactions()` PostgreSQL function that deletes all transactions created by `_e2e` users (cascade to child tables).
    - All inserts use `ON CONFLICT DO NOTHING` or `INSERT ... WHERE NOT EXISTS` for idempotency.
    - _Requirements: 34.1, 34.2, 34.3, 34.4, 39.1, 39.2, 39.3, 39.4, 39.5, 39.6_

  - [ ] 1.18 Checkpoint — Phase 1 verification
    - Verify migrations apply cleanly via `supabase db reset`.
    - Verify a test user can sign in and reach `/dashboard` showing live (empty) data.
    - Ensure all tests pass, ask the user if questions arise.

- [-] 2. Phase 2 — Core Six-Step Workflow Engine
  - [x] 2.1 Reorganise routes into `app/(protected)/` structure
    - Move `app/dashboard/`, `app/approvals/`, `app/audit/`, `app/vouchers/`, `app/transactions/` under `app/(protected)/`.
    - Remove the now-orphaned top-level `page.tsx` stubs.
    - Update any hardcoded `href` values that changed.
    - _Requirements: 4.1_

  - [x] 2.2 Create `lib/services/` service modules
    - Create `lib/services/transaction.service.ts`: `getTransaction(id)`, `listTransactions(filters, pagination)`, `getTransactionWorkspace(id)` — each queries Supabase and returns typed data.
    - Create `lib/services/workflow.service.ts`: `getWorkflowStatus(tx)`, `getRequiredStage(status)`, `canActorAct(role, tx)` — pure TS state inspection helpers used by server actions.
    - Create `lib/services/audit.service.ts`: `getAuditEvents(transactionId)` — reads `audit_events` ordered by `created_at ASC`.
    - Create `lib/services/notification.service.ts`: `getUnreadCount(userId)`, `markNotificationsRead(userId, transactionId)`.
    - _Requirements: 5.1, 28.3_

  - [x] 2.3 Create transaction list page `/transactions`
    - Create `app/(protected)/transactions/page.tsx` as a server component.
    - Accept URL search params: `type`, `status`, `from`, `to`, `customer`, `reference`, `page`, `pageSize` (10/25/50).
    - Pass params to `listTransactions()` for server-side filtering.
    - Render a paginated table with columns: Reference, Customer, Type, Requested Amount, Status badge, Current Owner, Created At, SLA indicator.
    - Include a filter bar with dropdowns for type and status, date pickers for range, and a text input for reference/customer free-text search.
    - _Requirements: 29.1, 29.2, 29.3, 29.4_

  - [x] 2.4 Create transaction creation form `/transactions/new`
    - Rewrite `app/(protected)/transactions/new/page.tsx` as a proper server/client component.
    - Use React Hook Form + `CreateTransactionSchema` for validation.
    - Fields: customer search (combobox querying `customers`), transaction type (select using all `transaction_type` values), scenario code (conditional, derived from type), requested amount, purpose, source instruction type.
    - Conditionally render external payment beneficiary fields (beneficiary name, bank name, account number, account type) when transaction type is `THIRD_PARTY_PAYMENT` with `is_internal = false`.
    - Show inline Zod field errors via `<FormMessage />`.
    - On submit call `createTransactionAction`; on success show Sonner toast and navigate to `/transactions/[id]`.
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.7_

  - [x] 2.5 Create `lib/actions/transaction.actions.ts`
    - Implement `createTransactionAction(input: CreateTransactionInput)`: validate with Zod, `getUser()`, `resolveUserRole()`, enforce TREASURY_OFFICER, call `supabase.rpc('create_treasury_transaction', {...})`, `revalidatePath('/transactions')`, return `{ success, data: { transactionId, reference } }`.
    - Implement `getTransactionWorkspaceAction(transactionId)`: load full workspace data (transaction + all step records + approvals + audit events + documents + customer + investment).
    - _Requirements: 7.3, 7.6, 5.1, 5.3_

  - [x] 2.6 Create `TransactionWorkspacePage` `/transactions/[id]`
    - Create `app/(protected)/transactions/[id]/page.tsx` as a server component.
    - Call `getTransactionWorkspaceAction(params.id)` server-side; pass hydrated data to child components.
    - Render `<WorkspaceHeader />` (reference, customer, type, amount, status, SLA).
    - Render `<StepProgressTracker />`.
    - Render step panels 1–6 in order; completed steps are read-only/collapsed; active step is expanded.
    - Render `<WorkspaceSidebar />` on the right.
    - Render `<AuditTimeline />` at the bottom.
    - No client-side data fetching — all data is server-loaded.
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6_

  - [x] 2.7 Create `StepProgressTracker` component
    - Create `app/(protected)/transactions/[id]/_components/StepProgressTracker.tsx`.
    - Props: `currentStatus: string`, `steps: StepMeta[]`.
    - Visual states per step: `completed` (green ✓), `active` (primary ●), `locked` (muted 🔒 with tooltip explaining prerequisite).
    - Animation: stagger 40ms per step on mount; each step: `scale(0.95) opacity(0)` → `scale(1) opacity(1)`, 200ms ease-out.
    - `prefers-reduced-motion`: skip transform, keep opacity fade only.
    - _Requirements: 16.1, 32.4, 32.5, 32.6, 32.9_

  - [x] 2.8 Create `WorkspaceSidebar` component
    - Create `app/(protected)/transactions/[id]/_components/WorkspaceSidebar.tsx`.
    - Display: current owner (role responsible for next action), current approval stage, `<SlaIndicator />`, linked documents with signed URL links.
    - Create `components/treasury/SlaIndicator.tsx`: green/amber/red states based on `sla_due_at` vs `now`; computed server-side.
    - _Requirements: 16.3, 37.3_

  - [x] 2.9 Create `AuditTimeline` component
    - Create `app/(protected)/transactions/[id]/_components/AuditTimeline.tsx`.
    - Renders `audit_events` in chronological ASC order; each row: timestamp (relative + absolute on hover), event type pill badge, actor name, from→to status arrow, expandable metadata section.
    - Entry animation: stagger 30ms per event, `translateY(6px) opacity(0)` → `translateY(0) opacity(1)`, 180ms ease-out.
    - `prefers-reduced-motion`: skip translateY, keep opacity only.
    - Read-only: no edit or delete controls rendered.
    - _Requirements: 16.4, 28.3, 28.4, 32.4, 32.5, 32.9_

  - [x] 2.10 Create Step 1 panel — InstructionPanel
    - Create `app/(protected)/transactions/[id]/_components/Step1Instruction.tsx`.
    - Read-only view of the submitted instruction: customer name and number, transaction type, scenario code, requested amount, purpose, source instruction type, transaction reference, created by, created at.
    - Marked `completed` visually once `status !== 'DRAFT'`.
    - _Requirements: 16.2_

  - [x] 2.11 Create Step 2 panel — SignatureVerificationPanel
    - Create `app/(protected)/transactions/[id]/_components/Step2SignatureVerification.tsx`.
    - Checklist form with four toggle items: signature match, mandate check, account ownership check, instruction completeness.
    - Notes textarea (optional).
    - Submit calls `verifySignatureAction`; show Sonner toast on result.
    - If `signature_result === 'FAILED'`: show `<Alert>` explaining the downstream lock; step 3–6 rendered as locked.
    - Panel is read-only once verification exists.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 2.12 Create `lib/actions/verification.actions.ts` — signature + confirmation + investment
    - `verifySignatureAction(transactionId, input: SignatureVerificationInput)`: Zod-validate, `getUser()`, `resolveUserRole()`, enforce TREASURY_OFFICER, call `supabase.rpc('verify_signature', {...})`, `revalidatePath`, return result.
    - `recordCustomerConfirmationAction(transactionId, input: CustomerConfirmationInput)`: enforce ACCOUNT_OFFICER, call `supabase.rpc('record_customer_confirmation', {...})`.
    - `verifyInvestmentAction(transactionId, input: InvestmentVerificationInput)`: enforce TREASURY_OFFICER, call `supabase.rpc('verify_investment', {...})`.
    - Each returns `{ success, data: { newStatus }, error? }`.
    - _Requirements: 8.6, 9.6, 10.6, 5.3_

  - [x] 2.13 Create Step 3 panel — CustomerConfirmationPanel
    - Create `app/(protected)/transactions/[id]/_components/Step3CustomerConfirmation.tsx`.
    - Call customer using registered phone number.
    - Form: officer name (pre-filled, read-only), confirmation date, confirmation time, confirmed amount, confirmed beneficiary (conditional), confirmed purpose, confirmation status (CONFIRMED / FAILED / UNREACHABLE).
    - Use React Hook Form + `CustomerConfirmationSchema`.
    - Visible and actionable only for ACCOUNT_OFFICER role.
    - On submit call `recordCustomerConfirmationAction`; show toast.
    - If status `FAILED` or `UNREACHABLE`: show `<Alert>` with exception notice; Step 4 locked.
    - Read-only once confirmation exists.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 2.14 Create Step 4 panel — InvestmentVerificationPanel
    - Create `app/(protected)/transactions/[id]/_components/Step4InvestmentVerification.tsx`.
    - Display Eazybankz-sourced investment data (fetched via `eazybankzAdapter.getInvestment()` server-side) as pre-filled reference values.
    - Form with 7 confirmation fields: principal, accrued interest, interest rate, effective date, maturity date, outstanding balance, available amount.
    - Use React Hook Form + `InvestmentVerificationSchema`.
    - Visible and actionable only for TREASURY_OFFICER role.
    - On submit call `verifyInvestmentAction`; show toast; show immutable snapshot on completion.
    - Read-only once snapshot exists.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 2.15 Create `lib/services/calculation.service.ts`
    - Define `CalculationSnapshot` interface and `CalculationRule` type per design.
    - Implement `calculatePreLiquidation(accruedInterest, requestedPayout?)`: calls PostgreSQL RPC for authoritative result; returns snapshot + `charge`, `netInterest`, `remainingPrincipal?`, `rebookedPrincipal?`.
    - Implement `calculateRollover(type, principal, interestDue, requestedPayout?)`: returns snapshot + `rolloverAmount`, `interestPaid?`, `principalRolled?`.
    - Implement `calculateThirdPartyCharge(transferAmount, isInternal)`: returns snapshot + `transferCharge` (0 if internal), `netAmount`.
    - Implement `calculateAnniversaryPayment(principal, interestRate, frequencyDays: 30|60|90)`: returns snapshot + `interestDue`.
    - Implement `calculateMaturityTermination(principal, accruedInterest)`: returns snapshot + `netAmount` (WHT = 0 per SOP).
    - All inputs are NUMERIC-compatible strings; no JS floating-point as authoritative result.
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_

  - [x] 2.16 Write property test — `calculatePreLiquidation` SOP example
    - **Property 1: Pre-liquidation charge is always exactly 20% of accrued interest**
    - For any valid accrued interest value, `charge = accrued_interest × 0.20` and `net_interest = accrued_interest - charge`.
    - Must reproduce the SOP canonical example exactly: accrued interest ₦1,500,000 → charge ₦300,000 → net interest ₦1,200,000.
    - Use fast-check or vitest property helpers; generate arbitrary NUMERIC-compatible string inputs in the range [0, 999_999_999].
    - _Requirements: 26.6, 19.1_

  - [x] 2.17 Write property test — `calculateThirdPartyCharge`
    - **Property 2: External transfer charge is always exactly 0.10% of transfer amount; internal charge is always exactly zero**
    - For any `isInternal = true`, `transferCharge` must equal `"0"`.
    - For any `isInternal = false` and `transferAmount > 0`, `transferCharge` must equal `transferAmount × 0.001` and be > 0.
    - _Requirements: 21.2, 21.3_

  - [x] 2.18 Create Step 5 panel — VoucherPanel
    - Create `app/(protected)/transactions/[id]/_components/Step5VoucherGeneration.tsx`.
    - Display auto-determined voucher type (read from server; not user-selectable).
    - Show calculation preview using the investment verification snapshot.
    - Form: transfer date, remarks, and any type-specific overridable fields (e.g., new tenor/rate for rollovers).
    - Payment Instruction sub-form for scenarios requiring external payment (enforced per Req 36).
    - On submit call `prepareVoucherAction`; show toast; show finalised voucher on completion.
    - Render appropriate `<VoucherDisplay />` component once voucher is created.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x] 2.19 Create `lib/actions/voucher.actions.ts`
    - Implement `prepareVoucherAction(transactionId, input: VoucherPreparationInput)`: Zod-validate, `getUser()`, `resolveUserRole()`, enforce TREASURY_OFFICER, call `lib/services/calculation.service.ts` for server-authoritative calculation, call `supabase.rpc('prepare_voucher', {...})`, `revalidatePath`, return `{ success, data: { voucherId, voucherNumber } }`.
    - _Requirements: 11.7, 26.4_

  - [x] 2.20 Create voucher display components
    - Create `components/treasury/VoucherDisplay.tsx`: switches on `voucher_type` to render the correct layout.
    - `FundsOutVoucher`: voucher number, principal, interest, WHT, charge, net amount, transfer date, remarks, + `<PaymentInstructionBlock />`.
    - `FundsInVoucher`: customer name, amount, rate, tenor, effective date, maturity date.
    - `RolloverSlipVoucher`: principal amount, interest due, effective date, new tenor, new rate, rollover amount, rollover maturity date, + optional `<PaymentInstructionBlock />`.
    - `TransferSlipVoucher`: applicable transfer fields per scenario.
    - `SavingsFundsOutVoucher`: `available_balance` as primary field, transfer date, remarks, + `<PaymentInstructionBlock />` if external.
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 38.2_

  - [x] 2.21 Create `PaymentInstructionBlock` component
    - Create `components/treasury/PaymentInstructionBlock.tsx`.
    - Displays: Beneficiary Name, Bank Name, Account Number, Account Type, Amount, Transfer Charge as a distinct clearly-labelled block.
    - Renders for all FUNDS_OUT and ROLLOVER_SLIP vouchers where money leaves the company.
    - For internal transfers, shows Transfer Charge as `₦0`.
    - _Requirements: 36.1, 36.5_

  - [x] 2.22 Create Step 6 panel — ApprovalChainPanel
    - Create `app/(protected)/transactions/[id]/_components/Step6ApprovalChain.tsx`.
    - List all 5 approval stages with their status: completed stages as read-only rows (actor, decision, timestamp, comments), current pending stage with Approve / Return / Reject buttons, future stages as locked.
    - Show action buttons only if `currentUser.role === requiredStage.role` AND user is not the transaction creator.
    - Return/Reject: open shadcn `Dialog` requiring non-empty comments before confirming.
    - On submit call `approveTransactionAction`; show toast.
    - _Requirements: 12.1, 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 2.23 Create `lib/actions/approval.actions.ts`
    - Implement `approveTransactionAction(transactionId, stage, decision, comments?)`: Zod-validate, `getUser()`, `resolveUserRole()`, call `supabase.rpc('approve_transaction', {...})`, `revalidatePath`, return result.
    - _Requirements: 12.2, 12.8, 12.9, 5.3, 5.4_

  - [x] 2.24 Create `CalculationSnapshotDisplay` component
    - Create `components/treasury/CalculationSnapshotDisplay.tsx`.
    - Renders the JSONB `calculation_snapshot` from a voucher: rule name, inputs table, outputs table, calculated_at timestamp.
    - Used within the approval context panel (Req 13.1) and voucher display.
    - _Requirements: 13.1, 26.5_

  - [x] 2.25 Checkpoint — Phase 2 verification
    - A single Rollover P+I transaction should now be able to traverse all six steps end-to-end.
    - Verify each RPC rejects unauthorised role calls.
    - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Phase 3 — All Transaction Scenarios
  - [x] 3.1 Rollover P+I scenario
    - Extend `createTransactionAction` to accept `scenario_code: 'P_AND_I'` for `ROLLOVER` type.
    - In `prepareVoucherAction`: call `calculateRollover('P_AND_I', principal, interestDue)`, persist `rollover_details` row with `rollover_type = 'P_AND_I'`, generate `ROLLOVER_SLIP` voucher.
    - On Operations execution: call `eazybankzAdapter.createInvestment()` to book the rolled investment.
    - _Requirements: 17.1, 17.2, 17.6, 17.7_

  - [ ] 3.2 Rollover Principal Only scenario
    - Support `scenario_code: 'PRINCIPAL_ONLY'`.
    - `calculateRollover('PRINCIPAL_ONLY', ...)`: `principalRolled = principal`, `interestPaid = interestDue`.
    - After rollover voucher, create a linked `FUNDS_OUT` transaction for interest payout with external payment details if required.
    - _Requirements: 17.1, 17.3_

  - [ ] 3.3 Rollover Partial Principal scenario
    - Support `scenario_code: 'PARTIAL_PRINCIPAL'` with `requestedPayout` field on the creation form.
    - `calculateRollover('PARTIAL_PRINCIPAL', principal, interestDue, requestedPayout)`: compute `remaining_principal = principal - requestedPayout`; display all intermediate values before voucher preparation.
    - _Requirements: 17.1, 17.4_

  - [ ] 3.4 Rollover Interest Only scenario
    - Support `scenario_code: 'INTEREST_ONLY'`.
    - `calculateRollover('INTEREST_ONLY', ...)`: interest Funds-Out for `interestDue`; principal investment remains active in Eazybankz.
    - _Requirements: 17.1, 17.5_

  - [ ] 3.5 Maturity Termination scenario
    - Support `transaction_type: 'MATURITY_TERMINATION'`.
    - `calculateMaturityTermination(principal, accruedInterest)`: WHT = 0; `netAmount = principal + accrued_interest`.
    - Generate `FUNDS_OUT` voucher with all required fields; enforce external payment block if applicable.
    - On Operations execution: call `eazybankzAdapter.updateInvestment()` with `status: 'TERMINATED'`.
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ] 3.6 Full Pre-liquidation scenario
    - Support `transaction_type: 'PRE_LIQUIDATION'` with no `requestedPayout` (full liquidation).
    - `calculatePreLiquidation(accruedInterest)`: `charge = accrued_interest × 0.20`, `net_interest = accrued_interest - charge`.
    - Persist `pre_liquidation_details` row with all fields including `charge_rate = 0.20`.
    - Attach `PRE_LIQUIDATION_20_PERCENT` calculation snapshot to voucher.
    - _Requirements: 19.1, 19.3, 19.4_

  - [ ] 3.7 Partial Pre-liquidation scenario
    - Extend `PRE_LIQUIDATION` path with `requestedPayout` field.
    - `calculatePreLiquidation(accruedInterest, requestedPayout)`: compute `remaining_principal`, `rebooked_principal`; display all intermediate values before voucher preparation.
    - On Operations execution: call `eazybankzAdapter.updateInvestment()` to rebook remaining principal.
    - _Requirements: 19.2, 19.3, 19.5_

  - [ ] 3.8 Anniversary 30-day scenario
    - Support `transaction_type: 'ANNIVERSARY_PAYMENT'` with `scenario_code: 'ANNIVERSARY_30'`.
    - `calculateAnniversaryPayment(principal, interestRate, 30)`: compute interest due.
    - Generate `FUNDS_OUT` voucher with WHT = 0.
    - On execution: `eazybankzAdapter.updateInvestment()` to record interest payment, principal remains active.
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [ ] 3.9 Anniversary 60-day scenario
    - Support `scenario_code: 'ANNIVERSARY_60'` with `calculateAnniversaryPayment(principal, interestRate, 60)`.
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [ ] 3.10 Anniversary 90-day scenario
    - Support `scenario_code: 'ANNIVERSARY_90'` with `calculateAnniversaryPayment(principal, interestRate, 90)`.
    - Validate that only 30, 60, 90 are accepted; server action rejects any other value.
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [ ] 3.11 Third-party External payment scenario
    - Support `transaction_type: 'THIRD_PARTY_PAYMENT'` with `is_internal = false`.
    - `calculateThirdPartyCharge(transferAmount, false)`: `transfer_charge = amount × 0.001`.
    - Enforce all 6 Payment Instruction fields (Req 36) before voucher can be saved.
    - Persist `THIRD_PARTY_TRANSFER_0_10_PERCENT` calculation snapshot.
    - _Requirements: 21.1, 21.2, 21.4, 21.5, 36.1, 36.2_

  - [ ] 3.12 Third-party Internal payment scenario
    - Support `transaction_type: 'THIRD_PARTY_PAYMENT'` with `is_internal = true`.
    - `calculateThirdPartyCharge(transferAmount, true)`: `transfer_charge = 0`.
    - Render Payment Instruction block with Transfer Charge as `₦0`; pre-fill internal account details.
    - _Requirements: 21.1, 21.3, 36.3_

  - [ ] 3.13 Transfer Slip — Savings → Personal
    - Support `transaction_type: 'INTERNAL_TRANSFER'` with `scenario_code: 'SAVINGS_TO_PERSONAL'`.
    - Verify available balance ≥ requested amount server-side before allowing voucher preparation.
    - Generate `TRANSFER_SLIP` voucher.
    - _Requirements: 22.1, 22.2_

  - [ ] 3.14 Transfer Slip — Personal → Commercial Paper
    - Support `scenario_code: 'PERSONAL_TO_COMMERCIAL_PAPER'`.
    - On execution: `eazybankzAdapter.createInvestment()` to book Commercial Paper investment.
    - _Requirements: 22.1, 22.2, 22.3_

  - [ ] 3.15 Transfer Slip — Personal → Call Placement
    - Support `scenario_code: 'PERSONAL_TO_CALL_PLACEMENT'`.
    - On execution: `eazybankzAdapter.createInvestment()` to book Call Placement investment.
    - _Requirements: 22.1, 22.2, 22.3_

  - [ ] 3.16 Reversal transaction
    - Support `transaction_type: 'REVERSAL'`.
    - Creation form requires selection of original transaction (searchable by reference).
    - Call `supabase.rpc('create_reversal', { p_original_transaction_id, p_reversal_reason })`.
    - Validate original is eligible (not DRAFT, CANCELLED, already reversed).
    - Generate `TRANSFER_SLIP` voucher.
    - On execution: `eazybankzAdapter.reverseTransaction()`.
    - _Requirements: 22.1, 22.4, 25.1, 25.2, 25.3, 25.4, 25.5_

  - [ ] 3.17 Inflow scenario
    - Support `transaction_type: 'INFLOW'`.
    - Generate `FUNDS_IN` voucher: customer name, amount, rate, tenor, effective date, maturity date.
    - On execution: `eazybankzAdapter.createInvestment()` to create new investment record.
    - On treasury completion: verify new investment exists in adapter before marking COMPLETED.
    - _Requirements: 23.1, 23.2, 23.3_

  - [ ] 3.18 Savings Funds-Out scenario
    - Support `transaction_type: 'SAVINGS_FUNDS_OUT'`.
    - Step 4 investment verification required; `available_balance` sourced from `investment_verifications` snapshot (not calculated).
    - Generate `FUNDS_OUT` voucher with `available_balance` as primary field, transfer date, remarks.
    - On execution: `eazybankzAdapter.updateInvestment()` to record payment and update balance.
    - _Requirements: 24.1, 24.2, 24.3, 38.1, 38.2, 38.3, 38.4_

  - [ ] 3.19 Call Funds-Out scenario
    - Support `transaction_type: 'CALL_FUNDS_OUT'` — same voucher layout as Savings Funds-Out.
    - _Requirements: 24.1, 24.2, 24.3, 38.1, 38.2_

  - [ ] 3.20 CMS Funds-Out scenario
    - Support `transaction_type: 'CMS_FUNDS_OUT'` — same voucher layout as Savings Funds-Out.
    - _Requirements: 24.1, 24.2, 24.3, 38.1, 38.2_

  - [ ] 3.21 Checkpoint — Phase 3 verification
    - All 21 scenario sub-flows should be exercisable using Customers A–R seed data.
    - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Phase 4 — Operations Queue + Treasury Completion
  - [ ] 4.1 Create Operations queue page `/operations`
    - Create `app/(protected)/operations/page.tsx` as a server component.
    - Visible only to `OPERATIONS` role (enforced in layout/server component; redirect otherwise).
    - Query `treasury_transactions WHERE status = 'MD_APPROVED'` ordered by `sla_due_at ASC`.
    - List columns: Reference, Customer, Type, Amount, MD Approved At, SLA indicator.
    - Each row links to the transaction workspace.
    - _Requirements: 14.1, 14.2_

  - [ ] 4.2 Create `lib/actions/operations.actions.ts`
    - Implement `executeTransactionAction(transactionId, input: ExecutionInput)`: Zod-validate (status, external reference, execution notes), `getUser()`, `resolveUserRole()`, enforce OPERATIONS, call `supabase.rpc('execute_transaction', {...})`, `revalidatePath('/operations')`, return result.
    - Implement `confirmTreasuryCompletionAction(transactionId)`: enforce TREASURY_OFFICER, call `supabase.rpc('confirm_treasury_completion', {...})`, `revalidatePath`, return result.
    - _Requirements: 14.3, 14.4, 14.5, 15.2, 15.4_

  - [ ] 4.3 Create Operations execution form in the transaction workspace
    - Add an Operations execution panel within the transaction workspace (visible only when `status = 'MD_APPROVED'` AND `currentUser.role = 'OPERATIONS'`).
    - Fields: execution status (SUCCESS / FAILED / PARTIAL), external reference, execution notes.
    - Use React Hook Form + Zod.
    - On submit call `executeTransactionAction`; show Sonner toast.
    - Enforce idempotency: disable the form once an `operations_executions` record exists for this transaction.
    - _Requirements: 14.3, 14.6, 33.3_

  - [ ] 4.4 Create Treasury completion queue in Treasury Officer's view
    - Add a "Pending completion" section in the transaction workspace (visible only when `status = 'OPERATIONS_COMPLETED'` AND `currentUser.role = 'TREASURY_OFFICER'`).
    - "Confirm Completion" button calls `confirmTreasuryCompletionAction`.
    - Show toast on success; workspace auto-refreshes to show COMPLETED status.
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ] 4.5 Wire Operations execution to Eazybankz adapter calls
    - In `executeTransactionAction`, after the RPC succeeds, call the appropriate `eazybankzAdapter` method based on `transaction_type`:
      - `ROLLOVER` → `createInvestment()`
      - `MATURITY_TERMINATION` → `updateInvestment({ status: 'TERMINATED' })`
      - `PRE_LIQUIDATION` (partial) → `updateInvestment()` with rebooked principal
      - `ANNIVERSARY_PAYMENT` → `updateInvestment()` to record interest payment
      - `INTERNAL_TRANSFER` (Commercial Paper / Call) → `createInvestment()`
      - `INFLOW` → `createInvestment()`
      - `REVERSAL` → `reverseTransaction()`
      - `SAVINGS_FUNDS_OUT`, `CALL_FUNDS_OUT`, `CMS_FUNDS_OUT` → `updateInvestment()` with new balance
    - On adapter error: write audit event with failure details; surface error via Sonner toast.
    - _Requirements: 17.7, 18.3, 19.5, 20.4, 22.3, 23.2, 24.3, 25.3, 30.5_

  - [ ] 4.6 Checkpoint — Phase 4 verification
    - A full end-to-end flow (create → 6 steps → 5 approvals → Operations execute → Treasury confirm) should reach COMPLETED status.
    - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Phase 5 — Audit Trail + Search + Reporting
  - [ ] 5.1 Enhance `/audit` page with real audit data
    - Rewrite `app/(protected)/audit/page.tsx` as a server component.
    - Visible to `AUDIT` and `ADMIN` roles only.
    - Query `audit_events` with filter controls: transaction reference (text), event type (multi-select), actor name, date range.
    - Paginated table: ID, timestamp, event type badge, actor name, transaction reference, from status, to status.
    - _Requirements: 28.1, 28.2, 28.3, 29.1_

  - [ ] 5.2 Create `/audit/[transactionId]` — full transaction audit page
    - Create `app/(protected)/audit/[transactionId]/page.tsx`.
    - Load all `audit_events` for the transaction in chronological ASC order.
    - Display the full `<AuditTimeline />` component.
    - Show transaction header summary (reference, customer, type, final status).
    - _Requirements: 28.3, 28.4_

  - [ ] 5.3 Add server-side transaction search to `/transactions`
    - Extend `listTransactions()` in `transaction.service.ts` to accept and apply all filter params: `type`, `status`, `from`, `to`, `customer` (ILIKE prefix match), `reference` (ILIKE prefix), `page`, `pageSize`.
    - Server-side query via Supabase with `.ilike()` for text fields, `.gte()`/`.lte()` for dates, `.eq()` for enums.
    - Return `{ data: Transaction[], count: number }` for pagination rendering.
    - _Requirements: 29.1, 29.2, 29.3, 29.4_

  - [ ] 5.4 Wire `/vouchers` page to real vouchers data
    - Rewrite `app/(protected)/vouchers/page.tsx` as a server component.
    - Query `vouchers JOIN treasury_transactions JOIN customers` with filters: voucher type, status, date range.
    - Each row links to the transaction workspace.
    - _Requirements: 6.6_

  - [ ] 5.5 SLA breach detection in dashboard exceptions count
    - Update the exceptions count query in the dashboard to include transactions where `sla_due_at < NOW()` and `status NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED')`.
    - Update `<SlaIndicator />` to derive state from server-computed remaining time: green `> 2h`, amber `≤ 2h`, red `overdue`.
    - _Requirements: 37.1, 37.2, 37.3, 37.4_

  - [ ] 5.6 Checkpoint — Phase 5 verification
    - Verify audit page shows all event types for a completed transaction.
    - Verify search and filter return accurate paginated results.
    - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Phase 6 — Eazybankz Mock Adapter
  - [ ] 6.1 Create `lib/services/eazybankz/adapter.interface.ts`
    - Define all interfaces as specified in the design: `EazybankzInvestment`, `EazybankzBalance`, `CreateInvestmentData`, `CreateTransactionData`, and `EazybankzAdapter`.
    - All monetary values typed as `string` to preserve numeric precision through the TypeScript layer.
    - Export typed error class `EazybankzError`.
    - _Requirements: 30.1, 30.3_

  - [ ] 6.2 Create `lib/services/eazybankz/mock.adapter.ts`
    - Implement `MockEazybankzAdapter implements EazybankzAdapter`.
    - Seed the in-memory store from the 18 customers A–R data in `supabase/seed.sql` (matching principal, accrued interest, rate, balance values).
    - `getInvestment(id)`: returns seeded investment data; throws `EazybankzError` for `id` prefixed with `'FAIL_'`.
    - `getBalance(accountId)`: returns seeded account balance.
    - `getAccruedInterest(investmentId)`: returns seeded accrued interest string.
    - `createInvestment(data)`: creates and stores a new investment entry; returns it.
    - `updateInvestment(id, data)`: merges updates into stored entry; returns updated.
    - `createTransaction(data)`: records a payment transaction; returns `{ transactionId }`.
    - `reverseTransaction(id, reason)`: marks transaction as reversed; returns `{ reversalId }`.
    - All methods are `async` to match the real adapter interface.
    - _Requirements: 30.2, 30.3_

  - [ ] 6.3 Create `lib/services/eazybankz/index.ts`
    - Export `eazybankzAdapter: EazybankzAdapter` resolved at module load time:
      - `EAZYBANKZ_MODE === 'real'` → `new RealEazybankzAdapter()` (placeholder stub)
      - default → `new MockEazybankzAdapter()`
    - Export all types from `adapter.interface.ts`.
    - _Requirements: 30.3, 30.4_

  - [ ] 6.4 Wire Step 4 investment verification to Eazybankz adapter
    - In the `verifyInvestmentAction` (or the server component that pre-fetches data for Step 4), call `eazybankzAdapter.getInvestment(transaction.investment.external_reference)` server-side.
    - Pass the returned data as pre-fill values to the `InvestmentVerificationPanel`.
    - Never call the adapter from a browser component.
    - _Requirements: 10.1, 30.4_

  - [ ] 6.5 Wire Operations execution to Eazybankz adapter calls (integration)
    - This is already introduced in task 4.5. In Phase 6, verify the mock adapter handles all scenario paths: ROLLOVER, MATURITY_TERMINATION, PRE_LIQUIDATION (partial), ANNIVERSARY_PAYMENT, INTERNAL_TRANSFER, INFLOW, REVERSAL, SAVINGS/CALL/CMS Funds-Out.
    - Add error path: when adapter throws `EazybankzError`, surface via Sonner toast and write `OPERATIONS_COMPLETED` with `execution_status: 'FAILED'`; do not transition to TREASURY_CONFIRMED.
    - _Requirements: 30.5_

  - [ ]* 6.6 Write property test — mock adapter returns consistent data for all customers A–R
    - **Property 3: For every seeded customer A–R, `getInvestment()` returns a value with the correct shape and matches the seed principal/rate values**
    - Generate the 18 customer external_reference IDs; assert each returns a valid `EazybankzInvestment` with non-null fields and matching financial values.
    - _Requirements: 30.2, 39.3_

  - [ ]* 6.7 Write property test — adapter interface contract
    - **Property 4: All `EazybankzAdapter` methods return defined shapes for valid inputs**
    - For any `createInvestment(data)` call with valid fields, the returned object must satisfy the `EazybankzInvestment` interface schema (all required fields present, monetary fields are numeric-string parseable).
    - _Requirements: 30.1, 30.3_

  - [ ] 6.8 Checkpoint — Phase 6 verification
    - Verify all 18 scenario customers retrieve correct Eazybankz data at Step 4.
    - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Phase 7 — Hardening
  - [ ] 7.1 Add admin user management page `/admin/users`
    - Create `app/(protected)/admin/page.tsx` as a server component; accessible to `ADMIN` role only.
    - List all users from `profiles JOIN user_roles JOIN roles`.
    - Actions: assign role (INSERT into `user_roles`), revoke role (DELETE from `user_roles`), deactivate user (`profiles.is_active = false`).
    - All mutations via server actions that re-check `ADMIN` role.
    - _Requirements: 5.2 (ADMIN permissions)_

  - [ ] 7.2 Add SLA config page `/admin/sla-config`
    - Create `app/(protected)/admin/sla-config/page.tsx`.
    - Display current `sla_config` rows (one per transaction type).
    - Allow ADMIN to update `sla_hours` per type; save via server action that updates `sla_config`.
    - Dashboard and transaction creation use `sla_config` to compute `sla_due_at`.
    - _Requirements: 37.5_

  - [ ] 7.3 Wire notification bell to Supabase Realtime
    - Create `components/treasury/NotificationBell.tsx` as a client component.
    - Subscribe to `notifications` table changes filtered by `recipient_id = auth.uid()`.
    - Show unread count badge via shadcn `Badge`.
    - Dropdown lists recent notifications; clicking one navigates to the transaction workspace and calls `markNotificationsRead(userId, transactionId)`.
    - _Requirements: 31.1, 31.2, 31.3, 31.4_

  - [ ] 7.4 Wire document upload to Supabase Storage
    - Create `lib/actions/document.actions.ts`: `uploadDocumentAction(transactionId, file, documentType)`.
    - Validate file type (PDF, JPG, PNG) and size (max 10 MB) before upload; surface `<Alert>` on client for invalid files.
    - Upload to `transaction-documents` bucket at path `{transaction_id}/{document_type}/{timestamp}_{filename}`.
    - Insert `transaction_documents` row; write `DOCUMENT_UPLOADED` audit event.
    - Return short-lived signed URL (3600s expiry).
    - On failure: Sonner toast with error message; retain partial state for retry.
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6_

  - [ ] 7.5 Verify all RLS policies with negative test scenarios
    - Write integration tests (using Supabase test client or pgTAP) that execute each negative test from seed data:
      - `CUSTOMER_NEG_001` (signature mismatch): attempt to advance past Step 2 → expect rejection.
      - `CUSTOMER_NEG_002` (insufficient balance): attempt to prepare Transfer Slip → expect rejection.
      - `CUSTOMER_NEG_004` (confirmation failed): attempt to advance past Step 3 → expect rejection.
      - Attempt by ACCOUNT_OFFICER to call `verifySignatureAction` → expect 403.
      - Attempt by OPERATIONS to approve at TREASURY stage → expect 403.
    - _Requirements: 2.3, 2.4, 5.3, 35.2_

  - [ ] 7.6 Verify idempotency — double-submission tests
    - Write tests that submit the same approval action twice for the same `(transaction_id, stage)` and assert only one `approvals` row is created.
    - Write tests that call `executeTransactionAction` twice and assert only one `operations_executions` row is created.
    - _Requirements: 12.9, 14.6, 33.2, 33.3, 33.4_

  - [ ] 7.7 Verify maker-checker enforcement
    - Write tests that create a transaction as `treasury_maker_01` then attempt to approve it at the TREASURY stage with the same user.
    - Assert the server action returns a 403 and no `approvals` row is created.
    - _Requirements: 5.4, 12.2_

  - [ ] 7.8 Verify signature mismatch downstream lock
    - Write a test flow using `CUSTOMER_NEG_001`: record `SIGNATURE_FAILED` → attempt to call `recordCustomerConfirmationAction` → assert rejection.
    - Assert `<Alert>` lock indicator is rendered in the Step 3 panel when `signature_result = 'FAILED'`.
    - _Requirements: 8.3, 8.6_

  - [ ] 7.9 Verify audit_events immutability
    - Write tests that attempt to UPDATE and DELETE an `audit_events` row using the authenticated Supabase client.
    - Assert both operations are rejected by RLS.
    - _Requirements: 1.5, 2.4, 28.5, 35.2_

  - [ ] 7.10 Add `prefers-reduced-motion` CSS to all animated components
    - Audit `StepProgressTracker`, `AuditTimeline`, all voucher entry animations, sidebar transitions, and modal animations.
    - Wrap all `transform`-based keyframes and transitions in `@media (not (prefers-reduced-motion: reduce))`.
    - Retain opacity and color transitions unconditionally.
    - _Requirements: 32.9_

  - [ ] 7.11 Final animation audit — transitions ≤300ms, ease-out, scale(0.95) entries
    - Review all interactive components: buttons (100–160ms), tooltips/popovers (125–200ms), modals/drawers (200–300ms).
    - Verify all entry animations start from `scale(0.95) opacity(0)`.
    - Verify no `ease-in` is used anywhere.
    - Verify `transform-origin` on popovers/dropdowns is set to trigger location, not center.
    - Verify hover animations are gated with `@media (hover: hover) and (pointer: fine)`.
    - _Requirements: 32.4, 32.5, 32.6, 32.7, 32.8, 32.11_

  - [ ] 7.12 E2E seed reset function verification
    - Write a test that creates transactions using the `_e2e` user set, then calls `reset_e2e_transactions()`, then asserts all `_e2e` transactions and their child records are deleted and scenario user data is untouched.
    - _Requirements: 39.4, 39.6_

  - [ ] 7.13 Final checkpoint — full end-to-end production readiness
    - Run the full E2E scenario: sign in as `treasury_maker_e2e`, create a Rollover P+I for Customer A, complete all 6 steps, pass all 5 approvals, execute as `operations_officer_e2e`, confirm as `treasury_maker_e2e`, view audit trail.
    - Verify `reset_e2e_transactions()` cleans up cleanly.
    - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all other tasks are required.
- Each task references specific requirements for traceability.
- Property tests validate universal correctness guarantees for financial calculations and adapter contracts.
- Checkpoints at the end of each phase ensure incremental validation before moving forward.
- The Eazybankz adapter is always called server-side only — never from browser components.
- All monetary columns use PostgreSQL `NUMERIC`; JavaScript floating-point is never the authoritative financial result.
