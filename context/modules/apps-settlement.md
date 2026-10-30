# Module: `apps/settlement` (Go Financial Settlement Engine)

> **Scope:** Architecture, batch scheduling, fee calculations, balance cache management, card scheme export, and internal RPC server.

---

## 1. Purpose & Responsibilities

`apps/settlement` is a standalone Go 1.24 service responsible for:
1. Executing daily batch settlement closures across all active merchants.
2. Deriving tiered MDR platform fees per capture event and computing net merchant payouts.
3. Managing the `merchant_balances` performance cache and providing full double-entry ledger balance recomputations.
4. Exporting 2-decimal card scheme clearing files (Visa / Mastercard formats).
5. Hosting an authenticated internal HTTP server on port 8091 for admin-triggered settlement operations.

---

## 2. Main Entry Points & CLI Subcommands

- **Main Entry Point:** `apps/settlement/cmd/settlement/main.go`.
- **Subcommands:**
  - `settlement daemon`: Starts the background scheduler loop and internal HTTP server on port 8091. Requires `SETTLEMENT_INTERNAL_TOKEN`.
  - `settlement run-batch --date=YYYY-MM-DD [--merchant=<uuid>]`: Manually triggers batch settlement for a specific Asia/Bahrain business date.
  - `settlement rebuild-balances [--merchant=<uuid>]`: Full authoritative recompute of `merchant_balances` from `ledger_entries`.
  - `settlement export-scheme-file --batch=<uuid> --out=<path>`: Generates 2-decimal clearing CSV file for a closed batch.

---

## 3. Key Packages & Internal Layout

```text
apps/settlement/
├── cmd/settlement/main.go         # CLI router and subcommand dispatcher
└── internal/
    ├── balances/                  # Cache management (ApplyBatchClose, ApplyPayout)
    ├── config/                    # Config loader (DATABASE_URL, PGCONN_SETTLEMENT, token)
    ├── db/                        # pgxpool connection pool initialization
    ├── internalapi/               # Internal HTTP RPC server (:8091) serving apps/api
    ├── ledger/                    # Authoritative double-entry ledger walk recompute
    ├── money/                     # Go implementation of Fils integer arithmetic
    ├── scheduler/                 # Daily cron runner executing batch closure at midnight
    └── settlement/                # Core settlement domain logic
        ├── batch.go               # CloseBatch and PayoutBatch state machine
        ├── window.go              # Asia/Bahrain business day window calculator
        ├── payable.go             # NetPayableFils derivation (contains Float32 bug)
        ├── fee_schedule.go        # Tiered fee schedule matching
        ├── scheme_export.go       # Card scheme CSV formatting and quantization
        └── recalculate_mdr.go     # Historical batch fee adjustment logic
```

---

## 4. Financial Calculations & Business Invariants

### 1. Asia/Bahrain Business Day Window (`internal/settlement/window.go`)
- Fixed UTC+3 offset (no Daylight Saving Time).
- Day window: `[YYYY-MM-DD 00:00:00+03:00, next day 00:00:00+03:00)`.
- Translates to UTC: `[YYYY-MM-(DD-1) 21:00:00Z, YYYY-MM-DD 21:00:00Z)`.

### 2. Batch Lifecycle (`internal/settlement/batch.go`)
- **Claim & Close (`CloseBatch`):**
  1. Identifies unbatched capture events in `transaction_events` within the date window.
  2. Resolves tiered MDR and fixed fees per transaction using `fee_schedules` (falling back to `merchants.mdr_bps`).
  3. Computes gross, total fees, and net payable.
  4. Inserts row into `settlement_batches` with status `'closed'`.
  5. Updates `merchant_balances` cache via `ApplyBatchClose(netPayout)`.
  6. Enqueues outbox event `settlement.batch_closed`.
- **Payout Disbursement (`PayoutBatch`):**
  1. Verifies batch is `'closed'`.
  2. Inserts balanced payout legs into `ledger_entries` (`merchant_payable` debit).
  3. Updates batch status to `'paid'`.
  4. Updates `merchant_balances` cache via `ApplyPayout(netPayout)`.
  5. Enqueues outbox event `settlement.paid`.

### 3. Card Scheme Clearing Export (`internal/settlement/scheme_export.go`)
- Quantizes 3-decimal fils transactions to 2-decimal format.
- Frozen into `scheme_export_lines` (`amount_fils` BIGINT, `amount` NUMERIC(10,2)).
- Finance reconciles bank clearing against these exported figures.

---

## 5. Internal HTTP RPC Server (`internal/internalapi/server.go`)

- **Port:** 8091 (internal Docker bridge network).
- **Authentication:** `Authorization: Bearer <SETTLEMENT_INTERNAL_TOKEN>`.
- **Endpoints:**
  - `POST /batch/run`: Body `{ date: "YYYY-MM-DD", merchantId?: "<uuid>" }`.
  - `POST /balances/rebuild`: Body `{ merchantId?: "<uuid>" }`.
  - `POST /mdr/recalculate`: Recalculates fees across date ranges.

---

## 6. Existing Tests & Verification

- Native Go tests located in `apps/settlement/internal/settlement/*_test.go`.
- Command to run:
  ```bash
  cd apps/settlement && go test ./...
  ```
- Tests validate business day window math, fee schedule hierarchy, and payout notifications.

---

## 7. Known Defects & Limitations

1. **Float32 Net Payable Precision (BUG-010):** `payable.go:11` calculates `netBD := float32(gross)/1000 - float32(fee)/1000`, causing 1–2 fils rounding drift on batches exceeding ~16,777 BD.
2. **Batch Loop Abortion (BUG-064):** In `daemon`, a failure on one merchant halts processing for all subsequent merchants in that daily run.
3. **Scheme Residue (PMA-08 source review, 2026-10-30):** `CloseBatch` now journals gross-minus-truncated residue per export line to the ADR accounts for new closes. Earlier omission notes are stale. Historical March impact remains unverified; retired `scripts/reconcile_march.ts` refuses execution and has no database/posting capability. Database-backed settlement tests require a migrated authorized database.
4. **MDR Recalculation on Paid Batches (BUG-035):** Recalculating MDR modifies already-paid batches directly.
5. **Config Precedence (BUG-080):** `PGCONN_SETTLEMENT` overrides `DATABASE_URL` even when `DATABASE_URL` is set.
