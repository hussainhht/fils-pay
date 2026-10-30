# Phase 0 — Agent 5 — Webhooks

Verify only. No code, tests, migrations, configuration, webhooks, private-network probes, or compose. Reproductions already backed by runtime evidence were not repeated.

| | |
|---|---|
| HEAD | `c389b261c7b481c2b14d12374a5511a07e67f866` |
| Branch | `main` |
| Worktree | `git status --short` empty at verification |
| Date | 2026-10-30 |
| Scope | BUG-045, BUG-046, BUG-047, BUG-048, BUG-049, BUG-050, BUG-051, BUG-068, BUG-069, plus the unnamed Phase 5 `refund.succeeded` eligibility/envelope dependency |

Canonical reports: `Evidence/bugs/bug-045` through `bug-051`, `bug-068`, `bug-069`. Plan: `Evidence/bugfix_plan.md` Phase 0, Phase 5 webhook row, Phase 6 webhook cluster, Phase 7 for BUG-069.

## Settlement and refund handoffs

Paid-batch path, in order:

1. `RunDailyBatch` (`apps/settlement/internal/settlement/batch.go:442-464`) closes the batch, then pays it. A split parent goes through `PayoutSplitBatch` (`apps/settlement/internal/splits/allocate.go:54-150`). Every other merchant goes through `PayoutBatch` (`batch.go:301-371`). Both post ledger legs and set `settlement_batches.status = 'paid'`. Neither inserts `settlement_payout_disbursements` and neither inserts `settlement.paid`.
2. After that, both the daemon (`apps/settlement/internal/scheduler/daemon.go:107`) and `run-batch` (`apps/settlement/cmd/settlement/main.go:133`) call `EnqueuePayoutNotifications` (`payout_notify.go:29-95`). That is a separate `SELECT … NOT EXISTS` plus a later `INSERT` of `settlement.paid`, one statement per batch, outside the payout transaction.
3. The API dispatcher Step A (`apps/api/src/webhooks/dispatcher.ts:88-128`) turns eligible outbox rows into `webhook_deliveries`. `settlement.paid` is eligible (`dispatcher.ts:28-32`). `settlement.batch_closed` is enqueued inside `CloseBatch` (`batch.go:267-270`) and is intentionally absent from the eligible list (`dispatcher.ts:27`).
4. On the first attempt of a delivery (`attempt_count === 0`), `PRE_DELIVERY_EFFECTS['settlement.paid']` inserts a disbursement row (`dispatcher.ts:37-41`, `160-163`; `payoutDisbursement.ts:14-17`) and then the transport POSTs.

Refund path:

`processRefund` already enqueues `refund.succeeded` in the refund transaction (`apps/api/src/payments/processRefund.ts:245-257`). `aggregateType` is `transaction` and `aggregateId` is the transaction id. Payload fields are `merchantId`, `refundId`, `amountFils`, `feeReversedFils`, `refundedTotalFils`, `newStatus`. A partial refund records timeline type `refund_partial` (`processRefund.ts:231`) and still enqueues another `refund.succeeded` for the same transaction. The dispatcher never selects that event type, and `buildEnvelope` has no case for it. Reporting's `REPORTING_EVENT_TYPES` (`apps/reporting/src/consumer/runConsumerPass.ts:8-13`) also omits it. That reporting omission is a separate consumer; it is not given a registry id here.

## Required uniqueness constraints

| Constraint | Where it belongs | Why this shape |
|---|---|---|
| `UNIQUE (callback_id)` on `acquirer_callback_notes` | BUG-048 | `callback_id` is the acquirer message id (`0051_acquirer_callback_notes.sql:8-12`). Several distinct callbacks per transaction are expected, so the unique key is `callback_id`, and `transaction_id` stays non-unique. |
| Partial unique index on `outbox_events (aggregate_id) WHERE event_type = 'settlement.paid'` | BUG-049 | One paid notice per batch. A table-wide `UNIQUE (event_type, aggregate_id)` would reject a second partial capture (`capture.ts:135`, `240-251`, same transaction id) and a second partial refund (`processRefund.ts:245-248`, same transaction id). `CloseBatch` also inserts one `settlement.batch_closed` per batch (`batch.go:267-270`); that event is outside this bug. |
| `UNIQUE (settlement_batch_id)` on `settlement_payout_disbursements` | BUG-050 | One operational disbursement row per paid batch, matching the table comment's intended cardinality. Split children already live in `settlement_batch_splits` (`allocate.go:124-127`). |
| Existing `uq_webhook_deliveries_event_endpoint_original` | already present (`0022_webhook_deliveries.sql:39-41`) | One original delivery per `(outbox_event_id, endpoint_id)`. It does not claim a pending row, and replay rows are excluded by `WHERE replay_of_delivery_id IS NULL`. `delivery_event_id` has no unique index (`0022:9`). |

Index creation for the two new uniques requires existing duplicate `callback_id` values and duplicate `settlement_batch_id` disbursement rows to be removed first. P012 already showed three disbursement rows for one batch.

`INSERT … ON CONFLICT DO NOTHING` has to be the write, not a unique index alone. `withCallbackRetry` (`callbacks.ts:62-77`) repeats a thrown error three times, so a unique violation on the callback insert would surface as a failure after retries. `EnqueuePayoutNotifications` today inserts in a second statement after the `NOT EXISTS` read (`payout_notify.go:32-43`, `86-89`); the conflict target has to be on that insert.

## Phase 5 dependency — `refund.succeeded` (no registry id)

This is the plan's Phase 5 webhook-type row. It is not a new `BUG-NNN`.

| Piece | Current state | Lines |
|---|---|---|
| Outbox union | `"refund.succeeded"` is a member of `EventType` | `packages/events/src/outbox.ts:9-15` |
| Producer | Enqueued on every successful refund, including a later partial refund of the same transaction | `apps/api/src/payments/processRefund.ts:245-257` |
| Eligible list | Absent. Comment says to add it when refunds ship | `apps/api/src/webhooks/dispatcher.ts:25-32` |
| Envelope | `WebhookEventType` is only `transaction.captured`, `transaction.voided`, `settlement.paid`. The default throws `unsupported event type` | `apps/api/src/webhooks/envelope.ts:9`, `42-82` |
| Test of that throw | `settlement.batch_closed` is the fixture; the same default applies to `refund.succeeded` | `apps/api/src/webhooks/envelope.test.ts:38-48` |

Today the event is stored and ignored by Step A, so it does not stall the queue. Adding it only to `WEBHOOK_ELIGIBLE_EVENT_TYPES` makes `buildEnvelope` throw inside the Step A transaction (`dispatcher.ts:26`, `111-116`). Phase 5 has to add the eligible entry and an envelope case in the same change. The envelope `data` fields are the payload fields listed above; `id` stays `delivery_event_id`, and the transaction id is `aggregateId`. The partial-refund case means this event must stay outside the `settlement.paid` uniqueness constraint.

BUG-045 is on the same Phase 5 slice: a `refund.succeeded` body signed with `canonicalJson` and sent with `JSON.stringify` fails merchant raw-body verification the same way captured and paid events do.

## Per bug

### BUG-045 — outbound signature bytes differ from the POST body

**Status:** Confirmed at HEAD. Static. `Evidence/runtime-artifacts/findings.json` FINDING-018 is still `NOT TESTED`; no webhook was sent.

**Current evidence:**

- `signPayload` HMACs `` `${timestamp}.${canonicalJson(payload)}` `` (`apps/api/src/webhooks/sign.ts:31-38`). `canonicalJson` sorts keys recursively before `JSON.stringify` (`apps/api/src/payments/idempotency.ts:42-61`).
- The dispatcher signs `row.payload` and sends `JSON.stringify(row.payload)` (`dispatcher.ts:158`, `165-172`).
- `sendTestWebhookEvent` does the same split (`testSend.ts:57`, `62`).
- A `transaction.captured` envelope is built as `id`, `type`, `createdAt`, `data` with data keys `transactionId`, `merchantId`, `amountCapturedFils`, `feeFils`, `status`, `capturedTotalFils` (`envelope.ts:44-57`). Sorted form is `createdAt`, `data`, `id`, `type` and `amountCapturedFils`, `capturedTotalFils`, `feeFils`, `merchantId`, `status`, `transactionId`. Those strings differ, so the HMAC input differs from the wire body. `settlement.paid` (`envelope.ts:69-80`) and the test payload (`testSend.ts:48-53`) differ the same way.
- `dispatcher.test.ts:162-172` parses the body and calls `verifySignature`, which canonicalizes again (`sign.ts:92-94`). A green run agrees with itself and does not check the raw body.

**Existing evidence:** `Evidence/bugs/bug-045-webhook-signature-mismatch.md`. `docs/HANDOVER.md:46-47` (unmerged `ya/sign-raw`). FINDING-018.

**Smallest fix:** In `attemptOneDelivery` and `sendTestWebhookEvent`, build one string with `canonicalJson` once, HMAC that string, and send that string.

**Dependencies:** Phase 5 `refund.succeeded` envelope uses this sender. `sign.test.ts` locks canonical key-order independence; keep that, and add a raw-body assertion beside `dispatcher.test.ts:171`.

### BUG-046 — inbound HMAC reserializes the parsed object

**Status:** Confirmed at HEAD. Static for the raw-body mismatch. Freshness is already shown by P011 (`signatureFromUnixSecond1StillValid: true`). P011 was not re-run. P011 signs `JSON.stringify` of the same object the verifier stringifies, so it does not exercise a raw-body mismatch.

**Current evidence:**

- `verifyAcquirerCallbackSignature` HMACs `` `${timestamp}.${JSON.stringify(payload)}` `` (`inboundVerify.ts:61-63`). The route passes Fastify's parsed `request.body` (`routes/acquirerCallbacks.ts:57-62`). No raw-body parser exists under `apps/api/src`.
- `parsed.timestamp` is never compared with now (`inboundVerify.ts:32-33`, `58-69`).
- Comparison is `constantTimeEquals` (`inboundVerify.ts:40-43`, `65`): `Buffer.from` of the hex text (UTF-8, no `'hex'` encoding) and `Buffer.compare`. `timingSafeEqualHex` is the outbound helper (`sign.ts:96`). The canonical report's phrase "decoded bytes" is imprecise; the compare is over the hex text. The missing `timingSafeEqualHex` claim still matches.
- Unit and route tests build the header with `JSON.stringify` of the object (`inboundVerify.test.ts:16`; `acquirerCallbacks.test.ts:62-64`).

**Existing evidence:** `Evidence/bugs/bug-046-inbound-callback-hmac-reserialized.md`. P011 / EVID-021 / FINDING-008 for the stale-timestamp half (`Evidence/FilsPay_Runtime_Security_Investigation.md`, `Evidence/runtime-artifacts/probes1.mjs`, `probe-results.ndjson`).

**Smallest fix:** HMAC `` `${timestamp}.${rawBody}` `` on `POST /v1/acquirer/callbacks`, reject `t=` outside a max age, and compare with `timingSafeEqualHex`.

**Dependencies:** BUG-047. Turning signatures on while this verifier reserializes rejects a raw-body signature whose key order or spacing differs from `JSON.stringify` of the parsed object. Tests that sign the parsed object need a raw-body case.

### BUG-047 — unsigned callbacks accepted

**Status:** Confirmed at HEAD. Runtime already proven (P011: two unsigned `200`s). Not re-run. Plan list "already proven, fix without re-demo" includes this id.

**Current evidence:**

- `acquirerCallbackRequireSignature` defaults to `false` in every environment (`config.ts:259` via `parseBoolEnv`, `config.ts:148-150`). Production requires `ACQUIRER_CALLBACK_SIGNING_SECRET` (`config.ts:192-194`) and still defaults the require flag to false. `docs/ARCHITECTURE.md:91` records that default.
- Missing header returns `{ valid: true }` when the flag is false (`inboundVerify.ts:52-56`). The route passes the flag (`acquirerCallbacks.ts:57-62`).
- Live path is `POST /v1/acquirer/callbacks` (`app.ts:72` prefix `/v1/acquirer`, route `/callbacks` at `acquirerCallbacks.ts:41`). The canonical report's reachability string `POST /v1/acquirer-callbacks` is stale.
- `outcome` is cast onto `AcquirerCallbackInput` (`acquirerCallbacks.ts:67-72`). The column is `TEXT NOT NULL` with no allowed-value check (`0051:20`). The route comment (`acquirerCallbacks.ts:10-12`) says the body is validated against `"approved" | "rejected"`. That comment is stale. The TypeScript union is `"cleared" | "confirmed_fraud"` (`callbacks.ts:10`).
- The route test asserts the unsigned `200` (`acquirerCallbacks.test.ts:124-139`) under `NODE_ENV: "test"` (`acquirerCallbacks.test.ts:24`).

**Existing evidence:** `Evidence/bugs/bug-047-acquirer-callback-signature-optional.md`. P011 / EVID-021 / FINDING-008.

**Smallest fix:** Default the flag to true outside development. Reject a missing or invalid signature. Accept only `cleared` and `confirmed_fraud` before the cast.

**Dependencies:** BUG-046, or legitimate raw-body callbacks fail once the flag is on. The function default `requireSignature = false` (`inboundVerify.ts:50`) stays a footgun for any caller that omits the flag; the route currently passes config. Update `acquirerCallbacks.test.ts:124-139`.

### BUG-048 — duplicate callback notes

**Status:** Confirmed at HEAD. Runtime already proven (P011: same `callbackId`, two notes). Not re-run. On the already-proven list.

**Current evidence:**

- Plain insert (`apps/api/src/acquirer/callbacks.ts:37-50`).
- `0051_acquirer_callback_notes.sql:8-12` states `callback_id` is not unique. Lines 29-31 say `processed_events` and an FP-238 unique index are done. No `processed_events` relation exists in `db/migrations`.
- P011 negative control still holds in source: the insert does not change `transactions.status` or the ledger (`callbacks.ts:23-25`).

**Existing evidence:** `Evidence/bugs/bug-048-duplicate-acquirer-callback-notes.md`. P011 / EVID-021 / FINDING-008.

**Smallest fix:** `UNIQUE (callback_id)` plus `INSERT … ON CONFLICT DO NOTHING`, then HTTP 200.

**Dependencies:** `withCallbackRetry` (`callbacks.ts:62-77`). Duplicate `callback_id` rows must be cleared before the index is created. Keep `transaction_id` non-unique.

### BUG-049 — duplicate `settlement.paid` outbox rows

**Status:** Confirmed at HEAD. Static. Phase 0 stops at the missing index; no concurrent HTTP or compose race was run. The sequential test `TestEnqueuePayoutNotificationsIsIdempotent` (`payout_notify_test.go:87-98`) only covers a second call after the first has finished.

**Current evidence:**

- `SELECT` with `NOT EXISTS` (`payout_notify.go:32-43`), then a separate `INSERT` (`payout_notify.go:86-89`). Comments at `payout_notify.go:23-28` say the guard is idempotent and that a unique `(event_type, aggregate_id)` index exists.
- `0009_outbox_events.sql:5-15` has no unique index on `(event_type, aggregate_id)`. No later migration adds one.
- Both callers run on the same batches: daemon (`daemon.go:99-107`, including the "resolved, see FP-260" comment) and CLI (`main.go:128-137`).

**Existing evidence:** `Evidence/bugs/bug-049-duplicate-payout-notifications.md`. Incident notes in `docs/ADMIN.md:103-114` (see stale list).

**Smallest fix:** Partial unique index `outbox_events (aggregate_id) WHERE event_type = 'settlement.paid'`, and one `INSERT … ON CONFLICT DO NOTHING`. Drop the check-then-insert.

**Dependencies:** The table-wide unique in the plan text would break partial capture and partial refund. BUG-050: each extra `settlement.paid` row becomes another delivery, and each first attempt inserts another disbursement. `PayoutBatch` / `PayoutSplitBatch` stay the paid-status writers; this bug is only the notify insert.

### BUG-050 — disbursement row written by webhook attempt

**Status:** Confirmed at HEAD. Runtime already proven (P012: 2 endpoints → 2 rows; one replay → 3 rows, sum 2925 fils). Not re-run. On the already-proven list.

**Current evidence:**

- Effect map and call (`dispatcher.ts:37-41`, `160-163`). Insert with `gen_random_uuid()` and no conflict target (`payoutDisbursement.ts:14-17`). Amounts `<= 0` return before insert (`payoutDisbursement.ts:9-12`); the notify scan also skips `net_payout_fils <= 0` (`payout_notify.go:36`).
- Non-unique index only (`0057_settlement_payout_disbursements.sql:17-18`). Comment at `0057:20-21` says the row is written inside `PayoutBatch`'s transaction, one per batch.
- `PayoutBatch` (`batch.go:301-371`) and `PayoutSplitBatch` (`allocate.go:54-150`) do not insert into `settlement_payout_disbursements`.
- A merchant with zero endpoints never reaches the effect, so a paid batch can have no disbursement row. N endpoints produce N rows. A thrown transport leaves `attempt_count` at 0 (`dispatcher.ts:233-242`), so the next pass runs the effect again.
- Replay rows are inserted without `attempt_count`, so they take the column default `0` (`0022:12`) and the effect runs again. P012 observed that.

**Existing evidence:** `Evidence/bugs/bug-050-payout-disbursement-recorded-by-webhook.md`. P012 / EVID-022 / FINDING-010. `Evidence/trailofbits-audit/01_ARCHITECTURE.md` and `02_SPEC_COMPLIANCE.md` S24 agree with these lines.

**Smallest fix:** Insert the disbursement inside the payout transaction and delete `PRE_DELIVERY_EFFECTS`. Add `UNIQUE (settlement_batch_id)`.

**Dependencies:** Both payout functions must write the row. A patch that only edits `PayoutBatch` leaves split parents (`batch.go:452-457`) on the old side effect until that effect is removed, and then records nothing for them. Clear duplicate disbursement rows before creating the unique index. BUG-068 stops being a second writer only after the effect is gone. `payoutDisbursement.test.ts:41-58` asserts the helper insert and will move with the writer.

### BUG-051 — webhook URL has no private-network check

**Status:** Confirmed at HEAD. Static. No URL was requested and no private network was probed.

**Current evidence:**

- `validateWebhookUrl` accepts any absolute `http:` or `https:` URL, and in production rejects non-`https:` (`create.ts:15-28`). No host, IP, or DNS check. `updateWebhookEndpoint` uses the same function (`update.ts:38-39`).
- `fetch` is called without `redirect` (`transport.ts:40-45`), so the default is follow.
- Test send returns up to 2000 characters of the response body (`testSend.ts:66-68`). Delivery rows also store `left(response_body, 2000)` (`dispatcher.ts:186`) and the merchant delivery DTO includes `responseBodyExcerpt` (`deliveries.ts:14`, `51`).
- Step B reads the live `webhook_endpoints.url` (`dispatcher.ts:221-223`), so a URL edited after the event is the URL that is fetched.

**Existing evidence:** `Evidence/bugs/bug-051-webhook-url-ssrf.md`.

**Smallest fix:** In `validateWebhookUrl`, deny loopback, link-local, RFC1918, and metadata addresses after resolution. Set `redirect: "manual"` on the transport. Do not echo a response body for a rejected target.

**Dependencies:** Create and update share the validator. BUG-069's live URL join means a check only at insert time is insufficient unless the URL is snapshotted onto the delivery row. Production `https`-only does not deny a public-scheme URL that resolves privately.

### BUG-068 — replay mints a new delivery id

**Status:** Confirmed at HEAD. The identity change and the extra disbursement are already in P012 (`bodyAndHeaderEventIdsChanged: true`, disbursement count 2 then 3). Not re-run. Canonical registry status remains "statically confirmed"; the runtime sample is P012.

**Current evidence:**

- `insertReplayDeliveryRow` sets `newDeliveryEventId = randomUUID()` and overwrites payload `id` (`replay.ts:48-49`, insert `51-63`). `attempt_count` is omitted and defaults to 0 (`0022:12`).
- The same row's retries keep `delivery_event_id` (`dispatcher.ts:169`). Only replay replaces it.
- `attemptOneDelivery` already signs with the current time (`dispatcher.ts:143-145`, `158`). A new id is not what refreshes `t=`.
- The function comment (`replay.ts:24-34`) says a new id is required so receivers do not dedupe the replay, and so the timestamp stays fresh. The freshness half of that comment does not match the sender. `headers.ts:10-13` and `0022:9` call `delivery_event_id` the stable dedupe key. `0022:43-44` says a replay must reuse it.

**Existing evidence:** `Evidence/bugs/bug-068-webhook-replay-new-delivery-id.md`. P012 / EVID-022 / FINDING-010 (identity plus disbursement). FINDING-019 is still `NOT TESTED` and was not run.

**Smallest fix:** Keep the original `delivery_event_id` and payload `id` on replay. Re-signing stays in `attemptOneDelivery`. Until BUG-050 removes the effect, also skip `PRE_DELIVERY_EFFECTS` when `replay_of_delivery_id IS NOT NULL`.

**Dependencies:** BUG-050. No unique index on `delivery_event_id`, so reusing the original id does not collide with `uq_webhook_deliveries_event_endpoint_original` (replay rows are outside that partial index).

### BUG-069 — due deliveries are not claimed

**Status:** Confirmed at HEAD. Static. No second replica was started.

**Current evidence:**

- Step B selects `status = 'pending'` with no `FOR UPDATE`, no `SKIP LOCKED`, and no status change before the HTTP call (`dispatcher.ts:217-227`). The in-process `running` flag (`dispatcher.ts:283-287`) only stops overlapping passes inside one process.
- The select joins `webhook_endpoints` for `url` and `secret_ciphertext` and does not require `we.status = 'active'` (`dispatcher.ts:221-224`). Step A does require `we.status = 'active'` (`dispatcher.ts:96`).
- `webhook_deliveries` has no URL column (`0022:4-21`), so the send uses the endpoint URL at attempt time.
- `index.ts:29` says `SKIP LOCKED` in the claim query makes multiple replicas safe. That clause is not in the query. `dispatcher.ts:217` says the opposite: no `SKIP LOCKED`, one replica.

**Existing evidence:** `Evidence/bugs/bug-069-webhook-delivery-no-claim.md`.

**Smallest fix:** Claim the row before HTTP (`UPDATE … WHERE status = 'pending' … RETURNING`, or `FOR UPDATE SKIP LOCKED` plus a status flip). Require `we.status = 'active'` in the due query. Copy `url` onto the delivery row when the row is created.

**Dependencies:** BUG-051, because a later URL edit is what Step B fetches. The existing partial unique index does not serialize two processes that have already selected the same pending row.

## Stale claims

These contradict the tree at this HEAD. The bug reports above stay current except for the one path string called out on BUG-047.

| Claim | Where | What the code does |
|---|---|---|
| `processed_events` dedupes callbacks; FP-201 status Done (2026-05-14) | `docs/incidents/postmortem-2026-05.md:23-27`, `:117`; `docs/HANDOVER.md:63-64`; `0051:29-31` | No `processed_events` table. Insert is unconditional (`callbacks.ts:37-50`). P011 appended two notes. The postmortem's second-capture mechanism is also stale: this handler only inserts a note (`callbacks.ts:23-25`). |
| Pay records the disbursement inside `PayoutBatch` | `0057:20-21`; `docs/ARCHITECTURE.md:50-51` | Disbursement insert is the dispatcher effect (`dispatcher.ts:37-41`, `160-163`). `PayoutBatch` posts ledger legs only (`batch.go:334-368`). |
| Replay reuses the original delivery ids | `docs/ADMIN.md:89` | `replay.ts:48-49` assigns a new UUID and overwrites `id`. The next paragraph of ADMIN.md (`:92-94`) matches the code. `0022:43-44` and `headers.ts:12` state the stable-id rule the code does not follow on replay. |
| 2026-08-21 duplicates were the same outbox rows woken twice by the reporting worker | `docs/ADMIN.md:108` | Notify insert has no unique key (`payout_notify.go:86-89`, `0009:5-15`). P012 multiplied disbursements from one outbox row across endpoints and a replay. The AM note in the same table (`ADMIN.md:112`) already says the two deliveries had different outbox ids. |
| Dispatcher canonicalizes, so key order is resolved | `packages/events/src/outbox.ts:92` | The signature uses `canonicalJson`; the body uses `JSON.stringify` (`dispatcher.ts:158`, `172`). `docs/HANDOVER.md:46-47` matches the code. |
| Test send signs the bytes it sends | `testSend.ts:31` | `testSend.ts:57` versus `:62`. |
| `create.ts` blocks private IPs; https-only is the SSRF control | `transport.ts:38`; `create.ts:13` | `validateWebhookUrl` checks scheme only (`create.ts:15-28`). |
| Outbox unique index makes payout notify idempotent; CLI overlap is resolved (FP-260) | `payout_notify.go:23-28`; `daemon.go:99-106` | No such index. Daemon and CLI both insert (`daemon.go:107`, `main.go:133`). |
| `SKIP LOCKED` makes webhook replicas safe | `index.ts:29` | Due query is an unlocked select (`dispatcher.ts:220-227`). |
| Callback `outcome` is validated as `approved` or `rejected` | `acquirerCallbacks.ts:10-12` | No runtime check (`acquirerCallbacks.ts:67-72`). Stored outcome is unconstrained (`0051:20`). |
| Reachability `POST /v1/acquirer-callbacks` | `Evidence/bugs/bug-047-acquirer-callback-signature-optional.md` section 2 | Route is `POST /v1/acquirer/callbacks` (`app.ts:72`, `acquirerCallbacks.ts:41`). The rest of BUG-047 matches HEAD. |

`Evidence/bugs/Readme.md` already marks the 2026-05-14 postmortem as cover. That readme was not edited.
