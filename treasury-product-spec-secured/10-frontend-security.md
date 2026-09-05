# Frontend Security Specification

## Purpose

The frontend security model must enforce the Treasury SOP as a user-interface control layer while recognizing that the frontend is **not** the final security boundary.

The SOP requires every Treasury transaction to pass through instruction, signature verification, telephone confirmation, investment confirmation, correct voucher preparation, five approval stages, Operations processing, and completion. The UI must make it difficult to skip any of these controls. fileciteturn1file1L211-L280 fileciteturn1file0L174-L188

## 1. Authentication

Use Supabase Auth.

Frontend requirements:

- authenticated routes must require a valid Supabase session;
- unauthenticated users are redirected to login;
- expired sessions must not expose protected transaction data;
- authenticated user profile and role must be loaded server-side;
- never store Supabase service-role credentials in browser code;
- never place financial authorization decisions solely in client state.

## 2. Route protection

Protect all internal application routes.

Suggested route groups:

```text
/login

/app
/app/dashboard
/app/transactions
/app/transactions/[id]
/app/approvals
/app/operations
/app/customers
/app/investments
/app/audit
/app/admin
```

Role-sensitive areas:

```text
/app/approvals/treasury
/app/approvals/head-treasury
/app/approvals/mis
/app/approvals/audit
/app/approvals/md
/app/operations
```

Middleware can prevent obvious unauthorized navigation, but every server operation must independently verify the user's role.

## 3. Role-aware UI

The interface should show only actions relevant to the current user.

Examples:

- Account Officer → customer confirmation action;
- Treasury Officer → signature/investment verification and Treasury approval;
- Head Treasury → Head Treasury approval;
- MIS → MIS approval;
- Audit → Audit approval and audit history;
- MD → final approval;
- Operations → execution;
- Treasury → completion confirmation.

Hiding a button is **not** authorization. The backend must enforce the same rule.

## 4. Six-step workflow locking

The frontend must prevent users from visually or functionally bypassing workflow stages.

Example:

```text
1 Instruction       ✓
2 Signature         ✓
3 Confirmation      ✓
4 Investment        ●
5 Voucher           🔒
6 Approval          🔒
```

A locked step should:

- be read-only;
- explain why it is locked;
- show the previous prerequisite;
- never allow a client-side override.

The SOP explicitly says signature mismatch stops processing. Therefore the UI must lock all downstream actions when signature verification fails. fileciteturn1file1L226-L234

## 5. Sensitive information display

Financial and customer information should be minimized.

Examples:

- mask account numbers except where operationally required;
- do not expose unnecessary customer information;
- avoid displaying sensitive information in URLs;
- do not put customer financial values into analytics events;
- do not place transaction details in browser console logs.

## 6. Document security

Customer instructions and supporting documents are sensitive.

Frontend requirements:

- upload only to private Supabase Storage buckets;
- display documents through authorized access;
- do not expose permanent public file URLs;
- use short-lived signed URLs where appropriate;
- validate file type and size before upload;
- show upload status and failed-upload state.

The SOP requires customer instruction and other transaction evidence as part of the process, so documents must remain attached to the transaction's controlled record. fileciteturn1file1L213-L225 fileciteturn1file3L601-L605

## 7. Form security

Use:

- React Hook Form;
- Zod;
- server-side revalidation.

Client validation should prevent obvious mistakes such as:

- invalid amount;
- missing beneficiary;
- invalid account number;
- missing purpose;
- missing required transaction scenario;
- missing approval comments where required.

Never assume client validation is sufficient.

## 8. Financial amount protection

Use decimal-safe values.

Frontend should not perform the authoritative calculation.

For example, the UI can preview:

```text
Accrued Interest     ₦1,500,000
20% Charge           ₦300,000
```

but the backend recalculates and returns the authoritative result.

The SOP specifies a 20% pre-liquidation charge on accrued interest and a 0.10% external third-party transfer charge. fileciteturn1file2L395-L420 fileciteturn1file0L21-L41

## 9. Approval UI security

Before showing an approval action, the frontend should fetch the current transaction state.

Display:

- current approval stage;
- current approver role;
- completed approvals;
- outstanding approvals;
- transaction status;
- calculation;
- voucher;
- supporting documents;
- audit timeline.

The UI must never allow:

```text
Approve → immediately call next-stage approval
```

without the backend changing the transaction state.

## 10. Dangerous browser behavior to prevent

Do not:

- trust `localStorage.role`;
- trust hidden form fields for user identity;
- trust a transaction status sent from the browser;
- expose service-role keys;
- expose unrestricted database queries;
- use client-side role checks as the only protection;
- allow direct updates to approval/status columns;
- allow users to edit approved financial values from the browser.

## 11. Session and browser protections

Use:

- secure HTTPS in production;
- secure cookie/session configuration;
- appropriate SameSite settings;
- Content Security Policy where practical;
- frame protection;
- safe referrer policy;
- no sensitive data in URL query strings;
- automatic logout/reauthentication for sensitive administrative actions where required.

## 12. Frontend audit visibility

Every transaction page should provide a timeline:

```text
09:15  Instruction received
09:21  Signature verified
09:32  Customer confirmed
09:38  Investment verified
09:44  Voucher created
10:01  Treasury approved
10:14  Head Treasury approved
...
```

The timeline is read-only from the frontend.

## Frontend security principle

The frontend should make the SOP workflow obvious, constrained, and auditable.

But:

> **Frontend security controls improve the user experience; Supabase/PostgreSQL security controls enforce authorization.**
