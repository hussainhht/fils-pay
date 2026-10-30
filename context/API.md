# HTTP API Reference — FilsPay Gateway & Internal RPC

> **Scope:** REST API endpoints, partner interfaces, public checkout routes, admin operations, internal settlement RPC, headers, and error handling.

---

## 1. API Architecture & Standards

- **Server Framework:** Fastify (running on Node.js 22 ESM).
- **Default Port:** 3000 (`PORT` environment variable).
- **Content Type:** `application/json; charset=utf-8`.
- **Monetary Quantities:** Always integer fils (`_fils`, `BIGINT`). Never floating-point BHD.
- **Strict Partner Contract Rule:** `apps/api/src/v1/` represents the frozen external partner interface. **Do not modify its contract, route signatures, or response shapes.**

---

## 2. Authentication & Session Headers

| Header / Cookie | Scope | Description |
|---|---|---|
| `Cookie: fp_sid=<token>` | Merchant Plane | Session bearer token for authenticated merchant users. |
| `Cookie: fp_admin_sid=<token>` | Admin Plane | Session bearer token for operations console administrators. |
| `Cookie: fp_impersonation=<token>` | Admin Impersonation | Temporary grant token allowing view-only access to a merchant. |
| `Authorization: Bearer <key>` | Partner / Merchant API | API key authentication for e-commerce backend integrations. |
| `Idempotency-Key: <key>` | Financial Endpoints | Required UUID/string preventing duplicate execution of captures, refunds, or credits. |
| `X-Acquirer-Signature: <hmac>` | Acquirer Callback | HMAC-SHA256 signature calculated over raw callback body. |
| `Authorization: Bearer <token>` | Settlement Internal | Bearer token (`SETTLEMENT_INTERNAL_TOKEN`) for API $\rightarrow$ Settlement RPC. |

---

## 3. Platform Health & Readiness
- `GET /healthz`: Process liveness check. Never touches the database; returns `{ status: "ok", uptimeSeconds }` with 200.
- `GET /readyz`: Readiness check. Verifies boot-time DB reachability; returns 200 `{ status: "ready" }` or 503 `{ status: "not_ready" }`.

---

## 4. Merchant API Routes (`/v1/*`)

### 1. Authentication (`/v1/auth`)
- `POST /v1/auth/login`: Accepts `{ email, password }`. Generates pending session and sends OTP. Sets `fp_sid`.
- `POST /v1/auth/otp/verify`: Accepts `{ code }`. Validates 6-digit OTP, marks session active, rotates session token.
- `POST /v1/auth/otp/resend`: Resends OTP challenge (subject to rate limiting).
- `GET /v1/auth/me`: Returns current user, merchant metadata, and permissions.
- `POST /v1/auth/logout`: Revokes active session in database and clears `fp_sid`.

### 2. Onboarding & Business Profile (`/v1/merchants`)
- `POST /v1/merchants`: Public merchant signup. Accepts `{ businessProfile, owner }`. Creates tenant and owner user, sets status `'pending'`.
- `GET /v1/merchants/:merchantId/business-profile`: Retrieves merchant business registration details.
- `PATCH /v1/merchants/:merchantId/business-profile`: Updates merchant profile (restricted to `owner`, `finance`).

### 3. KYC Document Management (`/v1/merchants/:merchantId/kyc`)
- `POST /v1/merchants/:merchantId/kyc/documents`: Uploads KYC verification document (multipart/form-data: `documentType`, `file`). Types: `commercial_registration` (PDF only), `owner_id`, `proof_of_address`, `bank_letter`.
- `GET /v1/merchants/:merchantId/kyc/documents`: Lists uploaded KYC documents and verification status.
- `GET /v1/merchants/:merchantId/kyc/documents/:documentId/file`: Streams full document buffer inline.
- `GET /v1/merchants/:merchantId/kyc/documents/:documentId/thumbnail`: Streams document preview thumbnail image.

### 4. API Key Management (`/v1/merchants/:merchantId/api-keys`)
- `POST /v1/merchants/:merchantId/api-keys`: Issues fresh API key (`owner` role only). Returns plaintext `rawKey` once.
- `GET /v1/merchants/:merchantId/api-keys`: Lists active and revoked key metadata (prefix, creation timestamp, revoked status).
- `DELETE /v1/merchants/:merchantId/api-keys/:id`: Revokes an API key.

### 5. Transactions (`/v1/transactions`)
- `POST /v1/transactions/authorize`: Initiates card authorization.
  - Body: `{ amountFils, currency: "BHD", paymentMethod }`.
  - Effect: Creates `transactions` (status `authorized`), inserts `holds` (status `active`), enqueues `transaction.authorized`.
- `POST /v1/transactions/:id/capture`: Captures an authorized hold.
  - Headers: `Idempotency-Key: <uuid>`.
  - Body: `{ amountFils? }` (omitted captures full authorized amount).
  - Effect: Calls acquirer, marks `captured`, releases hold, posts double-entry ledger legs, enqueues `transaction.captured`.
- `POST /v1/transactions/:id/void`: Voids an authorization hold.
  - Effect: Releases hold, marks `voided`, enqueues `transaction.voided`.
- `GET /v1/transactions`: Search and list transactions.
  - Query params: `status`, `from`, `to`, `limit`, `offset`.
- `GET /v1/transactions/export`: Streams CSV export of transactions for date range.

### 6. Refunds (`/v1/refunds` & `/v1/merchants/:merchantId/refunds`)
- `POST /v1/refunds` (or `POST /v1/merchants/:merchantId/refunds`):
  - Gated by: `FEATURE_REFUNDS=true` (returns `501 Not Implemented` if disabled).
  - Pre-handlers: `requireMerchantAuth`, `rejectImpersonation`, `requireMerchantRole('owner', 'finance')`.
  - Headers: `Idempotency-Key: <uuid>`.
  - Body: `{ transactionId, amountFils?, reason? }`.
  - Effect: Verifies available captured headroom, calls acquirer simulator, inserts `refunds`, writes balanced ledger legs, reverses prorated fees.

### 7. Payment Links (`/v1/payment-links` & `/v1/merchants/:merchantId/payment-links`)
- `POST /v1/merchants/:merchantId/payment-links`:
  - Body: `{ amountFils, reference?, description?, expiresInSeconds }` OR `{ amountFils, reference?, description?, expiresAt }`; exactly one expiration field is required. `expiresInHours` is not supported.
  - Creation policy: positive safe-integer fils; duration is an integer from **900 to 10368000 seconds inclusive** (15 minutes to 120 elapsed 24-hour days). The service uses one server-time reference to validate/resolve expiration. The dashboard sends seconds so form age/network delay cannot shorten the lifetime.
  - Existing `expiresAt` requests remain supported, deliberately tightened to an absolute ISO timestamp with timezone and at most millisecond precision, in the same inclusive server-relative window. Missing, conflicting, malformed, past or out-of-range input returns `400 invalid_expiry`; malformed body/metadata returns `400 invalid_request`, invalid amount returns `400 invalid_amount`. No clamping or client-time allowance.
  - `201` response fields and persisted `expires_at` are unchanged: returned `expiresAt` is authoritative. Bounds apply only to creation; historical reads and payment admission/recovery keep their existing deadline/status rules. Owner/finance, tenant and impersonation checks remain server-side. The frozen partner tree is unchanged.
  - Response: merchant DTO `{ id, token, url: "http://.../pay/:token", amountFils, currency, reference, description, status, expiresAt, transactionId, createdAt, paidAt, canceledAt }`.
- `GET /v1/merchants/:merchantId/payment-links`: List active and historical payment links.
- `DELETE /v1/merchants/:merchantId/payment-links/:id`: Marks a cancelable link `canceled`; `204` success, `404` unknown/other merchant, `409` non-cancelable.
- **Public Checkout Routes:**
  - `GET /v1/payment-links/:token`: Public endpoint fetching link status and amount for customer display.
  - `POST /v1/payment-links/:token/pay`: Submits card payment for checkout. Enforces single-use reservation lock.

### 8. Webhooks (`/v1/merchants/:merchantId/webhook-endpoints`)
- `POST /v1/merchants/:merchantId/webhook-endpoints`: Register endpoint URL and subscribed events. Generates encrypted secret.
- `GET /v1/merchants/:merchantId/webhook-endpoints`: List merchant endpoints.
- `DELETE /v1/merchants/:merchantId/webhook-endpoints/:id`: Soft-deletes or deactivates endpoint.
- `GET /v1/merchants/:merchantId/webhook-endpoints/:id/deliveries`: Lists delivery attempts and HTTP status codes.
- `POST /v1/merchants/:merchantId/webhook-endpoints/:id/test`: Fires a mock `ping` webhook.

### 9. Analytics & Reporting (`/v1/analytics` & `/v1/reporting`)
- `GET /v1/analytics/overview`: High-level gross volume, successful count, and balance summary.
- `GET /v1/reporting/volume-daily`: Daily volume aggregations from `merchant_daily_volume`.
- `GET /v1/reporting/payout-trends`: Payout trends from `merchant_payout_trends`.
- `POST /v1/reporting/saved-filters`: Creates saved filter view for reporting dashboard.

---

## 5. Acquirer Callback API (`/v1/acquirer`)

- `POST /v1/acquirer/callback`:
  - Public endpoint receiving asynchronous payment authorization and settlement events from acquirers.
  - Authentication: Evaluates `X-Acquirer-Signature` header against `ACQUIRER_CALLBACK_SIGNING_SECRET` using constant-time HMAC-SHA256 comparison.
  - Gated by: `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` configuration.

---

## 6. Operations Console API (`/v1/admin/*`)

### 1. Admin Authentication (`/v1/admin/auth`)
- `POST /v1/admin/auth/login`: Admin credentials login. Sets `fp_admin_sid` cookie.
- `POST /v1/admin/auth/otp/verify`: Admin 2FA verification.
- `GET /v1/admin/auth/me`: Current admin user profile and role (`support`, `finance`, `super_admin`).
- `POST /v1/admin/auth/logout`: Revokes admin session.

### 2. Merchant Management & KYC
- `GET /v1/admin/merchants`: Paginated merchant directory with status filtering (`limit`, `cursor`, `q`, `onboardingStatus`).
- `GET /v1/admin/merchants/:id`: Detailed merchant view including business profile and KYC documents.
- `POST /v1/admin/merchants/:id/kyc-reviews`: Submit review outcome (`approved` or `rejected`).
- `POST /v1/admin/merchants/bulk-approve`: Approves up to 200 merchants in `under_review` state (`finance`, `super_admin`).
- `POST /v1/admin/merchants/:id/api-keys/:keyId/rotate`: Rotates active API key and revokes predecessor key (`finance`, `super_admin`).
- `POST /v1/admin/merchants/:id/impersonate`: Generates `fp_impersonation` token (15-min TTL) for view-only inspection.
- `POST /v1/admin/impersonation/:grantId/end`: Explicitly terminates an active impersonation grant.
- `POST /v1/admin/merchants/:id/transactions/recompute-statuses`: Recomputes transaction statuses and reconciles merchant test mode flags (`finance`, `super_admin`).

### 3. Financial Controls & Credits
- `GET /v1/admin/credits`: Paginated list of credit adjustment requests (`status`, `merchantId`, `limit`, `cursor`).
- `POST /v1/admin/merchants/:id/credits`: Request financial credit adjustment for a merchant.
  - If `amountFils <= 50,000` (50 BD): Posts immediately.
  - If `amountFils > 50,000`: Queued into `credit_requests` with status `'pending'`.
- `POST /v1/admin/credits/:creditRequestId/approve`: Second approver sign-off (enforces distinct admin ID `created_by !== approved_by`).
- `POST /v1/admin/credits/:creditRequestId/reject`: Rejects credit request with reason.
- `POST /v1/admin/merchants/:id/balance-adjustments`: Direct display balance correction for merchant (`deltaFils`, `reason`).
- `POST /v1/admin/adjustment-imports`: Upload and synchronously apply CSV of balance adjustments (`finance`, `super_admin`).
- `GET /v1/admin/adjustment-imports`: List history of past CSV adjustment imports.
- `GET /v1/admin/adjustment-imports/:id/rows`: Detail rows for a specific adjustment import.

### 4. Settlement Operations
- `POST /v1/admin/settlement/run-batch`: Triggers settlement run for a specified business date (`date`, `merchantId?`). Proxies to Go settlement service.
- `POST /v1/admin/balances/rebuild`: Triggers platform-wide balance cache rebuild from source of truth.
- `POST /v1/admin/reporting/rebuild`: Triggers replay and rebuild of reporting aggregates.
- `POST /v1/admin/merchants/:id/mdr-recalculation`: Re-derives historical batch fees at current contracted rates (`from`, `to`).

### 5. Webhook Replay & Archives
- `POST /v1/admin/merchants/:id/webhook-endpoints/:endpointId/replay-batch`: Replays webhook deliveries for date/status range.
- `POST /v1/admin/merchants/:id/webhook-endpoints/:endpointId/archive`: Snapshots endpoint delivery history over date range.
- `POST /v1/admin/merchants/:id/webhook-endpoints/:endpointId/archive/:archiveId/replay`: Restores/replays archived deliveries.

---

## 7. Settlement Internal RPC API (Port 8091)

Hosted by `apps/settlement` (`internal/internalapi/server.go`) inside the internal Docker network. Protected by `Authorization: Bearer <SETTLEMENT_INTERNAL_TOKEN>`.

- `POST /batch/run`: Accepts `{ date: "YYYY-MM-DD", merchantId?: "<uuid>" }`. Executes `CloseBatch` and `PayoutBatch`.
- `POST /balances/rebuild`: Accepts `{ merchantId?: "<uuid>" }`. Executes full double-entry ledger recompute for `merchant_balances`.
- `POST /mdr/recalculate`: Recalculates historical fee schedules and posts adjustments.

---

## 7. Error Handling & Standard Envelopes

API errors return standard JSON envelopes with descriptive machine-readable error codes:

```json
{
  "error": "idempotency_conflict",
  "message": "Idempotency key was previously used with different request parameters"
}
```

### Standard HTTP Status Codes
- `200 OK`: Request succeeded.
- `201 Created`: Resource successfully created.
- `400 Bad Request`: Validation failure, missing required fields, or unparseable input.
- `401 Unauthorized`: Missing or invalid session token / API key.
- `403 Forbidden`: Insufficient role, tenant mismatch, or prohibited impersonation mutation.
- `404 Not Found`: Entity not found.
- `409 Conflict`: Business state conflict (e.g., hold expired, payment link already paid).
- `422 Unprocessable Entity`: Semantic constraint failure (e.g., refund exceeds captured headroom).
- `501 Not Implemented`: Disabled feature flag (e.g., refunds when `FEATURE_REFUNDS=false`).
- `500 Internal Server Error`: Unhandled server exception.
