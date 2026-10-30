# FilsPay Post-Merge Audit Report

Date: 2026-10-30 (Asia/Bahrain). Audited HEAD: `c3eb21830dd133a47e86bf5f9150a3ba8f9caffd`, branch `main`, matching the locally recorded `origin/main`. Remote state was not fetched.

## 1. Executive Summary

**Assessment: NOT READY for an unconditional public release; authenticated local end-to-end readiness remains UNVERIFIED.** The merge preserves substantial fixes, TypeScript typechecking passes, frontend bundles build, and 144 safe tests pass. Existing local API and frontend processes respond. These observations do not establish correct refunds, payouts, authentication delivery, or deployment of this HEAD.

This audit identifies **13 distinct current defects: one P0, six P1, five P2, and one P3**. Seven are critical under the repository's P0/P1 taxonomy. Twelve previously implemented historical fixes were verified at the explicitly stated unit/functional scope. Database-backed fixes were not promoted to verified based on source changes or old test logs.

The highest risks are missing production OTP delivery, inconsistent ledger/cache timing, failure to carry refund debt into later payouts, nonrecovering transient capture retries, and unsafe executable historical reconciliation. Confidence is high in the cited source behavior and the in-memory reproductions, but limited for deployed behavior, database concurrency, existing-data upgrades, and complete user journeys.

Only this report was intentionally persisted. No code, tests, configuration, migrations, context, or existing evidence was edited. Existing services were neither started nor stopped. No migrations, seeds, installs, database-writing tests, real provider calls, or Git mutations were performed. Context maintenance was reviewed but deliberately not applied because the task explicitly permits only this report.

## 2. Git Merge Integrity

Initial working tree was clean. Recent history includes:

| Commit | Meaning |
|---|---|
| `c3eb218` | Latest commit, changes tracked `.api-run.log` only |
| `1d2648d` | Merge with parents `7268444` and `27591a4` |
| `7268444` | UI polish |
| `27591a4` | Refund/settlement/reconciliation completion |
| `45d098f` | Broad money/auth/reporting fixes |
| `e4cb706` | Earlier merge and comparison baseline |

`git diff --quiet 27591a4 HEAD -- apps/api/src/payments apps/api/src/refunds apps/api/src/paymentLinks apps/settlement apps/reporting` returned zero. These core trees are unchanged from the refund completion commit. This is meaningful preservation evidence, not proof of correctness. Agent 2's eight requested safeguards and Agent 3's capture/hold/refund changes remain present (section 4). Agent 1's Dockerfiles/configuration/seed protections remain represented; its original report itself recorded major runtime blockers. FP-203 now uses the ledger rebuild handler, and largest-remainder split allocation is present.

An inventory comparison found all **90 baseline test files** under apps/packages/scripts from `e4cb706` still present. A source scan across **491 files** in apps/packages/scripts/db/ops found **zero conflict markers**. `git diff --check` initially passed. No demonstrated lost implementation, deleted baseline test file, or merge conflict was found. Presence checks do not prove that every old test assertion survived unchanged; no exhaustive semantic comparison of every merge hunk was completed.

Later status showed `.api-run.log` modified while pre-existing services remained active. This was preserved, not reverted; GET probes can cause those processes to append their own access logs. Do not include that log change as audit implementation work. Its tracked status is itself undesirable operational hygiene. Final diff checking warned about its line endings rather than reporting a code defect.

## 3. Documentation Consistency

The documentation/evidence trees were inventoried, excluding the explicitly forbidden `Evidence/old-agints-instration/`. Review prioritized instructions, context dependency/security/payment/testing records, architecture/admin/handover/runbooks, ADRs 0001-0006, ops instructions, incident/performance material, canonical bug notes, Agent 1-3 reports, balance reconciliation, implementation reports, fork evidence, and forensic/static review summaries. This was not a line-by-line re-audit of every historical export, transcript, raw log, or every low-risk source file. Those exclusions are coverage limits, not implicit validation.

| Source | Current discrepancy / consequence |
|---|---|
| `context/KNOWN_ISSUES.md` and `context/CONTEXT_STATUS.md` | Describe 86 reports and older baselines, while the registry now has 90. The claimed 100% inspection/static coverage does not establish current runtime verification. Many listed open defects are now patched. |
| `context/PAYMENT_FLOWS.md` | Describes capture network I/O inside a transaction and older refund/event structures; current capture uses prepare/provider/apply phases and refunds emit `refund.succeeded`. |
| `context/README.md` / module summaries | Claims no automated scheme residue posting; `batch.go:304-327` now posts it. Says 72 migrations; current inventory has 78 SQL files. |
| `docs/ARCHITECTURE.md` | Client-clock payment-link expiry and optional callback-signature descriptions are obsolete. Current payment-link code uses database time and production signature checking is enforced. |
| `docs/ADMIN.md` | Support credit permissions and super-admin write impersonation contradict current server restrictions. Import duplicate-detection and adjustment descriptions are stale. |
| `docs/HANDOVER.md`, `docs/ONBOARDING.md` | Refund route/drawer and webhook work is now implemented behind the feature flag. Holds are deleted by the janitor rather than merely updated. Onboarding's instruction to trust passing tests over behavior is unsafe historical guidance. |
| `docs/RUNBOOK.md` | Seed safety, idempotent March sweep, manual residue procedure, and reserialization guidance conflict with current code or safeguards. Do not follow its shared-staging reset or production sweep advice. |
| ADR 0003 | UTC calendar-month equivalence remains disputed; shifted boundary activity does not mathematically cancel for arbitrary datasets. Requires a human accounting decision. |
| ADR 0004 | Accepted faster settled-data console rebuild conflicts with the current ledger-source handler and architecture invariant. Supersede through a human decision, not silent document editing. |
| ADR 0006 | Describes cache-only UI adjustments, while `routes/adminBalanceAdjustments.ts:63` now calls the journaled variant. The old cache-only helper still exists but is not this route's implementation. BUG-038's UI claim is obsolete. |
| ADR 0005 | Proposed/paused; no shadow-ledger implementation should be inferred or activated. |
| `.cursor/rules/filspay.mdc` | Adds a broad approval requirement for security/financial edits beyond AGENTS.md; this audit makes no such edits. CLAUDE.md otherwise defers to AGENTS.md. |
| `Evidence/bugfix_plan.md` | Historical directions to edit existing migrations/update old assertions conflict with current AGENTS.md restrictions. Treat as evidence, not authorization. |
| Source comments | `v1/fees/calculateFee.ts` calls itself unused, but capture imports its new discounted-fee helper. Replay/freshness comments also describe superseded behavior. |

No root `README.md` was present. Operational instructions reside in `ops/README.md`; historical onboarding references to other README/API paths should be checked before use. No documentation was rewritten.

## 4. Evidence Reconciliation

Historical counts refer to different snapshots: the registry introduction discusses 84 unique bugs, context discusses 86, and current files/index extend through BUG-090. The current registry's 85 qualified/unqualified fixed entries, two partial entries and three open entries are implementation claims, not newly executed proof. Some individual files retain earlier hosted observations saying “still open” above later fix notes. Neither statement alone describes this HEAD.

Agent reports and fork logs contain useful historical commands and fixtures. They were not rerun wholesale and their results were not counted in this audit's test totals. Fork code was not merged or cherry-picked. The balance report explicitly says it did not re-audit ledger posting semantics; the cache issue below exposes that limitation. The phase-0 implementation reports describe their recorded baselines, not the latest remediation state. Historical postmortem attribution of duplicate captures to callbacks is insufficient proof against reservation races.

### Requested authentication/admin fixes

| Bug | Preserved current evidence | Audit disposition |
|---|---|---|
| BUG-004 | `auth/requireMerchantAuth.ts:58-59,79`; `admin/impersonation.ts:86-89,123` | IMPLEMENTED_UNVERIFIED: method restrictions, support role, active-admin checks; DB tests not run |
| BUG-019 | `reporting/scope.ts:16` | IMPLEMENTED_UNVERIFIED at route/DB level; mocked parent-child scope test passed |
| BUG-020 | `routes/reporting.ts:79` | IMPLEMENTED_UNVERIFIED for audited runtime provenance; current local HTTP/proxies deny anonymous access with 401 |
| BUG-022 | `paymentLinks/read.ts:35-58` | IMPLEMENTED_UNVERIFIED: explicit public query/DTO excludes key hash/prefix |
| BUG-039 | `admin/apiKeys.ts:39` | IMPLEMENTED_UNVERIFIED: predecessor revocation under transaction; old/new key DB test present |
| BUG-040 | `admin/creditApproval.ts:11` | VERIFIED_FIXED for stable-ID comparison; three tests passed, DB posting not verified |
| BUG-041 | `routes/adminCredits.ts:64` | IMPLEMENTED_UNVERIFIED: finance/super_admin guard |
| BUG-042 | `admin/bulkKyc.ts:41,47` | IMPLEMENTED_UNVERIFIED: under-review restriction and transactional review records |

Merchant session OTP completion/active status and promotion rotation survive in `auth/sessions.ts:57-63,106-111`. Login binds to the password-checked user in `routes/auth.ts:81-105`; verify/resend lock and preserve attempt budgets at `:143-178,218-264`. Full login/session separation was not exercised.

### Requested payment/settlement fixes

| Bug/work | Preserved current evidence | Limitation |
|---|---|---|
| BUG-006 | `paymentLinks/pay.ts:43-48,98-114` reservation/request binding | DB race tests not run; restart recovery limited |
| BUG-021 | `payments/capture.ts:129-143` binds target transaction | New hash rejects old persisted keys; finding PMA-05 |
| BUG-023 | `capture.ts:291,318-325,353` discounted fee/adjustment | Capture regression present, DB not run |
| BUG-024 | `payments/void.ts:30-34` | STILL_OPEN, local-only release |
| BUG-025 | `capture.ts:192-205` active hold validation | DB regression present, not run |
| BUG-027 | `routes/refunds.ts`; `ops/docker-compose.yml`; drawer integration | IMPLEMENTED_UNVERIFIED; config default off, generated local stack flag on |
| BUG-028 | `processRefund.ts:97-124,172,192-230,342-367` reason/recovery | Approval and unknown-outcome tests present, not run |
| BUG-061 | `capture.ts:109-128` provider call outside DB transaction | Source preserved; concurrency tests not run |
| Refund ownership/headroom | `initiateMerchantRefund.ts:62-73`; `processRefund.ts:243,262-264,448-451` | Source limits preserved; no DB over-refund/concurrency reproduction |
| Final fee remainder | `processRefund.ts:420-429`; `forkBatch3.new.test.ts:43` | Historical passing artifact exists; not current audit proof |
| FP-203 | `internal/internalapi/server.go:272`; `ledger/rebuild.go:127-138` | Ledger handler preserved; cache timing still inconsistent |
| Split conservation | `internal/splits/allocate.go:114-124` | Largest remainder preserved; split DB payout unverified |
| Integer net/residue | `settlement/payable.go:6-7`; `batch.go:304-327` | Source preserved; Go/database checks blocked |
| Reporting serialization | `runConsumerPass.ts:46-47`; `cursor.ts:35-39`; `serialization.ts:16` | Cursor transaction/barrier preserved; poison row remains |

Webhook source now contains canonical transmitted bytes (`dispatcher.ts:153-162`), delivery leases/SKIP LOCKED (`:219-239`), raw callback parsing/freshness (`routes/acquirerCallbacks.ts:43-46,66-70`), mandatory production signatures (`config.ts:275`), stable replay identity (`replay.ts:49-54`), and production DNS pinning. These are preserved implementations, not complete delivery/retry proofs. Literal private URLs are tested; development-mode resolved-IP protection remains weaker than production.

## 5. Confirmed Remaining Bugs

Priorities below concern current impact. Static confirmation establishes a code path; it does not claim production occurrence or a completed database reproduction.

### PMA-01 — Production OTP cannot be delivered — P0

- **Evidence:** `apps/api/src/auth/notifier.ts:16-29`, `adminAuth/notifier.ts:11-24`, `config.ts:219`.
- **Cause/method:** Both notifiers only log metadata in production; neither sends email/SMS. Production disables development code exposure by default. Direct source tracing confirms no delivery operation in these functions.
- **Impact:** A normal new merchant/admin production login cannot obtain its OTP and complete authentication. Existing sessions do not solve new login.
- **Smallest safe next action:** Integrate an actual delivery channel and test both authentication planes without bypassing OTP. Dependency: delivery credentials/provider and production configuration. Local development exposure is not public readiness.

### PMA-02 — Rebuild followed by close double-counts cache — P1

- **Evidence:** `apps/api/src/payments/capture.ts:315,323`; `apps/settlement/internal/ledger/rebuild.go:135-138`; `internal/settlement/batch.go:346`; `internal/balances/cache.go:24-32`.
- **Cause/method:** Capture already posts net merchant payable to the ledger; rebuild sums it; closing later adds the same net to cache without another payable ledger credit. This is a sequential problem, so cache-row locking alone cannot fix it.
- **Reproduction by source arithmetic:** Capture 1,000 with fee 25 gives ledger payable 975. Rebuild sets cache 975. Close adds 975, yielding cache 1,950 while ledger stays 975; payout then leaves cache 975 and ledger zero.
- **Impact:** Incorrect displayed payable and reconciliation after a routine rebuild/close sequence.
- **Smallest safe next action:** Define one cache meaning and apply deltas at the same lifecycle points as authoritative payable postings. Add capture→rebuild→close→payout DB regression before changing semantics. Depends on finance confirmation; not authorization to alter ADR decisions silently.

### PMA-03 — Negative refund batches do not reduce later positive payouts — P1

- **Evidence:** `apps/settlement/internal/settlement/batch.go:238-263,404-437,600`; `batch_test.go:704-706`; `internal/balances/cache.go:38-45`.
- **Cause/method:** Refund-only batches may have negative net. Payout omits ledger/disbursement for nonpositive net, marks the batch paid, and subtracts the negative cache delta. Subsequent positive payout uses that batch's full positive net; no deduction of earlier debt was found in this path.
- **Source scenario:** An already-paid sale is refunded for net 975. The refund-only -975 batch is marked paid without collection. A later +975 batch disburses 975 instead of absorbing that debt. Ledger debt persists, but payout instructions ignore it.
- **Impact:** “Refund reduces next payout” is not established across refund-only days; platform exposure can persist/increase.
- **Smallest safe next action:** Carry merchant debt forward or explicitly collect it before positive disbursement; preserve ledger/cache equality. Requires payout policy and a three-day DB regression. No bank action was attempted; an external collection system was not evidenced.

### PMA-04 — Transient capture retry repeats the same error — P1

- **Evidence:** `apps/api/src/payments/capture.ts:117,260-263`; `payments/idempotency.ts:159`; `acquirer/simulator.ts:140-152`.
- **Cause/method:** Failed claims increment attempt count, but capture sends only stable claim ID to a simulator that caches even transient errors. Same-key retries recover the cached error indefinitely within that process.
- **Executed proof:** An in-memory seeded simulator returned `error`, then `error` with identical result object for the same key. No network/provider was used. Combined with call-site tracing, this confirms the failure mechanism, not an HTTP/DB integration test.
- **Impact:** Legitimate retry cannot complete checkout after a known transient failure.
- **Smallest safe next action:** Distinguish definitive nonexecution from unknown outcomes; use attempt identity only when safe to retry. Do not rotate keys blindly for unknown outcomes. Add full capture failure/retry regression.

### PMA-05 / BUG-021 — Legacy persisted capture keys no longer replay — P2

- **Evidence:** `capture.ts:129-143`; `idempotency.ts:144-153`; historical `git show d6e6bbb:apps/api/src/payments/capture.ts` hashes amount only.
- **Cause/method:** New transaction-bound hash differs from the old amount-only hash; comparison rejects before completed replay. No compatibility branch or data transformation was found.
- **Impact:** Legitimate retries of pre-change captures get 422, potentially leading merchants to submit new operations. Target binding is the correct security improvement; the rollout contract remains incomplete.
- **Smallest safe next action:** Validate legacy replay against stored resource/tenant/amount, or explicitly reconcile/expire old keys under a reviewed rollout procedure. Never broadly accept an old hash without binding its target. Existing-data inventory required. Counted once under BUG-021.

### PMA-06 / BUG-024 — Void does not reverse external authorization — P1

- **Evidence:** `apps/api/src/payments/void.ts:30-34`; `acquirer/types.ts` has no reversal operation.
- **Cause/method:** Source explicitly performs only local hold release. No acquirer reversal call exists.
- **Impact:** UI/API cancellation can leave issuer-held funds until expiry.
- **Smallest safe next action:** Add an idempotent provider reversal with durable outcome/reconciliation handling. Requires provider contract; do not test with real funds during remediation verification.

### PMA-07 / BUG-043 — Future credits post immediately — P1

- **Evidence:** `apps/api/src/admin/creditRequestValidation.ts:76-84`; `admin/credits.ts:145-165,185-218`.
- **Executed proof:** Pure parser accepts `effectiveDate: '2099-01-01'`; output was `futureDateAccepted 2099-01-01`. Closed-period checks do not bound future dates.
- **Cause/impact:** Ledger rows receive the future date while cache changes immediately, allowing future-effective money to appear now and reports to disagree by period. Existing backdate/closed-period protections do not address this.
- **Smallest safe next action:** Reject dates after Bahrain today, or implement an explicit scheduled-credit lifecycle. Regression must cover immediate cache/ledger timing; finance policy required.

### PMA-08 / BUG-033 — Retired reconciliation script still posts — P1

- **Evidence:** `scripts/reconcile_march.ts:3-12,74-83,87-135`.
- **Cause/method:** “DO NOT RUN” is only a comment. Entrypoint still connects, selects UTC-March residue, generates fresh UUID groups and posts merchant-payable adjustments. A second execution posts again.
- **Impact:** Following historical runbook instructions can repeatedly alter financial books with incorrect scope/accounts.
- **Smallest safe next action:** Make this retired executable refuse before connecting; any historical repair needs a separately approved, idempotent backfill. No execution against a database occurred.

### PMA-09 — Single-merchant rebuild can overwrite a concurrent delta — P2

- **Evidence:** `apps/settlement/internal/ledger/rebuild.go:30-42`, versus all-merchant locking at `:127-138`.
- **Cause/method:** Single rebuild sums before obtaining cache-row lock. A payout may commit after that read but before the upsert; rebuild overwrites its cache update with the older sum.
- **Impact:** CLI single-merchant repair can reintroduce drift. Actual concurrent database reproduction remains pending.
- **Smallest safe next action:** Share the lock-before-sum protocol, including missing cache-row handling, and test a controlled payout interleaving. This does not resolve PMA-02's separate lifecycle semantics.

### PMA-10 / BUG-052 — Missing rollup poisons reporting pass — P2

- **Evidence:** `apps/reporting/src/consumer/applyEvent.ts:147-148`; transactional retry behavior in `runConsumerPass.ts:25-39`.
- **Executed proof:** Invoke real `applyEvent` with a fake query client returning an existing batch, capture count one, and no daily rollup row: `TypeError: Cannot read properties of undefined (reading 'captured_count')`.
- **Cause/impact:** Non-null assertion via cast does not create a missing row. The consumer rolls back/retries this event, blocking later analytics. Requires missing/incomplete history, not every normal capture.
- **Smallest safe next action:** Handle missing rollup explicitly and warn/repair without dereferencing it. Test this state and consumer progress. Cursor serialization fixes survive; this separate historical subcase remains.

### PMA-11 — Payout trend status can stay closed after payment — P2

- **Evidence:** `apps/reporting/src/consumer/runConsumerPass.ts:10-15`; `applyEvent.ts:93-115`.
- **Cause/method:** Only batch-closed events update payout trends; status/paid_at are copied at consumption. If consumed before payment, no later paid event refreshes the projection.
- **Impact:** Payout analytics may indefinitely show closed/unpaid despite payment, until rebuild. Timing determines occurrence.
- **Smallest safe next action:** Apply payout lifecycle events to the same row, with idempotent updates and ordered close→paid regression.

### PMA-12 / BUG-086 — Credit fee preview uses obsolete rate — P2

- **Evidence:** `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:476`; backend effective schedule at `apps/api/src/admin/credits.ts:253-260`.
- **Cause/method:** UI promises merchant default MDR, backend resolves the effective schedule. When they differ, preview and posted reversal disagree.
- **Impact:** Finance approves an inaccurate displayed amount. Backend correction survives; UI is partial.
- **Smallest safe next action:** Preview the effective-date schedule/rate actually used by the server. Requires shared preview response or existing schedule data, with mismatched-rate regression.

### PMA-13 / BUG-081 — Applied migration changes are undetected — P3

- **Evidence:** `db/migrate.ts:39-44,81-99`.
- **Cause/method:** Applied filenames are skipped; bootstrap stores no checksum. Comment claiming checksum protection is false.
- **Impact:** Two databases may have different objects under the same recorded migration names. This audit did not detect a new merge edit to existing migrations; six new files 0079-0084 were added since `e4cb706`.
- **Smallest safe next action:** Review checksum and migration-run serialization design; do not retroactively repair schema without approval. Existing upgraded databases need object-level inspection independently of checksum work.

## 6. Incomplete or Partially Fixed Features

Full/partial refund route, drawer, timeline, outbox, fee remainder, batch claiming and reconciliation are implemented. Generated local env and Compose enable the feature, whereas config defaults it off. No flag was changed in this audit. The historical recommendation to leave it disabled is not the generated local default. Refund-only negative settlement remains incomplete as described above.

Capture preparation now commits before the network request. However, approved provider outcome and local journal still have a crash window. Simulator idempotency is explicitly process-local (`simulator.ts:88-95`); `captureRecovery.new.test.ts:26` reuses one simulator instance. It cannot prove recovery across restart/replicas. Refunds improve recovery by persisting approval before journaling (`processRefund.ts:97-124,192-230`) and retaining reservations for unknown outcomes, but external approval before persistence still needs reconciliation. Treat these as unresolved recovery risks, not demonstrated duplicate real charges.

Production OTP delivery, credential rotation attestation, existing-database upgrade verification, negative-debt collection policy, and authenticated runtime journeys remain incomplete or unverified. Broad-table reporting SHARE locks serialize producers; capacity impact has not been measured. Per-service DB roles/TLS and production deployment secrets are not supplied by a local development Compose file.

## 7. Post-Merge Regressions

**Zero demonstrated merge regressions.** The source defects above are current defects, feature/rollout gaps, or older partially resolved behavior. No claim is made that the merge introduced them. In particular, changing capture hash creates an upgrade compatibility issue, but evidence does not attribute it to conflict resolution. Core refund/payment/settlement/reporting trees match `27591a4`, all baseline test filenames remain, and no conflict markers were found.

## 8. Security and Financial Risks

Release concerns, ordered by practical impact:

1. Public production login cannot deliver OTP under standard configuration (PMA-01).
2. Ledger-source rebuild and batch-driven cache deltas disagree (PMA-02/09).
3. Refund debt is not carried into later positive payout instructions (PMA-03).
4. Capture retries and provider crash recovery lack a complete durable outcome policy (PMA-04/05 and section 6).
5. Executable March repair and future credit dates can distort books (PMA-07/08).

BUG-057 remains **BLOCKED** for external credential rotation evidence; removing tracked values is not rotation. No credential values were copied into this report. Historical logs/exports and Git history remain sensitive evidence; their existence does not prove active credential abuse.

No new tenant/auth bypass was confirmed. Preserved guards need database route tests for actual enforcement, not just source review. Development transport DNS filtering is weaker than production (`webhooks/transport.ts:52`); do not expose development configuration publicly. The frozen partner directory now contains a new fee helper used by capture; no externally visible partner contract break was demonstrated, but stale “dead code” comments hide that dependency.

## 9. Test and Runtime Results

Environment: Windows PowerShell, Node 22.19.0, npm 10.9.3, Go 1.24.2. Docker executable unavailable. `DATABASE_URL` and `PGCONN_SETTLEMENT` absent in this shell; `ops/.env.docker` absent. Existing listeners on 3000/5173/5174/5432 were observed. Open port 5432 does not identify an isolated disposable database; no database login/query was attempted.

| Executed check | Actual result |
|---|---|
| `npm.cmd run typecheck` | PASS, all workspace/db/scripts checks, exit 0 |
| `npm.cmd run test -w @filspay/money` | 40 passed, zero failed/skipped |
| `npm.cmd run test -w @filspay/events` | 4 passed, zero failed/skipped |
| `npm.cmd run test -w @filspay/web` | 38 passed, zero failed/skipped |
| `node --import tsx --test db/seed/safety.new.test.ts` | 4 passed, zero failed/skipped; tests check refusal logic, no seed run |
| Selected auth/admin/scope/webhook units, command below | 36 passed, zero failed/skipped; independently rerun by primary auditor |
| Selected parser/flags/crypto/Bahrain/SQL-filter units | 13 passed, zero failed/skipped |
| Selected random/invite/promotional-discount/simulator-RNG units | 9 passed, zero failed/skipped |
| Safe test total | **144 passed, 0 failed, 0 skipped**; duplicate reruns excluded |
| `npm.cmd run build -w @filspay/web -- --outDir NUL` | PASS, 76 modules; harmless dynamic/static import chunk warning. Windows created a literal build directory; only its verified generated files were removed afterward. No retained build output. |
| Admin Vite programmatic build `{build:{write:false}}` | PASS, 63 modules, exit 0; no build output written |
| Go `test ./...`, `vet ./...`, `build -o NUL ./cmd/settlement`, GOPROXY off | BLOCKED by access denied to existing `AppData/Local/go-build` cache entries. Test setup failed; cached money-package success is not a full Go-suite pass. No tooling installed or dependency download requested. |
| Three stdin function/mock probes | Future credit accepted; missing rollup throws TypeError; simulator error replay retains same object. No database or external provider. |
| Git integrity and marker/test inventories | Results in section 2 |

Selected unit commands (all via existing Node/tsx):

```powershell
node --import tsx --test --test-reporter=spec apps/api/src/auth/otp.test.ts apps/api/src/auth/loginLimits.new.test.ts apps/api/src/admin/creditApproval.test.ts apps/api/src/reporting/scope.new.test.ts apps/api/src/webhooks/ssrf.new.test.ts apps/api/src/webhooks/inboundPayload.new.test.ts apps/api/src/webhooks/inboundVerify.test.ts apps/api/src/webhooks/sign.test.ts apps/api/src/webhooks/secretCrypto.test.ts apps/api/src/webhooks/envelope.test.ts
node --import tsx --test --test-reporter=spec apps/api/src/admin/adjustmentCsvParsing.new.test.ts apps/api/src/admin/merchantFlags.new.test.ts apps/api/src/lib/crypto.new.test.ts apps/reporting/src/bahrainDate.new.test.ts scripts/lib/sqlFilter.new.test.ts
node --import tsx --test --test-reporter=spec apps/api/src/lib/random.new.test.ts apps/api/src/admin/inviteCode.new.test.ts apps/api/src/payments/promotionalDiscount.new.test.ts apps/api/src/acquirer/rng.new.test.ts
```

Existing-service observations: GET `:3000/healthz` and `/readyz` returned 200; health uptime was approximately 4,284 seconds at observation. GET frontend roots on 5173/5174 returned 200 HTML. API and both frontend proxies returned 401 JSON for `/v1/auth/me`, `/v1/reporting/export-summary`, and `/v1/admin/auth/me`. Initial `/v1/me` probes returned 404 because that is not the auth identity route; they were corrected. These results prove basic process/proxy responses, not live DB integrity, successful authentication, or runtime provenance to this HEAD. Readiness is boot-time state (`routes/health.ts:21-29`).

**Not run:** full npm test; API/reporting/script database integration; migration/seed/fresh or upgraded database validation; Go DB/concurrency suites; browser login/OTP/KYC/API-key flows; checkout/capture/void/refund; settlement/split payout/reconciliation queries; authenticated reporting; load/overload testing. Exact blockers: no positively identified disposable migrated DB, Go cache permissions, and task restrictions forbidding service/config/database provisioning. Python launcher failed initially; an existing Python 3.13 interpreter with pypdf successfully extracted all four guideline pages. Some initial inline Node attempts failed from PowerShell quoting and were rerun through stdin; these were command invocation errors, not app test failures.

## 10. Bug Status Summary

The following is a conservative, mutually exclusive **90-candidate accounting**, not a claim that all 90 received equally deep independent source review. Status labels map to AGENTS.md's permitted statuses. Additional PMA findings are counted separately so historical reports are not silently renumbered.

| Canonical status | Audit label | Count | IDs / scope |
|---|---|---:|---|
| `fix-verified` | VERIFIED_FIXED | 12 | 009, 012, 029, 040, 054, 076, 077, 085, 087, 088, 089, 090 |
| `confirmed-current` | STILL_OPEN or PARTIALLY_FIXED | 7 | 021, 024, 033, 043, 052, 081, 086; exact residual behavior in section 5 |
| `already-fixed` | IMPLEMENTED_UNVERIFIED | 41 | 001-008, 010-011, 013-023 excluding 021, 025-028, 030-032, 034-039, 041-042, 045-047, 051, 061, 067 |
| `unverified` | BLOCKED | 1 | 057: external rotation not attested |
| `stale-or-invalid` | NOT_REPRODUCIBLE as written | 1 | 073: leading-wildcard predicate remains, but historical “every search is sequential scan” is not established; later report describes merchant/date index filtering. No fresh EXPLAIN/load result here. |
| `historical-report` | UNKNOWN / independent review incomplete | 28 | All remaining IDs; historical fix notes exist but this audit does not independently close their complete behavior |
| `duplicate` | DUPLICATE | 0 | No additional canonical IDs collapsed in this audit |
| **Total** | | **90** | No invented before/after reduction |

Twelve verified issues have limited, explicit scope: CSV BHD parsing, preserving test_mode during recomputation, cryptographic OTP/link generation, stable approver IDs, destructive-seed refusal, Bahrain date filter, older-link pagination, title routing, Mastercard 2720 hint, promotional amount parsing, invite RNG, and exact hex comparison. They do not mean their entire user journeys passed.

The seven current historical candidates plus **six additional distinct findings** (PMA-01/02/03/04/09/11) yield **13 current defects**. PMA-05 is counted under BUG-021; PMA-06/07/08/10/12/13 map to the other six historical IDs. Priorities total **P0=1, P1=6, P2=5, P3=1**; remaining confirmed important P0-P2 defects total **12**. Critical P0/P1 count is **7**. Within the seven historical current candidates, BUG-021/043/052/086 are partially fixed. Source-confirmed subfixes are not counted again as fully verified fixes.

Unknown historical IDs are 044, 048-050, 053, 055-056, 058-060, 062-066, 068-072, 074-075, 078-080, 082-084. Some preserved changes in these groups were inspected and discussed, but complete independent verification was not completed. Environment blockers also limit the 41 implemented fixes; this is an overlapping verification limitation, not another bug count. ALREADY_FIXED_AT_BASELINE provenance was not established for a separate exact population, so no such count is invented.

## 11. Submission Readiness

The four-page `Evidence/FilsPay_Submission_Guidelines_261030_161113.pdf` was read using pypdf. It requests a correctly named submission PDF, slide PDF, own public fork/last commit, live checkout/dashboard/admin/API URLs, architecture/redeploy/secrets/health information, measured capacity and overload behavior, findings with verification and existing-data effects, UI before/after evidence, and three annotated AI excerpts including an incorrect AI answer. The proposed demo includes full and partial refunds with correct settlement amounts. The document says Friday 11 pm; no external schedule verification was performed.

| Area | Assessment | Evidence |
|---|---|---|
| Local source/type/bundle checks | READY within limited scope | Typecheck, both builds, 144 safe tests |
| Basic existing local connectivity | READY within limited scope | Health/root responses and protected-route proxy 401s |
| Merchant/admin authenticated journeys | UNVERIFIED locally; NOT READY under normal production OTP configuration | No login flow run; missing production delivery |
| Checkout/capture and full/partial refund demo | UNVERIFIED | Integration tests not run; retry/negative debt defects remain |
| Settlement and reconciliation correctness | NOT READY for unqualified claim | PMA-02/03/09, no current DB proof |
| Public deployment/security | NOT READY for sign-off; actual hosted deployment UNVERIFIED | OTP/rotation/configuration and runtime provenance gaps |
| Capacity/overload | UNVERIFIED | Historical FP-209 covers a different read workload/dataset and predates current changes; no new fixed checkout scenario result |
| Submission artifacts/public fork/live URLs | UNVERIFIED | Not established by this repository audit; no links or capacity estimates invented |

`docs/perf/fp-209-loadtest-2026-09.md` reports historical export/list/summary measurements, not current checkout concurrency or overload recovery. It cannot be used as a current user-capacity estimate. Submission evidence must explicitly distinguish older artifacts from fresh test results and address existing-data upgrade effects.

## 12. Recommended Next Actions

1. **P0:** Supply and verify production OTP delivery for both planes. Preserve verification and role/session separation.
2. **P1:** Resolve cache lifecycle semantics and negative-refund debt recovery with finance; add controlled capture→rebuild→close→payout and paid-sale→refund-only-day→positive-day DB scenarios before payout sign-off.
3. **P1:** Repair known-transient capture retries with safe outcome classification; separately specify durable unknown/approved provider reconciliation and restart tests.
4. **P1:** Reject unsupported future credit dates and retire the executable March poster before anyone follows old runbooks. Obtain external credential rotation evidence under BUG-057.
5. **P1:** Implement external authorization reversal with idempotent recovery; verify using simulator/disposable fixtures only.
6. **P2:** Handle legacy capture-key replay safely, align single-merchant rebuild locking, prevent missing-rollup poison, consume payout lifecycle updates, and align credit previews with effective schedules.
7. **P2 verification gate:** Positively identify an isolated migrated test DB, resolve Go cache permissions without changing shared services, then run affected DB suites, Go build/vet/tests, and authenticated browser/API refund/settlement journeys. Confirm runtime revision and query actual ledger/cache/payout invariants. Do not infer success from readyz.
8. **P2 submission:** Measure the official fixed checkout workload/overload recovery on the prescribed resources; assemble named PDFs, own public fork/commit, live URLs, UI evidence, and annotated AI excerpts.
9. **P3:** Review migration checksum/upgrade strategy and stop tracking runtime logs. Refresh context and operational documentation in a separately authorized editing task; supersede disputed ADRs through human decisions.

No fixes were implemented by this audit. Its sole deliverable is `Evidence/POST_MERGE_AUDIT_REPORT.md`.
