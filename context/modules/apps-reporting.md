# Module: `apps/reporting` (Outbox Analytics Worker)

> **Scope:** Architecture, outbox event consumption, projection tables, Asia/Bahrain date partitioning, and reporting read models.

---

## 1. Purpose & Responsibilities

`apps/reporting` is a decoupled background projection worker responsible for:
1. Subscribing to `outbox_events` and advancing an independent watermark cursor.
2. Denormalizing transactional events into low-latency analytical read models (`merchant_daily_volume`, `merchant_payout_trends`).
3. Isolating analytical workloads from core OLTP payment processing tables.
4. Providing real-time dashboard data for merchant overview KPIs and settlement trends.

---

## 2. Main Entry Points & Directory Layout

- **Entry Point:** `apps/reporting/src/index.ts`.
- **Subcommands:**
  - `apps/reporting/src/index.ts worker`: Long-running background worker with `LISTEN/NOTIFY` and poll fallback.
  - `apps/reporting/src/index.ts catch-up`: One-shot catch-up sweep running a single consumption pass.
- **Directory Layout:**
  - `src/consumer/`:
    - `runConsumerPass.ts`: Queries unapplied `outbox_events` past the cursor.
    - `applyEvent.ts`: Dispatches events to SQL UPSERT projection functions.
    - `cursor.ts`: Reads and advances `reporting_outbox_cursor`.
    - `listener.ts`: Connects dedicated PostgreSQL client for `LISTEN outbox_event_created`.
  - `src/bahrainDate.ts`: Maps UTC event timestamps to Asia/Bahrain calendar strings (`YYYY-MM-DD`).
  - `src/cli/rebuild.ts`: Replays the entire history of outbox events to rebuild analytical tables.

---

## 3. Projection Tables Maintained

### 1. `merchant_daily_volume` (0027, 0076)
- **Columns:** `merchant_id`, `volume_date` (DATE), `captured_count`, `captured_gross_fils`, `voided_count`, `refunded_count`, `refunded_gross_fils`, `last_updated_at`.
- **Key:** PRIMARY KEY (`merchant_id`, `volume_date`).
- **Events Applied:**
  - `transaction.captured`: Increments `captured_count` by 1 and adds `payload.amountCapturedFils`.
  - `transaction.voided`: Increments `voided_count` by 1.
  - `refund.created`: Increments `refunded_count` and adds refund fils.

### 2. `merchant_payout_trends` (0028)
- **Columns:** `merchant_id`, `batch_date` (DATE), `gross_fils`, `fee_fils`, `net_payout_fils`, `status`, `paid_at`.
- **Key:** PRIMARY KEY (`merchant_id`, `batch_date`).
- **Events Applied:**
  - `settlement.batch_closed`: Records frozen batch totals for trends display.

---

## 4. Date Partitioning: Asia/Bahrain Partitioning

- All aggregations partition activity by **Asia/Bahrain calendar date** (`toBahrainDateString(createdAt)`).
- Because Bahrain is fixed UTC+3 (no DST), the local date is calculated as:
  $$\text{Bahrain Time} = \text{UTC Time} + 3 \text{ hours}$$
- Events occurring between `21:00 UTC` and `24:00 UTC` are bucketed into the *next* day's Bahrain volume.

---

## 5. Consumer Mechanics & Resilience

1. **Wakeup & Polling:** The worker listens on PostgreSQL notification channel `outbox_event_created`. If idle, it polls every 5 seconds as a fallback.
2. **Cursor Management:**
   - Cursor stored in `reporting_outbox_cursor` under `consumer_name = 'reporting_worker'`.
   - Fetches batch of events where `id > last_event_id ORDER BY id ASC LIMIT 500`.
3. **Idempotent Projections:** All projection queries use `ON CONFLICT (...) DO UPDATE`, making event replay safe during administrative rebuilds.

---

## 6. Existing Tests & Verification

- Tests located in `apps/reporting/src/consumer/*.test.ts`:
  - `applyEvent.test.ts`: Tests projection UPSERTs for captures and voids.
  - `runConsumerPass.test.ts`: Tests batching and cursor advancement.
- Command to run:
  ```bash
  npm.cmd run test -w @filspay/reporting
  ```
  *(Note: Requires active `DATABASE_URL` and migrated PostgreSQL).*

---

## 7. Known Defects & Limitations

1. **Historical Non-Atomic Watermark Commit (BUG-052):** Current `runConsumerPass.ts` applies events and advances the locked cursor in one transaction, protected by an outbox SHARE-lock producer barrier. Individual incremental UPSERTs are not independently replay-idempotent; the atomic cursor protocol supplies that guarantee. Capacity impact of the table lock remains unmeasured (2026-10-30 source review; `Evidence/agent-1-capacity-optimization.md`).
2. **Stale Dashboards After Seeding:** After a destructive database re-seed, the reporting worker must be restarted to reset its cursor cache.
