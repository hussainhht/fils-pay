# PMA-01 production OTP delivery implementation

Date: 2026-10-30, Asia/Bahrain. Baseline: `c3eb21830dd133a47e86bf5f9150a3ba8f9caffd`.

## Root cause and status

Confirmed against source: merchant/admin notifiers only logged metadata in production; neither delivered the generated code. Existing flows already persisted salted code hashes, pending sessions, expiry and attempt budgets, then called notification outside the transaction.

**IMPLEMENTED / UNIT_VERIFIED.** Both notifier wrappers now await shared `auth/otpDelivery.ts` using a real Resend HTTPS adapter. **DB_INTEGRATION_VERIFIED** and **EXTERNAL_DELIVERY_VERIFIED** have not been achieved; they are **BLOCKED** by missing isolated migrated DB and authorized provider/test destinations. PMA-01 is not declared fully resolved for email authentication until both planes deliver and complete login using production-equivalent settings.

The user subsequently requested Microsoft Authenticator support. That continuation uses this email implementation for optional bootstrap; enrolled TOTP users do not call it. Explicit `OTP_DELIVERY_TRANSPORT=disabled` is permitted in TOTP-enabled production and fails email sends securely. It is not a successful email-delivery mode. See `MICROSOFT_AUTHENTICATOR_INTEGRATION.md` for the combined authentication change.

## Mechanism and safety

No SMTP/email/SMS provider integration existed in the inspected auth dependencies or ops configuration. Selected Resend's fixed HTTPS `/emails` endpoint using Node's native fetch: no email dependency, queue, schema or plaintext-code persistence was necessary. Sender credentials stay in environment/secret management. The destination remains the stored password-verified user's email, not a client-provided alternative.

Merchant login, merchant resend and admin login await one submission after DB commit/client release. A bounded timeout aborts it; redirects are rejected and no automatic retry occurs. The idempotency key is scoped to plane/challenge. Successful responses require a provider message ID; provider acceptance is not inbox delivery. Errors/timeouts become sanitized 503 `otp_delivery_unavailable` without upstream bodies/errors in logs/responses. Login does not issue a pending cookie on failed delivery and never authenticates on send success alone.

Unsuccessful sends retain only the existing hashed challenge/pending session until expiry and still count against issuance quotas. Merchant resend retains cooldown and inherited attempt count even after delivery failure. Admin had no resend endpoint, and none was added. Unknown delivery outcomes may still produce an email; there is no uncontrolled retry loop. Retrying login remains subject to existing quotas.

No raw OTP value is logged in any environment. Development/test transport sends no messages and logs metadata only. Existing nonproduction `devOtpCode` response behavior remains for local tests; production exposure is rejected in startup config and independently guarded in response construction. Existing OTP expiry, consumption, wrong-attempt handling, active-account checks, session rotation and plane separation remain intact.

## Configuration

| Setting | Requirement |
|---|---|
| `OTP_DELIVERY_TRANSPORT` | `resend` in normal production; development/test defaults `development` (no send) |
| `OTP_EMAIL_FROM` | Single bare sender email on a verified Resend domain |
| `OTP_RESEND_API_KEY` | Authorized sending key from secret management |
| `OTP_DELIVERY_TIMEOUT_MS` | Integer 100-30000, default 5000 |
| `OTP_DEV_EXPOSE` | Unset/false in production; true/1 prevents boot |

Missing/invalid production email settings fail at startup before DB access. TOTP-only `disabled` mode is an explicit later exception that requires FEATURE_TOTP and still rejects email delivery. The checked-in env template contains names and no credentials. No local env file was generated or production settings changed.

## Verification

- Baseline function probes loaded the original notifier code from Git in memory. For both planes, the assertion requiring a provider submission failed as expected: zero provider calls. No source checkout/history change was used.
- Initial focused email/config/auth run: **40 passed**, including 19 real-handler/mocked-DB HTTP cases and the original OTP/config/limits checks. Type annotation errors in the test fixture were corrected; whole-repository typecheck then passed.
- With the TOTP continuation, delivery/config file now has **10 passing distinct cases**, and the combined HTTP fixture has **27 passing cases**. Combined final focused totals and exact commands are in the authenticator report: **57 distinct passed, 2 DB scenarios skipped, no unresolved failures**.
- Unit/mocked HTTP checks cover merchant/admin recipient selection, correct-password prerequisite, successful response behavior, failure/no-cookie behavior, no production exposure, sanitized provider failures, request/body timeout, stable idempotency, no-code logs, expired/consumed/incorrect/exhausted OTP rejection, rate limits, resend restrictions and cookie separation.
- Final `npm.cmd run typecheck`: PASS. Frontend builds: PASS. No actual mail was sent by automated tests or manual work.
- Full database-backed auth workspace tests and a real API boot against a migrated DB were NOT RUN: DATABASE_URL absent, Docker/native PostgreSQL tools unavailable, no isolated database identified. Mock `/healthz` checks passed; this is not a deployed-API claim.

## Changed files and remaining work

Changed both notifier wrappers, added `auth/otpDelivery.ts`, awaited it in merchant login/resend and admin login, added config validation and regression tests, updated two existing production config fixtures without weakening their assertions, and documented environment/failure semantics in ops and affected context. No protected money package, partner contract or financial logic changed. The subsequent TOTP task adds its own approved migration and dependencies; those are not requirements of the email adapter itself.

Required external verification: configure a verified sender and authorized test inboxes through the secret manager, submit exactly one controlled login for each plane, verify arrival/expiry/consumption and complete both logins, inspect provider bounce/delivery state, and ensure proxy/APM logs do not capture auth bodies. Credentials/inboxes were not supplied, so this remains BLOCKED. Do not substitute real customer messages or enable development exposure.

Provider contract was checked against the official [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email) and [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys). Provider idempotency retention is limited; the implementation does not claim permanent exactly-once delivery.
