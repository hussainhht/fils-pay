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


## Checkout enhancement verification ? 2026-10-30

- `npm.cmd run test -w @filspay/web`: PASS (50 tests, including 12 new card-input cases).
- `npm.cmd run typecheck`: PASS across workspaces, DB and scripts.
- `npm.cmd run build -w @filspay/web`: PASS.
- Existing `apps/api/src/routes/paymentLinks.test.ts` and `apps/api/src/acquirer/simulator.test.ts`: PASS against reachable local migrated PostgreSQL 16.15 using their own fixtures, with a deterministic simulator.
- `node --import tsx apps/web/scripts/checkout.browser.test.mjs --live`: PASS. Installed Edge/CDP checks use intercepted sandbox fixtures for UI/error cases; `--live` additionally inserts labeled test fixtures and completes a payment through Vite ? API ? simulator ? PostgreSQL, checking captured status and ledger balance. The script defaults to localhost ports 5173/3000 and the local compose PostgreSQL port 5432; it never truncates data. Run only against a disposable/local development stack.
- `--baseline`: fails on the original open-link expiry bug; `--baseline --retry-only`: fails on the original retry-key bug. These read `HEAD` into a temporary sibling module and remove only the module created by the check. No branches/commits are changed.
- Screenshots: `Evidence/implementation/checkout-{desktop,mobile,small-mobile}.png` (1280px, 390px and 320px widths, sandbox UI fixtures with empty card fields).
- Windows restricted shell could not start tsx/esbuild; approved unrestricted commands passed. Direct root-level `node --import tsx --test "apps/web/src/**/*.test.ts"` failed two pre-existing JSX presentation cases (`React is not defined` in unchanged `CheckoutFrame.tsx`); the canonical workspace command loads the correct TSX configuration and passes all tests. No tests were weakened.
- Not verified: real acquirer/3DS, tokenization or saved-card ownership flows (not available), physical mobile devices, screen-reader speech, settlement/reporting, or broader merchant/admin auth journeys. See `Evidence/payment_checkout_enhancements.md` for the coverage matrix and manual checks.

## Payment-link BHD amount verification — 2026-10-30

- Baseline HEAD `1b1f64b2c3a42d53da6bc3e96a77a6ebe66e8392`: 50 existing web tests passed. `node apps/web/scripts/paymentLinkAmount.browser.test.mjs --baseline` failed as expected: `1.` became `1` in the raw-fils number field.
- `npm.cmd run test -w @filspay/web`: PASS, 55 tests including five new `pages/payment-links/bhdAmount.test.ts` cases for grammar/intermediate states, three-decimal completion, exact fils and overflow.
- `npm.cmd run typecheck`: PASS across all workspaces, DB and scripts. `npm.cmd run build -w @filspay/web`: PASS.
- `node apps/web/scripts/paymentLinkAmount.browser.test.mjs`: PASS, 11 installed-Edge verification groups. Requires a local Vite preview on port 5173; every API request is intercepted with sandbox fixtures. Covers decimal insertion/deletion/repositioning, requested examples, caret/selection (including backward), typing/paste, non-cancellable mobile input fallback, 390px/320px viewports and keyboard navigation, blur/submit normalization, invalid amount/expiry, exact safe-integer payload, metadata, errors, success navigation and support-role restriction.
- In `apps/api`, `node --import tsx --test src/routes/paymentLinks.test.ts`: PASS, all 8 existing tests against migrated local PostgreSQL 16.15 with their own fixtures and the simulator. `DATABASE_URL` was set only in process memory from local Compose configuration. Real DB SELECT passed; existing API health/ready and Vite-proxied health returned 200.
- Windows restricted-shell tsx/Vite attempts failed before verification; approved unrestricted execution passed. `node ops/preview.mjs` found port 5173 occupied; tests used the existing preview. No service was stopped and no migrations/seeding were needed.
- Not verified: physical mobile keyboards, other browser engines, IME, OS clipboard (paste events are synthetic), screen-reader speech, real browser login/OTP-to-creation/database journey, full API workspace suite, or settlement/reporting. Feature evidence and limits are maintained in the existing `Evidence/features/features.md` (FEAT-003).

## Payment-link expiration completion — 2026-10-30 (supersedes earlier verification limits for this feature)

Baseline `850504a2e500997fe1323b227354ea1d6fe50ea0`, initially clean. Existing BHD implementation retained. New service regression failed against a temporary copy of baseline creation (short expiry reached INSERT); updated browser `--baseline` failed because baseline has zero expiration radios.

- `npm.cmd run test -w @filspay/web`: **59 passed**, 0 skipped. New expiration tests cover every preset, hidden drafts, custom units/bounds/precision and host-timezone independence; existing BHD conversion/editing tests retained.
- `npm.cmd run typecheck`: **PASS** across workspaces, DB and scripts. `npm.cmd run build -w @filspay/web`: **PASS**.
- API targeted: `node --import tsx --test apps/api/src/paymentLinks/create.test.ts apps/api/src/paymentLinks/expiration.test.ts apps/api/src/routes/paymentLinks.test.ts`: **17 passed**, 0 skipped. Fixed clocks exercise inclusive second/millisecond boundaries, immediately outside bounds, malformed/non-finite inputs, exactly-one-of, offsets and delayed receipt. Route cases use real isolated PostgreSQL, including direct bypass, persisted deadlines, legacy instants, historical short/long links, expired new attempts and expired bound-key recovery with one transaction. Service rejection unit uses an insert stub; it is not a real DB test.
- `node apps/web/scripts/paymentLinkAmount.browser.test.mjs`: **14 mocked browser groups pass**, covering preserved decimal/cursor/paste behavior plus presets, custom units, minimum/maximum, hidden values, stale estimate, keyboard, green selection, metadata/errors/navigation and desktop/390/320px layout.
- With `DATABASE_URL` naming a migrated local `filspay_expiration_test_<digits>` database, `node --import tsx apps/web/scripts/paymentLinkAmount.browser.test.mjs --live`: **15 groups pass**. Adds real password/OTP → temporary Vite → current API → PostgreSQL creation and exact-fils/server-deadline checks, direct invalid creation 400s and three-decimal detail/checkout displays. The script refuses other databases, silences development OTP logs and closes its API/Vite/pool. Initial mocked cases still require preview at port 5173. No production authentication bypass.
- `node apps/web/scripts/checkout.browser.test.mjs`: **15 existing mocked checkout groups pass**; payment simulator/ledger behavior is independently exercised by API route tests.
- Full `npm.cmd run test -w @filspay/api`, alone against a fresh isolated migrated database: **509 tests, 508 passed, 1 failed, 0 skipped**. Unchanged dispatcher test expects exact 1000 ms despite intentional ±10% jitter (`959` final); no related files altered. Initial run also found a now-invalid 60-second security-token fixture; changed to valid 900 seconds with identical assertions. A reused-DB run additionally saw a settlement fake-server fetch failure and concurrent capture internal error; neither recurred on fresh standalone run, cause unverified. Exact history in FEAT-003.
- Runtime: existing health/ready and Vite health 200; real PostgreSQL 16.15 SELECT confirmed. Two isolated test databases created; all **78 existing migrations** applied, no migration source edits, seed/truncation/destructive cleanup. No real-provider payment calls. Existing services left running. Restricted-shell tsx failed before tests; approved unrestricted checks succeeded.

Not verified: physical mobile/other engines, OS clipboard, screen-reader speech, real providers or broader admin/KYC/settlement/reporting runtime paths. The full API suite remains red for the unrelated jitter assertion. Evidence is maintained in the existing FEAT-003, not a separate feature report.
