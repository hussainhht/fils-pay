# Webhook audit, implementation and verification

Date: 2026-10-30 (Asia/Bahrain). Initial baseline:
`13d8161faa23c7bec60c7a6c4aba2431b4506b44`; working tree was clean.
During verification, HEAD changed externally to
`85803e4c8f43fc6e02a9b053db02a20d1378ae57`, incorporating the initial webhook
changes and temporary logs. This agent did not commit, stage, switch branches,
or push. Existing staged `.api-run.log` and other externally staged work were
preserved. The capture lock-order correction and final documentation were made
after that external commit.

## Current architecture and requirements

Read `context/README.md` and the relevant architecture, API, event-package,
dependency, payment, security and testing context; `docs/ARCHITECTURE.md`, ADR
0001 and the ADR index, onboarding/refund requirements, admin webhook guidance,
historical webhook evidence, migrations, and the actual producer/consumer paths.
The read-only architecture dossier is
`Evidence/implementation/webhook-context.md`. Historical reports were treated
as leads; `Evidence/old-agints-instration/` was not read.

FilsPay supports **both directions**:

- Outgoing merchant notifications: capture, void, successful refund and paid
  settlement existed at baseline. The API process consumes committed outbox
  records independently of reporting, creates durable per-endpoint delivery rows,
  signs canonical wire bytes, and sends asynchronously through native HTTP(S).
- Incoming `POST /v1/acquirer/callbacks`: signed fraud-review verdicts append
  informational notes. They do not capture money, alter status, reopen holds,
  refund or settle. Actual callback outcomes are `cleared` and `confirmed_fraud`;
  some old comments/specifications said otherwise.
- The merchant dashboard already implements registration, show-once secret,
  URL/status management, delivery history and replay. Existing middleware enforces
  tenant scoping, owner/finance mutations, support delivery reads and read-only
  admin impersonation. No additional UI was required or added.

Relevant existing schema: `outbox_events` (0009), endpoint/notification trigger
(0021), deliveries and original-pair uniqueness (0022), archives (0068), payout
notification uniqueness (0078), callback-ID uniqueness (0081). Delivery state is
not an outbox status/cursor. Actual NOTIFY channel is `outbox_events_channel`.
Settlement's paid-state scan is durable and uses the existing unique index;
webhook delivery/replay does not create payout disbursements or ledger entries.

## Confirmed findings and status delta

The following are scoped audit IDs, not replacements for the historical registry.

| ID | Severity | Confirmed before | Change/proof | Current status |
| --- | --- | --- | --- | --- |
| WH-01 | P2 | Definitive payment declines had no merchant notification | Declines now enqueue `payment.failed` with the completed, locked idempotency claim. Baseline regression received no event; duplicate/concurrent tests assert one. | `fix-verified` |
| WH-02 | P2 | Active expired payment links had no notification producer | Bounded transactional scanner emits `payment_link.expired`; serialized scanner and row locks prevent duplicate expiry events. Baseline regression received no event. | `fix-verified` |
| WH-03 | P2 | Decryption/unexpected transport exceptions left zero attempts and retried indefinitely; raw exceptions were logged | Exceptions now share the bounded retry policy; failure detail is not logged. Baseline test stayed pending, fixed test exhausts. Poisoned-secret test now checks exhaustion and merchant isolation. | `fix-verified` |
| WH-04 | P2 | Callback validation accepted object/string-invalid fields and reached DB lookup/errors | Enforce nonempty strings, UUID, ISO timestamp with timezone, allowed outcome. Baseline malformed input returned 404 instead of 400; fixed route rejects before lookup. | `fix-verified` |
| WH-05 | P2 | Development registration blocked private literals, but public DNS names resolving privately passed transport validation | Resolve-time filtering now applies outside explicit test mode. Exact regression fails against baseline transport and passes after. | `fix-verified` |
| WH-06 | P3 | Positive jitter could exceed configured backoff cap (2200 ms with a 2000 ms cap) | Clamp the final jittered result. Exact regression fails against baseline dispatcher and passes after. | `fix-verified` |
| WH-07 | P1 | Concurrent same-key capture prepare/apply could deadlock because locks were acquired in reverse order | Full suite reproduced PostgreSQL `40P01`. Apply now matches prepare's claim-then-transaction order. Eight concurrent declines return 402, publish one event and write no ledger entries. | `fix-verified` |

Historical BUG-045, 046, 047, 048, 049, 050, 051, 068, 069 and 070 are
`already-fixed` at the initial baseline for their original reported mechanisms:
canonical wire signing, raw inbound verification, production mandatory signature,
callback uniqueness, payout event uniqueness, finance-independent delivery,
production SSRF controls, stable replay identity, leased delivery claims and
safe endpoint disable/delete. WH-05 is a development-mode extension of SSRF
protection, rather than a claim that production lacked DNS validation.

Scoped final counts (17 findings): `already-fixed` 10, `fix-verified` 7;
`historical-report`, `confirmed-current`, `duplicate`, `stale-or-invalid`, and
`unverified` 0 each. These are not repository-wide historical totals. Production
acceptance items below remain verification limits, not asserted vulnerabilities.

## Files and compatibility

- `packages/events/src/outbox.ts`: additive event and aggregate types.
- `apps/api/src/payments/authorize.ts`, `capture.ts`: publish definitive declines
  in their existing apply transaction. Capture also aligns lock order; amounts,
  fees, ledger formulas, external operation identities and payment states are
  unchanged.
- `apps/api/src/paymentLinks/expire.ts`: serialized bounded expiry notification
  scanner using existing schema; no link-state mutation.
- `apps/api/src/webhooks/envelope.ts`, `dispatcher.ts`: explicit new envelopes,
  expiry scan, registration-before-expiry rule, bounded exception handling and
  strict backoff cap. Database outcome-write failures retain their lease.
- `apps/api/src/webhooks/transport.ts`: development DNS protection; test mode
  retains loopback support for local receivers.
- `apps/api/src/routes/acquirerCallbacks.ts`: boundary validation and corrected
  outcome comment, with existing raw-byte signature checks preserved.
- `apps/api/src/webhooks/auditLifecycle.test.ts`, `auditTransport.test.ts`:
  lifecycle, receiver, concurrency, rollback, lease recovery and security regressions.
- `apps/api/src/webhooks/dispatcher.test.ts`: strengthen poisoned-secret checks
  for bounded retries and make direct expected-backoff calculations deterministic
  using the existing injected jitter function. Existing HTTP outcome/attempt
  assertions remain; no tests were skipped or disabled.
- `docs/WEBHOOKS.md`: canonical merchant/incoming contracts and operational limits.
  Relevant persistent context is refreshed, including event/API module details,
  architecture, dependency map, payment/security descriptions, testing, known
  issues and changelog.

No dependencies, migrations, schema definitions, protected money code,
settlement implementation, or `apps/api/src/v1/` partner contracts were changed.
The two new merchant event types are additive external behavior: all active
endpoints receive eligible types, so receivers must tolerate unknown types.
The four existing envelopes are preserved. Callback malformed inputs now return
400; valid existing callback contracts are preserved. Endpoint secrets retain
the existing authenticated show-once creation response; list/history responses
never return plaintext or ciphertext secrets. No new secret exposure was added.

## Payloads, transaction boundaries and security

See `docs/WEBHOOKS.md` for every field. All notifications use
`{ id, type, createdAt, data }`, integer fils, `Webhook-Delivery-Id`, and
`Webhook-Signature: t=...,v1=...`. HMAC-SHA256 covers the exact transmitted
canonical JSON bytes prefixed with the timestamp. Retries/replays refresh the
signature timestamp and retain identity. IDs belong to event/endpoint pairs;
receivers must persist IDs with their effects and enforce a freshness window.
Freshness alone cannot prevent replays within that window.

Definitive authorize/capture declines emit `payment.failed` with
`paymentAttemptId`, optional `transactionId`, `stage`, `amountFils`, `reason` and
`merchantId`. An authorization decline has no transaction row; the durable
idempotency claim is its aggregate. Unknown network/provider outcomes do not
assert failure. Idempotent replays return before event insertion.

Expiry remains derived from server time. The scanner locks an advisory scanner
key before taking its SELECT snapshot, then locks up to 500 active expired links
and atomically records missing events. Reserved/paid/canceled links are excluded.
Restart polling recovers missed scans. Endpoints created after the actual expiry
are excluded even if the scanner catches up later. Tokens/card data are omitted.

The dispatcher only observes committed events. Capture/refund ledger entries
and their existing outbox rows commit atomically. An HTTP failure changes only
delivery metadata; it cannot roll back or repeat financial processing.
Transport uses HTTPS in production, validates/pins resolved addresses outside
test, rejects private targets and redirects, bounds DNS/headers/body time,
caps response buffering at 64 KiB, and stores at most 2000 response characters.
Incoming HMAC verification uses raw bytes, constant-time comparison, mandatory
production/test signatures, a 300-second window and unique callback IDs.

Retries default to 8 attempts, 30-second exponential base, 6-hour cap and jitter.
2xx succeeds; non-2xx/timeouts/preparation failures retry then exhaust. A single
due delivery is claimed with `FOR UPDATE SKIP LOCKED` and a timeout-covering
lease (minimum 30 seconds); no HTTP call holds a DB transaction. Crash recovery
reclaims expired leases. At-least-once delivery requires receiver deduplication
if a crash occurs after receiver acceptance but before outcome persistence.
Attempt count and latest response are retained, not one log row per retry.

## Environment and commands with actual outcomes

Windows; Node 22.19.0, npm 10.9.3, Go 1.24.2, PostgreSQL 18.6. Docker is absent;
PostgreSQL 16 container parity was not verified. `DATABASE_URL` and
`ops/.env.docker` were initially absent from the shell/workspace. Existing
`.env.local` pointed at a reachable loopback development database; its role
cannot create databases. No data was written there. Instead a separate cluster
was initialized in the temporary directory on loopback port 55439. Starting it
required sandbox escalation because Windows restricted-token process launch
failed; automatic review approved the isolated server start.

Applied **79 existing migrations** to fresh isolated test databases, with no
destructive seed or truncation. The API test DB is named
`filspay_test_webhooks` to satisfy TOTP test isolation checks; settlement has a
separate fresh test DB. All payment calls use deterministic mocks or the local
acquirer simulator, never a real payment provider.

| Command/check | Actual result |
| --- | --- |
| `node --import tsx --test apps/api/src/webhooks/auditLifecycle.test.ts` on baseline | Happy-path receiver test passed; missing events, unbounded exception and malformed callback regressions failed (1 pass, 3 failures). |
| Transport regressions loaded against exact baseline source from `git show` | Retry-cap and development-DNS tests failed; existing timeout behavior passed (1 pass, 2 failures). Temporary baseline modules were removed. |
| Focused lifecycle/transport tests after lock-order fix | 10 passed, 0 failed. |
| Initial full API run | 553/557 passed; database-name guard (2), assertion sorting (1), random expected jitter (1). No failures were hidden. |
| Second full API run on correctly named isolated DB | 556/557 passed; exposed capture `40P01`, subsequently corrected. |
| Final full API run | **557 passed, 0 failed, 0 skipped**; exit 0, 331 seconds. |
| `npm.cmd run typecheck` | Passed across all workspaces, DB and scripts, including final lock-order change. |
| `npm.cmd run test -w @filspay/reporting` | 13 passed, 0 failed. |
| `npm.cmd run test -w @filspay/events` | 4 passed, 0 failed. |
| `npm.cmd run build -w @filspay/web` and `@filspay/admin` | Both passed. |
| `go test ./...` and `go build ./cmd/settlement` on fresh DB | Both passed, exit 0. Default Go cache first failed Windows ACL access; rerun with a separate temporary `GOCACHE` passed. Build output was written to the temporary directory. |

The comprehensive API suite exercises webhook tenant authorization, support
roles, impersonation restrictions, incoming invalid/stale signatures, duplicate
callback IDs, full/partial financial flows, replay, archives, concurrent sends
and listener reconnect. New tests cover decline/expiry events, eight concurrent
same-key declines, expiry scanner contention, rollback invisibility, leased
recovery, exception exhaustion, real timeout, strict cap and development DNS.

## Runtime evidence

The standard ports 3000/5173 were occupied; existing processes were preserved.
`node ops/preview.mjs` was attempted and refused the occupied web port. A fresh
API process used 3099 and equivalent Vite previews used 5193/5194 against the
isolated database. Checks returned:

```text
3099 /healthz -> 200
3099 /readyz -> 200
5193 /dashboard/login -> 200
5194 /login -> 200
5193 /healthz (proxy) -> 200
5194 /healthz (proxy) -> 200
5193 /v1/merchants/<fixture>/webhook-endpoints -> 401 (unauthenticated)
5194 /v1/admin/merchants -> 401 (unauthenticated)
```

An authenticated, newly provisioned local test merchant then registered its
endpoint through actual HTTP, authorized and captured through the running API,
and received the asynchronous background POST on a loopback HTTP server. The
receiver recomputed HMAC over raw bytes and checked header/body identity:

```json
{"runtime":{"type":"transaction.captured","signatureValid":true,"identityMatches":true},"delivery":{"status":"succeeded","attempt_count":1}}
```

The automated real receiver also returned 500 once, then accepted retry with the
same identity; it subsequently verified partial and full refund notifications.
Duplicate capture/refund requests produced no extra business events or refund
rows; repeated delivery passes did not add ledger rows or settlement batches.

An additional API child process on 3109 was booted with a persisted future-due
delivery, stopped, and booted again after making that delivery due. Its real
background dispatcher delivered the original identity once and persisted success:

```json
{"actualProcessRestart":true,"receiverCalls":1,"identityPreserved":true,"signatureValid":true,"delivery":{"status":"succeeded","attempt_count":1}}
```

Test endpoints were disabled after manual runtime checks; owned alternate-port
API/preview processes were stopped. Existing user processes were left alone.
The isolated PostgreSQL instance was stopped after verification; its temporary
data directory was retained. No development database or user service was stopped.

## Remaining limits and deployment acceptance

- This is local functional/security verification, not production certification.
  Production TLS certificates, external DNS/egress policies, secret-manager key
  continuity, real acquirer interoperability, load and alerting were not tested.
- No PostgreSQL 16 Docker stack, full settlement/reporting daemon stack, browser
  interaction through OTP/KYC, or real bank payout was run. Automated auth/tenant
  tests and real API/proxy checks are distinct from a browser journey.
- Receiver exactly-once effects require receiver-side deduplication. Replays are
  authenticated/authorized but deliberately resend the same identity.
- Expiry scanning depends on the API being up; downtime delays notification but
  cannot make an expired link payable. Reserved ambiguous checkouts are excluded
  until their existing business recovery resolves them. Notification timestamps
  reflect scanning time; `expiredAt` preserves the actual expiration instant.
- Large-backlog query performance, outbox retention preserving expiry dedup
  records, monitoring pending/exhausted deliveries and repeated DB-write failure
  alerts need deployment-specific validation. No new index/schema was introduced.
- Secret rotation retains the existing recreate-endpoint workflow; no bespoke
  key-rotation UI, per-attempt history schema or new delivery service was invented.
- ADR 0003/0004/0006 versus ledger/accounting and HANDOVER remain human policy
  questions; proposed ADR 0005 was not implemented. These conflicts were not
  resolved through webhook changes.
