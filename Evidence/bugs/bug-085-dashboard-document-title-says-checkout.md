# BUG-085 — Merchant Dashboard Document Title Says Checkout

**Open. Hosted runtime (2026-10-30):** every merchant screen, including login, transactions, settlement, and the public checkout, has `document.title` `FilsPay Checkout`.

## 1. Summary

`apps/web/index.html` hardcodes one title for the whole Vite app. Dashboard routes never set their own title.

## 2. Classification

- Severity: Low
- Confidence: High
- Verification Status: RUNTIME REPRODUCED
- Category: Frontend
- Affected Component: apps/web/index.html
- Reachability: Every page served by apps/web
- Original Contributors / Sources: Hosted preview, 2026-10-30

## 3. Root Cause

The HTML title was written for the checkout page and left as the document title for the dashboard shell. An in-file comment records that, and no route updates `document.title`.

## 4. Affected Files and Functions

- `apps/web/index.html` — `<title>FilsPay Checkout</title>`
- `apps/web/src/router.tsx` — dashboard and `/pay/:token` share this document

## 5. Expected Behavior

Merchant login and dashboard screens use a dashboard title. The public pay page can keep a checkout title.

## 6. Actual Behavior

Browser title stays `FilsPay Checkout` on `/dashboard/login`, `/dashboard/transactions`, `/dashboard/settlement`, and `/pay/:token`.

## 7. Trigger Conditions

Open any route in `apps/web`.

## 8. Technical Evidence

```html
<!-- am: title says Checkout but this is the whole dashboard too -->
<title>FilsPay Checkout</title>
```

No `document.title` assignment exists under `apps/web/src`.

## 9. Runtime Evidence

Hosted preview, 2026-10-30. Page title was `FilsPay Checkout` on `http://localhost:5173/dashboard/login`, `/dashboard/transactions`, `/dashboard/settlement/317d557d-aa82-47ab-a372-220e31701ef9`, and `/pay/plink_IryLiGv5BKsZGEpBuWadUK`. Admin at `http://localhost:5174/login` is a separate app and titled `FilsPay Admin`.

## 10. Security / Financial / Functional Impact

Operators cannot tell dashboard tabs from checkout tabs. No money movement.

## 11. Safe Reproduction

Open the merchant preview and read `document.title` on a dashboard route.

## 12. Related Findings

None in BUG-001 through BUG-084. Admin uses `apps/admin/index.html`.

## 13. Documentation Contradictions

The HTML comment says the title is wrong for the dashboard. The title is unchanged.

## 14. Recommended Remediation

Set the dashboard document title in the merchant shell, and leave `FilsPay Checkout` on `/pay/:token` only.

## 15. Remaining Questions and Limitations

None.

## 16. Original Reports Merged

None. Filed from the hosted preview on 2026-10-30.

## 17. Evidence References

`apps/web/index.html`. Hosted preview on `localhost:5173`.
