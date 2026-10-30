# Microsoft Authenticator / RFC 6238 integration

Date: 2026-10-30, Asia/Bahrain. Baseline HEAD: `c3eb21830dd133a47e86bf5f9150a3ba8f9caffd`, branch `main`.

## Status

- **IMPLEMENTED:** Merchant/admin TOTP enrollment, confirmation, login, recovery, replacement, encrypted storage and UI.
- **UNIT_VERIFIED:** Focused crypto/configuration and real-handler HTTP tests with mocked SQL/provider.
- **DB_INTEGRATION_VERIFIED:** Not achieved. Two PostgreSQL integration scenarios are present but skipped without an isolated migrated test database.
- **Production/device verification:** BLOCKED pending migration, secret provisioning, trusted enrollment sessions and an actual Microsoft Authenticator scan/login for each plane.

This is implemented code, not a claim that the currently running services have been upgraded or that a phone has scanned the QR. No commit/push, existing migration edit, financial logic change, real message or payment was performed. User explicitly approved the new authentication migration before it was added. Migration 0085 was **not applied** here.

## Investigation and initial ownership proof

Read AGENTS.md, CLAUDE.md, the PMA-01 audit finding, relevant persistent context, and both password/OTP/session flows. Existing identity records use email, with separate merchant/admin user, challenge and session tables. Existing email OTPs were hashed in PostgreSQL but production notifiers only logged metadata. The preceding PMA-01 implementation now supports real Resend submissions, though authorized external delivery is still unverified.

**Password alone cannot enroll.** The management routes require the matching live, fully authenticated session, whose existing server predicate requires completed MFA. They reject pending/password-only cookies, API keys and impersonation. A fresh password check is required before returning any setup secret. Merchant identity comes from that session, never a merchant/user identifier supplied in the request.

For existing users, bootstrap is either:

1. Use a trusted existing session that already completed the existing MFA policy, then verify the password and confirm a new authenticator code; or
2. Restore authorized email OTP delivery, complete the normal password + email OTP login, then enroll.

When neither exists, enrollment remains blocked. No password-only fallback, administrator-created authenticated cookie, direct SQL activation, or automated identity-verification bypass is shipped. An operator-controlled proof-of-identity recovery process would require a separately approved policy and implementation. An email address in the database is not, by itself, accepted as proof of ownership.

## Implementation

`otplib` 13.5.0 supplies RFC 6238 TOTP. `qrcode` 1.5.4 renders PNG data URLs locally; `@types/qrcode` is development-only. The user explicitly requested a maintained TOTP library. No Microsoft SDK, Entra tenant or push service is introduced.

- Algorithm: SHA-1, six decimal digits, 30-second period; clock drift is explicitly capped to one past/future step.
- QR provisioning: standard `otpauth://totp` URI, explicit algorithm/digits/period, distinct `FilsPay merchant` / `FilsPay admin` issuer labels and user-specific labels.
- Secrets: AES-256-GCM, random 12-byte IV, authentication tag, versioned ciphertext, and identity-plane/user AAD. Encryption key is dedicated and supplied externally.
- Enrollment: encrypted pending secret, random enrollment ID, ten-minute expiry, same-session binding, five failed confirmation attempts. Active factor remains unchanged until a valid new-device code confirms.
- Replay: confirmation consumes its time step. Each accepted login atomically advances `last_used_step` under the factor row lock in the same transaction as challenge consumption/session promotion.
- Recovery: ten random 128-bit codes, returned once; identity/plane-scoped SHA-256 hashes only in PostgreSQL; row-locked one-use removal.
- Replacement: trusted session + current password + current authenticator/recovery proof, then new-device confirmation. Old factor remains active until confirmation; recovery hashes rotate and other sessions/pending logins are revoked on activation.
- Lock ordering: management acquires session locks before factor locks to align with login verification and avoid factor/revocation deadlocks. Initial enrollment also serializes on its identity row.
- Existing login challenge TTL, quotas, account checks, failure limits, resend restrictions and session-token rotation remain in use. Enrolled accounts do not receive or fall back to email OTP; merchant resend rejects TOTP accounts.
- Admin enrollment/activation audit rows share the transaction and contain only metadata, never secrets/codes. No authenticator secret/code is explicitly logged anywhere in the new code.
- Management responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; Origin is checked against Host when present. Setup material never goes into URLs, localStorage or an external QR service.

Separate `merchant_authenticators` and `admin_authenticators` tables contain encrypted active/pending material, activation timestamp, accepted time step, recovery hashes, pending session/ID/expiry and confirmation counter. Only new migration `0085_authenticators.sql` changes schema; no financial tables were changed.

## API and UI

The following are mounted under both `/v1/auth` and `/v1/admin/auth`:

| Endpoint | Behavior |
|---|---|
| `GET /totp` | Own enabled state and unused recovery count only |
| `POST /totp/enroll` | Fresh password; existing-factor proof if replacing; returns QR/manual key and pending enrollment |
| `POST /totp/confirm` | Valid new-device code activates; returns recovery codes once |

Existing login responses add `verificationMethod: email | totp`. Existing `/otp/verify` accepts the appropriate factor or unused recovery code; URL/cookie/role contracts otherwise remain intact.

Both shells link **Account security**: merchant `/dashboard/security`, admin `/security`. Shared `AuthenticatorSetup.tsx` uses existing design tokens, responsive cards, QR/manual-key instructions, confirmation and explicit acknowledgement of saved recovery codes. Login screens show authenticator/recovery instructions and hide email resend for TOTP. No actual phone scan or interactive visual review was performed.

## Deployment requirements

1. Review/apply approved migration 0085 through the normal migration runner against the intended deployment, with its usual backup/change process. No migration was run by this task.
2. Set `FEATURE_TOTP=true` and supply `TOTP_SECRET_ENCRYPTION_KEY` as base64 of 32 random bytes through secret management. Startup rejects a missing/malformed key. The default flag is false to preserve pre-migration behavior.
3. Keep this key separate from webhook keys. Back it up securely. Re-encrypt existing secrets under a reviewed rotation procedure before changing it; replacing the variable alone makes old ciphertext unreadable.
4. Retain valid Resend configuration for email bootstrap, or explicitly set `OTP_DELIVERY_TRANSPORT=disabled` for TOTP-only production. Disabled email always fails closed with 503 and does not permit unenrolled new logins. Production still forbids development transport/code exposure. Enrolled TOTP verification works without a mail provider in this explicit mode.
5. Use HTTPS, secure cookies, preserved original Host headers, NTP-synchronized API hosts, and no authentication request/response-body capture in proxy/APM logs.
6. Complete both real enrollment/login journeys, retain recovery codes, and run DB concurrency scenarios before declaring production verified. No actual customer messages should be used for that verification.

## Verification performed

Environment: Windows PowerShell; Node 22.19.0; npm 10.9.3. Docker/native PostgreSQL tools were unavailable, `DATABASE_URL` was absent, and no isolated migrated database was identified. Existing shared services were not restarted or repurposed.

Per the user's instruction **not to overtest**, verification remained focused. No broad full-suite, load test, financial regression sweep or repeated frontend build was run.

| Check | Actual outcome |
|---|---|
| `auth/totp.new.test.ts` | 8 passed: RFC vector, drift/expiry/replay, provisioning, encryption tamper/identity separation, recovery entropy/scoping, row-locking helper behavior, key validation |
| `auth/otpDelivery.new.test.ts` | 10 distinct tests passed across focused runs; includes timeout, safe errors/logs, missing production settings and explicit TOTP-only mode |
| `routes/otpDelivery.new.test.ts` | 27 passed after correcting the test audit-insert fixture; includes 8 new merchant/admin TOTP HTTP scenarios |
| Existing `config.new`, `config.acquirerSignature.new`, `auth/otp`, `auth/loginLimits.new` | 12 passed |
| `routes/totp.integration.test.ts` | 2 skipped; no `DATABASE_URL`; NOT DB integration verified |
| **Distinct focused test total** | **57 passed, zero unresolved failures, 2 DB scenarios skipped**. Reruns are excluded from the count. |
| `npm.cmd run typecheck` | PASS, exit 0, all workspaces plus db/scripts on final code |
| Web Vite production build, `build.write=false` | PASS, 79 modules; existing dynamic/static import warning only |
| Admin Vite production build, `build.write=false` | PASS, 66 modules |
| `git diff --check` excluding pre-existing runtime log | PASS; line-ending notices only |

Focused test command:

```powershell
node --import tsx --test --test-reporter=spec apps/api/src/auth/totp.new.test.ts apps/api/src/routes/otpDelivery.new.test.ts apps/api/src/routes/totp.integration.test.ts apps/api/src/auth/otpDelivery.new.test.ts apps/api/src/config.new.test.ts apps/api/src/config.acquirerSignature.new.test.ts apps/api/src/auth/otp.test.ts apps/api/src/auth/loginLimits.new.test.ts
```

The first combined run exposed an admin-audit mock that returned no inserted ID and missing audit action types. The fixture now satisfies the real insert contract and the action/target unions were extended; all 27 HTTP cases were rerun and passed. A provisioning assertion initially found library defaults omitted explicit URI parameters; the URI now supplies them and all eight crypto tests passed. Final configuration-only changes were checked with `--test-name-pattern='production|confirmation activates'` (6 passed), including both TOTP logins with email disabled. These intermediate failures are corrected, not skipped or weakened.

The two DB scenarios are prepared to exercise concurrent same-code verification, one-use recovery under concurrency, activation/replacement/session revocation, cross-plane cookies and same-email merchant tenant separation. They require an explicitly supplied local isolated `filspay_test`/`filspay_test_<suffix>` database migrated through 0085. Mock tests do **not** prove PostgreSQL concurrency or migration success.

## Files changed and preservation

- API: `src/auth/totpCrypto.ts`, `src/auth/totp.ts`, `src/routes/authenticator.ts`, both auth routes, config and admin audit types.
- Email/bootstrap continuation: both notifier wrappers, `auth/otpDelivery.ts`, production config fixtures and focused delivery tests.
- Tests: TOTP crypto/service tests, combined mocked HTTP tests and separate PostgreSQL integration tests.
- Schema/dependencies: new `db/migrations/0085_authenticators.sql`; API package manifest and root lockfile.
- UI: shared authenticator component/CSS; both security pages, login pages, routers, navigation and login DTOs.
- Documentation: ops README/value-free env template; affected auth/API/database/frontend/module/dependency/infrastructure/decision/test/known-issue context and changelog; this report and the PMA-01 delivery report.

Pre-existing `.api-run.log` changes and the earlier audit report were preserved. An unrelated `scripts/reconcile_march.retirement.test.ts` appeared during the work; it was not edited or investigated. No protected money code, partner contract, historical audit report, old migration, Git history, secret configuration or financial implementation was modified by this task.

## Remaining gates and source references

Migration execution, real database locking/isolation, actual Microsoft Authenticator scan/manual-entry compatibility, deployed HTTPS/proxy configuration, and authorized production email delivery remain unverified. This is ready for deployment verification, not a fully verified public authentication release. Lockout recovery without any remaining factor deliberately remains an operator policy gate.

Compatibility is based on standard provisioning and verified RFC behavior, consistent with [Microsoft's non-Microsoft account setup instructions](https://support.microsoft.com/en-gb/authenticator/how-to-add-your-accounts-to-microsoft-authenticator) and [otplib's replay/state guidance](https://otplib.yeojz.dev/guide/advanced-usage). QR generation follows the [qrcode library API](https://github.com/soldair/node-qrcode). These references do not substitute for an actual device test.
