# Testing Strategy & Verification Guidelines — FilsPay

> **Scope:** Test suites, test runners, execution environments, database prerequisites, regression standards, and command references.

---

## 1. Testing Frameworks & Philosophy

FilsPay enforces strict test-driven verification for all financial, security, and authorization logic:
1. **Never Weaken Tests:** Never delete, skip, or modify an existing test to produce a green result. A failing test signals an architectural defect.
2. **Mandatory Regression Tests:** Every fix for a confirmed bug must be accompanied by a dedicated regression test (`*.test.ts` or `*.reg.test.ts`) that fails against the baseline code and passes after the fix.
3. **Transparent Reporting:** Never claim a test passed unless it was actually executed. If a test cannot run due to missing infrastructure (e.g. absent PostgreSQL or Docker), it must be reported honestly as **BLOCKED / NOT RUN**.

---

## 2. Test Suite Classification

### 1. Pure Unit Tests (Zero External Dependencies)
These tests execute entirely in memory and do not require Docker or a running PostgreSQL database:
- `packages/money`: `packages/money/src/fils.test.ts` (40 tests covering rounding, branding, parsing, allocation).
- `packages/events`: `packages/events/src/outbox.test.ts` (4 tests validating outbox payloads).
- `apps/api` isolated unit tests:
  - `apps/api/src/admin/creditApproval.test.ts` (two-person rule display name vs ID checks).
  - `apps/api/src/reporting/scope.new.test.ts` (split merchant scope mock test).
- `db/seed` safety tests:
  - `db/seed/safety.new.test.ts` (4 tests confirming `ALLOW_DESTRUCTIVE_SEED` blocks truncation).

### 2. Integration Tests (Requires Migrated PostgreSQL)
These tests boot Fastify or connect to Postgres via `DATABASE_URL` and execute real SQL queries and transactions:
- `apps/api/src/routes/*.test.ts`:
  - `transactions.test.ts`: Authorize, capture, void, idempotency replay, hold validation.
  - `admin.test.ts`: KYC approvals, API key rotation, merchant search.
  - `adminCredits.test.ts`: Credit creation, role enforcement, dual approval.
  - `paymentLinks.test.ts`: Claim timeout, token reservation, public response sanitization.
  - `auth/geminiMerchantIsolation.reg.test.ts`: Saved-filter impersonation write-lock tests.
- `apps/reporting`: Outbox consumer polling and aggregate updates (`applyEvent.test.ts`, `runConsumerPass.test.ts`).
- `scripts/*.test.ts`: Hold expiration and March reconciliation integration tests.

### 3. Go Settlement Tests (`apps/settlement`)
- Native Go test suite (`go test ./...`) validating fee calculations, Asia/Bahrain business windows, batch state transitions, and scheme export generation.

---

## 3. Test Execution Commands

### Full Workspace Typecheck
```bash
npm run typecheck
```
*Executes `tsc` across all workspaces (`packages/*`, `apps/*`), `db/`, and `scripts/`.*

### Running Entire Test Suite
```bash
npm test
```
*Note: If `DATABASE_URL` is unset, integration tests will throw connection errors.*

### Running Specific Workspaces & Suites
```bash
# Protected Money package (pure unit tests, always runs without DB)
npm run test -w @filspay/money

# Events package (pure unit tests)
npm run test -w @filspay/events

# Single isolated unit test with tsx
npx tsx --test apps/api/src/admin/creditApproval.test.ts

# Seed safety unit tests
node --import tsx --test db/seed/safety.new.test.ts

# API Workspace tests (Requires active PostgreSQL on DATABASE_URL)
npm run test -w @filspay/api

# Go Settlement Suite
cd apps/settlement && go test ./...
```

### Windows PowerShell Execution Note
On Windows environments where PowerShell execution policies restrict `.ps1` scripts, use `npm.cmd` and `npx.cmd`:
```powershell
npm.cmd run typecheck
npx.cmd tsx --test packages/money/src/fils.test.ts
```

---

## 4. Verification Checklist for Changes

Before declaring any change complete:
1. `npm run typecheck` passes with zero errors across all workspaces.
2. The co-located regression test fails on baseline code and passes with the fix.
3. If PostgreSQL is available, affected route/integration tests pass. If PostgreSQL is unavailable, state explicitly that integration tests were **BLOCKED**.
4. No application code outside the authorized workstream was touched.
5. No credentials, secrets, or card data were exposed.
6. The corresponding context files under `context/` were updated.
