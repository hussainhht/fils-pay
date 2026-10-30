# BUG-088 — Promotional Discount Parser Multiplies BD by 100

**Fixed (2026-10-30):** `parsePromotionalDiscountFils` uses `parseBhdToFils` and rejects a negative amount. Covered by `apps/api/src/payments/promotionalDiscount.new.test.ts`.

## 1. Summary

`parsePromotionalDiscountFils` parses a BD string with `parseFloat` and multiplies by 100. One dinar is 1000 fils, so every amount is ten times too small, and a fourth decimal place is rounded instead of rejected.

## 2. Classification

- Severity: High
- Confidence: High
- Verification Status: RUNTIME REPRODUCED
- Category: Ledger and financial calculations
- Affected Component: apps/api/src/payments/discountAdjustment.ts
- Reachability: Exported helper. No route calls it today.
- Original Contributors / Sources: New tests outside the existing registry, 2026-10-30

## 3. Root Cause

The function treats BD as a two-decimal currency (`Math.round(parsed * 100)`). ADR-0001 says text input goes through `parseBhdToFils`, which scales by 1000 and rejects more than three decimal places.

## 4. Affected Files and Functions

- `apps/api/src/payments/discountAdjustment.ts` — `parsePromotionalDiscountFils`

## 5. Expected Behavior

`"4.750"` is 4750 fils. `"4.755"` is 4755 fils. `"4.7555"`, a negative amount, and a non-numeric string are rejected.

## 6. Actual Behavior

`"4.750"` returned 475. `"0.5"` returned 50 instead of 500. `"4.7555"` was accepted.

## 7. Trigger Conditions

Any caller that passes a BD string into `parsePromotionalDiscountFils`.

## 8. Technical Evidence

```ts
const parsed = parseFloat(raw);
return Math.round(parsed * 100);
```

`parseFloat("4.750") * 100` is 475. `parseBhdToFils("4.750")` is 4750.

## 9. Runtime Evidence

`apps/api/src/payments/promotionalDiscount.new.test.ts` failed before the fix: expected 4750, actual 475. The extra-decimal case threw no error.

## 10. Security / Financial / Functional Impact

A 4.750 BD promotional discount would be journaled as 0.475 BD if a caller starts using this helper. No current route imports it, so no live ledger row is wrong yet.

## 11. Safe Reproduction

Call `parsePromotionalDiscountFils("4.750")` in a unit test. Do not post a ledger adjustment.

## 12. Related Findings

[BUG-009](bug-009-csv-import-10x-too-small.md) is the same 100-versus-1000 mistake on the adjustment CSV parser. This function is a separate parser.

## 13. Documentation Contradictions

The comment says the helper converts a BD string into fils. ADR-0001 requires `parseBhdToFils`.

## 14. Recommended Remediation

Parse with `parseBhdToFils` and reject a negative result.

## 15. Remaining Questions and Limitations

The helper is unused by routes. The fix removes the wrong scale before a caller is added.

## 16. Original Reports Merged

None.

## 17. Evidence References

`apps/api/src/payments/discountAdjustment.ts`, `apps/api/src/payments/promotionalDiscount.new.test.ts`, ADR-0001.
