# Module: `scripts` & `ops` (Operations, Janitors & Infrastructure)

> **Scope:** Operational maintenance scripts (`expire_holds`), finance reconciliation (`reconcile_march`), Docker Compose orchestration, and local preview tooling.

---

## 1. Operational Maintenance Scripts (`scripts/`)

### 1. Hold Expiration Janitor (`scripts/expire_holds.ts`)
- **Purpose:** Sweeps authorizations that expired without being captured or voided, freeing orphaned records.
- **Execution:** `DATABASE_URL=... npx tsx scripts/expire_holds.ts`.
- **Workflow:**
  1. Queries candidate hold IDs: `SELECT id FROM holds WHERE status = 'active' AND expires_at < now()`.
  2. Constructs delete statement via `buildDelete("holds", { id: expiredIds })`.
  3. Executes deletion against PostgreSQL.
- **CRITICAL DEFECT (BUG-013):**
  - In `scripts/lib/sqlFilter.ts:10`, if `expiredIds` is an empty array (`val.length === 0`), `buildWhere` skips the filter.
  - As a result, `buildDelete` generates: `DELETE FROM holds` with **NO WHERE CLAUSE**.
  - On any quiet night with zero expired holds, this janitor **deletes every active hold in the platform**.
  - *Mitigation:* Ensure `expiredIds.length > 0` before constructing or executing the delete statement.

### 2. March 2026 Scheme Residue Sweep (`scripts/reconcile_march.ts`)
- **Status (2026-10-30):** Retired; PMA-08 / BUG-033 prevention is `fix-verified`.
- **Execution:** Direct execution prints a retirement error and exits 1, with or without database configuration. There is no bypass.
- **Import:** Silent; only pure historical `monthBounds` (UTC) and `computeResidueFils` helpers remain for existing test compatibility. These are not a new reconciliation policy.
- **Safety:** No database dependency, connection, query, UUID generation, or posting implementation remains. Original implementation is preserved in Git at `c3eb21830dd133a47e86bf5f9150a3ba8f9caffd`.
- **Supported path:** Go `CloseBatch` posts scheme-line residue for new closes independently. No runtime workflow imports this retired module.
- **Historical impact:** Unverified; no database was available. Any correction needs separate approval; see `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md`.

---

## 2. Infrastructure & Local Stack (`ops/`)

### 1. Environment Generator (`ops/setup-env.mjs`)
- Generates `ops/.env.docker` with cryptographically secure random values:
  - `WEBHOOK_SECRET_ENCRYPTION_KEY`: 32 random bytes (base64).
  - `SETTLEMENT_INTERNAL_TOKEN`: 32 random bytes (hex).
  - `ACQUIRER_CALLBACK_SIGNING_SECRET`: 32 random bytes (hex).
- Uses flag `'wx'` to preserve existing tokens on rerun.

### 2. Docker Compose (`ops/docker-compose.yml`)
- Multi-container local stack:
  - `postgres` (16-alpine, port 5432).
  - `migrate` (executes `npm run migrate`).
  - `api` (Fastify gateway on port 3000).
  - `settlement` (Go daemon on port 8091).
  - `reporting` (analytics worker consuming outbox).

### 3. Preview Proxy Runner (`ops/preview.mjs`)
- Programmatically launches Vite development servers:
  - `web`: Port 5173, reverse-proxying `/v1` to `http://127.0.0.1:3000`.
  - `admin`: Port 5174, reverse-proxying `/v1` to `http://127.0.0.1:3000`.
- Ensures cookies (`fp_sid`, `fp_admin_sid`, `fp_impersonation`) pass transparently across origins.

---

## 3. Existing Tests & Verification

- Script tests:
  - `scripts/expire_holds.test.ts`.
  - `scripts/reconcile_march.test.ts`.
  - `scripts/reconcile_march.retirement.test.ts` (database-free static/process safety tests).
  - `scripts/reconcile_march.integration.test.ts`.
- Command to run:
  ```bash
  npx.cmd tsx --test scripts/*.test.ts
  ```
