# Local development stack

For the IP preview/server deployment and remaining production activation steps,
see [PRODUCTION.md](PRODUCTION.md). The production Compose file is separate from
this development stack; do not deploy the development fixture credentials.

Postgres, API, settlement, and reporting run through Docker Compose. Web and
admin remain separate Vite development servers. This configuration uses a
shared development database role and public fixture credentials; provision
separate database roles and deployment secrets before hosting it.

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

### Login and authenticator configuration

Merchant and admin accounts sign in with a password until an authenticator is
activated. Enrolled accounts require an authenticator or recovery code. Email
OTP is no longer sent or accepted for sign-in. `OTP_DELIVERY_TRANSPORT` defaults
to `disabled`; a configured Resend adapter is unused by login. Apply migration
0085 even when the authenticator feature is disabled, so login can detect an
existing enrollment and fail closed if the feature is unavailable.

### Microsoft Authenticator / standard TOTP

Apply the approved `db/migrations/0085_authenticators.sql` through the normal
migration runner, then set `FEATURE_TOTP=true` and provide
`TOTP_SECRET_ENCRYPTION_KEY` through your secret manager: base64 encoding of
32 cryptographically random bytes. Keep this dedicated key separate from
webhook encryption keys; retain encrypted backups securely. Do not replace the
key without first re-encrypting stored authenticator secrets under a reviewed
rotation procedure. Losing it can lock out authenticator verification. No key is
generated or stored in source/config templates by this implementation.

Sign in using your password to enroll an authenticator. Enrolled users must
continue using their authenticator or a recovery code. If an enrolled user has
lost all factors, identity verification and an approved recovery process are
required outside this implementation. Do not edit the database to authenticate
a pending session.

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
Compose omits `PGCONN_SETTLEMENT`: Go intentionally gives that variable
precedence when it is supplied externally. The settlement daemon requires a
nonempty `SETTLEMENT_INTERNAL_TOKEN`; there is no daemon token fallback.
Production API requires an explicit webhook encryption key; Compose supplies a
generated key in development as well. Reporting starts with the explicit
`worker` subcommand.
# Temporary demo console OTP

On the existing HTTPS demo host, `/etc/filspay/api.env` explicitly enables:

```dotenv
OTP_DELIVERY_TRANSPORT=console
TEST_OTP_MERCHANT_EMAILS=test-owner@filspay.example
TEST_OTP_ADMIN_EMAILS=test-admin@filspay.example
OTP_TTL_MINUTES=5
ADMIN_OTP_TTL_MINUTES=5
OTP_MAX_ATTEMPTS=5
ADMIN_OTP_MAX_ATTEMPTS=5
OTP_DEV_EXPOSE=true
FEATURE_TOTP=false
```

Both password logins return an unauthenticated pending session and require a
secure random six-digit OTP before session promotion. Only salted hashes are
stored. Codes expire after five minutes, allow five attempts, and are single-use;
a new login consumes earlier challenges. Existing challenge/password rate limits
remain in effect. Console merchant delivery requires both the explicit email
allowlist and `merchants.test_mode=true`; other unenrolled identities fail closed
with 503 when console is the configured transport. Enrolled authenticators keep
their existing policy and cannot be bypassed with console OTP. Eligibility is
checked again at verification. No Resend configuration is needed for this mode.

Read the temporary test codes with:

```sh
ssh -t dilmune@68.183.82.221 'sudo docker logs --since 5m -f filspay-api-1 2>&1 | grep --line-buffered "TEST OTP"'
```

Log access is restricted to server operators. Disabling console delivery also
invalidates outstanding console challenges. With `disabled` transport, the
existing password/authenticator policy applies; it does not retain console OTP
enforcement. Replace this temporary transport with an explicitly implemented
email-login policy before enabling general live-user email OTP.

For this temporary demo, `OTP_DEV_EXPOSE=true` additionally returns `devOtp`
only after the console transport's test-account checks pass. The login pages
write that code to the browser developer console. Set it to `false` and restart
the API to remove response exposure when the demo ends; OTP verification is
still required. Never enable this convenience for live accounts.
