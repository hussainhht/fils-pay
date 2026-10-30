# Dependency Map & Blast Radius Matrix — FilsPay

> **Scope:** Inter-workspace dependencies, database producer/consumer relationships, outbox pub/sub topologies, and change blast-radius analysis.

Release test tooling (2026-10-30): root `test` -> `scripts/test-unit.mjs` ->
audited money/events/web and script safety suites. Explicit root integration,
API/reporting workspace tests and settlement test command ->
`ops/test-database.mjs` preflight before suite execution. No runtime dependency,
service interface, schema or financial producer/consumer changed.

---

## 1. Workspace & Library Dependencies

```text
                     +-------------------+
                     |  packages/money   | (PROTECTED)
                     +---------+---------+
                               |
            +------------------+------------------+------------------+
            |                  |                  |                  |
            v                  v                  v                  v
    +---------------+  +---------------+  +---------------+  +---------------+
    |   apps/api    |  |   apps/web    |  |  apps/admin   |  |    scripts    |
    +-------+-------+  +---------------+  +---------------+  +---------------+
            |
            +---------------------------------+
            |                                 |
            v                                 v
+-----------------------+         +-----------------------+
|    packages/events    |         |    apps/reporting     |
+-----------+-----------+         +-----------------------+
            |                                 ^
            +---------------------------------+ (consumes outbox_events)
```

*Note on `apps/settlement`:* Written in Go, it does not import `packages/money`. Instead, it maintains its own Go implementation in `apps/settlement/internal/money/`. The formulas in TS and Go must remain strictly identical (`BUG-032`).

---

## 2. Database Producer & Consumer Matrix

| Table Name | Primary Writers (Producers) | Primary Readers (Consumers) | Concurrency & Integrity Notes |
|---|---|---|---|
| `merchants` | `apps/api` (onboarding, admin) | All applications | Status changes (`approved` $\rightarrow$ `suspended`) must invalidate active sessions. |
| `transactions` | `apps/api` (payments) | `apps/api`, `settlement`, `reporting` | Row-locked (`FOR UPDATE`) during capture and refund. Status is immutable once captured/voided. |
| `holds` | `apps/api` (`authorize.ts`) | `apps/api`, `scripts/expire_holds.ts` | Swept nightly. Expired/released holds must never be captured (`BUG-025`). |
| `ledger_entries` | `apps/api` (captures, refunds), `settlement` (payouts, fees, scheme residue) | `settlement` (rebuild CLI), `apps/api` (statements) | Authoritative source of truth. Guarded by zero-sum deferred constraint trigger (0007). Retired `reconcile_march.ts` has no DB dependency or posting path (PMA-08). |
| `merchant_balances` | `apps/settlement` (daemon), `apps/api` (adjustments) | `apps/web` (overview), `apps/api` | Performance cache. Rebuilt from `ledger_entries`. Display adjustments mutate this table directly. |
| `settlement_batches` | `apps/settlement` (`CloseBatch`, `PayoutBatch`) | `apps/api`, `apps/web`, `apps/reporting` | Closed daily. Re-running closed/paid batches must be idempotent. |
| `scheme_export_lines` | `apps/settlement` (`CloseBatch`) | Finance exports, `apps/api` (admin view) | Stores 2-decimal scheme export lines alongside 3-decimal fils amounts. |
| `outbox_events` | `apps/api`, `apps/settlement` | `apps/api` (webhooks), `apps/reporting` (analytics) | PostgreSQL `LISTEN/NOTIFY` channel: `outbox_events_channel`. |
| `reporting_outbox_cursor`| `apps/reporting` | `apps/reporting` | Tracks consumer progress (`last_event_id`). Must advance atomically per pass (`BUG-052`). |
| `admin_audit_log` | `apps/api` (`adminAudit/`) | `apps/admin` | Immutable log of administrative actions, impersonation starts, and credit approvals. |

---

## 3. Outbox Event Pub/Sub Topology

The transactional outbox decouples asynchronous side effects from synchronous financial operations:

```text
[Transaction Authorize / Capture / Void]  \
[Refund Created]                           +---> (outbox_events) ---> LISTEN / NOTIFY
[Settlement Batch Closed / Payout Paid]   /                                |
                                                                           v
                                                 +-------------------------+-------------------------+
                                                 |                                                   |
                                                 v                                                   v
                                      +--------------------+                              +--------------------+
                                      | Webhook Dispatcher |                              | Reporting Consumer |
                                      |    (apps/api)      |                              |  (apps/reporting)  |
                                      +---------+----------+                              +---------+----------+
                                                |                                                   |
                                                v HTTP HMAC-SHA256                                  v SQL UPSERT
                                      +--------------------+                              +--------------------+
                                      |  Merchant Endpoint |                              |   Analytics Tables |
                                      +--------------------+                              +--------------------+
```

### Event Subscription Breakdown
1. **`payment.failed` / `payment_link.expired` (2026-10-30):**
   - Publishers: definitive decline apply transactions in `payments/authorize.ts` and `capture.ts`; serialized API `paymentLinks/expire.ts` scanner.
   - Subscriber: webhook dispatcher only. Reporting explicitly filters these types out. No settlement, money-library, schema or partner-route change.
2. **`transaction.captured`:**
   - Publisher: `apps/api/src/payments/capture.ts`
   - Subscribers:
     - Webhook Dispatcher $\rightarrow$ fires `transaction.captured` webhook.
     - Reporting Consumer $\rightarrow$ updates `merchant_daily_volume` (increments `captured_count` and `captured_gross_fils`).
3. **`transaction.voided`:**
   - Publisher: `apps/api/src/payments/void.ts`
   - Subscribers:
     - Webhook Dispatcher $\rightarrow$ fires `transaction.voided` webhook.
     - Reporting Consumer $\rightarrow$ updates `merchant_daily_volume` (increments `voided_count`).
4. **`refund.succeeded`:**
   - Publisher: `apps/api/src/payments/processRefund.ts`
   - Subscribers:
     - Webhook Dispatcher $\rightarrow$ fires `refund.succeeded` webhook.
     - Reporting Consumer $\rightarrow$ updates `merchant_daily_volume`.
5. **`settlement.batch_closed`:**
   - Publisher: `apps/settlement/internal/settlement/batch.go`
   - Subscribers: Reporting Consumer $\rightarrow$ updates `merchant_payout_trends`.
6. **`settlement.paid`:**
   - Publisher: `apps/settlement/internal/settlement/payout_notify.go`
   - Subscribers: Webhook Dispatcher $\rightarrow$ fires `settlement.paid` webhook with payout disbursement breakdown.

---

## 4. Change Blast Radius & Risk Analysis

Before making a modification, consult this blast radius matrix:

| If You Modify... | Immediate Impact | Downstream Systems at Risk | Required Validation |
|---|---|---|---|
| **`packages/money`** *(PROTECTED)* | Pure monetary math | All payments, refunds, fees, and settlements across TS and Go | Explicit project approval; run full unit suites + typecheck. |
| **`apps/api/src/v1/`** *(FROZEN)* | Partner API contract | External integrating merchants & mobile apps | Strictly prohibited. Do not alter route paths or response schemas. |
| **`db/migrations/*.sql`** | Database schema | All backend services, seed scripts, and reporting workers | Never alter existing files. Write a new numbered migration and test against fresh DB. |
| **`apps/api/src/fees/`** | Fee calculation | Fee revenue, merchant balances, settlement payouts | Must ensure TS fee formulas match `apps/settlement/internal/settlement/batch.go`. |
| **`apps/api/src/webhooks/`** | Webhook delivery | Merchant integrations relying on callbacks | Verify raw byte HMAC signing (`BUG-045`), AES-256-GCM secret decryption, SSRF checks. |
| **`apps/api/src/payments/`** | Transaction flows | Double-entry ledger, hold locks, acquirer simulator | Verify row locks (`FOR UPDATE`), idempotency key hashing, and zero-sum ledger equilibrium. |
| **`apps/settlement`** | Daily batch close | Merchant bank disbursements, balance caches, scheme exports | Run Go tests (`go test ./...`); check `float32` elimination (`BUG-010`) and Asia/Bahrain windows. |
| **`apps/reporting`** | Analytics models | Merchant and admin dashboard charts and KPI cards | Test cursor checkpointing atomicity and restart replay protection (`BUG-052`). |

## OTP delivery dependency (2026-10-30)

Merchant login/resend and admin login -> separate notifier wrappers -> shared auth/otpDelivery.ts -> Resend POST /emails via native fetch. Delivery settings come from config.ts. Database challenge/session commit precedes network I/O; no new schema or event type. Auth tables/cookies remain separate. Provider errors affect login/resend responses but do not promote sessions. Automated transports are mocked; production acceptance/inbox delivery remains unverified.

## TOTP dependencies (2026-10-30)

Auth login/verification -> auth/totp -> auth/totpCrypto (otplib, qrcode for setup only) -> dedicated plane-specific authenticator tables. Enrollment management uses existing full session middleware, password verifier, login failure limits, transaction helper and admin audit logger. Frontend login DTOs add verificationMethod; both security pages share apps/ui/AuthenticatorSetup. New schema requires 0085 before FEATURE_TOTP=true; no financial table/event dependency is introduced. TOTP key is separate from webhook encryption.
