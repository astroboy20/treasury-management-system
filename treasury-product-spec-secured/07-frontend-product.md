# Frontend Product Specification

## Main application navigation

### Dashboard

Shows:

-   transactions awaiting my action;
-   transactions by status;
-   pending approvals;
-   Operations pending execution;
-   completed transactions;
-   exceptions;
-   SLA alerts.

### Transactions

Views:

-   All
-   My transactions
-   Pending my action
-   Completed
-   Rejected
-   Returned
-   Failed

Filters:

-   transaction type
-   status
-   date
-   customer
-   investment
-   reference
-   assigned role/stage

## Transaction creation

Start with:

1.  Customer
2.  Transaction type
3.  Scenario
4.  Amount
5.  Purpose
6.  Instruction document
7.  Payment instruction if required

The UI should dynamically render only fields required by the selected
scenario.

## Transaction workspace

Every transaction should have one canonical workspace.

Suggested layout:

``` text
Header
  Reference | Customer | Type | Amount | Status

Progress
  1 Instruction
  2 Signature
  3 Confirmation
  4 Investment
  5 Voucher
  6 Approval

Main
  Transaction details
  Verification
  Calculation
  Voucher

Side panel
  Current owner
  Current approval
  SLA
  Documents

Bottom
  Audit timeline
```

## Six-step experience

The user should not see six unrelated forms.

Instead, show a persistent progress tracker.

### Step 1

Upload/select instruction.

### Step 2

Verification checklist.

### Step 3

Confirmation record.

### Step 4

Investment snapshot.

### Step 5

Generated voucher.

### Step 6

Approval chain.

A completed step becomes read-only unless the transaction is formally
returned for correction.

## Scenario-driven UI

For Rollover:

``` text
Rollover
 ├─ Principal + Interest
 ├─ Principal only
 ├─ Partial Principal
 └─ Interest only
```

For Third Party Payment:

``` text
Third Party Payment
 ├─ External Bank
 └─ Internal Account
```

For Transfer:

``` text
Transfer
 ├─ Savings → Personal
 ├─ Personal → Commercial Paper
 ├─ Personal → Call Placement
 └─ Reversal
```

This keeps the interface aligned with the SOP.

## Validation

Use Zod for client-side form feedback.

Repeat critical validation server-side.

Examples:

-   amount \> 0;
-   external payment requires beneficiary name;
-   external payment requires bank;
-   external payment requires account number;
-   required approval stage must exist;
-   rollover amount cannot exceed applicable balance;
-   partial payout cannot exceed eligible amount;
-   new tenor/rate required for rollover where applicable.

## UX principle

The system should answer three questions at all times:

1.  What is this transaction?
2.  What is currently blocking it?
3.  Who needs to act next?
