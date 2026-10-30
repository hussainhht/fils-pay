# Payment Lifecycle & Financial State Transitions — FilsPay

> **Scope:** Authorizations, captures, voids, hosted payment links, reservations, refunds, double-entry ledger integration, and state machine invariants.

---

## 1. Transaction State Machine

The transaction lifecycle enforces strict, irreversible state transitions:

```text
                  +-------------------+
                  |   (Cardholder)    |
                  +---------+---------+
                            |
                            v [POST /v1/transactions/authorize]
                  +-------------------+
                  |    AUTHORIZED     |
                  |  (Active Hold)    |
                  +----+---------+----+
                       |         |
      [Capture]        |         | [Void]
      (acquirer call)  |         | (acquirer call)
                       v         v
+------------------------+     +-------------------+
|        CAPTURED        |     |      VOIDED       |
|  (Ledger & Batched)    |     |  (Hold Released)  |
+-----------+------------+     +-------------------+
            |
            | [POST /v1/refunds]
            | (captured_fils headroom)
            v
+------------------------+
|   PARTIALLY_REFUNDED   |
+-----------+------------+
            |
            | (all headroom refunded)
            v
+------------------------+
|        REFUNDED        |
+------------------------+
```

---

## 2. Authorization Flow (`apps/api/src/payments/authorize.ts`)

- **Trigger:** `POST /v1/transactions/authorize`.
- **Pre-Conditions:**
  - Merchant must be authenticated and in `status = 'approved'`.
  - Amount must be a positive integer in fils (`toFils(amountFils)`).
  - Currency must be `'BHD'`.
- **Database Operations (Atomic Transaction):**
  1. Inserts into `transactions`:
     - `amount_fils`: Authorized amount.
     - `status`: `'authorized'`.
     - `captured_fils`: 0.
     - `refunded_fils`: 0.
  2. Inserts into `holds`:
     - `amount_fils`: Matches authorized amount.
     - `status`: `'active'`.
     - `expires_at`: `now() + INTERVAL '7 days'`.
  3. Enqueues outbox event: `transaction.authorized`.
- **Acquirer Simulator:** Calls `acquirer.authorize(...)` with mock latency (100–400 ms) and simulated failure rate (2%).

---

## 3. Capture Flow (`apps/api/src/payments/capture.ts`)

- **Trigger:** `POST /v1/transactions/:id/capture`.
- **Headers:** `Idempotency-Key: <key>` (Required).
- **Validation & Locking:**
  1. **Idempotency Check:** Checks `idempotency_keys` table. The request hash must bind both the idempotency key and the target `transactionId` (`BUG-021`).
  2. **Row Lock:** Queries `SELECT * FROM transactions WHERE id = $1 FOR UPDATE` to serialize concurrent requests.
  3. **Merchant Isolation:** Confirms `transaction.merchant_id === request.merchantAuth.merchantId`.
  4. **State Check:** Must be `'authorized'` or `'partially_captured'`.
  5. **Hold Check (`BUG-025`):** Queries `holds` for an `'active'` hold. Rejects with `409 Conflict` if the hold is expired or already released.
  6. **Amount Headroom:** Capture amount must not exceed `transaction.amount_fils - transaction.captured_fils`.
- **Acquirer Execution:**
  - Invokes acquirer client `acquirer.capture(...)`.
  - *Note on BUG-061:* The external acquirer call currently occurs while holding the DB transaction open. Work is in progress to implement durable pending state and decouple the network I/O from the row lock.
- **Financial Finalization:**
  1. Updates `transactions`:
     - Increments `captured_fils`.
     - Flips status to `'captured'` (or `'partially_captured'`).
  2. Updates `holds`: Status becomes `'captured'` (or reduced amount for partial capture).
  3. Calculates Fee: Evaluates tiered fee from `fee_schedules` or fallback `merchants.mdr_bps`, minus merchant `discount_bps` (`BUG-023`).
  4. Double-Entry Ledger Postings (`ledger_entries`):
     - `customer_settlement`: DEBIT `amountCapturedFils`
     - `merchant_payable`: CREDIT `amountCapturedFils - feeFils`
     - `fee_revenue`: CREDIT `feeFils`
  5. Enqueues outbox event: `transaction.captured`.
  6. Records response in `idempotency_keys`.

---

## 4. Void Flow (`apps/api/src/payments/void.ts`)

- **Trigger:** `POST /v1/transactions/:id/void`.
- **Validation:**
  - Must belong to the authenticated merchant.
  - Status must be `'authorized'` and `captured_fils === 0`.
- **Operations:**
  1. Updates `holds` to status `'released'`.
  2. Updates `transactions` to status `'voided'`.
  3. Enqueues outbox event: `transaction.voided`.
  4. *Acquirer Limitation (BUG-024):* Simulator releases the local hold; issuer hold reversal API integration is pending acquirer implementation.

---

## 5. Hosted Payment Links & Checkout (`apps/api/src/paymentLinks/`)

- **Link Creation:** `POST /v1/merchants/:merchantId/payment-links` generates `plink_` followed by 22 cryptographically random URL-safe characters (`randomFromAlphabet`, current `create.ts`).
- **Public Checkout Page (`apps/web`):**
  - Customer navigates to `/pay/:token`.
  - Browser fetches link details via public `GET /v1/payment-links/:token`. Returns amount, merchant name, and expiry. Never returns API keys or internal hashes (`BUG-022`).
- **Payment Submission:**
  - Customer submits card details to `POST /v1/payment-links/:token/pay`.
  - **Durable payer binding (current source, 2026-10-30):** `pay.ts` commits a claim containing `reservation_id`, `payment_key_hash`, and `payment_request_hash`. Only an active, unexpired link can admit a new attempt; a reserved link only resumes under the identical key and request. Timeout does not admit a new payer.
  - Authorization/capture reuse persisted operation identities. A definitive authorization decline releases the owned reservation; ambiguous outcomes stay bound. Capture declines release it only after local void succeeds.
  - Finalization requires the same bound key/request and sets `paid` with `transaction_id`. Server time controls new-attempt expiry; `submittedAt` is ignored.
  - Checkout keeps the current key and card values only in page memory for uncertain-response recovery. It disables editing and uses identical requests for retry, then removes the form on success/terminal status. A definitive 402 starts a fresh attempt if retried. Reloads do not retain sensitive fields or the attempt key.
  - The acquirer remains an in-process simulator with no hosted fields, tokenization, vault, or cardholder identity. Card saving/reuse is unavailable. Production card collection requires a separate provider integration and security review.

---

## 6. Refunds Flow (`apps/api/src/refunds/`)

- **Trigger:** `POST /v1/refunds` or `POST /v1/merchants/:merchantId/refunds`.
- **Deployment Gate:** `FEATURE_REFUNDS=true` in `apps/api/src/config.ts`. (Returns `501 Not Implemented` if disabled, `BUG-027`).
- **Permissions:** Restricted to merchant `owner` and `finance` roles. Prohibited during admin impersonation (`rejectImpersonation`).
- **Headroom Calculation (`BUG-007`):**
  $$\text{Headroom} = \text{captured\_fils} - \text{refunded\_fils} - \text{pending\_reservations\_fils}$$
  *Crucial Rule:* Headroom is computed against actual **captured** funds, never authorized amounts.
- **Concurrency Serialization (`BUG-008`):**
  1. Transaction row is locked (`FOR UPDATE`).
  2. Inserts row into `pending_refund_reservations` to prevent parallel requests from over-spending the headroom.
  3. Calls acquirer refund endpoint.
  4. If acquirer succeeds:
     - Updates `transactions.refunded_fils += amountFils`.
     - Transitions status to `'partially_refunded'` or `'refunded'`.
     - Inserts `refunds` row (defaulting reason to `'unspecified'` if null, resolving `BUG-028`).
     - Reverses prorated merchant MDR fee via `calculateRefundFee`.
     - Posts double-entry ledger legs:
       - `merchant_payable`: DEBIT `(refundAmount - feeReversal)`
       - `fee_revenue`: DEBIT `feeReversal`
       - `customer_settlement`: CREDIT `refundAmount`
     - Deletes reservation from `pending_refund_reservations`.
     - Enqueues outbox event: `refund.created`.
