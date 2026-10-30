# BUG-087 — Checkout Brand Hint Misses Mastercard BINs 2720 and Treats 2220 as Mastercard

**Fixed (2026-10-30):** `apps/web/src/utils/helpers.ts` — `formatCardBrandHint` treats a four-digit BIN from 2221 through 2720 as Mastercard. Covered by `apps/web/src/utils/helpers.new.test.ts`.

## 1. Summary

The checkout card-brand hint claims to recognize Mastercard’s 2221–2720 range, but the regular expression stops at 271 and also accepts 2220. A PAN starting with 2720 is shown as `unknown`.

## 2. Classification

- Severity: Low
- Confidence: High
- Verification Status: RUNTIME REPRODUCED
- Category: Frontend
- Affected Component: apps/web/src/utils/helpers.ts
- Reachability: Checkout page brand hint only. The value is not sent to the API and is not used for routing.
- Original Contributors / Sources: Web test run, 2026-10-30

## 3. Root Cause

`formatCardBrandHint` used `/^2(2[2-9]|[3-6]\d|7[01])/`. That matches 2220–2719. It does not match 2720, and it does match 2220, which is below the Mastercard range.

## 4. Affected Files and Functions

- `apps/web/src/utils/helpers.ts` — `formatCardBrandHint`

## 5. Expected Behavior

Visa starts with 4. Mastercard is 51–55 or BIN 2221–2720 inclusive. Amex is 34 or 37. 2220 and 2721 stay `unknown`.

## 6. Actual Behavior

`2720000000000005` returned `unknown`. `2220999999999999` matched the old expression as Mastercard.

## 7. Trigger Conditions

The shopper types a PAN whose first four digits are 2720, or 2220, on the checkout page.

## 8. Technical Evidence

The hint comment documents 2221–2720. The expression `7[01]` covers 270 and 271 only, and `2[2-9]` covers a third digit of 2, so 2220 matches.

## 9. Runtime Evidence

`npm test --workspace @filspay/web` on 2026-10-30. `helpers.new.test.ts` expected `mastercard` for `2720000000000005` and received `unknown`.

## 10. Security / Financial / Functional Impact

Cosmetic. The comment states the hint is not sent to the server and the simulated acquirer does not route on it. No money movement.

## 11. Safe Reproduction

Call `formatCardBrandHint("2720000000000005")` and `formatCardBrandHint("2220999999999999")`.

## 12. Related Findings

None in BUG-001 through BUG-086. Not the payment-link token or capture path.

## 13. Documentation Contradictions

The function comment states the range 2221–2720. The expression did not implement that range.

## 14. Recommended Remediation

Compare the first four digits as an integer with inclusive bounds 2221 and 2720. Keep 51–55 as Mastercard.

## 15. Remaining Questions and Limitations

The hint remains display-only. It does not authorize a charge.

## 16. Original Reports Merged

None. Found while running the web workspace tests on 2026-10-30.

## 17. Evidence References

`apps/web/src/utils/helpers.ts`. `apps/web/src/utils/helpers.new.test.ts`.
