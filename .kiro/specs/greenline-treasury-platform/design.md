# Design Document — Greenline Treasury Platform

## Overview

The Greenline Treasury Operations platform digitises the First Marina Trust Finance Company SOP for treasury operations. The application replaces a manual, paper-based workflow with a controlled, auditable, role-enforced digital workspace.

The core architectural insight is that this is **not a collection of forms** — it is a **transaction workflow engine**. Every treasury transaction is a state machine that must pass through at least six mandatory control gates before money moves. The database is the source of truth for workflow state; the browser is a rendering surface only.

### Design Priorities

1. **Security boundary**: PostgreSQL RLS and server-side RPC functions are the real enforcement layer. The frontend enforces the SOP visually; the backend enforces it unconditionally.
2. **Auditability**: Every state transition writes an append-only audit event. Nothing is silently changed.
3. **Financial integrity**: All monetary calculations run server-side using PostgreSQL `numeric`. JavaScript floating-point arithmetic is never the authoritative result.
4. **Workflow completeness**: The six-step SOP sequence cannot be skipped, reordered, or bypassed — even by an Admin.
5. **Design polish**: Emil Kowalski design engineering principles govern all animations, interactions, and feedback patterns.

---

## Architecture

### Application Layers

```
┌─────────────────────────────────────────────────────┐
│                   Browser (React 19)                │
│  Server Components (data)  +  Client Components     │
│  React Hook Form + Zod     +  shadcn/ui + Sonner    │
└───────────────────┬─────────────────────────────────┘
                    │ fetch / Server Actions
┌───────────────────▼─────────────────────────────────┐
│          Next.js 16 App Router (Server)             │
│  Middleware (session refresh + route protection)    │
│  Server Actions → Application Service Layer         │
│  Route Handlers (webhook endpoints)                 │
└───────────────────┬─────────────────────────────────┘
                    │ supabase-js (server client)
┌───────────────────▼─────────────────────────────────┐
│           Supabase Platform                         │
│  PostgreSQL RPC functions  ←  RLS policies          │
│  Supabase Auth             ←  Session cookies       │
│  Supabase Storage          ←  Storage policies      │
│  Supabase Realtime         ←  Dashboard subscript.  │
└─────────────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│         Eazybankz Adapter (server-side only)        │
│  Mock implementation (Phase 6: real integration)    │
└─────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**Browser layer**: Renders server component data, handles form interactions with React Hook Form + Zod, invokes Server Actions for mutations, displays feedback via shadcn Toast/Alert/Dialog.

**Next.js server layer**: Middleware refreshes sessions and redirects unauthenticated requests. Server Actions validate inputs, resolve the authenticated user's role from the database (never from the request body), delegate to the service layer, and return structured results.

**Application service layer** (`lib/services/`): Pure TypeScript functions encapsulating business logic — workflow transitions, calculation engine, voucher generation, Eazybankz adapter calls. Imported only by Server Actions and Route Handlers.

**PostgreSQL RPC layer**: Atomic, transactional operations for all state-changing mutations. Functions validate actor role, transaction state, prerequisites, perform the change, and write the audit event — all in one database transaction.

**RLS layer**: Row-level security is the final enforcement boundary. Every table has policies that prevent unauthorised reads and writes regardless of what the application layer sends.

### Request Flow — Approval Example

```
User clicks "Approve" button
        ↓
approveTransactionAction(transactionId, stage, decision, comments)   [Server Action]
        ↓
createServerClient() → supabase.auth.getUser()                       [session check]
        ↓
resolveUserRole(userId)                                               [DB query]
        ↓
supabase.rpc('approve_transaction', { ... })                          [PostgreSQL RPC]
        ↓
  authenticate actor             ]
  load transaction               ] atomic PostgreSQL
  verify actor role              ] transaction with
  verify prior stage complete    ] FOR UPDATE lock
  INSERT into approvals          ]
  UPDATE treasury_transactions   ]
  INSERT into audit_events       ]
        ↓
return { success, newStatus, auditEvent }
        ↓
revalidatePath('/transactions/[id]')
        ↓
shadcn Toast + page re-render
```

---

## Database Schema

### Schema Design Principles

- All monetary and rate columns use `NUMERIC` (never `FLOAT` or `DOUBLE PRECISION`).
- Foreign keys enforce referential integrity across all tables.
- `audit_events` is append-only: `UPDATE` and `DELETE` are revoked from all application roles.
- UUIDs are used for all primary keys except `audit_events` (which uses `BIGINT GENERATED ALWAYS AS IDENTITY` for ordered sequential access).
- All tables have `created_at TIMESTAMPTZ DEFAULT NOW()`.

### Table 1: `profiles`

Mirrors `auth.users`. Created via database trigger on user sign-up.

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK, FK → `auth.users.id` |
| `full_name` | `TEXT` | NOT NULL |
| `email` | `TEXT` | NOT NULL, UNIQUE |
| `phone` | `TEXT` | |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 2: `roles`

Static lookup table. Seeded by migration.

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` |
| `code` | `TEXT` | NOT NULL, UNIQUE |
| `name` | `TEXT` | NOT NULL |

Seeded codes: `CUSTOMER`, `ACCOUNT_OFFICER`, `TREASURY_OFFICER`, `HEAD_TREASURY`, `MIS`, `AUDIT`, `MD`, `OPERATIONS`, `ADMIN`.

### Table 3: `user_roles`

Many-to-many join. A user may hold multiple roles.

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `UUID` | PK component, FK → `profiles.id` |
| `role_id` | `UUID` | PK component, FK → `roles.id` |
| `assigned_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `assigned_by` | `UUID` | FK → `profiles.id` |

Primary Key: `(user_id, role_id)`.

### Table 4: `customers`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `customer_number` | `TEXT` | NOT NULL, UNIQUE |
| `name` | `TEXT` | NOT NULL |
| `registered_phone` | `TEXT` | |
| `status` | `TEXT` | NOT NULL, DEFAULT `'ACTIVE'` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 5: `customer_accounts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `customer_id` | `UUID` | NOT NULL, FK → `customers.id` |
| `account_number` | `TEXT` | NOT NULL, UNIQUE |
| `account_type` | `TEXT` | NOT NULL — `SAVINGS`, `PERSONAL`, `COMMERCIAL_PAPER`, `CALL`, `CMS` |
| `status` | `TEXT` | NOT NULL, DEFAULT `'ACTIVE'` |
| `available_balance` | `NUMERIC(20,4)` | NOT NULL, DEFAULT `0` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 6: `investments`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `customer_id` | `UUID` | NOT NULL, FK → `customers.id` |
| `account_id` | `UUID` | FK → `customer_accounts.id` |
| `external_reference` | `TEXT` | — Eazybankz investment ID |
| `product_type` | `TEXT` | NOT NULL — `FIXED_DEPOSIT`, `CALL`, `COMMERCIAL_PAPER`, `CMS` |
| `principal` | `NUMERIC(20,4)` | NOT NULL |
| `interest_rate` | `NUMERIC(10,6)` | NOT NULL |
| `accrued_interest` | `NUMERIC(20,4)` | NOT NULL, DEFAULT `0` |
| `effective_date` | `DATE` | NOT NULL |
| `maturity_date` | `DATE` | |
| `outstanding_balance` | `NUMERIC(20,4)` | NOT NULL |
| `available_amount` | `NUMERIC(20,4)` | NOT NULL |
| `status` | `TEXT` | NOT NULL, DEFAULT `'ACTIVE'` — `ACTIVE`, `TERMINATED`, `ROLLED_OVER`, `MATURED` |
| `source_system` | `TEXT` | DEFAULT `'EAZYBANKZ'` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

**Indexes**: `investments(customer_id, status)`.

### Table 7: `treasury_transactions`

The central workflow table. Status column drives the state machine.

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_reference` | `TEXT` | NOT NULL, UNIQUE — server-generated `TRX-XXXXX` |
| `customer_id` | `UUID` | NOT NULL, FK → `customers.id` |
| `investment_id` | `UUID` | FK → `investments.id` — NULL for inflows |
| `transaction_type` | `TEXT` | NOT NULL |
| `scenario_code` | `TEXT` | — `P_AND_I`, `PRINCIPAL_ONLY`, etc. |
| `status` | `TEXT` | NOT NULL, DEFAULT `'DRAFT'` |
| `currency` | `TEXT` | NOT NULL, DEFAULT `'NGN'` |
| `requested_amount` | `NUMERIC(20,4)` | NOT NULL |
| `approved_amount` | `NUMERIC(20,4)` | — set at MD approval |
| `purpose` | `TEXT` | NOT NULL |
| `source_instruction_type` | `TEXT` | NOT NULL — `LETTER`, `EMAIL`, `SIGNED_FORM`, `MANDATED` |
| `sla_due_at` | `TIMESTAMPTZ` | — set server-side at creation |
| `created_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `completed_at` | `TIMESTAMPTZ` | — set when status → COMPLETED/REJECTED/CANCELLED |

**Transaction types**: `ROLLOVER`, `MATURITY_TERMINATION`, `PRE_LIQUIDATION`, `ANNIVERSARY_PAYMENT`, `THIRD_PARTY_PAYMENT`, `INTERNAL_TRANSFER`, `INFLOW`, `SAVINGS_FUNDS_OUT`, `CALL_FUNDS_OUT`, `CMS_FUNDS_OUT`, `REVERSAL`.

**Status values**: `DRAFT`, `INSTRUCTION_RECEIVED`, `SIGNATURE_VERIFIED`, `CUSTOMER_CONFIRMED`, `INVESTMENT_VERIFIED`, `VOUCHER_PREPARED`, `TREASURY_APPROVED`, `HEAD_TREASURY_APPROVED`, `MIS_APPROVED`, `AUDIT_APPROVED`, `MD_APPROVED`, `OPERATIONS_PROCESSING`, `OPERATIONS_COMPLETED`, `TREASURY_CONFIRMED`, `COMPLETED`, `RETURNED`, `REJECTED`, `CANCELLED`, `FAILED`.

**Indexes**: `(status)`, `(transaction_type)`, `(customer_id)`, `(created_at DESC)`.

### Table 8: `payment_instructions`

One-to-one with `treasury_transactions`. Persisted as structured data (not free-form text).

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `beneficiary_name` | `TEXT` | |
| `bank_name` | `TEXT` | |
| `account_number` | `TEXT` | |
| `account_type` | `TEXT` | |
| `amount` | `NUMERIC(20,4)` | |
| `transfer_charge` | `NUMERIC(20,4)` | DEFAULT `0` |
| `purpose` | `TEXT` | |
| `is_internal` | `BOOLEAN` | NOT NULL, DEFAULT `false` |
| `verified_at` | `TIMESTAMPTZ` | |
| `verified_by` | `UUID` | FK → `profiles.id` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 9: `signature_verifications`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `verified_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `signature_result` | `TEXT` | NOT NULL — `PASSED`, `FAILED` |
| `mandate_result` | `TEXT` | NOT NULL — `PASSED`, `FAILED` |
| `account_ownership_result` | `TEXT` | NOT NULL — `PASSED`, `FAILED` |
| `completeness_result` | `TEXT` | NOT NULL — `PASSED`, `FAILED` |
| `notes` | `TEXT` | |
| `verified_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

### Table 10: `customer_confirmations`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `confirmed_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `confirmation_status` | `TEXT` | NOT NULL — `CONFIRMED`, `FAILED`, `UNREACHABLE` |
| `confirmed_amount` | `NUMERIC(20,4)` | NOT NULL |
| `confirmed_beneficiary` | `TEXT` | |
| `confirmed_purpose` | `TEXT` | NOT NULL |
| `confirmation_date` | `DATE` | NOT NULL |
| `confirmation_time` | `TIME` | NOT NULL |
| `notes` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 11: `investment_verifications`

The immutable snapshot that drives all downstream calculations.

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `verified_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `source_system` | `TEXT` | NOT NULL, DEFAULT `'EAZYBANKZ'` |
| `principal` | `NUMERIC(20,4)` | NOT NULL |
| `accrued_interest` | `NUMERIC(20,4)` | NOT NULL |
| `interest_rate` | `NUMERIC(10,6)` | NOT NULL |
| `effective_date` | `DATE` | NOT NULL |
| `maturity_date` | `DATE` | |
| `outstanding_balance` | `NUMERIC(20,4)` | NOT NULL |
| `available_amount` | `NUMERIC(20,4)` | NOT NULL |
| `verified_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

### Table 12: `vouchers`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `voucher_number` | `TEXT` | NOT NULL, UNIQUE — server-generated |
| `voucher_type` | `TEXT` | NOT NULL — `FUNDS_IN`, `FUNDS_OUT`, `ROLLOVER_SLIP`, `TRANSFER_SLIP` |
| `status` | `TEXT` | NOT NULL, DEFAULT `'DRAFT'` — `DRAFT`, `FINALISED` |
| `principal` | `NUMERIC(20,4)` | |
| `interest` | `NUMERIC(20,4)` | |
| `wht` | `NUMERIC(20,4)` | DEFAULT `0` |
| `charge` | `NUMERIC(20,4)` | DEFAULT `0` |
| `net_amount` | `NUMERIC(20,4)` | |
| `available_balance` | `NUMERIC(20,4)` | — for SAVINGS/CALL/CMS Funds-Out |
| `transfer_date` | `DATE` | |
| `remarks` | `TEXT` | |
| `payment_instruction` | `JSONB` | — structured Payment Instruction block |
| `calculation_snapshot` | `JSONB` | NOT NULL — immutable calculation record |
| `created_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 13: `rollover_details`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `rollover_type` | `TEXT` | NOT NULL — `P_AND_I`, `PRINCIPAL_ONLY`, `PARTIAL_PRINCIPAL`, `INTEREST_ONLY` |
| `original_principal` | `NUMERIC(20,4)` | NOT NULL |
| `interest_due` | `NUMERIC(20,4)` | NOT NULL |
| `principal_rolled` | `NUMERIC(20,4)` | |
| `interest_paid` | `NUMERIC(20,4)` | |
| `requested_payout` | `NUMERIC(20,4)` | |
| `new_rate` | `NUMERIC(10,6)` | |
| `new_tenor` | `INTEGER` | — days |
| `new_effective_date` | `DATE` | |
| `new_maturity_date` | `DATE` | |
| `new_rollover_amount` | `NUMERIC(20,4)` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 14: `pre_liquidation_details`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `original_principal` | `NUMERIC(20,4)` | NOT NULL |
| `accrued_interest` | `NUMERIC(20,4)` | NOT NULL |
| `charge_rate` | `NUMERIC(10,6)` | NOT NULL, DEFAULT `0.20` |
| `charge_amount` | `NUMERIC(20,4)` | NOT NULL |
| `requested_payout` | `NUMERIC(20,4)` | |
| `remaining_principal` | `NUMERIC(20,4)` | |
| `rebooked_principal` | `NUMERIC(20,4)` | |
| `net_interest` | `NUMERIC(20,4)` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

### Table 15: `approvals`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, FK → `treasury_transactions.id` |
| `stage` | `TEXT` | NOT NULL — `TREASURY`, `HEAD_TREASURY`, `MIS`, `AUDIT`, `MD` |
| `approver_id` | `UUID` | NOT NULL, FK → `profiles.id` |
| `decision` | `TEXT` | NOT NULL — `APPROVE`, `RETURN`, `REJECT` |
| `comments` | `TEXT` | — REQUIRED for RETURN and REJECT |
| `approved_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

**Unique constraint**: `(transaction_id, stage)` — prevents duplicate approvals.

**Index**: `(transaction_id, stage)`.

### Table 16: `operations_executions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, UNIQUE, FK → `treasury_transactions.id` |
| `executed_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `execution_status` | `TEXT` | NOT NULL — `SUCCESS`, `FAILED`, `PARTIAL` |
| `external_reference` | `TEXT` | |
| `execution_notes` | `TEXT` | |
| `executed_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

**Index**: `(transaction_id)`.

### Table 17: `audit_events`

Append-only. Application roles are denied UPDATE and DELETE.

| Column | Type | Constraints |
|---|---|---|
| `id` | `BIGINT GENERATED ALWAYS AS IDENTITY` | PK |
| `transaction_id` | `UUID` | FK → `treasury_transactions.id` — nullable for system events |
| `actor_id` | `UUID` | FK → `profiles.id` |
| `event_type` | `TEXT` | NOT NULL |
| `from_status` | `TEXT` | |
| `to_status` | `TEXT` | |
| `metadata` | `JSONB` | DEFAULT `'{}'` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` |

**Event types**: `TRANSACTION_CREATED`, `INSTRUCTION_RECEIVED`, `SIGNATURE_VERIFIED`, `SIGNATURE_FAILED`, `CUSTOMER_CONFIRMED`, `INVESTMENT_VERIFIED`, `VOUCHER_CREATED`, `APPROVAL_GRANTED`, `APPROVAL_RETURNED`, `APPROVAL_REJECTED`, `OPERATIONS_STARTED`, `OPERATIONS_COMPLETED`, `TREASURY_CONFIRMED`, `REVERSAL_CREATED`, `UNAUTHORIZED_ATTEMPT`, `DOCUMENT_UPLOADED`.

**Index**: `(transaction_id, created_at ASC)`.

### Table 18: `transaction_documents`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `transaction_id` | `UUID` | NOT NULL, FK → `treasury_transactions.id` |
| `document_type` | `TEXT` | NOT NULL — `INSTRUCTION`, `SIGNED_FORM`, `EVIDENCE`, `MANDATE` |
| `storage_path` | `TEXT` | NOT NULL |
| `uploaded_by` | `UUID` | NOT NULL, FK → `profiles.id` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

---

## Transaction State Machine

### States and Transitions

```
                    ┌─────────┐
                    │  DRAFT  │  (optional pre-submission state)
                    └────┬────┘
                         │ receiveInstruction()
                    ┌────▼──────────────────┐
                    │  INSTRUCTION_RECEIVED  │  Step 1 complete
                    └────┬──────────────────┘
                         │ verifySignature() → PASSED
                    ┌────▼─────────────────┐
                    │  SIGNATURE_VERIFIED   │  Step 2 complete
                    └────┬─────────────────┘
                         │ confirmCustomer() → CONFIRMED
                    ┌────▼─────────────────┐
                    │  CUSTOMER_CONFIRMED   │  Step 3 complete
                    └────┬─────────────────┘
                         │ verifyInvestment()
                    ┌────▼──────────────────┐
                    │  INVESTMENT_VERIFIED   │  Step 4 complete
                    └────┬──────────────────┘
                         │ prepareVoucher()
                    ┌────▼─────────────────┐
                    │   VOUCHER_PREPARED    │  Step 5 complete
                    └────┬─────────────────┘
                         │ approve(TREASURY)
                    ┌────▼──────────────────┐
                    │  TREASURY_APPROVED    │  Stage 1 approval
                    └────┬──────────────────┘
                         │ approve(HEAD_TREASURY)
                    ┌────▼─────────────────────────┐
                    │  HEAD_TREASURY_APPROVED       │  Stage 2 approval
                    └────┬─────────────────────────┘
                         │ approve(MIS)
                    ┌────▼──────────────────┐
                    │    MIS_APPROVED        │  Stage 3 approval
                    └────┬──────────────────┘
                         │ approve(AUDIT)
                    ┌────▼──────────────────┐
                    │   AUDIT_APPROVED       │  Stage 4 approval
                    └────┬──────────────────┘
                         │ approve(MD)
                    ┌────▼──────────────────┐
                    │    MD_APPROVED         │  Stage 5 → ops queue
                    └────┬──────────────────┘
                         │ executeTransaction()
                    ┌────▼──────────────────────┐
                    │  OPERATIONS_PROCESSING    │
                    └────┬──────────────────────┘
                         │ (execution complete)
                    ┌────▼──────────────────────┐
                    │  OPERATIONS_COMPLETED     │
                    └────┬──────────────────────┘
                         │ confirmTreasuryCompletion()
                    ┌────▼──────────────────────┐
                    │  TREASURY_CONFIRMED       │
                    └────┬──────────────────────┘
                         │ (system auto-close)
                    ┌────▼──────────────────┐
                    │      COMPLETED         │  Terminal state
                    └───────────────────────┘
```

### Exception Transitions

From any non-terminal state:
- `verifySignature() → FAILED` → locks all downstream steps, status remains `INSTRUCTION_RECEIVED` with `SIGNATURE_FAILED` audit event.
- `confirmCustomer() → FAILED/UNREACHABLE` → status moves to `CUSTOMER_CONFIRMED` exception sub-state; Step 4 locked.
- Any approver issues `RETURN` decision → status → `RETURNED`; transaction goes back to maker for correction.
- Any approver issues `REJECT` decision → status → `REJECTED`; terminal.
- `CANCELLED` — admin cancellation; terminal.
- `FAILED` — system/execution failure; operational review required.

### Status-to-Owner Mapping

| Status | Action Owner |
|---|---|
| `INSTRUCTION_RECEIVED` | TREASURY_OFFICER (signature verification) |
| `SIGNATURE_VERIFIED` | ACCOUNT_OFFICER (customer confirmation) |
| `CUSTOMER_CONFIRMED` | TREASURY_OFFICER (investment verification) |
| `INVESTMENT_VERIFIED` | TREASURY_OFFICER (voucher preparation) |
| `VOUCHER_PREPARED` | TREASURY_OFFICER (Treasury approval) |
| `TREASURY_APPROVED` | HEAD_TREASURY |
| `HEAD_TREASURY_APPROVED` | MIS |
| `MIS_APPROVED` | AUDIT |
| `AUDIT_APPROVED` | MD |
| `MD_APPROVED` | OPERATIONS |
| `OPERATIONS_COMPLETED` | TREASURY_OFFICER (completion confirmation) |

---

## Components and Interfaces

### Application Module Structure

```
app/
├── (auth)/
│   ├── auth/login/page.tsx
│   └── auth/sign-up/page.tsx
├── (protected)/
│   ├── layout.tsx                    ← server: loads profile + role, protects routes
│   ├── dashboard/page.tsx            ← server component with realtime client wrapper
│   ├── transactions/
│   │   ├── page.tsx                  ← transaction list with filters
│   │   ├── new/page.tsx              ← transaction creation form
│   │   └── [id]/
│   │       ├── page.tsx              ← transaction workspace (server)
│   │       └── _components/
│   │           ├── WorkspaceHeader.tsx
│   │           ├── StepProgressTracker.tsx
│   │           ├── Step1Instruction.tsx
│   │           ├── Step2SignatureVerification.tsx
│   │           ├── Step3CustomerConfirmation.tsx
│   │           ├── Step4InvestmentVerification.tsx
│   │           ├── Step5VoucherGeneration.tsx
│   │           ├── Step6ApprovalChain.tsx
│   │           ├── WorkspaceSidebar.tsx
│   │           └── AuditTimeline.tsx
│   ├── approvals/
│   │   ├── page.tsx                  ← approval queue (role-filtered)
│   │   └── [id]/page.tsx             ← approval detail panel
│   ├── operations/
│   │   ├── page.tsx                  ← operations execution queue
│   │   └── [id]/page.tsx             ← execution form
│   ├── customers/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── investments/
│   │   └── page.tsx
│   ├── audit/page.tsx
│   ├── vouchers/page.tsx
│   └── admin/
│       ├── page.tsx                  ← user management
│       └── sla-config/page.tsx       ← SLA duration settings

components/
├── ui/                               ← shadcn/ui components
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── alert.tsx
│   ├── toast.tsx  (Sonner)
│   ├── form.tsx
│   ├── badge.tsx
│   └── ...
├── treasury/
│   ├── TransactionStatusBadge.tsx
│   ├── SlaIndicator.tsx
│   ├── VoucherDisplay.tsx
│   ├── PaymentInstructionBlock.tsx
│   ├── CalculationSnapshotDisplay.tsx
│   ├── ApprovalChainPanel.tsx
│   └── AuditTimeline.tsx

lib/
├── supabase/
│   ├── client.ts                     ← browser client
│   ├── server.ts                     ← server client
│   └── proxy.ts                      ← middleware session refresh
├── services/
│   ├── auth.service.ts               ← resolveUserRole(), getProfile()
│   ├── transaction.service.ts        ← createTransaction(), getTransaction()
│   ├── workflow.service.ts           ← step transitions, state validation
│   ├── calculation.service.ts        ← all financial calculation functions
│   ├── voucher.service.ts            ← voucher type resolution, generation
│   ├── approval.service.ts           ← approval chain logic
│   ├── audit.service.ts              ← writeAuditEvent()
│   ├── notification.service.ts       ← createNotification(), markRead()
│   └── eazybankz/
│       ├── adapter.interface.ts      ← EazybankzAdapter interface
│       ├── mock.adapter.ts           ← mock implementation
│       └── index.ts                  ← exports current implementation
├── actions/
│   ├── transaction.actions.ts        ← createTransactionAction()
│   ├── verification.actions.ts       ← verifySignatureAction(), etc.
│   ├── approval.actions.ts           ← approveTransactionAction()
│   ├── operations.actions.ts         ← executeTransactionAction()
│   └── document.actions.ts           ← uploadDocumentAction()
├── schemas/
│   ├── transaction.schema.ts         ← Zod schemas for forms
│   ├── verification.schema.ts
│   ├── approval.schema.ts
│   └── voucher.schema.ts
└── utils.ts

supabase/
├── migrations/
│   ├── 001_schema.sql                ← all 18 tables
│   ├── 002_rls.sql                   ← all RLS policies
│   ├── 003_rpc.sql                   ← all PostgreSQL RPC functions
│   ├── 004_triggers.sql              ← profile creation trigger, etc.
│   └── 005_roles_seed.sql            ← seed roles table
└── seed.sql                          ← test users, customers A–R, scenarios
```

---

## Server Actions and RPC Function Signatures

### Server Actions (`lib/actions/`)

All Server Actions follow this pattern:
1. Validate inputs with Zod.
2. Get authenticated user from `supabase.auth.getUser()`.
3. Resolve role from database (never from request body).
4. Call PostgreSQL RPC.
5. Return `{ success: boolean, data?: T, error?: string }`.
6. Call `revalidatePath()` on success.

```typescript
// transaction.actions.ts
export async function createTransactionAction(
  input: CreateTransactionInput // validated by Zod
): Promise<ActionResult<{ transactionId: string; reference: string }>>

export async function getTransactionWorkspaceAction(
  transactionId: string
): Promise<ActionResult<TransactionWorkspace>>

// verification.actions.ts
export async function verifySignatureAction(
  transactionId: string,
  input: SignatureVerificationInput
): Promise<ActionResult<{ newStatus: string }>>

export async function recordCustomerConfirmationAction(
  transactionId: string,
  input: CustomerConfirmationInput
): Promise<ActionResult<{ newStatus: string }>>

export async function verifyInvestmentAction(
  transactionId: string,
  input: InvestmentVerificationInput
): Promise<ActionResult<{ newStatus: string; snapshot: InvestmentSnapshot }>>

// voucher.actions.ts
export async function prepareVoucherAction(
  transactionId: string,
  input: VoucherPreparationInput
): Promise<ActionResult<{ voucherId: string; voucherNumber: string }>>

// approval.actions.ts
export async function approveTransactionAction(
  transactionId: string,
  stage: ApprovalStage,
  decision: ApprovalDecision,
  comments?: string
): Promise<ActionResult<{ newStatus: string }>>

// operations.actions.ts
export async function executeTransactionAction(
  transactionId: string,
  input: ExecutionInput
): Promise<ActionResult<{ executionId: string }>>

export async function confirmTreasuryCompletionAction(
  transactionId: string
): Promise<ActionResult<{ newStatus: string }>>

// document.actions.ts
export async function uploadDocumentAction(
  transactionId: string,
  file: File,
  documentType: DocumentType
): Promise<ActionResult<{ documentId: string; signedUrl: string }>>
```

### PostgreSQL RPC Functions

Critical mutations are implemented as `SECURITY DEFINER` PostgreSQL functions. Each function validates actor, state, and prerequisites before performing atomic changes.

```sql
-- Core workflow RPCs
CREATE OR REPLACE FUNCTION create_treasury_transaction(
  p_customer_id        UUID,
  p_investment_id      UUID,
  p_transaction_type   TEXT,
  p_scenario_code      TEXT,
  p_requested_amount   NUMERIC,
  p_purpose            TEXT,
  p_source_type        TEXT,
  p_payment_instruction JSONB DEFAULT NULL
) RETURNS JSONB;
-- Returns: { transaction_id, transaction_reference, status }

CREATE OR REPLACE FUNCTION verify_signature(
  p_transaction_id         UUID,
  p_signature_result       TEXT,
  p_mandate_result         TEXT,
  p_account_ownership_result TEXT,
  p_completeness_result    TEXT,
  p_notes                  TEXT DEFAULT NULL
) RETURNS JSONB;
-- Returns: { new_status, audit_event_id }

CREATE OR REPLACE FUNCTION record_customer_confirmation(
  p_transaction_id       UUID,
  p_confirmation_status  TEXT,
  p_confirmed_amount     NUMERIC,
  p_confirmed_beneficiary TEXT DEFAULT NULL,
  p_confirmed_purpose    TEXT,
  p_confirmation_date    DATE,
  p_confirmation_time    TIME,
  p_notes                TEXT DEFAULT NULL
) RETURNS JSONB;

CREATE OR REPLACE FUNCTION verify_investment(
  p_transaction_id       UUID,
  p_principal            NUMERIC,
  p_accrued_interest     NUMERIC,
  p_interest_rate        NUMERIC,
  p_effective_date       DATE,
  p_maturity_date        DATE,
  p_outstanding_balance  NUMERIC,
  p_available_amount     NUMERIC
) RETURNS JSONB;

CREATE OR REPLACE FUNCTION prepare_voucher(
  p_transaction_id         UUID,
  p_voucher_data           JSONB,  -- type-specific fields
  p_payment_instruction    JSONB DEFAULT NULL
) RETURNS JSONB;
-- Server resolves voucher_type from transaction_type; frontend cannot override

CREATE OR REPLACE FUNCTION approve_transaction(
  p_transaction_id  UUID,
  p_stage           TEXT,
  p_decision        TEXT,
  p_comments        TEXT DEFAULT NULL
) RETURNS JSONB;
-- Validates: actor role = stage role, prior stage complete, not maker, idempotent
-- Returns: { new_status, approval_id }

CREATE OR REPLACE FUNCTION execute_transaction(
  p_transaction_id     UUID,
  p_execution_status   TEXT,
  p_external_reference TEXT DEFAULT NULL,
  p_execution_notes    TEXT DEFAULT NULL
) RETURNS JSONB;

CREATE OR REPLACE FUNCTION confirm_treasury_completion(
  p_transaction_id  UUID
) RETURNS JSONB;

CREATE OR REPLACE FUNCTION create_reversal(
  p_original_transaction_id  UUID,
  p_reversal_reason          TEXT
) RETURNS JSONB;
-- Creates new REVERSAL transaction referencing original; original NOT modified
```

Each RPC function body follows this template:

```sql
DECLARE
  v_actor_id    UUID := auth.uid();
  v_actor_role  TEXT;
  v_tx          treasury_transactions%ROWTYPE;
BEGIN
  -- 1. Resolve actor role
  SELECT r.code INTO v_actor_role FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = v_actor_id;
  IF v_actor_role IS NULL THEN
    INSERT INTO audit_events(actor_id, event_type, metadata)
      VALUES(v_actor_id, 'UNAUTHORIZED_ATTEMPT', '{}');
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  -- 2. Load transaction with row lock
  SELECT * INTO v_tx FROM treasury_transactions
    WHERE id = p_transaction_id FOR UPDATE;

  -- 3. Validate state and role
  -- ... (function-specific checks)

  -- 4. Perform mutation + audit event in same transaction
  -- ... (INSERT/UPDATE + INSERT INTO audit_events)

  RETURN jsonb_build_object('success', true, ...);
END;
```

---

## Eazybankz Adapter Interface

### Interface Definition (`lib/services/eazybankz/adapter.interface.ts`)

```typescript
export interface EazybankzInvestment {
  id: string;
  customerId: string;
  productType: 'FIXED_DEPOSIT' | 'CALL' | 'COMMERCIAL_PAPER' | 'CMS';
  principal: string;           // string to preserve numeric precision
  interestRate: string;
  accruedInterest: string;
  effectiveDate: string;       // ISO date
  maturityDate: string;        // ISO date
  outstandingBalance: string;
  availableAmount: string;
  status: 'ACTIVE' | 'TERMINATED' | 'ROLLED_OVER' | 'MATURED';
  externalReference: string;
}

export interface EazybankzBalance {
  accountId: string;
  availableBalance: string;
  ledgerBalance: string;
  currency: string;
}

export interface CreateInvestmentData {
  customerId: string;
  productType: string;
  principal: string;
  interestRate: string;
  tenorDays: number;
  effectiveDate: string;
  sourceTransactionId: string;
}

export interface EazybankzAdapter {
  getInvestment(investmentId: string): Promise<EazybankzInvestment>;
  getBalance(accountId: string): Promise<EazybankzBalance>;
  getAccruedInterest(investmentId: string): Promise<string>;
  createInvestment(data: CreateInvestmentData): Promise<EazybankzInvestment>;
  updateInvestment(investmentId: string, data: Partial<CreateInvestmentData>): Promise<EazybankzInvestment>;
  createTransaction(data: CreateTransactionData): Promise<{ transactionId: string }>;
  reverseTransaction(transactionId: string, reason: string): Promise<{ reversalId: string }>;
}
```

### Mock Adapter (`lib/services/eazybankz/mock.adapter.ts`)

The mock adapter returns seeded data keyed by customer scenario. Data is seeded for Customers A through R from `supabase/seed.sql`. The mock returns all monetary values as strings to preserve exact numeric precision through the TypeScript layer.

```typescript
export class MockEazybankzAdapter implements EazybankzAdapter {
  // Returns data from in-memory seed store, or throws EazybankzError
  // All methods are async to match the real adapter interface
  // Error simulation: investmentId='FAIL_*' triggers error path
}
```

The adapter is exported from `lib/services/eazybankz/index.ts`:

```typescript
export const eazybankzAdapter: EazybankzAdapter =
  process.env.EAZYBANKZ_MODE === 'real'
    ? new RealEazybankzAdapter()
    : new MockEazybankzAdapter();
```

Adapter calls are made **only** from Server Actions or service layer functions. No component or page may call the adapter directly.

---

## Calculation Engine

### Function Signatures (`lib/services/calculation.service.ts`)

All functions accept `NUMERIC`-compatible string inputs and return a `CalculationSnapshot`. No JavaScript floating-point arithmetic is used; all precision-sensitive math delegates to the server-side PostgreSQL RPC.

```typescript
export interface CalculationSnapshot {
  rule: CalculationRule;
  inputs: Record<string, string>;   // numeric strings
  outputs: Record<string, string>;  // numeric strings
  calculated_at: string;            // ISO timestamp
}

export type CalculationRule =
  | 'PRE_LIQUIDATION_20_PERCENT'
  | 'THIRD_PARTY_TRANSFER_0_10_PERCENT'
  | 'ROLLOVER_P_AND_I'
  | 'ROLLOVER_PRINCIPAL_ONLY'
  | 'ROLLOVER_PARTIAL_PRINCIPAL'
  | 'ROLLOVER_INTEREST_ONLY'
  | 'MATURITY_TERMINATION'
  | 'ANNIVERSARY_PAYMENT';

// Called server-side only. Delegates to PostgreSQL RPC for authoritative result.
export async function calculatePreLiquidation(
  accruedInterest: string,           // NUMERIC string from investment_verifications snapshot
  requestedPayout?: string           // partial pre-liquidation only
): Promise<CalculationSnapshot & {
  charge: string;
  netInterest: string;
  remainingPrincipal?: string;
  rebookedPrincipal?: string;
}>;

export async function calculateRollover(
  type: 'P_AND_I' | 'PRINCIPAL_ONLY' | 'PARTIAL_PRINCIPAL' | 'INTEREST_ONLY',
  principal: string,
  interestDue: string,
  requestedPayout?: string           // PARTIAL_PRINCIPAL only
): Promise<CalculationSnapshot & {
  rolloverAmount: string;
  interestPaid?: string;
  principalRolled?: string;
}>;

export async function calculateThirdPartyCharge(
  transferAmount: string,
  isInternal: boolean
): Promise<CalculationSnapshot & {
  transferCharge: string;             // 0 if internal
  netAmount: string;
}>;

export async function calculateAnniversaryPayment(
  principal: string,
  interestRate: string,
  frequencyDays: 30 | 60 | 90
): Promise<CalculationSnapshot & {
  interestDue: string;
}>;

export async function calculateMaturityTermination(
  principal: string,
  accruedInterest: string
): Promise<CalculationSnapshot & {
  netAmount: string;                  // WHT defaulted to 0 per SOP
}>;
```

### Calculation Snapshot Format

```json
{
  "rule": "PRE_LIQUIDATION_20_PERCENT",
  "inputs": {
    "accrued_interest": "1500000.0000",
    "charge_rate": "0.200000"
  },
  "outputs": {
    "charge": "300000.0000",
    "net_interest": "1200000.0000"
  },
  "calculated_at": "2026-09-03T09:38:00.000Z"
}
```

The snapshot is stored in `vouchers.calculation_snapshot` (JSONB). It is immutable once the voucher is finalised — no UPDATE is permitted after `status = 'FINALISED'`.

---

## Route Structure and Page Components

### Route Map

```
/                          → redirect to /dashboard (if session) or /auth/login
/auth/login                → LoginPage (public)
/auth/sign-up              → SignUpPage (public)
/auth/callback             → OAuth callback handler

/dashboard                 → DashboardPage (protected, all roles)
/transactions              → TransactionListPage (TREASURY_OFFICER+)
/transactions/new          → NewTransactionPage (TREASURY_OFFICER)
/transactions/[id]         → TransactionWorkspacePage (role-aware)
/approvals                 → ApprovalQueuePage (TREASURY_OFFICER through MD)
/approvals/[id]            → redirects to /transactions/[id]#approval
/operations                → OperationsQueuePage (OPERATIONS)
/operations/[id]           → redirects to /transactions/[id]#operations
/customers                 → CustomerListPage (TREASURY_OFFICER+)
/customers/[id]            → CustomerDetailPage
/investments               → InvestmentListPage (TREASURY_OFFICER+)
/audit                     → AuditLogPage (AUDIT, ADMIN)
/vouchers                  → VoucherListPage (TREASURY_OFFICER+)
/admin                     → AdminPage (ADMIN)
/admin/sla-config          → SlaConfigPage (ADMIN)
```

### Page Component Responsibilities

**`DashboardPage` (server component)**:
- Fetches live counts (pending, in-progress, completed, exceptions) scoped to current user's role.
- Renders `<DashboardMetrics />` and `<RecentInstructionsTable />`.
- Mounts `<RealtimeSubscriber />` (client component) for live status updates.

**`TransactionWorkspacePage` (`/transactions/[id]`, server component)**:
- Loads full transaction record including all step data (signature verification, confirmation, investment snapshot, voucher, approvals, audit events, documents).
- Passes hydrated data to client components — no client-side data fetching.
- Renders `<StepProgressTracker />`, step sections (1–6), `<WorkspaceSidebar />`, `<AuditTimeline />`.

**`ApprovalQueuePage` (server component)**:
- Filters transactions by status matching the current user's approval stage.
- Renders `<ApprovalQueueTable />`.

**`OperationsQueuePage` (server component)**:
- Loads transactions in `MD_APPROVED` status for `OPERATIONS` role.

---

## Key UI Component Patterns

### Transaction Workspace Layout

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER: TRX-02481  Nia Okafor  Full Rollover  ₦12,450,000   │
│         Status: AWAITING HEAD TREASURY  ●  SLA: 4h 22m left  │
├───────────────────────────────────────┬──────────────────────┤
│ STEP PROGRESS                         │   SIDEBAR            │
│  ✓ 1 Instruction                      │   Current Owner:     │
│  ✓ 2 Signature                        │   Head Treasury      │
│  ✓ 3 Confirmation                     │                      │
│  ✓ 4 Investment                       │   SLA Due:           │
│  ✓ 5 Voucher                          │   ●  4h 22m left     │
│  ● 6 Approval: Head Treasury          │                      │
│  🔒 Operations                        │   Documents (2):     │
│  🔒 Completion                        │   📄 instruction.pdf │
│                                       │   📄 mandate.pdf     │
├───────────────────────────────────────┘                      │
│ ACTIVE SECTION (Step 6 / Approval)                           │
│   [Full approval panel here]                                 │
│                                                              │
│ READ-ONLY SECTIONS (completed steps, collapsed)              │
│   Step 5 — Voucher  ▼                                        │
│   Step 4 — Investment Snapshot  ▼                            │
│   Step 3 — Customer Confirmation  ▼                          │
│   ...                                                        │
├──────────────────────────────────────────────────────────────┤
│ AUDIT TIMELINE (read-only)                                   │
│  09:15  TRANSACTION_CREATED   Treasury Officer               │
│  09:21  SIGNATURE_VERIFIED    Treasury Officer               │
│  09:32  CUSTOMER_CONFIRMED    Account Officer 01             │
│  09:38  INVESTMENT_VERIFIED   Treasury Officer               │
│  09:44  VOUCHER_CREATED       Treasury Officer               │
│  10:01  APPROVAL_GRANTED      Treasury Officer (TREASURY)    │
└──────────────────────────────────────────────────────────────┘
```

### Step Progress Tracker (`StepProgressTracker`)

Visual states: `completed` (✓ green), `active` (● primary), `locked` (🔒 muted).
Locked steps show tooltip explaining prerequisite when hovered.

```tsx
// Animation: steps use stagger (40ms delay per step) on mount
// scale(0.95) opacity(0) → scale(1) opacity(1), ease-out 200ms
// prefers-reduced-motion: skip transform, keep opacity fade
```

### Approval Panel (`ApprovalChainPanel`)

Displayed within Step 6 of the transaction workspace. Shows:
- Completed approval stages as read-only rows (actor, decision, timestamp, comments).
- Current pending stage with Approve / Return / Reject buttons — visible only if `currentUser.role === requiredStage.role`.
- Return/Reject triggers a shadcn `Dialog` requiring a non-empty comments field before confirmation.

```
 Stage          Actor               Decision    Timestamp
 ─────────────────────────────────────────────────────────
 ✓ Treasury    Treasury Officer    APPROVED    10:01
 ● Head Treasury  [Your turn]
   [Approve ▶]  [Return ↩]  [Reject ✕]
 🔒 MIS
 🔒 Audit
 🔒 MD
```

### Audit Timeline (`AuditTimeline`)

Chronological, read-only event list. Each event row:
- Timestamp (relative + absolute on hover tooltip).
- Event type as a pill badge.
- Actor name.
- From status → To status arrow.
- Expandable metadata section (collapsed by default).

Entry animation: stagger 30ms, `translateY(6px) opacity(0)` → `translateY(0) opacity(1)`, 180ms ease-out.

### Voucher Display (`VoucherDisplay`)

Renders the correct voucher layout based on `voucher_type`:

**FUNDS_OUT** (standard):
```
Voucher No: FO-2481
─────────────────────────────────
Principal              ₦12,450,000
Interest                  ₦245,000
WHT                            ₦0
Charge                         ₦0
Net Amount             ₦12,695,000
Transfer Date            2026-09-03

PAYMENT INSTRUCTION
─────────────────────────────────
Beneficiary Name:  Nia Okafor
Bank Name:         First Bank PLC
Account Number:    0123456789
Account Type:      SAVINGS
Amount:            ₦12,695,000
Transfer Charge:             ₦0
```

**SAVINGS/CALL/CMS FUNDS_OUT** (per Req 38):
```
Available Balance:     ₦12,450,000
Transfer Date:           2026-09-03
Remarks:               ...
[PAYMENT INSTRUCTION — same block]
```

**ROLLOVER_SLIP**:
```
Principal Amount:     ₦12,450,000
Interest Due:            ₦245,000
Effective Date:        2026-09-03
New Tenor:               90 days
New Rate:                   12.5%
Rollover Amount:      ₦12,695,000
Rollover Maturity:     2026-12-02
[PAYMENT INSTRUCTION — if interest paid out]
```

### SLA Indicator (`SlaIndicator`)

Three colour states:
- Green (>2 hours): `●  4h 22m remaining`
- Amber (≤2 hours): `⚠  1h 45m remaining`
- Red (breached): `✕  Overdue by 2h 11m`

Status is computed server-side by comparing `sla_due_at` against `NOW()`.

---

## Supabase RLS Policy Design

### Policy Principles

1. All tables have RLS enabled.
2. The `authenticated` role can read/write only what their specific role permits.
3. The `anon` role has no access to any financial table.
4. Direct writes to `status`, `approved_amount`, `audit_events` are denied — mutations go through RPC functions only.
5. A helper function `get_user_role()` is used in all policies:

```sql
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT r.code FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

### Per-Table Policies

**`profiles`**
- SELECT: own row only (`id = auth.uid()`), or ADMIN can read all.
- UPDATE: own row only.
- INSERT/DELETE: via trigger only.

**`roles`**
- SELECT: any authenticated user.
- INSERT/UPDATE/DELETE: ADMIN only.

**`user_roles`**
- SELECT: own rows; ADMIN reads all.
- INSERT/DELETE: ADMIN only.

**`customers`**
- SELECT: TREASURY_OFFICER, HEAD_TREASURY, MIS, AUDIT, MD, OPERATIONS, ACCOUNT_OFFICER, ADMIN.
- INSERT/UPDATE: TREASURY_OFFICER, ADMIN.
- DELETE: ADMIN only.

**`customer_accounts`, `investments`**
- SELECT: same roles as `customers`.
- INSERT/UPDATE: TREASURY_OFFICER, OPERATIONS, ADMIN.

**`treasury_transactions`**
```sql
-- SELECT: role-based scoping
-- TREASURY_OFFICER, HEAD_TREASURY, MIS, AUDIT, MD, ADMIN: all rows
-- ACCOUNT_OFFICER: rows where a customer_confirmations row has confirmed_by = auth.uid()
-- OPERATIONS: rows where status IN ('MD_APPROVED', 'OPERATIONS_PROCESSING', 'OPERATIONS_COMPLETED')
CREATE POLICY "transactions_select" ON treasury_transactions
  FOR SELECT USING (
    get_user_role() IN ('TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN')
    OR (get_user_role() = 'ACCOUNT_OFFICER' AND EXISTS (
      SELECT 1 FROM customer_confirmations WHERE transaction_id = id AND confirmed_by = auth.uid()
    ))
    OR (get_user_role() = 'OPERATIONS' AND status IN ('MD_APPROVED','OPERATIONS_PROCESSING','OPERATIONS_COMPLETED','TREASURY_CONFIRMED','COMPLETED'))
  );
-- INSERT: TREASURY_OFFICER, ADMIN only (via RPC)
-- UPDATE/DELETE: DENIED for all application roles — mutations via RPC only
```

**`signature_verifications`, `customer_confirmations`, `investment_verifications`**
- SELECT: TREASURY_OFFICER, HEAD_TREASURY, MIS, AUDIT, MD, ADMIN; ACCOUNT_OFFICER for their own confirmations.
- INSERT: via RPC only (no direct INSERT policies for `authenticated`).
- UPDATE/DELETE: DENIED.

**`vouchers`**
- SELECT: TREASURY_OFFICER, HEAD_TREASURY, MIS, AUDIT, MD, OPERATIONS, ADMIN.
- INSERT: via RPC only.
- UPDATE: DENIED once `status = 'FINALISED'`.

**`approvals`**
- SELECT: any user who can view the transaction.
- INSERT: via RPC `approve_transaction()` only (RPC validates role and stage).
- Direct INSERT/UPDATE/DELETE from `authenticated` role: DENIED.

**`operations_executions`**
- SELECT: OPERATIONS, TREASURY_OFFICER, ADMIN.
- INSERT: via RPC `execute_transaction()` only.

**`audit_events`**
- SELECT: AUDIT, ADMIN can read all. TREASURY_OFFICER, HEAD_TREASURY, MIS, MD, OPERATIONS can read events for transactions they have access to.
- INSERT: via RPC functions only.
- **UPDATE: DENIED for ALL roles including ADMIN.**
- **DELETE: DENIED for ALL roles including ADMIN.**

```sql
REVOKE UPDATE, DELETE ON audit_events FROM authenticated;
REVOKE UPDATE, DELETE ON audit_events FROM anon;
```

**`transaction_documents`**
- SELECT: users whose role has an active relationship to the transaction.
- INSERT: via `uploadDocumentAction()` server action (role check in action).

**`payment_instructions`**
- SELECT: TREASURY_OFFICER, HEAD_TREASURY, MIS, AUDIT, MD, OPERATIONS, ADMIN.
- INSERT/UPDATE: via RPC only.

---

## Authentication and Session Flow

### Sign-In Flow

```
1. User submits email/password on /auth/login
2. Client calls signIn() → supabase.auth.signInWithPassword()
3. On success: Supabase sets HttpOnly session cookie (SameSite=Strict, Secure in prod)
4. Client redirects to /dashboard
5. Middleware calls updateSession() which calls supabase.auth.getUser() on every request
6. Protected layout server component loads profile + role from DB
7. Role is passed to child server components via props (never via localStorage)
```

### Session Expiry

```
1. Middleware detects no valid session from supabase.auth.getUser()
2. Middleware redirects to /auth/login
3. No protected page content is returned
4. Login page shows no indication of where the user was
```

### Sign-Up Flow

```
1. User submits email, password, full_name, requested_role on /auth/sign-up
2. Client calls signUp() → supabase.auth.signUp() with metadata
3. Supabase triggers email verification (or auto-confirms in dev)
4. Database trigger on auth.users INSERT creates profiles row
5. Admin must manually assign role via admin panel (requested_role is metadata only)
6. Until role is assigned, user sees a "pending activation" screen
```

### Route Protection in Middleware

```typescript
// middleware.ts — enhanced version
export async function middleware(request: NextRequest) {
  const supabase = createServerClient(...)
  const { data: { user }, error } = await supabase.auth.getUser()

  const isProtectedRoute = !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/_next') &&
    request.nextUrl.pathname !== '/'

  if (isProtectedRoute && (!user || error)) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return updateSession(request)
}
```

Role-sensitive page access is enforced in layout server components (not middleware) to avoid loading roles on every middleware invocation:

```typescript
// app/(protected)/layout.tsx
const user = await getAuthenticatedUser()  // server-side
const role = await resolveUserRole(user.id) // DB query
if (!role) redirect('/auth/login')
// Pass role to children via props or React Context (server-side value only)
```

---

## Notification System Design

### Data Model

A lightweight `notifications` table (not in the 18 core tables, add as table 19):

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `recipient_id` | `UUID` | FK → `profiles.id` |
| `transaction_id` | `UUID` | FK → `treasury_transactions.id` |
| `event_type` | `TEXT` | NOT NULL |
| `message` | `TEXT` | NOT NULL |
| `is_read` | `BOOLEAN` | DEFAULT `false` |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` |

**Index**: `(recipient_id, is_read, created_at DESC)`.

### Notification Triggers

Notifications are created by PostgreSQL trigger after audit events, fanning out to all users with the required next-action role:

```sql
-- Example: after APPROVAL_GRANTED at TREASURY stage,
-- create notifications for all HEAD_TREASURY users
CREATE OR REPLACE FUNCTION notify_next_role() RETURNS TRIGGER AS $$
DECLARE
  v_next_role TEXT;
BEGIN
  v_next_role := get_next_action_role(NEW.to_status);
  IF v_next_role IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, transaction_id, event_type, message)
    SELECT ur.user_id, NEW.transaction_id, NEW.event_type,
      format('Transaction %s requires your attention', t.transaction_reference)
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    JOIN treasury_transactions t ON t.id = NEW.transaction_id
    WHERE r.code = v_next_role;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### UI Integration

- Bell icon in nav header shows unread count via Supabase Realtime subscription.
- Clicking a notification navigates to `/transactions/[id]` and marks it read.
- Badge uses shadcn `Badge` with a red dot indicator.

---

## Document Storage Structure

### Bucket Configuration

```
Bucket: transaction-documents (PRIVATE — no public access)
  Path pattern: {transaction_id}/{document_type}/{timestamp}_{filename}

  Example:
    550e8400-e29b-41d4-a716-446655440000/
      INSTRUCTION/
        20260903T091500_customer_instruction.pdf
      MANDATE/
        20260903T091500_mandate_card.jpg
      EVIDENCE/
        20260903T093200_signed_form.pdf
```

### Storage Policies

```sql
-- Allow read only if user has access to the transaction
CREATE POLICY "document_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'transaction-documents'
    AND EXISTS (
      SELECT 1 FROM transaction_documents td
      JOIN treasury_transactions t ON t.id = td.transaction_id
      WHERE td.storage_path = name
      AND (
        get_user_role() IN ('TREASURY_OFFICER','HEAD_TREASURY','MIS','AUDIT','MD','ADMIN')
        OR (get_user_role() = 'OPERATIONS' AND t.status IN ('MD_APPROVED','OPERATIONS_PROCESSING','OPERATIONS_COMPLETED'))
      )
    )
  );

-- Upload: TREASURY_OFFICER, ACCOUNT_OFFICER, ADMIN
CREATE POLICY "document_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'transaction-documents'
    AND get_user_role() IN ('TREASURY_OFFICER','ACCOUNT_OFFICER','ADMIN')
  );
```

Document access uses short-lived signed URLs (60-minute expiry):
```typescript
const { data } = await supabase.storage
  .from('transaction-documents')
  .createSignedUrl(storagePath, 3600)
```

---

## Seed Data Structure

### Staff Users (7 scenario + 7 e2e = 14 users)

```sql
-- Scenario users
INSERT INTO auth.users (email, ...) VALUES
  ('treasury_maker_01@greenline.test', ...),
  ('account_officer_01@greenline.test', ...),
  ('head_treasury_01@greenline.test', ...),
  ('mis_officer_01@greenline.test', ...),
  ('audit_officer_01@greenline.test', ...),
  ('md_01@greenline.test', ...),
  ('operations_officer_01@greenline.test', ...);

-- E2E users
INSERT INTO auth.users (email, ...) VALUES
  ('treasury_maker_e2e@greenline.test', ...),
  ('account_officer_e2e@greenline.test', ...),
  ... (same pattern for all 7 roles)
```

### Test Customers A–R

Each customer has pre-seeded records in `customers`, `customer_accounts`, and `investments` with specific financial values:

| Customer | Scenario | Principal | Accrued Interest | Rate |
|---|---|---|---|---|
| A | Full Rollover (P+I) | ₦12,450,000 | ₦245,000 | 12.5% |
| B | Principal Rollover + Interest Payout | ₦8,000,000 | ₦160,000 | 12.0% |
| C | Partial Rollover | ₦10,000,000 | ₦0 | 12.5% |
| D | Interest Only Rollover | ₦5,000,000 | ₦100,000 | 12.0% |
| E | Maturity Termination | ₦25,000,000 | ₦1,250,000 | 12.5% |
| F | Full Pre-liquidation | ₦15,000,000 | ₦1,500,000 | 12.5% |
| G | Partial Pre-liquidation | ₦10,000,000 | ₦1,500,000 | 12.5% |
| H | Anniversary 30 Days | ₦6,000,000 | ₦60,000 | 12.0% |
| I | Anniversary 60 Days | ₦6,000,000 | ₦120,000 | 12.0% |
| J | Anniversary 90 Days | ₦6,000,000 | ₦180,000 | 12.0% |
| K | External Third Party Payment | ₦10,000,000 | ₦0 | 0% |
| L | Internal Third Party Payment | ₦10,000,000 | ₦0 | 0% |
| M | Savings → Personal Transfer | ₦0 | ₦0 | 0% (Savings balance: ₦5,000,000) |
| N | Personal → Commercial Paper | ₦0 | ₦0 | 0% (Personal balance: ₦8,000,000) |
| O | Personal → Call Placement | ₦0 | ₦0 | 0% (Personal balance: ₦3,000,000) |
| P | Reversal | ₦7,000,000 | ₦140,000 | 13.5% (incorrect rate for reversal) |
| Q | Inflow | ₦0 | ₦0 | 0% (new placement) |
| R | Savings/Call/CMS Funds-Out | ₦0 | ₦0 | 0% (balance from Eazybankz) |

### Negative Test Customers

```sql
-- CUSTOMER_NEG_001: signature mismatch scenario
-- CUSTOMER_NEG_002: insufficient available balance
-- CUSTOMER_NEG_003: incomplete instruction (missing beneficiary)
-- CUSTOMER_NEG_004: customer confirmation failed
-- CUSTOMER_NEG_005: missing beneficiary data
```

### Seed Script Reset Function (for E2E)

```sql
CREATE OR REPLACE FUNCTION reset_e2e_transactions()
RETURNS VOID AS $$
BEGIN
  -- Delete transactions created by e2e users, cascading to child tables
  DELETE FROM treasury_transactions
  WHERE created_by IN (
    SELECT p.id FROM profiles p WHERE p.email LIKE '%_e2e@greenline.test'
  );
END;
$$ LANGUAGE plpgsql;
```

The seed script is idempotent — uses `ON CONFLICT DO NOTHING` or `INSERT ... WHERE NOT EXISTS` for all records.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*
