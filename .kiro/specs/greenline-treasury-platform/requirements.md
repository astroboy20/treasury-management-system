# Requirements Document

## Introduction

The Greenline Treasury Operations platform digitises the First Marina Trust Finance Company SOP for treasury operations. The platform replaces a manual, paper-based workflow with a controlled, auditable, role-enforced digital workspace built on Next.js 16, React 19, TypeScript, Tailwind CSS v4, and Supabase (PostgreSQL + Auth + Storage + RLS).

A UI shell with hardcoded data already exists. Everything below describes what must be built to turn that shell into a fully functional system covering:

- Phase 1 — Foundation (database, auth, route protection, real dashboard data)
- Phase 2 — Core six-step transaction workflow engine
- Phase 3 — All nine transaction scenarios
- Phase 4 — Operations execution queue and Treasury confirmation
- Phase 5 — Audit trail, search, and reporting
- Phase 6 — Eazybankz mock/mirror integration
- Phase 7 — Production hardening

The SOP defines a mandatory six-step control sequence every treasury transaction must pass through before money moves: (1) Customer Instruction, (2) Signature Verification, (3) Customer Confirmation, (4) Investment Verification, (5) Raise Treasury Voucher, (6) Approval chain (Treasury → Head Treasury → MIS → Audit → MD). After that, Operations executes and Treasury confirms completion.

---

## Glossary

- **System**: The Greenline Treasury Operations web application (Next.js 16 + Supabase).
- **Transaction**: A treasury instruction that passes through the six-step SOP workflow.
- **Workflow_Engine**: The server-side state machine that controls transaction lifecycle transitions.
- **Transaction_Reference**: The unique identifier assigned to every transaction at creation (e.g., TRX-XXXXX).
- **Voucher**: A structured financial document (Funds-In, Funds-Out, Rollover Slip, Transfer Slip) generated at Step 5.
- **Approval_Chain**: The sequential five-stage approval sequence: Treasury Officer → Head Treasury → MIS → Audit → MD.
- **Eazybankz_Adapter**: The server-side adapter module that encapsulates all reads and writes to the Eazybankz mirror system.
- **Eazybankz_Mirror**: The mock/internal simulation of the Eazybankz banking system used for investment data.
- **Calculation_Engine**: The server-side service that performs all financial calculations (pre-liquidation charge, rollover amounts, transfer charges, anniversary interest).
- **Calculation_Snapshot**: An immutable JSON record capturing the inputs, rule applied, and outputs for a financial calculation.
- **Audit_Event**: An append-only database record capturing who did what, when, and what state the transaction moved from and to.
- **Account_Officer**: A staff user who performs customer telephone confirmation (Step 3).
- **Treasury_Officer**: A staff user who creates transactions, verifies signatures, verifies investments, prepares vouchers, and performs Treasury approval.
- **Head_Treasury**: A staff user who performs the Head Treasury approval.
- **MIS**: A staff user who performs the MIS approval.
- **Audit_Officer**: A staff user who performs the Audit approval and inspects audit history.
- **MD**: A staff user (Managing Director) who performs the final approval before Operations.
- **Operations_Officer**: A staff user who executes approved transactions and records the execution result.
- **Customer**: The person or entity that owns the investment or account on whose behalf the transaction is raised.
- **RLS**: Supabase Row Level Security — the database-enforced access control layer that is the primary security boundary.
- **Server_Action**: A Next.js server-side function invoked from the browser that runs in a trusted server context.
- **SOP**: The First Marina Trust Finance Company Standard Operating Procedure for Treasury Operations.
- **Pre_Liquidation_Charge**: The penalty charge calculated as 20% of accrued interest when an investment is terminated before maturity.
- **Transfer_Charge**: The 0.10% fee applied to external third-party transfer amounts.
- **WHT**: Withholding Tax — stored on vouchers but defaulted to zero for maturity termination and anniversary payments per SOP.
- **Rollover_Slip**: The voucher type for rollover transactions.
- **Transfer_Slip**: The voucher type for internal transfers and reversals.
- **Funds_In**: The voucher type for inflow transactions.
- **Funds_Out**: The voucher type for maturity termination, anniversary payment, pre-liquidation, and third-party payment transactions.
- **Toast**: A shadcn/sonner toast notification shown for transient feedback.
- **Dialog**: A shadcn dialog/modal used for confirmations and destructive actions.
- **Alert**: A shadcn alert component used for inline, non-dismissible status messages.
- **Reduced_Motion**: The CSS/JS `prefers-reduced-motion` media query preference.

---

## Requirements

---

### Requirement 1: Database Schema and Migrations

**User Story:** As a developer, I want a complete Supabase database schema with migrations, so that all application data has a structured, version-controlled foundation.

#### Acceptance Criteria

1. THE System SHALL create Supabase SQL migrations that define every table specified in the database schema document: `profiles`, `roles`, `user_roles`, `customers`, `customer_accounts`, `investments`, `treasury_transactions`, `payment_instructions`, `signature_verifications`, `customer_confirmations`, `investment_verifications`, `vouchers`, `rollover_details`, `pre_liquidation_details`, `approvals`, `operations_executions`, `audit_events`, and `transaction_documents`.
2. THE System SHALL use PostgreSQL `numeric` type for all monetary and financial-rate columns across every table.
3. THE System SHALL define all foreign key constraints, unique constraints, and indexes documented in the schema (including indexes on `treasury_transactions(status)`, `treasury_transactions(transaction_type)`, `treasury_transactions(customer_id)`, `treasury_transactions(created_at)`, `approvals(transaction_id, stage)`, `audit_events(transaction_id, created_at)`, `investments(customer_id, status)`, and `operations_executions(transaction_id)`).
4. THE System SHALL enforce a unique constraint on `(transaction_id, stage)` in the `approvals` table to prevent duplicate approval records.
5. THE System SHALL configure the `audit_events` table so that normal application roles are denied `UPDATE` and `DELETE` privileges on it, making it append-only.
6. WHEN a migration is applied, THE System SHALL seed the `roles` table with codes: `CUSTOMER`, `ACCOUNT_OFFICER`, `TREASURY_OFFICER`, `HEAD_TREASURY`, `MIS`, `AUDIT`, `MD`, `OPERATIONS`, and `ADMIN`.

---

### Requirement 2: Row Level Security (RLS) Policies

**User Story:** As a security engineer, I want RLS policies on every sensitive table, so that users can only read and write data they are authorised to access, regardless of what the frontend sends.

#### Acceptance Criteria

1. THE System SHALL enable RLS on every table listed in Requirement 1.
2. WHEN a user queries `treasury_transactions`, THE System SHALL return only rows the user's role is permitted to access (Treasury Officers and above see all; Account Officers see only their assigned confirmation records; Operations sees only MD-approved transactions pending execution).
3. WHEN a user attempts to `INSERT` or `UPDATE` an `approvals` row for a stage that does not match their assigned role, THE System SHALL reject the operation.
4. WHEN a user attempts to `UPDATE` or `DELETE` an `audit_events` row, THE System SHALL reject the operation.
5. WHEN a user attempts to read a `transaction_documents` row, THE System SHALL permit access only if the user's role has an active relationship to the corresponding transaction.
6. IF a request to mutate financial data arrives without an authenticated Supabase session, THEN THE System SHALL reject the request with a 401 response before any database operation is executed.

---

### Requirement 3: Authentication and Session Management

**User Story:** As a staff member, I want to sign in with my work email and password, so that I can access the workspace functions permitted for my role.

#### Acceptance Criteria

1. THE System SHALL authenticate staff users via Supabase Auth email-and-password sign-in.
2. WHEN a user signs in successfully, THE System SHALL redirect the user to `/dashboard`.
3. WHEN sign-in credentials are invalid, THE System SHALL display a shadcn `Alert` component with the message "Invalid email or password." without revealing whether the email exists.
4. WHEN a sign-in attempt is rate-limited (HTTP 429), THE System SHALL display a shadcn `Alert` with the message "Too many attempts. Please wait a moment and try again."
5. WHEN a new account is created via the sign-up form, THE System SHALL store `full_name` and `requested_role` in Supabase auth metadata and create a corresponding `profiles` row via a database trigger or server-side function.
6. WHEN a user's session expires, THE System SHALL redirect the user to `/auth/login` without exposing any protected page content.
7. THE System SHALL load the authenticated user's profile and assigned role server-side on every protected page render, never trusting role values stored in `localStorage` or client-side state.
8. IF a user navigates to any route under `/dashboard`, `/transactions`, `/approvals`, `/operations`, `/customers`, `/investments`, `/audit`, or `/admin` without a valid Supabase session, THEN THE System SHALL redirect the user to `/auth/login`.

---

### Requirement 4: Route Protection and Middleware

**User Story:** As a security engineer, I want the Next.js middleware to protect all internal routes, so that unauthenticated users are always redirected to login.

#### Acceptance Criteria

1. WHEN the Next.js middleware processes a request for any route matching the protected group (all routes except `/`, `/auth/**`, `/_next/**`, and static assets), THE System SHALL call `supabase.auth.getUser()` and redirect to `/auth/login` if no session is returned.
2. THE System SHALL pass the authenticated user's role to layout server components so role-aware UI decisions are made server-side.
3. IF the middleware cannot refresh the session due to a network error, THEN THE System SHALL redirect the user to `/auth/login` rather than allowing access to a protected page.
4. THE System SHALL set `SameSite`, `Secure`, and `HttpOnly` flags on session cookies in production environments.

---

### Requirement 5: Role-Based Access Control (RBAC)

**User Story:** As an administrator, I want role-based permissions enforced server-side, so that each staff member can only perform the actions their SOP role permits.

#### Acceptance Criteria

1. THE System SHALL resolve the current user's role by querying `user_roles` joined with `roles` on every protected Server Action or Route Handler, never trusting a role value from the request body.
2. THE System SHALL define and enforce these role-to-permission mappings:
   - `ACCOUNT_OFFICER`: record customer confirmation; read transactions assigned to their confirmation queue.
   - `TREASURY_OFFICER`: create transactions; verify signatures; verify investments; prepare vouchers; approve Treasury stage; confirm Treasury completion.
   - `HEAD_TREASURY`: approve Head Treasury stage.
   - `MIS`: approve MIS stage.
   - `AUDIT`: approve Audit stage; read audit history.
   - `MD`: approve MD stage.
   - `OPERATIONS`: execute approved transactions; record execution result.
   - `ADMIN`: manage users and system configuration; does not automatically inherit financial approval permissions.
3. WHEN a Server Action receives a request for an action the caller's role does not permit, THE System SHALL return a 403 error and write an audit event of type `UNAUTHORIZED_ATTEMPT`.
4. THE System SHALL prevent maker-checker violations: the user who created a transaction SHALL NOT be permitted to perform any approval on that same transaction.

---

### Requirement 6: Real-Time Dashboard

**User Story:** As a Treasury Officer, I want a dashboard that shows live counts and recent instructions drawn from the database, so that I always know what needs my attention.

#### Acceptance Criteria

1. THE System SHALL replace all hardcoded dashboard data with server-fetched data from the `treasury_transactions` table, scoped by the current user's role.
2. THE System SHALL display a "Pending my action" count showing the number of transactions currently at a workflow stage owned by the current user's role.
3. THE System SHALL display an "In progress" count showing transactions in states between `INSTRUCTION_RECEIVED` and `MD_APPROVED` inclusive.
4. THE System SHALL display a "Completed this week" aggregate showing the sum of `approved_amount` and the count of transactions reaching `COMPLETED` status within the current calendar week.
5. THE System SHALL display an "Exceptions" count showing transactions in `REJECTED`, `RETURNED`, `FAILED`, or `CANCELLED` states.
6. THE System SHALL display a "Recent instructions" table showing the 10 most recent transactions ordered by `created_at` descending, with columns: Reference, Customer, Type, Amount, Status, and Current Owner.
7. WHEN a transaction's status changes, THE System SHALL reflect the updated status in the dashboard within 30 seconds, either via Supabase Realtime subscription or server component revalidation.

---

### Requirement 7: Transaction Creation (Step 1 — Customer Instruction)

**User Story:** As a Treasury Officer, I want to create a new treasury transaction by recording the customer instruction, so that the workflow officially starts and an audit trail begins.

#### Acceptance Criteria

1. THE System SHALL provide a transaction creation form that captures: customer (searchable from the `customers` table), transaction type, scenario code, requested amount, purpose, and source instruction type.
2. WHEN a transaction type is selected, THE System SHALL dynamically render only the fields required for that transaction type (e.g., external payment fields appear only for third-party external scenarios).
3. WHEN the transaction creation form is submitted, THE System SHALL execute a Server Action that: validates all inputs with Zod, resolves the caller's role, generates a unique `transaction_reference`, creates a `treasury_transactions` row with status `INSTRUCTION_RECEIVED`, and writes a `TRANSACTION_CREATED` audit event — all within a single PostgreSQL transaction.
4. IF any required field is missing or invalid at submission, THEN THE System SHALL surface field-level validation errors via React Hook Form with Zod, displayed as inline error text below the relevant field using shadcn form error styling.
5. WHEN the transaction is successfully created, THE System SHALL display a shadcn `Toast` confirming creation and navigate the user to the transaction workspace at `/transactions/[id]`.
6. THE System SHALL allow the Transaction_Reference to be assigned only server-side; the browser SHALL NOT generate or supply the reference.
7. WHEN an external payment beneficiary is required (third-party external scenario), THE System SHALL require: beneficiary name, bank name, account number, and account type before the form can be submitted.

---

### Requirement 8: Signature Verification (Step 2)

**User Story:** As a Treasury Officer, I want to record a signature verification result, so that only instructions with confirmed identity proceed past Step 2.

#### Acceptance Criteria

1. THE System SHALL present a signature verification checklist with four items: signature match, mandate check, account ownership check, and instruction completeness check.
2. WHEN all four checklist items are marked as passed, THE System SHALL allow the Treasury Officer to submit the verification, transitioning the transaction to `SIGNATURE_VERIFIED`.
3. IF the signature result is recorded as `FAILED`, THEN THE System SHALL lock all downstream steps (Steps 3–6 and approval actions), display an inline `Alert` explaining the lock, and prevent any Server Action from advancing the transaction past Step 2.
4. THE System SHALL persist the `signature_verifications` row with: `verified_by`, `signature_result`, `mandate_result`, `account_ownership_result`, `completeness_result`, `notes`, and `verified_at`.
5. WHEN a signature verification is submitted, THE System SHALL write a `SIGNATURE_VERIFIED` or `SIGNATURE_FAILED` audit event.
6. THE System SHALL enforce the signature verification step server-side: THE Workflow_Engine SHALL reject any Server Action that attempts to create a customer confirmation without a passing `SIGNATURE_VERIFIED` record for the same transaction.

---

### Requirement 9: Customer Confirmation (Step 3)

**User Story:** As an Account Officer, I want to record the result of my telephone confirmation call with the customer, so that the customer's consent is documented before the investment is verified.

#### Acceptance Criteria

1. THE System SHALL present a confirmation form requiring: officer name (pre-filled from authenticated profile), confirmation date, confirmation time, confirmed amount, confirmed beneficiary (where applicable), confirmed purpose, and confirmation status.
2. THE System SHALL prevent the Account Officer from submitting the confirmation form if any required confirmation field is missing, surfacing field errors via React Hook Form with Zod.
3. WHEN confirmation is submitted with status `CONFIRMED`, THE System SHALL transition the transaction to `CUSTOMER_CONFIRMED` and write a `CUSTOMER_CONFIRMED` audit event.
4. IF customer confirmation status is `FAILED` or `UNREACHABLE`, THEN THE System SHALL transition the transaction to a controlled exception state and write an audit event, preventing Step 4 from proceeding.
5. THE System SHALL persist the `customer_confirmations` row with all confirmation metadata as specified in the database schema.
6. THE System SHALL enforce that only users with role `ACCOUNT_OFFICER` can submit a customer confirmation Server Action.

---

### Requirement 10: Investment Verification (Step 4)

**User Story:** As a Treasury Officer, I want to capture a verified snapshot of the customer's investment data from Eazybankz, so that all downstream calculations use a confirmed, immutable data source.

#### Acceptance Criteria

1. THE System SHALL display current investment data fetched from THE Eazybankz_Adapter for the customer's investment linked to the transaction.
2. THE System SHALL require the Treasury Officer to confirm the following fields before submitting the verification: principal, accrued interest, interest rate, effective date, maturity date, outstanding balance, and available amount.
3. WHEN the investment verification is submitted, THE System SHALL persist an `investment_verifications` row containing all seven confirmed fields plus `verified_by`, `source_system` (set to `EAZYBANKZ`), and `verified_at`.
4. WHEN the investment verification is saved, THE System SHALL transition the transaction to `INVESTMENT_VERIFIED` and write an `INVESTMENT_VERIFIED` audit event.
5. THE System SHALL use the data from the `investment_verifications` snapshot — not live Eazybankz data — as the input for all downstream financial calculations.
6. THE System SHALL enforce that only users with role `TREASURY_OFFICER` can submit an investment verification Server Action.

---

### Requirement 11: Voucher Generation (Step 5)

**User Story:** As a Treasury Officer, I want the system to generate the correct voucher type automatically based on the transaction type, so that I cannot accidentally raise the wrong settlement document.

#### Acceptance Criteria

1. THE System SHALL determine the voucher type server-side according to this mapping: `INFLOW` → `FUNDS_IN`; `MATURITY_TERMINATION` → `FUNDS_OUT`; `ANNIVERSARY_PAYMENT` → `FUNDS_OUT`; `PRE_LIQUIDATION` → `FUNDS_OUT`; `THIRD_PARTY_PAYMENT` → `FUNDS_OUT`; `ROLLOVER` → `ROLLOVER_SLIP`; `INTERNAL_TRANSFER` → `TRANSFER_SLIP`; `REVERSAL` → `TRANSFER_SLIP`.
2. THE System SHALL prevent the frontend from supplying an arbitrary voucher type that contradicts the transaction type.
3. WHEN a `FUNDS_OUT` voucher is generated, THE System SHALL populate: principal, interest, WHT (defaulted to zero for maturity termination and anniversary per SOP), net amount, transfer date, remarks, and payment instruction where applicable.
4. WHEN a `FUNDS_IN` voucher is generated, THE System SHALL populate: customer name, amount, rate, tenor, effective date, and maturity date.
5. WHEN a `ROLLOVER_SLIP` voucher is generated, THE System SHALL populate: principal amount, interest due, effective date, new tenor, new rate, rollover amount, rollover maturity date, and payment instruction when interest is paid out.
6. WHEN a `TRANSFER_SLIP` voucher is generated, THE System SHALL populate the fields applicable to the specific transfer scenario.
7. THE System SHALL generate a unique `voucher_number` server-side and persist the voucher with the Calculation_Snapshot attached.
8. WHEN the voucher is saved, THE System SHALL transition the transaction to `VOUCHER_PREPARED` and write a `VOUCHER_CREATED` audit event.
9. IF a required voucher field is missing at the time of voucher preparation, THEN THE System SHALL return a validation error and SHALL NOT transition the transaction status.

---

### Requirement 12: Approval Chain Engine (Step 6)

**User Story:** As a Treasury Officer, I want to approve a transaction at my designated stage, so that it progresses through the five-stage approval chain in the correct order.

#### Acceptance Criteria

1. THE System SHALL enforce the approval sequence: Treasury Officer (stage 1) → Head Treasury (stage 2) → MIS (stage 3) → Audit (stage 4) → MD (stage 5).
2. WHEN an approver submits an approval decision, THE Workflow_Engine SHALL: authenticate the actor, load the transaction, verify the actor's role matches the required approval stage, verify all previous approval stages are complete, record the `approvals` row, transition the transaction status, and write an `APPROVAL_GRANTED` audit event — all atomically.
3. IF an approval is submitted for a stage whose prior stage is not complete, THEN THE System SHALL reject the request and return an error without creating any approval record.
4. IF a user without the required role submits an approval for a given stage, THEN THE System SHALL reject the request with a 403 error.
5. THE System SHALL support three approval decisions: `APPROVE`, `RETURN`, and `REJECT`.
6. WHEN a `RETURN` decision is recorded, THE System SHALL transition the transaction to `RETURNED` status, write an `APPROVAL_RETURNED` audit event, and require the returning approver to provide a non-empty comments field.
7. WHEN a `REJECT` decision is recorded, THE System SHALL transition the transaction to `REJECTED` status, write an `APPROVAL_REJECTED` audit event, and require a non-empty comments field.
8. WHEN MD approves (stage 5), THE System SHALL transition the transaction to `MD_APPROVED` and place it in the Operations execution queue.
9. THE System SHALL enforce idempotency: submitting the same approval Server Action twice for the same `(transaction_id, stage)` SHALL NOT create a duplicate approval record.

---

### Requirement 13: Approval UI Context Panel

**User Story:** As an approver, I want to see the full transaction context on the approval page — customer, investment, calculations, voucher, documents, previous approvals, and audit timeline — so that I can make an informed decision without navigating to other screens.

#### Acceptance Criteria

1. THE System SHALL display the following on the approval page for each pending transaction: customer details, investment snapshot, transaction type and scenario, six-step control checklist with pass/fail indicators, voucher content, Calculation_Snapshot, payment instruction, uploaded supporting documents, previous approval decisions with actor and timestamp, and the audit timeline.
2. WHEN a step in the six-step checklist is not yet completed, THE System SHALL render a locked indicator with an explanation of the prerequisite.
3. THE System SHALL present Approve, Return, and Reject action buttons only to the user whose role matches the current required approval stage.
4. WHEN an approver submits a Return or Reject decision, THE System SHALL open a shadcn `Dialog` requiring the approver to enter a mandatory comment before confirming the action.
5. THE System SHALL show previously completed approval records as read-only entries with actor name, stage, decision, timestamp, and comments.

---

### Requirement 14: Operations Execution Queue

**User Story:** As an Operations Officer, I want to see a queue of MD-approved transactions ready for execution, so that I can process them in order.

#### Acceptance Criteria

1. THE System SHALL display a list of transactions in `MD_APPROVED` status to users with role `OPERATIONS`.
2. WHEN an Operations Officer selects a transaction, THE System SHALL show the full transaction workspace including the approved voucher, payment instruction, and customer details.
3. WHEN an Operations Officer submits an execution record, THE System SHALL require: `execution_status`, `external_reference`, `executed_at`, and `execution_notes`.
4. WHEN execution is recorded, THE System SHALL create an `operations_executions` row, transition the transaction to `OPERATIONS_COMPLETED`, and write an `OPERATIONS_STARTED` then `OPERATIONS_COMPLETED` audit event.
5. THE System SHALL prevent Operations from executing a transaction that has not reached `MD_APPROVED` status, enforcing this check server-side.
6. THE System SHALL enforce idempotency: submitting execution twice for the same transaction SHALL NOT create a second `operations_executions` row.

---

### Requirement 15: Treasury Completion Confirmation

**User Story:** As a Treasury Officer, I want to confirm that an executed transaction has been fully completed, so that the workflow reaches its final `COMPLETED` state as a separate confirmation from Operations execution.

#### Acceptance Criteria

1. WHEN a transaction reaches `OPERATIONS_COMPLETED` status, THE System SHALL display it in the Treasury Officer's pending completion queue.
2. WHEN the Treasury Officer confirms completion, THE System SHALL transition the transaction to `TREASURY_CONFIRMED` then `COMPLETED` status and write a `TREASURY_CONFIRMED` audit event.
3. THE System SHALL prevent transactions from being auto-completed without explicit Treasury Officer confirmation.
4. THE System SHALL enforce that only users with role `TREASURY_OFFICER` can submit a Treasury completion confirmation Server Action.

---

### Requirement 16: Transaction Workspace

**User Story:** As any staff member, I want a single canonical workspace page per transaction that shows every piece of information and every available action in one place, so that I never need to reconstruct context from separate screens.

#### Acceptance Criteria

1. THE System SHALL provide a persistent step progress tracker at the top of the transaction workspace showing steps 1–6 with completed, active, and locked states.
2. WHEN a step is completed, THE System SHALL render its section as read-only unless the transaction is formally returned for correction.
3. THE System SHALL display a sidebar panel showing: current owner (role responsible for the next action), current approval stage, SLA indicator, and linked documents.
4. THE System SHALL display an audit timeline at the bottom of the workspace showing every Audit_Event for the transaction in chronological order, read-only.
5. THE System SHALL answer the three UX questions at all times: what is this transaction; what is currently blocking it; who needs to act next.
6. WHEN the current user's role has a pending action on the transaction, THE System SHALL surface the action button prominently; otherwise the action section SHALL be read-only for that user.

---

### Requirement 17: Rollover Scenarios

**User Story:** As a Treasury Officer, I want to create and process rollover transactions for all four rollover subtypes, so that principal and/or interest reinvestment is handled according to the SOP.

#### Acceptance Criteria

1. THE System SHALL support four rollover scenarios: Principal + Interest (`P_AND_I`), Principal Only (`PRINCIPAL_ONLY`), Partial Principal (`PARTIAL_PRINCIPAL`), and Interest Only (`INTEREST_ONLY`).
2. WHEN a `P_AND_I` rollover is created, THE Calculation_Engine SHALL compute `rollover_amount = principal + interest_due` and persist a `rollover_details` row.
3. WHEN a `PRINCIPAL_ONLY` rollover is created, THE Calculation_Engine SHALL compute `principal_rolled = principal` and `interest_paid = interest_due`, and the workflow SHALL create a linked Funds-Out for the interest payout with external payment details where required.
4. WHEN a `PARTIAL_PRINCIPAL` rollover is created with an original principal and a requested payout, THE Calculation_Engine SHALL compute `remaining_principal = original_principal - requested_payout` and present the result for Treasury Officer confirmation before voucher preparation.
5. WHEN an `INTEREST_ONLY` rollover is created, THE Calculation_Engine SHALL compute the interest Funds-Out while keeping the principal investment active.
6. THE System SHALL capture new tenor, new rate, rollover maturity date, and new effective date for all rollover types where these apply.
7. WHEN a rollover is approved by MD and executed by Operations, THE Eazybankz_Adapter SHALL be called to book a new investment record in the mirror.

---

### Requirement 18: Maturity Termination

**User Story:** As a Treasury Officer, I want to process a maturity termination, so that the customer's principal and interest are paid out correctly at the investment's end date.

#### Acceptance Criteria

1. WHEN a maturity termination transaction is created, THE System SHALL link the transaction to the maturing investment and generate a `FUNDS_OUT` voucher with fields: principal, interest, WHT (defaulted to zero per SOP), net amount, transfer date, and remarks.
2. WHEN external payment is required, THE System SHALL require beneficiary name, bank name, and account number before the voucher can be prepared.
3. WHEN Operations executes a maturity termination, THE Eazybankz_Adapter SHALL update the investment status to `TERMINATED`.

---

### Requirement 19: Pre-Liquidation

**User Story:** As a Treasury Officer, I want to process full and partial pre-liquidation transactions with the SOP-specified 20% charge on accrued interest, so that the correct penalty is applied and documented.

#### Acceptance Criteria

1. THE Calculation_Engine SHALL compute `charge = accrued_interest × 0.20` and `net_interest = accrued_interest - charge` for all pre-liquidation transactions.
2. WHEN a partial pre-liquidation is processed, THE Calculation_Engine SHALL compute the rebooked principal using the SOP logic (`principal_rebooked = remaining_principal - charge`) and display all intermediate values (original principal, accrued interest, 20% charge, requested payout, remaining principal, rebooked principal) before the voucher is prepared.
3. THE System SHALL persist a `pre_liquidation_details` row containing: `original_principal`, `accrued_interest`, `charge_rate` (0.20), `charge_amount`, `requested_payout`, `remaining_principal`, `rebooked_principal`, and `net_interest`.
4. THE System SHALL save a Calculation_Snapshot with rule `PRE_LIQUIDATION_20_PERCENT`, inputs, and outputs alongside the voucher.
5. WHEN a partial pre-liquidation is approved and executed, THE Eazybankz_Adapter SHALL rebook the remaining investment with the corrected principal.

---

### Requirement 20: Anniversary Interest Payment

**User Story:** As a Treasury Officer, I want to process anniversary interest payments at 30-, 60-, and 90-day frequencies, so that customers receive periodic interest while their principal remains invested.

#### Acceptance Criteria

1. THE System SHALL support anniversary frequencies of exactly 30 days, 60 days, and 90 days, rejecting any other value.
2. WHEN an anniversary payment is processed, THE Calculation_Engine SHALL calculate the interest due based on the verified investment snapshot data.
3. THE System SHALL generate a `FUNDS_OUT` voucher with WHT defaulted to zero per SOP.
4. WHEN Operations executes the anniversary payment, THE Eazybankz_Adapter SHALL update the investment record to reflect the interest payment while keeping the principal active.

---

### Requirement 21: Third-Party Payment

**User Story:** As a Treasury Officer, I want to process third-party payment transactions with the correct transfer charge calculation for external payments and no charge for internal payments, so that all fees are correctly documented.

#### Acceptance Criteria

1. THE System SHALL classify third-party payments as either `EXTERNAL` or `INTERNAL` based on the `is_internal` field of the `payment_instructions` row.
2. WHEN an `EXTERNAL` third-party payment is processed, THE Calculation_Engine SHALL compute `transfer_charge = transfer_amount × 0.001` and display the transfer amount, transfer charge, and net impact on the voucher.
3. WHEN an `INTERNAL` third-party payment is processed, THE Calculation_Engine SHALL set `transfer_charge = 0`.
4. THE System SHALL require beneficiary name, bank name, account number, account type, amount, and purpose for external third-party payments, rejecting voucher preparation if any are missing.
5. THE System SHALL save a Calculation_Snapshot with rule `THIRD_PARTY_TRANSFER_0_10_PERCENT` for external transfers.

---

### Requirement 22: Transfer Slip Scenarios

**User Story:** As a Treasury Officer, I want to process internal transfers (Savings → Personal, Personal → Commercial Paper, Personal → Call Placement) using Transfer Slips, so that inter-account movements are properly documented.

#### Acceptance Criteria

1. THE System SHALL support four Transfer Slip scenarios: `SAVINGS_TO_PERSONAL`, `PERSONAL_TO_COMMERCIAL_PAPER`, `PERSONAL_TO_CALL_PLACEMENT`, and `REVERSAL`.
2. WHEN a transfer is initiated, THE System SHALL verify the available balance against the requested transfer amount before allowing the voucher to be prepared.
3. WHEN a `PERSONAL_TO_COMMERCIAL_PAPER` or `PERSONAL_TO_CALL_PLACEMENT` transfer is approved and executed, THE Eazybankz_Adapter SHALL book the corresponding investment record.
4. WHEN a `REVERSAL` Transfer Slip is raised, THE System SHALL require a reference to the original transaction being reversed.

---

### Requirement 23: Inflow Transactions

**User Story:** As a Treasury Officer, I want to process inflow transactions by recording receipt of funds and booking a new investment, so that new placements are fully tracked.

#### Acceptance Criteria

1. WHEN an inflow transaction is created, THE System SHALL generate a `FUNDS_IN` voucher capturing: customer name, amount, rate, tenor, effective date, and maturity date.
2. WHEN Operations executes an inflow, THE Eazybankz_Adapter SHALL create a new investment record in the mirror.
3. WHEN Treasury confirms an inflow completion, THE System SHALL verify that the new investment record exists in the Eazybankz_Mirror before marking the transaction `COMPLETED`.

---

### Requirement 24: Savings, Call, and CMS Funds-Out

**User Story:** As a Treasury Officer, I want to process savings, call, and CMS funds-out transactions, so that customer withdrawals from these account types are properly authorised and executed.

#### Acceptance Criteria

1. THE System SHALL require investment/balance verification (Step 4) for all `SAVINGS_FUNDS_OUT`, `CALL_FUNDS_OUT`, and `CMS_FUNDS_OUT` transactions.
2. THE System SHALL treat the interest value for these transactions as an external source value from THE Eazybankz_Adapter, not an internally calculated value, per SOP.
3. WHEN a Savings/Call/CMS Funds-Out is approved and executed, THE Eazybankz_Adapter SHALL record the payment and update the account balance.

---

### Requirement 25: Reversal

**User Story:** As a Treasury Officer, I want to initiate a reversal to correct a transaction with an incorrect rate, tenor, or amount, so that the error is corrected without destroying the original transaction history.

#### Acceptance Criteria

1. THE System SHALL create a new reversal transaction that references the original transaction ID; the original transaction SHALL NOT be deleted or overwritten.
2. THE System SHALL require a non-empty reversal reason before the reversal transaction can be submitted.
3. WHEN a reversal is approved and executed, THE Eazybankz_Adapter SHALL reverse the original posting and create a corrected investment or payment record.
4. THE System SHALL write audit events for both the reversal initiation and the reversal execution, referencing the original transaction reference.
5. WHEN a reversal is created, THE System SHALL validate that the original transaction is in a state eligible for reversal (i.e., not already reversed or in `DRAFT` state).

---

### Requirement 26: Financial Calculation Engine

**User Story:** As a developer, I want all financial calculations performed server-side with decimal-safe arithmetic and immutable snapshots, so that no financial result can be falsified by a browser client.

#### Acceptance Criteria

1. THE Calculation_Engine SHALL provide these server-side functions: `calculateRollover()`, `calculatePreLiquidation()`, `calculateThirdPartyCharge()`, `calculateAnniversaryPayment()`, and `calculateMaturityTermination()`.
2. EVERY calculation function SHALL return a Calculation_Snapshot containing: `rule`, `inputs`, `outputs`, and `calculated_at`.
3. THE System SHALL use PostgreSQL `numeric` type or server-side decimal arithmetic for all money calculations; JavaScript floating-point arithmetic SHALL NOT be used as the authoritative result.
4. THE System SHALL recalculate all financial values server-side immediately before saving a voucher, even if the frontend previewed a value — the server result is authoritative.
5. THE System SHALL persist every Calculation_Snapshot in the `vouchers` table or a related snapshot table so that Audit can reproduce any historical calculation.
6. FOR ALL pre-liquidation calculations, THE Calculation_Engine SHALL reproduce the SOP example exactly: accrued interest ₦1,500,000 → charge ₦300,000 → net interest ₦1,200,000.

---

### Requirement 27: Document Upload and Storage

**User Story:** As a Treasury Officer, I want to upload customer instruction documents and supporting evidence attached to a transaction, so that all physical paper evidence is digitally preserved in the system.

#### Acceptance Criteria

1. THE System SHALL upload transaction documents to a private Supabase Storage bucket named `transaction-documents`, organised by path `{transaction_id}/{document_type}/{filename}`.
2. THE System SHALL validate file type (PDF, JPG, PNG) and file size (maximum 10 MB) client-side before upload, rejecting invalid files with a shadcn `Alert` message.
3. THE System SHALL display short-lived signed URLs (maximum 60-minute expiry) for document access; permanent public URLs SHALL NOT be generated.
4. WHEN a document is uploaded, THE System SHALL create a `transaction_documents` row and write a document upload Audit_Event.
5. WHEN a document upload fails, THE System SHALL display a shadcn `Toast` with an error message and retain the partially completed upload state so the user can retry.
6. THE System SHALL enforce Storage policies so that only users with an authorised relationship to the transaction can read documents attached to that transaction.

---

### Requirement 28: Audit Trail

**User Story:** As an Audit Officer, I want to view a complete, immutable chronological timeline of every event on a transaction, so that I can verify every control was executed in order.

#### Acceptance Criteria

1. THE System SHALL write an Audit_Event for each of these occurrences: `TRANSACTION_CREATED`, `INSTRUCTION_RECEIVED`, `SIGNATURE_VERIFIED`, `SIGNATURE_FAILED`, `CUSTOMER_CONFIRMED`, `INVESTMENT_VERIFIED`, `VOUCHER_CREATED`, `APPROVAL_GRANTED`, `APPROVAL_RETURNED`, `APPROVAL_REJECTED`, `OPERATIONS_STARTED`, `OPERATIONS_COMPLETED`, `TREASURY_CONFIRMED`, `REVERSAL_CREATED`, and `UNAUTHORIZED_ATTEMPT`.
2. EVERY Audit_Event SHALL contain: `id`, `transaction_id`, `actor_id`, `event_type`, `from_status`, `to_status`, `metadata` (JSONB), and `created_at`.
3. THE System SHALL render the audit timeline on the transaction workspace in chronological ascending order, with each event showing: timestamp, event type, actor name, from/to status, and relevant metadata.
4. THE System SHALL make the audit timeline read-only in the UI; no edit or delete control SHALL be rendered.
5. THE System SHALL enforce at the database level that `UPDATE` and `DELETE` operations on `audit_events` are denied for application roles.
6. IF an audit record is incorrect, THE System SHALL create a correction Audit_Event rather than modifying the original.

---

### Requirement 29: Transaction Search and Filtering

**User Story:** As a Treasury Officer, I want to search and filter transactions by type, status, date, customer, investment, reference, or assigned role stage, so that I can quickly find any transaction across all workflows.

#### Acceptance Criteria

1. THE System SHALL provide a transaction list view with filter controls for: transaction type, status, date range (from/to), customer name, investment reference, transaction reference, and current owner role/stage.
2. WHEN filters are applied, THE System SHALL query the `treasury_transactions` table server-side with the selected criteria and return paginated results.
3. THE System SHALL support free-text search across `transaction_reference` and customer name with at minimum prefix matching.
4. THE System SHALL display search results in a paginated table with a configurable page size of 10, 25, or 50 rows.

---

### Requirement 30: Eazybankz Mock Adapter

**User Story:** As a developer, I want a server-side Eazybankz adapter module with a mock implementation, so that the treasury workflow can be fully tested without a real external banking integration.

#### Acceptance Criteria

1. THE Eazybankz_Adapter SHALL expose these operations: `getInvestment(id)`, `getBalance(accountId)`, `getAccruedInterest(investmentId)`, `createInvestment(data)`, `updateInvestment(id, data)`, `createTransaction(data)`, and `reverseTransaction(id, reason)`.
2. THE mock implementation SHALL return seeded data that is consistent with the test customer scenarios defined in the test users document (Customers A through R).
3. THE Eazybankz_Adapter interface SHALL be defined so that the mock implementation can be replaced with a real integration without changing the calling code.
4. THE System SHALL never call Eazybankz_Adapter operations directly from a browser component; all adapter calls SHALL be made from Server Actions or Route Handlers.
5. WHEN the Eazybankz_Adapter returns an error, THE System SHALL propagate the error through the Server Action, display a shadcn `Toast` with the error message, and write an audit event recording the failure.

---

### Requirement 31: Notifications

**User Story:** As a staff member, I want to receive in-app notifications when a transaction reaches a stage requiring my action, so that I do not miss pending work.

#### Acceptance Criteria

1. WHEN a transaction transitions to a status that assigns ownership to a role, THE System SHALL create a notification record for all users with that role.
2. THE System SHALL display an unread notification count badge on the navigation header bell icon.
3. WHEN a user clicks a notification, THE System SHALL navigate to the relevant transaction workspace.
4. THE System SHALL mark notifications as read when the user views the transaction workspace.

---

### Requirement 32: UI Component Standards and Design Engineering

**User Story:** As a design engineer, I want all interactive components to follow the Emil Kowalski design engineering principles, so that the application feels polished, fast, and precise.

#### Acceptance Criteria

1. THE System SHALL use shadcn `Toast` (via Sonner) for all transient feedback messages (success, error, info) — raw `div` error elements SHALL NOT be used for these purposes in new code.
2. THE System SHALL use shadcn `Alert` for inline, non-dismissible status messages such as workflow locks, signature failure notices, and form-level errors.
3. THE System SHALL use shadcn `Dialog` for all confirmation dialogs that require explicit user acknowledgement before a destructive or irreversible action.
4. ALL animated UI elements SHALL use `ease-out` or a custom cubic-bezier curve (`cubic-bezier(0.23, 1, 0.32, 1)` or equivalent) — `ease-in` SHALL NOT be used for any UI animation.
5. ALL animated UI elements SHALL complete their transition in under 300ms (buttons: 100–160ms; tooltips and small popovers: 125–200ms; modals and drawers: 200–300ms).
6. ALL entry animations SHALL start from `scale(0.95)` with `opacity: 0`, not from `scale(0)`.
7. ALL pressable elements (buttons, action items) SHALL apply `transform: scale(0.97)` on `:active` state with a 150ms `ease-out` transition.
8. WHERE a popover or dropdown is anchored to a trigger, THE System SHALL set `transform-origin` to the trigger location, not center; modals SHALL retain `transform-origin: center`.
9. WHEN the user has `prefers-reduced-motion` enabled, THE System SHALL suppress all transform-based motion animations while retaining opacity and color transitions.
10. THE System SHALL use React Hook Form with Zod for all forms; no raw uncontrolled form submissions with manual validation logic SHALL be introduced for new forms.
11. THE System SHALL apply hover animations exclusively under `@media (hover: hover) and (pointer: fine)` to prevent false hover triggers on touch devices.

---

### Requirement 33: Concurrency and Idempotency

**User Story:** As a developer, I want all financial state-changing operations to be protected against race conditions and duplicate submissions, so that no transaction can be double-approved or double-executed.

#### Acceptance Criteria

1. THE System SHALL use PostgreSQL transactions with appropriate row locking for all operations that read then update `treasury_transactions.status`.
2. THE System SHALL enforce the unique constraint on `(transaction_id, stage)` in `approvals` at the database level to reject concurrent duplicate approval attempts.
3. THE System SHALL enforce the unique constraint on `transaction_id` in `operations_executions` to prevent double execution.
4. WHEN a Server Action receives a duplicate submission for the same idempotent operation, THE System SHALL return the existing result rather than creating a second record.
5. THE System SHALL use database-level constraints as the primary idempotency guarantee, not application-level deduplication logic alone.

---

### Requirement 34: Seed Data for Testing

**User Story:** As a developer, I want seed data covering all test users and customer scenarios from the test specification, so that every transaction flow can be exercised end-to-end from day one.

#### Acceptance Criteria

1. THE System SHALL provide seed SQL or a seed script creating one user per role: `TREASURY_OFFICER`, `ACCOUNT_OFFICER`, `HEAD_TREASURY`, `MIS`, `AUDIT`, `MD`, and `OPERATIONS`.
2. THE System SHALL create seed customers A through R as defined in the test users document, with associated investment and account records matching the documented principal, accrued interest, and rate values.
3. THE System SHALL include a negative test scenario seed for: signature mismatch, insufficient balance, and unauthorized role approval attempt.
4. THE seed data SHALL be applied only to non-production Supabase environments via a migration file or a `seed.sql` file separate from the production schema.

---

### Requirement 35: Security Hardening

**User Story:** As a security engineer, I want the backend to operate with a zero-trust posture toward the frontend, so that even a compromised browser cannot skip workflow steps, impersonate roles, falsify financial values, or tamper with audit history.

#### Acceptance Criteria

1. THE System SHALL derive the authenticated user's ID and role exclusively from the Supabase session on every Server Action — the request body SHALL NOT be trusted for identity or role.
2. THE System SHALL prevent any direct client-side write to `status`, `approved_amount`, `approvals`, or `audit_events` columns by enforcing RLS policies that block direct `UPDATE`/`INSERT` on these columns from the `anon` and `authenticated` roles.
3. THE System SHALL expose all critical mutations as PostgreSQL RPC functions (`create_treasury_transaction`, `verify_signature`, `record_customer_confirmation`, `verify_investment`, `prepare_voucher`, `approve_transaction`, `execute_transaction`, `confirm_treasury_completion`, `create_reversal`) that validate inputs, actor role, and transaction state before performing any change.
4. THE System SHALL never expose the `SUPABASE_SERVICE_ROLE_KEY` to any browser-accessible code or environment variable.
5. THE System SHALL log a `UNAUTHORIZED_ATTEMPT` audit event whenever a Server Action rejects a request due to insufficient role or invalid state, without exposing the internal rejection reason to the caller beyond a generic 403 message.
6. IF the backend detects that a transaction is being submitted for approval out of sequence, THEN THE System SHALL reject the request, log the attempt, and return a generic 403 without indicating which stage is required.

---

### Requirement 36: Standardised Payment Instruction Block

**User Story:** As a Treasury Officer, I want every Funds-Out voucher and Rollover Slip that involves money leaving the company to include a standardised Payment Instruction section, so that all outgoing payment details are captured consistently and completely.

#### Acceptance Criteria

1. THE System SHALL include a structured `PAYMENT INSTRUCTION` section on all `FUNDS_OUT` vouchers and `ROLLOVER_SLIP` vouchers where money leaves the company, containing: Beneficiary Name, Bank Name, Account Number, Account Type, Amount, and Transfer Charge (if applicable).
2. WHEN a transaction scenario requires an external payment, THE System SHALL enforce that all six Payment Instruction fields are populated before the voucher can be saved — the voucher preparation Server Action SHALL reject an incomplete Payment Instruction block.
3. WHEN a transaction scenario involves an internal account transfer with no external beneficiary, THE System SHALL still render the Payment Instruction section but mark Transfer Charge as `₦0` and pre-fill the internal account details where available.
4. THE System SHALL persist the Payment Instruction as a structured JSON field (not free-form remarks text) on the `vouchers` table so it is queryable and auditable.
5. THE System SHALL display the Payment Instruction block as a distinct, clearly labelled section on the voucher UI, separate from the main voucher fields.

---

### Requirement 37: GAPS SLA Tracking

**User Story:** As a Treasury Officer and Head Treasury, I want every transaction to be tracked against a SLA deadline, so that delayed transactions are visible and exceptions can be escalated before they breach the GAPS SLA.

#### Acceptance Criteria

1. THE System SHALL record a `sla_due_at` timestamp on every `treasury_transactions` row, calculated server-side at transaction creation based on a configurable SLA duration (default: same business day unless overridden by admin configuration).
2. WHEN a transaction's current timestamp exceeds `sla_due_at` and its status is not `COMPLETED`, `REJECTED`, or `CANCELLED`, THE System SHALL mark the transaction as an SLA exception and include it in the "Exceptions" dashboard count.
3. THE System SHALL display an SLA indicator on the transaction workspace sidebar showing: time remaining (green if >2 hours), approaching (amber if ≤2 hours), or breached (red if past due).
4. WHEN a transaction transitions to `COMPLETED`, `REJECTED`, or `CANCELLED`, THE System SHALL record a `completed_at` timestamp and cease SLA tracking for that transaction.
5. THE System SHALL allow an `ADMIN` user to configure the default SLA duration per transaction type via an admin settings page; until configured, the System SHALL default to end-of-business-day SLA.
6. THE control checklist item "Transaction completed within GAPS SLA" SHALL be derived from the `sla_due_at` vs `completed_at` comparison and displayed as a pass/fail indicator on the transaction workspace.

---

### Requirement 38: Savings/Call/CMS Funds-Out Voucher — Available Balance Field

**User Story:** As a Treasury Officer, I want the Funds-Out voucher for Savings, Call, and CMS transactions to display the customer's available balance as the primary amount field, so that the voucher accurately reflects the source account balance as confirmed in Eazybankz.

#### Acceptance Criteria

1. WHEN a `SAVINGS_FUNDS_OUT`, `CALL_FUNDS_OUT`, or `CMS_FUNDS_OUT` voucher is generated, THE System SHALL populate an `available_balance` field sourced from the `investment_verifications` snapshot rather than a calculated principal/interest split.
2. THE System SHALL render the Funds-Out voucher for these transaction types with `Available Balance` as the primary amount display, followed by Transfer Date and Remarks — replacing the principal/interest/WHT layout used for other Funds-Out types.
3. WHEN the Payment Instruction section is required for an external Savings/Call/CMS payment, THE System SHALL enforce the standardised Payment Instruction block per Requirement 36.
4. THE System SHALL source the interest value for these transactions exclusively from THE Eazybankz_Adapter and SHALL NOT apply any internal interest calculation formula to them, per SOP.

---

### Requirement 39: Per-Scenario and End-to-End Test User Seed Data

**User Story:** As a developer and tester, I want dedicated seed users for every transaction scenario plus a complete set of new-user accounts that can walk through the full SOP workflow from scratch, so that every use case can be tested in isolation and end-to-end without data overlap.

#### Acceptance Criteria

1. THE System SHALL seed one dedicated staff user per role for scenario-specific testing: `treasury_maker_01` (TREASURY_OFFICER), `account_officer_01` (ACCOUNT_OFFICER), `head_treasury_01` (HEAD_TREASURY), `mis_officer_01` (MIS), `audit_officer_01` (AUDIT), `md_01` (MD), and `operations_officer_01` (OPERATIONS).
2. THE System SHALL seed a second complete set of staff users — one per role — named with suffix `_e2e` (e.g., `treasury_maker_e2e`, `account_officer_e2e`) that are reserved exclusively for full end-to-end workflow testing from instruction creation through to Treasury completion confirmation.
3. THE System SHALL seed one dedicated test customer per transaction scenario (Customers A through R as specified in the test users document), each with pre-seeded investment and account records matching the documented principal, accrued interest, rate, and balance values, so that no two scenario tests share customer data.
4. WHEN a new end-to-end test run begins using the `_e2e` user set, THE System's seed script SHALL provide a reset function that returns all `_e2e`-related transactions to `DRAFT` or deletes them, without affecting scenario-specific user data.
5. THE System SHALL seed negative test scenarios as separate customer records for: signature mismatch, incomplete instruction, customer confirmation failed, insufficient available balance, missing beneficiary data, approval attempted out of sequence, and unauthorized role attempting approval.
6. THE seed data SHALL be idempotent — running the seed script multiple times SHALL NOT create duplicate users, customers, or investments.
