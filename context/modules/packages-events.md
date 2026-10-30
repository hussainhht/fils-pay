# Module: `packages/events` (Transactional Outbox)

> **Scope:** Outbox event type schemas, payload definitions, and transactional event enqueue helpers.

---

## 1. Purpose & Responsibilities

`packages/events` provides shared TypeScript definitions and database utilities for FilsPay's transactional outbox architecture:
1. Canonical schema definitions for all domain events across the platform.
2. The `enqueueEvent` database utility ensuring domain events are written in the same PostgreSQL transaction as their producing state mutations.

---

## 2. API Reference & Key Schemas (`src/outbox.ts`)

### 1. `enqueueEvent` Function
```typescript
export async function enqueueEvent(
  client: QueryableClient,
  event: NewOutboxEvent
): Promise<OutboxEventRow>;
```
- Inserts a row into `outbox_events` with nullable `processed_at`; there is no status column.
- Returns the inserted row; `id` is bigint. Webhooks track independent delivery state.
- **Critical Rule:** `client` must be an active PostgreSQL transaction client (`withTransaction`). Enqueuing an event outside a transaction violates the outbox guarantee.

### 2. Canonical Outbox Event Schemas
| Event Type | Aggregate ID | Payload Properties | Producing Modules | Consuming Modules |
|---|---|---|---|---|
| `payment.failed` | Idempotency claim UUID (`payment_attempt`) | `{ merchantId, paymentAttemptId, transactionId?, stage, amountFils, reason }` | Definitive authorize/capture decline apply transaction | Webhooks only |
| `payment_link.expired` | Link UUID (`payment_link`) | `{ merchantId, paymentLinkId, amountFils, expiredAt }` | Serialized API expiry scanner transaction | Webhooks only |
| `transaction.captured` | Transaction UUID | `{ transactionId, merchantId, amountCapturedFils, feeFils }` | `apps/api` (`capture.ts`) | `apps/api` (Webhooks), `apps/reporting` |
| `transaction.voided` | Transaction UUID | `{ transactionId, merchantId }` | `apps/api` (`void.ts`) | `apps/api` (Webhooks), `apps/reporting` |
| `refund.succeeded` | Transaction UUID | `{ refundId, merchantId, amountFils, feeReversedFils, refundedTotalFils, newStatus }` | `apps/api` (`processRefund.ts`) | Webhooks, reporting |
| `settlement.batch_closed` | Batch UUID | `{ batchId, merchantId, batchDate, grossFils, feeFils, netPayoutFils }` | `apps/settlement` (`batch.go`) | `apps/reporting` |
| `settlement.paid` | Batch UUID | `{ batchId, merchantId, batchDate, netPayoutFils }` | `apps/settlement` (`payout_notify.go`) | `apps/api` (Webhooks) |

---

## 3. Invariants & Downstream Contracts

1. **Transaction Co-Location:** An outbox event must never be inserted without its associated database state change.
2. **Payload Completeness:** Payloads must contain all necessary figures for consumers (e.g. `amountCapturedFils`) to avoid consumers having to perform secondary database joins against mutable state.

---

## 4. Existing Tests & Verification

- Tests located in `packages/events/src/outbox.test.ts`:
  - Validates payload structure and serialization.
  - Pure unit tests, zero database dependencies.
- Command to run:
  ```bash
  npm.cmd run test -w @filspay/events
  ```
