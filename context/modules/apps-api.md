# Module: `apps/api` (Fastify Gateway & Application Backend)

> **Scope:** Architecture, routes, controllers, middleware, plugins, acquirer simulator, and webhook dispatcher for the primary REST API service.

---

## 1. Purpose & Responsibilities

`apps/api` is the central application gateway for FilsPay. It provides:
1. Public and merchant-facing REST endpoints for authentication, onboarding, transactions, payment links, and refunds.
2. An administrative plane (`/v1/admin/*`) for operations, KYC document review, credit management, and settlement triggers.
3. An acquirer callback receiver verifying incoming HMAC signatures.
4. An outbound webhook delivery engine powered by a PostgreSQL `LISTEN/NOTIFY` dispatcher.
5. Integration with the internal Go settlement worker.

---

## 2. Main Entry Points & Key Files

- **`src/index.ts`:** Application daemon entry point. Initializes DB pool, calls `loadConfig()`, boots Fastify listening on `PORT` (default 3000), starts the background webhook dispatcher (`startWebhookDispatcher`).
- **`src/app.ts`:** `buildApp(config, pool, options)` factory. Configures Fastify decorators (`app.db`, `app.config`, `app.acquirer`, `app.webhookTransport`), registers plugins, and attaches route prefixes.
- **`src/config.ts`:** App configuration loader. Throws fast on missing `DATABASE_URL`, invalid base64 `WEBHOOK_SECRET_ENCRYPTION_KEY`, or missing production secrets.
- **`src/plugins/`:**
  - `cookies.ts`: `@fastify/cookie` integration.
  - `multipart.ts`: KYC file upload handler with MIME-type and size validation.
  - `errorHandler.ts`: Central error translation turning `AppError` subclasses into structured JSON responses.
- **`src/routes/`:**
  - `auth.ts`: `/v1/auth` (merchant authentication, OTP challenge/verification, session rotation).
  - `businessProfile.ts`: `POST /v1/merchants` (signup) and `GET`/`PATCH` `/v1/merchants/:merchantId/business-profile`.
  - `kyc.ts`: `/v1/merchants/:merchantId/kyc/documents` (upload, list, inline file stream, thumbnail).
  - `apiKeys.ts`: `/v1/merchants/:merchantId/api-keys` (issue, list, revoke API keys).
  - `transactions.ts`: `/v1/transactions` (authorize, capture, void, search, CSV export).
  - `refunds.ts`: `/v1/refunds` and `/v1/merchants/:merchantId/refunds` (FP-212 refunds).
  - `paymentLinks.ts`: `/v1/merchants/:merchantId/payment-links` and public `/v1/payment-links/:token`.
    - Creation calls `paymentLinks/create.ts` and `expiration.ts`: positive safe-integer fils, optional string metadata, exactly one of whole `expiresInSeconds` (900..10368000 inclusive) or absolute ISO `expiresAt` in the same server-relative window. One server-time reference resolves seconds into the existing persisted deadline. Invalid input returns 400. Bounds affect new creation only; historical links, reads, payment admission and durable key/request recovery are unchanged. No partner-tree or schema changes.
  - `admin*.ts`: `/v1/admin/*` (admin auth, merchants, KYC reviews, bulk approvals, credits, balance adjustments, batch re-runs, balance rebuilds).
  - `acquirerCallbacks.ts`: `/v1/acquirer/callbacks` (inbound HMAC verified informational fraud-review receiver).
  - `webhooks.ts`: `/v1/merchants/:merchantId/webhook-endpoints` (merchant webhook registrations and deliveries).
  - `settlement.ts`: `/v1/settlement` (batch queries).
  - `reporting.ts`: `/v1/reporting` (daily volume, payout trends, saved filters).
  - `analytics.ts`: `/v1/analytics/overview` (high-level KPIs).
  - `health.ts`: `/healthz`, `/readyz` (liveness and boot readiness checks).
- **`src/v1/`:** **Protected Partner API Contract — FROZEN / DO NOT MODIFY**.

---

## 3. Dependencies & Data Flow

### Internal & External Dependencies
- `packages/money`: Integer `Fils` type, `toFils`, `formatBhd`, `applyRateFils`.
- `packages/events`: Outbox event schemas (`enqueueEvent`).
- PostgreSQL 16: Primary relational database via `pg.Pool`.
- `apps/settlement`: Internal HTTP RPC client (`src/settlement/client.ts`) reaching port 8091 with bearer token.

### Request Data Flow
1. Client sends HTTP request. Fastify evaluates CORS, parses JSON, and parses cookies (`fp_sid`, `fp_admin_sid`, `fp_impersonation`).
2. Route preHandler (`requireMerchantAuth` or `requireAdminSession`) authenticates caller and populates request context.
3. Controller validates schema and parameters (`zod` or custom validators).
4. Domain service executes business logic inside a PostgreSQL transaction (`withTransaction`).
5. Double-entry ledger rows and outbox events are inserted atomically.
6. Controller formats response using integer fils and sends JSON.

---

## 4. Business Rules & Invariants

1. **Partner Contract Freeze:** The route tree under `src/v1/` is frozen; do not alter route paths or payload contracts.
2. **Strict Tenant Scoping:** Controllers must use `request.merchantAuth.merchantId`. Never trust client-supplied merchant IDs.
3. **Double-Entry Balance:** All payment captures, refunds, and adjustments must post balanced debit/credit legs to `ledger_entries`.
4. **Idempotency Protection:** Capture and refund routes require an `Idempotency-Key` header. The idempotency hash must bind the target transaction ID (`BUG-021`).
5. **Read-Only Impersonation:** Any mutation route must verify that `actorType !== 'admin_impersonation'`.
6. **Feature Flags:** Refunds are gated by `FEATURE_REFUNDS=true` (`src/config.ts`); returns 501 when disabled (`BUG-027`).

---

## 5. Authentication & Authorization

- **Merchant Plane:**
  - `requireMerchantAuth`: Validates `fp_sid` cookie or `Authorization: Bearer <api_key>`. Resolves active merchant user.
  - `requireMerchantRole(...roles)`: Verifies role matches `'owner'`, `'finance'`, or `'support'`.
  - `requireMerchantWriterActor`: Enforces that caller is not an admin impersonator.
- **Admin Plane:**
  - `requireAdminSession`: Validates `fp_admin_sid` cookie against `admin_sessions`.
  - `requireAdminRole(...roles)`: Verifies role matches `'support'`, `'finance'`, or `'super_admin'`.
  - Dual control: Credits > 50 BD require a distinct approving admin (`BUG-040`).

---

## 6. Database Interactions

- Primary tables read/written: `merchants`, `merchant_users`, `sessions`, `api_keys`, `transactions`, `holds`, `refunds`, `payment_links`, `ledger_entries`, `outbox_events`, `admin_users`, `admin_sessions`, `admin_audit_log`, `admin_impersonation_grants`.
- Multi-step writes use `withTransaction(pool, async (client) => { ... })`.
- Transactions and holds are locked using `SELECT ... FOR UPDATE` during capture and refund.

---

## 7. Webhook Delivery Engine (`src/webhooks/`)

- `dispatcher.ts` listens on `outbox_events_channel` and polls every 5 seconds
  by default. It creates unique event/endpoint deliveries, leases one due row at
  a time with `SKIP LOCKED`, and retries with capped exponential backoff/jitter.
  Preparation and transport exceptions count toward the attempt limit without
  logging raw exceptions. Database outcome failures retain the recovery lease.
- `sign.ts` signs timestamp plus the canonical JSON bytes actually transmitted.
  AES-256-GCM secrets are decrypted only for sends. Replays preserve identity.
- Eligible types: `transaction.captured`, `transaction.voided`,
  `refund.succeeded`, `settlement.paid`, `payment.failed`, `payment_link.expired`.
  Authorize/capture definitive declines publish atomically with their completed
  idempotency claim; ambiguous errors publish no failure event.
- `paymentLinks/expire.ts` scans active expired links under an advisory scanner
  lock and link row locks, atomically recording one expiry event. Reserved links
  are excluded; derived link state is unchanged. No expiry backfill to endpoints
  registered after the expiry instant.
- Native HTTP(S) transport pins checked DNS, rejects private targets outside test,
  follows no redirects, and bounds DNS/request/body time and response memory.
- Incoming `/v1/acquirer/callbacks` validates field types, UUID and timestamp,
  authenticates raw bytes with a 300-second freshness window, and only appends
  a deduplicated fraud-review note. See `docs/WEBHOOKS.md` for contracts/limits.

---

## 8. Existing Tests

- Route integration tests: `apps/api/src/routes/*.test.ts` (requires `DATABASE_URL` and migrated PostgreSQL).
- Unit tests: `apps/api/src/admin/creditApproval.test.ts`, `apps/api/src/reporting/scope.new.test.ts`.
- Payment-link policy units: `paymentLinks/expiration.test.ts` (fixed clock, exact bounds/types/precision/offsets/latency), `paymentLinks/create.test.ts` (invalid requests never insert). Route tests additionally exercise direct API bounds and persisted timestamps, malformed bodies, historical short/long links and expired bound-attempt recovery in an isolated migrated test database. `lib/random.new.test.ts` uses a valid 900-second duration for its unchanged cryptographic-token assertions.
- Command to run: `npm.cmd run test -w @filspay/api`. Release preflight now
  requires an explicit isolated loopback `filspay_test[_suffix]` DATABASE_URL
  before importing any suite. Root `npm test` excludes these DB-writing tests;
  all existing assertions remain available through explicit integration checks.

---

## 9. Known Limitations & Risks

1. **Row Lock Across Acquirer (BUG-061):** Current capture commits preparation before external I/O and takes locks again during apply. The historical serving image retained the lock; current-build capacity and runtime lock sampling remain pending. See `Evidence/agent-1-capacity-optimization.md`.
2. **CSV Import Precision (BUG-009):** Admin balance adjustment CSV parser assumes 2 decimals.
3. **Webhook Replay Identity (BUG-068):** Already fixed: replay retains the original delivery identity.
4. **Acquirer Callback Signature (BUG-047):** Acquirer callbacks accepted unsigned by default in dev.

## PMA-01 notification adapter (2026-10-30)

`auth/otpDelivery.ts` is shared by merchant/admin notifier wrappers. Merchant login/resend and admin login await one Resend HTTPS submission after committing challenge/session writes. Provider errors/timeouts return 503 otp_delivery_unavailable, without session promotion; provider details never enter responses/logs. Production delivery settings are validated by config.ts before boot. Development/test transport is a no-send metadata-only implementation. No new dependency, schema, outbox consumer or partner contract is introduced. See ops/README.md for configuration and Evidence/PMA-01_OTP_DELIVERY_FIX.md for mock-vs-real verification limits.

## TOTP integration (2026-10-30)

New auth/totpCrypto.ts uses otplib 13.5 and qrcode; auth/totp.ts locks and updates plane-specific factor state. routes/authenticator.ts registers under each auth plane, requiring full session + password and old-factor proof for replacement; admin audit actions authenticator_enrollment_started/authenticator_activated are typed and stored atomically. Login retains pending OTP-challenge rows for expiry/attempt/session lifecycle but verifies TOTP/recovery against encrypted authenticator state once enrolled. Provider delivery is skipped for enrolled users. FEATURE_TOTP defaults off, dedicated key validation is fail-closed, and explicit disabled email transport supports existing enrolled production accounts without a mail provider. Apply approved migration 0085 before enabling. No partner API or financial code changed.
