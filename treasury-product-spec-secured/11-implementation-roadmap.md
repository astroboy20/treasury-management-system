# Implementation Roadmap

## Phase 1 --- Foundation

Build:

-   Next.js project;
-   Supabase project;
-   Auth;
-   profiles;
-   roles;
-   user_roles;
-   base RLS;
-   application shell;
-   dashboard.

Deliverable:

Users can sign in and see only their permitted application areas.

## Phase 2 --- Core treasury workflow

Build the six-step engine:

-   instruction;
-   signature verification;
-   customer confirmation;
-   investment verification;
-   voucher;
-   approval chain.

Deliverable:

One transaction can pass end-to-end through the six controls.

## Phase 3 --- Transaction scenarios

Implement in this order:

1.  Inflow
2.  Maturity termination
3.  Rollover
4.  Anniversary
5.  Pre-liquidation
6.  Third-party payment
7.  Transfer Slip
8.  Savings/Call/CMS Funds-Out
9.  Reversal

This order starts with simpler flows and progressively adds branching
logic.

## Phase 4 --- Operations

Build:

-   Operations queue;
-   execution screen;
-   execution reference;
-   execution result;
-   Treasury confirmation.

## Phase 5 --- Audit and reporting

Build:

-   immutable audit timeline;
-   transaction search;
-   approval history;
-   SLA monitoring;
-   daily transaction reports;
-   exception reports.

## Phase 6 --- Eazybankz integration

Start with a mock adapter.

``` text
EazybankzAdapter
  getInvestment()
  getBalance()
  getAccruedInterest()
  createInvestment()
  updateInvestment()
```

Once workflows are proven, replace the mock implementation with the real
integration.

## Phase 7 --- Production hardening

Test:

-   RLS;
-   role escalation;
-   approval bypass;
-   duplicate submissions;
-   concurrency;
-   financial calculation accuracy;
-   transaction rollback;
-   document access;
-   audit immutability.

## Recommended build strategy

Do not build every screen first.

Build one complete vertical slice:

`Rollover P+I → six steps → approvals → Operations → Treasury confirmation`

Once this works correctly, reuse the workflow engine for the other
scenarios.

## First production-quality milestone

A user should be able to:

1.  log in;
2.  create a rollover transaction;
3.  complete all six SOP controls;
4.  generate a Roll-over Slip;
5.  pass Treasury → Head Treasury → MIS → Audit → MD;
6.  send to Operations;
7.  record execution;
8.  have Treasury confirm completion;
9.  view the complete immutable audit trail.
