# Supabase Database Schema

## Identity and access

### profiles

``` text
id uuid PK → auth.users.id
full_name text
email text
phone text
is_active boolean
created_at timestamptz
updated_at timestamptz
```

### roles

``` text
id uuid PK
code text UNIQUE
name text
```

Suggested codes:

-   CUSTOMER
-   ACCOUNT_OFFICER
-   TREASURY_OFFICER
-   HEAD_TREASURY
-   MIS
-   AUDIT
-   MD
-   OPERATIONS
-   ADMIN

### user_roles

``` text
user_id uuid → profiles.id
role_id uuid → roles.id
PRIMARY KEY (user_id, role_id)
```

## Customers

### customers

``` text
id uuid PK
customer_number text UNIQUE
name text
registered_phone text
status text
created_at timestamptz
updated_at timestamptz
```

### customer_accounts

``` text
id uuid PK
customer_id uuid → customers.id
account_number text UNIQUE
account_type text
status text
available_balance numeric
created_at timestamptz
updated_at timestamptz
```

## Investments

### investments

``` text
id uuid PK
customer_id uuid
account_id uuid
external_reference text
product_type text
principal numeric
interest_rate numeric
accrued_interest numeric
effective_date date
maturity_date date
outstanding_balance numeric
available_amount numeric
status text
source_system text
created_at timestamptz
updated_at timestamptz
```

The `source_system` may be `EAZYBANKZ` where the value originated from
that system.

## Treasury transactions

### treasury_transactions

``` text
id uuid PK
transaction_reference text UNIQUE
customer_id uuid
investment_id uuid NULL
transaction_type text
scenario_code text NULL
status text
currency text
requested_amount numeric
approved_amount numeric NULL
purpose text
source_instruction_type text
created_by uuid
created_at timestamptz
updated_at timestamptz
completed_at timestamptz NULL
```

Suggested transaction types:

-   ROLLOVER
-   MATURITY_TERMINATION
-   PRE_LIQUIDATION
-   ANNIVERSARY_PAYMENT
-   THIRD_PARTY_PAYMENT
-   INTERNAL_TRANSFER
-   INFLOW
-   SAVINGS_FUNDS_OUT
-   CALL_FUNDS_OUT
-   CMS_FUNDS_OUT
-   REVERSAL

## Payment instructions

### payment_instructions

``` text
id uuid PK
transaction_id uuid UNIQUE
beneficiary_name text
bank_name text
account_number text
account_type text
amount numeric
transfer_charge numeric
purpose text
is_internal boolean
verified_at timestamptz NULL
verified_by uuid NULL
created_at timestamptz
updated_at timestamptz
```

External payments require beneficiary details. Internal payments should
reference the internal account where possible.

## Verification records

### signature_verifications

``` text
id uuid PK
transaction_id uuid
verified_by uuid
signature_result text
mandate_result text
account_ownership_result text
completeness_result text
notes text
verified_at timestamptz
```

### customer_confirmations

``` text
id uuid PK
transaction_id uuid
confirmed_by uuid
confirmation_status text
confirmed_amount numeric
confirmed_beneficiary text
confirmed_purpose text
confirmation_date date
confirmation_time time
notes text
created_at timestamptz
```

### investment_verifications

``` text
id uuid PK
transaction_id uuid
verified_by uuid
source_system text
principal numeric
accrued_interest numeric
interest_rate numeric
effective_date date
maturity_date date
outstanding_balance numeric
available_amount numeric
verified_at timestamptz
```

## Vouchers

### vouchers

``` text
id uuid PK
transaction_id uuid
voucher_number text UNIQUE
voucher_type text
status text
principal numeric NULL
interest numeric NULL
wht numeric NULL
charge numeric NULL
net_amount numeric NULL
transfer_date date NULL
remarks text NULL
created_by uuid
created_at timestamptz
updated_at timestamptz
```

Voucher types:

-   FUNDS_IN
-   FUNDS_OUT
-   ROLLOVER_SLIP
-   TRANSFER_SLIP

## Rollover details

### rollover_details

``` text
id uuid PK
transaction_id uuid UNIQUE
rollover_type text
original_principal numeric
interest_due numeric
principal_rolled numeric
interest_paid numeric
requested_payout numeric
new_rate numeric NULL
new_tenor integer NULL
new_effective_date date NULL
new_maturity_date date NULL
new_rollover_amount numeric
created_at timestamptz
```

## Pre-liquidation details

### pre_liquidation_details

``` text
id uuid PK
transaction_id uuid UNIQUE
original_principal numeric
accrued_interest numeric
charge_rate numeric
charge_amount numeric
requested_payout numeric
remaining_principal numeric
rebooked_principal numeric
net_interest numeric NULL
created_at timestamptz
```

## Approvals

### approvals

``` text
id uuid PK
transaction_id uuid
stage text
approver_id uuid
decision text
comments text NULL
approved_at timestamptz NULL
created_at timestamptz
```

A unique constraint should prevent the same approval stage from being
approved twice for the same transaction.

## Operations

### operations_executions

``` text
id uuid PK
transaction_id uuid UNIQUE
executed_by uuid
execution_status text
external_reference text NULL
execution_notes text NULL
executed_at timestamptz NULL
```

## Audit

### audit_events

``` text
id bigint/generated PK
transaction_id uuid NULL
actor_id uuid
event_type text
from_status text NULL
to_status text NULL
metadata jsonb
created_at timestamptz
```

Audit events should be append-only.

## Documents

### transaction_documents

``` text
id uuid PK
transaction_id uuid
document_type text
storage_path text
uploaded_by uuid
created_at timestamptz
```

## Important indexes

At minimum:

-   `treasury_transactions(status)`
-   `treasury_transactions(transaction_type)`
-   `treasury_transactions(customer_id)`
-   `treasury_transactions(created_at)`
-   `approvals(transaction_id, stage)`
-   `audit_events(transaction_id, created_at)`
-   `investments(customer_id, status)`
-   `operations_executions(transaction_id)`
