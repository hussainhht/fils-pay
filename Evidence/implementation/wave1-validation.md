# Wave 1 implementation and validation

Date: 2026-10-30 (Asia/Riyadh).

The Phase 0 corrections and parallel ownership plan were committed and pushed first as `5089684`. This wave implements Phase 1 and the six Phase 2 auth findings. Phase 3 and refund activation are deferred.

Implementation commits: `9979bce` (fresh boot, configuration, and seed safety) and `3e3d360` (OTP/session/status/RNG fixes and regressions).

## Implemented scope

| Finding | Result |
|---|---|
| BUG-014 | Fresh/unapplied migrations 0054/0055/0072 corrected, including valid clearing-asset account kinds and refund transaction foreign key. Already-recorded objects need forward repair before existing-database rollout. |
| BUG-057 | Tracked secret file removed from the index; blank example and ignored, exclusively generated local configuration replace it. API fallback is exactly 32 bytes and production still requires an explicit key. Previously exposed external credentials still require owner/provider rotation; Git history was not rewritten. |
| BUG-058 | Node/Go images build; explicit shared token/key injection and migration-gated API/settlement/reporting startup work. Redundant Compose database override removed; intentional Go override support is unchanged. |
| BUG-054 | Generator refuses before connection/reset without explicit opt-in and an allowlisted development/test destination. Ordinary startup excludes seed. |
| BUG-001 / BUG-002 | Pending sessions do not authenticate; challenge/session/notification stay on the password-checked tenant. |
| BUG-015 | Merchant/admin OTP attempts serialize; failed guesses commit, resends inherit budget, and concurrent verify/resend cannot reset it. Expired codes remain resendable within valid pending TTL. |
| BUG-016 | Successful merchant/admin OTP rotates token hashes and resets full browser TTL. Old pending tokens are rejected. |
| BUG-017 | Session/API-key lookups enforce active merchant status; keys also enforce scheduled `revoke_after`. |
| BUG-029 | Shared OTP and payment-link token generation uses `crypto.randomInt`; actual payment-link creation works with `Math.random` disabled. |

## Passing checks

- Root `npm run typecheck`: all workspaces, database code, and operational scripts pass.
- Auth agent: 23 focused session/OTP/security/RNG checks and 81 existing app/admin route checks pass against a migrated disposable PostgreSQL database.
- `node --import tsx --test apps/api/src/config.new.test.ts db/seed/safety.new.test.ts`: 6/6 pass. Includes direct generator refusal before connection, remote/production rejection, destination-override rejection, valid local allowlist, and production key requirement.
- Fresh PostgreSQL 16 migration: all 66 available SQL files apply through 0072; second run applies zero and skips all 66. Numbering gaps are expected.
- [migrations-validation.sql](migrations-validation.sql): account kinds, batched versus unbatched captures, successful/failed refund selection, unequal refund/transaction UUIDs, and Bahrain date pass; fixtures and materialized refresh roll back.
- Docker Compose configuration validates; default service selection excludes seed. Node 22 and Go 1.23 multi-stage images build successfully.
- Disposable Compose startup reaches healthy Postgres, migration exit 0, and running API, reporting, and settlement processes. No seed is started during ordinary startup.
- Explicit one-off seed without opt-in exits 1 before destructive work. With explicit opt-in on the disposable database and apps stopped, seed generates 8 merchants and 2,105 transactions; all five real self-verification assertions, including deterministic regeneration, pass.
- [wave1-smoke.mjs](wave1-smoke.mjs) passes inside the final API image: health 200, synthetic signup, pending-cookie 401, OTP promotion, changed token/full cookie TTL, old-cookie 401, correct authenticated merchant, settlement missing/wrong-token 401 and valid-token GET 405, and 32-byte encryption key. GET performs no settlement operation.
- Reporting tests on their own newly migrated disposable database: 11/11 pass.
- `git diff --check` passes.

## Limits and remaining failures

The complete root `npm test` command is **not green**. It reports API 366/378, reporting 7/11, money 40/40, events 4/4, and web 8/8. The root script stops before the final operational-script test stage because workspace tests failed.

- Eleven API failures are in the existing refund processor/helper tests, including the NULL reason/check-constraint defect BUG-028. Refund code was not changed or activated in this wave.
- One API dispatcher backoff test requires exact elapsed-millisecond equality. It fails in the combined suite and on isolation (dispatcher 7/8); dispatcher implementation/test files are unchanged.
- Four reporting failures encounter malformed outbox fixtures left by the preceding API suite (`merchant_daily_volume.merchant_id` NOT NULL). Running reporting against its own empty migrated database passes all 11 checks. Shared-suite isolation is not repaired here.

Runtime validation used only newly created disposable PostgreSQL/Compose resources bound to random localhost ports. These containers and temporary database volumes were removed after validation. No existing user database, external payment service, merchant webhook destination, or hosted deployment was used. Secrets and raw generated credentials are excluded from this report and committed artifacts.

An attempted optional Compose seed dependency did not enforce failure gating: Compose warns and starts apps after a failed optional dependency. The final implementation removes that dependency. Use the documented stopped-app one-off seed workflow and start apps only after its success; `--profile seed up` is not a supported seed-gating workflow.

BUG-004 impersonation restrictions and durable capture/refund recovery remain later prerequisites. Local boot does not mean production hosting or refund launch is complete.

## Reproduction commands

Use an empty disposable development database for migration/regression checks. For Compose setup and explicit seed syntax in POSIX shells or PowerShell, follow [ops/README.md](../../ops/README.md).

```sh
npm ci --no-audit --no-fund
npm run migrate
npm run migrate
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f Evidence/implementation/migrations-validation.sql
npm run typecheck
node --import tsx --test apps/api/src/config.new.test.ts db/seed/safety.new.test.ts
node --import tsx --test --test-concurrency=1 apps/api/src/auth/sessions.test.ts apps/api/src/auth/otp.test.ts apps/api/src/lib/random.new.test.ts apps/api/src/routes/auth-security.new.test.ts
```

Run the smoke script through stdin inside the disposable API container so it receives that stack's internal configuration; it creates one synthetic merchant and prints only assertion results.
