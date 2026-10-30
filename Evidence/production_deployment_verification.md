# Production deployment verification

Date: 2026-10-31 (Asia/Bahrain). Baseline HEAD: f4b5a1af6eb8eeac3844b4dbdf6de7b7501ecf12. Host: Ubuntu, nginx, Docker Compose, PostgreSQL 16, 1 CPU / approximately 2 GiB RAM. Local workstation: Node 22.19.0, npm 10.9.3, Go 1.24.2; Docker unavailable locally.

## Outcome and URLs

- Merchant: https://68-183-82-221.sslip.io/dashboard/login — HTML and referenced JS returned 200.
- Admin: https://68-183-82-221.sslip.io/login — HTML and referenced JS returned 200.
- Checkout: https://68-183-82-221.sslip.io/pay/test-token — SPA HTML returned 200; not a valid payment link and no checkout transaction was performed.
- API: https://68-183-82-221.sslip.io/v1/ — reverse-proxied to loopback API. /healthz and /readyz each returned 200 over HTTPS and direct loopback. HTTP redirects to HTTPS with 308.
- sslip.io DNS resolved the hostname to the server. Public certificate verification succeeded, with Let's Encrypt certificate expiry 2027-01-28. `/etc/systemd/system/filspay-cert-renew.timer` is active; its service ran successfully and `certbot renew --dry-run --no-random-sleep-on-renew` succeeded. Certificate is issued for the temporary hostname and relies on third-party DNS; monitor availability and renewal. The registration has no renewal-notification email.

## Root cause and changes

There was no API container. The deployment had been deliberately held inactive: its production API configuration selected Resend while the sender and API key were absent. Executing `loadConfig` in the committed image reproduced the missing-Resend-configuration error. The same check passed with `OTP_DELIVERY_TRANSPORT=disabled`. At f4b5a1a email OTP is no longer used for login, and disabled transport is a supported configuration; no OTP code was exposed and no authentication check was bypassed. Both existing enrollment-aware login handlers were inspected. Merchant and admin users without an enrolled authenticator receive password-only sessions under the existing commit; enrolled accounts require a factor and fail closed if TOTP is disabled.

Updated server-only API config to disabled email delivery and the HTTPS checkout origin, without changing existing encryption/signing/database secrets. Started the API with the committed production image and `--no-deps`; rebuilt static assets with the HTTPS merchant origin. Installed nginx HTTPS routing and HTTP redirect, a webroot ACME challenge route, a Certbot Docker image and a dedicated renewal service/timer. Preserved server config backups, prior release/image tags, database and KYC volumes. The current release is `/srv/filspay/releases/20261031-f4b5a1a-https`. No migrations or seed ran; no database was reset. No production account was created. User explicitly declined a separate test schema.

## Service and configuration evidence

- PostgreSQL: healthy container, no exposed DB port. `psql` query returned 1; migration 0085 was present. Count queries found zero merchant users, admin users, settlement batches, and outbox events at inspection.
- API: running, loopback-bound on host port 3000, image built from f4b5a1a; `loadConfig` passed and an actual query using API database credentials returned 1. Production mode, secure cookies, callback signing secret, webhook encryption key, settlement token and database URL are configured; secret values were never printed. Refunds flag is enabled.
- Reporting: restarted on an f4b5a1a Node image; running and its own DB credentials returned 1. No reporting events or report projection flow were tested.
- Settlement: original container remained running and was not restarted. Git diff between prior 1f88a47 and f4b5a1a showed no changes to apps/settlement, packages, DB, root lockfile or Go Dockerfile. Logs show scheduled checks processing zero merchants. This is not a verified settlement or payout journey.
- FEATURE_TOTP is unset (default false) and TOTP_SECRET_ENCRYPTION_KEY absent. Resend sender and key absent. Email delivery is disabled and unavailable; no provider delivery was tested. To enable authenticators, provision the dedicated key securely and configure the feature as documented; do not replace keys used by existing encrypted data.

## Endpoint and test results

HTTPS requests: anonymous `/v1/auth/me`, `/v1/admin/auth/me`, `/v1/transactions`, `/v1/reporting/transactions`, `/v1/settlement/batches`, POST `/v1/transactions/` and POST `/v1/refunds` returned 401; nonexistent payment link returned 404. Empty JSON sent to merchant and admin login returned 400. These check route reachability and selected guards only, not successful authentication, roles, tenancy, payments, refunds or settlement correctness. Local `npm.cmd run test -w @filspay/web` passed 67/67. The server's production Docker image build ran `npm run typecheck` and built both frontends successfully. Database-dependent API/reporting tests were not run.

## Remaining blockers and follow-up

1. No authorized merchant or admin accounts exist. Privileged production account creation requires explicit user approval and a supported secure provisioning procedure. User did not approve a test schema; do not run the destructive seed against production. Provide an approved isolated test environment and test identities to verify login, roles, tenant separation, and safe simulated payment, checkout, refund, reporting and settlement journeys.
2. TOTP is not enabled, so authenticator enrollment and verification cannot be tested. Supply a securely managed dedicated 32-byte base64 encryption key and authorize its use; configure the feature and validate with approved accounts. Do not send the key through chat.
3. `ops/PRODUCTION.md` describes an older Resend-based login policy; current f4b5a1a source and `ops/README.md` supersede it. A verified sender and key are required if the unused Resend transport is intentionally enabled, but cannot restore email login at this commit.
4. No real payment provider was exercised, and checkout origin creation, capture, refund, reporting projection, settlement and payout have not been verified. Existing ADRs 0003, 0004, 0006 and HANDOVER financial-policy conflicts remain human decisions.
5. Health readiness proves startup checks, not end-to-end functionality. IP-based DNS hostname is temporary; use an owned production hostname and monitored certificate renewal when available.

Files changed locally: this report, context/INFRASTRUCTURE.md and context/CHANGELOG.md. No application source or repository migration changed. Server changes are detailed above. No tracked bug was investigated or fixed.

## Production merchant login investigation (2026-10-31)

- Baseline HEAD f4b5a1af6eb8eeac3844b4dbdf6de7b7501ecf12; active release `/srv/filspay/releases/20261031-f4b5a1a-https`. Read-only production SQL counts: 0 merchants and 0 merchant users. The earlier reported absence remains current; no existing merchant can authenticate.
- Current login requires a merchant UUID, exact user email and password; it queries an active merchant and its matching merchant_user, verifies an Argon2id password hash, and requires a TOTP/recovery factor if enrolled. For an unenrolled account the current commit promotes a password-authenticated session; TOTP is not mandatory or enabled on this deployment. This describes existing behavior, not a change to authentication.
- The current merchant login UI has an all-zero UUID placeholder, with empty email and password fields, not a working sample account. Seed fixture accounts and their fixed development passwords are development data; there are no merchant users in production. Seed was not run.
- The public supported provisioning route `POST /v1/merchants/` invokes `createMerchantWithOwner`; its transaction creates an active merchant using the database default `test_mode=false`, an onboarding profile and owner. `onboarding_status=submitted` blocks authorization until approved, but does not exclude the merchant from settlement.
- Critical blocker: the active settlement daemon scans every active merchant with `test_mode=false`, and `CloseBatch` inserts a settlement batch even before checking events. The daemon logs show repeated checks. Provisioning via signup would therefore make this test merchant eligible for settlement and may create settlement records, against the user's explicit instructions. Repository inspection found no supported signup parameter or admin operation that atomically sets `test_mode=true`; the seed can populate that flag but is destructive and prohibited. No account was created and no database or service configuration was changed. No credentials were generated or exposed.
- Login and authenticated API success could not be verified without a safe account; no payment or refund tests were performed. A reviewed, tested provisioning mechanism that atomically creates a test-mode merchant and owner without exposing a live-mode row to settlement is needed, or a separately approved isolated environment. The user previously declined creating an isolated test schema. Avoid deploying an untested workaround or manually changing production financial records.

## Test merchant provisioning preparation (2026-10-31)

A local operator-only provisioning path has been implemented but not deployed. It inserts test_mode=true in the initial merchant insert in the same transaction as profile and owner; public signup retains live mode. Unit/mock checks passed, but the real PostgreSQL provisioning, authentication, rollback and settlement exclusion tests were not run because no approved isolated migrated test database is available. User declined creation of a test schema. The requested production deployment and test account are therefore blocked by the explicit requirement that those tests pass first. No production database, service, secrets or settlement records were changed during this work. Full details: Evidence/test_mode_merchant_provisioning.md.

## Isolated test attempt stopped on failures (2026-10-31)

User authorized a separate synthetic PostgreSQL environment; 79 migrations applied there. Targeted real DB provisioning/login and settlement exclusion checks passed, but the full API test run reported 20 failures among 147 subtests before it was stopped. Existing OTP-based tests conflict with the current password/authenticator login and disabled-email defaults; see Evidence/test_mode_merchant_provisioning.md for exact groups and limits. No commit, deployment or production test merchant was made. The temporary test environment was removed. Production settlement, reporting and API were unexpectedly recreated by an unidentified separate action during the test window; settlement is running again, but continuity cannot be claimed. Health and readiness returned 200 afterward. No payment/refund journey was started.
