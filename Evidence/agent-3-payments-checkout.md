# Agent 3 — Payments / Checkout / Refunds
Baseline HEAD: d6e6bbbb03b6bf45ef45163c55f20dea6cc16fca
Current HEAD and working tree: same HEAD; initial status clean. Concurrent unrelated work appeared during review; see `git status --short` for current state. No commits, production data, live payment calls, or money-package edits.

## Baseline verified bug inventory
Classification is for the specific historical claim, not a release verdict. Prior fork test artifacts are historical, not tests run in this session.

| ID | Priority | Code file:line / evidence | Before status | Reproduction |
|---|---|---|---|---|
| BUG-003 | P0 | `refunds/initiateMerchantRefund.ts:60`, `payments/processRefund.ts:126` | already_fixed_or_stale | Caller merchant checked against target; processor also scopes target. |
| BUG-005 | P0 | `paymentLinks/pay.ts:27,45` | already_fixed_or_stale | Database time governs new claims; spoofed submittedAt ignored. |
| BUG-006 | P0 | `paymentLinks/pay.ts:45,74,94`; `payments/capture.ts:187` | confirmed_current (partial) | Durable binding prevents distinct-key timeout takeover, but external approval followed by DB rollback loses the capture claim and permits another external operation on recovery; no durable approval recovery. |
| BUG-007 | P0 | `payments/processRefund.ts:144` | already_fixed_or_stale | Captured less refunded and pending defines headroom; historical fork final check covers ceiling. |
| BUG-008 | P0 | `payments/processRefund.ts:126,144,187` | already_fixed_or_stale for reported concurrent refunds | Payment row lock serializes durable pending reservations; historical fork final check covers competing refunds. Unknown-outcome recovery remains open under BUG-028. |
| BUG-018 | P0 | `paymentLinks/cancel.ts:16,26` | already_fixed_or_stale | Both update and fallback are merchant scoped. |
| BUG-021 | P1 | `payments/capture.ts:94` at baseline | confirmed_current | Same merchant/key/body on a different transaction replays first response because hash omitted target. |
| BUG-022 | P1 | `paymentLinks/read.ts:44` | already_fixed_or_stale | Public read no longer joins or returns API key hash. |
| BUG-023 | P1 | `paymentLinks/pay.ts:94`; `routes/transactions.ts` | confirmed_current (partial) | Adjustment now called for hosted checkout, but after capture commit; a failure leaves captured payment without its negotiated adjustment until recovery. |
| BUG-024 | P1 | `payments/void.ts`; `acquirer/types.ts` | confirmed_current | Void releases local hold but provider interface has no authorization reversal. |
| BUG-025 | P1 | `payments/capture.ts` at baseline; `scripts/expire_holds.ts` | confirmed_current | Baseline captures without reading hold; missing, released or expired holds do not prevent provider call. Janitor separately deletes expired rows. |
| BUG-027 | P1 | `routes/refunds.ts:79`, `config.ts:266` | confirmed_current | Refunds default to disabled (501); optional flag enables routes despite unresolved recovery and settlement prerequisites. |
| BUG-028 | P0 | `payments/processRefund.ts:187,211,241` | confirmed_current (partial) | Missing reason now defaults to unspecified; pending reservation survives unknown outcome, but approval followed by failed finalization has no safe automated resolution. |
| BUG-061 | P2 | `payments/capture.ts:96,187`, `payments/authorize.ts:57,93` | confirmed_current | Provider call occurs within DB transaction; capture retains row lock and connection. |

## Payment-state invariants checked
Authorization creates a transaction and hold. Capture requires merchant ownership, authorized/partially captured state and positive amount within remaining authorization; it locks the transaction through provider call and local ledger/outbox commit. After this patch it also locks an active unexpired hold. Full capture releases the hold; partial capture retains it. Void permits only uncaptured authorization but cannot reverse an issuer hold. Link claims require unexpired database time, bind to payer key/request, and finalize only the same bound payment. Refunds reserve captured headroom under a payment lock before provider calls and keep unknown outcomes pending; provider success and local commit still cannot be atomic. Events and local ledger are transactional within their respective finalization; external effects are not. Capture idempotency keys are merchant/endpoint scoped and now hash transaction identity as well as amount. Existing persisted capture keys hashed under the old scheme will return mismatch after deployment, including legitimate retries; operators need a safe rollout/reconciliation plan and must not delete uncertain claims.

## Implemented and verified changes
| ID | Root cause | Exact files changed | Regression test | Test result | Runtime result |
|---|---|---|---|---|---|
| BUG-021 | Capture hash omitted target ID | `apps/api/src/payments/capture.ts`, `apps/api/src/routes/transactions.test.ts` | Same key and amount against different transaction must return 422 and leave target uncaptured | API typecheck PASS; new DB test BLOCKED | BLOCKED: no disposable migrated DB |
| BUG-025 | Capture never validated hold | same files | Expired and missing holds must return 409 with no capture/ledger entries | API typecheck PASS; new DB test BLOCKED | BLOCKED: no disposable migrated DB |

Focused existing idempotency, refund validation and link-status unit tests: PASS 25/25. `git diff --check` PASS at time run. PowerShell blocked npm.ps1; npm.cmd succeeded. These unit tests do not exercise the new DB paths. Prior `Evidence/fork/fork-batch3-final-check.txt` records successful historical refund cases; it is not a current execution. No verified fixed count is claimed for new changes until their integration tests pass.

## Remaining blockers and deferred issues
| ID | Reason | Risk if released | Mitigation / disabled route | Owner |
|---|---|---|---|---|
| BUG-006, BUG-061 | Provider success can precede rollback; operation ID/approval recovery not durable; external call holds DB resources | duplicate external capture or unjournaled money, pool exhaustion | Release blocker: implement durable operation identity and provider outcome reconciliation before moving I/O outside lock | payments / acquirer |
| BUG-023 | Discount applied after capture commit | wrong net fee or incomplete checkout on failure | Atomic capture/discount finalization with per-capture identity and agreed finance basis | payments / finance |
| BUG-024 | No provider reversal capability | customer issuer hold remains after local void | Do not claim issuer reversal; implement and reconcile provider reversal before release | payments / acquirer |
| BUG-025 | Janitor deletes holds; new regression tests not executed | lost hold history; unverified patch | preserve/expire holds with concurrency tests; use disposable DB | runtime / payments |
| BUG-027, BUG-028 | Default-disabled route can be enabled by FEATURE_REFUNDS; uncertain provider outcomes lack recovery and settlement prerequisites require end-to-end verification | unjournaled refunds or incorrect payouts | Keep FEATURE_REFUNDS=false; enabling is a release blocker pending reconciliation, settlement and recovery proof | payments / finance / runtime |
| BUG-021 | Existing idempotency hashes incompatible with new hash | previously issued retries conflict, including legitimate recovery | Plan safe migration/rollout; do not blindly retry external operations or discard old keys | payments / runtime |

## Handoffs to Agents 1 and 2
Agent 1: supply an isolated fully migrated PostgreSQL instance and run `npm.cmd exec --workspace @filspay/api -- tsx --test src/routes/transactions.test.ts`, plus link, refund, concurrency and webhook suites against safe mock provider. Demonstrate checkout happy path and negative cases; do not use existing unverified database. Agent 2: verify role and impersonation policy on `routes/transactions.ts` and `routes/refunds.ts:88`; test foreign merchant capture/refund and impersonation denial. Avoid shared-file concurrent edits. No messages were sent to external parties.

## Summary for final bug-delta report
- Confirmed distinct baseline defects in this domain: 8 (BUG-006, 021, 023, 024, 025, 027, 028, 061; partial qualifications above)
- Verified fixed: 0 (two patches await DB regression execution)
- Still confirmed open: 6; 2 patched but verification blocked
- Newly discovered and confirmed: 0
- Unverified/blocked: 2 patched defects awaiting integration proof; broader runtime/recovery behavior not counted as additional defects
