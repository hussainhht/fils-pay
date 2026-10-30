# Webhooks

FilsPay sends merchant notifications and receives informational acquirer fraud
review callbacks. Payment authorization, capture and refund use the existing
synchronous acquirer interface; callbacks do not capture, refund, or settle funds.

## Merchant delivery contract

Register an endpoint using `POST /v1/merchants/:merchantId/webhook-endpoints`.
The authenticated merchant must own the path and have owner/finance access.
The generated secret is returned once on creation; store it securely. Listing,
history, and update responses contain only its prefix. Secrets are encrypted
with AES-256-GCM in the database. Recreate an endpoint to obtain a new secret;
there is no separate rotation endpoint.

Each POST has JSON `{ id, type, createdAt, data }`. `id` matches the
`Webhook-Delivery-Id` header and stays constant through retries and manual
replays of that delivery. IDs are scoped to an event/endpoint pair.
`createdAt` is the outbox timestamp, not the sending time. Amounts are integer
fils. The table lists `data` fields; all include `merchantId`.

| Type | Data fields | Meaning |
| --- | --- | --- |
| `transaction.captured` | `transactionId`, `amountCapturedFils`, `feeFils`, `status`, `capturedTotalFils` | A full or partial capture committed. |
| `transaction.voided` | `transactionId` | A void committed. |
| `refund.succeeded` | `refundId`, `transactionId`, `amountFils`, `feeReversedFils`, `refundedTotalFils`, `status` | A full or partial refund committed. |
| `settlement.paid` | `settlementBatchId`, `batchDate`, `netPayoutFils` | The settlement service observed a paid batch. |
| `payment.failed` | `paymentAttemptId`, optional `transactionId`, `stage`, `amountFils`, `reason` | Definitive authorize/capture decline. Stage is `authorize` or `capture`; reason is `card_declined`. |
| `payment_link.expired` | `paymentLinkId`, `amountFils`, `expiredAt` | An active, unpaid link passed its server expiry time. |

The final two types were added on 2026-10-30. Existing payloads and partner
HTTP routes are unchanged. All active endpoints receive eligible types;
receivers must tolerate unknown event types. `paymentAttemptId` identifies the
durable idempotency claim, since authorization declines have no transaction row.
Ambiguous network/provider errors are not definitive declines and emit no
`payment.failed` event. Reserved links can still complete and emit no expiry
notification while reserved. Expiry is derived; the notification scanner does
not modify payment-link status. Its bounded scan resumes after restart.

Endpoints receive events going forward from registration. Expiry notifications
also require that registration preceded `expiredAt`; registering an endpoint
does not backfill previously expired links. Delivery order is not guaranteed.

## Receiver verification and deduplication

`Webhook-Signature` has `t=<unix seconds>,v1=<hex HMAC-SHA256>`.
Compute the HMAC using the endpoint secret over `timestamp + "." + rawBody`.
Compare in constant time, reject timestamps outside a suitable window (the
repository verifier defaults to 300 seconds), then persist `id` in the same
transaction as receiver business effects. A timestamp alone does not prevent
replays within its validity window. Acknowledge already processed IDs with 2xx.
Each retry/replay gets a fresh timestamp and signature with the same identity.
Never log signing secrets, payment-card data, or full authorization headers.

## Delivery and recovery

Committed outbox rows are independent of reporting's cursor. The API listener
uses `outbox_events_channel` plus polling (default 5 seconds). Delivery creation
is unique per outbox event/endpoint. One due row is leased at a time using
`FOR UPDATE SKIP LOCKED`; the lease is at least 30 seconds and exceeds the
configured request timeout. Expired leases become eligible after a crash.
No payment/settlement transaction is held open during HTTP delivery.

2xx succeeds; other statuses, timeouts and preparation errors retry with capped
exponential backoff and jitter. Defaults are 8 attempts, 30-second base and
6-hour cap. Exhausted deliveries need authorized replay after the problem is
fixed. The delivery record retains an attempt count, last attempt/status and
bounded response excerpt, rather than a separate row per retry. There is no
exactly-once HTTP guarantee: a receiver can process a request before an API
crash prevents acknowledgement persistence. Receiver idempotency is required.

Production requires HTTPS. Outside the explicit test environment, registration
rejects internal targets and delivery resolves DNS, rejects private results,
and pins the validated address. Redirects are not followed. DNS, headers and
body consumption share a timeout; response buffering is capped at 64 KiB.
Development permits public HTTP endpoints; loopback receivers require test mode.

The merchant dashboard provides registration, endpoint management, delivery
history and replay. Owner/finance can mutate; support can read delivery logs.
Admin impersonation is read-only. Admin replay has its own session/role checks
and audit trail. No delivery or replay performs financial writes.

## Incoming acquirer contract

`POST /v1/acquirer/callbacks` accepts `callbackId` (nonempty string),
`type: "fraud_review.completed"`, `transactionId` (UUID), `occurredAt` (ISO
timestamp with timezone), `outcome: "cleared" | "confirmed_fraud"`, and `note`
(nonempty string). Sign exact request bytes using the shared acquirer secret
and `Acquirer-Callback-Signature: t=...,v1=...`. The route enforces a 300-second
window. Signatures are mandatory in production and test; development can opt in
with `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE`. Repeated callback IDs are ignored
by the existing unique index. A valid callback appends a fraud-review note and
returns `{ received: true }`; it never changes transaction status or the ledger.

## Operational limits

Preserve the webhook encryption key across restarts and replicas. Monitor
old pending/exhausted deliveries, listener errors and delivery backlog. A stopped
API pauses both delivery and expiry scanning. Existing outbox retention must
preserve the delivery FKs and expiry deduplication records. Large backlog query
performance, receiver idempotency, production TLS/egress policy and alerting
need deployment-specific validation. Never use production payment credentials
for local verification.
