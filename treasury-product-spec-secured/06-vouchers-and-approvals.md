# Vouchers and Approval Engine

## Voucher selection

The system should derive the voucher from the transaction type.

``` text
INFLOW                  → FUNDS_IN
MATURITY                → FUNDS_OUT
ANNIVERSARY             → FUNDS_OUT
PRE_LIQUIDATION         → FUNDS_OUT
THIRD_PARTY_PAYMENT     → FUNDS_OUT
ROLLOVER                → ROLLOVER_SLIP
INTERNAL_TRANSFER       → TRANSFER_SLIP
REVERSAL                → TRANSFER_SLIP
```

## Funds-Out

Fields:

-   principal
-   interest
-   WHT
-   net amount
-   transfer date
-   remarks
-   payment instruction where applicable

Recommended standardized Payment Instruction section:

-   Beneficiary Name
-   Bank Name
-   Account Number
-   Account Type
-   Amount
-   Transfer Charge, if applicable

## Funds-In

Fields:

-   customer name
-   amount
-   rate
-   tenor
-   effective date
-   maturity date

## Roll-over Slip

Fields:

-   principal amount
-   interest due
-   effective date
-   new tenor
-   new rate
-   roll-over amount
-   roll-over maturity date
-   payment instruction when interest is paid out

## Transfer Slip

Used for:

-   Savings → Personal Account
-   Personal Account → Commercial Paper
-   Personal Account → Call Placement
-   reversal/correction

## Approval engine

Do not hard-code approval screens separately for every transaction type.

Use an approval-stage configuration:

``` text
approval_stage
required_role
sequence
required
```

Default sequence from the SOP:

    Sequence Stage           Role
  ---------- --------------- ------------------
           1 Treasury        TREASURY_OFFICER
           2 Head Treasury   HEAD_TREASURY
           3 MIS             MIS
           4 Audit           AUDIT
           5 MD              MD

The transaction cannot advance to the next stage until the current stage
is approved.

## Approval decision

Supported decisions:

-   APPROVE
-   REJECT
-   RETURN

Every decision records:

-   actor;
-   stage;
-   timestamp;
-   comments;
-   previous status;
-   new status.

## Rejection vs return

`REJECT` means the transaction cannot continue without a new transaction
or controlled re-initiation.

`RETURN` means the maker must correct/complete the transaction and
resubmit it.

The exact organizational meaning should be confirmed before production.

## Approval UI

The approval page should show:

1.  Customer
2.  Investment
3.  Transaction type/scenario
4.  Six-step control checklist
5.  Voucher
6.  Calculations
7.  Payment instruction
8.  Supporting documents
9.  Previous approvals
10. Audit timeline
11. Approve / Return / Reject action

An approver should never need to reconstruct the transaction manually
from separate screens.
