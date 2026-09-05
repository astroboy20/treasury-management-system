# User Flows

## A. Common six-step flow

Every treasury transaction starts with the same six control stages.

### Step 1 --- Customer Instruction

Actor: Treasury Officer / Account Officer

Inputs:

-   written instruction
-   instruction type: letter, email, signed instruction form, or
    mandated instruction
-   beneficiary details where applicable
-   amount
-   purpose

For external payment, beneficiary name, bank name, account number,
amount and purpose are mandatory.

System behavior:

-   create transaction;
-   assign transaction reference;
-   upload/store instruction evidence;
-   capture source type;
-   identify customer;
-   set status to `INSTRUCTION_RECEIVED`.

### Step 2 --- Signature Verification

Actor: Treasury Officer

Verify:

-   signature
-   mandate
-   account ownership
-   instruction completeness

If signature differs, processing stops.

System behavior:

-   capture verification result;
-   capture verifier;
-   capture timestamp;
-   require a reason for rejection/return;
-   prevent Step 3 until verification passes.

### Step 3 --- Customer Confirmation

Actor: Account Officer

Call customer using registered phone number.

Confirm:

-   amount
-   instruction
-   beneficiary
-   purpose

Record:

-   date
-   time
-   officer name

System behavior:

-   confirmation cannot be completed without confirmation metadata;
-   failed/unreachable confirmation routes the transaction to a
    controlled exception state;
-   successful confirmation unlocks Step 4.

### Step 4 --- Investment Verification

Actor: Treasury Officer

Verify investment in Eazybankz:

-   principal
-   accrued interest
-   interest rate
-   effective date
-   maturity date
-   outstanding balance
-   available amount

System behavior:

-   create a verification snapshot;
-   record the source as Eazybankz;
-   store who verified and when;
-   use the verified snapshot for downstream calculations.

### Step 5 --- Raise Appropriate Treasury Voucher

Voucher depends on transaction:

  Transaction           Voucher
  --------------------- ----------------
  Inflow                Funds-In
  Maturity payment      Funds-Out
  Anniversary payment   Funds-Out
  Pre-liquidation       Funds-Out
  Third-party payment   Funds-Out
  Rollover              Roll-over Slip
  Internal transfer     Transfer Slip

System behavior:

-   automatically select the expected voucher type;
-   generate a structured voucher;
-   validate required fields;
-   calculate applicable charges;
-   prevent approval if mandatory information is missing.

### Step 6 --- Approval

Approval chain:

1.  Treasury Officer
2.  Head Treasury
3.  MIS
4.  Audit
5.  Managing Director
6.  Operations execution
7.  Treasury completion confirmation

Each approval must be a separate event.

## B. Rollover flows

### Rollover --- Principal + Interest

The entire principal and interest are rolled over.

Required data:

-   principal amount
-   interest due
-   effective date
-   new tenor
-   new rate
-   rollover amount
-   rollover maturity date

After approvals:

-   Operations books new investment;
-   Treasury confirms booking.

### Rollover --- Principal only

Principal is reinvested and interest is paid to the bank account.

Additional payment information must be captured in remarks/payment
instruction:

-   beneficiary name
-   bank
-   account number

This creates two business outcomes:

1.  new investment for principal;
2.  funds-out for interest.

The system should represent these as linked child transactions rather
than one ambiguous transaction.

### Rollover --- Partial Principal

Example from SOP:

Original principal: ₦10,000,000\
Rollover: ₦7,000,000\
Payment: ₦3,000,000

The system must calculate and display:

`remaining principal = original principal - requested payout`

If external payment applies, the payout becomes a Funds-Out transaction.

### Rollover --- Interest only

Customer receives interest while principal remains invested.

The system should create a Funds-Out for the calculated interest and
keep the original principal investment active.

## C. Termination at Maturity

Flow:

Instruction → mandate verification → investment confirmation →
accrued-interest confirmation → Funds-Out → approval chain → Operations
payment → Treasury confirmation.

Voucher fields:

-   principal
-   interest
-   WHT
-   net amount
-   transfer date
-   remarks

For external payment, beneficiary details are required.

## D. Pre-liquidation

Purpose: terminate before maturity.

The SOP specifies a charge of **20% of accrued interest**.

Calculation:

`pre-liquidation charge = accrued interest × 20%`

`net interest = accrued interest - pre-liquidation charge`

For partial pre-liquidation, preserve the SOP's example logic as a
configurable business rule and require the exact requested payout and
rebooking amounts to be visible before approval.

## E. Anniversary Interest Payment

Supported frequencies:

-   30 days
-   60 days
-   90 days

Flow:

Verify investment → confirm anniversary due → calculate interest → WHT
not required per SOP → Funds-Out → approvals → Operations payment →
investment remains active.

## F. Third Party Payment

### External bank

Transfer charge:

`transfer charge = applicable transfer amount × 0.10%`

Voucher remarks must contain:

-   beneficiary name
-   bank
-   account number
-   transfer charge

### Internal account

No charge.

The beneficiary internal account must be verified before Funds-Out is
raised.

## G. Transfer Slip

### Savings → Personal Account

Verify customer → Transfer Slip → approval → Operations debits Savings →
credits Personal Account.

### Personal Account → Commercial Paper

Verify available balance → Transfer Slip → Operations debits Personal
Account → books Commercial Paper.

### Personal Account → Call Placement

Verify balance → Transfer Slip → Operations transfers → Treasury books
investment.

### Reversal

For correction of rate, tenor or amount:

-   raise Transfer Slip;
-   reverse original posting;
-   book corrected investment;
-   update Eazybankz.

A reversal must reference the original transaction.

## H. Inflows

Flow:

Investment instruction → confirm receipt of funds → confirm source
account → Funds-In → Treasury approval chain → Operations books
investment → Treasury confirms investment created.

Funds-In captures:

-   customer name
-   amount
-   rate
-   tenor
-   effective date
-   maturity date

## I. Savings, Call and CMS Funds-Out

Flow:

Instruction → mandate verification → investment verification → Funds-Out
→ approval chain → Operations processes payment → Treasury confirms.

The SOP states that interest for these is calculated by Eazybankz. The
product should therefore treat the Eazybankz interest result as an
external source value unless a later approved rule specifies otherwise.
