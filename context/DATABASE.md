# Database Architecture & Schema Reference — FilsPay

> **Scope:** PostgreSQL 16 schema, table definitions, relationships, double-entry trigger mechanics, migration runner operations, and seed safety.

---

## 1. PostgreSQL Architecture & Conventions

- **Database Engine:** PostgreSQL 16.
- **Extensions Installed:** `uuid-ossp` (UUID generation), `pgcrypto` (cryptographic hashing and random bytes).
- **Primary Keys:** UUIDs (`gen_random_uuid()`) across all core entities.
- **Monetary Columns:** Must end with `_fils` and use `BIGINT`. Never use `NUMERIC`, `REAL`, or `FLOAT` for internal money storage.
- **Timestamps:** `TIMESTAMPTZ` with `DEFAULT now()`.
- **Transactions:** Multi-step writes, outbox events, and audit logs must run in a single atomic transaction.

---

## 2. Migration Runner (`db/migrate.ts`)

The migration runner is a lightweight, custom TypeScript script applying SQL migrations sequentially:
- **Tracking Table:** `schema_migrations` (`filename TEXT PRIMARY KEY`, `applied_at TIMESTAMPTZ NOT NULL DEFAULT now()`).
- **Execution Logic:** Reads `db/migrations/*.sql`, sorts filenames lexically, queries `schema_migrations`, and applies unapplied files inside individual transactions (`BEGIN` ... `COMMIT`).
- **Numbering Gaps:** Gaps exist in the migration sequence (historical missing files: 0039, 0041, 0059, 0062, 0063, 0067; total 72 files ending at 0078). Note that 0054, 0055, and 0056 exist in the repo. The runner sorts lexically and ignores gaps, applying all present files sequentially.
- **Known Risk (BUG-081):** The runner does not compute or verify file checksums. If an already-applied migration is altered on disk, the runner will not detect it. Never modify applied migration files!

---

## 3. Core Table Inventory & Schemas

### 1. Merchant & Account Hierarchy
- **`merchants` (0002):**
  - `id`: UUID (PK).
  - `name`: TEXT NOT NULL.
  - `status`: TEXT NOT NULL (`'pending'`, `'approved'`, `'suspended'`).
  - `mdr_bps`: INTEGER NOT NULL (Default Merchant Discount Rate in basis points; 100 bps = 1.00%).
  - `onboarding_status`: TEXT (0014: `'pending'`, `'under_review'`, `'approved'`, `'rejected'`).
  - `discount_bps`: INTEGER (0047: negotiated merchant discount in basis points).
  - `refunds_enabled`: BOOLEAN (0052: whether merchant is permitted to initiate refunds).
- **`merchant_users` (0003, 0010):**
  - `id`: UUID (PK).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `email`: TEXT UNIQUE NOT NULL.
  - `password_hash`: TEXT (Argon2id hash).
  - `role`: TEXT NOT NULL (`'owner'`, `'finance'`, `'support'`).
  - `status`: TEXT NOT NULL (`'active'`, `'invited'`, `'disabled'`).
- **`sessions` (0012):**
  - `token_hash`: TEXT (PK, SHA-256 of session bearer token).
  - `user_id`: UUID (FK $\rightarrow$ `merchant_users.id`).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `pending_otp`: BOOLEAN NOT NULL (True until 2FA OTP is verified).
  - `expires_at`: TIMESTAMPTZ NOT NULL.
- **`otp_challenges` (0011):**
  - `id`: UUID (PK).
  - `user_id`: UUID (FK $\rightarrow$ `merchant_users.id`).
  - `code_hash`: TEXT (Argon2id hash of 6-digit OTP code).
  - `attempts`: INTEGER NOT NULL DEFAULT 0.
  - `verified`: BOOLEAN NOT NULL DEFAULT false.
  - `expires_at`: TIMESTAMPTZ NOT NULL.
- **`api_keys` (0013, 0037, 0056):**
  - `id`: UUID (PK).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `key_hash`: TEXT NOT NULL.
  - `key_prefix`: TEXT NOT NULL.
  - `created_at`: TIMESTAMPTZ NOT NULL.
  - `revoked_at`: TIMESTAMPTZ (Set upon rotation or revocation).
  - `revoke_after`: TIMESTAMPTZ (Grace period timestamp for phased rotation).

### 2. Transaction Processing & Authorizations
- **`transactions` (0004, 0017, 0043):**
  - `id`: UUID (PK).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `currency`: TEXT NOT NULL (Fixed `'BHD'`).
  - `status`: TEXT NOT NULL (`'authorized'`, `'captured'`, `'partially_captured'`, `'voided'`, `'refunded'`, `'partially_refunded'`).
  - `captured_fils`: BIGINT NOT NULL DEFAULT 0.
  - `refunded_fils`: BIGINT NOT NULL DEFAULT 0 (0043).
  - `acquirer_reference`: TEXT (0017).
  - `occurred_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
- **`holds` (0005):**
  - `id`: UUID (PK).
  - `transaction_id`: UUID (FK $\rightarrow$ `transactions.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `status`: TEXT NOT NULL (`'active'`, `'captured'`, `'released'`, `'expired'`).
  - `expires_at`: TIMESTAMPTZ NOT NULL.
- **`transaction_events` (0018, 0023, 0044):**
  - `id`: UUID (PK).
  - `transaction_id`: UUID (FK $\rightarrow$ `transactions.id`).
  - `event_type`: TEXT NOT NULL (`'authorized'`, `'captured'`, `'voided'`, `'refunded'`).
  - `amount_fils`: BIGINT NOT NULL.
  - `settlement_batch_id`: UUID (FK $\rightarrow$ `settlement_batches.id`, set when batched).
  - `occurred_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
- **`idempotency_keys` (0019):**
  - `key`: TEXT NOT NULL.
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `request_hash`: TEXT NOT NULL.
  - `response_code`: INTEGER NOT NULL.
  - `response_body`: JSONB NOT NULL.
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
  - PRIMARY KEY (`merchant_id`, `key`).

### 3. Payment Links & Refunds
- **`payment_links` (0020, 0029, 0074):**
  - `id`: UUID (PK).
  - `token`: TEXT UNIQUE NOT NULL (128-bit random token).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `status`: TEXT NOT NULL (`'active'`, `'reserved'`, `'paid'`, `'expired'`, `'cancelled'`).
  - `single_use`: BOOLEAN NOT NULL DEFAULT true.
  - `expires_at`: TIMESTAMPTZ NOT NULL.
  - `reserved_until`: TIMESTAMPTZ (Reservation timeout lock for in-flight checkout).
  - `transaction_id`: UUID (FK $\rightarrow$ `transactions.id`, set when paid).
- **`refunds` (0042, 0070, 0075):**
  - `id`: UUID (PK).
  - `transaction_id`: UUID (FK $\rightarrow$ `transactions.id`).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `status`: TEXT NOT NULL (`'pending'`, `'succeeded'`, `'failed'`).
  - `reason`: TEXT NOT NULL DEFAULT `'unspecified'`.
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
- **`pending_refund_reservations` (0077):**
  - `id`: UUID (PK).
  - `transaction_id`: UUID (FK $\rightarrow$ `transactions.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now().

### 4. Double-Entry Ledger & Balances
- **`accounts` (0007):**
  - `id`: TEXT PRIMARY KEY (`'merchant_payable'`, `'customer_settlement'`, `'fee_revenue'`, `'scheme_rounding_residue'`, `'goodwill'`, `'manual_adjustment'`).
  - `description`: TEXT.
- **`ledger_entries` (0007):**
  - `id`: UUID (PK).
  - `entry_group_id`: UUID NOT NULL.
  - `merchant_id`: UUID NOT NULL.
  - `account_id`: TEXT (FK $\rightarrow$ `accounts.id`).
  - `direction`: TEXT NOT NULL (`'debit'` or `'credit'`).
  - `amount_fils`: BIGINT NOT NULL CHECK (`amount_fils > 0`).
  - `occurred_at`: TIMESTAMPTZ NOT NULL.
  - `description`: TEXT NOT NULL.
- **`merchant_balances` (0025):**
  - `merchant_id`: UUID (PK, FK $\rightarrow$ `merchants.id`).
  - `cached_payable_fils`: BIGINT NOT NULL DEFAULT 0.
  - `last_settlement_batch_id`: UUID.
  - `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now().

### 5. Settlement & Scheme Operations
- **`settlement_batches` (0006, 0024, 0078):**
  - `id`: UUID (PK).
  - `business_date`: DATE NOT NULL.
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `status`: TEXT NOT NULL (`'open'`, `'closed'`, `'paid'`).
  - `gross_fils`: BIGINT NOT NULL DEFAULT 0.
  - `fee_fils`: BIGINT NOT NULL DEFAULT 0.
  - `net_payout_fils`: BIGINT NOT NULL DEFAULT 0.
  - `closed_at`: TIMESTAMPTZ.
  - `paid_at`: TIMESTAMPTZ.
  - UNIQUE (`business_date`, `merchant_id`).
- **`scheme_export_lines` (0008, 0026, 0050):**
  - `id`: UUID (PK).
  - `batch_id`: UUID (FK $\rightarrow$ `settlement_batches.id`).
  - `transaction_id`: UUID (FK $\rightarrow$ `transactions.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `amount`: NUMERIC(10,2) NOT NULL (Exported 2-decimal figure).
  - `line_number`: INTEGER NOT NULL.
- **`fee_schedules` (0048):**
  - `id`: UUID (PK).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `card_type`: TEXT NOT NULL (`'visa'`, `'mastercard'`, `'benefit'`).
  - `mdr_bps`: INTEGER NOT NULL.
  - `fixed_fee_fils`: BIGINT NOT NULL DEFAULT 0.
  - `effective_from`: TIMESTAMPTZ NOT NULL.

### 6. Transactional Outbox & Events
- **`outbox_events` (0009):**
  - `id`: BIGSERIAL (PK).
  - `event_type`: TEXT NOT NULL.
  - `aggregate_id`: UUID NOT NULL.
  - `payload`: JSONB NOT NULL.
  - `status`: TEXT NOT NULL DEFAULT `'pending'` (`'pending'`, `'published'`).
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
- **`reporting_outbox_cursor` (0030):**
  - `consumer_name`: TEXT PRIMARY KEY (e.g., `'reporting_worker'`).
  - `last_event_id`: BIGINT NOT NULL DEFAULT 0.
  - `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now().

### 7. Administrative Management & Auditing
- **`admin_users` (0031):**
  - `id`: UUID (PK).
  - `email`: TEXT UNIQUE NOT NULL.
  - `password_hash`: TEXT NOT NULL.
  - `role`: TEXT NOT NULL (`'support'`, `'finance'`, `'super_admin'`).
- **`admin_sessions` (0033):**
  - `token_hash`: TEXT PRIMARY KEY.
  - `admin_id`: UUID (FK $\rightarrow$ `admin_users.id`).
  - `pending_otp`: BOOLEAN NOT NULL DEFAULT true.
  - `expires_at`: TIMESTAMPTZ NOT NULL.
- **`admin_audit_log` (0034):**
  - `id`: UUID (PK).
  - `admin_id`: UUID (FK $\rightarrow$ `admin_users.id`).
  - `action`: TEXT NOT NULL.
  - `target_type`: TEXT NOT NULL.
  - `target_id`: TEXT NOT NULL.
  - `metadata`: JSONB.
  - `occurred_at`: TIMESTAMPTZ NOT NULL DEFAULT now().
- **`admin_impersonation_grants` (0035):**
  - `id`: UUID (PK).
  - `grant_token_hash`: TEXT UNIQUE NOT NULL.
  - `admin_id`: UUID (FK $\rightarrow$ `admin_users.id`).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `expires_at`: TIMESTAMPTZ NOT NULL.
  - `revoked_at`: TIMESTAMPTZ.
- **`credit_requests` (0060):**
  - `id`: UUID (PK).
  - `merchant_id`: UUID (FK $\rightarrow$ `merchants.id`).
  - `amount_fils`: BIGINT NOT NULL.
  - `reason`: TEXT NOT NULL.
  - `created_by`: UUID (FK $\rightarrow$ `admin_users.id`).
  - `approved_by`: UUID (FK $\rightarrow$ `admin_users.id`).
  - `status`: TEXT NOT NULL (`'pending'`, `'approved'`, `'rejected'`).

---

## 4. Deferred Trigger Mechanics (Migration 0007)

```sql
CREATE OR REPLACE FUNCTION check_ledger_group_balance() RETURNS trigger AS $$
BEGIN
  IF (
    SELECT COALESCE(SUM(
      CASE direction
        WHEN 'debit' THEN amount_fils
        WHEN 'credit' THEN -amount_fils
      END
    ), 0)
    FROM ledger_entries
    WHERE entry_group_id = NEW.entry_group_id
  ) <> 0 THEN
    RAISE EXCEPTION 'Ledger entry group % is not balanced to zero', NEW.entry_group_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trigger_check_ledger_group_balance
AFTER INSERT OR UPDATE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_ledger_group_balance();
```

Because the trigger is `DEFERRABLE INITIALLY DEFERRED`, individual legs can be inserted sequentially inside a transaction. The balance validation fires immediately before `COMMIT`.

---

## 5. Seed Safety Protection

- The seed script (`db/seed/index.ts`) truncates fixture tables.
- **Safety Mechanism:** It checks `process.env.ALLOW_DESTRUCTIVE_SEED === "1"`.
- If the flag is not explicitly set, the script immediately terminates without modifying any tables.
- **Rule:** Never execute `npm run seed` against shared, staging, or production databases.

## Approved migration 0085: authenticator storage (2026-10-30)

Separate merchant_authenticators and admin_authenticators tables each key user_id to its own identity table. Columns: secret_ciphertext, enabled_at, last_used_step BIGINT, recovery_hashes TEXT[], pending_ciphertext, pending_id UUID, pending_session_id referencing that plane's sessions, pending_expires_at and pending_attempts (0..5). Only encrypted secrets and recovery hashes persist; confirmation/replay/recovery updates run under row locks. Session identity/expiry and pending binding are enforced server-side. User explicitly approved this new authentication migration; existing migrations and financial schemas are unchanged. Migration is added, not applied in this environment; existing migration-count metadata above predates this work.
