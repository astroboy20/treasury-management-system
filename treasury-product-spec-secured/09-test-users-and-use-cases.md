# Test Users and End-to-End Use Cases

The requirement is to have a user/test actor for each major use case and
to test the complete six-step journey.

## Seed internal users

Create separate users:

  -----------------------------------------------------------------------
  User                    Role                    Purpose
  ----------------------- ----------------------- -----------------------
  Treasury Maker 01       TREASURY_OFFICER        Creates and verifies
                                                  transactions

  Account Officer 01      ACCOUNT_OFFICER         Customer confirmation

  Head Treasury 01        HEAD_TREASURY           Approval

  MIS Officer 01          MIS                     Approval

  Audit Officer 01        AUDIT                   Approval

  MD 01                   MD                      Final approval

  Operations Officer 01   OPERATIONS              Execution
  -----------------------------------------------------------------------

## Seed customer personas

Create separate test customers for each scenario so data does not
accidentally overlap.

### Customer A --- Full Rollover

Existing investment with principal and accrued interest.

Expected:

-   P+I rollover;
-   new investment;
-   Treasury confirmation.

### Customer B --- Principal Rollover + Interest Payout

Expected:

-   principal reinvested;
-   interest Funds-Out;
-   external payment instruction.

### Customer C --- Partial Rollover

Seed:

`principal = ₦10,000,000`

Customer requests:

`rollover = ₦7,000,000`

Expected payout:

`₦3,000,000`

### Customer D --- Interest Only

Expected:

-   interest Funds-Out;
-   principal remains active.

### Customer E --- Maturity Termination

Expected:

-   principal + interest Funds-Out;
-   investment becomes terminated after successful completion.

### Customer F --- Full Pre-liquidation

Seed accrued interest and validate 20% charge.

### Customer G --- Partial Pre-liquidation

Use the SOP's ₦10m / ₦1.5m / ₦300k example.

Expected rebooking:

`₦6,700,000`

### Customer H --- Anniversary 30 Days

Expected:

-   interest payment;
-   principal remains invested.

### Customer I --- Anniversary 60 Days

Same flow with 60-day anniversary.

### Customer J --- Anniversary 90 Days

Same flow with 90-day anniversary.

### Customer K --- External Third Party Payment

Expected:

-   0.10% transfer charge;
-   external beneficiary details;
-   Funds-Out.

### Customer L --- Internal Third Party Payment

Expected:

-   no transfer charge;
-   internal beneficiary account verification.

### Customer M --- Savings → Personal

Expected:

-   Transfer Slip;
-   Operations debit/credit.

### Customer N --- Personal → Commercial Paper

Expected:

-   balance verification;
-   Transfer Slip;
-   CP booking.

### Customer O --- Personal → Call Placement

Expected:

-   balance verification;
-   Transfer Slip;
-   investment booking.

### Customer P --- Reversal

Create an original transaction with an incorrect:

-   rate, or
-   tenor, or
-   amount.

Then perform reversal/correction.

### Customer Q --- Inflow

Expected:

-   funds received;
-   source account confirmed;
-   Funds-In;
-   new investment booked.

### Customer R --- Savings/Call/CMS Funds-Out

Expected:

-   available balance verification;
-   Funds-Out;
-   Operations execution;
-   Treasury confirmation.

## Negative test users

Create separate scenarios for:

-   signature mismatch;
-   incomplete instruction;
-   customer confirmation failed;
-   insufficient available balance;
-   missing beneficiary data;
-   approval attempted out of sequence;
-   unauthorized role attempting approval;
-   Operations attempting execution before MD approval;
-   duplicate approval;
-   completed transaction edited;
-   reversal without original reference.

## Definition of done for every use case

A use case is complete only when:

1.  instruction exists;
2.  signature/mandate verification is recorded;
3.  customer confirmation is recorded where applicable;
4.  investment/balance verification is recorded where applicable;
5.  correct voucher exists;
6.  all approvals are recorded;
7.  Operations execution is recorded;
8.  Treasury confirms completion;
9.  audit timeline contains the complete history;
10. final balances/statuses are consistent.
