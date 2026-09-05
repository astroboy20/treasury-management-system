# Treasury Operations Product --- Product Overview

## Source of truth

This product specification is derived from the **FIRST MARINA TRUST
FINANCE COMPANY LIMITED --- STANDARD OPERATING PROCEDURE (SOP) ---
TREASURY OPERATIONS**.

The SOP defines a six-step general process for treasury transactions:

1.  Customer Instruction
2.  Signature Verification
3.  Customer Confirmation
4.  Investment Verification
5.  Raise Appropriate Treasury Voucher
6.  Treasury Approval

After approval, Operations executes the transaction and Treasury follows
up until completion.

## Product objective

Turn the manual treasury SOP into a controlled workflow application
where:

-   every transaction has a lifecycle and status;
-   every required control is explicit;
-   every approval is attributable to a user;
-   voucher data is structured rather than free-form;
-   transaction calculations are reproducible;
-   Operations completion is tracked;
-   Treasury can see where every transaction is in the process;
-   audit history cannot be silently changed.

## Transaction types

The product must support:

-   Rollover
    -   Principal + Interest
    -   Principal rollover + interest payout
    -   Partial principal rollover
    -   Interest-only payment
-   Termination at Maturity
-   Pre-liquidation
    -   Full
    -   Partial
-   Anniversary Interest Payment
    -   30 days
    -   60 days
    -   90 days
-   Third Party Payment
    -   External bank, including 0.10% transfer charge
    -   Internal account, no charge
-   Transfer Slip
    -   Savings → Personal Account
    -   Personal Account → Commercial Paper
    -   Personal Account → Call Placement
    -   Reversal/correction
-   Inflows
-   Savings, Call and CMS Funds-Out

## Core design principle

Do not model the application as a collection of forms. Model it as a
**transaction workflow engine**.

A transaction moves through controlled states:

`DRAFT → INSTRUCTION_RECEIVED → SIGNATURE_VERIFIED → CUSTOMER_CONFIRMED → INVESTMENT_VERIFIED → VOUCHER_PREPARED → APPROVALS → OPERATIONS_PROCESSING → COMPLETED`

Exceptional states include:

`REJECTED`, `RETURNED`, `CANCELLED`, `FAILED`, and `REVERSED`.

No money-moving transaction should be marked completed merely because a
voucher was approved. Operations completion and Treasury confirmation
are separate events.

## Roles

The SOP explicitly identifies these operational actors:

-   Customer
-   Account Officer
-   Treasury Officer
-   Head Treasury
-   MIS
-   Audit
-   Managing Director
-   Operations

The system should use role-based access control so a user can only
perform actions permitted for their role.

## Important distinction

A **customer** is the owner/requester of the investment or account.

An **internal application user** is a staff member operating the
treasury system.

For testing, create separate seed users for every major use case and
approval role. Never use one administrator account to simulate the whole
process.
