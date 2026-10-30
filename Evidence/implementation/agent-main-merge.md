# Main merge and payment-link verification — 2026-10-30

**Baselines:** feature `2679bef60f265b27372905a0aad595cfa98baa39`; `origin/main` `1f88a47ee619e87728219ad531df4dc4e4cbad56`; merge base `1c3f99e0c5478e1ff616898cdfc1cd6f5283172d`. The feature worktree was clean. User explicitly authorized merging main, resolving conflicts and pushing the result to main.

**Resolution:** Retained main's responsive two-column checkout frame, order summary and sandbox disclosure; retained the feature branch's BHD/card entry validation, deadline enforcement, safe same-key retries and read-only in-flight/recovery inputs. Updated checkout CSS for both designs and corrected the browser harness to wait for the redesigned loading state. Combined independent context history and corrected obsolete checkout retry and webhook jitter-test status descriptions. `CheckoutPaymentForm.tsx` remains a separately tested main-branch component but is not used by the active checkout route.

**Files changed by conflict resolution:** `apps/web/src/pages/checkout/CheckoutPage.tsx`, `CheckoutPage.css`, `apps/web/scripts/checkout.browser.test.mjs`, `context/CHANGELOG.md`, `DECISIONS.md`, `FRONTEND.md`, `KNOWN_ISSUES.md`, `PAYMENT_FLOWS.md`, `TESTING.md`, `context/modules/apps-web.md`, and this report. Other merged files are existing commits from main and the feature branch. No migration source, protected money package or frozen partner contract was edited by this resolution. The existing main migration `0085_authenticators.sql` remains part of main; it was applied only in fresh isolated test databases during this verification. No seed, truncation, real-provider call or production migration was performed.

**Checks, Windows PowerShell / Node 22.23.2 / npm 10.9.8 / local PostgreSQL 16:**

| Command | Actual outcome |
|---|---|
| `npm.cmd run typecheck` | PASS, all workspaces, DB and scripts |
| `npm.cmd run test -w @filspay/web` | PASS: 67 tests, 0 skipped |
| `npm.cmd run build -w @filspay/web` | PASS |
| `node apps/web/scripts/checkout.browser.test.mjs` | PASS: 15 mocked Edge groups, including desktop/390px/320px, expiry, same-key retry and decline handling. Initial run hit a stale loading-state wait; the harness was corrected and rerun. |
| `node apps/web/scripts/paymentLinkAmount.browser.test.mjs` | PASS: 14 mocked Edge groups, including amount editing, expiration controls, keyboard and responsive layout |
| `npm.cmd run test -w @filspay/api` with fresh migrated `filspay_test_merge_<digits>` database | PASS: 566 tests, 0 failed, 0 skipped. The 79 existing migrations were applied to that isolated database. |

An initial API attempt without `DATABASE_URL` failed DB-dependent suites (217 passed, 54 failed, 2 skipped). A second attempt with a different isolated test database passed 564 and failed two TOTP cases because their guard requires the database name `filspay_test_*`. The final isolated database satisfied this guard; both TOTP cases passed. No tests were skipped or weakened to obtain the final result. Both fresh databases were retained without destructive cleanup.

**Issue statuses:** The previous feature-branch webhook jitter assertion failure `VERIFY-EXPIRY-01` is `fix-verified` after main's deterministic-jitter test passed in the complete API suite. Previously recorded intermittent `VERIFY-EXPIRY-02` and `VERIFY-EXPIRY-03` remain `unverified`; neither recurred in this run. `EXPIRY-01`, `AMOUNT-02`, `CHECKOUT-01` and `CHECKOUT-02` remain `fix-verified` with unit, API and mocked browser evidence as recorded in FEAT-003 and `context/KNOWN_ISSUES.md`. No historical registry counts were reassessed.

**Limits:** Browser checks mocked network/payment responses. The previously completed real browser-to-API-to-PostgreSQL creation check was not rerun against this merged source, nor were broader running-stack, physical-device, screen-reader, real-provider, settlement or reporting journeys. ADRs 0003, 0004, 0006 and HANDOVER financial-policy conflicts remain human questions; this merge makes no policy decision about them.
