# Users, Customers & Roles — Greenline Treasury Platform

## Overview

The platform has two distinct categories of principals: **Staff Users** (human operators who move transactions through the workflow) and **Customers** (the bank's clients whose investments and accounts are the subject of those transactions). Customers do not log in to the system — they are referenced data, not actors.

---

## Staff Roles

There are 8 staff roles. Each role maps to a specific position in the transaction lifecycle.

| Role Code         | Display Name          | Position in Workflow                                         |
|-------------------|-----------------------|--------------------------------------------------------------|
| `TREASURY_OFFICER`| Treasury Officer      | Creates transactions, verifies investments, prepares vouchers, approves at Treasury stage, confirms completion, creates reversals |
| `ACCOUNT_OFFICER` | Account Officer       | Records customer confirmation (Step 3)                       |
| `HEAD_TREASURY`   | Head of Treasury      | Approves at Head Treasury stage                              |
| `MIS`             | MIS Officer           | Approves at MIS stage                                        |
| `AUDIT`           | Audit Officer         | Approves at Audit stage; full read access to audit history   |
| `MD`              | Managing Director     | Final approval before Operations execution                   |
| `OPERATIONS`      | Operations Officer    | Executes the transaction after MD approval                   |
| `ADMIN`           | System Administrator  | Full access: user management, SLA config, all workflow steps |

### Approval Chain Order

```
Treasury Officer → Head of Treasury → MIS Officer → Audit Officer → Managing Director → Operations Officer
```

### Permissions by Role

| Permission               | ACCOUNT_OFFICER | TREASURY_OFFICER | HEAD_TREASURY | MIS | AUDIT | MD | OPERATIONS | ADMIN |
|--------------------------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `create_transaction`     |   | ✓ |   |   |   |   |   | ✓ |
| `verify_signature`       |   | ✓ |   |   |   |   |   | ✓ |
| `record_confirmation`    | ✓ |   |   |   |   |   |   | ✓ |
| `verify_investment`      |   | ✓ |   |   |   |   |   | ✓ |
| `prepare_voucher`        |   | ✓ |   |   |   |   |   | ✓ |
| `approve_treasury`       |   | ✓ |   |   |   |   |   | ✓ |
| `approve_head_treasury`  |   |   | ✓ |   |   |   |   | ✓ |
| `approve_mis`            |   |   |   | ✓ |   |   |   | ✓ |
| `approve_audit`          |   |   |   |   | ✓ |   |   | ✓ |
| `approve_md`             |   |   |   |   |   | ✓ |   | ✓ |
| `execute_transaction`    |   |   |   |   |   |   | ✓ | ✓ |
| `confirm_completion`     |   | ✓ |   |   |   |   |   | ✓ |
| `create_reversal`        |   | ✓ |   |   |   |   |   | ✓ |
| `upload_document`        | ✓ | ✓ |   |   |   |   |   | ✓ |
| `view_transactions`      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `view_audit_history`     |   |   |   |   | ✓ |   |   | ✓ |
| `manage_users`           |   |   |   |   |   |   |   | ✓ |
| `manage_sla_config`      |   |   |   |   |   |   |   | ✓ |

> **Note on visibility:** Account Officers can only see transactions at `SIGNATURE_VERIFIED` status (awaiting their confirmation) or transactions they have already confirmed. Operations Officers can only see transactions from `MD_APPROVED` onward.

---

## Seed Staff Users

The platform ships with 15 pre-seeded staff users for development and testing: 8 scenario users and 7 E2E users. All use the password **`Password123!`** (dev/staging only).

### Scenario Users

| Full Name              | Email                                      | Role              | UUID (suffix)   |
|------------------------|--------------------------------------------|-------------------|-----------------|
| Treasury Maker 01      | treasury_maker_01@greenline.test           | TREASURY_OFFICER  | `...0001`       |
| Treasury Checker 01    | treasury_checker_01@greenline.test         | TREASURY_OFFICER  | `...0008`       |
| Account Officer 01     | account_officer_01@greenline.test          | ACCOUNT_OFFICER   | `...0002`       |
| Head Treasury 01       | head_treasury_01@greenline.test            | HEAD_TREASURY     | `...0003`       |
| MIS Officer 01         | mis_officer_01@greenline.test              | MIS               | `...0004`       |
| Audit Officer 01       | audit_officer_01@greenline.test            | AUDIT             | `...0005`       |
| Managing Director 01   | md_01@greenline.test                       | MD                | `...0006`       |
| Operations Officer 01  | operations_officer_01@greenline.test       | OPERATIONS        | `...0007`       |

> Two Treasury Officers are seeded to test the maker/checker separation — the same user who created a transaction cannot be the one who approves it at the Treasury stage.

### E2E Users

| Full Name                | Email                                        | Role              |
|--------------------------|----------------------------------------------|-------------------|
| Treasury Maker E2E       | treasury_maker_e2e@greenline.test            | TREASURY_OFFICER  |
| Account Officer E2E      | account_officer_e2e@greenline.test           | ACCOUNT_OFFICER   |
| Head Treasury E2E        | head_treasury_e2e@greenline.test             | HEAD_TREASURY     |
| MIS Officer E2E          | mis_officer_e2e@greenline.test               | MIS               |
| Audit Officer E2E        | audit_officer_e2e@greenline.test             | AUDIT             |
| Managing Director E2E    | md_e2e@greenline.test                        | MD                |
| Operations Officer E2E   | operations_officer_e2e@greenline.test        | OPERATIONS        |

---

## Customers

Customers are bank clients. They do not authenticate into the platform. Their data is referenced by transactions created on their behalf by Treasury Officers.

### Scenario Customers (A–R)

Each customer maps to a specific transaction scenario. All are `ACTIVE` with Nigerian mobile numbers (`+23480111110xx`).

| ID   | Customer Number | Name               | Scenario                                  | Account Types           |
|------|-----------------|--------------------|-------------------------------------------|-------------------------|
| A    | CUST-A-001      | Adaeze Nwosu       | Full Rollover (Principal + Interest)      | PERSONAL (FD)           |
| B    | CUST-B-001      | Babatunde Okafor   | Principal Rollover + Interest Payout      | PERSONAL (FD)           |
| C    | CUST-C-001      | Chidi Eze          | Partial Rollover                          | PERSONAL (FD)           |
| D    | CUST-D-001      | Damilola Adeyemi   | Interest-Only Rollover                    | PERSONAL (FD)           |
| E    | CUST-E-001      | Emeka Okonkwo      | Maturity Termination                      | PERSONAL (FD)           |
| F    | CUST-F-001      | Fatima Bello       | Full Pre-liquidation                      | PERSONAL (FD)           |
| G    | CUST-G-001      | Grace Uchenna      | Partial Pre-liquidation                   | PERSONAL (FD)           |
| H    | CUST-H-001      | Hassan Ibrahim     | Anniversary Payment — 30 Days             | PERSONAL (FD)           |
| I    | CUST-I-001      | Ifeoma Obi         | Anniversary Payment — 60 Days             | PERSONAL (FD)           |
| J    | CUST-J-001      | Joseph Akinwale    | Anniversary Payment — 90 Days             | PERSONAL (FD)           |
| K    | CUST-K-001      | Kelechi Nwachukwu  | External Third-Party Payment              | PERSONAL                |
| L    | CUST-L-001      | Lola Fashola       | Internal Third-Party Payment              | PERSONAL                |
| M    | CUST-M-001      | Michael Adesanya   | Internal Transfer — Savings → Personal    | SAVINGS + PERSONAL      |
| N    | CUST-N-001      | Ngozi Okoro        | Internal Transfer — Personal → Commercial Paper | PERSONAL + COMMERCIAL_PAPER |
| O    | CUST-O-001      | Olumide Adebayo    | Internal Transfer — Personal → Call       | PERSONAL + CALL         |
| P    | CUST-P-001      | Patience Osei      | Reversal (incorrect rate — 13.5%)         | PERSONAL (FD)           |
| Q    | CUST-Q-001      | Qudus Lawal        | Inflow (new placement)                    | PERSONAL                |
| R    | CUST-R-001      | Rachael Oduya      | Savings / Call / CMS Funds-Out            | SAVINGS + CALL + CMS    |

### Scenario Customer Investment Summary

| Customer | Principal       | Rate  | Accrued Interest | Available Amount |
|----------|-----------------|-------|------------------|------------------|
| A        | ₦12,450,000     | 12.5% | ₦245,000         | ₦12,695,000      |
| B        | ₦8,000,000      | 12.0% | ₦160,000         | ₦8,160,000       |
| C        | ₦10,000,000     | 12.5% | ₦0               | ₦10,000,000      |
| D        | ₦5,000,000      | 12.0% | ₦100,000         | ₦5,100,000       |
| E        | ₦25,000,000     | 12.5% | ₦1,250,000       | ₦26,250,000      |
| F        | ₦15,000,000     | 12.5% | ₦1,500,000       | ₦16,200,000      |
| G        | ₦10,000,000     | 12.5% | ₦1,500,000       | ₦11,200,000      |
| H        | ₦6,000,000      | 12.0% | ₦60,000          | ₦6,060,000       |
| I        | ₦6,000,000      | 12.0% | ₦120,000         | ₦6,120,000       |
| J        | ₦6,000,000      | 12.0% | ₦180,000         | ₦6,180,000       |
| P        | ₦7,000,000      | 13.5% | ₦140,000         | ₦7,140,000       |
| R (Svgs) | Balance-based   | —     | —                | ₦4,500,000       |
| R (Call) | Balance-based   | —     | —                | ₦3,200,000       |
| R (CMS)  | Balance-based   | —     | —                | ₦1,800,000       |

Customers K, L, M, N, O, Q have no investment record — their scenarios are payment or transfer based, working from account balances directly.

---

## Negative Test Customers

Used exclusively for failure-path and RLS tests. All are `ACTIVE`.

| Customer Number   | Name                                              | Scenario Purpose                                    |
|-------------------|---------------------------------------------------|-----------------------------------------------------|
| CUSTOMER_NEG_001  | Negative Test — Signature Mismatch                | Signature verification step fails                   |
| CUSTOMER_NEG_002  | Negative Test — Insufficient Balance              | Account balance too low to process instruction      |
| CUSTOMER_NEG_003  | Negative Test — Incomplete Instruction            | Required fields missing from the instruction        |
| CUSTOMER_NEG_004  | Negative Test — Confirmation Failed               | Customer unreachable / confirmation denied          |
| CUSTOMER_NEG_005  | Negative Test — Missing Beneficiary               | External payment with no beneficiary data           |
| CUSTOMER_NEG_006  | Negative Test — Internal Transfer Insufficient Balance | Savings balance too low for SAVINGS_TO_PERSONAL transfer |

---

## Notes

- **Password for all seed users**: `Password123!` — dev/staging only. Never use in production.
- **Seeding approach**: On hosted Supabase, use `npx tsx supabase/seed-users.ts` to create staff users via the Admin API (preserves `auth.identities` for sign-in). Customer and investment data is seeded via the SQL Editor using `supabase/seed.sql` sections 4–8.
- **Role assignment**: All roles are assigned by Treasury Maker 01 (`treasury_maker_01@greenline.test`) in the seed data.
- **Security boundary**: The `permissions.ts` file controls UI visibility only. The actual enforcement is in the Postgres RLS policies (`002_rls.sql`) and `SECURITY DEFINER` RPC functions, which cannot be bypassed by the client.
