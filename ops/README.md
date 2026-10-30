# Local development stack

For the IP preview/server deployment and remaining production activation steps,
see [PRODUCTION.md](PRODUCTION.md). The production Compose file is separate from
this development stack; do not deploy the development fixture credentials.

Postgres, API, settlement, and reporting run through Docker Compose. Web and
admin remain separate Vite development servers. This configuration uses a
shared development database role and public fixture credentials; provision
separate database roles and deployment secrets before hosting it.

## Safe submission checks

`npm test` (or `npm run test:unit`) runs the audited database-free examples and
regressions through `scripts/test-unit.mjs`. It removes inherited database URLs
from its child processes. Run `npm run typecheck` and the existing web/admin
build commands separately. These checks do not start infrastructure, migrate,
seed, or execute payments/settlement jobs.

Database-writing suites are quarantined from the default check, with their
assertions and fixtures retained. `npm run test:integration`, API/reporting
workspace `test`, and `npm run test:settlement` first run
`ops/test-database.mjs`. They refuse missing configuration, production mode,
non-local or non-`filspay_test[_suffix]` destinations, and connection overrides.
Use only a separately authorized disposable migrated test database; naming a
database does not prove it is disposable. Some tests reset platform counters
or truncate/rebuild reporting tables. No command provisions or resets a DB.
Direct `tsx --test`, live browser scripts and bare `go test` bypass this
preflight; do not point them at development, shared, staging or production data.

Docker build/startup does not invoke tests. Normal Compose startup still runs
the required migrations and leaves the opt-in seed job disabled. This remains
a local development stack, not a production deployment configuration. Final
submission evidence and unverified hosting/PDF requirements are recorded in
`Evidence/pre_submission_cleanup.md`.

## Start without resetting data

From the repository root, with Docker Compose v2:

```sh
node ops/setup-env.mjs
docker compose -f ops/docker-compose.yml up --build -d
```

The setup script creates an ignored `ops/.env.docker` with fresh local values
for the 32-byte webhook encryption key, callback signing secret, and settlement
token. Rerunning preserves the existing file and its keys. The tracked
`.env.docker.example` documents required names and contains no secret values.
Compose explicitly supplies this file to API, settlement, and the optional
seed job. API and settlement receive the same internal token.

Startup waits for healthy Postgres and successful migrations. It does **not**
seed or truncate existing data. The API listens on localhost:3000; Postgres
on localhost:5432. Override the host ports with `FILSPAY_API_PORT` and
`FILSPAY_POSTGRES_PORT` if they are already occupied. API health is `/healthz`.

```sh
docker compose -f ops/docker-compose.yml logs migrate api settlement reporting
docker compose -f ops/docker-compose.yml down
```

`down` preserves the database volume. Keep encryption keys with the data they
protect; replacing an existing key prevents decryption of stored webhook
secrets. No credentials are printed by the setup script. Any previously
exposed external credential must be rotated with its provider; generating
local values and removing tracked configuration do not perform that rotation.

## Open the merchant and admin screens

Once the backend is running on localhost:3000, run this from the repository root:

```sh
node ops/preview.mjs
```

Open the merchant screen at http://localhost:5173/dashboard/login or the admin
screen at http://localhost:5174/login. The preview launcher uses the existing
Vite configurations, proxies API requests locally, and sets the UI API base to
the same origin so session cookies work without cross-origin configuration.
Ctrl+C stops both UI servers; Docker services remain running.

The current seeded preview uses Compose project `filspay-preview`; use
`docker compose -p filspay-preview -f ops/docker-compose.yml ps` to inspect it.
Dev OTP codes appear on the login screen after the credentials step.

## Explicit destructive fixture reset

Only reset an isolated local database. Stop the app services, run the seed as
a one-off job with explicit opt-in, and restart apps only if that job succeeds:

```sh
docker compose -f ops/docker-compose.yml stop api settlement reporting &&
ALLOW_DESTRUCTIVE_SEED=1 docker compose -f ops/docker-compose.yml --profile seed run --build --rm seed && docker compose -f ops/docker-compose.yml up -d api settlement reporting
```

In PowerShell, use an explicit exit-code check:

```powershell
docker compose -f ops/docker-compose.yml stop api settlement reporting
if ($LASTEXITCODE -ne 0) { throw 'Could not stop app services' }
$env:ALLOW_DESTRUCTIVE_SEED = '1'
try {
    docker compose -f ops/docker-compose.yml --profile seed run --build --rm seed
    if ($LASTEXITCODE -ne 0) { throw 'Seed failed; app services remain stopped' }
    docker compose -f ops/docker-compose.yml up -d api settlement reporting
} finally {
    Remove-Item Env:ALLOW_DESTRUCTIVE_SEED
}
```

The seed job waits for successful migrations and refuses a reset without
opt-in. Apps depend only on migrations; Compose cannot enforce seed success
through an optional dependency. Use the one-off workflow above instead of
`--profile seed up`, which could start apps alongside a failed seed. Ordinary
startup omits the seed job entirely.

The generator guard runs before acquiring a database connection, including
for direct callers. It requires `ALLOW_DESTRUCTIVE_SEED=1`, a development/test
environment (or the development default), and an explicit PostgreSQL URL for
`localhost`, `127.0.0.1`, `::1`, or the Compose host `postgres`. Allowed database
names are `filspay`, `filspay_dev`, `filspay_test`, or `filspay_test_<suffix>`.
Destination-overriding URL parameters are rejected. The seed truncates business
tables and cascading dependents; fixture data is not safe for shared databases.

## Images and environment

### OTP email delivery (PMA-01)

Merchant/admin login emails use the stored user email after password verification.
There is no SMS/phone identity path. Both flows share a Resend HTTPS adapter,
using Node's built-in fetch with no new package or service. Merchant resend uses
the same adapter; admin has no resend endpoint in the existing API.

In production, supply these settings through your deployment secret configuration
(never commit a populated env file):

| Name | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `OTP_DELIVERY_TRANSPORT` | `resend` (production default); `disabled` is permitted only with FEATURE_TOTP in production, and rejects email delivery |
| `OTP_EMAIL_FROM` | Single bare sender email address on a verified Resend domain |
| `OTP_RESEND_API_KEY` | Resend API key authorized to send for that domain |
| `OTP_DELIVERY_TIMEOUT_MS` | Integer 100-30000 ms; default 5000 |
| `OTP_DEV_EXPOSE` | Unset/false in production; true/1 makes startup fail |

Production email mode fails before DB connection if delivery configuration is missing.
The local setup script still generates only development settings. Local/test
defaults send nothing and log metadata only; existing `devOtpCode` responses
remain available outside production. No raw codes are logged in any environment.

Submission occurs after the challenge/session transaction commits. Login only
sets its pending cookie after provider acceptance; a provider error/timeout gives
503 `otp_delivery_unavailable` without exposing upstream details. Provider
acceptance means queued, not inbox delivery. There is no automatic send retry;
the provider idempotency key is scoped to plane and challenge. A timed-out send
may still arrive. After a failed login, retry login within existing challenge-rate
limits. Merchant resend keeps its 30-second cooldown and inherited guess budget,
including after failed sends; a new resend replaces the previous code. Failed
login challenges/sessions expire normally and still count toward issuance limits.

Before public sign-off, authorize a controlled test destination for each plane,
verify sender/domain credentials, deliver both codes and complete both logins.
Inspect delivery/bounce status in the provider dashboard. Do not enable
development exposure as a fallback. Real delivery remains unverified until that
test is performed; automated tests use mocks and never send mail.

### Microsoft Authenticator / standard TOTP

Apply the approved `db/migrations/0085_authenticators.sql` through the normal
migration runner, then set `FEATURE_TOTP=true` and provide
`TOTP_SECRET_ENCRYPTION_KEY` through your secret manager: base64 encoding of
32 cryptographically random bytes. Keep this dedicated key separate from
webhook encryption keys; retain encrypted backups securely. Do not replace the
key without first re-encrypting stored authenticator secrets under a reviewed
rotation procedure. Losing it can lock out authenticator verification. No key is
generated or stored in source/config templates by this implementation.

With email bootstrap, retain the Resend settings above. For an explicitly
TOTP-only deployment use `OTP_DELIVERY_TRANSPORT=disabled`; no email provider is
then required. **Unenrolled accounts cannot complete a new login in that mode.**
Enroll them through a trusted existing MFA-authenticated session plus fresh
password verification, or first restore authorized email delivery and complete
the existing password + email OTP journey. No password-only bootstrap, API-key
bootstrap, impersonation bootstrap, or administrator-created MFA bypass exists.
If no trusted session or recovery factor exists, identity verification and an
approved recovery process are required outside this implementation. Do not edit
the database to mark a pending session authenticated.

Open **Account security** at `/dashboard/security` (merchant) or `/security`
(admin). Select **Other account** in Microsoft Authenticator and scan the local
QR, or enter the manual secret as a time-based account. Confirm a code before
activation and store the ten recovery codes securely. Setup lasts ten minutes,
is bound to that session, and permits five incorrect confirmations. Recovery
codes are one-use. Replacement requires a trusted session, current password,
and current authenticator/recovery proof; it preserves the old device until
new confirmation, rotates recovery codes, and revokes other sessions.

Enrolled logins use SHA-1 RFC 6238, 6 digits, 30 seconds, with at most one step
of clock drift in either direction. Synchronize all API hosts using NTP. The
confirmation step and each accepted login step are consumed globally per user,
under a database lock. A code just used to confirm/setup cannot immediately be
reused for login: wait for the next code or use one recovery code. Never disable
FEATURE_TOTP as an account recovery shortcut; this changes the authentication
policy and must be a deliberate deployment decision.

Serve both UIs/API over HTTPS and preserve the original Host header at the
reverse proxy; management requests validate Origin against that host. Disable
request/response body capture for authentication endpoints in proxies/APM:
passwords, setup secrets, codes and recovery responses must not enter logs or
caches. New management responses carry no-store. No Microsoft Entra ID or push
approval infrastructure is used. Database integration and an actual Microsoft
Authenticator scan/login still require deployment verification; see
`Evidence/MICROSOFT_AUTHENTICATOR_INTEGRATION.md`.

`Dockerfile.node` uses Node 22 and the root lockfile for API, reporting,
migrations, and seed. `Dockerfile.go` builds a static settlement binary in a
separate builder image; its runtime includes CA certificates and timezone data.
The build context excludes local environment files and repository evidence.

Every service uses `DATABASE_URL` for the same development Postgres instance.
Go ignores legacy `PGCONN_SETTLEMENT`; explicit `SETTLEMENT_DATABASE_URL` overrides
`DATABASE_URL` when supplied. Normal Compose omits both. The settlement daemon requires a
nonempty `SETTLEMENT_INTERNAL_TOKEN`; there is no daemon token fallback.
Production API requires an explicit webhook encryption key; Compose supplies a
generated key in development as well. Reporting starts with the explicit
`worker` subcommand.
