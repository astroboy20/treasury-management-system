# System Architecture

## Stack

### Frontend

-   Next.js
-   TypeScript
-   App Router
-   Server Components where appropriate
-   Client Components for interactive workflow forms
-   React Hook Form
-   Zod
-   TanStack Query or a disciplined server-action/API approach

### Backend

-   Supabase
    -   PostgreSQL
    -   Supabase Auth
    -   Row Level Security
    -   Storage
    -   Database functions/RPC for critical transactional operations
    -   Realtime for operational status where useful

## Architecture principle

The database is the source of truth for workflow state.

The browser must never be trusted to:

-   approve a transaction;
-   bypass a workflow step;
-   calculate a critical financial amount without server validation;
-   change a completed transaction;
-   assign itself a higher role;
-   bypass RLS.

## Recommended application layers

``` text
Next.js UI
   ↓
Server Actions / Route Handlers
   ↓
Application Service Layer
   ↓
Supabase RPC / PostgreSQL functions
   ↓
PostgreSQL + RLS
   ↓
Audit/Event Log
```

External Eazybankz integration should sit behind an adapter/service
boundary:

``` text
Treasury Domain
      ↓
Eazybankz Adapter
      ↓
Eazybankz
```

This prevents the entire application from becoming coupled to one
external system.

## Main modules

1.  Authentication
2.  User and role management
3.  Customer management
4.  Accounts and investments
5.  Treasury transactions
6.  Transaction workflow
7.  Voucher management
8.  Approval management
9.  Payment instructions
10. Calculations
11. Operations execution
12. Treasury confirmation
13. Audit trail
14. Notifications
15. Dashboard/reporting
16. Eazybankz integration

## Transaction state machine

``` text
DRAFT
  ↓
INSTRUCTION_RECEIVED
  ↓
SIGNATURE_VERIFIED
  ↓
CUSTOMER_CONFIRMED
  ↓
INVESTMENT_VERIFIED
  ↓
VOUCHER_PREPARED
  ↓
TREASURY_APPROVED
  ↓
HEAD_TREASURY_APPROVED
  ↓
MIS_APPROVED
  ↓
AUDIT_APPROVED
  ↓
MD_APPROVED
  ↓
OPERATIONS_PROCESSING
  ↓
OPERATIONS_COMPLETED
  ↓
TREASURY_CONFIRMED
  ↓
COMPLETED
```

Any failed control should transition to a controlled exception state
rather than silently changing data.

## Financial integrity

Use PostgreSQL transactions for operations such as:

-   creating a transaction and its voucher;
-   approving a transaction and creating an immutable approval event;
-   creating linked rollover transactions;
-   creating a reversal;
-   recording Operations completion.

Critical values should use PostgreSQL `numeric`, not JavaScript
floating-point arithmetic.

Money should be stored in the transaction's currency and represented
using decimal values.

## Storage

Supabase Storage should hold supporting documents such as:

-   customer instructions;
-   signed forms;
-   relevant evidence;
-   generated voucher documents, if PDF generation is later added.

Storage paths should be scoped by transaction/customer identifiers and
protected by Storage policies.
