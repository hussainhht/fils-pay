# BUG-086 — Credit Fee Reversal Uses the Merchant MDR Column, Not the Effective Schedule

**Fixed (2026-10-30):** apps/api/src/admin/credits.ts — the fee reversal passes getEffectiveMdrBps for the credit's effective date into the existing calculator.

**Open. Hosted runtime (2026-10-30):** Alpha Retail’s credit form says it will reverse MDR at `2.50%`. The fee schedule in force that day is `225` bps (`2.25%`), effective `2026-08-01`. The `2.45%` “current negotiated rate” on the same page is [BUG-071](bug-071-fee-display-wrong-schedule.md).

## 1. Summary

`createCreditRequest` loads `merchants.mdr_bps` and passes that rate to `calculateCreditFeeReversal`. It does not call the effective-schedule resolver capture and settlement use.

## 2. Classification

- Severity: High
- Confidence: High
- Verification Status: RUNTIME REPRODUCED
- Category: Admin console and controls
- Affected Component: apps/api/src/admin/credits.ts
- Reachability: Admin credit form when “reverse the MDR” is checked
- Original Contributors / Sources: Hosted preview, 2026-10-30

## 3. Root Cause

The reversal is documented in code as “the merchant's own contracted rate”, and the contracted rate is read from `merchants.mdr_bps`. Negotiated schedules live in `fee_schedules` and are resolved by `effective_from`. Alpha Retail’s column is still `250` bps. The schedule in force on 2026-10-30 is `225` bps.

## 4. Affected Files and Functions

- `apps/api/src/admin/credits.ts` — `SELECT mdr_bps FROM merchants`, then `calculateCreditFeeReversal(draft.baseAmountFils, merchant.mdr_bps)`
- `apps/api/src/admin/creditThreshold.ts` — `calculateCreditFeeReversal` applies whatever bps it is given via `applyRateFils`
- `apps/admin/src/pages/merchants/MerchantDetailPage.tsx` — checkbox label `(merchant.mdrBps / 100)`

## 5. Expected Behavior

A fee reversal uses the same MDR that is in force for that merchant on the credit’s effective date.

## 6. Actual Behavior

The admin label offers reversal at `2.50%` (250 bps). Posting `reverseFee: true` would compute the reversal from `merchants.mdr_bps`, not from the `225` bps schedule effective `2026-08-01`.

## 7. Trigger Conditions

Issue a credit with “Also reverse the MDR” checked for a merchant whose `merchants.mdr_bps` disagrees with the effective `fee_schedules` row.

## 8. Technical Evidence

```ts
const merchantResult = await client.query<{ mdr_bps: number }>(
  `SELECT mdr_bps FROM merchants WHERE id = $1`,
  [input.merchantId],
);
const feeReversalFils = draft.reverseFee
  ? calculateCreditFeeReversal(draft.baseAmountFils, merchant.mdr_bps)
  : ZERO_FILS;
```

Alpha Retail `fee_schedules` on the hosted database: `225` bps effective `2026-08-01`, and `245` bps effective `2026-03-01` created later. `merchants.mdr_bps` is `250`.

## 9. Runtime Evidence

Hosted admin, 2026-10-30, Alpha Retail detail. The credit checkbox read “Also reverse the MDR on this amount (2.50%)”. No credit was submitted. The rate on the label matches `merchants.mdr_bps`, not the in-force schedule.

## 10. Security / Financial / Functional Impact

A fee reversal on this merchant is 25 bps high versus the schedule captures use (250 vs 225). On a `50.000 BHD` credit that is `125` fils (`0.125 BHD`) too much handed back. The approval threshold uses this inflated reversal only when that comparison includes it; the in-file comment disagrees about whether the threshold includes the reversal.

## 11. Safe Reproduction

Compare `merchants.mdr_bps` with the effective `fee_schedules` row, then read the credit checkbox label. Do not submit the credit on a shared database.

## 12. Related Findings

[BUG-071](bug-071-fee-display-wrong-schedule.md) is the negotiated-rate label, which orders schedules by `created_at`. This bug is the credit poster reading `merchants.mdr_bps` instead.

## 13. Documentation Contradictions

The comment says the reversal is the contracted rate. The schedule table is what capture and settlement treat as the rate in force.

## 14. Recommended Remediation

Resolve MDR with the same effective-schedule function capture uses, at the credit’s effective date, and show that rate on the checkbox.

## 15. Remaining Questions and Limitations

No credit was posted during the hosted check, so the fils amount was not observed in `credit_requests`. The rate source is the code path above.

## 16. Original Reports Merged

None. Filed from the hosted preview on 2026-10-30.

## 17. Evidence References

`apps/api/src/admin/credits.ts`, `apps/api/src/admin/creditThreshold.ts`, `apps/admin/src/pages/merchants/MerchantDetailPage.tsx`. Hosted `fee_schedules` rows for Alpha Retail.
