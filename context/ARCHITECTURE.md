# System Architecture — FilsPay

> **Scope:** End-to-end architectural patterns, financial accounting models, outbox messaging, settlement lifecycle, and security topology.

---

## Retirement safety update (2026-10-30, BUG-033)

`scripts/reconcile_march.ts` is a fail-closed historical entrypoint, not a ledger
writer. It has no database dependency and refuses CLI execution with exit 1.
Current `CloseBatch` posts `grossFils - truncated` per scheme line inside its
batch transaction (credit `card_scheme_clearing`, debit `scheme_rounding_residue`),
and row-locks the batch before returning a no-op for already closed/paid batches.
Historical reports claiming no Go residue posting exists are stale at this HEAD.
Retirement does not backfill prior closes or settle the ADR 0003/0004/0006 and
HANDOVER policy conflicts; these remain human decisions.

## 1. Architectural Philosophy & Principles

FilsPay is designed around a single shared PostgreSQL 16 database acting as both the transactional store and the decoupled messaging backbone. The system balances strict financial consistency with distributed microservice responsibilities:

```text
                     +-------------------------------------------------------+
                     |                     PostgreSQL 16                     |
                     |  - Transactions & Holds       - Double-Entry Ledger   |
                     |  - Settlement Batches         - Outbox Events Queue   |
                     |  - Balances (Cache)           - Analytics Read Models |
                     +-------------------+-------------------+---------------+
                                         ^                   ^
                                         |                   |
                       +-----------------+                   +---------------+
                       |                                                     |
             +---------+---------+                                 +---------+---------+
             |     apps/api      |                                 |  apps/settlement  |
             | Fastify REST Gate |<======== Internal RPC ==========|   Go Settlement   |
             | - Payments & Auth |         (:8091 / Token)         | - Batch Close     |
             | - Webhook Engine  |                                 | - Payouts & Fees  |
             +---------+---------+                                 +-------------------+
                       ^                                                     |
                       | HTTP                                                | LISTEN / NOTIFY
         +-------------+-------------+                                       v
         |                           |                             +-------------------+
+--------+--------+         +--------+--------+                    |  apps/reporting   |
|    apps/web     |         |   apps/admin    |                    | TypeScript Read-  |
| Merchant Portal |         | Ops / Console   |                    | Model Projector   |
| & Checkout (:5173)        | Management (:5174)                   +-------------------+
+-----------------+         +-----------------+
```

### Core Patterns
1. **Integer Minor Units:** All monetary values are `BIGINT` fils. Floats are banned from financial logic.
2. **Double-Entry Bookkeeping:** No single-sided money mutations. Every financial event posts balanced debit and credit legs.
3. **Transactional Outbox:** No dual-write vulnerabilities. Domain changes and event publications occur in the same database transaction.
4. **Separate Read Models:** Analytics and dashboard aggregation are decoupled from OLTP payment tables via outbox event consumption.
5. **Strict Dual-Plane Separation:** Merchant and administrative authentication, cookies, sessions, and data contexts never intersect.

---

## 2. Double-Entry Ledger (`ledger_entries`)

The double-entry ledger is the immutable, authoritative source of all money movements within FilsPay (defined in `db/migrations/0007_ledger_double_entry.sql`).

### Ledger Schema
- `ledger_entries`:
  - `id`: UUID primary key.
  - `entry_group_id`: UUID grouping all balanced legs of a single financial movement.
  - `merchant_id`: UUID of the associated merchant (or system account).
  - `account_id`: Chart of accounts identifier (`merchant_payable`, `customer_settlement`, `fee_revenue`, `scheme_rounding_residue`, `goodwill`, `manual_adjustment`).
  - `direction`: `'debit'` or `'credit'`.
  - `amount_fils`: Positive `BIGINT` representing the leg value.
  - `occurred_at`: Timestamp of the transaction.
  - `description`: Textual audit reason.

### Equilibrium Constraint Trigger
Migration 0007 attaches a PostgreSQL `CONSTRAINT TRIGGER` to `ledger_entries` that is `DEFERRABLE INITIALLY DEFERRED`. Upon `COMMIT` of any transaction inserting ledger rows, the trigger evaluates:
$$\sum (\text{amount\_fils} \times \text{case direction when 'debit' then 1 else -1 end}) = 0 \quad \text{per } \text{entry\_group\_id}$$
If the legs for any `entry_group_id` do not balance to zero, PostgreSQL aborts the entire transaction.

### Standard Accounting Entries
- **Card Payment Capture (Gross 10,000 fils, Fee 250 fils):**
  - `customer_settlement` DEBIT 10,000 fils
  - `merchant_payable` CREDIT 9,750 fils
  - `fee_revenue` CREDIT 250 fils
- **Batch Payout Disbursement (Net 9,750 fils):**
  - `merchant_payable` DEBIT 9,750 fils
  - `customer_settlement` CREDIT 9,750 fils
- **Refund (Amount 5,000 fils, Fee Reversal 125 fils):**
  - `merchant_payable` DEBIT 4,875 fils
  - `fee_revenue` DEBIT 125 fils
  - `customer_settlement` CREDIT 5,000 fils

---

## 3. Balance Architecture: Cache vs Ground Truth

The table `merchant_balances` (`merchant_id`, `cached_payable_fils`, `last_settlement_batch_id`, `updated_at`) is a **performance cache** to avoid scanning millions of ledger rows on routine merchant dashboard requests.

### Maintenance & Drift Risks
1. **Incremental Daemon Maintenance:** `apps/settlement` updates the cache during batch close (`ApplyBatchClose`) by adding net payout, and at batch payout (`ApplyPayout`) by subtracting net payout.
2. **Full Authoritative Rebuild:** The CLI command `settlement rebuild-balances` recalculates the payable balance by summing the entire history of `ledger_entries` for the merchant.
3. **The Console Rebuild Discrepancy (ADR 0004):** The admin UI button "Rebuild cached balances" invokes an endpoint that rebuilds balances from `merchant_payable_position` (a view over `scheme_export_lines.amount_fils`), which sums gross scheme volume without accounting for fees, refunds, credits, or disbursements. This creates severe balance drift (documented in `BUG-011`).
4. **Display Adjustments (ADR 0006):** Console balance adjustments historically modified `merchant_balances.cached_payable_fils` directly without writing to `ledger_entries` (`BUG-038`). Running a subsequent CLI rebuild wipes these display adjustments.

---

## 4. Settlement Lifecycle & Daily Batch Close

Settlement executes daily to aggregate captures, deduct MDR fees, disburse net funds to merchants, and generate card scheme clearing files.

### 1. Business Day Window
- The settlement calendar day runs from **00:00:00 to 24:00:00 Asia/Bahrain** (UTC+3, fixed, no DST).
- `apps/settlement/internal/settlement/window.go` calculates the window: `start = local_midnight_utc`, `end = start + 24 hours`.
- Captures occurring within this window are assigned to that date's batch.

### 2. Batch Lifecycle Phases
1. **Claim & Close (`CloseBatch`):**
   - Claims all unbatched capture events within the business window for active, non-test merchants.
   - Evaluates fees per capture event based on tiered `fee_schedules` or fallback `merchants.mdr_bps`.
   - Freezes gross, fee, and net totals in `settlement_batches`.
   - Status transitions: `open` $\rightarrow$ `closed`.
2. **Disbursement Payout (`PayoutBatch`):**
   - Posts ledger payout entries (`merchant_payable` debit).
   - Generates payout disbursement records.
   - Status transitions: `closed` $\rightarrow$ `paid`.
3. **Outbox Notification (`NotifyPayout`):**
   - Enqueues `settlement.paid` event into `outbox_events`.
   - Dispatcher delivers webhook to the merchant.

### 3. Card Scheme Export Boundary
- Visa and Mastercard clearing requires amounts in 2-decimal formats (e.g. BD with 2 decimal places).
- The platform quantizes 3-decimal fils amounts to 2 decimals at export time.
- **Scheme Residue (PMA-08 source review, 2026-10-30):** Current `CloseBatch` journals gross-minus-truncated residue per export line as credit `card_scheme_clearing` / debit `scheme_rounding_residue` in its transaction. This applies to new closes only. The retired March CLI has no database or posting implementation; historical corrections need a separate approved design and database investigation.

---

## 5. Event-Driven Messaging: Transactional Outbox

FilsPay uses the **Transactional Outbox Pattern** to achieve atomic consistency between database updates and external asynchronous notifications:

1. **Atomic Insertion:** Producers insert `outbox_events` (`event_type`, `aggregate_type`, `aggregate_id`, `payload`, nullable `processed_at`) within the same PostgreSQL transaction as their state change. There is no outbox status column; webhook state lives in `webhook_deliveries`.
2. **Notification Wakeup:** Upon transaction commit, PostgreSQL triggers the `outbox_events_channel` notification.
3. **Consumers:**
   - **Webhook Dispatcher (`apps/api`):** Tracks independent durable `webhook_deliveries`, signs canonical wire bytes with timestamped HMAC-SHA256, leases sends with `SKIP LOCKED`, and retries with capped exponential backoff. Delivery/replay never mutates finances.
   - **Reporting Consumer (`apps/reporting`):** Advances its cursor in `reporting_outbox_cursor` and materializes events into analytics read models (`merchant_daily_volume`).
4. **Resilience & Polling:** If the `LISTEN` connection disconnects, a background fallback poll queries for pending rows every 5 seconds, guaranteeing at-least-once delivery.

Webhook update (2026-10-30): definitive authorize/capture declines now publish
`payment.failed` atomically with the completed idempotency claim. A serialized,
bounded scanner records `payment_link.expired` for active expired links without
changing their derived status; reserved links are excluded. Delivery to an
endpoint requires registration before expiry. Reporting filters its own event
types and ignores these additions. See `docs/WEBHOOKS.md`; finite retries can
exhaust, so eventual success requires receiver recovery and authorized replay.

---

## 6. Dual-Plane Security Topology

The platform enforces absolute isolation between the Merchant Plane and the Administrative Plane:

| Security Dimension | Merchant Plane (`apps/web`, `/v1/*`) | Admin Plane (`apps/admin`, `/v1/admin/*`) |
|---|---|---|
| **Identity Table** | `merchant_users` | `admin_users` |
| **Session Cookie** | `fp_sid` | `fp_admin_sid` |
| **Session Store** | `sessions` (token_hash, merchant_id) | `admin_sessions` (token_hash, admin_id) |
| **Auth Pre-Handler** | `requireMerchantAuth` | `requireAdminSession` |
| **Role Taxonomy** | `owner`, `finance`, `support` | `super_admin`, `finance`, `support` |
| **Tenant Scoping** | Derived strictly from `request.merchantAuth` | Scoped via explicit path params, audit-logged |
| **Impersonation** | Cannot initiate impersonation | Can generate `admin_impersonation_grants` |

### Administrative Impersonation Mechanics
When an admin views a merchant dashboard ("View as Merchant"):
1. The admin must have an active session in `admin_sessions`.
2. A temporary grant token is created in `admin_impersonation_grants` with a 15-minute TTL.
3. The token is passed via a dedicated cookie `fp_impersonation`.
4. `requireMerchantAuth` resolves this cookie to actor type `admin_impersonation`.
5. **Strict Read-Only Invariant:** Any mutation endpoint (refunds, API key creation, settings updates) checks `actorType === 'admin_impersonation'` and rejects the operation with `403 Forbidden`.

---

## 7. Known Architectural Tensions & Contradictions

Agents must be aware of conflicting decisions in the codebase:
1. **ADR 0003 vs ARCHITECTURE §3 (Time Windows):** Architecture specifies Asia/Bahrain business days everywhere; ADR 0003 introduced UTC calendar months for monthly finance reports, causing a 3-hour boundary drift.
2. **ADR 0004 vs Ledger Consistency (Balance Rebuild):** The console balance rebuild queries settled scheme lines instead of the ledger, omitting fees, payouts, and manual credits.
3. **ADR 0006 vs Double-Entry Accounting:** Balance adjustments were implemented as direct cache writes without ledger postings.
4. **ADR 0002 (Residue Posting):** Documented as "Implemented" but completely missing from `apps/settlement` code.


## Checkout capability boundary ? 2026-10-30

The public cardholder route is `/pay/:token` (not `/checkout/:token`). It is
outside merchant dashboard authentication. `CardPaymentForm` provides browser
validation and ephemeral card entry for the existing in-process simulator;
issuer authorization, durable payment claims and financial writes remain server-side.
An uncertain response retains one key and immutable input values in page memory.
Only a definitive 402 allows a new attempt. No PAN/CVV or payment key is added
to browser storage. A reload cannot resume this in-memory attempt.

No provider vault/tokenization, hosted-field integration or authenticated customer
ownership model exists. Saving/retrieving/removing cards remains unavailable.
Merchant or admin identity must never be substituted for cardholder identity.
No API/schema, financial module, settlement behavior or accepted ADR changed.
