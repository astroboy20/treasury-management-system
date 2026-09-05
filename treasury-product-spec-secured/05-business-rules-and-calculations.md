# Business Rules and Calculations

This document captures calculations explicitly stated in the SOP. Do not
silently introduce additional financial rules.

## Pre-liquidation charge

SOP rule:

`charge = accrued_interest × 20%`

Example:

Accrued interest = ₦1,500,000

`charge = ₦1,500,000 × 20% = ₦300,000`

For a full pre-liquidation:

`net_interest = accrued_interest - charge`

## Partial pre-liquidation

The SOP example states:

-   Original investment/principal = ₦10,000,000
-   Accrued interest = ₦1,500,000
-   20% charge = ₦300,000
-   Customer requests Funds-Out = ₦3,000,000
-   Remaining principal = ₦7,000,000
-   Less charge during rebooking = ₦300,000
-   Principal rebooked = ₦6,700,000

The product should reproduce these values exactly for the example.

Because the relationship between the requested payout, accrued interest,
charge deduction and rebooked principal can be interpreted differently
in other cases, the implementation should make the calculation rule
explicit and configurable rather than hard-coding assumptions outside
the SOP.

## Third-party external transfer

SOP rule:

`transfer_charge = transfer_amount × 0.10%`

Example:

₦10,000,000 × 0.10% = ₦10,000

The UI must show:

-   transfer amount;
-   transfer charge;
-   net/total impact as defined by the approved business rule.

Do not guess whether the charge is added to or deducted from the
customer's proceeds unless the business owner specifies it.

## WHT

The SOP explicitly says WHT is **not required** for:

-   maturity termination;
-   anniversary interest payment.

The product should store WHT as a field where the voucher requires it,
but default it to zero for these SOP flows.

## Anniversary frequencies

Allowed values:

-   30 days
-   60 days
-   90 days

## Rollover

For Principal + Interest:

`rollover_amount = principal + interest_due`

For Principal-only rollover:

`principal_rolled = principal`

`interest_paid = interest_due`

For partial principal rollover:

`remaining_principal = original_principal - requested_payout`

## Calculation engine design

Do not scatter formulas across React components.

Use a server-side calculation service:

``` text
calculateRollover()
calculatePreLiquidation()
calculateThirdPartyCharge()
calculateAnniversaryPayment()
calculateMaturityTermination()
```

The frontend may preview calculations, but the backend must recalculate
before saving/approving.

## Calculation snapshots

When a voucher is prepared, save the calculation inputs and outputs.

Example:

``` json
{
  "rule": "PRE_LIQUIDATION_20_PERCENT",
  "inputs": {
    "accrued_interest": 1500000
  },
  "outputs": {
    "charge": 300000,
    "net_interest": 1200000
  }
}
```

This allows Audit to understand exactly how a number was produced.
