# Module: `db` (Migrations, Schemas & Seed Management)

> **Scope:** Migration runner (`db/migrate.ts`), 72 numbered SQL migrations, schema constraints, deferred triggers, and database seed safety.

---

## 1. Purpose & Responsibilities

The `db/` directory manages the schema evolution and baseline fixture data for PostgreSQL 16:
1. `db/migrate.ts`: Custom idempotent migration runner applying SQL migrations in lexical order.
2. `db/migrations/`: 72 sequential SQL migration files establishing all tables, constraints, indices, and triggers.
3. `db/seed/`: Fixture generator creating initial merchants, users, and fee schedules for local development.

---

## 2. Migration Runner Architecture (`db/migrate.ts`)

- **Execution Command:** `DATABASE_URL=... npx tsx db/migrate.ts` (or `npm run migrate`).
- **Bootstrap Table:** `schema_migrations`:
  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- **Execution Flow:**
  1. Bootstraps `schema_migrations` if missing.
  2. Queries applied filenames into an in-memory `Set`.
  3. Reads all `*.sql` files in `db/migrations/` and sorts them lexically.
  4. For each unapplied file: begins a PostgreSQL transaction, executes the raw SQL, inserts the filename into `schema_migrations`, and commits.
  5. Rolls back the transaction on any error and halts execution.
- **Handling Numbering Gaps:**
  - Historical branches left numbering gaps (missing numbers: 0039, 0041, 0059, 0062, 0063, 0067; total 72 files ending at 0078). Note that 0054_views.sql, 0055_chart_of_accounts_suspense.sql, and 0056_api_keys_revoke_after.sql exist on disk.
  - The runner sorts by string name and applies missing files sequentially; gaps do not disrupt the runner.

---

## 3. Migration Sequence Overview (0001 to 0078)

- `0001_extensions.sql`: `uuid-ossp`, `pgcrypto`.
- `0002_merchants.sql`: Core `merchants` table.
- `0003_merchant_users.sql` & `0010_password_auth.sql`: Merchant user accounts and Argon2id hashes.
- `0004_transactions.sql` & `0005_holds.sql`: Transaction ledger and authorization holds.
- `0006_settlement_batches.sql`, `0024`, `0078_settlement_paid_once.sql`: Settlement batch records and payout locking.
- `0007_ledger_double_entry.sql`, `0055_chart_of_accounts_suspense.sql`, `0061_goodwill.sql`, `0064_manual_adjustment.sql`: `accounts`, `ledger_entries`, and zero-sum deferred constraint trigger.
- `0008_scheme_export_lines.sql`, `0026`, `0050`: Card scheme 2-decimal export table.
- `0009_outbox_events.sql` & `0030`: Transactional outbox table and reporting cursor.
- `0011_otp_challenges.sql` & `0012_sessions.sql`: 2FA OTP challenges and session cookies.
- `0013_api_keys.sql`, `0037`, `0056_api_keys_revoke_after.sql`: API keys and rotation tracking.
- `0019_idempotency_keys.sql`: Idempotency responses for captures and refunds.
- `0020_payment_links.sql`, `0029`, `0074_payment_link_claims.sql`: Payment links and reservation locks.
- `0021_webhook_endpoints.sql`, `0022_webhook_deliveries.sql`, `0068_archives.sql`: Webhook configuration, attempt logs, and delivery archives.
- `0025_merchant_balances.sql`: Cached payable position.
- `0031_admin_users.sql`, `0032`, `0033`, `0034`, `0035_impersonation.sql`: Admin plane users, sessions, audit log, and impersonation grants.
- `0042_refunds.sql`, `0043`, `0070`, `0071`, `0072`, `0075_refund_integrity.sql`, `0077_pending_refund_reservations.sql`: Refunds and reservations.
- `0048_fee_schedules.sql`: Tiered MDR and fixed fee schedules.
- `0054_views.sql`: Convenience views.
- `0060_credit_requests.sql`: Two-person credit approval requests.
- `0065_adjustment_imports.sql` & `0066_adjustment_import_rows.sql`: CSV balance adjustment batch imports.

---

## 4. Seed Script & Safety Guards (`db/seed/`)

- **Execution Command:** `npm run seed` (or `tsx db/seed/index.ts`).
- **Destructive Nature:** The seed script executes `TRUNCATE` across fixture tables.
- **Safety Guard (`BUG-054`):**
  ```typescript
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "1") {
    throw new Error("seed: ALLOW_DESTRUCTIVE_SEED=1 is required. This script truncates fixture tables!");
  }
  ```
- **Rule:** Never seed shared databases. Always verify `DATABASE_URL` points to an isolated local container before seeding.

---

## 5. Existing Tests & Verification

- Seed safety unit test:
  ```bash
  node --import tsx --test db/seed/safety.new.test.ts
  ```
  *(Passes 4/4 tests verifying truncation guard behavior without a DB).*
