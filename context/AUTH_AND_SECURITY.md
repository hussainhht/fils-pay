# Authentication & Security Architecture — FilsPay

> **Scope:** Merchant and administrative authentication lifecycles, session tokens, OTP verification, RBAC, tenant isolation, impersonation constraints, and cryptographic operations.

---

## 1. Dual-Plane Identity Model

FilsPay operates two strictly decoupled security planes with separate credential stores, session tables, and cookie boundaries:

```text
+-----------------------------------------------------------------------------+
|                                MERCHANT PLANE                               |
|  Identity Table: merchant_users (email, argon2id password_hash, role)       |
|  Challenge Table: otp_challenges (code_hash, attempts, verified)           |
|  Session Table: sessions (token_hash, merchant_id, pending_otp)             |
|  Cookie: fp_sid                                                             |
|  Context Hook: requireMerchantAuth                                          |
|  Roles: support < finance < owner                                           |
+-----------------------------------------------------------------------------+

+-----------------------------------------------------------------------------+
|                                 ADMIN PLANE                                 |
|  Identity Table: admin_users (email, argon2id password_hash, role)          |
|  Challenge Table: admin_otp_challenges                                      |
|  Session Table: admin_sessions (token_hash, admin_id, pending_otp)          |
|  Cookie: fp_admin_sid                                                       |
|  Context Hook: requireAdminSession                                          |
|  Roles: support < finance < super_admin                                     |
+-----------------------------------------------------------------------------+
```

An admin session cannot resolve merchant authority directly, and a merchant session cannot access `/v1/admin/*` endpoints under any circumstance.

---

## 2. Authentication Lifecycle & Session Rotation

### Phase 1: Password Verification
1. User submits `{ email, password }`.
2. Password is verified against `password_hash` using **Argon2id** (configured with 19,456 KiB memory, 2 time cost, 1 thread).
3. The server generates a random 32-byte bearer token (`crypto.randomBytes(32)`).
4. A session is inserted into `sessions` with `pending_otp = true` and stored under its SHA-256 hash.
5. The unhashed token is set in the HTTP-only cookie (`fp_sid`).

### Phase 2: OTP Two-Factor Challenge
1. A cryptographically secure 6-digit code is generated via `crypto.randomInt(100000, 1000000)` (never `Math.random()`, resolving `BUG-029`).
2. The code hash is stored in `otp_challenges` with a 5-minute TTL.
3. The user submits `{ code }`.
4. **Attempt Rate Limiting:** Verification increments `attempts` atomically; max 5 attempts before invalidation (`BUG-015`).
5. **Token Rotation on Promotion:** Upon successful OTP verification, the server **rotates the session token** to a fresh cryptographically random value to prevent session fixation attacks (`BUG-016`).
6. `pending_otp` is flipped to `false`.

---

## 3. Role-Based Access Control (RBAC)

### Merchant Roles (`requireMerchantRole`)
- **`owner`:** Complete authority. Can onboard users, rotate API keys, issue refunds, configure webhooks, and read settlements.
- **`finance`:** Can view analytics, download transaction exports, and issue refunds. Cannot manage team users or delete endpoints.
- **`support`:** Read-only access to transactions, payment links, and settlements. **Cannot issue refunds or initiate money movements.**

### Admin Roles (`requireAdminRole`)
- **`super_admin`:** Highest authority. Can perform bulk KYC approvals, rotate merchant API keys, approve credits, and execute settlement tasks.
- **`finance`:** Can trigger settlement batch runs, execute balance rebuilds, issue credits, and import balance adjustments.
- **`support`:** Can search merchants, view transaction history, replay webhooks, view-only impersonate, and request small credits under 50 BD.

### Dual-Control for Administrative Credits
- Credit adjustments $\le$ 50.000 BD (50,000 fils) can be approved and posted directly by a finance admin.
- Credit adjustments > 50.000 BD are queued in `credit_requests` and **require a distinct second administrator** to approve (`BUG-040`). The approval checks `created_by !== approved_by` using UUID comparisons.

---

## 4. Multi-Tenant Isolation & Impersonation

### Strict Tenant Derivation
- All merchant-scoped routes (`/v1/merchants/:merchantId/*`, `/v1/transactions/*`, `/v1/refunds/*`) enforce tenant isolation.
- **Ground Rule:** Tenant context is extracted exclusively from `request.merchantAuth.merchantId` injected by the Fastify preHandler.
- Any client-supplied `:merchantId` in the URL path is validated against the authenticated context (`assertRefundRequestScope`); mismatches return `403 Forbidden`.
- **Split Merchant Parent-Child IDOR Prevention (`BUG-019`):** When querying split-child analytics, `apps/api/src/reporting/scope.ts` checks that the child merchant is explicitly registered in `merchant_split_children` for that parent merchant.

### Admin Impersonation ("View as Merchant")
When support or admin operators need to troubleshoot a merchant's dashboard:
1. Operator requests impersonation from the admin console (`POST /v1/admin/merchants/:id/impersonate`).
2. Server validates admin permissions and mints an impersonation grant token into `admin_impersonation_grants` (15-minute TTL).
3. The token is stored in a distinct cookie: `fp_impersonation`.
4. `requireMerchantAuth` detects the impersonation cookie and sets `request.merchantAuth.actorType = 'admin_impersonation'`.
5. **Universal Write-Lock Invariant (`rejectImpersonation`):**
   - Impersonation grants are **strictly view-only**.
   - All state-changing routes (refunds, API keys, webhook endpoints, payment links) include `rejectImpersonation` preHandlers.
   - Any attempt to modify data returns `403 Forbidden` (`impersonation_read_only`).

---

## 5. Cryptographic Security Standards

### 1. Webhook Secret Storage (AES-256-GCM)
- Webhook signing secrets are never stored in cleartext.
- `apps/api/src/webhooks/secretCrypto.ts` encrypts secrets using **AES-256-GCM** with the platform key `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 raw bytes).
- The IV, ciphertext, and GCM auth tag are stored in `webhook_endpoints.secret_ciphertext`.

### 2. Outbound Webhook Signing (HMAC-SHA256)
- Outbound deliveries include the header `X-FilsPay-Signature: t=<timestamp>,v1=<hmac>`.
- The signature is calculated as:
  $$\text{HMAC-SHA256}(\text{signing\_secret}, t + "." + \text{raw\_body})$$
- The signature must be computed over the **exact raw wire bytes**, not a re-serialized JSON string (`BUG-045`).

### 3. Inbound Acquirer Callbacks
- Inbound callbacks to `/v1/acquirer/callback` provide `X-Acquirer-Signature`.
- The signature is computed over the raw request payload using `ACQUIRER_CALLBACK_SIGNING_SECRET`.
- Verified using `crypto.timingSafeEqual` to prevent timing attacks (`BUG-046`).

### 4. API Key Mechanics
- API keys format: `fp_live_<random_bytes>` or `fp_test_<random_bytes>`.
- Only the SHA-256 hash (`key_hash`) and a 4-character prefix (`key_prefix`) are persisted in `api_keys`.
- The cleartext key is revealed to the merchant exactly once at generation time.
- Key rotation assigns a successor key and revokes the predecessor key (`BUG-039`).
