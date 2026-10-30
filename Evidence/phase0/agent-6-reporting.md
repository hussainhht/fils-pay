# Phase 0 — Agent 6: Reporting & Analytics

Verified 2026-10-30 (Asia/Riyadh), against HEAD `c389b261c7b481c2b14d12374a5511a07e67f866`. Scope: BUG-019, BUG-020, BUG-052, BUG-053, BUG-071, BUG-072, BUG-073, BUG-074, BUG-076, BUG-082.

Source/schema and existing-evidence inspection only. No tests, services, database queries, migrations, rebuilds, or fixes executed. Test references below describe inspected source, not a new passing test run. Obsolete instruction archives were not read. Canonical reports remain unchanged. `VERIFIED_OPEN` means the code defect is established; it does not establish production occurrence or severity measurements.

## BUG-019 — Report scope accepts another parent's child

- Status: VERIFIED_OPEN.
- Root cause: Any authenticated merchant can supply a different merchant ID in the JSON filter. The resolver accepts it if it is anybody's split child; it never checks the caller is its parent. The downstream query correctly filters the resulting ID, so the authorization failure is before SQL report execution.
- Current evidence: `apps/api/src/routes/reporting.ts:24-48` (auth, filter, resolver, query); `apps/api/src/reporting/scope.ts:8-19` (child-only existence check); `apps/api/src/reporting/transactionsReportQuery.ts:41-62` (merchant predicate); `db/migrations/0045_merchant_split_children.sql:6-19` (parent/child relationship and composite uniqueness).
- Existing evidence: `Evidence/bugs/bug-019-reporting-scope-split-child-idor.md`, static only. `apps/api/src/reporting/transactionsReportQuery.test.ts:104-127` tests query filters, not the route's parent authorization.
- Fix / resolution: Add `parent_merchant_id = callerMerchantId` to the existing child lookup; retain the current caller fallback for an unauthorized ID, or deliberately specify a denial response. The existing `(parent_merchant_id, child_merchant_id)` unique index supports this exact predicate.
- Dependencies: Authentication owner: BUG-001/BUG-017 remain separate credential-boundary prerequisites. Cover own merchant, own child, unrelated child, and nonexistent child at the route boundary when implementing.

## BUG-020 — Export summary omits authentication

- Status: VERIFIED_OPEN. The canonical report's hypothetical stale-identity leak is unproven.
- Root cause: `/v1/reporting/export-summary` has no auth hook, then dereferences `request.merchantAuth.merchantId`. No enclosing application auth hook supplies it. The current anonymous path therefore throws before querying, producing a 500 rather than a 401; even a credentialed request does not invoke credential resolution here.
- Current evidence: `apps/api/src/app.ts:49-76` (plugins and route registration); `apps/api/src/routes/reporting.ts:73-86` (protected sibling versus unprotected summary); `apps/api/src/auth/requireMerchantAuth.ts:46-74,85-101` (identity assignments occur inside the hook); `apps/api/src/plugins/errorHandler.ts:34-35` (unhandled error to 500).
- Existing evidence: `Evidence/bugs/bug-020-reporting-export-summary-unauthenticated.md`, static only; no existing leak reproduction identified.
- Fix / resolution: Attach `preHandler: requireMerchantAuth`, matching adjacent reads. Keep the authenticated merchant SQL predicate. `COUNT(*)` counts rollup days and `SUM(captured_gross_fils)` is gross captured volume, not transaction count or refund-adjusted net receipts.
- Dependencies: BUG-052/BUG-074 determine whether those rollup totals are accurate; auth owner handles BUG-001/BUG-017. No new role restriction is implied by the sibling read policy.

## BUG-052 — Concurrent reporting passes apply the same events

- Status: VERIFIED_OPEN. Canonical title/wording is stale where it implies separate commits or restart alone cause double application.
- Root cause: Rollup writes and cursor advance already share one transaction, but `readCursor` has no row lock. Two processes can read the same existing watermark, select the same events, add the same capture delta, and then set the same cursor. The listener's `running` flag guards only its own instance. A malformed event rolls back the whole pass and blocks subsequent passes without quarantine/recovery state.
- Current evidence: `apps/reporting/src/consumer/cursor.ts:24-37,41-51`; `apps/reporting/src/consumer/runConsumerPass.ts:38-69`; `apps/reporting/src/db/withTransaction.ts:23-35` (existing atomicity); `apps/reporting/src/consumer/applyEvent.ts:21-32` (additive upsert); `apps/reporting/src/consumer/listener.ts:23-38` (local guard); `apps/reporting/src/cli/catchUp.ts:16-24` (same pass, separate process); `db/migrations/0030_reporting_outbox_cursor.sql:10-14` (one keyed cursor row).
- Existing evidence: `Evidence/bugs/bug-052-reporting-consumer-double-applies.md`; `apps/reporting/src/consumer/runConsumerPass.test.ts:121-155` explicitly tests rollback, not concurrent readers. `Evidence/FilsPay_Complete_Source_Code_Investigation.md:611-618` corroborates static concurrency/ordering findings. `Evidence/runtime-artifacts/findings.json` FINDING-030 and `Evidence/FilsPay_Runtime_Security_Investigation.md:592` say NOT TESTED; they are not runtime proof.
- Fix / resolution: After seeding the cursor, read it `FOR UPDATE` in the existing pass transaction, with the same serialization protocol used by rebuilds. Keep writes and watermark atomic. Separately add durable failed-event state, alerts, and an explicit replay policy; do not silently discard financial events to move the cursor.
- Dependencies: BUG-074 must use the same lock. A cursor lock does not solve late producer commits: the query uses `id > cursor`, while `outbox_events` IDs are allocated before commit (`db/migrations/0009_outbox_events.sql:1-13`; `packages/events/src/outbox.ts:83-107`). A lower-ID transaction committing after a higher ID was consumed can be skipped. Event owner must supply commit-safe processing/deduplication or a producer barrier before declaring replay complete. `outbox_events.processed_at` belongs to webhook processing and must not become reporting's acknowledgement.

## BUG-053 — Streaming export cursor loses timestamp ties

- Status: VERIFIED_OPEN in the unused streaming helper. No current HTTP row loss from this cursor is established.
- Root cause: The helper orders only by `occurred_at`, pages at 1,000, then resumes strictly after the last timestamp. Any unreturned rows at that timestamp are excluded. Its JS `Date` cursor also loses PostgreSQL submillisecond precision. The HTTP route instead fetches every matching row and constructs the whole CSV in memory; its memory use is unbounded by pagination.
- Current evidence: `apps/api/src/routes/transactions.ts:154-171` (auth, tenant, full builder); `apps/api/src/transactions/exportCsv.ts:31-48,53-84` (full query versus helper); repository references to `streamTransactionsExportCsv` find only its declaration. `apps/api/src/transactions/query.ts:69-78,105-125,129-132` shows the existing precision-preserving composite list cursor; `db/migrations/0017_transaction_acquirer_reference.sql:14-17` provides a compatible merchant/time/ID index.
- Existing evidence: `Evidence/bugs/bug-053-large-export-pagination-drops-rows.md` already notes the unwired helper. `apps/api/src/transactions/exportCsv.test.ts:9,52-181` tests the full builder, not tied timestamps across streaming pages. No measured HTTP OOM evidence identified.
- Fix / resolution: Use ascending `(occurred_at, id)` ordering and tuple continuation, preserving `occurred_at::text` rather than round-tripping through `Date`. Fix the helper before wiring it; then connect the HTTP response to a bounded stream with backpressure. Preserve tenant/status/date predicates and the existing short-page termination.
- Dependencies: Define whether exports promise a stable snapshot under concurrent inserts/updates; keyset ordering alone does not provide that. Coordinate date bounds with BUG-076 and refund columns/semantics before claiming net reporting. No database or export reproduction needed in Phase 0.

## BUG-071 — Display picks newest entry instead of effective fee

- Status: VERIFIED_OPEN. Canonical merchant-dashboard/overview reachability is stale: the confirmed consumer is admin merchant detail.
- Root cause: Display orders by `created_at` alone and does not exclude future-effective rows. A late backfill at 245 bps can override the current 225 bps display; capture resolves by effective date and creation-date tie-breaker. This establishes an incorrect displayed schedule, not an incorrect charge caused by that display helper.
- Current evidence: `apps/api/src/routes/adminMerchants.ts:112-122` (admin-authenticated detail); `apps/api/src/admin/merchants.ts:283-304` (display lookup); `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:263-271` (default MDR and negotiated schedule shown separately); `apps/api/src/fees/currentFeeScheduleDisplay.ts:28-42` (wrong selection); `apps/api/src/fees/feeSchedule.ts:22-35` and `apps/api/src/payments/capture.ts:162-167,194-203` (actual effective resolution/charge); `db/migrations/0048_fee_schedules.sql:13-27` (history and effective-date index).
- Existing evidence: `Evidence/bugs/bug-071-fee-display-wrong-schedule.md`; `apps/api/src/fees/currentFeeScheduleDisplay.test.ts:71-82` asserts the wrong backfill-wins behavior. Finance clue in `Evidence/finance_ops_security_audit.md:37` is supporting context, not new runtime verification.
- Fix / resolution: Reuse the effective schedule selection at one explicit `now`, matching `getEffectiveMdrBps` filtering/order. Preserve the display DTO's rate/date metadata and its no-negotiated-schedule behavior; use the merchant default where an effective rate is needed. Do not replace selection with a creation-date index.
- Dependencies: Update the incorrect test expectation when fixing; include future-effective and no-effective-schedule cases. Payment/settlement owners retain event-time fee selection; reconciliation default-MDR repricing is separately tracked as BUG-066. Refund reversals must use actual historical charges, not this displayed rate.

## BUG-072 — Summary sums lifetime captures once per event

- Status: VERIFIED_OPEN.
- Root cause: Authenticated owner/finance summary joins each transaction to capture events in the Bahrain window, but selects cumulative `t.captured_fils`. Distinct only deduplicates the count. Captures of 4,000 and 6,000 produce gross 20,000 when both events qualify; an earlier-only window reports the later lifetime total 10,000 instead of its 4,000 delta. These are consequences of the same query, not runtime measurements.
- Current evidence: `apps/api/src/routes/settlement.ts:77-91` (auth/role/caller tenant); `apps/api/src/settlement/query.ts:265-270,359-386` (Bahrain half-open bounds, join, aggregation); `apps/api/src/payments/capture.ts:196-203,240-259` (cumulative update and event delta); `db/migrations/0018_transaction_events.sql:10-23` (delta/time/index); `apps/settlement/internal/settlement/batch.go:148-158` (batch uses capture-event amounts).
- Existing evidence: `Evidence/bugs/bug-072-settlement-summary-double-counts.md`; `apps/api/src/routes/settlement.test.ts:415-434` only covers single captures. `docs/perf/2026-07-settlement-summary-slow.md` contains a historical plan and reported 38% discrepancy; its cache-only resolution does not correct this arithmetic and is not a fresh measurement at this HEAD.
- Fix / resolution: Select/sum `te.amount_fils` while retaining distinct transaction count and current tenant/event/time predicates. `SUM(DISTINCT captured_fils)` would still be wrong, as would deduplicating lifetime totals. Assess performance after correcting the query; the existing transaction/time event index does not prove an optimal window-wide plan.
- Dependencies: Keep this endpoint explicitly gross capture volume. A future refund-adjusted figure must aggregate refunds independently, avoiding capture-by-refund fanout, and expose refund/net fields separately. Batch payout arithmetic and fee parity (BUG-010/BUG-032) remain settlement-owner work.

## BUG-073 — Substring search lacks a suitable search index

- Status: VERIFIED_OPEN for the query/index mismatch. The canonical claim that every search performs a full-table sequential scan is overstated and unverified.
- Root cause: Authenticated, merchant-scoped list search ORs two leading-wildcard `ILIKE` predicates with `id::text` equality. Existing B-tree acquirer-reference and merchant/time/ID indexes do not index those infix matches. PostgreSQL can still narrow by merchant/time or scan the ordered index to satisfy LIMIT; a universal full-table scan cannot be inferred from source.
- Current evidence: `apps/api/src/routes/transactions.ts:134-150` (auth and search argument); `apps/api/src/transactions/query.ts:100-126` (actual optional search, date, cursor, sort, limit); `db/migrations/0017_transaction_acquirer_reference.sql:9-17` (existing indexes). Inspection of all `db/migrations` found no `pg_trgm`, trigram operator class, or functional search index.
- Existing evidence: `Evidence/bugs/bug-073-transaction-search-ilike-full-scan.md`; `apps/api/src/transactions/query.ts:96-99` contains a latency anecdote, not a saved plan. `docs/perf/2026-07-settlement-summary-slow.md` measures a different query and is not search evidence.
- Fix / resolution: Preserve advertised substring semantics and add `pg_trgm` GIN indexes for both reference fields, subject to extension availability and measured plans for the complete OR/tenant/order query. Consider a separate typed UUID equality branch if ID search remains expensive. Prefix-only search would change behavior, and a plain `text_pattern_ops` index is not by itself proof of efficient case-insensitive infix search.
- Dependencies: Migration/infrastructure owner checks extension privileges and appropriate index rollout. Runtime query plans with representative merchant sizes, short/long/missing terms, and date bounds are needed to establish actual performance and index choice; no load test run here.

## BUG-074 — Admin rebuild and consumer disagree on processed history

- Status: VERIFIED_OPEN for rebuild/cursor inconsistency. Canonical title “Truncate and Insert in Separate Transactions” is stale/contradicted; no evidence establishes it as an already-fixed historical defect.
- Root cause: Admin rebuild truncates/repopulates from transaction events and current batches without touching the reporting cursor. Pending capture outbox rows whose source events were included in the rebuild are subsequently added again. Table locking during TRUNCATE does not make cursor and rebuilt data agree. Trend values come from a different source than worker event-payload amounts.
- Current evidence: `apps/api/src/routes/admin.ts:226-248` (finance/super-admin auth, one transaction, audit); `apps/api/src/db/withTransaction.ts:26-38` (BEGIN/COMMIT/ROLLBACK); `apps/api/src/admin/reportingRebuild.ts:11-38` (all mutations use that client, no cursor); `apps/reporting/src/consumer/runConsumerPass.ts:42-65` and `apps/reporting/src/consumer/applyEvent.ts:21-32,93-117` (incremental additions and event-sourced amounts).
- Existing evidence: `Evidence/bugs/bug-074-admin-analytics-rebuild-double-counts.md`; `apps/reporting/src/cli/rebuild.test.ts:77-144` covers CLI replay parity, not the admin source/cursor mismatch. `Evidence/FilsPay_Complete_Source_Code_Investigation.md:615-618` corroborates the mismatch. Its suggestion that worker status is necessarily status-at-close is also inaccurate: `applyEvent.ts:93-117` reads current status/paid_at when applied.
- Fix / resolution: Retain the existing admin transaction/audit. Replace the divergent population logic with a shared replay implementation and atomically publish matching rollups/cursor under the BUG-052 serialization protocol. Establish a producer-safe cutoff and sufficient retained history first; setting the cursor to an arbitrary `MAX(outbox_events.id)` under normal concurrent writers is not sufficient.
- Dependencies: BUG-052 and event-owner commit-order guarantees precede recovery. The CLI also commits truncate/reset before multi-pass replay (`apps/reporting/src/cli/rebuild.ts:45-63`), exposing empty/partial data and permitting races with a live worker; shared recovery must either publish atomically or have an explicit unavailable state and enforced maintenance exclusion. Payout status updates/repricing need a defined event or live-source policy. Refund-aware rebuilding must use the same refund applier as live consumption.

## BUG-076 — Transaction date filters start three hours late

- Status: VERIFIED_OPEN. Canonical “any dashboard date range” reachability is too broad; the confirmed caller is the transaction list.
- Root cause: `dayStartIso` appends `Z`, turning a business date into UTC midnight (03:00 Bahrain). The client sends that instant unchanged and SQL compares it directly. The half-open window is shifted three hours: it excludes the selected local day's first three hours and includes the next day's first three hours for a one-day range.
- Current evidence: `apps/web/src/format.ts:26-36`; `apps/web/src/pages/transactions/TransactionListPage.tsx:48-60,104-114` (caller and explicitly exclusive To); `apps/web/src/api/transactions.ts:16-31`; `apps/api/src/routes/transactions.ts:134-149`; `apps/api/src/transactions/query.ts:107-115` (inclusive from, exclusive to). In contrast, `apps/api/src/settlement/query.ts:265-270,363-378`, `apps/api/src/routes/analytics.ts:41-59`, and `apps/reporting/src/bahrainDate.ts:14-17` already implement the relevant Bahrain conversions.
- Existing evidence: `Evidence/bugs/bug-076-dashboard-date-filter-uses-utc-midnight.md`; `apps/web/src/dashboard.test.ts:54-56` asserts the wrong UTC value. The “fixed” comment in `format.ts:34` is contradicted by the function.
- Fix / resolution: Return local midnight with `+03:00` (or its equivalent UTC instant). Keep `to` exclusive, matching the UI; do not add a day automatically. Example for Oct 30: lower bound `2026-10-29T21:00:00.000Z`, next-day exclusive bound `2026-10-30T21:00:00.000Z`.
- Dependencies: Update the incorrect helper expectation when implementing; verify just-before/at both local-midnight boundaries. BUG-036 separately owns settlement scheduling/window construction. Any future export date UI should use the same business-date conversion; API ISO-instant callers must not receive another offset adjustment.

## BUG-082 — Closed-batch progress depends on monetary size

- Status: VERIFIED_OPEN. Canonical component name `SettlementProgressBar.tsx` is stale; the defect is inline in the batch detail page.
- Root cause: `grossFils / 10000`, rounded to two decimals, becomes a CSS percentage without any total/progress denominator. A 500,000-fils batch shows 50%; 1,000,000 fils shows 100%, although both have the same closed status. Changing the divisor to 1,000 would still not define progress.
- Current evidence: `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx:39-45,83-108` (API data, closed-only bar, separate formatted amounts); `apps/api/src/routes/settlement.ts:94-105` (authenticated tenant-scoped batch); `apps/api/src/settlement/query.ts:54-64,164-188` (stored fils and counts mapped without this scale conversion); `apps/web/src/format.ts:11-13` (amount formatter).
- Existing evidence: `Evidence/bugs/bug-082-settlement-progress-divides-fils-by-10000.md`; `Evidence/bugfix_plan.md:32` explicitly lists it as already proven. No reproduction repeated; canonical report itself identifies its evidence as static.
- Fix / resolution: Remove this bar, retaining status and formatted monetary fields. Only introduce a replacement if a real numerator/denominator or state-based progress specification exists; keep any monetary ratio in the same integer-fils units.
- Dependencies: None for removal. A future payout-progress design requires settlement-owner agreement on state/denominator, not an invented scale conversion.

## HEAD and working-tree state

- HEAD: `c389b261c7b481c2b14d12374a5511a07e67f866`.
- Initial `git status --short`: `?? Evidence/phase0/`; no tracked changes. Detailed pre-write inventory: `agent-1-infrastructure.md`, `agent-4-settlement.md`, and `agent-5-webhooks.md` were already untracked there and were left untouched.
- This task creates only `Evidence/phase0/agent-6-reporting.md`; no application/test/schema/shared-document changes. Git commands used a command-local `-c safe.directory=...` ownership exception; no Git configuration, branch, or commit was changed.

## Status summary by bug

| Bug | Primary status | Qualification |
| --- | --- | --- |
| BUG-019 | VERIFIED_OPEN | Parent-child authorization absent |
| BUG-020 | VERIFIED_OPEN | Missing auth/500; hypothetical data leak unproven |
| BUG-052 | VERIFIED_OPEN | Concurrency/poison blocking; single-pass atomicity already exists |
| BUG-053 | VERIFIED_OPEN | Latent helper defect; HTTP uses full builder |
| BUG-071 | VERIFIED_OPEN | Admin detail confirmed; merchant-dashboard claim stale |
| BUG-072 | VERIFIED_OPEN | Fanout and historical-window leakage |
| BUG-073 | VERIFIED_OPEN | Suitable search index absent; actual plans need runtime |
| BUG-074 | VERIFIED_OPEN | Cursor/source mismatch; separate-transactions title contradicted |
| BUG-076 | VERIFIED_OPEN | Transaction-list helper; other Bahrain conversions already exist |
| BUG-082 | VERIFIED_OPEN | Inline bar has no meaningful progress ratio |

No assigned bug is wholly ALREADY_FIXED or FALSE_POSITIVE. Stale/false subclaims are called out above rather than hiding the surviving defect. Existing transactions and correct conversions are current protections, not proof of a historical fix. None of the ten primary conclusions depends on running the application.

## Recommended implementation order

1. Close the authorization gaps: BUG-019 and BUG-020; coordinate underlying credential fixes with the auth owner.
2. Fix BUG-052 serialization and agree commit-safe event processing/failure recovery. Then fix BUG-074's shared recovery/cursor boundary; do not rebuild affected historical totals before these safeguards exist. Disposable DB validation depends on infrastructure resolving BUG-014.
3. Fix BUG-072's event-delta aggregate, BUG-071's effective display selection, and BUG-076's date helper. They are independent small correctness changes; retain gross/net distinctions.
4. Fix BUG-053's helper before any HTTP streaming rollout; establish export snapshot/backpressure behavior. Verify BUG-073 plans before selecting/rolling out search indexes.
5. Remove BUG-082's misleading bar. Integrate refunds only after the payment/refund and event prerequisites below are met.

## Refund/reporting dependencies

- **Current boundary:** `apps/api/src/routes/refunds.ts:22-25` returns 501; `apps/api/src/app.ts:60-64` registers that stub. Helpers and schema do not prove an active refund flow. The following are launch/integration prerequisites, not evidence of currently issued HTTP refunds.
- **Payments/refunds handoff:** Resolve BUG-003/BUG-007/BUG-008/BUG-027/BUG-028 before wiring helpers. `apps/api/src/payments/processRefund.ts:165-203,209-256` would update refund state, journal gross/fee reversals, write negative timeline deltas, and emit positive `refund.succeeded.amountFils`. Agree signs and integer-fils contracts, historical fee/discount/tier reversal rules, and count semantics. Existing `Evidence/runtime-artifacts/probe-results.ndjson:9` (P009) records 1,000 captured/25 fee with refund reversals 8+8+8+2=26; cumulative reversal rounding/capping must be addressed without repeating that reproduction.
- **Gross versus net:** Existing report/CSV fields expose cumulative captured amounts (`transactionsReportQuery.ts:56-70`; `transactions/exportCsv.ts:19-27`), analytics exposes captured gross (`analytics/query.ts:111-129`), and settlement summary should remain event-window gross. Refunds must not erase gross capture history or disappear merely because current transaction status changes. Define separate succeeded-refund totals, fee reversals, and net receipts (`gross - refunds`), with payout net also accounting for fees and reversed fees. Aggregate capture and refund streams independently before joining; specify refund-date versus original-sale-date attribution.
- **Missing live rollup support:** `apps/reporting/src/consumer/runConsumerPass.ts:9-13` and `applyEvent.ts:191-200` omit `refund.succeeded`. Dormant `applyDailySummaryRollup` (`applyEvent.ts:164-179`) has no callers, buckets in UTC, and writes `refund_count/refund_gross_fils`, absent from `db/migrations/0027_merchant_daily_volume.sql:18-25` and later migrations. Add compatible schema, Bahrain bucketing, payload validation, live dispatch, API fields, and shared replay handling together. Its comment's `transaction.refunded` name does not match the producer's `refund.succeeded` contract.
- **Refund summary view:** `db/migrations/0072_refund_merchant_summary.sql:5-16` joins transaction ID to refund ID instead of `r.transaction_id` (BUG-014 owner). Correcting the join still repeats `t.captured_fils` for multiple refunds of one transaction. Define that column's business meaning and aggregate/deduplicate at the proper grain; do not use `SUM(DISTINCT amount)` as a shortcut. Repository search found no view reader or refresh call despite its header claiming worker refreshes; assign freshness/rebuild ownership before exposing it.
- **Settlement handoff:** `apps/settlement/internal/settlement/batch.go:148-158,219-243` selects capture events and freezes capture-based totals; no refund-selection path was found in settlement source. Existing refund indexes (`db/migrations/0042_refunds.sql:30-36`, `db/migrations/0071_refund_fee_index.sql:4-6`) do not implement refund claiming or payout adjustments. Dormant `apps/api/src/admin/settlementClient.ts:282-298` scales only `amountFils` by 10 and calls an unregistered `/internal/refund-adjustment`; `apps/settlement/internal/internalapi/server.go:119-124` has no such route. Agree an implemented, idempotent all-fils settlement contract before reporting adjusted payouts; coordinate BUG-010/BUG-032 and paid-batch immutability work.
- **Replay requirement:** A new refund event filter behind the existing numeric cursor will not recover older refund events below that cursor. Inventory retained outbox/source history, define a versioned checkpoint or controlled full backfill with deduplication, and validate event/rollup/ledger/batch parity after BUG-052/BUG-074 are fixed. No replay or rebuild was run here.

## Webhook/event processing handoffs

- Event owner: reporting has its own `reporting_outbox_cursor`; webhook deliveries and `outbox_events.processed_at` must remain independent. Agree producer commit ordering, durable per-consumer deduplication/acknowledgement where needed, poison-event recovery, retained event history, and safe shared rebuild exclusion/cutoffs (BUG-052/BUG-074).
- Webhook owner: add the refund envelope and eligibility together. `apps/api/src/webhooks/dispatcher.ts:28-32` excludes refunds; `apps/api/src/webhooks/envelope.ts:39-82` supports only capture, void, and settlement-paid, then throws. Enabling eligibility alone can abort delivery creation. Reporting's separate switch also needs an explicit refund case. Coordinate raw-body signing (BUG-045) and replay/delivery idempotency with the webhook owner, not with reporting's cursor.
- Payout trend consistency: `applyEvent.ts:93-117` samples current batch status/paid_at on close-event application while preserving event-payload monetary totals; admin rebuild copies all current batch fields. Later paid/repriced/refund-adjusted changes require an agreed update event or live-source read contract. Do not claim payout trend status is necessarily status-at-close, or use this chart as the settlement authority. `db/migrations/0028_merchant_payout_trends.sql:1-10` documents the cached/live distinction.

## Items needing runtime verification

- No runtime activity is required to establish the ten code defects above, and none was performed. Exact incident prevalence, lost amounts, hosted configuration, and production impact remain unverified.
- After authorized fixes, use a disposable migrated DB for two concurrent consumer passes, rollback/crash boundaries, a lower-ID late producer commit, malformed-event recovery, and rebuild-versus-worker/producer overlap. Confirm totals and cursor move together and readers do not see partially rebuilt analytics.
- Validate the complete BUG-073 query with representative data/plans before and after proposed indexes; establish latency and index use rather than repeating the canonical universal-scan claim. HTTP export memory failure is likewise unmeasured.
- Future focused checks: streaming ties across 1,000 rows and microsecond timestamps; two partial captures within/across date bounds; future/backfilled fee schedules; both Bahrain-midnight boundaries; refund fee rounding, positive outbox versus negative timeline signs, and gross/refund/net/ledger/payout parity. These are implementation validation requirements, not instructions to run rebuilds or activate refunds during Phase 0.
