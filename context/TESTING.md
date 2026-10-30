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

## PMA-01 delivery regression coverage (2026-10-30)

`apps/api/src/auth/otpDelivery.new.test.ts` exercises both notifiers with mocked fetch: payload/recipient/plane/idempotency, sanitized provider errors, network/body timeouts, startup validation, production exposure refusal and no-code logs. `apps/api/src/routes/otpDelivery.new.test.ts` uses real Fastify handlers and crypto with an in-memory query fixture: both login/verify paths, after-commit submission, no success cookie on failure, consumed/expired/incorrect/exhausted OTPs, cookie separation, account/challenge limits and merchant resend semantics. These are not Postgres integration tests and do not prove locks/concurrency or inbox delivery. Existing `routes/auth-security.new.test.ts`, `auth/forkBatch1.new.test.ts` and DB-backed auth suites remain required against an identified isolated migrated database. See Evidence/PMA-01_OTP_DELIVERY_FIX.md for exact executed command/counts and blockers.

## Microsoft Authenticator verification (2026-10-30)

Focused checks only, per user request to avoid overtesting. auth/totp.new.test.ts covers RFC vectors, drift bounds, AES-GCM tamper/plane/user isolation, QR URI, recovery entropy/scoping and atomic-helper behavior. routes/otpDelivery.new.test.ts additionally exercises real Fastify TOTP handlers over an in-memory SQL fixture: enrollment ownership, Origin/impersonation, confirmation expiry/attempts/session binding, login replay, recovery use and replacement. These mocks do not prove PostgreSQL locking. routes/totp.integration.test.ts contains two real local-test-DB scenarios for concurrent replay/recovery, factor replacement/session revocation, and shared-email merchant tenant isolation; both skip without DATABASE_URL. They were not run against Postgres here. Evidence/MICROSOFT_AUTHENTICATOR_INTEGRATION.md records commands, counts and deployment/device blockers.

## PMA-08 retired reconciliation safety (2026-10-30)

`node --import tsx --test scripts/reconcile_march.test.ts scripts/reconcile_march.retirement.test.ts`: 6/6 pass. New tests cover dependency/posting removal, CLI refusal (twice each with absent and synthetic database configuration), silent import with helper compatibility, and absence of package/automation invocations. A loader guard rejects pg before module evaluation; no historical posting logic or database was executed. Baseline safety tests failed as expected. `npm.cmd run typecheck` passes. Database-backed reconciliation stress and settlement runtime checks were not run: no DATABASE_URL or Docker is available. Full Go verification outcome is recorded in Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md.

## Checkout UI redesign (2026-10-30)

Focused validation completed: web suite 45/45, simulator 6/6, payment-link pay/status/serialization unit tests 13/13, production web build and full repository typecheck passed. Seven new checkout render/callback tests use React server rendering and inspect actual JSX callbacks; they do not prove browser interactions or payment integration. No lint script/configuration is present. Browser host/native automation unavailable; visual checks at 375, 768, 1024 and 1440, keyboard checks and screenshots were not run. No identified isolated DATABASE_URL or Docker executable: DB-backed checkout/recovery tests not run. Existing API /healthz and /readyz returned 200, which does not verify a current real DB query. User requested no further testing after these focused checks. Screenshot fixture: node scripts/checkout-preview.mjs; original baseline: add --before. See Evidence/ui_checkout_redesign.md.

### Checkout screenshot regression follow-up (2026-10-30)

One added intrinsic-SVG-sizing regression was observed failing before the fix (from apps/web, to use its JSX configuration). After the fix: web suite 46/46, web build and full repository typecheck passed. HTTP checks of the real localhost:5173 CSS/module bodies now assert layout selectors and explicit SVG sizes rather than merely HTTP 200. No additional payment integration or broad suites run. Browser screenshots remain unavailable.
