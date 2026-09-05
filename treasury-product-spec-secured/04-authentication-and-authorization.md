# Authentication and Authorization

## Authentication

Use Supabase Auth.

Recommended flow:

1.  User signs in.
2.  Supabase creates authenticated session.
3.  Next.js server validates the session.
4.  Application loads profile and roles.
5.  Route/page access is determined by role.
6.  Database operations are enforced again by RLS.

Frontend route protection is a convenience. **RLS is the actual security
boundary.**

## Internal staff roles

### Account Officer

Can:

-   initiate customer confirmation;
-   record confirmation;
-   view transactions assigned to the role;
-   view customer information needed for confirmation.

Cannot:

-   approve Treasury;
-   approve Head Treasury;
-   approve MIS;
-   approve Audit;
-   approve MD;
-   execute Operations.

### Treasury Officer

Can:

-   create/review treasury transactions;
-   verify signatures;
-   verify investments;
-   prepare vouchers;
-   perform Treasury approval;
-   confirm completed transactions.

### Head Treasury

Can:

-   review and approve transactions at Head Treasury stage.

### MIS

Can:

-   review and approve at MIS stage.

### Audit

Can:

-   review controls;
-   approve at Audit stage;
-   inspect audit history.

### MD

Can:

-   approve at MD stage.

### Operations

Can:

-   process approved transactions;
-   record execution;
-   attach external execution reference;
-   mark execution result.

### Admin

Can manage system configuration and users but should not automatically
gain the ability to perform every financial approval unless explicitly
assigned.

## Approval segregation

The system should prevent an approver from approving a stage if:

-   the required prior stage is not complete;
-   the transaction is already rejected/cancelled/completed;
-   the user does not have the required role;
-   the user is not eligible for that approval stage.

Where the organization requires maker-checker segregation, the system
should also prevent the transaction creator from approving a controlled
approval stage.

## RLS principle

Every table containing financial or customer data should have RLS
enabled.

Do not rely on:

``` text
if (user.role === "ADMIN")
```

in the browser.

Enforce permissions using Supabase/PostgreSQL policies and secure
server-side operations.

## Server-only credentials

The Supabase service-role key must never be exposed to the browser.

Use it only in trusted server environments when an operation genuinely
requires elevated privileges, and prefer narrowly scoped PostgreSQL
functions/RPCs with RLS-compatible design.
