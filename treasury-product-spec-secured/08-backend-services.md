# Backend Services and Business Logic

## Services

Suggested service modules:

``` text
auth/
customers/
accounts/
investments/
transactions/
verification/
calculations/
vouchers/
approvals/
operations/
audit/
documents/
notifications/
integrations/eazybankz/
```

## Transaction service

Responsibilities:

-   create transaction;
-   validate transaction type/scenario;
-   assign reference;
-   initialize workflow;
-   create audit event.

## Verification service

### verifySignature()

Validates:

-   signature result;
-   mandate;
-   account ownership;
-   completeness.

If signature differs, do not advance the transaction.

### recordCustomerConfirmation()

Requires:

-   officer;
-   date;
-   time;
-   amount;
-   instruction;
-   beneficiary;
-   purpose.

### snapshotInvestment()

Stores Eazybankz values at verification time.

## Calculation service

Every calculation returns:

``` text
inputs
rule
outputs
calculated_at
calculated_by/system
```

## Voucher service

Responsibilities:

-   determine voucher type;
-   populate voucher;
-   validate required fields;
-   save calculation snapshot;
-   create voucher number.

## Approval service

A secure server-side function should:

1.  authenticate actor;
2.  load transaction;
3.  verify actor role;
4.  verify transaction status;
5.  verify required previous approvals;
6.  record approval;
7.  transition status;
8.  write audit event.

Do this atomically.

## Operations service

Operations can only execute a transaction after MD approval.

On execution:

-   record executor;
-   execution status;
-   external reference;
-   execution timestamp;
-   notes.

## Treasury completion

Treasury confirms completion after Operations processing.

This is distinct from Operations execution.

## Reversal service

A reversal should:

-   reference original transaction;
-   require a reason;
-   create a new reversal transaction/event;
-   reverse the original posting through the approved process;
-   book corrected investment where required;
-   update Eazybankz;
-   preserve the original transaction history.

Do not physically delete the original financial transaction.

## Audit service

Write an audit event for:

-   creation;
-   document upload;
-   verification;
-   customer confirmation;
-   voucher creation;
-   calculation;
-   approval;
-   return;
-   rejection;
-   Operations execution;
-   Treasury confirmation;
-   reversal.

Audit records should be append-only.
