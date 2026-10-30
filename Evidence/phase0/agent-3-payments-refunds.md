# Phase 0 — Agent 3: Payments & Refunds

Verified on 2026-10-30 against HEAD `c389b261c7b481c2b14d12374a5511a07e67f866`.

Scope: BUG-003, BUG-005, BUG-006, BUG-007, BUG-008, BUG-018, BUG-022, BUG-023, BUG-024, BUG-025, BUG-027, BUG-028, BUG-061. Verification only; no implementation or new payment operations.

## Verification basis and execution boundaries

- Followed Phase 0 at `Evidence/bugfix_plan.md:26`, read all 13 canonical reports, and traced the registered routes through services, SQL, migrations, and existing tests. Obsolete agent instruction archives were not read.
- Initial `git status --short`: `?? Evidence/phase0/`. Git required a command-local `-c safe.directory=...` because of workspace ownership; no Git configuration was changed.
- Used static inspection and existing artifacts only. No tests, database connections, Compose services, acquirer requests, or other agents were launched. Some existing integration tests truncate tables; they were inspected, not executed.
- Existing runtime artifacts describe an isolated local PostgreSQL 16 cluster (`Evidence/runtime-artifacts/isolation.json:1`). The core probe database omitted failed migrations 0054 and 0055 (`Evidence/runtime-artifacts/session.json:59`; `Evidence/runtime-artifacts/probe-lib.mjs:14`). These are partial-schema observations, not proof of a clean application boot.
- Historical baseline hashes match current `paymentLinks/pay.ts`, `payments/capture.ts`, `payments/processRefund.ts`, `payments/void.ts`, `refunds/initiateMerchantRefund.ts`, and migration 0070 after converting current LF line endings to the baseline's CRLF. This links reused evidence to unchanged source content without repeating the operations.
- Transactions use plain `BEGIN` and the database's default isolation; the wrapper documents READ COMMITTED and does not upgrade it (`apps/api/src/db/withTransaction.ts:21`, `:28`). Locks and durable reservations must therefore be assessed individually. Deployment-specific isolation settings were not queried.

## Bug findings

### BUG-003 — Refund target ownership is not validated

- **Status:** `VERIFIED_OPEN` — dormant helper vulnerability; no implemented HTTP refund handler currently calls it.
- **Root cause:** The original cross-merchant claim still applies to the helper. `initiateMerchantRefund` checks the caller's refund hold, globally looks up the supplied transaction UUID, and passes the target's merchant ID into `processRefund`. Neither layer verifies that the transaction belongs to the caller. Matching the path merchant to the session cannot establish target ownership.
- **Current evidence:** `apps/api/src/refunds/initiateMerchantRefund.ts:21`, `:44`, `:60`, `:62`, `:71`; `apps/api/src/payments/processRefund.ts:53`, `:73`, `:131`. Independent transaction and merchant foreign keys in `db/migrations/0042_refunds.sql:16` do not enforce caller authorization or their pairing. Current HTTP handler is a stub at `apps/api/src/routes/refunds.ts:23`.
- **Existing evidence:** [Canonical report](../bugs/bug-003-cross-merchant-refund.md). `apps/api/src/refunds/initiateMerchantRefund.test.ts:117` and `:123` test path scope only; own-transaction cases start at `:128`; `:170` identifies the missing adversarial case. P006 / EVID-016 in `Evidence/runtime-artifacts/probe-results.ndjson:6` failed with 23514, so it does not prove a committed cross-merchant refund. Its helper call is at `Evidence/runtime-artifacts/probes1.mjs:29`.
- **Fix / resolution:** Scope both transaction lookups by the authenticated merchant ID, return 404 for an unowned target, and propagate that same caller identity through the processor and idempotency scope. Check the refund hold for that verified owner before reserving funds. Do not accept caller/actor identity from the body.
- **Dependencies:** Must precede BUG-027 activation; coordinate with authentication/impersonation owners for BUG-001, BUG-004, BUG-017. BUG-028 currently masks successful journaling in the historical probe; it does not repair authorization.

### BUG-005 — Client timestamp bypasses payment-link expiry

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** The public POST forwards `submittedAt` without authentication. `expiryReferenceTime` accepts any parseable client timestamp and supplies it to `expires_at > $3`; a backdated timestamp admits an expired link. Public GET uses the server clock instead.
- **Current evidence:** `apps/api/src/routes/paymentLinks.ts:155`, `:166`; `apps/api/src/paymentLinks/pay.ts:34`, `:60`, `:65`, `:73`; `apps/api/src/paymentLinks/status.ts:33`. Migration `db/migrations/0020_payment_links.sql:37` stores expiry but adds no database-time payment guard.
- **Existing evidence:** [Canonical report](../bugs/bug-005-payment-link-paid-after-expiry.md); static trace in `Evidence/FilsPay_Complete_Source_Code_Investigation.md:385`. `apps/api/src/paymentLinks/pay.test.ts:22` explicitly accepts client time; route expiry test at `apps/api/src/routes/paymentLinks.test.ts:205` omits spoofed time. The plan lists this as already proven (`Evidence/bugfix_plan.md:32`); the canonical report says static confirmation. No new runtime reproduction was attempted or claimed.
- **Fix / resolution:** Ignore client time on public checkout and evaluate expiry using authoritative server/database time in the claim predicate. Use that same reference when classifying claim failure. A separate authenticated offline protocol is optional and outside this fix.
- **Dependencies:** None for the predicate correction; coordinate retry/claim behavior with BUG-006.

### BUG-006 — Reservation timeout permits multiple captures

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** An atomic claim protects only that UPDATE. After its timeout a second request can claim the same link while the first still authorizes/captures. Different checkout keys create independent payment operations. Finalization and release check only link ID and `reserved` status, so an older request can finalize or release a newer claim; a zero-row finalization still returns 200. Capture failure releases the link without reversing the authorization.
- **Current evidence:** `apps/api/src/paymentLinks/pay.ts:65`, `:71`, `:92`, `:120`, `:128`, `:144`, `:155`, `:188`; default timeout at `apps/api/src/config.ts:247`. `db/migrations/0020_payment_links.sql:30` makes the token unique and `:49` links paid status to one stored transaction ID; neither prevents two independently created transactions/captures for one link. No reservation identity or operation uniqueness is added by subsequent migrations.
- **Existing evidence:** [Canonical report](../bugs/bug-006-payment-link-double-charge.md); P010 / EVID-020 at `Evidence/runtime-artifacts/probe-results.ndjson:10` and `Evidence/runtime-artifacts/probes1-console-2.txt:28`: responses `[200,200]`, two captures totaling 2,000 fils on a 1,000-fils link. `Evidence/runtime-artifacts/probes1.mjs:41` uses an injected acquirer barrier and ages `reserved_at` by 61 seconds; this demonstrates the reclaim window without asserting natural 60-second simulator latency. `apps/api/src/routes/paymentLinks.test.ts:293` covers sequential recovery using the SAME key, not overlapping attempts with different keys.
- **Fix / resolution:** Persist a reservation/attempt identity and bind authorization/capture to that durable link operation. Require the identity on release and finalization, check affected rows, and prevent reclaim from starting another charge until the older external result is resolved. A reservation ID alone only fences local writes; raising the timeout alone only reduces probability. Reverse a definitively uncaptured authorization before making the link payable again. A successful capture requires a refund/reconciliation path, not an authorization void; an uncertain capture outcome must be resolved before release or compensation.
- **Dependencies:** Reservation schema/operation uniqueness; BUG-024 for reversal, refund prerequisites for captured-payment compensation, BUG-061 for safe transaction boundaries. Share operation identity and recovery semantics with financial reconciliation.

### BUG-007 — Refund ceiling uses authorized amount

- **Status:** `VERIFIED_OPEN` — dormant implemented refund logic.
- **Root cause:** The claimed ceiling error remains: headroom is `amount_fils - refunded_fils`, although `captured_fils` is available. With 10,000 authorized and 4,000 captured, a 7,000-fils request passes validation, and omitted amount defaults to authorized headroom. Fee reversal can also exceed the fee basis. Partial captures retain `partially_captured` after refunds, so status does not independently stop further refunds.
- **Current evidence:** `apps/api/src/payments/processRefund.ts:86`, `:90`, `:92`, `:171`; validator at `apps/api/src/payments/refundValidation.ts:18`, `:38`; status helper at `apps/api/src/payments/refundState.ts:47`. `db/migrations/0043_transactions_refunded_fils.sql:5` constrains only nonnegative refunded totals; refund rows have positivity checks without a cumulative cap (`db/migrations/0042_refunds.sql:18`). `packages/money/src/fils.ts:260` computes a proportion without enforcing refundable headroom.
- **Existing evidence:** [Canonical report](../bugs/bug-007-refund-more-than-captured.md). P007 / EVID-017 at `Evidence/runtime-artifacts/probe-results.ndjson:7` failed during refund INSERT with 23514; it is not a completed over-refund reproduction. `apps/api/src/payments/refundValidation.test.ts:22` builds fixtures using authorized headroom; the partial-capture case at `:56` lacks an above-captured rejection. P009 at `Evidence/runtime-artifacts/probe-results.ndjson:9` independently demonstrates fee rounding: refunds `[300,300,300,100]` reverse `[8,8,8,2]`, or 26 fils against a 25-fils fee.
- **Fix / resolution:** Use captured minus successfully refunded minus pending reserved refunds as available headroom, with a locked/conditional cumulative update. Reverse only the actually retained capture-time fee, and compute each reversal as the change in cumulative entitlement so completed partial refunds sum to exactly that basis. Enforce the captured ceiling in the transaction row as a database backstop after checking existing data. These changes belong in refund orchestration; no `packages/money/` modification is necessary for this proposed fix.
- **Dependencies:** BUG-008 reservations, BUG-028 persistence/recovery, BUG-023 and BUG-032 for a consistent net fee basis; settlement/reconciliation ownership. Must precede BUG-027.

### BUG-008 — Concurrent refunds validate stale totals

- **Status:** `VERIFIED_OPEN` — dormant implemented refund logic.
- **Root cause:** Phase 1 reads the payment without a lock or pending reservation, commits, then calls the acquirer. Phase 3 writes an absolute total calculated from that old snapshot. Two distinct keys can both approve 700 fils against 1,000 captured, then each persist a total of 700 while posting separate refunds and ledger groups. Balanced groups do not establish that aggregate refunds are affordable.
- **Current evidence:** `apps/api/src/payments/processRefund.ts:52`, `:73`, `:139`, `:146`, `:153`, `:165`, `:199`; READ COMMITTED wrapper at `apps/api/src/db/withTransaction.ts:21`. Key uniqueness is only `(merchant_id, endpoint, key)` at `db/migrations/0019_idempotency_keys.sql:29`; different keys do not serialize on a payment. `db/migrations/0043_transactions_refunded_fils.sql:7` has no upper bound; `db/migrations/0042_refunds.sql:20` has no pending state or per-operation uniqueness.
- **Existing evidence:** [Canonical report](../bugs/bug-008-concurrent-refund-double-money-out.md); P008 / EVID-018 at `Evidence/runtime-artifacts/probe-results.ndjson:8` failed with 23514. Its barrier and expected lost update are visible at `Evidence/runtime-artifacts/probes1.mjs:36`, but those expected assertions are not successful runtime results. Existing sequential replay test at `apps/api/src/payments/processRefund.test.ts:287` does not establish concurrency safety.
- **Fix / resolution:** In a short transaction, lock the merchant-owned payment and reserve the amount durably against both completed and pending refunds before external I/O. Finalize the same unique operation once, re-lock/recheck, and increment the total conditionally under the captured cap. Definitive failure releases its reservation; unknown outcomes retain it for recovery. A phase-1 `FOR UPDATE` alone loses protection at commit, and a phase-3 cap alone acts after external money movement. Coordinate concurrent capture/refund/void decisions on the payment operation boundary.
- **Dependencies:** BUG-003, BUG-007, BUG-028; pending-operation storage/constraint migration; shared idempotency retry correction below. Must precede BUG-027.

### BUG-018 — Payment-link cancellation lacks target merchant scope

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** The original cancellation IDOR remains. Path ownership is checked, but the target link UPDATE and fallback SELECT accept only a UUID. An authorized caller using their own merchant path can cancel another merchant's active link. Session callers must currently pass the owner/finance role gate; the canonical phrase “any authenticated merchant” is broader than that actual route gate.
- **Current evidence:** `apps/api/src/routes/paymentLinks.ts:52`, `:100`, `:102`, `:104`; `apps/api/src/paymentLinks/cancel.ts:11`, `:14`, `:25`. The merchant foreign key at `db/migrations/0020_payment_links.sql:29` does not constrain the caller.
- **Existing evidence:** [Canonical report](../bugs/bug-018-payment-link-cancel-cross-merchant.md). `apps/api/src/routes/paymentLinks.test.ts:243` covers own-link, missing-ID, and paid-link cases; `:242` identifies absent cross-merchant coverage. No runtime evidence was needed to establish the missing predicate.
- **Fix / resolution:** Pass the verified merchant ID into `cancelPaymentLink`; add it to both UPDATE and fallback SELECT. Return 404 for unowned IDs, including non-active links, to avoid leaking their status.
- **Dependencies:** Authentication/impersonation ownership (BUG-001/004/017); otherwise independent.

### BUG-022 — Public DTO discloses API-key hash and prefix

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** The public link read selects an unrevoked API key's `key_hash` and `key_prefix`, then returns them as `merchantIntegrationId` and `merchantPublicKey`. There is no route response schema removing those fields. This proves credential metadata exposure; it does not prove recovery of a high-entropy raw key or authentication using the hash itself.
- **Current evidence:** `apps/api/src/paymentLinks/read.ts:28`, `:40`, `:44`, `:48`, `:73`; public route returns the object at `apps/api/src/routes/paymentLinks.ts:143`, `:152`. `apps/api/src/apiKeys/verify.ts:17` hashes the supplied raw bearer key before lookup.
- **Existing evidence:** [Canonical report](../bugs/bug-022-payment-link-leaks-api-key-hash.md); hosted-read happy path at `apps/api/src/routes/paymentLinks.test.ts:116` does not establish that these fields are absent. Canonical offline-cracking impact is a potential consequence, not a demonstrated exploit.
- **Fix / resolution:** Remove the API-key join and both fields from the public DTO/row mapping. Use a separate noncredential integration identifier only if a demonstrated product requirement needs one.
- **Dependencies:** Public API/client DTO compatibility check; no financial or schema change needed for removal.

### BUG-023 — Hosted checkout omits negotiated fee adjustment

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** The original path mismatch remains. Only the registered transactions HTTP route invokes `applyCaptureDiscountAdjustment`, after capture commits. Hosted checkout calls `captureTransaction` directly. Capture applies the effective MDR and volume tier, but never invokes negotiated discount adjustment. The comment claiming a July move into capture is contradicted by executable code.
- **Current evidence:** `apps/api/src/paymentLinks/pay.ts:114`, `:121`; `apps/api/src/routes/transactions.ts:100`, `:110`; `apps/api/src/payments/capture.ts:167`, `:196`, `:262`; `apps/api/src/payments/discountAdjustment.ts:34`, `:38`, `:73`, `:77`.
- **Existing evidence:** [Canonical report](../bugs/bug-023-discount-skipped-for-payment-links.md). Helper tests at `apps/api/src/payments/discountAdjustment.test.ts:65` and `:114` test direct adjustment/replay, not hosted checkout. The helper's event-count guard at `apps/api/src/payments/discountAdjustment.ts:53` does not prove per-capture identity or correct treatment of zero adjustments (related BUG-026).
- **Fix / resolution:** Use one capture finalization service/client transaction for capture state, the negotiated adjustment, ledger, and events, so all callers receive the same behavior. Adapt the adjustment helper to the existing client and bind adjustment to the individual capture; remove the route-only duplicate call. Simply adding a post-commit call in hosted checkout closes path omission but preserves a capture-success/discount-failure gap. Agree the fee formula before changing its calculation.
- **Dependencies:** BUG-026 event-level adjustment identity, BUG-032 TS/Go fee parity, BUG-061 finalization boundary. Refund fee reversal must subtract discounts already credited; reporting/settlement need the agreed final fee.

### BUG-024 — Void has no acquirer authorization reversal

- **Status:** `VERIFIED_OPEN` — missing external lifecycle capability, with local void implemented.
- **Root cause:** The void endpoint locks the merchant-owned payment, marks it voided, and releases local holds without any acquirer dependency. The acquirer interface and simulator do not provide reversal at all. Local release is implemented; external reversal is not. This repository uses a simulator without issuer-held-funds state, so real cardholder holds or live issuer behavior cannot be established here.
- **Current evidence:** `apps/api/src/routes/transactions.ts:120`; `apps/api/src/payments/void.ts:42`, `:45`, `:61`, `:66`, `:77`, `:87`; `apps/api/src/acquirer/types.ts:60`; simulator operation implementations at `apps/api/src/acquirer/simulator.ts:120`. Authorization creates the local seven-day hold at `apps/api/src/payments/authorize.ts:115`.
- **Existing evidence:** [Canonical report](../bugs/bug-024-void-does-not-reverse-authorization.md). `apps/api/src/routes/transactions.test.ts:162` checks local release/status only. No current test or existing artifact proves external reversal, and no live payment operation was initiated.
- **Fix / resolution:** Define an idempotent authorization-reversal operation in the acquirer contract and implementation. Reserve a reversal intent under the same payment lock used by capture; perform I/O outside the long transaction; finalize local void/release after confirmed reversal. Persist an unknown/failure state for retry/reconciliation instead of reporting completion prematurely. A capture already confirmed successful requires a refund, not this reversal.
- **Dependencies:** Acquirer integration owner, BUG-006 cleanup, BUG-061 operation coordination; webhook/reconciliation must distinguish pending reversal from completed void. Scope issuer behavior to later approved sandbox integration verification.

### BUG-025 — Capture never checks hold validity

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** Capture checks payment state and remaining authorization, but neither reads hold status/expiry nor rejects a missing hold. The janitor deletes hold rows without transitioning payments, so both aged and deleted holds leave otherwise capturable payments. The simulator capture does not validate authorization age either.
- **Current evidence:** `apps/api/src/payments/capture.ts:119`, `:135`, `:142`, `:174`, `:233`; `apps/api/src/payments/authorize.ts:115`; `scripts/expire_holds.ts:17`, `:24`, `:43`; `apps/api/src/acquirer/simulator.ts:140`. Hold status vocabulary includes `expired` (`db/migrations/0005_holds.sql:6`), while payment statuses do NOT (`db/migrations/0043_transactions_refunded_fils.sql:13`).
- **Existing evidence:** [Canonical report](../bugs/bug-025-capture-ignores-hold-expiry.md); normal full/partial capture tests at `apps/api/src/routes/transactions.test.ts:99`, `:139` do not cover expiry/missing/released holds. P001 at `Evidence/runtime-artifacts/probe-results.ndjson:1` separately proves the empty-selection destructive janitor defect (BUG-013); it is not a runtime capture-expiry test.
- **Fix / resolution:** Before issuing capture, require the matching merchant/payment hold to exist, be active, and remain unexpired according to authoritative time; serialize this decision with capture/void/expiry processing. Change the janitor to a predicate-guarded status UPDATE preserving history (BUG-013), with coordinated locking. Reject capture from hold state without inventing a payment `expired` status; the canonical suggestion to set such a payment status needs a separate schema/lifecycle decision. Define handling for a hold that expires while an accepted capture is in flight.
- **Dependencies:** BUG-013 janitor ownership and BUG-061 operation boundary; acquirer owner for actual authorization validity/reversal semantics.

### BUG-027 — Refund API is unfinished and unsafe to activate yet

- **Status:** `VERIFIED_OPEN` — explicitly unimplemented feature, not a regression in an active refund route.
- **Root cause:** The only registered refund endpoint is authenticated `POST /v1/refunds`, whose body unconditionally returns 501. There is no merchant-scoped refund handler. Both refund helpers exist but are dormant. The drawer is entirely commented out and targets the absent merchant route.
- **Current evidence:** `apps/api/src/app.ts:64`; `apps/api/src/routes/refunds.ts:22`; `apps/api/src/refunds/initiateMerchantRefund.ts:55`; `apps/api/src/payments/processRefund.ts:40`; `apps/web/src/pages/transactions/RefundDrawer.tsx:14`, `:65`, `:69`, `:123`. Transaction serialization omits `refundedFils` at `apps/api/src/transactions/serialize.ts:21`, `:38`, despite its own documented balance calculation.
- **Existing evidence:** [Canonical report](../bugs/bug-027-refunds-route-returns-501.md). `apps/api/src/routes/transactions.test.ts:291` intentionally asserts 501; refund processor/helper tests explicitly bypass HTTP. Existing migrations and helpers establish partial infrastructure, not feature readiness.
- **Fix / resolution:** Keep the route disabled until the prerequisites below are satisfied. Then route the required public API and merchant-scoped path through the same authorized orchestration, validate inputs, require a caller-supplied idempotency header, and derive identity/actor from auth. Restore the drawer only with compatible API responses, remaining-refund limits, and a stable key for retries of the same user action. Do not copy the commented body spread or server-generated key fallback.
- **Dependencies:** BUG-003/007/008/028, valid migrations (BUG-014), auth/impersonation safeguards, capture fee parity, settlement/payout/reconciliation integration, refund webhook envelope/eligibility plus BUG-045, reporting BUG-052/074 and summary correctness. No route/helper implementation was performed in this phase.

### BUG-028 — Missing reason aborts refund journal and strands claim

- **Status:** `VERIFIED_OPEN` — dormant helper; historical SQL failure reproduced, permanent claim consequence also established statically.
- **Root cause:** Phase 1 commits the idempotency claim, the acquirer runs, then phase 3 explicitly inserts NULL for omitted `reason`. Migration 0070 rejects new NULL values even though the column has a default and the constraint is `NOT VALID`. Rollback removes all phase-3 journal/state/event writes but cannot roll back the earlier acquirer result or committed claim. No outer recovery updates that claim, and no stale-claim sweeper exists in `scripts/`.
- **Current evidence:** `apps/api/src/payments/processRefund.ts:52`, `:139`, `:146`, `:153`, `:189`, `:271`; `db/migrations/0070_refund_reason_default.sql:6`, `:8`; `apps/api/src/db/withTransaction.ts:33`; `apps/api/src/payments/idempotency.ts:170`, `:178`. Completed/failed claim writes at `:188` and `:213` are not exception handlers for the failed phase-3 transaction.
- **Existing evidence:** [Canonical report](../bugs/bug-028-refund-null-reason-sticks-idempotency-key.md). P006–P008 / EVID-016–018 at `Evidence/runtime-artifacts/probe-results.ndjson:6`, `:7`, `:8` and `Evidence/runtime-artifacts/probes1-console-2.txt:20` record 23514 on the reason constraint. Existing successful-refund tests omit reason, e.g. `apps/api/src/payments/processRefund.test.ts:183`, and historical test output also records 23514 (`Evidence/runtime-artifacts/ts-original-tests.txt:1274`). These artifacts prove INSERT failures, not a dedicated retry-after-crash recovery experiment.
- **Fix / resolution:** Normalize/validate reason before any external request and consistently insert a nonnull value such as `unspecified`. Persist the external operation identity and a recoverable outcome before attempting journal finalization. After approval plus database failure, retry only finalization or reconcile/query the same external operation. Do NOT blindly mark the claim `failed`: current retry increments `attempt_count`, changes the external key, and can issue a second refund. Time-based cleanup alone is similarly unsafe for unknown outcomes.
- **Dependencies:** BUG-008 durable reservation/finalization boundary; idempotency retry correction; financial reconciliation and acquirer outcome recovery. Must precede BUG-027.

### BUG-061 — Capture retains database transaction during acquirer latency

- **Status:** `VERIFIED_OPEN`.
- **Root cause:** Capture holds one checked-out connection and the payment row's `FOR UPDATE` lock while awaiting acquirer capture and all subsequent local journaling. Authorization also retains a connection/transaction during acquirer authorization, though it has not yet inserted/locked a payment row. These boundaries serialize competing local capture/void writes, but cannot make acquirer approval and database commit atomic.
- **Current evidence:** `apps/api/src/payments/capture.ts:94`, `:119`, `:174`, `:200`, `:262`; `apps/api/src/payments/authorize.ts:57`, `:93`, `:102`; `apps/api/src/db/withTransaction.ts:26`, `:31`, `:38`. Default pool size 5 and connection acquisition timeout 5,000 ms at `apps/api/src/config.ts:202`, `:205`, applied at `apps/api/src/db/pool.ts:15`.
- **Existing evidence:** [Canonical report](../bugs/bug-061-capture-holds-db-txn-across-acquirer.md). Existing capture/replay tests at `apps/api/src/routes/transactions.test.ts:99`, `:193` do not test slow-acquirer pool contention or approval-then-commit failure. The source proves the transaction duration; no new load-test result is claimed. Ordinary MVCC SELECTs are not blocked by this row lock; competing writers/locking reads are. The canonical wording implying both authorize and capture lock an existing payment row is overbroad.
- **Fix / resolution:** Use short transactions to reserve one durable capture operation under payment/hold locks, perform external I/O outside them, then atomically finalize that same operation with amount/state, fee/discount ledger, timeline, outbox, and idempotency completion. Protect outstanding capture headroom and coordinate void/refund operations during the gap. Persist approval/unknown outcome recovery and an external idempotency identity. Merely moving `await acquirer.capture` outside the transaction recreates BUG-008's race pattern; increasing the pool size does not fix the boundary.
- **Dependencies:** Shared payment-operation design with BUG-006/008/024/025 and BUG-023 discount finalization; acquirer and reconciliation owners. Capture request hashing also omits transaction ID (`apps/api/src/payments/capture.ts:92`, related BUG-021), so bind operation identity to the target when reviewing this boundary.

## Final verification summary

### HEAD and working-tree state

- HEAD: `c389b261c7b481c2b14d12374a5511a07e67f866`.
- Initial and final short status: `?? Evidence/phase0/`; final detailed status additionally identifies this new report among the pre-existing phase reports. No tracked-file changes were made. Sole file written by this verification: `Evidence/phase0/agent-3-payments-refunds.md`.
- No code, tests, financial logic, schemas, migrations, canonical reports, planning files, or `packages/money/` files were modified. No branch/commit/push action occurred.

### Bug status summary

| Bug | Primary status | Current reachability / qualification |
|---|---|---|
| BUG-003 | VERIFIED_OPEN | Dormant refund helper; target ownership missing |
| BUG-005 | VERIFIED_OPEN | Public payment-link pay; client-controlled expiry clock |
| BUG-006 | VERIFIED_OPEN | Public checkout; timeout reclaim with distinct attempts |
| BUG-007 | VERIFIED_OPEN | Dormant refund helper; authorized ceiling, fee over-reversal |
| BUG-008 | VERIFIED_OPEN | Dormant refund helper; missing pending amount and stale update |
| BUG-018 | VERIFIED_OPEN | Merchant cancellation; target scope absent despite path/role gate |
| BUG-022 | VERIFIED_OPEN | Public GET returns API-key hash/prefix |
| BUG-023 | VERIFIED_OPEN | Hosted capture skips negotiated adjustment |
| BUG-024 | VERIFIED_OPEN | Local void implemented; acquirer reversal capability absent |
| BUG-025 | VERIFIED_OPEN | Active capture path ignores hold state/expiry |
| BUG-027 | VERIFIED_OPEN | Planned refund feature remains a 501 stub |
| BUG-028 | VERIFIED_OPEN | Dormant helper; reason constraint failure and stranded claim |
| BUG-061 | VERIFIED_OPEN | Active capture/authorize retain DB resources across I/O |

Totals: **13 VERIFIED_OPEN; 0 ALREADY_FIXED; 0 FALSE_POSITIVE; 0 whole reports classified STALE_REPORT; 0 NEEDS_RUNTIME; 0 INCONCLUSIVE.** Static proof suffices for the defects; remaining runtime coverage below limits claims about deployment impact and future fixes.

Outdated/contradictory portions, recorded here only:

- BUG-003/008 reachability wording must not imply a currently active HTTP refund implementation; BUG-027 still blocks it. P006–P008 expected assertions and prose are not successful reproductions: their recorded results are `FAILED ATTEMPT` on BUG-028.
- BUG-006's reservation-ID/longer-timeout recommendation is insufficient by itself to prevent external duplicate charges. Its successful-capture compensation must use refund/reconciliation rather than an authorization void.
- BUG-025's proposed payment `expired` status is absent from current CHECK constraints. Preserve hold history and enforce eligibility without an invalid status write.
- BUG-028's suggestion to simply mark phase-3 failures retryable is unsafe after external success. “Prepare the ledger transaction” cannot guarantee that a later commit succeeds after money moves.
- BUG-061 needs the authorize/capture lock distinction above; ordinary reads remain available. BUG-022 proves disclosure, not cracking.
- Comments that discount moved into capture, NULL `refunds_enabled` disables refunds, the idempotency sweeper exists, or adding only a webhook type completes delivery are contradicted by source. `assertRefundsNotOnHold` blocks only explicit false (`apps/api/src/refunds/initiateMerchantRefund.ts:50`); a launch gate must not rely on NULL being disabled.

### Recommended fix order

1. Infrastructure owner restores a valid migration path (BUG-014; existing clean-boot blockers 0054/0055 and incorrect 0072 join), while auth owners address BUG-001/004/017. These block reliable integrated verification and safe write authorization.
2. Apply independent exposure/ownership predicates: BUG-005, BUG-018, BUG-022. Establish capture-time fee/discount parity (BUG-023 with BUG-026/032) for accurate refund bases.
3. Define durable external-operation identity and recovery, then coordinate payment-link reservation fencing (BUG-006), reversal (BUG-024), hold validity/janitor (BUG-025/013), and short capture finalization transactions (BUG-061). Do not remove locks before durable reservations exist.
4. Repair dormant refund ownership, amount/fee limits, pending reservations, retry claiming, and reason/recovery handling (BUG-003/007/008/028). Keep HTTP disabled during this work.
5. Complete settlement/payout/reconciliation, webhook, reporting, DTO, and UI contracts below. Validate the corrected helpers and failure recovery in an isolated environment; only then activate BUG-027 and the drawer.

### Confirmed refund prerequisites before route activation

| Required boundary | What exists | Confirmed missing prerequisite / smallest necessary capability |
|---|---|---|
| Caller and target authorization | Path-scope helper; explicit merchant hold switch | Target merchant predicate in entry point AND processor; caller identity preserved; role/impersonation enforcement at the actual route. Authentication alone supplies no write-role decision (`apps/api/src/auth/requireMerchantAuth.ts:46`, `:129`, `:149`). |
| Available refund amount | Positive/status validation | Captured-based remaining amount including pending reservations; database backstop for cumulative successful refunds; reject exhausted partial captures regardless of status. |
| Concurrent processing | Two local transactions; endpoint-key uniqueness | Persisted pending refund intent/amount before I/O, serialized with other payment operations, one successful finalization per operation, conditional cumulative increment. Existing `refunds.status` allows only succeeded/failed and stores no idempotency-operation link (`db/migrations/0042_refunds.sql:14`). Equivalent durable storage and uniqueness must be added; a specific table name is optional. |
| Idempotency/retries | Canonical request hash includes refund transaction ID, amount, reason; unique key; completed replay | Atomic failed-to-in-progress claim: current `apps/api/src/payments/idempotency.ts:135` reads without a row lock and `:158` updates by ID without a status/attempt predicate. Two retry callers can read failed and both proceed. Lock the claim or use compare-and-set. Stable external operation identity and approval/unknown-outcome recovery are also required; blind expiry/deletion of claims risks duplicate refunds. |
| SQL compatibility and recovery | Reason default and constraint; phase-3 rollback | Normalize reason before I/O; durable recovery for thrown acquirer calls, crashes, or post-approval SQL/commit failures. Completed refund/idempotency/ledger/outbox must commit once together. |
| Fee and ledger correctness | Balanced gross/fee reversal legs; deferred balance trigger; capture-time fee credit lookup | Net historical fee basis after negotiated rebates, cumulative rounding/cap, exact final residual, and consistent TS/Go treatment. Current lookup sums only fee credits (`apps/api/src/payments/processRefund.ts:113`), ignoring discount debits (`apps/api/src/payments/discountAdjustment.ts:81`). Balance enforcement at `db/migrations/0007_ledger_double_entry.sql:67` cannot detect an economically excessive but balanced refund. |
| Payment state and API | Refunded total column; timeline negative delta; processor response includes total | Agree authorization-versus-refund status semantics, enforce consistent amount-derived eligibility, and return `refundedFils`/remaining balance in transaction reads. Current `refundState.ts:47` preserves capture status for partial captures while its header describes refund-derived states; current transaction DTO lacks the total. |
| Settlement and reconciliation | Refund table has unbatched index and nullable batch ID | Claim/settle each refund once, apply gross return and fee reversal to the correct payout position (including post-payout refunds), and include pending refunds in reconciliation. Current batch selection is captures only (`apps/settlement/internal/settlement/batch.go:148`, `:219`); reconciliation ledger includes refunds but pending selection excludes them (`apps/api/src/settlement/query.ts:289`, `:303`). No refund settlement consumer was found. |
| Merchant event delivery | Processor already enqueues `refund.succeeded` atomically in phase 3 | Implement webhook event/envelope mapping AND eligibility; correct signed/sent bytes; retain stable delivery identity and deduplicate external retries. Reporting requires its own consumer mapping; adding the shared EventType does not wire either consumer. |
| Reports and UI | Refund rollup helper and commented drawer | Reporting event handler/selection, reliable replay, Bahrain business dates, correct refund summary join/grain/refresh, matching API route, and stable client operation key. UI `max=capturedFils` and a new key per click are insufficient for cumulative refunds/unknown retries. |

Optional choices, distinct from those confirmed gaps: a generic operation framework versus small payment/refund-specific intent records; extra composite merchant foreign keys in denormalized tables; a separate authenticated offline-time API; cache eviction/metrics; or additional noncredential integration metadata. None substitutes for the required ownership predicates, durable reservations, operation uniqueness, and outcome recovery. The exact intent table/helper names are design choices, while their guarantees are prerequisites.

### Handoffs to webhook, reporting, and financial owners

- **Webhook owner:** `refund.succeeded` already exists in `packages/events/src/outbox.ts:13` and is emitted at `apps/api/src/payments/processRefund.ts:245`. It is absent from `WEBHOOK_ELIGIBLE_EVENT_TYPES` (`apps/api/src/webhooks/dispatcher.ts:28`) and the envelope union/switch (`apps/api/src/webhooks/envelope.ts:9`, `:42`, `:81`). Add both together. Define the envelope using refund ID plus transaction ID, merchant, amount, fee reversed, totals, and resulting state; distinguish multiple refunds on the same transaction using refund/operation identity. Do not impose a blanket unique `(event_type, aggregate_id)` on these events: the aggregate is currently the transaction and valid partial refunds repeat it. Address BUG-045 (sign at `dispatcher.ts:158`, send at `:172`) and delivery/replay ownership BUG-068/069 without using webhook delivery as a financial state transition.
- **Reporting owner:** Add refund selection AND dispatch (`apps/reporting/src/consumer/runConsumerPass.ts:9`, `apps/reporting/src/consumer/applyEvent.ts:191`); wiring only the selection reaches the throwing default. Existing `applyDailySummaryRollup` uses UTC date (`applyEvent.ts:170`), so use the agreed Bahrain business day. Resolve BUG-052 consumer serialization/replay and BUG-074 rebuild behavior before additive refund rollups are relied on. Admin rebuild currently selects capture/void events only (`apps/api/src/admin/reportingRebuild.ts:25`, `:34`). Correct 0072's `t.id = r.id` join (`db/migrations/0072_refund_merchant_summary.sql:14`) to the transaction foreign key, then address repeated `SUM(t.captured_fils)` across multiple refund rows (`:12`) at the intended report grain. A refresh mechanism is also missing: the migration comment claims worker refresh, but no `REFRESH MATERIALIZED VIEW` or runtime reference to that view was found in the reporting/settlement sources.
- **Settlement/finance/reconciliation owner:** Consume each succeeded refund exactly once using its own identity/batch linkage; agree adjustment handling before and after the original payout. Capture-only CloseBatch and current reconciliation cannot fulfill FP-300 money parity. Align actual net fees (discount/tier/effective rate), cumulative reversals, merchant payable ledger, batch figures, cache rebuild source (BUG-011), and reconciliation BUG-065/066. Existing ledger-authoritative rebuilding is available at `apps/settlement/internal/ledger/rebuild.go:23`; refund support must not fall back to a capture-only cache view. Design pending/unknown operation recovery jointly with the payment and acquirer owners.
- **Auth/infrastructure/frontend owners:** Fix pending-session, merchant-state, and impersonation write controls before exposing another money-moving endpoint. Provide a fully migrated disposable environment. Align both route contracts and transaction DTO; reuse an operation key across uncertain retries, allow partially_refunded transactions with remaining headroom, and derive UI limits from captured minus refunded amounts. These are handoffs recorded in this report only; no messages or edits to other agents' outputs were made.

### Items needing later runtime verification

These are validation gaps and future fix acceptance criteria, not reasons to downgrade the statically verified defects:

1. After migration repair, run isolated helper tests with a valid reason to distinguish BUG-003/007/008 end-to-end effects from the historical reason-constraint masking. Cover caller/target mismatch, exhausted partial captures, two distinct keys, and capture/refund overlap. Existing P006–P008 did not complete those assertions.
2. Verify missing-reason normalization, same-key concurrent retries after failed status, and crash recovery before/after acquirer approval and before/after local commit. Assert one external operation, one refund, consistent totals, balanced and economically correct ledger legs, one timeline event, and one outbox event per operation. Do not rerun already sufficient baseline failure probes merely to restate them.
3. Validate revised link operation fencing across timeout, old-request release, capture failure, ambiguous outcome, failed finalize, and compensation. Existing P010 already proves the old reclaim defect; it need not be repeated until a fix changes behavior.
4. Validate expired/missing/released holds and capture/void/janitor overlap, plus bounded pool use under a delayed injected acquirer after the boundary change. Static tracing proves the current resource hold; deployment contention rates remain unmeasured.
5. Using only a later authorized sandbox/injected acquirer, verify reversal acceptance, replay, failure, and unknown outcome. Current simulator has no issuer authorization lifecycle; no real hold-release claim is justified.
6. Verify capture discounts and refund net fee totals, including many partial refunds and final residual, across effective MDR/tier changes and hosted/direct capture. Verify same-day/post-payout settlement, reconciliation, webhook signed bytes, delivery retry identity, reporting catch-up/rebuild, Bahrain midnight, and multiple refunds of one payment.

Phase 0 verification is complete. All proposed changes remain unimplemented.
