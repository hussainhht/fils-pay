# BUG-071 — Dashboard Fee Display Queries Newest Created Row Instead of Effective Schedule

**Fixed (2026-10-30):** apps/api/src/fees/currentFeeScheduleDisplay.ts — selects the schedule with effective_from <= asOf, latest effective_from, then latest created_at.

**Still open. Hosted runtime (2026-10-30):** Alpha Retail admin detail shows “Current negotiated rate” `2.45%` (245 bps), effective `3/1/2026`. `fee_schedules` for that merchant has `245` bps effective `2026-03-01` created `2026-08-15`, and `225` bps effective `2026-08-01` created `2026-08-01`. The row in force on 2026-10-30 is `225` bps. The credit checkbox on the same page uses `merchants.mdr_bps` (`2.50%`); that path is [BUG-086](bug-086-credit-reversal-uses-merchant-mdr-column.md).

## 1. Summary

A backfill row created later with an earlier `effective_from` (245 bps) wins the dashboard.

## 2. Classification

- Severity: Medium
- Confidence: High
- Verification Status: STATICALLY CONFIRMED
- Category: Reporting and analytics
- Affected Component: apps/api/src/fees/currentFeeScheduleDisplay.ts
- Reachability: Reachable on merchant overview and fee settings display
- Original Contributors / Sources: Finance clue 'Dashboard 245 bps vs charged 225'

## 3. Root Cause

Display answers "most recently typed" instead of "in force now." Inline comments (Claude/MK) call this intentional.

## 4. Affected Files and Functions

- Display: `apps/api/src/fees/currentFeeScheduleDisplay.ts:32-37` — `ORDER BY created_at DESC LIMIT 1`
- Billing: `apps/api/src/fees/feeSchedule.ts` — `effective_from <= asOf ORDER BY effective_from DESC, created_at DESC`

## 5. Expected Behavior

The component should correctly enforce its intended specification, business logic, and security constraints.

## 6. Actual Behavior

A backfill row created later with an earlier `effective_from` (245 bps) wins the dashboard. Live captures still pick the 225 bps row whose `effective_from` is current.

## 7. Trigger Conditions

Execution of the affected code path under normal or edge-case operational inputs.

## 8. Technical Evidence

Source code inspection:

- Display: `apps/api/src/fees/currentFeeScheduleDisplay.ts:32-37` — `ORDER BY created_at DESC LIMIT 1`
- Billing: `apps/api/src/fees/feeSchedule.ts` — `effective_from <= asOf ORDER BY effective_from DESC, created_at DESC`

Technical details:
A backfill row created later with an earlier `effective_from` (245 bps) wins the dashboard. Live captures still pick the 225 bps row whose `effective_from` is current.

## 9. Runtime Evidence

Hosted admin merchant detail, 2026-10-30, Alpha Retail `9972daab-2c86-459f-9d78-3fe1be4e3280`. Screen text: MDR `2.50% (250 bps)`; current negotiated rate `2.45% (245 bps), effective 3/1/2026`. Database `fee_schedules`: `225` bps effective `2026-08-01` (created `2026-08-01`) and `245` bps effective `2026-03-01` (created `2026-08-15`). Display followed the later `created_at`.

## 10. Security / Financial / Functional Impact

Support quotes the wrong MDR. Merchants think they were overcharged (or undercharged).

## 11. Safe Reproduction

Review the affected code and verify behavior using an isolated test harness without modifying production data.

## 12. Related Findings

Source tag: Finance clue 'Dashboard 245 bps vs charged 225'. Legacy file: `bug-26-fee-display-wrong-schedule.md`.

## 13. Documentation Contradictions

The code implementation diverges from architectural documentation, ADR specifications, or developer comments.

## 14. Recommended Remediation

Call `getEffectiveMdrBps(..., new Date())` for display, same resolver as capture/settlement.

## 15. Remaining Questions and Limitations

None identified within the scope of static source inspection.

## 16. Original Reports Merged

`bug-26-fee-display-wrong-schedule.md`

## 17. Evidence References

`apps/api/src/fees/currentFeeScheduleDisplay.ts`, `bug-26-fee-display-wrong-schedule.md`
