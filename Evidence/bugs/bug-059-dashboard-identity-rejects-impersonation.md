# BUG-059 — Merchant Dashboard Bootstrap Endpoint Rejects Valid Impersonation Grants

**Fixed (2026-10-30):** apps/api/src/auth/middleware.ts — GET /v1/auth/me accepts a live impersonation grant and prefers it over a merchant session; the dashboard treats that identity as signed in.

Hosted runtime before this fix (2026-10-30): after “View as merchant” on Alpha Retail, the admin banner said the dashboard was acting as that merchant’s support user. The opened tab’s `GET /v1/auth/me` still returned `owner@alpharetail.example`, role `owner`, and the nav still included Webhooks. An existing owner `fp_sid` kept the identity. Impersonation was then exited.

## 1. Summary

Dashboard bootstrap uses /v1/auth/me, whose requireSession hook reads only fp_sid. Impersonation creates fp_impersonation instead. Merchant data routes accept that grant, but the identity bootstrap does not.

## 2. Classification

- Severity: Medium
- Confidence: High
- Verification Status: STATICALLY CONFIRMED
- Category: Authentication and sessions
- Affected Component: apps/api/src/routes/auth.ts, apps/web/src/auth/DashboardAuthContext.tsx
- Reachability: Reachable when opening merchant dashboard under impersonation
- Original Contributors / Sources: Blind spot investigation BUG-006

## 3. Root Cause

Dashboard bootstrap uses /v1/auth/me, whose requireSession hook reads only fp_sid. Impersonation creates fp_impersonation instead. Merchant data routes accept that grant, but the identity bootstrap does not.

## 4. Affected Files and Functions

`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:199-214`; `apps/api/src/routes/adminMerchants.ts:339-359`; `apps/web/src/auth/DashboardAuthContext.tsx:62-77`; `apps/web/src/auth/RequireDashboardAuth.tsx:28-34`; `apps/api/src/routes/auth.ts:255-288`; `apps/api/src/auth/middleware.ts:30-42`; `apps/api/src/auth/requireMerchantAuth.ts:85-97`.

## 5. Expected Behavior

A valid grant initializes the target merchant dashboard without a merchant password session.

## 6. Actual Behavior

Without fp_sid, /auth/me rejects the request, the context marks the visitor anonymous and the guard redirects to login. An existing merchant session instead continues selecting that merchant, not the granted identity.

## 7. Trigger Conditions

Start a valid admin impersonation grant and manually visit /dashboard/transactions with only admin and impersonation cookies. The separate default landing URL obstacle is BUG-007.

## 8. Technical Evidence

Admin start sets only config.impersonationCookieName. /auth/me uses `preHandler: requireSession`, which reads config.cookieName only. DashboardAuthContext catches all bootstrap failures and sets anonymous. requireMerchantAuth independently contains a grant fallback.

### Technical Analysis
The source path and concrete input/ordering conditions above establish the result statically. Client controls are not treated as server authorization boundaries.

## 9. Runtime Evidence

Hosted preview, 2026-10-30. Super-admin started impersonation for Alpha Retail. Admin copy: “Merchant screens in the dashboard are acting with this merchant's least-privileged (support) role.” The new tab at `http://localhost:5173/dashboard/transactions` answered `/v1/auth/me` with role `owner` and email `owner@alpharetail.example`. Webhooks and Reconciliation stayed in the nav. Grant was exited from the admin banner.

## 10. Security / Financial / Functional Impact

The intended view-as-merchant dashboard cannot initialize from its own credential. This does not remove grants' known backend write authority.

## 11. Safe Reproduction

No tracked admin frontend test exercises bootstrap after grant creation. Future test: grant-only browser state initializes /dashboard and renders the granted merchant.

## 12. Related Findings

CODE-007/FINDING-014 concern write authority, not identity bootstrap. Prior findings/runtime artifacts contain no matching demonstration.

## 13. Documentation Contradictions

The observed implementation contradicts the expected contract or architectural guarantees.

## 14. Recommended Remediation

Use a consistent identity contract for supported dashboard actors and expose impersonation explicitly. No fix implemented.

## 15. Remaining Questions and Limitations

No browser execution; deployment-specific SSO/overrides were not established.

## 16. Original Reports Merged

`bug-6-dashboard-identity-rejects-impersonation.md`

## 17. Evidence References

Exact source locations above; prior source, documentation, runtime and forensic reports and bug registry searched for duplicates before allocation. Source comments are leads, not proof.
