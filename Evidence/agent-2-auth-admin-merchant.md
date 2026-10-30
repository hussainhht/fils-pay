# Agent 2 — Auth / Admin / Merchant

Baseline HEAD: d6e6bbbb03b6bf45ef45163c55f20dea6cc16fca
Current HEAD and working tree: d6e6bbbb03b6bf45ef45163c55f20dea6cc16fca; baseline status clean. Current tree has Agent 2 changes listed below, plus concurrent payment files `apps/api/src/payments/capture.ts`, `apps/api/src/routes/transactions.test.ts` and evidence files from Agents 1 and 3; those were not edited by Agent 2. No commit made.

## Baseline confirmed defects
| ID | Priority | Current code file:line | Reproduction / failed test | Before status |
|---|---|---|---|---|
| BUG-004 (remaining coverage) | P0 | `apps/api/src/routes/reporting.ts:52`, `apps/api/src/auth/requireMerchantAuth.ts:85` | Baseline saved-filter POST used only merchant auth, accepting a live impersonation grant; other role/writer-gated writes were already denied. | confirmed_current, static |
| BUG-019 | P1 | `apps/api/src/reporting/scope.ts:12` | Baseline query accepted any existing split child without checking caller parent. | confirmed_current, static |
| BUG-020 | P1 | `apps/api/src/routes/reporting.ts:79` | Baseline export-summary had no auth hook and dereferenced missing context; speculative identity reuse is not established. | confirmed_current, static |
| BUG-022 (prefix) | P1 | `apps/api/src/paymentLinks/read.ts:35` | Baseline public query exposed active key prefix; hash was already replaced with NULL at HEAD. | confirmed_current, partial; hash claim stale |
| BUG-039 | P1 | `apps/api/src/admin/apiKeys.ts:30` | Baseline rotation issued successor but did not revoke the locked predecessor. | confirmed_current, static |
| BUG-040 | P1 | `apps/api/src/admin/creditApproval.ts:11` | Baseline compared display names instead of IDs; same ID with changed name passes and distinct IDs with same name fail. | confirmed_current, static |
| BUG-041 | P1 | `apps/api/src/routes/adminCredits.ts:63` | Baseline create route had session hook only; under-threshold credit can post immediately. | confirmed_current, static |
| BUG-042 | P1 | `apps/api/src/admin/bulkKyc.ts:26` | Baseline UPDATE had no onboarding-state predicate or per-merchant review row. | confirmed_current, static |

## Policy and role/tenant permission matrix
Sources: `docs/ARCHITECTURE.md` security/admin plane, `docs/HANDOVER.md` impersonation/credit identity, `docs/ADMIN.md` bulk review, and route guards. Merchant roles are owner, finance, support; admin roles support, finance, super_admin. API keys have merchant authority according to `requireMerchantRole`.

| Actor | Merchant reads | Merchant writes | Credits | Bulk KYC |
|---|---|---|---|---|
| Anonymous / pending OTP | deny protected | deny | deny | deny |
| Active merchant session | own tenant; permitted split child for reports | route-specific owner/finance/support rules | deny | deny |
| Pending onboarding, active account | onboarding access required; other policy needs verification | route-specific; live processing approval policy needs verification | deny | deny |
| Suspended merchant session/key | deny | deny | deny | deny |
| Support admin | admin read; may start impersonation | impersonation read-only | queue read, create/approve/reject deny | deny |
| Finance / super_admin | admin read; may impersonate read-only | merchant impersonation deny | create/approve/reject, distinct approver ID for dual control | under_review only |
| Foreign merchant | own tenant and authorized children only | deny foreign resources | deny | deny |

## Implemented fixes
Integration and runtime status for all changes below: **BLOCKED**, no disposable migrated Postgres configured. A source edit alone is not counted as a verified fix.

| ID | Root cause | Exact files changed | Regression test | Test result | Runtime result |
|---|---|---|---|---|---|
| BUG-004 | auth-only POST accepted grant | `apps/api/src/auth/requireMerchantAuth.ts`, `apps/api/src/auth/geminiMerchantIsolation.reg.test.ts` | saved-filter POST denied and GET allowed | DB suite blocked | BLOCKED |
| BUG-019 | child lookup lacked parent | `apps/api/src/reporting/scope.ts`, `apps/api/src/reporting/scope.new.test.ts` | own/foreign child and predicate | isolated mock passed; DB blocked | BLOCKED |
| BUG-020 | missing hook | `apps/api/src/routes/reporting.ts` | existing auth route checks need DB; add export-specific positive/negative integration proof | BLOCKED | BLOCKED |
| BUG-022 | key prefix in public DTO | `apps/api/src/paymentLinks/read.ts`, `apps/api/src/routes/paymentLinks.test.ts` | response excludes both key fields | DB suite blocked | BLOCKED |
| BUG-039 | predecessor not revoked | `apps/api/src/admin/apiKeys.ts` | existing rotation suite needs explicit old/new verification | BLOCKED | BLOCKED |
| BUG-040 | display name used as identity | `apps/api/src/admin/creditApproval.ts`, `apps/api/src/admin/creditApproval.test.ts` | same ID/different name denied; different IDs/same name allowed | unit passed; DB flow blocked | BLOCKED |
| BUG-041 | create had no role gate | `apps/api/src/routes/adminCredits.ts`, `apps/api/src/routes/adminCredits.test.ts` | support denied without credit, existing finance positive | DB suite blocked | BLOCKED |
| BUG-042 | unguarded bulk update skipped review | `apps/api/src/admin/bulkKyc.ts`, `apps/api/src/routes/adminMerchantsBulk.ts`, `apps/api/src/routes/admin.test.ts` | pending skipped, reviewed approved with reviewer record | DB suite blocked | BLOCKED |

Commands: `npm.cmd run typecheck -w @filspay/api` passed. `npx.cmd tsx --test apps/api/src/admin/creditApproval.test.ts apps/api/src/reporting/scope.new.test.ts` passed 4/4; scope test uses a mock and does not prove database behavior. `npx.cmd tsx --test apps/api/src/routes/adminCredits.test.ts apps/api/src/routes/admin.test.ts apps/api/src/auth/geminiMerchantIsolation.reg.test.ts apps/api/src/routes/paymentLinks.test.ts` failed at suite initialization: DATABASE_URL is unset. `docker version` failed because Docker is not installed/on PATH. No external payment calls or production data used. `git diff --check` passed. First `npx` attempt was blocked by PowerShell execution policy; `npx.cmd` works.

## Still open / stale / duplicates / environment-blocked
| ID | Status | Why | Owner or blocker |
|---|---|---|---|
| BUG-001/002/015/016/017/029 OTP | stale_or_fixed per current code and prior wave evidence | Session requires authenticated and active merchant; tests/runtime not rerun here | DB prerequisite |
| BUG-003 | stale_or_fixed for reported predicate | `processRefund.ts:125` scopes by merchant; full refund safety remains separate | Agent 3 |
| BUG-018 | stale_or_fixed for reported predicate | HEAD `paymentLinks/cancel.ts:16,26` scopes update and lookup | Agent 3 / DB regression |
| BUG-004/019/020/022/039/040/041/042 | unverified_blocked after edits | Focused integration and runtime proof unavailable; BUG-004 remains P0 until verified | disposable migrated Postgres |
| Pending vs approved live-transaction policy | unverified_blocked | Active status and onboarding status are separate; route-by-route intended behavior and runtime need review | Agent 3 / DB |
| Remaining auth/admin reports and logout/OTP replay matrix | unverified_blocked | Not comprehensively verified during this pass | DB and further audit |

## Handoffs to Agent 1 / Agent 3
Agent 1: provide a disposable migrated PostgreSQL instance and safe fixtures, then run the DB-backed suites and HTTP checks; do not use existing production data. Agent 3: retain tenant predicates for refunds (`apps/api/src/payments/processRefund.ts:125`) and link cancellation (`apps/api/src/paymentLinks/cancel.ts:16,26`), test foreign and own tenant through HTTP, and verify pending/approved access policy on money routes. Impersonation must never mutate, including newly added money routes. Concurrent modifications in the payment files were not reviewed or changed here.

## Summary for final bug-delta report
- Confirmed distinct baseline defects in this domain: 8 (including remaining BUG-004 saved-filter write and BUG-022 prefix; hash subclaim stale)
- Verified fixed: 0 (unit-only proof for BUG-040 and mock-only proof for BUG-019 do not meet integration requirement)
- Still confirmed open: 8 pending integration verification of edits
- Newly discovered and confirmed: 1 remaining BUG-004 write path, counted under BUG-004 above
- Unverified/blocked: 8 edited defects plus unreviewed scope; no claim of exhaustive coverage
