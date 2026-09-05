# Backend Security Specification

## Purpose

The backend is the primary security boundary for the Treasury application.

The SOP requires strict sequencing of controls and approvals. The backend must therefore enforce workflow state, role permissions, financial integrity, segregation of duties, and audit history independently of the frontend. fileciteturn1file1L226-L280

## 1. Authentication

Use Supabase Auth.

Every protected backend operation must identify the authenticated user.

Never trust:

- a user ID supplied by the browser;
- a role supplied by the browser;
- a transaction status supplied by the browser;
- an approval stage supplied by the browser.

Derive these from the authenticated session and database state.

## 2. Authorization

Implement RBAC using:

```text
profiles
roles
user_roles
```

Suggested roles:

```text
CUSTOMER
ACCOUNT_OFFICER
TREASURY_OFFICER
HEAD_TREASURY
MIS
AUDIT
MD
OPERATIONS
ADMIN
```

Permissions should be operation-based rather than simply page-based.

Example:

```text
TREASURY_OFFICER
  verify_signature
  record_investment_verification
  prepare_voucher
  approve_treasury

HEAD_TREASURY
  approve_head_treasury

MIS
  approve_mis

AUDIT
  approve_audit
  read_audit_history

MD
  approve_md

OPERATIONS
  execute_transaction
```

## 3. Supabase RLS

Enable Row Level Security on all sensitive tables.

At minimum:

```text
profiles
user_roles
customers
customer_accounts
investments
treasury_transactions
payment_instructions
signature_verifications
customer_confirmations
investment_verifications
vouchers
rollover_details
pre_liquidation_details
approvals
operations_executions
audit_events
transaction_documents
```

RLS must prevent unauthorized users from:

- reading data they are not permitted to access;
- changing another user's transaction;
- creating unauthorized approval records;
- modifying financial records;
- deleting audit events.

## 4. Workflow state enforcement

Never allow the frontend to directly set:

```text
status = 'COMPLETED'
```

Instead expose controlled backend operations:

```text
receiveInstruction()
verifySignature()
confirmCustomer()
verifyInvestment()
prepareVoucher()
approveTransaction()
executeTransaction()
confirmCompletion()
```

Each operation checks the current state.

Example:

```text
approveTransaction()
    ↓
authenticate actor
    ↓
load transaction from database
    ↓
load actor role
    ↓
determine required approval stage
    ↓
verify all previous approvals
    ↓
verify transaction is eligible
    ↓
record approval
    ↓
advance state
    ↓
write audit event
```

## 5. SOP control enforcement

The backend must enforce these controls before processing:

```text
Customer instruction received
Signature verified
Telephone confirmation completed
Investment confirmed in Eazybankz Mirror
Correct voucher raised
Treasury Officer approval
Head Treasury approval
MIS approval
Audit approval
MD approval
Operations processing confirmed
Transaction completion recorded
```

These controls are explicitly listed in the SOP. fileciteturn1file0L174-L188

## 6. Signature mismatch hard stop

If signature verification fails:

```text
signature_result = FAILED
```

the backend must refuse all downstream processing.

No voucher approval or Operations execution should be possible.

This directly implements the SOP instruction to stop processing when the signature differs. fileciteturn1file1L226-L234

## 7. Customer confirmation integrity

The confirmation record must contain:

- authenticated Account Officer;
- confirmation date;
- confirmation time;
- amount confirmed;
- instruction confirmed;
- beneficiary confirmed where applicable;
- purpose confirmed.

The backend should reject completion of the confirmation step when required values are missing. fileciteturn1file1L235-L245

## 8. Investment verification / Eazybankz Mirror

The Eazybankz component is a **mock/mirror system**, not a real external banking integration.

The backend should therefore treat it as a controlled internal simulation.

The mirror should expose only the operations required by the SOP:

```text
getInvestment()
getBalance()
getAccruedInterest()
createInvestment()
createTransaction()
updateInvestment()
reverseTransaction()
```

Investment verification should save a snapshot containing:

- principal;
- accrued interest;
- interest rate;
- effective date;
- maturity date;
- outstanding balance;
- available amount;
- mirror investment reference;
- verifier;
- verification timestamp.

The SOP specifically requires these investment fields to be confirmed. fileciteturn1file1L246-L256

## 9. Financial calculations

All authoritative financial calculations must run server-side.

Examples:

```text
calculatePreLiquidation()
calculateThirdPartyTransferCharge()
calculateRollover()
calculateMaturityAmount()
calculateAnniversaryInterest()
```

Use PostgreSQL `numeric` or an equivalent decimal-safe representation.

Never use JavaScript floating-point arithmetic as the final source of truth for money.

## 10. Voucher integrity

The backend determines the correct voucher.

Based on the SOP:

```text
INFLOW              → FUNDS_IN
MATURITY            → FUNDS_OUT
ANNIVERSARY         → FUNDS_OUT
PRE-LIQUIDATION     → FUNDS_OUT
THIRD PARTY         → FUNDS_OUT
ROLLOVER            → ROLL_OVER_SLIP
INTERNAL TRANSFER   → TRANSFER_SLIP
```

This mapping is stated in the SOP. fileciteturn1file1L257-L266

The browser cannot choose an arbitrary voucher type that conflicts with the transaction type.

## 11. Segregation of duties

The approval chain must remain:

```text
Treasury Officer
      ↓
Head Treasury
      ↓
MIS
      ↓
Audit
      ↓
MD
      ↓
Operations
```

The backend should reject approval when:

- user does not have the required role;
- stage is not the user's stage;
- previous approval is missing;
- transaction is already rejected/completed;
- user is not eligible under maker-checker rules.

The SOP defines this approval order. fileciteturn1file1L267-L280

## 12. Approval immutability

Once an approval decision is recorded:

- do not update it;
- do not delete it;
- do not silently replace it.

A correction should create another controlled event.

Use:

```text
decision
approver_id
stage
timestamp
comments
```

## 13. Operations security

Operations can execute only after all required approvals, including MD approval, are complete.

Execution must record:

```text
executed_by
execution_status
external/mirror_reference
executed_at
notes
```

Operations cannot modify the original approval records.

## 14. Treasury completion

Operations execution does not automatically mean the transaction is complete.

The SOP requires Treasury to follow up until completion and explicitly states Treasury confirms investment/payment completion in the relevant flows. fileciteturn1file1L278-L280 fileciteturn1file0L142-L144

Therefore:

```text
OPERATIONS_COMPLETED
       ↓
TREASURY_CONFIRMATION
       ↓
COMPLETED
```

## 15. Audit log

Every important state-changing operation creates an append-only audit event.

Minimum fields:

```text
id
transaction_id
actor_id
event_type
from_status
to_status
metadata
created_at
```

Events include:

```text
TRANSACTION_CREATED
INSTRUCTION_RECEIVED
SIGNATURE_VERIFIED
SIGNATURE_FAILED
CUSTOMER_CONFIRMED
INVESTMENT_VERIFIED
VOUCHER_CREATED
APPROVAL_GRANTED
APPROVAL_RETURNED
APPROVAL_REJECTED
OPERATIONS_STARTED
OPERATIONS_COMPLETED
TREASURY_CONFIRMED
REVERSAL_CREATED
```

## 16. Audit event protection

Normal application users must not have permission to:

```text
UPDATE audit_events
DELETE audit_events
```

If an event is incorrect, create a correction event rather than editing history.

## 17. Concurrency protection

Two users must not be able to approve or execute the same stage simultaneously.

Use database transactions and appropriate locking/constraints.

Examples:

- unique `(transaction_id, stage)` approval constraint;
- atomic status transition;
- transaction row locking for financial execution;
- idempotency keys for retryable commands.

## 18. Idempotency

Financial actions must be safe against accidental double submission.

For example:

```text
POST /transactions/:id/approve
```

submitted twice should not create two approvals.

Likewise:

```text
executeTransaction()
```

must not book the investment twice.

## 19. Reversal security

A reversal must never delete or overwrite the original transaction.

It must:

1. identify original transaction;
2. verify it is eligible for reversal;
3. require a reason;
4. create reversal record;
5. reverse the original posting;
6. create corrected investment/transaction where required;
7. update the Eazybankz Mirror;
8. record audit events.

The SOP specifically requires reversal to correct rate, tenor or amount and then update Eazybankz. fileciteturn1file2L556-L568

## 20. Payment instruction security

For external payments, the backend must require:

- beneficiary name;
- bank;
- account number;
- amount;
- purpose;
- transfer charge where applicable.

The SOP requires these details for external-bank payments. fileciteturn1file1L220-L225

For third-party external payments, the SOP specifies a 0.10% transfer charge; internal third-party accounts have no charge. fileciteturn1file0L17-L56

## 21. Storage security

Use private Supabase Storage buckets.

Recommended:

```text
transaction-documents
voucher-documents
```

Storage policies must verify the user's relationship to the transaction before allowing access.

## 22. Database functions

Critical mutations should be implemented as secure server-side functions/RPCs where appropriate:

```text
create_treasury_transaction()
verify_signature()
record_customer_confirmation()
verify_investment()
prepare_voucher()
approve_transaction()
execute_transaction()
confirm_treasury_completion()
create_reversal()
```

Functions should:

- validate inputs;
- validate authenticated user;
- validate role;
- validate transaction state;
- perform atomic changes;
- create audit event.

## 23. Secrets

Never expose:

```text
SUPABASE_SERVICE_ROLE_KEY
```

or any privileged secret to Next.js client components.

Keep secrets server-side.

## 24. Logging

Application logs may contain:

- transaction reference;
- event type;
- actor ID;
- execution status.

Do not log:

- passwords;
- access tokens;
- service-role keys;
- full sensitive account credentials;
- unnecessary customer financial data.

## 25. Backend security principle

The backend must assume the frontend has been compromised.

A malicious client should still be unable to:

```text
skip Step 2
skip Step 3
skip Step 4
create wrong voucher
approve out of sequence
approve without the correct role
execute before MD approval
mark transaction completed
edit approved financial values
delete audit history
double-execute a transaction
```

That is the required security posture for an SOP-driven financial workflow.
