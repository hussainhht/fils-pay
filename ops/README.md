# Local development stack

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
