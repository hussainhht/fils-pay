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
export async function enqueueEvent<T extends OutboxEvent>(
  client: PoolClient | Client,
  eventType: T["eventType"],
  aggregateId: string,
  payload: T["payload"]
): Promise<string>;
```
- Inserts a row into `outbox_events` with `status = 'pending'`.
- Returns the generated `id` (BIGSERIAL).
- **Critical Rule:** `client` must be an active PostgreSQL transaction client (`withTransaction`). Enqueuing an event outside a transaction violates the outbox guarantee.

### 2. Canonical Outbox Event Schemas
| Event Type | Aggregate ID | Payload Properties | Producing Modules | Consuming Modules |
|---|---|---|---|---|
| `transaction.authorized` | Transaction UUID | `{ transactionId, merchantId, amountFils, currency }` | `apps/api` (`authorize.ts`) | `apps/api` (Webhooks) |
| `transaction.captured` | Transaction UUID | `{ transactionId, merchantId, amountCapturedFils, feeFils }` | `apps/api` (`capture.ts`) | `apps/api` (Webhooks), `apps/reporting` |
| `transaction.voided` | Transaction UUID | `{ transactionId, merchantId }` | `apps/api` (`void.ts`) | `apps/api` (Webhooks), `apps/reporting` |
| `refund.created` | Refund UUID | `{ refundId, transactionId, merchantId, amountFils, reason }` | `apps/api` (`processRefund.ts`) | `apps/api` (Webhooks), `apps/reporting` |
| `settlement.batch_closed` | Batch UUID | `{ batchId, merchantId, batchDate, grossFils, feeFils, netPayoutFils }` | `apps/settlement` (`batch.go`) | `apps/reporting` |
| `settlement.paid` | Batch UUID | `{ batchId, merchantId, netPayoutFils, paidAt }` | `apps/settlement` (`payout_notify.go`) | `apps/api` (Webhooks) |

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
